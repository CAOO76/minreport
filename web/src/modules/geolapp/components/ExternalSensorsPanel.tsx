import React, { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../../../components/common/CopyButton';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import {
    gnssRtkNmeaAdapter,
    isWebSerialSupported,
    parseNmeaStream,
} from '../core/adapters/GnssRtkNmeaAdapter';
import type {
    GnssRtkFixRecord,
    SurfacePointCloudSummary,
} from '../core/adapters/ISurfaceSourceAdapter';
import { mobileLidarAdapter } from '../core/adapters/MobileLidarAdapter';
import { uavPointCloudAdapter } from '../core/adapters/UavPointCloudAdapter';

export interface ExternalSensorsPanelProps {
    tenantId?: string;
    uploadCas?: boolean;
    compact?: boolean;
    onSurfaceImported?: (summary: SurfacePointCloudSummary) => void;
    onRtkFixCaptured?: (fix: GnssRtkFixRecord) => void;
}

const PENDING_RECORD = '[Pendiente de registro]';
const UNDECLARED_VALUE = '[Información técnica no declarada en ficha]';

const FLAT_ICON_BTN_CLASS =
    'bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none inline-flex items-center justify-center';

function formatByteFootprint(bytes?: number | null): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return PENDING_RECORD;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
}

function computeSavingsPct(originalBytes: number, optimizedBytes: number): number {
    if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
    return Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 1000) / 10);
}

export const ExternalSensorsPanel: React.FC<ExternalSensorsPanelProps> = ({
    tenantId,
    uploadCas = false,
    compact = false,
    onSurfaceImported,
    onRtkFixCaptured,
}) => {
    const { t } = useTranslation();
    const surfaceFileInputId = useId();
    const nmeaFileInputId = useId();
    const surfaceInputRef = useRef<HTMLInputElement | null>(null);
    const nmeaFileInputRef = useRef<HTMLInputElement | null>(null);

    const [surfaceBusy, setSurfaceBusy] = useState(false);
    const [surfaceError, setSurfaceError] = useState<string | null>(null);
    const [surfaceFilename, setSurfaceFilename] = useState<string | null>(null);
    const [surfaceSummary, setSurfaceSummary] = useState<SurfacePointCloudSummary | null>(null);

    const [nmeaRawText, setNmeaRawText] = useState('');
    const [nmeaBusy, setNmeaBusy] = useState(false);
    const [nmeaError, setNmeaError] = useState<string | null>(null);
    const [nmeaStats, setNmeaStats] = useState<{
        validCount: number;
        rejectedCount: number;
        bestFix: GnssRtkFixRecord | null;
    }>({ validCount: 0, rejectedCount: 0, bestFix: null });

    const webSerialAvailable = useMemo(() => isWebSerialSupported(), []);

    const handleSurfaceFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setSurfaceBusy(true);
        setSurfaceError(null);
        setSurfaceFilename(file.name);

        try {
            const buffer = await file.arrayBuffer();
            const lowerName = file.name.toLowerCase();
            let result: SurfacePointCloudSummary;

            if (mobileLidarAdapter.canHandle(lowerName)) {
                result = await mobileLidarAdapter.parse(buffer, {
                    filename: file.name,
                    tenantId,
                    uploadCas,
                });
            } else if (uavPointCloudAdapter.canHandle(lowerName)) {
                result = await uavPointCloudAdapter.parse(buffer, {
                    filename: file.name,
                    tenantId,
                    uploadCas,
                });
            } else if (lowerName.endsWith('.laz')) {
                throw new Error(
                    t(
                        'geolapp.adapters.err_laz_unsupported',
                        'Formato .laz comprimido no soportado en cliente; exporte a .las sin compresión.'
                    )
                );
            } else {
                throw new Error(
                    t(
                        'geolapp.adapters.err_surface_format',
                        'Formato no soportado. Use .las, .xyz, .csv, .pts, .ply o .glb.'
                    )
                );
            }

            setSurfaceSummary(result);
            onSurfaceImported?.(result);
        } catch (err: unknown) {
            const msg =
                err instanceof Error
                    ? err.message
                    : t('geolapp.adapters.err_surface_parse', 'Error procesando superficie 3D.');
            setSurfaceError(msg);
            setSurfaceSummary(null);
        } finally {
            setSurfaceBusy(false);
            if (surfaceInputRef.current) {
                surfaceInputRef.current.value = '';
            }
        }
    };

    const handleClearSurface = () => {
        setSurfaceSummary(null);
        setSurfaceFilename(null);
        setSurfaceError(null);
    };

    const processNmeaText = (rawText: string) => {
        const trimmed = rawText.trim();
        if (!trimmed) {
            setNmeaError(
                t(
                    'geolapp.adapters.err_nmea_empty',
                    'Ingrese tramas NMEA-0183 ($GNGGA / $GPGGA / $GPRMC) antes de validar.'
                )
            );
            setNmeaStats({ validCount: 0, rejectedCount: 0, bestFix: null });
            return;
        }

        const parsed = parseNmeaStream(trimmed);
        setNmeaStats({
            validCount: parsed.fixes.length,
            rejectedCount: parsed.rejectedCount,
            bestFix: parsed.bestFix,
        });

        if (!parsed.bestFix) {
            setNmeaError(
                t(
                    'geolapp.adapters.err_nmea_no_valid_fix',
                    'Ninguna trama superó la validación checksum XOR *HH o calidad de fix GNSS.'
                )
            );
            return;
        }

        setNmeaError(null);
        onRtkFixCaptured?.(parsed.bestFix);
    };

    const handleNmeaFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setNmeaBusy(true);
        setNmeaError(null);
        try {
            const text = await file.text();
            setNmeaRawText(text);
            processNmeaText(text);
        } catch (err: unknown) {
            const msg =
                err instanceof Error
                    ? err.message
                    : t('geolapp.adapters.err_nmea_file', 'Error leyendo archivo NMEA.');
            setNmeaError(msg);
        } finally {
            setNmeaBusy(false);
            if (nmeaFileInputRef.current) {
                nmeaFileInputRef.current.value = '';
            }
        }
    };

    const handleWebSerialCapture = async () => {
        if (!webSerialAvailable) return;
        setNmeaBusy(true);
        setNmeaError(null);

        try {
            const res = await gnssRtkNmeaAdapter.captureFromWebSerial({
                baudRate: 115200,
                timeoutMs: 6000,
                maxLines: 30,
            });
            if (res.rawBuffer.trim()) {
                setNmeaRawText(res.rawBuffer.trim());
            }
            setNmeaStats({
                validCount: res.fixes.length,
                rejectedCount: res.rejectedCount,
                bestFix: res.bestFix,
            });
            if (!res.bestFix) {
                setNmeaError(
                    t(
                        'geolapp.adapters.err_nmea_serial_empty',
                        'Puerto serial conectado sin tramas NMEA válidas dentro de la ventana de lectura.'
                    )
                );
            } else {
                onRtkFixCaptured?.(res.bestFix);
            }
        } catch (err: unknown) {
            const msg =
                err instanceof Error
                    ? err.message
                    : t('geolapp.adapters.err_webserial', 'Error de lectura en puerto WebSerial.');
            setNmeaError(msg);
        } finally {
            setNmeaBusy(false);
        }
    };

    const handleClearNmea = () => {
        setNmeaRawText('');
        setNmeaError(null);
        setNmeaStats({ validCount: 0, rejectedCount: 0, bestFix: null });
    };

    const containerPadClass = compact ? 'p-fib-13 gap-fib-13' : 'p-fib-21 gap-fib-21';
    const cardPadClass = compact ? 'p-fib-13 gap-fib-13' : 'p-fib-21 gap-fib-13';

    const savingsPct = surfaceSummary
        ? typeof surfaceSummary.casSavingsPct === 'number'
            ? surfaceSummary.casSavingsPct
            : computeSavingsPct(surfaceSummary.originalBytes, surfaceSummary.optimizedGlbBytes)
        : 0;

    const casFootprintLabel = surfaceSummary
        ? `ORIG: ${formatByteFootprint(surfaceSummary.originalBytes)} -> CAS: ${formatByteFootprint(
              surfaceSummary.optimizedGlbBytes
          )} (-${savingsPct.toFixed(1)}%)`
        : PENDING_RECORD;

    const activeFix = nmeaStats.bestFix;
    const utmFormatted = activeFix
        ? `${String(activeFix.utmZone).padStart(2, '0')}${activeFix.utmBand} ${activeFix.easting.toFixed(
              2
          )} mE ${activeFix.northing.toFixed(2)} mN`
        : '';

    return (
        <section
            aria-label={t('geolapp.adapters.panel_title', 'SENSORES HARDWARE EXTERNOS')}
            className={`w-full flex flex-col bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none select-none font-atkinson text-[#0F172A] dark:text-[#F3F4F6] ${containerPadClass}`}
        >
            <header className="flex items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex flex-col gap-fib-8 min-w-0">
                    <span className="text-microcopy font-mono tabular-nums uppercase text-[#C68346]">
                        {t('geolapp.adapters.kicker', 'INGESTA HARDWARE DETERMINISTA')}
                    </span>
                    <h3 className="text-h2-section font-semibold truncate">
                        {t('geolapp.adapters.panel_title', 'SENSORES EXTERNOS (UAV / LIDAR / GNSS RTK)')}
                    </h3>
                </div>
                <span className="text-microcopy font-mono tabular-nums uppercase text-[#475569] dark:text-[#8A93A6] shrink-0">
                    SIRGAS-CHILE / GLTF 2.0
                </span>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-fib-21">
                {/* BLOQUE A: NUBES DE PUNTOS UAV / LIDAR MÓVIL (.LAS, .XYZ, .CSV, .PTS, .PLY, .GLB) */}
                <article
                    className={`flex flex-col bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none ${cardPadClass}`}
                >
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="flex flex-col gap-fib-8 min-w-0">
                            <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                {t('geolapp.adapters.surface_tag', 'UAV / LIDAR 3D')}
                            </span>
                            <h4 className="text-body-main font-semibold truncate">
                                {t(
                                    'geolapp.adapters.surface_title',
                                    'NUBE DE PUNTOS Y MALLA (.LAS / .XYZ / .PLY / .GLB)'
                                )}
                            </h4>
                        </div>
                        {surfaceSummary && (
                            <button
                                type="button"
                                onClick={handleClearSurface}
                                title={t('geolapp.adapters.clear_surface', 'Limpiar superficie cargada')}
                                aria-label={t('geolapp.adapters.clear_surface', 'Limpiar superficie cargada')}
                                className={FLAT_ICON_BTN_CLASS}
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-fib-13">
                        <input
                            ref={surfaceInputRef}
                            id={surfaceFileInputId}
                            type="file"
                            accept=".las,.xyz,.csv,.pts,.ply,.glb"
                            autoComplete="off"
                            spellCheck={false}
                            onChange={handleSurfaceFileChange}
                            className="sr-only"
                        />
                        <label
                            htmlFor={surfaceFileInputId}
                            className="px-fib-13 py-fib-8 bg-[#C68346] hover:bg-[#B0743E] text-[#FFFFFF] text-microcopy font-mono uppercase cursor-pointer rounded-none shadow-none transition-colors"
                        >
                            {t('geolapp.adapters.select_surface_file', 'CARGAR ARCHIVO 3D')}
                        </label>
                        <span className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] truncate">
                            {surfaceFilename || PENDING_RECORD}
                        </span>
                    </div>

                    {surfaceBusy && (
                        <M3LinearProgress
                            indeterminate
                            ariaLabel={t('geolapp.adapters.processing_surface', 'PROCESANDO NUBE 3D')}
                        />
                    )}

                    {surfaceError && (
                        <p
                            role="alert"
                            className="p-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] text-data-dense font-mono text-[#C68346] rounded-none"
                        >
                            {surfaceError}
                        </p>
                    )}

                    {surfaceSummary ? (
                        <div className="grid grid-cols-2 gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.source_format', 'ORIGEN / FORMATO')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {surfaceSummary.sourceKind} · {surfaceSummary.format}
                                </span>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.point_count', 'PUNTOS ORIGINALES')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {surfaceSummary.pointCount.toLocaleString('en-US')}
                                    {surfaceSummary.decimatedPointCount < surfaceSummary.pointCount
                                        ? ` (${surfaceSummary.decimatedPointCount.toLocaleString('en-US')} TIN)`
                                        : ''}
                                </span>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.tin_volume', 'VOLUMEN TIN')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums font-bold text-[#C68346]">
                                    {surfaceSummary.tinVolumeM3.toFixed(3)} m³
                                </span>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.surface_area', 'ÁREA SUPERFICIAL')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {surfaceSummary.surfaceAreaM2.toFixed(3)} m²
                                </span>
                            </div>

                            <div className="col-span-2 flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.bounds_dimensions', 'DIMENSIONES (X × Z × ΔZ)')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {surfaceSummary.boundsM.widthX.toFixed(2)} ×{' '}
                                    {surfaceSummary.boundsM.depthZ.toFixed(2)} ×{' '}
                                    {surfaceSummary.boundsM.reliefY.toFixed(2)} m (Z:{' '}
                                    {surfaceSummary.boundsM.minElevationM.toFixed(2)} ..{' '}
                                    {surfaceSummary.boundsM.maxElevationM.toFixed(2)} m)
                                </span>
                            </div>

                            <div className="col-span-2 flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.cas_footprint', 'TRAZABILIDAD CAS .GLB')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#00AEEF] break-all">
                                    {casFootprintLabel}
                                </span>
                                {surfaceSummary.casSha256 && (
                                    <div className="flex items-center gap-fib-8 min-w-0">
                                        <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text truncate">
                                            SHA-256: {surfaceSummary.casSha256}
                                        </span>
                                        <CopyButton value={surfaceSummary.casSha256} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {PENDING_RECORD}
                            </span>
                        </div>
                    )}
                </article>

                {/* BLOQUE B: RECEPTOR GNSS RTK NMEA-0183 ($GNGGA / $GPGGA / $GPRMC) */}
                <article
                    className={`flex flex-col bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none ${cardPadClass}`}
                >
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="flex flex-col gap-fib-8 min-w-0">
                            <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                {t('geolapp.adapters.gnss_tag', 'GNSS RTK · NMEA-0183')}
                            </span>
                            <h4 className="text-body-main font-semibold truncate">
                                {t(
                                    'geolapp.adapters.gnss_title',
                                    'PROYECCIÓN SIRGAS-CHILE / WGS84 UTM'
                                )}
                            </h4>
                        </div>
                        {(nmeaRawText || activeFix) && (
                            <button
                                type="button"
                                onClick={handleClearNmea}
                                title={t('geolapp.adapters.clear_nmea', 'Limpiar tramas NMEA')}
                                aria-label={t('geolapp.adapters.clear_nmea', 'Limpiar tramas NMEA')}
                                className={FLAT_ICON_BTN_CLASS}
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        )}
                    </div>

                    <textarea
                        value={nmeaRawText}
                        onChange={(e) => setNmeaRawText(e.target.value)}
                        rows={compact ? 3 : 4}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={t(
                            'geolapp.adapters.nmea_textarea_aria',
                            'Tramas NMEA-0183 ($GNGGA / $GPGGA / $GPRMC)'
                        )}
                        placeholder={t(
                            'geolapp.adapters.nmea_placeholder',
                            '$GNGGA,123519.00,2218.5400,S,06854.1200,W,4,14,0.6,2845.40,M,29.1,M,1.0,0000*XX'
                        )}
                        className="w-full p-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none resize-y select-text"
                    />

                    <div className="flex flex-wrap items-center gap-fib-8">
                        <button
                            type="button"
                            onClick={() => processNmeaText(nmeaRawText)}
                            disabled={nmeaBusy}
                            className="px-fib-13 py-fib-8 bg-[#00AEEF] hover:bg-[#0095CC] text-[#FFFFFF] text-microcopy font-mono uppercase cursor-pointer rounded-none shadow-none transition-colors disabled:opacity-50"
                        >
                            {t('geolapp.adapters.parse_nmea', 'VALIDAR NMEA')}
                        </button>

                        <input
                            ref={nmeaFileInputRef}
                            id={nmeaFileInputId}
                            type="file"
                            accept=".nmea,.txt,.log"
                            autoComplete="off"
                            spellCheck={false}
                            onChange={handleNmeaFileChange}
                            className="sr-only"
                        />
                        <label
                            htmlFor={nmeaFileInputId}
                            className="px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] text-microcopy font-mono uppercase cursor-pointer rounded-none shadow-none transition-colors"
                        >
                            {t('geolapp.adapters.load_nmea_file', 'CARGAR .NMEA')}
                        </label>

                        {webSerialAvailable && (
                            <button
                                type="button"
                                onClick={handleWebSerialCapture}
                                disabled={nmeaBusy}
                                className="px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] hover:bg-[#C68346] hover:text-[#FFFFFF] text-[#C68346] text-microcopy font-mono uppercase cursor-pointer rounded-none shadow-none transition-colors disabled:opacity-50"
                            >
                                {t('geolapp.adapters.connect_webserial', 'PUERTO SERIAL RTK')}
                            </button>
                        )}
                    </div>

                    {nmeaBusy && (
                        <M3LinearProgress
                            indeterminate
                            ariaLabel={t('geolapp.adapters.reading_gnss', 'LEYENDO RECEPTOR GNSS')}
                        />
                    )}

                    {nmeaError && (
                        <p
                            role="alert"
                            className="p-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] text-data-dense font-mono text-[#C68346] rounded-none"
                        >
                            {nmeaError}
                        </p>
                    )}

                    {activeFix ? (
                        <div className="grid grid-cols-2 gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.fix_quality', 'CALIDAD FIX GNSS')}
                                </span>
                                <span
                                    className={`text-data-dense font-mono tabular-nums font-bold ${
                                        activeFix.fixQuality === 'RTK_FIXED'
                                            ? 'text-[#00AEEF]'
                                            : 'text-[#C68346]'
                                    }`}
                                >
                                    {activeFix.fixQuality} ({activeFix.fixQualityCode}) ·{' '}
                                    {activeFix.sentenceType}
                                </span>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.epsg_datum', 'DATUM / EPSG')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    EPSG:{activeFix.epsg} · {activeFix.datum}
                                </span>
                            </div>

                            <div className="col-span-2 flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.utm_coords', 'COORDENADAS UTM')}
                                </span>
                                <div className="flex items-center gap-fib-8 min-w-0">
                                    <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text truncate">
                                        {utmFormatted}
                                    </span>
                                    <CopyButton value={utmFormatted} />
                                </div>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.orthometric_alt', 'COTA ORTOMÉTRICA')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {activeFix.orthometricAltitudeM !== null
                                        ? `${activeFix.orthometricAltitudeM.toFixed(2)} m`
                                        : UNDECLARED_VALUE}
                                </span>
                            </div>

                            <div className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geolapp.adapters.sat_hdop', 'SV / HDOP')}
                                </span>
                                <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {activeFix.satellitesUsed > 0
                                        ? `${activeFix.satellitesUsed} SV`
                                        : UNDECLARED_VALUE}{' '}
                                    ·{' '}
                                    {activeFix.hdop !== null
                                        ? `HDOP ${activeFix.hdop.toFixed(2)}`
                                        : UNDECLARED_VALUE}
                                </span>
                            </div>

                            <div className="col-span-2 flex items-center justify-between gap-fib-13 text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                <span>
                                    WGS84: {activeFix.latitude.toFixed(6)},{' '}
                                    {activeFix.longitude.toFixed(6)}
                                </span>
                                <span>
                                    OK: {nmeaStats.validCount} · REJ: {nmeaStats.rejectedCount}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {PENDING_RECORD}
                            </span>
                        </div>
                    )}
                </article>
            </div>
        </section>
    );
};

export default ExternalSensorsPanel;
