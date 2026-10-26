import React from 'react';

export interface SDKButtonProps {
    variant?: 'primary' | 'secondary' | 'tertiary';
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
    fullWidth?: boolean;
    type?: 'button' | 'submit' | 'reset';
    className?: string;
}

export const SDKButton: React.FC<SDKButtonProps> = ({
    variant = 'primary',
    onClick,
    children,
    disabled = false,
    fullWidth = false,
    type = 'button',
    className = '',
}) => {
    const baseStyles = "inline-flex items-center justify-center min-h-[40px] px-6 py-2 rounded-none font-bold text-sm uppercase tracking-wide transition-all duration-200 select-none active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100";

    const variants = {
        primary: "bg-antigravity-accent text-white hover:opacity-90",
        secondary: "bg-transparent border border-antigravity-light-border dark:border-antigravity-dark-border text-antigravity-accent hover:bg-antigravity-accent/5",
        tertiary: "bg-transparent text-antigravity-accent hover:bg-antigravity-accent/5 px-3"
    };

    return (
        <button
            type={type}
            className={`${baseStyles} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
            onClick={onClick}
            disabled={disabled}
        >
            <span className="flex items-center gap-2">{children}</span>
        </button>
    );
};
