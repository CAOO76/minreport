/**
 * useStockpileData Hook
 * Hook de interoperabilidad que permite a otros plugins consultar datos de volumetría.
 */

import { useState, useEffect } from 'react';
import { MinReport } from '../services/sdk-mock';
import type { StockpileAsset } from '../types/StockpileAsset';

export interface StockpileDataQuery {
    stockpileId?: string;
    limit?: number;
}

/**
 * Hook para consumo de datos de Stockpile Control
 * Cumple con el requisito de interoperabilidad (Punto 5 del motor).
 */
export function useStockpileData(query: StockpileDataQuery = {}) {
    const [data, setData] = useState<StockpileAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const EXTENSION_NAME = 'stockpile-control';

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);

                // Usamos el EntityManager del SDK para consultar datos de nuestra extensión
                const results = await MinReport.EntityManager.queryEntities({
                    extension: EXTENSION_NAME,
                    filters: query.stockpileId ? { id: query.stockpileId } : {},
                    limit: query.limit || 10
                });

                setData(results as StockpileAsset[]);
            } catch (err) {
                setError(err instanceof Error ? err : new Error('Error desconocido'));
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // Si hay un ID específico, nos suscribimos a los cambios
        let unsubscribe: (() => void) | undefined;
        if (query.stockpileId) {
            unsubscribe = MinReport.EntityManager.subscribeToEntity(
                EXTENSION_NAME,
                query.stockpileId,
                (newData: any) => {
                    setData([newData as StockpileAsset]);
                }
            );
        }

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [query.stockpileId, query.limit]);

    /**
     * Consulta directa del último volumen registrado de un activo específico
     */
    const getLatestVolume = async (stockpileId: string): Promise<number> => {
        const results = await MinReport.EntityManager.queryEntities({
            extension: EXTENSION_NAME,
            filters: { id: stockpileId },
            limit: 1
        });

        if (results.length > 0) {
            return (results[0] as StockpileAsset).volume_m3 || 0;
        }
        return 0;
    };

    return {
        data,
        loading,
        error,
        getLatestVolume,
        refresh: () => setLoading(true), // Simplemente dispara el useEffect
    };
}
