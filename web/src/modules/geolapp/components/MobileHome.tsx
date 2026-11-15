import React from 'react';
import { useTranslation } from 'react-i18next';

interface MobileHomeProps {
    onStartNewScan: () => void;
    onViewRecords: () => void;
}

/**
 * MobileHome - Pantalla de inicio de campo para GEOLAPP®.
 * Cumple GEMINI.md §3: Minimalismo Industrial Puro, cero badges ficticios, soporte dual light/dark.
 */
export const MobileHome: React.FC<MobileHomeProps> = ({ onStartNewScan, onViewRecords }) => {
    const { t } = useTranslation();

    return (
        <main className="h-full w-full flex-1 min-h-[540px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none transition-colors duration-200 rounded-none shadow-none">
            <header className="relative z-10 pt-fib-55 pb-fib-21 px-fib-21 flex flex-col items-center border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                <span className="material-symbols-outlined text-[#C68346] text-[44px] mb-fib-8">landscape</span>
                <h1 className="text-microcopy font-mono font-bold tracking-[0.28em] uppercase text-[#0F172A] dark:text-[#F3F4F6] text-center">
                    {t('home.brand_header', 'GEOLAPP® · CONTROL DE STOCKPILES')}
                </h1>
            </header>

            <section className="relative z-10 flex-1 flex flex-col landscape:flex-row items-center justify-center p-fib-34 gap-fib-21 text-center">
                <button
                    type="button"
                    onClick={onViewRecords}
                    className="w-full max-w-xs min-h-[144px] p-fib-21 flex flex-col items-center justify-center gap-fib-13 rounded-none shadow-none bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] transition-colors cursor-pointer group"
                    aria-label={t('home.stock')}
                >
                    <span className="material-symbols-outlined text-[48px] text-[#475569] dark:text-[#8A93A6] group-hover:text-[#C68346] transition-colors">
                        list_alt
                    </span>
                    <span className="text-microcopy font-mono font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] group-hover:text-[#C68346]">
                        {t('home.stock')}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={onStartNewScan}
                    className="w-full max-w-xs min-h-[144px] p-fib-21 flex flex-col items-center justify-center gap-fib-13 rounded-none shadow-none bg-[#C68346]/5 dark:bg-[#C68346]/10 border border-[#C68346]/50 hover:border-[#C68346] hover:bg-[#C68346]/15 transition-colors cursor-pointer group"
                    aria-label={t('home.new_registration')}
                >
                    <span className="material-symbols-outlined text-[48px] text-[#C68346]">
                        list_alt_add
                    </span>
                    <span className="text-microcopy font-mono font-bold uppercase tracking-[0.2em] text-[#C68346]">
                        {t('home.new_registration')}
                    </span>
                </button>
            </section>
        </main>
    );
};
