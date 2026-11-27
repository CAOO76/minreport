import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../../components/common/M3LinearProgress';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import type {
    CalibrationProfile,
    GroundTruthRecord,
} from '../../../../contracts/acopios.contracts';
import { dataService } from '../../core/services/DataService';
import {
    computeAggregateDeviationSummary,
    fetchCalibrationProfiles,
    fetchGroundTruthRecords,
} from '../../core/services/groundTruthService';
import {
    fetchDeviceCalibrationHistory,
    formatStockpileVolumeM3,
    type NativeCalibrationResult,
} from '../../core/services/spatialScannerService';
import type { StockpileAsset, StockpileMeasurement } from '../../core/types/GeolappTypes';

export type DesktopCalibrationTab = 'TAPE' | 'GROUND_TRUTH' | 'LOOCV_AI';

export interface DesktopCalibrationAuditViewProps {
    assets?: StockpileAsset[];
    measurements?: StockpileMeasurement[];
    initialTab?: DesktopCalibrationTab;
}

function formatUtcTimestamp(ts?: number | null): string {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return UNDECLARED_TECH_VALUE;
    try {
        return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
        return UNDECLARED_TECH_VALUE;
    }
}

/**
 * Escritorio MINREPORT · ACOPIOS — Auditoría de Calibración, Desviaciones Reales y LOOCV/IA.
 * 100% SOLO LECTURA (sin creación, edición, recomputo ni activación desde escritorio).
 */
export const DesktopCalibrationAuditView: React.FC<DesktopCalibrationAuditViewProps> = ({
    assets = [],
    measurements = [],
    initialTab = 'TAPE',
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<DesktopCalibrationTab>(initialTab);
    const [records, setRecords] = useState<NativeCalibrationResult[]>([]);
    const [gtRecords, setGtRecords] = useState<GroundTruthRecord[]>([]);
    const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [query, setQuery] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const assetsById = useMemo(() => {
        const map = new Map<string, StockpileAsset>();
        for (const a of assets) map.set(a.id, a);
        return map;
    }, [assets]);

    const loadAll = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const tenantId = dataService.getTenantId() || undefined;
            const [calList, gtRes, profList] = await Promise.all([
                fetchDeviceCalibrationHistory(tenantId),
                fetchGroundTruthRecords({ tenantId }),
                fetchCalibrationProfiles(tenantId),
            ]);
            setRecords(calList);
            setGtRecords(gtRes.records);
            setProfiles(profList);
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
        void loadAll();
    }, [loadAll]);

    const qLower = query.trim().toLowerCase();

    const filteredCalibrations = useMemo(() => {
        if (!qLower) return records;
        return records.filter((rec) =>
            [rec.deviceModel || '', rec.platform || '', rec.calibrationId || '', rec.scaleFactor.toFixed(4)]
                .join(' ')
                .toLowerCase()
                .includes(qLower)
        );
    }, [records, qLower]);

    const filteredGroundTruth = useMemo(() => {
        if (!qLower) return gtRecords;
        return gtRecords.filter((rec) => {
            const assetName = rec.assetName || assetsById.get(rec.assetId)?.name || rec.assetId;
            return [
                assetName,
                rec.measurementId,
                rec.deviceModel || '',
                rec.referenceMethod,
                rec.deviations.statusBand,
            ]
                .join(' ')
                .toLowerCase()
                .includes(qLower);
        });
    }, [gtRecords, qLower, assetsById]);

    const filteredProfiles = useMemo(() => {
        if (!qLower) return profiles;
        return profiles.filter((p) =>
            [p.profileId, p.deviceModel, p.status, p.aiDiagnosis?.recommendedAction || '']
                .join(' ')
                .toLowerCase()
                .includes(qLower)
        );
    }, [profiles, qLower]);

    const gtSummary = useMemo(
        () => computeAggregateDeviationSummary(filteredGroundTruth),
        [filteredGroundTruth]
    );

    const tabs: Array<{ id: DesktopCalibrationTab; icon: string; label: string }> = [
        {
            id: 'TAPE',
            icon: 'compass_calibration',
            label: t('calibration.tab_tape', 'HUINCHA AR 2.00 m'),
        },
        {
            id: 'GROUND_TRUTH',
            icon: 'straighten',
            label: t('calibration.tab_ground_truth', 'MEDIDAS REALES Y DESVIACIONES'),
        },
        {
            id: 'LOOCV_AI',
            icon: 'psychology',
            label: t('calibration.tab_loocv_ai', 'CALIBRACIÓN LOOCV E IA'),
        },
    ];

    return (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-fib-34 space-y-fib-21 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] select-none rounded-none shadow-none font-atkinson">
            <div className="flex flex-wrap items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-fib-21">
                    <div
                        role="tablist"
                        aria-label={t('calibration.desktop_title', 'AUDITORÍA DE CALIBRACIONES DE CAMPO')}
                        className="flex items-center gap-fib-8"
                    >
                        {tabs.map((tab) => {
                            const selected = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    aria-label={tab.label}
                                    title={tab.label}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`min-w-[44px] min-h-[44px] px-2 bg-transparent border-0 border-b-2 outline-none flex items-center justify-center cursor-pointer rounded-none transition-colors ${
                                        selected
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                    }`}
                                >
                                    <span
                                        aria-hidden="true"
                                        className="material-symbols-outlined text-[24px]"
                                    >
                                        {tab.icon}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <h2 className="text-h1-header font-semibold uppercase tracking-tight">
                        {activeTab === 'TAPE'
                            ? t('calibration.desktop_title', 'AUDITORÍA DE CALIBRACIONES DE CAMPO')
                            : activeTab === 'GROUND_TRUTH'
                              ? t('calibration.tab_ground_truth', 'MEDIDAS REALES Y DESVIACIONES')
                              : t('calibration.loocv_title', 'CALIBRACIÓN DETERMINISTA LOOCV')}
                    </h2>
                </div>

                <div className="flex items-center gap-fib-13">
                    <form
                        autoComplete="off"
                        spellCheck={false}
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
                            className="h-10 w-64 px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none select-text"
                        />
                    </form>
                    <button
                        type="button"
                        onClick={() => void loadAll()}
                        disabled={loading}
                        aria-label={t('common.refresh', 'REFRESCAR')}
                        title={t('common.refresh', 'REFRESCAR')}
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

            {/* TAB 1: HUINCHA AR 2.00 m */}
            {activeTab === 'TAPE' && (
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
                            {!loading && filteredCalibrations.length === 0 ? (
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
                                filteredCalibrations.map((rec, idx) => {
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
            )}

            {/* TAB 2: AUDITORÍA GROUND-TRUTH Y DESVIACIONES (SOLO LECTURA) */}
            {activeTab === 'GROUND_TRUTH' && (
                <div className="space-y-fib-21">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-fib-13 font-mono tabular-nums">
                        <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('ground_truth.kpi_count', 'CONTRASTES')} ({measurements.length})
                            </div>
                            <div className="text-kpi-display font-bold">{gtSummary.count}</div>
                        </div>
                        <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('ground_truth.kpi_mape', 'MAPE')}
                            </div>
                            <div
                                className={`text-kpi-display font-bold ${
                                    gtSummary.mapePct !== null && gtSummary.mapePct > 8
                                        ? 'text-[#C68346]'
                                        : 'text-[#00AEEF]'
                                }`}
                            >
                                {gtSummary.mapePct !== null ? `${gtSummary.mapePct.toFixed(2)}%` : '--'}
                            </div>
                        </div>
                        <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('ground_truth.kpi_rmse', 'RMSE')}
                            </div>
                            <div className="text-kpi-display font-bold">
                                {gtSummary.rmsePct !== null ? `${gtSummary.rmsePct.toFixed(2)}%` : '--'}
                            </div>
                        </div>
                        <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('ground_truth.kpi_bias', 'BIAS')}
                            </div>
                            <div className="text-kpi-display font-bold">
                                {gtSummary.biasPct !== null
                                    ? `${gtSummary.biasPct > 0 ? '+' : ''}${gtSummary.biasPct.toFixed(2)}%`
                                    : '--'}
                            </div>
                        </div>
                        <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('ground_truth.kpi_alerts', 'ALERTAS > 8%')}
                            </div>
                            <div
                                className={`text-kpi-display font-bold ${
                                    gtSummary.alertCount > 0
                                        ? 'text-[#C68346]'
                                        : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                }`}
                            >
                                {gtSummary.alertCount}
                            </div>
                        </div>
                    </div>

                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] overflow-x-auto rounded-none shadow-none">
                        <table className="w-full text-left border-collapse font-mono tabular-nums text-data-dense">
                            <thead>
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <th className="py-fib-13 px-fib-13">
                                        {t('calibration.col_date', 'FECHA UTC')}
                                    </th>
                                    <th className="py-fib-13 px-fib-13">
                                        {t('ground_truth.col_measurement', 'ACOPIO / MEDICIÓN')}
                                    </th>
                                    <th className="py-fib-13 px-fib-13">
                                        {t('calibration.col_device', 'DISPOSITIVO')}
                                    </th>
                                    <th className="py-fib-13 px-fib-13">
                                        {t('ground_truth.col_method', 'MÉTODO')}
                                    </th>
                                    <th className="py-fib-13 px-fib-13">
                                        {t('ground_truth.col_app', 'APP')} /{' '}
                                        {t('ground_truth.col_real', 'REAL')}
                                    </th>
                                    <th className="py-fib-13 px-fib-13">
                                        {t('ground_truth.col_delta', 'Δ%')}
                                    </th>
                                    <th className="py-fib-13 px-fib-13">
                                        {t('ground_truth.col_band', 'BANDA ISA-101')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {!loading && filteredGroundTruth.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="py-fib-34 px-fib-13 text-center text-[#5A6072] dark:text-[#94A3B8]"
                                        >
                                            {t(
                                                'ground_truth.empty_list',
                                                '[Sin contrastes reales registrados]'
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredGroundTruth.map((rec) => {
                                        const isAlert = rec.deviations.statusBand === 'ALERT';
                                        const assetLabel =
                                            rec.assetName ||
                                            assetsById.get(rec.assetId)?.name ||
                                            rec.assetId;
                                        return (
                                            <tr
                                                key={rec.id}
                                                className="hover:bg-[#F8FAFC] dark:hover:bg-[#000000] transition-colors"
                                            >
                                                <td className="py-fib-13 px-fib-13">
                                                    {formatUtcTimestamp(rec.createdAt)}
                                                </td>
                                                <td className="py-fib-13 px-fib-13">
                                                    <div className="font-bold">{assetLabel}</div>
                                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                        {rec.measurementId}
                                                    </div>
                                                </td>
                                                <td className="py-fib-13 px-fib-13">
                                                    {rec.deviceModel || UNDECLARED_TECH_VALUE}
                                                </td>
                                                <td className="py-fib-13 px-fib-13">
                                                    {t(
                                                        `ground_truth.method_${rec.referenceMethod}`,
                                                        rec.referenceMethod
                                                    )}
                                                </td>
                                                <td className="py-fib-13 px-fib-13">
                                                    {rec.real.realVolumeM3 !== undefined && (
                                                        <div>
                                                            V:{' '}
                                                            {rec.estimated.volumeM3 !== undefined
                                                                ? formatStockpileVolumeM3(
                                                                      rec.estimated.volumeM3
                                                                  )
                                                                : '--'}{' '}
                                                            /{' '}
                                                            {formatStockpileVolumeM3(
                                                                rec.real.realVolumeM3
                                                            )}{' '}
                                                            m³
                                                        </div>
                                                    )}
                                                    {rec.real.realHeightM !== undefined && (
                                                        <div>
                                                            H:{' '}
                                                            {rec.estimated.heightM?.toFixed(2) ??
                                                                '--'}{' '}
                                                            / {rec.real.realHeightM.toFixed(2)} m
                                                        </div>
                                                    )}
                                                    {rec.real.realDiameterM !== undefined && (
                                                        <div>
                                                            Ø:{' '}
                                                            {rec.estimated.diameterM?.toFixed(2) ??
                                                                '--'}{' '}
                                                            / {rec.real.realDiameterM.toFixed(2)} m
                                                        </div>
                                                    )}
                                                </td>
                                                <td
                                                    className={`py-fib-13 px-fib-13 font-bold ${
                                                        isAlert
                                                            ? 'text-[#C68346]'
                                                            : 'text-[#00AEEF]'
                                                    }`}
                                                >
                                                    {rec.deviations.deltaVolumePct !== undefined
                                                        ? `V ${rec.deviations.deltaVolumePct > 0 ? '+' : ''}${rec.deviations.deltaVolumePct.toFixed(1)}%`
                                                        : `MAX ${rec.deviations.maxAbsDeltaPct.toFixed(1)}%`}
                                                </td>
                                                <td className="py-fib-13 px-fib-13">
                                                    <span
                                                        className={`font-bold ${
                                                            isAlert
                                                                ? 'text-[#C68346]'
                                                                : 'text-[#00AEEF]'
                                                        }`}
                                                    >
                                                        {isAlert
                                                            ? t(
                                                                  'ground_truth.status_ALERT',
                                                                  'ALERTA > 8%'
                                                              )
                                                            : t(
                                                                  'ground_truth.status_OPTIMAL',
                                                                  'ÓPTIMO <= 8%'
                                                              )}
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
            )}

            {/* TAB 3: PERFILES LOOCV Y DIAGNÓSTICO IA (100% SOLO LECTURA) */}
            {activeTab === 'LOOCV_AI' && (
                <div className="space-y-fib-21 font-mono tabular-nums">
                    {!loading && filteredProfiles.length === 0 ? (
                        <div className="p-fib-34 border border-[#E2E8F0] dark:border-[#12151C] text-center text-data-dense text-[#5A6072] dark:text-[#94A3B8] rounded-none">
                            {t('calibration.loocv_empty', '[Sin perfiles LOOCV generados]')}
                        </div>
                    ) : (
                        filteredProfiles.map((prof) => {
                            const isActive = prof.status === 'ACTIVE';
                            const isDraft = prof.status === 'DRAFT';
                            return (
                                <section
                                    key={prof.profileId}
                                    className={`p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] bg-[#FFFFFF] dark:bg-[#07090D] space-y-fib-13 rounded-none shadow-none ${
                                        isActive
                                            ? 'border-l-[#00AEEF]'
                                            : isDraft
                                              ? 'border-l-[#C68346]'
                                              : 'border-l-transparent'
                                    }`}
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                        <div>
                                            <div className="text-h2-section font-bold">
                                                {prof.deviceModel}
                                            </div>
                                            <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                {prof.profileId} · {formatUtcTimestamp(prof.createdAt)} ·{' '}
                                                {prof.region || 'southamerica-west1'}
                                            </div>
                                        </div>
                                        <span
                                            className={`text-microcopy font-bold uppercase ${
                                                isActive
                                                    ? 'text-[#00AEEF]'
                                                    : isDraft
                                                      ? 'text-[#C68346]'
                                                      : 'text-[#94A3B8] dark:text-[#5A6072]'
                                            }`}
                                        >
                                            {t(`calibration.status_${prof.status}`, prof.status)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-fib-13 text-data-dense">
                                        <div>
                                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('calibration.loocv_samples', 'MUESTRAS (N)')}
                                            </div>
                                            <div className="font-bold">
                                                N = {prof.sampleCount}
                                                {typeof prof.outliersExcluded === 'number' &&
                                                prof.outliersExcluded > 0
                                                    ? ` (-${prof.outliersExcluded} MAD)`
                                                    : ''}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('calibration.loocv_factors', 'FACTORES V / H / BASE')}
                                            </div>
                                            <div className="font-bold">
                                                ×{prof.volumeScaleFactor.toFixed(4)} / ×
                                                {prof.heightScaleFactor.toFixed(4)} / ×
                                                {prof.baseScaleFactor.toFixed(4)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('calibration.loocv_mape', 'MAPE CRUDO -> CALIBRADO')}
                                            </div>
                                            <div
                                                className={`font-bold ${
                                                    prof.loocvMetrics.improved
                                                        ? 'text-[#00AEEF]'
                                                        : 'text-[#C68346]'
                                                }`}
                                            >
                                                {prof.loocvMetrics.rawMapePct.toFixed(2)}% ➔{' '}
                                                {prof.loocvMetrics.calibratedMapePct.toFixed(2)}%
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('calibration.loocv_rmse_bias', 'RMSE / BIAS')}
                                            </div>
                                            <div className="font-bold">
                                                {prof.loocvMetrics.rmsePct.toFixed(2)}% /{' '}
                                                {prof.loocvMetrics.biasPct > 0 ? '+' : ''}
                                                {prof.loocvMetrics.biasPct.toFixed(2)}%
                                            </div>
                                        </div>
                                    </div>

                                    {prof.aiDiagnosis && (
                                        <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                            <div className="flex flex-wrap items-center justify-between gap-fib-8 text-microcopy uppercase">
                                                <span className="font-bold text-[#00AEEF]">
                                                    {t(
                                                        'calibration.ai_diagnosis_title',
                                                        'DIAGNÓSTICO IA SOBERANO'
                                                    )}{' '}
                                                    ·{' '}
                                                    {t(
                                                        `calibration.ai_action_${prof.aiDiagnosis.recommendedAction}`,
                                                        prof.aiDiagnosis.recommendedAction
                                                    )}
                                                </span>
                                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                                    {prof.aiDiagnosis.modelUsed}
                                                </span>
                                            </div>
                                            <p className="text-data-dense font-atkinson text-[#0F172A] dark:text-[#F3F4F6]">
                                                {prof.aiDiagnosis.summary}
                                            </p>
                                            {prof.aiDiagnosis.rootCauses.length > 0 && (
                                                <ul className="list-disc pl-fib-21 space-y-1 text-data-dense font-atkinson text-[#475569] dark:text-[#8A93A6]">
                                                    {prof.aiDiagnosis.rootCauses.map((cause, idx) => (
                                                        <li key={`${prof.profileId}-cause-${idx}`}>
                                                            {cause}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </section>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

export default DesktopCalibrationAuditView;
