import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useTheme } from './ThemeContext';

export interface LogoSet {
  isotype: string;
  logotype: string;
  imagotype: string;
  imagotypeVertical?: string;
  pwaIcon?: string;
  appIcon?: string;
}

export interface BrandingConfig {
  light: LogoSet;
  dark: LogoSet;
  siteName?: string;
  primaryColor?: string;
  invertDarkMap?: { [key: string]: boolean };
  svgDataUris?: { [key: string]: string };
}

interface BrandingContextType {
  branding: BrandingConfig | null;
  loading: boolean;
}

export const getCanonicalBrandingPath = (key: string): string => {
  const fileKey = key === 'imagotypeVertical' ? 'imagotype_vertical' : key;
  return `/branding/master_${fileKey}.svg`;
};

/**
 * Normaliza URLs de identidad corporativa para funcionar 100% igual en entorno local,
 * producción (minreport.com) y aplicaciones móviles Capacitor (Android/iOS).
 */
export const fixBrandingUrl = (url?: string, key?: string): string => {
  if (!url || url.trim() === '') {
    return key ? getCanonicalBrandingPath(key) : '';
  }

  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/branding/')) {
    return url;
  }

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const isLocalEnv = currentHost === 'localhost' || currentHost === '127.0.0.1';
  const isEmulatorUrl =
    url.includes('localhost:9195') ||
    url.includes('127.0.0.1:9195') ||
    url.includes('localhost:9196') ||
    url.includes('127.0.0.1:9196');

  if (isEmulatorUrl) {
    if (isLocalEnv) {
      return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return key ? getCanonicalBrandingPath(key) : url;
  }

  return url;
};

const BrandingContext = createContext<BrandingContextType>({ branding: null, loading: true });

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<BrandingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();

  useEffect(() => {
    const docRef = doc(db, 'settings', 'branding');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const rawData = docSnap.data() as BrandingConfig;
        const svgUris = rawData.svgDataUris || {};

        const fixLogoSet = (set: any): LogoSet => {
          const keys: (keyof LogoSet)[] = ['isotype', 'logotype', 'imagotype', 'imagotypeVertical', 'pwaIcon', 'appIcon'];
          const result: any = {};

          keys.forEach((key) => {
            const rawUrl = set?.[key];
            const resolved = fixBrandingUrl(rawUrl, key);
            // Si en producción/móvil la URL apuntaba al emulador local pero existe el vector embebido en Firestore, priorizarlo
            if (
              svgUris[key] &&
              rawUrl &&
              (rawUrl.includes('localhost:9195') || rawUrl.includes('127.0.0.1:9195')) &&
              typeof window !== 'undefined' &&
              window.location.hostname !== 'localhost' &&
              window.location.hostname !== '127.0.0.1'
            ) {
              result[key] = svgUris[key];
            } else {
              result[key] = resolved || svgUris[key] || getCanonicalBrandingPath(key);
            }
          });
          return result;
        };

        const data: BrandingConfig = {
          ...rawData,
          light: fixLogoSet(rawData.light),
          dark: fixLogoSet(rawData.dark),
          invertDarkMap: rawData.invertDarkMap || {
            isotype: true,
            logotype: true,
            imagotype: true,
            imagotypeVertical: true,
            pwaIcon: true,
            appIcon: true,
          },
          svgDataUris: svgUris,
        };

        setBranding(data);

        if (data.siteName) {
          document.title = data.siteName;
        } else {
          document.title = 'MINREPORT';
        }

        if (data.primaryColor) {
          document.documentElement.style.setProperty('--antigravity-accent', data.primaryColor);
        }
      }
      setLoading(false);
    }, (error) => {
      console.error('Error listening to branding changes:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!branding) return;

    const customIcon =
      (theme === 'dark' ? branding.dark?.pwaIcon : branding.light?.pwaIcon) ||
      (theme === 'dark' ? branding.dark?.isotype : branding.light?.isotype);
    if (customIcon) {
      const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (link) link.href = customIcon;
    }
  }, [branding, theme]);

  return (
    <BrandingContext.Provider value={{ branding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
};
