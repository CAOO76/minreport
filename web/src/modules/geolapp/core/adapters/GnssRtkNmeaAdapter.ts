import {
    resolveUtmLatitudeBand,
    wgs84ToUtm,
} from '../../../../core/geo/wgs84UtmProjection';
import type {
    GnssFixQualityCode,
    GnssRtkFixRecord,
    ISurfaceSourceAdapter,
    SurfaceAdapterParseOptions,
} from './ISurfaceSourceAdapter';

interface WebSerialPortLike {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
}

interface NavigatorWithWebSerial {
    serial?: {
        requestPort?: () => Promise<WebSerialPortLike>;
    };
}

const GGA_QUALITY_MAP: Record<number, GnssFixQualityCode> = {
    0: 'INVALID',
    1: 'GPS_SPS',
    2: 'DGPS',
    3: 'PPS',
    4: 'RTK_FIXED',
    5: 'RTK_FLOAT',
    6: 'ESTIMATED',
};

const FIX_PRIORITY_ORDER: Record<GnssFixQualityCode, number> = {
    RTK_FIXED: 6,
    RTK_FLOAT: 5,
    DGPS: 4,
    PPS: 3,
    GPS_SPS: 2,
    ESTIMATED: 1,
    INVALID: 0,
};

function verifyNmeaChecksum(rawLine: string): string | null {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('$')) return null;

    const starIdx = trimmed.indexOf('*');
    if (starIdx <= 1) return null;

    const hexExpected = trimmed.slice(starIdx + 1).trim();
    if (!/^[0-9A-Fa-f]{2}$/.test(hexExpected)) return null;

    let xor = 0;
    for (let i = 1; i < starIdx; i++) {
        xor ^= trimmed.charCodeAt(i);
    }

    const hexComputed = (xor & 0xff).toString(16).toUpperCase().padStart(2, '0');
    if (hexComputed !== hexExpected.toUpperCase()) {
        return null;
    }

    return trimmed.slice(1, starIdx);
}

function parseNmeaLatLon(coordStr: string, hemiStr: string, isLon: boolean): number | null {
    const coord = coordStr.trim();
    const hemi = hemiStr.trim().toUpperCase();
    if (!coord || !hemi) return null;

    if (isLon && hemi !== 'E' && hemi !== 'W') return null;
    if (!isLon && hemi !== 'N' && hemi !== 'S') return null;

    if (!/^\d+(\.\d+)?$/.test(coord)) return null;

    const dotIdx = coord.indexOf('.');
    const intPartLen = dotIdx >= 0 ? dotIdx : coord.length;
    const minDigitsBeforeDot = isLon ? 5 : 4;
    if (intPartLen < minDigitsBeforeDot) return null;

    const degLen = intPartLen - 2;
    const degrees = Number.parseInt(coord.slice(0, degLen), 10);
    const minutes = Number.parseFloat(coord.slice(degLen));

    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes < 0 || minutes >= 60) {
        return null;
    }

    let decimal = degrees + minutes / 60;
    if (hemi === 'S' || hemi === 'W') {
        decimal = -decimal;
    }

    if (isLon && (decimal < -180 || decimal > 180)) return null;
    if (!isLon && (decimal < -90 || decimal > 90)) return null;

    return Number(decimal.toFixed(8));
}

function parseOptionalFiniteFloat(raw?: string): number | null {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const num = Number.parseFloat(trimmed);
    return Number.isFinite(num) ? num : null;
}

function formatNmeaUtcTimestamp(timeStr?: string, dateStr?: string): string | null {
    const t = String(timeStr || '').trim();
    if (!/^\d{6}(\.\d+)?$/.test(t)) return null;

    const hh = Number.parseInt(t.slice(0, 2), 10);
    const mm = Number.parseInt(t.slice(2, 4), 10);
    const ssFloat = Number.parseFloat(t.slice(4));
    if (hh > 23 || mm > 59 || ssFloat >= 60) return null;

    const timeFormatted = `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}`;
    const d = String(dateStr || '').trim();
    if (/^\d{6}$/.test(d)) {
        const day = d.slice(0, 2);
        const month = d.slice(2, 4);
        const yy = Number.parseInt(d.slice(4, 6), 10);
        const yyyy = yy >= 80 ? 1900 + yy : 2000 + yy;
        return `${yyyy}-${month}-${day}T${timeFormatted}Z`;
    }

    return `${timeFormatted}Z`;
}

function mapRmcModeToQuality(posModeRaw?: string): { code: number; label: GnssFixQualityCode } | null {
    const mode = String(posModeRaw || '').trim().toUpperCase();
    if (!mode || mode === 'A') return { code: 1, label: 'GPS_SPS' };
    if (mode === 'D') return { code: 2, label: 'DGPS' };
    if (mode === 'P') return { code: 3, label: 'PPS' };
    if (mode === 'R') return { code: 4, label: 'RTK_FIXED' };
    if (mode === 'F') return { code: 5, label: 'RTK_FLOAT' };
    if (mode === 'E') return { code: 6, label: 'ESTIMATED' };
    if (mode === 'N') return null;
    return { code: 1, label: 'GPS_SPS' };
}

export function isWebSerialSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as unknown as NavigatorWithWebSerial;
    return Boolean(nav.serial && typeof nav.serial.requestPort === 'function');
}

/**
 * Parsea y valida una trama NMEA-0183 (`$xxGGA` o `$xxRMC`) verificando checksum XOR `*HH`
 * y proyectando coordenadas válidas a `SIRGAS-Chile / WGS84` UTM.
 */
export function parseNmeaSentence(line: string): GnssRtkFixRecord | null {
    const rawTrimmed = String(line || '').trim();
    const body = verifyNmeaChecksum(rawTrimmed);
    if (!body) return null;

    const fields = body.split(',');
    const header = (fields[0] || '').trim().toUpperCase();
    if (!/^[A-Z]{2}(GGA|RMC)$/.test(header)) {
        return null;
    }

    const sentenceType = header.slice(2) as 'GGA' | 'RMC';

    if (sentenceType === 'GGA') {
        if (fields.length < 10) return null;

        const qualityCode = Number.parseInt((fields[6] || '').trim(), 10);
        const fixQuality = GGA_QUALITY_MAP[qualityCode];
        if (!fixQuality || qualityCode === 0 || fixQuality === 'INVALID') {
            return null;
        }

        const latitude = parseNmeaLatLon(fields[2] || '', fields[3] || '', false);
        const longitude = parseNmeaLatLon(fields[4] || '', fields[5] || '', true);
        if (latitude === null || longitude === null || latitude < -80 || latitude > 84) {
            return null;
        }

        const satellitesRaw = Number.parseInt((fields[7] || '').trim(), 10);
        const satellitesUsed =
            Number.isFinite(satellitesRaw) && satellitesRaw >= 0 ? satellitesRaw : 0;
        const hdop = parseOptionalFiniteFloat(fields[8]);
        const orthometricAltitudeM = parseOptionalFiniteFloat(fields[9]);
        const geoidSeparationM = parseOptionalFiniteFloat(fields[11]);

        try {
            const utm = wgs84ToUtm(latitude, longitude);
            const utmBand = resolveUtmLatitudeBand(latitude);
            const epsg = utm.hemisphere === 'S' ? 32700 + utm.zone : 32600 + utm.zone;

            return {
                sentenceType: 'GGA',
                timestampUtc: formatNmeaUtcTimestamp(fields[1]),
                latitude,
                longitude,
                orthometricAltitudeM,
                geoidSeparationM,
                fixQualityCode: qualityCode,
                fixQuality,
                satellitesUsed,
                hdop,
                utmZone: utm.zone,
                utmBand,
                hemisphere: utm.hemisphere,
                easting: utm.eastingM,
                northing: utm.northingM,
                epsg,
                datum: 'SIRGAS-Chile / WGS84',
                rawSentence: rawTrimmed,
            };
        } catch {
            return null;
        }
    }

    // RMC
    if (fields.length < 8) return null;
    const status = (fields[2] || '').trim().toUpperCase();
    if (status !== 'A') {
        return null;
    }

    const rmcQuality = mapRmcModeToQuality(fields[12]);
    if (!rmcQuality) return null;

    const latitude = parseNmeaLatLon(fields[3] || '', fields[4] || '', false);
    const longitude = parseNmeaLatLon(fields[5] || '', fields[6] || '', true);
    if (latitude === null || longitude === null || latitude < -80 || latitude > 84) {
        return null;
    }

    try {
        const utm = wgs84ToUtm(latitude, longitude);
        const utmBand = resolveUtmLatitudeBand(latitude);
        const epsg = utm.hemisphere === 'S' ? 32700 + utm.zone : 32600 + utm.zone;

        return {
            sentenceType: 'RMC',
            timestampUtc: formatNmeaUtcTimestamp(fields[1], fields[9]),
            latitude,
            longitude,
            orthometricAltitudeM: null,
            geoidSeparationM: null,
            fixQualityCode: rmcQuality.code,
            fixQuality: rmcQuality.label,
            satellitesUsed: 0,
            hdop: null,
            utmZone: utm.zone,
            utmBand,
            hemisphere: utm.hemisphere,
            easting: utm.eastingM,
            northing: utm.northingM,
            epsg,
            datum: 'SIRGAS-Chile / WGS84',
            rawSentence: rawTrimmed,
        };
    } catch {
        return null;
    }
}

function isBetterFix(candidate: GnssRtkFixRecord, currentBest: GnssRtkFixRecord): boolean {
    const rankCand = FIX_PRIORITY_ORDER[candidate.fixQuality] ?? 0;
    const rankBest = FIX_PRIORITY_ORDER[currentBest.fixQuality] ?? 0;
    if (rankCand !== rankBest) {
        return rankCand > rankBest;
    }
    if (candidate.sentenceType !== currentBest.sentenceType) {
        return candidate.sentenceType === 'GGA';
    }
    if (candidate.hdop !== null && currentBest.hdop !== null && candidate.hdop !== currentBest.hdop) {
        return candidate.hdop < currentBest.hdop;
    }
    if (candidate.satellitesUsed !== currentBest.satellitesUsed) {
        return candidate.satellitesUsed > currentBest.satellitesUsed;
    }
    return true;
}

/**
 * Parsea un flujo o archivo NMEA-0183 completo, priorizando fixes `RTK_FIXED` > `RTK_FLOAT` > `DGPS` > `PPS` > `GPS_SPS`.
 */
export function parseNmeaStream(rawText: string): {
    fixes: GnssRtkFixRecord[];
    bestFix: GnssRtkFixRecord | null;
    rejectedCount: number;
} {
    const lines = String(rawText || '').split(/\r?\n/);
    const fixes: GnssRtkFixRecord[] = [];
    let bestFix: GnssRtkFixRecord | null = null;
    let rejectedCount = 0;

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        const parsed = parseNmeaSentence(trimmed);
        if (parsed) {
            fixes.push(parsed);
            if (!bestFix || isBetterFix(parsed, bestFix)) {
                bestFix = parsed;
            }
        } else {
            rejectedCount++;
        }
    }

    return { fixes, bestFix, rejectedCount };
}

export class GnssRtkNmeaAdapter implements ISurfaceSourceAdapter<string, GnssRtkFixRecord[]> {
    public readonly sourceKind = 'GNSS_RTK_NMEA' as const;
    public readonly supportedExtensions = ['.nmea', '.txt', '.log'] as const;

    public canHandle(filenameOrHint: string): boolean {
        const lower = String(filenameOrHint || '').trim().toLowerCase();
        return (
            lower.endsWith('.nmea') ||
            lower.endsWith('.txt') ||
            lower.endsWith('.log') ||
            lower === 'nmea'
        );
    }

    public async parse(
        input: string,
        _options?: SurfaceAdapterParseOptions
    ): Promise<GnssRtkFixRecord[]> {
        if (typeof input !== 'string') {
            throw new Error('GnssRtkNmeaAdapter requiere texto NMEA-0183 válido.');
        }
        return parseNmeaStream(input).fixes;
    }

    public parseStream(rawText: string): {
        fixes: GnssRtkFixRecord[];
        bestFix: GnssRtkFixRecord | null;
        rejectedCount: number;
    } {
        return parseNmeaStream(rawText);
    }

    public async captureFromWebSerial(options?: {
        baudRate?: number;
        timeoutMs?: number;
        maxLines?: number;
    }): Promise<{
        fixes: GnssRtkFixRecord[];
        bestFix: GnssRtkFixRecord | null;
        rejectedCount: number;
        rawBuffer: string;
    }> {
        if (!isWebSerialSupported()) {
            throw new Error('WebSerial API no soportada en este navegador.');
        }

        const nav = navigator as unknown as NavigatorWithWebSerial;
        const port = await nav.serial!.requestPort!();
        const baudRate = options?.baudRate ?? 115200;
        const timeoutMs = options?.timeoutMs ?? 6000;
        const maxLines = options?.maxLines ?? 40;

        await port.open({ baudRate });
        const decoder = new TextDecoder('ascii');
        let rawBuffer = '';
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        const timerId = globalThis.setTimeout(() => {
            reader?.cancel().catch(() => {});
        }, timeoutMs);

        try {
            if (port.readable) {
                reader = port.readable.getReader();
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        rawBuffer += decoder.decode(value, { stream: true });
                        const lineCount = rawBuffer.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
                        if (lineCount >= maxLines) {
                            await reader.cancel().catch(() => {});
                            break;
                        }
                    }
                }
            }
        } finally {
            globalThis.clearTimeout(timerId);
            try {
                reader?.releaseLock();
            } catch {
                // noop
            }
            await port.close().catch(() => {});
        }

        const parsed = parseNmeaStream(rawBuffer);
        return {
            ...parsed,
            rawBuffer,
        };
    }
}

export const gnssRtkNmeaAdapter = new GnssRtkNmeaAdapter();
