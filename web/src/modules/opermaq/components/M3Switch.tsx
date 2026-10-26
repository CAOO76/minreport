import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface M3SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const M3Switch: React.FC<M3SwitchProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className
}) => {
  return (
    <label className={cn("flex items-center cursor-pointer gap-3 select-none", disabled && "opacity-50 cursor-not-allowed", className)}>
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
          autoComplete="off"
        />
        <div className={cn(
          "w-12 h-6 transition-colors duration-200 ease-in-out border",
          checked ? "bg-copper border-copper" : "bg-transparent border-border-base",
          "rounded-none" // Estricto industrial
        )}>
          <div className={cn(
            "absolute top-1 left-1 w-4 h-4 transition-transform duration-200 ease-in-out",
            checked ? "translate-x-6 bg-white" : "translate-x-0 bg-muted/40",
            "rounded-none" // Estricto industrial
          )} />
        </div>
      </div>
      {label && <span className="text-sm font-medium">{label}</span>}
    </label>
  );
};
