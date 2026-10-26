import React from 'react';
import { useTranslation } from 'react-i18next';

interface MobileHomeProps {
    onStartNewScan: () => void;
    onViewRecords: () => void;
}

/**
 * MobileHome - Pantalla de inicio de PRECISIÓN para STOCKPILE-CONTROL.
 * Diseño: Herramienta Industrial, Minimalismo Extremo.
 * Background: #0C0C0C (Negro Puro).
 * Tipografía: Atkinson Hyperlegible.
 * Sin redundancias, sin indicadores ficticios.
 */
export const MobileHome: React.FC<MobileHomeProps> = ({ onStartNewScan, onViewRecords }) => {
    const { t } = useTranslation();
    return (
        <main className="h-screen w-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden select-none transition-colors duration-200">
            {/* Header Branding - Static for stability */}
            <header className="relative z-10 pt-16 pb-8 landscape:pt-8 landscape:pb-4 flex flex-col items-center">
                <span className="material-symbols-outlined text-antigravity-accent text-6xl mb-2 landscape:text-4xl transition-all">landscape</span>
                <h1 className="text-xs font-bold tracking-[0.5em] uppercase text-antigravity-light-text/90 dark:text-antigravity-dark-text/90 landscape:text-[10px]">STOCKPILE-CONTROL</h1>
            </header>

            {/* Ergonomic Action Zone (Industrial Standards: 96px targets) */}
            <section className="relative z-10 flex-1 flex flex-col landscape:flex-row items-center justify-center p-8 landscape:p-12 gap-12 landscape:gap-24 pb-24 landscape:pb-12 text-center">

                {/* Secondary: STOCK (Now First) */}
                <button
                    onClick={onViewRecords}
                    className="flex flex-col items-center space-y-4 active:scale-90 transition-all group"
                    aria-label={t('home.stock')}
                >
                    <div className="w-32 h-32 landscape:w-28 landscape:h-28 flex items-center justify-center rounded-none bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-2 border-antigravity-light-border dark:border-antigravity-dark-border group-active:border-antigravity-accent transition-colors overflow-hidden">
                        <span className="material-symbols-outlined text-[64px] landscape:text-[56px] text-antigravity-light-text/40 dark:text-antigravity-dark-text/40 group-active:text-antigravity-accent transition-all">list_alt</span>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.3em] text-antigravity-light-text/50 dark:text-antigravity-dark-text/30 group-active:text-antigravity-accent">{t('home.stock')}</span>
                </button>

                {/* Primary: NUEVO REGISTRO (Now Second) */}
                <button
                    onClick={onStartNewScan}
                    className="flex flex-col items-center space-y-4 active:scale-90 transition-all group"
                    aria-label={t('home.new_registration')}
                >
                    <div className="w-32 h-32 landscape:w-28 landscape:h-28 flex items-center justify-center rounded-none bg-antigravity-accent/5 dark:bg-antigravity-accent/10 border-2 border-antigravity-accent/20 dark:border-antigravity-accent/40 group-active:bg-antigravity-accent/20 group-active:border-antigravity-accent transition-colors overflow-hidden">
                        <span className="material-symbols-outlined text-[64px] landscape:text-[56px] font-bold text-antigravity-accent transition-all">list_alt_add</span>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.3em] text-antigravity-accent group-active:text-antigravity-accent/80">{t('home.new_registration')}</span>
                </button>

            </section>

            {/* Industrial Version Footer */}
            <footer className="relative z-10 pb-8 flex justify-center items-center">
                <div className="flex items-center space-x-4">
                    <div className="h-[1px] w-8 bg-antigravity-light-border dark:bg-antigravity-dark-border opacity-60 dark:opacity-30"></div>
                    <span className="text-[10px] text-antigravity-light-text/30 dark:text-antigravity-dark-text/10 font-bold uppercase tracking-[0.6em]">FIELD_V2.0_PRO</span>
                    <div className="h-[1px] w-8 bg-antigravity-light-border dark:bg-antigravity-dark-border opacity-60 dark:opacity-30"></div>
                </div>
            </footer>
        </main>
    );
};
