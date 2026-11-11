import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    AssetConfigurationProfile,
    DisambiguationFacetGroup,
    OpticalIdentificationSummary,
} from '../../../contracts';
import {
    type EphemeralIdentificationImagePreview,
    formatEphemeralBytes,
    MAX_EPHEMERAL_ID_IMAGES,
    prepareEphemeralIdentificationImage,
} from '../utils/ephemeralIdentificationImageHelper';
import { formatTransmissionCategoryShortEs } from '../utils/opermaqDomainProjection';

interface AssetIdentificationPrecisionPanelProps {
    isOpen: boolean;
    onToggleOpen: () => void;
    clarificationInput: string;
    onClarificationChange: (val: string) => void;
    ephemeralImages: EphemeralIdentificationImagePreview[];
    onAddEphemeralImages: (items: EphemeralIdentificationImagePreview[]) => void;
    onRemoveEphemeralImage: (id: string) => void;
    onApplyPrecisionSearch: () => void;
    isBusy: boolean;
    canTriggerSearch: boolean;
    onError?: (msg: string) => void;
}

export function extractConfigurationBadges(profile?: AssetConfigurationProfile | null): string[] {
    if (!profile) return [];
    const tags: string[] = [];
    if (profile.axle_or_undercarriage_config) {
        tags.push(profile.axle_or_undercarriage_config);
    }
    const txLabel =
        profile.transmission_model_spec || formatTransmissionCategoryShortEs(profile.transmission_category);
    if (txLabel) {
        tags.push(txLabel);
    }
    if (profile.work_body_or_implement) {
        tags.push(profile.work_body_or_implement);
    }
    if (profile.factory_emission_or_grid_spec) {
        tags.push(profile.factory_emission_or_grid_spec);
    }
    return tags;
}

export function candidateMatchesFacetSelections(
    candidate: {
        configuration_profile?: AssetConfigurationProfile | null;
    },
    selections: Record<string, string>
): boolean {
    const p = candidate.configuration_profile;
    for (const [facetKey, selectedVal] of Object.entries(selections)) {
        if (!selectedVal || selectedVal === 'ALL') continue;
        if (!p) return false;
        let actual: string | null | undefined = null;
        if (facetKey === 'axle_config') {
            actual = p.axle_or_undercarriage_config;
        } else if (facetKey === 'transmission') {
            actual =
                p.transmission_model_spec || formatTransmissionCategoryShortEs(p.transmission_category);
        } else if (facetKey === 'work_body') {
            actual = p.work_body_or_implement;
        } else if (facetKey === 'emission_or_spec_origin') {
            actual = p.factory_emission_or_grid_spec;
        } else if (facetKey === 'power_grid') {
            const m = String(p.factory_emission_or_grid_spec || '').match(/\b(50\s*Hz|60\s*Hz|50\s*\/\s*60\s*Hz)\b/i);
            actual = m ? m[1] : null;
        }
        if (!actual || actual.trim().toUpperCase() !== selectedVal.toUpperCase()) {
            return false;
        }
    }
    return true;
}

export const AssetIdentificationPrecisionPanel: React.FC<AssetIdentificationPrecisionPanelProps> = ({
    isOpen,
    onToggleOpen,
    clarificationInput,
    onClarificationChange,
    ephemeralImages,
    onAddEphemeralImages,
    onRemoveEphemeralImage,
    onApplyPrecisionSearch,
    isBusy,
    canTriggerSearch,
    onError,
}) => {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);
    const [isEncoding, setIsEncoding] = useState(false);

    const flatIconBtnClass =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none';

    const ingestFiles = async (fileList: FileList | File[] | null) => {
        if (!fileList) return;
        const remainingSlots = MAX_EPHEMERAL_ID_IMAGES - ephemeralImages.length;
        if (remainingSlots <= 0) return;

        const files = Array.from(fileList)
            .filter((f) => String(f.type || '').startsWith('image/'))
            .slice(0, remainingSlots);
        if (files.length === 0) return;

        setIsEncoding(true);
        try {
            const prepared: EphemeralIdentificationImagePreview[] = [];
            for (const f of files) {
                const item = await prepareEphemeralIdentificationImage(f);
                prepared.push(item);
            }
            if (prepared.length > 0) {
                onAddEphemeralImages(prepared);
            }
        } catch (err: unknown) {
            if (onError && err instanceof Error) {
                onError(err.message);
            }
        } finally {
            setIsEncoding(false);
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) pastedFiles.push(f);
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            void ingestFiles(pastedFiles);
        }
    };

    const hasActiveContext =
        clarificationInput.trim().length > 0 || ephemeralImages.length > 0;

    return (
        <div
            onPaste={handlePaste}
            className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px] shrink-0 flex flex-col gap-[8px]"
        >
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <button
                    type="button"
                    onClick={onToggleOpen}
                    aria-expanded={isOpen}
                    className={`bg-transparent border-0 border-b ${
                        isOpen
                            ? 'border-[#C68346] text-[#C68346]'
                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                    } outline-none py-[4px] px-0 text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none`}
                >
                    {t('registration.precision_toggle_open')}
                </button>

                {ephemeralImages.length > 0 && (
                    <span className="text-[11px] font-mono font-bold tabular-nums uppercase tracking-[0.05em] text-[#00AEEF]">
                        {t('registration.precision_active_count', { count: ephemeralImages.length })}
                    </span>
                )}
            </div>

            {isOpen && (
                <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        void ingestFiles(e.dataTransfer.files);
                    }}
                    className="pt-[8px] flex flex-col gap-[8px]"
                >
                    <label className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                        {t('registration.precision_specs_label')}
                    </label>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-[8px]">
                        <input
                            type="text"
                            value={clarificationInput}
                            onChange={(e) => onClarificationChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && canTriggerSearch && !isBusy) {
                                    e.preventDefault();
                                    onApplyPrecisionSearch();
                                }
                            }}
                            placeholder={t('registration.clarification_input_placeholder')}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex-1 h-9 px-[13px] text-[13px] font-mono tabular-nums bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] outline-none rounded-none shadow-none select-text"
                        />

                        <div className="flex items-center gap-[8px] shrink-0">
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept="image/jpeg,image/png,image/webp"
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(e) => {
                                    void ingestFiles(e.target.files);
                                    e.target.value = '';
                                }}
                                className="hidden"
                            />
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(e) => {
                                    void ingestFiles(e.target.files);
                                    e.target.value = '';
                                }}
                                className="hidden"
                            />

                            <button
                                type="button"
                                disabled={ephemeralImages.length >= MAX_EPHEMERAL_ID_IMAGES || isEncoding || isBusy}
                                onClick={() => fileInputRef.current?.click()}
                                className="px-[13px] h-9 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] disabled:opacity-40 bg-transparent text-[#0F172A] dark:text-[#F3F4F6] text-[11px] font-mono tabular-nums font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                            >
                                {t('registration.precision_attach_btn', {
                                    current: ephemeralImages.length,
                                    max: MAX_EPHEMERAL_ID_IMAGES,
                                })}
                            </button>

                            <button
                                type="button"
                                disabled={ephemeralImages.length >= MAX_EPHEMERAL_ID_IMAGES || isEncoding || isBusy}
                                onClick={() => cameraInputRef.current?.click()}
                                aria-label={t('registration.precision_camera_btn')}
                                title={t('registration.precision_camera_btn')}
                                className={flatIconBtnClass}
                            >
                                <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                            </button>

                            {hasActiveContext && (
                                <button
                                    type="button"
                                    disabled={!canTriggerSearch || isBusy || isEncoding}
                                    onClick={onApplyPrecisionSearch}
                                    className="px-[13px] h-9 border border-[#C68346] bg-[#C68346] text-[#FFFFFF] hover:opacity-90 disabled:opacity-40 text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-opacity cursor-pointer disabled:cursor-not-allowed rounded-none shadow-none"
                                >
                                    {t('registration.precision_apply_btn')}
                                </button>
                            )}
                        </div>
                    </div>

                    {ephemeralImages.length > 0 && (
                        <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
                            {ephemeralImages.map((img) => (
                                <div
                                    key={img.id}
                                    className="flex items-center gap-[8px] pr-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] rounded-none shadow-none"
                                >
                                    <img
                                        src={img.previewObjectUrl}
                                        alt=""
                                        draggable={false}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className="w-10 h-10 object-cover select-none pointer-events-none"
                                    />
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-[11px] font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate max-w-[140px]">
                                            {img.name}
                                        </span>
                                        <span className="text-[10px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            {formatEphemeralBytes(img.originalBytes)} ➔ RAM{' '}
                                            {formatEphemeralBytes(img.ephemeralBytes)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onRemoveEphemeralImage(img.id)}
                                        aria-label={t('common.cancel')}
                                        className={flatIconBtnClass}
                                    >
                                        <span className="material-symbols-outlined text-[15px]">close</span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <p className="text-[11px] text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                        {t('registration.precision_ram_privacy_notice')}
                    </p>
                </div>
            )}
        </div>
    );
};

interface OpticalAndFacetsStripProps {
    opticalSummary: OpticalIdentificationSummary | null;
    facets: DisambiguationFacetGroup[];
    selectedFacets: Record<string, string>;
    onSelectFacetOption: (facetKey: string, optionValue: string) => void;
    onResetFacets: () => void;
    onQuickModelFamilySelect?: (modelQuery: string) => void;
}

export const OpticalAndFacetsStrip: React.FC<OpticalAndFacetsStripProps> = ({
    opticalSummary,
    facets,
    selectedFacets,
    onSelectFacetOption,
    onResetFacets,
    onQuickModelFamilySelect,
}) => {
    const { t } = useTranslation();

    const opticalItems = opticalSummary
        ? [
              opticalSummary.detected_make ? `${opticalSummary.detected_make}` : '',
              opticalSummary.detected_model_or_series ? `${opticalSummary.detected_model_or_series}` : '',
              opticalSummary.wmi_vds_structural_code
                  ? `WMI/VDS: ${opticalSummary.wmi_vds_structural_code}`
                  : '',
              opticalSummary.observed_axle_or_undercarriage || '',
              opticalSummary.observed_transmission || '',
              opticalSummary.observed_work_body_or_implement || '',
              opticalSummary.observed_emission_or_grid || '',
          ].filter(Boolean)
        : [];

    const hasActiveFacetFilter = Object.values(selectedFacets).some((v) => Boolean(v && v !== 'ALL'));

    if (opticalItems.length === 0 && facets.length === 0) {
        return null;
    }

    return (
        <div className="shrink-0 flex flex-col gap-[8px]">
            {opticalItems.length > 0 && (
                <div className="border-l-2 border-[#00AEEF] pl-[13px] py-[4px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                        {t('registration.optical_summary_title')}
                    </span>
                    <p className="text-[12px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                        {opticalItems.join(' · ')}
                    </p>
                </div>
            )}

            {facets.length > 0 && (
                <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px] flex flex-col gap-[8px]">
                    <div className="flex items-center justify-between gap-[8px]">
                        <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                            {t('registration.facets_filter_heading')}
                        </span>
                        {hasActiveFacetFilter && (
                            <button
                                type="button"
                                onClick={onResetFacets}
                                className="bg-transparent border-0 outline-none p-0 text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                            >
                                {t('registration.facets_reset_btn')}
                            </button>
                        )}
                    </div>

                    <div className="flex flex-col gap-[8px]">
                        {facets.map((group) => {
                            const isModelQuickPick = group.facet_key === 'model_family';
                            const activeValue = selectedFacets[group.facet_key] || 'ALL';

                            return (
                                <div
                                    key={group.facet_key}
                                    className="flex flex-wrap items-center gap-[8px]"
                                >
                                    <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] min-w-[130px]">
                                        {group.label_es}:
                                    </span>
                                    <div className="flex flex-wrap gap-[8px]">
                                        {group.options.map((opt) => {
                                            const isSelected = !isModelQuickPick && activeValue === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => {
                                                        if (isModelQuickPick && onQuickModelFamilySelect) {
                                                            onQuickModelFamilySelect(opt.value);
                                                        } else {
                                                            onSelectFacetOption(group.facet_key, opt.value);
                                                        }
                                                    }}
                                                    className={`px-[8px] py-[4px] border text-[11px] font-mono tabular-nums font-bold uppercase tracking-[0.03em] transition-colors cursor-pointer rounded-none shadow-none ${
                                                        isSelected
                                                            ? 'border-[#C68346] bg-[#C68346] text-[#FFFFFF]'
                                                            : 'border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#00AEEF]'
                                                    }`}
                                                >
                                                    {opt.label_es}
                                                    {typeof opt.candidate_count === 'number' && opt.value !== 'ALL'
                                                        ? ` (${opt.candidate_count})`
                                                        : ''}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

