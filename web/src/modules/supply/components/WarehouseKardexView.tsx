import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CopyButton from '../../../components/common/CopyButton';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import { cn } from '../../../utils/cn';
import type { StockLedgerEntry } from '../../../contracts/supply.contracts';
import { supplyApi } from '../services/supplyApi';
import {
    CANONICAL_STOCK_LEDGER_MOVEMENT_TYPES,
    formatClp,
    type RecordStockMovementRequest,
    type StockLedgerMovementType,
    type SupplySite,
    type SupplyTankTelemetry,
    type SupplyWarehouse,
    type TankCycleCountRequest,
} from '../types';

export interface WarehouseKardexViewProps {
    entries: StockLedgerEntry[];
    tankTelemetry: SupplyTankTelemetry[];
    warehouses: SupplyWarehouse[];
    sites: SupplySite[];
    activeSiteId?: string;
    tenantId?: string;
    loading: boolean;
    canMutate?: boolean;
    onMutated: () => void;
}

type KardexActionMode = 'NONE' | 'MOVEMENT' | 'CYCLE_COUNT';

export const WarehouseKardexView: React.FC<WarehouseKardexViewProps> = ({
    entries,
    tankTelemetry,
    warehouses,
    sites,
    activeSiteId,
    tenantId,
    loading,
    canMutate = true,
    onMutated,
}) => {
    const { t } = useTranslation();
    const [movementFilter, setMovementFilter] = useState<StockLedgerMovementType | 'ALL'>('ALL');
    const [warehouseFilter, setWarehouseFilter] = useState<string>('ALL');
    const [skuSearch, setSkuSearch] = useState('');

    const [actionMode, setActionMode] = useState<KardexActionMode>('NONE');
    const [siteId, setSiteId] = useState(activeSiteId || sites[0]?.siteId || 'site-main');
    const [warehouseId, setWarehouseId] = useState(warehouses[0]?.warehouseId || '');
    const [toWarehouseId, setToWarehouseId] = useState('');
    const [movementType, setMovementType] = useState<StockLedgerMovementType>('ISSUE_CONSUMPTION');
    const [canonicalSkuId, setCanonicalSkuId] = useState('SKU-');
    const [qtySi, setQtySi] = useState<number>(1);
    const [measuredLevelSi, setMeasuredLevelSi] = useState<number>(0);
    const [costCenter, setCostCenter] = useState('CC-OPS-MINA');
    const [linkedAssetId, setLinkedAssetId] = useState('');
    const [horometer, setHorometer] = useState('');
    const [notes, setNotes] = useState('');

    const [pendingPayload, setPendingPayload] = useState<
        RecordStockMovementRequest | TankCycleCountRequest | null
    >(null);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    const filteredEntries = useMemo(() => {
        const q = skuSearch.trim().toLowerCase();
        return entries.filter((e) => {
            if (movementFilter !== 'ALL' && e.movementType !== movementFilter) return false;
            if (warehouseFilter !== 'ALL' && (e.warehouseId || '') !== warehouseFilter) return false;
            if (!q) return true;
            return `${e.canonicalSkuId} ${e.itemName} ${e.linkedAssetId || ''} ${e.transferGroupId || ''}`
                .toLowerCase()
                .includes(q);
        });
    }, [entries, movementFilter, skuSearch, warehouseFilter]);

    const handlePrepareAction = (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate) return;
        const targetWh = warehouseId || warehouses[0]?.warehouseId || '';
        const targetSite = siteId || activeSiteId || sites[0]?.siteId || 'site-main';
        if (!targetWh || !canonicalSkuId.trim()) return;

        if (actionMode === 'CYCLE_COUNT') {
            setPendingPayload({
                siteId: targetSite,
                warehouseId: targetWh,
                canonicalSkuId: canonicalSkuId.trim(),
                measuredLevelSi: Math.max(0, Number(measuredLevelSi) || 0),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                confirmationKeyword: 'ACTUALIZAR',
            });
            return;
        }

        setPendingPayload({
            siteId: targetSite,
            warehouseId: targetWh,
            ...(movementType === 'TRANSFER_OUT' && toWarehouseId ? { toWarehouseId } : {}),
            canonicalSkuId: canonicalSkuId.trim(),
            movementType,
            qtySi: Math.max(0.01, Number(qtySi) || 1),
            ...(costCenter.trim() ? { costCenter: costCenter.trim() } : {}),
            ...(linkedAssetId.trim() ? { linkedAssetId: linkedAssetId.trim() } : {}),
            ...(horometer.trim() && Number.isFinite(Number(horometer))
                ? { horometer: Number(horometer) }
                : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            confirmationKeyword: 'ACTUALIZAR',
        });
    };

    const handleConfirmHitl = async () => {
        if (!pendingPayload) return;
        setSaving(true);
        setNotice(null);
        try {
            await supplyApi.recordSupplyKardexMovement(pendingPayload, tenantId);
            setPendingPayload(null);
            setActionMode('NONE');
            setNotice({
                tone: 'cyan',
                text: `${pendingPayload.canonicalSkuId} · ${t('supply.warehouse.kardex_recorded')}`,
            });
            onMutated();
        } catch (err) {
            setPendingPayload(null);
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'KARDEX_ERROR',
            });
        } finally {
            setSaving(false);
        }
    };

    const hitlDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingPayload) return [];
        if ('measuredLevelSi' in pendingPayload) {
            return [
                {
                    field: `${pendingPayload.warehouseId} · ${pendingPayload.canonicalSkuId}`,
                    current: 'CYCLE_COUNT_ADJUSTMENT',
                    suggested: `${pendingPayload.measuredLevelSi} SI`,
                },
            ];
        }
        return [
            {
                field: `${pendingPayload.warehouseId} · ${pendingPayload.canonicalSkuId}`,
                current: pendingPayload.movementType,
                suggested: `${pendingPayload.qtySi} SI${pendingPayload.toWarehouseId ? ` ➔ ${pendingPayload.toWarehouseId}` : ''}`,
            },
        ];
    }, [pendingPayload]);

    const inputClass =
        'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';

    return (
        <div data-testid="warehouse-kardex-view" className="w-full flex flex-col space-y-fib-13">
            {/* Controls Strip */}
            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-8">
                <div className="flex flex-wrap items-center gap-fib-8">
                    <select
                        value={movementFilter}
                        onChange={(e) =>
                            setMovementFilter(e.target.value as StockLedgerMovementType | 'ALL')
                        }
                        aria-label={t('supply.warehouse.kardex_filter_type')}
                        data-testid="kardex-type-filter"
                        className="min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                    >
                        <option value="ALL">{t('supply.warehouse.kardex_all_types')}</option>
                        {CANONICAL_STOCK_LEDGER_MOVEMENT_TYPES.map((mt) => (
                            <option key={mt} value={mt}>
                                {t(`supply.warehouse.mv_${mt}`)} ({mt})
                            </option>
                        ))}
                    </select>

                    <select
                        value={warehouseFilter}
                        onChange={(e) => setWarehouseFilter(e.target.value)}
                        aria-label={t('supply.warehouse.target_warehouse')}
                        className="min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                    >
                        <option value="ALL">{t('supply.warehouse.all_warehouses')}</option>
                        {warehouses.map((w) => (
                            <option key={w.warehouseId} value={w.warehouseId}>
                                {w.code} · {w.name}
                            </option>
                        ))}
                    </select>

                    <input
                        type="text"
                        value={skuSearch}
                        onChange={(e) => setSkuSearch(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={t('supply.common.search_placeholder')}
                        placeholder={t('supply.common.search_placeholder')}
                        className="w-48 min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                    />
                </div>

                {canMutate && (
                    <div className="flex flex-wrap items-center gap-fib-8">
                        <button
                            type="button"
                            onClick={() =>
                                setActionMode((prev) =>
                                    prev === 'MOVEMENT' ? 'NONE' : 'MOVEMENT'
                                )
                            }
                            data-testid="kardex-new-movement-btn"
                            className="min-h-[48px] px-fib-13 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-90"
                        >
                            {t('supply.warehouse.kardex_new_movement')}
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                setActionMode((prev) =>
                                    prev === 'CYCLE_COUNT' ? 'NONE' : 'CYCLE_COUNT'
                                )
                            }
                            data-testid="kardex-cycle-count-btn"
                            className="min-h-[48px] px-fib-13 bg-transparent border border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-80"
                        >
                            {t('supply.warehouse.kardex_cycle_count')}
                        </button>
                    </div>
                )}
            </div>

            {loading && <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />}

            {notice && (
                <div
                    className={cn(
                        'mx-fib-21 border-l-[3px] pl-fib-13 py-fib-8 font-mono text-data-dense tabular-nums',
                        notice.tone === 'copper'
                            ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                            : 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
                    )}
                >
                    {notice.text}
                </div>
            )}

            {/* Movement / Cycle Count Form */}
            {canMutate && actionMode !== 'NONE' && (
                <form
                    onSubmit={handlePrepareAction}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="kardex-action-form"
                    className="mx-fib-21 p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] space-y-fib-13"
                >
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-fib-13">
                        <select
                            value={siteId}
                            onChange={(e) => setSiteId(e.target.value)}
                            aria-label={t('supply.common.site_selector')}
                            className={inputClass}
                        >
                            {sites.length > 0 ? (
                                sites.map((s) => (
                                    <option key={s.siteId} value={s.siteId}>
                                        {s.name}
                                    </option>
                                ))
                            ) : (
                                <option value="site-main">FAENA-01</option>
                            )}
                        </select>

                        <select
                            value={warehouseId}
                            onChange={(e) => setWarehouseId(e.target.value)}
                            aria-label={t('supply.warehouse.target_warehouse')}
                            className={inputClass}
                        >
                            <option value="">{t('supply.warehouse.target_warehouse')}</option>
                            {warehouses.map((w) => (
                                <option key={w.warehouseId} value={w.warehouseId}>
                                    {w.code} · {w.name}
                                </option>
                            ))}
                        </select>

                        <input
                            type="text"
                            required
                            value={canonicalSkuId}
                            onChange={(e) => setCanonicalSkuId(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="SKU-..."
                            aria-label={t('supply.warehouse.col_item')}
                            className={`${inputClass} select-text`}
                        />

                        {actionMode === 'CYCLE_COUNT' ? (
                            <input
                                type="number"
                                step="any"
                                min={0}
                                required
                                value={measuredLevelSi}
                                onChange={(e) => setMeasuredLevelSi(Number(e.target.value) || 0)}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label={t('supply.warehouse.measured_level')}
                                placeholder={t('supply.warehouse.measured_level')}
                                className={`${inputClass} select-text`}
                            />
                        ) : (
                            <select
                                value={movementType}
                                onChange={(e) =>
                                    setMovementType(e.target.value as StockLedgerMovementType)
                                }
                                aria-label={t('supply.warehouse.kardex_filter_type')}
                                className={inputClass}
                            >
                                {CANONICAL_STOCK_LEDGER_MOVEMENT_TYPES.map((mt) => (
                                    <option key={mt} value={mt}>
                                        {t(`supply.warehouse.mv_${mt}`)} ({mt})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {actionMode === 'MOVEMENT' && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-fib-13">
                            <input
                                type="number"
                                step="any"
                                min={0.01}
                                required
                                value={qtySi}
                                onChange={(e) => setQtySi(Number(e.target.value) || 0)}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label={t('supply.backlog.qty')}
                                placeholder={t('supply.backlog.qty')}
                                className={`${inputClass} select-text`}
                            />

                            {movementType === 'TRANSFER_OUT' ? (
                                <select
                                    required
                                    value={toWarehouseId}
                                    onChange={(e) => setToWarehouseId(e.target.value)}
                                    aria-label={t('supply.warehouse.dest_warehouse')}
                                    className={inputClass}
                                >
                                    <option value="">
                                        {t('supply.warehouse.dest_warehouse')}
                                    </option>
                                    {warehouses
                                        .filter((w) => w.warehouseId !== warehouseId)
                                        .map((w) => (
                                            <option key={w.warehouseId} value={w.warehouseId}>
                                                {w.code} · {w.name}
                                            </option>
                                        ))}
                                </select>
                            ) : (
                                <input
                                    type="text"
                                    value={costCenter}
                                    onChange={(e) => setCostCenter(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={t('supply.backlog.cost_center')}
                                    className={`${inputClass} select-text`}
                                />
                            )}

                            <input
                                type="text"
                                value={linkedAssetId}
                                onChange={(e) => setLinkedAssetId(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.warehouse.linked_asset_id')}
                                className={`${inputClass} select-text`}
                            />

                            <input
                                type="number"
                                step="any"
                                min={0}
                                value={horometer}
                                onChange={(e) => setHorometer(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.warehouse.horometer_hr')}
                                className={`${inputClass} select-text`}
                            />
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-fib-13">
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={t('supply.warehouse.reception_notes')}
                            className={`${inputClass} flex-1 min-w-[200px] select-text`}
                        />
                        <button
                            type="submit"
                            disabled={saving}
                            data-testid="kardex-submit-btn"
                            className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                        >
                            {t('supply.common.save')}
                        </button>
                    </div>
                </form>
            )}

            {/* Tank Cycle-Count Telemetry */}
            {tankTelemetry.length > 0 && (
                <div className="px-fib-21 space-y-fib-8">
                    <div className="font-mono text-microcopy uppercase font-bold text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.warehouse.tank_telemetry_title')}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-8 font-mono text-microcopy tabular-nums">
                        {tankTelemetry.slice(0, 6).map((tk) => (
                            <div
                                key={tk.telemetryId}
                                className={cn(
                                    'p-fib-8 border border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] flex items-center justify-between gap-fib-8',
                                    tk.anomalyFlag
                                        ? 'border-l-[#C68346]'
                                        : 'border-l-[#00AEEF]'
                                )}
                            >
                                <span>
                                    {tk.warehouseId} · {tk.canonicalSkuId}
                                </span>
                                <span
                                    className={cn(
                                        'font-bold',
                                        tk.anomalyFlag
                                            ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                            : 'text-[#0369A1] dark:text-[#00AEEF]'
                                    )}
                                >
                                    {tk.measuredLevelSi} / {tk.bookBalanceSi} (Δ{' '}
                                    {tk.variancePct.toFixed(1)}%)
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Immutable Kardex Rows */}
            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                {filteredEntries.length === 0 ? (
                    <div className="px-fib-21 py-fib-34 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.common.no_records')}
                    </div>
                ) : (
                    filteredEntries.map((entry) => {
                        const isAlert =
                            entry.movementType === 'SHRINKAGE_WASTE' ||
                            entry.movementType === 'CYCLE_COUNT_ADJUSTMENT';
                        return (
                            <div
                                key={entry.ledgerId}
                                data-testid={`kardex-row-${entry.ledgerId}`}
                                className={cn(
                                    'px-fib-21 py-fib-13 border-l-[3px] flex flex-wrap items-center justify-between gap-fib-13 font-mono tabular-nums',
                                    isAlert
                                        ? 'border-l-[#C68346]'
                                        : entry.movementType === 'RECEIPT_AT_WAREHOUSE' ||
                                            entry.movementType === 'TRANSFER_IN'
                                          ? 'border-l-[#00AEEF]'
                                          : 'border-l-transparent'
                                )}
                            >
                                <div className="space-y-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-fib-8">
                                        <span className="text-microcopy font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                            {t(`supply.warehouse.mv_${entry.movementType}`)}
                                        </span>
                                        <span className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                            {entry.canonicalSkuId}
                                        </span>
                                        <CopyButton
                                            value={entry.canonicalSkuId}
                                            title={t('supply.common.copy_code')}
                                        />
                                        <span className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                            {entry.itemName}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-fib-13 text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        <span>{entry.warehouseId || entry.siteId}</span>
                                        {entry.costCenter && <span>{entry.costCenter}</span>}
                                        {entry.linkedAssetId && (
                                            <span className="text-[#0369A1] dark:text-[#00AEEF]">
                                                OPERMAQ: {entry.linkedAssetId}
                                                {entry.horometer !== null &&
                                                entry.horometer !== undefined
                                                    ? ` (${entry.horometer} hr)`
                                                    : ''}
                                            </span>
                                        )}
                                        {entry.transferGroupId && (
                                            <span className="select-text">
                                                TX: {entry.transferGroupId}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="text-right space-y-1 shrink-0">
                                    <div className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        Δ {entry.deltaInWarehouse >= 0 ? '+' : ''}
                                        {entry.deltaInWarehouse} {entry.unitSi} ·{' '}
                                        {entry.balanceInWarehouseAfter} {entry.unitSi}
                                    </div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        PMP {formatClp(entry.unitCostNetClp)}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <HitlConfirmModal
                open={Boolean(pendingPayload)}
                title={t('supply.warehouse.hitl_kardex_title')}
                description={t('supply.warehouse.hitl_kardex_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={hitlDiff}
                loading={saving}
                onConfirm={() => void handleConfirmHitl()}
                onCancel={() => setPendingPayload(null)}
            />
        </div>
    );
};

export default WarehouseKardexView;
