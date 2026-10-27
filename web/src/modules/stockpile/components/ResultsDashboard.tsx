import React from 'react';
import { type StockpileData } from '../services/DataService';

interface ResultsDashboardProps {
    stockpileData: StockpileData;
    onNewScan: () => void;
}

/**
 * ResultsDashboard - Vista de Resultados
 * Cumple GEMINI.md: Minimalismo Industrial Puro, soporte dual light/dark, rounded-none, shadow-none.
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
        <div className="font-atkinson antialiased min-h-full flex-1 flex flex-col bg-white dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-x-hidden select-none rounded-none shadow-none">
            <header className="relative z-40 pt-12 pb-6 flex flex-col items-center border-b border-[#E2E8F0] dark:border-[#12151C] transition-all">
                <span className="material-symbols-outlined text-[#C68346] text-4xl mb-2">landscape</span>
                <h1 className="text-[10px] font-bold tracking-[0.5em] uppercase text-[#475569] dark:text-[#8A93A6]">STOCKPILE-CONTROL</h1>
            </header>

            <main className="flex-1 pb-32 px-6 grid grid-cols-1 landscape:grid-cols-2 landscape:gap-x-16">
                <div className="flex flex-col">
                    <section className="py-10">
                        <div className="flex flex-col items-center landscape:items-start text-center landscape:text-left">
                            <p className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.3em] mb-4">Cálculo de Volumen</p>
                            <h2 className="text-6xl font-bold font-mono tabular-nums text-[#C68346] tracking-tighter flex items-baseline leading-none">
                                {stockpileData.volumen?.toFixed(0).toLocaleString() || '0'}
                                <span className="text-xl font-normal text-[#475569] dark:text-[#8A93A6] ml-3">M³</span>
                            </h2>
                        </div>

                        <div className="mt-10 flex items-center justify-around landscape:justify-between border-y border-[#E2E8F0] dark:border-[#12151C] py-6 font-mono tabular-nums">
                            <div className="flex flex-col items-center landscape:items-start">
                                <span className="text-[9px] text-[#475569] dark:text-[#8A93A6] font-bold uppercase tracking-widest mb-1">Masa Est.</span>
                                <span className="text-2xl font-bold">{stockpileData.weight_t?.toFixed(1) || '0.0'} T</span>
                            </div>
                            <div className="w-[1px] h-10 bg-[#E2E8F0] dark:bg-[#12151C] mx-4"></div>
                            <div className="flex flex-col items-center landscape:items-start">
                                <span className="text-[9px] text-[#475569] dark:text-[#8A93A6] font-bold uppercase tracking-widest mb-1">Factor</span>
                                <span className="text-2xl font-bold">{stockpileData.density_factor || '---'}</span>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="flex justify-between items-center py-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.2em]">Coordenadas</span>
                            <span className="text-xs font-bold font-mono tabular-nums">
                                {stockpileData.location ? formatCoords(stockpileData.location.lat, stockpileData.location.lng) : '[Información técnica no declarada en ficha]'}
                            </span>
                        </div>

                        <div className="flex justify-between items-center py-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.2em]">Geometría</span>
                            <span className="text-xs font-bold uppercase tracking-widest">
                                {stockpileData.geometria?.replace('_', ' ') || 'CONO ELÍPTICO'}
                            </span>
                        </div>
                    </section>
                </div>

                <div className="flex flex-col">
                    <section className="mt-10 space-y-2 text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                        <div className="flex justify-between items-center py-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-[9px] font-bold uppercase tracking-widest">ID Registro</span>
                            <span className="text-[10px] font-bold tracking-widest select-text">
                                STK-{stockpileData.timestamp?.toString().slice(-6) || '000000'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center py-3">
                            <span className="text-[9px] font-bold uppercase tracking-widest">Timestamp</span>
                            <span className="text-[10px] font-bold truncate">
                                {stockpileData.timestamp ? formatDate(stockpileData.timestamp) : '[Pendiente de registro]'}
                            </span>
                        </div>
                    </section>
                </div>
            </main>

            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-[#07090D]/90 border-t border-[#E2E8F0] dark:border-[#12151C] pb-6">
                <div className="flex justify-around items-center h-16 px-8 max-w-lg mx-auto">
                    <button
                        type="button"
                        onClick={onNewScan}
                        className="w-16 h-16 bg-[#C68346] text-white rounded-none shadow-none flex items-center justify-center transition-all overflow-hidden cursor-pointer"
                        title="Nueva Cubicación"
                    >
                        <span className="material-symbols-outlined text-[32px] font-black leading-none">add</span>
                    </button>
                </div>
            </nav>
        </div>
    );
};
