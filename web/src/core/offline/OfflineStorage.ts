/**
 * OfflineStorage - Motor de Persistencia Local Defensivo para Entorno Minero
 * Estándar: EDGE-OPTIMIZER & Web 3.0 Hybrid Architecture (Capa 1/2)
 *
 * Persistencia en IndexedDB con copia de seguridad defensiva en localStorage
 * para prevenir pérdida de datos durante Hot Reload, limpieza de WebView o corte de energía.
 */

const DB_NAME = 'minreport_edge_db';
const DB_VERSION = 2;

export interface FleetInspectionRecord {
    id: string;
    code: string;
    operator: string;
    status: 'OPERATIVO' | 'MANTENCION';
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

    /**
     * Inicializa o devuelve la instancia singleton de IndexedDB
     */
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

                    // 1. Almacén de inspecciones de maquinaria (OPERMAQ)
                    if (!db.objectStoreNames.contains('fleet_inspections')) {
                        const fleetStore = db.createObjectStore('fleet_inspections', { keyPath: 'id' });
                        fleetStore.createIndex('code', 'code', { unique: false });
                        fleetStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    // 2. Almacén de cubicaciones topográficas (STOCKPILE)
                    if (!db.objectStoreNames.contains('stockpile_surveys')) {
                        const stkStore = db.createObjectStore('stockpile_surveys', { keyPath: 'id' });
                        stkStore.createIndex('tag', 'tag', { unique: false });
                        stkStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    // 3. Almacén de flujo de caja y ledger local (MINING FLOW)
                    if (!db.objectStoreNames.contains('cashflow_events')) {
                        const flowStore = db.createObjectStore('cashflow_events', { keyPath: 'id' });
                        flowStore.createIndex('type', 'type', { unique: false });
                        flowStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    // 4. Cola de tareas transaccionales (SyncQueue)
                    if (!db.objectStoreNames.contains('sync_queue')) {
                        const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
                        syncStore.createIndex('status', 'status', { unique: false });
                        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    // 5. Metadatos de respaldo defensivo
                    if (!db.objectStoreNames.contains('offline_metadata')) {
                        db.createObjectStore('offline_metadata', { keyPath: 'key' });
                    }
                };
            });
        }
        return this.dbPromise;
    }

    // ─────────────────────────────────────────────
    // GOBERNANZA DEFENSIVA (EDGE-OPTIMIZER)
    // ─────────────────────────────────────────────
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
            console.warn('[OFFLINE-STORAGE] No se pudo guardar índice en localStorage backup:', e);
        }
    }

    // ─────────────────────────────────────────────
    // 1. OPERMAQ: Inspecciones de Maquinaria
    // ─────────────────────────────────────────────
    public async saveFleetInspection(record: FleetInspectionRecord): Promise<void> {
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

    public async getFleetInspections(): Promise<FleetInspectionRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('fleet_inspections', 'readonly');
            const store = tx.objectStore('fleet_inspections');
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // ─────────────────────────────────────────────
    // 2. STOCKPILE: Cubicaciones de Acopios
    // ─────────────────────────────────────────────
    public async saveStockpileSurvey(record: StockpileSurveyRecord): Promise<void> {
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

    public async getStockpileSurveys(): Promise<StockpileSurveyRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_surveys', 'readonly');
            const store = tx.objectStore('stockpile_surveys');
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // ─────────────────────────────────────────────
    // 3. MINING FLOW: Eventos Financieros
    // ─────────────────────────────────────────────
    public async saveCashflowEvent(record: CashflowEventRecord): Promise<void> {
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

    public async getCashflowEvents(): Promise<CashflowEventRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('cashflow_events', 'readonly');
            const store = tx.objectStore('cashflow_events');
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // ─────────────────────────────────────────────
    // 4. SYNC QUEUE: Almacén Genérico de Tareas
    // ─────────────────────────────────────────────
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
}

export const offlineStorage = new OfflineStorageEngine();
