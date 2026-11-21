import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { geolappDigitalAiService } from '../core/services/GeolappDigitalAiService';
import {
    photogrammetry3dService,
    type Reconstruct3DResult,
} from '../core/services/photogrammetry3d.service';
import { triggerFieldImpact, triggerFieldNotification } from '../core/utils/fieldHaptics';
import { CopyButton } from '../../../components/common/CopyButton';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import {
    ReportBlockEditable,
    ReportFieldRow,
    UNDECLARED_TECH_VALUE,
} from '../../../components/common/ReportBlockEditable';
import { SecureImage } from '../../../components/common/SecureImage';
import { calculationEngine, computeStockpileMeasurementChain } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import {
    COPPER_DOMAIN_OPTIONS,
    CopperGovernanceBanner,
    mapCopperDomainToClase,
    sanitizeDecimalText,
} from '../core/utils/captureHelpers';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import type {
    CopperMineralDomain,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import {
    computeAssetMetallurgySummary,
    formatCasTraceLabel,
    formatSignedDelta,
    parseNullableNonNegativeNumber,
    resolveCanonicalFix,
} from './desktop/desktopHelpers';
import { GeolappAiEnrichDrawer } from './GeolappAiEnrichDrawer';
import { StockpileStaticMapCard } from './StockpileStaticMapCard';
import { StockpileVisualStage, type StockpileVisualMode } from './StockpileVisualStage';

export interface StockpileDossierViewProps {
    asset: StockpileAsset;
    measurements: StockpileMeasurement[];
    onSelectMeasurement: (m: StockpileMeasurement) => void;
    onBack: () => void;
    onNewMeasurement: () => void;
    justCreated?: boolean;
    isMobileField?: boolean;
}

type DossierTab = 'RESUMEN' | 'FICHA' | 'HISTORIAL';
type EditingBlock = 'identity' | 'material' | 'metallurgy' | null;

interface SpatialMetrologyFields {
    uncertainty_pct?: number | null;
    toe_score?: number | null;
    coverage_pct?: number | null;
    depth_mode?: string | null;
    ground_slope_deg?: number | null;
}

function formatSpatialDepthMode(depthMode?: string | null): string | null {
    if (typeof depthMode !== 'string') return null;
    const normalized = depthMode.trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'RAW_DEPTH_ONLY') return 'ARCORE RAW DEPTH';
    if (normalized === 'AUTOMATIC') return 'ARCORE DEPTH';
    if (normalized === 'VIO_POINTCLOUD') return 'ARCORE VIO';
    return depthMode.trim();
}

type PendingHitlAction =
    | { kind: 'PATCH'; patch: Partial<StockpileAsset>; diffs: HitlComparisonDiffItem[] }
    | {
          kind: 'CLOSE_SHIPMENT';
          dispatchReference: string;
          shippedWeightT?: number | null;
          diffs: HitlComparisonDiffItem[];
      }
    | { kind: 'REOPEN_CYCLE'; diffs: HitlComparisonDiffItem[] };

const HistoryRowItem: React.FC<{
    measurement: StockpileMeasurement;
    onSelect: (m: StockpileMeasurement) => void;
    onToggleIgnore: (m: StockpileMeasurement) => void;
    flat?: boolean;
}> = ({ measurement: m, onSelect, onToggleIgnore, flat = false }) => {
    const { t } = useTranslation();
    const resolvedPrev = useResolvedStockpileImage(m.previous_photo_url);
    const resolvedCurr = useResolvedStockpileImage(m.photo_url);
    const deltaText = formatSignedDelta(m.delta_volumen, m.delta_volumen_pct);

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
            className={`w-full rounded-none shadow-none flex items-stretch justify-between gap-fib-8 ${
                flat
                    ? `border-0 bg-transparent hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] ${
                          m.ignored ? 'opacity-50' : ''
                      }`
                    : m.ignored
                      ? 'border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] opacity-60'
                      : 'border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] hover:border-[#C68346]'
            }`}
        >
            {flat && <span aria-hidden="true" className={`w-[3px] shrink-0 ${barClass}`} />}

            <button
                type="button"
                onClick={() => onSelect(m)}
                className={`flex-1 min-w-0 text-left flex items-center justify-between gap-fib-13 bg-transparent border-0 outline-none cursor-pointer ${
                    flat ? 'py-fib-13 px-0' : 'p-fib-13'
                }`}
            >
                <div className="flex items-center gap-fib-13 min-w-0">
                    <div className="flex items-center gap-1 shrink-0">
                        {!flat && (
                            <>
                                <div className="w-10 h-10 flex items-center justify-center overflow-hidden rounded-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    {resolvedPrev ? (
                                        <SecureImage
                                            src={resolvedPrev}
                                            alt={t('history.previous_photo_alt', 'Foto anterior')}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span className="material-symbols-outlined text-[16px] text-[#94A3B8] dark:text-[#5A6072]">
                                            first_page
                                        </span>
                                    )}
                                </div>
                                <span className="material-symbols-outlined text-[14px] text-[#94A3B8] dark:text-[#5A6072]">
                                    arrow_forward
                                </span>
                            </>
                        )}
                        <div
                            className={`w-10 h-10 flex items-center justify-center overflow-hidden rounded-none ${
                                flat
                                    ? 'bg-transparent border-0'
                                    : 'bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346]/60'
                            }`}
                        >
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
                    </div>

                    <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-data-dense font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {new Date(m.timestamp).toLocaleDateString()}
                        </span>
                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                            {m.geometry?.type
                                ? t(`geometries.${m.geometry.type}`, String(m.geometry.type))
                                : m.method}
                        </span>
                    </div>
                </div>

                <div className="text-right font-mono tabular-nums shrink-0">
                    <span className="block text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                        {m.volumen_m3.toFixed(1)} m³
                    </span>
                    <span
                        className={`block text-microcopy ${
                            typeof m.delta_volumen === 'number' && m.delta_volumen < 0
                                ? 'text-[#C68346]'
                                : 'text-[#00AEEF]'
                        }`}
                    >
                        {deltaText || `${m.peso_t.toFixed(1)} t`}
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
                className={`min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-0 text-[#94A3B8] dark:text-[#5A6072] hover:text-[#C68346] cursor-pointer shrink-0 rounded-none ${
                    flat ? 'px-1' : 'px-fib-13 border-l border-[#E2E8F0] dark:border-[#12151C]'
                }`}
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
                        {maxVal.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³
                    </strong>
                </span>
                <span>
                    MIN{' '}
                    <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                        {minVal.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³
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
                        aria-label={`${new Date(pt.m.timestamp).toLocaleDateString()} · ${pt.m.volumen_m3.toFixed(1)} m³`}
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
    justCreated = false,
    isMobileField,
}) => {
    const { t } = useTranslation();
    const { isOnline } = useNetworkStatus();
    const isMobile = isMobileField ?? Capacitor.isNativePlatform();
    const [isAnalyzingDigital, setIsAnalyzingDigital] = useState(false);
    const [isReconstructing3D, setIsReconstructing3D] = useState(false);
    const [localMeshResult, setLocalMeshResult] = useState<Reconstruct3DResult | null>(null);

    const [visualMode, setVisualMode] = useState<StockpileVisualMode>(() =>
        isMobile ? 'PHOTO' : 'DUAL'
    );
    const [activeTab, setActiveTab] = useState<DossierTab>('RESUMEN');
    const [showAiDrawer, setShowAiDrawer] = useState(false);
    const [editingBlock, setEditingBlock] = useState<EditingBlock>(null);
    const [showMetallurgyBlock, setShowMetallurgyBlock] = useState<boolean>(() =>
        Boolean(
            asset.moisture_pct != null ||
                asset.cu_total_pct != null ||
                asset.cu_soluble_pct != null ||
                asset.tml_pct != null ||
                asset.peso_romana != null
        )
    );
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [isSavingHitl, setIsSavingHitl] = useState(false);
    const [showShipmentForm, setShowShipmentForm] = useState(false);
    const [dispatchRefDraft, setDispatchRefDraft] = useState(asset.dispatch_reference || '');
    const [shippedWeightDraft, setShippedWeightDraft] = useState(
        asset.shipped_weight_t != null ? String(asset.shipped_weight_t) : ''
    );
    const [statusText, setStatusText] = useState<string | null>(null);
    const [pendingHitl, setPendingHitl] = useState<PendingHitlAction | null>(null);

    const [draftName, setDraftName] = useState(asset.name);
    const [draftLocationRef, setDraftLocationRef] = useState(asset.location_ref || '');
    const [draftDescription, setDraftDescription] = useState(asset.description || '');

    const [draftCopperDomain, setDraftCopperDomain] = useState<CopperMineralDomain | ''>(
        asset.copper_domain || ''
    );
    const [draftDensity, setDraftDensity] = useState(
        asset.density_factor != null ? String(asset.density_factor) : ''
    );
    const [draftGranulometry, setDraftGranulometry] = useState<
        NonNullable<StockpileAsset['tipo_granulometria']> | ''
    >(asset.tipo_granulometria || '');

    const [draftMoisture, setDraftMoisture] = useState(
        asset.moisture_pct != null ? String(asset.moisture_pct) : ''
    );
    const [draftTml, setDraftTml] = useState(asset.tml_pct != null ? String(asset.tml_pct) : '');
    const [draftCuT, setDraftCuT] = useState(
        asset.cu_total_pct != null ? String(asset.cu_total_pct) : ''
    );
    const [draftCuS, setDraftCuS] = useState(
        asset.cu_soluble_pct != null ? String(asset.cu_soluble_pct) : ''
    );
    const [draftResidenceDays, setDraftResidenceDays] = useState(
        asset.residence_days != null ? String(asset.residence_days) : ''
    );
    const [draftRomana, setDraftRomana] = useState(
        asset.peso_romana != null ? String(asset.peso_romana) : ''
    );

    useEffect(() => {
        setDraftName(asset.name);
        setDraftLocationRef(asset.location_ref || '');
        setDraftDescription(asset.description || '');
        setDraftCopperDomain(asset.copper_domain || '');
        setDraftDensity(asset.density_factor != null ? String(asset.density_factor) : '');
        setDraftGranulometry(asset.tipo_granulometria || '');
        setDraftMoisture(asset.moisture_pct != null ? String(asset.moisture_pct) : '');
        setDraftTml(asset.tml_pct != null ? String(asset.tml_pct) : '');
        setDraftCuT(asset.cu_total_pct != null ? String(asset.cu_total_pct) : '');
        setDraftCuS(asset.cu_soluble_pct != null ? String(asset.cu_soluble_pct) : '');
        setDraftResidenceDays(asset.residence_days != null ? String(asset.residence_days) : '');
        setDraftRomana(asset.peso_romana != null ? String(asset.peso_romana) : '');
        setLocalMeshResult(null);
        setShowShipmentForm(false);
        setVisualMode(isMobile ? 'PHOTO' : 'DUAL');
    }, [asset, isMobile]);

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

    const latestFallbackGeometry = useMemo(() => {
        const g = latestMeas?.geometry;
        if (!g?.type || !g?.dimensions) return null;
        const hasPositive = Object.values(g.dimensions).some(
            (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
        );
        return hasPositive
            ? {
                  type: g.type,
                  dimensions: g.dimensions as Record<string, number | undefined>,
              }
            : null;
    }, [latestMeas]);

    const latestMeshUrl = localMeshResult?.meshUrl ?? latestMeas?.mesh_url ?? asset.mesh_url ?? null;
    const latestTinVolumeM3 =
        localMeshResult?.tinVolumeM3 ?? latestMeas?.tin_volume_m3 ?? asset.tin_volume_m3 ?? null;
    const latestMeshSource =
        localMeshResult?.source ?? latestMeas?.mesh_source ?? asset.mesh_source;
    const latestMeshSha =
        localMeshResult?.sha256 ?? latestMeas?.mesh_sha256 ?? asset.mesh_sha256;
    const latestCasMetrics =
        localMeshResult ||
        latestMeas?.mesh_original_bytes !== undefined ||
        asset.mesh_original_bytes !== undefined ||
        asset.cas_original_bytes !== undefined ||
        latestMeshSha
            ? {
                  originalBytes:
                      localMeshResult?.originalBytes ??
                      latestMeas?.mesh_original_bytes ??
                      asset.mesh_original_bytes ??
                      asset.cas_original_bytes,
                  optimizedBytes:
                      localMeshResult?.optimizedBytes ??
                      latestMeas?.mesh_optimized_bytes ??
                      asset.mesh_optimized_bytes ??
                      asset.cas_optimized_bytes,
                  savingsPct:
                      localMeshResult?.savingsPct ??
                      latestMeas?.mesh_savings_pct ??
                      asset.mesh_savings_pct ??
                      asset.cas_savings_pct,
                  sha256: latestMeshSha,
              }
            : undefined;
    const canReconstruct3D = Boolean(!latestMeshUrl && latestFallbackGeometry);

    const latestMeasSpatial = latestMeas as (StockpileMeasurement & SpatialMetrologyFields) | null;
    const assetSpatial = asset as StockpileAsset & SpatialMetrologyFields;
    const latestUncertaintyPct =
        latestMeasSpatial?.uncertainty_pct ?? assetSpatial.uncertainty_pct ?? null;
    const latestToeScore = latestMeasSpatial?.toe_score ?? assetSpatial.toe_score ?? null;
    const latestCoveragePct =
        latestMeasSpatial?.coverage_pct ?? assetSpatial.coverage_pct ?? null;
    const latestDepthMode = latestMeasSpatial?.depth_mode ?? assetSpatial.depth_mode ?? null;
    const latestGroundSlopeDeg =
        latestMeasSpatial?.ground_slope_deg ?? assetSpatial.ground_slope_deg ?? null;
    const latestDepthModeDisplay = formatSpatialDepthMode(latestDepthMode);

    const canonicalFix = useMemo(() => resolveCanonicalFix(asset), [asset]);
    const summary = useMemo(() => computeAssetMetallurgySummary(asset), [asset]);
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
        if (governanceResult.hasCriticalBlock) {
            setStatusText(
                t('copper_governance.dispatch_blocked', 'DESPACHO BLOQUEADO (IMSBC)')
            );
            return;
        }
        setShowShipmentForm((prev) => !prev);
    }, [governanceResult.hasCriticalBlock, isClosed, t]);

    useEffect(() => {
        if (!isMobile) return;
        const listener = () => handleTriggerClosure();
        window.addEventListener('minreport:toggle-closure', listener);
        return () => window.removeEventListener('minreport:toggle-closure', listener);
    }, [handleTriggerClosure, isMobile]);

    const handleReconstruct3D = async () => {
        if (!latestFallbackGeometry || isReconstructing3D) return;
        setIsReconstructing3D(true);
        setStatusText(null);
        try {
            const result = await photogrammetry3dService.reconstructStockpile3D({
                stockpileId: asset.id,
                measurementId: latestMeas?.id,
                geometryType: latestFallbackGeometry.type,
                dimensions: latestFallbackGeometry.dimensions,
                photoUrls: [
                    ...(latestHeroPhoto ? [latestHeroPhoto] : []),
                    ...(latestMeas?.perimeter_photo_urls || asset.perimeter_photo_urls || []),
                ].filter((u) => Boolean(u) && !u.startsWith('data:')),
            });
            setLocalMeshResult(result);
            await dataService.saveStockpileData(
                {
                    mesh_url: result.meshUrl,
                    mesh_sha256: result.sha256,
                    mesh_source: result.source,
                    tin_volume_m3: result.tinVolumeM3,
                    mesh_original_bytes: result.originalBytes,
                    mesh_optimized_bytes: result.optimizedBytes,
                    mesh_savings_pct: result.savingsPct,
                },
                asset.id
            );
            setVisualMode('3D');
        } catch (err: unknown) {
            setStatusText(
                err instanceof Error && err.message
                    ? err.message
                    : t('twin3d.reconstruction_error', 'Error al reconstruir malla 3D .glb.')
            );
        } finally {
            setIsReconstructing3D(false);
        }
    };

    const domainDisplayLabel = asset.copper_domain
        ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
        : null;
    const deltaPctRaw = chain.summary.lastDeltaVolumenPct ?? asset.last_delta_volumen_pct;
    const deltaPctCompact =
        typeof deltaPctRaw === 'number' && Number.isFinite(deltaPctRaw)
            ? `${deltaPctRaw > 0 ? '+' : ''}${deltaPctRaw.toFixed(1)}%`
            : '--';
    const deltaText = formatSignedDelta(
        chain.summary.lastDeltaVolumenM3 ?? asset.last_delta_volumen_m3,
        deltaPctRaw
    );
    const casTrace = formatCasTraceLabel(
        asset.cas_original_bytes,
        asset.cas_optimized_bytes,
        asset.cas_savings_pct
    );

    const queueIdentityPatch = (e: React.FormEvent) => {
        e.preventDefault();
        const patch: Partial<StockpileAsset> = {};
        const diffs: HitlComparisonDiffItem[] = [];
        const cleanName = draftName.trim();
        if (cleanName && cleanName !== asset.name) {
            patch.name = cleanName;
            diffs.push({
                field: t('registration.name_label', 'ID / NOMBRE'),
                current: asset.name,
                suggested: cleanName,
            });
        }
        const cleanLoc = draftLocationRef.trim();
        if (cleanLoc !== (asset.location_ref || '')) {
            patch.location_ref = cleanLoc;
            diffs.push({
                field: t('registration.location_ref_label', 'UBICACIÓN'),
                current: asset.location_ref || UNDECLARED_TECH_VALUE,
                suggested: cleanLoc || UNDECLARED_TECH_VALUE,
            });
        }
        const cleanDesc = draftDescription.trim();
        if (cleanDesc !== (asset.description || '')) {
            patch.description = cleanDesc;
            diffs.push({
                field: t('registration.description_label', 'DESCRIPCIÓN'),
                current: asset.description || UNDECLARED_TECH_VALUE,
                suggested: cleanDesc || UNDECLARED_TECH_VALUE,
            });
        }
        if (diffs.length === 0) {
            setEditingBlock(null);
            return;
        }
        setPendingHitl({ kind: 'PATCH', patch, diffs });
    };

    const queueMaterialPatch = (e: React.FormEvent) => {
        e.preventDefault();
        const patch: Partial<StockpileAsset> = {};
        const diffs: HitlComparisonDiffItem[] = [];
        if (draftCopperDomain && draftCopperDomain !== asset.copper_domain) {
            patch.copper_domain = draftCopperDomain;
            patch.clase = mapCopperDomainToClase(draftCopperDomain);
            diffs.push({
                field: t('registration.copper_domain_label', 'DOMINIO Cu'),
                current: domainDisplayLabel || UNDECLARED_TECH_VALUE,
                suggested: t(`copper_domains.${draftCopperDomain}`, draftCopperDomain),
            });
        }
        const nextDensity = parseNullableNonNegativeNumber(draftDensity);
        if (nextDensity !== (asset.density_factor ?? null) && nextDensity !== null) {
            patch.density_factor = nextDensity;
            if (summary.volumeM3 > 0) {
                const updatedWeight = Number((summary.volumeM3 * nextDensity).toFixed(2));
                patch.last_weight_t = updatedWeight;
                patch.weight_t = updatedWeight;
                patch.peso_final_toneladas = updatedWeight;
            }
            diffs.push({
                field: t('manual_capture.fields.density_factor', 'DENSIDAD (t/m³)'),
                current:
                    asset.density_factor != null
                        ? `${asset.density_factor} t/m³`
                        : UNDECLARED_TECH_VALUE,
                suggested: `${nextDensity} t/m³`,
            });
        }
        if (draftGranulometry && draftGranulometry !== asset.tipo_granulometria) {
            patch.tipo_granulometria = draftGranulometry;
            diffs.push({
                field: t('scanner.granulometry_label', 'GRANULOMETRÍA'),
                current: asset.tipo_granulometria || UNDECLARED_TECH_VALUE,
                suggested: draftGranulometry,
            });
        }
        if (diffs.length === 0) {
            setEditingBlock(null);
            return;
        }
        setPendingHitl({ kind: 'PATCH', patch, diffs });
    };

    const queueMetallurgyPatch = (e: React.FormEvent) => {
        e.preventDefault();
        const nextM = parseNullableNonNegativeNumber(draftMoisture);
        const nextTml = parseNullableNonNegativeNumber(draftTml);
        const nextCuT = parseNullableNonNegativeNumber(draftCuT);
        const nextCuS = parseNullableNonNegativeNumber(draftCuS);
        const nextDays = parseNullableNonNegativeNumber(draftResidenceDays);
        const nextRomana = parseNullableNonNegativeNumber(draftRomana);

        const patch: Partial<StockpileAsset> = {};
        const diffs: HitlComparisonDiffItem[] = [];
        const checkNum = (
            key: keyof StockpileAsset,
            label: string,
            curr: number | null | undefined,
            next: number | null,
            suffix: string
        ) => {
            if (next !== (curr ?? null)) {
                (patch as Record<string, unknown>)[key] = next;
                diffs.push({
                    field: label,
                    current: curr != null ? `${curr} ${suffix}` : UNDECLARED_TECH_VALUE,
                    suggested: next != null ? `${next} ${suffix}` : UNDECLARED_TECH_VALUE,
                });
            }
        };

        checkNum('moisture_pct', 'HUMEDAD w%', asset.moisture_pct, nextM, '%');
        checkNum('tml_pct', 'TML %', asset.tml_pct, nextTml, '%');
        checkNum('cu_total_pct', 'CuT %', asset.cu_total_pct, nextCuT, '%');
        checkNum('cu_soluble_pct', 'CuS %', asset.cu_soluble_pct, nextCuS, '%');
        checkNum('residence_days', 'RESIDENCIA', asset.residence_days, nextDays, 'd');
        checkNum('peso_romana', 'ROMANA [t]', asset.peso_romana, nextRomana, 't');

        if (diffs.length === 0) {
            setEditingBlock(null);
            return;
        }
        setPendingHitl({ kind: 'PATCH', patch, diffs });
    };

    const executePendingHitl = async () => {
        if (!pendingHitl || isSavingHitl) return;
        setIsSavingHitl(true);
        try {
            if (pendingHitl.kind === 'PATCH') {
                await dataService.updateAssetWithHitl(
                    asset.id,
                    pendingHitl.patch,
                    'ACTUALIZAR',
                    pendingHitl.diffs
                );
                setStatusText(t('hitl.save_success', 'Ficha actualizada bajo AuditLedger.'));
                setEditingBlock(null);
            } else if (pendingHitl.kind === 'CLOSE_SHIPMENT') {
                await dataService.closeAssetByShipment(asset.id, {
                    dispatchReference: pendingHitl.dispatchReference,
                    shippedWeightT: pendingHitl.shippedWeightT ?? null,
                    confirmationKeyword: 'ACTUALIZAR',
                });
                setShowShipmentForm(false);
                setStatusText(t('lifecycle.close_shipment_success', 'Ciclo cerrado por embarque.'));
            } else if (pendingHitl.kind === 'REOPEN_CYCLE') {
                await dataService.reopenClosedAssetWithHitl(asset.id, 'ACTUALIZAR');
                setStatusText(t('lifecycle.reopen_success', 'Ciclo reactivado.'));
            }
            setPendingHitl(null);
        } catch (err: any) {
            setStatusText(err?.message || t('hitl.save_error', 'Error guardando HITL.'));
            setPendingHitl(null);
        } finally {
            setIsSavingHitl(false);
        }
    };

    const handleAnalyzeDigitalNow = async () => {
        if (isAnalyzingDigital || !isOnline) return;
        const photoUrl = asset.last_photo_url || asset.initial_photo_url || latestMeas?.photo_url;
        if (!photoUrl) {
            setStatusText(t('digital_v2.photo_required', 'Se requiere fotografía para analizar.'));
            return;
        }
        setIsAnalyzingDigital(true);
        setStatusText(null);
        try {
            const res = await geolappDigitalAiService.analyzeCapture({
                stockpileId: asset.id,
                measurementId: latestMeas?.id,
                photoUrl,
                tenantId: asset.tenantId,
                scaleAnchorType: asset.scale_anchor_type || latestMeas?.scale_anchor_type || 'NONE',
                referenceBaseMeters: latestMeas?.reference_base_meters,
                imuPitchDeg: latestMeas?.imu_pitch_deg,
            });
            await dataService.getAsset(asset.id);
            void triggerFieldNotification(res.slopeWarning ? 'WARNING' : 'SUCCESS');
            setStatusText(
                res.scaleVerified
                    ? `${t('digital_v2.verified_volume', 'CUBICACIÓN IA')}: ${res.volumeM3.toFixed(1)} m³`
                    : t('digital_v2.pending_scale_hint', 'Material y talud detectados. Falta referencia de escala.')
            );
        } catch (err: any) {
            void triggerFieldNotification('ERROR');
            setStatusText(err?.message || t('ai_enrich.analysis_failed', 'Error ejecutando análisis IA.'));
        } finally {
            setIsAnalyzingDigital(false);
        }
    };

    const handleExportPdf = async () => {
        if (isExportingPdf) return;
        setIsExportingPdf(true);
        try {
            await downloadGeolappVectorPdf(asset, orderedMeasurements);
            setStatusText(t('pdf.download_ready', 'Certificado PDF generado.'));
        } catch (err: any) {
            setStatusText(err?.message || t('pdf.error', 'Error generando PDF.'));
        } finally {
            setIsExportingPdf(false);
        }
    };

    const isPendingDigitalAi =
        (asset.analysis_status === 'PENDING_AI_SYNC' ||
            asset.analysis_status === 'PENDING_SCALE') &&
        isOnline;

    if (isMobile) {
        const mobileMode: StockpileVisualMode = visualMode === '3D' ? '3D' : 'PHOTO';
        const rhoStr = asset.density_factor != null ? `${asset.density_factor} t/m³` : '--';
        const p80Str = typeof asset.p80_mm === 'number' ? `${asset.p80_mm.toFixed(1)} mm` : '--';

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
                        <h1 className="text-h2-section font-mono font-bold uppercase truncate">
                            {asset.name}
                        </h1>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        <div
                            role="tablist"
                            aria-label={t('visual.mode_aria', 'Modo visual')}
                            className="flex items-center gap-fib-8"
                        >
                            {(['PHOTO', '3D'] as const).map((m) => {
                                const active = mobileMode === m;
                                const label =
                                    m === 'PHOTO'
                                        ? t('visual.mode_photo', 'FOTO')
                                        : t('visual.mode_3d', '3D');
                                return (
                                    <button
                                        key={m}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        onClick={() => {
                                            void triggerFieldImpact('LIGHT');
                                            setVisualMode(m);
                                        }}
                                        className={`min-h-[48px] px-1.5 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none transition-colors ${
                                            active
                                                ? 'border-[#C68346] text-[#C68346]'
                                                : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={() => void handleExportPdf()}
                            disabled={isExportingPdf}
                            aria-label={t('pdf.export_button', 'Exportar PDF')}
                            title={t('pdf.export_button', 'Exportar PDF')}
                            className="min-w-[44px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer disabled:opacity-40 rounded-none flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                picture_as_pdf
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() =>
                                isPendingDigitalAi
                                    ? void handleAnalyzeDigitalNow()
                                    : setShowAiDrawer(true)
                            }
                            disabled={isAnalyzingDigital}
                            aria-label={t('ai_enrich.open_button', 'Asistente IA')}
                            title={t('ai_enrich.open_button', 'Asistente IA')}
                            className="min-w-[44px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-[#00AEEF] hover:text-[#0F172A] dark:hover:text-white cursor-pointer disabled:opacity-40 rounded-none flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                auto_awesome
                            </span>
                        </button>
                    </div>
                </header>

                {(isExportingPdf || isAnalyzingDigital || isReconstructing3D) && (
                    <M3LinearProgress indeterminate ariaLabel="IA / PDF / 3D" />
                )}

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {statusText && (
                        <div className="px-fib-13 py-fib-8 border-b border-[#00AEEF] text-data-dense font-mono flex items-center justify-between gap-fib-8 rounded-none">
                            <span className="text-[#00AEEF]">{statusText}</span>
                            <button
                                type="button"
                                onClick={() => setStatusText(null)}
                                aria-label={t('common.close_button', 'CERRAR')}
                                className="min-w-[44px] min-h-[44px] bg-transparent border-0 p-1 cursor-pointer text-[#475569] dark:text-[#8A93A6] rounded-none flex items-center justify-center"
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        </div>
                    )}

                    {showShipmentForm && !isClosed && (
                        <form
                            autoComplete="off"
                            spellCheck={false}
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!dispatchRefDraft.trim()) return;
                                setPendingHitl({
                                    kind: 'CLOSE_SHIPMENT',
                                    dispatchReference: dispatchRefDraft.trim(),
                                    shippedWeightT: parseNullableNonNegativeNumber(
                                        shippedWeightDraft
                                    ),
                                    diffs: [
                                        {
                                            field: t(
                                                'lifecycle.dispatch_reference_label',
                                                'DESPACHO'
                                            ),
                                            current: '--',
                                            suggested: dispatchRefDraft.trim(),
                                        },
                                    ],
                                });
                            }}
                            className="px-fib-13 py-fib-13 border-b border-[#C68346] space-y-fib-8 bg-transparent"
                        >
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={dispatchRefDraft}
                                onChange={(e) => setDispatchRefDraft(e.target.value)}
                                placeholder={t(
                                    'lifecycle.dispatch_reference_label',
                                    'GUÍA / LOTE DE EMBARQUE'
                                )}
                                className="w-full h-10 px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                            />
                            <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={shippedWeightDraft}
                                onChange={(e) =>
                                    setShippedWeightDraft(sanitizeDecimalText(e.target.value))
                                }
                                placeholder={t(
                                    'lifecycle.shipped_weight_label',
                                    'TONELAJE EMBARCADO [t]'
                                )}
                                className="w-full h-10 px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                            />
                            <div className="flex items-center gap-fib-8">
                                <button
                                    type="submit"
                                    className="flex-1 min-h-[48px] bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                                >
                                    {t('lifecycle.confirm_shipment_hitl', 'VERIFICAR EMBARQUE')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowShipmentForm(false)}
                                    className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy font-bold uppercase bg-transparent cursor-pointer rounded-none"
                                >
                                    {t('common.cancel_button', 'CANCELAR')}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* 1. Visor Foto Real / Malla 3D */}
                    <div className="border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <StockpileVisualStage
                            isMobile={true}
                            mode={mobileMode}
                            onModeChange={setVisualMode}
                            hideModeToolbar={true}
                            photoUrl={latestHeroPhoto}
                            initialPhotoUrl={asset.initial_photo_url}
                            perimeterPhotoUrls={
                                latestMeas?.perimeter_photo_urls ?? asset.perimeter_photo_urls
                            }
                            boulderDetections={
                                latestMeas?.boulder_detections ?? asset.boulder_detections
                            }
                            slopeAngleDeg={slopeAngleDeg}
                            meshUrl={latestMeshUrl}
                            fallbackGeometry={latestFallbackGeometry}
                            copperDomain={asset.copper_domain}
                            tinVolumeM3={latestTinVolumeM3}
                            casMetrics={latestCasMetrics}
                            meshSource={latestMeshSource}
                            uncertaintyPct={latestUncertaintyPct}
                            toeScore={latestToeScore}
                            coveragePct={latestCoveragePct}
                            depthMode={latestDepthMode}
                            altLabel={asset.name}
                            canReconstruct3D={canReconstruct3D}
                            isReconstructing3D={isReconstructing3D}
                            onReconstruct3D={() => void handleReconstruct3D()}
                            heightPx={232}
                        />
                    </div>

                    {/* 2. Franja KPI 4 columnas */}
                    <section className="grid grid-cols-4 border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C] font-mono tabular-nums">
                        <div className="px-fib-8 py-fib-13 min-w-0">
                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                VOL m³
                            </span>
                            <div className="flex items-baseline gap-1 min-w-0 flex-wrap">
                                <span className="text-data-dense font-bold text-[#C68346] truncate">
                                    {summary.volumeM3.toLocaleString(undefined, {
                                        maximumFractionDigits: 1,
                                    })}
                                </span>
                                {typeof latestUncertaintyPct === 'number' &&
                                    Number.isFinite(latestUncertaintyPct) &&
                                    latestUncertaintyPct > 0 && (
                                        <span
                                            className={`text-microcopy font-bold shrink-0 ${
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
                        <div className="px-fib-8 py-fib-13 min-w-0">
                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                PESO t
                            </span>
                            <span className="block text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {summary.weightT > 0
                                    ? summary.weightT.toLocaleString(undefined, {
                                          maximumFractionDigits: 1,
                                      })
                                    : '--'}
                            </span>
                        </div>
                        <div className="px-fib-8 py-fib-13 min-w-0">
                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                Δ %
                            </span>
                            <span className="block text-data-dense font-bold text-[#00AEEF] truncate">
                                {deltaPctCompact}
                            </span>
                        </div>
                        <div className="px-fib-8 py-fib-13 min-w-0">
                            <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                TALUD °
                            </span>
                            <span
                                className={`block text-data-dense font-bold truncate ${
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
                    </section>

                    {/* 3. Gráfico SVG Vectorial Evolución Volumétrica */}
                    <MobileEvolutionSvgChart
                        measurements={orderedMeasurements}
                        onSelectMeasurement={onSelectMeasurement}
                    />

                    {/* Alertas críticas Copper Governance por excepción */}
                    {governanceResult.alerts.length > 0 && (
                        <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <CopperGovernanceBanner result={governanceResult} />
                        </div>
                    )}

                    {/* 4. Filas técnicas hairline compactas: UTM, ρ / P80, CAS */}
                    <section className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-b border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums">
                        <div className="px-fib-13 py-fib-13 flex items-center justify-between gap-fib-8">
                            <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                                UTM
                            </span>
                            <div className="flex items-center gap-1 min-w-0">
                                <span
                                    className={`text-data-dense truncate ${
                                        canonicalFix
                                            ? 'text-[#0F172A] dark:text-[#F3F4F6] select-text'
                                            : 'text-[#94A3B8] dark:text-[#5A6072]'
                                    }`}
                                >
                                    {canonicalFix?.utm.formatted || '--'}
                                </span>
                                {canonicalFix && <CopyButton value={canonicalFix.utm.formatted} />}
                            </div>
                        </div>

                        <div className="px-fib-13 py-fib-13 flex items-center justify-between gap-fib-8">
                            <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                                ρ / P80
                            </span>
                            <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {rhoStr} · {p80Str}
                            </span>
                        </div>

                        <div className="px-fib-13 py-fib-13 flex items-center justify-between gap-fib-8">
                            <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                                CAS
                            </span>
                            <span
                                className={`text-data-dense truncate ${
                                    casTrace
                                        ? 'text-[#00AEEF]'
                                        : 'text-[#94A3B8] dark:text-[#5A6072]'
                                }`}
                            >
                                {casTrace || '--'}
                            </span>
                        </div>

                        {typeof latestGroundSlopeDeg === 'number' &&
                            Number.isFinite(latestGroundSlopeDeg) && (
                                <div className="px-fib-13 py-fib-13 flex items-center justify-between gap-fib-8">
                                    <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                                        {t('visual3d.ground_slope_label', 'PENDIENTE PISO')}
                                    </span>
                                    <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                        {latestGroundSlopeDeg.toFixed(1)}°
                                    </span>
                                </div>
                            )}
                    </section>

                    {/* 5. Historial inmediato de mediciones */}
                    <section className="pb-fib-21">
                        <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between font-mono text-microcopy font-bold uppercase tabular-nums text-[#475569] dark:text-[#8A93A6]">
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
                                    flat={true}
                                />
                            ))}
                        </div>
                    </section>
                </div>

                <GeolappAiEnrichDrawer
                    open={showAiDrawer}
                    asset={asset}
                    hideLabUpload={true}
                    onClose={() => setShowAiDrawer(false)}
                    onApplied={() =>
                        setStatusText(t('hitl.save_success', 'Ficha enriquecida bajo AuditLedger.'))
                    }
                />

                <HitlConfirmModal
                    open={Boolean(pendingHitl)}
                    title={t('hitl.modal_title', 'CONFIRMACIÓN HITL')}
                    description={t(
                        'hitl.modal_description',
                        'Escriba ACTUALIZAR para confirmar el registro oficial.'
                    )}
                    comparisonDiff={pendingHitl?.diffs}
                    loading={isSavingHitl}
                    onConfirm={() => void executePendingHitl()}
                    onCancel={() => setPendingHitl(null)}
                />
            </div>
        );
    }

    // Escritorio (!isMobile)
    const effectiveTab: DossierTab = activeTab;
    const showOverview = effectiveTab === 'RESUMEN';
    const showSpecs = effectiveTab === 'FICHA';

    return (
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none select-none">
            <header className="shrink-0 px-fib-21 h-14 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8 bg-[#F8FAFC] dark:bg-[#07090D]">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shrink-0 flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-h2-section font-bold uppercase truncate">
                            {asset.name}
                        </h1>
                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block truncate">
                            {domainDisplayLabel || t('dossier.report_mode_short', 'INFORME TÉCNICO')}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowAiDrawer(true)}
                        aria-label={t('ai_enrich.open_button', 'Asistente IA')}
                        title={t('ai_enrich.open_button', 'Completar con IA')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-[#00AEEF] hover:text-[#0F172A] dark:hover:text-white cursor-pointer rounded-none flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[22px]">auto_awesome</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleExportPdf}
                        disabled={isExportingPdf}
                        aria-label={t('pdf.export_button', 'Exportar PDF')}
                        title={t('pdf.export_button', 'Exportar PDF')}
                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer disabled:opacity-40 rounded-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">picture_as_pdf</span>
                    </button>
                </div>
            </header>

            {(isExportingPdf || isAnalyzingDigital || isReconstructing3D) && (
                <M3LinearProgress indeterminate ariaLabel="IA / PDF / 3D" />
            )}

            <nav className="shrink-0 grid grid-cols-3 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                {(['RESUMEN', 'FICHA', 'HISTORIAL'] as const).map((tab) => {
                    const active = effectiveTab === tab;
                    const label =
                        tab === 'RESUMEN'
                            ? t('dossier.tab_summary', 'RESUMEN')
                            : tab === 'FICHA'
                              ? t('dossier.tab_spec', 'FICHA TÉCNICA')
                              : t('dossier.tab_history', 'HISTORIAL');
                    return (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveTab(tab)}
                            className={`min-h-[48px] py-fib-13 text-microcopy font-mono font-bold uppercase border-0 border-b-2 cursor-pointer bg-transparent rounded-none transition-colors ${
                                active
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                            }`}
                        >
                            {label}
                        </button>
                    );
                })}
            </nav>

            <div className="flex-1 min-h-0 overflow-y-auto px-fib-21 py-fib-21 space-y-fib-21 max-w-4xl w-full mx-auto">
                {statusText && (
                    <div className="py-fib-8 border-b border-[#00AEEF] text-data-dense font-mono flex items-center justify-between gap-fib-8 rounded-none">
                        <span className="text-[#00AEEF]">{statusText}</span>
                        <button
                            type="button"
                            onClick={() => setStatusText(null)}
                            className="bg-transparent border-0 p-1 cursor-pointer text-[#475569] dark:text-[#8A93A6] rounded-none"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                )}

                {justCreated && (
                    <div className="py-fib-13 border-b border-[#00AEEF] flex items-center justify-between gap-fib-13 rounded-none">
                        <span className="text-data-dense font-mono">
                            {t(
                                'dossier.just_created_prompt',
                                'Acopio georreferenciado y cubicado.'
                            )}
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowAiDrawer(true)}
                            className="px-fib-13 py-1.5 bg-[#00AEEF] text-white text-microcopy font-mono font-bold uppercase border-0 cursor-pointer shrink-0 rounded-none"
                        >
                            {t('ai_enrich.cta_short', 'ASISTIR IA')}
                        </button>
                    </div>
                )}

                <CopperGovernanceBanner result={governanceResult} />

                {showOverview && (
                    <div className="space-y-fib-21">
                        {isPendingDigitalAi && (
                            <button
                                type="button"
                                onClick={() => void handleAnalyzeDigitalNow()}
                                disabled={isAnalyzingDigital}
                                className="w-full min-h-[52px] bg-[#00AEEF] hover:bg-[#0096CE] text-white font-mono text-microcopy font-bold uppercase tracking-wider border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-fib-8 rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    auto_awesome
                                </span>
                                <span>
                                    {t('digital_v2.analyze_now_btn', 'ANALIZAR AHORA IA')}
                                </span>
                            </button>
                        )}

                        <div className="grid grid-cols-2 gap-fib-13">
                            <button
                                type="button"
                                onClick={onNewMeasurement}
                                disabled={isClosed}
                                className="h-12 bg-[#C68346] hover:bg-[#b5753b] text-white font-mono text-microcopy font-bold uppercase tracking-wider border-0 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-fib-8 rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    add_a_photo
                                </span>
                                <span>
                                    {t('analytics.new_measurement_button', 'NUEVA MEDICIÓN')}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowAiDrawer(true)}
                                className="h-12 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#00AEEF] text-[#00AEEF] hover:bg-[#00AEEF]/10 font-mono text-microcopy font-bold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-fib-8 rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    auto_awesome
                                </span>
                                <span>{t('ai_enrich.cta_short', 'COMPLETAR IA')}</span>
                            </button>
                        </div>

                        {typeof slopeAngleDeg === 'number' && (
                            <div className="py-fib-8 border-b border-[#00AEEF] flex items-center justify-between gap-fib-8 font-mono text-microcopy rounded-none">
                                <span className="uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('digital_v2.slope_label', 'TALUD DETECTADO')}
                                </span>
                                <span
                                    className={`font-bold tabular-nums ${
                                        isSlopeException ? 'text-[#C68346]' : 'text-[#00AEEF]'
                                    }`}
                                >
                                    α {slopeAngleDeg.toFixed(1)}°
                                </span>
                            </div>
                        )}

                        {asset.slope_warning && (
                            <div className="py-fib-8 border-b border-[#C68346] font-mono text-microcopy text-[#C68346] rounded-none">
                                {asset.slope_warning}
                            </div>
                        )}

                        <section className="grid grid-cols-2 sm:grid-cols-3 gap-fib-13">
                            <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    {t('dossier.volume_label', 'VOLUMEN')}
                                </span>
                                <div className="flex items-baseline gap-fib-8 flex-wrap">
                                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#C68346]">
                                        {summary.volumeM3.toLocaleString(undefined, {
                                            maximumFractionDigits: 2,
                                        })}{' '}
                                        m³
                                    </span>
                                    {typeof latestUncertaintyPct === 'number' &&
                                        Number.isFinite(latestUncertaintyPct) &&
                                        latestUncertaintyPct > 0 && (
                                            <span
                                                className={`text-microcopy font-mono font-bold tabular-nums ${
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
                            <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    {t('dossier.tonnage_label', 'TONELAJE')}
                                </span>
                                <span className="text-h1-header font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {summary.weightT > 0
                                        ? `${summary.weightT.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`
                                        : UNDECLARED_TECH_VALUE}
                                </span>
                            </div>
                            <div className="col-span-2 sm:col-span-1 p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block">
                                    {t('history.delta_volume', 'Δ CAMPAÑA')}
                                </span>
                                <span className="text-h2-section font-mono font-bold tabular-nums text-[#00AEEF]">
                                    {deltaText || '--'}
                                </span>
                            </div>
                        </section>

                        <section className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <StockpileVisualStage
                                isMobile={false}
                                mode={visualMode}
                                onModeChange={setVisualMode}
                                hideModeToolbar={false}
                                photoUrl={latestHeroPhoto}
                                initialPhotoUrl={asset.initial_photo_url}
                                perimeterPhotoUrls={
                                    latestMeas?.perimeter_photo_urls ?? asset.perimeter_photo_urls
                                }
                                boulderDetections={
                                    latestMeas?.boulder_detections ?? asset.boulder_detections
                                }
                                slopeAngleDeg={slopeAngleDeg}
                                meshUrl={latestMeshUrl}
                                fallbackGeometry={latestFallbackGeometry}
                                copperDomain={asset.copper_domain}
                                tinVolumeM3={latestTinVolumeM3}
                                casMetrics={latestCasMetrics}
                                meshSource={latestMeshSource}
                                uncertaintyPct={latestUncertaintyPct}
                                toeScore={latestToeScore}
                                coveragePct={latestCoveragePct}
                                depthMode={latestDepthMode}
                                altLabel={asset.name}
                                canReconstruct3D={canReconstruct3D}
                                isReconstructing3D={isReconstructing3D}
                                onReconstruct3D={() => void handleReconstruct3D()}
                                heightPx={320}
                            />
                            {casTrace && (
                                <div className="mt-fib-8 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy tabular-nums text-[#00AEEF]">
                                    CAS: {casTrace}
                                </div>
                            )}
                        </section>

                        <StockpileStaticMapCard
                            asset={asset}
                            fix={canonicalFix}
                            heightPx={200}
                            flat={false}
                        />
                    </div>
                )}

                {showSpecs && (
                    <div className="space-y-fib-21">
                        <ReportBlockEditable
                            code="01"
                            title={t('dossier.block_identity', 'IDENTIFICACIÓN Y GEORREFERENCIA')}
                            isEditing={editingBlock === 'identity'}
                            onToggleEdit={() =>
                                setEditingBlock((p) => (p === 'identity' ? null : 'identity'))
                            }
                            flat={false}
                        >
                            {editingBlock === 'identity' ? (
                                <form
                                    autoComplete="off"
                                    spellCheck={false}
                                    onSubmit={queueIdentityPatch}
                                    className="space-y-fib-13"
                                >
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draftName}
                                        onChange={(e) => setDraftName(e.target.value)}
                                        placeholder={t('registration.name_label', 'ID / NOMBRE')}
                                        className="w-full h-10 px-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                                    />
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draftLocationRef}
                                        onChange={(e) => setDraftLocationRef(e.target.value)}
                                        placeholder={t('registration.location_ref_label', 'UBICACIÓN')}
                                        className="w-full h-10 px-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                                    />
                                    <textarea
                                        rows={2}
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draftDescription}
                                        onChange={(e) => setDraftDescription(e.target.value)}
                                        placeholder={t('registration.description_label', 'DESCRIPCIÓN')}
                                        className="w-full p-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense rounded-none"
                                    />
                                    <button
                                        type="submit"
                                        className="px-fib-21 py-2 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                                    >
                                        {t('hitl.save_audit', 'REVISAR HITL')}
                                    </button>
                                </form>
                            ) : (
                                <div>
                                    <ReportFieldRow
                                        label={t('registration.name_label', 'CÓDIGO')}
                                        value={asset.name}
                                        copyable
                                    />
                                    <ReportFieldRow
                                        label={t('registration.location_ref_label', 'UBICACIÓN')}
                                        value={asset.location_ref}
                                    />
                                    <ReportFieldRow
                                        label={t('analytics.geospatial_utm_title', 'UTM WGS84')}
                                        value={canonicalFix?.utm.formatted}
                                        copyable={Boolean(canonicalFix)}
                                    />
                                    <ReportFieldRow
                                        label={t('registration.description_label', 'DESCRIPCIÓN')}
                                        value={asset.description}
                                        mono={false}
                                    />
                                </div>
                            )}
                        </ReportBlockEditable>

                        <ReportBlockEditable
                            code="02"
                            title={t('dossier.block_material', 'MATERIAL Y DENSIDAD')}
                            isEditing={editingBlock === 'material'}
                            onToggleEdit={() =>
                                setEditingBlock((p) => (p === 'material' ? null : 'material'))
                            }
                            flat={false}
                        >
                            {editingBlock === 'material' ? (
                                <form
                                    autoComplete="off"
                                    spellCheck={false}
                                    onSubmit={queueMaterialPatch}
                                    className="space-y-fib-13"
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-8">
                                        {COPPER_DOMAIN_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setDraftCopperDomain(opt.value)}
                                                className={`p-fib-8 border text-left text-microcopy font-mono font-bold uppercase cursor-pointer rounded-none ${
                                                    draftCopperDomain === opt.value
                                                        ? 'border-[#C68346] bg-[#C68346]/10 text-[#C68346]'
                                                        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6]'
                                                }`}
                                            >
                                                {t(opt.labelKey, opt.fallbackLabel)}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-fib-13">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draftDensity}
                                            onChange={(e) =>
                                                setDraftDensity(sanitizeDecimalText(e.target.value))
                                            }
                                            placeholder={t(
                                                'manual_capture.fields.density_factor',
                                                'DENSIDAD (t/m³)'
                                            )}
                                            className="h-10 px-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                        <div className="grid grid-cols-4 gap-1">
                                            {(['COLPAS', 'GRANSA', 'MIXTO', 'FINOS'] as const).map(
                                                (g) => (
                                                    <button
                                                        key={g}
                                                        type="button"
                                                        onClick={() => setDraftGranulometry(g)}
                                                        className={`border text-microcopy font-mono font-bold cursor-pointer rounded-none ${
                                                            draftGranulometry === g
                                                                ? 'border-[#C68346] bg-[#C68346]/10 text-[#C68346]'
                                                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#475569] dark:text-[#8A93A6]'
                                                        }`}
                                                    >
                                                        {g.slice(0, 4)}
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        type="submit"
                                        className="px-fib-21 py-2 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                                    >
                                        {t('hitl.save_audit', 'REVISAR HITL')}
                                    </button>
                                </form>
                            ) : (
                                <div>
                                    <ReportFieldRow
                                        label={t('registration.copper_domain_label', 'DOMINIO Cu')}
                                        value={domainDisplayLabel}
                                    />
                                    <ReportFieldRow
                                        label={t(
                                            'manual_capture.fields.density_factor',
                                            'DENSIDAD'
                                        )}
                                        value={
                                            asset.density_factor != null
                                                ? `${asset.density_factor} t/m³`
                                                : null
                                        }
                                    />
                                    <ReportFieldRow
                                        label={t('scanner.granulometry_label', 'GRANULOMETRÍA')}
                                        value={asset.tipo_granulometria}
                                    />
                                    <ReportFieldRow
                                        label={t('rosin_rammler.p80_label', 'P80 (mm)')}
                                        value={
                                            typeof asset.p80_mm === 'number'
                                                ? `${asset.p80_mm.toFixed(1)} mm`
                                                : null
                                        }
                                    />
                                    {typeof latestGroundSlopeDeg === 'number' &&
                                        Number.isFinite(latestGroundSlopeDeg) && (
                                            <ReportFieldRow
                                                label={t(
                                                    'visual3d.ground_slope_label',
                                                    'PENDIENTE PISO'
                                                )}
                                                value={`${latestGroundSlopeDeg.toFixed(1)}°`}
                                            />
                                        )}
                                    {typeof latestUncertaintyPct === 'number' &&
                                        Number.isFinite(latestUncertaintyPct) && (
                                            <ReportFieldRow
                                                label={t(
                                                    'visual3d.uncertainty_label',
                                                    'INCERTIDUMBRE'
                                                )}
                                                value={`± ${latestUncertaintyPct.toFixed(1)}%`}
                                            />
                                        )}
                                    {typeof latestCoveragePct === 'number' &&
                                        Number.isFinite(latestCoveragePct) && (
                                            <ReportFieldRow
                                                label={t(
                                                    'visual3d.coverage_label',
                                                    'COBERTURA PERIMETRAL'
                                                )}
                                                value={`${Math.round(latestCoveragePct)}%`}
                                            />
                                        )}
                                    {typeof latestToeScore === 'number' &&
                                        Number.isFinite(latestToeScore) && (
                                            <ReportFieldRow
                                                label={t(
                                                    'visual3d.toe_score_label',
                                                    'CONFIANZA PIE (TOE)'
                                                )}
                                                value={`${Math.round(latestToeScore)}%`}
                                            />
                                        )}
                                    {latestDepthModeDisplay && (
                                        <ReportFieldRow
                                            label={t(
                                                'visual3d.depth_mode_label',
                                                'SENSOR ESPACIAL'
                                            )}
                                            value={latestDepthModeDisplay}
                                        />
                                    )}
                                </div>
                            )}
                        </ReportBlockEditable>

                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none">
                            <button
                                type="button"
                                onClick={() => setShowMetallurgyBlock((p) => !p)}
                                className="w-full px-fib-21 py-fib-13 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#000000] border-0 cursor-pointer rounded-none"
                            >
                                <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                    03 ·{' '}
                                    {t('copper_governance.title', 'GEO-METALURGIA Cu E IMSBC')}
                                </span>
                                <span className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6]">
                                    {showMetallurgyBlock ? 'expand_less' : 'expand_more'}
                                </span>
                            </button>
                            {showMetallurgyBlock && (
                                <ReportBlockEditable
                                    title={t('copper_governance.title', 'ENSAYES Y ROMANA')}
                                    isEditing={editingBlock === 'metallurgy'}
                                    onToggleEdit={() =>
                                        setEditingBlock((p) =>
                                            p === 'metallurgy' ? null : 'metallurgy'
                                        )
                                    }
                                    className="border-0 border-t"
                                >
                                    {editingBlock === 'metallurgy' ? (
                                        <form
                                            autoComplete="off"
                                            spellCheck={false}
                                            onSubmit={queueMetallurgyPatch}
                                            className="space-y-fib-13"
                                        >
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-8">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draftMoisture}
                                                    onChange={(e) =>
                                                        setDraftMoisture(
                                                            sanitizeDecimalText(e.target.value)
                                                        )
                                                    }
                                                    placeholder="w %"
                                                    className="h-10 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draftCuT}
                                                    onChange={(e) =>
                                                        setDraftCuT(
                                                            sanitizeDecimalText(e.target.value)
                                                        )
                                                    }
                                                    placeholder="CuT %"
                                                    className="h-10 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draftCuS}
                                                    onChange={(e) =>
                                                        setDraftCuS(
                                                            sanitizeDecimalText(e.target.value)
                                                        )
                                                    }
                                                    placeholder="CuS %"
                                                    className="h-10 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draftTml}
                                                    onChange={(e) =>
                                                        setDraftTml(
                                                            sanitizeDecimalText(e.target.value)
                                                        )
                                                    }
                                                    placeholder="TML %"
                                                    className="h-10 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draftResidenceDays}
                                                    onChange={(e) =>
                                                        setDraftResidenceDays(
                                                            sanitizeDecimalText(e.target.value)
                                                        )
                                                    }
                                                    placeholder="Días"
                                                    className="h-10 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draftRomana}
                                                    onChange={(e) =>
                                                        setDraftRomana(
                                                            sanitizeDecimalText(e.target.value)
                                                        )
                                                    }
                                                    placeholder="Romana t"
                                                    className="h-10 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </div>
                                            <button
                                                type="submit"
                                                className="px-fib-21 py-2 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                                            >
                                                {t('hitl.save_audit', 'REVISAR HITL')}
                                            </button>
                                        </form>
                                    ) : (
                                        <div>
                                            <ReportFieldRow
                                                label={t('copper_governance.moisture', 'HUMEDAD w%')}
                                                value={
                                                    asset.moisture_pct != null
                                                        ? `${asset.moisture_pct} %`
                                                        : null
                                                }
                                            />
                                            <ReportFieldRow
                                                label="CuT / CuS"
                                                value={
                                                    asset.cu_total_pct != null ||
                                                    asset.cu_soluble_pct != null
                                                        ? `${asset.cu_total_pct ?? '--'}% / ${asset.cu_soluble_pct ?? '--'}%`
                                                        : null
                                                }
                                            />
                                            <ReportFieldRow
                                                label={t('copper_governance.fine_cu', 'Cu FINO')}
                                                value={
                                                    summary.fineCuT != null
                                                        ? `${summary.fineCuT} t`
                                                        : null
                                                }
                                            />
                                            <ReportFieldRow
                                                label={t('copper_governance.tml', 'TML IMSBC')}
                                                value={
                                                    asset.tml_pct != null
                                                        ? `${asset.tml_pct} %`
                                                        : null
                                                }
                                            />
                                            <ReportFieldRow
                                                label={t(
                                                    'copper_governance.scale_weight',
                                                    'PESO ROMANA'
                                                )}
                                                value={
                                                    asset.peso_romana != null
                                                        ? `${asset.peso_romana} t`
                                                        : null
                                                }
                                            />
                                        </div>
                                    )}
                                </ReportBlockEditable>
                            )}
                        </div>
                    </div>
                )}

                {effectiveTab === 'HISTORIAL' && (
                    <div className="space-y-fib-21">
                        <div className="space-y-fib-8">
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
                                    flat={false}
                                />
                            ))}
                        </div>

                        <section className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] space-y-fib-13 rounded-none">
                            {isClosed ? (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setPendingHitl({
                                            kind: 'REOPEN_CYCLE',
                                            diffs: [
                                                {
                                                    field: 'status',
                                                    current: 'CLOSED',
                                                    suggested: 'ACTIVE',
                                                },
                                            ],
                                        })
                                    }
                                    className="w-full py-2.5 border border-[#C68346] text-[#C68346] font-mono text-microcopy font-bold uppercase bg-transparent cursor-pointer rounded-none"
                                >
                                    {t('lifecycle.reopen_action', 'REABRIR CICLO (HITL)')}
                                </button>
                            ) : showShipmentForm ? (
                                <form
                                    autoComplete="off"
                                    spellCheck={false}
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (!dispatchRefDraft.trim()) return;
                                        setPendingHitl({
                                            kind: 'CLOSE_SHIPMENT',
                                            dispatchReference: dispatchRefDraft.trim(),
                                            shippedWeightT: parseNullableNonNegativeNumber(
                                                shippedWeightDraft
                                            ),
                                            diffs: [
                                                {
                                                    field: t(
                                                        'lifecycle.dispatch_reference_label',
                                                        'DESPACHO'
                                                    ),
                                                    current: '--',
                                                    suggested: dispatchRefDraft.trim(),
                                                },
                                            ],
                                        });
                                    }}
                                    className="space-y-fib-8"
                                >
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={dispatchRefDraft}
                                        onChange={(e) => setDispatchRefDraft(e.target.value)}
                                        placeholder={t(
                                            'lifecycle.dispatch_reference_label',
                                            'GUÍA / LOTE DE EMBARQUE'
                                        )}
                                        className="w-full h-10 px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                                    />
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={shippedWeightDraft}
                                        onChange={(e) =>
                                            setShippedWeightDraft(
                                                sanitizeDecimalText(e.target.value)
                                            )
                                        }
                                        placeholder={t(
                                            'lifecycle.shipped_weight_label',
                                            'TONELAJE EMBARCADO [t]'
                                        )}
                                        className="w-full h-10 px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                    <div className="flex gap-fib-8">
                                        <button
                                            type="submit"
                                            className="flex-1 py-2 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                                        >
                                            {t('lifecycle.confirm_shipment_hitl', 'VERIFICAR EMBARQUE')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowShipmentForm(false)}
                                            className="px-fib-13 py-2 border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy font-bold uppercase bg-transparent cursor-pointer rounded-none"
                                        >
                                            {t('common.cancel_button', 'CANCELAR')}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowShipmentForm(true)}
                                    disabled={governanceResult.hasCriticalBlock}
                                    className="w-full py-2.5 border border-[#C68346] text-[#C68346] font-mono text-microcopy font-bold uppercase bg-transparent cursor-pointer disabled:opacity-40 rounded-none"
                                >
                                    {t('lifecycle.close_shipment_action', 'CERRAR POR EMBARQUE')}
                                </button>
                            )}
                        </section>
                    </div>
                )}
            </div>

            <GeolappAiEnrichDrawer
                open={showAiDrawer}
                asset={asset}
                hideLabUpload={false}
                onClose={() => setShowAiDrawer(false)}
                onApplied={() =>
                    setStatusText(t('hitl.save_success', 'Ficha enriquecida bajo AuditLedger.'))
                }
            />

            <HitlConfirmModal
                open={Boolean(pendingHitl)}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL')}
                description={t(
                    'hitl.modal_description',
                    'Escriba ACTUALIZAR para confirmar el registro oficial.'
                )}
                comparisonDiff={pendingHitl?.diffs}
                loading={isSavingHitl}
                onConfirm={() => void executePendingHitl()}
                onCancel={() => setPendingHitl(null)}
            />
        </div>
    );
};
