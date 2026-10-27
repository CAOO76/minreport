import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

export interface BrandConfig {
  favicon?: string;
  isotype?: string;
  imagotype?: string;
  imagotypeVertical?: string;
  logotype?: string;
  updatedAt?: string;
}

/**
 * useBrandConfig: Sincroniza la identidad visual unificada desde settings/branding
 */
export function useBrandConfig() {
  const [brand, setBrand] = useState<BrandConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'settings', 'branding');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          const light = data.light || {};
          const svgUris = data.svgDataUris || {};
          setBrand({
            favicon: light.pwaIcon || svgUris.pwaIcon || data.favicon || '/branding/master_pwaIcon.svg',
            isotype: light.isotype || svgUris.isotype || data.isotype || '/branding/master_isotype.svg',
            imagotype: light.imagotype || svgUris.imagotype || data.imagotype || '/branding/master_imagotype.svg',
            imagotypeVertical: light.imagotypeVertical || svgUris.imagotypeVertical || data.imagotypeVertical || '/branding/master_imagotype_vertical.svg',
            logotype: light.logotype || svgUris.logotype || data.logotype || '/branding/master_logotype.svg',
            updatedAt: data.updatedAt,
          });
        }
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { brand, loading };
}
