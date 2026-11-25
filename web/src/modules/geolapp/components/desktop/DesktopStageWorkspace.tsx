import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import CopyButton from '../../../../components/common/CopyButton';
import { SecureImage } from '../../../../components/common/SecureImage';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import { useOptionalTheme } from '../../../../context/ThemeContext';
import { buildCanonicalGeoFix } from '../../../../core/geo/wgs84UtmProjection';
import { computeStockpileMeasurementChain } from '../../core/services/calculation-engine';
import { useResolvedStockpileImage } from '../../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../../core/utils/vectorPdfGenerator';
import type { StockpileAsset, StockpileMeasurement } from '../../core/types/GeolappTypes';
import { StockpileStaticMapCard } from '../StockpileStaticMapCard';
import { StockpileTwin3DLazy } from '../StockpileTwin3DLazy';
import {
    StockpileVisualStage,
    type StockpileVisualMode,
} from '../StockpileVisualStage';
import {
    computeAssetMetallurgySummary,
    formatCasTraceLabel,
    formatSignedDelta,
    resolveCanonicalFix,
} from './desktopHelpers';

type StageTab = 'OVERVIEW' | 'TWIN_3D' | 'LEDGER';

export interface DesktopStageWorkspaceProps {
    asset: StockpileAsset | null;
    measurements: StockpileMeasurement[];
    selectedMeasurementId?: string | null;
    onSelectMeasurement: (m: StockpileMeasurement) => void;
}

const LedgerPhotoPair: React.FC<{ prevUrl?: string | null; currUrl?: string | null }> = ({
    prevUrl,
    currUrl,
}) => {
    const resolvedPrev = useResolvedStockpileImage(prevUrl);
    const resolvedCurr = useResolvedStockpileImage(currUrl);
    return (
        <div className="flex items-center gap-1">
            <div className="w-9 h-9 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center overflow-hidden rounded-none">
                {resolvedPrev ? (
                    <SecureImage src={resolvedPrev} alt="Prev" className="w-full h-full object-cover" />
                ) : (
                    <span className="material-symbols-outlined text-[14px] text-[#94A3B8] dark:text-[#5A6072]">
                        first_page
                    </span>
                )}
            </div>
            <span className="material-symbols-outlined text-[14px] text-[#94A3B8] dark:text-[#5A6072]">
                arrow_forward
            </span>
            <div className="w-9 h-9 border border-[#C68346]/60 bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center overflow-hidden rounded-none">
                {resolvedCurr ? (
                    <SecureImage src={resolvedCurr} alt="Curr" className="w-full h-full object-cover" />
                ) : (
                    <span className="material-symbols-outlined text-[14px] text-[#94A3B8] dark:text-[#5A6072]">
                        landscape
                    </span>
                )}
            </div>
        </div>
    );
};

const formatCampaignDepthMode = (depthMode?: string | null): string | null => {
    if (typeof depthMode !== 'string') return null;
    const norm = depthMode.trim().toUpperCase();
    if (!norm) return null;
    if (norm === 'RAW_DEPTH_ONLY') return 'ARCORE RAW DEPTH';
    if (norm === 'AUTOMATIC') return 'ARCORE DEPTH';
    if (norm === 'VIO_POINTCLOUD') return 'ARCORE VIO';
    if (norm === 'VIO_ORB_MVS' || norm === 'DISABLED') return 'VIO · MVS';
    return depthMode.trim();
};

const CampaignComparisonPanel: React.FC<{
    measurement: StockpileMeasurement;
    asset: StockpileAsset;
    onOpen3D: () => void;
    onClose: () => void;
}> = ({ measurement, asset, onOpen3D, onClose }) => {
    const { t } = useTranslation();
    const resolvedPrev = useResolvedStockpileImage(measurement.previous_photo_url);
    const resolvedCurr = useResolvedStockpileImage(measurement.photo_url);

    const deltaVolStr = formatSignedDelta(
        measurement.delta_volumen,
        measurement.delta_volumen_pct
    );
    const hasRealWeight =
        typeof measurement.density_factor === 'number' &&
        Number.isFinite(measurement.density_factor) &&
        measurement.density_factor > 0 &&
        typeof measurement.peso_t === 'number' &&
        Number.isFinite(measurement.peso_t) &&
        measurement.peso_t > 0;
    const deltaPesoStr =
        hasRealWeight &&
        typeof measurement.delta_peso === 'number' &&
        Number.isFinite(measurement.delta_peso)
            ? `${measurement.delta_peso > 0 ? '+' : ''}${measurement.delta_peso.toLocaleString(
                undefined,
                { maximumFractionDigits: 1 }
            )} t`
            : null;
    const casStr = formatCasTraceLabel(
        measurement.cas_original_bytes,
        measurement.cas_optimized_bytes,
        measurement.cas_savings_pct
    );
    const depthModeStr = formatCampaignDepthMode(measurement.depth_mode);

    const imuParts = [
        typeof measurement.imu_pitch_deg === 'number'
            ? `${measurement.imu_pitch_deg.toFixed(1)}°`
            : null,
        typeof measurement.imu_height_m === 'number'
            ? `H ${measurement.imu_height_m.toFixed(2)} m`
            : null,
        typeof measurement.imu_distance_m === 'number'
            ? `D ${measurement.imu_distance_m.toFixed(2)} m`
            : null,
    ].filter((val): val is string => Boolean(val));

    const measGeoFix = useMemo(() => {
        const lat = measurement.location_metadata?.lat ?? asset.geo_point?.latitude ?? asset.location?.lat;
        const lng = measurement.location_metadata?.lng ?? asset.geo_point?.longitude ?? asset.location?.lng;
        if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            (lat === 0 && lng === 0)
        ) {
            return null;
        }
        try {
            return buildCanonicalGeoFix({
                lat,
                lng,
                altitudeM: asset.geo_point?.altitude ?? null,
                accuracyM: measurement.location_metadata?.accuracy ?? asset.geo_point?.accuracy ?? null,
                source: 'CAPACITOR_GNSS',
            });
        } catch {
            return null;
        }
    }, [measurement.location_metadata, asset.geo_point, asset.location]);

    const undeclaredLabel = t('core_common.undeclared_tech_value', UNDECLARED_TECH_VALUE);

    return (
        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
            <header className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="min-w-0">
                    <span className="block text-microcopy font-mono font-bold uppercase text-[#C68346]">
                        {t('desktop.campaign_comparison', 'TELEMETRÍA DE CAMPAÑA')}
                    </span>
                    <span className="block text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                        {new Date(measurement.timestamp).toLocaleString()} ·{' '}
                        <span className="uppercase text-[#00AEEF]">{measurement.method}</span>
                        {measurement.geometry?.type ? ` · ${measurement.geometry.type}` : ''}
                    </span>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={onOpen3D}
                        aria-label={t('desktop.open_in_3d', 'VER EN GEMELO 3D')}
                        title={t('desktop.open_in_3d', 'VER EN GEMELO 3D')}
                        className="bg-transparent border-0 outline-none p-1.5 text-[#00AEEF] hover:text-[#C68346] cursor-pointer flex items-center justify-center rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">deployed_code</span>
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close_button', 'CERRAR')}
                        title={t('common.close_button', 'CERRAR')}
                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </header>

            <div className="p-fib-21 space-y-fib-13">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] rounded-none overflow-hidden">
                        <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('history.previous_photo_label', 'FOTO ANTERIOR')}
                            </span>
                        </div>
                        {resolvedPrev ? (
                            <SecureImage
                                src={resolvedPrev}
                                alt={t('history.previous_photo_alt', 'Foto anterior')}
                                className="w-full h-44 object-cover"
                            />
                        ) : (
                            <div className="h-44 px-fib-13 flex items-center justify-center text-center text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {t(
                                    'history.no_previous_base',
                                    '[Sin captura previa — Medición Base]'
                                )}
                            </div>
                        )}
                    </div>

                    <div className="border border-[#C68346]/60 bg-[#FFFFFF] dark:bg-[#000000] rounded-none overflow-hidden">
                        <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-microcopy font-mono font-bold uppercase text-[#C68346]">
                                {t('history.current_photo_label', 'FOTO ACTUAL')}
                            </span>
                        </div>
                        {resolvedCurr ? (
                            <SecureImage
                                src={resolvedCurr}
                                alt={t('history.current_photo_alt', 'Foto actual')}
                                className="w-full h-44 object-cover"
                            />
                        ) : (
                            <div className="h-44 flex items-center justify-center text-[#94A3B8] dark:text-[#5A6072]">
                                <span className="material-symbols-outlined text-[32px]">
                                    landscape
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums">
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('dossier.volume_label', 'VOLUMEN')}
                        </span>
                        <span className="text-h2-section font-bold text-[#C68346]">
                            {measurement.volumen_m3.toFixed(2)} m³
                        </span>
                        {typeof measurement.uncertainty_pct === 'number' && (
                            <span className="block text-microcopy text-[#00AEEF]">
                                ± {measurement.uncertainty_pct.toFixed(1)}%
                            </span>
                        )}
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('history.delta_volume', 'Δ VOLUMEN')}
                        </span>
                        <span className="block text-data-dense font-bold text-[#00AEEF]">
                            {deltaVolStr || '--'}
                        </span>
                        {deltaPesoStr && (
                            <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {deltaPesoStr}
                            </span>
                        )}
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('dossier.tonnage_label', 'MASA / DENSIDAD')}
                        </span>
                        <span className="block text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                            {hasRealWeight ? `${measurement.peso_t.toFixed(1)} t` : undeclaredLabel}
                        </span>
                        {typeof measurement.density_factor === 'number' &&
                            measurement.density_factor > 0 && (
                                <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                    {measurement.density_factor.toFixed(2)} t/m³
                                </span>
                            )}
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            V_TIN / ESPACIAL
                        </span>
                        <span className="block text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                            {typeof measurement.tin_volume_m3 === 'number'
                                ? `${measurement.tin_volume_m3.toFixed(2)} m³`
                                : undeclaredLabel}
                        </span>
                        {depthModeStr && (
                            <span className="block text-microcopy text-[#00AEEF]">
                                {depthModeStr}
                            </span>
                        )}
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            COB / TOE
                        </span>
                        <span className="block text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                            {typeof measurement.coverage_pct === 'number'
                                ? `${Math.round(measurement.coverage_pct)}%`
                                : '--'}{' '}
                            /{' '}
                            {typeof measurement.toe_score === 'number'
                                ? `${Math.round(measurement.toe_score)}%`
                                : '--'}
                        </span>
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            TALUD / PISO
                        </span>
                        <span
                            className={`block text-data-dense font-bold ${
                                typeof measurement.detected_slope_angle_deg === 'number' &&
                                measurement.detected_slope_angle_deg > 38
                                    ? 'text-[#C68346]'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            }`}
                        >
                            {typeof measurement.detected_slope_angle_deg === 'number'
                                ? `α ${measurement.detected_slope_angle_deg.toFixed(1)}°`
                                : '--'}
                            {typeof measurement.ground_slope_deg === 'number'
                                ? ` · ${measurement.ground_slope_deg.toFixed(1)}°`
                                : ''}
                        </span>
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            IMU
                        </span>
                        <span className="block text-microcopy text-[#0F172A] dark:text-[#F3F4F6]">
                            {imuParts.length > 0 ? imuParts.join(' · ') : undeclaredLabel}
                        </span>
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            CAS
                        </span>
                        <span className="block text-microcopy text-[#0F172A] dark:text-[#F3F4F6] break-words">
                            {casStr || undeclaredLabel}
                        </span>
                    </div>
                </div>

                {(measGeoFix || measurement.mesh_sha256 || measurement.is_closure_measurement) && (
                    <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-1 md:grid-cols-2 gap-fib-8 font-mono text-microcopy tabular-nums">
                        {measGeoFix && (
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                    UTM: {measGeoFix.utm.formatted}
                                </span>
                                <CopyButton value={measGeoFix.utm.formatted} />
                            </div>
                        )}
                        {measurement.mesh_sha256 && (
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-[#475569] dark:text-[#8A93A6] truncate">
                                    SHA-256: {measurement.mesh_sha256.slice(0, 16)}…
                                </span>
                                <CopyButton value={measurement.mesh_sha256} />
                            </div>
                        )}
                        {measurement.is_closure_measurement && (
                            <div className="md:col-span-2 text-[#C68346]">
                                {measurement.closure_reason || 'CLOSED'}
                                {measurement.closure_cause ? ` · ${measurement.closure_cause}` : ''}
                                {measurement.dispatch_reference
                                    ? ` · ${measurement.dispatch_reference}`
                                    : ''}
                                {measurement.closure_origin
                                    ? ` · ${measurement.closure_origin}`
                                    : ''}
                            </div>
                        )}
                        {(typeof measurement.offline_in_situ_m3 === 'number' ||
                            typeof measurement.cloud_refined_m3 === 'number') && (
                            <div className="md:col-span-2 flex flex-wrap items-center gap-fib-13 text-[#475569] dark:text-[#8A93A6]">
                                <span>
                                    IN-SITU:{' '}
                                    {typeof measurement.offline_in_situ_m3 === 'number'
                                        ? `${measurement.offline_in_situ_m3.toFixed(2)} m³`
                                        : '--'}
                                </span>
                                <span>
                                    CLOUD:{' '}
                                    {typeof measurement.cloud_refined_m3 === 'number'
                                        ? `${measurement.cloud_refined_m3.toFixed(2)} m³`
                                        : '--'}
                                </span>
                                {typeof measurement.reconciliation_delta_pct === 'number' && (
                                    <span
                                        className={
                                            Math.abs(measurement.reconciliation_delta_pct) > 8
                                                ? 'text-[#C68346] font-bold'
                                                : 'text-[#00AEEF] font-bold'
                                        }
                                    >
                                        ΔC {measurement.reconciliation_delta_pct > 0 ? '+' : ''}
                                        {measurement.reconciliation_delta_pct.toFixed(1)}%
                                    </span>
                                )}
                                {measurement.reconciliation_status && (
                                    <span className="uppercase">
                                        {measurement.reconciliation_status}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export const DesktopStageWorkspace: React.FC<DesktopStageWorkspaceProps> = ({
    asset,
    measurements,
    selectedMeasurementId,
    onSelectMeasurement,
}) => {
    const { t } = useTranslation();
    const themeCtx = useOptionalTheme();
    const isDark = themeCtx?.theme === 'dark';

    const [stageTab, setStageTab] = useState<StageTab>('OVERVIEW');
    const [visualMode, setVisualMode] = useState<StockpileVisualMode>('DUAL');
    const [ledgerCompareOpen, setLedgerCompareOpen] = useState(false);

    useEffect(() => {
        setStageTab('OVERVIEW');
        setVisualMode('DUAL');
        setLedgerCompareOpen(false);
    }, [asset?.id]);

    const chain = useMemo(
        () => computeStockpileMeasurementChain(measurements, asset?.initial_photo_url),
        [measurements, asset?.initial_photo_url]
    );
    const orderedMeas = chain.enrichedMeasurements;
    const activeMeas = useMemo(
        () => orderedMeas.filter((m) => !m.ignored),
        [orderedMeas]
    );

    const chartData = useMemo(
        () =>
            [...activeMeas]
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((m) => ({
                    date: new Date(m.timestamp).toLocaleDateString(),
                    volumen: Number(m.volumen_m3.toFixed(2)),
                    tonelaje: Number(m.peso_t.toFixed(2)),
                })),
        [activeMeas]
    );

    const canonicalFix = useMemo(() => resolveCanonicalFix(asset), [asset]);

    if (!asset) {
        return (
            <section className="flex-1 flex items-center justify-center p-fib-55 bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="text-center space-y-fib-13">
                    <span className="material-symbols-outlined text-[48px] text-[#94A3B8] dark:text-[#5A6072]">
                        landscape
                    </span>
                    <p className="text-body-main font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('analytics.no_assets', 'Sin acopios registrados')}
                    </p>
                </div>
            </section>
        );
    }

    const summary = computeAssetMetallurgySummary(asset);
    const isClosed = asset.status === 'CLOSED';
    const deltaLabel = formatSignedDelta(
        chain.summary.lastDeltaVolumenM3 ?? asset.last_delta_volumen_m3,
        chain.summary.lastDeltaVolumenPct ?? asset.last_delta_volumen_pct
    );
    const selectedMeas =
        orderedMeas.find((m) => m.id === selectedMeasurementId) ||
        chain.summary.latestActive ||
        null;

    // Acoplamiento estricto: cuando hay medición seleccionada, nunca contaminar con mesh_url de otra campaña en asset.
    const effMeshUrl = selectedMeas ? (selectedMeas.mesh_url ?? null) : (asset.mesh_url ?? null);
    const effLocalPreviewMesh = selectedMeas
        ? (selectedMeas.local_preview_mesh ?? null)
        : (asset.local_preview_mesh ?? null);
    const effLifecycleStatus =
        selectedMeas?.lifecycle_status ?? asset.lifecycle_status ?? null;
    const effMeshSha256 = selectedMeas ? selectedMeas.mesh_sha256 : asset.mesh_sha256;
    const effMeshSource = selectedMeas ? selectedMeas.mesh_source : asset.mesh_source;
    const effTinVolumeM3 = selectedMeas
        ? (selectedMeas.tin_volume_m3 ?? selectedMeas.offline_in_situ_m3 ?? null)
        : (asset.tin_volume_m3 ?? null);
    const effMeshOrigBytes = selectedMeas
        ? selectedMeas.mesh_original_bytes
        : asset.mesh_original_bytes;
    const effMeshOptBytes = selectedMeas
        ? selectedMeas.mesh_optimized_bytes
        : asset.mesh_optimized_bytes;
    const effMeshSavingsPct = selectedMeas
        ? selectedMeas.mesh_savings_pct
        : asset.mesh_savings_pct;
    const effMeshCas =
        effMeshOrigBytes !== undefined || effMeshOptBytes !== undefined || effMeshSha256
            ? {
                  originalBytes: effMeshOrigBytes,
                  optimizedBytes: effMeshOptBytes,
                  savingsPct: effMeshSavingsPct,
                  sha256: effMeshSha256,
              }
            : undefined;

    const effUncertaintyPct = selectedMeas
        ? (selectedMeas.uncertainty_pct ?? null)
        : (asset.uncertainty_pct ?? null);
    const effToeScore = selectedMeas ? (selectedMeas.toe_score ?? null) : (asset.toe_score ?? null);
    const effCoveragePct = selectedMeas
        ? (selectedMeas.coverage_pct ?? null)
        : (asset.coverage_pct ?? null);
    const effDepthMode = selectedMeas
        ? (selectedMeas.depth_mode ?? null)
        : (asset.depth_mode ?? null);
    const effReconciliationDeltaPct = selectedMeas
        ? (selectedMeas.reconciliation_delta_pct ?? null)
        : (asset.reconciliation_delta_pct ?? null);

    const stagePhotoUrl =
        selectedMeas?.photo_url ||
        chain.summary.lastPhotoUrl ||
        asset.last_photo_url ||
        asset.initial_photo_url ||
        asset.thumbnail_url ||
        null;

    return (
        <section className="h-full min-h-0 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] overflow-hidden rounded-none shadow-none">
            {/* Asset Header & Primary Actions */}
            <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13">
                <div className="min-w-0">
                    <div className="flex items-center gap-fib-8">
                        <h2 className="text-h1-header font-bold uppercase truncate">
                            {asset.name}
                        </h2>
                        <span
                            className={`text-microcopy font-mono font-bold uppercase ${isClosed ? 'text-[#C68346]' : 'text-[#00AEEF]'
                                }`}
                        >
                            {isClosed
                                ? t('lifecycle.filter_closed', 'CERRADO')
                                : t('lifecycle.active', 'ACTIVO')}
                        </span>
                    </div>
                    <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] truncate">
                        {asset.copper_domain
                            ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
                            : UNDECLARED_TECH_VALUE}
                        {asset.location_ref ? ` · ${asset.location_ref}` : ''}
                    </p>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={() => void downloadGeolappVectorPdf(asset, orderedMeas)}
                        title={t('pdf.export_button', 'Exportar PDF')}
                        aria-label={t('pdf.export_button', 'Exportar PDF')}
                        className="bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] cursor-pointer rounded-none flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[20px]">
                            picture_as_pdf
                        </span>
                    </button>
                </div>
            </header>

            {/* Stage Tabs */}
            <nav className="shrink-0 flex items-center gap-fib-21 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                {(
                    [
                        {
                            id: 'OVERVIEW' as const,
                            icon: 'monitoring',
                            label: t('desktop.stage_overview', 'RESUMEN Y EVOLUCIÓN'),
                        },
                        {
                            id: 'TWIN_3D' as const,
                            icon: 'deployed_code',
                            label: t('twin3d.title', 'GEMELO 3D / VISUAL'),
                        },
                        {
                            id: 'LEDGER' as const,
                            icon: 'history',
                            label: t('analytics.history_title', 'HISTORIAL DE CAMPAÑAS'),
                        },
                    ] as const
                ).map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setStageTab(tab.id)}
                        aria-label={tab.label}
                        title={tab.label}
                        className={`py-fib-13 px-2 inline-flex items-center justify-center border-0 border-b-2 bg-transparent cursor-pointer rounded-none transition-colors ${
                            stageTab === tab.id
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                            {tab.icon}
                        </span>
                    </button>
                ))}
            </nav>

            {/* Stage Body */}
            <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                {stageTab === 'OVERVIEW' && (
                    <>
                        {/* 3 Protagonist KPI Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                            <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    {t('dossier.volume_label', 'VOLUMEN ACTUAL')}
                                </span>
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                                    {summary.volumeM3.toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                    })}{' '}
                                    <span className="text-h2-section">m³</span>
                                </span>
                            </div>

                            <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    {t('dossier.tonnage_label', 'TONELAJE ESTIMADO')}
                                </span>
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {summary.weightT > 0
                                        ? summary.weightT.toLocaleString(undefined, {
                                            maximumFractionDigits: 1,
                                        })
                                        : '--'}
                                    <span className="text-h2-section ml-1">t</span>
                                </span>
                            </div>

                            <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    {t('history.delta_volume', 'VARIACIÓN CAMPAÑA')}
                                </span>
                                <span className="text-h1-header font-mono font-bold tabular-nums text-[#00AEEF]">
                                    {deltaLabel || '--'}
                                </span>
                            </div>
                        </div>

                        {/* Escenario Visual Unificado: Foto Real / Malla 3D / Dual */}
                        <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <StockpileVisualStage
                                photoUrl={stagePhotoUrl}
                                perimeterPhotoUrls={
                                    selectedMeas?.perimeter_photo_urls ??
                                    asset.perimeter_photo_urls ??
                                    []
                                }
                                boulderDetections={
                                    selectedMeas?.boulder_detections ?? asset.boulder_detections
                                }
                                slopeAngleDeg={
                                    selectedMeas?.detected_slope_angle_deg ??
                                    asset.detected_slope_angle_deg ??
                                    null
                                }
                                meshUrl={effMeshUrl}
                                localPreviewMesh={effLocalPreviewMesh}
                                lifecycleStatus={effLifecycleStatus}
                                reconciliationDeltaPct={effReconciliationDeltaPct}
                                copperDomain={asset.copper_domain}
                                tinVolumeM3={effTinVolumeM3}
                                casMetrics={effMeshCas}
                                meshSource={effMeshSource}
                                uncertaintyPct={effUncertaintyPct}
                                toeScore={effToeScore}
                                coveragePct={effCoveragePct}
                                depthMode={effDepthMode}
                                altLabel={asset.name}
                                mapNode={
                                    <StockpileStaticMapCard
                                        asset={asset}
                                        fix={canonicalFix}
                                        heightPx={320}
                                        flat={false}
                                    />
                                }
                                isMobile={false}
                                heightPx={320}
                                canReconstruct3D={false}
                                mode={visualMode}
                                onModeChange={setVisualMode}
                            />
                        </div>

                        {chartData.length > 0 && (
                            <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                                <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] mb-fib-13">
                                    {t(
                                        'analytics.evolution_chart_title',
                                        'EVOLUCIÓN VOLUMEN (m³)'
                                    )}
                                </h3>
                                <div className="h-52 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData}>
                                            <CartesianGrid
                                                strokeDasharray="3 3"
                                                stroke={isDark ? '#12151C' : '#E2E8F0'}
                                            />
                                            <XAxis
                                                dataKey="date"
                                                tick={{
                                                    fill: isDark ? '#8A93A6' : '#475569',
                                                    fontSize: 11,
                                                }}
                                            />
                                            <YAxis
                                                tick={{
                                                    fill: isDark ? '#8A93A6' : '#475569',
                                                    fontSize: 11,
                                                }}
                                            />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: isDark
                                                        ? '#07090D'
                                                        : '#FFFFFF',
                                                    borderColor: isDark ? '#12151C' : '#E2E8F0',
                                                    borderRadius: 0,
                                                    color: isDark ? '#F3F4F6' : '#0F172A',
                                                }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="volumen"
                                                stroke="#C68346"
                                                fill="#C68346"
                                                fillOpacity={0.18}
                                                strokeWidth={2}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {stageTab === 'TWIN_3D' && (
                    <div className="space-y-fib-21">
                        <StockpileTwin3DLazy
                            meshUrl={effMeshUrl}
                            localPreviewMesh={effLocalPreviewMesh}
                            lifecycleStatus={effLifecycleStatus}
                            copperDomain={asset.copper_domain}
                            tinVolumeM3={effTinVolumeM3}
                            meshSource={effMeshSource}
                            casMetrics={effMeshCas}
                            heightPx={380}
                        />
                    </div>
                )}

                {stageTab === 'LEDGER' && (
                    <div className="space-y-fib-21">
                        {ledgerCompareOpen && selectedMeas && (
                            <CampaignComparisonPanel
                                measurement={selectedMeas}
                                asset={asset}
                                onOpen3D={() => {
                                    setStageTab('TWIN_3D');
                                }}
                                onClose={() => setLedgerCompareOpen(false)}
                            />
                        )}
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] overflow-x-auto rounded-none">
                            <table className="w-full text-left font-mono text-data-dense tabular-nums border-collapse">
                                <thead>
                                    <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        <th className="p-fib-13">{t('dossier.col_evidence', 'CAMPAÑA')}</th>
                                        <th className="p-fib-13">{t('dossier.col_date', 'FECHA')}</th>
                                        <th className="p-fib-13 text-right">m³</th>
                                        <th className="p-fib-13 text-right">t</th>
                                        <th className="p-fib-13 text-right">Δ</th>
                                        <th className="p-fib-13">CAS</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {orderedMeas.map((m) => {
                                        const casStr = formatCasTraceLabel(
                                            m.cas_original_bytes,
                                            m.cas_optimized_bytes,
                                            m.cas_savings_pct
                                        );
                                        const dStr = formatSignedDelta(
                                            m.delta_volumen,
                                            m.delta_volumen_pct
                                        );
                                        const hasRowRealWeight =
                                            typeof m.density_factor === 'number' &&
                                            Number.isFinite(m.density_factor) &&
                                            m.density_factor > 0 &&
                                            typeof m.peso_t === 'number' &&
                                            Number.isFinite(m.peso_t) &&
                                            m.peso_t > 0;
                                        const isRowSelected =
                                            ledgerCompareOpen && m.id === selectedMeas?.id;
                                        return (
                                            <tr
                                                key={m.id}
                                                onClick={() => {
                                                    onSelectMeasurement(m);
                                                    setLedgerCompareOpen(true);
                                                }}
                                                className={`cursor-pointer transition-colors hover:bg-[#C68346]/5 ${isRowSelected
                                                    ? 'bg-[#C68346]/10 border-l-2 border-l-[#C68346]'
                                                    : ''
                                                    } ${m.ignored ? 'opacity-50' : ''}`}
                                            >
                                                <td className="p-fib-13">
                                                    <LedgerPhotoPair
                                                        prevUrl={m.previous_photo_url}
                                                        currUrl={m.photo_url}
                                                    />
                                                </td>
                                                <td className="p-fib-13">
                                                    <span className="block text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {new Date(m.timestamp).toLocaleString()}
                                                    </span>
                                                    <span className="text-microcopy uppercase text-[#00AEEF]">
                                                        {m.method}
                                                        {typeof m.uncertainty_pct === 'number'
                                                            ? ` · ±${m.uncertainty_pct.toFixed(1)}%`
                                                            : ''}
                                                    </span>
                                                </td>
                                                <td className="p-fib-13 text-right font-bold">
                                                    {m.volumen_m3.toFixed(2)}
                                                </td>
                                                <td className="p-fib-13 text-right text-[#475569] dark:text-[#8A93A6]">
                                                    {hasRowRealWeight ? m.peso_t.toFixed(1) : '--'}
                                                </td>
                                                <td className="p-fib-13 text-right text-[#00AEEF]">
                                                    {dStr || '--'}
                                                </td>
                                                <td className="p-fib-13 text-microcopy">
                                                    {casStr || '--'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
