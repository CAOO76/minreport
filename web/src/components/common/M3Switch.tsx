import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging tailwind classes safely
 */
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface M3SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    checked: boolean;
    onChange: (checked: boolean) => void;
}

/**
 * M3Switch - Material Design 3 Compliant Switch
 * Pure CSS implementation with smooth transitions and premium touch.
 */
export const M3Switch: React.FC<M3SwitchProps> = ({ checked, onChange, disabled, className, ...props }) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            {...props}
            className={cn(
                "group relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-none border transition-all duration-300 ease-in-out focus-visible:outline-none focus:border-antigravity-accent",
                checked
                    ? "bg-black dark:bg-white border-transparent"
                    : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10",
                disabled && "opacity-40 cursor-not-allowed",
                className
            )}
        >
            <span
                className={cn(
                    "pointer-events-none block h-5 w-5 rounded-none ring-0 transition-all duration-300 ease-in-out",
                    checked
                        ? "translate-x-6 bg-white dark:bg-black"
                        : "translate-x-1 bg-black/20 dark:bg-white/20"
                )}
            />
            {/* Industrial Overlay */}
            <span className="absolute inset-0 rounded-none opacity-0 group-hover:opacity-5 bg-antigravity-accent transition-opacity" />
        </button>
    );
};

export default M3Switch;
