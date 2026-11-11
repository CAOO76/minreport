import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { M3CircularProgress } from './M3ProgressIndicator';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface M3ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  fullWidth?: boolean;
  loading?: boolean;
}

export const M3Button: React.FC<M3ButtonProps> = ({
  children,
  icon,
  variant = 'primary',
  fullWidth = false,
  loading = false,
  className,
  disabled,
  ...props
}) => {
  const variants = {
    primary: 'bg-[#C68346] text-[#FFFFFF] hover:opacity-90 font-bold border border-[#C68346]',
    secondary: 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:opacity-80 border border-[#E2E8F0] dark:border-[#12151C] font-bold',
    outline: 'bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6] hover:border-[#C68346] hover:text-[#C68346]',
    ghost: 'bg-transparent border-0 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] transition-colors uppercase tracking-widest text-[10px] font-black'
  };

  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "flex items-center justify-center gap-[8px] px-[21px] py-[8px] transition-all duration-200 rounded-none shadow-none h-[34px] uppercase tracking-[0.2em] text-[11px]",
        fullWidth && "w-full",
        variants[variant],
        (disabled || loading) && "opacity-50 cursor-not-allowed",
        className
      )}
      {...props}
    >
      {loading ? (
        <M3CircularProgress size={16} strokeWidth={2.5} tone={variant === 'primary' ? 'cyan' : 'copper'} />
      ) : !children && icon ? (
        <span className="material-symbols-outlined notranslate text-[18px]">{icon}</span>
      ) : null}
      {children && <span>{children}</span>}
    </button>
  );
};
