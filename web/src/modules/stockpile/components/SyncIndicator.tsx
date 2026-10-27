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
        syncing:       { icon: 'cloud_download', label: t('sync.syncing', 'Sincronizando...'),       color: 'text-[#00AEEF]' },
        success:       { icon: 'check_circle',   label: t('sync.success', 'Sincronizado'),           color: 'text-emerald-500' },
        error:         { icon: 'error',          label: t('sync.error', 'Error de Sync'),            color: 'text-red-500' },
        offline:       { icon: 'cloud_off',      label: t('sync.offline', 'Modo Offline'),           color: 'text-slate-500' },
    }[status] || { icon: 'sync', label: t('sync.processing', 'Procesando...'), color: 'text-slate-400' };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
            >
                <div className="px-4 py-2 bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex items-center gap-3 shadow-none pointer-events-auto">
                    <span className={`material-symbols-outlined text-xl ${config.color} ${status === 'uploading' || status === 'syncing' ? 'animate-pulse' : ''}`}>
                        {config.icon}
                    </span>
                    <span className="text-[11px] font-bold font-mono uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6]">
                        {config.label}
                    </span>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
