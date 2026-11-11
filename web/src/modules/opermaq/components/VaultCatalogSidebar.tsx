import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import type { EnergyConsumptionProfile } from '../../../contracts';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import {
    frameEquipmentPhotoToStudio4x3,
    reframeExistingEquipmentPhotoUrl,
} from '../utils/equipmentPhotoFraming';
import {
    normalizeFrontendSpecLinesByEnergy,
    sanitizeFrontendContextLines,
} from '../utils/opermaqDomainProjection';
import { PENDING_CONTENT_HIGHLIGHT_CLASS } from '../utils/pendingContentDetector';
import { M3CircularProgress } from './M3ProgressIndicator';

export const CURRENT_VLM_AUDIT_VERSION = 4;

export interface OfficialPhotoCandidate {
    candidate_id: string;
    preview_url: string;
    storage_path: string;
    source_type: 'VAULT_PDF' | 'OEM_DOMAIN';
    source_label: string;
    authenticity_score: number;
    subject_box_2d: [number, number, number, number] | null;
    original_bytes: number;
    optimized_bytes: number;
    savings_pct: number;
    sha256: string;
    phash_hex?: string;
    width: number;
    height: number;
    framing_mode: 'STUDIO_88' | 'VLM_BOX_4X3' | 'CENTER_4X3';
    vlm_audit_version?: number;
    verified_variant_summary?: string;
}

export interface FotoMediaTelemetry {
    original_bytes: number;
    optimized_bytes: number;
    savings_pct: number;
    sha256?: string;
    updated_at?: string;
    width?: number;
    height?: number;
}

export function formatPhotoBytes(bytes?: number): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
}

export interface SidebarCatalogPatch {
    foto_url?: string;
    foto_vlm_audit_version?: number | null;
    foto_media_telemetry?: FotoMediaTelemetry;
    official_photo_candidates?: OfficialPhotoCandidate[];
    caracteristicas_principales?: string[];
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    energy_consumption_profile?: EnergyConsumptionProfile;
}

interface SidebarProfileSnapshot {
    equipment_type_key?: string;
    canonical_specs?: Record<string, any>;
    caracteristicas_principales: string[];
    ambiente_operativo: string[];
    contexto_operativo: string[];
    energy_consumption_profile?: EnergyConsumptionProfile;
    configuration_profile?: Record<string, any>;
}

interface ReframePreviewState {
    currentUrl: string;
    proposedUrl: string;
    proposedSha256: string;
    proposedMetrics: FotoMediaTelemetry;
    isClientFallback: boolean;
}

interface ReconcilePreviewState {
    currentProfile: SidebarProfileSnapshot;
    proposedProfile: SidebarProfileSnapshot;
}

export interface VaultCatalogSidebarProps {
    catalog: {
        id: string;
        makeModel: string;
        tipo_equipo?: string;
        categoria_equipo?: string;
        is_sealed?: boolean;
        foto_url?: string;
        foto_vlm_audit_version?: number | null;
        foto_media_telemetry?: FotoMediaTelemetry;
        official_photo_candidates?: OfficialPhotoCandidate[];
        caracteristicas_principales?: string[];
        ambiente_operativo?: string[];
        contexto_operativo?: string[];
        energy_consumption_profile?: EnergyConsumptionProfile;
    };
    assetId: string;
    canCurateAI: boolean;
    highlightUndeclared: (node: React.ReactNode) => React.ReactNode;
    onCatalogPatch: (patch: SidebarCatalogPatch) => void;
    onRefreshVault?: () => Promise<void> | void;
}

export const VaultCatalogSidebar: React.FC<VaultCatalogSidebarProps> = ({
    catalog,
    assetId,
    canCurateAI,
    highlightUndeclared,
    onCatalogPatch,
    onRefreshVault,
}) => {
    const { t } = useTranslation();
    const catalogId = catalog.id;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const photoHuntAttemptRef = useRef<number>(0);
    const photoHuntAbortRef = useRef<AbortController | null>(null);

    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
    const [showPhotoDeleteConfirm, setShowPhotoDeleteConfirm] = useState(false);
    const [photoDeleteConfirmText, setPhotoDeleteConfirmText] = useState('');
    const [isHuntingPhoto, setIsHuntingPhoto] = useState(false);
    const [photoCandidates, setPhotoCandidates] = useState<OfficialPhotoCandidate[]>([]);
    const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
    const [candidateConfirmText, setCandidateConfirmText] = useState('');
    const [isPublishingCandidate, setIsPublishingCandidate] = useState(false);
    const [isManualFallbackActive, setIsManualFallbackActive] = useState(false);
    const [manualAuditRejection, setManualAuditRejection] = useState<string | null>(null);

    const [isReframingPhoto, setIsReframingPhoto] = useState(false);
    const [reframePreview, setReframePreview] = useState<ReframePreviewState | null>(null);
    const [reframeConfirmText, setReframeConfirmText] = useState('');
    const [isConsolidatingReframe, setIsConsolidatingReframe] = useState(false);

    const [editingSidebarSection, setEditingSidebarSection] = useState<
        'caracteristicas' | 'ambiente' | 'contexto' | null
    >(null);
    const [sidebarDraftText, setSidebarDraftText] = useState('');
    const [sidebarConfirmText, setSidebarConfirmText] = useState('');
    const [isReconcilingSidebar, setIsReconcilingSidebar] = useState(false);
    const [reconcilePreview, setReconcilePreview] = useState<ReconcilePreviewState | null>(null);
    const [reconcileApproveFields, setReconcileApproveFields] = useState<{
        caracteristicas: boolean;
        ambiente: boolean;
        contexto: boolean;
    }>({
        caracteristicas: true,
        ambiente: true,
        contexto: true,
    });
    const [reconcileConfirmText, setReconcileConfirmText] = useState('');
    const [isConsolidatingReconcile, setIsConsolidatingReconcile] = useState(false);
    const [isSavingSidebarHitl, setIsSavingSidebarHitl] = useState(false);

    useEffect(() => {
        photoHuntAttemptRef.current = 0;
        setReframePreview(null);
        setReframeConfirmText('');
        setReconcilePreview(null);
        setReconcileConfirmText('');
        if (photoHuntAbortRef.current) {
            photoHuntAbortRef.current.abort();
            photoHuntAbortRef.current = null;
        }
        return () => {
            if (photoHuntAbortRef.current) {
                photoHuntAbortRef.current.abort();
                photoHuntAbortRef.current = null;
            }
        };
    }, [catalogId]);

    const verifiedStoredCandidates = (catalog.official_photo_candidates || []).filter(
        (c) => c && c.vlm_audit_version === CURRENT_VLM_AUDIT_VERSION
    );

    const handleOpenStoredAlternatives = useCallback(() => {
        const storedPool = (catalog.official_photo_candidates || []).filter(
            (c) => c && c.vlm_audit_version === CURRENT_VLM_AUDIT_VERSION
        );
        if (storedPool.length === 0) return;
        setPhotoCandidates(storedPool);
        setSelectedCandidateIdx(0);
        setManualAuditRejection(null);
        setIsManualFallbackActive(false);
        setShowPhotoDeleteConfirm(false);
        setReframePreview(null);
    }, [catalog.official_photo_candidates]);

    const handleStartOfficialPhotoHunt = useCallback(async () => {
        if (!canCurateAI || !catalogId) return;

        if (photoHuntAbortRef.current) {
            photoHuntAbortRef.current.abort();
        }
        const abortController = new AbortController();
        photoHuntAbortRef.current = abortController;

        const currentAttempt = photoHuntAttemptRef.current;
        photoHuntAttemptRef.current += 1;

        const previousPool: OfficialPhotoCandidate[] = (
            photoCandidates.length > 0
                ? photoCandidates
                : catalog.official_photo_candidates || []
        ).filter((c) => c && c.vlm_audit_version === CURRENT_VLM_AUDIT_VERSION);
        const previousShas = new Set(previousPool.map((c) => c.sha256));

        setIsHuntingPhoto(true);
        setManualAuditRejection(null);
        setShowPhotoDeleteConfirm(false);
        setReframePreview(null);

        const toastId = toast.loading(
            currentAttempt > 0
                ? t('vault_sidebar.toast_hunting_retry', { attempt: currentAttempt + 1 })
                : t('vault_sidebar.toast_hunting_initial')
        );
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/hunt-official-photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    refreshAttempt: currentAttempt,
                }),
                signal: abortController.signal,
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(
                    data?.error || data?.message || t('vault_sidebar.toast_hunt_error')
                );
            }

            const returnedCandidates: OfficialPhotoCandidate[] = Array.isArray(data?.candidates)
                ? data.candidates
                : [];

            const mergedCandidates: OfficialPhotoCandidate[] = [];
            const seenShas = new Set<string>();
            for (const item of [...returnedCandidates, ...previousPool]) {
                if (item && item.preview_url && item.sha256 && !seenShas.has(item.sha256)) {
                    seenShas.add(item.sha256);
                    mergedCandidates.push(item);
                }
            }

            if (mergedCandidates.length > 0) {
                const firstNewIdx = mergedCandidates.findIndex((c) => !previousShas.has(c.sha256));
                const nextIdx =
                    firstNewIdx >= 0
                        ? firstNewIdx
                        : mergedCandidates.length > 1
                        ? (selectedCandidateIdx + 1) % mergedCandidates.length
                        : 0;

                setPhotoCandidates(mergedCandidates);
                setSelectedCandidateIdx(nextIdx);
                onCatalogPatch({ official_photo_candidates: mergedCandidates });
                setIsManualFallbackActive(false);
                toast.update(toastId, {
                    render: t('vault_sidebar.toast_candidates_found', {
                        count: mergedCandidates.length,
                    }),
                    type: 'success',
                    isLoading: false,
                    autoClose: 3000,
                });
            } else {
                setPhotoCandidates([]);
                setIsManualFallbackActive(true);
                toast.update(toastId, {
                    render: t('vault_sidebar.toast_no_candidates'),
                    type: 'info',
                    isLoading: false,
                    autoClose: 3500,
                });
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                toast.dismiss(toastId);
                return;
            }
            if (previousPool.length > 0) {
                setPhotoCandidates(previousPool);
            } else {
                setIsManualFallbackActive(true);
            }
            toast.update(toastId, {
                render: err?.message || t('vault_sidebar.toast_hunt_fallback'),
                type: 'warning',
                isLoading: false,
                autoClose: 3500,
            });
        } finally {
            if (photoHuntAbortRef.current === abortController) {
                setIsHuntingPhoto(false);
                photoHuntAbortRef.current = null;
            }
        }
    }, [
        canCurateAI,
        catalogId,
        photoCandidates,
        catalog.official_photo_candidates,
        selectedCandidateIdx,
        onCatalogPatch,
        t,
    ]);

    const handleConfirmCandidate = useCallback(async () => {
        if (
            !canCurateAI ||
            !catalogId ||
            candidateConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
        ) {
            return;
        }
        const candidate = photoCandidates[selectedCandidateIdx];
        if (!candidate) return;

        setIsPublishingCandidate(true);
        const toastId = toast.loading(t('vault_sidebar.toast_publishing_photo'));
        try {
            const fotoMediaTelemetry: FotoMediaTelemetry = {
                original_bytes: candidate.original_bytes,
                optimized_bytes: candidate.optimized_bytes,
                savings_pct: candidate.savings_pct,
                sha256: candidate.sha256,
                updated_at: new Date().toISOString(),
            };

            const resolvedCandidateAuditVersion =
                typeof candidate.vlm_audit_version === 'number'
                    ? candidate.vlm_audit_version
                    : CURRENT_VLM_AUDIT_VERSION;

            const res = await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    assetId: catalogId,
                    tenantAssetId: assetId !== catalogId ? assetId : undefined,
                    imageUrl: candidate.preview_url,
                    fotoMediaTelemetry,
                    fotoVlmAuditVersion: resolvedCandidateAuditVersion,
                    officialPhotoCandidates: photoCandidates,
                    confirmWord: 'ACTUALIZAR',
                }),
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson?.error || t('vault_sidebar.toast_publish_error'));
            }

            onCatalogPatch({
                foto_url: candidate.preview_url,
                foto_vlm_audit_version: resolvedCandidateAuditVersion,
                foto_media_telemetry: fotoMediaTelemetry,
                official_photo_candidates: photoCandidates,
            });

            setPhotoCandidates([]);
            setSelectedCandidateIdx(0);
            setCandidateConfirmText('');
            setIsManualFallbackActive(false);

            toast.update(toastId, {
                render: t('vault_sidebar.toast_photo_published', {
                    pct: candidate.savings_pct,
                }),
                type: 'success',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || t('vault_sidebar.toast_publish_error'),
                type: 'error',
                isLoading: false,
                autoClose: 3000,
            });
        } finally {
            setIsPublishingCandidate(false);
        }
    }, [
        canCurateAI,
        catalogId,
        candidateConfirmText,
        photoCandidates,
        selectedCandidateIdx,
        assetId,
        onCatalogPatch,
        t,
    ]);

    const handleDiscardCandidates = useCallback(() => {
        setPhotoCandidates([]);
        setSelectedCandidateIdx(0);
        setCandidateConfirmText('');
        setIsManualFallbackActive(true);
        toast.info(t('vault_sidebar.toast_review_closed'));
    }, [t]);

    const processManualPhotoUpload = useCallback(
        async (file: File) => {
            if (!canCurateAI || !catalogId || !file) return;
            if (!file.type.startsWith('image/')) {
                toast.error(t('vault_sidebar.toast_invalid_image'));
                return;
            }

            setIsUploadingPhoto(true);
            setManualAuditRejection(null);
            setReframePreview(null);
            const toastId = toast.loading(t('vault_sidebar.toast_auditing_vlm'));

            try {
                const framed = await frameEquipmentPhotoToStudio4x3(file);
                const formData = new FormData();
                formData.append('globalAssetId', catalogId);
                formData.append('file', framed.framedFile);

                const res = await authFetch(`${API_BASE_URL}/vault/verify-manual-official-photo`, {
                    method: 'POST',
                    body: formData,
                });
                const data = await res.json().catch(() => null);

                if (res.ok && data?.approved && data?.candidate) {
                    const basePool = (
                        photoCandidates.length > 0
                            ? photoCandidates
                            : catalog.official_photo_candidates || []
                    ).filter((c) => c && c.vlm_audit_version === CURRENT_VLM_AUDIT_VERSION);
                    const updatedPool = [
                        data.candidate,
                        ...basePool.filter((c) => c.sha256 !== data.candidate.sha256),
                    ];
                    setPhotoCandidates(updatedPool);
                    setSelectedCandidateIdx(0);
                    onCatalogPatch({ official_photo_candidates: updatedPool });
                    setIsManualFallbackActive(false);
                    toast.update(toastId, {
                        render: t('vault_sidebar.toast_manual_approved'),
                        type: 'success',
                        isLoading: false,
                        autoClose: 3500,
                    });
                } else {
                    const reasons =
                        Array.isArray(data?.rejection_reasons) && data.rejection_reasons.length > 0
                            ? data.rejection_reasons.join('. ')
                            : t('vault_sidebar.toast_manual_rejected_default');
                    setManualAuditRejection(reasons);
                    toast.update(toastId, {
                        render: t('vault_sidebar.toast_manual_rejected'),
                        type: 'warning',
                        isLoading: false,
                        autoClose: 4000,
                    });
                }
            } catch (err: any) {
                toast.update(toastId, {
                    render: err?.message || t('vault_sidebar.toast_manual_audit_error'),
                    type: 'error',
                    isLoading: false,
                    autoClose: 3000,
                });
            } finally {
                setIsUploadingPhoto(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        },
        [canCurateAI, catalogId, photoCandidates, catalog.official_photo_candidates, onCatalogPatch, t]
    );

    const handlePhotoFileSelected = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!canCurateAI || !file || !catalogId) return;
            await processManualPhotoUpload(file);
        },
        [canCurateAI, catalogId, processManualPhotoUpload]
    );

    // A-04 Paso 1: Vista previa HITL de re-encuadre 88% Studio 4:3 (`previewOnly: true`)
    const handleReframeCurrentPhoto = useCallback(async () => {
        if (!canCurateAI || !catalogId || !catalog.foto_url || isReframingPhoto) return;
        setIsReframingPhoto(true);
        setShowPhotoDeleteConfirm(false);
        setReframeConfirmText('');
        const toastId = toast.loading(t('vault_sidebar.toast_reframing_preview'));
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/reframe-official-photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    assetId: catalogId,
                    previewOnly: true,
                }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success && data?.proposedUrl) {
                const rawMetrics = data.metrics || data.foto_media_telemetry || {};
                const metrics: FotoMediaTelemetry = {
                    original_bytes: Number(
                        rawMetrics.original_bytes ??
                            rawMetrics.originalBytes ??
                            catalog.foto_media_telemetry?.original_bytes ??
                            0
                    ),
                    optimized_bytes: Number(
                        rawMetrics.optimized_bytes ?? rawMetrics.optimizedBytes ?? 0
                    ),
                    savings_pct: Number(rawMetrics.savings_pct ?? rawMetrics.savingsPct ?? 0),
                    sha256: String(data.proposedSha256 || rawMetrics.sha256 || ''),
                    width: rawMetrics.width,
                    height: rawMetrics.height,
                    updated_at: rawMetrics.updated_at || new Date().toISOString(),
                };
                setReframePreview({
                    currentUrl: String(data.currentUrl || catalog.foto_url),
                    proposedUrl: String(data.proposedUrl),
                    proposedSha256: String(data.proposedSha256 || metrics.sha256 || ''),
                    proposedMetrics: metrics,
                    isClientFallback: false,
                });
                toast.update(toastId, {
                    render: t('vault_sidebar.toast_reframe_preview_ready'),
                    type: 'info',
                    isLoading: false,
                    autoClose: 3000,
                });
            } else {
                throw new Error(data?.error || t('vault_sidebar.toast_reframe_error'));
            }
        } catch {
            try {
                const framed = await reframeExistingEquipmentPhotoUrl(catalog.foto_url);
                const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(
                    framed.framedFile,
                    {
                        profile: 'IMAGE_TECHNICAL_HD',
                        scope: 'GLOBAL_OEM',
                        filename: `reframed_${catalogId}.webp`,
                    }
                );
                const telemetry: FotoMediaTelemetry = {
                    original_bytes: framed.originalBytes,
                    optimized_bytes: digested.optimizedBytes,
                    savings_pct: Math.round(digested.savingsRatio * 100),
                    sha256: digested.sha256,
                    updated_at: new Date().toISOString(),
                };
                setReframePreview({
                    currentUrl: catalog.foto_url,
                    proposedUrl: descriptor.downloadUrl,
                    proposedSha256: digested.sha256,
                    proposedMetrics: telemetry,
                    isClientFallback: true,
                });
                toast.update(toastId, {
                    render: t('vault_sidebar.toast_reframe_preview_ready'),
                    type: 'info',
                    isLoading: false,
                    autoClose: 3000,
                });
            } catch (clientErr: any) {
                toast.update(toastId, {
                    render: clientErr?.message || t('vault_sidebar.toast_reframe_error'),
                    type: 'error',
                    isLoading: false,
                    autoClose: 3000,
                });
            }
        } finally {
            setIsReframingPhoto(false);
        }
    }, [
        canCurateAI,
        catalogId,
        catalog.foto_url,
        catalog.foto_media_telemetry,
        isReframingPhoto,
        t,
    ]);

    // A-04 Paso 2: Consolidación HITL de re-encuadre 88% con `"ACTUALIZAR"`
    const handleConfirmReframeHitl = useCallback(async () => {
        if (
            !canCurateAI ||
            !catalogId ||
            !reframePreview ||
            isConsolidatingReframe ||
            reframeConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
        ) {
            return;
        }
        setIsConsolidatingReframe(true);
        const toastId = toast.loading(t('vault_sidebar.toast_reframing_consolidate'));
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/reframe-official-photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    assetId: catalogId,
                    previewOnly: false,
                    confirmWord: 'ACTUALIZAR',
                    proposedUrl: reframePreview.proposedUrl,
                    proposedSha256: reframePreview.proposedSha256,
                    proposedMetrics: reframePreview.proposedMetrics,
                }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                const resolvedUrl = String(
                    data.foto_url || data.proposedUrl || reframePreview.proposedUrl
                );
                const resolvedTelemetry: FotoMediaTelemetry =
                    data.foto_media_telemetry || data.metrics || reframePreview.proposedMetrics;

                if (assetId && assetId !== catalogId) {
                    await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            globalAssetId: catalogId,
                            assetId: catalogId,
                            tenantAssetId: assetId,
                            imageUrl: resolvedUrl,
                            fotoMediaTelemetry: resolvedTelemetry,
                            confirmWord: 'ACTUALIZAR',
                        }),
                    }).catch(() => undefined);
                }

                onCatalogPatch({
                    foto_url: resolvedUrl,
                    foto_media_telemetry: resolvedTelemetry,
                });
                setReframePreview(null);
                setReframeConfirmText('');
                toast.update(toastId, {
                    render: t('vault_sidebar.toast_reframe_consolidated'),
                    type: 'success',
                    isLoading: false,
                    autoClose: 3000,
                });
            } else if (reframePreview.isClientFallback) {
                const saveRes = await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        globalAssetId: catalogId,
                        assetId: catalogId,
                        tenantAssetId: assetId !== catalogId ? assetId : undefined,
                        imageUrl: reframePreview.proposedUrl,
                        fotoMediaTelemetry: reframePreview.proposedMetrics,
                        confirmWord: 'ACTUALIZAR',
                    }),
                });
                if (!saveRes.ok) {
                    const saveErr = await saveRes.json().catch(() => ({}));
                    throw new Error(saveErr?.error || t('vault_sidebar.toast_reframe_error'));
                }
                onCatalogPatch({
                    foto_url: reframePreview.proposedUrl,
                    foto_media_telemetry: reframePreview.proposedMetrics,
                });
                setReframePreview(null);
                setReframeConfirmText('');
                toast.update(toastId, {
                    render: t('vault_sidebar.toast_reframe_consolidated'),
                    type: 'success',
                    isLoading: false,
                    autoClose: 3000,
                });
            } else {
                throw new Error(data?.error || t('vault_sidebar.toast_reframe_error'));
            }
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || t('vault_sidebar.toast_reframe_error'),
                type: 'error',
                isLoading: false,
                autoClose: 3000,
            });
        } finally {
            setIsConsolidatingReframe(false);
        }
    }, [
        canCurateAI,
        catalogId,
        reframePreview,
        isConsolidatingReframe,
        reframeConfirmText,
        assetId,
        onCatalogPatch,
        t,
    ]);

    const handlePhotoDelete = useCallback(async () => {
        if (
            !canCurateAI ||
            !catalogId ||
            photoDeleteConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
        ) {
            return;
        }

        setIsUploadingPhoto(true);
        const toastId = toast.loading(t('vault_sidebar.toast_deleting_photo'));

        try {
            const delRes = await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    assetId: catalogId,
                    tenantAssetId: assetId !== catalogId ? assetId : undefined,
                    imageUrl: null,
                    fotoMediaTelemetry: null,
                    confirmWord: 'ACTUALIZAR',
                }),
            });

            if (!delRes.ok) {
                const errJson = await delRes.json().catch(() => ({}));
                throw new Error(errJson?.error || t('vault_sidebar.toast_delete_photo_error'));
            }

            onCatalogPatch({
                foto_url: '',
                foto_vlm_audit_version: null,
                foto_media_telemetry: undefined,
            });

            setShowPhotoDeleteConfirm(false);
            setPhotoDeleteConfirmText('');
            setPhotoCandidates([]);
            setReframePreview(null);
            setIsManualFallbackActive(false);

            toast.update(toastId, {
                render: t('vault_sidebar.toast_photo_deleted'),
                type: 'success',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || t('vault_sidebar.toast_delete_photo_error'),
                type: 'error',
                isLoading: false,
                autoClose: 3000,
            });
        } finally {
            setIsUploadingPhoto(false);
        }
    }, [canCurateAI, catalogId, assetId, photoDeleteConfirmText, onCatalogPatch, t]);

    // A-04 Paso 1: Vista previa HITL de reconciliación de ficha lateral (`previewOnly: true`)
    const handleReconcileSidebarProfile = useCallback(async () => {
        if (!canCurateAI || !catalogId || isReconcilingSidebar) return;
        setIsReconcilingSidebar(true);
        setEditingSidebarSection(null);
        setReconcileConfirmText('');
        const toastId = toast.loading(t('vault_sidebar.toast_reconciling_preview'));
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/reconcile-sidebar-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    assetId: catalogId,
                    previewOnly: true,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success || !data?.proposedProfile) {
                throw new Error(data?.error || t('vault_sidebar.toast_reconcile_error'));
            }
            const fallbackCurrent: SidebarProfileSnapshot = {
                caracteristicas_principales: catalog.caracteristicas_principales || [],
                ambiente_operativo: catalog.ambiente_operativo || [],
                contexto_operativo: catalog.contexto_operativo || [],
                energy_consumption_profile: catalog.energy_consumption_profile,
            };
            setReconcilePreview({
                currentProfile: data.currentProfile || fallbackCurrent,
                proposedProfile: data.proposedProfile,
            });
            setReconcileApproveFields({
                caracteristicas: true,
                ambiente: true,
                contexto: true,
            });
            toast.update(toastId, {
                render: t('vault_sidebar.toast_reconcile_preview_ready'),
                type: 'info',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || t('vault_sidebar.toast_reconcile_error'),
                type: 'error',
                isLoading: false,
                autoClose: 3500,
            });
        } finally {
            setIsReconcilingSidebar(false);
        }
    }, [
        canCurateAI,
        catalogId,
        isReconcilingSidebar,
        catalog.caracteristicas_principales,
        catalog.ambiente_operativo,
        catalog.contexto_operativo,
        catalog.energy_consumption_profile,
        t,
    ]);

    // A-04 Paso 2: Consolidación HITL granular 1 a 1 con `"ACTUALIZAR"`
    const handleConfirmReconcileHitl = useCallback(async () => {
        if (
            !canCurateAI ||
            !catalogId ||
            !reconcilePreview ||
            isConsolidatingReconcile ||
            reconcileConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
        ) {
            return;
        }
        const hasAnySelected =
            reconcileApproveFields.caracteristicas ||
            reconcileApproveFields.ambiente ||
            reconcileApproveFields.contexto;
        if (!hasAnySelected) return;

        setIsConsolidatingReconcile(true);
        const toastId = toast.loading(t('vault_sidebar.toast_reconciling_consolidate'));
        try {
            const approvedProfile: SidebarProfileSnapshot = {
                ...reconcilePreview.proposedProfile,
                caracteristicas_principales: reconcileApproveFields.caracteristicas
                    ? reconcilePreview.proposedProfile.caracteristicas_principales
                    : reconcilePreview.currentProfile.caracteristicas_principales,
                ambiente_operativo: reconcileApproveFields.ambiente
                    ? reconcilePreview.proposedProfile.ambiente_operativo
                    : reconcilePreview.currentProfile.ambiente_operativo,
                contexto_operativo: reconcileApproveFields.contexto
                    ? reconcilePreview.proposedProfile.contexto_operativo
                    : reconcilePreview.currentProfile.contexto_operativo,
                canonical_specs: reconcileApproveFields.caracteristicas
                    ? reconcilePreview.proposedProfile.canonical_specs
                    : reconcilePreview.currentProfile.canonical_specs,
                energy_consumption_profile: reconcileApproveFields.caracteristicas
                    ? reconcilePreview.proposedProfile.energy_consumption_profile
                    : reconcilePreview.currentProfile.energy_consumption_profile,
                configuration_profile: reconcileApproveFields.caracteristicas
                    ? reconcilePreview.proposedProfile.configuration_profile
                    : reconcilePreview.currentProfile.configuration_profile,
                equipment_type_key: reconcileApproveFields.caracteristicas
                    ? reconcilePreview.proposedProfile.equipment_type_key
                    : reconcilePreview.currentProfile.equipment_type_key,
            };

            const res = await authFetch(`${API_BASE_URL}/vault/reconcile-sidebar-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    assetId: catalogId,
                    previewOnly: false,
                    confirmWord: 'ACTUALIZAR',
                    approvedProfile,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || t('vault_sidebar.toast_reconcile_error'));
            }

            onCatalogPatch({
                caracteristicas_principales:
                    data.caracteristicas_principales ||
                    approvedProfile.caracteristicas_principales ||
                    catalog.caracteristicas_principales,
                ambiente_operativo:
                    data.ambiente_operativo ||
                    approvedProfile.ambiente_operativo ||
                    catalog.ambiente_operativo,
                contexto_operativo:
                    data.contexto_operativo ||
                    approvedProfile.contexto_operativo ||
                    catalog.contexto_operativo,
                energy_consumption_profile:
                    data.energy_consumption_profile ||
                    approvedProfile.energy_consumption_profile ||
                    catalog.energy_consumption_profile,
            });
            setReconcilePreview(null);
            setReconcileConfirmText('');
            if (onRefreshVault) void onRefreshVault();
            toast.update(toastId, {
                render: t('vault_sidebar.toast_reconcile_consolidated'),
                type: 'success',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || t('vault_sidebar.toast_reconcile_error'),
                type: 'error',
                isLoading: false,
                autoClose: 3500,
            });
        } finally {
            setIsConsolidatingReconcile(false);
        }
    }, [
        canCurateAI,
        catalogId,
        reconcilePreview,
        isConsolidatingReconcile,
        reconcileConfirmText,
        reconcileApproveFields,
        catalog.caracteristicas_principales,
        catalog.ambiente_operativo,
        catalog.contexto_operativo,
        catalog.energy_consumption_profile,
        onCatalogPatch,
        onRefreshVault,
        t,
    ]);

    const normalizedMainSpecs = React.useMemo(
        () =>
            normalizeFrontendSpecLinesByEnergy(catalog.caracteristicas_principales, {
                primaryEnergy: catalog.energy_consumption_profile?.energy_source || null,
                typeContextText: `${catalog.makeModel || ''} ${catalog.tipo_equipo || ''} ${catalog.categoria_equipo || ''}`,
            }),
        [
            catalog.caracteristicas_principales,
            catalog.energy_consumption_profile?.energy_source,
            catalog.makeModel,
            catalog.tipo_equipo,
            catalog.categoria_equipo,
        ]
    );

    const normalizedDesignConditions = React.useMemo(
        () =>
            sanitizeFrontendContextLines(catalog.ambiente_operativo, {
                canonicalTypeEs: catalog.tipo_equipo || null,
            }),
        [catalog.ambiente_operativo, catalog.tipo_equipo]
    );

    const normalizedWorkContext = React.useMemo(
        () =>
            sanitizeFrontendContextLines(catalog.contexto_operativo, {
                canonicalTypeEs: catalog.tipo_equipo || null,
            }),
        [catalog.contexto_operativo, catalog.tipo_equipo]
    );

    const isLegacyPreV4Photo =
        Boolean(catalog.foto_url) &&
        (typeof catalog.foto_vlm_audit_version !== 'number' ||
            catalog.foto_vlm_audit_version < CURRENT_VLM_AUDIT_VERSION);

    const handleOpenSidebarEditor = useCallback(
        (section: 'caracteristicas' | 'ambiente' | 'contexto') => {
            const currentItems =
                section === 'caracteristicas'
                    ? normalizedMainSpecs
                    : section === 'ambiente'
                    ? normalizedDesignConditions
                    : normalizedWorkContext;
            setEditingSidebarSection((prev) => (prev === section ? null : section));
            setSidebarDraftText(currentItems.filter((x) => !x.startsWith('[')).join('\n'));
            setSidebarConfirmText('');
        },
        [normalizedMainSpecs, normalizedDesignConditions, normalizedWorkContext]
    );

    const handleSaveSidebarSectionHitl = useCallback(async () => {
        if (
            !canCurateAI ||
            !catalogId ||
            !editingSidebarSection ||
            sidebarConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
        ) {
            return;
        }
        setIsSavingSidebarHitl(true);
        const lines = sidebarDraftText
            .split('\n')
            .map((l) => l.replace(/^[•\-*]\s*/, '').trim())
            .filter(Boolean);
        const finalLines =
            lines.length > 0 ? lines : [t('opermaq_domains.not_declared')];

        const payload: Record<string, any> = {
            globalAssetId: catalogId,
            confirmationKeyword: 'ACTUALIZAR',
            confirmWord: 'ACTUALIZAR',
        };
        if (editingSidebarSection === 'caracteristicas') {
            payload.caracteristicas_principales = finalLines;
        }
        if (editingSidebarSection === 'ambiente') payload.ambiente_operativo = finalLines;
        if (editingSidebarSection === 'contexto') payload.contexto_operativo = finalLines;

        try {
            const res = await authFetch(`${API_BASE_URL}/vault/update-sidebar-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || t('vault_sidebar.toast_save_section_error'));
            }
            onCatalogPatch({
                ...(editingSidebarSection === 'caracteristicas'
                    ? { caracteristicas_principales: finalLines }
                    : {}),
                ...(editingSidebarSection === 'ambiente'
                    ? { ambiente_operativo: finalLines }
                    : {}),
                ...(editingSidebarSection === 'contexto'
                    ? { contexto_operativo: finalLines }
                    : {}),
            });
            setEditingSidebarSection(null);
            setSidebarDraftText('');
            setSidebarConfirmText('');
            toast.success(t('vault_sidebar.toast_section_saved'));
        } catch (err: any) {
            toast.error(err?.message || t('vault_sidebar.toast_save_section_error'));
        } finally {
            setIsSavingSidebarHitl(false);
        }
    }, [
        canCurateAI,
        catalogId,
        editingSidebarSection,
        sidebarConfirmText,
        sidebarDraftText,
        onCatalogPatch,
        t,
    ]);

    const handleDragOver = useCallback(
        (e: React.DragEvent) => {
            if (!canCurateAI) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingPhoto(true);
        },
        [canCurateAI]
    );

    const handleDragLeave = useCallback(
        (e: React.DragEvent) => {
            if (!canCurateAI) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingPhoto(false);
        },
        [canCurateAI]
    );

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            if (!canCurateAI) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingPhoto(false);

            const file = e.dataTransfer.files?.[0];
            if (!file || !catalogId) return;

            if (!isManualFallbackActive && !catalog.foto_url) {
                toast.info(t('vault_sidebar.toast_drop_hint_hunt'));
                return;
            }

            await processManualPhotoUpload(file);
        },
        [canCurateAI, catalogId, isManualFallbackActive, catalog.foto_url, processManualPhotoUpload, t]
    );

    const renderHitlListPreview = (items?: string[]) => {
        const clean = Array.isArray(items) && items.length > 0 ? items : [t('opermaq_domains.not_declared')];
        return (
            <ul className="space-y-1 text-[10px] font-mono text-[#475569] dark:text-[#8A93A6] tabular-nums">
                {clean.slice(0, 6).map((line, i) => (
                    <li key={i} className="leading-tight break-words">
                        • {line}
                    </li>
                ))}
                {clean.length > 6 && (
                    <li className="text-[#94A3B8] dark:text-[#5A6072]">
                        +{clean.length - 6}
                    </li>
                )}
            </ul>
        );
    };

    return (
        <aside className="no-print shrink-0 w-[260px] flex flex-col border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] overflow-y-auto hide-scrollbar select-none">
            <div className="shrink-0 p-[13px]">
                <div
                    onDragOver={canCurateAI ? handleDragOver : undefined}
                    onDragLeave={canCurateAI ? handleDragLeave : undefined}
                    onDrop={canCurateAI ? handleDrop : undefined}
                    className={`relative aspect-[4/3] w-full border rounded-none shadow-none overflow-hidden transition-all duration-200 group ${
                        canCurateAI && isDraggingPhoto
                            ? 'border-[#C68346] bg-[#C68346]/5'
                            : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000]'
                    }`}
                >
                    {isHuntingPhoto || isUploadingPhoto || isReframingPhoto ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-[8px] p-[8px] bg-[#F8FAFC] dark:bg-[#000000]">
                            <M3CircularProgress
                                size={24}
                                strokeWidth={3}
                                indeterminate
                                tone="copper"
                                ariaLabel={
                                    isHuntingPhoto
                                        ? t('vault_sidebar.status_hunting_photo')
                                        : isReframingPhoto
                                        ? t('vault_sidebar.status_reframing_photo')
                                        : t('vault_sidebar.status_auditing_photo')
                                }
                            />
                            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] text-center">
                                {isHuntingPhoto
                                    ? t('vault_sidebar.status_hunting_photo')
                                    : isReframingPhoto
                                    ? t('vault_sidebar.status_reframing_photo')
                                    : t('vault_sidebar.status_auditing_photo')}
                            </span>
                        </div>
                    ) : photoCandidates.length > 0 ? (
                        <div className="relative w-full h-full bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center">
                            <img
                                src={photoCandidates[selectedCandidateIdx]?.preview_url}
                                alt={t('vault_sidebar.candidate_alt', {
                                    index: selectedCandidateIdx + 1,
                                })}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                className="w-full h-full object-contain select-none pointer-events-none"
                            />
                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-[#000000]/80 text-[8px] font-mono font-bold text-[#00AEEF] uppercase tracking-wider tabular-nums select-none pointer-events-none">
                                {photoCandidates[selectedCandidateIdx]?.framing_mode === 'STUDIO_88'
                                    ? t('vault_sidebar.badge_oem_studio_88')
                                    : t('vault_sidebar.badge_oem_4x3')}
                            </div>
                        </div>
                    ) : catalog.foto_url ? (
                        <div className="relative w-full h-full bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center">
                            <img
                                src={catalog.foto_url}
                                alt={catalog.makeModel}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                className="w-full h-full object-contain select-none pointer-events-none"
                            />
                        </div>
                    ) : canCurateAI ? (
                        <div
                            onClick={handleStartOfficialPhotoHunt}
                            className={`w-full h-full flex flex-col items-center justify-center gap-[8px] cursor-pointer transition-all border border-dashed rounded-none ${
                                isDraggingPhoto
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] hover:border-[#C68346]'
                            }`}
                        >
                            <span className="material-symbols-outlined !text-xl">image_search</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-center px-[8px]">
                                {isManualFallbackActive
                                    ? t('vault_sidebar.no_candidates_retry_cta')
                                    : t('vault_sidebar.hunt_official_photo_cta')}
                            </span>
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center p-[13px] text-center">
                            <span className="text-[11px] text-[#94A3B8] dark:text-[#5A6072]">
                                {t('opermaq_domains.not_declared')}
                            </span>
                        </div>
                    )}
                </div>

                {canCurateAI && photoCandidates.length === 0 && !catalog.foto_url && (
                    <div className="flex flex-col gap-[8px] w-full mt-[8px]">
                        <div className="flex gap-[8px] w-full">
                            <button
                                type="button"
                                onClick={handleStartOfficialPhotoHunt}
                                disabled={isUploadingPhoto || isReframingPhoto}
                                className="flex-1 py-1.5 px-[8px] border border-[#C68346] bg-[#C68346]/10 hover:bg-[#C68346] text-[#C68346] hover:text-[#000000] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {isHuntingPhoto
                                    ? t('vault_sidebar.btn_updating_now')
                                    : isManualFallbackActive
                                    ? t('vault_sidebar.btn_refresh_ai_search')
                                    : t('vault_sidebar.btn_hunt_ai_photo')}
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isHuntingPhoto || isUploadingPhoto || isReframingPhoto}
                                className="py-1.5 px-[8px] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {t('vault_sidebar.btn_upload_manual')}
                            </button>
                        </div>
                        {verifiedStoredCandidates.length > 0 && (
                            <button
                                type="button"
                                onClick={handleOpenStoredAlternatives}
                                disabled={isHuntingPhoto || isUploadingPhoto || isReframingPhoto}
                                className="w-full py-1 px-[8px] border border-[#00AEEF] text-[#00AEEF] hover:bg-[#00AEEF] hover:text-[#000000] text-[9px] font-mono font-bold uppercase tracking-wider tabular-nums rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {t('vault_sidebar.btn_view_saved_alternatives', {
                                    count: verifiedStoredCandidates.length,
                                })}
                            </button>
                        )}
                    </div>
                )}

                {photoCandidates.length > 0 && (
                    <div className="flex flex-col gap-[8px] w-full mt-[8px]">
                        {/* Vista comparativa [Actual] -> [Sugerido] cuando ya existe foto publicada */}
                        {catalog.foto_url && (
                            <div className="grid grid-cols-2 gap-[8px] p-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                                <div className="flex flex-col gap-[4px]">
                                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                        {t('vault_sidebar.hitl_label_current')}
                                    </span>
                                    <div className="aspect-[4/3] w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden">
                                        <img
                                            src={catalog.foto_url}
                                            alt={t('vault_sidebar.hitl_label_current')}
                                            draggable={false}
                                            onContextMenu={(e) => e.preventDefault()}
                                            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                            className="w-full h-full object-contain select-none pointer-events-none"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-[4px]">
                                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-[#00AEEF]">
                                        {t('vault_sidebar.hitl_label_proposed')}
                                    </span>
                                    <div className="aspect-[4/3] w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#00AEEF] flex items-center justify-center overflow-hidden">
                                        <img
                                            src={photoCandidates[selectedCandidateIdx]?.preview_url}
                                            alt={t('vault_sidebar.hitl_label_proposed')}
                                            draggable={false}
                                            onContextMenu={(e) => e.preventDefault()}
                                            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                            className="w-full h-full object-contain select-none pointer-events-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between px-[8px] py-1 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[9px] font-mono tabular-nums rounded-none">
                            <button
                                type="button"
                                onClick={() =>
                                    setSelectedCandidateIdx(
                                        (prev) =>
                                            (prev - 1 + photoCandidates.length) %
                                            photoCandidates.length
                                    )
                                }
                                disabled={photoCandidates.length <= 1}
                                aria-label={t('vault_sidebar.aria_prev_candidate')}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <span className="material-symbols-outlined !text-[16px]">
                                    chevron_left
                                </span>
                            </button>
                            <span className="text-[#475569] dark:text-[#8A93A6] font-bold tracking-wider">
                                {t('vault_sidebar.candidate_counter', {
                                    current: selectedCandidateIdx + 1,
                                    total: photoCandidates.length,
                                })}
                            </span>
                            <button
                                type="button"
                                onClick={() =>
                                    setSelectedCandidateIdx(
                                        (prev) => (prev + 1) % photoCandidates.length
                                    )
                                }
                                disabled={photoCandidates.length <= 1}
                                aria-label={t('vault_sidebar.aria_next_candidate')}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <span className="material-symbols-outlined !text-[16px]">
                                    chevron_right
                                </span>
                            </button>
                        </div>

                        {photoCandidates.length > 1 && (
                            <div className="grid grid-cols-4 gap-[8px] w-full">
                                {photoCandidates.map((cand, idx) => {
                                    const isSelected = idx === selectedCandidateIdx;
                                    const isPublished =
                                        Boolean(catalog.foto_url) &&
                                        (cand.preview_url === catalog.foto_url ||
                                            (Boolean(catalog.foto_media_telemetry?.sha256) &&
                                                cand.sha256 ===
                                                    catalog.foto_media_telemetry?.sha256));
                                    return (
                                        <button
                                            key={cand.candidate_id || `${cand.sha256}_${idx}`}
                                            type="button"
                                            onClick={() => setSelectedCandidateIdx(idx)}
                                            title={t('vault_sidebar.alternative_title', {
                                                index: idx + 1,
                                                source:
                                                    cand.verified_variant_summary ||
                                                    cand.source_label,
                                            })}
                                            className={`relative aspect-[4/3] w-full bg-[#FFFFFF] dark:bg-[#000000] border rounded-none shadow-none overflow-hidden cursor-pointer transition-colors p-0 ${
                                                isSelected
                                                    ? 'border-2 border-[#C68346]'
                                                    : 'border-[#E2E8F0] dark:border-[#12151C] opacity-75 hover:opacity-100 hover:border-[#00AEEF]'
                                            }`}
                                        >
                                            <img
                                                src={cand.preview_url}
                                                alt={t('vault_sidebar.candidate_alt', {
                                                    index: idx + 1,
                                                })}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                style={
                                                    {
                                                        WebkitUserDrag: 'none',
                                                    } as React.CSSProperties
                                                }
                                                className="w-full h-full object-contain select-none pointer-events-none"
                                            />
                                            <span className="absolute bottom-0 left-0 px-1 bg-[#000000]/80 text-[8px] font-mono font-bold text-[#F3F4F6] tabular-nums select-none pointer-events-none">
                                                #{idx + 1}
                                            </span>
                                            {isPublished && (
                                                <span className="absolute top-0 right-0 px-1 bg-[#00AEEF] text-[7px] font-mono font-bold text-[#000000] uppercase select-none pointer-events-none">
                                                    {t('vault_sidebar.badge_active_short')}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div className="flex gap-[8px] w-full">
                            <button
                                type="button"
                                onClick={handleStartOfficialPhotoHunt}
                                disabled={isPublishingCandidate}
                                className="flex-1 py-1 border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-[#000000] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {isHuntingPhoto
                                    ? t('vault_sidebar.btn_updating_short')
                                    : t('vault_sidebar.btn_refresh_ai_search')}
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isPublishingCandidate}
                                className="px-[8px] py-1 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {t('vault_sidebar.btn_manual_short')}
                            </button>
                        </div>

                        <div className="px-[8px] py-1 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex flex-col gap-[4px] font-mono tabular-nums text-[9px] rounded-none">
                            <div className="flex items-center justify-between gap-[8px]">
                                <span className="text-[#00AEEF] font-bold uppercase truncate">
                                    {photoCandidates[selectedCandidateIdx]?.verified_variant_summary ||
                                        t('registration.variant_photo_verified_badge')}
                                </span>
                                <span className="text-[#94A3B8] dark:text-[#5A6072] shrink-0">
                                    {Math.round(
                                        (photoCandidates[selectedCandidateIdx]?.authenticity_score ||
                                            0) * 100
                                    )}
                                    % OEM
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-[8px]">
                                <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                    ORIG:{' '}
                                    {formatPhotoBytes(
                                        photoCandidates[selectedCandidateIdx]?.original_bytes
                                    )}{' '}
                                    {'->'} CAS:{' '}
                                    {formatPhotoBytes(
                                        photoCandidates[selectedCandidateIdx]?.optimized_bytes
                                    )}
                                </span>
                                <span className="font-bold text-[#00AEEF] shrink-0">
                                    -{photoCandidates[selectedCandidateIdx]?.savings_pct}%
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('vault_sidebar.prompt_type_actualizar_publish')}
                            </span>
                            <input
                                type="text"
                                value={candidateConfirmText}
                                onChange={(e) =>
                                    setCandidateConfirmText(e.target.value.toUpperCase())
                                }
                                onKeyDown={(e) => {
                                    if (
                                        e.key === 'Enter' &&
                                        !isPublishingCandidate &&
                                        candidateConfirmText.trim().toUpperCase() === 'ACTUALIZAR'
                                    ) {
                                        e.preventDefault();
                                        void handleConfirmCandidate();
                                    }
                                }}
                                placeholder="ACTUALIZAR"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full px-[8px] py-1 text-[11px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <div className="flex gap-[8px]">
                                <button
                                    type="button"
                                    onClick={handleConfirmCandidate}
                                    disabled={
                                        isPublishingCandidate ||
                                        candidateConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
                                    }
                                    className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {t('vault_sidebar.btn_confirm')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDiscardCandidates}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_close')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {photoCandidates.length === 0 && manualAuditRejection && (
                    <div className="mt-[8px] p-[8px] border border-[#C68346] bg-[#C68346]/10 flex flex-col gap-[8px] rounded-none">
                        <div className="flex items-center gap-[8px] text-[#C68346] text-[9px] font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined !text-[14px]">warning</span>
                            <span>{t('vault_sidebar.oem_auditor_rejection_title')}</span>
                        </div>
                        <p className="text-[10px] text-[#0F172A] dark:text-[#F3F4F6] font-mono leading-tight">
                            {manualAuditRejection}
                        </p>
                    </div>
                )}

                {photoCandidates.length === 0 && catalog.foto_url && (
                    <>
                        <div className="mt-[8px] px-[8px] py-1 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between gap-[8px] rounded-none">
                            {catalog.foto_media_telemetry ? (
                                <div className="flex items-center gap-[8px] font-mono tabular-nums text-[9px] min-w-0">
                                    <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                        {formatPhotoBytes(
                                            catalog.foto_media_telemetry.original_bytes
                                        )}{' '}
                                        {'->'}{' '}
                                        {formatPhotoBytes(
                                            catalog.foto_media_telemetry.optimized_bytes
                                        )}
                                    </span>
                                    {catalog.foto_media_telemetry.savings_pct > 0 && (
                                        <span className="font-bold text-[#00AEEF] shrink-0">
                                            -{catalog.foto_media_telemetry.savings_pct}%
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="font-mono text-[9px] text-[#94A3B8] dark:text-[#5A6072]">
                                    CAS
                                </span>
                            )}

                            {canCurateAI && !catalog.is_sealed && (
                                <div className="flex items-center gap-[2px] shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleStartOfficialPhotoHunt}
                                        disabled={
                                            isHuntingPhoto ||
                                            isReframingPhoto ||
                                            isUploadingPhoto ||
                                            isConsolidatingReframe
                                        }
                                        title={t('vault_sidebar.aria_search_oem_photo')}
                                        aria-label={t('vault_sidebar.aria_search_oem_photo')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#C68346] dark:hover:text-[#C68346] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                    >
                                        <span className="material-symbols-outlined !text-[15px]">
                                            travel_explore
                                        </span>
                                    </button>

                                    {verifiedStoredCandidates.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleOpenStoredAlternatives}
                                            disabled={
                                                isHuntingPhoto ||
                                                isReframingPhoto ||
                                                isUploadingPhoto ||
                                                isConsolidatingReframe
                                            }
                                            title={t('vault_sidebar.aria_verified_alternatives', {
                                                count: verifiedStoredCandidates.length,
                                            })}
                                            aria-label={t(
                                                'vault_sidebar.aria_verified_alternatives',
                                                { count: verifiedStoredCandidates.length }
                                            )}
                                            className="bg-transparent border-0 outline-none p-1 text-[#00AEEF] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                        >
                                            <span className="material-symbols-outlined !text-[15px]">
                                                photo_library
                                            </span>
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={handleReframeCurrentPhoto}
                                        disabled={
                                            isHuntingPhoto ||
                                            isReframingPhoto ||
                                            isUploadingPhoto ||
                                            isConsolidatingReframe
                                        }
                                        title={t('vault_sidebar.aria_reframe_88')}
                                        aria-label={t('vault_sidebar.aria_reframe_88')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#00AEEF] dark:hover:text-[#00AEEF] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                    >
                                        <span className="material-symbols-outlined !text-[15px]">
                                            crop_free
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={
                                            isHuntingPhoto ||
                                            isReframingPhoto ||
                                            isUploadingPhoto ||
                                            isConsolidatingReframe
                                        }
                                        title={t('vault_sidebar.aria_upload_manual_photo')}
                                        aria-label={t('vault_sidebar.aria_upload_manual_photo')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                    >
                                        <span className="material-symbols-outlined !text-[15px]">
                                            upload_file
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowPhotoDeleteConfirm((prev) => !prev);
                                            setPhotoDeleteConfirmText('');
                                            setReframePreview(null);
                                        }}
                                        disabled={
                                            isHuntingPhoto ||
                                            isReframingPhoto ||
                                            isUploadingPhoto ||
                                            isConsolidatingReframe
                                        }
                                        title={t('vault_sidebar.aria_delete_photo')}
                                        aria-label={t('vault_sidebar.aria_delete_photo')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#C68346] dark:hover:text-[#C68346] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                    >
                                        <span className="material-symbols-outlined !text-[15px]">
                                            delete
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* A-04 Panel Comparativo HITL [Actual] -> [Sugerido] para Re-encuadre 88% */}
                        {canCurateAI && reframePreview && (
                            <div className="flex flex-col gap-[8px] w-full mt-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none shadow-none">
                                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#00AEEF]">
                                    {t('vault_sidebar.reframe_hitl_title')}
                                </span>
                                <div className="grid grid-cols-2 gap-[8px]">
                                    <div className="flex flex-col gap-[4px]">
                                        <span className="text-[8px] font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('vault_sidebar.hitl_label_current')}
                                        </span>
                                        <div className="aspect-[4/3] w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden">
                                            <img
                                                src={reframePreview.currentUrl}
                                                alt={t('vault_sidebar.hitl_label_current')}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                style={
                                                    {
                                                        WebkitUserDrag: 'none',
                                                    } as React.CSSProperties
                                                }
                                                className="w-full h-full object-contain select-none pointer-events-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-[4px]">
                                        <span className="text-[8px] font-mono font-bold uppercase text-[#00AEEF]">
                                            {t('vault_sidebar.hitl_label_proposed')}
                                        </span>
                                        <div className="aspect-[4/3] w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#00AEEF] flex items-center justify-center overflow-hidden">
                                            <img
                                                src={reframePreview.proposedUrl}
                                                alt={t('vault_sidebar.hitl_label_proposed')}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                style={
                                                    {
                                                        WebkitUserDrag: 'none',
                                                    } as React.CSSProperties
                                                }
                                                className="w-full h-full object-contain select-none pointer-events-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-[8px] font-mono tabular-nums text-[9px]">
                                    <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                        ORIG:{' '}
                                        {formatPhotoBytes(
                                            reframePreview.proposedMetrics.original_bytes
                                        )}{' '}
                                        {'->'} CAS:{' '}
                                        {formatPhotoBytes(
                                            reframePreview.proposedMetrics.optimized_bytes
                                        )}
                                    </span>
                                    <span className="font-bold text-[#00AEEF] shrink-0">
                                        -{reframePreview.proposedMetrics.savings_pct}%
                                    </span>
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('vault_sidebar.prompt_type_actualizar_consolidate')}
                                </span>
                                <input
                                    type="text"
                                    value={reframeConfirmText}
                                    onChange={(e) =>
                                        setReframeConfirmText(e.target.value.toUpperCase())
                                    }
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === 'Enter' &&
                                            !isConsolidatingReframe &&
                                            reframeConfirmText.trim().toUpperCase() === 'ACTUALIZAR'
                                        ) {
                                            e.preventDefault();
                                            void handleConfirmReframeHitl();
                                        }
                                    }}
                                    placeholder="ACTUALIZAR"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-[8px] py-1 text-[11px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                                />
                                <div className="flex gap-[8px]">
                                    <button
                                        type="button"
                                        onClick={handleConfirmReframeHitl}
                                        disabled={
                                            isConsolidatingReframe ||
                                            reframeConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
                                        }
                                        className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        {t('vault_sidebar.btn_confirm')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setReframePreview(null);
                                            setReframeConfirmText('');
                                        }}
                                        disabled={isConsolidatingReframe}
                                        className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                    >
                                        {t('vault_sidebar.btn_cancel')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {canCurateAI &&
                            !catalog.is_sealed &&
                            !showPhotoDeleteConfirm &&
                            !reframePreview &&
                            isLegacyPreV4Photo && (
                                <div className="mt-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] flex flex-col gap-[8px] rounded-none shadow-none select-none">
                                    <span className="text-[10px] font-mono leading-tight text-[#475569] dark:text-[#8A93A6] tabular-nums">
                                        {t('vault_sidebar.legacy_photo_audit_notice')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleStartOfficialPhotoHunt}
                                        disabled={
                                            isHuntingPhoto || isReframingPhoto || isUploadingPhoto
                                        }
                                        className="w-full py-1 px-[8px] border border-[#C68346] bg-[#C68346]/10 hover:bg-[#C68346] text-[#C68346] hover:text-[#000000] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                                    >
                                        {t('vault_sidebar.btn_replace_with_oem_photo')}
                                    </button>
                                </div>
                            )}

                        {canCurateAI && showPhotoDeleteConfirm && (
                            <div className="flex flex-col gap-[8px] w-full mt-[8px]">
                                <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('vault_sidebar.prompt_type_actualizar_delete')}
                                    </span>
                                    <input
                                        type="text"
                                        value={photoDeleteConfirmText}
                                        onChange={(e) =>
                                            setPhotoDeleteConfirmText(e.target.value.toUpperCase())
                                        }
                                        placeholder="ACTUALIZAR"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full px-[8px] py-1 text-[11px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                                    />
                                    <div className="flex gap-[8px]">
                                        <button
                                            type="button"
                                            onClick={handlePhotoDelete}
                                            disabled={
                                                isUploadingPhoto ||
                                                photoDeleteConfirmText.trim().toUpperCase() !==
                                                    'ACTUALIZAR'
                                            }
                                            className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            {t('vault_sidebar.btn_confirm')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowPhotoDeleteConfirm(false);
                                                setPhotoDeleteConfirmText('');
                                            }}
                                            className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                        >
                                            {t('vault_sidebar.btn_cancel')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {canCurateAI && (
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handlePhotoFileSelected}
                        accept="image/*"
                        autoComplete="off"
                        spellCheck={false}
                        className="hidden"
                        disabled={isUploadingPhoto || isHuntingPhoto || isReframingPhoto}
                    />
                )}
            </div>

            <div className="flex flex-col px-[13px] py-[21px] gap-[21px]">
                {/* A-04 Panel Comparativo HITL [Actual] -> [Sugerido] para Reconciliación de Ficha Lateral */}
                {canCurateAI && reconcilePreview && (
                    <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none shadow-none">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#00AEEF]">
                            {t('vault_sidebar.reconcile_hitl_title')}
                        </span>

                        {(
                            [
                                {
                                    key: 'caracteristicas' as const,
                                    label: t('vault_sidebar.section_main_specs'),
                                    current:
                                        reconcilePreview.currentProfile.caracteristicas_principales,
                                    proposed:
                                        reconcilePreview.proposedProfile
                                            .caracteristicas_principales,
                                },
                                {
                                    key: 'ambiente' as const,
                                    label: t('vault_sidebar.section_design_conditions'),
                                    current: reconcilePreview.currentProfile.ambiente_operativo,
                                    proposed: reconcilePreview.proposedProfile.ambiente_operativo,
                                },
                                {
                                    key: 'contexto' as const,
                                    label: t('vault_sidebar.section_work_context'),
                                    current: reconcilePreview.currentProfile.contexto_operativo,
                                    proposed: reconcilePreview.proposedProfile.contexto_operativo,
                                },
                            ] as const
                        ).map((sec) => (
                            <div
                                key={sec.key}
                                className="flex flex-col gap-[4px] p-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none"
                            >
                                <label className="flex items-center gap-[8px] cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={reconcileApproveFields[sec.key]}
                                        onChange={(e) =>
                                            setReconcileApproveFields((prev) => ({
                                                ...prev,
                                                [sec.key]: e.target.checked,
                                            }))
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="rounded-none accent-[#C68346] cursor-pointer"
                                    />
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                        {sec.label}
                                    </span>
                                </label>
                                <div className="flex flex-col gap-[4px] pt-[4px] border-t border-[#E2E8F0] dark:border-[#12151C]">
                                    <span className="text-[8px] font-mono font-bold uppercase text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('vault_sidebar.hitl_label_current')}
                                    </span>
                                    {renderHitlListPreview(sec.current)}
                                    <span className="text-[8px] font-mono font-bold uppercase text-[#00AEEF] mt-[4px]">
                                        {'->'} {t('vault_sidebar.hitl_label_proposed')}
                                    </span>
                                    {renderHitlListPreview(sec.proposed)}
                                </div>
                            </div>
                        ))}

                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('vault_sidebar.prompt_type_actualizar_consolidate')}
                        </span>
                        <input
                            type="text"
                            value={reconcileConfirmText}
                            onChange={(e) => setReconcileConfirmText(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                                if (
                                    e.key === 'Enter' &&
                                    !isConsolidatingReconcile &&
                                    reconcileConfirmText.trim().toUpperCase() === 'ACTUALIZAR'
                                ) {
                                    e.preventDefault();
                                    void handleConfirmReconcileHitl();
                                }
                            }}
                            placeholder="ACTUALIZAR"
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full px-[8px] py-1 text-[11px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                        />
                        <div className="flex gap-[8px]">
                            <button
                                type="button"
                                onClick={handleConfirmReconcileHitl}
                                disabled={
                                    isConsolidatingReconcile ||
                                    reconcileConfirmText.trim().toUpperCase() !== 'ACTUALIZAR' ||
                                    (!reconcileApproveFields.caracteristicas &&
                                        !reconcileApproveFields.ambiente &&
                                        !reconcileApproveFields.contexto)
                                }
                                className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                            >
                                {t('vault_sidebar.btn_confirm')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setReconcilePreview(null);
                                    setReconcileConfirmText('');
                                }}
                                disabled={isConsolidatingReconcile}
                                className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                            >
                                {t('vault_sidebar.btn_cancel')}
                            </button>
                        </div>
                    </div>
                )}

                {/* CARACTERÍSTICAS PRINCIPALES */}
                <div className="flex flex-col">
                    <div className="flex items-center justify-between mb-[8px]">
                        <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider">
                            {t('vault_sidebar.section_main_specs')}
                        </h3>
                        {canCurateAI && !catalog.is_sealed && (
                            <div className="flex items-center gap-[2px]">
                                <button
                                    type="button"
                                    onClick={handleReconcileSidebarProfile}
                                    disabled={isReconcilingSidebar || isConsolidatingReconcile}
                                    title={t('vault_sidebar.aria_reconcile_sidebar')}
                                    aria-label={t('vault_sidebar.aria_reconcile_sidebar')}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#00AEEF] dark:hover:text-[#00AEEF] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                >
                                    <span className="material-symbols-outlined !text-[14px]">
                                        sync
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleOpenSidebarEditor('caracteristicas')}
                                    title={t('vault_sidebar.aria_edit_main_specs')}
                                    aria-label={t('vault_sidebar.aria_edit_main_specs')}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center"
                                >
                                    <span className="material-symbols-outlined !text-[14px]">
                                        edit
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                    {editingSidebarSection === 'caracteristicas' ? (
                        <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none">
                            <textarea
                                rows={6}
                                value={sidebarDraftText}
                                onChange={(e) => setSidebarDraftText(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('vault_sidebar.placeholder_main_specs')}
                                className="w-full p-[8px] text-[11px] font-mono bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <input
                                type="text"
                                value={sidebarConfirmText}
                                onChange={(e) =>
                                    setSidebarConfirmText(e.target.value.toUpperCase())
                                }
                                placeholder="ACTUALIZAR"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full px-[8px] py-1 text-[10px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <div className="flex gap-[8px]">
                                <button
                                    type="button"
                                    onClick={handleSaveSidebarSectionHitl}
                                    disabled={
                                        isSavingSidebarHitl ||
                                        sidebarConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
                                    }
                                    className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_save')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSidebarSection(null)}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6] tabular-nums">
                            {normalizedMainSpecs.length ? (
                                normalizedMainSpecs.map((item, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-start gap-[8px] leading-tight"
                                    >
                                        <span className="text-[#C68346] shrink-0 mt-px text-[10px]">
                                            •
                                        </span>
                                        <span>{highlightUndeclared(item)}</span>
                                    </li>
                                ))
                            ) : (
                                <li>
                                    <mark className={PENDING_CONTENT_HIGHLIGHT_CLASS}>
                                        {t('opermaq_domains.not_declared')}
                                    </mark>
                                </li>
                            )}
                        </ul>
                    )}
                </div>

                {/* CONDICIONES DE DISEÑO */}
                <div className="flex flex-col">
                    <div className="flex items-center justify-between mb-[8px]">
                        <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider">
                            {t('vault_sidebar.section_design_conditions')}
                        </h3>
                        {canCurateAI && !catalog.is_sealed && (
                            <button
                                type="button"
                                onClick={() => handleOpenSidebarEditor('ambiente')}
                                title={t('vault_sidebar.aria_edit_design_conditions')}
                                aria-label={t('vault_sidebar.aria_edit_design_conditions')}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center"
                            >
                                <span className="material-symbols-outlined !text-[14px]">edit</span>
                            </button>
                        )}
                    </div>
                    {editingSidebarSection === 'ambiente' ? (
                        <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none">
                            <textarea
                                rows={5}
                                value={sidebarDraftText}
                                onChange={(e) => setSidebarDraftText(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('vault_sidebar.placeholder_design_conditions')}
                                className="w-full p-[8px] text-[11px] font-mono bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <input
                                type="text"
                                value={sidebarConfirmText}
                                onChange={(e) =>
                                    setSidebarConfirmText(e.target.value.toUpperCase())
                                }
                                placeholder="ACTUALIZAR"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full px-[8px] py-1 text-[10px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <div className="flex gap-[8px]">
                                <button
                                    type="button"
                                    onClick={handleSaveSidebarSectionHitl}
                                    disabled={
                                        isSavingSidebarHitl ||
                                        sidebarConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
                                    }
                                    className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_save')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSidebarSection(null)}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                            {normalizedDesignConditions.length ? (
                                normalizedDesignConditions.map((item, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-start gap-[8px] leading-tight"
                                    >
                                        <span className="text-[#C68346] shrink-0 mt-px text-[10px]">
                                            •
                                        </span>
                                        <span>{highlightUndeclared(item)}</span>
                                    </li>
                                ))
                            ) : (
                                <li>
                                    <mark className={PENDING_CONTENT_HIGHLIGHT_CLASS}>
                                        {t('opermaq_domains.not_declared')}
                                    </mark>
                                </li>
                            )}
                        </ul>
                    )}
                </div>

                {/* CONTEXTO Y TRABAJO */}
                <div className="flex flex-col">
                    <div className="flex items-center justify-between mb-[8px]">
                        <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider">
                            {t('vault_sidebar.section_work_context')}
                        </h3>
                        {canCurateAI && !catalog.is_sealed && (
                            <button
                                type="button"
                                onClick={() => handleOpenSidebarEditor('contexto')}
                                title={t('vault_sidebar.aria_edit_work_context')}
                                aria-label={t('vault_sidebar.aria_edit_work_context')}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center"
                            >
                                <span className="material-symbols-outlined !text-[14px]">edit</span>
                            </button>
                        )}
                    </div>
                    {editingSidebarSection === 'contexto' ? (
                        <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none">
                            <textarea
                                rows={5}
                                value={sidebarDraftText}
                                onChange={(e) => setSidebarDraftText(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('vault_sidebar.placeholder_work_context')}
                                className="w-full p-[8px] text-[11px] font-mono bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <input
                                type="text"
                                value={sidebarConfirmText}
                                onChange={(e) =>
                                    setSidebarConfirmText(e.target.value.toUpperCase())
                                }
                                placeholder="ACTUALIZAR"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full px-[8px] py-1 text-[10px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                            />
                            <div className="flex gap-[8px]">
                                <button
                                    type="button"
                                    onClick={handleSaveSidebarSectionHitl}
                                    disabled={
                                        isSavingSidebarHitl ||
                                        sidebarConfirmText.trim().toUpperCase() !== 'ACTUALIZAR'
                                    }
                                    className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_save')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSidebarSection(null)}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    {t('vault_sidebar.btn_cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                            {normalizedWorkContext.length ? (
                                normalizedWorkContext.map((item, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-start gap-[8px] leading-tight"
                                    >
                                        <span className="text-[#C68346] shrink-0 mt-px text-[10px]">
                                            •
                                        </span>
                                        <span>{highlightUndeclared(item)}</span>
                                    </li>
                                ))
                            ) : (
                                <li>
                                    <mark className={PENDING_CONTENT_HIGHLIGHT_CLASS}>
                                        {t('opermaq_domains.not_declared')}
                                    </mark>
                                </li>
                            )}
                        </ul>
                    )}
                </div>
            </div>
        </aside>
    );
};
