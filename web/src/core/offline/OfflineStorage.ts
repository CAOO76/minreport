/**
 * OfflineStorage - Motor de Persistencia Local Multi-Tenant para Entorno Minero
 * Estandar: EDGE-OPTIMIZER & Web 3.0 Hybrid Architecture (Capa 1/2/3)
 */

const DB_NAME = 'minreport_edge_db';
const DB_VERSION = 3;

export interface OfflineCasBlobRecord {
    sha256: string;
    blob: Blob;
    mimeType: string;
    profile: string;
    scope: string;
    tenantId?: string;
    filename?: string;
    originalBytes: number;
    optimizedBytes: number;
    updatedAt: number;
}

export interface FleetInspectionRecord {
    id: string;
    tenantId: string;
    code: string;
    operator: string;
    status: 'OPERATIVO' | 'MANTENCION' | 'FUERA_SERVICIO';
    horometerDelta: number;
    checklist: {
        brakes: boolean;
        hydraulics: boolean;
        oilLevel: boolean;
        fireExtinguisher: boolean;
        lightsBeacon: boolean;
    };
    observations?: string;
    timestamp: number;
    synced?: boolean;
}

export interface StockpileSurveyRecord {
    id: string;
    tenantId: string;
    tag: string;
    material: string;
    shape: 'elliptic-cone' | 'truncated-elliptic-cone' | 'perimeter-cone';
    volumeM3: number;
    density: number;
    tonnage: number;
    confidence: number;
    lastSurvey: string;
    timestamp: number;
    synced?: boolean;
}

export interface CashflowEventRecord {
    id: string;
    tenantId: string;
    type: 'INCOME' | 'EXPENSE';
    category: string;
    amountUSD: number;
    amountCLP: number;
    description: string;
    timestamp: number;
    synced?: boolean;
}

export class OfflineStorageEngine {
    private dbPromise: Promise<IDBDatabase> | null = null;
    private readonly BACKUP_KEY = 'minreport_offline_keys_backup';

    private getDB(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = () => {
                    console.error('[OFFLINE-STORAGE] Error abriendo IndexedDB:', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    resolve(request.result);
                };

                request.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;

                    if (!db.objectStoreNames.contains('fleet_inspections')) {
                        const fleetStore = db.createObjectStore('fleet_inspections', { keyPath: 'id' });
                        fleetStore.createIndex('code', 'code', { unique: false });
                        fleetStore.createIndex('tenantId', 'tenantId', { unique: false });
                        fleetStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('stockpile_surveys')) {
                        const stkStore = db.createObjectStore('stockpile_surveys', { keyPath: 'id' });
                        stkStore.createIndex('tag', 'tag', { unique: false });
                        stkStore.createIndex('tenantId', 'tenantId', { unique: false });
                        stkStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('cashflow_events')) {
                        const flowStore = db.createObjectStore('cashflow_events', { keyPath: 'id' });
                        flowStore.createIndex('type', 'type', { unique: false });
                        flowStore.createIndex('tenantId', 'tenantId', { unique: false });
                        flowStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('sync_queue')) {
                        const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
                        syncStore.createIndex('status', 'status', { unique: false });
                        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('offline_metadata')) {
                        db.createObjectStore('offline_metadata', { keyPath: 'key' });
                    }

                    if (!db.objectStoreNames.contains('offline_cas_blobs')) {
                        const casStore = db.createObjectStore('offline_cas_blobs', { keyPath: 'sha256' });
                        casStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }
                };
            });
        }
        return this.dbPromise;
    }

    private registerKeyBackup(storeName: string, key: string) {
        try {
            const raw = localStorage.getItem(this.BACKUP_KEY) || '{}';
            const backup: Record<string, string[]> = JSON.parse(raw);
            if (!backup[storeName]) backup[storeName] = [];
            if (!backup[storeName].includes(key)) {
                backup[storeName].push(key);
                localStorage.setItem(this.BACKUP_KEY, JSON.stringify(backup));
            }
        } catch (e) {
            console.warn('[OFFLINE-STORAGE] No se pudo guardar indice en localStorage backup:', e);
        }
    }

    public async saveFleetInspection(record: FleetInspectionRecord): Promise<void> {
        if (!record.tenantId) {
            throw new Error('[OFFLINE-STORAGE] tenantId es obligatorio en FleetInspectionRecord');
        }
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('fleet_inspections', 'readwrite');
            const store = tx.objectStore('fleet_inspections');
            const req = store.put(record);

            req.onsuccess = () => {
                this.registerKeyBackup('fleet_inspections', record.id);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getFleetInspections(tenantId?: string): Promise<FleetInspectionRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('fleet_inspections', 'readonly');
            const store = tx.objectStore('fleet_inspections');
            const req = store.getAll();

            req.onsuccess = () => {
                const list: FleetInspectionRecord[] = req.result || [];
                resolve(tenantId ? list.filter((item) => item.tenantId === tenantId) : list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async saveStockpileSurvey(record: StockpileSurveyRecord): Promise<void> {
        if (!record.tenantId) {
            throw new Error('[OFFLINE-STORAGE] tenantId es obligatorio en StockpileSurveyRecord');
        }
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_surveys', 'readwrite');
            const store = tx.objectStore('stockpile_surveys');
            const req = store.put(record);

            req.onsuccess = () => {
                this.registerKeyBackup('stockpile_surveys', record.id);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getStockpileSurveys(tenantId?: string): Promise<StockpileSurveyRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_surveys', 'readonly');
            const store = tx.objectStore('stockpile_surveys');
            const req = store.getAll();

            req.onsuccess = () => {
                const list: StockpileSurveyRecord[] = req.result || [];
                resolve(tenantId ? list.filter((item) => item.tenantId === tenantId) : list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async saveCashflowEvent(record: CashflowEventRecord): Promise<void> {
        if (!record.tenantId) {
            throw new Error('[OFFLINE-STORAGE] tenantId es obligatorio en CashflowEventRecord');
        }
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('cashflow_events', 'readwrite');
            const store = tx.objectStore('cashflow_events');
            const req = store.put(record);

            req.onsuccess = () => {
                this.registerKeyBackup('cashflow_events', record.id);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getCashflowEvents(tenantId?: string): Promise<CashflowEventRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('cashflow_events', 'readonly');
            const store = tx.objectStore('cashflow_events');
            const req = store.getAll();

            req.onsuccess = () => {
                const list: CashflowEventRecord[] = req.result || [];
                resolve(tenantId ? list.filter((item) => item.tenantId === tenantId) : list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async putSyncTask(task: any): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sync_queue', 'readwrite');
            const store = tx.objectStore('sync_queue');
            const req = store.put(task);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    public async getAllSyncTasks(): Promise<any[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sync_queue', 'readonly');
            const store = tx.objectStore('sync_queue');
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    public async deleteSyncTask(id: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sync_queue', 'readwrite');
            const store = tx.objectStore('sync_queue');
            const req = store.delete(id);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    public async putOfflineMetadata(key: string, value: unknown): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('offline_metadata', 'readwrite');
            const store = tx.objectStore('offline_metadata');
            const req = store.put({ key, value, updatedAt: Date.now() });

            req.onsuccess = () => {
                this.registerKeyBackup('offline_metadata', key);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getOfflineMetadata<T = unknown>(key: string): Promise<T | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('offline_metadata', 'readonly');
            const store = tx.objectStore('offline_metadata');
            const req = store.get(key);

            req.onsuccess = () => {
                const record = req.result as { key: string; value: T } | undefined;
                resolve(record ? record.value : null);
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async putCasBlob(record: OfflineCasBlobRecord): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('offline_cas_blobs', 'readwrite');
            const store = tx.objectStore('offline_cas_blobs');
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    public async getCasBlob(sha256: string): Promise<OfflineCasBlobRecord | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('offline_cas_blobs', 'readonly');
            const store = tx.objectStore('offline_cas_blobs');
            const req = store.get(sha256);
            req.onsuccess = () => resolve((req.result as OfflineCasBlobRecord) || null);
            req.onerror = () => reject(req.error);
        });
    }
}

export const offlineStorage = new OfflineStorageEngine();
