/**
 * useStockpileData Hook
 * Hook de interoperabilidad nativa que consulta datos reales de volumetría desde DataService (IndexedDB + Cloud Firestore).
 */

import { useState, useEffect, useCallback } from 'react';
import { dataService } from '../services/DataService';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

export interface StockpileDataQuery {
    stockpileId?: string;
    limit?: number;
}

export interface StockpileWithLatestVolume extends StockpileAsset {
    volume_m3?: number;
    tonnage_t?: number;
    latestMeasurement?: StockpileMeasurement;
}

/**
 * Hook para consumo de datos de Stockpile Control sobre la base de datos única de MINREPORT.
 */
export function useStockpileData(query: StockpileDataQuery = {}) {
    const [data, setData] = useState<StockpileWithLatestVolume[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const allAssets = await dataService.getAllAssets();
            const filteredAssets = query.stockpileId
                ? allAssets.filter(a => a.id === query.stockpileId)
                : allAssets.slice(0, query.limit || 50);

            const enriched: StockpileWithLatestVolume[] = await Promise.all(
                filteredAssets.map(async (asset) => {
                    const measurements = await dataService.getMeasurements(asset.id);
                    const latest = measurements[0];
                    return {
                        ...asset,
                        volume_m3: latest?.volumen_m3 ?? asset.last_volume_m3 ?? 0,
                        tonnage_t: latest?.peso_t ?? asset.last_weight_t ?? 0,
                        latestMeasurement: latest
                    };
                })
            );

            setData(enriched);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Error consultando activos de Stockpile Control'));
        } finally {
            setLoading(false);
        }
    }, [query.stockpileId, query.limit]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    /**
     * Consulta directa del último volumen registrado de un activo específico
     */
    const getLatestVolume = useCallback(async (stockpileId: string): Promise<number> => {
        const measurements = await dataService.getMeasurements(stockpileId);
        if (measurements.length > 0) {
            return measurements[0].volumen_m3 || 0;
        }
        return 0;
    }, []);

    return {
        data,
        loading,
        error,
        getLatestVolume,
        refresh: fetchData,
    };
}
