import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, getCountFromServer, getDoc, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';

interface PeriodAtomicTelemetry {
    period: string;
    aiRequestsTotal: number;
    aiCacheHits: number;
    casOriginalBytes: number;
    casOptimizedBytes: number;
    casAssetsCount: number;
    m2mRequests: number;
}

interface TenantMetricsSnapshot {
    membersCount: number;
    activeMembersCount: number;
    fleetAssetsCount: number;
    inspectionsCount: number;
    stockpilesCount: number;
    periodTelemetry: PeriodAtomicTelemetry | null;
}

function getCurrentUtcPeriod(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}_${month}`;
}

function formatByteSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const MetricasPage: React.FC = () => {
    const { t } = useTranslation();
    const undeclaredLabel = t('core_metricas.undeclared', '[Información técnica no declarada en ficha]');
    const { currentAccount } = useAuth();
    const { session } = useMinReportSession();
    const enabledModules = session?.activeModules ?? { opermaq: false, stockpile: false };
    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState<TenantMetricsSnapshot>({
        membersCount: 0,
        activeMembersCount: 0,
        fleetAssetsCount: 0,
        inspectionsCount: 0,
        stockpilesCount: 0,
        periodTelemetry: null,
    });

    useEffect(() => {
        let cancelled = false;
        const loadMetrics = async () => {
            if (!currentAccount?.id) {
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const tenantId = currentAccount.id;
                const currentPeriod = getCurrentUtcPeriod();
                const isEduAccount = Boolean(
                    session?.isEduSandbox ||
                        (currentAccount as any)?.isEduSandbox ||
                        String(currentAccount.type || '').toUpperCase() === 'EDUCATIONAL'
                );
                const membersCol = collection(db, 'accounts', tenantId, 'members');

                const [
                    totalMembersSnap,
                    activeMembersSnap,
                    assetsSnap,
                    inspectionsSnap,
                    stockpilesSnap,
                    periodDocSnap,
                ] = await Promise.all([
                    getCountFromServer(membersCol).catch(() => null),
                    getCountFromServer(query(membersCol, where('status', '==', 'ACTIVE'))).catch(() => null),
                    getCountFromServer(
                        query(
                            collection(db, isEduAccount ? 'edu_sandbox_fleet' : 'tenant_assets'),
                            where('tenantId', '==', tenantId)
                        )
                    ).catch(() => null),
                    getCountFromServer(query(collection(db, 'inspections'), where('tenantId', '==', tenantId))).catch(() => null),
                    getCountFromServer(query(collection(db, 'stockpiles'), where('tenantId', '==', tenantId))).catch(() => null),
                    getDoc(doc(db, 'accounts', tenantId, 'metrics', currentPeriod)).catch(() => null),
                ]);

                if (cancelled) return;

                const totalMembers = totalMembersSnap ? totalMembersSnap.data().count : 0;
                const activeMembers = activeMembersSnap ? activeMembersSnap.data().count : 0;

                let periodTelemetry: PeriodAtomicTelemetry | null = null;
                if (periodDocSnap && periodDocSnap.exists()) {
                    const raw = periodDocSnap.data() || {};
                    periodTelemetry = {
                        period: String(raw.period || currentPeriod),
                        aiRequestsTotal: Number(raw.aiRequestsTotal || 0),
                        aiCacheHits: Number(raw.aiCacheHits || 0),
                        casOriginalBytes: Number(raw.casOriginalBytes || 0),
                        casOptimizedBytes: Number(raw.casOptimizedBytes || 0),
                        casAssetsCount: Number(raw.casAssetsCount || 0),
                        m2mRequests: Number(raw.m2mRequests || 0),
                    };
                }

                setMetrics({
                    membersCount: totalMembers,
                    activeMembersCount: activeMembers,
                    fleetAssetsCount: assetsSnap ? assetsSnap.data().count : 0,
                    inspectionsCount: inspectionsSnap ? inspectionsSnap.data().count : 0,
                    stockpilesCount: stockpilesSnap ? stockpilesSnap.data().count : 0,
                    periodTelemetry,
                });
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadMetrics();
        return () => {
            cancelled = true;
        };
    }, [currentAccount?.id, (currentAccount as any)?.isEduSandbox, currentAccount?.type, session?.isEduSandbox]);

    if (!currentAccount) return null;

    const activeModulesCount =
        (enabledModules.opermaq ? 1 : 0) +
        (enabledModules.stockpile ? 1 : 0);

    const kpis = [
        {
            key: 'members',
            label: t('core_metricas.kpi_members'),
            value: loading ? '...' : String(metrics.activeMembersCount),
            sub: t('core_metricas.kpi_members_sub', { count: metrics.membersCount }),
            accent: false,
        },
        {
            key: 'fleet',
            label: t('core_metricas.kpi_fleet'),
            value: loading ? '...' : String(metrics.fleetAssetsCount),
            sub: t('core_metricas.kpi_fleet_sub'),
            accent: true,
        },
        {
            key: 'inspections',
            label: t('core_metricas.kpi_inspections'),
            value: loading ? '...' : String(metrics.inspectionsCount),
            sub: t('core_metricas.kpi_inspections_sub'),
            accent: false,
        },
        {
            key: 'stockpiles',
            label: t('core_metricas.kpi_stockpiles'),
            value: loading ? '...' : String(metrics.stockpilesCount),
            sub: t('core_metricas.kpi_stockpiles_sub', { count: activeModulesCount }),
            accent: false,
        },
    ];

    const casSavingsPct =
        metrics.periodTelemetry && metrics.periodTelemetry.casOriginalBytes > 0
            ? Math.max(
                  0,
                  Number(
                      (
                          ((metrics.periodTelemetry.casOriginalBytes -
                              metrics.periodTelemetry.casOptimizedBytes) /
                              metrics.periodTelemetry.casOriginalBytes) *
                          100
                      ).toFixed(1)
                  )
              )
            : 0;

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico */}
            <header className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13">
                <div>
                    <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                        {t('core_metricas.header_kicker')}
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_metricas.header_title')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        {t('core_metricas.header_subtitle', { name: currentAccount.name })}
                    </p>
                </div>
                <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                    {t('core_metricas.tenant_prefix')}: {currentAccount.id}
                </span>
            </header>

            {/* KPIs Numéricos Tabulares */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-fib-21">
                {kpis.map((card) => (
                    <div
                        key={card.key}
                        className="border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none"
                    >
                        <p
                            className={`text-microcopy font-mono uppercase mb-fib-13 ${
                                card.accent ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6]'
                            }`}
                        >
                            {card.label}
                        </p>
                        <p className="text-kpi-display font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                            {card.value}
                        </p>
                        <p className="text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                            {card.sub}
                        </p>
                    </div>
                ))}
            </div>

            {/* Macro-Layout Proporción Áurea: 61.8% Desglose por Módulo / 38.2% Consumo Atómico Mensual */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('core_metricas.sec_modules_title')}
                        </h2>
                    </div>
                    <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                        <thead>
                            <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                <th className="py-fib-13 px-fib-21">{t('core_metricas.col_module')}</th>
                                <th className="py-fib-13 px-fib-21">{t('core_metricas.col_status')}</th>
                                <th className="py-fib-13 px-fib-21 text-right">{t('core_metricas.col_documents')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            <tr>
                                <td className="py-fib-13 px-fib-21 font-bold text-[#0F172A] dark:text-[#F3F4F6]">OPERMAQ</td>
                                <td className="py-fib-13 px-fib-21">
                                    <span className={enabledModules.opermaq ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                        {enabledModules.opermaq ? t('core_metricas.status_enabled') : t('core_metricas.status_unassigned')}
                                    </span>
                                </td>
                                <td className="py-fib-13 px-fib-21 text-right tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {loading ? '...' : metrics.fleetAssetsCount + metrics.inspectionsCount}
                                </td>
                            </tr>
                            <tr>
                                <td className="py-fib-13 px-fib-21 font-bold text-[#0F172A] dark:text-[#F3F4F6]">STOCKPILE CONTROL</td>
                                <td className="py-fib-13 px-fib-21">
                                    <span className={enabledModules.stockpile ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                        {enabledModules.stockpile ? t('core_metricas.status_enabled') : t('core_metricas.status_unassigned')}
                                    </span>
                                </td>
                                <td className="py-fib-13 px-fib-21 text-right tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {loading ? '...' : metrics.stockpilesCount}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </section>

                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                    <h2 className="text-microcopy font-mono uppercase text-[#C68346]">
                        {t('core_metricas.sec_period_title', { period: getCurrentUtcPeriod() })}
                    </h2>
                    {metrics.periodTelemetry ? (
                        <dl className="space-y-fib-8 font-mono text-data-dense tabular-nums">
                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">{t('core_metricas.dt_ai')}</dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('core_metricas.ai_cache_hits', {
                                        total: metrics.periodTelemetry.aiRequestsTotal,
                                        hits: metrics.periodTelemetry.aiCacheHits,
                                    })}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">{t('core_metricas.dt_cas')}</dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {formatByteSize(metrics.periodTelemetry.casOriginalBytes)} {'->'}{' '}
                                    {formatByteSize(metrics.periodTelemetry.casOptimizedBytes)} ({casSavingsPct}%)
                                </dd>
                            </div>
                            <div className="flex items-center justify-between">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">{t('core_metricas.dt_m2m')}</dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {metrics.periodTelemetry.m2mRequests}
                                </dd>
                            </div>
                        </dl>
                    ) : (
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {undeclaredLabel} — {t('core_metricas.no_period_counters')}
                        </p>
                    )}
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        {t('core_metricas.footer_isolation_note_1')} <span className="font-mono">getCountFromServer</span>{' '}
                        {t('core_metricas.footer_isolation_note_2')} <span className="font-mono">tenantId</span>{' '}
                        {t('core_metricas.footer_isolation_note_3')} <span className="font-mono">southamerica-west1</span>.
                    </p>
                </aside>
            </div>
        </div>
    );
};

export default MetricasPage;
