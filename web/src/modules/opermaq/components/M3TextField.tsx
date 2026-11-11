import React from 'react';

export interface M3TextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'number' | 'date' | 'time' | 'email' | 'password';
    required?: boolean;
    disabled?: boolean;
    error?: string;
    placeholder?: string;
    helperText?: string;
    className?: string;
    inputClassName?: string;
    autoComplete?: string;
    multiline?: boolean;
    rows?: number;
}

export const M3TextField: React.FC<M3TextFieldProps> = ({
    label,
    value,
    onChange,
    type = 'text',
    required = false,
    disabled = false,
    error,
    placeholder,
    helperText,
    className = '',
    inputClassName = '',
    multiline = false,
    rows = 4,
}) => {
    const hasError = Boolean(error);
    const hasValue = value.length > 0;
    const hasLabel = label.trim().length > 0;

    const inputClasses = `w-full ${multiline ? 'py-[13px] min-h-[89px]' : hasLabel ? 'h-[55px] pt-[21px] pb-[8px]' : 'h-[34px] py-[8px]'} px-[13px] text-base 
        bg-[#FFFFFF] dark:bg-[#07090D] border transition-all duration-200 outline-none rounded-none shadow-none select-text
        ${hasError
            ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
            : 'border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6] focus:border-[#C68346]'
        } ${inputClassName}`;

    return (
        <div className={`w-full my-[13px] ${className}`}>
            <div className={`relative flex flex-col w-full ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                {multiline ? (
                    <textarea
                        className={inputClasses}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder || ' '}
                        required={required}
                        disabled={disabled}
                        rows={rows}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={label || placeholder || 'input'}
                        aria-invalid={hasError}
                    />
                ) : (
                    <input
                        type={type}
                        className={inputClasses}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder || ' '}
                        required={required}
                        disabled={disabled}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={label || placeholder || 'input'}
                        aria-invalid={hasError}
                    />
                )}
                {hasLabel && (
                    <label className={`absolute left-[13px] origin-left truncate max-w-[calc(100%-5rem)] pointer-events-none transition-all duration-200 font-bold uppercase tracking-widest select-none
                        ${(hasValue || placeholder) ? 'top-[8px] text-[10px] scale-90' : 'top-[13px] text-[10px]'}
                        ${hasError ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6] focus-within:text-[#C68346]'}`}>
                        {label}
                        {required && <span className="text-[#C68346] ml-[8px]">*</span>}
                    </label>
                )}
            </div>

            {error && (
                <div className="mt-[8px] text-[10px] text-[#C68346] px-[13px] flex items-center gap-[8px] uppercase font-bold tracking-tighter">
                    <span className="material-symbols-outlined text-sm">error</span> {error}
                </div>
            )}

            {helperText && !error && (
                <div className="mt-[8px] text-[10px] text-[#94A3B8] dark:text-[#5A6072] px-[13px] uppercase font-bold tracking-tighter">
                    {helperText}
                </div>
            )}
        </div>
    );
};
