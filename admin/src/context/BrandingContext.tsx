import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
}

interface BrandingConfig {
    light: LogoSet;
    dark: LogoSet;
}

interface BrandingContextType {
    branding: BrandingConfig | null;
    loading: boolean;
}

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
                setBranding(docSnap.data() as BrandingConfig);
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
