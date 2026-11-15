import type { CanonicalGeoFix } from '../../contracts/geo.contracts';
import { buildCanonicalGeoFix } from './wgs84UtmProjection';

/**
 * MINREPORT EXIF GPS EXTRACTOR (Edge / PWA / Offline)
 * Lee máximo 256 KB de cabecera JPEG/APP1, soporta TIFF II (little-endian) y MM (big-endian),
 * sigue GPSInfoIFDPointer (0x8825) y extrae tags 0x0001..0x0007, 0x000B y 0x001D.
 * Nunca lanza excepciones ante PNG, PDF, binarios truncados o JPEGs sin GPS.
 */

const MAX_EXIF_HEADER_BYTES = 256 * 1024;
const TIFF_TYPE_SIZES: Record<number, number> = {
    1: 1, // BYTE
    2: 1, // ASCII
    3: 2, // SHORT
    4: 4, // LONG
    5: 8, // RATIONAL
    7: 1, // UNDEFINED
    9: 4, // SLONG
    10: 8, // SRATIONAL
};

async function readLeadingBytes(
    input: Blob | ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
    if (input instanceof Uint8Array) {
        return input.subarray(0, Math.min(input.byteLength, MAX_EXIF_HEADER_BYTES));
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input, 0, Math.min(input.byteLength, MAX_EXIF_HEADER_BYTES));
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
        const sliced = input.slice(0, MAX_EXIF_HEADER_BYTES);
        const buf = await sliced.arrayBuffer();
        return new Uint8Array(buf);
    }
    return new Uint8Array(0);
}

function readAsciiTag(
    view: DataView,
    valueOffset: number,
    count: number
): string {
    const safeCount = Math.min(count, Math.max(0, view.byteLength - valueOffset));
    let out = '';
    for (let i = 0; i < safeCount; i++) {
        const code = view.getUint8(valueOffset + i);
        if (code === 0) break;
        out += String.fromCharCode(code);
    }
    return out.trim();
}

function readRationals(
    view: DataView,
    valueOffset: number,
    count: number,
    littleEndian: boolean,
    signed: boolean
): number[] {
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
        const off = valueOffset + i * 8;
        if (off + 8 > view.byteLength) break;
        const num = signed
            ? view.getInt32(off, littleEndian)
            : view.getUint32(off, littleEndian);
        const den = signed
            ? view.getInt32(off + 4, littleEndian)
            : view.getUint32(off + 4, littleEndian);
        if (den === 0) return [];
        values.push(num / den);
    }
    return values;
}

function resolveEntryDataOffset(
    view: DataView,
    entryOffset: number,
    type: number,
    count: number,
    littleEndian: boolean
): { dataOffset: number; totalBytes: number } | null {
    const unitSize = TIFF_TYPE_SIZES[type];
    if (!unitSize || count <= 0 || count > 1024) return null;
    const totalBytes = unitSize * count;
    const inlineValuePos = entryOffset + 8;
    if (inlineValuePos + 4 > view.byteLength) return null;

    if (totalBytes <= 4) {
        return { dataOffset: inlineValuePos, totalBytes };
    }

    const ptr = view.getUint32(inlineValuePos, littleEndian);
    if (ptr + totalBytes > view.byteLength) return null;
    return { dataOffset: ptr, totalBytes };
}

function buildIsoTimestampFromGps(
    dateStamp: string | null,
    timeComponents: number[] | null
): string {
    if (dateStamp) {
        const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(dateStamp);
        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const hh = timeComponents && Number.isFinite(timeComponents[0]) ? Math.trunc(timeComponents[0]) : 0;
            const mm = timeComponents && Number.isFinite(timeComponents[1]) ? Math.trunc(timeComponents[1]) : 0;
            const ss = timeComponents && Number.isFinite(timeComponents[2]) ? Math.floor(timeComponents[2]) : 0;
            const ms =
                timeComponents && Number.isFinite(timeComponents[2])
                    ? Math.round((timeComponents[2] - Math.floor(timeComponents[2])) * 1000)
                    : 0;
            const dt = new Date(Date.UTC(year, month - 1, day, hh, mm, ss, ms));
            if (!Number.isNaN(dt.getTime()) && year >= 1980 && year <= 2100) {
                return dt.toISOString();
            }
        }
    }
    return new Date().toISOString();
}

function parseTiffBlockForGps(
    bytes: Uint8Array,
    tiffStart: number,
    tiffEnd: number
): CanonicalGeoFix | null {
    if (tiffStart + 8 > tiffEnd || tiffEnd > bytes.byteLength) return null;

    const b0 = bytes[tiffStart];
    const b1 = bytes[tiffStart + 1];
    let littleEndian: boolean;
    if (b0 === 0x49 && b1 === 0x49) {
        littleEndian = true; // II
    } else if (b0 === 0x4d && b1 === 0x4d) {
        littleEndian = false; // MM
    } else {
        return null;
    }

    const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + tiffStart,
        tiffEnd - tiffStart
    );

    if (view.getUint16(2, littleEndian) !== 0x002a) return null;
    const ifd0Offset = view.getUint32(4, littleEndian);
    if (ifd0Offset + 2 > view.byteLength) return null;

    const ifd0Count = view.getUint16(ifd0Offset, littleEndian);
    if (ifd0Count > 2048) return null;

    let gpsIfdOffset: number | null = null;
    for (let i = 0; i < ifd0Count; i++) {
        const entryOff = ifd0Offset + 2 + i * 12;
        if (entryOff + 12 > view.byteLength) break;
        const tag = view.getUint16(entryOff, littleEndian);
        if (tag === 0x8825) {
            gpsIfdOffset = view.getUint32(entryOff + 8, littleEndian);
            break;
        }
    }

    if (gpsIfdOffset === null || gpsIfdOffset + 2 > view.byteLength) {
        return null;
    }

    const gpsCount = view.getUint16(gpsIfdOffset, littleEndian);
    if (gpsCount === 0 || gpsCount > 512) return null;

    let latRef: string | null = null;
    let latDms: number[] | null = null;
    let lngRef: string | null = null;
    let lngDms: number[] | null = null;
    let altRef = 0;
    let altitudeM: number | null = null;
    let gpsTime: number[] | null = null;
    let gpsDop: number | null = null;
    let gpsDate: string | null = null;

    for (let i = 0; i < gpsCount; i++) {
        const entryOff = gpsIfdOffset + 2 + i * 12;
        if (entryOff + 12 > view.byteLength) break;

        const tag = view.getUint16(entryOff, littleEndian);
        const type = view.getUint16(entryOff + 2, littleEndian);
        const count = view.getUint32(entryOff + 4, littleEndian);
        const resolved = resolveEntryDataOffset(view, entryOff, type, count, littleEndian);
        if (!resolved) continue;

        const { dataOffset } = resolved;

        switch (tag) {
            case 0x0001: {
                const txt = readAsciiTag(view, dataOffset, count).toUpperCase();
                if (txt.startsWith('N') || txt.startsWith('S')) {
                    latRef = txt[0];
                }
                break;
            }
            case 0x0002: {
                if ((type === 5 || type === 10) && count >= 3) {
                    const vals = readRationals(view, dataOffset, 3, littleEndian, type === 10);
                    if (vals.length === 3) latDms = vals;
                }
                break;
            }
            case 0x0003: {
                const txt = readAsciiTag(view, dataOffset, count).toUpperCase();
                if (txt.startsWith('E') || txt.startsWith('W')) {
                    lngRef = txt[0];
                }
                break;
            }
            case 0x0004: {
                if ((type === 5 || type === 10) && count >= 3) {
                    const vals = readRationals(view, dataOffset, 3, littleEndian, type === 10);
                    if (vals.length === 3) lngDms = vals;
                }
                break;
            }
            case 0x0005: {
                altRef = view.getUint8(dataOffset);
                break;
            }
            case 0x0006: {
                if ((type === 5 || type === 10) && count >= 1) {
                    const vals = readRationals(view, dataOffset, 1, littleEndian, type === 10);
                    if (vals.length === 1 && Number.isFinite(vals[0])) {
                        altitudeM = vals[0];
                    }
                }
                break;
            }
            case 0x0007: {
                if ((type === 5 || type === 10) && count >= 3) {
                    const vals = readRationals(view, dataOffset, 3, littleEndian, type === 10);
                    if (vals.length === 3) gpsTime = vals;
                }
                break;
            }
            case 0x000b: {
                if ((type === 5 || type === 10) && count >= 1) {
                    const vals = readRationals(view, dataOffset, 1, littleEndian, type === 10);
                    if (vals.length === 1 && Number.isFinite(vals[0]) && vals[0] >= 0) {
                        gpsDop = vals[0];
                    }
                }
                break;
            }
            case 0x001d: {
                gpsDate = readAsciiTag(view, dataOffset, count);
                break;
            }
            default:
                break;
        }
    }

    if (!latDms || !lngDms || !latRef || !lngRef) {
        return null;
    }

    const rawLat = Math.abs(latDms[0]) + latDms[1] / 60 + latDms[2] / 3600;
    const rawLng = Math.abs(lngDms[0]) + lngDms[1] / 60 + lngDms[2] / 3600;

    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
        return null;
    }

    const lat = latRef === 'S' ? -rawLat : rawLat;
    const lng = lngRef === 'W' ? -rawLng : rawLng;

    if (lat < -80 || lat > 84 || lng < -180 || lng > 180) {
        return null;
    }

    const signedAltitude =
        altitudeM !== null
            ? altRef === 1
                ? -Math.abs(altitudeM)
                : altitudeM
            : null;

    const accuracyM =
        gpsDop !== null && Number.isFinite(gpsDop) && gpsDop > 0
            ? Math.min(100000, Number((gpsDop * 5).toFixed(2)))
            : null;

    return buildCanonicalGeoFix({
        lat,
        lng,
        altitudeM: signedAltitude,
        accuracyM,
        capturedAt: buildIsoTimestampFromGps(gpsDate, gpsTime),
        source: 'EXIF_CAS_PHOTO',
    });
}

export async function extractExifGeoFix(
    input: Blob | ArrayBuffer | Uint8Array
): Promise<CanonicalGeoFix | null> {
    try {
        const bytes = await readLeadingBytes(input);
        if (bytes.byteLength < 12) return null;

        // Verificar cabecera JPEG SOI (0xFFD8)
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
            return null;
        }

        let pos = 2;
        while (pos + 1 < bytes.byteLength) {
            if (bytes[pos] !== 0xff) {
                pos++;
                continue;
            }
            while (pos < bytes.byteLength && bytes[pos] === 0xff) {
                pos++;
            }
            if (pos >= bytes.byteLength) break;

            const marker = bytes[pos++];
            if (marker === 0xd9 || marker === 0xda) {
                break; // EOI o SOS
            }
            if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                continue;
            }
            if (pos + 2 > bytes.byteLength) break;

            const segLen = (bytes[pos] << 8) | bytes[pos + 1];
            if (segLen < 2 || pos + segLen > bytes.byteLength) break;

            // APP1 (0xFFE1) con firma 'Exif\0\0'
            if (marker === 0xe1 && segLen >= 8) {
                const payloadStart = pos + 2;
                if (
                    bytes[payloadStart] === 0x45 &&
                    bytes[payloadStart + 1] === 0x78 &&
                    bytes[payloadStart + 2] === 0x69 &&
                    bytes[payloadStart + 3] === 0x66 &&
                    bytes[payloadStart + 4] === 0x00 &&
                    bytes[payloadStart + 5] === 0x00
                ) {
                    const fix = parseTiffBlockForGps(
                        bytes,
                        payloadStart + 6,
                        pos + segLen
                    );
                    if (fix) return fix;
                }
            }

            pos += segLen;
        }

        return null;
    } catch {
        return null;
    }
}
