import type { PmtilesHeaderMetadata, PmtilesTileType } from '../../contracts/geo.contracts';

/**
 * MINREPORT PMTILES v3 PURE BINARY PROTOCOL KERNEL (Client / Edge Mirror)
 * Especificación Protomaps PMTiles v3 (cabecera exacta 127 bytes, curva Hilbert, directorios varint).
 * Cero dependencias externas, compatible Browser (Uint8Array / DataView) y Node.
 */

export const PMTILES_V3_HEADER_BYTES = 127;
export const PMTILES_MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73] as const;
export const PMTILES_MAX_ZOOM = 26;
const PMTILES_MAGIC_STR = 'PMTiles';

export type PmtilesCompression = 'UNKNOWN' | 'NONE' | 'GZIP' | 'BROTLI' | 'ZSTD';

export interface PmtilesV3Header extends PmtilesHeaderMetadata {
    rootDirectoryOffset: number;
    rootDirectoryLength: number;
    jsonMetadataOffset: number;
    jsonMetadataLength: number;
    leafDirectoriesOffset: number;
    leafDirectoriesLength: number;
    tileDataOffset: number;
    tileDataLength: number;
    tileEntriesCount: number;
    tileContentsCount: number;
    internalCompression: PmtilesCompression;
    tileCompression: PmtilesCompression;
}

export interface PmtilesDirectoryEntry {
    tileId: number;
    offset: number;
    length: number;
    runLength: number;
}

const COMPRESSION_TO_CODE: Record<PmtilesCompression, number> = {
    UNKNOWN: 0,
    NONE: 1,
    GZIP: 2,
    BROTLI: 3,
    ZSTD: 4,
};

const CODE_TO_COMPRESSION: PmtilesCompression[] = [
    'UNKNOWN',
    'NONE',
    'GZIP',
    'BROTLI',
    'ZSTD',
];

const TILE_TYPE_TO_CODE: Record<PmtilesTileType, number> = {
    UNKNOWN: 0,
    MVT: 1,
    PNG: 2,
    JPEG: 3,
    WEBP: 4,
    AVIF: 5,
};

const CODE_TO_TILE_TYPE: PmtilesTileType[] = [
    'UNKNOWN',
    'MVT',
    'PNG',
    'JPEG',
    'WEBP',
    'AVIF',
];

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
    return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function parsePmtilesV3Header(input: ArrayBuffer | Uint8Array): PmtilesV3Header {
    const bytes = toUint8Array(input);
    if (bytes.byteLength < PMTILES_V3_HEADER_BYTES) {
        throw new Error(
            `Cabecera PMTiles v3 incompleta: esperados ${PMTILES_V3_HEADER_BYTES} bytes, recibidos ${bytes.byteLength}.`
        );
    }

    for (let i = 0; i < PMTILES_MAGIC_STR.length; i++) {
        if (bytes[i] !== PMTILES_MAGIC_STR.charCodeAt(i)) {
            throw new Error('Firma mágica PMTiles inválida.');
        }
    }

    const specVersion = bytes[7];
    if (specVersion !== 3) {
        throw new Error(`Versión PMTiles no soportada: ${specVersion} (se exige v3).`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, PMTILES_V3_HEADER_BYTES);
    const u64 = (offset: number): number => Number(view.getBigUint64(offset, true));

    const internalCompressionCode = bytes[97];
    const tileCompressionCode = bytes[98];
    const tileTypeCode = bytes[99];

    return {
        specVersion: 3,
        rootDirectoryOffset: u64(8),
        rootDirectoryLength: u64(16),
        jsonMetadataOffset: u64(24),
        jsonMetadataLength: u64(32),
        leafDirectoriesOffset: u64(40),
        leafDirectoriesLength: u64(48),
        tileDataOffset: u64(56),
        tileDataLength: u64(64),
        addressedTilesCount: u64(72),
        tileEntriesCount: u64(80),
        tileContentsCount: u64(88),
        clustered: bytes[96] === 1,
        internalCompression: CODE_TO_COMPRESSION[internalCompressionCode] ?? 'UNKNOWN',
        tileCompression: CODE_TO_COMPRESSION[tileCompressionCode] ?? 'UNKNOWN',
        tileType: CODE_TO_TILE_TYPE[tileTypeCode] ?? 'UNKNOWN',
        minZoom: bytes[100],
        maxZoom: bytes[101],
        minLon: view.getInt32(102, true) / 1e7,
        minLat: view.getInt32(106, true) / 1e7,
        maxLon: view.getInt32(110, true) / 1e7,
        maxLat: view.getInt32(114, true) / 1e7,
        centerZoom: bytes[118],
        centerLon: view.getInt32(119, true) / 1e7,
        centerLat: view.getInt32(123, true) / 1e7,
    };
}

export function serializePmtilesV3Header(header: PmtilesV3Header): Uint8Array {
    const out = new Uint8Array(PMTILES_V3_HEADER_BYTES);
    const view = new DataView(out.buffer);

    for (let i = 0; i < PMTILES_MAGIC_STR.length; i++) {
        out[i] = PMTILES_MAGIC_STR.charCodeAt(i);
    }
    out[7] = 3;

    const setU64 = (offset: number, val: number): void => {
        view.setBigUint64(offset, BigInt(Math.max(0, Math.trunc(val))), true);
    };

    setU64(8, header.rootDirectoryOffset);
    setU64(16, header.rootDirectoryLength);
    setU64(24, header.jsonMetadataOffset);
    setU64(32, header.jsonMetadataLength);
    setU64(40, header.leafDirectoriesOffset);
    setU64(48, header.leafDirectoriesLength);
    setU64(56, header.tileDataOffset);
    setU64(64, header.tileDataLength);
    setU64(72, header.addressedTilesCount);
    setU64(80, header.tileEntriesCount);
    setU64(88, header.tileContentsCount);

    out[96] = header.clustered ? 1 : 0;
    out[97] = COMPRESSION_TO_CODE[header.internalCompression] ?? 0;
    out[98] = COMPRESSION_TO_CODE[header.tileCompression] ?? 0;
    out[99] = TILE_TYPE_TO_CODE[header.tileType] ?? 0;
    out[100] = Math.max(0, Math.min(26, Math.trunc(header.minZoom)));
    out[101] = Math.max(0, Math.min(26, Math.trunc(header.maxZoom)));

    view.setInt32(102, Math.round(header.minLon * 1e7), true);
    view.setInt32(106, Math.round(header.minLat * 1e7), true);
    view.setInt32(110, Math.round(header.maxLon * 1e7), true);
    view.setInt32(114, Math.round(header.maxLat * 1e7), true);
    out[118] = Math.max(0, Math.min(26, Math.trunc(header.centerZoom)));
    view.setInt32(119, Math.round(header.centerLon * 1e7), true);
    view.setInt32(123, Math.round(header.centerLat * 1e7), true);

    return out;
}

export function toPmtilesHeaderMetadata(header: PmtilesV3Header): PmtilesHeaderMetadata {
    return {
        specVersion: 3,
        tileType: header.tileType,
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        minLon: header.minLon,
        minLat: header.minLat,
        maxLon: header.maxLon,
        maxLat: header.maxLat,
        centerZoom: header.centerZoom,
        centerLon: header.centerLon,
        centerLat: header.centerLat,
        addressedTilesCount: header.addressedTilesCount,
        clustered: header.clustered,
    };
}

// ── Curva de Hilbert PMTiles v3 (z = 0..26 con BigInt) ────────────────────────

function rotateHilbert(
    n: bigint,
    x: bigint,
    y: bigint,
    rx: bigint,
    ry: bigint
): [bigint, bigint] {
    if (ry === 0n) {
        if (rx === 1n) {
            return [n - 1n - y, n - 1n - x];
        }
        return [y, x];
    }
    return [x, y];
}

export function zxyToPmtilesTileId(z: number, x: number, y: number): number {
    if (!Number.isInteger(z) || z < 0 || z > 26) {
        throw new RangeError(`Zoom fuera de rango PMTiles [0..26]: ${z}`);
    }
    const maxCoord = 1n << BigInt(z);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RangeError(`Coordenadas de tesela deben ser enteras: (${x}, ${y})`);
    }
    let bx = BigInt(x);
    let by = BigInt(y);
    if (bx < 0n || by < 0n || bx >= maxCoord || by >= maxCoord) {
        throw new RangeError(`Coordenadas (${x}, ${y}) fuera de rango para z=${z}`);
    }
    if (z === 0) return 0;

    const tzOffset = ((1n << BigInt(2 * z)) - 1n) / 3n;
    let d = 0n;
    for (let s = maxCoord >> 1n; s > 0n; s >>= 1n) {
        const rx = (bx & s) > 0n ? 1n : 0n;
        const ry = (by & s) > 0n ? 1n : 0n;
        d += s * s * ((3n * rx) ^ ry);
        [bx, by] = rotateHilbert(s, bx, by, rx, ry);
    }

    return Number(tzOffset + d);
}

export function pmtilesTileIdToZxy(tileId: number | bigint): {
    z: number;
    x: number;
    y: number;
} {
    const id = typeof tileId === 'bigint' ? tileId : BigInt(Math.trunc(tileId));
    if (id < 0n) {
        throw new RangeError(`tileId negativo inválido: ${tileId}`);
    }
    if (id === 0n) return { z: 0, x: 0, y: 0 };

    let acc = 0n;
    for (let z = 0; z <= 26; z++) {
        const numTiles = 1n << BigInt(2 * z);
        if (id < acc + numTiles) {
            const pos = id - acc;
            const n = 1n << BigInt(z);
            let t = pos;
            let x = 0n;
            let y = 0n;
            for (let s = 1n; s < n; s <<= 1n) {
                const rx = 1n & (t >> 1n);
                const ry = 1n & (t ^ rx);
                [x, y] = rotateHilbert(s, x, y, rx, ry);
                x += s * rx;
                y += s * ry;
                t >>= 2n;
            }
            return { z, x: Number(x), y: Number(y) };
        }
        acc += numTiles;
    }

    throw new RangeError(`tileId excede zoom máximo PMTiles (z=26): ${tileId}`);
}

// ── Codificación / Decodificación Varint de Directorios PMTiles v3 ────────────

function writeVarint(out: number[], value: number | bigint): void {
    let v = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.trunc(value)));
    while (v >= 0x80n) {
        out.push(Number((v & 0x7fn) | 0x80n));
        v >>= 7n;
    }
    out.push(Number(v));
}

function readVarint(bytes: Uint8Array, state: { pos: number }): number {
    let result = 0n;
    let shift = 0n;
    while (state.pos < bytes.length) {
        const b = bytes[state.pos++];
        result |= BigInt(b & 0x7f) << shift;
        if ((b & 0x80) === 0) {
            return Number(result);
        }
        shift += 7n;
        if (shift > 63n) {
            throw new Error('Varint PMTiles corrupto (desbordamiento > 64 bits).');
        }
    }
    throw new Error('Fin inesperado al leer varint en directorio PMTiles.');
}

export function encodePmtilesDirectory(entries: readonly PmtilesDirectoryEntry[]): Uint8Array {
    const out: number[] = [];
    writeVarint(out, entries.length);

    let lastTileId = 0;
    for (let i = 0; i < entries.length; i++) {
        const delta = entries[i].tileId - lastTileId;
        if (delta < 0) {
            throw new Error('Entradas de directorio PMTiles deben estar ordenadas por tileId.');
        }
        writeVarint(out, delta);
        lastTileId = entries[i].tileId;
    }

    for (let i = 0; i < entries.length; i++) {
        writeVarint(out, entries[i].runLength);
    }

    for (let i = 0; i < entries.length; i++) {
        writeVarint(out, entries[i].length);
    }

    for (let i = 0; i < entries.length; i++) {
        if (i > 0 && entries[i].offset === entries[i - 1].offset + entries[i - 1].length) {
            writeVarint(out, 0);
        } else {
            writeVarint(out, entries[i].offset + 1);
        }
    }

    return new Uint8Array(out);
}

export function decodePmtilesDirectory(
    input: ArrayBuffer | Uint8Array
): PmtilesDirectoryEntry[] {
    const bytes = toUint8Array(input);
    const state = { pos: 0 };
    const count = readVarint(bytes, state);
    if (count === 0) return [];

    const entries: PmtilesDirectoryEntry[] = new Array(count);

    let lastTileId = 0;
    for (let i = 0; i < count; i++) {
        lastTileId += readVarint(bytes, state);
        entries[i] = { tileId: lastTileId, offset: 0, length: 0, runLength: 0 };
    }

    for (let i = 0; i < count; i++) {
        entries[i].runLength = readVarint(bytes, state);
    }

    for (let i = 0; i < count; i++) {
        entries[i].length = readVarint(bytes, state);
    }

    for (let i = 0; i < count; i++) {
        const val = readVarint(bytes, state);
        if (val === 0 && i > 0) {
            entries[i].offset = entries[i - 1].offset + entries[i - 1].length;
        } else {
            entries[i].offset = Math.max(0, val - 1);
        }
    }

    return entries;
}

export function findTileInDirectory(
    entries: readonly PmtilesDirectoryEntry[],
    tileId: number
): PmtilesDirectoryEntry | null {
    let low = 0;
    let high = entries.length - 1;
    let candidateIdx = -1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (entries[mid].tileId <= tileId) {
            candidateIdx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (candidateIdx < 0) return null;
    const entry = entries[candidateIdx];

    if (entry.runLength === 0) {
        return entry;
    }

    if (tileId < entry.tileId + entry.runLength) {
        return entry;
    }

    return null;
}
