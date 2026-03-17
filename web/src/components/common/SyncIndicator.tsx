import React, { useState, useEffect } from 'react';
import { CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getOfflineRequests } from '../../utils/indexedDB';

export const SyncIndicator: React.FC = () => {
    const { t } = useTranslation();
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);

    const checkPending = async () => {
        try {
            const requests = await getOfflineRequests();
            setPendingCount(requests.length);
        } catch (e) {
            console.error('Error reading offline requests', e);
        }
    };

    useEffect(() => {
        checkPending();
        
        const handleOnline = () => {
            setIsOnline(true);
            setIsSyncing(true);
            // Simulate sync delay
            setTimeout(() => {
                setIsSyncing(false);
                checkPending(); // Re-check after "sync"
            }, 2000);
        };
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        
        // Intervalo para revisar datos locales
        const interval = setInterval(checkPending, 5000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, []);

    // Return null if online and nothing is pending/syncing
    if (isOnline && pendingCount === 0 && !isSyncing) return null;

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center pointer-events-none transition-all duration-500">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase shadow-lg border ${
                !isOnline 
                    ? 'bg-rose-500/10 text-rose-600 border-rose-500/20 backdrop-blur-md'
                    : isSyncing 
                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/20 backdrop-blur-md'
                        : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 backdrop-blur-md'
            }`}>
                {!isOnline ? (
                    <>
                        <CloudOff size={14} className="animate-pulse" />
                        <span>{t('sync.offline', 'MODO OFFLINE')} {pendingCount > 0 && `(${pendingCount})`}</span>
                    </>
                ) : isSyncing ? (
                    <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>{t('sync.syncing', 'SINCRONIZANDO')}...</span>
                    </>
                ) : (
                    <>
                        <CheckCircle2 size={14} />
                        <span>{t('sync.synced', 'ACTUALIZADO')}</span>
                    </>
                )}
            </div>
        </div>
    );
};

export default SyncIndicator;
