import React from 'react';
import { motion } from 'framer-motion';

export type GeometryType = 'CONO_ELIPTICO' | 'CONO_ELIPTICO_TRUNCADO' | 'CONO_TRUNCADO_PERIMETRO';

interface GeometrySelectionProps {
    onSelection: (type: GeometryType) => void;
    onBack: () => void;
}

/**
 * GeometrySelection - INTERFAZ INDUSTRIAL (STITCH)
 * Selección de tipo de sólido para cubicación manual.
 */
export const GeometrySelection: React.FC<GeometrySelectionProps> = ({ onSelection, onBack }) => {
    return (
        <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-screen w-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden select-none relative transition-colors duration-200"
        >
            {/* Header Técnico */}
            <header className="absolute top-0 left-0 w-full pt-14 pb-4 px-6 flex items-center justify-between z-50 bg-gradient-to-b from-antigravity-light-bg dark:from-black/80 to-transparent">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="w-12 h-12 rounded-none bg-antigravity-light-surface dark:bg-white/5 border border-antigravity-light-border dark:border-white/10 flex items-center justify-center active:scale-90 transition-transform">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black tracking-[0.4em] uppercase text-antigravity-light-text/50 dark:text-white/20">GEOMETRÍA</span>
                        <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-white/90">DEL SÓLIDO</span>
                    </div>
                </div>
                <div className="w-12 h-12 flex items-center justify-center opacity-30 dark:opacity-20 text-antigravity-light-text dark:text-antigravity-dark-text">
                    <span className="material-symbols-outlined text-3xl">landscape</span>
                </div>
            </header>

            {/* Technical Grid Background */}
            <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.03] pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
            </div>

            {/* Selection Grid */}
            <section className="flex-1 flex flex-col items-center justify-center p-8 gap-8 z-10">

                {/* 1º CONO ELÍPTICO */}
                <button
                    onClick={() => onSelection('CONO_ELIPTICO')}
                    className="w-full max-w-xs h-24 bg-antigravity-light-surface dark:bg-white/5 border border-antigravity-light-border dark:border-white/10 rounded-none flex items-center px-6 gap-6 active:scale-95 active:bg-antigravity-accent active:text-white dark:active:text-black transition-all group"
                >
                    <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 flex items-center justify-center group-active:bg-black/20">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent group-active:text-inherit">category</span>
                    </div>
                    <div className="flex flex-col items-start text-antigravity-light-text dark:text-white">
                        <span className="text-[10px] font-black tracking-widest opacity-40 dark:text-white/30">1º OPCIÓN</span>
                        <span className="text-lg font-black tracking-tight">CONO ELÍPTICO</span>
                    </div>
                </button>

                {/* 2º CONO ELÍPTICO TRUNCADO */}
                <button
                    onClick={() => onSelection('CONO_ELIPTICO_TRUNCADO')}
                    className="w-full max-w-xs h-24 bg-antigravity-light-surface dark:bg-white/5 border border-antigravity-light-border dark:border-white/10 rounded-none flex items-center px-6 gap-6 active:scale-95 active:bg-antigravity-accent active:text-white dark:active:text-black transition-all group"
                >
                    <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 flex items-center justify-center group-active:bg-black/20">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent group-active:text-inherit">layers</span>
                    </div>
                    <div className="flex flex-col items-start text-antigravity-light-text dark:text-white">
                        <span className="text-[10px] font-black tracking-widest opacity-40 dark:text-white/30">2º OPCIÓN</span>
                        <span className="text-lg font-black tracking-tight">CONO ELÍPTICO TRUNCADO</span>
                    </div>
                </button>

                {/* 3º CONO TRUNCADO POR PERÍMETRO */}
                <button
                    onClick={() => onSelection('CONO_TRUNCADO_PERIMETRO')}
                    className="w-full max-w-xs h-24 bg-antigravity-light-surface dark:bg-white/5 border border-antigravity-light-border dark:border-white/10 rounded-none flex items-center px-6 gap-6 active:scale-95 active:bg-antigravity-accent active:text-white dark:active:text-black transition-all group"
                >
                    <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 flex items-center justify-center group-active:bg-black/20">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent group-active:text-inherit">architecture</span>
                    </div>
                    <div className="flex flex-col items-start text-antigravity-light-text dark:text-white">
                        <span className="text-[10px] font-black tracking-widest opacity-40 dark:text-white/30">3º OPCIÓN</span>
                        <span className="text-lg font-black tracking-tight leading-tight">CONO ELÍPTICO TRUNCADO POR PERÍMETRO</span>
                    </div>
                </button>

            </section>
        </motion.main>
    );
};
