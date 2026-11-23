import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import { cn } from '../../../utils/cn';
import { supplyApi, type ConfirmWarehouseReceptionV3Result } from '../services/supplyApi';
import type {
    ConfirmWarehouseReceptionV3Line,
    SupplyPurchaseRecord,
    SupplyWarehouse,
} from '../types';

export interface WarehouseReceptionModalProps {
    open: boolean;
    purchase: SupplyPurchaseRecord | null;
    warehouses: SupplyWarehouse[];
    tenantId?: string;
    onClose: () => void;
    onCommitted: (result: ConfirmWarehouseReceptionV3Result) => void;
}

interface LineReceptionDraft {
    purchaseLineId: string;
    name: string;
    unitSi: string;
    purchasedQty: number;
    alreadyReceivedQty: number;
    qtyReceivedNow: number;
    shrinkageQty: number;
    shrinkageReason: string;
    lotNumber: string;
    expiryDateIso: string;
}

export const WarehouseReceptionModal: React.FC<WarehouseReceptionModalProps> = ({
    open,
    purchase,
    warehouses,
    tenantId,
    onClose,
    onCommitted,
}) => {
    const { t } = useTranslation();
    const uid = useId();

    const [warehouseId, setWarehouseId] = useState('');
    const [lineDrafts, setLineDrafts] = useState<LineReceptionDraft[]>([]);
    const [notes, setNotes] = useState('');
    const [keyword, setKeyword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !purchase) return;
        setWarehouseId(warehouses[0]?.warehouseId || '');
        setNotes('');
        setKeyword('');
        setErrorMsg(null);
        const lines = purchase.lines || [];
        if (lines.length > 0) {
            setLineDrafts(
                lines.map((l) => {
                    const purchasedQty = Number(l.qtyPurchased ?? l.qty) || 0;
                    const alreadyReceivedQty = Number(l.qtyReceived ?? 0) || 0;
                    const remaining = Math.max(0, purchasedQty - alreadyReceivedQty);
                    return {
                        purchaseLineId: l.purchaseLineId || l.lineId,
                        name: l.rawDescription || l.normalizedName || l.purchaseLineId || l.lineId,
                        unitSi: l.unitSi || 'un',
                        purchasedQty,
                        alreadyReceivedQty,
                        qtyReceivedNow: remaining,
                        shrinkageQty: 0,
                        shrinkageReason: '',
                        lotNumber: '',
                        expiryDateIso: '',
                    };
                })
            );
        } else {
            setLineDrafts([
                {
                    purchaseLineId: `${purchase.purchaseId}_line_1`,
                    name: purchase.supplierName,
                    unitSi: 'un',
                    purchasedQty: 1,
                    alreadyReceivedQty: 0,
                    qtyReceivedNow: 1,
                    shrinkageQty: 0,
                    shrinkageReason: '',
                    lotNumber: '',
                    expiryDateIso: '',
                },
            ]);
        }
    }, [open, purchase, warehouses]);

    const hasDiscrepancyPreview = useMemo(
        () =>
            lineDrafts.some(
                (l) =>
                    l.alreadyReceivedQty + l.qtyReceivedNow < l.purchasedQty ||
                    l.shrinkageQty > 0
            ),
        [lineDrafts]
    );

    if (!open || !purchase) return null;

    const isKeywordValid = keyword.trim().toUpperCase() === 'ACTUALIZAR';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isKeywordValid || lineDrafts.length === 0) return;

        setSubmitting(true);
        setErrorMsg(null);
        try {
            const receivedLines: ConfirmWarehouseReceptionV3Line[] = lineDrafts.map((l) => ({
                purchaseLineId: l.purchaseLineId,
                qtyReceivedNow: Math.max(0, Number(l.qtyReceivedNow) || 0),
                ...(warehouseId ? { warehouseId } : {}),
                shrinkageQty: Math.max(0, Number(l.shrinkageQty) || 0),
                ...(l.shrinkageReason.trim() ? { shrinkageReason: l.shrinkageReason.trim() } : {}),
                ...(l.lotNumber.trim() ? { lotNumber: l.lotNumber.trim() } : {}),
                ...(l.expiryDateIso.trim()
                    ? { expiryDateIso: new Date(`${l.expiryDateIso.trim()}T00:00:00Z`).toISOString() }
                    : {}),
            }));

            const result = await supplyApi.confirmWarehouseReceptionV3(
                {
                    purchaseId: purchase.purchaseId,
                    ...(warehouseId ? { warehouseId } : {}),
                    receivedLines,
                    ...(notes.trim() ? { notes: notes.trim() } : {}),
                    confirmationKeyword: 'ACTUALIZAR',
                },
                tenantId
            );
            onCommitted(result);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'WAREHOUSE_RECEPTION_ERROR');
        } finally {
            setSubmitting(false);
        }
    };

    const inputClass =
        'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';

    return (
        <div
            data-testid="warehouse-reception-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-title`}
            className="fixed inset-0 z-50 flex items-center justify-center p-fib-21 bg-black/70 select-none overflow-y-auto"
        >
            <div className="w-full max-w-3xl bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] rounded-none shadow-none my-auto">
                <header className="flex items-center justify-between px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="flex items-center gap-fib-8 min-w-0">
                        <span className="material-symbols-outlined text-[22px] text-[#C68346]">
                            local_shipping
                        </span>
                        <h3
                            id={`${uid}-title`}
                            className="font-mono text-data-dense font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate"
                        >
                            {t('supply.warehouse.reception_4way_title')} · {purchase.purchaseId}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('supply.common.close')}
                        title={t('supply.common.close')}
                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </header>

                {submitting && (
                    <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />
                )}

                <form
                    onSubmit={(e) => void handleSubmit(e)}
                    autoComplete="off"
                    spellCheck={false}
                    className="p-fib-21 space-y-fib-13 max-h-[80vh] overflow-y-auto"
                >
                    {errorMsg && (
                        <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] px-fib-13 py-fib-8 font-mono text-data-dense text-[#9A5B21] dark:text-[#C68346]">
                            {errorMsg}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                        <div className="space-y-fib-8">
                            <label
                                htmlFor={`${uid}-wh-select`}
                                className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('supply.warehouse.target_warehouse')}
                            </label>
                            <select
                                id={`${uid}-wh-select`}
                                value={warehouseId}
                                onChange={(e) => setWarehouseId(e.target.value)}
                                className={inputClass}
                            >
                                <option value="">{t('supply.warehouse.default_warehouse')}</option>
                                {warehouses.map((w) => (
                                    <option key={w.warehouseId} value={w.warehouseId}>
                                        {w.code} · {w.name} ({w.warehouseClass})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-fib-8">
                            <label
                                htmlFor={`${uid}-notes`}
                                className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('supply.warehouse.reception_notes')}
                            </label>
                            <input
                                id={`${uid}-notes`}
                                type="text"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className={`${inputClass} select-text`}
                            />
                        </div>
                    </div>

                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C]">
                        {lineDrafts.map((line, idx) => (
                            <div key={line.purchaseLineId} className="p-fib-13 space-y-fib-13">
                                <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono tabular-nums">
                                    <span className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {line.name}
                                    </span>
                                    <span className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {line.alreadyReceivedQty}/{line.purchasedQty} {line.unitSi}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-fib-8">
                                    <div className="space-y-1">
                                        <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('supply.warehouse.qty_received_now')}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            value={line.qtyReceivedNow}
                                            onChange={(e) =>
                                                setLineDrafts((prev) =>
                                                    prev.map((d, i) =>
                                                        i === idx
                                                            ? {
                                                                  ...d,
                                                                  qtyReceivedNow:
                                                                      Number(e.target.value) || 0,
                                                              }
                                                            : d
                                                    )
                                                )
                                            }
                                            autoComplete="off"
                                            spellCheck={false}
                                            data-testid={`reception-qty-${line.purchaseLineId}`}
                                            className={`${inputClass} select-text`}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('supply.warehouse.shrinkage_qty')}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            value={line.shrinkageQty}
                                            onChange={(e) =>
                                                setLineDrafts((prev) =>
                                                    prev.map((d, i) =>
                                                        i === idx
                                                            ? {
                                                                  ...d,
                                                                  shrinkageQty:
                                                                      Number(e.target.value) || 0,
                                                              }
                                                            : d
                                                    )
                                                )
                                            }
                                            autoComplete="off"
                                            spellCheck={false}
                                            data-testid={`reception-shrinkage-${line.purchaseLineId}`}
                                            className={`${inputClass} select-text`}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('supply.warehouse.fefo_lot')}
                                        </label>
                                        <input
                                            type="text"
                                            value={line.lotNumber}
                                            onChange={(e) =>
                                                setLineDrafts((prev) =>
                                                    prev.map((d, i) =>
                                                        i === idx
                                                            ? { ...d, lotNumber: e.target.value }
                                                            : d
                                                    )
                                                )
                                            }
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} select-text`}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('supply.warehouse.fefo_expiry')}
                                        </label>
                                        <input
                                            type="date"
                                            value={line.expiryDateIso}
                                            onChange={(e) =>
                                                setLineDrafts((prev) =>
                                                    prev.map((d, i) =>
                                                        i === idx
                                                            ? {
                                                                  ...d,
                                                                  expiryDateIso: e.target.value,
                                                              }
                                                            : d
                                                    )
                                                )
                                            }
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} select-text`}
                                        />
                                    </div>
                                </div>

                                {line.shrinkageQty > 0 && (
                                    <input
                                        type="text"
                                        value={line.shrinkageReason}
                                        onChange={(e) =>
                                            setLineDrafts((prev) =>
                                                prev.map((d, i) =>
                                                    i === idx
                                                        ? {
                                                              ...d,
                                                              shrinkageReason: e.target.value,
                                                          }
                                                        : d
                                                )
                                            )
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder={t('supply.warehouse.shrinkage_reason')}
                                        className={`${inputClass} select-text`}
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {hasDiscrepancyPreview && (
                        <div
                            data-testid="reception-discrepancy-preview"
                            className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] px-fib-13 py-fib-8 font-mono text-microcopy text-[#7C3F0E] dark:text-[#C68346] font-bold"
                        >
                            {t('supply.warehouse.discrepancy_rcv_warning')}
                        </div>
                    )}

                    <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13 flex flex-wrap items-end justify-between gap-fib-13">
                        <div className="flex-1 min-w-[200px] space-y-1">
                            <label
                                htmlFor={`${uid}-hitl-kw`}
                                className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('supply.reconciler.keyword_label')} ACTUALIZAR
                            </label>
                            <input
                                id={`${uid}-hitl-kw`}
                                type="text"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="ACTUALIZAR"
                                data-testid="reception-hitl-keyword"
                                className={cn(
                                    `${inputClass} uppercase select-text`,
                                    isKeywordValid ? 'border-[#00AEEF]' : ''
                                )}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={!isKeywordValid || submitting}
                            data-testid="reception-submit-btn"
                            className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                        >
                            {t('supply.warehouse.confirm_reception_4way')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default WarehouseReceptionModal;
