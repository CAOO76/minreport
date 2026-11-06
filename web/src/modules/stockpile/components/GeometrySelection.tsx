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
            className="h-full w-full flex-1 min-h-[540px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none relative transition-colors duration-200 rounded-none shadow-none"
        >
            <header className="pt-8 pb-4 px-6 flex items-center justify-between z-40 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-[13px]">
                    <button
                        type="button"
                        onClick={onBack}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Volver"
                        aria-label="Volver"
                    >
                        <span className="material-symbols-outlined text-2xl text-[#C68346]">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">GEOMETRÍA</span>
                        <span className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">DEL SÓLIDO</span>
                    </div>
                </div>
            </header>

            <section className="flex-1 flex flex-col items-center justify-center p-[34px] gap-[21px] z-10">
                <button
                    type="button"
                    onClick={() => onSelection('CONO_ELIPTICO')}
                    className="w-full max-w-md min-h-[89px] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] rounded-none shadow-none flex items-center justify-between px-[21px] py-[13px] transition-colors cursor-pointer"
                >
                    <div className="flex flex-col items-start text-[#0F172A] dark:text-[#F3F4F6] gap-[8px]">
                        <span className="text-[11px] font-bold font-mono tabular-nums tracking-widest text-[#C68346]">MODELO 01</span>
                        <span className="text-base font-bold tracking-tight">CONO ELÍPTICO</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">V = 1/3 · π · a · b · h</span>
                </button>

                <button
                    type="button"
                    onClick={() => onSelection('CONO_ELIPTICO_TRUNCADO')}
                    className="w-full max-w-md min-h-[89px] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] rounded-none shadow-none flex items-center justify-between px-[21px] py-[13px] transition-colors cursor-pointer"
                >
                    <div className="flex flex-col items-start text-[#0F172A] dark:text-[#F3F4F6] gap-[8px]">
                        <span className="text-[11px] font-bold font-mono tabular-nums tracking-widest text-[#C68346]">MODELO 02</span>
                        <span className="text-base font-bold tracking-tight">CONO ELÍPTICO TRUNCADO</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">EJES SUP / INF</span>
                </button>

                <button
                    type="button"
                    onClick={() => onSelection('CONO_TRUNCADO_PERIMETRO')}
                    className="w-full max-w-md min-h-[89px] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] rounded-none shadow-none flex items-center justify-between px-[21px] py-[13px] transition-colors cursor-pointer"
                >
                    <div className="flex flex-col items-start text-[#0F172A] dark:text-[#F3F4F6] gap-[8px]">
                        <span className="text-[11px] font-bold font-mono tabular-nums tracking-widest text-[#C68346]">MODELO 03</span>
                        <span className="text-base font-bold tracking-tight leading-tight text-left">CONO ELÍPTICO TRUNCADO POR PERÍMETRO</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">PERÍMETRO</span>
                </button>
            </section>
        </motion.main>
    );
};
