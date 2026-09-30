import React, { useState, useEffect } from 'react';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { offlineStorage, FleetInspectionRecord } from '../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import { ImageOptimizer, OptimizedImageResult } from '../../core/offline/imageOptimizer';
import { 
    Truck, 
    ShieldCheck, 
    AlertTriangle, 
    CheckCircle2, 
    ArrowUpRight, 
    Search,
    AlertCircle,
    ClipboardCheck,
    X,
    Check,
    Wrench,
    Camera
} from 'lucide-react';

interface FleetItem {
    id: string;
    code: string;
    type: string;
    model: string;
    status: 'OPERATIVO' | 'MANTENCION';
    horometer: number;
    lastInspection: string;
    operator: string;
    healthScore: number;
    lastChecklist?: {
        brakes: boolean;
        hydraulics: boolean;
        oilLevel: boolean;
        fireExtinguisher: boolean;
        lightsBeacon: boolean;
    };
}

const INITIAL_FLEET: FleetItem[] = [
    { 
        id: '1', 
        code: 'CAEX-104', 
        type: 'Camión de Extracción', 
        model: 'CAT 797F (400 Ton)', 
        status: 'OPERATIVO', 
        horometer: 14250.5, 
        lastInspection: '2026-09-30 07:15', 
        operator: 'Carlos Valenzuela', 
        healthScore: 98,
        lastChecklist: { brakes: true, hydraulics: true, oilLevel: true, fireExtinguisher: true, lightsBeacon: true }
    },
    { 
        id: '2', 
        code: 'PALA-02', 
        type: 'Pala Hidráulica', 
        model: 'Komatsu PC8000-11', 
        status: 'OPERATIVO', 
        horometer: 8920.0, 
        lastInspection: '2026-09-30 06:45', 
        operator: 'Matías Osorio', 
        healthScore: 95,
        lastChecklist: { brakes: true, hydraulics: true, oilLevel: true, fireExtinguisher: true, lightsBeacon: true }
    },
    { 
        id: '3', 
        code: 'PERF-08', 
        type: 'Perforadora DTH', 
        model: 'Epiroc Pit Viper 351', 
        status: 'MANTENCION', 
        horometer: 6410.2, 
        lastInspection: '2026-09-29 18:30', 
        operator: 'Taller Central', 
        healthScore: 72,
        lastChecklist: { brakes: true, hydraulics: false, oilLevel: true, fireExtinguisher: true, lightsBeacon: false }
    },
    { 
        id: '4', 
        code: 'BUL-05', 
        type: 'Tractor Oruga', 
        model: 'CAT D11T', 
        status: 'OPERATIVO', 
        horometer: 11340.8, 
        lastInspection: '2026-09-30 07:00', 
        operator: 'Jorge Fuentes', 
        healthScore: 92,
        lastChecklist: { brakes: true, hydraulics: true, oilLevel: true, fireExtinguisher: true, lightsBeacon: true }
    },
    { 
        id: '5', 
        code: 'CAEX-108', 
        type: 'Camión de Extracción', 
        model: 'CAT 797F (400 Ton)', 
        status: 'OPERATIVO', 
        horometer: 13890.1, 
        lastInspection: '2026-09-30 07:30', 
        operator: 'Víctor Espinoza', 
        healthScore: 97,
        lastChecklist: { brakes: true, hydraulics: true, oilLevel: true, fireExtinguisher: true, lightsBeacon: true }
    }
];

export const OpermaqModule: React.FC = () => {
    const { session } = useMinReportSession();
    const isEdu = session?.isEduSandbox;

    const [fleet, setFleet] = useState<FleetItem[]>(INITIAL_FLEET);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
    const [isCheckinOpen, setIsCheckinOpen] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<FleetItem | null>(null);

    // Formulario de Check-in
    const [checkinForm, setCheckinForm] = useState({
        code: 'CAEX-104',
        operator: session?.displayName || session?.email || 'Operador de Turno',
        horometerDelta: 8.5,
        brakes: true,
        hydraulics: true,
        oilLevel: true,
        fireExtinguisher: true,
        lightsBeacon: true,
        observations: ''
    });

    const [evidenceImage, setEvidenceImage] = useState<OptimizedImageResult | null>(null);
    const [isOptimizingImage, setIsOptimizingImage] = useState(false);

    // Carga inicial y persistencia reactiva desde IndexedDB (EDGE-OPTIMIZER)
    useEffect(() => {
        const loadOfflineInspections = async () => {
            try {
                const stored = await offlineStorage.getFleetInspections();
                if (stored && stored.length > 0) {
                    setFleet(prev => prev.map(item => {
                        const matching = stored
                            .filter(s => s.code === item.code)
                            .sort((a, b) => b.timestamp - a.timestamp)[0];
                        if (matching) {
                            return {
                                ...item,
                                horometer: item.horometer + matching.horometerDelta,
                                lastInspection: new Date(matching.timestamp).toISOString().replace('T', ' ').slice(0, 16),
                                operator: matching.operator,
                                status: matching.status,
                                healthScore: matching.status === 'OPERATIVO' ? 98 : 75,
                                lastChecklist: matching.checklist
                            };
                        }
                        return item;
                    }));
                }
            } catch (err) {
                console.warn('[OPERMAQ] Error al sincronizar con almacenamiento local:', err);
            }
        };
        loadOfflineInspections();
    }, []);

    const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsOptimizingImage(true);
        try {
            const optimized = await ImageOptimizer.optimizeFile(file, 'EVIDENCE');
            setEvidenceImage(optimized);
        } catch (err) {
            console.error('[OPERMAQ] Error al optimizar evidencia fotográfica:', err);
        } finally {
            setIsOptimizingImage(false);
        }
    };

    const handleSaveCheckin = async (e: React.FormEvent) => {
        e.preventDefault();
        const allOk = checkinForm.brakes && checkinForm.hydraulics && checkinForm.oilLevel && checkinForm.fireExtinguisher && checkinForm.lightsBeacon;
        const currentItem = fleet.find(f => f.code === checkinForm.code);
        const newHorometer = (currentItem?.horometer || 0) + checkinForm.horometerDelta;
        const nowIso = new Date().toISOString();
        const inspectionId = `insp_${checkinForm.code.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}`;

        const inspectionRecord: FleetInspectionRecord = {
            id: inspectionId,
            code: checkinForm.code,
            operator: checkinForm.operator,
            status: allOk ? 'OPERATIVO' : 'MANTENCION',
            horometerDelta: checkinForm.horometerDelta,
            checklist: {
                brakes: checkinForm.brakes,
                hydraulics: checkinForm.hydraulics,
                oilLevel: checkinForm.oilLevel,
                fireExtinguisher: checkinForm.fireExtinguisher,
                lightsBeacon: checkinForm.lightsBeacon
            },
            observations: checkinForm.observations + (evidenceImage ? ` [Evidencia adjunta: ${evidenceImage.width}x${evidenceImage.height} WebP, ${Math.round(evidenceImage.sizeBytes / 1024)} KB]` : ''),
            timestamp: Date.now(),
            synced: false
        };

        // 1. Escritura instantánea en almacenamiento local (IndexedDB)
        try {
            await offlineStorage.saveFleetInspection(inspectionRecord);
            // 2. Encolar tarea de sincronización idempotente
            await syncQueueEngine.enqueueTask('FLEET_INSPECTION', inspectionRecord, inspectionId);
        } catch (err) {
            console.error('[OPERMAQ] Error al persistir inspección localmente:', err);
        }

        // 3. Actualización de UI
        setFleet(prev => prev.map(item => {
            if (item.code === checkinForm.code) {
                return {
                    ...item,
                    horometer: newHorometer,
                    lastInspection: nowIso.replace('T', ' ').slice(0, 16),
                    operator: checkinForm.operator,
                    status: allOk ? 'OPERATIVO' : 'MANTENCION',
                    healthScore: allOk ? 98 : 75,
                    lastChecklist: inspectionRecord.checklist
                };
            }
            return item;
        }));

        setEvidenceImage(null);
        setIsCheckinOpen(false);
    };

    const filteredFleet = fleet.filter(item => {
        const matchesSearch = item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                              item.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
                              item.operator.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = selectedStatus === 'ALL' || item.status === selectedStatus;
        return matchesSearch && matchesStatus;
    });

    const activeCount = fleet.filter(i => i.status === 'OPERATIVO').length;
    const maintenanceCount = fleet.filter(i => i.status === 'MANTENCION').length;

    return (
        <div className="space-y-6">
            {/* Aviso de Sandbox Académico si aplica */}
            {isEdu && (
                <div className="p-3 bg-amber-500/10 border-l-2 border-amber-500 text-amber-700 dark:text-amber-400 text-xs flex items-center justify-between font-mono">
                    <div className="flex items-center gap-2">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>[MODO LABORATORIO DOCENTE]: Datos de telemetría de equipos simulados. Inspecciones sin validez legal de faena.</span>
                    </div>
                    <span className="text-[9px] bg-amber-500/20 px-2 py-0.5 uppercase tracking-widest font-bold">EDU_SANDBOX</span>
                </div>
            )}

            {/* Header del Módulo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-black/5 dark:border-white/10 pb-4">
                <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8A93A6]">
                        <Truck size={14} className="text-[#FFCD00]" />
                        <span>GESTIÓN INTEGRAL DE ACTIVOS PESADOS Y MAQUINARIA</span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                        Control de Flota OPERMAQ
                    </h1>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCheckinOpen(true)}
                        className="px-4 py-2 bg-[#FFCD00] text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity rounded-none flex items-center gap-2"
                    >
                        <ClipboardCheck size={14} />
                        <span>Registrar Check-in</span>
                    </button>
                </div>
            </div>

            {/* KPI Display (Números Tabulares) */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Flota Monitoreada</p>
                    <p className="text-2xl font-bold font-mono tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {activeCount} / {fleet.length}
                    </p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">{((activeCount / fleet.length) * 100).toFixed(0)}% Disponibilidad</p>
                </div>

                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Horómetros Registrados</p>
                    <p className="text-2xl font-bold font-mono tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fleet.reduce((acc, f) => acc + f.horometer, 0).toLocaleString('es-CL', { maximumFractionDigits: 1 })} hrs
                    </p>
                    <p className="text-[10px] text-[#8A93A6] mt-1">Acumulado de flota</p>
                </div>

                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Equipos en Taller</p>
                    <p className="text-2xl font-bold font-mono tracking-tight text-amber-500 mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {maintenanceCount}
                    </p>
                    <p className="text-[10px] text-[#8A93A6] mt-1">Pautas correctivas</p>
                </div>

                <div className="p-4 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">Seguridad de Checklists</p>
                    <div className="flex items-center gap-1.5 text-emerald-500 mt-1">
                        <ShieldCheck size={18} />
                        <span className="text-sm font-bold uppercase tracking-wider">100% Auditados</span>
                    </div>
                    <p className="text-[10px] text-[#8A93A6] mt-1">Trazabilidad ISO 27001</p>
                </div>
            </div>

            {/* Controles de Búsqueda y Filtros */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white dark:bg-[#07090D] p-3 border border-black/5 dark:border-white/10">
                <div className="relative w-full sm:w-80">
                    <Search size={14} className="absolute left-3 top-3 text-[#8A93A6]" />
                    <input
                        type="text"
                        placeholder="Buscar por código, tipo o chofer..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-transparent border border-black/10 dark:border-white/10 focus:outline-none focus:border-[#FFCD00] rounded-none"
                    />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {['ALL', 'OPERATIVO', 'MANTENCION'].map((st) => (
                        <button
                            key={st}
                            onClick={() => setSelectedStatus(st)}
                            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors rounded-none ${
                                selectedStatus === st
                                    ? 'bg-[#0F172A] dark:bg-white text-white dark:text-black'
                                    : 'bg-black/5 dark:bg-white/5 text-[#8A93A6] hover:text-black dark:hover:text-white'
                            }`}
                        >
                            {st === 'ALL' ? 'Todos' : st}
                        </button>
                    ))}
                </div>
            </div>

            {/* Modal de Check-in Diario / Pauta de Inspección */}
            {isCheckinOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#07090D] border border-black/15 dark:border-white/20 w-full max-w-lg p-6 shadow-2xl space-y-6">
                        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
                            <div className="flex items-center gap-2">
                                <ClipboardCheck size={18} className="text-[#FFCD00]" />
                                <h2 className="text-sm font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                    Pauta Pre-Uso de Maquinaria
                                </h2>
                            </div>
                            <button onClick={() => setIsCheckinOpen(false)} className="text-[#8A93A6] hover:text-black dark:hover:text-white">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveCheckin} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Equipo / Código
                                    </label>
                                    <select
                                        value={checkinForm.code}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, code: e.target.value }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                    >
                                        {fleet.map(f => (
                                            <option key={f.id} value={f.code}>{f.code} - {f.type}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                        Operador Certificado
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={checkinForm.operator}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, operator: e.target.value }))}
                                        className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                    Horas de Operación Turno (Delta hrs)
                                </label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="24"
                                    required
                                    value={checkinForm.horometerDelta}
                                    onChange={e => setCheckinForm(prev => ({ ...prev, horometerDelta: parseFloat(e.target.value) || 0 }))}
                                    className="w-full px-3 py-2 bg-black/[0.02] dark:bg-white/[0.05] border border-black/15 dark:border-white/15 text-xs font-mono"
                                />
                            </div>

                            {/* Puntos Críticos de Seguridad */}
                            <div className="border border-black/10 dark:border-white/10 p-3 space-y-2 bg-black/[0.02] dark:bg-white/[0.02]">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                    Puntos Críticos de Inspección (DS 132 Minería)
                                </p>

                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={checkinForm.brakes}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, brakes: e.target.checked }))}
                                        className="accent-[#FFCD00]" 
                                    />
                                    <span>Frenos de Servicio y Retardador Operativos</span>
                                </label>

                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={checkinForm.hydraulics}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, hydraulics: e.target.checked }))}
                                        className="accent-[#FFCD00]" 
                                    />
                                    <span>Circuito Hidráulico sin fugas visibles</span>
                                </label>

                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={checkinForm.oilLevel}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, oilLevel: e.target.checked }))}
                                        className="accent-[#FFCD00]" 
                                    />
                                    <span>Nivel de Aceite Motor en rango nominal</span>
                                </label>

                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={checkinForm.fireExtinguisher}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, fireExtinguisher: e.target.checked }))}
                                        className="accent-[#FFCD00]" 
                                    />
                                    <span>Extintor PQS y Sistema Ansul Válidos</span>
                                </label>

                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={checkinForm.lightsBeacon}
                                        onChange={e => setCheckinForm(prev => ({ ...prev, lightsBeacon: e.target.checked }))}
                                        className="accent-[#FFCD00]" 
                                    />
                                    <span>Baliza destellante y Pértiga de Seguridad Operativas</span>
                                </label>
                            </div>

                            {/* Captura de Evidencia Fotográfica WebP */}
                            <div className="border border-black/10 dark:border-white/10 p-3 bg-black/[0.01] dark:bg-white/[0.01] space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] flex items-center gap-1.5">
                                        <Camera size={13} className="text-[#00AEEF]" />
                                        <span>Evidencia de Terreno (WebP Comprimido)</span>
                                    </label>
                                    {evidenceImage && (
                                        <span className="text-[9px] font-mono text-emerald-500 font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {Math.round(evidenceImage.sizeBytes / 1024)} KB (-{evidenceImage.compressionRatio}%)
                                        </span>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handleImageCapture}
                                    className="block w-full text-xs text-[#8A93A6] file:mr-3 file:py-1 file:px-2.5 file:border-0 file:text-[10px] file:font-bold file:uppercase file:tracking-wider file:bg-[#0F172A] file:text-white dark:file:bg-[#FFCD00] dark:file:text-black cursor-pointer"
                                />
                                {isOptimizingImage && (
                                    <p className="text-[9px] text-[#00AEEF] animate-pulse font-mono">Comprimiendo imagen con Canvas WebP...</p>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEvidenceImage(null);
                                        setIsCheckinOpen(false);
                                    }}
                                    className="px-4 py-2 border border-black/10 dark:border-white/15 text-xs font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 bg-[#FFCD00] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                                >
                                    <Check size={14} />
                                    <span>Firmar Pauta de Turno</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Ficha Técnica */}
            {selectedAsset && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#07090D] border border-black/15 dark:border-white/20 w-full max-w-lg p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                    {selectedAsset.code} · {selectedAsset.type}
                                </h3>
                                <p className="text-[10px] text-[#8A93A6] font-mono">{selectedAsset.model}</p>
                            </div>
                            <button onClick={() => setSelectedAsset(null)} className="text-[#8A93A6] hover:text-black dark:hover:text-white">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Horómetro Acumulado</span>
                                <p className="text-base font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">{selectedAsset.horometer.toLocaleString('es-CL')} hrs</p>
                            </div>
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Disponibilidad Mecánica</span>
                                <p className="text-base font-bold text-emerald-500 mt-0.5">{selectedAsset.healthScore}%</p>
                            </div>
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Operador en Turno</span>
                                <p className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">{selectedAsset.operator}</p>
                            </div>
                            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                                <span className="text-[10px] text-[#8A93A6] uppercase">Estado Actual</span>
                                <p className={`text-xs font-bold mt-0.5 ${selectedAsset.status === 'OPERATIVO' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                    {selectedAsset.status}
                                </p>
                            </div>
                        </div>

                        <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 text-xs">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1">
                                <Wrench size={12} />
                                <span>Diagnóstico de Mantención</span>
                            </div>
                            <p className="text-xs text-[#0F172A] dark:text-[#F3F4F6]">
                                Próxima mantención preventiva programada a las {(Math.ceil(selectedAsset.horometer / 250) * 250).toLocaleString('es-CL')} hrs (Pauta 250 hrs).
                            </p>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setSelectedAsset(null)}
                                className="px-4 py-1.5 border border-black/10 dark:border-white/15 text-xs font-bold uppercase tracking-wider"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabla Técnica en Modo Informe (Tabular Numbers) */}
            <div className="bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                    <thead>
                        <tr className="border-b border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[10px] font-bold uppercase tracking-wider text-[#8A93A6]">
                            <th className="py-3 px-4">Código</th>
                            <th className="py-3 px-4">Equipo / Modelo</th>
                            <th className="py-3 px-4">Estado</th>
                            <th className="py-3 px-4 text-right">Horómetro Total</th>
                            <th className="py-3 px-4">Última Inspección</th>
                            <th className="py-3 px-4">Operador Asignado</th>
                            <th className="py-3 px-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5 font-mono text-[11px]">
                        {filteredFleet.map((item) => (
                            <tr key={item.id} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors">
                                <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F3F4F6]">{item.code}</td>
                                <td className="py-3 px-4 font-sans text-xs">
                                    <p className="font-semibold">{item.type}</p>
                                    <p className="text-[10px] text-[#8A93A6]">{item.model}</p>
                                </td>
                                <td className="py-3 px-4 font-sans">
                                    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-none uppercase tracking-wider ${
                                        item.status === 'OPERATIVO'
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                    }`}>
                                        {item.status === 'OPERATIVO' ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                                        {item.status}
                                    </span>
                                </td>
                                <td className="py-3 px-4 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {item.horometer.toLocaleString('es-CL', { minimumFractionDigits: 1 })} hrs
                                </td>
                                <td className="py-3 px-4 text-[#8A93A6]">{item.lastInspection}</td>
                                <td className="py-3 px-4 font-sans text-xs">{item.operator}</td>
                                <td className="py-3 px-4 text-center">
                                    <button 
                                        onClick={() => setSelectedAsset(item)}
                                        className="text-[#00AEEF] hover:underline text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1"
                                    >
                                        Ficha <ArrowUpRight size={12} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default OpermaqModule;
