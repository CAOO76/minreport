import React, { useState, useEffect } from 'react';
import { db } from '../firebase'; // Assuming firebase is initialized here

// A mock hook for theme context, replace with your actual theme implementation
const useTheme = () => {
    // Just an example, maybe your theme is stored in localStorage or a context
    const [theme, setTheme] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    return theme;
};


interface BrandingConfig {
    light: { [key: string]: string };
    dark: { [key: string]: string };
}

// A mock hook for fetching branding, replace with your actual data fetching logic (e.g., React Query, SWR)
const useBranding = () => {
    const [branding, setBranding] = useState<BrandingConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBranding = async () => {
            try {
                const docRef = db.collection('settings').doc('branding');
                const docSnap = await docRef.get();
                if (docSnap.exists) {
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
    variant?: 'isotype' | 'logotype' | 'imagotype';
    className?: string;
}

const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'imagotype', className }) => {
    const theme = useTheme();
    const { branding, loading } = useBranding();

    if (loading) {
        return <div className={`animate-pulse bg-gray-300 dark:bg-gray-700 rounded ${className || 'w-32 h-8'}`}></div>;
    }

    const logoUrl = branding?.[theme]?.[variant];

    if (!logoUrl) {
        // Fallback to a text representation or a default static logo if not configured
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