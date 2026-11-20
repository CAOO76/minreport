import React, { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import {
    XCOVER_HARDWARE_KEY_CODES,
    useXCoverHardwareKey,
} from '../../modules/geolapp/core/hooks/useXCoverHardwareKey';
import { M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import { MobileAppTopBar } from '../../components/mobile/MobileAppTopBar';

interface DevMobileModuleEntry {
    id: string;
    name: string;
    icon: string;
    path: string;
}

const DEV_MOBILE_MODULES: readonly DevMobileModuleEntry[] = [
    {
        id: 'stockpile',
        name: 'ACOPIOS',
        icon: 'landscape',
        path: '/mobile/dev-acopios',
    },
];

export const DevFieldTestLaunchpad: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();

    const launchAcopios = () => {
        navigate('/mobile/dev-acopios');
    };

    useXCoverHardwareKey(
        () => {
            launchAcopios();
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

    return (
        <div className="h-[100dvh] w-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-atkinson select-none antialiased overflow-hidden rounded-none shadow-none">
            <MobileAppTopBar
                homePath="/mobile/dev-home"
                showConnectivity
                allowProtectedLogout
                logoutRedirectPath="/mobile/dev-login"
            />

            <main className="flex-1 min-h-0 flex items-center justify-center p-fib-34">
                <section
                    aria-label={t('core_dev_fieldtest.launchpad.modules_heading', 'MÓDULOS')}
                    className="flex items-center justify-center"
                >
                    {DEV_MOBILE_MODULES.map((mod) => (
                        <button
                            key={mod.id}
                            type="button"
                            onClick={() => navigate(mod.path)}
                            aria-label={mod.name}
                            title={mod.name}
                            className="min-w-[88px] min-h-[88px] bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none shadow-none text-[#C68346] hover:opacity-75 transition-opacity"
                        >
                            <span className="material-symbols-outlined text-[60px] leading-none text-[#C68346]">
                                {mod.icon}
                            </span>
                        </button>
                    ))}
                </section>
            </main>
        </div>
    );
};

export default DevFieldTestLaunchpad;
