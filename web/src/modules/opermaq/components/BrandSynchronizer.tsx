import { useEffect } from 'react';
import { useBrandConfig } from '../hooks/useBrandConfig';

/**
 * BrandSynchronizer: Inyecta dinámicamente la identidad visual en el DOM
 * Actualiza Favicon, Título de pestaña y variables de entorno si es necesario.
 */
export function BrandSynchronizer() {
  const { brand } = useBrandConfig();

  useEffect(() => {
    // 1. Favicon Dinámico
    if (brand.favicon) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = brand.favicon;
    }

    // 2. Título Dinámico (Opcional, pero refuerza la marca)
    // document.title = 'OPERMAQ | Intelligence Vault';
  }, [brand.favicon]);

  return null; // Componente lógico, no renderiza nada
}
