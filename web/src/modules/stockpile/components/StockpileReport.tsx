import React from 'react';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

interface StockpileReportProps {
    asset: StockpileAsset;
    history: StockpileMeasurement[];
    showReport: boolean;
    forceVisible?: boolean;
}

export const StockpileReport: React.FC<StockpileReportProps> = ({ asset, history, showReport, forceVisible }) => {
    if (!showReport) return null;

    const lastM = history[0];
    const prevM = history[1];
    const deltaVol = lastM && prevM ? lastM.volumen_m3 - prevM.volumen_m3 : 0;
    const deltaPerc = lastM && prevM && prevM.volumen_m3 > 0 ? (deltaVol / prevM.volumen_m3) * 100 : 0;

    return (
        <div id="printable-report" className={`${forceVisible ? 'block' : 'hidden'} print:block bg-white text-black font-atkinson p-8 w-[210mm] h-[297mm] mx-auto`}>
            {/* Header */}
            <header className="flex justify-between items-end border-b-4 border-black pb-6 mb-8">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-2">INFORME TÉCNICO</h1>
                    <h2 className="text-2xl font-bold uppercase tracking-widest text-[#555]">{asset.name}</h2>
                </div>
                <div className="text-right">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#999]">FECHA EMISIÓN</p>
                    <p className="text-xl font-black uppercase">{new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                </div>
            </header>

            {/* Snapshot */}
            <section className="grid grid-cols-3 gap-6 mb-12">
                <div className="p-6 border-2 border-black rounded-none bg-[#f5f5f5]">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#777] mb-2">VOLUMEN ACTUAL</p>
                    <p className="text-5xl font-black tracking-tighter">{asset.last_volume_m3?.toFixed(1) || '0.0'}<span className="text-lg ml-1 opacity-50">m³</span></p>
                    <div className={`flex items-center gap-1 mt-2 text-sm font-bold ${deltaVol >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        <span>{deltaVol >= 0 ? '▲' : '▼'}</span>
                        <span>{Math.abs(deltaPerc).toFixed(1)}% vs anterior</span>
                    </div>
                </div>
                <div className="p-6 border border-[#ddd] rounded-none">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#777] mb-2">TONELAJE ESTIMADO</p>
                    <p className="text-4xl font-black tracking-tighter">{asset.last_weight_t?.toFixed(1) || '0.0'}<span className="text-lg ml-1 opacity-50">t</span></p>
                </div>
                <div className="p-6 border border-[#ddd] rounded-none">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#777] mb-2">DENSIDAD PROMEDIO</p>
                    <p className="text-4xl font-black tracking-tighter">{lastM?.density_factor?.toFixed(2) || '1.66'}<span className="text-lg ml-1 opacity-50">t/m³</span></p>
                </div>
            </section>

            {/* Evidence (Side by Side) */}
            <section className="grid grid-cols-2 gap-6 mb-12 h-64">
                <div className="rounded-none overflow-hidden border border-[#ddd] relative bg-black flex items-center justify-center">
                    {/* Image disabled for debugging hang */}
                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                        <span className="text-white/20 text-xs font-bold uppercase">IMAGEN DESHABILITADA POR DIAGNÓSTICO</span>
                    </div>
                    {/* 
                    <img
                        src={asset.last_photo_url || asset.initial_photo_url}
                        className="w-full h-full object-cover"
                        crossOrigin="anonymous" // Critical for html2canvas
                        alt="Evidencia Visual"
                    />
                    */}
                    <div className="absolute bottom-4 left-4 bg-black/60 text-white px-3 py-1 rounded-none text-[10px] font-bold uppercase tracking-widest backdrop-blur-md">
                        EVIDENCIA CRONOLÓGICA
                    </div>
                </div>
                {lastM?.location_metadata && (
                    <div className="rounded-none overflow-hidden border border-[#ddd] relative bg-[#eee] flex items-center justify-center">
                        {/* Static Map Disabled to prevent PDF hang (CORS/API Key issues) */}
                        {/* 
                        <img
                           src={`https://maps.googleapis.com/...`} 
                            className="w-full h-full object-cover grayscale opacity-50"
                        />
                        */}
                        <div className="flex flex-col items-center justify-center p-6 text-center">
                            <span className="material-symbols-outlined text-4xl text-[#999] mb-2">satellite_alt</span>
                            <p className="text-xs font-bold text-[#555] uppercase">VISTA SATELITAL</p>
                            <p className="text-[10px] font-mono mt-2 text-[#777]">
                                {lastM.location_metadata.lat.toFixed(6)}, {lastM.location_metadata.lng.toFixed(6)}
                            </p>
                        </div>
                    </div>
                )}
            </section>

            {/* History Table */}
            <section>
                <div className="flex items-center justify-between mb-4 border-b border-black pb-2">
                    <h3 className="text-sm font-black uppercase tracking-[0.2em]">TRAZABILIDAD (ÚLTIMOS 5 REGISTROS)</h3>
                </div>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-[#777] border-b border-[#ddd]">
                            <th className="py-3 pl-2">Fecha</th>
                            <th className="py-3">Método</th>
                            <th className="py-3 text-right">Volumen (m³)</th>
                            <th className="py-3 text-right">Peso (t)</th>
                            <th className="py-3 text-right pr-2">Delta</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm font-medium">
                        {history.slice(0, 5).map((m, idx) => {
                            const nextM = history[idx + 1];
                            const diff = nextM ? m.volumen_m3 - nextM.volumen_m3 : 0;
                            return (
                                <tr key={m.id} className="border-b border-[#eee]">
                                    <td className="py-3 pl-2 font-bold">{new Date(m.timestamp).toLocaleDateString('es-CL')}</td>
                                    <td className="py-3 text-xs uppercase text-[#555]">{m.method}</td>
                                    <td className="py-3 text-right font-mono">{m.volumen_m3.toFixed(1)}</td>
                                    <td className="py-3 text-right font-mono text-[#555]">{m.peso_t.toFixed(1)}</td>
                                    <td className={`py-3 text-right pr-2 font-bold text-xs ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {diff > 0 ? '+' : ''}{diff !== 0 ? diff.toFixed(1) : '-'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>

            {/* Footer */}
            <footer className="mt-auto pt-8 border-t border-[#ddd] flex justify-between items-center text-[10px] uppercase text-[#999]">
                <p>Generado por MinReport Stockpile Control</p>
                <p>Página 1 de 1</p>
            </footer>
        </div>
    );
};
