import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebase';
import { Register } from './pages/Register';
import { SetPassword } from './pages/SetPassword';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import ClientLayout from './layouts/ClientLayout';

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    if (loading) return null;

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
                        <Route element={user ? <ClientLayout /> : <Navigate to="/login" replace />}>
                            <Route path="/dashboard" element={<Dashboard />} />
                        </Route>

                        {/* Root and Fallback */}
                        <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
                        <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
                    </Routes>
                </BrowserRouter>
            </BrandingProvider>
        </ThemeProvider>
    );
}

export default App;


