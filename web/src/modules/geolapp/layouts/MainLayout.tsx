import React from 'react';

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
    | 'summary'
    | 'closure';

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
    embedded = false,
}) => {
    const rootClass = embedded
        ? 'geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200'
        : 'geolapp-scope min-h-[100dvh] w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none rounded-none shadow-none transition-colors duration-200';

    return (
        <div className={rootClass}>
            <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
                {children}
            </div>
        </div>
    );
};
