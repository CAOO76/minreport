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
            className="min-w-[48px] min-h-[48px] px-3 py-2 text-microcopy font-bold rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] text-[#334155] dark:text-[#CBD5E1] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] hover:border-[#C68346] dark:hover:border-[#C68346] transition-colors uppercase tracking-widest font-mono tabular-nums cursor-pointer flex items-center justify-center shrink-0"
        >
            {currentLang.toUpperCase()}
        </button>
    );
};
