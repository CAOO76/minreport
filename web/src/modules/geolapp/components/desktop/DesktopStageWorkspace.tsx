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
import { SecureImage } from '../../../../components/common/SecureImage';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import { useOptionalTheme } from '../../../../context/ThemeContext';
import { computeStockpileMeasurementChain } from '../../core/services/calculation-engine';
import { dataService } from '../../core/services/DataService';
import { useResolvedStockpileImage } from '../../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../../core/utils/vectorPdfGenerator';
import type { StockpileAsset, StockpileMeasurement } from '../../core/types/GeolappTypes';
import { StockpileStaticMapCard } from '../StockpileStaticMapCard';
import { StockpileTwin3DLazy } from '../StockpileTwin3DLazy';
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
    onNewMeasurement: () => void;
    onRequestClosure: () => void;
    onRequestReopen: () => void;
    onRequestDelete: () => void;
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

const CampaignComparisonPanel: React.FC<{
    measurement: StockpileMeasurement;
    onOpen3D: () => void;
    onClose: () => void;
}> = ({ measurement, onOpen3D, onClose }) => {
    const { t } = useTranslation();
    const resolvedPrev = useResolvedStockpileImage(measurement.previous_photo_url);
    const resolvedCurr = useResolvedStockpileImage(measurement.photo_url);

    const deltaVolStr = formatSignedDelta(
        measurement.delta_volumen,
        measurement.delta_volumen_pct
    );
    const deltaPesoStr =
        typeof measurement.delta_peso === 'number' && Number.isFinite(measurement.delta_peso)
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

    const imuParts = [
        typeof measurement.imu_pitch_deg === 'number'
            ? `${measurement.imu_pitch_deg.toFixed(1)}°`
            : null,
        typeof measurement.imu_height_m === 'number'
            ? `${measurement.imu_height_m.toFixed(2)} m`
            : null,
        measurement.geometry?.type ? String(measurement.geometry.type) : null,
    ].filter((val): val is string => Boolean(val));

    const undeclaredLabel = t('core_common.undeclared_tech_value', UNDECLARED_TECH_VALUE);

    return (
        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
            <header className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="min-w-0">
                    <span className="block text-microcopy font-mono font-bold uppercase text-[#C68346]">
                        {t('desktop.campaign_comparison', 'COMPARATIVA DE CAMPAÑA')}
                    </span>
                    <span className="block text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                        {new Date(measurement.timestamp).toLocaleString()} ·{' '}
                        <span className="uppercase text-[#00AEEF]">{measurement.method}</span>
                    </span>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={onOpen3D}
                        className="px-fib-13 py-1.5 bg-transparent border border-[#00AEEF] text-[#00AEEF] hover:bg-[#00AEEF]/10 font-mono text-microcopy font-bold uppercase cursor-pointer flex items-center gap-1 rounded-none"
                    >
                        <span className="material-symbols-outlined text-[16px]">deployed_code</span>
                        <span>{t('desktop.open_in_3d', 'VER EN GEMELO 3D')}</span>
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close', 'Cerrar')}
                        title={t('common.close', 'Cerrar')}
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
                    </div>
                    <div>
                        <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('desktop.col_weight_thm', 'THM [t]')}
                        </span>
                        <span className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                            {measurement.peso_t.toFixed(1)} t
                        </span>
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
                            CAS / IMU
                        </span>
                        <span className="block text-microcopy text-[#0F172A] dark:text-[#F3F4F6] break-words">
                            {casStr || undeclaredLabel}
                        </span>
                        {imuParts.length > 0 && (
                            <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {imuParts.join(' · ')}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const DesktopStageWorkspace: React.FC<DesktopStageWorkspaceProps> = ({
    asset,
    measurements,
    selectedMeasurementId,
    onSelectMeasurement,
    onNewMeasurement,
    onRequestClosure,
    onRequestReopen,
    onRequestDelete,
}) => {
    const { t } = useTranslation();
    const themeCtx = useOptionalTheme();
    const isDark = themeCtx?.theme === 'dark';

    const [stageTab, setStageTab] = useState<StageTab>('OVERVIEW');
    const [heroPhotoMode, setHeroPhotoMode] = useState<'latest' | 'initial'>('latest');
    const [ledgerCompareOpen, setLedgerCompareOpen] = useState(false);

    useEffect(() => {
        setStageTab('OVERVIEW');
        setHeroPhotoMode('latest');
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

    const heroPhotoRaw =
        heroPhotoMode === 'initial' && asset?.initial_photo_url
            ? asset.initial_photo_url
            : chain.summary.lastPhotoUrl ||
            asset?.last_photo_url ||
            asset?.initial_photo_url ||
            asset?.thumbnail_url;
    const resolvedHeroPhoto = useResolvedStockpileImage(heroPhotoRaw);

    const canonicalFix = useMemo(() => resolveCanonicalFix(asset), [asset]);

    if (!asset) {
        return (
            <section className="flex-1 flex items-center justify-center p-fib-55 bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="text-center space-y-fib-13 max-w-md">
                    <span className="material-symbols-outlined text-[48px] text-[#94A3B8] dark:text-[#5A6072]">
                        landscape
                    </span>
                    <p className="text-body-main font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('analytics.no_assets', 'Sin acopios registrados')}
                    </p>
                    <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                        {t(
                            'monitoring.field_only_create_hint',
                            'Los acopios nuevos se levantan en terreno desde la aplicación móvil MINREPORT.'
                        )}
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
    const hasInitialAlt = Boolean(
        asset.initial_photo_url &&
        chain.summary.lastPhotoUrl &&
        asset.initial_photo_url !== chain.summary.lastPhotoUrl
    );
    const selectedMeas =
        orderedMeas.find((m) => m.id === selectedMeasurementId) ||
        chain.summary.latestActive ||
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
                    {!isClosed ? (
                        <>
                            <button
                                type="button"
                                onClick={onNewMeasurement}
                                className="px-fib-13 py-2 bg-[#C68346] hover:bg-[#b5753b] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer flex items-center gap-1 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    add_a_photo
                                </span>
                                <span>{t('analytics.cubicar_button', 'CUBICAR')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={onRequestClosure}
                                title={t('lifecycle.close_shipment_action', 'Cerrar por embarque')}
                                aria-label={t('lifecycle.close_shipment_action', 'Cerrar por embarque')}
                                className="bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none"
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    local_shipping
                                </span>
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={onRequestReopen}
                            className="px-fib-13 py-2 border border-[#C68346] text-[#C68346] font-mono text-microcopy font-bold uppercase bg-transparent cursor-pointer rounded-none"
                        >
                            {t('lifecycle.reopen_action', 'REABRIR')}
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => void downloadGeolappVectorPdf(asset, orderedMeas)}
                        title={t('pdf.export_button', 'Exportar PDF')}
                        aria-label={t('pdf.export_button', 'Exportar PDF')}
                        className="bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">
                            picture_as_pdf
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={onRequestDelete}
                        title={t('common.delete_button', 'Eliminar acopio')}
                        aria-label={t('common.delete_button', 'Eliminar acopio')}
                        className="bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-red-500 cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                </div>
            </header>

            {/* Stage Tabs */}
            <nav className="shrink-0 flex items-center gap-fib-21 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                {(['OVERVIEW', 'TWIN_3D', 'LEDGER'] as const).map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => setStageTab(tab)}
                        className={`py-fib-13 text-microcopy font-mono font-bold uppercase border-0 border-b-2 bg-transparent cursor-pointer rounded-none transition-colors ${stageTab === tab
                            ? 'border-[#C68346] text-[#C68346]'
                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                    >
                        {tab === 'OVERVIEW'
                            ? t('desktop.stage_overview', 'RESUMEN Y EVOLUCIÓN')
                            : tab === 'TWIN_3D'
                                ? t('twin3d.title', 'GEMELO 3D / VISUAL')
                                : t('analytics.history_title', 'HISTORIAL DE CAMPAÑAS')}
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

                        {/* Temporal Evolution Chart */}
                        {chartData.length > 0 && (
                            <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                                <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] mb-fib-13">
                                    {t('analytics.evolution_chart_title', 'EVOLUCIÓN VOLUMEN (m³)')}
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
                                                    backgroundColor: isDark ? '#07090D' : '#FFFFFF',
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

                        {/* Dual Golden Ratio Visual Strip: CAS Hero Photo + Static Map */}
                        <div className="grid grid-cols-1 md:grid-cols-[1.618fr_1fr] gap-fib-13 items-stretch">
                            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none flex flex-col overflow-hidden">
                                <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between">
                                    <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {heroPhotoMode === 'initial'
                                            ? t('hero.initial_photo_label', 'FOTO INICIAL')
                                            : t('hero.latest_photo_label', 'ÚLTIMA CAPTURA')}
                                    </span>
                                    {hasInitialAlt && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setHeroPhotoMode((p) =>
                                                    p === 'latest' ? 'initial' : 'latest'
                                                )
                                            }
                                            className="bg-transparent border-0 text-microcopy font-mono font-bold uppercase text-[#00AEEF] cursor-pointer rounded-none"
                                        >
                                            {heroPhotoMode === 'latest'
                                                ? t('hero.switch_to_initial', 'VER INICIAL')
                                                : t('hero.switch_to_latest', 'VER ÚLTIMA')}
                                        </button>
                                    )}
                                </div>
                                {resolvedHeroPhoto ? (
                                    <SecureImage
                                        src={resolvedHeroPhoto}
                                        alt={asset.name}
                                        className="w-full h-56 object-cover"
                                    />
                                ) : (
                                    <div className="h-56 flex items-center justify-center text-[#94A3B8] dark:text-[#5A6072]">
                                        <span className="material-symbols-outlined text-[40px]">
                                            landscape
                                        </span>
                                    </div>
                                )}
                            </div>
                            <StockpileStaticMapCard
                                asset={asset}
                                fix={canonicalFix}
                                heightPx={224}
                            />
                        </div>
                    </>
                )}

                {stageTab === 'TWIN_3D' && (
                    <div className="space-y-fib-21">
                        <StockpileTwin3DLazy
                            meshUrl={selectedMeas?.mesh_url || asset.mesh_url}
                            fallbackGeometry={
                                selectedMeas?.geometry
                                    ? {
                                        type: selectedMeas.geometry.type,
                                        dimensions: selectedMeas.geometry.dimensions,
                                    }
                                    : null
                            }
                            copperDomain={asset.copper_domain}
                            tinVolumeM3={selectedMeas?.tin_volume_m3 ?? asset.tin_volume_m3}
                            meshSource={selectedMeas?.mesh_source ?? asset.mesh_source}
                            casMetrics={{
                                originalBytes:
                                    selectedMeas?.mesh_original_bytes ?? asset.mesh_original_bytes,
                                optimizedBytes:
                                    selectedMeas?.mesh_optimized_bytes ??
                                    asset.mesh_optimized_bytes,
                                savingsPct:
                                    selectedMeas?.mesh_savings_pct ?? asset.mesh_savings_pct,
                                sha256: selectedMeas?.mesh_sha256 ?? asset.mesh_sha256,
                            }}
                            heightPx={380}
                        />
                    </div>
                )}

                {stageTab === 'LEDGER' && (
                    <div className="space-y-fib-21">
                        {ledgerCompareOpen && selectedMeas && (
                            <CampaignComparisonPanel
                                measurement={selectedMeas}
                                onOpen3D={() => setStageTab('TWIN_3D')}
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
                                        <th className="p-fib-13 text-right">Δ</th>
                                        <th className="p-fib-13">CAS</th>
                                        <th className="p-fib-13 text-right" />
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
                                                    </span>
                                                </td>
                                                <td className="p-fib-13 text-right font-bold">
                                                    {m.volumen_m3.toFixed(2)}
                                                </td>
                                                <td className="p-fib-13 text-right text-[#00AEEF]">
                                                    {dStr || '--'}
                                                </td>
                                                <td className="p-fib-13 text-microcopy">
                                                    {casStr || '--'}
                                                </td>
                                                <td className="p-fib-13 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void dataService.toggleIgnoreMeasurement(
                                                                m.id,
                                                                m.assetId,
                                                                Boolean(m.ignored)
                                                            );
                                                        }}
                                                        aria-label={t(
                                                            'history.ignore_measurement',
                                                            'Alternar visibilidad'
                                                        )}
                                                        className="bg-transparent border-0 p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">
                                                            {m.ignored
                                                                ? 'visibility'
                                                                : 'visibility_off'}
                                                        </span>
                                                    </button>
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
