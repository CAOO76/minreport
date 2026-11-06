import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { SYSTEM_MODULES, SystemModuleInfo } from '../../constants/modules';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import SecureImage from '../../components/common/SecureImage';

const MobileDashboard: React.FC = () => {
    const { user, profile, currentAccount } = useAuth();
    const { session, hasModuleAccess } = useMinReportSession();
    const navigate = useNavigate();

    const [fleetCount, setFleetCount] = useState<number | null>(null);
    const [stockpileCount, setStockpileCount] = useState<number | null>(null);
    const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

    const activeTenantId = currentAccount?.id || session?.tenantId || '';

    useEffect(() => {
        const unsubscribe = syncQueueEngine.subscribe((state) => {
            setPendingSyncCount(state.pendingCount);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        let active = true;
        const loadRealCounts = async () => {
            if (!activeTenantId) {
                setFleetCount(0);
                setStockpileCount(0);
                return;
            }
            try {
                const [fleetSnap, stkSnap] = await Promise.all([
                    getCountFromServer(query(collection(db, 'tenant_assets'), where('tenantId', '==', activeTenantId))),
                    getCountFromServer(query(collection(db, 'stockpiles'), where('tenantId', '==', activeTenantId))),
                ]);
                if (!active) return;
                setFleetCount(fleetSnap.data().count);
                setStockpileCount(stkSnap.data().count);
            } catch {
                if (!active) return;
                setFleetCount(null);
                setStockpileCount(null);
            }
        };
        loadRealCounts();
        return () => {
            active = false;
        };
    }, [activeTenantId]);

    const activeModules: SystemModuleInfo[] = SYSTEM_MODULES.filter((mod) =>
        hasModuleAccess(mod.id as 'opermaq' | 'stockpile')
    );

    const roleLabel =
        profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id)?.role ||
        session?.role ||
        'OPERADOR';

    return (
        <div className="space-y-fib-21 pb-20 px-fib-13 pt-fib-13 font-sans select-none">
            {/* Cabecera Tecnica */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                <div>
                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {user?.displayName || user?.email?.split('@')[0] || 'Operador'}
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5 font-mono">
                        {roleLabel} · {currentAccount?.name || session?.tenantName || '[Organizacion no declarada]'}
                    </p>
                </div>

                <div className="w-12 h-12 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-center border border-[#E2E8F0] dark:border-[#12151C] shadow-none overflow-hidden">
                    {user?.photoURL ? (
                        <SecureImage src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-sm font-bold text-[#C68346] font-mono">
                            {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                        </span>
                    )}
                </div>
            </div>

            {/* Metricas Reales en Proporcion Asimetrica (Sin Grid 50/50) */}
            <div className="flex flex-col gap-fib-13">
                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex items-center justify-between">
                    <div>
                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                            Cola Transaccional Offline (`SyncQueueEngine`)
                        </span>
                        <span className="text-kpi-display font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] block mt-1">
                            {pendingSyncCount}
                        </span>
                    </div>
                    <span className="material-symbols-outlined text-[24px] text-[#00AEEF]">sync</span>
                </div>

                <div className="flex gap-fib-13">
                    <div className="w-[61.8%] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                        <div className="flex items-center justify-between">
                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                Equipos en Flota
                            </span>
                            <span className="material-symbols-outlined text-[18px] text-[#C68346]">local_shipping</span>
                        </div>
                        <span className="text-h1-header font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] block mt-2">
                            {fleetCount !== null ? fleetCount : '[Pendiente de registro]'}
                        </span>
                    </div>

                    <div className="w-[38.2%] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                        <div className="flex items-center justify-between">
                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                Acopios
                            </span>
                            <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">layers</span>
                        </div>
                        <span className="text-h1-header font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] block mt-2">
                            {stockpileCount !== null ? stockpileCount : '[Pendiente]'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Modulos Operativos Integrados */}
            <div>
                <div className="flex items-center justify-between mb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                        Modulos Operativos Habilitados
                    </h2>
                    <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {activeModules.length}
                    </span>
                </div>

                {activeModules.length === 0 ? (
                    <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        [Sin modulos asignados a esta cuenta]
                    </div>
                ) : (
                    <div className="space-y-fib-13">
                        {activeModules.map((module) => (
                            <button
                                key={module.id}
                                type="button"
                                onClick={() => navigate(module.path)}
                                className="w-full text-left bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] flex items-center gap-fib-13 transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[22px] text-[#C68346] shrink-0">{module.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-xs uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                        {module.name}
                                    </h3>
                                    <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] line-clamp-1 font-mono mt-0.5">
                                        {module.scope}
                                    </p>
                                </div>
                                <span className="material-symbols-outlined text-[#94A3B8] dark:text-[#5A6072] text-[18px]">chevron_right</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MobileDashboard;
