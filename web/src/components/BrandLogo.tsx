import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Define more specific types for branding
type LogoVariant = 'isotype' | 'logotype' | 'imagotype';

interface Logos {
    isotype?: string;
    logotype?: string;
    imagotype?: string;
}

interface BrandingConfig {
    light: Logos;
    dark: Logos;
}

// Custom hook to get the current theme ('light' or 'dark')
const useTheme = (): 'light' | 'dark' => {
    const [theme, setTheme] = useState<'light' | 'dark'>(() =>
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    );

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            setTheme(e.matches ? 'dark' : 'light');
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    return theme;
};

// Custom hook for fetching branding configuration from Firestore
const useBranding = () => {
    const [branding, setBranding] = useState<BrandingConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBranding = async () => {
            try {
                // Use modular Firestore SDK (v9+)
                const docRef = doc(db, 'settings', 'branding');
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    // The improved interfaces will help TypeScript catch errors downstream.
                    setBranding(docSnap.data() as BrandingConfig);
                } else {
                    console.warn("Branding settings not found in Firestore.");
                }
            } catch (error) {
                console.error("Error fetching branding:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchBranding();
    }, []);

    return { branding, loading };
};

interface BrandLogoProps {
    variant?: LogoVariant;
    className?: string;
}

const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className }) => {
    const theme = useTheme();
    const { branding, loading } = useBranding();

    if (loading) {
        return <div className={`animate-pulse bg-gray-300 dark:bg-gray-700 rounded ${className || 'w-32 h-8'}`}></div>;
    }

    // Safely access the logo URL with optional chaining and correct typing
    const logoUrl = branding?.[theme]?.[variant];

    if (!logoUrl) {
        // Fallback to a default view if the logo is not available
        return (
            <div className={className}>
                <span className="text-lg font-bold text-gray-800 dark:text-white">MINREPORT</span>
            </div>
        );
    }

    return (
        <img
            src={logoUrl}
            alt={`${variant} logo`}
            className={className}
        />
    );
};

export default BrandLogo;