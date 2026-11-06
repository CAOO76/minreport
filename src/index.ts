import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { db } from './config/firebase';
import { env } from './config/env';
import { hydrateCoreSecrets } from './config/secrets';
import { x402Gatekeeper, X402AuthenticatedRequest } from './middleware/x402Gatekeeper';
import { authRateLimiter, aiRateLimiter, mutationRateLimiter } from './middleware/rateLimiter';
import { ResilientAIClient, AISwarmUnavailableError } from './core/resilient-ai-client';
import { AuditLedger } from './core/audit-ledger';
import { register, inviteUser } from './api/auth.controller';
import {
    adminLogin,
    listTenants,
    listAccounts,
    getAccountUsers,
    getAITelemetry,
    approveTenant,
    rejectTenant,
    updateTenantStatus,
    deleteTenant,
    purgeTenant,
    getBrandingSettings,
    updateBrandingSettings,
    getSystemMetrics,
    getAuditLogs,
    verifyAuditLedgerChain,
    getUIAssetsSettings,
    updateUIAssetsSettings,
    updateModuleAvailability,
} from './api/admin.controller';
import { getPublicBrandingSettings, getAccountsById } from './api/public.controller';
import { challengeAccountAccess } from './api/auth_tunnel.controller';
import { setupAccountPassword } from './api/setup.controller';
import { validateEduRequest, analyzeEduDocument } from './api/edu.controller';
import staffRoutes from './api/staff.controller';
import pilotRoutes from './api/pilot.controller';
import mediaRoutes from './api/media.routes';
import { webauthnRouter } from './api/webauthn.controller';
import { registerOpermaqModuleRoutes } from './modules/opermaq';
import { requireSuperAdmin } from './middleware/admin';
import { requireAuth } from './middleware/auth';
import {
    devLogin,
    requireDevRoot,
    createTestPilotAccount,
    listTestPilots,
    revokeTestPilot,
    impersonateClient,
    initDevChallenge,
    confirmDevChallenge,
    getDevChallengeStatus,
    verifyDevChallengeOtp,
    verifyDevChallengeUser,
    loginDevChallengeFinal,
    syncDevFirebaseSession,
} from './api/dev.controller';
import { ensureDevRootAccount } from './services/bootstrap.service';

const app = express();

// Cloud Run / Cloudflare Proxy IP trust
app.set('trust proxy', 1);
app.disable('x-powered-by');

const isProd = process.env.NODE_ENV === 'production';

// Perímetro CSP estricto (Cero Google Fonts externas, cero scripts de terceros en cliente)
app.use(
    helmet({
        contentSecurityPolicy: isProd
            ? {
                  directives: {
                      defaultSrc: ["'self'"],
                      scriptSrc: ["'self'"],
                      styleSrc: ["'self'", "'unsafe-inline'"],
                      fontSrc: ["'self'", 'data:'],
                      imgSrc: ["'self'", 'data:', 'https:'],
                      connectSrc: [
                          "'self'",
                          'https://minreport-access.web.app',
                          'https://*.googleapis.com',
                          'https://*.firebaseio.com',
                      ],
                      frameAncestors: ["'none'"],
                      objectSrc: ["'none'"],
                      baseUri: ["'self'"],
                  },
              }
            : false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
);

// Lista blanca explícita de orígenes CORS autorizados (incluye esquemas nativos Capacitor 6 iOS/Android)
const ALLOWED_CORS_ORIGINS = new Set<string>([
    'https://minreport-access.web.app',
    'https://minreport-8f2a8.web.app',
    'https://minreport-8f2a8.firebaseapp.com',
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);
const DEV_LAN_ORIGIN_REGEX =
    /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):5173$/;
const configuredWebOrigin = (process.env.WEB_URL || env.WEB_URL || '').trim().replace(/\/+$/, '');
if (configuredWebOrigin) {
    ALLOWED_CORS_ORIGINS.add(configuredWebOrigin);
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Permitir peticiones M2M / Cloud Tasks / CLI sin cabecera Origin de navegador
            if (!origin) {
                return callback(null, true);
            }
            const normalizedOrigin = origin.trim().replace(/\/+$/, '');
            if (ALLOWED_CORS_ORIGINS.has(normalizedOrigin)) {
                return callback(null, true);
            }
            if (!isProd && DEV_LAN_ORIGIN_REGEX.test(normalizedOrigin)) {
                return callback(null, true);
            }
            return callback(new Error(`Origin no autorizado por política CORS: ${normalizedOrigin}`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'X-Firebase-AppCheck',
            'x-firebase-appcheck',
            'X-Active-Account-Id',
            'x-active-account-id',
            'X-Tenant-Id',
            'x-tenant-id',
            'X-402-Token',
            'x-402-token',
            'PAYMENT-SIGNATURE',
            'payment-signature',
            'X-Payment-Proof',
            'x-payment-proof',
            'X-HITL-Confirmation',
            'x-hitl-confirmation',
        ],
        exposedHeaders: ['PAYMENT-REQUIRED', 'WWW-Authenticate', 'Retry-After'],
    })
);

app.use(express.json({ limit: '15mb' }));

// Global Request Logger
app.use((req, _res, next) => {
    console.log(`[CORE-API] ${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// Root info endpoint (sin estados decorativos ficticios)
app.get('/', (_req, res) => {
    res.status(200).json({
        name: 'MINREPORT Core API',
        version: '3.0.0',
        architecture: 'Web 3.0 Hybrid Monolith',
        region: 'southamerica-west1',
        endpoints: {
            health: '/health',
            passkey: '/api/auth/passkey',
            m2m: '/api/m2m/data-feed',
            ai: '/api/ai/inference',
        },
    });
});

// Health Check
app.get('/health', (_req, res) => {
    res.status(200).json({
        service: 'minreport-core-api',
        region: 'southamerica-west1',
        timestamp: new Date().toISOString(),
    });
});

// Public Read-Only Routes
app.get('/api/settings/branding', getPublicBrandingSettings);
app.get('/api/settings/ui-assets', getUIAssetsSettings);
app.get('/api/public/accounts-by-id/:taxId([^/]+)', getAccountsById);

// Auth, Passkeys / WebAuthn FIDO2 & Onboarding Routes (Rate-Limited)
app.post('/api/auth/register', authRateLimiter, register);
app.use('/api/auth/passkey', webauthnRouter);
app.post('/api/auth/tunnel/challenge', authRateLimiter, challengeAccountAccess);
app.post('/api/auth/tunnel/setup-password', authRateLimiter, setupAccountPassword);
app.post('/api/auth/invite', requireAuth, mutationRateLimiter, inviteUser);

// [WEB 3.0 M2M GATEKEEPER] Endpoint monetizado agéntico real con HTTP 402 (Cero datos inventados)
app.get(
    '/api/m2m/data-feed',
    x402Gatekeeper({
        priceMicroUSD: 25000, // $0.025 USD por consulta agéntica verificada
        destinationWallet: process.env.X402_TREASURY_ACCOUNT || 'minreport-treasury-southamerica-west1',
        acceptedTokens: ['USDC', 'X402_CREDIT'],
        resourceId: 'mining-telemetry-feed',
    }),
    async (req: X402AuthenticatedRequest, res) => {
        try {
            const x402Ctx = req.x402Context;
            const scopedTenantId =
                x402Ctx?.mode === 'CORPORATE_CONTRACT' && x402Ctx.tenantId ? x402Ctx.tenantId : null;

            const stockpilesQuery = scopedTenantId
                ? db.collection('stockpiles').where('accountId', '==', scopedTenantId).limit(25)
                : db.collection('stockpiles').where('isPublicBenchmark', '==', true).limit(25);

            const [stockpilesSnap, benchmarksSnap] = await Promise.all([
                stockpilesQuery.get().catch(() => null),
                db.collection('benchmark_events').limit(25).get().catch(() => null),
            ]);

            const stockpiles = stockpilesSnap
                ? stockpilesSnap.docs.map((doc) => {
                      const d = doc.data();
                      return {
                          id: doc.id,
                          materialType: d.materialType ?? null,
                          volumeM3: typeof d.volumeM3 === 'number' ? d.volumeM3 : null,
                          tonnageMetric: typeof d.tonnage === 'number' ? d.tonnage : null,
                          recordedAt: d.updatedAt ?? d.createdAt ?? null,
                      };
                  })
                : [];

            const benchmarkAggregates = benchmarksSnap
                ? benchmarksSnap.docs.map((doc) => {
                      const d = doc.data();
                      return {
                          id: doc.id,
                          module: d.module ?? null,
                          targetCanonicalId: d.targetCanonicalId ?? null,
                          metricKind: d.metricKind ?? null,
                          numericValue: typeof d.numericValue === 'number' ? d.numericValue : null,
                          unitSi: d.unitSi ?? null,
                          recordedAt: d.createdAt ?? null,
                      };
                  })
                : [];

            return res.status(200).json({
                success: true,
                protocol: 'x402 Foundation v1.0',
                region: 'southamerica-west1',
                timestamp: new Date().toISOString(),
                settlementMode: x402Ctx?.mode || 'VERIFIED',
                feed: {
                    scopedTenantId,
                    totalStockpileRecords: stockpiles.length,
                    totalBenchmarkEvents: benchmarkAggregates.length,
                    stockpiles,
                    benchmarkEvents: benchmarkAggregates,
                },
            });
        } catch (err: any) {
            console.error('[M2M-DATA-FEED] Error consultando agregados verificados:', err);
            return res.status(500).json({ error: 'Error consultando agregados operacionales verificados.' });
        }
    }
);

const AIInferencePayloadSchema = z.object({
    prompt: z.string().min(1, 'El prompt no puede estar vacío').max(64000),
    systemInstruction: z.string().max(16000).optional(),
    module: z.enum(['opermaq', 'stockpile', 'core', 'test-pilot', 'mining-swarm']).optional().default('core'),
    thinkingLevel: z.enum(['none', 'low', 'medium', 'high']).optional().default('medium'),
    requireHITL: z.boolean().optional().default(false),
    media: z
        .array(
            z.object({
                mimeType: z.string().min(3).max(128),
                dataBase64: z.string().min(4),
            })
        )
        .max(10)
        .optional(),
});

// [WEB 3.0 ENJAMBRE GEMINI] Endpoint de Inferencia Resiliente
app.post('/api/ai/inference', requireAuth, aiRateLimiter, async (req, res) => {
    try {
        const validation = AIInferencePayloadSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validación de payload fallida',
                details: validation.error.format(),
            });
        }

        const { prompt, systemInstruction, module: targetModule, thinkingLevel, requireHITL, media } = validation.data;
        const tenantId = (req as any).user?.activeAccountId || 'default';
        const mappedModule = targetModule === 'mining-swarm' ? 'core' : targetModule;

        const aiResponse = await ResilientAIClient.generate({
            prompt,
            systemInstruction,
            module: mappedModule,
            tenantId,
            thinkingLevel,
            requireHITL,
            media,
        });

        await AuditLedger.record({
            tenantId,
            actorUid: (req as any).user?.uid || 'system',
            actorEmail: (req as any).user?.email || 'ai-agent@minreport.internal',
            action: 'AI_INFERENCE_REQUEST',
            module: mappedModule,
            targetEntity: 'gemini-swarm',
            details: {
                tier: aiResponse.tierUsed,
                model: aiResponse.model,
                latencyMs: aiResponse.latencyMs,
                requireHITL,
            },
        });

        return res.status(200).json({ success: true, ...aiResponse });
    } catch (err: any) {
        if (err instanceof AISwarmUnavailableError) {
            return res.status(503).json({ error: err.message });
        }
        return res.status(500).json({ error: err.message || 'Inference error' });
    }
});

// Gobernanza EDU (Restringida a SUPER_ADMIN / DEV_ROOT)
app.post('/api/edu/validate/:requestId', requireSuperAdmin, mutationRateLimiter, validateEduRequest);
app.post('/api/edu/analyze-doc', requireSuperAdmin, aiRateLimiter, analyzeEduDocument);

// Staff Routes (Protegidas con requireAuth + verificación de OWNER/ADMIN en controlador)
app.use('/api/staff', requireAuth, mutationRateLimiter, staffRoutes);

// Test-Pilot Feedback & AI Training Routes (3º TEST-PILOT + HITL)
app.use('/api/pilot', mutationRateLimiter, pilotRoutes);

// Digestor Multimedia Universal y Almacenamiento CAS (PDF, Imagen, Video, SVG)
app.use('/api/media', mediaRoutes);

// Flujo Out-of-Band y Desafío Progresivo DEV (Rate-Limited)
app.post('/api/dev/auth/challenge/init', authRateLimiter, initDevChallenge);
app.get('/api/dev/auth/challenge/confirm', authRateLimiter, confirmDevChallenge);
app.get('/api/dev/auth/challenge/status/:id', authRateLimiter, getDevChallengeStatus);
app.post('/api/dev/auth/challenge/verify-otp', authRateLimiter, verifyDevChallengeOtp);
app.post('/api/dev/auth/challenge/verify-user', authRateLimiter, verifyDevChallengeUser);
app.post('/api/dev/auth/challenge/login-final', authRateLimiter, loginDevChallengeFinal);
app.post('/api/dev/auth/login', authRateLimiter, devLogin);
app.post('/api/dev/auth/session-sync', requireDevRoot, authRateLimiter, syncDevFirebaseSession);

// DEV Root & Test-Pilot Governance Routes
app.post('/api/dev/test-pilots', requireDevRoot, mutationRateLimiter, createTestPilotAccount);
app.get('/api/dev/test-pilots', requireDevRoot, listTestPilots);
app.delete('/api/dev/test-pilots/:id', requireDevRoot, mutationRateLimiter, revokeTestPilot);
app.post('/api/dev/impersonate-client', requireDevRoot, mutationRateLimiter, impersonateClient);

// Admin Routes (Protected)
app.post('/api/admin/login', authRateLimiter, adminLogin);
app.get('/api/admin/tenants', requireSuperAdmin, listTenants);
app.get('/api/admin/accounts', requireSuperAdmin, listAccounts);
app.get('/api/admin/accounts/:accountId/users', requireSuperAdmin, getAccountUsers);
app.get('/api/admin/ai-telemetry', requireSuperAdmin, getAITelemetry);
app.post('/api/admin/tenants/:uid/approve', requireSuperAdmin, mutationRateLimiter, approveTenant);
app.post('/api/admin/tenants/:uid/reject', requireSuperAdmin, mutationRateLimiter, rejectTenant);
app.patch('/api/admin/tenants/:uid', requireSuperAdmin, mutationRateLimiter, updateTenantStatus);
app.delete('/api/admin/tenants/:uid', requireSuperAdmin, mutationRateLimiter, deleteTenant);
app.delete('/api/admin/tenants/:uid/purge', requireSuperAdmin, mutationRateLimiter, purgeTenant);
app.get('/api/admin/settings/branding', requireSuperAdmin, getBrandingSettings);
app.put('/api/admin/settings/branding', requireSuperAdmin, mutationRateLimiter, updateBrandingSettings);
app.get('/api/admin/metrics', requireSuperAdmin, getSystemMetrics);
app.get('/api/admin/audit-logs', requireSuperAdmin, getAuditLogs);
app.get('/api/admin/audit-ledger/verify', requireSuperAdmin, verifyAuditLedgerChain);
app.get('/api/admin/settings/ui-assets', requireSuperAdmin, getUIAssetsSettings);
app.put('/api/admin/settings/ui-assets', requireSuperAdmin, mutationRateLimiter, updateUIAssetsSettings);
app.patch('/api/admin/modules-status', requireSuperAdmin, mutationRateLimiter, updateModuleAvailability);

// Módulo Funcional OPERMAQ (Subordinado 100% a MINREPORT Core)
registerOpermaqModuleRoutes(app);

// Hidratación de Cloud Secret Manager y arranque del servidor
const port = parseInt(env.PORT, 10);

async function startServer(): Promise<void> {
    try {
        await hydrateCoreSecrets();
    } catch (secretErr) {
        console.warn('[CORE-API] Advertencia durante hidratación inicial de secretos:', secretErr);
    }

    const bindWithRetry = (attempt: number = 1) => {
        const server = app.listen(port, async () => {
            console.log(
                `[CORE-API] Servidor escuchando en localhost:${port} (dual-stack IPv4/IPv6, región: southamerica-west1, env: ${process.env.NODE_ENV || 'development'})`
            );
            try {
                await ensureDevRootAccount();
            } catch (bootstrapErr) {
                console.error('[CORE-API] Error durante bootstrapping inicial de DEV:', bootstrapErr);
            }
        });

        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE' && attempt <= 5) {
                console.warn(
                    `[CORE-API] Puerto ${port} en liberación por recarga previa (intento ${attempt}/5). Reintentando en 800ms...`
                );
                setTimeout(() => bindWithRetry(attempt + 1), 800);
                return;
            }
            console.error('[CORE-API] Error fatal al abrir socket HTTP:', err);
            process.exit(1);
        });

        let shuttingDown = false;
        const gracefulShutdown = (signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;
            server.close(() => {
                if (signal === 'SIGUSR2') {
                    process.kill(process.pid, 'SIGUSR2');
                } else {
                    process.exit(0);
                }
            });
            setTimeout(() => process.exit(0), 1500).unref();
        };

        process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.once('SIGINT', () => gracefulShutdown('SIGINT'));
        process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
    };

    bindWithRetry();
}

void startServer();

export default app;
