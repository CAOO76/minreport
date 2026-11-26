import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import {
    syncQueueEngine,
    type GeolappSpatialSyncPayload,
} from '../../../core/offline/SyncQueueEngine';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import { dataService } from '../core/services/DataService';
import { storageService, type UploadResult } from '../core/services/StorageService';
import {
    getCachedSpatialDeviceCapability,
    useSpatialDeviceCapability,
} from '../core/services/spatialDeviceCapability';
import {
    SpatialScanRejectedError,
    analyzeSpatialScan,
    formatStockpileVolumeM3,
    persistCaptureSessionOffline,
    saveOfflineSpatialPayload,
    startNativeSpatialScan,
    type PairedSpatialKeyframe,
    type SpatialAnalyzeResult,
    type SpatialScanNativeResult,
} from '../core/services/spatialScannerService';
import type {
    DemGridV1,
    InSituMetrology,
    MeasurementLifecycleStatus,
    MetrologyGrade,
} from '../../../contracts/acopios.contracts';
import {
    useXCoverHardwareKey,
    XCOVER_HARDWARE_KEY_CODES,
} from '../core/hooks/useXCoverHardwareKey';
import { triggerFieldImpact, triggerFieldNotification } from '../core/utils/fieldHaptics';
import {
    COPPER_DOMAIN_OPTIONS,
    InlineStatusBanner,
    type InlineStatusMessage,
    dataUrlToBlob,
    mapCopperDomainToClase,
    sanitizeDecimalText,
} from '../core/utils/captureHelpers';
import type {
    CopperMineralDomain,
    GeolappAnalysisStatus,
    StockpileAsset,
} from '../core/types/GeolappTypes';

export interface MobileScannerProps {
    assetId?: string;
    assetName?: string;
    autoStartScan?: boolean;
    onDraftNameChange?: (nextName: string) => void;
    initialCopperDomain?: CopperMineralDomain | null;
    initialGranulometry?: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
    initialDensityFactor?: number | null;
    draftAsset?: {
        name: string;
        projectId?: string;
        projectName?: string;
        geoPoint?: StockpileAsset['geo_point'];
        gnssStatus?: 'FIX_OK' | 'UNDERGROUND_NO_FIX';
        undergroundSector?: string;
    };
    onSuccess: (measurementId: string, createdAssetId?: string) => void;
    onBack: () => void;
    hideHeader?: boolean;
}

type ScannerStage = 'READY' | 'ANALYZING' | 'RESULT' | 'REJECTED' | 'ERROR';

const GRANULOMETRY_DENSITY_TABLE: Record<'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS', number> = {
    COLPAS: 1.55,
    GRANSA: 1.65,
    MIXTO: 1.75,
    FINOS: 1.9,
};

function resolveEffectiveDensityFactor(params: {
    manualDensityText: string;
    aiDensityDismissed: boolean;
    isNonStockpile?: boolean;
    suggestedDensityTm3?: number | null;
    granulometry: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
}): { density: number | null; source: 'USER' | 'AI' | 'NONE' } {
    const raw = Number.parseFloat(params.manualDensityText.replace(',', '.'));
    if (Number.isFinite(raw) && raw > 0 && raw <= 8) {
        return { density: Number(raw.toFixed(3)), source: 'USER' };
    }
    if (params.isNonStockpile || params.aiDensityDismissed) {
        return { density: null, source: 'NONE' };
    }
    if (params.granulometry && GRANULOMETRY_DENSITY_TABLE[params.granulometry]) {
        return { density: GRANULOMETRY_DENSITY_TABLE[params.granulometry], source: 'AI' };
    }
    if (
        typeof params.suggestedDensityTm3 === 'number' &&
        Number.isFinite(params.suggestedDensityTm3) &&
        params.suggestedDensityTm3 > 0 &&
        params.suggestedDensityTm3 <= 8
    ) {
        return { density: Number(params.suggestedDensityTm3.toFixed(3)), source: 'AI' };
    }
    return { density: null, source: 'NONE' };
}

const XCOVER_ALLOWED_CODES = [
    XCOVER_HARDWARE_KEY_CODES.XCOVER_SIDE_KEY,
    XCOVER_HARDWARE_KEY_CODES.XCOVER_TOP_KEY,
    XCOVER_HARDWARE_KEY_CODES.F1,
    XCOVER_HARDWARE_KEY_CODES.CAMERA,
] as const;

const MAX_AUTO_THUMBS = 4;

function getActiveTenantId(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    return window.localStorage.getItem('minreport_active_account_id')?.trim() || undefined;
}

export const MobileScanner: React.FC<MobileScannerProps> = ({
    assetId,
    assetName,
    autoStartScan = false,
    onDraftNameChange,
    initialCopperDomain = null,
    initialGranulometry = null,
    initialDensityFactor = null,
    draftAsset,
    onSuccess,
    onBack,
    hideHeader = false,
}) => {
    const { t, i18n } = useTranslation();
    const { isOnline } = useNetworkStatus();
    const {
        capability,
        loading: capabilityLoading,
        requestInstall,
    } = useSpatialDeviceCapability();

    const effectiveCapability = capability ?? getCachedSpatialDeviceCapability();
    const isNewAssetMode = Boolean(!assetId && draftAsset);
    const isNativeRuntime = Capacitor.isNativePlatform();
    const isSpatialCapable = Boolean(
        isNativeRuntime &&
            (effectiveCapability?.tier === 'OPTIMAL_SPATIAL' ||
                effectiveCapability?.tier === 'COMPATIBLE_VIO')
    );

    const draftAssetRef = useRef(draftAsset);
    useEffect(() => {
        draftAssetRef.current = draftAsset;
    }, [draftAsset]);

    const [editableDraftName, setEditableDraftName] = useState<string>(
        () => draftAsset?.name?.trim() || assetName?.trim() || ''
    );
    const [isEditingDraftName, setIsEditingDraftName] = useState<boolean>(false);

    const displayStockpileName =
        (isNewAssetMode ? editableDraftName.trim() : '') ||
        assetName?.trim() ||
        draftAsset?.name?.trim() ||
        t('scanner.title', 'ACOPIO');

    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const latestUrlsRef = useRef<{ primary: string | null; extras: string[] }>({
        primary: null,
        extras: [],
    });

    const [stage, setStage] = useState<ScannerStage>('READY');
    const stageRef = useRef<ScannerStage>('READY');
    useEffect(() => {
        stageRef.current = stage;
    }, [stage]);
    const autoTriggeredRef = useRef<boolean>(false);

    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [extraPhotos, setExtraPhotos] = useState<Array<{ blob: Blob; previewUrl: string }>>([]);
    const [allKeyframeBlobs, setAllKeyframeBlobs] = useState<Blob[]>([]);
    const [pairedKeyframes, setPairedKeyframes] = useState<PairedSpatialKeyframe[]>([]);
    const [spatialScan, setSpatialScan] = useState<SpatialScanNativeResult | null>(null);
    const [inSituMetrology, setInSituMetrology] = useState<InSituMetrology | null>(null);
    const [localPreviewMesh, setLocalPreviewMesh] = useState<DemGridV1 | null>(null);
    const [spatialResult, setSpatialResult] = useState<SpatialAnalyzeResult | null>(null);
    const [offlinePendingSpatial, setOfflinePendingSpatial] = useState<boolean>(false);

    const [selectedCopperDomain, setSelectedCopperDomain] = useState<CopperMineralDomain | null>(
        initialCopperDomain ?? null
    );
    const [selectedGranulometry, setSelectedGranulometry] = useState<
        'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null
    >(initialGranulometry ?? null);
    const [manualDensityText, setManualDensityText] = useState<string>(
        typeof initialDensityFactor === 'number' &&
            Number.isFinite(initialDensityFactor) &&
            initialDensityFactor > 0
            ? String(initialDensityFactor)
            : ''
    );
    const [aiDensityDismissed, setAiDensityDismissed] = useState<boolean>(false);
    const [showSpecsPanel, setShowSpecsPanel] = useState<boolean>(false);

    const [isScanningSpatial, setIsScanningSpatial] = useState<boolean>(false);
    const scanningSpatialRef = useRef<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isRequestingArCore, setIsRequestingArCore] = useState<boolean>(false);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [rejectionMessage, setRejectionMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<InlineStatusMessage | null>(null);

    const resolvedLocale: 'es' | 'en' | 'pt' = useMemo(() => {
        const raw = (i18n.resolvedLanguage || i18n.language || 'es').slice(0, 2);
        return raw === 'en' || raw === 'pt' ? raw : 'es';
    }, [i18n.language, i18n.resolvedLanguage]);

    useEffect(() => {
        latestUrlsRef.current = {
            primary: photoPreview,
            extras: extraPhotos.map((item) => item.previewUrl),
        };
    }, [extraPhotos, photoPreview]);

    useEffect(() => {
        return () => {
            const { primary, extras } = latestUrlsRef.current;
            if (primary && primary.startsWith('blob:')) {
                URL.revokeObjectURL(primary);
            }
            extras.forEach((url) => {
                if (url.startsWith('blob:')) URL.revokeObjectURL(url);
            });
        };
    }, []);

    const clearCapturedMedia = useCallback(() => {
        setPhotoBlob(null);
        setPhotoPreview((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return null;
        });
        setExtraPhotos((prev) => {
            prev.forEach((p) => {
                if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
            });
            return [];
        });
        setAllKeyframeBlobs([]);
        setPairedKeyframes([]);
        setSpatialScan(null);
        setInSituMetrology(null);
        setLocalPreviewMesh(null);
        setSpatialResult(null);
        setOfflinePendingSpatial(false);
        setSelectedCopperDomain(initialCopperDomain ?? null);
        setSelectedGranulometry(initialGranulometry ?? null);
        setManualDensityText(
            typeof initialDensityFactor === 'number' &&
                Number.isFinite(initialDensityFactor) &&
                initialDensityFactor > 0
                ? String(initialDensityFactor)
                : ''
        );
        setAiDensityDismissed(false);
        setRejectionMessage(null);
        setErrorMessage(null);
        setStatusMessage(null);
        setStage('READY');
    }, [initialCopperDomain, initialDensityFactor, initialGranulometry]);

    const processPrimaryBlob = useCallback(async (rawBlob: Blob) => {
        const previewUrl = URL.createObjectURL(rawBlob);
        setPhotoBlob(rawBlob);
        setPhotoPreview((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return previewUrl;
        });
        setStatusMessage(null);
        void triggerFieldImpact('MEDIUM');
        void mediaDigestorClient.digestFile(rawBlob, 'IMAGE_FIELD_EVIDENCE').catch(() => null);
    }, []);

    const runSpatialAnalysis = useCallback(
        async (
            scan: SpatialScanNativeResult,
            primary: Blob | null,
            extras: Blob[]
        ) => {
            setRejectionMessage(null);
            setErrorMessage(null);
            setOfflinePendingSpatial(false);

            // Flujo V2 Offline-First: consumir metrología in-situ nativa inmediatamente (0 ms red)
            if (scan.inSituMetrology) {
                if (
                    scan.inSituMetrology.metrologyGrade === 'REJECTED' ||
                    !(scan.inSituMetrology.volumeM3 > 0)
                ) {
                    setInSituMetrology(null);
                    setLocalPreviewMesh(null);
                    setSpatialResult(null);
                    setRejectionMessage(
                        t(
                            'scanner.insitu_rejected',
                            'COBERTURA O VOLUMEN INSUFICIENTE. RODEAR EL ACOPIO Y REINTENTAR.'
                        )
                    );
                    setStage('REJECTED');
                    void triggerFieldNotification('ERROR');
                    return;
                }

                setInSituMetrology(scan.inSituMetrology);
                setLocalPreviewMesh(scan.localPreviewMesh ?? null);
                setSpatialResult(null);
                setOfflinePendingSpatial(true);
                setStage('RESULT');
                void triggerFieldNotification(
                    scan.inSituMetrology.slopeWarning ? 'WARNING' : 'SUCCESS'
                );
                return;
            }

            setStage('ANALYZING');

            if (!isOnline) {
                setSpatialResult(null);
                setRejectionMessage(
                    t(
                        'scanner.offline_requires_v2_metrology',
                        'SIN CONEXIÓN Y SIN CÁLCULO IN-SITU VÁLIDO. REPITA LA CAPTURA.'
                    )
                );
                setStage('REJECTED');
                void triggerFieldNotification('ERROR');
                return;
            }

            try {
                const activeTenantId = getActiveTenantId();
                const res = await analyzeSpatialScan({
                    stockpileId: undefined,
                    tenantId: activeTenantId,
                    scan,
                    primaryBlob: primary ?? undefined,
                    extraBlobs: extras,
                    locale: resolvedLocale,
                });
                setSpatialResult(res);
                setOfflinePendingSpatial(false);
                setAiDensityDismissed(false);
                if (!res.isNonStockpile && res.aiSuggestedGranulometry) {
                    setSelectedGranulometry((prev) => prev ?? res.aiSuggestedGranulometry ?? null);
                }
                setStage('RESULT');
                void triggerFieldNotification(res.slopeWarning ? 'WARNING' : 'SUCCESS');
            } catch (err: unknown) {
                if (err instanceof SpatialScanRejectedError) {
                    setSpatialResult(null);
                    setRejectionMessage(err.message);
                    setStage('REJECTED');
                    void triggerFieldNotification('ERROR');
                    return;
                }
                const msg = err instanceof Error ? err.message : String(err || '');
                setSpatialResult(null);
                setErrorMessage(msg || t('scanner.analyze_error', 'ERROR AL CALCULAR VOLUMEN'));
                setStage('ERROR');
                void triggerFieldNotification('ERROR');
            }
        },
        [isOnline, resolvedLocale, t]
    );

    const handleStartSpatialScan = useCallback(async () => {
        if (isSaving || isScanningSpatial || scanningSpatialRef.current || !isSpatialCapable) return;
        autoTriggeredRef.current = true;
        scanningSpatialRef.current = true;
        setIsScanningSpatial(true);
        setRejectionMessage(null);
        setErrorMessage(null);
        setStatusMessage(null);
        void triggerFieldImpact('MEDIUM');

        try {
            const { scan, photoBlobs, pairedKeyframes: nextPairedKeyframes } =
                await startNativeSpatialScan();
            if (scan.cancelled) {
                if (autoStartScan && stageRef.current === 'READY') {
                    onBack();
                }
                return;
            }
            setSpatialScan(scan);
            setAllKeyframeBlobs(photoBlobs);
            setPairedKeyframes(nextPairedKeyframes);

            const primary = photoBlobs.length > 0 ? photoBlobs[0] : null;
            const extraRawBlobs = photoBlobs.slice(1, MAX_AUTO_THUMBS);

            if (primary) {
                await processPrimaryBlob(primary);
            } else {
                setPhotoBlob(null);
                setPhotoPreview((prev) => {
                    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return null;
                });
            }

            const nextExtras = extraRawBlobs.map((blob) => ({
                blob,
                previewUrl: URL.createObjectURL(blob),
            }));
            setExtraPhotos((prev) => {
                prev.forEach((p) => {
                    if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
                });
                return nextExtras;
            });

            await runSpatialAnalysis(scan, primary, extraRawBlobs);
        } catch (err: unknown) {
            const errObj =
                err && typeof err === 'object'
                    ? (err as { code?: unknown; message?: unknown })
                    : null;
            const code = typeof errObj?.code === 'string' ? errObj.code.trim() : '';
            const rawMsg =
                err instanceof Error
                    ? err.message
                    : typeof errObj?.message === 'string'
                      ? errObj.message
                      : String(err || '');
            const displayMsg =
                code && rawMsg && !rawMsg.includes(code)
                    ? `${code}: ${rawMsg}`
                    : rawMsg || code || t('digital_v2.save_error', 'ERROR EN ESCÁNER');
            setErrorMessage(displayMsg);
            setStage('ERROR');
            void triggerFieldNotification('ERROR');
        } finally {
            scanningSpatialRef.current = false;
            setIsScanningSpatial(false);
        }
    }, [
        autoStartScan,
        isSaving,
        isScanningSpatial,
        isSpatialCapable,
        onBack,
        processPrimaryBlob,
        runSpatialAnalysis,
        t,
    ]);

    useEffect(() => {
        if (!autoStartScan) return;
        if (capabilityLoading && !effectiveCapability) return;
        if (!isSpatialCapable) return;
        if (stage !== 'READY') return;
        if (autoTriggeredRef.current) return;
        autoTriggeredRef.current = true;
        void handleStartSpatialScan();
    }, [
        autoStartScan,
        capabilityLoading,
        effectiveCapability,
        handleStartSpatialScan,
        isSpatialCapable,
        stage,
    ]);

    const handleCaptureSource = useCallback(
        async (source: 'CAMERA' | 'PHOTOS') => {
            if (isSaving || isScanningSpatial) return;
            void triggerFieldImpact('LIGHT');

            if (Capacitor.isNativePlatform()) {
                try {
                    const photo = await Camera.getPhoto({
                        quality: 88,
                        allowEditing: false,
                        resultType: CameraResultType.DataUrl,
                        source: source === 'CAMERA' ? CameraSource.Camera : CameraSource.Photos,
                        correctOrientation: true,
                    });
                    if (photo.dataUrl) {
                        const rawBlob = dataUrlToBlob(photo.dataUrl);
                        setSpatialScan(null);
                        setSpatialResult(null);
                        setOfflinePendingSpatial(false);
                        await processPrimaryBlob(rawBlob);
                        return;
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err || '');
                    if (/cancel/i.test(msg)) return;
                }
            }

            if (source === 'PHOTOS') {
                galleryInputRef.current?.click();
            } else {
                cameraInputRef.current?.click();
            }
        },
        [isSaving, isScanningSpatial, processPrimaryBlob]
    );

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setAllKeyframeBlobs([]);
        setPairedKeyframes([]);
        setSpatialScan(null);
        setInSituMetrology(null);
        setLocalPreviewMesh(null);
        setSpatialResult(null);
        setOfflinePendingSpatial(false);
        await processPrimaryBlob(file);
    };

    const handleRequestArCoreInstall = async () => {
        if (isRequestingArCore) return;
        setIsRequestingArCore(true);
        try {
            const res = await requestInstall();
            if (res.status === 'ERROR' && res.message) {
                setStatusMessage({ severity: 'warning', text: res.message });
            }
        } finally {
            setIsRequestingArCore(false);
        }
    };

    const hasInSituVolume = Boolean(
        inSituMetrology &&
            inSituMetrology.metrologyGrade !== 'REJECTED' &&
            Number.isFinite(inSituMetrology.volumeM3) &&
            inSituMetrology.volumeM3 > 0
    );

    const hasSpatialPoints = Boolean(
        spatialScan &&
            !spatialScan.cancelled &&
            (hasInSituVolume ||
                (Array.isArray(spatialScan.pointsM) && spatialScan.pointsM.length >= 20))
    );

    const handleSaveCapture = useCallback(async () => {
        if (isSaving || isScanningSpatial) return;
        if (!photoBlob && !hasSpatialPoints) {
            setErrorMessage(t('digital_v2.photo_required', 'CAPTURA REQUERIDA'));
            void triggerFieldNotification('ERROR');
            return;
        }

        const isSpatialFlow = Boolean(hasSpatialPoints && spatialScan);
        const hasValidVolume = Boolean(
            hasInSituVolume || (spatialResult?.verified && spatialResult.volumeM3 > 0)
        );
        if (!hasValidVolume) {
            setErrorMessage(
                t(
                    'scanner.valid_volume_required',
                    'SE REQUIERE VOLUMEN MÉTRICO VÁLIDO (> 0 m³) ANTES DE GUARDAR'
                )
            );
            void triggerFieldNotification('ERROR');
            return;
        }

        setIsSaving(true);
        setUploadProgress(15);
        setErrorMessage(null);
        setStatusMessage(null);

        try {
            const now = Date.now();
            const latestDraft = draftAssetRef.current;
            const targetAssetId = isNewAssetMode ? `asset_${now}` : assetId!;
            const activeTenantId = getActiveTenantId() || 'offline-local';
            const captureSessionId =
                spatialScan?.scanId?.trim() || `sess_${now}_${Math.random().toString(36).slice(2, 8)}`;

            let primaryUpload: UploadResult | null = null;
            if (photoBlob) {
                primaryUpload = await storageService.uploadStockpileImage(
                    photoBlob,
                    targetAssetId,
                    { filename: `capture_${now}.webp`, tenantId: activeTenantId },
                    (pct) => setUploadProgress(15 + Math.round(pct * 0.3))
                );
            }

            const extraUploads: Array<{ url: string; sha256?: string }> = [];
            for (let i = 0; i < extraPhotos.length; i++) {
                const extraRes = await storageService.uploadStockpileImage(
                    extraPhotos[i].blob,
                    targetAssetId,
                    { filename: `angle_${i + 1}_${now}.webp`, tenantId: activeTenantId }
                );
                extraUploads.push({ url: extraRes.url, sha256: extraRes.sha256 });
            }

            setUploadProgress(65);

            const hasCloudSpatial = Boolean(spatialResult?.verified && spatialResult.volumeM3 > 0);
            const finalVolumeM3 = hasCloudSpatial
                ? spatialResult!.volumeM3
                : inSituMetrology!.volumeM3;

            const lifecycleStatus: MeasurementLifecycleStatus = hasCloudSpatial
                ? 'CLOUD_3D_VERIFIED'
                : 'CAPTURED_OFFLINE_VALID';
            const metrologyGrade: MetrologyGrade =
                inSituMetrology?.metrologyGrade ?? 'VALID_IN_SITU';
            const reconciliationStatus: 'AUTO_CONCILIATED' | 'PENDING_CLOUD' = hasCloudSpatial
                ? 'AUTO_CONCILIATED'
                : 'PENDING_CLOUD';
            const analysisStatus: GeolappAnalysisStatus = 'AI_VERIFIED';

            const { density: resolvedDensity } = resolveEffectiveDensityFactor({
                manualDensityText,
                aiDensityDismissed,
                isNonStockpile: spatialResult?.isNonStockpile,
                suggestedDensityTm3: spatialResult?.suggestedDensityTm3,
                granulometry: selectedGranulometry,
            });
            const finalWeightT =
                finalVolumeM3 > 0 && resolvedDensity
                    ? Number((finalVolumeM3 * resolvedDensity).toFixed(2))
                    : 0;

            const safeGeo =
                latestDraft?.geoPoint &&
                Number.isFinite(latestDraft.geoPoint.latitude) &&
                Number.isFinite(latestDraft.geoPoint.longitude) &&
                (latestDraft.geoPoint.latitude !== 0 || latestDraft.geoPoint.longitude !== 0)
                    ? latestDraft.geoPoint
                    : undefined;

            const scaleAnchorType = 'ARCORE_VIO_DEPTH' as const;

            const resolvedGeometry = spatialResult?.dimensionsM
                ? {
                      type: spatialResult.geometryType,
                      dimensions: spatialResult.dimensionsM,
                  }
                : inSituMetrology
                  ? {
                        type: 'CONO_ELIPTICO' as const,
                        dimensions: {
                            a: Number(inSituMetrology.baseLengthM.toFixed(2)),
                            b: Number(inSituMetrology.baseWidthM.toFixed(2)),
                            h: Number(inSituMetrology.heightMaxM.toFixed(2)),
                        },
                    }
                  : undefined;

            const trainingGranulometry =
                spatialResult?.aiSuggestedGranulometry && selectedGranulometry
                    ? {
                          ai_granulometry_predicted: spatialResult.aiSuggestedGranulometry,
                          human_granulometry_validated: selectedGranulometry,
                          operator_overrode:
                              spatialResult.aiSuggestedGranulometry !== selectedGranulometry,
                      }
                    : undefined;

            const effUncertaintyPct =
                spatialResult?.uncertaintyPct ?? inSituMetrology?.uncertaintyPct ?? null;
            const effToeScore = spatialResult?.toeScore ?? inSituMetrology?.toeScore ?? null;
            const effCoveragePct =
                spatialResult?.coveragePct ??
                inSituMetrology?.coveragePct ??
                spatialScan?.coveragePct ??
                null;
            const effDepthMode =
                spatialResult?.depthMode ?? spatialScan?.depthMode ?? 'VIO_ORB_MVS';
            const effGroundSlopeDeg =
                spatialResult?.groundSlopeDeg ??
                inSituMetrology?.groundPlane?.slopeDeg ??
                inSituMetrology?.groundSlopeDeg ??
                null;
            const effSlopeAvg =
                spatialResult?.slopeAngleAvgDeg ?? inSituMetrology?.slopeAngleAvgDeg ?? undefined;
            const effSlopeLeft =
                spatialResult?.slopeAngleLeftDeg ?? inSituMetrology?.slopeAngleLeftDeg ?? undefined;
            const effSlopeRight =
                spatialResult?.slopeAngleRightDeg ??
                inSituMetrology?.slopeAngleRightDeg ??
                undefined;
            const effSlopeWarn =
                spatialResult?.slopeWarning ?? inSituMetrology?.slopeWarning ?? null;

            const measurementBasePayload = {
                timestamp: now,
                captured_at: now,
                volumen_m3: finalVolumeM3,
                peso_t: finalWeightT,
                density_factor: resolvedDensity ?? undefined,
                photo_url: primaryUpload?.url || '',
                perimeter_photo_urls: extraUploads.map((item) => item.url),
                method: 'digital' as const,
                cas_original_bytes: primaryUpload?.originalBytes,
                cas_optimized_bytes: primaryUpload?.optimizedBytes,
                cas_savings_pct: primaryUpload?.savingsPct,
                copper_domain: selectedCopperDomain ?? undefined,
                tipo_granulometria: selectedGranulometry ?? undefined,
                ...(trainingGranulometry ? { training_data: trainingGranulometry } : {}),
                geometry: resolvedGeometry,
                analysis_status: analysisStatus,
                lifecycle_status: lifecycleStatus,
                metrology_grade: metrologyGrade,
                reconciliation_status: reconciliationStatus,
                capture_session_id: captureSessionId,
                offline_in_situ_m3: inSituMetrology?.volumeM3 ?? finalVolumeM3,
                cloud_refined_m3: hasCloudSpatial ? spatialResult!.volumeM3 : null,
                reconciliation_delta_pct: hasCloudSpatial ? 0 : null,
                local_preview_mesh: localPreviewMesh ?? null,
                scale_anchor_type: scaleAnchorType,
                uncertainty_pct: effUncertaintyPct,
                toe_score: effToeScore,
                coverage_pct: effCoveragePct,
                depth_mode: effDepthMode,
                ground_slope_deg: effGroundSlopeDeg,
                mesh_url: spatialResult?.meshUrl ?? undefined,
                mesh_sha256: spatialResult?.meshSha256 ?? undefined,
                mesh_source: spatialResult?.meshSource ?? undefined,
                tin_volume_m3: spatialResult?.tinVolumeM3 ?? inSituMetrology?.volumeM3 ?? undefined,
                is_non_stockpile: spatialResult?.isNonStockpile,
                detected_slope_angle_deg: effSlopeAvg ?? undefined,
                slope_left_deg: effSlopeLeft ?? undefined,
                slope_right_deg: effSlopeRight ?? undefined,
                slope_warning: effSlopeWarn,
                wall_confinement: spatialResult?.wallConfinement,
                // Preservar exclusivamente el pitch medido durante el escaneo (nunca sobrescribir con postura al guardar)
                imu_pitch_deg:
                    typeof spatialScan?.captureImuPitchDeg === 'number' &&
                    Number.isFinite(spatialScan.captureImuPitchDeg)
                        ? spatialScan.captureImuPitchDeg
                        : undefined,
                gnss_status: latestDraft?.gnssStatus,
                underground_sector: latestDraft?.undergroundSector,
                ...(safeGeo
                    ? {
                          location_metadata: {
                              lat: safeGeo.latitude,
                              lng: safeGeo.longitude,
                              accuracy: safeGeo.accuracy ?? 0,
                          },
                      }
                    : {}),
            };

            let finalAssetId = targetAssetId;
            let finalMeasurementId = '';
            let createdId: string | undefined;

            if (isNewAssetMode) {
                const created = await dataService.createAssetWithInitialMeasurement({
                    asset: {
                        id: targetAssetId,
                        name:
                            editableDraftName.trim() ||
                            latestDraft?.name?.trim() ||
                            `AC-${String(now).slice(-4)}`,
                        ...(latestDraft?.projectId ? { project_id: latestDraft.projectId } : {}),
                        ...(latestDraft?.projectName
                            ? { project_name: latestDraft.projectName }
                            : {}),
                        clase: mapCopperDomainToClase(selectedCopperDomain),
                        status: 'ACTIVE',
                        ...(safeGeo ? { geo_point: safeGeo } : {}),
                        location_ref: latestDraft?.undergroundSector || undefined,
                        gnss_status: latestDraft?.gnssStatus,
                        underground_sector: latestDraft?.undergroundSector,
                        captured_at: now,
                        copper_domain: selectedCopperDomain ?? undefined,
                        tipo_granulometria: selectedGranulometry ?? undefined,
                        density_factor: resolvedDensity ?? undefined,
                        analysis_status: analysisStatus,
                        lifecycle_status: lifecycleStatus,
                        metrology_grade: metrologyGrade,
                        reconciliation_status: reconciliationStatus,
                        capture_session_id: captureSessionId,
                        offline_in_situ_m3: inSituMetrology?.volumeM3 ?? finalVolumeM3,
                        cloud_refined_m3: hasCloudSpatial ? spatialResult!.volumeM3 : null,
                        reconciliation_delta_pct: hasCloudSpatial ? 0 : null,
                        local_preview_mesh: localPreviewMesh ?? null,
                        scale_anchor_type: scaleAnchorType,
                        uncertainty_pct: effUncertaintyPct,
                        toe_score: effToeScore,
                        coverage_pct: effCoveragePct,
                        depth_mode: effDepthMode,
                        ground_slope_deg: effGroundSlopeDeg,
                        mesh_url: spatialResult?.meshUrl ?? undefined,
                        mesh_sha256: spatialResult?.meshSha256 ?? undefined,
                        mesh_source: spatialResult?.meshSource ?? undefined,
                        tin_volume_m3:
                            spatialResult?.tinVolumeM3 ?? inSituMetrology?.volumeM3 ?? undefined,
                        is_non_stockpile: spatialResult?.isNonStockpile,
                        detected_slope_angle_deg: effSlopeAvg ?? undefined,
                        slope_warning: effSlopeWarn,
                        wall_confinement: spatialResult?.wallConfinement,
                    },
                    measurement: measurementBasePayload,
                });
                finalAssetId = created.assetId;
                finalMeasurementId = created.measurementId;
                createdId = created.assetId;
            } else {
                finalMeasurementId = await dataService.addMeasurement({
                    assetId: finalAssetId,
                    ...measurementBasePayload,
                });
            }

            // Encolar paquete inmutable V2 (keyframes WebP + poses SE(3) + bundle) para refinamiento GPU diferido
            if (isSpatialFlow && inSituMetrology && !hasCloudSpatial && spatialScan) {
                const blobsToPersist =
                    allKeyframeBlobs.length > 0
                        ? allKeyframeBlobs
                        : [
                              ...(photoBlob ? [photoBlob] : []),
                              ...extraPhotos.map((p) => p.blob),
                          ];
                if (blobsToPersist.length > 0) {
                    await persistCaptureSessionOffline({
                        sessionId: captureSessionId,
                        tenantId: activeTenantId,
                        assetId: finalAssetId,
                        measurementId: finalMeasurementId,
                        capturedAt: now,
                        scan: spatialScan,
                        keyframeBlobs: blobsToPersist,
                        pairedKeyframes: pairedKeyframes.length > 0 ? pairedKeyframes : undefined,
                        inSituMetrology,
                        localPreviewMesh,
                        locale: resolvedLocale,
                    });
                } else {
                    const spatialPayloadSha256 = await saveOfflineSpatialPayload(
                        spatialScan,
                        activeTenantId
                    );
                    await syncQueueEngine.enqueueTask<GeolappSpatialSyncPayload>(
                        'GEOLAPP_SPATIAL_ANALYZE',
                        {
                            assetId: finalAssetId,
                            measurementId: finalMeasurementId,
                            tenantId: activeTenantId,
                            sha256: primaryUpload?.sha256,
                            extraSha256s: extraUploads
                                .map((item) => item.sha256)
                                .filter((s): s is string => Boolean(s)),
                            photoUrl: primaryUpload?.url,
                            spatialPayloadSha256,
                            locale: resolvedLocale,
                        }
                    );
                }
            }

            setUploadProgress(100);
            void triggerFieldNotification('SUCCESS');
            onSuccess(finalMeasurementId, createdId);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '';
            setErrorMessage(msg || t('digital_v2.save_error', 'ERROR AL GUARDAR MEDICIÓN'));
            if (!isSpatialFlow) {
                setStatusMessage({
                    severity: 'error',
                    text: msg || t('digital_v2.save_error', 'ERROR AL GUARDAR'),
                });
            }
            void triggerFieldNotification('ERROR');
        } finally {
            setIsSaving(false);
        }
    }, [
        aiDensityDismissed,
        allKeyframeBlobs,
        assetId,
        editableDraftName,
        extraPhotos,
        hasInSituVolume,
        hasSpatialPoints,
        inSituMetrology,
        isNewAssetMode,
        isSaving,
        isScanningSpatial,
        localPreviewMesh,
        manualDensityText,
        onSuccess,
        pairedKeyframes,
        photoBlob,
        resolvedLocale,
        selectedCopperDomain,
        selectedGranulometry,
        spatialResult,
        spatialScan,
        t,
    ]);

    const handleRetryScan = useCallback(() => {
        if (isSpatialCapable) {
            void handleStartSpatialScan();
            return;
        }
        clearCapturedMedia();
    }, [clearCapturedMedia, handleStartSpatialScan, isSpatialCapable]);

    useXCoverHardwareKey(
        () => {
            if (isSpatialCapable) {
                if (stage === 'RESULT' && (spatialResult || offlinePendingSpatial)) {
                    void handleSaveCapture();
                    return;
                }
                if (stage === 'READY' || stage === 'REJECTED' || stage === 'ERROR') {
                    void handleStartSpatialScan();
                }
                return;
            }
            if (!photoBlob) {
                void handleCaptureSource('CAMERA');
            }
        },
        {
            enabled: !isSaving && !isScanningSpatial && stage !== 'ANALYZING',
            action: 'DOWN',
            keyCodes: XCOVER_ALLOWED_CODES,
        }
    );

    const { density: resolvedResultDensity, source: resolvedDensitySource } =
        resolveEffectiveDensityFactor({
            manualDensityText,
            aiDensityDismissed,
            isNonStockpile: spatialResult?.isNonStockpile,
            suggestedDensityTm3: spatialResult?.suggestedDensityTm3,
            granulometry: selectedGranulometry,
        });
    const allResultThumbs = useMemo(() => {
        const list: string[] = [];
        if (photoPreview) list.push(photoPreview);
        for (const extra of extraPhotos) {
            if (list.length >= MAX_AUTO_THUMBS) break;
            list.push(extra.previewUrl);
        }
        return list;
    }, [extraPhotos, photoPreview]);

    const suppressScannerChrome =
        (capabilityLoading && !effectiveCapability) ||
        (stage === 'READY' && isSpatialCapable && (autoStartScan || isScanningSpatial));

    if (suppressScannerChrome) {
        return (
            <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] overflow-hidden rounded-none shadow-none select-none">
                <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'CARGANDO')} />
            </div>
        );
    }

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            {!hideHeader && (
                <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 text-[#0F172A] dark:text-[#F3F4F6] flex items-center justify-center cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                    </button>
                    {isNewAssetMode ? (
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                            {isEditingDraftName ? (
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    autoFocus
                                    value={editableDraftName}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setEditableDraftName(v);
                                        onDraftNameChange?.(v);
                                    }}
                                    onBlur={() => setIsEditingDraftName(false)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === 'Escape') {
                                            setIsEditingDraftName(false);
                                        }
                                    }}
                                    aria-label={t(
                                        'registration.name_label',
                                        'ID / NOMBRE DEL ACOPIO'
                                    )}
                                    className="flex-1 min-w-0 h-11 px-fib-8 bg-transparent border-0 border-b border-[#C68346] outline-none font-mono font-bold text-[18px] uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        setIsEditingDraftName(true);
                                    }}
                                    aria-label={t('digital_v2.edit_code', 'Editar código')}
                                    className="flex-1 min-w-0 min-h-[48px] bg-transparent border-0 text-left flex items-center gap-fib-8 cursor-pointer rounded-none px-0"
                                >
                                    <span className="text-[18px] font-mono font-bold uppercase truncate text-[#0F172A] dark:text-[#F3F4F6]">
                                        {displayStockpileName}
                                    </span>
                                    <span className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6] shrink-0">
                                        edit
                                    </span>
                                </button>
                            )}
                        </div>
                    ) : (
                        <h2 className="flex-1 text-[18px] font-mono font-bold uppercase truncate">
                            {displayStockpileName}
                        </h2>
                    )}
                    <span className="material-symbols-outlined text-[22px] text-[#00AEEF]">
                        view_in_ar
                    </span>
                </header>
            )}

            <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
            />
            <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
            />

            {isNativeRuntime && effectiveCapability?.tier === 'INCOMPATIBLE' && (
                <div
                    role="alert"
                    className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[4px] border-l-[#C68346] flex items-start gap-fib-13 bg-transparent"
                >
                    <span className="material-symbols-outlined text-[24px] text-[#C68346] shrink-0">
                        warning
                    </span>
                    <div className="min-w-0 flex-1 font-mono">
                        <span className="block text-[18px] font-bold uppercase text-[#C68346]">
                            {t('compatibility.mobile_incompatible_banner', 'DISPOSITIVO INCOMPATIBLE ARCORE')}
                        </span>
                        <span className="block text-[15px] text-[#475569] dark:text-[#8A93A6] mt-1">
                            {t(
                                'compatibility.mobile_no_depth_sensor',
                                'ESTE TELÉFONO NO TIENE SENSOR DE PROFUNDIDAD'
                            )}
                        </span>
                    </div>
                </div>
            )}

            {isNativeRuntime && effectiveCapability?.tier === 'NEEDS_UPDATE' && (
                <div
                    role="status"
                    className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[4px] border-l-[#C68346] flex items-center justify-between gap-fib-13 bg-transparent"
                >
                    <span className="font-mono text-[18px] font-bold uppercase text-[#C68346]">
                        {t('compatibility.mobile_update_arcore', 'ACTUALIZAR SERVICIOS AR')}
                    </span>
                    <button
                        type="button"
                        onClick={() => void handleRequestArCoreInstall()}
                        disabled={isRequestingArCore}
                        aria-label={t('compatibility.mobile_update_arcore', 'ACTUALIZAR SERVICIOS AR')}
                        title={t('compatibility.mobile_update_arcore', 'ACTUALIZAR SERVICIOS AR')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none shrink-0"
                    >
                        <span className="material-symbols-outlined text-[24px]">download</span>
                    </button>
                </div>
            )}

            {isSaving && (
                <div className="shrink-0 px-fib-21 py-fib-13 border-b border-[#00AEEF] bg-transparent space-y-fib-8">
                    <div className="flex items-center justify-between gap-fib-8">
                        <M3CircularProgress
                            size={22}
                            value={uploadProgress}
                            ariaLabel={t('digital_v2.saving_progress', 'Guardando medición')}
                        />
                        <span className="text-[18px] font-mono font-bold tabular-nums text-[#00AEEF]">
                            {uploadProgress}%
                        </span>
                    </div>
                    <M3LinearProgress
                        value={uploadProgress}
                        ariaLabel={t('digital_v2.progress_aria', 'Progreso de guardado')}
                    />
                </div>
            )}

            {statusMessage && (
                <div className="shrink-0 px-fib-21 pt-fib-8">
                    <InlineStatusBanner
                        message={statusMessage}
                        onDismiss={() => setStatusMessage(null)}
                    />
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-between px-fib-21 py-fib-21 gap-fib-21">
                {stage === 'ANALYZING' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-fib-21 text-center">
                        <M3CircularProgress
                            size={44}
                            ariaLabel={t('scanner.calculating_volume', 'Calculando volumen')}
                        />
                        <div className="w-full max-w-sm">
                            <M3LinearProgress
                                indeterminate
                                ariaLabel={t('scanner.calculating_volume', 'Calculando volumen')}
                            />
                        </div>
                    </div>
                )}

                {stage === 'REJECTED' && (
                    <div className="flex-1 flex flex-col justify-between gap-fib-21">
                        <div
                            role="alert"
                            className="p-fib-21 border-l-[4px] border-[#C68346] border-y border-r border-y-[#E2E8F0] border-r-[#E2E8F0] dark:border-y-[#12151C] dark:border-r-[#12151C] space-y-fib-13"
                        >
                            <span className="material-symbols-outlined text-[36px] text-[#C68346]">
                                warning
                            </span>
                            <p className="font-mono text-[20px] font-bold leading-snug text-[#0F172A] dark:text-[#F3F4F6]">
                                {rejectionMessage}
                            </p>
                        </div>

                        <div className="shrink-0 h-[64px] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center pb-[env(safe-area-inset-bottom)]">
                            <button
                                type="button"
                                onClick={() => void handleStartSpatialScan()}
                                disabled={isScanningSpatial || isSaving}
                                aria-label={t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                                title={t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                                className="min-w-[64px] min-h-[56px] bg-transparent border-0 text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[36px]">
                                    measuring_tape
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {stage === 'ERROR' && (
                    <div className="flex-1 flex flex-col justify-between gap-fib-21">
                        <div
                            role="alert"
                            className="p-fib-21 border-l-[4px] border-[#C68346] border-y border-r border-y-[#E2E8F0] border-r-[#E2E8F0] dark:border-y-[#12151C] dark:border-r-[#12151C] space-y-fib-13"
                        >
                            <span className="material-symbols-outlined text-[32px] text-[#C68346]">
                                error
                            </span>
                            <p className="font-mono text-[18px] font-bold leading-snug text-[#0F172A] dark:text-[#F3F4F6]">
                                {errorMessage || t('scanner.analyze_error', 'ERROR EN MEDICIÓN')}
                            </p>
                        </div>

                        <div className="shrink-0 h-[64px] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-around pb-[env(safe-area-inset-bottom)]">
                            {hasSpatialPoints && spatialScan && isOnline && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        void runSpatialAnalysis(
                                            spatialScan,
                                            photoBlob,
                                            extraPhotos.map((p) => p.blob)
                                        )
                                    }
                                    disabled={isScanningSpatial || isSaving}
                                    aria-label={t('twin3d.retry_load', 'REINTENTAR')}
                                    title={t('twin3d.retry_load', 'REINTENTAR')}
                                    className="min-w-[64px] min-h-[56px] bg-transparent border-0 text-[#00AEEF] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[30px]">
                                        refresh
                                    </span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void handleStartSpatialScan()}
                                disabled={isScanningSpatial || isSaving}
                                aria-label={t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                                title={t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                                className="min-w-[64px] min-h-[56px] bg-transparent border-0 text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[34px]">
                                    measuring_tape
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {stage === 'RESULT' && (
                    <div className="flex-1 flex flex-col justify-between gap-fib-21">
                        <div className="space-y-fib-21">
                            {errorMessage && (
                                <div
                                    role="alert"
                                    className="p-fib-13 border-l-[4px] border-[#C68346] font-mono text-[18px] font-bold text-[#C68346]"
                                >
                                    {errorMessage}
                                </div>
                            )}

                            <div className="py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                <div className="flex items-center justify-between gap-fib-8">
                                    <span className="block font-mono text-[18px] font-bold uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                        {displayStockpileName}
                                    </span>
                                    {!spatialResult?.isNonStockpile && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void triggerFieldImpact('LIGHT');
                                                setShowSpecsPanel((p) => !p);
                                            }}
                                            aria-expanded={showSpecsPanel}
                                            aria-label={t(
                                                'scanner.classification_title',
                                                'CLASIFICACIÓN Y DENSIDAD'
                                            )}
                                            title={t(
                                                'scanner.classification_title',
                                                'CLASIFICACIÓN Y DENSIDAD'
                                            )}
                                            className={`min-w-[48px] min-h-[48px] bg-transparent border-0 flex items-center justify-center cursor-pointer rounded-none shrink-0 ${
                                                showSpecsPanel
                                                    ? 'text-[#C68346]'
                                                    : 'text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">
                                                tune
                                            </span>
                                        </button>
                                    )}
                                </div>

                                {spatialResult || inSituMetrology ? (
                                    <>
                                        {(() => {
                                            const activeVol =
                                                spatialResult?.volumeM3 ??
                                                inSituMetrology?.volumeM3 ??
                                                0;
                                            const activeUncertainty =
                                                spatialResult?.uncertaintyPct ??
                                                inSituMetrology?.uncertaintyPct ??
                                                null;
                                            const activeGrade = inSituMetrology?.metrologyGrade;
                                            const previewT =
                                                activeVol > 0 && resolvedResultDensity
                                                    ? activeVol * resolvedResultDensity
                                                    : 0;
                                            return (
                                                <>
                                                    <div className="flex items-baseline gap-fib-13 flex-wrap">
                                                        <span className="font-mono text-[48px] font-bold tabular-nums leading-none text-[#C68346]">
                                                            {formatStockpileVolumeM3(activeVol)} m³
                                                        </span>
                                                        {typeof activeUncertainty === 'number' &&
                                                            Number.isFinite(activeUncertainty) && (
                                                                <span
                                                                    className={`font-mono text-[18px] font-bold tabular-nums ${
                                                                        activeUncertainty <= 6
                                                                            ? 'text-[#00AEEF]'
                                                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                                                    }`}
                                                                >
                                                                    ± {activeUncertainty.toFixed(1)}%
                                                                </span>
                                                            )}
                                                    </div>
                                                    {inSituMetrology && !spatialResult && (
                                                        <div className="flex items-center gap-fib-8 font-mono text-microcopy uppercase tabular-nums">
                                                            <span
                                                                className={
                                                                    activeGrade ===
                                                                    'LOW_CONFIDENCE_RECAPTURE'
                                                                        ? 'text-[#C68346] font-bold'
                                                                        : 'text-[#00AEEF] font-bold'
                                                                }
                                                            >
                                                                {activeGrade ===
                                                                'LOW_CONFIDENCE_RECAPTURE'
                                                                    ? 'IN-SITU · BAJA CONFIANZA'
                                                                    : 'IN-SITU OFFLINE'}
                                                            </span>
                                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                COB {Math.round(inSituMetrology.coveragePct)}% · TOE {Math.round(inSituMetrology.toeScore)}%
                                                            </span>
                                                        </div>
                                                    )}
                                                    {previewT > 0 && resolvedResultDensity ? (
                                                        <div className="flex items-center flex-wrap gap-fib-8 font-mono text-[20px] font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                            <span>{previewT.toFixed(1)} t</span>
                                                            <span className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                                {resolvedResultDensity.toFixed(2)} t/m³
                                                            </span>
                                                            {resolvedDensitySource === 'AI' && (
                                                                <span className="text-[13px] font-bold text-[#00AEEF]">
                                                                    {t(
                                                                        'scanner.ai_granulometry_optin',
                                                                        'IA'
                                                                    )}
                                                                    {selectedGranulometry
                                                                        ? ` · ${selectedGranulometry}`
                                                                        : ''}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : null}
                                                </>
                                            );
                                        })()}
                                        {spatialResult?.isNonStockpile && (
                                            <div className="pt-fib-8 font-mono text-[18px] font-bold uppercase text-[#C68346]">
                                                NO SE DETECTÓ ACOPIO MINERAL
                                            </div>
                                        )}
                                    </>
                                ) : null}
                            </div>

                            {showSpecsPanel && !spatialResult?.isNonStockpile && (
                                <div className="space-y-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                    <div>
                                        <span className="block font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] mb-fib-8">
                                            {t(
                                                'scanner.domain_optional_label',
                                                'CLASIFICACIÓN MATERIAL (OPCIONAL)'
                                            )}
                                        </span>
                                        <div className="grid grid-cols-2 gap-fib-8">
                                            {COPPER_DOMAIN_OPTIONS.map((opt) => {
                                                const active = selectedCopperDomain === opt.value;
                                                return (
                                                    <button
                                                        key={opt.value}
                                                        type="button"
                                                        onClick={() =>
                                                            setSelectedCopperDomain((prev) =>
                                                                prev === opt.value
                                                                    ? null
                                                                    : opt.value
                                                            )
                                                        }
                                                        aria-pressed={active}
                                                        className={`min-h-[44px] px-fib-8 py-1 border text-left font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none ${
                                                            active
                                                                ? 'border-[#C68346] text-[#C68346] bg-[#C68346]/10'
                                                                : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] bg-transparent'
                                                        }`}
                                                    >
                                                        {t(opt.labelKey, opt.fallbackLabel)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between gap-fib-8 mb-fib-8">
                                            <span className="font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'scanner.granulometry_optional_label',
                                                    'GRANULOMETRÍA (OPCIONAL)'
                                                )}
                                            </span>
                                            {spatialResult?.aiSuggestedGranulometry && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAiDensityDismissed(false);
                                                        setSelectedGranulometry(
                                                            spatialResult.aiSuggestedGranulometry!
                                                        );
                                                    }}
                                                    className={`px-fib-8 py-1 border font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none ${
                                                        selectedGranulometry ===
                                                        spatialResult.aiSuggestedGranulometry
                                                            ? 'border-[#00AEEF] text-[#00AEEF] bg-[#00AEEF]/10'
                                                            : 'border-[#00AEEF] text-[#00AEEF] bg-transparent'
                                                    }`}
                                                >
                                                    {t('scanner.ai_granulometry_optin', 'IA')}:{' '}
                                                    {spatialResult.aiSuggestedGranulometry}
                                                </button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-4 gap-fib-8">
                                            {(['COLPAS', 'GRANSA', 'MIXTO', 'FINOS'] as const).map(
                                                (gran) => {
                                                    const active = selectedGranulometry === gran;
                                                    return (
                                                        <button
                                                            key={gran}
                                                            type="button"
                                                            onClick={() => {
                                                                if (selectedGranulometry === gran) {
                                                                    setSelectedGranulometry(null);
                                                                    setAiDensityDismissed(true);
                                                                } else {
                                                                    setAiDensityDismissed(false);
                                                                    setSelectedGranulometry(gran);
                                                                }
                                                            }}
                                                            aria-pressed={active}
                                                            className={`min-h-[44px] border font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none ${
                                                                active
                                                                    ? 'border-[#C68346] text-[#C68346] bg-[#C68346]/10'
                                                                    : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] bg-transparent'
                                                            }`}
                                                        >
                                                            {gran}
                                                        </button>
                                                    );
                                                }
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-fib-8">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={manualDensityText}
                                            onChange={(e) => {
                                                setAiDensityDismissed(false);
                                                setManualDensityText(
                                                    sanitizeDecimalText(e.target.value)
                                                );
                                            }}
                                            placeholder={
                                                resolvedDensitySource === 'AI' &&
                                                resolvedResultDensity
                                                    ? `${t('scanner.ai_granulometry_optin', 'IA')}: ${resolvedResultDensity.toFixed(2)} t/m³`
                                                    : t(
                                                          'scanner.density_optional_placeholder',
                                                          'DENSIDAD (t/m³, OPCIONAL)'
                                                      )
                                            }
                                            className="flex-1 min-w-0 h-11 px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none"
                                        />
                                        {(manualDensityText.trim().length > 0 ||
                                            resolvedResultDensity !== null) && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setManualDensityText('');
                                                    setAiDensityDismissed(true);
                                                }}
                                                aria-label={t('common.clear', 'LIMPIAR')}
                                                className="min-w-[48px] min-h-[48px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] flex items-center justify-center cursor-pointer rounded-none"
                                            >
                                                <span className="material-symbols-outlined text-[20px]">
                                                    close
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {allResultThumbs.length > 0 && (
                                <div className="grid grid-cols-4 gap-fib-8">
                                    {allResultThumbs.map((srcUrl, idx) => (
                                        <div
                                            key={`${srcUrl}_${idx}`}
                                            className="h-20 border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] overflow-hidden rounded-none"
                                        >
                                            <SecureImage
                                                src={srcUrl}
                                                alt={`Captura ${idx + 1}`}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="shrink-0 h-[64px] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-around pb-[env(safe-area-inset-bottom)]">
                            <button
                                type="button"
                                onClick={handleRetryScan}
                                disabled={isSaving || isScanningSpatial}
                                aria-label={t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                                title={t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                                className="min-w-[64px] min-h-[56px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[28px]">
                                    refresh
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveCapture()}
                                disabled={isSaving || isScanningSpatial}
                                aria-label={t('scanner.save_measurement_btn', 'GUARDAR MEDICIÓN')}
                                title={t('scanner.save_measurement_btn', 'GUARDAR MEDICIÓN')}
                                className="min-w-[64px] min-h-[56px] bg-transparent border-0 text-[#00AEEF] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[32px]">
                                    check
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {stage === 'READY' && isSpatialCapable && !autoStartScan && (
                    <div className="flex-1 flex items-center justify-center pb-[env(safe-area-inset-bottom)]">
                        <button
                            type="button"
                            onClick={() => void handleStartSpatialScan()}
                            disabled={isSaving || isScanningSpatial}
                            aria-label={t('scanner.remeasure_btn', 'MEDIR')}
                            title={t('scanner.remeasure_btn', 'MEDIR')}
                            className="min-w-[88px] min-h-[88px] bg-transparent border-0 text-[#C68346] hover:opacity-75 flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[56px]">
                                measuring_tape
                            </span>
                        </button>
                    </div>
                )}

                {stage === 'READY' && !isSpatialCapable && (
                    <div className="flex-1 flex flex-col justify-between gap-fib-21">
                        <div className="space-y-fib-13">
                            {errorMessage && (
                                <div
                                    role="alert"
                                    className="p-fib-13 border-l-[4px] border-[#C68346] font-mono text-[18px] font-bold text-[#C68346]"
                                >
                                    {errorMessage}
                                </div>
                            )}

                            {!photoPreview ? (
                                <div className="py-fib-55 flex items-center justify-center gap-fib-34">
                                    <button
                                        type="button"
                                        onClick={() => void handleCaptureSource('CAMERA')}
                                        disabled={isSaving}
                                        aria-label={t('digital_v2.capture_primary_btn', 'TOMAR FOTO ACOPIO')}
                                        className="w-16 h-16 min-w-[64px] min-h-[64px] bg-transparent border-0 text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[40px]">
                                            photo_camera
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleCaptureSource('PHOTOS')}
                                        disabled={isSaving}
                                        aria-label={t('digital_v2.gallery_btn', 'GALERÍA')}
                                        className="w-16 h-16 min-w-[64px] min-h-[64px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[36px]">
                                            photo_library
                                        </span>
                                    </button>
                                </div>
                            ) : (
                                <div className="relative w-full h-64 bg-[#000000] overflow-hidden border border-[#E2E8F0] dark:border-[#12151C]">
                                    <SecureImage
                                        src={photoPreview}
                                        alt={t('digital_v2.photo_alt', 'Captura acopio')}
                                        className="w-full h-full object-cover"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void handleCaptureSource('CAMERA')}
                                        disabled={isSaving}
                                        aria-label={t('digital_v2.retake_btn', 'RECAPTURAR')}
                                        className="min-w-[48px] min-h-[48px] absolute top-2 right-2 bg-[#000000]/80 border-0 text-white flex items-center justify-center cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            refresh
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="shrink-0 h-[64px] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center pb-[env(safe-area-inset-bottom)]">
                            <button
                                type="button"
                                onClick={() => void handleSaveCapture()}
                                disabled={!photoBlob || isSaving}
                                aria-label={t('common.save_button', 'GUARDAR')}
                                title={t('common.save_button', 'GUARDAR')}
                                className="min-w-[64px] min-h-[56px] bg-transparent border-0 text-[#00AEEF] flex items-center justify-center cursor-pointer disabled:opacity-30 rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[32px]">
                                    check
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
