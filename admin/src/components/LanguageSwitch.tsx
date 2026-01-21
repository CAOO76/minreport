import { useTranslation } from 'react-i18next';

export const LanguageSwitch = () => {
    const { i18n } = useTranslation();

    const toggleLanguage = () => {
        const currentLang = i18n.language || 'es';
        const newLang = currentLang.startsWith('es') ? 'en' : 'es';
        i18n.changeLanguage(newLang);
    };

    return (
        <button
            onClick={toggleLanguage}
            className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 hover:text-primary hover:border-primary/30 transition-all uppercase tracking-widest bg-white/50 dark:bg-black/20 backdrop-blur-sm"
        >
            {(i18n.language || 'es').startsWith('es') ? 'ES | EN' : 'EN | ES'}
        </button>
    );
};
