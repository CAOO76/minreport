import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type ViewState } from '../layouts/MainLayout';

interface FloatingBackButtonProps {
    currentView: ViewState;
    onBack: () => void;
}

/**
 * FloatingBackButton - Botón de navegación GLOBAL industrial.
 * Cumple GEMINI.md: geometría 0px (rounded-none), cero sombras (shadow-none).
 */
export const FloatingBackButton: React.FC<FloatingBackButtonProps> = ({ currentView, onBack }) => {
    if (currentView === 'home') return null;

    return (
        <AnimatePresence>
            <motion.button
                type="button"
                key="global-back-button"
                initial={{ opacity: 0, scale: 0.5, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.5, x: -20 }}
                onClick={onBack}
                className="fixed bottom-10 left-8 z-[100] w-16 h-16 bg-white/90 dark:bg-[#07090D]/90 border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex items-center justify-center text-[#C68346] transition-all overflow-hidden cursor-pointer"
                aria-label="Regresar"
            >
                <span className="material-symbols-outlined text-[32px] font-bold">arrow_back</span>
            </motion.button>
        </AnimatePresence>
    );
};
