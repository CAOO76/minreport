import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { db } from './config/firebase';
import { env, isDevPrivateReleaseStage } from './config/env';
import { hydrateCoreSecrets } from './config/secrets';
import { x402Gatekeeper, X402AuthenticatedRequest } from './middleware/x402Gatekeeper';
import { authRateLimiter, aiRateLimiter, mutationRateLimiter, m2mRateLimiter, extractClientIp } from './middleware/rateLimiter';
import { ResilientAIClient, AISwarmUnavailableError } from './core/resilient-ai-client';
import { AuditLedger, type AuditLedgerModule } from './core/audit-ledger';
import { evaluatePilotExpiration } from './contracts/session.contracts';
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
    getTenantMetricsBySegment,
    getAuditLogs,
    verifyAuditLedgerChain,
    getUIAssetsSettings,
    updateUIAssetsSettings,
    updateModuleAvailability,
    updateAccountEntitlements,
} from './api/admin.controller';
import { getPublicBrandingSettings } from './api/public.controller';
import {
    lookupAccessIdentity,
    sendAccessEmailOtp,
    verifyAccessEmailOtp,
    submitAccessOrgApplication,
} from './api/access.controller';
import { setupAccountPassword } from './api/setup.controller';
import {
    validateEduRequest,
    analyzeEduDocument,
    listPublicEduInstitutions,
    listAdminEduInstitutions,
    createAdminEduInstitution,
    updateAdminEduInstitution,
} from './api/edu.controller';
import staffRoutes from './api/staff.controller';
import equipmentOnboardingRouter from './api/equipment-onboarding.controller';
import pilotRoutes from './api/pilot.controller';
import mediaRoutes from './api/media.routes';
import geoRoutes from './api/geo.controller';
import geolappRoutes, { postGeolappReconstruct3d } from './api/geolapp.controller';
import { webauthnRouter } from './api/webauthn.controller';
import { registerM2mGeolappAdapterRoutes } from './api/m2m-geolapp.adapter';
import { registerM2mOpermaqAdapterRoutes } from './api/m2m-opermaq.adapter';
import { registerM2mSupplyAdapterRoutes } from './api/m2m-supply.adapter';
import { SupplierChannelResolveQuerySchema } from './contracts/manufacturers.contracts';
import { registerOpermaqModuleRoutes } from './modules/opermaq';
import { registerSupplyModuleRoutes } from './modules/supply';
import { SupplierChannelResolverService } from './modules/opermaq/services/SupplierChannelResolverService';
import { startHuntTaskWatchdog } from './modules/opermaq/services/TaskQueueService';
import { requireSuperAdmin } from './middleware/admin';
import { requireAuth } from './middleware/auth';
import { resolveMinReportSessionScope } from './middleware/sessionScope';
import {
    devLogin,
    requireDevRoot,
    createTestPilotAccount,
    listTestPilots,
    revokeTestPilot,
    initDevChallenge,
    confirmDevChallenge,
    getDevChallengeStatus,
    verifyDevChallengeOtp,
    verifyDevChallengeUser,
    loginDevChallengeFinal,
    syncDevFirebaseSession,
    getDevPilotMetrics,
} from './api/dev.controller';
import { ensureDevRootAccount } from './services/bootstrap.service';
import { DevEmulatorCheckpointService } from './core/dev-emulator-checkpoint';

const app = express();

// Cloud Run / Cloudflare Proxy IP trust
app.set('trust proxy', 1);
app.disable('x-powered-by');

const isProd = process.env.NODE_ENV === 'production';

// Perímetro CSP estricto (Cero Google Fonts externas, cero scripts de terceros en cliente)
app.use(
    helmet({
        hsts: isProd
            ? {
                  maxAge: 63072000,
                  includeSubDomains: true,
                  preload: true,
              }
            : false,
        contentSecurityPolicy: isProd
            ? {
                  directives: {
                      defaultSrc: ["'self'"],
                      scriptSrc: ["'self'"],
                      workerSrc: ["'self'", 'blob:'],
                      styleSrc: ["'self'", "'unsafe-inline'"],
                      fontSrc: ["'self'", 'data:'],
                      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
                      mediaSrc: [
                          "'self'",
                          'blob:',
                          'https://storage.googleapis.com',
                          'https://firebasestorage.googleapis.com',
                      ],
                      connectSrc: [
                          "'self'",
                          'https://minreport.com',
                          'https://www.minreport.com',
                          'https://minreport-access.web.app',
                          'https://*.web.app',
                          'https://*.firebaseapp.com',
                          'https://*.googleapis.com',
                          'https://*.firebaseio.com',
                          'wss://*.firebaseio.com',
                          'https://*.cloudfunctions.net',
                          'https://*.run.app',
                      ],
                      manifestSrc: ["'self'"],
                      frameAncestors: ["'none'"],
                      objectSrc: ["'none'"],
                      baseUri: ["'self'"],
                      formAction: ["'self'"],
                  },
              }
            : false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        xFrameOptions: { action: 'deny' },
        xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
);

// Lista blanca explícita de orígenes CORS autorizados (incluye esquemas nativos Capacitor 6 iOS/Android)
const ALLOWED_CORS_ORIGINS = new Set<string>([
    'https://minreport.com',
    'https://www.minreport.com',
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
            'X-Agent-Id',
            'x-agent-id',
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

app.use(
    express.json({
        limit: '15mb',
        verify: (req: any, _res, buf) => {
            req.rawBody = Buffer.from(buf);
        },
    })
);
app.use(DevEmulatorCheckpointService.expressMutationMiddleware());

// Global Request Logger con supresión de ráfagas para proteger TTY local
const REQUEST_LOG_WINDOW_MS = 2_000;
const REQUEST_LOG_BURST_LIMIT = 6;
const REQUEST_LOG_MAX_KEYS = 200;
const requestLogBurstState = new Map<
    string,
    { windowStartMs: number; count: number; suppressed: number }
>();

app.use((req, _res, next) => {
    const pathname = req.path || req.url.split('?')[0] || '/';
    const key = `${req.method}:${pathname}`;
    const now = Date.now();
    const entry = requestLogBurstState.get(key);

    if (!entry || now - entry.windowStartMs >= REQUEST_LOG_WINDOW_MS) {
        const suppressedFromPrev = entry?.suppressed ?? 0;
        if (!entry && requestLogBurstState.size >= REQUEST_LOG_MAX_KEYS) {
            const oldestKey = requestLogBurstState.keys().next().value;
            if (oldestKey) requestLogBurstState.delete(oldestKey);
        }
        requestLogBurstState.set(key, { windowStartMs: now, count: 1, suppressed: 0 });
        const burstNote = suppressedFromPrev > 0 ? ` (+${suppressedFromPrev} en ráfaga)` : '';
        console.log(`[CORE-API] ${new Date().toISOString()} ${req.method} ${req.url}${burstNote}`);
    } else if (entry.count < REQUEST_LOG_BURST_LIMIT) {
        entry.count += 1;
        console.log(`[CORE-API] ${new Date().toISOString()} ${req.method} ${req.url}`);
    } else {
        entry.suppressed += 1;
    }
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
const handleHealthCheck = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
        service: 'minreport-core-api',
        region: 'southamerica-west1',
        releaseStage: isDevPrivateReleaseStage() ? 'DEV_PRIVATE' : 'FULL',
        timestamp: new Date().toISOString(),
    });
};

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// Compuerta estricta de etapa privada 1º DEV (bloquea superficie comercial, B2B/EDU/ADMIN/PILOT/M2M)
const DEV_PRIVATE_BLOCKED_PREFIXES = [
    '/api/auth/access',
    '/api/auth/tunnel',
    '/api/admin',
    '/api/pilot',
    '/api/edu',
    '/api/m2m',
    '/api/staff',
    '/api/equipment-onboarding',
];

app.use((req, res, next) => {
    if (isDevPrivateReleaseStage()) {
        const reqPath = (req.path || '').toLowerCase();
        if (
            DEV_PRIVATE_BLOCKED_PREFIXES.some(
                (prefix) => reqPath === prefix || reqPath.startsWith(`${prefix}/`)
            )
        ) {
            return res.status(403).json({
                error: 'RELEASE_STAGE_DEV_ONLY: Funcionalidad comercial no habilitada en etapa privada DEV.',
                code: 'RELEASE_STAGE_DEV_ONLY',
            });
        }
    }
    return next();
});

// Public Read-Only Routes
app.get('/api/settings/branding', getPublicBrandingSettings);
app.get('/api/settings/ui-assets', getUIAssetsSettings);

// Auth, Puerta Soberana /access (3 Pasos), Passkeys FIDO2 & Onboarding (Rate-Limited)
app.post('/api/auth/access/lookup', authRateLimiter, lookupAccessIdentity);
app.post('/api/auth/access/send-otp', requireAuth, authRateLimiter, sendAccessEmailOtp);
app.post('/api/auth/access/verify-otp', requireAuth, authRateLimiter, verifyAccessEmailOtp);
app.post('/api/auth/access/apply', authRateLimiter, submitAccessOrgApplication);
app.get('/api/auth/access/edu-institutions', authRateLimiter, listPublicEduInstitutions);
app.use('/api/auth/passkey', webauthnRouter);
app.post('/api/auth/tunnel/setup-password', authRateLimiter, setupAccountPassword);

// [WEB 3.0 M2M GATEKEEPER] Perímetro de ráfagas M2M (120 req / 60s por IP + x-agent-id) + HTTP 402
app.use('/api/m2m', m2mRateLimiter);

registerM2mGeolappAdapterRoutes(app);

registerM2mOpermaqAdapterRoutes(app);

registerM2mSupplyAdapterRoutes(app);

app.get(
    '/api/m2m/suppliers/resolve',
    x402Gatekeeper({
        priceMicroUSD: 15000,
        destinationWallet: process.env.X402_TREASURY_ACCOUNT || 'minreport-treasury-southamerica-west1',
        acceptedTokens: ['USDC', 'X402_CREDIT'],
        resourceId: 'opermaq-suppliers-4d-resolver',
    }),
    async (req: X402AuthenticatedRequest, res) => {
        try {
            const parsed = SupplierChannelResolveQuerySchema.safeParse(req.query);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Parámetros 4D inválidos para resolución M2M de proveedores.',
                    details: parsed.error.format(),
                });
            }

            const resolved = await SupplierChannelResolverService.resolveSupplierChannels({
                manufacturerKey: parsed.data.manufacturerKey || null,
                make: parsed.data.make || null,
                archetypeId: parsed.data.archetypeId || null,
                equipmentClass: parsed.data.equipmentClass || null,
                regionIso: parsed.data.regionIso || null,
                channelIntent: parsed.data.channelIntent || null,
                areaQuery: parsed.data.areaQuery || null,
                includeIndependentSpecialists: parsed.data.includeIndependentSpecialists,
                tenantId: null,
            });

            return res.status(200).json({
                success: true,
                protocol: 'x402 Foundation v1.0',
                region: 'southamerica-west1',
                settlementMode: req.x402Context?.mode || 'VERIFIED',
                query: resolved.query,
                officialMatches: resolved.officialMatches,
                independentMatches: resolved.independentMatches,
                latencyMs: resolved.latencyMs,
            });
        } catch (err) {
            console.error('[M2M-SUPPLIERS-RESOLVE] Error resolviendo canales M2M:', err);
            return res.status(500).json({ error: 'Error resolviendo canales comerciales 4D en endpoint M2M.' });
        }
    }
);

const AIInferencePayloadSchema = z.object({
    prompt: z.string().min(1, 'El prompt no puede estar vacío').max(64000),
    systemInstruction: z.string().max(16000).optional(),
    module: z.enum(['opermaq', 'stockpile', 'supply', 'geolapp', 'core', 'test-pilot']).optional().default('core'),
    preferredTier: z.enum(['PRIMARY', 'SECONDARY', 'ANCHOR_HA']).optional(),
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

async function resolveAuthorizedAiTenantContext(req: express.Request): Promise<{
    authorized: boolean;
    tenantId: string;
    isEduSandbox: boolean;
    countryCode?: string;
}> {
    const user = (req as any).user || {};
    const uid = String(user.uid || '').trim();
    const emailLower = String(user.email || '').toLowerCase();
    const roleUpper = String(user.role || '').trim().toUpperCase();
    const isAcademicRole =
        user.role === 'STUDENT' ||
        user.role === 'PROFESSOR' ||
        roleUpper === 'STUDENT' ||
        roleUpper === 'PROFESSOR';
    const isSystemPrivileged =
        user.role === 'DEV_ROOT' ||
        user.role === 'SUPER_ADMIN' ||
        user.role === 'TEST_PILOT' ||
        user.isMasterDev === true ||
        user.admin === true ||
        uid === 'dev-master-root-uid' ||
        uid === 'super-admin-uid' ||
        (user.email_verified === true &&
            (emailLower === 'dev@minreport.com' || emailLower === 'admin@minreport.com'));

    const headerAccountId = String(
        req.headers['x-active-account-id'] || req.headers['x-tenant-id'] || ''
    ).trim();
    const tokenAccountId = String(user.activeAccountId || user.tenantId || '').trim();
    const candidateAccountId = headerAccountId || tokenAccountId;

    if (!candidateAccountId) {
        return {
            authorized: true,
            tenantId: isSystemPrivileged ? 'dev-master-sandbox' : 'default',
            isEduSandbox: isAcademicRole,
        };
    }

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(candidateAccountId)) {
        return { authorized: false, tenantId: '', isEduSandbox: false };
    }

    if (candidateAccountId === 'dev-master-sandbox') {
        return {
            authorized: isSystemPrivileged,
            tenantId: candidateAccountId,
            isEduSandbox: false,
        };
    }

    const accountSnap = await db.collection('accounts').doc(candidateAccountId).get();
    const accountData = accountSnap.exists ? accountSnap.data() || {} : {};
    const accountClassLower = String(accountData.classification || '').toLowerCase();
    const isEduAccount =
        isAcademicRole ||
        String(accountData.type || '').toUpperCase() === 'EDUCATIONAL' ||
        accountClassLower === 'edu' ||
        accountClassLower === 'educational' ||
        accountData.isEduSandbox === true;
    const countryCode = typeof accountData.country === 'string' ? accountData.country : undefined;

    if (isSystemPrivileged) {
        return {
            authorized: true,
            tenantId: candidateAccountId,
            isEduSandbox: isEduAccount,
            countryCode,
        };
    }

    if (!accountSnap.exists) {
        return { authorized: false, tenantId: '', isEduSandbox: false };
    }

    let isMember =
        tokenAccountId === candidateAccountId ||
        String(accountData.ownerId || '') === uid;

    if (!isMember && uid) {
        const memberSnap = await db
            .collection('accounts')
            .doc(candidateAccountId)
            .collection('members')
            .doc(uid)
            .get();
        if (memberSnap.exists) {
            const st = String(memberSnap.data()?.status || 'ACTIVE').toUpperCase();
            isMember = st !== 'SUSPENDED' && st !== 'REVOKED' && st !== 'INACTIVE';
        }
    }

    if (!isMember && uid) {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            const memberships = userSnap.data()?.memberships;
            if (Array.isArray(memberships)) {
                isMember = memberships.some((m: any) => {
                    if (m?.accountId !== candidateAccountId) return false;
                    const st = String(m?.status || 'ACTIVE').toUpperCase();
                    return st !== 'SUSPENDED' && st !== 'REVOKED' && st !== 'INACTIVE';
                });
            }
        }
    }

    return {
        authorized: isMember,
        tenantId: candidateAccountId,
        isEduSandbox: isEduAccount,
        countryCode,
    };
}

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

        const tenantCtx = await resolveAuthorizedAiTenantContext(req);
        if (!tenantCtx.authorized) {
            return res.status(403).json({
                error: 'Acceso denegado al espacio de trabajo solicitado en X-Active-Account-Id.',
            });
        }

        const {
            prompt,
            systemInstruction,
            module: targetModule,
            preferredTier,
            thinkingLevel,
            requireHITL,
            media,
        } = validation.data;
        const resolvedAiModule = targetModule === 'geolapp' ? 'stockpile' : targetModule;

        const aiResponse = await ResilientAIClient.generate({
            prompt,
            systemInstruction,
            module: resolvedAiModule,
            tenantId: tenantCtx.tenantId,
            isEduSandbox: tenantCtx.isEduSandbox,
            countryCode: tenantCtx.countryCode,
            preferredTier,
            thinkingLevel,
            requireHITL,
            media,
        });

        // FinOps Firestore: los turnos conversacionales simples registran telemetría atómica vía TenantMetricsService;
        // AuditLedger se reserva para inferencias críticas / sujetas a aprobación humana HITL.
        if (requireHITL) {
            await AuditLedger.record({
                tenantId: tenantCtx.tenantId,
                actorUid: (req as any).user?.uid || 'system',
                actorEmail: (req as any).user?.email || 'ai-agent@minreport.internal',
                action: 'AI_INFERENCE_HITL_REQUEST',
                module: resolvedAiModule,
                targetEntity: 'gemini-swarm',
                details: {
                    tier: aiResponse.tierUsed,
                    model: aiResponse.model,
                    latencyMs: aiResponse.latencyMs,
                    requireHITL: true,
                },
            });
        }

        return res.status(200).json({ success: true, ...aiResponse });
    } catch (err: any) {
        if (err instanceof AISwarmUnavailableError) {
            return res.status(503).json({ error: err.message });
        }
        return res.status(500).json({ error: err.message || 'Inference error' });
    }
});

const HitlCandidateIdParamSchema = z.string().trim().min(1).max(128);
const HitlResolveBodySchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    confirmKeyword: z.string().max(32).optional(),
});
const VALID_HITL_AUDIT_MODULES = new Set<AuditLedgerModule>([
    'opermaq',
    'stockpile',
    'supply',
    'b2b-core',
    'core',
    'test-pilot',
    'web3-m2m',
    'auth',
    'edu',
]);

function isEduAccountRecord(accountData: Record<string, any>): boolean {
    const accountTypeUpper = String(accountData.type || '').toUpperCase();
    const accountClassLower = String(accountData.classification || '').toLowerCase();
    return (
        accountData.isEduSandbox === true ||
        accountTypeUpper === 'EDUCATIONAL' ||
        accountClassLower === 'edu' ||
        accountClassLower === 'educational'
    );
}

async function isActiveVerifiedTestPilot(
    uid: string,
    tokenRole: string,
    tokenPilotExpiresAt: unknown
): Promise<boolean> {
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const userStatus = String(userData.status || 'ACTIVE').trim().toUpperCase();
    if (
        userStatus === 'REVOKED' ||
        userStatus === 'SUSPENDED' ||
        userStatus === 'INACTIVE' ||
        userStatus === 'DELETED'
    ) {
        return false;
    }

    const serverRole = String(userData.role || '').trim().toUpperCase();
    if (tokenRole !== 'TEST_PILOT' && serverRole !== 'TEST_PILOT') {
        return false;
    }
    if (
        evaluatePilotExpiration(tokenPilotExpiresAt) ||
        evaluatePilotExpiration(userData.pilotExpiresAt)
    ) {
        return false;
    }

    const pilotsSnap = await db.collection('test_pilots').where('userId', '==', uid).get();
    if (!pilotsSnap.empty) {
        const pilotDocs = pilotsSnap.docs.map((d) => d.data() || {});
        const activeDocs = pilotDocs.filter(
            (p) => String(p.status || '').trim().toUpperCase() === 'ACTIVE'
        );
        if (activeDocs.length === 0 || activeDocs.every((p) => evaluatePilotExpiration(p.expiresAt))) {
            return false;
        }
    }

    return true;
}

async function isAuthorizedToResolveHitlCandidate(
    user: Record<string, any>,
    candTenantId: string
): Promise<boolean> {
    const uid = String(user.uid || '').trim();
    if (!uid) return false;

    const emailLower = String(user.email || '').trim().toLowerCase();
    const tokenRole = String(user.role || '').trim().toUpperCase();

    const isDevRoot =
        user.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        uid === 'dev-master-root-uid' ||
        (emailLower === 'dev@minreport.com' && user.email_verified !== false);
    if (isDevRoot) return true;

    const isSuperAdmin =
        user.admin === true ||
        tokenRole === 'SUPER_ADMIN' ||
        uid === 'super-admin-uid' ||
        ((emailLower === 'admin@minreport.com' ||
            emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase()) &&
            user.email_verified !== false);
    if (isSuperAdmin) return true;

    if (await isActiveVerifiedTestPilot(uid, tokenRole, user.pilotExpiresAt)) {
        return true;
    }

    if (tokenRole === 'STUDENT' || tokenRole === 'PROFESSOR') {
        return false;
    }

    if (!candTenantId) {
        return false;
    }

    const accountSnap = await db.collection('accounts').doc(candTenantId).get();
    if (!accountSnap.exists) {
        return false;
    }

    const accountData = accountSnap.data() || {};
    if (isEduAccountRecord(accountData)) {
        return false;
    }

    const accountTypeUpper = String(accountData.type || '').toUpperCase();
    const accountClassLower = String(accountData.classification || '').toLowerCase();
    if (accountTypeUpper === 'TEST_PILOT' || accountClassLower === 'test-pilot') {
        return false;
    }

    const accountStatus = String(accountData.status || 'ACTIVE').trim().toUpperCase();
    if (accountStatus === 'SUSPENDED' || accountStatus === 'REJECTED' || accountStatus === 'REVOKED') {
        return false;
    }

    const memberSnap = await db
        .collection('accounts')
        .doc(candTenantId)
        .collection('members')
        .doc(uid)
        .get();
    if (memberSnap.exists) {
        const memberData = memberSnap.data() || {};
        const memberStatus = String(memberData.status || '').trim().toUpperCase();
        const memberRole = String(memberData.role || '').trim().toUpperCase();
        if (memberStatus !== 'ACTIVE') {
            return false;
        }
        if (memberRole === 'OWNER' || memberRole === 'ADMIN') {
            return true;
        }
        return String(accountData.ownerId || '').trim() === uid;
    }

    return String(accountData.ownerId || '').trim() === uid;
}

// [HITL IA] Resolución server-side de propuestas de IA (B2B OWNER/ADMIN, TEST-PILOT, ADMIN, DEV)
app.post('/api/ai/hitl-candidates/:id/resolve', requireAuth, mutationRateLimiter, async (req, res) => {
    try {
        const idParsed = HitlCandidateIdParamSchema.safeParse(req.params.id);
        if (!idParsed.success) {
            return res.status(400).json({ error: 'Identificador de candidato HITL inválido.' });
        }
        const id = idParsed.data;

        const bodyParsed = HitlResolveBodySchema.safeParse(req.body);
        if (!bodyParsed.success) {
            return res.status(400).json({
                error: 'Validación de payload HITL fallida.',
                details: bodyParsed.error.format(),
            });
        }

        const { status, confirmKeyword } = bodyParsed.data;
        if (status === 'APPROVED' && String(confirmKeyword || '').trim().toUpperCase() !== 'ACTUALIZAR') {
            return res.status(400).json({
                error: 'Confirmación humana obligatoria: debe ingresar la palabra clave "ACTUALIZAR".',
            });
        }

        const candidateRef = db.collection('hitl_candidates').doc(id);
        const candidateSnap = await candidateRef.get();
        if (!candidateSnap.exists) {
            return res.status(404).json({ error: 'Candidato HITL no encontrado.' });
        }

        const user = (req as any).user || {};
        const uid = String(user.uid || '').trim();
        if (!uid) {
            return res.status(401).json({ error: 'Acceso no autorizado: sesión ausente.' });
        }
        const email = String(user.email || '').trim();

        const candData = candidateSnap.data() || {};
        const candTenantId = String(candData.tenantId || '').trim();

        const authorized = await isAuthorizedToResolveHitlCandidate(user, candTenantId);
        if (!authorized) {
            return res.status(403).json({
                error: 'Acceso denegado para resolver propuestas HITL en esta cuenta.',
            });
        }

        const nowMs = Date.now();
        await candidateRef.update({
            status,
            reviewedByUid: uid,
            reviewedByEmail: email,
            reviewedAt: new Date(nowMs).toISOString(),
            updatedAt: nowMs,
        });

        const rawModule = String(candData.module || 'core').trim().toLowerCase() as AuditLedgerModule;
        const resolvedModule: AuditLedgerModule = VALID_HITL_AUDIT_MODULES.has(rawModule) ? rawModule : 'core';

        await AuditLedger.record({
            tenantId: candTenantId || 'global',
            actorUid: uid || 'system',
            actorEmail: email || 'hitl@minreport.internal',
            action: status === 'APPROVED' ? 'AI_HITL_CANDIDATE_APPROVED' : 'AI_HITL_CANDIDATE_REJECTED',
            module: resolvedModule,
            targetEntity: `hitl_candidates/${id}`,
            details: { status, hitlConfirmed: status === 'APPROVED' },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({ success: true, id, status });
    } catch (err: any) {
        return res.status(500).json({ error: err?.message || 'Error resolviendo candidato HITL.' });
    }
});

// Gobernanza EDU (Restringida a SUPER_ADMIN / DEV_ROOT)
app.post('/api/edu/validate/:requestId', requireSuperAdmin, mutationRateLimiter, validateEduRequest);
app.post('/api/edu/analyze-doc', requireSuperAdmin, aiRateLimiter, analyzeEduDocument);

// Staff Routes (Protegidas con requireAuth + verificación de OWNER/ADMIN en controlador)
app.use('/api/staff', requireAuth, mutationRateLimiter, staffRoutes);

// Solicitudes de Incorporación de Equipos Nuevos (4º B2B -> 1º DEV -> Catálogo Maestro + Flota)
app.use('/api/equipment-onboarding', requireAuth, equipmentOnboardingRouter);

// Test-Pilot Feedback & AI Training Routes (3º TEST-PILOT + HITL)
app.use('/api/pilot', mutationRateLimiter, pilotRoutes);

// Digestor Multimedia Universal y Almacenamiento CAS (PDF, Imagen, Video, SVG)
app.use('/api/media', mediaRoutes);

// Núcleo Geoespacial Multi-Dispositivo, PMTiles v3 y Sellos Georreferenciados
app.use('/api/geo', geoRoutes);

// Núcleo GEOLAPP (Mutaciones Oficiales HITL + Reconstrucción 3D .glb + Trazabilidad AuditLedger)
app.post(
    '/api/geolapp/stockpiles/:id/reconstruct-3d',
    requireAuth,
    resolveMinReportSessionScope,
    postGeolappReconstruct3d
);
app.use('/api/geolapp', geolappRoutes);

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
app.get('/api/dev/settings/branding', requireDevRoot, getBrandingSettings);
app.put('/api/dev/settings/branding', requireDevRoot, mutationRateLimiter, updateBrandingSettings);
app.post('/api/dev/test-pilots', requireDevRoot, mutationRateLimiter, createTestPilotAccount);
app.get('/api/dev/test-pilots', requireDevRoot, listTestPilots);
app.delete('/api/dev/test-pilots/:id', requireDevRoot, mutationRateLimiter, revokeTestPilot);
app.get('/api/dev/pilot-metrics', requireDevRoot, getDevPilotMetrics);

// Admin Routes (Protected)
app.post('/api/admin/login', authRateLimiter, adminLogin);
app.get('/api/admin/tenants', requireSuperAdmin, listTenants);
app.get('/api/admin/accounts', requireSuperAdmin, listAccounts);
app.get('/api/admin/accounts/:accountId/users', requireSuperAdmin, getAccountUsers);
app.patch('/api/admin/accounts/:accountId/entitlements', requireSuperAdmin, mutationRateLimiter, updateAccountEntitlements);
app.get('/api/admin/edu-institutions', requireSuperAdmin, listAdminEduInstitutions);
app.post('/api/admin/edu-institutions', requireSuperAdmin, mutationRateLimiter, createAdminEduInstitution);
app.patch('/api/admin/edu-institutions/:id', requireSuperAdmin, mutationRateLimiter, updateAdminEduInstitution);
app.get('/api/admin/ai-telemetry', requireSuperAdmin, getAITelemetry);
app.post('/api/admin/tenants/:uid/approve', requireSuperAdmin, mutationRateLimiter, approveTenant);
app.post('/api/admin/tenants/:uid/reject', requireSuperAdmin, mutationRateLimiter, rejectTenant);
app.patch('/api/admin/tenants/:uid', requireSuperAdmin, mutationRateLimiter, updateTenantStatus);
app.delete('/api/admin/tenants/:uid', requireSuperAdmin, mutationRateLimiter, deleteTenant);
app.delete('/api/admin/tenants/:uid/purge', requireSuperAdmin, mutationRateLimiter, purgeTenant);
app.get('/api/admin/settings/branding', requireSuperAdmin, getBrandingSettings);
app.put('/api/admin/settings/branding', requireDevRoot, mutationRateLimiter, updateBrandingSettings);
app.get('/api/admin/metrics', requireSuperAdmin, getSystemMetrics);
app.get('/api/admin/metrics/tenants', requireSuperAdmin, getTenantMetricsBySegment);
app.get('/api/admin/audit-logs', requireSuperAdmin, getAuditLogs);
app.get('/api/admin/audit-ledger/verify', requireSuperAdmin, verifyAuditLedgerChain);
app.get('/api/admin/settings/ui-assets', requireSuperAdmin, getUIAssetsSettings);
app.put('/api/admin/settings/ui-assets', requireSuperAdmin, mutationRateLimiter, updateUIAssetsSettings);
app.patch('/api/admin/modules-status', requireSuperAdmin, mutationRateLimiter, updateModuleAvailability);

// Módulo Funcional OPERMAQ (Subordinado 100% a MINREPORT Core)
registerOpermaqModuleRoutes(app);

// Módulo Funcional ABASTECIMIENTO (Subordinado 100% a MINREPORT Core)
registerSupplyModuleRoutes(app);

// Hidratación de Cloud Secret Manager y arranque del servidor
const port = parseInt(env.PORT, 10);

async function startServer(): Promise<void> {
    try {
        await hydrateCoreSecrets();
    } catch (secretErr) {
        console.warn('[CORE-API] Advertencia durante hidratación inicial de secretos:', secretErr);
    }

    const bindWithRetry = (attempt: number = 1) => {
        const server = app.listen(port, '0.0.0.0', async () => {
            console.log(
                `[CORE-API] Servidor escuchando en localhost:${port} (dual-stack IPv4/IPv6, región: southamerica-west1, env: ${process.env.NODE_ENV || 'development'})`
            );
            try {
                await ensureDevRootAccount();
                DevEmulatorCheckpointService.start();
                DevEmulatorCheckpointService.scheduleCheckpoint('server-boot-sync');
                startHuntTaskWatchdog();
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
            void DevEmulatorCheckpointService.flushOnShutdown(signal).finally(() => {
                server.close(() => {
                    if (signal === 'SIGUSR2') {
                        process.kill(process.pid, 'SIGUSR2');
                    } else {
                        process.exit(0);
                    }
                });
            });
            setTimeout(() => process.exit(0), 2500).unref();
        };

        process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.once('SIGINT', () => gracefulShutdown('SIGINT'));
        process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
    };

    bindWithRetry();
}

if (process.env.NODE_ENV !== 'test' || require.main === module) {
    void startServer();
}

export default app;
