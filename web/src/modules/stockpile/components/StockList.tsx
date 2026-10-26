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
 * Diseño: STITCH Industrial Extreme Minimalism
 */
export const StockList: React.FC<StockListProps> = ({ onSelectAsset, onBack }) => {
    const [assets, setAssets] = useState<StockpileAsset[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let mounted = true;

        const init = () => {
            unsubscribe = dataService.subscribeToAllAssets((data) => {
                if (mounted) {
                    // Ordenar por fecha de creación descendente
                    setAssets(data.sort((a, b) => b.createdAt - a.createdAt));
                    setLoading(false);
                }
            });
        };

        init();

        return () => {
            mounted = false;
            if (unsubscribe) unsubscribe();
        };
    }, []);

    const getClaseColor = (clase: string) => {
        switch (clase) {
            case 'mineral': return 'text-primary';
            case 'esteril': return 'text-white/40';
            case 'baja_ley': return 'text-antigravity-accent';
            default: return 'text-white/20';
        }
    };

    return (
        <main className="h-screen w-screen bg-black flex flex-col font-atkinson text-white overflow-hidden select-none">
            {/* Header STITCH */}
            <header className="pt-14 pb-4 px-6 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between z-50">
                <div className="flex flex-col">
                    <h1 className="text-[10px] font-bold tracking-[0.4em] uppercase text-white/30">GESTIÓN</h1>
                    <h2 className="text-lg font-bold tracking-tight text-white/90">Inventario Stock</h2>
                </div>
                <button
                    onClick={onBack}
                    className="w-12 h-12 rounded-none bg-white/5 flex items-center justify-center active:scale-90 transition-all border border-white/5"
                >
                    <span className="material-symbols-outlined text-primary">arrow_back</span>
                </button>
            </header>

            {/* List Container */}
            <section className="flex-1 overflow-y-auto p-4 space-y-2 hide-scrollbar">
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                        <span className="material-symbols-outlined animate-spin text-4xl">sync</span>
                        <span className="text-[10px] font-bold tracking-widest uppercase">Sincronizando...</span>
                    </div>
                ) : assets.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                        <span className="material-symbols-outlined text-6xl">inventory_2</span>
                        <span className="text-[10px] font-bold tracking-widest uppercase">Sin registros</span>
                    </div>
                ) : (
                    <AnimatePresence>
                        {assets.map((asset, index) => (
                            <motion.div
                                key={asset.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                onClick={() => onSelectAsset(asset.id)}
                                className="w-full bg-white/5 border border-white/5 rounded-none p-4 flex items-center gap-4 active:bg-white/10 transition-all"
                            >
                                {/* Visual Proxy or Photo */}
                                <div className="w-12 h-12 rounded-none bg-black/40 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                    {(asset.thumbnail_url || asset.last_photo_url || asset.initial_photo_url) ? (
                                        <img
                                            src={asset.thumbnail_url || asset.last_photo_url || asset.initial_photo_url}
                                            className="w-full h-full object-cover"
                                            alt={asset.name}
                                        />
                                    ) : (
                                        <span className="material-symbols-outlined text-white/10">landscape</span>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <h3 className="text-sm font-bold tracking-tight text-white/90 truncate uppercase">{asset.name}</h3>
                                        <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${getClaseColor(asset.clase || '')}`}>
                                            {(asset.clase || '').replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] text-white/30 font-medium">
                                        <span className="truncate">{asset.location_ref || 'Sin ubicación'}</span>
                                        <span>{new Date(asset.last_measured_at || asset.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                    <span className="material-symbols-outlined text-primary/40 text-lg">chevron_right</span>
                                    {asset.last_volume_m3 && (
                                        <div className="flex items-center gap-1 bg-primary/10 px-1.5 py-0.5 rounded-none border border-primary/5">
                                            <span className="text-[10px] font-black tracking-widest text-primary uppercase">{asset.last_volume_m3.toFixed(0)}m³</span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </section>

            {/* Industrial Footer HUD */}
            <footer className="p-6 bg-gradient-to-t from-black to-transparent flex justify-between items-center">
                <span className="text-[10px] font-black tracking-[0.4em] text-white/10 uppercase">Total: {assets.length} activos</span>
                <div className="flex gap-2">
                    <div className="w-1 h-1 rounded-none bg-green-500/40 animate-pulse"></div>
                    <div className="w-1 h-1 rounded-none bg-white/5"></div>
                    <div className="w-1 h-1 rounded-none bg-white/5"></div>
                </div>
            </footer>
        </main>
    );
};
