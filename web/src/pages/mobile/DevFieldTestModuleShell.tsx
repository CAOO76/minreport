import React, { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import { ModuleHost, M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import { MobileConnectivityControl } from '../../components/mobile/MobileAppTopBar';
import {
    XCOVER_HARDWARE_KEY_CODES,
    useXCoverHardwareKey,
} from '../../modules/geolapp/core/hooks/useXCoverHardwareKey';

export const DevFieldTestModuleShell: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();

    useXCoverHardwareKey(
        () => {
            window.dispatchEvent(new CustomEvent('geolapp:quick-capture'));
        },
        {
            enabled: Boolean(isLoaded && session?.isDevRoot),
            action: 'DOWN',
            keyCodes: [XCOVER_HARDWARE_KEY_CODES.XCOVER_SIDE_KEY],
        }
    );

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        let active = true;
        let removeListener: (() => Promise<void>) | undefined;

        CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive && active) {
                void syncQueueEngine.triggerReconnectSync();
            }
        })
            .then((handle) => {
                if (!active) {
                    void handle.remove();
                } else {
                    removeListener = () => handle.remove();
                }
            })
            .catch(() => { });

        return () => {
            active = false;
            if (removeListener) {
                void removeListener();
            }
        };
    }, []);

    useEffect(() => {
        if (isLoaded && session && !session.isDevRoot) {
            void auth.signOut().catch(() => { });
        }
    }, [isLoaded, session]);

    if (!isLoaded) {
        return (
            <div className="h-[100dvh] w-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-34">
                <div className="w-full max-w-md">
                    <M3ModuleHudFallback
                        label={t('core_shell.loading_geolapp_stockpile', 'MINREPORT · ACOPIOS')}
                    />
                </div>
            </div>
        );
    }

    if (!session || !session.isDevRoot) {
        return <Navigate to="/mobile/dev-login" replace />;
    }

    return (
        <div className="h-[100dvh] w-screen flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none font-atkinson antialiased rounded-none shadow-none">
            <main className="flex-1 min-h-0 overflow-hidden relative">
                <ModuleHost
                    key="mobile-acopios-stockpile"
                    moduleId="stockpile"
                    embedded={true}
                    domainMode="STOCKPILE"
                    hostScope="DEV_GATEWAY"
                    enforceEntitlement={false}
                    onExitModule={() => navigate('/mobile/dev-home')}
                    mobileConnectivitySlot={
                        <MobileConnectivityControl
                            allowProtectedLogout
                            logoutRedirectPath="/mobile/dev-login"
                        />
                    }
                />
            </main>
        </div>
    );
};

export default DevFieldTestModuleShell;
