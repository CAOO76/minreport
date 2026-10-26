import { useState } from 'react';
import { authFetch } from '../utils/authFetch';

/**
 * useAssetImage — Hook para gestionar la generación de imágenes IA de activos.
 */
export function useAssetImage(assetId: string) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateImage = async () => {
    if (!assetId) return null;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const response = await authFetch(`/api/assets/${assetId}/generate-image`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Error al generar la imagen con IA');
      }
      
      const data = await response.json();
      return data.url as string;
    } catch (err: unknown) {
      console.error('[useAssetImage] Error:', err);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  return { 
    generateImage, 
    isGenerating, 
    error 
  };
}
