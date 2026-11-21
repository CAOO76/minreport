import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useBranding, getCanonicalBrandingPath } from '../context/BrandingContext';

export type LogoVariant = 'isotype' | 'logotype' | 'imagotype' | 'imagotypeVertical';

interface BrandLogoProps {
    variant?: LogoVariant;
    className?: string;
    forcedTheme?: 'light' | 'dark';
}

const svgShieldProps = {
    draggable: false,
    onContextMenu: (e: React.MouseEvent<SVGSVGElement>) => e.preventDefault(),
    style: { WebkitUserDrag: 'none' } as React.CSSProperties,
};

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
        /** Renderiza el isotipo vectorial canónico estrictamente monocromático como fallback. */
        const renderCanonicalIsotype = (sizeClass: string) => (
            <svg
                viewBox="0 0 281.13 382.19"
                className={`${sizeClass} select-none pointer-events-none text-[#000000] dark:text-[#FFFFFF]`}
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
                {...svgShieldProps}
            >
                <path d="M140.16,32A158.6,158.6,0,0,1,252.49,78.37l22.6-22.6A191.08,191.08,0,0,0,5.65,55.38L28.24,78A158.61,158.61,0,0,1,140.16,32Z" />
                <path d="M139.76,63.9a126.82,126.82,0,0,0-89.13,36.46L73.23,123a95.22,95.22,0,0,1,133.88.79l22.59-22.59A126.77,126.77,0,0,0,139.76,63.9Z" />
                <path d="M140.37,159.4a31.48,31.48,0,0,1,22.41,9.28l0,0,0,0,73,72.75L140.4,336.91,45.21,241.45l63.29-63.38h.07l9.37-9.38a31.52,31.52,0,0,1,22.43-9.29m0-32a63.49,63.49,0,0,0-45.06,18.67h-.08L0,241.43,140.37,382.19,281.13,241.43l-95.72-95.38h0a63.52,63.52,0,0,0-45-18.65Z" />
                <path d="M140.76,381.79l140-140L185,146.44h0a63.48,63.48,0,0,0-44.25-18.64Z" />
            </svg>
        );

        if (variant === 'isotype') {
            return (
                <div className={`flex items-center justify-center select-none pointer-events-none ${className}`}>
                    {renderCanonicalIsotype('w-full h-full')}
                </div>
            );
        }
        if (variant === 'logotype') {
            return (
                <div className={`flex items-center justify-center select-none pointer-events-none ${className}`}>
                    <span className="font-sans font-bold tracking-[0.25em] text-[#0F172A] dark:text-[#F3F4F6] uppercase text-sm">
                        MINREPORT
                    </span>
                </div>
            );
        }
        if (variant === 'imagotypeVertical') {
            return (
                <div className={`flex flex-col items-center justify-center gap-2 select-none pointer-events-none ${className}`}>
                    {renderCanonicalIsotype('h-10 w-10 shrink-0')}
                    <span className="font-sans font-bold tracking-[0.25em] text-[#0F172A] dark:text-[#F3F4F6] uppercase text-xs text-center">
                        MINREPORT
                    </span>
                </div>
            );
        }
        return (
            <div className={`flex items-center gap-3 select-none pointer-events-none ${className}`}>
                {renderCanonicalIsotype('h-8 w-8 shrink-0')}
                <span className="font-sans font-bold tracking-[0.25em] text-[#0F172A] dark:text-[#F3F4F6] uppercase text-sm">
                    MINREPORT
                </span>
            </div>
        );
    }

    return (
        <img
            src={imgSrc}
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
            className={`object-contain select-none pointer-events-none ${shouldInvertInDark ? 'invert brightness-200 contrast-125' : ''} ${className}`}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
        />
    );
};

export default BrandLogo;
