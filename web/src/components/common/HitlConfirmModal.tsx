import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import M3CircularProgress from './M3CircularProgress';

export interface HitlComparisonDiffItem {
    field: string;
    current: string;
    suggested: string;
}

export interface HitlConfirmModalProps {
    open: boolean;
    title: string;
    description: string;
    keyword?: string;
    comparisonDiff?: HitlComparisonDiffItem[];
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const HitlConfirmModal: React.FC<HitlConfirmModalProps> = ({
    open,
    title,
    description,
    keyword = 'ACTUALIZAR',
    comparisonDiff,
    confirmLabel,
    cancelLabel,
    loading = false,
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation();
    const [typedKeyword, setTypedKeyword] = useState('');
    const inputId = useId();
    const expectedKeyword = keyword.trim();
    const resolvedConfirmLabel = confirmLabel || t('core_common.confirm', 'CONFIRMAR');
    const resolvedCancelLabel = cancelLabel || t('core_common.cancel', 'CANCELAR');
    const closeAriaLabel = t('core_common.hitl_close_aria', 'Cerrar confirmación HITL');

    useEffect(() => {
        if (open) {
            setTypedKeyword('');
        }
    }, [open]);

    if (!open) {
        return null;
    }

    const normalizedTyped = typedKeyword.trim().toUpperCase();
    const normalizedExpected = expectedKeyword.toUpperCase();
    const isKeywordValid = normalizedTyped === normalizedExpected && expectedKeyword.length > 0;
    const isPartialMatch =
        !isKeywordValid &&
        normalizedTyped.length > 0 &&
        normalizedExpected.startsWith(normalizedTyped);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isKeywordValid && !loading) {
            onConfirm();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-fib-21 bg-black/70 select-none overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${inputId}-title`}
        >
            <div className="w-full max-w-2xl bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] dark:border-[#C68346] rounded-none shadow-none my-auto">
                <header className="flex items-center justify-between px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C] gap-fib-8">
                    <div className="flex items-center gap-fib-8 min-w-0">
                        <span className="material-symbols-outlined text-[22px] text-[#C68346]">verified_user</span>
                        <h3
                            id={`${inputId}-title`}
                            className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6]"
                        >
                            {title}
                        </h3>
                    </div>
                    <div className="flex items-center gap-fib-8 shrink-0">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={loading}
                            aria-label={closeAriaLabel}
                            title={closeAriaLabel}
                            className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#9CA3AF] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none disabled:opacity-40 flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </header>

                <form
                    onSubmit={handleSubmit}
                    autoComplete="off"
                    spellCheck={false}
                    className="p-fib-21 space-y-fib-21"
                >
                    <p className="text-body-main text-[#334155] dark:text-[#CBD5E1]">
                        {description}
                    </p>

                    {comparisonDiff && comparisonDiff.length > 0 && (
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                            <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy uppercase text-[#475569] dark:text-[#9CA3AF]">
                                {t('core_common.hitl_diff_header', 'DIFERENCIAL HITL ([ACTUAL] ➔ [SUGERIDO])')}
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] max-h-[55vh] overflow-y-auto">
                                {comparisonDiff.map((item) => (
                                    <div
                                        key={`${item.field}-${item.current}-${item.suggested}`}
                                        className="px-fib-13 py-fib-13 text-body-main font-mono tabular-nums space-y-1"
                                    >
                                        <div className="text-microcopy uppercase text-[#475569] dark:text-[#9CA3AF]">
                                            {item.field}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-fib-8">
                                            <span className="text-[#475569] dark:text-[#9CA3AF] line-through">
                                                [{item.current}]
                                            </span>
                                            <span className="text-[#C68346]">➔</span>
                                            <span className="text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                                                [{item.suggested}]
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-fib-13">
                        <label
                            htmlFor={inputId}
                            className="block text-data-dense font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]"
                        >
                            {t('core_common.hitl_keyword_prompt', 'INGRESAR PALABRA CLAVE DE AUTORIZACIÓN:')}{' '}
                            <span className="text-[#C68346] select-text">{expectedKeyword}</span>
                        </label>

                        <input
                            id={inputId}
                            type="text"
                            value={typedKeyword}
                            onChange={(e) => setTypedKeyword(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={loading}
                            placeholder={expectedKeyword}
                            className="w-full min-h-[52px] px-fib-13 py-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] focus:outline-none text-body-main font-mono tracking-widest tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text uppercase"
                        />

                        {isKeywordValid && (
                            <p className="text-microcopy font-mono text-[#00AEEF]">
                                {t('core_common.hitl_keyword_ready', 'Palabra válida — listo para confirmar.')}
                            </p>
                        )}
                        {isPartialMatch && (
                            <p className="text-microcopy font-mono text-[#C68346]">
                                {expectedKeyword}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-fib-13 pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={loading}
                            className="min-h-[52px] px-fib-21 py-fib-13 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#9CA3AF] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] font-mono text-data-dense font-semibold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:opacity-40"
                        >
                            {resolvedCancelLabel}
                        </button>
                        <button
                            type="submit"
                            disabled={!isKeywordValid || loading}
                            className={cn(
                                'min-h-[52px] px-fib-21 py-fib-13 font-mono text-data-dense font-bold uppercase tracking-wider rounded-none shadow-none flex items-center gap-fib-8 border transition-colors',
                                isKeywordValid && !loading
                                    ? 'bg-[#C68346] border-[#C68346] text-[#000000] cursor-pointer hover:opacity-90'
                                    : 'bg-[#E2E8F0] dark:bg-[#12151C] border-[#E2E8F0] dark:border-[#12151C] text-[#64748B] dark:text-[#8A93A6] cursor-not-allowed'
                            )}
                        >
                            {loading && (
                                <M3CircularProgress
                                    size={16}
                                    ariaLabel={t('core_common.hitl_processing_aria', 'Procesando confirmación')}
                                />
                            )}
                            <span>{resolvedConfirmLabel}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default HitlConfirmModal;
