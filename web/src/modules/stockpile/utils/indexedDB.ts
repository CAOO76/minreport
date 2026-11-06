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
const DB_VERSION = 1; // Incrementar SOLO si hay cambios en el schema del store

export function sanitizeStockpileTenantPrefix(tenantId?: string): string {
    const cleaned = (tenantId || 'unassigned').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return cleaned.length > 0 ? cleaned : 'unassigned';
}

function getTenantBackupKey(safeTenant: string): string {
    return `sc:${safeTenant}:backup_asset_ids`;
}

class IndexedDBStorage {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<IDBDatabase> | null = null;
    private activeSafeTenant: string = 'unassigned';

    public setActiveTenant(tenantId: string): void {
        this.activeSafeTenant = sanitizeStockpileTenantPrefix(tenantId);
    }

    private openDB(): Promise<IDBDatabase> {
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                // Solo crear el store si no existe — nunca borrar datos existentes
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = (event: Event) => {
                this.db = (event.target as IDBOpenDBRequest).result;

                // Detectar si la BD fue limpiada accidentalmente para el tenant activo
                this.detectDataLoss();

                this.db.onclose = () => {
                    console.warn('[IndexedDB] Conexión cerrada inesperadamente. Reconectando...');
                    this.db = null;
                    this.initPromise = null;
                };

                this.db.onerror = (e: Event) => {
                    console.error('[IndexedDB] Error en transacción:', (e.target as IDBRequest | null)?.error);
                };

                resolve(this.db);
            };

            request.onerror = (event: Event) => {
                this.initPromise = null;
                reject(new Error(`[IndexedDB] Error al abrir BD: ${(event.target as IDBOpenDBRequest | null)?.error}`));
            };

            request.onblocked = () => {
                console.warn('[IndexedDB] Apertura bloqueada por otra pestaña. Esperando...');
            };
        });

        return this.initPromise;
    }

    private async getDB(): Promise<IDBDatabase> {
        if (this.db?.objectStoreNames.contains(STORE_NAME)) return this.db;
        this.db = null;
        this.initPromise = null;
        return this.openDB();
    }

    /** Detecta si IndexedDB fue limpiado accidentalmente usando prefijos particionados por tenant */
    private async detectDataLoss(): Promise<void> {
        try {
            const safeTenant = this.activeSafeTenant;
            const backupIds = localStorage.getItem(getTenantBackupKey(safeTenant));
            if (!backupIds) return;

            const ids: string[] = JSON.parse(backupIds);
            if (!Array.isArray(ids) || ids.length === 0) return;

            const firstId = ids[0];
            const exists = await this.get(`sc:${safeTenant}:asset:${firstId}`);

            if (!exists) {
                console.error(
                    `[IndexedDB] PÉRDIDA DE DATOS DETECTADA (${safeTenant}): El activo "${firstId}" existe en el índice de backup ` +
                    `pero NO en IndexedDB.`
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

            request.onsuccess = () => resolve((request.result as T) ?? null);
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
                // Backup particionado por tenant si corresponde al índice `sc:${safeTenant}:asset_ids`
                const match = /^sc:([^:]+):asset_ids$/.exec(key);
                if (match && Array.isArray(value)) {
                    try {
                        localStorage.setItem(getTenantBackupKey(match[1]), JSON.stringify(value));
                    } catch {
                        // localStorage puede estar lleno
                    }
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

    async clearTenant(tenantId?: string): Promise<void> {
        const safeTenant = sanitizeStockpileTenantPrefix(tenantId || this.activeSafeTenant);
        const prefix = `sc:${safeTenant}:`;
        const keys = await this.getAllKeys();
        for (const k of keys) {
            if (typeof k === 'string' && k.startsWith(prefix)) {
                await this.delete(k);
            }
        }
        try {
            localStorage.removeItem(getTenantBackupKey(safeTenant));
        } catch {
            // No crítico
        }
    }

    /** Retorna todas las claves del store */
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

    /** Backup del índice de activos del tenant activo */
    async refreshBackupIndex(tenantId?: string): Promise<void> {
        try {
            const safeTenant = sanitizeStockpileTenantPrefix(tenantId || this.activeSafeTenant);
            const ids = await this.get<string[]>(`sc:${safeTenant}:asset_ids`);
            if (Array.isArray(ids) && ids.length > 0) {
                localStorage.setItem(getTenantBackupKey(safeTenant), JSON.stringify(ids));
            }
        } catch {
            // No crítico
        }
    }
}

export const idbStorage = new IndexedDBStorage();
