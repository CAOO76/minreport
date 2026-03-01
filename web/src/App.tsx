import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Register } from './pages/Register';
import { SetPassword } from './pages/SetPassword';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CorporateDashboard } from './pages/CorporateDashboard';
import { SetupAccess } from './pages/SetupAccess';
import { ClientPluginsPage } from './pages/ClientPluginsPage';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ClientLayout from './layouts/ClientLayout';
import MobileLayout from './layouts/MobileLayout';
import MobileLogin from './pages/mobile/MobileLogin';
import MobileDashboard from './pages/mobile/MobileDashboard';
import MobileTools from './pages/mobile/MobileTools';
import MobileProfile from './pages/mobile/MobileProfile';
import { useIsMobile } from './hooks/useIsMobile';
import OfflineIndicator from './components/common/OfflineIndicator';
import AccountSelector from './components/auth/AccountSelector';
import LoadingScreen from './components/common/LoadingScreen';
import ErrorBoundary from './components/common/ErrorBoundary';
import PluginErrorBoundaryDemo from './core/plugins/PluginErrorBoundaryDemo';
import { getAllPlugins } from './core/PluginRegistry';
import { secureContextFactory } from './core/SecureContextFactory';
import { JobProfilesPage } from './pages/JobProfilesPage';
import { StaffPage } from './pages/StaffPage';
import { EmpresaPage } from './pages/b2b/EmpresaPage';
import { AdminsPage } from './pages/b2b/AdminsPage';
import { MetricasPage } from './pages/b2b/MetricasPage';
import { SuscripcionPage } from './pages/b2b/SuscripcionPage';

import { useEffect } from 'react';
import { MinReport } from '@minreport/sdk'; // Importing SDK via Alias

/**
 * PluginInitializer handles the SDK initialization logic globally.
 * It ensures plugins are loaded regardless of whether the user is on mobile or desktop.
 * As a layout route, it must render an Outlet.
 */
const PluginInitializer = () => {
    const { user, profile, currentAccount, loading } = useAuth();

    useEffect(() => {
        const initPlugins = async () => {
            if (!user || !currentAccount || !profile) return;

            const context = {
                accountId: currentAccount.id,
                userId: user.uid,
                userRole: profile.memberships.find((m: any) => m.accountId === currentAccount.id)?.role || 'VIEWER',
                projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'minreport-demo',
                isOffline: !navigator.onLine
            };

            // Only System SUPER_ADMIN sees all plugins.
            const isSystemAdmin = profile.role === 'SUPER_ADMIN';

            const entitlements = isSystemAdmin
                ? getAllPlugins().map((p: any) => p.id)
                : (currentAccount.enabledPlugins || []);

            console.log(`[SDK-INIT] Initializing for ${isSystemAdmin ? 'SystemAdmin' : 'Account:' + currentAccount.id}`, entitlements);

            try {
                await MinReport.Core.initializePlugins((pluginId) => {
                    return secureContextFactory.create(pluginId, context.projectId, context.userId);
                }, entitlements);
                console.log("[SDK-INIT] Plugins initialized successfully");
            } catch (error) {
                console.error("[SDK-INIT] Plugin initialization failed:", error);
            }
        };

        if (!loading) {
            initPlugins();
        }
    }, [currentAccount, user, profile, loading]);

    return <Outlet />;
};

const RequireAuthLayout = () => {
    const { user, profile, currentAccount, loading, switchAccount, signOut } = useAuth();
    const isMobile = useIsMobile();
    const Layout = isMobile ? MobileLayout : ClientLayout;

    if (loading) return <LoadingScreen />;
    if (!user) return <Navigate to="/login" replace />;
    if (!currentAccount) {
        console.log('[E2E-NAV] RequireAuthLayout: No currentAccount, showing Selector');
        return (
            <div className="min-h-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <AccountSelector
                        accounts={(profile?.memberships || []) as any}
                        onSelectAccount={(acc) => switchAccount(acc.accountId)}
                        onCancel={signOut}
                    />
                </div>
            </div>
        );
    }

    console.log(`[E2E-NAV] RequireAuthLayout rendering Layout (${isMobile ? 'Mobile' : 'Desktop'})`);
    return <Layout />;
};

const DashboardRouter = () => {
    const { profile, currentAccount, user } = useAuth();

    const membership = profile?.memberships.find((m: any) => m.accountId === currentAccount?.id);
    const userRole = membership?.role;

    // Detect Enterprise/Business accounts (case-insensitive)
    const type = currentAccount?.type?.toUpperCase();
    const isEnterpriseAccount = type === 'ENTERPRISE' || type === 'BUSINESS';

    // Corporate Logic: Owner of B2B account or BILLING_ONLY role
    const isCorporateView = isEnterpriseAccount && (
        userRole === 'BILLING_ONLY' ||
        user?.uid === currentAccount?.ownerId
    );

    return isCorporateView ? <CorporateDashboard /> : <Dashboard />;
};

const AppRoutes = () => {
    const { user, loading } = useAuth();

    if (loading) return <LoadingScreen />;

    return (
        <Routes>
            {/* Public / Auth Routes */}
            <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
            <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register />} />
            <Route path="/setup-access" element={<SetupAccess />} />
            <Route path="/auth/action" element={<SetPassword />} />

            {/* Login Móvil Independiente (Prioridad sobre rutas protegidas) */}
            <Route path="/mobile/login" element={<MobileLogin />} />

            {/* 📱 Rutas Móviles (Protegidas) */}
            <Route element={<PluginInitializer />}>
                <Route path="/mobile" element={<MobileLayout />}>
                    <Route path="dashboard" element={<MobileDashboard />} />
                    <Route path="tools" element={<MobileTools />} />
                    <Route path="profile" element={<MobileProfile />} />
                    <Route index element={<Navigate to="/mobile/dashboard" replace />} />
                </Route>
            </Route>

            {/* Protected Routes with Client Layout */}
            <Route element={<PluginInitializer />}>
                <Route element={<RequireAuthLayout />}>
                    <Route path="/dashboard" element={<DashboardRouter />} />
                    <Route path="/plugins" element={<ClientPluginsPage />} />
                    <Route path="/job-profiles" element={<JobProfilesPage />} />
                    <Route path="/staff" element={<StaffPage />} />
                    <Route path="/b2b/empresa" element={<EmpresaPage />} />
                    <Route path="/b2b/admins" element={<AdminsPage />} />
                    <Route path="/b2b/metricas" element={<MetricasPage />} />
                    <Route path="/b2b/suscripcion" element={<SuscripcionPage />} />
                    <Route path="/debug/error-boundary" element={<PluginErrorBoundaryDemo />} />
                    <Route path="/capture" element={<div>Capture View (Not implemented)</div>} />
                    <Route path="/menu" element={<div>Menu View (Not implemented)</div>} />
                </Route>
            </Route>

            {/* Root and Fallback */}
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
                        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                            <AppRoutes />
                        </BrowserRouter>
                        <OfflineIndicator />
                    </AuthProvider>
                </BrandingProvider>
            </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
