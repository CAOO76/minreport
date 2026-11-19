import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    computeAllFaenasBreakdown,
    UNASSIGNED_FAENA_ID,
} from '../../core/services/stockpile-faena-metrics';
import type {
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../../core/types/GeolappTypes';

export interface DesktopFaenaDirectoryProps {
    assets: StockpileAsset[];
    measurements: StockpileMeasurement[];
    sites: MiningSiteProfile[];
    canRegisterDevFaena?: boolean;
    onRegisterDevFaena?: (name: string) => Promise<MiningSiteProfile>;
    onOpenFaena: (faenaId: string) => void;
    onOpenMonitoring: (faenaId: string) => void;
}

export const DesktopFaenaDirectory: React.FC<DesktopFaenaDirectoryProps> = ({
    assets,
    measurements,
    sites,
    canRegisterDevFaena = false,
    onRegisterDevFaena,
    onOpenFaena,
    onOpenMonitoring,
}) => {
    const { t } = useTranslation();

    const [searchQuery, setSearchQuery] = useState('');
    const [showNewFaenaForm, setShowNewFaenaForm] = useState(false);
    const [newFaenaName, setNewFaenaName] = useState('');
    const [savingFaena, setSavingFaena] = useState(false);

    const rows = useMemo(() => {
        const raw = computeAllFaenasBreakdown(assets, measurements, sites);
        const filteredByScope = raw.filter(
            (item) => item.faenaId !== UNASSIGNED_FAENA_ID || item.totalCount > 0
        );

        const q = searchQuery.trim().toLowerCase();
        const matching = filteredByScope.filter((item) => {
            if (!q) return true;
            const displayName =
                item.faenaId === UNASSIGNED_FAENA_ID
                    ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                    : item.faenaName;
            return displayName.toLowerCase().includes(q);
        });

        return [...matching].sort((a, b) => {
            const aUnassigned = a.faenaId === UNASSIGNED_FAENA_ID;
            const bUnassigned = b.faenaId === UNASSIGNED_FAENA_ID;
            if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
            if (b.activeVolumeM3 !== a.activeVolumeM3) {
                return b.activeVolumeM3 - a.activeVolumeM3;
            }
            return a.faenaName.localeCompare(b.faenaName);
        });
    }, [assets, measurements, sites, searchQuery, t]);

    const handleCreateDevFaena = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newFaenaName.trim();
        if (!trimmed || !onRegisterDevFaena || savingFaena) return;
        setSavingFaena(true);
        try {
            await onRegisterDevFaena(trimmed);
            setNewFaenaName('');
            setShowNewFaenaForm(false);
        } finally {
            setSavingFaena(false);
        }
    };

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none">
            <div className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-wrap items-center justify-between gap-fib-13">
                <h1 className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                    {t('desktop.directory_title', 'DIRECTORIO DE FAENAS')}{' '}
                    <span className="tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                        ({rows.length})
                    </span>
                </h1>

                <div className="flex items-center gap-fib-13">
                    <div className="relative">
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t(
                                'desktop.search_faena_placeholder',
                                'FILTRAR FAENA MINERA'
                            )}
                            aria-label={t(
                                'desktop.search_faena_placeholder',
                                'FILTRAR FAENA MINERA'
                            )}
                            className="h-9 w-64 px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                        />
                    </div>

                    {canRegisterDevFaena && onRegisterDevFaena && (
                        <button
                            type="button"
                            onClick={() => setShowNewFaenaForm((prev) => !prev)}
                            aria-label={t('faenas.add_dev_aria', 'Registrar faena manualmente')}
                            title={t('faenas.add_dev_aria', 'Registrar faena manualmente')}
                            className={`h-9 px-fib-13 bg-transparent border-0 outline-none cursor-pointer flex items-center gap-1.5 font-mono text-microcopy font-bold uppercase rounded-none transition-colors ${
                                showNewFaenaForm
                                    ? 'text-[#C68346]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                {showNewFaenaForm ? 'close' : 'domain_add'}
                            </span>
                            <span>{t('faenas.register_btn', 'REGISTRAR FAENA')}</span>
                        </button>
                    )}
                </div>
            </div>

            {showNewFaenaForm && canRegisterDevFaena && onRegisterDevFaena && (
                <form
                    onSubmit={handleCreateDevFaena}
                    autoComplete="off"
                    spellCheck={false}
                    className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex flex-wrap items-center gap-fib-13"
                >
                    <span className="text-microcopy font-mono font-bold uppercase text-[#C68346] shrink-0">
                        {t('faenas.register_title', 'REGISTRAR FAENA MINERA')}
                    </span>
                    <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={newFaenaName}
                        onChange={(e) => setNewFaenaName(e.target.value)}
                        placeholder={t('faenas.name_placeholder', 'NOMBRE DE LA FAENA / MINA')}
                        aria-label={t('faenas.name_placeholder', 'NOMBRE DE LA FAENA / MINA')}
                        className="flex-1 min-w-[220px] max-w-md h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                    />
                    <button
                        type="submit"
                        disabled={savingFaena || !newFaenaName.trim()}
                        className="h-9 px-fib-13 bg-[#C68346] hover:bg-[#b5753b] text-white border-0 font-mono text-microcopy font-bold uppercase cursor-pointer disabled:opacity-40 rounded-none"
                    >
                        {t('faenas.register_btn', 'REGISTRAR FAENA')}
                    </button>
                </form>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
                {rows.length === 0 ? (
                    <div className="h-full flex items-center justify-center p-fib-55">
                        <div className="text-center space-y-fib-13 max-w-md">
                            <span className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]">
                                domain
                            </span>
                            <p className="text-body-main font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                {canRegisterDevFaena
                                    ? t(
                                          'faenas.register_prompt',
                                          'Registre una faena minera para vincular los acopios.'
                                      )
                                    : t(
                                          'faenas.empty_mobile',
                                          'SIN FAENAS REGISTRADAS DESDE ESCRITORIO'
                                      )}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-data-dense tabular-nums border-collapse">
                            <thead>
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <th className="px-fib-21 py-fib-13">
                                        {t('faenas.site_label', 'FAENA MINERA')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('monitoring.active_closed', 'ACTIVOS / CERRADOS')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('monitoring.active_volume', 'VOLUMEN ACTIVO')} [m³]
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('desktop.col_weight_thm', 'THM [t]')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('monitoring.fine_cu', 'Cu FINO [t]')}
                                    </th>
                                    <th className="px-fib-13 py-fib-13 text-right">
                                        {t('desktop.alerts_col', 'ALERTAS')}
                                    </th>
                                    <th className="px-fib-21 py-fib-13 text-right" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {rows.map((item) => {
                                    const isUnassigned = item.faenaId === UNASSIGNED_FAENA_ID;
                                    const label = isUnassigned
                                        ? t('faenas.unassigned', 'SIN FAENA ASIGNADA')
                                        : item.faenaName;
                                    const alertCount =
                                        item.imsbcBlockedCount + item.sulfideAlertCount;
                                    return (
                                        <tr
                                            key={item.faenaId}
                                            onClick={() => onOpenFaena(item.faenaId)}
                                            className="cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors"
                                        >
                                            <td className="px-fib-21 py-fib-13 font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                <span
                                                    className={
                                                        isUnassigned
                                                            ? 'text-[#475569] dark:text-[#8A93A6]'
                                                            : ''
                                                    }
                                                >
                                                    {label}
                                                </span>
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right text-[#0F172A] dark:text-[#F3F4F6]">
                                                <span className="text-[#00AEEF] font-bold">
                                                    {item.activeCount}
                                                </span>
                                                {' / '}
                                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                                    {item.closedCount}
                                                </span>
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right font-bold text-[#C68346]">
                                                {item.activeVolumeM3.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right text-[#0F172A] dark:text-[#F3F4F6]">
                                                {item.activeWetWeightT.toLocaleString(undefined, {
                                                    maximumFractionDigits: 1,
                                                })}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right text-[#00AEEF] font-bold">
                                                {item.activeFineCuT !== null
                                                    ? item.activeFineCuT.toLocaleString(undefined, {
                                                          maximumFractionDigits: 1,
                                                      })
                                                    : '--'}
                                            </td>
                                            <td className="px-fib-13 py-fib-13 text-right">
                                                <span
                                                    className={
                                                        alertCount > 0
                                                            ? 'font-bold text-[#C68346]'
                                                            : 'text-[#94A3B8] dark:text-[#5A6072]'
                                                    }
                                                >
                                                    {alertCount}
                                                </span>
                                            </td>
                                            <td className="px-fib-21 py-fib-13 text-right">
                                                <div className="inline-flex items-center gap-fib-8">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onOpenMonitoring(item.faenaId);
                                                        }}
                                                        aria-label={`${t('monitoring.title', 'ESTADÍSTICAS POR FAENA')}: ${label}`}
                                                        title={t(
                                                            'monitoring.title',
                                                            'ESTADÍSTICAS POR FAENA'
                                                        )}
                                                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] transition-colors cursor-pointer rounded-none"
                                                    >
                                                        <span className="material-symbols-outlined text-[20px]">
                                                            monitoring
                                                        </span>
                                                    </button>
                                                    <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072]">
                                                        chevron_right
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DesktopFaenaDirectory;
