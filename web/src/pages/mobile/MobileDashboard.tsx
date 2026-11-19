import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { SYSTEM_MODULES, SystemModuleInfo } from '../../constants/modules';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import SecureImage from '../../components/common/SecureImage';

const MobileDashboard: React.FC = () => {
    const { t } = useTranslation();
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
        t('core_mobile.role_operator');

    return (
        <div className="bg-[#FFFFFF] dark:bg-[#000000] px-fib-21 pt-fib-21 pb-fib-55 space-y-fib-34 font-atkinson select-none rounded-none shadow-none">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                <div className="min-w-0">
                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {user?.displayName || user?.email?.split('@')[0] || t('core_mobile.role_operator_display')}
                    </h1>
                    <p className="text-microcopy text-[#475569] dark:text-[#8A93A6] mt-0.5 font-mono truncate">
                        {roleLabel} · {currentAccount?.name || session?.tenantName || t('core_shell.undeclared_org')}
                    </p>
                </div>

                {user?.photoURL ? (
                    <SecureImage
                        src={user.photoURL}
                        alt={t('core_mobile.avatar_alt')}
                        className="w-10 h-10 object-cover shrink-0 pointer-events-none"
                    />
                ) : (
                    <span className="text-body-main font-bold text-[#C68346] font-mono shrink-0">
                        {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-3 border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C]">
                <div className="py-fib-13 pr-fib-8">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block truncate">
                        {t('core_mobile.offline_queue_label')}
                    </span>
                    <span className="text-h1-header font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] block mt-1">
                        {pendingSyncCount}
                    </span>
                </div>

                <div className="py-fib-13 px-fib-8">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block truncate">
                        {t('core_mobile.fleet_count_label')}
                    </span>
                    <span className="text-h1-header font-mono tabular-nums text-[#C68346] block mt-1">
                        {fleetCount !== null ? fleetCount : t('core_mobile.pending_record')}
                    </span>
                </div>

                <div className="py-fib-13 pl-fib-8">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block truncate">
                        {t('core_mobile.stockpiles_count_label')}
                    </span>
                    <span className="text-h1-header font-mono tabular-nums text-[#00AEEF] block mt-1">
                        {stockpileCount !== null ? stockpileCount : t('core_mobile.pending_short')}
                    </span>
                </div>
            </div>

            {activeModules.length === 0 ? (
                <p className="py-fib-34 text-center text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                    {t('core_mobile.no_modules_assigned')}
                </p>
            ) : (
                <section
                    aria-label={t('core_mobile.enabled_modules_heading')}
                    className="grid grid-cols-3 sm:grid-cols-4 gap-fib-34 place-items-center pt-fib-13"
                >
                    {activeModules.map((module) => {
                        const modName = t(`core_shell.modules.${module.id}.name`, module.name);
                        return (
                            <button
                                key={module.id}
                                type="button"
                                onClick={() => navigate(module.path)}
                                aria-label={modName}
                                title={modName}
                                className="min-w-[64px] min-h-[64px] p-fib-13 bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none shadow-none text-[#C68346] hover:opacity-75 transition-opacity"
                            >
                                <span className="material-symbols-outlined text-[48px] leading-none text-[#C68346]">
                                    {module.icon}
                                </span>
                            </button>
                        );
                    })}
                </section>
            )}
        </div>
    );
};

export default MobileDashboard;
