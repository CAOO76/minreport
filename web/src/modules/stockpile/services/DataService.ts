/**
 * DataService — Servicio de datos del plugin Stockpile Control
 *
 * ARQUITECTURA:
 *  - Sin Firebase. Sin credenciales externas. Sin backend propio.
 *  - Usa EXCLUSIVAMENTE SecureContext del SDK de MINREPORT.
 *  - En desarrollo (standalone): MockSecureContext → localStorage del dispositivo.
 *  - En producción (dentro de MINREPORT): SecureContext real → datos de MINREPORT.
 *
 * REACTIVO: Las suscripciones usan un EventBus interno. Los componentes
 * reciben datos inmediatamente desde el almacenamiento local y son notificados
 * de cambios sin necesidad de polling ni Firebase listeners.
 */

import type { SecureContext } from '@minreport/sdk';
import { MockSecureContext } from './sdk-mock';
import { idbStorage } from '../utils/indexedDB';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

export type StockpileData = StockpileAsset;
export type Unsubscribe = () => void;

// ─────────────────────────────────────────────
// Keys de almacenamiento (SecureContext)
// ─────────────────────────────────────────────
const K = {
    assetIds:         'sc:asset_ids',
    asset:    (id: string) => `sc:asset:${id}`,
    measIds:  (aId: string) => `sc:meas_ids:${aId}`,
    meas:     (id: string) => `sc:meas:${id}`,
    profiles:         'sc:material_profiles',
} as const;

// ─────────────────────────────────────────────
// EventBus: subscripciones reactivas sin Firebase
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
    private ctx: SecureContext = MockSecureContext;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('mock-sync-updated', () => {
                console.log('[DataService] Re-fetching all data due to Mock Sync update');
                try {
                    this.getAllAssets().then(all => {
                        console.log('[DataService] HMR Assets Parsed:', all.length);
                        bus.emit('assets', all);
                    });
                    this.getAllMeasurements().then(all => {
                        console.log('[DataService] HMR Measurements Parsed:', all.length);
                        bus.emit('meas_any', all);
                    });
                } catch(e) {
                    console.error('[DataService] Re-fetch error:', e);
                }
            });
        }
    }

    /** Inyectar contexto seguro desde MINREPORT SDK (o MockSecureContext en dev) */
    hasContext(): boolean {
        return !!this.ctx;
    }

    setSecureContext(context: SecureContext): void {
        this.ctx = context;
        console.log('[DataService] ✅ SecureContext listo — almacenamiento local activo');
    }

    private get storage() {
        if (!this.ctx) {
            console.warn('[DataService] ⚠️ SecureContext no inicializado externamente. Activando MockSecureContext defensivo.');
            this.ctx = MockSecureContext;
        }
        return this.ctx.storage;
    }

    private async read<T>(key: string): Promise<T | null> {
        return this.storage.read<T>(key);
    }

    private async write<T>(key: string, value: T): Promise<void> {
        return this.storage.write<T>(key, value);
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

    // ─── ACTIVOS ───────────────────────────────

    async createAsset(asset: Omit<StockpileAsset, 'id' | 'createdAt' | 'createdBy'>): Promise<string> {
        const id = `asset_${Date.now()}`;
        const newAsset: StockpileAsset = {
            ...asset, id,
            createdAt: Date.now(),
            createdBy: 'field-operator',
        };

        await this.write(K.asset(id), newAsset);
        await this.addToList(K.assetIds, id);

        // Notificar suscriptores
        bus.emit(`asset:${id}`, newAsset);
        this.getAllAssets().then(all => bus.emit('assets', all));

        console.log('[DataService] Activo creado:', id);
        return id;
    }

    async getAsset(id: string): Promise<StockpileAsset | null> {
        const asset = await this.read<StockpileAsset>(K.asset(id));
        if (asset && (asset as any).__is_lazy) {
            // Lazy loading on demand
            const { fetchFullKey } = await import('./sdk-mock');
            const { idbStorage } = await import('../utils/indexedDB');
            const full = await fetchFullKey(K.asset(id));
            if (full) {
                await idbStorage.set(K.asset(id), full);
                // Notificar suscriptores del cambio a "Full"
                bus.emit(`asset:${id}`, full);
                return full;
            }
        }
        return asset;
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

        // 4. Notify UI to refresh
        this.getAllAssets().then(all => bus.emit('assets', all));
        console.log(`[DataService] Activo ${id} y sus mediciones eliminados`);
    }

    async getMeasurement(id: string): Promise<StockpileMeasurement | null> {
        const meas = await this.read<StockpileMeasurement>(K.meas(id));
        if (meas && (meas as any).__is_lazy) {
            // Lazy loading on demand
            const { fetchFullKey } = await import('./sdk-mock');
            const { idbStorage } = await import('../utils/indexedDB');
            const full = await fetchFullKey(K.meas(id));
            if (full) {
                await idbStorage.set(K.meas(id), full);
                // Notificar suscriptores del cambio a "Full"
                bus.emit(`meas_item:${id}`, full);
                return full;
            }
        }
        return meas;
    }

    async getStockpileData(id: string): Promise<StockpileAsset | null> {
        return this.getAsset(id);
    }

    async getAllAssets(): Promise<StockpileAsset[]> {
        try {
            const ids = await this.readList(K.assetIds);
            if (!Array.isArray(ids)) return [];
            const items = await Promise.all(ids.map(id => this.read<StockpileAsset>(K.asset(id))));
            return items.filter((a): a is StockpileAsset => a !== null && typeof a === 'object' && !!a.id);
        } catch (e) {
            console.error('[DataService] Error al obtener todos los activos:', e);
            return [];
        }
    }

    async saveStockpileData(data: Partial<StockpileAsset>, id?: string): Promise<string> {
        const targetId = id ?? data.id;
        if (!targetId) throw new Error('ID requerido en saveStockpileData');
        const current = await this.getAsset(targetId) ?? {} as StockpileAsset;
        const updated = { ...current, ...data } as StockpileAsset;
        await this.write(K.asset(targetId), updated);
        await this.addToList(K.assetIds, targetId);
        bus.emit(`asset:${targetId}`, updated);
        this.getAllAssets().then(all => bus.emit('assets', all));
        return targetId;
    }

    // ─── MEDICIONES ────────────────────────────

    async addMeasurement(measurement: Omit<StockpileMeasurement, 'id'>): Promise<string> {
        const id = `meas_${Date.now()}`;
        const newM: StockpileMeasurement = { ...measurement, id };

        await this.write(K.meas(id), newM);
        await this.addToList(K.measIds(measurement.assetId), id);

        // Actualizar estado del activo
        const asset = await this.getAsset(measurement.assetId);
        if (asset) {
            const updated = {
                ...asset,
                last_volume_m3:   measurement.volumen_m3,
                last_weight_t:    measurement.peso_t,
                last_photo_url:   measurement.photo_url,
                last_measured_at: measurement.timestamp,
                volumen:          measurement.volumen_m3,
                peso_final_toneladas: measurement.peso_t,
            };
            await this.write(K.asset(measurement.assetId), updated);
            bus.emit(`asset:${measurement.assetId}`, updated);
            this.getAllAssets().then(all => bus.emit('assets', all));
        }

        bus.emit(`meas:${measurement.assetId}`, await this.getMeasurements(measurement.assetId));
        bus.emit('meas_any', await this.getAllMeasurements());
        bus.emit(`meas_item:${id}`, newM);

        console.log('[DataService] Medición guardada:', id);
        return id;
    }

    async getAllMeasurements(): Promise<StockpileMeasurement[]> {
        try {
            const assets = await this.readList(K.assetIds);
            if (!Array.isArray(assets)) return [];
            const all = await Promise.all(assets.map(id => this.getMeasurements(id)));
            // Usamos un filtrado defensivo al aplanar por si flat() encuentra estructuras inesperadas
            return all.flat().filter(m => m && m.timestamp).sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error('[DataService] Error al obtener mediciones:', e);
            return [];
        }
    }


    async getMeasurements(assetId: string): Promise<StockpileMeasurement[]> {
        try {
            const ids = await this.readList(K.measIds(assetId));
            if (!Array.isArray(ids)) return [];
            const items = await Promise.all(ids.map(id => this.read<StockpileMeasurement>(K.meas(id))));
            return items
                .filter((m): m is StockpileMeasurement => m !== null && typeof m === 'object' && !!m.timestamp)
                .sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
             console.error(`[DataService] Error al obtener mediciones para ${assetId}:`, e);
             return [];
        }
    }

    async toggleIgnoreMeasurement(measurementId: string, assetId: string, currentIgnoredStatus: boolean): Promise<void> {
        const newStatus = !currentIgnoredStatus;
        const m = await this.getMeasurement(measurementId);
        if (m) await this.write(K.meas(measurementId), { ...m, ignored: newStatus });

        const measurements = await this.getMeasurements(assetId);
        const valid = measurements.find(m => !m.ignored);
        await this.saveStockpileData(valid ? {
            last_volume_m3: valid.volumen_m3, last_weight_t: valid.peso_t,
            last_photo_url: valid.photo_url || undefined, last_measured_at: valid.timestamp,
            volumen: valid.volumen_m3, peso_final_toneladas: valid.peso_t,
        } : { last_volume_m3: 0, last_weight_t: 0, volumen: 0, peso_final_toneladas: 0 }, assetId);

        bus.emit(`meas:${assetId}`, measurements.map(m => m.id === measurementId ? { ...m, ignored: newStatus } : m));
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

    /** Suscripción global a TODAS las mediciones realizadas (útil para DASHBOARDS) */
    subscribeToMeasurementsAll(cb: (data: StockpileMeasurement[]) => void): Unsubscribe {
        const fetchAll = async () => {
            const assets = await this.readList(K.assetIds);
            const all = await Promise.all(assets.map(id => this.getMeasurements(id)));
            cb(all.flat().sort((a, b) => b.timestamp - a.timestamp));
        };
        fetchAll();
        return bus.on('meas_any', cb);
    }

    subscribeToMeasurement(id: string, cb: (data: StockpileMeasurement | null) => void): Unsubscribe {
        this.getMeasurement(id).then(cb);
        return bus.on(`meas_item:${id}`, cb);
    }

    // ─── SYNC (futuro, delegar a MINREPORT) ───

    async syncWithMinReport(): Promise<void> {
        if (import.meta.env?.DEV) {
            console.log('[DataService] Forzando PULL desde Dev Server (Mock Sync)');
            const { pullFromDevServer } = await import('./sdk-mock');
            await pullFromDevServer();
            this.getAllAssets().then(all => bus.emit('assets', all));
            this.getAllMeasurements().then(all => bus.emit('meas_any', all));
        } else {
            console.log('[DataService] Sync delegado al SDK de MINREPORT (integracion futura)');
        }
    }
}

export const dataService = new DataService();
