import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { API_BASE_URL } from '../firebase/config';
import type { PillarId } from '../types/vault';
import { authFetch } from '../utils/authFetch';
import { M3CircularProgress } from './M3ProgressIndicator';

type PilotFeedbackCategory =
    | 'AI_KNOWLEDGE_TRAINING'
    | 'CHANGE_REQUEST'
    | 'BUG_CORRECTION'
    | 'FIELD_SIMULATION';

type PilotFeedbackPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface VaultPilotFeedbackBoxProps {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    isSealed?: boolean;
    isTestPilot?: boolean;
}

export const VaultPilotFeedbackBox: React.FC<VaultPilotFeedbackBoxProps> = ({
    globalAssetId,
    pillarId,
    itemId,
    isSealed = false,
    isTestPilot = false,
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState<PilotFeedbackCategory>('AI_KNOWLEDGE_TRAINING');
    const [priority, setPriority] = useState<PilotFeedbackPriority>('MEDIUM');
    const [observation, setObservation] = useState('');
    const [expectedAiBehavior, setExpectedAiBehavior] = useState('');
    const [confirmWord, setConfirmWord] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const requiresHitlKeyword = category === 'AI_KNOWLEDGE_TRAINING';
    const canSubmit =
        !submitting &&
        !isSealed &&
        observation.trim().length >= 3 &&
        (!requiresHitlKeyword || confirmWord.trim().toUpperCase() === 'ACTUALIZAR');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/vault/pilot-feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId,
                    pillarId,
                    itemId,
                    category,
                    priority,
                    observation: observation.trim(),
                    expectedAiBehavior: expectedAiBehavior.trim() || undefined,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || t('pilot_feedback.error_submit'));
            }
            toast.success(
                json.hitlCandidateId
                    ? t('pilot_feedback.toast_success_hitl')
                    : t('pilot_feedback.toast_success_vault')
            );
            setObservation('');
            setExpectedAiBehavior('');
            setConfirmWord('');
            setOpen(false);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('pilot_feedback.toast_error'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col pt-[8px] mt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] select-none">
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                disabled={isSealed}
                className={`w-full flex items-center justify-between px-[13px] py-[8px] bg-transparent border transition-colors rounded-none shadow-none cursor-pointer disabled:opacity-40 ${
                    open || isTestPilot
                        ? 'border-[#00AEEF] text-[#00AEEF]'
                        : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                }`}
                title={t('pilot_feedback.toggle_title')}
            >
                <span className="text-[10px] font-bold uppercase tracking-wider">
                    {t('pilot_feedback.header_title')}
                </span>
                <span className="font-mono text-[10px] font-bold tabular-nums">
                    {open ? '−' : '+'}
                </span>
            </button>

            {open && (
                <form
                    onSubmit={handleSubmit}
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-[8px] p-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col gap-[8px] rounded-none shadow-none"
                >
                    <div className="grid grid-cols-2 gap-[8px]">
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value as PilotFeedbackCategory)}
                            className="px-[8px] py-1 text-[10px] font-mono bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none outline-none focus:border-[#C68346]"
                        >
                            <option value="AI_KNOWLEDGE_TRAINING">{t('pilot_feedback.cat_ai_training')}</option>
                            <option value="FIELD_SIMULATION">{t('pilot_feedback.cat_field')}</option>
                            <option value="CHANGE_REQUEST">{t('pilot_feedback.cat_change')}</option>
                            <option value="BUG_CORRECTION">{t('pilot_feedback.cat_bug')}</option>
                        </select>
                        <select
                            value={priority}
                            onChange={(e) => setPriority(e.target.value as PilotFeedbackPriority)}
                            className="px-[8px] py-1 text-[10px] font-mono bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none outline-none focus:border-[#C68346]"
                        >
                            <option value="LOW">{t('pilot_feedback.prio_low')}</option>
                            <option value="MEDIUM">{t('pilot_feedback.prio_medium')}</option>
                            <option value="HIGH">{t('pilot_feedback.prio_high')}</option>
                            <option value="CRITICAL">{t('pilot_feedback.prio_critical')}</option>
                        </select>
                    </div>

                    <textarea
                        rows={2}
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t('pilot_feedback.observation_placeholder')}
                        className="w-full p-[8px] text-[11px] bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none outline-none focus:border-[#C68346] select-text"
                    />

                    {category === 'AI_KNOWLEDGE_TRAINING' && (
                        <>
                            <textarea
                                rows={2}
                                value={expectedAiBehavior}
                                onChange={(e) => setExpectedAiBehavior(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('pilot_feedback.expected_ai_placeholder')}
                                className="w-full p-[8px] text-[11px] bg-[#F8FAFC] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none outline-none focus:border-[#00AEEF] select-text"
                            />
                            <input
                                type="text"
                                value={confirmWord}
                                onChange={(e) => setConfirmWord(e.target.value.toUpperCase())}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="ACTUALIZAR"
                                className="w-full px-[8px] py-1 text-[10px] font-mono uppercase bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none outline-none focus:border-[#C68346] select-text"
                            />
                        </>
                    )}

                    <div className="flex items-center gap-[8px]">
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer flex items-center justify-center gap-[8px]"
                        >
                            {submitting ? (
                                <M3CircularProgress
                                    size={12}
                                    strokeWidth={2}
                                    indeterminate
                                    tone="copper"
                                    ariaLabel={t('pilot_feedback.submitting_aria')}
                                />
                            ) : (
                                t('pilot_feedback.submit_btn')
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="flex-1 py-1 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                        >
                            {t('pilot_feedback.close_btn')}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

