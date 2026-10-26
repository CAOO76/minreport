/**
 * Utility for client-side image compression and resizing using HTML5 Canvas.
 * Used to reduce memory footprint and optimization storage quota.
 */

/**
 * Perfiles de optimización dictados por EDGE-OPTIMIZER
 */
export type ImageProfile = 'evidence' | 'scan' | 'thumbnail' | 'custom';

interface CompressionOptions {
    profile?: ImageProfile;
    maxWidth?: number;
    quality?: number;
}

const PROFILE_SETTINGS: Record<ImageProfile, { maxWidth: number; quality: number }> = {
    evidence: { maxWidth: 1024, quality: 0.70 },
    scan: { maxWidth: 800, quality: 0.60 },
    thumbnail: { maxWidth: 400, quality: 0.50 },
    custom: { maxWidth: 1024, quality: 0.70 } // Defaults
};

/**
 * Compresses and resizes an image to WEBP format.
 * 
 * @param fileOrBase64 - The input image as a File object or base64 DataURL.
 * @param options - Profile or custom settings. Defaults to 'evidence' profile.
 * @returns A promise that resolves to the compressed image as a WEBP base64 DataURL.
 */
export const compressImage = async (
    fileOrBase64: File | string,
    options: CompressionOptions | number = { profile: 'evidence' },
    oldQuality?: number // for backwards compatibility if needed
): Promise<string> => {
    
    // Resolve settings based on profile or custom inputs
    let settings = PROFILE_SETTINGS.evidence;
    if (typeof options === 'number') {
        // Backwards compatibility for old calls: compressImage(file, maxWidth, quality)
        settings = { maxWidth: options, quality: oldQuality || 0.7 };
    } else if (options.profile && options.profile !== 'custom') {
        settings = PROFILE_SETTINGS[options.profile];
    } else {
        settings = {
            maxWidth: options.maxWidth || PROFILE_SETTINGS.evidence.maxWidth,
            quality: options.quality ?? PROFILE_SETTINGS.evidence.quality
        };
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        let objectUrl: string | null = null;

        img.onload = () => {
            // Memory cleanup: revoke object URL if created
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }

            const canvas = document.createElement('canvas');
            let { width, height } = img;

            // Logic: Maintain aspect ratio and strictly avoid upscaling
            if (width > settings.maxWidth) {
                const ratio = settings.maxWidth / width;
                width = settings.maxWidth;
                height = Math.round(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            // High quality resizing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            ctx.drawImage(img, 0, 0, width, height);

            // Export as WEBP with specified quality for maximum EDGE resilience
            const compressedBase64 = canvas.toDataURL('image/webp', settings.quality);
            
            // Explicitly clear references for GC
            canvas.width = 0;
            canvas.height = 0;
            
            resolve(compressedBase64);
        };

        img.onerror = () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            reject(new Error('Failed to load image for compression'));
        };

        // Handle input type
        if (fileOrBase64 instanceof File) {
            objectUrl = URL.createObjectURL(fileOrBase64);
            img.src = objectUrl;
        } else {
            img.src = fileOrBase64;
        }
    });
};
