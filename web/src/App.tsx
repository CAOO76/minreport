import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SetupGuard } from './auth/SetupGuard';
import { Register } from './pages/Register';
import { SetPassword } from './pages/SetPassword';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { SetupWizard } from './pages/SetupWizard';

function App() {
    return (
        <AuthProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Routes>
                    {/* Public / Auth Routes */}
                    <Route path="/register" element={<Register />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/auth/action" element={<SetPassword />} />

                    {/* Setup Wizard (Protected by Login but NOT setup completed) */}
                    <Route path="/setup" element={
                        <SetupGuard>
                            <SetupWizard />
                        </SetupGuard>
                    } />

                    {/* Protected Dashboard */}
                    <Route path="/dashboard" element={
                        <SetupGuard>
                            <Dashboard />
                        </SetupGuard>
                    } />

                    {/* Root Redirection */}
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
