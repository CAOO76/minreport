import React from 'react';
import { cn } from '../../utils/cn';

export interface M3SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    checked: boolean;
    onChange: (checked: boolean) => void;
}

/**
 * M3Switch - Material Design 3 Compliant Switch
 * Industrial Pure Minimalism: 0px radius, zero shadow, Cobre #C68346 active track.
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
                'group relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-none shadow-none border transition-all duration-300 ease-in-out focus-visible:outline-none focus:border-[#00AEEF]',
                checked
                    ? 'bg-[#C68346] border-[#C68346]'
                    : 'bg-[#E2E8F0] dark:bg-[#12151C] border-[#CBD5E1] dark:border-[#1E2430]',
                disabled && 'opacity-40 cursor-not-allowed',
                className
            )}
        >
            <span
                className={cn(
                    'pointer-events-none block h-5 w-5 rounded-none shadow-none ring-0 transition-all duration-300 ease-in-out',
                    checked
                        ? 'translate-x-6 bg-[#FFFFFF]'
                        : 'translate-x-1 bg-[#475569] dark:bg-[#8A93A6]'
                )}
            />
        </button>
    );
};

export default M3Switch;
