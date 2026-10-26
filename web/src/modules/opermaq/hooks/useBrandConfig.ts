import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

export interface BrandConfig {
  favicon?: string;    // URL de Storage (.svg o .png)
  isotype?: string;    // Isotipo: ícono puro
  imagotype?: string;  // Imagotipo: logo + texto
  logotype?: string;   // Logotipo: texto puro
  updatedAt?: string;
}

/**
 * useBrandConfig: Sincroniza la identidad visual global de OPERMAQ
 */
export function useBrandConfig() {
  const [brand, setBrand] = useState<BrandConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'system', 'brand_config');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setBrand(snap.data() as BrandConfig);
      }
      setLoading(false);
    }, (err) => {
      console.warn("BrandConfig (Offline fallback):", err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { brand, loading };
}
