import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanonicalGeoFix } from '../../../contracts/geo.contracts';
import { CopyButton } from '../../../components/common/CopyButton';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { SecureImage } from '../../../components/common/SecureImage';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { dataService } from '../core/services/DataService';
import { useResolvedStockpileImageState } from '../core/services/StorageService';
import type { StockpileAsset } from '../core/types/GeolappTypes';

export interface StockpileStaticMapCardProps {
    asset?: StockpileAsset | null;
    fix: CanonicalGeoFix | null;
    heightPx?: number;
    label?: string;
    className?: string;
    flat?: boolean;
}

function formatByteSize(bytes?: number): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

export const StockpileStaticMapCard: React.FC<StockpileStaticMapCardProps> = ({
    asset,
    fix,
    heightPx = 220,
    label,
    className = '',
    flat = false,
}) => {
    const { t } = useTranslation();
    const { isOnline } = useNetworkStatus();

    const [fetchedMapUrl, setFetchedMapUrl] = useState<string | null>(
        asset?.static_map_url && !asset.static_map_url.startsWith('data:')
            ? asset.static_map_url
            : null
    );
    const [requesting, setRequesting] = useState<boolean>(false);

    useEffect(() => {
        const assetUrl =
            asset?.static_map_url && !asset.static_map_url.startsWith('data:')
                ? asset.static_map_url
                : null;
        setFetchedMapUrl(assetUrl);

        if (!asset?.id || !fix || assetUrl || !isOnline) {
            return;
        }

        let cancelled = false;
        setRequesting(true);
        void dataService
            .ensureStaticSatelliteMap(asset.id, fix.lat, fix.lng)
            .then((url) => {
                if (!cancelled && url && !url.startsWith('data:')) {
                    setFetchedMapUrl(url);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setRequesting(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [asset?.id, asset?.static_map_url, fix?.lat, fix?.lng, isOnline]);

    const handleForceRefresh = () => {
        if (!asset?.id || !fix || !isOnline || requesting) return;
        setRequesting(true);
        void dataService
            .ensureStaticSatelliteMap(asset.id, fix.lat, fix.lng, { forceRefresh: true })
            .then((url) => {
                if (url && !url.startsWith('data:')) {
                    setFetchedMapUrl(url);
                }
            })
            .finally(() => {
                setRequesting(false);
            });
    };

    const { resolvedUrl, isLoading } = useResolvedStockpileImageState(fetchedMapUrl);
    const busy = (requesting || isLoading) && !resolvedUrl;
    const wgsFormatted = fix ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}` : null;

    const containerChrome = flat
        ? 'bg-[#FFFFFF] dark:bg-[#000000] border-0'
        : 'bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C]';

    const hasCasBytes =
        typeof asset?.static_map_original_bytes === 'number' &&
        typeof asset?.static_map_optimized_bytes === 'number';

    return (
        <div
            className={`w-full overflow-hidden rounded-none shadow-none select-none flex flex-col justify-between ${containerChrome} ${className}`}
        >
            <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[18px] text-[#00AEEF]"
                    >
                        satellite_alt
                    </span>
                    <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] truncate">
                        {label || t('analytics.static_satellite_label', 'REFERENCIA SATELITAL CAS')}
                    </span>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    {hasCasBytes && (
                        <span className="text-microcopy font-mono tabular-nums text-[#00AEEF]">
                            {formatByteSize(asset?.static_map_original_bytes)} ➔{' '}
                            {formatByteSize(asset?.static_map_optimized_bytes)}
                            {typeof asset?.static_map_savings_pct === 'number'
                                ? ` (-${asset.static_map_savings_pct.toFixed(0)}%)`
                                : ''}
                        </span>
                    )}
                    {fix && asset?.id && isOnline && (
                        <button
                            type="button"
                            onClick={handleForceRefresh}
                            disabled={requesting}
                            title={t('analytics.refresh_static_map', 'Actualizar imagen satelital')}
                            aria-label={t(
                                'analytics.refresh_static_map',
                                'Actualizar imagen satelital'
                            )}
                            className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 transition-colors cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">refresh</span>
                        </button>
                    )}
                </div>
            </div>

            {busy && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('analytics.loading_static_map', 'Cargando imagen satelital')}
                />
            )}

            <div
                style={{ height: `${heightPx}px` }}
                className="relative w-full bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-center overflow-hidden rounded-none"
            >
                {resolvedUrl ? (
                    <SecureImage
                        src={resolvedUrl}
                        alt={
                            label ||
                            asset?.name ||
                            t('analytics.static_satellite_alt', 'Referencia satelital estática CAS')
                        }
                        className="w-full h-full object-cover select-none pointer-events-none rounded-none"
                    />
                ) : (
                    <div className="px-fib-21 text-center space-y-fib-8">
                        <span
                            aria-hidden="true"
                            className="material-symbols-outlined text-[32px] text-[#5A6072] dark:text-[#94A3B8] block"
                        >
                            satellite_alt
                        </span>
                        <div className="font-mono text-data-dense text-[#5A6072] dark:text-[#94A3B8]">
                            {fix
                                ? t(
                                      'analytics.static_map_pending',
                                      '[Imagen satelital pendiente]'
                                  )
                                : t(
                                      'analytics.static_map_no_coords',
                                      '[Sin coordenadas WGS84 declaradas]'
                                  )}
                        </div>
                    </div>
                )}
            </div>

            {fix && (
                <div className="px-fib-13 py-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-1 sm:grid-cols-2 gap-fib-8 font-mono tabular-nums text-microcopy">
                    <div className="flex items-center justify-between gap-fib-8 min-w-0">
                        <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                            UTM: <strong className="text-[#0F172A] dark:text-[#F3F4F6] select-text">{fix.utm.formatted}</strong>
                        </span>
                        <CopyButton value={fix.utm.formatted} title={t('core_geo.copy_utm', 'Copiar UTM')} />
                    </div>
                    {wgsFormatted && (
                        <div className="flex items-center justify-between gap-fib-8 min-w-0">
                            <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                WGS84:{' '}
                                <strong className="text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                    {wgsFormatted}
                                </strong>
                            </span>
                            <CopyButton
                                value={wgsFormatted}
                                title={t('core_geo.copy_wgs84', 'Copiar WGS84')}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StockpileStaticMapCard;
