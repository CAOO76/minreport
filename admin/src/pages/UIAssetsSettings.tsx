import React, { useState, useEffect } from 'react';
import { getUIAssetsSettings, updateUIAssetsSettings, UIAssetsData } from '../services/api';
import { storage } from '../config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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
        <div className="group relative bg-slate-50 dark:bg-slate-900 rounded-[24px] border border-slate-200 dark:border-slate-800 p-4 transition-all hover:shadow-xl overflow-hidden aspect-video flex flex-col justify-end">
            {preview ? (
                <div className="absolute inset-0 z-0">
                    <img src={preview} alt={label} className="w-full h-full object-cover brightness-[0.4] group-hover:scale-105 transition-transform duration-700" />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent"></div>
                </div>
            ) : (
                <div className="absolute inset-0 z-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-700 m-4 rounded-xl">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Awaiting Identity Photo</span>
                </div>
            )}

            <div className="relative z-10 p-2">
                <h4 className="text-white font-black text-sm uppercase tracking-tighter m-0">{label}</h4>
                <p className="text-slate-400 text-[10px] font-medium leading-tight mt-1">{description}</p>
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
            alert('UI Backgrounds updated successfully!');
        } catch (error) {
            alert('Failed to update assets.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <div className="p-12 animate-pulse text-slate-400 font-bold text-center">LOADING ASSETS ENGINE...</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-12 pb-24">
            <header className="flex items-end justify-between">
                <div>
                    <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase m-0">UI ASSETS</h2>
                    <p className="text-slate-500 font-medium text-sm">Gestiona la atmósfera industrial del sistema. Solo tonos negros y gama de grafitos.</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-8 py-4 bg-antigravity-accent text-white font-bold rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                >
                    {isSaving ? 'UPDATING...' : 'SYNC ASSETS'}
                </button>
            </header>

            <div className="bg-white dark:bg-slate-800 p-8 rounded-[32px] border border-slate-100 dark:border-slate-700/50 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {[
                        { id: 'login_bg', label: 'Login Background', desc: 'Vista principal de acceso. Debe transmitir robustez industrial y seguridad.' },
                        { id: 'dashboard_bg', label: 'Dashboard Hub', desc: 'Atmósfera del panel central. Minimalismo absoluto en grafitos minerales.' },
                        { id: 'sidebar_bg', label: 'Sidebar Texture', desc: 'Textura mineral para elementos de navegación laterales.' }
                    ].map(asset => (
                        <div key={asset.id} className="space-y-4">
                            <UIAssetPreview
                                file={files[asset.id] || null}
                                existingUrl={(settings as any)[asset.id]}
                                label={asset.label}
                                description={asset.desc}
                            />
                            <div className="relative group">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleFileChange(asset.id, e.target.files?.[0] || null)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className="py-2 px-4 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest text-center border-2 border-transparent group-hover:border-antigravity-accent transition-all">
                                    {files[asset.id] ? files[asset.id]?.name.slice(0, 15) : 'Upload Image'}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-6 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                    <h5 className="text-amber-700 dark:text-amber-500 font-bold text-xs uppercase mb-2 flex items-center gap-2">
                        <span className="material-symbols-rounded text-lg">warning</span>
                        Restricciones de Identidad
                    </h5>
                    <ul className="text-[10px] text-amber-600 dark:text-amber-400 font-medium space-y-1 ml-4 list-disc">
                        <li>PROHIBIDO: Fotos genéricas, personas, arquitectura constructiva, gradientes artificiales.</li>
                        <li>PERMITIDO: Texturas industriales, minerales (carbón, grafito, acero, roca).</li>
                        <li>NORMA: Solo Negro y Gamas de Grafito (#000000 a #1f1f1f).</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};
