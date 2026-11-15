import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { ModuleHost, M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import type { GeolappDomainMode } from '../../core/modules/module-registry';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import ErgonomicScaleSwitch from '../../components/common/ErgonomicScaleSwitch';

export const DevFieldTestModuleShell: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();
    const { isOnline } = useNetworkStatus();
    const [domainMode, setDomainMode] = useState<GeolappDomainMode>('STOCKPILE');

    useEffect(() => {
        if (isLoaded && session && !session.isDevRoot) {
            void auth.signOut().catch(() => {});
        }
    }, [isLoaded, session]);

    if (!isLoaded) {
        return (
            <div className="h-[100dvh] w-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-34">
                <div className="w-full max-w-md">
                    <M3ModuleHudFallback label={t('core_shell.loading_geolapp_stockpile', 'CARGANDO GEOLAPP · CONTROL DE STOCKPILES')} />
                </div>
            </div>
        );
    }

    if (!session || !session.isDevRoot) {
        return <Navigate to="/mobile/dev-login" replace />;
    }

    return (
        <div className="h-[100dvh] w-screen flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden select-none font-sans antialiased">
            <header className="h-14 px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between shrink-0 z-40">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <button
                        type="button"
                        onClick={() => navigate('/mobile/dev-launchpad')}
                        title={t('core_dev_fieldtest.module_shell.back_to_launchpad')}
                        aria-label={t('core_dev_fieldtest.module_shell.back_to_launchpad')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#C68346] transition-colors cursor-pointer flex items-center justify-center rounded-none shrink-0"
                    >
                        <span className="material-symbols-outlined text-[22px]">arrow_back</span>
                        <span className="sr-only">{t('core_dev_fieldtest.module_shell.back_to_launchpad')}</span>
                    </button>
                    <select
                        aria-label={t('core_shell.modules.stockpile.domain_selector_aria', 'Dominios operativos GEOLAPP®')}
                        value={domainMode}
                        onChange={(e) => setDomainMode(e.target.value as GeolappDomainMode)}
                        className="min-h-[44px] max-w-[200px] px-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-microcopy font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none cursor-pointer truncate"
                    >
                        <option value="STOCKPILE">
                            GEOLAPP® · {t('core_shell.modules.stockpile.nav_stockpile', 'STOCKPILES')}
                        </option>
                        <option value="GEOMENSURA_GEO">
                            GEOLAPP® · {t('core_shell.modules.stockpile.nav_geomensura', 'GEOMENSURA')}
                        </option>
                        <option value="EXPLORACION_SONDAJES">
                            GEOLAPP® · {t('core_shell.modules.stockpile.nav_exploracion', 'EXPLORACIÓN')}
                        </option>
                        <option value="ESTRUCTURAL_HIDRO">
                            GEOLAPP® · {t('core_shell.modules.stockpile.nav_estructural', 'ESTRUCTURAL')}
                        </option>
                    </select>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <span
                        title={isOnline ? 'ONLINE' : 'OFFLINE'}
                        className={`w-2.5 h-2.5 rounded-none ${isOnline ? 'bg-[#00AEEF]' : 'bg-[#C68346]'}`}
                    />
                    <ErgonomicScaleSwitch compact />
                    <ThemeSwitch />
                    <LanguageSwitch />
                </div>
            </header>

            <main className="flex-1 min-h-0 overflow-hidden relative">
                <ModuleHost
                    key={`mobile-geolapp-${domainMode}`}
                    moduleId="stockpile"
                    embedded={true}
                    domainMode={domainMode}
                    hostScope="DEV_GATEWAY"
                    enforceEntitlement={false}
                />
            </main>
        </div>
    );
};

export default DevFieldTestModuleShell;
