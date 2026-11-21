import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import { cn } from '../../../utils/cn';
import { supplyApi } from '../services/supplyApi';
import {
    formatCasTelemetry,
    formatClp,
    type FulfillmentAllocationDraft,
    type PurchaseLineDestination,
    type SupplyPurchaseDraft,
    type SupplyRequisition,
    type SupplyRequisitionLine,
} from '../types';

export interface ReconciliationHitlDrawerProps {
    open: boolean;
    draft: SupplyPurchaseDraft | null;
    openRequisitions: SupplyRequisition[];
    tenantId?: string;
    onClose: () => void;
    onClearDraft: () => void;
    onCommitted: (queuedOffline: boolean) => void;
}

interface FlatPendingReqLine {
    reqId: string;
    costCenter: string;
    createdAt: string;
    line: SupplyRequisitionLine;
}

interface EditableAllocationRow {
    purchaseLineId: string;
    rawDescription: string;
    qtyPurchased: number;
    unitSi: string;
    subtotalClp: number;
    selectedReqKey: string; // `${reqId}::${lineId}` or 'UNSOLICITED'
    allocatedQty: number;
    destination: PurchaseLineDestination;
}

function normalizeMatchText(s: string): string {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

export const ReconciliationHitlDrawer: React.FC<ReconciliationHitlDrawerProps> = ({
    open,
    draft,
    openRequisitions,
    tenantId,
    onClose,
    onClearDraft,
    onCommitted,
}) => {
    const { t } = useTranslation();
    const [rows, setRows] = useState<EditableAllocationRow[]>([]);
    const [keywordInput, setKeywordInput] = useState('');
    const [committing, setCommitting] = useState(false);
    const [feedback, setFeedback] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    // FIFO ordered pending requisition lines
    const pendingReqLines = useMemo<FlatPendingReqLine[]>(() => {
        const list: FlatPendingReqLine[] = [];
        const sortedReqs = [...openRequisitions].sort((a, b) =>
            String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        );
        for (const req of sortedReqs) {
            for (const line of req.lines || []) {
                if (line.qtyPending > 0 && line.lineStatus !== 'FULFILLED' && line.lineStatus !== 'CANCELLED') {
                    list.push({
                        reqId: req.reqId,
                        costCenter: req.costCenter,
                        createdAt: req.createdAt,
                        line,
                    });
                }
            }
        }
        return list;
    }, [openRequisitions]);

    // Build initial FIFO matching when draft changes
    useEffect(() => {
        setKeywordInput('');
        setFeedback(null);
        if (!draft) {
            setRows([]);
            return;
        }

        const remainingByKey = new Map<string, number>();
        for (const item of pendingReqLines) {
            remainingByKey.set(`${item.reqId}::${item.line.lineId}`, item.line.qtyPending);
        }

        const initialRows: EditableAllocationRow[] = draft.lines.map((pLine) => {
            let bestKey = 'UNSOLICITED';
            let allocatedQty = pLine.qty;

            if (draft.purchaseMode !== 'DIRECT_AUTONOMOUS' && pLine.destination !== 'CAPEX_ASSET') {
                const descNorm = normalizeMatchText(pLine.rawDescription);
                const candidate = pendingReqLines.find((r) => {
                    const key = `${r.reqId}::${r.line.lineId}`;
                    if ((remainingByKey.get(key) || 0) <= 0) return false;
                    if (pLine.canonicalSkuId && r.line.canonicalSkuId === pLine.canonicalSkuId) return true;
                    const reqNorm = normalizeMatchText(r.line.name);
                    return reqNorm.length >= 3 && (descNorm.includes(reqNorm) || reqNorm.includes(descNorm));
                });

                if (candidate) {
                    const key = `${candidate.reqId}::${candidate.line.lineId}`;
                    const avail = remainingByKey.get(key) || 0;
                    bestKey = key;
                    allocatedQty = Math.min(pLine.qty, avail);
                    remainingByKey.set(key, Math.max(0, avail - allocatedQty));
                }
            }

            return {
                purchaseLineId: pLine.lineId,
                rawDescription: pLine.rawDescription,
                qtyPurchased: pLine.qty,
                unitSi: pLine.unitSi,
                subtotalClp: pLine.subtotalClp,
                selectedReqKey: bestKey,
                allocatedQty,
                destination: pLine.destination,
            };
        });

        setRows(initialRows);
    }, [draft, pendingReqLines]);

    // Compute comparative state per row & untouched pending lines
    const reqMap = useMemo(() => {
        const m = new Map<string, FlatPendingReqLine>();
        for (const item of pendingReqLines) {
            m.set(`${item.reqId}::${item.line.lineId}`, item);
        }
        return m;
    }, [pendingReqLines]);

    const allocatedTotalsByReqKey = useMemo(() => {
        const m = new Map<string, number>();
        for (const row of rows) {
            if (row.selectedReqKey !== 'UNSOLICITED') {
                m.set(row.selectedReqKey, (m.get(row.selectedReqKey) || 0) + (Number(row.allocatedQty) || 0));
            }
        }
        return m;
    }, [rows]);

    const untouchedPendingLines = useMemo(
        () =>
            pendingReqLines.filter(
                (item) => (allocatedTotalsByReqKey.get(`${item.reqId}::${item.line.lineId}`) || 0) === 0
            ),
        [pendingReqLines, allocatedTotalsByReqKey]
    );

    const isKeywordValid = keywordInput.trim().toUpperCase() === 'ACTUALIZAR';
    const casTelemetry = useMemo(() => formatCasTelemetry(draft?.evidenceCasRef), [draft]);

    const handleCommit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft || !isKeywordValid || committing) return;

        const allocations: FulfillmentAllocationDraft[] = rows.map((row) => {
            if (row.selectedReqKey === 'UNSOLICITED') {
                return {
                    purchaseLineId: row.purchaseLineId,
                    requisitionId: null,
                    requisitionLineId: null,
                    allocationType: 'UNSOLICITED_PURCHASE',
                    allocatedQty: row.qtyPurchased,
                    destination: row.destination,
                    resultingStatus: row.destination === 'CAPEX_ASSET' ? 'CAPEX_ASSET' : 'STOCK',
                };
            }
            const [reqId, reqLineId] = row.selectedReqKey.split('::');
            const target = reqMap.get(row.selectedReqKey);
            const totalAlloc = allocatedTotalsByReqKey.get(row.selectedReqKey) || row.allocatedQty;
            const pending = target?.line.qtyPending || 0;
            const resultingStatus = totalAlloc >= pending ? 'FULFILLED' : totalAlloc > 0 ? 'PARTIAL' : 'OPEN';
            return {
                purchaseLineId: row.purchaseLineId,
                requisitionId: reqId || null,
                requisitionLineId: reqLineId || null,
                allocationType: 'REQUISITION_MATCH',
                allocatedQty: row.allocatedQty,
                destination: row.destination,
                resultingStatus,
            };
        });

        setCommitting(true);
        setFeedback(null);
        try {
            const res = await supplyApi.commitPurchase(
                {
                    draft,
                    allocations,
                    confirmationKeyword: 'ACTUALIZAR',
                },
                tenantId
            );
            setFeedback({
                tone: 'cyan',
                text: res.queuedOffline
                    ? t('supply.scanner.offline_queued_notice')
                    : t('supply.reconciler.committed_ok'),
            });
            setKeywordInput('');
            onCommitted(Boolean(res.queuedOffline));
        } catch (err) {
            setFeedback({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'COMMIT_ERROR',
            });
        } finally {
            setCommitting(false);
        }
    };

    if (!open) return null;

    return (
        <aside
            aria-label={t('supply.reconciler.title')}
            className="w-full h-full min-h-0 flex flex-col bg-[#F8FAFC] dark:bg-[#07090D] border-l border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none select-none overflow-hidden"
        >
            <header className="h-[56px] shrink-0 px-fib-21 flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <span className="material-symbols-outlined text-[20px] text-[#C68346]">
                        compare_arrows
                    </span>
                    <h3 className="font-mono text-data-dense font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {t('supply.reconciler.title')}
                    </h3>
                </div>
                <div className="flex items-center gap-fib-8 shrink-0">
                    {draft && (
                        <button
                            type="button"
                            onClick={onClearDraft}
                            aria-label={t('supply.reconciler.clear_draft')}
                            title={t('supply.reconciler.clear_draft')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('supply.common.close')}
                        title={t('supply.common.close')}
                        className="bg-transparent border-0 outline-none p-1 min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
            </header>

            {committing && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('supply.reconciler.commit_button')}
                />
            )}

            <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                {feedback && (
                    <div
                        className={cn(
                            'border-l-[3px] pl-fib-13 py-fib-8 font-mono text-data-dense tabular-nums',
                            feedback.tone === 'copper'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-[#00AEEF] text-[#00AEEF]'
                        )}
                    >
                        {feedback.text}
                    </div>
                )}

                {!draft ? (
                    <div className="py-fib-34 text-center space-y-fib-13">
                        <span className="material-symbols-outlined text-[32px] text-[#475569] dark:text-[#8A93A6]">
                            fact_check
                        </span>
                        <p className="font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.reconciler.empty')}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Financial & CAS Summary */}
                        <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 space-y-fib-8 font-mono tabular-nums">
                            <div className="flex items-center justify-between text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                <span className="font-bold truncate">{draft.supplierName}</span>
                                <span className="select-text">
                                    DTE {draft.documentType} #{draft.folio || '—'}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-fib-8 text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                <div>
                                    <div>{t('supply.scanner.net_clp')}</div>
                                    <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                        {formatClp(draft.netAmountClp)}
                                    </div>
                                </div>
                                <div>
                                    <div>{t('supply.scanner.vat_clp')}</div>
                                    <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                        {formatClp(draft.vatAmountClp)}
                                    </div>
                                </div>
                                <div>
                                    <div>{t('supply.scanner.total_clp')}</div>
                                    <div
                                        className={cn(
                                            'text-data-dense font-bold',
                                            draft.arithmeticMismatch
                                                ? 'text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {formatClp(draft.totalAmountClp)}
                                    </div>
                                </div>
                            </div>
                            {casTelemetry && (
                                <div className="text-microcopy text-[#00AEEF] select-text">
                                    {casTelemetry}
                                </div>
                            )}
                        </div>

                        {/* Comparative Table: [Solicitado/Pendiente] -> [Detectado] -> [Nuevo Estado] */}
                        <div className="space-y-fib-13">
                            <div className="grid grid-cols-12 gap-fib-8 pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                <div className="col-span-5">{t('supply.reconciler.col_requested')}</div>
                                <div className="col-span-4">{t('supply.reconciler.col_detected')}</div>
                                <div className="col-span-3 text-right">
                                    {t('supply.reconciler.col_new_status')}
                                </div>
                            </div>

                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {rows.map((row) => {
                                    const matched =
                                        row.selectedReqKey !== 'UNSOLICITED'
                                            ? reqMap.get(row.selectedReqKey)
                                            : undefined;
                                    const pendingBefore = matched?.line.qtyPending || 0;
                                    const remainingAfter = matched
                                        ? Math.max(0, pendingBefore - row.allocatedQty)
                                        : 0;
                                    const newStatus = !matched
                                        ? row.destination === 'CAPEX_ASSET'
                                            ? 'CAPEX_ASSET'
                                            : 'STOCK'
                                        : remainingAfter <= 0
                                          ? 'FULFILLED'
                                          : 'PARTIAL';

                                    const barColor =
                                        newStatus === 'FULFILLED'
                                            ? 'border-[#00AEEF]'
                                            : newStatus === 'PARTIAL' || newStatus === 'CAPEX_ASSET'
                                              ? 'border-[#C68346]'
                                              : 'border-transparent';

                                    return (
                                        <div
                                            key={row.purchaseLineId}
                                            className={cn(
                                                'py-fib-13 pl-fib-8 border-l-[3px] space-y-fib-8',
                                                barColor
                                            )}
                                        >
                                            <div className="grid grid-cols-12 gap-fib-8 items-start font-mono text-data-dense tabular-nums">
                                                <div className="col-span-5 space-y-1">
                                                    <select
                                                        value={row.selectedReqKey}
                                                        onChange={(e) => {
                                                            const nextKey = e.target.value;
                                                            const nextMatch = reqMap.get(nextKey);
                                                            setRows((prev) =>
                                                                prev.map((r) =>
                                                                    r.purchaseLineId === row.purchaseLineId
                                                                        ? {
                                                                              ...r,
                                                                              selectedReqKey: nextKey,
                                                                              allocatedQty: nextMatch
                                                                                  ? Math.min(
                                                                                        r.qtyPurchased,
                                                                                        nextMatch.line.qtyPending
                                                                                    )
                                                                                  : r.qtyPurchased,
                                                                          }
                                                                        : r
                                                                )
                                                            );
                                                        }}
                                                        className="w-full min-h-[38px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                                    >
                                                        <option value="UNSOLICITED">
                                                            {t('supply.reconciler.allocation_unsolicited')}
                                                        </option>
                                                        {pendingReqLines.map((opt) => {
                                                            const key = `${opt.reqId}::${opt.line.lineId}`;
                                                            return (
                                                                <option key={key} value={key}>
                                                                    {opt.line.name} ({opt.line.qtyPending}{' '}
                                                                    {opt.line.unitSi}) · {opt.costCenter}
                                                                </option>
                                                            );
                                                        })}
                                                    </select>
                                                    {matched && (
                                                        <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                            {matched.line.qtyPending} {matched.line.unitSi} ➔{' '}
                                                            {remainingAfter} {matched.line.unitSi}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="col-span-4 space-y-1">
                                                    <div className="text-[#0F172A] dark:text-[#F3F4F6] font-sans font-semibold truncate">
                                                        {row.rawDescription}
                                                    </div>
                                                    <div className="flex items-center gap-fib-8">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            min={0}
                                                            max={row.qtyPurchased}
                                                            value={row.allocatedQty}
                                                            onChange={(e) => {
                                                                const val = Math.max(
                                                                    0,
                                                                    Math.min(
                                                                        row.qtyPurchased,
                                                                        Number(e.target.value) || 0
                                                                    )
                                                                );
                                                                setRows((prev) =>
                                                                    prev.map((r) =>
                                                                        r.purchaseLineId === row.purchaseLineId
                                                                            ? { ...r, allocatedQty: val }
                                                                            : r
                                                                    )
                                                                );
                                                            }}
                                                            autoComplete="off"
                                                            spellCheck={false}
                                                            aria-label={t('supply.reconciler.allocation_qty')}
                                                            className="w-20 min-h-[36px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                                        />
                                                        <span className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                            / {row.qtyPurchased} {row.unitSi}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="col-span-3 text-right space-y-1">
                                                    <div
                                                        className={cn(
                                                            'text-microcopy font-bold uppercase',
                                                            newStatus === 'FULFILLED'
                                                                ? 'text-[#00AEEF]'
                                                                : newStatus === 'PARTIAL' ||
                                                                    newStatus === 'CAPEX_ASSET'
                                                                  ? 'text-[#C68346]'
                                                                  : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                        )}
                                                    >
                                                        {t(`supply.status.${newStatus}`)}
                                                    </div>
                                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                        {formatClp(row.subtotalClp)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Remaining untouched pending backlog items for complete visibility */}
                                {untouchedPendingLines.slice(0, 6).map((item) => (
                                    <div
                                        key={`${item.reqId}::${item.line.lineId}`}
                                        className="py-fib-8 pl-fib-8 border-l-[3px] border-transparent grid grid-cols-12 gap-fib-8 items-center font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        <div className="col-span-5 truncate">
                                            {item.line.name} ({item.line.qtyPending} {item.line.unitSi})
                                        </div>
                                        <div className="col-span-4">0 {item.line.unitSi}</div>
                                        <div className="col-span-3 text-right uppercase">
                                            {t('supply.status.OPEN')}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Mandatory HITL "ACTUALIZAR" Commit Gate */}
                        <form
                            onSubmit={handleCommit}
                            autoComplete="off"
                            spellCheck={false}
                            className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21 space-y-fib-13"
                        >
                            <label className="block font-mono text-microcopy font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.reconciler.keyword_label')}{' '}
                                <span className="text-[#C68346] select-text">ACTUALIZAR</span>
                            </label>
                            <input
                                type="text"
                                value={keywordInput}
                                onChange={(e) => setKeywordInput(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="ACTUALIZAR"
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tracking-widest uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                            <button
                                type="submit"
                                disabled={!isKeywordValid || committing}
                                className={cn(
                                    'w-full min-h-[48px] px-fib-21 font-mono text-data-dense font-bold uppercase tracking-wider border rounded-none shadow-none flex items-center justify-center gap-fib-8 transition-colors',
                                    isKeywordValid && !committing
                                        ? 'bg-[#C68346] border-[#C68346] text-[#FFFFFF] cursor-pointer hover:opacity-90'
                                        : 'bg-[#E2E8F0] dark:bg-[#12151C] border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] cursor-not-allowed'
                                )}
                            >
                                {committing && (
                                    <M3CircularProgress
                                        size={16}
                                        ariaLabel={t('supply.reconciler.commit_button')}
                                    />
                                )}
                                <span>{t('supply.reconciler.commit_button')}</span>
                            </button>
                        </form>
                    </>
                )}
            </div>
        </aside>
    );
};

export default ReconciliationHitlDrawer;
