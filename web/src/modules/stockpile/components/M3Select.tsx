import React from 'react';

export interface M3SelectOption {
    id: string;
    label: string;
}

export interface M3SelectProps {
    label: string;
    value: string;
    options: M3SelectOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
    helperText?: string;
}

export const M3Select: React.FC<M3SelectProps> = ({
    label,
    value,
    options,
    onChange,
    disabled = false,
    helperText
}) => {
    return (
        <div className="m3-select-container w-full my-4">
            <div className={`m3-select relative flex flex-col w-full ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <select
                    className="m3-select-input w-full h-14 pt-5 pb-1 px-4 text-base 
                        bg-antigravity-light-surface dark:bg-antigravity-dark-surface 
                        text-antigravity-light-text dark:text-antigravity-dark-text 
                        rounded-none border-b border-antigravity-light-border dark:border-antigravity-dark-border 
                        transition-all duration-200 outline-none focus:border-antigravity-accent appearance-none"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    aria-label={label}
                >
                    {options.map(opt => (
                        <option key={opt.id} value={opt.id} className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface">
                            {opt.label}
                        </option>
                    ))}
                </select>

                <label className="m3-select-label absolute left-4 top-2 text-xs scale-90 text-antigravity-light-muted dark:text-antigravity-dark-muted pointer-events-none">
                    {label}
                </label>

                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-antigravity-light-muted dark:text-antigravity-dark-muted">
                    <span className="material-symbols-rounded">arrow_drop_down</span>
                </div>
            </div>

            {helperText && (
                <div className="m3-select-helper mt-1 text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted px-4">
                    {helperText}
                </div>
            )}
        </div>
    );
};
