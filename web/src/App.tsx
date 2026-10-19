import { lazy, Suspense } from 'react';
import { MinReportSessionProvider } from './context/MinReportSessionContext';
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
import LoadingScreen from './components/common/LoadingScreen';
import ErrorBoundary from './components/common/ErrorBoundary';
import { PWAInstallPrompt } from './components/common/PWAInstallPrompt';
import SyncIndicator from './components/common/SyncIndicator';

// Code-split heavy modules & secondary pages (Capa 2 Performance)
const OpermaqModule = lazy(() => import('./modules/opermaq/OpermaqModule').then(m => ({ default: m.OpermaqModule })));
const StockpileModule = lazy(() => import('./modules/stockpile/StockpileModule').then(m => ({ default: m.StockpileModule })));
const MiningFlowModule = lazy(() => import('./modules/mining-flow/MiningFlowModule').then(m => ({ default: m.MiningFlowModule })));
const CorporateDashboard = lazy(() => import('./pages/CorporateDashboard').then(m => ({ default: m.CorporateDashboard })));
const Register = lazy(() => import('./pages/Register').then(m => ({ default: m.Register })));
const SetupAccess = lazy(() => import('./pages/SetupAccess').then(m => ({ default: m.SetupAccess })));
const SetPassword = lazy(() => import('./pages/SetPassword').then(m => ({ default: m.SetPassword })));
const JobProfilesPage = lazy(() => import('./pages/JobProfilesPage').then(m => ({ default: m.JobProfilesPage })));
const StaffPage = lazy(() => import('./pages/StaffPage').then(m => ({ default: m.StaffPage })));
const EmpresaPage = lazy(() => import('./pages/b2b/EmpresaPage').then(m => ({ default: m.EmpresaPage })));
const AdminsPage = lazy(() => import('./pages/b2b/AdminsPage').then(m => ({ default: m.AdminsPage })));
const MetricasPage = lazy(() => import('./pages/b2b/MetricasPage').then(m => ({ default: m.MetricasPage })));
const SuscripcionPage = lazy(() => import('./pages/b2b/SuscripcionPage').then(m => ({ default: m.SuscripcionPage })));
const MobileProfile = lazy(() => import('./pages/mobile/MobileProfile'));
const DevVaultGateway = lazy(() => import('./pages/dev/DevVaultGateway').then(m => ({ default: m.DevVaultGateway })));
import DevImpersonationHUD from './components/dev/DevImpersonationHUD';

const RequireAuthLayout = () => {
    const { user, profile, currentAccount, loading, switchAccount, signOut } = useAuth();
    const isMobile = useIsMobile();
    const Layout = isMobile ? MobileLayout : ClientLayout;

    if (loading) return <LoadingScreen />;
    if (!user) return <Navigate to="/login" replace />;
    if (!currentAccount) {
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

    return <Layout />;
};

const DashboardRouter = () => {
    const { profile, currentAccount, user } = useAuth();

    const membership = profile?.memberships.find((m: any) => m.accountId === currentAccount?.id);
    const userRole = membership?.role;

    // Detectar clasificación de cuenta (Web 3.0 Identity System)
    const classification = currentAccount?.classification;
    const type = currentAccount?.type?.toUpperCase();
    const isEnterpriseAccount = classification === 'b2b-corporate' || type === 'ENTERPRISE' || type === 'BUSINESS';

    // Corporate Logic: Owner of B2B account or BILLING_ONLY role
    const isCorporateView = isEnterpriseAccount && (
        userRole === 'BILLING_ONLY' ||
        user?.uid === currentAccount?.ownerId
    );

    return isCorporateView ? <CorporateDashboard /> : <Dashboard />;
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

            {/* Portal Secreto de Desarrollo (Aislado / noindex) */}
            <Route path="/dev-vault-gateway" element={<DevVaultGateway />} />

            {/* Login Móvil Independiente */}
            <Route path="/mobile/login" element={<MobileLogin />} />

            {/* 📱 Rutas Móviles (Protegidas) */}
            <Route path="/mobile" element={<RequireAuthLayout />}>
                <Route path="dashboard" element={<MobileDashboard />} />
                <Route path="tools" element={<MobileTools />} />
                <Route path="profile" element={<MobileProfile />} />
                <Route index element={<Navigate to="/mobile/dashboard" replace />} />
            </Route>

            {/* Protected Routes with Client Layout */}
            <Route element={<RequireAuthLayout />}>
                <Route path="/dashboard" element={<DashboardRouter />} />
                {/* [MONOLITO MODULAR WEB 3.0] Módulos Industriales Centralizados */}
                <Route path="/opermaq" element={<OpermaqModule />} />
                <Route path="/stockpile" element={<StockpileModule />} />
                <Route path="/mining-flow" element={<MiningFlowModule />} />
                <Route path="/job-profiles" element={<JobProfilesPage />} />
                <Route path="/staff" element={<StaffPage />} />
                <Route path="/b2b/empresa" element={<EmpresaPage />} />
                <Route path="/b2b/admins" element={<AdminsPage />} />
                <Route path="/b2b/metricas" element={<MetricasPage />} />
                <Route path="/b2b/suscripcion" element={<SuscripcionPage />} />

                {/* Redirección limpia de rutas legacy */}
                <Route path="/plugins" element={<Navigate to="/dashboard" replace />} />
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
                        <MinReportSessionProvider>
                            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                                <div className="min-h-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg text-antigravity-light-text dark:text-antigravity-dark-text transition-colors duration-300">
                                    <DevImpersonationHUD />
                                    <Suspense fallback={<LoadingScreen />}>
                                        <AppRoutes />
                                    </Suspense>
                                    <PWAInstallPrompt />
                                    <SyncIndicator />
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
