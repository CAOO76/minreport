import React from 'react';

interface M3BadgeProps {
    label: string;
    value: string | number;
    unit?: string;
    variant?: 'primary' | 'secondary' | 'error';
}

export const M3Badge: React.FC<M3BadgeProps> = ({
    label,
    value,
    unit,
    variant = 'primary'
}) => {
    const variantStyles = {
        primary: "bg-antigravity-accent/10 text-antigravity-accent border-antigravity-accent/20",
        secondary: "bg-antigravity-light-surface dark:bg-antigravity-dark-surface text-antigravity-light-muted dark:text-antigravity-dark-muted border-antigravity-light-border dark:border-antigravity-dark-border",
        error: "bg-red-500/10 text-red-500 border-red-500/20"
    };

    return (
        <div className={`m3-badge inline-flex flex-col items-center p-4 rounded-none border ${variantStyles[variant]} w-full transition-all duration-200`}>
            <span className="text-[10px] uppercase tracking-wider font-bold opacity-70 mb-1">{label}</span>
            <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-atkinson leading-none">{value}</span>
                {unit && <span className="text-sm font-bold opacity-80">{unit}</span>}
            </div>
        </div>
    );
};
