import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import M3Switch from '../../../components/common/M3Switch';
import CopyButton from '../../../components/common/CopyButton';
import { cn } from '../../../utils/cn';
import {
    PROCUREMENT_BUCKETS,
    formatClp,
    type ConsolidatedShoppingBucketGroup,
    type ProcurementBucket,
} from '../types';

export interface ConsolidatedShoppingListsViewProps {
    groups: ConsolidatedShoppingBucketGroup[];
    loading: boolean;
    canScanReceipt: boolean;
    onOpenScannerForBucket: (bucket: ProcurementBucket) => void;
}

const BUCKET_ICON: Record<ProcurementBucket, string> = {
    VERDULERIA: 'nutrition',
    SUPERMERCADO: 'storefront',
    AGUA_POTABLE: 'water_drop',
    AGUA_INDUSTRIAL_ALJIBE: 'local_shipping',
    GAS_GLP_DOMESTICO: 'propane_tank',
    GASES_INDUSTRIALES: 'science',
    COMBUSTIBLE_GRANEL: 'local_gas_station',
    REPUESTOS_LUBRICANTES: 'precision_manufacturing',
    FERRETERIA_INSUMOS: 'hardware',
    PERFORACION_FORTIFICACION: 'construction',
    EPP_SEGURIDAD: 'health_and_safety',
    CONTROLADOS_DGMN: 'warning',
    ACTIVOS_CAPEX: 'inventory_2',
    ASEO_HIGIENE: 'cleaning_services',
    MANTENCION_CAMP: 'build',
};

export const ConsolidatedShoppingListsView: React.FC<ConsolidatedShoppingListsViewProps> = ({
    groups,
    loading: _loading,
    canScanReceipt,
    onOpenScannerForBucket,
}) => {
    const { t } = useTranslation();
    const uid = useId();
    const [selectedBucket, setSelectedBucket] = useState<ProcurementBucket | 'ALL'>('ALL');
    const [onlyAtypical, setOnlyAtypical] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
    const [checkedRouteKeys, setCheckedRouteKeys] = useState<Record<string, boolean>>({});

    const toggleExpand = (key: string) => {
        setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleRouteCheck = (key: string) => {
        setCheckedRouteKeys((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const filteredGroups = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return groups
            .filter((g) => selectedBucket === 'ALL' || g.procurementBucket === selectedBucket)
            .map((g) => {
                const items = (g.items || []).filter((it) => {
                    if (onlyAtypical && it.atypicalCount === 0 && (it.atypicalFlags?.length || 0) === 0) {
                        return false;
                    }
                    if (!q) return true;
                    const haystack = [
                        it.name,
                        it.canonicalSkuId,
                        ...(it.sourceReqRefs || []).map((r) => `${r.reqId} ${r.costCenter} ${r.requesterName || ''}`),
                    ]
                        .join(' ')
                        .toLowerCase();
                    return haystack.includes(q);
                });
                return {
                    ...g,
                    items,
                    totalLines: items.length,
                    atypicalCount: items.reduce(
                        (sum, item) => sum + (item.atypicalCount || item.atypicalFlags?.length || 0),
                        0
                    ),
                    estimatedClp: items.reduce((sum, item) => sum + (item.estimatedClp || 0), 0),
                };
            })
            .filter((g) => g.items.length > 0);
    }, [groups, selectedBucket, onlyAtypical, searchQuery]);

    const routeProgress = useMemo(() => {
        let total = 0;
        let checked = 0;
        for (const g of filteredGroups) {
            for (const item of g.items) {
                total += 1;
                const key = `${g.procurementBucket}::${item.canonicalSkuId}`;
                if (checkedRouteKeys[key]) checked += 1;
            }
        }
        return {
            total,
            checked,
            pct: total > 0 ? Math.round((checked / total) * 100) : 0,
        };
    }, [filteredGroups, checkedRouteKeys]);

    return (
        <section className="w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] select-none">
            {/* Flat Filter & Route Progress Strip */}
            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex flex-wrap items-center gap-fib-8">
                    <button
                        type="button"
                        onClick={() => setSelectedBucket('ALL')}
                        aria-label={t('supply.lists.all_buckets')}
                        title={t('supply.lists.all_buckets')}
                        className={cn(
                            'min-h-[48px] px-fib-13 font-mono text-microcopy uppercase border-b-2 transition-colors cursor-pointer bg-transparent rounded-none shadow-none',
                            selectedBucket === 'ALL'
                                ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        {t('supply.lists.all_buckets')}
                    </button>
                    {PROCUREMENT_BUCKETS.map((bucket) => {
                        const active = selectedBucket === bucket;
                        const count =
                            groups.find((g) => g.procurementBucket === bucket)?.items.length || 0;
                        return (
                            <button
                                key={bucket}
                                type="button"
                                onClick={() => setSelectedBucket(bucket)}
                                aria-label={t(`supply.buckets.${bucket}`)}
                                title={t(`supply.buckets.${bucket}`)}
                                className={cn(
                                    'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none',
                                    active
                                        ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                )}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    {BUCKET_ICON[bucket]}
                                </span>
                                {count > 0 && (
                                    <span className="font-mono text-microcopy tabular-nums">
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="flex flex-wrap items-center gap-fib-13">
                    <div className="relative">
                        <label htmlFor={`${uid}-search`} className="sr-only">
                            {t('supply.common.search_placeholder')}
                        </label>
                        <input
                            id={`${uid}-search`}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            aria-label={t('supply.common.search_placeholder')}
                            placeholder={t('supply.common.search_placeholder')}
                            className="w-56 min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <span className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.lists.only_atypical')}
                        </span>
                        <M3Switch
                            checked={onlyAtypical}
                            onChange={setOnlyAtypical}
                            aria-label={t('supply.lists.only_atypical')}
                        />
                    </div>
                </div>
            </div>

            {/* Mobile/Field Route Completion Progress */}
            {routeProgress.total > 0 && (
                <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                    <div className="flex items-center justify-between font-mono text-microcopy tabular-nums">
                        <span className="uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.lists.route_progress')}
                        </span>
                        <span
                            className={cn(
                                'font-bold',
                                routeProgress.pct === 100
                                    ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            )}
                        >
                            {routeProgress.checked} / {routeProgress.total} ({routeProgress.pct}%)
                        </span>
                    </div>
                    <M3LinearProgress
                        value={routeProgress.pct}
                        ariaLabel={t('supply.lists.route_progress')}
                    />
                </div>
            )}

            {/* Bucket Groups — Flat Hairline Layout (Zero bordered/filled mobile cards) */}
            {filteredGroups.length === 0 ? (
                <div className="px-fib-21 py-fib-55 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                    {t('supply.common.no_records')}
                </div>
            ) : (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredGroups.map((group) => {
                        const bucketChecked = group.items.filter(
                            (it) => checkedRouteKeys[`${group.procurementBucket}::${it.canonicalSkuId}`]
                        ).length;
                        const bucketPct =
                            group.items.length > 0
                                ? Math.round((bucketChecked / group.items.length) * 100)
                                : 0;

                        return (
                            <div key={group.procurementBucket} className="w-full">
                                {/* Bucket Header Row */}
                                <div className="px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13">
                                    <div className="flex items-center gap-fib-13 min-w-0">
                                        <span
                                            className={cn(
                                                'material-symbols-outlined text-[20px]',
                                                group.atypicalCount > 0
                                                    ? 'text-[#C68346]'
                                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                            )}
                                        >
                                            {BUCKET_ICON[group.procurementBucket]}
                                        </span>
                                        <h3 className="font-mono text-data-dense font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {t(`supply.buckets.${group.procurementBucket}`)}
                                        </h3>
                                        <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            {group.totalLines} SKU
                                        </span>
                                        {group.atypicalCount > 0 && (
                                            <span className="font-mono text-microcopy tabular-nums text-[#7C3F0E] dark:text-[#C68346] font-bold">
                                                {group.atypicalCount} {t('supply.telemetry.atypical_flags')}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-fib-13 shrink-0">
                                        {group.estimatedClp > 0 && (
                                            <span className="hidden sm:inline-block font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(group.estimatedClp)}
                                            </span>
                                        )}
                                        <div className="hidden md:block w-24">
                                            <M3LinearProgress
                                                value={bucketPct}
                                                ariaLabel={t(`supply.buckets.${group.procurementBucket}`)}
                                            />
                                        </div>
                                        {canScanReceipt && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onOpenScannerForBucket(group.procurementBucket)
                                                }
                                                aria-label={t('supply.lists.scan_bucket')}
                                                title={t('supply.lists.scan_bucket')}
                                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                            >
                                                <span className="material-symbols-outlined text-[22px]">
                                                    add_a_photo
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Consolidated SKU Rows */}
                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {group.items.map((item) => {
                                        const rowKey = `${group.procurementBucket}::${item.canonicalSkuId}`;
                                        const isExpanded = Boolean(expandedKeys[rowKey]);
                                        const isChecked = Boolean(checkedRouteKeys[rowKey]);
                                        const hasAtypical =
                                            item.atypicalCount > 0 || (item.atypicalFlags?.length || 0) > 0;
                                        const isCritical = item.priority === 'CRITICAL';

                                        const leftBarClass = isChecked
                                            ? 'border-[#00AEEF]'
                                            : hasAtypical || isCritical
                                              ? 'border-[#C68346]'
                                              : 'border-transparent';

                                        return (
                                            <div
                                                key={rowKey}
                                                className={cn(
                                                    'border-l-[3px] transition-colors',
                                                    leftBarClass
                                                )}
                                            >
                                                <div className="px-fib-21 py-fib-13 flex flex-wrap items-center justify-between gap-fib-13">
                                                    <div className="flex items-center gap-fib-13 min-w-0 flex-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleRouteCheck(rowKey)}
                                                            aria-label={item.name}
                                                            title={item.name}
                                                            className={cn(
                                                                'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center cursor-pointer rounded-none shadow-none',
                                                                isChecked
                                                                    ? 'text-[#00AEEF]'
                                                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                                            )}
                                                        >
                                                            <span className="material-symbols-outlined text-[22px]">
                                                                {isChecked ? 'done_all' : 'checklist'}
                                                            </span>
                                                        </button>

                                                        <div className="min-w-0 flex-1 space-y-fib-8">
                                                            <div className="flex flex-wrap items-center gap-fib-8">
                                                                <span
                                                                    className={cn(
                                                                        'text-body-main font-semibold',
                                                                        isChecked
                                                                            ? 'line-through text-[#475569] dark:text-[#8A93A6]'
                                                                            : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                                    )}
                                                                >
                                                                    {item.name}
                                                                </span>
                                                                <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6] select-text">
                                                                    {item.canonicalSkuId}
                                                                </span>
                                                                <CopyButton
                                                                    value={item.canonicalSkuId}
                                                                    title={t('supply.common.copy_code')}
                                                                />
                                                                {hasAtypical && (
                                                                    <span className="font-mono text-microcopy uppercase font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                                                        {item.atypicalFlags?.[0]
                                                                            ? t(
                                                                                  `supply.atypicals.${item.atypicalFlags[0]}`
                                                                              )
                                                                            : t(
                                                                                  'supply.telemetry.atypical_flags'
                                                                              )}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-fib-13 font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                                <span>
                                                                    {item.sourceReqRefs.length}{' '}
                                                                    {t('supply.lists.col_sources')}
                                                                </span>
                                                                <span>·</span>
                                                                <span
                                                                    className={
                                                                        isCritical
                                                                            ? 'text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                                                            : ''
                                                                    }
                                                                >
                                                                    {item.priority}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-fib-21 shrink-0">
                                                        <div className="text-right font-mono tabular-nums">
                                                            <div className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {item.totalQtyPending} {item.unitSi}
                                                            </div>
                                                            {typeof item.estimatedClp === 'number' &&
                                                                item.estimatedClp > 0 && (
                                                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                                        {formatClp(item.estimatedClp)}
                                                                    </div>
                                                                )}
                                                        </div>

                                                        <button
                                                            type="button"
                                                            onClick={() => toggleExpand(rowKey)}
                                                            aria-expanded={isExpanded}
                                                            aria-label={
                                                                isExpanded
                                                                    ? t('supply.common.collapse')
                                                                    : t('supply.common.expand')
                                                            }
                                                            title={
                                                                isExpanded
                                                                    ? t('supply.common.collapse')
                                                                    : t('supply.common.expand')
                                                            }
                                                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                                                        >
                                                            <span className="material-symbols-outlined text-[20px]">
                                                                {isExpanded ? 'expand_less' : 'expand_more'}
                                                            </span>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Expandable Inverse Traceability Table */}
                                                {isExpanded && (
                                                    <div className="px-fib-21 pb-fib-13 pl-fib-55 bg-[#F8FAFC] dark:bg-[#07090D] border-t border-[#E2E8F0] dark:border-[#12151C]">
                                                        <div className="py-fib-8 font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                            {t('supply.lists.traceability_header')} (
                                                            {item.sourceReqRefs.length})
                                                        </div>
                                                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                            {item.sourceReqRefs.map((ref) => (
                                                                <div
                                                                    key={`${ref.reqId}-${ref.lineId}`}
                                                                    className="py-fib-8 flex flex-wrap items-center justify-between gap-fib-13 font-mono text-data-dense tabular-nums"
                                                                >
                                                                    <div className="flex items-center gap-fib-8">
                                                                        <span className="select-text text-[#0F172A] dark:text-[#F3F4F6]">
                                                                            {ref.reqId}
                                                                        </span>
                                                                        <CopyButton
                                                                            value={ref.reqId}
                                                                            title={t('supply.common.copy_folio')}
                                                                        />
                                                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                            {ref.costCenter}
                                                                        </span>
                                                                        {ref.demandOrigin && (
                                                                            <span className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                                                {t(
                                                                                    `supply.origins.${ref.demandOrigin}`
                                                                                )}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-fib-13">
                                                                        {ref.atypicalFlags?.length > 0 && (
                                                                            <span className="text-microcopy text-[#7C3F0E] dark:text-[#C68346] font-bold">
                                                                                {ref.atypicalFlags
                                                                                    .map((f) =>
                                                                                        t(
                                                                                            `supply.atypicals.${f}`
                                                                                        )
                                                                                    )
                                                                                    .join(' · ')}
                                                                            </span>
                                                                        )}
                                                                        <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                            {ref.qtyPending} {item.unitSi}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

export default ConsolidatedShoppingListsView;
