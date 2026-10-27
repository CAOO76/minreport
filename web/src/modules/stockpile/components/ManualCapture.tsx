import React, { useState, useMemo, useEffect, useRef } from 'react';
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
    hidePhoto?: boolean;
    initialPhotoUrl?: string;
}

export const ManualCapture: React.FC<ManualCaptureProps> = ({ assetId, initialGeometry, onSuccess, onBack, hidePhoto = false, initialPhotoUrl }) => {
    const { t } = useTranslation();
    const [geometria] = useState<GeometryType>(initialGeometry);
    const [dimensions, setDimensions] = useState({ a: '', b: '', h: '', ap: '', bp: '', p: '', pp: '' });
    const [density, setDensity] = useState('');
    const [photo, setPhoto] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        } catch {
            fileInputRef.current?.click();
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            if (typeof reader.result === 'string') {
                const optimized = await compressImage(reader.result, { profile: 'evidence' });
                setPhoto(optimized);
            }
        };
        reader.readAsDataURL(file);
    };

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
        <div className="h-full w-full flex-1 min-h-[600px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden relative transition-colors duration-200 rounded-none shadow-none">

            <header className="flex-none pt-8 pb-4 px-6 flex items-center justify-between bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border z-50">
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
                        <span className="text-[10px] font-black tracking-[0.4em] uppercase text-antigravity-light-text/40 dark:text-antigravity-dark-text/40">{t('manual_capture.measurement_label')}</span>
                        <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-antigravity-dark-text/90 uppercase">
                            {t(`geometries.${geometria}`)}
                        </span>
                    </div>
                </div>
                <span className="material-symbols-outlined text-3xl opacity-20">landscape</span>
            </header>

            <main className="flex-1 overflow-y-auto px-6 py-8 relative">
                <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                />

                <div className="max-w-sm mx-auto space-y-10 relative z-10">

                    {!hidePhoto && (
                        <div className="space-y-4">
                            <span className="text-[10px] font-black tracking-[0.4em] text-antigravity-light-text/40 dark:text-antigravity-dark-text/40 uppercase">{t('manual_capture.evidence_title')}</span>
                            <div
                                onClick={takePhoto}
                                className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-all overflow-hidden flex flex-col items-center justify-center cursor-pointer
                                    ${photo ? 'border-antigravity-accent/40 bg-black' : 'border-antigravity-light-border dark:border-antigravity-dark-border bg-antigravity-light-surface dark:bg-antigravity-dark-surface'}`}
                            >
                                {photo ? (
                                    <>
                                        <img src={photo} draggable={false} className="w-full h-full object-cover select-none pointer-events-none" alt="Evidencia" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                        <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                            <span className="material-symbols-outlined text-antigravity-accent text-xl">check_circle</span>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-white">{t('manual_capture.success_message')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setPhoto(null); }}
                                            className="absolute top-4 right-4 bg-transparent border-0 outline-none p-1 text-white/80 hover:text-white transition-colors cursor-pointer"
                                            title="Eliminar foto"
                                        >
                                            <span className="material-symbols-outlined">delete</span>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined text-5xl text-antigravity-light-text/20 dark:text-white/20 mb-2 font-light">add_a_photo</span>
                                        <span className="text-[10px] font-black text-antigravity-light-text/40 dark:text-white/30 uppercase tracking-[0.2em]">{t('manual_capture.tap_to_capture')}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Formulario de Medidas */}
                    <div className="grid grid-cols-1 gap-8">
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
                    <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border rounded-none shadow-none p-8 flex flex-col items-center gap-2 transition-colors">
                        <span className="text-[11px] font-black text-antigravity-light-text/40 dark:text-antigravity-dark-text/40 tracking-[0.4em] uppercase">{t('manual_capture.estimated_volume')}</span>
                        <div className="flex items-baseline gap-3 font-mono tabular-nums">
                            <span className="text-5xl font-black text-antigravity-accent tracking-tighter">
                                {liveEstimation.toFixed(1)}
                            </span>
                            <span className="text-lg font-black text-antigravity-accent/60 uppercase">m³</span>
                        </div>
                    </div>

                    {/* Botón de Guardado */}
                    <div className="pt-4 pb-12 flex justify-center">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || liveEstimation <= 0}
                            className={`w-full h-16 rounded-none shadow-none flex items-center justify-center gap-4 transition-all cursor-pointer
                                ${isSaving || liveEstimation <= 0
                                    ? 'bg-antigravity-light-border/20 dark:bg-antigravity-dark-border/20 text-antigravity-light-text/20 dark:text-antigravity-dark-text/20 cursor-not-allowed'
                                    : 'bg-antigravity-accent text-white font-black'
                                }`}
                        >
                            {isSaving ? (
                                <span className="material-symbols-outlined text-3xl animate-spin">sync</span>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-2xl">measuring_tape</span>
                                    <span className="text-sm tracking-widest uppercase">{t('manual_capture.save_measurement')}</span>
                                </>
                            )}
                        </button>
                    </div>

                </div>
            </main>
        </div>
    );
};

const Field: React.FC<{ label: string, value: string, onChange: (v: string) => void }> = ({ label, value, onChange }) => (
    <div className="flex flex-col gap-3 group">
        <label className="text-[10px] font-black text-antigravity-light-text/50 dark:text-antigravity-dark-text/40 tracking-widest pl-1 uppercase group-focus-within:text-antigravity-accent transition-colors">
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
                className="w-full bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-[#9ca3af] dark:border-antigravity-dark-border rounded-none shadow-none h-14 px-6 text-2xl font-black font-mono tabular-nums text-antigravity-light-text dark:text-antigravity-dark-text outline-none focus:border-antigravity-accent transition-all text-center tracking-tight"
                placeholder="0.0"
                autoComplete="off"
                spellCheck={false}
            />
        </div>
    </div>
);
