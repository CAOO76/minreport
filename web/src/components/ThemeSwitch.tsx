import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';

export const ThemeSwitch = () => {
    const { t } = useTranslation();
    const { theme, toggleTheme } = useTheme();
    const label =
        theme === 'light'
            ? t('core_common.theme_activate_dark', 'Activar modo oscuro')
            : t('core_common.theme_activate_light', 'Activar modo claro');

    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center rounded-none shadow-none shrink-0"
            aria-label={label}
            title={label}
        >
            <span className="material-symbols-outlined text-[20px] block">
                {theme === 'light' ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
