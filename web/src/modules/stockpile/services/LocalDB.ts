/**
 * LocalDB - Capa de persistencia 100% local para modo Android Offline
 *
 * Reemplaza Firebase completamente cuando no hay credenciales reales.
 * Usa localStorage como backend de datos, garantizando funcionamiento
 * total sin conexión a internet ni servidor de desarrollo.
 *
 * Estrategia de keys:
 *  - "sc_asset_{id}"           → StockpileAsset individual
 *  - "sc_meas_{id}"            → StockpileMeasurement individual
 *  - "sc_all_asset_ids"        → string[] de todos los IDs de activos
 *  - "sc_meas_ids_{assetId}"   → string[] de IDs de mediciones de un activo
 */

import { idbStorage } from '../utils/indexedDB';

const PREFIX = 'sc_';

function lsKey(key: string): string {
    return `${PREFIX}${key}`;
}

/**
 * LocalDB - Capa de persistencia asíncrona usando IndexedDB
 */
export const localDb = {
    async set<T>(key: string, value: T): Promise<void> {
        try {
            await idbStorage.set(lsKey(key), value);
        } catch (e) {
            console.error('[LocalDB] Error al guardar:', key, e);
        }
    },

    async get<T>(key: string): Promise<T | null> {
        try {
            return await idbStorage.get<T>(lsKey(key));
        } catch (e) {
            console.error('[LocalDB] Error al leer:', key, e);
            return null;
        }
    },

    async delete(key: string): Promise<void> {
        await idbStorage.delete(lsKey(key));
    },

    async addToList(listKey: string, id: string): Promise<void> {
        let current = await this.get<any>(listKey);
        if (!Array.isArray(current)) current = [];
        if (!current.includes(id)) {
            current.push(id);
            await this.set(listKey, current);
        }
    },

    async getList(listKey: string): Promise<string[]> {
        return await this.get<string[]>(listKey) || [];
    }
};
