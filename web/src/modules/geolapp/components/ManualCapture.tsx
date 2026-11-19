import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import { M3Switch } from '../../../components/common/M3Switch';
import SecureImage from '../../../components/common/SecureImage';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import { storageService } from '../core/services/StorageService';
import { useImuClinometer } from '../core/hooks/useImuClinometer';
import {
    CasTelemetryBadge,
    type CasTelemetryMetrics,
    InlineStatusBanner,
    type InlineStatusMessage,
    computeCasMetrics,
    dataUrlToBlob,
    parseOptionalNonNegative,
    sanitizeDecimalText,
} from '../core/utils/captureHelpers';
import type {
    GeolappGeometryType,
    StockpileAsset,
} from '../core/types/GeolappTypes';

export interface ManualCaptureProps {
    assetId?: string;
    draftAsset?: {
        name: string;
        geoPoint?: StockpileAsset['geo_point'];
    };
    initialGeometry?: GeolappGeometryType;
    onSuccess: (measurementId: string, createdAssetId?: string) => void;
    onBack: () => void;
    hidePhoto?: boolean;
    initialPhotoUrl?: string;
    hideHeader?: boolean;
}

const GEOMETRY_CHOICES: Array<{
    id: GeolappGeometryType;
    labelKey: string;
    fallback: string;
}> = [
    { id: 'CONO_ELIPTICO', labelKey: 'geometries.CONO_ELIPTICO', fallback: 'CONO ELÍPTICO' },
    {
        id: 'CONO_ELIPTICO_TRUNCADO',
        labelKey: 'geometries.CONO_ELIPTICO_TRUNCADO',
        fallback: 'CONO TRUNCADO',
    },
    {
        id: 'CONO_TRUNCADO_PERIMETRO',
        labelKey: 'geometries.CONO_TRUNCADO_PERIMETRO',
        fallback: 'PERÍMETRO BASE/SUP',
    },
    {
        id: 'PILA_LONGITUDINAL_WINDROW',
        labelKey: 'geometries.PILA_LONGITUDINAL_WINDROW',
        fallback: 'PILA LONGITUDINAL',
    },
    {
        id: 'ACOPIO_CONTRA_MURO',
        labelKey: 'geometries.ACOPIO_CONTRA_MURO',
        fallback: 'CONTRA MURO',
    },
];

const EYE_HEIGHT_PRESETS = ['1.55', '1.65', '1.75'] as const;

export const ManualCapture: React.FC<ManualCaptureProps> = ({
    assetId,
    draftAsset,
    initialGeometry = 'CONO_ELIPTICO',
    onSuccess,
    onBack,
    hidePhoto = false,
    initialPhotoUrl,
    hideHeader = false,
}) => {
    const { t } = useTranslation();
    const isNewAssetMode = Boolean(!assetId && draftAsset);

    const [geometria, setGeometria] = useState<GeolappGeometryType>(initialGeometry);
    const [dimensions, setDimensions] = useState({
        a: '',
        b: '',
        h: '',
        ap: '',
        bp: '',
        p: '',
        pp: '',
        baseLengthM: '',
        baseWidthM: '',
        crestLengthM: '',
        crestWidthM: '',
        wallLengthM: '',
        wallWidthM: '',
        wallAngleDeg: '',
    });
    const [density, setDensity] = useState('');
    const [showAdvancedDrawer, setShowAdvancedDrawer] = useState(false);

    const clinometer = useImuClinometer();
    const [operatorEyeHeightM, setOperatorEyeHeightM] = useState('1.65');
    const [horizontalDistanceM, setHorizontalDistanceM] = useState('');
    const [appliedImu, setAppliedImu] = useState<{
        imu_pitch_deg: number;
        imu_height_m: number;
        imu_distance_m: number;
        imu_eye_height_m: number;
    } | null>(null);
    const [isZeroVolumeClosure, setIsZeroVolumeClosure] = useState(false);

    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [casMetrics, setCasMetrics] = useState<CasTelemetryMetrics | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState<InlineStatusMessage | null>(null);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(() =>
        draftAsset?.geoPoint
            ? {
                  lat: draftAsset.geoPoint.latitude,
                  lng: draftAsset.geoPoint.longitude,
                  acc: draftAsset.geoPoint.accuracy ?? 0,
              }
            : null
    );

    const fileInputRef = useRef<HTMLInputElement>(null);
    const objectUrlsRef = useRef<Set<string>>(new Set());
    const captureTokenRef = useRef(0);

    const createTrackedObjectUrl = useCallback((blob: Blob) => {
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.add(url);
        return url;
    }, []);

    const revokeTrackedObjectUrl = useCallback((url?: string | null) => {
        if (url && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
            objectUrlsRef.current.delete(url);
        }
    }, []);

    useEffect(() => {
        if (draftAsset?.geoPoint) {
            setGps({
                lat: draftAsset.geoPoint.latitude,
                lng: draftAsset.geoPoint.longitude,
                acc: draftAsset.geoPoint.accuracy ?? 0,
            });
            return;
        }
        let active = true;
        Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 })
            .then((pos) => {
                if (!active) return;
                const { latitude: lat, longitude: lng, accuracy } = pos.coords;
                if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                    setGps({ lat, lng, acc: accuracy });
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [draftAsset?.geoPoint]);

    useEffect(() => {
        if (!assetId) return;
        let active = true;
        dataService
            .getAsset(assetId)
            .then((asset) => {
                if (!active || !asset) return;
                if (typeof asset.density_factor === 'number' && asset.density_factor > 0) {
                    setDensity((prev) => prev || String(asset.density_factor));
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [assetId]);

    useEffect(() => {
        const activeUrls = objectUrlsRef.current;
        return () => {
            activeUrls.forEach((url) => URL.revokeObjectURL(url));
            activeUrls.clear();
        };
    }, []);

    const applyRawPhoto = async (rawFileOrBlob: Blob) => {
        const token = ++captureTokenRef.current;
        const nextPreview = createTrackedObjectUrl(rawFileOrBlob);
        setPhotoBlob(rawFileOrBlob);
        setCasMetrics(null);
        setPhotoPreview((prev) => {
            revokeTrackedObjectUrl(prev);
            return nextPreview;
        });

        try {
            const digested = await mediaDigestorClient.digestFile(
                rawFileOrBlob,
                'IMAGE_FIELD_EVIDENCE'
            );
            if (captureTokenRef.current === token) {
                setCasMetrics(
                    computeCasMetrics(
                        digested.originalBytes,
                        digested.optimizedBytes,
                        undefined,
                        false
                    )
                );
            }
        } catch {
            // Confirmado al subir
        }
    };

    const takePhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 85,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false,
            });
            if (image.dataUrl) {
                await applyRawPhoto(dataUrlToBlob(image.dataUrl));
            }
        } catch (err: any) {
            if (!/cancel/i.test(String(err?.message || ''))) {
                fileInputRef.current?.click();
            }
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await applyRawPhoto(file);
        } catch (err: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('manual_capture.photo_process_error', 'Error al procesar foto')}: ${err?.message || 'Formato inválido'}`,
            });
        } finally {
            e.target.value = '';
        }
    };

    const activePitchDeg =
        clinometer.frozenPitchDeg ?? (clinometer.isListening ? clinometer.pitchDeg : null);

    const clinometerPreviewHeight = useMemo(() => {
        if (activePitchDeg === null || !Number.isFinite(activePitchDeg)) return null;
        const dist = parseOptionalNonNegative(horizontalDistanceM);
        const eyeH = parseOptionalNonNegative(operatorEyeHeightM);
        if (typeof dist !== 'number' || dist <= 0 || typeof eyeH !== 'number') return null;
        return calculationEngine.computeHeightFromClinometer(activePitchDeg, dist, eyeH);
    }, [activePitchDeg, horizontalDistanceM, operatorEyeHeightM]);

    const handleApplyClinometerHeight = () => {
        if (activePitchDeg === null || clinometerPreviewHeight === null) {
            setStatusMessage({
                severity: 'warning',
                text: t('clinometer.incomplete_inputs'),
            });
            return;
        }
        const dist = parseOptionalNonNegative(horizontalDistanceM) || 0;
        const eyeH = parseOptionalNonNegative(operatorEyeHeightM) || 0;
        setDimensions((prev) => ({ ...prev, h: clinometerPreviewHeight.toFixed(2) }));
        setAppliedImu({
            imu_pitch_deg: Number(activePitchDeg.toFixed(2)),
            imu_height_m: clinometerPreviewHeight,
            imu_distance_m: dist,
            imu_eye_height_m: eyeH,
        });
        setStatusMessage({
            severity: 'info',
            text: `${t('clinometer.applied_notice')}: ${clinometerPreviewHeight.toFixed(2)} m`,
        });
    };

    const wallAngleParsed = useMemo(() => {
        if (dimensions.wallAngleDeg.trim() === '') return undefined;
        const num = Number.parseFloat(dimensions.wallAngleDeg.trim());
        if (!Number.isFinite(num) || num <= 0 || num > 90) return null;
        return num;
    }, [dimensions.wallAngleDeg]);

    const liveEstimation = useMemo(() => {
        if (isZeroVolumeClosure) return 0;
        const a = parseFloat(dimensions.a) || 0;
        const b = parseFloat(dimensions.b) || 0;
        const h = parseFloat(dimensions.h) || 0;
        const ap = parseFloat(dimensions.ap) || 0;
        const bp = parseFloat(dimensions.bp) || 0;
        const p = parseFloat(dimensions.p) || 0;
        const pp = parseFloat(dimensions.pp) || 0;

        if (geometria === 'CONO_ELIPTICO') {
            return calculationEngine.calculateEllipticCone(a, b, h);
        }
        if (geometria === 'CONO_ELIPTICO_TRUNCADO') {
            return calculationEngine.calculateTruncatedEllipticCone(a, b, ap, bp, h);
        }
        if (geometria === 'CONO_TRUNCADO_PERIMETRO') {
            return calculationEngine.calculatePerimeterTruncatedCone(p, pp, h);
        }
        if (geometria === 'PILA_LONGITUDINAL_WINDROW') {
            const baseL = parseOptionalNonNegative(dimensions.baseLengthM) || 0;
            const baseW = parseOptionalNonNegative(dimensions.baseWidthM) || 0;
            const crestL = parseOptionalNonNegative(dimensions.crestLengthM);
            const crestW = parseOptionalNonNegative(dimensions.crestWidthM);
            return calculationEngine.calculateWindrowVolume(baseL, baseW, h, crestL, crestW);
        }
        if (geometria === 'ACOPIO_CONTRA_MURO') {
            if (wallAngleParsed === null) return 0;
            const wallL = parseOptionalNonNegative(dimensions.wallLengthM) || 0;
            const wallW = parseOptionalNonNegative(dimensions.wallWidthM) || 0;
            return calculationEngine.calculateToeWallStockpileVolume(wallL, wallW, h, wallAngleParsed);
        }
        return 0;
    }, [isZeroVolumeClosure, dimensions, geometria, wallAngleParsed]);

    const densityNum = parseFloat(density) || 0;
    const liveWeightT =
        !isZeroVolumeClosure && densityNum > 0
            ? calculationEngine.computeTotalMass(liveEstimation, densityNum)
            : 0;

    const canSaveZeroClosure = Boolean(assetId && isZeroVolumeClosure && !hidePhoto);
    const canSubmit = !isSaving && (canSaveZeroClosure || liveEstimation > 0);

    const handleSave = async () => {
        if (!canSubmit) return;
        if (canSaveZeroClosure && !photoBlob) {
            setStatusMessage({
                severity: 'warning',
                text: t('manual_capture.required_photo_alert'),
            });
            return;
        }
        if (!canSaveZeroClosure && geometria === 'ACOPIO_CONTRA_MURO' && wallAngleParsed === null) {
            setStatusMessage({
                severity: 'warning',
                text: t('manual_capture.err_wall_angle_range'),
            });
            return;
        }

        setIsSaving(true);
        setStatusMessage(null);
        const pendingAssetId = assetId || `asset_${Date.now()}`;

        try {
            let photoUrl = initialPhotoUrl || '';
            let resolvedCas: CasTelemetryMetrics | null = null;

            if (photoBlob && !hidePhoto) {
                const uploadResult = await storageService.uploadStockpileImage(
                    photoBlob,
                    pendingAssetId
                );
                photoUrl = uploadResult.url;
                resolvedCas = computeCasMetrics(
                    uploadResult.originalBytes ?? photoBlob.size,
                    uploadResult.optimizedBytes ?? uploadResult.size,
                    uploadResult.savingsPct,
                    true
                );
                setCasMetrics(resolvedCas);
            }

            const effectiveVolume = canSaveZeroClosure ? 0 : liveEstimation;
            const crestLengthOpt = parseOptionalNonNegative(dimensions.crestLengthM);
            const crestWidthOpt = parseOptionalNonNegative(dimensions.crestWidthM);

            const geometryDimensions: Record<string, number> =
                geometria === 'PILA_LONGITUDINAL_WINDROW'
                    ? {
                          base_length_m: parseOptionalNonNegative(dimensions.baseLengthM) || 0,
                          base_width_m: parseOptionalNonNegative(dimensions.baseWidthM) || 0,
                          h: parseFloat(dimensions.h) || 0,
                          ...(crestLengthOpt !== undefined ? { crest_length_m: crestLengthOpt } : {}),
                          ...(crestWidthOpt !== undefined ? { crest_width_m: crestWidthOpt } : {}),
                      }
                    : geometria === 'ACOPIO_CONTRA_MURO'
                      ? {
                            length_m: parseOptionalNonNegative(dimensions.wallLengthM) || 0,
                            width_from_wall_m: parseOptionalNonNegative(dimensions.wallWidthM) || 0,
                            h: parseFloat(dimensions.h) || 0,
                            ...(typeof wallAngleParsed === 'number'
                                ? { wall_angle_deg: wallAngleParsed }
                                : {}),
                        }
                      : {
                            a: parseFloat(dimensions.a) || 0,
                            b: parseFloat(dimensions.b) || 0,
                            h: parseFloat(dimensions.h) || 0,
                            ap: parseFloat(dimensions.ap) || 0,
                            bp: parseFloat(dimensions.bp) || 0,
                            p: parseFloat(dimensions.p) || 0,
                            pp: parseFloat(dimensions.pp) || 0,
                        };

            const measPayload = {
                timestamp: Date.now(),
                volumen_m3: effectiveVolume,
                peso_t: liveWeightT,
                density_factor: densityNum > 0 ? densityNum : undefined,
                method: 'manual' as const,
                photo_url: photoUrl,
                ...(canSaveZeroClosure
                    ? { is_closure_measurement: true, closure_reason: 'ZERO_VOLUME' as const }
                    : {}),
                crest_length_m:
                    geometria === 'PILA_LONGITUDINAL_WINDROW' ? crestLengthOpt : undefined,
                crest_width_m:
                    geometria === 'PILA_LONGITUDINAL_WINDROW' ? crestWidthOpt : undefined,
                wall_angle_deg:
                    geometria === 'ACOPIO_CONTRA_MURO' && typeof wallAngleParsed === 'number'
                        ? wallAngleParsed
                        : undefined,
                ...(appliedImu || {}),
                ...(resolvedCas
                    ? {
                          cas_original_bytes: resolvedCas.originalBytes,
                          cas_optimized_bytes: resolvedCas.optimizedBytes,
                          cas_savings_pct: resolvedCas.savingsPct,
                      }
                    : {}),
                geometry: { type: geometria, dimensions: geometryDimensions },
                location_metadata: gps
                    ? { lat: gps.lat, lng: gps.lng, accuracy: gps.acc }
                    : undefined,
            };

            if (isNewAssetMode && draftAsset) {
                const created = await dataService.createAssetWithInitialMeasurement({
                    asset: {
                        id: pendingAssetId,
                        name: draftAsset.name,
                        clase: 'mineral',
                        geo_point: draftAsset.geoPoint,
                    },
                    measurement: measPayload,
                });
                onSuccess(created.measurementId, created.assetId);
            } else if (assetId) {
                const measurementId = await dataService.addMeasurement({
                    assetId,
                    ...measPayload,
                });
                onSuccess(measurementId, assetId);
            }
        } catch (error: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('manual_capture.save_error')}: ${error?.message || 'Error'}`,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const renderDecimalInput = (
        label: string,
        value: string,
        onChange: (val: string) => void,
        placeholder = '0.0'
    ) => (
        <label className="block space-y-1">
            <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] block">
                {label}
            </span>
            <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => onChange(sanitizeDecimalText(e.target.value))}
                placeholder={placeholder}
                className="w-full h-11 px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-body-main text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
            />
        </label>
    );

    return (
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none select-none">
            <input
                type="file"
                ref={fileInputRef}
                autoComplete="off"
                spellCheck={false}
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                className="hidden"
            />

            {!hideHeader && (
                <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t('common.back_button')}
                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">arrow_back</span>
                    </button>
                    <h2 className="text-h2-section font-bold uppercase tracking-tight truncate">
                        {t('manual_capture.title', 'CUBICACIÓN POR COTAS')}
                    </h2>
                    <button
                        type="button"
                        onClick={() => setShowAdvancedDrawer((prev) => !prev)}
                        aria-label={t('capture_v2.advanced_tools', 'Herramientas avanzadas')}
                        aria-expanded={showAdvancedDrawer}
                        className={`bg-transparent border-0 outline-none p-1 cursor-pointer rounded-none transition-colors ${
                            showAdvancedDrawer
                                ? 'text-[#C68346]'
                                : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[20px]">tune</span>
                    </button>
                </header>
            )}

            <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21 max-w-2xl w-full mx-auto">
                <InlineStatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />

                {/* Live Volume Readout */}
                <section className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex items-baseline justify-between gap-fib-13">
                    <div>
                        <span className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] block">
                            {t('manual_capture.estimated_volume', 'VOLUMEN CALCULADO')}
                        </span>
                        <p className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                            {(canSaveZeroClosure ? 0 : liveEstimation).toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                            })}{' '}
                            <span className="text-h2-section">m³</span>
                        </p>
                    </div>
                    <div className="flex items-center gap-fib-13">
                        {liveWeightT > 0 && (
                            <div className="text-right">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    t
                                </span>
                                <span className="text-h1-header font-mono font-bold tabular-nums text-[#00AEEF]">
                                    {liveWeightT.toLocaleString(undefined, {
                                        maximumFractionDigits: 1,
                                    })}
                                </span>
                            </div>
                        )}
                        {hideHeader && (
                            <button
                                type="button"
                                onClick={() => setShowAdvancedDrawer((prev) => !prev)}
                                aria-label={t('capture_v2.advanced_tools', 'Herramientas avanzadas')}
                                aria-expanded={showAdvancedDrawer}
                                className={`bg-transparent border-0 outline-none p-1 cursor-pointer rounded-none transition-colors ${
                                    showAdvancedDrawer
                                        ? 'text-[#C68346]'
                                        : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                <span className="material-symbols-outlined text-[20px]">tune</span>
                            </button>
                        )}
                    </div>
                </section>

                {/* 5 Geometries Compact Switcher */}
                {!canSaveZeroClosure && (
                    <section className="space-y-fib-8">
                        <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] block">
                            {t('geometries.subtitle', 'GEOMETRÍA')}
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-8">
                            {GEOMETRY_CHOICES.map((geo) => {
                                const active = geometria === geo.id;
                                return (
                                    <button
                                        key={geo.id}
                                        type="button"
                                        onClick={() => setGeometria(geo.id)}
                                        className={`px-fib-13 py-fib-8 border text-left text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors ${
                                            active
                                                ? 'border-[#C68346] bg-[#C68346]/10 text-[#C68346]'
                                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6] hover:border-[#C68346]'
                                        }`}
                                    >
                                        {t(geo.labelKey, geo.fallback)}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Dimension Inputs for Selected Geometry */}
                {!canSaveZeroClosure && (
                    <section className="grid grid-cols-2 sm:grid-cols-3 gap-fib-13">
                        {(geometria === 'CONO_ELIPTICO' ||
                            geometria === 'CONO_ELIPTICO_TRUNCADO') && (
                            <>
                                {renderDecimalInput(
                                    t('manual_capture.fields.major_axis_base', 'EJE MAYOR BASE (m)'),
                                    dimensions.a,
                                    (val) => setDimensions((p) => ({ ...p, a: val }))
                                )}
                                {renderDecimalInput(
                                    t('manual_capture.fields.minor_axis_base', 'EJE MENOR BASE (m)'),
                                    dimensions.b,
                                    (val) => setDimensions((p) => ({ ...p, b: val }))
                                )}
                            </>
                        )}
                        {geometria === 'CONO_ELIPTICO_TRUNCADO' && (
                            <>
                                {renderDecimalInput(
                                    t('manual_capture.fields.major_axis_top', 'EJE MAYOR SUP (m)'),
                                    dimensions.ap,
                                    (val) => setDimensions((p) => ({ ...p, ap: val }))
                                )}
                                {renderDecimalInput(
                                    t('manual_capture.fields.minor_axis_top', 'EJE MENOR SUP (m)'),
                                    dimensions.bp,
                                    (val) => setDimensions((p) => ({ ...p, bp: val }))
                                )}
                            </>
                        )}
                        {geometria === 'CONO_TRUNCADO_PERIMETRO' && (
                            <>
                                {renderDecimalInput(
                                    t('manual_capture.fields.perimeter_base', 'PERÍMETRO BASE (m)'),
                                    dimensions.p,
                                    (val) => setDimensions((p) => ({ ...p, p: val }))
                                )}
                                {renderDecimalInput(
                                    t('manual_capture.fields.perimeter_top', 'PERÍMETRO SUP (m)'),
                                    dimensions.pp,
                                    (val) => setDimensions((p) => ({ ...p, pp: val }))
                                )}
                            </>
                        )}
                        {geometria === 'PILA_LONGITUDINAL_WINDROW' && (
                            <>
                                {renderDecimalInput(
                                    t('manual_capture.fields.windrow_base_length', 'LARGO BASE (m)'),
                                    dimensions.baseLengthM,
                                    (val) => setDimensions((p) => ({ ...p, baseLengthM: val }))
                                )}
                                {renderDecimalInput(
                                    t('manual_capture.fields.windrow_base_width', 'ANCHO BASE (m)'),
                                    dimensions.baseWidthM,
                                    (val) => setDimensions((p) => ({ ...p, baseWidthM: val }))
                                )}
                                {renderDecimalInput(
                                    t(
                                        'manual_capture.fields.windrow_crest_length',
                                        'LARGO CRESTA OPC. (m)'
                                    ),
                                    dimensions.crestLengthM,
                                    (val) => setDimensions((p) => ({ ...p, crestLengthM: val }))
                                )}
                                {renderDecimalInput(
                                    t(
                                        'manual_capture.fields.windrow_crest_width',
                                        'ANCHO CRESTA OPC. (m)'
                                    ),
                                    dimensions.crestWidthM,
                                    (val) => setDimensions((p) => ({ ...p, crestWidthM: val }))
                                )}
                            </>
                        )}
                        {geometria === 'ACOPIO_CONTRA_MURO' && (
                            <>
                                {renderDecimalInput(
                                    t('manual_capture.fields.wall_length', 'LARGO CONTRA MURO (m)'),
                                    dimensions.wallLengthM,
                                    (val) => setDimensions((p) => ({ ...p, wallLengthM: val }))
                                )}
                                {renderDecimalInput(
                                    t('manual_capture.fields.wall_width', 'ANCHO DESDE MURO (m)'),
                                    dimensions.wallWidthM,
                                    (val) => setDimensions((p) => ({ ...p, wallWidthM: val }))
                                )}
                                {renderDecimalInput(
                                    t('manual_capture.fields.wall_angle_deg', 'ÁNGULO MURO (deg)'),
                                    dimensions.wallAngleDeg,
                                    (val) => setDimensions((p) => ({ ...p, wallAngleDeg: val })),
                                    '90'
                                )}
                            </>
                        )}
                        {renderDecimalInput(
                            t('manual_capture.fields.total_height', 'ALTURA TOTAL (m)'),
                            dimensions.h,
                            (val) => {
                                setDimensions((p) => ({ ...p, h: val }));
                                setAppliedImu(null);
                            }
                        )}
                    </section>
                )}

                {/* Single-Tap Optional Evidence Photo (Mandatory only for Zero Closure) */}
                {!hidePhoto && (
                    <section className="space-y-fib-8">
                        <div className="flex items-center justify-between">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                {t('manual_capture.evidence_title', 'EVIDENCIA FOTOGRÁFICA')}
                                {!canSaveZeroClosure && (
                                    <span className="ml-2 text-[#94A3B8] dark:text-[#5A6072]">
                                        ({t('capture_v2.optional_label', 'OPCIONAL')})
                                    </span>
                                )}
                            </span>
                            {photoPreview && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        revokeTrackedObjectUrl(photoPreview);
                                        setPhotoPreview(null);
                                        setPhotoBlob(null);
                                        setCasMetrics(null);
                                    }}
                                    aria-label={t('manual_capture.delete_photo', 'Eliminar foto')}
                                    className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-red-500 cursor-pointer rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                </button>
                            )}
                        </div>
                        {photoPreview ? (
                            <div className="border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none overflow-hidden">
                                <SecureImage
                                    src={photoPreview}
                                    alt={t('manual_capture.evidence_title', 'Evidencia')}
                                    className="w-full h-40 object-cover"
                                />
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={takePhoto}
                                className="w-full h-14 px-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-dashed border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] flex items-center justify-center gap-fib-8 text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] transition-colors cursor-pointer rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    add_a_photo
                                </span>
                                <span>{t('manual_capture.tap_to_capture', 'CAPTURAR FOTO')}</span>
                            </button>
                        )}
                        <CasTelemetryBadge metrics={casMetrics} origBytesFallback={photoBlob?.size} />
                    </section>
                )}

                {/* Zero-Volume Exhaustion Toggle (Existing Stockpiles Only) */}
                {assetId && (
                    <section className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex items-center justify-between gap-fib-13">
                        <div className="min-w-0">
                            <span className="text-microcopy font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] block">
                                {t(
                                    'manual_capture.zero_volume_toggle_title',
                                    'Cancha Limpia / Agotamiento (0.00 m³)'
                                )}
                            </span>
                        </div>
                        <M3Switch
                            checked={isZeroVolumeClosure}
                            onChange={setIsZeroVolumeClosure}
                            aria-label={t(
                                'manual_capture.zero_volume_toggle_title',
                                'Cancha Limpia / Agotamiento (0.00 m³)'
                            )}
                        />
                    </section>
                )}

                {/* Collapsible Advanced Drawer: Optional Density, IMU Clinometer, External Sensors */}
                {showAdvancedDrawer && (
                    <section className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13 rounded-none shadow-none">
                        {renderDecimalInput(
                            t('manual_capture.fields.density_factor', 'DENSIDAD OPCIONAL (t/m³)'),
                            density,
                            setDensity,
                            '1.85'
                        )}

                        <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                            <div className="flex items-center justify-between">
                                <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('clinometer.title', 'CLINÓMETRO IMU')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        clinometer.isListening
                                            ? void clinometer.stopListening()
                                            : void clinometer.startListening()
                                    }
                                    className="px-fib-8 py-1 border border-[#00AEEF] text-[#00AEEF] text-microcopy font-mono font-bold uppercase bg-transparent cursor-pointer rounded-none"
                                >
                                    {clinometer.isListening
                                        ? t('clinometer.stop_sensor', 'DETENER')
                                        : t('clinometer.start_sensor', 'ACTIVAR IMU')}
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-fib-8">
                                {renderDecimalInput(
                                    t('clinometer.eye_height', 'ALTURA OCULAR (m)'),
                                    operatorEyeHeightM,
                                    setOperatorEyeHeightM,
                                    '1.65'
                                )}
                                {renderDecimalInput(
                                    t('clinometer.horizontal_distance', 'DISTANCIA HORIZ. (m)'),
                                    horizontalDistanceM,
                                    setHorizontalDistanceM
                                )}
                            </div>
                            <div className="flex items-center gap-fib-8">
                                {EYE_HEIGHT_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setOperatorEyeHeightM(preset)}
                                        className="px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] bg-[#FFFFFF] dark:bg-[#000000] cursor-pointer rounded-none"
                                    >
                                        {preset}m
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={handleApplyClinometerHeight}
                                    disabled={clinometerPreviewHeight === null}
                                    className="ml-auto px-fib-8 py-1 bg-[#00AEEF] text-white text-microcopy font-mono font-bold uppercase border-0 cursor-pointer disabled:opacity-40 rounded-none"
                                >
                                    {clinometerPreviewHeight !== null
                                        ? `${clinometerPreviewHeight.toFixed(2)} m`
                                        : t('clinometer.apply_height', 'APLICAR H')}
                                </button>
                            </div>
                        </div>
                    </section>
                )}
            </div>

            <footer className="shrink-0 p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="max-w-2xl mx-auto">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSubmit}
                        className="w-full h-12 bg-[#C68346] hover:bg-[#b5753b] text-white font-mono text-microcopy font-bold uppercase tracking-widest border-0 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-fib-8 rounded-none shadow-none transition-colors"
                    >
                        {isSaving ? (
                            <M3CircularProgress
                                indeterminate
                                size={18}
                                strokeWidth={3}
                                ariaLabel={t('manual_capture.saving_measurement')}
                            />
                        ) : (
                            <span className="material-symbols-outlined text-[20px]">check</span>
                        )}
                        <span>
                            {isSaving
                                ? t('manual_capture.saving_measurement', 'GUARDANDO...')
                                : isNewAssetMode
                                  ? t('capture_v2.save_new_stockpile', 'GUARDAR ACOPIO')
                                  : t('manual_capture.save_measurement', 'GUARDAR MEDICIÓN')}
                        </span>
                    </button>
                </div>
            </footer>
        </div>
    );
};
