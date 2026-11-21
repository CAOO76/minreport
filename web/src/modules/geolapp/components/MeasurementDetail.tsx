import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import {
    BoulderDetectionBox2D,
    RosinRammlerProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { calculationEngine } from '../core/services/calculation-engine';
import { formatStockpileVolumeM3 } from '../core/services/spatialScannerService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import { isValidBox2D } from '../core/utils/rosinRammler';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';
import { buildCanonicalGeoFix } from '../../../core/geo/wgs84UtmProjection';
import { StockpileStaticMapCard } from './StockpileStaticMapCard';
import { StockpileVisualStage } from './StockpileVisualStage';
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
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [statusBanner, setStatusBanner] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

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
    const effDepthModeDisplay = formatSpatialDepthMode(effDepthMode);

    const slopeDeg =
        typeof measurement.detected_slope_angle_deg === 'number' &&
            Number.isFinite(measurement.detected_slope_angle_deg)
            ? measurement.detected_slope_angle_deg
            : null;
    const isSlopeWarn =
        (slopeDeg != null && slopeDeg > 38) || Boolean(measurement.slope_warning);

    const dateFormatted = new Date(measurement.timestamp).toLocaleString([], {
        dateStyle: 'short',
        timeStyle: 'short',
    });

    if (isMobile) {
        const activePhotoSrc =
            showPreviousPhoto && resolvedPreviousPhoto ? resolvedPreviousPhoto : resolvedPhoto;
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

                    {/* Única fotografía de la medición (+ conmutador de iconos si existe foto previa) */}
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
            </main>
        );
    }

    // Fallback Escritorio 100% Solo Lectura
    const fallbackChainHasGeom = Boolean(
        measurement.geometry?.type &&
        measurement.geometry?.dimensions &&
        Object.values(measurement.geometry.dimensions).some(
            (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
        )
    );

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
                            fallbackGeometry={
                                fallbackChainHasGeom && measurement.geometry
                                    ? {
                                        type: measurement.geometry.type,
                                        dimensions: measurement.geometry
                                            .dimensions as Record<string, number | undefined>,
                                    }
                                    : null
                            }
                            copperDomain={effDomain}
                            tinVolumeM3={measurement.tin_volume_m3 ?? null}
                            meshSource={measurement.mesh_source}
                            uncertaintyPct={effUncertaintyPct}
                            toeScore={effToeScore}
                            coveragePct={effCoveragePct}
                            depthMode={effDepthMode}
                            altLabel={asset?.name || measurement.assetId}
                            isMobile={false}
                            heightPx={340}
                            canReconstruct3D={false}
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
