import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
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
    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const initGps = async () => {
            try {
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
            } catch (err) {
                console.warn('[ManualCapture] GPS Error:', err);
            }
        };
        void initGps();
    }, []);

    useEffect(() => {
        return () => {
            if (photoPreview && photoPreview.startsWith('blob:')) {
                URL.revokeObjectURL(photoPreview);
            }
        };
    }, [photoPreview]);

    const applyOptimizedPhoto = async (sourceUrl: string) => {
        const optimized = await compressImage(sourceUrl, { profile: 'evidence' });
        const blob = await fetch(optimized).then(r => r.blob());
        const nextPreview = URL.createObjectURL(blob);
        setPhotoBlob(blob);
        setPhotoPreview(prev => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return nextPreview;
        });
    };

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
                await applyOptimizedPhoto(image.dataUrl);
            }
        } catch {
            fileInputRef.current?.click();
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const tempUrl = URL.createObjectURL(file);
        try {
            await applyOptimizedPhoto(tempUrl);
        } catch (err: any) {
            toast.error(`Error al procesar foto: ${err?.message || 'Formato inválido'}`);
        } finally {
            URL.revokeObjectURL(tempUrl);
            e.target.value = '';
        }
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
        if (!hidePhoto && !photoBlob) {
            toast.warning(t('manual_capture.required_photo_alert'));
            return;
        }
        setIsSaving(true);
        try {
            let photoUrl = initialPhotoUrl || '';
            if (photoBlob && !hidePhoto) {
                const uploadResult = await storageService.uploadStockpileImage(photoBlob, assetId);
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
                location_metadata: gps
                    ? {
                          lat: gps.lat,
                          lng: gps.lng,
                          accuracy: gps.acc
                      }
                    : undefined
            });

            onSuccess(measurementId);
        } catch (error: any) {
            console.error('[ManualCapture] Error:', error);
            toast.error(`${t('manual_capture.save_error')}: ${error?.message || 'Falla de conexión'}`);
        } finally {
            setIsSaving(false);
        }
    };

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
                        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">{t('manual_capture.measurement_label')}</span>
                        <span className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                            {t(`geometries.${geometria}`)}
                        </span>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-[21px] py-[34px] relative">
                <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileUpload}
                    autoComplete="off"
                    spellCheck={false}
                    className="hidden"
                />

                <div className="max-w-sm mx-auto space-y-[34px] relative z-10">

                    {!hidePhoto && (
                        <div className="space-y-[13px]">
                            <span className="text-[11px] font-bold tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] uppercase">{t('manual_capture.evidence_title')}</span>
                            <div
                                onClick={takePhoto}
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
                                            <span className="text-[11px] font-bold uppercase tracking-widest text-[#FFFFFF] bg-[#C68346] px-[8px] py-0.5">{t('manual_capture.success_message')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setPhotoBlob(null);
                                                setPhotoPreview(null);
                                            }}
                                            className="absolute top-3 right-3 bg-transparent border-0 outline-none p-1 text-white/80 hover:text-white transition-colors cursor-pointer"
                                            title="Eliminar foto"
                                            aria-label="Eliminar foto"
                                        >
                                            <span className="material-symbols-outlined">delete</span>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined text-5xl text-[#94A3B8] dark:text-[#5A6072] mb-2">add_a_photo</span>
                                        <span className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.2em]">{t('manual_capture.tap_to_capture')}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Formulario de Medidas */}
                    <div className="grid grid-cols-1 gap-[21px]">
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
                    <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none p-[21px] flex flex-col items-center gap-[8px] transition-colors">
                        <span className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] tracking-[0.2em] uppercase">{t('manual_capture.estimated_volume')}</span>
                        <div className="flex items-baseline gap-[8px] font-mono tabular-nums">
                            <span className="text-4xl font-bold text-[#C68346] tracking-tight">
                                {liveEstimation.toFixed(1)}
                            </span>
                            <span className="text-base font-bold text-[#475569] dark:text-[#8A93A6] uppercase">m³</span>
                        </div>
                    </div>

                    {/* Botón de Guardado */}
                    <div className="pt-4 pb-12 flex justify-center">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || liveEstimation <= 0}
                            className={`w-full h-14 rounded-none shadow-none flex items-center justify-center transition-colors cursor-pointer
                                ${
                                    isSaving || liveEstimation <= 0
                                        ? 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#94A3B8] dark:text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C] cursor-not-allowed'
                                        : 'bg-[#C68346] text-[#FFFFFF] font-bold'
                                }`}
                        >
                            {isSaving ? (
                                <span className="material-symbols-outlined text-2xl animate-spin">sync</span>
                            ) : (
                                <span className="text-xs tracking-widest uppercase">{t('manual_capture.save_measurement')}</span>
                            )}
                        </button>
                    </div>

                </div>
            </main>
        </div>
    );
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
    <div className="flex flex-col gap-[8px] group">
        <label className="text-[11px] font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase group-focus-within:text-[#C68346] transition-colors">
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
                className="w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none h-14 px-6 text-2xl font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none focus:border-[#C68346] transition-colors text-center tracking-tight"
                placeholder="0.0"
                autoComplete="off"
                spellCheck={false}
            />
        </div>
    </div>
);
