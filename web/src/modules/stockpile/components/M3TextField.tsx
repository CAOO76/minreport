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
                    className={`m3-text-field-input w-full h-14 pt-5 pb-1 px-4 text-base 
                        bg-antigravity-light-surface dark:bg-antigravity-dark-surface 
                        text-antigravity-light-text dark:text-antigravity-dark-text 
                        rounded-none shadow-none border transition-all duration-200 outline-none
                        ${hasError
                            ? 'border-red-500'
                            : 'border-antigravity-light-input dark:border-antigravity-dark-border focus:border-antigravity-accent dark:focus:border-antigravity-accent'
                        }`}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder || ' '}
                    required={required}
                    autoComplete={autoComplete || "off"}
                    spellCheck={false}
                    aria-label={label}
                    aria-invalid={hasError}
                />
                <label className={`m3-text-field-label absolute left-4 pointer-events-none transition-all duration-200
                    ${(hasValue || placeholder) ? 'top-2 text-xs scale-90' : 'top-4 text-base'}
                    ${hasError ? 'text-red-500' : 'text-antigravity-light-muted dark:text-antigravity-dark-muted focus-within:text-antigravity-accent'}`}>
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                </label>
            </div>

            {error && (
                <div className="m3-text-field-error mt-1 text-xs text-red-500 px-4 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">error</span> {error}
                </div>
            )}

            {helperText && !error && (
                <div className="m3-text-field-helper mt-1 text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted px-4">
                    {helperText}
                </div>
            )}
        </div>
    );
};
