import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { syncQueueEngine, SyncState } from '../../core/offline/SyncQueueEngine';
import { ModuleHost, M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import type { GeolappDomainMode } from '../../core/modules/module-registry';
import BrandLogo from '../../components/BrandLogo';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import type { PilotAiContextModule } from '../../components/pilot/TestPilotAiStudio';

const TestPilotAiStudio = lazy(() => import('../../components/pilot/TestPilotAiStudio'));

type PilotView =
    | 'DASHBOARD'
    | 'OPERMAQ_FLEET'
    | 'OPERMAQ_SYMBOLOGY'
    | 'OPERMAQ_MANUFACTURERS'
    | 'OPERMAQ_SUPPLIERS'
    | 'GEOLAPP_STOCKPILE'
    | 'PILOT_AI_STUDIO';

function resolvePilotGeolappDomain(view: PilotView): GeolappDomainMode | null {
    return view === 'GEOLAPP_STOCKPILE' ? 'STOCKPILE' : null;
}

export const TestPilotWorkspace: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();
    const { isOnline } = useNetworkStatus();

    const [activeView, setActiveView] = useState<PilotView>('DASHBOARD');
    const [aiContextModule, setAiContextModule] = useState<PilotAiContextModule>('core');
    const [fleetCount, setFleetCount] = useState<number | null>(null);
    const [stockpileCount, setStockpileCount] = useState<number | null>(null);
    const [syncState, setSyncState] = useState<SyncState>(() => syncQueueEngine.getState());

    const handleSelectView = (view: PilotView) => {
        if (view.startsWith('GEOLAPP_')) {
            setAiContextModule('geolapp');
        } else if (view.startsWith('OPERMAQ_')) {
            setAiContextModule('opermaq');
        } else if (view === 'DASHBOARD') {
            setAiContextModule('core');
        }
        setActiveView(view);
    };

    const sandboxTenantId = useMemo(() => {
        if (!session) return '';
        return session.tenantId || `pilot-${session.uid}`;
    }, [session]);

    useEffect(() => {
        const unsubscribe = syncQueueEngine.subscribe((next) => {
            setSyncState(next);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        let active = true;
        const loadSandboxCounts = async () => {
            if (!session?.isTestPilot || session.pilotExpired || !sandboxTenantId) {
                return;
            }
            try {
                const [fleetSnap, stockpileSnap] = await Promise.all([
                    getCountFromServer(query(collection(db, 'tenant_assets'), where('tenantId', '==', sandboxTenantId))),
                    getCountFromServer(query(collection(db, 'stockpiles'), where('tenantId', '==', sandboxTenantId))),
                ]);
                if (!active) return;
                setFleetCount(fleetSnap.data().count);
                setStockpileCount(stockpileSnap.data().count);
            } catch {
                if (!active) return;
                setFleetCount(null);
                setStockpileCount(null);
            }
        };

        void loadSandboxCounts();
        return () => {
            active = false;
        };
    }, [sandboxTenantId, session?.isTestPilot, session?.pilotExpired]);

    const handleLogout = async () => {
        try {
            await auth.signOut();
        } catch {
            // Cierre resiliente local aunque no exista red
        }
        navigate('/access', { replace: true });
    };

    if (!isLoaded) {
        return (
            <div className="h-screen w-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-34">
                <div className="w-full max-w-md">
                    <M3ModuleHudFallback label={t('core_pilot_ws.loading_session')} />
                </div>
            </div>
        );
    }

    if (!session) {
        return <Navigate to="/access" replace />;
    }

    if (session.isDevRoot) {
        return <Navigate to="/dev" replace />;
    }

    if (session.isSuperAdmin) {
        return <Navigate to="/admin" replace />;
    }

    if (!session.isTestPilot) {
        return <Navigate to="/dashboard" replace />;
    }

    if (session.pilotExpired) {
        return (
            <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none">
                <header className="h-16 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between">
                    <BrandLogo variant="logotype" className="h-6 w-auto object-contain pointer-events-none" />
                    <div className="flex items-center gap-fib-13">
                        <ThemeSwitch />
                        <LanguageSwitch />
                    </div>
                </header>
                <main className="flex-1 flex items-center justify-center p-fib-34">
                    <div className="w-full max-w-lg border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-34 rounded-none shadow-none space-y-fib-21">
                        <div className="flex items-center gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <span className="material-symbols-outlined text-[24px] text-[#C68346]">schedule</span>
                            <h1 className="text-h1-header font-semibold uppercase tracking-tight">
                                {t('core_pilot_ws.expired_title')}
                            </h1>
                        </div>
                        <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                            {t('core_pilot_ws.expired_desc')}
                        </p>
                        <div className="pt-fib-8 flex justify-end">
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="min-h-[48px] px-fib-21 py-fib-13 bg-[#C68346] hover:bg-[#B0743E] text-white font-mono font-bold text-microcopy uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer transition-colors"
                            >
                                {t('core_pilot_ws.nav.logout')}
                            </button>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    const activeGeolappDomain = resolvePilotGeolappDomain(activeView);

    const navItems: Array<{ id: PilotView; icon: string; label: string }> = [
        { id: 'DASHBOARD', icon: 'space_dashboard', label: t('core_pilot_ws.nav.dashboard') },
        { id: 'OPERMAQ_FLEET', icon: 'precision_manufacturing', label: t('core_pilot_ws.nav.fleet') },
        { id: 'OPERMAQ_SYMBOLOGY', icon: 'legend_toggle', label: t('core_pilot_ws.nav.symbology') },
        { id: 'OPERMAQ_MANUFACTURERS', icon: 'factory', label: t('core_pilot_ws.nav.manufacturers') },
        { id: 'OPERMAQ_SUPPLIERS', icon: 'storefront', label: t('core_pilot_ws.nav.suppliers') },
        { id: 'GEOLAPP_STOCKPILE', icon: 'layers', label: t('core_pilot_ws.nav.geolapp_stockpile') },
        { id: 'PILOT_AI_STUDIO', icon: 'psychology', label: t('core_pilot_ws.nav.ai_studio') },
    ];

    return (
        <div className="h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none antialiased overflow-hidden">
            {/* Barra superior B2B replicada sobre sandbox aislado 3º TEST-PILOT */}
            <header className="h-16 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between shrink-0 z-40">
                <div className="flex items-center gap-fib-21 min-w-0">
                    <button
                        type="button"
                        onClick={() => handleSelectView('DASHBOARD')}
                        title={t('core_pilot_ws.nav.dashboard')}
                        aria-label={t('core_pilot_ws.nav.dashboard')}
                        className="min-h-[48px] bg-transparent border-0 outline-none p-0 cursor-pointer flex items-center shrink-0"
                    >
                        <BrandLogo variant="logotype" className="h-6 w-auto object-contain pointer-events-none" />
                    </button>

                    <div className="hidden sm:flex items-center gap-fib-13 border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-21 min-w-0">
                        <span className="text-microcopy font-mono uppercase tracking-widest text-[#C68346] truncate">
                            {session.tenantName}
                        </span>
                        <span className="text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text truncate">
                            {sandboxTenantId}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-fib-13 shrink-0">
                    <span
                        title={isOnline ? t('core_pilot_ws.telemetry.online') : t('core_pilot_ws.telemetry.offline')}
                        aria-label={isOnline ? t('core_pilot_ws.telemetry.online') : t('core_pilot_ws.telemetry.offline')}
                        className={`hidden md:inline-flex items-center p-1 ${isOnline ? 'text-[#00AEEF]' : 'text-[#C68346]'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{isOnline ? 'wifi' : 'wifi_off'}</span>
                    </span>

                    <button
                        type="button"
                        onClick={() => handleSelectView('PILOT_AI_STUDIO')}
                        title={t('core_pilot_ws.ai_studio.open_button_title')}
                        aria-label={t('core_pilot_ws.ai_studio.open_button_title')}
                        className={`bg-transparent border-0 outline-none p-1 transition-colors cursor-pointer flex items-center justify-center rounded-none ${activeView === 'PILOT_AI_STUDIO'
                            ? 'text-[#C68346]'
                            : 'text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                            }`}
                    >
                        <span className="material-symbols-outlined text-[22px]">psychology</span>
                        <span className="sr-only">{t('core_pilot_ws.ai_studio.open_button_title')}</span>
                    </button>

                    <ThemeSwitch />
                    <LanguageSwitch />

                    <button
                        type="button"
                        onClick={handleLogout}
                        title={t('core_pilot_ws.nav.logout')}
                        aria-label={t('core_pilot_ws.nav.logout')}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center rounded-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">logout</span>
                        <span className="sr-only">{t('core_pilot_ws.nav.logout')}</span>
                    </button>
                </div>
            </header>

            <div className="flex flex-1 min-h-0 overflow-hidden relative">
                {/* Rail lateral B2B: solo vistas cliente y GEOLAPP®, cero CATÁLOGO maestro */}
                <aside className="w-20 h-full flex flex-col items-center py-fib-21 border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] z-30 shrink-0 gap-fib-8">
                    {navItems.map((item) => {
                        const active = activeView === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => handleSelectView(item.id)}
                                title={item.label}
                                aria-label={item.label}
                                className={`min-w-[48px] min-h-[48px] w-full py-fib-13 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${active
                                    ? 'text-[#C68346]'
                                    : 'text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                                    }`}
                            >
                                {active && (
                                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 bg-[#C68346]" />
                                )}
                                <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
                                <span className="sr-only">{item.label}</span>
                            </button>
                        );
                    })}
                </aside>

                {/* Contenedor principal */}
                <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#000000]">
                    {activeView === 'DASHBOARD' && (
                        <div className="flex-1 min-h-0 overflow-y-auto p-fib-34 space-y-fib-34">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21">
                                <div className="space-y-fib-8">
                                    <p className="text-microcopy font-mono uppercase tracking-widest text-[#C68346]">
                                        {t('core_pilot_ws.dashboard.eyebrow')}
                                    </p>
                                    <h1 className="text-h1-header font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-tight">
                                        {t('core_pilot_ws.dashboard.title')}
                                    </h1>
                                    <p className="text-body-main font-sans text-[#475569] dark:text-[#8A93A6] max-w-3xl">
                                        {t('core_pilot_ws.dashboard.subtitle')}
                                    </p>
                                </div>
                            </div>

                            {/* Macro-Layout Áureo 61.8% / 38.2% idéntico a operativa B2B */}
                            <div className="grid grid-cols-1 lg:grid-cols-[1.618fr_1fr] gap-fib-21 items-start">
                                {/* Área Mayor (61.8%): Módulos operativos B2B sobre sandbox TEST-PILOT */}
                                <section className="space-y-fib-21">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-21">
                                        <button
                                            type="button"
                                            onClick={() => handleSelectView('OPERMAQ_FLEET')}
                                            className="text-left border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none cursor-pointer transition-colors space-y-fib-13"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                                    OPERMAQ
                                                </span>
                                                <span className="material-symbols-outlined text-[22px] text-[#00AEEF]">
                                                    precision_manufacturing
                                                </span>
                                            </div>
                                            <h2 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {t('core_pilot_ws.cards.opermaq_title')}
                                            </h2>
                                            <p className="text-data-dense font-sans text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_pilot_ws.cards.opermaq_desc')}
                                            </p>
                                            <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-baseline justify-between">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_pilot_ws.cards.registered_units')}
                                                </span>
                                                <span className="text-kpi-display font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {fleetCount !== null ? fleetCount : t('core_pilot_ws.pending_record')}
                                                </span>
                                            </div>
                                        </button>

                                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13 flex flex-col justify-between">
                                            <div className="space-y-fib-13">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                                        GEOLAPP®
                                                    </span>
                                                    <span className="material-symbols-outlined text-[22px] text-[#00AEEF]">
                                                        terrain
                                                    </span>
                                                </div>
                                                <h2 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t('core_pilot_ws.cards.geolapp_title')}
                                                </h2>
                                                <p className="text-data-dense font-sans text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_pilot_ws.cards.geolapp_desc')}
                                                </p>
                                            </div>
                                            <div className="space-y-fib-13">
                                                <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-baseline justify-between">
                                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_pilot_ws.cards.registered_stockpiles')}
                                                    </span>
                                                    <span className="text-kpi-display font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {stockpileCount !== null ? stockpileCount : t('core_pilot_ws.pending_record')}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectView('GEOLAPP_STOCKPILE')}
                                                    className="w-full min-h-[44px] px-fib-13 py-1 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] text-microcopy font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer transition-colors"
                                                >
                                                    {t('core_pilot_ws.nav.geolapp_stockpile')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Accesos transversales OPERMAQ en modo cliente */}
                                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                        <p className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_pilot_ws.sections.client_catalogs')}
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                                            <button
                                                type="button"
                                                onClick={() => handleSelectView('OPERMAQ_SYMBOLOGY')}
                                                className="min-h-[48px] px-fib-13 py-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] text-left flex items-center justify-between cursor-pointer rounded-none shadow-none transition-colors"
                                            >
                                                <span className="text-data-dense font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t('core_pilot_ws.nav.symbology')}
                                                </span>
                                                <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">arrow_forward</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleSelectView('OPERMAQ_MANUFACTURERS')}
                                                className="min-h-[48px] px-fib-13 py-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] text-left flex items-center justify-between cursor-pointer rounded-none shadow-none transition-colors"
                                            >
                                                <span className="text-data-dense font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t('core_pilot_ws.nav.manufacturers')}
                                                </span>
                                                <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">arrow_forward</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleSelectView('OPERMAQ_SUPPLIERS')}
                                                className="min-h-[48px] px-fib-13 py-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] text-left flex items-center justify-between cursor-pointer rounded-none shadow-none transition-colors"
                                            >
                                                <span className="text-data-dense font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t('core_pilot_ws.nav.suppliers')}
                                                </span>
                                                <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">arrow_forward</span>
                                            </button>
                                        </div>
                                    </div>
                                </section>

                                {/* Área Menor (38.2%): Telemetría sandbox y reserva arquitectónica IA */}
                                <aside className="space-y-fib-21">
                                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                        <p className="text-microcopy font-mono uppercase tracking-wider text-[#C68346]">
                                            {t('core_pilot_ws.telemetry.title')}
                                        </p>
                                        <dl className="space-y-fib-13 text-data-dense font-mono">
                                            <div className="flex justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_pilot_ws.telemetry.account_type')}
                                                </dt>
                                                <dd className="text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                                                    3º TEST-PILOT
                                                </dd>
                                            </div>
                                            <div className="flex justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_pilot_ws.telemetry.sync_pending')}
                                                </dt>
                                                <dd className="tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {syncState.pendingCount}
                                                </dd>
                                            </div>
                                            <div className="flex justify-between gap-fib-8">
                                                <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_pilot_ws.telemetry.isolation_scope')}
                                                </dt>
                                                <dd className="text-[#00AEEF]">
                                                    SANDBOX
                                                </dd>
                                            </div>
                                        </dl>
                                    </div>

                                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                        <div className="flex items-center justify-between gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase tracking-wider text-[#00AEEF]">
                                                {t('core_pilot_ws.ai_future.eyebrow')}
                                            </span>
                                            <span className="material-symbols-outlined text-[22px] text-[#00AEEF]">
                                                psychology
                                            </span>
                                        </div>
                                        <h2 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                            {t('core_pilot_ws.ai_future.title')}
                                        </h2>
                                        <p className="text-data-dense font-sans text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_pilot_ws.ai_studio.subtitle')}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => handleSelectView('PILOT_AI_STUDIO')}
                                            className="w-full min-h-[48px] px-fib-13 py-fib-8 border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#C68346] text-microcopy font-mono uppercase tracking-wider text-[#00AEEF] cursor-pointer rounded-none shadow-none transition-colors"
                                        >
                                            {t('core_pilot_ws.ai_future.open_studio')}
                                        </button>
                                    </div>
                                </aside>
                            </div>
                        </div>
                    )}

                    {activeView === 'OPERMAQ_FLEET' && (
                        <ModuleHost moduleId="opermaq" embedded={true} domainMode="FLEET" hostScope="CLIENT" enforceEntitlement={false} />
                    )}
                    {activeView === 'OPERMAQ_SYMBOLOGY' && (
                        <ModuleHost moduleId="opermaq" embedded={true} domainMode="SYMBOLOGY" hostScope="CLIENT" enforceEntitlement={false} />
                    )}
                    {activeView === 'OPERMAQ_MANUFACTURERS' && (
                        <ModuleHost moduleId="opermaq" embedded={true} domainMode="MANUFACTURERS" hostScope="CLIENT" enforceEntitlement={false} />
                    )}
                    {activeView === 'OPERMAQ_SUPPLIERS' && (
                        <ModuleHost moduleId="opermaq" embedded={true} domainMode="SUPPLIERS" hostScope="CLIENT" enforceEntitlement={false} />
                    )}
                    {activeGeolappDomain !== null && (
                        <ModuleHost
                            key={`pilot-geolapp-${activeGeolappDomain}`}
                            moduleId="stockpile"
                            embedded={true}
                            domainMode={activeGeolappDomain}
                            hostScope="TEST_PILOT"
                            enforceEntitlement={false}
                        />
                    )}
                    {activeView === 'PILOT_AI_STUDIO' && (
                        <Suspense fallback={<M3ModuleHudFallback label={t('core_pilot_ws.nav.ai_studio')} />}>
                            <TestPilotAiStudio activeContextModule={aiContextModule} />
                        </Suspense>
                    )}
                </main>
            </div>
        </div>
    );
};

export default TestPilotWorkspace;
