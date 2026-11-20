import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { clearOfflineSessionSnapshot } from '../../core/offline/OfflineSessionVault';
import { syncQueueEngine, type SyncState } from '../../core/offline/SyncQueueEngine';
import BrandLogo from '../BrandLogo';
import M3CircularProgress from '../common/M3CircularProgress';

export interface MobileConnectivityControlProps {
    allowProtectedLogout?: boolean;
    logoutRedirectPath?: string;
}

export const MobileConnectivityControl: React.FC<MobileConnectivityControlProps> = ({
    allowProtectedLogout = false,
    logoutRedirectPath = '/mobile/dev-login',
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isOnline } = useNetworkStatus();

    const [syncState, setSyncState] = useState<SyncState>(() => syncQueueEngine.getState());
    const [isOpen, setIsOpen] = useState(false);
    const [confirmLogout, setConfirmLogout] = useState(false);

    useEffect(() => {
        const unsubscribe = syncQueueEngine.subscribe(setSyncState);
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setConfirmLogout(false);
        }
    }, [isOpen]);

    const handleProtectedLogout = async () => {
        if (syncState.pendingCount > 0) {
            setConfirmLogout(false);
            return;
        }
        if (!confirmLogout) {
            setConfirmLogout(true);
            return;
        }

        localStorage.removeItem('dev_auth_token');
        localStorage.removeItem('dev_vault_token');
        await clearOfflineSessionSnapshot();
        try {
            await auth.signOut();
        } catch {
            // Resiliente en terreno sin conectividad
        }
        setIsOpen(false);
        navigate(logoutRedirectPath, { replace: true });
    };

    const hasPending = syncState.pendingCount > 0;

    return (
        <div className="relative flex items-center shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-label={t('core_dev_fieldtest.launchpad.diag_title')}
                aria-expanded={isOpen}
                title={t('core_dev_fieldtest.launchpad.diag_title')}
                className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer flex items-center justify-center gap-1 rounded-none shadow-none"
            >
                <span
                    className={`material-symbols-outlined text-[22px] ${
                        isOnline ? 'text-[#00AEEF]' : 'text-[#C68346]'
                    }`}
                >
                    {isOnline ? 'wifi' : 'wifi_off'}
                </span>
                {hasPending && (
                    <span className="text-microcopy font-mono font-bold tabular-nums text-[#C68346]">
                        {syncState.pendingCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div
                    role="region"
                    aria-label={t('core_dev_fieldtest.launchpad.diag_title')}
                    className="fixed top-[calc(56px+env(safe-area-inset-top))] inset-x-0 z-50 min-h-[48px] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-13 rounded-none shadow-none"
                >
                    <div className="flex items-center gap-fib-8 min-w-0 font-mono text-microcopy font-bold uppercase tabular-nums">
                        {syncState.isSyncing && (
                            <M3CircularProgress
                                indeterminate
                                size={14}
                                strokeWidth={2.5}
                                ariaLabel={t('core_dev_fieldtest.launchpad.diag_sync_queue')}
                            />
                        )}
                        <span className={isOnline ? 'text-[#00AEEF]' : 'text-[#C68346]'}>
                            {isOnline
                                ? t('core_shell.status_online')
                                : t('core_shell.status_offline')}
                        </span>
                        {hasPending && (
                            <span className="text-[#C68346]">
                                · {syncState.pendingCount}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-fib-8 shrink-0">
                        {isOnline && hasPending && (
                            <button
                                type="button"
                                onClick={() => void syncQueueEngine.triggerReconnectSync()}
                                aria-label={t('core_dev_fieldtest.launchpad.diag_sync_queue')}
                                className="min-h-[48px] px-fib-13 bg-transparent border-0 outline-none font-mono text-microcopy font-bold uppercase text-[#00AEEF] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer flex items-center gap-1 rounded-none"
                            >
                                <span className="material-symbols-outlined text-[18px]">sync</span>
                                <span>SYNC</span>
                            </button>
                        )}

                        {allowProtectedLogout && (
                            <div className="flex items-center gap-fib-8">
                                {confirmLogout && (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmLogout(false)}
                                        aria-label={t('core_dev_vault.common.cancel')}
                                        title={t('core_dev_vault.common.cancel')}
                                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer flex items-center justify-center rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            undo
                                        </span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void handleProtectedLogout()}
                                    disabled={hasPending}
                                    aria-label={
                                        confirmLogout
                                            ? t('core_dev_vault.common.confirm')
                                            : t('core_dev_vault.nav.logout')
                                    }
                                    title={
                                        confirmLogout
                                            ? t('core_dev_vault.common.confirm')
                                            : t('core_dev_vault.nav.logout')
                                    }
                                    className={`min-h-[48px] px-fib-8 bg-transparent border-0 outline-none font-mono text-microcopy font-bold uppercase flex items-center gap-1 cursor-pointer rounded-none transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                                        confirmLogout
                                            ? 'text-[#C68346]'
                                            : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[18px]">
                                        logout
                                    </span>
                                    {confirmLogout && (
                                        <span>{t('core_dev_vault.common.confirm')}</span>
                                    )}
                                </button>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            aria-label={t('core_dev_vault.common.close')}
                            title={t('core_dev_vault.common.close')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer flex items-center justify-center rounded-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export interface MobileAppTopBarProps {
    homePath: string;
    showConnectivity?: boolean;
    allowProtectedLogout?: boolean;
    logoutRedirectPath?: string;
    flavorLabel?: string;
}

export const MobileAppTopBar: React.FC<MobileAppTopBarProps> = ({
    homePath,
    showConnectivity = false,
    allowProtectedLogout = false,
    logoutRedirectPath = '/mobile/dev-login',
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    return (
        <header className="min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between shrink-0 z-40 rounded-none shadow-none">
            <button
                type="button"
                onClick={() => navigate(homePath)}
                aria-label={t('core_dev_fieldtest.topbar.home_aria', 'MINREPORT Home')}
                title={t('core_dev_fieldtest.topbar.home_aria', 'MINREPORT Home')}
                className="min-h-[48px] bg-transparent border-0 outline-none p-1 flex items-center cursor-pointer rounded-none shadow-none shrink-0"
            >
                <BrandLogo
                    variant="imagotype"
                    className="h-5 w-auto object-contain pointer-events-none"
                />
            </button>

            {showConnectivity && (
                <MobileConnectivityControl
                    allowProtectedLogout={allowProtectedLogout}
                    logoutRedirectPath={logoutRedirectPath}
                />
            )}
        </header>
    );
};

export default MobileAppTopBar;
