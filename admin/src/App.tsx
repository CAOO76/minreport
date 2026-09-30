import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { AuthGuard } from './components/AuthGuard';
import { BrandingSettings } from './pages/BrandingSettings';
import { PluginsPage } from './pages/PluginsPage';
import { EnterpriseDetail } from './pages/EnterpriseDetail';
import { AdminLayout } from './components/AdminLayout';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';
import { B2BPage } from './pages/B2BPage';
import { EduPage } from './pages/EduPage';
import { PersonalPage } from './pages/PersonalPage';
import { UIAssetsSettings } from './pages/UIAssetsSettings';
import { AITelemetryPage } from './pages/AITelemetryPage';
import { AuditLedgerPage } from './pages/AuditLedgerPage';

function App() {
    return (
        <ThemeProvider>
            <BrandingProvider>
                <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <div className="min-h-screen bg-white dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] transition-colors font-sans">
                        <Routes>
                            <Route path="/login" element={<Login />} />

                            <Route element={<AuthGuard><AdminLayout /></AuthGuard>}>
                                <Route path="/" element={<Dashboard />} />

                                {/* Segmented Tenant Management Routes */}
                                <Route path="/b2b" element={<B2BPage />} />
                                <Route path="/b2b/:id" element={<EnterpriseDetail />} />
                                <Route path="/edu" element={<EduPage />} />
                                <Route path="/edu/:id" element={<EnterpriseDetail />} />
                                <Route path="/personal" element={<PersonalPage />} />
                                <Route path="/personal/:id" element={<EnterpriseDetail />} />

                                {/* Internal Modules Governance */}
                                <Route path="/modules" element={<PluginsPage />} />
                                <Route path="/plugins" element={<Navigate to="/modules" replace />} />

                                {/* Web 3.0 Governance & Telemetry */}
                                <Route path="/ai-telemetry" element={<AITelemetryPage />} />
                                <Route path="/audit" element={<AuditLedgerPage />} />

                                {/* UI Core Settings */}
                                <Route path="/branding" element={<BrandingSettings />} />
                                <Route path="/ui-assets" element={<UIAssetsSettings />} />

                                {/* Legacy Fallbacks & Global Redirect */}
                                <Route path="/sdk" element={<Navigate to="/modules" replace />} />
                                <Route path="/plugins/:pluginId" element={<Navigate to="/modules" replace />} />
                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Route>
                        </Routes>
                    </div>
                </Router>
            </BrandingProvider>
        </ThemeProvider>
    );
}

export default App;
