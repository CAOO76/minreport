import React, { ReactNode } from 'react';

/**
 * MinReport SDK - UI Kit (v2.1)
 * "Ladrillos Lego" para plugins nativos y de terceros.
 * Estética: Elite Industrial Minimalism (Standard: rounded-none, Accent: Copper).
 */

const COPPER_ACCENT = "#C68346";

// --- SDKCard ---
interface SDKCardProps {
    title?: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}

export const SDKCard: React.FC<SDKCardProps> = ({ title, action, children, className = '' }) => {
    return (
        <div className={`bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-none shadow-sm overflow-hidden font-atkinson ${className}`}>
            {(title || action) && (
                <div className="p-4 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-slate-50/50 dark:bg-zinc-800/30">
                    {title && <h3 className="font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-widest text-[10px]">{title}</h3>}
                    {action && <div>{action}</div>}
                </div>
            )}
            <div className="p-5 text-slate-600 dark:text-zinc-400">
                {children}
            </div>
        </div>
    );
};

// --- SDKButton ---
interface SDKButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'copper';
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
    const baseStyles = "px-6 py-2.5 rounded-none font-bold text-xs uppercase tracking-widest transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-atkinson border";

    const variants = {
        primary: "bg-black text-white border-black hover:bg-zinc-800 dark:bg-white dark:text-black dark:border-white dark:hover:bg-zinc-200",
        secondary: "bg-transparent border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800",
        danger: "bg-red-600 text-white border-red-600 hover:bg-red-700",
        copper: `bg-[#C68346] text-white border-[#C68346] hover:bg-[#b3733a]`
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
            disabled={isLoading || props.disabled}
            {...props}
        >
            {isLoading && (
                <svg className="animate-spin h-3 w-3 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
        <div className="flex flex-col gap-1.5 w-full font-atkinson">
            <label className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest ml-0.5">
                {label}
            </label>
            <input
                autoComplete="off"
                className={`bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-none px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-[#C68346] ${error ? 'border-red-500' : ''} ${className}`}
                {...props}
            />
            {error && <span className="text-[9px] text-red-500 font-bold tracking-tight">{error}</span>}
        </div>
    );
};

// --- SDKSwitch (M3 Interface) ---
interface SDKSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
}

export const SDKSwitch: React.FC<SDKSwitchProps> = ({ checked, onChange, label, disabled = false }) => {
    return (
        <label className={`flex items-center gap-3 cursor-pointer select-none font-atkinson ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
            <div className="relative">
                <input 
                    type="checkbox" 
                    className="sr-only" 
                    checked={checked} 
                    onChange={e => !disabled && onChange(e.target.checked)}
                    disabled={disabled}
                />
                <div className={`w-10 h-5 transition-colors duration-200 border ${checked ? 'bg-[#C68346] border-[#C68346]' : 'bg-slate-200 dark:bg-zinc-800 border-slate-300 dark:border-zinc-700'}`}></div>
                <div className={`absolute left-0.5 top-0.5 w-4 h-4 transition-transform duration-200 ${checked ? 'translate-x-5 bg-white' : 'translate-x-0 bg-white dark:bg-zinc-400'}`}></div>
            </div>
            {label && <span className="text-xs font-medium text-slate-700 dark:text-zinc-300 uppercase tracking-wider">{label}</span>}
        </label>
    );
};

// --- SDKBadge ---
interface SDKBadgeProps {
    children: ReactNode;
    type?: 'info' | 'success' | 'warning' | 'error' | 'copper';
}

export const SDKBadge: React.FC<SDKBadgeProps> = ({ children, type = 'info' }) => {
    const styles = {
        info: "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-700",
        success: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/30",
        warning: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/30",
        error: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/30",
        copper: "bg-[#C68346]/10 text-[#C68346] border-[#C68346]/20"
    };

    return (
        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border rounded-none ${styles[type]} font-atkinson`}>
            {children}
        </span>
    );
};

// --- SDKMetric ---
interface SDKMetricProps {
    label: string;
    value: string | number;
    unit?: string;
    trend?: { value: number; isUp: boolean };
}

export const SDKMetric: React.FC<SDKMetricProps> = ({ label, value, unit, trend }) => {
    return (
        <div className="font-atkinson p-4 border border-slate-100 dark:border-zinc-800 bg-slate-50/30 dark:bg-zinc-900/30 rounded-none">
            <p className="text-[9px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
            <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{value}</span>
                {unit && <span className="text-[10px] font-medium text-slate-500 dark:text-zinc-400">{unit}</span>}
            </div>
            {trend && (
                <p className={`text-[9px] font-bold mt-1 ${trend.isUp ? 'text-emerald-600' : 'text-red-600'}`}>
                    {trend.isUp ? '↑' : '↓'} {trend.value}%
                </p>
            )}
        </div>
    );
};

// --- SDKIcon ---
interface SDKIconProps {
    name: string;
    size?: number;
    className?: string;
}

export const SDKIcon: React.FC<SDKIconProps> = ({ name, size = 20, className = '' }) => {
    return (
        <span 
            className={`material-symbols-rounded pointer-events-none select-none ${className}`}
            style={{ fontSize: size, fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
        >
            {name}
        </span>
    );
};
