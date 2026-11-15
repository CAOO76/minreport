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
            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#CBD5E1] hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center rounded-none shadow-none shrink-0"
            aria-label={label}
            title={label}
        >
            <span className="material-symbols-outlined text-[22px] block">
                {theme === 'light' ? 'light_mode' : 'dark_mode'}
            </span>
        </button>
    );
};
