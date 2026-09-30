import { Stockpile3DViewer } from './Stockpile3DViewer';
import React, { useState, useEffect } from 'react';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { offlineStorage, StockpileSurveyRecord } from '../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import { Layers, Scan, ArrowUpRight, AlertCircle, Calculator, X, Check } from 'lucide-react';
import { calculationEngine, StockpileCalculationInput } from './calculation-engine';

interface StockpileRecord {
    id: string;
    tag: string;
    material: string;
    shape: 'elliptic-cone' | 'truncated-elliptic-cone' | 'perimeter-cone';
    volumeM3: number;
    density: number;
    tonnage: number;
    lastSurvey: string;
    confidence: number;
}

const INITIAL_STOCKPILES: StockpileRecord[] = [
    { id: 'STK-01', tag: 'STOCK-SULF-01', material: 'Sulfuro Primario Cu-Mo', shape: 'elliptic-cone', volumeM3: 42350, density: 2.15, tonnage: 91052.5, lastSurvey: '2026-09-28 08:30', confidence: 98.4 },
    { id: 'STK-02', tag: 'STOCK-OX-04', material: 'Óxidos Lixiviables', shape: 'truncated-elliptic-cone', volumeM3: 18120, density: 1.82, tonnage: 32978.4, lastSurvey: '2026-09-29 16:15', confidence: 97.8 },
    { id: 'STK-03', tag: 'STOCK-ROM-02', material: 'Run-of-Mine Alta Ley', shape: 'elliptic-cone', volumeM3: 84600, density: 2.20, tonnage: 186120.0, lastSurvey: '2026-09-30 06:00', confidence: 99.1 },
    { id: 'STK-04', tag: 'STOCK-LAST-09', material: 'Estéril / Ripios Lixiviados', shape: 'truncated-elliptic-cone', volumeM3: 125000, density: 1.65, tonnage: 206250.0, lastSurvey: '2026-09-27 11:20', confidence: 96.9 }
];

export const StockpileModule: React.FC = () => {
    const { session } = useMinReportSession();
    const isEdu = session?.isEduSandbox;

    const [stockpiles, setStockpiles] = useState<StockpileRecord[]>(INITIAL_STOCKPILES);
    const [isCalcOpen, setIsCalcOpen] = useState(false);
    const [selectedDetail, setSelectedDetail] = useState<StockpileRecord | null>(null);
    const [active3DStk, setActive3DStk] = useState<StockpileRecord | null>(INITIAL_STOCKPILES[0]);

    // Formulario de cálculo
    const [calcForm, setCalcForm] = useState<StockpileCalculationInput & { tag: string; material: string }>({
        tag: `STK-CALC-${stockpiles.length + 1}`,
        material: 'Sulfuro Primario',
        shape: 'elliptic-cone',
        d1: 45,
        d2: 30,
        h: 12,
        density: 2.10
    });

    const liveOutput = calculationEngine.compute(calcForm);

    // Carga inicial y persistencia reactiva desde IndexedDB (EDGE-OPTIMIZER)
    useEffect(() => {
        const loadOfflineSurveys = async () => {
            try {
                const stored = await offlineStorage.getStockpileSurveys();
                if (stored && stored.length > 0) {
                    setStockpiles(prev => {
                        const existingIds = new Set(prev.map(p => p.id));
                        const newItems = stored.filter(s => !existingIds.has(s.id));
                        return [...newItems, ...prev];
                    });
                }
            } catch (err) {
                console.warn('[STOCKPILE] Error al leer mediciones locales:', err);
            }
        };
        loadOfflineSurveys();
    }, []);

    const handleSaveCalculation = async (e: React.FormEvent) => {
        e.preventDefault();
        const newRecord: StockpileRecord = {
            id: `STK-${Date.now().toString().slice(-4)}`,
            tag: calcForm.tag.trim() || `STK-${Date.now().toString().slice(-4)}`,
            material: calcForm.material,
            shape: calcForm.shape,
            volumeM3: liveOutput.volumeM3,
            density: calcForm.density,
            tonnage: liveOutput.tonnage,
            lastSurvey: new Date().toISOString().replace('T', ' ').slice(0, 16),
            confidence: liveOutput.confidence
        };

        // 1. Escritura instantánea en almacenamiento local (IndexedDB)
        const surveyRecord: StockpileSurveyRecord = {
            ...newRecord,
            timestamp: Date.now(),
            synced: false
        };

        try {
            await offlineStorage.saveStockpileSurvey(surveyRecord);
            // 2. Encolar tarea de sincronización idempotente
            await syncQueueEngine.enqueueTask('STOCKPILE_SURVEY', surveyRecord, `task_${surveyRecord.id}`);
        } catch (err) {
            console.error('[STOCKPILE] Error al persistir cubicación localmente:', err);
        }

        setStockpiles(prev => [newRecord, ...prev]);
        setIsCalcOpen(false);
    };

    const totalVolume = stockpiles.reduce((acc, curr) => acc + curr.volumeM3, 0);
    const totalTonnage = stockpiles.reduce((acc, curr) => acc + curr.tonnage, 0);

    return (
        <div className="space-y-6">
            {/* Aviso de Sandbox Académico si aplica */}
            {isEdu && (
                <div className="p-3 bg-amber-500/10 border-l-2 border-amber-500 text-amber-700 dark:text-amber-400 text-xs flex items-center justify-between font-mono">
                    <div className="flex items-center gap-2">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>[MODO LABORATORIO DOCENTE]: Datasets volumétricos simulados. Restringido escaneo LiDAR en tiempo real.</span>
                    </div>
                    <span className="text-[9px] bg-amber-500/20 px-2 py-0.5 uppercase tracking-widest font-bold">EDU_SANDBOX</span>
                </div>
            )}

            {/* Header del Módulo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-black/5 dark:border-white/10 pb-4">
                <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8A93A6]">
                        <Layers size={14} className="text-[#00AEEF]" />
                        <span>MÓDULO DE CUBICACIONES Y VOLUMETRÍA TOPOGRÁFICA</span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                        Control de Acopios STOCKPILE
                    </h1>
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setIsCalcOpen(true)}
                        className="px-4 py-2 bg-[#0F172A] dark:bg-[#00AEEF] text-white dark:text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity rounded-none flex items-center gap-2"
                    >
                        <Calculator size={14} />
                        <span>Nueva Cubicación</span>
                    </button>
                    <button 
                        disabled={isEdu}
                        className="px-4 py-2 border border-black/10 dark:border-white/15 text-xs font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5 transition-colors rounded-none flex items-center gap-2 disabled:opacity-40"
                    >
                        <Scan size={14} />
                        <span>Captura Sensor LiDAR</span>
                    </button>
                </div>
            </div>

            {/* Métricas Volumétricas Totales */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Volumen Acumulado</p>
                    <p className="text-2xl font-bold font-mono tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {totalVolume.toLocaleString('es-CL', { maximumFractionDigits: 1 })} m³
                    </p>
                    <p className="text-[10px] text-[#8A93A6] mt-1">{stockpiles.length} acopios monitoreados</p>
                </div>

                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Tonelaje Total Estimado</p>
                    <p className="text-2xl font-bold font-mono tracking-tight text-[#00AEEF] mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {totalTonnage.toLocaleString('es-CL', { maximumFractionDigits: 1 })} Ton
                    </p>
                    <p className="text-[10px] text-[#8A93A6] mt-1">Densidad ponderada en faena</p>
                </div>

                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Confiabilidad Topográfica</p>
                    <p className="text-2xl font-bold font-mono tracking-tight text-emerald-500 mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        98.2% P95
                    </p>
                    <p className="text-[10px] text-[#8A93A6] mt-1">Cálculo analítico & sensor fusion</p>
                </div>
            </div>

            {/* [CAPA 2 & 3D-DIGITAL-TWIN] Gemelo Digital Topográfico Activo */}
            {active3DStk && (
                <Stockpile3DViewer
                    stockpileTag={active3DStk.tag}
                    material={active3DStk.material}
                    volumeM3={active3DStk.volumeM3}
                    density={active3DStk.density}
                    shape={active3DStk.shape}
                    onClose={() => setActive3DStk(null)}
                />
            )}

            {/* Modal de Cubicación Manual / Asistida */}
            {isCalcOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#07090D] border border-black/15 dark:border-white/20 w-full max-w-xl p-6 shadow-2xl space-y-6">
                        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
                            <div className="flex items-center gap-2">
                                <Calculator size={18} className="text-[#00AEEF]" />
                                <h2 className="text-sm font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                    Cálculo Volumétrico Geométrico
                                </h2>
                            </div>
                            <button onClick={() => setIsCalcOpen(false)} className="text-[#8A93A6] hover:text-black dark:hover:text-white">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveCalculation} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Identificador Acopio
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={calcForm.tag}
                                        onChange={e => setCalcForm(prev => ({ ...prev, tag: e.target.value }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Material Minero
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={calcForm.material}
                                        onChange={e => setCalcForm(prev => ({ ...prev, material: e.target.value }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Geometría Analítica
                                    </label>
                                    <select
                                        value={calcForm.shape}
                                        onChange={e => setCalcForm(prev => ({ ...prev, shape: e.target.value as any }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs"
                                    >
                                        <option value="elliptic-cone">Cono Elíptico</option>
                                        <option value="truncated-elliptic-cone">Cono Truncado</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Densidad Aparente (t/m³)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.1"
                                        required
                                        value={calcForm.density}
                                        onChange={e => setCalcForm(prev => ({ ...prev, density: parseFloat(e.target.value) || 0 }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Diámetro Mayor D1 (m)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0.1"
                                        required
                                        value={calcForm.d1}
                                        onChange={e => setCalcForm(prev => ({ ...prev, d1: parseFloat(e.target.value) || 0 }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Diámetro Menor D2 (m)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0.1"
                                        required
                                        value={calcForm.d2}
                                        onChange={e => setCalcForm(prev => ({ ...prev, d2: parseFloat(e.target.value) || 0 }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Altura H (m)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0.1"
                                        required
                                        value={calcForm.h}
                                        onChange={e => setCalcForm(prev => ({ ...prev, h: parseFloat(e.target.value) || 0 }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                    />
                                </div>
                            </div>

                            {/* Live Calculation Preview */}
                            <div className="p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 grid grid-cols-2 gap-4">
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Volumen Estimado:</span>
                                    <p className="text-xl font-bold font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {liveOutput.volumeM3.toLocaleString('es-CL')} m³
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Masa / Tonelaje:</span>
                                    <p className="text-xl font-bold font-mono text-[#00AEEF] mt-0.5">
                                        {liveOutput.tonnage.toLocaleString('es-CL')} Ton
                                    </p>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsCalcOpen(false)}
                                    className="px-4 py-2 border border-black/10 dark:border-white/15 text-xs font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 bg-[#0F172A] dark:bg-[#00AEEF] text-white dark:text-black text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                                >
                                    <Check size={14} />
                                    <span>Registrar Cubicación</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Detalle */}
            {selectedDetail && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#07090D] border border-black/15 dark:border-white/20 w-full max-w-lg p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                    {selectedDetail.tag}
                                </h3>
                                <p className="text-[10px] text-[#8A93A6] font-mono">{selectedDetail.material}</p>
                            </div>
                            <button onClick={() => setSelectedDetail(null)} className="text-[#8A93A6] hover:text-black dark:hover:text-white">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Volumen</span>
                                <p className="text-base font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">{selectedDetail.volumeM3.toLocaleString('es-CL')} m³</p>
                            </div>
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Tonelaje</span>
                                <p className="text-base font-bold text-[#00AEEF] mt-0.5">{selectedDetail.tonnage.toLocaleString('es-CL')} Ton</p>
                            </div>
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Densidad</span>
                                <p className="text-base font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">{selectedDetail.density} t/m³</p>
                            </div>
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Confiabilidad</span>
                                <p className="text-base font-bold text-emerald-500 mt-0.5">{selectedDetail.confidence}% P95</p>
                            </div>
                        </div>

                        <p className="text-[10px] text-[#8A93A6]">
                            Última medición registrada: {selectedDetail.lastSurvey} hrs. Verificado por sensor topográfico calibrado.
                        </p>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setSelectedDetail(null)}
                                className="px-4 py-1.5 border border-black/10 dark:border-white/15 text-xs font-bold uppercase tracking-wider"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabla de Acopios en Modo Informe */}
            <div className="bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                    <thead>
                        <tr className="border-b border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">
                            <th className="py-3 px-4">Tag Acopio</th>
                            <th className="py-3 px-4">Tipo de Mineral</th>
                            <th className="py-3 px-4 text-right">Densidad (t/m³)</th>
                            <th className="py-3 px-4 text-right">Volumen (m³)</th>
                            <th className="py-3 px-4 text-right">Tonelaje Total</th>
                            <th className="py-3 px-4">Última Medición</th>
                            <th className="py-3 px-4 text-center">Confiabilidad</th>
                            <th className="py-3 px-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5 font-mono text-[11px]">
                        {stockpiles.map((stk) => (
                            <tr key={stk.id} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors">
                                <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F3F4F6]">{stk.tag}</td>
                                <td className="py-3 px-4 font-sans text-xs">{stk.material}</td>
                                <td className="py-3 px-4 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {stk.density.toFixed(2)}
                                </td>
                                <td className="py-3 px-4 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {stk.volumeM3.toLocaleString('es-CL')}
                                </td>
                                <td className="py-3 px-4 text-right text-[#00AEEF] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {stk.tonnage.toLocaleString('es-CL', { minimumFractionDigits: 1 })} t
                                </td>
                                <td className="py-3 px-4 text-[#8A93A6]">{stk.lastSurvey}</td>
                                <td className="py-3 px-4 text-center">
                                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5">
                                        {stk.confidence}%
                                    </span>
                                </td>
                                <td className="py-3 px-4 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <button 
                                            onClick={() => setActive3DStk(stk)}
                                            className="text-[#FFCD00] hover:underline text-[10px] font-bold uppercase tracking-wider font-mono cursor-pointer"
                                        >
                                            3D
                                        </button>
                                        <button 
                                            onClick={() => setSelectedDetail(stk)}
                                            className="text-[#00AEEF] hover:underline text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                                        >
                                            Ficha <ArrowUpRight size={12} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default StockpileModule;
