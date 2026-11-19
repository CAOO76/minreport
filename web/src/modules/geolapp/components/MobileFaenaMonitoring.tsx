import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    computeAllFaenasBreakdown,
    computeFaenaMetrics,
    UNASSIGNED_FAENA_ID,
} from '../core/services/stockpile-faena-metrics';
import type {
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';

export interface MobileFaenaMonitoringProps {
    assets: StockpileAsset[];
    measurements: StockpileMeasurement[];
    sites: MiningSiteProfile[];
    activeFaenaId: string | 'ALL';
    onSelectFaena: (faenaId: string | 'ALL') => void;
    onSelectAsset: (asset: StockpileAsset) => void;
}

type MetricAxis = 'volumeM3' | 'wetWeightT';

const SimpleEvolutionChart: React.FC<{
    points: Array<{ label: string; value: number }>;
    unit: string;
    emptyText: string;
}> = ({ points, unit, emptyText }) => {
    if (points.length === 0) {
        return (
            <div className="py-fib-34 text-center text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                {emptyText}
            </div>
        );
    }

    const values = points.map((p) => p.value);
    const maxVal = Math.max(...values, 1);
    const minVal = Math.min(...values, 0);
    const span = Math.max(maxVal - minVal, 1);

    const width = 320;
    const height = 132;
    const padX = 8;
    const padY = 14;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const coords = points.map((pt, idx) => {
        const x =
            points.length === 1
                ? padX + plotW / 2
                : padX + (idx / (points.length - 1)) * plotW;
        const y = padY + plotH - ((pt.value - minVal) / span) * plotH;
        return { x, y, ...pt };
    });

    const linePath = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPath =
        coords.length >= 2
            ? `M ${coords[0].x.toFixed(1)} ${(padY + plotH).toFixed(1)} L ${coords
                  .map((c) => `${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
                  .join(' L ')} L ${coords[coords.length - 1].x.toFixed(1)} ${(
                  padY + plotH
              ).toFixed(1)} Z`
            : '';

    const firstLabel = points[0]?.label || '';
    const lastLabel = points[points.length - 1]?.label || '';

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                <span>
                    MAX {maxVal.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
                </span>
                <span>
                    MIN {minVal.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
                </span>
            </div>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-36 bg-transparent rounded-none"
                role="img"
                aria-label={unit}
            >
                <line
                    x1={padX}
                    y1={padY}
                    x2={width - padX}
                    y2={padY}
                    stroke="currentColor"
                    strokeOpacity="0.12"
                    strokeWidth="1"
                />
                <line
                    x1={padX}
                    y1={padY + plotH / 2}
                    x2={width - padX}
                    y2={padY + plotH / 2}
                    stroke="currentColor"
                    strokeOpacity="0.12"
                    strokeWidth="1"
                />
                <line
                    x1={padX}
                    y1={padY + plotH}
                    x2={width - padX}
                    y2={padY + plotH}
                    stroke="currentColor"
                    strokeOpacity="0.18"
                    strokeWidth="1"
                />
                {areaPath && <path d={areaPath} fill="#C68346" fillOpacity="0.12" />}
                {coords.length >= 2 && (
                    <polyline
                        fill="none"
                        stroke="#C68346"
                        strokeWidth="2"
                        points={linePath}
                    />
                )}
                {coords.map((pt, idx) => (
                    <rect
                        key={`${pt.label}_${idx}`}
                        x={pt.x - 2.5}
                        y={pt.y - 2.5}
                        width={5}
                        height={5}
                        fill={idx === coords.length - 1 ? '#00AEEF' : '#C68346'}
                    />
                ))}
            </svg>
            <div className="flex items-center justify-between text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                <span>{firstLabel}</span>
                {points.length > 1 && <span>{lastLabel}</span>}
            </div>
        </div>
    );
};

export const MobileFaenaMonitoring: React.FC<MobileFaenaMonitoringProps> = ({
    assets,
    measurements,
    sites,
    activeFaenaId,
    onSelectFaena,
    onSelectAsset,
}) => {
    const { t } = useTranslation();
    const [metricAxis, setMetricAxis] = useState<MetricAxis>('volumeM3');

    const metrics = useMemo(
        () => computeFaenaMetrics(assets, measurements, activeFaenaId, sites, null),
        [assets, measurements, activeFaenaId, sites]
    );

    const faenaBreakdown = useMemo(
        () => computeAllFaenasBreakdown(assets, measurements, sites),
        [assets, measurements, sites]
    );

    const chartPoints = useMemo(
        () =>
            metrics.timeline.map((pt) => ({
                label: pt.label,
                value: metricAxis === 'volumeM3' ? pt.volumeM3 : pt.wetWeightT,
            })),
        [metricAxis, metrics.timeline]
    );

    const deltaSign =
        typeof metrics.netDeltaVolumeM3 === 'number' && metrics.netDeltaVolumeM3 > 0 ? '+' : '';
    const deltaFormatted =
        typeof metrics.netDeltaVolumeM3 === 'number'
            ? `${deltaSign}${metrics.netDeltaVolumeM3.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
              })} m³`
            : '--';

    const maxRowVol = useMemo(() => {
        if (activeFaenaId === 'ALL') {
            return Math.max(...faenaBreakdown.map((f) => f.activeVolumeM3), 1);
        }
        return Math.max(
            ...metrics.assets.map((a) => a.last_volume_m3 ?? a.volumen ?? 0),
            1
        );
    }, [activeFaenaId, faenaBreakdown, metrics.assets]);

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            <div className="shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 min-w-0 flex-1">
                    <span className="material-symbols-outlined text-[18px] text-[#C68346] shrink-0">
                        monitoring
                    </span>
                    <select
                        value={activeFaenaId}
                        onChange={(e) => {
                            void triggerFieldImpact('LIGHT');
                            onSelectFaena(e.target.value as string | 'ALL');
                        }}
                        aria-label={t('faenas.select_aria', 'Seleccionar faena minera')}
                        className="flex-1 min-w-0 h-10 bg-transparent border-0 outline-none font-mono text-microcopy font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                    >
                        <option value="ALL">{t('faenas.all', 'TODAS LAS FAENAS')}</option>
                        {sites.map((site) => (
                            <option key={site.id} value={site.id}>
                                {site.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-fib-21 py-fib-21 space-y-fib-21 pb-fib-55">
                <section className="space-y-fib-13">
                    <div className="flex items-baseline justify-between gap-fib-8">
                        <div>
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('monitoring.active_volume', 'VOLUMEN ACTIVO')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                                {metrics.activeVolumeM3.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                })}{' '}
                                m³
                            </span>
                        </div>
                        <span className="text-data-dense font-mono font-bold tabular-nums text-[#00AEEF]">
                            {deltaFormatted}
                        </span>
                    </div>

                    <div className="grid grid-cols-3 border-t border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C]">
                        <div className="py-fib-8 pr-fib-8">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('monitoring.wet_weight', 'THM [t]')}
                            </span>
                            <span className="text-data-dense font-mono font-bold tabular-nums">
                                {metrics.activeWetWeightT.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                })}
                            </span>
                        </div>
                        <div className="py-fib-8 px-fib-8">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('monitoring.active_closed', 'ACTIVOS / CERRADOS')}
                            </span>
                            <span className="text-data-dense font-mono font-bold tabular-nums">
                                {metrics.activeCount} / {metrics.closedCount}
                            </span>
                        </div>
                        <div className="py-fib-8 pl-fib-8">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('monitoring.fine_cu', 'Cu FINO [t]')}
                            </span>
                            <span className="text-data-dense font-mono font-bold tabular-nums text-[#00AEEF]">
                                {metrics.activeFineCuT !== null
                                    ? metrics.activeFineCuT.toLocaleString(undefined, {
                                          maximumFractionDigits: 1,
                                      })
                                    : '--'}
                            </span>
                        </div>
                    </div>
                </section>

                <section className="space-y-fib-8">
                    <div className="flex items-center justify-between">
                        <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('monitoring.evolution_title', 'EVOLUCIÓN CONSOLIDADA')}
                        </span>
                        <div className="flex items-center gap-fib-13">
                            {(['volumeM3', 'wetWeightT'] as const).map((axis) => (
                                <button
                                    key={axis}
                                    type="button"
                                    onClick={() => setMetricAxis(axis)}
                                    className={`py-1 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none ${
                                        metricAxis === axis
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    {axis === 'volumeM3' ? 'm³' : 't'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <SimpleEvolutionChart
                        points={chartPoints}
                        unit={metricAxis === 'volumeM3' ? 'm³' : 't'}
                        emptyText={t('monitoring.no_evolution', 'SIN SERIE TEMPORAL REGISTRADA')}
                    />
                </section>

                <section className="space-y-fib-8">
                    <span className="block text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                        {activeFaenaId === 'ALL'
                            ? t('monitoring.faena_breakdown', 'CONSOLIDADO POR FAENA')
                            : t('monitoring.inventory_table', 'ACOPIOS EN FAENA')}
                    </span>

                    {activeFaenaId === 'ALL' ? (
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-t border-b border-[#E2E8F0] dark:border-[#12151C]">
                            {faenaBreakdown.length === 0 && (
                                <p className="py-fib-21 text-center text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('home.empty_state', 'SIN ACOPIOS REGISTRADOS EN ESTE FILTRO')}
                                </p>
                            )}
                            {faenaBreakdown.map((item) => {
                                const pct = Math.min(
                                    100,
                                    Math.round((item.activeVolumeM3 / maxRowVol) * 100)
                                );
                                const label =
                                    item.faenaId === UNASSIGNED_FAENA_ID
                                        ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                                        : item.faenaName;
                                return (
                                    <button
                                        key={item.faenaId}
                                        type="button"
                                        onClick={() => {
                                            if (item.faenaId !== UNASSIGNED_FAENA_ID) {
                                                onSelectFaena(item.faenaId);
                                            }
                                        }}
                                        className="w-full py-fib-13 bg-transparent border-0 text-left space-y-1.5 cursor-pointer rounded-none"
                                    >
                                        <div className="flex items-baseline justify-between gap-fib-8 font-mono tabular-nums">
                                            <span className="text-data-dense font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                {label}
                                            </span>
                                            <span className="text-data-dense font-bold text-[#C68346] shrink-0">
                                                {item.activeVolumeM3.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}{' '}
                                                m³
                                            </span>
                                        </div>
                                        <div className="h-1 w-full bg-[#E2E8F0] dark:bg-[#12151C] rounded-none">
                                            <div
                                                className="h-1 bg-[#C68346] rounded-none"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-t border-b border-[#E2E8F0] dark:border-[#12151C]">
                            {metrics.assets.length === 0 && (
                                <p className="py-fib-21 text-center text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('home.empty_state', 'SIN ACOPIOS REGISTRADOS EN ESTE FILTRO')}
                                </p>
                            )}
                            {metrics.assets.map((asset) => {
                                const vol =
                                    asset.status === 'CLOSED'
                                        ? 0
                                        : asset.last_volume_m3 ?? asset.volumen ?? 0;
                                const pct = Math.min(100, Math.round((vol / maxRowVol) * 100));
                                return (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        onClick={() => onSelectAsset(asset)}
                                        className="w-full py-fib-13 bg-transparent border-0 text-left space-y-1.5 cursor-pointer rounded-none"
                                    >
                                        <div className="flex items-baseline justify-between gap-fib-8 font-mono tabular-nums">
                                            <span className="text-data-dense font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                {asset.name}
                                            </span>
                                            <span className="text-data-dense font-bold text-[#C68346] shrink-0">
                                                {vol.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}{' '}
                                                m³
                                            </span>
                                        </div>
                                        <div className="h-1 w-full bg-[#E2E8F0] dark:bg-[#12151C] rounded-none">
                                            <div
                                                className="h-1 bg-[#C68346] rounded-none"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default MobileFaenaMonitoring;
