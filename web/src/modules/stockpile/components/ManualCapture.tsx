import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { calculationEngine } from '../services/calculation-engine';
import { dataService } from '../services/DataService';
import { storageService } from '../services/StorageService';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { compressImage } from '../utils/imageOptimizer';
import type { GeometryType } from './GeometrySelection';

interface ManualCaptureProps {
    assetId: string;
    initialGeometry: GeometryType;
    onSuccess: (measurementId: string) => void;
    onBack: () => void;
    hidePhoto?: boolean; // true cuando viene del wizard (usa foto del activo)
    initialPhotoUrl?: string; // Url de la foto capturada en el primer paso del wizard
}

export const ManualCapture: React.FC<ManualCaptureProps> = ({ assetId, initialGeometry, onSuccess, onBack, hidePhoto = false, initialPhotoUrl }) => {
    const { t } = useTranslation();
    const [geometria] = useState<GeometryType>(initialGeometry);
    const [dimensions, setDimensions] = useState({ a: '', b: '', h: '', ap: '', bp: '', p: '', pp: '' });
    const [density, setDensity] = useState('');
    const [photo, setPhoto] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);

    // Init GPS for trace
    useEffect(() => {
        const initGps = async () => {
            try {
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
            } catch (err) { console.warn('[ManualCapture] GPS Error:', err); }
        };
        initGps();
    }, []);

    const takePhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 80,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false
            });
            if (image.dataUrl) {
                const optimized = await compressImage(image.dataUrl, { profile: 'evidence' });
                setPhoto(optimized);
            }
        } catch (err) { console.warn('[ManualCapture] Camera Canceled'); }
    };

    // Cálculo de Estimación en Vivo
    const liveEstimation = useMemo(() => {
        const a = parseFloat(dimensions.a) || 0;
        const b = parseFloat(dimensions.b) || 0;
        const h = parseFloat(dimensions.h) || 0;
        const ap = parseFloat(dimensions.ap) || 0;
        const bp = parseFloat(dimensions.bp) || 0;
        const p = parseFloat(dimensions.p) || 0;
        const pp = parseFloat(dimensions.pp) || 0;

        if (geometria === 'CONO_ELIPTICO') {
            return calculationEngine.calculateEllipticCone(a, b, h);
        } else if (geometria === 'CONO_ELIPTICO_TRUNCADO') {
            return calculationEngine.calculateTruncatedEllipticCone(a, b, ap, bp, h);
        } else if (geometria === 'CONO_TRUNCADO_PERIMETRO') {
            return calculationEngine.calculatePerimeterTruncatedCone(p, pp, h);
        }
        return 0;
    }, [dimensions, geometria]);

    const handleSave = async () => {
        if (isSaving || liveEstimation <= 0) return;
        if (!hidePhoto && !photo) {
            alert(t('manual_capture.required_photo_alert'));
            return;
        }
        setIsSaving(true);
        try {
            // 1. Subir foto de evidencia (solo si se capturó)
            let photoUrl = initialPhotoUrl || '';
            if (photo && !hidePhoto) {
                const response = await fetch(photo);
                const blob = await response.blob();
                const uploadResult = await storageService.uploadStockpileImage(blob, assetId);
                photoUrl = uploadResult.url;
            }

            const densityNum = parseFloat(density) || 0;
            const weight = calculationEngine.computeTotalMass(liveEstimation, densityNum);

            const measurementId = await dataService.addMeasurement({
                assetId,
                timestamp: Date.now(),
                volumen_m3: liveEstimation,
                peso_t: weight,
                density_factor: densityNum || undefined,
                method: 'manual',
                photo_url: photoUrl,
                geometry: {
                    type: geometria,
                    dimensions: {
                        a: parseFloat(dimensions.a) || 0,
                        b: parseFloat(dimensions.b) || 0,
                        h: parseFloat(dimensions.h) || 0,
                        ap: parseFloat(dimensions.ap) || 0,
                        bp: parseFloat(dimensions.bp) || 0,
                        p: parseFloat(dimensions.p) || 0,
                        pp: parseFloat(dimensions.pp) || 0
                    }
                },
                location_metadata: gps ? {
                    lat: gps.lat,
                    lng: gps.lng,
                    accuracy: gps.acc
                } : undefined
            });

            onSuccess(measurementId);
        } catch (error: any) {
            console.error('[ManualCapture] Error:', error);
            alert(`${t('manual_capture.save_error')}: ${error.message || 'Falla de conexión'}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-screen w-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden relative transition-colors duration-200">

            {/* Header Técnico (Fijo) */}
            <header className="flex-none pt-14 pb-4 px-6 flex items-center justify-between bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border z-50">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="w-12 h-12 rounded-none bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-center active:scale-95 transition-transform">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent font-bold">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black tracking-[0.4em] uppercase text-antigravity-light-text/40 dark:text-antigravity-dark-text/20">{t('manual_capture.measurement_label')}</span>
                        <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-antigravity-dark-text/90 uppercase">
                            {t(`geometries.${geometria}`)}
                        </span>
                    </div>
                </div>
                <span className="material-symbols-outlined text-3xl opacity-20">landscape</span>
            </header>

            {/* Area de Trabajo (Scrollable) */}
            <main className="flex-1 overflow-y-auto px-6 py-8 relative">
                {/* Background Grid sutil */}
                <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.02] pointer-events-none"
                    style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '30px 30px' }}>
                </div>

                <div className="max-w-sm mx-auto space-y-12 relative z-10">

                    {/* Captura de Evidencia Fotográfica — solo si no viene del wizard */}
                    {!hidePhoto && (
                    <div className="space-y-4">
                        <span className="text-[10px] font-black tracking-[0.4em] text-antigravity-light-text/40 dark:text-antigravity-dark-text/20 uppercase">{t('manual_capture.evidence_title')}</span>
                        <div
                            onClick={takePhoto}
                            className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-all overflow-hidden flex flex-col items-center justify-center
                                ${photo ? 'border-antigravity-accent/40 bg-black' : 'border-antigravity-light-border dark:border-antigravity-dark-border bg-antigravity-light-surface dark:bg-antigravity-dark-surface active:bg-antigravity-accent/5'}`}
                        >
                            {photo ? (
                                <>
                                    <img src={photo} className="w-full h-full object-cover" alt="Evidencia" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                    <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-antigravity-accent text-xl">check_circle</span>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white">{t('manual_capture.success_message')}</span>
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
                                    <span className="material-symbols-outlined text-5xl text-white/10 mb-2 font-light">add_a_photo</span>
                                    <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">{t('manual_capture.tap_to_capture')}</span>
                                </>
                            )}
                        </div>
                    </div>
                    )}

                    {/* Formulario de Medidas */}
                    <div className="grid grid-cols-1 gap-10">
                        {geometria === 'CONO_ELIPTICO' && (
                            <>
                                <Field label={t('manual_capture.fields.major_axis_base')} value={dimensions.a} onChange={(v) => setDimensions({ ...dimensions, a: v })} />
                                <Field label={t('manual_capture.fields.minor_axis_base')} value={dimensions.b} onChange={(v) => setDimensions({ ...dimensions, b: v })} />
                            </>
                        )}
                        {geometria === 'CONO_ELIPTICO_TRUNCADO' && (
                            <>
                                <Field label={t('manual_capture.fields.major_axis_base')} value={dimensions.a} onChange={(v) => setDimensions({ ...dimensions, a: v })} />
                                <Field label={t('manual_capture.fields.minor_axis_base')} value={dimensions.b} onChange={(v) => setDimensions({ ...dimensions, b: v })} />
                                <Field label={t('manual_capture.fields.major_axis_top')} value={dimensions.ap} onChange={(v) => setDimensions({ ...dimensions, ap: v })} />
                                <Field label={t('manual_capture.fields.minor_axis_top')} value={dimensions.bp} onChange={(v) => setDimensions({ ...dimensions, bp: v })} />
                            </>
                        )}
                        {geometria === 'CONO_TRUNCADO_PERIMETRO' && (
                            <>
                                <Field label={t('manual_capture.fields.perimeter_base')} value={dimensions.p} onChange={(v) => setDimensions({ ...dimensions, p: v })} />
                                <Field label={t('manual_capture.fields.perimeter_top')} value={dimensions.pp} onChange={(v) => setDimensions({ ...dimensions, pp: v })} />
                            </>
                        )}
                        <Field label={t('manual_capture.fields.total_height')} value={dimensions.h} onChange={(v) => setDimensions({ ...dimensions, h: v })} />
                        <Field label={t('manual_capture.fields.density_factor')} value={density} onChange={setDensity} />
                    </div>

                    {/* Dashboard de Resultados en Vivo */}
                    <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border rounded-none p-8 flex flex-col items-center gap-2 transition-colors">
                        <span className="text-[11px] font-black text-antigravity-light-text/30 dark:text-antigravity-dark-text/30 tracking-[0.4em] uppercase">{t('manual_capture.estimated_volume')}</span>
                        <div className="flex items-baseline gap-3">
                            <span className="text-6xl font-black text-antigravity-accent tracking-tighter">
                                {liveEstimation.toFixed(1)}
                            </span>
                            <span className="text-lg font-black text-antigravity-accent/40 uppercase">m³</span>
                        </div>
                    </div>

                    {/* Botón de Guardado (Dentro del flujo de scroll) */}
                    <div className="pt-8 pb-12 flex justify-center">
                        <button
                            onClick={handleSave}
                            disabled={isSaving || liveEstimation <= 0}
                            className={`w-full max-w-xs h-20 rounded-none flex items-center justify-center gap-4 transition-all
                                ${isSaving || liveEstimation <= 0
                                    ? 'bg-antigravity-light-border/20 dark:bg-antigravity-dark-border/20 text-antigravity-light-text/20 dark:text-antigravity-dark-text/20'
                                    : 'bg-antigravity-accent text-white dark:text-black font-black shadow-[0_0_30px_rgba(198,131,70,0.1)] active:scale-95'
                                }`}
                        >
                            {isSaving ? (
                                <span className="material-symbols-outlined text-4xl animate-spin">sync</span>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-4xl">measuring_tape</span>
                                    <span className="text-xl tracking-tight">{t('manual_capture.save_measurement')}</span>
                                </>
                            )}
                        </button>
                    </div>

                </div>
            </main>
        </div>
    );
};

/* Sub-componente de Campo Industrial */
const Field: React.FC<{ label: string, value: string, onChange: (v: string) => void }> = ({ label, value, onChange }) => (
    <div className="flex flex-col gap-3 group">
        <label className="text-[10px] font-black text-antigravity-light-text/30 dark:text-antigravity-dark-text/30 tracking-widest pl-1 uppercase group-focus-within:text-antigravity-accent transition-colors">
            {label}
        </label>
        <div className="relative">
            <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                    const val = e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
                    onChange(val);
                }}
                className="w-full bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-2 border-[#9ca3af] dark:border-antigravity-dark-border rounded-none h-16 px-6 text-3xl font-black text-antigravity-light-text dark:text-antigravity-dark-text outline-none focus:border-antigravity-accent transition-all text-center tracking-tight"
                placeholder=" "
                autoComplete="off"
                spellCheck="false"
            />
        </div>
    </div>
);
