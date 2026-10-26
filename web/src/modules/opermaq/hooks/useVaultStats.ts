/**
 * useVaultStats — Hook F3.2
 * Consulta el estado de la Bóveda de Conocimiento de OPERMAQ y lo refresca periódicamente.
 */

import { useState, useEffect } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL as API_BASE } from '../firebase/config';

export interface VaultStats {
  totalFiles: number;
  totalChunks: number;
  byPillar: Record<string, number>;
  byMake: Record<string, number>;
}

const EMPTY_STATS: VaultStats = {
  totalFiles: 0,
  totalChunks: 0,
  byPillar: {},
  byMake: {},
};

export function useVaultStats() {
  const [stats, setStats]     = useState<VaultStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      // Usamos el nuevo endpoint /stats de Bóveda real
      const res = await authFetch(`${API_BASE}/vault/stats`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const parsed: VaultStats = {
            totalFiles:  typeof data.totalFiles  === 'number' ? data.totalFiles  : 0,
            totalChunks: typeof data.totalChunks === 'number' ? data.totalChunks : 0,
            byPillar:    data.byPillar && typeof data.byPillar === 'object' ? data.byPillar : {},
            byMake:      data.byMake   && typeof data.byMake   === 'object' ? data.byMake   : {},
          };
          setStats(parsed);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[useVaultStats] No se pudo obtener stats:', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, 60000); 
    return () => clearInterval(timer);
  }, []);

  return { stats, loading, refresh: fetchStats };
}
