import React, { useState, useEffect } from 'react';
import { getUIAssetsSettings, updateUIAssetsSettings, UIAssetsData } from '../services/api';
import { storage } from '../config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { AlertTriangle, ImageIcon, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

const INITIAL_DATA: UIAssetsData = {
    login_bg: '',
    dashboard_bg: '',
    sidebar_bg: ''
};

const uploadAssetToStorage = async (file: File, path: string): Promise<string> => {
    try {
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, file);
        return await getDownloadURL(snapshot.ref);
    } catch (error) {
        console.error("Upload failed:", error);
        throw new Error("Failed to upload asset.");
    }
};

const UIAssetPreview: React.FC<{
    file: File | null,
    existingUrl: string,
    label: string,
    description: string
}> = ({ file, existingUrl, label, description }) => {
    const [preview, setPreview] = useState<string | null>(null);

    useEffect(() => {
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setPreview(reader.result as string);
            reader.readAsDataURL(file);
        } else if (existingUrl) {
            setPreview(existingUrl);
        } else {
            setPreview(null);
        }
    }, [file, existingUrl]);

    return (
        <div className="group relative elite-tech-surface !rounded-none overflow-hidden aspect-video flex flex-col justify-end p-8 border-black/5 dark:border-white/5 shadow-2xl transition-all duration-700 hover:scale-[1.02] hover:shadow-antigravity-accent/20">
            {/* Dark technical overlay */}
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-40 z-10"></div>

            {preview ? (
                <div className="absolute inset-0 z-0">
                    <img src={preview} alt={label} className="w-full h-full object-cover brightness-[0.5] contrast-[1.1] group-hover:scale-110 transition-transform duration-[2000ms] ease-out" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"></div>
                </div>
            ) : (
                <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-black/10 dark:bg-white/5 m-4 rounded-none border-2 border-dashed border-black/10 dark:border-white/10">
                    <ImageIcon className="text-black/10 dark:text-white/10 mb-2" size={32} />
                    <span className="hud-label !text-[10px] opacity-20">Awaiting Atmospheric Asset</span>
                </div>
            )}

            <div className="relative z-20 space-y-2">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-none bg-antigravity-accent"></div>
                    <h4 className="text-white font-black text-sm uppercase tracking-[0.2em] m-0 italic">{label}</h4>
                </div>
                <p className="text-white/50 text-[10px] font-bold leading-relaxed max-w-[80%] uppercase tracking-widest">{description}</p>
            </div>
        </div>
    );
};

export const UIAssetsSettings: React.FC = () => {
    const [settings, setSettings] = useState<UIAssetsData>(INITIAL_DATA);
    const [files, setFiles] = useState<{ [key: string]: File | null }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const { data } = await getUIAssetsSettings();
                setSettings(data);
            } catch (error) {
                console.error('Failed to fetch UI assets', error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleFileChange = (type: string, file: File | null) => {
        setFiles(prev => ({ ...prev, [type]: file }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updated = { ...settings };
            for (const [key, file] of Object.entries(files)) {
                if (file) {
                    const ext = file.name.split('.').pop();
                    const url = await uploadAssetToStorage(file, `ui_assets/${key}.${ext}`);
                    (updated as any)[key] = url;
                }
            }
            await updateUIAssetsSettings(updated);
            setSettings(updated);
            setFiles({});
            alert('Atmospheric synchronization successful.');
        } catch (error) {
            alert('Core UI Asset update failed.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return (
        <div className="p-12 flex flex-col items-center justify-center space-y-6">
            <div className="w-16 h-16 border-b-2 border-antigravity-accent rounded-none animate-spin"></div>
            <div className="hud-label animate-pulse tracking-[1em]">CALIBRATING_OPTICS</div>
        </div>
    );

    return (
        <div className="max-w-[1400px] mx-auto space-y-16 animate-in fade-in duration-1000 pb-24">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-10">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-antigravity-accent"></div>
                        <span className="hud-label !text-antigravity-accent italic">ATOMIC_UI_ENVIRONMENT</span>
                    </div>
                    <h2 className="text-5xl font-black text-black dark:text-white tracking-tighter uppercase m-0 italic">Atmospheric_Assets</h2>
                    <p className="text-black/50 dark:text-white/40 font-medium text-base max-w-xl leading-relaxed">
                        Controla la estética mineral del sistema. Gestiona texturas de acero, grafito y carbono para mantener la integridad visual del nodo.
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="group relative px-12 py-5 bg-black dark:bg-white text-white dark:text-black font-black rounded-none shadow-premium hover:scale-105 active:scale-95 transition-all disabled:opacity-50 overflow-hidden"
                >
                    <span className="relative z-10 uppercase tracking-widest text-sm">
                        {isSaving ? 'Recalibrating...' : 'Sync Environment'}
                    </span>
                    {!isSaving && <div className="absolute inset-0 bg-antigravity-accent opacity-0 group-hover:opacity-100 transition-opacity mix-blend-overlay"></div>}
                </button>
            </header>

            <div className="elite-tech-surface p-12 rounded-none shadow-3xl border-black/5 dark:border-white/5 relative">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

                <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-12">
                    {[
                        { id: 'login_bg', label: 'Security Gateway', desc: 'Acceso principal al sistema. Debe transmitir robustez y encriptación.' },
                        { id: 'dashboard_bg', label: 'Central Hub', desc: 'Panel de operaciones. Minimalismo mineral en grafitos profundos.' },
                        { id: 'sidebar_bg', label: 'Navigation Texture', desc: 'Sustrato visual para los protocolos de navegación lateral.' }
                    ].map(asset => (
                        <div key={asset.id} className="space-y-6">
                            <UIAssetPreview
                                file={files[asset.id] || null}
                                existingUrl={(settings as any)[asset.id]}
                                label={asset.label}
                                description={asset.desc}
                            />
                            <div className="relative group/input">
                                <input
                                    type="file"
                                    accept="image/*"
                                    autoComplete="off"
                                    onChange={(e) => handleFileChange(asset.id, e.target.files?.[0] || null)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className="h-12 flex items-center justify-center rounded-none bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest border-2 border-transparent group-hover/input:bg-antigravity-accent group-hover/input:text-white transition-all shadow-lg active:scale-95">
                                    {files[asset.id] ? files[asset.id]?.name.slice(0, 20) : `Inject ${asset.label}`}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-16 p-8 rounded-none glass-card border-amber-500/20 bg-amber-500/5 flex gap-6 items-start">
                    <div className="w-12 h-12 rounded-none bg-amber-500/10 flex items-center justify-center shrink-0">
                        <AlertTriangle className="text-amber-500" size={24} />
                    </div>
                    <div className="space-y-3">
                        <h5 className="text-amber-600 dark:text-amber-500 font-black text-xs uppercase tracking-widest flex items-center gap-2">
                            Industrial Visual Protocol v4.0
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <ul className="text-[10px] text-amber-700/60 dark:text-amber-400/50 font-black space-y-2 uppercase tracking-tighter">
                                <li className="flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-none bg-amber-500"></div>
                                    Prohibido: Elementos orgánicos o figurativos
                                </li>
                                <li className="flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-none bg-amber-500"></div>
                                    Prohibido: Gradientes artificiales de color
                                </li>
                            </ul>
                            <ul className="text-[10px] text-emerald-600/60 dark:text-emerald-400/50 font-black space-y-2 uppercase tracking-tighter">
                                <li className="flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-none bg-emerald-500"></div>
                                    Requerido: Macro-fotografía mineral/metálica
                                </li>
                                <li className="flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
                                    Requerido: Rango HEX #000000 - #1F1F1F
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <footer className="pt-12 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-6 hud-label !text-[10px] !text-black/20 dark:!text-white/20">
                <div className="flex items-center gap-4">
                    <ShieldCheck className="text-emerald-500" size={14} />
                    ATMOSPHERIC_INTEGRITY_CHECKED
                </div>
                <div className="italic tracking-widest">MINREPORT OPTICS UNIT</div>
            </footer>
        </div>
    );
};
