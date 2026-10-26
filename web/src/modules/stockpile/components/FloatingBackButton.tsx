import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type ViewState } from '../layouts/MainLayout';

interface FloatingBackButtonProps {
    currentView: ViewState;
    onBack: () => void;
}

/**
 * FloatingBackButton - Botón de navegación GLOBAL industrial.
 * Ubicación: Zona del Pulgar (Inferior Izquierda).
 * Estética: Alto Contraste, Minimalismo Extremo.
 * Target: 72px para uso con guantes.
 */
export const FloatingBackButton: React.FC<FloatingBackButtonProps> = ({ currentView, onBack }) => {
    // No mostrar en Home (es la raíz)
    if (currentView === 'home') return null;

    return (
        <AnimatePresence>
            <motion.button
                key="global-back-button"
                initial={{ opacity: 0, scale: 0.5, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.5, x: -20 }}
                onClick={onBack}
                className="fixed bottom-10 left-8 z-[100] w-24 h-24 bg-black/40 backdrop-blur-xl border-2 border-primary/20 rounded-none flex items-center justify-center text-primary active:scale-90 active:bg-primary/20 active:border-primary transition-all shadow-[0_0_20px_rgba(255,176,0,0.2)] overflow-hidden"
                aria-label="Regresar"
            >
                <span className="material-symbols-outlined text-[48px] font-bold">arrow_back</span>
            </motion.button>
        </AnimatePresence>
    );
};
