import React from 'react';

export interface M3SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    disabled?: boolean;
}

export const M3Switch: React.FC<M3SwitchProps> = ({
    checked,
    onChange,
    label,
    disabled = false,
}) => {
    const handleChange = () => {
        if (!disabled) {
            onChange(!checked);
        }
    };

    return (
        <div className="m3-switch-container flex items-center justify-between w-full py-2">
            <label className={`m3-switch-label flex items-center justify-between w-full cursor-pointer select-none ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <span className="m3-switch-text text-base text-antigravity-light-text dark:text-antigravity-dark-text">{label}</span>
                <button
                    role="switch"
                    aria-checked={checked}
                    aria-label={label}
                    className={`relative w-12 h-6 rounded-none transition-colors duration-200 outline-none focus:ring-2 focus:ring-antigravity-accent focus:ring-offset-2
                        ${checked ? 'bg-antigravity-accent' : 'bg-antigravity-light-border dark:bg-antigravity-dark-border'}`}
                    onClick={handleChange}
                    disabled={disabled}
                    type="button"
                >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-none bg-white transition-transform duration-200 shadow-sm
                        ${checked ? 'transform translate-x-6' : ''}`}
                    />
                </button>
            </label>
        </div>
    );
};
