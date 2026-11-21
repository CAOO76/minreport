import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../../../../components/common/CopyButton';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../../components/common/HitlConfirmModal';
import { M3LinearProgress } from '../../../../components/common/M3LinearProgress';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import { useMinReportSession } from '../../../../context/MinReportSessionContext';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';

export type SpatialDeviceTier = 'OPTIMAL_SPATIAL' | 'COMPATIBLE_VIO' | 'INCOMPATIBLE';

export interface SpatialDeviceEntry {
    id: string;
    manufacturer: string;
    model: string;
    deviceCode?: string;
    platform: 'ANDROID' | 'IOS';
    arSupported: boolean;
    depthSupported: boolean;
    lidarSupported: boolean;
    rugged: boolean;
    ruggedRating?: string;
    tier: SpatialDeviceTier;
    notes?: string;
}

export interface SpatialDeviceCatalog {
    updatedAt: number;
    updatedAtIso: string;
    source: string;
    sourceUrl: string;
    sourceHash: string;
    totalCount: number;
    optimalCount: number;
    vioCount: number;
    ruggedCount: number;
    devices: SpatialDeviceEntry[];
}

type TierFilter = 'ALL' | 'OPTIMAL_SPATIAL' | 'COMPATIBLE_VIO' | 'RUGGED' | 'INCOMPATIBLE';
type PlatformFilter = 'ALL' | 'ANDROID' | 'IOS';

type PendingHitlAction =
    | { type: 'SYNC' }
    | { type: 'CSV'; fileName: string; csvText: string; rowEstimate: number };

const MAX_CSV_BYTES = 5_000_000;

export const DesktopDeviceCompatibilityView: React.FC = () => {
    const { t } = useTranslation();
    const { session } = useMinReportSession();
    const canManageCatalog = Boolean(session?.isDevRoot || session?.isSuperAdmin);

    const csvInputRef = useRef<HTMLInputElement>(null);

    const [catalog, setCatalog] = useState<SpatialDeviceCatalog | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [busyAction, setBusyAction] = useState<'SYNC' | 'CSV' | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [statusBanner, setStatusBanner] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(
        null
    );

    const [searchQuery, setSearchQuery] = useState<string>('');
    const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
    const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('ALL');
    const [pendingHitl, setPendingHitl] = useState<PendingHitlAction | null>(null);

    const loadCatalog = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        try {
            const resp = await coreAuthFetch('/api/geolapp/device-catalog', {
                method: 'GET',
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data?.catalog) {
                throw new Error(
                    data?.error || t('compatibility.load_error', 'Error al cargar catálogo hardware.')
                );
            }
            setCatalog(data.catalog as SpatialDeviceCatalog);
        } catch (err: any) {
            setErrorMsg(
                err?.message || t('compatibility.load_error', 'Error al cargar catálogo hardware.')
            );
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadCatalog();
    }, [loadCatalog]);

    const filterCounts = useMemo(() => {
        const list = catalog?.devices ?? [];
        let optimal = 0;
        let vio = 0;
        let rugged = 0;
        let incompatible = 0;
        for (const item of list) {
            if (item.tier === 'OPTIMAL_SPATIAL') optimal += 1;
            else if (item.tier === 'COMPATIBLE_VIO') vio += 1;
            else if (item.tier === 'INCOMPATIBLE') incompatible += 1;
            if (item.rugged) rugged += 1;
        }
        return {
            total: list.length,
            optimal,
            vio,
            rugged,
            incompatible,
        };
    }, [catalog]);

    const filteredDevices = useMemo(() => {
        const list = catalog?.devices ?? [];
        const q = searchQuery.trim().toLowerCase();

        return list.filter((item) => {
            if (platformFilter !== 'ALL' && item.platform !== platformFilter) {
                return false;
            }
            if (tierFilter === 'OPTIMAL_SPATIAL' && item.tier !== 'OPTIMAL_SPATIAL') {
                return false;
            }
            if (tierFilter === 'COMPATIBLE_VIO' && item.tier !== 'COMPATIBLE_VIO') {
                return false;
            }
            if (tierFilter === 'INCOMPATIBLE' && item.tier !== 'INCOMPATIBLE') {
                return false;
            }
            if (tierFilter === 'RUGGED' && !item.rugged) {
                return false;
            }
            if (!q) {
                return true;
            }
            return (
                item.manufacturer.toLowerCase().includes(q) ||
                item.model.toLowerCase().includes(q) ||
                (item.deviceCode || '').toLowerCase().includes(q) ||
                (item.ruggedRating || '').toLowerCase().includes(q) ||
                (item.notes || '').toLowerCase().includes(q)
            );
        });
    }, [catalog, searchQuery, tierFilter, platformFilter]);

    const handleCsvFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setErrorMsg(null);
        setStatusBanner(null);

        if (file.size > MAX_CSV_BYTES) {
            setErrorMsg(t('compatibility.csv_invalid_error', 'Archivo CSV inválido o insuficiente.'));
            return;
        }

        try {
            const csvText = await file.text();
            if (csvText.trim().length < 20) {
                setErrorMsg(
                    t('compatibility.csv_invalid_error', 'Archivo CSV inválido o insuficiente.')
                );
                return;
            }
            const nonEmptyLines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
            const rowEstimate = Math.max(0, nonEmptyLines.length - 1);
            setPendingHitl({
                type: 'CSV',
                fileName: file.name,
                csvText,
                rowEstimate,
            });
        } catch {
            setErrorMsg(t('compatibility.csv_invalid_error', 'Archivo CSV inválido o insuficiente.'));
        }
    };

    const executePendingHitl = async () => {
        if (!pendingHitl || busyAction !== null) return;

        const actionType = pendingHitl.type;
        setBusyAction(actionType);
        setErrorMsg(null);
        setStatusBanner(null);

        try {
            if (actionType === 'SYNC') {
                const resp = await coreAuthFetch('/api/geolapp/device-catalog/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirmationKeyword: 'ACTUALIZAR' }),
                });
                const data = await resp.json().catch(() => null);
                if (!resp.ok || !data?.success) {
                    throw new Error(
                        data?.error ||
                            t('compatibility.sync_error', 'Error al actualizar catálogo hardware.')
                    );
                }
                if (data.catalog) {
                    setCatalog(data.catalog as SpatialDeviceCatalog);
                }
                if (data.fallbackUsed) {
                    setStatusBanner({
                        kind: 'warn',
                        text:
                            data.warning ||
                            t(
                                'compatibility.sync_fallback_notice',
                                'Fuente remota no disponible; catálogo base conservado.'
                            ),
                    });
                } else {
                    setStatusBanner({
                        kind: 'ok',
                        text: t('compatibility.sync_success', 'Catálogo hardware actualizado.'),
                    });
                }
            } else {
                const resp = await coreAuthFetch('/api/geolapp/device-catalog/import-csv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        csvText: pendingHitl.csvText,
                        confirmationKeyword: 'ACTUALIZAR',
                    }),
                });
                const data = await resp.json().catch(() => null);
                if (!resp.ok || !data?.success) {
                    throw new Error(
                        data?.error ||
                            t('compatibility.sync_error', 'Error al actualizar catálogo hardware.')
                    );
                }
                if (data.catalog) {
                    setCatalog(data.catalog as SpatialDeviceCatalog);
                }
                setStatusBanner({
                    kind: 'ok',
                    text: t('compatibility.sync_success', 'Catálogo hardware actualizado.'),
                });
            }
            setPendingHitl(null);
        } catch (err: any) {
            setErrorMsg(
                err?.message ||
                    t('compatibility.sync_error', 'Error al actualizar catálogo hardware.')
            );
            setPendingHitl(null);
        } finally {
            setBusyAction(null);
        }
    };

    const hitlComparisonDiff: HitlComparisonDiffItem[] = useMemo(() => {
        if (!pendingHitl) return [];
        if (pendingHitl.type === 'SYNC') {
            return [
                {
                    field: t('compatibility.last_sync_label', 'ÚLTIMA SINCRONIZACIÓN UTC'),
                    current: catalog?.updatedAtIso || '--',
                    suggested: 'ARCORE / DEPTH / LIDAR',
                },
                {
                    field: t('compatibility.kpi_total', 'TOTAL DISPOSITIVOS'),
                    current: String(catalog?.totalCount ?? 0),
                    suggested: catalog?.source || 'GOOGLE_ARCORE_HTML',
                },
            ];
        }
        return [
            {
                field: t('compatibility.csv_file_label', 'ARCHIVO CSV'),
                current: catalog?.source || '--',
                suggested: pendingHitl.fileName,
            },
            {
                field: t('compatibility.kpi_total', 'TOTAL DISPOSITIVOS'),
                current: String(catalog?.totalCount ?? 0),
                suggested: `+${pendingHitl.rowEstimate}`,
            },
        ];
    }, [pendingHitl, catalog, t]);

    const isWorking = loading || busyAction !== null;
    const shortHash = catalog?.sourceHash ? catalog.sourceHash.slice(0, 12) : '--';

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none select-none">
            {isWorking && (
                <div className="shrink-0">
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('compatibility.progress_aria', 'Sincronizando catálogo hardware')}
                    />
                </div>
            )}

            {/* Cabecera Técnica + Metadata + Acciones HITL DEV/ADMIN */}
            <div className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex flex-wrap items-baseline gap-fib-13 min-w-0">
                    <h1 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('compatibility.desktop_title', 'COMPATIBILIDAD HARDWARE')}
                    </h1>
                    {catalog?.source && (
                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('compatibility.source_label', 'FUENTE')}:{' '}
                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">{catalog.source}</span>
                        </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-fib-21">
                    <div className="flex flex-wrap items-center gap-fib-13 font-mono text-microcopy tabular-nums">
                        <span className="text-[#475569] dark:text-[#8A93A6] uppercase">
                            {t('compatibility.last_sync_label', 'ÚLTIMA SINCRONIZACIÓN UTC')}:{' '}
                            <span className="text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                {catalog?.updatedAtIso || '--'}
                            </span>
                        </span>

                        <span className="inline-flex items-center gap-1 text-[#475569] dark:text-[#8A93A6] uppercase">
                            {t('compatibility.source_hash_label', 'SHA-256')}:{' '}
                            <span className="text-[#00AEEF] font-bold select-text">{shortHash}</span>
                            {catalog?.sourceHash && <CopyButton value={catalog.sourceHash} />}
                        </span>
                    </div>

                    {canManageCatalog && (
                        <div className="flex items-center gap-fib-13 shrink-0">
                            <input
                                ref={csvInputRef}
                                type="file"
                                accept=".csv,text/csv"
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(e) => void handleCsvFileSelected(e)}
                                className="hidden"
                            />
                            <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => setPendingHitl({ type: 'SYNC' })}
                                aria-label={t('compatibility.sync_btn', 'ACTUALIZAR')}
                                title={t('compatibility.sync_btn', 'ACTUALIZAR')}
                                className="h-9 px-fib-8 bg-transparent border-0 outline-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5 font-mono text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] dark:hover:text-[#C68346] rounded-none transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">sync</span>
                                <span>{t('compatibility.sync_btn', 'ACTUALIZAR')}</span>
                            </button>
                            <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => csvInputRef.current?.click()}
                                aria-label={t('compatibility.csv_btn', 'CSV')}
                                title={t('compatibility.csv_btn', 'CSV')}
                                className="h-9 px-fib-8 bg-transparent border-0 outline-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5 font-mono text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] dark:hover:text-[#C68346] rounded-none transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    upload_file
                                </span>
                                <span>{t('compatibility.csv_btn', 'CSV')}</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Franja KPI Tabular Compacta */}
            <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                <div className="px-fib-21 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('compatibility.kpi_total', 'TOTAL DISPOSITIVOS')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                        {(catalog?.totalCount ?? 0).toLocaleString()}
                    </span>
                </div>
                <div className="px-fib-21 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('compatibility.kpi_optimal', 'ÓPTIMO ESPACIAL')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#00AEEF]">
                        {(catalog?.optimalCount ?? 0).toLocaleString()}
                    </span>
                </div>
                <div className="px-fib-21 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('compatibility.kpi_vio', 'VIO COMPATIBLE')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                        {(catalog?.vioCount ?? 0).toLocaleString()}
                    </span>
                </div>
                <div className="px-fib-21 py-fib-13">
                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('compatibility.kpi_rugged', 'RUGGED FAENA')}
                    </span>
                    <span className="text-h1-header font-mono font-bold tabular-nums text-[#C68346]">
                        {(catalog?.ruggedCount ?? 0).toLocaleString()}
                    </span>
                </div>
            </div>

            {/* Avisos operativos / error */}
            {(errorMsg || statusBanner) && (
                <div
                    role="status"
                    className={`shrink-0 px-fib-21 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-13 font-mono text-data-dense ${
                        errorMsg || statusBanner?.kind === 'warn'
                            ? 'border-l-[#C68346] text-[#C68346]'
                            : 'border-l-[#00AEEF] text-[#00AEEF]'
                    }`}
                >
                    <span className="truncate">{errorMsg || statusBanner?.text}</span>
                    <button
                        type="button"
                        onClick={() => {
                            setErrorMsg(null);
                            setStatusBanner(null);
                        }}
                        aria-label={t('common.close_alert', 'Cerrar aviso')}
                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shrink-0"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            )}

            {/* Barra de Filtros + Búsqueda Instantánea */}
            <div className="shrink-0 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex flex-wrap items-center gap-fib-21">
                    {(
                        [
                            {
                                id: 'ALL' as const,
                                label: t('compatibility.filter_all', 'TODOS'),
                                count: filterCounts.total,
                            },
                            {
                                id: 'OPTIMAL_SPATIAL' as const,
                                label: t('compatibility.filter_optimal', 'ÓPTIMO'),
                                count: filterCounts.optimal,
                            },
                            {
                                id: 'COMPATIBLE_VIO' as const,
                                label: t('compatibility.filter_vio', 'VIO'),
                                count: filterCounts.vio,
                            },
                            {
                                id: 'RUGGED' as const,
                                label: t('compatibility.filter_rugged', 'RUGGED'),
                                count: filterCounts.rugged,
                            },
                            {
                                id: 'INCOMPATIBLE' as const,
                                label: t('compatibility.filter_incompatible', 'INCOMPATIBLE'),
                                count: filterCounts.incompatible,
                            },
                        ]
                    ).map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setTierFilter(tab.id)}
                            className={`py-fib-13 text-microcopy font-mono font-bold uppercase border-0 border-b-2 bg-transparent cursor-pointer rounded-none transition-colors tabular-nums ${
                                tierFilter === tab.id
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>

                <div className="py-fib-8 flex flex-wrap items-center gap-fib-13">
                    <div className="flex items-center gap-fib-13 pr-fib-8 border-r border-[#E2E8F0] dark:border-[#12151C]">
                        {(
                            [
                                {
                                    id: 'ALL' as const,
                                    label: t('compatibility.platform_all', 'TODAS'),
                                },
                                {
                                    id: 'ANDROID' as const,
                                    label: t('compatibility.platform_android', 'ANDROID'),
                                },
                                {
                                    id: 'IOS' as const,
                                    label: t('compatibility.platform_ios', 'IOS'),
                                },
                            ]
                        ).map((plat) => (
                            <button
                                key={plat.id}
                                type="button"
                                onClick={() => setPlatformFilter(plat.id)}
                                className={`py-1 bg-transparent border-0 border-b-2 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none transition-colors ${
                                    platformFilter === plat.id
                                        ? 'border-[#00AEEF] text-[#00AEEF]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                {plat.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative flex items-center">
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t(
                                'compatibility.search_placeholder',
                                'BUSCAR MARCA, MODELO O CÓDIGO'
                            )}
                            aria-label={t(
                                'compatibility.search_placeholder',
                                'BUSCAR MARCA, MODELO O CÓDIGO'
                            )}
                            className="h-9 w-72 px-fib-8 pr-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label={t('compatibility.clear_search', 'Limpiar búsqueda')}
                                className="absolute right-1 bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none flex items-center justify-center"
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        )}
                    </div>

                    <span className="text-microcopy font-mono font-bold uppercase tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {filteredDevices.length} {t('compatibility.filtered_count_label', 'REGISTROS')}
                    </span>
                </div>
            </div>

            {/* Tabla Técnica Densa */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {!loading && filteredDevices.length === 0 ? (
                    <div className="h-full flex items-center justify-center p-fib-55">
                        <div className="text-center space-y-fib-13 max-w-md">
                            <span className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]">
                                devices
                            </span>
                            <p className="text-body-main font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                {t(
                                    'compatibility.empty_results',
                                    'Sin dispositivos para el filtro actual.'
                                )}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-data-dense tabular-nums border-collapse">
                            <thead className="sticky top-0 z-10">
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <th className="px-fib-21 py-fib-13">
                                        {t('compatibility.col_manufacturer', 'FABRICANTE')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13">
                                        {t('compatibility.col_model', 'MODELO / OEM')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13">
                                        {t('compatibility.col_platform', 'PLATAFORMA')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-center">
                                        {t('compatibility.col_vio', 'AR / VIO')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-center">
                                        {t('compatibility.col_depth', 'DEPTH / LiDAR')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13">
                                        {t('compatibility.col_rugged', 'RUGGED')}
                                    </th>
                                    <th className="px-fib-21 py-fib-13 text-right">
                                        {t('compatibility.col_tier', 'NIVEL')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {filteredDevices.map((device) => {
                                    const isOptimal = device.tier === 'OPTIMAL_SPATIAL';
                                    const isIncompatible = device.tier === 'INCOMPATIBLE';
                                    const rowAccentBorder = isOptimal
                                        ? 'border-l-[3px] border-l-[#00AEEF]'
                                        : isIncompatible
                                          ? 'border-l-[3px] border-l-[#C68346]'
                                          : 'border-l-[3px] border-l-transparent';
                                    const tierLabel = isOptimal
                                        ? t('compatibility.tier_optimal', 'ÓPTIMO ESPACIAL')
                                        : isIncompatible
                                          ? t('compatibility.tier_incompatible', 'INCOMPATIBLE')
                                          : t('compatibility.tier_vio', 'COMPATIBLE VIO');
                                    const tierColorClass = isOptimal
                                        ? 'text-[#00AEEF]'
                                        : isIncompatible
                                          ? 'text-[#C68346]'
                                          : 'text-[#475569] dark:text-[#8A93A6]';

                                    const depthCellText = device.lidarSupported
                                        ? t('compatibility.lidar_label', 'LiDAR')
                                        : device.depthSupported
                                          ? t('compatibility.depth_api_label', 'DEPTH API')
                                          : t('compatibility.no_label', 'NO');

                                    return (
                                        <tr
                                            key={device.id}
                                            className="hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors"
                                        >
                                            <td
                                                className={`px-fib-21 py-fib-13 font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] ${rowAccentBorder}`}
                                            >
                                                {device.manufacturer}
                                            </td>
                                            <td className="px-fib-13 py-fib-13">
                                                <div className="flex flex-wrap items-baseline gap-fib-8">
                                                    <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                        {device.model}
                                                    </span>
                                                    {device.deviceCode && (
                                                        <span className="text-microcopy font-bold uppercase select-text text-[#C68346]">
                                                            {device.deviceCode}
                                                        </span>
                                                    )}
                                                </div>
                                                {device.notes && (
                                                    <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                        {device.notes}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {device.platform}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-center uppercase">
                                                <span
                                                    className={
                                                        device.arSupported
                                                            ? 'font-bold text-[#0F172A] dark:text-[#F3F4F6]'
                                                            : 'text-[#C68346] font-bold'
                                                    }
                                                >
                                                    {device.arSupported
                                                        ? t('compatibility.yes_label', 'SÍ')
                                                        : t('compatibility.no_label', 'NO')}
                                                </span>
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-center uppercase">
                                                <span
                                                    className={
                                                        device.lidarSupported || device.depthSupported
                                                            ? 'font-bold text-[#00AEEF]'
                                                            : 'text-[#94A3B8] dark:text-[#5A6072]'
                                                    }
                                                >
                                                    {depthCellText}
                                                </span>
                                            </td>
                                            <td className="px-fib-13 py-fib-13 uppercase">
                                                {device.rugged ? (
                                                    <span className="font-bold text-[#C68346]">
                                                        {device.ruggedRating ||
                                                            t('compatibility.yes_label', 'SÍ')}
                                                    </span>
                                                ) : (
                                                    <span
                                                        className="text-[#94A3B8] dark:text-[#5A6072]"
                                                        title={t(
                                                            'core_common.undeclared_tech_value',
                                                            UNDECLARED_TECH_VALUE
                                                        )}
                                                    >
                                                        --
                                                    </span>
                                                )}
                                            </td>
                                            <td
                                                className={`px-fib-21 py-fib-13 text-right text-microcopy font-bold uppercase ${tierColorClass}`}
                                            >
                                                {tierLabel}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <HitlConfirmModal
                open={Boolean(pendingHitl)}
                title={
                    pendingHitl?.type === 'CSV'
                        ? t(
                              'compatibility.csv_hitl_title',
                              'IMPORTAR CATÁLOGO CSV GOOGLE PLAY (HITL)'
                          )
                        : t(
                              'compatibility.sync_hitl_title',
                              'SINCRONIZAR CATÁLOGO HARDWARE (HITL)'
                          )
                }
                description={
                    pendingHitl?.type === 'CSV'
                        ? t(
                              'compatibility.csv_hitl_desc',
                              'Fusiona dispositivos del archivo CSV de Google Play Console en Firestore. Escriba ACTUALIZAR para confirmar.'
                          )
                        : t(
                              'compatibility.sync_hitl_desc',
                              'Descarga lista oficial ARCore/Depth y fusiona matriz Apple LiDAR + Rugged. Escriba ACTUALIZAR para confirmar.'
                          )
                }
                keyword="ACTUALIZAR"
                comparisonDiff={hitlComparisonDiff}
                loading={busyAction !== null}
                onConfirm={() => void executePendingHitl()}
                onCancel={() => {
                    if (busyAction === null) {
                        setPendingHitl(null);
                    }
                }}
            />
        </div>
    );
};

export default DesktopDeviceCompatibilityView;
