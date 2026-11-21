import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '../core/hooks/usePlatform';

export type ViewState =
    | 'hub'
    | 'calibration'
    | 'faenas'
    | 'home'
    | 'monitoring'
    | 'quick-capture'
    | 'scanner'
    | 'analytics'
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
    onToggleClosure?: () => void;
    onExitModule?: () => void;
    mobileConnectivitySlot?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    currentView,
    onNavigate,
    isDesktopLayout = false,
    embedded = false,
    hasSelectedAsset = false,
    isSelectedAssetClosed = false,
    onTriggerNewMeasurement,
    onToggleClosure,
}) => {
    const { t } = useTranslation();
    const { isNative } = usePlatform();

    const isMobileDetailOrScanner =
        currentView === 'summary' ||
        currentView === 'detail' ||
        currentView === 'scanner' ||
        currentView === 'quick-capture';

    const showCenterCamera = Boolean(
        hasSelectedAsset && (currentView === 'summary' || currentView === 'detail')
    );

    const showMobileBottomNav =
        (isNative || !isDesktopLayout) && showCenterCamera && !isMobileDetailOrScanner;

    const handleClosureAction = () => {
        if (onToggleClosure) {
            onToggleClosure();
            return;
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('minreport:toggle-closure'));
        }
    };

    const navItems: Array<{
        key: string;
        icon: string;
        label: string;
        disabled?: boolean;
        isCameraAction?: boolean;
        onClick: () => void;
    }> = [
        {
            key: 'faenas_or_list',
            icon: 'list',
            label: t('nav.stock', 'Acopios'),
            onClick: () => onNavigate('home'),
        },
        {
            key: 'new_measurement',
            icon: 'add_a_photo',
            label: t('nav.new_measurement', 'Nueva Medición'),
            disabled: Boolean(isSelectedAssetClosed),
            isCameraAction: true,
            onClick: () => onTriggerNewMeasurement?.(),
        },
        {
            key: 'toggle_closure',
            icon: isSelectedAssetClosed ? 'lock_open' : 'lock',
            label: isSelectedAssetClosed
                ? t('lifecycle.reopen_action', 'REABRIR CICLO (HITL)')
                : t('lifecycle.close_shipment_action', 'CERRAR POR EMBARQUE'),
            onClick: handleClosureAction,
        },
    ];

    const rootClass = embedded
        ? 'geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200'
        : 'geolapp-scope min-h-[100dvh] w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200';

    return (
        <div className={rootClass}>
            <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
                {children}
            </div>

            {showMobileBottomNav && (
                <nav
                    aria-label={t('nav.primary', 'Navegación principal')}
                    className="shrink-0 w-full min-h-[56px] bg-[#FFFFFF] dark:bg-[#000000] border-t border-[#E2E8F0] dark:border-[#12151C] pb-[env(safe-area-inset-bottom)] flex items-center justify-around z-30 no-print"
                >
                    {navItems.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={item.onClick}
                            disabled={item.disabled}
                            title={item.label}
                            aria-label={item.label}
                            className={`relative flex-1 min-w-[48px] min-h-[56px] bg-transparent border-0 outline-none p-2 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center rounded-none shadow-none ${
                                item.isCameraAction
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
