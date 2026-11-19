import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import { getMinReportAppFlavor } from '../../core/runtime/appFlavor';
import { ModuleHost, M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import { MobileAppTopBar } from '../../components/mobile/MobileAppTopBar';
import {
    XCOVER_HARDWARE_KEY_CODES,
    useXCoverHardwareKey,
} from '../../modules/geolapp/core/hooks/useXCoverHardwareKey';

export const DevFieldTestModuleShell: React.FC = () => {
    const { t } = useTranslation();
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
                        label={t(
                            'core_shell.loading_geolapp_stockpile',
                            'CARGANDO GEOLAPP® · CONTROL DE STOCKPILES'
                        )}
                    />
                </div>
            </div>
        );
    }

    if (!session || !session.isDevRoot) {
        return <Navigate to="/mobile/dev-login" replace />;
    }

    const flavor = getMinReportAppFlavor();

    return (
        <div className="h-[100dvh] w-screen flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none font-atkinson antialiased rounded-none shadow-none">
            <MobileAppTopBar
                homePath="/mobile/dev-home"
                showConnectivity
                allowProtectedLogout
                logoutRedirectPath="/mobile/dev-login"
                flavorLabel={flavor}
            />

            <main className="flex-1 min-h-0 overflow-hidden relative">
                <ModuleHost
                    key="mobile-geolapp-stockpile"
                    moduleId="stockpile"
                    embedded={true}
                    domainMode="STOCKPILE"
                    hostScope="DEV_GATEWAY"
                    enforceEntitlement={false}
                />
            </main>
        </div>
    );
};

export default DevFieldTestModuleShell;
