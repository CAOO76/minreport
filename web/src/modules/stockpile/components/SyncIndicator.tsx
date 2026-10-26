import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSyncStatus } from '../utils/syncStatus';
import { motion, AnimatePresence } from 'framer-motion';

export const SyncIndicator: React.FC = () => {
    const { t } = useTranslation();
    const { status } = useSyncStatus();

    if (status === 'idle') return null;

    const config = {
        uploading:     { icon: 'cloud_upload',   label: t('sync.uploading', 'Subiendo...'),          color: 'text-antigravity-accent' },
        syncing:       { icon: 'cloud_download', label: t('sync.syncing', 'Sincronizando...'),       color: 'text-blue-400' },
        success:       { icon: 'check_circle',   label: t('sync.success', 'Sincronizado'),           color: 'text-green-500' },
        error:         { icon: 'error',          label: t('sync.error', 'Error de Sync'),            color: 'text-red-500' },
        offline:       { icon: 'cloud_off',      label: t('sync.offline', 'Modo Offline'),           color: 'text-zinc-500' },
    }[status] || { icon: 'sync', label: t('sync.processing', 'Procesando...'), color: 'text-zinc-400' };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
            >
                <div className="px-4 py-2 bg-antigravity-light-surface/80 dark:bg-antigravity-dark-surface/80 backdrop-blur-md border border-antigravity-light-border dark:border-antigravity-dark-border rounded-full flex items-center gap-3 shadow-2xl pointer-events-auto">
                    <span className={`material-symbols-outlined text-xl ${config.color} ${status === 'uploading' || status === 'syncing' ? 'animate-pulse' : ''}`}>
                        {config.icon}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-text dark:text-antigravity-dark-text/80">
                        {config.label}
                    </span>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
