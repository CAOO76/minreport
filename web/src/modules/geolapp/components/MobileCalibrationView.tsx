import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import {
    calibrationRemainingDays,
    fetchDeviceCalibrationHistory,
    getCachedCalibration,
    isCalibrationValid,
    startNativeCalibration,
    type NativeCalibrationResult,
} from '../core/services/spatialScannerService';
import { triggerFieldImpact, triggerFieldNotification } from '../core/utils/fieldHaptics';

export interface MobileCalibrationViewProps {
    tenantId?: string;
    onBack?: () => void;
    connectivitySlot?: React.ReactNode;
}

function formatCalTimestamp(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return '--';
    try {
        return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
    } catch {
        return '--';
    }
}

export const MobileCalibrationView: React.FC<MobileCalibrationViewProps> = ({
    tenantId,
    onBack,
    connectivitySlot,
}) => {
    const { t } = useTranslation();
    const isNative = Capacitor.isNativePlatform();

    const [activeCal, setActiveCal] = useState<NativeCalibrationResult | null>(() =>
        getCachedCalibration()
    );
    const [history, setHistory] = useState<NativeCalibrationResult[]>([]);
    const [loadingHistory, setLoadingHistory] = useState<boolean>(true);
    const [calibrating, setCalibrating] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const list = await fetchDeviceCalibrationHistory(tenantId);
            setHistory(list);
            setActiveCal((prev) => prev ?? list[0] ?? null);
        } finally {
            setLoadingHistory(false);
        }
    }, [tenantId]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    const handleCalibrate = async () => {
        if (!isNative || calibrating) return;
        setCalibrating(true);
        setErrorMessage(null);
        void triggerFieldImpact('MEDIUM');
        try {
            const res = await startNativeCalibration(tenantId);
            if (res.cancelled || !res.calibrated) {
                return;
            }
            setActiveCal(res);
            await triggerFieldNotification('SUCCESS');
            await loadHistory();
        } catch (err: unknown) {
            await triggerFieldNotification('ERROR');
            setErrorMessage(
                err instanceof Error
                    ? err.message
                    : t('calibration.error_generic', 'Error ejecutando calibración AR.')
            );
        } finally {
            setCalibrating(false);
        }
    };

    const calValid = isCalibrationValid(activeCal);
    const remainingDays = calibrationRemainingDays(activeCal);

    return (
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col overflow-hidden select-none rounded-none shadow-none font-atkinson">
            <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 min-w-0 flex-1">
                    {onBack && (
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('LIGHT');
                                onBack();
                            }}
                            aria-label={t('common.back_button', 'VOLVER')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                        </button>
                    )}
                    <h1 className="text-[18px] font-mono font-bold uppercase tabular-nums truncate text-[#0F172A] dark:text-[#F3F4F6] px-1">
                        {t('calibration.mobile_header', 'CALIBRACIÓN')}
                    </h1>
                </div>

                {connectivitySlot}
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {/* Estado Activo de Calibración */}
                <div
                    className={`p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] ${
                        calValid ? 'border-l-[#00AEEF]' : 'border-l-[#C68346]'
                    }`}
                >
                    <div className="flex items-center justify-between gap-fib-13">
                        <span className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                            {t('calibration.active_factor_label', 'FACTOR ESCALA AR')}
                        </span>
                        <span
                            className={`text-microcopy font-mono font-bold uppercase ${
                                calValid ? 'text-[#00AEEF]' : 'text-[#C68346]'
                            }`}
                        >
                            {calValid
                                ? `${t('calibration.status_valid', 'CALIBRADO')} · ${remainingDays}d`
                                : t('calibration.status_pending', 'SIN CALIBRAR')}
                        </span>
                    </div>

                    <div className="mt-fib-8 flex items-baseline justify-between gap-fib-13">
                        <span className="text-kpi-display font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                            {activeCal && activeCal.calibrated
                                ? `×${activeCal.scaleFactor.toFixed(4)}`
                                : '×1.0000'}
                        </span>
                        {activeCal && activeCal.calibrated && (
                            <span className="text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                {activeCal.referenceDistanceM.toFixed(2)}m /{' '}
                                {(
                                    activeCal.measuredDistanceM ??
                                    activeCal.referenceDistanceM / (activeCal.scaleFactor || 1)
                                ).toFixed(2)}
                                m
                            </span>
                        )}
                    </div>

                    {activeCal && activeCal.calibrated && (
                        <div className="mt-fib-13 grid grid-cols-3 gap-fib-8 pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            <div>
                                <div className="text-microcopy uppercase">RMS</div>
                                <div className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {((activeCal.planeNoiseRmsM ?? 0) * 1000).toFixed(1)} mm
                                </div>
                            </div>
                            <div>
                                <div className="text-microcopy uppercase">PITCH / ROLL</div>
                                <div className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {(activeCal.imuPitchOffsetDeg ?? 0).toFixed(1)}° /{' '}
                                    {(activeCal.imuRollOffsetDeg ?? 0).toFixed(1)}°
                                </div>
                            </div>
                            <div>
                                <div className="text-microcopy uppercase">SYNC</div>
                                <div
                                    className={
                                        activeCal.syncedToCloud ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                    }
                                >
                                    {activeCal.syncedToCloud
                                        ? t('calibration.synced', 'CLOUD')
                                        : t('calibration.queued_offline', 'COLA')}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="mt-fib-21">
                        {calibrating && (
                            <div className="mb-fib-13">
                                <M3LinearProgress
                                    indeterminate
                                    ariaLabel={t('calibration.calibrating_aria', 'CALIBRANDO')}
                                />
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleCalibrate()}
                            disabled={!isNative || calibrating}
                            className="w-full min-h-[56px] px-fib-21 bg-[#C68346] disabled:opacity-40 text-white border-0 font-mono text-data-dense font-bold uppercase tracking-wider flex items-center justify-center cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                        >
                            {calibrating
                                ? t('calibration.running', 'CALIBRANDO...')
                                : t('calibration.start_action', 'CALIBRAR HUINCHA 2.00 m')}
                        </button>
                        {!isNative && (
                            <div className="mt-fib-8 font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('calibration.native_only', '[SOLO DISPOSITIVO NATIVO ARCORE]')}
                            </div>
                        )}
                        {errorMessage && (
                            <div className="mt-fib-8 font-mono text-data-dense text-[#C68346]">
                                {errorMessage}
                            </div>
                        )}
                    </div>
                </div>

                {/* Historial Auditable Append-Only */}
                <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between">
                    <span className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                        {t('calibration.history_title', 'HISTORIAL AUDITABLE')} ({history.length})
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            void loadHistory();
                        }}
                        disabled={loadingHistory}
                        aria-label={t('common.refresh', 'REFRESCAR')}
                        className="bg-transparent border-0 outline-none p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                    </button>
                </div>

                {loadingHistory && (
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('calibration.loading_history_aria', 'CARGANDO HISTORIAL')}
                    />
                )}

                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {!loadingHistory && history.length === 0 ? (
                        <div className="p-fib-21 font-mono text-data-dense text-[#5A6072] dark:text-[#94A3B8]">
                            {t('calibration.empty_history', '[Sin calibraciones registradas]')}
                        </div>
                    ) : (
                        history.map((item, idx) => {
                            const synced = Boolean(item.syncedToCloud);
                            return (
                                <div
                                    key={
                                        item.calibrationId ||
                                        item.localId ||
                                        `${item.calibratedAt}_${idx}`
                                    }
                                    className={`px-fib-21 py-fib-13 border-l-[3px] ${
                                        synced ? 'border-l-[#00AEEF]' : 'border-l-[#C68346]'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-fib-13">
                                        <span className="font-mono tabular-nums text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                            ×{item.scaleFactor.toFixed(4)}
                                        </span>
                                        <span className="font-mono tabular-nums text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                            {formatCalTimestamp(item.calibratedAt)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-fib-8 font-mono tabular-nums text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        <span>
                                            {item.deviceModel || '[DISPOSITIVO]'} ·{' '}
                                            {item.referenceDistanceM.toFixed(2)}m /{' '}
                                            {(
                                                item.measuredDistanceM ??
                                                item.referenceDistanceM / (item.scaleFactor || 1)
                                            ).toFixed(2)}
                                            m · RMS {((item.planeNoiseRmsM ?? 0) * 1000).toFixed(1)}
                                            mm
                                        </span>
                                        <span className={synced ? 'text-[#00AEEF]' : 'text-[#C68346]'}>
                                            {synced ? 'CLOUD' : 'OFFLINE'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default MobileCalibrationView;
