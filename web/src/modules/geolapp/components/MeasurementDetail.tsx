import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import type {
    GroundTruthRecord,
    GroundTruthReferenceMethod,
} from '../../../contracts/acopios.contracts';
import {
    BoulderDetectionBox2D,
    RosinRammlerProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import {
    computeClientDeviationMetrics,
    extractEstimatedSnapshotFromMeasurement,
    fetchGroundTruthRecords,
    REFERENCE_METHODS,
    submitMeasurementGroundTruth,
} from '../core/services/groundTruthService';
import { formatStockpileVolumeM3 } from '../core/services/spatialScannerService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import { isValidBox2D } from '../core/utils/rosinRammler';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';
import { buildCanonicalGeoFix } from '../../../core/geo/wgs84UtmProjection';
import { StockpileStaticMapCard } from './StockpileStaticMapCard';
import { StockpileTwin3DLazy } from './StockpileTwin3DLazy';
import { StockpileVisualStage } from './StockpileVisualStage';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import {
    ReportBlockEditable,
    ReportFieldRow,
    UNDECLARED_TECH_VALUE,
} from '../../../components/common/ReportBlockEditable';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { SecureImage } from '../../../components/common/SecureImage';

interface MeasurementDetailProps {
    measurement: StockpileMeasurement;
    asset: StockpileAsset | null;
    isMobileField?: boolean;
    onBack: () => void;
    onToggleIgnore?: () => void;
}

interface SpatialMetrologyFields {
    uncertainty_pct?: number | null;
    toe_score?: number | null;
    coverage_pct?: number | null;
    depth_mode?: string | null;
    ground_slope_deg?: number | null;
    footprint_area_m2?: number | null;
}

/** Contrato compartido de cotas 3D con StockpileTwin3D / StockpileVisualStage (Bloque C). */
interface Twin3DDimensionsContract {
    dimensionsM?: { a?: number | null; b?: number | null; h?: number | null } | null;
    volumeM3?: number | null;
    slopeAngleDeg?: number | null;
    footprintAreaM2?: number | null;
    showDimensionsDefault?: boolean;
}

function parseOptionalPositiveNum(raw: string): number | undefined {
    const cleaned = raw.trim().replace(',', '.');
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseOptionalNonNegNum(raw: string): number | undefined {
    const cleaned = raw.trim().replace(',', '.');
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
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

const formatKilobytes = (bytes?: number): string | null => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
};

const formatSignedDeltaValue = (
    delta?: number | null,
    unit = 'm³',
    pct?: number | null
): string | null => {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return null;
    const sign = delta > 0 ? '+' : '';
    const base = `${sign}${delta.toFixed(2)} ${unit}`;
    if (typeof pct === 'number' && Number.isFinite(pct)) {
        const pctSign = pct > 0 ? '+' : '';
        return `${base} (${pctSign}${pct.toFixed(1)}%)`;
    }
    return base;
};

export const MeasurementDetail: React.FC<MeasurementDetailProps> = ({
    measurement,
    asset,
    isMobileField,
    onBack,
    onToggleIgnore,
}) => {
    const { t } = useTranslation();
    const isMobile = isMobileField ?? Capacitor.isNativePlatform();
    const resolvedPhoto = useResolvedStockpileImage(measurement.photo_url);
    const resolvedPreviousPhoto = useResolvedStockpileImage(measurement.previous_photo_url);

    const [showPreviousPhoto, setShowPreviousPhoto] = useState(false);
    const [mobileVisualMode, setMobileVisualMode] = useState<'PHOTO' | '3D'>('PHOTO');
    const [pendingReconcileDecision, setPendingReconcileDecision] = useState<
        'ACCEPT_CLOUD' | 'KEEP_OFFLINE' | null
    >(null);
    const [isSavingReconcileHitl, setIsSavingReconcileHitl] = useState(false);
    const [reconciliationResolved, setReconciliationResolved] = useState(false);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [statusBanner, setStatusBanner] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    // Panel Ground-Truth (móvil únicamente): Modo Informe -> Edición Quirúrgica + HITL "ACTUALIZAR"
    const [showGroundTruthPanel, setShowGroundTruthPanel] = useState(false);
    const [gtEditMode, setGtEditMode] = useState(false);
    const [gtRecords, setGtRecords] = useState<GroundTruthRecord[]>([]);
    const [gtLoading, setGtLoading] = useState(false);
    const [gtMethod, setGtMethod] = useState<GroundTruthReferenceMethod>('TAPE_MEASURE');
    const [gtHeightInput, setGtHeightInput] = useState('');
    const [gtLengthInput, setGtLengthInput] = useState('');
    const [gtWidthInput, setGtWidthInput] = useState('');
    const [gtDiameterInput, setGtDiameterInput] = useState('');
    const [gtVolumeInput, setGtVolumeInput] = useState('');
    const [gtSlopeInput, setGtSlopeInput] = useState('');
    const [gtNotesInput, setGtNotesInput] = useState('');
    const [gtValidationError, setGtValidationError] = useState<string | null>(null);
    const [gtHitlOpen, setGtHitlOpen] = useState(false);
    const [gtSaving, setGtSaving] = useState(false);

    const estimatedSnapshot = useMemo(
        () => extractEstimatedSnapshotFromMeasurement(measurement, asset),
        [measurement, asset]
    );

    const parsedRealInputs = useMemo(
        () => ({
            realHeightM: parseOptionalPositiveNum(gtHeightInput),
            realBaseLengthM: parseOptionalPositiveNum(gtLengthInput),
            realBaseWidthM: parseOptionalPositiveNum(gtWidthInput),
            realDiameterM: parseOptionalPositiveNum(gtDiameterInput),
            realVolumeM3: parseOptionalPositiveNum(gtVolumeInput),
            realSlopeAngleDeg: parseOptionalNonNegNum(gtSlopeInput),
        }),
        [gtHeightInput, gtLengthInput, gtWidthInput, gtDiameterInput, gtVolumeInput, gtSlopeInput]
    );

    const hasAnyRealInput = Boolean(
        parsedRealInputs.realHeightM !== undefined ||
            parsedRealInputs.realBaseLengthM !== undefined ||
            parsedRealInputs.realBaseWidthM !== undefined ||
            parsedRealInputs.realDiameterM !== undefined ||
            parsedRealInputs.realVolumeM3 !== undefined ||
            parsedRealInputs.realSlopeAngleDeg !== undefined
    );

    const liveGtDeviations = useMemo(
        () => (hasAnyRealInput ? computeClientDeviationMetrics(estimatedSnapshot, parsedRealInputs) : null),
        [hasAnyRealInput, estimatedSnapshot, parsedRealInputs]
    );

    useEffect(() => {
        if (!isMobile || !showGroundTruthPanel) return;
        let active = true;
        setGtLoading(true);
        void fetchGroundTruthRecords({
            tenantId: measurement.tenantId || asset?.tenantId || dataService.getTenantId() || undefined,
            assetId: measurement.assetId,
            measurementId: measurement.id,
        })
            .then(({ records }) => {
                if (active) setGtRecords(records);
            })
            .finally(() => {
                if (active) setGtLoading(false);
            });
        return () => {
            active = false;
        };
    }, [isMobile, showGroundTruthPanel, measurement.tenantId, measurement.assetId, measurement.id, asset?.tenantId]);

    const deltaVolumeDisplay = formatSignedDeltaValue(
        measurement.delta_volumen,
        'm³',
        measurement.delta_volumen_pct
    );
    const deltaWeightDisplay = formatSignedDeltaValue(measurement.delta_peso, 't');

    const effMoisture = measurement.moisture_pct ?? asset?.moisture_pct ?? null;
    const effTml = measurement.tml_pct ?? asset?.tml_pct ?? null;
    const effCuT = measurement.cu_total_pct ?? asset?.cu_total_pct ?? null;
    const effCuS = measurement.cu_soluble_pct ?? asset?.cu_soluble_pct ?? null;
    const effResidenceDays = measurement.residence_days ?? asset?.residence_days ?? null;
    const effDomain = measurement.copper_domain ?? asset?.copper_domain;
    const effRomana = asset?.peso_romana ?? null;

    const effRosin = useMemo<RosinRammlerProfile | null>(
        () => measurement.rosin_rammler ?? asset?.rosin_rammler ?? null,
        [measurement.rosin_rammler, asset?.rosin_rammler]
    );
    const effP80Mm = effRosin?.p80_mm ?? measurement.p80_mm ?? asset?.p80_mm ?? null;
    const effBoulders = useMemo<BoulderDetectionBox2D[]>(
        () =>
            (measurement.boulder_detections ?? []).filter(
                (item) => item && isValidBox2D(item.box_2d)
            ),
        [measurement.boulder_detections]
    );

    const hasRealWeight =
        typeof measurement.density_factor === 'number' &&
        Number.isFinite(measurement.density_factor) &&
        measurement.density_factor > 0 &&
        typeof measurement.peso_t === 'number' &&
        Number.isFinite(measurement.peso_t) &&
        measurement.peso_t > 0;

    const thm = measurement.wet_weight_thm ?? (hasRealWeight ? measurement.peso_t : null);
    const tms = useMemo(() => {
        if (typeof measurement.dry_weight_tms === 'number') return measurement.dry_weight_tms;
        if (typeof thm === 'number' && typeof effMoisture === 'number') {
            return Number((thm * (1 - effMoisture / 100)).toFixed(2));
        }
        return null;
    }, [measurement.dry_weight_tms, thm, effMoisture]);

    const rsPct = useMemo(() => {
        if (typeof effCuT === 'number' && effCuT > 0 && typeof effCuS === 'number') {
            return Number(((effCuS / effCuT) * 100).toFixed(1));
        }
        return null;
    }, [effCuT, effCuS]);

    const fineCu = useMemo(() => {
        if (typeof measurement.fine_cu_t === 'number') return measurement.fine_cu_t;
        if (typeof tms === 'number' && typeof effCuT === 'number') {
            return Number((tms * (effCuT / 100)).toFixed(2));
        }
        return null;
    }, [measurement.fine_cu_t, tms, effCuT]);

    const governance = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: effDomain,
                residenceDays: effResidenceDays,
                moisturePct: effMoisture,
                tmlLimitPct: effTml,
            }),
        [effDomain, effResidenceDays, effMoisture, effTml]
    );

    const canonicalFix = useMemo(() => {
        const lat = measurement.location_metadata?.lat ?? asset?.geo_point?.latitude;
        const lng = measurement.location_metadata?.lng ?? asset?.geo_point?.longitude;
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
                altitudeM: asset?.geo_point?.altitude ?? null,
                accuracyM:
                    measurement.location_metadata?.accuracy ?? asset?.geo_point?.accuracy ?? null,
                source: 'CAPACITOR_GNSS',
            });
        } catch {
            return null;
        }
    }, [measurement.location_metadata, asset?.geo_point]);

    const origCas = formatKilobytes(
        measurement.cas_original_bytes ?? asset?.cas_original_bytes
    );
    const optCas = formatKilobytes(
        measurement.cas_optimized_bytes ?? asset?.cas_optimized_bytes
    );
    const savingsCas = measurement.cas_savings_pct ?? asset?.cas_savings_pct;
    const casTraceText =
        origCas && optCas
            ? `ORIG ${origCas} -> CAS ${optCas}${typeof savingsCas === 'number' ? ` (-${savingsCas.toFixed(0)}%)` : ''
            }`
            : null;

    const dimensionEntries = useMemo(() => {
        const dims = measurement.geometry?.dimensions || {};
        const rows: Array<{ label: string; value: string }> = [];
        const pushIfNum = (label: string, val?: number) => {
            if (typeof val === 'number' && Number.isFinite(val)) {
                rows.push({ label, value: `${val.toFixed(2)} m` });
            }
        };

        pushIfNum(t('manual_capture.fields.major_axis_base', 'EJE MAYOR BASE (m)'), dims.d1 ?? dims.a);
        pushIfNum(t('manual_capture.fields.minor_axis_base', 'EJE MENOR BASE (m)'), dims.d2 ?? dims.b);
        pushIfNum(t('manual_capture.fields.major_axis_top', 'EJE MAYOR SUPERIOR (m)'), dims.d1p ?? dims.ap);
        pushIfNum(t('manual_capture.fields.minor_axis_top', 'EJE MENOR SUPERIOR (m)'), dims.d2p ?? dims.bp);
        pushIfNum(t('manual_capture.fields.perimeter_base', 'PERÍMETRO BASE (m)'), dims.p ?? dims.P);
        pushIfNum(t('manual_capture.fields.perimeter_top', 'PERÍMETRO SUPERIOR (m)'), dims.pp ?? dims.Pp);
        pushIfNum(t('manual_capture.fields.base_length', 'LONGITUD BASE (m)'), dims.baseLengthM ?? dims.lengthM);
        pushIfNum(t('manual_capture.fields.base_width', 'ANCHO BASE (m)'), dims.baseWidthM ?? dims.widthFromWallM);
        pushIfNum(
            t('manual_capture.fields.crest_length', 'LONGITUD CRESTA (m)'),
            measurement.crest_length_m ?? dims.crestLengthM
        );
        pushIfNum(
            t('manual_capture.fields.crest_width', 'ANCHO CRESTA (m)'),
            measurement.crest_width_m ?? dims.crestWidthM
        );
        pushIfNum(
            t('manual_capture.fields.total_height', 'ALTURA TOTAL (m)'),
            dims.h ?? dims.heightM ?? dims.heightAtWallM
        );
        if (typeof (measurement.wall_angle_deg ?? dims.wallAngleDeg) === 'number') {
            rows.push({
                label: t('manual_capture.fields.wall_angle_deg', 'ÁNGULO DE MURO (deg)'),
                value: `${(measurement.wall_angle_deg ?? dims.wallAngleDeg)!.toFixed(1)} deg`,
            });
        }
        return rows;
    }, [measurement, t]);

    const handleExportPdf = async () => {
        setIsExportingPdf(true);
        setStatusBanner(null);
        const fallbackAsset: StockpileAsset = asset ?? {
            id: measurement.assetId,
            name: measurement.assetId,
            clase: null,
            createdAt: measurement.timestamp,
            createdBy: measurement.user_id || '',
            last_volume_m3: measurement.volumen_m3,
            last_weight_t: measurement.peso_t,
            density_factor: measurement.density_factor,
            last_geometry_type: measurement.geometry?.type,
        };
        try {
            await downloadGeolappVectorPdf(fallbackAsset, [measurement]);
            setStatusBanner({
                type: 'success',
                text: t('pdf.download_ready', 'Certificado PDF vectorial descargado.'),
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text:
                    err instanceof Error
                        ? err.message
                        : t('pdf.error', 'Error al generar certificado PDF vectorial.'),
            });
        } finally {
            setIsExportingPdf(false);
        }
    };

    const mSpatial = measurement as StockpileMeasurement & SpatialMetrologyFields;
    const aSpatial = asset as (StockpileAsset & SpatialMetrologyFields) | null;
    const effUncertaintyPct = mSpatial.uncertainty_pct ?? aSpatial?.uncertainty_pct ?? null;
    const effToeScore = mSpatial.toe_score ?? aSpatial?.toe_score ?? null;
    const effCoveragePct = mSpatial.coverage_pct ?? aSpatial?.coverage_pct ?? null;
    const effDepthMode = mSpatial.depth_mode ?? aSpatial?.depth_mode ?? null;
    const effGroundSlopeDeg = mSpatial.ground_slope_deg ?? aSpatial?.ground_slope_deg ?? null;
    const effFootprintAreaM2 =
        typeof mSpatial.footprint_area_m2 === 'number' && Number.isFinite(mSpatial.footprint_area_m2)
            ? mSpatial.footprint_area_m2
            : typeof aSpatial?.footprint_area_m2 === 'number' &&
                Number.isFinite(aSpatial.footprint_area_m2)
              ? aSpatial.footprint_area_m2
              : null;
    const effDepthModeDisplay = formatSpatialDepthMode(effDepthMode);

    const slopeDeg =
        typeof measurement.detected_slope_angle_deg === 'number' &&
            Number.isFinite(measurement.detected_slope_angle_deg)
            ? measurement.detected_slope_angle_deg
            : null;

    const twin3dDimensionsM = useMemo(() => {
        const a = estimatedSnapshot.baseLengthM ?? null;
        const b = estimatedSnapshot.baseWidthM ?? null;
        const h = estimatedSnapshot.heightM ?? null;
        if (a === null && b === null && h === null) return null;
        return { a, b, h };
    }, [estimatedSnapshot]);

    const twin3dContractProps = useMemo<Twin3DDimensionsContract>(
        () => ({
            dimensionsM: twin3dDimensionsM,
            volumeM3:
                typeof measurement.volumen_m3 === 'number' && Number.isFinite(measurement.volumen_m3)
                    ? measurement.volumen_m3
                    : null,
            slopeAngleDeg:
                slopeDeg ??
                (typeof asset?.detected_slope_angle_deg === 'number' &&
                Number.isFinite(asset.detected_slope_angle_deg)
                    ? asset.detected_slope_angle_deg
                    : null),
            footprintAreaM2: effFootprintAreaM2,
            showDimensionsDefault: true,
        }),
        [twin3dDimensionsM, measurement.volumen_m3, slopeDeg, asset?.detected_slope_angle_deg, effFootprintAreaM2]
    );
    const isSlopeWarn =
        (slopeDeg != null && slopeDeg > 38) || Boolean(measurement.slope_warning);

    const dateFormatted = new Date(measurement.timestamp).toLocaleString([], {
        dateStyle: 'short',
        timeStyle: 'short',
    });

    if (isMobile) {
        const activePhotoSrc =
            showPreviousPhoto && resolvedPreviousPhoto ? resolvedPreviousPhoto : resolvedPhoto;
        const hasMobile3D = Boolean(measurement.mesh_url || measurement.local_preview_mesh);
        const requiresHitlReconcile =
            !reconciliationResolved &&
            measurement.reconciliation_status === 'REQUIRES_HITL_REVIEW' &&
            typeof measurement.cloud_refined_m3 === 'number' &&
            measurement.cloud_refined_m3 > 0;
        const offlineVolRef = measurement.offline_in_situ_m3 ?? measurement.volumen_m3;
        const reconcileDiffs: HitlComparisonDiffItem[] =
            pendingReconcileDecision && typeof measurement.cloud_refined_m3 === 'number'
                ? [
                      {
                          field: 'volumen_m3',
                          current: `${formatStockpileVolumeM3(offlineVolRef)} m³ (IN-SITU)`,
                          suggested:
                              pendingReconcileDecision === 'ACCEPT_CLOUD'
                                  ? `${formatStockpileVolumeM3(measurement.cloud_refined_m3)} m³ (CLOUD)`
                                  : `${formatStockpileVolumeM3(offlineVolRef)} m³ (MANTENER IN-SITU)`,
                      },
                  ]
                : [];
        const executeReconcileHitl = async () => {
            if (!pendingReconcileDecision || isSavingReconcileHitl) return;
            setIsSavingReconcileHitl(true);
            try {
                await dataService.confirmMeasurementReconciliationHitl(
                    measurement.assetId,
                    measurement.id,
                    pendingReconcileDecision,
                    'ACTUALIZAR'
                );
                setReconciliationResolved(true);
                setPendingReconcileDecision(null);
                setStatusBanner({
                    type: 'success',
                    text: t('reconciliation.hitl_confirmed', 'Conciliación actualizada.'),
                });
            } catch (err) {
                setStatusBanner({
                    type: 'error',
                    text:
                        err instanceof Error
                            ? err.message
                            : t('hitl.save_error', 'Error guardando HITL.'),
                });
                setPendingReconcileDecision(null);
            } finally {
                setIsSavingReconcileHitl(false);
            }
        };
        const closureTypeLabel =
            measurement.closure_reason === 'SHIPPED'
                ? t('lifecycle.closure_shipped_label', 'DESPACHO')
                : measurement.closure_reason === 'FIELD_REMOVED'
                    ? t('lifecycle.closure_removed_label', 'ELIMINACIÓN EN TERRENO')
                    : t('lifecycle.closure_zero_label', 'VOLUMEN 0 m³');

        return (
            <main className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
                <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8 no-print">
                    <div className="flex items-center gap-fib-8 min-w-0 flex-1">
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('LIGHT');
                                onBack();
                            }}
                            title={t('common.back_button', 'VOLVER')}
                            aria-label={t('common.back_button', 'VOLVER')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#C68346] cursor-pointer rounded-none shrink-0 flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                        </button>
                        <h1 className="text-[18px] font-mono font-bold uppercase tracking-tight truncate">
                            {asset?.name || measurement.assetId}
                        </h1>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        {hasMobile3D && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        setMobileVisualMode('PHOTO');
                                    }}
                                    aria-label={t('visual.mode_photo', 'FOTO')}
                                    title={t('visual.mode_photo', 'FOTO')}
                                    aria-pressed={mobileVisualMode === 'PHOTO'}
                                    className={`min-w-[48px] min-h-[48px] bg-transparent border-0 border-b-2 outline-none cursor-pointer rounded-none flex items-center justify-center ${
                                        mobileVisualMode === 'PHOTO'
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[22px]">
                                        photo_camera
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void triggerFieldImpact('LIGHT');
                                        setMobileVisualMode('3D');
                                    }}
                                    aria-label={t('visual.mode_3d', '3D')}
                                    title={t('visual.mode_3d', '3D')}
                                    aria-pressed={mobileVisualMode === '3D'}
                                    className={`min-w-[48px] min-h-[48px] bg-transparent border-0 border-b-2 outline-none cursor-pointer rounded-none flex items-center justify-center ${
                                        mobileVisualMode === '3D'
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[22px]">
                                        deployed_code
                                    </span>
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('LIGHT');
                                setShowGroundTruthPanel((prev) => !prev);
                            }}
                            title={t('ground_truth.open_panel_aria', 'Contraste con medidas reales')}
                            aria-label={t('ground_truth.open_panel_aria', 'Contraste con medidas reales')}
                            aria-pressed={showGroundTruthPanel}
                            className={`min-w-[48px] min-h-[48px] bg-transparent border-0 border-b-2 outline-none cursor-pointer rounded-none flex items-center justify-center ${
                                showGroundTruthPanel
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[24px]">straighten</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleExportPdf()}
                            disabled={isExportingPdf}
                            title={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                            aria-label={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 cursor-pointer rounded-none flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[24px]">
                                picture_as_pdf
                            </span>
                        </button>
                        {onToggleIgnore && (
                            <button
                                type="button"
                                onClick={onToggleIgnore}
                                title={
                                    measurement.ignored
                                        ? t('history.restore_measurement', 'RESTAURAR MEDICIÓN')
                                        : t('history.ignore_measurement', 'IGNORAR MEDICIÓN')
                                }
                                aria-label={
                                    measurement.ignored
                                        ? t('history.restore_measurement', 'RESTAURAR MEDICIÓN')
                                        : t('history.ignore_measurement', 'IGNORAR MEDICIÓN')
                                }
                                className={`min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none cursor-pointer rounded-none flex items-center justify-center ${measurement.ignored
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346]'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-[24px]">
                                    {measurement.ignored ? 'visibility_off' : 'visibility'}
                                </span>
                            </button>
                        )}
                    </div>
                </header>

                {isExportingPdf && (
                    <div className="shrink-0 w-full">
                        <M3LinearProgress
                            indeterminate
                            ariaLabel={t('pdf.downloading', 'GENERANDO CERTIFICADO VECTORIAL...')}
                        />
                    </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-[calc(env(safe-area-inset-bottom)+21px)]">
                    {statusBanner && (
                        <div
                            role="status"
                            className="px-fib-13 py-fib-8 border-b border-[#00AEEF] font-mono text-[16px] flex items-center justify-between gap-fib-8 text-[#00AEEF]"
                        >
                            <span>{statusBanner.text}</span>
                            <button
                                type="button"
                                onClick={() => setStatusBanner(null)}
                                aria-label={t('common.close_button', 'CERRAR')}
                                className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-current cursor-pointer flex items-center justify-center rounded-none"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>
                    )}

                    {/* Visor Foto Única o Gemelo 3D Nivel 1/2 (desmontaje GPU al volver a PHOTO) */}
                    {mobileVisualMode === '3D' && hasMobile3D ? (
                        <section className="w-full border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <StockpileTwin3DLazy
                                compact
                                heightPx={260}
                                meshUrl={measurement.mesh_url ?? null}
                                localPreviewMesh={measurement.local_preview_mesh ?? null}
                                lifecycleStatus={measurement.lifecycle_status ?? null}
                                copperDomain={effDomain}
                                tinVolumeM3={
                                    measurement.tin_volume_m3 ??
                                    measurement.offline_in_situ_m3 ??
                                    null
                                }
                                meshSource={measurement.mesh_source}
                                casMetrics={
                                    measurement.mesh_original_bytes !== undefined ||
                                    measurement.mesh_optimized_bytes !== undefined ||
                                    measurement.mesh_sha256
                                        ? {
                                              originalBytes: measurement.mesh_original_bytes,
                                              optimizedBytes: measurement.mesh_optimized_bytes,
                                              savingsPct: measurement.mesh_savings_pct,
                                              sha256: measurement.mesh_sha256,
                                          }
                                        : undefined
                                }
                                {...(twin3dContractProps as Record<string, unknown>)}
                            />
                        </section>
                    ) : (
                        <section className="relative w-full h-[260px] bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden">
                            {activePhotoSrc ? (
                                <SecureImage
                                    src={activePhotoSrc}
                                    alt={
                                        showPreviousPhoto
                                            ? t('history.previous_photo_alt', 'Foto anterior')
                                            : t('history.current_photo_alt', 'Foto actual')
                                    }
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span
                                    className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]"
                                    aria-hidden="true"
                                >
                                    image_not_supported
                                </span>
                            )}

                            {resolvedPreviousPhoto && (
                                <div className="absolute top-2 right-2 flex items-center gap-1 bg-[#FFFFFF]/90 dark:bg-[#000000]/90 border border-[#E2E8F0] dark:border-[#12151C]">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void triggerFieldImpact('LIGHT');
                                            setShowPreviousPhoto(false);
                                        }}
                                        aria-label={t(
                                            'measurement_mobile.photo_this_aria',
                                            'Foto de esta medición'
                                        )}
                                        title={t(
                                            'measurement_mobile.photo_this_aria',
                                            'Foto de esta medición'
                                        )}
                                        aria-pressed={!showPreviousPhoto}
                                        className={`min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none ${!showPreviousPhoto
                                            ? 'text-[#C68346]'
                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            photo_camera
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void triggerFieldImpact('LIGHT');
                                            setShowPreviousPhoto(true);
                                        }}
                                        aria-label={t(
                                            'measurement_mobile.photo_prev_aria',
                                            'Foto medición anterior'
                                        )}
                                        title={t(
                                            'measurement_mobile.photo_prev_aria',
                                            'Foto medición anterior'
                                        )}
                                        aria-pressed={showPreviousPhoto}
                                        className={`min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none ${showPreviousPhoto
                                            ? 'text-[#C68346]'
                                            : 'text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            history
                                        </span>
                                    </button>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Panel Ground-Truth Móvil: Modo Informe -> Edición Quirúrgica + HITL "ACTUALIZAR" */}
                    {showGroundTruthPanel && (
                        <section
                            aria-label={t('ground_truth.panel_title', 'CONTRASTE REAL (GROUND-TRUTH)')}
                            className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] border-l-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] space-y-fib-13 font-mono tabular-nums"
                        >
                            <div className="flex items-center justify-between gap-fib-8">
                                <div className="flex items-center gap-fib-8 min-w-0">
                                    <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">
                                        straighten
                                    </span>
                                    <span className="text-microcopy font-bold uppercase tracking-widest truncate">
                                        {gtEditMode
                                            ? t('ground_truth.edit_mode', 'INGRESO MEDIDAS REALES')
                                            : t('ground_truth.report_mode', 'INFORME DE CONTRASTE')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void triggerFieldImpact('LIGHT');
                                            setGtValidationError(null);
                                            setGtEditMode((prev) => !prev);
                                        }}
                                        aria-label={
                                            gtEditMode
                                                ? t('hitl.cancel_edit', 'CANCELAR EDICIÓN')
                                                : t('hitl.edit_block', 'EDITAR BLOQUE')
                                        }
                                        title={
                                            gtEditMode
                                                ? t('hitl.cancel_edit', 'CANCELAR EDICIÓN')
                                                : t('hitl.edit_block', 'EDITAR BLOQUE')
                                        }
                                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            {gtEditMode ? 'close' : 'edit'}
                                        </span>
                                    </button>
                                </div>
                            </div>

                            {gtLoading && (
                                <M3LinearProgress
                                    indeterminate
                                    ariaLabel={t('common.loading', 'CARGANDO...')}
                                />
                            )}

                            {!gtEditMode ? (
                                <div className="space-y-fib-8">
                                    {gtRecords.length === 0 ? (
                                        <div className="text-data-dense text-[#5A6072] dark:text-[#94A3B8]">
                                            {t(
                                                'ground_truth.empty_list',
                                                '[Sin contrastes reales registrados]'
                                            )}
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                            {gtRecords.slice(0, 5).map((rec) => {
                                                const isAlert = rec.deviations.statusBand === 'ALERT';
                                                return (
                                                    <div
                                                        key={rec.id}
                                                        className={`py-fib-8 pl-fib-8 border-l-[3px] ${
                                                            isAlert
                                                                ? 'border-l-[#C68346]'
                                                                : 'border-l-[#00AEEF]'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-fib-8 text-data-dense">
                                                            <span className="font-bold">
                                                                {t(
                                                                    `ground_truth.method_${rec.referenceMethod}`,
                                                                    rec.referenceMethod
                                                                )}
                                                            </span>
                                                            <span
                                                                className={`font-bold ${
                                                                    isAlert
                                                                        ? 'text-[#C68346]'
                                                                        : 'text-[#00AEEF]'
                                                                }`}
                                                            >
                                                                MAX Δ {rec.deviations.maxAbsDeltaPct.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap gap-fib-13 text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                            {rec.deviations.deltaVolumePct !== undefined && (
                                                                <span>
                                                                    V {rec.deviations.deltaVolumePct > 0 ? '+' : ''}
                                                                    {rec.deviations.deltaVolumePct.toFixed(1)}%
                                                                </span>
                                                            )}
                                                            {rec.deviations.deltaHeightPct !== undefined && (
                                                                <span>
                                                                    H {rec.deviations.deltaHeightPct > 0 ? '+' : ''}
                                                                    {rec.deviations.deltaHeightPct.toFixed(1)}%
                                                                </span>
                                                            )}
                                                            {rec.deviations.deltaDiameterPct !== undefined && (
                                                                <span>
                                                                    Ø {rec.deviations.deltaDiameterPct > 0 ? '+' : ''}
                                                                    {rec.deviations.deltaDiameterPct.toFixed(1)}%
                                                                </span>
                                                            )}
                                                            {rec.deviations.deltaLengthPct !== undefined && (
                                                                <span>
                                                                    L {rec.deviations.deltaLengthPct > 0 ? '+' : ''}
                                                                    {rec.deviations.deltaLengthPct.toFixed(1)}%
                                                                </span>
                                                            )}
                                                            {rec.deviations.deltaWidthPct !== undefined && (
                                                                <span>
                                                                    A {rec.deviations.deltaWidthPct > 0 ? '+' : ''}
                                                                    {rec.deviations.deltaWidthPct.toFixed(1)}%
                                                                </span>
                                                            )}
                                                            {rec.deviations.deltaSlopeDeg !== undefined && (
                                                                <span>
                                                                    α {rec.deviations.deltaSlopeDeg > 0 ? '+' : ''}
                                                                    {rec.deviations.deltaSlopeDeg.toFixed(1)}°
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <form
                                    autoComplete="off"
                                    spellCheck={false}
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (!hasAnyRealInput) {
                                            setGtValidationError(
                                                t(
                                                    'ground_truth.require_one_measure',
                                                    'Ingrese al menos una medida real (> 0).'
                                                )
                                            );
                                            return;
                                        }
                                        setGtValidationError(null);
                                        setGtHitlOpen(true);
                                    }}
                                    className="space-y-fib-13"
                                >
                                    <div className="grid grid-cols-[1.1fr_0.9fr_1fr_0.8fr] gap-fib-8 text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] border-b border-[#E2E8F0] dark:border-[#12151C] pb-1">
                                        <span>EJE</span>
                                        <span>{t('ground_truth.col_app', 'APP')}</span>
                                        <span>{t('ground_truth.col_real', 'REAL')}</span>
                                        <span className="text-right">
                                            {t('ground_truth.col_delta', 'Δ%')}
                                        </span>
                                    </div>

                                    {[
                                        {
                                            key: 'H',
                                            label: t('ground_truth.field_height', 'ALTURA H (m)'),
                                            appVal:
                                                estimatedSnapshot.heightM !== undefined
                                                    ? `${estimatedSnapshot.heightM.toFixed(2)} m`
                                                    : '--',
                                            val: gtHeightInput,
                                            setVal: setGtHeightInput,
                                            delta: liveGtDeviations?.deltaHeightPct,
                                            suffix: '%',
                                        },
                                        {
                                            key: 'L',
                                            label: t('ground_truth.field_length', 'LARGO L (m)'),
                                            appVal:
                                                estimatedSnapshot.baseLengthM !== undefined
                                                    ? `${estimatedSnapshot.baseLengthM.toFixed(2)} m`
                                                    : '--',
                                            val: gtLengthInput,
                                            setVal: setGtLengthInput,
                                            delta: liveGtDeviations?.deltaLengthPct,
                                            suffix: '%',
                                        },
                                        {
                                            key: 'A',
                                            label: t('ground_truth.field_width', 'ANCHO A (m)'),
                                            appVal:
                                                estimatedSnapshot.baseWidthM !== undefined
                                                    ? `${estimatedSnapshot.baseWidthM.toFixed(2)} m`
                                                    : '--',
                                            val: gtWidthInput,
                                            setVal: setGtWidthInput,
                                            delta: liveGtDeviations?.deltaWidthPct,
                                            suffix: '%',
                                        },
                                        {
                                            key: 'D',
                                            label: t('ground_truth.field_diameter', 'DIÁMETRO Ø (m)'),
                                            appVal:
                                                estimatedSnapshot.diameterM !== undefined
                                                    ? `${estimatedSnapshot.diameterM.toFixed(2)} m`
                                                    : '--',
                                            val: gtDiameterInput,
                                            setVal: setGtDiameterInput,
                                            delta: liveGtDeviations?.deltaDiameterPct,
                                            suffix: '%',
                                        },
                                        {
                                            key: 'V',
                                            label: t('ground_truth.field_volume', 'VOLUMEN V (m³)'),
                                            appVal:
                                                estimatedSnapshot.volumeM3 !== undefined
                                                    ? `${formatStockpileVolumeM3(estimatedSnapshot.volumeM3)}`
                                                    : '--',
                                            val: gtVolumeInput,
                                            setVal: setGtVolumeInput,
                                            delta: liveGtDeviations?.deltaVolumePct,
                                            suffix: '%',
                                        },
                                        {
                                            key: 'S',
                                            label: t('ground_truth.field_slope', 'TALUD α (°)'),
                                            appVal:
                                                estimatedSnapshot.slopeAngleDeg !== undefined
                                                    ? `${estimatedSnapshot.slopeAngleDeg.toFixed(1)}°`
                                                    : '--',
                                            val: gtSlopeInput,
                                            setVal: setGtSlopeInput,
                                            delta: liveGtDeviations?.deltaSlopeDeg,
                                            suffix: '°',
                                        },
                                    ].map((row) => (
                                        <div
                                            key={row.key}
                                            className="grid grid-cols-[1.1fr_0.9fr_1fr_0.8fr] gap-fib-8 items-center"
                                        >
                                            <label
                                                htmlFor={`gt-field-${row.key}`}
                                                className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate"
                                            >
                                                {row.label}
                                            </label>
                                            <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                {row.appVal}
                                            </span>
                                            <input
                                                id={`gt-field-${row.key}`}
                                                type="number"
                                                inputMode="decimal"
                                                step="any"
                                                min="0"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={row.val}
                                                onChange={(e) => row.setVal(e.target.value)}
                                                placeholder="0.00"
                                                className="h-[44px] w-full px-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none select-text"
                                            />
                                            <span
                                                className={`text-data-dense font-bold text-right ${
                                                    row.delta === undefined
                                                        ? 'text-[#94A3B8] dark:text-[#5A6072]'
                                                        : Math.abs(row.delta) > 8
                                                          ? 'text-[#C68346]'
                                                          : 'text-[#00AEEF]'
                                                }`}
                                            >
                                                {row.delta !== undefined
                                                    ? `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(1)}${row.suffix}`
                                                    : '--'}
                                            </span>
                                        </div>
                                    ))}

                                    <div className="space-y-fib-8 pt-1">
                                        <label
                                            htmlFor="gt-method-select"
                                            className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {t('ground_truth.method_label', 'MÉTODO DE REFERENCIA')}
                                        </label>
                                        <select
                                            id="gt-method-select"
                                            value={gtMethod}
                                            onChange={(e) =>
                                                setGtMethod(e.target.value as GroundTruthReferenceMethod)
                                            }
                                            className="h-[48px] w-full px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none"
                                        >
                                            {REFERENCE_METHODS.map((m) => (
                                                <option key={m} value={m}>
                                                    {t(`ground_truth.method_${m}`, m)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-fib-8">
                                        <label
                                            htmlFor="gt-notes-input"
                                            className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {t('ground_truth.notes_label', 'NOTAS DE TERRENO (OPCIONAL)')}
                                        </label>
                                        <input
                                            id="gt-notes-input"
                                            type="text"
                                            maxLength={300}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={gtNotesInput}
                                            onChange={(e) => setGtNotesInput(e.target.value)}
                                            placeholder={t(
                                                'ground_truth.notes_placeholder',
                                                'Ej: Probeta verificada con huincha'
                                            )}
                                            className="h-[48px] w-full px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none select-text"
                                        />
                                    </div>

                                    {liveGtDeviations && (
                                        <div
                                            className={`px-fib-13 py-fib-8 border-l-[3px] flex items-center justify-between text-data-dense font-bold ${
                                                liveGtDeviations.statusBand === 'ALERT'
                                                    ? 'border-l-[#C68346] text-[#C68346]'
                                                    : 'border-l-[#00AEEF] text-[#00AEEF]'
                                            }`}
                                        >
                                            <span>
                                                {liveGtDeviations.statusBand === 'ALERT'
                                                    ? t('ground_truth.status_ALERT', 'ALERTA > 8%')
                                                    : t('ground_truth.status_OPTIMAL', 'ÓPTIMO <= 8%')}
                                            </span>
                                            <span>MAX Δ {liveGtDeviations.maxAbsDeltaPct.toFixed(1)}%</span>
                                        </div>
                                    )}

                                    {gtValidationError && (
                                        <div className="text-data-dense text-[#C68346]">
                                            {gtValidationError}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={gtSaving}
                                        className="w-full min-h-[48px] px-fib-13 bg-[#C68346] text-[#000000] border-0 font-mono text-data-dense font-bold uppercase flex items-center justify-center gap-fib-8 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                                    >
                                        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                                            fact_check
                                        </span>
                                        <span>
                                            {t('ground_truth.save_hitl_action', 'CONFIRMAR CONTRASTE')}
                                        </span>
                                    </button>
                                </form>
                            )}
                        </section>
                    )}

                    {/* Compuerta HITL móvil exclusiva cuando conciliación Cloud vs In-Situ requiere revisión */}
                    {requiresHitlReconcile && (
                        <section className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] border-l-[#C68346] font-mono tabular-nums space-y-fib-8">
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-microcopy font-bold uppercase text-[#C68346]">
                                    {t('reconciliation.hitl_required', 'REVISIÓN HITL CLOUD')}
                                </span>
                                {typeof measurement.reconciliation_delta_pct === 'number' && (
                                    <span className="text-data-dense font-bold text-[#C68346]">
                                        {measurement.reconciliation_delta_pct > 0 ? '+' : ''}
                                        {measurement.reconciliation_delta_pct.toFixed(1)}%
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center justify-between gap-fib-13 text-data-dense">
                                <span>IN-SITU {formatStockpileVolumeM3(offlineVolRef)} m³</span>
                                <span className="text-[#00AEEF] font-bold">
                                    CLOUD {formatStockpileVolumeM3(measurement.cloud_refined_m3!)} m³
                                </span>
                            </div>
                            <div className="flex items-center justify-end gap-fib-13 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setPendingReconcileDecision('KEEP_OFFLINE')}
                                    aria-label={t('reconciliation.keep_offline', 'MANTENER IN-SITU')}
                                    title={t('reconciliation.keep_offline', 'MANTENER IN-SITU')}
                                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[24px]">
                                        close
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPendingReconcileDecision('ACCEPT_CLOUD')}
                                    aria-label={t('reconciliation.accept_cloud', 'ACEPTAR CLOUD (HITL)')}
                                    title={t('reconciliation.accept_cloud', 'ACEPTAR CLOUD (HITL)')}
                                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#00AEEF] flex items-center justify-center cursor-pointer rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[24px]">
                                        check
                                    </span>
                                </button>
                            </div>
                        </section>
                    )}

                    {/* Ficha Senior 70+ de alto contraste y datos reales únicamente */}
                    <section className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] font-mono tabular-nums">
                        <div className="px-fib-21 py-fib-13 flex items-center justify-between gap-fib-13">
                            <span className="text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('measurement_mobile.date_label', 'FECHA')}
                            </span>
                            <span className="text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6] text-right">
                                {dateFormatted}
                            </span>
                        </div>

                        <div className="px-fib-21 py-fib-21 border-l-[3px] border-l-[#C68346]">
                            <span className="block text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('measurement_mobile.volume_label', 'VOLUMEN')}
                            </span>
                            <span className="block text-[36px] leading-tight font-bold text-[#C68346]">
                                {formatStockpileVolumeM3(measurement.volumen_m3)} m³
                            </span>
                        </div>

                        {deltaVolumeDisplay && (
                            <div className="px-fib-21 py-fib-13 flex items-center justify-between gap-fib-13">
                                <span className="text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('measurement_mobile.change_label', 'CAMBIO VS ANTERIOR')}
                                </span>
                                <span
                                    className={`text-[22px] font-bold text-right ${typeof measurement.delta_volumen === 'number' &&
                                        measurement.delta_volumen < 0
                                        ? 'text-[#C68346]'
                                        : 'text-[#00AEEF]'
                                        }`}
                                >
                                    {deltaVolumeDisplay}
                                </span>
                            </div>
                        )}

                        {hasRealWeight && (
                            <div className="px-fib-21 py-fib-13 flex items-center justify-between gap-fib-13">
                                <span className="text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('measurement_mobile.weight_label', 'TONELADAS')}
                                </span>
                                <span className="text-[24px] font-bold text-[#0F172A] dark:text-[#F3F4F6] text-right">
                                    {measurement.peso_t.toLocaleString(undefined, {
                                        maximumFractionDigits: 1,
                                    })}{' '}
                                    t
                                </span>
                            </div>
                        )}

                        {slopeDeg != null && (
                            <div
                                className={`px-fib-21 py-fib-13 flex items-center justify-between gap-fib-13 ${isSlopeWarn ? 'border-l-[3px] border-l-[#C68346]' : ''
                                    }`}
                            >
                                <span className="text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('measurement_mobile.slope_label', 'TALUD')}
                                </span>
                                <span
                                    className={`text-[24px] font-bold text-right ${isSlopeWarn ? 'text-[#C68346]' : 'text-[#00AEEF]'
                                        }`}
                                >
                                    {slopeDeg.toFixed(1)}°
                                </span>
                            </div>
                        )}

                        {effDomain && (
                            <div className="px-fib-21 py-fib-13 flex items-center justify-between gap-fib-13">
                                <span className="text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('measurement_mobile.material_label', 'MATERIAL')}
                                </span>
                                <span className="text-[18px] font-bold text-[#0F172A] dark:text-[#F3F4F6] text-right">
                                    {t(`copper_domains.${effDomain}`, effDomain)}
                                </span>
                            </div>
                        )}

                        {measurement.is_closure_measurement && (
                            <div className="px-fib-21 py-fib-13 border-l-[3px] border-l-[#C68346] space-y-1">
                                <div className="flex items-center justify-between gap-fib-13">
                                    <span className="text-[18px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('measurement_mobile.closure_label', 'CIERRE')}
                                    </span>
                                    <span className="text-[18px] font-bold text-[#C68346] text-right">
                                        {closureTypeLabel}
                                    </span>
                                </div>
                                {(measurement.closure_cause || measurement.dispatch_reference) && (
                                    <p className="text-[18px] text-[#0F172A] dark:text-[#F3F4F6] break-words">
                                        {measurement.closure_cause || measurement.dispatch_reference}
                                    </p>
                                )}
                            </div>
                        )}
                    </section>
                </div>

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
                            parsedRealInputs.realHeightM !== undefined
                                ? {
                                      field: 'H (m)',
                                      current: `${estimatedSnapshot.heightM?.toFixed(2) ?? '--'} m`,
                                      suggested: `${parsedRealInputs.realHeightM.toFixed(2)} m`,
                                  }
                                : null,
                            parsedRealInputs.realBaseLengthM !== undefined
                                ? {
                                      field: 'L (m)',
                                      current: `${estimatedSnapshot.baseLengthM?.toFixed(2) ?? '--'} m`,
                                      suggested: `${parsedRealInputs.realBaseLengthM.toFixed(2)} m`,
                                  }
                                : null,
                            parsedRealInputs.realBaseWidthM !== undefined
                                ? {
                                      field: 'A (m)',
                                      current: `${estimatedSnapshot.baseWidthM?.toFixed(2) ?? '--'} m`,
                                      suggested: `${parsedRealInputs.realBaseWidthM.toFixed(2)} m`,
                                  }
                                : null,
                            parsedRealInputs.realDiameterM !== undefined
                                ? {
                                      field: 'Ø (m)',
                                      current: `${estimatedSnapshot.diameterM?.toFixed(2) ?? '--'} m`,
                                      suggested: `${parsedRealInputs.realDiameterM.toFixed(2)} m`,
                                  }
                                : null,
                            parsedRealInputs.realVolumeM3 !== undefined
                                ? {
                                      field: 'V (m³)',
                                      current: `${estimatedSnapshot.volumeM3 !== undefined ? formatStockpileVolumeM3(estimatedSnapshot.volumeM3) : '--'} m³`,
                                      suggested: `${formatStockpileVolumeM3(parsedRealInputs.realVolumeM3)} m³`,
                                  }
                                : null,
                            parsedRealInputs.realSlopeAngleDeg !== undefined
                                ? {
                                      field: 'α (°)',
                                      current: `${estimatedSnapshot.slopeAngleDeg?.toFixed(1) ?? '--'}°`,
                                      suggested: `${parsedRealInputs.realSlopeAngleDeg.toFixed(1)}°`,
                                  }
                                : null,
                        ].filter((x): x is HitlComparisonDiffItem => x !== null)
                    }
                    loading={gtSaving}
                    onConfirm={async () => {
                        if (gtSaving) return;
                        setGtSaving(true);
                        try {
                            const { record, queuedOffline } = await submitMeasurementGroundTruth({
                                tenantId:
                                    measurement.tenantId ||
                                    asset?.tenantId ||
                                    dataService.getTenantId() ||
                                    undefined,
                                assetId: measurement.assetId,
                                assetName: asset?.name,
                                measurementId: measurement.id,
                                deviceModel: measurement.device_model || asset?.device_model,
                                estimated: estimatedSnapshot,
                                input: {
                                    hitlConfirmation: 'ACTUALIZAR',
                                    referenceMethod: gtMethod,
                                    ...(gtNotesInput.trim() ? { fieldNotes: gtNotesInput.trim() } : {}),
                                    ...parsedRealInputs,
                                },
                            });
                            setGtRecords((prev) => [record, ...prev]);
                            setGtHitlOpen(false);
                            setGtEditMode(false);
                            setGtHeightInput('');
                            setGtLengthInput('');
                            setGtWidthInput('');
                            setGtDiameterInput('');
                            setGtVolumeInput('');
                            setGtSlopeInput('');
                            setGtNotesInput('');
                            setStatusBanner({
                                type: 'success',
                                text: queuedOffline
                                    ? t(
                                          'ground_truth.saved_offline',
                                          'Contraste guardado localmente y encolado para sincronización.'
                                      )
                                    : t(
                                          'ground_truth.saved_cloud',
                                          'Contraste real registrado en AuditLedger.'
                                      ),
                            });
                        } catch (err) {
                            setGtHitlOpen(false);
                            setGtValidationError(
                                err instanceof Error
                                    ? err.message
                                    : t('hitl.save_error', 'Error guardando HITL.')
                            );
                        } finally {
                            setGtSaving(false);
                        }
                    }}
                    onCancel={() => setGtHitlOpen(false)}
                />

                <HitlConfirmModal
                    open={Boolean(pendingReconcileDecision)}
                    title={t('reconciliation.hitl_modal_title', 'CONCILIACIÓN VOLUMÉTRICA HITL')}
                    description={t(
                        'hitl.modal_description',
                        'Escriba ACTUALIZAR para confirmar el registro oficial.'
                    )}
                    keyword="ACTUALIZAR"
                    comparisonDiff={reconcileDiffs}
                    loading={isSavingReconcileHitl}
                    onConfirm={() => void executeReconcileHitl()}
                    onCancel={() => setPendingReconcileDecision(null)}
                />
            </main>
        );
    }

    // Fallback Escritorio 100% Solo Lectura
    const measMeshCas =
        measurement.mesh_original_bytes !== undefined ||
        measurement.mesh_optimized_bytes !== undefined ||
        measurement.mesh_sha256
            ? {
                  originalBytes: measurement.mesh_original_bytes,
                  optimizedBytes: measurement.mesh_optimized_bytes,
                  savingsPct: measurement.mesh_savings_pct,
                  sha256: measurement.mesh_sha256,
              }
            : undefined;

    return (
        <main className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none">
            <header className="shrink-0 h-14 px-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8 no-print rounded-none">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        title={t('common.back_button', 'VOLVER')}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shrink-0 flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[24px] text-[#C68346]">
                            arrow_back
                        </span>
                    </button>
                    <div className="min-w-0">
                        <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                            {asset?.name || measurement.assetId} · {dateFormatted}
                        </span>
                        <h1 className="text-h1-header font-bold uppercase tracking-tight truncate">
                            {t('analytics.detail_title', 'DOSSIER DE MEDICIÓN')}
                        </h1>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={isExportingPdf}
                    title={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                    aria-label={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                    className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 cursor-pointer rounded-none flex items-center justify-center"
                >
                    <span className="material-symbols-outlined text-[24px]">picture_as_pdf</span>
                </button>
            </header>

            {isExportingPdf && (
                <div className="shrink-0 w-full">
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('pdf.downloading', 'GENERANDO CERTIFICADO VECTORIAL...')}
                    />
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-fib-21">
                <div className="max-w-5xl mx-auto flex flex-col gap-fib-21 pb-fib-55">
                    <section className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13">
                        <StockpileVisualStage
                            photoUrl={measurement.photo_url}
                            boulderDetections={effBoulders}
                            slopeAngleDeg={
                                measurement.detected_slope_angle_deg ??
                                asset?.detected_slope_angle_deg ??
                                null
                            }
                            meshUrl={measurement.mesh_url ?? null}
                            localPreviewMesh={measurement.local_preview_mesh ?? null}
                            lifecycleStatus={measurement.lifecycle_status ?? null}
                            reconciliationDeltaPct={measurement.reconciliation_delta_pct ?? null}
                            copperDomain={effDomain}
                            tinVolumeM3={
                                measurement.tin_volume_m3 ??
                                measurement.offline_in_situ_m3 ??
                                null
                            }
                            casMetrics={measMeshCas}
                            meshSource={measurement.mesh_source}
                            uncertaintyPct={effUncertaintyPct}
                            toeScore={effToeScore}
                            coveragePct={effCoveragePct}
                            depthMode={effDepthMode}
                            altLabel={asset?.name || measurement.assetId}
                            isMobile={false}
                            heightPx={340}
                            canReconstruct3D={false}
                            {...(twin3dContractProps as Record<string, unknown>)}
                        />
                        <ReportFieldRow
                            label={t('capture.cas_trace_label', 'TRAZABILIDAD CAS')}
                            value={casTraceText}
                            mono
                            copyable={Boolean(casTraceText)}
                        />
                    </section>

                    <section className="grid grid-cols-2 md:grid-cols-5 gap-fib-13">
                        <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('manual_capture.estimated_volume', 'VOLUMEN')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                                {measurement.volumen_m3.toFixed(2)} m³
                            </span>
                        </div>
                        <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('history.delta_volume', 'Δ VOLUMEN')}
                            </span>
                            <span className="text-h2-section font-mono font-bold tabular-nums text-[#00AEEF]">
                                {deltaVolumeDisplay || UNDECLARED_TECH_VALUE}
                            </span>
                        </div>
                        <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('copper_governance.thm', 'THM [t]')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                {thm != null ? `${thm.toFixed(2)} t` : UNDECLARED_TECH_VALUE}
                            </span>
                        </div>
                        <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('copper_governance.tms', 'TMS [t]')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                {tms !== null ? `${tms.toFixed(2)} t` : '—'}
                            </span>
                        </div>
                        <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('copper_governance.fine_cu', 'Cu FINO [t]')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#00AEEF]">
                                {fineCu !== null ? `${fineCu.toFixed(2)} t` : '—'}
                            </span>
                        </div>
                    </section>

                    <section className="p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                        <ReportFieldRow
                            label={t('geometries.title', 'GEOMETRÍA DEL SÓLIDO')}
                            value={
                                measurement.geometry?.type
                                    ? t(
                                        `geometries.${measurement.geometry.type}`,
                                        String(measurement.geometry.type)
                                    )
                                    : null
                            }
                            mono
                        />
                        {dimensionEntries.map((dim) => (
                            <ReportFieldRow key={dim.label} label={dim.label} value={dim.value} mono />
                        ))}
                        <ReportFieldRow
                            label={t('history.delta_weight', 'Δ PESO [t]')}
                            value={deltaWeightDisplay}
                            mono
                        />
                        {effDepthModeDisplay && (
                            <ReportFieldRow
                                label={t('visual3d.depth_mode_label', 'SENSOR ESPACIAL')}
                                value={effDepthModeDisplay}
                                mono
                            />
                        )}
                        {typeof effGroundSlopeDeg === 'number' && (
                            <ReportFieldRow
                                label={t('visual3d.ground_slope_label', 'PENDIENTE PISO')}
                                value={`${effGroundSlopeDeg.toFixed(1)}°`}
                                mono
                            />
                        )}
                    </section>

                    <section className="p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col gap-fib-13">
                        <ReportFieldRow
                            label="UTM (WGS84)"
                            value={canonicalFix?.utm.formatted || null}
                            mono
                            copyable={Boolean(canonicalFix)}
                        />
                        <StockpileStaticMapCard
                            asset={asset}
                            fix={canonicalFix}
                            heightPx={220}
                            label={asset?.name || measurement.assetId}
                            flat={false}
                        />
                    </section>

                    <ReportBlockEditable
                        title={t('copper_governance.title', 'GOBERNANZA METALÚRGICA COBRE (Cu)')}
                        code={effDomain || undefined}
                        isEditing={false}
                        canEdit={false}
                        onToggleEdit={() => { }}
                    >
                        <ReportFieldRow
                            label={t('copper_governance.moisture', 'HUMEDAD w%')}
                            value={effMoisture != null ? `${effMoisture}%` : null}
                            mono
                        />
                        <ReportFieldRow
                            label={t('copper_governance.tml', 'TML%')}
                            value={effTml != null ? `${effTml}%` : null}
                            mono
                        />
                        <ReportFieldRow
                            label="CuT% / CuS% / RS%"
                            value={
                                effCuT != null || effCuS != null
                                    ? `${effCuT ?? '--'}% / ${effCuS ?? '--'}%${rsPct != null ? ` / RS ${rsPct}%` : ''
                                    }`
                                    : null
                            }
                            mono
                        />
                        <ReportFieldRow
                            label={t('copper_governance.scale_weight', 'PESO ROMANA [t]')}
                            value={effRomana != null ? `${effRomana} t` : null}
                            mono
                        />
                        {governance.alerts.length > 0 && (
                            <ReportFieldRow
                                label={t('desktop.alerts_col', 'ALERTAS')}
                                value={governance.alerts.map((a) => a.message).join(' · ')}
                                mono={false}
                            />
                        )}
                    </ReportBlockEditable>

                    <ReportBlockEditable
                        title={t(
                            'rosin_rammler.title',
                            'DISTRIBUCIÓN GRANULOMÉTRICA ROSIN-RAMMLER (RRSB)'
                        )}
                        isEditing={false}
                        canEdit={false}
                        onToggleEdit={() => { }}
                    >
                        <ReportFieldRow
                            label={t('rosin_rammler.p80_label', 'P80 (mm)')}
                            value={typeof effP80Mm === 'number' ? `${effP80Mm.toFixed(1)} mm` : null}
                            mono
                        />
                        <ReportFieldRow
                            label={t('rosin_rammler.p50_label', 'P50 (mm)')}
                            value={
                                typeof effRosin?.p50_mm === 'number'
                                    ? `${effRosin.p50_mm.toFixed(1)} mm`
                                    : null
                            }
                            mono
                        />
                    </ReportBlockEditable>
                </div>
            </div>
        </main>
    );
};
