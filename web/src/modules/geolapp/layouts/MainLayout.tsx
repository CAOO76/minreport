import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '../core/hooks/usePlatform';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { syncQueueEngine, type SyncState } from '../../../core/offline/SyncQueueEngine';
import { M3CircularProgress } from '../../../components/common/M3CircularProgress';

export type ViewState =
    | 'faenas'
    | 'home'
    | 'monitoring'
    | 'list'
    | 'quick-capture'
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
    hasSelectedAsset?: boolean;
    isSelectedAssetClosed?: boolean;
    onTriggerNewMeasurement?: () => void;
}

const MOBILE_NAV_VIEWS: ViewState[] = [
    'faenas',
    'home',
    'monitoring',
    'list',
    'analytics',
    'summary',
    'dashboard',
    'detail',
];

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    currentView,
    onNavigate,
    isDesktopLayout = false,
    embedded = false,
    hasSelectedAsset = false,
    isSelectedAssetClosed = false,
    onTriggerNewMeasurement,
}) => {
    const { t } = useTranslation();
    const { isNative } = usePlatform();
    const { isOnline } = useNetworkStatus();
    const [syncState, setSyncState] = useState<SyncState>(() => syncQueueEngine.getState());

    useEffect(() => {
        const unsubscribe = syncQueueEngine.subscribe(setSyncState);
        return () => unsubscribe();
    }, []);

    const showCenterCamera = Boolean(
        hasSelectedAsset &&
            (currentView === 'summary' ||
                currentView === 'dashboard' ||
                currentView === 'detail')
    );

    const navItems: Array<{
        key: string;
        icon: string;
        label: string;
        isActive: boolean;
        disabled?: boolean;
        isCameraAction?: boolean;
        onClick: () => void;
    }> = showCenterCamera
        ? [
              {
                  key: 'faenas_or_list',
                  icon: 'landscape',
                  label: t('nav.stock', 'Acopios'),
                  isActive: false,
                  onClick: () => onNavigate('home'),
              },
              {
                  key: 'new_measurement',
                  icon: 'add_a_photo',
                  label: t('nav.new_measurement', 'Nueva Medición'),
                  isActive: false,
                  disabled: Boolean(isSelectedAssetClosed),
                  isCameraAction: true,
                  onClick: () => onTriggerNewMeasurement?.(),
              },
              {
                  key: 'monitoring',
                  icon: 'monitoring',
                  label: t('monitoring.nav_label', 'Estadísticas'),
                  isActive: false,
                  onClick: () => onNavigate('monitoring'),
              },
          ]
        : [
              {
                  key: 'faenas_or_list',
                  icon: 'landscape',
                  label:
                      currentView === 'faenas'
                          ? t('nav.faenas', 'Faenas')
                          : t('nav.stock', 'Acopios'),
                  isActive:
                      currentView === 'faenas' ||
                      currentView === 'home' ||
                      currentView === 'list',
                  onClick: () => onNavigate('home'),
              },
              {
                  key: 'monitoring',
                  icon: 'monitoring',
                  label: t('monitoring.nav_label', 'Estadísticas'),
                  isActive: currentView === 'monitoring',
                  onClick: () => onNavigate('monitoring'),
              },
          ];

    const showMobileBottomNav =
        (isNative || !isDesktopLayout) && MOBILE_NAV_VIEWS.includes(currentView);

    const rootClass = embedded
        ? 'geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200'
        : 'geolapp-scope min-h-[100dvh] w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200';

    return (
        <div className={rootClass}>
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

            <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
                {children}
            </div>

            {showMobileBottomNav && (
                <nav
                    aria-label={t('nav.primary', 'Navegación principal')}
                    className="shrink-0 w-full bg-[#FFFFFF] dark:bg-[#000000] border-t border-[#E2E8F0] dark:border-[#12151C] pb-[env(safe-area-inset-bottom)] flex items-center justify-around z-30 no-print"
                >
                    {navItems.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={item.onClick}
                            disabled={item.disabled}
                            title={item.label}
                            aria-label={item.label}
                            aria-current={item.isActive ? 'page' : undefined}
                            className={`relative flex-1 min-w-[48px] min-h-[56px] bg-transparent border-0 outline-none p-2 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center rounded-none shadow-none ${
                                item.isActive || item.isCameraAction
                                    ? 'text-[#C68346]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            {item.isActive && (
                                <span
                                    aria-hidden="true"
                                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[#C68346]"
                                />
                            )}
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
