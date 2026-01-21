import clsx from 'clsx';
import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary';
    icon?: string; // Material Symbol name
    children: ReactNode;
}

export const Button = ({ variant = 'primary', icon, children, className, ...props }: ButtonProps) => {
    return (
        <button
            className={clsx(
                "flex items-center justify-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all text-sm tracking-wide",
                variant === 'primary' && "bg-primary text-white hover:bg-primary-hover border border-transparent",
                variant === 'secondary' && "bg-transparent text-slate-700 dark:text-slate-200 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                className
            )}
            {...props}
        >
            {icon && <span className="material-symbols-rounded text-lg">{icon}</span>}
            {children}
        </button>
    );
};
