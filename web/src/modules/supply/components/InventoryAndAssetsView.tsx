import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import CopyButton from '../../../components/common/CopyButton';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import { supplyApi } from '../services/supplyApi';
import {
    formatCasTelemetry,
    formatClp,
    type DemandForecastSummary,
    type SupplyAssetRecord,
    type SupplyInventoryItem,
    type SupplyPurchaseRecord,
    type SupplySite,
} from '../types';

export interface InventoryAndAssetsViewProps {
    inventory: SupplyInventoryItem[];
    assets: SupplyAssetRecord[];
    inTransitPurchases: SupplyPurchaseRecord[];
    forecast: DemandForecastSummary | null;
    activeSite?: SupplySite | null;
    tenantId?: string;
    loading: boolean;
    canMutate?: boolean;
    canManageCapex?: boolean;
    onMutated: () => void;
}

type WarehouseTab = 'STOCK' | 'ASSETS';

export const InventoryAndAssetsView: React.FC<InventoryAndAssetsViewProps> = ({
    inventory,
    assets,
    inTransitPurchases,
    forecast,
    activeSite,
    tenantId,
    loading: _loading,
    canMutate = true,
    canManageCapex = true,
    onMutated,
}) => {
    const { t } = useTranslation();
    const uid = useId();
    const [tab, setTab] = useState<WarehouseTab>('STOCK');
    const [searchQuery, setSearchQuery] = useState('');
    const [pendingReceptionPurchase, setPendingReceptionPurchase] =
        useState<SupplyPurchaseRecord | null>(null);
    const [pendingLinkAsset, setPendingLinkAsset] = useState<SupplyAssetRecord | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    const waterTelemetry = useMemo(() => {
        const pax = forecast?.headcount ?? activeSite?.currentHeadcount ?? 0;
        const leadDays = forecast?.leadTimeDays ?? activeSite?.leadTimeDays ?? 7;
        const storedL = forecast?.waterStoredL ?? activeSite?.waterStorageCapacityL ?? 0;
        const dailyPerPax = activeSite?.ds594DailyWaterTargetLPerPax ?? 120;
        const dailyTargetL = forecast?.waterDailyTargetL ?? pax * dailyPerPax;
        const requiredLeadL = forecast?.waterRequiredLeadL ?? dailyTargetL * leadDays;
        const coverageDays =
            forecast?.waterCoverageDays ??
            (dailyTargetL > 0 ? Math.round((storedL / dailyTargetL) * 10) / 10 : 0);
        const pct =
            requiredLeadL > 0 ? Math.min(100, Math.round((storedL / requiredLeadL) * 100)) : 0;
        const compliant =
            forecast?.waterCompliantDs594 ?? (requiredLeadL > 0 ? storedL >= requiredLeadL : true);
        return { pax, leadDays, storedL, dailyTargetL, requiredLeadL, coverageDays, pct, compliant };
    }, [forecast, activeSite]);

    const filteredStock = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return inventory;
        return inventory.filter((item) =>
            `${item.name} ${item.canonicalSkuId} ${item.categoryCode}`.toLowerCase().includes(q)
        );
    }, [inventory, searchQuery]);

    const filteredAssets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return assets;
        return assets.filter((a) =>
            `${a.name} ${a.serialOrTag || ''} ${a.invoiceFolio} ${a.supplierTaxId} ${a.opermaqAssetId || ''}`
                .toLowerCase()
                .includes(q)
        );
    }, [assets, searchQuery]);

    const missingInvoiceCount = useMemo(
        () =>
            assets.filter(
                (a) => a.missingInvoiceAlert || (a.invoiceDteType !== 33 && a.invoiceDteType !== 34)
            ).length,
        [assets]
    );

    const handleConfirmReception = async () => {
        if (!pendingReceptionPurchase) return;
        setActionLoading(true);
        setNotice(null);
        try {
            const receivedLines =
                (pendingReceptionPurchase.lines || []).length > 0
                    ? pendingReceptionPurchase.lines.map((line) => {
                          const purchased = Number(line.qtyPurchased ?? line.qty) || 0;
                          const received = Number(line.qtyReceived ?? 0) || 0;
                          const remaining = Math.max(0, purchased - received);
                          return {
                              purchaseLineId: line.purchaseLineId || line.lineId,
                              qtyReceivedNow: remaining > 0 ? remaining : purchased,
                          };
                      })
                    : [
                          {
                              purchaseLineId: `${pendingReceptionPurchase.purchaseId}_line_1`,
                              qtyReceivedNow: 1,
                          },
                      ];

            await supplyApi.confirmPurchaseReception(
                pendingReceptionPurchase.purchaseId,
                receivedLines,
                'ACTUALIZAR',
                tenantId
            );
            setPendingReceptionPurchase(null);
            setNotice({
                tone: 'cyan',
                text: `${pendingReceptionPurchase.purchaseId} ➔ ${t('supply.warehouse.col_warehouse')}`,
            });
            onMutated();
        } catch (err) {
            setPendingReceptionPurchase(null);
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'RECEPTION_ERROR',
            });
        } finally {
            setActionLoading(false);
        }
    };

    const handleLinkOpermaq = async () => {
        if (!pendingLinkAsset) return;
        setActionLoading(true);
        setNotice(null);
        try {
            const res = await supplyApi.linkAssetToOpermaq(
                pendingLinkAsset.assetId,
                'ACTUALIZAR',
                tenantId
            );
            setPendingLinkAsset(null);
            setNotice({
                tone: 'cyan',
                text: `${t('supply.warehouse.linked_opermaq')}: ${res.opermaqAssetId || pendingLinkAsset.assetId}`,
            });
            onMutated();
        } catch (err) {
            setPendingLinkAsset(null);
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'LINK_ERROR',
            });
        } finally {
            setActionLoading(false);
        }
    };

    const receptionDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingReceptionPurchase) return [];
        return [
            {
                field: pendingReceptionPurchase.purchaseId,
                current: t('supply.destinations.STOCK_IN_TRANSIT'),
                suggested: t('supply.destinations.STOCK_IN_WAREHOUSE'),
            },
            {
                field: t('supply.scanner.total_clp'),
                current: `DTE ${pendingReceptionPurchase.documentType} #${pendingReceptionPurchase.folio}`,
                suggested: formatClp(pendingReceptionPurchase.totalAmountClp),
            },
        ];
    }, [pendingReceptionPurchase, t]);

    const linkDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingLinkAsset) return [];
        return [
            {
                field: pendingLinkAsset.name,
                current: t('supply.common.pending_record'),
                suggested: `OPERMAQ · DTE ${pendingLinkAsset.invoiceDteType} #${pendingLinkAsset.invoiceFolio || '—'}`,
            },
        ];
    }, [pendingLinkAsset, t]);

    return (
        <section className="w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] select-none">
            {/* Sub-view Switcher & Search */}
            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex items-center gap-fib-8">
                    <button
                        type="button"
                        onClick={() => setTab('STOCK')}
                        aria-label={t('supply.warehouse.stock_tab')}
                        title={t('supply.warehouse.stock_tab')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none',
                            tab === 'STOCK'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        <span className="material-symbols-outlined text-[22px]">warehouse</span>
                        <span className="font-mono text-microcopy tabular-nums">
                            {inventory.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTab('ASSETS')}
                        aria-label={t('supply.warehouse.assets_tab')}
                        title={t('supply.warehouse.assets_tab')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none',
                            tab === 'ASSETS'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        <span className="material-symbols-outlined text-[22px]">
                            precision_manufacturing
                        </span>
                        <span className="font-mono text-microcopy tabular-nums">
                            {assets.length}
                        </span>
                        {missingInvoiceCount > 0 && (
                            <span className="font-mono text-microcopy tabular-nums font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                !{missingInvoiceCount}
                            </span>
                        )}
                    </button>
                </div>

                <div>
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
            </div>

            {notice && (
                <div
                    className={cn(
                        'mx-fib-21 mt-fib-13 border-l-[3px] pl-fib-13 py-fib-8 font-mono text-data-dense tabular-nums',
                        notice.tone === 'copper'
                            ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                            : 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
                    )}
                >
                    {notice.text}
                </div>
            )}

            {/* DS 594 Art. 14 Water Coverage Guardrail */}
            {tab === 'STOCK' && (
                <div
                    className={cn(
                        'px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] border-l-[3px] space-y-fib-8',
                        waterTelemetry.compliant ? 'border-l-[#00AEEF]' : 'border-l-[#C68346]'
                    )}
                >
                    <div className="flex flex-wrap items-center justify-between gap-fib-13 font-mono text-microcopy tabular-nums">
                        <div className="flex items-center gap-fib-8">
                            <span
                                className={cn(
                                    'material-symbols-outlined text-[18px]',
                                    waterTelemetry.compliant ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                )}
                            >
                                water_drop
                            </span>
                            <span className="font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.warehouse.ds594_title')}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-fib-21 text-[#475569] dark:text-[#8A93A6]">
                            <span>
                                {t('supply.warehouse.ds594_pax')}:{' '}
                                <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {waterTelemetry.pax}
                                </strong>
                            </span>
                            <span>
                                {t('supply.warehouse.ds594_stored')}:{' '}
                                <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {waterTelemetry.storedL.toLocaleString('es-CL')} L
                                </strong>
                            </span>
                            <span>
                                {t('supply.warehouse.ds594_required')}:{' '}
                                <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {waterTelemetry.requiredLeadL.toLocaleString('es-CL')} L (
                                    {waterTelemetry.leadDays}
                                    {t('supply.common.days_short')})
                                </strong>
                            </span>
                            <span
                                className={cn(
                                    'font-bold',
                                    waterTelemetry.compliant
                                        ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                        : 'text-[#7C3F0E] dark:text-[#C68346]'
                                )}
                            >
                                {t('supply.warehouse.ds594_days')}: {waterTelemetry.coverageDays}
                                {t('supply.common.days_short')}
                            </span>
                        </div>
                    </div>
                    <M3LinearProgress
                        value={waterTelemetry.pct}
                        ariaLabel={t('supply.warehouse.ds594_title')}
                    />
                </div>
            )}

            {/* STOCK TAB: In-Transit Receptions + Warehouse Stock Table */}
            {tab === 'STOCK' && (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {inTransitPurchases.length > 0 && (
                        <div className="px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] space-y-fib-8">
                            <div className="font-mono text-microcopy uppercase font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                {t('supply.warehouse.col_transit')} ({inTransitPurchases.length})
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {inTransitPurchases.map((p) => (
                                    <div
                                        key={p.purchaseId}
                                        className="py-fib-8 flex flex-wrap items-center justify-between gap-fib-13 font-mono text-data-dense tabular-nums"
                                    >
                                        <div className="flex flex-wrap items-center gap-fib-8">
                                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                {p.purchaseId}
                                            </span>
                                            <CopyButton
                                                value={p.purchaseId}
                                                title={t('supply.common.copy_code')}
                                            />
                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                {p.supplierName}
                                            </span>
                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                DTE {p.documentType} #{p.folio || '—'}
                                            </span>
                                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(p.totalAmountClp)}
                                            </span>
                                        </div>
                                        {canMutate && (
                                            <button
                                                type="button"
                                                onClick={() => setPendingReceptionPurchase(p)}
                                                aria-label={t('supply.warehouse.confirm_reception')}
                                                title={t('supply.warehouse.confirm_reception')}
                                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                            >
                                                <span className="material-symbols-outlined text-[22px]">
                                                    local_shipping
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Column Headers */}
                    <div className="hidden md:grid grid-cols-12 gap-fib-8 px-fib-21 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                        <div className="col-span-4">{t('supply.warehouse.col_item')}</div>
                        <div className="col-span-2 text-right">
                            {t('supply.warehouse.col_transit')}
                        </div>
                        <div className="col-span-2 text-right">
                            {t('supply.warehouse.col_warehouse')}
                        </div>
                        <div className="col-span-4">{t('supply.warehouse.col_doi')}</div>
                    </div>

                    {filteredStock.length === 0 ? (
                        <div className="px-fib-21 py-fib-55 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.common.no_records')}
                        </div>
                    ) : (
                        filteredStock.map((item) => {
                            const lowDoi =
                                item.doiDays !== null &&
                                item.doiDays < (waterTelemetry.leadDays || 7);
                            const belowSafety = item.qtyInWarehouse < item.minSafetyQty;
                            const isAlert = lowDoi || belowSafety;
                            const doiPct =
                                item.doiDays === null
                                    ? 0
                                    : Math.min(
                                          100,
                                          Math.round(
                                              (item.doiDays /
                                                  Math.max(1, (waterTelemetry.leadDays || 7) * 2)) *
                                                  100
                                          )
                                      );

                            return (
                                <div
                                    key={item.itemId}
                                    className={cn(
                                        'px-fib-21 py-fib-13 border-l-[3px] grid grid-cols-1 md:grid-cols-12 gap-fib-8 items-center',
                                        isAlert
                                            ? 'border-l-[#C68346]'
                                            : doiPct >= 100
                                              ? 'border-l-[#00AEEF]'
                                              : 'border-l-transparent'
                                    )}
                                >
                                    <div className="md:col-span-4 min-w-0 space-y-fib-8">
                                        <div className="text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {item.name}
                                        </div>
                                        <div className="flex items-center gap-fib-8 font-mono text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                            <span className="select-text">{item.canonicalSkuId}</span>
                                            <CopyButton
                                                value={item.canonicalSkuId}
                                                title={t('supply.common.copy_code')}
                                            />
                                            <span>· {t(`supply.categories.${item.categoryCode}`)}</span>
                                        </div>
                                    </div>

                                    <div
                                        className={cn(
                                            'md:col-span-2 md:text-right font-mono text-data-dense tabular-nums',
                                            item.qtyInTransit > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                        )}
                                    >
                                        {item.qtyInTransit} {item.unitSi}
                                    </div>

                                    <div className="md:col-span-2 md:text-right font-mono text-data-dense tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {item.qtyInWarehouse} {item.unitSi}
                                    </div>

                                    <div className="md:col-span-4 space-y-fib-8">
                                        <div className="flex items-center justify-between font-mono text-microcopy tabular-nums">
                                            <span
                                                className={cn(
                                                    isAlert
                                                        ? 'text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                                        : 'text-[#475569] dark:text-[#8A93A6]'
                                                )}
                                            >
                                                DOI:{' '}
                                                {item.doiDays !== null
                                                    ? `${item.doiDays.toFixed(1)}${t('supply.common.days_short')}`
                                                    : '—'}
                                            </span>
                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                MIN {item.minSafetyQty} {item.unitSi}
                                            </span>
                                        </div>
                                        <M3LinearProgress value={doiPct} ariaLabel={item.name} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* ASSETS TAB: Patrimonial Vault backed by Factura Electrónica DTE 33/34 */}
            {tab === 'ASSETS' && (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredAssets.length === 0 ? (
                        <div className="px-fib-21 py-fib-55 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.common.no_records')}
                        </div>
                    ) : (
                        filteredAssets.map((asset) => {
                            const lacksInvoice =
                                asset.missingInvoiceAlert ||
                                (asset.invoiceDteType !== 33 && asset.invoiceDteType !== 34);
                            const casLine = formatCasTelemetry(asset.evidenceCasRef);

                            return (
                                <article
                                    key={asset.assetId}
                                    className={cn(
                                        'px-fib-21 py-fib-13 border-l-[3px] space-y-fib-8',
                                        lacksInvoice
                                            ? 'border-l-[#C68346]'
                                            : asset.opermaqAssetId
                                              ? 'border-l-[#00AEEF]'
                                              : 'border-l-transparent'
                                    )}
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-fib-13">
                                        <div className="min-w-0 space-y-fib-8">
                                            <div className="flex flex-wrap items-center gap-fib-8">
                                                <span className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {asset.name}
                                                </span>
                                                <span className="font-mono text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                                                    {asset.serialOrTag ||
                                                        t('supply.common.not_declared')}
                                                </span>
                                                {asset.serialOrTag && (
                                                    <CopyButton
                                                        value={asset.serialOrTag}
                                                        title={t('supply.common.copy_code')}
                                                    />
                                                )}
                                            </div>
                                            {lacksInvoice && (
                                                <div className="flex items-center gap-fib-8 font-mono text-microcopy font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                                    <span className="material-symbols-outlined text-[16px]">
                                                        warning
                                                    </span>
                                                    <span>
                                                        {t(
                                                            'supply.atypicals.ATYPICAL_ASSET_WITHOUT_INVOICE'
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-fib-8 shrink-0">
                                            {asset.opermaqAssetId ? (
                                                <div className="flex items-center gap-fib-8 font-mono text-microcopy text-[#0369A1] dark:text-[#00AEEF] font-bold">
                                                    <span className="material-symbols-outlined text-[18px]">
                                                        verified
                                                    </span>
                                                    <span className="select-text">
                                                        {t('supply.warehouse.linked_opermaq')}:{' '}
                                                        {asset.opermaqAssetId}
                                                    </span>
                                                    <CopyButton value={asset.opermaqAssetId} />
                                                </div>
                                            ) : (
                                                canMutate &&
                                                canManageCapex && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPendingLinkAsset(asset)}
                                                        aria-label={t('supply.warehouse.link_opermaq')}
                                                        title={t('supply.warehouse.link_opermaq')}
                                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                                    >
                                                        <span className="material-symbols-outlined text-[22px]">
                                                            link
                                                        </span>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-fib-13 font-mono text-microcopy tabular-nums">
                                        <div>
                                            <div className="text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_net')}
                                            </div>
                                            <div className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(asset.acquisitionNetClp)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_vat')}
                                            </div>
                                            <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(asset.vatCreditClp)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_invoice')}
                                            </div>
                                            <div className="flex items-center gap-fib-8 text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                <span className="select-text">
                                                    DTE {asset.invoiceDteType} #{asset.invoiceFolio || '—'}
                                                </span>
                                                {asset.invoiceFolio && (
                                                    <CopyButton value={asset.invoiceFolio} />
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_warranty')}
                                            </div>
                                            <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                {asset.warrantyUntil ||
                                                    t('supply.common.not_declared')}
                                            </div>
                                        </div>
                                    </div>

                                    {casLine && (
                                        <div className="font-mono text-microcopy tabular-nums text-[#0369A1] dark:text-[#00AEEF] select-text">
                                            {casLine}
                                        </div>
                                    )}
                                </article>
                            );
                        })
                    )}
                </div>
            )}

            <HitlConfirmModal
                open={Boolean(pendingReceptionPurchase)}
                title={t('supply.warehouse.hitl_reception_title')}
                description={t('supply.warehouse.hitl_reception_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={receptionDiff}
                loading={actionLoading}
                onConfirm={() => void handleConfirmReception()}
                onCancel={() => setPendingReceptionPurchase(null)}
            />

            <HitlConfirmModal
                open={Boolean(pendingLinkAsset)}
                title={t('supply.warehouse.hitl_link_title')}
                description={t('supply.warehouse.hitl_link_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={linkDiff}
                loading={actionLoading}
                onConfirm={() => void handleLinkOpermaq()}
                onCancel={() => setPendingLinkAsset(null)}
            />
        </section>
    );
};

export default InventoryAndAssetsView;
