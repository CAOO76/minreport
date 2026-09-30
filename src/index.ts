import { x402Gatekeeper } from './middleware/x402Gatekeeper';
import { ResilientAIClient } from './core/resilient-ai-client';
import { AuditLedger } from './core/audit-ledger';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import './config/firebase'; // Import to trigger initialization
import { env } from './config/env';
import { register, inviteUser } from './api/auth.controller';
import { adminLogin, listTenants, listAccounts, getAccountUsers, getAITelemetry, updateTenantStatus, deleteTenant, purgeTenant, getBrandingSettings, updateBrandingSettings, getSystemMetrics, getAuditLogs, getUIAssetsSettings, updateUIAssetsSettings } from './api/admin.controller';
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

// Root info endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'MINREPORT Core API',
        version: '3.0.0',
        architecture: 'Web 3.0 Hybrid Monolith',
        region: 'southamerica-west1',
        status: 'ONLINE',
        endpoints: {
            health: '/health',
            m2m: '/api/m2m/data-feed',
            ai: '/api/ai/inference'
        }
    });
});

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

// [WEB 3.0 M2M GATEKEEPER] Endpoints monetizados agénticos con HTTP 402
app.get('/api/m2m/data-feed', x402Gatekeeper({
    priceMicroUSD: 25000, // $0.025 USD por consulta agéntica
    destinationWallet: 'minreport-vault.eth',
    acceptedTokens: ['USDC', 'ETH', 'X402_CREDIT'],
    resourceId: 'mining-telemetry-feed'
}), async (req, res) => {
    res.status(200).json({
        success: true,
        protocol: 'x402 Foundation v1.0',
        timestamp: new Date().toISOString(),
        feed: {
            activeMines: ['Los Pelambres', 'Andina', 'Centinela'],
            telemetrySync: 'NOMINAL',
            cluster: 'southamerica-west1'
        }
    });
});

// [WEB 3.0 ENJAMBRE GEMINI] Endpoint de Inferencia Resiliente
app.post('/api/ai/inference', requireAuth, async (req, res) => {
    try {
        const { prompt, module: targetModule, thinkingLevel } = req.body;
        const tenantId = (req as any).user?.activeAccountId || 'default';
        
        const aiResponse = await ResilientAIClient.generate({
            prompt,
            module: targetModule || 'core',
            tenantId,
            thinkingLevel: thinkingLevel || 'medium'
        });

        // Registrar en Audit Ledger inmutable
        await AuditLedger.record({
            tenantId,
            actorUid: (req as any).user?.uid || 'system',
            actorEmail: (req as any).user?.email || 'ai-agent@minreport.internal',
            action: 'AI_INFERENCE_REQUEST',
            module: targetModule || 'core',
            targetEntity: 'gemini-swarm',
            details: { tier: aiResponse.tierUsed, model: aiResponse.model, latencyMs: aiResponse.latencyMs }
        });

        res.status(200).json({ success: true, ...aiResponse });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Inference error' });
    }
});
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
app.get('/api/admin/accounts/:accountId/users', requireSuperAdmin, getAccountUsers);
app.get('/api/admin/ai-telemetry', requireSuperAdmin, getAITelemetry);
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
