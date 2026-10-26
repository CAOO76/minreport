import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { db, auth } from '../firebase/config';
import { collection, addDoc } from 'firebase/firestore';
import { Network } from '@capacitor/network';
import { eventBus } from './core-sdk-shield';

interface OpermaqEdgeSchema extends DBSchema {
  sync_queue: {
    key: string;
    value: {
      id: string;
      type: 'FIRESTORE' | 'API';
      targetPath: string; // url or collection
      payload: unknown;
      eventType: string;
      createdAt: number;
    };
  };
  offline_knowledge: {
    key: string;
    value: {
      key: string;
      data: unknown;
      updatedAt: number;
    };
  };
}

class EdgeSyncQueueEngine {
  private dbPromise: Promise<IDBPDatabase<OpermaqEdgeSchema>>;
  public isOnline: boolean = true;

  constructor() {
    this.dbPromise = openDB<OpermaqEdgeSchema>('opermaq-edge-vault', 3, {
      upgrade(db, _oldVersion, _newVersion, _transaction) {
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('offline_knowledge')) {
          db.createObjectStore('offline_knowledge', { keyPath: 'key' });
        }
      },
    });
    this.initNetworkListener();
  }

  private async initNetworkListener() {
    const status = await Network.getStatus();
    this.isOnline = status.connected;

    Network.addListener('networkStatusChange', (status) => {
      this.isOnline = status.connected;
      if (this.isOnline) {
        this.processQueue();
      }
    });
    
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processQueue();
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  async pushTransaction(type: 'FIRESTORE' | 'API', targetPath: string, payload: unknown, eventType: string = 'ASSET_CREATED') {
    const dbInst = await this.dbPromise;
    const task = {
      id: crypto.randomUUID(),
      type,
      targetPath,
      payload,
      eventType,
      createdAt: Date.now()
    };

    await dbInst.put('sync_queue', task);
    console.log(`[EDGE-OPTIMIZER] Operación encapsulada offline/local: ${task.id} (${type})`);

    eventBus.emit('system_event', {
      event_type: eventType,
      source_skill: 'OPERMAQ_SYNC_AGENT',
      payload: task.payload,
      timestamp: new Date().toISOString()
    });

    if (this.isOnline) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (!this.isOnline) return;

    const dbInst = await this.dbPromise;
    const tx = dbInst.transaction('sync_queue', 'readonly');
    const store = tx.objectStore('sync_queue');
    const tasks = await store.getAll();
    await tx.done;

    if (tasks.length === 0) return;
    console.log(`[EDGE-OPTIMIZER] Iniciando purga de SyncQueue (${tasks.length} pendientes)...`);

    for (const task of tasks) {
      try {
        if (task.type === 'FIRESTORE') {
          const payloadObj = (typeof task.payload === 'object' && task.payload !== null) ? task.payload : {};
          await addDoc(collection(db, task.targetPath), {
            ...payloadObj,
            syncedAt: new Date()
          });
        } else if (task.type === 'API') {
          // MIGRACIÓN: Si la URL es relativa (legacy), forzar absoluta usando API_BASE_URL
          let finalUrl = task.targetPath;
          if (finalUrl.startsWith('/')) {
            const { API_BASE_URL } = await import('../firebase/config');
            finalUrl = `${API_BASE_URL}${finalUrl}`;
            console.log(`[EDGE-MIGRATE] Corrigiendo URL relativa: ${task.targetPath} -> ${finalUrl}`);
          }

          const { getAppCheckToken } = await import('../firebase/config');
          const [idToken, appCheckToken] = await Promise.all([
            auth.currentUser?.getIdToken() || Promise.resolve(''),
            getAppCheckToken()
          ]);

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          };

          if (appCheckToken) {
            headers['X-Firebase-AppCheck'] = appCheckToken;
          }

          const res = await fetch(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(task.payload)
          });
          
          if (!res.ok) {
            const errorText = await res.text().catch(() => 'No error body');
            throw new Error(`API Sync Failed (${res.status}): ${errorText.slice(0, 100)}`);
          }
        }
        
        eventBus.emit('system_event', {
          event_type: 'DataPersistedEvent',
          source_skill: 'OPERMAQ_EDGE_AUDITOR',
          payload: { id: task.id, status: 'SYNCED', target: task.targetPath },
          timestamp: new Date().toISOString()
        });

        // Open a new transaction for deletion to avoid TransactionInactiveError
        const deleteTx = dbInst.transaction('sync_queue', 'readwrite');
        await deleteTx.objectStore('sync_queue').delete(task.id);
        await deleteTx.done;
        
        console.log(`[EDGE-OPTIMIZER] Sync Exitosa: Eliminado ${task.id} de IndexedDB.`);
        } catch (err: unknown) {
        const error = err as Error;
        console.error(`[EDGE] Error en sync de ${task.id}.`, error);
        // Si el error es 400 (Bad Request), es un error de payload irrecuperable por reintento.
        // Lo eliminamos de la cola para evitar bloqueos infinitos.
        if (error.message && error.message.includes('API Sync Failed (400)')) {
          console.warn(`[EDGE-OPTIMIZER] Descartando tarea inválida (400): ${task.id}`);
          const deleteTx = dbInst.transaction('sync_queue', 'readwrite');
          await deleteTx.objectStore('sync_queue').delete(task.id);
          await deleteTx.done;
        }
      }
    }
  }

  async saveOfflineKnowledge(key: string, data: unknown) {
    const dbInst = await this.dbPromise;
    await dbInst.put('offline_knowledge', {
      key,
      data,
      updatedAt: Date.now()
    });
    try {
      const keysJson = localStorage.getItem('opermaq_offline_keys') || '[]';
      const keys = JSON.parse(keysJson) as string[];
      if (!keys.includes(key)) {
        keys.push(key);
        localStorage.setItem('opermaq_offline_keys', JSON.stringify(keys));
      }
      localStorage.setItem(`opermaq_bkp_${key}`, JSON.stringify(data));
    } catch (e) {
      console.warn('[EDGE] Error en backup secundario LocalStorage:', e);
    }
  }

  async getOfflineKnowledge(key: string): Promise<unknown | null> {
    const dbInst = await this.dbPromise;
    const record = await dbInst.get('offline_knowledge', key);
    if (record) return record.data;
    
    try {
      const fallback = localStorage.getItem(`opermaq_bkp_${key}`);
      if (fallback) {
        console.warn(`[EDGE] Recuperando ${key} desde backup secundario LocalStorage.`);
        return JSON.parse(fallback);
      }
    } catch (e) {
      console.warn('[EDGE] Fallback LocalStorage fallido:', e);
    }
    return null;
  }
}

export const EdgeSyncQueue = new EdgeSyncQueueEngine();
