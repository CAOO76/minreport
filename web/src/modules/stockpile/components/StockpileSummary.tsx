import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { resolveStockpileImageUrl } from '../services/StorageService';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

interface StockpileSummaryProps {
    asset: StockpileAsset;
    history: StockpileMeasurement[];
}

const MISSING_TECH_DATA = '[Información técnica no declarada en ficha]';

/**
 * Convierte URL remota o referencia `offline-cas://` a DataURL para incrustación PDF
 * liberando explícitamente recursos de <canvas> y Object URLs.
 */
const toDataURL = async (rawUrl: string): Promise<string | null> => {
    if (!rawUrl) return null;

    let resolvedUrl = rawUrl;
    let revokeFn: (() => void) | undefined;
    try {
        const resolved = await resolveStockpileImageUrl(rawUrl);
        resolvedUrl = resolved.resolvedUrl;
        revokeFn = resolved.revoke;
    } catch {
        return null;
    }

    if (!resolvedUrl) return null;

    try {
        if (resolvedUrl.startsWith('http') || resolvedUrl.startsWith('blob:')) {
            try {
                const response = await fetch(resolvedUrl);
                const blob = await response.blob();
                return await new Promise<string | null>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
            } catch (e) {
                console.warn('[PDF Summary] Fetch failed, using canvas fallback:', e);
            }
        }

        return await new Promise<string | null>((resolve) => {
            const img = new Image();
            if (resolvedUrl.startsWith('http')) img.crossOrigin = 'Anonymous';

            img.onload = () => {
                const canvas = document.createElement('canvas');
                try {
                    const maxDim = 1000;
                    let w = img.width || 1;
                    let h = img.height || 1;
                    if (w > maxDim || h > maxDim) {
                        const ratio = Math.min(maxDim / w, maxDim / h);
                        w = Math.max(1, Math.round(w * ratio));
                        h = Math.max(1, Math.round(h * ratio));
                    }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        resolve(null);
                        return;
                    }
                    ctx.drawImage(img, 0, 0, w, h);
                    const data = canvas.toDataURL('image/jpeg', 0.8);
                    resolve(data);
                } catch (e) {
                    console.error('[PDF Summary] Canvas error:', e);
                    resolve(null);
                } finally {
                    canvas.width = 0;
                    canvas.height = 0;
                }
            };
            img.onerror = () => resolve(null);
            img.src = resolvedUrl;
        });
    } finally {
        if (revokeFn) {
            revokeFn();
        }
    }
};

export const StockpileSummary: React.FC<StockpileSummaryProps> = ({ asset, history }) => {
    const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
    const [mapDataUrl, setMapDataUrl] = useState<string | null>(null);
    const [photoLoaded, setPhotoLoaded] = useState(false);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [isReady, setIsReady] = useState(false);

    const lastM = history[0];
    const hasDensity = Boolean(
        lastM &&
            ((typeof lastM.density_factor === 'number' && lastM.density_factor > 0) ||
                (lastM.volumen_m3 > 0 && lastM.peso_t > 0))
    );
    const computedDensity =
        lastM && typeof lastM.density_factor === 'number' && lastM.density_factor > 0
            ? lastM.density_factor
            : lastM && lastM.volumen_m3 > 0 && lastM.peso_t > 0
            ? lastM.peso_t / lastM.volumen_m3
            : null;

    const rawLat =
        typeof lastM?.location_metadata?.lat === 'number'
            ? lastM.location_metadata.lat
            : typeof asset.geo_point?.latitude === 'number'
            ? asset.geo_point.latitude
            : null;
    const rawLng =
        typeof lastM?.location_metadata?.lng === 'number'
            ? lastM.location_metadata.lng
            : typeof asset.geo_point?.longitude === 'number'
            ? asset.geo_point.longitude
            : null;

    const hasValidCoords = rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);
    const lat = hasValidCoords && rawLat !== null ? rawLat.toFixed(6) : MISSING_TECH_DATA;
    const lng = hasValidCoords && rawLng !== null ? rawLng.toFixed(6) : MISSING_TECH_DATA;
    const alt =
        typeof asset.geo_point?.altitude === 'number'
            ? `${asset.geo_point.altitude.toFixed(1)} m.s.n.m.`
            : MISSING_TECH_DATA;

    const recentHistory = history.slice(0, 3);
    const chartData = history.slice(0, 15).reverse().map(m => ({
        fecha: new Date(m.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
        volumen: parseFloat(m.volumen_m3.toFixed(1)),
    }));

    useEffect(() => {
        let cancelled = false;
        const loadImages = async () => {
            const photoUrl = lastM?.photo_url || asset.last_photo_url || asset.initial_photo_url;
            if (photoUrl) {
                const data = await toDataURL(photoUrl);
                if (!cancelled && data) setPhotoDataUrl(data);
            }

            const GOOGLE_MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
            if (GOOGLE_MAPS_KEY && hasValidCoords && rawLat !== null && rawLng !== null) {
                const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${rawLat.toFixed(6)},${rawLng.toFixed(6)}&zoom=18&size=600x400&maptype=satellite&scale=2&format=png&markers=color:0xC68346%7C${rawLat.toFixed(6)},${rawLng.toFixed(6)}&key=${GOOGLE_MAPS_KEY}`;
                const data = await toDataURL(staticMapUrl);
                if (!cancelled && data) setMapDataUrl(data);
            }
        };

        void loadImages();
        return () => {
            cancelled = true;
        };
    }, [lastM, hasValidCoords, rawLat, rawLng, asset.last_photo_url, asset.initial_photo_url]);

    useEffect(() => {
        const hasPhoto = Boolean(lastM?.photo_url || asset.last_photo_url || asset.initial_photo_url);
        const hasMap = Boolean((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY && hasValidCoords);

        const photoOk = !hasPhoto || photoLoaded;
        const mapOk = !hasMap || mapLoaded;

        if ((photoOk && mapOk) || (!hasPhoto && !hasMap)) {
            setIsReady(true);
        }
    }, [photoLoaded, mapLoaded, photoDataUrl, mapDataUrl, lastM, asset, hasValidCoords]);

    return (
        <div
            id="stockpile-report"
            data-ready={isReady ? 'true' : 'false'}
            className="w-[210mm] bg-[#FFFFFF] dark:bg-[#FFFFFF] text-[#0F172A] dark:text-[#0F172A] font-atkinson flex flex-col rounded-none shadow-none select-none"
            style={{ width: '210mm' }}
        >
            {/* PAGE 1: EXECUTIVE SUMMARY */}
            <div className="flex flex-col p-[15mm] box-border relative" style={{ height: '297mm', minHeight: '297mm', maxHeight: '297mm', overflow: 'hidden' }}>
                <header className="border-b-4 border-[#0F172A] pb-4 mb-8 flex justify-between items-end">
                    <div>
                        <h1 className="text-5xl font-bold tracking-tight uppercase leading-none mb-1">INFORME TÉCNICO</h1>
                        <div className="flex items-center gap-[13px]">
                            <span className="bg-[#0F172A] text-[#FFFFFF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-none">{asset.clase.toUpperCase()}</span>
                            <span className="text-[10px] font-mono tabular-nums uppercase tracking-wider text-[#475569]">ID: {asset.id.split('-')[0]}</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#475569]">EMISIÓN</div>
                        <div className="text-sm font-bold font-mono tabular-nums">
                            {new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })} | {new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} hrs
                        </div>
                    </div>
                </header>

                <section className="mb-8 grid grid-cols-2 gap-[34px]">
                    <div className="flex flex-col justify-center">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#475569] block mb-1">ACTIVO</span>
                        <h2 className="text-3xl font-bold tracking-tight uppercase leading-none mb-6">{asset.name}</h2>
                        <div className="border-t border-[#0F172A] pt-4 grid grid-cols-2 gap-[13px]">
                            <div>
                                <span className="text-[8px] font-bold text-[#475569] block">LATITUD</span>
                                <span className="font-mono tabular-nums text-[10px] font-bold">{lat}</span>
                            </div>
                            <div>
                                <span className="text-[8px] font-bold text-[#475569] block">LONGITUD</span>
                                <span className="font-mono tabular-nums text-[10px] font-bold">{lng}</span>
                            </div>
                            <div className="col-span-2">
                                <span className="text-[8px] font-bold text-[#475569] block">ALTITUD REF</span>
                                <span className="font-mono tabular-nums text-[10px] font-bold block">{alt}</span>
                            </div>
                        </div>
                    </div>
                    <div className="border-2 border-[#0F172A] p-[21px] flex flex-col justify-center bg-[#F8FAFC] relative overflow-hidden rounded-none">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#475569] block mb-2 z-10">VOLUMEN ACTUAL</span>
                        <div className="text-5xl font-bold font-mono tabular-nums tracking-tight leading-none z-10 text-[#C68346]">
                            {lastM ? lastM.volumen_m3.toFixed(1) : '0.0'}
                            <span className="text-lg ml-1 font-bold text-[#475569] align-top">m³</span>
                        </div>
                        <div className="mt-6 pt-4 border-t border-[#E2E8F0] flex justify-between z-10">
                            <div>
                                <span className="text-[8px] font-bold text-[#475569] block">TONELAJE</span>
                                <span className="text-base font-bold font-mono tabular-nums">{lastM ? `${lastM.peso_t.toFixed(0)} t` : '[Pendiente de registro]'}</span>
                            </div>
                            <div className="text-right">
                                <span className="text-[8px] font-bold text-[#475569] block">DENSIDAD</span>
                                <span className="text-xs font-bold font-mono tabular-nums">
                                    {hasDensity && computedDensity !== null ? `${computedDensity.toFixed(2)} t/m³` : MISSING_TECH_DATA}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mb-8 grid grid-cols-2 gap-[21px] h-72">
                    <div className="relative border-2 border-[#0F172A] bg-[#F8FAFC] overflow-hidden rounded-none">
                        <div className="absolute top-2 left-2 z-10 bg-[#0F172A] text-[#FFFFFF] px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest">ESTADO ACTUAL</div>
                        {photoDataUrl ? (
                            <img
                                src={photoDataUrl}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                className="w-full h-full object-cover select-none pointer-events-none"
                                alt="Stockpile"
                                onLoad={() => setPhotoLoaded(true)}
                                onError={() => setPhotoLoaded(true)}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] font-mono text-[#475569] p-4 text-center">{MISSING_TECH_DATA}</div>
                        )}
                    </div>
                    <div className="relative border-2 border-[#0F172A] bg-[#F8FAFC] overflow-hidden h-full rounded-none">
                        <div className="absolute top-2 left-2 z-10 bg-[#FFFFFF] text-[#0F172A] border border-[#0F172A] px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest">GEORREF ÚLTIMA MEDICIÓN</div>
                        {mapDataUrl ? (
                            <img
                                src={mapDataUrl}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                className="w-full h-full object-cover select-none pointer-events-none"
                                alt="Map"
                                onLoad={() => setMapLoaded(true)}
                                onError={() => setMapLoaded(true)}
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center relative bg-[#F8FAFC] p-4">
                                <div className="z-10 bg-[#FFFFFF] border border-[#E2E8F0] p-4 text-center">
                                    <span className="material-symbols-outlined text-3xl mb-2 text-[#475569]">satellite_alt</span>
                                    <div className="font-mono tabular-nums text-[9px] font-bold">LAT: {lat}</div>
                                    <div className="font-mono tabular-nums text-[9px] font-bold">LNG: {lng}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                <section className="mb-8 p-[21px] border border-[#E2E8F0] bg-[#FFFFFF] rounded-none">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 text-[#475569]">TENDENCIA VOLUMÉTRICA</h3>
                    <div className="h-32 w-full">
                        <ResponsiveContainer width="100%" height={128} minWidth={0} minHeight={128}>
                            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                <XAxis dataKey="fecha" tick={{ fontSize: 9, fontFamily: "'Atkinson Hyperlegible Mono', monospace" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fontFamily: "'Atkinson Hyperlegible Mono', monospace" }} axisLine={false} tickLine={false} />
                                <Line type="stepAfter" dataKey="volumen" stroke="#C68346" strokeWidth={2.5} dot={{ fill: '#C68346', r: 3 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                <section className="flex-1 overflow-hidden">
                    <h3 className="text-[9px] font-bold uppercase tracking-widest mb-2 border-b-2 border-[#0F172A] pb-1">MEDICIONES RECIENTES</h3>
                    <div className="grid grid-cols-5 text-[8px] font-bold uppercase text-[#475569] mb-1 px-1">
                        <div>FECHA</div><div className="text-center">MÉTODO</div><div className="text-right">VOL (m³)</div><div className="text-right">VAR</div><div className="text-right">TON (t)</div>
                    </div>
                    {recentHistory.map((m, i) => {
                        const nextM = history[i + 1];
                        const varVal = nextM ? m.volumen_m3 - nextM.volumen_m3 : 0;
                        return (
                            <div key={m.id} className="grid grid-cols-5 py-2 border-b border-[#E2E8F0] text-[10px] items-center px-1 font-mono tabular-nums">
                                <div className="font-bold">{new Date(m.timestamp).toLocaleDateString('es-CL')}</div>
                                <div className="text-[8px] font-bold uppercase text-center">{m.method}</div>
                                <div className="text-right font-bold">{m.volumen_m3.toFixed(1)}</div>
                                <div className={`text-right font-bold ${varVal > 0 ? 'text-[#00AEEF]' : varVal < 0 ? 'text-[#C68346]' : 'text-[#94A3B8]'}`}>
                                    {i < history.length - 1 ? (varVal > 0 ? '+' : '-') + Math.abs(varVal).toFixed(1) : '—'}
                                </div>
                                <div className="text-right text-[#475569]">{m.peso_t.toFixed(0)}</div>
                            </div>
                        );
                    })}
                </section>

                <footer className="mt-auto pt-6 border-t-2 border-[#0F172A] flex justify-between items-end text-[#475569]">
                    <div className="text-[9px] font-mono leading-tight"><p>PÁGINA 1: RESUMEN TÉCNICO</p><p>MINREPORT STOCKPILE CONTROL</p></div>
                    <div className="text-right"><div className="w-40 border-b border-[#0F172A] mb-1" /><p className="text-[8px] font-bold uppercase tracking-widest">FIRMA TÉCNICA CONTROL</p></div>
                </footer>
            </div>

            {/* PAGE 2+: FULL TRACEABILITY */}
            <div className="flex flex-col p-[15mm] min-h-[297mm] pt-12">
                <header className="border-b-2 border-[#0F172A] pb-2 mb-8">
                    <h3 className="text-sm font-bold uppercase tracking-[0.2em]">RELACIÓN DE TRAZABILIDAD INTEGRAL</h3>
                    <p className="text-[9px] font-bold text-[#475569] uppercase tracking-widest mt-1">Activo: {asset.name} | Trazabilidad del total de registros</p>
                </header>
                <div className="w-full">
                    <div className="grid grid-cols-6 text-[9px] font-bold uppercase tracking-widest text-[#475569] mb-4 px-2 border-b border-[#0F172A] pb-2">
                        <div>FECHA</div><div className="text-center">MÉTODO</div><div className="text-right">VOL (m³)</div><div className="text-right">VAR</div><div className="text-right">TON (t)</div><div className="text-right pr-2">DENSIDAD</div>
                    </div>
                    <div className="space-y-0.5">
                        {history.map((m, i) => {
                            const nextM = history[i + 1];
                            const varVal = nextM ? m.volumen_m3 - nextM.volumen_m3 : 0;
                            const mDensity =
                                typeof m.density_factor === 'number' && m.density_factor > 0
                                    ? m.density_factor
                                    : m.volumen_m3 > 0 && m.peso_t > 0
                                    ? m.peso_t / m.volumen_m3
                                    : null;
                            return (
                                <div key={m.id} className="grid grid-cols-6 py-2 border-b border-[#E2E8F0] text-[10px] items-center px-2 font-mono tabular-nums">
                                    <div className="font-bold">{new Date(m.timestamp).toLocaleDateString('es-CL')}</div>
                                    <div className="text-[9px] font-bold uppercase text-center bg-[#F8FAFC] rounded-none px-1">{m.method}</div>
                                    <div className="text-right font-bold">{m.volumen_m3.toFixed(1)}</div>
                                    <div className={`text-right font-bold ${varVal > 0 ? 'text-[#00AEEF]' : varVal < 0 ? 'text-[#C68346]' : 'text-[#94A3B8]'}`}>
                                        {i < history.length - 1 ? <>{varVal > 0 ? '+' : '-'}{Math.abs(varVal).toFixed(1)}</> : '—'}
                                    </div>
                                    <div className="text-right text-[#475569]">{m.peso_t.toFixed(0)}</div>
                                    <div className="text-right text-[#475569] text-[9px]">
                                        {mDensity !== null ? mDensity.toFixed(2) : '—'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <footer className="mt-auto pt-6 border-t border-[#E2E8F0] text-[8px] font-mono text-[#475569]">SOPORTE MULTIPÁGINA — LISTADO INTEGRAL</footer>
            </div>
        </div>
    );
};
