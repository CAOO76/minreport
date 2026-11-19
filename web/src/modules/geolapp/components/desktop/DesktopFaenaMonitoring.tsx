import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useOptionalTheme } from '../../../../context/ThemeContext';
import {
    computeAllFaenasBreakdown,
    computeFaenaMetrics,
    UNASSIGNED_FAENA_ID,
} from '../../core/services/stockpile-faena-metrics';
import type {
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../../core/types/GeolappTypes';

export interface DesktopFaenaMonitoringProps {
    assets: StockpileAsset[];
    measurements: StockpileMeasurement[];
    sites: MiningSiteProfile[];
    activeFaenaId: string | 'ALL';
    onSelectFaena: (faenaId: string | 'ALL') => void;
    onSelectAsset: (asset: StockpileAsset) => void;
}

type ChartMetricKey = 'volumeM3' | 'wetWeightT' | 'dryWeightT' | 'fineCuT';
type DaysWindow = 7 | 30 | 90 | null;

export const DesktopFaenaMonitoring: React.FC<DesktopFaenaMonitoringProps> = ({
    assets,
    measurements,
    sites,
    activeFaenaId,
    onSelectFaena,
    onSelectAsset,
}) => {
    const { t } = useTranslation();
    const themeCtx = useOptionalTheme();
    const isDark = themeCtx?.theme === 'dark';

    const [metricKey, setMetricKey] = useState<ChartMetricKey>('volumeM3');
    const [daysWindow, setDaysWindow] = useState<DaysWindow>(30);

    const metrics = useMemo(
        () => computeFaenaMetrics(assets, measurements, activeFaenaId, sites, daysWindow),
        [assets, measurements, activeFaenaId, sites, daysWindow]
    );

    const allFaenas = useMemo(
        () => computeAllFaenasBreakdown(assets, measurements, sites),
        [assets, measurements, sites]
    );

    const metricUnit = metricKey === 'volumeM3' ? 'm³' : 't';
    const deltaSign =
        typeof metrics.netDeltaVolumeM3 === 'number' && metrics.netDeltaVolumeM3 > 0 ? '+' : '';
    const deltaDisplay =
        typeof metrics.netDeltaVolumeM3 === 'number'
            ? `${deltaSign}${metrics.netDeltaVolumeM3.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
              })} m³`
            : '--';

    const totalAlerts = metrics.imsbcBlockedCount + metrics.sulfideAlertCount;
    const totalCycleWeight = metrics.activeWetWeightT + metrics.shippedWeightT;
    const activeSharePct =
        totalCycleWeight > 0
            ? Math.round((metrics.activeWetWeightT / totalCycleWeight) * 100)
            : 0;

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none">
            <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('monitoring.active_volume', 'VOLUMEN ACTIVO')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#C68346]">
                        {metrics.activeVolumeM3.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                        })}{' '}
                        m³
                    </span>
                </div>
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('monitoring.wet_weight', 'THM [t]')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums">
                        {metrics.activeWetWeightT.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                        })}{' '}
                        t
                    </span>
                </div>
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('monitoring.dry_weight', 'TMS [t]')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums">
                        {metrics.activeDryWeightT !== null
                            ? `${metrics.activeDryWeightT.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                              })} t`
                            : '--'}
                    </span>
                </div>
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('monitoring.fine_cu', 'Cu FINO [t]')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#00AEEF]">
                        {metrics.activeFineCuT !== null
                            ? `${metrics.activeFineCuT.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                              })} t`
                            : '--'}
                    </span>
                </div>
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('history.delta_volume', 'Δ CAMPAÑA')}
                    </span>
                    <span className="text-h2-section font-mono font-bold tabular-nums text-[#00AEEF]">
                        {deltaDisplay}
                    </span>
                </div>
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('monitoring.shipped_total', 'EMBARCADO')}
                    </span>
                    <span className="text-h2-section font-mono font-bold tabular-nums">
                        {metrics.shippedWeightT.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                        })}{' '}
                        t
                    </span>
                </div>
                <div className="px-fib-13 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('monitoring.active_closed', 'ACTIVOS / CERRADOS')}
                    </span>
                    <span className="text-h2-section font-mono font-bold tabular-nums">
                        {metrics.activeCount} / {metrics.closedCount}
                        {totalAlerts > 0 && (
                            <span className="ml-2 text-microcopy text-[#C68346]">
                                ({totalAlerts})
                            </span>
                        )}
                    </span>
                </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] overflow-hidden">
                {/* Área Mayor (61.8%): Gráfica Evolución Full + Tabla en Tiempo Real */}
                <section className="min-h-0 overflow-y-auto p-fib-21 space-y-fib-21">
                    <div className="flex flex-wrap items-center justify-between gap-fib-13">
                        <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('monitoring.evolution_title', 'EVOLUCIÓN CONSOLIDADA')} ·{' '}
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                {activeFaenaId === 'ALL'
                                    ? t('faenas.all', 'TODAS LAS FAENAS')
                                    : activeFaenaId === UNASSIGNED_FAENA_ID
                                      ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                                      : metrics.faenaName}
                            </span>
                        </span>

                        <div className="flex flex-wrap items-center gap-fib-21">
                            <div className="flex items-center gap-fib-13">
                                {(
                                    [
                                        { id: 'volumeM3', label: 'm³' },
                                        { id: 'wetWeightT', label: 'THM' },
                                        { id: 'dryWeightT', label: 'TMS' },
                                        { id: 'fineCuT', label: 'CuF' },
                                    ] as const
                                ).map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => setMetricKey(opt.id)}
                                        className={`py-1 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none ${
                                            metricKey === opt.id
                                                ? 'border-[#C68346] text-[#C68346]'
                                                : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-fib-13">
                                {(
                                    [
                                        { val: 7 as DaysWindow, label: t('monitoring.range_7d', '7D') },
                                        { val: 30 as DaysWindow, label: t('monitoring.range_30d', '30D') },
                                        { val: 90 as DaysWindow, label: t('monitoring.range_90d', '90D') },
                                        { val: null as DaysWindow, label: t('monitoring.range_all', 'TODO') },
                                    ]
                                ).map((r) => (
                                    <button
                                        key={String(r.val)}
                                        type="button"
                                        onClick={() => setDaysWindow(r.val)}
                                        className={`py-1 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none ${
                                            daysWindow === r.val
                                                ? 'border-[#00AEEF] text-[#00AEEF]'
                                                : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                        }`}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="h-64 p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                        {metrics.timeline.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('monitoring.no_evolution', 'SIN SERIE TEMPORAL REGISTRADA')}
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                    data={metrics.timeline}
                                    margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                                >
                                    <CartesianGrid
                                        stroke={isDark ? '#12151C' : '#E2E8F0'}
                                        strokeDasharray="0"
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="label"
                                        stroke={isDark ? '#8A93A6' : '#475569'}
                                        tick={{ fontSize: 11, fontFamily: 'monospace' }}
                                    />
                                    <YAxis
                                        stroke={isDark ? '#8A93A6' : '#475569'}
                                        tick={{ fontSize: 11, fontFamily: 'monospace' }}
                                        width={56}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: isDark ? '#07090D' : '#FFFFFF',
                                            border: `1px solid ${isDark ? '#12151C' : '#E2E8F0'}`,
                                            borderRadius: 0,
                                            boxShadow: 'none',
                                            fontFamily: 'monospace',
                                            fontSize: 12,
                                        }}
                                        formatter={(val: unknown) => [
                                            `${Number(val || 0).toLocaleString(undefined, {
                                                maximumFractionDigits: 2,
                                            })} ${metricUnit}`,
                                            metricKey.toUpperCase(),
                                        ]}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey={metricKey}
                                        stroke="#C68346"
                                        strokeWidth={2}
                                        fill="#C68346"
                                        fillOpacity={0.14}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    <div className="space-y-fib-8">
                        <span className="block text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('monitoring.inventory_table', 'ACOPIOS EN FAENA')} ({metrics.assets.length})
                        </span>

                        <div className="border border-[#E2E8F0] dark:border-[#12151C] divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {metrics.assets.length === 0 ? (
                                <p className="py-fib-21 text-center text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                                    {t('analytics.no_assets', 'Sin acopios registrados')}
                                </p>
                            ) : (
                                metrics.assets.map((asset) => {
                                    const vol = asset.last_volume_m3 ?? asset.volumen ?? 0;
                                    const wt = asset.last_weight_t ?? asset.peso_final_toneladas ?? 0;
                                    const isClosed = asset.status === 'CLOSED';
                                    return (
                                        <button
                                            key={asset.id}
                                            type="button"
                                            onClick={() => onSelectAsset(asset)}
                                            className="w-full px-fib-13 py-fib-8 bg-transparent hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] border-0 flex items-center justify-between gap-fib-13 text-left font-mono tabular-nums cursor-pointer rounded-none"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <span className="block text-data-dense font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                    {asset.name}
                                                </span>
                                                <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                                    {asset.project_name ||
                                                        t('faenas.unassigned', 'SIN FAENA ASIGNADA')}
                                                    {asset.copper_domain
                                                        ? ` · ${t(
                                                              `copper_domains.${asset.copper_domain}`,
                                                              asset.copper_domain
                                                          )}`
                                                        : ''}
                                                </span>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <span className="block text-data-dense font-bold text-[#C68346]">
                                                    {vol.toLocaleString(undefined, {
                                                        maximumFractionDigits: 1,
                                                    })}{' '}
                                                    m³
                                                </span>
                                                <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    {wt.toLocaleString(undefined, {
                                                        maximumFractionDigits: 1,
                                                    })}{' '}
                                                    t ·{' '}
                                                    <span
                                                        className={
                                                            isClosed
                                                                ? 'text-[#C68346]'
                                                                : 'text-[#00AEEF]'
                                                        }
                                                    >
                                                        {isClosed
                                                            ? t('lifecycle.filter_closed', 'CERRADO')
                                                            : t('lifecycle.active', 'ACTIVO')}
                                                    </span>
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </section>

                {/* Área Menor (38.2%): Dominios Cu + Balance Ciclo + Consolidado por Faena */}
                <aside className="min-h-0 overflow-y-auto border-t xl:border-t-0 xl:border-l border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 space-y-fib-21">
                    <section className="space-y-fib-13">
                        <span className="block text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('monitoring.domains_title', 'DISTRIBUCIÓN POR DOMINIO Cu')}
                        </span>
                        {metrics.domains.length === 0 ? (
                            <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                {t('core_common.undeclared_tech_value', '[Información técnica no declarada en ficha]')}
                            </p>
                        ) : (
                            <div className="space-y-fib-13">
                                {metrics.domains.map((slice) => (
                                    <div key={slice.domain} className="space-y-1">
                                        <div className="flex items-baseline justify-between gap-fib-8 font-mono text-microcopy tabular-nums">
                                            <span className="uppercase truncate">
                                                {slice.domain === 'UNDECLARED'
                                                    ? t(
                                                          'core_common.undeclared_tech_value',
                                                          '[Información técnica no declarada en ficha]'
                                                      )
                                                    : t(
                                                          `copper_domains.${slice.domain}`,
                                                          slice.domain
                                                      )}
                                            </span>
                                            <span className="font-bold text-[#C68346] shrink-0">
                                                {slice.sharePct.toFixed(0)}% ·{' '}
                                                {slice.volumeM3.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}{' '}
                                                m³
                                            </span>
                                        </div>
                                        <div className="h-1 w-full bg-[#E2E8F0] dark:bg-[#12151C] rounded-none">
                                            <div
                                                className="h-1 bg-[#C68346] rounded-none"
                                                style={{
                                                    width: `${Math.min(100, slice.sharePct)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                        <span className="block text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('monitoring.cycle_balance', 'BALANCE DE CICLO')}
                        </span>
                        <div className="flex items-center justify-between font-mono text-data-dense tabular-nums">
                            <span className="text-[#00AEEF]">
                                {t('lifecycle.active', 'ACTIVO')}:{' '}
                                {metrics.activeWetWeightT.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                })}{' '}
                                t
                            </span>
                            <span className="text-[#C68346]">
                                {t('monitoring.shipped_total', 'EMBARCADO')}:{' '}
                                {metrics.shippedWeightT.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                })}{' '}
                                t
                            </span>
                        </div>
                        <div className="h-1 w-full bg-[#C68346] rounded-none overflow-hidden flex">
                            <div
                                className="h-1 bg-[#00AEEF] rounded-none"
                                style={{ width: `${activeSharePct}%` }}
                            />
                        </div>
                    </section>

                    <section className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                        <span className="block text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('monitoring.faena_breakdown', 'CONSOLIDADO POR FAENA')}
                        </span>
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-t border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <button
                                type="button"
                                onClick={() => onSelectFaena('ALL')}
                                className={`w-full py-fib-8 bg-transparent border-0 text-left flex items-center justify-between gap-fib-8 font-mono tabular-nums cursor-pointer rounded-none ${
                                    activeFaenaId === 'ALL' ? 'text-[#C68346]' : ''
                                }`}
                            >
                                <span className="text-microcopy font-bold uppercase truncate">
                                    {t('faenas.all', 'TODAS LAS FAENAS')} (
                                    {allFaenas.reduce((sum, item) => sum + item.activeCount, 0)})
                                </span>
                                <span className="text-microcopy font-bold shrink-0">
                                    {allFaenas
                                        .reduce((sum, item) => sum + item.activeVolumeM3, 0)
                                        .toLocaleString(undefined, {
                                            maximumFractionDigits: 1,
                                        })}{' '}
                                    m³
                                </span>
                            </button>
                            {allFaenas.map((item) => {
                                const isSelected = item.faenaId === activeFaenaId;
                                const label =
                                    item.faenaId === UNASSIGNED_FAENA_ID
                                        ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                                        : item.faenaName;
                                return (
                                    <button
                                        key={item.faenaId}
                                        type="button"
                                        onClick={() => onSelectFaena(item.faenaId)}
                                        className={`w-full py-fib-8 bg-transparent border-0 text-left flex items-center justify-between gap-fib-8 font-mono tabular-nums cursor-pointer rounded-none ${
                                            isSelected ? 'text-[#C68346]' : ''
                                        }`}
                                    >
                                        <span className="text-microcopy font-bold uppercase truncate">
                                            {label} ({item.activeCount})
                                        </span>
                                        <span className="text-microcopy font-bold shrink-0">
                                            {item.activeVolumeM3.toLocaleString(undefined, {
                                                maximumFractionDigits: 1,
                                            })}{' '}
                                            m³
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default DesktopFaenaMonitoring;
