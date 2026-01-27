import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

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

interface BrandingContextType {
  branding: BrandingConfig | null;
  loading: boolean;
}

/**
 * Utility to fix branding URLs for local network testing.
 */
const fixBrandingUrl = (url: string): string => {
  if (!url) return '';
  const currentHost = location.hostname;

  // Si estamos accediendo por IP o un nombre que no sea localhost, 
  // traducimos los links del emulador para que apunten a este mismo host.
  if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
    return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
  }
  return url;
};

const BrandingContext = createContext<BrandingContextType>({ branding: null, loading: true });

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<BrandingConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Escuchar cambios en tiempo real desde Firestore
    const docRef = doc(db, 'settings', 'branding');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const rawData = docSnap.data() as BrandingConfig;

        // Fix URLs for all logo types in both themes with safety checks
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

        // Aplicar configuraciones globales si existen
        if (data.siteName) {
          document.title = data.siteName;
        }

        // 🖼️ Dynamic Favicon Support
        // Detect current theme to choose the right icon
        const currentTheme = localStorage.getItem('theme') || 'light';
        const logoSet = currentTheme === 'dark' ? data.dark : data.light;
        const iconUrl = logoSet.pwaIcon || logoSet.isotype;

        if (iconUrl) {
          console.log(`[Branding] Final Icon URL for Favicon: ${iconUrl}`);
          let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
          if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
          }
          link.href = iconUrl;
        }

        if (data.primaryColor) {
          document.documentElement.style.setProperty('--antigravity-accent', data.primaryColor);
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

  return (
    <BrandingContext.Provider value={{ branding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
};
