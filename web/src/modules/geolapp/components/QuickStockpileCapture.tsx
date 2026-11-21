import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import {
    clearCaptureDraft,
    loadCaptureDraft,
    saveCaptureDraft,
} from '../../../core/offline/OfflineSessionVault';
import type {
    GeolappGeometryType,
    GeolappGnssStatus,
    MiningSiteProfile,
    StockpileAsset,
} from '../core/types/GeolappTypes';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';
import { ManualCapture } from './ManualCapture';
import { MobileScanner } from './MobileScanner';

export interface QuickStockpileCaptureProps {
    existingAsset?: StockpileAsset | null;
    initialMethod?: 'manual' | 'digital';
    initialGeometry?: GeolappGeometryType;
    allowManualFallback?: boolean;
    sites?: MiningSiteProfile[];
    selectedFaenaId?: string | null;
    onComplete: (result: {
        assetId: string;
        measurementId: string;
        isNewAsset: boolean;
    }) => void;
    onCancel: () => void;
    hideCancelButton?: boolean;
}

export const QuickStockpileCapture: React.FC<QuickStockpileCaptureProps> = ({
    existingAsset,
    initialMethod = 'digital',
    initialGeometry,
    allowManualFallback = false,
    sites = [],
    selectedFaenaId = null,
    onComplete,
    onCancel,
    hideCancelButton = false,
}) => {
    const { t } = useTranslation();
    const isNewAsset = !existingAsset;
    const draftKey = existingAsset?.id ? `asset_${existingAsset.id}` : 'new_stockpile';

    const [defaultCode] = useState(() => `AC-${String(Date.now()).slice(-4)}`);
    const [stockpileName, setStockpileName] = useState<string>(() => {
        if (existingAsset?.name) return existingAsset.name;
        const saved = loadCaptureDraft<{ stockpileName?: string }>('new_stockpile');
        return saved?.stockpileName || defaultCode;
    });
    const [isEditingName, setIsEditingName] = useState<boolean>(false);

    const resolvedSite = useMemo<MiningSiteProfile | null>(() => {
        if (existingAsset?.project_id) {
            const match = sites.find((s) => s.id === existingAsset.project_id);
            if (match) return match;
            return {
                id: existingAsset.project_id,
                tenantId: existingAsset.tenantId || '',
                accountId: existingAsset.accountId || '',
                name: existingAsset.project_name || existingAsset.project_id,
                status: 'ACTIVE',
                source: 'MINREPORT_PROJECTS_MODULE',
                createdAt: existingAsset.createdAt,
                createdBy: existingAsset.createdBy,
            };
        }
        if (selectedFaenaId) {
            const byId = sites.find((s) => s.id === selectedFaenaId);
            if (byId) return byId;
        }
        return null;
    }, [existingAsset, selectedFaenaId, sites]);

    const [method, setMethod] = useState<'manual' | 'digital'>(() =>
        allowManualFallback ? initialMethod : 'digital'
    );

    useEffect(() => {
        if (!allowManualFallback) {
            setMethod('digital');
        }
    }, [allowManualFallback]);

    const [geoPoint, setGeoPoint] = useState<StockpileAsset['geo_point'] | undefined>(
        existingAsset?.geo_point
    );
    const [gnssStatus, setGnssStatus] = useState<GeolappGnssStatus>(
        existingAsset?.geo_point ? 'FIX_OK' : 'UNDERGROUND_NO_FIX'
    );
    const [isLocating, setIsLocating] = useState<boolean>(false);

    useEffect(() => {
        if (!isNewAsset) return;
        saveCaptureDraft(draftKey, {
            stockpileName,
        });
    }, [draftKey, isNewAsset, stockpileName]);

    const captureGnssFix = useCallback(async () => {
        if (isLocating) return;
        setIsLocating(true);
        try {
            if (Capacitor.isNativePlatform()) {
                const pos = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 6000,
                    maximumAge: 15000,
                });
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                    setGeoPoint({
                        latitude: lat,
                        longitude: lng,
                        altitude: pos.coords.altitude ?? null,
                        accuracy: pos.coords.accuracy ?? undefined,
                    });
                    setGnssStatus('FIX_OK');
                    return;
                }
            } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
                const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 5500,
                        maximumAge: 15000,
                    });
                });
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                    setGeoPoint({
                        latitude: lat,
                        longitude: lng,
                        altitude: pos.coords.altitude ?? null,
                        accuracy: pos.coords.accuracy ?? undefined,
                    });
                    setGnssStatus('FIX_OK');
                    return;
                }
            }
            setGnssStatus('UNDERGROUND_NO_FIX');
        } catch {
            setGnssStatus('UNDERGROUND_NO_FIX');
        } finally {
            setIsLocating(false);
        }
    }, [isLocating]);

    useEffect(() => {
        if (!existingAsset) {
            void captureGnssFix();
        }
    }, []);

    const handleChildSuccess = useCallback(
        (measurementId: string, createdAssetId?: string) => {
            clearCaptureDraft(draftKey);
            const finalAssetId = existingAsset?.id || createdAssetId || '';
            onComplete({
                assetId: finalAssetId,
                measurementId,
                isNewAsset: Boolean(!existingAsset),
            });
        },
        [draftKey, existingAsset, onComplete]
    );

    const draftAssetPayload = useMemo(
        () =>
            isNewAsset && resolvedSite
                ? {
                      name: stockpileName.trim() || defaultCode,
                      projectId: resolvedSite.id,
                      projectName: resolvedSite.name,
                      geoPoint,
                      gnssStatus,
                  }
                : undefined,
        [defaultCode, geoPoint, gnssStatus, isNewAsset, resolvedSite, stockpileName]
    );

    if (isNewAsset && !resolvedSite) {
        return (
            <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
                <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center gap-fib-8">
                    {!hideCancelButton && (
                        <button
                            type="button"
                            onClick={onCancel}
                            aria-label={t('common.back_button', 'VOLVER')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 text-[#0F172A] dark:text-[#F3F4F6] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[24px]">
                                arrow_back
                            </span>
                        </button>
                    )}
                    <span className="text-h2-section font-mono font-bold uppercase truncate">
                        {t('faenas.site_label', 'FAENA')}
                    </span>
                </header>

                <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-fib-21 py-fib-55 text-center gap-fib-8 text-[#94A3B8] dark:text-[#5A6072]">
                    <span className="material-symbols-outlined text-[36px]">domain</span>
                    <span className="text-h2-section font-mono font-bold tabular-nums">0</span>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            <header className="shrink-0 bg-[#FFFFFF] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 flex items-center justify-between gap-fib-8">
                    {!hideCancelButton && (
                        <button
                            type="button"
                            onClick={onCancel}
                            aria-label={t('common.back_button', 'VOLVER')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[24px]">
                                arrow_back
                            </span>
                        </button>
                    )}

                    {isNewAsset ? (
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                            {isEditingName ? (
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    autoFocus
                                    value={stockpileName}
                                    onChange={(e) => setStockpileName(e.target.value)}
                                    onBlur={() => setIsEditingName(false)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === 'Escape') {
                                            setIsEditingName(false);
                                        }
                                    }}
                                    aria-label={t('registration.name_label', 'ID / NOMBRE DEL ACOPIO')}
                                    className="flex-1 min-w-0 h-10 px-fib-8 bg-transparent border-0 border-b border-[#C68346] outline-none font-mono font-bold text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        setIsEditingName(true);
                                    }}
                                    aria-label={t('digital_v2.edit_code', 'Editar código')}
                                    className="flex-1 min-w-0 min-h-[48px] bg-transparent border-0 text-left flex items-center gap-fib-8 cursor-pointer rounded-none px-0"
                                >
                                    <span className="text-h2-section font-mono font-bold uppercase truncate text-[#0F172A] dark:text-[#F3F4F6]">
                                        {stockpileName}
                                    </span>
                                    <span className="material-symbols-outlined text-[16px] text-[#475569] dark:text-[#8A93A6] shrink-0">
                                        edit
                                    </span>
                                </button>
                            )}
                        </div>
                    ) : (
                        <span className="flex-1 min-w-0 text-h2-section font-mono font-bold uppercase truncate text-[#0F172A] dark:text-[#F3F4F6]">
                            {existingAsset?.name}
                        </span>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            void captureGnssFix();
                        }}
                        aria-label={t('capture_v2.gnss_refresh', 'Actualizar georreferencia GNSS')}
                        title={t('capture_v2.gnss_refresh', 'Actualizar georreferencia GNSS')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 flex items-center justify-center cursor-pointer rounded-none shrink-0"
                    >
                        <span
                            aria-hidden="true"
                            className={`w-2 h-2 block rounded-none ${
                                gnssStatus === 'FIX_OK' ? 'bg-[#00AEEF]' : 'bg-[#C68346]'
                            }`}
                        />
                    </button>
                </div>

                {allowManualFallback && (
                    <div className="grid grid-cols-2 border-t border-[#E2E8F0] dark:border-[#12151C] bg-transparent rounded-none">
                        <button
                            type="button"
                            onClick={() => setMethod('digital')}
                            className={`min-h-[44px] font-mono text-microcopy font-bold uppercase border-0 border-b-2 cursor-pointer flex items-center justify-center gap-fib-8 rounded-none bg-transparent ${
                                method === 'digital'
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                photo_camera
                            </span>
                            <span>{t('digital_v2.mode_digital', 'DIGITAL IA')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setMethod('manual')}
                            className={`min-h-[44px] font-mono text-microcopy font-bold uppercase border-0 border-b-2 cursor-pointer flex items-center justify-center gap-fib-8 rounded-none bg-transparent ${
                                method === 'manual'
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">straighten</span>
                            <span>{t('capture.manual_title', 'COTAS ESCRITORIO')}</span>
                        </button>
                    </div>
                )}
            </header>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {allowManualFallback && method === 'manual' ? (
                    <ManualCapture
                        assetId={existingAsset?.id}
                        draftAsset={draftAssetPayload}
                        initialGeometry={initialGeometry}
                        onSuccess={handleChildSuccess}
                        onBack={onCancel}
                        hideHeader
                    />
                ) : (
                    <MobileScanner
                        assetId={existingAsset?.id}
                        draftAsset={draftAssetPayload}
                        onSuccess={handleChildSuccess}
                        onBack={onCancel}
                        hideHeader
                    />
                )}
            </div>
        </div>
    );
};
