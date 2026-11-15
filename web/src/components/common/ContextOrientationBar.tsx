import React from 'react';
import { useTranslation } from 'react-i18next';
import ErgonomicScaleSwitch from './ErgonomicScaleSwitch';

export interface ContextOrientationBarProps {
    trail: string[];
    onBack?: () => void;
    backLabel?: string;
    rightActions?: React.ReactNode;
    includeScaleSwitch?: boolean;
    compact?: boolean;
    hidden?: boolean;
}

export const ContextOrientationBar: React.FC<ContextOrientationBarProps> = ({
    trail,
    onBack,
    backLabel,
    rightActions,
    includeScaleSwitch = true,
    compact = false,
    hidden = false,
}) => {
    const { t } = useTranslation();
    if (hidden) return null;

    const cleanedTrail = trail.map((item) => item.trim()).filter(Boolean);
    const resolvedBackLabel = backLabel || t('core_orientation.back_btn', 'Volver');

    return (
        <div
            role="region"
            aria-label={t('core_orientation.bar_aria', 'Ubicación actual y controles de lectura')}
            className={`w-full min-h-[40px] bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none select-none flex flex-wrap items-center justify-between gap-fib-13 ${
                compact ? 'px-fib-13 py-1' : 'px-fib-21 py-1'
            }`}
        >
            <div className="flex items-center gap-fib-13 min-w-0 flex-1">
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={resolvedBackLabel}
                        title={resolvedBackLabel}
                        className="min-w-[40px] min-h-[40px] p-1 bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] transition-colors cursor-pointer inline-flex items-center justify-center rounded-none shadow-none shrink-0"
                    >
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                )}

                <nav
                    aria-label={t('core_orientation.breadcrumb_aria', 'Ruta de pantalla')}
                    className="min-w-0 flex items-center flex-wrap gap-fib-8"
                >
                    {cleanedTrail.map((segment, index) => {
                        const isLast = index === cleanedTrail.length - 1;
                        return (
                            <React.Fragment key={`${segment}-${index}`}>
                                {index > 0 && (
                                    <span
                                        aria-hidden="true"
                                        className="text-microcopy font-mono text-[#C68346]"
                                    >
                                        /
                                    </span>
                                )}
                                <span
                                    className={
                                        isLast
                                            ? 'text-microcopy font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wider'
                                            : 'text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider'
                                    }
                                >
                                    {segment}
                                </span>
                            </React.Fragment>
                        );
                    })}
                </nav>
            </div>

            {(rightActions || includeScaleSwitch) && (
                <div className="flex items-center gap-fib-8 shrink-0 flex-wrap">
                    {rightActions}
                    {includeScaleSwitch && <ErgonomicScaleSwitch compact={compact} />}
                </div>
            )}
        </div>
    );
};

export default ContextOrientationBar;
