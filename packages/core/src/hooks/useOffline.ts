import { useEffect, useState, useCallback, useRef } from 'react';
import type { SyncManager } from '../offline/sync-manager';
import type { OfflineStore } from '../offline/offline-database';

export interface UseOfflineState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  queuedItems: number;
  storageUsedPercent: number;
}

/**
 * Hook for managing offline-first functionality
 */
export function useOffline(
  offlineDb: OfflineStore,
  syncManager: SyncManager
): UseOfflineState {
  const [state, setState] = useState<UseOfflineState>({
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSyncTime: syncManager.getLastSyncTime(),
    queuedItems: 0,
    storageUsedPercent: 0,
  });

  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const updateState = useCallback(async () => {
    const queue = await offlineDb.getSyncQueue();
    const storage = await offlineDb.getStorageInfo();

    setState(prev => ({
      ...prev,
      isOnline: navigator.onLine,
      isSyncing: syncManager.isSyncing(),
      lastSyncTime: syncManager.getLastSyncTime(),
      queuedItems: queue.length,
      storageUsedPercent: storage.percentUsed,
    }));
  }, [offlineDb, syncManager]);

  useEffect(() => {
    // Initial update
    updateState();

    // Setup listeners
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
      updateState();
    };

    const handleOffline = () => {
      setState(prev => ({ ...prev, isOnline: false }));
      updateState();
    };

    const handleSync = () => {
      updateState();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    syncManager.onSync(handleSync);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [updateState, syncManager]);

  // Poll for state updates
  useEffect(() => {
    const interval = setInterval(updateState, 5000);
    return () => clearInterval(interval);
  }, [updateState]);

  return state;
}

/**
 * Hook for saving data locally
 */
export function useLocalStorage(
  collection: string,
  offlineDb: OfflineStore
) {
  const saveData = useCallback(
    async (id: string, data: Record<string, any>) => {
      try {
        await offlineDb.saveLocal(collection, id, data);
        return true;
      } catch (error) {
        console.error(`Failed to save ${collection}:${id}:`, error);
        return false;
      }
    },
    [offlineDb, collection]
  );

  const getData = useCallback(
    async (id: string) => {
      try {
        return await offlineDb.getLocal(collection, id);
      } catch (error) {
        console.error(`Failed to load ${collection}:${id}:`, error);
        return null;
      }
    },
    [offlineDb, collection]
  );

  const getAllData = useCallback(async () => {
    try {
      return await offlineDb.getAllLocal(collection);
    } catch (error) {
      console.error(`Failed to load ${collection}:`, error);
      return [];
    }
  }, [offlineDb, collection]);

  const deleteData = useCallback(
    async (id: string) => {
      try {
        await offlineDb.deleteLocal(collection, id);
        return true;
      } catch (error) {
        console.error(`Failed to delete ${collection}:${id}:`, error);
        return false;
      }
    },
    [offlineDb, collection]
  );

  return { saveData, getData, getAllData, deleteData };
}
