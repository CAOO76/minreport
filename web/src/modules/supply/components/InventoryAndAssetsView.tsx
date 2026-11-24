import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import CopyButton from '../../../components/common/CopyButton';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import type { StockLedgerEntry } from '../../../contracts/supply.contracts';
import { supplyApi, type ConfirmWarehouseReceptionV3Result } from '../services/supplyApi';
import {
    formatCasTelemetry,
    formatClp,
    type CreateSupplyWarehouseRequest,
    type DemandForecastSummary,
    type SupplyAssetRecord,
    type SupplyInventoryItem,
    type SupplyPurchaseRecord,
    type SupplySite,
    type SupplyTankTelemetry,
    type SupplyUnitSi,
    type SupplyWarehouse,
    type SupplyWarehouseBalance,
    type SupplyWarehouseClass,
} from '../types';
import { WarehouseKardexView } from './WarehouseKardexView';
import { WarehouseReceptionModal } from './WarehouseReceptionModal';

export interface InventoryAndAssetsViewProps {
    inventory: SupplyInventoryItem[];
    assets: SupplyAssetRecord[];
    inTransitPurchases: SupplyPurchaseRecord[];
    forecast: DemandForecastSummary | null;
    warehouses?: SupplyWarehouse[];
    warehouseBalances?: SupplyWarehouseBalance[];
    kardexEntries?: StockLedgerEntry[];
    tankTelemetry?: SupplyTankTelemetry[];
    sites?: SupplySite[];
    activeSite?: SupplySite | null;
    tenantId?: string;
    loading: boolean;
    canMutate?: boolean;
    canManageCapex?: boolean;
    onMutated: () => void;
}

type WarehouseTab = 'STOCK' | 'KARDEX' | 'WAREHOUSES' | 'ASSETS';

const WAREHOUSE_CLASSES: SupplyWarehouseClass[] = [
    'DRY_WAREHOUSE',
    'COLD_STORAGE',
    'POTABLE_WATER_TANK',
    'INDUSTRIAL_WATER_POND',
    'FUEL_TANK_CAMP',
    'FUEL_TANK_FLEET',
    'GLP_CAGE',
    'INDUSTRIAL_GAS_CAGE',
    'HAZMAT_DS43',
    'MAGAZINE_DGMN',
    'VIRTUAL_IN_TRANSIT',
];

export const InventoryAndAssetsView: React.FC<InventoryAndAssetsViewProps> = ({
    inventory,
    assets,
    inTransitPurchases,
    forecast,
    warehouses = [],
    warehouseBalances = [],
    kardexEntries = [],
    tankTelemetry = [],
    sites = [],
    activeSite,
    tenantId,
    loading,
    canMutate = true,
    canManageCapex = true,
    onMutated,
}) => {
    const { t } = useTranslation();
    const uid = useId();
    const [tab, setTab] = useState<WarehouseTab>('STOCK');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('ALL');
    const [pendingReceptionPurchase, setPendingReceptionPurchase] =
        useState<SupplyPurchaseRecord | null>(null);
    const [pendingLinkAsset, setPendingLinkAsset] = useState<SupplyAssetRecord | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    // Physical Warehouse Creation State
    const [showCreateWh, setShowCreateWh] = useState(false);
    const [whCode, setWhCode] = useState('');
    const [whName, setWhName] = useState('');
    const [whClass, setWhClass] = useState<SupplyWarehouseClass>('DRY_WAREHOUSE');
    const [whCapacity, setWhCapacity] = useState<number>(10000);
    const [whCapacityUnit, setWhCapacityUnit] = useState<SupplyUnitSi>('L');
    const [pendingWarehouseHitl, setPendingWarehouseHitl] =
        useState<CreateSupplyWarehouseRequest | null>(null);

    const waterTelemetry = useMemo(() => {
        const potableTanksBalance = warehouseBalances
            .filter((b) => b.warehouseClass === 'POTABLE_WATER_TANK')
            .reduce((acc, b) => acc + (b.qtyOnHand || 0), 0);
        const hasPotableTanks = warehouses.some(
            (w) => w.warehouseClass === 'POTABLE_WATER_TANK'
        );
        const pax = forecast?.headcount ?? activeSite?.currentHeadcount ?? 0;
        const leadDays = forecast?.leadTimeDays ?? activeSite?.leadTimeDays ?? 7;
        const storedL =
            forecast?.waterStoredL ??
            (hasPotableTanks ? potableTanksBalance : activeSite?.waterStorageCapacityL ?? 0);
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
    }, [forecast, activeSite, warehouseBalances, warehouses]);

    const filteredBalances = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return warehouseBalances.filter((b) => {
            if (selectedWarehouseId !== 'ALL' && b.warehouseId !== selectedWarehouseId) {
                return false;
            }
            if (!q) return true;
            return `${b.itemName} ${b.canonicalSkuId} ${b.categoryCode} ${b.warehouseId}`
                .toLowerCase()
                .includes(q);
        });
    }, [warehouseBalances, selectedWarehouseId, searchQuery]);

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

    const handleReceptionV3Committed = (result: ConfirmWarehouseReceptionV3Result) => {
        const purchaseId = pendingReceptionPurchase?.purchaseId || '';
        setPendingReceptionPurchase(null);
        const alertParts = [
            purchaseId,
            result.receptionOutcome,
            result.discrepancies.length > 0
                ? `${result.discrepancies.length} ${t('supply.warehouse.discrepancies_tag')}`
                : null,
            result.urgentRcvAlert ? t('supply.sii.rcv_alert_48h') : null,
            result.suggestCreditNote61 ? 'NC 61' : null,
        ].filter(Boolean);
        setNotice({
            tone:
                result.receptionOutcome === 'PARTIAL_OR_DISCREPANCY' || result.urgentRcvAlert
                    ? 'copper'
                    : 'cyan',
            text: alertParts.join(' · '),
        });
        onMutated();
    };

    const handlePrepareCreateWarehouse = (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate || !whCode.trim() || !whName.trim()) return;
        setPendingWarehouseHitl({
            siteId: activeSite?.siteId || sites[0]?.siteId || 'site-main',
            code: whCode.trim().toUpperCase(),
            name: whName.trim(),
            warehouseClass: whClass,
            allowedChannelIds: [],
            defaultCostCenter: 'CC-OPS-MINA',
            capacityUnitSi: whCapacityUnit,
            maxCapacitySi: Math.max(0, Number(whCapacity) || 0),
            status: 'ACTIVE',
            confirmationKeyword: 'ACTUALIZAR',
        });
    };

    const handleConfirmCreateWarehouse = async () => {
        if (!pendingWarehouseHitl) return;
        setActionLoading(true);
        setNotice(null);
        try {
            const created = await supplyApi.createSupplyWarehouse(pendingWarehouseHitl, tenantId);
            setPendingWarehouseHitl(null);
            setShowCreateWh(false);
            setWhCode('');
            setWhName('');
            setNotice({
                tone: 'cyan',
                text: `${created.code} · ${created.name}`,
            });
            onMutated();
        } catch (err) {
            setPendingWarehouseHitl(null);
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'WAREHOUSE_CREATE_ERROR',
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

    const warehouseDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingWarehouseHitl) return [];
        return [
            {
                field: pendingWarehouseHitl.code,
                current: '—',
                suggested: `${pendingWarehouseHitl.name} (${pendingWarehouseHitl.warehouseClass})`,
            },
        ];
    }, [pendingWarehouseHitl]);

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
                <div className="flex flex-wrap items-center gap-fib-21">
                    <button
                        type="button"
                        onClick={() => setTab('STOCK')}
                        aria-label={t('supply.warehouse.stock_tab')}
                        title={t('supply.warehouse.stock_tab')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none py-fib-8 px-1 min-h-[48px] inline-flex items-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none text-[15px]',
                            tab === 'STOCK'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] font-medium'
                        )}
                    >
                        <span className="material-symbols-outlined text-[20px]">warehouse</span>
                        <span>{t('supply.warehouse.stock_tab')}</span>
                        <span className="font-mono text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            ({inventory.length})
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTab('KARDEX')}
                        aria-label={t('supply.warehouse.kardex_tab')}
                        title={t('supply.warehouse.kardex_tab')}
                        data-testid="warehouse-subtab-KARDEX"
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none py-fib-8 px-1 min-h-[48px] inline-flex items-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none text-[15px]',
                            tab === 'KARDEX'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] font-medium'
                        )}
                    >
                        <span className="material-symbols-outlined text-[20px]">swap_horiz</span>
                        <span>{t('supply.warehouse.kardex_tab')}</span>
                        <span className="font-mono text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            ({kardexEntries.length})
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTab('WAREHOUSES')}
                        aria-label={t('supply.warehouse.warehouses_tab')}
                        title={t('supply.warehouse.warehouses_tab')}
                        data-testid="warehouse-subtab-WAREHOUSES"
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none py-fib-8 px-1 min-h-[48px] inline-flex items-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none text-[15px]',
                            tab === 'WAREHOUSES'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] font-medium'
                        )}
                    >
                        <span className="material-symbols-outlined text-[20px]">inventory_2</span>
                        <span>{t('supply.warehouse.warehouses_tab')}</span>
                        <span className="font-mono text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            ({warehouses.length})
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTab('ASSETS')}
                        aria-label={t('supply.warehouse.assets_tab')}
                        title={t('supply.warehouse.assets_tab')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none py-fib-8 px-1 min-h-[48px] inline-flex items-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none text-[15px]',
                            tab === 'ASSETS'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] font-medium'
                        )}
                    >
                        <span className="material-symbols-outlined text-[20px]">
                            precision_manufacturing
                        </span>
                        <span>{t('supply.warehouse.assets_tab')}</span>
                        <span className="font-mono text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            ({assets.length})
                        </span>
                        {missingInvoiceCount > 0 && (
                            <span className="font-mono text-[14px] tabular-nums font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                · {missingInvoiceCount}
                            </span>
                        )}
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-fib-13">
                    {tab === 'STOCK' && warehouses.length > 0 && (
                        <select
                            value={selectedWarehouseId}
                            onChange={(e) => setSelectedWarehouseId(e.target.value)}
                            aria-label={t('supply.warehouse.target_warehouse')}
                            data-testid="warehouse-filter-select"
                            className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                        >
                            <option value="ALL">{t('supply.warehouse.all_warehouses')}</option>
                            {warehouses.map((w) => (
                                <option key={w.warehouseId} value={w.warehouseId}>
                                    {w.code} · {w.name}
                                </option>
                            ))}
                        </select>
                    )}

                    {tab === 'WAREHOUSES' && canMutate && (
                        <button
                            type="button"
                            onClick={() => setShowCreateWh((prev) => !prev)}
                            aria-label={t('supply.warehouse.new_warehouse')}
                            title={t('supply.warehouse.new_warehouse')}
                            data-testid="new-warehouse-btn"
                            className="min-h-[48px] px-fib-13 bg-transparent border border-[#C68346] outline-none inline-flex items-center gap-fib-8 text-[15px] font-semibold text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                {showCreateWh ? 'close' : 'add'}
                            </span>
                            <span>{showCreateWh ? t('supply.common.close') : t('supply.warehouse.new_warehouse')}</span>
                        </button>
                    )}

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
                            className="w-60 min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                    </div>
                </div>
            </div>

            {notice && (
                <div
                    className={cn(
                        'mx-fib-21 mt-fib-13 border-l-[3px] pl-fib-13 py-fib-8 text-[15px] tabular-nums',
                        notice.tone === 'copper'
                            ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                            : 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
                    )}
                >
                    {notice.text}
                </div>
            )}

            {/* Water Coverage Guardrail */}
            {tab === 'STOCK' && (
                <div
                    className={cn(
                        'px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] space-y-fib-8',
                        waterTelemetry.compliant ? 'border-l-[#00AEEF]' : 'border-l-[#C68346]'
                    )}
                >
                    <div className="flex flex-wrap items-center justify-between gap-fib-13 text-[15px] tabular-nums">
                        <div className="flex items-center gap-fib-8">
                            <span
                                className={cn(
                                    'material-symbols-outlined text-[20px]',
                                    waterTelemetry.compliant ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                )}
                            >
                                water_drop
                            </span>
                            <span className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.warehouse.ds594_title')}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-fib-21 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                            <span>
                                {t('supply.warehouse.ds594_pax')}:{' '}
                                <strong className="font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                    {waterTelemetry.pax}
                                </strong>
                            </span>
                            <span>
                                {t('supply.warehouse.ds594_stored')}:{' '}
                                <strong className="font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                    {waterTelemetry.storedL.toLocaleString('es-CL')} L
                                </strong>
                            </span>
                            <span>
                                {t('supply.warehouse.ds594_required')}:{' '}
                                <strong className="font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                    {waterTelemetry.requiredLeadL.toLocaleString('es-CL')} L (
                                    {waterTelemetry.leadDays} {t('supply.common.days_short')})
                                </strong>
                            </span>
                            <span
                                className={cn(
                                    'font-mono font-bold',
                                    waterTelemetry.compliant
                                        ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                        : 'text-[#7C3F0E] dark:text-[#C68346]'
                                )}
                            >
                                {t('supply.warehouse.ds594_days')}: {waterTelemetry.coverageDays}{' '}
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
                        <div className="px-fib-21 py-fib-13 space-y-fib-8">
                            <div className="text-[15px] font-semibold text-[#7C3F0E] dark:text-[#C68346]">
                                {t('supply.warehouse.col_transit')} ({inTransitPurchases.length})
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {inTransitPurchases.map((p) => (
                                    <div
                                        key={p.purchaseId}
                                        className="py-fib-13 flex flex-wrap items-center justify-between gap-fib-13 text-[15px] tabular-nums"
                                    >
                                        <div className="flex flex-wrap items-center gap-fib-13">
                                            <span className="font-mono font-semibold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                {p.purchaseId}
                                            </span>
                                            <CopyButton
                                                value={p.purchaseId}
                                                title={t('supply.common.copy_code')}
                                            />
                                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {p.supplierName}
                                            </span>
                                            <span className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                Doc. {p.documentType} #{p.folio || '—'}
                                            </span>
                                            <span className="font-mono font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(p.totalAmountClp)}
                                            </span>
                                        </div>
                                        {canMutate && (
                                            <button
                                                type="button"
                                                onClick={() => setPendingReceptionPurchase(p)}
                                                aria-label={t('supply.warehouse.confirm_reception')}
                                                title={t('supply.warehouse.confirm_reception')}
                                                className="min-h-[48px] px-fib-13 bg-transparent border border-[#C68346] outline-none inline-flex items-center gap-fib-8 text-[15px] font-semibold text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                            >
                                                <span className="material-symbols-outlined text-[20px]">
                                                    local_shipping
                                                </span>
                                                <span>{t('supply.warehouse.confirm_reception')}</span>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {filteredBalances.length > 0 && (
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {filteredBalances.map((bal) => (
                                <div
                                    key={bal.balanceId}
                                    data-testid={`warehouse-balance-${bal.balanceId}`}
                                    className="px-fib-21 py-fib-13 border-l-[3px] border-l-[#00AEEF] flex flex-wrap items-center justify-between gap-fib-13 tabular-nums"
                                >
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-fib-8">
                                            <span className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {bal.itemName}
                                            </span>
                                            <span className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6] select-text">
                                                {bal.canonicalSkuId}
                                            </span>
                                            <CopyButton
                                                value={bal.canonicalSkuId}
                                                title={t('supply.common.copy_code')}
                                            />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-fib-13 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                            <span>
                                                {bal.warehouseId} ·{' '}
                                                {t(`supply.warehouse.class_${bal.warehouseClass}`)}
                                            </span>
                                            <span className="font-mono">
                                                {t('supply.warehouse.unit_cost_label')}: {formatClp(bal.pmpNetClp)}
                                            </span>
                                            {bal.lotNumber && (
                                                <span className="font-mono select-text">
                                                    {t('supply.warehouse.fefo_lot')}: {bal.lotNumber}
                                                    {bal.expiryDateIso
                                                        ? ` (${bal.expiryDateIso.slice(0, 10)})`
                                                        : ''}
                                                </span>
                                            )}
                                            {(bal.fullCount !== null && bal.fullCount !== undefined) && (
                                                <span className="font-mono">
                                                    {bal.fullCount}/{bal.emptyCount ?? 0} un
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-mono text-[16px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                            {bal.qtyOnHand} {bal.unitSi}
                                        </div>
                                        <div className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                            {formatClp(bal.totalValueNetClp)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Column Headers */}
                    <div className="hidden md:grid grid-cols-12 gap-fib-8 px-fib-21 py-fib-13 text-[14px] font-semibold text-[#475569] dark:text-[#8A93A6]">
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
                        <div className="px-fib-21 py-fib-55 text-center text-[15px] text-[#475569] dark:text-[#8A93A6]">
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
                                    <div className="md:col-span-4 min-w-0 space-y-1">
                                        <div className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {item.name}
                                        </div>
                                        <div className="flex items-center gap-fib-8 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                            <span className="font-mono select-text">
                                                {item.canonicalSkuId}
                                            </span>
                                            <CopyButton
                                                value={item.canonicalSkuId}
                                                title={t('supply.common.copy_code')}
                                            />
                                            <span>· {t(`supply.categories.${item.categoryCode}`)}</span>
                                        </div>
                                    </div>

                                    <div
                                        className={cn(
                                            'md:col-span-2 md:text-right font-mono text-[15px] tabular-nums',
                                            item.qtyInTransit > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                        )}
                                    >
                                        {item.qtyInTransit} {item.unitSi}
                                    </div>

                                    <div className="md:col-span-2 md:text-right font-mono text-[16px] tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {item.qtyInWarehouse} {item.unitSi}
                                    </div>

                                    <div className="md:col-span-4 space-y-fib-8">
                                        <div className="flex items-center justify-between text-[14px] tabular-nums">
                                            <span
                                                className={cn(
                                                    'font-mono',
                                                    isAlert
                                                        ? 'text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                                        : 'text-[#475569] dark:text-[#8A93A6]'
                                                )}
                                            >
                                                {t('supply.warehouse.coverage_label')}:{' '}
                                                {item.doiDays !== null
                                                    ? `${item.doiDays.toFixed(1)} ${t('supply.common.days_short')}`
                                                    : '—'}
                                            </span>
                                            <span className="font-mono text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.min_safety_label')} {item.minSafetyQty} {item.unitSi}
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

            {/* KARDEX TAB */}
            {tab === 'KARDEX' && (
                <WarehouseKardexView
                    entries={kardexEntries}
                    tankTelemetry={tankTelemetry}
                    warehouses={warehouses}
                    sites={sites}
                    activeSiteId={activeSite?.siteId}
                    tenantId={tenantId}
                    loading={loading}
                    canMutate={canMutate}
                    onMutated={onMutated}
                />
            )}

            {/* PHYSICAL WAREHOUSES & TANKS TAB */}
            {tab === 'WAREHOUSES' && (
                <div>
                    {canMutate && showCreateWh && (
                        <form
                            onSubmit={handlePrepareCreateWarehouse}
                            autoComplete="off"
                            spellCheck={false}
                            className="px-fib-21 py-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-1 md:grid-cols-6 gap-fib-13 items-end"
                        >
                            <input
                                type="text"
                                required
                                value={whCode}
                                onChange={(e) => setWhCode(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.warehouse.wh_code')}
                                className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                            <input
                                type="text"
                                required
                                value={whName}
                                onChange={(e) => setWhName(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.warehouse.wh_name')}
                                className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                            <select
                                value={whClass}
                                onChange={(e) => setWhClass(e.target.value as SupplyWarehouseClass)}
                                aria-label={t('supply.warehouse.wh_class')}
                                className="min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                            >
                                {WAREHOUSE_CLASSES.map((wc) => (
                                    <option key={wc} value={wc}>
                                        {t(`supply.warehouse.class_${wc}`)}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min={0}
                                value={whCapacity}
                                onChange={(e) => setWhCapacity(Number(e.target.value) || 0)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.warehouse.wh_capacity')}
                                className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                            <select
                                value={whCapacityUnit}
                                onChange={(e) => setWhCapacityUnit(e.target.value as SupplyUnitSi)}
                                aria-label={t('supply.warehouse.wh_unit')}
                                className="min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                            >
                                {(['L', 'm3', 'kg', 'un', 'caja'] as SupplyUnitSi[]).map((u) => (
                                    <option key={u} value={u}>
                                        {u}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="submit"
                                className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] text-[15px] font-bold rounded-none shadow-none cursor-pointer"
                            >
                                {t('supply.common.save')}
                            </button>
                        </form>
                    )}

                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {warehouses.length === 0 ? (
                            <div className="px-fib-21 py-fib-55 text-center text-[15px] text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.common.no_records')}
                            </div>
                        ) : (
                            warehouses.map((wh) => (
                                <div
                                    key={wh.warehouseId}
                                    data-testid={`physical-wh-${wh.warehouseId}`}
                                    className="px-fib-21 py-fib-13 border-l-[3px] border-l-[#00AEEF] flex flex-wrap items-center justify-between gap-fib-13 tabular-nums"
                                >
                                    <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-fib-8">
                                            <span className="font-mono text-[16px] font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                {wh.code}
                                            </span>
                                            <CopyButton
                                                value={wh.code}
                                                title={t('supply.common.copy_code')}
                                            />
                                            <span className="text-[16px] text-[#0F172A] dark:text-[#F3F4F6]">
                                                {wh.name}
                                            </span>
                                        </div>
                                        <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                            {t(`supply.warehouse.class_${wh.warehouseClass}`)} ·{' '}
                                            {wh.defaultCostCenter}
                                            {wh.secTc4Code ? ` · Permiso SEC ${wh.secTc4Code}` : ''}
                                            {wh.dgmnResolutionCode
                                                ? ` · Permiso DGMN ${wh.dgmnResolutionCode}`
                                                : ''}
                                        </div>
                                    </div>
                                    <div className="text-right font-mono text-[16px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {wh.maxCapacitySi.toLocaleString('es-CL')} {wh.capacityUnitSi}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ASSETS TAB: Patrimonial Vault backed by Factura Electrónica DTE 33/34 */}
            {tab === 'ASSETS' && (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredAssets.length === 0 ? (
                        <div className="px-fib-21 py-fib-55 text-center text-[15px] text-[#475569] dark:text-[#8A93A6]">
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
                                        'px-fib-21 py-fib-21 border-l-[3px] space-y-fib-13',
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
                                                <span className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {asset.name}
                                                </span>
                                                <span className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6] select-text">
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
                                                <div className="flex items-center gap-fib-8 text-[14px] font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                                    <span className="material-symbols-outlined text-[18px]">
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
                                                <div className="flex items-center gap-fib-8 font-mono text-[14px] text-[#0369A1] dark:text-[#00AEEF] font-bold">
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
                                                        className="min-h-[48px] px-fib-13 bg-transparent border border-[#00AEEF] outline-none inline-flex items-center gap-fib-8 text-[14px] font-semibold text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                                    >
                                                        <span className="material-symbols-outlined text-[20px]">
                                                            link
                                                        </span>
                                                        <span>{t('supply.warehouse.link_opermaq')}</span>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-fib-13 tabular-nums">
                                        <div>
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_net')}
                                            </div>
                                            <div className="font-mono text-[15px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(asset.acquisitionNetClp)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_vat')}
                                            </div>
                                            <div className="font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(asset.vatCreditClp)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_invoice')}
                                            </div>
                                            <div className="flex items-center gap-fib-8 font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                                <span className="select-text">
                                                    Factura {asset.invoiceDteType} #{asset.invoiceFolio || '—'}
                                                </span>
                                                {asset.invoiceFolio && (
                                                    <CopyButton value={asset.invoiceFolio} />
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.warehouse.asset_warranty')}
                                            </div>
                                            <div className="font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                                {asset.warrantyUntil ||
                                                    t('supply.common.not_declared')}
                                            </div>
                                        </div>
                                    </div>

                                    {casLine && (
                                        <details className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                            <summary className="cursor-pointer font-medium text-[#0369A1] dark:text-[#00AEEF]">
                                                {t('supply.warehouse.evidence_integrity')}
                                            </summary>
                                            <div className="pt-fib-8 font-mono text-[14px] tabular-nums select-text">
                                                {casLine}
                                            </div>
                                        </details>
                                    )}
                                </article>
                            );
                        })
                    )}
                </div>
            )}

            <WarehouseReceptionModal
                open={Boolean(pendingReceptionPurchase)}
                purchase={pendingReceptionPurchase}
                warehouses={warehouses}
                tenantId={tenantId}
                onClose={() => setPendingReceptionPurchase(null)}
                onCommitted={handleReceptionV3Committed}
            />

            <HitlConfirmModal
                open={Boolean(pendingWarehouseHitl)}
                title={t('supply.warehouse.hitl_warehouse_title')}
                description={t('supply.warehouse.hitl_warehouse_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={warehouseDiff}
                loading={actionLoading}
                onConfirm={() => void handleConfirmCreateWarehouse()}
                onCancel={() => setPendingWarehouseHitl(null)}
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
