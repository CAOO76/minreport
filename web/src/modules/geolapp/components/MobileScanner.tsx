import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Geolocation } from '@capacitor/geolocation';
import { Motion } from '@capacitor/motion';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { auth } from '../../../config/firebase';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import { SovereignVoiceInput } from '../../../components/common/SovereignVoiceInput';
import SecureImage from '../../../components/common/SecureImage';
import { dataService } from '../core/services/DataService';
import { storageService } from '../core/services/StorageService';
import { calculationEngine } from '../core/services/calculation-engine';
import { visionIA, type Granulometry, type VisionSuggestion } from '../core/services/vision-ia';
import {
    photogrammetry3dService,
    type Reconstruct3DResult,
} from '../core/services/photogrammetry3d.service';
import {
    computeBoxEquivalentDiameterMm,
    isValidBox2D,
} from '../core/utils/rosinRammler';
import type {
    BoulderDetectionBox2D,
    RosinRammlerProfile,
} from '../core/types/GeolappTypes';
import {
    useXCoverHardwareKey,
    XCOVER_HARDWARE_KEY_CODES,
} from '../core/hooks/useXCoverHardwareKey';
import {
    parseSpokenStockpileSpecs,
    type SpokenStockpileSpecs,
} from '../core/utils/spokenStockpileParser';
import type {
    GnssRtkFixRecord,
    SurfacePointCloudSummary,
} from '../core/adapters/ISurfaceSourceAdapter';
import { ExternalSensorsPanel } from './ExternalSensorsPanel';
import {
    type CopperDomainCode,
    type CasTelemetryMetrics,
    type InlineStatusMessage,
    CasTelemetryBadge,
    CopperDomainSelector,
    CopperAssayInputs,
    CopperGovernanceBanner,
    InlineStatusBanner,
    computeCasMetrics,
    computeCopperMetallurgy,
    dataUrlToBlob,
    mapCopperDomainToClase,
    parseOptionalNonNegative,
    sanitizeDecimalText,
    validateCopperAssayInputs,
} from './ManualCapture';

export { parseSpokenStockpileSpecs, type SpokenStockpileSpecs, type Granulometry };

interface MobileScannerProps {
    assetId: string;
    onSuccess: (measurementId: string) => void;
    onBack: () => void;
}

interface ScanPhotoEntry {
    blob: Blob;
    previewUrl: string;
    imu: {
        alpha: number;
        beta: number;
        gamma: number;
        accel_x: number;
        accel_y: number;
        accel_z: number;
    };
}

/**
 * Extrae características reales de luminancia y contraste desde los píxeles del fotograma
 * liberando memoria del canvas inmediatamente (Cero datos inventados).
 */
async function extractRealTextureFeatures(
    imageSrc: string
): Promise<{ mean: number; stdDev: number } | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            try {
                const maxSide = 256;
                const ratio = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
                canvas.width = Math.max(1, Math.round(img.width * ratio));
                canvas.height = Math.max(1, Math.round(img.height * ratio));
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    resolve(null);
                    return;
                }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const totalPixels = Math.max(1, Math.floor(data.length / 4));
                const sampleCount = Math.min(4096, totalPixels);
                const step = Math.max(1, Math.floor(totalPixels / sampleCount));
                const luminances: number[] = [];

                for (let i = 0; i < sampleCount; i++) {
                    const idx = ((i * step) % totalPixels) * 4;
                    const lum =
                        0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
                    luminances.push(lum);
                }

                if (luminances.length === 0) {
                    resolve(null);
                    return;
                }

                const mean = luminances.reduce((acc, v) => acc + v, 0) / luminances.length;
                const variance =
                    luminances.reduce((acc, v) => acc + (v - mean) ** 2, 0) / luminances.length;
                const stdDev = Math.sqrt(variance);
                resolve({
                    mean: Number(mean.toFixed(2)),
                    stdDev: Number(stdDev.toFixed(2)),
                });
            } catch {
                resolve(null);
            } finally {
                canvas.width = 0;
                canvas.height = 0;
            }
        };
        img.onerror = () => resolve(null);
        img.src = imageSrc;
    });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
        reader.readAsDataURL(blob);
    });
}

const XCOVER_ALLOWED_CODES = [
    XCOVER_HARDWARE_KEY_CODES.XCOVER_SIDE_KEY,
    XCOVER_HARDWARE_KEY_CODES.XCOVER_TOP_KEY,
    XCOVER_HARDWARE_KEY_CODES.F1,
    XCOVER_HARDWARE_KEY_CODES.CAMERA,
] as const;

/**
 * MobileScanner - Medición Digital (Fotogrametría + IMU + IA con HITL) para GEOLAPP®.
 * Cumple GEMINI.md §3.1: Cero volúmenes, texturas o densidades inventadas.
 * Soporta Samsung Galaxy XCover7 vía useXCoverHardwareKey, M3LinearProgress, M3CircularProgress,
 * SovereignVoiceInput, guía acústica 880 Hz y vibración háptica.
 */
export const MobileScanner: React.FC<MobileScannerProps> = ({ assetId, onSuccess, onBack }) => {
    const { t } = useTranslation();
    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [casMetrics, setCasMetrics] = useState<CasTelemetryMetrics | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);

    const [scanPhotos, setScanPhotos] = useState<ScanPhotoEntry[]>([]);
    const targetPhotoCount = 5;

    // Cotas geométricas explícitas declaradas por el operador (Cono Elíptico)
    const [baseMajorAxis, setBaseMajorAxis] = useState('');
    const [baseMinorAxis, setBaseMinorAxis] = useState('');
    const [totalHeight, setTotalHeight] = useState('');

    // Inputs granulométricos del operador + Sugerencia IA (HITL explícito, cero auto-asignación)
    const [classification, setClassification] = useState<'COLPA' | 'GRANSA' | 'FINO' | null>(null);
    const [density, setDensity] = useState('');
    const [aiSuggestion, setAiSuggestion] = useState<VisionSuggestion | null>(null);
    const [aiReviewStatus, setAiReviewStatus] = useState<'pending' | 'accepted' | 'rejected'>('pending');
    const [isAnalyzingVision, setIsAnalyzingVision] = useState(false);
    const [visionSourceDataUrl, setVisionSourceDataUrl] = useState<string | null>(null);
    const [bouldersState, setBouldersState] = useState<BoulderDetectionBox2D[]>([]);
    const [isDigestingBoulderCrop, setIsDigestingBoulderCrop] = useState(false);
    const [boulderCropTrace, setBoulderCropTrace] = useState<{
        cropUrl: string;
        sha256: string;
        traceText: string;
    } | null>(null);

    const baseMajorAxisRef = useRef(baseMajorAxis);
    baseMajorAxisRef.current = baseMajorAxis;
    const boulderCropPromiseRef = useRef<Promise<{
        cropUrl: string;
        originalBytes: number;
        optimizedBytes: number;
        savingsPct: number;
    } | null> | null>(null);

    // Especialización Cobre (Cu) + Gobernanza
    const [copperDomain, setCopperDomain] = useState<CopperDomainCode | undefined>(undefined);
    const [moisturePct, setMoisturePct] = useState('');
    const [tmlLimitPct, setTmlLimitPct] = useState('');
    const [residenceDays, setResidenceDays] = useState('');
    const [cuTotalPct, setCuTotalPct] = useState('');
    const [cuSolublePct, setCuSolublePct] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState<InlineStatusMessage | null>(null);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
    const [userId, setUserId] = useState<string>('');

    const [imuData, setImuData] = useState({
        alpha: 0,
        beta: 45,
        gamma: 0,
        accel_x: 0,
        accel_y: 0,
        accel_z: 0,
    });
    const [isGroundDetected, setIsGroundDetected] = useState(false);
    const [audioMuted, setAudioMuted] = useState(false);
    const audioMutedRef = useRef(false);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const prevHorizontalRef = useRef(false);
    const lastAudioCueAtRef = useRef(0);
    const [voiceStatusMsg, setVoiceStatusMsg] = useState<string | null>(null);
    const [textureData, setTextureData] = useState<{ mean: number; stdDev: number } | null>(null);
    const [showExternalSensors, setShowExternalSensors] = useState(false);
    const [externalSurface, setExternalSurface] = useState<SurfacePointCloudSummary | null>(null);

    const handleRtkFixCaptured = useCallback((fix: GnssRtkFixRecord) => {
        if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return;
        const acc =
            typeof fix.hdop === 'number' && Number.isFinite(fix.hdop) && fix.hdop > 0
                ? fix.hdop
                : 0.05;
        setGps({
            lat: fix.latitude,
            lng: fix.longitude,
            acc,
        });
    }, []);

    const handleSurfaceImported = useCallback(
        (summary: SurfacePointCloudSummary) => {
            setExternalSurface(summary);
            if (!baseMajorAxis && summary.boundsM.widthX > 0) {
                setBaseMajorAxis(summary.boundsM.widthX.toFixed(2));
            }
            if (!baseMinorAxis && summary.boundsM.depthZ > 0) {
                setBaseMinorAxis(summary.boundsM.depthZ.toFixed(2));
            }
            if (!totalHeight && summary.boundsM.reliefY > 0) {
                setTotalHeight(summary.boundsM.reliefY.toFixed(2));
            }
        },
        [baseMajorAxis, baseMinorAxis, totalHeight]
    );

    const objectUrlsRef = useRef<Set<string>>(new Set());
    const captureTokenRef = useRef(0);
    const refFileInputRef = useRef<HTMLInputElement>(null);
    const scanFileInputRef = useRef<HTMLInputElement>(null);
    const isCapturingRef = useRef(false);

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

    const revokeScanPhotoEntries = useCallback(
        (entries: ScanPhotoEntry[]) => {
            entries.forEach((entry) => revokeTrackedObjectUrl(entry.previewUrl));
        },
        [revokeTrackedObjectUrl]
    );

    const triggerLevelCue = useCallback(() => {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try {
                navigator.vibrate(40);
            } catch {
                // Vibración opcional según hardware
            }
        }
        if (audioMutedRef.current || typeof window === 'undefined') return;
        const winAudio = window as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
        };
        const AudioCtx = winAudio.AudioContext || winAudio.webkitAudioContext;
        if (!AudioCtx) return;
        try {
            if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
                audioCtxRef.current = new AudioCtx();
            }
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') {
                void ctx.resume().catch(() => undefined);
            }
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.095);
        } catch {
            // Audio opcional si navegador restringe Web Audio
        }
    }, []);

    useEffect(() => {
        audioMutedRef.current = audioMuted;
    }, [audioMuted]);

    useEffect(() => {
        const initMetadata = async () => {
            try {
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                    setGps({ lat, lng, acc: pos.coords.accuracy });
                }
            } catch (err) {
                console.warn('[Scanner] GPS Error:', err);
            }

            try {
                const currentUid = auth?.currentUser?.uid;
                if (currentUid) {
                    setUserId(currentUid);
                }
            } catch (err) {
                console.warn('[Scanner] User Error:', err);
            }
        };
        void initMetadata();
    }, []);

    useEffect(() => {
        let active = true;
        dataService
            .getAsset(assetId)
            .then((asset) => {
                if (!active || !asset) return;
                if (asset.copper_domain) {
                    setCopperDomain((prev) => prev ?? asset.copper_domain);
                }
                if (typeof asset.moisture_pct === 'number' && Number.isFinite(asset.moisture_pct)) {
                    setMoisturePct((prev) => (prev === '' ? String(asset.moisture_pct) : prev));
                }
                if (typeof asset.tml_pct === 'number' && Number.isFinite(asset.tml_pct)) {
                    setTmlLimitPct((prev) => (prev === '' ? String(asset.tml_pct) : prev));
                }
                if (typeof asset.residence_days === 'number' && Number.isFinite(asset.residence_days)) {
                    setResidenceDays((prev) => (prev === '' ? String(asset.residence_days) : prev));
                }
                if (typeof asset.cu_total_pct === 'number' && Number.isFinite(asset.cu_total_pct)) {
                    setCuTotalPct((prev) => (prev === '' ? String(asset.cu_total_pct) : prev));
                }
                if (typeof asset.cu_soluble_pct === 'number' && Number.isFinite(asset.cu_soluble_pct)) {
                    setCuSolublePct((prev) => (prev === '' ? String(asset.cu_soluble_pct) : prev));
                }
            })
            .catch(() => { });
        return () => {
            active = false;
        };
    }, [assetId]);

    useEffect(() => {
        let motionListener: { remove: () => Promise<void> | void } | undefined;
        const initSensors = async () => {
            try {
                motionListener = await Motion.addListener('orientation', (event) => {
                    setImuData({
                        alpha: event.alpha || 0,
                        beta: event.beta || 45,
                        gamma: event.gamma || 0,
                        accel_x: 0,
                        accel_y: 0,
                        accel_z: 0,
                    });
                    const isHorizontal = Math.abs((event.beta || 0) - 90) < 15;
                    setIsGroundDetected(isHorizontal);
                    const now = Date.now();
                    if (
                        isHorizontal &&
                        !prevHorizontalRef.current &&
                        now - lastAudioCueAtRef.current >= 2500
                    ) {
                        lastAudioCueAtRef.current = now;
                        triggerLevelCue();
                    }
                    prevHorizontalRef.current = isHorizontal;
                });
            } catch (err) {
                console.warn('[Scanner] IMU Error:', err);
            }
        };
        void initSensors();
        return () => {
            if (motionListener) {
                void motionListener.remove();
            }
            if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
                void audioCtxRef.current.close().catch(() => undefined);
            }
        };
    }, [triggerLevelCue]);

    // Revocar todos los Object URLs activos al desmontar el componente
    useEffect(() => {
        const activeUrls = objectUrlsRef.current;
        return () => {
            activeUrls.forEach((url) => URL.revokeObjectURL(url));
            activeUrls.clear();
        };
    }, []);

    const handleVoiceSpecs = useCallback(
        (transcript: string) => {
            const parsed = parseSpokenStockpileSpecs(transcript);
            const applied: string[] = [];
            if (parsed.baseMajorAxis) {
                setBaseMajorAxis(parsed.baseMajorAxis);
                applied.push(`${t('scanner.voice_major_axis', 'Eje mayor')} ${parsed.baseMajorAxis} m`);
            }
            if (parsed.baseMinorAxis) {
                setBaseMinorAxis(parsed.baseMinorAxis);
                applied.push(`${t('scanner.voice_minor_axis', 'Eje menor')} ${parsed.baseMinorAxis} m`);
            }
            if (parsed.totalHeight) {
                setTotalHeight(parsed.totalHeight);
                applied.push(`${t('scanner.voice_height', 'Altura')} ${parsed.totalHeight} m`);
            }
            if (parsed.density) {
                setDensity(parsed.density);
                applied.push(`${t('scanner.voice_density', 'Densidad')} ${parsed.density} T/m³`);
            }
            if (parsed.classification) {
                setClassification(parsed.classification);
                applied.push(
                    `${t('scanner.voice_granulometry', 'Granulometría')} ${parsed.classification}`
                );
            }
            if (applied.length > 0) {
                setVoiceStatusMsg(
                    `${t('scanner.voice_recognized', 'Dictado reconocido')}: ${applied.join(' · ')}`
                );
            } else {
                setVoiceStatusMsg(
                    t(
                        'scanner.voice_no_numbers',
                        'Sin valores numéricos reconocidos; ingrese o dicte eje mayor, eje menor, altura o densidad.'
                    )
                );
            }
        },
        [t]
    );

    const processReferencePhotoBlob = useCallback(
        async (rawBlob: Blob, dataUrlForVision?: string) => {
            const token = ++captureTokenRef.current;
            const preview = createTrackedObjectUrl(rawBlob);
            setPhotoBlob(rawBlob);
            setCasMetrics(null);
            setAiSuggestion(null);
            setAiReviewStatus('pending');
            setBouldersState([]);
            setBoulderCropTrace(null);
            setVisionSourceDataUrl(null);
            boulderCropPromiseRef.current = null;
            setPhotoPreview((prev) => {
                revokeTrackedObjectUrl(prev);
                return preview;
            });

            mediaDigestorClient
                .digestFile(rawBlob, 'IMAGE_FIELD_EVIDENCE')
                .then((digested) => {
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
                })
                .catch(() => { });

            const realTexture = await extractRealTextureFeatures(preview);
            if (captureTokenRef.current !== token) return;
            setTextureData(realTexture);

            const visionInput = dataUrlForVision || (await readBlobAsDataUrl(rawBlob).catch(() => ''));
            if (captureTokenRef.current === token) {
                setVisionSourceDataUrl(visionInput || null);
            }
            if (visionInput && captureTokenRef.current === token) {
                const refWidth = parseOptionalNonNegative(baseMajorAxisRef.current);
                setIsAnalyzingVision(true);
                visionIA
                    .analyzeGranulometryAndBoulders(visionInput, {
                        referenceWidthM:
                            refWidth !== undefined && refWidth > 0 ? refWidth : undefined,
                        oversizeThresholdMm: 250,
                    })
                    .then((suggestion) => {
                        if (captureTokenRef.current === token) {
                            setAiSuggestion(suggestion);
                            setBouldersState(
                                Array.isArray(suggestion.boulders) ? suggestion.boulders : []
                            );
                            setAiReviewStatus('pending');
                        }
                    })
                    .catch(() => { })
                    .finally(() => {
                        if (captureTokenRef.current === token) {
                            setIsAnalyzingVision(false);
                        }
                    });
            }
        },
        [createTrackedObjectUrl, revokeTrackedObjectUrl]
    );

    const captureReferencePhoto = useCallback(async () => {
        if (isCapturingRef.current) return;
        isCapturingRef.current = true;
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
                const rawBlob = dataUrlToBlob(image.dataUrl);
                await processReferencePhotoBlob(rawBlob, image.dataUrl);
            }
        } catch (err: any) {
            console.warn('[Scanner] Captura cancelada:', err);
            if (!/cancel/i.test(String(err?.message || ''))) {
                refFileInputRef.current?.click();
            }
        } finally {
            isCapturingRef.current = false;
        }
    }, [processReferencePhotoBlob]);

    const handleReferenceFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await processReferencePhotoBlob(file);
        } catch (err: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('scanner.capture_error', 'Error al procesar captura')}: ${err?.message || 'Formato inválido'}`,
            });
        } finally {
            e.target.value = '';
        }
    };

    const startScan = useCallback(() => {
        setStatusMessage(null);
        setIsScanning(true);
        setScanComplete(false);
        setScanPhotos((prev) => {
            revokeScanPhotoEntries(prev);
            return [];
        });
    }, [revokeScanPhotoEntries]);

    const resetScan = useCallback(() => {
        setIsScanning(false);
        setScanComplete(false);
        setScanPhotos((prev) => {
            revokeScanPhotoEntries(prev);
            return [];
        });
    }, [revokeScanPhotoEntries]);

    const appendScanPhotoBlob = useCallback(
        async (rawBlob: Blob) => {
            const previewUrl = createTrackedObjectUrl(rawBlob);
            setScanPhotos((prev) => [
                ...prev,
                {
                    blob: rawBlob,
                    previewUrl,
                    imu: { ...imuData },
                },
            ]);
            if (!textureData) {
                const realTexture = await extractRealTextureFeatures(previewUrl);
                if (realTexture) setTextureData(realTexture);
            }
        },
        [createTrackedObjectUrl, imuData, textureData]
    );

    const captureScanPhoto = useCallback(async () => {
        if (isCapturingRef.current) return;
        isCapturingRef.current = true;
        try {
            const image = await Camera.getPhoto({
                quality: 80,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false,
            });
            if (image.dataUrl) {
                const rawBlob = dataUrlToBlob(image.dataUrl);
                await appendScanPhotoBlob(rawBlob);
            }
        } catch (err: any) {
            console.warn('[Scanner] Captura cancelada:', err);
            if (!/cancel/i.test(String(err?.message || ''))) {
                scanFileInputRef.current?.click();
            }
        } finally {
            isCapturingRef.current = false;
        }
    }, [appendScanPhotoBlob]);

    const handleScanFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await appendScanPhotoBlob(file);
        } catch (err: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('scanner.station_error', 'Error al procesar estación')}: ${err?.message || 'Formato inválido'}`,
            });
        } finally {
            e.target.value = '';
        }
    };

    const removeScanPhoto = useCallback(
        (index: number) => {
            setScanPhotos((prev) => {
                const target = prev[index];
                if (target) {
                    revokeTrackedObjectUrl(target.previewUrl);
                }
                return prev.filter((_, idx) => idx !== index);
            });
        },
        [revokeTrackedObjectUrl]
    );

    // Soporte tecla física programable Samsung Galaxy XCover7
    useXCoverHardwareKey(
        () => {
            if (isSaving || scanComplete) return;
            if (!photoPreview) {
                void captureReferencePhoto();
            } else if (!isScanning) {
                startScan();
            } else {
                void captureScanPhoto();
            }
        },
        {
            enabled: !isSaving && !scanComplete,
            action: 'DOWN',
            keyCodes: XCOVER_ALLOWED_CODES,
        }
    );

    const declaredVolume = useMemo(() => {
        const a = parseFloat(baseMajorAxis) || 0;
        const b = parseFloat(baseMinorAxis) || 0;
        const h = parseFloat(totalHeight) || 0;
        if (a <= 0 || b <= 0 || h <= 0) return 0;
        return calculationEngine.calculateEllipticCone(a, b, h);
    }, [baseMajorAxis, baseMinorAxis, totalHeight]);

    const copperMetallurgy = useMemo(() => {
        const parsedDensity = parseOptionalNonNegative(density);
        return computeCopperMetallurgy({
            volumeM3: declaredVolume,
            densityFactor: parsedDensity && parsedDensity > 0 ? parsedDensity : undefined,
            moistureRaw: moisturePct,
            cuTotalRaw: cuTotalPct,
            cuSolubleRaw: cuSolublePct,
            tmlLimitRaw: tmlLimitPct,
            residenceDaysRaw: residenceDays,
        });
    }, [
        declaredVolume,
        density,
        moisturePct,
        cuTotalPct,
        cuSolublePct,
        tmlLimitPct,
        residenceDays,
    ]);

    const governanceResult = useMemo(() => {
        return calculationEngine.evaluateCopperGovernance({
            copperDomain,
            residenceDays: copperMetallurgy.residenceDays ?? null,
            moisturePct: copperMetallurgy.moisturePct ?? null,
            tmlLimitPct: copperMetallurgy.tmlLimitPct ?? null,
        });
    }, [
        copperDomain,
        copperMetallurgy.residenceDays,
        copperMetallurgy.moisturePct,
        copperMetallurgy.tmlLimitPct,
    ]);

    const declaredScaleMeters = useMemo(() => {
        const parsed = parseOptionalNonNegative(baseMajorAxis);
        return parsed !== undefined && parsed > 0 ? parsed : undefined;
    }, [baseMajorAxis]);

    const displayBoulders = useMemo<BoulderDetectionBox2D[]>(() => {
        if (!Array.isArray(bouldersState) || bouldersState.length === 0) return [];
        const valid = bouldersState.filter((item) => item && isValidBox2D(item.box_2d));
        if (!declaredScaleMeters) {
            return valid;
        }
        return valid.map((item) => {
            const eqMm = computeBoxEquivalentDiameterMm(item.box_2d, declaredScaleMeters);
            if (eqMm === null) return item;
            const roundedMm = Math.round(eqMm * 10) / 10;
            return {
                ...item,
                estimated_mm: roundedMm,
            };
        });
    }, [bouldersState, declaredScaleMeters]);

    const effectiveRosinRammler = useMemo<RosinRammlerProfile | null>(() => {
        if (declaredScaleMeters && displayBoulders.length >= 2) {
            const recomputed = calculationEngine.computeRosinRammlerFromBoxes(
                displayBoulders,
                declaredScaleMeters,
                250
            );
            if (recomputed) return recomputed;
        }
        return aiSuggestion?.rosin_rammler ?? null;
    }, [declaredScaleMeters, displayBoulders, aiSuggestion]);

    const oversizeBoulderCount = useMemo(
        () =>
            displayBoulders.filter(
                (item) => typeof item.estimated_mm === 'number' && item.estimated_mm >= 250
            ).length,
        [displayBoulders]
    );

    const suggestedClassification = useMemo<'COLPA' | 'GRANSA' | 'FINO' | null>(() => {
        if (!aiSuggestion?.verified || !aiSuggestion.granulometry) return null;
        if (aiSuggestion.granulometry === 'COLPAS') return 'COLPA';
        if (aiSuggestion.granulometry === 'FINOS') return 'FINO';
        return 'GRANSA';
    }, [aiSuggestion]);

    const runBoulderReanalysis = async () => {
        if (!photoBlob && !visionSourceDataUrl) return;
        const token = captureTokenRef.current;
        const imageInput: string | Blob = visionSourceDataUrl || photoBlob!;
        setIsAnalyzingVision(true);
        try {
            const suggestion = await visionIA.analyzeGranulometryAndBoulders(imageInput, {
                referenceWidthM: declaredScaleMeters,
                oversizeThresholdMm: 250,
            });
            if (captureTokenRef.current === token) {
                setAiSuggestion(suggestion);
                setBouldersState(Array.isArray(suggestion.boulders) ? suggestion.boulders : []);
                setBoulderCropTrace(null);
                setAiReviewStatus('pending');
            }
        } catch {
            // Degradación silenciosa manteniendo estado previo
        } finally {
            if (captureTokenRef.current === token) {
                setIsAnalyzingVision(false);
            }
        }
    };

    const acceptAiSuggestion = () => {
        if (!aiSuggestion?.verified) return;
        if (suggestedClassification) {
            setClassification(suggestedClassification);
        }
        if (typeof aiSuggestion.suggestedFactor === 'number' && aiSuggestion.suggestedFactor > 0) {
            setDensity(String(aiSuggestion.suggestedFactor));
        }
        setAiReviewStatus('accepted');

        if (photoBlob && displayBoulders.length > 0 && isValidBox2D(displayBoulders[0].box_2d)) {
            const targetBox = displayBoulders[0].box_2d;
            const token = captureTokenRef.current;
            setIsDigestingBoulderCrop(true);
            const cropTask = visionIA
                .digestBoulderCropCas(photoBlob, targetBox, assetId)
                .then((cropResult) => {
                    if (captureTokenRef.current !== token) return null;
                    const formatKilobytesLabel = (bytes: number) =>
                        bytes >= 1024 * 1024
                            ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
                            : `${(bytes / 1024).toFixed(1)} KB`;
                    const traceText = `ORIG ${formatKilobytesLabel(cropResult.originalBytes)} -> CAS ${formatKilobytesLabel(cropResult.optimizedBytes)} (-${cropResult.savingsPct.toFixed(0)}%)`;
                    if (cropResult.cropUrl && !cropResult.cropUrl.startsWith('data:')) {
                        setBoulderCropTrace({
                            cropUrl: cropResult.cropUrl,
                            sha256: cropResult.sha256,
                            traceText,
                        });
                        setBouldersState((prev) =>
                            prev.map((entry, idx) =>
                                idx === 0
                                    ? {
                                        ...entry,
                                        crop_cas_url: cropResult.cropUrl,
                                        cas_original_bytes: cropResult.originalBytes,
                                        cas_optimized_bytes: cropResult.optimizedBytes,
                                        cas_savings_pct: cropResult.savingsPct,
                                    }
                                    : entry
                            )
                        );
                        return {
                            cropUrl: cropResult.cropUrl,
                            originalBytes: cropResult.originalBytes,
                            optimizedBytes: cropResult.optimizedBytes,
                            savingsPct: cropResult.savingsPct,
                        };
                    }
                    return null;
                })
                .catch(() => null)
                .finally(() => {
                    if (captureTokenRef.current === token) {
                        setIsDigestingBoulderCrop(false);
                    }
                });
            boulderCropPromiseRef.current = cropTask;
        }
    };

    const rejectAiSuggestion = () => {
        setAiReviewStatus('rejected');
    };

    const stopScan = () => {
        if (scanPhotos.length < targetPhotoCount) {
            setStatusMessage({
                severity: 'warning',
                text: t(
                    'scanner.min_stations_warning',
                    `Se requieren al menos ${targetPhotoCount} capturas perimetrales (${scanPhotos.length}/${targetPhotoCount}).`
                ),
            });
            return;
        }
        setStatusMessage(null);
        setIsScanning(false);
        setScanComplete(true);
    };

    const handleSave = async () => {
        const parsedDensity = parseFloat(density) || 0;
        if (!classification || parsedDensity <= 0 || !photoBlob || !scanComplete || declaredVolume <= 0) {
            setStatusMessage({
                severity: 'warning',
                text: t(
                    'scanner.incomplete_save_warning',
                    'Complete evidencia, escaneo, cotas geométricas reales (eje mayor, eje menor, altura), clasificación y densidad.'
                ),
            });
            return;
        }
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

        setIsSaving(true);
        setStatusMessage(null);
        try {
            const weightT = calculationEngine.computeTotalMass(declaredVolume, parsedDensity);
            const uploadResult = await storageService.uploadStockpileImage(photoBlob, assetId, {
                filename: `${assetId}_ref_${Date.now()}.webp`,
            });
            const finalPhotoUrl = uploadResult.url;
            const resolvedCas = computeCasMetrics(
                uploadResult.originalBytes ?? photoBlob.size,
                uploadResult.optimizedBytes ?? uploadResult.size,
                uploadResult.savingsPct,
                true
            );
            setCasMetrics(resolvedCas);

            const perimeterPhotoUrls: string[] = [];
            for (let i = 0; i < scanPhotos.length; i++) {
                const perimUpload = await storageService.uploadStockpileImage(
                    scanPhotos[i].blob,
                    assetId,
                    {
                        filename: `${assetId}_perim_${i + 1}_${Date.now()}.webp`,
                    }
                );
                if (perimUpload.url) {
                    perimeterPhotoUrls.push(perimUpload.url);
                }
            }

            const uploadDeferred =
                finalPhotoUrl.startsWith('offline-cas://') ||
                perimeterPhotoUrls.some((url) => url.startsWith('offline-cas://'));

            if (aiSuggestion && aiSuggestion.verified && aiSuggestion.granulometry) {
                const finalGran: Granulometry =
                    classification === 'COLPA'
                        ? 'COLPAS'
                        : classification === 'FINO'
                            ? 'FINOS'
                            : 'GRANSA';
                const acceptedByOperator =
                    aiReviewStatus === 'accepted' && aiSuggestion.granulometry === finalGran;
                await visionIA.recordOperatorFeedback(aiSuggestion, acceptedByOperator, finalGran);
            }

            const a = parseFloat(baseMajorAxis) || 0;
            const b = parseFloat(baseMinorAxis) || 0;
            const h = parseFloat(totalHeight) || 0;

            let pendingCropMeta: {
                cropUrl: string;
                originalBytes: number;
                optimizedBytes: number;
                savingsPct: number;
            } | null = null;
            if (boulderCropPromiseRef.current) {
                pendingCropMeta = await boulderCropPromiseRef.current.catch(() => null);
            }
            const resolvedPrimaryCropUrl =
                (pendingCropMeta?.cropUrl && !pendingCropMeta.cropUrl.startsWith('data:')
                    ? pendingCropMeta.cropUrl
                    : null) ||
                (boulderCropTrace?.cropUrl && !boulderCropTrace.cropUrl.startsWith('data:')
                    ? boulderCropTrace.cropUrl
                    : null);

            const cleanBoulders: BoulderDetectionBox2D[] = displayBoulders.map((item, idx) => {
                const candidateUrl =
                    item.crop_cas_url && !item.crop_cas_url.startsWith('data:')
                        ? item.crop_cas_url
                        : idx === 0
                            ? resolvedPrimaryCropUrl ?? undefined
                            : undefined;
                const origBytes =
                    typeof item.cas_original_bytes === 'number'
                        ? item.cas_original_bytes
                        : idx === 0
                            ? pendingCropMeta?.originalBytes
                            : undefined;
                const optBytes =
                    typeof item.cas_optimized_bytes === 'number'
                        ? item.cas_optimized_bytes
                        : idx === 0
                            ? pendingCropMeta?.optimizedBytes
                            : undefined;
                const savPct =
                    typeof item.cas_savings_pct === 'number'
                        ? item.cas_savings_pct
                        : idx === 0
                            ? pendingCropMeta?.savingsPct
                            : undefined;
                return {
                    label: item.label,
                    box_2d: item.box_2d,
                    ...(typeof item.confidence === 'number' && Number.isFinite(item.confidence)
                        ? { confidence: item.confidence }
                        : {}),
                    ...(typeof item.estimated_mm === 'number' &&
                        Number.isFinite(item.estimated_mm)
                        ? { estimated_mm: item.estimated_mm }
                        : {}),
                    ...(typeof origBytes === 'number' ? { cas_original_bytes: origBytes } : {}),
                    ...(typeof optBytes === 'number' ? { cas_optimized_bytes: optBytes } : {}),
                    ...(typeof savPct === 'number' ? { cas_savings_pct: savPct } : {}),
                    ...(candidateUrl ? { crop_cas_url: candidateUrl } : {}),
                };
            });

            let meshResult: Reconstruct3DResult | null = null;
            if (a > 0 && b > 0 && h > 0) {
                try {
                    meshResult = await photogrammetry3dService.reconstructStockpile3D({
                        stockpileId: assetId,
                        geometryType: 'CONO_ELIPTICO',
                        dimensions: { a, b, h },
                        photoUrls: [finalPhotoUrl, ...perimeterPhotoUrls].filter(
                            (u) => Boolean(u) && !u.startsWith('data:')
                        ),
                    });
                } catch (meshErr) {
                    console.warn(
                        '[Scanner] Reconstruccion 3D .glb diferida (guardado offline seguro):',
                        meshErr
                    );
                }
            }

            const resolvedP80 =
                effectiveRosinRammler?.p80_mm ??
                (typeof aiSuggestion?.p80_mm === 'number' && Number.isFinite(aiSuggestion.p80_mm)
                    ? aiSuggestion.p80_mm
                    : undefined);

            const measurementData: any = {
                assetId,
                timestamp: Date.now(),
                volumen_m3: declaredVolume,
                peso_t: weightT,
                density_factor: parsedDensity,
                granulometry:
                    classification === 'COLPA'
                        ? 'COLPAS'
                        : classification === 'FINO'
                            ? 'FINOS'
                            : 'GRANSA',
                method: 'digital',
                photo_url: finalPhotoUrl,
                perimeter_photo_urls: perimeterPhotoUrls,
                cas_original_bytes: resolvedCas.originalBytes,
                cas_optimized_bytes: resolvedCas.optimizedBytes,
                cas_savings_pct: resolvedCas.savingsPct,
                ...(meshResult
                    ? {
                        mesh_url: meshResult.meshUrl,
                        mesh_sha256: meshResult.sha256,
                        mesh_source: meshResult.source,
                        tin_volume_m3: meshResult.tinVolumeM3,
                        mesh_original_bytes: meshResult.originalBytes,
                        mesh_optimized_bytes: meshResult.optimizedBytes,
                        mesh_savings_pct: meshResult.savingsPct,
                    }
                    : {}),
                ...(typeof resolvedP80 === 'number' ? { p80_mm: resolvedP80 } : {}),
                ...(effectiveRosinRammler ? { rosin_rammler: effectiveRosinRammler } : {}),
                ...(cleanBoulders.length > 0 ? { boulder_detections: cleanBoulders } : {}),
                copper_domain: copperDomain,
                moisture_pct: copperMetallurgy.moisturePct,
                tml_pct: copperMetallurgy.tmlLimitPct,
                residence_days: copperMetallurgy.residenceDays,
                wet_weight_thm: copperMetallurgy.wetWeightThm,
                dry_weight_tms: copperMetallurgy.dryWeightTms,
                cu_total_pct: copperMetallurgy.cuTotalPct,
                cu_soluble_pct: copperMetallurgy.cuSolublePct,
                fine_cu_t: copperMetallurgy.fineCuT,
                ...(governanceResult.alerts.length > 0
                    ? { copper_governance_alerts: governanceResult.alerts }
                    : {}),
                geometry: {
                    type: 'CONO_ELIPTICO',
                    dimensions: { a, b, h },
                },
                operator_classification: classification,
                operator_density: parsedDensity,
                imu_data: {
                    alpha: imuData.alpha,
                    beta: imuData.beta,
                    gamma: imuData.gamma,
                    accel_x: imuData.accel_x,
                    accel_y: imuData.accel_y,
                    accel_z: imuData.accel_z,
                },
                scan_photo_count: scanPhotos.length,
                offline_pending: uploadDeferred,
            };

            if (aiSuggestion?.verified && typeof aiSuggestion.confidence === 'number') {
                measurementData.ai_confidence = Math.round(aiSuggestion.confidence * 100);
            }

            if (textureData) {
                measurementData.texture_features = {
                    mean_luminance: textureData.mean,
                    std_dev: textureData.stdDev,
                };
            }

            if (gps) {
                measurementData.location_metadata = {
                    lat: gps.lat,
                    lng: gps.lng,
                    accuracy: gps.acc,
                };
            }

            if (userId) {
                measurementData.user_id = userId;
            }

            const measurementId = await dataService.addMeasurement(measurementData);

            await dataService.saveStockpileData(
                {
                    ...(copperDomain
                        ? {
                            copper_domain: copperDomain,
                            clase: mapCopperDomainToClase(copperDomain),
                        }
                        : {}),
                    ...(copperMetallurgy.moisturePct !== undefined
                        ? { moisture_pct: copperMetallurgy.moisturePct }
                        : {}),
                    ...(copperMetallurgy.tmlLimitPct !== undefined
                        ? { tml_pct: copperMetallurgy.tmlLimitPct }
                        : {}),
                    ...(copperMetallurgy.residenceDays !== undefined
                        ? { residence_days: copperMetallurgy.residenceDays }
                        : {}),
                    ...(copperMetallurgy.wetWeightThm !== undefined
                        ? { wet_weight_thm: copperMetallurgy.wetWeightThm }
                        : {}),
                    ...(copperMetallurgy.dryWeightTms !== undefined
                        ? { dry_weight_tms: copperMetallurgy.dryWeightTms }
                        : {}),
                    ...(copperMetallurgy.cuTotalPct !== undefined
                        ? { cu_total_pct: copperMetallurgy.cuTotalPct }
                        : {}),
                    ...(copperMetallurgy.cuSolublePct !== undefined
                        ? { cu_soluble_pct: copperMetallurgy.cuSolublePct }
                        : {}),
                    ...(copperMetallurgy.fineCuT !== undefined
                        ? { fine_cu_t: copperMetallurgy.fineCuT }
                        : {}),
                    cas_original_bytes: resolvedCas.originalBytes,
                    cas_optimized_bytes: resolvedCas.optimizedBytes,
                    cas_savings_pct: resolvedCas.savingsPct,
                    ...(meshResult
                        ? {
                            mesh_url: meshResult.meshUrl,
                            mesh_sha256: meshResult.sha256,
                            mesh_source: meshResult.source,
                            tin_volume_m3: meshResult.tinVolumeM3,
                            mesh_original_bytes: meshResult.originalBytes,
                            mesh_optimized_bytes: meshResult.optimizedBytes,
                            mesh_savings_pct: meshResult.savingsPct,
                        }
                        : {}),
                    ...(typeof resolvedP80 === 'number' ? { p80_mm: resolvedP80 } : {}),
                    ...(effectiveRosinRammler ? { rosin_rammler: effectiveRosinRammler } : {}),
                    ...(cleanBoulders.length > 0 ? { boulder_detections: cleanBoulders } : {}),
                },
                assetId
            );

            onSuccess(measurementId);
        } catch (error: any) {
            console.error('[Scanner] Error guardando medición:', error);
            setStatusMessage({
                severity: 'error',
                text: `${t('manual_capture.save_error')}: ${error?.message || 'Fallo de registro'}`,
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-full w-full flex-1 min-h-[600px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden relative transition-colors duration-200 rounded-none shadow-none select-none">
            <input
                type="file"
                ref={refFileInputRef}
                accept="image/*"
                onChange={handleReferenceFileSelected}
                autoComplete="off"
                spellCheck={false}
                className="hidden"
            />
            <input
                type="file"
                ref={scanFileInputRef}
                accept="image/*"
                onChange={handleScanFileSelected}
                autoComplete="off"
                spellCheck={false}
                className="hidden"
            />

            <header className="flex-none pt-fib-34 pb-fib-13 px-fib-21 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] z-50">
                <div className="flex items-center gap-fib-13">
                    <button
                        type="button"
                        onClick={onBack}
                        className="min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                        title={t('common.back_button')}
                        aria-label={t('common.back_button')}
                    >
                        <span className="material-symbols-outlined text-2xl text-[#C68346]">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-microcopy font-mono font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('manual_capture.measurement_label')}
                        </span>
                        <h1 className="text-h1-header font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                            {t('capture.scanner_title', 'ESCANEO PERIMETRAL DIGITAL')}
                        </h1>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setAudioMuted((prev) => !prev)}
                    className="min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] transition-colors cursor-pointer rounded-none shadow-none"
                    title={
                        audioMuted
                            ? t('scanner.unmute_imu_cue', 'Activar aviso sonoro de nivelación IMU')
                            : t('scanner.mute_imu_cue', 'Silenciar aviso sonoro de nivelación IMU')
                    }
                    aria-label={
                        audioMuted
                            ? t('scanner.unmute_imu_cue', 'Activar aviso sonoro de nivelación IMU')
                            : t('scanner.mute_imu_cue', 'Silenciar aviso sonoro de nivelación IMU')
                    }
                >
                    <span className="material-symbols-outlined text-2xl">
                        {audioMuted ? 'volume_off' : 'volume_up'}
                    </span>
                </button>
            </header>

            <main className="flex-1 overflow-y-auto px-fib-21 py-fib-34 relative">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSave();
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    className="max-w-sm mx-auto space-y-fib-21 relative z-10"
                >
                    <InlineStatusBanner
                        status={statusMessage}
                        onDismiss={() => setStatusMessage(null)}
                    />

                    {/* Sensores Externos (UAV / LiDAR móvil / GNSS RTK NMEA) */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                        <button
                            type="button"
                            onClick={() => setShowExternalSensors((prev) => !prev)}
                            aria-expanded={showExternalSensors}
                            className="w-full min-h-[48px] px-fib-13 py-fib-8 flex items-center justify-between gap-fib-8 bg-transparent border-0 text-left cursor-pointer"
                        >
                            <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                {t(
                                    'core_shell.scanner_external_sensors_toggle',
                                    'SENSORES EXTERNOS · UAV / LIDAR / GNSS RTK'
                                )}
                            </span>
                            <span className="material-symbols-outlined text-[18px] text-[#C68346]">
                                {showExternalSensors ? 'expand_less' : 'expand_more'}
                            </span>
                        </button>
                        {showExternalSensors && (
                            <div className="border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <ExternalSensorsPanel
                                    tenantId={dataService.getTenantId() || undefined}
                                    uploadCas={true}
                                    compact={true}
                                    onSurfaceImported={handleSurfaceImported}
                                    onRtkFixCaptured={handleRtkFixCaptured}
                                />
                            </div>
                        )}
                        {externalSurface && !showExternalSensors && (
                            <div className="px-fib-13 pb-fib-8 text-microcopy font-mono tabular-nums text-[#00AEEF]">
                                {externalSurface.sourceKind} · {externalSurface.tinVolumeM3.toFixed(2)} m³ ·{' '}
                                {externalSurface.pointCount} pts
                            </div>
                        )}
                    </div>

                    {/* 1. FOTO DE REFERENCIA */}
                    <div className="space-y-fib-13">
                        <div className="flex items-center justify-between gap-fib-8">
                            <span className="text-microcopy font-bold tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] uppercase">
                                {t('manual_capture.evidence_title')}
                            </span>
                            {!scanComplete && (
                                <span className="text-microcopy font-mono font-bold uppercase text-[#00AEEF]">
                                    {t('capture.xcover_key_hint', 'Tecla lateral XCover7 habilitada para captura con guantes')}
                                </span>
                            )}
                        </div>
                        <div
                            onClick={photoPreview ? undefined : captureReferencePhoto}
                            className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-colors overflow-hidden flex flex-col items-center justify-center cursor-pointer ${photoPreview
                                ? 'border-[#C68346]/60 bg-[#000000]'
                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]'
                                }`}
                        >
                            {photoPreview ? (
                                <>
                                    <SecureImage
                                        src={photoPreview}
                                        className="w-full h-full object-cover"
                                        alt={t('manual_capture.evidence_title')}
                                    />
                                    {displayBoulders.length > 0 && (
                                        <svg
                                            viewBox="0 0 1000 1000"
                                            preserveAspectRatio="none"
                                            aria-hidden="true"
                                            className="absolute inset-0 w-full h-full pointer-events-none"
                                        >
                                            {displayBoulders.map((b, idx) => {
                                                const [ymin, xmin, ymax, xmax] = b.box_2d;
                                                const isOversize =
                                                    typeof b.estimated_mm === 'number' &&
                                                    b.estimated_mm >= 250;
                                                const stroke = isOversize ? '#C68346' : '#00AEEF';
                                                return (
                                                    <g
                                                        key={`${ymin}_${xmin}_${ymax}_${xmax}_${idx}`}
                                                    >
                                                        <rect
                                                            x={xmin}
                                                            y={ymin}
                                                            width={Math.max(1, xmax - xmin)}
                                                            height={Math.max(1, ymax - ymin)}
                                                            fill="none"
                                                            stroke={stroke}
                                                            strokeWidth={4}
                                                            vectorEffect="non-scaling-stroke"
                                                        />
                                                        {typeof b.estimated_mm === 'number' && (
                                                            <text
                                                                x={Math.min(910, xmin + 8)}
                                                                y={Math.max(26, ymin + 24)}
                                                                fill={stroke}
                                                                fontSize="24"
                                                                fontFamily="monospace"
                                                                fontWeight="700"
                                                            >
                                                                {Math.round(b.estimated_mm)}mm
                                                            </text>
                                                        )}
                                                    </g>
                                                );
                                            })}
                                        </svg>
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                                    <div className="absolute bottom-4 left-4 flex items-center gap-fib-8">
                                        <span className="text-microcopy font-bold text-[#FFFFFF] uppercase tracking-widest bg-[#C68346] px-fib-8 py-0.5">
                                            {t('registration.captured_label', 'CAPTURADA')}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            captureTokenRef.current += 1;
                                            revokeTrackedObjectUrl(photoPreview);
                                            setPhotoBlob(null);
                                            setPhotoPreview(null);
                                            setCasMetrics(null);
                                            setAiSuggestion(null);
                                            setAiReviewStatus('pending');
                                            setIsAnalyzingVision(false);
                                            setVisionSourceDataUrl(null);
                                            setBouldersState([]);
                                            setBoulderCropTrace(null);
                                            setIsDigestingBoulderCrop(false);
                                            boulderCropPromiseRef.current = null;
                                            setTextureData(null);
                                            resetScan();
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
                                    <span className="material-symbols-outlined text-5xl text-[#94A3B8] dark:text-[#5A6072] mb-2">
                                        add_a_photo
                                    </span>
                                    <span className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.2em]">
                                        {t('scanner.capture_reference', 'CAPTURAR REFERENCIA')}
                                    </span>
                                </>
                            )}
                        </div>
                        <CasTelemetryBadge metrics={casMetrics} origBytesFallback={photoBlob?.size} />
                    </div>

                    {/* 2. ESCANEO MULTI-FOTO */}
                    {photoPreview && !scanComplete && (
                        <div className="space-y-fib-13">
                            <span className="text-microcopy font-bold tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] uppercase">
                                {t('scanner.technical_scan_title', 'ESCANEO TÉCNICO')}
                            </span>

                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none p-fib-21 shadow-none">
                                <div className="flex items-center justify-between mb-fib-13">
                                    <div className="flex flex-col">
                                        <span className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                            {t('capture.perimeter_progress', 'CAPTURAS PERIMETRALES')}
                                        </span>
                                        <span
                                            className={`text-microcopy font-bold font-mono tabular-nums uppercase ${scanPhotos.length >= targetPhotoCount
                                                ? 'text-[#C68346]'
                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                                }`}
                                        >
                                            {scanPhotos.length} / {targetPhotoCount}{' '}
                                            {t('scanner.stations_unit', 'ESTACIONES')}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="block text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                            {imuData.beta.toFixed(1)}°
                                        </span>
                                        <span
                                            className={`block text-microcopy font-mono font-bold uppercase ${isGroundDetected
                                                ? 'text-[#00AEEF]'
                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                                }`}
                                        >
                                            {isGroundDetected
                                                ? t('scanner.imu_leveled', 'NIVELADO')
                                                : t('scanner.imu_tilt_hint', 'INCLINE SUAVEMENTE')}
                                        </span>
                                    </div>
                                </div>

                                <M3LinearProgress
                                    value={Math.min(
                                        100,
                                        Math.round((scanPhotos.length / targetPhotoCount) * 100)
                                    )}
                                    ariaLabel={t('scanner.scan_progress_title', 'Progreso del escaneo')}
                                />
                            </div>

                            {scanPhotos.length > 0 && (
                                <div className="grid grid-cols-5 gap-fib-8">
                                    {scanPhotos.map((entry, idx) => (
                                        <div
                                            key={entry.previewUrl}
                                            className="relative aspect-square bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none overflow-hidden"
                                        >
                                            <SecureImage
                                                src={entry.previewUrl}
                                                className="w-full h-full object-cover"
                                                alt={`${t('scanner.station_label', 'Estación')} ${idx + 1}`}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeScanPhoto(idx)}
                                                className="absolute top-0 right-0 bg-black/70 border-0 outline-none p-1 text-white hover:text-[#C68346] cursor-pointer"
                                                title={`${t('scanner.delete_station', 'Eliminar estación')} ${idx + 1}`}
                                                aria-label={`${t('scanner.delete_station', 'Eliminar estación')} ${idx + 1}`}
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    close
                                                </span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {!isScanning && scanPhotos.length === 0 && (
                                <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346]/40 rounded-none p-fib-13">
                                    <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] leading-relaxed">
                                        <span className="font-bold text-[#C68346]">
                                            {t('scanner.procedure_prefix', 'PROCEDIMIENTO:')}
                                        </span>{' '}
                                        {t(
                                            'scanner.procedure_body',
                                            `Capture ${targetPhotoCount} estaciones perimetrales alrededor del acopio para registro fotográfico e inclinometría IMU.`
                                        )}
                                    </p>
                                </div>
                            )}

                            {!isScanning ? (
                                <button
                                    type="button"
                                    onClick={startScan}
                                    className="w-full min-h-[56px] rounded-none bg-[#C68346] text-[#FFFFFF] font-bold text-data-dense tracking-widest uppercase shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                >
                                    {t('scanner.start_scan', 'INICIAR ESCANEO')}
                                </button>
                            ) : (
                                <div className="space-y-fib-13">
                                    <button
                                        type="button"
                                        onClick={captureScanPhoto}
                                        className="w-full min-h-[56px] rounded-none bg-[#C68346] text-[#FFFFFF] font-bold text-data-dense tracking-widest uppercase font-mono tabular-nums shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                    >
                                        {t('scanner.capture_station', 'CAPTURAR ESTACIÓN')}{' '}
                                        {scanPhotos.length + 1}
                                    </button>

                                    {scanPhotos.length >= targetPhotoCount && (
                                        <button
                                            type="button"
                                            onClick={stopScan}
                                            className="w-full min-h-[56px] rounded-none bg-[#00AEEF] text-[#000000] font-bold text-data-dense tracking-widest uppercase shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                        >
                                            {t('scanner.finish_scan', 'FINALIZAR ESCANEO')}
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={resetScan}
                                        className="w-full min-h-[55px] rounded-none border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6] font-bold text-microcopy tracking-widest uppercase shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                    >
                                        {t('scanner.reset_scan', 'REINICIAR ESCANEO')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. COTAS DECLARADAS + SUGERENCIA IA (HITL) */}
                    {scanComplete && (
                        <div className="space-y-fib-21">
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346]/40 rounded-none p-fib-13 flex items-center justify-between gap-fib-13">
                                <div className="flex flex-col gap-1">
                                    <span className="text-data-dense font-bold text-[#C68346] uppercase">
                                        {t('scanner.scan_completed', 'ESCANEO COMPLETADO')}
                                    </span>
                                    <span className="text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                        {scanPhotos.length}{' '}
                                        {t('scanner.stations_registered', 'estaciones registradas con telemetría IMU')}
                                        {textureData ? ` · L=${textureData.mean} σ=${textureData.stdDev}` : ''}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={resetScan}
                                    className="min-w-[55px] min-h-[55px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] rounded-none shadow-none cursor-pointer"
                                >
                                    {t('scanner.redo_scan', 'REHACER')}
                                </button>
                            </div>

                            {(isAnalyzingVision || isDigestingBoulderCrop) && (
                                <div className="space-y-fib-8">
                                    <M3LinearProgress
                                        indeterminate
                                        ariaLabel={t(
                                            'rosin_rammler.analyzing_boulders',
                                            'ANALIZANDO COLPAS Y CURVA RRSB...'
                                        )}
                                    />
                                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t(
                                            'rosin_rammler.analyzing_boulders',
                                            'ANALIZANDO COLPAS Y CURVA RRSB...'
                                        )}
                                    </span>
                                </div>
                            )}

                            {aiSuggestion && (
                                <div className="p-fib-13 border border-[#00AEEF]/40 bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none space-y-fib-13">
                                    <div className="flex items-center justify-between text-microcopy font-mono font-bold uppercase text-[#00AEEF]">
                                        <span>{t('capture.ai_hitl_title', 'REVISIÓN DE GRANULOMETRÍA IA (HITL)')}</span>
                                        <span className="tabular-nums">
                                            {aiSuggestion.verified && typeof aiSuggestion.confidence === 'number'
                                                ? `${t('scanner.ai_confidence', 'CONFIANZA')} ${(aiSuggestion.confidence * 100).toFixed(0)}%`
                                                : t('scanner.ai_offline', 'SIN CONEXIÓN IA')}
                                        </span>
                                    </div>

                                    {aiSuggestion.verified ? (
                                        <>
                                            <div className="space-y-fib-8 border-t border-b border-[#E2E8F0] dark:border-[#12151C] py-fib-8">
                                                <div className="flex items-center justify-between gap-fib-8 text-data-dense font-mono tabular-nums">
                                                    <span className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('scanner.granulometry_label', 'GRANULOMETRÍA')}
                                                    </span>
                                                    <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                        [{t('capture.ai_current_label', 'ACTUAL')}:{' '}
                                                        {classification || t('common.pending_record', '[Pendiente de registro]')}] {'->'}{' '}
                                                        <strong className="text-[#00AEEF]">
                                                            [{t('capture.ai_suggested_label', 'SUGERIDO IA')}:{' '}
                                                            {suggestedClassification || t('common.undeclared_tech_data', '[Información técnica no declarada en ficha]')}]
                                                        </strong>
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-fib-8 text-data-dense font-mono tabular-nums">
                                                    <span className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('manual_capture.fields.density_factor', 'FACTOR DENSIDAD (t/m³)')}
                                                    </span>
                                                    <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                        [{t('capture.ai_current_label', 'ACTUAL')}:{' '}
                                                        {density || t('common.pending_record', '[Pendiente de registro]')}] {'->'}{' '}
                                                        <strong className="text-[#00AEEF]">
                                                            [{t('capture.ai_suggested_label', 'SUGERIDO IA')}:{' '}
                                                            {typeof aiSuggestion.suggestedFactor === 'number'
                                                                ? aiSuggestion.suggestedFactor.toFixed(2)
                                                                : t('common.undeclared_tech_data', '[Información técnica no declarada en ficha]')}]
                                                        </strong>
                                                    </span>
                                                </div>

                                                {/* Telemetría Rosin-Rammler y box_2d */}
                                                <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                                    <div className="flex items-center justify-between gap-fib-8">
                                                        <span className="text-microcopy font-mono font-bold uppercase text-[#C68346]">
                                                            {t(
                                                                'rosin_rammler.title',
                                                                'DISTRIBUCIÓN GRANULOMÉTRICA ROSIN-RAMMLER (RRSB)'
                                                            )}
                                                        </span>
                                                        {(photoBlob || visionSourceDataUrl) && (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    void runBoulderReanalysis()
                                                                }
                                                                disabled={isAnalyzingVision}
                                                                className="bg-transparent border border-[#E2E8F0] dark:border-[#12151C] px-fib-8 py-1 text-microcopy font-mono uppercase text-[#00AEEF] hover:border-[#00AEEF] disabled:opacity-40 rounded-none cursor-pointer"
                                                            >
                                                                {t(
                                                                    'rosin_rammler.analyze_boulders_button',
                                                                    'ANALIZAR COLPAS (RRSB)'
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-fib-8 text-data-dense font-mono tabular-nums">
                                                        <div>
                                                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                                {t('rosin_rammler.p80_label', 'P80 (mm)')}
                                                            </span>
                                                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {effectiveRosinRammler?.p80_mm != null
                                                                    ? `${effectiveRosinRammler.p80_mm.toFixed(1)} mm`
                                                                    : t(
                                                                        'common.undeclared_tech_data',
                                                                        '[Información técnica no declarada en ficha]'
                                                                    )}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                                {t('rosin_rammler.p50_label', 'P50 (mm)')}
                                                            </span>
                                                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {effectiveRosinRammler?.p50_mm != null
                                                                    ? `${effectiveRosinRammler.p50_mm.toFixed(1)} mm`
                                                                    : t(
                                                                        'common.undeclared_tech_data',
                                                                        '[Información técnica no declarada en ficha]'
                                                                    )}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                                {t('rosin_rammler.xc_label', 'xc (mm)')}
                                                            </span>
                                                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {effectiveRosinRammler?.xc_mm != null
                                                                    ? `${effectiveRosinRammler.xc_mm.toFixed(1)} mm`
                                                                    : t(
                                                                        'common.undeclared_tech_data',
                                                                        '[Información técnica no declarada en ficha]'
                                                                    )}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                                {t('rosin_rammler.uniformity_n_label', 'Uniformidad (n)')}
                                                            </span>
                                                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {effectiveRosinRammler?.uniformity_n != null
                                                                    ? effectiveRosinRammler.uniformity_n.toFixed(2)
                                                                    : t(
                                                                        'common.undeclared_tech_data',
                                                                        '[Información técnica no declarada en ficha]'
                                                                    )}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between gap-fib-8 text-data-dense font-mono tabular-nums">
                                                        <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                            {t(
                                                                'rosin_rammler.boulders_detected_title',
                                                                'COLPAS DETECTADAS (box_2d)'
                                                            )}
                                                        </span>
                                                        <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {displayBoulders.length}{' '}
                                                            {oversizeBoulderCount > 0
                                                                ? `(${oversizeBoulderCount} >= 250 mm)`
                                                                : ''}
                                                        </span>
                                                    </div>

                                                    {!declaredScaleMeters && (
                                                        <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                                            {t(
                                                                'rosin_rammler.reference_width_required',
                                                                'Declare Ancho Referencia (m) > 0 para escalar en milímetros.'
                                                            )}
                                                        </p>
                                                    )}

                                                    {boulderCropTrace && (
                                                        <div className="p-fib-8 border border-[#00AEEF]/40 bg-[#FFFFFF] dark:bg-[#000000] text-microcopy font-mono tabular-nums">
                                                            <span className="block uppercase text-[#475569] dark:text-[#8A93A6]">
                                                                {t(
                                                                    'rosin_rammler.crop_cas_trace',
                                                                    'TRAZA CAS RECORTE'
                                                                )}
                                                            </span>
                                                            <span className="text-[#00AEEF] break-all select-text">
                                                                {boulderCropTrace.traceText}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                {aiSuggestion.reasoning}
                                            </p>
                                            {aiReviewStatus === 'pending' ? (
                                                <div className="grid grid-cols-2 gap-fib-8">
                                                    <button
                                                        type="button"
                                                        onClick={acceptAiSuggestion}
                                                        className="min-h-[55px] px-fib-13 bg-[#00AEEF] text-[#000000] font-bold text-microcopy font-mono uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                                    >
                                                        {t('capture.ai_hitl_accept', 'ACEPTAR SUGERENCIA')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={rejectAiSuggestion}
                                                        className="min-h-[55px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] font-bold text-microcopy font-mono uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                                                    >
                                                        {t('capture.ai_hitl_discard', 'DESCARTAR')}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between gap-fib-8 pt-1">
                                                    <span
                                                        className={`text-microcopy font-mono font-bold uppercase ${aiReviewStatus === 'accepted'
                                                            ? 'text-[#00AEEF]'
                                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                                            }`}
                                                    >
                                                        {aiReviewStatus === 'accepted'
                                                            ? t(
                                                                'scanner.ai_accepted_notice',
                                                                'SUGERENCIA IA ACEPTADA POR OPERADOR'
                                                            )
                                                            : t('scanner.ai_rejected_notice', 'SUGERENCIA IA DESCARTADA')}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAiReviewStatus('pending')}
                                                        className="min-h-[55px] px-fib-8 bg-transparent border-0 text-microcopy font-mono uppercase text-[#C68346] cursor-pointer"
                                                    >
                                                        {t('scanner.ai_review_again', 'REVISAR')}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                            {aiSuggestion.reasoning}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Dictado manos libres */}
                            <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none space-y-fib-8">
                                <span className="block text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase">
                                    {t('scanner.voice_title', 'DICTADO POR VOZ EN TERRENO')}
                                </span>
                                <SovereignVoiceInput
                                    module="stockpile"
                                    contextPath="/geolapp/scanner"
                                    onTranscript={handleVoiceSpecs}
                                />
                                {voiceStatusMsg && (
                                    <p className="text-microcopy font-mono text-[#00AEEF] select-text">
                                        {voiceStatusMsg}
                                    </p>
                                )}
                            </div>

                            {/* Cotas Geométricas Reales */}
                            <div className="space-y-fib-13">
                                <span className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase">
                                    {t('scanner.declared_dimensions_title', 'COTAS GEOMÉTRICAS MEDIDAS / ESTIMADAS (m)')}
                                </span>
                                <div className="grid grid-cols-3 gap-fib-8">
                                    <div className="flex flex-col gap-fib-8">
                                        <label
                                            htmlFor="scanner-major-axis"
                                            className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase"
                                        >
                                            {t('manual_capture.fields.major_axis_base', 'EJE MAYOR BASE (m)')}
                                        </label>
                                        <input
                                            id="scanner-major-axis"
                                            type="text"
                                            inputMode="decimal"
                                            value={baseMajorAxis}
                                            onChange={(e) =>
                                                setBaseMajorAxis(sanitizeDecimalText(e.target.value))
                                            }
                                            placeholder="0.0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full min-h-[55px] px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-fib-8">
                                        <label
                                            htmlFor="scanner-minor-axis"
                                            className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase"
                                        >
                                            {t('manual_capture.fields.minor_axis_base', 'EJE MENOR BASE (m)')}
                                        </label>
                                        <input
                                            id="scanner-minor-axis"
                                            type="text"
                                            inputMode="decimal"
                                            value={baseMinorAxis}
                                            onChange={(e) =>
                                                setBaseMinorAxis(sanitizeDecimalText(e.target.value))
                                            }
                                            placeholder="0.0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full min-h-[55px] px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-fib-8">
                                        <label
                                            htmlFor="scanner-total-height"
                                            className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase"
                                        >
                                            {t('manual_capture.fields.total_height', 'ALTURA TOTAL (m)')}
                                        </label>
                                        <input
                                            id="scanner-total-height"
                                            type="text"
                                            inputMode="decimal"
                                            value={totalHeight}
                                            onChange={(e) =>
                                                setTotalHeight(sanitizeDecimalText(e.target.value))
                                            }
                                            placeholder="0.0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full min-h-[55px] px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Clasificación */}
                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase">
                                    {t('scanner.classification_title', 'CLASIFICACIÓN DEL MATERIAL')}
                                </span>
                                <div className="grid grid-cols-3 gap-fib-8">
                                    {(['COLPA', 'GRANSA', 'FINO'] as const).map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setClassification(c)}
                                            className={`min-h-[55px] rounded-none shadow-none font-bold font-mono text-data-dense transition-colors border cursor-pointer ${classification === c
                                                ? 'bg-[#C68346] text-[#FFFFFF] border-[#C68346]'
                                                : 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0] dark:bg-[#07090D] dark:text-[#8A93A6] dark:border-[#12151C]'
                                                }`}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Densidad */}
                            <div className="flex flex-col gap-fib-8">
                                <label
                                    htmlFor="scanner-density"
                                    className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase"
                                >
                                    {t('manual_capture.fields.density_factor', 'FACTOR DENSIDAD (t/m³)')}
                                </label>
                                <input
                                    id="scanner-density"
                                    type="text"
                                    inputMode="decimal"
                                    value={density}
                                    onChange={(e) => setDensity(sanitizeDecimalText(e.target.value))}
                                    className="w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none min-h-[55px] h-14 px-fib-21 text-2xl font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none focus:border-[#C68346] transition-colors text-center tracking-tight"
                                    placeholder="0.00"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>

                            {/* Especialización Cobre (Cu) + Gobernanza */}
                            <div className="space-y-fib-21">
                                <CopperDomainSelector
                                    value={copperDomain}
                                    onChange={setCopperDomain}
                                />
                                <CopperAssayInputs
                                    idPrefix="scanner-cu"
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
                                    metallurgy={copperMetallurgy}
                                    showMassBreakdown={true}
                                />
                                <CopperGovernanceBanner result={governanceResult} />
                            </div>

                            {/* Volumen Calculado */}
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none p-fib-21 flex flex-col items-center gap-fib-8 shadow-none">
                                <span className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-[0.2em] uppercase">
                                    {t('manual_capture.estimated_volume', 'VOLUMEN CALCULADO')}
                                </span>
                                {declaredVolume > 0 ? (
                                    <div className="flex items-baseline gap-fib-8">
                                        <span className="text-4xl font-bold font-mono tabular-nums text-[#C68346] tracking-tight">
                                            {declaredVolume.toFixed(2)}
                                        </span>
                                        <span className="text-body-main font-bold font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                                            m³
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                        {t(
                                            'common.undeclared_tech_data',
                                            '[Información técnica no declarada en ficha]'
                                        )}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Botón de Guardado */}
                    {scanComplete && (
                        <div className="pt-fib-13 pb-fib-55 flex justify-center">
                            <button
                                type="submit"
                                disabled={
                                    isSaving ||
                                    !classification ||
                                    !(parseFloat(density) > 0) ||
                                    declaredVolume <= 0
                                }
                                className={`w-full min-h-[56px] rounded-none shadow-none flex items-center justify-center transition-colors cursor-pointer ${isSaving ||
                                    !classification ||
                                    !(parseFloat(density) > 0) ||
                                    declaredVolume <= 0
                                    ? 'bg-[#F8FAFC] text-[#94A3B8] dark:bg-[#07090D] dark:text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C] cursor-not-allowed'
                                    : 'bg-[#C68346] text-[#FFFFFF] font-bold'
                                    }`}
                            >
                                {isSaving ? (
                                    <M3CircularProgress
                                        size={24}
                                        strokeWidth={3}
                                        indeterminate
                                        ariaLabel={t('manual_capture.saving_measurement', 'Guardando medición')}
                                    />
                                ) : (
                                    <span className="text-data-dense tracking-widest uppercase">
                                        {t('manual_capture.save_measurement')}
                                    </span>
                                )}
                            </button>
                        </div>
                    )}
                </form>
            </main>
        </div>
    );
};
