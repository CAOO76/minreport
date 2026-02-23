import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';

// Define more specific types for branding
type LogoVariant = 'isotype' | 'logotype' | 'imagotype';

interface BrandLogoProps {
    variant?: LogoVariant;
    className?: string;
    forcedTheme?: 'light' | 'dark';
}

const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className, forcedTheme }) => {
    const { theme: contextTheme } = useTheme();
    const { branding, loading } = useBranding();
    const theme = forcedTheme || contextTheme;

    if (loading) {
        return <div className={`animate-pulse bg-black/10 dark:bg-white/10 rounded-none border border-black/5 dark:border-white/5 ${className || 'w-32 h-8'}`}></div>;
    }

    const logoUrl = branding?.[theme]?.[variant];

    if (!logoUrl) {
        return null;
    }

    // High performance rendering with contain logic
    const isSvg = logoUrl.toLowerCase().includes('.svg');

    // [AUTO-COLOR] If it's a monochrome path, this filter allows it to adapt
    // [PRINT-SAFE] We ensure that during print, the logo stays black
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