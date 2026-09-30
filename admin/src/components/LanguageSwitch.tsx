import { useTranslation } from 'react-i18next';

export const LanguageSwitch = () => {
    const { i18n } = useTranslation();

    const toggleLanguage = () => {
        const langs = ['es', 'en', 'pt'];
        const currentLang = i18n.language?.split('-')[0] || 'es';
        const currentIdx = langs.indexOf(currentLang);
        const nextLang = langs[(currentIdx + 1) % langs.length];
        i18n.changeLanguage(nextLang);
    };

    const currentLang = (i18n.language?.split('-')[0] || 'es').toUpperCase();

    return (
        <button
            onClick={toggleLanguage}
            className="bg-transparent border-0 outline-none px-2 py-1 text-[11px] font-mono text-neutral-400 hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
            title="Cambiar idioma (ES / EN / PT)"
        >
            [{currentLang}]
        </button>
    );
};
