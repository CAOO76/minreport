/**
 * Image Optimizer Utility
 * Resizes and compresses images on the client side to optimize memory and network usage.
 */

export type OptimizationProfile = 'THUMBNAIL' | 'SCANNER_DATA' | 'HD_REPORT';

interface ResizeOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number;
}

const PROFILES: Record<OptimizationProfile, ResizeOptions> = {
    THUMBNAIL: { maxWidth: 160, maxHeight: 160, quality: 0.6 },
    SCANNER_DATA: { maxWidth: 1280, maxHeight: 960, quality: 0.75 },
    HD_REPORT: { maxWidth: 1920, maxHeight: 1440, quality: 0.85 }
};

export const optimizeImage = async (
    sourceUrl: string,
    profile: OptimizationProfile
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const { maxWidth, maxHeight, quality } = PROFILES[profile];
            let width = img.width;
            let height = img.height;

            // Calculate new dimensions
            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            // High quality drawing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to data URL
            const optimizedUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(optimizedUrl);
        };

        img.onerror = (err) => reject(err);
        img.src = sourceUrl;
    });
};
