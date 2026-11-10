import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssetPhysicalTraits } from '../../../contracts';
import { syncQueue } from '../../../core/offline/SyncQueueEngine';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    buildEquipmentShortDescription,
    type CanonicalSpecSlot,
    cleanMachineryTypeLabel,
} from '../utils/opermaqDomainProjection';
import { M3CircularProgress } from './M3ProgressIndicator';
import { M3TextField } from './M3TextField';

interface ResolvedAsset {
    global_asset_id?: string;
    existing_catalog_id?: string | null;
    catalog_key?: string;
    make_oficial: string;
    model_oficial: string;
    equipment_type_key?: string;
    categoria_equipo: string;
    tipo_equipo?: string;
    archetype_id?: string;
    canonical_specs?: CanonicalSpecSlot[];
    physical_traits?: AssetPhysicalTraits;
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    versions?: string[];
    chassis_versions?: string[];
    official_url?: string;
    isNew: boolean;
    requires_clarification?: boolean;
    clarification_message?: string;
    suggested_fields?: string[];
    is_pertinent?: boolean;
    rejection_reason?: string;
    caracteristicas_principales?: string[];
}

interface AssetRegistrationProps {
    onSuccess: (catalogId: string) => void;
    onCancel: () => void;
    isGlobalOnly?: boolean;
}

export const AssetRegistration: React.FC<AssetRegistrationProps> = ({ onSuccess, onCancel, isGlobalOnly }) => {
    const { t } = useTranslation();
    const { tenantId, actorId: userId, capabilities } = useOpermaqContext();
    const canCurateCatalog = Boolean(isGlobalOnly && capabilities.canCurateAI);

    const [mode, setMode] = useState<'brand' | 'generic'>('brand');
    const [jerga, setJerga] = useState('');
    const [clarificationInput, setClarificationInput] = useState('');
    const [candidates, setCandidates] = useState<ResolvedAsset[]>([]);
    const [candidateFilter, setCandidateFilter] = useState('');
    const [isResolving, setIsResolving] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [clarificationMsg, setClarificationMsg] = useState<string | null>(null);
    const [offlineFallbackAvailable, setOfflineFallbackAvailable] = useState(false);
    const [selectedCandidate, setSelectedCandidate] = useState<ResolvedAsset | null>(null);
    const [confirmText, setConfirmText] = useState('');
    const [selectedVersion, setSelectedVersion] = useState<string>('');

    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    const getCandidateVersions = (c: ResolvedAsset): string[] => {
        const merged = Array.from(
            new Set(
                [...(c.versions || []), ...(c.chassis_versions || [])]
                    .map((v) => String(v || '').trim())
                    .filter(Boolean)
            )
        );
        return merged.length > 0 ? merged : [t('registration.standard_version')];
    };

    const filteredCandidates = useMemo(() => {
        const q = candidateFilter.trim().toLowerCase();
        if (!q) return candidates;
        return candidates.filter((c) => {
            const haystack = [
                c.make_oficial,
                c.model_oficial,
                c.tipo_equipo || '',
                c.categoria_equipo || '',
                buildEquipmentShortDescription(c),
                ...(c.versions || []),
                ...(c.chassis_versions || []),
                ...(c.caracteristicas_principales || []),
            ]
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [candidates, candidateFilter]);

    const abortActiveSearch = () => {
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }
        setIsResolving(false);
    };

    const handleClearOrAbort = () => {
        if (isResolving) {
            abortActiveSearch();
            return;
        }
        setJerga('');
        setClarificationInput('');
        setCandidates([]);
        setCandidateFilter('');
        setErrorMsg(null);
        setClarificationMsg(null);
        setOfflineFallbackAvailable(false);
    };

    const handleEnableOfflineDraft = () => {
        const cleanJerga = jerga.trim().toUpperCase();
        if (cleanJerga.length < 2) return;
        const parts = cleanJerga.split(/\s+/);
        const makeCandidate = parts.length > 1 ? parts[0] : (mode === 'generic' ? 'GENÉRICO' : 'OEM');
        const modelCandidate = parts.length > 1 ? parts.slice(1).join(' ') : cleanJerga;
        const offlineCandidate: ResolvedAsset = {
            make_oficial: makeCandidate,
            model_oficial: modelCandidate,
            categoria_equipo: mode === 'generic' ? 'GENÉRICO' : t('registration.not_declared'),
            tipo_equipo: t('registration.not_declared'),
            ambiente_operativo: [],
            contexto_operativo: [],
            caracteristicas_principales: [],
            versions: [t('registration.standard_version')],
            chassis_versions: [t('registration.standard_version')],
            isNew: true,
            is_pertinent: true,
        };
        setOfflineFallbackAvailable(false);
        setErrorMsg(null);
        setCandidates([offlineCandidate]);
    };

    const handleSearch = async (
        overrideJerga?: string,
        forceWebDiscovery: boolean = false,
        explicitClarification?: string
    ) => {
        const searchInput = (overrideJerga ?? jerga).trim();
        if (searchInput.length < 2) return;

        const effectiveClarification = (explicitClarification ?? clarificationInput).trim();

        abortActiveSearch();
        const controller = new AbortController();
        abortRef.current = controller;

        setCandidates([]);
        setCandidateFilter('');
        setErrorMsg(null);
        setClarificationMsg(null);
        setOfflineFallbackAvailable(false);
        setIsResolving(true);

        try {
            const res = await authFetch(`${API_BASE_URL}/assets/resolve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                },
                signal: controller.signal,
                body: JSON.stringify({
                    tipo: mode === 'generic' ? 'GENÉRICO' : 'maquinaria',
                    marca: '',
                    modelo: searchInput,
                    jerga: searchInput,
                    isGeneric: mode === 'generic',
                    clarificationContext: effectiveClarification || undefined,
                    forceWebDiscovery: forceWebDiscovery || Boolean(effectiveClarification),
                }),
            });

            if (controller.signal.aborted) return;

            let data: unknown = null;
            try {
                data = await res.json();
            } catch {
                data = null;
            }

            if (!res.ok) {
                const payloadObj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
                const serverError =
                    (typeof payloadObj.message === 'string' && payloadObj.message) ||
                    (typeof payloadObj.error === 'string' && payloadObj.error) ||
                    t('registration.error_resolve_unavailable');

                if (res.status === 422) {
                    setCandidates([
                        {
                            make_oficial: '',
                            model_oficial: searchInput.toUpperCase(),
                            categoria_equipo: '',
                            isNew: false,
                            is_pertinent: false,
                            rejection_reason: serverError,
                        },
                    ]);
                    return;
                }

                setErrorMsg(serverError);
                if (!navigator.onLine) {
                    setOfflineFallbackAvailable(true);
                }
                return;
            }

            if (Array.isArray(data)) {
                if (overrideJerga) setJerga(overrideJerga);
                if (data.length === 0) {
                    setErrorMsg(t('registration.no_results'));
                } else {
                    setCandidates(data as ResolvedAsset[]);
                }
                return;
            }

            if (data && typeof data === 'object') {
                const obj = data as {
                    requires_clarification?: boolean;
                    clarification_message?: string;
                    candidates?: ResolvedAsset[];
                };
                if (obj.requires_clarification) {
                    setClarificationMsg(obj.clarification_message || t('registration.family_desc'));
                    return;
                }
                if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
                    if (overrideJerga) setJerga(overrideJerga);
                    setCandidates(obj.candidates);
                    return;
                }
            }

            setErrorMsg(t('registration.no_results'));
        } catch (err: unknown) {
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                return;
            }
            if (!navigator.onLine) {
                setErrorMsg(t('registration.offline_manual_fallback_notice'));
                setOfflineFallbackAvailable(true);
            } else {
                const msg = err instanceof Error && err.message ? err.message : t('registration.error_resolve_unavailable');
                setErrorMsg(msg);
            }
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
            if (!controller.signal.aborted) {
                setIsResolving(false);
            }
        }
    };

    const handleRegisterCatalog = async (c: ResolvedAsset) => {
        setIsRegistering(true);
        setErrorMsg(null);
        const allVersions = getCandidateVersions(c);
        const resolvedGlobalId = c.global_asset_id || c.existing_catalog_id || undefined;
        const effectiveVersion = selectedVersion || allVersions[0] || t('registration.standard_version');

        const payload = {
            global_asset_id: resolvedGlobalId,
            make_oficial: c.make_oficial || 'GENÉRICO',
            model_oficial: c.model_oficial || jerga,
            categoria_equipo: c.categoria_equipo,
            tipo_equipo: c.tipo_equipo || '',
            equipment_type_key: c.equipment_type_key,
            archetype_id: c.archetype_id,
            canonical_specs: c.canonical_specs,
            physical_traits: c.physical_traits,
            ambiente_operativo: c.ambiente_operativo || [],
            contexto_operativo: c.contexto_operativo || [],
            caracteristicas_principales: c.caracteristicas_principales || [],
            chassis_versions: allVersions,
            version: effectiveVersion,
            official_url: c.official_url || '',
            original_jargon: jerga,
            userId: userId || 'anonymous',
            tenant_id: tenantId,
            isGlobalOnly: canCurateCatalog,
        };

        try {
            const res = await authFetch(`${API_BASE_URL}/assets/add-tenant-catalog`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                },
                body: JSON.stringify(payload),
            });

            let data: Record<string, unknown> = {};
            try {
                data = await res.json();
            } catch {
                data = {};
            }

            if (res.ok) {
                onSuccess((canCurateCatalog ? data.global_asset_id : (data.tenant_asset_id || data.global_asset_id)) as string);
                return;
            }

            if (res.status >= 400 && res.status < 500) {
                const errText =
                    (typeof data.message === 'string' && data.message) ||
                    (typeof data.error === 'string' && data.error) ||
                    t('admin_catalog.error_register');
                setErrorMsg(errText);
                setIsRegistering(false);
                return;
            }
        } catch {
            // Si el endpoint no responde por red caída, encolar mutación transaccional en SyncQueueEngine (cero escritura cliente directa a global_asset_catalog)
        }

        try {
            if (!navigator.onLine) {
                const make = (c.make_oficial || 'GENÉRICO').toUpperCase();
                const model = (c.model_oficial || jerga).toUpperCase();
                const deterministicCatalogKey =
                    c.catalog_key ||
                    resolvedGlobalId ||
                    `${make}_${model}`
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '');

                const queuedTaskId = await syncQueue.enqueueApiMutation(
                    '/assets/add-tenant-catalog',
                    payload,
                    canCurateCatalog ? 'OPERMAQ_REGISTER_CATALOG' : 'OPERMAQ_REGISTER_TENANT_CATALOG',
                    tenantId || 'dev-master-sandbox'
                );
                onSuccess(canCurateCatalog ? deterministicCatalogKey : queuedTaskId);
                return;
            }

            setErrorMsg(t('admin_catalog.error_connection'));
        } catch (dbErr: unknown) {
            const msg = dbErr instanceof Error ? dbErr.message : t('admin_catalog.error_connection');
            setErrorMsg(`${t('registration.error_db_prefix')} ${msg}`);
        } finally {
            setIsRegistering(false);
        }
    };

    const handleSwitchMode = (nextMode: 'brand' | 'generic') => {
        if (nextMode === mode) return;
        abortActiveSearch();
        setMode(nextMode);
        setCandidates([]);
        setCandidateFilter('');
        setErrorMsg(null);
        setClarificationMsg(null);
        setOfflineFallbackAvailable(false);
    };

    const handleClose = () => {
        if (jerga.trim().length === 0 && candidates.length === 0 && !isResolving) {
            abortActiveSearch();
            onCancel();
        } else {
            setShowCancelConfirm(true);
        }
    };

    const handleConfirmCancel = () => {
        abortActiveSearch();
        setShowCancelConfirm(false);
        onCancel();
    };

    const flatIconBtnClass =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none';

    const selectedCandidateVersions = selectedCandidate ? getCandidateVersions(selectedCandidate) : [];
    const showClarificationSection = Boolean(
        clarificationMsg || (candidates.length > 0 && candidates[0]?.is_pertinent !== false)
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 dark:bg-black/85 p-[13px] sm:p-[21px] select-none">
            <div className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] w-full max-w-5xl h-[85vh] max-h-[860px] flex flex-col overflow-hidden shadow-none relative rounded-none">
                {/* Header Técnico Plano con Selector de Modo Integrado */}
                <header className="px-[21px] h-[55px] flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] shrink-0 gap-[13px]">
                    <div className="flex items-center gap-[21px] min-w-0 h-full">
                        <span className="text-[11px] font-mono font-bold tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] uppercase truncate">
                            {t('common.new_catalog')}
                        </span>
                        <div className="flex items-center h-full">
                            <button
                                type="button"
                                onClick={() => handleSwitchMode('brand')}
                                className={`h-full px-[13px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 border-b-2 transition-colors cursor-pointer rounded-none shadow-none ${
                                    mode === 'brand'
                                        ? 'border-[#C68346] text-[#C68346] bg-transparent'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] bg-transparent'
                                }`}
                            >
                                {t('registration.by_brand')}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSwitchMode('generic')}
                                className={`h-full px-[13px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 border-b-2 transition-colors cursor-pointer rounded-none shadow-none ${
                                    mode === 'generic'
                                        ? 'border-[#C68346] text-[#C68346] bg-transparent'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] bg-transparent'
                                }`}
                            >
                                {t('registration.generic')}
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        aria-label={t('common.cancel')}
                        title={t('common.cancel')}
                        className={flatIconBtnClass}
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </header>

                {/* Cuerpo Principal en Modo Informe Técnico */}
                <div className="flex-1 min-h-0 flex flex-col p-[21px] gap-[13px] overflow-hidden">
                    {/* Barra Primaria de Búsqueda */}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void handleSearch();
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        className="relative w-full shrink-0"
                    >
                        <M3TextField
                            label={
                                mode === 'generic'
                                    ? t('registration.generic_input_label')
                                    : t('registration.jargon_input_label')
                            }
                            value={jerga}
                            onChange={setJerga}
                            placeholder={
                                mode === 'generic'
                                    ? t('registration.generic_input_placeholder')
                                    : t('registration.jargon_input_placeholder')
                            }
                            className="!my-0"
                            inputClassName="pr-24 font-mono tabular-nums"
                            autoComplete="off"
                        />
                        <div className="absolute right-[13px] top-1/2 -translate-y-1/2 flex items-center gap-[8px]">
                            {(jerga.length > 0 || isResolving) && (
                                <button
                                    type="button"
                                    onClick={handleClearOrAbort}
                                    aria-label={
                                        isResolving ? t('registration.abort_search') : t('registration.clear_search')
                                    }
                                    title={
                                        isResolving ? t('registration.abort_search') : t('registration.clear_search')
                                    }
                                    className={flatIconBtnClass}
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            )}
                            {isResolving ? (
                                <div className="p-1 flex items-center justify-center">
                                    <M3CircularProgress size={18} strokeWidth={2.5} tone="copper" />
                                </div>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={jerga.trim().length < 2}
                                    aria-label={t('registration.identifying')}
                                    title={t('registration.identifying')}
                                    className="bg-transparent border-0 outline-none p-1 text-[#C68346] disabled:text-[#94A3B8] dark:disabled:text-[#5A6072] hover:opacity-80 transition-opacity cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                                >
                                    <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
                                </button>
                            )}
                        </div>
                    </form>

                    {/* Aviso de Especificación Requerida */}
                    {clarificationMsg && !isResolving && (
                        <div className="flex items-start gap-[13px] py-[8px] border-b border-[#00AEEF] shrink-0">
                            <span className="material-symbols-outlined text-[#00AEEF] text-[18px] shrink-0 mt-0.5">
                                info
                            </span>
                            <div className="flex-1 min-w-0">
                                <span className="block text-[11px] font-mono font-bold text-[#00AEEF] uppercase tracking-[0.05em]">
                                    {t('registration.clarification_required')}
                                </span>
                                <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                                    {clarificationMsg}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Aviso de Error */}
                    {errorMsg && (
                        <div className="flex flex-col gap-[8px] py-[8px] border-b border-[#C68346] shrink-0">
                            <div className="flex items-start gap-[13px]">
                                <span className="material-symbols-outlined text-[#C68346] text-[18px] shrink-0 mt-0.5">
                                    error
                                </span>
                                <div className="flex-1 min-w-0">
                                    <span className="block text-[11px] font-mono font-bold text-[#C68346] uppercase tracking-[0.05em]">
                                        {t('common.error')}
                                    </span>
                                    <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug break-words">
                                        {errorMsg}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setErrorMsg(null)}
                                    aria-label={t('common.cancel')}
                                    className={flatIconBtnClass}
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                            </div>

                            {offlineFallbackAvailable && (
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleEnableOfflineDraft}
                                        className="px-[13px] py-[8px] border border-[#C68346] bg-transparent text-[#C68346] hover:bg-[#C68346]/10 text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                    >
                                        {t('registration.offline_manual_fallback_btn')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Indicador de Consulta en Curso */}
                    {isResolving && (
                        <div className="flex-1 flex flex-col items-center justify-center gap-[13px]">
                            <M3CircularProgress size={28} strokeWidth={3} tone="copper" />
                            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                {t('registration.analyzing')}
                            </span>
                        </div>
                    )}

                    {/* Listado Tabular de Candidatos (Cero Tarjetas, Ancho y Alto Completo) */}
                    {candidates.length > 0 && !isResolving && (
                        <div className="flex-1 min-h-0 flex flex-col gap-[13px]">
                            {candidates[0].is_pertinent === false ? (
                                <div className="py-[13px] border-b border-[#C68346] flex items-start gap-[13px]">
                                    <span className="material-symbols-outlined text-[#C68346] text-2xl shrink-0">
                                        security_update_warning
                                    </span>
                                    <div className="space-y-[8px]">
                                        <span className="block text-[11px] font-mono font-bold uppercase text-[#C68346] tracking-[0.05em]">
                                            {t('registration.security_rejection')}
                                        </span>
                                        <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                                            {candidates[0].rejection_reason || t('registration.industrial_only')}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Barra de Cabecera del Listado + Filtro Rápido */}
                                    <div className="flex flex-wrap items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px] gap-[13px] shrink-0">
                                        <div className="flex items-center gap-[13px]">
                                            <span className="text-[11px] font-mono font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.05em]">
                                                {t('admin_catalog.tab_candidates')}
                                            </span>
                                            <span className="text-[11px] font-mono font-bold tabular-nums text-[#C68346] uppercase tracking-[0.05em]">
                                                {t('registration.matches_count', { count: filteredCandidates.length })}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-[13px] flex-1 sm:flex-initial justify-end">
                                            {candidates.length > 2 && (
                                                <div className="relative w-full sm:w-72">
                                                    <input
                                                        type="text"
                                                        value={candidateFilter}
                                                        onChange={(e) => setCandidateFilter(e.target.value)}
                                                        placeholder={t('registration.filter_versions_placeholder')}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        aria-label={t('registration.filter_versions_placeholder')}
                                                        className="w-full h-8 px-[13px] pr-8 text-[12px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] outline-none rounded-none shadow-none select-text font-mono tabular-nums"
                                                    />
                                                    {candidateFilter.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCandidateFilter('')}
                                                            aria-label={t('registration.clear_search')}
                                                            className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${flatIconBtnClass}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[15px]">
                                                                close
                                                            </span>
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => void handleSearch(undefined, true)}
                                                aria-label={t('registration.refresh_oem_web')}
                                                title={t('registration.refresh_oem_web')}
                                                className={flatIconBtnClass}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    travel_explore
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Tabla Técnica Plana de Candidatos */}
                                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 relative">
                                        {isRegistering && (
                                            <div className="absolute inset-0 z-20 bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col items-center justify-center gap-[8px]">
                                                <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                                                <span className="text-[11px] font-mono font-bold tracking-[0.05em] text-[#C68346] uppercase">
                                                    {t('registration.indexing_profile')}
                                                </span>
                                            </div>
                                        )}

                                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                            {filteredCandidates.map((c, idx) => {
                                                const candVersions = getCandidateVersions(c);
                                                const candidateKey =
                                                    c.catalog_key || `${c.make_oficial}_${c.model_oficial}_${idx}`;
                                                const cleanType = cleanMachineryTypeLabel(
                                                    c.tipo_equipo || c.categoria_equipo
                                                );
                                                const operationalDesc = buildEquipmentShortDescription(c);

                                                return (
                                                    <div
                                                        key={candidateKey}
                                                        className={`py-[13px] px-[8px] hover:bg-[#F8FAFC] dark:hover:bg-[#000000] transition-colors cursor-pointer flex items-center justify-between gap-[21px] ${
                                                            isRegistering ? 'opacity-20 pointer-events-none' : ''
                                                        }`}
                                                        onClick={() => {
                                                            setSelectedCandidate(c);
                                                            setConfirmText('');
                                                            setSelectedVersion(candVersions[0]);
                                                        }}
                                                    >
                                                        <div className="min-w-0 flex-1 space-y-[4px]">
                                                            <div className="flex flex-wrap items-baseline gap-[13px] min-w-0">
                                                                <span className="text-[15px] font-semibold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                    {c.make_oficial} {c.model_oficial}
                                                                </span>
                                                                <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                    {cleanType}
                                                                </span>
                                                            </div>
                                                            <p className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                {operationalDesc}
                                                            </p>
                                                        </div>

                                                        <div className="flex items-center gap-[13px] shrink-0 text-[11px] font-mono tabular-nums uppercase tracking-[0.05em]">
                                                            {candVersions.length > 1 && (
                                                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                    {t('registration.versions_count', {
                                                                        count: candVersions.length,
                                                                    })}
                                                                </span>
                                                            )}
                                                            <span
                                                                className={
                                                                    c.isNew ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                                                }
                                                            >
                                                                {c.isNew
                                                                    ? t('registration.status_new')
                                                                    : t('registration.status_in_catalog')}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Campo Aclaratorio Progresivo (Presente cuando los candidatos requieren precisión o cuando el sistema solicita aclaración) */}
                    {showClarificationSection && !isResolving && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (clarificationInput.trim().length > 0) {
                                    void handleSearch(undefined, true, clarificationInput.trim());
                                }
                            }}
                            autoComplete="off"
                            spellCheck={false}
                            className="pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C] shrink-0 flex flex-col gap-[8px]"
                        >
                            <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                {t('registration.clarification_toggle_label')}
                            </label>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-[13px]">
                                <input
                                    type="text"
                                    value={clarificationInput}
                                    onChange={(e) => setClarificationInput(e.target.value)}
                                    placeholder={t('registration.clarification_input_placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="flex-1 h-10 px-[13px] text-[13px] font-mono tabular-nums bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] outline-none rounded-none shadow-none select-text"
                                />
                                <button
                                    type="submit"
                                    disabled={clarificationInput.trim().length < 2 || isResolving}
                                    className="px-[21px] h-10 border border-[#00AEEF] bg-transparent hover:bg-[#00AEEF]/10 disabled:opacity-40 text-[#00AEEF] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none shrink-0"
                                >
                                    {t('registration.clarification_apply_btn')}
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                {/* Confirmación de Cancelación Opaca */}
                {showCancelConfirm && (
                    <div className="absolute inset-0 z-50 bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col items-center justify-center p-[21px] sm:p-[34px] text-center">
                        <div className="space-y-[21px] max-w-md w-full border-t border-b border-[#E2E8F0] dark:border-[#12151C] py-[21px]">
                            <div className="space-y-[8px]">
                                <span className="material-symbols-outlined text-[#C68346] text-[32px]">warning</span>
                                <p className="text-[13px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('registration.cancel_title')}
                                </p>
                                <p className="text-[13px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                    {t('registration.cancel_desc')}
                                </p>
                            </div>
                            <div className="flex gap-[13px] justify-center">
                                <button
                                    type="button"
                                    onClick={handleConfirmCancel}
                                    className="flex-1 px-[13px] py-[8px] border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-opacity cursor-pointer rounded-none shadow-none"
                                >
                                    {t('registration.yes_cancel')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowCancelConfirm(false)}
                                    className="flex-1 px-[13px] py-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                >
                                    {t('registration.no_continue')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Vista de Informe Técnico y Confirmación HITL del Candidato Seleccionado (Cero Cajas Anidadas) */}
                {selectedCandidate && (
                    <div className="absolute inset-0 z-50 bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col justify-between p-[21px]">
                        {/* Cabecera del Informe de Confirmación */}
                        <div className="flex items-center justify-between gap-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] pb-[13px] shrink-0">
                            <div className="flex items-center gap-[8px]">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedCandidate(null);
                                        setConfirmText('');
                                    }}
                                    aria-label={t('common.back')}
                                    title={t('common.back')}
                                    className={flatIconBtnClass}
                                >
                                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                </button>
                                <span className="text-[11px] font-mono font-bold tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                                    {t('registration.confirm_title')}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedCandidate(null);
                                    setConfirmText('');
                                }}
                                aria-label={t('common.cancel')}
                                title={t('common.cancel')}
                                className={flatIconBtnClass}
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        {/* Contenido del Informe Técnico */}
                        <div className="flex-1 my-[21px] overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {/* Identidad Técnica Principal */}
                            <div className="pb-[21px] space-y-[8px]">
                                <div className="flex items-center justify-between gap-[13px]">
                                    <span className="text-[11px] font-mono font-bold text-[#C68346] uppercase tracking-[0.05em]">
                                        {selectedCandidate.make_oficial}
                                    </span>
                                    <span
                                        className={`text-[11px] font-mono font-bold uppercase tracking-[0.05em] ${
                                            selectedCandidate.isNew ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                        }`}
                                    >
                                        {selectedCandidate.isNew
                                            ? t('registration.status_new_catalog')
                                            : t('registration.status_in_catalog')}
                                    </span>
                                </div>
                                <h3 className="text-[22px] font-semibold font-mono tabular-nums uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] leading-tight select-text">
                                    {selectedCandidate.model_oficial}
                                </h3>
                                <p className="text-[13px] font-mono text-[#475569] dark:text-[#8A93A6]">
                                    {cleanMachineryTypeLabel(
                                        selectedCandidate.tipo_equipo || selectedCandidate.categoria_equipo
                                    )}
                                </p>
                            </div>

                            {/* Selector Plano de Versión / Configuración */}
                            <div className="py-[21px] space-y-[13px]">
                                <span className="block text-[11px] font-mono font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.05em] tabular-nums">
                                    {t('registration.design_versions', { count: selectedCandidateVersions.length })}
                                </span>
                                <div className="flex flex-wrap gap-[8px]">
                                    {selectedCandidateVersions.map((ver) => (
                                        <button
                                            key={ver}
                                            type="button"
                                            onClick={() => setSelectedVersion(ver)}
                                            className={`px-[13px] py-[8px] border text-[12px] font-mono tabular-nums font-bold uppercase tracking-[0.03em] transition-colors cursor-pointer rounded-none shadow-none ${
                                                selectedVersion === ver
                                                    ? 'border-[#C68346] bg-[#C68346] text-[#FFFFFF]'
                                                    : 'border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346]'
                                            }`}
                                        >
                                            {ver}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Especificaciones Principales Homólogas */}
                            <div className="py-[21px] space-y-[8px]">
                                <span className="block text-[11px] font-mono font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.05em]">
                                    {t('registration.main_specs')}
                                </span>
                                <p className="text-[15px] font-mono tabular-nums leading-[1.45] text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words select-text">
                                    {buildEquipmentShortDescription(selectedCandidate)}
                                </p>
                            </div>
                        </div>

                        {/* Pie de Autorización Directa HITL ("ACTUALIZAR") */}
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault();
                                if (confirmText.trim().toUpperCase() === 'ACTUALIZAR') {
                                    const candidate = selectedCandidate;
                                    setSelectedCandidate(null);
                                    setConfirmText('');
                                    await handleRegisterCatalog(candidate);
                                }
                            }}
                            autoComplete="off"
                            spellCheck={false}
                            className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-[13px] shrink-0 flex flex-col gap-[13px]"
                        >
                            <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
                                <span className="text-[12px] text-[#475569] dark:text-[#8A93A6]">
                                    {t('registration.confirm_scale_prefix')}{' '}
                                    <strong className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                        {selectedCandidate.make_oficial} {selectedCandidate.model_oficial} (
                                        {selectedVersion})
                                    </strong>
                                    , {t('registration.confirm_scale_suffix')}{' '}
                                    <strong className="font-mono text-[#C68346] select-text">
                                        {t('registration.word_register')}
                                    </strong>
                                </span>
                            </div>

                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-[13px]">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedCandidate(null);
                                        setConfirmText('');
                                    }}
                                    className="px-[21px] h-10 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                >
                                    {t('common.back')}
                                </button>
                                <input
                                    type="text"
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                                    placeholder={t('registration.word_register')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="flex-1 h-10 px-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tracking-widest uppercase text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none select-text"
                                />
                                <button
                                    type="submit"
                                    disabled={confirmText.trim().toUpperCase() !== 'ACTUALIZAR' || isRegistering}
                                    className="px-[21px] h-10 border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 disabled:border-[#E2E8F0] dark:disabled:border-[#12151C] disabled:bg-[#F8FAFC] dark:disabled:bg-[#000000] disabled:text-[#94A3B8] dark:disabled:text-[#5A6072] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                                >
                                    {t('common.register_action')}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};
