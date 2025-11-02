/**
 * Background Sync Manager
 * Maneja sincronización de datos offline-to-online
 */

import { getOfflineConfig } from '../config/app-config';

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  resource: 'report' | 'project' | 'user';
  data: any;
  timestamp: number;
  retries: number;
  lastError?: string;
}

export class BackgroundSyncManager {
  private isRunning = false;
  private syncQueue: SyncOperation[] = [];
  private config = getOfflineConfig();

  /**
   * Registrar operación para sincronización
   */
  async queueOperation(operation: Omit<SyncOperation, 'id' | 'timestamp' | 'retries'>) {
    const syncOp: SyncOperation = {
      ...operation,
      id: `sync-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      retries: 0,
    };

    this.syncQueue.push(syncOp);
    console.log(`📋 Operación encolada: ${syncOp.id}`);

    // Persistir en IndexedDB
    await this.persistQueue();

    // Iniciar sincronización si está online
    if (navigator.onLine && this.config.autoSync) {
      this.startSync();
    }
  }

  /**
   * Iniciar sincronización
   */
  async startSync() {
    if (this.isRunning || !navigator.onLine) {
      return;
    }

    this.isRunning = true;
    console.log('🔄 Iniciando sincronización...');

    try {
      // Cargar queue persistida
      await this.loadQueue();

      while (this.syncQueue.length > 0) {
        const operation = this.syncQueue[0];

        try {
          await this.executeOperation(operation);
          this.syncQueue.shift(); // Remover si fue exitosa
          await this.persistQueue();
        } catch (error) {
          operation.retries++;
          operation.lastError = error instanceof Error ? error.message : 'Unknown error';

          if (operation.retries >= 3) {
            console.error(`❌ Operación falló después de 3 intentos: ${operation.id}`);
            this.syncQueue.shift(); // Remover después de 3 intentos
          }

          await this.persistQueue();
          break; // Parar si hay error
        }
      }

      console.log('✅ Sincronización completada');
    } catch (error) {
      console.error('Error durante sincronización:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ejecutar operación individual
   */
  private async executeOperation(operation: SyncOperation) {
    const endpoint = this.getEndpoint(operation);
    const method = this.getMethod(operation);

    console.log(`📤 Sincronizando: ${operation.type} ${operation.resource}`);

    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Operation-Id': operation.id,
      },
      body: JSON.stringify(operation.data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`✅ Operación sincronizada: ${operation.id}`, result);

    return result;
  }

  /**
   * Obtener endpoint según tipo de operación
   */
  private getEndpoint(operation: SyncOperation): string {
    const base = '/api';
    const resource = operation.resource;

    switch (operation.type) {
      case 'create':
        return `${base}/${resource}s`;
      case 'update':
        return `${base}/${resource}s/${operation.data.id}`;
      case 'delete':
        return `${base}/${resource}s/${operation.data.id}`;
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Obtener método HTTP según tipo de operación
   */
  private getMethod(operation: SyncOperation): string {
    switch (operation.type) {
      case 'create':
        return 'POST';
      case 'update':
        return 'PUT';
      case 'delete':
        return 'DELETE';
      default:
        return 'POST';
    }
  }

  /**
   * Persistir queue en IndexedDB
   */
  private async persistQueue() {
    try {
      if ('indexedDB' in window) {
        const db = await this.openIndexedDB();
        const tx = db.transaction(['sync-queue'], 'readwrite');
        const store = tx.objectStore('sync-queue');

        // Limpiar y reinsert
        store.clear();
        this.syncQueue.forEach((op) => store.put(op));
      }
    } catch (error) {
      console.warn('Error persistiendo queue:', error);
    }
  }

  /**
   * Cargar queue desde IndexedDB
   */
  private async loadQueue() {
    try {
      if ('indexedDB' in window) {
        const db = await this.openIndexedDB();
        const tx = db.transaction(['sync-queue'], 'readonly');
        const store = tx.objectStore('sync-queue');

        return new Promise((resolve) => {
          const request = store.getAll();
          request.onsuccess = () => {
            this.syncQueue = request.result;
            resolve(request.result);
          };
        });
      }
    } catch (error) {
      console.warn('Error cargando queue:', error);
      return [];
    }
  }

  /**
   * Abrir IndexedDB
   */
  private openIndexedDB() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('minreport-sync', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('sync-queue')) {
          db.createObjectStore('sync-queue', { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Obtener estado del queue
   */
  getQueueStatus() {
    return {
      pending: this.syncQueue.length,
      isRunning: this.isRunning,
      operations: this.syncQueue.map((op) => ({
        id: op.id,
        type: op.type,
        resource: op.resource,
        retries: op.retries,
        error: op.lastError,
      })),
    };
  }

  /**
   * Limpiar queue (destructivo)
   */
  async clearQueue() {
    this.syncQueue = [];
    await this.persistQueue();
    console.log('🧹 Queue sincronización limpiado');
  }
}

// Export singleton
export const syncManager = new BackgroundSyncManager();
