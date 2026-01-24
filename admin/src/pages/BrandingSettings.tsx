import React, { useState, useEffect } from 'react';
import { getBrandingSettings, updateBrandingSettings } from '../services/api';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
}

interface BrandingSettingsData {
    light: LogoSet;
    dark: LogoSet;
}

const DEFAULT_SETTINGS: BrandingSettingsData = {
    light: { isotype: '', logotype: '', imagotype: '' },
    dark: { isotype: '', logotype: '', imagotype: '' },
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
            setPreview(existingUrl);
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {(['isotype', 'logotype', 'imagotype'] as const).map(type => (
                    <div key={type}>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {type.charAt(0).toUpperCase() + type.slice(1)} (.png)
                        </label>
                        <input
                            type="file"
                            accept=".png"
                            onChange={(e) => handleFileChange(e, type)}
                            className="block w-full text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-antigravity-light-bg dark:file:bg-antigravity-dark-bg file:text-antigravity-light-text dark:file:text-antigravity-dark-text hover:file:bg-antigravity-light-border dark:hover:file:bg-antigravity-dark-border file:transition-colors"
                        />
                        <BrandingPreview
                            file={files[type] || null}
                            existingUrl={existingUrls?.[type] || null}
                            label={`${type} Preview`}
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
                setSettings({
                    light: { ...DEFAULT_SETTINGS.light, ...data.light },
                    dark: { ...DEFAULT_SETTINGS.dark, ...data.dark },
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
            const uploadPromises: Promise<{ mode: 'light' | 'dark', type: string, url: string }>[] = [];
            const allFiles = { light: lightFiles, dark: darkFiles };

            for (const mode of ['light', 'dark'] as const) {
                for (const [type, file] of Object.entries(allFiles[mode])) {
                    if (file) {
                        const path = `branding/${mode}_${type}.png`;
                        uploadPromises.push(
                            uploadFileToStorage(file, path).then(url => ({ mode, type, url }))
                        );
                    }
                }
            }

            const uploadedUrls = await Promise.all(uploadPromises);

            // Create a deep copy of the current settings to modify
            const newSettings: BrandingSettingsData = JSON.parse(JSON.stringify(settings));

            uploadedUrls.forEach(({ mode, type, url }) => {
                (newSettings[mode] as any)[type] = url;
            });

            await updateBrandingSettings(newSettings);
            setSettings(newSettings); // Update local state with new URLs
            setLightFiles({}); // Clear staged files
            setDarkFiles({});  // Clear staged files
            alert('Branding settings updated successfully!');
        } catch (error) {
            console.error('Failed to save branding settings:', error);
            alert('Failed to update settings. See console for details.');
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