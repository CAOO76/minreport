import React from 'react';
import clsx from 'clsx';

interface M3ChipProps {
    label: string;
    icon?: string;
    variant?: 'assist' | 'filter' | 'input' | 'suggestion';
    selected?: boolean;
    onClick?: () => void;
    className?: string;
}

export const M3Chip: React.FC<M3ChipProps> = ({
    label,
    icon,
    variant = 'assist',
    selected = false,
    onClick,
    className
}) => {
    return (
        <div
            onClick={onClick}
            className={clsx(
                "inline-flex items-center gap-2 px-4 py-1.5 rounded-none text-sm font-medium transition-all duration-200 cursor-pointer select-none",
                // Variantes básicas
                {
                    'bg-[rgba(28,27,31,0.8)] text-white backdrop-blur-sm shadow-lg border border-white/10': variant === 'assist',
                    'bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border': variant === 'filter' && !selected,
                    'bg-antigravity-accent/20 text-antigravity-accent border border-antigravity-accent': selected,
                },
                className
            )}
        >
            {icon && <span className="material-symbols-rounded text-lg">{icon}</span>}
            <span>{label}</span>
        </div>
    );
};
