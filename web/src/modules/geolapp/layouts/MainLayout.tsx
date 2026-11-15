import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '../core/hooks/usePlatform';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { syncQueueEngine, type SyncState } from '../../../core/offline/SyncQueueEngine';
import { M3CircularProgress } from '../../../components/common/M3CircularProgress';

export type ViewState =
    | 'home'
    | 'list'
    | 'capture-select'
    | 'geometry-select'
    | 'capture'
    | 'scanner'
    | 'analytics'
    | 'register'
    | 'dashboard'
    | 'detail'
    | 'summary';

interface MainLayoutProps {
    children: React.ReactNode;
    currentView: ViewState;
    onNavigate: (view: ViewState) => void;
    isDesktopLayout?: boolean;
    embedded?: boolean;
    domainMode?: 'STOCKPILE';
}

const MOBILE_NAV_VIEWS: ViewState[] = ['home', 'list', 'analytics', 'summary', 'detail'];

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    currentView,
    onNavigate,
    isDesktopLayout = false,
    embedded = false,
}) => {
    const { t } = useTranslation();
    const { isNative } = usePlatform();
    const { isOnline } = useNetworkStatus();
    const [syncState, setSyncState] = useState<SyncState>(() => syncQueueEngine.getState());

    useEffect(() => {
        const unsubscribe = syncQueueEngine.subscribe(setSyncState);
        return () => unsubscribe();
    }, []);

    const navItems: Array<{ id: ViewState; icon: string; label: string; isActive: boolean }> = [
        {
            id: 'home',
            icon: 'home',
            label: t('nav.home', 'Inicio'),
            isActive: currentView === 'home',
        },
        {
            id: 'list',
            icon: 'list_alt',
            label: t('nav.stock', 'Stockpiles'),
            isActive:
                currentView === 'list' ||
                currentView === 'dashboard' ||
                currentView === 'detail' ||
                currentView === 'summary',
        },
        {
            id: 'capture-select',
            icon: 'add_a_photo',
            label: t('nav.new_capture', 'Nueva Captura'),
            isActive:
                currentView === 'capture-select' ||
                currentView === 'geometry-select' ||
                currentView === 'capture' ||
                currentView === 'scanner' ||
                currentView === 'register',
        },
        {
            id: 'analytics',
            icon: 'analytics',
            label: t('nav.analytics', 'Analítica'),
            isActive: currentView === 'analytics',
        },
    ];

    const showMobileBottomNav =
        (isNative || !isDesktopLayout) && MOBILE_NAV_VIEWS.includes(currentView);

    const rootClass = embedded
        ? 'geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200'
        : 'geolapp-scope min-h-[100dvh] w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200';

    return (
        <div className={rootClass}>
            {/* Real-time Offline / Sync Telemetry Strip (only rendered when offline, syncing, or pending queue items exist) */}
            {(!isOnline || syncState.isSyncing || syncState.pendingCount > 0) && (
                <div
                    role="status"
                    className="shrink-0 w-full px-fib-21 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13 text-data-dense font-mono tabular-nums no-print"
                >
                    <div className="flex items-center gap-fib-8 text-[#475569] dark:text-[#8A93A6]">
                        {syncState.isSyncing ? (
                            <M3CircularProgress
                                indeterminate
                                size={14}
                                strokeWidth={2.5}
                                ariaLabel={t('status.syncing', 'Sincronizando registros')}
                            />
                        ) : (
                            <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                {!isOnline ? 'cloud_off' : 'sync_problem'}
                            </span>
                        )}
                        <span className="text-microcopy font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            {syncState.isSyncing
                                ? t('status.syncing', 'Sincronizando cola offline')
                                : !isOnline
                                  ? t('status.offline_mode', 'Modo Offline Activo')
                                  : t('status.pending_sync', 'Pendientes de sincronización')}
                        </span>
                    </div>
                    {syncState.pendingCount > 0 && (
                        <span className="text-microcopy font-mono font-bold tabular-nums text-[#C68346]">
                            {syncState.pendingCount}
                        </span>
                    )}
                </div>
            )}

            {/* Main Viewport */}
            <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
                {children}
            </div>

            {/* Mobile Minimalist Icon Navigation Bar */}
            {showMobileBottomNav && (
                <nav
                    aria-label={t('nav.primary', 'Navegación principal')}
                    className="shrink-0 w-full bg-[#FFFFFF] dark:bg-[#000000] border-t border-[#E2E8F0] dark:border-[#12151C] px-fib-21 py-fib-8 flex items-center justify-around z-30 no-print"
                >
                    {navItems.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onNavigate(item.id)}
                            title={item.label}
                            aria-label={item.label}
                            aria-current={item.isActive ? 'page' : undefined}
                            className={`bg-transparent border-0 outline-none p-2 transition-colors cursor-pointer flex items-center justify-center rounded-none shadow-none ${
                                item.isActive
                                    ? 'text-[#C68346]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[24px] leading-none">
                                {item.icon}
                            </span>
                        </button>
                    ))}
                </nav>
            )}
        </div>
    );
};
