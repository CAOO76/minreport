import React, { useEffect, useState } from 'react';
import { getAITelemetry } from '../services/api';

const formatTimestamp = (ts: any): string => {
    if (!ts) return '-';
    if (typeof ts === 'string') return ts;
    if (typeof ts.toDate === 'function') {
        try {
            return ts.toDate().toISOString();
        } catch {
            return '-';
        }
    }
    if (typeof ts._seconds === 'number') {
        return new Date(ts._seconds * 1000).toISOString();
    }
    if (typeof ts.seconds === 'number') {
        return new Date(ts.seconds * 1000).toISOString();
    }
    if (typeof ts === 'number') {
        return new Date(ts).toISOString();
    }
    return '-';
};

const safeRender = (val: any, fallback = '-'): string => {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    try {
        return JSON.stringify(val);
    } catch {
        return fallback;
    }
};

export const AITelemetryPage: React.FC = () => {
    const [telemetry, setTelemetry] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchTelemetry = async () => {
        try {
            const { data } = await getAITelemetry();
            setTelemetry(data);
        } catch (error) {
            console.error('Error al consultar telemetría:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTelemetry();
    }, []);

    return (
        <div className="space-y-6 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        Servicio de Inferencia IA
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        Configuración de modelos de lenguaje y registro de consultas operativas.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[#475569] dark:text-[#8A93A6]">
                        Región: <span className="text-[#0F172A] dark:text-[#F3F4F6] font-medium">{telemetry?.clusterRegion || 'southamerica-west1'}</span>
                    </span>
                    <button
                        onClick={fetchTelemetry}
                        disabled={loading}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
                        title="Actualizar"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Matriz Técnica de Modelos Configurados */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                            <th className="py-2.5 px-4 font-semibold">Tier</th>
                            <th className="py-2.5 px-4 font-semibold">Modelo</th>
                            <th className="py-2.5 px-4 font-semibold">Propósito Técnico</th>
                            <th className="py-2.5 px-4 font-semibold">Conmutación</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        <tr>
                            <td className="py-3 px-4 font-mono font-medium text-[#0F172A] dark:text-[#F3F4F6]">
                                1 (Primario)
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                gemini-2.5-pro
                            </td>
                            <td className="py-3 px-4 text-[#475569] dark:text-[#8A93A6]">
                                Razonamiento complejo, auditoría de reportes técnicos y correlación geológica.
                            </td>
                            <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                Fallback ➔ Tier 2
                            </td>
                        </tr>
                        <tr>
                            <td className="py-3 px-4 font-mono font-medium text-[#0F172A] dark:text-[#F3F4F6]">
                                2 (Operativo)
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                gemini-2.5-flash
                            </td>
                            <td className="py-3 px-4 text-[#475569] dark:text-[#8A93A6]">
                                Extracción estructurada de partes de turno y clasificación de fallas de terreno.
                            </td>
                            <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                Fallback ➔ Tier 3
                            </td>
                        </tr>
                        <tr>
                            <td className="py-3 px-4 font-mono font-medium text-[#0F172A] dark:text-[#F3F4F6]">
                                3 (Ancla HA)
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                gemini-2.5-flash-lite
                            </td>
                            <td className="py-3 px-4 text-[#475569] dark:text-[#8A93A6]">
                                Alta disponibilidad para operaciones críticas sin interrupción.
                            </td>
                            <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                Reintentos con jitter
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Parámetros de Gatekeeper M2M */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-4 text-xs font-mono">
                <div className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider mb-2">
                    Canal Agéntico M2M
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[#0F172A] dark:text-[#F3F4F6]">
                    <div>
                        <span className="text-[#8A93A6] block text-[10px]">Endpoint:</span>
                        <code>/api/m2m/data-feed</code>
                    </div>
                    <div>
                        <span className="text-[#8A93A6] block text-[10px]">Protocolo de Cobro:</span>
                        <span>HTTP 402 (x402 Gatekeeper)</span>
                    </div>
                    <div>
                        <span className="text-[#8A93A6] block text-[10px]">Estado de Servicio:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {telemetry?.protocolX402?.status || 'ACTIVO'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Registro de Operaciones */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                        Registro de Inferencias
                    </h2>
                    <span className="text-xs font-mono text-[#475569] dark:text-[#8A93A6]">
                        Auditoría
                    </span>
                </div>

                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                                <th className="py-2.5 px-4 font-semibold">Timestamp (UTC)</th>
                                <th className="py-2.5 px-4 font-semibold">Módulo</th>
                                <th className="py-2.5 px-4 font-semibold">Modelo</th>
                                <th className="py-2.5 px-4 font-semibold">Tenant</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {(!telemetry?.recentInferences || telemetry.recentInferences.length === 0) ? (
                                <tr>
                                    <td colSpan={4} className="py-6 px-4 text-center text-[#8A93A6] font-mono">
                                        [Sin registros de inferencia en la ventana actual]
                                    </td>
                                </tr>
                            ) : (
                                telemetry.recentInferences.map((inf: any, idx: number) => (
                                    <tr key={inf.id || idx} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                        <td className="py-3 px-4 font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            {formatTimestamp(inf.timestamp)}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                            {safeRender(inf.module, 'core')}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-[#C68346]">
                                            {safeRender(inf.details?.model, 'gemini-2.5-flash')}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                            {safeRender(inf.tenantId, 'global')}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
