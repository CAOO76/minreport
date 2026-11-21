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
import { geolappDigitalAiService } from '../core/services/GeolappDigitalAiService';
import { useSpatialDeviceCapability } from '../core/services/spatialDeviceCapability';
import {
    SpatialScanRejectedError,
    analyzeSpatialScan,
    formatStockpileVolumeM3,
    getNativeCalibrationStatus,
    isCalibrationValid,
    saveOfflineSpatialPayload,
    startNativeSpatialScan,
    type NativeCalibrationResult,
    type SpatialAnalyzeResult,
    type SpatialScanNativeResult,
} from '../core/services/spatialScannerService';
import { useImuClinometer } from '../core/hooks/useImuClinometer';
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
    draftAsset,
    onSuccess,
    onBack,
    hideHeader = false,
}) => {
    const { t, i18n } = useTranslation();
    const { isOnline } = useNetworkStatus();
    const imu = useImuClinometer();
    const { capability, requestInstall } = useSpatialDeviceCapability();

    const isNewAssetMode = Boolean(!assetId && draftAsset);
    const isNativeRuntime = Capacitor.isNativePlatform();
    const isSpatialCapable = Boolean(
        isNativeRuntime &&
            (capability?.tier === 'OPTIMAL_SPATIAL' || capability?.tier === 'COMPATIBLE_VIO')
    );

    const displayStockpileName =
        assetName?.trim() || draftAsset?.name?.trim() || t('scanner.title', 'ACOPIO');

    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const latestUrlsRef = useRef<{ primary: string | null; extras: string[] }>({
        primary: null,
        extras: [],
    });

    const [stage, setStage] = useState<ScannerStage>('READY');
    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [extraPhotos, setExtraPhotos] = useState<Array<{ blob: Blob; previewUrl: string }>>([]);
    const [spatialScan, setSpatialScan] = useState<SpatialScanNativeResult | null>(null);
    const [spatialResult, setSpatialResult] = useState<SpatialAnalyzeResult | null>(null);
    const [offlinePendingSpatial, setOfflinePendingSpatial] = useState<boolean>(false);

    const [calibration, setCalibration] = useState<NativeCalibrationResult | null>(null);
    const [selectedCopperDomain, setSelectedCopperDomain] = useState<CopperMineralDomain | null>(
        null
    );
    const [selectedGranulometry, setSelectedGranulometry] = useState<
        'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null
    >(null);
    const [manualDensityText, setManualDensityText] = useState<string>('');

    const [isScanningSpatial, setIsScanningSpatial] = useState<boolean>(false);
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
        if (imu.isSupported) {
            void imu.startListening();
        }
        return () => {
            void imu.stopListening();
        };
    }, []);

    useEffect(() => {
        let active = true;
        void getNativeCalibrationStatus()
            .then((cal) => {
                if (active) setCalibration(cal);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

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
        setSpatialScan(null);
        setSpatialResult(null);
        setOfflinePendingSpatial(false);
        setSelectedCopperDomain(null);
        setSelectedGranulometry(null);
        setManualDensityText('');
        setRejectionMessage(null);
        setErrorMessage(null);
        setStatusMessage(null);
        setStage('READY');
    }, []);

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
            setStage('ANALYZING');
            setRejectionMessage(null);
            setErrorMessage(null);
            setOfflinePendingSpatial(false);

            if (!isOnline) {
                setSpatialResult(null);
                setOfflinePendingSpatial(true);
                setStage('RESULT');
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
                    calibrationId: calibration?.calibrationId,
                    calibrationScaleFactor:
                        scan.calibrationScaleFactor ??
                        (isCalibrationValid(calibration) ? calibration?.scaleFactor : undefined),
                    calibrationPlaneNoiseRmsM:
                        scan.calibrationPlaneNoiseRmsM ?? calibration?.planeNoiseRmsM,
                    deviceCalibratedAt: scan.deviceCalibratedAt ?? calibration?.calibratedAt,
                    locale: resolvedLocale,
                });
                setSpatialResult(res);
                setOfflinePendingSpatial(false);
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
        [calibration, isOnline, resolvedLocale, t]
    );

    const handleStartSpatialScan = useCallback(async () => {
        if (isSaving || isScanningSpatial || !isSpatialCapable) return;
        setIsScanningSpatial(true);
        setRejectionMessage(null);
        setErrorMessage(null);
        setStatusMessage(null);
        void triggerFieldImpact('MEDIUM');

        try {
            const { scan, photoBlobs } = await startNativeSpatialScan();
            if (scan.cancelled) {
                return;
            }
            setSpatialScan(scan);

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
            const msg = err instanceof Error ? err.message : String(err || '');
            setErrorMessage(msg || t('digital_v2.save_error', 'ERROR EN ESCÁNER'));
            setStage('ERROR');
            void triggerFieldNotification('ERROR');
        } finally {
            setIsScanningSpatial(false);
        }
    }, [
        isSaving,
        isScanningSpatial,
        isSpatialCapable,
        processPrimaryBlob,
        runSpatialAnalysis,
        t,
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
        setSpatialScan(null);
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

    const hasSpatialPoints = Boolean(
        spatialScan &&
            !spatialScan.cancelled &&
            Array.isArray(spatialScan.pointsM) &&
            spatialScan.pointsM.length >= 20
    );

    const handleSaveCapture = useCallback(async () => {
        if (isSaving || isScanningSpatial) return;
        if (!photoBlob && !hasSpatialPoints) {
            setErrorMessage(t('digital_v2.photo_required', 'CAPTURA REQUERIDA'));
            void triggerFieldNotification('ERROR');
            return;
        }

        const isSpatialFlow = Boolean(hasSpatialPoints && spatialScan);
        if (isSpatialFlow && isOnline && !spatialResult) {
            setErrorMessage(t('scanner.analyze_required', 'EJECUTA ANÁLISIS ANTES DE GUARDAR'));
            void triggerFieldNotification('ERROR');
            return;
        }

        setIsSaving(true);
        setUploadProgress(15);
        setErrorMessage(null);
        setStatusMessage(null);

        try {
            const now = Date.now();
            const targetAssetId = isNewAssetMode ? `asset_${now}` : assetId!;
            const activeTenantId = getActiveTenantId();

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

            setUploadProgress(55);

            let resolvedAi = null;
            if (!isSpatialFlow && isOnline && photoBlob) {
                resolvedAi = await geolappDigitalAiService
                    .analyzeCapture({
                        stockpileId: isNewAssetMode ? undefined : assetId,
                        tenantId: activeTenantId,
                        photoBlob,
                        extraBlobs: [],
                        scaleAnchorType: 'NONE',
                        imuPitchDeg: imu.pitchDeg,
                        imuRollDeg: imu.rollDeg,
                        locale: resolvedLocale,
                    })
                    .catch(() => null);
            }

            setUploadProgress(80);
            const hasSpatialVerified = Boolean(
                isSpatialFlow && spatialResult?.verified && spatialResult.volumeM3 > 0
            );
            const hasAiResult = Boolean(resolvedAi);
            const analysisStatus: GeolappAnalysisStatus = isSpatialFlow
                ? hasSpatialVerified
                    ? 'AI_VERIFIED'
                    : 'PENDING_AI_SYNC'
                : !hasAiResult
                  ? 'PENDING_AI_SYNC'
                  : resolvedAi!.scaleVerified
                    ? 'AI_VERIFIED'
                    : 'PENDING_SCALE';

            const finalVolumeM3 = hasSpatialVerified
                ? spatialResult!.volumeM3
                : resolvedAi && resolvedAi.scaleVerified && resolvedAi.volumeM3 > 0
                  ? resolvedAi.volumeM3
                  : 0;
            const rawDensNum = Number.parseFloat(manualDensityText.replace(',', '.'));
            const parsedManualDensity =
                Number.isFinite(rawDensNum) && rawDensNum > 0 && rawDensNum <= 8
                    ? Number(rawDensNum.toFixed(3))
                    : null;
            const finalWeightT =
                finalVolumeM3 > 0 && parsedManualDensity
                    ? Number((finalVolumeM3 * parsedManualDensity).toFixed(2))
                    : 0;

            const safeGeo =
                draftAsset?.geoPoint &&
                Number.isFinite(draftAsset.geoPoint.latitude) &&
                Number.isFinite(draftAsset.geoPoint.longitude) &&
                (draftAsset.geoPoint.latitude !== 0 || draftAsset.geoPoint.longitude !== 0)
                    ? draftAsset.geoPoint
                    : undefined;

            const scaleAnchorType = isSpatialFlow
                ? ('ARCORE_VIO_DEPTH' as const)
                : ('NONE' as const);

            const resolvedGeometry = spatialResult?.dimensionsM
                ? {
                      type: spatialResult.geometryType,
                      dimensions: spatialResult.dimensionsM,
                  }
                : resolvedAi?.dimensionsM
                  ? {
                        type: resolvedAi.geometryType,
                        dimensions: resolvedAi.dimensionsM,
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

            const measurementBasePayload = {
                timestamp: now,
                captured_at: now,
                volumen_m3: finalVolumeM3,
                peso_t: finalWeightT,
                density_factor: parsedManualDensity ?? undefined,
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
                scale_anchor_type: scaleAnchorType,
                uncertainty_pct: isSpatialFlow
                    ? (spatialResult?.uncertaintyPct ?? null)
                    : undefined,
                toe_score: isSpatialFlow ? (spatialResult?.toeScore ?? null) : undefined,
                coverage_pct: isSpatialFlow
                    ? (spatialResult?.coveragePct ?? spatialScan?.coveragePct ?? null)
                    : undefined,
                depth_mode: isSpatialFlow
                    ? (spatialResult?.depthMode ?? spatialScan?.depthMode ?? null)
                    : undefined,
                ground_slope_deg: isSpatialFlow
                    ? (spatialResult?.groundSlopeDeg ?? null)
                    : undefined,
                mesh_url: spatialResult?.meshUrl ?? undefined,
                mesh_sha256: spatialResult?.meshSha256 ?? undefined,
                mesh_source: spatialResult?.meshSource ?? undefined,
                tin_volume_m3: spatialResult?.tinVolumeM3 ?? undefined,
                is_non_stockpile: spatialResult?.isNonStockpile,
                detected_slope_angle_deg:
                    spatialResult?.slopeAngleAvgDeg ??
                    resolvedAi?.slopeAngleAvgDeg ??
                    undefined,
                slope_left_deg:
                    spatialResult?.slopeAngleLeftDeg ??
                    resolvedAi?.slopeAngleLeftDeg ??
                    undefined,
                slope_right_deg:
                    spatialResult?.slopeAngleRightDeg ??
                    resolvedAi?.slopeAngleRightDeg ??
                    undefined,
                slope_warning: spatialResult?.slopeWarning ?? resolvedAi?.slopeWarning ?? null,
                wall_confinement:
                    spatialResult?.wallConfinement ?? resolvedAi?.wallConfinement,
                imu_pitch_deg: typeof imu.pitchDeg === 'number' ? imu.pitchDeg : undefined,
                gnss_status: draftAsset?.gnssStatus,
                underground_sector: draftAsset?.undergroundSector,
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
                        name: draftAsset?.name?.trim() || `AC-${String(now).slice(-4)}`,
                        ...(draftAsset?.projectId ? { project_id: draftAsset.projectId } : {}),
                        ...(draftAsset?.projectName ? { project_name: draftAsset.projectName } : {}),
                        clase: mapCopperDomainToClase(selectedCopperDomain),
                        status: 'ACTIVE',
                        ...(safeGeo ? { geo_point: safeGeo } : {}),
                        location_ref: draftAsset?.undergroundSector || undefined,
                        gnss_status: draftAsset?.gnssStatus,
                        underground_sector: draftAsset?.undergroundSector,
                        captured_at: now,
                        copper_domain: selectedCopperDomain ?? undefined,
                        tipo_granulometria: selectedGranulometry ?? undefined,
                        density_factor: parsedManualDensity ?? undefined,
                        analysis_status: analysisStatus,
                        scale_anchor_type: scaleAnchorType,
                        uncertainty_pct: isSpatialFlow
                            ? (spatialResult?.uncertaintyPct ?? null)
                            : undefined,
                        toe_score: isSpatialFlow ? (spatialResult?.toeScore ?? null) : undefined,
                        coverage_pct: isSpatialFlow
                            ? (spatialResult?.coveragePct ?? spatialScan?.coveragePct ?? null)
                            : undefined,
                        depth_mode: isSpatialFlow
                            ? (spatialResult?.depthMode ?? spatialScan?.depthMode ?? null)
                            : undefined,
                        ground_slope_deg: isSpatialFlow
                            ? (spatialResult?.groundSlopeDeg ?? null)
                            : undefined,
                        mesh_url: spatialResult?.meshUrl ?? undefined,
                        mesh_sha256: spatialResult?.meshSha256 ?? undefined,
                        mesh_source: spatialResult?.meshSource ?? undefined,
                        tin_volume_m3: spatialResult?.tinVolumeM3 ?? undefined,
                        is_non_stockpile: spatialResult?.isNonStockpile,
                        detected_slope_angle_deg:
                            spatialResult?.slopeAngleAvgDeg ??
                            resolvedAi?.slopeAngleAvgDeg ??
                            undefined,
                        slope_warning:
                            spatialResult?.slopeWarning ?? resolvedAi?.slopeWarning ?? null,
                        wall_confinement:
                            spatialResult?.wallConfinement ?? resolvedAi?.wallConfinement,
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

            if (isSpatialFlow && !hasSpatialVerified && offlinePendingSpatial && spatialScan) {
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
            } else if (!isSpatialFlow && analysisStatus === 'PENDING_AI_SYNC' && primaryUpload) {
                await syncQueueEngine.enqueueTask('GEOLAPP_DIGITAL_AI_ANALYZE', {
                    assetId: finalAssetId,
                    measurementId: finalMeasurementId,
                    tenantId: activeTenantId,
                    sha256: primaryUpload.sha256,
                    extraSha256s: extraUploads
                        .map((item) => item.sha256)
                        .filter((s): s is string => Boolean(s)),
                    photoUrl: primaryUpload.url,
                    scaleAnchorType: 'NONE',
                    imuPitchDeg: typeof imu.pitchDeg === 'number' ? imu.pitchDeg : undefined,
                    imuRollDeg: typeof imu.rollDeg === 'number' ? imu.rollDeg : undefined,
                    locale: resolvedLocale,
                });
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
        assetId,
        draftAsset,
        extraPhotos,
        hasSpatialPoints,
        imu.pitchDeg,
        imu.rollDeg,
        isNewAssetMode,
        isOnline,
        isSaving,
        isScanningSpatial,
        manualDensityText,
        offlinePendingSpatial,
        onSuccess,
        photoBlob,
        resolvedLocale,
        selectedCopperDomain,
        selectedGranulometry,
        spatialResult,
        spatialScan,
        t,
    ]);

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

    const calValid = isCalibrationValid(calibration);
    const allResultThumbs = useMemo(() => {
        const list: string[] = [];
        if (photoPreview) list.push(photoPreview);
        for (const extra of extraPhotos) {
            if (list.length >= MAX_AUTO_THUMBS) break;
            list.push(extra.previewUrl);
        }
        return list;
    }, [extraPhotos, photoPreview]);

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
                    <h2 className="flex-1 text-[18px] font-mono font-bold uppercase truncate">
                        {displayStockpileName}
                    </h2>
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

            {isNativeRuntime && capability?.tier === 'INCOMPATIBLE' && (
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

            {isNativeRuntime && capability?.tier === 'NEEDS_UPDATE' && (
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
                        className="min-h-[52px] px-fib-21 bg-transparent border border-[#C68346] text-[#C68346] font-mono text-[18px] font-bold uppercase cursor-pointer disabled:opacity-40 rounded-none shrink-0"
                    >
                        ARCore
                    </button>
                </div>
            )}

            {isSaving && (
                <div className="shrink-0 px-fib-21 py-fib-13 border-b border-[#00AEEF] bg-transparent space-y-fib-8">
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="flex items-center gap-fib-8">
                            <M3CircularProgress
                                size={22}
                                value={uploadProgress}
                                ariaLabel={t('digital_v2.saving_progress', 'Guardando medición')}
                            />
                            <span className="text-[18px] font-mono font-bold uppercase text-[#00AEEF]">
                                GUARDANDO...
                            </span>
                        </div>
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
                        <span className="font-mono text-[20px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('scanner.calculating_volume', 'CALCULANDO VOLUMEN...')}
                        </span>
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

                        <button
                            type="button"
                            onClick={() => void handleStartSpatialScan()}
                            disabled={isScanningSpatial || isSaving}
                            className="w-full min-h-[68px] px-fib-21 bg-[#C68346] hover:bg-[#b5753b] text-white font-mono text-[20px] font-bold uppercase border-0 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                        >
                            {t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
                        </button>
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
                                {errorMessage || 'ERROR EN MEDICIÓN'}
                            </p>
                        </div>

                        <div className="space-y-fib-13">
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
                                    className="w-full min-h-[68px] px-fib-21 bg-[#00AEEF] text-white font-mono text-[20px] font-bold uppercase border-0 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                                >
                                    REINTENTAR CÁLCULO
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void handleStartSpatialScan()}
                                disabled={isScanningSpatial || isSaving}
                                className="w-full min-h-[64px] px-fib-21 bg-[#C68346] text-white font-mono text-[20px] font-bold uppercase border-0 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                            >
                                {t('scanner.remeasure_btn', 'VOLVER A MEDIR')}
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

                            <div className="py-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                <span className="block font-mono text-[18px] font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {displayStockpileName}
                                </span>
                                {spatialResult ? (
                                    <>
                                        <div className="font-mono text-[48px] font-bold tabular-nums leading-none text-[#C68346]">
                                            {formatStockpileVolumeM3(spatialResult.volumeM3)} m³
                                        </div>
                                        {(() => {
                                            const dNum = Number.parseFloat(
                                                manualDensityText.replace(',', '.')
                                            );
                                            const validD =
                                                Number.isFinite(dNum) && dNum > 0 && dNum <= 8
                                                    ? dNum
                                                    : null;
                                            const previewT =
                                                spatialResult.volumeM3 > 0 && validD
                                                    ? spatialResult.volumeM3 * validD
                                                    : 0;
                                            return previewT > 0 ? (
                                                <div className="font-mono text-[20px] font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {previewT.toFixed(1)} t
                                                </div>
                                            ) : null;
                                        })()}
                                        {spatialResult.isNonStockpile && (
                                            <div className="pt-fib-8 font-mono text-[18px] font-bold uppercase text-[#C68346]">
                                                NO SE DETECTÓ ACOPIO MINERAL
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="font-mono text-[22px] font-bold uppercase text-[#C68346]">
                                        SIN CONEXIÓN · PENDIENTE CÁLCULO
                                    </div>
                                )}
                            </div>

                            {!spatialResult?.isNonStockpile && (
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
                                                    onClick={() =>
                                                        setSelectedGranulometry(
                                                            spatialResult.aiSuggestedGranulometry!
                                                        )
                                                    }
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
                                                            onClick={() =>
                                                                setSelectedGranulometry((prev) =>
                                                                    prev === gran ? null : gran
                                                                )
                                                            }
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

                                    <div>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={manualDensityText}
                                            onChange={(e) =>
                                                setManualDensityText(
                                                    sanitizeDecimalText(e.target.value)
                                                )
                                            }
                                            placeholder={t(
                                                'scanner.density_optional_placeholder',
                                                'DENSIDAD (t/m³, OPCIONAL)'
                                            )}
                                            className="w-full h-11 px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none"
                                        />
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

                        <div className="space-y-fib-13 pb-[env(safe-area-inset-bottom)]">
                            <button
                                type="button"
                                onClick={() => void handleSaveCapture()}
                                disabled={isSaving || isScanningSpatial}
                                aria-label={t('scanner.save_measurement_btn', 'GUARDAR MEDICIÓN')}
                                className="w-full min-h-[68px] px-fib-21 bg-[#00AEEF] hover:bg-[#0099d4] text-white font-mono text-[20px] font-bold uppercase border-0 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                            >
                                {t('scanner.save_measurement_btn', 'GUARDAR MEDICIÓN')}
                            </button>
                            <button
                                type="button"
                                onClick={clearCapturedMedia}
                                disabled={isSaving || isScanningSpatial}
                                className="w-full min-h-[56px] px-fib-21 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-[18px] font-bold uppercase cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                            >
                                {t('scanner.discard_retry_btn', 'DESCARTAR Y REPETIR')}
                            </button>
                        </div>
                    </div>
                )}

                {stage === 'READY' && isSpatialCapable && (
                    <div className="flex-1 flex flex-col justify-between gap-fib-21">
                        <div className="space-y-fib-21 pt-fib-13">
                            <div className="pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                <span className="block font-mono text-[22px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                    {displayStockpileName}
                                </span>
                                <span
                                    className={`block font-mono tabular-nums text-data-dense font-bold uppercase ${
                                        calValid ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                    }`}
                                >
                                    {calValid && calibration
                                        ? `${t('scanner.ready_cal_factor_prefix', 'CAL')} ×${calibration.scaleFactor.toFixed(3)}`
                                        : t('scanner.ready_uncalibrated', 'SIN CALIBRAR')}
                                </span>
                            </div>
                        </div>

                        <div className="pb-[env(safe-area-inset-bottom)]">
                            <button
                                type="button"
                                onClick={() => void handleStartSpatialScan()}
                                disabled={isSaving || isScanningSpatial}
                                aria-label={t('scanner.measure_volume_btn', 'MEDIR VOLUMEN')}
                                className="w-full min-h-[68px] px-fib-21 bg-[#C68346] hover:bg-[#b5753b] active:bg-[#9c6330] text-white font-mono text-[22px] font-bold uppercase border-0 flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                            >
                                {t('scanner.measure_volume_btn', 'MEDIR VOLUMEN')}
                            </button>
                        </div>
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

                        <div className="pb-[env(safe-area-inset-bottom)]">
                            <button
                                type="button"
                                onClick={() => void handleSaveCapture()}
                                disabled={!photoBlob || isSaving}
                                aria-label={t('common.save_button', 'GUARDAR')}
                                className="w-full min-h-[64px] bg-[#00AEEF] text-white font-mono text-[20px] font-bold uppercase border-0 cursor-pointer disabled:opacity-35 rounded-none shadow-none"
                            >
                                {t('common.save_button', 'GUARDAR')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
