import React from 'react';

interface M3SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
    options: { value: string; label: string }[];
}

export const M3Select: React.FC<M3SelectProps> = ({ label, options, className, ...props }) => {
    return (
        <div className="space-y-1.5 w-full">
            <label className="text-[10px] font-black uppercase tracking-widest text-black/40 dark:text-white/20 ml-1">
                {label}
            </label>
            <div className="relative">
                <select 
                    {...props}
                    className={`w-full bg-black/5 dark:bg-white/5 border-b-2 border-black/10 dark:border-white/10 p-4 text-[11px] font-black uppercase tracking-widest outline-none focus:border-copper transition-colors appearance-none cursor-pointer rounded-none text-black dark:text-white ${className}`}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-white dark:bg-[#1a1a1a]">
                            {opt.label}
                        </option>
                    ))}
                </select>
                <span className="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none text-black/20 dark:text-white/20">
                    expand_more
                </span>
            </div>
        </div>
    );
};

export default M3Select;
