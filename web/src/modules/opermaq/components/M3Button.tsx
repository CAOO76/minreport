import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
    primary: 'bg-copper text-white hover:opacity-90 font-bold',
    secondary: 'bg-surface text-foreground hover:opacity-80 border border-border-base font-bold',
    outline: 'border border-border-base text-foreground hover:border-copper hover:text-copper',
    ghost: 'text-muted hover:text-copper transition-colors uppercase tracking-widest text-[10px] font-black'
  };

  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "flex items-center justify-center gap-2 px-6 py-3 transition-all duration-200 rounded-none h-12 uppercase tracking-[0.2em] text-[11px]",
        fullWidth && "w-full",
        variants[variant],
        (disabled || loading) && "opacity-50 cursor-not-allowed",
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined notranslate text-[18px] animate-spin">progress_activity</span>
      ) : icon && (
        <span className="material-symbols-outlined notranslate text-[18px]">{icon}</span>
      )}
      {children && <span>{children}</span>}
    </button>
  );
};
