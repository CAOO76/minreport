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
            className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 hover:text-antigravity-accent hover:border-antigravity-accent/30 transition-all uppercase tracking-widest bg-white/50 dark:bg-black/20 backdrop-blur-sm"
        >
            {(i18n.language || 'es').startsWith('es') ? 'ES | EN' : (i18n.language.startsWith('en') ? 'EN | PT' : 'PT | ES')}
        </button>
    );
};
