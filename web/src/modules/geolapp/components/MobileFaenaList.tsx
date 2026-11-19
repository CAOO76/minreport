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
}

export const MobileFaenaList: React.FC<MobileFaenaListProps> = ({
    sites,
    assets,
    measurements,
    isLoading,
    onSelectFaena,
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

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            <div className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <span className="block text-microcopy font-mono font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                    {t('faenas.list_heading', 'FAENAS MINERAS')}
                </span>
            </div>

            <section className="flex-1 min-h-0 overflow-y-auto">
                {isLoading && (
                    <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'CARGANDO...')} />
                )}

                {!isLoading && rows.length === 0 && (
                    <div className="py-fib-89 px-fib-21 text-center space-y-fib-13">
                        <span className="material-symbols-outlined text-[36px] text-[#94A3B8] dark:text-[#5A6072]">
                            domain
                        </span>
                        <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('faenas.empty_mobile', 'SIN FAENAS REGISTRADAS DESDE ESCRITORIO')}
                        </p>
                    </div>
                )}

                {rows.length > 0 && (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {rows.map((item) => {
                            const isUnassigned = item.faenaId === UNASSIGNED_FAENA_ID;
                            const label = isUnassigned
                                ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                                : item.faenaName;
                            return (
                                <button
                                    key={item.faenaId}
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        onSelectFaena(item.faenaId);
                                    }}
                                    className="w-full min-h-[64px] text-left px-fib-21 py-fib-13 bg-transparent hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] active:bg-[#F8FAFC] dark:active:bg-[#07090D] border-0 transition-colors flex items-center justify-between gap-fib-13 cursor-pointer rounded-none shadow-none"
                                >
                                    <div className="min-w-0 space-y-0.5">
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
