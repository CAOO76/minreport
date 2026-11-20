import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import {
    computeAllFaenasBreakdown,
    UNASSIGNED_FAENA_ID,
} from '../core/services/stockpile-faena-metrics';
import type {
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';

export interface MobileFaenaListProps {
    sites: MiningSiteProfile[];
    assets: StockpileAsset[];
    measurements: StockpileMeasurement[];
    isLoading: boolean;
    onSelectFaena: (faenaId: string) => void;
    onBackToHome?: () => void;
    connectivitySlot?: React.ReactNode;
}

export const MobileFaenaList: React.FC<MobileFaenaListProps> = ({
    sites,
    assets,
    measurements,
    isLoading,
    onSelectFaena,
    onBackToHome,
    connectivitySlot,
}) => {
    const { t } = useTranslation();

    const rows = useMemo(() => {
        const all = computeAllFaenasBreakdown(assets, measurements, sites);
        const registered = all.filter((item) => item.faenaId !== UNASSIGNED_FAENA_ID);
        const unassigned = all.find(
            (item) => item.faenaId === UNASSIGNED_FAENA_ID && item.totalCount > 0
        );
        return unassigned ? [...registered, unassigned] : registered;
    }, [assets, measurements, sites]);

    const maxVolume = useMemo(
        () => rows.reduce((acc, item) => Math.max(acc, item.activeVolumeM3), 0),
        [rows]
    );

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 min-w-0 flex-1">
                    {onBackToHome && (
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('LIGHT');
                                onBackToHome();
                            }}
                            aria-label={t('common.back_button', 'VOLVER')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                        </button>
                    )}
                    <h1 className="text-h2-section font-mono font-bold uppercase tabular-nums truncate text-[#0F172A] dark:text-[#F3F4F6] px-1">
                        {t('desktop.breadcrumb_faenas', 'FAENAS')}
                    </h1>
                </div>

                {connectivitySlot}
            </header>

            <section className="flex-1 min-h-0 overflow-y-auto">
                {isLoading && (
                    <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'CARGANDO...')} />
                )}

                {!isLoading && rows.length === 0 && (
                    <div className="py-fib-89 px-fib-21 flex flex-col items-center justify-center gap-fib-8 text-[#94A3B8] dark:text-[#5A6072]">
                        <span className="material-symbols-outlined text-[36px]">domain</span>
                        <span className="text-h2-section font-mono font-bold tabular-nums">0</span>
                    </div>
                )}

                {rows.length > 0 && (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {rows.map((item) => {
                            const isUnassigned = item.faenaId === UNASSIGNED_FAENA_ID;
                            const label = isUnassigned
                                ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                                : item.faenaName;
                            const volumeRatioPct =
                                maxVolume > 0
                                    ? Math.min(100, Math.max(0, (item.activeVolumeM3 / maxVolume) * 100))
                                    : 0;
                            return (
                                <button
                                    key={item.faenaId}
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        onSelectFaena(item.faenaId);
                                    }}
                                    className="w-full min-h-[68px] text-left px-fib-21 py-fib-13 bg-transparent hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] active:bg-[#F8FAFC] dark:active:bg-[#07090D] border-0 transition-colors flex items-center justify-between gap-fib-13 cursor-pointer rounded-none shadow-none"
                                >
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        <span className="block text-body-main font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {label}
                                        </span>
                                        <span className="block text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            {item.activeCount}{' '}
                                            {t('faenas.active_count_label', 'ACTIVOS')} ·{' '}
                                            <span className="font-bold text-[#C68346]">
                                                {item.activeVolumeM3.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}{' '}
                                                m³
                                            </span>
                                        </span>
                                        <div className="w-full h-[2px] bg-[#E2E8F0] dark:bg-[#12151C] rounded-none overflow-hidden">
                                            <div
                                                className="h-full bg-[#C68346] rounded-none transition-[width] duration-300"
                                                style={{ width: `${volumeRatioPct}%` }}
                                            />
                                        </div>
                                    </div>
                                    <span className="material-symbols-outlined text-[20px] text-[#475569] dark:text-[#8A93A6] shrink-0">
                                        chevron_right
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default MobileFaenaList;
