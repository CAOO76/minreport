import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMinReportSession } from '../../../context/MinReportSessionContext';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import CopyButton from '../../../components/common/CopyButton';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import { supplyApi } from '../services/supplyApi';
import {
    PAYMENT_METHODS,
    computeRcvDaysRemaining,
    formatCasTelemetry,
    formatClp,
    type PaymentMethod,
    type SiiDocumentRecord,
    type SiiExpenseReport,
    type SiiExpenseReportStatus,
} from '../types';

export interface SiiRendicionesViewProps {
    documents: SiiDocumentRecord[];
    expenseReports: SiiExpenseReport[];
    activeSiteId?: string;
    tenantId?: string;
    actorUid?: string;
    loading: boolean;
    canMutate?: boolean;
    canApproveExpenseReports?: boolean;
    onMutated: () => void;
}

type SiiTab = 'BOLETAS' | 'FACTURAS' | 'ENVELOPES';

export const SiiRendicionesView: React.FC<SiiRendicionesViewProps> = ({
    documents,
    expenseReports,
    activeSiteId,
    tenantId,
    actorUid,
    loading,
    canMutate = true,
    canApproveExpenseReports = false,
    onMutated,
}) => {
    const { t } = useTranslation();
    const { session } = useMinReportSession();
    const uid = useId();
    const [tab, setTab] = useState<SiiTab>('BOLETAS');
    const [searchQuery, setSearchQuery] = useState('');
    const [onlyRcvUrgent, setOnlyRcvUrgent] = useState(false);
    const [queriedRcvDocs, setQueriedRcvDocs] = useState<SiiDocumentRecord[] | null>(null);
    const [queryingRcv, setQueryingRcv] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<SiiDocumentRecord | null>(null);
    const [exporting, setExporting] = useState(false);
    const [showNewEnvelope, setShowNewEnvelope] = useState(false);
    const [envelopeTitle, setEnvelopeTitle] = useState('');
    const [envelopeCostCenter, setEnvelopeCostCenter] = useState('CC-CAMPAMENTO');
    const [holderName, setHolderName] = useState('');
    const [periodLabel, setPeriodLabel] = useState(new Date().toISOString().slice(0, 7));
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('FONDO_POR_RENDIR');
    const [fundAdvanceClp, setFundAdvanceClp] = useState<number>(0);
    const [hitlEnvelopeOpen, setHitlEnvelopeOpen] = useState(false);
    const [creatingEnvelope, setCreatingEnvelope] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{
        report: SiiExpenseReport;
        targetStatus: SiiExpenseReportStatus;
    } | null>(null);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    const effectiveDocuments = queriedRcvDocs ?? documents;
    const resolvedActorUid = actorUid || session?.uid || '';

    useEffect(() => {
        setQueriedRcvDocs(null);
    }, [documents]);

    const boletas = useMemo(
        () =>
            effectiveDocuments.filter(
                (d) => d.documentType === 39 || d.documentType === 41 || d.documentType === 0
            ),
        [effectiveDocuments]
    );

    const facturas = useMemo(
        () =>
            effectiveDocuments.filter(
                (d) =>
                    d.documentType === 33 ||
                    d.documentType === 34 ||
                    d.documentType === 52 ||
                    d.documentType === 61
            ),
        [effectiveDocuments]
    );

    const isDocRcvAlert = (d: SiiDocumentRecord): boolean => {
        if (d.documentType !== 33 && d.documentType !== 34) return false;
        if (
            d.rcvStatus === 'ACCEPTED' ||
            d.rcvStatus === 'AUTO_ACCEPTED_8D' ||
            d.rcvStatus === 'NOT_APPLICABLE'
        ) {
            return false;
        }
        const days = d.rcvDaysRemaining ?? computeRcvDaysRemaining(d.issueDate);
        return days !== null && days <= 3;
    };

    const rcvUrgentCount = useMemo(
        () => facturas.filter(isDocRcvAlert).length,
        [facturas]
    );

    const activeDocuments = useMemo(() => {
        const base = tab === 'BOLETAS' ? boletas : facturas;
        const rcvFiltered =
            tab === 'FACTURAS' && onlyRcvUrgent ? base.filter(isDocRcvAlert) : base;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return rcvFiltered;
        return rcvFiltered.filter((d) =>
            `${d.supplierName} ${d.supplierTaxId} ${d.folio} ${d.dedupeKey}`
                .toLowerCase()
                .includes(q)
        );
    }, [tab, boletas, facturas, onlyRcvUrgent, searchQuery]);

    const handleQueryRcvExpiring = async () => {
        setQueryingRcv(true);
        setNotice(null);
        try {
            const freshDocs = await supplyApi.listSiiDocuments(
                { siteId: activeSiteId },
                tenantId
            );
            setQueriedRcvDocs(freshDocs);
            setTab('FACTURAS');
            setOnlyRcvUrgent(true);
        } catch (err) {
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'RCV_QUERY_ERROR',
            });
        } finally {
            setQueryingRcv(false);
        }
    };

    const handleConfirmStatusChange = async () => {
        if (!pendingStatusChange) return;
        const { report, targetStatus } = pendingStatusChange;
        setUpdatingStatus(true);
        setNotice(null);
        try {
            const res = await supplyApi.updateExpenseReportStatus(
                report.reportId,
                targetStatus,
                'ACTUALIZAR',
                tenantId
            );
            setPendingStatusChange(null);
            setNotice({
                tone: 'cyan',
                text: res.queuedOffline
                    ? t('supply.scanner.offline_queued_notice')
                    : `${report.code || report.reportId} ➔ ${t(`supply.status.${targetStatus}`)}`,
            });
            onMutated();
        } catch (err) {
            setPendingStatusChange(null);
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'ENVELOPE_STATUS_ERROR',
            });
        } finally {
            setUpdatingStatus(false);
        }
    };

    const handleExportCsv = async () => {
        setExporting(true);
        setNotice(null);
        try {
            await supplyApi.exportSiiCsv({ siteId: activeSiteId }, tenantId);
        } catch (err) {
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'EXPORT_ERROR',
            });
        } finally {
            setExporting(false);
        }
    };

    const handleRequestCreateEnvelope = (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate || !holderName.trim() || !envelopeTitle.trim()) return;
        setHitlEnvelopeOpen(true);
    };

    const handleConfirmCreateEnvelope = async () => {
        if (!canMutate || !holderName.trim() || !envelopeTitle.trim()) return;
        setCreatingEnvelope(true);
        setNotice(null);
        try {
            const unassignedDocIds = documents
                .filter((d) => !d.expenseReportId)
                .map((d) => d.docId);
            await supplyApi.createSiiExpenseReport(
                {
                    siteId: activeSiteId || 'site-main',
                    title: envelopeTitle.trim(),
                    costCenter: envelopeCostCenter.trim() || 'CC-CAMPAMENTO',
                    holderName: holderName.trim(),
                    periodLabel: periodLabel.trim(),
                    paymentMethod,
                    fundAdvanceClp,
                    siiDocumentIds: unassignedDocIds,
                    confirmationKeyword: 'ACTUALIZAR',
                },
                tenantId
            );
            setEnvelopeTitle('');
            setHolderName('');
            setFundAdvanceClp(0);
            setHitlEnvelopeOpen(false);
            setShowNewEnvelope(false);
            onMutated();
        } catch (err) {
            setHitlEnvelopeOpen(false);
            setNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'ENVELOPE_ERROR',
            });
        } finally {
            setCreatingEnvelope(false);
        }
    };

    const envelopeDiff = useMemo<HitlComparisonDiffItem[]>(
        () => [
            {
                field: t('supply.sii.envelope_title'),
                current: 'DRAFT',
                suggested: `${envelopeTitle.trim() || '—'} · ${envelopeCostCenter.trim() || 'CC-CAMPAMENTO'}`,
            },
            {
                field: t('supply.sii.envelope_advance'),
                current: formatClp(0),
                suggested: `${formatClp(fundAdvanceClp)} · ${periodLabel}`,
            },
        ],
        [envelopeTitle, envelopeCostCenter, fundAdvanceClp, periodLabel, t]
    );

    const statusChangeDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingStatusChange) return [];
        const { report, targetStatus } = pendingStatusChange;
        return [
            {
                field: `${report.title || report.code} (${report.holderName})`,
                current: t(`supply.status.${report.status}`),
                suggested: t(`supply.status.${targetStatus}`),
            },
            {
                field: t('supply.sii.rendered_total'),
                current: formatClp(report.renderedTotalClp),
                suggested: `${t('supply.sii.balance')}: ${formatClp(report.balanceClp)}`,
            },
        ];
    }, [pendingStatusChange, t]);

    return (
        <section className="w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] select-none">
            {!loading && (exporting || queryingRcv || updatingStatus) && (
                <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />
            )}

            {/* Icon-First Sub-module Bar */}
            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex items-center gap-fib-8">
                    <button
                        type="button"
                        onClick={() => setTab('BOLETAS')}
                        aria-label={t('supply.sii.tab_boletas')}
                        title={t('supply.sii.tab_boletas')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none',
                            tab === 'BOLETAS'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        <span className="material-symbols-outlined text-[22px]">receipt_long</span>
                        <span className="font-mono text-microcopy tabular-nums">
                            {boletas.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTab('FACTURAS')}
                        aria-label={t('supply.sii.tab_facturas')}
                        title={t('supply.sii.tab_facturas')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none',
                            tab === 'FACTURAS'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        <span className="material-symbols-outlined text-[22px]">description</span>
                        <span className="font-mono text-microcopy tabular-nums">
                            {facturas.length}
                        </span>
                        {rcvUrgentCount > 0 && (
                            <span className="font-mono text-microcopy tabular-nums font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                !{rcvUrgentCount}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setTab('ENVELOPES')}
                        aria-label={t('supply.sii.tab_envelopes')}
                        title={t('supply.sii.tab_envelopes')}
                        className={cn(
                            'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer rounded-none shadow-none',
                            tab === 'ENVELOPES'
                                ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        <span className="material-symbols-outlined text-[22px]">folder_open</span>
                        <span className="font-mono text-microcopy tabular-nums">
                            {expenseReports.length}
                        </span>
                    </button>
                </div>

                <div className="flex items-center gap-fib-8">
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
                            className="w-52 min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                    </div>

                    {tab === 'FACTURAS' && (
                        <button
                            type="button"
                            onClick={() => setOnlyRcvUrgent((prev) => !prev)}
                            aria-label={t('supply.sii.rcv_filter_urgent')}
                            title={t('supply.sii.rcv_filter_urgent')}
                            data-testid="sii-rcv-urgent-filter-btn"
                            className={cn(
                                'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                                onlyRcvUrgent
                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#7C3F0E] dark:hover:text-[#C68346]'
                            )}
                        >
                            <span className="material-symbols-outlined text-[22px]">schedule</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => void handleQueryRcvExpiring()}
                        disabled={queryingRcv}
                        aria-label={t('supply.sii.rcv_query_live')}
                        title={t('supply.sii.rcv_query_live')}
                        data-testid="sii-rcv-query-btn"
                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[22px]">manage_search</span>
                    </button>

                    {tab === 'ENVELOPES' && canMutate && (
                        <button
                            type="button"
                            onClick={() => setShowNewEnvelope((prev) => !prev)}
                            aria-label={t('supply.sii.new_envelope')}
                            title={t('supply.sii.new_envelope')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[22px]">
                                {showNewEnvelope ? 'close' : 'add'}
                            </span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => void handleExportCsv()}
                        disabled={exporting}
                        aria-label={t('supply.sii.export_csv')}
                        title={t('supply.sii.export_csv')}
                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[22px]">download</span>
                    </button>
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

            {/* Shielded CAS Media Preview Bar (Dual Light/Dark Sol Atacama) */}
            {previewDoc && (
                <div className="px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#00AEEF] space-y-fib-13">
                    <div className="flex items-center justify-between gap-fib-13 font-mono text-data-dense tabular-nums">
                        <div className="flex flex-wrap items-center gap-fib-8">
                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                DTE {previewDoc.documentType} #{previewDoc.folio}
                            </span>
                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                {previewDoc.supplierName}
                            </span>
                            {formatCasTelemetry(previewDoc.evidenceCasRef) && (
                                <span className="text-microcopy text-[#0369A1] dark:text-[#00AEEF] select-text">
                                    {formatCasTelemetry(previewDoc.evidenceCasRef)}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setPreviewDoc(null)}
                            aria-label={t('supply.common.close')}
                            title={t('supply.common.close')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                    {previewDoc.evidenceCasRef?.downloadUrl ? (
                        <div className="max-h-72 overflow-hidden border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-center rounded-none shadow-none">
                            <SecureImage
                                src={previewDoc.evidenceCasRef.downloadUrl}
                                alt={`DTE ${previewDoc.documentType} #${previewDoc.folio}`}
                                className="max-h-72 w-auto object-contain"
                                loading="lazy"
                            />
                        </div>
                    ) : (
                        <div className="font-mono text-microcopy text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.common.not_declared')}
                        </div>
                    )}
                </div>
            )}

            {/* BOLETAS (39/41/0) & FACTURAS (33/34/52/61) LISTS */}
            {(tab === 'BOLETAS' || tab === 'FACTURAS') && (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {activeDocuments.length === 0 ? (
                        <div className="px-fib-21 py-fib-55 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.common.no_records')}
                        </div>
                    ) : (
                        activeDocuments.map((doc) => {
                            const rcvDays =
                                doc.rcvDaysRemaining ?? computeRcvDaysRemaining(doc.issueDate);
                            const isFactura = doc.documentType === 33 || doc.documentType === 34;
                            const isRcvPending =
                                doc.rcvStatus === 'PENDING_REVIEW' ||
                                doc.rcvStatus === 'PENDING_ACCEPTANCE';
                            const isRcvAccepted =
                                doc.rcvStatus === 'ACCEPTED' ||
                                doc.rcvStatus === 'AUTO_ACCEPTED_8D';
                            const rcvUrgent =
                                isFactura &&
                                isRcvPending &&
                                rcvDays !== null &&
                                rcvDays <= 3;
                            const rcvCritical48h = rcvUrgent && rcvDays !== null && rcvDays <= 2;
                            const casLine = formatCasTelemetry(doc.evidenceCasRef);

                            // ISA-101 Color por Excepción (Dark Cockpit silencioso en estado nominal)
                            const barClass =
                                doc.isDuplicate || rcvUrgent
                                    ? 'border-l-[#C68346]'
                                    : isRcvAccepted
                                      ? 'border-l-[#00AEEF]'
                                      : 'border-l-transparent';

                            return (
                                <article
                                    key={doc.docId}
                                    className={cn(
                                        'px-fib-21 py-fib-13 border-l-[3px] flex flex-wrap items-center justify-between gap-fib-13',
                                        barClass
                                    )}
                                >
                                    <div className="min-w-0 flex-1 space-y-fib-8">
                                        <div className="flex flex-wrap items-center gap-fib-8">
                                            <span className="font-mono text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] tabular-nums select-text">
                                                DTE {doc.documentType} #{doc.folio || '—'}
                                            </span>
                                            {doc.folio && (
                                                <CopyButton
                                                    value={doc.folio}
                                                    title={t('supply.common.copy_folio')}
                                                />
                                            )}
                                            <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] font-semibold">
                                                {doc.supplierName}
                                            </span>
                                            <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6] select-text">
                                                {doc.supplierTaxId}
                                            </span>
                                            {doc.supplierTaxId && (
                                                <CopyButton
                                                    value={doc.supplierTaxId}
                                                    title={t('supply.common.copy_code')}
                                                />
                                            )}
                                            <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                {doc.issueDate?.slice(0, 10)}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-fib-13 font-mono text-microcopy tabular-nums">
                                            {/* Anti-duplication fingerprint */}
                                            <div className="flex items-center gap-fib-8">
                                                <span
                                                    className={cn(
                                                        'material-symbols-outlined text-[15px]',
                                                        doc.isDuplicate
                                                            ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                            : 'text-[#0369A1] dark:text-[#00AEEF]'
                                                    )}
                                                >
                                                    {doc.isDuplicate ? 'warning' : 'verified'}
                                                </span>
                                                <span
                                                    className={cn(
                                                        'select-text',
                                                        doc.isDuplicate
                                                            ? 'text-[#7C3F0E] dark:text-[#C68346] font-bold'
                                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                                    )}
                                                >
                                                    {doc.dedupeKey}
                                                </span>
                                                <CopyButton
                                                    value={doc.dedupeKey}
                                                    title={t('supply.common.copy_folio')}
                                                />
                                            </div>

                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                {t(`supply.payments.${doc.paymentMethod}`)}
                                            </span>

                                            {isFactura && (
                                                <>
                                                    <span
                                                        className={cn(
                                                            'font-bold',
                                                            rcvUrgent
                                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                                : isRcvAccepted
                                                                  ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                                  : 'text-[#475569] dark:text-[#8A93A6]'
                                                        )}
                                                    >
                                                        {t(`supply.status.${doc.rcvStatus}`)}
                                                        {isRcvPending &&
                                                        rcvDays !== null
                                                            ? rcvDays < 0
                                                                ? ` · ${t('supply.sii.rcv_expired')}`
                                                                : ` · ${rcvDays}${t('supply.common.days_short')}`
                                                            : ''}
                                                    </span>
                                                    {rcvCritical48h && (
                                                        <span
                                                            data-testid={`sii-rcv-badge-48h-${doc.docId}`}
                                                            className="px-fib-8 py-0.5 bg-[#C68346] text-[#000000] font-bold uppercase"
                                                        >
                                                            {t('supply.sii.rcv_alert_48h')}
                                                        </span>
                                                    )}
                                                    {rcvUrgent && !rcvCritical48h && (
                                                        <span
                                                            data-testid={`sii-rcv-badge-3d-${doc.docId}`}
                                                            className="px-fib-8 py-0.5 border border-[#C68346] text-[#7C3F0E] dark:text-[#C68346] font-bold uppercase"
                                                        >
                                                            {t('supply.sii.rcv_alert_3d')}
                                                        </span>
                                                    )}
                                                </>
                                            )}

                                            {casLine && (
                                                <span className="text-[#0369A1] dark:text-[#00AEEF] select-text">
                                                    {casLine}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-fib-13 shrink-0">
                                        <div className="text-right font-mono tabular-nums">
                                            <div className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {formatClp(doc.totalAmountClp)}
                                            </div>
                                            {isFactura && (
                                                <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    {t('supply.scanner.vat_clp')}:{' '}
                                                    {formatClp(doc.vatAmountClp)}
                                                </div>
                                            )}
                                        </div>

                                        {doc.evidenceCasRef && (
                                            <button
                                                type="button"
                                                onClick={() => setPreviewDoc(doc)}
                                                aria-label={t('supply.sii.preview_evidence')}
                                                title={t('supply.sii.preview_evidence')}
                                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0369A1] dark:hover:text-[#00AEEF] cursor-pointer rounded-none shadow-none"
                                            >
                                                <span className="material-symbols-outlined text-[20px]">
                                                    visibility
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })
                    )}
                </div>
            )}

            {/* ENVELOPES TAB (Fondos por Rendir & Sobres de Rendición) */}
            {tab === 'ENVELOPES' && (
                <div>
                    {canMutate && showNewEnvelope && (
                        <form
                            onSubmit={handleRequestCreateEnvelope}
                            autoComplete="off"
                            spellCheck={false}
                            className="px-fib-21 py-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-1 md:grid-cols-7 gap-fib-13 items-end"
                        >
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-env-title`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.sii.envelope_title')}
                                </label>
                                <input
                                    id={`${uid}-env-title`}
                                    type="text"
                                    value={envelopeTitle}
                                    onChange={(e) => setEnvelopeTitle(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-env-cc`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.sii.envelope_cost_center')}
                                </label>
                                <input
                                    id={`${uid}-env-cc`}
                                    type="text"
                                    value={envelopeCostCenter}
                                    onChange={(e) => setEnvelopeCostCenter(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-env-holder`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.sii.envelope_holder')}
                                </label>
                                <input
                                    id={`${uid}-env-holder`}
                                    type="text"
                                    value={holderName}
                                    onChange={(e) => setHolderName(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-env-period`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.sii.envelope_period')}
                                </label>
                                <input
                                    id={`${uid}-env-period`}
                                    type="text"
                                    value={periodLabel}
                                    onChange={(e) => setPeriodLabel(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-env-payment`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.scanner.payment_label')}
                                </label>
                                <select
                                    id={`${uid}-env-payment`}
                                    aria-label={t('supply.scanner.payment_label')}
                                    value={paymentMethod}
                                    onChange={(e) =>
                                        setPaymentMethod(e.target.value as PaymentMethod)
                                    }
                                    className="w-full min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                >
                                    {PAYMENT_METHODS.map((pm) => (
                                        <option key={pm} value={pm}>
                                            {t(`supply.payments.${pm}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-env-advance`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.sii.envelope_advance')}
                                </label>
                                <input
                                    id={`${uid}-env-advance`}
                                    type="number"
                                    min={0}
                                    value={fundAdvanceClp}
                                    onChange={(e) => setFundAdvanceClp(Number(e.target.value) || 0)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={creatingEnvelope || !holderName.trim() || !envelopeTitle.trim()}
                                className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-data-dense font-bold uppercase rounded-none shadow-none cursor-pointer disabled:opacity-40"
                            >
                                {t('supply.common.save')}
                            </button>
                        </form>
                    )}

                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {expenseReports.length === 0 ? (
                            <div className="px-fib-21 py-fib-55 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.common.no_records')}
                            </div>
                        ) : (
                            expenseReports.map((rep) => {
                                const pct =
                                    rep.fundAdvanceClp > 0
                                        ? Math.min(
                                              100,
                                              Math.round(
                                                  (rep.renderedTotalClp / rep.fundAdvanceClp) * 100
                                              )
                                          )
                                        : 100;
                                const negativeBalance = rep.balanceClp < 0;
                                const reportOwnerUid = rep.holderUid || rep.custodianUid || '';
                                const isSelfCustodian = Boolean(
                                    resolvedActorUid &&
                                        reportOwnerUid &&
                                        resolvedActorUid === reportOwnerUid
                                );
                                const canSubmit =
                                    canMutate &&
                                    (rep.status === 'OPEN' || rep.status === 'REJECTED');
                                const canApproveOrReject =
                                    canMutate &&
                                    canApproveExpenseReports &&
                                    (rep.status === 'OPEN' || rep.status === 'SUBMITTED');
                                const canSettle =
                                    canMutate &&
                                    canApproveExpenseReports &&
                                    rep.status === 'APPROVED';

                                return (
                                    <article
                                        key={rep.reportId}
                                        className={cn(
                                            'px-fib-21 py-fib-13 border-l-[3px] space-y-fib-8',
                                            negativeBalance
                                                ? 'border-l-[#C68346]'
                                                : rep.status === 'SETTLED' ||
                                                    rep.status === 'REIMBURSED' ||
                                                    rep.status === 'APPROVED'
                                                  ? 'border-l-[#00AEEF]'
                                                  : 'border-l-transparent'
                                        )}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono tabular-nums">
                                            <div className="flex flex-wrap items-center gap-fib-8">
                                                <span className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                    {rep.title || rep.code}
                                                </span>
                                                <CopyButton
                                                    value={rep.code || rep.reportId}
                                                    title={t('supply.common.copy_code')}
                                                />
                                                <span className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    {rep.costCenter}
                                                </span>
                                                <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {rep.holderName}
                                                </span>
                                                <span className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    {rep.periodLabel} ·{' '}
                                                    {t(`supply.payments.${rep.paymentMethod}`)}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-fib-8">
                                                <span className="text-microcopy font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t(`supply.status.${rep.status}`)} ({rep.documentCount} DTE)
                                                </span>

                                                {canSubmit && (
                                                    <button
                                                        type="button"
                                                        disabled={updatingStatus}
                                                        onClick={() =>
                                                            setPendingStatusChange({
                                                                report: rep,
                                                                targetStatus: 'SUBMITTED',
                                                            })
                                                        }
                                                        aria-label={t('supply.sii.envelope_submit')}
                                                        title={t('supply.sii.envelope_submit')}
                                                        data-testid={`sii-envelope-submit-${rep.reportId}`}
                                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0369A1] dark:hover:text-[#00AEEF] cursor-pointer rounded-none shadow-none disabled:opacity-40"
                                                    >
                                                        <span className="material-symbols-outlined text-[20px]">
                                                            send
                                                        </span>
                                                    </button>
                                                )}

                                                {(canApproveOrReject || canSettle) &&
                                                    (isSelfCustodian ? (
                                                        <span
                                                            data-testid={`sii-envelope-sod-blocked-${rep.reportId}`}
                                                            title={t('supply.sii.sod_self_approval_blocked')}
                                                            className="inline-flex items-center gap-1 font-mono text-microcopy font-bold text-[#7C3F0E] dark:text-[#C68346]"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">
                                                                lock
                                                            </span>
                                                            <span>
                                                                {t('supply.sii.sod_self_approval_blocked')}
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        <>
                                                            {canApproveOrReject && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        disabled={updatingStatus}
                                                                        onClick={() =>
                                                                            setPendingStatusChange({
                                                                                report: rep,
                                                                                targetStatus: 'APPROVED',
                                                                            })
                                                                        }
                                                                        aria-label={t(
                                                                            'supply.sii.envelope_approve'
                                                                        )}
                                                                        title={t(
                                                                            'supply.sii.envelope_approve'
                                                                        )}
                                                                        data-testid={`sii-envelope-approve-${rep.reportId}`}
                                                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[22px]">
                                                                            check_circle
                                                                        </span>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        disabled={updatingStatus}
                                                                        onClick={() =>
                                                                            setPendingStatusChange({
                                                                                report: rep,
                                                                                targetStatus: 'REJECTED',
                                                                            })
                                                                        }
                                                                        aria-label={t(
                                                                            'supply.sii.envelope_reject'
                                                                        )}
                                                                        title={t(
                                                                            'supply.sii.envelope_reject'
                                                                        )}
                                                                        data-testid={`sii-envelope-reject-${rep.reportId}`}
                                                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[22px]">
                                                                            cancel
                                                                        </span>
                                                                    </button>
                                                                </>
                                                            )}
                                                            {canSettle && (
                                                                <button
                                                                    type="button"
                                                                    disabled={updatingStatus}
                                                                    onClick={() =>
                                                                        setPendingStatusChange({
                                                                            report: rep,
                                                                            targetStatus: 'SETTLED',
                                                                        })
                                                                    }
                                                                    aria-label={t(
                                                                        'supply.sii.envelope_settle'
                                                                    )}
                                                                    title={t(
                                                                        'supply.sii.envelope_settle'
                                                                    )}
                                                                    data-testid={`sii-envelope-settle-${rep.reportId}`}
                                                                    className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                                                                >
                                                                    <span className="material-symbols-outlined text-[22px]">
                                                                        task_alt
                                                                    </span>
                                                                </button>
                                                            )}
                                                        </>
                                                    ))}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-fib-13 font-mono text-microcopy tabular-nums">
                                            <div>
                                                <div className="text-[#475569] dark:text-[#8A93A6]">
                                                    {t('supply.sii.fund_advance')}
                                                </div>
                                                <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {formatClp(rep.fundAdvanceClp)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[#475569] dark:text-[#8A93A6]">
                                                    {t('supply.sii.rendered_total')}
                                                </div>
                                                <div className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {formatClp(rep.renderedTotalClp)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[#475569] dark:text-[#8A93A6]">
                                                    {t('supply.sii.balance')}
                                                </div>
                                                <div
                                                    className={cn(
                                                        'text-data-dense font-bold',
                                                        negativeBalance
                                                            ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                            : 'text-[#0369A1] dark:text-[#00AEEF]'
                                                    )}
                                                >
                                                    {formatClp(rep.balanceClp)}
                                                </div>
                                            </div>
                                        </div>

                                        <M3LinearProgress value={pct} ariaLabel={rep.code} />
                                    </article>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            <HitlConfirmModal
                open={hitlEnvelopeOpen}
                title={t('supply.sii.hitl_envelope_title')}
                description={t('supply.sii.hitl_envelope_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={envelopeDiff}
                loading={creatingEnvelope}
                onConfirm={() => void handleConfirmCreateEnvelope()}
                onCancel={() => setHitlEnvelopeOpen(false)}
            />

            <HitlConfirmModal
                open={Boolean(pendingStatusChange)}
                title={t('supply.sii.hitl_status_title')}
                description={t('supply.sii.hitl_status_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={statusChangeDiff}
                loading={updatingStatus}
                onConfirm={() => void handleConfirmStatusChange()}
                onCancel={() => setPendingStatusChange(null)}
            />
        </section>
    );
};

export default SiiRendicionesView;
