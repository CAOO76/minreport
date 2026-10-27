import React, { useState, useEffect } from 'react';
import { dataService } from '../services/DataService';
import { M3Chip } from './M3Chip';
import { StockpileSummary } from './StockpileSummary';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

interface StockpileDashboardProps {
    assetId: string;
    onAddMeasurement: () => void;
    onSelectMeasurement: (measurementId: string) => void;
    onBack: () => void;
}

/**
 * StockpileDashboard (Ficha de Activo)
 * Pantalla central de gestión del ciclo de vida del acopio bajo Minimalismo Industrial Puro (GEMINI.md).
 */
export const StockpileDashboard: React.FC<StockpileDashboardProps> = ({ assetId, onAddMeasurement, onSelectMeasurement, onBack }) => {
    const [asset, setAsset] = useState<StockpileAsset | null>(null);
    const [history, setHistory] = useState<StockpileMeasurement[]>([]);
    const [loading, setLoading] = useState(true);
    const [generatingPdf, setGeneratingPdf] = useState(false);
    const [manualPdfUrl, setManualPdfUrl] = useState<string | null>(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [shareImmediately, setShareImmediately] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            try {
                const assetData = await dataService.getAsset(assetId);
                setAsset(assetData);
            } catch (error) {
                console.error('[Dashboard] Error loading data:', error);
            } finally {
                setLoading(false);
            }
        };

        loadData();

        const unsubAsset = dataService.subscribeToAsset(assetId, (updated) => {
            if (updated) setAsset(updated);
        });

        const unsubHistory = dataService.subscribeToMeasurements(assetId, (updatedHistory) => {
            setHistory(updatedHistory);
        });

        return () => {
            unsubAsset();
            unsubHistory();
        };
    }, [assetId]);

    // Handle Direct Sharing logic
    useEffect(() => {
        if (generatingPdf && shareImmediately && asset) {
            const performShare = async () => {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1500));

                    const now = new Date();
                    const dateStr = now.toISOString().split('T')[0];
                    const timeStr = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '');
                    const fileName = `Ficha_${asset.name}_${dateStr}_${timeStr}hrs`;

                    const { sharePDF } = await import('../utils/pdfHelper');
                    await sharePDF(
                        'stockpile-report',
                        fileName,
                        `Reporte: ${asset.name}`
                    );
                } catch (err: any) {
                    console.error('[Dashboard] Direct share error:', err);
                    alert('Error al compartir: ' + err.message);
                } finally {
                    setGeneratingPdf(false);
                    setShareImmediately(false);
                }
            };
            performShare();
        }
    }, [generatingPdf, shareImmediately, asset]);

    const validHistory = React.useMemo(() => history.filter(m => !m.ignored), [history]);

    const lastM = validHistory[0];
    const prevM = validHistory[1];
    const deltaVol = lastM && prevM ? lastM.volumen_m3 - prevM.volumen_m3 : 0;

    if (loading || !asset) {
        return (
            <div className="h-full w-full flex-1 min-h-[480px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex items-center justify-center transition-colors duration-200">
                <div className="w-12 h-12 border-4 border-antigravity-accent border-t-transparent rounded-none animate-spin"></div>
            </div>
        );
    }

    return (
        <main className="h-full w-full flex-1 min-h-[600px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden relative transition-colors duration-200 rounded-none shadow-none">

            {/* Header Técnico */}
            <header className="shrink-0 pt-8 pb-4 px-6 flex items-center justify-between bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border z-40">
                <button
                    type="button"
                    onClick={onBack}
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    title="Volver"
                >
                    <span className="material-symbols-outlined text-2xl text-antigravity-accent">arrow_back</span>
                </button>
                <div className="flex flex-col items-center">
                    <h1 className="text-[10px] font-bold tracking-[0.4em] uppercase text-antigravity-light-text/50 dark:text-antigravity-dark-text/40">ACTIVO</h1>
                    <span className="text-sm font-black tracking-widest uppercase text-antigravity-light-text dark:text-antigravity-dark-text/90">{asset.name}</span>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setGeneratingPdf(true);
                            setShareImmediately(true);
                        }}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Compartir Reporte PDF"
                    >
                        <span className="material-symbols-outlined text-xl">share</span>
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <section className="flex-1 overflow-y-auto hide-scrollbar">

                {/* Photo Hero */}
                <div className="relative w-full aspect-[16/10] max-h-[360px] bg-black group overflow-hidden">
                    <img
                        src={showOriginal ? asset.initial_photo_url : (asset.last_photo_url || asset.initial_photo_url)}
                        draggable={false}
                        className={`w-full h-full object-cover transition-all duration-700 select-none pointer-events-none ${showOriginal ? 'scale-110 sepia-[.3]' : ''}`}
                        alt="Vista Acopio"
                    />

                    {/* Traceability Toggle (Original) */}
                    <button
                        type="button"
                        onClick={() => setShowOriginal(!showOriginal)}
                        className={`absolute top-4 right-4 z-20 px-3 py-2 rounded-none shadow-none border flex items-center gap-2 transition-all cursor-pointer ${showOriginal ? 'bg-primary border-primary text-black' : 'bg-black/60 border-white/10 text-white/80'}`}
                    >
                        <span className="material-symbols-outlined text-lg">history</span>
                        <span className="text-[10px] font-black uppercase tracking-widest">{showOriginal ? 'Viendo Original' : 'Ver Original'}</span>
                    </button>

                    <div className="absolute inset-0 bg-gradient-to-t from-antigravity-light-bg dark:from-antigravity-dark-bg via-transparent to-transparent pointer-events-none"></div>

                    {!showOriginal && (
                        <div className="absolute bottom-10 left-6">
                            <span className="text-[10px] font-black uppercase tracking-[.4em] text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 block mb-1">
                                {asset.last_measured_at ? 'ÚLTIMO ESTADO TÉCNICO' : 'FICHA DE ALTA'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Content Details */}
                <div className="px-6 -mt-8 relative z-10 space-y-6 pb-28">
                    <div>
                        <h2 className="text-xl font-black tracking-tight text-antigravity-light-text/95 dark:text-antigravity-dark-text/95 uppercase">{asset.name}</h2>
                        <p className="text-[10px] text-antigravity-light-text/50 dark:text-antigravity-dark-text/50 font-bold uppercase tracking-wider">
                            {asset.location_ref || '[Información técnica no declarada en ficha]'}
                        </p>
                    </div>

                    {/* Metrics Layout */}
                    <div className="flex items-baseline gap-2 py-2 font-mono tabular-nums">
                        <span className="text-5xl font-black text-antigravity-accent tracking-tighter">
                            {asset.last_volume_m3?.toFixed(1) || '0.0'}
                        </span>
                        <span className="text-xs font-bold text-antigravity-accent uppercase tracking-widest">m³</span>
                        <span className="text-3xl font-light text-antigravity-light-text/20 dark:text-antigravity-dark-text/20 px-1 select-none">/</span>
                        <span className="text-4xl font-black text-antigravity-light-text dark:text-antigravity-dark-text/90 tracking-tighter">
                            {asset.last_weight_t?.toFixed(1) || '0.0'}
                        </span>
                        <span className="text-xs font-bold text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 uppercase tracking-widest">t</span>
                    </div>

                    {/* Deltas Grid */}
                    <div className="grid grid-cols-2 gap-4 pt-6 border-t border-antigravity-light-border dark:border-antigravity-dark-border">
                        <div className="p-4 bg-antigravity-light-surface dark:bg-antigravity-dark-surface rounded-none shadow-none border border-antigravity-light-border dark:border-antigravity-dark-border flex flex-col gap-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-text/60 dark:text-antigravity-dark-text/60">Anterior</span>
                            <p className="text-2xl font-black font-mono tabular-nums text-antigravity-accent tracking-tight">
                                {prevM ? `${prevM.volumen_m3.toFixed(1)}` : '---'}
                                {prevM && <span className="text-[10px] ml-1 text-antigravity-light-text/40 dark:text-antigravity-dark-text/40">m³</span>}
                            </p>
                        </div>
                        <div className="p-4 bg-antigravity-light-surface dark:bg-antigravity-dark-surface rounded-none shadow-none border border-antigravity-light-border dark:border-antigravity-dark-border flex flex-col gap-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-text/60 dark:text-antigravity-dark-text/60">Variación</span>
                            <div className={`flex items-baseline gap-1 text-2xl font-black font-mono tabular-nums ${deltaVol >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                <span className="material-symbols-outlined text-xl font-black translate-y-0.5">
                                    {deltaVol >= 0 ? 'north_east' : 'south_east'}
                                </span>
                                {deltaVol >= 0 ? '+' : ''}{deltaVol.toFixed(1)}
                                <span className="text-[10px] ml-0.5 text-inherit opacity-40 font-bold">m³</span>
                            </div>
                        </div>
                    </div>

                    {/* GPS Map Section */}
                    <div className="space-y-3 pt-6">
                        {(() => {
                            const apiKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;

                            if (!lastM?.location_metadata) {
                                return (
                                    <div className="p-4 rounded-none border border-antigravity-light-border dark:border-white/10 bg-antigravity-light-surface dark:bg-white/5 flex items-center justify-center">
                                        <p className="text-[10px] font-bold text-antigravity-light-text/50 dark:text-white/40 uppercase tracking-widest text-center">
                                            [Información técnica no declarada en ficha]
                                        </p>
                                    </div>
                                );
                            }

                            if (!apiKey) {
                                return (
                                    <div className="p-4 rounded-none border border-antigravity-light-border dark:border-white/10 bg-antigravity-light-surface dark:bg-white/5 flex flex-col items-center justify-center gap-1">
                                        <span className="text-[10px] font-mono font-bold text-antigravity-accent uppercase tracking-widest">
                                            COORDENADAS REGISTRADAS
                                        </span>
                                        <span className="text-xs font-mono tabular-nums text-antigravity-light-text dark:text-white/80">
                                            {lastM.location_metadata.lat.toFixed(6)} / {lastM.location_metadata.lng.toFixed(6)} (±{lastM.location_metadata.accuracy.toFixed(1)}m)
                                        </span>
                                    </div>
                                );
                            }

                            const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lastM.location_metadata.lat},${lastM.location_metadata.lng}&zoom=19&size=640x360&maptype=satellite&scale=2&markers=color:0xC68346%7C${lastM.location_metadata.lat},${lastM.location_metadata.lng}&key=${apiKey}`;

                            return (
                                <>
                                    <div className="flex flex-col gap-1 px-1">
                                        <div className="flex justify-between items-end">
                                            <span className="text-[10px] font-bold text-antigravity-accent uppercase tracking-widest">LOCALIZACIÓN SATELITAL (ÚLTIMA MEDICIÓN)</span>
                                            <span className="text-[10px] font-bold font-mono tabular-nums text-antigravity-light-text/60 dark:text-antigravity-dark-text/40">±{lastM.location_metadata.accuracy.toFixed(1)}m</span>
                                        </div>
                                        <p className="text-xs font-black text-antigravity-light-text/80 dark:text-antigravity-dark-text/60 font-mono tabular-nums tracking-tighter">
                                            {lastM.location_metadata.lat.toFixed(6)} / {lastM.location_metadata.lng.toFixed(6)}
                                        </p>
                                    </div>

                                    <div className="w-full aspect-video rounded-none overflow-hidden border border-antigravity-light-border dark:border-white/10 bg-black shadow-none relative group">
                                        <img
                                            src={mapUrl}
                                            draggable={false}
                                            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-500 select-none pointer-events-none"
                                            alt="Ubicación Satelital"
                                        />
                                        <div className="absolute inset-0 pointer-events-none border-[12px] border-black/20 rounded-none" />
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className="w-4 h-4 bg-primary rounded-none shadow-none animate-pulse"></div>
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* History Selection */}
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-antigravity-light-text/40 dark:text-white/40">HISTORIAL</h3>
                            <M3Chip label={history.length.toString()} className="h-4 px-2 text-[10px] bg-antigravity-light-surface dark:bg-white/5 border-antigravity-light-border dark:border-white/5 font-black font-mono tabular-nums" />
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                            {history.slice(0, 10).map((m) => (
                                <div
                                    key={m.id}
                                    onClick={() => onSelectMeasurement(m.id)}
                                    className={`flex items-center gap-4 p-3 rounded-none border shadow-none transition-all cursor-pointer ${m.ignored ? 'bg-red-50 border-red-200 opacity-60 dark:bg-red-500/5 dark:border-red-500/10 dark:opacity-50' : 'bg-antigravity-light-surface border-antigravity-light-border hover:border-antigravity-accent/30 dark:bg-white/5 dark:border-white/10'}`}
                                >
                                    <div className="w-12 h-12 rounded-none overflow-hidden bg-black shrink-0 border border-antigravity-light-border dark:border-white/10">
                                        {m.photo_url ? (
                                            <img src={m.photo_url} draggable={false} className="w-full h-full object-cover grayscale opacity-60 dark:opacity-40 select-none pointer-events-none" alt="" />
                                        ) : null}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-black font-mono tabular-nums text-antigravity-light-text dark:text-antigravity-dark-text/80">{m.volumen_m3.toFixed(1)} m³</span>
                                            <span className="text-[10px] font-bold font-mono tabular-nums text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 uppercase tracking-tighter">
                                                {new Date(m.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            {m.ignored ? (
                                                <span className="text-[10px] font-black text-red-600 dark:text-red-500 uppercase tracking-widest bg-red-100 dark:bg-red-500/10 px-1.5 py-0.5 rounded-none">IGNORADO</span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-antigravity-light-text/60 dark:text-antigravity-dark-text/40 uppercase tracking-widest">
                                                    {m.method}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* Botón Primario de Cubicación */}
            <footer className="shrink-0 p-6 bg-antigravity-light-bg dark:bg-antigravity-dark-bg border-t border-antigravity-light-border dark:border-antigravity-dark-border z-40">
                <button
                    type="button"
                    onClick={() => onAddMeasurement()}
                    className="w-full h-14 bg-antigravity-accent text-white rounded-none shadow-none font-black uppercase tracking-[0.3em] text-xs flex items-center justify-center gap-4 transition-all cursor-pointer"
                >
                    <span className="material-symbols-outlined text-2xl font-black">straighten</span>
                    CUBICAR
                </button>
            </footer>

            {/* Loading Overlay for PDF */}
            {generatingPdf && !manualPdfUrl && (
                <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center backdrop-blur-md">
                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-none animate-spin mb-4"></div>
                    <h2 className="text-xl font-black text-white uppercase tracking-widest">Generando Reporte PDF</h2>
                    <p className="text-xs text-white/50 uppercase tracking-wider mt-2">Por favor espere...</p>
                </div>
            )}

            {/* Success/Download Overlay */}
            {manualPdfUrl && (
                <div className="fixed inset-0 z-[10000] bg-black/95 flex flex-col items-center justify-center backdrop-blur-md p-8 animate-in fade-in duration-300">
                    <div className="w-20 h-20 rounded-none bg-emerald-500/20 flex items-center justify-center mb-6">
                        <span className="material-symbols-outlined text-5xl text-emerald-500">check</span>
                    </div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-widest text-center mb-2">Reporte Listo</h2>
                    <p className="text-xs text-white/50 font-bold uppercase tracking-wider text-center mb-10 max-w-[200px]">
                        El documento se ha generado correctamente.
                    </p>

                    <a
                        href={manualPdfUrl}
                        download={`Ficha_${asset.name}.pdf`}
                        className="w-full max-w-xs h-16 bg-primary text-black rounded-none shadow-none font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 text-sm transition-transform"
                        onClick={() => {
                            setTimeout(() => setManualPdfUrl(null), 2000);
                        }}
                    >
                        <span className="material-symbols-outlined text-2xl">download</span>
                        Descargar PDF
                    </a>

                    <button
                        type="button"
                        onClick={() => setManualPdfUrl(null)}
                        className="mt-8 px-6 py-4 text-white/30 text-[10px] font-black uppercase tracking-[0.2em] hover:text-white transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            )}

            {/* Enhanced Report View */}
            {asset && generatingPdf && (
                <div
                    className={`fixed z-[9000] bg-white overflow-auto ${shareImmediately ? 'pointer-events-none' : 'inset-0'}`}
                    style={shareImmediately ? { left: '0', top: '0', opacity: '0.05', width: '210mm', height: 'auto', zIndex: 50, position: 'fixed', pointerEvents: 'none' } : {}}
                >
                    <div className="fixed top-4 right-4 z-[10001] flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    const { downloadPDF } = await import('../utils/pdfHelper');
                                    await downloadPDF(
                                        'stockpile-report',
                                        `Ficha_${asset.name}_${new Date().toISOString().split('T')[0]}`
                                    );
                                } catch (err: any) {
                                    console.error('[Dashboard] Download error:', err);
                                    alert('Error al descargar: ' + err.message);
                                }
                            }}
                            className="w-14 h-14 rounded-none bg-primary text-black flex items-center justify-center shadow-none transition-transform"
                            title="Descargar PDF"
                        >
                            <span className="material-symbols-outlined text-2xl font-black">download</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setGeneratingPdf(false)}
                            className="w-14 h-14 rounded-none bg-red-600 text-white flex items-center justify-center shadow-none transition-transform"
                            title="Cerrar"
                        >
                            <span className="material-symbols-outlined text-2xl">close</span>
                        </button>
                    </div>

                    <StockpileSummary
                        asset={asset}
                        history={validHistory}
                    />
                </div>
            )}
        </main>
    );
};
