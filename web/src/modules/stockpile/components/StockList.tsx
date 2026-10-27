import React, { useState, useEffect } from 'react';
import { dataService } from '../services/DataService';
import type { StockpileAsset } from '../types/StockpileAsset';
import { motion, AnimatePresence } from 'framer-motion';

interface StockListProps {
    onSelectAsset: (assetId: string) => void;
    onBack: () => void;
}

/**
 * StockList - Gestión de Activos Registrados
 * Cumple GEMINI.md: Minimalismo Industrial Puro, soporte dual light/dark, tabular-nums, rounded-none, shadow-none.
 */
export const StockList: React.FC<StockListProps> = ({ onSelectAsset, onBack }) => {
    const [assets, setAssets] = useState<StockpileAsset[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let mounted = true;

        unsubscribe = dataService.subscribeToAllAssets((data) => {
            if (mounted) {
                setAssets([...data].sort((a, b) => b.createdAt - a.createdAt));
                setLoading(false);
            }
        });

        return () => {
            mounted = false;
            if (unsubscribe) unsubscribe();
        };
    }, []);

    const getClaseColor = (clase: string) => {
        switch (clase) {
            case 'mineral': return 'text-antigravity-accent';
            case 'esteril': return 'text-[#475569] dark:text-[#8A93A6]';
            case 'baja_ley': return 'text-[#00AEEF]';
            default: return 'text-[#475569] dark:text-[#8A93A6]';
        }
    };

    return (
        <main className="h-full w-full flex-1 min-h-[540px] bg-white dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none">
            <header className="pt-8 pb-4 px-6 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between z-40">
                <div className="flex flex-col">
                    <h1 className="text-[10px] font-bold tracking-[0.4em] uppercase text-[#475569] dark:text-[#8A93A6]">GESTIÓN</h1>
                    <h2 className="text-lg font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">Inventario de Acopios</h2>
                </div>
                <button
                    type="button"
                    onClick={onBack}
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    title="Volver"
                >
                    <span className="material-symbols-outlined text-2xl text-antigravity-accent">arrow_back</span>
                </button>
            </header>

            <section className="flex-1 overflow-y-auto p-6 space-y-3 hide-scrollbar max-w-[1000px] w-full mx-auto">
                {loading ? (
                    <div className="h-64 flex flex-col items-center justify-center space-y-4 opacity-40">
                        <span className="material-symbols-outlined animate-spin text-4xl text-antigravity-accent">sync</span>
                        <span className="text-[10px] font-bold tracking-widest uppercase">Sincronizando inventario...</span>
                    </div>
                ) : assets.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center space-y-4 opacity-40">
                        <span className="material-symbols-outlined text-5xl">inventory_2</span>
                        <span className="text-[10px] font-bold tracking-widest uppercase">[Pendiente de registro]</span>
                    </div>
                ) : (
                    <AnimatePresence>
                        {assets.map((asset, index) => (
                            <motion.div
                                key={asset.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                onClick={() => onSelectAsset(asset.id)}
                                className="w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] rounded-none shadow-none p-4 flex items-center gap-4 transition-all cursor-pointer"
                            >
                                <div className="w-12 h-12 rounded-none bg-black/10 dark:bg-black/40 border border-[#E2E8F0] dark:border-[#12151C] overflow-hidden flex items-center justify-center shrink-0">
                                    {(asset.thumbnail_url || asset.last_photo_url || asset.initial_photo_url) ? (
                                        <img
                                            src={asset.thumbnail_url || asset.last_photo_url || asset.initial_photo_url}
                                            draggable={false}
                                            className="w-full h-full object-cover select-none pointer-events-none"
                                            alt={asset.name}
                                        />
                                    ) : (
                                        <span className="material-symbols-outlined text-slate-400">landscape</span>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <h3 className="text-sm font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] truncate uppercase">{asset.name}</h3>
                                        <span className={`text-[10px] font-black font-mono uppercase tracking-[0.2em] ${getClaseColor(asset.clase || '')}`}>
                                            {(asset.clase || '').replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        <span className="truncate">{asset.location_ref || '[Información técnica no declarada en ficha]'}</span>
                                        <span>{new Date(asset.last_measured_at || asset.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                    <span className="material-symbols-outlined text-antigravity-accent text-lg">chevron_right</span>
                                    {typeof asset.last_volume_m3 === 'number' && (
                                        <div className="flex items-center gap-1 bg-antigravity-accent/10 px-2 py-0.5 rounded-none border border-antigravity-accent/20">
                                            <span className="text-[11px] font-black font-mono tabular-nums tracking-wider text-antigravity-accent uppercase">
                                                {asset.last_volume_m3.toFixed(1)} m³
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </section>

            <footer className="px-6 py-4 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex justify-between items-center">
                <span className="text-[10px] font-black font-mono tabular-nums tracking-[0.3em] text-[#475569] dark:text-[#8A93A6] uppercase">
                    TOTAL ACTIVOS: {assets.length}
                </span>
            </footer>
        </main>
    );
};
