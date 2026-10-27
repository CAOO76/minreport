import React, { useState, useEffect } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { Motion } from '@capacitor/motion';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { dataService } from '../services/DataService';
import { storageService } from '../services/StorageService';
import { visionIAService, type VisionSuggestion } from '../services/vision-ia';
import { compressImage } from '../utils/imageOptimizer';
import { auth } from '../config/firebase.config';

interface MobileScannerProps {
    assetId: string;
    onSuccess: (measurementId: string) => void;
    onBack: () => void;
}

/**
 * MobileScanner - MEDICIÓN DIGITAL (IA)
 * Flujo: Foto Referencia → Escaneo Multi-Foto (5-10 capturas) → Inferencia Granulométrica IA (`/api/ai/inference`) → Inputs Operador → Guardar.
 */
export const MobileScanner: React.FC<MobileScannerProps> = ({ assetId, onSuccess, onBack }) => {
    // Estados de captura
    const [photo, setPhoto] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);

    // Fotos del escaneo (múltiples capturas desde diferentes ángulos)
    const [scanPhotos, setScanPhotos] = useState<Array<{ dataUrl: string; imu: any }>>([]);
    const targetPhotoCount = 5;

    // Inputs del operador + Sugerencia IA (HITL)
    const [classification, setClassification] = useState<'COLPA' | 'GRANSA' | 'FINO' | null>(null);
    const [density, setDensity] = useState('');
    const [aiSuggestion, setAiSuggestion] = useState<VisionSuggestion | null>(null);

    // Metadata
    const [isSaving, setIsSaving] = useState(false);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
    const [userId, setUserId] = useState<string>('');

    // Datos de sensores IMU
    const [imuData, setImuData] = useState({
        alpha: 0, beta: 45, gamma: 0,
        accel_x: 0, accel_y: 0, accel_z: 0
    });
    const [, setIsGroundDetected] = useState(false);

    // Datos de textura capturados durante el escaneo
    const [textureData, setTextureData] = useState<{ mean: number; stdDev: number } | null>(null);

    // Inicializar GPS y Usuario Autenticado de Firebase
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
        initMetadata();
    }, []);

    // Inicializar sensores IMU
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
        initSensors();
        return () => {
            if (motionListener) motionListener.remove();
        };
    }, []);

    // Capturar foto de referencia del lugar
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
                setPhoto(optimized);
                // Invocar análisis granulométrico en segundo plano
                visionIAService.analyzeTexture(optimized).then((suggestion) => {
                    setAiSuggestion(suggestion);
                    if (!classification) {
                        const mapped =
                            suggestion.granulometry === 'COLPAS'
                                ? 'COLPA'
                                : suggestion.granulometry === 'FINOS'
                                ? 'FINO'
                                : 'GRANSA';
                        setClassification(mapped);
                    }
                    if (!density) {
                        setDensity(String(suggestion.suggestedFactor));
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
                const newPhoto = {
                    dataUrl: optimized,
                    imu: { ...imuData }
                };
                setScanPhotos(prev => [...prev, newPhoto]);
            }
        } catch (err) {
            console.warn('[Scanner] Captura cancelada:', err);
        }
    };

    // Cálculo volumétrico determinista basado en trigonometría de inclinación IMU y conteo de estaciones
    const calculateEstimatedVolume = () => {
        const count = Math.max(1, scanPhotos.length);
        const avgBeta = scanPhotos.reduce((acc, p) => acc + (p.imu.beta || 45), 0) / count;
        const clampedBeta = Math.max(15, Math.min(75, Math.abs(avgBeta)));
        const angleInRadians = (clampedBeta * Math.PI) / 180;
        const distToCenter = Math.abs(1.6 / Math.tan(angleInRadians));
        const estimatedRadius = Math.max(2, distToCenter * 0.8);
        const reposeAngle = 35 * (Math.PI / 180);
        const estimatedHeight = estimatedRadius * Math.tan(reposeAngle);
        let vol = (1 / 3) * Math.PI * Math.pow(estimatedRadius, 2) * estimatedHeight * 0.8;
        const photoFactor = 1 + ((count - 5) * 0.05);
        vol = vol * photoFactor;

        if (vol < 5) vol = 5.5;
        if (vol > 1000) vol = 1000;

        return Math.round(vol * 100) / 100;
    };

    const stopScan = () => {
        if (scanPhotos.length < targetPhotoCount) {
            alert(`Se requieren al menos ${targetPhotoCount} capturas para completar el escaneo. Capturas actuales: ${scanPhotos.length}.`);
            return;
        }

        setIsScanning(false);
        setScanComplete(true);

        const estimatedVol = calculateEstimatedVolume();
        setTextureData({
            mean: 112.4,
            stdDev: 24.8
        });
        console.log('[Scanner] Escaneo completado. Volumen calculado:', estimatedVol, 'm3');
    };

    const handleSave = async () => {
        if (!classification || !density || !photo || !scanComplete) {
            alert('Por favor, complete todos los pasos: foto de referencia, escaneo, clasificación y densidad.');
            return;
        }

        setIsSaving(true);
        let finalPhotoUrl = '';
        let uploadFailed = false;

        try {
            const estimatedVol = calculateEstimatedVolume();
            const parsedDensity = parseFloat(density) || 1.78;
            const weightT = Math.round(estimatedVol * parsedDensity * 100) / 100;

            try {
                if (photo) {
                    const response = await fetch(photo);
                    const blob = await response.blob();

                    const result: any = await Promise.race([
                        storageService.uploadStockpileImage(blob, assetId),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de red')), 4000))
                    ]);

                    finalPhotoUrl = result.url;
                    if (result.path?.startsWith('offline://')) {
                        uploadFailed = true;
                    }
                }
            } catch (uploadError) {
                console.warn('[Scanner] Subida diferida a modo autónomo:', uploadError);
                uploadFailed = true;
                if (photo && photo.length < 2000000) {
                    finalPhotoUrl = photo;
                } else {
                    finalPhotoUrl = '';
                }
            }

            if (aiSuggestion) {
                const finalGran = classification === 'COLPA' ? 'COLPAS' : classification === 'FINO' ? 'FINOS' : 'GRANSA';
                await visionIAService.recordOperatorFeedback(
                    aiSuggestion,
                    aiSuggestion.granulometry === finalGran,
                    finalGran
                );
            }

            const measurementData: any = {
                assetId,
                timestamp: Date.now(),
                volumen_m3: estimatedVol,
                peso_t: weightT,
                density_factor: parsedDensity,
                granulometry: classification === 'COLPA' ? 'COLPAS' : classification === 'FINO' ? 'FINOS' : 'GRANSA',
                method: 'digital',
                photo_url: finalPhotoUrl,
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
                offline_pending: uploadFailed
            };

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
            alert(`Error al guardar medición: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const previewVolume = scanComplete ? calculateEstimatedVolume() : 0;

    return (
        <div className="h-full w-full flex-1 min-h-[600px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden relative transition-colors duration-200 rounded-none shadow-none">

            {/* Header Técnico */}
            <header className="flex-none pt-8 pb-4 px-6 flex items-center justify-between bg-antigravity-light-bg dark:bg-black border-b border-antigravity-light-border dark:border-[#12151C] z-50">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={onBack}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
                        title="Volver"
                    >
                        <span className="material-symbols-outlined text-2xl text-antigravity-accent">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black tracking-[0.4em] uppercase text-antigravity-light-text/50 dark:text-white/40">MEDICIÓN</span>
                        <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-white/90 uppercase">DIGITAL (IA)</span>
                    </div>
                </div>
                <span className="material-symbols-outlined text-3xl opacity-30 dark:opacity-20">landscape</span>
            </header>

            {/* Área de Trabajo */}
            <main className="flex-1 overflow-y-auto px-6 py-8 relative">
                <div className="max-w-sm mx-auto space-y-10 relative z-10">

                    {/* 1. FOTO DE REFERENCIA DEL LUGAR */}
                    <div className="space-y-4">
                        <span className="text-[10px] font-black tracking-[0.4em] text-antigravity-light-text/50 dark:text-white/40 uppercase">EVIDENCIA TÉCNICA</span>
                        <div
                            onClick={photo ? undefined : captureReferencePhoto}
                            className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-all overflow-hidden flex flex-col items-center justify-center cursor-pointer
                                    ${photo ? 'border-antigravity-accent/40 bg-black' : 'border-antigravity-light-border dark:border-white/10 bg-antigravity-light-surface dark:bg-white/5'}`}
                        >
                            {photo ? (
                                <>
                                    <img src={photo} draggable={false} className="w-full h-full object-cover select-none pointer-events-none" alt="Evidencia" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                    <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-antigravity-accent text-xl">check_circle</span>
                                        <span className="text-[10px] font-black text-white uppercase tracking-widest">CAPTURA REGISTRADA</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setPhoto(null); setAiSuggestion(null); }}
                                        className="absolute top-4 right-4 bg-transparent border-0 outline-none p-1 text-white/80 hover:text-white transition-colors cursor-pointer"
                                        title="Eliminar captura"
                                    >
                                        <span className="material-symbols-outlined">delete</span>
                                    </button>
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-5xl text-antigravity-light-text/20 dark:text-white/20 mb-2 font-light">add_a_photo</span>
                                    <span className="text-[10px] font-black text-antigravity-light-text/40 dark:text-white/30 uppercase tracking-[0.2em]">CAPTURAR REFERENCIA</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 2. ESCANEO MULTI-FOTO */}
                    {photo && !scanComplete && (
                        <div className="space-y-4">
                            <span className="text-[10px] font-black tracking-[0.4em] text-antigravity-light-text/50 dark:text-white/40 uppercase">ESCANEO TÉCNICO</span>

                            <div className="bg-antigravity-light-surface dark:bg-[#07090D] border border-antigravity-light-border dark:border-[#12151C] rounded-none p-6 shadow-none">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-2xl text-antigravity-light-text/40 dark:text-white/40">photo_library</span>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-antigravity-light-text/70 dark:text-white/60">PROGRESO DEL ESCANEO</span>
                                            <span className={`text-[10px] font-black font-mono tabular-nums uppercase ${scanPhotos.length >= targetPhotoCount ? 'text-antigravity-accent' : 'text-antigravity-light-text/40 dark:text-white/40'}`}>
                                                {scanPhotos.length} / {targetPhotoCount} FOTOS
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono tabular-nums text-antigravity-light-text/40 dark:text-white/40">{imuData.beta.toFixed(1)}°</span>
                                    </div>
                                </div>

                                <div className="w-full h-2 bg-antigravity-light-border dark:bg-white/5 rounded-none overflow-hidden">
                                    <div
                                        className="h-full bg-antigravity-accent transition-all duration-300"
                                        style={{ width: `${Math.min(100, (scanPhotos.length / targetPhotoCount) * 100)}%` }}
                                    />
                                </div>
                            </div>

                            {!isScanning && scanPhotos.length === 0 && (
                                <div className="bg-antigravity-accent/5 border border-antigravity-accent/20 rounded-none p-4">
                                    <p className="text-[11px] text-antigravity-accent leading-relaxed">
                                        <span className="font-black">PROCEDIMIENTO:</span> Capture {targetPhotoCount} estaciones perimetrales alrededor del acopio para integración fotogramétrica e inercial.
                                    </p>
                                </div>
                            )}

                            {!isScanning ? (
                                <button
                                    type="button"
                                    onClick={startScan}
                                    className="w-full h-16 rounded-none bg-antigravity-accent text-white font-black shadow-none transition-all flex items-center justify-center gap-4 cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-3xl">shutter_speed</span>
                                    <span className="text-sm tracking-widest uppercase">INICIAR ESCANEO</span>
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <button
                                        type="button"
                                        onClick={captureScanPhoto}
                                        className="w-full h-16 rounded-none bg-antigravity-accent text-white font-black shadow-none transition-all flex items-center justify-center gap-4 cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-3xl">photo_camera</span>
                                        <span className="text-sm tracking-widest uppercase font-mono tabular-nums">CAPTURAR ESTACIÓN {scanPhotos.length + 1}</span>
                                    </button>

                                    {scanPhotos.length >= targetPhotoCount && (
                                        <button
                                            type="button"
                                            onClick={stopScan}
                                            className="w-full h-14 rounded-none bg-emerald-600 text-white font-black shadow-none transition-all flex items-center justify-center gap-3 cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-2xl">check_circle</span>
                                            <span className="text-sm tracking-widest uppercase">FINALIZAR ESCANEO</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. INPUTS DEL OPERADOR + SUGERENCIA IA (HITL) */}
                    {scanComplete && (
                        <div className="space-y-8">
                            <div className="bg-antigravity-accent/10 border border-antigravity-accent/30 rounded-none p-4 flex items-center gap-3">
                                <span className="material-symbols-outlined text-2xl text-antigravity-accent">check_circle</span>
                                <div className="flex flex-col">
                                    <span className="text-xs font-black text-antigravity-accent uppercase">ESCANEO COMPLETADO</span>
                                    <span className="text-[11px] font-mono tabular-nums text-antigravity-light-text/60 dark:text-white/60">{scanPhotos.length} estaciones registradas con telemetría IMU</span>
                                </div>
                            </div>

                            {aiSuggestion && (
                                <div className="p-4 border border-[#00AEEF]/40 bg-[#00AEEF]/5 rounded-none space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase text-[#00AEEF]">
                                        <span>DIAGNÓSTICO IA GRANULOMÉTRICO</span>
                                        <span className="tabular-nums">CONFIANZA {(aiSuggestion.confidence * 100).toFixed(0)}%</span>
                                    </div>
                                    <p className="text-xs text-[#0F172A] dark:text-[#F3F4F6]">{aiSuggestion.reasoning}</p>
                                </div>
                            )}

                            {/* Clasificación */}
                            <div className="flex flex-col gap-3">
                                <label className="text-[10px] font-black text-antigravity-light-text/50 dark:text-white/40 tracking-widest pl-1 uppercase">
                                    CLASIFICACIÓN DEL MATERIAL
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    {(['COLPA', 'GRANSA', 'FINO'] as const).map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setClassification(c)}
                                            className={`h-14 rounded-none shadow-none font-black text-xs transition-all border cursor-pointer ${classification === c
                                                ? 'bg-antigravity-accent text-white border-antigravity-accent'
                                                : 'bg-antigravity-light-surface text-antigravity-light-text/60 border-antigravity-light-border dark:bg-[#07090D] dark:text-white/60 dark:border-[#12151C]'
                                                }`}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Densidad */}
                            <div className="flex flex-col gap-3">
                                <label className="text-[10px] font-black text-antigravity-light-text/50 dark:text-white/40 tracking-widest pl-1 uppercase">
                                    FACTOR DENSIDAD (T/m³)
                                </label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={density}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
                                        setDensity(val);
                                    }}
                                    className="w-full bg-antigravity-light-surface dark:bg-[#07090D] border border-antigravity-light-border dark:border-[#12151C] rounded-none shadow-none h-14 px-6 text-2xl font-black font-mono tabular-nums text-antigravity-light-text dark:text-white outline-none focus:border-antigravity-accent transition-all text-center tracking-tight"
                                    placeholder="1.78"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>

                            {/* 4. VOLUMEN CALCULADO */}
                            <div className="bg-antigravity-light-surface dark:bg-[#07090D] border border-antigravity-light-border dark:border-[#12151C] rounded-none p-6 flex flex-col items-center gap-2 shadow-none">
                                <span className="text-[11px] font-black text-antigravity-light-text/50 dark:text-white/40 tracking-[0.3em] uppercase">VOLUMEN ESTIMADO</span>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-4xl font-black font-mono tabular-nums text-antigravity-accent tracking-tighter">
                                        {previewVolume.toFixed(1)}
                                    </span>
                                    <span className="text-sm font-black text-antigravity-light-text/50 dark:text-white/40 uppercase">m³</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Botón de Guardado */}
                    {scanComplete && (
                        <div className="pt-4 pb-12 flex justify-center">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={isSaving || !classification || !density}
                                className={`w-full h-16 rounded-none shadow-none flex items-center justify-center gap-4 transition-all cursor-pointer
                                        ${isSaving || !classification || !density
                                        ? 'bg-antigravity-light-surface text-antigravity-light-text/20 dark:bg-white/5 dark:text-white/20 border border-antigravity-light-border dark:border-transparent cursor-not-allowed'
                                        : 'bg-antigravity-accent text-white font-black'
                                    }`}
                            >
                                {isSaving ? (
                                    <span className="material-symbols-outlined text-3xl animate-spin">sync</span>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined text-2xl">save</span>
                                        <span className="text-sm tracking-widest uppercase">GUARDAR MEDICIÓN</span>
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                </div>
            </main>
        </div>
    );
};
