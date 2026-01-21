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
            className="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 text-slate-600 dark:text-slate-400"
        >
            {i18n.language.toUpperCase().split('-')[0]} | {i18n.language.toUpperCase().split('-')[0] === 'ES' ? 'PT' : (i18n.language.toUpperCase().split('-')[0] === 'EN' ? 'ES' : 'EN')}
        </button>
    );
};
