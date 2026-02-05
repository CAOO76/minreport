import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

import { useEffect } from 'react';
import { MinReport } from '@minreport/sdk'; // Importing SDK via Alias

const RequireAuthLayout = () => {
    const { user, profile, currentAccount, loading } = useAuth();
    const isMobile = useIsMobile();
    const Layout = isMobile ? MobileLayout : ClientLayout;

    // Plugin Initialization Effect
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

            const entitlements = profile.entitlements?.pluginsEnabled || [];

            try {
                await MinReport.Core.initializePlugins(context, entitlements);
            } catch (error) {
                console.error("Plugin initialization failed:", error);
            }
        };

        if (!loading) {
            initPlugins();
        }
    }, [currentAccount, user, profile, loading]);

    if (loading) return <LoadingScreen />;
    if (!user) return <Navigate to="/login" replace />;
    if (!currentAccount) return <AccountSelector />;

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


            {/* 📱 Rutas Móviles (Protegidas por MobileLayout y Role Checks) */}
            <Route path="/mobile" element={<MobileLayout />}>
                <Route path="dashboard" element={<MobileDashboard />} />
                <Route path="tools" element={<MobileTools />} />
                <Route path="profile" element={<MobileProfile />} />
                {/* Redirección por defecto */}
                <Route index element={<Navigate to="/mobile/dashboard" replace />} />
            </Route>

            {/* Login Móvil Independiente */}
            <Route path="/mobile/login" element={<MobileLogin />} />

            {/* Protected Routes with Client Layout */}
            <Route element={<RequireAuthLayout />}>
                <Route path="/dashboard" element={<DashboardRouter />} />
                <Route path="/plugins" element={<ClientPluginsPage />} />
                <Route path="/debug/error-boundary" element={<PluginErrorBoundaryDemo />} />
                <Route path="/capture" element={<div>Capture View (Not implemented)</div>} />
                <Route path="/menu" element={<div>Menu View (Not implemented)</div>} />
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


