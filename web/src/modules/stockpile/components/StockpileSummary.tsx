import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';

interface StockpileSummaryProps {
    asset: StockpileAsset;
    history: StockpileMeasurement[];
}

/**
 * Converts remote image URL to DataURL for PDF embedding
 */
const toDataURL = async (url: string): Promise<string | null> => {
    if (!url) return null;

    if (url.startsWith('http')) {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('[PDF Summary] Fetch failed, using fallback:', e);
        }
    }

    return new Promise((resolve) => {
        const img = new Image();
        if (url.startsWith('http')) img.crossOrigin = 'Anonymous';

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const maxDim = 1000;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    const ratio = Math.min(maxDim / w, maxDim / h);
                    w *= ratio;
                    h *= ratio;
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(null);
                ctx.drawImage(img, 0, 0, w, h);
                const data = canvas.toDataURL('image/jpeg', 0.8);
                resolve(data);
            } catch (e) {
                console.error('[PDF Summary] Canvas error:', e);
                resolve(null);
            }
        };
        img.onerror = () => {
            resolve(null);
        };
        img.src = url;
    });
};

export const StockpileSummary: React.FC<StockpileSummaryProps> = ({ asset, history }) => {
    const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
    const [mapDataUrl, setMapDataUrl] = useState<string | null>(null);
    const [photoLoaded, setPhotoLoaded] = useState(false);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [isReady, setIsReady] = useState(false);

    const lastM = history[0];
    const density = lastM && lastM.volumen_m3 > 0 ? (lastM.peso_t / lastM.volumen_m3) : 0;

    const lat = lastM?.location_metadata?.lat?.toFixed(6) || asset.geo_point?.latitude.toFixed(6) || '---';
    const lng = lastM?.location_metadata?.lng?.toFixed(6) || asset.geo_point?.longitude.toFixed(6) || '---';
    const alt = asset.geo_point?.altitude ? `${asset.geo_point.altitude.toFixed(1)} m.s.n.m.` : 'N/A';

    const recentHistory = history.slice(0, 3);
    const chartData = history.slice(0, 15).reverse().map(m => ({
        fecha: new Date(m.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
        volumen: parseFloat(m.volumen_m3.toFixed(1)),
    }));

    useEffect(() => {
        const loadImages = async () => {
            const photoUrl = lastM?.photo_url || asset.last_photo_url || asset.initial_photo_url;
            if (photoUrl) {
                const data = await toDataURL(photoUrl);
                if (data) setPhotoDataUrl(data);
            }

            const GOOGLE_MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
            if (GOOGLE_MAPS_KEY && lat !== '---' && lng !== '---') {
                const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=600x400&maptype=satellite&scale=2&format=png&markers=color:0xC68346%7C${lat},${lng}&key=${GOOGLE_MAPS_KEY}`;
                const data = await toDataURL(staticMapUrl);
                if (data) setMapDataUrl(data);
            }
        };

        loadImages();
    }, [lastM, lat, lng, asset.last_photo_url, asset.initial_photo_url]);

    useEffect(() => {
        const hasPhoto = !!(lastM?.photo_url || asset.last_photo_url || asset.initial_photo_url);
        const hasMap = !!((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY && lat !== '---');

        const photoOk = !hasPhoto || photoLoaded;
        const mapOk = !hasMap || mapLoaded;

        if (photoOk && mapOk && (photoDataUrl || mapDataUrl)) {
            setIsReady(true);
        }
    }, [photoLoaded, mapLoaded, photoDataUrl, mapDataUrl, lastM, asset, lat]);

    return (
        <div
            id="stockpile-report"
            data-ready={isReady ? "true" : "false"}
            className="w-[210mm] bg-white text-black font-atkinson flex flex-col rounded-none shadow-none"
            style={{ width: '210mm' }}
        >
            {/* PAGE 1: EXECUTIVE SUMMARY */}
            <div className="flex flex-col p-[15mm] box-border relative" style={{ height: '297mm', minHeight: '297mm', maxHeight: '297mm', overflow: 'hidden' }}>
                <header className="border-b-4 border-black pb-4 mb-8 flex justify-between items-end">
                    <div>
                        <h1 className="text-5xl font-black tracking-tighter uppercase leading-none mb-1">INFORME TÉCNICO</h1>
                        <div className="flex items-center gap-3">
                            <span className="bg-black text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-none">{asset.clase.toUpperCase()}</span>
                            <span className="text-[10px] font-mono tabular-nums uppercase tracking-wider opacity-60">ID: {asset.id.split('-')[0]}</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">EMISIÓN</div>
                        <div className="text-sm font-bold font-mono tabular-nums">
                            {new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })} | {new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} hrs
                        </div>
                    </div>
                </header>

                <section className="mb-8 grid grid-cols-2 gap-10">
                    <div className="flex flex-col justify-center">
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-1">ACTIVO</span>
                        <h2 className="text-4xl font-black tracking-tight uppercase leading-none mb-6">{asset.name}</h2>
                        <div className="border-t border-black pt-4 grid grid-cols-2 gap-4">
                            <div><span className="text-[8px] font-black opacity-40 block">LATITUD</span><span className="font-mono tabular-nums text-xs font-bold">{lat}</span></div>
                            <div><span className="text-[8px] font-black opacity-40 block">LONGITUD</span><span className="font-mono tabular-nums text-xs font-bold">{lng}</span></div>
                            <div className="col-span-2"><span className="text-[8px] font-black opacity-40 block">ALTITUD REF</span><span className="font-mono tabular-nums text-xs font-bold block">{alt}</span></div>
                        </div>
                    </div>
                    <div className="border-4 border-black p-6 flex flex-col justify-center bg-zinc-50 relative overflow-hidden rounded-none">
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-2 z-10">VOLUMEN ACTUAL</span>
                        <div className="text-6xl font-black font-mono tabular-nums tracking-tighter leading-none z-10">{lastM?.volumen_m3.toFixed(1) || '0.0'}<span className="text-xl ml-1 font-bold opacity-30 align-top">m³</span></div>
                        <div className="mt-6 pt-4 border-t border-zinc-200 flex justify-between z-10">
                            <div><span className="text-[8px] font-black opacity-40 block">TONELAJE EST.</span><span className="text-lg font-bold font-mono tabular-nums">{lastM?.peso_t.toFixed(0) || '0'} t</span></div>
                            <div className="text-right"><span className="text-[8px] font-black opacity-40 block">DENSIDAD</span><span className="text-lg font-bold font-mono tabular-nums">{density.toFixed(2)} t/m³</span></div>
                        </div>
                    </div>
                </section>

                <section className="mb-8 grid grid-cols-2 gap-6 h-72">
                    <div className="relative border-2 border-black bg-zinc-100 overflow-hidden rounded-none">
                        <div className="absolute top-2 left-2 z-10 bg-black text-white px-2 py-0.5 text-[8px] font-black uppercase tracking-widest">ESTADO ACTUAL</div>
                        {photoDataUrl ? (
                            <img 
                                src={photoDataUrl} 
                                className="w-full h-full object-cover" 
                                alt="Stockpile" 
                                onLoad={() => setPhotoLoaded(true)}
                                onError={() => setPhotoLoaded(true)}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] opacity-30">SIN FOTO DISPONIBLE</div>
                        )}
                    </div>
                    <div className="relative border-2 border-black bg-zinc-100 overflow-hidden h-full rounded-none">
                        <div className="absolute top-2 left-2 z-10 bg-white text-black border border-black px-2 py-0.5 text-[8px] font-black uppercase tracking-widest">GEORREF ÚLTIMA MEDICIÓN</div>
                        {mapDataUrl ? (
                            <img 
                                src={mapDataUrl} 
                                className="w-full h-full object-cover" 
                                alt="Map" 
                                onLoad={() => setMapLoaded(true)}
                                onError={() => setMapLoaded(true)}
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center relative bg-zinc-50 border-4 border-black/5 m-4 w-[calc(100%-2rem)] h-[calc(100%-2rem)]">
                                <div className="z-10 bg-white border-2 border-black p-4 text-center">
                                    <span className="material-symbols-outlined text-4xl mb-2 opacity-80">satellite_alt</span>
                                    <div className="text-[10px] font-black uppercase tracking-widest bg-black text-white px-2 py-1 mb-2">MODO OFFLINE</div>
                                    <div className="font-mono tabular-nums text-[9px] font-bold">LAT: {lat}</div>
                                    <div className="font-mono tabular-nums text-[9px] font-bold">LNG: {lng}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                <section className="mb-8 p-6 border border-zinc-200 bg-white rounded-none">
                    <h3 className="text-[10px] font-black uppercase tracking-widest mb-4 opacity-40">TENDENCIA VOLUMÉTRICA</h3>
                    <div className="h-32 w-full">
                        <ResponsiveContainer width="100%" height={128} minWidth={0} minHeight={128}>
                            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                <XAxis dataKey="fecha" tick={{ fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                                <Line type="stepAfter" dataKey="volumen" stroke="#000" strokeWidth={3} dot={{ fill: '#000', r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                <section className="flex-1 overflow-hidden">
                    <h3 className="text-[9px] font-black uppercase tracking-widest mb-2 border-b-2 border-black pb-1">MEDICIONES RECIENTES</h3>
                    <div className="grid grid-cols-5 text-[8px] font-black uppercase opacity-40 mb-1 px-1">
                        <div>FECHA</div><div className="text-center">MÉTODO</div><div className="text-right">VOL (m³)</div><div className="text-right">VAR</div><div className="text-right">TON (t)</div>
                    </div>
                    {recentHistory.map((m, i) => {
                        const nextM = history[i + 1];
                        const varVal = nextM ? m.volumen_m3 - nextM.volumen_m3 : 0;
                        return (
                            <div key={m.id} className="grid grid-cols-5 py-2 border-b border-zinc-100 text-[10px] items-center px-1 font-mono tabular-nums">
                                <div className="font-bold">{new Date(m.timestamp).toLocaleDateString('es-CL')}</div>
                                <div className="text-[8px] font-black uppercase text-center">{m.method}</div>
                                <div className="text-right font-black">{m.volumen_m3.toFixed(1)}</div>
                                <div className={`text-right font-bold ${varVal > 0 ? 'text-emerald-600' : varVal < 0 ? 'text-red-600' : 'text-zinc-300'}`}>
                                    {i < history.length - 1 ? (varVal > 0 ? '+' : '-') + Math.abs(varVal).toFixed(1) : '—'}
                                </div>
                                <div className="text-right opacity-60">{m.peso_t.toFixed(0)}</div>
                            </div>
                        );
                    })}
                </section>

                <footer className="mt-auto pt-6 border-t-4 border-black flex justify-between items-end opacity-60">
                    <div className="text-[9px] font-mono leading-tight"><p>PÁGINA 1: RESUMEN EJECUTIVO</p><p>GENERADO POR MINREPORT STOCKPILE CONTROL</p></div>
                    <div className="text-right"><div className="w-40 border-b-2 border-black mb-1"></div><p className="text-[8px] font-black uppercase tracking-widest">FIRMA TÉCNICA CONTROL</p></div>
                </footer>
            </div>

            {/* PAGE 2+: FULL TRACEABILITY */}
            <div className="flex flex-col p-[15mm] min-h-[297mm] pt-12">
                <header className="border-b-2 border-black pb-2 mb-8">
                    <h3 className="text-sm font-black uppercase tracking-[0.3em]">RELACIÓN DE TRAZABILIDAD INTEGRAL</h3>
                    <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest mt-1">Activo: {asset.name} | Trazabilidad del total de registros</p>
                </header>
                <div className="w-full">
                    <div className="grid grid-cols-6 text-[9px] font-black uppercase tracking-widest opacity-40 mb-4 px-2 border-b border-black pb-2">
                        <div>FECHA</div><div className="text-center">MÉTODO</div><div className="text-right">VOL (m³)</div><div className="text-right">VAR</div><div className="text-right">TON (t)</div><div className="text-right pr-2">DENSIDAD</div>
                    </div>
                    <div className="space-y-0.5">
                        {history.map((m, i) => {
                            const nextM = history[i + 1];
                            const varVal = nextM ? m.volumen_m3 - nextM.volumen_m3 : 0;
                            const mDensity = m.volumen_m3 > 0 ? m.peso_t / m.volumen_m3 : 0;
                            return (
                                <div key={m.id} className="grid grid-cols-6 py-2 border-b border-zinc-100 text-[10px] items-center px-2 font-mono tabular-nums">
                                    <div className="font-bold">{new Date(m.timestamp).toLocaleDateString('es-CL')}</div>
                                    <div className="text-[9px] font-bold uppercase text-center bg-zinc-100 rounded-none px-1">{m.method}</div>
                                    <div className="text-right font-black">{m.volumen_m3.toFixed(1)}</div>
                                    <div className={`text-right font-bold ${varVal > 0 ? 'text-emerald-600' : varVal < 0 ? 'text-red-600' : 'text-zinc-300'}`}>
                                        {i < history.length - 1 ? (<>{varVal > 0 ? '+' : '-'}{Math.abs(varVal).toFixed(1)}</>) : '—'}
                                    </div>
                                    <div className="text-right opacity-60">{m.peso_t.toFixed(0)}</div>
                                    <div className="text-right opacity-40 text-[9px]">{mDensity.toFixed(2)}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <footer className="mt-auto pt-6 border-t border-zinc-200 text-[8px] font-mono opacity-40">SOPORTE MULTIPÁGINA - LISTADO COMPLETO RECONSTRUIDO</footer>
            </div>
        </div>
    );
};
