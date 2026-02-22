import React from 'react';
import clsx from 'clsx';

interface M3SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    label?: string;
    className?: string;
}

export const M3Switch: React.FC<M3SwitchProps> = ({
    checked,
    onChange,
    disabled = false,
    label,
    className
}) => {
    return (
        <label className={clsx(
            "inline-flex items-center gap-3 cursor-pointer select-none group",
            disabled && "opacity-50 cursor-not-allowed",
            className
        )}>
            {label && (
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-black dark:group-hover:text-white transition-colors">
                    {label}
                </span>
            )}

            <div className="relative">
                <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={(e) => !disabled && onChange(e.target.checked)}
                    disabled={disabled}
                />

                {/* Track */}
                <div className={clsx(
                    "w-12 h-7 rounded-full transition-all duration-300 border-2",
                    checked
                        ? "bg-antigravity-accent border-antigravity-accent"
                        : "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600"
                )}>
                    {/* Thumb */}
                    <div className={clsx(
                        "absolute top-1 left-1 w-5 h-5 rounded-full transition-all duration-300 flex items-center justify-center shadow-sm",
                        checked
                            ? "translate-x-5 bg-white scale-110"
                            : "bg-slate-400 dark:bg-slate-600 shadow-none"
                    )}>
                        {checked && (
                            <span className="material-symbols-rounded text-[14px] text-antigravity-accent font-black">check</span>
                        )}
                    </div>
                </div>
            </div>
        </label>
    );
};
