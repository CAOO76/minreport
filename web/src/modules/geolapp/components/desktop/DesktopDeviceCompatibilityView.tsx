import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../../../../components/common/CopyButton';
import { M3LinearProgress } from '../../../../components/common/M3LinearProgress';
import { UNDECLARED_TECH_VALUE } from '../../../../components/common/ReportBlockEditable';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';

export type SpatialDeviceTier =
    | 'OPTIMAL_SPATIAL'
    | 'COMPATIBLE_VIO'
    | 'INCOMPATIBLE'
    | 'UNVERIFIED';

export interface DeviceGroundingSource {
    title: string;
    uri: string;
}

export interface DeviceCompatibilityRecord {
    id: string;
    canonicalKey: string;
    manufacturer: string;
    model: string;
    deviceCode?: string;
    aliases: string[];
    platform: 'ANDROID' | 'IOS';
    hasGyroscope: boolean | null;
    arSupported: boolean | null;
    depthSupported: boolean | null;
    lidarSupported: boolean | null;
    rugged: boolean;
    ruggedRating?: string;
    tier: SpatialDeviceTier;
    verdictSummary: string;
    groundingSources: DeviceGroundingSource[];
    source: 'AI_GROUNDED_VERIFIED';
    queryCount: number;
    createdAt: number;
    checkedAt: number;
    lastQueriedAt: number;
    checkedAtIso: string;
}

export interface DeviceCompatibilityRegistrySnapshot {
    updatedAt: number;
    updatedAtIso: string;
    totalCount: number;
    optimalCount: number;
    vioCount: number;
    incompatibleCount: number;
    unverifiedCount: number;
    devices: DeviceCompatibilityRecord[];
}

function formatUtcShort(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return UNDECLARED_TECH_VALUE;
    try {
        return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
    } catch {
        return UNDECLARED_TECH_VALUE;
    }
}

function tierColorClass(tier: SpatialDeviceTier): string {
    if (tier === 'OPTIMAL_SPATIAL') return 'text-[#00AEEF]';
    if (tier === 'INCOMPATIBLE') return 'text-[#C68346]';
    if (tier === 'COMPATIBLE_VIO') return 'text-[#0F172A] dark:text-[#F3F4F6]';
    return 'text-[#5A6072] dark:text-[#94A3B8]';
}

function formatBoolCap(val: boolean | null, trueLabel: string, falseLabel: string): string {
    if (val === true) return trueLabel;
    if (val === false) return falseLabel;
    return UNDECLARED_TECH_VALUE;
}

export const DesktopDeviceCompatibilityView: React.FC = () => {
    const { t } = useTranslation();

    const [registry, setRegistry] = useState<DeviceCompatibilityRegistrySnapshot | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [checking, setChecking] = useState<boolean>(false);
    const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
    const [modelInput, setModelInput] = useState<string>('');
    const [tableFilter, setTableFilter] = useState<string>('');
    const [activeVerdict, setActiveVerdict] = useState<{
        device: DeviceCompatibilityRecord;
        cached: boolean;
    } | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const loadRegistry = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        try {
            const res = await coreAuthFetch('/api/geolapp/device-compatibility', {
                method: 'GET',
            });
            const data = (await res.json().catch(() => ({}))) as {
                registry?: DeviceCompatibilityRegistrySnapshot;
                catalog?: DeviceCompatibilityRegistrySnapshot;
                error?: string;
            };
            if (!res.ok) {
                throw new Error(
                    data?.error ||
                    t('compatibility.load_error', 'Error consultando registro de equipos.')
                );
            }
            const nextRegistry = data.registry || data.catalog || null;
            setRegistry(nextRegistry);
        } catch (err: unknown) {
            setErrorMsg(
                err instanceof Error
                    ? err.message
                    : t('compatibility.load_error', 'Error consultando registro de equipos.')
            );
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadRegistry();
    }, [loadRegistry]);

    const runCheck = async (query: string, forceRefresh = false) => {
        const clean = query.trim();
        if (clean.length < 2 || checking) return;
        setChecking(true);
        if (forceRefresh) setRefreshingKey(clean);
        setErrorMsg(null);
        try {
            const res = await coreAuthFetch('/api/geolapp/device-compatibility/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: clean, forceRefresh }),
            });
            const rawBody = await res.text().catch(() => '');
            let data: {
                device?: DeviceCompatibilityRecord;
                cached?: boolean;
                registry?: DeviceCompatibilityRegistrySnapshot;
                error?: string;
                code?: string;
            } = {};
            if (rawBody) {
                try {
                    data = JSON.parse(rawBody);
                } catch {
                    data = {};
                }
            }
            if (!res.ok) {
                if (data?.error) {
                    const codeSuffix =
                        data.code && !data.error.includes(data.code) ? ` [${data.code}]` : '';
                    throw new Error(`${data.error}${codeSuffix}`);
                }
                if (res.status === 504 || res.status === 524) {
                    throw new Error(
                        t(
                            'compatibility.check_timeout_error',
                            'Tiempo de espera agotado al consultar evidencia web (HTTP 504). Reintente.'
                        )
                    );
                }
                const baseMsg = t(
                    'compatibility.check_error',
                    'No se pudo verificar compatibilidad con evidencia web.'
                );
                throw new Error(`${baseMsg} (HTTP ${res.status})`);
            }
            if (data.device) {
                setActiveVerdict({ device: data.device, cached: Boolean(data.cached) });
            }
            if (data.registry) {
                setRegistry(data.registry);
            } else {
                await loadRegistry();
            }
        } catch (err: unknown) {
            setErrorMsg(
                err instanceof Error
                    ? err.message
                    : t(
                        'compatibility.check_error',
                        'No se pudo verificar compatibilidad con evidencia web.'
                    )
            );
        } finally {
            setChecking(false);
            setRefreshingKey(null);
        }
    };

    const handleSubmitCheck = (e: React.FormEvent) => {
        e.preventDefault();
        void runCheck(modelInput, false);
    };

    const filteredDevices = useMemo(() => {
        const list = registry?.devices || [];
        const q = tableFilter.trim().toLowerCase();
        if (!q) return list;
        return list.filter((d) =>
            [
                d.manufacturer,
                d.model,
                d.deviceCode || '',
                d.canonicalKey,
                d.tier,
                ...d.aliases,
            ]
                .join(' ')
                .toLowerCase()
                .includes(q)
        );
    }, [registry, tableFilter]);

    return (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-fib-34 space-y-fib-21 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] select-none rounded-none shadow-none">
            {/* Cabecera On-Demand */}
            <div className="flex flex-wrap items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-fib-13">
                    <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[24px] text-[#00AEEF]"
                    >
                        devices
                    </span>
                    <h2 className="text-h1-header font-semibold uppercase tracking-tight">
                        {t('compatibility.ondemand_title', 'MOTOR ON-DEMAND COMPATIBILIDAD MÓVIL')}
                    </h2>
                </div>

                <div className="flex items-center gap-fib-21 font-mono tabular-nums text-microcopy uppercase">
                    <span className="text-[#475569] dark:text-[#8A93A6]">
                        {t('compatibility.registered_count', 'REGISTRADOS')}:{' '}
                        <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                            {registry?.totalCount ?? 0}
                        </strong>
                    </span>
                    <span className="text-[#00AEEF]">
                        OPTIMAL: <strong>{registry?.optimalCount ?? 0}</strong>
                    </span>
                    <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                        VIO: <strong>{registry?.vioCount ?? 0}</strong>
                    </span>
                    <span className="text-[#C68346]">
                        INCOMPATIBLE: <strong>{registry?.incompatibleCount ?? 0}</strong>
                    </span>
                </div>
            </div>

            {/* Formulario Único On-Demand */}
            <form
                autoComplete="off"
                spellCheck={false}
                onSubmit={handleSubmitCheck}
                className="flex flex-wrap items-center gap-fib-13 p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none"
            >
                <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    placeholder={t(
                        'compatibility.query_placeholder',
                        'INGRESE MARCA Y MODELO (EJ. SAMSUNG GALAXY A17 5G)'
                    )}
                    className="flex-1 min-w-[260px] h-11 px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none"
                />
                <button
                    type="submit"
                    disabled={checking || modelInput.trim().length < 2}
                    className="h-11 px-fib-21 bg-[#C68346] hover:bg-[#b5753b] disabled:opacity-40 text-white font-mono text-data-dense font-bold uppercase tracking-wider border-0 cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                >
                    {checking
                        ? t('compatibility.checking_btn', 'EVALUANDO IA...')
                        : t('compatibility.check_btn', 'COMPROBAR')}
                </button>
            </form>

            {(loading || checking) && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('compatibility.loading_aria', 'Verificando hardware móvil')}
                />
            )}

            {errorMsg && (
                <div
                    role="alert"
                    className="p-fib-13 border border-[#C68346] bg-[#FFFFFF] dark:bg-[#07090D] font-mono text-data-dense text-[#C68346] rounded-none"
                >
                    {errorMsg}
                </div>
            )}

            {/* Resultado de Consulta Activa */}
            {activeVerdict && (
                <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] space-y-fib-13 rounded-none shadow-none">
                    <div className="flex flex-wrap items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <div className="flex items-center gap-fib-13">
                            <span
                                className={`font-mono text-h2-section font-bold uppercase ${tierColorClass(
                                    activeVerdict.device.tier
                                )}`}
                            >
                                {activeVerdict.device.tier}
                            </span>
                            <span className="font-mono text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {activeVerdict.device.manufacturer} {activeVerdict.device.model}
                            </span>
                            {activeVerdict.device.deviceCode && (
                                <span className="font-mono text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                    ({activeVerdict.device.deviceCode})
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-fib-13 font-mono text-microcopy uppercase">
                            <span
                                className={
                                    activeVerdict.cached ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                }
                            >
                                {activeVerdict.cached
                                    ? t('compatibility.source_cache', 'CACHÉ BD (0 TOKENS)')
                                    : t('compatibility.source_live_ai', 'EVALUACIÓN IA GROUNDED')}
                            </span>
                            <CopyButton
                                value={activeVerdict.device.canonicalKey}
                                title={t('compatibility.copy_key', 'Copiar clave')}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-fib-13 font-mono tabular-nums text-data-dense">
                        <div>
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                PLATAFORMA
                            </div>
                            <div>{activeVerdict.device.platform}</div>
                        </div>
                        <div>
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                GIROSCOPIO HW
                            </div>
                            <div>
                                {formatBoolCap(activeVerdict.device.hasGyroscope, 'SÍ', 'NO')}
                            </div>
                        </div>
                        <div>
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                ARCORE / ARKIT
                            </div>
                            <div>
                                {formatBoolCap(activeVerdict.device.arSupported, 'SOPORTADO', 'NO')}
                            </div>
                        </div>
                        <div>
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                DEPTH / LIDAR
                            </div>
                            <div>
                                {activeVerdict.device.lidarSupported === true
                                    ? 'LIDAR'
                                    : formatBoolCap(
                                        activeVerdict.device.depthSupported,
                                        'DEPTH API',
                                        'NO'
                                    )}
                            </div>
                        </div>
                        <div>
                            <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                RUGERIZADO
                            </div>
                            <div>
                                {activeVerdict.device.rugged
                                    ? activeVerdict.device.ruggedRating || 'RUGGED'
                                    : 'ESTÁNDAR'}
                            </div>
                        </div>
                    </div>

                    <div className="font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        {activeVerdict.device.verdictSummary}
                    </div>

                    {activeVerdict.device.groundingSources.length > 0 && (
                        <div className="flex flex-wrap items-center gap-fib-13 pt-fib-8 text-microcopy font-mono">
                            <span className="uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('compatibility.sources_label', 'FUENTES VERIFICADAS')}:
                            </span>
                            {activeVerdict.device.groundingSources.map((src, idx) => (
                                <a
                                    key={`${src.uri}_${idx}`}
                                    href={src.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#00AEEF] hover:underline truncate max-w-[260px]"
                                >
                                    {src.title}
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Tabla Únicamente con Dispositivos Consultados / Registrados */}
            <div className="space-y-fib-13">
                <div className="flex flex-wrap items-center justify-between gap-fib-13">
                    <span className="font-mono text-microcopy font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">
                        {t(
                            'compatibility.db_table_title',
                            'BASE DE DATOS DE EQUIPOS CONSULTADOS'
                        )}{' '}
                        ({filteredDevices.length})
                    </span>

                    <div className="flex items-center gap-fib-13">
                        <form
                            autoComplete="off"
                            spellCheck={false}
                            onSubmit={(e) => e.preventDefault()}
                        >
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={tableFilter}
                                onChange={(e) => setTableFilter(e.target.value)}
                                placeholder={t(
                                    'compatibility.filter_registered_placeholder',
                                    'FILTRAR HISTORIAL CONSULTADO'
                                )}
                                className="h-9 w-64 px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#00AEEF] rounded-none shadow-none"
                            />
                        </form>
                        <button
                            type="button"
                            onClick={() => void loadRegistry()}
                            disabled={loading}
                            aria-label={t('common.refresh', 'REFRESCAR')}
                            className="bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">refresh</span>
                        </button>
                    </div>
                </div>

                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] overflow-x-auto rounded-none shadow-none">
                    <table className="w-full text-left border-collapse font-mono tabular-nums text-data-dense">
                        <thead>
                            <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                <th className="py-fib-13 px-fib-13">MODELO</th>
                                <th className="py-fib-13 px-fib-13">OS</th>
                                <th className="py-fib-13 px-fib-13">GIRO / AR / DEPTH</th>
                                <th className="py-fib-13 px-fib-13">VEREDICTO</th>
                                <th className="py-fib-13 px-fib-13">CONSULTAS</th>
                                <th className="py-fib-13 px-fib-13">VERIFICADO UTC</th>
                                <th className="py-fib-13 px-fib-13 text-right">RE-EVALUAR</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {!loading && filteredDevices.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="py-fib-34 px-fib-13 text-center text-[#5A6072] dark:text-[#94A3B8]"
                                    >
                                        {t(
                                            'compatibility.empty_registry',
                                            '[Sin equipos consultados aún]'
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredDevices.map((dev) => (
                                    <tr
                                        key={dev.canonicalKey}
                                        onClick={() =>
                                            setActiveVerdict({ device: dev, cached: true })
                                        }
                                        className="hover:bg-[#F8FAFC] dark:hover:bg-[#000000] cursor-pointer transition-colors"
                                    >
                                        <td className="py-fib-13 px-fib-13">
                                            <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {dev.manufacturer} {dev.model}
                                            </div>
                                            <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                {dev.deviceCode || dev.canonicalKey}
                                            </div>
                                        </td>
                                        <td className="py-fib-13 px-fib-13">{dev.platform}</td>
                                        <td className="py-fib-13 px-fib-13">
                                            {formatBoolCap(dev.hasGyroscope, 'GYRO', 'NO-GYRO')} ·{' '}
                                            {formatBoolCap(dev.arSupported, 'AR', 'NO-AR')} ·{' '}
                                            {dev.lidarSupported
                                                ? 'LIDAR'
                                                : formatBoolCap(dev.depthSupported, 'DEPTH', 'VIO')}
                                        </td>
                                        <td
                                            className={`py-fib-13 px-fib-13 font-bold ${tierColorClass(
                                                dev.tier
                                            )}`}
                                        >
                                            {dev.tier}
                                        </td>
                                        <td className="py-fib-13 px-fib-13">{dev.queryCount}</td>
                                        <td className="py-fib-13 px-fib-13">
                                            {formatUtcShort(dev.checkedAt)}
                                        </td>
                                        <td
                                            className="py-fib-13 px-fib-13 text-right"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                type="button"
                                                disabled={checking}
                                                onClick={() =>
                                                    void runCheck(
                                                        `${dev.manufacturer} ${dev.model}`,
                                                        true
                                                    )
                                                }
                                                aria-label={t(
                                                    'compatibility.recheck_action',
                                                    'Re-evaluar'
                                                )}
                                                title={t(
                                                    'compatibility.recheck_action',
                                                    'Re-evaluar'
                                                )}
                                                className={`bg-transparent border-0 outline-none p-1 cursor-pointer rounded-none ${refreshingKey ===
                                                    `${dev.manufacturer} ${dev.model}`
                                                    ? 'text-[#C68346]'
                                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF]'
                                                    }`}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    refresh
                                                </span>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default DesktopDeviceCompatibilityView;
