import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanonicalGeoFix } from '../../../contracts/geo.contracts';
import { CopyButton } from '../../../components/common/CopyButton';
import { SecureImage } from '../../../components/common/SecureImage';
import { UNDECLARED_TECH_VALUE } from '../../../components/common/ReportBlockEditable';
import { SovereignGeoMapLazy } from '../../../components/geo/SovereignGeoMapLazy';
import { dataService } from '../core/services/DataService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import type { StockpileAsset } from '../core/types/GeolappTypes';

export interface StockpileStaticMapCardProps {
    asset?: StockpileAsset | null;
    fix: CanonicalGeoFix | null;
    heightPx?: number;
    label?: string;
    className?: string;
    flat?: boolean;
}

const formatKilobytes = (bytes?: number): string | null => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
};

/**
 * Vista satelital estática sin interacción (`Pilar 5º` STOCKPILE CONTROL):
 * - Si existe `static_map_url` consolidado en CAS (`southamerica-west1`), muestra imagen estática protegida (`pointer-events-none`).
 * - Si está disponible en red y aún no se ha consolidado, solicita de forma asíncrona al endpoint soberano `/api/geolapp/stockpiles/:id/static-map`.
 * - En modo offline o cuando el secreto satelital aún no está configurado, degrada al mapa UTM vectorial no interactivo `SovereignGeoMapLazy`.
 * - Jamás inventa coordenadas `(0, 0)` ni incluye llamadas directas a APIs externas desde el cliente.
 */
export const StockpileStaticMapCard: React.FC<StockpileStaticMapCardProps> = ({
    asset,
    fix,
    heightPx = 220,
    label,
    className = '',
    flat = false,
}) => {
    const { t } = useTranslation();
    const [fetchedMapUrl, setFetchedMapUrl] = useState<string | null>(
        asset?.static_map_url || null
    );
    const [imageError, setImageError] = useState(false);

    useEffect(() => {
        setFetchedMapUrl(asset?.static_map_url || null);
        setImageError(false);
    }, [asset?.id, asset?.static_map_url]);

    useEffect(() => {
        let active = true;
        if (!asset?.id || asset.static_map_url || !fix) {
            return () => {
                active = false;
            };
        }
        dataService
            .ensureStaticSatelliteMap(asset.id, fix.lat, fix.lng)
            .then((url) => {
                if (active && url) {
                    setFetchedMapUrl(url);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [asset?.id, asset?.static_map_url, fix?.lat, fix?.lng]);

    const resolvedStaticMap = useResolvedStockpileImage(fetchedMapUrl);
    const mapCasOrig = formatKilobytes(asset?.static_map_original_bytes);
    const mapCasOpt = formatKilobytes(asset?.static_map_optimized_bytes);
    const mapCasSavings =
        typeof asset?.static_map_savings_pct === 'number' &&
        Number.isFinite(asset.static_map_savings_pct)
            ? asset.static_map_savings_pct.toFixed(1)
            : null;

    if (!fix) {
        return (
            <div
                style={{ height: `${heightPx}px` }}
                className={
                    flat
                        ? `w-full bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none py-fib-21 flex flex-col items-center justify-center gap-fib-8 text-center ${className}`
                        : `w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none p-fib-21 flex flex-col items-center justify-center gap-fib-8 text-center ${className}`
                }
            >
                <span className="material-symbols-outlined text-[28px] text-[#94A3B8] dark:text-[#5A6072]">
                    location_off
                </span>
                <span className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                    {t('analytics.static_map_title', 'MAPA SATELITAL ESTÁTICO')}
                </span>
                <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                    {UNDECLARED_TECH_VALUE}
                </span>
            </div>
        );
    }

    if (resolvedStaticMap && !imageError) {
        return (
            <div
                className={
                    flat
                        ? `w-full bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden flex flex-col ${className}`
                        : `w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden flex flex-col ${className}`
                }
            >
                <div
                    className={
                        flat
                            ? 'px-0 py-fib-8 bg-transparent border-0 flex items-center justify-between gap-fib-8'
                            : 'px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8'
                    }
                >
                    <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {t('analytics.static_map_title', 'MAPA SATELITAL ESTÁTICO')}
                    </span>
                    <span className="text-microcopy font-mono uppercase text-[#00AEEF] shrink-0">
                        {t('analytics.static_map_no_interaction', 'SIN INTERACCIÓN')}
                    </span>
                </div>
                <div
                    style={{ height: `${heightPx}px` }}
                    className="relative w-full bg-[#000000] overflow-hidden select-none pointer-events-none"
                >
                    <SecureImage
                        src={resolvedStaticMap}
                        alt={label || asset?.name || fix.utm.formatted}
                        onError={() => setImageError(true)}
                        className="w-full h-full object-cover"
                    />
                </div>
                <div
                    className={
                        flat
                            ? 'px-0 py-fib-8 bg-transparent border-0 flex flex-wrap items-center justify-between gap-fib-8 font-mono tabular-nums text-data-dense'
                            : 'px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-8 font-mono tabular-nums text-data-dense'
                    }
                >
                    <div className="flex items-center gap-fib-8 min-w-0">
                        <span className="text-[#0F172A] dark:text-[#F3F4F6] truncate select-text">
                            {fix.utm.formatted}
                        </span>
                        <CopyButton value={fix.utm.formatted} />
                    </div>
                    <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                        {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
                        {mapCasOrig && mapCasOpt
                            ? ` · CAS ${mapCasOpt}${mapCasSavings ? ` (-${mapCasSavings}%)` : ''}`
                            : ''}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div
            className={
                flat
                    ? `w-full bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden flex flex-col ${className}`
                    : `w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden flex flex-col ${className}`
            }
        >
            <div
                className={
                    flat
                        ? 'px-0 py-fib-8 bg-transparent border-0 flex items-center justify-between gap-fib-8'
                        : 'px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8'
                }
            >
                <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] truncate">
                    {t('analytics.static_map_title', 'MAPA SATELITAL ESTÁTICO')}
                </span>
                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                    UTM WGS84 · {t('analytics.static_map_no_interaction', 'SIN INTERACCIÓN')}
                </span>
            </div>
            <SovereignGeoMapLazy
                fix={fix}
                interactive={false}
                label={label || asset?.name}
                heightPx={heightPx}
            />
        </div>
    );
};

export default StockpileStaticMapCard;
