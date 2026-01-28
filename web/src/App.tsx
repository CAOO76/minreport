import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Register } from './pages/Register';
import { SetPassword } from './pages/SetPassword';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ClientPluginsPage } from './pages/ClientPluginsPage';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ClientLayout from './layouts/ClientLayout';
import MobileLayout from './layouts/MobileLayout';
import { useIsMobile } from './hooks/useIsMobile';
import OfflineIndicator from './components/common/OfflineIndicator';
import AccountSelector from './components/auth/AccountSelector';

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

    if (loading) return null; // Or a loading spinner
    if (!user) return <Navigate to="/login" replace />;
    if (!currentAccount) return <AccountSelector />;

    return <Layout />;
};

const AppRoutes = () => {
    const { user, loading } = useAuth();

    if (loading) return null;

    return (
        <Routes>
            {/* Public / Auth Routes */}
            <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
            <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register />} />
            <Route path="/auth/action" element={<SetPassword />} />

            {/* Protected Routes with Layout */}
            <Route element={<RequireAuthLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/plugins" element={<ClientPluginsPage />} />
                <Route path="/capture" element={<div>Capture View (Not implemented)</div>} />
                <Route path="/menu" element={<div>Menu View (Not implemented)</div>} />
            </Route>

            {/* Root and Fallback */}
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
            <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
        </Routes>
    );
};

function App() {
    return (
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
    );
}

export default App;


