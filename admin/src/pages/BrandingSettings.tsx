import React, { useState, useEffect } from 'react';
import { updateBrandingSettings, getBrandingSettings, LogoSet, BrandingSettings as BrandingSettingsType } from '../services/api';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, storage } from '../config/firebase';

const DEFAULT_SETTINGS: BrandingSettingsType = {
    light: { isotype: '', logotype: '', imagotype: '', pwaIcon: '', appIcon: '' },
    dark: { isotype: '', logotype: '', imagotype: '', pwaIcon: '', appIcon: '' },
    siteName: 'MINREPORT',
    primaryColor: '#C68346',
};

const uploadFileToStorage = async (file: File, path: string): Promise<string> => {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
};

const fixBrandingUrl = (url?: string): string => {
    if (!url) return '';
    const currentHost = location.hostname;
    if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
        return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return url;
};

interface AssetDefinition {
    key: keyof LogoSet;
    label: string;
    description: string;
    spec: string;
    recommendedDim: string;
}

const BRAND_ASSETS: AssetDefinition[] = [
    {
        key: 'isotype',
        label: 'Isotipo Oficial',
        description: 'Símbolo gráfico aislado para avatares, favicon comprimido y cabeceras compactas.',
        spec: 'SVG Vectorial o PNG 32-bit sRGB',
        recommendedDim: '512 × 512 px (1:1)',
    },
    {
        key: 'logotype',
        label: 'Logotipo Corporativo',
        description: 'Tipografía de marca horizontal para encabezados de informes y carátulas.',
        spec: 'SVG Vectorial o PNG transparente',
        recommendedDim: '1200 × 320 px (Horizontal)',
    },
    {
        key: 'imagotype',
        label: 'Imagotipo Principal',
        description: 'Identificador compuesto (Isotipo + Logotipo) para barras de navegación e informes técnicos.',
        spec: 'SVG Vectorial o PNG transparente',
        recommendedDim: '1400 × 400 px',
    },
    {
        key: 'pwaIcon',
        label: 'Ícono Web PWA',
        description: 'Activo maestro para manifest web y visualización en navegadores de escritorio y móviles.',
        spec: 'PNG cuadrado sin transparencia perimetral',
        recommendedDim: '512 × 512 px (1:1)',
    },
    {
        key: 'appIcon',
        label: 'Ícono Aplicación Móvil',
        description: 'Activo de alta resolución para empaquetado nativo (Android / iOS) con zona de seguridad del 10%.',
        spec: 'PNG cuadrado sin esquinas redondeadas',
        recommendedDim: '1024 × 1024 px (1:1)',
    },
];

export const BrandingSettings: React.FC = () => {
    const [settings, setSettings] = useState<BrandingSettingsType>(DEFAULT_SETTINGS);
    const [files, setFiles] = useState<{ [key: string]: File | null }>({});
    const [siteNameInput, setSiteNameInput] = useState('MINREPORT');
    const [primaryColorInput, setPrimaryColorInput] = useState('#C68346');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Control de inversión de luminancia para fondos oscuros industriales
    const [invertDarkMap, setInvertDarkMap] = useState<{ [key: string]: boolean }>({
        isotype: true,
        logotype: true,
        imagotype: true,
        pwaIcon: true,
        appIcon: true,
    });

    const toggleInvert = (key: string) => {
        setInvertDarkMap(prev => ({ ...prev, [key]: !(prev[key] ?? true) }));
    };

    useEffect(() => {
        const docRef = doc(db, 'settings', 'branding');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as BrandingSettingsType;
                const merged: BrandingSettingsType = {
                    light: { ...DEFAULT_SETTINGS.light, ...(data.light || {}) },
                    dark: { ...DEFAULT_SETTINGS.dark, ...(data.dark || {}) },
                    siteName: data.siteName || 'MINREPORT',
                    primaryColor: data.primaryColor || '#C68346',
                };
                setSettings(merged);
                setSiteNameInput(merged.siteName || 'MINREPORT');
                setPrimaryColorInput(merged.primaryColor || '#C68346');
            } else {
                setSettings(DEFAULT_SETTINGS);
            }
            setIsLoading(false);
        }, (error) => {
            console.error('Error al consultar configuración de identidad:', error);
            setSettings(DEFAULT_SETTINGS);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleFileChange = (key: keyof LogoSet, file: File | null) => {
        if (!file) {
            setFiles(prev => {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            });
            return;
        }

        const validTypes = ['image/svg+xml', 'image/png'];
        if (!validTypes.includes(file.type)) {
            setNotification({
                type: 'error',
                message: 'Formato no admitido. Se requiere archivo .svg vectorial o .png de alta definición.',
            });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        setFiles(prev => ({ ...prev, [key]: file }));
    };

    const handleSaveChanges = async () => {
        setIsSaving(true);
        try {
            const updatedSettings: BrandingSettingsType = {
                light: { ...settings.light },
                dark: { ...settings.dark },
                siteName: siteNameInput.trim() || 'MINREPORT',
                primaryColor: primaryColorInput.trim() || '#C68346',
            };

            const filesToUpload = Object.entries(files);
            for (const [key, file] of filesToUpload) {
                if (file) {
                    const ext = file.name.split('.').pop() || 'png';
                    const path = `branding/master_${key}.${ext}`;
                    const url = await uploadFileToStorage(file, path);

                    (updatedSettings.light as any)[key] = url;
                    (updatedSettings.dark as any)[key] = url;
                }
            }

            await updateBrandingSettings(updatedSettings);
            setSettings(updatedSettings);
            setFiles({});
            setNotification({
                type: 'success',
                message: 'Parámetros e identidad visual actualizados y sincronizados en el sistema.',
            });
            setTimeout(() => setNotification(null), 3500);
        } catch (error) {
            console.error('Error al guardar configuración de identidad:', error);
            setNotification({
                type: 'error',
                message: 'Error al persistir la configuración en Firestore o Cloud Storage.',
            });
            setTimeout(() => setNotification(null), 4000);
        } finally {
            setIsSaving(false);
        }
    };

    const pendingCount = Object.keys(files).length +
        (siteNameInput !== (settings.siteName || 'MINREPORT') ? 1 : 0) +
        (primaryColorInput !== (settings.primaryColor || '#C68346') ? 1 : 0);

    const registeredCount = BRAND_ASSETS.filter(a => !!settings.light[a.key]).length;

    if (isLoading) {
        return (
            <div className="py-21 text-center font-mono text-xs text-[#8A93A6]">
                [Consultando configuración de identidad corporativa...]
            </div>
        );
    }

    return (
        <div className="space-y-8 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        Identidad Visual del Sistema
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        Catálogo maestro de isotipos, logotipos y parámetros cromáticos de la plataforma.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSaveChanges}
                        disabled={isSaving || pendingCount === 0}
                        className="px-4 py-2 text-xs font-mono bg-[#C68346] text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                        <span className={`material-symbols-outlined text-[16px] ${isSaving ? 'animate-spin' : ''}`}>
                            {isSaving ? 'sync' : 'save'}
                        </span>
                        <span>{isSaving ? 'Sincronizando...' : 'Guardar Parámetros'}</span>
                    </button>
                </div>
            </div>

            {/* Notificación Operativa Inline */}
            {notification && (
                <div className={`px-4 py-2.5 border text-xs font-mono flex items-center gap-2 ${
                    notification.type === 'success'
                        ? 'bg-neutral-50 dark:bg-[#07090D] border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                        : 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-900 text-red-700 dark:text-red-400'
                }`}>
                    <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                        {notification.type === 'success' ? 'check_circle' : 'error'}
                    </span>
                    <span>{notification.message}</span>
                </div>
            )}

            {/* Macro-Layout en Proporción Áurea (61.8% / 38.2%) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Área Mayor (~61.8%): Informe Técnico de Activos de Identidad */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <h2 className="text-xs font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            Registro Maestro de Activos Gráficos ({registeredCount} / {BRAND_ASSETS.length})
                        </h2>
                        <span className="text-[11px] font-mono text-[#8A93A6]">
                            Formatos admitidos: SVG / PNG 32-bit
                        </span>
                    </div>

                    <div className="space-y-5">
                        {BRAND_ASSETS.map((asset) => {
                            const currentFile = files[asset.key];
                            const existingUrl = fixBrandingUrl(settings.light[asset.key]);
                            const previewSrc = currentFile ? URL.createObjectURL(currentFile) : existingUrl;
                            const isDeclared = !!previewSrc;
                            const isDarkInverted = invertDarkMap[asset.key] ?? true;

                            return (
                                <div
                                    key={asset.key}
                                    className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5 space-y-4"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-bold text-sm text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {asset.label}
                                                </h3>
                                                <span className="font-mono text-[10px] text-[#8A93A6] bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5">
                                                    {asset.key}
                                                </span>
                                            </div>
                                            <p className="text-xs text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                                {asset.description}
                                            </p>
                                        </div>
                                        <div className="text-right sm:shrink-0 font-mono text-[11px] text-[#8A93A6]">
                                            <div>{asset.recommendedDim}</div>
                                            <div className="text-[10px] text-[#5A6072]">{asset.spec}</div>
                                        </div>
                                    </div>

                                    {/* Previsualización Dual Blindada (Modo Claro vs Modo Oscuro) */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                                        {/* Fondo Claro */}
                                        <div className="border border-[#E2E8F0] bg-[#FFFFFF] p-4 flex flex-col items-center justify-between min-h-[140px] relative">
                                            <div className="w-full flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-mono text-[#475569] uppercase tracking-wide">
                                                    Visualización Fondo Claro
                                                </span>
                                                <span className="text-[9px] font-mono text-[#94A3B8]">
                                                    Luminancia: 100%
                                                </span>
                                            </div>
                                            <div className="w-full flex-1 flex items-center justify-center py-2">
                                                {previewSrc ? (
                                                    <img
                                                        src={previewSrc}
                                                        alt={`${asset.label} Fondo Claro`}
                                                        draggable={false}
                                                        onContextMenu={(e) => e.preventDefault()}
                                                        className="max-h-16 max-w-[85%] object-contain select-none pointer-events-none"
                                                        style={{ imageRendering: 'crisp-edges' }}
                                                    />
                                                ) : (
                                                    <span className="text-xs font-mono text-[#94A3B8] italic select-none">
                                                        [Información técnica no declarada en ficha]
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Fondo Oscuro con Inversión de Alto Contraste */}
                                        <div className="border border-[#12151C] bg-[#030406] p-4 flex flex-col items-center justify-between min-h-[140px] relative">
                                            <div className="w-full flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-mono text-[#8A93A6] uppercase tracking-wide">
                                                    Visualización Fondo Oscuro
                                                </span>
                                                {isDeclared && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleInvert(asset.key)}
                                                        className="text-[10px] font-mono text-[#8A93A6] hover:text-[#C68346] flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-0 p-0"
                                                        title="Alternar inversión de luminancia para activos negros monocromáticos"
                                                    >
                                                        <span className="material-symbols-outlined text-[13px]">
                                                            {isDarkInverted ? 'contrast' : 'tonality'}
                                                        </span>
                                                        <span>{isDarkInverted ? 'Invertido (Modo Oscuro)' : 'Original'}</span>
                                                    </button>
                                                )}
                                            </div>
                                            <div className="w-full flex-1 flex items-center justify-center py-2">
                                                {previewSrc ? (
                                                    <img
                                                        src={previewSrc}
                                                        alt={`${asset.label} Fondo Oscuro`}
                                                        draggable={false}
                                                        onContextMenu={(e) => e.preventDefault()}
                                                        className={`max-h-16 max-w-[85%] object-contain select-none pointer-events-none transition-all duration-200 ${
                                                            isDarkInverted ? 'invert brightness-150 contrast-125' : ''
                                                        }`}
                                                        style={{ imageRendering: 'crisp-edges' }}
                                                    />
                                                ) : (
                                                    <span className="text-xs font-mono text-[#5A6072] italic select-none">
                                                        [Información técnica no declarada en ficha]
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Selector de Archivo Quirúrgico */}
                                    <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="font-mono text-xs text-[#8A93A6] truncate">
                                            {currentFile ? (
                                                <span className="text-[#C68346] font-semibold">
                                                    Listo para subir: {currentFile.name} ({(currentFile.size / 1024).toFixed(1)} KB)
                                                </span>
                                            ) : isDeclared ? (
                                                <span className="text-neutral-500">
                                                    [Activo registrado en Cloud Storage]
                                                </span>
                                            ) : (
                                                <span className="italic text-[#94A3B8] dark:text-[#5A6072]">
                                                    [Sin archivo asignado]
                                                </span>
                                            )}
                                        </div>

                                        <label className="relative cursor-pointer shrink-0">
                                            <input
                                                type="file"
                                                accept=".svg,.png"
                                                autoComplete="off"
                                                onChange={(e) => handleFileChange(asset.key, e.target.files?.[0] || null)}
                                                className="sr-only"
                                            />
                                            <span className="py-1.5 px-3 text-xs font-mono inline-block border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] transition-colors">
                                                {currentFile ? 'Cambiar archivo' : isDeclared ? 'Reemplazar activo' : 'Cargar archivo'}
                                            </span>
                                        </label>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Área Menor (~38.2%): Parámetros, Especificaciones y Gobernanza */}
                <div className="lg:col-span-4 space-y-6">
                    {/* Parámetros Generales de la Instancia */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5 space-y-4">
                        <div className="pb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                Parámetros de Plataforma
                            </h3>
                            <p className="text-xs text-[#8A93A6] mt-0.5">
                                Identificadores globales consumidos por el runtime Web y PWA.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-mono text-[#475569] dark:text-[#8A93A6] mb-1">
                                    Nombre del Sistema (siteName)
                                </label>
                                <input
                                    type="text"
                                    value={siteNameInput}
                                    onChange={(e) => setSiteNameInput(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-3 py-2 text-xs font-mono border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-mono text-[#475569] dark:text-[#8A93A6] mb-1">
                                    Acento Primario (HEX)
                                </label>
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 border border-[#E2E8F0] dark:border-[#12151C] shrink-0"
                                        style={{ backgroundColor: primaryColorInput }}
                                        title={`Muestra de color: ${primaryColorInput}`}
                                    />
                                    <input
                                        type="text"
                                        value={primaryColorInput}
                                        onChange={(e) => setPrimaryColorInput(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="flex-1 px-3 py-2 text-xs font-mono border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] tabular-nums"
                                    />
                                </div>
                                <span className="text-[10px] font-mono text-[#8A93A6] mt-1 block">
                                    Valor oficial MINREPORT: #C68346 (Cobre Minero)
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Especificaciones Técnicas y Cumplimiento Normativo */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5 space-y-4">
                        <div className="pb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                Requisitos de Normalización
                            </h3>
                            <p className="text-xs text-[#8A93A6] mt-0.5">
                                Criterios técnicos para renderizado óptimo en cliente.
                            </p>
                        </div>

                        <div className="space-y-3 text-xs text-[#475569] dark:text-[#8A93A6]">
                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    contrast
                                </span>
                                <div>
                                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">Inversión Dinámica:</strong> Los activos corporativos maestros se cargan en negro monocromo y el motor los invierte dinámicamente en interfaces oscuras para máxima legibilidad.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    verified
                                </span>
                                <div>
                                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">Vectorial Prioritario:</strong> Se recomienda el uso exclusivo de archivos SVG limpios sin metadatos sobrantes para permitir escalamiento nítido a cualquier resolución.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    verified
                                </span>
                                <div>
                                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">Canal Alfa Obligatorio:</strong> Los mapas de bits (PNG) deben entregarse con canal alfa transparente y espacio de color sRGB estandarizado.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    verified
                                </span>
                                <div>
                                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">Zona Segura Móvil:</strong> El ícono de aplicación (1024×1024 px) debe contemplar un margen perimetral del 10% para corte adaptativo de Android e iOS.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Resumen de Estado de Persistencia */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] p-4 font-mono text-xs text-[#8A93A6] space-y-2">
                        <div className="flex justify-between items-center">
                            <span>Destino de Persistencia:</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">Firestore: settings/branding</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Almacenamiento de Medios:</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">Cloud Storage: /branding/*</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Cambios pendientes:</span>
                            <span className={pendingCount > 0 ? 'text-[#C68346] font-bold' : 'text-[#8A93A6]'}>
                                {pendingCount} modificación(es)
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
