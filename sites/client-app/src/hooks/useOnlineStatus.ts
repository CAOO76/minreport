/**
 * MinReport - useOnlineStatus Hook
 * 
 * Hook para detectar estado online/offline y sincronización
 */

import { useEffect, useState, useCallback } from 'react';
import { offlineManager, SyncStatus } from '@minreport/sdk';

export interface UseOnlineStatusReturn {
  isOnline: boolean;
  isSyncing: boolean;
  pendingActions: number;
  hasErrors: boolean;
  lastSync?: number;
  syncNow: () => Promise<void>;
}

/**
 * Hook para monitorear estado de conexión y sincronización
 */
export const useOnlineStatus = (): UseOnlineStatusReturn => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(offlineManager.getSyncStatus());

  useEffect(() => {
    // Suscribirse a cambios de estado
    const unsubscribe = offlineManager.onStatusChange((status) => {
      setSyncStatus(status);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const syncNow = useCallback(async () => {
    await offlineManager.syncQueue();
  }, []);

  return {
    isOnline: syncStatus.isOnline,
    isSyncing: syncStatus.isSyncing,
    pendingActions: syncStatus.pendingActions,
    hasErrors: syncStatus.errors.length > 0,
    lastSync: syncStatus.lastSync,
    syncNow,
  };
};

/**
 * Hook para mostrar notificaciones de estado offline
 */
export const useOfflineNotification = () => {
  const [showNotification, setShowNotification] = useState(false);
  const { isOnline, pendingActions } = useOnlineStatus();

  useEffect(() => {
    // Mostrar notificación cuando pasa a offline
    if (!isOnline && pendingActions > 0) {
      setShowNotification(true);
    } else if (isOnline) {
      setShowNotification(false);
    }
  }, [isOnline, pendingActions]);

  const dismiss = useCallback(() => {
    setShowNotification(false);
  }, []);

  return {
    showNotification,
    isOnline,
    pendingActions,
    dismiss,
  };
};

/**
 * Hook para ejecutar acciones que pueden ser offline
 */
export const useOfflineAction = (action: (data: any) => Promise<void>) => {
  const { isOnline, syncNow } = useOnlineStatus();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (data: any) => {
      setIsLoading(true);
      setError(null);

      try {
        await action(data);

        if (!isOnline) {
          // Si estamos offline, la acción se ha queued
          console.log('📝 Acción queued para sincronizar cuando vuelva online');
        } else {
          // Si estamos online, intentar sincronizar
          await syncNow();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        setIsLoading(false);
      }
    },
    [action, isOnline, syncNow]
  );

  return { execute, isLoading, error };
};
