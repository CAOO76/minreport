import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import type {
    CalibrationProfile,
    GroundTruthRecord,
    GroundTruthReferenceMethod,
} from '../../../contracts/acopios.contracts';
import { dataService } from '../core/services/DataService';
import {
    activateCalibrationProfileHitl,
    computeAggregateDeviationSummary,
    computeClientDeviationMetrics,
    extractEstimatedSnapshotFromMeasurement,
    fetchCalibrationProfiles,
    fetchGroundTruthRecords,
    recomputeCalibrationProfile,
    REFERENCE_METHODS,
    submitMeasurementGroundTruth,
} from '../core/services/groundTruthService';
import {
    calibrationRemainingDays,
    fetchDeviceCalibrationHistory,
    formatStockpileVolumeM3,
    getCachedCalibration,
    isCalibrationValid,
    startNativeCalibration,
    type NativeCalibrationResult,
} from '../core/services/spatialScannerService';
import type { StockpileAsset, StockpileMeasurement } from '../core/types/GeolappTypes';
import { triggerFieldImpact, triggerFieldNotification } from '../core/utils/fieldHaptics';

export type MobileCalibrationTab = 'TAPE' | 'GROUND_TRUTH' | 'LOOCV_AI';

export interface MobileCalibrationViewProps {
    tenantId?: string;
    assets?: StockpileAsset[];
    measurements?: StockpileMeasurement[];
    initialTab?: MobileCalibrationTab;
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

function parsePosNum(raw: string): number | undefined {
    const clean = raw.trim().replace(',', '.');
    if (!clean) return undefined;
    const n = Number(clean);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseNonNegNum(raw: string): number | undefined {
    const clean = raw.trim().replace(',', '.');
    if (!clean) return undefined;
    const n = Number(clean);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export const MobileCalibrationView: React.FC<MobileCalibrationViewProps> = ({
    tenantId,
    assets: propAssets,
    measurements: propMeasurements,
    initialTab = 'TAPE',
    onBack,
    connectivitySlot,
}) => {
    const { t } = useTranslation();
    const isNative = Capacitor.isNativePlatform();
    const effectiveTenantId = tenantId || dataService.getTenantId() || undefined;

    const [activeTab, setActiveTab] = useState<MobileCalibrationTab>(initialTab);

    // Tab 1: Huincha AR 2.00 m
    const [activeCal, setActiveCal] = useState<NativeCalibrationResult | null>(() =>
        getCachedCalibration()
    );
    const [history, setHistory] = useState<NativeCalibrationResult[]>([]);
    const [loadingHistory, setLoadingHistory] = useState<boolean>(true);
    const [calibrating, setCalibrating] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Tab 2: Ground-Truth & Desviaciones
    const [localAssets, setLocalAssets] = useState<StockpileAsset[]>(propAssets ?? []);
    const [localMeasurements, setLocalMeasurements] = useState<StockpileMeasurement[]>(
        propMeasurements ?? []
    );
    const [gtRecords, setGtRecords] = useState<GroundTruthRecord[]>([]);
    const [loadingGt, setLoadingGt] = useState<boolean>(false);
    const [selectedMeas, setSelectedMeas] = useState<StockpileMeasurement | null>(null);
    const [gtMethod, setGtMethod] = useState<GroundTruthReferenceMethod>('TAPE_MEASURE');
    const [gtHeight, setGtHeight] = useState('');
    const [gtLength, setGtLength] = useState('');
    const [gtWidth, setGtWidth] = useState('');
    const [gtDiameter, setGtDiameter] = useState('');
    const [gtVolume, setGtVolume] = useState('');
    const [gtSlope, setGtSlope] = useState('');
    const [gtNotes, setGtNotes] = useState('');
    const [gtHitlOpen, setGtHitlOpen] = useState(false);
    const [gtSaving, setGtSaving] = useState(false);
    const [gtFeedback, setGtFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    // Tab 3: LOOCV + IA Soberana
    const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
    const [loadingProfiles, setLoadingProfiles] = useState<boolean>(false);
    const [recomputing, setRecomputing] = useState<boolean>(false);
    const [activatingProfile, setActivatingProfile] = useState<CalibrationProfile | null>(null);
    const [activatingBusy, setActivatingBusy] = useState<boolean>(false);
    const [loocvFeedback, setLoocvFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
        null
    );

    const assetsById = useMemo(() => {
        const m = new Map<string, StockpileAsset>();
        for (const a of propAssets ?? localAssets) m.set(a.id, a);
        return m;
    }, [propAssets, localAssets]);

    const effectiveMeasurements = useMemo(() => {
        const src = propMeasurements ?? localMeasurements;
        return [...src]
            .filter((m) => !m.ignored)
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [propMeasurements, localMeasurements]);

    const gtSummary = useMemo(() => computeAggregateDeviationSummary(gtRecords), [gtRecords]);

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const list = await fetchDeviceCalibrationHistory(effectiveTenantId);
            setHistory(list);
            setActiveCal((prev) => prev ?? list[0] ?? null);
        } finally {
            setLoadingHistory(false);
        }
    }, [effectiveTenantId]);

    const loadGroundTruthData = useCallback(async () => {
        setLoadingGt(true);
        try {
            const [{ records }, fetchedAssets, fetchedMeas] = await Promise.all([
                fetchGroundTruthRecords({ tenantId: effectiveTenantId }),
                propAssets ? Promise.resolve(propAssets) : dataService.getAllAssets().catch(() => []),
                propMeasurements
                    ? Promise.resolve(propMeasurements)
                    : dataService.getAllMeasurements().catch(() => []),
            ]);
            setGtRecords(records);
            if (!propAssets) setLocalAssets(fetchedAssets);
            if (!propMeasurements) setLocalMeasurements(fetchedMeas);
        } finally {
            setLoadingGt(false);
        }
    }, [effectiveTenantId, propAssets, propMeasurements]);

    const loadProfiles = useCallback(async () => {
        setLoadingProfiles(true);
        try {
            const list = await fetchCalibrationProfiles(effectiveTenantId);
            setProfiles(list);
        } finally {
            setLoadingProfiles(false);
        }
    }, [effectiveTenantId]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    useEffect(() => {
        if (activeTab === 'GROUND_TRUTH') {
            void loadGroundTruthData();
        } else if (activeTab === 'LOOCV_AI') {
            void loadProfiles();
        }
    }, [activeTab, loadGroundTruthData, loadProfiles]);

    const handleCalibrate = async () => {
        if (!isNative || calibrating) return;
        setCalibrating(true);
        setErrorMessage(null);
        void triggerFieldImpact('MEDIUM');
        try {
            const res = await startNativeCalibration(effectiveTenantId);
            if (res.cancelled || !res.calibrated) return;
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

    const selectedAsset = selectedMeas ? assetsById.get(selectedMeas.assetId) ?? null : null;
    const selectedEstimated = useMemo(
        () =>
            selectedMeas
                ? extractEstimatedSnapshotFromMeasurement(selectedMeas, selectedAsset)
                : null,
        [selectedMeas, selectedAsset]
    );
    const realInputs = useMemo(
        () => ({
            realHeightM: parsePosNum(gtHeight),
            realBaseLengthM: parsePosNum(gtLength),
            realBaseWidthM: parsePosNum(gtWidth),
            realDiameterM: parsePosNum(gtDiameter),
            realVolumeM3: parsePosNum(gtVolume),
            realSlopeAngleDeg: parseNonNegNum(gtSlope),
        }),
        [gtHeight, gtLength, gtWidth, gtDiameter, gtVolume, gtSlope]
    );
    const hasAnyReal = Boolean(
        realInputs.realHeightM !== undefined ||
            realInputs.realBaseLengthM !== undefined ||
            realInputs.realBaseWidthM !== undefined ||
            realInputs.realDiameterM !== undefined ||
            realInputs.realVolumeM3 !== undefined ||
            realInputs.realSlopeAngleDeg !== undefined
    );
    const liveDeviations = useMemo(
        () =>
            selectedEstimated && hasAnyReal
                ? computeClientDeviationMetrics(selectedEstimated, realInputs)
                : null,
        [selectedEstimated, hasAnyReal, realInputs]
    );

    const handleConfirmGroundTruthHitl = async () => {
        if (!selectedMeas || !selectedEstimated || gtSaving) return;
        setGtSaving(true);
        setGtFeedback(null);
        try {
            const { record, queuedOffline } = await submitMeasurementGroundTruth({
                tenantId: effectiveTenantId,
                assetId: selectedMeas.assetId,
                assetName: selectedAsset?.name,
                measurementId: selectedMeas.id,
                deviceModel: selectedMeas.device_model || selectedAsset?.device_model,
                estimated: selectedEstimated,
                input: {
                    hitlConfirmation: 'ACTUALIZAR',
                    referenceMethod: gtMethod,
                    ...(gtNotes.trim() ? { fieldNotes: gtNotes.trim() } : {}),
                    ...realInputs,
                },
            });
            setGtRecords((prev) => [record, ...prev]);
            setGtHitlOpen(false);
            setSelectedMeas(null);
            setGtHeight('');
            setGtLength('');
            setGtWidth('');
            setGtDiameter('');
            setGtVolume('');
            setGtSlope('');
            setGtNotes('');
            setGtFeedback({
                type: 'ok',
                text: queuedOffline
                    ? t(
                          'ground_truth.saved_offline',
                          'Contraste guardado localmente y encolado para sincronización.'
                      )
                    : t('ground_truth.saved_cloud', 'Contraste real registrado en AuditLedger.'),
            });
        } catch (err) {
            setGtHitlOpen(false);
            setGtFeedback({
                type: 'err',
                text: err instanceof Error ? err.message : t('hitl.save_error', 'Error guardando HITL.'),
            });
        } finally {
            setGtSaving(false);
        }
    };

    const handleRecomputeLoocv = async () => {
        if (recomputing) return;
        setRecomputing(true);
        setLoocvFeedback(null);
        void triggerFieldImpact('MEDIUM');
        try {
            const created = await recomputeCalibrationProfile({
                tenantId: effectiveTenantId,
                deviceModel: activeCal?.deviceModel,
            });
            setProfiles((prev) => [created, ...prev.filter((p) => p.profileId !== created.profileId)]);
            await triggerFieldNotification('SUCCESS');
        } catch (err) {
            await triggerFieldNotification('ERROR');
            setLoocvFeedback({
                type: 'err',
                text:
                    err instanceof Error
                        ? err.message
                        : t('calibration.error_generic', 'Error ejecutando calibración.'),
            });
        } finally {
            setRecomputing(false);
        }
    };

    const handleActivateProfileHitl = async () => {
        if (!activatingProfile || activatingBusy) return;
        setActivatingBusy(true);
        setLoocvFeedback(null);
        try {
            const activated = await activateCalibrationProfileHitl({
                tenantId: effectiveTenantId,
                profileId: activatingProfile.profileId,
                hitlConfirmation: 'ACTUALIZAR',
            });
            setProfiles((prev) =>
                prev.map((p) => {
                    if (p.profileId === activated.profileId) return activated;
                    if (p.deviceModel === activated.deviceModel && p.status === 'ACTIVE') {
                        return { ...p, status: 'SUPERSEDED' };
                    }
                    return p;
                })
            );
            setActivatingProfile(null);
            setLoocvFeedback({
                type: 'ok',
                text: t(
                    'calibration.loocv_activated_ok',
                    'Perfil de calibración activado en AuditLedger.'
                ),
            });
        } catch (err) {
            setActivatingProfile(null);
            setLoocvFeedback({
                type: 'err',
                text: err instanceof Error ? err.message : t('hitl.save_error', 'Error guardando HITL.'),
            });
        } finally {
            setActivatingBusy(false);
        }
    };

    const calValid = isCalibrationValid(activeCal);
    const remainingDays = calibrationRemainingDays(activeCal);

    const tabs: Array<{ id: MobileCalibrationTab; icon: string; label: string }> = [
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
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col overflow-hidden select-none rounded-none shadow-none font-atkinson">
            {/* Cabecera única contextual 56px (MBUX Zero-Layer) con 3 tabs Icon-First */}
            <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-1 min-w-0">
                    {onBack && (
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('LIGHT');
                                onBack();
                            }}
                            aria-label={t('common.back_button', 'VOLVER')}
                            title={t('common.back_button', 'VOLVER')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                        </button>
                    )}
                    <div
                        role="tablist"
                        aria-label={t('calibration.mobile_header', 'CALIBRACIÓN')}
                        className="flex items-center gap-1"
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
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        setActiveTab(tab.id);
                                    }}
                                    className={`min-w-[48px] min-h-[48px] bg-transparent border-0 border-b-2 outline-none flex items-center justify-center cursor-pointer rounded-none transition-colors ${
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
                </div>

                {connectivitySlot}
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+21px)]">
                {/* TAB 1: HUINCHA AR 2.00 m */}
                {activeTab === 'TAPE' && (
                    <>
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
                                                activeCal.syncedToCloud
                                                    ? 'text-[#00AEEF]'
                                                    : 'text-[#C68346]'
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
                                    aria-label={t(
                                        'calibration.start_action',
                                        'CALIBRAR HUINCHA 2.00 m'
                                    )}
                                    title={t('calibration.start_action', 'CALIBRAR HUINCHA 2.00 m')}
                                    className="w-full min-h-[64px] px-fib-21 bg-[#C68346] disabled:opacity-40 text-[#000000] border-0 font-mono text-[18px] font-bold uppercase tabular-nums flex items-center justify-center gap-fib-13 cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                                >
                                    <span
                                        className="material-symbols-outlined text-[28px]"
                                        aria-hidden="true"
                                    >
                                        compass_calibration
                                    </span>
                                    <span>2.00 m</span>
                                </button>
                                {!isNative && (
                                    <div className="mt-fib-8 font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t(
                                            'calibration.native_only',
                                            '[SOLO DISPOSITIVO NATIVO ARCORE]'
                                        )}
                                    </div>
                                )}
                                {errorMessage && (
                                    <div className="mt-fib-8 font-mono text-data-dense text-[#C68346]">
                                        {errorMessage}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                                {t('calibration.history_title', 'HISTORIAL AUDITABLE')} (
                                {history.length})
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    void triggerFieldImpact('LIGHT');
                                    void loadHistory();
                                }}
                                disabled={loadingHistory}
                                aria-label={t('common.refresh', 'REFRESCAR')}
                                className="bg-transparent border-0 outline-none p-2 min-w-[48px] min-h-[48px] flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
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
                                                        item.referenceDistanceM /
                                                            (item.scaleFactor || 1)
                                                    ).toFixed(2)}
                                                    m · RMS {((item.planeNoiseRmsM ?? 0) * 1000).toFixed(1)}
                                                    mm
                                                </span>
                                                <span
                                                    className={
                                                        synced ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                                    }
                                                >
                                                    {synced ? 'CLOUD' : 'OFFLINE'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </>
                )}

                {/* TAB 2: MEDICIONES REALES & DESVIACIONES Δ% */}
                {activeTab === 'GROUND_TRUTH' && (
                    <div className="font-mono tabular-nums">
                        {loadingGt && (
                            <M3LinearProgress
                                indeterminate
                                ariaLabel={t('common.loading', 'CARGANDO...')}
                            />
                        )}

                        <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-3 gap-fib-8">
                            <div>
                                <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('ground_truth.kpi_count', 'CONTRASTES')}
                                </div>
                                <div className="text-h1-header font-bold">{gtSummary.count}</div>
                            </div>
                            <div>
                                <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('ground_truth.kpi_mape', 'MAPE')}
                                </div>
                                <div
                                    className={`text-h1-header font-bold ${
                                        gtSummary.mapePct !== null && gtSummary.mapePct > 8
                                            ? 'text-[#C68346]'
                                            : 'text-[#00AEEF]'
                                    }`}
                                >
                                    {gtSummary.mapePct !== null
                                        ? `${gtSummary.mapePct.toFixed(1)}%`
                                        : '--'}
                                </div>
                            </div>
                            <div>
                                <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('ground_truth.kpi_alerts', 'ALERTAS > 8%')}
                                </div>
                                <div
                                    className={`text-h1-header font-bold ${
                                        gtSummary.alertCount > 0
                                            ? 'text-[#C68346]'
                                            : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                    }`}
                                >
                                    {gtSummary.alertCount}
                                </div>
                            </div>
                        </div>

                        {gtFeedback && (
                            <div
                                role="status"
                                className={`px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] text-data-dense ${
                                    gtFeedback.type === 'ok'
                                        ? 'border-l-[#00AEEF] text-[#00AEEF]'
                                        : 'border-l-[#C68346] text-[#C68346]'
                                }`}
                            >
                                {gtFeedback.text}
                            </div>
                        )}

                        {selectedMeas && selectedEstimated && (
                            <form
                                autoComplete="off"
                                spellCheck={false}
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!hasAnyReal) {
                                        setGtFeedback({
                                            type: 'err',
                                            text: t(
                                                'ground_truth.require_one_measure',
                                                'Ingrese al menos una medida real (> 0).'
                                            ),
                                        });
                                        return;
                                    }
                                    setGtFeedback(null);
                                    setGtHitlOpen(true);
                                }}
                                className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] border-l-[#C68346] space-y-fib-13"
                            >
                                <div className="flex items-center justify-between gap-fib-8">
                                    <span className="text-microcopy font-bold uppercase text-[#C68346] truncate">
                                        {selectedAsset?.name || selectedMeas.assetId} ·{' '}
                                        {formatStockpileVolumeM3(selectedMeas.volumen_m3)} m³
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedMeas(null)}
                                        aria-label={t('common.close_button', 'CERRAR')}
                                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] flex items-center justify-center cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">
                                            close
                                        </span>
                                    </button>
                                </div>

                                {[
                                    {
                                        id: 'mc-gt-h',
                                        label: t('ground_truth.field_height', 'ALTURA H (m)'),
                                        app:
                                            selectedEstimated.heightM !== undefined
                                                ? `${selectedEstimated.heightM.toFixed(2)}m`
                                                : '--',
                                        val: gtHeight,
                                        set: setGtHeight,
                                        delta: liveDeviations?.deltaHeightPct,
                                        unit: '%',
                                    },
                                    {
                                        id: 'mc-gt-l',
                                        label: t('ground_truth.field_length', 'LARGO L (m)'),
                                        app:
                                            selectedEstimated.baseLengthM !== undefined
                                                ? `${selectedEstimated.baseLengthM.toFixed(2)}m`
                                                : '--',
                                        val: gtLength,
                                        set: setGtLength,
                                        delta: liveDeviations?.deltaLengthPct,
                                        unit: '%',
                                    },
                                    {
                                        id: 'mc-gt-w',
                                        label: t('ground_truth.field_width', 'ANCHO A (m)'),
                                        app:
                                            selectedEstimated.baseWidthM !== undefined
                                                ? `${selectedEstimated.baseWidthM.toFixed(2)}m`
                                                : '--',
                                        val: gtWidth,
                                        set: setGtWidth,
                                        delta: liveDeviations?.deltaWidthPct,
                                        unit: '%',
                                    },
                                    {
                                        id: 'mc-gt-d',
                                        label: t('ground_truth.field_diameter', 'DIÁMETRO Ø (m)'),
                                        app:
                                            selectedEstimated.diameterM !== undefined
                                                ? `${selectedEstimated.diameterM.toFixed(2)}m`
                                                : '--',
                                        val: gtDiameter,
                                        set: setGtDiameter,
                                        delta: liveDeviations?.deltaDiameterPct,
                                        unit: '%',
                                    },
                                    {
                                        id: 'mc-gt-v',
                                        label: t('ground_truth.field_volume', 'VOLUMEN V (m³)'),
                                        app:
                                            selectedEstimated.volumeM3 !== undefined
                                                ? formatStockpileVolumeM3(selectedEstimated.volumeM3)
                                                : '--',
                                        val: gtVolume,
                                        set: setGtVolume,
                                        delta: liveDeviations?.deltaVolumePct,
                                        unit: '%',
                                    },
                                    {
                                        id: 'mc-gt-s',
                                        label: t('ground_truth.field_slope', 'TALUD α (°)'),
                                        app:
                                            selectedEstimated.slopeAngleDeg !== undefined
                                                ? `${selectedEstimated.slopeAngleDeg.toFixed(1)}°`
                                                : '--',
                                        val: gtSlope,
                                        set: setGtSlope,
                                        delta: liveDeviations?.deltaSlopeDeg,
                                        unit: '°',
                                    },
                                ].map((f) => (
                                    <div
                                        key={f.id}
                                        className="grid grid-cols-[1.1fr_0.8fr_1fr_0.8fr] gap-fib-8 items-center"
                                    >
                                        <label
                                            htmlFor={f.id}
                                            className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate"
                                        >
                                            {f.label}
                                        </label>
                                        <span className="text-data-dense">{f.app}</span>
                                        <input
                                            id={f.id}
                                            type="number"
                                            inputMode="decimal"
                                            step="any"
                                            min="0"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={f.val}
                                            onChange={(e) => f.set(e.target.value)}
                                            placeholder="0.00"
                                            className="h-[44px] w-full px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense rounded-none shadow-none select-text focus:outline-none focus:border-[#00AEEF]"
                                        />
                                        <span
                                            className={`text-data-dense font-bold text-right ${
                                                f.delta === undefined
                                                    ? 'text-[#94A3B8] dark:text-[#5A6072]'
                                                    : Math.abs(f.delta) > 8
                                                      ? 'text-[#C68346]'
                                                      : 'text-[#00AEEF]'
                                            }`}
                                        >
                                            {f.delta !== undefined
                                                ? `${f.delta > 0 ? '+' : ''}${f.delta.toFixed(1)}${f.unit}`
                                                : '--'}
                                        </span>
                                    </div>
                                ))}

                                <select
                                    aria-label={t(
                                        'ground_truth.method_label',
                                        'MÉTODO DE REFERENCIA'
                                    )}
                                    value={gtMethod}
                                    onChange={(e) =>
                                        setGtMethod(e.target.value as GroundTruthReferenceMethod)
                                    }
                                    className="h-[48px] w-full px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense rounded-none shadow-none"
                                >
                                    {REFERENCE_METHODS.map((m) => (
                                        <option key={m} value={m}>
                                            {t(`ground_truth.method_${m}`, m)}
                                        </option>
                                    ))}
                                </select>

                                <input
                                    type="text"
                                    maxLength={300}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={gtNotes}
                                    onChange={(e) => setGtNotes(e.target.value)}
                                    placeholder={t(
                                        'ground_truth.notes_placeholder',
                                        'Ej: Probeta verificada con huincha'
                                    )}
                                    className="h-[48px] w-full px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense rounded-none shadow-none select-text"
                                />

                                <button
                                    type="submit"
                                    disabled={gtSaving}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#C68346] text-[#000000] border-0 font-mono text-data-dense font-bold uppercase flex items-center justify-center gap-fib-8 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                                >
                                    <span className="material-symbols-outlined text-[20px]">
                                        fact_check
                                    </span>
                                    <span>
                                        {t('ground_truth.save_hitl_action', 'CONFIRMAR CONTRASTE')}
                                    </span>
                                </button>
                            </form>
                        )}

                        <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between">
                            <span className="text-microcopy font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                                {t('ground_truth.measurements_title', 'MEDICIONES PARA CONTRASTE')}{' '}
                                ({effectiveMeasurements.length})
                            </span>
                            <button
                                type="button"
                                onClick={() => void loadGroundTruthData()}
                                disabled={loadingGt}
                                aria-label={t('common.refresh', 'REFRESCAR')}
                                className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] flex items-center justify-center cursor-pointer rounded-none"
                            >
                                <span className="material-symbols-outlined text-[20px]">refresh</span>
                            </button>
                        </div>

                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {effectiveMeasurements.slice(0, 15).map((m) => {
                                const assetName = assetsById.get(m.assetId)?.name || m.assetId;
                                const latestGt = gtRecords.find((r) => r.measurementId === m.id);
                                const barClass = !latestGt
                                    ? 'border-l-transparent'
                                    : latestGt.deviations.statusBand === 'ALERT'
                                      ? 'border-l-[#C68346]'
                                      : 'border-l-[#00AEEF]';
                                return (
                                    <div
                                        key={m.id}
                                        className={`px-fib-21 py-fib-13 border-l-[3px] ${barClass} flex items-center justify-between gap-fib-8`}
                                    >
                                        <div className="min-w-0">
                                            <div className="text-data-dense font-bold truncate">
                                                {assetName} · {formatStockpileVolumeM3(m.volumen_m3)}{' '}
                                                m³
                                            </div>
                                            <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                {formatCalTimestamp(m.timestamp)}
                                                {latestGt && (
                                                    <span
                                                        className={`ml-2 font-bold ${
                                                            latestGt.deviations.statusBand === 'ALERT'
                                                                ? 'text-[#C68346]'
                                                                : 'text-[#00AEEF]'
                                                        }`}
                                                    >
                                                        Δ {latestGt.deviations.maxAbsDeltaPct.toFixed(1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void triggerFieldImpact('LIGHT');
                                                setSelectedMeas(m);
                                                setGtFeedback(null);
                                            }}
                                            aria-label={t(
                                                'ground_truth.edit_mode',
                                                'INGRESO MEDIDAS REALES'
                                            )}
                                            title={t(
                                                'ground_truth.edit_mode',
                                                'INGRESO MEDIDAS REALES'
                                            )}
                                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">
                                                edit
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="px-fib-21 py-fib-13 border-t border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                            {t('ground_truth.contrasts_title', 'HISTORIAL DE DESVIACIONES')} (
                            {gtRecords.length})
                        </div>

                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {gtRecords.length === 0 ? (
                                <div className="p-fib-21 text-data-dense text-[#5A6072] dark:text-[#94A3B8]">
                                    {t(
                                        'ground_truth.empty_list',
                                        '[Sin contrastes reales registrados]'
                                    )}
                                </div>
                            ) : (
                                gtRecords.map((rec) => {
                                    const isAlert = rec.deviations.statusBand === 'ALERT';
                                    return (
                                        <div
                                            key={rec.id}
                                            className={`px-fib-21 py-fib-13 border-l-[3px] ${
                                                isAlert ? 'border-l-[#C68346]' : 'border-l-[#00AEEF]'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-fib-8 text-data-dense">
                                                <span className="font-bold truncate">
                                                    {rec.assetName || rec.assetId}
                                                </span>
                                                <span
                                                    className={`font-bold ${
                                                        isAlert ? 'text-[#C68346]' : 'text-[#00AEEF]'
                                                    }`}
                                                >
                                                    MAX Δ {rec.deviations.maxAbsDeltaPct.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="mt-1 flex items-center justify-between gap-fib-8 text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                <span>
                                                    {t(
                                                        `ground_truth.method_${rec.referenceMethod}`,
                                                        rec.referenceMethod
                                                    )}{' '}
                                                    · {formatCalTimestamp(rec.createdAt)}
                                                </span>
                                                <span
                                                    className={
                                                        rec.syncedToCloud === false
                                                            ? 'text-[#C68346]'
                                                            : 'text-[#00AEEF]'
                                                    }
                                                >
                                                    {rec.syncedToCloud === false ? 'OFFLINE' : 'CLOUD'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}

                {/* TAB 3: CALIBRACIÓN DETERMINISTA LOOCV + DIAGNÓSTICO IA SOBERANO */}
                {activeTab === 'LOOCV_AI' && (
                    <div className="font-mono tabular-nums">
                        <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-microcopy font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                                    {t('calibration.loocv_title', 'CALIBRACIÓN DETERMINISTA LOOCV')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void loadProfiles()}
                                    disabled={loadingProfiles}
                                    aria-label={t('common.refresh', 'REFRESCAR')}
                                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] flex items-center justify-center cursor-pointer rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[20px]">
                                        refresh
                                    </span>
                                </button>
                            </div>

                            {(recomputing || loadingProfiles) && (
                                <M3LinearProgress
                                    indeterminate
                                    ariaLabel={t('calibration.loocv_recomputing', 'EJECUTANDO LOOCV...')}
                                />
                            )}

                            <button
                                type="button"
                                onClick={() => void handleRecomputeLoocv()}
                                disabled={recomputing}
                                aria-label={t('calibration.loocv_recompute', 'RECOMPUTAR LOOCV + IA')}
                                className="w-full min-h-[56px] px-fib-21 bg-[#C68346] text-[#000000] border-0 font-mono text-data-dense font-bold uppercase flex items-center justify-center gap-fib-8 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[24px]" aria-hidden="true">
                                    psychology
                                </span>
                                <span>
                                    {recomputing
                                        ? t('calibration.loocv_recomputing', 'EJECUTANDO LOOCV...')
                                        : t('calibration.loocv_recompute', 'RECOMPUTAR LOOCV + IA')}
                                </span>
                            </button>

                            {loocvFeedback && (
                                <div
                                    role="status"
                                    className={`text-data-dense ${
                                        loocvFeedback.type === 'ok'
                                            ? 'text-[#00AEEF]'
                                            : 'text-[#C68346]'
                                    }`}
                                >
                                    {loocvFeedback.text}
                                </div>
                            )}
                        </div>

                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {!loadingProfiles && profiles.length === 0 ? (
                                <div className="p-fib-21 text-data-dense text-[#5A6072] dark:text-[#94A3B8]">
                                    {t('calibration.loocv_empty', '[Sin perfiles LOOCV generados]')}
                                </div>
                            ) : (
                                profiles.map((prof) => {
                                    const isActive = prof.status === 'ACTIVE';
                                    const isDraft = prof.status === 'DRAFT';
                                    const borderColor = isActive
                                        ? 'border-l-[#00AEEF]'
                                        : isDraft && prof.loocvMetrics.improved
                                          ? 'border-l-[#C68346]'
                                          : 'border-l-transparent';

                                    return (
                                        <div
                                            key={prof.profileId}
                                            className={`p-fib-21 border-l-[3px] ${borderColor} space-y-fib-13`}
                                        >
                                            <div className="flex items-center justify-between gap-fib-8">
                                                <span className="text-data-dense font-bold truncate">
                                                    {prof.deviceModel}
                                                </span>
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

                                            <div className="grid grid-cols-3 gap-fib-8 text-data-dense">
                                                <div>
                                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        V / H / B
                                                    </div>
                                                    <div className="font-bold">
                                                        ×{prof.volumeScaleFactor.toFixed(3)} / ×
                                                        {prof.heightScaleFactor.toFixed(3)} / ×
                                                        {prof.baseScaleFactor.toFixed(3)}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        MAPE
                                                    </div>
                                                    <div
                                                        className={`font-bold ${
                                                            prof.loocvMetrics.improved
                                                                ? 'text-[#00AEEF]'
                                                                : 'text-[#C68346]'
                                                        }`}
                                                    >
                                                        {prof.loocvMetrics.rawMapePct.toFixed(1)}% ➔{' '}
                                                        {prof.loocvMetrics.calibratedMapePct.toFixed(1)}%
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        N · RMSE
                                                    </div>
                                                    <div>
                                                        {prof.sampleCount} ·{' '}
                                                        {prof.loocvMetrics.rmsePct.toFixed(1)}%
                                                    </div>
                                                </div>
                                            </div>

                                            {prof.aiDiagnosis && (
                                                <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-1">
                                                    <div className="text-microcopy font-bold uppercase text-[#00AEEF]">
                                                        {t(
                                                            'calibration.ai_diagnosis_title',
                                                            'DIAGNÓSTICO IA SOBERANO'
                                                        )}{' '}
                                                        ·{' '}
                                                        {t(
                                                            `calibration.ai_action_${prof.aiDiagnosis.recommendedAction}`,
                                                            prof.aiDiagnosis.recommendedAction
                                                        )}
                                                    </div>
                                                    <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] font-atkinson">
                                                        {prof.aiDiagnosis.summary}
                                                    </p>
                                                </div>
                                            )}

                                            {isDraft && (
                                                <div className="pt-1">
                                                    {prof.loocvMetrics.improved ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setActivatingProfile(prof)}
                                                            className="w-full min-h-[48px] px-fib-13 bg-[#C68346] text-[#000000] border-0 font-mono text-data-dense font-bold uppercase flex items-center justify-center gap-fib-8 cursor-pointer rounded-none shadow-none"
                                                        >
                                                            <span className="material-symbols-outlined text-[20px]">
                                                                fact_check
                                                            </span>
                                                            <span>
                                                                {t(
                                                                    'calibration.loocv_activate_hitl',
                                                                    'ACTIVAR PERFIL (HITL)'
                                                                )}
                                                            </span>
                                                        </button>
                                                    ) : (
                                                        <div className="text-microcopy uppercase text-[#C68346]">
                                                            {t(
                                                                'calibration.loocv_not_improved',
                                                                'SIN MEJORA OUT-OF-SAMPLE'
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Modal HITL para contraste Ground-Truth */}
            <HitlConfirmModal
                open={gtHitlOpen}
                title={t('ground_truth.hitl_title', 'REGISTRAR MEDIDAS REALES (HITL)')}
                description={t(
                    'ground_truth.hitl_desc',
                    'Registra el contraste real sin alterar el volumen comercial. Escriba ACTUALIZAR para confirmar.'
                )}
                keyword="ACTUALIZAR"
                comparisonDiff={
                    [
                        realInputs.realVolumeM3 !== undefined
                            ? {
                                  field: 'V (m³)',
                                  current: `${selectedEstimated?.volumeM3 !== undefined ? formatStockpileVolumeM3(selectedEstimated.volumeM3) : '--'} m³`,
                                  suggested: `${formatStockpileVolumeM3(realInputs.realVolumeM3)} m³`,
                              }
                            : null,
                        realInputs.realHeightM !== undefined
                            ? {
                                  field: 'H (m)',
                                  current: `${selectedEstimated?.heightM?.toFixed(2) ?? '--'} m`,
                                  suggested: `${realInputs.realHeightM.toFixed(2)} m`,
                              }
                            : null,
                        realInputs.realDiameterM !== undefined
                            ? {
                                  field: 'Ø (m)',
                                  current: `${selectedEstimated?.diameterM?.toFixed(2) ?? '--'} m`,
                                  suggested: `${realInputs.realDiameterM.toFixed(2)} m`,
                              }
                            : null,
                    ].filter((x): x is HitlComparisonDiffItem => x !== null)
                }
                loading={gtSaving}
                onConfirm={() => void handleConfirmGroundTruthHitl()}
                onCancel={() => setGtHitlOpen(false)}
            />

            {/* Modal HITL para activación de perfil LOOCV DRAFT -> ACTIVE */}
            <HitlConfirmModal
                open={Boolean(activatingProfile)}
                title={t('calibration.loocv_activate_title', 'ACTIVAR PERFIL CALIBRACIÓN (HITL)')}
                description={t(
                    'calibration.loocv_activate_desc',
                    'Promueve el perfil DRAFT a ACTIVE y archiva el anterior como SUPERSEDED. Escriba ACTUALIZAR para confirmar.'
                )}
                keyword="ACTUALIZAR"
                comparisonDiff={
                    activatingProfile
                        ? [
                              {
                                  field: 'status',
                                  current: 'DRAFT',
                                  suggested: 'ACTIVE',
                              },
                              {
                                  field: 'volumeScaleFactor',
                                  current: '×1.0000',
                                  suggested: `×${activatingProfile.volumeScaleFactor.toFixed(4)}`,
                              },
                              {
                                  field: 'MAPE LOOCV',
                                  current: `${activatingProfile.loocvMetrics.rawMapePct.toFixed(2)}%`,
                                  suggested: `${activatingProfile.loocvMetrics.calibratedMapePct.toFixed(2)}%`,
                              },
                          ]
                        : []
                }
                loading={activatingBusy}
                onConfirm={() => void handleActivateProfileHitl()}
                onCancel={() => setActivatingProfile(null)}
            />
        </div>
    );
};

export default MobileCalibrationView;
