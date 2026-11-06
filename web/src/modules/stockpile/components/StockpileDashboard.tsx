import React, { useState, useEffect, Suspense } from 'react';
import { toast } from 'react-toastify';
import { dataService } from '../services/DataService';
import { useResolvedStockpileImage } from '../services/StorageService';
import { M3Chip } from './M3Chip';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

const StockpileSummary = React.lazy(() =>
    import('./StockpileSummary').then(m => ({ default: m.StockpileSummary }))
);

interface StockpileDashboardProps {
    assetId: string;
    onAddMeasurement: () => void;
    onSelectMeasurement: (measurementId: string) => void;
    onBack: () => void;
}

const HistoryThumb: React.FC<{ rawUrl?: string }> = ({ rawUrl }) => {
    const resolved = useResolvedStockpileImage(rawUrl);
    if (!resolved) return null;
    return (
        <img
            src={resolved}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full h-full object-cover grayscale opacity-70 dark:opacity-50 select-none pointer-events-none"
            alt=""
        />
    );
};

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

        void loadData();

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
                    toast.error(`Error al compartir: ${err?.message || 'Error desconocido'}`);
                } finally {
                    setGeneratingPdf(false);
                    setShareImmediately(false);
                }
            };
            void performShare();
        }
    }, [generatingPdf, shareImmediately, asset]);

    const validHistory = React.useMemo(() => history.filter(m => !m.ignored), [history]);
    const lastM = validHistory[0];
    const prevM = validHistory[1];
    const deltaVol = lastM && prevM ? lastM.volumen_m3 - prevM.volumen_m3 : 0;

    const rawHeroUrl = showOriginal
        ? asset?.initial_photo_url
        : (asset?.last_photo_url || asset?.initial_photo_url);
    const resolvedHeroUrl = useResolvedStockpileImage(rawHeroUrl);

    if (loading || !asset) {
        return (
            <div className="h-full w-full flex-1 min-h-[480px] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center transition-colors duration-200">
                <div className="w-12 h-12 border-4 border-[#C68346] border-t-transparent rounded-none animate-spin" />
            </div>
        );
    }

    return (
        <main className="h-full w-full flex-1 min-h-[600px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden relative transition-colors duration-200 rounded-none shadow-none select-none">

            <header className="shrink-0 pt-8 pb-4 px-6 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] z-40">
                <button
                    type="button"
                    onClick={onBack}
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    title="Volver"
                    aria-label="Volver"
                >
                    <span className="material-symbols-outlined text-2xl text-[#C68346]">arrow_back</span>
                </button>
                <div className="flex flex-col items-center">
                    <h1 className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">ACTIVO</h1>
                    <span className="text-sm font-bold tracking-widest uppercase text-[#0F172A] dark:text-[#F3F4F6]">{asset.name}</span>
                </div>
                <div className="flex gap-[8px]">
                    <button
                        type="button"
                        onClick={() => {
                            setGeneratingPdf(true);
                            setShareImmediately(true);
                        }}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Compartir Reporte PDF"
                        aria-label="Compartir Reporte PDF"
                    >
                        <span className="material-symbols-outlined text-xl">share</span>
                    </button>
                </div>
            </header>

            <section className="flex-1 overflow-y-auto hide-scrollbar">

                {/* Photo Hero */}
                <div className="relative w-full aspect-[16/10] max-h-[360px] bg-[#07090D] group overflow-hidden">
                    {resolvedHeroUrl ? (
                        <img
                            src={resolvedHeroUrl}
                            draggable={false}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`w-full h-full object-cover transition-all duration-500 select-none pointer-events-none ${showOriginal ? 'scale-105' : ''}`}
                            alt="Vista Acopio"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-mono text-[#5A6072]">
                            [Información técnica no declarada en ficha]
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => setShowOriginal(!showOriginal)}
                        className={`absolute top-4 right-4 z-20 px-[13px] py-[8px] rounded-none shadow-none border text-[11px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${
                            showOriginal
                                ? 'bg-[#C68346] border-[#C68346] text-[#FFFFFF]'
                                : 'bg-[#07090D]/85 border-[#12151C] text-[#F3F4F6]'
                        }`}
                    >
                        {showOriginal ? 'Viendo Original' : 'Ver Original'}
                    </button>

                    <div className="absolute inset-0 bg-gradient-to-t from-[#FFFFFF] dark:from-[#000000] via-transparent to-transparent pointer-events-none" />

                    {!showOriginal && (
                        <div className="absolute bottom-10 left-6">
                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] block mb-1">
                                {asset.last_measured_at ? 'ÚLTIMO ESTADO TÉCNICO' : 'FICHA DE ALTA'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Content Details */}
                <div className="px-[21px] -mt-6 relative z-10 space-y-[21px] pb-28">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">{asset.name}</h2>
                        <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] font-bold uppercase tracking-wider">
                            {asset.location_ref || '[Información técnica no declarada en ficha]'}
                        </p>
                    </div>

                    {/* Metrics Layout */}
                    <div className="flex items-baseline gap-[8px] py-2 font-mono tabular-nums">
                        <span className="text-4xl font-bold text-[#C68346] tracking-tight">
                            {typeof asset.last_volume_m3 === 'number' ? asset.last_volume_m3.toFixed(1) : '0.0'}
                        </span>
                        <span className="text-xs font-bold text-[#C68346] uppercase tracking-widest">m³</span>
                        <span className="text-2xl font-light text-[#94A3B8] dark:text-[#5A6072] px-1 select-none">/</span>
                        <span className="text-3xl font-bold text-[#0F172A] dark:text-[#F3F4F6] tracking-tight">
                            {typeof asset.last_weight_t === 'number' ? asset.last_weight_t.toFixed(1) : '0.0'}
                        </span>
                        <span className="text-xs font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest">t</span>
                    </div>

                    {/* Deltas Grid */}
                    <div className="grid grid-cols-2 gap-[13px] pt-[21px] border-t border-[#E2E8F0] dark:border-[#12151C]">
                        <div className="p-[13px] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[8px]">
                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6]">Anterior</span>
                            {prevM ? (
                                <p className="text-2xl font-bold font-mono tabular-nums text-[#C68346] tracking-tight">
                                    {prevM.volumen_m3.toFixed(1)}
                                    <span className="text-[11px] ml-1 text-[#475569] dark:text-[#8A93A6]">m³</span>
                                </p>
                            ) : (
                                <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">[Pendiente de registro]</p>
                            )}
                        </div>
                        <div className="p-[13px] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[8px]">
                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6]">Variación</span>
                            {lastM && prevM ? (
                                <div className={`flex items-baseline gap-1 text-2xl font-bold font-mono tabular-nums ${deltaVol >= 0 ? 'text-[#00AEEF]' : 'text-[#C68346]'}`}>
                                    {deltaVol >= 0 ? '+' : ''}{deltaVol.toFixed(1)}
                                    <span className="text-[11px] ml-0.5 text-[#475569] dark:text-[#8A93A6] font-bold">m³</span>
                                </div>
                            ) : (
                                <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">[Pendiente de registro]</p>
                            )}
                        </div>
                    </div>

                    {/* GPS Map Section */}
                    <div className="space-y-[13px] pt-[13px]">
                        {(() => {
                            const apiKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;

                            if (!lastM?.location_metadata) {
                                return (
                                    <div className="p-[13px] rounded-none border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-center">
                                        <p className="text-[11px] font-bold text-[#94A3B8] dark:text-[#5A6072] uppercase tracking-widest text-center">
                                            [Información técnica no declarada en ficha]
                                        </p>
                                    </div>
                                );
                            }

                            if (!apiKey) {
                                return (
                                    <div className="p-[13px] rounded-none border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col items-center justify-center gap-1">
                                        <span className="text-[11px] font-mono font-bold text-[#C68346] uppercase tracking-widest">
                                            COORDENADAS REGISTRADAS
                                        </span>
                                        <span className="text-xs font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
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
                                            <span className="text-[11px] font-bold text-[#C68346] uppercase tracking-widest">LOCALIZACIÓN SATELITAL (ÚLTIMA MEDICIÓN)</span>
                                            <span className="text-[11px] font-bold font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">±{lastM.location_metadata.accuracy.toFixed(1)}m</span>
                                        </div>
                                        <p className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6] font-mono tabular-nums tracking-tight">
                                            {lastM.location_metadata.lat.toFixed(6)} / {lastM.location_metadata.lng.toFixed(6)}
                                        </p>
                                    </div>

                                    <div className="w-full aspect-video rounded-none overflow-hidden border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] shadow-none relative group">
                                        <img
                                            src={mapUrl}
                                            draggable={false}
                                            onContextMenu={(e) => e.preventDefault()}
                                            className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity duration-300 select-none pointer-events-none"
                                            alt="Ubicación Satelital"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className="w-3 h-3 bg-[#C68346] rounded-none shadow-none" />
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* History Selection */}
                    <div className="space-y-[13px] pt-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6]">HISTORIAL</h3>
                            <M3Chip label={history.length.toString()} className="font-bold font-mono tabular-nums" />
                        </div>

                        <div className="grid grid-cols-1 gap-[8px]">
                            {history.slice(0, 10).map((m) => (
                                <div
                                    key={m.id}
                                    onClick={() => onSelectMeasurement(m.id)}
                                    className={`flex items-center gap-[13px] p-[13px] rounded-none border shadow-none transition-colors cursor-pointer ${
                                        m.ignored
                                            ? 'bg-[#F8FAFC] dark:bg-[#07090D] border-[#C68346]/40 opacity-55'
                                            : 'bg-[#F8FAFC] dark:bg-[#07090D] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]'
                                    }`}
                                >
                                    <div className="w-12 h-12 rounded-none overflow-hidden bg-[#000000] shrink-0 border border-[#E2E8F0] dark:border-[#12151C]">
                                        <HistoryThumb rawUrl={m.photo_url} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">{m.volumen_m3.toFixed(1)} m³</span>
                                            <span className="text-[11px] font-bold font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] uppercase">
                                                {new Date(m.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-[8px] mt-0.5">
                                            {m.ignored ? (
                                                <span className="text-[10px] font-bold text-[#C68346] uppercase tracking-widest border border-[#C68346]/40 px-1.5 py-0.5 rounded-none">IGNORADO</span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest">
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
            <footer className="shrink-0 p-[21px] bg-[#FFFFFF] dark:bg-[#000000] border-t border-[#E2E8F0] dark:border-[#12151C] z-40">
                <button
                    type="button"
                    onClick={() => onAddMeasurement()}
                    className="w-full h-14 bg-[#C68346] text-[#FFFFFF] rounded-none shadow-none font-bold uppercase tracking-[0.25em] text-xs flex items-center justify-center transition-colors cursor-pointer"
                >
                    CUBICAR
                </button>
            </footer>

            {/* Loading Overlay for PDF */}
            {generatingPdf && !manualPdfUrl && (
                <div className="fixed inset-0 z-[9999] bg-[#FFFFFF]/95 dark:bg-[#000000]/95 flex flex-col items-center justify-center">
                    <div className="w-16 h-16 border-4 border-[#C68346] border-t-transparent rounded-none animate-spin mb-4" />
                    <h2 className="text-lg font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-widest">Generando Reporte PDF</h2>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider mt-2">Procesando trazabilidad...</p>
                </div>
            )}

            {/* Success/Download Overlay */}
            {manualPdfUrl && (
                <div className="fixed inset-0 z-[10000] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col items-center justify-center p-[34px]">
                    <h2 className="text-2xl font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-widest text-center mb-2">Reporte Listo</h2>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-bold uppercase tracking-wider text-center mb-8 max-w-[240px]">
                        El informe técnico se ha generado correctamente.
                    </p>

                    <a
                        href={manualPdfUrl}
                        download={`Ficha_${asset.name}.pdf`}
                        className="w-full max-w-xs h-14 bg-[#C68346] text-[#FFFFFF] rounded-none shadow-none font-bold uppercase tracking-[0.2em] flex items-center justify-center text-xs transition-colors"
                        onClick={() => {
                            setTimeout(() => setManualPdfUrl(null), 2000);
                        }}
                    >
                        Descargar PDF
                    </a>

                    <button
                        type="button"
                        onClick={() => setManualPdfUrl(null)}
                        className="mt-6 px-6 py-3 text-[#475569] dark:text-[#8A93A6] text-[11px] font-bold uppercase tracking-[0.2em] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer"
                    >
                        Cerrar
                    </button>
                </div>
            )}

            {/* Enhanced Report View */}
            {asset && generatingPdf && (
                <div
                    className={`fixed z-[9000] bg-[#FFFFFF] dark:bg-[#FFFFFF] overflow-auto ${shareImmediately ? 'pointer-events-none' : 'inset-0'}`}
                    style={shareImmediately ? { left: '0', top: '0', opacity: '0.05', width: '210mm', height: 'auto', zIndex: 50, position: 'fixed', pointerEvents: 'none' } : {}}
                >
                    <div className="fixed top-4 right-4 z-[10001] flex flex-col gap-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-[8px]">
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
                                    toast.error(`Error al descargar: ${err?.message || 'Error desconocido'}`);
                                }
                            }}
                            className="bg-transparent border-0 outline-none p-2 text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer"
                            title="Descargar PDF"
                            aria-label="Descargar PDF"
                        >
                            <span className="material-symbols-outlined text-2xl">download</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setGeneratingPdf(false)}
                            className="bg-transparent border-0 outline-none p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
                            title="Cerrar"
                            aria-label="Cerrar"
                        >
                            <span className="material-symbols-outlined text-2xl">close</span>
                        </button>
                    </div>

                    <Suspense fallback={null}>
                        <StockpileSummary
                            asset={asset}
                            history={validHistory}
                        />
                    </Suspense>
                </div>
            )}
        </main>
    );
};
