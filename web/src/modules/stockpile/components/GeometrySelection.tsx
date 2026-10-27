import React from 'react';
import { motion } from 'framer-motion';

export type GeometryType = 'CONO_ELIPTICO' | 'CONO_ELIPTICO_TRUNCADO' | 'CONO_TRUNCADO_PERIMETRO';

interface GeometrySelectionProps {
    onSelection: (type: GeometryType) => void;
    onBack: () => void;
}

/**
 * GeometrySelection - Selección de Geometría del Sólido para Cubicación Manual
 * Estándar: Minimalismo Industrial Puro (GEMINI.md).
 */
export const GeometrySelection: React.FC<GeometrySelectionProps> = ({ onSelection, onBack }) => {
    return (
        <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-full w-full flex-1 min-h-[540px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden select-none relative transition-colors duration-200 rounded-none shadow-none"
        >
            <header className="pt-8 pb-4 px-6 flex items-center justify-between z-40 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={onBack}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Volver"
                    >
                        <span className="material-symbols-outlined text-2xl text-antigravity-accent">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black tracking-[0.4em] uppercase text-antigravity-light-text/50 dark:text-white/40">GEOMETRÍA</span>
                        <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-white/90">DEL SÓLIDO</span>
                    </div>
                </div>
                <div className="w-10 h-10 flex items-center justify-center opacity-30 dark:opacity-20 text-antigravity-light-text dark:text-antigravity-dark-text">
                    <span className="material-symbols-outlined text-2xl">landscape</span>
                </div>
            </header>

            <section className="flex-1 flex flex-col items-center justify-center p-8 gap-6 z-10">

                <button
                    type="button"
                    onClick={() => onSelection('CONO_ELIPTICO')}
                    className="w-full max-w-md h-24 bg-antigravity-light-surface dark:bg-[#07090D] border border-antigravity-light-border dark:border-[#12151C] hover:border-antigravity-accent rounded-none shadow-none flex items-center px-6 gap-6 transition-all group cursor-pointer"
                >
                    <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent">category</span>
                    </div>
                    <div className="flex flex-col items-start text-antigravity-light-text dark:text-white">
                        <span className="text-[10px] font-black font-mono tracking-widest opacity-50">MODELO 01</span>
                        <span className="text-base font-black tracking-tight">CONO ELÍPTICO</span>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() => onSelection('CONO_ELIPTICO_TRUNCADO')}
                    className="w-full max-w-md h-24 bg-antigravity-light-surface dark:bg-[#07090D] border border-antigravity-light-border dark:border-[#12151C] hover:border-antigravity-accent rounded-none shadow-none flex items-center px-6 gap-6 transition-all group cursor-pointer"
                >
                    <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent">layers</span>
                    </div>
                    <div className="flex flex-col items-start text-antigravity-light-text dark:text-white">
                        <span className="text-[10px] font-black font-mono tracking-widest opacity-50">MODELO 02</span>
                        <span className="text-base font-black tracking-tight">CONO ELÍPTICO TRUNCADO</span>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() => onSelection('CONO_TRUNCADO_PERIMETRO')}
                    className="w-full max-w-md h-24 bg-antigravity-light-surface dark:bg-[#07090D] border border-antigravity-light-border dark:border-[#12151C] hover:border-antigravity-accent rounded-none shadow-none flex items-center px-6 gap-6 transition-all group cursor-pointer"
                >
                    <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-3xl text-antigravity-accent">architecture</span>
                    </div>
                    <div className="flex flex-col items-start text-antigravity-light-text dark:text-white">
                        <span className="text-[10px] font-black font-mono tracking-widest opacity-50">MODELO 03</span>
                        <span className="text-base font-black tracking-tight leading-tight text-left">CONO ELÍPTICO TRUNCADO POR PERÍMETRO</span>
                    </div>
                </button>

            </section>
        </motion.main>
    );
};
