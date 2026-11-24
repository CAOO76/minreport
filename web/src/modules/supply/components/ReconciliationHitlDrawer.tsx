import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import CopyButton from '../../../components/common/CopyButton';
import { cn } from '../../../utils/cn';
import type {
    ReconciliationProposal,
    ReconciliationProposedLineMatch,
    SupplyAnomalyAlert,
} from '../../../contracts/supply.contracts';
import { supplyApi } from '../services/supplyApi';
import {
    formatCasTelemetry,
    formatClp,
    type FulfillmentAllocationDraft,
    type LandedCostProrationMode,
    type PurchaseLineDestination,
    type SemanticMatchClassification,
    type SupplyPurchaseDraft,
    type SupplyRequisition,
    type SupplyRequisitionLine,
    type SupplyUnitSi,
} from '../types';

export interface ReconciliationHitlDrawerProps {
    open: boolean;
    draft: SupplyPurchaseDraft | null;
    openRequisitions: SupplyRequisition[];
    tenantId?: string;
    canMutate?: boolean;
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
    canonicalSkuId: string;
    qtyPurchased: number;
    unitSi: SupplyUnitSi;
    unitPriceClp: number;
    subtotalClp: number;
    selectedReqKey: string; // `${reqId}::${lineId}` or 'UNSOLICITED'
    allocatedQty: number;
    destination: PurchaseLineDestination;
    costCenter?: string;
    classification: SemanticMatchClassification;
    accepted: boolean;
    proposedMatch?: ReconciliationProposedLineMatch;
}

const PRORATION_MODES: LandedCostProrationMode[] = ['NET_VALUE', 'WEIGHT_KG', 'VOLUME_L'];

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
    canMutate = true,
    onClose,
    onClearDraft,
    onCommitted,
}) => {
    const { t } = useTranslation();
    const uid = useId();
    const [rows, setRows] = useState<EditableAllocationRow[]>([]);
    const [backlogSearch, setBacklogSearch] = useState('');
    const [prorationMode, setProrationMode] = useState<LandedCostProrationMode>('NET_VALUE');
    const [freightOrAdjustmentClp, setFreightOrAdjustmentClp] = useState<number>(0);
    const [proposing, setProposing] = useState(false);
    const [proposal, setProposal] = useState<ReconciliationProposal | null>(null);
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
        setProposal(null);
        setBacklogSearch('');
        setFreightOrAdjustmentClp(0);
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
                canonicalSkuId: pLine.canonicalSkuId || 'SKU-OTROS-OPERACIONAL',
                qtyPurchased: pLine.qty,
                unitSi: pLine.unitSi,
                unitPriceClp: pLine.unitPriceClp,
                subtotalClp: pLine.subtotalClp,
                selectedReqKey: bestKey,
                allocatedQty,
                destination: pLine.destination,
                classification:
                    pLine.destination === 'CAPEX_ASSET'
                        ? 'UNSOLICITED_OR_CAPEX'
                        : bestKey === 'UNSOLICITED'
                          ? 'UNSOLICITED_OR_CAPEX'
                          : 'EXACT_EQUIVALENT',
                accepted: true,
            };
        });

        setRows(initialRows);
    }, [draft, pendingReqLines]);

    // Compute comparative state per row & untouched pending lines (FULL backlog, zero .slice(0, 6))
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

    const untouchedPendingLines = useMemo(() => {
        const base = pendingReqLines.filter(
            (item) => (allocatedTotalsByReqKey.get(`${item.reqId}::${item.line.lineId}`) || 0) === 0
        );
        const q = backlogSearch.trim().toLowerCase();
        if (!q) return base;
        return base.filter((item) =>
            `${item.reqId} ${item.costCenter} ${item.line.name} ${item.line.canonicalSkuId || ''}`
                .toLowerCase()
                .includes(q)
        );
    }, [pendingReqLines, allocatedTotalsByReqKey, backlogSearch]);

    const combinedAnomalies = useMemo<SupplyAnomalyAlert[]>(() => {
        if (!proposal) return [];
        const list: SupplyAnomalyAlert[] = [];
        if (proposal.ruralDuplicateAlert) list.push(proposal.ruralDuplicateAlert);
        for (const a of proposal.anomalies || []) list.push(a);
        return list;
    }, [proposal]);

    const isKeywordValid = keywordInput.trim().toUpperCase() === 'ACTUALIZAR';
    const casTelemetry = useMemo(() => formatCasTelemetry(draft?.evidenceCasRef), [draft]);

    const handlePropose4Way = async () => {
        if (!draft || proposing) return;
        setProposing(true);
        setFeedback(null);
        try {
            const reqIds = Array.from(new Set(openRequisitions.map((r) => r.reqId)));
            const res = await supplyApi.proposeReconciliation4Way(
                {
                    siteId: draft.siteId || 'site-main',
                    supplierTaxId: draft.supplierTaxId,
                    supplierName: draft.supplierName,
                    documentType: draft.documentType,
                    folio: draft.folio || '0',
                    issueDate: draft.issueDate,
                    totalAmountClp: draft.totalAmountClp,
                    globalDiscountOrChargeClp: freightOrAdjustmentClp || 0,
                    prorationMode,
                    requisitionIds: reqIds,
                    lines: draft.lines.map((l, idx) => ({
                        purchaseLineId: l.lineId,
                        lineNumber: idx + 1,
                        rawDescription: l.rawDescription,
                        quantity: Math.max(0.0001, Number(l.qty) || 1),
                        rawUnit: l.unitSi,
                        unitPriceClp: Math.max(0, Number(l.unitPriceClp) || 0),
                        subtotalClp: Math.max(0, Number(l.subtotalClp) || 0),
                        isCapexAsset: l.destination === 'CAPEX_ASSET',
                    })),
                },
                tenantId
            );
            setProposal(res);
            const matchById = new Map(
                (res.proposedLines || []).map((m) => [m.purchaseLineId, m])
            );
            setRows((prev) =>
                prev.map((row) => {
                    const m = matchById.get(row.purchaseLineId);
                    if (!m) return row;
                    const candidateReqId = m.candidateRequisitionIds?.[0];
                    const matchingPending = candidateReqId
                        ? pendingReqLines.find((p) => p.reqId === candidateReqId)
                        : undefined;
                    return {
                        ...row,
                        canonicalSkuId: m.matchedCanonicalSkuId || row.canonicalSkuId,
                        classification: m.classification,
                        proposedMatch: m,
                        accepted:
                            m.classification === 'EXACT_EQUIVALENT' ||
                            m.classification === 'ACCESSORY_CHARGE',
                        selectedReqKey: matchingPending
                            ? `${matchingPending.reqId}::${matchingPending.line.lineId}`
                            : row.selectedReqKey,
                    };
                })
            );
        } catch (err) {
            setFeedback({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'PROPOSE_4WAY_ERROR',
            });
        } finally {
            setProposing(false);
        }
    };

    const handleCommit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate || !draft || !isKeywordValid || committing) return;

        setCommitting(true);
        setFeedback(null);
        try {
            if (proposal) {
                const reqIds = Array.from(
                    new Set(
                        rows
                            .filter((r) => r.selectedReqKey !== 'UNSOLICITED')
                            .map((r) => r.selectedReqKey.split('::')[0])
                            .filter(Boolean)
                    )
                );
                await supplyApi.commitReconciliation4Way(
                    {
                        proposalId: proposal.proposalId,
                        siteId: draft.siteId || 'site-main',
                        supplierTaxId: draft.supplierTaxId,
                        supplierName: draft.supplierName,
                        documentType: draft.documentType,
                        folio: draft.folio || '0',
                        issueDate: draft.issueDate,
                        paymentMethod: draft.paymentMethod,
                        purchaseMode: draft.purchaseMode,
                        prorationMode,
                        globalDiscountOrChargeClp: freightOrAdjustmentClp || 0,
                        iepOrIecFuelTaxClp: proposal.siiTaxes?.iepOrIecClp || 0,
                        requisitionIds: reqIds,
                        confirmationKeyword: 'ACTUALIZAR',
                        lines: rows.map((row) => ({
                            purchaseLineId: row.purchaseLineId,
                            rawDescription: row.rawDescription,
                            canonicalSkuId: row.canonicalSkuId.trim() || 'SKU-OTROS-OPERACIONAL',
                            classification: row.classification,
                            unitSi: row.unitSi,
                            qtyPurchased: Math.max(0.0001, Number(row.qtyPurchased) || 1),
                            unitPriceClp: Math.max(0, Number(row.unitPriceClp) || 0),
                            subtotalClp: Math.max(0, Number(row.subtotalClp) || 0),
                            linePricingBasis: proposal.siiTaxes?.linePricingBasis || 'NET',
                            destination: row.destination,
                            costCenter: row.costCenter,
                            isCapexAsset: row.destination === 'CAPEX_ASSET',
                            learnSupplierMapping: row.accepted,
                            accepted: row.accepted,
                        })),
                    },
                    tenantId
                );
                setFeedback({
                    tone: 'cyan',
                    text: t('supply.reconciler.committed_ok'),
                });
                setKeywordInput('');
                onCommitted(false);
                return;
            }

            const allocations: FulfillmentAllocationDraft[] = rows.map((row) => {
                if (row.selectedReqKey === 'UNSOLICITED') {
                    return {
                        purchaseLineId: row.purchaseLineId,
                        allocationKind: 'UNSOLICITED_PURCHASE',
                        requisitionId: null,
                        requisitionLineId: null,
                        qtyAllocated: Math.max(0.0001, Number(row.qtyPurchased) || 1),
                        unitSi: row.unitSi,
                        destination: row.destination,
                        resultingRequisitionLineStatus: null,
                    };
                }
                const [reqId, reqLineId] = row.selectedReqKey.split('::');
                const target = reqMap.get(row.selectedReqKey);
                const totalAlloc = allocatedTotalsByReqKey.get(row.selectedReqKey) || row.allocatedQty;
                const pending = target?.line.qtyPending || 0;
                const resultingRequisitionLineStatus =
                    totalAlloc >= pending ? 'FULFILLED' : totalAlloc > 0 ? 'PARTIAL' : 'OPEN';
                return {
                    purchaseLineId: row.purchaseLineId,
                    allocationKind: 'REQUISITION_MATCH',
                    requisitionId: reqId || null,
                    requisitionLineId: reqLineId || null,
                    qtyAllocated: Math.max(0.0001, Number(row.allocatedQty) || 1),
                    unitSi: row.unitSi,
                    destination: row.destination,
                    resultingRequisitionLineStatus,
                };
            });

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
            className="w-full h-full min-h-0 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] border-l border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none select-none overflow-hidden"
        >
            <header className="h-[56px] shrink-0 px-fib-21 flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <span className="material-symbols-outlined text-[22px] text-[#C68346]">
                        compare_arrows
                    </span>
                    <h3 className="text-[17px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {t('supply.reconciler.title')}
                    </h3>
                </div>
                <div className="flex items-center gap-fib-8 shrink-0">
                    {draft && canMutate && (
                        <button
                            type="button"
                            onClick={onClearDraft}
                            aria-label={t('supply.reconciler.clear_draft')}
                            title={t('supply.reconciler.clear_draft')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#7C3F0E] dark:hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('supply.common.close')}
                        title={t('supply.common.close')}
                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">close</span>
                    </button>
                </div>
            </header>

            {(committing || proposing) && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('supply.reconciler.commit_button')}
                />
            )}

            <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                {feedback && (
                    <div
                        className={cn(
                            'border-l-[3px] pl-fib-13 py-fib-8 text-[15px] tabular-nums',
                            feedback.tone === 'copper'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                : 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
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
                        <p className="text-[15px] text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.reconciler.empty')}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Financial & CAS Summary */}
                        <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 space-y-fib-8 tabular-nums">
                            <div className="flex items-center justify-between gap-fib-8 text-[16px] text-[#0F172A] dark:text-[#F3F4F6]">
                                <span className="font-bold truncate">{draft.supplierName}</span>
                                <div className="flex items-center gap-fib-8 shrink-0">
                                    <span className="font-mono select-text">
                                        Doc. {draft.documentType} #{draft.folio || '—'}
                                    </span>
                                    {draft.folio && (
                                        <CopyButton
                                            value={draft.folio}
                                            title={t('supply.common.copy_folio')}
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-fib-8 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                <div>
                                    <div>{t('supply.scanner.net_clp')}</div>
                                    <div className="font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                        {formatClp(draft.netAmountClp)}
                                    </div>
                                </div>
                                <div>
                                    <div>{t('supply.scanner.vat_clp')}</div>
                                    <div className="font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                        {formatClp(draft.vatAmountClp)}
                                    </div>
                                </div>
                                <div>
                                    <div>{t('supply.scanner.total_clp')}</div>
                                    <div
                                        className={cn(
                                            'font-mono text-[15px] font-bold',
                                            draft.arithmeticMismatch
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {formatClp(draft.totalAmountClp)}
                                    </div>
                                </div>
                            </div>
                            {casTelemetry && (
                                <div className="font-mono text-[14px] text-[#0369A1] dark:text-[#00AEEF] select-text">
                                    {casTelemetry}
                                </div>
                            )}
                        </div>

                        {/* 4-Way Semantic Proposal, Proration Mode & Freight Adjustment Controls */}
                        <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 space-y-fib-13">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                <div className="space-y-1">
                                    <label
                                        htmlFor={`${uid}-proration`}
                                        className="block text-[14px] text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        {t('supply.reconciler.proration_label')}
                                    </label>
                                    <select
                                        id={`${uid}-proration`}
                                        value={prorationMode}
                                        onChange={(e) =>
                                            setProrationMode(
                                                e.target.value as LandedCostProrationMode
                                            )
                                        }
                                        data-testid="reconciler-proration-select"
                                        className="w-full min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                                    >
                                        {PRORATION_MODES.map((pm) => (
                                            <option key={pm} value={pm}>
                                                {t(`supply.reconciler.proration_${pm}`)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label
                                        htmlFor={`${uid}-freight`}
                                        className="block text-[14px] text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        {t('supply.reconciler.freight_clp_label')}
                                    </label>
                                    <input
                                        id={`${uid}-freight`}
                                        type="number"
                                        value={freightOrAdjustmentClp}
                                        onChange={(e) =>
                                            setFreightOrAdjustmentClp(Number(e.target.value) || 0)
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        data-testid="reconciler-freight-input"
                                        className="w-full min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                    />
                                </div>
                            </div>

                            {canMutate && (
                                <button
                                    type="button"
                                    disabled={proposing}
                                    onClick={() => void handlePropose4Way()}
                                    data-testid="reconciler-propose-4way-btn"
                                    className="w-full min-h-[48px] px-fib-13 bg-transparent border border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF] text-[15px] font-bold inline-flex items-center justify-center gap-fib-8 rounded-none shadow-none cursor-pointer hover:opacity-80 disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[20px]">
                                        auto_awesome
                                    </span>
                                    <span>{t('supply.reconciler.propose_4way_btn')}</span>
                                </button>
                            )}
                        </div>

                        {/* Anomaly Alerts */}
                        {combinedAnomalies.length > 0 && (
                            <div className="space-y-fib-8">
                                <div className="text-[15px] font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                    {t('supply.reconciler.anomalies_title')} ({combinedAnomalies.length})
                                </div>
                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {combinedAnomalies.map((anom) => (
                                        <div
                                            key={anom.alertId}
                                            data-testid={`reconciler-anomaly-${anom.alertId}`}
                                            className={cn(
                                                'py-fib-8 pl-fib-13 border-l-[3px] text-[14px] space-y-1 tabular-nums',
                                                anom.severity === 'INFO'
                                                    ? 'border-l-[#00AEEF]'
                                                    : 'border-l-[#C68346]'
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-fib-8 font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                                <span>
                                                    {t(
                                                        `supply.reconciler.anomaly_${anom.alertType}`
                                                    )}
                                                </span>
                                                {typeof anom.variancePct === 'number' && (
                                                    <span className="font-mono">{anom.variancePct.toFixed(1)}%</span>
                                                )}
                                            </div>
                                            <div className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {anom.messageSpanish}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Comparative Table */}
                        <div className="space-y-fib-13">
                            <div className="grid grid-cols-12 gap-fib-8 pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] text-[14px] font-semibold text-[#475569] dark:text-[#8A93A6]">
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
                                            <div className="grid grid-cols-12 gap-fib-8 items-start tabular-nums">
                                                <div className="col-span-5 space-y-fib-8">
                                                    <select
                                                        value={row.selectedReqKey}
                                                        disabled={!canMutate}
                                                        aria-label={`${t('supply.reconciler.select_requisition')} · ${row.rawDescription}`}
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
                                                        className="w-full min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] text-[14px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none disabled:opacity-50"
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
                                                        <div className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                            {matched.line.qtyPending} {matched.line.unitSi} ➔{' '}
                                                            {remainingAfter} {matched.line.unitSi}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="col-span-4 space-y-fib-8">
                                                    <div className="text-[15px] text-[#0F172A] dark:text-[#F3F4F6] font-semibold truncate">
                                                        {row.rawDescription}
                                                    </div>
                                                    <div className="flex items-center gap-fib-8">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            min={0}
                                                            max={row.qtyPurchased}
                                                            disabled={!canMutate}
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
                                                            className="w-20 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text disabled:opacity-50"
                                                        />
                                                        <span className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                            / {row.qtyPurchased} {row.unitSi}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="col-span-3 text-right space-y-fib-8">
                                                    <div
                                                        className={cn(
                                                            'text-[14px] font-bold',
                                                            newStatus === 'FULFILLED'
                                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                                : newStatus === 'PARTIAL' ||
                                                                    newStatus === 'CAPEX_ASSET'
                                                                  ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                                  : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                        )}
                                                    >
                                                        {t(`supply.status.${newStatus}`)}
                                                    </div>
                                                    <div className="font-mono text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                        {formatClp(row.subtotalClp)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 4-Way AI 1-to-1 Semantic Diff */}
                                            {row.proposedMatch && (
                                                <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-8 space-y-fib-8 text-[14px] tabular-nums">
                                                    <div className="flex flex-wrap items-center justify-between gap-fib-8">
                                                        <span
                                                            data-testid={`reconciler-class-${row.purchaseLineId}`}
                                                            className={cn(
                                                                'font-bold',
                                                                row.classification === 'SUBSTITUTE_CANDIDATE' ||
                                                                    row.classification === 'UNSOLICITED_OR_CAPEX'
                                                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                                    : 'text-[#0369A1] dark:text-[#00AEEF]'
                                                            )}
                                                        >
                                                            {t(
                                                                `supply.reconciler.class_${row.classification}`
                                                            )}
                                                        </span>
                                                        <span className="font-mono text-[#475569] dark:text-[#8A93A6]">
                                                            {Math.round(
                                                                row.proposedMatch.confidence * 100
                                                            )}
                                                            %
                                                        </span>
                                                    </div>

                                                    <div className="flex flex-wrap items-center justify-between gap-fib-8 text-[#0F172A] dark:text-[#F3F4F6]">
                                                        <span>
                                                            {row.rawDescription} ➔{' '}
                                                            <strong>
                                                                {row.proposedMatch.matchedSkuName ||
                                                                    row.canonicalSkuId}
                                                            </strong>
                                                        </span>
                                                        <span
                                                            data-testid={`reconciler-landed-${row.purchaseLineId}`}
                                                            className="font-mono font-bold text-[#0369A1] dark:text-[#00AEEF]"
                                                        >
                                                            {t(
                                                                'supply.reconciler.landed_unit_preview'
                                                            )}
                                                            :{' '}
                                                            {formatClp(
                                                                row.proposedMatch.landedUnitCostNetClp
                                                            )}
                                                        </span>
                                                    </div>

                                                    <div className="flex flex-wrap items-center justify-between gap-fib-8">
                                                        <input
                                                            type="text"
                                                            value={row.canonicalSkuId}
                                                            disabled={!canMutate}
                                                            onChange={(e) =>
                                                                setRows((prev) =>
                                                                    prev.map((r) =>
                                                                        r.purchaseLineId ===
                                                                        row.purchaseLineId
                                                                            ? {
                                                                                  ...r,
                                                                                  canonicalSkuId:
                                                                                      e.target.value,
                                                                              }
                                                                            : r
                                                                    )
                                                                )
                                                            }
                                                            autoComplete="off"
                                                            spellCheck={false}
                                                            aria-label={t(
                                                                'supply.reconciler.sku_override'
                                                            )}
                                                            className="flex-1 min-w-[140px] min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[14px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                                        />
                                                        {canMutate && (
                                                            <div className="flex items-center gap-fib-8">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setRows((prev) =>
                                                                            prev.map((r) =>
                                                                                r.purchaseLineId ===
                                                                                row.purchaseLineId
                                                                                    ? {
                                                                                          ...r,
                                                                                          accepted: true,
                                                                                      }
                                                                                    : r
                                                                            )
                                                                        )
                                                                    }
                                                                    aria-label={t(
                                                                        'supply.reconciler.accept_line'
                                                                    )}
                                                                    title={t(
                                                                        'supply.reconciler.accept_line'
                                                                    )}
                                                                    data-testid={`reconciler-line-accept-${row.purchaseLineId}`}
                                                                    className={cn(
                                                                        'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center cursor-pointer rounded-none shadow-none',
                                                                        row.accepted
                                                                            ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                                                    )}
                                                                >
                                                                    <span className="material-symbols-outlined text-[22px]">
                                                                        check_circle
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setRows((prev) =>
                                                                            prev.map((r) =>
                                                                                r.purchaseLineId ===
                                                                                row.purchaseLineId
                                                                                    ? {
                                                                                          ...r,
                                                                                          accepted: false,
                                                                                      }
                                                                                    : r
                                                                            )
                                                                        )
                                                                    }
                                                                    aria-label={t(
                                                                        'supply.reconciler.reject_line'
                                                                    )}
                                                                    title={t(
                                                                        'supply.reconciler.reject_line'
                                                                    )}
                                                                    data-testid={`reconciler-line-reject-${row.purchaseLineId}`}
                                                                    className={cn(
                                                                        'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center cursor-pointer rounded-none shadow-none',
                                                                        !row.accepted
                                                                            ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                                                    )}
                                                                >
                                                                    <span className="material-symbols-outlined text-[22px]">
                                                                        cancel
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Full Scrollable Pending Backlog */}
                                {(untouchedPendingLines.length > 0 || backlogSearch.trim().length > 0) && (
                                    <div className="pt-fib-13 space-y-fib-8">
                                        <div className="flex flex-wrap items-center justify-between gap-fib-8">
                                            <span className="text-[14px] font-bold text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.reconciler.backlog_open_title')} (
                                                {untouchedPendingLines.length})
                                            </span>
                                        </div>
                                        <input
                                            type="text"
                                            value={backlogSearch}
                                            onChange={(e) => setBacklogSearch(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            aria-label={t(
                                                'supply.reconciler.backlog_search_placeholder'
                                            )}
                                            placeholder={t(
                                                'supply.reconciler.backlog_search_placeholder'
                                            )}
                                            data-testid="reconciler-backlog-search"
                                            className="w-full min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                        />
                                        <div
                                            data-testid="reconciler-backlog-full-list"
                                            className="max-h-64 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C]"
                                        >
                                            {untouchedPendingLines.map((item) => (
                                                <div
                                                    key={`${item.reqId}::${item.line.lineId}`}
                                                    className="py-fib-8 border-l-[3px] border-transparent grid grid-cols-12 gap-fib-8 items-center text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]"
                                                >
                                                    <div className="col-span-6 truncate text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {item.line.name} ({item.line.qtyPending}{' '}
                                                        {item.line.unitSi}) · {item.reqId}
                                                    </div>
                                                    <div className="col-span-3 truncate">
                                                        {item.costCenter}
                                                    </div>
                                                    <div className="col-span-3 text-right">
                                                        {t('supply.status.OPEN')}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Mandatory HITL "ACTUALIZAR" Commit Gate */}
                        {canMutate && (
                            <form
                                onSubmit={handleCommit}
                                autoComplete="off"
                                spellCheck={false}
                                className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21 space-y-fib-13"
                            >
                                <label
                                    htmlFor={`${uid}-hitl-keyword`}
                                    className="block text-[15px] font-bold text-[#0F172A] dark:text-[#F3F4F6]"
                                >
                                    {t('supply.reconciler.keyword_label')}{' '}
                                    <span className="font-mono text-[#7C3F0E] dark:text-[#C68346] select-text">
                                        ACTUALIZAR
                                    </span>
                                </label>
                                <input
                                    id={`${uid}-hitl-keyword`}
                                    type="text"
                                    value={keywordInput}
                                    onChange={(e) => setKeywordInput(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="ACTUALIZAR"
                                    className="w-full min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[16px] tracking-widest uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                                <button
                                    type="submit"
                                    disabled={!isKeywordValid || committing}
                                    className={cn(
                                        'w-full min-h-[52px] px-fib-21 text-[16px] font-bold border rounded-none shadow-none flex items-center justify-center gap-fib-8 transition-colors',
                                        isKeywordValid && !committing
                                            ? 'bg-[#C68346] border-[#C68346] text-[#000000] cursor-pointer hover:opacity-90'
                                            : 'bg-[#E2E8F0] dark:bg-[#12151C] border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] cursor-not-allowed'
                                    )}
                                >
                                    {committing && (
                                        <M3CircularProgress
                                            size={18}
                                            ariaLabel={t('supply.reconciler.commit_button')}
                                        />
                                    )}
                                    <span>{t('supply.reconciler.commit_button')}</span>
                                </button>
                            </form>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
};

export default ReconciliationHitlDrawer;
