import React from 'react';

/**
 * MinReport SDK - UI Kit (Refined)
 * Design Tokens: Minimalismo Industrial y Alta Legibilidad
 * Tipografía: Atkinson Hyperlegible
 * Estilo: Flat Design Estricto (Sin degradados ni sombras)
 */

const TOKENS = {
    primary: '#111827',
    background: '#FFFFFF',
    border: '#E5E7EB',
    error: '#EF4444',
    textMuted: '#6B7280',
    fontFamily: "'Atkinson Hyperlegible', sans-serif"
};

const baseTextStyle: React.CSSProperties = {
    fontFamily: TOKENS.fontFamily,
    color: TOKENS.primary,
    WebkitFontSmoothing: 'antialiased'
};

/**
 * SDKButton
 * Props: variant ('primary' | 'secondary' | 'danger'), fullWidth, onClick, children.
 */
interface SDKButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger';
    fullWidth?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
    isLoading?: boolean;
}

export const SDKButton: React.FC<SDKButtonProps> = ({
    variant = 'primary',
    fullWidth = false,
    children,
    style = {},
    isLoading = false,
    ...props
}: SDKButtonProps) => {
    let backgroundColor = TOKENS.primary;
    let color = TOKENS.background;
    let border = `1px solid ${TOKENS.primary}`;

    if (variant === 'secondary') {
        backgroundColor = TOKENS.background;
        color = TOKENS.primary;
        border = `1px solid ${TOKENS.border}`;
    } else if (variant === 'danger') {
        backgroundColor = TOKENS.error;
        color = TOKENS.background;
        border = `1px solid ${TOKENS.error}`;
    }

    // Adjust styles for disabled/loading state
    if (isLoading || props.disabled) {
        backgroundColor = TOKENS.border;
        color = TOKENS.textMuted;
        border = `1px solid ${TOKENS.border}`;
    }

    const buttonStyle: React.CSSProperties = {
        ...baseTextStyle,
        width: fullWidth ? '100%' : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px 24px',
        borderRadius: '8px',
        fontWeight: '700',
        fontSize: '14px',
        cursor: (isLoading || props.disabled) ? 'not-allowed' : 'pointer',
        transition: 'opacity 0.2s ease',
        backgroundColor,
        color,
        border,
        outline: 'none',
        ...style
    };

    return (
        <button
            style={buttonStyle}
            onMouseEnter={(e) => {
                if (!isLoading && !props.disabled) e.currentTarget.style.opacity = '0.9';
            }}
            onMouseLeave={(e) => {
                if (!isLoading && !props.disabled) e.currentTarget.style.opacity = '1';
            }}
            disabled={isLoading || props.disabled}
            {...props}
        >
            {isLoading ? '...' : children}
        </button>
    );
};

/**
 * SDKCard
 * Props: title (opcional), action (opcional), children.
 */
interface SDKCardProps {
    title?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
    style?: React.CSSProperties;
}

export const SDKCard: React.FC<SDKCardProps> = ({
    title,
    action,
    children,
    style = {}
}: SDKCardProps) => {
    const cardStyle: React.CSSProperties = {
        backgroundColor: TOKENS.background,
        border: `1px solid ${TOKENS.border}`,
        borderRadius: '12px',
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        ...style
    };

    return (
        <div style={cardStyle}>
            {(title || action) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: title ? '8px' : '0' }}>
                    {title && <h3 style={{ ...baseTextStyle, fontSize: '18px', fontWeight: '800', margin: 0 }}>{title}</h3>}
                    {action && <div>{action}</div>}
                </div>
            )}
            <div style={{ ...baseTextStyle }}>
                {children}
            </div>
        </div>
    );
};

/**
 * SDKInput
 * Props: Estándar de input HTML + label.
 */
interface SDKInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    style?: React.CSSProperties;
}

export const SDKInput: React.FC<SDKInputProps> = ({
    label,
    style = {},
    ...props
}: SDKInputProps) => {
    const containerStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%'
    };

    const inputInnerStyle: React.CSSProperties = {
        ...baseTextStyle,
        padding: '12px 16px',
        borderRadius: '8px',
        border: `1px solid ${TOKENS.border}`,
        fontSize: '15px',
        backgroundColor: TOKENS.background,
        outline: 'none',
        transition: 'border-color 0.2s ease',
        ...style
    };

    return (
        <div style={containerStyle}>
            {label && (
                <label style={{
                    ...baseTextStyle,
                    fontSize: '12px',
                    fontWeight: '700',
                    color: TOKENS.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                }}>
                    {label}
                </label>
            )}
            <input
                style={inputInnerStyle}
                onFocus={(e) => e.currentTarget.style.borderColor = TOKENS.primary}
                onBlur={(e) => e.currentTarget.style.borderColor = TOKENS.border}
                {...props}
            />
        </div>
    );
};

/**
 * SDKLoading
 * Spinner circular con CSS puro.
 */
export const SDKLoading: React.FC<{ size?: number }> = ({ size = 28 }) => {
    const keyframesName = 'sdkFlatSpin';

    return (
        <div style={{ display: 'flex', padding: '20px', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{
                width: `${size}px`,
                height: `${size}px`,
                border: `3px solid ${TOKENS.border}`,
                borderTop: `3px solid ${TOKENS.primary}`,
                borderRadius: '50%',
                animation: `${keyframesName} 0.8s linear infinite`
            }} />
            <style>{`
                @keyframes ${keyframesName} {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
