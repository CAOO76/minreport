import React, { ReactNode } from 'react';

/**
 * MinReport SDK - UI Kit
 * "Ladrillos Lego" para plugins nativos.
 * Estética: Minimalista Industrial, Atkinson Hyperlegible, Soporte Dark Mode.
 */

// --- SDKCard ---
interface SDKCardProps {
    title?: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}

export const SDKCard: React.FC<SDKCardProps> = ({ title, action, children, className = '' }) => {
    return (
        <div className={`bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden font-atkinson ${className}`}>
            {(title || action) && (
                <div className="p-5 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center">
                    {title && <h3 className="font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-tight text-sm">{title}</h3>}
                    {action && <div>{action}</div>}
                </div>
            )}
            <div className="p-6 text-slate-600 dark:text-zinc-400">
                {children}
            </div>
        </div>
    );
};

// --- SDKButton ---
interface SDKButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger';
    isLoading?: boolean;
    fullWidth?: boolean;
    children: ReactNode;
}

export const SDKButton: React.FC<SDKButtonProps> = ({
    variant = 'primary',
    isLoading = false,
    fullWidth = false,
    children,
    className = '',
    ...props
}) => {
    const baseStyles = "px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-atkinson";

    const variants = {
        primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-500/10",
        secondary: "bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700",
        danger: "bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-500/10"
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
            disabled={isLoading || props.disabled}
            {...props}
        >
            {isLoading && (
                <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            )}
            {children}
        </button>
    );
};

// --- SDKInput ---
interface SDKInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    error?: string;
}

export const SDKInput: React.FC<SDKInputProps> = ({ label, error, className = '', ...props }) => {
    return (
        <div className="flex flex-col gap-2 w-full font-atkinson">
            <label className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest ml-1">
                {label}
            </label>
            <input
                className={`bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${error ? 'border-red-500 ring-1 ring-red-500' : ''} ${className}`}
                {...props}
            />
            {error && <span className="text-[10px] text-red-500 font-bold ml-1">{error}</span>}
        </div>
    );
};
