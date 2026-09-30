import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useTheme } from './ThemeContext';

interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
    pwaIcon?: string;
    appIcon?: string;
}

interface BrandingConfig {
    light: LogoSet;
    dark: LogoSet;
    siteName?: string;
    primaryColor?: string;
}

/**
 * Utility to fix branding URLs for local network testing.
 */
const fixBrandingUrl = (url: string): string => {
    if (!url) return '';
    const currentHost = location.hostname;

    if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
        return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return url;
};

interface BrandingContextType {
    branding: BrandingConfig | null;
    loading: boolean;
}

const BrandingContext = createContext<BrandingContextType>({ branding: null, loading: true });

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [branding, setBranding] = useState<BrandingConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const { theme } = useTheme();

    useEffect(() => {
        // Escuchar cambios en tiempo real desde Firestore
        const docRef = doc(db, 'settings', 'branding');

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const rawData = docSnap.data() as BrandingConfig;

                const fixLogoSet = (set: any): LogoSet => {
                    const result: any = { isotype: '', logotype: '', imagotype: '', pwaIcon: '', appIcon: '' };
                    if (!set) return result;

                    Object.keys(set).forEach(key => {
                        result[key] = fixBrandingUrl(set[key]);
                    });
                    return result;
                };

                const data: BrandingConfig = {
                    ...rawData,
                    light: fixLogoSet(rawData.light),
                    dark: fixLogoSet(rawData.dark),
                };

                setBranding(data);

                // 🖼️ Dynamic Page Title Support
                if (rawData.siteName) {
                    document.title = `${rawData.siteName} | Admin Ops`;
                }
            } else {
                console.warn("Branding settings not found in Firestore.");
            }
            setLoading(false);
        }, (error) => {
            console.error("Error listening to branding changes:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Favicon se gobierna de forma nativa mediante /favicon.svg (con soporte @media prefers-color-scheme en el SVG)
  // evitando canvas tainted, latencia o sobreescritura con imágenes de baja resolución.
  useEffect(() => {
    if (!branding) return;

    const customIcon = theme === 'dark' ? branding.dark?.pwaIcon : branding.light?.pwaIcon;
    if (customIcon && !customIcon.includes('master_')) {
      const link = document.querySelector("link[rel~='icon']");
      if (link) link.href = customIcon;
    }
  }, [branding, theme]);

    return (
        <BrandingContext.Provider value={{ branding, loading }}>
            {children}
        </BrandingContext.Provider>
    );
};
