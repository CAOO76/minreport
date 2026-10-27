import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useBranding, getCanonicalBrandingPath } from '../context/BrandingContext';

export type LogoVariant = 'isotype' | 'logotype' | 'imagotype' | 'imagotypeVertical';

interface BrandLogoProps {
    variant?: LogoVariant;
    className?: string;
    forcedTheme?: 'light' | 'dark';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className = '', forcedTheme }) => {
    const { theme: contextTheme } = useTheme();
    const { branding } = useBranding();
    const theme = forcedTheme || contextTheme;

    const officialLocalUrl = getCanonicalBrandingPath(variant);
    const [imgSrc, setImgSrc] = useState<string>(officialLocalUrl);
    const [hasError, setHasError] = useState<boolean>(false);

    useEffect(() => {
        const firestoreUrl = branding?.[theme]?.[variant] || branding?.svgDataUris?.[variant];
        if (firestoreUrl && firestoreUrl.trim() !== '') {
            setImgSrc(firestoreUrl);
            setHasError(false);
        } else {
            setImgSrc(officialLocalUrl);
            setHasError(false);
        }
    }, [branding, theme, variant, officialLocalUrl]);

    const shouldInvertInDark = (branding?.invertDarkMap?.[variant] ?? true) && theme === 'dark';

    if (hasError) {
        return (
            <div className={`flex items-center gap-3 select-none pointer-events-none ${className}`}>
                <span className="font-sans font-bold tracking-[0.25em] text-[#0F172A] dark:text-[#F3F4F6] uppercase text-sm">
                    MINREPORT
                </span>
            </div>
        );
    }

    return (
        <img
            src={imgSrc}
            key={imgSrc}
            alt={`MINREPORT ${variant}`}
            loading="eager"
            onError={() => {
                const svgFallback = branding?.svgDataUris?.[variant];
                if (svgFallback && imgSrc !== svgFallback) {
                    setImgSrc(svgFallback);
                } else if (imgSrc !== officialLocalUrl) {
                    setImgSrc(officialLocalUrl);
                } else {
                    setHasError(true);
                }
            }}
            className={`object-contain max-w-full max-h-full select-none pointer-events-none print:invert-0 print:brightness-100 ${shouldInvertInDark ? 'invert brightness-200 contrast-125' : ''} ${className}`}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
        />
    );
};

export default BrandLogo;
