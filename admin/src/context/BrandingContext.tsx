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

    // 🔥 Dynamic Favicon Support (Reactive to Theme)
    useEffect(() => {
        if (!branding) return;

        const applyThemeToFavicon = async (url: string, currentTheme: string) => {
            if (!url) return;

        const updateIcons = (iconUrl: string) => {
          const selectors = [
            "link[rel~='icon']",
            "link[rel~='shortcut icon']",
            "link[rel~='apple-touch-icon']"
          ];

          selectors.forEach(selector => {
            const rel = selector.includes('apple') ? 'apple-touch-icon' : 'icon';
            const existing: HTMLLinkElement | null = document.querySelector(selector);
            
            if (existing) {
              existing.href = iconUrl;
            } else {
              const link = document.createElement('link');
              link.rel = rel;
              link.href = iconUrl;
              document.head.appendChild(link);
            }
          });
        };

        if (currentTheme !== 'dark') {
          updateIcons(url);
          return;
        }

        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = url;
          
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error("Canvas context failed");

          const natWidth = img.naturalWidth || 512;
          const natHeight = img.naturalHeight || 512;
          
          const size = Math.max(natWidth, natHeight);
          canvas.width = size;
          canvas.height = size;
          
          const x = (size - natWidth) / 2;
          const y = (size - natHeight) / 2;
          
          ctx.drawImage(img, x, y, natWidth, natHeight);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];
            data[i + 1] = 255 - data[i+1];
            data[i + 2] = 255 - data[i+2];
          }
          
          ctx.putImageData(imageData, 0, 0);
          updateIcons(canvas.toDataURL());
          
          console.log(`[Branding] Favicons updated/inverted for ${currentTheme} mode`);
        } catch (err) {
          console.warn("[Branding] Failed to invert favicon, falling back to raw URL:", err);
          updateIcons(url);
        }
        };

        const logoSet = theme === 'dark' ? branding.dark : branding.light;
        const iconUrl = logoSet.pwaIcon || logoSet.isotype;

        if (iconUrl) {
            applyThemeToFavicon(iconUrl, theme);
        }
    }, [branding, theme]);

    return (
        <BrandingContext.Provider value={{ branding, loading }}>
            {children}
        </BrandingContext.Provider>
    );
};
