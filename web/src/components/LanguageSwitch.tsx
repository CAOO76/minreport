import { useTranslation } from 'react-i18next';

export const LanguageSwitch = () => {
    const { i18n } = useTranslation();

    const toggleLanguage = () => {
        const langs = ['es', 'en', 'pt'];
        const currentIdx = langs.indexOf(i18n.language.split('-')[0]);
        const nextLang = langs[(currentIdx + 1) % langs.length];
        i18n.changeLanguage(nextLang);
    };

    return (
        <button
            onClick={toggleLanguage}
            className="text-[10px] font-bold px-2 py-1 rounded-none border border-slate-300 dark:border-[#12151C] text-slate-500 hover:text-slate-900 dark:hover:text-white hover:border-[#C68346] dark:hover:border-[#C68346] transition-colors uppercase tracking-widest font-mono bg-transparent cursor-pointer"
        >
            {(i18n.language || 'es').startsWith('es') ? 'ES | EN' : (i18n.language.startsWith('en') ? 'EN | PT' : 'PT | ES')}
        </button>
    );
};
