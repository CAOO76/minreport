import React, { useState, useEffect } from 'react';
import { getUIAssetsSettings, updateUIAssetsSettings, UIAssetsData } from '../services/api';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../config/firebase';

const uploadAssetToStorage = async (file: File, path: string): Promise<string> => {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
};

const fixAssetUrl = (url?: string): string => {
    if (!url) return '';
    const currentHost = location.hostname;
    if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
        return url.replace(/localhost|127\.0\.0\.1/g, currentHost);
    }
    return url;
};

interface SubstrateDefinition {
    id: keyof UIAssetsData;
    label: string;
    description: string;
    targetModule: string;
    recommendedDim: string;
    maxWeight: string;
}

const SUBSTRATES: SubstrateDefinition[] = [
    {
        id: 'login_bg',
        label: 'Sustrato de Acceso (Login)',
        description: 'Fondo de pantalla principal para la vista de autenticación y pasarela de acceso.',
        targetModule: 'Módulo de Identidad y Autenticación',
        recommendedDim: '1920 × 1080 px (16:9)',
        maxWeight: '< 350 KB',
    },
    {
        id: 'dashboard_bg',
        label: 'Sustrato del Panel Principal (Dashboard)',
        description: 'Textura de fondo para el lienzo del cuadro de mando operativo y módulos de datos.',
        targetModule: 'Cuadro de Mando y Módulos Satélites',
        recommendedDim: '2560 × 1440 px (16:9)',
        maxWeight: '< 400 KB',
    },
    {
        id: 'sidebar_bg',
        label: 'Sustrato de Navegación Lateral (Sidebar)',
        description: 'Fondo textural para la barra de navegación vertical y accesos directos de navegación.',
        targetModule: 'Layout Global de Navegación',
        recommendedDim: '400 × 1200 px (Vertical)',
        maxWeight: '< 150 KB',
    },
];

export const UIAssetsSettings: React.FC = () => {
    const [settings, setSettings] = useState<UIAssetsData>({
        login_bg: '',
        dashboard_bg: '',
        sidebar_bg: '',
    });
    const [files, setFiles] = useState<{ [key: string]: File | null }>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await getUIAssetsSettings();
                if (response.data) {
                    setSettings(response.data);
                }
            } catch (error) {
                console.error('Error al consultar sustratos de interfaz:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSettings();
    }, []);

    const handleFileChange = (id: keyof UIAssetsData, file: File | null) => {
        if (!file) {
            setFiles(prev => {
                const copy = { ...prev };
                delete copy[id];
                return copy;
            });
            return;
        }

        const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            setNotification({
                type: 'error',
                message: 'Formato no admitido. Se requiere imagen en formato WebP, PNG o JPG.',
            });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        setFiles(prev => ({ ...prev, [id]: file }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updated = { ...settings };
            for (const [key, file] of Object.entries(files)) {
                if (file) {
                    const ext = file.name.split('.').pop() || 'webp';
                    const url = await uploadAssetToStorage(file, `ui_assets/${key}.${ext}`);
                    (updated as any)[key] = url;
                }
            }
            await updateUIAssetsSettings(updated);
            setSettings(updated);
            setFiles({});
            setNotification({
                type: 'success',
                message: 'Sustratos de interfaz visual actualizados y sincronizados con éxito.',
            });
            setTimeout(() => setNotification(null), 3500);
        } catch (error) {
            console.error('Error al guardar sustratos de interfaz:', error);
            setNotification({
                type: 'error',
                message: 'Error al persistir los sustratos en el servidor o Cloud Storage.',
            });
            setTimeout(() => setNotification(null), 4000);
        } finally {
            setIsSaving(false);
        }
    };

    const pendingCount = Object.keys(files).length;
    const registeredCount = SUBSTRATES.filter(s => !!settings[s.id]).length;

    if (isLoading) {
        return (
            <div className="py-21 text-center font-mono text-xs text-[#8A93A6]">
                [Consultando catálogo de medios y sustratos de interfaz...]
            </div>
        );
    }

    return (
        <div className="space-y-8 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        Biblioteca de Medios del Sistema
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        Administración de fondos y sustratos visuales para las superficies del entorno de operaciones.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={isSaving || pendingCount === 0}
                        className="px-4 py-2 text-xs font-mono bg-[#C68346] text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                        <span className={`material-symbols-outlined text-[16px] ${isSaving ? 'animate-spin' : ''}`}>
                            {isSaving ? 'sync' : 'save'}
                        </span>
                        <span>{isSaving ? 'Sincronizando...' : 'Guardar Sustratos'}</span>
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
                {/* Área Mayor (~61.8%): Visor e Inspección Técnica de Sustratos */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <h2 className="text-xs font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            Sustratos Visuales de Interfaz ({registeredCount} / {SUBSTRATES.length})
                        </h2>
                        <span className="text-[11px] font-mono text-[#8A93A6]">
                            Formatos admitidos: WebP / PNG / JPG
                        </span>
                    </div>

                    <div className="space-y-6">
                        {SUBSTRATES.map((substrate) => {
                            const currentFile = files[substrate.id];
                            const existingUrl = fixAssetUrl(settings[substrate.id]);
                            const previewSrc = currentFile ? URL.createObjectURL(currentFile) : existingUrl;
                            const isDeclared = !!previewSrc;

                            return (
                                <div
                                    key={substrate.id}
                                    className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5 space-y-4"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-bold text-sm text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {substrate.label}
                                                </h3>
                                                <span className="font-mono text-[10px] text-[#8A93A6] bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5">
                                                    {substrate.id}
                                                </span>
                                            </div>
                                            <p className="text-xs text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                                {substrate.description}
                                            </p>
                                        </div>
                                        <div className="text-right sm:shrink-0 font-mono text-[11px] text-[#8A93A6]">
                                            <div>{substrate.recommendedDim}</div>
                                            <div className="text-[10px] text-[#5A6072]">Peso máx: {substrate.maxWeight}</div>
                                        </div>
                                    </div>

                                    {/* Visor Panorámico Blindado (16:9) */}
                                    <div className="relative border border-[#E2E8F0] dark:border-[#12151C] bg-neutral-50 dark:bg-[#030406] overflow-hidden aspect-video max-h-[260px] flex items-center justify-center">
                                        {previewSrc ? (
                                            <img
                                                src={previewSrc}
                                                alt={substrate.label}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                className="w-full h-full object-cover select-none pointer-events-none"
                                            />
                                        ) : (
                                            <div className="text-center font-mono text-xs text-[#94A3B8] dark:text-[#5A6072] italic p-6 select-none">
                                                [Información técnica no declarada en ficha]
                                            </div>
                                        )}
                                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm text-white font-mono text-[10px]">
                                            {substrate.targetModule}
                                        </div>
                                    </div>

                                    {/* Control Quirúrgico de Archivo */}
                                    <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="font-mono text-xs text-[#8A93A6] truncate">
                                            {currentFile ? (
                                                <span className="text-[#C68346] font-semibold">
                                                    Listo para subir: {currentFile.name} ({(currentFile.size / 1024).toFixed(1)} KB)
                                                </span>
                                            ) : isDeclared ? (
                                                <span className="text-neutral-500">
                                                    [Activo persistido en Cloud Storage]
                                                </span>
                                            ) : (
                                                <span className="italic text-[#94A3B8] dark:text-[#5A6072]">
                                                    [Sin activo asignado]
                                                </span>
                                            )}
                                        </div>

                                        <label className="relative cursor-pointer shrink-0">
                                            <input
                                                type="file"
                                                accept="image/jpeg,image/png,image/webp"
                                                autoComplete="off"
                                                onChange={(e) => handleFileChange(substrate.id, e.target.files?.[0] || null)}
                                                className="sr-only"
                                            />
                                            <span className="py-1.5 px-3 text-xs font-mono inline-block border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] transition-colors">
                                                {currentFile ? 'Cambiar archivo' : isDeclared ? 'Reemplazar sustrato' : 'Cargar sustrato'}
                                            </span>
                                        </label>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Área Menor (~38.2%): Panel de Rendimiento y Gobernanza de Medios */}
                <div className="lg:col-span-4 space-y-6">
                    {/* Presupuesto de Rendimiento Frontend */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5 space-y-4">
                        <div className="pb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                Presupuesto de Rendimiento (CWV)
                            </h3>
                            <p className="text-xs text-[#8A93A6] mt-0.5">
                                Parámetros de higiene de red para asegurar LCP &lt; 1.2 s.
                            </p>
                        </div>

                        <div className="space-y-3 font-mono text-xs">
                            <div className="p-3 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406]">
                                <div className="text-[10px] text-[#8A93A6] uppercase">LCP (Largest Contentful Paint)</div>
                                <div className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 tabular-nums">&lt; 1.2 segundos</div>
                                <div className="text-[10px] text-[#475569] dark:text-[#8A93A6] mt-1 font-sans">
                                    Los fondos de pantalla no deben bloquear el hilo principal ni retrasar la pintura del contenido crítico.
                                </div>
                            </div>

                            <div className="p-3 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406]">
                                <div className="text-[10px] text-[#8A93A6] uppercase">Compresión y Formato</div>
                                <div className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">WebP Nativo</div>
                                <div className="text-[10px] text-[#475569] dark:text-[#8A93A6] mt-1 font-sans">
                                    Se recomienda codificar los fondos en formato WebP con calidad 80-85% para reducir el payload en un 60% respecto a JPG/PNG.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Directivas de Almacenamiento y Caché */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5 space-y-4">
                        <div className="pb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                Directivas de Entrega de Medios
                            </h3>
                            <p className="text-xs text-[#8A93A6] mt-0.5">
                                Arquitectura de entrega mediante Cloudflare Edge.
                            </p>
                        </div>

                        <div className="space-y-3 text-xs text-[#475569] dark:text-[#8A93A6]">
                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    cloud_done
                                </span>
                                <div>
                                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">Caché Inmutable:</strong> Cabecera <code>Cache-Control: public, max-age=31536000, immutable</code> para garantizar entrega instantánea desde CDN Edge.
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-[16px] text-[#C68346] shrink-0 mt-0.5">
                                    security
                                </span>
                                <div>
                                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">Blindaje de Medios:</strong> Todos los visores bloquean arrastre de imagen (<code>drag-disabled</code>) y menú contextual para resguardo de propiedad intelectual.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Resumen de Estado */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] p-4 font-mono text-xs text-[#8A93A6] space-y-2">
                        <div className="flex justify-between items-center">
                            <span>Destino de Persistencia:</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">Firestore: settings/ui_assets</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Almacenamiento:</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">Cloud Storage: /ui_assets/*</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>Modificaciones pendientes:</span>
                            <span className={pendingCount > 0 ? 'text-[#C68346] font-bold' : 'text-[#8A93A6]'}>
                                {pendingCount} activo(s)
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
