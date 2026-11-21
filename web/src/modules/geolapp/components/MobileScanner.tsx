import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueueEngine, type GeolappSpatialSyncPayload } from '../../../core/offline/SyncQueueEngine';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import { dataService } from '../core/services/DataService';
import { storageService, type UploadResult } from '../core/services/StorageService';
import { geolappDigitalAiService } from '../core/services/GeolappDigitalAiService';
import { useSpatialDeviceCapability } from '../core/services/spatialDeviceCapability';
import {
    analyzeSpatialScan,
    saveOfflineSpatialPayload,
    startNativeSpatialScan,
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
    type CasTelemetryMetrics,
    InlineStatusBanner,
    type InlineStatusMessage,
    computeCasMetrics,
    dataUrlToBlob,
    formatCasSize,
} from '../core/utils/captureHelpers';
import type { GeolappAnalysisStatus, StockpileAsset } from '../core/types/GeolappTypes';

export interface MobileScannerProps {
    assetId?: string;
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

const XCOVER_ALLOWED_CODES = [
    XCOVER_HARDWARE_KEY_CODES.XCOVER_SIDE_KEY,
    XCOVER_HARDWARE_KEY_CODES.XCOVER_TOP_KEY,
    XCOVER_HARDWARE_KEY_CODES.F1,
    XCOVER_HARDWARE_KEY_CODES.CAMERA,
] as const;

const MAX_EXTRA_PHOTOS = 3;

export const MobileScanner: React.FC<MobileScannerProps> = ({
    assetId,
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

    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const extraInputRef = useRef<HTMLInputElement>(null);
    const galleryTargetRef = useRef<'PRIMARY' | 'EXTRA'>('PRIMARY');
    const latestUrlsRef = useRef<{ primary: string | null; extras: string[] }>({
        primary: null,
        extras: [],
    });

    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [extraPhotos, setExtraPhotos] = useState<Array<{ blob: Blob; previewUrl: string }>>([]);
    const [spatialScan, setSpatialScan] = useState<SpatialScanNativeResult | null>(null);
    const [casMetrics, setCasMetrics] = useState<CasTelemetryMetrics | null>(null);

    const [isScanningSpatial, setIsScanningSpatial] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isRequestingArCore, setIsRequestingArCore] = useState<boolean>(false);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
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

    const processPrimaryBlob = useCallback(async (rawBlob: Blob) => {
        const previewUrl = URL.createObjectURL(rawBlob);
        setPhotoBlob(rawBlob);
        setPhotoPreview((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return previewUrl;
        });
        setStatusMessage(null);
        void triggerFieldImpact('MEDIUM');

        try {
            const digested = await mediaDigestorClient.digestFile(rawBlob, 'IMAGE_FIELD_EVIDENCE');
            setCasMetrics(
                computeCasMetrics(
                    digested.originalBytes,
                    digested.optimizedBytes,
                    undefined,
                    true
                )
            );
        } catch {
            setCasMetrics(null);
        }
    }, []);

    const processExtraBlob = useCallback(async (rawBlob: Blob) => {
        const previewUrl = URL.createObjectURL(rawBlob);
        setExtraPhotos((prev) => [...prev.slice(0, MAX_EXTRA_PHOTOS - 1), { blob: rawBlob, previewUrl }]);
        void triggerFieldImpact('LIGHT');
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

    const handleStartSpatialScan = useCallback(async () => {
        if (isSaving || isScanningSpatial || !isSpatialCapable) return;
        setIsScanningSpatial(true);
        setStatusMessage(null);
        void triggerFieldImpact('MEDIUM');

        try {
            const { scan, photoBlobs } = await startNativeSpatialScan();
            if (scan.cancelled) {
                return;
            }
            setSpatialScan(scan);

            if (photoBlobs.length > 0) {
                await processPrimaryBlob(photoBlobs[0]);
                const nextExtras = photoBlobs
                    .slice(1, 1 + MAX_EXTRA_PHOTOS)
                    .map((blob) => ({
                        blob,
                        previewUrl: URL.createObjectURL(blob),
                    }));
                setExtraPhotos((prev) => {
                    prev.forEach((p) => {
                        if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
                    });
                    return nextExtras;
                });
            } else {
                setPhotoBlob(null);
                setCasMetrics(null);
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
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err || '');
            setStatusMessage({
                severity: 'error',
                text: msg || t('digital_v2.save_error', 'ERROR'),
            });
            void triggerFieldNotification('ERROR');
        } finally {
            setIsScanningSpatial(false);
        }
    }, [isSaving, isScanningSpatial, isSpatialCapable, processPrimaryBlob, t]);

    const handleCaptureSource = useCallback(
        async (source: 'CAMERA' | 'PHOTOS', target: 'PRIMARY' | 'EXTRA') => {
            if (isSaving || isScanningSpatial) return;
            if (target === 'EXTRA' && extraPhotos.length >= MAX_EXTRA_PHOTOS) return;
            if (source === 'CAMERA' && target === 'PRIMARY' && isSpatialCapable) {
                await handleStartSpatialScan();
                return;
            }
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
                        if (target === 'PRIMARY') {
                            setSpatialScan(null);
                            await processPrimaryBlob(rawBlob);
                        } else {
                            await processExtraBlob(rawBlob);
                        }
                        return;
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err || '');
                    if (/cancel/i.test(msg)) return;
                }
            }

            if (source === 'PHOTOS') {
                galleryTargetRef.current = target;
                galleryInputRef.current?.click();
            } else if (target === 'EXTRA') {
                extraInputRef.current?.click();
            } else {
                cameraInputRef.current?.click();
            }
        },
        [
            extraPhotos.length,
            handleStartSpatialScan,
            isSaving,
            isScanningSpatial,
            isSpatialCapable,
            processExtraBlob,
            processPrimaryBlob,
        ]
    );

    useXCoverHardwareKey(
        () => {
            if (!photoBlob && !(spatialScan && !spatialScan.cancelled && (spatialScan.pointsM?.length ?? 0) >= 20)) {
                void handleCaptureSource('CAMERA', 'PRIMARY');
            } else if (extraPhotos.length < MAX_EXTRA_PHOTOS) {
                void handleCaptureSource('CAMERA', 'EXTRA');
            }
        },
        {
            enabled: !isSaving && !isScanningSpatial,
            action: 'DOWN',
            keyCodes: XCOVER_ALLOWED_CODES,
        }
    );

    const handleFileChange = async (
        e: React.ChangeEvent<HTMLInputElement>,
        target: 'PRIMARY' | 'EXTRA'
    ) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (target === 'PRIMARY') {
            setSpatialScan(null);
            await processPrimaryBlob(file);
        } else {
            await processExtraBlob(file);
        }
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
    const hasCaptureReady = Boolean(photoBlob || hasSpatialPoints);

    const handleSaveCapture = async () => {
        if (isSaving || isScanningSpatial) return;
        if (!hasCaptureReady) {
            setStatusMessage({
                severity: 'error',
                text: t('digital_v2.photo_required', 'FOTO REQUERIDA'),
            });
            void triggerFieldNotification('ERROR');
            return;
        }

        setIsSaving(true);
        setUploadProgress(15);
        setStatusMessage(null);

        try {
            const now = Date.now();
            const targetAssetId = isNewAssetMode ? `asset_${now}` : assetId!;
            const activeTenantId =
                typeof window !== 'undefined'
                    ? window.localStorage.getItem('minreport_active_account_id')?.trim() || undefined
                    : undefined;

            let primaryUpload: UploadResult | null = null;
            if (photoBlob) {
                primaryUpload = await storageService.uploadStockpileImage(
                    photoBlob,
                    targetAssetId,
                    { filename: `capture_${now}.webp`, tenantId: activeTenantId },
                    (pct) => setUploadProgress(15 + Math.round(pct * 0.25))
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

            setUploadProgress(45);

            let resolvedSpatial: SpatialAnalyzeResult | null = null;
            let resolvedAi = null;

            if (hasSpatialPoints && spatialScan) {
                if (isOnline) {
                    resolvedSpatial = await analyzeSpatialScan({
                        stockpileId: isNewAssetMode ? undefined : assetId,
                        tenantId: activeTenantId,
                        scan: spatialScan,
                        primaryBlob: photoBlob ?? undefined,
                        extraBlobs: extraPhotos.map((p) => p.blob),
                        photoUrl: primaryUpload?.url,
                        locale: resolvedLocale,
                    }).catch(() => null);
                }
            } else if (isOnline && photoBlob) {
                resolvedAi = await geolappDigitalAiService
                    .analyzeCapture({
                        stockpileId: isNewAssetMode ? undefined : assetId,
                        tenantId: activeTenantId,
                        photoBlob,
                        extraBlobs: extraPhotos.map((p) => p.blob),
                        scaleAnchorType: 'NONE',
                        imuPitchDeg: imu.pitchDeg,
                        imuRollDeg: imu.rollDeg,
                        locale: resolvedLocale,
                    })
                    .catch(() => null);
            }

            setUploadProgress(80);
            const isSpatialFlow = Boolean(hasSpatialPoints && spatialScan);
            const hasSpatialVerified = Boolean(
                isSpatialFlow && resolvedSpatial?.verified && resolvedSpatial.volumeM3 > 0
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
                ? resolvedSpatial!.volumeM3
                : resolvedAi && resolvedAi.scaleVerified && resolvedAi.volumeM3 > 0
                  ? resolvedAi.volumeM3
                  : 0;
            const finalWeightT = hasSpatialVerified
                ? resolvedSpatial!.weightT
                : resolvedAi && resolvedAi.scaleVerified && resolvedAi.weightT > 0
                  ? resolvedAi.weightT
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

            const resolvedGeometry = resolvedSpatial?.dimensionsM
                ? {
                      type: resolvedSpatial.geometryType,
                      dimensions: resolvedSpatial.dimensionsM,
                  }
                : resolvedAi?.dimensionsM
                  ? {
                        type: resolvedAi.geometryType,
                        dimensions: resolvedAi.dimensionsM,
                    }
                  : undefined;

            const measurementBasePayload = {
                timestamp: now,
                captured_at: now,
                volumen_m3: finalVolumeM3,
                peso_t: finalWeightT,
                density_factor:
                    resolvedSpatial?.suggestedDensityTm3 ??
                    resolvedAi?.suggestedDensityTm3 ??
                    undefined,
                photo_url: primaryUpload?.url || '',
                perimeter_photo_urls: extraUploads.map((item) => item.url),
                method: 'digital' as const,
                cas_original_bytes: primaryUpload?.originalBytes ?? casMetrics?.originalBytes,
                cas_optimized_bytes: primaryUpload?.optimizedBytes ?? casMetrics?.optimizedBytes,
                cas_savings_pct: primaryUpload?.savingsPct ?? casMetrics?.savingsPct,
                copper_domain: resolvedSpatial?.copperDomain ?? resolvedAi?.copperDomain ?? undefined,
                geometry: resolvedGeometry,
                analysis_status: analysisStatus,
                scale_anchor_type: scaleAnchorType,
                uncertainty_pct: isSpatialFlow
                    ? (resolvedSpatial?.uncertaintyPct ?? null)
                    : undefined,
                toe_score: isSpatialFlow ? (resolvedSpatial?.toeScore ?? null) : undefined,
                coverage_pct: isSpatialFlow
                    ? (resolvedSpatial?.coveragePct ?? spatialScan?.coveragePct ?? null)
                    : undefined,
                depth_mode: isSpatialFlow
                    ? (resolvedSpatial?.depthMode ?? spatialScan?.depthMode ?? null)
                    : undefined,
                ground_slope_deg: isSpatialFlow
                    ? (resolvedSpatial?.groundSlopeDeg ?? null)
                    : undefined,
                mesh_url: resolvedSpatial?.meshUrl ?? undefined,
                mesh_sha256: resolvedSpatial?.meshSha256 ?? undefined,
                mesh_source: resolvedSpatial?.meshSource ?? undefined,
                detected_slope_angle_deg:
                    resolvedSpatial?.slopeAngleAvgDeg ??
                    resolvedAi?.slopeAngleAvgDeg ??
                    undefined,
                slope_left_deg:
                    resolvedSpatial?.slopeAngleLeftDeg ??
                    resolvedAi?.slopeAngleLeftDeg ??
                    undefined,
                slope_right_deg:
                    resolvedSpatial?.slopeAngleRightDeg ??
                    resolvedAi?.slopeAngleRightDeg ??
                    undefined,
                slope_warning: resolvedSpatial?.slopeWarning ?? resolvedAi?.slopeWarning ?? null,
                wall_confinement:
                    resolvedSpatial?.wallConfinement ?? resolvedAi?.wallConfinement,
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
                        clase: 'mineral',
                        status: 'ACTIVE',
                        ...(safeGeo ? { geo_point: safeGeo } : {}),
                        location_ref: draftAsset?.undergroundSector || undefined,
                        gnss_status: draftAsset?.gnssStatus,
                        underground_sector: draftAsset?.undergroundSector,
                        captured_at: now,
                        copper_domain:
                            resolvedSpatial?.copperDomain ?? resolvedAi?.copperDomain ?? undefined,
                        tipo_granulometria:
                            resolvedSpatial?.granulometry ?? resolvedAi?.granulometry ?? undefined,
                        density_factor:
                            resolvedSpatial?.suggestedDensityTm3 ??
                            resolvedAi?.suggestedDensityTm3 ??
                            undefined,
                        analysis_status: analysisStatus,
                        scale_anchor_type: scaleAnchorType,
                        uncertainty_pct: isSpatialFlow
                            ? (resolvedSpatial?.uncertaintyPct ?? null)
                            : undefined,
                        toe_score: isSpatialFlow ? (resolvedSpatial?.toeScore ?? null) : undefined,
                        coverage_pct: isSpatialFlow
                            ? (resolvedSpatial?.coveragePct ?? spatialScan?.coveragePct ?? null)
                            : undefined,
                        depth_mode: isSpatialFlow
                            ? (resolvedSpatial?.depthMode ?? spatialScan?.depthMode ?? null)
                            : undefined,
                        ground_slope_deg: isSpatialFlow
                            ? (resolvedSpatial?.groundSlopeDeg ?? null)
                            : undefined,
                        mesh_url: resolvedSpatial?.meshUrl ?? undefined,
                        mesh_sha256: resolvedSpatial?.meshSha256 ?? undefined,
                        mesh_source: resolvedSpatial?.meshSource ?? undefined,
                        detected_slope_angle_deg:
                            resolvedSpatial?.slopeAngleAvgDeg ??
                            resolvedAi?.slopeAngleAvgDeg ??
                            undefined,
                        slope_warning:
                            resolvedSpatial?.slopeWarning ?? resolvedAi?.slopeWarning ?? null,
                        wall_confinement:
                            resolvedSpatial?.wallConfinement ?? resolvedAi?.wallConfinement,
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

            if (isSpatialFlow && !hasSpatialVerified && spatialScan) {
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
            setStatusMessage({
                severity: 'error',
                text: msg || t('digital_v2.save_error', 'ERROR'),
            });
            void triggerFieldNotification('ERROR');
        } finally {
            setIsSaving(false);
        }
    };

    const casCompactLabel = useMemo(() => {
        if (casMetrics) {
            return `${formatCasSize(casMetrics.originalBytes)} -> ${formatCasSize(casMetrics.optimizedBytes)} (-${casMetrics.savingsPct.toFixed(0)}%)`;
        }
        if (photoBlob && photoBlob.size > 0) {
            return formatCasSize(photoBlob.size);
        }
        return null;
    }, [casMetrics, photoBlob]);

    const totalPhotosCount = (photoPreview ? 1 : 0) + extraPhotos.length;
    const maxPhotosTotal = 1 + MAX_EXTRA_PHOTOS;

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
                    <h2 className="flex-1 text-h2-section font-mono font-bold uppercase truncate">
                        {draftAsset?.name || t('scanner.title', 'CAPTURA')}
                    </h2>
                    <span className="material-symbols-outlined text-[22px] text-[#00AEEF]">
                        photo_camera
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
                onChange={(e) => void handleFileChange(e, 'PRIMARY')}
                className="hidden"
            />
            <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => void handleFileChange(e, galleryTargetRef.current)}
                className="hidden"
            />
            <input
                ref={extraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => void handleFileChange(e, 'EXTRA')}
                className="hidden"
            />

            {/* Compatibilidad Hardware Espacial ARCore VIO / Depth (solo nativo Android) */}
            {isNativeRuntime && capability?.tier === 'INCOMPATIBLE' && (
                <div
                    role="alert"
                    className="shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] border-l-[#C68346] flex items-start gap-fib-8 bg-transparent"
                >
                    <span className="material-symbols-outlined text-[18px] text-[#C68346] shrink-0">
                        warning
                    </span>
                    <div className="min-w-0 flex-1 font-mono text-microcopy">
                        <span className="block font-bold uppercase text-[#C68346] truncate">
                            {t('compatibility.mobile_incompatible_banner', 'DISPOSITIVO INCOMPATIBLE ARCORE')}
                        </span>
                        <span className="block text-[#475569] dark:text-[#8A93A6] truncate">
                            {[
                                `${capability.manufacturer} ${capability.model}`.trim(),
                                capability.reasons.join(' · '),
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </div>
                </div>
            )}

            {isNativeRuntime && capability?.tier === 'NEEDS_UPDATE' && (
                <div
                    role="status"
                    className="shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] border-l-[#C68346] flex items-center justify-between gap-fib-8 bg-transparent"
                >
                    <div className="flex items-center gap-fib-8 min-w-0">
                        <span className="material-symbols-outlined text-[18px] text-[#C68346] shrink-0">
                            system_update
                        </span>
                        <span className="font-mono text-microcopy font-bold uppercase text-[#C68346] truncate">
                            {t('compatibility.mobile_update_arcore', 'ACTUALIZAR SERVICIOS AR')}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleRequestArCoreInstall()}
                        disabled={isRequestingArCore}
                        className="min-h-[48px] px-fib-13 bg-transparent border border-[#C68346] text-[#C68346] font-mono text-microcopy font-bold uppercase cursor-pointer disabled:opacity-40 rounded-none shrink-0"
                    >
                        ARCore
                    </button>
                </div>
            )}

            {isNativeRuntime &&
                (capability?.tier === 'OPTIMAL_SPATIAL' || capability?.tier === 'COMPATIBLE_VIO') && (
                    <div className="shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] border-l-[#00AEEF] flex items-center justify-between gap-fib-8 bg-transparent font-mono text-microcopy tabular-nums">
                        <span className="font-bold uppercase text-[#00AEEF] truncate">
                            {capability.tier === 'OPTIMAL_SPATIAL'
                                ? t('compatibility.mobile_optimal_badge', 'ARCORE · DEPTH')
                                : 'ARCORE VIO'}
                        </span>
                        <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                            {`${capability.manufacturer} ${capability.model}`.trim()}
                        </span>
                    </div>
                )}

            {hasSpatialPoints && spatialScan && (
                <div
                    className={`shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] ${
                        (spatialScan.coveragePct ?? 0) >= 75
                            ? 'border-l-[#00AEEF]'
                            : 'border-l-[#C68346]'
                    } flex items-center justify-between gap-fib-8 bg-transparent font-mono text-microcopy tabular-nums`}
                >
                    <div className="flex items-center gap-fib-8 min-w-0">
                        <span className="material-symbols-outlined text-[18px] text-[#00AEEF] shrink-0">
                            view_in_ar
                        </span>
                        <span className="font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {t('scanner.spatial_coverage_label', 'COBERTURA')}{' '}
                            {Math.round(spatialScan.coveragePct ?? 0)}%
                        </span>
                    </div>
                    <span className="text-[#475569] dark:text-[#8A93A6] uppercase shrink-0">
                        {spatialScan.sectorsCovered ?? 0}/16 ·{' '}
                        {spatialScan.depthMode === 'RAW_DEPTH_ONLY'
                            ? 'RAW_DEPTH'
                            : spatialScan.depthMode === 'AUTOMATIC'
                              ? 'DEPTH'
                              : 'VIO'}
                    </span>
                </div>
            )}

            {isSaving && (
                <div className="shrink-0 px-fib-13 py-fib-8 border-b border-[#00AEEF] bg-transparent space-y-fib-8">
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="flex items-center gap-fib-8">
                            <M3CircularProgress
                                size={18}
                                value={uploadProgress}
                                ariaLabel={t('digital_v2.saving_progress', 'Guardando captura')}
                            />
                            <span className="text-microcopy font-mono font-bold uppercase text-[#00AEEF]">
                                CAS
                            </span>
                        </div>
                        <span className="text-microcopy font-mono font-bold tabular-nums text-[#00AEEF]">
                            {uploadProgress}%
                        </span>
                    </div>
                    <M3LinearProgress
                        value={uploadProgress}
                        ariaLabel={t('digital_v2.progress_aria', 'Progreso de captura')}
                    />
                </div>
            )}

            {statusMessage && (
                <div className="shrink-0 px-fib-13 pt-fib-8">
                    <InlineStatusBanner
                        message={statusMessage}
                        onDismiss={() => setStatusMessage(null)}
                    />
                </div>
            )}

            {/* Lienzo Central Limpio */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                {!photoPreview && !hasSpatialPoints ? (
                    <div className="flex-1 flex items-center justify-center p-fib-34 bg-[#FFFFFF] dark:bg-[#000000]">
                        <button
                            type="button"
                            onClick={() => void handleCaptureSource('CAMERA', 'PRIMARY')}
                            disabled={isSaving || isScanningSpatial}
                            aria-label={
                                isSpatialCapable
                                    ? t('scanner.spatial_scan_btn', 'ESCANEAR 3D')
                                    : t('digital_v2.capture_primary_btn', 'TOMAR FOTO ACOPIO')
                            }
                            className="min-w-[80px] min-h-[80px] bg-transparent border-0 outline-none text-[#C68346] hover:opacity-75 flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                        >
                            <span className="material-symbols-outlined text-[48px] leading-none">
                                {isSpatialCapable ? 'view_in_ar' : 'photo_camera'}
                            </span>
                        </button>
                    </div>
                ) : !photoPreview && hasSpatialPoints && spatialScan ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-fib-13 p-fib-34 bg-[#FFFFFF] dark:bg-[#000000] font-mono tabular-nums">
                        <span className="material-symbols-outlined text-[48px] text-[#00AEEF] leading-none">
                            view_in_ar
                        </span>
                        <span className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                            {spatialScan.pointsM?.length ?? 0} PTS ·{' '}
                            {Math.round(spatialScan.coveragePct ?? 0)}%
                        </span>
                    </div>
                ) : photoPreview ? (
                    <>
                        <div className="relative w-full h-64 shrink-0 bg-[#000000] overflow-hidden border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <SecureImage
                                src={photoPreview}
                                alt={t('digital_v2.photo_alt', 'Captura acopio')}
                                className="w-full h-full object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => void handleCaptureSource('CAMERA', 'PRIMARY')}
                                disabled={isSaving || isScanningSpatial}
                                aria-label={t('digital_v2.retake_btn', 'RECAPTURAR')}
                                className="min-w-[48px] min-h-[48px] absolute top-2 right-2 bg-[#000000]/75 border-0 text-white hover:text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[22px]">refresh</span>
                            </button>
                        </div>

                        {casCompactLabel && (
                            <div className="shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums">
                                <span className="font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                    CAS
                                </span>
                                <span className="font-bold text-[#00AEEF]">{casCompactLabel}</span>
                            </div>
                        )}

                        <div className="shrink-0 px-fib-13 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8 overflow-x-auto">
                            <div className="relative w-14 h-14 shrink-0 border-2 border-[#C68346] bg-[#000000] rounded-none">
                                <SecureImage
                                    src={photoPreview}
                                    alt={`1/${maxPhotosTotal}`}
                                    className="w-full h-full object-cover"
                                />
                                <span className="absolute bottom-0 left-0 px-1 bg-[#000000]/80 font-mono text-microcopy font-bold tabular-nums text-white leading-tight">
                                    1/{maxPhotosTotal}
                                </span>
                            </div>

                            {extraPhotos.map((extra, idx) => (
                                <div
                                    key={`${extra.previewUrl}_${idx}`}
                                    className="relative w-14 h-14 shrink-0 border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] rounded-none"
                                >
                                    <SecureImage
                                        src={extra.previewUrl}
                                        alt={`${idx + 2}/${maxPhotosTotal}`}
                                        className="w-full h-full object-cover"
                                    />
                                    <span className="absolute bottom-0 left-0 px-1 bg-[#000000]/80 font-mono text-microcopy font-bold tabular-nums text-white leading-tight">
                                        {idx + 2}/{maxPhotosTotal}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setExtraPhotos((prev) => {
                                                const removed = prev[idx];
                                                if (
                                                    removed &&
                                                    removed.previewUrl.startsWith('blob:')
                                                ) {
                                                    URL.revokeObjectURL(removed.previewUrl);
                                                }
                                                return prev.filter((_, i) => i !== idx);
                                            })
                                        }
                                        aria-label={t('common.delete_button', 'ELIMINAR')}
                                        className="w-6 h-6 absolute top-0 right-0 bg-[#000000]/85 text-white border-0 flex items-center justify-center cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">
                                            close
                                        </span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                ) : null}
            </div>

            {/* Barra inferior fija: 3 controles estrictos */}
            <footer className="shrink-0 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] pb-[env(safe-area-inset-bottom)]">
                <div className="min-h-[80px] px-fib-13 grid grid-cols-3 items-center gap-fib-8">
                    <button
                        type="button"
                        onClick={() =>
                            void handleCaptureSource(
                                'PHOTOS',
                                photoBlob ? 'EXTRA' : 'PRIMARY'
                            )
                        }
                        disabled={
                            isSaving ||
                            isScanningSpatial ||
                            (Boolean(photoBlob) && extraPhotos.length >= MAX_EXTRA_PHOTOS)
                        }
                        aria-label={t('digital_v2.gallery_btn', 'GALERÍA')}
                        className="min-w-[56px] min-h-[56px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] flex items-center justify-center cursor-pointer disabled:opacity-35 rounded-none"
                    >
                        <span className="material-symbols-outlined text-[24px]">
                            photo_library
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            void handleCaptureSource(
                                'CAMERA',
                                photoBlob ? 'EXTRA' : 'PRIMARY'
                            )
                        }
                        disabled={
                            isSaving ||
                            isScanningSpatial ||
                            (Boolean(photoBlob) && extraPhotos.length >= MAX_EXTRA_PHOTOS)
                        }
                        aria-label={
                            isSpatialCapable && !photoBlob
                                ? t('scanner.spatial_scan_btn', 'ESCANEAR 3D')
                                : t('digital_v2.capture_primary_btn', 'DISPARAR')
                        }
                        className="relative w-16 h-16 mx-auto bg-[#C68346] hover:bg-[#b5753b] active:bg-[#9c6330] text-white border-0 flex flex-col items-center justify-center cursor-pointer disabled:opacity-35 rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[28px] leading-none">
                            {isSpatialCapable && !photoBlob ? 'view_in_ar' : 'photo_camera'}
                        </span>
                        {totalPhotosCount >= 1 && (
                            <span className="text-microcopy font-mono font-bold tabular-nums leading-none mt-0.5">
                                {totalPhotosCount}/{maxPhotosTotal}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => void handleSaveCapture()}
                        disabled={!hasCaptureReady || isSaving || isScanningSpatial}
                        aria-label={t('common.save_button', 'GUARDAR')}
                        className={`min-w-[56px] min-h-[56px] bg-transparent border-0 flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-35 rounded-none font-mono text-microcopy font-bold uppercase tabular-nums ${
                            hasCaptureReady ? 'text-[#00AEEF]' : 'text-[#475569] dark:text-[#8A93A6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[24px]">check</span>
                        <span>{t('common.save_button', 'GUARDAR')}</span>
                    </button>
                </div>
            </footer>
        </div>
    );
};
