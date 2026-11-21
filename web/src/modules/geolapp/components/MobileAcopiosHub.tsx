import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    calibrationRemainingDays,
    getCachedCalibration,
    getNativeCalibrationStatus,
    isCalibrationValid,
    type NativeCalibrationResult,
} from '../core/services/spatialScannerService';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';

export interface MobileAcopiosHubProps {
    onSelectMeasure: () => void;
    onSelectCalibrate: () => void;
    onBackToHome?: () => void;
    connectivitySlot?: React.ReactNode;
    sitesCount?: number;
    assetsCount?: number;
}

export const MobileAcopiosHub: React.FC<MobileAcopiosHubProps> = ({
    onSelectMeasure,
    onSelectCalibrate,
    onBackToHome,
    connectivitySlot,
    sitesCount = 0,
    assetsCount = 0,
}) => {
    const { t } = useTranslation();

    const [calibration, setCalibration] = useState<NativeCalibrationResult | null>(() =>
        getCachedCalibration()
    );

    useEffect(() => {
        let active = true;
        void getNativeCalibrationStatus()
            .then((cal) => {
                if (active && cal) {
                    setCalibration(cal);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const calValid = useMemo(() => isCalibrationValid(calibration), [calibration]);
    const daysLeft = useMemo(() => calibrationRemainingDays(calibration), [calibration]);

    const calAccentClass = calValid ? 'border-l-[#00AEEF]' : 'border-l-[#C68346]';
    const calIconColor = calValid ? 'text-[#00AEEF]' : 'text-[#C68346]';
    const calStatusLabel = calValid && calibration
        ? `${t('hub.cal_factor_prefix', 'CAL')} ×${calibration.scaleFactor.toFixed(3)} · ${daysLeft}d`
        : t('hub.cal_pending', 'SIN CALIBRAR');

    return (
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col overflow-hidden select-none rounded-none shadow-none font-atkinson">
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
                    <h1 className="text-[18px] font-mono font-bold uppercase tabular-nums truncate text-[#0F172A] dark:text-[#F3F4F6] px-1">
                        {t('hub.module_title', 'ACOPIOS')}
                    </h1>
                </div>

                {connectivitySlot}
            </header>

            <div className="flex-1 min-h-0 flex flex-col justify-center divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="py-fib-34 px-fib-21 flex flex-col items-center justify-center border-l-[3px] border-l-[#C68346]">
                    <button
                        type="button"
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            onSelectMeasure();
                        }}
                        aria-label={t('hub.measure_action', 'MEDIR')}
                        className="w-[144px] min-h-[104px] bg-transparent border-0 outline-none p-fib-13 flex flex-col items-center justify-center gap-fib-13 text-[#0F172A] dark:text-[#F3F4F6] active:opacity-70 transition-opacity cursor-pointer rounded-none shadow-none"
                    >
                        <span
                            aria-hidden="true"
                            className="material-symbols-outlined text-[40px] leading-none text-[#C68346]"
                        >
                            measuring_tape
                        </span>
                        <span className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('hub.measure_action', 'MEDIR')}
                        </span>
                    </button>
                    <div className="mt-fib-8 font-mono tabular-nums text-data-dense text-[#475569] dark:text-[#8A93A6]">
                        {sitesCount} {t('hub.sites_unit', 'FAENAS')} · {assetsCount}{' '}
                        {t('hub.assets_unit', 'ACOPIOS')}
                    </div>
                </div>

                <div
                    className={`py-fib-34 px-fib-21 flex flex-col items-center justify-center border-l-[3px] ${calAccentClass}`}
                >
                    <button
                        type="button"
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            onSelectCalibrate();
                        }}
                        aria-label={t('hub.calibrate_action', 'CALIBRAR')}
                        className="w-[144px] min-h-[104px] bg-transparent border-0 outline-none p-fib-13 flex flex-col items-center justify-center gap-fib-13 text-[#0F172A] dark:text-[#F3F4F6] active:opacity-70 transition-opacity cursor-pointer rounded-none shadow-none"
                    >
                        <span
                            aria-hidden="true"
                            className={`material-symbols-outlined text-[40px] leading-none ${calIconColor}`}
                        >
                            compass_calibration
                        </span>
                        <span className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('hub.calibrate_action', 'CALIBRAR')}
                        </span>
                    </button>
                    <div
                        className={`mt-fib-8 font-mono tabular-nums text-data-dense ${
                            calValid ? 'text-[#00AEEF]' : 'text-[#C68346]'
                        }`}
                    >
                        {calStatusLabel}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MobileAcopiosHub;
