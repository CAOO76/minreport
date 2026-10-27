/**
 * StorageService — Servicio de almacenamiento de imágenes WebP y mallas .glb en Firebase Storage
 *
 * ARQUITECTURA:
 *  - Optimiza imágenes vía Canvas a formato WebP ligero.
 *  - Sube imágenes WebP y mallas .glb a Firebase Storage bajo `tenants/${tenantId}/stockpiles/...`.
 *  - Si el dispositivo está en terreno sin red (Offline), aplica fallback local seguro (DataURL Base64)
 *    para sincronización diferida sin pérdida de evidencia.
 */

import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getStorageInstance } from '../config/firebase.config';

export interface UploadOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp';
    tenantId?: string;
}

export interface UploadResult {
    url: string;
    path: string;
    size: number;
    uploadedAt: string;
}

export class StorageService {
    private tenantId: string = 'faena-minreport';

    public setTenantId(tenantId: string): void {
        if (tenantId && tenantId.trim().length > 0) {
            this.tenantId = tenantId.trim();
        }
    }

    public getTenantId(): string {
        return this.tenantId;
    }

    /**
     * Optimizar imagen via canvas y retornar como Blob comprimido (WebP por defecto)
     */
    private async optimizeImage(file: File | Blob, options: UploadOptions = {}): Promise<Blob> {
        const {
            maxWidth = 1280,
            maxHeight = 960,
            quality = 0.80,
            format = 'webp'
        } = options;

        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);
                const canvas = document.createElement('canvas');
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
                    resolve(file instanceof Blob ? file : new Blob([file]));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob falló')),
                    `image/${format}`,
                    quality
                );
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(file instanceof Blob ? file : new Blob([file]));
            };

            img.src = url;
        });
    }

    private blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Subir imagen WebP a Firebase Storage (`tenants/${tenantId}/stockpiles/...`)
     * con fallback local seguro si está offline.
     */
    async uploadStockpileImage(
        file: File | Blob,
        stockpileId: string,
        options: UploadOptions = {},
        onProgress?: (progress: number) => void
    ): Promise<UploadResult> {
        const timestamp = Date.now();
        const format = options.format || 'webp';
        const activeTenant = options.tenantId || this.tenantId || 'faena-minreport';
        const path = `tenants/${activeTenant}/stockpiles/${stockpileId}/images/${stockpileId}_${timestamp}.${format}`;

        try {
            if (onProgress) onProgress(10);
            const optimized = await this.optimizeImage(file, { ...options, format });
            if (onProgress) onProgress(50);

            const storage = getStorageInstance();
            const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

            if (storage && isOnline) {
                try {
                    const storageRef = ref(storage, path);
                    await uploadBytes(storageRef, optimized, {
                        contentType: `image/${format}`,
                        customMetadata: {
                            tenantId: activeTenant,
                            stockpileId,
                            uploadedAt: new Date().toISOString()
                        }
                    });
                    if (onProgress) onProgress(90);
                    const downloadUrl = await getDownloadURL(storageRef);
                    if (onProgress) onProgress(100);
                    console.log(`[StorageService] Imagen WebP subida a Firebase Storage (${(optimized.size / 1024).toFixed(0)}KB): ${path}`);
                    return {
                        url: downloadUrl,
                        path,
                        size: optimized.size,
                        uploadedAt: new Date().toISOString(),
                    };
                } catch (cloudError) {
                    console.warn('[StorageService] Fallo subida a Firebase Storage, activando fallback local seguro:', cloudError);
                }
            }

            // Fallback local seguro (Offline-First)
            const base64Url = await this.blobToDataUrl(optimized);
            if (onProgress) onProgress(100);
            console.log(`[StorageService] Imagen WebP guardada en fallback local (${(optimized.size / 1024).toFixed(0)}KB)`);

            return {
                url: base64Url,
                path,
                size: optimized.size,
                uploadedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[StorageService] Error procesando imagen:', error);
            if (onProgress) onProgress(100);
            const base64Url = await this.blobToDataUrl(file);
            return { url: base64Url, path, size: file.size, uploadedAt: new Date().toISOString() };
        }
    }

    /**
     * Subir malla 3D (.glb) a Firebase Storage (`tenants/${tenantId}/stockpiles/...`)
     * con fallback local seguro si está offline.
     */
    async uploadStockpileMesh(
        glbData: ArrayBuffer | Blob,
        stockpileId: string,
        measurementId?: string
    ): Promise<UploadResult> {
        const timestamp = Date.now();
        const activeTenant = this.tenantId || 'faena-minreport';
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
                        measurementId: meshId
                    }
                });
                const downloadUrl = await getDownloadURL(storageRef);
                console.log(`[StorageService] Malla GLB subida a Firebase Storage (${(blob.size / 1024).toFixed(1)}KB): ${path}`);
                return {
                    url: downloadUrl,
                    path,
                    size: blob.size,
                    uploadedAt: new Date().toISOString()
                };
            } catch (err) {
                console.warn('[StorageService] Fallo subida de malla GLB a Firebase Storage, usando fallback local:', err);
            }
        }

        const base64Url = await this.blobToDataUrl(blob);
        return {
            url: base64Url,
            path,
            size: blob.size,
            uploadedAt: new Date().toISOString()
        };
    }

    async listStockpileImages(stockpileId: string): Promise<string[]> {
        const storage = getStorageInstance();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!storage || !isOnline) return [];

        try {
            const folderRef = ref(storage, `tenants/${this.tenantId}/stockpiles/${stockpileId}/images`);
            const res = await listAll(folderRef);
            return await Promise.all(res.items.map(item => getDownloadURL(item)));
        } catch {
            return [];
        }
    }

    async getImageUrl(url: string): Promise<string> {
        return url;
    }

    async deleteImage(path: string): Promise<void> {
        const storage = getStorageInstance();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (!storage || !isOnline || !path || path.startsWith('data:')) return;

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
            await Promise.all(res.items.map(item => deleteObject(item)));
        } catch (err) {
            console.warn('[StorageService] No se pudieron eliminar imágenes del acopio:', err);
        }
    }
}

export const storageService = new StorageService();

