import React, { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { MinReportSessionProvider, useMinReportSession, resolveSessionHomePath } from './context/MinReportSessionContext';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Dashboard } from './pages/Dashboard';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ClientLayout from './layouts/ClientLayout';
import MobileLayout from './layouts/MobileLayout';
import { useIsMobile } from './hooks/useIsMobile';
import AccountSelector from './components/auth/AccountSelector';
import ErrorBoundary from './components/common/ErrorBoundary';
import { PWAInstallPrompt } from './components/common/PWAInstallPrompt';
import { LanguageSwitch } from './components/LanguageSwitch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { ModuleHost, M3ModuleHudFallback } from './core/modules/ModuleHost';
import { isFieldTestApp } from './core/runtime/appFlavor';
import { isDevPrivateReleaseStage } from './config/releaseStage';
import type { AccountReference } from './types/user_directory';

// Carga diferida de módulos pesados, cabinas y rutas móviles (Capa 2 Performance)
const DevVaultGateway = lazy(() => import('./pages/dev/DevVaultGateway').then(m => ({ default: m.DevVaultGateway })));
const MobileLogin = lazy(() => import('./pages/mobile/MobileLogin'));
const MobileDashboard = lazy(() => import('./pages/mobile/MobileDashboard'));
const MobileTools = lazy(() => import('./pages/mobile/MobileTools'));
const DevFieldTestLogin = lazy(() => import('./pages/mobile/DevFieldTestLogin'));
const DevFieldTestLaunchpad = lazy(() => import('./pages/mobile/DevFieldTestLaunchpad').then(m => ({ default: m.DevFieldTestLaunchpad })));
const DevFieldTestModuleShell = lazy(() => import('./pages/mobile/DevFieldTestModuleShell').then(m => ({ default: m.DevFieldTestModuleShell })));
const SuperAdminConsole = lazy(() => import('./pages/admin/SuperAdminConsole').then(m => ({ default: m.SuperAdminConsole })));
const TestPilotWorkspace = lazy(() => import('./pages/pilot/TestPilotWorkspace').then(m => ({ default: m.TestPilotWorkspace })));
const AccessPage = lazy(() => import('./pages/AccessPage').then(m => ({ default: m.AccessPage })));
const SetupAccess = lazy(() => import('./pages/SetupAccess').then(m => ({ default: m.SetupAccess })));
const SetPassword = lazy(() => import('./pages/SetPassword').then(m => ({ default: m.SetPassword })));
const EquipoPage = lazy(() => import('./pages/b2b/EquipoPage').then(m => ({ default: m.EquipoPage })));
const EquipmentOnboardingPage = lazy(() => import('./pages/b2b/EquipmentOnboardingPage').then(m => ({ default: m.EquipmentOnboardingPage })));
const EmpresaPage = lazy(() => import('./pages/b2b/EmpresaPage').then(m => ({ default: m.EmpresaPage })));
const MetricasPage = lazy(() => import('./pages/b2b/MetricasPage').then(m => ({ default: m.MetricasPage })));
const SuscripcionPage = lazy(() => import('./pages/b2b/SuscripcionPage').then(m => ({ default: m.SuscripcionPage })));
const MobileProfile = lazy(() => import('./pages/mobile/MobileProfile'));

const RequireAuthLayout = () => {
    const { t } = useTranslation();
    const { user, profile, currentAccount, loading, isMfaVerified, switchAccount, signOut } = useAuth();
    const { session, isLoaded } = useMinReportSession();
    const isMobile = useIsMobile();
    const Layout = isMobile ? MobileLayout : ClientLayout;

    if (loading || !isLoaded) {
        return <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session', 'VERIFICANDO SESIÓN SOBERANA')} />;
    }
    if (!user && !(Capacitor.isNativePlatform() && session)) {
        return <Navigate to={Capacitor.isNativePlatform() ? '/mobile/login' : '/access'} replace />;
    }

    const isDesktop = !isMobile && !Capacitor.isNativePlatform();
    if (isDesktop && !isMfaVerified && !session?.isDevRoot) {
        return <Navigate to="/access?step=otp" replace />;
    }

    // Aislamiento hermético: 3º TEST-PILOT opera exclusivamente en /pilot y 1º DEV sin cuenta B2B en /dev
    if (session?.isTestPilot) {
        return <Navigate to="/pilot" replace />;
    }
    if (session?.isDevRoot && !currentAccount) {
        return <Navigate to="/dev" replace />;
    }

    if (!currentAccount && !(Capacitor.isNativePlatform() && session?.tenantId)) {
        const mappedAccounts: AccountReference[] = (profile?.memberships || [])
            .map((m: any): AccountReference => ({
                accountId: m.accountId || m.id || '',
                authEmail: m.authEmail || user?.email || session?.email || '',
                role: m.role || 'OPERATOR',
                type: m.type || 'BUSINESS',
                avatar: m.avatar,
                accountName:
                    m.accountName ||
                    m.companyName ||
                    m.name ||
                    m.accountId ||
                    t('core_shell.undeclared_org', '[Organización no declarada]'),
                status: m.status || 'ACTIVE',
                jobProfileId: m.jobProfileId,
            }))
            .filter((acc) => Boolean(acc.accountId));

        return (
            <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-21">
                <div className="w-full max-w-md">
                    <div className="flex items-center justify-end gap-fib-8 mb-fib-13">
                        <LanguageSwitch />
                        <ThemeSwitch />
                    </div>
                    <AccountSelector
                        accounts={mappedAccounts}
                        onSelectAccount={(acc) => switchAccount(acc.accountId)}
                        onCancel={signOut}
                    />
                </div>
            </div>
        );
    }

    const accountStatus = String((currentAccount as any)?.status || 'ACTIVE').toUpperCase();
    if (currentAccount && !session?.isDevRoot && !session?.isTestPilot && ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'].includes(accountStatus)) {
        const otherMemberships = (profile?.memberships || []).filter((m: any) => m.accountId && m.accountId !== currentAccount.id);
        return (
            <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-21 select-none">
                <div className="w-full max-w-lg border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-34 rounded-none shadow-none space-y-fib-21">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 gap-fib-8">
                        <span className="text-microcopy font-mono uppercase tracking-widest text-[#C68346]">
                            {accountStatus === 'PENDING_APPROVAL'
                                ? t('core_shell.account_status_pending_approval_title', 'AUTORIZACIÓN EN CURSO')
                                : accountStatus === 'SUSPENDED'
                                    ? t('core_shell.account_status_suspended_title', 'CUENTA SUSPENDIDA')
                                    : t('core_shell.account_status_rejected_title', 'SOLICITUD RECHAZADA')}
                        </span>
                        <div className="flex items-center gap-fib-8">
                            <span className="text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                {currentAccount.id}
                            </span>
                            <LanguageSwitch />
                            <ThemeSwitch />
                        </div>
                    </div>
                    <h1 className="text-h1-header text-[#0F172A] dark:text-[#F3F4F6]">
                        {currentAccount.name ||
                            (currentAccount as any).companyName ||
                            t('core_shell.undeclared_org', '[Organización no declarada]')}
                    </h1>
                    <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                        {accountStatus === 'PENDING_APPROVAL'
                            ? t(
                                'core_shell.account_status_pending_approval_desc',
                                'Solicitud registrada bajo revisión técnica de administración MINREPORT. Acceso operativo bloqueado hasta habilitación.'
                            )
                            : accountStatus === 'SUSPENDED'
                                ? t(
                                    'core_shell.account_status_suspended_desc',
                                    'Acceso operativo suspendido temporalmente para esta organización.'
                                )
                                : t(
                                    'core_shell.account_status_rejected_desc',
                                    'La solicitud de incorporación organizacional no fue autorizada.'
                                )}
                    </p>
                    {otherMemberships.length > 0 && (
                        <div className="space-y-fib-8 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('core_shell.switch_other_org', 'Cambiar a otra organización vinculada')}
                            </p>
                            <div className="space-y-fib-8">
                                {otherMemberships.map((m: any) => {
                                    const rawStatus = String(m.status || 'ACTIVE').toUpperCase();
                                    return (
                                        <button
                                            key={m.accountId}
                                            type="button"
                                            onClick={() => switchAccount(m.accountId)}
                                            className="w-full text-left px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#C68346] text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] flex items-center justify-between rounded-none shadow-none cursor-pointer"
                                        >
                                            <span>{m.accountName || m.companyName || m.accountId}</span>
                                            <span className="text-[#00AEEF] uppercase">
                                                {t(`status.${rawStatus.toLowerCase()}`, rawStatus)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className="pt-fib-8 flex justify-end">
                        <button
                            type="button"
                            onClick={signOut}
                            className="px-fib-21 py-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#C68346] text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                        >
                            {t('auth.logout', 'Cerrar Sesión')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return <Layout />;
};

const RequireAdminRole: React.FC<{
    children: React.ReactElement;
    disallowEdu?: boolean;
    allowBillingOnly?: boolean;
}> = ({ children, disallowEdu = false, allowBillingOnly = false }) => {
    const { t } = useTranslation();
    const { profile, currentAccount, user } = useAuth();
    const { session, isLoaded } = useMinReportSession();

    if (!isLoaded) {
        return <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session', 'VERIFICANDO SESIÓN SOBERANA')} />;
    }
    if (disallowEdu && session?.isEduSandbox) {
        return <Navigate to="/dashboard" replace />;
    }

    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const membershipRole = String(membership?.role || '').toUpperCase();
    const effectiveRole = String(session?.role || membershipRole || '').toUpperCase();
    const isOwner = Boolean(currentAccount && user && currentAccount.ownerId === user.uid);
    const isLegacyBillingOnly = membershipRole === 'BILLING_ONLY' || membershipRole === 'SUBSCRIPTION_ADMIN';
    const canViewerBilling =
        (effectiveRole === 'VIEWER' || membershipRole === 'VIEWER') &&
        Boolean((membership as any)?.canViewBilling);

    const isAllowed = Boolean(
        session?.isDevRoot ||
        session?.isSuperAdmin ||
        isOwner ||
        (!isLegacyBillingOnly && (effectiveRole === 'OWNER' || effectiveRole === 'ADMIN')) ||
        membershipRole === 'OWNER' ||
        membershipRole === 'ADMIN' ||
        (allowBillingOnly && (isLegacyBillingOnly || canViewerBilling))
    );

    if (!isAllowed) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
};

const DashboardRouter = () => {
    const { profile, currentAccount } = useAuth();
    const { session } = useMinReportSession();

    if (session?.isDevRoot && !currentAccount) {
        return <Navigate to="/dev" replace />;
    }

    if (session?.isSuperAdmin) {
        return <Navigate to="/admin" replace />;
    }

    if (session?.isTestPilot) {
        return <Navigate to="/pilot" replace />;
    }

    const membership = profile?.memberships.find((m: any) => m.accountId === currentAccount?.id);
    const userRole = membership?.role;

    const classification = currentAccount?.classification;
    const type = currentAccount?.type?.toUpperCase();
    const isEnterpriseAccount =
        classification === 'b2b' ||
        classification === 'b2b-corporate' ||
        type === 'ENTERPRISE' ||
        type === 'BUSINESS';

    const isCorporateView = isEnterpriseAccount && (
        userRole === 'BILLING_ONLY' ||
        userRole === 'SUBSCRIPTION_ADMIN'
    );

    return isCorporateView ? <Navigate to="/b2b/empresa" replace /> : <Dashboard />;
};

const AppRoutes = () => {
    const { t } = useTranslation();
    const { user, loading, isMfaVerified } = useAuth();
    const { session, isLoaded } = useMinReportSession();

    const authenticatedHome = session && isLoaded
        ? resolveSessionHomePath(session)
        : '/dashboard';
    const desktopNeedsOtp = Boolean(
        user && !Capacitor.isNativePlatform() && !isMfaVerified && !session?.isDevRoot
    );
    const fallbackAuthTarget = !user
        ? '/access'
        : desktopNeedsOtp
            ? '/access?step=otp'
            : authenticatedHome;

    // Variante exclusiva MINREPORT TEST (com.minreport.app.fieldtest): 1º DEV -> Home MINREPORT -> Módulos
    if (isFieldTestApp()) {
        return (
            <Routes>
                <Route path="/mobile/dev-login" element={<DevFieldTestLogin />} />
                <Route path="/mobile/dev-home" element={<DevFieldTestLaunchpad />} />
                <Route path="/mobile/dev-launchpad" element={<Navigate to="/mobile/dev-home" replace />} />
                <Route path="/mobile/dev-acopios" element={<DevFieldTestModuleShell />} />
                <Route path="/mobile/dev-geolapp" element={<Navigate to="/mobile/dev-acopios" replace />} />
                <Route
                    path="/"
                    element={
                        !isLoaded || loading ? (
                            <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session')} />
                        ) : (
                            <Navigate
                                to={session?.isDevRoot ? '/mobile/dev-home' : '/mobile/dev-login'}
                                replace
                            />
                        )
                    }
                />
                <Route
                    path="*"
                    element={
                        !isLoaded || loading ? (
                            <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session')} />
                        ) : (
                            <Navigate
                                to={session?.isDevRoot ? '/mobile/dev-home' : '/mobile/dev-login'}
                                replace
                            />
                        )
                    }
                />
            </Routes>
        );
    }

    // Etapa privada exclusiva 1º DEV en minreport.com: desmonta superficie comercial, B2B, EDU, ADMIN y PILOT
    if (isDevPrivateReleaseStage()) {
        return (
            <Routes>
                <Route path="/dev" element={<DevVaultGateway />} />
                <Route path="/dev-vault-gateway" element={<Navigate to="/dev" replace />} />
                <Route path="/" element={<Navigate to="/dev" replace />} />
                <Route path="*" element={<Navigate to="/dev" replace />} />
            </Routes>
        );
    }

    return (
        <Routes>
            {/* Public / Auth Routes */}
            <Route path="/access" element={<AccessPage />} />
            <Route path="/login" element={<Navigate to="/access" replace />} />
            <Route path="/register" element={<Navigate to="/access?mode=apply" replace />} />
            <Route path="/setup-access" element={<SetupAccess />} />
            <Route path="/auth/action" element={<SetPassword />} />

            {/* 1º DEV - Cabina de Ingenieria Soberana */}
            <Route path="/dev" element={<DevVaultGateway />} />
            <Route path="/dev-vault-gateway" element={<Navigate to="/dev" replace />} />

            {/* 2º ADMIN - Consola Comercial Integrada */}
            <Route path="/admin" element={<SuperAdminConsole />} />

            {/* 3º TEST-PILOT - Espacio Dedicado de Simulacion y Curacion IA */}
            <Route path="/pilot" element={<TestPilotWorkspace />} />

            {/* Login Movil Independiente */}
            <Route path="/mobile/login" element={<MobileLogin />} />

            {/* Rutas Moviles (Protegidas) */}
            <Route path="/mobile" element={<RequireAuthLayout />}>
                <Route path="dashboard" element={<MobileDashboard />} />
                <Route path="tools" element={<MobileTools />} />
                <Route path="profile" element={<MobileProfile />} />
                <Route index element={<Navigate to="/mobile/dashboard" replace />} />
            </Route>

            {/* Rutas Protegidas de Cliente (4º B2B y 5º EDU) */}
            <Route element={<RequireAuthLayout />}>
                <Route path="/dashboard" element={<DashboardRouter />} />
                <Route
                    path="/opermaq"
                    element={<ModuleHost moduleId="opermaq" embedded={true} domainMode="FLEET" />}
                />
                <Route
                    path="/opermaq/simbologia"
                    element={<ModuleHost moduleId="opermaq" embedded={true} domainMode="SYMBOLOGY" />}
                />
                <Route
                    path="/opermaq/fabricantes"
                    element={<ModuleHost moduleId="opermaq" embedded={true} domainMode="MANUFACTURERS" />}
                />
                <Route
                    path="/opermaq/proveedores"
                    element={<ModuleHost moduleId="opermaq" embedded={true} domainMode="SUPPLIERS" />}
                />
                <Route
                    path="/acopios"
                    element={<ModuleHost moduleId="stockpile" embedded={true} domainMode="STOCKPILE" />}
                />
                <Route
                    path="/geolapp/stockpiles"
                    element={<Navigate to="/acopios" replace />}
                />
                <Route
                    path="/geolapp"
                    element={<Navigate to="/acopios" replace />}
                />
                <Route
                    path="/stockpile"
                    element={<Navigate to="/acopios" replace />}
                />
                <Route
                    path="/b2b/equipo"
                    element={
                        <RequireAdminRole disallowEdu>
                            <EquipoPage />
                        </RequireAdminRole>
                    }
                />
                <Route
                    path="/b2b/solicitud-equipos"
                    element={
                        <RequireAdminRole disallowEdu>
                            <EquipmentOnboardingPage />
                        </RequireAdminRole>
                    }
                />
                <Route path="/job-profiles" element={<Navigate to="/b2b/equipo" replace />} />
                <Route path="/staff" element={<Navigate to="/b2b/equipo" replace />} />
                <Route
                    path="/b2b/empresa"
                    element={
                        <RequireAdminRole disallowEdu allowBillingOnly>
                            <EmpresaPage />
                        </RequireAdminRole>
                    }
                />
                <Route path="/b2b/admins" element={<Navigate to="/b2b/equipo" replace />} />
                <Route path="/b2b/branding" element={<Navigate to="/b2b/empresa" replace />} />
                <Route path="/branding" element={<Navigate to="/b2b/empresa" replace />} />
                <Route
                    path="/b2b/metricas"
                    element={
                        <RequireAdminRole disallowEdu allowBillingOnly>
                            <MetricasPage />
                        </RequireAdminRole>
                    }
                />
                <Route
                    path="/b2b/suscripcion"
                    element={
                        <RequireAdminRole disallowEdu allowBillingOnly>
                            <SuscripcionPage />
                        </RequireAdminRole>
                    }
                />

                <Route path="/plugins" element={<Navigate to="/dashboard" replace />} />
            </Route>

            {/* Root & Fallback */}
            <Route path="/" element={
                Capacitor.isNativePlatform()
                    ? (!isLoaded || loading
                        ? <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session')} />
                        : <Navigate to={session ? (session.isDevRoot ? '/mobile/dev-home' : '/mobile/dashboard') : '/mobile/login'} replace />)
                    : (loading ? <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session')} /> : <Navigate to={fallbackAuthTarget} replace />)
            } />
            <Route path="*" element={
                Capacitor.isNativePlatform()
                    ? (!isLoaded || loading
                        ? <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session')} />
                        : <Navigate to={session ? (session.isDevRoot ? '/mobile/dev-home' : '/mobile/dashboard') : '/mobile/login'} replace />)
                    : (loading ? <M3ModuleHudFallback label={t('core_shell.verifying_sovereign_session')} /> : <Navigate to={fallbackAuthTarget} replace />)
            } />
        </Routes>
    );
};

function App() {
    const { t } = useTranslation();
    return (
        <ErrorBoundary>
            <ThemeProvider>
                <BrandingProvider>
                    <AuthProvider>
                        <MinReportSessionProvider>
                            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                                    <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] transition-colors">
                                        <Suspense fallback={<M3ModuleHudFallback label={t('core_shell.loading_minreport_ui')} />}>
                                            <AppRoutes />
                                        </Suspense>
                                        <PWAInstallPrompt />
                                    </div>
                                </BrowserRouter>
                        </MinReportSessionProvider>
                    </AuthProvider>
                </BrandingProvider>
            </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
