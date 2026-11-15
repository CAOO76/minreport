import { Router, type Request, type Response } from 'express';
import zlib from 'node:zlib';
import { db, storage } from '../config/firebase';
import { env } from '../config/env';
import { resolveGoogleGeocodingApiKey } from '../config/secrets';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { extractClientIp, mutationRateLimiter } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import {
    computeSixYearRetentionTimestamp,
    computeThirtyDayTtlTimestamp,
    toEpochMillis,
} from '../core/retention-policy';
import {
    CanonicalGeoFixSchema,
    CreateGeoReportStampBodySchema,
    GeoReportStampSchema,
    GeoResolveRequestSchema,
    GeoResolvedCandidateSchema,
    PmtilesHeaderMetadataSchema,
    type GeoReportStamp,
    type GeoResolvedCandidate,
    type PmtilesHeaderMetadata,
} from '../contracts/geo.contracts';
import { evaluatePilotExpiration } from '../contracts/session.contracts';
import {
    buildCanonicalGeoFix,
    buildGeoStampVectorSvg,
    computeDeterministicGeoStampHash,
    sha256Hex,
    wgs84ToUtm,
} from '../core/geo/wgs84UtmProjection';
import {
    PMTILES_MAX_ZOOM,
    PMTILES_V3_HEADER_BYTES,
    decodePmtilesDirectory,
    findTileInDirectory,
    parsePmtilesV3Header,
    toPmtilesHeaderMetadata,
    zxyToPmtilesTileId,
    type PmtilesCompression,
} from '../core/geo/pmtilesSpec';

const router = Router();

const BASEMAP_ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;
const TENANT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

interface GazetteerEntry {
    id: string;
    name: string;
    locality: string;
    region: string;
    postalCode: string;
    countryCode: 'CL' | 'PE' | 'BR' | 'AR' | 'AU' | 'CA' | 'US';
    lat: number;
    lng: number;
    aliases: string[];
}

const COUNTRY_LABELS: Record<'es' | 'en' | 'pt', Record<string, string>> = {
    es: {
        CL: 'Chile',
        PE: 'Perú',
        BR: 'Brasil',
        AR: 'Argentina',
        AU: 'Australia',
        CA: 'Canadá',
        US: 'Estados Unidos',
    },
    en: {
        CL: 'Chile',
        PE: 'Peru',
        BR: 'Brazil',
        AR: 'Argentina',
        AU: 'Australia',
        CA: 'Canada',
        US: 'United States',
    },
    pt: {
        CL: 'Chile',
        PE: 'Peru',
        BR: 'Brasil',
        AR: 'Argentina',
        AU: 'Austrália',
        CA: 'Canadá',
        US: 'Estados Unidos',
    },
};

const SOVEREIGN_GAZETTEER: ReadonlyArray<GazetteerEntry> = [
    // Chile (CL)
    {
        id: 'cl-antofagasta',
        name: 'Antofagasta',
        locality: 'Antofagasta',
        region: 'Región de Antofagasta',
        postalCode: '1240000',
        countryCode: 'CL',
        lat: -23.6509,
        lng: -70.3975,
        aliases: ['antofagasta', 'escondida', 'puerto antofagasta', 'la negra'],
    },
    {
        id: 'cl-calama',
        name: 'Calama',
        locality: 'Calama',
        region: 'Región de Antofagasta',
        postalCode: '1390000',
        countryCode: 'CL',
        lat: -22.4567,
        lng: -68.9237,
        aliases: ['calama', 'chuquicamata', 'el loa', 'radomiro tomic', 'ministro hales'],
    },
    {
        id: 'cl-copiapo',
        name: 'Copiapó',
        locality: 'Copiapó',
        region: 'Región de Atacama',
        postalCode: '1530000',
        countryCode: 'CL',
        lat: -27.3668,
        lng: -70.3322,
        aliases: ['copiapo', 'atacama', 'tierra amarilla', 'candelaria'],
    },
    {
        id: 'cl-iquique',
        name: 'Iquique',
        locality: 'Iquique',
        region: 'Región de Tarapacá',
        postalCode: '1100000',
        countryCode: 'CL',
        lat: -20.2133,
        lng: -70.1503,
        aliases: ['iquique', 'tarapaca', 'collahuasi', 'quebrada blanca'],
    },
    {
        id: 'cl-rancagua',
        name: 'Rancagua',
        locality: 'Rancagua',
        region: "Región del Libertador General Bernardo O'Higgins",
        postalCode: '2820000',
        countryCode: 'CL',
        lat: -34.1708,
        lng: -70.7444,
        aliases: ['rancagua', 'ohiggins', 'el teniente', 'machali'],
    },
    {
        id: 'cl-santiago',
        name: 'Santiago',
        locality: 'Santiago',
        region: 'Región Metropolitana de Santiago',
        postalCode: '8320000',
        countryCode: 'CL',
        lat: -33.4489,
        lng: -70.6693,
        aliases: ['santiago', 'metropolitana', 'providencia', 'las condes', 'vitacura'],
    },
    {
        id: 'cl-salamanca',
        name: 'Salamanca',
        locality: 'Salamanca',
        region: 'Región de Coquimbo',
        postalCode: '1950000',
        countryCode: 'CL',
        lat: -31.7789,
        lng: -70.9675,
        aliases: ['salamanca', 'choapa', 'los pelambres', 'coquimbo'],
    },
    {
        id: 'cl-mejillones',
        name: 'Mejillones',
        locality: 'Mejillones',
        region: 'Región de Antofagasta',
        postalCode: '1310000',
        countryCode: 'CL',
        lat: -23.1,
        lng: -70.45,
        aliases: ['mejillones', 'angamos', 'puerto mejillones'],
    },
    // Perú (PE)
    {
        id: 'pe-arequipa',
        name: 'Arequipa',
        locality: 'Arequipa',
        region: 'Arequipa',
        postalCode: '04001',
        countryCode: 'PE',
        lat: -16.409,
        lng: -71.5375,
        aliases: ['arequipa', 'yanahuara'],
    },
    {
        id: 'pe-cerro-verde',
        name: 'Cerro Verde',
        locality: 'Uchumayo',
        region: 'Arequipa',
        postalCode: '04011',
        countryCode: 'PE',
        lat: -16.53,
        lng: -71.59,
        aliases: ['cerro verde', 'uchumayo'],
    },
    {
        id: 'pe-antamina',
        name: 'Antamina',
        locality: 'San Marcos',
        region: 'Áncash',
        postalCode: '02300',
        countryCode: 'PE',
        lat: -9.5378,
        lng: -77.0564,
        aliases: ['antamina', 'san marcos', 'ancash', 'huari'],
    },
    {
        id: 'pe-cusco',
        name: 'Cusco',
        locality: 'Cusco',
        region: 'Cusco',
        postalCode: '08000',
        countryCode: 'PE',
        lat: -13.5319,
        lng: -71.9675,
        aliases: ['cusco', 'cuzco', 'las bambas', 'antapaccay'],
    },
    {
        id: 'pe-lima',
        name: 'Lima',
        locality: 'Lima',
        region: 'Lima',
        postalCode: '15001',
        countryCode: 'PE',
        lat: -12.0464,
        lng: -77.0428,
        aliases: ['lima', 'callao', 'miraflores', 'san isidro'],
    },
    {
        id: 'pe-cajamarca',
        name: 'Cajamarca',
        locality: 'Cajamarca',
        region: 'Cajamarca',
        postalCode: '06001',
        countryCode: 'PE',
        lat: -7.1638,
        lng: -78.5003,
        aliases: ['cajamarca', 'yanacocha'],
    },
    // Brasil (BR)
    {
        id: 'br-belo-horizonte',
        name: 'Belo Horizonte',
        locality: 'Belo Horizonte',
        region: 'Minas Gerais',
        postalCode: '30110-000',
        countryCode: 'BR',
        lat: -19.9167,
        lng: -43.9345,
        aliases: ['belo horizonte', 'minas gerais', 'quadrilatero ferrifero'],
    },
    {
        id: 'br-carajas',
        name: 'Carajás',
        locality: 'Parauapebas',
        region: 'Pará',
        postalCode: '68516-000',
        countryCode: 'BR',
        lat: -6.0631,
        lng: -50.1683,
        aliases: ['carajas', 'parauapebas', 'para'],
    },
    {
        id: 'br-itabira',
        name: 'Itabira',
        locality: 'Itabira',
        region: 'Minas Gerais',
        postalCode: '35900-000',
        countryCode: 'BR',
        lat: -19.6194,
        lng: -43.2269,
        aliases: ['itabira', 'caue'],
    },
    {
        id: 'br-sao-paulo',
        name: 'São Paulo',
        locality: 'São Paulo',
        region: 'São Paulo',
        postalCode: '01000-000',
        countryCode: 'BR',
        lat: -23.5505,
        lng: -46.6333,
        aliases: ['sao paulo', 'sp'],
    },
    // Argentina (AR)
    {
        id: 'ar-san-juan',
        name: 'San Juan',
        locality: 'San Juan',
        region: 'San Juan',
        postalCode: 'J5400',
        countryCode: 'AR',
        lat: -31.5375,
        lng: -68.5364,
        aliases: ['san juan', 'veladero', 'josemaria'],
    },
    {
        id: 'ar-salta',
        name: 'Salta',
        locality: 'Salta',
        region: 'Salta',
        postalCode: 'A4400',
        countryCode: 'AR',
        lat: -24.7821,
        lng: -65.4232,
        aliases: ['salta', 'puna'],
    },
    {
        id: 'ar-jujuy',
        name: 'Jujuy',
        locality: 'San Salvador de Jujuy',
        region: 'Jujuy',
        postalCode: 'Y4600',
        countryCode: 'AR',
        lat: -24.1858,
        lng: -65.2995,
        aliases: ['jujuy', 'san salvador de jujuy', 'olaroz'],
    },
    {
        id: 'ar-mendoza',
        name: 'Mendoza',
        locality: 'Mendoza',
        region: 'Mendoza',
        postalCode: 'M5500',
        countryCode: 'AR',
        lat: -32.8895,
        lng: -68.8458,
        aliases: ['mendoza'],
    },
    // Australia (AU)
    {
        id: 'au-perth',
        name: 'Perth',
        locality: 'Perth',
        region: 'Western Australia',
        postalCode: '6000',
        countryCode: 'AU',
        lat: -31.9505,
        lng: 115.8605,
        aliases: ['perth', 'western australia'],
    },
    {
        id: 'au-kalgoorlie',
        name: 'Kalgoorlie',
        locality: 'Kalgoorlie-Boulder',
        region: 'Western Australia',
        postalCode: '6430',
        countryCode: 'AU',
        lat: -30.7489,
        lng: 121.4658,
        aliases: ['kalgoorlie', 'boulder', 'super pit'],
    },
    {
        id: 'au-newman',
        name: 'Newman',
        locality: 'Newman',
        region: 'Western Australia',
        postalCode: '6753',
        countryCode: 'AU',
        lat: -23.3569,
        lng: 119.7358,
        aliases: ['newman', 'pilbara', 'whaleback'],
    },
    // Canadá (CA)
    {
        id: 'ca-sudbury',
        name: 'Sudbury',
        locality: 'Greater Sudbury',
        region: 'Ontario',
        postalCode: 'P3E 1B6',
        countryCode: 'CA',
        lat: 46.4917,
        lng: -80.993,
        aliases: ['sudbury', 'greater sudbury', 'ontario'],
    },
    {
        id: 'ca-timmins',
        name: 'Timmins',
        locality: 'Timmins',
        region: 'Ontario',
        postalCode: 'P4N 1B1',
        countryCode: 'CA',
        lat: 48.4758,
        lng: -81.3305,
        aliases: ['timmins', 'porcupine'],
    },
    {
        id: 'ca-vancouver',
        name: 'Vancouver',
        locality: 'Vancouver',
        region: 'British Columbia',
        postalCode: 'V6B 1A1',
        countryCode: 'CA',
        lat: 49.2827,
        lng: -123.1207,
        aliases: ['vancouver', 'british columbia'],
    },
    {
        id: 'ca-toronto',
        name: 'Toronto',
        locality: 'Toronto',
        region: 'Ontario',
        postalCode: 'M5H 2N2',
        countryCode: 'CA',
        lat: 43.6532,
        lng: -79.3832,
        aliases: ['toronto'],
    },
    // Estados Unidos (US)
    {
        id: 'us-elko',
        name: 'Elko',
        locality: 'Elko',
        region: 'Nevada',
        postalCode: '89801',
        countryCode: 'US',
        lat: 40.8324,
        lng: -115.7631,
        aliases: ['elko', 'nevada', 'carlin'],
    },
    {
        id: 'us-tucson',
        name: 'Tucson',
        locality: 'Tucson',
        region: 'Arizona',
        postalCode: '85701',
        countryCode: 'US',
        lat: 32.2226,
        lng: -110.9747,
        aliases: ['tucson', 'arizona'],
    },
    {
        id: 'us-denver',
        name: 'Denver',
        locality: 'Denver',
        region: 'Colorado',
        postalCode: '80202',
        countryCode: 'US',
        lat: 39.7392,
        lng: -104.9903,
        aliases: ['denver', 'colorado'],
    },
];

function normalizeSearchText(raw: string): string {
    return String(raw || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 6371.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseStreetAndNumber(rawSegment: string): { street: string; streetNumber: string } {
    const clean = rawSegment.trim();
    if (!clean) return { street: '', streetNumber: '' };
    const match = clean.match(/^(.+?)\s+#?\s*(\d{1,6}[A-Za-z]?)$/);
    if (match) {
        return { street: match[1].trim(), streetNumber: match[2].trim() };
    }
    return { street: clean, streetNumber: '' };
}

function resolveWithSovereignGazetteer(params: {
    mode: 'FORWARD' | 'REVERSE';
    query?: string;
    lat?: number;
    lng?: number;
    countryCode?: string;
    language: 'es' | 'en' | 'pt';
    limit: number;
}): GeoResolvedCandidate[] {
    const langLabels = COUNTRY_LABELS[params.language] || COUNTRY_LABELS.es;
    const scopedPool = params.countryCode
        ? SOVEREIGN_GAZETTEER.filter((entry) => entry.countryCode === params.countryCode)
        : SOVEREIGN_GAZETTEER;
    const effectivePool = scopedPool.length > 0 ? scopedPool : SOVEREIGN_GAZETTEER;

    if (params.mode === 'REVERSE' && typeof params.lat === 'number' && typeof params.lng === 'number') {
        const targetLat = params.lat;
        const targetLng = params.lng;

        const ranked = [...effectivePool]
            .map((entry) => ({
                entry,
                distanceKm: haversineKm(targetLat, targetLng, entry.lat, entry.lng),
            }))
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, params.limit);

        return ranked.map(({ entry, distanceKm }, index) => {
            const cLat = index === 0 ? targetLat : entry.lat;
            const cLng = index === 0 ? targetLng : entry.lng;
            const utm = wgs84ToUtm(cLat, cLng);
            const countryLabel = langLabels[entry.countryCode] || entry.countryCode;

            let formattedAddress: string;
            let locality = entry.locality;
            let region = entry.region;
            let postalCode = entry.postalCode;
            let resolvedCountryCode = entry.countryCode;

            if (index === 0 && distanceKm > 600) {
                locality = '';
                region = '';
                postalCode = '';
                resolvedCountryCode = (params.countryCode as GazetteerEntry['countryCode']) || entry.countryCode;
                formattedAddress = `WGS84 ${cLat.toFixed(5)}, ${cLng.toFixed(5)}`;
            } else if (index === 0 && distanceKm > 3) {
                formattedAddress = `${entry.name} (~${Math.round(distanceKm)} km), ${entry.region}, ${countryLabel}`;
            } else {
                formattedAddress = `${entry.name}, ${entry.region}, ${countryLabel}`;
            }

            return GeoResolvedCandidateSchema.parse({
                placeId:
                    index === 0
                        ? `sov_rev_${sha256Hex(`${cLat.toFixed(5)},${cLng.toFixed(5)}`).slice(0, 16)}`
                        : `sov_${entry.id}`,
                formattedAddress,
                street: '',
                streetNumber: '',
                locality,
                region,
                postalCode,
                countryCode: resolvedCountryCode,
                lat: cLat,
                lng: cLng,
                utm,
                provider: 'SOVEREIGN_GAZETTEER',
            });
        });
    }

    const rawQuery = String(params.query || '').trim();
    const decimalCoordMatch = rawQuery.match(
        /^\s*([-+]?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$/
    );
    if (decimalCoordMatch) {
        const parsedLat = Number(decimalCoordMatch[1]);
        const parsedLng = Number(decimalCoordMatch[2]);
        if (
            Number.isFinite(parsedLat) &&
            Number.isFinite(parsedLng) &&
            parsedLat >= -80 &&
            parsedLat <= 84 &&
            parsedLng >= -180 &&
            parsedLng <= 180
        ) {
            return resolveWithSovereignGazetteer({
                mode: 'REVERSE',
                lat: parsedLat,
                lng: parsedLng,
                countryCode: params.countryCode,
                language: params.language,
                limit: params.limit,
            });
        }
    }

    const normQuery = normalizeSearchText(rawQuery);
    const stopwords = new Set(['av', 'avenida', 'calle', 'pasaje', 'ruta', 'de', 'del', 'la', 'el', 'los', 'las', 'chile', 'peru', 'brasil', 'argentina']);
    const tokens = normQuery
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !stopwords.has(t));

    const queryParts = rawQuery.split(',').map((p) => p.trim()).filter(Boolean);
    const hasStreetHint = queryParts.length > 1;
    const parsedStreet = hasStreetHint ? parseStreetAndNumber(queryParts[0]) : { street: '', streetNumber: '' };

    const scored = effectivePool
        .map((entry) => {
            const normName = normalizeSearchText(entry.name);
            const normLocality = normalizeSearchText(entry.locality);
            const normRegion = normalizeSearchText(entry.region);
            const normAliases = entry.aliases.map((a) => normalizeSearchText(a));
            const searchable = [normName, normLocality, normRegion, ...normAliases];

            let score = 0;
            if (normQuery === normName || normAliases.includes(normQuery)) {
                score += 120;
            } else if (searchable.some((s) => s.startsWith(normQuery))) {
                score += 80;
            } else if (searchable.some((s) => normQuery.includes(s))) {
                score += 65;
            }

            for (const tok of tokens) {
                if (normName === tok || normAliases.includes(tok)) {
                    score += 45;
                } else if (searchable.some((s) => s.includes(tok))) {
                    score += 20;
                }
            }

            return { entry, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.limit);

    return scored.map(({ entry }) => {
        const utm = wgs84ToUtm(entry.lat, entry.lng);
        const countryLabel = langLabels[entry.countryCode] || entry.countryCode;
        const streetPrefix = parsedStreet.street
            ? `${parsedStreet.street}${parsedStreet.streetNumber ? ` ${parsedStreet.streetNumber}` : ''}, `
            : '';

        return GeoResolvedCandidateSchema.parse({
            placeId: `sov_${entry.id}`,
            formattedAddress: `${streetPrefix}${entry.name}, ${entry.region}, ${countryLabel}`,
            street: parsedStreet.street,
            streetNumber: parsedStreet.streetNumber,
            locality: entry.locality,
            region: entry.region,
            postalCode: entry.postalCode,
            countryCode: entry.countryCode,
            lat: entry.lat,
            lng: entry.lng,
            utm,
            provider: 'SOVEREIGN_GAZETTEER',
        });
    });
}

async function resolveWithGoogleGeocoderServer(params: {
    mode: 'FORWARD' | 'REVERSE';
    query?: string;
    lat?: number;
    lng?: number;
    countryCode?: string;
    language: 'es' | 'en' | 'pt';
    limit: number;
}): Promise<GeoResolvedCandidate[] | null> {
    if (env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test') {
        return null;
    }
    const apiKey = await resolveGoogleGeocodingApiKey();
    if (!apiKey) {
        return null;
    }

    try {
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        if (params.mode === 'FORWARD') {
            url.searchParams.set('address', String(params.query || ''));
            if (params.countryCode) {
                url.searchParams.set('components', `country:${params.countryCode}`);
            }
        } else {
            url.searchParams.set('latlng', `${params.lat},${params.lng}`);
        }
        url.searchParams.set('language', params.language);
        url.searchParams.set('key', apiKey);

        const response = await fetch(url.toString(), {
            method: 'GET',
            signal: AbortSignal.timeout(3500),
        });
        if (!response.ok) {
            return null;
        }
        const json = (await response.json()) as {
            status?: string;
            results?: Array<Record<string, any>>;
        };
        if (json.status !== 'OK' || !Array.isArray(json.results) || json.results.length === 0) {
            return null;
        }

        const candidates: GeoResolvedCandidate[] = [];
        for (const item of json.results.slice(0, params.limit)) {
            const loc = item?.geometry?.location;
            const lat = Number(loc?.lat);
            const lng = Number(loc?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -80 || lat > 84) {
                continue;
            }

            const components: Array<{ long_name?: string; short_name?: string; types?: string[] }> = Array.isArray(
                item.address_components
            )
                ? item.address_components
                : [];
            const findComp = (type: string) =>
                components.find((c) => Array.isArray(c.types) && c.types.includes(type));

            const street = findComp('route')?.long_name || '';
            const streetNumber = findComp('street_number')?.long_name || '';
            const locality =
                findComp('locality')?.long_name ||
                findComp('administrative_area_level_3')?.long_name ||
                findComp('administrative_area_level_2')?.long_name ||
                '';
            const region = findComp('administrative_area_level_1')?.long_name || '';
            const postalCode = findComp('postal_code')?.long_name || '';
            const rawCountry = String(findComp('country')?.short_name || params.countryCode || 'CL')
                .trim()
                .toUpperCase();
            if (!/^[A-Z]{2}$/.test(rawCountry)) {
                continue;
            }

            const utm = wgs84ToUtm(lat, lng);
            candidates.push(
                GeoResolvedCandidateSchema.parse({
                    placeId: String(item.place_id || `goog_${sha256Hex(`${lat},${lng}`).slice(0, 16)}`),
                    formattedAddress: String(item.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
                    street,
                    streetNumber,
                    locality,
                    region,
                    postalCode,
                    countryCode: rawCountry,
                    lat,
                    lng,
                    utm,
                    provider: 'GOOGLE_SERVER',
                })
            );
        }

        return candidates.length > 0 ? candidates : null;
    } catch (err) {
        console.warn('[GEO-RESOLVE] Fallback desde Google Geocoding Server a Gazetteer Soberano:', err);
        return null;
    }
}

/**
 * POST /api/geo/resolve
 * Geocodificación directa e inversa server-side con caché SHA-256 (TTL 30 días)
 * y fallback determinista multi-país `SOVEREIGN_GAZETTEER`.
 */
export async function resolveGeoHandler(req: AuthRequest, res: Response) {
    try {
        const parsed = GeoResolveRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Parámetros de geocodificación inválidos.',
                details: parsed.error.format(),
            });
        }

        const payload = parsed.data;
        const normalizedQuery =
            payload.mode === 'FORWARD'
                ? String(payload.query || '')
                      .trim()
                      .toLowerCase()
                      .replace(/\s+/g, ' ')
                : '';
        const roundedLat = payload.mode === 'REVERSE' && typeof payload.lat === 'number' ? payload.lat.toFixed(5) : '';
        const roundedLng = payload.mode === 'REVERSE' && typeof payload.lng === 'number' ? payload.lng.toFixed(5) : '';

        const cacheKey = sha256Hex(
            JSON.stringify({
                v: 1,
                mode: payload.mode,
                query: normalizedQuery,
                lat: roundedLat,
                lng: roundedLng,
                countryCode: payload.countryCode || '',
                language: payload.language,
                limit: payload.limit,
            })
        );

        try {
            const cachedSnap = await db.collection('geo_resolve_cache').doc(cacheKey).get();
            if (cachedSnap.exists) {
                const cachedData = cachedSnap.data() || {};
                const expiresAtMs = toEpochMillis(cachedData.expiresAt);
                if (expiresAtMs > Date.now() && Array.isArray(cachedData.candidates)) {
                    const cachedCandidates = cachedData.candidates.map((c: any) =>
                        GeoResolvedCandidateSchema.parse({
                            ...c,
                            provider: 'CACHE_SHA256',
                        })
                    );
                    return res.status(200).json({
                        ok: true,
                        cached: true,
                        cacheKey,
                        candidates: cachedCandidates,
                    });
                }
            }
        } catch (cacheReadErr) {
            console.warn('[GEO-RESOLVE] Advertencia leyendo geo_resolve_cache:', cacheReadErr);
        }

        let candidates = await resolveWithGoogleGeocoderServer(payload);
        if (!candidates || candidates.length === 0) {
            candidates = resolveWithSovereignGazetteer(payload);
        }

        try {
            await db
                .collection('geo_resolve_cache')
                .doc(cacheKey)
                .set({
                    cacheKey,
                    mode: payload.mode,
                    countryCode: payload.countryCode || null,
                    language: payload.language,
                    candidates,
                    createdAt: new Date().toISOString(),
                    expiresAt: computeThirtyDayTtlTimestamp(),
                });
        } catch (cacheWriteErr) {
            console.warn('[GEO-RESOLVE] Advertencia escribiendo geo_resolve_cache:', cacheWriteErr);
        }

        return res.status(200).json({
            ok: true,
            cached: false,
            cacheKey,
            candidates,
        });
    } catch (err: any) {
        console.error('[GEO-RESOLVE] Error resolviendo georreferenciación:', err);
        return res.status(500).json({ error: err?.message || 'Error interno en resolución geográfica.' });
    }
}

async function readWithFailOpenTimeout<T>(promiseFn: () => Promise<T>, fallback: T, timeoutMs = 600): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promiseFn(),
            new Promise<T>((resolve) => {
                timer = setTimeout(() => resolve(fallback), timeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            }),
        ]);
    } catch {
        return fallback;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function isInactiveMembershipStatus(status: unknown): boolean {
    const st = String(status || 'ACTIVE').trim().toUpperCase();
    return st === 'SUSPENDED' || st === 'REVOKED' || st === 'INACTIVE' || st === 'DELETED';
}

interface StampTenantAuthzResult {
    authorized: boolean;
    status: number;
    error?: string;
    targetAccountId: string;
    uid: string;
    emailLower: string;
}

async function authorizeCoreGeoStampTenant(
    req: AuthRequest,
    bodyAccountId?: string
): Promise<StampTenantAuthzResult> {
    const caller = req.user || {};
    const uid = String(caller.uid || '').trim();
    if (!uid) {
        return {
            authorized: false,
            status: 401,
            error: 'No autorizado: sesión ausente.',
            targetAccountId: '',
            uid: '',
            emailLower: '',
        };
    }

    const emailLower = String(caller.email || '').toLowerCase();
    const emailVerifiedOk = caller.email_verified !== false;

    let profileData: Record<string, any> | null = null;
    try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            profileData = userSnap.data() || null;
        }
    } catch {
        profileData = null;
    }

    const tokenRole = String(caller.role || '').toUpperCase();
    const serverUserRole = String(profileData?.role || '').toUpperCase();

    const isDevRoot =
        caller.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        uid === 'dev-master-root-uid' ||
        (emailVerifiedOk && emailLower === 'dev@minreport.com');

    const isSuperAdmin =
        !isDevRoot &&
        (caller.admin === true ||
            tokenRole === 'SUPER_ADMIN' ||
            uid === 'super-admin-uid' ||
            (emailVerifiedOk &&
                (emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase() || emailLower === 'admin@minreport.com')));

    const userAccountDisabled =
        String(profileData?.status || '').toUpperCase() === 'SUSPENDED' ||
        String(profileData?.status || '').toUpperCase() === 'REVOKED';

    const isTestPilot =
        !isDevRoot &&
        !isSuperAdmin &&
        !userAccountDisabled &&
        (tokenRole === 'TEST_PILOT' || serverUserRole === 'TEST_PILOT');

    if (isTestPilot) {
        const candidateExpiry = caller.pilotExpiresAt ?? profileData?.pilotExpiresAt;
        let isExpiredPilot = evaluatePilotExpiration(candidateExpiry);
        if (!isExpiredPilot) {
            const pilotsSnap = await readWithFailOpenTimeout<any>(
                () => db.collection('test_pilots').where('userId', '==', uid).get(),
                null,
                600
            );
            if (pilotsSnap && !pilotsSnap.empty) {
                const docs = pilotsSnap.docs.map((d: any) => d.data() || {});
                const activeDocs = docs.filter((p: any) => String(p.status || '').toUpperCase() === 'ACTIVE');
                if (activeDocs.length > 0 && activeDocs.every((p: any) => evaluatePilotExpiration(p.expiresAt))) {
                    isExpiredPilot = true;
                }
            }
        }
        if (isExpiredPilot) {
            return {
                authorized: false,
                status: 403,
                error: 'Cuenta 3º TEST-PILOT expirada.',
                targetAccountId: '',
                uid,
                emailLower,
            };
        }
    }

    const hasFullSuiteOverride = isDevRoot || isSuperAdmin || isTestPilot;

    const headerAccountId = String(
        req.headers['x-active-account-id'] || req.headers['x-tenant-id'] || ''
    ).trim();
    const cleanBodyAccountId = String(bodyAccountId || '').trim();

    if (
        !hasFullSuiteOverride &&
        cleanBodyAccountId &&
        headerAccountId &&
        cleanBodyAccountId !== headerAccountId
    ) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED: Conflicto entre accountId de payload y cabecera activa.',
            targetAccountId: '',
            uid,
            emailLower,
        };
    }

    const resolvedTargetId =
        cleanBodyAccountId ||
        headerAccountId ||
        String(caller.activeAccountId || caller.tenantId || '').trim() ||
        String(profileData?.lastActiveAccountId || profileData?.primaryAccountId || '').trim() ||
        String(profileData?.memberships?.[0]?.accountId || '').trim() ||
        (hasFullSuiteOverride ? 'dev-master-sandbox' : '');

    if (!resolvedTargetId || !TENANT_ID_REGEX.test(resolvedTargetId)) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            targetAccountId: '',
            uid,
            emailLower,
        };
    }

    if (hasFullSuiteOverride) {
        return {
            authorized: true,
            status: 200,
            targetAccountId: resolvedTargetId,
            uid,
            emailLower,
        };
    }

    if (resolvedTargetId === 'dev-master-sandbox' || userAccountDisabled) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            targetAccountId: '',
            uid,
            emailLower,
        };
    }

    const accSnap = await db.collection('accounts').doc(resolvedTargetId).get();
    if (!accSnap.exists) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            targetAccountId: '',
            uid,
            emailLower,
        };
    }

    const accountData = accSnap.data() || {};
    const accountStatus = String(accountData.status || 'ACTIVE').toUpperCase();
    if (
        accountStatus === 'PENDING_APPROVAL' ||
        accountStatus === 'REJECTED' ||
        accountStatus === 'SUSPENDED'
    ) {
        return {
            authorized: false,
            status: 403,
            error: `CUENTA_${accountStatus}: La cuenta organizacional no se encuentra habilitada.`,
            targetAccountId: '',
            uid,
            emailLower,
        };
    }

    const isOwner = String(accountData.ownerId || '') === uid;
    const hasProfileMembership =
        Array.isArray(profileData?.memberships) &&
        profileData!.memberships.some(
            (m: any) => m?.accountId === resolvedTargetId && !isInactiveMembershipStatus(m?.status)
        );

    let hasMemberDoc = false;
    if (!isOwner && !hasProfileMembership) {
        try {
            const memberSnap = await db
                .collection('accounts')
                .doc(resolvedTargetId)
                .collection('members')
                .doc(uid)
                .get();
            if (memberSnap.exists) {
                const mData = memberSnap.data() || {};
                hasMemberDoc = !isInactiveMembershipStatus(mData.status);
            }
        } catch {
            hasMemberDoc = false;
        }
    }

    if (!isOwner && !hasProfileMembership && !hasMemberDoc) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            targetAccountId: '',
            uid,
            emailLower,
        };
    }

    return {
        authorized: true,
        status: 200,
        targetAccountId: resolvedTargetId,
        uid,
        emailLower,
    };
}

/**
 * POST /api/geo/report-stamp
 * Emite sello georreferenciado auditable con recorte SVG industrial, SHA-256 determinista,
 * retención legal 6 años y registro en AuditLedger sin coordenadas crudas (Ley N° 21.719).
 */
export async function createGeoReportStampHandler(req: AuthRequest, res: Response) {
    try {
        const parsed = CreateGeoReportStampBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload de sello georreferenciado inválido.',
                details: parsed.error.format(),
            });
        }

        const body = parsed.data;
        const authz = await authorizeCoreGeoStampTenant(req, body.accountId);
        if (!authz.authorized) {
            return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
        }

        let canonicalFix;
        try {
            canonicalFix = CanonicalGeoFixSchema.parse(
                buildCanonicalGeoFix({
                    lat: body.fix.lat,
                    lng: body.fix.lng,
                    altitudeM: body.fix.altitudeM,
                    accuracyM: body.fix.accuracyM,
                    headingDeg: body.fix.headingDeg,
                    speedMps: body.fix.speedMps,
                    capturedAt: body.fix.capturedAt,
                    source: body.fix.source,
                })
            );
        } catch (rangeErr: any) {
            return res.status(400).json({
                error: rangeErr?.message || 'Coordenadas fuera de rango geodésico UTM (-80..84).',
            });
        }

        const stampHashSha256 = computeDeterministicGeoStampHash({
            accountId: authz.targetAccountId,
            moduleId: body.moduleId,
            entityType: body.entityType,
            entityId: body.entityId,
            fix: canonicalFix,
            label: body.label,
        });
        const stampId = `gst_${stampHashSha256.slice(0, 24)}`;
        const vectorCutoutSvg = buildGeoStampVectorSvg(canonicalFix, {
            label: body.label || body.entityType,
            stampId,
        });
        const issuedAt = new Date().toISOString();

        const stamp: GeoReportStamp = GeoReportStampSchema.parse({
            stampId,
            accountId: authz.targetAccountId,
            moduleId: body.moduleId,
            entityType: body.entityType,
            entityId: body.entityId,
            fix: canonicalFix,
            vectorCutoutSvg,
            stampHashSha256,
            issuedAt,
            issuedByUid: authz.uid,
        });

        await db
            .collection('geo_report_stamps')
            .doc(stampId)
            .set({
                ...stamp,
                tenantId: authz.targetAccountId,
                retentionUntil: computeSixYearRetentionTimestamp(),
                immutable: true,
            });

        await AuditLedger.record({
            tenantId: authz.targetAccountId,
            actorUid: authz.uid,
            actorEmail: authz.emailLower || 'operador@minreport.internal',
            action: 'GEO_REPORT_STAMP_ISSUED',
            module: body.moduleId,
            targetEntity: stampId,
            ipAddress: extractClientIp(req),
            details: {
                stampId,
                entityType: body.entityType,
                entityId: body.entityId,
                stampHashSha256,
                epsg: canonicalFix.utm.epsg,
                utmZone: canonicalFix.utm.zone,
                utmBand: canonicalFix.utm.band,
                utmHemisphere: canonicalFix.utm.hemisphere,
                source: canonicalFix.source,
            },
        });

        return res.status(201).json({
            ok: true,
            stamp,
        });
    } catch (err: any) {
        console.error('[GEO-STAMP] Error emitiendo sello georreferenciado:', err);
        return res.status(500).json({ error: err?.message || 'Error interno emitiendo sello georreferenciado.' });
    }
}

async function readStorageByteRange(file: any, start: number, endInclusive: number): Promise<Buffer> {
    if (typeof file.download === 'function') {
        const [buf] = await file.download({ start, end: endInclusive });
        return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }
    return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stream = file.createReadStream({ start, end: endInclusive });
        stream.on('data', (chunk: Buffer | Uint8Array) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

function decompressPmtilesSection(buf: Buffer, compression: PmtilesCompression): Buffer {
    if (compression === 'GZIP') {
        return zlib.gunzipSync(buf);
    }
    return buf;
}

function buildSyntheticPmtilesMetadata(basemapId: string): PmtilesHeaderMetadata {
    return PmtilesHeaderMetadataSchema.parse({
        specVersion: 3,
        tileType: 'UNKNOWN',
        minZoom: 0,
        maxZoom: 18,
        minLon: -180,
        minLat: -80,
        maxLon: 180,
        maxLat: 84,
        centerZoom: 5,
        centerLon: -69.5,
        centerLat: -23.5,
        addressedTilesCount: 0,
        clustered: false,
    });
}

function escapeXmlTileText(raw: string): string {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildTacticalSvgTile(basemapId: string, z: number, x: number, y: number, tileId: number): string {
    const safeBasemap = escapeXmlTileText(basemapId);
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">`,
        `<rect x="0" y="0" width="256" height="256" fill="#07090D"/>`,
        `<rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="64" y1="0" x2="64" y2="256" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="128" y1="0" x2="128" y2="256" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="192" y1="0" x2="192" y2="256" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="0" y1="64" x2="256" y2="64" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="0" y1="128" x2="256" y2="128" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="0" y1="192" x2="256" y2="192" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="120" y1="128" x2="136" y2="128" stroke="#C68346" stroke-width="1"/>`,
        `<line x1="128" y1="120" x2="128" y2="136" stroke="#C68346" stroke-width="1"/>`,
        `<rect x="2" y="2" width="6" height="1" fill="#00AEEF"/>`,
        `<rect x="2" y="2" width="1" height="6" fill="#00AEEF"/>`,
        `<text x="10" y="20" fill="#8A93A6" font-family="monospace" font-size="10">${safeBasemap}</text>`,
        `<text x="10" y="34" fill="#5A6072" font-family="monospace" font-size="9">z${z}/${x}/${y} #${tileId}</text>`,
        `</svg>`,
    ].join('');
}

function resolveTileMimeType(tileType: string): string {
    switch (tileType) {
        case 'MVT':
            return 'application/vnd.mapbox-vector-tile';
        case 'PNG':
            return 'image/png';
        case 'JPEG':
            return 'image/jpeg';
        case 'WEBP':
            return 'image/webp';
        case 'AVIF':
            return 'image/avif';
        default:
            return 'application/octet-stream';
    }
}

/**
 * GET /api/geo/pmtiles/:basemapId/metadata
 */
export async function getPmtilesMetadataHandler(req: Request, res: Response) {
    const basemapId = String(req.params.basemapId || '').trim();
    if (!BASEMAP_ID_REGEX.test(basemapId)) {
        return res.status(400).json({ error: 'basemapId inválido.' });
    }

    res.setHeader('Cache-Control', 'private, max-age=86400');

    try {
        const file = storage.bucket().file(`cas_blobs/geo_pmtiles/${basemapId}.pmtiles`);
        const [exists] = await file.exists();
        if (exists) {
            const headerBuf = await readStorageByteRange(file, 0, PMTILES_V3_HEADER_BYTES - 1);
            const header = parsePmtilesV3Header(new Uint8Array(headerBuf));
            const metadata = PmtilesHeaderMetadataSchema.parse(toPmtilesHeaderMetadata(header));
            return res.status(200).json({
                ok: true,
                basemapId,
                source: 'GCS_PMTILES_V3',
                metadata,
                header,
            });
        }
    } catch (err) {
        console.warn(`[GEO-PMTILES] Fallback descriptor táctico para ${basemapId}:`, err);
    }

    const fallbackMetadata = buildSyntheticPmtilesMetadata(basemapId);
    return res.status(200).json({
        ok: true,
        basemapId,
        source: 'TACTICAL_SYNTHETIC',
        metadata: fallbackMetadata,
    });
}

/**
 * GET /api/geo/pmtiles/:basemapId/tile/:z/:x/:y
 */
export async function getPmtilesTileHandler(req: Request, res: Response) {
    const basemapId = String(req.params.basemapId || '').trim();
    if (!BASEMAP_ID_REGEX.test(basemapId)) {
        return res.status(400).json({ error: 'basemapId inválido.' });
    }

    const zRaw = String(req.params.z || '').trim();
    const xRaw = String(req.params.x || '').trim();
    const yRaw = String(req.params.y || '').trim();

    if (!/^\d{1,2}$/.test(zRaw) || !/^\d{1,9}$/.test(xRaw) || !/^\d{1,9}$/.test(yRaw)) {
        return res.status(400).json({ error: 'Coordenadas z/x/y inválidas.' });
    }

    const z = Number(zRaw);
    const x = Number(xRaw);
    const y = Number(yRaw);
    const maxCoord = Math.pow(2, z);
    if (!Number.isInteger(z) || z < 0 || z > PMTILES_MAX_ZOOM || x < 0 || y < 0 || x >= maxCoord || y >= maxCoord) {
        return res.status(400).json({ error: 'Coordenadas z/x/y fuera de rango.' });
    }

    res.setHeader('Cache-Control', 'private, max-age=86400');
    const tileId = zxyToPmtilesTileId(z, x, y);

    try {
        const file = storage.bucket().file(`cas_blobs/geo_pmtiles/${basemapId}.pmtiles`);
        const [exists] = await file.exists();
        if (exists) {
            const headerBuf = await readStorageByteRange(file, 0, PMTILES_V3_HEADER_BYTES - 1);
            const header = parsePmtilesV3Header(new Uint8Array(headerBuf));

            if (header.rootDirectoryLength > 0) {
                const rootRaw = await readStorageByteRange(
                    file,
                    header.rootDirectoryOffset,
                    header.rootDirectoryOffset + header.rootDirectoryLength - 1
                );
                const rootDirBytes = decompressPmtilesSection(rootRaw, header.internalCompression);
                let match = findTileInDirectory(decodePmtilesDirectory(new Uint8Array(rootDirBytes)), tileId);

                if (match && match.runLength === 0 && match.length > 0) {
                    const leafStart = header.leafDirectoriesOffset + match.offset;
                    const leafRaw = await readStorageByteRange(file, leafStart, leafStart + match.length - 1);
                    const leafDirBytes = decompressPmtilesSection(leafRaw, header.internalCompression);
                    match = findTileInDirectory(decodePmtilesDirectory(new Uint8Array(leafDirBytes)), tileId);
                }

                if (match && match.runLength > 0 && match.length > 0) {
                    const tileStart = header.tileDataOffset + match.offset;
                    const tileBytes = await readStorageByteRange(file, tileStart, tileStart + match.length - 1);
                    res.setHeader('Content-Type', resolveTileMimeType(header.tileType));
                    if (header.tileCompression === 'GZIP') {
                        res.setHeader('Content-Encoding', 'gzip');
                    }
                    return res.status(200).send(tileBytes);
                }
            }
        }
    } catch (err) {
        console.warn(`[GEO-PMTILES] Fallback tesela táctica SVG para ${basemapId}/${z}/${x}/${y}:`, err);
    }

    const svgTile = buildTacticalSvgTile(basemapId, z, x, y, tileId);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    return res.status(200).send(svgTile);
}

router.post('/resolve', requireAuth, mutationRateLimiter, resolveGeoHandler);
router.post('/report-stamp', requireAuth, mutationRateLimiter, createGeoReportStampHandler);
router.get('/pmtiles/:basemapId/metadata', requireAuth, getPmtilesMetadataHandler);
router.get('/pmtiles/:basemapId/tile/:z/:x/:y', requireAuth, getPmtilesTileHandler);

export { router as geoRoutes };
export default router;
