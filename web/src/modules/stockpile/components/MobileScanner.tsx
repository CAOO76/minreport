import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { Geolocation } from '@capacitor/geolocation';
import { Motion } from '@capacitor/motion';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { dataService } from '../services/DataService';
import { storageService } from '../services/StorageService';
import { calculationEngine } from '../services/calculation-engine';
import { visionIAService, type VisionSuggestion } from '../services/vision-ia';
import { compressImage } from '../utils/imageOptimizer';
import { auth } from '../config/firebase.config';

interface MobileScannerProps {
    assetId: string;
    onSuccess: (measurementId: string) => void;
    onBack: () => void;
}

/**
 * Extrae características reales de luminancia y contraste desde los píxeles del fotograma
 * liberando memoria del canvas inmediatamente (Cero datos inventados).
 */
async function extractRealTextureFeatures(imageSrc: string): Promise<{ mean: number; stdDev: number } | null> {
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
                    const lum = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
                    luminances.push(lum);
                }

                if (luminances.length === 0) {
                    resolve(null);
                    return;
                }

                const mean = luminances.reduce((acc, v) => acc + v, 0) / luminances.length;
                const variance = luminances.reduce((acc, v) => acc + (v - mean) ** 2, 0) / luminances.length;
                const stdDev = Math.sqrt(variance);
                resolve({
                    mean: Number(mean.toFixed(2)),
                    stdDev: Number(stdDev.toFixed(2))
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

/**
 * MobileScanner - MEDICIÓN DIGITAL (IA + Telemetría IMU)
 * Cumple GEMINI.md §3.1: Cero volúmenes, texturas o densidades inventadas.
 * Exige cotas base/altura declaradas por el operador e inferencia verificada con HITL.
 */
export const MobileScanner: React.FC<MobileScannerProps> = ({ assetId, onSuccess, onBack }) => {
    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);

    const [scanPhotos, setScanPhotos] = useState<Array<{ previewUrl: string; imu: { alpha: number; beta: number; gamma: number; accel_x: number; accel_y: number; accel_z: number } }>>([]);
    const targetPhotoCount = 5;

    // Cotas geométricas explícitas declaradas por el operador (Cono Elíptico)
    const [baseMajorAxis, setBaseMajorAxis] = useState('');
    const [baseMinorAxis, setBaseMinorAxis] = useState('');
    const [totalHeight, setTotalHeight] = useState('');

    // Inputs granulométricos del operador + Sugerencia IA (HITL)
    const [classification, setClassification] = useState<'COLPA' | 'GRANSA' | 'FINO' | null>(null);
    const [density, setDensity] = useState('');
    const [aiSuggestion, setAiSuggestion] = useState<VisionSuggestion | null>(null);

    const [isSaving, setIsSaving] = useState(false);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
    const [userId, setUserId] = useState<string>('');

    const [imuData, setImuData] = useState({
        alpha: 0, beta: 45, gamma: 0,
        accel_x: 0, accel_y: 0, accel_z: 0
    });
    const [, setIsGroundDetected] = useState(false);

    const [textureData, setTextureData] = useState<{ mean: number; stdDev: number } | null>(null);

    useEffect(() => {
        const initMetadata = async () => {
            try {
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
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
        let motionListener: any;
        const initSensors = async () => {
            try {
                motionListener = await Motion.addListener('orientation', (event) => {
                    setImuData({
                        alpha: event.alpha || 0,
                        beta: event.beta || 45,
                        gamma: event.gamma || 0,
                        accel_x: 0,
                        accel_y: 0,
                        accel_z: 0
                    });
                    const isHorizontal = Math.abs((event.beta || 0) - 90) < 15;
                    setIsGroundDetected(isHorizontal);
                });
            } catch (err) {
                console.warn('[Scanner] IMU Error:', err);
            }
        };
        void initSensors();
        return () => {
            if (motionListener) motionListener.remove();
        };
    }, []);

    useEffect(() => {
        return () => {
            if (photoPreview && photoPreview.startsWith('blob:')) {
                URL.revokeObjectURL(photoPreview);
            }
        };
    }, [photoPreview]);

    const captureReferencePhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 60,
                width: 800,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false
            });
            if (image.dataUrl) {
                const optimized = await compressImage(image.dataUrl, { profile: 'evidence' });
                const blob = await fetch(optimized).then(r => r.blob());
                const preview = URL.createObjectURL(blob);
                setPhotoBlob(blob);
                setPhotoPreview(prev => {
                    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return preview;
                });

                const realTexture = await extractRealTextureFeatures(optimized);
                setTextureData(realTexture);

                visionIAService.analyzeTexture(optimized).then((suggestion) => {
                    setAiSuggestion(suggestion);
                    if (suggestion.verified && suggestion.granulometry) {
                        const mapped =
                            suggestion.granulometry === 'COLPAS'
                                ? 'COLPA'
                                : suggestion.granulometry === 'FINOS'
                                ? 'FINO'
                                : 'GRANSA';
                        setClassification(prev => prev || mapped);
                    }
                    if (suggestion.verified && typeof suggestion.suggestedFactor === 'number') {
                        setDensity(prev => prev || String(suggestion.suggestedFactor));
                    }
                }).catch(() => {});
            }
        } catch (err) {
            console.warn('[Scanner] Captura cancelada:', err);
        }
    };

    const startScan = () => {
        setIsScanning(true);
        setScanPhotos([]);
    };

    const captureScanPhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 50,
                width: 600,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false
            });
            if (image.dataUrl) {
                const optimized = await compressImage(image.dataUrl, { profile: 'scan' });
                const blob = await fetch(optimized).then(r => r.blob());
                const previewUrl = URL.createObjectURL(blob);
                setScanPhotos(prev => [
                    ...prev,
                    {
                        previewUrl,
                        imu: { ...imuData }
                    }
                ]);
                if (!textureData) {
                    const realTexture = await extractRealTextureFeatures(optimized);
                    if (realTexture) setTextureData(realTexture);
                }
            }
        } catch (err) {
            console.warn('[Scanner] Captura cancelada:', err);
        }
    };

    const declaredVolume = useMemo(() => {
        const a = parseFloat(baseMajorAxis) || 0;
        const b = parseFloat(baseMinorAxis) || 0;
        const h = parseFloat(totalHeight) || 0;
        if (a <= 0 || b <= 0 || h <= 0) return 0;
        return calculationEngine.calculateEllipticCone(a, b, h);
    }, [baseMajorAxis, baseMinorAxis, totalHeight]);

    const stopScan = () => {
        if (scanPhotos.length < targetPhotoCount) {
            toast.warning(`Se requieren al menos ${targetPhotoCount} capturas perimetrales (${scanPhotos.length}/${targetPhotoCount}).`);
            return;
        }
        setIsScanning(false);
        setScanComplete(true);
    };

    const handleSave = async () => {
        const parsedDensity = parseFloat(density) || 0;
        if (!classification || parsedDensity <= 0 || !photoBlob || !scanComplete || declaredVolume <= 0) {
            toast.warning('Complete evidencia, escaneo, cotas geométricas reales (eje mayor, eje menor, altura), clasificación y densidad.');
            return;
        }

        setIsSaving(true);
        try {
            const weightT = calculationEngine.computeTotalMass(declaredVolume, parsedDensity);
            const uploadResult = await storageService.uploadStockpileImage(photoBlob, assetId);
            const finalPhotoUrl = uploadResult.url;
            const uploadDeferred = finalPhotoUrl.startsWith('offline-cas://');

            if (aiSuggestion && aiSuggestion.verified && aiSuggestion.granulometry) {
                const finalGran = classification === 'COLPA' ? 'COLPAS' : classification === 'FINO' ? 'FINOS' : 'GRANSA';
                await visionIAService.recordOperatorFeedback(
                    aiSuggestion,
                    aiSuggestion.granulometry === finalGran,
                    finalGran
                );
            }

            const a = parseFloat(baseMajorAxis) || 0;
            const b = parseFloat(baseMinorAxis) || 0;
            const h = parseFloat(totalHeight) || 0;

            const measurementData: any = {
                assetId,
                timestamp: Date.now(),
                volumen_m3: declaredVolume,
                peso_t: weightT,
                density_factor: parsedDensity,
                granulometry: classification === 'COLPA' ? 'COLPAS' : classification === 'FINO' ? 'FINOS' : 'GRANSA',
                method: 'digital',
                photo_url: finalPhotoUrl,
                geometry: {
                    type: 'CONO_ELIPTICO',
                    dimensions: { a, b, h }
                },
                operator_classification: classification,
                operator_density: parsedDensity,
                imu_data: {
                    alpha: imuData.alpha,
                    beta: imuData.beta,
                    gamma: imuData.gamma,
                    accel_x: imuData.accel_x,
                    accel_y: imuData.accel_y,
                    accel_z: imuData.accel_z
                },
                scan_photo_count: scanPhotos.length,
                offline_pending: uploadDeferred
            };

            if (aiSuggestion?.verified && typeof aiSuggestion.confidence === 'number') {
                measurementData.ai_confidence = Math.round(aiSuggestion.confidence * 100);
            }

            if (textureData) {
                measurementData.texture_features = {
                    mean_luminance: textureData.mean,
                    std_dev: textureData.stdDev
                };
            }

            if (gps) {
                measurementData.location_metadata = {
                    lat: gps.lat,
                    lng: gps.lng,
                    accuracy: gps.acc
                };
            }

            if (userId) {
                measurementData.user_id = userId;
            }

            const measurementId = await dataService.addMeasurement(measurementData);
            onSuccess(measurementId);
        } catch (error: any) {
            console.error('[Scanner] Error guardando medición:', error);
            toast.error(`Error al guardar medición: ${error?.message || 'Fallo de registro'}`);
        } finally {
            setIsSaving(false);
        }
    };

    const sanitizeDecimalInput = (raw: string) => raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');

    return (
        <div className="h-full w-full flex-1 min-h-[600px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden relative transition-colors duration-200 rounded-none shadow-none select-none">

            <header className="flex-none pt-8 pb-4 px-6 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] z-50">
                <div className="flex items-center gap-[13px]">
                    <button
                        type="button"
                        onClick={onBack}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
                        title="Volver"
                        aria-label="Volver"
                    >
                        <span className="material-symbols-outlined text-2xl text-[#C68346]">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">MEDICIÓN</span>
                        <span className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">DIGITAL (IA)</span>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-[21px] py-[34px] relative">
                <div className="max-w-sm mx-auto space-y-[34px] relative z-10">

                    {/* 1. FOTO DE REFERENCIA DEL LUGAR */}
                    <div className="space-y-[13px]">
                        <span className="text-[11px] font-bold tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] uppercase">EVIDENCIA TÉCNICA</span>
                        <div
                            onClick={photoPreview ? undefined : captureReferencePhoto}
                            className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-colors overflow-hidden flex flex-col items-center justify-center cursor-pointer
                                ${photoPreview ? 'border-[#C68346]/60 bg-[#000000]' : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]'}`}
                        >
                            {photoPreview ? (
                                <>
                                    <img
                                        src={photoPreview}
                                        draggable={false}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className="w-full h-full object-cover select-none pointer-events-none"
                                        alt="Evidencia"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                                    <div className="absolute bottom-4 left-4 flex items-center gap-[8px]">
                                        <span className="text-[11px] font-bold text-[#FFFFFF] uppercase tracking-widest bg-[#C68346] px-[8px] py-0.5">CAPTURA REGISTRADA</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setPhotoBlob(null);
                                            setPhotoPreview(null);
                                            setAiSuggestion(null);
                                            setTextureData(null);
                                        }}
                                        className="absolute top-3 right-3 bg-transparent border-0 outline-none p-1 text-white/80 hover:text-white transition-colors cursor-pointer"
                                        title="Eliminar captura"
                                        aria-label="Eliminar captura"
                                    >
                                        <span className="material-symbols-outlined">delete</span>
                                    </button>
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-5xl text-[#94A3B8] dark:text-[#5A6072] mb-2">add_a_photo</span>
                                    <span className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.2em]">CAPTURAR REFERENCIA</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 2. ESCANEO MULTI-FOTO */}
                    {photoPreview && !scanComplete && (
                        <div className="space-y-[13px]">
                            <span className="text-[11px] font-bold tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] uppercase">ESCANEO TÉCNICO</span>

                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none p-[21px] shadow-none">
                                <div className="flex items-center justify-between mb-[13px]">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6]">PROGRESO DEL ESCANEO</span>
                                        <span className={`text-[11px] font-bold font-mono tabular-nums uppercase ${scanPhotos.length >= targetPhotoCount ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6]'}`}>
                                            {scanPhotos.length} / {targetPhotoCount} ESTACIONES
                                        </span>
                                    </div>
                                    <span className="text-xs font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">{imuData.beta.toFixed(1)}°</span>
                                </div>

                                <div className="w-full h-2 bg-[#E2E8F0] dark:bg-[#12151C] rounded-none overflow-hidden">
                                    <div
                                        className="h-full bg-[#C68346] transition-all duration-300"
                                        style={{ width: `${Math.min(100, (scanPhotos.length / targetPhotoCount) * 100)}%` }}
                                    />
                                </div>
                            </div>

                            {!isScanning && scanPhotos.length === 0 && (
                                <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346]/40 rounded-none p-[13px]">
                                    <p className="text-xs text-[#0F172A] dark:text-[#F3F4F6] leading-relaxed">
                                        <span className="font-bold text-[#C68346]">PROCEDIMIENTO:</span> Capture {targetPhotoCount} estaciones perimetrales alrededor del acopio para registro fotográfico e inclinometría IMU.
                                    </p>
                                </div>
                            )}

                            {!isScanning ? (
                                <button
                                    type="button"
                                    onClick={startScan}
                                    className="w-full h-14 rounded-none bg-[#C68346] text-[#FFFFFF] font-bold text-xs tracking-widest uppercase shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                >
                                    INICIAR ESCANEO
                                </button>
                            ) : (
                                <div className="space-y-[13px]">
                                    <button
                                        type="button"
                                        onClick={captureScanPhoto}
                                        className="w-full h-14 rounded-none bg-[#C68346] text-[#FFFFFF] font-bold text-xs tracking-widest uppercase font-mono tabular-nums shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                    >
                                        CAPTURAR ESTACIÓN {scanPhotos.length + 1}
                                    </button>

                                    {scanPhotos.length >= targetPhotoCount && (
                                        <button
                                            type="button"
                                            onClick={stopScan}
                                            className="w-full h-14 rounded-none bg-[#00AEEF] text-[#000000] font-bold text-xs tracking-widest uppercase shadow-none transition-colors flex items-center justify-center cursor-pointer"
                                        >
                                            FINALIZAR ESCANEO
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. COTAS DECLARADAS + SUGERENCIA IA (HITL) */}
                    {scanComplete && (
                        <div className="space-y-[21px]">
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346]/40 rounded-none p-[13px] flex flex-col gap-1">
                                <span className="text-xs font-bold text-[#C68346] uppercase">ESCANEO COMPLETADO</span>
                                <span className="text-[12px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                    {scanPhotos.length} estaciones registradas con telemetría IMU
                                    {textureData ? ` · L=${textureData.mean} σ=${textureData.stdDev}` : ''}
                                </span>
                            </div>

                            {aiSuggestion && (
                                <div className="p-[13px] border border-[#00AEEF]/40 bg-[#F8FAFC] dark:bg-[#07090D] rounded-none space-y-[8px]">
                                    <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase text-[#00AEEF]">
                                        <span>DIAGNÓSTICO IA GRANULOMÉTRICO</span>
                                        <span className="tabular-nums">
                                            {aiSuggestion.verified && typeof aiSuggestion.confidence === 'number'
                                                ? `CONFIANZA ${(aiSuggestion.confidence * 100).toFixed(0)}%`
                                                : 'SIN CONEXIÓN IA'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-[#0F172A] dark:text-[#F3F4F6]">{aiSuggestion.reasoning}</p>
                                </div>
                            )}

                            {/* Cotas Geométricas Reales (Obligatorias — Cero Volumen Inventado) */}
                            <div className="space-y-[13px]">
                                <span className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase">
                                    COTAS GEOMÉTRICAS MEDIDAS / ESTIMADAS (m)
                                </span>
                                <div className="grid grid-cols-3 gap-[8px]">
                                    <div className="flex flex-col gap-[8px]">
                                        <label className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase">EJE MAYOR</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={baseMajorAxis}
                                            onChange={(e) => setBaseMajorAxis(sanitizeDecimalInput(e.target.value))}
                                            placeholder="0.0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full h-12 px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-base font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-[8px]">
                                        <label className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase">EJE MENOR</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={baseMinorAxis}
                                            onChange={(e) => setBaseMinorAxis(sanitizeDecimalInput(e.target.value))}
                                            placeholder="0.0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full h-12 px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-base font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-[8px]">
                                        <label className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase">ALTURA (H)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={totalHeight}
                                            onChange={(e) => setTotalHeight(sanitizeDecimalInput(e.target.value))}
                                            placeholder="0.0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full h-12 px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-base font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Clasificación */}
                            <div className="flex flex-col gap-[8px]">
                                <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase">
                                    CLASIFICACIÓN DEL MATERIAL
                                </label>
                                <div className="grid grid-cols-3 gap-[8px]">
                                    {(['COLPA', 'GRANSA', 'FINO'] as const).map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setClassification(c)}
                                            className={`h-12 rounded-none shadow-none font-bold font-mono text-xs transition-colors border cursor-pointer ${
                                                classification === c
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
                            <div className="flex flex-col gap-[8px]">
                                <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase">
                                    FACTOR DENSIDAD DECLARADO (T/m³)
                                </label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={density}
                                    onChange={(e) => setDensity(sanitizeDecimalInput(e.target.value))}
                                    className="w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none h-14 px-6 text-2xl font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none focus:border-[#C68346] transition-colors text-center tracking-tight"
                                    placeholder="0.00"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>

                            {/* 4. VOLUMEN CALCULADO */}
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none p-[21px] flex flex-col items-center gap-[8px] shadow-none">
                                <span className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] tracking-[0.2em] uppercase">VOLUMEN CALCULADO</span>
                                {declaredVolume > 0 ? (
                                    <div className="flex items-baseline gap-[8px]">
                                        <span className="text-4xl font-bold font-mono tabular-nums text-[#C68346] tracking-tight">
                                            {declaredVolume.toFixed(2)}
                                        </span>
                                        <span className="text-sm font-bold font-mono text-[#475569] dark:text-[#8A93A6] uppercase">m³</span>
                                    </div>
                                ) : (
                                    <span className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">[Pendiente de registro de cotas]</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Botón de Guardado */}
                    {scanComplete && (
                        <div className="pt-4 pb-12 flex justify-center">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={isSaving || !classification || !(parseFloat(density) > 0) || declaredVolume <= 0}
                                className={`w-full h-14 rounded-none shadow-none flex items-center justify-center transition-colors cursor-pointer
                                    ${
                                        isSaving || !classification || !(parseFloat(density) > 0) || declaredVolume <= 0
                                            ? 'bg-[#F8FAFC] text-[#94A3B8] dark:bg-[#07090D] dark:text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C] cursor-not-allowed'
                                            : 'bg-[#C68346] text-[#FFFFFF] font-bold'
                                    }`}
                            >
                                {isSaving ? (
                                    <span className="material-symbols-outlined text-2xl animate-spin">sync</span>
                                ) : (
                                    <span className="text-xs tracking-widest uppercase">GUARDAR MEDICIÓN</span>
                                )}
                            </button>
                        </div>
                    )}

                </div>
            </main>
        </div>
    );
};
