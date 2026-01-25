import React from 'react';
import clsx from 'clsx';

interface M3SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    className?: string;
}

export const M3Switch: React.FC<M3SwitchProps> = ({ checked, onChange, disabled, className }) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={clsx(
                "relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 outline-none",
                checked
                    ? "bg-antigravity-accent dark:bg-antigravity-accent"
                    : "bg-slate-200 dark:bg-slate-700",
                disabled && "opacity-50 cursor-not-allowed",
                className
            )}
        >
            <span
                className={clsx(
                    "pointer-events-none block h-6 w-6 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200",
                    checked ? "translate-x-7" : "translate-x-1"
                )}
            />
        </button>
    );
};
