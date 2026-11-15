import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SecureImage } from '../common/SecureImage';
import M3LinearProgress from '../common/M3LinearProgress';
import M3CircularProgress from '../common/M3CircularProgress';
import HitlConfirmModal from '../common/HitlConfirmModal';
import { fixBrandingUrl } from '../../context/BrandingContext';
import { mediaDigestorClient } from '../../core/media/MediaDigestorClient';
import { coreAuthFetch } from '../../core/network/coreAuthFetch';

export interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
    imagotypeVertical: string;
    pwaIcon: string;
    appIcon: string;
}

export interface BrandingAssetTelemetry {
    sha256: string;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    profile: 'IMAGE_ISO_SYMBOL' | 'VECTOR_SVG_CLEAN';
}

export interface BrandingSettings {
    light: LogoSet;
    dark: LogoSet;
    siteName: string;
    primaryColor: string;
    invertDarkMap?: { [key: string]: boolean };
    assetTelemetry?: Partial<Record<keyof LogoSet, BrandingAssetTelemetry>>;
}

const IMMUTABLE_PRIMARY_COLOR = '#C68346';

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
    primaryColor: IMMUTABLE_PRIMARY_COLOR,
};

interface AssetConfig {
    key: keyof LogoSet;
    defaultPath: string;
}

const BRAND_ASSET_CONFIGS: AssetConfig[] = [
    { key: 'isotype', defaultPath: '/branding/master_isotype.svg' },
    { key: 'logotype', defaultPath: '/branding/master_logotype.svg' },
    { key: 'imagotype', defaultPath: '/branding/master_imagotype.svg' },
    { key: 'imagotypeVertical', defaultPath: '/branding/master_imagotype_vertical.svg' },
    { key: 'pwaIcon', defaultPath: '/branding/master_pwaIcon.svg' },
    { key: 'appIcon', defaultPath: '/branding/master_appIcon.svg' },
];

const formatKb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

interface BrandingManagerProps {
    className?: string;
}

export const BrandingManager: React.FC<BrandingManagerProps> = ({ className = '' }) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<BrandingSettings>(DEFAULT_SETTINGS);
    const [files, setFiles] = useState<{ [key: string]: File | null }>({});
    const [previewUrls, setPreviewUrls] = useState<{ [key: string]: string }>({});
    const [siteNameInput, setSiteNameInput] = useState('MINREPORT');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [savingProgressText, setSavingProgressText] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    const [invertDarkMap, setInvertDarkMap] = useState<{ [key: string]: boolean }>({
        isotype: true,
        logotype: true,
        imagotype: true,
        imagotypeVertical: true,
        pwaIcon: true,
        appIcon: true,
    });
    const [assetTelemetry, setAssetTelemetry] = useState<
        Partial<Record<keyof LogoSet, BrandingAssetTelemetry>>
    >({});
    const [dirtyMetadataCount, setDirtyMetadataCount] = useState<number>(0);

    const previewUrlsRef = useRef<{ [key: string]: string }>({});

    const loadBrandingSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await coreAuthFetch('/api/dev/settings/branding');
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as Partial<BrandingSettings>;
            const merged: BrandingSettings = {
                light: { ...DEFAULT_SETTINGS.light, ...(data.light || {}) },
                dark: { ...DEFAULT_SETTINGS.dark, ...(data.dark || {}) },
                siteName: data.siteName || 'MINREPORT',
                primaryColor: IMMUTABLE_PRIMARY_COLOR,
                invertDarkMap: data.invertDarkMap || {
                    isotype: true,
                    logotype: true,
                    imagotype: true,
                    imagotypeVertical: true,
                    pwaIcon: true,
                    appIcon: true,
                },
                assetTelemetry: data.assetTelemetry || {},
            };
            setSettings(merged);
            setSiteNameInput(merged.siteName);
            if (merged.invertDarkMap) {
                setInvertDarkMap(merged.invertDarkMap);
            }
            setAssetTelemetry(merged.assetTelemetry || {});
        } catch (err) {
            console.error('[BrandingManager] Error consultando configuración:', err);
            setSettings(DEFAULT_SETTINGS);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadBrandingSettings();
        return () => {
            Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
        };
    }, [loadBrandingSettings]);

    const toggleInvert = (key: string) => {
        setInvertDarkMap((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
        setDirtyMetadataCount((c) => c + 1);
    };

    const handleFileChange = (key: keyof LogoSet, file: File | null) => {
        if (!file) {
            if (previewUrls[key]) {
                URL.revokeObjectURL(previewUrls[key]);
            }
            setFiles((prev) => {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            });
            setPreviewUrls((prev) => {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            });
            return;
        }

        const lowerName = file.name.toLowerCase();
        const validTypes = ['image/svg+xml', 'image/png', 'image/webp'];
        if (
            !validTypes.includes(file.type) &&
            !lowerName.endsWith('.svg') &&
            !lowerName.endsWith('.png') &&
            !lowerName.endsWith('.webp')
        ) {
            setNotification({
                type: 'error',
                message: t('core_branding_mgr.errors.invalid_format'),
            });
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        if (previewUrls[key]) {
            URL.revokeObjectURL(previewUrls[key]);
        }
        previewUrlsRef.current[key] = objectUrl;

        setFiles((prev) => ({ ...prev, [key]: file }));
        setPreviewUrls((prev) => ({ ...prev, [key]: objectUrl }));
    };

    const handleResetAsset = (key: keyof LogoSet) => {
        if (previewUrls[key]) {
            URL.revokeObjectURL(previewUrls[key]);
        }
        setFiles((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        setPreviewUrls((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        setSettings((prev) => ({
            ...prev,
            light: { ...prev.light, [key]: DEFAULT_SETTINGS.light[key] },
            dark: { ...prev.dark, [key]: DEFAULT_SETTINGS.dark[key] },
        }));
        setAssetTelemetry((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        setDirtyMetadataCount((c) => c + 1);
    };

    const handleExecuteSave = async () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setShowConfirmModal(false);
            setNotification({
                type: 'error',
                message: t('core_branding_mgr.errors.offline'),
            });
            return;
        }

        setIsSaving(true);
        setNotification(null);
        setSavingProgressText(t('core_branding_mgr.progress.starting'));

        try {
            const updatedLight: LogoSet = { ...settings.light };
            const updatedDark: LogoSet = { ...settings.dark };
            const nextTelemetry: Partial<Record<keyof LogoSet, BrandingAssetTelemetry>> = {
                ...assetTelemetry,
            };

            const pendingEntries = (Object.entries(files) as Array<[keyof LogoSet, File | null]>).filter(
                ([, file]) => Boolean(file)
            );

            for (const [key, file] of pendingEntries) {
                if (!file) continue;
                setSavingProgressText(t('core_branding_mgr.progress.digesting', { asset: key.toUpperCase() }));
                const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
                const profile: 'VECTOR_SVG_CLEAN' | 'IMAGE_ISO_SYMBOL' = isSvg
                    ? 'VECTOR_SVG_CLEAN'
                    : 'IMAGE_ISO_SYMBOL';

                const { descriptor } = await mediaDigestorClient.digestAndUploadCas(file, {
                    profile,
                    scope: 'SYMBOLOGY_MASTER',
                    tenantId: 'dev-master-sandbox',
                });

                const url = String(descriptor.downloadUrl || '').trim();
                if (
                    !url ||
                    url.startsWith('blob:') ||
                    url.startsWith('data:') ||
                    url.includes(';base64,') ||
                    !(url.startsWith('/api/media/') || url.startsWith('https://'))
                ) {
                    throw new Error(t('core_branding_mgr.errors.invalid_cas_url', { asset: key }));
                }

                updatedLight[key] = url;
                updatedDark[key] = url;

                const savingsPct =
                    typeof descriptor.savingsPct === 'number'
                        ? descriptor.savingsPct
                        : Math.round((descriptor.savingsRatio || 0) * 1000) / 10;

                nextTelemetry[key] = {
                    sha256: descriptor.sha256,
                    originalBytes: descriptor.originalBytes,
                    optimizedBytes: descriptor.optimizedBytes,
                    savingsPct,
                    profile,
                };
            }

            setSavingProgressText(t('core_branding_mgr.progress.consolidating'));
            const cleanSiteName = siteNameInput.trim() || 'MINREPORT';

            const response = await coreAuthFetch('/api/dev/settings/branding', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    light: updatedLight,
                    dark: updatedDark,
                    siteName: cleanSiteName,
                    primaryColor: IMMUTABLE_PRIMARY_COLOR,
                    invertDarkMap: { ...invertDarkMap },
                    assetTelemetry: nextTelemetry,
                    confirmationKeyword: 'ACTUALIZAR',
                }),
            });

            if (!response.ok) {
                const errPayload = await response.json().catch(() => ({}));
                throw new Error(
                    errPayload?.error ||
                        errPayload?.message ||
                        t('core_branding_mgr.errors.http_save', { status: response.status })
                );
            }

            Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
            previewUrlsRef.current = {};
            setFiles({});
            setPreviewUrls({});
            setDirtyMetadataCount(0);
            setAssetTelemetry(nextTelemetry);
            setSettings({
                light: updatedLight,
                dark: updatedDark,
                siteName: cleanSiteName,
                primaryColor: IMMUTABLE_PRIMARY_COLOR,
                invertDarkMap: { ...invertDarkMap },
                assetTelemetry: nextTelemetry,
            });
            setShowConfirmModal(false);

            setNotification({
                type: 'success',
                message: t('core_branding_mgr.notifications.saved'),
            });
        } catch (error: any) {
            setShowConfirmModal(false);
            setNotification({
                type: 'error',
                message: error?.message || t('core_branding_mgr.errors.save_generic'),
            });
        } finally {
            setIsSaving(false);
            setSavingProgressText(null);
        }
    };

    const pendingCount =
        Object.keys(files).length +
        dirtyMetadataCount +
        (siteNameInput !== (settings.siteName || 'MINREPORT') ? 1 : 0);

    const registeredCount = BRAND_ASSET_CONFIGS.filter((a) => !!settings.light[a.key]).length;

    if (isLoading) {
        return (
            <div className="py-12 px-fib-21 flex flex-col items-center justify-center gap-fib-13 font-mono text-xs text-[#475569] dark:text-[#8A93A6]">
                <div className="w-full max-w-md space-y-fib-8">
                    <M3LinearProgress indeterminate ariaLabel={t('core_branding_mgr.loading.aria')} />
                    <span className="block text-center tabular-nums">
                        {t('core_branding_mgr.loading.text')}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className={`space-y-fib-21 font-sans select-none ${className}`}>
            {/* Cabecera Técnica de Sección */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <div className="flex items-center gap-fib-8 mb-1">
                        <span className="text-microcopy font-mono font-bold uppercase text-[#C68346] tracking-wider">
                            {t('core_branding_mgr.header.eyebrow')}
                        </span>
                    </div>
                    <h1 className="text-h1-header font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_branding_mgr.header.title')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        {t('core_branding_mgr.header.subtitle')}
                    </p>
                </div>

                <div className="flex items-center gap-fib-13 shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowConfirmModal(true)}
                        disabled={isSaving || pendingCount === 0}
                        className="px-fib-21 py-fib-8 text-microcopy font-mono font-bold uppercase tracking-wider bg-[#C68346] hover:opacity-90 text-[#FFFFFF] disabled:opacity-40 transition-colors flex items-center gap-fib-8 cursor-pointer disabled:cursor-not-allowed rounded-none outline-none shadow-none"
                    >
                        {isSaving ? (
                            <M3CircularProgress size={16} ariaLabel={t('core_branding_mgr.actions.syncing_aria')} />
                        ) : (
                            <span className="material-symbols-outlined text-[16px]">save</span>
                        )}
                        <span className="tabular-nums">
                            {isSaving
                                ? t('core_branding_mgr.actions.syncing')
                                : t('core_branding_mgr.actions.save_changes', { count: pendingCount })}
                        </span>
                    </button>
                </div>
            </div>

            {isSaving && savingProgressText && (
                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none space-y-fib-8">
                    <M3LinearProgress indeterminate ariaLabel={savingProgressText} />
                    <span className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                        {savingProgressText}
                    </span>
                </div>
            )}

            {notification && (
                <div
                    role={notification.type === 'error' ? 'alert' : 'status'}
                    className={`px-fib-21 py-fib-13 border text-data-dense font-mono flex items-center gap-fib-8 rounded-none shadow-none ${
                        notification.type === 'success'
                            ? 'bg-[#F8FAFC] dark:bg-[#07090D] border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6]'
                            : 'bg-red-500/10 border-red-500 text-red-600 dark:text-red-400'
                    }`}
                >
                    <span
                        className={`material-symbols-outlined text-[16px] ${
                            notification.type === 'success' ? 'text-[#00AEEF]' : 'text-red-600 dark:text-red-400'
                        }`}
                    >
                        {notification.type === 'success' ? 'check_circle' : 'error'}
                    </span>
                    <span>{notification.message}</span>
                </div>
            )}

            {/* Macro-Layout en Proporción Áurea (61.8% / 38.2%) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-fib-34 items-start">
                {/* ÁREA MAYOR (~61.8%): Visor y Gestor de Activos Gráficos */}
                <div className="lg:col-span-8 space-y-fib-21">
                    <div className="flex items-center justify-between pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <h2 className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                            {t('core_branding_mgr.section.registered_assets')} (
                            <span className="tabular-nums">
                                {registeredCount} / {BRAND_ASSET_CONFIGS.length}
                            </span>
                            )
                        </h2>
                        <span className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {t('core_branding_mgr.section.supported_formats')}
                        </span>
                    </div>

                    <div className="space-y-fib-21">
                        {BRAND_ASSET_CONFIGS.map((asset) => {
                            const assetLabel = t(`core_branding_mgr.assets.${asset.key}.label`);
                            const assetDescription = t(`core_branding_mgr.assets.${asset.key}.description`);
                            const assetSpec = t(`core_branding_mgr.assets.${asset.key}.spec`);
                            const assetRecommendedDim = t(`core_branding_mgr.assets.${asset.key}.recommendedDim`);
                            const fileInputId = `branding-file-${asset.key}`;

                            const currentFile = files[asset.key];
                            const localPreview = previewUrls[asset.key];
                            const rawUrl = settings.light[asset.key];
                            const resolvedUrl = fixBrandingUrl(rawUrl, asset.key);
                            const previewSrc = localPreview || resolvedUrl || asset.defaultPath;
                            const isDarkInverted = invertDarkMap[asset.key] ?? true;
                            const isCustom = Boolean(rawUrl && !rawUrl.startsWith('/branding/'));
                            const telemetry = assetTelemetry[asset.key];

                            return (
                                <div
                                    key={asset.key}
                                    className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-fib-8 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                        <div>
                                            <div className="flex items-center gap-fib-8 flex-wrap">
                                                <h3 className="text-body-main font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {assetLabel}
                                                </h3>
                                                {isCustom && (
                                                    <span className="px-fib-8 py-0.5 text-microcopy font-mono uppercase border border-[#C68346] text-[#C68346]">
                                                        {t('core_branding_mgr.badges.cas_active')}
                                                    </span>
                                                )}
                                                {currentFile && (
                                                    <span className="px-fib-8 py-0.5 text-microcopy font-mono uppercase border border-[#00AEEF] text-[#00AEEF]">
                                                        {t('core_branding_mgr.badges.cas_pending')}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-0.5">
                                                {assetDescription}
                                            </p>
                                        </div>
                                        <div className="text-left sm:text-right font-mono text-microcopy text-[#475569] dark:text-[#8A93A6] shrink-0 tabular-nums">
                                            <div>{assetRecommendedDim}</div>
                                            <div className="text-[#94A3B8] dark:text-[#5A6072]">{assetSpec}</div>
                                        </div>
                                    </div>

                                    {/* Visualización Dual Light / Dark */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] p-fib-13 flex flex-col items-center justify-between min-h-[120px] rounded-none shadow-none">
                                            <div className="w-full flex items-center justify-between text-microcopy font-mono text-[#475569] uppercase">
                                                <span>{t('core_branding_mgr.preview.light_bg')}</span>
                                                <span className="tabular-nums">#FFFFFF</span>
                                            </div>
                                            <div className="w-full flex-1 flex items-center justify-center py-fib-13">
                                                <SecureImage
                                                    src={previewSrc}
                                                    alt={t('core_branding_mgr.preview.light_alt', { label: assetLabel })}
                                                    className="max-h-14 max-w-[85%] object-contain"
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).src = asset.defaultPath;
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] p-fib-13 flex flex-col items-center justify-between min-h-[120px] rounded-none shadow-none">
                                            <div className="w-full flex items-center justify-between text-microcopy font-mono text-[#8A93A6] uppercase">
                                                <span>{t('core_branding_mgr.preview.dark_bg')}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleInvert(asset.key)}
                                                    className="bg-transparent border-0 outline-none p-1 text-[#8A93A6] hover:text-[#C68346] cursor-pointer transition-colors"
                                                    title={
                                                        isDarkInverted
                                                            ? t('core_branding_mgr.preview.invert_active_title')
                                                            : t('core_branding_mgr.preview.invert_inactive_title')
                                                    }
                                                    aria-label={t('core_branding_mgr.preview.invert_aria')}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">
                                                        {isDarkInverted ? 'contrast' : 'tonality'}
                                                    </span>
                                                </button>
                                            </div>
                                            <div className="w-full flex-1 flex items-center justify-center py-fib-13">
                                                <SecureImage
                                                    src={previewSrc}
                                                    alt={t('core_branding_mgr.preview.dark_alt', { label: assetLabel })}
                                                    className={`max-h-14 max-w-[85%] object-contain transition-all ${
                                                        isDarkInverted ? 'invert brightness-150 contrast-125' : ''
                                                    }`}
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).src = asset.defaultPath;
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Telemetría CAS y Selector de Archivo */}
                                    <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 font-mono text-data-dense">
                                        <div className="text-[#475569] dark:text-[#8A93A6] truncate tabular-nums">
                                            {currentFile ? (
                                                <span className="text-[#00AEEF] font-semibold">
                                                    {t('core_branding_mgr.telemetry.pending_digestion', {
                                                        file: currentFile.name,
                                                        size: formatKb(currentFile.size),
                                                    })}
                                                </span>
                                            ) : telemetry ? (
                                                <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t('core_branding_mgr.telemetry.cas_ratio', {
                                                        orig: formatKb(telemetry.originalBytes),
                                                        opt: formatKb(telemetry.optimizedBytes),
                                                        pct: telemetry.savingsPct.toFixed(1),
                                                    })}
                                                </span>
                                            ) : isCustom ? (
                                                <span className="text-[#475569] dark:text-[#8A93A6] select-text">
                                                    {rawUrl}
                                                </span>
                                            ) : (
                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_branding_mgr.telemetry.base_asset', {
                                                        path: asset.defaultPath,
                                                    })}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-fib-8 shrink-0">
                                            {isCustom && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleResetAsset(asset.key)}
                                                    className="px-fib-13 py-fib-8 text-microcopy font-mono uppercase border border-[#E2E8F0] dark:border-[#12151C] bg-transparent hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 text-[#475569] dark:text-[#8A93A6] transition-colors cursor-pointer rounded-none shadow-none"
                                                >
                                                    {t('core_branding_mgr.actions.reset')}
                                                </button>
                                            )}

                                            <label htmlFor={fileInputId} className="relative cursor-pointer">
                                                <input
                                                    id={fileInputId}
                                                    type="file"
                                                    accept=".svg,.png,.webp"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    aria-label={t('core_branding_mgr.actions.upload_aria', {
                                                        label: assetLabel,
                                                    })}
                                                    onChange={(e) =>
                                                        handleFileChange(asset.key, e.target.files?.[0] || null)
                                                    }
                                                    className="sr-only"
                                                />
                                                <span className="px-fib-13 py-fib-8 text-microcopy font-mono uppercase inline-block border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] transition-colors rounded-none shadow-none">
                                                    {currentFile
                                                        ? t('core_branding_mgr.actions.change_file')
                                                        : isCustom
                                                          ? t('core_branding_mgr.actions.replace_asset')
                                                          : t('core_branding_mgr.actions.upload_file')}
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
                <div className="lg:col-span-4 space-y-fib-21">
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                        <div className="pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <h3 className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                {t('core_branding_mgr.params.title')}
                            </h3>
                        </div>

                        <div className="space-y-fib-13">
                            <div>
                                <label
                                    htmlFor="branding-site-name"
                                    className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8"
                                >
                                    {t('core_branding_mgr.params.site_name')}
                                </label>
                                <input
                                    id="branding-site-name"
                                    type="text"
                                    value={siteNameInput}
                                    onChange={(e) => setSiteNameInput(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={t('core_branding_mgr.params.site_name_placeholder')}
                                    className="w-full px-fib-13 py-fib-8 text-data-dense font-mono border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors"
                                />
                            </div>

                            <div>
                                <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8">
                                    {t('core_branding_mgr.params.primary_color_label')}
                                </span>
                                <div className="flex items-center gap-fib-8 px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] rounded-none shadow-none">
                                    <span
                                        className="w-5 h-5 border border-[#E2E8F0] dark:border-[#12151C] shrink-0 rounded-none bg-[#C68346]"
                                        aria-hidden="true"
                                    />
                                    <span className="font-mono text-data-dense font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                        {IMMUTABLE_PRIMARY_COLOR}
                                    </span>
                                    <span className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] ml-auto">
                                        {t('core_branding_mgr.params.copper_name')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] p-fib-21 rounded-none shadow-none font-mono text-data-dense text-[#475569] dark:text-[#8A93A6] space-y-fib-8 tabular-nums">
                        <div className="flex justify-between items-center">
                            <span>{t('core_branding_mgr.meta.sovereign_endpoint')}</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">PUT /api/dev/settings/branding</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>{t('core_branding_mgr.meta.persistence_target')}</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">settings/branding</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>{t('core_branding_mgr.meta.media_storage')}</span>
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">CAS SYMBOLOGY_MASTER</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span>{t('core_branding_mgr.meta.pending_changes')}</span>
                            <span className={pendingCount > 0 ? 'text-[#C68346] font-bold' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                {t('core_branding_mgr.meta.changes_count', { count: pendingCount })}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <HitlConfirmModal
                open={showConfirmModal}
                title={t('core_branding_mgr.hitl.title')}
                description={t('core_branding_mgr.hitl.description')}
                keyword="ACTUALIZAR"
                confirmLabel={t('core_branding_mgr.hitl.confirm')}
                cancelLabel={t('core_branding_mgr.hitl.cancel')}
                loading={isSaving}
                onConfirm={handleExecuteSave}
                onCancel={() => setShowConfirmModal(false)}
            />
        </div>
    );
};

export default BrandingManager;
