import { M3Switch } from './components/M3Switch';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { AuthGuard } from './components/AuthGuard';
import { BrandingSettings } from './pages/BrandingSettings';
import { PluginsPage } from './pages/PluginsPage';
import { SDKPage } from './pages/SDKPage';
import { EnterpriseDetail } from './pages/EnterpriseDetail';
import { AdminLayout } from './components/AdminLayout';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';
import { B2BPage } from './pages/B2BPage';
import { EduPage } from './pages/EduPage';
import { PersonalPage } from './pages/PersonalPage';
import { PluginExecutionPage } from './pages/PluginExecutionPage';
import { UIAssetsSettings } from './pages/UIAssetsSettings';
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

                                {/* Segmented Tenant Management Routes */}
                                <Route path="/b2b" element={<B2BPage />} />
                                <Route path="/b2b/:id" element={<EnterpriseDetail />} />
                                <Route path="/personal" element={<PersonalPage />} />
                                <Route path="/edu" element={<EduPage />} />

                                <Route path="/plugins" element={<PluginsPage />} />
                                <Route path="/plugins/:pluginId" element={<PluginExecutionPage />} />
                                <Route path="/branding" element={<BrandingSettings />} />
                                <Route path="/ui-assets" element={<UIAssetsSettings />} />
                                <Route path="/sdk" element={<SDKPage />} />
                            </Route>
                        </Routes>
                    </div>
                </Router>
            </BrandingProvider>
        </ThemeProvider>
    );
}

export default App;
