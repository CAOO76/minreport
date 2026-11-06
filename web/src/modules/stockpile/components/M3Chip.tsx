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
    variant = 'assist',
    selected = false,
    onClick,
    className
}) => {
    return (
        <div
            onClick={onClick}
            className={clsx(
                "inline-flex items-center gap-[8px] px-[13px] py-[8px] rounded-none shadow-none text-[13px] font-medium transition-colors duration-200 cursor-pointer select-none",
                {
                    'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C]':
                        (variant === 'assist' || variant === 'filter' || variant === 'input' || variant === 'suggestion') && !selected,
                    'bg-[#C68346]/15 text-[#C68346] border border-[#C68346]': selected,
                },
                className
            )}
        >
            <span>{label}</span>
        </div>
    );
};
