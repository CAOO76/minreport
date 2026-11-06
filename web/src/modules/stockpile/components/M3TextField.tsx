import React from 'react';

export interface M3TextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'number' | 'date' | 'time' | 'email';
    required?: boolean;
    disabled?: boolean;
    error?: string;
    placeholder?: string;
    helperText?: string;
    autoComplete?: string;
    className?: string;
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
    autoComplete,
    className = '',
}) => {
    const hasError = Boolean(error);
    const hasValue = value.length > 0;

    return (
        <div className={`m3-text-field-container w-full my-4 ${className}`}>
            <div className={`m3-text-field relative flex flex-col w-full ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <input
                    type={type}
                    disabled={disabled}
                    className={`m3-text-field-input w-full h-14 pt-5 pb-1 px-4 text-base 
                        bg-[#F8FAFC] dark:bg-[#07090D] 
                        text-[#0F172A] dark:text-[#F3F4F6] 
                        ${type === 'number' ? 'tabular-nums font-mono' : ''}
                        rounded-none shadow-none border transition-colors duration-200 outline-none
                        ${hasError
                            ? 'border-[#C68346]'
                            : 'border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] dark:focus:border-[#C68346]'
                        }`}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder || ' '}
                    required={required}
                    autoComplete={autoComplete || 'off'}
                    spellCheck={false}
                    aria-label={label}
                    aria-invalid={hasError}
                />
                <label className={`m3-text-field-label absolute left-4 pointer-events-none transition-all duration-200
                    ${(hasValue || placeholder) ? 'top-2 text-xs scale-90' : 'top-4 text-base'}
                    ${hasError ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6] focus-within:text-[#C68346]'}`}>
                    {label}
                    {required && <span className="text-[#C68346] ml-1">*</span>}
                </label>
            </div>

            {error && (
                <div className="m3-text-field-error mt-1 text-xs text-[#C68346] px-4">
                    {error}
                </div>
            )}

            {helperText && !error && (
                <div className="m3-text-field-helper mt-1 text-xs text-[#475569] dark:text-[#8A93A6] px-4">
                    {helperText}
                </div>
            )}
        </div>
    );
};
