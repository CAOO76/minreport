import React, { useState, useEffect } from 'react';
import { getBrandingSettings, updateBrandingSettings } from '../services/api';
import { storage } from '../config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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

// Real implementation of the storage upload
const uploadFileToStorage = async (file: File, path: string): Promise<string> => {
    try {
        console.log(`Uploading ${file.name} to ${path}...`);
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        console.log(`File available at`, downloadURL);
        return downloadURL;
    } catch (error) {
        console.error("Upload failed:", error);
        throw new Error("Failed to upload file.");
    }
};

// Utility to fix branding URLs for local network testing
const fixBrandingUrl = (url?: string): string => {
    if (!url) return '';
    const currentHost = location.hostname;
    // Always replace localhost/127.0.0.1 with the current host if we are NOT on localhost
    // This allows the laptop to see images stored in the iMac emulator
    if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
        return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return url;
};

const BrandingPreview: React.FC<{ file: File | null, existingUrl: string | null, label: string, mode: 'light' | 'dark' }> = ({ file, existingUrl, label, mode }) => {
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

    const bgColor = mode === 'light' ? 'bg-gray-700' : 'bg-gray-200';
    const textColor = mode === 'light' ? 'text-white' : 'text-black';

    return (
        <div className={`p-4 rounded-lg ${bgColor}`}>
            <h4 className={`text-lg font-semibold mb-2 ${textColor}`}>{label}</h4>
            <div className="w-full h-32 flex items-center justify-center border-2 border-dashed border-gray-400 rounded-md">
                {preview ? (
                    <img src={preview} alt={`${label} preview`} className="max-h-full max-w-full" />
                ) : (
                    <span className={textColor}>Preview</span>
                )}
            </div>
        </div>
    );
};

const BrandingSection: React.FC<{
    title: string;
    mode: 'light' | 'dark';
    files: { [key: string]: File | null };
    onFileChange: (type: string, file: File | null) => void;
    existingUrls?: LogoSet;
}> = ({ title, mode, files, onFileChange, existingUrls }) => {
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
        const file = e.target.files ? e.target.files[0] : null;
        if (file && file.type === 'image/png') {
            onFileChange(type, file);
        } else {
            onFileChange(type, null);
            if (file) alert('Only .png files are accepted.');
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {(['isotype', 'logotype', 'imagotype', 'pwaIcon', 'appIcon'] as const).map(type => (
                    <div key={type} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                            {type === 'pwaIcon' ? 'Icono Web / PWA (512px)' :
                                type === 'appIcon' ? 'Icono App Móvil (1024px)' :
                                    type.charAt(0).toUpperCase() + type.slice(1)} (.png)
                        </label>
                        <input
                            type="file"
                            accept=".png"
                            onChange={(e) => handleFileChange(e, type)}
                            className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 transition-all cursor-pointer"
                        />
                        <BrandingPreview
                            file={files[type] || null}
                            existingUrl={existingUrls?.[type] || null}
                            label={type === 'pwaIcon' ? 'PWA Icon' : type === 'appIcon' ? 'Mobile Icon' : `${type} Preview`}
                            mode={mode}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export const BrandingSettings: React.FC = () => {
    const [settings, setSettings] = useState<BrandingSettingsData | null>(null);
    const [lightFiles, setLightFiles] = useState<{ [key: string]: File | null }>({});
    const [darkFiles, setDarkFiles] = useState<{ [key: string]: File | null }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            setIsLoading(true);
            try {
                const response = await getBrandingSettings();
                const data = response.data || {};

                // Deep merge defaults with actual data to ensure new fields are present
                setSettings({
                    light: { ...DEFAULT_SETTINGS.light, ...(data.light || {}) },
                    dark: { ...DEFAULT_SETTINGS.dark, ...(data.dark || {}) },
                });
            } catch (error) {
                console.error('Failed to fetch branding settings', error);
                setSettings(DEFAULT_SETTINGS);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleFileChange = (mode: 'light' | 'dark') => (type: string, file: File | null) => {
        const setter = mode === 'light' ? setLightFiles : setDarkFiles;
        setter(prev => ({ ...prev, [type]: file }));
    };

    const handleSaveChanges = async () => {
        if (!settings) return;

        setIsSaving(true);
        try {
            // Create a deep copy of the current settings to modify
            const updatedSettings: BrandingSettingsData = JSON.parse(JSON.stringify(settings));

            // 1. Process Sequential Uploads
            // Sequential is more reliable for multiple concurrent uploads in emulator/limited bandwidth
            const modes = ['light', 'dark'] as const;
            const stagedFiles = { light: lightFiles, dark: darkFiles };

            for (const mode of modes) {
                const filesToUpload = Object.entries(stagedFiles[mode]);
                for (const [type, file] of filesToUpload) {
                    if (file) {
                        console.log(`[Branding] Uploading ${type} for theme ${mode}...`);
                        const path = `branding/${mode}_${type}.png`;
                        const url = await uploadFileToStorage(file, path);

                        // Update the copied settings object
                        (updatedSettings[mode] as any)[type] = url;
                        console.log(`[Branding] Logged URL for ${type}: ${url}`);
                    }
                }
            }

            // 2. Persist to Backend
            console.log('[Branding] Saving all changes to Firestore...', updatedSettings);
            await updateBrandingSettings(updatedSettings);

            // 3. Update local state and clear staging
            setSettings(updatedSettings);
            setLightFiles({});
            setDarkFiles({});

            alert('¡Branding actualizado con éxito!');
        } catch (error) {
            console.error('Failed to save branding settings:', error);
            alert('Error al guardar los cambios. Revisa la consola para más detalles.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className="p-8">Loading settings...</div>;
    }

    if (!settings) {
        return <div className="p-8">Could not load branding settings.</div>;
    }

    return (
        <div className="p-8 space-y-8">
            <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">Branding &amp; Appearance</h2>

            <BrandingSection
                title="Light Mode Assets"
                mode="dark" // Dark background for light theme assets
                files={lightFiles}
                onFileChange={handleFileChange('light')}
                existingUrls={settings.light}
            />

            <BrandingSection
                title="Dark Mode Assets"
                mode="light" // Light background for dark theme assets
                files={darkFiles}
                onFileChange={handleFileChange('dark')}
                existingUrls={settings.dark}
            />

            <div className="flex justify-end">
                <button
                    onClick={handleSaveChanges}
                    disabled={isSaving}
                    className="px-6 py-3 bg-antigravity-accent text-white font-semibold rounded-lg shadow-md hover:bg-antigravity-accent/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-antigravity-accent disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};