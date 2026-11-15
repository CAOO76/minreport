import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { syncQueueEngine, SyncState } from '../../core/offline/SyncQueueEngine';
import { getMinReportAppFlavor } from '../../core/runtime/appFlavor';
import { XCOVER_HARDWARE_KEY_CODES, useXCoverHardwareKey } from '../../modules/geolapp/core/hooks/useXCoverHardwareKey';
import BrandLogo from '../../components/BrandLogo';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import ErgonomicScaleSwitch from '../../components/common/ErgonomicScaleSwitch';
import ReadAloudButton from '../../components/common/ReadAloudButton';
import { M3ModuleHudFallback } from '../../core/modules/ModuleHost';

export const DevFieldTestLaunchpad: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();
    const { isOnline } = useNetworkStatus();

    const [syncState, setSyncState] = useState<SyncState>(() => syncQueueEngine.getState());
    const [cameraPerm, setCameraPerm] = useState<string | null>(null);
    const [geoPerm, setGeoPerm] = useState<string | null>(null);

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
        const unsubscribe = syncQueueEngine.subscribe((next) => {
            setSyncState(next);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        let active = true;
        const readPermissions = async () => {
            if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
                return;
            }
            try {
                const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
                if (active) setCameraPerm(cam.state.toUpperCase());
            } catch {
                if (active) setCameraPerm(null);
            }
            try {
                const geo = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
                if (active) setGeoPerm(geo.state.toUpperCase());
            } catch {
                if (active) setGeoPerm(null);
            }
        };
        void readPermissions();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (isLoaded && session && !session.isDevRoot) {
            void auth.signOut().catch(() => {});
        }
    }, [isLoaded, session]);

    if (!isLoaded) {
        return (
            <div className="min-h-[100dvh] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-34">
                <div className="w-full max-w-md">
                    <M3ModuleHudFallback label={t('core_dev_fieldtest.launchpad.loading_session')} />
                </div>
            </div>
        );
    }

    if (!session || !session.isDevRoot) {
        return <Navigate to="/mobile/dev-login" replace />;
    }

    const handleLogout = async () => {
        localStorage.removeItem('dev_auth_token');
        localStorage.removeItem('dev_vault_token');
        try {
            await auth.signOut();
        } catch {
            // Resiliente en terreno sin conectividad
        }
        navigate('/mobile/dev-login', { replace: true });
    };

    const flavor = getMinReportAppFlavor();
    const speechSummary = `${t('core_dev_fieldtest.launchpad.cta_geolapp')}. ${t('core_dev_fieldtest.launchpad.cta_desc')}. ${t('core_dev_fieldtest.launchpad.xcover_key_hint')}`;

    return (
        <div className="min-h-[100dvh] bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none antialiased">
            <header className="h-16 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-fib-13 min-w-0">
                    <BrandLogo variant="logotype" className="h-5 w-auto object-contain pointer-events-none shrink-0" />
                    <div className="hidden sm:flex flex-col border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13 min-w-0">
                        <span className="text-microcopy font-mono uppercase tracking-wider text-[#C68346]">
                            MINREPORT TEST · 1º DEV
                        </span>
                        <span className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] truncate select-text">
                            {session.email}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <ReadAloudButton compact text={speechSummary} />
                    <ErgonomicScaleSwitch compact />
                    <ThemeSwitch />
                    <LanguageSwitch />
                    <button
                        type="button"
                        onClick={handleLogout}
                        title={t('core_dev_vault.nav.logout')}
                        aria-label={t('core_dev_vault.nav.logout')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center rounded-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">logout</span>
                        <span className="sr-only">{t('core_dev_vault.nav.logout')}</span>
                    </button>
                </div>
            </header>

            {/* Macro-Layout Paramétrico Áureo (61.8% Acción Única / 38.2% Diagnóstico Real) */}
            <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.618fr_1fr] gap-fib-21 p-fib-21 max-w-6xl w-full mx-auto items-stretch">
                {/* Área Mayor (61.8%): Único Botón Monumental para Ejecutar GEOLAPP® */}
                <section className="flex flex-col justify-center">
                    <button
                        type="button"
                        onClick={launchGeolapp}
                        className="w-full min-h-[260px] lg:min-h-[420px] p-fib-34 bg-[#F8FAFC] dark:bg-[#07090D] border-2 border-[#C68346] hover:bg-[#C68346]/10 dark:hover:bg-[#C68346]/10 rounded-none shadow-none cursor-pointer flex flex-col justify-between text-left transition-colors"
                    >
                        <div className="flex items-center justify-between w-full">
                            <span className="text-microcopy font-mono uppercase tracking-widest text-[#C68346]">
                                {t('core_dev_fieldtest.launchpad.module_tag')}
                            </span>
                            <span className="material-symbols-outlined text-[36px] text-[#00AEEF]">terrain</span>
                        </div>

                        <div className="space-y-fib-13 my-fib-21">
                            <h1 className="text-h1-header sm:text-kpi-display font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('core_dev_fieldtest.launchpad.cta_geolapp')}
                            </h1>
                            <p className="text-body-main text-[#475569] dark:text-[#8A93A6] max-w-xl">
                                {t('core_dev_fieldtest.launchpad.cta_desc')}
                            </p>
                        </div>

                        <div className="w-full pt-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13">
                            <span className="text-microcopy font-mono uppercase tracking-wider text-[#00AEEF]">
                                {t('core_dev_fieldtest.launchpad.xcover_key_hint')}
                            </span>
                            <span className="material-symbols-outlined text-[24px] text-[#C68346]">arrow_forward</span>
                        </div>
                    </button>
                </section>

                {/* Área Menor (38.2%): Diagnóstico real de terminal y sincronización */}
                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none flex flex-col justify-between space-y-fib-21">
                    <div className="space-y-fib-21">
                        <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 flex items-center justify-between">
                            <h2 className="text-microcopy font-mono font-bold uppercase tracking-widest text-[#C68346]">
                                {t('core_dev_fieldtest.launchpad.diag_title')}
                            </h2>
                            <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">sensors</span>
                        </div>

                        <dl className="space-y-fib-13 text-data-dense font-mono">
                            <div className="flex justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_dev_fieldtest.launchpad.diag_network')}
                                </dt>
                                <dd className={isOnline ? 'text-[#00AEEF] font-bold' : 'text-[#C68346] font-bold'}>
                                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_dev_fieldtest.launchpad.diag_sync_queue')}
                                </dt>
                                <dd className="tabular-nums text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                                    {syncState.pendingCount}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_dev_fieldtest.launchpad.diag_camera')}
                                </dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {cameraPerm || t('core_common.undeclared_tech_value', '[Información técnica no declarada en ficha]')}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_dev_fieldtest.launchpad.diag_gps')}
                                </dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6]">
                                    {geoPerm || t('core_common.undeclared_tech_value', '[Información técnica no declarada en ficha]')}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-fib-13">
                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_dev_fieldtest.launchpad.diag_flavor')}
                                </dt>
                                <dd className="text-[#C68346] uppercase select-text">
                                    {flavor}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
                        <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {t('core_dev_fieldtest.launchpad.exclusive_dev_footer')}
                        </p>
                    </div>
                </aside>
            </main>
        </div>
    );
};

export default DevFieldTestLaunchpad;
