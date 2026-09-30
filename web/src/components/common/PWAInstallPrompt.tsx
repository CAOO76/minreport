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
            // No mostrar si ya fue descartado en la sesión
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

    // No interrumpir flujos críticos de autenticación
    const isAuthPage = typeof window !== 'undefined' && 
        (window.location.pathname.includes('/login') || window.location.pathname.includes('/register'));

    if (!isVisible || isAuthPage) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] shadow-lg z-[9999] p-4 flex gap-4 font-sans select-none">
            <div className="w-10 h-10 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#C68346] text-[20px]">
                    download
                </span>
            </div>
            <div className="flex-1">
                <h3 className="font-bold text-xs uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mb-1">
                    {t('pwa.install_title', 'Instalar MINREPORT')}
                </h3>
                <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] mb-3 leading-normal">
                    {t('pwa.install_desc', 'Instale la aplicación para garantizar acceso offline y mayor rendimiento en terreno.')}
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={handleInstallClick}
                        className="flex-1 bg-[#C68346] hover:opacity-90 text-white text-[10px] font-mono uppercase tracking-wider py-1.5 transition-opacity cursor-pointer"
                    >
                        {t('pwa.install_button', 'Instalar Aplicación')}
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-8 flex items-center justify-center border border-[#E2E8F0] dark:border-[#12151C] text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                        title="Descartar"
                    >
                        <span className="material-symbols-outlined text-[16px]">
                            close
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PWAInstallPrompt;
