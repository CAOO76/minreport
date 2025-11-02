/**
 * IndexedDB Manager para MinReport
 * Gestiona almacenamiento local de datos offline
 * Sincronización bidireccional con servidor
 */

export class OfflineDataManager {
  private dbName = 'minreport-offline';
  private dbVersion = 1;
  private db = null;

  constructor() {
    this.init();
  }

  /**
   * Inicializar base de datos IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB inicializado');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Almacenes para datos
        const stores = [
          { name: 'reports', keyPath: 'id' },
          { name: 'projects', keyPath: 'id' },
          { name: 'users', keyPath: 'id' },
          { name: 'pending-syncs', keyPath: 'id' },
          { name: 'sync-log', keyPath: 'id' },
        ];

        stores.forEach((store) => {
          if (!db.objectStoreNames.contains(store.name)) {
            db.createObjectStore(store.name, { keyPath: store.keyPath });
          }
        });

        console.log('📦 Object stores creados');
      };
    });
  }

  /**
   * Guardar reporte localmente
   */
  async saveReport(report) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['reports'], 'readwrite');
      const store = transaction.objectStore('reports');
      const request = store.put({
        ...report,
        savedAt: new Date().toISOString(),
        synced: false,
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log(`📝 Reporte guardado localmente: ${report.id}`);
        resolve(request.result);
      };
    });
  }

  /**
   * Obtener reporte local
   */
  async getReport(reportId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['reports'], 'readonly');
      const store = transaction.objectStore('reports');
      const request = store.get(reportId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Obtener todos los reportes pendientes de sincronizar
   */
  async getPendingReports() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['reports'], 'readonly');
      const store = transaction.objectStore('reports');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const pending = request.result.filter((r) => !r.synced);
        resolve(pending);
      };
    });
  }

  /**
   * Marcar reporte como sincronizado
   */
  async markReportAsSynced(reportId, remoteId = null) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        ['reports', 'sync-log'],
        'readwrite'
      );
      const store = transaction.objectStore('reports');
      const logStore = transaction.objectStore('sync-log');

      // Actualizar reporte
      const updateRequest = store.get(reportId);
      updateRequest.onsuccess = () => {
        const report = updateRequest.result;
        report.synced = true;
        report.syncedAt = new Date().toISOString();
        if (remoteId) report.remoteId = remoteId;

        store.put(report);
      };

      // Registrar en log
      logStore.put({
        id: `${reportId}-${Date.now()}`,
        reportId,
        action: 'synced',
        timestamp: new Date().toISOString(),
      });

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        console.log(`✅ Reporte marcado como sincronizado: ${reportId}`);
        resolve();
      };
    });
  }

  /**
   * Guardar operación pendiente para sincronización
   */
  async savePendingSync(operation) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending-syncs'], 'readwrite');
      const store = transaction.objectStore('pending-syncs');
      const request = store.put({
        ...operation,
        id: operation.id || `pending-${Date.now()}`,
        createdAt: new Date().toISOString(),
        retries: 0,
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log(`📋 Operación guardada para sincronización: ${request.result}`);
        resolve(request.result);
      };
    });
  }

  /**
   * Obtener operaciones pendientes
   */
  async getPendingSyncs() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending-syncs'], 'readonly');
      const store = transaction.objectStore('pending-syncs');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Remover operación completada
   */
  async removePendingSync(syncId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending-syncs'], 'readwrite');
      const store = transaction.objectStore('pending-syncs');
      const request = store.delete(syncId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Obtener historial de sincronización
   */
  async getSyncLog(limit = 100) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sync-log'], 'readonly');
      const store = transaction.objectStore('sync-log');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const log = request.result.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        resolve(log.slice(0, limit));
      };
    });
  }

  /**
   * Limpiar datos sincronizados más antiguos
   */
  async cleanupOldData(daysOld = 30) {
    if (!this.db) await this.init();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['reports'], 'readwrite');
      const store = transaction.objectStore('reports');
      const request = store.getAll();

      request.onsuccess = () => {
        const toDelete = request.result.filter(
          (r) =>
            r.synced &&
            new Date(r.syncedAt) < cutoffDate
        );

        toDelete.forEach((item) => {
          store.delete(item.id);
        });

        transaction.oncomplete = () => {
          console.log(`🧹 ${toDelete.length} registros antiguos limpiados`);
          resolve(toDelete.length);
        };
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Obtener estado de sincronización
   */
  async getSyncStatus() {
    const pending = await this.getPendingReports();
    const pendingSyncs = await this.getPendingSyncs();
    const log = await this.getSyncLog(10);

    return {
      pendingReports: pending.length,
      pendingOperations: pendingSyncs.length,
      totalPending: pending.length + pendingSyncs.length,
      lastSyncLog: log,
    };
  }

  /**
   * Vaciar toda la base de datos (destructivo)
   */
  async clearAll() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [
          'reports',
          'projects',
          'users',
          'pending-syncs',
          'sync-log',
        ],
        'readwrite'
      );

      const stores = transaction.objectStoreNames;
      for (let i = 0; i < stores.length; i++) {
        transaction.objectStore(stores[i]).clear();
      }

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        console.log('🧹 Base de datos limpiada completamente');
        resolve();
      };
    });
  }
}

// Export singleton
export const offlineDataManager = new OfflineDataManager();
