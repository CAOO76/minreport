import React from 'react';

export interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string;
    alt: string;
    className?: string;
}

/**
 * SecureImage - MINREPORT Estándar de Blindaje de Medios y Seguridad Bancaria
 * 
 * Implementa salvaguardas contra extracción no autorizada de activos visuales:
 * - draggable={false}
 * - onContextMenu={(e) => e.preventDefault()}
 * - -webkit-user-drag: none
 * - user-select: none
 * - pointer-events-none
 */
export const SecureImage: React.FC<SecureImageProps> = ({
    src,
    alt,
    className = '',
    style,
    ...rest
}) => {
    return (
        <div 
            className="inline-block relative select-none"
            onContextMenu={(e) => e.preventDefault()}
        >
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
        </div>
    );
};

export default SecureImage;
