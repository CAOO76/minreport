import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './config/firebase';
import { Register } from './pages/Register';
import { SetPassword } from './pages/SetPassword';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ClientPluginsPage } from './pages/ClientPluginsPage';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import ClientLayout from './layouts/ClientLayout';
import MobileLayout from './layouts/MobileLayout';
import { useIsMobile } from './hooks/useIsMobile';
import OfflineIndicator from './components/common/OfflineIndicator';

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const isMobile = useIsMobile();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    if (loading) return null;

    // Determine layout based on device type
    const ProtectedLayout = isMobile ? MobileLayout : ClientLayout;

    return (
        <ThemeProvider>
            <BrandingProvider>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <Routes>
                        {/* Public / Auth Routes */}
                        <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
                        <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register />} />
                        <Route path="/auth/action" element={<SetPassword />} />

                        {/* Protected Routes with Layout */}
                        <Route element={user ? <ProtectedLayout /> : <Navigate to="/login" replace />}>
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/plugins" element={<ClientPluginsPage />} />
                            {/* Mobile specific routes could be added here if needed */}
                            <Route path="/capture" element={<div>Capture View (Not implemented)</div>} />
                            <Route path="/menu" element={<div>Menu View (Not implemented)</div>} />
                        </Route>

                        {/* Root and Fallback */}
                        <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
                        <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
                    </Routes>
                </BrowserRouter>
                <OfflineIndicator />
            </BrandingProvider>
        </ThemeProvider>
    );
}

export default App;


