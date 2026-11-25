/**
 * OfflineStorage - Motor de Persistencia Local Multi-Tenant para Entorno Minero
 * Estandar: EDGE-OPTIMIZER & Web 3.0 Hybrid Architecture (Capa 1/2/3)
 * v5: incorpora objectStore `capture_sessions` (CaptureSessionPackageV2) + retención CAS segura.
 */

import type {
    CaptureSessionPackageV2,
    MeasurementLifecycleStatus,
} from '../../contracts/acopios.contracts';

const DB_NAME = 'minreport_edge_db';
const DB_VERSION = 5;

export interface OfflineCasBlobRecord {
    sha256: string;
    blob?: Blob;
    /** Ruta relativa en Capacitor Filesystem (`minreport_cas/<tenantId>/<sha256>.<ext>`) cuando se persiste en disco nativo */
    fsPath?: string;
    storageBackend?: 'CAPACITOR_FS' | 'INDEXED_DB';
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
    shape: 'elliptic-cone' | 'truncated-elliptic-cone' | 'perimeter-cone' | 'windrow' | 'toe-wall';
    volumeM3: number;
    density: number;
    tonnage: number;
    confidence: number;
    lastSurvey: string;
    timestamp: number;
    synced?: boolean;
}

export interface StockpileMeasurementRecord {
    id: string;
    assetId: string;
    tenantId: string;
    shape?: 'elliptic-cone' | 'truncated-elliptic-cone' | 'perimeter-cone' | 'windrow' | 'toe-wall';
    payload: Record<string, unknown>;
    timestamp: number;
    synced?: boolean;
}

export interface CaptureSessionStoreRecord extends CaptureSessionPackageV2 {
    updatedAt: number;
}

export class OfflineStorageEngine {
    private dbPromise: Promise<IDBDatabase> | null = null;
    private readonly BACKUP_KEY = 'minreport_offline_keys_backup';

    private getDB(): Promise<IDBDatabase> {
        if (typeof indexedDB === 'undefined') {
            return Promise.reject(new Error('[OFFLINE-STORAGE] IndexedDB no disponible en este entorno'));
        }
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

                    if (!db.objectStoreNames.contains('stockpile_measurements')) {
                        const measStore = db.createObjectStore('stockpile_measurements', { keyPath: 'id' });
                        measStore.createIndex('assetId', 'assetId', { unique: false });
                        measStore.createIndex('tenantId', 'tenantId', { unique: false });
                        measStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('capture_sessions')) {
                        const sessStore = db.createObjectStore('capture_sessions', {
                            keyPath: 'sessionId',
                        });
                        sessStore.createIndex('assetId', 'assetId', { unique: false });
                        sessStore.createIndex('measurementId', 'measurementId', { unique: false });
                        sessStore.createIndex('tenantId', 'tenantId', { unique: false });
                        sessStore.createIndex('lifecycle_status', 'lifecycle_status', {
                            unique: false,
                        });
                        sessStore.createIndex('capturedAt', 'capturedAt', { unique: false });
                    }
                };
            });
        }
        return this.dbPromise;
    }

    private registerKeyBackup(storeName: string, key: string) {
        try {
            if (typeof localStorage === 'undefined') return;
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

    public async deleteStockpileSurvey(id: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_surveys', 'readwrite');
            const store = tx.objectStore('stockpile_surveys');
            const req = store.delete(id);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    public async saveStockpileMeasurement(record: StockpileMeasurementRecord): Promise<void> {
        if (!record.tenantId) {
            throw new Error('[OFFLINE-STORAGE] tenantId es obligatorio en StockpileMeasurementRecord');
        }
        if (!record.assetId) {
            throw new Error('[OFFLINE-STORAGE] assetId es obligatorio en StockpileMeasurementRecord');
        }
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_measurements', 'readwrite');
            const store = tx.objectStore('stockpile_measurements');
            const req = store.put(record);

            req.onsuccess = () => {
                this.registerKeyBackup('stockpile_measurements', record.id);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getStockpileMeasurement(id: string): Promise<StockpileMeasurementRecord | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_measurements', 'readonly');
            const store = tx.objectStore('stockpile_measurements');
            const req = store.get(id);

            req.onsuccess = () => resolve((req.result as StockpileMeasurementRecord) || null);
            req.onerror = () => reject(req.error);
        });
    }

    public async getStockpileMeasurementsByAsset(
        assetId: string,
        tenantId?: string
    ): Promise<StockpileMeasurementRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_measurements', 'readonly');
            const store = tx.objectStore('stockpile_measurements');
            const index = store.index('assetId');
            const req = index.getAll(assetId);

            req.onsuccess = () => {
                const list: StockpileMeasurementRecord[] = req.result || [];
                const filtered = tenantId ? list.filter((item) => item.tenantId === tenantId) : list;
                resolve(filtered.sort((a, b) => b.timestamp - a.timestamp));
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getAllStockpileMeasurements(tenantId?: string): Promise<StockpileMeasurementRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_measurements', 'readonly');
            const store = tx.objectStore('stockpile_measurements');
            const req = store.getAll();

            req.onsuccess = () => {
                const list: StockpileMeasurementRecord[] = req.result || [];
                const filtered = tenantId ? list.filter((item) => item.tenantId === tenantId) : list;
                resolve(filtered.sort((a, b) => b.timestamp - a.timestamp));
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async deleteStockpileMeasurement(id: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stockpile_measurements', 'readwrite');
            const store = tx.objectStore('stockpile_measurements');
            const req = store.delete(id);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ── Capture Sessions V2 (Offline-First) ──────────────────────────────────

    public async saveCaptureSession(session: CaptureSessionPackageV2): Promise<void> {
        if (!session.sessionId || !session.tenantId) {
            throw new Error('[OFFLINE-STORAGE] sessionId y tenantId obligatorios en CaptureSession');
        }
        const db = await this.getDB();
        const record: CaptureSessionStoreRecord = {
            ...session,
            updatedAt: Date.now(),
        };
        return new Promise((resolve, reject) => {
            const tx = db.transaction('capture_sessions', 'readwrite');
            const store = tx.objectStore('capture_sessions');
            const req = store.put(record);
            req.onsuccess = () => {
                this.registerKeyBackup('capture_sessions', session.sessionId);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getCaptureSession(sessionId: string): Promise<CaptureSessionStoreRecord | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('capture_sessions', 'readonly');
            const store = tx.objectStore('capture_sessions');
            const req = store.get(sessionId);
            req.onsuccess = () => resolve((req.result as CaptureSessionStoreRecord) || null);
            req.onerror = () => reject(req.error);
        });
    }

    public async getCaptureSessionByMeasurement(
        measurementId: string
    ): Promise<CaptureSessionStoreRecord | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('capture_sessions', 'readonly');
            const store = tx.objectStore('capture_sessions');
            const index = store.index('measurementId');
            const req = index.getAll(measurementId);
            req.onsuccess = () => {
                const list: CaptureSessionStoreRecord[] = req.result || [];
                if (list.length === 0) {
                    resolve(null);
                    return;
                }
                list.sort((a, b) => (b.updatedAt || b.capturedAt) - (a.updatedAt || a.capturedAt));
                resolve(list[0]);
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getCaptureSessionsByAsset(
        assetId: string,
        tenantId?: string
    ): Promise<CaptureSessionStoreRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('capture_sessions', 'readonly');
            const store = tx.objectStore('capture_sessions');
            const index = store.index('assetId');
            const req = index.getAll(assetId);
            req.onsuccess = () => {
                const list: CaptureSessionStoreRecord[] = req.result || [];
                const filtered = tenantId ? list.filter((s) => s.tenantId === tenantId) : list;
                resolve(filtered.sort((a, b) => b.capturedAt - a.capturedAt));
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async getPendingCaptureSessions(
        tenantId?: string
    ): Promise<CaptureSessionStoreRecord[]> {
        const db = await this.getDB();
        const pendingStatuses = new Set<MeasurementLifecycleStatus>([
            'CAPTURED_OFFLINE_VALID',
            'SYNCING_RAW_CAS',
        ]);
        return new Promise((resolve, reject) => {
            const tx = db.transaction('capture_sessions', 'readonly');
            const store = tx.objectStore('capture_sessions');
            const req = store.getAll();
            req.onsuccess = () => {
                const list: CaptureSessionStoreRecord[] = req.result || [];
                const filtered = list.filter(
                    (s) =>
                        pendingStatuses.has(s.lifecycle_status) &&
                        (!tenantId || s.tenantId === tenantId)
                );
                resolve(filtered.sort((a, b) => a.capturedAt - b.capturedAt));
            };
            req.onerror = () => reject(req.error);
        });
    }

    public async deleteCaptureSession(sessionId: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('capture_sessions', 'readwrite');
            const store = tx.objectStore('capture_sessions');
            const req = store.delete(sessionId);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ── Sync Queue, Metadata & CAS Blobs ─────────────────────────────────────

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

    public async getAllCasBlobs(): Promise<OfflineCasBlobRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('offline_cas_blobs', 'readonly');
            const store = tx.objectStore('offline_cas_blobs');
            const req = store.getAll();
            req.onsuccess = () => resolve((req.result as OfflineCasBlobRecord[]) || []);
            req.onerror = () => reject(req.error);
        });
    }

    public async deleteCasBlob(sha256: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('offline_cas_blobs', 'readwrite');
            const store = tx.objectStore('offline_cas_blobs');
            const req = store.delete(sha256);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}

export const offlineStorage = new OfflineStorageEngine();
