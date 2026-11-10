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
import { PENDING_CONTENT_HIGHLIGHT_CLASS } from '../utils/pendingContentDetector';
import { M3CircularProgress } from './M3ProgressIndicator';

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
}

export interface FotoMediaTelemetry {
    original_bytes: number;
    optimized_bytes: number;
    savings_pct: number;
    sha256?: string;
    updated_at?: string;
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
    foto_media_telemetry?: FotoMediaTelemetry;
    official_photo_candidates?: OfficialPhotoCandidate[];
    caracteristicas_principales?: string[];
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    energy_consumption_profile?: EnergyConsumptionProfile;
}

export interface VaultCatalogSidebarProps {
    catalog: {
        id: string;
        makeModel: string;
        is_sealed?: boolean;
        foto_url?: string;
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

    const [editingSidebarSection, setEditingSidebarSection] = useState<
        'caracteristicas' | 'ambiente' | 'contexto' | null
    >(null);
    const [sidebarDraftText, setSidebarDraftText] = useState('');
    const [sidebarConfirmText, setSidebarConfirmText] = useState('');
    const [isReconcilingSidebar, setIsReconcilingSidebar] = useState(false);
    const [isSavingSidebarHitl, setIsSavingSidebarHitl] = useState(false);

    useEffect(() => {
        photoHuntAttemptRef.current = 0;
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

    const handleOpenStoredAlternatives = useCallback(() => {
        const storedPool = catalog.official_photo_candidates || [];
        if (storedPool.length === 0) return;
        setPhotoCandidates(storedPool);
        setSelectedCandidateIdx(0);
        setManualAuditRejection(null);
        setIsManualFallbackActive(false);
        setShowPhotoDeleteConfirm(false);
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

        const previousPool: OfficialPhotoCandidate[] =
            photoCandidates.length > 0
                ? photoCandidates
                : catalog.official_photo_candidates || [];
        const previousShas = new Set(previousPool.map((c) => c.sha256));

        setIsHuntingPhoto(true);
        setManualAuditRejection(null);
        setShowPhotoDeleteConfirm(false);

        const toastId = toast.loading(
            currentAttempt > 0
                ? `Actualizando búsqueda IA de fotografía oficial OEM (intento #${currentAttempt + 1})...`
                : 'Cazando fotografía oficial OEM en bóveda y fuentes oficiales...'
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
                    data?.error || data?.message || 'Error al cazar fotografía oficial'
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
                    render: `${mergedCandidates.length} alternativa(s) de fotografía oficial OEM disponible(s) para elegir`,
                    type: 'success',
                    isLoading: false,
                    autoClose: 3000,
                });
            } else {
                setPhotoCandidates([]);
                setIsManualFallbackActive(true);
                toast.update(toastId, {
                    render: 'Sin fotografías oficiales en este barrido. Puede actualizar búsqueda IA o cargar archivo manual.',
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
                render:
                    err?.message ||
                    'Error en caza de fotos. Puede reintentar búsqueda IA o cargar manual.',
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
        const toastId = toast.loading('Publicando fotografía oficial en bóveda CAS...');
        try {
            const fotoMediaTelemetry: FotoMediaTelemetry = {
                original_bytes: candidate.original_bytes,
                optimized_bytes: candidate.optimized_bytes,
                savings_pct: candidate.savings_pct,
                sha256: candidate.sha256,
                updated_at: new Date().toISOString(),
            };

            const res = await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    tenantAssetId: assetId !== catalogId ? assetId : undefined,
                    imageUrl: candidate.preview_url,
                    fotoMediaTelemetry,
                    officialPhotoCandidates: photoCandidates,
                }),
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson?.error || 'Error persistiendo fotografía oficial en bóveda');
            }

            onCatalogPatch({
                foto_url: candidate.preview_url,
                foto_media_telemetry: fotoMediaTelemetry,
                official_photo_candidates: photoCandidates,
            });

            setPhotoCandidates([]);
            setSelectedCandidateIdx(0);
            setCandidateConfirmText('');
            setIsManualFallbackActive(false);

            toast.update(toastId, {
                render: `Fotografía oficial OEM aprobada y publicada (-${candidate.savings_pct}%)`,
                type: 'success',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || 'Error al publicar fotografía oficial',
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
    ]);

    const handleDiscardCandidates = useCallback(() => {
        setPhotoCandidates([]);
        setSelectedCandidateIdx(0);
        setCandidateConfirmText('');
        setIsManualFallbackActive(true);
        toast.info('Panel de revisión cerrado. Las candidatas verificadas permanecen disponibles.');
    }, []);

    const processManualPhotoUpload = useCallback(
        async (file: File) => {
            if (!canCurateAI || !catalogId || !file) return;
            if (!file.type.startsWith('image/')) {
                toast.error('Seleccione un archivo de imagen válido.');
                return;
            }

            setIsUploadingPhoto(true);
            setManualAuditRejection(null);
            const toastId = toast.loading('Auditando encuadre y autenticidad OEM con VLM...');

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
                    const basePool =
                        photoCandidates.length > 0
                            ? photoCandidates
                            : catalog.official_photo_candidates || [];
                    const updatedPool = [
                        data.candidate,
                        ...basePool.filter((c) => c.sha256 !== data.candidate.sha256),
                    ];
                    setPhotoCandidates(updatedPool);
                    setSelectedCandidateIdx(0);
                    onCatalogPatch({ official_photo_candidates: updatedPool });
                    setIsManualFallbackActive(false);
                    toast.update(toastId, {
                        render: 'Fotografía aprobada por el auditor OEM. Escriba ACTUALIZAR para publicar.',
                        type: 'success',
                        isLoading: false,
                        autoClose: 3500,
                    });
                } else {
                    const reasons =
                        Array.isArray(data?.rejection_reasons) && data.rejection_reasons.length > 0
                            ? data.rejection_reasons.join('. ')
                            : 'La fotografía no cumple el estándar oficial OEM.';
                    setManualAuditRejection(reasons);
                    toast.update(toastId, {
                        render: 'Fotografía rechazada por no ser oficial de la marca.',
                        type: 'warning',
                        isLoading: false,
                        autoClose: 4000,
                    });
                }
            } catch (err: any) {
                toast.update(toastId, {
                    render: err?.message || 'Error al procesar y auditar la fotografía.',
                    type: 'error',
                    isLoading: false,
                    autoClose: 3000,
                });
            } finally {
                setIsUploadingPhoto(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        },
        [canCurateAI, catalogId, photoCandidates, catalog.official_photo_candidates, onCatalogPatch]
    );

    const handlePhotoFileSelected = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!canCurateAI || !file || !catalogId) return;
            await processManualPhotoUpload(file);
        },
        [canCurateAI, catalogId, processManualPhotoUpload]
    );

    const handleReframeCurrentPhoto = useCallback(async () => {
        if (!canCurateAI || !catalogId || !catalog.foto_url || isReframingPhoto) return;
        setIsReframingPhoto(true);
        const toastId = toast.loading(
            'Re-encuadrando fotografía oficial al 88% sobre lienzo 4:3...'
        );
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/reframe-official-photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ globalAssetId: catalogId }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success && data?.foto_url) {
                onCatalogPatch({
                    foto_url: data.foto_url,
                    foto_media_telemetry:
                        data.foto_media_telemetry || catalog.foto_media_telemetry,
                });
                toast.update(toastId, {
                    render: 'Fotografía oficial re-encuadrada al 88% en estudio 4:3',
                    type: 'success',
                    isLoading: false,
                    autoClose: 3000,
                });
            } else {
                throw new Error(data?.error || 'Fallo en re-encuadre de servidor');
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
                const saveRes = await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        globalAssetId: catalogId,
                        tenantAssetId: assetId !== catalogId ? assetId : undefined,
                        imageUrl: descriptor.downloadUrl,
                        fotoMediaTelemetry: telemetry,
                    }),
                });
                if (!saveRes.ok) {
                    throw new Error('No se pudo persistir el re-encuadre en bóveda.');
                }
                onCatalogPatch({
                    foto_url: descriptor.downloadUrl,
                    foto_media_telemetry: telemetry,
                });
                toast.update(toastId, {
                    render: 'Fotografía re-encuadrada al 88% mediante motor óptico cliente',
                    type: 'success',
                    isLoading: false,
                    autoClose: 3000,
                });
            } catch (clientErr: any) {
                toast.update(toastId, {
                    render: clientErr?.message || 'Error al re-encuadrar fotografía',
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
        assetId,
        onCatalogPatch,
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
        const toastId = toast.loading('Limpiando referencia fotográfica...');

        try {
            const delRes = await authFetch(`${API_BASE_URL}/vault/asset-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId: catalogId,
                    tenantAssetId: assetId !== catalogId ? assetId : undefined,
                    imageUrl: null,
                    fotoMediaTelemetry: null,
                }),
            });

            if (!delRes.ok) {
                const errJson = await delRes.json().catch(() => ({}));
                throw new Error(errJson?.error || 'Error al eliminar referencia fotográfica');
            }

            onCatalogPatch({
                foto_url: '',
                foto_media_telemetry: undefined,
            });

            setShowPhotoDeleteConfirm(false);
            setPhotoDeleteConfirmText('');
            setPhotoCandidates([]);
            setIsManualFallbackActive(false);

            toast.update(toastId, {
                render: 'Referencia fotográfica eliminada',
                type: 'success',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || 'Error al eliminar la referencia fotográfica',
                type: 'error',
                isLoading: false,
                autoClose: 3000,
            });
        } finally {
            setIsUploadingPhoto(false);
        }
    }, [canCurateAI, catalogId, assetId, photoDeleteConfirmText, onCatalogPatch]);

    const handleReconcileSidebarProfile = useCallback(async () => {
        if (!canCurateAI || !catalogId || isReconcilingSidebar) return;
        setIsReconcilingSidebar(true);
        const toastId = toast.loading('Sincronizando ficha lateral con 01 · Ficha Técnica OEM...');
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/reconcile-sidebar-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ globalAssetId: catalogId }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || 'Error al sincronizar perfil lateral');
            }
            onCatalogPatch({
                caracteristicas_principales:
                    data.caracteristicas_principales || catalog.caracteristicas_principales,
                ambiente_operativo: data.ambiente_operativo || catalog.ambiente_operativo,
                contexto_operativo: data.contexto_operativo || catalog.contexto_operativo,
                energy_consumption_profile:
                    data.energy_consumption_profile || catalog.energy_consumption_profile,
            });
            if (onRefreshVault) void onRefreshVault();
            toast.update(toastId, {
                render: 'Ficha lateral sincronizada con parámetros OEM verificados',
                type: 'success',
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            toast.update(toastId, {
                render: err?.message || 'Error sincronizando perfil lateral',
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
        onCatalogPatch,
        onRefreshVault,
    ]);

    const handleOpenSidebarEditor = useCallback(
        (section: 'caracteristicas' | 'ambiente' | 'contexto') => {
            const currentItems =
                section === 'caracteristicas'
                    ? catalog.caracteristicas_principales || []
                    : section === 'ambiente'
                    ? catalog.ambiente_operativo || []
                    : catalog.contexto_operativo || [];
            setEditingSidebarSection((prev) => (prev === section ? null : section));
            setSidebarDraftText(currentItems.filter((x) => !x.startsWith('[')).join('\n'));
            setSidebarConfirmText('');
        },
        [
            catalog.caracteristicas_principales,
            catalog.ambiente_operativo,
            catalog.contexto_operativo,
        ]
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
            lines.length > 0 ? lines : ['[Información técnica no declarada en ficha]'];

        const payload: Record<string, any> = {
            globalAssetId: catalogId,
            confirmationKeyword: 'ACTUALIZAR',
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
                throw new Error(data?.error || 'Error guardando actualización HITL');
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
            toast.success('Registro lateral actualizado y auditado');
        } catch (err: any) {
            toast.error(err?.message || 'Error guardando sección lateral');
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
                toast.info('Haga clic en CAZAR FOTO OFICIAL para búsqueda asistida por IA.');
                return;
            }

            await processManualPhotoUpload(file);
        },
        [canCurateAI, catalogId, isManualFallbackActive, catalog.foto_url, processManualPhotoUpload]
    );

    return (
        <aside className="no-print shrink-0 w-[260px] flex flex-col border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] overflow-y-auto hide-scrollbar">
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
                        <div className="w-full h-full flex flex-col items-center justify-center gap-[8px] p-2 bg-[#F8FAFC] dark:bg-[#000000]">
                            <M3CircularProgress
                                size={24}
                                strokeWidth={3}
                                indeterminate
                                tone="copper"
                                ariaLabel={
                                    isHuntingPhoto
                                        ? t(
                                              'vault_dashboard.hunting_official_photo',
                                              'Cazando fotografía oficial OEM…'
                                          )
                                        : isReframingPhoto
                                        ? t('vault_dashboard.reframe_88', 'ENCUADRAR 88%')
                                        : 'Auditando fotografía'
                                }
                            />
                            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] text-center">
                                {isHuntingPhoto
                                    ? 'BUSCANDO FOTO OFICIAL OEM…'
                                    : isReframingPhoto
                                    ? 'ENCUADRANDO 88% STUDIO…'
                                    : 'AUDITANDO VLM…'}
                            </span>
                        </div>
                    ) : photoCandidates.length > 0 ? (
                        <div className="relative w-full h-full bg-[#FFFFFF] flex items-center justify-center">
                            <img
                                src={photoCandidates[selectedCandidateIdx]?.preview_url}
                                alt={`Candidata OEM ${selectedCandidateIdx + 1}`}
                                draggable={false}
                                onContextMenu={(e) => e.preventDefault()}
                                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                className="w-full h-full object-contain select-none pointer-events-none"
                            />
                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-[#000000]/80 text-[8px] font-mono font-bold text-[#00AEEF] uppercase tracking-wider tabular-nums select-none pointer-events-none">
                                {photoCandidates[selectedCandidateIdx]?.framing_mode === 'STUDIO_88'
                                    ? 'OEM · 88% STUDIO'
                                    : 'OEM · 4:3'}
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
                            <span className="text-[9px] font-bold uppercase tracking-widest text-center px-2">
                                {isManualFallbackActive
                                    ? 'SIN CANDIDATAS · CLIC PARA ACTUALIZAR BÚSQUEDA IA'
                                    : t('vault_dashboard.hunt_official_photo', 'CAZAR FOTO OFICIAL')}
                            </span>
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center p-[13px] text-center">
                            <span className="text-[11px] text-[#94A3B8] dark:text-[#5A6072]">
                                [Información técnica no declarada en ficha]
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
                                className="flex-1 py-1.5 px-2 border border-[#C68346] bg-[#C68346]/10 hover:bg-[#C68346] text-[#C68346] hover:text-[#000000] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {isHuntingPhoto
                                    ? 'ACTUALIZAR AHORA'
                                    : isManualFallbackActive
                                    ? 'ACTUALIZAR BÚSQUEDA IA'
                                    : 'CAZAR FOTO IA'}
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isHuntingPhoto || isUploadingPhoto || isReframingPhoto}
                                className="py-1.5 px-2 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                CARGAR MANUAL
                            </button>
                        </div>
                        {(catalog.official_photo_candidates?.length || 0) > 0 && (
                            <button
                                type="button"
                                onClick={handleOpenStoredAlternatives}
                                disabled={isHuntingPhoto || isUploadingPhoto || isReframingPhoto}
                                className="w-full py-1 px-2 border border-[#00AEEF] text-[#00AEEF] hover:bg-[#00AEEF] hover:text-[#000000] text-[9px] font-mono font-bold uppercase tracking-wider tabular-nums rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                VER ALTERNATIVAS GUARDADAS (
                                {catalog.official_photo_candidates!.length})
                            </button>
                        )}
                    </div>
                )}

                {photoCandidates.length > 0 && (
                    <div className="flex flex-col gap-[8px] w-full mt-[8px]">
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
                                aria-label="Candidata anterior"
                                className="bg-transparent border-0 outline-none p-0 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <span className="material-symbols-outlined !text-[16px]">
                                    chevron_left
                                </span>
                            </button>
                            <span className="text-[#475569] dark:text-[#8A93A6] font-bold tracking-wider">
                                CANDIDATA {selectedCandidateIdx + 1} / {photoCandidates.length}
                            </span>
                            <button
                                type="button"
                                onClick={() =>
                                    setSelectedCandidateIdx(
                                        (prev) => (prev + 1) % photoCandidates.length
                                    )
                                }
                                disabled={photoCandidates.length <= 1}
                                aria-label="Candidata siguiente"
                                className="bg-transparent border-0 outline-none p-0 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
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
                                            title={`Alternativa #${idx + 1} (${cand.source_label})`}
                                            className={`relative aspect-[4/3] w-full bg-[#FFFFFF] border rounded-none shadow-none overflow-hidden cursor-pointer transition-colors p-0 ${
                                                isSelected
                                                    ? 'border-2 border-[#C68346]'
                                                    : 'border-[#E2E8F0] dark:border-[#12151C] opacity-75 hover:opacity-100 hover:border-[#00AEEF]'
                                            }`}
                                        >
                                            <img
                                                src={cand.preview_url}
                                                alt={`Alternativa ${idx + 1}`}
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
                                                    ACT
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
                                {isHuntingPhoto ? 'ACTUALIZANDO…' : 'ACTUALIZAR BÚSQUEDA IA'}
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isPublishingCandidate}
                                className="px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                            >
                                MANUAL
                            </button>
                        </div>

                        <div className="px-[8px] py-1 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between gap-[8px] font-mono tabular-nums text-[9px] rounded-none">
                            <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                ORIG:{' '}
                                {formatPhotoBytes(
                                    photoCandidates[selectedCandidateIdx]?.original_bytes
                                )}{' '}
                                ➔ CAS:{' '}
                                {formatPhotoBytes(
                                    photoCandidates[selectedCandidateIdx]?.optimized_bytes
                                )}
                            </span>
                            <span className="font-bold text-[#00AEEF] shrink-0">
                                -{photoCandidates[selectedCandidateIdx]?.savings_pct}%
                            </span>
                        </div>

                        <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                Escriba ACTUALIZAR para publicar:
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
                                    CONFIRMAR
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDiscardCandidates}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    CERRAR
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {photoCandidates.length === 0 && manualAuditRejection && (
                    <div className="mt-[8px] p-[8px] border border-[#C68346] bg-[#C68346]/10 flex flex-col gap-[8px] rounded-none">
                        <div className="flex items-center gap-[8px] text-[#C68346] text-[9px] font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined !text-[14px]">warning</span>
                            <span>Rechazo Auditor OEM</span>
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
                                        ➔{' '}
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
                                <span className="font-mono text-[9px] text-[#5A6072] dark:text-[#94A3B8]">
                                    CAS
                                </span>
                            )}

                            {canCurateAI && (
                                <div className="flex items-center gap-[2px] shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleStartOfficialPhotoHunt}
                                        disabled={
                                            isHuntingPhoto || isReframingPhoto || isUploadingPhoto
                                        }
                                        title="Buscar fotografía oficial OEM con IA"
                                        aria-label="Buscar fotografía oficial OEM con IA"
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#C68346] dark:hover:text-[#C68346] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                    >
                                        <span className="material-symbols-outlined !text-[15px]">
                                            travel_explore
                                        </span>
                                    </button>

                                    {(catalog.official_photo_candidates?.length || 0) > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleOpenStoredAlternatives}
                                            disabled={
                                                isHuntingPhoto ||
                                                isReframingPhoto ||
                                                isUploadingPhoto
                                            }
                                            title={`Alternativas verificadas (${catalog.official_photo_candidates!.length})`}
                                            aria-label={`Alternativas verificadas (${catalog.official_photo_candidates!.length})`}
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
                                            isHuntingPhoto || isReframingPhoto || isUploadingPhoto
                                        }
                                        title={t(
                                            'vault_dashboard.reframe_88',
                                            'Encuadrar al 88% Studio 4:3'
                                        )}
                                        aria-label={t(
                                            'vault_dashboard.reframe_88',
                                            'Encuadrar al 88% Studio 4:3'
                                        )}
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
                                            isHuntingPhoto || isReframingPhoto || isUploadingPhoto
                                        }
                                        title="Subir fotografía oficial manualmente"
                                        aria-label="Subir fotografía oficial manualmente"
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
                                        }}
                                        disabled={
                                            isHuntingPhoto || isReframingPhoto || isUploadingPhoto
                                        }
                                        title="Dar de baja fotografía"
                                        aria-label="Dar de baja fotografía"
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#C68346] dark:hover:text-[#C68346] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                    >
                                        <span className="material-symbols-outlined !text-[15px]">
                                            delete
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {canCurateAI && showPhotoDeleteConfirm && (
                            <div className="flex flex-col gap-[8px] w-full mt-[8px]">
                                <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                        Escriba ACTUALIZAR para confirmar baja:
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
                                            CONFIRMAR
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowPhotoDeleteConfirm(false);
                                                setPhotoDeleteConfirmText('');
                                            }}
                                            className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                        >
                                            CANCELAR
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
                {/* CARACTERÍSTICAS PRINCIPALES */}
                <div className="flex flex-col">
                    <div className="flex items-center justify-between mb-[8px]">
                        <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider">
                            CARACTERÍSTICAS PRINCIPALES
                        </h3>
                        {canCurateAI && !catalog.is_sealed && (
                            <div className="flex items-center gap-[2px]">
                                <button
                                    type="button"
                                    onClick={handleReconcileSidebarProfile}
                                    disabled={isReconcilingSidebar}
                                    title="Sincronizar con 01 · Ficha Técnica OEM"
                                    aria-label="Sincronizar con 01 · Ficha Técnica OEM"
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#00AEEF] dark:hover:text-[#00AEEF] transition-colors cursor-pointer disabled:opacity-40 flex items-center"
                                >
                                    <span className="material-symbols-outlined !text-[14px]">
                                        sync
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleOpenSidebarEditor('caracteristicas')}
                                    title="Editar características principales (HITL)"
                                    aria-label="Editar características principales (HITL)"
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
                                placeholder="Una especificación por línea (ej. ROC: 1.678 kg)"
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
                                    GUARDAR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSidebarSection(null)}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    CANCELAR
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6] tabular-nums">
                            {catalog.caracteristicas_principales?.length ? (
                                catalog.caracteristicas_principales.map((item, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-start gap-1.5 leading-tight"
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
                                        [Información técnica no declarada en ficha]
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
                            CONDICIONES DE DISEÑO
                        </h3>
                        {canCurateAI && !catalog.is_sealed && (
                            <button
                                type="button"
                                onClick={() => handleOpenSidebarEditor('ambiente')}
                                title="Editar condiciones de diseño (HITL)"
                                aria-label="Editar condiciones de diseño (HITL)"
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
                                placeholder="Una condición de diseño por línea"
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
                                    GUARDAR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSidebarSection(null)}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    CANCELAR
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                            {catalog.ambiente_operativo?.length ? (
                                catalog.ambiente_operativo.map((item, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-start gap-1.5 leading-tight"
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
                                        [Información técnica no declarada en ficha]
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
                            CONTEXTO Y TRABAJO
                        </h3>
                        {canCurateAI && !catalog.is_sealed && (
                            <button
                                type="button"
                                onClick={() => handleOpenSidebarEditor('contexto')}
                                title="Editar contexto y trabajo (HITL)"
                                aria-label="Editar contexto y trabajo (HITL)"
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
                                placeholder="Una aplicación o contexto por línea"
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
                                    GUARDAR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSidebarSection(null)}
                                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                >
                                    CANCELAR
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                            {catalog.contexto_operativo?.length ? (
                                catalog.contexto_operativo.map((item, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-start gap-1.5 leading-tight"
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
                                        [Información técnica no declarada en ficha]
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

