import type { EphemeralIdentificationImageInput } from '../../../contracts';

/**
 * PROCESADOR EFÍMERO `RAM-ONLY` PARA IDENTIFICACIÓN ÓPTICA DE CATÁLOGO (Ley N° 21.719)
 *
 * Regla Soberana de Dominio:
 * - El alta en Catálogo Maestro NO corresponde a registro de flota privada.
 * - Las imágenes adjuntas (placa metálica OEM/VIN, placa de transmisión/motor, selector de cabina
 *   o vista 3/4 de referencia) se redimensionan exclusivamente en memoria volátil del navegador (`RAM`)
 *   para decodificar el modelo y su configuración mecánica exacta.
 * - CERO llamadas a `/api/media/preflight`, CERO persistencia en Cloud Storage (`CasStorageService`),
 *   CERO registro en `media_registry` ni en `IndexedDB`.
 */

export const MAX_EPHEMERAL_ID_IMAGES = 3;
const MAX_DIMENSION_PX = 1600;
const WEBP_QUALITY = 0.84;

export interface EphemeralIdentificationImagePreview {
    id: string;
    name: string;
    previewObjectUrl: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    base64Data: string;
    originalBytes: number;
    ephemeralBytes: number;
}

function blobToPureBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const res = typeof reader.result === 'string' ? reader.result : '';
            const commaIdx = res.indexOf(',');
            resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => reject(new Error('No fue posible codificar imagen efímera en memoria.'));
        reader.readAsDataURL(blob);
    });
}

function loadHtmlImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Archivo de imagen inválido o corrupto.'));
        };
        img.src = url;
    });
}

export async function prepareEphemeralIdentificationImage(
    file: File
): Promise<EphemeralIdentificationImagePreview> {
    if (!file || !String(file.type || '').startsWith('image/')) {
        throw new Error('Formato no admitido. Seleccione una imagen JPG, PNG o WebP.');
    }

    const originalBytes = file.size;
    const img = await loadHtmlImageFromBlob(file);
    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    let encodedBlob: Blob;
    try {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Contexto gráfico 2D no disponible.');
        }
        ctx.drawImage(img, 0, 0, dstW, dstH);

        encodedBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (webpBlob) => {
                    if (webpBlob && webpBlob.size > 0) {
                        resolve(webpBlob);
                        return;
                    }
                    canvas.toBlob(
                        (jpegBlob) => {
                            if (jpegBlob && jpegBlob.size > 0) {
                                resolve(jpegBlob);
                            } else {
                                reject(new Error('No se pudo comprimir la imagen en memoria.'));
                            }
                        },
                        'image/jpeg',
                        WEBP_QUALITY
                    );
                },
                'image/webp',
                WEBP_QUALITY
            );
        });
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }

    const resolvedMime: 'image/jpeg' | 'image/png' | 'image/webp' =
        encodedBlob.type === 'image/webp'
            ? 'image/webp'
            : encodedBlob.type === 'image/png'
              ? 'image/png'
              : 'image/jpeg';

    const base64Data = await blobToPureBase64(encodedBlob);
    const previewObjectUrl = URL.createObjectURL(encodedBlob);

    return {
        id: `ephem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || 'identificacion.webp',
        previewObjectUrl,
        mimeType: resolvedMime,
        base64Data,
        originalBytes,
        ephemeralBytes: encodedBlob.size,
    };
}

export function toEphemeralApiPayload(
    items: EphemeralIdentificationImagePreview[]
): EphemeralIdentificationImageInput[] {
    return items.slice(0, MAX_EPHEMERAL_ID_IMAGES).map((item) => ({
        mimeType: item.mimeType,
        base64Data: item.base64Data,
    }));
}

export function revokeEphemeralImagePreviews(items: EphemeralIdentificationImagePreview[]): void {
    for (const item of items) {
        if (item?.previewObjectUrl) {
            try {
                URL.revokeObjectURL(item.previewObjectUrl);
            } catch {
                // Ignorar URL ya liberada
            }
        }
    }
}

export function formatEphemeralBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

