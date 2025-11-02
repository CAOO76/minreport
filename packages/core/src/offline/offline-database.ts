/**
 * Offline-First Architecture
 * Manages local data persistence, synchronization, and conflict resolution
 */

export interface OfflineDataRecord {
  id: string;
  collection: string;
  data: Record<string, any>;
  timestamp: number;
  synced: boolean;
  operation: 'create' | 'update' | 'delete';
  retries: number;
}

export interface SyncQueue {
  id: string;
  operation: OfflineDataRecord;
  createdAt: number;
  status: 'pending' | 'syncing' | 'failed';
  error?: string;
}

export interface OfflineStore {
  // Data persistence
  saveLocal(collection: string, id: string, data: Record<string, any>): Promise<void>;
  getLocal(collection: string, id: string): Promise<Record<string, any> | null>;
  getAllLocal(collection: string): Promise<Record<string, any>[]>;
  deleteLocal(collection: string, id: string): Promise<void>;
  clearLocal(collection?: string): Promise<void>;
  
  // Sync queue management
  addToSyncQueue(record: OfflineDataRecord): Promise<void>;
  getSyncQueue(): Promise<SyncQueue[]>;
  removeSyncQueueItem(id: string): Promise<void>;
  clearSyncQueue(): Promise<void>;
  
  // Storage info
  getStorageInfo(): Promise<{
    usedBytes: number;
    quotaBytes: number;
    percentUsed: number;
  }>;
}

/**
 * IndexedDB implementation for offline storage
 */
export class OfflineDatabase implements OfflineStore {
  private db: IDBDatabase | null = null;
  private dbName = 'minreport-offline';
  private dataStoreName = 'offline-data';
  private syncQueueStoreName = 'sync-queue';
  private version = 1;

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(this.dataStoreName)) {
          const dataStore = db.createObjectStore(this.dataStoreName, { keyPath: 'id' });
          dataStore.createIndex('collection', 'collection', { unique: false });
          dataStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.syncQueueStoreName)) {
          const queueStore = db.createObjectStore(this.syncQueueStoreName, { keyPath: 'id' });
          queueStore.createIndex('status', 'status', { unique: false });
          queueStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  async saveLocal(collection: string, id: string, data: Record<string, any>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const record: OfflineDataRecord = {
      id: `${collection}:${id}`,
      collection,
      data,
      timestamp: Date.now(),
      synced: false,
      operation: 'update',
      retries: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.dataStoreName], 'readwrite');
      const store = tx.objectStore(this.dataStoreName);
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getLocal(collection: string, id: string): Promise<Record<string, any> | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.dataStoreName], 'readonly');
      const store = tx.objectStore(this.dataStoreName);
      const request = store.get(`${collection}:${id}`);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
    });
  }

  async getAllLocal(collection: string): Promise<Record<string, any>[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.dataStoreName], 'readonly');
      const store = tx.objectStore(this.dataStoreName);
      const index = store.index('collection');
      const request = index.getAll(collection);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = request.result as OfflineDataRecord[];
        resolve(records.map(r => r.data));
      };
    });
  }

  async deleteLocal(collection: string, id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.dataStoreName], 'readwrite');
      const store = tx.objectStore(this.dataStoreName);
      const request = store.delete(`${collection}:${id}`);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearLocal(collection?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.dataStoreName], 'readwrite');
      const store = tx.objectStore(this.dataStoreName);

      if (collection) {
        const index = store.index('collection');
        const range = IDBKeyRange.only(collection);
        const request = index.getAll(range);

        request.onsuccess = () => {
          const records = request.result as OfflineDataRecord[];
          for (const record of records) {
            store.delete(record.id);
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      } else {
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      }
    });
  }

  async addToSyncQueue(record: OfflineDataRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const queueItem: SyncQueue = {
      id: `sync:${Date.now()}:${Math.random()}`,
      operation: record,
      createdAt: Date.now(),
      status: 'pending',
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.syncQueueStoreName], 'readwrite');
      const store = tx.objectStore(this.syncQueueStoreName);
      const request = store.add(queueItem);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getSyncQueue(): Promise<SyncQueue[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.syncQueueStoreName], 'readonly');
      const store = tx.objectStore(this.syncQueueStoreName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async removeSyncQueueItem(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.syncQueueStoreName], 'readwrite');
      const store = tx.objectStore(this.syncQueueStoreName);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearSyncQueue(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.syncQueueStoreName], 'readwrite');
      const store = tx.objectStore(this.syncQueueStoreName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getStorageInfo(): Promise<{
    usedBytes: number;
    quotaBytes: number;
    percentUsed: number;
  }> {
    if (!navigator.storage?.estimate) {
      return {
        usedBytes: 0,
        quotaBytes: 0,
        percentUsed: 0,
      };
    }

    const estimate = await navigator.storage.estimate();
    return {
      usedBytes: estimate.usage || 0,
      quotaBytes: estimate.quota || 0,
      percentUsed: estimate.usage && estimate.quota 
        ? (estimate.usage / estimate.quota) * 100 
        : 0,
    };
  }
}

// Export singleton
export const offlineDb = new OfflineDatabase();
