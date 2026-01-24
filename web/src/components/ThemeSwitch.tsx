import { useTheme } from '../context/ThemeContext';

export const ThemeSwitch = () => {
    const { theme, toggleTheme } = useTheme();

    return (
        <button
            onClick={toggleTheme}
            className="p-2 rounded-xl text-slate-500 hover:text-antigravity-accent hover:bg-antigravity-accent/5 dark:hover:bg-antigravity-accent/10 transition-colors border border-transparent hover:border-antigravity-accent/20 bg-white/50 dark:bg-black/20 backdrop-blur-sm"
            aria-label="Toggle Theme"
        >
            <span className="material-symbols-rounded text-xl block">
                {theme === 'light' ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
