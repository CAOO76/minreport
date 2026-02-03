import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging tailwind classes safely
 */
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface M3SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    className?: string;
}

/**
 * M3Switch - Material Design 3 Compliant Switch
 * Pure CSS implementation with smooth transitions and premium touch.
 */
export const M3Switch: React.FC<M3SwitchProps> = ({ checked, onChange, disabled, className }) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={cn(
                "group relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#121212]",
                checked
                    ? "bg-indigo-600 dark:bg-indigo-500"
                    : "bg-gray-200 dark:bg-white/10",
                disabled && "opacity-40 cursor-not-allowed grayscale-[0.5]",
                className
            )}
        >
            <span
                className={cn(
                    "pointer-events-none block h-6 w-6 rounded-full bg-white shadow-xl ring-0 transition-all duration-300 ease-in-out",
                    checked ? "translate-x-6 scale-110 shadow-indigo-900/40" : "translate-x-0.5 scale-90 shadow-gray-400/20",
                    "dark:bg-indigo-50"
                )}
            />
            {/* Subtle inner ripple effect on hover */}
            <span className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-10 dark:group-hover:opacity-20 bg-current transition-opacity" />
        </button>
    );
};
