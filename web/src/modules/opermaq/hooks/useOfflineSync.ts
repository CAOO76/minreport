import { useState, useEffect } from 'react';
import { enqueueAction, initDB } from '../utils/EdgeSyncQueue';

const STATE_STORE = 'offline_states';

export function useOfflineSync<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(initialValue);
  const [isSyncing, setIsSyncing] = useState(false);

  // Cargar estado inicial desde IndexedDB o LocalStorage como backup
  useEffect(() => {
    async function loadState() {
      try {
        const db = await initDB();
        const savedState = await db.get(STATE_STORE, key);
        if (savedState !== undefined) {
          setState(savedState);
        } else {
          const localBackup = localStorage.getItem(`backup_${key}`);
          if (localBackup) {
            setState(JSON.parse(localBackup));
          }
        }
      } catch (error) {
        console.error('[EDGE-OPTIMIZER] Error cargando estado offline:', error);
        // Fallback a localStorage
        const localBackup = localStorage.getItem(`backup_${key}`);
        if (localBackup) {
          setState(JSON.parse(localBackup));
        }
      }
    }
    loadState();
  }, [key]);

  // Guardar estado local y defensivo
  const saveState = async (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(state) : value;
      setState(valueToStore);

      // Persistir en IndexedDB
      const db = await initDB();
      await db.put(STATE_STORE, valueToStore, key);

      // Backup secundario defensivo
      localStorage.setItem(`backup_${key}`, JSON.stringify(valueToStore));
    } catch (error) {
      console.error('[EDGE-OPTIMIZER] Error guardando estado offline:', error);
    }
  };

  // Sincronizar acción con el backend a través de la cola de resiliencia
  const syncOfflineAction = async (endpoint: string, payload: unknown) => {
    setIsSyncing(true);
    try {
      await enqueueAction(endpoint, payload);
    } finally {
      setIsSyncing(false);
    }
  };

  return [state, saveState, syncOfflineAction, isSyncing] as const;
}
