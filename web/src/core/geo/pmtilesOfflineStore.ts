import {
    PmtilesHeaderMetadataSchema,
    type PmtilesHeaderMetadata,
} from '../../contracts/geo.contracts';

/**
 * MINREPORT PMTILES OFFLINE STORE
 * Almacenamiento local de cabeceras y teselas PMTiles v3 para operación en faena sin red.
 * - Prioridad 1: Origin Private File System (OPFS), carpeta `minreport-geo-pmtiles`.
 * - Prioridad 2 (fallback automático): IndexedDB `minreport_geo_pmtiles_v1` (store `tiles`, max 256 entradas LRU/FIFO).
 */

const OPFS_ROOT_FOLDER = 'minreport-geo-pmtiles';
const IDB_NAME = 'minreport_geo_pmtiles_v1';
const IDB_VERSION = 1;
const IDB_TILES_STORE = 'tiles';
const IDB_HEADERS_STORE = 'headers';
const MAX_IDB_TILE_ENTRIES = 256;

interface StoredTileRecord {
    key: string;
    basemapId: string;
    z: number;
    x: number;
    y: number;
    data: ArrayBuffer;
    updatedAt: number;
}

interface StoredHeaderRecord {
    basemapId: string;
    header: PmtilesHeaderMetadata;
    updatedAt: number;
}

let idbPromise: Promise<IDBDatabase> | null = null;

function sanitizeBasemapId(basemapId: string): string {
    const cleaned = String(basemapId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    if (!cleaned) {
        throw new Error('basemapId inválido para caché PMTiles offline.');
    }
    return cleaned;
}

function buildTileKey(basemapId: string, z: number, x: number, y: number): string {
    return `${basemapId}:${z}:${x}:${y}`;
}

function buildTileFilename(z: number, x: number, y: number): string {
    return `${z}_${x}_${y}.tile`;
}

function toArrayBufferCopy(data: Uint8Array | ArrayBuffer): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data.slice(0);
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

// ── Prioridad 1: OPFS ─────────────────────────────────────────────────────────

async function getOpfsRootDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
    if (typeof navigator === 'undefined') return null;
    const storageAny = navigator.storage as
        | { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
        | undefined;
    if (!storageAny || typeof storageAny.getDirectory !== 'function') {
        return null;
    }
    try {
        const opfsRoot = await storageAny.getDirectory();
        return await opfsRoot.getDirectoryHandle(OPFS_ROOT_FOLDER, { create });
    } catch {
        return null;
    }
}

async function getOpfsBasemapDir(
    basemapId: string,
    create: boolean
): Promise<FileSystemDirectoryHandle | null> {
    const root = await getOpfsRootDir(create);
    if (!root) return null;
    try {
        return await root.getDirectoryHandle(basemapId, { create });
    } catch {
        return null;
    }
}

// ── Prioridad 2: IndexedDB Fallback ───────────────────────────────────────────

function openTilesIdb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB no disponible en este entorno.'));
    }
    if (!idbPromise) {
        idbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onerror = () => reject(req.error || new Error('Error abriendo IndexedDB PMTiles.'));
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(IDB_TILES_STORE)) {
                    const tileStore = db.createObjectStore(IDB_TILES_STORE, { keyPath: 'key' });
                    tileStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    tileStore.createIndex('basemapId', 'basemapId', { unique: false });
                }
                if (!db.objectStoreNames.contains(IDB_HEADERS_STORE)) {
                    db.createObjectStore(IDB_HEADERS_STORE, { keyPath: 'basemapId' });
                }
            };
        });
    }
    return idbPromise;
}

async function pruneIdbTilesIfNeeded(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_TILES_STORE, 'readwrite');
        const store = tx.objectStore(IDB_TILES_STORE);
        const countReq = store.count();

        countReq.onsuccess = () => {
            const total = countReq.result;
            if (total < MAX_IDB_TILE_ENTRIES) {
                resolve();
                return;
            }
            const toDelete = total - MAX_IDB_TILE_ENTRIES + 1;
            const index = store.index('updatedAt');
            let deleted = 0;
            const cursorReq = index.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor && deleted < toDelete) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                }
            };
        };
        countReq.onerror = () => reject(countReq.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── API Pública Exportada ─────────────────────────────────────────────────────

export async function putOfflineTile(
    basemapId: string,
    z: number,
    x: number,
    y: number,
    data: Uint8Array | ArrayBuffer
): Promise<void> {
    const safeId = sanitizeBasemapId(basemapId);
    const bufferCopy = toArrayBufferCopy(data);

    const opfsDir = await getOpfsBasemapDir(safeId, true);
    if (opfsDir) {
        try {
            const fileHandle = await opfsDir.getFileHandle(buildTileFilename(z, x, y), {
                create: true,
            });
            const writable = await fileHandle.createWritable();
            await writable.write(bufferCopy);
            await writable.close();
            return;
        } catch {
            // Caer a IndexedDB si OPFS restringe escritura
        }
    }

    const db = await openTilesIdb();
    await pruneIdbTilesIfNeeded(db);

    const record: StoredTileRecord = {
        key: buildTileKey(safeId, z, x, y),
        basemapId: safeId,
        z,
        x,
        y,
        data: bufferCopy,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_TILES_STORE, 'readwrite');
        const req = tx.objectStore(IDB_TILES_STORE).put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getOfflineTile(
    basemapId: string,
    z: number,
    x: number,
    y: number
): Promise<Uint8Array | null> {
    const safeId = sanitizeBasemapId(basemapId);

    const opfsDir = await getOpfsBasemapDir(safeId, false);
    if (opfsDir) {
        try {
            const fileHandle = await opfsDir.getFileHandle(buildTileFilename(z, x, y), {
                create: false,
            });
            const file = await fileHandle.getFile();
            const buf = await file.arrayBuffer();
            return new Uint8Array(buf);
        } catch {
            // Intentar IndexedDB si no existe en OPFS o falló lectura
        }
    }

    try {
        const db = await openTilesIdb();
        const key = buildTileKey(safeId, z, x, y);
        return await new Promise<Uint8Array | null>((resolve, reject) => {
            const tx = db.transaction(IDB_TILES_STORE, 'readwrite');
            const store = tx.objectStore(IDB_TILES_STORE);
            const req = store.get(key);
            req.onsuccess = () => {
                const record = req.result as StoredTileRecord | undefined;
                if (!record || !record.data) {
                    resolve(null);
                    return;
                }
                // Actualizar timestamp LRU al leer
                store.put({ ...record, updatedAt: Date.now() });
                resolve(new Uint8Array(record.data));
            };
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function putBasemapHeader(
    basemapId: string,
    header: PmtilesHeaderMetadata
): Promise<void> {
    const safeId = sanitizeBasemapId(basemapId);
    const validated = PmtilesHeaderMetadataSchema.parse(header);

    const opfsDir = await getOpfsBasemapDir(safeId, true);
    if (opfsDir) {
        try {
            const fileHandle = await opfsDir.getFileHandle('header.json', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(validated));
            await writable.close();
            return;
        } catch {
            // Fallback automático a IndexedDB
        }
    }

    const db = await openTilesIdb();
    const record: StoredHeaderRecord = {
        basemapId: safeId,
        header: validated,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_HEADERS_STORE, 'readwrite');
        const req = tx.objectStore(IDB_HEADERS_STORE).put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getBasemapHeader(
    basemapId: string
): Promise<PmtilesHeaderMetadata | null> {
    const safeId = sanitizeBasemapId(basemapId);

    const opfsDir = await getOpfsBasemapDir(safeId, false);
    if (opfsDir) {
        try {
            const fileHandle = await opfsDir.getFileHandle('header.json', { create: false });
            const file = await fileHandle.getFile();
            const parsed = PmtilesHeaderMetadataSchema.safeParse(
                JSON.parse(await file.text())
            );
            if (parsed.success) return parsed.data;
        } catch {
            // Intentar IndexedDB
        }
    }

    try {
        const db = await openTilesIdb();
        return await new Promise<PmtilesHeaderMetadata | null>((resolve, reject) => {
            const tx = db.transaction(IDB_HEADERS_STORE, 'readonly');
            const req = tx.objectStore(IDB_HEADERS_STORE).get(safeId);
            req.onsuccess = () => {
                const record = req.result as StoredHeaderRecord | undefined;
                if (!record?.header) {
                    resolve(null);
                    return;
                }
                const parsed = PmtilesHeaderMetadataSchema.safeParse(record.header);
                resolve(parsed.success ? parsed.data : null);
            };
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function clearOfflineBasemap(basemapId: string): Promise<void> {
    const safeId = sanitizeBasemapId(basemapId);

    const opfsRoot = await getOpfsRootDir(false);
    if (opfsRoot) {
        try {
            await opfsRoot.removeEntry(safeId, { recursive: true });
        } catch {
            // Ignorar si no existe en OPFS
        }
    }

    try {
        const db = await openTilesIdb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([IDB_TILES_STORE, IDB_HEADERS_STORE], 'readwrite');
            tx.objectStore(IDB_HEADERS_STORE).delete(safeId);

            const tileStore = tx.objectStore(IDB_TILES_STORE);
            const idx = tileStore.index('basemapId');
            const cursorReq = idx.openCursor(IDBKeyRange.only(safeId));
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // No-op si IndexedDB no disponible
    }
}
