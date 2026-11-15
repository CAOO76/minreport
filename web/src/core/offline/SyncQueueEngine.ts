/**
 * MINREPORT - MOTOR DE COLA DE SINCRONIZACION TRANSACCIONAL MULTI-TENANT (Capa 3 / EDGE-OPTIMIZER)
 * Valida aislamiento estricto por tenantId y contratos Zod antes de persistir en Firestore.
 */

import { doc, setDoc } from 'firebase/firestore';
import { z } from 'zod';
import { auth, db } from '../../config/firebase';
import { CreateGeoReportStampBodySchema } from '../../contracts/geo.contracts';
import { getApiUrl } from '../../utils/network';
import { coreAuthFetch } from '../network/coreAuthFetch';
import { offlineStorage, FleetInspectionRecord, StockpileSurveyRecord } from './OfflineStorage';

export type SyncTaskType =
    | 'FLEET_INSPECTION'
    | 'TENANT_ASSET'
    | 'STOCKPILE_SURVEY'
    | 'STOCKPILE_MEASUREMENT'
    | 'OPERMAQ_API_MUTATION'
    | 'CAS_MEDIA_UPLOAD'
    | 'GEO_REPORT_STAMP';

export interface CasMediaSyncPayload {
    sha256: string;
    scope?: 'GLOBAL_OEM' | 'TENANT_PRIVATE' | 'SYMBOLOGY_MASTER';
    profile?: string;
    tenantId?: string;
    filename?: string;
}

export interface OpermaqApiMutationPayload {
    endpoint: string;
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body: unknown;
    tenantId?: string;
    eventName?: string;
}

export interface SyncTask<T = any> {
    id: string;
    type: SyncTaskType;
    payload: T;
    timestamp: string;
    attempts: number;
    status: 'PENDING' | 'SYNCING' | 'FAILED' | 'COMPLETED';
    lastError?: string;
}

export interface SyncState {
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    lastSyncTimestamp: string | null;
    lastError: string | null;
}

type SyncStateListener = (state: SyncState) => void;

const FleetInspectionSyncSchema = z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1, 'tenantId es obligatorio en FLEET_INSPECTION'),
    code: z.string().min(1),
    operator: z.string().optional().default('Operador'),
    status: z.enum(['OPERATIVO', 'MANTENCION', 'FUERA_SERVICIO']),
    horometerDelta: z.number().nonnegative().default(0),
    checklist: z.record(z.string(), z.boolean()).optional(),
    observations: z.string().optional(),
    timestamp: z.number().nonnegative(),
}).passthrough();

const TenantAssetSyncSchema = z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1, 'tenantId es obligatorio en TENANT_ASSET'),
    code: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
}).passthrough();

const StockpileSurveySyncSchema = z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1, 'tenantId es obligatorio en STOCKPILE_SURVEY'),
    tag: z.string().min(1),
    material: z.string().min(1),
    shape: z.enum(['elliptic-cone', 'truncated-elliptic-cone', 'perimeter-cone', 'windrow', 'toe-wall']).default('elliptic-cone'),
    volumeM3: z.number().nonnegative(),
    density: z.number().positive(),
    tonnage: z.number().nonnegative(),
    confidence: z.number().min(0).max(100).default(95),
    lastSurvey: z.string().min(1),
    timestamp: z.number().nonnegative(),
}).passthrough();

const StockpileMeasurementSyncSchema = z.object({
    id: z.string().min(1),
    assetId: z.string().min(1, 'assetId es obligatorio en STOCKPILE_MEASUREMENT'),
    tenantId: z.string().min(1, 'tenantId es obligatorio en STOCKPILE_MEASUREMENT'),
    volumen_m3: z.number().nonnegative().optional(),
    peso_t: z.number().nonnegative().optional(),
    shape: z.enum(['elliptic-cone', 'truncated-elliptic-cone', 'perimeter-cone', 'windrow', 'toe-wall']).optional(),
    timestamp: z.number().nonnegative(),
}).passthrough();

function resolveActiveTenantId(candidate?: unknown): string {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
    }
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('minreport_active_account_id');
        if (stored && stored.trim().length > 0) {
            return stored.trim();
        }
    }
    return '';
}

class SyncQueueEngine {
    private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
    private isSyncing: boolean = false;
    private listeners: Set<SyncStateListener> = new Set();
    private lastSyncTimestamp: string | null = null;
    private lastError: string | null = null;
    private cachedPendingCount: number = 0;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.handleNetworkChange(true));
            window.addEventListener('offline', () => this.handleNetworkChange(false));
            this.refreshPendingCount();
        }
    }

    private handleNetworkChange(online: boolean) {
        this.isOnline = online;
        this.notifyListeners();
        if (online) {
            this.drainQueue();
        }
    }

    public subscribe(listener: SyncStateListener): () => void {
        this.listeners.add(listener);
        listener(this.getState());
        return () => this.listeners.delete(listener);
    }

    public getState(): SyncState {
        return {
            isOnline: this.isOnline,
            isSyncing: this.isSyncing,
            pendingCount: this.cachedPendingCount,
            lastSyncTimestamp: this.lastSyncTimestamp,
            lastError: this.lastError
        };
    }

    public isOnlineNow(): boolean {
        return this.isOnline;
    }

    public async saveOfflineKnowledge(key: string, value: unknown): Promise<void> {
        await offlineStorage.putOfflineMetadata(key, value);
    }

    public async getOfflineKnowledge<T = unknown>(key: string): Promise<T | null> {
        return offlineStorage.getOfflineMetadata<T>(key);
    }

    public async enqueueApiMutation(
        endpoint: string,
        body: unknown,
        eventName?: string,
        tenantId?: string,
        method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'
    ): Promise<string> {
        const resolvedTenant = resolveActiveTenantId(tenantId || (body as any)?.tenantId || (body as any)?.accountId);
        return this.enqueueTask<OpermaqApiMutationPayload>('OPERMAQ_API_MUTATION', {
            endpoint,
            method,
            body,
            tenantId: resolvedTenant || undefined,
            eventName,
        });
    }

    private notifyListeners() {
        const state = this.getState();
        this.listeners.forEach(cb => {
            try {
                cb(state);
            } catch (err) {
                console.error('[SYNC-ENGINE] Error en listener reactivo:', err);
            }
        });
    }

    public async refreshPendingCount(tenantId?: string): Promise<number> {
        try {
            const tasks = await offlineStorage.getAllSyncTasks();
            const pending = tasks.filter((t) => {
                const isPendingStatus = t.status === 'PENDING' || t.status === 'FAILED';
                if (!isPendingStatus) return false;
                if (!tenantId) return true;
                const taskTenant = t.payload?.tenantId || t.payload?.accountId;
                return !taskTenant || taskTenant === tenantId;
            });
            this.cachedPendingCount = pending.length;
            this.notifyListeners();
            return this.cachedPendingCount;
        } catch (e) {
            console.warn('[SYNC-ENGINE] No se pudo obtener recuento de tareas:', e);
            return this.cachedPendingCount;
        }
    }

    public async enqueue(request: {
        module?: string;
        entityType?: SyncTask['type'];
        type?: SyncTask['type'];
        targetCollection?: string;
        operation?: string;
        tenantId?: string;
        payload: Record<string, unknown>;
        id?: string;
    }): Promise<string> {
        const resolvedType: SyncTask['type'] =
            request.entityType ||
            request.type ||
            (request.targetCollection === 'inspections'
                ? 'FLEET_INSPECTION'
                : (request.targetCollection === 'stockpile_measurements' ||
                    request.targetCollection === 'stockpiles/measurements' ||
                    (typeof request.targetCollection === 'string' &&
                        request.targetCollection.startsWith('stockpiles/') &&
                        request.targetCollection.endsWith('/measurements')))
                    ? 'STOCKPILE_MEASUREMENT'
                    : request.targetCollection === 'stockpiles'
                        ? 'STOCKPILE_SURVEY'
                        : 'TENANT_ASSET');

        const generatedId =
            request.id ||
            (typeof request.payload?.id === 'string' && request.payload.id) ||
            `${resolvedType.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const mergedPayload = {
            ...request.payload,
            id: generatedId,
            tenantId: resolveActiveTenantId(
                request.tenantId ||
                (request.payload?.tenantId as string | undefined) ||
                (request.payload?.accountId as string | undefined)
            ),
        };

        return this.enqueueTask(resolvedType, mergedPayload, generatedId);
    }

    public async enqueueTask<T>(type: SyncTask['type'], payload: T, customId?: string): Promise<string> {
        const enrichedPayload = (payload && typeof payload === 'object')
            ? {
                ...(payload as Record<string, unknown>),
                tenantId: resolveActiveTenantId((payload as any).tenantId || (payload as any).accountId),
            }
            : payload;

        const taskId = customId || `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const task: SyncTask<T> = {
            id: taskId,
            type,
            payload: enrichedPayload as T,
            timestamp: new Date().toISOString(),
            attempts: 0,
            status: 'PENDING'
        };

        await offlineStorage.putSyncTask(task);
        await this.refreshPendingCount();

        if (this.isOnline && !this.isSyncing) {
            setTimeout(() => this.drainQueue(), 100);
        }

        return taskId;
    }

    public async drainQueue(): Promise<void> {
        if (this.isSyncing || !this.isOnline) return;

        this.isSyncing = true;
        this.lastError = null;
        this.notifyListeners();

        try {
            const allTasks: SyncTask[] = await offlineStorage.getAllSyncTasks();
            const pendingTasks = allTasks.filter(t => t.status === 'PENDING' || t.status === 'FAILED');

            for (const task of pendingTasks) {
                if (!this.isOnline) {
                    break;
                }

                task.status = 'SYNCING';
                task.attempts += 1;
                await offlineStorage.putSyncTask(task);

                try {
                    await this.executeTask(task);
                    await offlineStorage.deleteSyncTask(task.id);
                } catch (err: any) {
                    console.error(`[SYNC-ENGINE] Fallo al procesar tarea ${task.id}:`, err);
                    task.status = 'FAILED';
                    task.lastError = err?.message || 'Error desconocido de red/servidor';
                    await offlineStorage.putSyncTask(task);

                    if (typeof navigator !== 'undefined' && !navigator.onLine) {
                        this.isOnline = false;
                        break;
                    }
                }
            }

            this.lastSyncTimestamp = new Date().toISOString();
        } catch (err: any) {
            this.lastError = err?.message || 'Fallo general al procesar cola de sincronizacion';
        } finally {
            this.isSyncing = false;
            await this.refreshPendingCount();
        }
    }

    private async executeTask(task: SyncTask): Promise<void> {
        switch (task.type) {
            case 'FLEET_INSPECTION': {
                const raw = task.payload as Partial<FleetInspectionRecord> & Record<string, unknown>;
                const validated = FleetInspectionSyncSchema.parse({
                    ...raw,
                    tenantId: resolveActiveTenantId(raw.tenantId || raw.accountId),
                });
                const docRef = doc(db, 'inspections', validated.id);
                await setDoc(docRef, {
                    ...validated,
                    accountId: validated.tenantId,
                    syncedAt: new Date().toISOString(),
                    syncEngine: 'MINREPORT_WEB3_OFFLINE_v2'
                }, { merge: true });
                break;
            }
            case 'TENANT_ASSET': {
                const raw = task.payload as Record<string, unknown>;
                const validated = TenantAssetSyncSchema.parse({
                    ...raw,
                    tenantId: resolveActiveTenantId(raw.tenantId || raw.accountId),
                });

                const user = auth.currentUser;
                const devFallbackToken =
                    typeof window !== 'undefined'
                        ? localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token')
                        : null;
                const idToken = user ? await user.getIdToken() : devFallbackToken;
                if (!idToken) {
                    throw new Error('Sesion requerida para drenar TENANT_ASSET offline');
                }

                const activeTenantId = resolveActiveTenantId(validated.tenantId);
                if (!activeTenantId) {
                    throw new Error('tenantId obligatorio para sincronizar TENANT_ASSET');
                }

                const rawRecord = validated as Record<string, unknown>;
                const makeOficial = String(
                    rawRecord.make_oficial || rawRecord.make || 'GENÉRICO'
                ).trim();
                const modelOficial = String(
                    rawRecord.model_oficial ||
                        rawRecord.model ||
                        validated.name ||
                        validated.code ||
                        validated.id
                ).trim();

                const apiBody = {
                    ...rawRecord,
                    make_oficial: makeOficial,
                    model_oficial: modelOficial,
                    categoria_equipo: String(
                        rawRecord.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL'
                    ),
                    isGlobalOnly: Boolean(rawRecord.isGlobalOnly),
                };

                const res = await fetch(getApiUrl('/api/assets/add-tenant-catalog'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${idToken}`,
                        'X-Active-Account-Id': activeTenantId,
                    },
                    body: JSON.stringify(apiBody),
                });

                if (!res.ok) {
                    throw new Error(
                        `HTTP ${res.status} al sincronizar TENANT_ASSET en /api/assets/add-tenant-catalog`
                    );
                }
                break;
            }
            case 'STOCKPILE_SURVEY': {
                const raw = task.payload as Partial<StockpileSurveyRecord> & Record<string, unknown>;
                const { measurements: _ignoredMeasurements, ...compactRaw } = raw;
                const validated = StockpileSurveySyncSchema.parse({
                    ...compactRaw,
                    id: String(raw.id || raw.surveyId || ''),
                    tenantId: resolveActiveTenantId(raw.tenantId || raw.accountId),
                    tag: String(raw.tag || raw.name || 'ACOPIO'),
                    material: String(raw.material || raw.clase || 'mineral'),
                    lastSurvey: String(raw.lastSurvey || raw.surveyDate || new Date().toISOString()),
                    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
                });
                const docRef = doc(db, 'stockpiles', validated.id);
                await setDoc(docRef, {
                    ...validated,
                    accountId: validated.tenantId,
                    syncedAt: new Date().toISOString(),
                    syncEngine: 'MINREPORT_WEB3_OFFLINE_v2'
                }, { merge: true });
                break;
            }
            case 'STOCKPILE_MEASUREMENT': {
                const raw = task.payload as Record<string, unknown>;
                const validated = StockpileMeasurementSyncSchema.parse({
                    ...raw,
                    id: String(raw.id || raw.measurementId || ''),
                    assetId: String(raw.assetId || raw.stockpileId || ''),
                    tenantId: resolveActiveTenantId(raw.tenantId || raw.accountId),
                    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
                });
                const measRef = doc(db, 'stockpiles', validated.assetId, 'measurements', validated.id);
                await setDoc(measRef, {
                    ...validated,
                    accountId: validated.tenantId,
                    syncedAt: new Date().toISOString(),
                    syncEngine: 'MINREPORT_WEB3_OFFLINE_v2'
                }, { merge: true });
                await offlineStorage.saveStockpileMeasurement({
                    id: validated.id,
                    assetId: validated.assetId,
                    tenantId: validated.tenantId,
                    shape: validated.shape,
                    payload: validated as Record<string, unknown>,
                    timestamp: validated.timestamp,
                    synced: true,
                }).catch(() => { /* no bloquear sync remoto por cache IDB */ });
                break;
            }
            case 'OPERMAQ_API_MUTATION': {
                const mutation = task.payload as OpermaqApiMutationPayload;
                const user = auth.currentUser;
                const devFallbackToken =
                    typeof window !== 'undefined'
                        ? localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token')
                        : null;
                const idToken = user ? await user.getIdToken() : devFallbackToken;
                if (!idToken) {
                    throw new Error('Sesion requerida para drenar mutacion API offline');
                }

                const normalizedEndpoint = mutation.endpoint.startsWith('/api/')
                    ? mutation.endpoint
                    : mutation.endpoint.startsWith('/')
                        ? `/api${mutation.endpoint}`
                        : `/api/${mutation.endpoint}`;
                const resolvedUrl = mutation.endpoint.startsWith('http')
                    ? mutation.endpoint
                    : getApiUrl(normalizedEndpoint);

                const activeTenantId = resolveActiveTenantId(mutation.tenantId);
                if (!activeTenantId) {
                    throw new Error('tenantId obligatorio para sincronizar mutacion OPERMAQ');
                }

                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                    'X-Active-Account-Id': activeTenantId,
                };

                const res = await fetch(resolvedUrl, {
                    method: mutation.method || 'POST',
                    headers,
                    body: JSON.stringify(mutation.body),
                });

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} al sincronizar ${mutation.endpoint}`);
                }
                break;
            }
            case 'CAS_MEDIA_UPLOAD': {
                const mediaPayload = task.payload as CasMediaSyncPayload;
                const casRecord = await offlineStorage.getCasBlob(mediaPayload.sha256);
                if (!casRecord) {
                    break;
                }
                const resolvedTenantId = resolveActiveTenantId(mediaPayload.tenantId || casRecord.tenantId);
                const { mediaDigestorClient } = await import('../media/MediaDigestorClient');
                await mediaDigestorClient.digestAndUploadCas(casRecord.blob, {
                    profile: (mediaPayload.profile || casRecord.profile) as any,
                    scope: mediaPayload.scope || (casRecord.scope as any) || 'TENANT_PRIVATE',
                    tenantId: resolvedTenantId || undefined,
                    filename: mediaPayload.filename || casRecord.filename,
                });
                break;
            }
            case 'GEO_REPORT_STAMP': {
                const raw = (task.payload || {}) as Record<string, unknown>;
                const resolvedAccountId = resolveActiveTenantId(raw.accountId || raw.tenantId);
                const validated = CreateGeoReportStampBodySchema.parse({
                    accountId: resolvedAccountId || undefined,
                    moduleId: raw.moduleId,
                    entityType: raw.entityType,
                    entityId: raw.entityId,
                    fix: raw.fix,
                    label: raw.label,
                });

                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                };
                if (validated.accountId) {
                    headers['X-Active-Account-Id'] = validated.accountId;
                }

                const res = await coreAuthFetch('/api/geo/report-stamp', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(validated),
                });

                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(
                        (errJson as any)?.error ||
                            `HTTP ${res.status} al sincronizar GEO_REPORT_STAMP en /api/geo/report-stamp`
                    );
                }
                break;
            }
            default:
                throw new Error(`Tipo de tarea no soportado: ${(task as any).type}`);
        }
    }
}

export const syncQueueEngine = new SyncQueueEngine();
export const syncQueue = syncQueueEngine;
