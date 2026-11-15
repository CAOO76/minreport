import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

export interface M3CircularProgressProps {
    value?: number;
    indeterminate?: boolean;
    size?: number;
    strokeWidth?: number;
    ariaLabel?: string;
    className?: string;
}

export const M3CircularProgress: React.FC<M3CircularProgressProps> = ({
    value,
    indeterminate,
    size = 24,
    strokeWidth = 3,
    ariaLabel,
    className,
}) => {
    const { t } = useTranslation();
    const resolvedAriaLabel = ariaLabel || t('core_common.progress_circular_aria', 'Indicador de progreso');
    const isIndeterminate = Boolean(indeterminate || value === undefined);
    const clampedValue = isIndeterminate ? 0 : Math.min(100, Math.max(0, Number.isFinite(value) ? (value as number) : 0));
    const isCompleted = !isIndeterminate && clampedValue >= 100;

    const safeSize = Math.max(12, size);
    const safeStroke = Math.max(1.5, Math.min(strokeWidth, safeSize / 3));
    const center = safeSize / 2;
    const radius = Math.max(2, (safeSize - safeStroke) / 2);
    const circumference = 2 * Math.PI * radius;

    const activeLength = isIndeterminate
        ? circumference * 0.65
        : (clampedValue / 100) * circumference;
    const dashArray = `${activeLength} ${circumference}`;
    const dashOffset = isIndeterminate ? 0 : 0;

    return (
        <svg
            role="progressbar"
            aria-label={resolvedAriaLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={isIndeterminate ? undefined : Math.round(clampedValue)}
            width={safeSize}
            height={safeSize}
            viewBox={`0 0 ${safeSize} ${safeSize}`}
            fill="none"
            className={cn('shrink-0 rounded-none shadow-none select-none', className)}
        >
            <circle
                cx={center}
                cy={center}
                r={radius}
                strokeWidth={safeStroke}
                strokeLinecap="butt"
                className="stroke-[#E2E8F0] dark:stroke-[#12151C]"
            />
            <circle
                cx={center}
                cy={center}
                r={radius}
                strokeWidth={safeStroke}
                strokeLinecap="butt"
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${center} ${center})`}
                className={cn(
                    'transition-[stroke-dasharray] duration-300 ease-out',
                    isCompleted ? 'stroke-[#00AEEF]' : 'stroke-[#C68346]'
                )}
            >
                {isIndeterminate && (
                    <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from={`0 ${center} ${center}`}
                        to={`360 ${center} ${center}`}
                        dur="1.05s"
                        repeatCount="indefinite"
                    />
                )}
            </circle>
        </svg>
    );
};

export default M3CircularProgress;
