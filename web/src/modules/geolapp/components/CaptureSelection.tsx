import React from 'react';
import { useTranslation } from 'react-i18next';

interface CaptureSelectionProps {
    onSelection: (type: 'digital' | 'manual') => void;
    onBack: () => void;
}

/**
 * CaptureSelection - Selección de Método de Cubicación para GEOLAPP®.
 * Estándar: Minimalismo Industrial Puro (GEMINI.md).
 */
export const CaptureSelection: React.FC<CaptureSelectionProps> = ({ onSelection, onBack }) => {
    const { t } = useTranslation();

    return (
        <main className="h-full w-full flex-1 min-h-[540px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none relative transition-colors duration-200 rounded-none shadow-none">
            <header className="pt-fib-34 pb-fib-13 px-fib-21 flex items-center justify-between z-40 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                <div className="flex items-center gap-fib-13">
                    <button
                        type="button"
                        onClick={onBack}
                        className="min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                        title={t('common.back_button')}
                        aria-label={t('common.back_button')}
                    >
                        <span className="material-symbols-outlined text-2xl text-[#C68346]">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-microcopy font-mono font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('capture_selection.kicker', 'MÉTODO DE CUBICACIÓN')}
                        </span>
                        <h1 className="text-h1-header font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                            {t('capture_selection.title', 'SELECCIÓN DE CAPTURA')}
                        </h1>
                    </div>
                </div>
            </header>

            <section className="flex-1 flex flex-col items-center justify-center p-fib-34 z-10 gap-fib-21">
                <div className="w-full max-w-md flex flex-col sm:flex-row gap-fib-21 items-stretch justify-center">
                    <button
                        type="button"
                        onClick={() => onSelection('digital')}
                        className="flex-1 min-h-[144px] p-fib-21 rounded-none shadow-none bg-[#C68346]/5 dark:bg-[#C68346]/10 border border-[#C68346]/50 hover:border-[#C68346] hover:bg-[#C68346]/15 flex flex-col items-center justify-center gap-fib-13 transition-colors cursor-pointer text-center"
                    >
                        <span className="material-symbols-outlined text-[48px] text-[#C68346]">photo_camera</span>
                        <span className="text-h2-section font-bold tracking-tight text-[#C68346] uppercase">
                            {t('capture_selection.digital_title', 'DIGITAL')}
                        </span>
                        <span className="text-microcopy font-mono font-bold uppercase tracking-[0.15em] text-[#475569] dark:text-[#8A93A6]">
                            {t('capture_selection.digital_desc', 'Fotogrametría + IA')}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => onSelection('manual')}
                        className="flex-1 min-h-[144px] p-fib-21 rounded-none shadow-none bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] flex flex-col items-center justify-center gap-fib-13 transition-colors cursor-pointer text-center"
                    >
                        <span className="material-symbols-outlined text-[48px] text-[#475569] dark:text-[#8A93A6]">straighten</span>
                        <span className="text-h2-section font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                            {t('capture_selection.manual_title', 'GEOMÉTRICA')}
                        </span>
                        <span className="text-microcopy font-mono font-bold uppercase tracking-[0.15em] text-[#475569] dark:text-[#8A93A6]">
                            {t('capture_selection.manual_desc', 'Cotas Directas + IMU')}
                        </span>
                    </button>
                </div>
            </section>
        </main>
    );
};
