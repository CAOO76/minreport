import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface M3IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const M3IconButton: React.FC<M3IconButtonProps> = ({
  icon,
  variant = 'ghost',
  className,
  ...props
}) => {
  const variants = {
    primary: 'bg-copper text-white hover:bg-copper/90',
    secondary: 'bg-surface text-foreground hover:opacity-80 border border-border-base',
    ghost: 'text-muted hover:text-copper transition-colors'
  };

  return (
    <button
      className={cn(
        "flex items-center justify-center transition-all duration-200 rounded-none w-10 h-10 shrink-0",
        variants[variant],
        className
      )}
      {...props}
    >
      <span className="material-symbols-outlined notranslate">{icon}</span>
    </button>
  );
};
