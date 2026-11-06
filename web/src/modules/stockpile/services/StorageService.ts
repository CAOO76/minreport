/**
 * StorageService — Servicio CAS Multimedia de Stockpile Control (Cero Base64 en Firestore)
 *
 * ARQUITECTURA:
 *  - Conecta toda captura/carga de fotos a `mediaDigestorClient.digestAndUploadCas`
 *    (`IMAGE_FIELD_EVIDENCE`, `scope: 'TENANT_PRIVATE'`, `tenantId`).
 *  - Si el endpoint API no responde pero hay red, sube el blob WebP digerido a Firebase Storage
 *    bajo `tenants/${tenantId}/stockpiles/...`.
 *  - Si el dispositivo está en terreno sin red (Offline), guarda el Blob optimizado en IndexedDB
 *    (`offlineStorage.putCasBlob`) y retorna una referencia compacta `offline-cas://<sha256>.<ext>`
 *    (< 90 bytes), jamás inyectando strings Base64 en documentos Firestore.
 */

import { useState, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getStorageInstance } from '../config/firebase.config';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { offlineStorage } from '../../../core/offline/OfflineStorage';

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
 * Resuelve referencias locales `offline-cas://<sha256>.<ext>` desde IndexedDB (`offlineStorage`)
 * a Object URLs temporales para renderizado en UI o exportación PDF offline.
 */
export async function resolveStockpileImageUrl(url?: string | null): Promise<{ resolvedUrl: string; revoke?: () => void }> {
    if (!url) return { resolvedUrl: '' };
    if (!url.startsWith('offline-cas://')) {
        return { resolvedUrl: url };
    }
    try {
        const refPart = url.replace('offline-cas://', '');
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

/**
 * Hook React con liberación automática de Object URL para visualizar `offline-cas://...` o URLs remotas CAS.
 */
export function useResolvedStockpileImage(url?: string | null): string {
    const [resolved, setResolved] = useState<string>(() =>
        url && !url.startsWith('offline-cas://') ? url : ''
    );

    useEffect(() => {
        let active = true;
        let cleanup: (() => void) | undefined;

        if (!url) {
            setResolved('');
            return;
        }
        if (!url.startsWith('offline-cas://')) {
            setResolved(url);
            return;
        }

        resolveStockpileImageUrl(url).then(({ resolvedUrl, revoke }) => {
            if (!active) {
                if (revoke) revoke();
                return;
            }
            cleanup = revoke;
            setResolved(resolvedUrl);
        });

        return () => {
            active = false;
            if (cleanup) cleanup();
        };
    }, [url]);

    return resolved;
}

export class StorageService {
    private tenantId: string = '';

    public setTenantId(tenantId: string): void {
        if (tenantId && tenantId.trim().length > 0) {
            this.tenantId = tenantId.trim();
        }
    }

    public getTenantId(): string {
        return this.tenantId;
    }

    /**
     * Optimiza imagen vía `<canvas>` liberando explícitamente la memoria GPU/RAM (`width = 0; height = 0`)
     * como respaldo si el Web Worker no está disponible en el entorno embebido.
     */
    private async optimizeImageFallback(file: File | Blob, options: UploadOptions = {}): Promise<Blob> {
        const {
            maxWidth = 1280,
            maxHeight = 960,
            quality = 0.80,
            format = 'webp'
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
     * (`IMAGE_FIELD_EVIDENCE`, `TENANT_PRIVATE`, `tenantId`) con fallback offline en `OfflineStorage` IndexedDB
     * (`offline-cas://<sha256>.<ext>`), prohibiendo 100% strings Base64 en Firestore.
     */
    async uploadStockpileImage(
        file: File | Blob,
        stockpileId: string,
        options: UploadOptions = {},
        onProgress?: (progress: number) => void
    ): Promise<UploadResult> {
        const uploadedAt = new Date().toISOString();
        const activeTenant = options.tenantId || this.tenantId || 'offline-local';
        const filename =
            options.filename ||
            (file instanceof File && file.name ? file.name : `${stockpileId}_${Date.now()}.webp`);
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

        if (onProgress) onProgress(15);

        // 1. Vía primaria: Universal Media Digestor + CAS v4.0 (`TENANT_PRIVATE`)
        if (isOnline) {
            try {
                const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(file, {
                    profile: 'IMAGE_FIELD_EVIDENCE',
                    scope: 'TENANT_PRIVATE',
                    tenantId: activeTenant,
                    filename,
                });
                if (onProgress) onProgress(100);
                return {
                    url: descriptor.downloadUrl,
                    path: descriptor.storagePath,
                    size: digested.optimizedBytes,
                    uploadedAt,
                    sha256: digested.sha256,
                };
            } catch (casErr) {
                console.warn('[StorageService] Registro API CAS no disponible, intentando Storage directo / CAS Offline:', casErr);
            }
        }

        // 2. Digerir localmente a WebP optimizado + SHA-256
        let blob: Blob;
        let sha256: string;
        let mimeType = 'image/webp';
        let extension = 'webp';
        const originalBytes = file.size;

        try {
            const digested = await mediaDigestorClient.digestFile(file, 'IMAGE_FIELD_EVIDENCE');
            blob = digested.blob;
            sha256 = digested.sha256;
            mimeType = digested.mimeType;
            extension = digested.extension;
        } catch {
            blob = await this.optimizeImageFallback(file, options);
            sha256 = await computeSha256Hex(await blob.arrayBuffer());
        }

        if (onProgress) onProgress(60);

        // 3. Si hay conexión a Firebase Storage, subir a ruta aislada del tenant
        const storage = getStorageInstance();
        const cloudPath = `tenants/${activeTenant}/stockpiles/${stockpileId}/images/${sha256}.${extension}`;
        if (storage && isOnline) {
            try {
                const storageRef = ref(storage, cloudPath);
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
                    size: blob.size,
                    uploadedAt,
                    sha256,
                };
            } catch (storageErr) {
                console.warn('[StorageService] Subida Storage diferida a OfflineStorage CAS:', storageErr);
            }
        }

        // 4. Fallback Offline-First seguro en IndexedDB (`offline_cas_blobs`) — CERO Base64 en Firestore
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
                optimizedBytes: blob.size,
                updatedAt: Date.now(),
            });
        } catch (idbErr) {
            console.warn('[StorageService] Error persistiendo blob en OfflineStorage:', idbErr);
        }

        if (onProgress) onProgress(100);
        return {
            url: offlineRef,
            path: offlineRef,
            size: blob.size,
            uploadedAt,
            sha256,
        };
    }

    /**
     * Sube malla 3D (.glb) a Firebase Storage (`tenants/${tenantId}/stockpiles/...`)
     * con fallback offline seguro en `OfflineStorage` (`offline-cas://<sha256>.glb`, cero Base64).
     */
    async uploadStockpileMesh(
        glbData: ArrayBuffer | Blob,
        stockpileId: string,
        measurementId?: string
    ): Promise<UploadResult> {
        const timestamp = Date.now();
        const uploadedAt = new Date().toISOString();
        const activeTenant = this.tenantId || 'offline-local';
        const meshId = measurementId || `mesh_${timestamp}`;
        const path = `tenants/${activeTenant}/stockpiles/${stockpileId}/meshes/${meshId}.glb`;
        const blob = glbData instanceof Blob ? glbData : new Blob([glbData], { type: 'model/gltf-binary' });

        const storage = getStorageInstance();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

        if (storage && isOnline) {
            try {
                const storageRef = ref(storage, path);
                await uploadBytes(storageRef, blob, {
                    contentType: 'model/gltf-binary',
                    customMetadata: {
                        tenantId: activeTenant,
                        stockpileId,
                        measurementId: meshId,
                    },
                });
                const downloadUrl = await getDownloadURL(storageRef);
                return {
                    url: downloadUrl,
                    path,
                    size: blob.size,
                    uploadedAt,
                };
            } catch (err) {
                console.warn('[StorageService] Subida de malla GLB diferida a OfflineStorage CAS:', err);
            }
        }

        const sha256 = await computeSha256Hex(await blob.arrayBuffer());
        const offlineRef = `offline-cas://${sha256}.glb`;
        try {
            await offlineStorage.putCasBlob({
                sha256,
                blob,
                mimeType: 'model/gltf-binary',
                profile: 'MESH_3D_GLB',
                scope: 'TENANT_PRIVATE',
                tenantId: activeTenant,
                filename: `${meshId}.glb`,
                originalBytes: blob.size,
                optimizedBytes: blob.size,
                updatedAt: Date.now(),
            });
        } catch (idbErr) {
            console.warn('[StorageService] Error persistiendo malla GLB en OfflineStorage:', idbErr);
        }

        return {
            url: offlineRef,
            path: offlineRef,
            size: blob.size,
            uploadedAt,
            sha256,
        };
    }

    async listStockpileImages(stockpileId: string): Promise<string[]> {
        const storage = getStorageInstance();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!storage || !isOnline) return [];

        try {
            const folderRef = ref(storage, `tenants/${this.tenantId}/stockpiles/${stockpileId}/images`);
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
        const storage = getStorageInstance();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!storage || !isOnline || !path || path.startsWith('data:') || path.startsWith('offline-cas://')) return;

        try {
            const fileRef = ref(storage, path);
            await deleteObject(fileRef);
        } catch (err) {
            console.warn('[StorageService] No se pudo eliminar objeto remoto:', err);
        }
    }

    async deleteAllStockpileImages(stockpileId: string): Promise<void> {
        const storage = getStorageInstance();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!storage || !isOnline) return;

        try {
            const folderRef = ref(storage, `tenants/${this.tenantId}/stockpiles/${stockpileId}/images`);
            const res = await listAll(folderRef);
            await Promise.all(res.items.map((item) => deleteObject(item)));
        } catch (err) {
            console.warn('[StorageService] No se pudieron eliminar imágenes del acopio:', err);
        }
    }
}

export const storageService = new StorageService();

