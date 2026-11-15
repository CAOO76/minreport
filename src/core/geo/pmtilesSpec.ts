import type { PmtilesHeaderMetadata, PmtilesTileType } from '../../contracts/geo.contracts';

/**
 * ESPECIFICACIÓN BINARIA PMTILES v3 — NÚCLEO ISOMÓRFICO PURO
 *
 * Implementa el protocolo oficial Protomaps PMTiles v3 (cabecera de 127 bytes,
 * curva espacial de Hilbert z=0..26 con BigInt y directorios varint Run-Length)
 * utilizando exclusivamente `Uint8Array` + `DataView` (Node + Browser).
 */

export const PMTILES_V3_HEADER_BYTES = 127;
export const PMTILES_MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73] as const; // "PMTiles"
export const PMTILES_MAX_ZOOM = 26;

export type PmtilesCompression = 'UNKNOWN' | 'NONE' | 'GZIP' | 'BROTLI' | 'ZSTD';

export interface PmtilesV3Header {
    specVersion: 3;
    rootDirectoryOffset: number;
    rootDirectoryLength: number;
    jsonMetadataOffset: number;
    jsonMetadataLength: number;
    leafDirectoriesOffset: number;
    leafDirectoriesLength: number;
    tileDataOffset: number;
    tileDataLength: number;
    addressedTilesCount: number;
    tileEntriesCount: number;
    tileContentsCount: number;
    clustered: boolean;
    internalCompression: PmtilesCompression;
    tileCompression: PmtilesCompression;
    tileType: PmtilesTileType;
    minZoom: number;
    maxZoom: number;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    centerZoom: number;
    centerLon: number;
    centerLat: number;
}

export interface PmtilesDirectoryEntry {
    tileId: number;
    offset: number;
    length: number;
    runLength: number;
}

const COMPRESSION_BY_CODE: Readonly<Record<number, PmtilesCompression>> = {
    0: 'UNKNOWN',
    1: 'NONE',
    2: 'GZIP',
    3: 'BROTLI',
    4: 'ZSTD',
};

const CODE_BY_COMPRESSION: Readonly<Record<PmtilesCompression, number>> = {
    UNKNOWN: 0,
    NONE: 1,
    GZIP: 2,
    BROTLI: 3,
    ZSTD: 4,
};

const TILE_TYPE_BY_CODE: Readonly<Record<number, PmtilesTileType>> = {
    0: 'UNKNOWN',
    1: 'MVT',
    2: 'PNG',
    3: 'JPEG',
    4: 'WEBP',
    5: 'AVIF',
};

const CODE_BY_TILE_TYPE: Readonly<Record<PmtilesTileType, number>> = {
    UNKNOWN: 0,
    MVT: 1,
    PNG: 2,
    JPEG: 3,
    WEBP: 4,
    AVIF: 5,
};

function readUint64LE(view: DataView, byteOffset: number): number {
    return Number(view.getBigUint64(byteOffset, true));
}

function writeUint64LE(view: DataView, byteOffset: number, value: number): void {
    const safeVal = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
    view.setBigUint64(byteOffset, BigInt(safeVal), true);
}

/**
 * Parsea la cabecera binaria estándar de 127 bytes de un archivo PMTiles v3.
 */
export function parsePmtilesV3Header(bytes: Uint8Array): PmtilesV3Header {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < PMTILES_V3_HEADER_BYTES) {
        throw new RangeError(
            `Cabecera PMTiles v3 truncada: se requieren ${PMTILES_V3_HEADER_BYTES} bytes, recibidos ${bytes?.byteLength ?? 0}.`
        );
    }

    for (let i = 0; i < PMTILES_MAGIC.length; i++) {
        if (bytes[i] !== PMTILES_MAGIC[i]) {
            throw new Error('Firma mágica PMTiles inválida (esperado "PMTiles").');
        }
    }

    if (bytes[7] !== 3) {
        throw new Error(`Versión PMTiles no soportada: ${bytes[7]} (solo v3).`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    return {
        specVersion: 3,
        rootDirectoryOffset: readUint64LE(view, 8),
        rootDirectoryLength: readUint64LE(view, 16),
        jsonMetadataOffset: readUint64LE(view, 24),
        jsonMetadataLength: readUint64LE(view, 32),
        leafDirectoriesOffset: readUint64LE(view, 40),
        leafDirectoriesLength: readUint64LE(view, 48),
        tileDataOffset: readUint64LE(view, 56),
        tileDataLength: readUint64LE(view, 64),
        addressedTilesCount: readUint64LE(view, 72),
        tileEntriesCount: readUint64LE(view, 80),
        tileContentsCount: readUint64LE(view, 88),
        clustered: bytes[96] === 1,
        internalCompression: COMPRESSION_BY_CODE[bytes[97]] ?? 'UNKNOWN',
        tileCompression: COMPRESSION_BY_CODE[bytes[98]] ?? 'UNKNOWN',
        tileType: TILE_TYPE_BY_CODE[bytes[99]] ?? 'UNKNOWN',
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

/**
 * Serializa una cabecera PMTiles v3 en un buffer exacto de 127 bytes.
 */
export function serializePmtilesV3Header(header: PmtilesV3Header): Uint8Array {
    const out = new Uint8Array(PMTILES_V3_HEADER_BYTES);
    const view = new DataView(out.buffer);

    for (let i = 0; i < PMTILES_MAGIC.length; i++) {
        out[i] = PMTILES_MAGIC[i];
    }
    out[7] = 3;

    writeUint64LE(view, 8, header.rootDirectoryOffset);
    writeUint64LE(view, 16, header.rootDirectoryLength);
    writeUint64LE(view, 24, header.jsonMetadataOffset);
    writeUint64LE(view, 32, header.jsonMetadataLength);
    writeUint64LE(view, 40, header.leafDirectoriesOffset);
    writeUint64LE(view, 48, header.leafDirectoriesLength);
    writeUint64LE(view, 56, header.tileDataOffset);
    writeUint64LE(view, 64, header.tileDataLength);
    writeUint64LE(view, 72, header.addressedTilesCount);
    writeUint64LE(view, 80, header.tileEntriesCount);
    writeUint64LE(view, 88, header.tileContentsCount);

    out[96] = header.clustered ? 1 : 0;
    out[97] = CODE_BY_COMPRESSION[header.internalCompression] ?? 0;
    out[98] = CODE_BY_COMPRESSION[header.tileCompression] ?? 0;
    out[99] = CODE_BY_TILE_TYPE[header.tileType] ?? 0;
    out[100] = Math.max(0, Math.min(255, Math.trunc(header.minZoom)));
    out[101] = Math.max(0, Math.min(255, Math.trunc(header.maxZoom)));

    view.setInt32(102, Math.round(header.minLon * 1e7), true);
    view.setInt32(106, Math.round(header.minLat * 1e7), true);
    view.setInt32(110, Math.round(header.maxLon * 1e7), true);
    view.setInt32(114, Math.round(header.maxLat * 1e7), true);

    out[118] = Math.max(0, Math.min(255, Math.trunc(header.centerZoom)));
    view.setInt32(119, Math.round(header.centerLon * 1e7), true);
    view.setInt32(123, Math.round(header.centerLat * 1e7), true);

    return out;
}

/**
 * Extrae metadatos canónicos compatibles con `PmtilesHeaderMetadataSchema`.
 */
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

// ============================================================================
// Curva Espacial de Hilbert (Biyección Z/X/Y <-> TileID para z = 0..26)
// ============================================================================

function rotateHilbert(n: bigint, x: bigint, y: bigint, rx: bigint, ry: bigint): [bigint, bigint] {
    if (ry === 0n) {
        if (rx === 1n) {
            return [n - 1n - y, n - 1n - x];
        }
        return [y, x];
    }
    return [x, y];
}

function levelStartTileId(z: number): bigint {
    // sum_{i=0}^{z-1} 4^i = (4^z - 1) / 3
    return ((1n << BigInt(2 * z)) - 1n) / 3n;
}

/**
 * Convierte coordenadas de tesela WebMercator `(z, x, y)` a `tileId` de Hilbert PMTiles v3.
 */
export function zxyToPmtilesTileId(z: number, x: number, y: number): number {
    if (!Number.isInteger(z) || z < 0 || z > PMTILES_MAX_ZOOM) {
        throw new RangeError(`Zoom PMTiles fuera de rango (0..${PMTILES_MAX_ZOOM}): ${z}`);
    }
    const n = 1n << BigInt(z);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || BigInt(x) >= n || BigInt(y) >= n) {
        throw new RangeError(`Coordenadas de tesela fuera de rango para z=${z}: (${x}, ${y})`);
    }

    const baseId = levelStartTileId(z);
    let tx = BigInt(x);
    let ty = BigInt(y);
    let d = 0n;

    for (let s = n >> 1n; s > 0n; s >>= 1n) {
        const rx = (tx & s) > 0n ? 1n : 0n;
        const ry = (ty & s) > 0n ? 1n : 0n;
        d += s * s * ((3n * rx) ^ ry);
        [tx, ty] = rotateHilbert(n, tx, ty, rx, ry);
    }

    return Number(baseId + d);
}

/**
 * Convierte un `tileId` de Hilbert PMTiles v3 a coordenadas `(z, x, y)`.
 */
export function pmtilesTileIdToZxy(tileIdInput: number | bigint): { z: number; x: number; y: number } {
    const tileId = typeof tileIdInput === 'bigint' ? tileIdInput : BigInt(Math.trunc(tileIdInput));
    if (tileId < 0n) {
        throw new RangeError(`tileId PMTiles negativo inválido: ${tileId}`);
    }

    let acc = 0n;
    for (let z = 0; z <= PMTILES_MAX_ZOOM; z++) {
        const levelCount = 1n << BigInt(2 * z);
        if (acc + levelCount > tileId) {
            const pos = tileId - acc;
            const n = 1n << BigInt(z);
            let x = 0n;
            let y = 0n;
            let t = pos;

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
        acc += levelCount;
    }

    throw new RangeError(`tileId PMTiles excede el nivel máximo z=${PMTILES_MAX_ZOOM}: ${tileId}`);
}

// ============================================================================
// Codificación/Decodificación de Directorios Varint (LEB128 64-bit)
// ============================================================================

function writeVarint(out: number[], valueInput: number | bigint): void {
    let val = typeof valueInput === 'bigint' ? valueInput : BigInt(Math.trunc(valueInput));
    if (val < 0n) {
        throw new RangeError(`Varint PMTiles no soporta valores negativos: ${val}`);
    }
    while (val >= 0x80n) {
        out.push(Number((val & 0x7fn) | 0x80n));
        val >>= 7n;
    }
    out.push(Number(val));
}

function readVarint(bytes: Uint8Array, cursor: { offset: number }): bigint {
    let result = 0n;
    let shift = 0n;
    while (cursor.offset < bytes.byteLength) {
        const byte = bytes[cursor.offset++];
        result |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            return result;
        }
        shift += 7n;
        if (shift > 63n) {
            throw new Error('Varint PMTiles excede 64 bits.');
        }
    }
    throw new Error('Directorio PMTiles truncado al leer varint.');
}

/**
 * Codifica un arreglo de entradas de directorio PMTiles v3 en bytes LEB128 columnar.
 */
export function encodePmtilesDirectory(entries: ReadonlyArray<PmtilesDirectoryEntry>): Uint8Array {
    const sorted = [...entries].sort((a, b) => a.tileId - b.tileId);
    const out: number[] = [];

    writeVarint(out, sorted.length);

    let lastId = 0n;
    for (const entry of sorted) {
        const currentId = BigInt(Math.trunc(entry.tileId));
        const delta = currentId - lastId;
        if (delta < 0n) {
            throw new Error('Las entradas del directorio PMTiles deben ordenarse por tileId ascendente.');
        }
        writeVarint(out, delta);
        lastId = currentId;
    }

    for (const entry of sorted) {
        writeVarint(out, entry.runLength);
    }

    for (const entry of sorted) {
        writeVarint(out, entry.length);
    }

    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];
        if (i > 0 && current.offset === sorted[i - 1].offset + sorted[i - 1].length) {
            writeVarint(out, 0);
        } else {
            writeVarint(out, current.offset + 1);
        }
    }

    return new Uint8Array(out);
}

/**
 * Decodifica un directorio binario PMTiles v3 a su arreglo ordenado de entradas.
 */
export function decodePmtilesDirectory(bytes: Uint8Array): PmtilesDirectoryEntry[] {
    const cursor = { offset: 0 };
    const numEntries = Number(readVarint(bytes, cursor));
    if (!Number.isSafeInteger(numEntries) || numEntries < 0) {
        throw new Error(`Cantidad inválida de entradas en directorio PMTiles: ${numEntries}`);
    }
    if (numEntries === 0) {
        return [];
    }

    const entries: PmtilesDirectoryEntry[] = new Array(numEntries);
    let lastId = 0n;

    for (let i = 0; i < numEntries; i++) {
        lastId += readVarint(bytes, cursor);
        entries[i] = {
            tileId: Number(lastId),
            runLength: 0,
            length: 0,
            offset: 0,
        };
    }

    for (let i = 0; i < numEntries; i++) {
        entries[i].runLength = Number(readVarint(bytes, cursor));
    }

    for (let i = 0; i < numEntries; i++) {
        entries[i].length = Number(readVarint(bytes, cursor));
    }

    for (let i = 0; i < numEntries; i++) {
        const rawOffset = Number(readVarint(bytes, cursor));
        if (rawOffset === 0 && i > 0) {
            entries[i].offset = entries[i - 1].offset + entries[i - 1].length;
        } else {
            entries[i].offset = rawOffset - 1;
        }
    }

    return entries;
}

/**
 * Búsqueda binaria sobre directorio PMTiles v3 ordenado por `tileId`.
 * Retorna la entrada si coincide con la tesela (incluyendo rango `runLength > 0`)
 * o si es un puntero a directorio hoja (`runLength === 0`).
 */
export function findTileInDirectory(
    entries: ReadonlyArray<PmtilesDirectoryEntry>,
    tileId: number
): PmtilesDirectoryEntry | null {
    let low = 0;
    let high = entries.length - 1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const candidate = entries[mid];
        const diff = tileId - candidate.tileId;

        if (diff < 0) {
            high = mid - 1;
        } else if (candidate.runLength === 0) {
            // Entrada hoja cubre hasta antes del siguiente entry.tileId
            if (mid + 1 < entries.length && tileId >= entries[mid + 1].tileId) {
                low = mid + 1;
            } else {
                return candidate;
            }
        } else if (diff < candidate.runLength) {
            return candidate;
        } else {
            low = mid + 1;
        }
    }

    return null;
}
