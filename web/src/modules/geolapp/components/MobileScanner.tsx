import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import { SovereignVoiceInput } from '../../../components/common/SovereignVoiceInput';
import SecureImage from '../../../components/common/SecureImage';
import { dataService } from '../core/services/DataService';
import { storageService } from '../core/services/StorageService';
import {
    geolappDigitalAiService,
    type DigitalAnalyzeResult,
} from '../core/services/GeolappDigitalAiService';
import type { Granulometry } from '../core/services/vision-ia';
import { useImuClinometer } from '../core/hooks/useImuClinometer';
import {
    useXCoverHardwareKey,
    XCOVER_HARDWARE_KEY_CODES,
} from '../core/hooks/useXCoverHardwareKey';
import { triggerFieldImpact, triggerFieldNotification } from '../core/utils/fieldHaptics';
import {
    parseSpokenStockpileSpecs,
    type SpokenStockpileSpecs,
} from '../core/utils/spokenStockpileParser';
import {
    type CasTelemetryMetrics,
    InlineStatusBanner,
    type InlineStatusMessage,
    computeCasMetrics,
    dataUrlToBlob,
    formatCasSize,
    parseOptionalNonNegative,
} from '../core/utils/captureHelpers';
import type {
    GeolappAnalysisStatus,
    GeolappDigitalScaleAnchorType,
    StockpileAsset,
} from '../core/types/GeolappTypes';
import { FieldNumPad } from './FieldNumPad';

export { parseSpokenStockpileSpecs, type SpokenStockpileSpecs, type Granulometry };

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

const ANCHOR_OPTIONS: Array<{
    id: GeolappDigitalScaleAnchorType;
    meters?: number;
    icon: string;
    labelKey: string;
    fallbackLabel: string;
    shortTag: string;
}> = [
    {
        id: 'CONO_070',
        meters: 0.7,
        icon: 'traffic',
        labelKey: 'digital_v2.anchor_cone',
        fallbackLabel: 'CONO',
        shortTag: '0.7',
    },
    {
        id: 'MIRA_100',
        meters: 1.0,
        icon: 'straighten',
        labelKey: 'digital_v2.anchor_rod',
        fallbackLabel: 'MIRA',
        shortTag: '1.0',
    },
    {
        id: 'BALDE_280',
        meters: 2.8,
        icon: 'front_loader',
        labelKey: 'digital_v2.anchor_bucket',
        fallbackLabel: 'BALDE',
        shortTag: '2.8',
    },
    {
        id: 'MANUAL_BASE_M',
        icon: 'edit',
        labelKey: 'digital_v2.anchor_manual',
        fallbackLabel: 'BASE',
        shortTag: 'm',
    },
    {
        id: 'NONE',
        icon: 'auto_awesome',
        labelKey: 'digital_v2.anchor_none',
        fallbackLabel: 'AUTO',
        shortTag: '',
    },
];

function playImuLevelCue880Hz(): void {
    if (typeof window === 'undefined') return;
    try {
        const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.06, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
            setTimeout(() => {
                void ctx.close().catch(() => {});
            }, 250);
        }
    } catch {
        // Audio bloqueado por política de navegador
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(40);
    }
    void triggerFieldImpact('LIGHT');
}

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

    const isNewAssetMode = Boolean(!assetId && draftAsset);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const extraInputRef = useRef<HTMLInputElement>(null);
    const lastLevelCueAtRef = useRef<number>(0);
    const wasLeveledRef = useRef<boolean>(false);

    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [extraPhotos, setExtraPhotos] = useState<Array<{ blob: Blob; previewUrl: string }>>([]);
    const [casMetrics, setCasMetrics] = useState<CasTelemetryMetrics | null>(null);

    const [scaleAnchorType, setScaleAnchorType] =
        useState<GeolappDigitalScaleAnchorType>('CONO_070');
    const [referenceBaseText, setReferenceBaseText] = useState<string>('');
    const [showNumPad, setShowNumPad] = useState<boolean>(false);

    const [digitalResult, setDigitalResult] = useState<DigitalAnalyzeResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [statusMessage, setStatusMessage] = useState<InlineStatusMessage | null>(null);

    const resolvedLocale: 'es' | 'en' | 'pt' = useMemo(() => {
        const raw = (i18n.resolvedLanguage || i18n.language || 'es').slice(0, 2);
        return raw === 'en' || raw === 'pt' ? raw : 'es';
    }, [i18n.language, i18n.resolvedLanguage]);

    const parsedReferenceBase = useMemo(
        () => parseOptionalNonNegative(referenceBaseText, 5000),
        [referenceBaseText]
    );

    const selectedAnchorMeters = useMemo(() => {
        const opt = ANCHOR_OPTIONS.find((item) => item.id === scaleAnchorType);
        return opt?.meters;
    }, [scaleAnchorType]);

    const isImuLevelOptimal = useMemo(() => {
        if (imu.pitchDeg === null || imu.rollDeg === null) return false;
        return Math.abs(imu.rollDeg) <= 3 && Math.abs(imu.pitchDeg) <= 12;
    }, [imu.pitchDeg, imu.rollDeg]);

    useEffect(() => {
        if (imu.isSupported) {
            void imu.startListening();
        }
        return () => {
            void imu.stopListening();
        };
    }, []);

    useEffect(() => {
        if (!photoPreview && isImuLevelOptimal && !wasLeveledRef.current) {
            const now = Date.now();
            if (now - lastLevelCueAtRef.current >= 2500) {
                lastLevelCueAtRef.current = now;
                playImuLevelCue880Hz();
            }
        }
        wasLeveledRef.current = isImuLevelOptimal;
    }, [isImuLevelOptimal, photoPreview]);

    const processPrimaryBlob = useCallback(async (rawBlob: Blob) => {
        const previewUrl = URL.createObjectURL(rawBlob);
        setPhotoBlob(rawBlob);
        setPhotoPreview((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return previewUrl;
        });
        setDigitalResult(null);
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
        setExtraPhotos((prev) => [...prev.slice(0, 2), { blob: rawBlob, previewUrl }]);
        setDigitalResult(null);
        void triggerFieldImpact('LIGHT');
    }, []);

    useEffect(() => {
        return () => {
            if (photoPreview && photoPreview.startsWith('blob:')) {
                URL.revokeObjectURL(photoPreview);
            }
            extraPhotos.forEach((p) => {
                if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
            });
        };
    }, [extraPhotos, photoPreview]);

    const handleCaptureSource = useCallback(
        async (source: 'CAMERA' | 'PHOTOS', target: 'PRIMARY' | 'EXTRA') => {
            if (isSaving || isAnalyzing) return;
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

            if (target === 'EXTRA') {
                extraInputRef.current?.click();
            } else if (source === 'CAMERA') {
                cameraInputRef.current?.click();
            } else {
                galleryInputRef.current?.click();
            }
        },
        [isAnalyzing, isSaving, processExtraBlob, processPrimaryBlob]
    );

    useXCoverHardwareKey(
        () => {
            if (!photoBlob) {
                void handleCaptureSource('CAMERA', 'PRIMARY');
            } else if (extraPhotos.length < 3) {
                void handleCaptureSource('CAMERA', 'EXTRA');
            }
        },
        {
            enabled: !isSaving && !isAnalyzing,
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
            await processPrimaryBlob(file);
        } else {
            await processExtraBlob(file);
        }
    };

    const handleVoiceTranscript = (transcript: string) => {
        const specs = parseSpokenStockpileSpecs(transcript);
        const spokenBase = specs.baseMajorAxis || specs.baseMinorAxis || specs.totalHeight;
        if (spokenBase) {
            setScaleAnchorType('MANUAL_BASE_M');
            setReferenceBaseText(spokenBase);
            setDigitalResult(null);
            setStatusMessage(null);
            void triggerFieldImpact('MEDIUM');
        }
    };

    const runOnlineAiAnalysis = async (): Promise<DigitalAnalyzeResult | null> => {
        if (!photoBlob || !isOnline) return null;
        setIsAnalyzing(true);
        setStatusMessage(null);
        try {
            const res = await geolappDigitalAiService.analyzeCapture({
                stockpileId: assetId,
                photoBlob,
                extraBlobs: extraPhotos.map((p) => p.blob),
                scaleAnchorType,
                scaleAnchorMeters: selectedAnchorMeters,
                referenceBaseMeters: parsedReferenceBase,
                imuPitchDeg: imu.pitchDeg,
                imuRollDeg: imu.rollDeg,
                locale: resolvedLocale,
            });
            setDigitalResult(res);
            void triggerFieldNotification(res.slopeWarning ? 'WARNING' : 'SUCCESS');
            return res;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '';
            setStatusMessage({
                severity: 'warning',
                text: msg || 'IA -> COLA',
            });
            void triggerFieldNotification('WARNING');
            return null;
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSaveCapture = async () => {
        if (isSaving || isAnalyzing) return;
        if (!photoBlob) {
            setStatusMessage({
                severity: 'error',
                text: t('digital_v2.photo_required', 'FOTO REQUERIDA'),
            });
            void triggerFieldNotification('ERROR');
            return;
        }
        if (scaleAnchorType === 'MANUAL_BASE_M' && !parsedReferenceBase) {
            setShowNumPad(true);
            setStatusMessage({
                severity: 'warning',
                text: t('digital_v2.base_dim_label', 'BASE m'),
            });
            void triggerFieldNotification('WARNING');
            return;
        }

        setIsSaving(true);
        setUploadProgress(15);
        setStatusMessage(null);

        try {
            const now = Date.now();
            const targetAssetId = isNewAssetMode ? `asset_${now}` : assetId!;

            let resolvedAi = digitalResult;
            if (isOnline && !resolvedAi) {
                resolvedAi = await geolappDigitalAiService
                    .analyzeCapture({
                        stockpileId: isNewAssetMode ? undefined : assetId,
                        photoBlob,
                        extraBlobs: extraPhotos.map((p) => p.blob),
                        scaleAnchorType,
                        scaleAnchorMeters: selectedAnchorMeters,
                        referenceBaseMeters: parsedReferenceBase,
                        imuPitchDeg: imu.pitchDeg,
                        imuRollDeg: imu.rollDeg,
                        locale: resolvedLocale,
                    })
                    .catch(() => null);
                if (resolvedAi) {
                    setDigitalResult(resolvedAi);
                }
            }

            setUploadProgress(40);
            const primaryUpload = await storageService.uploadStockpileImage(
                photoBlob,
                targetAssetId,
                { filename: `capture_${now}.webp` },
                (pct) => setUploadProgress(40 + Math.round(pct * 0.35))
            );

            const extraUploads: Array<{ url: string; sha256?: string }> = [];
            for (let i = 0; i < extraPhotos.length; i++) {
                const extraRes = await storageService.uploadStockpileImage(
                    extraPhotos[i].blob,
                    targetAssetId,
                    { filename: `angle_${i + 1}_${now}.webp` }
                );
                extraUploads.push({ url: extraRes.url, sha256: extraRes.sha256 });
            }

            setUploadProgress(80);
            const hasAiResult = Boolean(resolvedAi);
            const analysisStatus: GeolappAnalysisStatus = !hasAiResult
                ? 'PENDING_AI_SYNC'
                : resolvedAi!.scaleVerified
                  ? 'AI_VERIFIED'
                  : 'PENDING_SCALE';

            const finalVolumeM3 =
                resolvedAi && resolvedAi.scaleVerified && resolvedAi.volumeM3 > 0
                    ? resolvedAi.volumeM3
                    : 0;
            const finalWeightT =
                resolvedAi && resolvedAi.scaleVerified && resolvedAi.weightT > 0
                    ? resolvedAi.weightT
                    : 0;

            const safeGeo =
                draftAsset?.geoPoint &&
                Number.isFinite(draftAsset.geoPoint.latitude) &&
                Number.isFinite(draftAsset.geoPoint.longitude) &&
                (draftAsset.geoPoint.latitude !== 0 || draftAsset.geoPoint.longitude !== 0)
                    ? draftAsset.geoPoint
                    : undefined;

            const measurementBasePayload = {
                timestamp: now,
                captured_at: now,
                volumen_m3: finalVolumeM3,
                peso_t: finalWeightT,
                density_factor: resolvedAi?.suggestedDensityTm3 ?? undefined,
                photo_url: primaryUpload.url,
                perimeter_photo_urls: extraUploads.map((item) => item.url),
                method: 'digital' as const,
                cas_original_bytes: primaryUpload.originalBytes ?? casMetrics?.originalBytes,
                cas_optimized_bytes: primaryUpload.optimizedBytes ?? casMetrics?.optimizedBytes,
                cas_savings_pct: primaryUpload.savingsPct ?? casMetrics?.savingsPct,
                copper_domain: resolvedAi?.copperDomain ?? undefined,
                geometry:
                    resolvedAi?.dimensionsM
                        ? {
                              type: resolvedAi.geometryType,
                              dimensions: resolvedAi.dimensionsM,
                          }
                        : undefined,
                analysis_status: analysisStatus,
                scale_anchor_type: scaleAnchorType,
                scale_anchor_meters: selectedAnchorMeters,
                reference_base_meters: parsedReferenceBase,
                detected_slope_angle_deg: resolvedAi?.slopeAngleAvgDeg ?? undefined,
                slope_left_deg: resolvedAi?.slopeAngleLeftDeg ?? undefined,
                slope_right_deg: resolvedAi?.slopeAngleRightDeg ?? undefined,
                slope_warning: resolvedAi?.slopeWarning ?? null,
                wall_confinement: resolvedAi?.wallConfinement,
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
                        name: draftAsset?.name?.trim() || `STK-${String(now).slice(-6)}`,
                        ...(draftAsset?.projectId ? { project_id: draftAsset.projectId } : {}),
                        ...(draftAsset?.projectName ? { project_name: draftAsset.projectName } : {}),
                        clase: 'mineral',
                        status: 'ACTIVE',
                        ...(safeGeo ? { geo_point: safeGeo } : {}),
                        location_ref: draftAsset?.undergroundSector || undefined,
                        gnss_status: draftAsset?.gnssStatus,
                        underground_sector: draftAsset?.undergroundSector,
                        captured_at: now,
                        copper_domain: resolvedAi?.copperDomain ?? undefined,
                        tipo_granulometria: resolvedAi?.granulometry ?? undefined,
                        density_factor: resolvedAi?.suggestedDensityTm3 ?? undefined,
                        analysis_status: analysisStatus,
                        scale_anchor_type: scaleAnchorType,
                        detected_slope_angle_deg: resolvedAi?.slopeAngleAvgDeg ?? undefined,
                        slope_warning: resolvedAi?.slopeWarning ?? null,
                        wall_confinement: resolvedAi?.wallConfinement,
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

            if (analysisStatus === 'PENDING_AI_SYNC') {
                await syncQueueEngine.enqueueTask('GEOLAPP_DIGITAL_AI_ANALYZE', {
                    assetId: finalAssetId,
                    measurementId: finalMeasurementId,
                    sha256: primaryUpload.sha256,
                    extraSha256s: extraUploads
                        .map((item) => item.sha256)
                        .filter((s): s is string => Boolean(s)),
                    photoUrl: primaryUpload.url,
                    scaleAnchorType,
                    scaleAnchorMeters: selectedAnchorMeters,
                    referenceBaseMeters: parsedReferenceBase,
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
                onChange={(e) => void handleFileChange(e, 'PRIMARY')}
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

            {/* HUD IMU + Red (1 franja hairline) */}
            <div className="shrink-0 px-fib-13 h-10 border-b border-[#E2E8F0] dark:border-[#12151C] bg-transparent flex items-center justify-between gap-fib-8 font-mono text-microcopy font-bold uppercase tabular-nums">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <span
                        className={`material-symbols-outlined text-[18px] ${
                            isImuLevelOptimal ? 'text-[#00AEEF]' : 'text-[#C68346]'
                        }`}
                    >
                        screen_rotation
                    </span>
                    <span className="text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {imu.pitchDeg !== null && imu.rollDeg !== null
                            ? `${imu.pitchDeg.toFixed(1)}° · ${imu.rollDeg.toFixed(1)}°`
                            : '--° · --°'}
                    </span>
                    <span className={isImuLevelOptimal ? 'text-[#00AEEF]' : 'text-[#C68346]'}>
                        {isImuLevelOptimal
                            ? t('digital_v2.imu_level_ok', 'NIVELADO')
                            : t('digital_v2.imu_level_aim', 'ENCUADRAR')}
                    </span>
                </div>

                {!isOnline && (
                    <div className="flex items-center gap-1 text-[#C68346] shrink-0">
                        <span className="material-symbols-outlined text-[16px]">cloud_off</span>
                        <span>COLA</span>
                    </div>
                )}
            </div>

            {(isAnalyzing || isSaving) && (
                <div className="shrink-0 px-fib-13 py-fib-8 border-b border-[#00AEEF] bg-transparent space-y-fib-8">
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="flex items-center gap-fib-8">
                            <M3CircularProgress
                                size={18}
                                indeterminate={!isSaving}
                                value={isSaving ? uploadProgress : undefined}
                                ariaLabel={
                                    isSaving
                                        ? t('digital_v2.saving_progress', 'Guardando captura')
                                        : t('digital_v2.analyzing_progress', 'Analizando con IA')
                                }
                            />
                            <span className="text-microcopy font-mono font-bold uppercase text-[#00AEEF]">
                                {isSaving ? 'CAS' : 'IA'}
                            </span>
                        </div>
                        {isSaving && (
                            <span className="text-microcopy font-mono font-bold tabular-nums text-[#00AEEF]">
                                {uploadProgress}%
                            </span>
                        )}
                    </div>
                    <M3LinearProgress
                        indeterminate={!isSaving}
                        value={isSaving ? uploadProgress : undefined}
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

            {/* Visor Fotogramétrico HUD + Controles */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                {!photoPreview ? (
                    <div className="flex-1 min-h-[180px] relative flex flex-col items-center justify-center p-fib-21 bg-transparent">
                        <div
                            aria-hidden="true"
                            className={`relative w-44 h-36 flex flex-col items-center justify-center gap-fib-8 ${
                                isImuLevelOptimal ? 'text-[#00AEEF]' : 'text-[#C68346]'
                            }`}
                        >
                            <span className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-current" />
                            <span className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-current" />
                            <span className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-current" />
                            <span className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-current" />
                            <span className="material-symbols-outlined text-[40px] leading-none">
                                center_focus_weak
                            </span>
                            <span className="font-mono text-microcopy font-bold tabular-nums">
                                {imu.pitchDeg !== null && imu.rollDeg !== null
                                    ? `${imu.pitchDeg.toFixed(1)}° · ${imu.rollDeg.toFixed(1)}°`
                                    : 'HUD'}
                            </span>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="relative w-full h-56 shrink-0 bg-[#000000] overflow-hidden border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <SecureImage
                                src={photoPreview}
                                alt={t('digital_v2.photo_alt', 'Captura acopio')}
                                className="w-full h-full object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => void handleCaptureSource('CAMERA', 'PRIMARY')}
                                aria-label={t('digital_v2.retake_btn', 'RECAPTURAR')}
                                className="min-w-[48px] min-h-[48px] absolute top-2 right-2 bg-[#000000]/70 border-0 text-white hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none"
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

                        {extraPhotos.length > 0 && (
                            <div className="shrink-0 px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8 overflow-x-auto">
                                {extraPhotos.map((extra, idx) => (
                                    <div
                                        key={`${extra.previewUrl}_${idx}`}
                                        className="relative w-12 h-12 shrink-0 border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] rounded-none"
                                    >
                                        <SecureImage
                                            src={extra.previewUrl}
                                            alt={`ANG-${idx + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setExtraPhotos((prev) =>
                                                    prev.filter((_, i) => i !== idx)
                                                )
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
                        )}
                    </>
                )}

                {/* Tira horizontal 5 anclas de escala */}
                <div className="shrink-0 border-y border-[#E2E8F0] dark:border-[#12151C] bg-transparent overflow-x-auto">
                    <div className="grid grid-cols-5 min-w-[320px] divide-x divide-[#E2E8F0] dark:divide-[#12151C]">
                        {ANCHOR_OPTIONS.map((opt) => {
                            const active = scaleAnchorType === opt.id;
                            const labelText =
                                opt.id === 'MANUAL_BASE_M' && parsedReferenceBase
                                    ? `${parsedReferenceBase}m`
                                    : `${opt.fallbackLabel}${opt.shortTag ? ` ${opt.shortTag}` : ''}`;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        setScaleAnchorType(opt.id);
                                        setDigitalResult(null);
                                        setShowNumPad(opt.id === 'MANUAL_BASE_M');
                                    }}
                                    aria-label={t(opt.labelKey, opt.fallbackLabel)}
                                    className={`min-h-[52px] px-1 bg-transparent border-0 border-b-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer rounded-none transition-colors ${
                                        active
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[18px]">
                                        {opt.icon}
                                    </span>
                                    <span className="text-microcopy font-mono font-bold uppercase tabular-nums leading-none whitespace-nowrap">
                                        {labelText}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Cota Base Manual + Voz (cuando MANUAL_BASE_M activo) */}
                {scaleAnchorType === 'MANUAL_BASE_M' && (
                    <div className="shrink-0 border-b border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 space-y-fib-8">
                        <div className="flex items-center justify-between gap-fib-8">
                            <button
                                type="button"
                                onClick={() => setShowNumPad((prev) => !prev)}
                                className="flex-1 min-h-[48px] bg-transparent border-0 border-b border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-data-dense font-bold uppercase flex items-center justify-between cursor-pointer rounded-none px-1"
                            >
                                <span>{t('digital_v2.base_dim_label', 'BASE m')}</span>
                                <span className="tabular-nums text-[#00AEEF]">
                                    {parsedReferenceBase ? `${parsedReferenceBase} m` : '-- m'}
                                </span>
                            </button>
                            <SovereignVoiceInput
                                module="stockpile"
                                compact
                                onTranscript={handleVoiceTranscript}
                            />
                        </div>
                        {showNumPad && (
                            <FieldNumPad
                                value={referenceBaseText}
                                unit="m"
                                onChange={(nextVal) => {
                                    setReferenceBaseText(nextVal);
                                    setDigitalResult(null);
                                }}
                                onConfirm={() => setShowNumPad(false)}
                                onClear={() => {
                                    setReferenceBaseText('');
                                    setDigitalResult(null);
                                }}
                            />
                        )}
                    </div>
                )}

                {/* Evaluación IA en línea (opcional pre-guardado) */}
                {photoPreview && isOnline && (
                    <div className="shrink-0 border-b border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 space-y-fib-8">
                        <div className="flex items-center justify-between gap-fib-8">
                            <button
                                type="button"
                                onClick={() => void runOnlineAiAnalysis()}
                                disabled={isAnalyzing || isSaving}
                                className="min-h-[44px] bg-transparent border-0 text-[#00AEEF] hover:opacity-75 font-mono text-microcopy font-bold uppercase flex items-center gap-1 cursor-pointer disabled:opacity-40 rounded-none p-0"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    auto_awesome
                                </span>
                                <span>
                                    {digitalResult
                                        ? t('digital_v2.reanalyze_ai', 'REANALIZAR IA')
                                        : t('digital_v2.analyze_ai', 'ANALIZAR IA')}
                                </span>
                            </button>

                            {digitalResult && (
                                <span className="text-h2-section font-mono font-bold tabular-nums text-[#C68346]">
                                    {digitalResult.scaleVerified
                                        ? `${digitalResult.volumeM3.toFixed(1)} m³`
                                        : '-- m³'}
                                </span>
                            )}
                        </div>

                        {digitalResult && (
                            <div className="grid grid-cols-2 divide-x divide-[#E2E8F0] dark:divide-[#12151C] border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-8 text-microcopy font-mono uppercase tabular-nums">
                                <div className="pr-fib-8">
                                    <span className="text-[#475569] dark:text-[#8A93A6] mr-1">
                                        α
                                    </span>
                                    <span
                                        className={`font-bold ${
                                            typeof digitalResult.slopeAngleAvgDeg === 'number' &&
                                            digitalResult.slopeAngleAvgDeg > 38
                                                ? 'text-[#C68346]'
                                                : 'text-[#00AEEF]'
                                        }`}
                                    >
                                        {typeof digitalResult.slopeAngleAvgDeg === 'number'
                                            ? `${digitalResult.slopeAngleAvgDeg.toFixed(1)}°`
                                            : '--'}
                                    </span>
                                </div>
                                <div className="pl-fib-8 truncate font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {digitalResult.copperDomain ||
                                        digitalResult.granulometry ||
                                        '--'}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Acción guardar cuando hay foto + Barra inferior pegada al pulgar */}
            <footer className="shrink-0 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] pb-[env(safe-area-inset-bottom)]">
                {photoPreview && (
                    <button
                        type="button"
                        onClick={() => void handleSaveCapture()}
                        disabled={isSaving || isAnalyzing}
                        className="w-full min-h-[52px] bg-[#C68346] hover:bg-[#b5753b] active:bg-[#9c6330] text-white border-0 border-b border-[#E2E8F0] dark:border-[#12151C] font-mono text-h2-section font-bold uppercase tracking-wider flex items-center justify-center gap-fib-8 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">
                            {isOnline ? 'cloud_done' : 'save'}
                        </span>
                        <span>
                            {isNewAssetMode
                                ? t('capture_v2.save_new_stockpile', 'GUARDAR ACOPIO')
                                : t('digital_v2.save_capture', 'GUARDAR CAPTURA')}
                        </span>
                    </button>
                )}

                <div className="min-h-[80px] px-fib-21 grid grid-cols-3 items-center">
                    <button
                        type="button"
                        onClick={() => void handleCaptureSource('PHOTOS', 'PRIMARY')}
                        disabled={isSaving || isAnalyzing}
                        aria-label={t('digital_v2.gallery_btn', 'GALERÍA')}
                        className="min-w-[56px] min-h-[56px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-35 rounded-none"
                    >
                        <span className="material-symbols-outlined text-[24px]">
                            photo_library
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => void handleCaptureSource('CAMERA', 'PRIMARY')}
                        disabled={isSaving || isAnalyzing}
                        aria-label={t('digital_v2.capture_primary_btn', 'DISPARAR')}
                        className="w-16 h-16 mx-auto bg-[#C68346] hover:bg-[#b5753b] active:bg-[#9c6330] text-white border-0 flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[28px]">photo_camera</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => void handleCaptureSource('CAMERA', 'EXTRA')}
                        disabled={!photoBlob || extraPhotos.length >= 3 || isSaving || isAnalyzing}
                        aria-label={t('capture_v2.extra_angle', 'ÁNGULO')}
                        className="min-w-[56px] min-h-[56px] bg-transparent border-0 text-[#0F172A] dark:text-[#F3F4F6] hover:text-[#C68346] flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-35 rounded-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">add_a_photo</span>
                        <span className="text-microcopy font-mono font-bold tabular-nums">
                            {extraPhotos.length}/3
                        </span>
                    </button>
                </div>
            </footer>
        </div>
    );
};
