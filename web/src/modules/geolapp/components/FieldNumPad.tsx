import React from 'react';
import { triggerFieldImpact } from '../core/utils/fieldHaptics';

export interface FieldNumPadProps {
    value: string;
    unit?: string;
    onChange: (nextValue: string) => void;
    onConfirm: () => void;
    onClear?: () => void;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'BACK'] as const;

export const FieldNumPad: React.FC<FieldNumPadProps> = ({
    value,
    unit = 'm',
    onChange,
    onConfirm,
    onClear,
}) => {
    const appendToken = (token: string) => {
        void triggerFieldImpact('LIGHT');
        if (token === 'BACK') {
            onChange(value.slice(0, -1));
            return;
        }
        if (token === '.') {
            if (value.includes('.')) return;
            onChange(value ? `${value}.` : '0.');
            return;
        }
        const next = value === '0' ? token : `${value}${token}`;
        onChange(next.slice(0, 7));
    };

    const bumpValue = (delta: number) => {
        void triggerFieldImpact('LIGHT');
        const curr = Number.parseFloat(value || '0');
        const safeCurr = Number.isFinite(curr) ? curr : 0;
        const next = Math.max(0, Math.round((safeCurr + delta) * 100) / 100);
        onChange(next > 0 ? String(next) : '');
    };

    return (
        <section className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] space-y-fib-8 rounded-none shadow-none select-none">
            <div className="flex items-center justify-between gap-fib-8 px-fib-8 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                <span className="text-kpi-display font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                    {value || '0.0'}{' '}
                    <span className="text-h2-section text-[#C68346]">{unit}</span>
                </span>
                <div className="flex items-center gap-fib-8">
                    <button
                        type="button"
                        onClick={() => bumpValue(0.5)}
                        className="min-w-[52px] min-h-[48px] px-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] font-mono text-microcopy font-bold text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        +0.5
                    </button>
                    <button
                        type="button"
                        onClick={() => bumpValue(1)}
                        className="min-w-[52px] min-h-[48px] px-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] font-mono text-microcopy font-bold text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        +1
                    </button>
                    {onClear && (
                        <button
                            type="button"
                            onClick={() => {
                                void triggerFieldImpact('LIGHT');
                                onClear();
                            }}
                            aria-label="Limpiar"
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] cursor-pointer flex items-center justify-center rounded-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-fib-8">
                {DIGITS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => appendToken(key)}
                        className="min-h-[56px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] active:bg-[#C68346] active:text-white font-mono text-h1-header font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6] flex items-center justify-center cursor-pointer rounded-none transition-colors"
                    >
                        {key === 'BACK' ? (
                            <span className="material-symbols-outlined text-[22px]">backspace</span>
                        ) : (
                            key
                        )}
                    </button>
                ))}
            </div>

            <button
                type="button"
                onClick={() => {
                    void triggerFieldImpact('MEDIUM');
                    onConfirm();
                }}
                aria-label="Aplicar cota"
                className="w-full min-h-[52px] bg-[#00AEEF] hover:bg-[#0096CE] text-white border-0 font-mono text-microcopy font-bold uppercase tracking-widest flex items-center justify-center gap-fib-8 cursor-pointer rounded-none"
            >
                <span className="material-symbols-outlined text-[22px]">check</span>
            </button>
        </section>
    );
};
