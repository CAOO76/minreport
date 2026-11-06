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
          "w-12 h-6 transition-colors duration-200 ease-in-out border rounded-none shadow-none",
          checked
            ? "bg-[#C68346] border-[#C68346]"
            : "bg-[#F8FAFC] dark:bg-[#07090D] border-[#E2E8F0] dark:border-[#12151C]"
        )}>
          <div className={cn(
            "absolute top-1 left-1 w-4 h-4 transition-transform duration-200 ease-in-out rounded-none shadow-none",
            checked ? "translate-x-6 bg-[#000000]" : "translate-x-0 bg-[#475569] dark:bg-[#8A93A6]"
          )} />
        </div>
      </div>
      {label && <span className="text-sm font-medium text-[#0F172A] dark:text-[#F3F4F6]">{label}</span>}
    </label>
  );
};
