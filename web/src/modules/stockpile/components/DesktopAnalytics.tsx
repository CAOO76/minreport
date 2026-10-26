import React, { useState, useEffect, useMemo, useRef } from 'react';
import { dataService } from '../services/DataService';
import { useTheme } from '../hooks/useTheme';
import { calculationEngine } from '../services/calculation-engine';
import type { StockpileAsset, StockpileMeasurement } from '../types/StockpileAsset';
import { StockpileSummary } from './StockpileSummary';
import { downloadPDF } from '../utils/pdfHelper';
import { 
    ResponsiveContainer, 
    AreaChart, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    Area,
    ReferenceDot
} from 'recharts';

export interface DesktopAnalyticsProps {
    embedded?: boolean;
}

export const DesktopAnalytics: React.FC<DesktopAnalyticsProps> = ({ embedded = false }) => {
    const [assets, setAssets] = useState<StockpileAsset[]>([]);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [selectedMeasurement, setSelectedMeasurement] = useState<StockpileMeasurement | null>(null);
    const [measurements, setMeasurements] = useState<Record<string, StockpileMeasurement[]>>({});
    const [generatingPdf, setGeneratingPdf] = useState(false);
    
    // Pestaña del panel lateral: 'assets' | 'history'
    const [sidebarTab, setSidebarTab] = useState<'assets' | 'history'>('assets');

    // Estado para flujo de eliminación
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    // Estado para Modal: Nuevo Acopio
    const [showNewAssetModal, setShowNewAssetModal] = useState(false);
    const [newAssetName, setNewAssetName] = useState('');
    const [newAssetClase, setNewAssetClase] = useState<'mineral' | 'esteril' | 'baja_ley'>('mineral');
    const [newAssetLocation, setNewAssetLocation] = useState('');
    const [newAssetLat, setNewAssetLat] = useState('');
    const [newAssetLng, setNewAssetLng] = useState('');
    const [newAssetPhoto, setNewAssetPhoto] = useState<string | null>(null);
    const [isCreatingAsset, setIsCreatingAsset] = useState(false);
    const assetFileInputRef = useRef<HTMLInputElement>(null);

    // Estado para Modal: Nueva Medición / Cubicación
    const [showNewMeasurementModal, setShowNewMeasurementModal] = useState(false);
    const [measMethod, setMeasMethod] = useState<'DIRECT' | 'ELLIPTIC_CONE'>('DIRECT');
    const [measVolumen, setMeasVolumen] = useState('');
    const [measDensity, setMeasDensity] = useState('2.20');
    const [coneD1, setConeD1] = useState('');
    const [coneD2, setConeD2] = useState('');
    const [coneH, setConeH] = useState('');
    const [measPhoto, setMeasPhoto] = useState<string | null>(null);
    const [isSavingMeas, setIsSavingMeas] = useState(false);
    const measFileInputRef = useRef<HTMLInputElement>(null);

    const { theme } = useTheme();

    // Suscripción reactiva a todos los activos en tiempo real
    useEffect(() => {
        let mounted = true;
        const unsubscribeAssets = dataService.subscribeToAllAssets((data: StockpileAsset[]) => {
            if (mounted) setAssets(data);
        });

        // Suscripción a mediciones para historial y KPIs globales
        const unsubscribeMeasurements = dataService.subscribeToMeasurementsAll((data: StockpileMeasurement[]) => {
            if (mounted) {
                const grouped = data.reduce((acc, m) => {
                    if (!acc[m.assetId]) acc[m.assetId] = [];
                    acc[m.assetId].push(m);
                    return acc;
                }, {} as Record<string, StockpileMeasurement[]>);
                
                Object.keys(grouped).forEach(id => {
                    grouped[id].sort((a, b) => b.timestamp - a.timestamp);
                });
                
                setMeasurements(grouped);
            }
        });

        return () => {
            mounted = false;
            unsubscribeAssets();
            unsubscribeMeasurements();
        };
    }, []);

    // KPIs Globales (Agregados Reales)
    const stats = useMemo(() => {
        try {
            const totalVolume = assets.reduce((acc, a) => acc + (a?.last_volume_m3 || 0), 0);
            const totalWeight = assets.reduce((acc, a) => acc + (a?.last_weight_t || 0), 0);
            const avgDensity = totalVolume > 0 ? totalWeight / totalVolume : 0;
            const mineralCount = assets.filter(a => a?.clase === 'mineral').length;
            const wasteCount = assets.filter(a => a?.clase === 'esteril').length;
            return { totalVolume, totalWeight, avgDensity, mineralCount, wasteCount };
        } catch (e) {
            console.error('[DesktopAnalytics] Error parseando KPIs:', e);
            return { totalVolume: 0, totalWeight: 0, avgDensity: 0, mineralCount: 0, wasteCount: 0 };
        }
    }, [assets]);

    // Selección automática del primer acopio al cargar
    useEffect(() => {
        if (assets.length > 0 && !selectedAssetId) {
            setSelectedAssetId(assets[0].id!);
        }
    }, [assets, selectedAssetId]);

    const selectedAsset = useMemo(() => 
        assets.find(a => a.id === selectedAssetId) || null
    , [assets, selectedAssetId]);

    const selectedHistory = useMemo(() => 
        selectedAssetId ? (measurements[selectedAssetId] || []) : []
    , [measurements, selectedAssetId]);

    const chartData = useMemo(() => {
        return [...selectedHistory].reverse().map(m => ({
            timestamp: m.timestamp,
            date: new Date(m.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }),
            volumen: m.volumen_m3,
            peso: m.peso_t,
            id: m.id
        }));
    }, [selectedHistory]);

    const selectedPoint = useMemo(() => {
        if (!selectedMeasurement) return null;
        return chartData.find(p => p.id === selectedMeasurement.id) || null;
    }, [chartData, selectedMeasurement]);

    const handleDownloadPDF = async () => {
        if (!selectedAsset) return;
        setGeneratingPdf(true);
        try {
            await downloadPDF('stockpile-report', `Reporte_${selectedAsset.name}`);
        } catch (error) {
            console.error('PDF Error:', error);
        } finally {
            setGeneratingPdf(false);
        }
    };

    const handleConfirmDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (deleteConfirmText.trim().toUpperCase() === 'ELIMINAR') {
            await dataService.deleteAsset(id);
            setDeletingId(null);
            setDeleteConfirmText('');
            if (selectedAssetId === id) {
                setSelectedAssetId(null);
                setSelectedMeasurement(null);
            }
        }
    };

    // --- Flujo de Alta de Nuevo Acopio ---
    const handleGetGPS = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setNewAssetLat(pos.coords.latitude.toFixed(6));
                    setNewAssetLng(pos.coords.longitude.toFixed(6));
                },
                (err) => console.warn('[DesktopAnalytics] Error GPS:', err),
                { enableHighAccuracy: true, timeout: 5000 }
            );
        }
    };

    const handleAssetPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setNewAssetPhoto(reader.result);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCreateAssetSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAssetName.trim()) return;
        setIsCreatingAsset(true);
        try {
            const lat = parseFloat(newAssetLat) || 0;
            const lng = parseFloat(newAssetLng) || 0;
            const newId = await dataService.createAsset({
                name: newAssetName.trim().toUpperCase(),
                clase: newAssetClase,
                location_ref: newAssetLocation.trim() || undefined,
                initial_photo_url: newAssetPhoto || undefined,
                thumbnail_url: newAssetPhoto || undefined,
                geo_point: {
                    latitude: lat,
                    longitude: lng,
                    altitude: null,
                    accuracy: 5
                }
            });
            setSelectedAssetId(newId);
            setShowNewAssetModal(false);
            setNewAssetName('');
            setNewAssetLocation('');
            setNewAssetLat('');
            setNewAssetLng('');
            setNewAssetPhoto(null);
        } catch (err: any) {
            console.error('[DesktopAnalytics] Error creando acopio:', err);
            alert(`Error al registrar acopio: ${err?.message || 'Error de almacenamiento'}`);
        } finally {
            setIsCreatingAsset(false);
        }
    };

    // --- Flujo de Alta de Nueva Medición (Cubicación) ---
    const calculatedMeasurement = useMemo(() => {
        const dens = parseFloat(measDensity) || 0;
        if (measMethod === 'DIRECT') {
            const vol = parseFloat(measVolumen) || 0;
            const mass = vol * dens;
            return { volume: vol, mass, density: dens };
        } else {
            const d1 = parseFloat(coneD1) || 0;
            const d2 = parseFloat(coneD2) || 0;
            const h = parseFloat(coneH) || 0;
            const vol = calculationEngine.calculateEllipticCone(d1, d2, h);
            const mass = vol * dens;
            return { volume: vol, mass, density: dens };
        }
    }, [measMethod, measVolumen, measDensity, coneD1, coneD2, coneH]);

    const handleMeasPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setMeasPhoto(reader.result);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCreateMeasurementSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAssetId || calculatedMeasurement.volume <= 0) return;
        setIsSavingMeas(true);
        try {
            await dataService.addMeasurement({
                assetId: selectedAssetId,
                timestamp: Date.now(),
                volumen_m3: calculatedMeasurement.volume,
                peso_t: calculatedMeasurement.mass,
                density_factor: calculatedMeasurement.density,
                photo_url: measPhoto || selectedAsset?.last_photo_url || '',
                method: 'manual',
                geometry: {
                    type: measMethod === 'DIRECT' ? 'PRISMOIDE' : 'CONO_ELIPTICO',
                    dimensions: measMethod === 'DIRECT' 
                        ? { volumen: calculatedMeasurement.volume } 
                        : { d1: parseFloat(coneD1) || 0, d2: parseFloat(coneD2) || 0, h: parseFloat(coneH) || 0 }
                }
            });
            setShowNewMeasurementModal(false);
            setMeasVolumen('');
            setConeD1('');
            setConeD2('');
            setConeH('');
            setMeasPhoto(null);
        } catch (err: any) {
            console.error('[DesktopAnalytics] Error guardando cubicación:', err);
            alert(`Error al guardar medición: ${err?.message || 'Error de almacenamiento'}`);
        } finally {
            setIsSavingMeas(false);
        }
    };

    return (
        <div className={`bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] font-atkinson flex flex-col antialiased overflow-hidden select-none transition-colors duration-200 ${embedded ? "h-full w-full" : "h-screen"}`}>
            
            {/* PLUGIN HEADER (Solo en modo standalone) */}
            {!embedded && (
                <header className="h-14 border-b border-slate-200 dark:border-[#12151C] flex items-center justify-between px-6 bg-slate-50 dark:bg-[#07090D] z-20">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#C68346] text-xl">layers</span>
                        <h1 className="text-xs font-bold font-mono uppercase tracking-[0.2em] text-slate-900 dark:text-[#F3F4F6]">
                            STOCKPILE CONTROL CENTER
                        </h1>
                    </div>
                </header>
            )}

            {/* MAIN LAYOUT */}
            <main className="flex-1 flex flex-col overflow-hidden">
                
                {/* TOP HUD: GLOBAL KPIs TÉCNICOS */}
                <section className="h-16 border-b border-slate-200 dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center px-4 overflow-hidden shrink-0">
                    <div className="flex items-center h-full px-6 border-r border-slate-200 dark:border-[#12151C]">
                        <span className="text-[10px] font-bold font-mono opacity-40 uppercase tracking-widest mr-4">ACTIVOS</span>
                        <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6]">{assets.length}</div>
                    </div>
                    <div className="flex items-center h-full px-6 border-r border-slate-200 dark:border-[#12151C]">
                        <span className="text-[10px] font-bold font-mono opacity-40 uppercase tracking-widest mr-4">VOLUMEN TOTAL</span>
                        <div className="text-2xl font-bold font-mono tabular-nums text-[#C68346]">
                            {stats.totalVolume.toLocaleString('es-CL', { maximumFractionDigits: 1 })} <span className="text-xs text-slate-400 font-sans ml-0.5">m³</span>
                        </div>
                    </div>
                    <div className="flex items-center h-full px-6 border-r border-slate-200 dark:border-[#12151C]">
                        <span className="text-[10px] font-bold font-mono opacity-40 uppercase tracking-widest mr-4">MASA TOTAL</span>
                        <div className="text-2xl font-bold font-mono tabular-nums text-[#C68346]">
                            {stats.totalWeight.toLocaleString('es-CL', { maximumFractionDigits: 0 })} <span className="text-xs text-slate-400 font-sans ml-0.5">t</span>
                        </div>
                    </div>
                    <div className="flex-1 flex items-center justify-end px-6 gap-3">
                        <span className="text-[9px] font-mono uppercase text-slate-400">MINERAL / ESTÉRIL</span>
                        <div className="w-24 h-1.5 bg-black/10 dark:bg-white/10 rounded-none overflow-hidden flex">
                            <div className="h-full bg-[#C68346]" style={{ width: `${(stats.mineralCount / (assets.length || 1)) * 100}%` }} title={`Mineral: ${stats.mineralCount}`} />
                            <div className="h-full bg-slate-400" style={{ width: `${(stats.wasteCount / (assets.length || 1)) * 100}%` }} title={`Estéril: ${stats.wasteCount}`} />
                        </div>
                    </div>
                </section>

                {/* MACRO-LAYOUT PARAMÉTRICO: PROPORCIÓN ÁUREA 1:1.618 (38.2% LATERAL / 61.8% PRINCIPAL) */}
                <div className="flex-1 flex overflow-hidden">
                    
                    {/* ÁREA MENOR (1 - Φ ≈ 38.2%): PANEL ESTRUCTURADO LATERAL */}
                    <section className="w-[38.2%] min-w-[340px] max-w-[460px] border-r border-slate-200 dark:border-[#12151C] flex flex-col bg-slate-50/50 dark:bg-[#07090D] z-10 shrink-0 overflow-hidden">
                        
                        {/* Cabecera Técnica del Panel Lateral */}
                        <div className="p-3 border-b border-slate-200 dark:border-[#12151C] flex items-center justify-between bg-white dark:bg-[#030406]">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold font-mono text-slate-400 dark:text-[#8A93A6] uppercase tracking-wider">
                                    ACOPIOS REGISTRADOS ({assets.length})
                                </span>
                            </div>
                            
                            {/* Botón Primario: Registrar Nuevo Acopio */}
                            <button
                                type="button"
                                onClick={() => setShowNewAssetModal(true)}
                                className="h-8 px-3 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-[11px] uppercase tracking-wider transition-colors rounded-none shadow-none flex items-center gap-1.5 cursor-pointer border-0 outline-none select-none"
                                title="Crear nuevo acopio en el sistema"
                            >
                                <span className="material-symbols-outlined text-[16px]">add</span>
                                <span>NUEVO ACOPIO</span>
                            </button>
                        </div>

                        {/* Pestañas de Alternancia: Lista de Acopios vs Historial del Activo */}
                        <div className="flex border-b border-slate-200 dark:border-[#12151C] bg-slate-100/60 dark:bg-black">
                            <button
                                type="button"
                                onClick={() => setSidebarTab('assets')}
                                className={`flex-1 py-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors border-b-2 rounded-none cursor-pointer ${
                                    sidebarTab === 'assets'
                                        ? 'border-[#C68346] text-[#C68346] bg-white dark:bg-[#07090D]'
                                        : 'border-transparent text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                Catálogo Acopios
                            </button>
                            <button
                                type="button"
                                onClick={() => setSidebarTab('history')}
                                className={`flex-1 py-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors border-b-2 rounded-none cursor-pointer ${
                                    sidebarTab === 'history'
                                        ? 'border-[#C68346] text-[#C68346] bg-white dark:bg-[#07090D]'
                                        : 'border-transparent text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                Historial Medición ({selectedHistory.length})
                            </button>
                        </div>

                        {/* Contenido Dinámico de la Columna Lateral */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            
                            {/* TAB 1: LISTA MAESTRA DE ACOPIOS */}
                            {sidebarTab === 'assets' && (
                                <div className="divide-y divide-slate-200 dark:divide-[#12151C]">
                                    {assets.length === 0 ? (
                                        <div className="p-8 text-center text-slate-400 font-mono text-xs flex flex-col items-center gap-3">
                                            <span className="material-symbols-outlined text-4xl opacity-30">inventory_2</span>
                                            <p className="uppercase tracking-widest text-[10px]">Sin acopios registrados</p>
                                            <button
                                                onClick={() => setShowNewAssetModal(true)}
                                                className="px-3 py-1.5 bg-[#C68346] text-white font-mono text-xs uppercase tracking-wider rounded-none cursor-pointer border-0"
                                            >
                                                [+] Crear Primer Acopio
                                            </button>
                                        </div>
                                    ) : (
                                        assets.map(asset => {
                                            const isSelected = selectedAssetId === asset.id;
                                            const assetMeas = measurements[asset.id!] || [];
                                            const lastMeas = assetMeas[0];
                                            const isDeleting = deletingId === asset.id;

                                            if (isDeleting) {
                                                return (
                                                    <div key={asset.id} className="p-4 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-900/40 flex flex-col gap-2">
                                                        <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                                                            Escriba ELIMINAR para confirmar borrado de "{asset.name}"
                                                        </p>
                                                        <input
                                                            type="text"
                                                            value={deleteConfirmText}
                                                            onChange={e => setDeleteConfirmText(e.target.value)}
                                                            placeholder="ELIMINAR"
                                                            autoComplete="off"
                                                            spellCheck={false}
                                                            className="w-full h-8 px-2 text-xs font-mono uppercase bg-white dark:bg-black border border-red-300 dark:border-red-900 outline-none rounded-none"
                                                            autoFocus
                                                        />
                                                        <div className="flex gap-2 justify-end mt-1">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); setDeletingId(null); setDeleteConfirmText(''); }}
                                                                className="px-2 py-1 text-[10px] font-mono bg-transparent text-slate-500 uppercase border-0 cursor-pointer"
                                                            >
                                                                Cancelar
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleConfirmDelete(e, asset.id!)}
                                                                disabled={deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR'}
                                                                className="px-3 py-1 text-[10px] font-mono font-bold bg-red-600 text-white uppercase rounded-none cursor-pointer disabled:opacity-40 border-0"
                                                            >
                                                                Confirmar
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <div
                                                    key={asset.id}
                                                    onClick={() => {
                                                        setSelectedAssetId(asset.id!);
                                                        const assetMeas = measurements[asset.id!] || [];
                                                        setSelectedMeasurement(assetMeas[0] || null);
                                                    }}
                                                    className={`p-3.5 cursor-pointer transition-colors relative group flex flex-col gap-2 ${
                                                        isSelected
                                                            ? 'bg-[#C68346]/10 border-l-4 border-l-[#C68346]'
                                                            : 'hover:bg-black/5 dark:hover:bg-white/5 border-l-4 border-l-transparent'
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-center pr-6">
                                                        <span className="font-bold text-xs uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6] truncate">
                                                            {asset.name}
                                                        </span>
                                                        <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-none ${
                                                            asset.clase === 'mineral'
                                                                ? 'bg-[#C68346] text-white'
                                                                : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                                                        }`}>
                                                            {asset.clase}
                                                        </span>
                                                    </div>

                                                    <div className="flex justify-between items-end text-[11px] font-mono">
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-bold opacity-40 uppercase">VOLUMEN</span>
                                                            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-[#F3F4F6]">
                                                                {asset.last_volume_m3 ? asset.last_volume_m3.toFixed(1) : '0.0'} m³
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col text-right">
                                                            <span className="text-[8px] font-bold opacity-40 uppercase">ÚLTIMO REGISTRO</span>
                                                            <span className="tabular-nums text-slate-500">
                                                                {lastMeas ? new Date(lastMeas.timestamp).toLocaleDateString('es-CL', { month: 'short', day: '2-digit' }) : 'Sin datos'}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Botón eliminar discreto */}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDeletingId(asset.id!);
                                                            setDeleteConfirmText('');
                                                        }}
                                                        className="absolute right-2 top-3 w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-500 text-slate-400 transition-all bg-transparent border-0 cursor-pointer"
                                                        title="Eliminar activo"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}

                            {/* TAB 2: HISTORIAL CRONOLÓGICO */}
                            {sidebarTab === 'history' && (
                                <div className="p-3 space-y-2">
                                    {selectedHistory.length === 0 ? (
                                        <div className="p-8 text-center text-slate-400 font-mono text-xs">
                                            Sin mediciones registradas en este acopio.
                                        </div>
                                    ) : (
                                        selectedHistory.map((m, i) => {
                                            const prev = selectedHistory[i + 1];
                                            const diff = prev ? m.volumen_m3 - prev.volumen_m3 : 0;
                                            const isSelected = selectedMeasurement?.id === m.id;
                                            return (
                                                <div
                                                    key={m.id}
                                                    onClick={() => setSelectedMeasurement(m)}
                                                    className={`p-3 border transition-colors cursor-pointer rounded-none flex flex-col gap-1.5 ${
                                                        isSelected
                                                            ? 'border-[#C68346] bg-[#C68346]/10'
                                                            : 'border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] hover:border-slate-400'
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-center text-xs">
                                                        <span className="font-mono text-slate-500">
                                                            {new Date(m.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                        <span className="font-mono font-bold text-sm tabular-nums text-[#C68346]">
                                                            {m.volumen_m3.toFixed(1)} m³
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                                                        <span>Masa: {m.peso_t.toFixed(0)} t</span>
                                                        {diff !== 0 && (
                                                            <span className={`font-bold ${diff > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                                {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} m³
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}

                        </div>
                    </section>

                    {/* ÁREA MAYOR (Φ ≈ 61.8%): ESPACIO ANALÍTICO Y CUBICACIÓN MONUMENTAL */}
                    <section className="flex-1 bg-white dark:bg-[#000000] flex flex-col overflow-hidden">
                        {selectedAsset ? (
                            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-300">
                                
                                {/* Header Técnico Superior de la Unidad Activa */}
                                <div className="p-6 border-b border-slate-200 dark:border-[#12151C] flex justify-between items-center bg-[#F8FAFC]/50 dark:bg-[#07090D]/50 shrink-0">
                                    <div>
                                        <div className="text-[10px] font-mono font-bold text-[#C68346] uppercase tracking-[0.3em] mb-1">
                                            ESPACIO ANALÍTICO DE CUBICACIÓN
                                        </div>
                                        <h2 className="text-2xl font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                                            {selectedAsset.name}
                                        </h2>
                                    </div>

                                    {/* Acciones Primarias: Nueva Medición & Reporte PDF */}
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setShowNewMeasurementModal(true)}
                                            className="h-9 px-4 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider transition-colors rounded-none shadow-none flex items-center gap-2 cursor-pointer border-0 outline-none select-none"
                                            title="Ingresar nueva cubicación o medición para este acopio"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">straighten</span>
                                            <span>NUEVA MEDICIÓN</span>
                                        </button>

                                        <button 
                                            type="button"
                                            onClick={handleDownloadPDF}
                                            disabled={generatingPdf}
                                            className="h-9 px-3 bg-transparent border border-slate-300 dark:border-[#12151C] text-slate-700 dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346] font-mono text-xs uppercase tracking-wider transition-colors rounded-none shadow-none flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                                            title="Descargar informe técnico PDF"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                                            <span className="hidden sm:inline">REPORTE</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Cuerpo Analítico con Scroll */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                                    
                                    {/* Gráfico Volumétrico */}
                                    <div className="w-full bg-slate-50 dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-4 relative">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-[#8A93A6] uppercase tracking-wider">
                                                EVOLUCIÓN VOLUMÉTRICA HISTÓRICA (m³)
                                            </span>
                                            <span className="text-[10px] font-mono text-[#C68346]">
                                                {chartData.length} registros cronológicos
                                            </span>
                                        </div>

                                        <div className="h-64 w-full">
                                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                                                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#C68346" stopOpacity={0.35}/>
                                                            <stop offset="95%" stopColor="#C68346" stopOpacity={0.0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#12151C' : '#E2E8F0'} vertical={false} />
                                                    <XAxis 
                                                        dataKey="timestamp" 
                                                        axisLine={false} 
                                                        tickLine={false} 
                                                        tick={{ fontSize: 9, fill: '#8A93A6', fontFamily: 'monospace' }}
                                                        tickFormatter={(t) => new Date(t).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                                                    />
                                                    <YAxis 
                                                        axisLine={false} 
                                                        tickLine={false} 
                                                        tick={{ fontSize: 9, fill: '#8A93A6', fontFamily: 'monospace' }} 
                                                    />
                                                    <Tooltip 
                                                        contentStyle={{ 
                                                            backgroundColor: theme === 'dark' ? '#07090D' : '#FFFFFF', 
                                                            border: '1px solid #C68346', 
                                                            fontSize: '11px', 
                                                            borderRadius: '0px',
                                                            fontFamily: 'monospace',
                                                            color: theme === 'dark' ? '#F3F4F6' : '#0F172A'
                                                        }}
                                                        itemStyle={{ color: '#C68346', fontWeight: 'bold' }}
                                                        labelFormatter={(t: any) => new Date(Number(t) || 0).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                    />
                                                    <Area 
                                                        type="monotone" 
                                                        dataKey="volumen" 
                                                        stroke="#C68346" 
                                                        strokeWidth={2}
                                                        fillOpacity={1} 
                                                        fill="url(#volGradient)" 
                                                        animationDuration={800}
                                                    />
                                                    {selectedPoint && (
                                                        <ReferenceDot 
                                                            x={selectedPoint.timestamp} 
                                                            y={selectedPoint.volumen} 
                                                            r={6} 
                                                            fill="#C68346" 
                                                            stroke="#FFFFFF" 
                                                            strokeWidth={2} 
                                                        />
                                                    )}
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>

                                    {/* Grilla de KPIs Técnicos */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="bg-slate-50 dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-5">
                                            <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-[#8A93A6] uppercase tracking-wider block mb-2">
                                                VOLUMEN CUBICADO
                                            </span>
                                            <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6]">
                                                {selectedAsset.last_volume_m3 ? selectedAsset.last_volume_m3.toFixed(1) : '0.0'}
                                                <span className="text-xs text-slate-400 font-sans ml-1">m³</span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-5">
                                            <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-[#8A93A6] uppercase tracking-wider block mb-2">
                                                MASA ESTIMADA
                                            </span>
                                            <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6]">
                                                {selectedAsset.last_weight_t ? selectedAsset.last_weight_t.toFixed(0) : '0'}
                                                <span className="text-xs text-slate-400 font-sans ml-1">t</span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-5">
                                            <span className="text-[10px] font-mono font-bold text-[#C68346] uppercase tracking-wider block mb-2">
                                                DENSIDAD FACTOR
                                            </span>
                                            <div className="text-3xl font-bold font-mono tabular-nums text-[#C68346]">
                                                {(selectedAsset.last_weight_t && selectedAsset.last_volume_m3 ? selectedAsset.last_weight_t / selectedAsset.last_volume_m3 : 2.2).toFixed(2)}
                                                <span className="text-xs text-slate-400 font-sans ml-1">t/m³</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tira de Trazabilidad GPS */}
                                    <div className="bg-slate-50 dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] px-5 py-3 grid grid-cols-3 gap-4 font-mono text-xs">
                                        <div>
                                            <span className="text-[9px] uppercase text-slate-400 block mb-0.5">LATITUD</span>
                                            <span className="font-bold tabular-nums">
                                                {selectedAsset.geo_point?.latitude.toFixed(6) || '0.000000'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase text-slate-400 block mb-0.5">LONGITUD</span>
                                            <span className="font-bold tabular-nums">
                                                {selectedAsset.geo_point?.longitude.toFixed(6) || '0.000000'}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[9px] uppercase text-slate-400 block mb-0.5">UBICACIÓN / REFERENCIA</span>
                                            <span className="text-slate-600 dark:text-slate-300 truncate block">
                                                {selectedAsset.location_ref || '[Información técnica no declarada en ficha]'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Evidencias Técnicas: Foto y Mapa */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-56">
                                        <div className="border border-slate-200 dark:border-[#12151C] bg-black relative overflow-hidden flex flex-col justify-center items-center">
                                            <span className="absolute top-2 left-3 text-[9px] font-mono font-bold uppercase tracking-wider text-white/50 z-10">
                                                ÚLTIMA FOTOGRAFÍA REGISTRADA
                                            </span>
                                            {selectedAsset.last_photo_url ? (
                                                <img 
                                                    src={selectedAsset.last_photo_url} 
                                                    alt="Evidencia fotográfica" 
                                                    className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity"
                                                />
                                            ) : (
                                                <div className="flex flex-col items-center justify-center opacity-30 gap-1 text-white">
                                                    <span className="material-symbols-outlined text-4xl">no_photography</span>
                                                    <span className="text-[10px] font-mono uppercase tracking-widest">[Sin registro visual]</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="border border-slate-200 dark:border-[#12151C] bg-[#030406] relative overflow-hidden flex flex-col justify-center items-center">
                                            <span className="absolute top-2 left-3 text-[9px] font-mono font-bold uppercase tracking-wider text-[#C68346] z-10">
                                                MAPA GEORREFERENCIADO
                                            </span>
                                            {(() => {
                                                const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY;
                                                const lat = selectedAsset.geo_point?.latitude;
                                                const lng = selectedAsset.geo_point?.longitude;

                                                if (apiKey && lat && lng) {
                                                    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=600x600&maptype=satellite&scale=2&markers=color:0xC68346%7C${lat},${lng}&key=${apiKey}`;
                                                    return (
                                                        <img 
                                                            src={mapUrl} 
                                                            className="w-full h-full object-cover opacity-70 hover:opacity-100 transition-opacity" 
                                                            alt="Satélite" 
                                                        />
                                                    );
                                                }
                                                return (
                                                    <div className="flex flex-col items-center justify-center text-slate-500 font-mono text-[10px] gap-1">
                                                        <span className="material-symbols-outlined text-3xl opacity-30">map</span>
                                                        <span>COMODÍN SATELITAL ({lat ? lat.toFixed(4) : '0'}, {lng ? lng.toFixed(4) : '0'})</span>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>

                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-mono text-xs gap-3">
                                <span className="material-symbols-outlined text-5xl opacity-20">layers</span>
                                <p className="uppercase tracking-widest">Seleccione o registre un acopio para ver analítica</p>
                                <button
                                    onClick={() => setShowNewAssetModal(true)}
                                    className="px-4 py-2 bg-[#C68346] text-white font-mono text-xs font-bold uppercase tracking-wider rounded-none cursor-pointer border-0"
                                >
                                    [+] REGISTRAR ACOPIO
                                </button>
                            </div>
                        )}
                    </section>

                </div>

                {/* MODAL 1: REGISTRAR NUEVO ACOPIO */}
                {showNewAssetModal && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="w-full max-w-md bg-white dark:bg-[#07090D] border border-slate-300 dark:border-[#12151C] shadow-none rounded-none p-6 font-atkinson">
                            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3 mb-4">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[#C68346]">layers</span>
                                    <h3 className="font-bold font-mono text-sm uppercase tracking-wider text-slate-900 dark:text-[#F3F4F6]">
                                        REGISTRAR NUEVO ACOPIO
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowNewAssetModal(false)}
                                    className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white bg-transparent border-0 cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>

                            <form onSubmit={handleCreateAssetSubmit} className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        NOMBRE / CÓDIGO DEL ACOPIO *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={newAssetName}
                                        onChange={(e) => setNewAssetName(e.target.value)}
                                        placeholder="EJ: STOCK-01 MINERAL OXIDO"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full h-10 px-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono font-bold uppercase focus:border-[#C68346] outline-none rounded-none"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        CLASE DE MATERIAL
                                    </label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['mineral', 'esteril', 'baja_ley'] as const).map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setNewAssetClase(c)}
                                                className={`py-2 text-[10px] font-mono font-bold uppercase rounded-none border transition-colors cursor-pointer ${
                                                    newAssetClase === c
                                                        ? 'bg-[#C68346] text-white border-[#C68346]'
                                                        : 'bg-transparent border-slate-200 dark:border-[#12151C] text-slate-600 dark:text-slate-400'
                                                }`}
                                            >
                                                {c}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        UBICACIÓN / BANCO / FAENA
                                    </label>
                                    <input
                                        type="text"
                                        value={newAssetLocation}
                                        onChange={(e) => setNewAssetLocation(e.target.value)}
                                        placeholder="EJ: SECTOR NORTE BANCO 1450"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full h-10 px-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono uppercase focus:border-[#C68346] outline-none rounded-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                            LATITUD GPS
                                        </label>
                                        <input
                                            type="text"
                                            value={newAssetLat}
                                            onChange={(e) => setNewAssetLat(e.target.value)}
                                            placeholder="-23.8631"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full h-8 px-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono focus:border-[#C68346] outline-none rounded-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                            LONGITUD GPS
                                        </label>
                                        <input
                                            type="text"
                                            value={newAssetLng}
                                            onChange={(e) => setNewAssetLng(e.target.value)}
                                            placeholder="-69.1382"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full h-8 px-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono focus:border-[#C68346] outline-none rounded-none"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleGetGPS}
                                    className="w-full py-1 text-[10px] font-mono text-[#C68346] hover:underline bg-transparent border-0 cursor-pointer flex items-center justify-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-[14px]">my_location</span>
                                    Detectar coordenadas actuales
                                </button>

                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        FOTOGRAFÍA INICIAL (OPCIONAL)
                                    </label>
                                    <input
                                        type="file"
                                        ref={assetFileInputRef}
                                        accept="image/*"
                                        onChange={handleAssetPhotoUpload}
                                        className="hidden"
                                    />
                                    <div 
                                        onClick={() => assetFileInputRef.current?.click()}
                                        className="w-full h-20 border border-dashed border-slate-300 dark:border-[#12151C] flex flex-col items-center justify-center cursor-pointer hover:border-[#C68346] bg-slate-50 dark:bg-black/40 overflow-hidden"
                                    >
                                        {newAssetPhoto ? (
                                            <img src={newAssetPhoto} className="w-full h-full object-cover" alt="Preview" />
                                        ) : (
                                            <div className="flex flex-col items-center text-slate-400 gap-1">
                                                <span className="material-symbols-outlined text-2xl">add_photo_alternate</span>
                                                <span className="text-[10px] font-mono uppercase">Subir o tomar fotografía</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-[#12151C]">
                                    <button
                                        type="button"
                                        onClick={() => setShowNewAssetModal(false)}
                                        className="flex-1 h-10 border border-slate-300 dark:border-[#12151C] font-mono text-xs uppercase text-slate-600 dark:text-slate-400 rounded-none bg-transparent cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreatingAsset || !newAssetName.trim()}
                                        className="flex-1 h-10 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider rounded-none shadow-none disabled:opacity-50 cursor-pointer border-0"
                                    >
                                        {isCreatingAsset ? 'Guardando...' : 'GUARDAR ACOPIO'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* MODAL 2: REGISTRAR NUEVA MEDICIÓN / CUBICACIÓN */}
                {showNewMeasurementModal && selectedAsset && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="w-full max-w-md bg-white dark:bg-[#07090D] border border-slate-300 dark:border-[#12151C] shadow-none rounded-none p-6 font-atkinson">
                            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3 mb-4">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[#C68346]">straighten</span>
                                    <div>
                                        <h3 className="font-bold font-mono text-sm uppercase tracking-wider text-slate-900 dark:text-[#F3F4F6]">
                                            NUEVA CUBICACIÓN
                                        </h3>
                                        <p className="text-[10px] font-mono text-[#C68346] uppercase">
                                            {selectedAsset.name}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowNewMeasurementModal(false)}
                                    className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white bg-transparent border-0 cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>

                            <form onSubmit={handleCreateMeasurementSubmit} className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        MÉTODO DE INGRESO
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setMeasMethod('DIRECT')}
                                            className={`py-2 text-[10px] font-mono font-bold uppercase rounded-none border transition-colors cursor-pointer ${
                                                measMethod === 'DIRECT'
                                                    ? 'bg-[#C68346] text-white border-[#C68346]'
                                                    : 'bg-transparent border-slate-200 dark:border-[#12151C] text-slate-600 dark:text-slate-400'
                                            }`}
                                        >
                                            Cubicación Directa (m³)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMeasMethod('ELLIPTIC_CONE')}
                                            className={`py-2 text-[10px] font-mono font-bold uppercase rounded-none border transition-colors cursor-pointer ${
                                                measMethod === 'ELLIPTIC_CONE'
                                                    ? 'bg-[#C68346] text-white border-[#C68346]'
                                                    : 'bg-transparent border-slate-200 dark:border-[#12151C] text-slate-600 dark:text-slate-400'
                                            }`}
                                        >
                                            Cono Elíptico (d1, d2, h)
                                        </button>
                                    </div>
                                </div>

                                {measMethod === 'DIRECT' ? (
                                    <div>
                                        <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                            VOLUMEN ESTIMADO (m³) *
                                        </label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            required
                                            value={measVolumen}
                                            onChange={(e) => setMeasVolumen(e.target.value)}
                                            placeholder="EJ: 12500.5"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full h-10 px-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-sm font-mono font-bold tabular-nums focus:border-[#C68346] outline-none rounded-none"
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                                    DIÁM. MAYOR (m)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={coneD1}
                                                    onChange={(e) => setConeD1(e.target.value)}
                                                    placeholder="45.0"
                                                    autoComplete="off"
                                                    className="w-full h-9 px-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono tabular-nums focus:border-[#C68346] outline-none rounded-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                                    DIÁM. MENOR (m)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={coneD2}
                                                    onChange={(e) => setConeD2(e.target.value)}
                                                    placeholder="30.0"
                                                    autoComplete="off"
                                                    className="w-full h-9 px-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono tabular-nums focus:border-[#C68346] outline-none rounded-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                                    ALTURA (m)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={coneH}
                                                    onChange={(e) => setConeH(e.target.value)}
                                                    placeholder="12.5"
                                                    autoComplete="off"
                                                    className="w-full h-9 px-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono tabular-nums focus:border-[#C68346] outline-none rounded-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        DENSIDAD ESTIMADA (t/m³)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={measDensity}
                                        onChange={(e) => setMeasDensity(e.target.value)}
                                        placeholder="2.20"
                                        autoComplete="off"
                                        className="w-full h-10 px-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-[#12151C] text-xs font-mono font-bold tabular-nums focus:border-[#C68346] outline-none rounded-none"
                                    />
                                </div>

                                {/* Preview de Cálculo en Tiempo Real */}
                                <div className="p-3 bg-slate-100 dark:bg-black border border-slate-200 dark:border-[#12151C] flex justify-between items-center text-xs font-mono">
                                    <div>
                                        <span className="text-[9px] opacity-40 uppercase block">VOLUMEN CALCULADO</span>
                                        <span className="font-bold text-sm text-[#C68346] tabular-nums">
                                            {calculatedMeasurement.volume.toFixed(1)} m³
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[9px] opacity-40 uppercase block">MASA RESULTANTE</span>
                                        <span className="font-bold text-sm text-slate-900 dark:text-[#F3F4F6] tabular-nums">
                                            {calculatedMeasurement.mass.toFixed(0)} t
                                        </span>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-mono font-bold uppercase text-slate-500 block mb-1">
                                        FOTO DE EVIDENCIA (OPCIONAL)
                                    </label>
                                    <input
                                        type="file"
                                        ref={measFileInputRef}
                                        accept="image/*"
                                        onChange={handleMeasPhotoUpload}
                                        className="hidden"
                                    />
                                    <div 
                                        onClick={() => measFileInputRef.current?.click()}
                                        className="w-full h-16 border border-dashed border-slate-300 dark:border-[#12151C] flex flex-col items-center justify-center cursor-pointer hover:border-[#C68346] bg-slate-50 dark:bg-black/40 overflow-hidden"
                                    >
                                        {measPhoto ? (
                                            <img src={measPhoto} className="w-full h-full object-cover" alt="Preview Medición" />
                                        ) : (
                                            <span className="text-[10px] font-mono uppercase text-slate-400">
                                                Adjuntar captura de cota / evidencia
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-[#12151C]">
                                    <button
                                        type="button"
                                        onClick={() => setShowNewMeasurementModal(false)}
                                        className="flex-1 h-10 border border-slate-300 dark:border-[#12151C] font-mono text-xs uppercase text-slate-600 dark:text-slate-400 rounded-none bg-transparent cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSavingMeas || calculatedMeasurement.volume <= 0}
                                        className="flex-1 h-10 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider rounded-none shadow-none disabled:opacity-50 cursor-pointer border-0"
                                    >
                                        {isSavingMeas ? 'Guardando...' : 'GUARDAR CUBICACIÓN'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Componente Oculto de Reporte para Generación de PDF */}
                <div className="fixed top-[5000px] left-0 w-[210mm] overflow-hidden pointer-events-none opacity-0">
                    {selectedAsset && (
                        <StockpileSummary asset={selectedAsset} history={selectedHistory} />
                    )}
                </div>

            </main>
        </div>
    );
};

export default DesktopAnalytics;
