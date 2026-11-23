import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import { formatRut, validateRut } from '../../../utils/rut';
import { supplyApi } from '../services/supplyApi';
import {
    PAYMENT_METHODS,
    SII_DTE_TYPES,
    formatCasTelemetry,
    formatClp,
    parseLocalTedOrDteXml,
    type CasEvidenceRef,
    type FulfillmentAllocationDraft,
    type PaymentMethod,
    type ProcurementBucket,
    type PurchaseLineDestination,
    type PurchaseMode,
    type SiiDteType,
    type SupplyPurchaseDraft,
    type SupplyPurchaseLineDraft,
    type SupplySite,
} from '../types';
import { ReceiptMediaCaptureBar } from './ReceiptMediaCaptureBar';
import {
    ReceiptAiProposalsPanel,
    buildPendingProposalsFromAiDraft,
    normalizeAcceptedHeaderValue,
    type HeaderProposalFieldKey,
    type PendingAiHeaderProposal,
    type PendingAiLineProposal,
} from './ReceiptAiProposalsPanel';
import { ReceiptLinesEditor, createEmptyLine, mapBucketToCategory } from './ReceiptLinesEditor';

export interface ReceiptScannerModalProps {
    open: boolean;
    tenantId?: string;
    sites: SupplySite[];
    defaultSiteId?: string;
    defaultBucket?: ProcurementBucket | null;
    isExecOwner?: boolean;
    isOnline: boolean;
    onClose: () => void;
    onSendToReconciler: (draft: SupplyPurchaseDraft) => void;
    onCommitted: (queuedOffline: boolean) => void;
}

interface ReceiptHeaderState {
    siteId: string;
    purchaseMode: PurchaseMode;
    defaultDestination: PurchaseLineDestination;
    paymentMethod: PaymentMethod;
    supplierTaxId: string;
    supplierName: string;
    documentType: SiiDteType;
    folio: string;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
}

const createInitialHeaderState = (isExecOwner: boolean, defaultSiteId: string | undefined, sites: SupplySite[]): ReceiptHeaderState => ({
    siteId: defaultSiteId || sites[0]?.siteId || 'site-main',
    purchaseMode: isExecOwner ? 'DIRECT_AUTONOMOUS' : 'REQUISITION_FULFILLMENT',
    defaultDestination: isExecOwner ? 'STOCK_IN_WAREHOUSE' : 'STOCK_IN_TRANSIT',
    paymentMethod: isExecOwner ? 'REEMBOLSO_GERENCIA' : 'FONDO_POR_RENDIR',
    supplierTaxId: '',
    supplierName: '',
    documentType: 39,
    folio: '',
    issueDate: new Date().toISOString().slice(0, 10),
    netAmountClp: 0,
    vatAmountClp: 0,
    totalAmountClp: 0,
});

const parsePositiveFolioNumber = (rawFolio: string): number => {
    const digits = String(rawFolio || '').replace(/\D/g, '');
    const parsed = digits ? Number(digits) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const ReceiptScannerModal: React.FC<ReceiptScannerModalProps> = ({
    open, tenantId, sites, defaultSiteId, defaultBucket, isExecOwner = false, isOnline, onClose, onSendToReconciler, onCommitted,
}) => {
    const { t, i18n } = useTranslation();
    const uid = useId();
    const [header, setHeader] = useState<ReceiptHeaderState>(() => createInitialHeaderState(isExecOwner, defaultSiteId, sites));
    const [tedRawXml, setTedRawXml] = useState('');
    const [xmlDteContent, setXmlDteContent] = useState('');
    const [evidenceCasRef, setEvidenceCasRef] = useState<CasEvidenceRef | undefined>(undefined);
    const [lines, setLines] = useState<SupplyPurchaseLineDraft[]>(() => [
        createEmptyLine(isExecOwner ? 'STOCK_IN_WAREHOUSE' : 'STOCK_IN_TRANSIT', mapBucketToCategory(defaultBucket)),
    ]);
    const [deterministicLockedFields, setDeterministicLockedFields] = useState<Set<HeaderProposalFieldKey>>(() => new Set());
    const [pendingAiHeaderProposals, setPendingAiHeaderProposals] = useState<PendingAiHeaderProposal[]>([]);
    const [pendingAiLineProposals, setPendingAiLineProposals] = useState<PendingAiLineProposal[]>([]);
    const [digesting, setDigesting] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [showTedInput, setShowTedInput] = useState(false);
    const [hitlOpen, setHitlOpen] = useState(false);
    const [statusNotice, setStatusNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    const resetModalState = useCallback(() => {
        const initial = createInitialHeaderState(isExecOwner, defaultSiteId, sites);
        setHeader(initial);
        setTedRawXml('');
        setXmlDteContent('');
        setEvidenceCasRef(undefined);
        setLines([createEmptyLine(initial.defaultDestination, mapBucketToCategory(defaultBucket))]);
        setDeterministicLockedFields(new Set());
        setPendingAiHeaderProposals([]);
        setPendingAiLineProposals([]);
        setDigesting(false);
        setAnalyzing(false);
        setCommitting(false);
        setShowTedInput(false);
        setHitlOpen(false);
        setStatusNotice(null);
    }, [defaultBucket, defaultSiteId, isExecOwner, sites]);

    useEffect(() => { resetModalState(); }, [open, resetModalState]);
    const handleCloseModal = useCallback(() => { resetModalState(); onClose(); }, [onClose, resetModalState]);
    const patchHeader = useCallback((patch: Partial<ReceiptHeaderState>) => setHeader((prev) => ({ ...prev, ...patch })), []);

    const validLines = useMemo(() => lines.filter((l) => l.rawDescription.trim().length > 0 && Number.isFinite(l.subtotalClp) && l.subtotalClp > 0), [lines]);
    const linesSumClp = useMemo(() => lines.reduce((acc, l) => acc + (Number.isFinite(l.subtotalClp) ? l.subtotalClp : 0), 0), [lines]);
    const arithmeticDelta = useMemo(() => (header.totalAmountClp <= 0 && linesSumClp <= 0 ? 0 : Math.round(linesSumClp - header.totalAmountClp)), [linesSumClp, header.totalAmountClp]);
    const hasArithmeticMismatch = (header.totalAmountClp > 0 || linesSumClp > 0) && Math.abs(arithmeticDelta) > 2;
    const hasAssetWithoutInvoice = lines.some((l) => l.destination === 'CAPEX_ASSET') && header.documentType !== 33 && header.documentType !== 34;
    const rutValidationState = !header.supplierTaxId.trim() ? 'EMPTY' : validateRut(header.supplierTaxId.trim()) ? 'VALID' : 'INVALID';
    const pendingAiCount = useMemo(
        () => pendingAiHeaderProposals.filter((p) => p.decision === 'PENDING').length + pendingAiLineProposals.filter((p) => p.decision === 'PENDING').length,
        [pendingAiHeaderProposals, pendingAiLineProposals]
    );

    const notDeclaredPlaceholder = t('supply.common.not_declared');
    const submitValidationErrors = useMemo<string[]>(() => {
        const errs: string[] = [];
        if (rutValidationState !== 'VALID') errs.push(t('supply.scanner.err_rut_invalid'));
        const trimmedName = header.supplierName.trim();
        if (!trimmedName || trimmedName === notDeclaredPlaceholder) errs.push(t('supply.scanner.err_supplier_name_required'));
        if (header.documentType !== 0 && parsePositiveFolioNumber(header.folio) <= 0) errs.push(t('supply.scanner.err_folio_required'));
        if (hasArithmeticMismatch) errs.push(t('supply.scanner.err_arithmetic_mismatch'));
        if (validLines.length === 0) errs.push(t('supply.scanner.err_lines_required'));
        if (pendingAiCount > 0) errs.push(t('supply.scanner.err_pending_ai_proposals'));
        return errs;
    }, [hasArithmeticMismatch, header.documentType, header.folio, header.supplierName, notDeclaredPlaceholder, pendingAiCount, rutValidationState, t, validLines.length]);

    const canSubmit = submitValidationErrors.length === 0 && !digesting && !analyzing && !committing;

    const applyDeterministicHeader = useCallback((fields: Partial<ReceiptHeaderState> & { deriveTaxIfMissing?: boolean }) => {
        const locked: HeaderProposalFieldKey[] = [];
        const patch: Partial<ReceiptHeaderState> = {};
        if (fields.supplierTaxId) { patch.supplierTaxId = formatRut(fields.supplierTaxId); locked.push('supplierTaxId'); }
        if (fields.supplierName) { patch.supplierName = fields.supplierName; locked.push('supplierName'); }
        if (fields.documentType !== undefined) { patch.documentType = fields.documentType; locked.push('documentType'); }
        if (fields.folio) { patch.folio = fields.folio; locked.push('folio'); }
        if (fields.issueDate) { patch.issueDate = fields.issueDate.slice(0, 10); locked.push('issueDate'); }
        if (typeof fields.netAmountClp === 'number') { patch.netAmountClp = fields.netAmountClp; locked.push('netAmountClp'); }
        if (typeof fields.vatAmountClp === 'number') { patch.vatAmountClp = fields.vatAmountClp; locked.push('vatAmountClp'); }
        if (typeof fields.totalAmountClp === 'number') {
            patch.totalAmountClp = fields.totalAmountClp;
            locked.push('totalAmountClp');
            if (fields.deriveTaxIfMissing) {
                locked.push('netAmountClp', 'vatAmountClp');
                const isTaxed = fields.documentType === 33 || fields.documentType === 39;
                patch.netAmountClp = isTaxed ? Math.round(fields.totalAmountClp / 1.19) : fields.totalAmountClp;
                patch.vatAmountClp = isTaxed ? fields.totalAmountClp - (patch.netAmountClp ?? 0) : 0;
            }
        }
        if (Object.keys(patch).length > 0) patchHeader(patch);
        if (locked.length > 0) setDeterministicLockedFields((prev) => new Set([...prev, ...locked]));
    }, [patchHeader]);

    const applyParsedTedHeader = useCallback((rawXml: string) => {
        const parsed = parseLocalTedOrDteXml(rawXml);
        if (!parsed) return;
        applyDeterministicHeader({ ...parsed, deriveTaxIfMissing: true });
        if (parsed.firstItem) {
            setLines((prev) =>
                prev.length === 1 && !prev[0].rawDescription.trim()
                    ? [{ ...prev[0], rawDescription: parsed.firstItem || '', unitPriceClp: parsed.totalAmountClp || prev[0].unitPriceClp, subtotalClp: parsed.totalAmountClp || prev[0].subtotalClp }]
                    : prev
            );
        }
    }, [applyDeterministicHeader]);

    const handleHeaderProposalDecision = useCallback((fieldKey: HeaderProposalFieldKey, decision: 'ACCEPTED' | 'REJECTED') => {
        const target = pendingAiHeaderProposals.find((p) => p.fieldKey === fieldKey);
        if (!target || (decision === 'ACCEPTED' && target.isDeterministicProtected)) return;
        if (decision === 'ACCEPTED') {
            patchHeader({ [fieldKey]: normalizeAcceptedHeaderValue(fieldKey, target.rawSuggestedValue) } as Partial<ReceiptHeaderState>);
        }
        setPendingAiHeaderProposals((prev) => prev.map((p) => (p.fieldKey === fieldKey ? { ...p, decision } : p)));
    }, [patchHeader, pendingAiHeaderProposals]);

    const handleLineProposalDecision = useCallback((lineIndex: number, decision: 'ACCEPTED' | 'REJECTED') => {
        const target = pendingAiLineProposals.find((p) => p.lineIndex === lineIndex);
        if (!target) return;
        if (decision === 'ACCEPTED') {
            setLines((prev) => {
                if (prev.length === 1 && !prev[0].rawDescription.trim() && prev[0].subtotalClp === 0) return [target.suggestedLine];
                const existingIdx = prev.findIndex((l) => l.lineId === target.suggestedLine.lineId);
                return existingIdx >= 0 ? prev.map((l, idx) => (idx === existingIdx ? target.suggestedLine : l)) : [...prev, target.suggestedLine];
            });
        }
        setPendingAiLineProposals((prev) => prev.map((p) => (p.lineIndex === lineIndex ? { ...p, decision } : p)));
    }, [pendingAiLineProposals]);

    const handleAnalyzeDocument = async () => {
        if (!isOnline) {
            setStatusNotice({ tone: 'copper', text: t('supply.scanner.offline_queued_notice') });
            return;
        }
        setAnalyzing(true);
        setStatusNotice(null);
        try {
            const rawLang = String(i18n.language || 'es').slice(0, 2).toLowerCase();
            const locale: 'es' | 'en' | 'pt' = rawLang === 'en' || rawLang === 'pt' ? rawLang : 'es';
            const draft = await supplyApi.analyzeReceipt(
                { siteId: header.siteId, purchaseMode: header.purchaseMode, defaultDestination: header.defaultDestination, evidenceCasRef, clientOriginalBytes: evidenceCasRef?.originalBytes, tedRawXml: tedRawXml.trim() || undefined, xmlDteContent: xmlDteContent.trim() || undefined, locale },
                tenantId
            );
            if (draft.evidenceCasRef) setEvidenceCasRef(draft.evidenceCasRef);
            if (draft.source === 'XML_DTE' || draft.source === 'TED_XML') {
                applyDeterministicHeader(draft);
                if (Array.isArray(draft.lines) && draft.lines.length > 0) {
                    setLines(draft.lines.map((l) => ({ ...l, lineId: l.lineId || `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, destination: l.destination || header.defaultDestination })));
                }
                setPendingAiHeaderProposals([]);
                setPendingAiLineProposals([]);
                setStatusNotice({ tone: draft.arithmeticMismatch ? 'copper' : 'cyan', text: draft.arithmeticMismatch ? t('supply.scanner.arithmetic_mismatch') : t('supply.scanner.arithmetic_ok') });
            } else {
                const proposals = buildPendingProposalsFromAiDraft({ draft, ...header, lines, deterministicLockedFields });
                setPendingAiHeaderProposals(proposals.headerProposals);
                setPendingAiLineProposals(proposals.lineProposals);
                setStatusNotice({ tone: 'cyan', text: t('supply.scanner.ai_proposals_ready_notice') });
            }
        } catch (err) {
            setStatusNotice({ tone: 'copper', text: err instanceof Error ? err.message : 'ANALYZE_ERROR' });
        } finally {
            setAnalyzing(false);
        }
    };

    const buildCurrentDraft = useCallback((): SupplyPurchaseDraft => ({
        siteId: header.siteId, purchaseMode: header.purchaseMode, supplierTaxId: header.supplierTaxId.trim(), supplierName: header.supplierName.trim(), documentType: header.documentType, folio: header.folio.trim(), issueDate: header.issueDate, netAmountClp: header.netAmountClp, vatAmountClp: header.vatAmountClp, totalAmountClp: header.totalAmountClp || linesSumClp, paymentMethod: header.paymentMethod, evidenceCasRef, tedRawXml: tedRawXml.trim() || undefined, arithmeticMismatch: hasArithmeticMismatch, arithmeticDeltaClp: arithmeticDelta, lines: validLines,
    }), [arithmeticDelta, evidenceCasRef, hasArithmeticMismatch, header, linesSumClp, tedRawXml, validLines]);

    const handleDirectHitlCommit = async () => {
        if (!canSubmit) { setHitlOpen(false); return; }
        const draft = buildCurrentDraft();
        const allocations: FulfillmentAllocationDraft[] = draft.lines.map((l) => ({
            purchaseLineId: l.purchaseLineId || l.lineId, allocationKind: l.matchedReqLineId ? 'REQUISITION_MATCH' : 'UNSOLICITED_PURCHASE', requisitionId: l.matchedReqId || null, requisitionLineId: l.matchedReqLineId || null, qtyAllocated: Math.max(0.0001, Number(l.qtyPurchased ?? l.qty) || 1), unitSi: l.unitSi, destination: l.destination, resultingRequisitionLineStatus: l.matchedReqLineId ? 'FULFILLED' : null,
        }));
        setCommitting(true);
        try {
            const res = await supplyApi.commitPurchase({ draft, allocations, confirmationKeyword: 'ACTUALIZAR' }, tenantId);
            setHitlOpen(false);
            onCommitted(Boolean(res.queuedOffline));
            handleCloseModal();
        } catch (err) {
            setHitlOpen(false);
            setStatusNotice({ tone: 'copper', text: err instanceof Error ? err.message : 'COMMIT_ERROR' });
        } finally {
            setCommitting(false);
        }
    };

    const updateLine = (lineId: string, patch: Partial<SupplyPurchaseLineDraft>) => {
        setLines((prev) => prev.map((l) => {
            if (l.lineId !== lineId) return l;
            const next = { ...l, ...patch };
            if ('qty' in patch || 'unitPriceClp' in patch) next.subtotalClp = Math.round((Number(next.qty) || 0) * (Number(next.unitPriceClp) || 0));
            return next;
        }));
    };

    const casTelemetryLine = useMemo(() => formatCasTelemetry(evidenceCasRef), [evidenceCasRef]);
    const hitlDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        const draft = buildCurrentDraft();
        const items: HitlComparisonDiffItem[] = [
            { field: t('supply.scanner.mode_label'), current: 'DRAFT', suggested: `${t(`supply.purchase_modes.${draft.purchaseMode}`)} · DTE ${draft.documentType} #${draft.folio || '—'}` },
            { field: t('supply.scanner.total_clp'), current: formatClp(0), suggested: `${formatClp(draft.totalAmountClp)} (${draft.lines.length} SKU)` },
        ];
        if (casTelemetryLine) items.push({ field: t('supply.scanner.cas_telemetry'), current: 'RAW', suggested: casTelemetryLine });
        return items;
    }, [buildCurrentDraft, casTelemetryLine, t]);

    if (!open) return null;

    const inputBase = 'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';
    const labelBase = 'block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]';

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-0 sm:p-fib-21 select-none overflow-y-auto" role="dialog" aria-modal="true" aria-label={t('supply.scanner.title')}>
            <div className="w-full max-w-5xl max-h-[100dvh] sm:max-h-[92vh] flex flex-col bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden">
                <ReceiptMediaCaptureBar
                    open={open} tenantId={tenantId} isExecOwner={isExecOwner} isDirectAutonomous={header.purchaseMode === 'DIRECT_AUTONOMOUS'}
                    digesting={digesting} analyzing={analyzing} showTedInput={showTedInput} tedRawXml={tedRawXml} evidenceCasRef={evidenceCasRef} statusNotice={statusNotice}
                    onDigestingChange={setDigesting} onToggleTedInput={() => setShowTedInput((prev) => !prev)}
                    onTedRawXmlChange={(xml) => { setTedRawXml(xml); setShowTedInput(true); applyParsedTedHeader(xml); }}
                    onXmlDteIngested={(xmlText) => { setXmlDteContent(xmlText); setTedRawXml(xmlText); setShowTedInput(true); applyParsedTedHeader(xmlText); }}
                    onEvidenceDigested={setEvidenceCasRef} onStatusNotice={setStatusNotice}
                    onAnalyze={() => void handleAnalyzeDocument()} onClose={handleCloseModal}
                />

                <form autoComplete="off" spellCheck={false} onSubmit={(e) => { e.preventDefault(); if (canSubmit) setHitlOpen(true); }} className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                    <ReceiptAiProposalsPanel headerProposals={pendingAiHeaderProposals} lineProposals={pendingAiLineProposals} pendingCount={pendingAiCount} onDecideHeader={handleHeaderProposalDecision} onDecideLine={handleLineProposalDecision} />

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-fib-13">
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-mode`} className={labelBase}>{t('supply.scanner.mode_label')}</label>
                            <select id={`${uid}-mode`} value={header.purchaseMode} onChange={(e) => patchHeader({ purchaseMode: e.target.value as PurchaseMode })} className={inputBase}>
                                <option value="REQUISITION_FULFILLMENT">{t('supply.purchase_modes.REQUISITION_FULFILLMENT')}</option>
                                <option value="DIRECT_AUTONOMOUS">{t('supply.purchase_modes.DIRECT_AUTONOMOUS')}</option>
                                <option value="MIXED_FULFILLMENT_AND_DIRECT">{t('supply.purchase_modes.MIXED_FULFILLMENT_AND_DIRECT')}</option>
                            </select>
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-dest`} className={labelBase}>{t('supply.scanner.destination_label')}</label>
                            <select id={`${uid}-dest`} value={header.defaultDestination} onChange={(e) => { const nextDest = e.target.value as PurchaseLineDestination; patchHeader({ defaultDestination: nextDest }); setLines((prev) => prev.map((l) => ({ ...l, destination: nextDest }))); }} className={inputBase}>
                                <option value="STOCK_IN_TRANSIT">{t('supply.destinations.STOCK_IN_TRANSIT')}</option>
                                <option value="STOCK_IN_WAREHOUSE">{t('supply.destinations.STOCK_IN_WAREHOUSE')}</option>
                                <option value="CAPEX_ASSET">{t('supply.destinations.CAPEX_ASSET')}</option>
                                <option value="DIRECT_EXPENSE">{t('supply.destinations.DIRECT_EXPENSE')}</option>
                            </select>
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-payment`} className={labelBase}>{t('supply.scanner.payment_label')}</label>
                            <select id={`${uid}-payment`} value={header.paymentMethod} onChange={(e) => patchHeader({ paymentMethod: e.target.value as PaymentMethod })} className={inputBase}>
                                {PAYMENT_METHODS.map((pm) => <option key={pm} value={pm}>{t(`supply.payments.${pm}`)}</option>)}
                            </select>
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-site`} className={labelBase}>{t('supply.common.site_selector')}</label>
                            <select id={`${uid}-site`} value={header.siteId} onChange={(e) => patchHeader({ siteId: e.target.value })} className={inputBase}>
                                {sites.length > 0 ? sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>) : <option value="site-main">FAENA-01</option>}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
                        <div className="space-y-fib-8">
                            <div className="flex items-center justify-between">
                                <label htmlFor={`${uid}-rut`} className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">{t('supply.scanner.supplier_rut')}</label>
                                {rutValidationState === 'VALID' && <span className="font-mono text-microcopy text-[#0369A1] dark:text-[#00AEEF]">{t('supply.scanner.rut_valid')}</span>}
                                {rutValidationState === 'INVALID' && <span className="font-mono text-microcopy text-[#9A5B21] dark:text-[#C68346]">{t('supply.scanner.rut_invalid')}</span>}
                            </div>
                            <input id={`${uid}-rut`} type="text" value={header.supplierTaxId} onChange={(e) => patchHeader({ supplierTaxId: e.target.value })} onBlur={() => { if (header.supplierTaxId.trim()) patchHeader({ supplierTaxId: formatRut(header.supplierTaxId) }); }} autoComplete="off" spellCheck={false} placeholder="76.000.000-0" className={cn('w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text', rutValidationState === 'INVALID' ? 'border-[#C68346]' : 'border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346]')} />
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-supplier`} className={labelBase}>{t('supply.scanner.supplier_name')}</label>
                            <input id={`${uid}-supplier`} type="text" value={header.supplierName} onChange={(e) => patchHeader({ supplierName: e.target.value })} autoComplete="off" spellCheck={false} className={`${inputBase} select-text`} />
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-dte`} className={labelBase}>{t('supply.scanner.dte_type')}</label>
                            <select id={`${uid}-dte`} value={header.documentType} onChange={(e) => patchHeader({ documentType: Number(e.target.value) as SiiDteType })} className={`${inputBase} font-mono tabular-nums`}>
                                {SII_DTE_TYPES.map((dte) => <option key={dte} value={dte}>{t(`supply.dte.${dte}`)}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-fib-8">
                            <div className="space-y-fib-8">
                                <label htmlFor={`${uid}-folio`} className={labelBase}>{t('supply.scanner.folio')}</label>
                                <input id={`${uid}-folio`} type="text" value={header.folio} onChange={(e) => patchHeader({ folio: e.target.value })} autoComplete="off" spellCheck={false} className={`${inputBase} font-mono tabular-nums select-text`} />
                            </div>
                            <div className="space-y-fib-8">
                                <label htmlFor={`${uid}-date`} className={labelBase}>{t('supply.scanner.issue_date')}</label>
                                <input id={`${uid}-date`} type="date" value={header.issueDate} onChange={(e) => patchHeader({ issueDate: e.target.value })} autoComplete="off" spellCheck={false} className="w-full min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text" />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-net`} className={labelBase}>{t('supply.scanner.net_clp')}</label>
                            <input id={`${uid}-net`} type="number" min={0} value={header.netAmountClp} onChange={(e) => patchHeader({ netAmountClp: Number(e.target.value) || 0 })} autoComplete="off" spellCheck={false} className={`${inputBase} font-mono tabular-nums select-text`} />
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-vat`} className={labelBase}>{t('supply.scanner.vat_clp')}</label>
                            <input id={`${uid}-vat`} type="number" min={0} value={header.vatAmountClp} onChange={(e) => patchHeader({ vatAmountClp: Number(e.target.value) || 0 })} autoComplete="off" spellCheck={false} className={`${inputBase} font-mono tabular-nums select-text`} />
                        </div>
                        <div className="space-y-fib-8">
                            <label htmlFor={`${uid}-total`} className={labelBase}>{t('supply.scanner.total_clp')}</label>
                            <input id={`${uid}-total`} type="number" min={0} value={header.totalAmountClp} onChange={(e) => { const total = Number(e.target.value) || 0; const isTaxed = header.documentType === 33 || header.documentType === 39; const net = isTaxed ? Math.round(total / 1.19) : total; patchHeader({ totalAmountClp: total, netAmountClp: net, vatAmountClp: isTaxed ? total - net : 0 }); }} autoComplete="off" spellCheck={false} className={cn('w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border outline-none font-mono text-data-dense tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text', hasArithmeticMismatch ? 'border-[#C68346] text-[#9A5B21] dark:text-[#C68346]' : 'border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346]')} />
                        </div>
                    </div>

                    {hasArithmeticMismatch && (
                        <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 flex items-center justify-between gap-fib-13 font-mono text-data-dense tabular-nums text-[#9A5B21] dark:text-[#C68346]">
                            <div className="flex items-center gap-fib-8"><span className="material-symbols-outlined text-[18px]">warning</span><span>{t('supply.scanner.arithmetic_mismatch')}</span></div>
                            <span>{formatClp(linesSumClp)} ≠ {formatClp(header.totalAmountClp)} (Δ {formatClp(arithmeticDelta)})</span>
                        </div>
                    )}
                    {hasAssetWithoutInvoice && (
                        <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 flex items-center gap-fib-8 font-mono text-data-dense tabular-nums text-[#9A5B21] dark:text-[#C68346]">
                            <span className="material-symbols-outlined text-[18px]">warning</span><span>{t('supply.scanner.asset_no_invoice_warn')}</span>
                        </div>
                    )}

                    <ReceiptLinesEditor lines={lines} documentType={header.documentType} onAddLine={() => setLines((prev) => [...prev, createEmptyLine(header.defaultDestination, mapBucketToCategory(defaultBucket))])} onUpdateLine={updateLine} onRemoveLine={(lineId) => setLines((prev) => prev.filter((item) => item.lineId !== lineId))} />

                    {submitValidationErrors.length > 0 && (
                        <div data-testid="scanner-validation-errors" className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 space-y-fib-8 rounded-none shadow-none">
                            <div className="font-mono text-microcopy uppercase font-bold text-[#9A5B21] dark:text-[#C68346]">{t('supply.scanner.validation_blocked_title')}</div>
                            <ul className="space-y-fib-8 font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                {submitValidationErrors.map((errMsg, i) => <li key={i} className="flex items-center gap-fib-8"><span className="material-symbols-outlined text-[16px] text-[#C68346]">warning</span><span>{errMsg}</span></li>)}
                            </ul>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-fib-13 pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        <div className="font-mono text-data-dense tabular-nums text-[#475569] dark:text-[#8A93A6]">Σ {formatClp(linesSumClp)}</div>
                        <div className="flex flex-wrap items-center gap-fib-13">
                            <button type="button" disabled={!canSubmit} onClick={() => { if (!canSubmit) return; onSendToReconciler(buildCurrentDraft()); handleCloseModal(); }} className="min-h-[48px] px-fib-21 bg-transparent border border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 font-mono text-data-dense font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('supply.scanner.send_to_reconciler')}</button>
                            <button type="submit" disabled={!canSubmit} className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] hover:opacity-90 font-mono text-data-dense font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('supply.scanner.commit_direct')}</button>
                        </div>
                    </div>
                </form>
            </div>

            <HitlConfirmModal open={hitlOpen} title={t('supply.scanner.commit_direct')} description={`${t(`supply.purchase_modes.${header.purchaseMode}`)} · DTE ${header.documentType} #${header.folio || '—'} · ${formatClp(header.totalAmountClp || linesSumClp)}`} keyword="ACTUALIZAR" comparisonDiff={hitlDiff} loading={committing} onConfirm={() => void handleDirectHitlCommit()} onCancel={() => setHitlOpen(false)} />
        </div>
    );
};

export default ReceiptScannerModal;
