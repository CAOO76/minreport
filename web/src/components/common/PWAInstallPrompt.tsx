import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
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
            // Mostrar el prompt solo si no fue descartado previamente en la sesión
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

    if (!isVisible) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10 shadow-2xl z-[9999] p-4 flex gap-4 animate-in slide-in-from-bottom-5">
            <div className="w-12 h-12 bg-black/5 dark:bg-white/5 flex items-center justify-center shrink-0">
                <Download className="text-antigravity-accent" size={24} />
            </div>
            <div className="flex-1">
                <h3 className="font-black text-sm uppercase tracking-tight text-black dark:text-white mb-1">
                    {t('pwa.install_title', 'Instalar MINREPORT')}
                </h3>
                <p className="text-[11px] text-black/60 dark:text-white/60 mb-3 leading-tight">
                    {t('pwa.install_desc', 'Instale la aplicación para garantizar acceso offline y mayor rendimiento en terreno.')}
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={handleInstallClick}
                        className="flex-1 bg-antigravity-accent text-white text-[10px] font-black uppercase tracking-wider py-2 transition-transform active:scale-95"
                    >
                        {t('pwa.install_button', 'Instalar')}
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-8 flex items-center justify-center border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};
