import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { getApiUrl } from '../../utils/network';
import M3LinearProgress from '../common/M3LinearProgress';
import ReadAloudButton from '../common/ReadAloudButton';
import SovereignVoiceInput, { type EphemeralVoiceAudioPayload } from '../common/SovereignVoiceInput';

export type PilotAiContextModule = 'geolapp' | 'opermaq' | 'core';
type InterventionMode = 'BUG_CORRECTION' | 'CHANGE_REQUEST' | 'AI_KNOWLEDGE_TRAINING';

interface ExtractedWisdomPreview {
    category: 'BUG_CORRECTION' | 'CHANGE_REQUEST' | 'AI_KNOWLEDGE_TRAINING' | 'FIELD_SIMULATION';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    cleanObservation: string;
    currentFichaState: string;
    proposedMaestroWisdom: string;
    expectedAiBehavior: string;
    suggestedAssetOrSurveyId?: string;
    redactedCategories: string[];
    engineMode: 'GEMINI_SWARM' | 'DETERMINISTIC_FALLBACK';
}

interface PilotLogEntry {
    id: string;
    module: string;
    category: string;
    priority: string;
    status: string;
    assetOrSurveyId?: string | null;
    observation: string;
    expectedAiBehavior?: string | null;
    timestamp?: string | null;
    createdAt?: number | null;
}

interface TestPilotAiStudioProps {
    activeContextModule?: PilotAiContextModule;
}

const MODE_OPTIONS: Array<{ id: InterventionMode; icon: string; labelKey: string }> = [
    { id: 'BUG_CORRECTION', icon: 'bug_report', labelKey: 'core_pilot_ws.ai_studio.mode_bug' },
    { id: 'CHANGE_REQUEST', icon: 'tune', labelKey: 'core_pilot_ws.ai_studio.mode_change' },
    { id: 'AI_KNOWLEDGE_TRAINING', icon: 'psychology', labelKey: 'core_pilot_ws.ai_studio.mode_train' },
];

const MODULE_OPTIONS: Array<{ id: PilotAiContextModule; labelKey: string }> = [
    { id: 'geolapp', labelKey: 'core_pilot_ws.ai_studio.module_geolapp' },
    { id: 'opermaq', labelKey: 'core_pilot_ws.ai_studio.module_opermaq' },
    { id: 'core', labelKey: 'core_pilot_ws.ai_studio.module_core' },
];

function resolveLangCode(lang: string | undefined): 'es' | 'en' | 'pt' {
    const normalized = String(lang || 'es').slice(0, 2).toLowerCase();
    if (normalized === 'en' || normalized === 'pt') return normalized;
    return 'es';
}

function formatIsoTimestamp(isoOrMs: string | number | null | undefined): string {
    if (typeof isoOrMs === 'number' && Number.isFinite(isoOrMs) && isoOrMs > 0) {
        return new Date(isoOrMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }
    if (typeof isoOrMs === 'string' && isoOrMs.trim().length > 0) {
        const parsed = Date.parse(isoOrMs);
        if (Number.isFinite(parsed) && parsed > 0) {
            return new Date(parsed).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
        }
    }
    return '';
}

export const TestPilotAiStudio: React.FC<TestPilotAiStudioProps> = ({ activeContextModule = 'core' }) => {
    const { t, i18n } = useTranslation();
    const { session } = useMinReportSession();

    const [selectedMode, setSelectedMode] = useState<InterventionMode>('AI_KNOWLEDGE_TRAINING');
    const [selectedModule, setSelectedModule] = useState<PilotAiContextModule>(activeContextModule);
    const [assetCode, setAssetCode] = useState<string>('');
    const [narrative, setNarrative] = useState<string>('');

    const [extracting, setExtracting] = useState<boolean>(false);
    const [saving, setSaving] = useState<boolean>(false);
    const [extraction, setExtraction] = useState<ExtractedWisdomPreview | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState<string>('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);

    const [logItems, setLogItems] = useState<PilotLogEntry[]>([]);
    const [loadingLog, setLoadingLog] = useState<boolean>(false);
    const [logError, setLogError] = useState<string | null>(null);

    useEffect(() => {
        setSelectedModule(activeContextModule);
    }, [activeContextModule]);

    const sandboxTenantId = useMemo(() => {
        if (!session) return 'pilot-sandbox';
        return session.tenantId || `pilot-${session.uid}`;
    }, [session]);

    const resolveAuthToken = useCallback(async (): Promise<string> => {
        const user = auth.currentUser;
        if (!user) return '';
        try {
            return await user.getIdToken();
        } catch {
            return '';
        }
    }, []);

    const fetchOwnLog = useCallback(async () => {
        setLoadingLog(true);
        setLogError(null);
        try {
            const token = await resolveAuthToken();
            const res = await fetch(getApiUrl('/api/pilot/feedback'), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.error || t('core_pilot_ws.ai_studio.log_error'));
            }
            setLogItems(Array.isArray(data?.items) ? data.items : []);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('core_pilot_ws.ai_studio.log_error');
            setLogError(msg);
        } finally {
            setLoadingLog(false);
        }
    }, [resolveAuthToken, t]);

    useEffect(() => {
        void fetchOwnLog();
    }, [fetchOwnLog]);

    const runExtraction = useCallback(
        async (ephemeralAudio?: EphemeralVoiceAudioPayload) => {
            const trimmedNarrative = narrative.trim();
            if (!ephemeralAudio && trimmedNarrative.length < 3) {
                setActionError(t('core_pilot_ws.ai_studio.narrative_required'));
                return;
            }

            setExtracting(true);
            setActionError(null);
            setActionSuccess(null);

            try {
                const token = await resolveAuthToken();
                const res = await fetch(getApiUrl('/api/pilot/feedback/extract-wisdom'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        rawNarrative: trimmedNarrative,
                        module: selectedModule,
                        contextPath: '/pilot/ai-studio',
                        assetOrSurveyId: assetCode.trim() || undefined,
                        countryCode: session?.countryCode || 'CL',
                        preferredLang: resolveLangCode(i18n.language),
                        ...(ephemeralAudio ? { ephemeralAudio } : {}),
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data?.extraction) {
                    throw new Error(data?.error || t('core_pilot_ws.ai_studio.extract_error'));
                }

                const extracted = data.extraction as ExtractedWisdomPreview;
                setExtraction(extracted);
                setConfirmKeyword('');
                if (extracted.cleanObservation && trimmedNarrative.length === 0) {
                    setNarrative(extracted.cleanObservation);
                }
                if (extracted.suggestedAssetOrSurveyId && assetCode.trim().length === 0) {
                    setAssetCode(extracted.suggestedAssetOrSurveyId);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : t('core_pilot_ws.ai_studio.extract_error');
                setActionError(msg);
            } finally {
                setExtracting(false);
            }
        },
        [assetCode, i18n.language, narrative, resolveAuthToken, selectedModule, session?.countryCode, t]
    );

    const handleCommitEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!extraction) return;
        if (confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR') return;

        setSaving(true);
        setActionError(null);
        setActionSuccess(null);

        try {
            const token = await resolveAuthToken();
            const res = await fetch(getApiUrl('/api/pilot/feedback'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    tenantId: sandboxTenantId,
                    module: selectedModule,
                    executionMode: 'integrated',
                    category: selectedMode,
                    priority: extraction.priority,
                    contextPath: '/pilot/ai-studio',
                    assetOrSurveyId: assetCode.trim() || extraction.suggestedAssetOrSurveyId || undefined,
                    observation: extraction.cleanObservation,
                    expectedAiBehavior: extraction.expectedAiBehavior,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.error || t('core_pilot_ws.ai_studio.save_error'));
            }

            setExtraction(null);
            setConfirmKeyword('');
            setNarrative('');
            setAssetCode('');
            setActionSuccess(t('core_pilot_ws.ai_studio.save_success'));
            await fetchOwnLog();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('core_pilot_ws.ai_studio.save_error');
            setActionError(msg);
        } finally {
            setSaving(false);
        }
    };

    const resolveCategoryLabel = (cat: string): string => {
        switch (cat) {
            case 'BUG_CORRECTION':
                return t('core_pilot_ws.ai_studio.cat_bug');
            case 'CHANGE_REQUEST':
                return t('core_pilot_ws.ai_studio.cat_change');
            case 'FIELD_SIMULATION':
                return t('core_pilot_ws.ai_studio.cat_sim');
            default:
                return t('core_pilot_ws.ai_studio.cat_train');
        }
    };

    const resolvePriorityLabel = (prio: string): string => {
        switch (prio) {
            case 'LOW':
                return t('core_pilot_ws.ai_studio.priority_low');
            case 'HIGH':
                return t('core_pilot_ws.ai_studio.priority_high');
            case 'CRITICAL':
                return t('core_pilot_ws.ai_studio.priority_critical');
            default:
                return t('core_pilot_ws.ai_studio.priority_medium');
        }
    };

    const resolveStatusLabel = (status: string): string => {
        switch (status) {
            case 'IN_REVIEW':
            case 'REVIEWED':
                return t('core_pilot_ws.ai_studio.status_in_review');
            case 'APPLIED_TO_AI':
                return t('core_pilot_ws.ai_studio.status_applied');
            case 'RESOLVED':
                return t('core_pilot_ws.ai_studio.status_resolved');
            default:
                return t('core_pilot_ws.ai_studio.status_open');
        }
    };

    const studioSpeechText = `${t('core_pilot_ws.ai_studio.heading')}. ${t('core_pilot_ws.ai_studio.subtitle')}`;
    const isHitlConfirmed = confirmKeyword.trim().toUpperCase() === 'ACTUALIZAR';

    return (
        <div className="flex-1 min-h-0 overflow-y-auto p-fib-34 space-y-fib-21 bg-[#FFFFFF] dark:bg-[#000000]">
            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex flex-wrap items-end justify-between gap-fib-21">
                <div className="space-y-fib-8">
                    <p className="text-microcopy font-mono uppercase tracking-widest text-[#C68346]">
                        {t('core_pilot_ws.ai_studio.eyebrow')}
                    </p>
                    <h1 className="text-h1-header font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-tight">
                        {t('core_pilot_ws.ai_studio.heading')}
                    </h1>
                    <p className="text-body-main font-sans text-[#475569] dark:text-[#8A93A6] max-w-3xl">
                        {t('core_pilot_ws.ai_studio.subtitle')}
                    </p>
                </div>
                <ReadAloudButton compact text={studioSpeechText} />
            </div>

            {/* Macro-Layout Paramétrico Áureo 61.8% / 38.2% */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.618fr_1fr] gap-fib-21 items-start">
                {/* Área Mayor (61.8%): Captura multimodal, Extracción Ley 21.719 y Confirmación HITL */}
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-21">
                    {/* Selector de 3 modos */}
                    <div className="space-y-fib-8">
                        <p className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('core_pilot_ws.ai_studio.mode_label')}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-8">
                            {MODE_OPTIONS.map((mode) => {
                                const active = selectedMode === mode.id;
                                return (
                                    <button
                                        key={mode.id}
                                        type="button"
                                        onClick={() => setSelectedMode(mode.id)}
                                        className={`min-h-[48px] px-fib-13 py-fib-13 border text-left rounded-none shadow-none cursor-pointer transition-colors flex items-center gap-fib-8 ${
                                            active
                                                ? 'border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]'
                                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#475569] dark:text-[#8A93A6] hover:border-[#C68346]/60'
                                        }`}
                                    >
                                        <span
                                            className={`material-symbols-outlined text-[18px] ${
                                                active ? 'text-[#C68346]' : 'text-[#94A3B8] dark:text-[#5A6072]'
                                            }`}
                                        >
                                            {mode.icon}
                                        </span>
                                        <span className="text-microcopy font-mono uppercase tracking-wider">
                                            {t(mode.labelKey)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Selector de Módulo y Código Activo */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                        <div className="space-y-fib-8">
                            <p className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                {t('core_pilot_ws.ai_studio.module_label')}
                            </p>
                            <div className="grid grid-cols-3 gap-fib-8">
                                {MODULE_OPTIONS.map((mod) => {
                                    const active = selectedModule === mod.id;
                                    return (
                                        <button
                                            key={mod.id}
                                            type="button"
                                            onClick={() => setSelectedModule(mod.id)}
                                            className={`min-h-[48px] px-fib-8 py-fib-8 border text-center rounded-none shadow-none cursor-pointer transition-colors text-microcopy font-mono uppercase ${
                                                active
                                                    ? 'border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] text-[#00AEEF]'
                                                    : 'border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#475569] dark:text-[#8A93A6] hover:border-[#00AEEF]/60'
                                            }`}
                                        >
                                            {t(mod.labelKey)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-fib-8">
                            <label
                                htmlFor="pilot-studio-asset-code"
                                className="block text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('core_pilot_ws.ai_studio.asset_code_label')}
                            </label>
                            <input
                                id="pilot-studio-asset-code"
                                type="text"
                                value={assetCode}
                                onChange={(e) => setAssetCode(e.target.value)}
                                placeholder={t('core_pilot_ws.ai_studio.asset_code_placeholder')}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[48px] px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] focus:border-[#00AEEF] focus:outline-none rounded-none shadow-none select-text"
                            />
                        </div>
                    </div>

                    {/* Captura Multimodal Voz / Texto */}
                    <div className="space-y-fib-13">
                        <div className="flex flex-wrap items-center justify-between gap-fib-13">
                            <label
                                htmlFor="pilot-studio-narrative"
                                className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('core_pilot_ws.ai_studio.narrative_label')}
                            </label>
                            <SovereignVoiceInput
                                compact
                                module={selectedModule === 'geolapp' ? 'stockpile' : selectedModule}
                                contextPath="/pilot/ai-studio"
                                label={t('core_pilot_ws.ai_studio.voice_label')}
                                disabled={extracting || saving}
                                onTranscript={(spoken) =>
                                    setNarrative((prev) => (prev.trim().length > 0 ? `${prev.trim()} ${spoken}` : spoken))
                                }
                                onAudioCaptured={runExtraction}
                            />
                        </div>

                        <textarea
                            id="pilot-studio-narrative"
                            rows={4}
                            value={narrative}
                            onChange={(e) => setNarrative(e.target.value)}
                            placeholder={t('core_pilot_ws.ai_studio.narrative_placeholder')}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-body-main font-sans text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] focus:border-[#00AEEF] focus:outline-none rounded-none shadow-none select-text"
                        />

                        <div className="flex flex-wrap items-center justify-between gap-fib-13">
                            <button
                                type="button"
                                onClick={() => void runExtraction()}
                                disabled={extracting || saving}
                                className="min-h-[48px] px-fib-21 py-fib-13 border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:bg-[#b57439] disabled:opacity-50 text-microcopy font-mono uppercase tracking-wider cursor-pointer rounded-none shadow-none transition-colors"
                            >
                                {t('core_pilot_ws.ai_studio.extract_btn')}
                            </button>
                        </div>

                        {extracting && (
                            <M3LinearProgress indeterminate ariaLabel={t('core_pilot_ws.ai_studio.extracting_aria')} />
                        )}
                    </div>

                    {actionError && (
                        <div className="border border-red-500/60 bg-red-50 dark:bg-red-950/20 p-fib-13 rounded-none text-data-dense font-mono text-red-700 dark:text-red-300">
                            {actionError}
                        </div>
                    )}

                    {actionSuccess && (
                        <div className="border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] p-fib-13 rounded-none text-data-dense font-mono text-[#00AEEF]">
                            {actionSuccess}
                        </div>
                    )}

                    {/* Comparativa HITL [Actual] -> [Sugerido] y Confirmación Obligatoria "ACTUALIZAR" */}
                    {extraction && (
                        <form
                            onSubmit={handleCommitEntry}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] p-fib-21 rounded-none shadow-none space-y-fib-21"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <p className="text-microcopy font-mono uppercase tracking-wider text-[#00AEEF]">
                                    {t('core_pilot_ws.ai_studio.hitl_header')}
                                </p>
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_pilot_ws.ai_studio.engine_label')}: {extraction.engineMode}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 rounded-none space-y-fib-8">
                                    <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_pilot_ws.ai_studio.current_state_label')}
                                    </p>
                                    <p className="text-data-dense font-sans text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                        {extraction.currentFichaState}
                                    </p>
                                </div>

                                <div className="border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 rounded-none space-y-fib-8">
                                    <p className="text-microcopy font-mono uppercase text-[#C68346]">
                                        {t('core_pilot_ws.ai_studio.suggested_state_label')}
                                    </p>
                                    <p className="text-data-dense font-sans text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                        {extraction.proposedMaestroWisdom}
                                    </p>
                                </div>
                            </div>

                            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 rounded-none space-y-fib-8">
                                <div className="flex flex-wrap items-center justify-between gap-fib-8">
                                    <p className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                        {t('core_pilot_ws.ai_studio.expected_ai_label')}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-fib-8">
                                        <span className="border border-[#E2E8F0] dark:border-[#12151C] px-fib-8 py-1 text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_pilot_ws.ai_studio.category_label')}: {resolveCategoryLabel(selectedMode)}
                                        </span>
                                        <span className="border border-[#E2E8F0] dark:border-[#12151C] px-fib-8 py-1 text-microcopy font-mono uppercase text-[#C68346]">
                                            {t('core_pilot_ws.ai_studio.priority_label')}: {resolvePriorityLabel(extraction.priority)}
                                        </span>
                                    </div>
                                </div>
                                <p className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                    {extraction.expectedAiBehavior}
                                </p>
                            </div>

                            {/* Chips ISO de categorías PII purgadas por esclusa Ley 21.719 */}
                            <div className="space-y-fib-8">
                                <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_pilot_ws.ai_studio.redacted_pii_label')}
                                </p>
                                <div className="flex flex-wrap gap-fib-8">
                                    {extraction.redactedCategories.length > 0 ? (
                                        extraction.redactedCategories.map((cat) => (
                                            <span
                                                key={cat}
                                                className="border border-[#00AEEF] px-fib-8 py-1 text-microcopy font-mono uppercase text-[#00AEEF] rounded-none"
                                            >
                                                CL · {cat}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="border border-[#E2E8F0] dark:border-[#12151C] px-fib-8 py-1 text-microcopy font-mono uppercase text-[#94A3B8] dark:text-[#5A6072] rounded-none">
                                            {t('core_pilot_ws.ai_studio.redacted_none')}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Confirmación HITL obligatoria "ACTUALIZAR" */}
                            <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13 space-y-fib-8">
                                <label
                                    htmlFor="pilot-hitl-confirm-input"
                                    className="block text-microcopy font-mono uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]"
                                >
                                    {t('core_pilot_ws.ai_studio.confirm_keyword_label')}
                                </label>
                                <div className="flex flex-col sm:flex-row gap-fib-13">
                                    <input
                                        id="pilot-hitl-confirm-input"
                                        type="text"
                                        value={confirmKeyword}
                                        onChange={(e) => setConfirmKeyword(e.target.value)}
                                        placeholder={t('core_pilot_ws.ai_studio.confirm_keyword_placeholder')}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="flex-1 min-h-[48px] px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-data-dense font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] focus:border-[#C68346] focus:outline-none rounded-none shadow-none select-text"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!isHitlConfirmed || saving}
                                        className="min-h-[48px] px-fib-21 py-fib-13 border border-[#00AEEF] bg-[#00AEEF] text-[#000000] font-mono text-microcopy uppercase tracking-wider font-bold disabled:opacity-40 cursor-pointer rounded-none shadow-none transition-colors"
                                    >
                                        {t('core_pilot_ws.ai_studio.save_btn')}
                                    </button>
                                </div>
                                <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_pilot_ws.ai_studio.confirm_keyword_hint')}
                                </p>
                            </div>

                            {saving && (
                                <M3LinearProgress indeterminate ariaLabel={t('core_pilot_ws.ai_studio.saving_aria')} />
                            )}
                        </form>
                    )}
                </section>

                {/* Área Menor (38.2%): Bitácora verificable de solo lectura */}
                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                    <div className="flex items-start justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                        <div className="space-y-1">
                            <p className="text-microcopy font-mono uppercase tracking-wider text-[#00AEEF]">
                                {t('core_pilot_ws.ai_studio.log_eyebrow')}
                            </p>
                            <h2 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('core_pilot_ws.ai_studio.log_heading')}
                            </h2>
                            <p className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                {logItems.length} {t('core_pilot_ws.ai_studio.log_total_label')}
                            </p>
                        </div>
                        <div className="flex items-center gap-fib-8">
                            <ReadAloudButton
                                compact
                                text={
                                    logItems.length > 0
                                        ? `${t('core_pilot_ws.ai_studio.log_heading')}. ${logItems
                                              .slice(0, 5)
                                              .map((it) => `${it.module}: ${it.observation}`)
                                              .join('. ')}`
                                        : `${t('core_pilot_ws.ai_studio.log_heading')}. ${t('core_pilot_ws.ai_studio.log_empty')}`
                                }
                            />
                            <button
                                type="button"
                                onClick={() => void fetchOwnLog()}
                                title={t('core_pilot_ws.ai_studio.log_refresh_aria')}
                                aria-label={t('core_pilot_ws.ai_studio.log_refresh_aria')}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[20px]">refresh</span>
                                <span className="sr-only">{t('core_pilot_ws.ai_studio.log_refresh_aria')}</span>
                            </button>
                        </div>
                    </div>

                    {loadingLog && (
                        <M3LinearProgress indeterminate ariaLabel={t('core_pilot_ws.ai_studio.log_loading_aria')} />
                    )}

                    {logError && (
                        <div className="border border-red-500/60 p-fib-13 text-data-dense font-mono text-red-600 dark:text-red-400 rounded-none">
                            {logError}
                        </div>
                    )}

                    {!loadingLog && logItems.length === 0 && !logError && (
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {t('core_pilot_ws.ai_studio.log_empty')}
                        </p>
                    )}

                    <div className="space-y-fib-13 max-h-[640px] overflow-y-auto">
                        {logItems.map((entry) => {
                            const formattedTs = formatIsoTimestamp(entry.timestamp || entry.createdAt);
                            return (
                                <article
                                    key={entry.id}
                                    className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-fib-13 rounded-none shadow-none space-y-fib-8"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                            {String(entry.module || 'core').toUpperCase()} · {resolveCategoryLabel(entry.category)}
                                        </span>
                                        <div className="flex items-center gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {resolvePriorityLabel(entry.priority)}
                                            </span>
                                            <span className="border border-[#E2E8F0] dark:border-[#12151C] px-fib-8 py-0.5 text-microcopy font-mono uppercase text-[#00AEEF] rounded-none">
                                                {resolveStatusLabel(entry.status)}
                                            </span>
                                        </div>
                                    </div>

                                    {entry.assetOrSurveyId && (
                                        <p className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text">
                                            ID: {entry.assetOrSurveyId}
                                        </p>
                                    )}

                                    <p className="text-data-dense font-sans text-[#0F172A] dark:text-[#F3F4F6] line-clamp-3">
                                        {entry.observation}
                                    </p>

                                    {entry.expectedAiBehavior && (
                                        <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] border-l-2 border-[#00AEEF] pl-fib-8 line-clamp-2">
                                            {entry.expectedAiBehavior}
                                        </p>
                                    )}

                                    <div className="flex items-center justify-between gap-fib-8 pt-1">
                                        <span className="text-microcopy font-mono tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                                            {formattedTs || t('core_pilot_ws.pending_record')}
                                        </span>
                                        <ReadAloudButton
                                            compact
                                            text={`${entry.module}. ${entry.observation}. ${entry.expectedAiBehavior || ''}`}
                                        />
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default TestPilotAiStudio;
