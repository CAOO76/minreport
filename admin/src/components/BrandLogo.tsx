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

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className, forcedTheme }) => {
    const { theme: contextTheme } = useTheme();
    const { branding, loading } = useBranding();
    const theme = forcedTheme || contextTheme;

    if (loading) {
        return <div className={`animate-pulse bg-gray-300 dark:bg-gray-700 rounded ${className || 'w-32 h-8'}`}></div>;
    }

    const logoUrl = branding?.[theme]?.[variant];

    if (!logoUrl) {
        return (
            <div className={className}>
                <span className="text-lg font-bold text-gray-800 dark:text-white uppercase tracking-wider">MINREPORT</span>
            </div>
        );
    }

    return (
        <img
            src={logoUrl}
            key={logoUrl} // Key addition to force reload if only URL changes (though shouldn't happen often)
            alt={`${variant} logo`}
            className={`object-contain ${className || ''}`}
        />
    );
};

export default BrandLogo;