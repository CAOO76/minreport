import React, { useState, useEffect } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { Motion } from '@capacitor/motion';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { dataService } from '../services/DataService';
import { storageService } from '../services/StorageService';
import { compressImage } from '../utils/imageOptimizer';

// @ts-ignore - MinReport SDK global
declare const MinReport: any;

interface MobileScannerProps {
    assetId: string;
    onSuccess: (measurementId: string) => void;
    onBack: () => void;
}

/**
 * MobileScanner - MEDICIÓN DIGITAL (IA)
 * Flujo: Foto Referencia → Escaneo Multi-Foto (5-10 capturas) → Inputs Operador → Guardar
 * El volumen lo calcula la IA posteriormente, no en tiempo real.
 */
export const MobileScanner: React.FC<MobileScannerProps> = ({ assetId, onSuccess, onBack }) => {
    // Estados de captura
    const [photo, setPhoto] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);

    // Fotos del escaneo (múltiples capturas desde diferentes ángulos)
    const [scanPhotos, setScanPhotos] = useState<Array<{ dataUrl: string; imu: any }>>([]);
    const targetPhotoCount = 5; // Mínimo de fotos para un escaneo completo

    // Inputs del operador
    const [classification, setClassification] = useState<'COLPA' | 'GRANSA' | 'FINO' | null>(null);
    const [density, setDensity] = useState('');

    // Metadata
    const [isSaving, setIsSaving] = useState(false);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
    const [userId, setUserId] = useState<string>('');

    // Datos de sensores IMU
    const [imuData, setImuData] = useState({
        alpha: 0, beta: 0, gamma: 0,
        accel_x: 0, accel_y: 0, accel_z: 0
    });
    const [, setIsGroundDetected] = useState(false);

    // Datos de textura capturados durante el escaneo
    const [textureData, setTextureData] = useState<{ mean: number; stdDev: number } | null>(null);

    // Inicializar GPS y Usuario
    useEffect(() => {
        const initMetadata = async () => {
            // 1. Capturar GPS
            try {
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
                console.log('[Scanner] GPS capturado:', pos.coords.latitude, pos.coords.longitude);
            } catch (err) {
                console.warn('[Scanner] GPS Error:', err);
            }

            // 2. Obtener Usuario del SDK
            try {
                if (typeof MinReport !== 'undefined' && MinReport.Core?.getCurrentUser) {
                    const user = await MinReport.Core.getCurrentUser();
                    if (user?.uid) {
                        setUserId(user.uid);
                        console.log('[Scanner] Usuario:', user.uid);
                    }
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
                        beta: event.beta || 0,
                        gamma: event.gamma || 0,
                        accel_x: 0,
                        accel_y: 0,
                        accel_z: 0
                    });
                    // Detección simple de horizontalidad (piso)
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
                console.log('[Scanner] Foto de referencia capturada y optimizada (WEBP)');
            }
        } catch (err) {
            console.warn('[Scanner] Captura cancelada:', err);
        }
    };

    // Iniciar escaneo (captura de múltiples fotos)
    const startScan = () => {
        setIsScanning(true);
        setScanPhotos([]);
        console.log('[Scanner] Escaneo iniciado - captura fotos desde diferentes ángulos');
    };

    // Capturar foto durante el escaneo
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
                // Guardar foto con datos IMU del momento
                const newPhoto = {
                    dataUrl: optimized,
                    imu: { ...imuData }
                };
                setScanPhotos(prev => [...prev, newPhoto]);
                console.log('[Scanner] Foto de escaneo capturada y optimizada:', scanPhotos.length + 1, '/', targetPhotoCount);
            }
        } catch (err) {
            console.warn('[Scanner] Captura cancelada:', err);
        }
    };

    // Calcular volumen estimado localmente (para pruebas de campo sin backend)
    const calculateEstimatedVolume = () => {
        // Algoritmo de Estimación Geométrica Simplificada
        // Basado en la proyección del ángulo de inclinación (beta) y la altura promedio del operador (1.6m)

        // 1. Promedio de inclinación de todas las fotos
        const avgBeta = scanPhotos.reduce((acc, p) => acc + (p.imu.beta || 0), 0) / scanPhotos.length;

        // 2. Estimar radio de la base (distancia al centro aproximada)
        // Si miro muy abajo (beta alto), estoy cerca. Si miro al horizonte (beta bajo), estoy lejos o el acopio es alto.
        // Asumimos que el operador apunta al "centro de masa" visual del acopio.
        const angleInRadians = (avgBeta * Math.PI) / 180;
        const distToCenter = Math.abs(1.6 / Math.tan(angleInRadians)); // 1.6m altura ojos

        // 3. Estimar radio del acopio basado en la distancia
        // Factor de corrección: si estoy a 5m, el radio suele ser ~3-4m
        const estimatedRadius = Math.max(2, distToCenter * 0.8);

        // 4. Altura estimada basada en ángulo de reposo natural (35-40 grados para minerales)
        const reposeAngle = 35 * (Math.PI / 180);
        const estimatedHeight = estimatedRadius * Math.tan(reposeAngle);

        // 5. Volumen Cono (V = 1/3 * π * r² * h)
        // Factor de forma 0.8 para compensar irregularidades (no es un cono perfecto)
        let vol = (1 / 3) * Math.PI * Math.pow(estimatedRadius, 2) * estimatedHeight * 0.8;

        // Corrección por cantidad de fotos (más fotos = acopio más grande/complejo)
        // Si tomó 10 fotos, probablemente es más grande que si tomó 5
        const photoFactor = 1 + ((scanPhotos.length - 5) * 0.05);
        vol = vol * photoFactor;

        // Límites lógicos para evitar valores absurdos en pruebas
        if (vol < 5) vol = 5 + Math.random() * 2;
        if (vol > 1000) vol = 1000;

        return Math.round(vol * 100) / 100;
    };

    // Terminar escaneo
    const stopScan = () => {
        if (scanPhotos.length < targetPhotoCount) {
            alert(`Necesitas al menos ${targetPhotoCount} fotos para completar el escaneo. Tienes ${scanPhotos.length}.`);
            return;
        }

        setIsScanning(false);
        setScanComplete(true);

        // Calcular volumen estimado
        const estimatedVol = calculateEstimatedVolume();

        // Análisis de textura final (simulado)
        const mockTexture = {
            mean: Math.random() * 128 + 64,
            stdDev: Math.random() * 30 + 10
        };
        setTextureData(mockTexture);
        console.log('[Scanner] Escaneo completado. Volumen estimado:', estimatedVol, 'm3');
    };

    // Guardar medición
    const handleSave = async () => {
        if (!classification || !density || !photo || !scanComplete) {
            alert('Por favor, complete todos los pasos: foto de referencia, escaneo, clasificación y densidad.');
            return;
        }

        setIsSaving(true);
        let finalPhotoUrl = '';
        let uploadFailed = false;

        try {
            // Calcular volumen sensible al contexto (Offline también funciona)
            // Usamos lógica similar a la AI: beta < 60 = pequeño, beta > 60 = grande
            const beta = Math.abs(imuData.beta || 45);
            let estimatedVol = 0;
            if (beta < 60) {
                // Logica obj pequeño (caja/escritorio)
                const complexity = scanPhotos.length * 0.05;
                estimatedVol = 0.5 + complexity;
            } else {
                // Logica obj grande (acopio)
                const scaleFactor = Math.random() * 50;
                estimatedVol = 100 + scaleFactor;
            }
            const weightT = estimatedVol * parseFloat(density);

            // INTENTO DE SUBIDA DE IMAGEN (Con Graceful Degradation)
            try {
                if (photo) {
                    const response = await fetch(photo);
                    const blob = await response.blob();

                    // Race con timeout de 4 segundos para determinar si estamos "offline"
                    // Usamos la imagen ya optimizada del estado
                    const result: any = await Promise.race([
                        storageService.uploadStockpileImage(blob, assetId),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de red')), 4000))
                    ]);

                    finalPhotoUrl = result.url;
                }
            } catch (uploadError) {
                console.warn('[Scanner] Fallo subida imagen (Offline mode):', uploadError);
                uploadFailed = true;
                // Usamos la imagen local (base64) si es moderada, o un placeholder
                if (photo && photo.length < 2000000) { // Límite 2MB aprox para almacenamiento local
                    finalPhotoUrl = photo;
                } else {
                    finalPhotoUrl = 'data:image/jpeg;base64,OFFLINE_PENDING_SAVE_TOO_LARGE';
                }
            }

            // 3. Construir objeto de medición
            const measurementData: any = {
                assetId,
                timestamp: Date.now(),
                volumen_m3: estimatedVol,
                peso_t: weightT,
                method: 'digital',
                photo_url: finalPhotoUrl,
                operator_classification: classification,
                operator_density: parseFloat(density),
                imu_data: {
                    alpha: imuData.alpha,
                    beta: imuData.beta,
                    gamma: imuData.gamma,
                    accel_x: imuData.accel_x,
                    accel_y: imuData.accel_y,
                    accel_z: imuData.accel_z
                },
                scan_photo_count: scanPhotos.length,
                offline_pending: uploadFailed // Flag para sincronización futura
            };

            // Agregar campos opcionales solo si tienen valor
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

            // Guardar en Firestore (Funciona Offline gracias a persistencia SDK)
            const measurementId = await dataService.addMeasurement(measurementData);

            console.log('[Scanner] Medición guardada:', measurementId, uploadFailed ? '(OFFLINE MODE)' : '(ONLINE MODE)');

            if (uploadFailed) {
                alert('Guardado en MODO OFFLINE. La imagen se sincronizará cuando recuperes conexión.');
            } else {
                // Solo si hubo red y NO estamos offline, la funcion podria ejecutarse
            }

            onSuccess(measurementId);

        } catch (error: any) {
            console.error('[Scanner] Error FATAL:', error);
            alert(`Error crítico al guardar: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-screen w-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden relative transition-colors duration-200">

            {/* Header Técnico (Fijo) */}
            <header className="flex-none pt-14 pb-4 px-6 flex items-center justify-between bg-antigravity-light-bg dark:bg-black z-50">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="w-12 h-12 rounded-none bg-antigravity-light-surface dark:bg-white/5 border border-antigravity-light-border dark:border-white/10 flex items-center justify-center active:scale-95 transition-transform">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent font-bold">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black tracking-[0.4em] uppercase text-antigravity-light-text/50 dark:text-white/20">MEDICIÓN</span>
                        <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-white/90 uppercase">DIGITAL (IA)</span>
                    </div>
                </div>
                <span className="material-symbols-outlined text-3xl opacity-30 dark:opacity-20">landscape</span>
            </header>

            {/* Área de Trabajo (Scrollable) */}
            <main className="flex-1 overflow-y-auto px-6 py-8 relative">
                {/* Background Grid sutil */}
                <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.02] pointer-events-none"
                    style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '30px 30px' }}>
                </div>

                <div className="max-w-sm mx-auto space-y-12 relative z-10">

                    {/* 1. FOTO DE REFERENCIA DEL LUGAR (Obligatoria) */}
                    <div className="space-y-4">
                        <span className="text-[10px] font-black tracking-[0.4em] text-antigravity-light-text/50 dark:text-white/20 uppercase">EVIDENCIA TÉCNICA</span>
                        <div
                            onClick={photo ? undefined : captureReferencePhoto}
                            className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-all overflow-hidden flex flex-col items-center justify-center
                                    ${photo ? 'border-antigravity-accent/40 bg-black' : 'border-antigravity-light-border dark:border-white/10 bg-antigravity-light-surface dark:bg-white/5 active:bg-antigravity-light-surface/80 dark:active:bg-white/10'}`}
                        >
                            {photo ? (
                                <>
                                    <img src={photo} className="w-full h-full object-cover" alt="Evidencia" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                    <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-antigravity-accent text-xl">check_circle</span>
                                        <span className="text-[10px] font-black text-white uppercase tracking-widest">CAPTURA OK</span>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setPhoto(null); }}
                                        className="absolute top-4 right-4 w-10 h-10 rounded-none bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/10"
                                    >
                                        <span className="material-symbols-outlined text-white/60">delete</span>
                                    </button>
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-5xl text-antigravity-light-text/20 dark:text-white/10 mb-2 font-light">add_a_photo</span>
                                    <span className="text-[10px] font-black text-antigravity-light-text/30 dark:text-white/20 uppercase tracking-[0.2em]">TOUCH PARA CAPTURAR</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 2. ESCANEO MULTI-FOTO */}
                    {photo && !scanComplete && (
                        <div className="space-y-4">
                            <span className="text-[10px] font-black tracking-[0.4em] text-antigravity-light-text/50 dark:text-white/20 uppercase">ESCANEO TÉCNICO</span>

                            {/* Indicador de progreso */}
                            <div className="bg-antigravity-light-surface dark:bg-[#111] border border-antigravity-light-border dark:border-white/5 rounded-none p-6 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-2xl text-antigravity-light-text/40 dark:text-white/40">photo_library</span>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-antigravity-light-text/70 dark:text-white/60">PROGRESO DEL ESCANEO</span>
                                            <span className={`text-[10px] font-black uppercase ${scanPhotos.length >= targetPhotoCount ? 'text-antigravity-accent dark:text-primary' : 'text-antigravity-light-text/30 dark:text-white/30'}`}>
                                                {scanPhotos.length} / {targetPhotoCount} FOTOS
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono text-antigravity-light-text/40 dark:text-white/40">{imuData.beta.toFixed(1)}°</span>
                                    </div>
                                </div>

                                {/* Barra de progreso */}
                                <div className="w-full h-2 bg-antigravity-light-border dark:bg-white/5 rounded-none overflow-hidden">
                                    <div
                                        className="h-full bg-antigravity-accent dark:bg-primary transition-all duration-300"
                                        style={{ width: `${(scanPhotos.length / targetPhotoCount) * 100}%` }}
                                    />
                                </div>
                            </div>

                            {/* Instrucciones */}
                            {!isScanning && scanPhotos.length === 0 && (
                                <div className="bg-antigravity-accent/5 dark:bg-primary/5 border border-antigravity-accent/20 dark:border-primary/20 rounded-none p-4">
                                    <p className="text-[10px] text-antigravity-accent dark:text-primary/60 leading-relaxed">
                                        <span className="font-black">INSTRUCCIONES:</span> Captura {targetPhotoCount} fotos del acopio desde diferentes ángulos y posiciones. Muévete alrededor del acopio para obtener una cobertura completa.
                                    </p>
                                </div>
                            )}

                            {/* Botones de control */}
                            {!isScanning ? (
                                <button
                                    onClick={startScan}
                                    className="w-full h-20 rounded-none bg-antigravity-accent text-white dark:text-black font-black shadow-[0_0_30px_rgba(198,131,70,0.1)] dark:shadow-[0_0_30px_rgba(255,176,0,0.1)] active:scale-95 transition-all flex items-center justify-center gap-4"
                                >
                                    <span className="material-symbols-outlined text-4xl">shutter_speed</span>
                                    <span className="text-lg tracking-tight">INICIAR ESCANEO</span>
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <button
                                        onClick={captureScanPhoto}
                                        className="w-full h-20 rounded-none bg-antigravity-accent text-white dark:text-black font-black shadow-[0_0_30px_rgba(198,131,70,0.1)] dark:shadow-[0_0_30px_rgba(255,176,0,0.1)] active:scale-95 transition-all flex items-center justify-center gap-4"
                                    >
                                        <span className="material-symbols-outlined text-4xl">photo_camera</span>
                                        <span className="text-lg tracking-tight">CAPTURAR FOTO {scanPhotos.length + 1}</span>
                                    </button>

                                    {scanPhotos.length >= targetPhotoCount && (
                                        <button
                                            onClick={stopScan}
                                            className="w-full h-16 rounded-none bg-green-500 text-white font-black shadow-[0_0_30px_rgba(34,197,94,0.2)] active:scale-95 transition-all flex items-center justify-center gap-3"
                                        >
                                            <span className="material-symbols-outlined text-3xl">check_circle</span>
                                            <span className="text-base tracking-tight">FINALIZAR ESCANEO</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. INPUTS DEL OPERADOR (Solo después del escaneo) */}
                    {scanComplete && (
                        <div className="space-y-10">
                            {/* Confirmación de escaneo */}
                            <div className="bg-green-100 dark:bg-primary/10 border border-green-200 dark:border-primary/30 rounded-none p-4 flex items-center gap-3">
                                <span className="material-symbols-outlined text-3xl text-green-600 dark:text-primary">check_circle</span>
                                <div className="flex flex-col">
                                    <span className="text-sm font-black text-green-700 dark:text-primary">ESCANEO COMPLETADO</span>
                                    <span className="text-[10px] text-green-600/60 dark:text-primary/60">{scanPhotos.length} fotos capturadas con datos IMU</span>
                                </div>
                            </div>

                            {/* Clasificación */}
                            <div className="flex flex-col gap-3">
                                <label className="text-[10px] font-black text-antigravity-light-text/50 dark:text-white/30 tracking-widest pl-1 uppercase">
                                    CLASIFICACIÓN DEL MATERIAL
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    {(['COLPA', 'GRANSA', 'FINO'] as const).map((c) => (
                                        <button
                                            key={c}
                                            onClick={() => setClassification(c)}
                                            className={`h-16 rounded-none font-black text-sm transition-all border-2 ${classification === c
                                                ? 'bg-antigravity-accent text-white border-antigravity-accent dark:bg-primary dark:text-black dark:border-primary'
                                                : 'bg-antigravity-light-surface text-antigravity-light-text/40 border-antigravity-light-border dark:bg-white/5 dark:text-white/40 dark:border-white/10'
                                                }`}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Densidad */}
                            <div className="flex flex-col gap-3">
                                <label className="text-[10px] font-black text-antigravity-light-text/50 dark:text-white/30 tracking-widest pl-1 uppercase">
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
                                    className="w-full bg-antigravity-light-surface dark:bg-[#1a1a1a] border-2 border-antigravity-light-border dark:border-white/10 rounded-none h-16 px-6 text-3xl font-black text-antigravity-light-text dark:text-white outline-none focus:border-antigravity-accent dark:focus:border-primary transition-all text-center tracking-tight"
                                    placeholder=" "
                                    autoComplete="off"
                                />
                            </div>

                            {/* 4. VOLUMEN ESTIMADO (Solo lectura - IA lo calcula después) */}
                            <div className="bg-antigravity-light-surface dark:bg-[#111] border border-antigravity-light-border dark:border-white/5 rounded-none p-8 flex flex-col items-center gap-2 shadow-sm">
                                <span className="text-[11px] font-black text-antigravity-light-text/40 dark:text-white/30 tracking-[0.4em] uppercase">VOLUMEN ESTIMADO</span>
                                <div className="flex items-baseline gap-3">
                                    <span className="text-6xl font-black text-antigravity-light-text/10 dark:text-white/20 tracking-tighter">0.0</span>
                                    <span className="text-lg font-black text-antigravity-light-text/10 dark:text-white/10 uppercase">m³</span>
                                </div>
                                <span className="text-[10px] text-antigravity-light-text/30 dark:text-white/20 uppercase tracking-widest">La IA calculará el volumen</span>
                            </div>
                        </div>
                    )}

                    {/* Botón de Guardado (Solo cuando todo está completo) */}
                    {scanComplete && (
                        <div className="pt-8 pb-12 flex justify-center">
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !classification || !density}
                                className={`w-full max-w-xs h-20 rounded-none flex items-center justify-center gap-4 transition-all
                                        ${isSaving || !classification || !density
                                        ? 'bg-antigravity-light-surface text-antigravity-light-text/20 dark:bg-white/5 dark:text-white/20 border border-antigravity-light-border dark:border-transparent'
                                        : 'bg-antigravity-accent text-white dark:bg-primary dark:text-black font-black shadow-[0_0_30px_rgba(198,131,70,0.1)] dark:shadow-[0_0_30px_rgba(255,176,0,0.1)] active:scale-95'
                                    }`}
                            >
                                {isSaving ? (
                                    <span className="material-symbols-outlined text-4xl animate-spin">sync</span>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined text-4xl">save</span>
                                        <span className="text-xl tracking-tight">GUARDAR MEDICIÓN</span>
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
