import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import { storageService } from '../core/services/StorageService';
import type { GeolappGeometryType } from '../core/types/GeolappTypes';
import { MobileScanner } from './MobileScanner';
import {
    ManualCapture,
    type CopperDomainCode,
    type CasTelemetryMetrics,
    type InlineStatusMessage,
    CasTelemetryBadge,
    CopperDomainSelector,
    CopperAssayInputs,
    CopperGovernanceBanner,
    InlineStatusBanner,
    computeCasMetrics,
    dataUrlToBlob,
    mapCopperDomainToClase,
    parseOptionalNonNegative,
    validateCopperAssayInputs,
} from './ManualCapture';
import { CaptureSelection } from './CaptureSelection';
import { GeometrySelection } from './GeometrySelection';

interface StockpileRegistrationProps {
    onSuccess: (assetId: string) => void;
    onCancel: () => void;
}

type RegStep = 'INFO' | 'METHOD' | 'GEOMETRY' | 'CAPTURE_MANUAL' | 'CAPTURE_DIGITAL';

export const StockpileRegistration: React.FC<StockpileRegistrationProps> = ({
    onSuccess,
    onCancel,
}) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [copperDomain, setCopperDomain] = useState<CopperDomainCode | undefined>(undefined);
    const [clase, setClase] = useState<'mineral' | 'esteril' | 'baja_ley'>('mineral');
    const [locationRef, setLocationRef] = useState('');
    const [moisturePct, setMoisturePct] = useState('');
    const [tmlLimitPct, setTmlLimitPct] = useState('');
    const [residenceDays, setResidenceDays] = useState('');
    const [cuTotalPct, setCuTotalPct] = useState('');
    const [cuSolublePct, setCuSolublePct] = useState('');

    const [assetPhotoBlob, setAssetPhotoBlob] = useState<Blob | null>(null);
    const [assetPhotoPreview, setAssetPhotoPreview] = useState<string | null>(null);
    const [casMetrics, setCasMetrics] = useState<CasTelemetryMetrics | null>(null);
    const [statusMessage, setStatusMessage] = useState<InlineStatusMessage | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const objectUrlsRef = useRef<Set<string>>(new Set());
    const captureTokenRef = useRef(0);

    const [step, setStep] = useState<RegStep>('INFO');
    const [geometry, setGeometry] = useState<GeolappGeometryType>('CONO_ELIPTICO');

    const [createdAssetId, setCreatedAssetId] = useState<string | null>(null);
    const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
    const [isCreatingAsset, setIsCreatingAsset] = useState(false);

    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);

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
        Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 })
            .then((pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                    setGps({ lat, lng, acc: pos.coords.accuracy });
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        const activeUrls = objectUrlsRef.current;
        return () => {
            activeUrls.forEach((url) => URL.revokeObjectURL(url));
            activeUrls.clear();
        };
    }, []);

    const handleCopperDomainChange = (nextDomain: CopperDomainCode | undefined) => {
        setCopperDomain(nextDomain);
        if (nextDomain) {
            setClase(mapCopperDomainToClase(nextDomain));
        }
    };

    const handleLegacyClaseChange = (nextClase: 'mineral' | 'esteril' | 'baja_ley') => {
        setClase(nextClase);
        if (copperDomain && mapCopperDomainToClase(copperDomain) !== nextClase) {
            setCopperDomain(undefined);
        }
    };

    const applyRawAssetPhoto = async (rawFileOrBlob: Blob) => {
        const token = ++captureTokenRef.current;
        const nextPreview = createTrackedObjectUrl(rawFileOrBlob);
        setAssetPhotoBlob(rawFileOrBlob);
        setCasMetrics(null);
        setAssetPhotoPreview((prev) => {
            revokeTrackedObjectUrl(prev);
            return nextPreview;
        });

        try {
            const digested = await mediaDigestorClient.digestFile(rawFileOrBlob, 'IMAGE_FIELD_EVIDENCE');
            if (captureTokenRef.current === token) {
                setCasMetrics(
                    computeCasMetrics(digested.originalBytes, digested.optimizedBytes, undefined, false)
                );
            }
        } catch {
            // Vista previa CAS diferida hasta la subida definitiva
        }
    };

    const takeAssetPhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 85,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false,
            });
            if (image.dataUrl) {
                await applyRawAssetPhoto(dataUrlToBlob(image.dataUrl));
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
            await applyRawAssetPhoto(file);
        } catch (err: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('registration.photo_error', 'Error al procesar imagen')}: ${err?.message || 'Formato inválido'}`,
            });
        } finally {
            e.target.value = '';
        }
    };

    const governanceResult = useMemo(() => {
        const rawMoisture = parseOptionalNonNegative(moisturePct);
        const parsedMoisture =
            typeof rawMoisture === 'number' && rawMoisture >= 0 && rawMoisture < 100
                ? rawMoisture
                : null;
        const rawTml = parseOptionalNonNegative(tmlLimitPct);
        const parsedTml =
            typeof rawTml === 'number' && rawTml >= 0 && rawTml < 100 ? rawTml : null;
        const parsedResidence = parseOptionalNonNegative(residenceDays) ?? null;

        return calculationEngine.evaluateCopperGovernance({
            copperDomain,
            residenceDays: parsedResidence,
            moisturePct: parsedMoisture,
            tmlLimitPct: parsedTml,
        });
    }, [copperDomain, moisturePct, tmlLimitPct, residenceDays]);

    const handleContinueFromInfo = () => {
        const assayError = validateCopperAssayInputs(
            moisturePct,
            cuTotalPct,
            cuSolublePct,
            tmlLimitPct,
            residenceDays
        );
        if (assayError) {
            setStatusMessage({ severity: 'warning', text: assayError });
            return;
        }
        setStatusMessage(null);
        setStep('METHOD');
    };

    const ensureAssetCreated = async (): Promise<string | null> => {
        if (createdAssetId) {
            return createdAssetId;
        }
        setIsCreatingAsset(true);
        setStatusMessage(null);
        try {
            let finalPhotoUrl = uploadedPhotoUrl || '';
            let resolvedCas: CasTelemetryMetrics | null = casMetrics;

            if (!finalPhotoUrl && assetPhotoBlob) {
                const assetUpload = await storageService.uploadStockpileImage(
                    assetPhotoBlob,
                    `asset_${Date.now()}`
                );
                finalPhotoUrl = assetUpload.url;
                setUploadedPhotoUrl(assetUpload.url);
                resolvedCas = computeCasMetrics(
                    assetUpload.originalBytes ?? assetPhotoBlob.size,
                    assetUpload.optimizedBytes ?? assetUpload.size,
                    assetUpload.savingsPct,
                    true
                );
                setCasMetrics(resolvedCas);
            }

            const parsedMoisture = parseOptionalNonNegative(moisturePct);
            const validMoisture =
                typeof parsedMoisture === 'number' && parsedMoisture >= 0 && parsedMoisture < 100
                    ? parsedMoisture
                    : undefined;
            const parsedTml = parseOptionalNonNegative(tmlLimitPct);
            const validTml =
                typeof parsedTml === 'number' && parsedTml >= 0 && parsedTml < 100
                    ? parsedTml
                    : undefined;
            const parsedResidence = parseOptionalNonNegative(residenceDays);
            const parsedCuT = parseOptionalNonNegative(cuTotalPct, 100);
            const parsedCuS = parseOptionalNonNegative(cuSolublePct, 100);

            const assetId = await dataService.createAsset({
                name: name.trim().toUpperCase(),
                clase,
                copper_domain: copperDomain,
                moisture_pct: validMoisture,
                tml_pct: validTml,
                residence_days: parsedResidence,
                cu_total_pct: parsedCuT,
                cu_soluble_pct: parsedCuS,
                cas_original_bytes: resolvedCas?.originalBytes,
                cas_optimized_bytes: resolvedCas?.optimizedBytes,
                cas_savings_pct: resolvedCas?.savingsPct,
                location_ref: locationRef.trim(),
                initial_photo_url: finalPhotoUrl || undefined,
                thumbnail_url: finalPhotoUrl || undefined,
                ...(gps
                    ? {
                          geo_point: {
                              latitude: gps.lat,
                              longitude: gps.lng,
                              altitude: null,
                              accuracy: gps.acc,
                          },
                      }
                    : {}),
            });
            setCreatedAssetId(assetId);
            return assetId;
        } catch (e: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('registration.create_error', 'Error al crear activo')}: ${e?.message || 'Fallo de registro'}`,
            });
            return null;
        } finally {
            setIsCreatingAsset(false);
        }
    };

    const goToManualCapture = async (selectedGeometry: GeolappGeometryType) => {
        setGeometry(selectedGeometry);
        const assetId = await ensureAssetCreated();
        if (assetId) {
            setStep('CAPTURE_MANUAL');
        }
    };

    const goToDigitalCapture = async () => {
        const assetId = await ensureAssetCreated();
        if (assetId) {
            setStep('CAPTURE_DIGITAL');
        }
    };

    const stepLabels: Record<RegStep, string> = {
        INFO: t('registration.step_1', 'PASO 1 / 4'),
        METHOD: t('registration.step_2', 'PASO 2 / 4'),
        GEOMETRY: t('registration.step_3', 'PASO 3 / 4'),
        CAPTURE_MANUAL: t('registration.step_4', 'PASO 4 / 4'),
        CAPTURE_DIGITAL: t('registration.step_4', 'PASO 4 / 4'),
    };

    const headerTitles: Record<RegStep, string> = {
        INFO: t('registration.title'),
        METHOD: t('capture.method_title', 'MÉTODO DE CAPTURA'),
        GEOMETRY: t('geometries.title', 'MODELO DE SÓLIDO'),
        CAPTURE_MANUAL: t('manual_capture.title'),
        CAPTURE_DIGITAL: t('capture.scanner_title', 'ESCANEO PERIMETRAL DIGITAL'),
    };

    const showOwnHeader = step !== 'CAPTURE_MANUAL' && step !== 'CAPTURE_DIGITAL';

    return (
        <main className="h-full w-full flex-1 min-h-[600px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden transition-colors rounded-none shadow-none select-none">
            <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileUpload}
                autoComplete="off"
                spellCheck={false}
                className="hidden"
            />

            {showOwnHeader && (
                <header className="pt-fib-34 pb-fib-13 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between flex-none z-40">
                    <div>
                        <p className="text-microcopy font-bold font-mono tabular-nums tracking-[0.2em] uppercase text-[#C68346]">
                            {stepLabels[step]}
                        </p>
                        <h1 className="text-h1-header font-bold tracking-tight leading-none mt-1">
                            {headerTitles[step]}
                        </h1>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                        title={t('common.cancel_button')}
                        aria-label={t('common.cancel_button')}
                    >
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </header>
            )}

            <div className="flex-1 overflow-y-auto hide-scrollbar relative">
                {isCreatingAsset && (
                    <div className="absolute inset-0 bg-[#FFFFFF]/90 dark:bg-[#000000]/90 flex flex-col items-center justify-center gap-fib-13 z-50 px-fib-21">
                        <M3CircularProgress
                            size={40}
                            strokeWidth={4}
                            indeterminate
                            ariaLabel={t('registration.registering_asset_message')}
                        />
                        <div className="w-48">
                            <M3LinearProgress
                                indeterminate
                                ariaLabel={t('registration.registering_asset_message')}
                            />
                        </div>
                        <p className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                            {t('registration.registering_asset_message')}
                        </p>
                    </div>
                )}

                {step === 'INFO' && (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleContinueFromInfo();
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        className="p-fib-21 max-w-md mx-auto flex flex-col gap-fib-21"
                    >
                        <InlineStatusBanner
                            status={statusMessage}
                            onDismiss={() => setStatusMessage(null)}
                        />

                        <div className="space-y-fib-13">
                            <p className="text-microcopy font-bold uppercase tracking-[0.2em] text-[#C68346]">
                                {t('registration.identification_section', 'IDENTIFICACIÓN')}
                            </p>

                            <div className="flex flex-col gap-fib-8">
                                <label
                                    htmlFor="reg-asset-name"
                                    className="text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('registration.name_label')}
                                </label>
                                <input
                                    id="reg-asset-name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={t('registration.name_placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    required
                                    className="w-full min-h-[55px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-body-main font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                />
                            </div>

                            <CopperDomainSelector
                                value={copperDomain}
                                onChange={handleCopperDomainChange}
                            />

                            <div>
                                <p className="text-microcopy font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] mb-fib-8">
                                    {t('registration.legacy_class_title', 'CLASE DE MATERIAL (LEGACY)')}
                                </p>
                                <div className="grid grid-cols-3 gap-fib-8">
                                    {(['mineral', 'esteril', 'baja_ley'] as const).map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => handleLegacyClaseChange(c)}
                                            className={`min-h-[55px] text-microcopy font-bold font-mono uppercase tracking-wider border rounded-none shadow-none transition-colors cursor-pointer ${
                                                clase === c
                                                    ? 'bg-[#C68346] text-[#FFFFFF] border-[#C68346]'
                                                    : 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C]'
                                            }`}
                                        >
                                            {t(`material_type.${c}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <label
                                    htmlFor="reg-location-ref"
                                    className="text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('registration.location_ref_label')}
                                </label>
                                <input
                                    id="reg-location-ref"
                                    type="text"
                                    value={locationRef}
                                    onChange={(e) => setLocationRef(e.target.value)}
                                    placeholder={t('registration.location_ref_placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    required
                                    className="w-full min-h-[55px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-body-main text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                />
                            </div>

                            <CopperAssayInputs
                                idPrefix="reg-cu"
                                moisturePct={moisturePct}
                                cuTotalPct={cuTotalPct}
                                cuSolublePct={cuSolublePct}
                                onMoistureChange={setMoisturePct}
                                onCuTotalChange={setCuTotalPct}
                                onCuSolubleChange={setCuSolublePct}
                                tmlLimitPct={tmlLimitPct}
                                residenceDays={residenceDays}
                                onTmlLimitChange={setTmlLimitPct}
                                onResidenceDaysChange={setResidenceDays}
                                copperDomain={copperDomain}
                                showMassBreakdown={false}
                            />

                            <CopperGovernanceBanner result={governanceResult} />
                        </div>

                        <div className="space-y-fib-8">
                            <p className="text-microcopy font-bold uppercase tracking-[0.2em] text-[#C68346]">
                                {t('registration.cover_photo_title')}
                            </p>
                            <div
                                onClick={takeAssetPhoto}
                                className="relative w-full aspect-video bg-[#F8FAFC] dark:bg-[#07090D] border-2 border-dashed border-[#E2E8F0] dark:border-[#12151C] flex flex-col items-center justify-center overflow-hidden hover:border-[#C68346] transition-colors cursor-pointer rounded-none"
                            >
                                {assetPhotoPreview ? (
                                    <>
                                        <SecureImage
                                            src={assetPhotoPreview}
                                            className="w-full h-full object-cover"
                                            alt={t('registration.cover_photo_title')}
                                        />
                                        <div className="absolute inset-0 bg-black/25 pointer-events-none" />
                                        <span className="absolute bottom-2 left-3 text-microcopy font-bold uppercase tracking-widest text-[#FFFFFF] bg-[#C68346] px-fib-8 py-0.5 rounded-none">
                                            {t('registration.captured_label')}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                captureTokenRef.current += 1;
                                                revokeTrackedObjectUrl(assetPhotoPreview);
                                                setAssetPhotoBlob(null);
                                                setAssetPhotoPreview(null);
                                                setCasMetrics(null);
                                            }}
                                            className="absolute top-2 right-2 min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-white/80 hover:text-white transition-colors cursor-pointer"
                                            title={t('common.delete_button', 'ELIMINAR')}
                                            aria-label={t('common.delete_button', 'ELIMINAR')}
                                        >
                                            <span className="material-symbols-outlined">delete</span>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined text-3xl text-[#94A3B8] dark:text-[#5A6072] mb-1">
                                            add_a_photo
                                        </span>
                                        <span className="text-microcopy font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                                            {t('registration.tap_to_capture_label')}
                                        </span>
                                    </>
                                )}
                            </div>
                            <CasTelemetryBadge
                                metrics={casMetrics}
                                origBytesFallback={assetPhotoBlob?.size}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={!name.trim() || !locationRef.trim() || !assetPhotoBlob}
                            className="w-full min-h-[56px] h-14 bg-[#C68346] text-[#FFFFFF] font-bold text-microcopy uppercase tracking-widest rounded-none shadow-none disabled:opacity-30 transition-colors cursor-pointer"
                        >
                            {t('common.continue_button')}
                        </button>
                    </form>
                )}

                {step === 'METHOD' && (
                    <CaptureSelection
                        onSelection={(type) => {
                            if (type === 'digital') {
                                void goToDigitalCapture();
                            } else {
                                setStep('GEOMETRY');
                            }
                        }}
                        onBack={() => setStep('INFO')}
                    />
                )}

                {step === 'GEOMETRY' && (
                    <GeometrySelection
                        onSelection={goToManualCapture}
                        onBack={() => setStep('METHOD')}
                    />
                )}

                {step === 'CAPTURE_MANUAL' && createdAssetId && (
                    <ManualCapture
                        assetId={createdAssetId}
                        initialGeometry={geometry}
                        hidePhoto={true}
                        initialPhotoUrl={uploadedPhotoUrl || undefined}
                        onSuccess={() => {
                            onSuccess(createdAssetId);
                        }}
                        onBack={() => {
                            setStep('GEOMETRY');
                        }}
                    />
                )}

                {step === 'CAPTURE_DIGITAL' && createdAssetId && (
                    <div className="h-full w-full relative">
                        <MobileScanner
                            assetId={createdAssetId}
                            onSuccess={() => {
                                onSuccess(createdAssetId);
                            }}
                            onBack={() => setStep('METHOD')}
                        />
                    </div>
                )}
            </div>
        </main>
    );
};
