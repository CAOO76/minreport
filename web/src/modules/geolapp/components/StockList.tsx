import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StockpileAsset } from '../core/types/GeolappTypes';
import { calculationEngine } from '../core/services/calculation-engine';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { M3CircularProgress } from '../../../components/common/M3CircularProgress';
import { SecureImage } from '../../../components/common/SecureImage';
import { UNDECLARED_TECH_VALUE } from '../../../components/common/ReportBlockEditable';

interface StockListProps {
    assets: StockpileAsset[];
    isLoading: boolean;
    onSelectAsset: (asset: StockpileAsset) => void;
    onBack: () => void;
    onAddNew: () => void;
}

type MaterialFilter = 'ALL' | 'mineral' | 'esteril' | 'baja_ley';

const formatKilobytes = (bytes?: number): string | null => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
};

const AssetRowCard: React.FC<{
    asset: StockpileAsset;
    onSelect: (asset: StockpileAsset) => void;
}> = ({ asset, onSelect }) => {
    const { t } = useTranslation();
    const resolvedCover = useResolvedStockpileImage(
        asset.last_photo_url || asset.initial_photo_url || asset.thumbnail_url
    );

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

    const origStr = formatKilobytes(asset.cas_original_bytes);
    const optStr = formatKilobytes(asset.cas_optimized_bytes);
    const casSavings =
        typeof asset.cas_savings_pct === 'number' && Number.isFinite(asset.cas_savings_pct)
            ? asset.cas_savings_pct.toFixed(0)
            : null;

    const copperDomainLabel = asset.copper_domain
        ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
        : null;

    const materialLabel =
        asset.clase === 'mineral'
            ? t('material_type.mineral', 'Mineral')
            : asset.clase === 'esteril'
              ? t('material_type.esteril', 'Estéril')
              : asset.clase === 'baja_ley'
                ? t('material_type.baja_ley', 'Baja Ley')
                : asset.clase;

    return (
        <button
            type="button"
            onClick={() => onSelect(asset)}
            className="w-full text-left bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] p-fib-21 transition-colors cursor-pointer rounded-none shadow-none flex items-start gap-fib-13 group"
        >
            {/* Thumbnail (Protected SecureImage) */}
            <div className="w-[72px] h-[72px] shrink-0 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden rounded-none shadow-none">
                {resolvedCover ? (
                    <SecureImage
                        src={resolvedCover}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <span className="material-symbols-outlined text-[28px] text-[#94A3B8] dark:text-[#5A6072]">
                        landscape
                    </span>
                )}
            </div>

            {/* Technical Spec Column */}
            <div className="flex-1 min-w-0 flex flex-col gap-fib-8">
                <div className="flex items-start justify-between gap-fib-13">
                    <div className="min-w-0">
                        <div className="flex items-center gap-fib-8 flex-wrap">
                            <span className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6] group-hover:text-[#C68346] transition-colors truncate">
                                {asset.name}
                            </span>
                            {asset.id && (
                                <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] border border-[#E2E8F0] dark:border-[#12151C] px-fib-8 py-0.5 rounded-none">
                                    {asset.id}
                                </span>
                            )}
                        </div>
                        <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] truncate mt-0.5">
                            {materialLabel} · {asset.location_ref?.trim() || UNDECLARED_TECH_VALUE}
                        </p>
                    </div>

                    <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072] group-hover:text-[#C68346] shrink-0">
                        chevron_right
                    </span>
                </div>

                {/* Numeric Metrics Row (Tabular Monospace) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-fib-8 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="flex flex-col">
                        <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                            {t('manual_capture.estimated_volume', 'VOLUMEN')}
                        </span>
                        <span className="text-data-dense font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                            {typeof asset.last_volume_m3 === 'number'
                                ? `${asset.last_volume_m3.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`
                                : UNDECLARED_TECH_VALUE}
                        </span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                            {t('copper_governance.thm', 'THM [t]')}
                        </span>
                        <span className="text-data-dense font-mono font-bold tabular-nums text-[#C68346]">
                            {typeof (asset.wet_weight_thm ?? asset.last_weight_t) === 'number'
                                ? `${(asset.wet_weight_thm ?? asset.last_weight_t)!.toLocaleString(undefined, { maximumFractionDigits: 2 })} t`
                                : UNDECLARED_TECH_VALUE}
                        </span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                            {t('registration.copper_domain_label', 'DOMINIO Cu')}
                        </span>
                        <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {copperDomainLabel || UNDECLARED_TECH_VALUE}
                        </span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                            {t('copper_governance.fine_cu', 'Cu FINO [t]')}
                        </span>
                        <span className="text-data-dense font-mono font-bold tabular-nums text-[#00AEEF]">
                            {typeof asset.fine_cu_t === 'number'
                                ? `${asset.fine_cu_t.toLocaleString(undefined, { maximumFractionDigits: 2 })} t`
                                : UNDECLARED_TECH_VALUE}
                        </span>
                    </div>
                </div>

                {/* Copper Governance Alert & CAS Traceability Row */}
                {(governance.alerts.length > 0 || (origStr && optStr)) && (
                    <div className="flex flex-wrap items-center justify-between gap-fib-8 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        {governance.alerts.length > 0 && (
                            <div
                                className={`flex items-center gap-fib-8 text-microcopy font-mono uppercase ${
                                    governance.hasCriticalBlock
                                        ? 'text-red-600 dark:text-red-400'
                                        : 'text-[#C68346]'
                                }`}
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    {governance.hasCriticalBlock ? 'block' : 'warning'}
                                </span>
                                <span>
                                    {governance.hasCriticalBlock
                                        ? t('copper_governance.dispatch_blocked', 'DESPACHO BLOQUEADO (IMSBC)')
                                        : governance.alerts[0].code}
                                </span>
                            </div>
                        )}

                        {origStr && optStr && (
                            <span className="text-microcopy font-mono tabular-nums text-[#00AEEF] ml-auto">
                                {`ORIG ${origStr} -> CAS ${optStr}${casSavings !== null ? ` (-${casSavings}%)` : ''}`}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </button>
    );
};

export const StockList: React.FC<StockListProps> = ({
    assets,
    isLoading,
    onSelectAsset,
    onBack,
    onAddNew,
}) => {
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('ALL');

    const filteredAssets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return assets.filter((asset) => {
            if (materialFilter !== 'ALL' && asset.clase !== materialFilter) {
                return false;
            }
            if (!q) return true;
            return (
                asset.name.toLowerCase().includes(q) ||
                (asset.location_ref || '').toLowerCase().includes(q) ||
                (asset.id || '').toLowerCase().includes(q) ||
                (asset.copper_domain || '').toLowerCase().includes(q)
            );
        });
    }, [assets, searchQuery, materialFilter]);

    const filterOptions: Array<{ id: MaterialFilter; label: string }> = [
        { id: 'ALL', label: t('analytics.filter_all', 'TODOS') },
        { id: 'mineral', label: t('material_type.mineral', 'Mineral') },
        { id: 'esteril', label: t('material_type.esteril', 'Estéril') },
        { id: 'baja_ley', label: t('material_type.baja_ley', 'Baja Ley') },
    ];

    return (
        <main className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none">
            {/* Header */}
            <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13">
                <div className="flex items-center gap-fib-13 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        title={t('common.back_button', 'VOLVER')}
                        aria-label={t('common.back_button', 'VOLVER')}
                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[24px] text-[#C68346]">
                            arrow_back
                        </span>
                    </button>
                    <div className="min-w-0">
                        <span className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                            {t('common.module_title', 'GEOLAPP® · CONTROL DE STOCKPILES')}
                        </span>
                        <h1 className="text-h1-header font-bold uppercase tracking-tight truncate">
                            {t('analytics.stock_list_title', 'INVENTARIO DE ACOPIOS')}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-fib-13 shrink-0">
                    <span className="text-data-dense font-mono font-bold tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {filteredAssets.length} / {assets.length}
                    </span>
                    <button
                        type="button"
                        onClick={onAddNew}
                        title={t('analytics.new_asset_button', 'NUEVO ACOPIO')}
                        aria-label={t('analytics.new_asset_button', 'NUEVO ACOPIO')}
                        className="bg-transparent border-0 outline-none p-2 text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[26px]">add_circle</span>
                    </button>
                </div>
            </header>

            {isLoading && (
                <div className="shrink-0 w-full">
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('common.loading', 'CARGANDO...')}
                    />
                </div>
            )}

            {/* Search & Filters */}
            <section className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col sm:flex-row gap-fib-13 sm:items-center justify-between">
                <div className="relative flex-1 max-w-md flex items-center border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072] pl-fib-13 select-none">
                        search
                    </span>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t('analytics.search_placeholder', 'FILTRAR POR ID O UBICACIÓN')}
                        aria-label={t('analytics.search_placeholder', 'FILTRAR POR ID O UBICACIÓN')}
                        className="w-full bg-transparent border-0 outline-none px-fib-13 py-fib-8 text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] select-text rounded-none"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            title={t('common.close_button', 'CERRAR')}
                            aria-label={t('common.close_button', 'CERRAR')}
                            className="bg-transparent border-0 outline-none p-2 text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-fib-8 overflow-x-auto hide-scrollbar">
                    {filterOptions.map((opt) => {
                        const active = materialFilter === opt.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setMaterialFilter(opt.id)}
                                className={`px-fib-13 py-fib-8 text-microcopy font-mono font-bold uppercase tracking-wider border transition-colors cursor-pointer rounded-none shadow-none whitespace-nowrap ${
                                    active
                                        ? 'border-[#C68346] bg-[#C68346]/10 text-[#C68346]'
                                        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            </section>

            {/* Inventory List */}
            <section className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-fib-21">
                {isLoading && assets.length === 0 ? (
                    <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-fib-13">
                        <M3CircularProgress
                            indeterminate
                            size={36}
                            strokeWidth={3}
                            ariaLabel={t('common.loading', 'CARGANDO...')}
                        />
                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('common.loading', 'CARGANDO...')}
                        </span>
                    </div>
                ) : filteredAssets.length === 0 ? (
                    <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-fib-21 text-center p-fib-34 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                        <span className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]">
                            inventory_2
                        </span>
                        <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                            {t('analytics.no_assets', 'Sin acopios registrados')}
                        </p>
                        <button
                            type="button"
                            onClick={onAddNew}
                            className="px-fib-21 py-fib-13 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase tracking-wider border border-[#C68346] hover:bg-[#b57439] transition-colors cursor-pointer rounded-none shadow-none"
                        >
                            {t('analytics.new_asset_button', 'NUEVO ACOPIO')}
                        </button>
                    </div>
                ) : (
                    <div className="max-w-5xl mx-auto flex flex-col gap-fib-13 pb-fib-34">
                        {filteredAssets.map((asset) => (
                            <AssetRowCard
                                key={asset.id}
                                asset={asset}
                                onSelect={onSelectAsset}
                            />
                        ))}
                    </div>
                )}
            </section>
        </main>
    );
};
