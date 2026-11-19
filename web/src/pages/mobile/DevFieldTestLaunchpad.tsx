import React, { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { getMinReportAppFlavor } from '../../core/runtime/appFlavor';
import {
    XCOVER_HARDWARE_KEY_CODES,
    useXCoverHardwareKey,
} from '../../modules/geolapp/core/hooks/useXCoverHardwareKey';
import { M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import { MobileAppTopBar } from '../../components/mobile/MobileAppTopBar';
import { SecureImage } from '../../components/common/SecureImage';

interface DevMobileModuleEntry {
    id: string;
    name: string;
    scopeKey: string;
    scopeFallback: string;
    icon: string;
    svgSrc?: string;
    path: string;
}

const DEV_MOBILE_MODULES: readonly DevMobileModuleEntry[] = [
    {
        id: 'geolapp',
        name: 'GEOLAPP®',
        scopeKey: 'core_dev_fieldtest.launchpad.geolapp_scope',
        scopeFallback: 'STOCKPILES Cu',
        icon: 'landscape',
        path: '/mobile/dev-geolapp',
    },
];

export const DevFieldTestLaunchpad: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();

    const launchGeolapp = () => {
        navigate('/mobile/dev-geolapp');
    };

    useXCoverHardwareKey(
        () => {
            launchGeolapp();
        },
        {
            enabled: Boolean(isLoaded && session?.isDevRoot),
            action: 'DOWN',
            keyCodes: [XCOVER_HARDWARE_KEY_CODES.XCOVER_SIDE_KEY],
        }
    );

    useEffect(() => {
        if (isLoaded && session && !session.isDevRoot) {
            void auth.signOut().catch(() => {});
        }
    }, [isLoaded, session]);

    if (!isLoaded) {
        return (
            <div className="h-[100dvh] w-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-34">
                <div className="w-full max-w-md">
                    <M3ModuleHudFallback label={t('core_dev_fieldtest.launchpad.loading_session')} />
                </div>
            </div>
        );
    }

    if (!session || !session.isDevRoot) {
        return <Navigate to="/mobile/dev-login" replace />;
    }

    const flavor = getMinReportAppFlavor();

    return (
        <div className="h-[100dvh] w-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-atkinson select-none antialiased overflow-hidden rounded-none shadow-none">
            <MobileAppTopBar
                homePath="/mobile/dev-home"
                showConnectivity
                allowProtectedLogout
                logoutRedirectPath="/mobile/dev-login"
                flavorLabel={flavor}
            />

            <main className="flex-1 min-h-0 overflow-y-auto px-fib-21 py-fib-55 max-w-4xl w-full mx-auto">
                <section
                    aria-label={t('core_dev_fieldtest.launchpad.modules_heading', 'MÓDULOS')}
                    className="grid grid-cols-3 sm:grid-cols-4 gap-fib-34 place-items-center"
                >
                    {DEV_MOBILE_MODULES.map((mod) => (
                        <button
                            key={mod.id}
                            type="button"
                            onClick={() => navigate(mod.path)}
                            aria-label={mod.name}
                            title={mod.name}
                            className="min-w-[64px] min-h-[64px] p-fib-13 bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none shadow-none text-[#C68346] hover:opacity-75 transition-opacity"
                        >
                            {mod.svgSrc ? (
                                <SecureImage
                                    src={mod.svgSrc}
                                    alt={mod.name}
                                    className="w-12 h-12 object-contain pointer-events-none"
                                />
                            ) : (
                                <span className="material-symbols-outlined text-[48px] leading-none text-[#C68346]">
                                    {mod.icon}
                                </span>
                            )}
                        </button>
                    ))}
                </section>
            </main>
        </div>
    );
};

export default DevFieldTestLaunchpad;
