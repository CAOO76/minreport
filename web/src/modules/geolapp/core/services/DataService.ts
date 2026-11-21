/**
 * DataService — Servicio de datos de GEOLAPP (Offline-First + Cloud Firestore Subcolecciones)
 *
 * ARQUITECTURA:
 *  - Documentos padre compactos en `stockpiles/{stkId}` (< 1 MiB, metadata + último KPI).
 *  - Mediciones persistidas en subcolección `stockpiles/{stkId}/measurements/{measId}`
 *    garantizando `tenantId === accountId` <= 128 caracteres según `firestore.rules`.
 *  - Retrocompatibilidad de lectura para documentos legacy que aún incluyan array `measurements`.
 *  - Almacenamiento local unificado vía `offlineStorage` (`OfflineStorage` + `SyncQueueEngine`),
 *    con listeners `onSnapshot` con cleanup explícito al cambiar tenant o desmontar.
 */

import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    setDoc,
    where,
} from 'firebase/firestore';
import { auth, db as firebaseDb } from '../../../../config/firebase';
import { StockpileSurveyTelemetrySchema } from '../../../../contracts';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { offlineStorage, type StockpileMeasurementRecord } from '../../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../../core/offline/SyncQueueEngine';
import type {
    HitlFieldDiff,
    MiningSiteProfile,
    StockpileAsset,
    StockpileClosureReason,
    StockpileMeasurement,
} from '../types/GeolappTypes';
import {
    calculationEngine,
    computeStockpileMeasurementChain,
} from './calculation-engine';
import { storageService } from './StorageService';

export type StockpileData = StockpileAsset;
export type Unsubscribe = () => void;

export interface TenantContextInput {
    tenantId?: string;
    userId?: string;
}

export interface ShipmentClosureInput {
    dispatchReference: string;
    shippedWeightT?: number | null;
    photoUrl?: string;
    confirmationKeyword: string;
}

type CanonicalSurveyShape =
    | 'elliptic-cone'
    | 'truncated-elliptic-cone'
    | 'perimeter-cone'
    | 'windrow'
    | 'toe-wall';

function sanitizeTenantPrefix(raw?: string | null): string {
    const cleaned = (raw || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return cleaned || 'no_tenant';
}

const K = {
    assetIds: (safeTenant: string) => `geolapp:${safeTenant}:asset_ids`,
    asset: (safeTenant: string, id: string) => `geolapp:${safeTenant}:asset:${id}`,
    profiles: (safeTenant: string) => `geolapp:${safeTenant}:material_profiles`,
    sites: (safeTenant: string) => `geolapp:${safeTenant}:mining_sites`,
} as const;

function mapDeclaredGeometryToShape(rawGeometry?: string): CanonicalSurveyShape | undefined {
    switch (rawGeometry) {
        case 'elliptic-cone':
        case 'CONO_ELIPTICO':
            return 'elliptic-cone';
        case 'truncated-elliptic-cone':
        case 'CONO_ELIPTICO_TRUNCADO':
            return 'truncated-elliptic-cone';
        case 'perimeter-cone':
        case 'CONO_TRUNCADO_PERIMETRO':
            return 'perimeter-cone';
        case 'windrow':
        case 'PILA_LONGITUDINAL_WINDROW':
            return 'windrow';
        case 'toe-wall':
        case 'ACOPIO_CONTRA_MURO':
            return 'toe-wall';
        default:
            return undefined;
    }
}

function sanitizeForFirestore<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
}

function normalizeTextLimit(val: unknown, maxLen: number): string | undefined {
    if (typeof val !== 'string') return undefined;
    return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function sanitizeHitlPatch(patch: Partial<StockpileAsset>): Record<string, unknown> {
    const blockedKeys = new Set(['id', 'tenantId', 'accountId', 'createdAt', 'createdBy', 'measurements']);
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch || {})) {
        if (blockedKeys.has(key) || value === undefined) continue;
        if (
            (key === 'initial_photo_url' ||
                key === 'thumbnail_url' ||
                key === 'last_photo_url' ||
                key === 'static_map_url') &&
            typeof value === 'string' &&
            value.startsWith('data:')
        ) {
            continue;
        }
        cleaned[key] = value;
    }
    return cleaned;
}

type Listener<T> = (data: T) => void;

class EventBus {
    private ch = new Map<string, Set<Listener<any>>>();

    emit<T>(channel: string, data: T): void {
        this.ch.get(channel)?.forEach((fn) => {
            try {
                fn(data);
            } catch (err) {
                console.warn('[DataService] Error en suscriptor de eventos:', err);
            }
        });
    }

    on<T>(channel: string, fn: Listener<T>): Unsubscribe {
        if (!this.ch.has(channel)) this.ch.set(channel, new Set());
        this.ch.get(channel)!.add(fn);
        return () => {
            this.ch.get(channel)?.delete(fn);
        };
    }

    hasSubscribers(channel: string): boolean {
        return (this.ch.get(channel)?.size ?? 0) > 0;
    }
}

const bus = new EventBus();

export class DataService {
    private tenantId = '';
    private userId = '';
    private isHydratingFromCloud = false;
    private memoryCache = new Map<string, unknown>();
    private tenantAssetsSnapshotUnsub: Unsubscribe | null = null;
    private tenantSitesSnapshotUnsub: Unsubscribe | null = null;
    private measurementSnapshots = new Map<string, { unsub: Unsubscribe; refCount: number }>();

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                this.syncWithMinReport().catch((err) =>
                    console.warn('[DataService] Error sincronizando al recuperar red:', err)
                );
            });
        }
    }

    private get safeTenant(): string {
        return sanitizeTenantPrefix(this.tenantId);
    }

    private get isOnline(): boolean {
        return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }

    private matchesActiveTenant(docData?: Record<string, any> | null): boolean {
        if (!docData) return false;
        const docTenant = docData.tenantId || docData.accountId || docData.tenant_id;
        return Boolean(docTenant && docTenant === this.tenantId);
    }

    private async readMeta<T>(key: string): Promise<T | null> {
        try {
            const val = await offlineStorage.getOfflineMetadata<T>(key);
            if (val !== null) {
                this.memoryCache.set(key, val);
                return val;
            }
        } catch {
            // Fallback a memoria si IndexedDB no está disponible
        }
        return (this.memoryCache.get(key) as T | undefined) ?? null;
    }

    private async writeMeta<T>(key: string, value: T): Promise<void> {
        this.memoryCache.set(key, value);
        try {
            await offlineStorage.putOfflineMetadata(key, value);
        } catch {
            // Entorno sin IndexedDB
        }
    }

    private async readList(key: string): Promise<string[]> {
        const val = await this.readMeta<unknown>(key);
        return Array.isArray(val) ? (val as string[]) : [];
    }

    private async addToList(key: string, id: string): Promise<void> {
        const list = await this.readList(key);
        if (!list.includes(id)) {
            await this.writeMeta(key, [...list, id]);
        }
    }

    public cleanupListeners(): void {
        if (this.tenantAssetsSnapshotUnsub) {
            this.tenantAssetsSnapshotUnsub();
            this.tenantAssetsSnapshotUnsub = null;
        }
        if (this.tenantSitesSnapshotUnsub) {
            this.tenantSitesSnapshotUnsub();
            this.tenantSitesSnapshotUnsub = null;
        }
        for (const entry of this.measurementSnapshots.values()) {
            entry.unsub();
        }
        this.measurementSnapshots.clear();
    }

    private ensureTenantAssetsSnapshot(): void {
        if (this.tenantAssetsSnapshotUnsub || !firebaseDb || !this.tenantId) {
            return;
        }
        const activeTenant = this.tenantId;
        const q = query(collection(firebaseDb, 'stockpiles'), where('tenantId', '==', activeTenant));
        this.tenantAssetsSnapshotUnsub = onSnapshot(
            q,
            async (snap) => {
                if (this.tenantId !== activeTenant) return;
                let changed = false;
                const changedAssetIds: string[] = [];
                for (const change of snap.docChanges()) {
                    if (change.type === 'added' || change.type === 'modified') {
                        const raw = change.doc.data();
                        if (this.matchesActiveTenant(raw)) {
                            await this.hydrateRemoteDocToLocal({ id: change.doc.id, ...raw });
                            changed = true;
                            changedAssetIds.push(change.doc.id);
                        }
                    }
                }
                if (!changed && snap.docs.length > 0) {
                    for (const docSnap of snap.docs) {
                        const raw = docSnap.data();
                        if (this.matchesActiveTenant(raw)) {
                            await this.hydrateRemoteDocToLocal({ id: docSnap.id, ...raw });
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    const all = await this.getAllAssetsLocal();
                    bus.emit('assets', all);
                    for (const changedId of changedAssetIds.slice(0, 12)) {
                        await this.getMeasurements(changedId).catch(() => []);
                    }
                    bus.emit('meas_any', await this.getAllMeasurements());
                    bus.emit('sites', await this.getMiningSites());
                }
            },
            (err) => {
                console.warn('[DataService] Listener onSnapshot stockpiles pausado:', err.message);
            }
        );
    }

    private ensureTenantSitesSnapshot(): void {
        if (this.tenantSitesSnapshotUnsub || !firebaseDb || !this.tenantId) {
            return;
        }
        const activeTenant = this.tenantId;
        const q = query(
            collection(firebaseDb, 'project_profiles'),
            where('tenantId', '==', activeTenant)
        );
        this.tenantSitesSnapshotUnsub = onSnapshot(
            q,
            async (snap) => {
                if (this.tenantId !== activeTenant) return;
                const stored = (await this.readMeta<MiningSiteProfile[]>(K.sites(this.safeTenant))) ?? [];
                const byId = new Map<string, MiningSiteProfile>();
                for (const s of stored) {
                    if (s?.id) byId.set(s.id, s);
                }
                for (const docSnap of snap.docs) {
                    const raw = docSnap.data() as Record<string, any>;
                    if (!this.matchesActiveTenant(raw)) continue;
                    const name = String(raw.name || '').trim();
                    if (!name) continue;
                    byId.set(docSnap.id, {
                        id: docSnap.id,
                        tenantId: activeTenant,
                        accountId: activeTenant,
                        name,
                        code: typeof raw.code === 'string' ? raw.code : undefined,
                        status: raw.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
                        source:
                            raw.source === 'MINREPORT_PROJECTS_MODULE'
                                ? 'MINREPORT_PROJECTS_MODULE'
                                : 'DEV_MANUAL_REGISTRY',
                        createdAt:
                            typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
                        createdBy: String(raw.createdBy || ''),
                        updatedAt:
                            typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
                    });
                }
                const nextList = Array.from(byId.values()).sort((a, b) =>
                    a.name.localeCompare(b.name)
                );
                await this.writeMeta(K.sites(this.safeTenant), nextList);
                bus.emit('sites', await this.getMiningSites());
            },
            (err) => {
                console.warn('[DataService] Listener onSnapshot project_profiles pausado:', err.message);
            }
        );
    }

    private acquireMeasurementSnapshot(assetId: string): Unsubscribe {
        if (!firebaseDb || !this.tenantId || !assetId) {
            return () => { };
        }

        const key = `${this.safeTenant}:${assetId}`;
        const existing = this.measurementSnapshots.get(key);
        if (existing) {
            existing.refCount += 1;
        } else {
            const activeTenant = this.tenantId;
            const subCol = collection(firebaseDb, 'stockpiles', assetId, 'measurements');
            const unsub = onSnapshot(
                subCol,
                async (snap) => {
                    if (this.tenantId !== activeTenant) return;
                    let updated = false;
                    for (const docSnap of snap.docs) {
                        const raw = docSnap.data() as Record<string, any>;
                        if (raw.tenantId && raw.tenantId !== activeTenant) continue;
                        const cleanMeas = this.normalizeMeasurement({
                            ...(raw as StockpileMeasurement),
                            id: docSnap.id,
                            assetId,
                            tenantId: activeTenant,
                            accountId: activeTenant,
                        });
                        await this.saveMeasurementLocal(cleanMeas, true);
                        updated = true;
                    }
                    if (updated) {
                        const localList = await this.getMeasurementsLocal(assetId);
                        bus.emit(`meas:${assetId}`, localList);
                        bus.emit('meas_any', await this.getAllMeasurements());
                    }
                },
                (err) => {
                    console.warn(
                        `[DataService] Listener onSnapshot measurements(${assetId}) pausado:`,
                        err.message
                    );
                }
            );
            this.measurementSnapshots.set(key, { unsub, refCount: 1 });
        }

        let released = false;
        return () => {
            if (released) return;
            released = true;
            const current = this.measurementSnapshots.get(key);
            if (!current) return;
            current.refCount -= 1;
            if (current.refCount <= 0) {
                current.unsub();
                this.measurementSnapshots.delete(key);
            }
        };
    }

    private normalizeMeasurement(raw: StockpileMeasurement): StockpileMeasurement {
        const cleanPhoto =
            raw.photo_url && !String(raw.photo_url).startsWith('data:') ? raw.photo_url : '';
        return {
            ...raw,
            photo_url: cleanPhoto,
            tenantId: raw.tenantId || this.tenantId || undefined,
            accountId: raw.accountId || raw.tenantId || this.tenantId || undefined,
        };
    }

    private async saveMeasurementLocal(meas: StockpileMeasurement, synced = false): Promise<void> {
        const tenant = (meas.tenantId || this.tenantId || 'offline-local').slice(0, 128);
        const shape = mapDeclaredGeometryToShape(meas.geometry?.type);
        const record: StockpileMeasurementRecord = {
            id: meas.id,
            assetId: meas.assetId,
            tenantId: tenant,
            ...(shape ? { shape } : {}),
            payload: {
                ...meas,
                tenantId: tenant,
                accountId: tenant,
            } as unknown as Record<string, unknown>,
            timestamp: meas.timestamp || Date.now(),
            synced,
        };
        try {
            await offlineStorage.saveStockpileMeasurement(record);
        } catch {
            // Entorno sin IndexedDB
        }
        await this.writeMeta(`geolapp:${this.safeTenant}:meas:${meas.id}`, meas);
        await this.addToList(`geolapp:${this.safeTenant}:meas_ids:${meas.assetId}`, meas.id);
    }

    hasContext(): boolean {
        return Boolean(this.tenantId);
    }

    setTenantContext(context: TenantContextInput): void {
        const prevTenant = this.tenantId;
        if (context?.tenantId) {
            this.tenantId = context.tenantId.slice(0, 128);
            storageService.setTenantId(this.tenantId);
        }
        if (context?.userId) {
            this.userId = context.userId;
        } else if (auth?.currentUser?.uid) {
            this.userId = auth.currentUser.uid;
        }

        if (prevTenant !== this.tenantId) {
            this.cleanupListeners();
            this.getAllAssetsLocal()
                .then((assets) => bus.emit('assets', assets))
                .catch(() => { });
            this.getAllMeasurements()
                .then((meas) => bus.emit('meas_any', meas))
                .catch(() => { });
            this.getMiningSites()
                .then((sites) => bus.emit('sites', sites))
                .catch(() => { });
        }

        this.syncWithMinReport().catch((err) =>
            console.warn('[DataService] Sincronizacion inicial diferida (modo offline):', err)
        );
    }

    getTenantId(): string {
        return this.tenantId;
    }

    getUserId(): string {
        return auth?.currentUser?.uid || this.userId || '';
    }

    /**
     * Sincroniza la cabecera compacta del acopio (< 1 MiB) hacia `stockpiles/{stkId}`
     * y registra en `OfflineStorage.stockpile_surveys` + `SyncQueueEngine`.
     */
    private async persistAssetToCloudAndQueue(
        asset: StockpileAsset,
        measurements?: StockpileMeasurement[]
    ): Promise<void> {
        const activeTenant = (this.tenantId || asset.tenantId || '').slice(0, 128);
        const measList = measurements ?? (await this.getMeasurementsLocal(asset.id));
        const latestMeas = measList.find((m) => !m.ignored) || measList[0];
        const volumeM3 = latestMeas?.volumen_m3 ?? asset.last_volume_m3 ?? asset.volumen ?? 0;
        const declaredDensity = latestMeas?.density_factor ?? asset.density_factor;
        const tonnage =
            latestMeas?.peso_t ??
            asset.last_weight_t ??
            asset.peso_final_toneladas ??
            (typeof declaredDensity === 'number' && declaredDensity > 0
                ? volumeM3 * declaredDensity
                : 0);

        const declaredShape = mapDeclaredGeometryToShape(
            latestMeas?.geometry?.type || asset.geometria || asset.last_geometry_type
        );
        const rawConfidence = (
            latestMeas as (StockpileMeasurement & { ai_confidence?: number }) | undefined
        )?.ai_confidence;
        const verifiedConfidence =
            typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
                ? Math.min(
                    100,
                    Math.max(0, rawConfidence <= 1 ? Math.round(rawConfidence * 100) : Math.round(rawConfidence))
                )
                : undefined;

        const surveyDateIso = new Date(asset.last_measured_at || asset.createdAt || Date.now()).toISOString();

        if (
            latestMeas &&
            asset.clase &&
            declaredShape &&
            volumeM3 > 0 &&
            typeof declaredDensity === 'number' &&
            declaredDensity > 0 &&
            tonnage > 0 &&
            typeof verifiedConfidence === 'number'
        ) {
            const validation = StockpileSurveyTelemetrySchema.safeParse({
                surveyId: latestMeas.id,
                tag: asset.name,
                material: asset.clase,
                shape: declaredShape,
                volumeM3,
                density: declaredDensity,
                tonnage,
                confidence: verifiedConfidence,
                surveyDate: surveyDateIso,
            });
            if (!validation.success) {
                console.warn(
                    '[DataService] Advertencia de validacion StockpileSurveyTelemetrySchema:',
                    validation.error.issues
                );
            }
        }

        const { measurements: _omittedLegacyArray, ...assetWithoutMeasurements } =
            asset as StockpileAsset & { measurements?: unknown };

        const compactCloudPayload = sanitizeForFirestore({
            ...assetWithoutMeasurements,
            id: asset.id,
            tenantId: activeTenant,
            accountId: activeTenant,
            tag: asset.name,
            ...(asset.clase ? { material: asset.clase } : {}),
            ...(declaredShape ? { shape: declaredShape } : {}),
            volumeM3,
            ...(typeof declaredDensity === 'number' && declaredDensity > 0
                ? { density: declaredDensity }
                : {}),
            tonnage,
            ...(typeof verifiedConfidence === 'number' ? { confidence: verifiedConfidence } : {}),
            lastSurvey: surveyDateIso,
            timestamp: asset.last_measured_at || asset.createdAt || Date.now(),
            measurement_count: measList.length,
            updatedAt: Date.now(),
        });

        const effectiveSurveyShape = declaredShape || 'elliptic-cone';

        if (activeTenant) {
            try {
                await offlineStorage.saveStockpileSurvey({
                    id: asset.id,
                    tenantId: activeTenant,
                    tag: asset.name,
                    material: asset.clase || 'UNDECLARED',
                    shape: effectiveSurveyShape,
                    volumeM3: Number.isFinite(volumeM3) ? volumeM3 : 0,
                    density:
                        typeof declaredDensity === 'number' && declaredDensity > 0
                            ? declaredDensity
                            : 0,
                    tonnage: Number.isFinite(tonnage) ? tonnage : 0,
                    confidence: verifiedConfidence ?? 0,
                    lastSurvey: surveyDateIso,
                    timestamp: asset.last_measured_at || asset.createdAt || Date.now(),
                    synced: this.isOnline,
                });
            } catch {
                // Entorno sin IndexedDB
            }
        }

        const hasPendingOfflineMedia = JSON.stringify(compactCloudPayload).includes(
            'offline-cas://'
        );
        const surveyTaskId = `sync_stk_${this.safeTenant}_${asset.id}`;
        if (activeTenant) {
            try {
                await syncQueueEngine.enqueueTask(
                    'STOCKPILE_SURVEY',
                    compactCloudPayload,
                    surveyTaskId
                );
            } catch (err) {
                console.warn('[DataService] No se pudo encolar STOCKPILE_SURVEY:', err);
            }
        }

        if (firebaseDb && this.isOnline && activeTenant && !hasPendingOfflineMedia) {
            try {
                await setDoc(doc(firebaseDb, 'stockpiles', asset.id), compactCloudPayload, {
                    merge: true,
                });
                await offlineStorage.deleteSyncTask(surveyTaskId).catch(() => {});
                await syncQueueEngine.refreshPendingCount().catch(() => {});
            } catch (err) {
                console.error(
                    '[DataService] Error crítico escribiendo documento padre en stockpiles:',
                    err
                );
                await syncQueueEngine.refreshPendingCount().catch(() => {});
                throw err;
            }
        }
    }

    private async persistMeasurementToCloudAndQueue(meas: StockpileMeasurement): Promise<void> {
        const activeTenant = (this.tenantId || meas.tenantId || '').slice(0, 128);
        if (!activeTenant) return;

        const extraFields = meas as StockpileMeasurement & {
            observations?: unknown;
            notas?: unknown;
        };
        const cleanObservations = normalizeTextLimit(extraFields.observations, 20000);
        const cleanNotas = normalizeTextLimit(extraFields.notas, 20000);
        const declaredShape = mapDeclaredGeometryToShape(meas.geometry?.type);

        const cloudMeasPayload = sanitizeForFirestore({
            ...meas,
            id: meas.id,
            assetId: meas.assetId,
            tenantId: activeTenant,
            accountId: activeTenant,
            ...(declaredShape ? { shape: declaredShape } : {}),
            ...(cleanObservations !== undefined ? { observations: cleanObservations } : {}),
            ...(cleanNotas !== undefined ? { notas: cleanNotas } : {}),
            updatedAt: Date.now(),
        });

        const hasPendingOfflineMedia = JSON.stringify(cloudMeasPayload).includes('offline-cas://');
        const measTaskId = `sync_meas_${this.safeTenant}_${meas.assetId}_${meas.id}`;

        try {
            await syncQueueEngine.enqueueTask(
                'STOCKPILE_MEASUREMENT',
                cloudMeasPayload,
                measTaskId
            );
        } catch (err) {
            console.warn('[DataService] No se pudo encolar STOCKPILE_MEASUREMENT:', err);
        }

        if (firebaseDb && this.isOnline && !hasPendingOfflineMedia) {
            try {
                await setDoc(
                    doc(firebaseDb, 'stockpiles', meas.assetId, 'measurements', meas.id),
                    cloudMeasPayload,
                    { merge: true }
                );
                await this.saveMeasurementLocal(meas, true);
                await offlineStorage.deleteSyncTask(measTaskId).catch(() => {});
                await syncQueueEngine.refreshPendingCount().catch(() => {});
            } catch (err) {
                console.error(
                    '[DataService] Error crítico escribiendo subcolección measurements:',
                    err
                );
                await syncQueueEngine.refreshPendingCount().catch(() => {});
                throw err;
            }
        }
    }

    private async hydrateRemoteDocToLocal(rawDoc: Record<string, any>): Promise<StockpileAsset | null> {
        if (!rawDoc || !rawDoc.id) return null;
        if (!this.matchesActiveTenant(rawDoc)) {
            return null;
        }

        const remoteLegacyMeasurements: StockpileMeasurement[] = Array.isArray(rawDoc.measurements)
            ? rawDoc.measurements
            : [];

        const rawLat = rawDoc.geo_point?.latitude ?? rawDoc.location?.lat;
        const rawLng = rawDoc.geo_point?.longitude ?? rawDoc.location?.lng;
        const hasValidCoords =
            typeof rawLat === 'number' &&
            typeof rawLng === 'number' &&
            Number.isFinite(rawLat) &&
            Number.isFinite(rawLng) &&
            (rawLat !== 0 || rawLng !== 0);

        const activeTenant = (rawDoc.tenantId || rawDoc.accountId || this.tenantId).slice(0, 128);

        const asset: StockpileAsset = {
            id: rawDoc.id,
            tenantId: activeTenant,
            accountId: activeTenant,
            name: rawDoc.name || rawDoc.tag || `ACOPIO-${rawDoc.id}`,
            description:
                typeof rawDoc.description === 'string' ? rawDoc.description : undefined,
            clase:
                rawDoc.clase === 'mineral' ||
                rawDoc.clase === 'esteril' ||
                rawDoc.clase === 'baja_ley'
                    ? rawDoc.clase
                    : rawDoc.material === 'mineral' ||
                        rawDoc.material === 'esteril' ||
                        rawDoc.material === 'baja_ley'
                      ? rawDoc.material
                      : null,
            status: rawDoc.status || 'ACTIVE',
            createdAt:
                typeof rawDoc.createdAt === 'number'
                    ? rawDoc.createdAt
                    : typeof rawDoc.timestamp === 'number'
                        ? rawDoc.timestamp
                        : Date.now(),
            createdBy: rawDoc.createdBy || '',
            updatedAt: typeof rawDoc.updatedAt === 'number' ? rawDoc.updatedAt : undefined,
            project_id: rawDoc.project_id ?? null,
            project_name: rawDoc.project_name ?? null,
            geo_point: hasValidCoords
                ? {
                    latitude: rawLat,
                    longitude: rawLng,
                    altitude: rawDoc.geo_point?.altitude ?? null,
                    accuracy:
                        typeof rawDoc.geo_point?.accuracy === 'number'
                            ? rawDoc.geo_point.accuracy
                            : undefined,
                }
                : undefined,
            location_ref: rawDoc.location_ref,
            static_map_url:
                rawDoc.static_map_url && !String(rawDoc.static_map_url).startsWith('data:')
                    ? rawDoc.static_map_url
                    : undefined,
            static_map_sha256: rawDoc.static_map_sha256,
            static_map_original_bytes: rawDoc.static_map_original_bytes,
            static_map_optimized_bytes: rawDoc.static_map_optimized_bytes,
            static_map_savings_pct: rawDoc.static_map_savings_pct,
            initial_photo_url:
                rawDoc.initial_photo_url && !String(rawDoc.initial_photo_url).startsWith('data:')
                    ? rawDoc.initial_photo_url
                    : undefined,
            thumbnail_url:
                rawDoc.thumbnail_url && !String(rawDoc.thumbnail_url).startsWith('data:')
                    ? rawDoc.thumbnail_url
                    : undefined,
            last_volume_m3: rawDoc.last_volume_m3 ?? rawDoc.volumeM3 ?? rawDoc.volumen ?? 0,
            last_weight_t: rawDoc.last_weight_t ?? rawDoc.tonnage ?? rawDoc.peso_final_toneladas ?? 0,
            last_photo_url:
                rawDoc.last_photo_url && !String(rawDoc.last_photo_url).startsWith('data:')
                    ? rawDoc.last_photo_url
                    : rawDoc.initial_photo_url && !String(rawDoc.initial_photo_url).startsWith('data:')
                        ? rawDoc.initial_photo_url
                        : undefined,
            last_measured_at: rawDoc.last_measured_at ?? rawDoc.timestamp,
            last_geometry_type: rawDoc.last_geometry_type ?? rawDoc.geometria ?? rawDoc.shape,
            last_delta_volumen_m3: rawDoc.last_delta_volumen_m3 ?? null,
            last_delta_volumen_pct: rawDoc.last_delta_volumen_pct ?? null,
            closed_at: rawDoc.closed_at ?? null,
            closed_by: rawDoc.closed_by ?? null,
            closure_reason: rawDoc.closure_reason ?? null,
            dispatch_reference: rawDoc.dispatch_reference ?? null,
            shipped_weight_t: rawDoc.shipped_weight_t ?? null,
            pre_closure_volume_m3: rawDoc.pre_closure_volume_m3 ?? null,
            volumen: rawDoc.volumen ?? rawDoc.volumeM3 ?? rawDoc.last_volume_m3 ?? 0,
            volume_m3: rawDoc.volume_m3 ?? rawDoc.volumeM3 ?? rawDoc.last_volume_m3 ?? 0,
            weight_t: rawDoc.weight_t ?? rawDoc.tonnage ?? rawDoc.last_weight_t ?? 0,
            peso_final_toneladas: rawDoc.peso_final_toneladas ?? rawDoc.tonnage ?? rawDoc.last_weight_t ?? 0,
            density_factor: rawDoc.density_factor ?? rawDoc.density,
            tipo_granulometria: rawDoc.tipo_granulometria,
            geometria: rawDoc.geometria || rawDoc.shape,
            peso_romana: rawDoc.peso_romana,
            factor_real: rawDoc.factor_real,
            metadata: rawDoc.metadata,
            training_data: rawDoc.training_data,
            copper_domain: rawDoc.copper_domain,
            moisture_pct: rawDoc.moisture_pct,
            tml_pct: rawDoc.tml_pct,
            wet_weight_thm: rawDoc.wet_weight_thm,
            dry_weight_tms: rawDoc.dry_weight_tms,
            cu_total_pct: rawDoc.cu_total_pct,
            cu_soluble_pct: rawDoc.cu_soluble_pct,
            fine_cu_t: rawDoc.fine_cu_t,
            residence_days: rawDoc.residence_days,
            perimeter_photo_urls: Array.isArray(rawDoc.perimeter_photo_urls)
                ? rawDoc.perimeter_photo_urls
                : undefined,
            cas_original_bytes: rawDoc.cas_original_bytes,
            cas_optimized_bytes: rawDoc.cas_optimized_bytes,
            cas_savings_pct: rawDoc.cas_savings_pct,
            copper_governance_alerts: Array.isArray(rawDoc.copper_governance_alerts)
                ? rawDoc.copper_governance_alerts
                : undefined,
            mesh_url: rawDoc.mesh_url,
            mesh_sha256: rawDoc.mesh_sha256,
            mesh_source: rawDoc.mesh_source,
            tin_volume_m3: rawDoc.tin_volume_m3,
            mesh_original_bytes: rawDoc.mesh_original_bytes,
            mesh_optimized_bytes: rawDoc.mesh_optimized_bytes,
            mesh_savings_pct: rawDoc.mesh_savings_pct,
            p80_mm: rawDoc.p80_mm,
            rosin_rammler: rawDoc.rosin_rammler,
            boulder_detections: Array.isArray(rawDoc.boulder_detections)
                ? rawDoc.boulder_detections
                : undefined,
        };

        const st = this.safeTenant;
        await this.writeMeta(K.asset(st, asset.id), asset);
        await this.addToList(K.assetIds(st), asset.id);

        if (remoteLegacyMeasurements.length > 0) {
            for (const m of remoteLegacyMeasurements) {
                if (m && m.id) {
                    const normalized = this.normalizeMeasurement({
                        ...m,
                        assetId: m.assetId || asset.id,
                        tenantId: activeTenant,
                        accountId: activeTenant,
                    });
                    await this.saveMeasurementLocal(normalized, true);
                }
            }
        }

        return asset;
    }

    // ─── ACTIVOS ───────────────────────────────

    async createAsset(
        asset: Omit<StockpileAsset, 'id' | 'createdAt' | 'createdBy'> & { id?: string }
    ): Promise<string> {
        const id = asset.id || `asset_${Date.now()}`;
        const st = this.safeTenant;
        const activeTenant = (this.tenantId || asset.tenantId || '').slice(0, 128);
        const newAsset: StockpileAsset = {
            ...asset,
            id,
            status: asset.status || 'ACTIVE',
            last_photo_url: asset.last_photo_url || asset.initial_photo_url,
            tenantId: activeTenant,
            accountId: activeTenant,
            createdAt: Date.now(),
            createdBy: this.getUserId(),
        };

        await this.writeMeta(K.asset(st, id), newAsset);
        await this.addToList(K.assetIds(st), id);

        await this.persistAssetToCloudAndQueue(newAsset, []);

        bus.emit(`asset:${id}`, newAsset);
        this.getAllAssetsLocal().then((all) => bus.emit('assets', all));

        return id;
    }

    /**
     * Creación atómica de Acopio + Medición Inicial (Fase 1 GEOLAPP®):
     * Garantiza cero activos huérfanos con 0 m³ antes de medir.
     */
    async createAssetWithInitialMeasurement(params: {
        asset: Omit<StockpileAsset, 'id' | 'createdAt' | 'createdBy'> & { id?: string };
        measurement: Omit<StockpileMeasurement, 'id' | 'assetId'>;
    }): Promise<{ assetId: string; measurementId: string }> {
        const rawMeasPhoto = params.measurement.photo_url || '';
        const rawAssetPhoto = params.asset.initial_photo_url || '';
        if (rawMeasPhoto.startsWith('data:') || rawAssetPhoto.startsWith('data:')) {
            throw new Error(
                'Prohibido persistir cadenas Base64 crudas; utilice CAS Multimedia.'
            );
        }

        const now = Date.now();
        const assetId = params.asset.id || `asset_${now}`;
        const measurementId = `meas_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const st = this.safeTenant;
        const activeTenant = (
            this.tenantId ||
            params.asset.tenantId ||
            params.measurement.tenantId ||
            ''
        ).slice(0, 128);

        const safeVol =
            typeof params.measurement.volumen_m3 === 'number' &&
            Number.isFinite(params.measurement.volumen_m3)
                ? Math.max(0, params.measurement.volumen_m3)
                : 0;
        const safeWeight =
            safeVol <= 0
                ? 0
                : typeof params.measurement.peso_t === 'number' &&
                    Number.isFinite(params.measurement.peso_t)
                  ? Math.max(0, params.measurement.peso_t)
                  : 0;

        const resolvedPhotoUrl = rawMeasPhoto || rawAssetPhoto || '';
        const measTimestamp = params.measurement.timestamp || now;

        const metaLoc = params.measurement.location_metadata;
        const assetGeoPoint =
            params.asset.geo_point ||
            (metaLoc &&
            Number.isFinite(metaLoc.lat) &&
            Number.isFinite(metaLoc.lng) &&
            (metaLoc.lat !== 0 || metaLoc.lng !== 0)
                ? {
                      latitude: metaLoc.lat,
                      longitude: metaLoc.lng,
                      altitude: null,
                      accuracy:
                          typeof metaLoc.accuracy === 'number' ? metaLoc.accuracy : undefined,
                  }
                : undefined);

        const draftM: StockpileMeasurement = {
            ...params.measurement,
            id: measurementId,
            assetId,
            tenantId: activeTenant || undefined,
            accountId: activeTenant || undefined,
            user_id: params.measurement.user_id || this.getUserId() || undefined,
            timestamp: measTimestamp,
            captured_at: params.measurement.captured_at || measTimestamp,
            volumen_m3: safeVol,
            peso_t: safeWeight,
            photo_url: resolvedPhotoUrl,
            previous_measurement_id: null,
            previous_photo_url: null,
            delta_volumen: 0,
            delta_volumen_pct: null,
            delta_peso: 0,
        };

        const chain = computeStockpileMeasurementChain([draftM], resolvedPhotoUrl || undefined);
        const newM = chain.enrichedMeasurements.find((item) => item.id === measurementId) || draftM;

        const resolvedName =
            String(params.asset.name || '').trim() || `STK-${String(now).slice(-6)}`;

        const newAsset: StockpileAsset = {
            ...params.asset,
            id: assetId,
            name: resolvedName,
            clase: params.asset.clase ?? null,
            status: params.asset.status || 'ACTIVE',
            tenantId: activeTenant,
            accountId: activeTenant,
            createdAt: now,
            createdBy: this.getUserId(),
            updatedAt: now,
            ...(assetGeoPoint ? { geo_point: assetGeoPoint } : {}),
            ...(resolvedPhotoUrl
                ? {
                      initial_photo_url: resolvedPhotoUrl,
                      last_photo_url: resolvedPhotoUrl,
                  }
                : {}),
            last_volume_m3: safeVol,
            last_weight_t: safeWeight,
            volumen: safeVol,
            volume_m3: safeVol,
            weight_t: safeWeight,
            peso_final_toneladas: safeWeight,
            last_measured_at: measTimestamp,
            last_geometry_type: newM.geometry?.type ?? params.asset.last_geometry_type,
            geometria: newM.geometry?.type ?? params.asset.geometria,
            density_factor: newM.density_factor ?? params.asset.density_factor,
            last_delta_volumen_m3: 0,
            last_delta_volumen_pct: null,
            cas_original_bytes: newM.cas_original_bytes ?? params.asset.cas_original_bytes,
            cas_optimized_bytes: newM.cas_optimized_bytes ?? params.asset.cas_optimized_bytes,
            cas_savings_pct: newM.cas_savings_pct ?? params.asset.cas_savings_pct,
            uncertainty_pct:
                newM.uncertainty_pct !== undefined
                    ? newM.uncertainty_pct
                    : params.asset.uncertainty_pct,
            toe_score: newM.toe_score !== undefined ? newM.toe_score : params.asset.toe_score,
            coverage_pct:
                newM.coverage_pct !== undefined ? newM.coverage_pct : params.asset.coverage_pct,
            depth_mode: newM.depth_mode !== undefined ? newM.depth_mode : params.asset.depth_mode,
            ground_slope_deg:
                newM.ground_slope_deg !== undefined
                    ? newM.ground_slope_deg
                    : params.asset.ground_slope_deg,
            mesh_url: newM.mesh_url ?? params.asset.mesh_url,
            mesh_sha256: newM.mesh_sha256 ?? params.asset.mesh_sha256,
            mesh_source: newM.mesh_source ?? params.asset.mesh_source,
            tin_volume_m3: newM.tin_volume_m3 ?? params.asset.tin_volume_m3,
            is_non_stockpile: newM.is_non_stockpile ?? params.asset.is_non_stockpile,
            analysis_status: newM.analysis_status ?? params.asset.analysis_status,
            detected_slope_angle_deg:
                newM.detected_slope_angle_deg ?? params.asset.detected_slope_angle_deg,
            slope_warning: newM.slope_warning ?? params.asset.slope_warning,
            scale_anchor_type: newM.scale_anchor_type ?? params.asset.scale_anchor_type,
            wall_confinement: newM.wall_confinement ?? params.asset.wall_confinement,
            gnss_status: newM.gnss_status ?? params.asset.gnss_status,
            underground_sector: newM.underground_sector ?? params.asset.underground_sector,
            captured_at: newM.captured_at ?? params.asset.captured_at,
        };

        await this.writeMeta(K.asset(st, assetId), newAsset);
        await this.addToList(K.assetIds(st), assetId);
        await this.saveMeasurementLocal(newM, false);

        await this.persistAssetToCloudAndQueue(newAsset, [newM]);
        await this.persistMeasurementToCloudAndQueue(newM);

        if (
            assetGeoPoint &&
            Number.isFinite(assetGeoPoint.latitude) &&
            Number.isFinite(assetGeoPoint.longitude) &&
            (assetGeoPoint.latitude !== 0 || assetGeoPoint.longitude !== 0)
        ) {
            void this.ensureStaticSatelliteMap(
                assetId,
                assetGeoPoint.latitude,
                assetGeoPoint.longitude
            ).catch(() => null);
        }

        bus.emit(`asset:${assetId}`, newAsset);
        this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
        bus.emit(`meas:${assetId}`, chain.enrichedMeasurements);
        bus.emit('meas_any', await this.getAllMeasurements());
        bus.emit(`meas_item:${measurementId}`, newM);

        return { assetId, measurementId };
    }

    async getAsset(id: string): Promise<StockpileAsset | null> {
        const st = this.safeTenant;
        const localAsset = await this.readMeta<StockpileAsset>(K.asset(st, id));
        if (localAsset) {
            if (localAsset.tenantId && this.tenantId && localAsset.tenantId !== this.tenantId) {
                console.warn(`[DataService] Bloqueo multi-tenant en getAsset(${id})`);
                return null;
            }
            return localAsset;
        }

        if (firebaseDb && this.isOnline) {
            try {
                const snap = await getDoc(doc(firebaseDb, 'stockpiles', id));
                if (snap.exists()) {
                    const rawData = snap.data();
                    if (!this.matchesActiveTenant(rawData)) {
                        console.warn(`[DataService] Acceso bloqueado a acopio ${id} de otro tenant.`);
                        return null;
                    }
                    const hydrated = await this.hydrateRemoteDocToLocal({ id: snap.id, ...rawData });
                    if (hydrated) {
                        bus.emit(`asset:${id}`, hydrated);
                        return hydrated;
                    }
                }
            } catch (err) {
                console.warn(`[DataService] Fallo consulta remota de activo ${id}:`, err);
            }
        }
        return null;
    }

    async deleteAsset(id: string): Promise<void> {
        const st = this.safeTenant;
        const localAsset = await this.readMeta<StockpileAsset>(K.asset(st, id));
        if (localAsset && localAsset.tenantId && this.tenantId && localAsset.tenantId !== this.tenantId) {
            throw new Error('Operacion denegada: el activo no pertenece a la cuenta activa.');
        }

        if (firebaseDb && this.isOnline) {
            try {
                const remoteSnap = await getDoc(doc(firebaseDb, 'stockpiles', id));
                if (remoteSnap.exists() && !this.matchesActiveTenant(remoteSnap.data())) {
                    throw new Error('Operacion denegada: el documento remoto pertenece a otro tenant.');
                }
            } catch (err) {
                if (err instanceof Error && err.message.startsWith('Operacion denegada')) {
                    throw err;
                }
                console.warn(`[DataService] No se pudo pre-verificar ${id} en Firestore:`, err);
            }
        }

        const ids = await this.readList(K.assetIds(st));
        await this.writeMeta(
            K.assetIds(st),
            ids.filter((item) => item !== id)
        );
        await this.writeMeta(K.asset(st, id), null);

        const localMeas = await this.getMeasurementsLocal(id);
        for (const meas of localMeas) {
            try {
                await offlineStorage.deleteStockpileMeasurement(meas.id);
            } catch {
                // Entorno sin IndexedDB
            }
            await this.writeMeta(`geolapp:${st}:meas:${meas.id}`, null);
        }
        await this.writeMeta(`geolapp:${st}:meas_ids:${id}`, []);

        try {
            await offlineStorage.deleteStockpileSurvey(id);
        } catch {
            // Entorno sin IndexedDB
        }

        if (firebaseDb && this.isOnline) {
            try {
                const subSnap = await getDocs(collection(firebaseDb, 'stockpiles', id, 'measurements'));
                await Promise.all(subSnap.docs.map((d) => deleteDoc(d.ref)));
                await deleteDoc(doc(firebaseDb, 'stockpiles', id));
            } catch (err) {
                console.warn(`[DataService] No se pudo eliminar ${id} en Firestore:`, err);
            }
        }

        this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
    }

    async getMeasurement(id: string): Promise<StockpileMeasurement | null> {
        try {
            const record = await offlineStorage.getStockpileMeasurement(id);
            if (record?.payload) {
                if (record.tenantId && this.tenantId && record.tenantId !== this.tenantId) {
                    return null;
                }
                return record.payload as unknown as StockpileMeasurement;
            }
        } catch {
            // Fallback metadata
        }
        return this.readMeta<StockpileMeasurement>(`geolapp:${this.safeTenant}:meas:${id}`);
    }

    async getStockpileData(id: string): Promise<StockpileAsset | null> {
        return this.getAsset(id);
    }

    private async getAllAssetsLocal(): Promise<StockpileAsset[]> {
        try {
            const st = this.safeTenant;
            const ids = await this.readList(K.assetIds(st));
            if (!Array.isArray(ids)) return [];
            const items = await Promise.all(ids.map((id) => this.readMeta<StockpileAsset>(K.asset(st, id))));
            return items.filter(
                (a): a is StockpileAsset =>
                    a !== null &&
                    typeof a === 'object' &&
                    Boolean(a.id) &&
                    (!a.tenantId || !this.tenantId || a.tenantId === this.tenantId)
            );
        } catch (e) {
            console.error('[DataService] Error al obtener activos locales:', e);
            return [];
        }
    }

    async getAllAssets(): Promise<StockpileAsset[]> {
        const localAssets = await this.getAllAssetsLocal();

        if (firebaseDb && this.isOnline && this.tenantId && !this.isHydratingFromCloud) {
            this.isHydratingFromCloud = true;
            try {
                const q = query(collection(firebaseDb, 'stockpiles'), where('tenantId', '==', this.tenantId));
                const snap = await getDocs(q);
                let updated = false;
                for (const docSnap of snap.docs) {
                    const data = docSnap.data();
                    if (this.matchesActiveTenant(data)) {
                        await this.hydrateRemoteDocToLocal({ id: docSnap.id, ...data });
                        updated = true;
                    }
                }
                if (updated) {
                    const merged = await this.getAllAssetsLocal();
                    bus.emit('assets', merged);
                    return merged;
                }
            } catch (err) {
                console.warn('[DataService] Consulta Firestore en segundo plano omitida:', err);
            } finally {
                this.isHydratingFromCloud = false;
            }
        }

        return localAssets;
    }

    async saveStockpileData(data: Partial<StockpileAsset>, id?: string): Promise<string> {
        const targetId = id ?? data.id;
        if (!targetId) throw new Error('ID requerido en saveStockpileData');
        const st = this.safeTenant;
        const current = (await this.getAsset(targetId)) ?? ({} as StockpileAsset);
        const activeTenant = (this.tenantId || current.tenantId || '').slice(0, 128);
        const updated: StockpileAsset = {
            ...current,
            ...data,
            id: targetId,
            tenantId: activeTenant,
            accountId: activeTenant,
            updatedAt: Date.now(),
        };

        await this.writeMeta(K.asset(st, targetId), updated);
        await this.addToList(K.assetIds(st), targetId);
        await this.persistAssetToCloudAndQueue(updated);

        bus.emit(`asset:${targetId}`, updated);
        this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
        return targetId;
    }

    /**
     * Actualización oficial HITL con confirmación obligatoria por palabra clave `"ACTUALIZAR"`.
     * Online invoca `/api/geolapp/stockpiles/:id/hitl-update` (con registro en AuditLedger);
     * offline actualiza localmente y encola la mutación para sincronización posterior.
     */
    async updateAssetWithHitl(
        assetId: string,
        patch: Partial<StockpileAsset>,
        confirmationKeyword: string,
        diffSummary?: HitlFieldDiff[]
    ): Promise<StockpileAsset> {
        if (!assetId || !assetId.trim()) {
            throw new Error('assetId es obligatorio para ejecutar actualizacion HITL.');
        }
        if (String(confirmationKeyword || '').trim().toUpperCase() !== 'ACTUALIZAR') {
            throw new Error('Confirmacion HITL requerida: escriba exactamente "ACTUALIZAR".');
        }

        const sanitizedPatch = sanitizeHitlPatch(patch);
        const current = await this.getAsset(assetId);
        const activeTenant = (this.tenantId || current?.tenantId || '').slice(0, 128);
        const optimisticUpdated: StockpileAsset = {
            ...(current ?? {
                id: assetId,
                name: typeof sanitizedPatch.name === 'string' ? sanitizedPatch.name : `ACOPIO-${assetId}`,
                clase:
                    sanitizedPatch.clase === 'mineral' ||
                    sanitizedPatch.clase === 'esteril' ||
                    sanitizedPatch.clase === 'baja_ley'
                        ? sanitizedPatch.clase
                        : null,
                createdAt: Date.now(),
                createdBy: this.getUserId(),
            }),
            ...(sanitizedPatch as Partial<StockpileAsset>),
            id: assetId,
            tenantId: activeTenant || undefined,
            accountId: activeTenant || undefined,
            updatedAt: Date.now(),
        };

        const st = this.safeTenant;
        if (this.isOnline && activeTenant) {
            try {
                const res = await coreAuthFetch(
                    `/api/geolapp/stockpiles/${encodeURIComponent(assetId)}/hitl-update`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Active-Account-Id': activeTenant,
                        },
                        body: JSON.stringify({
                            confirmationKeyword: 'ACTUALIZAR',
                            patch: sanitizedPatch,
                            ...(diffSummary && diffSummary.length > 0 ? { diffSummary } : {}),
                        }),
                    }
                );

                if (res.ok) {
                    const json = (await res.json().catch(() => ({}))) as { asset?: StockpileAsset };
                    const serverAsset: StockpileAsset = json.asset
                        ? { ...optimisticUpdated, ...json.asset, id: assetId }
                        : optimisticUpdated;

                    await this.writeMeta(K.asset(st, assetId), serverAsset);
                    await this.addToList(K.assetIds(st), assetId);
                    bus.emit(`asset:${assetId}`, serverAsset);
                    this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
                    return serverAsset;
                }

                if (res.status >= 400 && res.status < 500) {
                    const errPayload = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(
                        errPayload.error || `Error HITL HTTP ${res.status} actualizando ${assetId}`
                    );
                }
            } catch (err) {
                if (err instanceof Error && err.message.startsWith('Error HITL')) {
                    throw err;
                }
                if (err instanceof Error && err.message.includes('ACTUALIZAR')) {
                    throw err;
                }
                console.warn('[DataService] Actualizacion HITL diferida a cola offline:', err);
            }
        }

        await this.writeMeta(K.asset(st, assetId), optimisticUpdated);
        await this.addToList(K.assetIds(st), assetId);

        if (activeTenant) {
            try {
                await syncQueueEngine.enqueueApiMutation(
                    `/api/geolapp/stockpiles/${encodeURIComponent(assetId)}/hitl-update`,
                    {
                        confirmationKeyword: 'ACTUALIZAR',
                        patch: sanitizedPatch,
                        ...(diffSummary && diffSummary.length > 0 ? { diffSummary } : {}),
                    },
                    'GEOLAPP_HITL_UPDATE',
                    activeTenant,
                    'POST'
                );
            } catch (queueErr) {
                console.warn('[DataService] No se pudo encolar mutacion HITL offline:', queueErr);
            }
        }

        bus.emit(`asset:${assetId}`, optimisticUpdated);
        this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
        return optimisticUpdated;
    }

    // ─── MEDICIONES (SUBCOLECCIÓN + LEGACY HYDRATION) ─────────

    private attemptedStaticMapKeys = new Set<string>();

    private async persistChainMeasurementUpdates(
        beforeList: StockpileMeasurement[],
        afterList: StockpileMeasurement[]
    ): Promise<void> {
        const prevMap = new Map(beforeList.map((m) => [m.id, m]));
        for (const item of afterList) {
            const old = prevMap.get(item.id);
            if (!old) continue;
            const changed =
                old.previous_measurement_id !== item.previous_measurement_id ||
                old.previous_photo_url !== item.previous_photo_url ||
                old.delta_volumen !== item.delta_volumen ||
                old.delta_volumen_pct !== item.delta_volumen_pct ||
                old.delta_peso !== item.delta_peso;
            if (changed) {
                await this.saveMeasurementLocal(item, false);
                await this.persistMeasurementToCloudAndQueue(item);
            }
        }
    }

    async addMeasurement(
        measurement: Omit<StockpileMeasurement, 'id'> & { ai_confidence?: number }
    ): Promise<string> {
        if (!measurement.assetId || measurement.assetId === 'NEW_ASSET') {
            throw new Error('assetId valido requerido para registrar una medicion.');
        }
        if (measurement.photo_url && measurement.photo_url.startsWith('data:')) {
            throw new Error(
                'Prohibido persistir cadenas Base64 crudas en photo_url; utilice CAS Multimedia.'
            );
        }

        const asset = await this.getAsset(measurement.assetId);
        if (asset?.status === 'CLOSED') {
            throw new Error(
                'CYCLE_CLOSED: El historial de este acopio esta cerrado; ejecute reapertura HITL ("ACTUALIZAR") antes de registrar nuevas mediciones.'
            );
        }

        const activeTenant = (this.tenantId || measurement.tenantId || '').slice(0, 128);
        const now = Date.now();
        const id = `meas_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const existingMeasurements = await this.getMeasurementsLocal(measurement.assetId);
        const safeVol =
            typeof measurement.volumen_m3 === 'number' && Number.isFinite(measurement.volumen_m3)
                ? Math.max(0, measurement.volumen_m3)
                : 0;
        const safeWeight =
            safeVol <= 0
                ? 0
                : typeof measurement.peso_t === 'number' && Number.isFinite(measurement.peso_t)
                    ? Math.max(0, measurement.peso_t)
                    : 0;

        const isPendingAi =
            measurement.analysis_status === 'PENDING_AI_SYNC' ||
            measurement.analysis_status === 'PENDING_SCALE';
        const isZeroClosure = safeVol <= 0 && !isPendingAi;
        const draftM: StockpileMeasurement = {
            ...measurement,
            volumen_m3: safeVol,
            peso_t: safeWeight,
            id,
            captured_at: measurement.captured_at || measurement.timestamp || now,
            tenantId: activeTenant || undefined,
            accountId: activeTenant || undefined,
            user_id: measurement.user_id || this.getUserId() || undefined,
            ...(isZeroClosure
                ? {
                    is_closure_measurement: true,
                    closure_reason: measurement.closure_reason || 'ZERO_VOLUME',
                    wet_weight_thm: 0,
                    dry_weight_tms: 0,
                    fine_cu_t: 0,
                }
                : {}),
        };

        const chain = computeStockpileMeasurementChain(
            [...existingMeasurements, draftM],
            asset?.initial_photo_url
        );
        const newM = chain.enrichedMeasurements.find((item) => item.id === id) || draftM;

        const allAssetMeasurements = chain.enrichedMeasurements;

        if (asset) {
            const st = this.safeTenant;
            const prevActiveVol =
                chain.summary.previousActive?.volumen_m3 ?? asset.last_volume_m3 ?? 0;
            const closureReason: StockpileClosureReason | null = isZeroClosure
                ? newM.closure_reason || 'ZERO_VOLUME'
                : asset.closure_reason ?? null;

            const updated: StockpileAsset = {
                ...asset,
                tenantId: activeTenant || asset.tenantId,
                accountId: activeTenant || asset.accountId,
                status: isZeroClosure ? 'CLOSED' : asset.status || 'ACTIVE',
                last_volume_m3: isZeroClosure
                    ? 0
                    : isPendingAi
                      ? asset.last_volume_m3
                      : newM.volumen_m3,
                last_weight_t: isZeroClosure
                    ? 0
                    : isPendingAi
                      ? asset.last_weight_t
                      : newM.peso_t,
                last_photo_url: chain.summary.lastPhotoUrl || asset.last_photo_url || asset.initial_photo_url,
                last_measured_at: newM.timestamp,
                last_geometry_type: newM.geometry?.type ?? asset.last_geometry_type,
                last_delta_volumen_m3: newM.delta_volumen ?? null,
                last_delta_volumen_pct: newM.delta_volumen_pct ?? null,
                volumen: isZeroClosure ? 0 : isPendingAi ? asset.volumen : newM.volumen_m3,
                volume_m3: isZeroClosure ? 0 : isPendingAi ? asset.volume_m3 : newM.volumen_m3,
                weight_t: isZeroClosure ? 0 : isPendingAi ? asset.weight_t : newM.peso_t,
                peso_final_toneladas: isZeroClosure
                    ? 0
                    : isPendingAi
                      ? asset.peso_final_toneladas
                      : newM.peso_t,
                analysis_status: newM.analysis_status ?? asset.analysis_status,
                detected_slope_angle_deg:
                    newM.detected_slope_angle_deg ?? asset.detected_slope_angle_deg,
                slope_warning: newM.slope_warning ?? asset.slope_warning,
                scale_anchor_type: newM.scale_anchor_type ?? asset.scale_anchor_type,
                wall_confinement: newM.wall_confinement ?? asset.wall_confinement,
                density_factor: newM.density_factor ?? asset.density_factor,
                geometria: newM.geometry?.type ?? asset.geometria,
                copper_domain: newM.copper_domain ?? asset.copper_domain,
                uncertainty_pct:
                    newM.uncertainty_pct !== undefined
                        ? newM.uncertainty_pct
                        : asset.uncertainty_pct,
                toe_score: newM.toe_score !== undefined ? newM.toe_score : asset.toe_score,
                coverage_pct:
                    newM.coverage_pct !== undefined ? newM.coverage_pct : asset.coverage_pct,
                depth_mode: newM.depth_mode !== undefined ? newM.depth_mode : asset.depth_mode,
                ground_slope_deg:
                    newM.ground_slope_deg !== undefined
                        ? newM.ground_slope_deg
                        : asset.ground_slope_deg,
                mesh_url: newM.mesh_url ?? asset.mesh_url,
                mesh_sha256: newM.mesh_sha256 ?? asset.mesh_sha256,
                mesh_source: newM.mesh_source ?? asset.mesh_source,
                tin_volume_m3: newM.tin_volume_m3 ?? asset.tin_volume_m3,
                is_non_stockpile: newM.is_non_stockpile ?? asset.is_non_stockpile,
                moisture_pct:
                    newM.moisture_pct !== undefined ? newM.moisture_pct : asset.moisture_pct,
                tml_pct: newM.tml_pct !== undefined ? newM.tml_pct : asset.tml_pct,
                wet_weight_thm: isZeroClosure
                    ? 0
                    : newM.wet_weight_thm !== undefined
                        ? newM.wet_weight_thm
                        : asset.wet_weight_thm,
                dry_weight_tms: isZeroClosure
                    ? 0
                    : newM.dry_weight_tms !== undefined
                        ? newM.dry_weight_tms
                        : asset.dry_weight_tms,
                fine_cu_t: isZeroClosure
                    ? 0
                    : newM.fine_cu_t !== undefined
                        ? newM.fine_cu_t
                        : asset.fine_cu_t,
                residence_days:
                    newM.residence_days !== undefined ? newM.residence_days : asset.residence_days,
                copper_governance_alerts:
                    newM.copper_governance_alerts ?? asset.copper_governance_alerts,
                cas_original_bytes: newM.cas_original_bytes ?? asset.cas_original_bytes,
                cas_optimized_bytes: newM.cas_optimized_bytes ?? asset.cas_optimized_bytes,
                cas_savings_pct: newM.cas_savings_pct ?? asset.cas_savings_pct,
                ...(isZeroClosure
                    ? {
                        closed_at: newM.timestamp,
                        closed_by: newM.user_id || this.getUserId() || 'field-operator',
                        closure_reason: closureReason,
                        pre_closure_volume_m3: prevActiveVol,
                        ...(newM.dispatch_reference
                            ? { dispatch_reference: newM.dispatch_reference }
                            : {}),
                    }
                    : {}),
            };
            await this.writeMeta(K.asset(st, measurement.assetId), updated);
            // Padre en Firestore debe existir/actualizarse antes que subcolección measurements
            await this.persistAssetToCloudAndQueue(updated, allAssetMeasurements);
            await this.saveMeasurementLocal(newM, false);
            await this.persistMeasurementToCloudAndQueue(newM);
            await this.persistChainMeasurementUpdates(
                existingMeasurements,
                chain.enrichedMeasurements
            );
            bus.emit(`asset:${measurement.assetId}`, updated);
            this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
        } else {
            await this.saveMeasurementLocal(newM, false);
            await this.persistMeasurementToCloudAndQueue(newM);
            await this.persistChainMeasurementUpdates(
                existingMeasurements,
                chain.enrichedMeasurements
            );
        }

        bus.emit(`meas:${measurement.assetId}`, allAssetMeasurements);
        bus.emit('meas_any', await this.getAllMeasurements());
        bus.emit(`meas_item:${id}`, newM);

        return id;
    }

    async getAllMeasurements(): Promise<StockpileMeasurement[]> {
        try {
            const fromStore = await offlineStorage
                .getAllStockpileMeasurements(this.tenantId || undefined)
                .catch(() => []);
            const byId = new Map<string, StockpileMeasurement>();
            for (const rec of fromStore) {
                if (rec?.payload) {
                    const m = rec.payload as unknown as StockpileMeasurement;
                    if (m?.id && m?.timestamp) byId.set(m.id, m);
                }
            }

            const assetIds = await this.readList(K.assetIds(this.safeTenant));
            for (const aId of assetIds) {
                const localPerAsset = await this.getMeasurementsLocal(aId);
                for (const m of localPerAsset) {
                    if (m?.id && m?.timestamp && !byId.has(m.id)) {
                        byId.set(m.id, m);
                    }
                }
            }

            return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error('[DataService] Error al obtener mediciones:', e);
            return [];
        }
    }

    private async getMeasurementsLocal(assetId: string): Promise<StockpileMeasurement[]> {
        try {
            const byId = new Map<string, StockpileMeasurement>();
            const storeRecords = await offlineStorage
                .getStockpileMeasurementsByAsset(assetId, this.tenantId || undefined)
                .catch(() => []);
            for (const rec of storeRecords) {
                if (rec?.payload) {
                    const m = rec.payload as unknown as StockpileMeasurement;
                    if (m?.id && m?.timestamp) byId.set(m.id, m);
                }
            }

            const st = this.safeTenant;
            const ids = await this.readList(`geolapp:${st}:meas_ids:${assetId}`);
            if (ids.length > 0) {
                const items = await Promise.all(
                    ids.map((id) => this.readMeta<StockpileMeasurement>(`geolapp:${st}:meas:${id}`))
                );
                for (const m of items) {
                    if (m && typeof m === 'object' && m.id && m.timestamp && !byId.has(m.id)) {
                        byId.set(m.id, m);
                    }
                }
            }

            const rawList = Array.from(byId.values());
            const asset = await this.readMeta<StockpileAsset>(K.asset(st, assetId));
            return computeStockpileMeasurementChain(rawList, asset?.initial_photo_url).enrichedMeasurements;
        } catch (e) {
            console.error(`[DataService] Error al obtener mediciones para ${assetId}:`, e);
            return [];
        }
    }

    async getMeasurements(assetId: string): Promise<StockpileMeasurement[]> {
        if (firebaseDb && this.isOnline && this.tenantId && assetId) {
            try {
                const subSnap = await getDocs(
                    collection(firebaseDb, 'stockpiles', assetId, 'measurements')
                );
                for (const d of subSnap.docs) {
                    const raw = d.data() as Record<string, any>;
                    if (raw.tenantId && raw.tenantId !== this.tenantId) continue;
                    const normalized = this.normalizeMeasurement({
                        ...(raw as StockpileMeasurement),
                        id: d.id,
                        assetId,
                        tenantId: this.tenantId,
                        accountId: this.tenantId,
                    });
                    await this.saveMeasurementLocal(normalized, true);
                }
            } catch (err) {
                console.warn(
                    `[DataService] Lectura subcoleccion measurements(${assetId}) diferida a cache local:`,
                    err
                );
            }
        }
        return this.getMeasurementsLocal(assetId);
    }

    async toggleIgnoreMeasurement(
        measurementId: string,
        assetId: string,
        currentIgnoredStatus: boolean
    ): Promise<void> {
        const newStatus = !currentIgnoredStatus;
        const m = await this.getMeasurement(measurementId);
        if (m) {
            const updatedMeas: StockpileMeasurement = { ...m, ignored: newStatus };
            await this.saveMeasurementLocal(updatedMeas, false);
            await this.persistMeasurementToCloudAndQueue(updatedMeas);
        }

        const asset = await this.getAsset(assetId);
        const beforeList = await this.getMeasurementsLocal(assetId);
        const patchedBefore = beforeList.map((item) =>
            item.id === measurementId ? { ...item, ignored: newStatus } : item
        );
        const chain = computeStockpileMeasurementChain(patchedBefore, asset?.initial_photo_url);
        await this.persistChainMeasurementUpdates(patchedBefore, chain.enrichedMeasurements);

        const valid = chain.summary.latestActive;
        await this.saveStockpileData(
            valid
                ? {
                    last_volume_m3: valid.volumen_m3,
                    last_weight_t: valid.peso_t,
                    last_photo_url: chain.summary.lastPhotoUrl || asset?.initial_photo_url,
                    last_measured_at: valid.timestamp,
                    last_delta_volumen_m3: chain.summary.lastDeltaVolumenM3,
                    last_delta_volumen_pct: chain.summary.lastDeltaVolumenPct,
                    volumen: valid.volumen_m3,
                    volume_m3: valid.volumen_m3,
                    weight_t: valid.peso_t,
                    peso_final_toneladas: valid.peso_t,
                    density_factor: valid.density_factor,
                }
                : {
                    last_volume_m3: 0,
                    last_weight_t: 0,
                    last_photo_url: asset?.initial_photo_url,
                    last_delta_volumen_m3: null,
                    last_delta_volumen_pct: null,
                    volumen: 0,
                    volume_m3: 0,
                    weight_t: 0,
                    peso_final_toneladas: 0,
                },
            assetId
        );

        bus.emit(`meas:${assetId}`, chain.enrichedMeasurements);
        bus.emit('meas_any', await this.getAllMeasurements());
    }

    // ─── PERFILES DE MATERIAL ─────────────────

    async getMaterialProfiles(): Promise<Record<string, number>> {
        return (
            (await this.readMeta<Record<string, number>>(K.profiles(this.safeTenant))) ?? {
                COLPAS: 1.6,
                GRANSA: 1.8,
                MIXTO: 1.7,
                FINOS: 1.5,
            }
        );
    }

    async saveMaterialProfiles(profiles: Record<string, number>): Promise<void> {
        await this.writeMeta(K.profiles(this.safeTenant), profiles);
    }

    // ─── FAENAS MINERAS / PROJECT_PROFILES (CON CACHÉ OFFLINE + TEMPO REAL) ───

    async getMiningSites(): Promise<MiningSiteProfile[]> {
        const stored = (await this.readMeta<MiningSiteProfile[]>(K.sites(this.safeTenant))) ?? [];
        const byId = new Map<string, MiningSiteProfile>();
        for (const site of stored) {
            if (site?.id && site.name) byId.set(site.id, site);
        }

        const assets = await this.getAllAssetsLocal();
        const activeTenant = this.tenantId || '';
        for (const asset of assets) {
            if (asset.project_id && asset.project_name && !byId.has(asset.project_id)) {
                byId.set(asset.project_id, {
                    id: asset.project_id,
                    tenantId: asset.tenantId || activeTenant,
                    accountId: asset.accountId || activeTenant,
                    name: asset.project_name,
                    status: 'ACTIVE',
                    source: 'MINREPORT_PROJECTS_MODULE',
                    createdAt: asset.createdAt || Date.now(),
                    createdBy: asset.createdBy || '',
                    updatedAt: asset.updatedAt || asset.createdAt || Date.now(),
                });
            }
        }

        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    subscribeToMiningSites(cb: (sites: MiningSiteProfile[]) => void): Unsubscribe {
        this.ensureTenantSitesSnapshot();
        this.getMiningSites().then(cb);
        const busUnsub = bus.on('sites', cb);
        return () => {
            busUnsub();
            if (!bus.hasSubscribers('sites') && this.tenantSitesSnapshotUnsub) {
                this.tenantSitesSnapshotUnsub();
                this.tenantSitesSnapshotUnsub = null;
            }
        };
    }

    async registerDevMiningSite(input: { name: string; code?: string }): Promise<MiningSiteProfile> {
        const cleanName = String(input.name || '').trim().slice(0, 180);
        if (!cleanName) {
            throw new Error('El nombre de la faena minera es obligatorio.');
        }

        const existingList = await this.getMiningSites();
        const normalizedTarget = cleanName.toLowerCase();
        const existingMatch = existingList.find(
            (s) => s.name.trim().toLowerCase() === normalizedTarget
        );
        if (existingMatch) {
            return existingMatch;
        }

        const now = Date.now();
        const slug = cleanName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 32);
        const siteId = `faena_${slug || 'site'}_${String(now).slice(-6)}`;
        const activeTenant = (this.tenantId || '').slice(0, 128);
        const site: MiningSiteProfile = {
            id: siteId,
            tenantId: activeTenant,
            accountId: activeTenant,
            name: cleanName,
            ...(input.code?.trim() ? { code: input.code.trim().slice(0, 40) } : {}),
            status: 'ACTIVE',
            source: 'DEV_MANUAL_REGISTRY',
            createdAt: now,
            createdBy: this.getUserId() || 'dev-root',
            updatedAt: now,
        };

        const stored = (await this.readMeta<MiningSiteProfile[]>(K.sites(this.safeTenant))) ?? [];
        const nextStored = [...stored.filter((s) => s.id !== site.id), site];
        await this.writeMeta(K.sites(this.safeTenant), nextStored);

        const taskId = `sync_site_${this.safeTenant}_${site.id}`;
        if (activeTenant) {
            const payload = sanitizeForFirestore(site);
            await syncQueueEngine
                .enqueueTask('MINING_SITE_PROFILE', payload, taskId)
                .catch(() => {});

            if (firebaseDb && this.isOnline) {
                try {
                    await setDoc(doc(firebaseDb, 'project_profiles', site.id), payload, {
                        merge: true,
                    });
                    await offlineStorage.deleteSyncTask(taskId).catch(() => {});
                    await syncQueueEngine.refreshPendingCount().catch(() => {});
                } catch (err) {
                    console.warn('[DataService] Registro de faena diferido a cola offline:', err);
                }
            }
        }

        const updatedAll = await this.getMiningSites();
        bus.emit('sites', updatedAll);
        return site;
    }

    // ─── SUBSCRIPCIONES REACTIVAS (onSnapshot + CLEANUP) ───

    subscribeToAsset(id: string, cb: (data: StockpileAsset | null) => void): Unsubscribe {
        this.ensureTenantAssetsSnapshot();
        this.getAsset(id).then(cb);
        const busUnsub = bus.on(`asset:${id}`, cb);
        return () => {
            busUnsub();
        };
    }

    subscribeToAllAssets(cb: (data: StockpileAsset[]) => void): Unsubscribe {
        this.ensureTenantAssetsSnapshot();
        this.getAllAssets().then(cb);
        const busUnsub = bus.on('assets', cb);
        return () => {
            busUnsub();
            if (!bus.hasSubscribers('assets') && this.tenantAssetsSnapshotUnsub) {
                this.tenantAssetsSnapshotUnsub();
                this.tenantAssetsSnapshotUnsub = null;
            }
        };
    }

    subscribeToMeasurements(
        assetId: string,
        cb: (data: StockpileMeasurement[]) => void
    ): Unsubscribe {
        const snapshotUnsub = this.acquireMeasurementSnapshot(assetId);
        this.getMeasurements(assetId).then(cb);
        const busUnsub = bus.on(`meas:${assetId}`, cb);
        return () => {
            busUnsub();
            snapshotUnsub();
        };
    }

    subscribeToMeasurementsAll(cb: (data: StockpileMeasurement[]) => void): Unsubscribe {
        this.getAllMeasurements().then(cb);
        return bus.on('meas_any', cb);
    }

    subscribeToMeasurement(id: string, cb: (data: StockpileMeasurement | null) => void): Unsubscribe {
        this.getMeasurement(id).then(cb);
        return bus.on(`meas_item:${id}`, cb);
    }

    // ─── CICLO DE VIDA NEXT-GEN (CIERRE POR EMBARQUE / REAPERTURA HITL / MAPA ESTÁTICO) ───

    async closeAssetByShipment(
        assetId: string,
        params: ShipmentClosureInput
    ): Promise<StockpileAsset> {
        const dispatchRef = String(params.dispatchReference || '').trim();
        if (!dispatchRef) {
            throw new Error('La referencia de embarque o lote es obligatoria.');
        }
        if (String(params.confirmationKeyword || '').trim().toUpperCase() !== 'ACTUALIZAR') {
            throw new Error('Confirmacion HITL requerida: escriba exactamente "ACTUALIZAR".');
        }

        const asset = await this.getAsset(assetId);
        if (!asset) {
            throw new Error(`Acopio ${assetId} no encontrado.`);
        }
        if (asset.status === 'CLOSED') {
            throw new Error('CYCLE_ALREADY_CLOSED: El historial del acopio ya se encuentra cerrado.');
        }

        const gov = calculationEngine.evaluateCopperGovernance({
            copperDomain: asset.copper_domain,
            residenceDays: asset.residence_days,
            moisturePct: asset.moisture_pct,
            tmlLimitPct: asset.tml_pct,
        });
        if (gov.hasCriticalBlock) {
            throw new Error(
                gov.alerts.find((a) => a.severity === 'BLOCK')?.message ||
                'IMSBC_TML_BLOCK: Humedad >= TML bloquea embarque de concentrado.'
            );
        }

        const existingMeas = await this.getMeasurementsLocal(assetId);
        const now = Date.now();
        const activeTenant = (this.tenantId || asset.tenantId || '').slice(0, 128);
        const actor = this.getUserId() || 'operator';
        const prevVol =
            typeof asset.last_volume_m3 === 'number' && Number.isFinite(asset.last_volume_m3)
                ? asset.last_volume_m3
                : 0;
        const cleanPhoto =
            params.photoUrl && !params.photoUrl.startsWith('data:')
                ? params.photoUrl
                : asset.last_photo_url || asset.initial_photo_url || '';

        const closureMeasId = `meas_${now}`;
        const draftClosureMeas: StockpileMeasurement = {
            id: closureMeasId,
            assetId,
            tenantId: activeTenant || undefined,
            accountId: activeTenant || undefined,
            timestamp: now,
            volumen_m3: 0,
            peso_t: 0,
            photo_url: cleanPhoto,
            method: 'manual',
            user_id: actor,
            is_closure_measurement: true,
            closure_reason: 'SHIPPED',
            dispatch_reference: dispatchRef,
            wet_weight_thm: 0,
            dry_weight_tms: 0,
            fine_cu_t: 0,
        };

        const chain = computeStockpileMeasurementChain(
            [...existingMeas, draftClosureMeas],
            asset.initial_photo_url
        );
        const enrichedClosureMeas =
            chain.enrichedMeasurements.find((item) => item.id === closureMeasId) || draftClosureMeas;

        const diffs: HitlFieldDiff[] = [
            {
                field: 'status',
                current: String(asset.status || 'ACTIVE'),
                suggested: 'CLOSED (SHIPPED)',
            },
            {
                field: 'dispatch_reference',
                current: String(asset.dispatch_reference || '--'),
                suggested: dispatchRef,
            },
            {
                field: 'last_volume_m3',
                current: `${prevVol.toFixed(2)} m³`,
                suggested: '0.00 m³',
            },
        ];

        const updatedAsset = await this.updateAssetWithHitl(
            assetId,
            {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                closed_at: now,
                closed_by: actor,
                dispatch_reference: dispatchRef,
                shipped_weight_t:
                    typeof params.shippedWeightT === 'number' &&
                        Number.isFinite(params.shippedWeightT) &&
                        params.shippedWeightT >= 0
                        ? params.shippedWeightT
                        : null,
                pre_closure_volume_m3: prevVol,
                last_volume_m3: 0,
                last_weight_t: 0,
                wet_weight_thm: 0,
                dry_weight_tms: 0,
                fine_cu_t: 0,
                volumen: 0,
                volume_m3: 0,
                weight_t: 0,
                peso_final_toneladas: 0,
                last_measured_at: now,
                last_delta_volumen_m3: enrichedClosureMeas.delta_volumen ?? (prevVol > 0 ? -prevVol : 0),
                last_delta_volumen_pct:
                    enrichedClosureMeas.delta_volumen_pct ?? (prevVol > 0 ? -100 : null),
                ...(cleanPhoto ? { last_photo_url: cleanPhoto } : {}),
            },
            confirmationKeywordTrimmed(params.confirmationKeyword),
            diffs
        );

        await this.saveMeasurementLocal(enrichedClosureMeas, false);
        await this.persistMeasurementToCloudAndQueue(enrichedClosureMeas);
        bus.emit(`meas:${assetId}`, chain.enrichedMeasurements);
        bus.emit('meas_any', await this.getAllMeasurements());
        bus.emit(`meas_item:${closureMeasId}`, enrichedClosureMeas);

        return updatedAsset;
    }

    async reopenClosedAssetWithHitl(
        assetId: string,
        confirmationKeyword: string,
        reasonNote?: string
    ): Promise<StockpileAsset> {
        const asset = await this.getAsset(assetId);
        if (!asset) {
            throw new Error(`Acopio ${assetId} no encontrado.`);
        }
        const diffs: HitlFieldDiff[] = [
            {
                field: 'status',
                current: String(asset.status || 'CLOSED'),
                suggested: 'ACTIVE',
            },
            ...(reasonNote && reasonNote.trim()
                ? [{ field: 'reopen_note', current: '--', suggested: reasonNote.trim() }]
                : []),
        ];
        return this.updateAssetWithHitl(
            assetId,
            {
                status: 'ACTIVE',
                closed_at: null,
                closed_by: null,
                closure_reason: null,
            },
            confirmationKeywordTrimmed(confirmationKeyword),
            diffs
        );
    }

    async ensureStaticSatelliteMap(
        assetId: string,
        lat: number,
        lng: number,
        options?: { forceRefresh?: boolean }
    ): Promise<string | null> {
        if (
            !assetId ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            (lat === 0 && lng === 0)
        ) {
            return null;
        }
        const existing = await this.getAsset(assetId);
        if (
            !options?.forceRefresh &&
            existing?.static_map_url &&
            !existing.static_map_url.startsWith('data:')
        ) {
            return existing.static_map_url;
        }

        const dedupKey = `${this.safeTenant}:${assetId}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
        if (
            (!options?.forceRefresh && this.attemptedStaticMapKeys.has(dedupKey)) ||
            !this.isOnline ||
            !this.tenantId
        ) {
            return existing?.static_map_url || null;
        }

        try {
            const resp = await coreAuthFetch(
                `/api/geolapp/stockpiles/${encodeURIComponent(assetId)}/static-map`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Active-Account-Id': this.tenantId,
                    },
                    body: JSON.stringify({ latitude: lat, longitude: lng }),
                }
            );
            if (!resp.ok) {
                if (resp.status === 400 || resp.status === 404) {
                    this.attemptedStaticMapKeys.add(dedupKey);
                }
                return existing?.static_map_url || null;
            }
            const json = (await resp.json().catch(() => null)) as {
                available?: boolean;
                staticMapUrl?: string;
                sha256?: string;
                originalBytes?: number;
                optimizedBytes?: number;
                savingsPct?: number;
            } | null;

            if (
                json?.available &&
                typeof json.staticMapUrl === 'string' &&
                json.staticMapUrl.trim().length > 0 &&
                !json.staticMapUrl.startsWith('data:')
            ) {
                this.attemptedStaticMapKeys.add(dedupKey);
                if (existing) {
                    const st = this.safeTenant;
                    const updated: StockpileAsset = {
                        ...existing,
                        static_map_url: json.staticMapUrl,
                        static_map_sha256: json.sha256 ?? existing.static_map_sha256,
                        static_map_original_bytes:
                            json.originalBytes ?? existing.static_map_original_bytes,
                        static_map_optimized_bytes:
                            json.optimizedBytes ?? existing.static_map_optimized_bytes,
                        static_map_savings_pct:
                            json.savingsPct ?? existing.static_map_savings_pct,
                        updatedAt: Date.now(),
                    };
                    await this.writeMeta(K.asset(st, assetId), updated);
                    bus.emit(`asset:${assetId}`, updated);
                    this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
                }
                return json.staticMapUrl;
            }
            return existing?.static_map_url || null;
        } catch {
            return existing?.static_map_url || null;
        }
    }

    // ─── SINCRONIZACIÓN CON CLOUD FIRESTORE & SYNC QUEUE ───

    async syncWithMinReport(): Promise<void> {
        await syncQueueEngine.triggerReconnectSync();
        const allAssets = await this.getAllAssets();
        const allMeas = await this.getAllMeasurements();
        const allSites = await this.getMiningSites();
        bus.emit('assets', allAssets);
        bus.emit('meas_any', allMeas);
        bus.emit('sites', allSites);
    }
}

function confirmationKeywordTrimmed(raw: string): string {
    return String(raw || '').trim().toUpperCase();
}

export const dataService = new DataService();
