import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getApiUrl } from '../../utils/network';
import { auth, db } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import M3CircularProgress from '../common/M3CircularProgress';
import { SovereignVoiceInput } from '../common/SovereignVoiceInput';

interface AIProposal {
    id: string;
    module: string;
    title: string;
    currentValue: string;
    suggestedValue: string;
    confidence?: number;
    status: string;
}

interface CopilotMessage {
    role: 'user' | 'assistant' | 'error';
    text: string;
    tier?: string;
    isWelcome?: boolean;
}

const MISSING_FIELD = '[Información técnica no declarada en ficha]';

function formatHumanProposalValues(
    singleVal: unknown,
    mapVal: unknown,
    undeclaredLabel: string
): string {
    if (singleVal !== undefined && singleVal !== null && String(singleVal).trim() !== '') {
        return String(singleVal);
    }
    if (mapVal && typeof mapVal === 'object' && !Array.isArray(mapVal)) {
        const entries = Object.entries(mapVal as Record<string, unknown>);
        if (entries.length === 0) return undeclaredLabel;
        return entries
            .map(([k, v]) => {
                const cleanKey = k.replace(/_/g, ' ').trim();
                const cleanVal =
                    v === null || v === undefined || v === ''
                        ? undeclaredLabel
                        : typeof v === 'object'
                        ? Object.values(v as Record<string, unknown>)
                              .filter((item) => item !== null && item !== undefined && item !== '')
                              .join(' · ') || undeclaredLabel
                        : String(v);
                return `${cleanKey}: ${cleanVal}`;
            })
            .join(' | ');
    }
    return undeclaredLabel;
}

export interface MiningAICopilotProps {
    externalOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
}

export const MiningAICopilot: React.FC<MiningAICopilotProps> = ({
    externalOpen,
    onOpenChange,
    hideTrigger = false,
}) => {
    const { t } = useTranslation();
    const { session } = useMinReportSession();
    const location = useLocation();
    const detectedModule: 'core' | 'opermaq' | 'stockpile' | 'supply' = location.pathname.startsWith('/opermaq')
        ? 'opermaq'
        : location.pathname.startsWith('/acopios') || location.pathname.startsWith('/stockpile')
        ? 'stockpile'
        : location.pathname.startsWith('/abastecimiento') || location.pathname.startsWith('/supply')
        ? 'supply'
        : 'core';
    const canCurateProposals = Boolean(
        !session?.isEduSandbox && String(session?.role || '').toUpperCase() !== 'VIEWER'
    );
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = typeof externalOpen === 'boolean';
    const isOpen = isControlled ? externalOpen : internalOpen;
    const setIsOpen = (next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
    };
    const [activeTab, setActiveTab] = useState<'copilot' | 'proposals'>('copilot');
    const [inputPrompt, setInputPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<CopilotMessage[]>([
        {
            role: 'assistant',
            text: '',
            isWelcome: true,
        }
    ]);

    const [proposals, setProposals] = useState<AIProposal[]>([]);
    const [proposalsLoading, setProposalsLoading] = useState(false);
    const [proposalsError, setProposalsError] = useState<string | null>(null);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState('');
    const [updatingProposal, setUpdatingProposal] = useState(false);

    const loadProposals = useCallback(async () => {
        if (!session?.tenantId) {
            setProposals([]);
            return;
        }
        setProposalsLoading(true);
        setProposalsError(null);
        try {
            const q = query(
                collection(db, 'hitl_candidates'),
                where('tenantId', '==', session.tenantId)
            );
            const snap = await getDocs(q);
            const undeclaredValue = t('core_common.undeclared_tech_value', MISSING_FIELD);
            const items: AIProposal[] = snap.docs.map((docSnap) => {
                const raw = docSnap.data();
                return {
                    id: docSnap.id,
                    module: String(raw.module || 'core'),
                    title: String(raw.title || raw.targetEntity || raw.field || docSnap.id),
                    currentValue: formatHumanProposalValues(
                        raw.currentValue,
                        raw.currentValues,
                        undeclaredValue
                    ),
                    suggestedValue: formatHumanProposalValues(
                        raw.suggestedValue,
                        raw.suggestedValues,
                        undeclaredValue
                    ),
                    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
                    status: String(raw.status || 'PENDING'),
                };
            });
            setProposals(items);
        } catch (err: any) {
            setProposalsError(err?.message || t('core_ai.proposals_load_error'));
        } finally {
            setProposalsLoading(false);
        }
    }, [session?.tenantId, t]);

    useEffect(() => {
        if (isOpen) {
            loadProposals();
        }
    }, [isOpen, loadProposals]);

    const submitQuery = async (rawPrompt: string) => {
        const userText = rawPrompt.trim();
        if (!userText || loading) return;

        setInputPrompt('');
        setMessages(prev => [...prev, { role: 'user', text: userText }]);
        setLoading(true);

        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(getApiUrl('/api/ai/inference'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(session?.tenantId ? { 'X-Active-Account-Id': session.tenantId } : {}),
                },
                body: JSON.stringify({
                    prompt: userText,
                    module: detectedModule,
                    thinkingLevel: 'medium'
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || t('core_ai.inference_http_error', { status: res.status }));
            }

            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    text: data.text || t('core_ai.empty_inference_response'),
                }
            ]);
        } catch (err: any) {
            setMessages(prev => [
                ...prev,
                {
                    role: 'error',
                    text: err?.message || t('core_ai.inference_comm_error')
                }
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        await submitQuery(inputPrompt);
    };

    const handleResolveProposal = async (id: string, nextStatus: 'APPROVED' | 'REJECTED') => {
        if (!canCurateProposals) return;
        if (nextStatus === 'APPROVED' && confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR') return;
        setUpdatingProposal(true);
        setProposalsError(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(
                getApiUrl(`/api/ai/hitl-candidates/${encodeURIComponent(id)}/resolve`),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        ...(session?.tenantId ? { 'X-Active-Account-Id': session.tenantId } : {}),
                    },
                    body: JSON.stringify({
                        status: nextStatus,
                        confirmKeyword: confirmKeyword.trim(),
                    }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || t('core_ai.proposal_update_error'));
            }
            setConfirmingId(null);
            setConfirmKeyword('');
            await loadProposals();
        } catch (err: any) {
            setProposalsError(err?.message || t('core_ai.proposal_update_error'));
        } finally {
            setUpdatingProposal(false);
        }
    };

    const pendingCount = proposals.filter(p => p.status === 'PENDING').length;

    return (
        <>
            {/* Disparador Minimalista Industrial con Soporte Dual */}
            {!isOpen && !hideTrigger && (
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-fib-21 right-fib-21 z-40 min-h-[48px] min-w-[48px] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] px-fib-13 py-2.5 rounded-none shadow-none flex items-center gap-fib-8 transition-colors cursor-pointer"
                    title={t('core_ai.trigger_title')}
                    aria-label={t('core_ai.trigger_title')}
                >
                    <span className="material-symbols-outlined text-[20px] text-[#C68346]">smart_toy</span>
                    <span className="text-microcopy uppercase font-mono hidden sm:inline">
                        {t('core_ai.trigger_label')}
                    </span>
                    {pendingCount > 0 && (
                        <span className="text-microcopy font-mono tabular-nums text-[#00AEEF]">
                            ({pendingCount})
                        </span>
                    )}
                </button>
            )}

            {/* Drawer Lateral Parametrico de Proporcion Aurea (38.2%) */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
                    <div className="w-full sm:w-[480px] lg:w-[38.2vw] h-full bg-[#FFFFFF] dark:bg-[#000000] border-l border-[#E2E8F0] dark:border-[#12151C] flex flex-col justify-between rounded-none shadow-none">
                        {/* Header */}
                        <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between bg-[#F8FAFC] dark:bg-[#07090D]">
                            <div className="flex items-center gap-fib-13">
                                <span className="material-symbols-outlined text-[20px] text-[#C68346]">smart_toy</span>
                                <div>
                                    <h3 className="text-data-dense font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('core_ai.header_title')}
                                    </h3>
                                    <p className="text-microcopy text-[#475569] dark:text-[#8A93A6] font-mono mt-0.5">
                                        {t('core_ai.header_subtitle')}
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                title={t('core_ai.close_panel')}
                                aria-label={t('core_ai.close_panel')}
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        {/* Pestañas */}
                        <div className="flex border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                            <button
                                type="button"
                                onClick={() => setActiveTab('copilot')}
                                className={`flex-1 py-2.5 text-microcopy font-mono font-bold uppercase tracking-wider text-center transition-colors border-b-2 bg-transparent cursor-pointer ${
                                    activeTab === 'copilot'
                                        ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                {t('core_ai.tab_copilot')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('proposals')}
                                className={`flex-1 py-2.5 text-microcopy font-mono font-bold uppercase tracking-wider text-center transition-colors border-b-2 bg-transparent flex items-center justify-center gap-1.5 cursor-pointer ${
                                    activeTab === 'proposals'
                                        ? 'border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                <span>{t('core_ai.tab_proposals')}</span>
                                <span className="text-microcopy text-[#00AEEF] tabular-nums">({pendingCount})</span>
                            </button>
                        </div>

                        {/* Contenido */}
                        <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-13">
                            {activeTab === 'copilot' ? (
                                <>
                                    <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8 rounded-none">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                                {t('core_ai.sources_verified_badge')}
                                            </span>
                                        </div>
                                        <p className="text-data-dense font-sans text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_ai.guided_intro')}
                                        </p>
                                        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-fib-8 pt-1">
                                            <button
                                                type="button"
                                                disabled={loading}
                                                onClick={() => submitQuery(t('core_ai.quick_summary_prompt'))}
                                                className="min-h-[48px] px-fib-13 py-2 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] text-data-dense font-mono text-left text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer disabled:opacity-40 transition-colors"
                                            >
                                                {t('core_ai.quick_summary_label')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={loading}
                                                onClick={() => submitQuery(t('core_ai.quick_risks_prompt'))}
                                                className="min-h-[48px] px-fib-13 py-2 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] text-data-dense font-mono text-left text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer disabled:opacity-40 transition-colors"
                                            >
                                                {t('core_ai.quick_risks_label')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={loading}
                                                onClick={() => submitQuery(t('core_ai.quick_specs_prompt'))}
                                                className="min-h-[48px] px-fib-13 py-2 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] text-data-dense font-mono text-left text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer disabled:opacity-40 transition-colors"
                                            >
                                                {t('core_ai.quick_specs_label')}
                                            </button>
                                        </div>
                                    </div>

                                    {messages.map((m, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-fib-13 text-body-main leading-relaxed rounded-none ${
                                                m.role === 'user'
                                                    ? 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border-l-2 border-[#C68346] ml-fib-21'
                                                    : m.role === 'error'
                                                        ? 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-data-dense'
                                                        : 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] mr-fib-13'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5 text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                                <span>
                                                    {m.role === 'user'
                                                        ? t('core_ai.role_user')
                                                        : m.role === 'error'
                                                            ? t('core_ai.role_error')
                                                            : t('core_ai.role_assistant')}
                                                </span>
                                            </div>
                                            <p className="whitespace-pre-wrap select-text">{m.isWelcome ? t('core_ai.welcome_message') : m.text}</p>
                                        </div>
                                    ))}

                                    {loading && (
                                        <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8 text-data-dense text-[#475569] dark:text-[#8A93A6] font-mono">
                                            <M3CircularProgress size={18} ariaLabel={t('core_ai.querying_aria')} />
                                            <span>{t('core_ai.querying_status')}</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="space-y-fib-13">
                                    <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border-l-2 border-[#00AEEF] text-microcopy text-[#475569] dark:text-[#8A93A6] font-mono">
                                        {t('core_ai.hitl_governance_notice')}
                                    </div>

                                    {proposalsError && (
                                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-data-dense font-mono">
                                            {proposalsError}
                                        </div>
                                    )}

                                    {proposalsLoading ? (
                                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            {t('core_ai.loading_proposals')}
                                        </p>
                                    ) : proposals.length === 0 ? (
                                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            {t('core_ai.no_proposals')}
                                        </p>
                                    ) : (
                                        proposals.map((prop) => (
                                            <div
                                                key={prop.id}
                                                className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13 rounded-none"
                                            >
                                                <div className="flex items-center justify-between text-microcopy font-mono tabular-nums">
                                                    <span className="font-bold uppercase tracking-wider text-[#C68346]">
                                                        {prop.module}
                                                    </span>
                                                    <span className="text-[#475569] dark:text-[#8A93A6]">
                                                        {prop.confidence !== undefined ? t('core_ai.confidence_pct', { pct: prop.confidence }) : prop.status}
                                                    </span>
                                                </div>

                                                <h4 className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                                                    {prop.title}
                                                </h4>

                                                <div className="space-y-1.5 text-data-dense font-mono">
                                                    <div className="p-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]">
                                                        <span className="text-microcopy uppercase block font-bold">{t('core_ai.current_label')}</span>
                                                        <span className="select-text break-words">{prop.currentValue}</span>
                                                    </div>
                                                    <div className="flex justify-center">
                                                        <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">arrow_downward</span>
                                                    </div>
                                                    <div className="p-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#00AEEF]/40 text-[#0F172A] dark:text-[#F3F4F6]">
                                                        <span className="text-microcopy uppercase block text-[#00AEEF] font-bold">{t('core_ai.suggested_label')}</span>
                                                        <span className="select-text break-words">{prop.suggestedValue}</span>
                                                    </div>
                                                </div>

                                                {prop.status === 'PENDING' ? (
                                                    canCurateProposals ? (
                                                        confirmingId === prop.id ? (
                                                            <div className="space-y-fib-8 pt-1">
                                                                <input
                                                                    type="text"
                                                                    autoComplete="off"
                                                                    spellCheck={false}
                                                                    aria-label={t('core_ai.hitl_keyword_input_aria')}
                                                                    value={confirmKeyword}
                                                                    onChange={(e) => setConfirmKeyword(e.target.value)}
                                                                    placeholder={t('core_ai.hitl_keyword_placeholder')}
                                                                    className="w-full min-h-[48px] px-3 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] text-body-main font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                                                />
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        type="button"
                                                                        disabled={confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR' || updatingProposal}
                                                                        onClick={() => handleResolveProposal(prop.id, 'APPROVED')}
                                                                        className="flex-1 min-h-[48px] py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-data-dense font-mono font-bold uppercase rounded-none border-0 cursor-pointer disabled:opacity-40"
                                                                    >
                                                                        {t('core_common.confirm')}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setConfirmingId(null);
                                                                            setConfirmKeyword('');
                                                                        }}
                                                                        className="min-h-[48px] px-4 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-data-dense font-mono uppercase text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
                                                                    >
                                                                        {t('core_common.cancel')}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-2 pt-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setConfirmingId(prop.id);
                                                                        setConfirmKeyword('');
                                                                    }}
                                                                    className="flex-1 min-h-[48px] py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-data-dense font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer"
                                                                >
                                                                    {t('core_ai.authorize_with_keyword')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleResolveProposal(prop.id, 'REJECTED')}
                                                                    disabled={updatingProposal}
                                                                    className="min-h-[48px] px-4 py-2 border border-[#E2E8F0] dark:border-[#12151C] text-data-dense font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:border-red-500 rounded-none cursor-pointer bg-transparent"
                                                                >
                                                                    {t('core_ai.discard')}
                                                                </button>
                                                            </div>
                                                        )
                                                    ) : null
                                                ) : (
                                                    <div className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] pt-1">
                                                        {t('core_ai.consolidated_status')} <span className="text-[#00AEEF] font-bold">{prop.status}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Formulario de Consulta */}
                        {activeTab === 'copilot' && (
                            <form
                                onSubmit={handleSendMessage}
                                autoComplete="off"
                                spellCheck={false}
                                className="p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center gap-fib-8"
                            >
                                <SovereignVoiceInput
                                    compact
                                    module={detectedModule}
                                    contextPath={location.pathname}
                                    disabled={loading}
                                    onTranscript={(txt) =>
                                        setInputPrompt((prev) => (prev ? `${prev} ${txt}` : txt))
                                    }
                                />
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-label={t('core_ai.prompt_input_aria')}
                                    value={inputPrompt}
                                    onChange={e => setInputPrompt(e.target.value)}
                                    placeholder={t('core_ai.prompt_placeholder')}
                                    className="flex-1 min-h-[48px] px-3 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-body-main text-[#0F172A] dark:text-[#F3F4F6] outline-none font-sans rounded-none select-text"
                                />
                                <button
                                    type="submit"
                                    disabled={loading || !inputPrompt.trim()}
                                    title={t('core_ai.send_query')}
                                    aria-label={t('core_ai.send_query')}
                                    className="min-w-[48px] min-h-[48px] px-3.5 bg-[#C68346] hover:bg-[#B0743E] text-white transition-colors disabled:opacity-40 flex items-center justify-center cursor-pointer border-0 rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[20px]">send</span>
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default MiningAICopilot;
