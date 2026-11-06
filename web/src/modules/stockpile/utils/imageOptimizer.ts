/**
 * STOCKPILE CONTROL — Adaptador unificado hacia `MinreportMediaDigestor` (v4.0)
 * Reemplaza la compresión aislada en el hilo principal por el motor transversal Web Worker + CAS.
 */
import { ImageOptimizer, type ImagePreset } from '../../../core/offline/imageOptimizer';

export type ImageProfile = 'evidence' | 'scan' | 'thumbnail' | 'technical_hd' | 'custom';

interface CompressionOptions {
    profile?: ImageProfile;
    maxWidth?: number;
    quality?: number;
}

const PROFILE_TO_PRESET: Record<ImageProfile, ImagePreset> = {
    technical_hd: 'TECHNICAL_HD',
    evidence: 'EVIDENCE',
    scan: 'SCAN',
    thumbnail: 'THUMBNAIL',
    custom: 'EVIDENCE',
};

export const compressImage = async (
    fileOrBase64: File | string,
    options: CompressionOptions | number = { profile: 'evidence' },
    _oldQuality?: number
): Promise<string> => {
    let preset: ImagePreset = 'EVIDENCE';
    if (typeof options === 'number') {
        preset = options >= 1600 ? 'TECHNICAL_HD' : options <= 500 ? 'THUMBNAIL' : 'EVIDENCE';
    } else if (options.profile) {
        preset = PROFILE_TO_PRESET[options.profile] || 'EVIDENCE';
    }

    if (typeof fileOrBase64 === 'string') {
        const res = await ImageOptimizer.optimizeBase64(fileOrBase64, preset);
        return res.dataUrl;
    }

    const res = await ImageOptimizer.optimizeFile(fileOrBase64, preset);
    return res.dataUrl;
};
