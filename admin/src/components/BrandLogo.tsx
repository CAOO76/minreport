import React from 'react';
import clsx from 'clsx';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';

// Define more specific types for branding
type LogoVariant = 'isotype' | 'logotype' | 'imagotype';

interface BrandLogoProps {
    variant?: LogoVariant;
    className?: string;
    forcedTheme?: 'light' | 'dark';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className, forcedTheme }) => {
    const { theme: contextTheme } = useTheme();
    const { branding, loading } = useBranding();
    const theme = forcedTheme || contextTheme;

    if (loading) {
        return <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded-none ${className || 'w-32 h-8'}`}></div>;
    }

    const logoUrl = branding?.[theme]?.[variant];

    if (!logoUrl) {
        return (
            <div className={clsx("flex items-center gap-3", className)}>
                <div className="relative group/logo">
                    <div className="relative w-8 h-8 flex items-center justify-center rounded-none">
                        <span className="text-white dark:text-black font-black text-xs italic tracking-tighter">MR</span>
                    </div>
                </div>
                <div className="flex flex-col -space-y-1">
                    <span className="text-lg font-black text-black dark:text-white uppercase tracking-tighter italic">MINREPORT</span>
                    <span className="text-[8px] font-black text-antigravity-accent uppercase tracking-[0.3em] font-mono opacity-50">Industrial_Core</span>
                </div>
            </div>
        );
    }

    // High performance rendering with contain logic
    const isSvg = logoUrl.toLowerCase().includes('.svg');

    // [AUTO-COLOR] If it's a monochrome path, this filter allows it to adapt
    // [PRINT-SAFE] We ensure that during print, the logo stays black (invert: 0)
    const needsInvert = isSvg && theme === 'dark';

    return (
        <img
            src={logoUrl}
            key={logoUrl}
            alt={`MinReport ${variant}`}
            loading="eager"
            className={`object-contain max-w-full max-h-full select-none transition-all duration-500 print:invert-0 print:brightness-100 ${isSvg ? 'rendering-crisp' : ''} ${needsInvert ? 'dark:invert dark:brightness-200' : ''} ${className || ''}`}
            draggable={false}
        />
    );
};

export default BrandLogo;