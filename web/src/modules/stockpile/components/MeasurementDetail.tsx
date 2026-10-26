import React, { useState, useEffect } from 'react';
import type { StockpileMeasurement } from '../types/StockpileAsset';
import { dataService } from '../services/DataService';

interface MeasurementDetailProps {
    measurement?: StockpileMeasurement;
    measurementId?: string;
    onBack?: () => void;
}

/**
 * MeasurementDetail - DOSSIER TÉCNICO DE TRAZABILIDAD
 * Estándar: Elite Industrial Minimalism (Blueprint Mode)
 * Soporta carga directa via objeto (Desktop) o diferida via ID (Mobile).
 */
export const MeasurementDetail: React.FC<MeasurementDetailProps> = ({ measurement: initialMeasurement, measurementId, onBack }) => {
    const [measurement, setMeasurement] = useState<StockpileMeasurement | null>(initialMeasurement || null);
    const [loading, setLoading] = useState(!initialMeasurement && !!measurementId);
    
    const apiKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;

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
            <div className="flex-1 bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex items-center justify-center">
                <div className="text-[10px] font-black opacity-20 uppercase animate-pulse text-antigravity-light-text dark:text-antigravity-dark-text">CARGANDO_DOSSIER...</div>
            </div>
        );
    }

    if (!measurement) return null;

    const date = new Date(measurement.timestamp);

    return (
        <div className="flex-1 bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col select-none antialiased animate-in fade-in slide-in-from-left-4 duration-200 overflow-y-auto scrollbar-none text-antigravity-light-text dark:text-antigravity-dark-text">
            {/* TOP BAR: TECHNICAL IDENTIFIER */}
            <div className="h-14 border-b border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-between px-6 bg-antigravity-light-surface dark:bg-antigravity-dark-surface sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <button 
                            onClick={onBack}
                            className="mr-2 p-2 -ml-2 hover:bg-antigravity-accent/10 rounded-full transition-colors active:scale-95"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-antigravity-accent">
                                <path d="M19 12H5M12 19l-7-7 7-7"/>
                            </svg>
                        </button>
                    )}
                    <span className="text-[12px] font-black opacity-30 uppercase tracking-widest mr-2 text-antigravity-light-text dark:text-antigravity-dark-text">ID_DOSSIER</span>
                    <span className="text-sm font-mono font-bold text-antigravity-accent tracking-tighter">
                        {measurement.id.toUpperCase()}
                    </span>
                </div>
            </div>

            <div className="flex-1 flex flex-col">
                
                {/* SECTION A: VISUAL EVIDENCE (BINARIA - HORIZONTAL) */}
                <div className="border-b border-antigravity-light-border dark:border-antigravity-dark-border grid grid-cols-2 h-48 bg-antigravity-light-surface dark:bg-antigravity-dark-surface">
                    <div className="border-r border-antigravity-light-border dark:border-antigravity-dark-border relative overflow-hidden group">
                        <img 
                            src={measurement.photo_url} 
                            className="w-full h-full object-cover grayscale brightness-75 hover:grayscale-0 hover:brightness-100 transition-all duration-300" 
                            alt=""
                        />
                        <div className="absolute bottom-2 left-3 z-10 shadow-sm">
                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] bg-antigravity-accent px-2 py-0.5">VISTA_TERRENO</span>
                        </div>
                    </div>
                    <div className="relative overflow-hidden group bg-black">
                        {apiKey && measurement.location_metadata ? (
                            <img 
                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${measurement.location_metadata.lat},${measurement.location_metadata.lng}&zoom=18&size=400x400&maptype=satellite&scale=2&markers=color:0xC68346%7C${measurement.location_metadata.lat},${measurement.location_metadata.lng}&key=${apiKey}`}
                                className="w-full h-full object-cover opacity-60 grayscale hover:opacity-100 transition-all duration-300"
                                alt=""
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900/50">
                                <span className="text-[10px] font-mono opacity-20 text-white">GPS_OFFLINE</span>
                            </div>
                        )}
                        <div className="absolute bottom-2 right-3 z-10 text-right shadow-sm">
                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] bg-antigravity-accent px-2 py-0.5">GEORREFERENCIA</span>
                        </div>
                    </div>
                </div>
                
                {/* GPS COORDINATES STRIP (RE-ESTANDARIZADO - GRID) */}
                <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border px-6 py-4 grid grid-cols-3 gap-2">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.1em] leading-none mb-1.5 text-antigravity-light-text/50 dark:text-antigravity-dark-text/30">LATITUD</span>
                        <span className="text-[13px] font-bold font-mono text-antigravity-light-text dark:text-antigravity-dark-text tabular-nums truncate">
                            {measurement.location_metadata?.lat.toFixed(6) || '0.000000'}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.1em] leading-none mb-1.5 text-antigravity-light-text/50 dark:text-antigravity-dark-text/30">LONGITUD</span>
                        <span className="text-[13px] font-bold font-mono text-antigravity-light-text dark:text-antigravity-dark-text tabular-nums truncate">
                            {measurement.location_metadata?.lng.toFixed(6) || '0.000000'}
                        </span>
                    </div>
                    <div className="flex flex-col text-right">
                        <span className="text-[10px] font-black uppercase tracking-[0.1em] leading-none mb-1.5 text-antigravity-light-text/50 dark:text-antigravity-dark-text/30">PRECISIÓN_H</span>
                        <span className="text-[13px] font-bold font-mono text-antigravity-accent tabular-nums truncate">
                            ±{measurement.location_metadata?.accuracy.toFixed(1)}M
                        </span>
                    </div>
                </div>

                {/* SECTION B: ANALYTICAL DATA */}
                <div className="flex flex-col bg-antigravity-light-bg dark:bg-antigravity-dark-bg">
                    
                    {/* VOLUMETRY BLOCK (DUAL KPI) */}
                    <div className="p-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border bg-gradient-to-br from-antigravity-accent/[0.05] dark:from-antigravity-accent/10 to-transparent grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[12px] font-black text-antigravity-accent block mb-2 tracking-[0.3em] uppercase">VOLUMEN_M3</label>
                            <div className="text-4xl font-black font-mono tracking-tighter text-antigravity-light-text dark:text-antigravity-dark-text leading-none">
                                {measurement.volumen_m3.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span className="text-sm text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 font-sans tracking-normal ml-1">m³</span>
                            </div>
                        </div>
                        <div className="border-l border-antigravity-light-border dark:border-antigravity-dark-border pl-4">
                            <label className="text-[12px] font-black text-antigravity-accent block mb-2 tracking-[0.3em] uppercase">PESO_TON</label>
                            <div className="text-4xl font-black font-mono tracking-tighter text-antigravity-light-text dark:text-antigravity-dark-text leading-none">
                                {measurement.peso_t.toLocaleString('es-CL', { maximumFractionDigits: 0 })} <span className="text-sm text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 font-sans tracking-normal ml-1">t</span>
                            </div>
                        </div>
                    </div>

                    {/* METADATA BLOCK (COMPACT) */}
                    <div className="p-6 grid grid-cols-2 gap-x-6 gap-y-6">
                        <div>
                            <label className="text-[12px] font-black text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 block mb-1 tracking-[0.2em] uppercase">FECHA</label>
                            <div className="text-base font-black font-mono uppercase text-antigravity-light-text dark:text-antigravity-dark-text">
                                {date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </div>
                        </div>
                        <div>
                            <label className="text-[12px] font-black text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 block mb-1 tracking-[0.2em] uppercase">HORA</label>
                            <div className="text-base font-black font-mono uppercase text-antigravity-light-text dark:text-antigravity-dark-text opacity-90">
                                {date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                        </div>
                        <div>
                            <label className="text-[12px] font-black text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 block mb-1 tracking-[0.2em] uppercase">OPERADOR</label>
                            <div className="text-base font-black font-mono uppercase text-antigravity-accent">
                                @{measurement.user_id?.toUpperCase() || 'SYS_ENGINE'}
                            </div>
                        </div>
                        <div>
                            <label className="text-[12px] font-black text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 block mb-1 tracking-[0.2em] uppercase">MÉTODO</label>
                            <div className="text-sm font-black font-mono uppercase opacity-50 text-antigravity-light-text dark:text-antigravity-dark-text">
                                [{measurement.method}]
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
