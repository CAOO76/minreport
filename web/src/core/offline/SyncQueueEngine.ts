/**
 * MINREPORT - MOTOR DE COLA DE SINCRONIZACION TRANSACCIONAL MULTI-TENANT (Capa 3 / EDGE-OPTIMIZER)
 * Valida aislamiento estricto por tenantId, refresca credenciales offline vía Refresh Token,
 * ejecuta drenado priorizado en 2 etapas (1º CAS Binarios -> Reescritura offline-cas:// -> 2º Firestore/IA)
 * y reintenta con retroceso exponencial + jitter en entornos subterráneos y rajo abierto.
 */

import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { z } from 'zod';
import { auth, db, storage as firebaseStorage } from '../../config/firebase';
import { CreateGeoReportStampBodySchema } from '../../contracts/geo.contracts';
import { getApiUrl } from '../../utils/network';
import { coreAuthFetch } from '../network/coreAuthFetch';
import { offlineStorage, FleetInspectionRecord, StockpileSurveyRecord } from './OfflineStorage';

export type SyncTaskType =
    | 'FLEET_INSPECTION'
    | 'TENANT_ASSET'
    | 'MINING_SITE_PROFILE'
    | 'STOCKPILE_SURVEY'
    | 'STOCKPILE_MEASUREMENT'
    | 'DEVICE_CALIBRATION'
    | 'OPERMAQ_API_MUTATION'
    | 'SUPPLY_PURCHASE_RECEIPT'
    | 'SUPPLY_API_MUTATION'
    | 'CAS_MEDIA_UPLOAD'
    | 'GEO_REPORT_STAMP'
    | 'GEOLAPP_DIGITAL_AI_ANALYZE'
    | 'GEOLAPP_SPATIAL_ANALYZE';

export interface CasMediaSyncPayload {
    sha256: string;
    module?: 'supply' | 'stockpile' | 'opermaq' | 'core';
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

export interface SupplyApiMutationPayload {
    endpoint: string;
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body: unknown;
    tenantId?: string;
    eventName?: string;
}

export interface SupplyPurchaseReceiptSyncPayload {
    endpoint?: string;
    method?: 'POST' | 'PUT' | 'PATCH';
    body: Record<string, unknown>;
    tenantId?: string;
    siteId?: string;
    sha256?: string;
    eventName?: string;
}

export interface GeolappDigitalAiSyncPayload {
    assetId: string;
    measurementId?: string;
    tenantId?: string;
    sha256?: string;
    extraSha256s?: string[];
    photoUrl?: string;
    scaleAnchorType?: string;
    scaleAnchorMeters?: number;
    referenceBaseMeters?: number;
    imuPitchDeg?: number;
    imuRollDeg?: number;
    locale?: 'es' | 'en' | 'pt';
}

export interface GeolappSpatialSyncPayload {
    assetId: string;
    measurementId?: string;
    tenantId?: string;
    sha256?: string;
    extraSha256s?: string[];
    photoUrl?: string;
    spatialPayloadSha256: string;
    locale?: 'es' | 'en' | 'pt';
}

export interface SyncTask<T = any> {
    id: string;
    type: SyncTaskType;
    payload: T;
    timestamp: string;
    attempts: number;
    status: 'PENDING' | 'SYNCING' | 'FAILED' | 'DEAD_LETTER' | 'COMPLETED';
    lastError?: string;
    httpStatus?: number;
    deadLetterAt?: string;
}

const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 403, 404, 409, 422]);

export class NonRetryableSyncError extends Error {
    public readonly httpStatus: number;
    public readonly isDeadLetter = true;

    constructor(httpStatus: number, message: string) {
        super(message);
        this.name = 'NonRetryableSyncError';
        this.httpStatus = httpStatus;
    }
}

function extractNonRetryableHttpStatus(err: unknown): number | null {
    if (err instanceof NonRetryableSyncError) {
        return err.httpStatus;
    }
    const candidate = Number((err as any)?.httpStatus);
    if (Number.isInteger(candidate) && NON_RETRYABLE_HTTP_STATUSES.has(candidate)) {
        return candidate;
    }
    return null;
}

function resolveCasMediaExtension(
    mimeType?: string,
    filename?: string,
    profile?: string
): string {
    const lowerMime = String(mimeType || '').toLowerCase();
    const lowerName = String(filename || '').toLowerCase();
    const upperProfile = String(profile || '').toUpperCase();
    if (
        upperProfile === 'XML_DTE_DOCUMENT' ||
        lowerMime.includes('xml') ||
        lowerName.endsWith('.xml')
    ) {
        return 'xml';
    }
    if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
    if (lowerMime.includes('gltf') || lowerName.endsWith('.glb')) return 'glb';
    if (lowerMime.includes('svg') || lowerName.endsWith('.svg')) return 'svg';
    if (lowerMime.includes('png') || lowerName.endsWith('.png')) return 'png';
    if (
        lowerMime.includes('jpeg') ||
        lowerMime.includes('jpg') ||
        lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg')
    ) {
        return 'jpg';
    }
    return 'webp';
}

function isSupplyCasUpload(
    mediaPayload: CasMediaSyncPayload,
    casRecord: { profile?: string; filename?: string; mimeType?: string },
    allTasks: SyncTask[]
): boolean {
    if (mediaPayload.module === 'supply') return true;
    const profile = String(mediaPayload.profile || casRecord.profile || '').toUpperCase();
    if (profile === 'XML_DTE_DOCUMENT' || profile.startsWith('SUPPLY_')) return true;
    const filename = String(mediaPayload.filename || casRecord.filename || '').toLowerCase();
    if (
        filename.startsWith('dte_') ||
        filename.includes('receipt') ||
        filename.includes('boleta') ||
        filename.includes('factura') ||
        filename.endsWith('.xml')
    ) {
        return true;
    }
    return allTasks.some(
        (t) =>
            (t.type === 'SUPPLY_PURCHASE_RECEIPT' || t.type === 'SUPPLY_API_MUTATION') &&
            ((t.payload as any)?.sha256 === mediaPayload.sha256 ||
                JSON.stringify(t.payload || {}).includes(mediaPayload.sha256))
    );
}

async function parseResponseBodySafe(res: Response): Promise<unknown> {
    if (typeof res?.json !== 'function') return null;
    try {
        return await res.json();
    } catch {
        return null;
    }
}

function dispatchSyncSuccessEvent(task: SyncTask, eventName: string | undefined, result: unknown): void {
    if (!eventName || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }
    window.dispatchEvent(
        new CustomEvent(eventName, {
            detail: {
                taskId: task.id,
                type: task.type,
                result,
            },
        })
    );
}

export interface SyncState {
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    lastSyncTimestamp: string | null;
    lastError: string | null;
}

type SyncStateListener = (state: SyncState) => void;

const TASK_PRIORITY: Record<SyncTaskType, number> = {
    CAS_MEDIA_UPLOAD: 1,
    MINING_SITE_PROFILE: 1,
    DEVICE_CALIBRATION: 2,
    STOCKPILE_SURVEY: 2,
    STOCKPILE_MEASUREMENT: 3,
    GEOLAPP_DIGITAL_AI_ANALYZE: 4,
    GEOLAPP_SPATIAL_ANALYZE: 4,
    SUPPLY_PURCHASE_RECEIPT: 4,
    TENANT_ASSET: 5,
    FLEET_INSPECTION: 5,
    OPERMAQ_API_MUTATION: 5,
    SUPPLY_API_MUTATION: 5,
    GEO_REPORT_STAMP: 5,
};

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
    material: z.string().min(1).optional(),
    shape: z.enum(['elliptic-cone', 'truncated-elliptic-cone', 'perimeter-cone', 'windrow', 'toe-wall']).default('elliptic-cone'),
    volumeM3: z.number().nonnegative().default(0),
    density: z.number().nonnegative().optional().default(0),
    tonnage: z.number().nonnegative().default(0),
    confidence: z.number().min(0).max(100).default(0),
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

function isRemoteMediaUrl(url?: string | null): url is string {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('blob:') || trimmed.startsWith('offline-cas://') || trimmed.startsWith('data:')) {
        return false;
    }
    return (
        trimmed.startsWith('https://') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('/api/media/cas/') ||
        trimmed.startsWith('/api/media/blob/')
    );
}

function extractOfflineCasSha256(url: string): string | null {
    if (!url.startsWith('offline-cas://')) return null;
    const clean = url.replace('offline-cas://', '').split('?')[0];
    const sha = clean.split('.')[0]?.trim();
    return sha || null;
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const raw = String(reader.result || '');
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
        };
        reader.onerror = () => reject(new Error('No se pudo leer binario CAS para inferencia IA'));
        reader.readAsDataURL(blob);
    });
}

function isFirebaseAuthRevokedCode(err: unknown): boolean {
    const code = String((err as any)?.code || '');
    return (
        code === 'auth/user-token-expired' ||
        code === 'auth/user-disabled' ||
        code === 'auth/user-not-found' ||
        code === 'auth/invalid-user-token' ||
        code === 'auth/token-expired'
    );
}

class SyncQueueEngine {
    private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
    private isSyncing: boolean = false;
    private listeners: Set<SyncStateListener> = new Set();
    private lastSyncTimestamp: string | null = null;
    private lastError: string | null = null;
    private cachedPendingCount: number = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.handleNetworkChange(true));
            window.addEventListener('offline', () => this.handleNetworkChange(false));
            void this.refreshPendingCount();
        }

        if (Capacitor.isNativePlatform()) {
            Network.getStatus()
                .then((status) => {
                    this.handleNetworkChange(Boolean(status.connected));
                })
                .catch(() => {});

            Network.addListener('networkStatusChange', (status) => {
                this.handleNetworkChange(Boolean(status.connected));
            }).catch(() => {});
        }
    }

    private clearRetryTimer(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    private handleNetworkChange(online: boolean): void {
        this.isOnline = online;
        if (!online) {
            this.clearRetryTimer();
        }
        this.notifyListeners();
        if (online) {
            void this.drainQueue();
        }
    }

    public async triggerReconnectSync(): Promise<void> {
        let detectedOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (Capacitor.isNativePlatform()) {
            try {
                const status = await Network.getStatus();
                detectedOnline = Boolean(status.connected);
            } catch {
                // Mantener navigator.onLine
            }
        }
        this.isOnline = detectedOnline;
        this.notifyListeners();
        if (this.isOnline) {
            await this.drainQueue();
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
            lastError: this.lastError,
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
        const resolvedTenant = resolveActiveTenantId(
            tenantId || (body as any)?.tenantId || (body as any)?.accountId
        );
        return this.enqueueTask<OpermaqApiMutationPayload>('OPERMAQ_API_MUTATION', {
            endpoint,
            method,
            body,
            tenantId: resolvedTenant || undefined,
            eventName,
        });
    }

    public async enqueueSupplyApiMutation(
        endpoint: string,
        body: unknown,
        eventName?: string,
        tenantId?: string,
        method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'
    ): Promise<string> {
        const resolvedTenant = resolveActiveTenantId(
            tenantId || (body as any)?.tenantId || (body as any)?.accountId
        );
        return this.enqueueTask<SupplyApiMutationPayload>('SUPPLY_API_MUTATION', {
            endpoint,
            method,
            body,
            tenantId: resolvedTenant || undefined,
            eventName,
        });
    }

    public async enqueueSupplyPurchaseReceipt(
        payload: SupplyPurchaseReceiptSyncPayload
    ): Promise<string> {
        const resolvedTenant = resolveActiveTenantId(
            payload.tenantId ||
                (payload.body as any)?.tenantId ||
                (payload.body as any)?.accountId
        );
        return this.enqueueTask<SupplyPurchaseReceiptSyncPayload>('SUPPLY_PURCHASE_RECEIPT', {
            ...payload,
            endpoint: payload.endpoint || '/api/supply/purchases',
            method: payload.method || 'POST',
            tenantId: resolvedTenant || undefined,
        });
    }

    private notifyListeners(): void {
        const state = this.getState();
        this.listeners.forEach((cb) => {
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
                : request.targetCollection === 'stockpile_measurements' ||
                    request.targetCollection === 'stockpiles/measurements' ||
                    (typeof request.targetCollection === 'string' &&
                        request.targetCollection.startsWith('stockpiles/') &&
                        request.targetCollection.endsWith('/measurements'))
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
        const enrichedPayload =
            payload && typeof payload === 'object'
                ? {
                      ...(payload as Record<string, unknown>),
                      tenantId: resolveActiveTenantId(
                          (payload as any).tenantId || (payload as any).accountId
                      ),
                  }
                : payload;

        const taskId = customId || `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const task: SyncTask<T> = {
            id: taskId,
            type,
            payload: enrichedPayload as T,
            timestamp: new Date().toISOString(),
            attempts: 0,
            status: 'PENDING',
        };

        await offlineStorage.putSyncTask(task);
        await this.refreshPendingCount();

        if (this.isOnline && !this.isSyncing) {
            setTimeout(() => void this.drainQueue(), 100);
        }

        return taskId;
    }

    private async probeBackendHealth(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3500);
            try {
                const res = await fetch(getApiUrl('/health'), {
                    method: 'GET',
                    signal: controller.signal,
                });
                return res.ok;
            } finally {
                clearTimeout(timer);
            }
        } catch {
            return false;
        }
    }

    private async refreshAuthTokenSilently(): Promise<{ ok: boolean; revoked: boolean }> {
        const user = auth?.currentUser;
        if (!user) {
            return { ok: true, revoked: false };
        }
        try {
            const freshToken = await user.getIdToken(true);
            if (
                freshToken &&
                typeof window !== 'undefined' &&
                (user.uid === 'dev-master-root-uid' ||
                    user.email?.toLowerCase() === 'dev@minreport.com')
            ) {
                localStorage.setItem('dev_auth_token', freshToken);
            }
            return { ok: true, revoked: false };
        } catch (err) {
            if (isFirebaseAuthRevokedCode(err)) {
                return { ok: false, revoked: true };
            }
            return { ok: false, revoked: false };
        }
    }

    private async replaceOfflineCasStrings(
        input: unknown,
        casCache: Map<string, string | null>
    ): Promise<unknown> {
        if (typeof input === 'string') {
            const sha = extractOfflineCasSha256(input);
            if (!sha) return input;
            if (!casCache.has(sha)) {
                const cachedRemote = await offlineStorage
                    .getOfflineMetadata<string>(`cas_remote_url_${sha}`)
                    .catch(() => null);
                casCache.set(sha, isRemoteMediaUrl(cachedRemote) ? cachedRemote : null);
            }
            return casCache.get(sha) || input;
        }
        if (Array.isArray(input)) {
            const mapped = await Promise.all(
                input.map((item) => this.replaceOfflineCasStrings(item, casCache))
            );
            return mapped;
        }
        if (input && typeof input === 'object') {
            const entries = await Promise.all(
                Object.entries(input as Record<string, unknown>).map(async ([k, v]) => [
                    k,
                    await this.replaceOfflineCasStrings(v, casCache),
                ])
            );
            return Object.fromEntries(entries);
        }
        return input;
    }

    private containsPendingOfflineCasRef(input: unknown): boolean {
        if (typeof input === 'string') {
            return input.startsWith('offline-cas://');
        }
        if (Array.isArray(input)) {
            return input.some((item) => this.containsPendingOfflineCasRef(item));
        }
        if (input && typeof input === 'object') {
            return Object.values(input as Record<string, unknown>).some((v) =>
                this.containsPendingOfflineCasRef(v)
            );
        }
        return false;
    }

    private async rewriteOfflineCasUrlsInPendingTasks(
        sha256: string,
        remoteUrl: string
    ): Promise<void> {
        const tasks: SyncTask[] = await offlineStorage.getAllSyncTasks().catch(() => []);
        const casCache = new Map<string, string | null>([[sha256, remoteUrl]]);
        for (const task of tasks) {
            if (
                task.type !== 'STOCKPILE_SURVEY' &&
                task.type !== 'STOCKPILE_MEASUREMENT' &&
                task.type !== 'GEOLAPP_DIGITAL_AI_ANALYZE' &&
                task.type !== 'GEOLAPP_SPATIAL_ANALYZE' &&
                task.type !== 'SUPPLY_PURCHASE_RECEIPT' &&
                task.type !== 'SUPPLY_API_MUTATION'
            ) {
                continue;
            }
            const serialized = JSON.stringify(task.payload || {});
            if (!serialized.includes(`offline-cas://${sha256}`)) continue;
            const rewritten = await this.replaceOfflineCasStrings(task.payload, casCache);
            await offlineStorage.putSyncTask({
                ...task,
                payload: rewritten,
            });
        }
    }

    private scheduleBackoffRetry(attemptCount: number): void {
        this.clearRetryTimer();
        if (!this.isOnline) return;
        const exp = Math.min(Math.max(0, attemptCount), 4);
        const baseDelayMs = Math.min(32000, 2000 * Math.pow(2, exp));
        const jitterMs = Math.floor(Math.random() * 1000);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.isOnline && !this.isSyncing) {
                void this.drainQueue();
            }
        }, baseDelayMs + jitterMs);
    }

    private async hydrateAnalyzeMediaFromCas(
        sha256?: string,
        extraSha256s?: string[],
        photoUrl?: string
    ): Promise<{
        imageBase64?: string;
        imageMimeType?: string;
        extraImagesBase64: string[];
        resolvedPhotoUrl?: string;
    }> {
        let imageBase64: string | undefined;
        let imageMimeType: string | undefined;
        if (sha256) {
            const casBlob = await offlineStorage.getCasBlob(sha256).catch(() => null);
            if (casBlob?.blob) {
                imageBase64 = await blobToBase64(casBlob.blob);
                imageMimeType = casBlob.mimeType;
            }
        }

        const casCache = new Map<string, string | null>();
        const resolvedPhotoUrl = photoUrl
            ? String(await this.replaceOfflineCasStrings(photoUrl, casCache))
            : undefined;

        const extraImagesBase64: string[] = [];
        if (Array.isArray(extraSha256s)) {
            for (const extraSha of extraSha256s.slice(0, 3)) {
                const extraBlob = await offlineStorage.getCasBlob(extraSha).catch(() => null);
                if (extraBlob?.blob) {
                    extraImagesBase64.push(await blobToBase64(extraBlob.blob));
                }
            }
        }

        return { imageBase64, imageMimeType, extraImagesBase64, resolvedPhotoUrl };
    }

    private async hasPendingStockpileSurvey(assetId: string): Promise<boolean> {
        const queuedTasks: SyncTask[] = await offlineStorage.getAllSyncTasks().catch(() => []);
        return queuedTasks.some(
            (t) =>
                t.type === 'STOCKPILE_SURVEY' &&
                (t.status === 'PENDING' || t.status === 'FAILED' || t.status === 'SYNCING') &&
                (t.payload as any)?.id === assetId
        );
    }

    public async flushQueue(): Promise<void> {
        return this.drainQueue();
    }

    public async getDeadLetterTasks(tenantId?: string): Promise<SyncTask[]> {
        try {
            const tasks = await offlineStorage.getAllSyncTasks();
            return tasks.filter((t) => {
                if (t.status !== 'DEAD_LETTER') return false;
                if (!tenantId) return true;
                const taskTenant = t.payload?.tenantId || t.payload?.accountId;
                return !taskTenant || taskTenant === tenantId;
            });
        } catch {
            return [];
        }
    }

    public async drainQueue(): Promise<void> {
        if (this.isSyncing || !this.isOnline) return;

        this.clearRetryTimer();
        this.isSyncing = true;
        this.lastError = null;
        this.notifyListeners();

        let maxFailedAttempts = 0;
        let haltedByRevocation = false;

        try {
            const tokenCheck = await this.refreshAuthTokenSilently();
            if (tokenCheck.revoked) {
                this.lastError = 'AUTH_REVOKED_REENROLL_REQUIRED';
                haltedByRevocation = true;
                return;
            }

            await this.probeBackendHealth();

            const allTasks: SyncTask[] = await offlineStorage.getAllSyncTasks();
            // Purga automática de tareas residuales obsoletas (`asset_1795234411019`)
            for (const stale of allTasks) {
                const p = (stale.payload || {}) as Record<string, any>;
                if (
                    p.id === 'asset_1795234411019' ||
                    p.assetId === 'asset_1795234411019' ||
                    p.stockpileId === 'asset_1795234411019'
                ) {
                    await offlineStorage.deleteSyncTask(stale.id);
                }
            }

            const refreshedTasks: SyncTask[] = await offlineStorage.getAllSyncTasks();
            // Excluye tareas en DEAD_LETTER (errores cliente 400/403/404/409/422) para evitar loops infinitos
            const pendingTasks = refreshedTasks
                .filter((t) => t.status === 'PENDING' || t.status === 'FAILED')
                .sort((a, b) => {
                    const pa = TASK_PRIORITY[a.type] ?? 9;
                    const pb = TASK_PRIORITY[b.type] ?? 9;
                    if (pa !== pb) return pa - pb;
                    return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
                });

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
                    const nonRetryableStatus = extractNonRetryableHttpStatus(err);
                    if (nonRetryableStatus !== null) {
                        console.error(
                            `[SYNC-ENGINE] Dead-letter HTTP ${nonRetryableStatus} en tarea ${task.id}:`,
                            err
                        );
                        task.status = 'DEAD_LETTER';
                        task.httpStatus = nonRetryableStatus;
                        task.deadLetterAt = new Date().toISOString();
                        const deadLetterError: string =
                            typeof err?.message === 'string' && err.message.trim().length > 0
                                ? err.message
                                : `HTTP ${nonRetryableStatus}`;
                        task.lastError = deadLetterError;
                        this.lastError = deadLetterError;
                        await offlineStorage.putSyncTask(task);

                        if (
                            typeof window !== 'undefined' &&
                            typeof window.dispatchEvent === 'function'
                        ) {
                            const payloadObj =
                                task.payload && typeof task.payload === 'object'
                                    ? (task.payload as Record<string, unknown>)
                                    : null;
                            window.dispatchEvent(
                                new CustomEvent('minreport:sync-dead-letter', {
                                    detail: {
                                        taskId: task.id,
                                        type: task.type,
                                        status: nonRetryableStatus,
                                        taskStatus: task.status,
                                        error: task.lastError,
                                        eventName:
                                            typeof payloadObj?.eventName === 'string'
                                                ? payloadObj.eventName
                                                : undefined,
                                    },
                                })
                            );
                        }
                        continue;
                    }

                    console.error(`[SYNC-ENGINE] Fallo al procesar tarea ${task.id}:`, err);
                    task.status = 'FAILED';
                    task.lastError = err?.message || 'Error desconocido de red/servidor';
                    maxFailedAttempts = Math.max(maxFailedAttempts, task.attempts);
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
            const remaining = await this.refreshPendingCount();
            if (!haltedByRevocation && remaining > 0 && this.isOnline) {
                this.scheduleBackoffRetry(maxFailedAttempts);
            }
        }
    }

    private async executeTask(task: SyncTask): Promise<void> {
        switch (task.type) {
            case 'CAS_MEDIA_UPLOAD': {
                const mediaPayload = task.payload as CasMediaSyncPayload;
                const casRecord = await offlineStorage.getCasBlob(mediaPayload.sha256);
                if (!casRecord) {
                    break;
                }
                const resolvedTenantId =
                    resolveActiveTenantId(mediaPayload.tenantId || casRecord.tenantId) ||
                    'offline-local';
                const resolvedProfile = String(
                    mediaPayload.profile || casRecord.profile || 'IMAGE_FIELD_EVIDENCE'
                );
                const resolvedFilename =
                    mediaPayload.filename || casRecord.filename || `${mediaPayload.sha256}.bin`;
                const resolvedExt = resolveCasMediaExtension(
                    casRecord.mimeType,
                    resolvedFilename,
                    resolvedProfile
                );
                const allQueuedTasks: SyncTask[] = await offlineStorage
                    .getAllSyncTasks()
                    .catch(() => []);
                const isSupplyMedia = isSupplyCasUpload(mediaPayload, casRecord, allQueuedTasks);
                let remoteUrl: string | null = null;

                if (resolvedProfile === 'XML_DTE_DOCUMENT' || resolvedExt === 'xml') {
                    try {
                        const form = new FormData();
                        form.append('file', casRecord.blob, resolvedFilename);
                        form.append('profile', 'XML_DTE_DOCUMENT');
                        form.append(
                            'scope',
                            mediaPayload.scope || casRecord.scope || 'TENANT_PRIVATE'
                        );
                        form.append(
                            'clientOriginalBytes',
                            String(casRecord.originalBytes || casRecord.blob.size)
                        );
                        const upRes = await coreAuthFetch('/api/media/digest-upload', {
                            method: 'POST',
                            headers: { 'X-Active-Account-Id': resolvedTenantId },
                            body: form,
                        });
                        if (upRes.ok) {
                            const upJson = (await parseResponseBodySafe(upRes)) as {
                                descriptor?: { downloadUrl?: string };
                            } | null;
                            if (isRemoteMediaUrl(upJson?.descriptor?.downloadUrl)) {
                                remoteUrl = upJson!.descriptor!.downloadUrl!;
                            }
                        }
                    } catch {
                        remoteUrl = null;
                    }
                } else {
                    try {
                        const { mediaDigestorClient } = await import('../media/MediaDigestorClient');
                        const { descriptor } = await mediaDigestorClient.digestAndUploadCas(
                            casRecord.blob,
                            {
                                profile: resolvedProfile as any,
                                scope:
                                    mediaPayload.scope ||
                                    (casRecord.scope as any) ||
                                    'TENANT_PRIVATE',
                                tenantId: resolvedTenantId,
                                filename: resolvedFilename,
                            }
                        );
                        if (isRemoteMediaUrl(descriptor?.downloadUrl)) {
                            remoteUrl = descriptor.downloadUrl;
                        }
                    } catch {
                        remoteUrl = null;
                    }
                }

                if (!remoteUrl && firebaseStorage) {
                    const storageFolder = isSupplyMedia ? 'supply' : 'stockpiles';
                    const storagePath = `tenants/${resolvedTenantId}/${storageFolder}/cas/${mediaPayload.sha256}.${resolvedExt}`;
                    const storageRef = ref(firebaseStorage, storagePath);
                    await uploadBytes(storageRef, casRecord.blob, {
                        contentType: casRecord.mimeType,
                        customMetadata: {
                            tenantId: resolvedTenantId,
                            sha256: mediaPayload.sha256,
                            module: isSupplyMedia ? 'supply' : 'stockpile',
                        },
                    });
                    remoteUrl = await getDownloadURL(storageRef);
                }

                if (!isRemoteMediaUrl(remoteUrl)) {
                    throw new Error(`CAS_MEDIA_UPLOAD diferido: sin URL remota para ${mediaPayload.sha256}`);
                }

                await offlineStorage.putOfflineMetadata(
                    `cas_remote_url_${mediaPayload.sha256}`,
                    remoteUrl
                );
                await this.rewriteOfflineCasUrlsInPendingTasks(mediaPayload.sha256, remoteUrl);
                break;
            }
            case 'FLEET_INSPECTION': {
                const raw = task.payload as Partial<FleetInspectionRecord> & Record<string, unknown>;
                const validated = FleetInspectionSyncSchema.parse({
                    ...raw,
                    tenantId: resolveActiveTenantId(raw.tenantId || raw.accountId),
                });
                const docRef = doc(db, 'inspections', validated.id);
                await setDoc(
                    docRef,
                    {
                        ...validated,
                        accountId: validated.tenantId,
                        syncedAt: new Date().toISOString(),
                        syncEngine: 'MINREPORT_WEB3_OFFLINE_v3',
                    },
                    { merge: true }
                );
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
                        ? localStorage.getItem('dev_auth_token') ||
                          localStorage.getItem('dev_vault_token')
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
            case 'MINING_SITE_PROFILE': {
                const rawSite = (task.payload || {}) as Record<string, unknown>;
                const siteId = String(rawSite.id || '').trim();
                const activeTenantId = resolveActiveTenantId(rawSite.tenantId || rawSite.accountId);
                const siteName = String(rawSite.name || '').trim();
                if (!siteId || !activeTenantId || !siteName) {
                    throw new Error('id, tenantId y name obligatorios en MINING_SITE_PROFILE');
                }
                await setDoc(
                    doc(db, 'project_profiles', siteId),
                    {
                        ...rawSite,
                        id: siteId,
                        tenantId: activeTenantId,
                        accountId: activeTenantId,
                        name: siteName,
                        syncedAt: new Date().toISOString(),
                        syncEngine: 'MINREPORT_WEB3_OFFLINE_v3',
                    },
                    { merge: true }
                );
                break;
            }
            case 'STOCKPILE_SURVEY': {
                const casCache = new Map<string, string | null>();
                const resolvedRaw = (await this.replaceOfflineCasStrings(
                    task.payload,
                    casCache
                )) as Partial<StockpileSurveyRecord> & Record<string, unknown>;
                if (this.containsPendingOfflineCasRef(resolvedRaw)) {
                    throw new Error('Esperando subida CAS de fotografía antes de sincronizar acopio.');
                }
                const { measurements: _ignoredMeasurements, ...compactRaw } = resolvedRaw;
                const rawMaterial = String(resolvedRaw.material || resolvedRaw.clase || '').trim();
                const hasDeclaredMaterial =
                    rawMaterial.length > 0 && rawMaterial.toUpperCase() !== 'UNDECLARED';
                const { material: _droppedMaterial, ...compactWithoutMaterial } = compactRaw as Record<
                    string,
                    unknown
                >;
                const validated = StockpileSurveySyncSchema.parse({
                    ...compactWithoutMaterial,
                    id: String(resolvedRaw.id || resolvedRaw.surveyId || ''),
                    tenantId: resolveActiveTenantId(resolvedRaw.tenantId || resolvedRaw.accountId),
                    tag: String(resolvedRaw.tag || resolvedRaw.name || 'ACOPIO'),
                    ...(hasDeclaredMaterial ? { material: rawMaterial } : {}),
                    lastSurvey: String(
                        resolvedRaw.lastSurvey ||
                            resolvedRaw.surveyDate ||
                            new Date().toISOString()
                    ),
                    timestamp:
                        typeof resolvedRaw.timestamp === 'number'
                            ? resolvedRaw.timestamp
                            : Date.now(),
                });
                const docRef = doc(db, 'stockpiles', validated.id);
                await setDoc(
                    docRef,
                    {
                        ...validated,
                        accountId: validated.tenantId,
                        syncedAt: new Date().toISOString(),
                        syncEngine: 'MINREPORT_WEB3_OFFLINE_v3',
                    },
                    { merge: true }
                );
                break;
            }
            case 'STOCKPILE_MEASUREMENT': {
                const casCache = new Map<string, string | null>();
                const resolvedRaw = (await this.replaceOfflineCasStrings(
                    task.payload,
                    casCache
                )) as Record<string, unknown>;
                if (this.containsPendingOfflineCasRef(resolvedRaw)) {
                    throw new Error(
                        'Esperando subida CAS de fotografía antes de sincronizar medición.'
                    );
                }
                const validated = StockpileMeasurementSyncSchema.parse({
                    ...resolvedRaw,
                    id: String(resolvedRaw.id || resolvedRaw.measurementId || ''),
                    assetId: String(resolvedRaw.assetId || resolvedRaw.stockpileId || ''),
                    tenantId: resolveActiveTenantId(
                        resolvedRaw.tenantId || resolvedRaw.accountId
                    ),
                    timestamp:
                        typeof resolvedRaw.timestamp === 'number'
                            ? resolvedRaw.timestamp
                            : Date.now(),
                });
                const measRef = doc(
                    db,
                    'stockpiles',
                    validated.assetId,
                    'measurements',
                    validated.id
                );
                await setDoc(
                    measRef,
                    {
                        ...validated,
                        accountId: validated.tenantId,
                        syncedAt: new Date().toISOString(),
                        syncEngine: 'MINREPORT_WEB3_OFFLINE_v3',
                    },
                    { merge: true }
                );
                await offlineStorage
                    .saveStockpileMeasurement({
                        id: validated.id,
                        assetId: validated.assetId,
                        tenantId: validated.tenantId,
                        shape: validated.shape,
                        payload: validated as Record<string, unknown>,
                        timestamp: validated.timestamp,
                        synced: true,
                    })
                    .catch(() => {});
                break;
            }
            case 'GEOLAPP_DIGITAL_AI_ANALYZE': {
                const payload = task.payload as GeolappDigitalAiSyncPayload;
                const activeTenantId = resolveActiveTenantId(payload.tenantId);
                if (!payload.assetId || !activeTenantId) {
                    throw new Error('assetId y tenantId obligatorios en GEOLAPP_DIGITAL_AI_ANALYZE');
                }

                const { imageBase64, imageMimeType, extraImagesBase64, resolvedPhotoUrl } =
                    await this.hydrateAnalyzeMediaFromCas(
                        payload.sha256,
                        payload.extraSha256s,
                        payload.photoUrl
                    );

                const res = await coreAuthFetch(
                    `/api/geolapp/stockpiles/${encodeURIComponent(payload.assetId)}/digital-analyze`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Active-Account-Id': activeTenantId,
                        },
                        body: JSON.stringify({
                            measurementId: payload.measurementId,
                            imageBase64,
                            imageMimeType,
                            extraImagesBase64,
                            photoUrl: isRemoteMediaUrl(resolvedPhotoUrl)
                                ? resolvedPhotoUrl
                                : undefined,
                            scaleAnchorType: payload.scaleAnchorType || 'NONE',
                            scaleAnchorMeters: payload.scaleAnchorMeters,
                            referenceBaseMeters: payload.referenceBaseMeters,
                            imuPitchDeg: payload.imuPitchDeg,
                            imuRollDeg: payload.imuRollDeg,
                            locale: payload.locale || 'es',
                        }),
                    }
                );

                if (res.status === 404) {
                    if (await this.hasPendingStockpileSurvey(payload.assetId)) {
                        throw new Error('WAIT_STOCKPILE_SURVEY_SYNC');
                    }
                    break;
                }
                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(
                        (errJson as any)?.error ||
                            `HTTP ${res.status} al ejecutar GEOLAPP_DIGITAL_AI_ANALYZE`
                    );
                }
                break;
            }
            case 'GEOLAPP_SPATIAL_ANALYZE': {
                const payload = task.payload as GeolappSpatialSyncPayload;
                const activeTenantId = resolveActiveTenantId(payload.tenantId);
                if (!payload.assetId || !activeTenantId || !payload.spatialPayloadSha256) {
                    throw new Error(
                        'assetId, tenantId y spatialPayloadSha256 obligatorios en GEOLAPP_SPATIAL_ANALYZE'
                    );
                }

                const spatialRecord = await offlineStorage
                    .getCasBlob(payload.spatialPayloadSha256)
                    .catch(() => null);
                if (!spatialRecord?.blob) {
                    throw new Error(
                        `Payload espacial CAS ${payload.spatialPayloadSha256} no encontrado`
                    );
                }
                const spatialJson = JSON.parse(await spatialRecord.blob.text()) as Record<
                    string,
                    unknown
                >;

                const { imageBase64, imageMimeType, extraImagesBase64, resolvedPhotoUrl } =
                    await this.hydrateAnalyzeMediaFromCas(
                        payload.sha256,
                        payload.extraSha256s,
                        payload.photoUrl
                    );

                const res = await coreAuthFetch(
                    `/api/geolapp/stockpiles/${encodeURIComponent(payload.assetId)}/spatial-analyze`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Active-Account-Id': activeTenantId,
                        },
                        body: JSON.stringify({
                            ...spatialJson,
                            measurementId: payload.measurementId,
                            tenantId: activeTenantId,
                            imageBase64,
                            imageMimeType,
                            extraImagesBase64:
                                extraImagesBase64.length > 0 ? extraImagesBase64 : undefined,
                            photoUrl: isRemoteMediaUrl(resolvedPhotoUrl)
                                ? resolvedPhotoUrl
                                : undefined,
                            locale: payload.locale || 'es',
                        }),
                    }
                );

                if (res.status === 404) {
                    if (await this.hasPendingStockpileSurvey(payload.assetId)) {
                        throw new Error('WAIT_STOCKPILE_SURVEY_SYNC');
                    }
                    break;
                }
                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(
                        (errJson as any)?.error ||
                            `HTTP ${res.status} al ejecutar GEOLAPP_SPATIAL_ANALYZE`
                    );
                }
                break;
            }
            case 'OPERMAQ_API_MUTATION': {
                const mutation = task.payload as OpermaqApiMutationPayload;
                const normalizedEndpoint = mutation.endpoint.startsWith('http')
                    ? mutation.endpoint
                    : mutation.endpoint.startsWith('/api/')
                      ? mutation.endpoint
                      : mutation.endpoint.startsWith('/')
                        ? `/api${mutation.endpoint}`
                        : `/api/${mutation.endpoint}`;

                const activeTenantId = resolveActiveTenantId(mutation.tenantId);
                if (!activeTenantId) {
                    throw new Error('tenantId obligatorio para sincronizar mutacion OPERMAQ');
                }

                const res = await coreAuthFetch(normalizedEndpoint, {
                    method: mutation.method || 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Active-Account-Id': activeTenantId,
                    },
                    body: JSON.stringify(mutation.body),
                });

                const resultBody = await parseResponseBodySafe(res);
                if (!res.ok) {
                    const detail =
                        (resultBody as Record<string, unknown> | null)?.error ||
                        (resultBody as Record<string, unknown> | null)?.message;
                    const errMsg = `HTTP ${res.status} al sincronizar ${mutation.endpoint}${detail ? `: ${String(detail)}` : ''}`;
                    if (NON_RETRYABLE_HTTP_STATUSES.has(res.status)) {
                        throw new NonRetryableSyncError(res.status, errMsg);
                    }
                    throw new Error(errMsg);
                }
                dispatchSyncSuccessEvent(task, mutation.eventName, resultBody);
                break;
            }
            case 'SUPPLY_PURCHASE_RECEIPT': {
                const receiptTask = task.payload as SupplyPurchaseReceiptSyncPayload;
                const casCache = new Map<string, string | null>();
                const resolvedBody = (await this.replaceOfflineCasStrings(
                    receiptTask.body,
                    casCache
                )) as Record<string, unknown>;
                if (this.containsPendingOfflineCasRef(resolvedBody)) {
                    throw new Error(
                        'Esperando subida CAS de evidencia de compra antes de sincronizar SUPPLY_PURCHASE_RECEIPT.'
                    );
                }

                const rawEndpoint = receiptTask.endpoint || '/api/supply/purchases';
                const normalizedEndpoint = rawEndpoint.startsWith('http')
                    ? rawEndpoint
                    : rawEndpoint.startsWith('/api/')
                      ? rawEndpoint
                      : rawEndpoint.startsWith('/')
                        ? `/api${rawEndpoint}`
                        : `/api/${rawEndpoint}`;

                const activeTenantId = resolveActiveTenantId(
                    receiptTask.tenantId ||
                        (resolvedBody as any)?.tenantId ||
                        (resolvedBody as any)?.accountId
                );
                if (!activeTenantId) {
                    throw new Error(
                        'tenantId obligatorio para sincronizar SUPPLY_PURCHASE_RECEIPT'
                    );
                }

                const res = await coreAuthFetch(normalizedEndpoint, {
                    method: receiptTask.method || 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Active-Account-Id': activeTenantId,
                    },
                    body: JSON.stringify(resolvedBody),
                });

                const resultBody = await parseResponseBodySafe(res);
                if (!res.ok) {
                    const detail =
                        (resultBody as Record<string, unknown> | null)?.error ||
                        (resultBody as Record<string, unknown> | null)?.message;
                    const errMsg = `HTTP ${res.status} al sincronizar SUPPLY_PURCHASE_RECEIPT en ${rawEndpoint}${detail ? `: ${String(detail)}` : ''}`;
                    if (NON_RETRYABLE_HTTP_STATUSES.has(res.status)) {
                        throw new NonRetryableSyncError(res.status, errMsg);
                    }
                    throw new Error(errMsg);
                }
                dispatchSyncSuccessEvent(task, receiptTask.eventName, resultBody);
                break;
            }
            case 'SUPPLY_API_MUTATION': {
                const mutation = task.payload as SupplyApiMutationPayload;
                const casCache = new Map<string, string | null>();
                const resolvedBody = await this.replaceOfflineCasStrings(mutation.body, casCache);
                if (this.containsPendingOfflineCasRef(resolvedBody)) {
                    throw new Error(
                        'Esperando subida CAS antes de sincronizar SUPPLY_API_MUTATION.'
                    );
                }

                const normalizedEndpoint = mutation.endpoint.startsWith('http')
                    ? mutation.endpoint
                    : mutation.endpoint.startsWith('/api/')
                      ? mutation.endpoint
                      : mutation.endpoint.startsWith('/')
                        ? `/api${mutation.endpoint}`
                        : `/api/${mutation.endpoint}`;

                const activeTenantId = resolveActiveTenantId(
                    mutation.tenantId ||
                        (resolvedBody as any)?.tenantId ||
                        (resolvedBody as any)?.accountId
                );
                if (!activeTenantId) {
                    throw new Error('tenantId obligatorio para sincronizar mutacion SUPPLY');
                }

                const res = await coreAuthFetch(normalizedEndpoint, {
                    method: mutation.method || 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Active-Account-Id': activeTenantId,
                    },
                    body: JSON.stringify(resolvedBody),
                });

                const resultBody = await parseResponseBodySafe(res);
                if (!res.ok) {
                    const detail =
                        (resultBody as Record<string, unknown> | null)?.error ||
                        (resultBody as Record<string, unknown> | null)?.message;
                    const errMsg = `HTTP ${res.status} al sincronizar ${mutation.endpoint}${detail ? `: ${String(detail)}` : ''}`;
                    if (NON_RETRYABLE_HTTP_STATUSES.has(res.status)) {
                        throw new NonRetryableSyncError(res.status, errMsg);
                    }
                    throw new Error(errMsg);
                }
                dispatchSyncSuccessEvent(task, mutation.eventName, resultBody);
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
            case 'DEVICE_CALIBRATION': {
                const raw = (task.payload || {}) as Record<string, any>;
                const tenantId = resolveActiveTenantId(raw.tenantId || raw.accountId);
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                };
                if (tenantId) {
                    headers['X-Active-Account-Id'] = tenantId;
                }

                const res = await coreAuthFetch('/api/geolapp/device-calibration', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        scaleFactor: Number(raw.scaleFactor ?? 1),
                        referenceDistanceM: Number(raw.referenceDistanceM ?? 2),
                        measuredDistanceM: Number(raw.measuredDistanceM ?? 2),
                        planeNoiseRmsM: Number(raw.planeNoiseRmsM ?? 0),
                        imuPitchOffsetDeg: Number(raw.imuPitchOffsetDeg ?? 0),
                        imuRollOffsetDeg: Number(raw.imuRollOffsetDeg ?? 0),
                        calibratedAt: Number(raw.calibratedAt ?? Date.now()),
                        ...(tenantId ? { tenantId } : {}),
                        ...(typeof raw.deviceModel === 'string' && raw.deviceModel
                            ? { deviceModel: raw.deviceModel.slice(0, 120) }
                            : {}),
                        ...(typeof raw.platform === 'string' && raw.platform
                            ? { platform: raw.platform.slice(0, 32) }
                            : {}),
                    }),
                });

                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(
                        (errJson as any)?.error ||
                            `HTTP ${res.status} al sincronizar DEVICE_CALIBRATION`
                    );
                }

                const savedJson = (await res.json().catch(() => ({}))) as {
                    calibrationId?: string;
                    calibratedAt?: number;
                };
                const targetCalAt = Number(raw.calibratedAt ?? 0);
                const resolvedCalId =
                    savedJson.calibrationId ||
                    (typeof raw.calibrationId === 'string' ? raw.calibrationId : undefined);

                const histRaw = await offlineStorage.getOfflineMetadata<Array<Record<string, any>>>(
                    'spatial_device_calibration_history_v1'
                );
                if (Array.isArray(histRaw)) {
                    const nextHist = histRaw.map((entry) =>
                        Number(entry?.calibratedAt) === targetCalAt
                            ? {
                                  ...entry,
                                  calibrationId: resolvedCalId || entry.calibrationId,
                                  syncedToCloud: true,
                              }
                            : entry
                    );
                    await offlineStorage.putOfflineMetadata(
                        'spatial_device_calibration_history_v1',
                        nextHist
                    );
                }
                const currentCached = await offlineStorage.getOfflineMetadata<Record<string, any>>(
                    'spatial_device_calibration'
                );
                if (currentCached && Number(currentCached.calibratedAt) === targetCalAt) {
                    await offlineStorage.putOfflineMetadata('spatial_device_calibration', {
                        ...currentCached,
                        calibrationId: resolvedCalId || currentCached.calibrationId,
                        syncedToCloud: true,
                    });
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
