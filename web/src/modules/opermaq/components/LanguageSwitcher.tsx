import React from 'react';
import { useTranslation } from 'react-i18next';
import { M3Button } from './M3Button';

export const LanguageSwitcher: React.FC = () => {
    const { i18n } = useTranslation();

    const cycleLanguage = () => {
        const langs = ['es', 'en', 'pt'];
        const currentLang = i18n.language ? i18n.language.substring(0, 2).toLowerCase() : 'es';
        const nextLang = langs[(langs.indexOf(currentLang) + 1) % langs.length] || 'es';
        i18n.changeLanguage(nextLang);
    };

    return (
        <M3Button 
            variant="outline"
            onClick={cycleLanguage}
            className="w-10 h-10 px-0 py-0 flex items-center justify-center font-black uppercase tracking-widest text-[10px] text-black/50 dark:text-white/50 active:bg-black/5 dark:active:bg-white/5 transition-all hover:border-black/20 dark:hover:border-white/20"
            title={i18n.language?.toUpperCase()}
        >
            {i18n.language ? i18n.language.substring(0, 2).toUpperCase() : 'ES'}
        </M3Button>
    );
};
