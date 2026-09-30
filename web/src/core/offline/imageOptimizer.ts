/**
 * MINREPORT - OPTIMIZADOR DE IMÁGENES EN EDGE (Capa 1 / Capa 2)
 * Cumple con el estándar EDGE-OPTIMIZER & Minimalismo Industrial.
 *
 * Transforma evidencias de terreno, fotos de maquinaria y escaneos de guías
 * a formato WebP optimizado en memoria antes de persistir en IndexedDB
 * o sincronizar hacia Cloud Storage/Firestore.
 */

export type ImagePreset = 'EVIDENCE' | 'SCAN' | 'THUMBNAIL';

interface PresetConfig {
    maxWidth: number;
    maxHeight: number;
    quality: number; // 0.0 a 1.0
}

const PRESET_CONFIGS: Record<ImagePreset, PresetConfig> = {
    EVIDENCE: {
        maxWidth: 1024,
        maxHeight: 1024,
        quality: 0.70 // Máximo detalle para pernos, fisuras y desgastes de neumáticos
    },
    SCAN: {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.60 // Alto contraste para guías de despacho, tags y albaranes
    },
    THUMBNAIL: {
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.50 // Previsualizaciones ágiles en grilla de flota
    }
};

export interface OptimizedImageResult {
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
    sizeBytes: number;
    originalSizeBytes: number;
    compressionRatio: number;
}

export class ImageOptimizer {
    /**
     * Optimiza un archivo de imagen (File o Blob) en el cliente usando HTML5 Canvas.
     */
    public static async optimizeFile(
        file: File | Blob,
        preset: ImagePreset = 'EVIDENCE'
    ): Promise<OptimizedImageResult> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const result = this.processImage(img, file.size, preset);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = () => reject(new Error('Fallo al cargar la imagen en memoria para optimización.'));
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Error al leer el archivo en el navegador.'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Optimiza una cadena Base64 (ej. obtenida directamente desde @capacitor/camera).
     */
    public static async optimizeBase64(
        base64Data: string,
        preset: ImagePreset = 'EVIDENCE'
    ): Promise<OptimizedImageResult> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const originalEstimatedSize = Math.round((base64Data.length * 3) / 4);
                    const result = this.processImage(img, originalEstimatedSize, preset);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Fallo al decodificar imagen base64.'));
            img.src = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
        });
    }

    /**
     * Procesa la imagen dibujándola en un canvas con las dimensiones paramétricas del preset.
     */
    private static processImage(
        img: HTMLImageElement,
        originalSizeBytes: number,
        preset: ImagePreset
    ): OptimizedImageResult {
        const config = PRESET_CONFIGS[preset];
        let { width, height } = img;

        // Calcular ratio preservando proporciones
        if (width > config.maxWidth || height > config.maxHeight) {
            const widthRatio = config.maxWidth / width;
            const heightRatio = config.maxHeight / height;
            const ratio = Math.min(widthRatio, heightRatio);

            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('No se pudo inicializar contexto 2D de Canvas para procesamiento.');
        }

        // Calidad de dibujo alta en composición
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convertir preferentemente a WebP; con fallback seguro a JPEG si el runtime no lo soporta
        let mimeType = 'image/webp';
        let dataUrl = canvas.toDataURL(mimeType, config.quality);

        if (!dataUrl.startsWith('data:image/webp')) {
            mimeType = 'image/jpeg';
            dataUrl = canvas.toDataURL(mimeType, config.quality);
        }

        const blob = this.dataURLToBlob(dataUrl, mimeType);
        const sizeBytes = blob.size;
        const compressionRatio = originalSizeBytes > 0 ? (1 - sizeBytes / originalSizeBytes) * 100 : 0;

        return {
            blob,
            dataUrl,
            width,
            height,
            sizeBytes,
            originalSizeBytes,
            compressionRatio: Math.max(0, Math.round(compressionRatio * 10) / 10)
        };
    }

    private static dataURLToBlob(dataURL: string, mimeType: string): Blob {
        const byteString = atob(dataURL.split(',')[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        return new Blob([ab], { type: mimeType });
    }
}
