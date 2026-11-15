import type {
    CanonicalGeoFix,
    GeoCaptureSource,
    GeoReportStampModule,
    UtmCoordinate,
    UtmHemisphere,
} from '../../contracts/geo.contracts';

/**
 * NÚCLEO GEOESPACIAL SOBERANO WGS84 <-> UTM (EPSG:4326 <-> EPSG:326xx/327xx)
 *
 * Implementación TypeScript pura 100% isomórfica (cero dependencias Node `crypto`/`fs`).
 * Utiliza el elipsoide WGS84 oficial con expansión de Krüger / Karney de 4º orden
 * (error round-trip < 1 mm incluso en excepciones de zona amplias como 32V y 33X).
 */

export const WGS84_A = 6378137.0;
export const WGS84_INV_F = 298.257223563;
export const WGS84_F = 1 / WGS84_INV_F;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
export const WGS84_E = Math.sqrt(WGS84_E2);

export const UTM_K0 = 0.9996;
export const UTM_FALSE_EASTING = 500000.0;
export const UTM_SOUTH_FALSE_NORTHING = 10000000.0;

const UTM_BANDS = 'CDEFGHJKLMNPQRSTUVWX';

// Tercer achatamiento de Bessel n = f / (2 - f)
const N1 = WGS84_F / (2 - WGS84_F);
const N2 = N1 * N1;
const N3 = N2 * N1;
const N4 = N3 * N1;
const N5 = N4 * N1;
const N6 = N5 * N1;

// Radio de arco meridiano rectificado A (Karney 2011)
const KRUGER_A = (WGS84_A / (1 + N1)) * (1 + N2 / 4 + N4 / 64 + N6 / 256);

// Coeficientes directos de Krüger (lat/lng -> UTM)
const ALPHA_1 = 0.5 * N1 - (2 / 3) * N2 + (5 / 16) * N3 + (41 / 180) * N4;
const ALPHA_2 = (13 / 48) * N2 - (3 / 5) * N3 + (557 / 1440) * N4;
const ALPHA_3 = (61 / 240) * N3 - (103 / 140) * N4;
const ALPHA_4 = (49561 / 161280) * N4;

// Coeficientes inversos de Krüger (UTM -> lat/lng)
const BETA_1 = 0.5 * N1 - (2 / 3) * N2 + (37 / 96) * N3 - (1 / 360) * N4;
const BETA_2 = (1 / 48) * N2 + (1 / 15) * N3 - (437 / 1440) * N4;
const BETA_3 = (17 / 480) * N3 - (37 / 840) * N4;
const BETA_4 = (4397 / 161280) * N4;

function degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
    return (rad * 180) / Math.PI;
}

function atanhSafe(x: number): number {
    const clamped = Math.max(-0.999999999999, Math.min(0.999999999999, x));
    return 0.5 * Math.log((1 + clamped) / (1 - clamped));
}

function normalizeLongitudeDeg(lng: number): number {
    if (lng === 180) return 180;
    const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 && lng > 0 ? 180 : wrapped;
}

/**
 * Resuelve la banda latitudinal UTM (C..X excluyendo I y O), válida para [-80, 84] grados.
 */
export function resolveUtmLatitudeBand(lat: number): string {
    if (!Number.isFinite(lat) || lat < -80 || lat > 84) {
        throw new RangeError(`Latitud fuera de rango UTM válido (-80..84): ${lat}`);
    }
    if (lat >= 72) {
        return 'X';
    }
    const index = Math.floor((lat + 80) / 8);
    return UTM_BANDS[Math.max(0, Math.min(UTM_BANDS.length - 1, index))];
}

/**
 * Resuelve el huso UTM (1..60) incluyendo las excepciones cartográficas oficiales
 * de Noruega (32V) y archipiélago de Svalbard (31X, 33X, 35X, 37X).
 */
export function resolveUtmZone(lat: number, lng: number): number {
    if (!Number.isFinite(lat) || lat < -80 || lat > 84) {
        throw new RangeError(`Latitud fuera de rango UTM válido (-80..84): ${lat}`);
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new RangeError(`Longitud fuera de rango válido (-180..180): ${lng}`);
    }

    const normLng = lng === 180 ? 179.999999 : normalizeLongitudeDeg(lng);
    let zone = Math.floor((normLng + 180) / 6) + 1;
    zone = Math.max(1, Math.min(60, zone));

    // Excepción Noruega (banda V: 56°N..64°N, longitudes 3°E..12°E -> zona 32V)
    if (lat >= 56 && lat < 64 && normLng >= 3 && normLng < 12) {
        return 32;
    }

    // Excepción Svalbard (banda X: 72°N..84°N)
    if (lat >= 72 && lat <= 84) {
        if (normLng >= 0 && normLng < 9) return 31;
        if (normLng >= 9 && normLng < 21) return 33;
        if (normLng >= 21 && normLng < 33) return 35;
        if (normLng >= 33 && normLng < 42) return 37;
    }

    return zone;
}

/**
 * Formatea una coordenada UTM con padding estricto (`ZZB EEEEEE.dd mE NNNNNNN.dd mN`).
 */
export function formatUtmCoordinate(input: {
    zone: number;
    band: string;
    eastingM: number;
    northingM: number;
}): string {
    const zoneStr = String(Math.trunc(input.zone)).padStart(2, '0');
    const bandStr = String(input.band || '').trim().toUpperCase();

    const formatMeters = (value: number, intDigits: number): string => {
        const fixed = Math.max(0, value).toFixed(2);
        const dotIdx = fixed.indexOf('.');
        const intPart = dotIdx >= 0 ? fixed.slice(0, dotIdx) : fixed;
        const decPart = dotIdx >= 0 ? fixed.slice(dotIdx + 1) : '00';
        return `${intPart.padStart(intDigits, '0')}.${decPart}`;
    };

    const eastingStr = formatMeters(input.eastingM, 6);
    const northingStr = formatMeters(input.northingM, 7);
    return `${zoneStr}${bandStr} ${eastingStr} mE ${northingStr} mN`;
}

/**
 * Proyecta coordenadas geodésicas WGS84 (EPSG:4326) a UTM (EPSG:326xx / EPSG:327xx).
 */
export function wgs84ToUtm(lat: number, lng: number, forcedZone?: number): UtmCoordinate {
    if (!Number.isFinite(lat) || lat < -80 || lat > 84) {
        throw new RangeError(`Latitud fuera de rango UTM válido (-80..84): ${lat}`);
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new RangeError(`Longitud fuera de rango válido (-180..180): ${lng}`);
    }

    const zone =
        typeof forcedZone === 'number' && Number.isInteger(forcedZone) && forcedZone >= 1 && forcedZone <= 60
            ? forcedZone
            : resolveUtmZone(lat, lng);
    const band = resolveUtmLatitudeBand(lat);
    const hemisphere: UtmHemisphere = lat >= 0 ? 'N' : 'S';

    const centralMeridianDeg = (zone - 1) * 6 - 180 + 3;
    let deltaLambdaDeg = lng - centralMeridianDeg;
    if (deltaLambdaDeg > 180) deltaLambdaDeg -= 360;
    if (deltaLambdaDeg < -180) deltaLambdaDeg += 360;

    const phi = degToRad(lat);
    const lambda = degToRad(deltaLambdaDeg);

    const tau = Math.tan(phi);
    const sigma = Math.sinh(WGS84_E * atanhSafe((WGS84_E * tau) / Math.sqrt(1 + tau * tau)));
    const tauPrime = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);

    const cosLambda = Math.cos(lambda);
    const sinLambda = Math.sin(lambda);

    const xiPrime = Math.atan2(tauPrime, cosLambda);
    const etaPrime = Math.asinh(sinLambda / Math.hypot(tauPrime, cosLambda));

    const xi =
        xiPrime +
        ALPHA_1 * Math.sin(2 * xiPrime) * Math.cosh(2 * etaPrime) +
        ALPHA_2 * Math.sin(4 * xiPrime) * Math.cosh(4 * etaPrime) +
        ALPHA_3 * Math.sin(6 * xiPrime) * Math.cosh(6 * etaPrime) +
        ALPHA_4 * Math.sin(8 * xiPrime) * Math.cosh(8 * etaPrime);

    const eta =
        etaPrime +
        ALPHA_1 * Math.cos(2 * xiPrime) * Math.sinh(2 * etaPrime) +
        ALPHA_2 * Math.cos(4 * xiPrime) * Math.sinh(4 * etaPrime) +
        ALPHA_3 * Math.cos(6 * xiPrime) * Math.sinh(6 * etaPrime) +
        ALPHA_4 * Math.cos(8 * xiPrime) * Math.sinh(8 * etaPrime);

    const eastingRaw = UTM_FALSE_EASTING + UTM_K0 * KRUGER_A * eta;
    const falseNorthing = hemisphere === 'S' ? UTM_SOUTH_FALSE_NORTHING : 0;
    const northingRaw = falseNorthing + UTM_K0 * KRUGER_A * xi;

    const eastingM = Math.round(eastingRaw * 1e6) / 1e6;
    const northingM = Math.round(northingRaw * 1e6) / 1e6;
    const epsgCode = (hemisphere === 'N' ? 32600 : 32700) + zone;

    return {
        zone,
        band,
        hemisphere,
        eastingM,
        northingM,
        datum: 'WGS84',
        epsg: `EPSG:${epsgCode}`,
        formatted: formatUtmCoordinate({ zone, band, eastingM, northingM }),
    };
}

/**
 * Proyección inversa UTM -> WGS84 (EPSG:4326) mediante expansión inversa de Karney
 * con refinamiento Newton-Raphson (error < 1 mm en round-trip).
 */
export function utmToWgs84(input: {
    zone: number;
    hemisphere: UtmHemisphere;
    eastingM: number;
    northingM: number;
}): { lat: number; lng: number } {
    const { zone, hemisphere, eastingM, northingM } = input;
    if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
        throw new RangeError(`Huso UTM inválido (1..60): ${zone}`);
    }
    if (hemisphere !== 'N' && hemisphere !== 'S') {
        throw new RangeError(`Hemisferio UTM inválido: ${String(hemisphere)}`);
    }
    if (!Number.isFinite(eastingM) || !Number.isFinite(northingM)) {
        throw new RangeError('Coordenadas UTM eastingM/northingM deben ser números finitos.');
    }

    const x = eastingM - UTM_FALSE_EASTING;
    const y = northingM - (hemisphere === 'S' ? UTM_SOUTH_FALSE_NORTHING : 0);

    const xi = y / (UTM_K0 * KRUGER_A);
    const eta = x / (UTM_K0 * KRUGER_A);

    const xiPrime =
        xi -
        (BETA_1 * Math.sin(2 * xi) * Math.cosh(2 * eta) +
            BETA_2 * Math.sin(4 * xi) * Math.cosh(4 * eta) +
            BETA_3 * Math.sin(6 * xi) * Math.cosh(6 * eta) +
            BETA_4 * Math.sin(8 * xi) * Math.cosh(8 * eta));

    const etaPrime =
        eta -
        (BETA_1 * Math.cos(2 * xi) * Math.sinh(2 * eta) +
            BETA_2 * Math.cos(4 * xi) * Math.sinh(4 * eta) +
            BETA_3 * Math.cos(6 * xi) * Math.sinh(6 * eta) +
            BETA_4 * Math.cos(8 * xi) * Math.sinh(8 * eta));

    const sinhEtaPrime = Math.sinh(etaPrime);
    const sinXiPrime = Math.sin(xiPrime);
    const cosXiPrime = Math.cos(xiPrime);

    const tauPrime = sinXiPrime / Math.hypot(sinhEtaPrime, cosXiPrime);
    const deltaLambda = Math.atan2(sinhEtaPrime, cosXiPrime);

    // Inversión exacta de tau' -> tau = tan(phi) mediante Newton-Raphson (6 iteraciones -> ~1e-15)
    let tau = tauPrime;
    const oneMinusE2 = 1 - WGS84_E2;
    for (let i = 0; i < 6; i++) {
        const tauSq = tau * tau;
        const sqrtOnePlusTauSq = Math.sqrt(1 + tauSq);
        const sigma = Math.sinh(WGS84_E * atanhSafe((WGS84_E * tau) / sqrtOnePlusTauSq));
        const tauPrimeEst = tau * Math.sqrt(1 + sigma * sigma) - sigma * sqrtOnePlusTauSq;
        const dTauPrimeDTau =
            (oneMinusE2 * sqrtOnePlusTauSq * Math.sqrt(1 + tauPrimeEst * tauPrimeEst)) /
            (1 + oneMinusE2 * tauSq);
        const deltaTau = (tauPrime - tauPrimeEst) / dTauPrimeDTau;
        tau += deltaTau;
        if (Math.abs(deltaTau) < 1e-15) break;
    }

    const lat = radToDeg(Math.atan(tau));
    const centralMeridianDeg = (zone - 1) * 6 - 180 + 3;
    const lng = normalizeLongitudeDeg(centralMeridianDeg + radToDeg(deltaLambda));

    return { lat, lng };
}

export interface BuildCanonicalGeoFixInput {
    lat: number;
    lng: number;
    altitudeM?: number | null;
    accuracyM?: number | null;
    headingDeg?: number | null;
    speedMps?: number | null;
    capturedAt?: string;
    source: GeoCaptureSource;
    forcedZone?: number;
}

/**
 * Construye una posición canónica dual WGS84 + UTM conforme a `CanonicalGeoFixSchema`.
 */
export function buildCanonicalGeoFix(input: BuildCanonicalGeoFixInput): CanonicalGeoFix {
    const utm = wgs84ToUtm(input.lat, input.lng, input.forcedZone);
    const capturedAt =
        typeof input.capturedAt === 'string' && input.capturedAt.trim().length >= 10
            ? input.capturedAt.trim()
            : new Date().toISOString();

    const altitudeM =
        typeof input.altitudeM === 'number' && Number.isFinite(input.altitudeM)
            ? Math.max(-1000, Math.min(12000, input.altitudeM))
            : null;
    const accuracyM =
        typeof input.accuracyM === 'number' && Number.isFinite(input.accuracyM) && input.accuracyM >= 0
            ? Math.min(100000, input.accuracyM)
            : null;

    const result: CanonicalGeoFix = {
        lat: Number(input.lat),
        lng: Number(input.lng),
        altitudeM,
        accuracyM,
        capturedAt,
        source: input.source,
        srid: 'EPSG:4326',
        utm,
    };

    if (typeof input.headingDeg === 'number' && Number.isFinite(input.headingDeg)) {
        result.headingDeg = Math.max(0, Math.min(360, input.headingDeg));
    } else if (input.headingDeg === null) {
        result.headingDeg = null;
    }

    if (typeof input.speedMps === 'number' && Number.isFinite(input.speedMps) && input.speedMps >= 0) {
        result.speedMps = input.speedMps;
    } else if (input.speedMps === null) {
        result.speedMps = null;
    }

    return result;
}

// ============================================================================
// FIPS 180-4 SHA-256 Síncrono en TypeScript Puro (Isomórfico Node + Browser)
// ============================================================================

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function encodeUtf8Bytes(str: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
            out.push(code);
        } else if (code < 0x800) {
            out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                out.push(
                    0xf0 | (cp >> 18),
                    0x80 | ((cp >> 12) & 0x3f),
                    0x80 | ((cp >> 6) & 0x3f),
                    0x80 | (cp & 0x3f)
                );
                i++;
            } else {
                out.push(0xef, 0xbf, 0xbd);
            }
        } else if (code >= 0xd800 && code <= 0xdfff) {
            out.push(0xef, 0xbf, 0xbd);
        } else {
            out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return new Uint8Array(out);
}

function rotr32(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

/**
 * Implementación síncrona pura FIPS 180-4 SHA-256 sin dependencias externas.
 */
export function sha256Hex(input: string): string {
    const msg = encodeUtf8Bytes(input);
    const bitLen = msg.length * 8;

    const paddedLen = Math.ceil((msg.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(msg);
    padded[msg.length] = 0x80;

    const view = new DataView(padded.buffer);
    const hiBits = Math.floor(bitLen / 0x100000000);
    const loBits = bitLen >>> 0;
    view.setUint32(paddedLen - 8, hiBits, false);
    view.setUint32(paddedLen - 4, loBits, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);

    for (let offset = 0; offset < paddedLen; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;

        for (let i = 0; i < 64; i++) {
            const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
            const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
    }

    const words = [h0, h1, h2, h3, h4, h5, h6, h7];
    return words.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export interface GeoStampHashInput {
    accountId: string;
    moduleId: GeoReportStampModule | string;
    entityType: string;
    entityId: string;
    fix: CanonicalGeoFix;
    label?: string;
}

/**
 * Calcula huella determinista SHA-256 de un sello georreferenciado.
 */
export function computeDeterministicGeoStampHash(input: GeoStampHashInput): string {
    const canonicalPayload = JSON.stringify({
        v: 1,
        accountId: String(input.accountId || '').trim(),
        moduleId: String(input.moduleId || 'core').trim(),
        entityType: String(input.entityType || '').trim(),
        entityId: String(input.entityId || '').trim(),
        lat: Number(input.fix.lat.toFixed(7)),
        lng: Number(input.fix.lng.toFixed(7)),
        utmFormatted: input.fix.utm.formatted,
        epsg: input.fix.utm.epsg,
        source: input.fix.source,
        capturedAt: String(input.fix.capturedAt || '').trim(),
        label: String(input.label || '').trim(),
    });
    return sha256Hex(canonicalPayload);
}

function escapeXmlStrict(raw: string): string {
    return String(raw || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export interface GeoStampSvgOptions {
    label?: string;
    stampId?: string;
    width?: number;
    height?: number;
}

/**
 * Genera el SVG vectorial de recorte cartográfico industrial oscuro para informes técnicos.
 * Aplica escape XML estricto, paleta MINREPORT (#07090D, #12151C, #00AEEF, #C68346),
 * sin scripts, sin handlers `on*` y sin URLs externas.
 */
export function buildGeoStampVectorSvg(fix: CanonicalGeoFix, options: GeoStampSvgOptions = {}): string {
    const width = typeof options.width === 'number' && options.width > 120 ? Math.round(options.width) : 420;
    const height = typeof options.height === 'number' && options.height > 100 ? Math.round(options.height) : 220;

    const rawLabel = (options.label || 'REGISTRO GEORREFERENCIADO').trim().slice(0, 48);
    const safeLabel = escapeXmlStrict(rawLabel);
    const safeStampId = options.stampId ? escapeXmlStrict(options.stampId.slice(0, 36)) : '';
    const safeUtmFormatted = escapeXmlStrict(fix.utm.formatted);
    const safeEpsg = escapeXmlStrict(fix.utm.epsg);
    const safeSource = escapeXmlStrict(fix.source);
    const safeWgs84 = escapeXmlStrict(`${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`);

    const cx = Math.round(width / 2);
    const cy = Math.round(height / 2);

    // Anillo de incertidumbre en #00AEEF proporcional logarítmicamente a accuracyM
    const acc = typeof fix.accuracyM === 'number' && Number.isFinite(fix.accuracyM) ? fix.accuracyM : 15;
    const uncertaintyRadius = Math.max(12, Math.min(44, Math.round(12 + Math.log10(Math.max(1, acc)) * 10)));

    // Escala métrica dinámica
    const scaleMeters = acc <= 15 ? 25 : acc <= 50 ? 50 : acc <= 200 ? 250 : acc <= 1000 ? 1000 : 5000;
    const scaleLabel = scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`;

    const gridLines: string[] = [];
    for (let x = 42; x < width; x += 42) {
        gridLines.push(`<line x1="${x}" y1="30" x2="${x}" y2="${height - 34}" stroke="#12151C" stroke-width="1"/>`);
    }
    for (let y = 34; y < height - 34; y += 34) {
        gridLines.push(`<line x1="1" y1="${y}" x2="${width - 1}" y2="${y}" stroke="#12151C" stroke-width="1"/>`);
    }

    const safeSubId = safeStampId ? `${safeEpsg} · ${safeStampId}` : safeEpsg;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeLabel}">`,
        `<rect x="0" y="0" width="${width}" height="${height}" fill="#07090D"/>`,
        `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#12151C" stroke-width="1"/>`,
        ...gridLines,
        `<rect x="0" y="0" width="${width}" height="30" fill="#030406"/>`,
        `<line x1="0" y1="30" x2="${width}" y2="30" stroke="#12151C" stroke-width="1"/>`,
        `<text x="12" y="19" fill="#F3F4F6" font-family="monospace" font-size="11" font-weight="700">${safeLabel}</text>`,
        `<text x="${width - 12}" y="19" text-anchor="end" fill="#00AEEF" font-family="monospace" font-size="10" font-weight="700">${safeSubId}</text>`,
        `<line x1="${cx - 56}" y1="${cy}" x2="${cx + 56}" y2="${cy}" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="${cx}" y1="${cy - 48}" x2="${cx}" y2="${cy + 48}" stroke="#12151C" stroke-width="1"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${uncertaintyRadius}" fill="#00AEEF" fill-opacity="0.08" stroke="#00AEEF" stroke-width="1.25" stroke-dasharray="4 3"/>`,
        `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="none" stroke="#C68346" stroke-width="1.75"/>`,
        `<rect x="${cx - 2}" y="${cy - 2}" width="4" height="4" fill="#C68346"/>`,
        `<g transform="translate(${width - 34}, 44)">`,
        `<polygon points="10,0 16,18 10,14 4,18" fill="#C68346"/>`,
        `<text x="10" y="30" text-anchor="middle" fill="#F3F4F6" font-family="monospace" font-size="10" font-weight="700">N</text>`,
        `</g>`,
        `<rect x="0" y="${height - 34}" width="${width}" height="34" fill="#030406"/>`,
        `<line x1="0" y1="${height - 34}" x2="${width}" y2="${height - 34}" stroke="#12151C" stroke-width="1"/>`,
        `<line x1="12" y1="${height - 14}" x2="68" y2="${height - 14}" stroke="#8A93A6" stroke-width="1.5"/>`,
        `<line x1="12" y1="${height - 18}" x2="12" y2="${height - 10}" stroke="#8A93A6" stroke-width="1.5"/>`,
        `<line x1="68" y1="${height - 18}" x2="68" y2="${height - 10}" stroke="#8A93A6" stroke-width="1.5"/>`,
        `<text x="74" y="${height - 11}" fill="#8A93A6" font-family="monospace" font-size="10">${scaleLabel}</text>`,
        `<text x="${width - 12}" y="${height - 19}" text-anchor="end" fill="#F3F4F6" font-family="monospace" font-size="10" font-weight="700">${safeUtmFormatted}</text>`,
        `<text x="${width - 12}" y="${height - 7}" text-anchor="end" fill="#8A93A6" font-family="monospace" font-size="9">WGS84 ${safeWgs84} · ${safeSource}</text>`,
        `</svg>`,
    ].join('');
}
