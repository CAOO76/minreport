import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { AuthGuard } from './components/AuthGuard';
import { BrandingSettings } from './pages/BrandingSettings';
import { PluginsPage } from './pages/PluginsPage';
import { UsersPage } from './pages/UsersPage';
import { AdminLayout } from './components/AdminLayout';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';

function App() {
    return (
        <ThemeProvider>
            <BrandingProvider>
                <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <div className="min-h-screen bg-surface-light dark:bg-surface-dark transition-colors">
                        <Routes>
                            <Route path="/login" element={<Login />} />

                            <Route element={<AuthGuard><AdminLayout /></AuthGuard>}>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/users" element={<UsersPage />} />
                                {/* TODO: Create the Tenants page component */}
                                <Route path="/tenants" element={<div>Tenants Page</div>} />
                                <Route path="/plugins" element={<PluginsPage />} />
                                <Route path="/branding" element={<BrandingSettings />} />
                            </Route>
                        </Routes>
                    </div>
                </Router>
            </BrandingProvider>
        </ThemeProvider>
    );
}

export default App;
