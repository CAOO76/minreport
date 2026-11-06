import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { M3TextField } from './M3TextField';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { API_BASE_URL, db } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { authFetch } from '../utils/authFetch';
import {
    buildEquipmentShortDescription,
    type CanonicalSpecSlot,
    cleanMachineryTypeLabel,
} from '../utils/opermaqDomainProjection';
import { syncQueue } from '../../../core/offline/SyncQueueEngine';

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

    const [mode, setMode] = useState<'select' | 'generic' | 'brand'>('select');
    const [jerga, setJerga] = useState('');
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
    const [showConfirmInput, setShowConfirmInput] = useState(false);
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

    const handleSearch = async (overrideJerga?: string, forceWebDiscovery: boolean = false) => {
        const searchInput = (overrideJerga ?? jerga).trim();
        if (searchInput.length < 2) return;

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
                    forceWebDiscovery,
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
            // Si el endpoint no responde por red caída, continuar a persistencia nativa Firestore / SyncQueue
        }

        try {
            const make = (c.make_oficial || 'GENÉRICO').toUpperCase();
            const model = (c.model_oficial || jerga).toUpperCase();

            if (canCurateCatalog) {
                const docRef = await addDoc(collection(db, 'global_asset_catalog'), {
                    make_oficial: make,
                    model_oficial: model,
                    make_model: `${make} ${model}`,
                    categoria_equipo: c.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
                    tipo_equipo: c.tipo_equipo || t('registration.not_declared'),
                    archetype_id: c.archetype_id || null,
                    canonical_specs: c.canonical_specs || [],
                    ambiente_operativo: c.ambiente_operativo || [],
                    contexto_operativo: c.contexto_operativo || [],
                    caracteristicas_principales: c.caracteristicas_principales || [],
                    version: effectiveVersion,
                    versions: allVersions,
                    chassis_versions: allVersions,
                    official_url: c.official_url || '',
                    original_jargon: jerga,
                    knowledge_vault: null,
                    createdBy: userId || 'operador',
                    createdAt: serverTimestamp(),
                });
                onSuccess(docRef.id);
                return;
            }

            if (!tenantId) {
                throw new Error(t('registration.error_select_tenant'));
            }

            const tenantPayload = {
                tenant_id: tenantId,
                tenantId,
                global_asset_id: resolvedGlobalId || '',
                make_oficial: make,
                model_oficial: model,
                make_model: `${make} ${model}`,
                categoria_equipo: c.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
                tipo_equipo: c.tipo_equipo || t('registration.not_declared'),
                version: effectiveVersion,
                ownership_type: 'PROPIO',
                identifier_type: 'CODIGO_INTERNO',
                identifier_value: `EQ-${Date.now().toString().slice(-6)}`,
                status: 'ACTIVE',
                horometer: 0,
                archived: false,
                registered_by: userId || 'operador',
            };

            if (!navigator.onLine) {
                const queuedId = await syncQueue.enqueue({
                    module: 'OPERMAQ',
                    entityType: 'TENANT_ASSET',
                    targetCollection: 'tenant_assets',
                    operation: 'CREATE',
                    tenantId,
                    payload: tenantPayload,
                });
                onSuccess(queuedId);
                return;
            }

            const docRef = await addDoc(collection(db, 'tenant_assets'), {
                ...tenantPayload,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            onSuccess(docRef.id);
        } catch (dbErr: unknown) {
            const msg = dbErr instanceof Error ? dbErr.message : t('admin_catalog.error_connection');
            setErrorMsg(`${t('registration.error_db_prefix')} ${msg}`);
        } finally {
            setIsRegistering(false);
        }
    };

    const handleBackToModeSelect = () => {
        abortActiveSearch();
        setMode('select');
        setJerga('');
        setCandidates([]);
        setCandidateFilter('');
        setErrorMsg(null);
        setClarificationMsg(null);
        setOfflineFallbackAvailable(false);
    };

    const handleClose = () => {
        if (mode === 'select' || (jerga.trim().length === 0 && candidates.length === 0 && !isResolving)) {
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

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 dark:bg-black/85 p-[13px] sm:p-[21px] select-none">
            <div className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-none relative rounded-none">
                {/* Header */}
                <header className="px-[21px] py-[13px] flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
                    <div className="flex items-center gap-[8px] min-w-0">
                        {mode !== 'select' && (
                            <button
                                type="button"
                                onClick={handleBackToModeSelect}
                                aria-label={t('registration.go_back')}
                                title={t('registration.go_back')}
                                className={flatIconBtnClass}
                            >
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            </button>
                        )}
                        <span className="text-[11px] font-mono font-bold tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] uppercase truncate">
                            {mode === 'select'
                                ? t('common.new_catalog')
                                : mode === 'generic'
                                    ? t('registration.generic')
                                    : t('registration.by_brand')}
                        </span>
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

                {/* Main Content */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {mode === 'select' && (
                        <div className="p-[21px] sm:p-[34px] flex flex-col gap-[21px] items-center justify-center min-h-[220px]">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[21px] w-full">
                                <button
                                    type="button"
                                    onClick={() => setMode('brand')}
                                    className="group p-[21px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors flex flex-col items-center justify-center text-center gap-[13px] rounded-none shadow-none cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-3xl text-[#475569] dark:text-[#8A93A6] group-hover:text-[#C68346] transition-colors">
                                        precision_manufacturing
                                    </span>
                                    <div className="space-y-[8px]">
                                        <span className="block text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-[0.05em]">
                                            {t('registration.by_brand')}
                                        </span>
                                        <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] leading-snug">
                                            {t('registration.by_brand_desc')}
                                        </p>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setMode('generic')}
                                    className="group p-[21px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors flex flex-col items-center justify-center text-center gap-[13px] rounded-none shadow-none cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-3xl text-[#475569] dark:text-[#8A93A6] group-hover:text-[#C68346] transition-colors">
                                        category
                                    </span>
                                    <div className="space-y-[8px]">
                                        <span className="block text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-[0.05em]">
                                            {t('registration.generic')}
                                        </span>
                                        <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] leading-snug">
                                            {t('registration.generic_desc')}
                                        </p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {(mode === 'generic' || mode === 'brand') && (
                        <div className="p-[21px] flex flex-col gap-[13px]">
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void handleSearch();
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                className="relative w-full"
                            >
                                <M3TextField
                                    label={mode === 'generic' ? t('registration.generic_input_label') : t('registration.jargon_input_label')}
                                    value={jerga}
                                    onChange={setJerga}
                                    placeholder={mode === 'generic' ? t('registration.generic_input_placeholder') : t('registration.jargon_input_placeholder')}
                                    className="!my-0"
                                    inputClassName="pr-24"
                                    autoComplete="off"
                                />
                                <div className="absolute right-[13px] top-1/2 -translate-y-1/2 flex items-center gap-[8px]">
                                    {(jerga.length > 0 || isResolving) && (
                                        <button
                                            type="button"
                                            onClick={handleClearOrAbort}
                                            aria-label={isResolving ? t('registration.abort_search') : t('registration.clear_search')}
                                            title={isResolving ? t('registration.abort_search') : t('registration.clear_search')}
                                            className={flatIconBtnClass}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                        </button>
                                    )}
                                    {isResolving ? (
                                        <span className="material-symbols-outlined animate-spin text-[#C68346] text-[20px] p-1">
                                            progress_activity
                                        </span>
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

                            {/* Clarification Banner */}
                            {clarificationMsg && !isResolving && (
                                <div className="flex items-start gap-[13px] p-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#00AEEF] rounded-none shadow-none">
                                    <span className="material-symbols-outlined text-[#00AEEF] text-[18px] shrink-0 mt-0.5">
                                        info
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-[11px] font-bold text-[#00AEEF] uppercase tracking-[0.05em] mb-1">
                                            {t('registration.clarification_required')}
                                        </span>
                                        <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                                            {clarificationMsg}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Error Banner */}
                            {errorMsg && (
                                <div className="flex flex-col gap-[8px] p-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#C68346] rounded-none shadow-none">
                                    <div className="flex items-start gap-[13px]">
                                        <span className="material-symbols-outlined text-[#C68346] text-[18px] shrink-0 mt-0.5">
                                            error
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <span className="block text-[11px] font-bold text-[#C68346] uppercase tracking-[0.05em] mb-0.5">
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
                                        <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex justify-end">
                                            <button
                                                type="button"
                                                onClick={handleEnableOfflineDraft}
                                                className="px-[13px] py-[8px] border border-[#C68346] bg-transparent text-[#C68346] hover:bg-[#C68346]/10 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                            >
                                                {t('registration.offline_manual_fallback_btn')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Inline Loader */}
                            {isResolving && (
                                <div className="py-[21px] flex flex-col items-center justify-center gap-[8px]">
                                    <span className="material-symbols-outlined animate-spin text-[#C68346] text-[24px]">
                                        progress_activity
                                    </span>
                                    <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('registration.analyzing')}
                                    </span>
                                </div>
                            )}

                            {/* Results */}
                            {candidates.length > 0 && !isResolving && (
                                <div className="flex flex-col gap-[13px]">
                                    {candidates[0].is_pertinent === false ? (
                                        <div className="p-[13px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] flex items-start gap-[13px] rounded-none shadow-none">
                                            <span className="material-symbols-outlined text-[#C68346] text-2xl shrink-0">
                                                security_update_warning
                                            </span>
                                            <div className="space-y-[8px]">
                                                <span className="block text-[11px] font-bold uppercase text-[#C68346] tracking-[0.05em]">
                                                    {t('registration.security_rejection')}
                                                </span>
                                                <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                                                    {candidates[0].rejection_reason || t('registration.industrial_only')}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-[13px]">
                                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px] gap-[8px]">
                                                <span className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.05em]">
                                                    {t('admin_catalog.tab_candidates')}
                                                </span>
                                                <div className="flex items-center gap-[8px]">
                                                    <span className="text-[11px] font-bold font-mono tabular-nums text-[#C68346] uppercase tracking-[0.05em]">
                                                        {t('registration.matches_count', { count: filteredCandidates.length })}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleSearch(undefined, true)}
                                                        aria-label={t('registration.refresh_oem_web')}
                                                        title={t('registration.refresh_oem_web')}
                                                        className={flatIconBtnClass}
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">travel_explore</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Instant Filter for Large Equipment Lineages (1..N) */}
                                            {candidates.length > 3 && (
                                                <div className="relative w-full">
                                                    <input
                                                        type="text"
                                                        value={candidateFilter}
                                                        onChange={(e) => setCandidateFilter(e.target.value)}
                                                        placeholder={t('registration.filter_versions_placeholder')}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        aria-label={t('registration.filter_versions_placeholder')}
                                                        className="w-full h-10 px-[13px] pr-10 text-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] outline-none rounded-none shadow-none select-text font-mono tabular-nums"
                                                    />
                                                    {candidateFilter.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCandidateFilter('')}
                                                            aria-label={t('registration.clear_search')}
                                                            className={`absolute right-2 top-1/2 -translate-y-1/2 ${flatIconBtnClass}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            <div className="flex flex-col gap-[13px] max-h-[48vh] overflow-y-auto pr-1 relative">
                                                {isRegistering && (
                                                    <div className="absolute inset-0 z-20 bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col items-center justify-center gap-[8px]">
                                                        <span className="material-symbols-outlined animate-spin text-[#C68346] text-[24px]">
                                                            progress_activity
                                                        </span>
                                                        <span className="text-[11px] font-bold tracking-[0.05em] text-[#C68346] uppercase">
                                                            {t('registration.indexing_profile')}
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                    {filteredCandidates.map((c, idx) => {
                                                        const candVersions = getCandidateVersions(c);
                                                        const candidateKey = c.catalog_key || `${c.make_oficial}_${c.model_oficial}_${idx}`;
                                                        const cleanType = cleanMachineryTypeLabel(c.tipo_equipo || c.categoria_equipo);
                                                        const operationalDesc = buildEquipmentShortDescription(c);

                                                        return (
                                                            <div
                                                                key={candidateKey}
                                                                className={`py-[13px] hover:bg-[#F8FAFC] dark:hover:bg-[#000000] transition-colors cursor-pointer flex items-center justify-between gap-[13px] ${isRegistering ? 'opacity-20 pointer-events-none' : ''
                                                                    }`}
                                                                onClick={() => {
                                                                    setSelectedCandidate(c);
                                                                    setConfirmText('');
                                                                    setShowConfirmInput(false);
                                                                    setSelectedVersion(candVersions[0]);
                                                                }}
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex flex-wrap items-baseline gap-[8px] min-w-0">
                                                                        <span className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                            {c.make_oficial} {c.model_oficial}
                                                                        </span>
                                                                        <span className="text-[11px] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                            {cleanType}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                        {operationalDesc}
                                                                    </p>
                                                                </div>

                                                                <div className="flex items-center gap-[8px] shrink-0 text-[10px] font-mono tabular-nums uppercase tracking-[0.05em]">
                                                                    {candVersions.length > 1 && (
                                                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                            {t('registration.versions_count', { count: candVersions.length })}
                                                                        </span>
                                                                    )}
                                                                    <span className={c.isNew ? 'text-[#00AEEF]' : 'text-[#C68346]'}>
                                                                        {c.isNew ? t('registration.status_new') : t('registration.status_in_catalog')}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Solid Opaque Cancel Confirmation Overlay (Fixes transparent bg-surface/98 overlap bug) */}
                {showCancelConfirm && (
                    <div className="absolute inset-0 z-50 bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col items-center justify-center p-[21px] sm:p-[34px] text-center">
                        <div className="space-y-[21px] max-w-sm w-full border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] p-[21px] rounded-none shadow-none">
                            <div className="space-y-[8px]">
                                <span className="material-symbols-outlined text-[#C68346] text-[36px]">warning</span>
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('registration.cancel_title')}
                                </p>
                                <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                    {t('registration.cancel_desc')}
                                </p>
                            </div>
                            <div className="flex gap-[13px] justify-center">
                                <button
                                    type="button"
                                    onClick={handleConfirmCancel}
                                    className="flex-1 px-[13px] py-[8px] border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 text-[11px] font-bold uppercase tracking-[0.05em] transition-opacity cursor-pointer rounded-none shadow-none"
                                >
                                    {t('registration.yes_cancel')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowCancelConfirm(false)}
                                    className="flex-1 px-[13px] py-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346] text-[11px] font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                >
                                    {t('registration.no_continue')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Solid Opaque Candidate Technical Sheet & HITL Confirmation Overlay */}
                {selectedCandidate && (
                    <div className="absolute inset-0 z-50 bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col justify-between p-[21px]">
                        {/* Header of confirmation */}
                        <div className="flex items-center justify-between gap-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] pb-[13px] shrink-0">
                            <div className="flex items-center gap-[8px]">
                                <span className="material-symbols-outlined text-[#C68346] text-[20px]">
                                    {showConfirmInput ? 'security' : 'verified_user'}
                                </span>
                                <span className="text-[11px] font-bold tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                                    {showConfirmInput
                                        ? t('registration.validation_step')
                                        : t('registration.confirm_title')}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedCandidate(null);
                                    setConfirmText('');
                                    setShowConfirmInput(false);
                                }}
                                aria-label={t('common.cancel')}
                                className={flatIconBtnClass}
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        {/* Content Scrollable */}
                        <div className="flex-1 my-[13px] overflow-y-auto pr-1">
                            {!showConfirmInput ? (
                                <div className="space-y-[13px]">
                                    {/* Candidate Primary Header */}
                                    <div className="p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] relative rounded-none shadow-none">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-[#C68346]" />
                                        <div className="flex items-center justify-between mb-1 pl-[8px]">
                                            <span className="text-[11px] font-bold text-[#C68346] uppercase tracking-[0.05em]">
                                                {selectedCandidate.make_oficial}
                                            </span>
                                            {selectedCandidate.isNew ? (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-transparent text-[#00AEEF] border border-[#00AEEF] uppercase tracking-[0.05em] rounded-none">
                                                    {t('registration.status_new_catalog')}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-transparent text-[#C68346] border border-[#C68346] uppercase tracking-[0.05em] rounded-none">
                                                    {t('registration.status_in_catalog')}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-[22px] font-semibold font-mono tabular-nums uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] leading-tight mb-1 pl-[8px] select-text">
                                            {selectedCandidate.model_oficial}
                                        </h3>
                                        <p className="text-[13px] text-[#475569] dark:text-[#8A93A6] pl-[8px]">
                                            {cleanMachineryTypeLabel(
                                                selectedCandidate.tipo_equipo || selectedCandidate.categoria_equipo
                                            )}
                                        </p>
                                    </div>

                                    {/* All Versions / Series / Chassis Configurations (Zero Quantity Cap) */}
                                    <div className="space-y-[8px]">
                                        <span className="block text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.05em] font-mono tabular-nums">
                                            {t('registration.design_versions', { count: selectedCandidateVersions.length })}
                                        </span>
                                        <div className="flex flex-wrap gap-[8px]">
                                            {selectedCandidateVersions.map((ver) => (
                                                <button
                                                    key={ver}
                                                    type="button"
                                                    onClick={() => setSelectedVersion(ver)}
                                                    className={`px-[13px] py-[8px] border text-[12px] font-mono tabular-nums font-bold uppercase tracking-[0.03em] transition-colors cursor-pointer rounded-none shadow-none ${selectedVersion === ver
                                                        ? 'border-[#C68346] bg-[#C68346]/10 text-[#C68346]'
                                                        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346]'
                                                        }`}
                                                >
                                                    {ver}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Principal Distinguishing Characteristic (Full Text, Zero Truncation — Detailed Specs Live in the 5-Pillar Vault) */}
                                    <div className="space-y-[8px]">
                                        <span className="block text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.05em]">
                                            {t('registration.main_specs')}
                                        </span>
                                        <p className="text-[13px] font-mono tabular-nums leading-[1.45] text-[#0F172A] dark:text-[#F3F4F6] p-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none whitespace-normal break-words">
                                            {buildEquipmentShortDescription(selectedCandidate)}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-[21px] flex flex-col justify-center min-h-[220px] text-center">
                                    <div className="space-y-[8px] max-w-sm mx-auto">
                                        <span className="material-symbols-outlined text-[#C68346] text-[40px]">
                                            lock_open
                                        </span>
                                        <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                                            {t('registration.confirm_scale_title')}
                                        </p>
                                        <p className="text-[13px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                            {t('registration.confirm_scale_prefix')}{' '}
                                            <strong className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                {selectedCandidate.make_oficial} {selectedCandidate.model_oficial} ({selectedVersion})
                                            </strong>
                                            , {t('registration.confirm_scale_suffix')}{' '}
                                            <strong className="font-mono text-[#C68346] select-text">
                                                {t('registration.word_register')}
                                            </strong>
                                            :
                                        </p>
                                    </div>

                                    <div className="w-full max-w-xs mx-auto">
                                        <M3TextField
                                            label=""
                                            value={confirmText}
                                            onChange={setConfirmText}
                                            placeholder={t('registration.word_register')}
                                            className="!my-0"
                                            inputClassName="text-center font-mono tracking-widest uppercase"
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Buttons Footer inside overlay */}
                        <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-[13px] shrink-0">
                            {!showConfirmInput ? (
                                <div className="flex gap-[13px]">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedCandidate(null);
                                            setConfirmText('');
                                        }}
                                        className="flex-1 px-[21px] py-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346] text-[11px] font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmInput(true)}
                                        className="flex-1 px-[21px] py-[13px] border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 text-[11px] font-bold uppercase tracking-[0.05em] transition-opacity cursor-pointer rounded-none shadow-none"
                                    >
                                        {t('common.confirm')}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-[13px]">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowConfirmInput(false);
                                            setConfirmText('');
                                        }}
                                        className="flex-1 px-[21px] py-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346] text-[11px] font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                                    >
                                        {t('common.back')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (confirmText.trim().toUpperCase() === 'ACTUALIZAR') {
                                                const candidate = selectedCandidate;
                                                setSelectedCandidate(null);
                                                setConfirmText('');
                                                setShowConfirmInput(false);
                                                await handleRegisterCatalog(candidate);
                                            }
                                        }}
                                        disabled={confirmText.trim().toUpperCase() !== 'ACTUALIZAR'}
                                        className="flex-1 px-[21px] py-[13px] border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 disabled:border-[#E2E8F0] dark:disabled:border-[#12151C] disabled:bg-[#F8FAFC] dark:disabled:bg-[#000000] disabled:text-[#94A3B8] dark:disabled:text-[#5A6072] text-[11px] font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                                    >
                                        {t('common.register_action')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
