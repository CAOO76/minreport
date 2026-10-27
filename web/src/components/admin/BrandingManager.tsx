import React, { useState, useEffect, useRef } from 'react';
import { auth, db, storage } from '../../config/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
    imagotypeVertical: string;
    pwaIcon: string;
    appIcon: string;
}

export interface BrandingSettings {
    light: LogoSet;
    dark: LogoSet;
    siteName: string;
    primaryColor: string;
    invertDarkMap?: { [key: string]: boolean };
    svgDataUris?: { [key: string]: string };
}

const DEFAULT_SETTINGS: BrandingSettings = {
    light: {
        isotype: '/branding/master_isotype.svg',
        logotype: '/branding/master_logotype.svg',
        imagotype: '/branding/master_imagotype.svg',
        imagotypeVertical: '/branding/master_imagotype_vertical.svg',
        pwaIcon: '/branding/master_pwaIcon.svg',
        appIcon: '/branding/master_appIcon.svg',
    },
    dark: {
        isotype: '/branding/master_isotype.svg',
        logotype: '/branding/master_logotype.svg',
        imagotype: '/branding/master_imagotype.svg',
        imagotypeVertical: '/branding/master_imagotype_vertical.svg',
        pwaIcon: '/branding/master_pwaIcon.svg',
        appIcon: '/branding/master_appIcon.svg',
    },
    siteName: 'MINREPORT',
    primaryColor: '#C68346',
};

interface AssetDefinition {
    key: keyof LogoSet;
    label: string;
    description: string;
    spec: string;
    recommendedDim: string;
    defaultPath: string;
}

const BRAND_ASSETS: AssetDefinition[] = [
    {
        key: 'isotype',
        label: 'Isotipo Oficial',
        description: 'Símbolo gráfico aislado para cabeceras compactas, avatares y favicon de alta fidelidad.',
        spec: 'SVG Vectorial o PNG 32-bit sRGB',
        recommendedDim: '512 × 512 px (1:1)',
        defaultPath: '/branding/master_isotype.svg',
    },
    {
        key: 'logotype',
        label: 'Logotipo Corporativo',
        description: 'Tipografía de marca horizontal para encabezados de informes oficiales, carátulas y accesos.',
        spec: 'SVG Vectorial o PNG transparente',
        recommendedDim: '1200 × 320 px (Horizontal)',
        defaultPath: '/branding/master_logotype.svg',
    },
    {
        key: 'imagotype',
        label: 'Imagotipo Principal (Horizontal)',
        description: 'Identificador compuesto horizontal (Isotipo + Logotipo) para barras de navegación e informes técnicos.',
        spec: 'SVG Vectorial o PNG transparente',
        recommendedDim: '1400 × 400 px',
        defaultPath: '/branding/master_imagotype.svg',
    },
    {
        key: 'imagotypeVertical',
        label: 'Imagotipo Vertical',
        description: 'Identificador compuesto vertical (Isotipo sobre Logotipo) para pantallas de carga (Splash), credenciales de faena y carátulas verticales.',
        spec: 'SVG Vectorial o PNG transparente',
        recommendedDim: '800 × 1067 px (Vertical 3:4)',
        defaultPath: '/branding/master_imagotype_vertical.svg',
    },
    {
        key: 'pwaIcon',
        label: 'Ícono Web PWA',
        description: 'Activo maestro para manifest web y acceso directo en navegadores de escritorio y terreno.',
        spec: 'PNG cuadrado sin transparencia perimetral',
        recommendedDim: '512 × 512 px (1:1)',
        defaultPath: '/branding/master_pwaIcon.svg',
    },
    {
        key: 'appIcon',
        label: 'Ícono Aplicación Móvil',
        description: 'Activo de alta resolución para empaquetado nativo (Android / iOS) con margen de seguridad del 10%.',
        spec: 'PNG cuadrado sin esquinas redondeadas',
        recommendedDim: '1024 × 1024 px (1:1)',
        defaultPath: '/branding/master_appIcon.svg',
    },
];

const fixBrandingUrl = (url?: string): string => {
    if (!url) return '';
    const currentHost = window.location.hostname;
    if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
        return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return url;
};

interface BrandingManagerProps {
    className?: string;
}

export const BrandingManager: React.FC<BrandingManagerProps> = ({ className = '' }) => {
    const [settings, setSettings] = useState<BrandingSettings>(DEFAULT_SETTINGS);
    const [files, setFiles] = useState<{ [key: string]: File | null }>({});
    const [previewUrls, setPreviewUrls] = useState<{ [key: string]: string }>({});
    const [siteNameInput, setSiteNameInput] = useState('MINREPORT');
    const [primaryColorInput, setPrimaryColorInput] = useState('#C68346');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Modal de confirmación obligatoria por palabra clave ("ACTUALIZAR")
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmKeyword, setConfirmKeyword] = useState('');

    // Control de inversión de luminancia para fondos oscuros industriales
    const [invertDarkMap, setInvertDarkMap] = useState<{ [key: string]: boolean }>({
        isotype: true,
        logotype: true,
        imagotype: true,
        imagotypeVertical: true,
        pwaIcon: true,
        appIcon: true,
    });
    const [dirtyMetadataCount, setDirtyMetadataCount] = useState<number>(0);

    const previewUrlsRef = useRef<{ [key: string]: string }>({});

    const readFileAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });

    const toggleInvert = (key: string) => {
        setInvertDarkMap(prev => ({ ...prev, [key]: !(prev[key] ?? true) }));
        setDirtyMetadataCount(c => c + 1);
    };

    // Sincronización en tiempo real desde Firestore settings/branding
    useEffect(() => {
        const docRef = doc(db, 'settings', 'branding');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as Partial<BrandingSettings>;
                const merged: BrandingSettings = {
                    light: { ...DEFAULT_SETTINGS.light, ...(data.light || {}) },
                    dark: { ...DEFAULT_SETTINGS.dark, ...(data.dark || {}) },
                    siteName: data.siteName || 'MINREPORT',
                    primaryColor: data.primaryColor || '#C68346',
                    invertDarkMap: data.invertDarkMap || {
                        isotype: true,
                        logotype: true,
                        imagotype: true,
                        imagotypeVertical: true,
                        pwaIcon: true,
                        appIcon: true,
                    },
                    svgDataUris: data.svgDataUris || {},
                };
                setSettings(merged);
                setSiteNameInput(merged.siteName);
                setPrimaryColorInput(merged.primaryColor);
                if (merged.invertDarkMap) {
                    setInvertDarkMap(merged.invertDarkMap);
                }
            } else {
                setSettings(DEFAULT_SETTINGS);
            }
            setIsLoading(false);
        }, (error) => {
            console.error('[BrandingManager] Error consultando configuración:', error);
            setSettings(DEFAULT_SETTINGS);
            setIsLoading(false);
        });

        return () => {
            unsubscribe();
            // Revocar URLs de previsualización locales
            Object.values(previewUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
        };
    }, []);

    const handleFileChange = (key: keyof LogoSet, file: File | null) => {
        if (!file) {
            if (previewUrls[key]) {
                URL.revokeObjectURL(previewUrls[key]);
            }
            setFiles(prev => {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            });
            setPreviewUrls(prev => {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            });
            return;
        }

        const validTypes = ['image/svg+xml', 'image/png', 'image/x-icon'];
        if (!validTypes.includes(file.type) && !file.name.endsWith('.svg') && !file.name.endsWith('.png')) {
            setNotification({
                type: 'error',
                message: 'Formato no admitido. Se exige archivo .svg vectorial o .png de alta definición.',
            });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        // Crear previsualización local instantánea
        const objectUrl = URL.createObjectURL(file);
        if (previewUrls[key]) {
            URL.revokeObjectURL(previewUrls[key]);
        }
        previewUrlsRef.current[key] = objectUrl;

        setFiles(prev => ({ ...prev, [key]: file }));
        setPreviewUrls(prev => ({ ...prev, [key]: objectUrl }));
    };

    const handleResetAsset = (key: keyof LogoSet) => {
        if (previewUrls[key]) {
            URL.revokeObjectURL(previewUrls[key]);
        }
        setFiles(prev => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        setPreviewUrls(prev => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        setSettings(prev => {
            const nextSvgUris = { ...(prev.svgDataUris || {}) };
            delete nextSvgUris[key];
            return {
                ...prev,
                light: { ...prev.light, [key]: DEFAULT_SETTINGS.light[key] },
                dark: { ...prev.dark, [key]: DEFAULT_SETTINGS.dark[key] },
                svgDataUris: nextSvgUris,
            };
        });
        setDirtyMetadataCount(c => c + 1);
    };

    const handleOpenConfirm = () => {
        setConfirmKeyword('');
        setShowConfirmModal(true);
    };

    const handleExecuteSave = async () => {
        if (confirmKeyword.trim() !== 'ACTUALIZAR') return;

        setIsSaving(true);
        setShowConfirmModal(false);

        try {
            const updatedSettings: BrandingSettings = {
                light: { ...settings.light },
                dark: { ...settings.dark },
                siteName: siteNameInput.trim() || 'MINREPORT',
                primaryColor: primaryColorInput.trim() || '#C68346',
                invertDarkMap: { ...invertDarkMap },
                svgDataUris: { ...(settings.svgDataUris || {}) },
            };

            // Subir archivos a Cloud Storage y almacenar copia vectorial portátil para SVG
            const filesToUpload = Object.entries(files);
            for (const [key, file] of filesToUpload) {
                if (file) {
                    const ext = (file.name.split('.').pop() || 'svg').toLowerCase();
                    const fileKey = key === 'imagotypeVertical' ? 'imagotype_vertical' : key;
                    const path = `branding/master_${fileKey}.${ext}`;
                    const storageRef = ref(storage, path);
                    const snapshot = await uploadBytes(storageRef, file);
                    const downloadUrl = await getDownloadURL(snapshot.ref);

                    (updatedSettings.light as any)[key] = downloadUrl;
                    (updatedSettings.dark as any)[key] = downloadUrl;

                    if ((ext === 'svg' || file.type === 'image/svg+xml') && file.size <= 150 * 1024) {
                        const dataUri = await readFileAsDataUrl(file);
                        if (dataUri) {
                            updatedSettings.svgDataUris![key] = dataUri;
                        }
                    } else if (updatedSettings.svgDataUris?.[key]) {
                        delete updatedSettings.svgDataUris[key];
                    }
                }
            }

            // 1. Guardar en Firestore directamente
            await setDoc(doc(db, 'settings', 'branding'), updatedSettings, { merge: true });

            // 2. Notificar al backend para sincronización automática de filesystem (Web, Admin, Mobile y ./data)
            try {
                const apiBase = (import.meta as any).env?.VITE_API_URL 
                    ? (import.meta as any).env.VITE_API_URL 
                    : `http://${window.location.hostname}:8080`;
                
                const firebaseIdToken = await auth.currentUser?.getIdToken().catch(() => '');
                const token =
                    firebaseIdToken ||
                    localStorage.getItem('dev_auth_token') ||
                    localStorage.getItem('dev_vault_token') ||
                    localStorage.getItem('dev_token') ||
                    localStorage.getItem('admin_token') ||
                    '';
                if (token) {
                    await fetch(`${apiBase}/api/admin/settings/branding`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(updatedSettings)
                    });
                }
            } catch {
                // Sincronización backend secundaria opcional
            }

            // Limpieza de archivos temporales
            Object.values(previewUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
            previewUrlsRef.current = {};
            setFiles({});
            setPreviewUrls({});
            setDirtyMetadataCount(0);
            setSettings(updatedSettings);

            setNotification({
                type: 'success',
                message: 'Identidad corporativa actualizada y sincronizada en tiempo real en todo el sistema.',
            });
            setTimeout(() => setNotification(null), 4000);
        } catch (error: any) {
            console.error('[BrandingManager] Error persistiendo cambios:', error);
            setNotification({
                type: 'error',
                message: error.message || 'Error al persistir la configuración de identidad en Cloud Storage o Firestore.',
            });
            setTimeout(() => setNotification(null), 5000);
        } finally {
            setIsSaving(false);
        }
    };

    const pendingCount = Object.keys(files).length +
        dirtyMetadataCount +
        (siteNameInput !== (settings.siteName || 'MINREPORT') ? 1 : 0) +
        (primaryColorInput !== (settings.primaryColor || '#C68346') ? 1 : 0);

    const registeredCount = BRAND_ASSETS.filter(a => !!settings.light[a.key]).length;

    if (isLoading) {
        return (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 font-mono text-xs text-slate-400 dark:text-[#8A93A6]">
                <span className="material-symbols-outlined text-2xl animate-spin text-[#C68346]">sync</span>
                <span className="tabular-nums">[Sincronizando catálogo maestro de identidad...]</span>
            </div>
        );
    }

    return (
        <div className={`space-y-6 font-sans select-none ${className}`}>
            
            {/* Cabecera Técnica de Sección */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#12151C]">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono font-bold uppercase text-[#C68346] tracking-wider">
                            MINREPORT // GOBERNANZA DE IDENTIDAD
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-[#5A6072]">•</span>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-[#5A6072] uppercase">
                            CATÁLOGO MAESTRO
                        </span>
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                        Gestor de Logos & Activos de Marca
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-[#8A93A6] mt-0.5">
                        Administración de isotipos, logotipos e imagotipos corporativos para entornos web, móvil y carátulas técnicas.
                    </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={handleOpenConfirm}
                        disabled={isSaving || pendingCount === 0}
                        className="px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider bg-[#C68346] hover:bg-[#b0743e] text-white disabled:opacity-40 transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed rounded-none outline-none shadow-none"
                    >
                        <span className={`material-symbols-outlined text-[16px] ${isSaving ? 'animate-spin' : ''}`}>
                            {isSaving ? 'sync' : 'save'}
                        </span>
                        <span>{isSaving ? 'SINCRONIZANDO...' : `GUARDAR CAMBIOS (${pendingCount})`}</span>
                    </button>
                </div>
            </div>

            {/* Notificación Operativa Inline */}
            {notification && (
                <div className={`px-4 py-2.5 border text-xs font-mono flex items-center gap-2 rounded-none ${
                    notification.type === 'success'
                        ? 'bg-slate-50 dark:bg-[#07090D] border-[#C68346] text-slate-900 dark:text-[#F3F4F6]'
                        : 'bg-red-500/10 border-red-500 text-red-600 dark:text-red-400'
                }`}>
                    <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                        {notification.type === 'success' ? 'check_circle' : 'error'}
                    </span>
                    <span>{notification.message}</span>
                </div>
            )}

            {/* Macro-Layout en Proporción Áurea (61.8% / 38.2%) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* ÁREA MAYOR (~61.8%): Visor y Gestor de Activos Gráficos */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#12151C]">
                        <h2 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-[#8A93A6]">
                            ACTIVOS REGISTRADOS (<span className="tabular-nums">{registeredCount} / {BRAND_ASSETS.length}</span>)
                        </h2>
                        <span className="text-[11px] font-mono text-slate-400 dark:text-[#5A6072]">
                            Formatos admitidos: SVG Vectorial / PNG 32-bit
                        </span>
                    </div>

                    <div className="space-y-4">
                        {BRAND_ASSETS.map((asset) => {
                            const currentFile = files[asset.key];
                            const localPreview = previewUrls[asset.key];
                            const firestoreUrl = fixBrandingUrl(settings.light[asset.key]);
                            const previewSrc = localPreview || firestoreUrl || asset.defaultPath;
                            const isDarkInverted = invertDarkMap[asset.key] ?? true;
                            const isCustom = !!firestoreUrl && !firestoreUrl.startsWith('/branding/');

                            return (
                                <div
                                    key={asset.key}
                                    className="border border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-5 rounded-none space-y-4"
                                >
                                    {/* Cabecera del Activo */}
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-[#12151C]">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-sm font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                                                    {asset.label}
                                                </h3>
                                                {isCustom && (
                                                    <span className="px-1.5 py-0.5 text-[9px] font-mono uppercase border border-[#C68346]/40 text-[#C68346] bg-[#C68346]/5">
                                                        CUSTOMIZADO
                                                    </span>
                                                )}
                                                {currentFile && (
                                                    <span className="px-1.5 py-0.5 text-[9px] font-mono uppercase border border-amber-500/40 text-amber-500 bg-amber-500/5 animate-pulse">
                                                        PENDIENTE DE SUBIDA
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 dark:text-[#8A93A6] mt-0.5 leading-relaxed">
                                                {asset.description}
                                            </p>
                                        </div>
                                        <div className="text-left sm:text-right font-mono text-[11px] text-slate-400 dark:text-[#5A6072] shrink-0 tabular-nums">
                                            <div>{asset.recommendedDim}</div>
                                            <div className="text-[10px] text-slate-400 dark:text-[#5A6072]">{asset.spec}</div>
                                        </div>
                                    </div>

                                    {/* Visualización Dual de Alta Fidelidad (Fondo Claro vs Fondo Oscuro) */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        
                                        {/* 1. Fondo Claro */}
                                        <div className="border border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] p-4 flex flex-col items-center justify-between min-h-[130px] rounded-none">
                                            <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase">
                                                <span>Fondo Claro</span>
                                                <span className="tabular-nums">Luminancia 100%</span>
                                            </div>
                                            <div className="w-full flex-1 flex items-center justify-center py-3">
                                                <img
                                                    src={previewSrc}
                                                    alt={`${asset.label} Claro`}
                                                    draggable={false}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    className="max-h-14 max-w-[85%] object-contain select-none pointer-events-none"
                                                    style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).src = asset.defaultPath;
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* 2. Fondo Oscuro Industrial (#000000) */}
                                        <div className="border border-slate-200 dark:border-[#12151C] bg-[#000000] p-4 flex flex-col items-center justify-between min-h-[130px] rounded-none">
                                            <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase">
                                                <span>Fondo Oscuro</span>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleInvert(asset.key)}
                                                    className="bg-transparent border-0 outline-none p-0 text-slate-400 hover:text-[#C68346] flex items-center gap-1 cursor-pointer transition-colors"
                                                    title="Alternar inversión de luminancia para activos monocromáticos"
                                                >
                                                    <span className="material-symbols-outlined text-[13px]">
                                                        {isDarkInverted ? 'contrast' : 'tonality'}
                                                    </span>
                                                    <span>{isDarkInverted ? 'Invertido' : 'Original'}</span>
                                                </button>
                                            </div>
                                            <div className="w-full flex-1 flex items-center justify-center py-3">
                                                <img
                                                    src={previewSrc}
                                                    alt={`${asset.label} Oscuro`}
                                                    draggable={false}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    className={`max-h-14 max-w-[85%] object-contain select-none pointer-events-none transition-all ${
                                                        isDarkInverted ? 'invert brightness-150 contrast-125' : ''
                                                    }`}
                                                    style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).src = asset.defaultPath;
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Selector de Archivo Quirúrgico */}
                                    <div className="pt-2 border-t border-slate-100 dark:border-[#12151C] flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
                                        <div className="text-slate-500 dark:text-[#8A93A6] truncate">
                                            {currentFile ? (
                                                <span className="text-[#C68346] font-bold tabular-nums">
                                                    Listo para subir: {currentFile.name} ({(currentFile.size / 1024).toFixed(1)} KB)
                                                </span>
                                            ) : isCustom ? (
                                                <span className="text-slate-400 dark:text-[#5A6072]">
                                                    [Activo corporativo personalizado en Storage]
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 dark:text-[#5A6072]">
                                                    [Activo maestro local: {asset.defaultPath}]
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {isCustom && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleResetAsset(asset.key)}
                                                    className="px-3 py-1.5 text-xs font-mono border border-slate-200 dark:border-[#12151C] bg-transparent hover:border-red-500 hover:text-red-500 text-slate-400 transition-colors cursor-pointer rounded-none"
                                                    title="Restablecer activo al original del sistema"
                                                >
                                                    Restablecer
                                                </button>
                                            )}

                                            <label className="relative cursor-pointer">
                                                <input
                                                    type="file"
                                                    accept=".svg,.png"
                                                    autoComplete="off"
                                                    onChange={(e) => handleFileChange(asset.key, e.target.files?.[0] || null)}
                                                    className="sr-only"
                                                />
                                                <span className="px-3 py-1.5 text-xs font-mono inline-block border border-slate-300 dark:border-[#12151C] bg-slate-50 dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] hover:border-[#C68346] transition-colors rounded-none">
                                                    {currentFile ? 'Cambiar archivo' : isCustom ? 'Reemplazar activo' : 'Cargar archivo'}
                                                </span>
                                            </label>
                                        </div>
                                    </div>

                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ÁREA MENOR (~38.2%): Parámetros de Plataforma & Gobernanza */}
                <div className="lg:col-span-4 space-y-6">
                    
                    {/* Parámetros Generales */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-5 rounded-none space-y-4">
                        <div className="pb-3 border-b border-slate-200 dark:border-[#12151C]">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-[#8A93A6]">
                                PARÁMETROS GLOBALES DE INSTANCIA
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-[#5A6072] mt-0.5">
                                Identificadores consumidos por el runtime Web, PWA y reportes.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-mono uppercase text-slate-500 dark:text-[#8A93A6] mb-1">
                                    Nombre del Sistema
                                </label>
                                <input
                                    type="text"
                                    value={siteNameInput}
                                    onChange={(e) => setSiteNameInput(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-mono uppercase text-slate-500 dark:text-[#8A93A6] mb-1">
                                    Acento Primario (HEX)
                                </label>
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 border border-slate-300 dark:border-[#12151C] shrink-0 rounded-none"
                                        style={{ backgroundColor: primaryColorInput }}
                                        title={`Muestra de color: ${primaryColorInput}`}
                                    />
                                    <input
                                        type="text"
                                        value={primaryColorInput}
                                        onChange={(e) => setPrimaryColorInput(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none tabular-nums transition-colors"
                                    />
                                </div>
                                <span className="text-[10px] font-mono text-slate-400 dark:text-[#5A6072] mt-1 block">
                                    Valor oficial MINREPORT: #C68346 (Cobre Industrial)
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Especificaciones Técnicas y Cumplimiento Normativo */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-5 rounded-none space-y-4">
                        <div className="pb-3 border-b border-slate-200 dark:border-[#12151C]">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-[#8A93A6]">
                                CRITERIOS TÉCNICOS DE REPOSITORIO
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-[#5A6072] mt-0.5">
                                Normalización para renderizado en faena y dispositivos móviles.
                            </p>
                        </div>

                        <div className="space-y-3 text-xs text-slate-500 dark:text-[#8A93A6]">
                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    contrast
                                </span>
                                <div>
                                    <strong className="text-slate-900 dark:text-[#F3F4F6]">Inversión Dinámica:</strong> Los activos corporativos maestros se cargan en negro monocromo y el motor los invierte dinámicamente en interfaces oscuras.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    verified
                                </span>
                                <div>
                                    <strong className="text-slate-900 dark:text-[#F3F4F6]">Vectorial SVG:</strong> Se recomienda el uso exclusivo de archivos SVG sin metadatos sobrantes para permitir escalabilidad nítida sin pixelación.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    verified
                                </span>
                                <div>
                                    <strong className="text-slate-900 dark:text-[#F3F4F6]">Canal Alfa Obligatorio:</strong> Los mapas de bits (PNG) deben entregarse con canal alfa transparente y espacio sRGB.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    verified
                                </span>
                                <div>
                                    <strong className="text-slate-900 dark:text-[#F3F4F6]">Zona Segura Móvil:</strong> El ícono de aplicación (1024×1024 px) contempla un margen perimetral del 10% para el corte adaptativo de Android e iOS.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Resumen de Persistencia */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] p-4 rounded-none font-mono text-xs text-slate-500 dark:text-[#8A93A6] space-y-2">
                        <div className="flex justify-between items-center">
                            <span>Destino Persistencia:</span>
                            <span className="text-slate-900 dark:text-[#F3F4F6]">settings/branding</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Almacenamiento Medios:</span>
                            <span className="text-slate-900 dark:text-[#F3F4F6]">Cloud Storage: /branding/*</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Modificaciones pendientes:</span>
                            <span className={pendingCount > 0 ? 'text-[#C68346] font-bold tabular-nums' : 'text-slate-400 tabular-nums'}>
                                {pendingCount} cambio(s)
                            </span>
                        </div>
                    </div>

                </div>

            </div>

            {/* MODAL DE CONFIRMACIÓN OBLIGATORIA POR PALABRA CLAVE ("ACTUALIZAR") */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white dark:bg-[#07090D] border border-slate-300 dark:border-[#12151C] p-6 rounded-none space-y-5 shadow-none font-mono">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <div className="flex items-center gap-2 text-slate-900 dark:text-[#F3F4F6]">
                                <span className="material-symbols-outlined text-[#C68346] text-[20px]">warning</span>
                                <span className="font-bold text-xs uppercase tracking-wider">CONFIRMACIÓN HITL REQUERIDA</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowConfirmModal(false)}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-[#8A93A6] leading-relaxed">
                            Está a punto de actualizar los activos de identidad corporativa maestros de MINREPORT en Firestore y Cloud Storage.
                            Para validar la operación, escriba obligatoriamente <strong className="text-[#C68346]">ACTUALIZAR</strong> a continuación:
                        </p>

                        <div className="space-y-2">
                            <label className="block text-[10px] uppercase text-slate-400 tracking-wider">
                                Palabra Clave de Seguridad
                            </label>
                            <input
                                type="text"
                                autoFocus
                                autoComplete="off"
                                spellCheck={false}
                                value={confirmKeyword}
                                onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                                placeholder="ACTUALIZAR"
                                className="w-full bg-[#F8FAFC] dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] px-3 py-2 text-xs font-mono tracking-widest text-center rounded-none outline-none"
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowConfirmModal(false)}
                                className="px-4 py-2 text-xs font-mono uppercase bg-transparent border border-slate-300 dark:border-[#12151C] text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-none cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleExecuteSave}
                                disabled={confirmKeyword.trim() !== 'ACTUALIZAR' || isSaving}
                                className="px-5 py-2 text-xs font-mono font-bold uppercase tracking-wider bg-[#C68346] hover:bg-[#b0743e] text-white disabled:opacity-30 disabled:cursor-not-allowed rounded-none cursor-pointer transition-colors"
                            >
                                Confirmar y Sincronizar
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default BrandingManager;
