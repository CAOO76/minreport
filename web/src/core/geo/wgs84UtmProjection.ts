import type {
    CanonicalGeoFix,
    GeoCaptureSource,
    UtmCoordinate,
    UtmHemisphere,
} from '../../contracts/geo.contracts';

/**
 * MINREPORT SOVEREIGN WGS84 <-> UTM PROJECTION & CRYPTO STAMP KERNEL
 * Implementación TypeScript pura e isomórfica (cero dependencias de Node/browser).
 * Expansión de Karney-Krüger n-series (WGS84, error round-trip < 1 mm) + FIPS 180-4 SHA-256.
 */

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_E = Math.sqrt(WGS84_E2);
const WGS84_N = WGS84_F / (2 - WGS84_F);

const UTM_K0 = 0.9996;
const UTM_FALSE_EASTING = 500000.0;
const UTM_SOUTH_FALSE_NORTHING = 10000000.0;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const UTM_BANDS = 'CDEFGHJKLMNPQRSTUVWX';

const KRUGER_A =
    (WGS84_A / (1 + WGS84_N)) *
    (1 +
        Math.pow(WGS84_N, 2) / 4 +
        Math.pow(WGS84_N, 4) / 64 +
        Math.pow(WGS84_N, 6) / 256);

const ALPHA = [
    0,
    (1 / 2) * WGS84_N -
        (2 / 3) * Math.pow(WGS84_N, 2) +
        (5 / 16) * Math.pow(WGS84_N, 3) +
        (41 / 180) * Math.pow(WGS84_N, 4),
    (13 / 48) * Math.pow(WGS84_N, 2) -
        (3 / 5) * Math.pow(WGS84_N, 3) +
        (557 / 1440) * Math.pow(WGS84_N, 4),
    (61 / 240) * Math.pow(WGS84_N, 3) - (103 / 140) * Math.pow(WGS84_N, 4),
    (49561 / 161280) * Math.pow(WGS84_N, 4),
] as const;

const BETA = [
    0,
    (1 / 2) * WGS84_N -
        (2 / 3) * Math.pow(WGS84_N, 2) +
        (37 / 96) * Math.pow(WGS84_N, 3) -
        (1 / 360) * Math.pow(WGS84_N, 4),
    (1 / 48) * Math.pow(WGS84_N, 2) +
        (1 / 15) * Math.pow(WGS84_N, 3) -
        (437 / 1440) * Math.pow(WGS84_N, 4),
    (17 / 480) * Math.pow(WGS84_N, 3) - (37 / 840) * Math.pow(WGS84_N, 4),
    (4397 / 161280) * Math.pow(WGS84_N, 4),
] as const;

function normalizeLongitude(lng: number): number {
    if (!Number.isFinite(lng)) {
        throw new RangeError('Longitud geográfica inválida.');
    }
    if (lng === 180) return 180;
    return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function resolveUtmLatitudeBand(lat: number): string {
    if (!Number.isFinite(lat) || lat < -80 || lat > 84) {
        throw new RangeError(`Latitud fuera de cobertura UTM [-80, 84]: ${lat}`);
    }
    if (lat >= 72) return 'X';
    const idx = Math.floor((lat + 80) / 8);
    return UTM_BANDS[Math.min(Math.max(idx, 0), UTM_BANDS.length - 1)];
}

export function resolveUtmZone(lat: number, lng: number): number {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new RangeError(`Latitud inválida: ${lat}`);
    }
    const lon = normalizeLongitude(lng);

    // Excepción Noruega (32V): 56°N..64°N, 3°E..12°E
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) {
        return 32;
    }

    // Excepciones Svalbard (31X/33X/35X/37X): 72°N..84°N
    if (lat >= 72 && lat <= 84) {
        if (lon >= 0 && lon < 9) return 31;
        if (lon >= 9 && lon < 21) return 33;
        if (lon >= 21 && lon < 33) return 35;
        if (lon >= 33 && lon < 42) return 37;
    }

    if (lon === 180) return 60;
    return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
}

export function formatUtmCoordinate(params: {
    zone: number;
    band: string;
    eastingM: number;
    northingM: number;
}): string {
    const zoneStr = String(params.zone).padStart(2, '0');
    const [eInt, eDec] = params.eastingM.toFixed(2).split('.');
    const [nInt, nDec] = params.northingM.toFixed(2).split('.');
    return `${zoneStr}${params.band} ${eInt.padStart(6, '0')}.${eDec} mE ${nInt.padStart(7, '0')}.${nDec} mN`;
}

export function wgs84ToUtm(
    lat: number,
    lng: number,
    forcedZone?: number
): UtmCoordinate {
    if (!Number.isFinite(lat) || lat < -80 || lat > 84) {
        throw new RangeError(`Latitud fuera de rango UTM [-80, 84]: ${lat}`);
    }
    const lon = normalizeLongitude(lng);
    const zone =
        typeof forcedZone === 'number'
            ? Math.min(60, Math.max(1, Math.trunc(forcedZone)))
            : resolveUtmZone(lat, lon);
    const band = resolveUtmLatitudeBand(lat);
    const hemisphere: UtmHemisphere = lat >= 0 ? 'N' : 'S';

    const phi = lat * DEG_TO_RAD;
    const centralMeridianDeg = (zone - 1) * 6 - 180 + 3;
    let deltaLonDeg = lon - centralMeridianDeg;
    if (deltaLonDeg > 180) deltaLonDeg -= 360;
    if (deltaLonDeg < -180) deltaLonDeg += 360;
    const lambda = deltaLonDeg * DEG_TO_RAD;

    const tau = Math.tan(phi);
    const sigma = Math.sinh(
        WGS84_E * Math.atanh((WGS84_E * tau) / Math.sqrt(1 + tau * tau))
    );
    const tauPrime = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);

    const xiPrime = Math.atan2(tauPrime, Math.cos(lambda));
    const etaPrime = Math.asinh(
        Math.sin(lambda) / Math.sqrt(tauPrime * tauPrime + Math.cos(lambda) * Math.cos(lambda))
    );

    let xi = xiPrime;
    let eta = etaPrime;
    for (let j = 1; j <= 4; j++) {
        const twoJXi = 2 * j * xiPrime;
        const twoJEta = 2 * j * etaPrime;
        xi += ALPHA[j] * Math.sin(twoJXi) * Math.cosh(twoJEta);
        eta += ALPHA[j] * Math.cos(twoJXi) * Math.sinh(twoJEta);
    }

    const rawEasting = UTM_FALSE_EASTING + UTM_K0 * KRUGER_A * eta;
    const falseNorthing = hemisphere === 'S' ? UTM_SOUTH_FALSE_NORTHING : 0;
    const rawNorthing = falseNorthing + UTM_K0 * KRUGER_A * xi;

    const eastingM = Number(rawEasting.toFixed(4));
    const northingM = Number(rawNorthing.toFixed(4));
    const epsg = `EPSG:${hemisphere === 'N' ? 32600 + zone : 32700 + zone}`;

    return {
        zone,
        band,
        hemisphere,
        eastingM,
        northingM,
        datum: 'WGS84',
        epsg,
        formatted: formatUtmCoordinate({ zone, band, eastingM, northingM }),
    };
}

export function utmToWgs84(params: {
    zone: number;
    hemisphere: UtmHemisphere;
    eastingM: number;
    northingM: number;
}): { lat: number; lng: number } {
    const { zone, hemisphere, eastingM, northingM } = params;
    if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
        throw new RangeError(`Zona UTM inválida [1..60]: ${zone}`);
    }
    if (!Number.isFinite(eastingM) || !Number.isFinite(northingM)) {
        throw new RangeError('Coordenadas métricas UTM inválidas.');
    }

    const falseNorthing = hemisphere === 'S' ? UTM_SOUTH_FALSE_NORTHING : 0;
    const eta = (eastingM - UTM_FALSE_EASTING) / (UTM_K0 * KRUGER_A);
    const xi = (northingM - falseNorthing) / (UTM_K0 * KRUGER_A);

    let xiPrime = xi;
    let etaPrime = eta;
    for (let j = 1; j <= 4; j++) {
        const twoJXi = 2 * j * xi;
        const twoJEta = 2 * j * eta;
        xiPrime -= BETA[j] * Math.sin(twoJXi) * Math.cosh(twoJEta);
        etaPrime -= BETA[j] * Math.cos(twoJXi) * Math.sinh(twoJEta);
    }

    const sinhEtaPrime = Math.sinh(etaPrime);
    const cosXiPrime = Math.cos(xiPrime);
    const tauPrime =
        Math.sin(xiPrime) / Math.sqrt(sinhEtaPrime * sinhEtaPrime + cosXiPrime * cosXiPrime);

    // Newton-Raphson para recuperar tau = tan(phi) desde tauPrime = tan(chi)
    let tau = tauPrime;
    const oneMinusE2 = 1 - WGS84_E2;
    for (let iter = 0; iter < 6; iter++) {
        const sigma = Math.sinh(
            WGS84_E * Math.atanh((WGS84_E * tau) / Math.sqrt(1 + tau * tau))
        );
        const tauCurrent =
            tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
        const dTau =
            ((tauPrime - tauCurrent) / Math.sqrt(1 + tauCurrent * tauCurrent)) *
            ((1 + oneMinusE2 * tau * tau) / (oneMinusE2 * Math.sqrt(1 + tau * tau)));
        tau += dTau;
        if (Math.abs(dTau) < 1e-15) break;
    }

    const phi = Math.atan(tau);
    const deltaLambda = Math.atan2(sinhEtaPrime, cosXiPrime);
    const centralMeridianDeg = (zone - 1) * 6 - 180 + 3;

    const lat = phi * RAD_TO_DEG;
    const lng = normalizeLongitude(centralMeridianDeg + deltaLambda * RAD_TO_DEG);

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

export function buildCanonicalGeoFix(input: BuildCanonicalGeoFixInput): CanonicalGeoFix {
    if (!Number.isFinite(input.lat) || input.lat < -80 || input.lat > 84) {
        throw new RangeError(`Latitud fuera de rango geodésico UTM [-80, 84]: ${input.lat}`);
    }
    const lng = normalizeLongitude(input.lng);
    const lat = Number(input.lat.toFixed(8));
    const normalizedLng = Number(lng.toFixed(8));
    const utm = wgs84ToUtm(lat, normalizedLng, input.forcedZone);

    const fix: CanonicalGeoFix = {
        lat,
        lng: normalizedLng,
        altitudeM:
            typeof input.altitudeM === 'number' && Number.isFinite(input.altitudeM)
                ? Math.min(12000, Math.max(-1000, Number(input.altitudeM.toFixed(2))))
                : null,
        accuracyM:
            typeof input.accuracyM === 'number' &&
            Number.isFinite(input.accuracyM) &&
            input.accuracyM >= 0
                ? Math.min(100000, Number(input.accuracyM.toFixed(2)))
                : null,
        capturedAt:
            typeof input.capturedAt === 'string' && input.capturedAt.length >= 10
                ? input.capturedAt
                : new Date().toISOString(),
        source: input.source,
        srid: 'EPSG:4326',
        utm,
    };

    if (
        typeof input.headingDeg === 'number' &&
        Number.isFinite(input.headingDeg) &&
        input.headingDeg >= 0 &&
        input.headingDeg <= 360
    ) {
        fix.headingDeg = Number(input.headingDeg.toFixed(2));
    }

    if (
        typeof input.speedMps === 'number' &&
        Number.isFinite(input.speedMps) &&
        input.speedMps >= 0
    ) {
        fix.speedMps = Number(input.speedMps.toFixed(2));
    }

    return fix;
}

// ── FIPS 180-4 SHA-256 Síncrono en TypeScript Puro ────────────────────────────

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

function encodeUtf8Bytes(input: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(input);
    }
    const encoded: number[] = [];
    for (let i = 0; i < input.length; i++) {
        let code = input.charCodeAt(i);
        if (code < 0x80) {
            encoded.push(code);
        } else if (code < 0x800) {
            encoded.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
            const next = input.charCodeAt(++i);
            const cp = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
            encoded.push(
                0xf0 | (cp >> 18),
                0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f)
            );
        } else {
            encoded.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return new Uint8Array(encoded);
}

function rotr(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(input: string): string {
    const msg = encodeUtf8Bytes(input);
    const bitLen = msg.length * 8;
    const paddedLen = Math.ceil((msg.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(msg);
    padded[msg.length] = 0x80;

    const view = new DataView(padded.buffer);
    const highBits = Math.floor(bitLen / 0x100000000);
    const lowBits = bitLen >>> 0;
    view.setUint32(paddedLen - 8, highBits, false);
    view.setUint32(paddedLen - 4, lowBits, false);

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
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
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
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
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

    return [h0, h1, h2, h3, h4, h5, h6, h7]
        .map((part) => part.toString(16).padStart(8, '0'))
        .join('');
}

export interface DeterministicGeoStampHashInput {
    accountId: string;
    moduleId: string;
    entityType: string;
    entityId: string;
    fix: Pick<CanonicalGeoFix, 'lat' | 'lng' | 'source' | 'capturedAt' | 'utm'>;
    label?: string;
}

export function computeDeterministicGeoStampHash(
    params: DeterministicGeoStampHashInput
): string {
    const canonicalPayload = JSON.stringify({
        v: 1,
        accountId: String(params.accountId || '').trim(),
        moduleId: String(params.moduleId || 'core').trim(),
        entityType: String(params.entityType || '').trim(),
        entityId: String(params.entityId || '').trim(),
        lat: Number(params.fix.lat.toFixed(7)),
        lng: Number(params.fix.lng.toFixed(7)),
        utmFormatted: params.fix.utm.formatted,
        epsg: params.fix.utm.epsg,
        source: params.fix.source,
        capturedAt: String(params.fix.capturedAt || '').trim(),
        label: String(params.label || '').trim(),
    });
    return sha256Hex(canonicalPayload);
}

function escapeXmlStrict(value: string): string {
    return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export interface GeoStampVectorSvgOptions {
    label?: string;
    width?: number;
    height?: number;
    scaleLabel?: string;
}

export function buildGeoStampVectorSvg(
    fix: CanonicalGeoFix,
    options: GeoStampVectorSvgOptions = {}
): string {
    const w = Math.max(240, Math.min(800, Math.trunc(options.width ?? 360)));
    const h = Math.max(160, Math.min(600, Math.trunc(options.height ?? 220)));
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2) - 6;

    const rawLabel = (options.label || 'PUNTO DE CONTROL GEORREFERENCIADO').trim().slice(0, 72);
    const safeLabel = escapeXmlStrict(rawLabel);
    const safeUtm = escapeXmlStrict(fix.utm.formatted);
    const safeWgs = escapeXmlStrict(`${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`);
    const safeEpsg = escapeXmlStrict(`${fix.srid} / ${fix.utm.epsg}`);
    const safeSource = escapeXmlStrict(fix.source);
    const accuracyMeters = typeof fix.accuracyM === 'number' ? fix.accuracyM : 15;
    const ringRadius = Math.max(14, Math.min(48, Math.round(14 + Math.log10(Math.max(1, accuracyMeters)) * 14)));
    const scaleText = escapeXmlStrict(
        options.scaleLabel || (accuracyMeters > 100 ? '500 m' : '100 m')
    );

    const gridLines: string[] = [];
    for (let x = 24; x < w; x += 32) {
        gridLines.push(
            `<line x1="${x}" y1="24" x2="${x}" y2="${h - 42}" stroke="#12151C" stroke-width="1"/>`
        );
    }
    for (let y = 24; y <= h - 42; y += 32) {
        gridLines.push(
            `<line x1="12" y1="${y}" x2="${w - 12}" y2="${y}" stroke="#12151C" stroke-width="1"/>`
        );
    }

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${safeLabel}">`,
        `<rect x="0" y="0" width="${w}" height="${h}" fill="#07090D" stroke="#12151C" stroke-width="1"/>`,
        ...gridLines,
        `<rect x="12" y="24" width="${w - 24}" height="${h - 66}" fill="none" stroke="#12151C" stroke-width="1"/>`,
        `<text x="12" y="16" fill="#C68346" font-family="Atkinson Hyperlegible Mono, monospace" font-size="9" font-weight="700" letter-spacing="0.06em">${safeLabel}</text>`,
        `<text x="${w - 12}" y="16" text-anchor="end" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="9">${safeEpsg}</text>`,
        `<g transform="translate(${w - 28}, 40)">`,
        `<polygon points="0,-10 5,4 0,1 -5,4" fill="#00AEEF"/>`,
        `<text x="0" y="14" text-anchor="middle" fill="#F3F4F6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="8" font-weight="700">N</text>`,
        `</g>`,
        `<circle cx="${cx}" cy="${cy}" r="${ringRadius}" fill="#00AEEF" fill-opacity="0.10" stroke="#00AEEF" stroke-width="1" stroke-dasharray="3 2"/>`,
        `<line x1="${cx - 18}" y1="${cy}" x2="${cx + 18}" y2="${cy}" stroke="#C68346" stroke-width="1"/>`,
        `<line x1="${cx}" y1="${cy - 18}" x2="${cx}" y2="${cy + 18}" stroke="#C68346" stroke-width="1"/>`,
        `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="#C68346" stroke="#07090D" stroke-width="1"/>`,
        `<g transform="translate(20, ${h - 52})">`,
        `<line x1="0" y1="0" x2="54" y2="0" stroke="#00AEEF" stroke-width="2"/>`,
        `<line x1="0" y1="-4" x2="0" y2="4" stroke="#00AEEF" stroke-width="1"/>`,
        `<line x1="54" y1="-4" x2="54" y2="4" stroke="#00AEEF" stroke-width="1"/>`,
        `<text x="27" y="-5" text-anchor="middle" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="8">${scaleText}</text>`,
        `</g>`,
        `<text x="12" y="${h - 24}" fill="#F3F4F6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="9" font-weight="700">UTM ${safeUtm}</text>`,
        `<text x="12" y="${h - 10}" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="8">WGS84 ${safeWgs} · ${safeSource}</text>`,
        `</svg>`,
    ].join('');
}
