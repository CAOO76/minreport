import React from 'react';
import { useTranslation } from 'react-i18next';

interface MobileHomeProps {
    onStartNewScan: () => void;
    onViewRecords: () => void;
}

/**
 * MobileHome - Pantalla de inicio de PRECISIÓN para STOCKPILE-CONTROL.
 * Cumple GEMINI.md: Minimalismo Industrial Puro, cero badges ficticios ("PRO").
 */
export const MobileHome: React.FC<MobileHomeProps> = ({ onStartNewScan, onViewRecords }) => {
    const { t } = useTranslation();
    return (
        <main className="h-full w-full flex-1 min-h-[540px] bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex flex-col font-atkinson text-antigravity-light-text dark:text-antigravity-dark-text overflow-hidden select-none transition-colors duration-200 rounded-none shadow-none">
            <header className="relative z-10 pt-12 pb-6 flex flex-col items-center">
                <span className="material-symbols-outlined text-antigravity-accent text-5xl mb-2 transition-all">landscape</span>
                <h1 className="text-xs font-bold tracking-[0.5em] uppercase text-antigravity-light-text/90 dark:text-antigravity-dark-text/90">STOCKPILE-CONTROL</h1>
            </header>

            <section className="relative z-10 flex-1 flex flex-col landscape:flex-row items-center justify-center p-8 gap-12 text-center">
                <button
                    type="button"
                    onClick={onViewRecords}
                    className="flex flex-col items-center space-y-4 transition-all group cursor-pointer"
                    aria-label={t('home.stock')}
                >
                    <div className="w-32 h-32 flex items-center justify-center rounded-none shadow-none bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-2 border-antigravity-light-border dark:border-antigravity-dark-border group-hover:border-antigravity-accent transition-colors overflow-hidden">
                        <span className="material-symbols-outlined text-[56px] text-antigravity-light-text/50 dark:text-antigravity-dark-text/50 group-hover:text-antigravity-accent transition-all">list_alt</span>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.3em] text-antigravity-light-text/60 dark:text-antigravity-dark-text/60 group-hover:text-antigravity-accent">{t('home.stock')}</span>
                </button>

                <button
                    type="button"
                    onClick={onStartNewScan}
                    className="flex flex-col items-center space-y-4 transition-all group cursor-pointer"
                    aria-label={t('home.new_registration')}
                >
                    <div className="w-32 h-32 flex items-center justify-center rounded-none shadow-none bg-antigravity-accent/5 dark:bg-antigravity-accent/10 border-2 border-antigravity-accent/30 dark:border-antigravity-accent/40 group-hover:bg-antigravity-accent/20 group-hover:border-antigravity-accent transition-colors overflow-hidden">
                        <span className="material-symbols-outlined text-[56px] font-bold text-antigravity-accent transition-all">list_alt_add</span>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.3em] text-antigravity-accent">{t('home.new_registration')}</span>
                </button>
            </section>
        </main>
    );
};
