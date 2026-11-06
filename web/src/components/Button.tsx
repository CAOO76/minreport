import clsx from 'clsx';
import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary';
    icon?: string;
    children: ReactNode;
}

export const Button = ({ variant = 'primary', icon, children, className, ...props }: ButtonProps) => {
    return (
        <button
            className={clsx(
                "flex items-center justify-center gap-fib-8 px-fib-21 py-[10px] rounded-none shadow-none font-sans font-semibold transition-colors text-xs uppercase tracking-wider cursor-pointer outline-none",
                variant === 'primary' && "bg-[#C68346] text-[#FFFFFF] hover:bg-[#B0743E] border border-[#C68346]",
                variant === 'secondary' && "bg-transparent text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                className
            )}
            {...props}
        >
            {icon && <span className="material-symbols-outlined text-[18px] select-none">{icon}</span>}
            {children}
        </button>
    );
};
