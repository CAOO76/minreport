/**
 * DataService — Servicio de datos de Stockpile Control (Dual-Mode Offline-First + Cloud Firestore)
 *
 * ARQUITECTURA:
 *  - Conectado a la instancia única de Cloud Firestore (`stockpiles`) en `southamerica-west1`.
 *  - Caché local de latencia 0ms en IndexedDB (`idbStorage`).
 *  - Encolado de mutaciones offline mediante `syncQueueEngine` (`STOCKPILE_SURVEY`).
 *  - Aislamiento multi-tenant por `tenantId` (`accountId`).
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    query,
    where
} from 'firebase/firestore';
import { getDb, auth } from '../config/firebase.config';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { idbStorage } from '../utils/indexedDB';
import { storageService } from './StorageService';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

export type StockpileData = StockpileAsset;
export type Unsubscribe = () => void;

export interface TenantContextInput {
    tenantId?: string;
    userId?: string;
}

// ─────────────────────────────────────────────
// Keys de almacenamiento local (IndexedDB)
// ─────────────────────────────────────────────
const K = {
    assetIds:         'sc:asset_ids',
    asset:    (id: string) => `sc:asset:${id}`,
    measIds:  (aId: string) => `sc:meas_ids:${aId}`,
    meas:     (id: string) => `sc:meas:${id}`,
    profiles:         'sc:material_profiles',
} as const;

function sanitizeForFirestore<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

// ─────────────────────────────────────────────
// EventBus: subscripciones reactivas
// ─────────────────────────────────────────────
type Listener<T> = (data: T) => void;

class EventBus {
    private ch = new Map<string, Set<Listener<any>>>();

    emit<T>(channel: string, data: T) {
        this.ch.get(channel)?.forEach(fn => fn(data));
    }

    on<T>(channel: string, fn: Listener<T>): Unsubscribe {
        if (!this.ch.has(channel)) this.ch.set(channel, new Set());
        this.ch.get(channel)!.add(fn);
        return () => this.ch.get(channel)?.delete(fn);
    }
}

const bus = new EventBus();

// ─────────────────────────────────────────────
// DataService
// ─────────────────────────────────────────────
export class DataService {
    private tenantId: string = 'faena-minreport';
    private userId: string = 'field-operator';
    private isHydratingFromCloud: boolean = false;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                this.syncWithMinReport().catch(err =>
                    console.warn('[DataService] Error sincronizando al recuperar red:', err)
                );
            });
        }
    }

    hasContext(): boolean {
        return Boolean(this.tenantId);
    }

    setTenantContext(context: TenantContextInput): void {
        if (context?.tenantId) {
            this.tenantId = context.tenantId;
            storageService.setTenantId(context.tenantId);
        }
        if (context?.userId) {
            this.userId = context.userId;
        } else if (auth?.currentUser?.uid) {
            this.userId = auth.currentUser.uid;
        }
        // Sincronizar en segundo plano desde Firestore al establecer el tenant
        this.syncWithMinReport().catch(err =>
            console.warn('[DataService] Sincronización inicial diferida (modo offline):', err)
        );
    }

    getTenantId(): string {
        return this.tenantId;
    }

    getUserId(): string {
        return auth?.currentUser?.uid || this.userId;
    }

    private async read<T>(key: string): Promise<T | null> {
        return idbStorage.get<T>(key);
    }

    private async write<T>(key: string, value: T): Promise<void> {
        return idbStorage.set<T>(key, value);
    }

    private async readList(key: string): Promise<string[]> {
        const val = await this.read<any>(key);
        return Array.isArray(val) ? val : [];
    }

    private async addToList(key: string, id: string): Promise<void> {
        const list = await this.readList(key);
        if (Array.isArray(list) && !list.includes(id)) {
            await this.write(key, [...list, id]);
        }
    }

    /**
     * Sincroniza un activo y sus mediciones hacia Cloud Firestore (`stockpiles`)
     * y encola la tarea en `SyncQueueEngine` para resiliencia Offline-First.
     */
    private async persistAssetToCloudAndQueue(asset: StockpileAsset, measurements?: StockpileMeasurement[]): Promise<void> {
        const measList = measurements ?? await this.getMeasurementsLocal(asset.id);
        const latestMeas = measList.find(m => !m.ignored) || measList[0];
        const volumeM3 = latestMeas?.volumen_m3 ?? asset.last_volume_m3 ?? asset.volumen ?? 0;
        const density = latestMeas?.density_factor ?? asset.density_factor ?? 1.8;
        const tonnage = latestMeas?.peso_t ?? asset.last_weight_t ?? asset.peso_final_toneladas ?? (volumeM3 * density);

        const cloudPayload = sanitizeForFirestore({
            ...asset,
            id: asset.id,
            tenantId: this.tenantId,
            accountId: this.tenantId,
            tag: asset.name,
            material: asset.clase || 'mineral',
            shape: 'elliptic-cone' as const,
            volumeM3,
            density,
            tonnage,
            confidence: 95,
            lastSurvey: new Date(asset.last_measured_at || asset.createdAt || Date.now()).toISOString(),
            timestamp: asset.last_measured_at || asset.createdAt || Date.now(),
            measurements: measList,
            updatedAt: Date.now()
        });

        try {
            await syncQueueEngine.enqueueTask('STOCKPILE_SURVEY', cloudPayload, `sync_stk_${asset.id}`);
        } catch (err) {
            console.warn('[DataService] No se pudo encolar en SyncQueueEngine:', err);
        }

        const db = getDb();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (db && isOnline) {
            try {
                await setDoc(doc(db, 'stockpiles', asset.id), cloudPayload, { merge: true });
            } catch (err) {
                console.warn('[DataService] Guardado remoto diferido a cola offline:', err);
            }
        }
    }

    /**
     * Hidrata un documento remoto de Firestore hacia el caché local IndexedDB
     */
    private async hydrateRemoteDocToLocal(rawDoc: Record<string, any>): Promise<StockpileAsset | null> {
        if (!rawDoc || !rawDoc.id) return null;

        const remoteMeasurements: StockpileMeasurement[] = Array.isArray(rawDoc.measurements)
            ? rawDoc.measurements
            : [];

        const asset: StockpileAsset = {
            id: rawDoc.id,
            name: rawDoc.name || rawDoc.tag || `ACOPIO-${rawDoc.id}`,
            clase: rawDoc.clase || (rawDoc.material === 'esteril' || rawDoc.material === 'baja_ley' ? rawDoc.material : 'mineral'),
            createdAt: typeof rawDoc.createdAt === 'number' ? rawDoc.createdAt : (typeof rawDoc.timestamp === 'number' ? rawDoc.timestamp : Date.now()),
            createdBy: rawDoc.createdBy || 'field-operator',
            geo_point: rawDoc.geo_point || {
                latitude: rawDoc.location?.lat || 0,
                longitude: rawDoc.location?.lng || 0,
                altitude: null,
                accuracy: 5
            },
            location_ref: rawDoc.location_ref,
            initial_photo_url: rawDoc.initial_photo_url,
            thumbnail_url: rawDoc.thumbnail_url,
            last_volume_m3: rawDoc.last_volume_m3 ?? rawDoc.volumeM3 ?? rawDoc.volumen ?? 0,
            last_weight_t: rawDoc.last_weight_t ?? rawDoc.tonnage ?? rawDoc.peso_final_toneladas ?? 0,
            last_photo_url: rawDoc.last_photo_url,
            last_measured_at: rawDoc.last_measured_at ?? rawDoc.timestamp,
            volumen: rawDoc.volumen ?? rawDoc.volumeM3 ?? rawDoc.last_volume_m3 ?? 0,
            volume_m3: rawDoc.volume_m3 ?? rawDoc.volumeM3 ?? rawDoc.last_volume_m3 ?? 0,
            weight_t: rawDoc.weight_t ?? rawDoc.tonnage ?? rawDoc.last_weight_t ?? 0,
            peso_final_toneladas: rawDoc.peso_final_toneladas ?? rawDoc.tonnage ?? rawDoc.last_weight_t ?? 0,
            density_factor: rawDoc.density_factor ?? rawDoc.density,
        };

        await this.write(K.asset(asset.id), asset);
        await this.addToList(K.assetIds, asset.id);

        if (remoteMeasurements.length > 0) {
            for (const m of remoteMeasurements) {
                if (m && m.id) {
                    await this.write(K.meas(m.id), m);
                    await this.addToList(K.measIds(asset.id), m.id);
                }
            }
        }

        return asset;
    }

    // ─── ACTIVOS ───────────────────────────────

    async createAsset(asset: Omit<StockpileAsset, 'id' | 'createdAt' | 'createdBy'>): Promise<string> {
        const id = `asset_${Date.now()}`;
        const newAsset: StockpileAsset = {
            ...asset,
            id,
            createdAt: Date.now(),
            createdBy: this.getUserId(),
        };

        await this.write(K.asset(id), newAsset);
        await this.addToList(K.assetIds, id);

        await this.persistAssetToCloudAndQueue(newAsset, []);

        bus.emit(`asset:${id}`, newAsset);
        this.getAllAssetsLocal().then(all => bus.emit('assets', all));

        console.log('[DataService] Activo creado:', id);
        return id;
    }

    async getAsset(id: string): Promise<StockpileAsset | null> {
        const localAsset = await this.read<StockpileAsset>(K.asset(id));
        if (localAsset) return localAsset;

        const db = getDb();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (db && isOnline) {
            try {
                const snap = await getDoc(doc(db, 'stockpiles', id));
                if (snap.exists()) {
                    const hydrated = await this.hydrateRemoteDocToLocal({ id: snap.id, ...snap.data() });
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
        // 1. Remove from assetIds list
        const ids = await this.readList(K.assetIds);
        if (Array.isArray(ids)) {
            await this.write(K.assetIds, ids.filter(i => i !== id));
        }

        // 2. Remove actual asset record
        await idbStorage.delete(K.asset(id));

        // 3. Remove all associated measurements
        const measIds = await this.readList(K.measIds(id));
        if (Array.isArray(measIds)) {
            for (const mid of measIds) {
                await idbStorage.delete(K.meas(mid));
            }
        }
        await idbStorage.delete(K.measIds(id));

        // 4. Delete from Firestore if online
        const db = getDb();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (db && isOnline) {
            try {
                await deleteDoc(doc(db, 'stockpiles', id));
            } catch (err) {
                console.warn(`[DataService] No se pudo eliminar ${id} en Firestore:`, err);
            }
        }

        // 5. Notify UI to refresh
        this.getAllAssetsLocal().then(all => bus.emit('assets', all));
        console.log(`[DataService] Activo ${id} y sus mediciones eliminados`);
    }

    async getMeasurement(id: string): Promise<StockpileMeasurement | null> {
        return await this.read<StockpileMeasurement>(K.meas(id));
    }

    async getStockpileData(id: string): Promise<StockpileAsset | null> {
        return this.getAsset(id);
    }

    private async getAllAssetsLocal(): Promise<StockpileAsset[]> {
        try {
            const ids = await this.readList(K.assetIds);
            if (!Array.isArray(ids)) return [];
            const items = await Promise.all(ids.map(id => this.read<StockpileAsset>(K.asset(id))));
            return items.filter((a): a is StockpileAsset => a !== null && typeof a === 'object' && Boolean(a.id));
        } catch (e) {
            console.error('[DataService] Error al obtener activos locales:', e);
            return [];
        }
    }

    async getAllAssets(): Promise<StockpileAsset[]> {
        const localAssets = await this.getAllAssetsLocal();

        const db = getDb();
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (db && isOnline && !this.isHydratingFromCloud) {
            this.isHydratingFromCloud = true;
            try {
                const q = query(collection(db, 'stockpiles'), where('tenantId', '==', this.tenantId));
                const snap = await getDocs(q);
                let updated = false;
                for (const docSnap of snap.docs) {
                    const data = docSnap.data();
                    await this.hydrateRemoteDocToLocal({ id: docSnap.id, ...data });
                    updated = true;
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
        const current = await this.getAsset(targetId) ?? {} as StockpileAsset;
        const updated = { ...current, ...data, id: targetId } as StockpileAsset;

        await this.write(K.asset(targetId), updated);
        await this.addToList(K.assetIds, targetId);
        await this.persistAssetToCloudAndQueue(updated);

        bus.emit(`asset:${targetId}`, updated);
        this.getAllAssetsLocal().then(all => bus.emit('assets', all));
        return targetId;
    }

    // ─── MEDICIONES ────────────────────────────

    async addMeasurement(measurement: Omit<StockpileMeasurement, 'id'>): Promise<string> {
        const id = `meas_${Date.now()}`;
        const newM: StockpileMeasurement = {
            ...measurement,
            id,
            user_id: measurement.user_id || this.getUserId()
        };

        await this.write(K.meas(id), newM);
        await this.addToList(K.measIds(measurement.assetId), id);

        const allAssetMeasurements = await this.getMeasurementsLocal(measurement.assetId);

        // Actualizar estado del activo
        const asset = await this.getAsset(measurement.assetId);
        if (asset) {
            const updated: StockpileAsset = {
                ...asset,
                last_volume_m3:       measurement.volumen_m3,
                last_weight_t:        measurement.peso_t,
                last_photo_url:       measurement.photo_url,
                last_measured_at:     measurement.timestamp,
                volumen:              measurement.volumen_m3,
                volume_m3:            measurement.volumen_m3,
                weight_t:             measurement.peso_t,
                peso_final_toneladas: measurement.peso_t,
                density_factor:       measurement.density_factor ?? asset.density_factor,
            };
            await this.write(K.asset(measurement.assetId), updated);
            await this.persistAssetToCloudAndQueue(updated, allAssetMeasurements);
            bus.emit(`asset:${measurement.assetId}`, updated);
            this.getAllAssetsLocal().then(all => bus.emit('assets', all));
        }

        bus.emit(`meas:${measurement.assetId}`, allAssetMeasurements);
        bus.emit('meas_any', await this.getAllMeasurements());
        bus.emit(`meas_item:${id}`, newM);

        console.log('[DataService] Medición guardada:', id);
        return id;
    }

    async getAllMeasurements(): Promise<StockpileMeasurement[]> {
        try {
            const assets = await this.readList(K.assetIds);
            if (!Array.isArray(assets)) return [];
            const all = await Promise.all(assets.map(id => this.getMeasurementsLocal(id)));
            return all.flat().filter(m => m && m.timestamp).sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error('[DataService] Error al obtener mediciones:', e);
            return [];
        }
    }

    private async getMeasurementsLocal(assetId: string): Promise<StockpileMeasurement[]> {
        try {
            const ids = await this.readList(K.measIds(assetId));
            if (!Array.isArray(ids)) return [];
            const items = await Promise.all(ids.map(id => this.read<StockpileMeasurement>(K.meas(id))));
            return items
                .filter((m): m is StockpileMeasurement => m !== null && typeof m === 'object' && Boolean(m.timestamp))
                .sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error(`[DataService] Error al obtener mediciones para ${assetId}:`, e);
            return [];
        }
    }

    async getMeasurements(assetId: string): Promise<StockpileMeasurement[]> {
        return this.getMeasurementsLocal(assetId);
    }

    async toggleIgnoreMeasurement(measurementId: string, assetId: string, currentIgnoredStatus: boolean): Promise<void> {
        const newStatus = !currentIgnoredStatus;
        const m = await this.getMeasurement(measurementId);
        if (m) await this.write(K.meas(measurementId), { ...m, ignored: newStatus });

        const measurements = await this.getMeasurementsLocal(assetId);
        const valid = measurements.find(item => !item.ignored);
        await this.saveStockpileData(valid ? {
            last_volume_m3: valid.volumen_m3,
            last_weight_t: valid.peso_t,
            last_photo_url: valid.photo_url || undefined,
            last_measured_at: valid.timestamp,
            volumen: valid.volumen_m3,
            volume_m3: valid.volumen_m3,
            weight_t: valid.peso_t,
            peso_final_toneladas: valid.peso_t,
        } : {
            last_volume_m3: 0,
            last_weight_t: 0,
            volumen: 0,
            volume_m3: 0,
            weight_t: 0,
            peso_final_toneladas: 0
        }, assetId);

        bus.emit(`meas:${assetId}`, measurements.map(item => item.id === measurementId ? { ...item, ignored: newStatus } : item));
    }

    // ─── PERFILES DE MATERIAL ─────────────────

    async getMaterialProfiles(): Promise<Record<string, number>> {
        return (await this.read<Record<string, number>>(K.profiles))
            ?? { 'COLPAS': 1.6, 'GRANSA': 1.8, 'MIXTO': 1.7, 'FINOS': 1.5 };
    }

    async saveMaterialProfiles(profiles: Record<string, number>): Promise<void> {
        await this.write(K.profiles, profiles);
    }

    // ─── SUBSCRIPCIONES REACTIVAS ─────────────

    subscribeToAsset(id: string, cb: (data: StockpileAsset | null) => void): Unsubscribe {
        this.getAsset(id).then(cb);
        return bus.on(`asset:${id}`, cb);
    }

    subscribeToAllAssets(cb: (data: StockpileAsset[]) => void): Unsubscribe {
        this.getAllAssets().then(cb);
        return bus.on('assets', cb);
    }

    subscribeToMeasurements(assetId: string, cb: (data: StockpileMeasurement[]) => void): Unsubscribe {
        this.getMeasurements(assetId).then(cb);
        return bus.on(`meas:${assetId}`, cb);
    }

    subscribeToMeasurementsAll(cb: (data: StockpileMeasurement[]) => void): Unsubscribe {
        this.getAllMeasurements().then(cb);
        return bus.on('meas_any', cb);
    }

    subscribeToMeasurement(id: string, cb: (data: StockpileMeasurement | null) => void): Unsubscribe {
        this.getMeasurement(id).then(cb);
        return bus.on(`meas_item:${id}`, cb);
    }

    // ─── SINCRONIZACIÓN CON CLOUD FIRESTORE & SYNC QUEUE ───

    async syncWithMinReport(): Promise<void> {
        await syncQueueEngine.drainQueue();
        const allAssets = await this.getAllAssets();
        const allMeas = await this.getAllMeasurements();
        bus.emit('assets', allAssets);
        bus.emit('meas_any', allMeas);
    }
}

export const dataService = new DataService();

