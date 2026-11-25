import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { SecureImage } from '../../../components/common/SecureImage';
import { calculationEngine, computeStockpileMeasurementChain } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import { formatStockpileVolumeM3 } from '../core/services/spatialScannerService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { CopperGovernanceBanner } from '../core/utils/captureHelpers';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import type { StockpileAsset, StockpileMeasurement } from '../core/types/GeolappTypes';
import {
    computeAssetMetallurgySummary,
    formatSignedDelta,
    resolveCanonicalFix,
} from './desktop/desktopHelpers';
import { StockpileStaticMapCard } from './StockpileStaticMapCard';
import { StockpileVisualStage, type StockpileVisualMode } from './StockpileVisualStage';

export interface StockpileDossierViewProps {
    asset: StockpileAsset;
    measurements: StockpileMeasurement[];
    onSelectMeasurement: (m: StockpileMeasurement) => void;
    onBack: () => void;
    onNewMeasurement: () => void;
    onOpenClosure?: () => void;
    justCreated?: boolean;
    isMobileField?: boolean;
}

interface SpatialMetrologyFields {
    uncertainty_pct?: number | null;
    toe_score?: number | null;
    coverage_pct?: number | null;
    depth_mode?: string | null;
    ground_slope_deg?: number | null;
}

type PendingHitlAction = { kind: 'REOPEN_CYCLE'; diffs: HitlComparisonDiffItem[] };

const HistoryRowItem: React.FC<{
    measurement: StockpileMeasurement;
    onSelect: (m: StockpileMeasurement) => void;
    onToggleIgnore: (m: StockpileMeasurement) => void;
}> = ({ measurement: m, onSelect, onToggleIgnore }) => {
    const { t } = useTranslation();
    const resolvedCurr = useResolvedStockpileImage(m.photo_url);
    const deltaText = formatSignedDelta(m.delta_volumen, m.delta_volumen_pct);
    const hasRealWeight =
        typeof m.density_factor === 'number' &&
        Number.isFinite(m.density_factor) &&
        m.density_factor > 0 &&
        typeof m.peso_t === 'number' &&
        Number.isFinite(m.peso_t) &&
        m.peso_t > 0;

    const isPending =
        m.analysis_status === 'PENDING_AI_SYNC' || m.analysis_status === 'PENDING_SCALE';
    const isSlopeWarn =
        (typeof m.detected_slope_angle_deg === 'number' && m.detected_slope_angle_deg > 38) ||
        Boolean(m.slope_warning);
    const isAiVerified = !m.ignored && m.analysis_status === 'AI_VERIFIED' && !isSlopeWarn;
    const barClass =
        isPending || isSlopeWarn
            ? 'bg-[#C68346]'
            : isAiVerified
              ? 'bg-[#00AEEF]'
              : 'bg-transparent';

    return (
        <div
            className={`w-full rounded-none shadow-none flex items-stretch justify-between gap-fib-8 border-0 bg-transparent hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] ${
                m.ignored ? 'opacity-50' : ''
            }`}
        >
            <span aria-hidden="true" className={`w-[3px] shrink-0 ${barClass}`} />

            <button
                type="button"
                onClick={() => onSelect(m)}
                className="flex-1 min-w-0 text-left flex items-center justify-between gap-fib-13 bg-transparent border-0 outline-none cursor-pointer py-fib-13 px-0"
            >
                <div className="flex items-center gap-fib-13 min-w-0">
                    <div className="w-10 h-10 flex items-center justify-center overflow-hidden rounded-none bg-transparent border-0 shrink-0">
                        {resolvedCurr ? (
                            <SecureImage
                                src={resolvedCurr}
                                alt={t('history.current_photo_alt', 'Foto actual')}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="material-symbols-outlined text-[16px] text-[#94A3B8] dark:text-[#5A6072]">
                                image_not_supported
                            </span>
                        )}
                    </div>

                    <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-[16px] font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {new Date(m.timestamp).toLocaleDateString()}
                        </span>
                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                            {m.is_closure_measurement
                                ? m.closure_reason || 'CLOSED'
                                : m.geometry?.type
                                  ? t(`geometries.${m.geometry.type}`, String(m.geometry.type))
                                  : m.method}
                        </span>
                    </div>
                </div>

                <div className="text-right font-mono tabular-nums shrink-0">
                    <span className="block text-[18px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                        {formatStockpileVolumeM3(m.volumen_m3)} m³
                    </span>
                    <span
                        className={`block text-microcopy ${
                            typeof m.delta_volumen === 'number' && m.delta_volumen < 0
                                ? 'text-[#C68346]'
                                : 'text-[#00AEEF]'
                        }`}
                    >
                        {deltaText || (hasRealWeight ? `${m.peso_t.toFixed(1)} t` : '--')}
                    </span>
                </div>
            </button>

            <button
                type="button"
                onClick={() => onToggleIgnore(m)}
                aria-label={
                    m.ignored
                        ? t('history.restore_measurement', 'RESTAURAR MEDICIÓN')
                        : t('history.ignore_measurement', 'IGNORAR MEDICIÓN')
                }
                className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-0 text-[#94A3B8] dark:text-[#5A6072] hover:text-[#C68346] cursor-pointer shrink-0 rounded-none px-1"
            >
                <span className="material-symbols-outlined text-[18px]">
                    {m.ignored ? 'visibility' : 'visibility_off'}
                </span>
            </button>
        </div>
    );
};

const MobileEvolutionSvgChart: React.FC<{
    measurements: StockpileMeasurement[];
    onSelectMeasurement: (m: StockpileMeasurement) => void;
}> = ({ measurements, onSelectMeasurement }) => {
    const ordered = useMemo(
        () =>
            [...measurements]
                .filter((m) => !m.ignored && Number.isFinite(m.volumen_m3))
                .sort((a, b) => a.timestamp - b.timestamp),
        [measurements]
    );

    if (ordered.length === 0) {
        return (
            <div className="px-fib-13 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between font-mono text-microcopy tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                <span>VOL · t</span>
                <span>--</span>
            </div>
        );
    }

    const volumes = ordered.map((m) => m.volumen_m3);
    const minVal = Math.min(...volumes);
    const maxVal = Math.max(...volumes);
    const span = maxVal - minVal;

    const width = 320;
    const height = 88;
    const padX = 16;
    const padY = 14;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const points = ordered.map((m, idx) => {
        const x =
            ordered.length === 1
                ? width / 2
                : padX + (idx / (ordered.length - 1)) * innerW;
        const normY = span > 0 ? (m.volumen_m3 - minVal) / span : 0.5;
        const y = padY + (1 - normY) * innerH;
        return { m, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), isLast: idx === ordered.length - 1 };
    });

    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

    return (
        <section className="px-fib-13 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
            <div className="flex items-center justify-between font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                <span>
                    MAX{' '}
                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                        {formatStockpileVolumeM3(maxVal)} m³
                    </strong>
                </span>
                <span>
                    MIN{' '}
                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                        {formatStockpileVolumeM3(minVal)} m³
                    </strong>
                </span>
            </div>

            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-24 block overflow-visible"
                role="img"
                aria-label="Volumen"
            >
                <line
                    x1={padX}
                    y1={padY}
                    x2={width - padX}
                    y2={padY}
                    className="stroke-[#E2E8F0] dark:stroke-[#12151C]"
                    strokeWidth={1}
                />
                <line
                    x1={padX}
                    y1={height / 2}
                    x2={width - padX}
                    y2={height / 2}
                    className="stroke-[#E2E8F0] dark:stroke-[#12151C]"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                />
                <line
                    x1={padX}
                    y1={height - padY}
                    x2={width - padX}
                    y2={height - padY}
                    className="stroke-[#E2E8F0] dark:stroke-[#12151C]"
                    strokeWidth={1}
                />

                {points.length >= 2 && (
                    <polyline
                        fill="none"
                        stroke="#C68346"
                        strokeWidth={2}
                        points={polylinePoints}
                    />
                )}

                {points.map((pt) => (
                    <g
                        key={pt.m.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${new Date(pt.m.timestamp).toLocaleDateString()} · ${formatStockpileVolumeM3(pt.m.volumen_m3)} m³`}
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            onSelectMeasurement(pt.m);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectMeasurement(pt.m);
                            }
                        }}
                        className="cursor-pointer"
                    >
                        <rect
                            x={pt.x - 14}
                            y={pt.y - 14}
                            width={28}
                            height={28}
                            fill="transparent"
                        />
                        <rect
                            x={pt.x - 4}
                            y={pt.y - 4}
                            width={8}
                            height={8}
                            fill={pt.isLast ? '#00AEEF' : '#C68346'}
                        />
                    </g>
                ))}
            </svg>
        </section>
    );
};

export const StockpileDossierView: React.FC<StockpileDossierViewProps> = ({
    asset,
    measurements,
    onSelectMeasurement,
    onBack,
    onNewMeasurement,
    onOpenClosure,
    isMobileField,
}) => {
    const { t } = useTranslation();
    const isMobile = isMobileField ?? Capacitor.isNativePlatform();
    const [visualMode, setVisualMode] = useState<StockpileVisualMode>('PHOTO');
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [isSavingHitl, setIsSavingHitl] = useState(false);
    const [statusText, setStatusText] = useState<string | null>(null);
    const [pendingHitl, setPendingHitl] = useState<PendingHitlAction | null>(null);

    useEffect(() => {
        setVisualMode('PHOTO');
    }, [asset.id]);

    const chain = useMemo(
        () => computeStockpileMeasurementChain(measurements, asset.initial_photo_url),
        [measurements, asset.initial_photo_url]
    );

    const orderedMeasurements = chain.enrichedMeasurements;
    const latestMeas = chain.summary.latestActive ?? orderedMeasurements[0] ?? null;
    const latestHeroPhoto =
        chain.summary.lastPhotoUrl ||
        asset.last_photo_url ||
        asset.initial_photo_url ||
        asset.thumbnail_url;

    // Acoplamiento estricto Foto <-> Malla: jamás mezclar la foto de latestMeas con un GLB viejo de otra medición.
    const latestMeshUrl = latestMeas ? (latestMeas.mesh_url ?? null) : (asset.mesh_url ?? null);
    const latestLocalPreviewMesh = latestMeas
        ? (latestMeas.local_preview_mesh ?? null)
        : (asset.local_preview_mesh ?? null);
    const latestLifecycleStatus =
        latestMeas?.lifecycle_status ?? asset.lifecycle_status ?? null;
    const latestReconciliationDeltaPct =
        latestMeas?.reconciliation_delta_pct ?? asset.reconciliation_delta_pct ?? null;
    const latestTinVolumeM3 = latestMeas
        ? (latestMeas.tin_volume_m3 ?? latestMeas.offline_in_situ_m3 ?? null)
        : (asset.tin_volume_m3 ?? null);
    const latestMeshSource = latestMeas ? latestMeas.mesh_source : asset.mesh_source;
    const latestMeshSha = latestMeas ? latestMeas.mesh_sha256 : asset.mesh_sha256;
    const latestMeshOrigBytes = latestMeas
        ? latestMeas.mesh_original_bytes
        : asset.mesh_original_bytes;
    const latestMeshOptBytes = latestMeas
        ? latestMeas.mesh_optimized_bytes
        : asset.mesh_optimized_bytes;
    const latestMeshSavingsPct = latestMeas
        ? latestMeas.mesh_savings_pct
        : asset.mesh_savings_pct;
    const latestCasMetrics =
        latestMeshOrigBytes !== undefined ||
        latestMeshOptBytes !== undefined ||
        latestMeshSha
            ? {
                  originalBytes: latestMeshOrigBytes,
                  optimizedBytes: latestMeshOptBytes,
                  savingsPct: latestMeshSavingsPct,
                  sha256: latestMeshSha,
              }
            : undefined;

    const latestMeasSpatial = latestMeas as (StockpileMeasurement & SpatialMetrologyFields) | null;
    const assetSpatial = asset as StockpileAsset & SpatialMetrologyFields;
    const latestUncertaintyPct =
        latestMeasSpatial?.uncertainty_pct ?? assetSpatial.uncertainty_pct ?? null;
    const latestToeScore = latestMeasSpatial?.toe_score ?? assetSpatial.toe_score ?? null;
    const latestCoveragePct =
        latestMeasSpatial?.coverage_pct ?? assetSpatial.coverage_pct ?? null;
    const latestDepthMode = latestMeasSpatial?.depth_mode ?? assetSpatial.depth_mode ?? null;

    const canonicalFix = useMemo(() => resolveCanonicalFix(asset), [asset]);
    const summary = useMemo(() => computeAssetMetallurgySummary(asset), [asset]);
    const hasRealAssetWeight =
        summary.weightT > 0 &&
        typeof asset.density_factor === 'number' &&
        Number.isFinite(asset.density_factor) &&
        asset.density_factor > 0;
    const governanceResult = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: asset.copper_domain,
                residenceDays: asset.residence_days ?? null,
                moisturePct: asset.moisture_pct ?? null,
                tmlLimitPct: asset.tml_pct ?? null,
            }),
        [asset.copper_domain, asset.residence_days, asset.moisture_pct, asset.tml_pct]
    );

    const isClosed = asset.status === 'CLOSED';
    const slopeAngleDeg =
        typeof asset.detected_slope_angle_deg === 'number'
            ? asset.detected_slope_angle_deg
            : typeof latestMeas?.detected_slope_angle_deg === 'number'
              ? latestMeas.detected_slope_angle_deg
              : null;
    const isSlopeException =
        (typeof slopeAngleDeg === 'number' && Number.isFinite(slopeAngleDeg) && slopeAngleDeg > 38) ||
        Boolean(asset.slope_warning);

    useEffect(() => {
        if (!isMobile || isClosed) return;
        const handler = () => onNewMeasurement();
        window.addEventListener('geolapp:quick-capture', handler);
        return () => window.removeEventListener('geolapp:quick-capture', handler);
    }, [isClosed, isMobile, onNewMeasurement]);

    const handleTriggerClosure = useCallback(() => {
        if (isClosed) {
            setPendingHitl({
                kind: 'REOPEN_CYCLE',
                diffs: [
                    {
                        field: 'status',
                        current: 'CLOSED',
                        suggested: 'ACTIVE',
                    },
                ],
            });
            return;
        }
        onOpenClosure?.();
    }, [isClosed, onOpenClosure]);

    useEffect(() => {
        if (!isMobile) return;
        const listener = () => handleTriggerClosure();
        window.addEventListener('minreport:toggle-closure', listener);
        return () => window.removeEventListener('minreport:toggle-closure', listener);
    }, [handleTriggerClosure, isMobile]);

    const executePendingHitl = async () => {
        if (!pendingHitl || isSavingHitl) return;
        setIsSavingHitl(true);
        try {
            if (pendingHitl.kind === 'REOPEN_CYCLE') {
                await dataService.reopenClosedAssetWithHitl(asset.id, 'ACTUALIZAR');
                setStatusText(t('lifecycle.reopen_success', 'Ciclo reactivado.'));
            }
            setPendingHitl(null);
        } catch (err: unknown) {
            setStatusText(
                err instanceof Error ? err.message : t('hitl.save_error', 'Error guardando HITL.')
            );
            setPendingHitl(null);
        } finally {
            setIsSavingHitl(false);
        }
    };

    const handleExportPdf = async () => {
        if (isExportingPdf) return;
        setIsExportingPdf(true);
        try {
            await downloadGeolappVectorPdf(asset, orderedMeasurements);
            setStatusText(t('pdf.download_ready', 'Certificado PDF generado.'));
        } catch (err: unknown) {
            setStatusText(err instanceof Error ? err.message : t('pdf.error', 'Error generando PDF.'));
        } finally {
            setIsExportingPdf(false);
        }
    };

    const mobileMode: StockpileVisualMode =
        visualMode === '3D' ? '3D' : visualMode === 'MAP' ? 'MAP' : 'PHOTO';
    const lastMeasuredTs = latestMeas?.timestamp ?? asset.last_measured_at ?? asset.captured_at;
    const lastMeasuredStr =
        typeof lastMeasuredTs === 'number' && Number.isFinite(lastMeasuredTs)
            ? new Date(lastMeasuredTs).toLocaleString([], {
                  dateStyle: 'short',
                  timeStyle: 'short',
              })
            : '--';

    return (
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none select-none">
            <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-1 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shrink-0 flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                    </button>
                    <h1 className="text-[18px] font-mono font-bold uppercase truncate">
                        {asset.name}
                    </h1>
                </div>

                <div
                    role="tablist"
                    aria-label={t('visual.mode_aria', 'Modo visual')}
                    className="flex items-center gap-fib-8 shrink-0"
                >
                    {(
                        [
                            {
                                id: 'PHOTO' as const,
                                icon: 'photo_camera',
                                label: t('visual.mode_photo', 'FOTO'),
                            },
                            {
                                id: '3D' as const,
                                icon: 'deployed_code',
                                label: t('visual.mode_3d', '3D'),
                            },
                            {
                                id: 'MAP' as const,
                                icon: 'satellite_alt',
                                label: t('visual.mode_map', 'MAPA'),
                            },
                        ] as const
                    ).map((item) => {
                        const active = mobileMode === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                aria-label={item.label}
                                title={item.label}
                                onClick={() => {
                                    void triggerFieldImpact('LIGHT');
                                    setVisualMode(item.id);
                                }}
                                className={`min-w-[48px] min-h-[48px] px-2 bg-transparent border-0 border-b-2 inline-flex items-center justify-center cursor-pointer rounded-none transition-colors ${
                                    active
                                        ? 'border-[#C68346] text-[#C68346]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                }`}
                            >
                                <span
                                    className="material-symbols-outlined text-[22px]"
                                    aria-hidden="true"
                                >
                                    {item.icon}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </header>

            {isExportingPdf && (
                <M3LinearProgress indeterminate ariaLabel="PDF" />
            )}

            <div className="flex-1 min-h-0 overflow-y-auto pb-fib-21">
                {statusText && (
                    <div className="px-fib-13 py-fib-8 border-b border-[#00AEEF] text-[16px] font-mono flex items-center justify-between gap-fib-8 rounded-none">
                        <span className="text-[#00AEEF]">{statusText}</span>
                        <button
                            type="button"
                            onClick={() => setStatusText(null)}
                            aria-label={t('common.close_button', 'CERRAR')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 p-1 cursor-pointer text-[#475569] dark:text-[#8A93A6] rounded-none flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                )}

                {/* 1. Visor Foto Real / Malla 3D / Mapa Estático */}
                <div className="border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <StockpileVisualStage
                        isMobile={true}
                        compact={true}
                        showMetrologyFooter={false}
                        mode={mobileMode}
                        onModeChange={setVisualMode}
                        hideModeToolbar={true}
                        photoUrl={latestHeroPhoto}
                        boulderDetections={latestMeas?.boulder_detections ?? asset.boulder_detections}
                        slopeAngleDeg={slopeAngleDeg}
                        meshUrl={latestMeshUrl}
                        localPreviewMesh={latestLocalPreviewMesh}
                        lifecycleStatus={latestLifecycleStatus}
                        reconciliationDeltaPct={latestReconciliationDeltaPct}
                        copperDomain={asset.copper_domain}
                        tinVolumeM3={latestTinVolumeM3}
                        casMetrics={latestCasMetrics}
                        meshSource={latestMeshSource}
                        uncertaintyPct={latestUncertaintyPct}
                        toeScore={latestToeScore}
                        coveragePct={latestCoveragePct}
                        depthMode={latestDepthMode}
                        altLabel={asset.name}
                        mapNode={
                            <StockpileStaticMapCard
                                asset={asset}
                                fix={canonicalFix}
                                heightPx={260}
                                flat={true}
                            />
                        }
                        canReconstruct3D={false}
                        heightPx={232}
                    />
                </div>

                {/* 2. Lecturas Esenciales Móvil: VOLUMEN, TONELADAS, TALUD, ÚLTIMA MEDICIÓN */}
                <section className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-b border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums">
                    <div className="grid grid-cols-2 divide-x divide-[#E2E8F0] dark:divide-[#12151C]">
                        <div className="px-fib-13 py-fib-13 min-w-0">
                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                VOLUMEN
                            </span>
                            <div className="flex items-baseline gap-fib-8 flex-wrap">
                                <span className="text-[24px] font-bold text-[#C68346]">
                                    {formatStockpileVolumeM3(summary.volumeM3)} m³
                                </span>
                                {typeof latestUncertaintyPct === 'number' &&
                                    Number.isFinite(latestUncertaintyPct) &&
                                    latestUncertaintyPct > 0 && (
                                        <span
                                            className={`text-[15px] font-bold ${
                                                latestUncertaintyPct <= 5
                                                    ? 'text-[#00AEEF]'
                                                    : latestUncertaintyPct > 8
                                                      ? 'text-[#C68346]'
                                                      : 'text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                        >
                                            ± {latestUncertaintyPct.toFixed(1)}%
                                        </span>
                                    )}
                            </div>
                        </div>

                        <div className="px-fib-13 py-fib-13 min-w-0">
                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                TONELADAS
                            </span>
                            <span className="block text-[24px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {hasRealAssetWeight
                                    ? `${summary.weightT.toLocaleString(undefined, {
                                          maximumFractionDigits: 1,
                                      })} t`
                                    : '--'}
                            </span>
                        </div>
                    </div>

                    <div className="px-fib-13 py-fib-13 flex items-center justify-between gap-fib-8">
                        <span className="text-[16px] uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                            TALUD
                        </span>
                        <span
                            className={`text-[18px] font-bold ${
                                slopeAngleDeg == null
                                    ? 'text-[#94A3B8] dark:text-[#5A6072]'
                                    : isSlopeException
                                      ? 'text-[#C68346]'
                                      : 'text-[#00AEEF]'
                            }`}
                        >
                            {typeof slopeAngleDeg === 'number' && Number.isFinite(slopeAngleDeg)
                                ? `${slopeAngleDeg.toFixed(1)}°`
                                : '--'}
                        </span>
                    </div>

                    <div className="px-fib-13 py-fib-13 flex items-center justify-between gap-fib-8">
                        <span className="text-[16px] uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                            ÚLTIMA MEDICIÓN
                        </span>
                        <span className="text-[16px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {lastMeasuredStr}
                        </span>
                    </div>

                    {isClosed && (asset.closure_cause || asset.dispatch_reference) && (
                        <div className="px-fib-13 py-fib-13 border-l-[3px] border-l-[#C68346] flex items-center justify-between gap-fib-8">
                            <span className="text-[15px] uppercase text-[#C68346] font-bold shrink-0">
                                {asset.closure_reason === 'FIELD_REMOVED'
                                    ? t('lifecycle.mode_removed', 'ELIMINACIÓN')
                                    : t('lifecycle.mode_shipped', 'DESPACHO')}
                            </span>
                            <span className="text-[15px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate text-right">
                                {asset.closure_cause || asset.dispatch_reference}
                            </span>
                        </div>
                    )}
                </section>

                {/* 3. Gráfico SVG Vectorial Evolución Volumétrica */}
                <MobileEvolutionSvgChart
                    measurements={orderedMeasurements}
                    onSelectMeasurement={onSelectMeasurement}
                />

                {governanceResult.alerts.length > 0 && (
                    <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <CopperGovernanceBanner result={governanceResult} />
                    </div>
                )}

                {/* 4. Historial inmediato de mediciones */}
                <section>
                    <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between font-mono text-[15px] font-bold uppercase tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        <span>
                            {t('dossier.tab_history', 'HISTORIAL')} ·{' '}
                            {String(orderedMeasurements.length).padStart(2, '0')}
                        </span>
                        {isClosed && (
                            <span className="text-[#C68346]">
                                {t('home.filter_closed', 'CERRADO')}
                            </span>
                        )}
                    </div>

                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {orderedMeasurements.map((m) => (
                            <HistoryRowItem
                                key={m.id}
                                measurement={m}
                                onSelect={onSelectMeasurement}
                                onToggleIgnore={(item) =>
                                    void dataService.toggleIgnoreMeasurement(
                                        item.id,
                                        item.assetId,
                                        Boolean(item.ignored)
                                    )
                                }
                            />
                        ))}
                    </div>
                </section>
            </div>

            {/* Barra Inferior Móvil Fija (64px) de 3 Iconos Ad Hoc Puros */}
            <nav
                aria-label={t('nav.primary', 'Acciones de acopio')}
                className="shrink-0 min-h-[64px] pb-[env(safe-area-inset-bottom)] px-fib-21 bg-[#FFFFFF] dark:bg-[#000000] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-around no-print"
            >
                <button
                    type="button"
                    onClick={() => {
                        void triggerFieldImpact('LIGHT');
                        void handleExportPdf();
                    }}
                    disabled={isExportingPdf}
                    aria-label={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                    title={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                    className="min-w-[56px] min-h-[56px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 cursor-pointer flex items-center justify-center rounded-none shadow-none"
                >
                    <span className="material-symbols-outlined text-[24px]" aria-hidden="true">
                        picture_as_pdf
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => {
                        void triggerFieldImpact('MEDIUM');
                        onNewMeasurement();
                    }}
                    disabled={isClosed}
                    aria-label={t('dossier.measure_again_btn', 'MEDIR DE NUEVO')}
                    title={t('dossier.measure_again_btn', 'MEDIR DE NUEVO')}
                    className="min-w-[64px] min-h-[56px] bg-transparent border-0 outline-none text-[#C68346] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed flex items-center justify-center rounded-none shadow-none"
                >
                    <span className="material-symbols-outlined text-[28px]" aria-hidden="true">
                        add_a_photo
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => {
                        void triggerFieldImpact('LIGHT');
                        handleTriggerClosure();
                    }}
                    aria-label={
                        isClosed
                            ? t('lifecycle.reopen_action', 'REABRIR CICLO (HITL)')
                            : t('lifecycle.close_shipment_action', 'CERRAR ACOPIO')
                    }
                    title={
                        isClosed
                            ? t('lifecycle.reopen_action', 'REABRIR CICLO (HITL)')
                            : t('lifecycle.close_shipment_action', 'CERRAR ACOPIO')
                    }
                    className={`min-w-[56px] min-h-[56px] bg-transparent border-0 outline-none cursor-pointer flex items-center justify-center rounded-none shadow-none ${
                        isClosed
                            ? 'text-[#00AEEF]'
                            : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346]'
                    }`}
                >
                    <span className="material-symbols-outlined text-[24px]" aria-hidden="true">
                        {isClosed ? 'lock_open' : 'done_all'}
                    </span>
                </button>
            </nav>

            <HitlConfirmModal
                open={Boolean(pendingHitl)}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL')}
                description={t(
                    'hitl.modal_description',
                    'Escriba ACTUALIZAR para confirmar el registro oficial.'
                )}
                keyword="ACTUALIZAR"
                comparisonDiff={pendingHitl?.diffs}
                loading={isSavingHitl}
                onConfirm={() => void executePendingHitl()}
                onCancel={() => setPendingHitl(null)}
            />
        </div>
    );
};
