import React from 'react';

export interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string;
    alt: string;
    className?: string;
}

/**
 * SecureImage - MINREPORT Estandar de Blindaje de Medios y Seguridad Bancaria
 * Implementa draggable={false}, -webkit-user-drag: none, onContextMenu preventDefault
 * y clases select-none pointer-events-none.
 */
export const SecureImage: React.FC<SecureImageProps> = ({
    src,
    alt,
    className = '',
    style,
    ...rest
}) => {
    return (
        <img
            src={src}
            alt={alt}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            style={{
                WebkitUserDrag: 'none',
                userSelect: 'none',
                ...style
            } as React.CSSProperties}
            className={`select-none pointer-events-none ${className}`}
            {...rest}
        />
    );
};

export default SecureImage;
