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
    autoComplete = 'off',
    multiline = false,
    rows = 4,
}) => {
    const hasError = Boolean(error);
    const hasValue = value.length > 0;

    const inputClasses = `w-full ${multiline ? 'py-4 min-h-[120px]' : 'h-14 pt-5 pb-1'} px-4 text-base 
        bg-surface border transition-all duration-200 outline-none rounded-none
        ${hasError
            ? 'border-red-500 text-red-500'
            : 'border-border-base text-foreground focus:border-copper'
        }`;

    return (
        <div className={`w-full my-4 ${className}`}>
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
                        aria-label={label}
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
                        aria-label={label}
                        aria-invalid={hasError}
                    />
                )}
                <label className={`absolute left-4 pointer-events-none transition-all duration-200 font-bold uppercase tracking-widest
                    ${(hasValue || placeholder) ? 'top-2 text-[10px] scale-90' : 'top-4 text-[10px]'}
                    ${hasError ? 'text-red-500' : 'text-muted focus-within:text-copper'}`}>
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                </label>
            </div>

            {error && (
                <div className="mt-1 text-[10px] text-red-500 px-4 flex items-center gap-1 uppercase font-bold tracking-tighter">
                    <span className="material-symbols-outlined text-sm">error</span> {error}
                </div>
            )}

            {helperText && !error && (
                <div className="mt-1 text-[10px] text-black/20 dark:text-white/20 px-4 uppercase font-bold tracking-tighter">
                    {helperText}
                </div>
            )}
        </div>
    );
};
