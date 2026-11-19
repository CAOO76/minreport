import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { SovereignVoiceInput } from '../../../components/common/SovereignVoiceInput';
import { dataService } from '../core/services/DataService';
import {
    type AiEnrichProposal,
    geolappAiEnrichmentService,
} from '../core/services/GeolappAiEnrichmentService';
import {
    type CopperDomainCode,
    mapCopperDomainToClase,
} from '../core/utils/captureHelpers';
import type { StockpileAsset } from '../core/types/GeolappTypes';

export interface GeolappAiEnrichDrawerProps {
    open: boolean;
    asset: StockpileAsset;
    hideLabUpload?: boolean;
    onClose: () => void;
    onApplied?: (updated: StockpileAsset) => void;
}

const FIELD_LABEL_KEYS: Record<string, { key: string; fallback: string }> = {
    copper_domain: { key: 'registration.copper_domain_label', fallback: 'DOMINIO MINERAL (Cu)' },
    tipo_granulometria: { key: 'scanner.granulometry_label', fallback: 'GRANULOMETRÍA' },
    density_factor: { key: 'manual_capture.fields.density_factor', fallback: 'DENSIDAD (t/m³)' },
    location_ref: { key: 'registration.location_ref_label', fallback: 'REFERENCIA UBICACIÓN' },
    description: { key: 'registration.description_label', fallback: 'DESCRIPCIÓN TÉCNICA' },
    moisture_pct: { key: 'manual_capture.fields.moisture_pct', fallback: 'HUMEDAD w (%)' },
    cu_total_pct: { key: 'manual_capture.fields.cu_total_pct', fallback: 'LEY CuT (%)' },
    cu_soluble_pct: { key: 'manual_capture.fields.cu_soluble_pct', fallback: 'LEY CuS (%)' },
    tml_pct: { key: 'manual_capture.fields.tml_pct', fallback: 'TML (%)' },
    residence_days: { key: 'manual_capture.fields.residence_days', fallback: 'DÍAS RESIDENCIA' },
    peso_romana: { key: 'copper_governance.scale_weight', fallback: 'PESO ROMANA [t]' },
};

export const GeolappAiEnrichDrawer: React.FC<GeolappAiEnrichDrawerProps> = ({
    open,
    asset,
    hideLabUpload = false,
    onClose,
    onApplied,
}) => {
    const { t, i18n } = useTranslation();
    const labInputRef = useRef<HTMLInputElement>(null);

    const [voiceNote, setVoiceNote] = useState('');
    const [labFile, setLabFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [proposals, setProposals] = useState<AiEnrichProposal[]>([]);
    const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
    const [reasoning, setReasoning] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showHitlModal, setShowHitlModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setProposals([]);
        setSelectedFields({});
        setReasoning(null);
        setErrorMsg(null);
    }, [open, asset.id]);

    const formatHumanValue = (field: string, val: string | number): string => {
        const str = String(val);
        if (field === 'copper_domain') {
            return t(`copper_domains.${str}`, str);
        }
        return str;
    };

    const runAnalysis = async () => {
        if (loading) return;
        setLoading(true);
        setErrorMsg(null);
        setReasoning(null);
        try {
            const rawLang = (i18n.resolvedLanguage || i18n.language || 'es').slice(0, 2);
            const locale = rawLang === 'en' || rawLang === 'pt' ? rawLang : 'es';
            const res = await geolappAiEnrichmentService.analyzeForEnrichment({
                asset,
                voiceNoteText: voiceNote,
                labFile,
                locale,
            });
            setProposals(res.proposals);
            const initialSelection: Record<string, boolean> = {};
            res.proposals.forEach((p) => {
                initialSelection[p.field] = true;
            });
            setSelectedFields(initialSelection);
            setReasoning(res.reasoning || null);
            if (!res.verified && res.proposals.length === 0) {
                setErrorMsg(res.reasoning);
            }
        } catch (err: any) {
            setErrorMsg(err?.message || t('ai_enrich.analysis_failed', 'Error ejecutando análisis IA.'));
        } finally {
            setLoading(false);
        }
    };

    const selectedProposals = useMemo(
        () => proposals.filter((p) => selectedFields[p.field]),
        [proposals, selectedFields]
    );

    const hitlDiffs: HitlComparisonDiffItem[] = useMemo(
        () =>
            selectedProposals.map((p) => {
                const labelCfg = FIELD_LABEL_KEYS[p.field];
                return {
                    field: labelCfg ? t(labelCfg.key, labelCfg.fallback) : p.field,
                    current:
                        p.current === '[Pendiente de registro]'
                            ? t('common.pending_record', '[Pendiente de registro]')
                            : formatHumanValue(p.field, p.current),
                    suggested: formatHumanValue(p.field, p.suggested),
                };
            }),
        [selectedProposals, t]
    );

    const handleConfirmHitl = async () => {
        if (selectedProposals.length === 0 || isSaving) return;
        setIsSaving(true);
        setErrorMsg(null);
        try {
            const patch: Partial<StockpileAsset> = {};
            for (const item of selectedProposals) {
                (patch as Record<string, unknown>)[item.field] = item.rawValue;
                if (item.field === 'copper_domain') {
                    patch.clase = mapCopperDomainToClase(item.rawValue as CopperDomainCode);
                }
            }
            const updated = await dataService.updateAssetWithHitl(
                asset.id,
                patch,
                'ACTUALIZAR',
                hitlDiffs
            );
            setShowHitlModal(false);
            onApplied?.(updated);
            onClose();
        } catch (err: any) {
            setErrorMsg(err?.message || t('hitl.save_error', 'Error aplicando cambios HITL.'));
            setShowHitlModal(false);
        } finally {
            setIsSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('ai_enrich.title', 'ASISTENTE IA POST-REGISTRO (HITL)')}
            className="fixed inset-0 z-50 bg-black/70 flex justify-end select-none"
        >
            <div className="w-full max-w-lg h-full bg-[#FFFFFF] dark:bg-[#000000] border-l border-[#E2E8F0] dark:border-[#12151C] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none">
                <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13">
                    <div className="flex items-center gap-fib-8 min-w-0">
                        <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">
                            auto_awesome
                        </span>
                        <h2 className="text-h2-section font-bold uppercase truncate">
                            {t('ai_enrich.title', 'ASISTENTE IA (HITL)')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close_button', 'CERRAR')}
                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </header>

                {loading && (
                    <M3LinearProgress indeterminate ariaLabel={t('ai_enrich.analyzing', 'Analizando')} />
                )}

                <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                    {/* Inputs: Voice Note / Text + Lab Certificate PDF/Image */}
                    <section className="space-y-fib-13">
                        <label className="block space-y-fib-8">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] block">
                                {t('ai_enrich.note_label', 'NOTA DE TERRENO O DICTADO (OPCIONAL)')}
                            </span>
                            <div className="flex items-start gap-fib-8">
                                <textarea
                                    rows={2}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={voiceNote}
                                    onChange={(e) => setVoiceNote(e.target.value)}
                                    placeholder={t(
                                        'ai_enrich.note_placeholder',
                                        'Ej: Mineral oxidado verde en frente norte, colpa gruesa...'
                                    )}
                                    className="flex-1 p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none resize-none"
                                />
                                <SovereignVoiceInput
                                    onTranscript={(txt) =>
                                        setVoiceNote((prev) => (prev ? `${prev} ${txt}` : txt))
                                    }
                                />
                            </div>
                        </label>

                        {!hideLabUpload && (
                            <div className="flex items-center justify-between gap-fib-13 p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                <div className="min-w-0">
                                    <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] block">
                                        {t('ai_enrich.lab_doc_label', 'CERTIFICADO LABORATORIO (PDF / IMG)')}
                                    </span>
                                    <span className="text-data-dense font-mono truncate block text-[#0F172A] dark:text-[#F3F4F6]">
                                        {labFile
                                            ? labFile.name
                                            : t('capture_v2.optional_label', 'OPCIONAL')}
                                    </span>
                                </div>
                                <input
                                    ref={labInputRef}
                                    type="file"
                                    autoComplete="off"
                                    spellCheck={false}
                                    accept="application/pdf,image/webp,image/jpeg,image/png"
                                    onChange={(e) => {
                                        setLabFile(e.target.files?.[0] ?? null);
                                        e.target.value = '';
                                    }}
                                    className="hidden"
                                />
                                <div className="flex items-center gap-fib-8 shrink-0">
                                    {labFile && (
                                        <button
                                            type="button"
                                            onClick={() => setLabFile(null)}
                                            aria-label={t('common.delete_button', 'ELIMINAR')}
                                            className="bg-transparent border-0 outline-none p-1 text-red-500 cursor-pointer rounded-none"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">
                                                delete
                                            </span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => labInputRef.current?.click()}
                                        className="px-fib-13 py-fib-8 border border-[#00AEEF] text-[#00AEEF] text-microcopy font-mono font-bold uppercase bg-transparent cursor-pointer rounded-none"
                                    >
                                        {t('ai_enrich.attach_doc', 'ADJUNTAR')}
                                    </button>
                                </div>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={runAnalysis}
                            disabled={loading}
                            className="w-full h-11 bg-[#00AEEF] hover:bg-[#009ad4] text-white font-mono text-microcopy font-bold uppercase tracking-widest border-0 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-fib-8 rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">psychology</span>
                            <span>
                                {loading
                                    ? t('ai_enrich.analyzing', 'ANALIZANDO...')
                                    : t('ai_enrich.run_button', 'ANALIZAR EVIDENCIA CON IA')}
                            </span>
                        </button>
                    </section>

                    {errorMsg && (
                        <div
                            role="alert"
                            className="p-fib-13 border border-[#C68346] bg-[#C68346]/10 text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                        >
                            {errorMsg}
                        </div>
                    )}

                    {reasoning && proposals.length > 0 && (
                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] border-l-2 border-[#00AEEF] pl-fib-13">
                            {reasoning}
                        </p>
                    )}

                    {/* Granular 1-to-1 HITL Comparison Proposals */}
                    {proposals.length > 0 && (
                        <section className="space-y-fib-8">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#C68346] block">
                                {t('ai_enrich.proposals_title', 'PROPUESTAS GRANULARES ([ACTUAL] ➔ [SUGERIDO])')}
                            </span>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                {proposals.map((p) => {
                                    const cfg = FIELD_LABEL_KEYS[p.field];
                                    const checked = Boolean(selectedFields[p.field]);
                                    return (
                                        <label
                                            key={p.field}
                                            className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] flex items-start gap-fib-13 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                autoComplete="off"
                                                spellCheck={false}
                                                checked={checked}
                                                onChange={(e) =>
                                                    setSelectedFields((prev) => ({
                                                        ...prev,
                                                        [p.field]: e.target.checked,
                                                    }))
                                                }
                                                className="mt-1 accent-[#C68346]"
                                            />
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center justify-between gap-fib-8">
                                                    <span className="text-microcopy font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {cfg ? t(cfg.key, cfg.fallback) : p.field}
                                                    </span>
                                                    <span className="text-microcopy font-mono tabular-nums text-[#00AEEF]">
                                                        {Math.round(p.confidence * 100)}%
                                                    </span>
                                                </div>
                                                <div className="text-data-dense font-mono break-words">
                                                    <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                        {formatHumanValue(p.field, p.current)}
                                                    </span>
                                                    <span className="mx-2 text-[#C68346]">➔</span>
                                                    <span className="text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                                                        {formatHumanValue(p.field, p.suggested)}
                                                    </span>
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </section>
                    )}
                </div>

                {proposals.length > 0 && (
                    <footer className="shrink-0 p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D]">
                        <button
                            type="button"
                            onClick={() => setShowHitlModal(true)}
                            disabled={selectedProposals.length === 0 || isSaving}
                            className="w-full h-12 bg-[#C68346] hover:bg-[#b5753b] text-white font-mono text-microcopy font-bold uppercase tracking-widest border-0 cursor-pointer disabled:opacity-40 rounded-none shadow-none"
                        >
                            {t('ai_enrich.apply_selected', 'APLICAR SELECCIONADOS')} ({selectedProposals.length})
                        </button>
                    </footer>
                )}
            </div>

            <HitlConfirmModal
                open={showHitlModal}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL')}
                description={t(
                    'hitl.modal_description',
                    'Revise los campos aprobados y escriba ACTUALIZAR para consolidar la ficha oficial.'
                )}
                comparisonDiff={hitlDiffs}
                loading={isSaving}
                onConfirm={handleConfirmHitl}
                onCancel={() => setShowHitlModal(false)}
            />
        </div>
    );
};
