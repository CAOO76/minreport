import React from 'react';
import { type StockpileData } from '../services/DataService';


interface ResultsDashboardProps {
    stockpileData: StockpileData;
    onNewScan: () => void;
}

/**
 * ResultsDashboard - Vista de Resultados Móvil
 * Diseño: Stitch Industrial Mining
 * Funcionalidades: Visualización de datos, evidencia fotográfica, métricas
 */
export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({ stockpileData, onNewScan }) => {
    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${date.getDate()} ${date.toLocaleString('es', { month: 'short' }).toUpperCase()}, ${date.getFullYear()} • ${date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
    };

    const formatCoords = (lat: number, lng: number) => {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(3)}° ${latDir}, ${Math.abs(lng).toFixed(3)}° ${lngDir}`;
    };

    return (
        <div className="font-atkinson antialiased min-h-screen flex flex-col bg-black text-white overflow-x-hidden select-none">
            {/* Unified Branding Header - Orientation Aware */}
            <header className="relative z-40 pt-16 pb-8 landscape:pt-6 landscape:pb-4 flex flex-col items-center border-b border-white/5 transition-all">
                <span className="material-symbols-outlined text-primary text-5xl landscape:text-3xl mb-2 transition-all">landscape</span>
                <h1 className="text-[10px] font-bold tracking-[0.5em] uppercase text-white/80 landscape:text-[8px]">STOCKPILE-CONTROL</h1>
            </header>

            {/* Main Content - Adaptive Grid Display */}
            <main className="flex-1 pb-40 px-6 landscape:px-12 grid grid-cols-1 landscape:grid-cols-2 landscape:gap-x-16">

                {/* Left Column Area (Portrait: Top / Landscape: Left) */}
                <div className="flex flex-col">
                    {/* Metric Display: Volume */}
                    <section className="py-10 landscape:py-16">
                        <div className="flex flex-col items-center landscape:items-start text-center landscape:text-left transition-all">
                            <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.3em] mb-4">Cálculo de Volumen</p>
                            <h2 className="text-8xl landscape:text-7xl font-bold text-primary tracking-tighter flex items-baseline leading-none">
                                {stockpileData.volumen?.toFixed(0).toLocaleString() || '0'}
                                <span className="text-xl font-normal text-white/40 ml-3">M³</span>
                            </h2>
                        </div>

                        <div className="mt-12 flex items-center justify-around landscape:justify-between border-y border-white/5 py-8 landscape:py-6">
                            <div className="flex flex-col items-center landscape:items-start">
                                <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest mb-1">Masa Est.</span>
                                <span className="text-2xl font-bold text-white/90">{stockpileData.weight_t?.toFixed(1) || '0.0'} T</span>
                            </div>
                            <div className="w-[1px] h-10 bg-white/10 mx-4"></div>
                            <div className="flex flex-col items-center landscape:items-start">
                                <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest mb-1">Factor</span>
                                <span className="text-2xl font-bold text-white/90">{stockpileData.density_factor || '---'}</span>
                            </div>
                        </div>
                    </section>

                    {/* Technical Data List */}
                    <section className="space-y-6">
                        <div className="flex justify-between items-center py-5 border-b border-white/5">
                            <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">Coordenadas</span>
                            <span className="text-xs font-bold text-white/80 font-mono">
                                {stockpileData.location ? formatCoords(stockpileData.location.lat, stockpileData.location.lng) : '---'}
                            </span>
                        </div>

                        <div className="flex justify-between items-center py-5 border-b border-white/5">
                            <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">Geometría</span>
                            <span className="text-xs font-bold text-white/80 uppercase tracking-widest">
                                {stockpileData.geometria?.replace('_', ' ') || 'CONO ELÍPTICO'}
                            </span>
                        </div>
                    </section>
                </div>

                {/* Right Column Area (Portrait: Bottom / Landscape: Right) */}
                <div className="flex flex-col">
                    {/* Visual Evidence */}
                    <section className="mt-12 landscape:mt-16">
                        <div className="mb-4 flex items-center space-x-4">
                            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/20">Evidencia Visual</h3>
                            <div className="h-[1px] flex-1 bg-white/5"></div>
                        </div>
                        <div className="flex overflow-x-auto gap-4 snap-x snap-mandatory hide-scrollbar pb-4">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex-none w-72 h-48 landscape:w-64 landscape:h-40 snap-center rounded-none overflow-hidden bg-white/5 border border-white/10">
                                    <img
                                        alt={`Vista de acopio ${i}`}
                                        className="w-full h-full object-cover opacity-60 mix-blend-luminosity hover:opacity-100 transition-opacity"
                                        src="https://lh3.googleusercontent.com/aida-public/AB6AXuBSM4kHjj8PxMOH42LmgRWaS6Ex-cTsVW6b6Ue6u_d4SoQ7yK5xb-IhXCEKyyKW672fZPKT5pgbdlQ1E_4-ZHXu2GhW41l9MmdZsClblADVLPyl_LmbXTd07qvL_-WcqsFVTlvUAzcRAYG119Qnq36G8rldwONNyfoszBuDjCNwIgLa9Y-rJbQr1cXzPtGQb92ds5CVFgWV9dRGvr2FZJEnI1cN98n4hE4A_mC-ycG7qX0x8HP5jqB8P9pn8Cfns5XZ2cVitY4i8KdR"
                                    />
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Meta Details */}
                    <section className="mt-12 space-y-2 opacity-40">
                        <div className="flex justify-between items-center py-3">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/50">ID Registro</span>
                            <span className="text-[10px] font-bold tracking-widest">
                                STK-{stockpileData.timestamp?.toString().slice(-6) || '000000'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center py-3">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/50">Timestamp</span>
                            <span className="text-[10px] font-bold truncate">
                                {stockpileData.timestamp ? formatDate(stockpileData.timestamp) : 'N/A'}
                            </span>
                        </div>
                    </section>
                </div>
            </main>

            {/* Bottom Floating Navigation (Orientation Aware) */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-t border-white/5 pb-10 landscape:pb-4 transition-all">
                <div className="flex justify-around items-center h-20 px-8 max-w-lg mx-auto">
                    {/* Main FAB (Industrial 80px target) */}
                    <button
                        onClick={onNewScan}
                        className="w-20 h-20 landscape:w-16 landscape:h-16 bg-primary text-black rounded-none flex items-center justify-center -translate-y-8 landscape:-translate-y-4 shadow-[0_0_30px_rgba(255,176,0,0.5)] active:scale-90 transition-all overflow-hidden"
                    >
                        <span className="material-symbols-outlined text-[40px] font-black leading-none">add</span>
                    </button>

                    <button className="flex flex-col items-center space-y-1 text-primary active:bg-primary/5 w-16 h-16 justify-center rounded-none transition-all overflow-hidden">
                        <span className="material-symbols-outlined text-[32px]">analytics</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest opacity-0 scale-0 landscape:opacity-100 landscape:scale-100 transition-all">Reporte</span>
                    </button>
                </div>
            </nav>
        </div>
    );
};
