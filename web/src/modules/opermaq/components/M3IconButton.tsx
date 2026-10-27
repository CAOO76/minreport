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
    primary: 'bg-transparent border-0 outline-none p-1 text-[#C68346] hover:text-[#C68346]/80 transition-colors cursor-pointer',
    secondary: 'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer',
    ghost: 'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer'
  };

  return (
    <button
      className={cn(
        "flex items-center justify-center rounded-none shadow-none w-9 h-9 shrink-0",
        variants[variant],
        className
      )}
      {...props}
    >
      <span className="material-symbols-outlined notranslate">{icon}</span>
    </button>
  );
};
