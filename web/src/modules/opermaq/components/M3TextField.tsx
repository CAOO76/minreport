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
    autoComplete = 'off',
    multiline = false,
    rows = 4,
}) => {
    const hasError = Boolean(error);
    const hasValue = value.length > 0;
    const hasLabel = label.trim().length > 0;

    const inputClasses = `w-full ${multiline ? 'py-4 min-h-[120px]' : hasLabel ? 'h-14 pt-5 pb-1' : 'h-12 py-2'} px-4 text-base 
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
                        autoComplete={autoComplete}
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
                        autoComplete={autoComplete}
                        spellCheck={false}
                        aria-label={label || placeholder || 'input'}
                        aria-invalid={hasError}
                    />
                )}
                {hasLabel && (
                    <label className={`absolute left-4 origin-left truncate max-w-[calc(100%-5rem)] pointer-events-none transition-all duration-200 font-bold uppercase tracking-widest select-none
                        ${(hasValue || placeholder) ? 'top-2 text-[10px] scale-90' : 'top-4 text-[10px]'}
                        ${hasError ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6] focus-within:text-[#C68346]'}`}>
                        {label}
                        {required && <span className="text-[#C68346] ml-1">*</span>}
                    </label>
                )}
            </div>

            {error && (
                <div className="mt-1 text-[10px] text-[#C68346] px-4 flex items-center gap-1 uppercase font-bold tracking-tighter">
                    <span className="material-symbols-outlined text-sm">error</span> {error}
                </div>
            )}

            {helperText && !error && (
                <div className="mt-1 text-[10px] text-[#94A3B8] dark:text-[#5A6072] px-4 uppercase font-bold tracking-tighter">
                    {helperText}
                </div>
            )}
        </div>
    );
};
