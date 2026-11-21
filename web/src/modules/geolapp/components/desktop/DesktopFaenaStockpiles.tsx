import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SecureImage } from '../../../../components/common/SecureImage';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import { useResolvedStockpileImage } from '../../core/services/StorageService';
import {
    sortStockpilesByLifecycle,
    UNASSIGNED_FAENA_ID,
} from '../../core/services/stockpile-faena-metrics';
import type { CopperMineralDomain, StockpileAsset } from '../../core/types/GeolappTypes';
import { formatSignedDelta } from './desktopHelpers';

export interface DesktopFaenaStockpilesProps {
    faenaId: string;
    faenaName: string;
    assets: StockpileAsset[];
    onSelectAsset: (asset: StockpileAsset) => void;
}

type CycleFilter = 'ALL' | 'ACTIVE' | 'SHIPPED' | 'FIELD_REMOVED';

const StockpileRowThumb: React.FC<{ asset: StockpileAsset }> = ({ asset }) => {
    const rawUrl = asset.last_photo_url || asset.initial_photo_url || asset.thumbnail_url;
    const resolved = useResolvedStockpileImage(rawUrl);

    if (!resolved) {
        return (
            <div className="w-10 h-10 shrink-0 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-center rounded-none">
                <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                    landscape
                </span>
            </div>
        );
    }

    return (
        <div className="w-10 h-10 shrink-0 border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] overflow-hidden rounded-none">
            <SecureImage
                src={resolved}
                alt={asset.name}
                className="w-full h-full object-cover"
            />
        </div>
    );
};

export const DesktopFaenaStockpiles: React.FC<DesktopFaenaStockpilesProps> = ({
    faenaId,
    faenaName,
    assets,
    onSelectAsset,
}) => {
    const { t } = useTranslation();

    const [cycleFilter, setCycleFilter] = useState<CycleFilter>('ALL');
    const [domainFilter, setDomainFilter] = useState<CopperMineralDomain | 'ALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    const faenaAssets = useMemo(() => {
        const scoped = assets.filter((a) => {
            const pid = (a.project_id || '').trim();
            if (faenaId === UNASSIGNED_FAENA_ID) return !pid;
            return pid === faenaId;
        });
        return sortStockpilesByLifecycle(scoped);
    }, [assets, faenaId]);

    const cycleCounts = useMemo(() => {
        let active = 0;
        let shipped = 0;
        let removed = 0;
        for (const a of faenaAssets) {
            if (a.status !== 'CLOSED') active += 1;
            else if (a.closure_reason === 'SHIPPED') shipped += 1;
            else if (a.closure_reason === 'FIELD_REMOVED') removed += 1;
        }
        return { total: faenaAssets.length, active, shipped, removed };
    }, [faenaAssets]);

    const availableDomains = useMemo(() => {
        const set = new Set<CopperMineralDomain>();
        for (const a of faenaAssets) {
            if (a.copper_domain) set.add(a.copper_domain);
        }
        return Array.from(set);
    }, [faenaAssets]);

    const filteredAssets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return faenaAssets.filter((a) => {
            if (cycleFilter === 'ACTIVE' && a.status === 'CLOSED') return false;
            if (
                cycleFilter === 'SHIPPED' &&
                !(a.status === 'CLOSED' && a.closure_reason === 'SHIPPED')
            ) {
                return false;
            }
            if (
                cycleFilter === 'FIELD_REMOVED' &&
                !(a.status === 'CLOSED' && a.closure_reason === 'FIELD_REMOVED')
            ) {
                return false;
            }
            if (domainFilter !== 'ALL' && a.copper_domain !== domainFilter) return false;
            if (!q) return true;
            return (
                a.name.toLowerCase().includes(q) ||
                (a.location_ref || '').toLowerCase().includes(q) ||
                (a.dispatch_transport || '').toLowerCase().includes(q) ||
                (a.dispatch_destination || '').toLowerCase().includes(q)
            );
        });
    }, [faenaAssets, cycleFilter, domainFilter, searchQuery]);

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none">
            <div className="shrink-0 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex items-center gap-fib-21">
                    {(
                        [
                            {
                                id: 'ALL' as const,
                                label: t('lifecycle.filter_all', 'TODOS'),
                                count: cycleCounts.total,
                            },
                            {
                                id: 'ACTIVE' as const,
                                label: t('lifecycle.filter_active', 'ACTIVOS'),
                                count: cycleCounts.active,
                            },
                            {
                                id: 'SHIPPED' as const,
                                label: t('lifecycle.filter_shipped', 'DESPACHADOS'),
                                count: cycleCounts.shipped,
                            },
                            {
                                id: 'FIELD_REMOVED' as const,
                                label: t('lifecycle.filter_removed', 'ELIMINADOS'),
                                count: cycleCounts.removed,
                            },
                        ]
                    ).map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setCycleFilter(tab.id)}
                            className={`py-fib-13 text-microcopy font-mono font-bold uppercase border-0 border-b-2 bg-transparent cursor-pointer rounded-none transition-colors tabular-nums ${
                                cycleFilter === tab.id
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>

                <div className="py-fib-8 flex items-center gap-fib-13">
                    <span className="hidden lg:inline text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate max-w-[200px]">
                        {faenaName}
                    </span>
                    <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t(
                            'desktop.search_stockpile_placeholder',
                            'FILTRAR CÓDIGO O UBICACIÓN'
                        )}
                        aria-label={t(
                            'desktop.search_stockpile_placeholder',
                            'FILTRAR CÓDIGO O UBICACIÓN'
                        )}
                        className="h-9 w-64 px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                    />
                </div>
            </div>

            {availableDomains.length > 1 && (
                <div className="shrink-0 px-fib-21 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex flex-wrap items-center gap-fib-13">
                    <button
                        type="button"
                        onClick={() => setDomainFilter('ALL')}
                        className={`py-1 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none transition-colors ${
                            domainFilter === 'ALL'
                                ? 'border-[#00AEEF] text-[#00AEEF]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        {t('desktop.all_domains_filter', 'TODOS LOS DOMINIOS')}
                    </button>
                    {availableDomains.map((dom) => (
                        <button
                            key={dom}
                            type="button"
                            onClick={() => setDomainFilter(dom)}
                            className={`py-1 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none transition-colors ${
                                domainFilter === dom
                                    ? 'border-[#00AEEF] text-[#00AEEF]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            {t(`copper_domains.${dom}`, dom)}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
                {filteredAssets.length === 0 ? (
                    <div className="h-full flex items-center justify-center p-fib-55">
                        <div className="text-center space-y-fib-13 max-w-md">
                            <span className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]">
                                landscape
                            </span>
                            <p className="text-body-main font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('analytics.no_assets', 'Sin acopios registrados')}
                            </p>
                            <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                                {t(
                                    'monitoring.field_only_create_hint',
                                    'Los acopios nuevos se levantan en terreno desde la aplicación móvil MINREPORT.'
                                )}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-data-dense tabular-nums border-collapse">
                            <thead>
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <th className="px-fib-21 py-fib-13 w-14" />
                                    <th className="px-fib-13 py-fib-13">
                                        {t('registration.name_label', 'ACOPIO')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13">
                                        {t('registration.copper_domain_label', 'DOMINIO Cu')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13">
                                        {t('desktop.col_location', 'UBICACIÓN')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('dossier.volume_label', 'VOLUMEN')} [m³]
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('history.delta_volume', 'Δ CAMPAÑA')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('desktop.col_weight_thm', 'THM [t]')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('desktop.col_last_measure', 'ÚLTIMA MEDICIÓN')}
                                    </th>
                                    <th className="px-fib-21 py-fib-13 text-right" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {filteredAssets.map((asset) => {
                                    const isClosed = asset.status === 'CLOSED';
                                    const vol = asset.last_volume_m3 ?? asset.volumen ?? 0;
                                    const thm =
                                        asset.wet_weight_thm ??
                                        asset.last_weight_t ??
                                        asset.peso_final_toneladas ??
                                        0;
                                    const deltaStr = formatSignedDelta(
                                        asset.last_delta_volumen_m3,
                                        asset.last_delta_volumen_pct
                                    );
                                    const lastTs = asset.last_measured_at || asset.createdAt;
                                    const dateLabel = lastTs
                                        ? new Date(lastTs).toLocaleDateString()
                                        : '--';
                                    return (
                                        <tr
                                            key={asset.id}
                                            onClick={() => onSelectAsset(asset)}
                                            className="cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors"
                                        >
                                            <td className="px-fib-21 py-fib-13">
                                                <StockpileRowThumb asset={asset} />
                                            </td>
                                            <td className="px-fib-13 py-fib-13">
                                                <span className="block font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {asset.name}
                                                </span>
                                                <span
                                                    className={`inline-flex items-center gap-1 text-microcopy font-bold uppercase ${
                                                        isClosed
                                                            ? asset.closure_reason === 'SHIPPED'
                                                                ? 'text-[#C68346]'
                                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                                            : 'text-[#00AEEF]'
                                                    }`}
                                                >
                                                    {isClosed && (
                                                        <span className="material-symbols-outlined text-[14px]">
                                                            {asset.closure_reason === 'SHIPPED'
                                                                ? 'delivery_truck_speed'
                                                                : asset.closure_reason ===
                                                                    'FIELD_REMOVED'
                                                                  ? 'delete_sweep'
                                                                  : 'lock'}
                                                        </span>
                                                    )}
                                                    <span>
                                                        {isClosed
                                                            ? asset.closure_reason === 'SHIPPED'
                                                                ? t('lifecycle.shipped', 'DESPACHADO')
                                                                : asset.closure_reason ===
                                                                    'FIELD_REMOVED'
                                                                  ? t(
                                                                        'lifecycle.removed',
                                                                        'ELIMINADO'
                                                                    )
                                                                  : t(
                                                                        'lifecycle.filter_closed',
                                                                        'CERRADO'
                                                                    )
                                                            : t('lifecycle.active', 'ACTIVO')}
                                                    </span>
                                                </span>
                                            </td>
                                            <td className="px-fib-13 py-fib-13 uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {asset.copper_domain
                                                    ? t(
                                                          `copper_domains.${asset.copper_domain}`,
                                                          asset.copper_domain
                                                      )
                                                    : t(
                                                          'core_common.undeclared_tech_value',
                                                          UNDECLARED_TECH_VALUE
                                                      )}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-[#475569] dark:text-[#8A93A6]">
                                                {asset.location_ref
                                                    ? asset.location_ref
                                                    : t(
                                                          'core_common.undeclared_tech_value',
                                                          UNDECLARED_TECH_VALUE
                                                      )}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right font-bold text-[#C68346]">
                                                {vol.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right text-[#00AEEF]">
                                                {deltaStr || '--'}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right text-[#0F172A] dark:text-[#F3F4F6]">
                                                {thm > 0
                                                    ? thm.toLocaleString(undefined, {
                                                          maximumFractionDigits: 1,
                                                      })
                                                    : '--'}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right text-[#475569] dark:text-[#8A93A6]">
                                                {dateLabel}
                                            </td>
                                            <td className="px-fib-21 py-fib-13 text-right">
                                                <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072]">
                                                    chevron_right
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DesktopFaenaStockpiles;
