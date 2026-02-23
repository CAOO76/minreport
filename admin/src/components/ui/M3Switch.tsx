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
                "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-none border transition-all duration-200 outline-none",
                checked
                    ? "bg-black dark:bg-white border-transparent"
                    : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10",
                disabled && "opacity-40 cursor-not-allowed",
                className
            )}
        >
            <span
                className={clsx(
                    "pointer-events-none block h-5 w-5 rounded-none ring-0 transition-transform duration-200",
                    checked
                        ? "translate-x-6 bg-white dark:bg-black"
                        : "translate-x-1 bg-black/20 dark:bg-white/20"
                )}
            />
        </button>
    );
};
