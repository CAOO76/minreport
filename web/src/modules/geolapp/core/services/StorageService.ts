/**
 * StorageService — Servicio CAS Multimedia de GEOLAPP (Cero Base64 en Firestore)
 *
 * ARQUITECTURA:
 *  - Conecta toda captura/carga de fotos a `mediaDigestorClient.digestAndUploadCas`
 *    (`IMAGE_FIELD_EVIDENCE`, `scope: 'TENANT_PRIVATE'`, `tenantId`).
 *  - Si el endpoint API no responde pero hay red, sube el blob WebP digerido a Firebase Storage
 *    bajo `tenants/${tenantId}/stockpiles/...`.
 *  - En modo offline, guarda el Blob optimizado en `offlineStorage` (`offline_cas_blobs`)
 *    y retorna referencia compacta `offline-cas://<sha256>.<ext>` (< 90 bytes).
 */

import { useState, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { storage as firebaseStorage } from '../../../../config/firebase';
import { mediaDigestorClient } from '../../../../core/media/MediaDigestorClient';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { offlineStorage } from '../../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../../core/offline/SyncQueueEngine';

export interface UploadOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp';
    tenantId?: string;
    filename?: string;
}

export interface UploadResult {
    url: string;
    path: string;
    size: number;
    uploadedAt: string;
    sha256?: string;
    originalBytes?: number;
    optimizedBytes?: number;
    savingsPct?: number;
}

function computeCasSavingsPct(originalBytes: number, optimizedBytes: number): number {
    if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
    const ratio = 1 - optimizedBytes / originalBytes;
    return Math.max(0, Math.round(ratio * 1000) / 10);
}

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    return `local_${Date.now()}_${buffer.byteLength}`;
}

/**
 * Detecta rutas CAS/Blob protegidas (`/api/media/blob/...` o `/api/media/cas/...`),
 * ya sean rutas relativas o URLs absolutas que contengan dichos prefijos.
 */
export function isProtectedCasMediaUrl(url?: string | null): boolean {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    return (
        trimmed.startsWith('/api/media/') ||
        trimmed.includes('/api/media/blob/') ||
        trimmed.includes('/api/media/cas/')
    );
}

function needsAsyncImageResolution(url?: string | null): boolean {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    return trimmed.startsWith('offline-cas://') || isProtectedCasMediaUrl(trimmed);
}

/**
 * Resuelve referencias locales `offline-cas://<sha256>.<ext>` (IndexedDB) y rutas protegidas
 * `/api/media/blob/...` o `/api/media/cas/...` (vía `coreAuthFetch` autenticado) a Object URLs temporales.
 */
export async function resolveStockpileImageUrl(
    url?: string | null
): Promise<{ resolvedUrl: string; revoke?: () => void }> {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) return { resolvedUrl: '' };

    if (trimmed.startsWith('offline-cas://')) {
        try {
            const refPart = trimmed.replace('offline-cas://', '').split('?')[0];
            const sha256 = refPart.split('.')[0];
            if (!sha256) return { resolvedUrl: '' };
            const record = await offlineStorage.getCasBlob(sha256);
            if (!record?.blob) return { resolvedUrl: '' };
            const objUrl = URL.createObjectURL(record.blob);
            return {
                resolvedUrl: objUrl,
                revoke: () => URL.revokeObjectURL(objUrl),
            };
        } catch {
            return { resolvedUrl: '' };
        }
    }

    if (isProtectedCasMediaUrl(trimmed)) {
        try {
            const response = await coreAuthFetch(trimmed, { method: 'GET' });
            if (!response.ok) return { resolvedUrl: '' };
            const blob = await response.blob();
            if (!blob || blob.size === 0) return { resolvedUrl: '' };
            const objUrl = URL.createObjectURL(blob);
            return {
                resolvedUrl: objUrl,
                revoke: () => URL.revokeObjectURL(objUrl),
            };
        } catch {
            return { resolvedUrl: '' };
        }
    }

    return { resolvedUrl: trimmed };
}

export interface ResolvedStockpileMeshBinary {
    arrayBuffer: ArrayBuffer | null;
    sourceLabel: string;
}

/**
 * Resuelve el binario `.glb` desde `offline-cas://<sha256>.glb` (IndexedDB),
 * endpoints autenticados `/api/media/blob/...` o `/api/media/cas/...` o URL `https://...` remota.
 */
export async function resolveStockpileMeshBinary(
    url: string
): Promise<ResolvedStockpileMeshBinary> {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) {
        return { arrayBuffer: null, sourceLabel: 'UNDECLARED' };
    }

    if (trimmed.startsWith('offline-cas://')) {
        try {
            const refPart = trimmed.replace('offline-cas://', '').split('?')[0];
            const sha256 = refPart.split('.')[0];
            if (!sha256) return { arrayBuffer: null, sourceLabel: 'OFFLINE_CAS_INVALID' };
            const record = await offlineStorage.getCasBlob(sha256);
            if (!record?.blob) return { arrayBuffer: null, sourceLabel: 'OFFLINE_CAS_MISS' };
            const arrayBuffer = await record.blob.arrayBuffer();
            return { arrayBuffer, sourceLabel: 'OFFLINE_CAS' };
        } catch {
            return { arrayBuffer: null, sourceLabel: 'OFFLINE_CAS_ERROR' };
        }
    }

    if (isProtectedCasMediaUrl(trimmed)) {
        try {
            const response = await coreAuthFetch(trimmed, { method: 'GET' });
            if (!response.ok) {
                return { arrayBuffer: null, sourceLabel: `CAS_HTTP_${response.status}` };
            }
            const arrayBuffer = await response.arrayBuffer();
            return { arrayBuffer, sourceLabel: 'CAS_API' };
        } catch {
            return { arrayBuffer: null, sourceLabel: 'CAS_FETCH_ERROR' };
        }
    }

    if (
        trimmed.startsWith('https://') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('blob:')
    ) {
        try {
            const response = await fetch(trimmed, { method: 'GET' });
            if (!response.ok) {
                return { arrayBuffer: null, sourceLabel: `REMOTE_HTTP_${response.status}` };
            }
            const arrayBuffer = await response.arrayBuffer();
            return {
                arrayBuffer,
                sourceLabel: trimmed.startsWith('blob:') ? 'BLOB_LOCAL' : 'HTTPS_STORAGE',
            };
        } catch {
            return { arrayBuffer: null, sourceLabel: 'REMOTE_FETCH_ERROR' };
        }
    }

    return { arrayBuffer: null, sourceLabel: 'UNSUPPORTED_SCHEME' };
}

export interface ResolvedStockpileImageState {
    resolvedUrl: string;
    isLoading: boolean;
}

/**
 * Hook React con estado de carga y liberación automática de Object URL para `offline-cas://...`
 * y rutas protegidas `/api/media/*` (evita disparar `<img src="/api/media/...">` sin token).
 */
export function useResolvedStockpileImageState(
    url?: string | null
): ResolvedStockpileImageState {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    const requiresAsync = needsAsyncImageResolution(trimmed);

    const [state, setState] = useState<{
        sourceUrl: string;
        resolvedUrl: string;
        isLoading: boolean;
    }>(() => ({
        sourceUrl: trimmed,
        resolvedUrl: trimmed && !requiresAsync ? trimmed : '',
        isLoading: Boolean(trimmed && requiresAsync),
    }));

    useEffect(() => {
        let active = true;
        let cleanup: (() => void) | undefined;

        if (!trimmed) {
            setState({ sourceUrl: '', resolvedUrl: '', isLoading: false });
            return;
        }
        if (!requiresAsync) {
            setState({ sourceUrl: trimmed, resolvedUrl: trimmed, isLoading: false });
            return;
        }

        setState({ sourceUrl: trimmed, resolvedUrl: '', isLoading: true });

        resolveStockpileImageUrl(trimmed).then(({ resolvedUrl, revoke }) => {
            if (!active) {
                if (revoke) revoke();
                return;
            }
            cleanup = revoke;
            setState({ sourceUrl: trimmed, resolvedUrl, isLoading: false });
        });

        return () => {
            active = false;
            if (cleanup) cleanup();
        };
    }, [trimmed, requiresAsync]);

    if (state.sourceUrl !== trimmed) {
        if (!trimmed) return { resolvedUrl: '', isLoading: false };
        if (!requiresAsync) return { resolvedUrl: trimmed, isLoading: false };
        return { resolvedUrl: '', isLoading: true };
    }

    return {
        resolvedUrl: state.resolvedUrl,
        isLoading: state.isLoading,
    };
}

/**
 * Hook React con liberación automática de Object URL para visualizar `offline-cas://...`,
 * rutas protegidas `/api/media/*` o URLs públicas CAS.
 */
export function useResolvedStockpileImage(url?: string | null): string {
    return useResolvedStockpileImageState(url).resolvedUrl;
}

export class StorageService {
    private tenantId = '';

    public setTenantId(tenantId: string): void {
        if (tenantId && tenantId.trim().length > 0) {
            this.tenantId = tenantId.trim();
        }
    }

    public getTenantId(): string {
        return this.tenantId;
    }

    /**
     * Optimiza imagen vía `<canvas>` liberando explícitamente memoria GPU/RAM (`width = 0; height = 0`)
     * como respaldo si el Web Worker no está disponible.
     */
    private async optimizeImageFallback(file: File | Blob, options: UploadOptions = {}): Promise<Blob> {
        const {
            maxWidth = 1280,
            maxHeight = 960,
            quality = 0.8,
            format = 'webp',
        } = options;

        if (typeof document === 'undefined') {
            return file instanceof Blob ? file : new Blob([file]);
        }

        return new Promise((resolve) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                const canvas = document.createElement('canvas');
                try {
                    let { width, height } = img;
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        canvas.width = 0;
                        canvas.height = 0;
                        resolve(file instanceof Blob ? file : new Blob([file]));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(
                        (blob) => {
                            canvas.width = 0;
                            canvas.height = 0;
                            resolve(blob || (file instanceof Blob ? file : new Blob([file])));
                        },
                        `image/${format}`,
                        quality
                    );
                } catch {
                    canvas.width = 0;
                    canvas.height = 0;
                    resolve(file instanceof Blob ? file : new Blob([file]));
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(file instanceof Blob ? file : new Blob([file]));
            };

            img.src = objectUrl;
        });
    }

    /**
     * Sube evidencia fotográfica mediante `mediaDigestorClient.digestAndUploadCas`
     * (`IMAGE_FIELD_EVIDENCE`, `TENANT_PRIVATE`, `tenantId`) con fallback offline en `OfflineStorage` IndexedDB.
     */
    async uploadStockpileImage(
        file: File | Blob,
        stockpileId: string,
        options: UploadOptions = {},
        onProgress?: (progress: number) => void
    ): Promise<UploadResult> {
        const uploadedAt = new Date().toISOString();
        const storedTenant =
            typeof window !== 'undefined'
                ? window.localStorage.getItem('minreport_active_account_id') || ''
                : '';
        const activeTenant = options.tenantId || this.tenantId || storedTenant || 'offline-local';
        const filename =
            options.filename ||
            (file instanceof File && file.name ? file.name : `${stockpileId}_${Date.now()}.webp`);
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        const originalBytes = file.size;

        if (onProgress) onProgress(15);

        if (isOnline) {
            try {
                const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(file, {
                    profile: 'IMAGE_FIELD_EVIDENCE',
                    scope: 'TENANT_PRIVATE',
                    tenantId: activeTenant,
                    filename,
                });
                const optimizedBytes = digested.optimizedBytes || descriptor.optimizedBytes;
                const savingsPct = computeCasSavingsPct(originalBytes, optimizedBytes);
                if (onProgress) onProgress(100);
                return {
                    url: descriptor.downloadUrl,
                    path: descriptor.storagePath,
                    size: optimizedBytes,
                    uploadedAt,
                    sha256: digested.sha256,
                    originalBytes,
                    optimizedBytes,
                    savingsPct,
                };
            } catch (casErr) {
                console.warn('[StorageService] Registro API CAS no disponible, intentando Storage directo / CAS Offline:', casErr);
            }
        }

        let blob: Blob;
        let sha256: string;
        let mimeType = 'image/webp';
        let extension = 'webp';
        let digestedOptimizedBytes: number | undefined;

        try {
            const digested = await mediaDigestorClient.digestFile(file, 'IMAGE_FIELD_EVIDENCE');
            blob = digested.blob;
            sha256 = digested.sha256;
            mimeType = digested.mimeType;
            extension = digested.extension;
            digestedOptimizedBytes = digested.optimizedBytes;
        } catch {
            blob = await this.optimizeImageFallback(file, options);
            sha256 = await computeSha256Hex(await blob.arrayBuffer());
        }

        const optimizedBytes = digestedOptimizedBytes || blob.size;
        const savingsPct = computeCasSavingsPct(originalBytes, optimizedBytes);

        if (onProgress) onProgress(60);

        const cloudPath = `tenants/${activeTenant}/stockpiles/${stockpileId}/images/${sha256}.${extension}`;
        if (firebaseStorage && isOnline) {
            try {
                const storageRef = ref(firebaseStorage, cloudPath);
                await uploadBytes(storageRef, blob, {
                    contentType: mimeType,
                    customMetadata: {
                        tenantId: activeTenant,
                        stockpileId,
                        sha256,
                        uploadedAt,
                    },
                });
                const downloadUrl = await getDownloadURL(storageRef);
                if (onProgress) onProgress(100);
                return {
                    url: downloadUrl,
                    path: cloudPath,
                    size: optimizedBytes,
                    uploadedAt,
                    sha256,
                    originalBytes,
                    optimizedBytes,
                    savingsPct,
                };
            } catch (storageErr) {
                console.warn('[StorageService] Subida Storage diferida a OfflineStorage CAS:', storageErr);
            }
        }

        const offlineRef = `offline-cas://${sha256}.${extension}`;
        try {
            await offlineStorage.putCasBlob({
                sha256,
                blob,
                mimeType,
                profile: 'IMAGE_FIELD_EVIDENCE',
                scope: 'TENANT_PRIVATE',
                tenantId: activeTenant,
                filename,
                originalBytes,
                optimizedBytes,
                updatedAt: Date.now(),
            });
            await syncQueueEngine.enqueueTask('CAS_MEDIA_UPLOAD', {
                sha256,
                scope: 'TENANT_PRIVATE',
                profile: 'IMAGE_FIELD_EVIDENCE',
                tenantId: activeTenant,
                filename,
            });
        } catch (idbErr) {
            console.warn('[StorageService] Error persistiendo blob en OfflineStorage:', idbErr);
        }

        if (onProgress) onProgress(100);
        return {
            url: offlineRef,
            path: offlineRef,
            size: optimizedBytes,
            uploadedAt,
            sha256,
            originalBytes,
            optimizedBytes,
            savingsPct,
        };
    }

    /**
     * Sube malla 3D (.glb) a Firebase Storage (`tenants/${tenantId}/stockpiles/...`)
     * preservando siempre SHA-256 y trazabilidad CAS (`originalBytes`, `optimizedBytes`, `savingsPct`),
     * con fallback offline seguro en `OfflineStorage` (`offline-cas://<sha256>.glb`).
     */
    async uploadStockpileMesh(
        glbData: ArrayBuffer | Blob,
        stockpileId: string,
        measurementId?: string,
        rawOriginalBytes?: number
    ): Promise<UploadResult> {
        const timestamp = Date.now();
        const uploadedAt = new Date().toISOString();
        const storedTenant =
            typeof window !== 'undefined'
                ? window.localStorage.getItem('minreport_active_account_id') || ''
                : '';
        const activeTenant = this.tenantId || storedTenant || 'offline-local';
        const meshId = measurementId || `mesh_${timestamp}`;
        const filename = `${meshId}.glb`;
        const path = `tenants/${activeTenant}/stockpiles/${stockpileId}/meshes/${filename}`;
        const blob =
            glbData instanceof Blob
                ? glbData
                : new Blob([glbData], { type: 'model/gltf-binary' });
        const rawBytesBuffer = glbData instanceof Blob ? await glbData.arrayBuffer() : glbData;
        const sha256 = await computeSha256Hex(rawBytesBuffer);
        const originalBytes = Math.max(
            typeof rawOriginalBytes === 'number' && Number.isFinite(rawOriginalBytes)
                ? rawOriginalBytes
                : blob.size,
            blob.size
        );
        const optimizedBytes = blob.size;
        const savingsPct = computeCasSavingsPct(originalBytes, optimizedBytes);

        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

        if (firebaseStorage && isOnline) {
            try {
                const storageRef = ref(firebaseStorage, path);
                await uploadBytes(storageRef, blob, {
                    contentType: 'model/gltf-binary',
                    customMetadata: {
                        tenantId: activeTenant,
                        stockpileId,
                        measurementId: meshId,
                        sha256,
                        originalBytes: String(originalBytes),
                        optimizedBytes: String(optimizedBytes),
                        savingsPct: String(savingsPct),
                    },
                });
                const downloadUrl = await getDownloadURL(storageRef);
                return {
                    url: downloadUrl,
                    path,
                    size: optimizedBytes,
                    uploadedAt,
                    sha256,
                    originalBytes,
                    optimizedBytes,
                    savingsPct,
                };
            } catch (err) {
                console.warn('[StorageService] Subida de malla GLB diferida a OfflineStorage CAS:', err);
            }
        }

        const offlineRef = `offline-cas://${sha256}.glb`;
        try {
            await offlineStorage.putCasBlob({
                sha256,
                blob,
                mimeType: 'model/gltf-binary',
                profile: 'MESH_3D_GLB',
                scope: 'TENANT_PRIVATE',
                tenantId: activeTenant,
                filename,
                originalBytes,
                optimizedBytes,
                updatedAt: Date.now(),
            });
            await syncQueueEngine.enqueueTask('CAS_MEDIA_UPLOAD', {
                sha256,
                scope: 'TENANT_PRIVATE',
                profile: 'MESH_3D_GLB',
                tenantId: activeTenant,
                filename,
            });
        } catch (idbErr) {
            console.warn('[StorageService] Error persistiendo malla GLB en OfflineStorage:', idbErr);
        }

        return {
            url: offlineRef,
            path: offlineRef,
            size: optimizedBytes,
            uploadedAt,
            sha256,
            originalBytes,
            optimizedBytes,
            savingsPct,
        };
    }

    async listStockpileImages(stockpileId: string): Promise<string[]> {
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!firebaseStorage || !isOnline || !this.tenantId) return [];

        try {
            const folderRef = ref(firebaseStorage, `tenants/${this.tenantId}/stockpiles/${stockpileId}/images`);
            const res = await listAll(folderRef);
            return await Promise.all(res.items.map((item) => getDownloadURL(item)));
        } catch {
            return [];
        }
    }

    async getImageUrl(url: string): Promise<string> {
        const { resolvedUrl } = await resolveStockpileImageUrl(url);
        return resolvedUrl;
    }

    async deleteImage(path: string): Promise<void> {
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (
            !firebaseStorage ||
            !isOnline ||
            !path ||
            path.startsWith('data:') ||
            path.startsWith('offline-cas://')
        ) {
            return;
        }

        try {
            const fileRef = ref(firebaseStorage, path);
            await deleteObject(fileRef);
        } catch (err) {
            console.warn('[StorageService] No se pudo eliminar objeto remoto:', err);
        }
    }

    async deleteAllStockpileImages(stockpileId: string): Promise<void> {
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!firebaseStorage || !isOnline || !this.tenantId) return;

        try {
            const folderRef = ref(firebaseStorage, `tenants/${this.tenantId}/stockpiles/${stockpileId}/images`);
            const res = await listAll(folderRef);
            await Promise.all(res.items.map((item) => deleteObject(item)));
        } catch (err) {
            console.warn('[StorageService] No se pudieron eliminar imágenes del acopio:', err);
        }
    }
}

export const storageService = new StorageService();
