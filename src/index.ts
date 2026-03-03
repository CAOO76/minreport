import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import './config/firebase'; // Import to trigger initialization
import { env } from './config/env';
import { register, inviteUser } from './api/auth.controller';
import { adminLogin, listTenants, listAccounts, updateTenantStatus, deleteTenant, purgeTenant, getBrandingSettings, updateBrandingSettings, getSystemMetrics, getAuditLogs, getUIAssetsSettings, updateUIAssetsSettings } from './api/admin.controller';
import { getPublicBrandingSettings, getAccountsById } from './api/public.controller';
import { challengeAccountAccess } from './api/auth_tunnel.controller';
import { setupAccountPassword } from './api/setup.controller';
import { validateEduRequest, analyzeEduDocument } from './api/edu.controller';
import staffRoutes from './api/staff.controller';
import { requireSuperAdmin } from './middleware/admin';
import { requireAuth } from './middleware/auth';

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // Deshabilitar CSP en dev para facilitar emuladores
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// Global Request Logger for B2B Tunnel Diagnostic
app.use((req, res, next) => {
    console.log(`[CORE-API] ${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// Header Security for Cloud Run
app.disable('x-powered-by');

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'MINREPORT CORE ONLINE',
        region: 'southamerica-west1',
        timestamp: new Date().toISOString()
    });
});

// Public Routes
app.get('/api/settings/branding', getPublicBrandingSettings);
app.get('/api/settings/ui-assets', getUIAssetsSettings); // Public for Login/Setup
app.get('/api/public/accounts-by-id/:taxId([^/]+)', getAccountsById);

// Routes
app.post('/api/auth/register', register);
app.post('/api/auth/tunnel/challenge', challengeAccountAccess);
app.post('/api/auth/tunnel/setup-password', setupAccountPassword);
app.post('/api/admin/login', adminLogin);
app.post('/api/edu/validate/:requestId', requireAuth, validateEduRequest);
app.post('/api/edu/analyze-doc', requireAuth, analyzeEduDocument);
app.post('/api/auth/invite', requireAuth, inviteUser); // [NEW] B2B Invitation

// Staff Routes (Onboarding)
app.use('/api/staff', staffRoutes); // [NEW] Staff Management

// Admin Routes (Protected)
app.get('/api/admin/tenants', requireSuperAdmin, listTenants);
app.get('/api/admin/accounts', requireSuperAdmin, listAccounts); // [NEW] Accounts Management
app.patch('/api/admin/tenants/:uid', requireSuperAdmin, updateTenantStatus);
app.delete('/api/admin/tenants/:uid', requireSuperAdmin, deleteTenant);
app.delete('/api/admin/tenants/:uid/purge', requireSuperAdmin, purgeTenant); // Hard Delete
app.get('/api/admin/settings/branding', requireSuperAdmin, getBrandingSettings);
app.put('/api/admin/settings/branding', requireSuperAdmin, updateBrandingSettings);
app.get('/api/admin/metrics', requireSuperAdmin, getSystemMetrics); // requireSuperAdmin already verifies token
app.get('/api/admin/audit-logs', requireSuperAdmin, getAuditLogs);
app.get('/api/admin/settings/ui-assets', requireSuperAdmin, getUIAssetsSettings); // Keep protected for admin panel
app.put('/api/admin/settings/ui-assets', requireSuperAdmin, updateUIAssetsSettings);

// Start Server
const port = parseInt(env.PORT, 10);
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📡 Host: 0.0.0.0 (¡Acceso Móvil Habilitado!)`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
