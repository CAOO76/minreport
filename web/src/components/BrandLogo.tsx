import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';

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

    // Activo maestro oficial local siempre disponible
    const officialLocalUrl = `/branding/master_${variant}.svg`;
    const logoUrl = branding?.[theme]?.[variant] || officialLocalUrl;

    if (loading && !logoUrl) {
        return <div className={`animate-pulse bg-white/5 border border-white/10 ${className || 'w-36 h-10'}`} />;
    }

    // Invertir a blanco en tema oscuro para contraste WCAG AAA
    const isDark = (forcedTheme === 'dark') || theme === 'dark';

    return (
        <img
            src={logoUrl}
            key={logoUrl}
            alt={`MINREPORT ${variant}`}
            loading="eager"
            className={`object-contain max-w-full max-h-full select-none transition-all duration-300 ${
                isDark ? 'filter invert brightness-200 contrast-125' : ''
            } ${className || ''}`}
            draggable={false}
        />
    );
};

export default BrandLogo;
