import React from 'react';
import { useTheme } from '../hooks/useTheme';

/**
 * Dev-only theme toggle button.
 * Only renders when running standalone (not in MINREPORT host).
 */
export const ThemeToggle: React.FC = () => {
    const { isDark, toggleTheme, isDev } = useTheme();

    if (!isDev) return null;

    return (
        <button
            onClick={toggleTheme}
            className="fixed top-4 right-4 z-[9999] w-12 h-12 rounded-full bg-antigravity-accent text-white shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-all"
            title={`Alternar a modo ${isDark ? 'claro' : 'oscuro'}`}
        >
            <span className="material-symbols-outlined text-2xl">
                {isDark ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
