import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
    const [assetPhoto, setAssetPhoto] = useState<string | null>(null);
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

    const takeAssetPhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 80, resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera, correctOrientation: true, saveToGallery: false
            });
            if (image.dataUrl) {
                const optimized = await compressImage(image.dataUrl, { profile: 'evidence' });
                setAssetPhoto(optimized);
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
                setAssetPhoto(optimized);
            }
        };
        reader.readAsDataURL(file);
    };

    const goToManualCapture = async (selectedGeometry: GeometryType) => {
        setGeometry(selectedGeometry);
        setIsCreatingAsset(true);
        try {
            let finalPhotoUrl = '';
            if (assetPhoto) {
                const assetBlob = await fetch(assetPhoto).then(r => r.blob());
                const assetUpload = await storageService.uploadStockpileImage(assetBlob, `asset_${Date.now()}`);
                finalPhotoUrl = assetUpload.url;
                setUploadedPhotoUrl(assetUpload.url);
            }
            const assetId = await dataService.createAsset({
                name: name.trim().toUpperCase(),
                clase,
                location_ref: locationRef.trim(),
                initial_photo_url: finalPhotoUrl || undefined,
                thumbnail_url: finalPhotoUrl || undefined,
                geo_point: { latitude: gps?.lat || 0, longitude: gps?.lng || 0, altitude: null, accuracy: gps?.acc || 0 }
            });
            setCreatedAssetId(assetId);
            setStep('CAPTURE_MANUAL');
        } catch (e: any) {
            alert(`Error al crear activo: ${e.message}`);
        } finally {
            setIsCreatingAsset(false);
        }
    };

    const showOwnHeader = step !== 'CAPTURE_MANUAL';

    return (
        <main className="h-full w-full flex-1 min-h-[600px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden transition-colors rounded-none shadow-none">

            <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
            />

            {showOwnHeader && (
                <header className="pt-8 pb-3 px-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border bg-antigravity-light-surface dark:bg-antigravity-dark-surface flex items-center justify-between flex-none z-40">
                    <div>
                        <p className="text-[10px] font-black font-mono tracking-[0.3em] uppercase text-antigravity-accent">{PASO_LABEL[step]}</p>
                        <h1 className="text-base font-black tracking-tight leading-none mt-0.5">{HEADER_TITLE[step]}</h1>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Cancelar"
                    >
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </header>
            )}

            <div className="flex-1 overflow-y-auto hide-scrollbar">
                <AnimatePresence mode="wait">

                    {/* STEP 1: INFO */}
                    {step === 'INFO' && (
                        <motion.div key="info" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }} transition={{ duration: 0.18 }} className="p-6 max-w-md mx-auto flex flex-col gap-6">
                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-antigravity-accent">Identificación</p>
                                <M3TextField label="ID / NOMBRE" value={name} onChange={setName} autoComplete="off" />
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-antigravity-light-text/40 dark:text-antigravity-dark-text/40 mb-2">CLASE DE MATERIAL</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['mineral', 'esteril', 'baja_ley'] as const).map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setClase(c)}
                                                className={`h-10 text-[10px] font-black font-mono uppercase tracking-wider border rounded-none shadow-none transition-all cursor-pointer ${
                                                    clase === c
                                                        ? 'bg-antigravity-accent text-white border-antigravity-accent'
                                                        : 'bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-antigravity-light-border dark:border-antigravity-dark-border opacity-60'
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

                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-antigravity-accent">{t('registration.cover_photo_title')}</p>
                                <div onClick={takeAssetPhoto} className="relative w-full aspect-video bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-2 border-dashed border-antigravity-light-border dark:border-antigravity-dark-border flex flex-col items-center justify-center overflow-hidden hover:border-antigravity-accent transition-colors cursor-pointer rounded-none">
                                    {assetPhoto
                                        ? (
                                            <>
                                                <img src={assetPhoto} draggable={false} className="w-full h-full object-cover select-none pointer-events-none" alt="Portada" />
                                                <div className="absolute inset-0 bg-black/20" />
                                                <span className="absolute bottom-2 left-3 text-[10px] font-black uppercase tracking-widest text-white bg-emerald-600 px-2 py-0.5 rounded-none">
                                                    {t('registration.captured_label')}
                                                </span>
                                            </>
                                        )
                                        : (
                                            <>
                                                <span className="material-symbols-outlined text-3xl opacity-30 mb-1">add_a_photo</span>
                                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{t('registration.tap_to_capture_label')}</span>
                                            </>
                                        )
                                    }
                                </div>
                            </div>

                            <button
                                type="button"
                                disabled={!name.trim() || !locationRef.trim() || !assetPhoto}
                                onClick={() => setStep('METHOD')}
                                className="w-full h-14 bg-antigravity-accent text-white font-black text-xs uppercase tracking-widest rounded-none shadow-none disabled:opacity-30 transition-all cursor-pointer"
                            >
                                {t('common.continue_button')}
                            </button>
                        </motion.div>
                    )}

                    {/* STEP 2: METHOD */}
                    {step === 'METHOD' && (
                        <CaptureSelection
                            onSelection={(type) => {
                                if (type === 'digital') setStep('CAPTURE_DIGITAL');
                                else setStep('GEOMETRY');
                            }}
                            onBack={() => setStep('INFO')}
                        />
                    )}

                    {/* STEP 3: GEOMETRY */}
                    {step === 'GEOMETRY' && (
                        <div className="relative">
                            <GeometrySelection
                                onSelection={goToManualCapture}
                                onBack={() => setStep('METHOD')}
                            />
                            {isCreatingAsset && (
                                <div className="absolute inset-0 bg-antigravity-dark-bg/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-50">
                                    <span className="material-symbols-outlined text-5xl text-antigravity-accent animate-spin">sync</span>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-white/60">{t('registration.registering_asset_message')}</p>
                                </div>
                            )}
                        </div>
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

                    {/* STEP 4b: DIGITAL */}
                    {step === 'CAPTURE_DIGITAL' && (
                        <motion.div key="capture_dig" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full relative">
                            <MobileScanner
                                assetId="NEW_ASSET"
                                onSuccess={async (mid) => {
                                    try {
                                        let finalPhotoUrl = '';
                                        if (assetPhoto) {
                                            const assetBlob = await fetch(assetPhoto).then(r => r.blob());
                                            const assetUpload = await storageService.uploadStockpileImage(assetBlob, `asset_${Date.now()}`);
                                            finalPhotoUrl = assetUpload.url;
                                        }
                                        const assetId = await dataService.createAsset({
                                            name: name.trim().toUpperCase(),
                                            clase,
                                            location_ref: locationRef.trim(),
                                            initial_photo_url: finalPhotoUrl || undefined,
                                            thumbnail_url: finalPhotoUrl || undefined,
                                            geo_point: { latitude: gps?.lat || 0, longitude: gps?.lng || 0, altitude: null, accuracy: gps?.acc || 0 }
                                        });
                                        const all = await dataService.getAllMeasurements();
                                        const current = all.find(m => m.id === mid);
                                        if (current) await dataService.addMeasurement({ ...current, assetId });
                                        onSuccess(assetId);
                                    } catch { alert('Error al vincular escaneo'); }
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
