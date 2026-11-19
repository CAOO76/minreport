import { useTranslation } from 'react-i18next';
import { resolveNormalizedLang, type SupportedLang } from '../i18n';

const LANG_ORDER: readonly SupportedLang[] = ['es', 'en', 'pt'];

export const LanguageSwitch = () => {
    const { t, i18n } = useTranslation();
    const currentLang = resolveNormalizedLang(i18n.resolvedLanguage || i18n.language);
    const currentIdx = LANG_ORDER.indexOf(currentLang);
    const nextLang = LANG_ORDER[(currentIdx + 1) % LANG_ORDER.length];

    const toggleLanguage = () => {
        try {
            localStorage.setItem('i18nextLng', nextLang);
        } catch {
            // Ignorar errores en almacenamiento restringido
        }
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = nextLang;
        }
        void i18n.changeLanguage(nextLang);
    };

    const label = t('core_common.language_switch_label', {
        current: currentLang.toUpperCase(),
        next: nextLang.toUpperCase(),
        defaultValue: `Idioma actual ${currentLang.toUpperCase()}. Cambiar a ${nextLang.toUpperCase()}`,
    });

    return (
        <button
            type="button"
            onClick={toggleLanguage}
            aria-label={label}
            title={label}
            className="bg-transparent border-0 outline-none p-1 text-microcopy font-bold rounded-none shadow-none text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors uppercase tracking-widest font-mono tabular-nums cursor-pointer flex items-center justify-center shrink-0"
        >
            {currentLang.toUpperCase()}
        </button>
    );
};
