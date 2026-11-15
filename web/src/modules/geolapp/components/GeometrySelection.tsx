import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GeolappGeometryType } from '../core/types/GeolappTypes';

export type GeometryType = GeolappGeometryType;

interface GeometrySelectionProps {
    onSelection: (type: GeometryType) => void;
    onBack: () => void;
}

interface GeometryCatalogItem {
    type: GeometryType;
    code: string;
    titleKey: string;
    fallbackTitle: string;
    formulaKey: string;
    fallbackFormula: string;
}

const GEOMETRY_CATALOG: GeometryCatalogItem[] = [
    {
        type: 'CONO_ELIPTICO',
        code: 'MODELO 01',
        titleKey: 'geometries.CONO_ELIPTICO',
        fallbackTitle: 'CONO ELÍPTICO',
        formulaKey: 'geometries.CONO_ELIPTICO_DESC',
        fallbackFormula: 'V = 1/3 · π · r1 · r2 · h',
    },
    {
        type: 'CONO_ELIPTICO_TRUNCADO',
        code: 'MODELO 02',
        titleKey: 'geometries.CONO_ELIPTICO_TRUNCADO',
        fallbackTitle: 'CONO ELÍPTICO TRUNCADO',
        formulaKey: 'geometries.CONO_ELIPTICO_TRUNCADO_DESC',
        fallbackFormula: 'EJES SUP / INF',
    },
    {
        type: 'CONO_TRUNCADO_PERIMETRO',
        code: 'MODELO 03',
        titleKey: 'geometries.CONO_TRUNCADO_PERIMETRO',
        fallbackTitle: 'CONO ELÍPTICO TRUNCADO POR PERÍMETRO',
        formulaKey: 'geometries.CONO_TRUNCADO_PERIMETRO_DESC',
        fallbackFormula: 'PERÍMETRO BASE / SUP',
    },
    {
        type: 'PILA_LONGITUDINAL_WINDROW',
        code: 'MODELO 04',
        titleKey: 'geometries.windrow',
        fallbackTitle: 'PILA LONGITUDINAL (WINDROW)',
        formulaKey: 'geometries.windrow_desc',
        fallbackFormula: 'PRISMOIDAL 3D · LARGO / ANCHO / H',
    },
    {
        type: 'ACOPIO_CONTRA_MURO',
        code: 'MODELO 05',
        titleKey: 'geometries.toe_wall',
        fallbackTitle: 'ACOPIO CONTRA MURO',
        formulaKey: 'geometries.toe_wall_desc',
        fallbackFormula: 'CUÑA CONTRA MURO · ÁNGULO',
    },
];

/**
 * GeometrySelection - Selección de Geometría del Sólido para Cubicación Manual (5 modelos).
 * Estándar: Minimalismo Industrial Puro (GEMINI.md).
 */
export const GeometrySelection: React.FC<GeometrySelectionProps> = ({ onSelection, onBack }) => {
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
                            {t('geometries.kicker', 'GEOMETRÍA')}
                        </span>
                        <h1 className="text-h1-header font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                            {t('geometries.title', 'DEL SÓLIDO')}
                        </h1>
                    </div>
                </div>
            </header>

            <section className="flex-1 overflow-y-auto flex flex-col items-center justify-start sm:justify-center p-fib-21 gap-fib-13 z-10">
                {GEOMETRY_CATALOG.map((item) => (
                    <button
                        key={item.type}
                        type="button"
                        onClick={() => onSelection(item.type)}
                        className="w-full max-w-md min-h-[89px] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] rounded-none shadow-none flex items-center justify-between gap-fib-13 px-fib-21 py-fib-13 transition-colors cursor-pointer text-left"
                    >
                        <div className="flex flex-col items-start text-[#0F172A] dark:text-[#F3F4F6] gap-fib-8 min-w-0">
                            <span className="text-microcopy font-bold font-mono tabular-nums tracking-widest text-[#C68346]">
                                {item.code}
                            </span>
                            <span className="text-body-main font-bold tracking-tight leading-tight">
                                {t(item.titleKey, item.fallbackTitle)}
                            </span>
                        </div>
                        <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] text-right shrink-0">
                            {t(item.formulaKey, item.fallbackFormula)}
                        </span>
                    </button>
                ))}
            </section>
        </main>
    );
};
