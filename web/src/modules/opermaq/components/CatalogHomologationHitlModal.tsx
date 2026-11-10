import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    buildHomologousEquipmentDescription,
    type CanonicalSpecSlot,
    MISSING_AXIS_VALUE,
} from '../utils/opermaqDomainProjection';
import { M3CircularProgress } from './M3ProgressIndicator';
import { M3Switch } from './M3Switch';

interface HomologationAxisDiff {
    axis_key: string;
    label_es: string;
    unit_hint: string;
    mandatory: boolean;
    is_differentiator?: boolean;
    current_value: string | null;
    suggested_value: string | null;
    source_url?: string | null;
    verbatim_evidence?: string | null;
    has_change: boolean;
}

interface CatalogHomologationProposal {
    global_asset_id: string;
    make_oficial: string;
    model_oficial: string;
    equipment_type_key?: string;
    archetype_id: string;
    archetype_name_es: string;
    current_tipo_equipo: string;
    proposed_tipo_equipo: string;
    proposed_categoria_equipo: string;
    official_url?: string;
    grounded_sources: Array<{ uri: string; title?: string }>;
    had_legacy_marketing_prose: boolean;
    warnings: string[];
    axes_diff: HomologationAxisDiff[];
}

export interface CatalogHomologationHitlModalProps {
    assetId: string;
    makeOficial: string;
    modelOficial: string;
    onClose: () => void;
    onConsolidated: (updated: {
        id: string;
        equipment_type_key?: string;
        archetype_id: string;
        tipo_equipo: string;
        canonical_specs: CanonicalSpecSlot[];
        short_description: string;
    }) => void;
}

export const CatalogHomologationHitlModal: React.FC<CatalogHomologationHitlModalProps> = ({
    assetId,
    makeOficial,
    modelOficial,
    onClose,
    onConsolidated,
}) => {
    const { t } = useTranslation();
    const { tenantId } = useOpermaqContext();

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [loadError, setLoadError] = useState<string>('');
    const [proposal, setProposal] = useState<CatalogHomologationProposal | null>(null);

    // Autorización granular 1 a 1: `true` aplica valor sugerido/editado; `false` conserva valor actual
    const [approvedByKey, setApprovedByKey] = useState<Record<string, boolean>>({});
    // Edición quirúrgica manual puntual por eje (`edit`)
    const [editingAxisKey, setEditingAxisKey] = useState<string | null>(null);
    const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});

    const [confirmWord, setConfirmWord] = useState<string>('');
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveError, setSaveError] = useState<string>('');

    const fetchProposal = useCallback(async () => {
        setIsLoading(true);
        setLoadError('');
        setSaveError('');
        try {
            const res = await authFetch(
                `${API_BASE_URL}/assets/catalog/${encodeURIComponent(assetId)}/propose-homologation`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                    },
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.proposal) {
                throw new Error(
                    String(json?.message || json?.error || t('opermaq_domains.homologate_error_load'))
                );
            }
            const nextProposal = json.proposal as CatalogHomologationProposal;
            setProposal(nextProposal);

            const initialToggles: Record<string, boolean> = {};
            for (const row of nextProposal.axes_diff || []) {
                // Si existe sugerencia grounded distinta al valor actual, pre-marcar para revisión humana 1 a 1
                initialToggles[row.axis_key] = Boolean(row.suggested_value && row.has_change);
            }
            setApprovedByKey(initialToggles);
            setManualOverrides({});
            setEditingAxisKey(null);
            setConfirmWord('');
        } catch (err: unknown) {
            setLoadError(
                err instanceof Error ? err.message : t('opermaq_domains.homologate_error_load')
            );
        } finally {
            setIsLoading(false);
        }
    }, [assetId, tenantId, t]);

    useEffect(() => {
        void fetchProposal();
    }, [fetchProposal]);

    const consolidatedPreviewSlots = useMemo<CanonicalSpecSlot[]>(() => {
        if (!proposal) return [];
        return proposal.axes_diff.map((row) => {
            const hasManual = Object.prototype.hasOwnProperty.call(manualOverrides, row.axis_key);
            const manualVal = hasManual ? manualOverrides[row.axis_key].trim() : null;
            const useSuggested = Boolean(approvedByKey[row.axis_key]);

            let chosenVal: string | null = row.current_value;
            let chosenSource: string | null = null;
            let chosenVerbatim: string | null = null;

            if (hasManual) {
                chosenVal = manualVal && manualVal.length > 0 ? manualVal : null;
            } else if (useSuggested) {
                chosenVal = row.suggested_value;
                chosenSource = row.source_url || null;
                chosenVerbatim = row.verbatim_evidence || null;
            }

            return {
                axis_key: row.axis_key,
                label_es: row.label_es,
                value_si: chosenVal,
                unit_si: row.unit_hint,
                mandatory: row.mandatory,
                is_differentiator: row.is_differentiator,
                source_url: chosenSource,
                verbatim_evidence: chosenVerbatim,
            };
        });
    }, [proposal, approvedByKey, manualOverrides]);

    const previewVectorText = useMemo(() => {
        if (!proposal) return '';
        return buildHomologousEquipmentDescription({
            equipment_type_key: proposal.equipment_type_key,
            archetype_id: proposal.archetype_id,
            tipo_equipo: proposal.proposed_tipo_equipo || proposal.current_tipo_equipo,
            categoria_equipo: proposal.proposed_categoria_equipo,
            canonical_specs: consolidatedPreviewSlots,
        });
    }, [proposal, consolidatedPreviewSlots]);

    const handleSubmitConsolidation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!proposal || confirmWord.trim().toUpperCase() !== 'ACTUALIZAR' || isSaving) return;

        setIsSaving(true);
        setSaveError('');
        try {
            const res = await authFetch(
                `${API_BASE_URL}/assets/catalog/${encodeURIComponent(assetId)}/apply-homologation`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                    },
                    body: JSON.stringify({
                        equipment_type_key: proposal.equipment_type_key,
                        archetype_id: proposal.archetype_id,
                        tipo_equipo: proposal.proposed_tipo_equipo || proposal.current_tipo_equipo,
                        categoria_equipo: proposal.proposed_categoria_equipo,
                        official_url: proposal.official_url || undefined,
                        approved_slots: consolidatedPreviewSlots,
                        confirm_word: 'ACTUALIZAR',
                    }),
                }
            );

            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success) {
                throw new Error(
                    String(json?.message || json?.error || t('opermaq_domains.homologate_error_save'))
                );
            }

            onConsolidated({
                id: String(json.id || assetId),
                equipment_type_key: json.equipment_type_key
                    ? String(json.equipment_type_key)
                    : proposal.equipment_type_key,
                archetype_id: String(json.archetype_id || proposal.archetype_id),
                tipo_equipo: String(json.tipo_equipo || proposal.proposed_tipo_equipo),
                canonical_specs: Array.isArray(json.canonical_specs)
                    ? json.canonical_specs
                    : consolidatedPreviewSlots,
                short_description: String(json.short_description || previewVectorText),
            });
        } catch (err: unknown) {
            setSaveError(
                err instanceof Error ? err.message : t('opermaq_domains.homologate_error_save')
            );
        } finally {
            setIsSaving(false);
        }
    };

    const flatIconBtn =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none flex items-center justify-center';

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 dark:bg-black/85 p-[13px] sm:p-[21px] select-none font-sans"
            onClick={onClose}
        >
            <div
                className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden rounded-none shadow-none"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Cabecera Quirúrgica */}
                <header className="px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between gap-[13px] shrink-0">
                    <div className="min-w-0">
                        <div className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            {t('opermaq_domains.homologate_modal_title')}
                        </div>
                        <div className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {makeOficial} {modelOficial}
                        </div>
                    </div>

                    <div className="flex items-center gap-[8px] shrink-0">
                        {!isLoading && (
                            <button
                                type="button"
                                onClick={() => void fetchProposal()}
                                title={t('opermaq_domains.homologate_retry_btn')}
                                aria-label={t('opermaq_domains.homologate_retry_btn')}
                                className={flatIconBtn}
                            >
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            title={t('common.cancel')}
                            aria-label={t('common.cancel')}
                            className={flatIconBtn}
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </header>

                {/* Cuerpo del Informe Comparativo HITL 1 a 1 */}
                <div className="flex-1 min-h-0 overflow-y-auto p-[21px] flex flex-col gap-[21px]">
                    {isLoading ? (
                        <div className="py-[55px] flex flex-col items-center justify-center gap-[13px]">
                            <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                            <span className="text-[12px] font-mono text-[#475569] dark:text-[#8A93A6]">
                                {t('opermaq_domains.homologate_loading')}
                            </span>
                        </div>
                    ) : loadError ? (
                        <div className="p-[13px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between gap-[13px] rounded-none shadow-none">
                            <span className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] break-words">
                                {loadError}
                            </span>
                            <button
                                type="button"
                                onClick={() => void fetchProposal()}
                                title={t('opermaq_domains.homologate_retry_btn')}
                                aria-label={t('opermaq_domains.homologate_retry_btn')}
                                className={flatIconBtn}
                            >
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                            </button>
                        </div>
                    ) : proposal ? (
                        <form
                            id="catalog-homologation-hitl-form"
                            onSubmit={handleSubmitConsolidation}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex flex-col gap-[21px]"
                        >
                            {/* Arquetipo Mecánico y Avisos de Integridad */}
                            <div className="flex flex-wrap items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.homologate_archetype_label')}
                                    </span>
                                    <span className="text-[13px] font-mono font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {proposal.proposed_tipo_equipo}
                                        {proposal.equipment_type_key ? ` [${proposal.equipment_type_key}]` : ''}
                                    </span>
                                </div>

                                {proposal.had_legacy_marketing_prose && (
                                    <span className="text-[11px] font-mono text-[#C68346]">
                                        {t('opermaq_domains.homologate_legacy_purge_notice')}
                                    </span>
                                )}
                            </div>

                            {proposal.warnings.length > 0 && (
                                <div className="p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] space-y-[8px] rounded-none shadow-none">
                                    {proposal.warnings.map((w, idx) => (
                                        <p
                                            key={idx}
                                            className="text-[12px] font-mono text-[#475569] dark:text-[#8A93A6] leading-snug"
                                        >
                                            {w}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {/* Tabla Comparativa 1 a 1: [Actual] ➔ [Sugerido Grounded] */}
                            <div className="border border-[#E2E8F0] dark:border-[#12151C] overflow-x-auto rounded-none shadow-none">
                                <table className="w-full text-left border-collapse font-mono tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[11px] uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            <th className="p-[13px] font-bold">
                                                {t('opermaq_domains.homologate_col_axis')}
                                            </th>
                                            <th className="p-[13px] font-bold">
                                                {t('opermaq_domains.homologate_col_current')}
                                            </th>
                                            <th className="p-[13px] font-bold">
                                                {t('opermaq_domains.homologate_col_suggested')}
                                            </th>
                                            <th className="p-[13px] font-bold text-right">
                                                {t('opermaq_domains.homologate_col_approve')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] text-[13px]">
                                        {proposal.axes_diff.map((row) => {
                                            const isEditingThis = editingAxisKey === row.axis_key;
                                            const hasManual = Object.prototype.hasOwnProperty.call(
                                                manualOverrides,
                                                row.axis_key
                                            );
                                            const displayedSuggested = hasManual
                                                ? manualOverrides[row.axis_key] || MISSING_AXIS_VALUE
                                                : row.suggested_value || MISSING_AXIS_VALUE;
                                            const canToggleApprove = Boolean(row.suggested_value || hasManual);

                                            return (
                                                <tr
                                                    key={row.axis_key}
                                                    className="bg-[#FFFFFF] dark:bg-[#07090D] align-top"
                                                >
                                                    <td className="p-[13px]">
                                                        <div className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {row.label_es}
                                                        </div>
                                                        <div className="text-[11px] text-[#94A3B8] dark:text-[#5A6072]">
                                                            {row.unit_hint} ·{' '}
                                                            {row.mandatory
                                                                ? t('opermaq_domains.homologate_mandatory_tag')
                                                                : t('opermaq_domains.homologate_optional_tag')}
                                                            {row.is_differentiator
                                                                ? ` · ${t('opermaq_domains.homologate_differentiator_tag')}`
                                                                : ''}
                                                        </div>
                                                    </td>

                                                    <td className="p-[13px] text-[#475569] dark:text-[#8A93A6] select-text">
                                                        {row.current_value ||
                                                            t('opermaq_domains.homologate_axis_not_declared')}
                                                    </td>

                                                    <td className="p-[13px]">
                                                        {isEditingThis ? (
                                                            <div className="flex items-center gap-[8px]">
                                                                <input
                                                                    type="text"
                                                                    value={
                                                                        manualOverrides[row.axis_key] ??
                                                                        row.suggested_value ??
                                                                        row.current_value ??
                                                                        ''
                                                                    }
                                                                    onChange={(e) => {
                                                                        const val = e.target.value;
                                                                        setManualOverrides((prev) => ({
                                                                            ...prev,
                                                                            [row.axis_key]: val,
                                                                        }));
                                                                        setApprovedByKey((prev) => ({
                                                                            ...prev,
                                                                            [row.axis_key]: true,
                                                                        }));
                                                                    }}
                                                                    placeholder={row.unit_hint}
                                                                    autoComplete="off"
                                                                    spellCheck={false}
                                                                    className="flex-1 h-8 px-[8px] bg-[#F8FAFC] dark:bg-[#000000] border border-[#C68346] text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none select-text"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditingAxisKey(null)}
                                                                    title={t('common.confirm')}
                                                                    aria-label={t('common.confirm')}
                                                                    className={flatIconBtn}
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">
                                                                        check
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-[8px]">
                                                                    <span
                                                                        className={
                                                                            row.suggested_value || hasManual
                                                                                ? 'font-semibold text-[#0F172A] dark:text-[#F3F4F6] select-text'
                                                                                : 'text-[#94A3B8] dark:text-[#5A6072]'
                                                                        }
                                                                    >
                                                                        {displayedSuggested}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setEditingAxisKey(row.axis_key)
                                                                        }
                                                                        title={t(
                                                                            'opermaq_domains.homologate_manual_edit_title'
                                                                        )}
                                                                        aria-label={t(
                                                                            'opermaq_domains.homologate_manual_edit_title'
                                                                        )}
                                                                        className={flatIconBtn}
                                                                    >
                                                                        <span className="material-symbols-outlined text-[15px]">
                                                                            edit
                                                                        </span>
                                                                    </button>
                                                                    {row.source_url && !hasManual && (
                                                                        <a
                                                                            href={row.source_url}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            title={t(
                                                                                'opermaq_domains.homologate_source_link'
                                                                            )}
                                                                            aria-label={t(
                                                                                'opermaq_domains.homologate_source_link'
                                                                            )}
                                                                            className="text-[#00AEEF] hover:opacity-80 inline-flex items-center p-0.5"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[15px]">
                                                                                open_in_new
                                                                            </span>
                                                                        </a>
                                                                    )}
                                                                </div>
                                                                {row.verbatim_evidence && !hasManual && (
                                                                    <div className="text-[11px] font-sans text-[#475569] dark:text-[#8A93A6] leading-snug select-text">
                                                                        «{row.verbatim_evidence}»
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>

                                                    <td className="p-[13px]">
                                                        <div className="flex justify-end">
                                                            <M3Switch
                                                                checked={Boolean(approvedByKey[row.axis_key])}
                                                                disabled={!canToggleApprove}
                                                                onChange={(next) =>
                                                                    setApprovedByKey((prev) => ({
                                                                        ...prev,
                                                                        [row.axis_key]: next,
                                                                    }))
                                                                }
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Fuentes Técnicas Consolidadas */}
                            {proposal.grounded_sources.length > 0 && (
                                <div className="space-y-[8px]">
                                    <div className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.homologate_sources_heading')}
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        {proposal.grounded_sources.map((src, idx) => (
                                            <a
                                                key={`${src.uri}_${idx}`}
                                                href={src.uri}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[12px] font-mono text-[#00AEEF] hover:underline truncate select-text"
                                            >
                                                {src.uri}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Vista Previa del Vector Homólogo Resultante */}
                            <div className="p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] space-y-[8px] rounded-none shadow-none">
                                <div className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                    {t('opermaq_domains.homologate_preview_label')}
                                </div>
                                <div className="text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] leading-[1.4] select-text">
                                    {previewVectorText}
                                </div>
                            </div>

                            {saveError && (
                                <div className="p-[13px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none">
                                    {saveError}
                                </div>
                            )}

                            {/* Confirmación Obligatoria por Palabra Clave "ACTUALIZAR" */}
                            <div className="pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col sm:flex-row sm:items-end justify-between gap-[13px]">
                                <div className="flex-1 flex flex-col gap-[8px]">
                                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.homologate_confirm_prompt')}
                                    </label>
                                    <input
                                        type="text"
                                        value={confirmWord}
                                        onChange={(e) => setConfirmWord(e.target.value)}
                                        placeholder="ACTUALIZAR"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="h-10 px-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[13px] font-mono uppercase tracking-[0.08em] text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none shadow-none select-text"
                                    />
                                </div>

                                <div className="flex items-center gap-[13px] shrink-0">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="h-10 px-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] text-[11px] font-mono font-bold uppercase tracking-[0.05em] cursor-pointer rounded-none shadow-none"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            confirmWord.trim().toUpperCase() !== 'ACTUALIZAR' || isSaving
                                        }
                                        className="h-10 px-[21px] border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 disabled:border-[#E2E8F0] dark:disabled:border-[#12151C] disabled:bg-[#F8FAFC] dark:disabled:bg-[#000000] disabled:text-[#94A3B8] dark:disabled:text-[#5A6072] text-[11px] font-mono font-bold uppercase tracking-[0.05em] cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                                    >
                                        {isSaving
                                            ? t('opermaq_domains.homologate_applying')
                                            : t('opermaq_domains.homologate_apply_btn')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default CatalogHomologationHitlModal;

