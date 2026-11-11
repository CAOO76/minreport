import React, { lazy, Suspense } from 'react';
import { MinReportSessionProvider, useMinReportSession } from './context/MinReportSessionContext';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ClientLayout from './layouts/ClientLayout';
import MobileLayout from './layouts/MobileLayout';
import MobileLogin from './pages/mobile/MobileLogin';
import MobileDashboard from './pages/mobile/MobileDashboard';
import MobileTools from './pages/mobile/MobileTools';
import { useIsMobile } from './hooks/useIsMobile';
import AccountSelector from './components/auth/AccountSelector';
import ErrorBoundary from './components/common/ErrorBoundary';
import { PWAInstallPrompt } from './components/common/PWAInstallPrompt';
import DevImpersonationHUD from './components/dev/DevImpersonationHUD';
import { DevVaultGateway } from './pages/dev/DevVaultGateway';
import type { AccountReference } from './types/user_directory';

// Carga diferida de modulos pesados y consolas (Capa 2 Performance)
const OpermaqModule = lazy(() => import('./modules/opermaq/OpermaqModule').then(m => ({ default: m.OpermaqModule })));
const StockpileModule = lazy(() => import('./modules/stockpile/StockpileModule').then(m => ({ default: m.StockpileModule })));
const SuperAdminConsole = lazy(() => import('./pages/admin/SuperAdminConsole').then(m => ({ default: m.SuperAdminConsole })));
const TestPilotWorkspace = lazy(() => import('./pages/pilot/TestPilotWorkspace').then(m => ({ default: m.TestPilotWorkspace })));
const Register = lazy(() => import('./pages/Register').then(m => ({ default: m.Register })));
const SetupAccess = lazy(() => import('./pages/SetupAccess').then(m => ({ default: m.SetupAccess })));
const SetPassword = lazy(() => import('./pages/SetPassword').then(m => ({ default: m.SetPassword })));
const JobProfilesPage = lazy(() => import('./pages/JobProfilesPage').then(m => ({ default: m.JobProfilesPage })));
const StaffPage = lazy(() => import('./pages/StaffPage').then(m => ({ default: m.StaffPage })));
const EmpresaPage = lazy(() => import('./pages/b2b/EmpresaPage').then(m => ({ default: m.EmpresaPage })));
const AdminsPage = lazy(() => import('./pages/b2b/AdminsPage').then(m => ({ default: m.AdminsPage })));
const BrandingPage = lazy(() => import('./pages/b2b/BrandingPage').then(m => ({ default: m.BrandingPage })));
const MetricasPage = lazy(() => import('./pages/b2b/MetricasPage').then(m => ({ default: m.MetricasPage })));
const SuscripcionPage = lazy(() => import('./pages/b2b/SuscripcionPage').then(m => ({ default: m.SuscripcionPage })));
const MobileProfile = lazy(() => import('./pages/mobile/MobileProfile'));

const RequireAuthLayout = () => {
    const { user, profile, currentAccount, loading, switchAccount, signOut } = useAuth();
    const { session, isLoaded } = useMinReportSession();
    const isMobile = useIsMobile();
    const Layout = isMobile ? MobileLayout : ClientLayout;

    if (loading || !isLoaded) return null;
    if (!user) return <Navigate to="/login" replace />;

    if (session?.isSuperAdmin) {
        return <Navigate to="/admin" replace />;
    }

    if (!currentAccount && !session?.isDevRoot && !session?.isTestPilot) {
        const mappedAccounts: AccountReference[] = (profile?.memberships || [])
            .map((m: any): AccountReference => ({
                accountId: m.accountId || m.id || '',
                authEmail: m.authEmail || user.email || '',
                role: m.role || 'OPERATOR',
                type: m.type || 'BUSINESS',
                avatar: m.avatar,
                accountName: m.accountName || m.companyName || m.name || m.accountId || '[Organización no declarada]',
                status: m.status || 'ACTIVE',
                jobProfileId: m.jobProfileId,
            }))
            .filter((acc) => Boolean(acc.accountId));

        return (
            <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center p-fib-21">
                <div className="w-full max-w-md">
                    <AccountSelector
                        accounts={mappedAccounts}
                        onSelectAccount={(acc) => switchAccount(acc.accountId)}
                        onCancel={signOut}
                    />
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
    const { profile, currentAccount, user } = useAuth();
    const { session, isLoaded } = useMinReportSession();

    if (!isLoaded) return null;
    if (disallowEdu && session?.isEduSandbox) {
        return <Navigate to="/dashboard" replace />;
    }

    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const membershipRole = membership?.role;
    const isOwner = Boolean(currentAccount && user && currentAccount.ownerId === user.uid);
    const isAllowed = Boolean(
        session?.isDevRoot ||
        session?.isSuperAdmin ||
        isOwner ||
        session?.role === 'OWNER' ||
        session?.role === 'ADMIN' ||
        membershipRole === 'OWNER' ||
        membershipRole === 'ADMIN' ||
        (allowBillingOnly && (membershipRole === 'BILLING_ONLY' || membershipRole === 'SUBSCRIPTION_ADMIN' || session?.role === 'BILLING_ONLY'))
    );

    if (!isAllowed) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
};

const RequireModuleAccess: React.FC<{
    moduleKey: 'opermaq' | 'stockpile';
    children: React.ReactElement;
}> = ({ moduleKey, children }) => {
    const { session, isLoaded, hasModuleAccess } = useMinReportSession();

    if (!isLoaded) return null;
    if (session?.isDevRoot || session?.isSuperAdmin || session?.isTestPilot) {
        return children;
    }
    if (!hasModuleAccess(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
};

const DashboardRouter = () => {
    const { profile, currentAccount, user } = useAuth();
    const { session } = useMinReportSession();

    if (session?.isSuperAdmin) {
        return <Navigate to="/admin" replace />;
    }

    const membership = profile?.memberships.find((m: any) => m.accountId === currentAccount?.id);
    const userRole = membership?.role;

    const classification = currentAccount?.classification;
    const type = currentAccount?.type?.toUpperCase();
    const isEnterpriseAccount = classification === 'b2b-corporate' || type === 'ENTERPRISE' || type === 'BUSINESS';

    const isCorporateView = isEnterpriseAccount && (
        userRole === 'BILLING_ONLY' ||
        user?.uid === currentAccount?.ownerId
    );

    return isCorporateView ? <Navigate to="/b2b/empresa" replace /> : <Dashboard />;
};

const AppRoutes = () => {
    const { user, loading } = useAuth();

    return (
        <Routes>
            {/* Public / Auth Routes */}
            <Route path="/login" element={(!loading && user) ? <Navigate to="/dashboard" /> : <Login />} />
            <Route path="/register" element={(!loading && user) ? <Navigate to="/dashboard" /> : <Register />} />
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
                    element={
                        <RequireModuleAccess moduleKey="opermaq">
                            <OpermaqModule domainMode="FLEET" />
                        </RequireModuleAccess>
                    }
                />
                <Route
                    path="/opermaq/simbologia"
                    element={
                        <RequireModuleAccess moduleKey="opermaq">
                            <OpermaqModule domainMode="SYMBOLOGY" />
                        </RequireModuleAccess>
                    }
                />
                <Route path="/stockpile" element={<StockpileModule />} />
                <Route
                    path="/job-profiles"
                    element={
                        <RequireAdminRole>
                            <JobProfilesPage />
                        </RequireAdminRole>
                    }
                />
                <Route
                    path="/staff"
                    element={
                        <RequireAdminRole disallowEdu>
                            <StaffPage />
                        </RequireAdminRole>
                    }
                />
                <Route
                    path="/b2b/empresa"
                    element={
                        <RequireAdminRole allowBillingOnly>
                            <EmpresaPage />
                        </RequireAdminRole>
                    }
                />
                <Route
                    path="/b2b/admins"
                    element={
                        <RequireAdminRole allowBillingOnly>
                            <AdminsPage />
                        </RequireAdminRole>
                    }
                />
                <Route
                    path="/b2b/branding"
                    element={
                        <RequireAdminRole allowBillingOnly>
                            <BrandingPage />
                        </RequireAdminRole>
                    }
                />
                <Route path="/branding" element={<Navigate to="/b2b/branding" replace />} />
                <Route
                    path="/b2b/metricas"
                    element={
                        <RequireAdminRole allowBillingOnly>
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
                    ? <Navigate to="/mobile/login" replace />
                    : <Navigate to={user ? "/dashboard" : "/login"} replace />
            } />
            <Route path="*" element={
                Capacitor.isNativePlatform()
                    ? <Navigate to="/mobile/login" replace />
                    : <Navigate to={user ? "/dashboard" : "/login"} replace />
            } />
        </Routes>
    );
};

function App() {
    return (
        <ErrorBoundary>
            <ThemeProvider>
                <BrandingProvider>
                    <AuthProvider>
                        <MinReportSessionProvider>
                            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                                <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] transition-colors">
                                    <DevImpersonationHUD />
                                    <Suspense fallback={null}>
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
