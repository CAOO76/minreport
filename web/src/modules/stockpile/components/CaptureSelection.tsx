import React from 'react';
import { motion } from 'framer-motion';

interface CaptureSelectionProps {
    onSelection: (type: 'digital' | 'manual') => void;
    onBack: () => void;
}

/**
 * CaptureSelection - Selección de Método de Cubicación
 * Estándar: Minimalismo Industrial Puro (GEMINI.md).
 */
export const CaptureSelection: React.FC<CaptureSelectionProps> = ({ onSelection, onBack }) => {
    return (
        <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-full w-full flex-1 min-h-[540px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden select-none relative transition-colors duration-200 rounded-none shadow-none"
        >
            <header className="pt-8 px-6 flex items-center justify-between z-40">
                <button
                    type="button"
                    onClick={onBack}
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
                    title="Volver"
                >
                    <span className="material-symbols-outlined text-2xl text-antigravity-accent">arrow_back</span>
                </button>
                <div className="w-10 h-10 flex items-center justify-center opacity-30 dark:opacity-20 text-antigravity-light-text dark:text-antigravity-dark-text">
                    <span className="material-symbols-outlined text-2xl">landscape</span>
                </div>
            </header>

            <section className="flex-1 flex flex-col items-center justify-center p-8 z-10 gap-10">
                <div className="flex flex-col items-center mb-2">
                    <span className="text-[10px] font-black tracking-[0.5em] uppercase text-antigravity-light-text/50 dark:text-white/40 mb-1">MÉTODO DE</span>
                    <span className="text-2xl font-black tracking-tight text-antigravity-light-text dark:text-white/90">CAPTURA</span>
                </div>

                <div className="flex flex-col sm:flex-row gap-12 items-center justify-center">
                    {/* Digital Option */}
                    <div className="flex flex-col items-center gap-4">
                        <button
                            type="button"
                            onClick={() => onSelection('digital')}
                            className="w-32 h-32 rounded-none shadow-none bg-antigravity-accent/5 border-2 border-antigravity-accent/40 flex items-center justify-center hover:bg-antigravity-accent/15 transition-all group cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[52px] text-antigravity-accent">photo_camera</span>
                        </button>
                        <div className="flex flex-col items-center">
                            <span className="text-lg font-black tracking-tight text-antigravity-accent">DIGITAL</span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-antigravity-light-text/50 dark:text-white/40">Fotogrametría + IA</span>
                        </div>
                    </div>

                    {/* Manual Option */}
                    <div className="flex flex-col items-center gap-4">
                        <button
                            type="button"
                            onClick={() => onSelection('manual')}
                            className="w-32 h-32 rounded-none shadow-none bg-antigravity-light-surface dark:bg-[#07090D] border-2 border-antigravity-light-border dark:border-[#12151C] flex items-center justify-center hover:border-antigravity-accent transition-all group cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[52px] text-antigravity-light-text/60 dark:text-white/60">measuring_tape</span>
                        </button>
                        <div className="flex flex-col items-center">
                            <span className="text-lg font-black tracking-tight text-antigravity-light-text dark:text-white/90">GEOMÉTRICA</span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-antigravity-light-text/50 dark:text-white/40">Cotas Directas</span>
                        </div>
                    </div>
                </div>
            </section>
        </motion.main>
    );
};
