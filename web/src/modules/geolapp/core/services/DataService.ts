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
    EstructuralHidroPayload,
    ExploracionSondajePayload,
    GeolappDomainPayload,
    GeolappDomainRecord,
    GeolappDomainRecordStatus,
    GeolappDomainUtmFix,
    GeolappNonStockpileDomainMode,
    GeomensuraSurveyPayload,
    HitlFieldDiff,
    StockpileAsset,
    StockpileMeasurement,
} from '../types/GeolappTypes';
import { storageService } from './StorageService';

export type StockpileData = StockpileAsset;
export type Unsubscribe = () => void;

export interface GeolappDomainRecordInput {
    id?: string;
    tenantId?: string;
    accountId?: string;
    domainMode: GeolappNonStockpileDomainMode;
    code: string;
    title: string;
    status?: GeolappDomainRecordStatus;
    utmFix?: GeolappDomainUtmFix;
    payload: GeolappDomainPayload;
    notes?: string;
    createdAt?: number;
    updatedAt?: number;
    createdBy?: string;
    updatedBy?: string;
    synced?: boolean;
}

export interface GeolappDomainRecordHitlPatch {
    code?: string;
    title?: string;
    status?: GeolappDomainRecordStatus;
    utmFix?: GeolappDomainUtmFix;
    notes?: string;
    payload?:
        | Partial<GeomensuraSurveyPayload>
        | Partial<ExploracionSondajePayload>
        | Partial<EstructuralHidroPayload>;
}

export interface TenantContextInput {
    tenantId?: string;
    userId?: string;
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
    domainRecords: (safeTenant: string) => `geolapp:${safeTenant}:domain_records`,
} as const;

const DOMAIN_DATA_URI_REGEX = /^\s*data:/i;
const DOMAIN_EMBEDDED_BASE64_REGEX = /data:[a-z0-9.+\/-]*;base64,/i;

function containsDataBase64Url(value: unknown, depth = 0): boolean {
    if (depth > 16 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
        return DOMAIN_DATA_URI_REGEX.test(value) || DOMAIN_EMBEDDED_BASE64_REGEX.test(value);
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            if (containsDataBase64Url(item, depth + 1)) return true;
        }
        return false;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>)) {
            if (containsDataBase64Url(v, depth + 1)) return true;
        }
    }
    return false;
}

function buildTypedDomainRecord(
    common: {
        id: string;
        tenantId: string;
        accountId: string;
        code: string;
        title: string;
        status: GeolappDomainRecordStatus;
        utmFix?: GeolappDomainUtmFix;
        notes?: string;
        createdAt: number;
        updatedAt: number;
        createdBy: string;
        updatedBy?: string;
        synced?: boolean;
    },
    domainMode: GeolappNonStockpileDomainMode,
    payload: GeolappDomainPayload
): GeolappDomainRecord {
    switch (domainMode) {
        case 'GEOMENSURA_GEO':
            return {
                ...common,
                domainMode: 'GEOMENSURA_GEO',
                payload: payload as GeomensuraSurveyPayload,
            };
        case 'EXPLORACION_SONDAJES':
            return {
                ...common,
                domainMode: 'EXPLORACION_SONDAJES',
                payload: payload as ExploracionSondajePayload,
            };
        case 'ESTRUCTURAL_HIDRO':
            return {
                ...common,
                domainMode: 'ESTRUCTURAL_HIDRO',
                payload: payload as EstructuralHidroPayload,
            };
    }
}

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
            (key === 'initial_photo_url' || key === 'thumbnail_url' || key === 'last_photo_url') &&
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
                for (const docSnap of snap.docs) {
                    const raw = docSnap.data();
                    if (this.matchesActiveTenant(raw)) {
                        await this.hydrateRemoteDocToLocal({ id: docSnap.id, ...raw });
                        changed = true;
                    }
                }
                if (changed) {
                    const all = await this.getAllAssetsLocal();
                    bus.emit('assets', all);
                }
            },
            (err) => {
                console.warn('[DataService] Listener onSnapshot stockpiles pausado:', err.message);
            }
        );
    }

    private acquireMeasurementSnapshot(assetId: string): Unsubscribe {
        if (!firebaseDb || !this.tenantId || !assetId) {
            return () => {};
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
                .catch(() => {});
            this.getAllMeasurements()
                .then((meas) => bus.emit('meas_any', meas))
                .catch(() => {});
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
                material: asset.clase || 'mineral',
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
            material: asset.clase || 'mineral',
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

        if (activeTenant && declaredShape) {
            try {
                await offlineStorage.saveStockpileSurvey({
                    id: asset.id,
                    tenantId: activeTenant,
                    tag: asset.name,
                    material: asset.clase || 'mineral',
                    shape: declaredShape,
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

        if (activeTenant && typeof declaredDensity === 'number' && declaredDensity > 0) {
            try {
                await syncQueueEngine.enqueueTask(
                    'STOCKPILE_SURVEY',
                    compactCloudPayload,
                    `sync_stk_${this.safeTenant}_${asset.id}`
                );
            } catch (err) {
                console.warn('[DataService] No se pudo encolar STOCKPILE_SURVEY:', err);
            }
        }

        if (firebaseDb && this.isOnline && activeTenant) {
            try {
                await setDoc(doc(firebaseDb, 'stockpiles', asset.id), compactCloudPayload, {
                    merge: true,
                });
            } catch (err) {
                console.warn('[DataService] Guardado remoto de activo diferido a cola offline:', err);
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

        try {
            await syncQueueEngine.enqueueTask(
                'STOCKPILE_MEASUREMENT',
                cloudMeasPayload,
                `sync_meas_${this.safeTenant}_${meas.assetId}_${meas.id}`
            );
        } catch (err) {
            console.warn('[DataService] No se pudo encolar STOCKPILE_MEASUREMENT:', err);
        }

        if (firebaseDb && this.isOnline) {
            try {
                await setDoc(
                    doc(firebaseDb, 'stockpiles', meas.assetId, 'measurements', meas.id),
                    cloudMeasPayload,
                    { merge: true }
                );
                await this.saveMeasurementLocal(meas, true);
            } catch (err) {
                console.warn(
                    '[DataService] Guardado remoto en subcoleccion measurements diferido a cola offline:',
                    err
                );
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
            clase:
                rawDoc.clase ||
                (rawDoc.material === 'esteril' || rawDoc.material === 'baja_ley'
                    ? rawDoc.material
                    : 'mineral'),
            status: rawDoc.status,
            createdAt:
                typeof rawDoc.createdAt === 'number'
                    ? rawDoc.createdAt
                    : typeof rawDoc.timestamp === 'number'
                      ? rawDoc.timestamp
                      : Date.now(),
            createdBy: rawDoc.createdBy || '',
            updatedAt: typeof rawDoc.updatedAt === 'number' ? rawDoc.updatedAt : undefined,
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
                    : undefined,
            last_measured_at: rawDoc.last_measured_at ?? rawDoc.timestamp,
            last_geometry_type: rawDoc.last_geometry_type ?? rawDoc.geometria ?? rawDoc.shape,
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
                    sanitizedPatch.clase === 'esteril' || sanitizedPatch.clase === 'baja_ley'
                        ? sanitizedPatch.clase
                        : 'mineral',
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

        const activeTenant = (this.tenantId || measurement.tenantId || '').slice(0, 128);
        const id = `meas_${Date.now()}`;
        const newM: StockpileMeasurement = {
            ...measurement,
            id,
            tenantId: activeTenant || undefined,
            accountId: activeTenant || undefined,
            user_id: measurement.user_id || this.getUserId() || undefined,
        };

        await this.saveMeasurementLocal(newM, false);
        await this.persistMeasurementToCloudAndQueue(newM);

        const allAssetMeasurements = await this.getMeasurementsLocal(measurement.assetId);

        const asset = await this.getAsset(measurement.assetId);
        if (asset) {
            const st = this.safeTenant;
            const updated: StockpileAsset = {
                ...asset,
                tenantId: activeTenant || asset.tenantId,
                accountId: activeTenant || asset.accountId,
                last_volume_m3: measurement.volumen_m3,
                last_weight_t: measurement.peso_t,
                last_photo_url: measurement.photo_url || asset.last_photo_url,
                last_measured_at: measurement.timestamp,
                last_geometry_type: measurement.geometry?.type ?? asset.last_geometry_type,
                volumen: measurement.volumen_m3,
                volume_m3: measurement.volumen_m3,
                weight_t: measurement.peso_t,
                peso_final_toneladas: measurement.peso_t,
                density_factor: measurement.density_factor ?? asset.density_factor,
                geometria: measurement.geometry?.type ?? asset.geometria,
                copper_domain: measurement.copper_domain ?? asset.copper_domain,
                moisture_pct:
                    measurement.moisture_pct !== undefined
                        ? measurement.moisture_pct
                        : asset.moisture_pct,
                tml_pct: measurement.tml_pct !== undefined ? measurement.tml_pct : asset.tml_pct,
                residence_days:
                    measurement.residence_days !== undefined
                        ? measurement.residence_days
                        : asset.residence_days,
                copper_governance_alerts:
                    measurement.copper_governance_alerts ?? asset.copper_governance_alerts,
                cas_original_bytes: measurement.cas_original_bytes ?? asset.cas_original_bytes,
                cas_optimized_bytes: measurement.cas_optimized_bytes ?? asset.cas_optimized_bytes,
                cas_savings_pct: measurement.cas_savings_pct ?? asset.cas_savings_pct,
            };
            await this.writeMeta(K.asset(st, measurement.assetId), updated);
            await this.persistAssetToCloudAndQueue(updated, allAssetMeasurements);
            bus.emit(`asset:${measurement.assetId}`, updated);
            this.getAllAssetsLocal().then((all) => bus.emit('assets', all));
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

            return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
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

        const measurements = await this.getMeasurementsLocal(assetId);
        const valid = measurements.find((item) => !item.ignored);
        await this.saveStockpileData(
            valid
                ? {
                      last_volume_m3: valid.volumen_m3,
                      last_weight_t: valid.peso_t,
                      last_photo_url: valid.photo_url || undefined,
                      last_measured_at: valid.timestamp,
                      volumen: valid.volumen_m3,
                      volume_m3: valid.volumen_m3,
                      weight_t: valid.peso_t,
                      peso_final_toneladas: valid.peso_t,
                      density_factor: valid.density_factor,
                  }
                : {
                      last_volume_m3: 0,
                      last_weight_t: 0,
                      volumen: 0,
                      volume_m3: 0,
                      weight_t: 0,
                      peso_final_toneladas: 0,
                  },
            assetId
        );

        bus.emit(
            `meas:${assetId}`,
            measurements.map((item) =>
                item.id === measurementId ? { ...item, ignored: newStatus } : item
            )
        );
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

    // ─── DOMINIOS GEOCIENTÍFICOS FASE 4 (OFFLINE-FIRST + API) ───

    private async readDomainRecordsMap(): Promise<Record<string, GeolappDomainRecord>> {
        const raw = await this.readMeta<unknown>(K.domainRecords(this.safeTenant));
        if (!raw) return {};
        if (Array.isArray(raw)) {
            const mapped: Record<string, GeolappDomainRecord> = {};
            for (const item of raw) {
                if (item && typeof item === 'object' && typeof (item as GeolappDomainRecord).id === 'string') {
                    const rec = item as GeolappDomainRecord;
                    mapped[rec.id] = rec;
                }
            }
            return mapped;
        }
        if (typeof raw === 'object') {
            return { ...(raw as Record<string, GeolappDomainRecord>) };
        }
        return {};
    }

    private async writeDomainRecordsMap(map: Record<string, GeolappDomainRecord>): Promise<void> {
        await this.writeMeta(K.domainRecords(this.safeTenant), map);
    }

    private emitDomainRecordsBus(map: Record<string, GeolappDomainRecord>): void {
        const all = Object.values(map)
            .filter((rec) => !this.tenantId || rec.tenantId === this.tenantId)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        bus.emit('domain_records', all);
        for (const mode of ['GEOMENSURA_GEO', 'EXPLORACION_SONDAJES', 'ESTRUCTURAL_HIDRO'] as const) {
            bus.emit(
                `domain_records:${mode}`,
                all.filter((r) => r.domainMode === mode)
            );
        }
    }

    async listDomainRecords(
        domainMode?: GeolappNonStockpileDomainMode
    ): Promise<GeolappDomainRecord[]> {
        const localMap = await this.readDomainRecordsMap();

        if (this.isOnline && this.tenantId) {
            try {
                const queryParams = new URLSearchParams({ tenantId: this.tenantId });
                if (domainMode) {
                    queryParams.set('domainMode', domainMode);
                }
                const resp = await coreAuthFetch(
                    `/api/geolapp/domain-records?${queryParams.toString()}`
                );
                if (resp.ok) {
                    const data = (await resp.json().catch(() => null)) as {
                        items?: GeolappDomainRecord[];
                    } | null;
                    const remoteItems = Array.isArray(data?.items) ? data.items : [];
                    for (const remoteItem of remoteItems) {
                        if (!remoteItem || !remoteItem.id) continue;
                        if (remoteItem.tenantId && remoteItem.tenantId !== this.tenantId) continue;
                        const existing = localMap[remoteItem.id];
                        if (
                            !existing ||
                            existing.synced !== false ||
                            (remoteItem.updatedAt || 0) >= (existing.updatedAt || 0)
                        ) {
                            localMap[remoteItem.id] = {
                                ...remoteItem,
                                synced: true,
                            };
                        }
                    }
                    await this.writeDomainRecordsMap(localMap);
                }
            } catch (err) {
                console.warn(
                    '[DataService] Consulta remota domain-records diferida a cache local:',
                    err
                );
            }
        }

        return Object.values(localMap)
            .filter((rec) => {
                if (!rec || !rec.id) return false;
                if (this.tenantId && rec.tenantId !== this.tenantId) return false;
                if (domainMode && rec.domainMode !== domainMode) return false;
                return true;
            })
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    async saveDomainRecord(recordInput: GeolappDomainRecordInput): Promise<GeolappDomainRecord> {
        if (containsDataBase64Url(recordInput)) {
            throw new Error(
                'BASE64_PROHIBITED: Prohibido almacenar contenido data: Base64 en registros GEOLAPP®.'
            );
        }

        const now = Date.now();
        const activeTenant = (recordInput.tenantId || this.tenantId || '').trim().slice(0, 128);
        const id =
            (recordInput.id || '').trim() ||
            `geo-${now}-${Math.random().toString(36).slice(2, 8)}`;

        const localRecord = buildTypedDomainRecord(
            {
                id,
                tenantId: activeTenant,
                accountId: activeTenant,
                code: recordInput.code.trim(),
                title: recordInput.title.trim(),
                status: recordInput.status || 'ACTIVE',
                ...(recordInput.utmFix ? { utmFix: recordInput.utmFix } : {}),
                ...(recordInput.notes !== undefined ? { notes: recordInput.notes } : {}),
                createdAt: recordInput.createdAt || now,
                updatedAt: now,
                createdBy:
                    (recordInput.createdBy || '').trim() || this.getUserId() || 'field-operator',
                ...(recordInput.updatedBy ? { updatedBy: recordInput.updatedBy } : {}),
                synced: false,
            },
            recordInput.domainMode,
            recordInput.payload
        );

        const localMap = await this.readDomainRecordsMap();
        localMap[id] = localRecord;
        await this.writeDomainRecordsMap(localMap);
        this.emitDomainRecordsBus(localMap);

        const enqueueOfflineCreate = async (): Promise<GeolappDomainRecord> => {
            await syncQueueEngine.enqueueApiMutation(
                '/api/geolapp/domain-records',
                localRecord,
                'GEOLAPP_DOMAIN_RECORD_CREATED',
                activeTenant || this.tenantId,
                'POST'
            );
            return localRecord;
        };

        if (!this.isOnline || !activeTenant) {
            return enqueueOfflineCreate();
        }

        try {
            const resp = await coreAuthFetch('/api/geolapp/domain-records', {
                method: 'POST',
                body: JSON.stringify(localRecord),
            });

            if (resp.ok) {
                const json = (await resp.json().catch(() => null)) as {
                    record?: GeolappDomainRecord;
                } | null;
                const syncedRecord: GeolappDomainRecord = {
                    ...(json?.record || localRecord),
                    synced: true,
                };
                const refreshedMap = await this.readDomainRecordsMap();
                refreshedMap[syncedRecord.id] = syncedRecord;
                await this.writeDomainRecordsMap(refreshedMap);
                this.emitDomainRecordsBus(refreshedMap);
                return syncedRecord;
            }

            if (
                resp.status >= 400 &&
                resp.status < 500 &&
                resp.status !== 408 &&
                resp.status !== 429
            ) {
                const errPayload = (await resp.json().catch(() => null)) as {
                    error?: string;
                } | null;
                throw new Error(errPayload?.error || `Error guardando domain-record (${resp.status}).`);
            }

            return enqueueOfflineCreate();
        } catch (err) {
            if (
                err instanceof Error &&
                (err.message.includes('BASE64_PROHIBITED') ||
                    err.message.includes('TENANT_ACCESS_DENIED') ||
                    err.message.includes('Error guardando domain-record'))
            ) {
                throw err;
            }
            return enqueueOfflineCreate();
        }
    }

    async updateDomainRecordWithHitl(
        recordId: string,
        patch: GeolappDomainRecordHitlPatch,
        confirmationKeyword: string,
        diffSummary?: HitlFieldDiff[]
    ): Promise<GeolappDomainRecord> {
        if (confirmationKeyword !== 'ACTUALIZAR') {
            throw new Error(
                'HITL_CONFIRMATION_REQUIRED: Se requiere confirmar escribiendo exactamente "ACTUALIZAR".'
            );
        }

        if (containsDataBase64Url(patch)) {
            throw new Error(
                'BASE64_PROHIBITED: Prohibido almacenar contenido data: Base64 en actualización HITL.'
            );
        }

        const rawPatchMeta = patch as Record<string, unknown>;
        let localMap = await this.readDomainRecordsMap();
        let existing = localMap[recordId];
        if (!existing && this.isOnline && this.tenantId) {
            await this.listDomainRecords();
            localMap = await this.readDomainRecordsMap();
            existing = localMap[recordId];
        }

        if (!existing) {
            throw new Error(`DOMAIN_RECORD_NOT_FOUND: Registro ${recordId} no encontrado.`);
        }

        if (
            (rawPatchMeta.id !== undefined && String(rawPatchMeta.id) !== existing.id) ||
            (rawPatchMeta.tenantId !== undefined &&
                String(rawPatchMeta.tenantId) !== existing.tenantId) ||
            (rawPatchMeta.accountId !== undefined &&
                String(rawPatchMeta.accountId) !== existing.accountId) ||
            (rawPatchMeta.domainMode !== undefined &&
                rawPatchMeta.domainMode !== existing.domainMode)
        ) {
            throw new Error(
                'IMMUTABLE_FIELD_ERROR: No se permite modificar id, tenantId, accountId ni domainMode.'
            );
        }

        const mergedPayload: GeolappDomainPayload = patch.payload
            ? ({
                  ...existing.payload,
                  ...patch.payload,
              } as GeolappDomainPayload)
            : existing.payload;

        const sanitizedPatch: Record<string, unknown> = {};
        if (patch.code !== undefined) sanitizedPatch.code = patch.code;
        if (patch.title !== undefined) sanitizedPatch.title = patch.title;
        if (patch.status !== undefined) sanitizedPatch.status = patch.status;
        if (patch.utmFix !== undefined) sanitizedPatch.utmFix = patch.utmFix;
        if (patch.notes !== undefined) sanitizedPatch.notes = patch.notes;
        if (patch.payload !== undefined) sanitizedPatch.payload = mergedPayload;

        if (Object.keys(sanitizedPatch).length === 0) {
            throw new Error('HITL_EMPTY_PATCH: Debe incluir al menos un campo técnico modificado.');
        }

        const now = Date.now();
        const localUpdated = buildTypedDomainRecord(
            {
                id: existing.id,
                tenantId: existing.tenantId,
                accountId: existing.accountId,
                code: patch.code !== undefined ? patch.code : existing.code,
                title: patch.title !== undefined ? patch.title : existing.title,
                status: patch.status !== undefined ? patch.status : existing.status,
                utmFix: patch.utmFix !== undefined ? patch.utmFix : existing.utmFix,
                notes: patch.notes !== undefined ? patch.notes : existing.notes,
                createdAt: existing.createdAt,
                updatedAt: now,
                createdBy: existing.createdBy,
                updatedBy: this.getUserId() || existing.updatedBy || existing.createdBy,
                synced: false,
            },
            existing.domainMode,
            mergedPayload
        );

        localMap[recordId] = localUpdated;
        await this.writeDomainRecordsMap(localMap);
        this.emitDomainRecordsBus(localMap);

        const endpoint = `/api/geolapp/domain-records/${encodeURIComponent(recordId)}/hitl-update`;
        const bodyPayload = {
            confirmationKeyword: 'ACTUALIZAR' as const,
            patch: sanitizedPatch,
            ...(diffSummary && diffSummary.length > 0 ? { diffSummary } : {}),
        };
        const scopedTenant = existing.tenantId || this.tenantId;

        const enqueueOfflineHitl = async (): Promise<GeolappDomainRecord> => {
            await syncQueueEngine.enqueueApiMutation(
                endpoint,
                bodyPayload,
                'GEOLAPP_DOMAIN_RECORD_HITL_UPDATED',
                scopedTenant,
                'PATCH'
            );
            return localUpdated;
        };

        if (!this.isOnline || !scopedTenant) {
            return enqueueOfflineHitl();
        }

        try {
            const resp = await coreAuthFetch(endpoint, {
                method: 'PATCH',
                body: JSON.stringify(bodyPayload),
            });

            if (resp.ok) {
                const json = (await resp.json().catch(() => null)) as {
                    record?: GeolappDomainRecord;
                } | null;
                const syncedRecord: GeolappDomainRecord = {
                    ...(json?.record || localUpdated),
                    synced: true,
                };
                const refreshedMap = await this.readDomainRecordsMap();
                refreshedMap[recordId] = syncedRecord;
                await this.writeDomainRecordsMap(refreshedMap);
                this.emitDomainRecordsBus(refreshedMap);
                return syncedRecord;
            }

            if (
                resp.status >= 400 &&
                resp.status < 500 &&
                resp.status !== 408 &&
                resp.status !== 429
            ) {
                const errPayload = (await resp.json().catch(() => null)) as {
                    error?: string;
                } | null;
                throw new Error(
                    errPayload?.error || `Error en actualización HITL (${resp.status}).`
                );
            }

            return enqueueOfflineHitl();
        } catch (err) {
            if (
                err instanceof Error &&
                (err.message.includes('HITL_') ||
                    err.message.includes('BASE64_') ||
                    err.message.includes('IMMUTABLE_') ||
                    err.message.includes('TENANT_ACCESS_DENIED') ||
                    err.message.includes('Error en actualización HITL'))
            ) {
                throw err;
            }
            return enqueueOfflineHitl();
        }
    }

    subscribeToDomainRecords(
        domainMode: GeolappNonStockpileDomainMode | undefined,
        cb: (records: GeolappDomainRecord[]) => void
    ): Unsubscribe {
        this.listDomainRecords(domainMode).then(cb);
        const channel = domainMode ? `domain_records:${domainMode}` : 'domain_records';
        return bus.on(channel, cb);
    }

    // ─── SINCRONIZACIÓN CON CLOUD FIRESTORE & SYNC QUEUE ───

    async syncWithMinReport(): Promise<void> {
        await syncQueueEngine.drainQueue();
        const allAssets = await this.getAllAssets();
        const allMeas = await this.getAllMeasurements();
        const allDomainRecords = await this.listDomainRecords().catch(() => []);
        bus.emit('assets', allAssets);
        bus.emit('meas_any', allMeas);
        bus.emit('domain_records', allDomainRecords);
    }
}

export const dataService = new DataService();
