import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { clearOfflineSessionSnapshot } from '../../core/offline/OfflineSessionVault';
import { syncQueueEngine, type SyncState } from '../../core/offline/SyncQueueEngine';
import BrandLogo from '../BrandLogo';

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
    flavorLabel,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isOnline } = useNetworkStatus();

    const [syncState, setSyncState] = useState<SyncState>(() => syncQueueEngine.getState());
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [logoutBlockedMsg, setLogoutBlockedMsg] = useState<string | null>(null);
    const [cameraPerm, setCameraPerm] = useState<string | null>(null);
    const [geoPerm, setGeoPerm] = useState<string | null>(null);

    useEffect(() => {
        if (!showConnectivity) return;
        const unsubscribe = syncQueueEngine.subscribe(setSyncState);
        return () => unsubscribe();
    }, [showConnectivity]);

    useEffect(() => {
        if (!showDiagnostics) {
            setConfirmLogout(false);
            setLogoutBlockedMsg(null);
            return;
        }
        let active = true;
        const readPermissions = async () => {
            if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
            try {
                const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
                if (active) setCameraPerm(cam.state.toUpperCase());
            } catch {
                if (active) setCameraPerm(null);
            }
            try {
                const geo = await navigator.permissions.query({
                    name: 'geolocation' as PermissionName,
                });
                if (active) setGeoPerm(geo.state.toUpperCase());
            } catch {
                if (active) setGeoPerm(null);
            }
        };
        void readPermissions();
        return () => {
            active = false;
        };
    }, [showDiagnostics]);

    const handleProtectedLogout = async () => {
        if (syncState.pendingCount > 0) {
            setConfirmLogout(false);
            setLogoutBlockedMsg(
                `${syncState.pendingCount} ${t('core_dev_fieldtest.launchpad.diag_sync_queue')}`
            );
            return;
        }
        if (!confirmLogout) {
            setConfirmLogout(true);
            setLogoutBlockedMsg(null);
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
        navigate(logoutRedirectPath, { replace: true });
    };

    return (
        <>
            <header className="min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between shrink-0 z-40 rounded-none shadow-none">
                <button
                    type="button"
                    onClick={() => {
                        setShowDiagnostics(false);
                        navigate(homePath);
                    }}
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
                    <div className="flex items-center shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                setShowDiagnostics((prev) => !prev);
                                if (isOnline && syncState.pendingCount > 0) {
                                    void syncQueueEngine.triggerReconnectSync();
                                }
                            }}
                            aria-label={t('core_dev_fieldtest.launchpad.diag_title')}
                            aria-expanded={showDiagnostics}
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
                            {syncState.pendingCount > 0 && (
                                <span className="text-microcopy font-mono font-bold tabular-nums text-[#C68346]">
                                    {syncState.pendingCount}
                                </span>
                            )}
                        </button>
                    </div>
                )}
            </header>

            {showConnectivity && showDiagnostics && (
                <section
                    aria-label={t('core_dev_fieldtest.launchpad.diag_title')}
                    className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none z-30 space-y-fib-13"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#C68346]">
                            {t('core_dev_fieldtest.launchpad.diag_title')}
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowDiagnostics(false)}
                            aria-label={t('core_dev_vault.common.close')}
                            title={t('core_dev_vault.common.close')}
                            className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer flex items-center justify-center rounded-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>

                    <dl className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] text-data-dense font-mono tabular-nums">
                        <div className="py-fib-8 flex items-center justify-between gap-fib-13">
                            <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {t('core_dev_fieldtest.launchpad.diag_network')}
                            </dt>
                            <dd
                                className={
                                    isOnline
                                        ? 'text-[#00AEEF] font-bold'
                                        : 'text-[#C68346] font-bold'
                                }
                            >
                                {isOnline
                                    ? t('core_shell.status_online')
                                    : t('core_shell.status_offline')}
                            </dd>
                        </div>
                        <div className="py-fib-8 flex items-center justify-between gap-fib-13">
                            <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {t('core_dev_fieldtest.launchpad.diag_sync_queue')}
                            </dt>
                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                                {syncState.pendingCount}
                            </dd>
                        </div>
                        <div className="py-fib-8 flex items-center justify-between gap-fib-13">
                            <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {t('core_dev_fieldtest.launchpad.diag_camera')}
                            </dt>
                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {cameraPerm || t('core_common.undeclared_tech_value')}
                            </dd>
                        </div>
                        <div className="py-fib-8 flex items-center justify-between gap-fib-13">
                            <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                {t('core_dev_fieldtest.launchpad.diag_gps')}
                            </dt>
                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {geoPerm || t('core_common.undeclared_tech_value')}
                            </dd>
                        </div>
                        {flavorLabel && (
                            <div className="py-fib-8 flex items-center justify-between gap-fib-13">
                                <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_dev_fieldtest.launchpad.diag_flavor')}
                                </dt>
                                <dd className="text-[#C68346] uppercase select-text">
                                    {flavorLabel}
                                </dd>
                            </div>
                        )}
                    </dl>

                    {logoutBlockedMsg && (
                        <div
                            role="alert"
                            className="border border-[#C68346] bg-[#C68346]/10 px-fib-13 py-fib-8 text-microcopy font-mono font-bold text-[#C68346] rounded-none"
                        >
                            {logoutBlockedMsg}
                        </div>
                    )}

                    {allowProtectedLogout && (
                        <div className="flex items-center justify-end gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            {confirmLogout && (
                                <button
                                    type="button"
                                    onClick={() => setConfirmLogout(false)}
                                    className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                                >
                                    {t('core_dev_vault.common.cancel')}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void handleProtectedLogout()}
                                disabled={syncState.pendingCount > 0}
                                className={`min-h-[48px] px-fib-21 font-mono text-microcopy font-bold uppercase flex items-center gap-fib-8 cursor-pointer rounded-none border transition-colors disabled:opacity-40 ${
                                    confirmLogout
                                        ? 'bg-red-600 border-red-600 text-white'
                                        : 'bg-[#FFFFFF] dark:bg-[#000000] border-[#E2E8F0] dark:border-[#12151C] text-red-600 dark:text-red-400 hover:border-red-500'
                                }`}
                            >
                                <span className="material-symbols-outlined text-[18px]">logout</span>
                                <span>
                                    {confirmLogout
                                        ? t('core_dev_vault.common.confirm')
                                        : t('core_dev_vault.nav.logout')}
                                </span>
                            </button>
                        </div>
                    )}
                </section>
            )}
        </>
    );
};

export default MobileAppTopBar;
