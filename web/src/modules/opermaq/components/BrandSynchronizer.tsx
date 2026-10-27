import { useEffect } from 'react';
import { useBrandConfig } from '../hooks/useBrandConfig';

export interface BrandSynchronizerProps {
  embedded?: boolean;
}

/**
 * BrandSynchronizer: Sincroniza el favicon únicamente en modo standalone sin pisar el Host MINREPORT.
 */
export function BrandSynchronizer({ embedded = false }: BrandSynchronizerProps = {}) {
  const { brand } = useBrandConfig();

  useEffect(() => {
    if (embedded) return;
    if (brand.favicon) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = brand.favicon;
    }
  }, [brand.favicon, embedded]);

  return null;
}
