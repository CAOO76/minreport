/**
 * IndexedDB wrapper — Capa de persistencia principal del Plugin.
 *
 * Estrategia Anti-Pérdida de Datos:
 *  - DB_VERSION controlado: solo se reinicia el store si la versión CAMBIA explícitamente
 *  - Backup de índice (IDs de activos) en localStorage como capa de seguridad
 *  - Detección de limpieza accidental: si IndexedDB está vacío pero localStorage tiene IDs,
 *    se emite un warning en consola para diagnóstico
 *
 * NOTA: En Android, el WebView puede borrar IndexedDB al actualizar/reinstalar la app
 * si el APK no conserva los datos de la app. Para datos productivos usar Capacitor Filesystem.
 */

const DB_NAME = 'MinReportPluginDB';
const STORE_NAME = 'secure_storage';
const DB_VERSION = 1; // ⚠️ Incrementar SOLO si hay cambios en el schema del store

// Clave de backup de emergencia en localStorage
const BACKUP_IDS_KEY = 'sc_backup_asset_ids';

class IndexedDBStorage {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<IDBDatabase> | null = null;

    private openDB(): Promise<IDBDatabase> {
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                // Solo crear el store si no existe — nunca borrar datos existentes
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                    console.log('[IndexedDB] Store creado por primera vez.');
                }
            };

            request.onsuccess = (event: any) => {
                this.db = event.target.result;

                // Detectar si la BD fue limpiada accidentalmente
                this.detectDataLoss();

                // Handler de cierre inesperado (e.g. actualización de BD en otra pestaña)
                this.db!.onclose = () => {
                    console.warn('[IndexedDB] Conexión cerrada inesperadamente. Reconectando...');
                    this.db = null;
                    this.initPromise = null;
                };

                this.db!.onerror = (e: any) => {
                    console.error('[IndexedDB] Error en transacción:', e.target?.error);
                };

                resolve(this.db!);
            };

            request.onerror = (event: any) => {
                this.initPromise = null;
                reject(new Error(`[IndexedDB] Error al abrir BD: ${event.target?.error}`));
            };

            request.onblocked = () => {
                console.warn('[IndexedDB] Apertura bloqueada por otra pestaña. Esperando...');
            };
        });

        return this.initPromise;
    }

    private async getDB(): Promise<IDBDatabase> {
        if (this.db?.objectStoreNames.contains(STORE_NAME)) return this.db;
        // Resetear si la conexión fue cerrada
        this.db = null;
        this.initPromise = null;
        return this.openDB();
    }

    /** Detecta si IndexedDB fue limpiado (e.g. al reinstalar APK) */
    private async detectDataLoss(): Promise<void> {
        try {
            const backupIds = localStorage.getItem(BACKUP_IDS_KEY);
            if (!backupIds) return;

            const ids: string[] = JSON.parse(backupIds);
            if (ids.length === 0) return;

            const firstId = ids[0];
            const exists = await this.get(`sc_asset_${firstId}`);

            if (!exists) {
                console.error(
                    `[IndexedDB] ⚠️ PÉRDIDA DE DATOS DETECTADA: El activo "${firstId}" existe en el índice de backup ` +
                    `pero NO en IndexedDB. El WebView puede haber limpiado el almacenamiento.`
                );
            }
        } catch {
            // No crítico
        }
    }

    async get<T>(key: string): Promise<T | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    }

    async set<T>(key: string, value: T): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(value, key);

            request.onsuccess = () => {
                // Backup de emergencia: si es el índice de IDs, replicar en localStorage
                if (key === 'sc_all_asset_ids' && Array.isArray(value)) {
                    try {
                        localStorage.setItem(BACKUP_IDS_KEY, JSON.stringify(value));
                    } catch { /* localStorage puede estar lleno */ }
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async delete(key: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear(): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                // Limpiar también el backup al hacer un clear explícito
                localStorage.removeItem(BACKUP_IDS_KEY);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /** Retorna todas las claves del store (útil para diagnóstico) */
    async getAllKeys(): Promise<string[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAllKeys();

            request.onsuccess = () => resolve(request.result as string[]);
            request.onerror = () => reject(request.error);
        });
    }

    /** Backup del índice de activos actual (llamar al iniciar la app) */
    async refreshBackupIndex(): Promise<void> {
        try {
            const ids = await this.get<string[]>('sc_all_asset_ids');
            if (Array.isArray(ids) && ids.length > 0) {
                localStorage.setItem(BACKUP_IDS_KEY, JSON.stringify(ids));
            }
        } catch { /* No crítico */ }
    }
}

export const idbStorage = new IndexedDBStorage();
