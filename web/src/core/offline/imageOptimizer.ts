/**
 * MINREPORT - OPTIMIZADOR DE IMÁGENES EN EDGE v4.0 (Delegado a `MinreportMediaDigestor`)
 * Mantiene compatibilidad 100% con firmas previas (`EVIDENCE` | `SCAN` | `THUMBNAIL`)
 * ejecutando digestión WebP fuera del hilo principal (`OffscreenCanvas` Worker) + huella `SHA-256` / `pHash`.
 */
import type { MediaDigestionProfile } from '../../contracts/media.contracts';
import { mediaDigestorClient } from '../media/MediaDigestorClient';

export type ImagePreset = 'EVIDENCE' | 'SCAN' | 'THUMBNAIL' | 'TECHNICAL_HD' | 'ISO_SYMBOL';

const PRESET_TO_PROFILE: Record<ImagePreset, MediaDigestionProfile> = {
    TECHNICAL_HD: 'IMAGE_TECHNICAL_HD',
    EVIDENCE: 'IMAGE_FIELD_EVIDENCE',
    SCAN: 'IMAGE_FIELD_EVIDENCE',
    THUMBNAIL: 'IMAGE_THUMBNAIL',
    ISO_SYMBOL: 'IMAGE_ISO_SYMBOL',
};

export interface OptimizedImageResult {
    blob: Blob;
    dataUrl: string;
    sha256: string;
    phashHex?: string;
    width: number;
    height: number;
    sizeBytes: number;
    originalSizeBytes: number;
    compressionRatio: number;
}

export class ImageOptimizer {
    public static async optimizeFile(
        file: File | Blob,
        preset: ImagePreset = 'EVIDENCE'
    ): Promise<OptimizedImageResult> {
        const profile = PRESET_TO_PROFILE[preset] || 'IMAGE_FIELD_EVIDENCE';
        const digested = await mediaDigestorClient.digestImage(file, profile as any, true);
        const dataUrl = digested.dataUrl || (await mediaDigestorClient.blobToDataUrl(digested.blob));
        return {
            blob: digested.blob,
            dataUrl,
            sha256: digested.sha256,
            phashHex: digested.phashHex,
            width: digested.width || 0,
            height: digested.height || 0,
            sizeBytes: digested.optimizedBytes,
            originalSizeBytes: digested.originalBytes,
            compressionRatio: Math.round(digested.savingsRatio * 1000) / 10,
        };
    }

    public static async optimizeBase64(
        base64Data: string,
        preset: ImagePreset = 'EVIDENCE'
    ): Promise<OptimizedImageResult> {
        const normalized = base64Data.startsWith('data:')
            ? base64Data
            : `data:image/jpeg;base64,${base64Data}`;
        const commaIdx = normalized.indexOf(',');
        const mimeMatch = normalized.slice(0, commaIdx).match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const rawBytes = atob(normalized.slice(commaIdx + 1));
        const u8 = new Uint8Array(rawBytes.length);
        for (let i = 0; i < rawBytes.length; i++) {
            u8[i] = rawBytes.charCodeAt(i);
        }
        const blobIn = new Blob([u8], { type: mimeType });
        return this.optimizeFile(blobIn, preset);
    }
}
