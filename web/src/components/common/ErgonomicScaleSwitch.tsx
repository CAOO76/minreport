import React from 'react';
import { useTranslation } from 'react-i18next';
import { useErgonomicScale, type ErgonomicScale } from '../../context/ErgonomicScaleContext';

const SCALES: ErgonomicScale[] = ['100', '125', '150'];

interface ErgonomicScaleSwitchProps {
    compact?: boolean;
}

export const ErgonomicScaleSwitch: React.FC<ErgonomicScaleSwitchProps> = ({ compact = false }) => {
    const { t } = useTranslation();
    const { scale, setScale } = useErgonomicScale();

    return (
        <div
            role="group"
            aria-label={t('core_a11y.scale_group_aria', 'Escala visual adaptativa')}
            className="inline-flex items-center gap-fib-8 bg-transparent border-0 rounded-none shadow-none select-none shrink-0"
        >
            {!compact && (
                <span
                    aria-hidden="true"
                    className="hidden sm:inline-flex items-center text-[#475569] dark:text-[#8A93A6] pr-1"
                >
                    <span className="material-symbols-outlined text-[18px]">text_fields</span>
                </span>
            )}
            {SCALES.map((opt) => {
                const isActive = scale === opt;
                const optLabel = t(`core_a11y.scale_${opt}_label`, `${opt}%`);
                return (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => setScale(opt)}
                        aria-pressed={isActive}
                        aria-label={t('core_a11y.scale_option_aria', {
                            pct: opt,
                            label: optLabel,
                            defaultValue: `Escala de lectura ${opt}% (${optLabel})`,
                        })}
                        title={t('core_a11y.scale_option_aria', {
                            pct: opt,
                            label: optLabel,
                            defaultValue: `Escala de lectura ${opt}% (${optLabel})`,
                        })}
                        className={`min-h-[44px] min-w-[44px] px-1.5 bg-transparent border-0 border-b-2 font-mono text-microcopy tabular-nums rounded-none shadow-none transition-colors cursor-pointer flex items-center justify-center ${
                            isActive
                                ? 'border-b-[#C68346] text-[#C68346] font-bold'
                                : 'border-b-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        {opt}%
                    </button>
                );
            })}
        </div>
    );
};

export default ErgonomicScaleSwitch;
