import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CopperMineralDomain,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import { buildCanonicalGeoFix } from '../../../core/geo/wgs84UtmProjection';
import { SovereignGeoMapLazy } from '../../../components/geo/SovereignGeoMapLazy';
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

interface StockpileDashboardProps {
    asset: StockpileAsset;
    measurements: StockpileMeasurement[];
    onBack: () => void;
    onNewMeasurement: () => void;
    onSelectMeasurement: (m: StockpileMeasurement) => void;
}

type EditingBlock = 'identity' | 'metallurgy' | null;

const COPPER_DOMAIN_LIST: CopperMineralDomain[] = [
    'OXIDO_CU',
    'MIXTO_CU',
    'SULFURO_SECUNDARIO_CU',
    'SULFURO_PRIMARIO_CU',
    'CONCENTRADO_CU',
    'BAJA_LEY_CU',
    'ESTERIL_RIPIOS',
];

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

export const StockpileDashboard: React.FC<StockpileDashboardProps> = ({
    asset,
    measurements,
    onBack,
    onNewMeasurement,
    onSelectMeasurement,
}) => {
    const { t } = useTranslation();

    const [showOriginalPhoto, setShowOriginalPhoto] = useState(false);
    const activePhotoRaw = showOriginalPhoto
        ? asset.initial_photo_url || asset.last_photo_url || asset.thumbnail_url
        : asset.last_photo_url || asset.initial_photo_url || asset.thumbnail_url;
    const resolvedHeroPhoto = useResolvedStockpileImage(activePhotoRaw);

    const [editingBlock, setEditingBlock] = useState<EditingBlock>(null);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [isSavingHitl, setIsSavingHitl] = useState(false);
    const [statusBanner, setStatusBanner] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    const [draftName, setDraftName] = useState(asset.name);
    const [draftClase, setDraftClase] = useState<StockpileAsset['clase']>(asset.clase);
    const [draftLocationRef, setDraftLocationRef] = useState(asset.location_ref || '');
    const [draftCopperDomain, setDraftCopperDomain] = useState<CopperMineralDomain | ''>(
        asset.copper_domain || ''
    );

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

    const [pendingHitl, setPendingHitl] = useState<{
        patch: Partial<StockpileAsset>;
        diffs: HitlComparisonDiffItem[];
    } | null>(null);

    const activeMeasurements = useMemo(
        () =>
            [...measurements]
                .filter((m) => !m.ignored)
                .sort((a, b) => b.timestamp - a.timestamp),
        [measurements]
    );

    const canonicalFix = useMemo(() => {
        const lat = asset.geo_point?.latitude ?? asset.location?.lat;
        const lng = asset.geo_point?.longitude ?? asset.location?.lng;
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
                accuracyM: asset.geo_point?.accuracy ?? null,
                source: 'CAPACITOR_GNSS',
            });
        } catch {
            return null;
        }
    }, [asset.geo_point, asset.location]);

    const thm = asset.wet_weight_thm ?? asset.last_weight_t ?? null;
    const tms = useMemo(() => {
        if (typeof asset.dry_weight_tms === 'number') return asset.dry_weight_tms;
        if (typeof thm === 'number' && typeof asset.moisture_pct === 'number') {
            return Number((thm * (1 - asset.moisture_pct / 100)).toFixed(2));
        }
        return null;
    }, [asset.dry_weight_tms, asset.moisture_pct, thm]);

    const rsPct = useMemo(() => {
        if (
            typeof asset.cu_total_pct === 'number' &&
            asset.cu_total_pct > 0 &&
            typeof asset.cu_soluble_pct === 'number'
        ) {
            return Number(((asset.cu_soluble_pct / asset.cu_total_pct) * 100).toFixed(1));
        }
        return null;
    }, [asset.cu_total_pct, asset.cu_soluble_pct]);

    const fineCu = useMemo(() => {
        if (typeof asset.fine_cu_t === 'number') return asset.fine_cu_t;
        if (typeof tms === 'number' && typeof asset.cu_total_pct === 'number') {
            return Number((tms * (asset.cu_total_pct / 100)).toFixed(2));
        }
        return null;
    }, [asset.fine_cu_t, asset.cu_total_pct, tms]);

    const romanaComparison = useMemo(() => {
        if (
            typeof asset.peso_romana === 'number' &&
            asset.peso_romana > 0 &&
            typeof thm === 'number' &&
            thm > 0
        ) {
            return calculationEngine.compareTonnage(thm, asset.peso_romana);
        }
        return null;
    }, [asset.peso_romana, thm]);

    const governance = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: asset.copper_domain,
                residenceDays: asset.residence_days,
                moisturePct: asset.moisture_pct,
                tmlLimitPct: asset.tml_pct,
            }),
        [asset.copper_domain, asset.residence_days, asset.moisture_pct, asset.tml_pct]
    );

    const origCas = formatKilobytes(asset.cas_original_bytes);
    const optCas = formatKilobytes(asset.cas_optimized_bytes);
    const casTraceText =
        origCas && optCas
            ? `ORIG ${origCas} -> CAS ${optCas}${
                  typeof asset.cas_savings_pct === 'number'
                      ? ` (-${asset.cas_savings_pct.toFixed(0)}%)`
                      : ''
              }`
            : null;

    const resetDrafts = () => {
        setDraftName(asset.name);
        setDraftClase(asset.clase);
        setDraftLocationRef(asset.location_ref || '');
        setDraftCopperDomain(asset.copper_domain || '');
        setDraftMoisture(asset.moisture_pct != null ? String(asset.moisture_pct) : '');
        setDraftTml(asset.tml_pct != null ? String(asset.tml_pct) : '');
        setDraftCuT(asset.cu_total_pct != null ? String(asset.cu_total_pct) : '');
        setDraftCuS(asset.cu_soluble_pct != null ? String(asset.cu_soluble_pct) : '');
        setDraftResidenceDays(
            asset.residence_days != null ? String(asset.residence_days) : ''
        );
        setDraftRomana(asset.peso_romana != null ? String(asset.peso_romana) : '');
    };

    const handleToggleBlock = (block: Exclude<EditingBlock, null>) => {
        setStatusBanner(null);
        if (editingBlock === block) {
            setEditingBlock(null);
            resetDrafts();
        } else {
            resetDrafts();
            setEditingBlock(block);
        }
    };

    const handlePrepareIdentitySave = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = draftName.trim().toUpperCase();
        const trimmedLoc = draftLocationRef.trim();
        const nextDomain = draftCopperDomain || undefined;

        const diffs: HitlComparisonDiffItem[] = [];
        const patch: Partial<StockpileAsset> = {};

        if (trimmedName && trimmedName !== asset.name) {
            diffs.push({
                field: t('registration.name_label', 'ID / NOMBRE DEL ACOPIO'),
                current: asset.name,
                suggested: trimmedName,
            });
            patch.name = trimmedName;
        }
        if (draftClase !== asset.clase) {
            diffs.push({
                field: t('registration.material_label', 'MATERIAL / MINERAL'),
                current: asset.clase,
                suggested: draftClase,
            });
            patch.clase = draftClase;
        }
        if (trimmedLoc !== (asset.location_ref || '')) {
            diffs.push({
                field: t('registration.location_ref_label', 'REFERENCIA UBICACIÓN'),
                current: asset.location_ref || UNDECLARED_TECH_VALUE,
                suggested: trimmedLoc || UNDECLARED_TECH_VALUE,
            });
            patch.location_ref = trimmedLoc;
        }
        if (nextDomain !== asset.copper_domain) {
            diffs.push({
                field: t('registration.copper_domain_label', 'DOMINIO MINERAL COBRE (Cu)'),
                current: asset.copper_domain || UNDECLARED_TECH_VALUE,
                suggested: nextDomain || UNDECLARED_TECH_VALUE,
            });
            patch.copper_domain = nextDomain;
        }

        if (diffs.length === 0) {
            setStatusBanner({
                type: 'info',
                text: t('hitl.no_changes', 'No existen modificaciones respecto a la ficha actual.'),
            });
            return;
        }

        setPendingHitl({ patch, diffs });
    };

    const handlePrepareMetallurgySave = (e: React.FormEvent) => {
        e.preventDefault();
        const nextMoisture = parseNullableNumber(draftMoisture);
        const nextTml = parseNullableNumber(draftTml);
        const nextCuT = parseNullableNumber(draftCuT);
        const nextCuS = parseNullableNumber(draftCuS);
        const nextDays = parseNullableNumber(draftResidenceDays);
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
            copperDomain: asset.copper_domain,
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
                    current: prevVal != null ? `${prevVal}${unit}` : UNDECLARED_TECH_VALUE,
                    suggested: nextVal != null ? `${nextVal}${unit}` : UNDECLARED_TECH_VALUE,
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

    const handleConfirmHitl = async () => {
        if (!pendingHitl) return;
        setIsSavingHitl(true);
        try {
            await dataService.updateAssetWithHitl(
                asset.id,
                pendingHitl.patch,
                'ACTUALIZAR',
                pendingHitl.diffs
            );
            setPendingHitl(null);
            setEditingBlock(null);
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
        try {
            await downloadGeolappVectorPdf(asset, activeMeasurements);
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

    return (
        <main className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none">
            {/* Header */}
            <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13 no-print">
                <div className="flex items-center gap-fib-13 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        title={t('common.back_button', 'VOLVER')}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[24px] text-[#C68346]">
                            arrow_back
                        </span>
                    </button>
                    <div className="min-w-0">
                        <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                            {asset.id} · {t('hitl.report_mode', 'MODO INFORME TÉCNICO (SOLO LECTURA)')}
                        </span>
                        <h1 className="text-h1-header font-bold uppercase tracking-tight truncate">
                            {asset.name}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={handleExportPdf}
                        disabled={isExportingPdf}
                        title={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                        aria-label={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[24px]">
                            picture_as_pdf
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={onNewMeasurement}
                        title={t('analytics.new_measurement_button', 'NUEVA MEDICIÓN')}
                        aria-label={t('analytics.new_measurement_button', 'NUEVA MEDICIÓN')}
                        className="bg-transparent border-0 outline-none p-2 text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[26px]">add_circle</span>
                    </button>
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

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-fib-21">
                <div className="max-w-5xl mx-auto flex flex-col gap-fib-21 pb-fib-55">
                    {statusBanner && (
                        <div
                            role="status"
                            className={`p-fib-13 border rounded-none shadow-none flex items-center justify-between gap-fib-13 text-data-dense font-mono ${
                                statusBanner.type === 'error'
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

                    {/* Governance Alerts */}
                    {governance.alerts.length > 0 && (
                        <div
                            role="alert"
                            className={`p-fib-21 border rounded-none shadow-none flex flex-col gap-fib-8 ${
                                governance.hasCriticalBlock
                                    ? 'border-red-600 bg-red-600/10 text-red-700 dark:text-red-300'
                                    : 'border-[#C68346] bg-[#C68346]/10 text-[#0F172A] dark:text-[#F3F4F6]'
                            }`}
                        >
                            <div className="flex items-center gap-fib-8 text-microcopy font-mono font-bold uppercase tracking-wider">
                                <span className="material-symbols-outlined text-[18px] text-[#C68346]">
                                    {governance.hasCriticalBlock ? 'block' : 'warning'}
                                </span>
                                <span>
                                    {governance.hasCriticalBlock
                                        ? t('copper_governance.dispatch_blocked', 'DESPACHO BLOQUEADO (IMSBC)')
                                        : t('copper_governance.title', 'GOBERNANZA METALÚRGICA COBRE (Cu)')}
                                </span>
                            </div>
                            {governance.alerts.map((alert) => (
                                <p key={alert.code} className="text-data-dense font-mono">
                                    [{alert.code}] {alert.message}
                                </p>
                            ))}
                        </div>
                    )}

                    {/* Hero Section (61.8% Visual / 38.2% Primary Metrics when lg) */}
                    <section className="grid grid-cols-1 lg:grid-cols-[1.618fr_1fr] gap-fib-21 items-stretch">
                        <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col gap-fib-13">
                            <div className="w-full h-64 sm:h-72 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden rounded-none">
                                {resolvedHeroPhoto ? (
                                    <SecureImage
                                        src={resolvedHeroPhoto}
                                        alt={asset.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <span className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]">
                                        landscape
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center justify-between gap-fib-13 flex-wrap">
                                <span className="text-microcopy font-mono tabular-nums text-[#00AEEF]">
                                    {casTraceText || UNDECLARED_TECH_VALUE}
                                </span>
                                {asset.initial_photo_url && asset.last_photo_url && (
                                    <button
                                        type="button"
                                        onClick={() => setShowOriginalPhoto((p) => !p)}
                                        className="px-fib-13 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none"
                                    >
                                        {showOriginalPhoto ? 'LATEST CAS' : 'INITIAL CAS'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-fib-13">
                            <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col justify-between">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('manual_capture.estimated_volume', 'VOLUMEN')}
                                </span>
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {typeof asset.last_volume_m3 === 'number'
                                        ? `${asset.last_volume_m3.toFixed(2)} m³`
                                        : '—'}
                                </span>
                            </div>

                            <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col justify-between">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('copper_governance.thm', 'THM [t]')}
                                </span>
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                                    {typeof thm === 'number' ? `${thm.toFixed(2)} t` : '—'}
                                </span>
                            </div>

                            <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col justify-between">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('copper_governance.tms', 'TMS [t]')}
                                </span>
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {typeof tms === 'number' ? `${tms.toFixed(2)} t` : '—'}
                                </span>
                            </div>

                            <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col justify-between">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('copper_governance.fine_cu', 'Cu FINO [t]')}
                                </span>
                                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#00AEEF]">
                                    {typeof fineCu === 'number' ? `${fineCu.toFixed(2)} t` : '—'}
                                </span>
                            </div>
                        </div>
                    </section>

                    {/* Identity & Geo Editable Report Block */}
                    <ReportBlockEditable
                        title={t('analytics.geospatial_utm_title', 'GEOLOCALIZACIÓN SOBERANA UTM')}
                        code={asset.id}
                        isEditing={editingBlock === 'identity'}
                        onToggleEdit={() => handleToggleBlock('identity')}
                        editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                    >
                        {editingBlock === 'identity' ? (
                            <form
                                onSubmit={handlePrepareIdentitySave}
                                autoComplete="off"
                                spellCheck={false}
                                className="flex flex-col gap-fib-13"
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('registration.name_label', 'ID / NOMBRE DEL ACOPIO')}
                                        </span>
                                        <input
                                            type="text"
                                            value={draftName}
                                            onChange={(e) => setDraftName(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            required
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('registration.location_ref_label', 'REFERENCIA UBICACIÓN')}
                                        </span>
                                        <input
                                            type="text"
                                            value={draftLocationRef}
                                            onChange={(e) => setDraftLocationRef(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('registration.copper_domain_label', 'DOMINIO MINERAL COBRE (Cu)')}
                                        </span>
                                        <select
                                            value={draftCopperDomain}
                                            onChange={(e) =>
                                                setDraftCopperDomain(
                                                    e.target.value as CopperMineralDomain | ''
                                                )
                                            }
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                        >
                                            <option value="">{UNDECLARED_TECH_VALUE}</option>
                                            {COPPER_DOMAIN_LIST.map((dom) => (
                                                <option key={dom} value={dom}>
                                                    {t(`copper_domains.${dom}`, dom)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('registration.material_label', 'MATERIAL / MINERAL')}
                                        </span>
                                        <select
                                            value={draftClase}
                                            onChange={(e) =>
                                                setDraftClase(
                                                    e.target.value as StockpileAsset['clase']
                                                )
                                            }
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                        >
                                            <option value="mineral">
                                                {t('material_type.mineral', 'Mineral')}
                                            </option>
                                            <option value="baja_ley">
                                                {t('material_type.baja_ley', 'Baja Ley')}
                                            </option>
                                            <option value="esteril">
                                                {t('material_type.esteril', 'Estéril')}
                                            </option>
                                        </select>
                                    </label>
                                </div>
                                <div className="flex justify-end gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                    <button
                                        type="button"
                                        onClick={() => handleToggleBlock('identity')}
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
                            <div className="flex flex-col gap-fib-13">
                                <div className="flex flex-col">
                                    <ReportFieldRow
                                        label={t('registration.name_label', 'ID / NOMBRE DEL ACOPIO')}
                                        value={asset.name}
                                        mono
                                        copyable
                                    />
                                    <ReportFieldRow
                                        label={t('registration.location_ref_label', 'REFERENCIA UBICACIÓN')}
                                        value={asset.location_ref || null}
                                    />
                                    <ReportFieldRow
                                        label={t('registration.copper_domain_label', 'DOMINIO MINERAL COBRE (Cu)')}
                                        value={
                                            asset.copper_domain
                                                ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
                                                : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t('geometries.subtitle', 'MODELO VOLUMÉTRICO')}
                                        value={
                                            asset.last_geometry_type
                                                ? t(
                                                      `geometries.${asset.last_geometry_type}`,
                                                      String(asset.last_geometry_type)
                                                  )
                                                : null
                                        }
                                        mono
                                    />
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
                                </div>
                                {canonicalFix && (
                                    <SovereignGeoMapLazy
                                        fix={canonicalFix}
                                        interactive={false}
                                        label={asset.name}
                                        heightPx={200}
                                    />
                                )}
                            </div>
                        )}
                    </ReportBlockEditable>

                    {/* Copper Metallurgy & Romana Editable Report Block */}
                    <ReportBlockEditable
                        title={t('copper_governance.title', 'GOBERNANZA METALÚRGICA COBRE (Cu)')}
                        isEditing={editingBlock === 'metallurgy'}
                        onToggleEdit={() => handleToggleBlock('metallurgy')}
                        editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                    >
                        {editingBlock === 'metallurgy' ? (
                            <form
                                onSubmit={handlePrepareMetallurgySave}
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
                                            value={draftResidenceDays}
                                            onChange={(e) => setDraftResidenceDays(e.target.value)}
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
                                        onClick={() => handleToggleBlock('metallurgy')}
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
                                    label={t('copper_governance.moisture', 'HUMEDAD w%')}
                                    value={asset.moisture_pct != null ? `${asset.moisture_pct}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.tml', 'TML%')}
                                    value={asset.tml_pct != null ? `${asset.tml_pct}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('manual_capture.fields.cu_total_pct', 'LEY CuT (%)')}
                                    value={asset.cu_total_pct != null ? `${asset.cu_total_pct}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('manual_capture.fields.cu_soluble_pct', 'LEY CuS (%)')}
                                    value={asset.cu_soluble_pct != null ? `${asset.cu_soluble_pct}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.rs_pct', 'RAZÓN SOLUBILIDAD RS%')}
                                    value={rsPct !== null ? `${rsPct}%` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.days', 'DÍAS DE RESIDENCIA')}
                                    value={asset.residence_days != null ? `${asset.residence_days} d` : null}
                                    mono
                                />
                                <ReportFieldRow
                                    label={t('copper_governance.scale_weight', 'PESO ROMANA [t]')}
                                    value={
                                        asset.peso_romana != null && asset.peso_romana > 0
                                            ? `${asset.peso_romana.toFixed(2)} t${
                                                  romanaComparison
                                                      ? ` (Δ ${romanaComparison.differencePercent.toFixed(2)}%)`
                                                      : ''
                                              }`
                                            : null
                                    }
                                    mono
                                />
                            </div>
                        )}
                    </ReportBlockEditable>

                    {/* Measurement History */}
                    <section className="flex flex-col gap-fib-13">
                        <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('analytics.history_title', 'HISTORIAL DE MEDICIONES')} ({measurements.length})
                        </h3>
                        {measurements.length === 0 ? (
                            <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] rounded-none">
                                {UNDECLARED_TECH_VALUE}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-fib-8">
                                {measurements.map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => onSelectMeasurement(m)}
                                        className={`w-full text-left p-fib-13 border transition-colors cursor-pointer rounded-none shadow-none flex items-center justify-between gap-fib-13 ${
                                            m.ignored
                                                ? 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] opacity-60'
                                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] hover:border-[#C68346]'
                                        }`}
                                    >
                                        <div className="min-w-0 flex flex-col">
                                            <span className="text-data-dense font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {new Date(m.timestamp).toLocaleString()} · {m.method.toUpperCase()}
                                            </span>
                                            <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] truncate">
                                                {m.geometry?.type
                                                    ? t(
                                                          `geometries.${m.geometry.type}`,
                                                          String(m.geometry.type)
                                                      )
                                                    : UNDECLARED_TECH_VALUE}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-fib-13 font-mono tabular-nums text-right shrink-0">
                                            <div>
                                                <span className="block text-data-dense font-bold">
                                                    {m.volumen_m3.toFixed(2)} m³
                                                </span>
                                                <span className="block text-microcopy text-[#C68346]">
                                                    {m.peso_t.toFixed(2)} t
                                                </span>
                                            </div>
                                            <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                                                chevron_right
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
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
