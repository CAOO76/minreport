import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstallPrompt: React.FC = () => {
    const { t } = useTranslation();
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            if (!sessionStorage.getItem('pwa_prompt_dismissed')) {
                setIsVisible(true);
            }
        };

        window.addEventListener('beforeinstallprompt', handler);
        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
        };
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) return;
        setIsVisible(false);
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setDeferredPrompt(null);
        }
    };

    const handleDismiss = () => {
        setIsVisible(false);
        sessionStorage.setItem('pwa_prompt_dismissed', 'true');
    };

    const isAuthPage = typeof window !== 'undefined' &&
        (window.location.pathname.includes('/login') || window.location.pathname.includes('/register'));

    if (!isVisible || isAuthPage) return null;

    return (
        <div className="fixed bottom-fib-21 left-fib-21 right-fib-21 md:left-auto md:right-fib-21 md:w-96 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none z-[9999] p-fib-21 flex items-start gap-fib-13 font-sans select-none">
            <span className="material-symbols-outlined text-[#C68346] text-[22px] shrink-0 mt-0.5">
                download
            </span>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-fib-8 mb-fib-8">
                    <h3 className="font-bold text-data-dense uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('pwa.install_title', 'Instalar MINREPORT')}
                    </h3>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        title={t('pwa.dismiss', 'Descartar')}
                        aria-label={t('pwa.dismiss', 'Descartar')}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
                <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mb-fib-13 leading-relaxed">
                    {t('pwa.install_desc', 'Instale la aplicación para habilitar operación offline en faena.')}
                </p>
                <button
                    type="button"
                    onClick={handleInstallClick}
                    className="w-full bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono font-bold uppercase py-fib-8 px-fib-13 rounded-none shadow-none transition-colors cursor-pointer"
                >
                    {t('pwa.install_button', 'Instalar Aplicación')}
                </button>
            </div>
        </div>
    );
};

export default PWAInstallPrompt;
