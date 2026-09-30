import React, { useEffect, useState } from 'react';
import { getAuditLogs } from '../services/api';

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

export const AuditLedgerPage: React.FC = () => {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterAction, setFilterAction] = useState('ALL');

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const { data } = await getAuditLogs(100);
            setLogs(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error al consultar auditoría:', error);
            setLogs([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const filteredLogs = filterAction === 'ALL'
        ? logs
        : logs.filter(l => typeof l.action === 'string' && l.action.includes(filterAction));

    return (
        <div className="space-y-6 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        Registro de Auditoría
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        Historial de eventos y operaciones administrativas.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={filterAction}
                        onChange={(e) => setFilterAction(e.target.value)}
                        className="px-2.5 py-1 bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-xs text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none font-mono"
                    >
                        <option value="ALL">Todas las acciones</option>
                        <option value="APPROVE">Aprobaciones</option>
                        <option value="SUSPEND">Suspensiones</option>
                        <option value="DELETE">Eliminaciones</option>
                        <option value="AI_">Inferencias</option>
                    </select>
                    <button
                        onClick={fetchLogs}
                        disabled={loading}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
                        title="Actualizar registro"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Tabla de Auditoría */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                            <th className="py-2.5 px-4 font-semibold">Timestamp (UTC)</th>
                            <th className="py-2.5 px-4 font-semibold">Actor</th>
                            <th className="py-2.5 px-4 font-semibold">Acción</th>
                            <th className="py-2.5 px-4 font-semibold">Entidad</th>
                            <th className="py-2.5 px-4 font-semibold">Detalles</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {filteredLogs.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-8 px-4 text-center text-[#8A93A6] font-mono">
                                    {loading ? '[Consultando registros...]' : '[No se registran eventos de auditoría]'}
                                </td>
                            </tr>
                        ) : (
                            filteredLogs.map((log: any, idx: number) => (
                                <tr key={log.id || idx} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                    <td className="py-3 px-4 font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                        {formatTimestamp(log.timestamp)}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                        {safeRender(log.actor || log.actorEmail, 'system')}
                                    </td>
                                    <td className="py-3 px-4 font-mono font-medium text-[#C68346]">
                                        {safeRender(log.action, 'ACCION')}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                        {safeRender(log.targetId || log.targetEntity || log.tenantId, '-')}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6] truncate max-w-xs">
                                        {safeRender(log.details, '-')}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
