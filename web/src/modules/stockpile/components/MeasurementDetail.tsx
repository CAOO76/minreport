import React, { useState, useEffect } from 'react';
import type { StockpileMeasurement } from '../types/StockpileAsset';
import { dataService } from '../services/DataService';
import { useResolvedStockpileImage } from '../services/StorageService';

interface MeasurementDetailProps {
    measurement?: StockpileMeasurement;
    measurementId?: string;
    onBack?: () => void;
}

/**
 * MeasurementDetail - DOSSIER TÉCNICO DE TRAZABILIDAD
 * Estándar: Minimalismo Industrial Puro (GEMINI.md §3.1)
 * Cero coordenadas 0.000000 ni operadores inventados.
 */
export const MeasurementDetail: React.FC<MeasurementDetailProps> = ({ measurement: initialMeasurement, measurementId, onBack }) => {
    const [measurement, setMeasurement] = useState<StockpileMeasurement | null>(initialMeasurement || null);
    const [loading, setLoading] = useState(!initialMeasurement && !!measurementId);

    const apiKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;
    const resolvedPhotoUrl = useResolvedStockpileImage(measurement?.photo_url);

    useEffect(() => {
        if (initialMeasurement) {
            setMeasurement(initialMeasurement);
            setLoading(false);
        }
    }, [initialMeasurement]);

    useEffect(() => {
        if (!initialMeasurement && measurementId) {
            setLoading(true);
            dataService.getMeasurement(measurementId).then(m => {
                setMeasurement(m);
                setLoading(false);
            });
        }
    }, [measurementId, initialMeasurement]);

    if (loading) {
        return (
            <div className="flex-1 bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center">
                <div className="text-[11px] font-bold uppercase animate-pulse text-[#475569] dark:text-[#8A93A6]">CARGANDO DOSSIER...</div>
            </div>
        );
    }

    if (!measurement) return null;

    const date = new Date(measurement.timestamp);
    const hasLocation =
        Boolean(measurement.location_metadata) &&
        typeof measurement.location_metadata?.lat === 'number' &&
        typeof measurement.location_metadata?.lng === 'number';

    return (
        <div className="flex-1 bg-[#FFFFFF] dark:bg-[#000000] flex flex-col select-none antialiased overflow-y-auto scrollbar-none text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none">
            {/* TOP BAR: TECHNICAL IDENTIFIER */}
            <div className="h-14 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between px-[21px] bg-[#F8FAFC] dark:bg-[#07090D] sticky top-0 z-10">
                <div className="flex items-center gap-[13px]">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
                            title="Volver"
                            aria-label="Volver"
                        >
                            <span className="material-symbols-outlined text-xl text-[#C68346]">arrow_back</span>
                        </button>
                    )}
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">ID DOSSIER</span>
                    <span className="text-sm font-mono font-bold text-[#C68346] tracking-tight tabular-nums select-text">
                        {measurement.id.toUpperCase()}
                    </span>
                </div>
            </div>

            <div className="flex-1 flex flex-col">
                {/* SECTION A: VISUAL EVIDENCE */}
                <div className="border-b border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-2 h-48 bg-[#F8FAFC] dark:bg-[#07090D]">
                    <div className="border-r border-[#E2E8F0] dark:border-[#12151C] relative overflow-hidden group bg-[#000000]">
                        {resolvedPhotoUrl ? (
                            <img
                                src={resolvedPhotoUrl}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                className="w-full h-full object-cover grayscale brightness-90 hover:grayscale-0 hover:brightness-100 transition-all duration-300 select-none pointer-events-none"
                                alt="Evidencia terreno"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center p-3 text-center">
                                <span className="text-[10px] font-mono text-[#94A3B8] dark:text-[#5A6072]">[Información técnica no declarada en ficha]</span>
                            </div>
                        )}
                        <div className="absolute bottom-2 left-3 z-10 shadow-none">
                            <span className="text-[10px] font-bold text-[#FFFFFF] uppercase tracking-[0.15em] bg-[#C68346] px-[8px] py-0.5 rounded-none">VISTA TERRENO</span>
                        </div>
                    </div>
                    <div className="relative overflow-hidden group bg-[#F8FAFC] dark:bg-[#07090D]">
                        {apiKey && hasLocation && measurement.location_metadata ? (
                            <img
                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${measurement.location_metadata.lat},${measurement.location_metadata.lng}&zoom=18&size=400x400&maptype=satellite&scale=2&markers=color:0xC68346%7C${measurement.location_metadata.lat},${measurement.location_metadata.lng}&key=${apiKey}`}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                className="w-full h-full object-cover opacity-75 grayscale hover:opacity-100 transition-all duration-300 select-none pointer-events-none"
                                alt="Georreferencia"
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-[#F8FAFC] dark:bg-[#07090D]">
                                <span className="text-[10px] font-mono text-[#94A3B8] dark:text-[#5A6072]">[Información técnica no declarada en ficha]</span>
                            </div>
                        )}
                        <div className="absolute bottom-2 right-3 z-10 text-right shadow-none">
                            <span className="text-[10px] font-bold text-[#FFFFFF] uppercase tracking-[0.15em] bg-[#C68346] px-[8px] py-0.5 rounded-none">GEORREFERENCIA</span>
                        </div>
                    </div>
                </div>

                {/* GPS COORDINATES STRIP */}
                <div className="bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] px-[21px] py-[13px] grid grid-cols-3 gap-[13px]">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] leading-none mb-1.5 text-[#475569] dark:text-[#8A93A6]">LATITUD</span>
                        <span className="text-[12px] font-bold font-mono text-[#0F172A] dark:text-[#F3F4F6] tabular-nums truncate">
                            {hasLocation && measurement.location_metadata
                                ? measurement.location_metadata.lat.toFixed(6)
                                : '[Información técnica no declarada en ficha]'}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] leading-none mb-1.5 text-[#475569] dark:text-[#8A93A6]">LONGITUD</span>
                        <span className="text-[12px] font-bold font-mono text-[#0F172A] dark:text-[#F3F4F6] tabular-nums truncate">
                            {hasLocation && measurement.location_metadata
                                ? measurement.location_metadata.lng.toFixed(6)
                                : '[Información técnica no declarada en ficha]'}
                        </span>
                    </div>
                    <div className="flex flex-col text-right">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] leading-none mb-1.5 text-[#475569] dark:text-[#8A93A6]">PRECISIÓN H</span>
                        <span className="text-[12px] font-bold font-mono text-[#C68346] tabular-nums truncate">
                            {hasLocation && measurement.location_metadata && typeof measurement.location_metadata.accuracy === 'number'
                                ? `±${measurement.location_metadata.accuracy.toFixed(1)} m`
                                : '[Información técnica no declarada en ficha]'}
                        </span>
                    </div>
                </div>

                {/* SECTION B: ANALYTICAL DATA */}
                <div className="flex flex-col bg-[#FFFFFF] dark:bg-[#000000]">
                    {/* VOLUMETRY BLOCK */}
                    <div className="p-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] grid grid-cols-2 gap-[13px]">
                        <div>
                            <label className="text-[11px] font-bold text-[#C68346] block mb-2 tracking-[0.2em] uppercase">VOLUMEN M³</label>
                            <div className="text-3xl font-bold font-mono tabular-nums tracking-tight text-[#0F172A] dark:text-[#F3F4F6] leading-none">
                                {measurement.volumen_m3.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                <span className="text-sm text-[#475569] dark:text-[#8A93A6] tracking-normal ml-1">m³</span>
                            </div>
                        </div>
                        <div className="border-l border-[#E2E8F0] dark:border-[#12151C] pl-[13px]">
                            <label className="text-[11px] font-bold text-[#C68346] block mb-2 tracking-[0.2em] uppercase">PESO TON</label>
                            <div className="text-3xl font-bold font-mono tabular-nums tracking-tight text-[#0F172A] dark:text-[#F3F4F6] leading-none">
                                {measurement.peso_t.toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                                <span className="text-sm text-[#475569] dark:text-[#8A93A6] tracking-normal ml-1">t</span>
                            </div>
                        </div>
                    </div>

                    {/* METADATA BLOCK */}
                    <div className="p-[21px] grid grid-cols-2 gap-x-[21px] gap-y-[21px]">
                        <div>
                            <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] block mb-1 tracking-[0.2em] uppercase">FECHA</label>
                            <div className="text-sm font-bold font-mono tabular-nums uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                {date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </div>
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] block mb-1 tracking-[0.2em] uppercase">HORA</label>
                            <div className="text-sm font-bold font-mono tabular-nums uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                {date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] block mb-1 tracking-[0.2em] uppercase">OPERADOR</label>
                            <div className="text-xs font-bold font-mono uppercase text-[#C68346] break-all">
                                {measurement.user_id && measurement.user_id.trim()
                                    ? measurement.user_id.toUpperCase()
                                    : '[Información técnica no declarada en ficha]'}
                            </div>
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] block mb-1 tracking-[0.2em] uppercase">MÉTODO</label>
                            <div className="text-xs font-bold font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {measurement.method}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
