import { useEffect, useState } from 'react';

export const ThemeSwitch = () => {
    const [theme, setTheme] = useState(
        localStorage.getItem('admin_theme') || 'light'
    );

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('admin_theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    return (
        <button
            onClick={toggleTheme}
            className="p-2 rounded-none text-slate-500 hover:text-antigravity-accent transition-colors"
            aria-label="Toggle Theme"
        >
            <span className="material-symbols-rounded text-xl block">
                {theme === 'light' ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
