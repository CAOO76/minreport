import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueue } from '../../../core/offline/SyncQueueEngine';
import type {
    AssetConfigurationProfile,
    AssetPhysicalTraits,
    DisambiguationFacetGroup,
    FleetIdentifierType,
    FleetOwnershipCondition,
    OpticalIdentificationSummary,
} from '../../../contracts';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    type EphemeralIdentificationImagePreview,
    revokeEphemeralImagePreviews,
    toEphemeralApiPayload,
} from '../utils/ephemeralIdentificationImageHelper';
import {
    buildEquipmentShortDescription,
    type CanonicalSpecSlot,
    cleanMachineryTypeLabel,
} from '../utils/opermaqDomainProjection';
import {
    AssetIdentificationPrecisionPanel,
    candidateMatchesFacetSelections,
    extractConfigurationBadges,
    OpticalAndFacetsStrip,
} from './AssetIdentificationPrecisionPanel';
import { M3CircularProgress } from './M3ProgressIndicator';
import { M3TextField } from './M3TextField';

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
    physical_traits?: AssetPhysicalTraits;
    configuration_profile?: AssetConfigurationProfile;
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
    const [clarificationInput, setClarificationInput] = useState('');
    const [precisionOpen, setPrecisionOpen] = useState(false);
    const [ephemeralImages, setEphemeralImages] = useState<EphemeralIdentificationImagePreview[]>([]);
    const [opticalSummary, setOpticalSummary] = useState<OpticalIdentificationSummary | null>(null);
    const [disambiguationFacets, setDisambiguationFacets] = useState<DisambiguationFacetGroup[]>([]);
    const [selectedFacets, setSelectedFacets] = useState<Record<string, string>>({});
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
    const [odometerKm, setOdometerKm] = useState<string>('0');
    const [cyclesCount, setCyclesCount] = useState<string>('0');
    const [calibrationDueDate, setCalibrationDueDate] = useState<string>('');
    const [privatePhotoFile, setPrivatePhotoFile] = useState<File | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    const abortRef = useRef<AbortController | null>(null);
    const photoInputRef = useRef<HTMLInputElement | null>(null);
    const ephemeralRef = useRef<EphemeralIdentificationImagePreview[]>([]);
    ephemeralRef.current = ephemeralImages;

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
            revokeEphemeralImagePreviews(ephemeralRef.current);
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
                    const items: CatalogLookupItem[] = Array.isArray(payload?.items) ? payload.items : [];
                    setLocalMatches(items);
                    setHasCheckedLocal(true);
                    if (items.length > 0) {
                        const existingCache =
                            (await syncQueue
                                .getOfflineKnowledge<CatalogLookupItem[]>('opermaq_catalog_lookup_cache_v3')
                                .catch(() => null)) || [];
                        const mergedById = new Map<string, CatalogLookupItem>();
                        [...items, ...existingCache].forEach((entry) => {
                            const key = String(
                                entry.global_asset_id ||
                                    entry.catalog_key ||
                                    `${entry.make_oficial}_${entry.model_oficial}`
                            ).toLowerCase();
                            if (!mergedById.has(key)) mergedById.set(key, entry);
                        });
                        void syncQueue.saveOfflineKnowledge(
                            'opermaq_catalog_lookup_cache_v3',
                            Array.from(mergedById.values()).slice(0, 250)
                        );
                    }
                    setIsCheckingLocal(false);
                    return;
                }
            } catch {
                // Fallback Offline-First en IndexedDB
            }

            try {
                const cachedLookup =
                    (await syncQueue
                        .getOfflineKnowledge<CatalogLookupItem[]>('opermaq_catalog_lookup_cache_v3')
                        .catch(() => null)) || [];
                const cachedCatalog =
                    (await syncQueue
                        .getOfflineKnowledge<any[]>('opermaq_catalog_index_v3')
                        .catch(() => null)) || [];
                const qLower = clean.toLowerCase();
                const offlinePool: CatalogLookupItem[] = [
                    ...cachedLookup,
                    ...cachedCatalog.map((row) => ({
                        global_asset_id: row.id,
                        make_oficial: row.make_oficial,
                        model_oficial: row.model_oficial,
                        tipo_equipo: row.tipo_equipo,
                        categoria_equipo: row.categoria_equipo,
                        short_description: row.short_description,
                        foto_url: row.foto_url,
                        physical_traits: row.physical_traits,
                    })),
                ];
                const deduped = new Map<string, CatalogLookupItem>();
                offlinePool.forEach((entry) => {
                    const hay = `${entry.make_oficial || ''} ${entry.model_oficial || ''} ${entry.tipo_equipo || ''} ${entry.categoria_equipo || ''}`.toLowerCase();
                    if (!hay.includes(qLower)) return;
                    const key = String(
                        entry.global_asset_id || `${entry.make_oficial}_${entry.model_oficial}`
                    ).toLowerCase();
                    if (!deduped.has(key)) deduped.set(key, entry);
                });
                setLocalMatches(Array.from(deduped.values()));
                setHasCheckedLocal(true);
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

    const triggerCandidateHunter = async (
        forceWebDiscovery: boolean = false,
        explicitClarification?: string,
        overrideQuery?: string
    ) => {
        const clean = (overrideQuery ?? queryText).trim();
        const hasEphemeral = ephemeralImages.length > 0;
        if (clean.length < 2 && !hasEphemeral) return;

        const effectiveClarification = (explicitClarification ?? clarificationInput).trim();

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setErrorMsg(null);
        setClarificationMsg(null);
        setSelectedFacets({});
        setDisambiguationFacets([]);
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
                    clarificationContext: effectiveClarification || undefined,
                    forceWebDiscovery: forceWebDiscovery || Boolean(effectiveClarification) || hasEphemeral,
                    ephemeralImages: hasEphemeral ? toEphemeralApiPayload(ephemeralImages) : undefined,
                    includeEnvelope: true,
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
                if (overrideQuery) setQueryText(overrideQuery);
                setHuntedCandidates(data);
                if (data.length === 0) {
                    setErrorMsg(t('registration.no_results'));
                }
                return;
            }

            if (data && typeof data === 'object') {
                setOpticalSummary(data.optical_identification_summary || null);
                setDisambiguationFacets(Array.isArray(data.disambiguation_facets) ? data.disambiguation_facets : []);

                if (data.requires_clarification) {
                    setPrecisionOpen(true);
                    setClarificationMsg(String(data.clarification_message || t('registration.family_desc')));
                    return;
                }
                if (Array.isArray(data.candidates)) {
                    if (overrideQuery) {
                        setQueryText(overrideQuery);
                    } else if (
                        !clean &&
                        data.optical_identification_summary?.detected_make &&
                        data.optical_identification_summary?.detected_model_or_series
                    ) {
                        setQueryText(
                            `${data.optical_identification_summary.detected_make} ${data.optical_identification_summary.detected_model_or_series}`.trim()
                        );
                    }
                    setHuntedCandidates(data.candidates);
                    return;
                }
            }

            setErrorMsg(t('registration.no_results'));
        } catch (err: unknown) {
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                return;
            }
            if (!navigator.onLine) {
                const upper = clean.toUpperCase();
                const parts = upper.split(/\s+/);
                const makeDraft =
                    parts.length > 1 ? parts[0] : searchScope === 'generic' ? 'GENÉRICO' : 'OEM';
                const modelDraft = parts.length > 1 ? parts.slice(1).join(' ') : upper;
                setHuntedCandidates([
                    {
                        make_oficial: makeDraft,
                        model_oficial: modelDraft,
                        categoria_equipo:
                            searchScope === 'generic' ? 'GENÉRICO' : 'EQUIPAMIENTO INDUSTRIAL',
                        tipo_equipo: t('registration.not_declared'),
                        versions: ['ESTÁNDAR'],
                        isNew: true,
                        is_pertinent: true,
                    },
                ]);
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
        const hasEphemeral = ephemeralImages.length > 0;
        const hasExtraSpecs = clarificationInput.trim().length > 0;
        if (clean.length < 2 && !hasEphemeral) return;

        if (hasEphemeral || hasExtraSpecs) {
            await triggerCandidateHunter(true);
            return;
        }

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
        if (
            item.physical_traits?.duty_travel_regime === 'ON_HIGHWAY' ||
            item.physical_traits?.duty_travel_regime === 'DUAL_ROAD_AND_SITE'
        ) {
            setIdentifierType('LICENSE_PLATE');
        } else if (item.physical_traits?.requires_metrology_calibration) {
            setIdentifierType('SERIAL_NUMBER');
        }
        setConfirmKeyword('');
        setErrorMsg(null);
        setStep('OWNERSHIP_SERIAL');
    };

    const pmCadence = selectedEquipment?.physical_traits?.pm_cadence_basis;
    const requiresMetrology =
        Boolean(selectedEquipment?.physical_traits?.requires_metrology_calibration) ||
        pmCadence === 'CALENDAR_AND_METROLOGY';
    const showHorometer =
        !pmCadence || pmCadence === 'HOROMETER_HOURS' || pmCadence === 'DUAL_KM_AND_HOURS';
    const showOdometerKm = pmCadence === 'ODOMETER_KM' || pmCadence === 'DUAL_KM_AND_HOURS';
    const showCyclesCount = pmCadence === 'CYCLES_OR_FLIGHTS';
    const showCalibrationDueDate = requiresMetrology;

    const filteredHuntedCandidates = useMemo(() => {
        const q = candidateFilter.trim().toLowerCase();
        return huntedCandidates.filter((c) => {
            if (!candidateMatchesFacetSelections(c, selectedFacets)) {
                return false;
            }
            if (!q) return true;
            const haystack = [
                c.make_oficial,
                c.model_oficial,
                c.tipo_equipo || '',
                c.categoria_equipo || '',
                buildEquipmentShortDescription(c),
                ...extractConfigurationBadges(c.configuration_profile),
                ...(c.versions || []),
                ...(c.chassis_versions || []),
                ...(c.caracteristicas_principales || []),
            ]
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [huntedCandidates, candidateFilter, selectedFacets]);

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
        const parsedOdometerKm = Math.max(0, Number(odometerKm) || 0);
        const parsedCyclesCount = Math.max(0, Math.round(Number(cyclesCount) || 0));
        const cleanCalibrationDate = calibrationDueDate.trim() || undefined;

        const bodyPayload = {
            global_asset_id: resolvedGlobalId,
            make_oficial: selectedEquipment.make_oficial || 'GENÉRICO',
            model_oficial: selectedEquipment.model_oficial || queryText.trim().toUpperCase(),
            categoria_equipo: selectedEquipment.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
            tipo_equipo: selectedEquipment.tipo_equipo || '',
            equipment_type_key: selectedEquipment.equipment_type_key,
            archetype_id: selectedEquipment.archetype_id,
            canonical_specs: selectedEquipment.canonical_specs,
            physical_traits: selectedEquipment.physical_traits,
            configuration_profile: selectedEquipment.configuration_profile,
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
            ...(showHorometer ? { horometer: parsedHorometer } : {}),
            ...(showOdometerKm ? { odometer_km: parsedOdometerKm } : {}),
            ...(showCyclesCount ? { cycles_count: parsedCyclesCount } : {}),
            ...(showCalibrationDueDate && cleanCalibrationDate
                ? { calibration_due_date: cleanCalibrationDate }
                : {}),
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
            // Fallback Offline-First mediante SyncQueueEngine (respeta aislamiento EDU/B2B y ontología v3 al reconectar)
            if (!navigator.onLine) {
                const deterministicCatalogId =
                    resolvedGlobalId ||
                    selectedEquipment.catalog_key ||
                    `${bodyPayload.make_oficial}_${bodyPayload.model_oficial}`
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '');

                const queuedId = await syncQueue.enqueueApiMutation(
                    '/assets/register-fleet-unit',
                    bodyPayload,
                    'OPERMAQ_REGISTER_FLEET_UNIT',
                    tenantId
                );

                const existingOfflineFleet =
                    (await syncQueue
                        .getOfflineKnowledge<any[]>(`opermaq_fleet_${tenantId}`)
                        .catch(() => null)) || [];
                const optimisticRow = {
                    id: queuedId,
                    tenant_id: tenantId,
                    tenantId,
                    global_asset_id: deterministicCatalogId,
                    make_oficial: bodyPayload.make_oficial.toUpperCase(),
                    model_oficial: bodyPayload.model_oficial.toUpperCase(),
                    version: bodyPayload.version,
                    tipo_equipo: bodyPayload.tipo_equipo || bodyPayload.categoria_equipo,
                    categoria_equipo: bodyPayload.categoria_equipo,
                    short_description: buildEquipmentShortDescription(selectedEquipment),
                    serial_number: cleanId,
                    identifier_type: identifierType,
                    identifier_value: cleanId,
                    ownership_type: ownershipType,
                    horometer: showHorometer ? parsedHorometer : undefined,
                    odometer_km: showOdometerKm ? parsedOdometerKm : undefined,
                    cycles_count: showCyclesCount ? parsedCyclesCount : undefined,
                    calibration_due_date:
                        showCalibrationDueDate && cleanCalibrationDate
                            ? cleanCalibrationDate
                            : undefined,
                    physical_traits: selectedEquipment.physical_traits,
                    registered_by: actorId || 'operador',
                };
                void syncQueue.saveOfflineKnowledge(`opermaq_fleet_${tenantId}`, [
                    optimisticRow,
                    ...existingOfflineFleet,
                ]);

                onSuccess({
                    tenantAssetId: queuedId,
                    globalAssetId: deterministicCatalogId,
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
    const canSubmitIdentification = queryText.trim().length >= 2 || ephemeralImages.length > 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 dark:bg-black/85 p-[13px] sm:p-[21px] select-none">
            <div className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] w-full max-w-5xl h-[85vh] max-h-[860px] flex flex-col overflow-hidden rounded-none shadow-none">
                {/* Cabecera Quirúrgica con Selector Plano de Modo */}
                <header className="px-[21px] h-[55px] flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] shrink-0 gap-[13px]">
                    <div className="flex items-center gap-[21px] min-w-0 h-full">
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
                        {step === 'DETECT_OR_HUNT' && (
                            <div className="flex items-center h-full">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchScope('brand');
                                        setHuntedCandidates([]);
                                    }}
                                    className={`h-full px-[13px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 border-b-2 transition-colors cursor-pointer rounded-none shadow-none ${
                                        searchScope === 'brand'
                                            ? 'border-[#C68346] text-[#C68346] bg-transparent'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] bg-transparent'
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
                                    className={`h-full px-[13px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 border-b-2 transition-colors cursor-pointer rounded-none shadow-none ${
                                        searchScope === 'generic'
                                            ? 'border-[#C68346] text-[#C68346] bg-transparent'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] bg-transparent'
                                    }`}
                                >
                                    {t('registration.generic')}
                                </button>
                            </div>
                        )}
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

                <div className="flex-1 min-h-0 flex flex-col p-[21px] gap-[13px] overflow-hidden">
                    {errorMsg && (
                        <div className="py-[8px] border-b border-[#C68346] flex items-start justify-between gap-[13px] shrink-0">
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
                            {/* Buscador con Detección Instantánea en CATÁLOGO */}
                            <form
                                onSubmit={handleSearchSubmit}
                                autoComplete="off"
                                spellCheck={false}
                                className="relative w-full shrink-0"
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
                                    inputClassName="pr-24 font-mono tabular-nums"
                                    autoComplete="off"
                                />
                                <div className="absolute right-[13px] top-1/2 -translate-y-1/2 flex items-center gap-[8px]">
                                    {(queryText.length > 0 || ephemeralImages.length > 0 || isHuntingWeb) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isHuntingWeb) {
                                                    abortRef.current?.abort();
                                                    setIsHuntingWeb(false);
                                                    return;
                                                }
                                                revokeEphemeralImagePreviews(ephemeralImages);
                                                setEphemeralImages([]);
                                                setOpticalSummary(null);
                                                setDisambiguationFacets([]);
                                                setSelectedFacets({});
                                                setQueryText('');
                                                setClarificationInput('');
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
                                        <div className="p-1 flex items-center justify-center">
                                            <M3CircularProgress size={18} strokeWidth={2.5} tone="copper" />
                                        </div>
                                    ) : (
                                        <button
                                            type="submit"
                                            disabled={!canSubmitIdentification}
                                            title={t('registration.identifying')}
                                            aria-label={t('registration.identifying')}
                                            className="bg-transparent border-0 outline-none p-1 text-[#C68346] disabled:text-[#94A3B8] dark:disabled:text-[#5A6072] cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
                                        </button>
                                    )}
                                </div>
                            </form>

                            {/* Barra Inicial Multimodal RAM-Only + Especificaciones Diferenciadoras */}
                            <AssetIdentificationPrecisionPanel
                                isOpen={precisionOpen}
                                onToggleOpen={() => setPrecisionOpen((prev) => !prev)}
                                clarificationInput={clarificationInput}
                                onClarificationChange={setClarificationInput}
                                ephemeralImages={ephemeralImages}
                                onAddEphemeralImages={(newItems) => {
                                    setEphemeralImages((prev) => [...prev, ...newItems]);
                                    setPrecisionOpen(true);
                                }}
                                onRemoveEphemeralImage={(id) => {
                                    setEphemeralImages((prev) => {
                                        const target = prev.find((item) => item.id === id);
                                        if (target) revokeEphemeralImagePreviews([target]);
                                        return prev.filter((item) => item.id !== id);
                                    });
                                }}
                                onApplyPrecisionSearch={() =>
                                    void triggerCandidateHunter(true, clarificationInput.trim())
                                }
                                isBusy={isHuntingWeb}
                                canTriggerSearch={canSubmitIdentification}
                                onError={setErrorMsg}
                            />

                            {/* Tira de Evidencia Óptica Verificada + Chips de Desambiguación en 1 Clic */}
                            {!isHuntingWeb && (
                                <OpticalAndFacetsStrip
                                    opticalSummary={opticalSummary}
                                    facets={disambiguationFacets}
                                    selectedFacets={selectedFacets}
                                    onSelectFacetOption={(facetKey, val) =>
                                        setSelectedFacets((prev) => ({ ...prev, [facetKey]: val }))
                                    }
                                    onResetFacets={() => setSelectedFacets({})}
                                    onQuickModelFamilySelect={(quickVal) => {
                                        const combined = queryText.trim()
                                            ? `${queryText.trim()} ${quickVal}`.trim()
                                            : quickVal;
                                        void triggerCandidateHunter(true, undefined, combined);
                                    }}
                                />
                            )}

                            {clarificationMsg && (
                                <div className="py-[8px] border-b border-[#00AEEF] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
                                    {clarificationMsg}
                                </div>
                            )}

                            {/* Área de Resultados Tabulares sin Tarjetas */}
                            <div className="flex-1 min-h-0 flex flex-col gap-[13px] overflow-y-auto pr-1">
                                {/* CASO A: Resultados Existentes en CATÁLOGO */}
                                {localMatches.length > 0 && (
                                    <div className="flex flex-col gap-[8px]">
                                        <div className="flex items-center justify-between pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF] tabular-nums">
                                                {t('opermaq_domains.catalog_match_found')} ({localMatches.length})
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => void triggerCandidateHunter(true)}
                                                title={t('opermaq_domains.search_global_candidates')}
                                                aria-label={t('opermaq_domains.search_global_candidates')}
                                                className={flatIconBtnClass}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    travel_explore
                                                </span>
                                            </button>
                                        </div>

                                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                            {localMatches.map((item) => {
                                                const itemVersions = getEquipmentVersions(item);
                                                const officialName = `${item.make_oficial} ${item.model_oficial}`.trim();
                                                const cleanType = cleanMachineryTypeLabel(
                                                    item.tipo_equipo || item.categoria_equipo
                                                );
                                                const operationalDesc = buildEquipmentShortDescription(item);

                                                return (
                                                    <div
                                                        key={item.global_asset_id || officialName}
                                                        onClick={() => handleSelectEquipment(item)}
                                                        className="py-[13px] px-[8px] hover:bg-[#F8FAFC] dark:hover:bg-[#000000] flex items-center justify-between gap-[21px] cursor-pointer transition-colors"
                                                    >
                                                        <div className="flex-1 min-w-0 space-y-[4px]">
                                                            <div className="flex flex-wrap items-baseline gap-[13px] min-w-0">
                                                                <span className="text-[15px] font-semibold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                    {officialName}
                                                                </span>
                                                                <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                    {cleanType}
                                                                </span>
                                                            </div>
                                                            <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                {operationalDesc}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-[13px] shrink-0 text-[11px] font-mono tabular-nums uppercase tracking-[0.05em]">
                                                            {itemVersions.length > 1 && (
                                                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                    {t('registration.versions_count', {
                                                                        count: itemVersions.length,
                                                                    })}
                                                                </span>
                                                            )}
                                                            <span className="text-[#C68346]">
                                                                {t('registration.status_in_catalog')}
                                                            </span>
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
                                        <div className="py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-[13px]">
                                            <span className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('opermaq_domains.catalog_no_match')}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => void triggerCandidateHunter(false)}
                                                className="px-[13px] py-[8px] bg-[#C68346] hover:bg-[#b0743e] text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none cursor-pointer shrink-0 shadow-none"
                                            >
                                                {t('opermaq_domains.search_global_candidates')}
                                            </button>
                                        </div>
                                    )}

                                {/* CASO B: Buscador de Candidatos del CATÁLOGO (`1..N` sin límite) */}
                                {huntedCandidates.length > 0 && (
                                    <div className="flex flex-col gap-[13px]">
                                        {huntedCandidates[0].is_pertinent === false ? (
                                            <div className="py-[13px] border-b border-[#C68346] text-[13px] text-[#0F172A] dark:text-[#F3F4F6]">
                                                {huntedCandidates[0].rejection_reason ||
                                                    t('registration.industrial_only')}
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex flex-wrap items-center justify-between pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] gap-[13px]">
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346] tabular-nums">
                                                        {t('registration.matches_count', {
                                                            count: filteredHuntedCandidates.length,
                                                        })}
                                                    </span>
                                                    <div className="flex items-center gap-[13px] flex-1 sm:flex-initial justify-end">
                                                        {huntedCandidates.length > 2 && (
                                                            <input
                                                                type="text"
                                                                value={candidateFilter}
                                                                onChange={(e) => setCandidateFilter(e.target.value)}
                                                                placeholder={t(
                                                                    'registration.filter_versions_placeholder'
                                                                )}
                                                                autoComplete="off"
                                                                spellCheck={false}
                                                                className="w-full sm:w-72 h-8 px-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[12px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none shadow-none select-text"
                                                            />
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => void triggerCandidateHunter(true)}
                                                            title={t('registration.refresh_oem_web')}
                                                            aria-label={t('registration.refresh_oem_web')}
                                                            className={flatIconBtnClass}
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">
                                                                refresh
                                                            </span>
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                    {filteredHuntedCandidates.map((cand, idx) => {
                                                        const candVersions = getEquipmentVersions(cand);
                                                        const fullName =
                                                            `${cand.make_oficial} ${cand.model_oficial}`.trim();
                                                        const cleanType = cleanMachineryTypeLabel(
                                                            cand.tipo_equipo || cand.categoria_equipo
                                                        );
                                                        const operationalDesc = buildEquipmentShortDescription(cand);
                                                        const configBadges = extractConfigurationBadges(
                                                            cand.configuration_profile
                                                        );

                                                        return (
                                                            <div
                                                                key={`${cand.catalog_key || fullName}_${idx}`}
                                                                onClick={() => handleSelectEquipment(cand)}
                                                                className="py-[13px] px-[8px] hover:bg-[#F8FAFC] dark:hover:bg-[#000000] flex items-center justify-between gap-[21px] cursor-pointer transition-colors"
                                                            >
                                                                <div className="flex-1 min-w-0 space-y-[4px]">
                                                                    <div className="flex flex-wrap items-baseline gap-[13px] min-w-0">
                                                                        <span className="text-[15px] font-semibold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                            {fullName}
                                                                        </span>
                                                                        <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                            {cleanType}
                                                                        </span>
                                                                    </div>
                                                                    {configBadges.length > 0 && (
                                                                        <div className="flex flex-wrap gap-[8px]">
                                                                            {configBadges.map((badge) => (
                                                                                <span
                                                                                    key={badge}
                                                                                    className="px-[8px] py-[2px] border border-[#E2E8F0] dark:border-[#12151C] text-[11px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]"
                                                                                >
                                                                                    {badge}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                    <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                                        {operationalDesc}
                                                                    </div>
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
                                                                            cand.isNew
                                                                                ? 'text-[#00AEEF]'
                                                                                : 'text-[#C68346]'
                                                                        }
                                                                    >
                                                                        {cand.isNew
                                                                            ? t('registration.status_new_catalog')
                                                                            : t('registration.status_in_catalog')}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* PASO 2: ACREDITACIÓN DE PERTENENCIA + NÚMERO DE SERIE / PATENTE */}
                    {step === 'OWNERSHIP_SERIAL' && selectedEquipment && (
                        <form
                            onSubmit={handleEnrollFleetUnit}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-between gap-[21px]"
                        >
                            <div className="flex flex-col gap-[21px]">
                                {/* Ficha Resumen del Equipo Seleccionado (Sin Cajas Decorativas) */}
                                <div className="pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] space-y-[4px]">
                                    <div className="text-[17px] font-semibold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                        {selectedEquipment.make_oficial} {selectedEquipment.model_oficial}
                                    </div>
                                    <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                        {buildEquipmentShortDescription(selectedEquipment)}
                                    </div>
                                </div>

                                {/* Selector de Versión si tiene múltiples */}
                                {selectedVersions.length > 1 && (
                                    <div className="flex flex-col gap-[8px]">
                                        <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] tabular-nums">
                                            {t('registration.design_versions', { count: selectedVersions.length })}
                                        </label>
                                        <div className="flex flex-wrap gap-[8px]">
                                            {selectedVersions.map((ver) => (
                                                <button
                                                    key={ver}
                                                    type="button"
                                                    onClick={() => setSelectedVersion(ver)}
                                                    className={`px-[13px] py-[8px] text-[12px] font-mono tabular-nums border rounded-none shadow-none cursor-pointer transition-colors ${
                                                        selectedVersion === ver
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
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[21px]">
                                    <div className="flex flex-col gap-[8px]">
                                        <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.identifier_type_label')}
                                        </label>
                                        <select
                                            value={identifierType}
                                            onChange={(e) => setIdentifierType(e.target.value as FleetIdentifierType)}
                                            className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none"
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
                                            className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tabular-nums uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                        />
                                    </div>
                                </div>

                                {/* Régimen de Pertenencia + Telemetría Adaptativa según Ontología Física */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[21px]">
                                    <div className="flex flex-col gap-[8px]">
                                        <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.ownership_label')}
                                        </label>
                                        <select
                                            value={ownershipType}
                                            onChange={(e) =>
                                                setOwnershipType(e.target.value as FleetOwnershipCondition)
                                            }
                                            className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none"
                                        >
                                            <option value="PROPIO">{t('opermaq_domains.own_owned')}</option>
                                            <option value="ARRENDADO">{t('opermaq_domains.own_rented')}</option>
                                            <option value="CONTRATISTA">{t('opermaq_domains.own_contractor')}</option>
                                            <option value="COMODATO">{t('opermaq_domains.own_loan')}</option>
                                        </select>
                                    </div>

                                    {showHorometer && (
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
                                                className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    )}

                                    {showOdometerKm && (
                                        <div className="flex flex-col gap-[8px]">
                                            <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                                {t('opermaq_domains.odometer_km_label', 'ODÓMETRO INICIAL (KM)')}
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                step="1"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={odometerKm}
                                                onChange={(e) => setOdometerKm(e.target.value)}
                                                className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    )}

                                    {showCyclesCount && (
                                        <div className="flex flex-col gap-[8px]">
                                            <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                                {t('opermaq_domains.cycles_count_label', 'CICLOS / VUELOS ACUMULADOS')}
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                step="1"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={cyclesCount}
                                                onChange={(e) => setCyclesCount(e.target.value)}
                                                className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    )}

                                    {showCalibrationDueDate && (
                                        <div className="flex flex-col gap-[8px]">
                                            <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                                {t(
                                                    'opermaq_domains.calibration_due_date_label',
                                                    'VENCIMIENTO CALIBRACIÓN METROLÓGICA'
                                                )}
                                            </label>
                                            <input
                                                type="date"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={calibrationDueDate}
                                                onChange={(e) => setCalibrationDueDate(e.target.value)}
                                                className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    )}
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
                                            className="px-[13px] h-9 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-transparent text-[11px] font-mono uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
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
                            </div>

                            {/* Confirmación Quirúrgica por Palabra Clave "ACTUALIZAR" */}
                            <div className="pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[13px] shrink-0">
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
                                        className="flex-1 h-10 px-[13px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono tracking-widest uppercase text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                    />
                                    <button
                                        type="submit"
                                        disabled={
                                            isSubmitting ||
                                            identifierValue.trim().length < 2 ||
                                            confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR'
                                        }
                                        className="px-[21px] h-10 bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
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
