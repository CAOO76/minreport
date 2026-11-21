import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../../components/common/M3LinearProgress';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import { dataService } from '../../core/services/DataService';
import {
    fetchDeviceCalibrationHistory,
    type NativeCalibrationResult,
} from '../../core/services/spatialScannerService';

function formatUtcTimestamp(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return UNDECLARED_TECH_VALUE;
    try {
        return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
        return UNDECLARED_TECH_VALUE;
    }
}

export const DesktopCalibrationAuditView: React.FC = () => {
    const { t } = useTranslation();
    const [records, setRecords] = useState<NativeCalibrationResult[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [query, setQuery] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const loadRecords = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const tenantId = dataService.getTenantId();
            const list = await fetchDeviceCalibrationHistory(tenantId);
            setRecords(list);
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : t('calibration.error_load_audit', 'Error cargando registro de calibraciones.')
            );
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadRecords();
    }, [loadRecords]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return records;
        return records.filter((rec) => {
            const haystack = [
                rec.deviceModel || '',
                rec.platform || '',
                rec.calibrationId || '',
                rec.scaleFactor.toFixed(4),
            ]
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [records, query]);

    return (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-fib-34 space-y-fib-21 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] select-none rounded-none shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-fib-13">
                    <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[24px] text-[#00AEEF]"
                    >
                        compass_calibration
                    </span>
                    <h2 className="text-h1-header font-semibold uppercase tracking-tight">
                        {t('calibration.desktop_title', 'AUDITORÍA DE CALIBRACIONES DE CAMPO')}
                    </h2>
                </div>

                <div className="flex items-center gap-fib-13">
                    <form
                        autoComplete="off"
                        onSubmit={(e) => e.preventDefault()}
                        className="flex items-center"
                    >
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t(
                                'calibration.filter_placeholder',
                                'MODELO / ID CALIBRACIÓN'
                            )}
                            className="h-10 w-64 px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none"
                        />
                    </form>
                    <button
                        type="button"
                        onClick={() => void loadRecords()}
                        disabled={loading}
                        aria-label={t('common.refresh', 'REFRESCAR')}
                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                    </button>
                </div>
            </div>

            {loading && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('calibration.loading_history_aria', 'CARGANDO HISTORIAL')}
                />
            )}

            {error && (
                <div className="p-fib-13 border border-[#C68346] bg-[#FFFFFF] dark:bg-[#07090D] font-mono text-data-dense text-[#C68346] rounded-none">
                    {error}
                </div>
            )}

            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] overflow-x-auto rounded-none shadow-none">
                <table className="w-full text-left border-collapse font-mono tabular-nums text-data-dense">
                    <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_date', 'FECHA UTC')}
                            </th>
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_device', 'DISPOSITIVO')}
                            </th>
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_scale', 'ESCALA')}
                            </th>
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_distances', 'REF / MEDIDO (m)')}
                            </th>
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_rms', 'RMS PLANO')}
                            </th>
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_imu', 'PITCH / ROLL')}
                            </th>
                            <th className="py-fib-13 px-fib-13">
                                {t('calibration.col_status', 'REGIÓN / ESTADO')}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {!loading && filtered.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="py-fib-34 px-fib-13 text-center text-[#5A6072] dark:text-[#94A3B8]"
                                >
                                    {t(
                                        'calibration.empty_history',
                                        '[Sin calibraciones registradas]'
                                    )}
                                </td>
                            </tr>
                        ) : (
                            filtered.map((rec, idx) => {
                                const synced = Boolean(rec.syncedToCloud);
                                return (
                                    <tr
                                        key={
                                            rec.calibrationId ||
                                            rec.localId ||
                                            `${rec.calibratedAt}_${idx}`
                                        }
                                        className="hover:bg-[#F8FAFC] dark:hover:bg-[#000000] transition-colors"
                                    >
                                        <td className="py-fib-13 px-fib-13 text-[#0F172A] dark:text-[#F3F4F6]">
                                            {formatUtcTimestamp(rec.calibratedAt)}
                                        </td>
                                        <td className="py-fib-13 px-fib-13">
                                            <div className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {rec.deviceModel || UNDECLARED_TECH_VALUE}
                                            </div>
                                            {rec.platform && (
                                                <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    {rec.platform}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-fib-13 px-fib-13 font-bold text-[#00AEEF]">
                                            ×{rec.scaleFactor.toFixed(4)}
                                        </td>
                                        <td className="py-fib-13 px-fib-13">
                                            {rec.referenceDistanceM.toFixed(2)} /{' '}
                                            {(
                                                rec.measuredDistanceM ??
                                                rec.referenceDistanceM / (rec.scaleFactor || 1)
                                            ).toFixed(2)}
                                        </td>
                                        <td className="py-fib-13 px-fib-13">
                                            {((rec.planeNoiseRmsM ?? 0) * 1000).toFixed(1)} mm
                                        </td>
                                        <td className="py-fib-13 px-fib-13">
                                            {(rec.imuPitchOffsetDeg ?? 0).toFixed(1)}° /{' '}
                                            {(rec.imuRollOffsetDeg ?? 0).toFixed(1)}°
                                        </td>
                                        <td className="py-fib-13 px-fib-13">
                                            <span
                                                className={
                                                    synced ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                                }
                                            >
                                                {synced
                                                    ? `${rec.region || 'southamerica-west1'} · AUDITADO`
                                                    : 'COLA OFFLINE'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DesktopCalibrationAuditView;
