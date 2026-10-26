/**
 * StorageService — Servicio de almacenamiento de imágenes
 *
 * ARQUITECTURA (sin Firebase Storage):
 *  - Optimiza la imagen con canvas (reduce tamaño)
 *  - Convierte a base64 DataURL (persiste en SecureContext/localStorage)
 *  - Las URLs base64 son válidas indefinidamente en el dispositivo
 *  - En producción: MINREPORT SDK puede subir a Firebase Storage vía su propia capa
 *
 * Limitación conocida: base64 ocupa ~33% más que el binario original.
 * Para imágenes >1MB comprimidas, evaluar usar Capacitor Filesystem en versión futura.
 */

export interface UploadOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp';
}

export interface UploadResult {
    url: string;   // DataURL base64 — persistente, sin dependencia de red
    path: string;  // Ruta lógica (para referencia futura en Firebase Storage real)
    size: number;
    uploadedAt: string;
}

export class StorageService {
    private readonly BUCKET_PATH = 'stockpile-images';

    /**
     * Optimizar imagen via canvas y retornar como Blob comprimido
     */
    private async optimizeImage(file: File | Blob, options: UploadOptions = {}): Promise<Blob> {
        const {
            maxWidth = 1280,
            maxHeight = 960,
            quality = 0.80,
            format = 'jpeg'
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
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob falló')),
                    `image/${format}`,
                    quality
                );
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                // Si el canvas falla, retornar original sin optimizar
                resolve(file instanceof Blob ? file : new Blob([file]));
            };

            img.src = url;
        });
    }

    /**
     * Subir imagen (en desarrollo: optimizar y convertir a base64 persistente)
     * En producción futura: MINREPORT SDK puede interceptar y subir a Firebase Storage
     */
    async uploadStockpileImage(
        file: File | Blob,
        stockpileId: string,
        options: UploadOptions = {},
        onProgress?: (progress: number) => void
    ): Promise<UploadResult> {
        const timestamp = Date.now();
        const format = options.format || 'jpeg';
        const path = `${this.BUCKET_PATH}/${stockpileId}/${stockpileId}_${timestamp}.${format}`;

        try {
            if (onProgress) onProgress(10);
            const optimized = await this.optimizeImage(file, options);
            if (onProgress) onProgress(70);

            // Convertir a base64 DataURL — persiste en localStorage/SecureContext
            const base64Url = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(optimized);
            });

            if (onProgress) onProgress(100);
            console.log(`[StorageService] ✅ Imagen optimizada y guardada localmente (${(optimized.size / 1024).toFixed(0)}KB)`);

            return {
                url: base64Url,
                path,
                size: optimized.size,
                uploadedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[StorageService] Error procesando imagen:', error);
            // Fallback: intentar usar el archivo original como base64
            if (onProgress) onProgress(100);
            const base64Url = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            return { url: base64Url, path, size: file.size, uploadedAt: new Date().toISOString() };
        }
    }

    /**
     * Las imágenes se almacenan como DataURL en SecureContext.
     * Para listar imágenes, se usa el DataService (que ya tiene la URL del activo).
     * Este método existe por compatibilidad con el plugin.ts.
     */
    async listStockpileImages(_stockpileId: string): Promise<string[]> {
        // Las URLs ya están en el activo (initial_photo_url, last_photo_url, thumbnail_url)
        // No se necesita un listado separado en este modo de almacenamiento
        return [];
    }

    async getImageUrl(url: string): Promise<string> {
        return url; // Ya es una DataURL o una URL persistente
    }

    async deleteImage(_path: string): Promise<void> {
        // En el modo local, las imágenes se eliminan al eliminar el activo
    }

    async deleteAllStockpileImages(_stockpileId: string): Promise<void> {
        // Ídem
    }
}

export const storageService = new StorageService();
