import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueue } from '../../../core/offline/SyncQueueEngine';
import type { FleetIdentifierType, FleetOwnershipCondition } from '../../../contracts';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    buildEquipmentShortDescription,
    type CanonicalSpecSlot,
    cleanMachineryTypeLabel,
} from '../utils/opermaqDomainProjection';
import { M3TextField } from './M3TextField';
import { SecureCasThumbnail } from './SecureCasThumbnail';

interface CatalogLookupItem {
    global_asset_id?: string;
    existing_catalog_id?: string | null;
    catalog_key?: string;
    make_oficial: string;
    model_oficial: string;
    equipment_type_key?: string;
    categoria_equipo?: string;
    tipo_equipo?: string;
    archetype_id?: string;
    canonical_specs?: CanonicalSpecSlot[];
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    caracteristicas_principales?: string[];
    short_description?: string;
    foto_url?: string;
    versions?: string[];
    chassis_versions?: string[];
    official_url?: string;
    isNew?: boolean;
    is_pertinent?: boolean;
    rejection_reason?: string;
}

interface FleetUnitRegistrationModalProps {
    onSuccess: (result: { tenantAssetId: string; globalAssetId: string }) => void;
    onCancel: () => void;
}

export const FleetUnitRegistrationModal: React.FC<FleetUnitRegistrationModalProps> = ({
    onSuccess,
    onCancel,
}) => {
    const { t } = useTranslation();
    const { tenantId, actorId } = useOpermaqContext();

    const [searchScope, setSearchScope] = useState<'brand' | 'generic'>('brand');
    const [step, setStep] = useState<'DETECT_OR_HUNT' | 'OWNERSHIP_SERIAL'>('DETECT_OR_HUNT');

    const [queryText, setQueryText] = useState('');
    const [localMatches, setLocalMatches] = useState<CatalogLookupItem[]>([]);
    const [isCheckingLocal, setIsCheckingLocal] = useState(false);
    const [hasCheckedLocal, setHasCheckedLocal] = useState(false);

    const [huntedCandidates, setHuntedCandidates] = useState<CatalogLookupItem[]>([]);
    const [candidateFilter, setCandidateFilter] = useState('');
    const [isHuntingWeb, setIsHuntingWeb] = useState(false);
    const [clarificationMsg, setClarificationMsg] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [selectedEquipment, setSelectedEquipment] = useState<CatalogLookupItem | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<string>('ESTÁNDAR');
    const [identifierType, setIdentifierType] = useState<FleetIdentifierType>('SERIAL_NUMBER');
    const [identifierValue, setIdentifierValue] = useState<string>('');
    const [ownershipType, setOwnershipType] = useState<FleetOwnershipCondition>('PROPIO');
    const [horometer, setHorometer] = useState<string>('0');
    const [privatePhotoFile, setPrivatePhotoFile] = useState<File | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    const abortRef = useRef<AbortController | null>(null);
    const photoInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // Paso 1 Automático: Detección instantánea en CATÁLOGO (`global_asset_catalog`) al escribir >= 2 caracteres
    useEffect(() => {
        if (step !== 'DETECT_OR_HUNT') return;
        const clean = queryText.trim();
        if (clean.length < 2) {
            setLocalMatches([]);
            setHasCheckedLocal(false);
            setIsCheckingLocal(false);
            return;
        }

        const timer = window.setTimeout(async () => {
            setIsCheckingLocal(true);
            try {
                const params = new URLSearchParams({
                    q: clean,
                    isGeneric: String(searchScope === 'generic'),
                });
                const res = await authFetch(`${API_BASE_URL}/assets/catalog-lookup?${params.toString()}`, {
                    headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
                });
                if (res.ok) {
                    const payload = await res.json();
                    setLocalMatches(Array.isArray(payload?.items) ? payload.items : []);
                    setHasCheckedLocal(true);
                }
            } catch {
                // Silencioso en autocompletado
            } finally {
                setIsCheckingLocal(false);
            }
        }, 220);

        return () => window.clearTimeout(timer);
    }, [queryText, searchScope, step, tenantId]);

    const getEquipmentVersions = (item: CatalogLookupItem): string[] => {
        const merged = Array.from(
            new Set(
                [...(item.versions || []), ...(item.chassis_versions || [])]
                    .map((v) => String(v || '').trim())
                    .filter(Boolean)
            )
        );
        return merged.length > 0 ? merged : [t('registration.standard_version')];
    };

    const triggerCandidateHunter = async (forceWebDiscovery: boolean = false) => {
        const clean = queryText.trim();
        if (clean.length < 2) return;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setErrorMsg(null);
        setClarificationMsg(null);
        setHuntedCandidates([]);
        setCandidateFilter('');
        setIsHuntingWeb(true);

        try {
            const res = await authFetch(`${API_BASE_URL}/assets/resolve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                },
                signal: controller.signal,
                body: JSON.stringify({
                    tipo: searchScope === 'generic' ? 'GENÉRICO' : 'maquinaria',
                    marca: '',
                    modelo: clean,
                    jerga: clean,
                    isGeneric: searchScope === 'generic',
                    forceWebDiscovery,
                }),
            });

            if (controller.signal.aborted) return;
            const data = await res.json().catch(() => null);

            if (!res.ok) {
                const msg =
                    (data && typeof data === 'object' && (data.message || data.error)) ||
                    t('registration.error_resolve_unavailable');
                setErrorMsg(String(msg));
                return;
            }

            if (Array.isArray(data)) {
                setHuntedCandidates(data);
                if (data.length === 0) {
                    setErrorMsg(t('registration.no_results'));
                }
                return;
            }

            if (data && typeof data === 'object') {
                if (data.requires_clarification) {
                    setClarificationMsg(String(data.clarification_message || t('registration.family_desc')));
                    return;
                }
                if (Array.isArray(data.candidates)) {
                    setHuntedCandidates(data.candidates);
                    return;
                }
            }

            setErrorMsg(t('registration.no_results'));
        } catch (err: unknown) {
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                return;
            }
            setErrorMsg(err instanceof Error ? err.message : t('registration.error_resolve_unavailable'));
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
            if (!controller.signal.aborted) {
                setIsHuntingWeb(false);
            }
        }
    };

    const handleSearchSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const clean = queryText.trim();
        if (clean.length < 2) return;

        // 1º Verificar en CATÁLOGO local: si NO existe coincidencia local, activar automáticamente el buscador de candidatos
        setIsCheckingLocal(true);
        try {
            const params = new URLSearchParams({
                q: clean,
                isGeneric: String(searchScope === 'generic'),
            });
            const res = await authFetch(`${API_BASE_URL}/assets/catalog-lookup?${params.toString()}`, {
                headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
            });
            if (res.ok) {
                const payload = await res.json();
                const items: CatalogLookupItem[] = Array.isArray(payload?.items) ? payload.items : [];
                setLocalMatches(items);
                setHasCheckedLocal(true);
                setIsCheckingLocal(false);
                if (items.length === 0) {
                    await triggerCandidateHunter(false);
                }
                return;
            }
        } catch {
            // Si falla lookup rápido, intentar caza directa
        }
        setIsCheckingLocal(false);
        await triggerCandidateHunter(false);
    };

    const handleSelectEquipment = (item: CatalogLookupItem, explicitVersion?: string) => {
        const versions = getEquipmentVersions(item);
        setSelectedEquipment(item);
        setSelectedVersion(explicitVersion || versions[0] || 'ESTÁNDAR');
        setConfirmKeyword('');
        setErrorMsg(null);
        setStep('OWNERSHIP_SERIAL');
    };

    const filteredHuntedCandidates = useMemo(() => {
        const q = candidateFilter.trim().toLowerCase();
        if (!q) return huntedCandidates;
        return huntedCandidates.filter((c) => {
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
    }, [huntedCandidates, candidateFilter]);

    const uploadOptionalPrivatePhoto = async (tenantAssetId: string, file: File) => {
        try {
            let uploadFile: File | Blob = file;
            try {
                const digested = await mediaDigestorClient.digestFile(file, 'IMAGE_FIELD_EVIDENCE');
                uploadFile = digested.blob;
            } catch {
                uploadFile = file;
            }
            const form = new FormData();
            form.append('file', uploadFile, file.name || 'equipo_flota.webp');
            await authFetch(`${API_BASE_URL}/assets/${tenantAssetId}/private-photo`, {
                method: 'POST',
                headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
                body: form,
            });
        } catch {
            // No bloquear el alta si la foto opcional falla; puede subirse desde la ficha de unidad
        }
    };

    const handleEnrollFleetUnit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEquipment) return;
        if (!tenantId) {
            setErrorMsg(t('registration.error_select_tenant'));
            return;
        }
        const cleanId = identifierValue.trim().toUpperCase();
        if (cleanId.length < 2 || confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR') {
            return;
        }

        setIsSubmitting(true);
        setErrorMsg(null);

        const allVersions = getEquipmentVersions(selectedEquipment);
        const resolvedGlobalId =
            selectedEquipment.global_asset_id || selectedEquipment.existing_catalog_id || undefined;
        const parsedHorometer = Math.max(0, Number(horometer) || 0);

        const bodyPayload = {
            global_asset_id: resolvedGlobalId,
            make_oficial: selectedEquipment.make_oficial || 'GENÉRICO',
            model_oficial: selectedEquipment.model_oficial || queryText.trim().toUpperCase(),
            categoria_equipo: selectedEquipment.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
            tipo_equipo: selectedEquipment.tipo_equipo || '',
            equipment_type_key: selectedEquipment.equipment_type_key,
            archetype_id: selectedEquipment.archetype_id,
            canonical_specs: selectedEquipment.canonical_specs,
            ambiente_operativo: selectedEquipment.ambiente_operativo || [],
            contexto_operativo: selectedEquipment.contexto_operativo || [],
            caracteristicas_principales: selectedEquipment.caracteristicas_principales || [],
            chassis_versions: allVersions,
            version: selectedVersion || 'ESTÁNDAR',
            official_url: selectedEquipment.official_url || '',
            original_jargon: queryText.trim(),
            isGeneric: searchScope === 'generic',
            identifier_type: identifierType,
            identifier_value: cleanId,
            ownership_type: ownershipType,
            horometer: parsedHorometer,
            confirm_word: 'ACTUALIZAR' as const,
        };

        try {
            const res = await authFetch(`${API_BASE_URL}/assets/register-fleet-unit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Active-Account-Id': tenantId,
                },
                body: JSON.stringify(bodyPayload),
            });

            const json = await res.json().catch(() => ({}));
            if (res.ok && json?.tenant_asset_id) {
                if (privatePhotoFile) {
                    await uploadOptionalPrivatePhoto(String(json.tenant_asset_id), privatePhotoFile);
                }
                onSuccess({
                    tenantAssetId: String(json.tenant_asset_id),
                    globalAssetId: String(json.global_asset_id || resolvedGlobalId || ''),
                });
                return;
            }

            if (res.status >= 400 && res.status < 500) {
                setErrorMsg(String(json?.message || json?.error || t('common.error')));
                setIsSubmitting(false);
                return;
            }
        } catch {
            // Fallback Offline-First si no hay conexión en terreno y el modelo ya existía en CATÁLOGO
            if (!navigator.onLine && resolvedGlobalId) {
                const queuedId = await syncQueue.enqueue({
                    module: 'OPERMAQ',
                    entityType: 'TENANT_ASSET',
                    targetCollection: 'tenant_assets',
                    operation: 'CREATE',
                    tenantId,
                    payload: {
                        tenant_id: tenantId,
                        tenantId,
                        global_asset_id: resolvedGlobalId,
                        make_oficial: bodyPayload.make_oficial.toUpperCase(),
                        model_oficial: bodyPayload.model_oficial.toUpperCase(),
                        make_model: `${bodyPayload.make_oficial.toUpperCase()} ${bodyPayload.model_oficial.toUpperCase()}`,
                        categoria_equipo: bodyPayload.categoria_equipo,
                        tipo_equipo: bodyPayload.tipo_equipo || t('opermaq_domains.not_declared'),
                        version: bodyPayload.version,
                        identifier_type: identifierType,
                        identifier_value: cleanId,
                        serial_number: cleanId,
                        ownership_type: ownershipType,
                        horometer: parsedHorometer,
                        status: 'OPERATIVO',
                        archived: false,
                        registered_by: actorId || 'operador',
                    },
                });
                onSuccess({
                    tenantAssetId: queuedId,
                    globalAssetId: resolvedGlobalId,
                });
                return;
            }
        }

        setErrorMsg(t('registration.error_resolve_unavailable'));
        setIsSubmitting(false);
    };

    const flatIconBtnClass =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none';

    const selectedVersions = selectedEquipment ? getEquipmentVersions(selectedEquipment) : ['ESTÁNDAR'];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 dark:bg-black/85 p-[13px] sm:p-[21px] select-none">
            <div className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-none shadow-none">
                {/* Cabecera Quirúrgica */}
                <header className="px-[21px] py-[13px] flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] shrink-0">
                    <div className="flex items-center gap-[8px] min-w-0">
                        {step === 'OWNERSHIP_SERIAL' && (
                            <button
                                type="button"
                                onClick={() => {
                                    setStep('DETECT_OR_HUNT');
                                    setErrorMsg(null);
                                }}
                                title={t('registration.go_back')}
                                aria-label={t('registration.go_back')}
                                className={flatIconBtnClass}
                            >
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            </button>
                        )}
                        <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {step === 'DETECT_OR_HUNT'
                                ? t('opermaq_domains.step1_title')
                                : t('opermaq_domains.step2_title')}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            abortRef.current?.abort();
                            onCancel();
                        }}
                        title={t('common.cancel')}
                        aria-label={t('common.cancel')}
                        className={flatIconBtnClass}
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </header>

                <div className="flex-1 min-h-0 overflow-y-auto p-[21px] flex flex-col gap-[21px]">
                    {errorMsg && (
                        <div className="p-[13px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] flex items-start justify-between gap-[13px] rounded-none shadow-none">
                            <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug break-words">
                                {errorMsg}
                            </p>
                            <button
                                type="button"
                                onClick={() => setErrorMsg(null)}
                                aria-label={t('common.cancel')}
                                className={flatIconBtnClass}
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        </div>
                    )}

                    {step === 'DETECT_OR_HUNT' && (
                        <>
                            {/* Selector Compacto Marca vs Genérico */}
                            <div className="grid grid-cols-2 border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchScope('brand');
                                        setHuntedCandidates([]);
                                    }}
                                    className={`h-9 text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none border-0 ${searchScope === 'brand'
                                        ? 'bg-[#C68346] text-white'
                                        : 'bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                        }`}
                                >
                                    {t('registration.by_brand')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchScope('generic');
                                        setHuntedCandidates([]);
                                    }}
                                    className={`h-9 text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none border-0 border-l border-[#E2E8F0] dark:border-[#12151C] ${searchScope === 'generic'
                                        ? 'bg-[#C68346] text-white'
                                        : 'bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                        }`}
                                >
                                    {t('registration.generic')}
                                </button>
                            </div>

                            {/* Buscador con Detección Instantánea en CATÁLOGO */}
                            <form
                                onSubmit={handleSearchSubmit}
                                autoComplete="off"
                                spellCheck={false}
                                className="relative w-full"
                            >
                                <M3TextField
                                    label={
                                        searchScope === 'generic'
                                            ? t('registration.generic_input_label')
                                            : t('registration.jargon_input_label')
                                    }
                                    value={queryText}
                                    onChange={(val) => {
                                        setQueryText(val);
                                        if (huntedCandidates.length > 0) setHuntedCandidates([]);
                                    }}
                                    placeholder={
                                        searchScope === 'generic'
                                            ? t('registration.generic_input_placeholder')
                                            : t('registration.jargon_input_placeholder')
                                    }
                                    className="!my-0"
                                    inputClassName="pr-24"
                                    autoComplete="off"
                                />
                                <div className="absolute right-[13px] top-1/2 -translate-y-1/2 flex items-center gap-[8px]">
                                    {(queryText.length > 0 || isHuntingWeb) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isHuntingWeb) {
                                                    abortRef.current?.abort();
                                                    setIsHuntingWeb(false);
                                                    return;
                                                }
                                                setQueryText('');
                                                setLocalMatches([]);
                                                setHuntedCandidates([]);
                                                setClarificationMsg(null);
                                                setErrorMsg(null);
                                            }}
                                            title={t('registration.clear_search')}
                                            aria-label={t('registration.clear_search')}
                                            className={flatIconBtnClass}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                        </button>
                                    )}
                                    {isCheckingLocal || isHuntingWeb ? (
                                        <span className="material-symbols-outlined animate-spin text-[#C68346] text-[20px] p-1">
                                            progress_activity
                                        </span>
                                    ) : (
                                        <button
                                            type="submit"
                                            disabled={queryText.trim().length < 2}
                                            title={t('registration.identifying')}
                                            aria-label={t('registration.identifying')}
                                            className="bg-transparent border-0 outline-none p-1 text-[#C68346] disabled:text-[#94A3B8] dark:disabled:text-[#5A6072] cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
                                        </button>
                                    )}
                                </div>
                            </form>

                            {clarificationMsg && (
                                <div className="p-[13px] border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#000000] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none">
                                    {clarificationMsg}
                                </div>
                            )}

                            {/* CASO A: Resultados Existentes en CATÁLOGO */}
                            {localMatches.length > 0 && (
                                <div className="flex flex-col gap-[8px]">
                                    <div className="flex items-center justify-between pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                        <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                            {t('opermaq_domains.catalog_match_found')} ({localMatches.length})
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => void triggerCandidateHunter(true)}
                                            title={t('opermaq_domains.search_global_candidates')}
                                            aria-label={t('opermaq_domains.search_global_candidates')}
                                            className={flatIconBtnClass}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">manage_search</span>
                                        </button>
                                    </div>

                                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {localMatches.map((item) => {
                                            const itemVersions = getEquipmentVersions(item);
                                            const officialName = `${item.make_oficial} ${item.model_oficial}`.trim();
                                            const cleanType = cleanMachineryTypeLabel(item.tipo_equipo || item.categoria_equipo);
                                            const operationalDesc = buildEquipmentShortDescription(item);

                                            return (
                                                <div
                                                    key={item.global_asset_id || officialName}
                                                    onClick={() => handleSelectEquipment(item)}
                                                    className="py-[13px] hover:bg-[#F8FAFC] dark:hover:bg-[#000000] flex items-center gap-[13px] cursor-pointer transition-colors"
                                                >
                                                    <SecureCasThumbnail
                                                        src={item.foto_url}
                                                        alt={officialName}
                                                        fallbackIcon="front_loader"
                                                        className="w-10 h-10"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex flex-wrap items-baseline gap-[8px] min-w-0">
                                                            <span className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                {officialName}
                                                            </span>
                                                            <span className="text-[11px] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                {cleanType}
                                                            </span>
                                                        </div>
                                                        <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                            {operationalDesc}
                                                        </div>
                                                        {itemVersions.length > 1 && (
                                                            <div
                                                                className="mt-[8px] flex flex-wrap gap-[8px]"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {itemVersions.map((ver) => (
                                                                    <button
                                                                        key={ver}
                                                                        type="button"
                                                                        onClick={() => handleSelectEquipment(item, ver)}
                                                                        className="px-[8px] py-0.5 text-[11px] font-mono border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] bg-transparent cursor-pointer rounded-none"
                                                                    >
                                                                        {ver}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Aviso cuando no existe en CATÁLOGO y aún no se ha lanzado caza */}
                            {hasCheckedLocal &&
                                localMatches.length === 0 &&
                                huntedCandidates.length === 0 &&
                                !isHuntingWeb &&
                                queryText.trim().length >= 2 && (
                                    <div className="p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between gap-[13px] rounded-none">
                                        <span className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.catalog_no_match')}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => void triggerCandidateHunter(false)}
                                            className="px-[13px] py-[8px] bg-[#C68346] hover:bg-[#b0743e] text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none cursor-pointer shrink-0"
                                        >
                                            {t('opermaq_domains.search_global_candidates')}
                                        </button>
                                    </div>
                                )}

                            {/* CASO B: Buscador de Candidatos del CATÁLOGO (`1..N` sin límite) */}
                            {huntedCandidates.length > 0 && (
                                <div className="flex flex-col gap-[13px]">
                                    {huntedCandidates[0].is_pertinent === false ? (
                                        <div className="p-[13px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none">
                                            {huntedCandidates[0].rejection_reason || t('registration.industrial_only')}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-between pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                                <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346] tabular-nums">
                                                    {t('registration.matches_count', {
                                                        count: filteredHuntedCandidates.length,
                                                    })}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => void triggerCandidateHunter(true)}
                                                    title={t('registration.refresh_oem_web')}
                                                    aria-label={t('registration.refresh_oem_web')}
                                                    className={flatIconBtnClass}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                                                </button>
                                            </div>

                                            {huntedCandidates.length > 3 && (
                                                <input
                                                    type="text"
                                                    value={candidateFilter}
                                                    onChange={(e) => setCandidateFilter(e.target.value)}
                                                    placeholder={t('registration.filter_versions_placeholder')}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full h-9 px-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none"
                                                />
                                            )}

                                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] max-h-[340px] overflow-y-auto">
                                                {filteredHuntedCandidates.map((cand, idx) => {
                                                    const candVersions = getEquipmentVersions(cand);
                                                    const fullName = `${cand.make_oficial} ${cand.model_oficial}`.trim();
                                                    const cleanType = cleanMachineryTypeLabel(
                                                        cand.tipo_equipo || cand.categoria_equipo
                                                    );
                                                    const operationalDesc = buildEquipmentShortDescription(cand);

                                                    return (
                                                        <div
                                                            key={`${cand.catalog_key || fullName}_${idx}`}
                                                            onClick={() => handleSelectEquipment(cand)}
                                                            className="py-[13px] hover:bg-[#F8FAFC] dark:hover:bg-[#000000] flex items-center gap-[13px] cursor-pointer transition-colors"
                                                        >
                                                            <SecureCasThumbnail
                                                                src={cand.foto_url}
                                                                alt={fullName}
                                                                fallbackIcon="front_loader"
                                                                className="w-10 h-10"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex flex-wrap items-baseline gap-[8px] min-w-0">
                                                                    <span className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                        {fullName}
                                                                    </span>
                                                                    <span className="text-[11px] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                        {cleanType}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                    {operationalDesc}
                                                                </div>
                                                                {candVersions.length > 1 && (
                                                                    <div
                                                                        className="mt-[8px] flex flex-wrap gap-[8px]"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    >
                                                                        {candVersions.map((ver) => (
                                                                            <button
                                                                                key={ver}
                                                                                type="button"
                                                                                onClick={() => handleSelectEquipment(cand, ver)}
                                                                                className="px-[8px] py-0.5 text-[11px] font-mono border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] bg-transparent cursor-pointer rounded-none"
                                                                            >
                                                                                {ver}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <span
                                                                className={`text-[10px] font-mono uppercase tracking-[0.05em] shrink-0 ${cand.isNew ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                                                    }`}
                                                            >
                                                                {cand.isNew
                                                                    ? t('registration.status_new_catalog')
                                                                    : t('registration.status_in_catalog')}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* PASO 2: ACREDITACIÓN DE PERTENENCIA + NÚMERO DE SERIE / PATENTE */}
                    {step === 'OWNERSHIP_SERIAL' && selectedEquipment && (
                        <form
                            onSubmit={handleEnrollFleetUnit}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex flex-col gap-[21px]"
                        >
                            {/* Ficha Resumen del Equipo Seleccionado */}
                            <div className="pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-start sm:items-center gap-[13px]">
                                <SecureCasThumbnail
                                    src={selectedEquipment.foto_url}
                                    alt={`${selectedEquipment.make_oficial} ${selectedEquipment.model_oficial}`}
                                    fallbackIcon="front_loader"
                                    className="w-10 h-10 shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                        {selectedEquipment.make_oficial} {selectedEquipment.model_oficial}
                                    </div>
                                    <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                        {buildEquipmentShortDescription(selectedEquipment)}
                                    </div>
                                </div>
                            </div>

                            {/* Selector de Versión si tiene múltiples */}
                            {selectedVersions.length > 1 && (
                                <div className="flex flex-col gap-[8px]">
                                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('registration.design_versions', { count: selectedVersions.length })}
                                    </label>
                                    <div className="flex flex-wrap gap-[8px]">
                                        {selectedVersions.map((ver) => (
                                            <button
                                                key={ver}
                                                type="button"
                                                onClick={() => setSelectedVersion(ver)}
                                                className={`px-[13px] py-[8px] text-[12px] font-mono border rounded-none cursor-pointer transition-colors ${selectedVersion === ver
                                                    ? 'bg-[#C68346] text-white border-[#C68346]'
                                                    : 'bg-transparent border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346]'
                                                    }`}
                                            >
                                                {ver}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Identificador Único (Número de Serie / Patente / VIN / TAG) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[13px]">
                                <div className="flex flex-col gap-[8px]">
                                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.identifier_type_label')}
                                    </label>
                                    <select
                                        value={identifierType}
                                        onChange={(e) => setIdentifierType(e.target.value as FleetIdentifierType)}
                                        className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                    >
                                        <option value="SERIAL_NUMBER">{t('opermaq_domains.id_serial')}</option>
                                        <option value="LICENSE_PLATE">{t('opermaq_domains.id_plate')}</option>
                                        <option value="VIN">{t('opermaq_domains.id_vin')}</option>
                                        <option value="ASSET_TAG">{t('opermaq_domains.id_tag')}</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-[8px]">
                                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                        {t('opermaq_domains.identifier_value_label')} *
                                    </label>
                                    <input
                                        required
                                        type="text"
                                        autoFocus
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={identifierValue}
                                        onChange={(e) => setIdentifierValue(e.target.value.toUpperCase())}
                                        placeholder={t('opermaq_domains.identifier_value_placeholder')}
                                        className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tabular-nums uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none select-text"
                                    />
                                </div>
                            </div>

                            {/* Régimen de Pertenencia + Horómetro */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[13px]">
                                <div className="flex flex-col gap-[8px]">
                                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.ownership_label')}
                                    </label>
                                    <select
                                        value={ownershipType}
                                        onChange={(e) => setOwnershipType(e.target.value as FleetOwnershipCondition)}
                                        className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                    >
                                        <option value="PROPIO">{t('opermaq_domains.own_owned')}</option>
                                        <option value="ARRENDADO">{t('opermaq_domains.own_rented')}</option>
                                        <option value="CONTRATISTA">{t('opermaq_domains.own_contractor')}</option>
                                        <option value="COMODATO">{t('opermaq_domains.own_loan')}</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-[8px]">
                                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.horometer_label')}
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="1"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={horometer}
                                        onChange={(e) => setHorometer(e.target.value)}
                                        className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none select-text"
                                    />
                                </div>
                            </div>

                            {/* Foto Privada Opcional */}
                            <div className="flex flex-col gap-[8px]">
                                <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                    {t('opermaq_domains.private_photo_optional')}
                                </label>
                                <div className="flex items-center gap-[13px]">
                                    <input
                                        ref={photoInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={(e) => setPrivatePhotoFile(e.target.files?.[0] || null)}
                                        className="hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => photoInputRef.current?.click()}
                                        className="px-[13px] h-9 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-transparent text-[11px] font-mono uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] rounded-none cursor-pointer"
                                    >
                                        {privatePhotoFile
                                            ? privatePhotoFile.name
                                            : t('opermaq_domains.upload_private_photo')}
                                    </button>
                                    {privatePhotoFile && (
                                        <button
                                            type="button"
                                            onClick={() => setPrivatePhotoFile(null)}
                                            aria-label={t('common.cancel')}
                                            className={flatIconBtnClass}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Confirmación Quirúrgica por Palabra Clave "ACTUALIZAR" */}
                            <div className="pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[13px]">
                                <label className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                    {t('opermaq_domains.confirm_keyword_prompt')}
                                </label>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-[13px]">
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={confirmKeyword}
                                        onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                                        placeholder="ACTUALIZAR"
                                        className="flex-1 h-10 px-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tracking-widest uppercase text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none select-text"
                                    />
                                    <button
                                        type="submit"
                                        disabled={
                                            isSubmitting ||
                                            identifierValue.trim().length < 2 ||
                                            confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR'
                                        }
                                        className="px-[21px] h-10 bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting
                                            ? t('detail.registering')
                                            : t('registration.btn_register_confirm')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FleetUnitRegistrationModal;

