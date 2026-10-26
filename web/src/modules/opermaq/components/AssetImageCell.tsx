import React, { useState } from 'react';
import { M3IconButton } from './M3IconButton';
import { useAssetImage } from '../hooks/useAssetImage';

interface AssetImageCellProps {
    assetId: string;
    thumbnailUrl?: string;
    make?: string;
    model?: string;
    size?: number;
    className?: string;
    onImageGenerated?: (newUrl: string) => void;
}

export const AssetImageCell: React.FC<AssetImageCellProps> = ({ 
    assetId,
    thumbnailUrl: initialUrl, 
    size = 64, 
    className = "",
    onImageGenerated
}) => {
    const [currentUrl, setCurrentUrl] = useState(initialUrl);
    const { generateImage, isGenerating, error } = useAssetImage(assetId);

    const handleGenerate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const newUrl = await generateImage();
        if (newUrl) {
            setCurrentUrl(newUrl);
            if (onImageGenerated) onImageGenerated(newUrl);
        }
    };

    const isLarge = size === 320;
    const containerClasses = isLarge 
        ? "aspect-[4/3] w-full max-w-[320px] shadow-2xl" 
        : "";
    
    const inlineStyle = !isLarge ? { width: `${size}px`, height: `${size}px` } : {};

    return (
        <div 
            className={`relative bg-surface border border-border-base flex items-center justify-center overflow-hidden shrink-0 group ${containerClasses} ${className}`}
            style={inlineStyle}
        >
            {isGenerating ? (
                <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                    <span className="material-symbols-outlined animate-spin text-white/50">sync</span>
                    {isLarge && <span className="text-[10px] text-white/40 mt-2 uppercase tracking-widest font-atkinson">Generando Imagen IA...</span>}
                </div>
            ) : null}

            {currentUrl ? (
                <img 
                    src={currentUrl} 
                    alt="Asset" 
                    className="w-full h-full object-cover transition-opacity duration-700"
                    loading="lazy"
                />
            ) : (
                <div className="flex flex-col items-center justify-center opacity-20">
                    <span className="material-symbols-outlined !text-[24px]">construction</span>
                    {isLarge && <span className="text-[10px] mt-2 uppercase font-atkinson">Sin Imagen</span>}
                </div>
            )}

            {/* OVERLAY ACTION */}
            <div className={`absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 ${isGenerating ? '!opacity-0' : ''}`}>
                <M3IconButton 
                    icon="refresh" 
                    variant="ghost"
                    className="!bg-white/20 !text-white hover:!bg-white/40"
                    onClick={handleGenerate}
                    title="Regenerar con IA"
                />
            </div>

            {error && !isGenerating && (
                <div className="absolute bottom-0 left-0 right-0 bg-red-900/80 p-1 text-[8px] text-center text-white uppercase tracking-tighter">
                    Error IA: {error}
                </div>
            )}
        </div>
    );
};
