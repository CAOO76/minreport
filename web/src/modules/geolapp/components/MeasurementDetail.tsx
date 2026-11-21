import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import {
    BoulderDetectionBox2D,
    RosinRammlerProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import {
    photogrammetry3dService,
    type Reconstruct3DResult,
} from '../core/services/photogrammetry3d.service';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import { isValidBox2D } from '../core/utils/rosinRammler';
import { buildCanonicalGeoFix } from '../../../core/geo/wgs84UtmProjection';
import { StockpileStaticMapCard } from './StockpileStaticMapCard';
import { StockpileVisualStage } from './StockpileVisualStage';
import {
    ReportBlockEditable,
    ReportFieldRow,
    UNDECLARED_TECH_VALUE,
} from '../../../components/common/ReportBlockEditable';
import {
    HitlConfirmModal,
    HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
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

const parseNullableNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

    const deltaVolumeDisplay = formatSignedDeltaValue(
        measurement.delta_volumen,
        'm³',
        measurement.delta_volumen_pct
    );
    const deltaWeightDisplay = formatSignedDeltaValue(measurement.delta_peso, 't');

    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [isEditingCopper, setIsEditingCopper] = useState(false);
    const [isEditingRosin, setIsEditingRosin] = useState(false);
    const [isReconstructing3D, setIsReconstructing3D] = useState(false);
    const [localMeshResult, setLocalMeshResult] = useState<Reconstruct3DResult | null>(null);
    const [localRosinOverride, setLocalRosinOverride] = useState<RosinRammlerProfile | null>(null);

    useEffect(() => {
        setLocalMeshResult(null);
    }, [measurement.id]);
    const [isSavingHitl, setIsSavingHitl] = useState(false);
    const [statusBanner, setStatusBanner] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    const effMoisture = measurement.moisture_pct ?? asset?.moisture_pct ?? null;
    const effTml = measurement.tml_pct ?? asset?.tml_pct ?? null;
    const effCuT = measurement.cu_total_pct ?? asset?.cu_total_pct ?? null;
    const effCuS = measurement.cu_soluble_pct ?? asset?.cu_soluble_pct ?? null;
    const effResidenceDays = measurement.residence_days ?? asset?.residence_days ?? null;
    const effDomain = measurement.copper_domain ?? asset?.copper_domain;
    const effRomana = asset?.peso_romana ?? null;

    const effRosin = useMemo<RosinRammlerProfile | null>(
        () => localRosinOverride ?? measurement.rosin_rammler ?? asset?.rosin_rammler ?? null,
        [localRosinOverride, measurement.rosin_rammler, asset?.rosin_rammler]
    );
    const effP80Mm = effRosin?.p80_mm ?? measurement.p80_mm ?? asset?.p80_mm ?? null;
    const effBoulders = useMemo<BoulderDetectionBox2D[]>(
        () =>
            (measurement.boulder_detections ?? []).filter(
                (item) => item && isValidBox2D(item.box_2d)
            ),
        [measurement.boulder_detections]
    );

    const [draftP80Mm, setDraftP80Mm] = useState(effP80Mm != null ? String(effP80Mm) : '');
    const [draftP50Mm, setDraftP50Mm] = useState(
        effRosin?.p50_mm != null ? String(effRosin.p50_mm) : ''
    );

    const [draftMoisture, setDraftMoisture] = useState(
        effMoisture != null ? String(effMoisture) : ''
    );
    const [draftTml, setDraftTml] = useState(effTml != null ? String(effTml) : '');
    const [draftCuT, setDraftCuT] = useState(effCuT != null ? String(effCuT) : '');
    const [draftCuS, setDraftCuS] = useState(effCuS != null ? String(effCuS) : '');
    const [draftDays, setDraftDays] = useState(
        effResidenceDays != null ? String(effResidenceDays) : ''
    );
    const [draftRomana, setDraftRomana] = useState(
        effRomana != null ? String(effRomana) : ''
    );

    const [pendingHitl, setPendingHitl] = useState<{
        source: 'copper' | 'rosin';
        patch: Partial<StockpileAsset>;
        diffs: HitlComparisonDiffItem[];
    } | null>(null);

    const thm = measurement.wet_weight_thm ?? measurement.peso_t;
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

    const romanaComparison = useMemo(() => {
        if (typeof effRomana === 'number' && effRomana > 0 && typeof thm === 'number' && thm > 0) {
            return calculationEngine.compareTonnage(thm, effRomana);
        }
        return null;
    }, [effRomana, thm]);

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

    const perimeterUrls = useMemo(
        () => measurement.perimeter_photo_urls ?? asset?.perimeter_photo_urls ?? [],
        [measurement.perimeter_photo_urls, asset?.perimeter_photo_urls]
    );

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

    const handleToggleCopperEdit = () => {
        setStatusBanner(null);
        if (!isEditingCopper) {
            setDraftMoisture(effMoisture != null ? String(effMoisture) : '');
            setDraftTml(effTml != null ? String(effTml) : '');
            setDraftCuT(effCuT != null ? String(effCuT) : '');
            setDraftCuS(effCuS != null ? String(effCuS) : '');
            setDraftDays(effResidenceDays != null ? String(effResidenceDays) : '');
            setDraftRomana(effRomana != null ? String(effRomana) : '');
        }
        setIsEditingCopper((prev) => !prev);
    };

    const handlePrepareCopperHitl = (e: React.FormEvent) => {
        e.preventDefault();
        if (!asset) return;

        const nextMoisture = parseNullableNumber(draftMoisture);
        const nextTml = parseNullableNumber(draftTml);
        const nextCuT = parseNullableNumber(draftCuT);
        const nextCuS = parseNullableNumber(draftCuS);
        const nextDays = parseNullableNumber(draftDays);
        const nextRomana = parseNullableNumber(draftRomana);

        const nextTms =
            typeof thm === 'number' && nextMoisture !== null
                ? Number((thm * (1 - nextMoisture / 100)).toFixed(2))
                : asset.dry_weight_tms ?? null;
        const nextFineCu =
            typeof nextTms === 'number' && nextCuT !== null
                ? Number((nextTms * (nextCuT / 100)).toFixed(2))
                : asset.fine_cu_t ?? null;

        const nextGov = calculationEngine.evaluateCopperGovernance({
            copperDomain: effDomain,
            residenceDays: nextDays,
            moisturePct: nextMoisture,
            tmlLimitPct: nextTml,
        });

        const diffs: HitlComparisonDiffItem[] = [];
        const compareField = (
            label: string,
            prevVal: number | null | undefined,
            nextVal: number | null,
            unit: string
        ) => {
            if ((prevVal ?? null) !== nextVal) {
                diffs.push({
                    field: label,
                    current:
                        prevVal != null ? `${prevVal}${unit}` : UNDECLARED_TECH_VALUE,
                    suggested:
                        nextVal != null ? `${nextVal}${unit}` : UNDECLARED_TECH_VALUE,
                });
            }
        };

        compareField(t('copper_governance.moisture', 'HUMEDAD w%'), asset.moisture_pct, nextMoisture, '%');
        compareField(t('copper_governance.tml', 'TML%'), asset.tml_pct, nextTml, '%');
        compareField(t('manual_capture.fields.cu_total_pct', 'LEY CuT (%)'), asset.cu_total_pct, nextCuT, '%');
        compareField(t('manual_capture.fields.cu_soluble_pct', 'LEY CuS (%)'), asset.cu_soluble_pct, nextCuS, '%');
        compareField(t('copper_governance.days', 'DÍAS DE RESIDENCIA'), asset.residence_days, nextDays, ' d');
        compareField(t('copper_governance.scale_weight', 'PESO ROMANA [t]'), asset.peso_romana, nextRomana, ' t');

        if (diffs.length === 0) {
            setStatusBanner({
                type: 'info',
                text: t('hitl.no_changes', 'No existen modificaciones respecto a la ficha actual.'),
            });
            return;
        }

        setPendingHitl({
            source: 'copper',
            patch: {
                moisture_pct: nextMoisture,
                tml_pct: nextTml,
                cu_total_pct: nextCuT,
                cu_soluble_pct: nextCuS,
                residence_days: nextDays,
                peso_romana: nextRomana,
                dry_weight_tms: nextTms,
                fine_cu_t: nextFineCu,
                copper_governance_alerts: nextGov.alerts,
                metadata: {
                    ...(asset.metadata || {}),
                    conciliado: Boolean(nextRomana && nextRomana > 0),
                    fecha_conciliacion:
                        nextRomana && nextRomana > 0
                            ? Date.now()
                            : asset.metadata?.fecha_conciliacion,
                },
            },
            diffs,
        });
    };

    const handleToggleRosinEdit = () => {
        setStatusBanner(null);
        if (!isEditingRosin) {
            setDraftP80Mm(effP80Mm != null ? String(effP80Mm) : '');
            setDraftP50Mm(effRosin?.p50_mm != null ? String(effRosin.p50_mm) : '');
        }
        setIsEditingRosin((prev) => !prev);
    };

    const handlePrepareRosinHitl = (e: React.FormEvent) => {
        e.preventDefault();
        const nextP80 = parseNullableNumber(draftP80Mm);
        const nextP50 = parseNullableNumber(draftP50Mm);

        if (nextP80 === null || nextP50 === null) {
            setStatusBanner({
                type: 'error',
                text: t(
                    'rosin_rammler.invalid_percentiles_error',
                    'Valores inválidos: se requiere P80 > P50 > 0 mm.'
                ),
            });
            return;
        }

        const computed = calculationEngine.computeRosinRammlerFromPercentiles({
            p80Mm: nextP80,
            p50Mm: nextP50,
            oversizeThresholdMm: effRosin?.oversize_threshold_mm ?? 250,
        });

        if (!computed) {
            setStatusBanner({
                type: 'error',
                text: t(
                    'rosin_rammler.invalid_percentiles_error',
                    'Valores inválidos: se requiere P80 > P50 > 0 mm.'
                ),
            });
            return;
        }

        const nextProfile: RosinRammlerProfile = {
            ...computed,
            oversize_count: effRosin?.oversize_count ?? 0,
            ...(typeof effRosin?.max_boulder_mm === 'number'
                ? { max_boulder_mm: effRosin.max_boulder_mm }
                : {}),
        };

        const diffs: HitlComparisonDiffItem[] = [];
        const pushDiff = (label: string, prevVal: number | null | undefined, nextVal: number, unit: string) => {
            if ((prevVal ?? null) !== nextVal) {
                diffs.push({
                    field: label,
                    current: prevVal != null ? `${prevVal}${unit}` : UNDECLARED_TECH_VALUE,
                    suggested: `${nextVal}${unit}`,
                });
            }
        };

        pushDiff(t('rosin_rammler.p80_label', 'P80 (mm)'), effP80Mm, nextProfile.p80_mm, ' mm');
        pushDiff(t('rosin_rammler.p50_label', 'P50 (mm)'), effRosin?.p50_mm, nextProfile.p50_mm, ' mm');
        pushDiff(t('rosin_rammler.xc_label', 'xc (mm)'), effRosin?.xc_mm, nextProfile.xc_mm, ' mm');
        pushDiff(
            t('rosin_rammler.uniformity_n_label', 'Uniformidad (n)'),
            effRosin?.uniformity_n,
            nextProfile.uniformity_n,
            ''
        );

        if (diffs.length === 0) {
            setStatusBanner({
                type: 'info',
                text: t('hitl.no_changes', 'No existen modificaciones respecto a la ficha actual.'),
            });
            return;
        }

        setPendingHitl({
            source: 'rosin',
            patch: {
                p80_mm: nextProfile.p80_mm,
                rosin_rammler: nextProfile,
            },
            diffs,
        });
    };

    const handleReconstruct3D = async () => {
        if (!measurement.geometry?.type || !measurement.geometry?.dimensions) return;
        setIsReconstructing3D(true);
        setStatusBanner(null);
        try {
            const result = await photogrammetry3dService.reconstructStockpile3D({
                stockpileId: measurement.assetId,
                measurementId: measurement.id,
                geometryType: measurement.geometry.type,
                dimensions: measurement.geometry.dimensions as Record<string, number | undefined>,
                photoUrls: [
                    ...(measurement.photo_url ? [measurement.photo_url] : []),
                    ...(measurement.perimeter_photo_urls || []),
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
                measurement.assetId
            );
            setStatusBanner({
                type: 'success',
                text:
                    result.source === 'LOCAL_DETERMINISTIC_TIN_GLB'
                        ? t(
                            'twin3d.reconstruction_offline',
                            'Malla .glb generada localmente (TIN Determinista Offline-First).'
                        )
                        : t(
                            'twin3d.reconstruction_ready',
                            'Malla 3D .glb verificada y consolidada en CAS.'
                        ),
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text: `${t('twin3d.reconstruction_error', 'Error al reconstruir gemelo 3D .glb')}${err instanceof Error && err.message ? `: ${err.message}` : ''
                    }`,
            });
        } finally {
            setIsReconstructing3D(false);
        }
    };

    const handleConfirmHitl = async () => {
        if (!pendingHitl) return;
        const targetAssetId = asset?.id || measurement.assetId;
        if (!targetAssetId) return;
        setIsSavingHitl(true);
        try {
            await dataService.updateAssetWithHitl(
                targetAssetId,
                pendingHitl.patch,
                'ACTUALIZAR',
                pendingHitl.diffs
            );
            if (pendingHitl.source === 'rosin') {
                if (pendingHitl.patch.rosin_rammler) {
                    setLocalRosinOverride(pendingHitl.patch.rosin_rammler);
                }
                setIsEditingRosin(false);
            } else {
                setIsEditingCopper(false);
            }
            setPendingHitl(null);
            setStatusBanner({
                type: 'success',
                text: t('hitl.save_success', 'Registro actualizado y firmado en AuditLedger.'),
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text:
                    err instanceof Error
                        ? err.message
                        : t('hitl.save_error', 'Error al registrar la actualización HITL.'),
            });
        } finally {
            setIsSavingHitl(false);
        }
    };

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

    const effMeshUrl = localMeshResult?.meshUrl ?? measurement.mesh_url ?? null;
    const effMeshSha256 = localMeshResult?.sha256 ?? measurement.mesh_sha256;
    const effMeshSource = localMeshResult?.source ?? measurement.mesh_source;
    const effTinVolumeM3 = localMeshResult?.tinVolumeM3 ?? measurement.tin_volume_m3 ?? null;
    const effMeshCas =
        localMeshResult ||
        measurement.mesh_original_bytes !== undefined ||
        measurement.mesh_optimized_bytes !== undefined ||
        effMeshSha256
            ? {
                  originalBytes:
                      localMeshResult?.originalBytes ?? measurement.mesh_original_bytes,
                  optimizedBytes:
                      localMeshResult?.optimizedBytes ?? measurement.mesh_optimized_bytes,
                  savingsPct:
                      localMeshResult?.savingsPct ?? measurement.mesh_savings_pct,
                  sha256: effMeshSha256,
              }
            : undefined;
    const hasDeclaredGeometry = Boolean(
        measurement.geometry?.type &&
            measurement.geometry?.dimensions &&
            Object.values(measurement.geometry.dimensions).some(
                (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
            )
    );

    const mSpatial = measurement as StockpileMeasurement & SpatialMetrologyFields;
    const aSpatial = asset as (StockpileAsset & SpatialMetrologyFields) | null;
    const effUncertaintyPct = mSpatial.uncertainty_pct ?? aSpatial?.uncertainty_pct ?? null;
    const effToeScore = mSpatial.toe_score ?? aSpatial?.toe_score ?? null;
    const effCoveragePct = mSpatial.coverage_pct ?? aSpatial?.coverage_pct ?? null;
    const effDepthMode = mSpatial.depth_mode ?? aSpatial?.depth_mode ?? null;
    const effGroundSlopeDeg = mSpatial.ground_slope_deg ?? aSpatial?.ground_slope_deg ?? null;
    const effDepthModeDisplay = formatSpatialDepthMode(effDepthMode);

    return (
        <main className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none">
            <header
                className={`shrink-0 h-14 flex items-center justify-between gap-fib-8 no-print rounded-none shadow-none ${
                    isMobile
                        ? 'px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C]'
                        : 'px-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C]'
                }`}
            >
                <div className="flex items-center gap-fib-8 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        title={t('common.back_button', 'VOLVER')}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className={`bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shrink-0 flex items-center justify-center ${
                            isMobile ? 'min-w-[48px] min-h-[48px]' : 'p-2'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[24px] text-[#C68346]">
                            arrow_back
                        </span>
                    </button>
                    {isMobile ? (
                        <h1 className="text-h2-section font-mono font-bold uppercase tracking-tight truncate">
                            {asset?.name || measurement.assetId}
                        </h1>
                    ) : (
                        <div className="min-w-0">
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                {asset?.name || measurement.assetId} · {measurement.id}
                            </span>
                            <h1 className="text-h1-header font-bold uppercase tracking-tight truncate">
                                {t('analytics.detail_title', 'DOSSIER DE MEDICIÓN')}
                            </h1>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={handleExportPdf}
                        disabled={isExportingPdf}
                        title={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                        aria-label={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                        className={`bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 cursor-pointer rounded-none flex items-center justify-center ${
                            isMobile ? 'min-w-[48px] min-h-[48px]' : 'p-2'
                        }`}
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
                                    ? t('common.confirm_button', 'RESTAURAR')
                                    : t('analytics.ignored_label', 'IGNORADO')
                            }
                            aria-label={t('analytics.ignored_label', 'IGNORADO')}
                            className={`bg-transparent border-0 outline-none cursor-pointer rounded-none flex items-center justify-center ${
                                isMobile ? 'min-w-[48px] min-h-[48px]' : 'p-2'
                            } ${measurement.ignored
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

            <div
                className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${
                    isMobile ? 'px-fib-13 py-fib-13' : 'p-fib-21'
                }`}
            >
                <div className="max-w-5xl mx-auto flex flex-col gap-fib-21 pb-fib-55">
                    {statusBanner && (
                        <div
                            role="status"
                            className={`p-fib-13 border rounded-none shadow-none flex items-center justify-between gap-fib-13 text-data-dense font-mono ${statusBanner.type === 'error'
                                ? 'border-red-600/50 bg-red-600/10 text-red-700 dark:text-red-400'
                                : statusBanner.type === 'success'
                                    ? 'border-[#00AEEF]/50 bg-[#00AEEF]/10 text-[#0F172A] dark:text-[#F3F4F6]'
                                    : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6]'
                                }`}
                        >
                            <span>{statusBanner.text}</span>
                            <button
                                type="button"
                                onClick={() => setStatusBanner(null)}
                                aria-label={t('common.close_button', 'CERRAR')}
                                className="bg-transparent border-0 outline-none p-1 text-current cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        </div>
                    )}

                    <section
                        className={
                            isMobile
                                ? 'py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13'
                                : 'p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13'
                        }
                    >
                        <StockpileVisualStage
                            photoUrl={measurement.photo_url}
                            initialPhotoUrl={asset?.initial_photo_url}
                            perimeterPhotoUrls={perimeterUrls}
                            boulderDetections={effBoulders}
                            slopeAngleDeg={
                                measurement.detected_slope_angle_deg ??
                                asset?.detected_slope_angle_deg ??
                                null
                            }
                            meshUrl={effMeshUrl}
                            fallbackGeometry={
                                hasDeclaredGeometry && measurement.geometry
                                    ? {
                                          type: measurement.geometry.type,
                                          dimensions: measurement.geometry
                                              .dimensions as Record<string, number | undefined>,
                                      }
                                    : null
                            }
                            copperDomain={effDomain}
                            tinVolumeM3={effTinVolumeM3}
                            casMetrics={effMeshCas}
                            meshSource={effMeshSource}
                            uncertaintyPct={effUncertaintyPct}
                            toeScore={effToeScore}
                            coveragePct={effCoveragePct}
                            depthMode={effDepthMode}
                            altLabel={asset?.name || measurement.assetId}
                            isMobile={isMobile}
                            heightPx={isMobile ? 236 : 340}
                            canReconstruct3D={hasDeclaredGeometry}
                            isReconstructing3D={isReconstructing3D}
                            onReconstruct3D={() => void handleReconstruct3D()}
                        />

                        <ReportFieldRow
                            label={t('capture.cas_trace_label', 'TRAZABILIDAD CAS')}
                            value={casTraceText}
                            mono
                            copyable={Boolean(casTraceText)}
                        />
                    </section>

                    {/* Comparación Visual de Campaña ([ANTERIOR] -> [ACTUAL]) & Variación ΔV */}
                    <section
                        className={
                            isMobile
                                ? 'py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13'
                                : 'p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13'
                        }
                    >
                        <div className="flex flex-wrap items-center justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                            <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                {t(
                                    'history.visual_comparison_title',
                                    'COMPARACIÓN VISUAL DE CAMPAÑA ([ANTERIOR] ➔ [ACTUAL])'
                                )}
                            </h3>
                            <span
                                className={`text-data-dense font-mono font-bold tabular-nums ${typeof measurement.delta_volumen === 'number' &&
                                    measurement.delta_volumen < 0
                                    ? 'text-[#C68346]'
                                    : typeof measurement.delta_volumen === 'number' &&
                                        measurement.delta_volumen > 0
                                        ? 'text-[#00AEEF]'
                                        : 'text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                            >
                                {deltaVolumeDisplay || UNDECLARED_TECH_VALUE}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                            <div className="flex flex-col gap-fib-8">
                                <div className="flex items-center justify-between text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <span>{t('history.previous_photo_label', 'FOTO ANTERIOR')}</span>
                                    <span>
                                        {measurement.previous_measurement_id ||
                                            UNDECLARED_TECH_VALUE}
                                    </span>
                                </div>
                                <div
                                    className={`w-full h-48 flex items-center justify-center overflow-hidden rounded-none ${
                                        isMobile
                                            ? 'bg-transparent border-0'
                                            : 'bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]'
                                    }`}
                                >
                                    {resolvedPreviousPhoto ? (
                                        <SecureImage
                                            src={resolvedPreviousPhoto}
                                            alt={t('history.previous_photo_alt', 'Foto anterior')}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center gap-fib-8 px-fib-13 text-center">
                                            <span className="material-symbols-outlined text-[24px] text-[#94A3B8] dark:text-[#5A6072]">
                                                first_page
                                            </span>
                                            <span className="text-microcopy font-mono text-[#5A6072] dark:text-[#94A3B8]">
                                                {t(
                                                    'history.no_previous_base',
                                                    '[Sin captura previa — Medición Base]'
                                                )}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <div className="flex items-center justify-between text-microcopy font-mono uppercase text-[#C68346]">
                                    <span>{t('history.current_photo_label', 'FOTO ACTUAL')}</span>
                                    <span>{new Date(measurement.timestamp).toLocaleDateString()}</span>
                                </div>
                                <div
                                    className={`w-full h-48 flex items-center justify-center overflow-hidden rounded-none ${
                                        isMobile
                                            ? 'bg-transparent border-0 border-b-2 border-[#C68346]'
                                            : 'bg-[#F8FAFC] dark:bg-[#000000] border border-[#C68346]'
                                    }`}
                                >
                                    {resolvedPhoto ? (
                                        <SecureImage
                                            src={resolvedPhoto}
                                            alt={t('history.current_photo_alt', 'Foto actual')}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span className="material-symbols-outlined text-[28px] text-[#94A3B8] dark:text-[#5A6072]">
                                            image_not_supported
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section
                        className={
                            isMobile
                                ? 'grid grid-cols-2 border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C]'
                                : 'grid grid-cols-2 md:grid-cols-5 gap-fib-13'
                        }
                    >
                        <div
                            className={
                                isMobile
                                    ? 'py-fib-13 pr-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-transparent rounded-none'
                                    : 'p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none'
                            }
                        >
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('manual_capture.estimated_volume', 'VOLUMEN')}
                            </span>
                            <div className="flex items-baseline gap-fib-8 flex-wrap">
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {measurement.volumen_m3.toFixed(2)} m³
                                </span>
                                {typeof effUncertaintyPct === 'number' &&
                                    Number.isFinite(effUncertaintyPct) &&
                                    effUncertaintyPct > 0 && (
                                        <span
                                            className={`text-microcopy font-mono font-bold tabular-nums ${
                                                effUncertaintyPct <= 5
                                                    ? 'text-[#00AEEF]'
                                                    : effUncertaintyPct > 8
                                                      ? 'text-[#C68346]'
                                                      : 'text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                        >
                                            ± {effUncertaintyPct.toFixed(1)}%
                                        </span>
                                    )}
                            </div>
                        </div>
                        <div
                            className={
                                isMobile
                                    ? 'py-fib-13 pl-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-transparent rounded-none'
                                    : 'p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none'
                            }
                        >
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('history.delta_volume', 'Δ VOLUMEN')}
                            </span>
                            <span
                                className={`text-h2-section font-mono font-bold tabular-nums ${typeof measurement.delta_volumen === 'number' &&
                                    measurement.delta_volumen < 0
                                    ? 'text-[#C68346]'
                                    : typeof measurement.delta_volumen === 'number' &&
                                        measurement.delta_volumen > 0
                                        ? 'text-[#00AEEF]'
                                        : 'text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                            >
                                {deltaVolumeDisplay || UNDECLARED_TECH_VALUE}
                            </span>
                        </div>
                        <div
                            className={
                                isMobile
                                    ? 'py-fib-13 pr-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-transparent rounded-none'
                                    : 'p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none'
                            }
                        >
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('copper_governance.thm', 'THM [t]')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                                {thm.toFixed(2)} t
                            </span>
                        </div>
                        <div
                            className={
                                isMobile
                                    ? 'py-fib-13 pl-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-transparent rounded-none'
                                    : 'p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none'
                            }
                        >
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('copper_governance.tms', 'TMS [t]')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                {tms !== null ? `${tms.toFixed(2)} t` : '—'}
                            </span>
                        </div>
                        <div
                            className={
                                isMobile
                                    ? 'col-span-2 py-fib-13 bg-transparent border-0 rounded-none'
                                    : 'p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none'
                            }
                        >
                            <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('copper_governance.fine_cu', 'Cu FINO [t]')}
                            </span>
                            <span className="text-kpi-display font-mono font-bold tabular-nums text-[#00AEEF]">
                                {fineCu !== null ? `${fineCu.toFixed(2)} t` : '—'}
                            </span>
                        </div>
                    </section>

                    <section
                        className={
                            isMobile
                                ? 'py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none'
                                : 'p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none'
                        }
                    >
                        <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] mb-fib-13">
                            {t('geometries.subtitle', 'MODELO VOLUMÉTRICO')} · {t('clinometer.title', 'CLINÓMETRO IMU')}
                        </h3>
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
                        <ReportFieldRow
                            label={t('manual_capture.fields.density_factor', 'FACTOR DENSIDAD (t/m3)')}
                            value={
                                typeof measurement.density_factor === 'number'
                                    ? `${measurement.density_factor.toFixed(2)} t/m³`
                                    : null
                            }
                            mono
                        />
                        {dimensionEntries.map((dim) => (
                            <ReportFieldRow key={dim.label} label={dim.label} value={dim.value} mono />
                        ))}
                        <ReportFieldRow
                            label={t('clinometer.captured_angle', 'ÁNGULO CAPTURADO (deg)')}
                            value={
                                typeof measurement.imu_pitch_deg === 'number'
                                    ? `${measurement.imu_pitch_deg.toFixed(1)} deg`
                                    : null
                            }
                            mono
                        />
                        <ReportFieldRow
                            label={t('clinometer.horizontal_distance', 'DISTANCIA HORIZONTAL AL PIE (m)')}
                            value={
                                typeof measurement.imu_distance_m === 'number'
                                    ? `${measurement.imu_distance_m.toFixed(2)} m`
                                    : null
                            }
                            mono
                        />
                        <ReportFieldRow
                            label={t('history.delta_volume', 'Δ VOLUMEN')}
                            value={deltaVolumeDisplay}
                            mono
                        />
                        <ReportFieldRow
                            label={t('history.delta_weight', 'Δ PESO [t]')}
                            value={deltaWeightDisplay}
                            mono
                        />
                        <ReportFieldRow
                            label={t('clinometer.calculated_height', 'ALTURA CALCULADA IMU (m)')}
                            value={
                                typeof measurement.imu_height_m === 'number'
                                    ? `${measurement.imu_height_m.toFixed(2)} m`
                                    : null
                            }
                            mono
                        />
                        {measurement.analysis_status && (
                            <ReportFieldRow
                                label={t('digital_v2.status_label', 'ESTADO DIGITAL')}
                                value={measurement.analysis_status}
                                mono
                            />
                        )}
                        {typeof measurement.detected_slope_angle_deg === 'number' && (
                            <ReportFieldRow
                                label={t('digital_v2.slope_label', 'TALUD DETECTADO')}
                                value={`α ${measurement.detected_slope_angle_deg.toFixed(1)}°`}
                                mono
                            />
                        )}
                        {measurement.slope_warning && (
                            <ReportFieldRow
                                label={t('digital_v2.slope_alert_label', 'ALERTA DE TALUD')}
                                value={measurement.slope_warning}
                            />
                        )}
                        {typeof effGroundSlopeDeg === 'number' &&
                            Number.isFinite(effGroundSlopeDeg) && (
                                <ReportFieldRow
                                    label={t('visual3d.ground_slope_label', 'PENDIENTE PISO')}
                                    value={`${effGroundSlopeDeg.toFixed(1)}°`}
                                    mono
                                />
                            )}
                        {typeof effUncertaintyPct === 'number' &&
                            Number.isFinite(effUncertaintyPct) && (
                                <ReportFieldRow
                                    label={t('visual3d.uncertainty_label', 'INCERTIDUMBRE')}
                                    value={`± ${effUncertaintyPct.toFixed(1)}%`}
                                    mono
                                />
                            )}
                        {typeof effCoveragePct === 'number' &&
                            Number.isFinite(effCoveragePct) && (
                                <ReportFieldRow
                                    label={t('visual3d.coverage_label', 'COBERTURA PERIMETRAL')}
                                    value={`${Math.round(effCoveragePct)}%`}
                                    mono
                                />
                            )}
                        {typeof effToeScore === 'number' &&
                            Number.isFinite(effToeScore) && (
                                <ReportFieldRow
                                    label={t('visual3d.toe_score_label', 'CONFIANZA PIE (TOE)')}
                                    value={`${Math.round(effToeScore)}%`}
                                    mono
                                />
                            )}
                        {effDepthModeDisplay && (
                            <ReportFieldRow
                                label={t('visual3d.depth_mode_label', 'SENSOR ESPACIAL')}
                                value={effDepthModeDisplay}
                                mono
                            />
                        )}
                    </section>

                    <section
                        className={
                            isMobile
                                ? 'py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13'
                                : 'p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex flex-col gap-fib-13'
                        }
                    >
                        <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('analytics.geospatial_utm_title', 'GEOLOCALIZACIÓN SOBERANA UTM')}
                        </h3>
                        <ReportFieldRow
                            label="UTM (WGS84)"
                            value={canonicalFix?.utm.formatted || null}
                            mono
                            copyable={Boolean(canonicalFix)}
                        />
                        <ReportFieldRow
                            label="WGS84 (LAT / LNG)"
                            value={
                                canonicalFix
                                    ? `${canonicalFix.lat.toFixed(6)}, ${canonicalFix.lng.toFixed(6)}`
                                    : null
                            }
                            mono
                            copyable={Boolean(canonicalFix)}
                        />
                        <ReportFieldRow
                            label="EPSG / PRECISION"
                            value={
                                canonicalFix
                                    ? `${canonicalFix.utm.epsg}${canonicalFix.accuracyM != null
                                        ? ` (±${canonicalFix.accuracyM.toFixed(1)} m)`
                                        : ''
                                    }`
                                    : null
                            }
                            mono
                        />
                        <StockpileStaticMapCard
                            asset={asset}
                            fix={canonicalFix}
                            heightPx={220}
                            label={asset?.name || measurement.assetId}
                            flat={isMobile}
                        />
                    </section>

                    {/* Copper Metallurgy & HITL Block + Rosin-Rammler (Solo Escritorio) */}
                    {!isMobile && (
                        <>
                    <ReportBlockEditable
                        title={t('copper_governance.title', 'GOBERNANZA METALÚRGICA COBRE (Cu)')}
                        code={effDomain || undefined}
                        isEditing={isEditingCopper}
                        canEdit={Boolean(asset)}
                        onToggleEdit={handleToggleCopperEdit}
                        editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                    >
                        {isEditingCopper && asset ? (
                            <form
                                onSubmit={handlePrepareCopperHitl}
                                autoComplete="off"
                                spellCheck={false}
                                className="flex flex-col gap-fib-13"
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('copper_governance.moisture', 'HUMEDAD w%')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            value={draftMoisture}
                                            onChange={(e) => setDraftMoisture(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('copper_governance.tml', 'TML%')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            value={draftTml}
                                            onChange={(e) => setDraftTml(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('copper_governance.days', 'DÍAS DE RESIDENCIA')}
                                        </span>
                                        <input
                                            type="number"
                                            step="1"
                                            min="0"
                                            value={draftDays}
                                            onChange={(e) => setDraftDays(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('manual_capture.fields.cu_total_pct', 'LEY CuT (%)')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            max="100"
                                            value={draftCuT}
                                            onChange={(e) => setDraftCuT(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('manual_capture.fields.cu_soluble_pct', 'LEY CuS (%)')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            max="100"
                                            value={draftCuS}
                                            onChange={(e) => setDraftCuS(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('copper_governance.scale_weight', 'PESO ROMANA [t]')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={draftRomana}
                                            onChange={(e) => setDraftRomana(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                </div>
                                <div className="flex justify-end gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                    <button
                                        type="button"
                                        onClick={handleToggleCopperEdit}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                                    >
                                        {t('common.cancel_button', 'CANCELAR')}
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase border border-[#C68346] cursor-pointer rounded-none"
                                    >
                                        {t('hitl.save_audit', 'GUARDAR AUDITORÍA')}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="flex flex-col">
                                <ReportFieldRow
                                    label={t('registration.copper_domain_label', 'DOMINIO MINERAL COBRE (Cu)')}
                                    value={
                                        effDomain
                                            ? t(`copper_domains.${effDomain}`, effDomain)
                                            : null
                                    }
                                    mono
                                />
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
                                    label={t('manual_capture.fields.cu_total_pct', 'LEY CuT (%)')}
                                    value={effCuT != null ? `${effCuT}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('manual_capture.fields.cu_soluble_pct', 'LEY CuS (%)')}
                                    value={effCuS != null ? `${effCuS}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.rs_pct', 'RAZÓN SOLUBILIDAD RS%')}
                                    value={rsPct !== null ? `${rsPct}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.days', 'DÍAS DE RESIDENCIA')}
                                    value={effResidenceDays != null ? `${effResidenceDays} d` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.scale_weight', 'PESO ROMANA [t]')}
                                    value={
                                        effRomana != null && effRomana > 0
                                            ? `${effRomana.toFixed(2)} t${romanaComparison
                                                ? ` (Δ ${romanaComparison.differencePercent.toFixed(2)}%)`
                                                : ''
                                            }`
                                            : null
                                    }
                                    mono
                                />
                                {governance.alerts.length > 0 && (
                                    <div className="mt-fib-13 p-fib-13 border border-[#C68346]/50 bg-[#C68346]/10 rounded-none flex flex-col gap-fib-8">
                                        {governance.alerts.map((alert) => (
                                            <span
                                                key={alert.code}
                                                className="text-microcopy font-mono text-[#0F172A] dark:text-[#F3F4F6]"
                                            >
                                                [{alert.code}] {alert.message}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </ReportBlockEditable>

                    {/* Rosin-Rammler Granulometry & Boulders (Read-Only + HITL ACTUALIZAR) */}
                    <ReportBlockEditable
                        title={t(
                            'rosin_rammler.title',
                            'DISTRIBUCIÓN GRANULOMÉTRICA ROSIN-RAMMLER (RRSB)'
                        )}
                        isEditing={isEditingRosin}
                        onToggleEdit={handleToggleRosinEdit}
                        editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                    >
                        {isEditingRosin ? (
                            <form
                                onSubmit={handlePrepareRosinHitl}
                                autoComplete="off"
                                spellCheck={false}
                                className="flex flex-col gap-fib-13"
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('rosin_rammler.p80_label', 'P80 (mm)')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={draftP80Mm}
                                            onChange={(e) => setDraftP80Mm(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('rosin_rammler.p50_label', 'P50 (mm)')}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={draftP50Mm}
                                            onChange={(e) => setDraftP50Mm(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                                        />
                                    </label>
                                </div>
                                <div className="flex items-center justify-end gap-fib-13 pt-fib-8">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingRosin(false)}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                                    >
                                        {t('common.cancel_button', 'CANCELAR')}
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase cursor-pointer rounded-none"
                                    >
                                        {t('hitl.confirm_save_action', 'PREPARAR ACTUALIZAR')}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="flex flex-col gap-fib-13">
                                <div className="flex flex-col">
                                    <ReportFieldRow
                                        label={t('rosin_rammler.p80_label', 'P80 (mm)')}
                                        value={
                                            typeof effP80Mm === 'number'
                                                ? `${effP80Mm.toFixed(1)} mm`
                                                : null
                                        }
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
                                    <ReportFieldRow
                                        label={t('rosin_rammler.xc_label', 'xc (mm)')}
                                        value={
                                            typeof effRosin?.xc_mm === 'number'
                                                ? `${effRosin.xc_mm.toFixed(1)} mm`
                                                : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t(
                                            'rosin_rammler.uniformity_n_label',
                                            'Uniformidad (n)'
                                        )}
                                        value={
                                            typeof effRosin?.uniformity_n === 'number'
                                                ? effRosin.uniformity_n.toFixed(2)
                                                : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t('rosin_rammler.p20_label', 'P20 (mm)')}
                                        value={
                                            typeof effRosin?.p20_mm === 'number'
                                                ? `${effRosin.p20_mm.toFixed(1)} mm`
                                                : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t(
                                            'rosin_rammler.boulders_detected_title',
                                            'COLPAS DETECTADAS (box_2d)'
                                        )}
                                        value={
                                            effBoulders.length > 0
                                                ? String(effBoulders.length)
                                                : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t(
                                            'rosin_rammler.oversize_count_label',
                                            'Colpas sobre 250 mm'
                                        )}
                                        value={
                                            effRosin != null
                                                ? String(effRosin.oversize_count)
                                                : effBoulders.length > 0
                                                    ? String(
                                                        effBoulders.filter(
                                                            (b) =>
                                                                typeof b.estimated_mm ===
                                                                'number' &&
                                                                b.estimated_mm >= 250
                                                        ).length
                                                    )
                                                    : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t('rosin_rammler.source_label', 'Origen RRSB')}
                                        value={
                                            effRosin?.source === 'MANUAL_PERCENTILES'
                                                ? t(
                                                    'rosin_rammler.source_manual_percentiles',
                                                    'Percentiles manuales HITL'
                                                )
                                                : effRosin?.source === 'VISION_BOX2D_SCALED'
                                                    ? t(
                                                        'rosin_rammler.source_vision_box2d',
                                                        'Visión IA (box_2d)'
                                                    )
                                                    : effRosin?.source ?? null
                                        }
                                        mono
                                    />
                                </div>

                                {effRosin?.curve && effRosin.curve.length > 0 && (
                                    <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] overflow-x-auto">
                                        <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8">
                                            {t(
                                                'rosin_rammler.curve_title',
                                                'CURVA GRANULOMÉTRICA ESTÁNDAR'
                                            )}
                                        </span>
                                        <table className="w-full text-left font-mono tabular-nums text-data-dense border-collapse">
                                            <thead>
                                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    <th className="py-1 pr-fib-13">
                                                        {t(
                                                            'rosin_rammler.sieve_mm_col',
                                                            'Malla (mm)'
                                                        )}
                                                    </th>
                                                    <th className="py-1 pr-fib-13 text-right">
                                                        {t(
                                                            'rosin_rammler.passing_pct_col',
                                                            '% Pasante'
                                                        )}
                                                    </th>
                                                    <th className="py-1 text-right">
                                                        {t(
                                                            'rosin_rammler.retained_pct_col',
                                                            '% Retenido'
                                                        )}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {effRosin.curve.map((pt) => (
                                                    <tr
                                                        key={pt.size_mm}
                                                        className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6]"
                                                    >
                                                        <td className="py-1 pr-fib-13">
                                                            {pt.size_mm} mm
                                                        </td>
                                                        <td className="py-1 pr-fib-13 text-right text-[#00AEEF]">
                                                            {pt.passing_pct.toFixed(1)}%
                                                        </td>
                                                        <td className="py-1 text-right text-[#C68346]">
                                                            {pt.retained_pct.toFixed(1)}%
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </ReportBlockEditable>
                        </>
                    )}
                </div>
            </div>

            <HitlConfirmModal
                open={Boolean(pendingHitl)}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL DE AUDITORÍA')}
                description={t(
                    'hitl.modal_description',
                    'Revise el diferencial [Actual] -> [Sugerido] y escriba ACTUALIZAR para registrar en AuditLedger.'
                )}
                keyword="ACTUALIZAR"
                comparisonDiff={pendingHitl?.diffs || []}
                confirmLabel={t('hitl.save_audit', 'GUARDAR AUDITORÍA')}
                cancelLabel={t('common.cancel_button', 'CANCELAR')}
                loading={isSavingHitl}
                onConfirm={handleConfirmHitl}
                onCancel={() => setPendingHitl(null)}
            />
        </main>
    );
};
