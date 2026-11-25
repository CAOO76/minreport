/**
 * LocalCasFilesystemService — Almacenamiento CAS Local Resiliente (8–24h sin señal)
 *
 * - En Android/iOS nativo (`Capacitor.isNativePlatform()`): persiste binarios pesados
 *   (keyframes WebP, paquetes espaciales, mallas `.glb`) en `@capacitor/filesystem`
 *   bajo `Directory.Data/minreport_cas/<tenantId>/<sha256>.<ext>` evitando límites
 *   WebView IndexedDB y OOM durante turnos prolongados sin red.
 * - En navegador Web PWA: fallback transparente a `OfflineStorage` (`offline_cas_blobs`)
 *   solicitando `navigator.storage.persist()` para prevenir evicción automática.
 * - Garantía anti-pérdida: ningún blob referenciado por sesiones pendientes
 *   (`CAPTURED_OFFLINE_VALID` / `SYNCING_RAW_CAS`) puede ser purgado por LRU.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { offlineStorage, type OfflineCasBlobRecord } from './OfflineStorage';

export interface LocalCasWriteParams {
    sha256: string;
    blob: Blob;
    mimeType: string;
    profile: string;
    scope?: string;
    tenantId: string;
    filename?: string;
    extension?: string;
    originalBytes?: number;
    optimizedBytes?: number;
}

export interface LocalCasReadResult {
    blob: Blob;
    record: OfflineCasBlobRecord;
}

const CAS_ROOT_DIR = 'minreport_cas';

function sanitizeSegment(raw: string, fallback: string): string {
    const clean = String(raw || '')
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, '_');
    return clean.length > 0 ? clean.slice(0, 96) : fallback;
}

function inferExtension(mimeType?: string, filename?: string, explicit?: string): string {
    if (explicit && explicit.trim()) {
        return explicit.trim().replace(/^\./, '').toLowerCase();
    }
    const lowerName = String(filename || '').toLowerCase();
    const dotIdx = lowerName.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < lowerName.length - 1) {
        const ext = lowerName.slice(dotIdx + 1).replace(/[^a-z0-9]/g, '');
        if (ext.length >= 2 && ext.length <= 6) return ext;
    }
    const lowerMime = String(mimeType || '').toLowerCase();
    if (lowerMime.includes('webp')) return 'webp';
    if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) return 'jpg';
    if (lowerMime.includes('png')) return 'png';
    if (lowerMime.includes('gltf-binary')) return 'glb';
    if (lowerMime.includes('gzip')) return 'gz';
    if (lowerMime.includes('json')) return 'json';
    return 'bin';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        let chunkStr = '';
        for (let j = 0; j < slice.length; j++) {
            chunkStr += String.fromCharCode(slice[j]);
        }
        binary += chunkStr;
    }
    return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
    const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

export class LocalCasFilesystemService {
    private persistenceRequested = false;

    public buildRelativePath(tenantId: string, sha256: string, extension: string): string {
        const safeTenant = sanitizeSegment(tenantId, 'offline-local');
        const safeSha = sanitizeSegment(sha256.toLowerCase(), 'unknown');
        const safeExt = sanitizeSegment(extension.toLowerCase(), 'bin');
        return `${CAS_ROOT_DIR}/${safeTenant}/${safeSha}.${safeExt}`;
    }

    public async requestPersistentStorage(): Promise<boolean> {
        if (this.persistenceRequested) return true;
        this.persistenceRequested = true;
        try {
            if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
                return await navigator.storage.persist();
            }
        } catch {
            // Entorno sin StorageManager
        }
        return false;
    }

    public async putBlob(params: LocalCasWriteParams): Promise<OfflineCasBlobRecord> {
        await this.requestPersistentStorage();
        const sha256 = params.sha256.trim().toLowerCase();
        const safeTenant = sanitizeSegment(params.tenantId, 'offline-local');
        const ext = inferExtension(params.mimeType, params.filename, params.extension);
        const fsPath = this.buildRelativePath(safeTenant, sha256, ext);
        const originalBytes = params.originalBytes ?? params.blob.size;
        const optimizedBytes = params.optimizedBytes ?? params.blob.size;

        if (Capacitor.isNativePlatform()) {
            try {
                const ab = await params.blob.arrayBuffer();
                const base64Data = arrayBufferToBase64(ab);
                await Filesystem.writeFile({
                    path: fsPath,
                    data: base64Data,
                    directory: Directory.Data,
                    recursive: true,
                });

                const record: OfflineCasBlobRecord = {
                    sha256,
                    fsPath,
                    storageBackend: 'CAPACITOR_FS',
                    mimeType: params.mimeType,
                    profile: params.profile,
                    scope: params.scope || 'TENANT_PRIVATE',
                    tenantId: safeTenant,
                    filename: params.filename || `${sha256}.${ext}`,
                    originalBytes,
                    optimizedBytes,
                    updatedAt: Date.now(),
                };
                await offlineStorage.putCasBlob(record);
                return record;
            } catch (err) {
                console.warn(
                    '[LocalCasFilesystemService] Fallback a IndexedDB tras fallo Capacitor Filesystem:',
                    err
                );
            }
        }

        const idbRecord: OfflineCasBlobRecord = {
            sha256,
            blob: params.blob,
            storageBackend: 'INDEXED_DB',
            mimeType: params.mimeType,
            profile: params.profile,
            scope: params.scope || 'TENANT_PRIVATE',
            tenantId: safeTenant,
            filename: params.filename || `${sha256}.${ext}`,
            originalBytes,
            optimizedBytes,
            updatedAt: Date.now(),
        };
        await offlineStorage.putCasBlob(idbRecord);
        return idbRecord;
    }

    public async getBlob(sha256Raw: string): Promise<LocalCasReadResult | null> {
        const sha256 = sha256Raw.trim().toLowerCase();
        if (!sha256) return null;

        const record = await offlineStorage.getCasBlob(sha256).catch(() => null);
        if (!record) return null;

        if (record.storageBackend === 'CAPACITOR_FS' && record.fsPath && Capacitor.isNativePlatform()) {
            try {
                const fileRes = await Filesystem.readFile({
                    path: record.fsPath,
                    directory: Directory.Data,
                });
                const rawData = fileRes.data;
                if (typeof rawData === 'string') {
                    const bytes = base64ToUint8Array(rawData);
                    const blob = new Blob([bytes.buffer as ArrayBuffer], {
                        type: record.mimeType || 'application/octet-stream',
                    });
                    return { blob, record };
                }
                if (rawData instanceof Blob) {
                    return { blob: rawData, record };
                }
            } catch (err) {
                console.warn('[LocalCasFilesystemService] Error leyendo blob nativo:', err);
            }
        }

        if (record.blob) {
            return { blob: record.blob, record };
        }

        return null;
    }

    public async getArrayBuffer(sha256Raw: string): Promise<ArrayBuffer | null> {
        const res = await this.getBlob(sha256Raw);
        if (!res?.blob) return null;
        return res.blob.arrayBuffer();
    }

    public async cacheRemoteGlb(
        sha256: string,
        arrayBuffer: ArrayBuffer,
        tenantId: string
    ): Promise<OfflineCasBlobRecord> {
        const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
        return this.putBlob({
            sha256,
            blob,
            mimeType: 'model/gltf-binary',
            profile: 'MESH_3D_GLB',
            scope: 'TENANT_PRIVATE',
            tenantId,
            filename: `${sha256}.glb`,
            extension: 'glb',
            originalBytes: arrayBuffer.byteLength,
            optimizedBytes: arrayBuffer.byteLength,
        });
    }

    /**
     * Retorna el conjunto de hashes SHA-256 anclados por sesiones pendientes de sincronización.
     * Estos hashes están blindados contra purga LRU durante turnos de 8–24 h sin conectividad.
     */
    public async getPinnedSha256Set(tenantId?: string): Promise<Set<string>> {
        const pinned = new Set<string>();
        const pendingSessions = await offlineStorage
            .getPendingCaptureSessions(tenantId)
            .catch(() => []);
        for (const sess of pendingSessions) {
            for (const kf of sess.keyframes || []) {
                if (kf.sha256) pinned.add(kf.sha256.toLowerCase());
            }
            if (sess.rawSpatialBundle?.sha256) {
                pinned.add(sess.rawSpatialBundle.sha256.toLowerCase());
            }
            if (sess.localPreviewMesh?.sha256) {
                pinned.add(sess.localPreviewMesh.sha256.toLowerCase());
            }
        }

        const tasks = await offlineStorage.getAllSyncTasks().catch(() => []);
        for (const task of tasks) {
            if (task.status === 'COMPLETED' || task.status === 'DEAD_LETTER') continue;
            const p = (task.payload || {}) as Record<string, unknown>;
            const shaKeys = ['sha256', 'spatialPayloadSha256', 'meshSha256'];
            for (const key of shaKeys) {
                const val = p[key];
                if (typeof val === 'string' && val.trim()) pinned.add(val.trim().toLowerCase());
            }
            if (Array.isArray(p.extraSha256s)) {
                for (const s of p.extraSha256s) {
                    if (typeof s === 'string' && s.trim()) pinned.add(s.trim().toLowerCase());
                }
            }
        }
        return pinned;
    }

    /**
     * Purga segura LRU: elimina únicamente blobs antiguos que NO están anclados a ninguna
     * sesión pendiente ni tarea activa en cola.
     */
    public async pruneUnpinnedBlobs(maxTotalBytes = 250 * 1024 * 1024): Promise<number> {
        const [allBlobs, pinned] = await Promise.all([
            offlineStorage.getAllCasBlobs().catch(() => []),
            this.getPinnedSha256Set(),
        ]);

        let totalBytes = allBlobs.reduce(
            (acc, item) => acc + (item.optimizedBytes || item.blob?.size || 0),
            0
        );
        if (totalBytes <= maxTotalBytes) return 0;

        const candidates = allBlobs
            .filter((item) => !pinned.has(item.sha256.toLowerCase()))
            .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));

        let deletedCount = 0;
        for (const item of candidates) {
            if (totalBytes <= maxTotalBytes) break;
            if (item.storageBackend === 'CAPACITOR_FS' && item.fsPath && Capacitor.isNativePlatform()) {
                await Filesystem.deleteFile({
                    path: item.fsPath,
                    directory: Directory.Data,
                }).catch(() => {});
            }
            await offlineStorage.deleteCasBlob(item.sha256).catch(() => {});
            totalBytes -= item.optimizedBytes || item.blob?.size || 0;
            deletedCount++;
        }
        return deletedCount;
    }
}

export const localCasFilesystem = new LocalCasFilesystemService();
