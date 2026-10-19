import React, { useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { M3Switch } from '../components/M3Switch';
import { SYSTEM_MODULES } from '../constants/modules';

/**
 * ARQUITECTURA: Módulos Nativos MINREPORT
 *
 * Los módulos (OPERMAQ, STOCKPILE, MINING FLOW) son código nativo integrado
 * al bundle de MINREPORT. NO son plugins externos ni SDK dinámicos.
 *
 * Esta página gestiona únicamente el estado ACTIVE/DISABLED de cada módulo,
 * que se persiste en Firestore (colección 'modules_status') como configuración
 * de disponibilidad global para el superadmin. La fuente de verdad del catálogo
 * de módulos es siempre SYSTEM_MODULES (constants/modules.ts).
 */

const MODULES_STATUS_COLLECTION = 'modules_status';

interface ModuleStatus {
    status: 'ACTIVE' | 'DISABLED';
    updatedAt?: any;
}

interface ModuleWithStatus {
    key: string;
    label: string;
    scope: string;
    status: 'ACTIVE' | 'DISABLED';
}

export const PluginsPage: React.FC = () => {
    // Estado inicial: todos los módulos nativos activos
    const [modules, setModules] = useState<ModuleWithStatus[]>(
        SYSTEM_MODULES.map(m => ({ key: m.key, label: m.label, scope: m.scope, status: 'ACTIVE' }))
    );
    const [loading, setLoading] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);

    /**
     * fetchModuleStatuses:
     * Carga el estado ACTIVE/DISABLED de cada módulo nativo desde Firestore.
     * El catálogo (nombre, alcance, icono) siempre viene de SYSTEM_MODULES.
     */
    const fetchModuleStatuses = async () => {
        setLoading(true);
        try {
            const statusMap = new Map<string, 'ACTIVE' | 'DISABLED'>();

            await Promise.all(
                SYSTEM_MODULES.map(async (mod) => {
                    const ref = doc(db, MODULES_STATUS_COLLECTION, mod.key);
                    const snap = await getDoc(ref);
                    if (snap.exists()) {
                        const data = snap.data() as ModuleStatus;
                        statusMap.set(mod.key, data.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE');
                    }
                    // Si no existe en Firestore → módulo activo por defecto
                })
            );

            setModules(
                SYSTEM_MODULES.map(m => ({
                    key: m.key,
                    label: m.label,
                    scope: m.scope,
                    status: statusMap.get(m.key) ?? 'ACTIVE'
                }))
            );
        } catch (error) {
            console.error('[MÓDULOS] Error al consultar estados:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchModuleStatuses();
    }, []);

    /**
     * toggleStatus:
     * Persiste el nuevo estado en Firestore (modules_status/{key}).
     * Solo altera disponibilidad; el módulo sigue siendo código nativo.
     */
    const toggleStatus = async (key: string, currentStatus: 'ACTIVE' | 'DISABLED') => {
        const nextStatus: 'ACTIVE' | 'DISABLED' = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
        try {
            await setDoc(
                doc(db, MODULES_STATUS_COLLECTION, key),
                { status: nextStatus, updatedAt: serverTimestamp() },
                { merge: true }
            );
            setModules(prev => prev.map(p => p.key === key ? { ...p, status: nextStatus } : p));
            setNotification(`Módulo ${key.toUpperCase()}: ${nextStatus === 'ACTIVE' ? 'Habilitado' : 'Deshabilitado'}`);
            setTimeout(() => setNotification(null), 3000);
        } catch (error) {
            console.error('[MÓDULOS] Error al actualizar estado:', error);
            setNotification('Error al actualizar estado del módulo');
            setTimeout(() => setNotification(null), 3000);
        }
    };

    return (
        <div className="space-y-6 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        Módulos del Sistema
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        Disponibilidad de módulos operativos nativos MINREPORT.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchModuleStatuses}
                        disabled={loading}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
                        title="Actualizar estados"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Notificación Operativa Inline */}
            {notification && (
                <div className="px-3 py-2 bg-neutral-100 dark:bg-neutral-900 border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[#C68346]">info</span>
                    <span>{notification}</span>
                </div>
            )}

            {/* Tabla Técnica en Modo Informe */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                            <th className="py-2.5 px-4 font-semibold">Código</th>
                            <th className="py-2.5 px-4 font-semibold">Módulo Nativo</th>
                            <th className="py-2.5 px-4 font-semibold">Alcance Operativo</th>
                            <th className="py-2.5 px-4 font-semibold">Estado</th>
                            <th className="py-2.5 px-4 font-semibold text-right">Disponibilidad</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {modules.map((mod) => (
                            <tr key={mod.key} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                <td className="py-3 px-4 font-mono font-medium text-[#0F172A] dark:text-[#F3F4F6]">
                                    {mod.key}
                                </td>
                                <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {mod.label}
                                </td>
                                <td className="py-3 px-4 text-[#475569] dark:text-[#8A93A6]">
                                    {mod.scope}
                                </td>
                                <td className="py-3 px-4">
                                    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${
                                        mod.status === 'ACTIVE'
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : 'text-neutral-400 dark:text-neutral-500'
                                    }`}>
                                        <span className={`w-1.5 h-1.5 rounded-none ${
                                            mod.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-neutral-400'
                                        }`} />
                                        {mod.status === 'ACTIVE' ? 'Habilitado' : 'Inactivo'}
                                    </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                    <div className="inline-block">
                                        <M3Switch
                                            checked={mod.status === 'ACTIVE'}
                                            onChange={() => toggleStatus(mod.key, mod.status)}
                                        />
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
