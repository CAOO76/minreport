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

    const getDisplayText = () => {
        const lang = i18n.language?.split('-')[0] || 'es';
        if (lang === 'es') return 'ES | EN';
        if (lang === 'en') return 'EN | PT';
        return 'PT | ES';
    };

    return (
        <button
            onClick={toggleLanguage}
            className="text-[10px] font-bold px-2.5 py-1.5 rounded-none text-slate-500 hover:text-primary transition-all uppercase tracking-widest"
        >
            {getDisplayText()}
        </button>
    );
};
