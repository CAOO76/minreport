import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';

type LogoVariant = 'isotype' | 'logotype' | 'imagotype' | 'imagotypeVertical';

interface BrandLogoProps {
    variant?: LogoVariant;
    className?: string;
    forcedTheme?: 'light' | 'dark';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className = '', forcedTheme }) => {
    const { theme: contextTheme } = useTheme();
    const { branding } = useBranding();
    const theme = forcedTheme || contextTheme;

    const officialLocalUrl = `/branding/master_${variant}.svg`;
    const [imgSrc, setImgSrc] = useState<string>(officialLocalUrl);
    const [hasError, setHasError] = useState<boolean>(false);

    useEffect(() => {
        const firestoreUrl = branding?.[theme]?.[variant];
        const isOfflineEmulator = firestoreUrl && (
            firestoreUrl.includes('localhost:9195') ||
            firestoreUrl.includes('localhost:9196') ||
            firestoreUrl.includes('127.0.0.1:9195') ||
            firestoreUrl.includes('127.0.0.1:9196')
        );

        if (firestoreUrl && firestoreUrl.trim() !== '' && !isOfflineEmulator) {
            setImgSrc(firestoreUrl);
            setHasError(false);
        } else {
            setImgSrc(officialLocalUrl);
            setHasError(false);
        }
    }, [branding, theme, variant, officialLocalUrl]);

    // Fallback vectorial industrial puro si el activo falla en red o almacenamiento
    if (hasError) {
        if (variant === 'isotype') {
            return (
                <div className={`flex items-center justify-center select-none pointer-events-none ${className}`}>
                    <svg viewBox="0 0 32 32" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <polygon points="16,2 30,10 30,22 16,30 2,22 2,10" stroke="#C68346" strokeWidth="2" fill="none" />
                        <line x1="16" y1="2" x2="16" y2="30" stroke="#C68346" strokeWidth="1.5" />
                        <line x1="2" y1="10" x2="16" y2="18" stroke="#C68346" strokeWidth="1.5" />
                        <line x1="30" y1="10" x2="16" y2="18" stroke="#C68346" strokeWidth="1.5" />
                    </svg>
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
                    <svg viewBox="0 0 32 32" className="h-10 w-10 shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <polygon points="16,2 30,10 30,22 16,30 2,22 2,10" stroke="#C68346" strokeWidth="2" fill="none" />
                        <line x1="16" y1="2" x2="16" y2="30" stroke="#C68346" strokeWidth="1.5" />
                        <line x1="2" y1="10" x2="16" y2="18" stroke="#C68346" strokeWidth="1.5" />
                        <line x1="30" y1="10" x2="16" y2="18" stroke="#C68346" strokeWidth="1.5" />
                    </svg>
                    <span className="font-sans font-bold tracking-[0.25em] text-[#0F172A] dark:text-[#F3F4F6] uppercase text-xs text-center">
                        MINREPORT
                    </span>
                </div>
            );
        }
        return (
            <div className={`flex items-center gap-3 select-none pointer-events-none ${className}`}>
                <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="16,2 30,10 30,22 16,30 2,22 2,10" stroke="#C68346" strokeWidth="2" fill="none" />
                    <line x1="16" y1="2" x2="16" y2="30" stroke="#C68346" strokeWidth="1.5" />
                    <line x1="2" y1="10" x2="16" y2="18" stroke="#C68346" strokeWidth="1.5" />
                    <line x1="30" y1="10" x2="16" y2="18" stroke="#C68346" strokeWidth="1.5" />
                </svg>
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
                if (imgSrc !== officialLocalUrl) {
                    setImgSrc(officialLocalUrl);
                } else {
                    setHasError(true);
                }
            }}
            className={`object-contain select-none pointer-events-none dark:invert dark:brightness-200 dark:contrast-125 ${className}`}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
        />
    );
};

export default BrandLogo;
