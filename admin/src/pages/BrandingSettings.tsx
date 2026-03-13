import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { getBrandingSettings, updateBrandingSettings } from '../services/api';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, storage } from '../config/firebase';

interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
    pwaIcon?: string; // Icono para navegadores/PWA (512px)
    appIcon?: string; // Icono para App Móvil (1024px)
}

interface BrandingSettingsData {
    light: LogoSet;
    dark: LogoSet;
}

const DEFAULT_SETTINGS: BrandingSettingsData = {
    light: { isotype: '', logotype: '', imagotype: '', pwaIcon: '', appIcon: '' },
    dark: { isotype: '', logotype: '', imagotype: '', pwaIcon: '', appIcon: '' },
};

const uploadFileToStorage = async (file: File, path: string): Promise<string> => {
    try {
        console.log(`Uploading ${file.name} to ${path}...`);
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        return downloadURL;
    } catch (error) {
        console.error("Upload failed:", error);
        throw new Error("Failed to upload file.");
    }
};

const fixBrandingUrl = (url?: string): string => {
    if (!url) return '';
    const currentHost = location.hostname;
    if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
        return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return url;
};

const BrandingPreview: React.FC<{ file: File | null, existingUrl: string | null, label: string, mode: 'light' | 'dark', size: 'small' | 'medium' | 'large' }> = ({ file, existingUrl, label, mode, size }) => {
    const [preview, setPreview] = useState<string | null>(null);

    useEffect(() => {
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        } else if (existingUrl) {
            setPreview(fixBrandingUrl(existingUrl));
        } else {
            setPreview(null);
        }
    }, [file, existingUrl]);

    const isSvg = (file?.name.toLowerCase().includes('.svg')) || (existingUrl?.toLowerCase().includes('.svg'));

    const sizeClasses = {
        small: 'h-16 w-16',
        medium: 'h-24 w-48',
        large: 'h-32 w-full'
    };

    return (
        <div className={clsx(
            "p-6 rounded-none border transition-all duration-500 shadow-premium overflow-hidden relative",
            mode === 'light' ? 'bg-white/80 border-black/5' : 'bg-black/40 border-white/5 backdrop-blur-md'
        )}>
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-10"></div>
            <div className="relative z-10 flex justify-between items-center mb-4">
                <h4 className="hud-label !text-[10px] m-0">{label}</h4>
                <div className={clsx(
                    "text-[9px] px-3 py-1 rounded-none font-black tracking-widest uppercase",
                    mode === 'light' ? 'bg-black/5 text-black/40' : 'bg-white/10 text-white/50'
                )}>
                    {mode}_NODE
                </div>
            </div>
            <div className={clsx(
                sizeClasses[size],
                "relative z-10 flex items-center justify-center border border-dashed rounded-none group-hover:border-antigravity-accent/50 transition-colors",
                mode === 'light' ? 'border-black/10' : 'border-white/10'
            )}>
                {preview ? (
                    <img
                        src={preview}
                        alt={`${label} preview`}
                        className={clsx(
                            "max-h-full max-w-full transition-all duration-700",
                            isSvg && mode === 'dark' && "invert brightness-200"
                        )}
                        style={{ imageRendering: 'crisp-edges' }}
                    />
                ) : (
                    <span className="text-[10px] font-black opacity-20 tracking-[0.2em]">AWAITING_ASSET</span>
                )}
            </div>
        </div>
    );
};

const BrandingSection: React.FC<{
    title: string;
    description?: string;
    files: { [key: string]: File | null };
    onFileChange: (type: string, file: File | null) => void;
    existingUrls?: LogoSet;
}> = ({ title, description, files, onFileChange, existingUrls }) => {
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
        const file = e.target.files ? e.target.files[0] : null;
        const validTypes = ['image/svg+xml', 'image/png'];
        if (file && validTypes.includes(file.type)) {
            onFileChange(type, file);
        } else {
            onFileChange(type, null);
            if (file) alert('Formatos permitidos: .svg (Recomendado), .png');
        }
    };

    return (
        <div className="elite-tech-surface p-12 rounded-none shadow-3xl border-black/5 dark:border-white/5 relative group">
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

            <div className="relative z-10 mb-12">
                <h3 className="text-3xl font-black text-black dark:text-white m-0 tracking-tighter italic uppercase">{title}</h3>
                {description && <p className="text-black/50 dark:text-white/40 text-sm mt-2 font-medium">{description}</p>}
            </div>

            <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                {(['isotype', 'logotype', 'imagotype', 'pwaIcon', 'appIcon'] as const).map(type => (
                    <div key={type} className="group/item flex flex-col space-y-6">
                        <div className="flex flex-col">
                            <label className="hud-label !text-black/80 dark:!text-white/80 transition-colors group-hover/item:!text-antigravity-accent">
                                {type === 'pwaIcon' ? 'Favicon / PWA' :
                                    type === 'appIcon' ? 'Mobile App Isotype' :
                                        type.charAt(0).toUpperCase() + type.slice(1)}
                            </label>
                            <span className="text-[10px] text-black/30 dark:text-white/30 font-black uppercase tracking-widest mt-1">
                                {type === 'isotype' ? 'Master Vector (1024x1024px)' :
                                    type === 'logotype' ? 'Horizontal Brand (Min 1024px Width)' :
                                        type === 'imagotype' ? 'Unified Branding (Min 1024px)' :
                                            type === 'pwaIcon' ? 'Web App Icon (512x512px)' :
                                                'Native App Isotype (1024x1024px)'}
                            </span>
                        </div>

                        <div className="relative group/input">
                            <input
                                type="file"
                                accept=".png,.svg"
                                onChange={(e) => handleFileChange(e, type)}
                                autoComplete="off"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <div className="h-12 flex items-center justify-center rounded-none bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest border-2 border-transparent group-hover/input:bg-antigravity-accent group-hover/input:text-white transition-all shadow-lg active:scale-95">
                                {files[type] ? `Replace: ${files[type]?.name.slice(0, 15)}...` : 'Select File'}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            <BrandingPreview
                                file={files[type] || null}
                                existingUrl={existingUrls?.[type] || null}
                                label="Daylight Node"
                                mode="light"
                                size={type === 'isotype' ? 'small' : type === 'imagotype' || type === 'appIcon' ? 'large' : 'medium'}
                            />
                            <BrandingPreview
                                file={files[type] || null}
                                existingUrl={existingUrls?.[type] || null}
                                label="Mineral Node"
                                mode="dark"
                                size={type === 'isotype' ? 'small' : type === 'imagotype' || type === 'appIcon' ? 'large' : 'medium'}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const BrandingSettings: React.FC = () => {
    const [settings, setSettings] = useState<BrandingSettingsData | null>(null);
    const [files, setFiles] = useState<{ [key: string]: File | null }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // [REAL-TIME] Sustituir el fetch de una sola vez por onSnapshot para evitar datos stale
        const docRef = doc(db, 'settings', 'branding');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as BrandingSettingsData;
                setSettings({
                    light: { ...DEFAULT_SETTINGS.light, ...(data.light || {}) },
                    dark: { ...DEFAULT_SETTINGS.dark, ...(data.dark || {}) },
                });
            } else {
                setSettings(DEFAULT_SETTINGS);
            }
            setIsLoading(false);
        }, (error) => {
            console.error('Failed to listen to branding settings', error);
            setSettings(DEFAULT_SETTINGS);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleFileChange = (type: string, file: File | null) => {
        setFiles(prev => ({ ...prev, [type]: file }));
    };

    const handleSaveChanges = async () => {
        if (!settings) return;
        setIsSaving(true);
        try {
            const updatedSettings: BrandingSettingsData = JSON.parse(JSON.stringify(settings));

            const filesToUpload = Object.entries(files);
            for (const [type, file] of filesToUpload) {
                if (file) {
                    const ext = file.name.split('.').pop();
                    const path = `branding/master_${type}.${ext}`;
                    const url = await uploadFileToStorage(file, path);

                    (updatedSettings.light as any)[type] = url;
                    (updatedSettings.dark as any)[type] = url;
                }
            }

            await updateBrandingSettings(updatedSettings);
            setSettings(updatedSettings);
            setFiles({});
            alert('¡Identidad Maestra actualizada con éxito!');
        } catch (error) {
            console.error('Failed to save branding settings:', error);
            alert('Error al guardar. Revisa la consola.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return (
        <div className="p-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-black/10 dark:border-white/10 border-t-antigravity-accent rounded-none animate-spin"></div>
            <div className="hud-label animate-pulse">Initializing Identity Engine...</div>
        </div>
    );

    if (!settings) return <div className="p-12 hud-label !text-rose-500 text-center uppercase">Critical Failure: Branding_Auth_Unreachable</div>;

    return (
        <div className="max-w-[1400px] mx-auto space-y-16 animate-in fade-in duration-1000">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-10">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-antigravity-accent"></div>
                        <span className="hud-label !text-antigravity-accent italic">SYSTEM_CORE_IDENTITY</span>
                    </div>
                    <h2 className="text-5xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic">Master_Branding</h2>
                    <p className="text-black/50 dark:text-white/40 font-medium text-base max-w-xl leading-relaxed">
                        Carga tus activos maestros en negro monocromo. El motor industrial MINREPORT procesará las variaciones de luz y sombra dinámicamente.
                    </p>
                </div>

                <button
                    onClick={handleSaveChanges}
                    disabled={isSaving}
                    className="group relative px-12 py-5 bg-black dark:bg-white text-white dark:text-black font-black rounded-none shadow-premium hover:scale-105 active:scale-95 transition-all disabled:opacity-50 overflow-hidden"
                >
                    <span className="relative z-10 uppercase tracking-widest text-sm">
                        {isSaving ? 'Syncing_Core...' : 'Synchronize Identity'}
                    </span>
                    {!isSaving && <div className="absolute inset-0 bg-antigravity-accent opacity-0 group-hover:opacity-100 transition-opacity mix-blend-overlay"></div>}
                </button>
            </header>

            <div className="space-y-20">
                <BrandingSection
                    title="Industrial Assets"
                    description="Protocols require high-contrast SVG masters for optimal resolution across all node displays."
                    files={files}
                    onFileChange={handleFileChange}
                    existingUrls={settings.light}
                />
            </div>

            <footer className="pt-12 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-6 hud-label !text-[10px] !text-black/20 dark:!text-white/20">
                <div className="flex items-center gap-4">
                    <span className="w-2 h-2 rounded-none bg-emerald-500 animate-pulse"></span>
                    MINREPORT_BRAND_AUTOMATION_v3.0_STABLE
                </div>
                <div className="italic">PROTOCOL: IDENTITY_FLUID_ADAPTATION_ACTIVE</div>
            </footer>
        </div>
    );
};