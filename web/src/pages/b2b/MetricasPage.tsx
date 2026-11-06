import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';

interface TenantMetricsSnapshot {
    membersCount: number;
    activeMembersCount: number;
    fleetAssetsCount: number;
    inspectionsCount: number;
    stockpilesCount: number;
}

export const MetricasPage: React.FC = () => {
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
                const [membersSnap, assetsSnap, inspectionsSnap, stockpilesSnap] = await Promise.all([
                    getDocs(collection(db, 'accounts', tenantId, 'members')).catch(() => null),
                    getDocs(query(collection(db, 'tenant_assets'), where('tenantId', '==', tenantId))).catch(() => null),
                    getDocs(query(collection(db, 'inspections'), where('tenantId', '==', tenantId))).catch(() => null),
                    getDocs(query(collection(db, 'stockpiles'), where('tenantId', '==', tenantId))).catch(() => null),
                ]);

                if (cancelled) return;

                const memberDocs = membersSnap ? membersSnap.docs.map(d => d.data()) : [];
                const activeMembers = memberDocs.filter(m => !m.status || m.status === 'ACTIVE').length;

                setMetrics({
                    membersCount: memberDocs.length,
                    activeMembersCount: activeMembers,
                    fleetAssetsCount: assetsSnap ? assetsSnap.size : 0,
                    inspectionsCount: inspectionsSnap ? inspectionsSnap.size : 0,
                    stockpilesCount: stockpilesSnap ? stockpilesSnap.size : 0,
                });
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadMetrics();
        return () => {
            cancelled = true;
        };
    }, [currentAccount?.id]);

    if (!currentAccount) return null;

    const activeModulesCount =
        (enabledModules.opermaq ? 1 : 0) +
        (enabledModules.stockpile ? 1 : 0);

    const kpis = [
        {
            label: 'Miembros Activos',
            value: loading ? '...' : String(metrics.activeMembersCount),
            sub: `${metrics.membersCount} vinculados en cuenta`,
            accent: false,
        },
        {
            label: 'Equipos Registrados',
            value: loading ? '...' : String(metrics.fleetAssetsCount),
            sub: 'activos OPERMAQ del tenant',
            accent: true,
        },
        {
            label: 'Inspecciones Operativas',
            value: loading ? '...' : String(metrics.inspectionsCount),
            sub: 'registros sincronizados',
            accent: false,
        },
        {
            label: 'Cubicaciones Stockpile',
            value: loading ? '...' : String(metrics.stockpilesCount),
            sub: `${activeModulesCount} módulo(s) habilitado(s)`,
            accent: false,
        },
    ];

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico */}
            <header className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13">
                <div>
                    <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                        MINREPORT // TELEMETRÍA MULTI-TENANT
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        Métricas Operacionales de Cuenta
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        Conteo verificado sobre Cloud Firestore para el espacio de trabajo {currentAccount.name}.
                    </p>
                </div>
                <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                    TENANT: {currentAccount.id}
                </span>
            </header>

            {/* KPIs Numéricos Tabulares */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-fib-21">
                {kpis.map((card) => (
                    <div
                        key={card.label}
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

            {/* Macro-Layout Proporción Áurea: 61.8% Desglose por Módulo / 38.2% Alcance Técnico */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            Volumen Registrado por Módulo Integrado
                        </h2>
                    </div>
                    <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                        <thead>
                            <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                <th className="py-fib-13 px-fib-21">MÓDULO</th>
                                <th className="py-fib-13 px-fib-21">ESTADO</th>
                                <th className="py-fib-13 px-fib-21 text-right">DOCUMENTOS</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            <tr>
                                <td className="py-fib-13 px-fib-21 font-bold text-[#0F172A] dark:text-[#F3F4F6]">OPERMAQ</td>
                                <td className="py-fib-13 px-fib-21">
                                    <span className={enabledModules.opermaq ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                        {enabledModules.opermaq ? 'HABILITADO' : 'NO ASIGNADO'}
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
                                        {enabledModules.stockpile ? 'HABILITADO' : 'NO ASIGNADO'}
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
                        CRITERIO DE MEDICIÓN
                    </h2>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                        Los indicadores reflejan exclusivamente documentos persistidos bajo aislamiento <span className="font-mono">tenantId</span> en la región <span className="font-mono">southamerica-west1</span>.
                    </p>
                    {!loading && metrics.fleetAssetsCount === 0 && metrics.inspectionsCount === 0 && metrics.stockpilesCount === 0 && (
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072] pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            [Información técnica no declarada en ficha] — Sin actividad operacional acumulada.
                        </p>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default MetricasPage;
