import React from 'react';
import { motion } from 'framer-motion';

interface CaptureSelectionProps {
    onSelection: (type: 'digital' | 'manual') => void;
    onBack: () => void;
}

/**
 * CaptureSelection - REFINAMIENTO INDUSTRIAL (STITCH)
 * Distribución vertical centrada del título y opciones de captura.
 * Eliminación de pie de página para máximo minimalismo.
 */
export const CaptureSelection: React.FC<CaptureSelectionProps> = ({ onSelection, onBack }) => {
    return (
        <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-screen w-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden select-none relative transition-colors duration-200"
        >
            {/* Header: Solo botón de retorno y branding sutil */}
            <header className="absolute top-0 left-0 w-full pt-14 px-6 flex items-center justify-between z-50">
                <button onClick={onBack} className="w-12 h-12 rounded-none bg-antigravity-light-surface dark:bg-white/5 border border-antigravity-light-border dark:border-white/10 flex items-center justify-center active:scale-90 transition-transform">
                    <span className="material-symbols-outlined text-3xl text-antigravity-accent">arrow_back</span>
                </button>
                <div className="w-12 h-12 flex items-center justify-center opacity-30 dark:opacity-20 text-antigravity-light-text dark:text-antigravity-dark-text">
                    <span className="material-symbols-outlined text-3xl">landscape</span>
                </div>
            </header>

            {/* Technical Grid Background */}
            <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.03] pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
            </div>

            {/* Main Section: Centrado Vertical Completo */}
            <section className="flex-1 flex flex-col items-center justify-center p-8 z-10 gap-12">

                {/* Título de la página (Centrado con las opciones) */}
                <div className="flex flex-col items-center mb-4">
                    <span className="text-[10px] font-black tracking-[0.5em] uppercase text-antigravity-light-text/50 dark:text-white/20 mb-1">MÉTODO DE</span>
                    <span className="text-3xl font-black tracking-tight text-antigravity-light-text dark:text-white/90">CAPTURA</span>
                </div>

                <div className="flex flex-col gap-16">
                    {/* Digital Option */}
                    <div className="flex flex-col items-center gap-4">
                        <button
                            onClick={() => onSelection('digital')}
                            className="w-32 h-32 rounded-none bg-antigravity-accent/5 dark:bg-primary/5 border-2 border-antigravity-accent/30 dark:border-primary/30 flex items-center justify-center active:scale-90 active:bg-antigravity-accent active:text-white dark:active:text-black transition-all group shadow-[0_0_30px_rgba(198,131,70,0.1)]"
                        >
                            <span className="material-symbols-outlined text-[56px] text-antigravity-accent group-active:text-white dark:group-active:text-black">mobile_camera</span>
                        </button>
                        <div className="flex flex-col items-center">
                            <span className="text-xl font-black tracking-tight text-antigravity-accent">DIGITAL</span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-antigravity-accent/50 dark:text-primary/30">Mobile Camera</span>
                        </div>
                    </div>

                    {/* Manual Option */}
                    <div className="flex flex-col items-center gap-4">
                        <button
                            onClick={() => onSelection('manual')}
                            className="w-32 h-32 rounded-none bg-antigravity-light-surface dark:bg-white/5 border-2 border-antigravity-light-border dark:border-white/10 flex items-center justify-center active:scale-90 active:bg-antigravity-light-text dark:active:bg-white active:text-antigravity-light-bg dark:active:text-black transition-all group"
                        >
                            <span className="material-symbols-outlined text-[56px] text-antigravity-light-text/40 dark:text-white/30 group-active:text-inherit">measuring_tape</span>
                        </button>
                        <div className="flex flex-col items-center">
                            <span className="text-xl font-black tracking-tight text-antigravity-light-text dark:text-white/90">MANUAL</span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-antigravity-light-text/40 dark:text-white/10">Measuring Tape</span>
                        </div>
                    </div>
                </div>

            </section>
        </motion.main>
    );
};
