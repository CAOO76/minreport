import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import { formatRut } from '../../../utils/rut';
import {
    formatClp,
    type PurchaseLineDestination,
    type ReceiptAnalysisDraft,
    type SiiDteType,
    type SupplyPurchaseLineDraft,
} from '../types';

export type HeaderProposalFieldKey =
    | 'supplierTaxId'
    | 'supplierName'
    | 'documentType'
    | 'folio'
    | 'issueDate'
    | 'netAmountClp'
    | 'vatAmountClp'
    | 'totalAmountClp';

export type ProposalDecision = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface PendingAiHeaderProposal {
    fieldKey: HeaderProposalFieldKey;
    labelKey: string;
    currentDisplay: string;
    suggestedDisplay: string;
    rawSuggestedValue: string | number;
    decision: ProposalDecision;
    isDeterministicProtected: boolean;
}

export interface PendingAiLineProposal {
    lineIndex: number;
    currentLine: SupplyPurchaseLineDraft | null;
    suggestedLine: SupplyPurchaseLineDraft;
    decision: ProposalDecision;
}

export interface BuildProposalsInput {
    draft: ReceiptAnalysisDraft;
    supplierTaxId: string;
    supplierName: string;
    documentType: SiiDteType;
    folio: string;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
    lines: SupplyPurchaseLineDraft[];
    defaultDestination: PurchaseLineDestination;
    deterministicLockedFields: ReadonlySet<HeaderProposalFieldKey>;
}

export function buildPendingProposalsFromAiDraft(input: BuildProposalsInput): {
    headerProposals: PendingAiHeaderProposal[];
    lineProposals: PendingAiLineProposal[];
} {
    const {
        draft,
        supplierTaxId,
        supplierName,
        documentType,
        folio,
        issueDate,
        netAmountClp,
        vatAmountClp,
        totalAmountClp,
        lines,
        defaultDestination,
        deterministicLockedFields,
    } = input;

    const headerCandidates: Array<{
        fieldKey: HeaderProposalFieldKey;
        labelKey: string;
        currentVal: string | number;
        suggestedVal: string | number | undefined;
        formatDisplay: (v: string | number) => string;
        hasValue: boolean;
    }> = [
        {
            fieldKey: 'supplierTaxId',
            labelKey: 'supply.scanner.supplier_rut',
            currentVal: supplierTaxId.trim(),
            suggestedVal: draft.supplierTaxId ? formatRut(draft.supplierTaxId) : undefined,
            formatDisplay: (v) => String(v || '—'),
            hasValue: Boolean(draft.supplierTaxId && draft.supplierTaxId.trim()),
        },
        {
            fieldKey: 'supplierName',
            labelKey: 'supply.scanner.supplier_name',
            currentVal: supplierName.trim(),
            suggestedVal: draft.supplierName?.trim() || undefined,
            formatDisplay: (v) => String(v || '—'),
            hasValue: Boolean(draft.supplierName && draft.supplierName.trim()),
        },
        {
            fieldKey: 'documentType',
            labelKey: 'supply.scanner.dte_type',
            currentVal: documentType,
            suggestedVal: draft.documentType,
            formatDisplay: (v) => `DTE ${v}`,
            hasValue: draft.documentType !== undefined,
        },
        {
            fieldKey: 'folio',
            labelKey: 'supply.scanner.folio',
            currentVal: folio.trim(),
            suggestedVal: draft.folio?.trim() || undefined,
            formatDisplay: (v) => String(v || '—'),
            hasValue: Boolean(draft.folio && String(draft.folio).trim()),
        },
        {
            fieldKey: 'issueDate',
            labelKey: 'supply.scanner.issue_date',
            currentVal: issueDate,
            suggestedVal: draft.issueDate ? draft.issueDate.slice(0, 10) : undefined,
            formatDisplay: (v) => String(v || '—'),
            hasValue: Boolean(draft.issueDate && draft.issueDate.trim()),
        },
        {
            fieldKey: 'netAmountClp',
            labelKey: 'supply.scanner.net_clp',
            currentVal: netAmountClp,
            suggestedVal: typeof draft.netAmountClp === 'number' ? draft.netAmountClp : undefined,
            formatDisplay: (v) => formatClp(Number(v)),
            hasValue: typeof draft.netAmountClp === 'number' && draft.netAmountClp > 0,
        },
        {
            fieldKey: 'vatAmountClp',
            labelKey: 'supply.scanner.vat_clp',
            currentVal: vatAmountClp,
            suggestedVal: typeof draft.vatAmountClp === 'number' ? draft.vatAmountClp : undefined,
            formatDisplay: (v) => formatClp(Number(v)),
            hasValue: typeof draft.vatAmountClp === 'number' && draft.vatAmountClp > 0,
        },
        {
            fieldKey: 'totalAmountClp',
            labelKey: 'supply.scanner.total_clp',
            currentVal: totalAmountClp,
            suggestedVal:
                typeof draft.totalAmountClp === 'number' ? draft.totalAmountClp : undefined,
            formatDisplay: (v) => formatClp(Number(v)),
            hasValue: typeof draft.totalAmountClp === 'number' && draft.totalAmountClp > 0,
        },
    ];

    const headerProposals: PendingAiHeaderProposal[] = [];
    for (const cand of headerCandidates) {
        if (!cand.hasValue || cand.suggestedVal === undefined) continue;
        if (String(cand.currentVal) === String(cand.suggestedVal)) continue;
        const isDeterministicProtected = deterministicLockedFields.has(cand.fieldKey);
        headerProposals.push({
            fieldKey: cand.fieldKey,
            labelKey: cand.labelKey,
            currentDisplay: cand.formatDisplay(cand.currentVal),
            suggestedDisplay: cand.formatDisplay(cand.suggestedVal),
            rawSuggestedValue: cand.suggestedVal,
            decision: isDeterministicProtected ? 'REJECTED' : 'PENDING',
            isDeterministicProtected,
        });
    }

    const lineProposals: PendingAiLineProposal[] = (Array.isArray(draft.lines) ? draft.lines : []).map(
        (line, idx) => ({
            lineIndex: idx,
            currentLine:
                lines[idx] && (lines[idx].rawDescription.trim() || lines[idx].subtotalClp > 0)
                    ? lines[idx]
                    : null,
            suggestedLine: {
                ...line,
                lineId:
                    line.lineId ||
                    `pl_ai_${idx}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                destination: line.destination || defaultDestination,
            },
            decision: 'PENDING',
        })
    );

    return { headerProposals, lineProposals };
}

export function normalizeAcceptedHeaderValue(
    fieldKey: HeaderProposalFieldKey,
    raw: string | number
): string | number {
    if (fieldKey === 'supplierTaxId') return formatRut(String(raw));
    if (fieldKey === 'issueDate') return String(raw).slice(0, 10);
    if (
        fieldKey === 'documentType' ||
        fieldKey === 'netAmountClp' ||
        fieldKey === 'vatAmountClp' ||
        fieldKey === 'totalAmountClp'
    ) {
        return Number(raw) || 0;
    }
    return String(raw);
}

export interface ReceiptAiProposalsPanelProps {
    headerProposals: PendingAiHeaderProposal[];
    lineProposals: PendingAiLineProposal[];
    pendingCount: number;
    onDecideHeader: (fieldKey: HeaderProposalFieldKey, decision: 'ACCEPTED' | 'REJECTED') => void;
    onDecideLine: (lineIndex: number, decision: 'ACCEPTED' | 'REJECTED') => void;
}

export const ReceiptAiProposalsPanel: React.FC<ReceiptAiProposalsPanelProps> = ({
    headerProposals,
    lineProposals,
    pendingCount,
    onDecideHeader,
    onDecideLine,
}) => {
    const { t } = useTranslation();

    if (headerProposals.length === 0 && lineProposals.length === 0) {
        return null;
    }

    return (
        <section
            data-testid="ai-hitl-proposals-panel"
            aria-label={t('supply.scanner.ai_proposals_title')}
            className={cn(
                'border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] pl-fib-13 py-fib-13 space-y-fib-13 rounded-none shadow-none',
                pendingCount > 0 ? 'border-l-[#C68346]' : 'border-l-[#00AEEF]'
            )}
        >
            <div className="flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 text-[15px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                    <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">
                        smart_toy
                    </span>
                    <span>{t('supply.scanner.ai_proposals_title')}</span>
                </div>
                <span
                    className={cn(
                        'text-[14px] font-semibold tabular-nums',
                        pendingCount > 0
                            ? 'text-[#9A5B21] dark:text-[#C68346]'
                            : 'text-[#0369A1] dark:text-[#00AEEF]'
                    )}
                >
                    {pendingCount} {t('supply.scanner.ai_proposals_pending_count')}
                </span>
            </div>

            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                {headerProposals.map((prop) => (
                    <div
                        key={prop.fieldKey}
                        data-testid={`ai-proposal-header-${prop.fieldKey}`}
                        className="py-fib-8 flex flex-wrap items-center justify-between gap-fib-13"
                    >
                        <div className="min-w-0 flex-1 space-y-fib-8">
                            <div className="text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                                {t(prop.labelKey)}
                            </div>
                            <div className="font-mono text-[15px] tabular-nums flex flex-wrap items-center gap-fib-8">
                                <span className="text-[#475569] dark:text-[#8A93A6] select-text">
                                    [{prop.currentDisplay}]
                                </span>
                                <span className="text-[#C68346]" aria-hidden="true">
                                    ➔
                                </span>
                                <span
                                    className={cn(
                                        'font-semibold select-text',
                                        prop.decision === 'ACCEPTED'
                                            ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                            : prop.isDeterministicProtected
                                              ? 'text-[#475569] dark:text-[#5A6072] line-through'
                                              : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                    )}
                                >
                                    [{prop.suggestedDisplay}]
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-fib-8 shrink-0">
                            {prop.isDeterministicProtected ? (
                                <span className="inline-flex items-center gap-fib-8 text-[14px] font-semibold text-[#0369A1] dark:text-[#00AEEF]">
                                    <span className="material-symbols-outlined text-[18px]">lock</span>
                                    <span>{t('supply.scanner.ai_proposal_locked_det')}</span>
                                </span>
                            ) : prop.decision === 'PENDING' ? (
                                <>
                                    <button
                                        type="button"
                                        data-testid={`ai-accept-header-${prop.fieldKey}`}
                                        onClick={() => onDecideHeader(prop.fieldKey, 'ACCEPTED')}
                                        aria-label={`${t('supply.scanner.ai_accept_proposal')}: ${t(prop.labelKey)}`}
                                        title={`${t('supply.scanner.ai_accept_proposal')}: ${t(prop.labelKey)}`}
                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            check
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        data-testid={`ai-reject-header-${prop.fieldKey}`}
                                        onClick={() => onDecideHeader(prop.fieldKey, 'REJECTED')}
                                        aria-label={`${t('supply.scanner.ai_reject_proposal')}: ${t(prop.labelKey)}`}
                                        title={`${t('supply.scanner.ai_reject_proposal')}: ${t(prop.labelKey)}`}
                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            close
                                        </span>
                                    </button>
                                </>
                            ) : (
                                <span
                                    className={cn(
                                        'text-[14px] font-semibold',
                                        prop.decision === 'ACCEPTED'
                                            ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                    )}
                                >
                                    {prop.decision === 'ACCEPTED'
                                        ? t('supply.scanner.ai_proposal_accepted')
                                        : t('supply.scanner.ai_proposal_rejected')}
                                </span>
                            )}
                        </div>
                    </div>
                ))}

                {lineProposals.map((lp) => {
                    const currentSummary = lp.currentLine
                        ? `${lp.currentLine.rawDescription} · ${lp.currentLine.qty} ${lp.currentLine.unitSi} · ${formatClp(lp.currentLine.subtotalClp)}`
                        : '—';
                    const suggestedSummary = `${lp.suggestedLine.rawDescription} · ${lp.suggestedLine.qty} ${lp.suggestedLine.unitSi} · ${formatClp(lp.suggestedLine.subtotalClp)}`;
                    return (
                        <div
                            key={`line-prop-${lp.lineIndex}`}
                            data-testid={`ai-proposal-line-${lp.lineIndex}`}
                            className="py-fib-8 flex flex-wrap items-center justify-between gap-fib-13"
                        >
                            <div className="min-w-0 flex-1 space-y-fib-8">
                                <div className="font-mono text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                                    Ítem #{lp.lineIndex + 1}
                                </div>
                                <div className="font-mono text-[15px] tabular-nums flex flex-wrap items-center gap-fib-8">
                                    <span className="text-[#475569] dark:text-[#8A93A6] select-text">
                                        [{currentSummary}]
                                    </span>
                                    <span className="text-[#C68346]" aria-hidden="true">
                                        ➔
                                    </span>
                                    <span
                                        className={cn(
                                            'font-semibold select-text',
                                            lp.decision === 'ACCEPTED'
                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        [{suggestedSummary}]
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-fib-8 shrink-0">
                                {lp.decision === 'PENDING' ? (
                                    <>
                                        <button
                                            type="button"
                                            data-testid={`ai-accept-line-${lp.lineIndex}`}
                                            onClick={() => onDecideLine(lp.lineIndex, 'ACCEPTED')}
                                            aria-label={`${t('supply.scanner.ai_accept_proposal')}: SKU #${lp.lineIndex + 1}`}
                                            title={`${t('supply.scanner.ai_accept_proposal')}: SKU #${lp.lineIndex + 1}`}
                                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">
                                                check
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            data-testid={`ai-reject-line-${lp.lineIndex}`}
                                            onClick={() => onDecideLine(lp.lineIndex, 'REJECTED')}
                                            aria-label={`${t('supply.scanner.ai_reject_proposal')}: SKU #${lp.lineIndex + 1}`}
                                            title={`${t('supply.scanner.ai_reject_proposal')}: SKU #${lp.lineIndex + 1}`}
                                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">
                                                close
                                            </span>
                                        </button>
                                    </>
                                ) : (
                                    <span
                                        className={cn(
                                            'text-[14px] font-semibold',
                                            lp.decision === 'ACCEPTED'
                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                        )}
                                    >
                                        {lp.decision === 'ACCEPTED'
                                            ? t('supply.scanner.ai_proposal_accepted')
                                            : t('supply.scanner.ai_proposal_rejected')}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

export default ReceiptAiProposalsPanel;
