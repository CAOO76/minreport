import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { SecureImage } from '../../../components/common/SecureImage';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { UNASSIGNED_FAENA_ID } from '../core/services/stockpile-faena-metrics';
import type { StockpileAsset } from '../core/types/GeolappTypes';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';

interface MobileHomeProps {
    faenaId: string;
    faenaName: string;
    isUnassignedBucket?: boolean;
    assets: StockpileAsset[];
    isLoading: boolean;
    onBackToFaenas: () => void;
    onStartNewStockpile: () => void;
    onSelectAsset: (asset: StockpileAsset) => void;
    connectivitySlot?: React.ReactNode;
}

type CycleFilter = 'ACTIVE' | 'CLOSED';

const MobileHomeAssetRow: React.FC<{
    asset: StockpileAsset;
    onSelect: (asset: StockpileAsset) => void;
}> = ({ asset, onSelect }) => {
    const { t } = useTranslation();
    const coverRaw = asset.last_photo_url || asset.initial_photo_url || asset.thumbnail_url;
    const resolvedCover = useResolvedStockpileImage(coverRaw);

    const volume = asset.last_volume_m3 ?? asset.volumen ?? 0;
    const tonnage = asset.last_weight_t ?? asset.peso_final_toneladas ?? 0;
    const isClosed = asset.status === 'CLOSED';
    const isPendingAi = asset.analysis_status === 'PENDING_AI_SYNC';
    const isPendingScale = asset.analysis_status === 'PENDING_SCALE';
    const slopeDeg = asset.detected_slope_angle_deg;
    const isSlopeException =
        (typeof slopeDeg === 'number' && Number.isFinite(slopeDeg) && slopeDeg > 38) ||
        Boolean(asset.slope_warning);
    const isException = isPendingAi || isPendingScale || isSlopeException;
    const isAiVerifiedActive =
        !isClosed && asset.analysis_status === 'AI_VERIFIED' && !isSlopeException;

    const statusBarClass = isException
        ? 'bg-[#C68346]'
        : isAiVerifiedActive
          ? 'bg-[#00AEEF]'
          : 'bg-transparent';

    const domainLabel = asset.copper_domain
        ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
        : asset.underground_sector || asset.clase;

    return (
        <button
            type="button"
            onClick={() => {
                void triggerFieldImpact('LIGHT');
                onSelect(asset);
            }}
            className="w-full text-left pr-fib-13 bg-transparent hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] active:bg-[#F8FAFC] dark:active:bg-[#07090D] border-0 transition-colors flex items-stretch gap-fib-13 cursor-pointer rounded-none shadow-none"
        >
            <span aria-hidden="true" className={`w-[3px] shrink-0 ${statusBarClass}`} />

            <div className="py-fib-13 flex-1 min-w-0 flex items-center gap-fib-13">
                <div className="w-12 h-12 shrink-0 bg-transparent flex items-center justify-center overflow-hidden rounded-none">
                    {resolvedCover ? (
                        <SecureImage
                            src={resolvedCover}
                            alt={asset.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <span className="material-symbols-outlined text-[24px] text-[#475569] dark:text-[#8A93A6]">
                            landscape
                        </span>
                    )}
                </div>

                <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-fib-8">
                        <span className="text-body-main font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {asset.name}
                        </span>
                        <div className="flex items-center gap-fib-8 shrink-0 font-mono text-microcopy font-bold uppercase tabular-nums">
                            {isPendingAi && <span className="text-[#C68346]">COLA</span>}
                            {!isPendingAi && isPendingScale && (
                                <span className="text-[#C68346]">ESC</span>
                            )}
                            {isSlopeException && (
                                <span className="text-[#C68346]">α &gt;38°</span>
                            )}
                            {isClosed && (
                                <span className="material-symbols-outlined text-[16px] text-[#475569] dark:text-[#8A93A6]">
                                    lock
                                </span>
                            )}
                        </div>
                    </div>

                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                        {domainLabel}
                    </span>

                    <div className="flex items-baseline flex-wrap gap-x-fib-13 gap-y-0.5 font-mono tabular-nums">
                        <span className="text-data-dense font-bold text-[#C68346]">
                            {volume > 0
                                ? `${volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`
                                : isPendingAi || isPendingScale
                                  ? '-- m³'
                                  : '0 m³'}
                        </span>
                        {tonnage > 0 && (
                            <span className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {tonnage.toLocaleString(undefined, { maximumFractionDigits: 1 })} t
                            </span>
                        )}
                        {typeof slopeDeg === 'number' && Number.isFinite(slopeDeg) && (
                            <span
                                className={`text-microcopy font-bold ${
                                    isSlopeException ? 'text-[#C68346]' : 'text-[#00AEEF]'
                                }`}
                            >
                                α {slopeDeg.toFixed(1)}°
                            </span>
                        )}
                    </div>
                </div>

                <span className="material-symbols-outlined text-[20px] text-[#475569] dark:text-[#8A93A6] shrink-0">
                    chevron_right
                </span>
            </div>
        </button>
    );
};

export const MobileHome: React.FC<MobileHomeProps> = ({
    faenaId,
    faenaName,
    isUnassignedBucket = false,
    assets,
    isLoading,
    onBackToFaenas,
    onStartNewStockpile,
    onSelectAsset,
    connectivitySlot,
}) => {
    const { t } = useTranslation();
    const [cycleFilter, setCycleFilter] = useState<CycleFilter>('ACTIVE');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    useEffect(() => {
        if (isUnassignedBucket) return;
        const handler = () => onStartNewStockpile();
        window.addEventListener('geolapp:quick-capture', handler);
        return () => window.removeEventListener('geolapp:quick-capture', handler);
    }, [isUnassignedBucket, onStartNewStockpile]);

    const faenaAssets = useMemo(
        () =>
            assets.filter((asset) => {
                const assetSiteId = (asset.project_id || '').trim();
                return faenaId === UNASSIGNED_FAENA_ID
                    ? assetSiteId === ''
                    : assetSiteId === faenaId;
            }),
        [assets, faenaId]
    );

    const cycleCounts = useMemo(() => {
        let active = 0;
        let closed = 0;
        for (const a of faenaAssets) {
            if (a.status === 'CLOSED') closed += 1;
            else active += 1;
        }
        return { active, closed };
    }, [faenaAssets]);

    const filteredAssets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return [...faenaAssets]
            .filter((asset) => {
                if (cycleFilter === 'ACTIVE' && asset.status === 'CLOSED') return false;
                if (cycleFilter === 'CLOSED' && asset.status !== 'CLOSED') return false;
                if (!q) return true;
                return (
                    asset.name.toLowerCase().includes(q) ||
                    (asset.copper_domain || '').toLowerCase().includes(q) ||
                    (asset.underground_sector || '').toLowerCase().includes(q) ||
                    (asset.location_ref || '').toLowerCase().includes(q)
                );
            })
            .sort(
                (a, b) =>
                    (b.last_measured_at || b.createdAt) - (a.last_measured_at || a.createdAt)
            );
    }, [faenaAssets, cycleFilter, searchQuery]);

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            onBackToFaenas();
                        }}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                    >
                        <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                    </button>
                    <h1 className="text-h2-section font-mono font-bold uppercase truncate text-[#0F172A] dark:text-[#F3F4F6]">
                        {faenaName}
                    </h1>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            setShowSearch((prev) => {
                                const next = !prev;
                                if (!next) setSearchQuery('');
                                return next;
                            });
                        }}
                        aria-label={t('home.search_placeholder', 'BUSCAR ACOPIO')}
                        className={`min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none shrink-0 transition-colors ${
                            showSearch
                                ? 'text-[#00AEEF]'
                                : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[22px]">
                            {showSearch ? 'close' : 'search'}
                        </span>
                    </button>

                    {!isUnassignedBucket && (
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('MEDIUM');
                                onStartNewStockpile();
                            }}
                            aria-label={t('faenas.add_stockpile_aria', 'Nuevo acopio en esta faena')}
                            title={t('faenas.add_stockpile_aria', 'Nuevo acopio en esta faena')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#C68346] hover:opacity-75 flex items-center justify-center cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[26px]">add</span>
                        </button>
                    )}

                    {connectivitySlot}
                </div>
            </header>

            <div className="shrink-0 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="h-10 grid grid-cols-2 px-fib-13">
                    {(['ACTIVE', 'CLOSED'] as const).map((tab) => {
                        const active = cycleFilter === tab;
                        const label =
                            tab === 'ACTIVE'
                                ? `${t('home.filter_active', 'ACTIVOS')} (${cycleCounts.active})`
                                : `${t('home.filter_closed', 'CERRADOS')} (${cycleCounts.closed})`;
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => {
                                    void triggerFieldImpact('LIGHT');
                                    setCycleFilter(tab);
                                }}
                                className={`h-10 px-fib-8 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase tabular-nums cursor-pointer rounded-none transition-colors ${
                                    active
                                        ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                }`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                {showSearch && (
                    <div className="px-fib-13 py-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('home.search_placeholder', 'BUSCAR POR CÓDIGO O SECTOR')}
                            aria-label={t('home.search_placeholder', 'BUSCAR POR CÓDIGO O SECTOR')}
                            className="w-full h-11 px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none font-mono text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#475569] dark:placeholder-[#8A93A6] rounded-none"
                        />
                    </div>
                )}
            </div>

            <section className="flex-1 min-h-0 overflow-y-auto">
                {isLoading && (
                    <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'Cargando')} />
                )}

                {!isLoading && filteredAssets.length === 0 && (
                    <div className="py-fib-89 px-fib-21 flex flex-col items-center justify-center gap-fib-8 text-[#94A3B8] dark:text-[#5A6072]">
                        <span className="material-symbols-outlined text-[36px]">landscape</span>
                        <span className="text-h2-section font-mono font-bold tabular-nums">0</span>
                    </div>
                )}

                {filteredAssets.length > 0 && (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {filteredAssets.map((asset) => (
                            <MobileHomeAssetRow
                                key={asset.id}
                                asset={asset}
                                onSelect={onSelectAsset}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};
