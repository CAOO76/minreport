import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { dataService } from '../services/DataService';
import { storageService } from '../services/StorageService';
import { M3TextField } from './M3TextField';
import { motion, AnimatePresence } from 'framer-motion';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { compressImage } from '../utils/imageOptimizer';
import { MobileScanner } from './MobileScanner';
import { ManualCapture } from './ManualCapture';
import { CaptureSelection } from './CaptureSelection';
import { GeometrySelection } from './GeometrySelection';
import type { GeometryType } from './GeometrySelection';

interface StockpileRegistrationProps {
    onSuccess: (assetId: string) => void;
    onCancel: () => void;
}

type RegStep = 'INFO' | 'METHOD' | 'GEOMETRY' | 'CAPTURE_MANUAL' | 'CAPTURE_DIGITAL';

const PASO_LABEL: Record<RegStep, string> = {
    INFO: 'PASO 1 / 4',
    METHOD: 'PASO 2 / 4',
    GEOMETRY: 'PASO 3 / 4',
    CAPTURE_MANUAL: 'PASO 4 / 4',
    CAPTURE_DIGITAL: 'PASO 4 / 4',
};

const HEADER_TITLE: Record<RegStep, string> = {
    INFO: 'REGISTRO DE ACTIVO',
    METHOD: 'MÉTODO DE CUBICACIÓN',
    GEOMETRY: 'GEOMETRÍA DEL STOCK',
    CAPTURE_MANUAL: 'CAPTURA TÉCNICA',
    CAPTURE_DIGITAL: 'ESCANEO DIGITAL',
};

export const StockpileRegistration: React.FC<StockpileRegistrationProps> = ({ onSuccess, onCancel }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [clase, setClase] = useState<'mineral' | 'esteril' | 'baja_ley'>('mineral');
    const [locationRef, setLocationRef] = useState('');
    const [assetPhotoBlob, setAssetPhotoBlob] = useState<Blob | null>(null);
    const [assetPhotoPreview, setAssetPhotoPreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [step, setStep] = useState<RegStep>('INFO');
    const [geometry, setGeometry] = useState<GeometryType>('CONO_ELIPTICO');

    const [createdAssetId, setCreatedAssetId] = useState<string | null>(null);
    const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
    const [isCreatingAsset, setIsCreatingAsset] = useState(false);

    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);

    useEffect(() => {
        Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 })
            .then(pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }))
            .catch(() => {});
    }, []);

    useEffect(() => {
        return () => {
            if (assetPhotoPreview && assetPhotoPreview.startsWith('blob:')) {
                URL.revokeObjectURL(assetPhotoPreview);
            }
        };
    }, [assetPhotoPreview]);

    const applyOptimizedPhotoFromUrl = async (sourceUrl: string) => {
        const optimizedDataUrl = await compressImage(sourceUrl, { profile: 'evidence' });
        const blob = await fetch(optimizedDataUrl).then(r => r.blob());
        const nextPreview = URL.createObjectURL(blob);
        setAssetPhotoBlob(blob);
        setAssetPhotoPreview(prev => {
            if (prev && prev.startsWith('blob:')) {
                URL.revokeObjectURL(prev);
            }
            return nextPreview;
        });
    };

    const takeAssetPhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 80,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false
            });
            if (image.dataUrl) {
                await applyOptimizedPhotoFromUrl(image.dataUrl);
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
            await applyOptimizedPhotoFromUrl(tempUrl);
        } catch (err: any) {
            toast.error(`Error al procesar imagen: ${err?.message || 'Formato inválido'}`);
        } finally {
            URL.revokeObjectURL(tempUrl);
            e.target.value = '';
        }
    };

    const ensureAssetCreated = async (): Promise<string | null> => {
        if (createdAssetId) {
            return createdAssetId;
        }
        setIsCreatingAsset(true);
        try {
            let finalPhotoUrl = uploadedPhotoUrl || '';
            if (!finalPhotoUrl && assetPhotoBlob) {
                const assetUpload = await storageService.uploadStockpileImage(assetPhotoBlob, `asset_${Date.now()}`);
                finalPhotoUrl = assetUpload.url;
                setUploadedPhotoUrl(assetUpload.url);
            }
            const assetId = await dataService.createAsset({
                name: name.trim().toUpperCase(),
                clase,
                location_ref: locationRef.trim(),
                initial_photo_url: finalPhotoUrl || undefined,
                thumbnail_url: finalPhotoUrl || undefined,
                ...(gps
                    ? {
                          geo_point: {
                              latitude: gps.lat,
                              longitude: gps.lng,
                              altitude: null,
                              accuracy: gps.acc
                          }
                      }
                    : {})
            });
            setCreatedAssetId(assetId);
            return assetId;
        } catch (e: any) {
            toast.error(`Error al crear activo: ${e?.message || 'Fallo de registro'}`);
            return null;
        } finally {
            setIsCreatingAsset(false);
        }
    };

    const goToManualCapture = async (selectedGeometry: GeometryType) => {
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
                <header className="pt-8 pb-3 px-6 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between flex-none z-40">
                    <div>
                        <p className="text-[11px] font-bold font-mono tabular-nums tracking-[0.2em] uppercase text-[#C68346]">{PASO_LABEL[step]}</p>
                        <h1 className="text-base font-bold tracking-tight leading-none mt-0.5">{HEADER_TITLE[step]}</h1>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Cancelar"
                        aria-label="Cancelar"
                    >
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </header>
            )}

            <div className="flex-1 overflow-y-auto hide-scrollbar relative">
                {isCreatingAsset && (
                    <div className="absolute inset-0 bg-[#FFFFFF]/90 dark:bg-[#000000]/90 flex flex-col items-center justify-center gap-[13px] z-50">
                        <span className="material-symbols-outlined text-5xl text-[#C68346] animate-spin">sync</span>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">{t('registration.registering_asset_message')}</p>
                    </div>
                )}

                <AnimatePresence mode="wait">

                    {/* STEP 1: INFO */}
                    {step === 'INFO' && (
                        <motion.div key="info" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }} transition={{ duration: 0.18 }} className="p-[21px] max-w-md mx-auto flex flex-col gap-[21px]">
                            <div className="space-y-[13px]">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#C68346]">Identificación</p>
                                <M3TextField label="ID / NOMBRE" value={name} onChange={setName} autoComplete="off" />
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] mb-[8px]">CLASE DE MATERIAL</p>
                                    <div className="grid grid-cols-3 gap-[8px]">
                                        {(['mineral', 'esteril', 'baja_ley'] as const).map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setClase(c)}
                                                className={`h-10 text-[11px] font-bold font-mono uppercase tracking-wider border rounded-none shadow-none transition-colors cursor-pointer ${
                                                    clase === c
                                                        ? 'bg-[#C68346] text-[#FFFFFF] border-[#C68346]'
                                                        : 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C]'
                                                }`}
                                            >
                                                {c === 'mineral' ? t('material_type.mineral') : c === 'esteril' ? t('material_type.esteril') : t('material_type.baja_ley')}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <M3TextField
                                    label={t('registration.location_ref_label')}
                                    placeholder={t('registration.location_ref_placeholder')}
                                    value={locationRef}
                                    onChange={setLocationRef}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="space-y-[8px]">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#C68346]">{t('registration.cover_photo_title')}</p>
                                <div onClick={takeAssetPhoto} className="relative w-full aspect-video bg-[#F8FAFC] dark:bg-[#07090D] border-2 border-dashed border-[#E2E8F0] dark:border-[#12151C] flex flex-col items-center justify-center overflow-hidden hover:border-[#C68346] transition-colors cursor-pointer rounded-none">
                                    {assetPhotoPreview ? (
                                        <>
                                            <img
                                                src={assetPhotoPreview}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                className="w-full h-full object-cover select-none pointer-events-none"
                                                alt="Portada"
                                            />
                                            <div className="absolute inset-0 bg-black/25 pointer-events-none" />
                                            <span className="absolute bottom-2 left-3 text-[11px] font-bold uppercase tracking-widest text-[#FFFFFF] bg-[#C68346] px-[8px] py-0.5 rounded-none">
                                                {t('registration.captured_label')}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-symbols-outlined text-3xl text-[#94A3B8] dark:text-[#5A6072] mb-1">add_a_photo</span>
                                            <span className="text-[11px] font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">{t('registration.tap_to_capture_label')}</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                disabled={!name.trim() || !locationRef.trim() || !assetPhotoBlob}
                                onClick={() => setStep('METHOD')}
                                className="w-full h-14 bg-[#C68346] text-[#FFFFFF] font-bold text-xs uppercase tracking-widest rounded-none shadow-none disabled:opacity-30 transition-colors cursor-pointer"
                            >
                                {t('common.continue_button')}
                            </button>
                        </motion.div>
                    )}

                    {/* STEP 2: METHOD */}
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

                    {/* STEP 3: GEOMETRY */}
                    {step === 'GEOMETRY' && (
                        <GeometrySelection
                            onSelection={goToManualCapture}
                            onBack={() => setStep('METHOD')}
                        />
                    )}

                    {/* STEP 4a: MANUAL */}
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

                    {/* STEP 4b: DIGITAL (Sin activo fantasma NEW_ASSET) */}
                    {step === 'CAPTURE_DIGITAL' && createdAssetId && (
                        <motion.div key="capture_dig" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full relative">
                            <MobileScanner
                                assetId={createdAssetId}
                                onSuccess={() => {
                                    onSuccess(createdAssetId);
                                }}
                                onBack={() => setStep('METHOD')}
                            />
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>

        </main>
    );
};
