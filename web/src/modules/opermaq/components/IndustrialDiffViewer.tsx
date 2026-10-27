import React, { useMemo } from 'react';
import * as Diff from 'diff';

export interface IndustrialDiffViewerProps {
    originalText: string;
    proposedText: string;
}

/**
 * OPERMAQ-DEV | Industrial Diff Viewer
 * Componente minimalista para visualizar diferencias entre texto original (manual)
 * y la propuesta generada por IA (Vault).
 */
export const IndustrialDiffViewer: React.FC<IndustrialDiffViewerProps> = ({ originalText, proposedText }) => {
    const diffGroups = useMemo(() => {
        return Diff.diffWords(originalText, proposedText);
    }, [originalText, proposedText]);

    return (
        <div className="font-atkinson text-[13px] leading-relaxed p-5 bg-foreground/[0.02] border border-border-base/50 relative overflow-hidden group">
            {/* Elemento decorativo industrial */}
            <div className="absolute top-0 left-0 w-1 h-full bg-foreground/10 group-hover:bg-foreground/30 transition-colors duration-500"></div>
            
            <div className="pl-2">
                {diffGroups.map((part, index) => {
                    if (part.added) {
                        return (
                            <span key={index} className="bg-foreground/10 text-foreground font-black px-1 rounded-none border-b border-foreground/30 ml-1">
                                {part.value}
                            </span>
                        );
                    }
                    if (part.removed) {
                        return (
                            <span key={index} className="text-foreground/40 line-through decoration-foreground/40 px-1 ml-1">
                                {part.value}
                            </span>
                        );
                    }
                    // Unchanged
                    return (
                        <span key={index} className="text-foreground/80">
                            {part.value}
                        </span>
                    );
                })}
            </div>
        </div>
    );
};
