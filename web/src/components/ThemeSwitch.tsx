import { useTheme } from '../context/ThemeContext';

export const ThemeSwitch = () => {
    const { theme, toggleTheme } = useTheme();

    return (
        <button
            onClick={toggleTheme}
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center rounded-none"
            aria-label="Toggle Theme"
            title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
        >
            <span className="material-symbols-outlined text-[20px] block">
                {theme === 'light' ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
