import React from 'react';
import { useTheme } from '../hooks/useTheme';

/**
 * Dev-only theme toggle button.
 * Only renders when running standalone (not in MINREPORT host).
 * Cumple GEMINI.md 3.6: Botón de icono plano y transparente.
 */
export const ThemeToggle: React.FC = () => {
    const { isDark, toggleTheme, isDev } = useTheme();

    if (!isDev) return null;

    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="fixed top-4 right-4 z-[9999] bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
            title={`Alternar a modo ${isDark ? 'claro' : 'oscuro'}`}
        >
            <span className="material-symbols-outlined text-xl">
                {isDark ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
