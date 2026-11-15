import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

export interface M3LinearProgressProps {
    value?: number;
    indeterminate?: boolean;
    ariaLabel?: string;
    className?: string;
}

const INDETERMINATE_STYLE = `
@keyframes m3-linear-indeterminate {
    0% {
        transform: translateX(-100%) scaleX(0.35);
    }
    50% {
        transform: translateX(25%) scaleX(0.6);
    }
    100% {
        transform: translateX(160%) scaleX(0.35);
    }
}
`;

export const M3LinearProgress: React.FC<M3LinearProgressProps> = ({
    value,
    indeterminate,
    ariaLabel,
    className,
}) => {
    const { t } = useTranslation();
    const resolvedAriaLabel = ariaLabel || t('core_common.progress_linear_aria', 'Progreso de operación');
    const isIndeterminate = Boolean(indeterminate || value === undefined);
    const clampedValue = isIndeterminate ? 0 : Math.min(100, Math.max(0, Number.isFinite(value) ? (value as number) : 0));
    const isCompleted = !isIndeterminate && clampedValue >= 100;

    return (
        <div
            role="progressbar"
            aria-label={resolvedAriaLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={isIndeterminate ? undefined : Math.round(clampedValue)}
            className={cn(
                'relative w-full h-[4px] flex items-center gap-[4px] rounded-none shadow-none overflow-hidden select-none',
                className
            )}
        >
            {isIndeterminate ? (
                <>
                    <style>{INDETERMINATE_STYLE}</style>
                    <div className="relative flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] rounded-none overflow-hidden">
                        <div
                            className="absolute inset-y-0 left-0 w-1/2 bg-[#C68346] rounded-none origin-left"
                            style={{ animation: 'm3-linear-indeterminate 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
                        />
                    </div>
                    <span
                        aria-hidden="true"
                        className="w-[4px] h-[4px] shrink-0 bg-[#C68346] rounded-none block"
                    />
                </>
            ) : isCompleted ? (
                <div className="w-full h-full bg-[#00AEEF] rounded-none transition-all duration-300" />
            ) : (
                <>
                    {clampedValue > 0 && (
                        <div
                            className="h-full bg-[#C68346] rounded-none transition-[width] duration-300 ease-out shrink-0"
                            style={{ width: `${clampedValue}%` }}
                        />
                    )}
                    <div className="relative flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] rounded-none flex items-center justify-end">
                        <span
                            aria-hidden="true"
                            className="w-[4px] h-[4px] shrink-0 bg-[#C68346] rounded-none block"
                        />
                    </div>
                </>
            )}
        </div>
    );
};

export default M3LinearProgress;
