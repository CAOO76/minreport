import { useState, useEffect } from 'react';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';

export function useOfflineSync<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(initialValue);
  const [isSyncing, setIsSyncing] = useState(false);

  // Cargar estado inicial desde EdgeSyncQueue (IndexedDB + LocalStorage backup)
  useEffect(() => {
    async function loadState() {
      try {
        const savedState = await EdgeSyncQueue.getOfflineKnowledge(key);
        if (savedState !== null && savedState !== undefined) {
          setState(savedState as T);
        } else {
          const localBackup = localStorage.getItem(`backup_${key}`);
          if (localBackup) {
            setState(JSON.parse(localBackup));
          }
        }
      } catch (error) {
        console.error('[EDGE-OPTIMIZER] Error cargando estado offline:', error);
        const localBackup = localStorage.getItem(`backup_${key}`);
        if (localBackup) {
          setState(JSON.parse(localBackup));
        }
      }
    }
    loadState();
  }, [key]);

  // Guardar estado local y defensivo en la bóveda unificada
  const saveState = async (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(state) : value;
      setState(valueToStore);

      await EdgeSyncQueue.saveOfflineKnowledge(key, valueToStore);
      localStorage.setItem(`backup_${key}`, JSON.stringify(valueToStore));
    } catch (error) {
      console.error('[EDGE-OPTIMIZER] Error guardando estado offline:', error);
    }
  };

  // Sincronizar acción con el backend a través de la cola unificada EdgeSyncQueue
  const syncOfflineAction = async (endpoint: string, payload: unknown) => {
    setIsSyncing(true);
    try {
      await EdgeSyncQueue.pushTransaction('API', endpoint, payload, 'OFFLINE_ACTION_QUEUED');
    } finally {
      setIsSyncing(false);
    }
  };

  return [state, saveState, syncOfflineAction, isSyncing] as const;
}
