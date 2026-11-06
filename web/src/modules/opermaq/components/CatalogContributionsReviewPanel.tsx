import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import { M3Switch } from './M3Switch';

interface ProposedPillarDeltaItem {
    proposal_id: string;
    pillar_id: string;
    section: string;
    title: string;
    existing_item_id?: string | null;
    existing_published_excerpt?: string | null;
    proposed_content: string;
    source_pages?: number[];
    staged_figures?: Array<{
        figure_id: string;
        sha256: string;
        page_number: number;
        caption: string;
    }>;
    decision?: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

interface ContributionQueueItem {
    id: string;
    global_asset_id: string;
    make_model: string;
    sanitized_filename: string;
    file_sha256: string;
    status: string;
    estado_aprobacion: string;
    proposed_items: ProposedPillarDeltaItem[];
    dedup_metrics?: {
        totalPages?: number;
        skippedUnchangedPages?: number;
        skippedSemanticDuplicates?: number;
        netNewItemsCount?: number;
    };
    review_notes?: string;
    reviewed_by_email?: string | null;
    reviewed_at?: string | null;
    created_at: string;
}

interface CatalogContributionsReviewPanelProps {
    filterGlobalAssetId?: string | null;
    onBack?: () => void;
    onReviewed?: () => void;
}

export const CatalogContributionsReviewPanel: React.FC<CatalogContributionsReviewPanelProps> = ({
    filterGlobalAssetId,
    onBack,
    onReviewed,
}) => {
    const { t } = useTranslation();
    const { capabilities } = useOpermaqContext();

    const [items, setItems] = useState<ContributionQueueItem[]>([]);
    const [statusFilter, setStatusFilter] = useState<'PENDING_HUMAN_REVIEW' | 'ALL'>('PENDING_HUMAN_REVIEW');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

    const [acceptedMap, setAcceptedMap] = useState<Record<string, boolean>>({});
    const [publishApprovedItems, setPublishApprovedItems] = useState<boolean>(true);
    const [reviewNotes, setReviewNotes] = useState<string>('');
    const [confirmWord, setConfirmWord] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);

    const loadQueue = useCallback(async () => {
        if (!capabilities.canCurateAI) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setErrorMsg(null);
        try {
            const params = new URLSearchParams();
            if (filterGlobalAssetId) params.set('globalAssetId', filterGlobalAssetId);
            if (statusFilter === 'PENDING_HUMAN_REVIEW') params.set('status', 'PENDING_HUMAN_REVIEW');

            const qs = params.toString();
            const res = await authFetch(
                `${API_BASE_URL}/vault/contributions${qs ? `?${qs}` : ''}`
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('common.error'));
            }

            const fetched: ContributionQueueItem[] = Array.isArray(data?.items) ? data.items : [];
            setItems(fetched);
            setSelectedId((prev) => {
                if (prev && fetched.some((x) => x.id === prev)) return prev;
                return fetched[0]?.id || null;
            });
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setLoading(false);
        }
    }, [capabilities.canCurateAI, filterGlobalAssetId, statusFilter, t]);

    useEffect(() => {
        void loadQueue();
    }, [loadQueue]);

    const selectedItem = useMemo(
        () => items.find((it) => it.id === selectedId) || null,
        [items, selectedId]
    );

    useEffect(() => {
        if (!selectedItem) {
            setAcceptedMap({});
            setConfirmWord('');
            setReviewNotes('');
            return;
        }

        const initial: Record<string, boolean> = {};
        for (const prop of selectedItem.proposed_items || []) {
            initial[prop.proposal_id] = prop.decision !== 'REJECTED';
        }
        setAcceptedMap(initial);
        setReviewNotes(selectedItem.review_notes || '');
        setConfirmWord('');
    }, [selectedItem]);

    const handleSubmitReview = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedItem || confirmWord.trim().toUpperCase() !== 'ACTUALIZAR') return;

        setSubmitting(true);
        setErrorMsg(null);
        setNoticeMsg(null);

        const acceptedProposalIds: string[] = [];
        const rejectedProposalIds: string[] = [];
        for (const prop of selectedItem.proposed_items || []) {
            if (acceptedMap[prop.proposal_id]) {
                acceptedProposalIds.push(prop.proposal_id);
            } else {
                rejectedProposalIds.push(prop.proposal_id);
            }
        }

        try {
            const res = await authFetch(
                `${API_BASE_URL}/vault/contributions/${encodeURIComponent(selectedItem.id)}/review`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        acceptedProposalIds,
                        rejectedProposalIds,
                        publishApprovedItems,
                        reviewNotes: reviewNotes.trim() || undefined,
                        confirmWord: 'ACTUALIZAR',
                    }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('common.error'));
            }

            setNoticeMsg(
                `Revisión consolidada: ${Number(data?.consolidatedCount || 0)} ítems autorizados, ${Number(
                    data?.rejectedCount || 0
                )} descartados.`
            );
            setConfirmWord('');
            await loadQueue();
            onReviewed?.();
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setSubmitting(false);
        }
    };

    const flatIconBtn =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none';

    if (!capabilities.canCurateAI) {
        return (
            <div className="p-[34px] text-[13px] font-mono text-[#475569] dark:text-[#8A93A6]">
                {t('admin.access_denied_desc')}
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none rounded-none shadow-none overflow-hidden">
            {/* Cabecera de Cuarentena HITL */}
            <header className="px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-[13px] shrink-0">
                <div className="flex items-center gap-[13px] min-w-0">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            title={t('common.back')}
                            aria-label={t('common.back')}
                            className={flatIconBtn}
                        >
                            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                        </button>
                    )}
                    <span className="material-symbols-outlined text-[20px] text-[#C68346]">fact_check</span>
                    <h1 className="text-[13px] font-mono font-bold uppercase tracking-[0.05em] truncate">
                        {t('opermaq_domains.hitl_queue_title')}
                    </h1>
                </div>

                <div className="flex items-center gap-[13px] shrink-0">
                    <div className="flex border border-[#E2E8F0] dark:border-[#12151C]">
                        <button
                            type="button"
                            onClick={() => setStatusFilter('PENDING_HUMAN_REVIEW')}
                            className={`px-[13px] h-8 text-[11px] font-mono uppercase cursor-pointer border-0 rounded-none ${
                                statusFilter === 'PENDING_HUMAN_REVIEW'
                                    ? 'bg-[#C68346] text-white font-bold'
                                    : 'bg-transparent text-[#475569] dark:text-[#8A93A6]'
                            }`}
                        >
                            {t('admin.quarantine')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setStatusFilter('ALL')}
                            className={`px-[13px] h-8 text-[11px] font-mono uppercase cursor-pointer border-0 border-l border-[#E2E8F0] dark:border-[#12151C] rounded-none ${
                                statusFilter === 'ALL'
                                    ? 'bg-[#C68346] text-white font-bold'
                                    : 'bg-transparent text-[#475569] dark:text-[#8A93A6]'
                            }`}
                        >
                            {t('admin.all_records')}
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => void loadQueue()}
                        title={t('vault.refresh')}
                        aria-label={t('vault.refresh')}
                        className={flatIconBtn}
                    >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                    </button>
                </div>
            </header>

            {(errorMsg || noticeMsg) && (
                <div className="px-[21px] py-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[12px] font-mono">
                    {errorMsg && <span className="text-[#C68346]">{errorMsg}</span>}
                    {noticeMsg && <span className="text-[#00AEEF]">{noticeMsg}</span>}
                </div>
            )}

            {loading ? (
                <div className="flex-1 flex items-center justify-center p-[34px]">
                    <span className="material-symbols-outlined animate-spin text-[26px] text-[#C68346]">
                        progress_activity
                    </span>
                </div>
            ) : items.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-[34px]">
                    <p className="text-[13px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        {t('opermaq_domains.hitl_empty')}
                    </p>
                </div>
            ) : (
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                    {/* ÁREA MENOR (38.2%) — Lista Densa de Aportes PDF */}
                    <aside className="w-full lg:w-[38.2%] h-full overflow-y-auto border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {items.map((entry) => {
                            const isSelected = entry.id === selectedItem?.id;
                            return (
                                <div
                                    key={entry.id}
                                    onClick={() => setSelectedId(entry.id)}
                                    className={`px-[21px] py-[13px] cursor-pointer transition-colors ${
                                        isSelected
                                            ? 'bg-[#FFFFFF] dark:bg-[#000000] border-l-2 border-l-[#C68346]'
                                            : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-[8px]">
                                        <span className="text-[14px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {entry.make_model || entry.global_asset_id}
                                        </span>
                                        <span className="text-[11px] font-mono tabular-nums text-[#C68346] shrink-0">
                                            {entry.proposed_items.length} Δ
                                        </span>
                                    </div>
                                    <div className="text-[12px] text-[#475569] dark:text-[#8A93A6] truncate mt-0.5">
                                        {entry.sanitized_filename}
                                    </div>
                                    <div className="text-[11px] font-mono tabular-nums text-[#00AEEF] mt-1">
                                        {entry.status}
                                    </div>
                                </div>
                            );
                        })}
                    </aside>

                    {/* ÁREA MAYOR (61.8%) — Inspector Comparativo 1 a 1 (`[Actual] ➔ [Sugerido]`) */}
                    <section className="w-full lg:w-[61.8%] h-full overflow-y-auto p-[21px] space-y-[21px] bg-[#FFFFFF] dark:bg-[#000000]">
                        {selectedItem && (
                            <>
                                {/* Telemetría Anti-Duplicados */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[13px] p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] font-mono tabular-nums">
                                    <div>
                                        <div className="text-[10px] uppercase text-[#94A3B8] dark:text-[#5A6072]">
                                            PÁGINAS PDF
                                        </div>
                                        <div className="text-[15px] font-bold">
                                            {selectedItem.dedup_metrics?.totalPages ?? 0}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase text-[#94A3B8] dark:text-[#5A6072]">
                                            PÁG. DUPLICADAS
                                        </div>
                                        <div className="text-[15px] font-bold">
                                            {selectedItem.dedup_metrics?.skippedUnchangedPages ?? 0}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase text-[#94A3B8] dark:text-[#5A6072]">
                                            DEDUP SEMÁNTICA
                                        </div>
                                        <div className="text-[15px] font-bold">
                                            {selectedItem.dedup_metrics?.skippedSemanticDuplicates ?? 0}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase text-[#94A3B8] dark:text-[#5A6072]">
                                            DELTAS NETOS
                                        </div>
                                        <div className="text-[15px] font-bold text-[#C68346]">
                                            {selectedItem.proposed_items.length}
                                        </div>
                                    </div>
                                </div>

                                {/* Propuestas 1 a 1 */}
                                <div className="space-y-[13px]">
                                    {selectedItem.proposed_items.map((prop) => {
                                        const isAccepted = Boolean(acceptedMap[prop.proposal_id]);
                                        const isEditable = selectedItem.status === 'PENDING_HUMAN_REVIEW';
                                        return (
                                            <div
                                                key={prop.proposal_id}
                                                className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[13px] space-y-[13px] rounded-none"
                                            >
                                                <div className="flex items-center justify-between gap-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px]">
                                                    <div className="min-w-0">
                                                        <span className="text-[11px] font-mono uppercase text-[#C68346] block">
                                                            {prop.pillar_id} · {prop.section}
                                                        </span>
                                                        <h3 className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                            {prop.title}
                                                        </h3>
                                                    </div>

                                                    <M3Switch
                                                        checked={isAccepted}
                                                        disabled={!isEditable}
                                                        onChange={(val) =>
                                                            setAcceptedMap((prev) => ({
                                                                ...prev,
                                                                [prop.proposal_id]: val,
                                                            }))
                                                        }
                                                    />
                                                </div>

                                                <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-[13px] items-stretch">
                                                    <div className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[8px]">
                                                        <div className="text-[10px] font-mono font-bold uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                                            [{t('opermaq_domains.hitl_actual')}]
                                                        </div>
                                                        <p className="text-[13px] leading-relaxed text-[#475569] dark:text-[#8A93A6] whitespace-pre-wrap select-text">
                                                            {prop.existing_published_excerpt ||
                                                                t('opermaq_domains.not_declared')}
                                                        </p>
                                                    </div>

                                                    <div className="flex items-center justify-center">
                                                        <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">
                                                            arrow_forward
                                                        </span>
                                                    </div>

                                                    <div className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[8px]">
                                                        <div className="flex items-center justify-between gap-[8px]">
                                                            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                                                [{t('opermaq_domains.hitl_suggested')}]
                                                            </span>
                                                            {prop.source_pages && prop.source_pages.length > 0 && (
                                                                <span className="text-[10px] font-mono tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                                                                    Pág. {prop.source_pages.join(', ')}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[13px] leading-relaxed text-[#0F172A] dark:text-[#F3F4F6] whitespace-pre-wrap select-text">
                                                            {prop.proposed_content}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Consolidación HITL con Palabra Clave Obligatoria `"ACTUALIZAR"` */}
                                {selectedItem.status === 'PENDING_HUMAN_REVIEW' && (
                                    <form
                                        onSubmit={handleSubmitReview}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="p-[21px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] space-y-[13px] rounded-none"
                                    >
                                        <M3Switch
                                            checked={publishApprovedItems}
                                            onChange={setPublishApprovedItems}
                                            label={t('opermaq_domains.hitl_publish_toggle')}
                                        />

                                        <div>
                                            <label className="block text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] mb-1">
                                                {t('adminKnowledge.reviewer_notes')}
                                            </label>
                                            <input
                                                type="text"
                                                value={reviewNotes}
                                                onChange={(e) => setReviewNotes(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="w-full h-9 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] outline-none rounded-none select-text"
                                            />
                                        </div>

                                        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-[13px]">
                                            <div className="flex-1">
                                                <label className="block text-[11px] font-mono uppercase tracking-[0.05em] text-[#C68346] mb-1">
                                                    {t('opermaq_domains.confirm_keyword_prompt')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={confirmWord}
                                                    onChange={(e) => setConfirmWord(e.target.value.toUpperCase())}
                                                    placeholder="ACTUALIZAR"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono font-bold tracking-widest uppercase outline-none rounded-none"
                                                />
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={
                                                    submitting || confirmWord.trim().toUpperCase() !== 'ACTUALIZAR'
                                                }
                                                className="h-10 px-[21px] bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none cursor-pointer transition-colors"
                                            >
                                                {submitting
                                                    ? t('detail.processing')
                                                    : t('opermaq_domains.hitl_consolidate_btn')}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
};

export default CatalogContributionsReviewPanel;

