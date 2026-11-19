import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../../components/common/HitlConfirmModal';
import {
    ReportBlockEditable,
    ReportFieldRow,
    UNDECLARED_TECH_VALUE,
} from '../../../../components/common/ReportBlockEditable';
import { calculationEngine } from '../../core/services/calculation-engine';
import { dataService } from '../../core/services/DataService';
import {
    COPPER_DOMAIN_OPTIONS,
    CopperGovernanceBanner,
    mapCopperDomainToClase,
    sanitizeDecimalText,
} from '../../core/utils/captureHelpers';
import type {
    CopperMineralDomain,
    MiningSiteProfile,
    StockpileAsset,
} from '../../core/types/GeolappTypes';
import { ExternalSensorsPanel } from '../ExternalSensorsPanel';
import { GeolappAiEnrichDrawer } from '../GeolappAiEnrichDrawer';
import {
    computeAssetMetallurgySummary,
    parseNullableNonNegativeNumber,
    resolveCanonicalFix,
} from './desktopHelpers';

export interface DesktopDossierPanelProps {
    asset: StockpileAsset | null;
    sites?: MiningSiteProfile[];
}

type EditingBlock = 'identity' | 'material' | 'metallurgy' | null;

export const DesktopDossierPanel: React.FC<DesktopDossierPanelProps> = ({
    asset,
    sites = [],
}) => {
    const { t } = useTranslation();

    const [editingBlock, setEditingBlock] = useState<EditingBlock>(null);
    const [showAiDrawer, setShowAiDrawer] = useState(false);
    const [showSensorsDrawer, setShowSensorsDrawer] = useState(false);
    const [showMetallurgyBlock, setShowMetallurgyBlock] = useState(true);
    const [isSavingHitl, setIsSavingHitl] = useState(false);

    const [draftName, setDraftName] = useState('');
    const [draftProjectId, setDraftProjectId] = useState('');
    const [draftLocation, setDraftLocation] = useState('');
    const [draftDescription, setDraftDescription] = useState('');
    const [draftDomain, setDraftDomain] = useState<CopperMineralDomain | ''>('');
    const [draftDensity, setDraftDensity] = useState('');
    const [draftMoisture, setDraftMoisture] = useState('');
    const [draftTml, setDraftTml] = useState('');
    const [draftCuT, setDraftCuT] = useState('');
    const [draftCuS, setDraftCuS] = useState('');
    const [draftDays, setDraftDays] = useState('');
    const [draftRomana, setDraftRomana] = useState('');

    const [pendingPatch, setPendingPatch] = useState<{
        patch: Partial<StockpileAsset>;
        diffs: HitlComparisonDiffItem[];
    } | null>(null);

    useEffect(() => {
        if (!asset) return;
        setEditingBlock(null);
        setDraftName(asset.name);
        setDraftProjectId(asset.project_id || '');
        setDraftLocation(asset.location_ref || '');
        setDraftDescription(asset.description || '');
        setDraftDomain(asset.copper_domain || '');
        setDraftDensity(asset.density_factor != null ? String(asset.density_factor) : '');
        setDraftMoisture(asset.moisture_pct != null ? String(asset.moisture_pct) : '');
        setDraftTml(asset.tml_pct != null ? String(asset.tml_pct) : '');
        setDraftCuT(asset.cu_total_pct != null ? String(asset.cu_total_pct) : '');
        setDraftCuS(asset.cu_soluble_pct != null ? String(asset.cu_soluble_pct) : '');
        setDraftDays(asset.residence_days != null ? String(asset.residence_days) : '');
        setDraftRomana(asset.peso_romana != null ? String(asset.peso_romana) : '');
    }, [asset]);

    const canonicalFix = useMemo(() => resolveCanonicalFix(asset), [asset]);
    const governanceResult = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: asset?.copper_domain,
                residenceDays: asset?.residence_days ?? null,
                moisturePct: asset?.moisture_pct ?? null,
                tmlLimitPct: asset?.tml_pct ?? null,
            }),
        [asset?.copper_domain, asset?.residence_days, asset?.moisture_pct, asset?.tml_pct]
    );

    if (!asset) {
        return null;
    }

    const summary = computeAssetMetallurgySummary(asset);
    const domainDisplay = asset.copper_domain
        ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
        : null;

    const handleQueueIdentity = (e: React.FormEvent) => {
        e.preventDefault();
        const patch: Partial<StockpileAsset> = {};
        const diffs: HitlComparisonDiffItem[] = [];
        if (draftName.trim() && draftName.trim() !== asset.name) {
            patch.name = draftName.trim();
            diffs.push({
                field: t('registration.name_label', 'ID / NOMBRE'),
                current: asset.name,
                suggested: draftName.trim(),
            });
        }
        if (draftProjectId !== (asset.project_id || '')) {
            const nextSite = sites.find((s) => s.id === draftProjectId) || null;
            patch.project_id = nextSite ? nextSite.id : null;
            patch.project_name = nextSite ? nextSite.name : null;
            diffs.push({
                field: t('faenas.site_label', 'FAENA MINERA'),
                current: asset.project_name || UNDECLARED_TECH_VALUE,
                suggested: nextSite?.name || UNDECLARED_TECH_VALUE,
            });
        }
        if (draftLocation.trim() !== (asset.location_ref || '')) {
            patch.location_ref = draftLocation.trim();
            diffs.push({
                field: t('registration.location_ref_label', 'UBICACIÓN'),
                current: asset.location_ref || UNDECLARED_TECH_VALUE,
                suggested: draftLocation.trim() || UNDECLARED_TECH_VALUE,
            });
        }
        if (draftDescription.trim() !== (asset.description || '')) {
            patch.description = draftDescription.trim();
            diffs.push({
                field: t('registration.description_label', 'DESCRIPCIÓN'),
                current: asset.description || UNDECLARED_TECH_VALUE,
                suggested: draftDescription.trim() || UNDECLARED_TECH_VALUE,
            });
        }
        if (diffs.length === 0) {
            setEditingBlock(null);
            return;
        }
        setPendingPatch({ patch, diffs });
    };

    const handleQueueMaterial = (e: React.FormEvent) => {
        e.preventDefault();
        const patch: Partial<StockpileAsset> = {};
        const diffs: HitlComparisonDiffItem[] = [];
        if (draftDomain && draftDomain !== asset.copper_domain) {
            patch.copper_domain = draftDomain;
            patch.clase = mapCopperDomainToClase(draftDomain);
            diffs.push({
                field: t('registration.copper_domain_label', 'DOMINIO Cu'),
                current: domainDisplay || UNDECLARED_TECH_VALUE,
                suggested: t(`copper_domains.${draftDomain}`, draftDomain),
            });
        }
        const nextDensity = parseNullableNonNegativeNumber(draftDensity);
        if (nextDensity !== null && nextDensity !== (asset.density_factor ?? null)) {
            patch.density_factor = nextDensity;
            if (summary.volumeM3 > 0) {
                const updatedWeight = Number((summary.volumeM3 * nextDensity).toFixed(2));
                patch.last_weight_t = updatedWeight;
                patch.weight_t = updatedWeight;
                patch.peso_final_toneladas = updatedWeight;
            }
            diffs.push({
                field: t('manual_capture.fields.density_factor', 'DENSIDAD'),
                current:
                    asset.density_factor != null
                        ? `${asset.density_factor} t/m³`
                        : UNDECLARED_TECH_VALUE,
                suggested: `${nextDensity} t/m³`,
            });
        }
        if (diffs.length === 0) {
            setEditingBlock(null);
            return;
        }
        setPendingPatch({ patch, diffs });
    };

    const handleQueueMetallurgy = (e: React.FormEvent) => {
        e.preventDefault();
        const patch: Partial<StockpileAsset> = {};
        const diffs: HitlComparisonDiffItem[] = [];
        const checkNum = (
            key: keyof StockpileAsset,
            label: string,
            curr: number | null | undefined,
            raw: string,
            suffix: string
        ) => {
            const next = parseNullableNonNegativeNumber(raw);
            if (next !== (curr ?? null)) {
                (patch as Record<string, unknown>)[key] = next;
                diffs.push({
                    field: label,
                    current: curr != null ? `${curr} ${suffix}` : UNDECLARED_TECH_VALUE,
                    suggested: next != null ? `${next} ${suffix}` : UNDECLARED_TECH_VALUE,
                });
            }
        };
        checkNum('moisture_pct', 'w %', asset.moisture_pct, draftMoisture, '%');
        checkNum('tml_pct', 'TML %', asset.tml_pct, draftTml, '%');
        checkNum('cu_total_pct', 'CuT %', asset.cu_total_pct, draftCuT, '%');
        checkNum('cu_soluble_pct', 'CuS %', asset.cu_soluble_pct, draftCuS, '%');
        checkNum('residence_days', 'Días', asset.residence_days, draftDays, 'd');
        checkNum('peso_romana', 'Romana', asset.peso_romana, draftRomana, 't');

        if (diffs.length === 0) {
            setEditingBlock(null);
            return;
        }
        setPendingPatch({ patch, diffs });
    };

    const executePendingHitl = async () => {
        if (!pendingPatch || isSavingHitl) return;
        setIsSavingHitl(true);
        try {
            await dataService.updateAssetWithHitl(
                asset.id,
                pendingPatch.patch,
                'ACTUALIZAR',
                pendingPatch.diffs
            );
            setPendingPatch(null);
            setEditingBlock(null);
        } finally {
            setIsSavingHitl(false);
        }
    };

    return (
        <aside className="h-full min-h-0 flex flex-col border-l border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] overflow-hidden rounded-none shadow-none">
            <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                    {t('hitl.report_mode', 'INFORME TÉCNICO')}
                </span>
                <button
                    type="button"
                    onClick={() => setShowAiDrawer(true)}
                    className="px-fib-13 py-1.5 bg-[#00AEEF] hover:bg-[#009ad4] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer flex items-center gap-1 rounded-none"
                >
                    <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                    <span>{t('ai_enrich.cta_short', 'ASISTIR IA')}</span>
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                <CopperGovernanceBanner result={governanceResult} />

                <ReportBlockEditable
                    code="01"
                    title={t('dossier.block_identity', 'IDENTIFICACIÓN Y GEORREFERENCIA')}
                    isEditing={editingBlock === 'identity'}
                    onToggleEdit={() =>
                        setEditingBlock((p) => (p === 'identity' ? null : 'identity'))
                    }
                >
                    {editingBlock === 'identity' ? (
                        <form autoComplete="off" spellCheck={false} onSubmit={handleQueueIdentity} className="space-y-fib-8">
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                className="w-full h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                            />
                            {sites.length > 0 && (
                                <select
                                    value={draftProjectId}
                                    onChange={(e) => setDraftProjectId(e.target.value)}
                                    aria-label={t('faenas.select_aria', 'Seleccionar faena minera')}
                                    className="w-full h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                                >
                                    <option value="">
                                        {t('faenas.unassigned', 'SIN FAENA ASIGNADA')}
                                    </option>
                                    {sites.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={draftLocation}
                                onChange={(e) => setDraftLocation(e.target.value)}
                                placeholder={t('registration.location_ref_label', 'UBICACIÓN')}
                                className="w-full h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                            />
                            <textarea
                                rows={2}
                                autoComplete="off"
                                spellCheck={false}
                                value={draftDescription}
                                onChange={(e) => setDraftDescription(e.target.value)}
                                placeholder={t('registration.description_label', 'DESCRIPCIÓN')}
                                className="w-full p-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense rounded-none"
                            />
                            <button
                                type="submit"
                                className="px-fib-13 py-1.5 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                            >
                                {t('hitl.save_audit', 'REVISAR HITL')}
                            </button>
                        </form>
                    ) : (
                        <div>
                            <ReportFieldRow
                                label={t('faenas.site_label', 'FAENA MINERA')}
                                value={asset.project_name}
                            />
                            <ReportFieldRow
                                label={t('registration.name_label', 'CÓDIGO')}
                                value={asset.name}
                                copyable
                            />
                            <ReportFieldRow
                                label={t('registration.location_ref_label', 'UBICACIÓN')}
                                value={asset.location_ref}
                            />
                            <ReportFieldRow
                                label={t('analytics.geospatial_utm_title', 'UTM WGS84')}
                                value={canonicalFix?.utm.formatted}
                                copyable={Boolean(canonicalFix)}
                            />
                            <ReportFieldRow
                                label={t('registration.description_label', 'DESCRIPCIÓN')}
                                value={asset.description}
                                mono={false}
                            />
                        </div>
                    )}
                </ReportBlockEditable>

                <ReportBlockEditable
                    code="02"
                    title={t('dossier.block_material', 'MATERIAL Y DENSIDAD')}
                    isEditing={editingBlock === 'material'}
                    onToggleEdit={() =>
                        setEditingBlock((p) => (p === 'material' ? null : 'material'))
                    }
                >
                    {editingBlock === 'material' ? (
                        <form autoComplete="off" spellCheck={false} onSubmit={handleQueueMaterial} className="space-y-fib-8">
                            <select
                                value={draftDomain}
                                onChange={(e) =>
                                    setDraftDomain(e.target.value as CopperMineralDomain)
                                }
                                className="w-full h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                            >
                                <option value="">{UNDECLARED_TECH_VALUE}</option>
                                {COPPER_DOMAIN_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {t(opt.labelKey, opt.fallbackLabel)}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={draftDensity}
                                onChange={(e) =>
                                    setDraftDensity(sanitizeDecimalText(e.target.value))
                                }
                                placeholder={t('manual_capture.fields.density_factor', 'DENSIDAD (t/m³)')}
                                className="w-full h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                            />
                            <button
                                type="submit"
                                className="px-fib-13 py-1.5 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                            >
                                {t('hitl.save_audit', 'REVISAR HITL')}
                            </button>
                        </form>
                    ) : (
                        <div>
                            <ReportFieldRow
                                label={t('registration.copper_domain_label', 'DOMINIO Cu')}
                                value={domainDisplay}
                            />
                            <ReportFieldRow
                                label={t('manual_capture.fields.density_factor', 'DENSIDAD')}
                                value={
                                    asset.density_factor != null
                                        ? `${asset.density_factor} t/m³`
                                        : null
                                }
                            />
                            <ReportFieldRow
                                label={t('scanner.granulometry_label', 'GRANULOMETRÍA')}
                                value={asset.tipo_granulometria}
                            />
                            <ReportFieldRow
                                label={t('rosin_rammler.p80_label', 'P80 (mm)')}
                                value={
                                    typeof asset.p80_mm === 'number'
                                        ? `${asset.p80_mm.toFixed(1)} mm`
                                        : null
                                }
                            />
                        </div>
                    )}
                </ReportBlockEditable>

                {/* Block 03 Collapsible Geo-Metallurgy */}
                <ReportBlockEditable
                    code="03"
                    title={t('copper_governance.title', 'GEO-METALURGIA Cu E IMSBC')}
                    isEditing={editingBlock === 'metallurgy'}
                    canEdit={showMetallurgyBlock}
                    collapsed={!showMetallurgyBlock}
                    onToggleEdit={() =>
                        setEditingBlock((p) => (p === 'metallurgy' ? null : 'metallurgy'))
                    }
                    headerActions={
                        <button
                            type="button"
                            onClick={() => {
                                setShowMetallurgyBlock((prev) => {
                                    if (prev && editingBlock === 'metallurgy') {
                                        setEditingBlock(null);
                                    }
                                    return !prev;
                                });
                            }}
                            aria-label={t('copper_governance.title', 'GEO-METALURGIA Cu E IMSBC')}
                            className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {showMetallurgyBlock ? 'expand_less' : 'expand_more'}
                            </span>
                        </button>
                    }
                >
                    {editingBlock === 'metallurgy' ? (
                        <form
                            autoComplete="off"
                            spellCheck={false}
                            onSubmit={handleQueueMetallurgy}
                            className="space-y-fib-8"
                        >
                            <div className="grid grid-cols-2 gap-fib-8">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draftMoisture}
                                    onChange={(e) =>
                                        setDraftMoisture(sanitizeDecimalText(e.target.value))
                                    }
                                    placeholder="w %"
                                    className="h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                />
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draftTml}
                                    onChange={(e) =>
                                        setDraftTml(sanitizeDecimalText(e.target.value))
                                    }
                                    placeholder="TML %"
                                    className="h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                />
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draftCuT}
                                    onChange={(e) =>
                                        setDraftCuT(sanitizeDecimalText(e.target.value))
                                    }
                                    placeholder="CuT %"
                                    className="h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                />
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draftCuS}
                                    onChange={(e) =>
                                        setDraftCuS(sanitizeDecimalText(e.target.value))
                                    }
                                    placeholder="CuS %"
                                    className="h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                />
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draftDays}
                                    onChange={(e) =>
                                        setDraftDays(sanitizeDecimalText(e.target.value))
                                    }
                                    placeholder="Días"
                                    className="h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                />
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draftRomana}
                                    onChange={(e) =>
                                        setDraftRomana(sanitizeDecimalText(e.target.value))
                                    }
                                    placeholder="Romana t"
                                    className="h-9 px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                />
                            </div>
                            <button
                                type="submit"
                                className="px-fib-13 py-1.5 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer rounded-none"
                            >
                                {t('hitl.save_audit', 'REVISAR HITL')}
                            </button>
                        </form>
                    ) : (
                        <div>
                            <ReportFieldRow
                                label={t('copper_governance.moisture', 'HUMEDAD w%')}
                                value={
                                    asset.moisture_pct != null
                                        ? `${asset.moisture_pct} %`
                                        : null
                                }
                            />
                            <ReportFieldRow
                                label="CuT / CuS"
                                value={
                                    asset.cu_total_pct != null ||
                                    asset.cu_soluble_pct != null
                                        ? `${asset.cu_total_pct ?? '--'}% / ${asset.cu_soluble_pct ?? '--'}%`
                                        : null
                                }
                            />
                            <ReportFieldRow
                                label={t('copper_governance.fine_cu', 'Cu FINO')}
                                value={
                                    summary.fineCuT != null ? `${summary.fineCuT} t` : null
                                }
                            />
                            <ReportFieldRow
                                label={t('copper_governance.tml', 'TML IMSBC')}
                                value={
                                    asset.tml_pct != null ? `${asset.tml_pct} %` : null
                                }
                            />
                            <ReportFieldRow
                                label={t('copper_governance.scale_weight', 'PESO ROMANA')}
                                value={
                                    asset.peso_romana != null
                                        ? `${asset.peso_romana} t`
                                        : null
                                }
                            />
                        </div>
                    )}
                </ReportBlockEditable>

                {/* Collapsible External Sensors (RTK / UAV / LiDAR) */}
                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none">
                    <button
                        type="button"
                        onClick={() => setShowSensorsDrawer((p) => !p)}
                        className="w-full px-fib-21 py-fib-13 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#000000] border-0 cursor-pointer rounded-none"
                    >
                        <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('adapters.gnss_title', 'SENSORES EXTERNOS RTK / LiDAR / UAV')}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6]">
                            {showSensorsDrawer ? 'expand_less' : 'expand_more'}
                        </span>
                    </button>
                    {showSensorsDrawer && (
                        <div className="p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <ExternalSensorsPanel compact tenantId={asset.tenantId} />
                        </div>
                    )}
                </div>
            </div>

            <GeolappAiEnrichDrawer
                open={showAiDrawer}
                asset={asset}
                onClose={() => setShowAiDrawer(false)}
            />

            <HitlConfirmModal
                open={Boolean(pendingPatch)}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL')}
                description={t(
                    'hitl.modal_description',
                    'Escriba ACTUALIZAR para confirmar el registro oficial.'
                )}
                comparisonDiff={pendingPatch?.diffs}
                loading={isSavingHitl}
                onConfirm={() => void executePendingHitl()}
                onCancel={() => setPendingPatch(null)}
            />
        </aside>
    );
};
