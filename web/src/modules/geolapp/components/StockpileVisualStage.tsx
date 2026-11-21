import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { SecureImage } from '../../../components/common/SecureImage';
import { useResolvedStockpileImageState } from '../core/services/StorageService';
import type { BoulderDetectionBox2D } from '../core/types/GeolappTypes';
import { isValidBox2D } from '../core/utils/rosinRammler';
import { StockpileTwin3DLazy } from './StockpileTwin3DLazy';

export type StockpileVisualMode = 'PHOTO' | '3D' | 'DUAL' | 'MAP';

export interface StockpileVisualStageProps {
    photoUrl?: string | null;
    /** @deprecated Solo se exhibe la foto actual en StockpileVisualStage */
    initialPhotoUrl?: string | null;
    /** @deprecated Carrusel eliminado; historial fotográfico en listado de mediciones */
    perimeterPhotoUrls?: string[];
    boulderDetections?: BoulderDetectionBox2D[];
    slopeAngleDeg?: number | null;
    meshUrl?: string | null;
    fallbackGeometry?: {
        type: string;
        dimensions: Record<string, number | undefined>;
    } | null;
    copperDomain?: string;
    tinVolumeM3?: number | null;
    casMetrics?: {
        originalBytes?: number;
        optimizedBytes?: number;
        savingsPct?: number;
        sha256?: string;
    };
    meshSource?: string;
    uncertaintyPct?: number | null;
    toeScore?: number | null;
    coveragePct?: number | null;
    depthMode?: string | null;
    altLabel?: string;
    mapNode?: React.ReactNode;
    isMobile?: boolean;
    heightPx?: number;
    canReconstruct3D?: boolean;
    isReconstructing3D?: boolean;
    onReconstruct3D?: () => void;
    mode?: StockpileVisualMode;
    defaultMode?: StockpileVisualMode;
    onModeChange?: (mode: StockpileVisualMode) => void;
    hideModeToolbar?: boolean;
    compact?: boolean;
    showMetrologyFooter?: boolean;
}

const PENDING_RECORD = '[Pendiente de registro]';
const FLAT_ICON_BTN_CLASS =
    'bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer rounded-none shadow-none inline-flex items-center justify-center';

function formatDepthModeLabel(depthMode?: string | null): string | null {
    if (typeof depthMode !== 'string') return null;
    const normalized = depthMode.trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'RAW_DEPTH_ONLY') return 'ARCORE RAW DEPTH';
    if (normalized === 'AUTOMATIC') return 'ARCORE DEPTH';
    if (normalized === 'VIO_POINTCLOUD') return 'ARCORE VIO';
    return depthMode.trim();
}

function formatCasBytesCompact(bytes?: number): string | null {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
}

export const StockpileVisualStage: React.FC<StockpileVisualStageProps> = ({
    photoUrl,
    boulderDetections,
    slopeAngleDeg,
    meshUrl,
    fallbackGeometry,
    copperDomain,
    tinVolumeM3,
    casMetrics,
    meshSource,
    uncertaintyPct,
    toeScore,
    coveragePct,
    depthMode,
    altLabel,
    mapNode,
    isMobile = false,
    heightPx,
    canReconstruct3D = false,
    isReconstructing3D = false,
    onReconstruct3D,
    mode,
    defaultMode,
    onModeChange,
    hideModeToolbar = false,
    compact,
    showMetrologyFooter,
}) => {
    const { t } = useTranslation();

    const normalizeMode = (raw: StockpileVisualMode): StockpileVisualMode =>
        isMobile && raw === 'DUAL' ? '3D' : raw;

    const [internalMode, setInternalMode] = useState<StockpileVisualMode>(() =>
        normalizeMode(defaultMode ?? (isMobile ? 'PHOTO' : 'DUAL'))
    );

    const effectiveMode: StockpileVisualMode = normalizeMode(
        mode !== undefined ? mode : internalMode
    );

    const handleSelectMode = (nextMode: StockpileVisualMode) => {
        const normalized = normalizeMode(nextMode);
        if (mode === undefined) {
            setInternalMode(normalized);
        }
        onModeChange?.(normalized);
    };

    const activeRawPhotoUrl = typeof photoUrl === 'string' ? photoUrl.trim() : '';

    const { resolvedUrl: resolvedPhoto, isLoading: isPhotoLoading } = useResolvedStockpileImageState(
        activeRawPhotoUrl || null
    );
    const [photoLoadFailedForUrl, setPhotoLoadFailedForUrl] = useState<string | null>(null);

    const validBoulders = useMemo(
        () =>
            (boulderDetections ?? []).filter(
                (item) => Boolean(item) && isValidBox2D(item.box_2d)
            ),
        [boulderDetections]
    );

    const showBoulderOverlay = Boolean(activeRawPhotoUrl) && validBoulders.length > 0;
    const showSlopeOverlay = typeof slopeAngleDeg === 'number' && Number.isFinite(slopeAngleDeg);

    const cleanMeshUrl = typeof meshUrl === 'string' ? meshUrl.trim() : '';
    const hasDeclaredGeometry = Boolean(
        fallbackGeometry?.type &&
            fallbackGeometry?.dimensions &&
            Object.values(fallbackGeometry.dimensions).some(
                (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
            )
    );
    const canRender3D = Boolean(cleanMeshUrl || hasDeclaredGeometry);
    const stageHeightPx = heightPx ?? (isMobile ? 236 : 340);

    const baseModeOptions: Array<{ id: StockpileVisualMode; icon: string; label: string }> = isMobile
        ? [
              { id: 'PHOTO', icon: 'photo_camera', label: t('visual.mode_photo', 'FOTO') },
              { id: '3D', icon: 'deployed_code', label: t('visual.mode_3d', '3D') },
          ]
        : [
              { id: 'PHOTO', icon: 'photo_camera', label: t('visual.mode_photo', 'FOTO') },
              { id: '3D', icon: 'deployed_code', label: t('visual.mode_3d', '3D') },
              { id: 'DUAL', icon: 'view_column_2', label: t('visual.mode_dual', 'FOTO + 3D') },
          ];
    const modeOptions: Array<{ id: StockpileVisualMode; icon: string; label: string }> = mapNode
        ? [...baseModeOptions, { id: 'MAP', icon: 'satellite_alt', label: t('visual.mode_map', 'MAPA') }]
        : baseModeOptions;

    const showPhotoPanel = effectiveMode === 'PHOTO' || effectiveMode === 'DUAL';
    const show3DPanel = effectiveMode === '3D' || effectiveMode === 'DUAL';

    const hasTinVolume = typeof tinVolumeM3 === 'number' && Number.isFinite(tinVolumeM3);
    const hasUncertainty = typeof uncertaintyPct === 'number' && Number.isFinite(uncertaintyPct);
    const hasCoverage = typeof coveragePct === 'number' && Number.isFinite(coveragePct);
    const hasToeScore = typeof toeScore === 'number' && Number.isFinite(toeScore);
    const depthModeLabel = formatDepthModeLabel(depthMode);
    const cleanMeshSource = typeof meshSource === 'string' ? meshSource.trim() : '';

    const casOrigText = formatCasBytesCompact(casMetrics?.originalBytes);
    const casOptText = formatCasBytesCompact(casMetrics?.optimizedBytes);
    const casPctText =
        typeof casMetrics?.savingsPct === 'number' && Number.isFinite(casMetrics.savingsPct)
            ? `(-${casMetrics.savingsPct.toFixed(0)}%)`
            : null;
    const casSummaryLabel =
        casOrigText && casOptText
            ? `${casOrigText} -> ${casOptText}${casPctText ? ` ${casPctText}` : ''}`
            : casOptText
              ? `${casOptText}${casPctText ? ` ${casPctText}` : ''}`
              : casPctText;

    const effectiveCompact = compact ?? isMobile;
    const effectiveShowMetrologyFooter = showMetrologyFooter ?? !effectiveCompact;
    const hasMetrologyData = Boolean(
        hasTinVolume ||
            hasUncertainty ||
            hasCoverage ||
            hasToeScore ||
            depthModeLabel ||
            casSummaryLabel ||
            cleanMeshSource
    );

    const uncertaintyColorClass =
        hasUncertainty && (uncertaintyPct as number) <= 5
            ? 'text-[#00AEEF]'
            : hasUncertainty && (uncertaintyPct as number) > 8
              ? 'text-[#C68346]'
              : 'text-[#0F172A] dark:text-[#F3F4F6]';

    const coverageColorClass =
        hasCoverage && (coveragePct as number) >= 75
            ? 'text-[#00AEEF]'
            : hasCoverage && (coveragePct as number) < 60
              ? 'text-[#C68346]'
              : 'text-[#0F172A] dark:text-[#F3F4F6]';

    const toeColorClass =
        hasToeScore && (toeScore as number) >= 75
            ? 'text-[#00AEEF]'
            : hasToeScore && (toeScore as number) < 60
              ? 'text-[#C68346]'
              : 'text-[#0F172A] dark:text-[#F3F4F6]';

    const photoPanel = (
        <div className="min-w-0 flex flex-col gap-fib-8">
            <div
                style={{ height: `${stageHeightPx}px` }}
                className="relative w-full bg-[#F8FAFC] dark:bg-[#030508] flex items-center justify-center overflow-hidden rounded-none shadow-none"
            >
                {isPhotoLoading ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-[#030508] rounded-none shadow-none relative">
                        <div className="absolute top-0 left-0 right-0">
                            <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'CARGANDO...')} />
                        </div>
                        <span className="material-symbols-outlined text-[28px] text-[#94A3B8] dark:text-[#5A6072]">
                            photo_camera
                        </span>
                    </div>
                ) : resolvedPhoto && photoLoadFailedForUrl !== resolvedPhoto ? (
                    <>
                        <SecureImage
                            src={resolvedPhoto}
                            alt={altLabel || t('digital_v2.photo_alt', 'Captura acopio')}
                            className="w-full h-full object-contain"
                            onError={() => setPhotoLoadFailedForUrl(resolvedPhoto)}
                        />
                        {showBoulderOverlay && (
                            <svg
                                viewBox="0 0 1000 1000"
                                preserveAspectRatio="none"
                                aria-hidden="true"
                                className="absolute inset-0 w-full h-full pointer-events-none"
                            >
                                {validBoulders.map((b, idx) => {
                                    const [ymin, xmin, ymax, xmax] = b.box_2d;
                                    const isOversize =
                                        typeof b.estimated_mm === 'number' &&
                                        b.estimated_mm >= 250;
                                    const stroke = isOversize ? '#C68346' : '#00AEEF';
                                    return (
                                        <g key={`${ymin}_${xmin}_${ymax}_${xmax}_${idx}`}>
                                            <rect
                                                x={xmin}
                                                y={ymin}
                                                width={Math.max(1, xmax - xmin)}
                                                height={Math.max(1, ymax - ymin)}
                                                fill="none"
                                                stroke={stroke}
                                                strokeWidth={4}
                                                vectorEffect="non-scaling-stroke"
                                            />
                                            {typeof b.estimated_mm === 'number' && (
                                                <text
                                                    x={Math.min(910, xmin + 8)}
                                                    y={Math.max(26, ymin + 24)}
                                                    fill={stroke}
                                                    fontSize="24"
                                                    fontFamily="monospace"
                                                    fontWeight="700"
                                                >
                                                    {Math.round(b.estimated_mm)}mm
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#F8FAFC] dark:bg-[#030508] rounded-none shadow-none">
                        <span className="material-symbols-outlined text-[36px] text-[#94A3B8] dark:text-[#5A6072]">
                            image_not_supported
                        </span>
                        <span className="font-mono tabular-nums text-microcopy font-bold uppercase tracking-[0.06em] text-[#94A3B8] dark:text-[#5A6072]">
                            {t('visual.no_photo', 'SIN FOTO')}
                        </span>
                    </div>
                )}

                {showSlopeOverlay && slopeAngleDeg != null && (
                    <span
                        className={`absolute bottom-fib-8 left-fib-8 z-10 pointer-events-none px-fib-8 py-0.5 bg-[#FFFFFF]/85 dark:bg-[#000000]/80 font-mono tabular-nums text-microcopy font-bold rounded-none ${
                            slopeAngleDeg > 38 ? 'text-[#C68346]' : 'text-[#00AEEF]'
                        }`}
                    >
                        α {slopeAngleDeg.toFixed(1)}°
                    </span>
                )}
            </div>
        </div>
    );

    const twinPanel = show3DPanel ? (
        <div className="min-w-0 relative">
            {canRender3D ? (
                <>
                    <StockpileTwin3DLazy
                        compact
                        heightPx={stageHeightPx}
                        meshUrl={cleanMeshUrl || null}
                        fallbackGeometry={fallbackGeometry}
                        copperDomain={copperDomain}
                        tinVolumeM3={tinVolumeM3}
                        casMetrics={casMetrics}
                        meshSource={meshSource}
                    />
                    {hideModeToolbar &&
                        canReconstruct3D &&
                        !cleanMeshUrl &&
                        onReconstruct3D && (
                            <button
                                type="button"
                                onClick={onReconstruct3D}
                                disabled={isReconstructing3D}
                                title={t('twin3d.reconstruct_button', 'RECONSTRUIR MALLA 3D')}
                                aria-label={t('twin3d.reconstruct_button', 'RECONSTRUIR MALLA 3D')}
                                className={`${FLAT_ICON_BTN_CLASS} ${
                                    isMobile ? 'min-w-[48px] min-h-[48px]' : ''
                                } absolute bottom-10 right-fib-8 z-10`}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    view_in_ar
                                </span>
                            </button>
                        )}
                </>
            ) : (
                <div
                    style={{ height: `${stageHeightPx}px` }}
                    className="w-full bg-[#F8FAFC] dark:bg-[#030508] flex flex-col items-center justify-center gap-fib-8 rounded-none shadow-none"
                >
                    <span className="material-symbols-outlined text-[32px] text-[#94A3B8] dark:text-[#5A6072]">
                        deployed_code
                    </span>
                    {canReconstruct3D && onReconstruct3D ? (
                        <button
                            type="button"
                            onClick={onReconstruct3D}
                            disabled={isReconstructing3D}
                            title={t('twin3d.reconstruct_button', 'RECONSTRUIR MALLA 3D')}
                            aria-label={t('twin3d.reconstruct_button', 'RECONSTRUIR MALLA 3D')}
                            className={`${FLAT_ICON_BTN_CLASS} ${
                                isMobile ? 'min-w-[48px] min-h-[48px]' : ''
                            }`}
                        >
                            <span className="material-symbols-outlined text-[22px]">
                                view_in_ar
                            </span>
                        </button>
                    ) : (
                        <span className="text-microcopy font-mono font-bold uppercase text-[#94A3B8] dark:text-[#5A6072]">
                            {effectiveCompact
                                ? t('twin3d.no_model_3d', 'SIN MODELO 3D')
                                : t('common.pending_record', PENDING_RECORD)}
                        </span>
                    )}
                </div>
            )}
        </div>
    ) : null;

    return (
        <div className="w-full flex flex-col gap-fib-8 rounded-none shadow-none select-none font-atkinson">
            {!hideModeToolbar && (
                <div className="flex items-center justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-transparent">
                    <div
                        className="flex items-center gap-fib-13"
                        role="tablist"
                        aria-label={t('visual.mode_aria', 'Modo visual')}
                    >
                        {modeOptions.map((opt) => {
                            const isActive = effectiveMode === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-label={opt.label}
                                    title={opt.label}
                                    onClick={() => handleSelectMode(opt.id)}
                                    className={`inline-flex items-center justify-center border-0 border-b-2 bg-transparent cursor-pointer rounded-none shadow-none transition-colors ${
                                        isMobile ? 'min-w-[48px] min-h-[48px] px-fib-8' : 'py-fib-8 px-2'
                                    } ${
                                        isActive
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                                        {opt.icon}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {canReconstruct3D && !cleanMeshUrl && onReconstruct3D && (
                        <button
                            type="button"
                            onClick={onReconstruct3D}
                            disabled={isReconstructing3D}
                            title={t('twin3d.reconstruct_button', 'RECONSTRUIR MALLA 3D')}
                            aria-label={t('twin3d.reconstruct_button', 'RECONSTRUIR MALLA 3D')}
                            className={`${FLAT_ICON_BTN_CLASS} ${
                                isMobile ? 'min-w-[48px] min-h-[48px]' : ''
                            }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                view_in_ar
                            </span>
                        </button>
                    )}
                </div>
            )}

            {isReconstructing3D && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('twin3d.reconstructing', 'RECONSTRUYENDO GEMELO 3D...')}
                />
            )}

            {effectiveMode === 'MAP' && mapNode ? (
                mapNode
            ) : effectiveMode === 'DUAL' ? (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.618fr] gap-fib-13 items-start">
                    {photoPanel}
                    {twinPanel}
                </div>
            ) : (
                <>
                    {showPhotoPanel && photoPanel}
                    {show3DPanel && twinPanel}
                </>
            )}

            {effectiveShowMetrologyFooter && hasMetrologyData && (
                <div className="flex flex-wrap items-center justify-between gap-fib-8 px-fib-13 py-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] bg-transparent font-mono tabular-nums text-microcopy text-[#475569] dark:text-[#8A93A6] rounded-none shadow-none">
                    <div className="flex flex-wrap items-center gap-fib-13 min-w-0">
                        {hasTinVolume && (
                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                V_TIN {(tinVolumeM3 as number).toFixed(2)} m³
                            </span>
                        )}
                        {hasUncertainty && (
                            <span
                                title={t('visual3d.uncertainty_label', 'INCERTIDUMBRE')}
                                aria-label={`${t('visual3d.uncertainty_label', 'INCERTIDUMBRE')}: ± ${(uncertaintyPct as number).toFixed(1)}%`}
                                className={`font-bold ${uncertaintyColorClass}`}
                            >
                                ± {(uncertaintyPct as number).toFixed(1)}%
                            </span>
                        )}
                        {hasCoverage && (
                            <span
                                title={t('visual3d.coverage_label', 'COBERTURA PERIMETRAL')}
                                aria-label={`${t('visual3d.coverage_label', 'COBERTURA PERIMETRAL')}: ${Math.round(coveragePct as number)}%`}
                                className={`font-bold ${coverageColorClass}`}
                            >
                                COB {Math.round(coveragePct as number)}%
                            </span>
                        )}
                        {hasToeScore && (
                            <span
                                title={t('visual3d.toe_score_label', 'CONFIANZA PIE (TOE)')}
                                aria-label={`${t('visual3d.toe_score_label', 'CONFIANZA PIE (TOE)')}: ${Math.round(toeScore as number)}%`}
                                className={`font-bold ${toeColorClass}`}
                            >
                                TOE {Math.round(toeScore as number)}%
                            </span>
                        )}
                        {depthModeLabel && (
                            <span
                                title={t('visual3d.depth_mode_label', 'SENSOR ESPACIAL')}
                                className="uppercase text-[#475569] dark:text-[#8A93A6]"
                            >
                                {depthModeLabel}
                            </span>
                        )}
                    </div>

                    {(casSummaryLabel || cleanMeshSource) && (
                        <div className="flex flex-wrap items-center gap-fib-8 min-w-0">
                            {casSummaryLabel && (
                                <span className="text-[#00AEEF] truncate">
                                    CAS {casSummaryLabel}
                                </span>
                            )}
                            {cleanMeshSource && (
                                <span className="uppercase text-[#475569] dark:text-[#8A93A6] truncate max-w-[220px]">
                                    {cleanMeshSource}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StockpileVisualStage;
