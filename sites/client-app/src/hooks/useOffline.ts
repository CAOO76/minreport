import { useEffect, useState, useCallback } from 'react';
import { offlineDataManager } from '../services/offline-data-manager';

export interface OfflineStatus {
  isOnline: boolean;
  pendingReports: number;
  pendingOperations: number;
  lastSync: string | null;
}

/**
 * Hook para manejar estado offline
 */
export function useOfflineStatus() {
  const [status, setStatus] = useState<OfflineStatus>({
    isOnline: navigator.onLine,
    pendingReports: 0,
    pendingOperations: 0,
    lastSync: null,
  });

  useEffect(() => {
    // Actualizar estado online/offline
    const handleOnline = () => setStatus((s) => ({ ...s, isOnline: true }));
    const handleOffline = () => setStatus((s) => ({ ...s, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cargar estado inicial
    updateSyncStatus();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updateSyncStatus = useCallback(async () => {
    const syncStatus = await offlineDataManager.getSyncStatus();
    setStatus((s) => ({
      ...s,
      pendingReports: syncStatus.pendingReports,
      pendingOperations: syncStatus.pendingOperations,
    }));
  }, []);

  return { status, updateSyncStatus };
}

/**
 * Hook para guardar reportes con soporte offline
 */
export function useOfflineReports() {
  const saveReport = useCallback(async (report: any) => {
    try {
      if (navigator.onLine) {
        // Enviar al servidor
        const response = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        });

        if (response.ok) {
          const remoteReport = await response.json();
          // Guardar también localmente con remoteId
          await offlineDataManager.saveReport({
            ...report,
            remoteId: remoteReport.id,
          });
          return remoteReport;
        }
      }

      // Si está offline o falla, guardar localmente
      await offlineDataManager.saveReport(report);
      
      // Registrar para sincronización posterior
      await offlineDataManager.savePendingSync({
        type: 'create-report',
        data: report,
        endpoint: '/api/reports',
      });

      return report;
    } catch (error) {
      console.error('Error guardando reporte:', error);
      // Guardar localmente de todas formas
      await offlineDataManager.saveReport(report);
      throw error;
    }
  }, []);

  const getPendingReports = useCallback(
    () => offlineDataManager.getPendingReports(),
    []
  );

  const getReport = useCallback(
    (id: string) => offlineDataManager.getReport(id),
    []
  );

  return { saveReport, getPendingReports, getReport };
}

/**
 * Hook para manejar sincronización
 */
export function useOfflineSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncAll = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncError('Sin conexión de internet');
      return false;
    }

    setIsSyncing(true);
    setSyncError(null);

    try {
      // Sincronizar reportes pendientes
      const pendingReports = await offlineDataManager.getPendingReports();
      for (const report of (pendingReports as any[])) {
        try {
          const response = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report),
          });

          if (response.ok) {
            const remoteReport = await response.json();
            await offlineDataManager.markReportAsSynced(report.id, remoteReport.id);
          }
        } catch (error) {
          console.error(`Error sincronizando reporte ${report.id}:`, error);
        }
      }

      // Sincronizar operaciones pendientes
      const pendingSyncs = await offlineDataManager.getPendingSyncs();
      for (const sync of (pendingSyncs as any[])) {
        try {
          const response = await fetch(sync.endpoint, {
            method: sync.method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sync.data),
          });

          if (response.ok) {
            await offlineDataManager.removePendingSync(sync.id);
          }
        } catch (error) {
          console.error(`Error sincronizando operación ${sync.id}:`, error);
        }
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      setSyncError(message);
      console.error('Error en sincronización:', error);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return { syncAll, isSyncing, syncError };
}
