import { openDB, type IDBPDatabase } from 'idb';
import { auth } from '../firebase/config';

/**
 * EDGE-OPTIMIZER: LocalSyncQueue
 * Resiliencia Defensiva: Todo flujo de datos debe persistirse localmente antes de sincronizar.
 * Backups localStorage mitigados por WebView Clears.
 */

const DB_NAME = 'OpermaqOfflineStore';
const STORE_NAME = 'sync_queue';
const STATE_STORE = 'offline_states';
const BACKUP_KEY = 'OPERMAQ_SYNC_BACKUP';

let dbPromise: Promise<IDBPDatabase> | null = null;

export function initDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueAction(endpoint: string, payload: unknown) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const action = { endpoint, payload, timestamp: Date.now(), status: 'pending' };
  
  await store.add(action);
  
  // Respaldo secundario defensivo exigido por la Skill
  const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
  backup.push(action);
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));

  // Disparar sincronización en background si hay red
  if (navigator.onLine) {
    processQueue().catch(console.error);
  }
}

export async function processQueue() {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const allActions = await store.getAll();

  if (allActions.length === 0) return;

  console.log(`[EDGE-OPTIMIZER] Procesando ${allActions.length} acciones offline de la cola...`);

  for (const action of allActions) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(action.endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(action.payload)
      });
      
      if (response.ok) {
        // Eliminar de IDB al ser exitoso
        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
        await deleteTx.objectStore(STORE_NAME).delete(action.id);
        
        // Limpiar el backup defensivo
        const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
        const updatedBackup = backup.filter((b: { timestamp: number }) => b.timestamp !== action.timestamp);
        localStorage.setItem(BACKUP_KEY, JSON.stringify(updatedBackup));
      }
    } catch (_error) {
      console.warn('[EDGE-OPTIMIZER] Red no disponible, manteniendo en cola', action.endpoint);
      break; 
    }
  }
}

// Inicialización: auto-procesar la cola cuando se vuelve a estar online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[EDGE-OPTIMIZER] Conexión restaurada, purificando cola de sincronización.');
    processQueue();
  });
}
