import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MiningAICopilot } from '../components/ai/MiningAICopilot';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import SecureImage from '../components/common/SecureImage';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useAuth } from '../context/AuthContext';
import { useMinReportSession } from '../context/MinReportSessionContext';
import { CORE_MODULES } from '../core/modules/module-registry';
import { getApiUrl } from '../utils/network';

const ClientLayout = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const isFullBleedModule =
        location.pathname.startsWith('/opermaq') ||
        location.pathname.startsWith('/acopios') ||
        location.pathname.startsWith('/stockpile') ||
        location.pathname.startsWith('/geolapp') ||
        location.pathname.startsWith('/abastecimiento') ||
        location.pathname.startsWith('/supply');
    const [activeFloatingPanel, setActiveFloatingPanel] = useState<'none' | 'copilot'>('none');
    const { signOut: signOutContext, profile, currentAccount, switchAccount } = useAuth();
    const { session, hasModuleAccess } = useMinReportSession();

    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const isSubscriptionAdmin = membership?.role === 'SUBSCRIPTION_ADMIN' || membership?.role === 'BILLING_ONLY';
    const isEduSandbox = Boolean(session?.isEduSandbox);

    const effectiveRole = session?.role || membership?.role;
    const isAdminOrOwner = !isSubscriptionAdmin && Boolean(
        session?.isDevRoot ||
        session?.isSuperAdmin ||
        effectiveRole === 'OWNER' ||
        effectiveRole === 'ADMIN'
    );
    const canViewBilling = Boolean(
        isAdminOrOwner ||
        Boolean((membership as any)?.canViewBilling) ||
        isSubscriptionAdmin
    );

    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `group relative min-w-[48px] min-h-[48px] w-12 h-12 flex items-center justify-center rounded-none shadow-none bg-transparent border-y-0 border-r-0 border-l-2 transition-colors mb-2 cursor-pointer ${
            isActive
                ? 'border-l-[#C68346] text-[#C68346]'
                : 'border-l-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
        }`;

    return (
        <div className="flex flex-col h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] transition-colors select-none">
            {/* 1. BARRA SUPERIOR (HEADER) */}
            <header className="h-16 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between px-fib-21 sticky top-0 z-50">
                <div className="flex items-center gap-fib-21">
                    <BrandLogo variant="logotype" className="h-7 w-auto object-contain" />
                    {session?.coBrandingLogoUrl && (
                        <>
                            <div className="w-[1px] h-6 bg-[#E2E8F0] dark:bg-[#12151C]" />
                            <SecureImage
                                src={
                                    session.coBrandingLogoUrl.startsWith('/api/')
                                        ? getApiUrl(session.coBrandingLogoUrl)
                                        : session.coBrandingLogoUrl
                                }
                                alt={
                                    session.coBrandingName ||
                                    session.tenantName ||
                                    t('core_shell.institutional_logo_alt', 'Logo institucional')
                                }
                                className="h-7 max-w-[140px] object-contain"
                            />
                        </>
                    )}
                    {isEduSandbox && (
                        <span className="px-fib-13 py-1 border border-[#00AEEF]/40 text-[#00AEEF] text-microcopy font-mono tabular-nums uppercase tracking-wider">
                            {t('core_shell.edu_sandbox_banner', {
                                count: session?.maxProjects ?? 3,
                                defaultValue: `ENTORNO ACADÉMICO SANDBOX (EDU) · MÁX. ${session?.maxProjects ?? 3} PROYECTOS`,
                            })}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-fib-13">
                    {(profile?.memberships?.length || 0) > 1 && (
                        <select
                            aria-label={t('core_shell.org_selector_aria', 'Selector de organización')}
                            value={currentAccount?.id || ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    switchAccount(e.target.value);
                                }
                            }}
                            className="h-8 px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none cursor-pointer"
                        >
                            {(profile?.memberships || []).map((m: any) => (
                                <option key={m.accountId} value={m.accountId}>
                                    {(m.accountName || m.companyName || m.accountId)} · {m.role}
                                </option>
                            ))}
                        </select>
                    )}
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {/* 2. SECCION INFERIOR (Sidebar + Escritorio) */}
            <div className="flex flex-1 overflow-hidden relative">
                <aside className="w-20 bg-[#F8FAFC] dark:bg-[#07090D] border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col items-center py-fib-21 z-30 relative transition-colors">
                    <div className="mb-fib-21">
                        <BrandLogo variant="isotype" className="h-10 w-10 object-contain" />
                    </div>

                    <nav
                        aria-label={t('core_shell.primary_nav_aria', 'Navegación principal')}
                        className="flex-1 flex flex-col gap-1"
                    >
                        <NavLink
                            to="/dashboard"
                            className={navLinkClasses}
                            title={t('core_shell.nav_dashboard', 'Panel Principal')}
                        >
                            <span className="material-symbols-outlined text-2xl">dashboard</span>
                            <span className="sr-only">{t('core_shell.nav_dashboard', 'Panel Principal')}</span>
                        </NavLink>
                        {CORE_MODULES.filter((mod) => hasModuleAccess(mod.id)).map((mod) => {
                            return (
                                <Fragment key={mod.id}>
                                    <div className="w-8 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[8px] mx-auto shrink-0" />
                                    {mod.clientNavItems.map((navItem) => {
                                        const navLabel = t(navItem.titleKey, navItem.title);
                                        return (
                                            <NavLink
                                                key={navItem.to}
                                                to={navItem.to}
                                                end={navItem.end}
                                                onClick={
                                                    navItem.resetEvent
                                                        ? () => window.dispatchEvent(new CustomEvent(navItem.resetEvent!))
                                                        : undefined
                                                }
                                                className={navLinkClasses}
                                                title={navLabel}
                                            >
                                                <span className="material-symbols-outlined text-2xl">{navItem.icon}</span>
                                                <span className="sr-only">{navLabel}</span>
                                            </NavLink>
                                        );
                                    })}
                                </Fragment>
                            );
                        })}
                        {!isEduSandbox && isAdminOrOwner && (
                            <>
                                <div className="w-8 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[8px] mx-auto shrink-0" />
                                <NavLink
                                    to="/b2b/equipo"
                                    className={navLinkClasses}
                                    title={t('core_shell.nav_team', 'Equipo y Accesos')}
                                >
                                    <span className="material-symbols-outlined text-2xl">groups</span>
                                    <span className="sr-only">{t('core_shell.nav_team', 'Equipo y Accesos')}</span>
                                </NavLink>
                                <NavLink
                                    to="/b2b/solicitud-equipos"
                                    className={navLinkClasses}
                                    title={t('core_shell.nav_equipment_onboarding', 'Solicitud de Equipos')}
                                >
                                    <span className="material-symbols-outlined text-2xl">precision_manufacturing</span>
                                    <span className="sr-only">{t('core_shell.nav_equipment_onboarding', 'Solicitud de Equipos')}</span>
                                </NavLink>
                            </>
                        )}
                        {canViewBilling && (
                            <>
                                <div className="w-8 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[8px] mx-auto shrink-0" />
                                <NavLink
                                    to="/b2b/empresa"
                                    className={navLinkClasses}
                                    title={t('core_shell.nav_company', 'Datos de la Empresa')}
                                >
                                    <span className="material-symbols-outlined text-2xl">business</span>
                                    <span className="sr-only">{t('core_shell.nav_company', 'Datos de la Empresa')}</span>
                                </NavLink>
                                <NavLink
                                    to="/b2b/metricas"
                                    className={navLinkClasses}
                                    title={t('core_shell.nav_metrics', 'Métricas Operacionales')}
                                >
                                    <span className="material-symbols-outlined text-2xl">bar_chart</span>
                                    <span className="sr-only">{t('core_shell.nav_metrics', 'Métricas Operacionales')}</span>
                                </NavLink>
                                {!isEduSandbox && (
                                    <NavLink
                                        to="/b2b/suscripcion"
                                        className={navLinkClasses}
                                        title={t('core_shell.nav_subscription', 'Contrato y Suscripción')}
                                    >
                                        <span className="material-symbols-outlined text-2xl">receipt_long</span>
                                        <span className="sr-only">{t('core_shell.nav_subscription', 'Contrato y Suscripción')}</span>
                                    </NavLink>
                                )}
                            </>
                        )}
                        {session?.isSuperAdmin && (
                            <NavLink
                                to="/admin"
                                className={navLinkClasses}
                                title={t('core_shell.nav_admin_console', 'Consola 2º ADMIN')}
                            >
                                <span className="material-symbols-outlined text-2xl">admin_panel_settings</span>
                                <span className="sr-only">{t('core_shell.nav_admin_console', 'Consola 2º ADMIN')}</span>
                            </NavLink>
                        )}
                    </nav>

                    <button
                        type="button"
                        onClick={() => signOutContext()}
                        className="min-w-[48px] min-h-[48px] w-12 h-12 flex items-center justify-center rounded-none transition-colors mt-auto text-[#475569] dark:text-[#8A93A6] hover:text-red-500 bg-transparent border-0 cursor-pointer"
                        title={t('auth.logout', 'Cerrar Sesión')}
                        aria-label={t('auth.logout', 'Cerrar Sesión')}
                    >
                        <span className="material-symbols-outlined text-2xl">logout</span>
                    </button>
                </aside>

                {/* ESCRITORIO */}
                <main className={`flex-1 flex flex-col ${isFullBleedModule ? 'p-0 overflow-hidden' : 'overflow-auto'} relative`}>
                    <div className={isFullBleedModule ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'p-fib-34 flex-1'}>
                        <Outlet />
                    </div>
                </main>

                <MiningAICopilot
                    externalOpen={activeFloatingPanel === 'copilot'}
                    hideTrigger={activeFloatingPanel !== 'none'}
                    onOpenChange={(next) => setActiveFloatingPanel(next ? 'copilot' : 'none')}
                />
            </div>
        </div>
    );
};

export default ClientLayout;
