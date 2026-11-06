import React from 'react';

interface M3SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
    options: { value: string; label: string }[];
}

export const M3Select: React.FC<M3SelectProps> = ({ label, options, className, ...props }) => {
    return (
        <div className="space-y-1.5 w-full">
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6] ml-1">
                {label}
            </label>
            <div className="relative">
                <select 
                    {...props}
                    className={`w-full bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-3 text-[11px] font-mono font-bold uppercase tracking-wider outline-none focus:border-[#C68346] transition-colors appearance-none cursor-pointer rounded-none text-[#0F172A] dark:text-[#F3F4F6] ${className}`}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-white dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6]">
                            {opt.label}
                        </option>
                    ))}
                </select>
                <span className="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none text-[#475569] dark:text-[#8A93A6] !text-[18px]">
                    expand_more
                </span>
            </div>
        </div>
    );
};

export default M3Select;
