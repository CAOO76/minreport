import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env, isDevPrivateReleaseStage } from '../../../config/env';
import { auth, db } from '../../../config/firebase';
import { evaluatePilotExpiration, resolveEffectiveModuleAccess } from '../../../contracts/session.contracts';
import { AuditLedger } from '../../../core/audit-ledger';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { isDecodedDevRootToken, logThrottledAuthFailure } from '../../../middleware/auth';
import {
    aiRateLimiter,
    authRateLimiter,
    extractClientIp,
    mutationRateLimiter,
} from '../../../middleware/rateLimiter';
import {
    resolveModuleSessionScope,
    type ScopedRequest,
} from '../../../middleware/sessionScope';
import { normalizeE164Phone } from '../../../utils/taxIdValidator';
import { SSRFBlockedError } from '../../../utils/ssrfGuard';
import { EmailAndWhatsAppNotifier } from '../adapters/EmailAndWhatsAppNotifier';
import { InternationalAccountingExporter } from '../adapters/InternationalAccountingExporter';
import {
    type InboundWhatsAppMessage,
    MetaWhatsAppCloudAdapter,
} from '../adapters/MetaWhatsAppCloudAdapter';
import { ProvisionalSupplyProfileAdapter } from '../adapters/ProvisionalSupplyProfileAdapter';
import {
    ErpWebhookEventSchema,
    SignedErpWebhookDispatcher,
} from '../adapters/SignedErpWebhookDispatcher';
import {
    WhatsAppFlowCryptoError,
    WhatsAppFlowsCrypto,
    resolveFlowsPrivateKeyMaterial,
} from '../adapters/WhatsAppFlowsCrypto';
import { CampChannel, type ResolvedWhatsAppMember } from '../channels/camp.channel';
import { SupplyFlowsHandler } from '../channels/supply.flows';
import {
    AccountingExportFormatSchema,
    AccountingExportProfileSchema,
} from '../ports/IAccountingExportAdapter';
import {
    DEFAULT_ROLE_PROFILES,
    matchCanonicalSkuByText as matchDomainCanonicalSkuByText,
} from '../catalog/DefaultSupplyCatalogSeed';
import { LEY21719_MIN_K_ANONYMITY } from '../domain/DemandAndCostForecaster';
import {
    type PolicyItemCandidate,
    evaluateDirectPurchaseAuthority,
    evaluateRequisitionPolicy,
} from '../domain/SupplyPolicyAndAnomalyEngine';
import { normalizeQuantityToSi } from '../domain/UnitNormalizationEngine';
import {
    ReceiptCasAccessDeniedError,
    ReceiptIntelligencePipeline,
} from './ReceiptIntelligencePipeline';
import {
    SUPPLY_COLLECTIONS,
    SupplyConflictError,
    SupplyDuplicateSiiDocumentError,
    SupplyForbiddenError,
    SupplyNotFoundError,
    SupplyRepository,
    SupplyValidationError,
} from './SupplyRepository';
import {
    SupplyTaskQueueService,
    verifySupplyWorkerOidcAuth,
} from './SupplyTaskQueueService';
import {
    CreateExpressRfqInviteSchema,
    ExpressRfqError,
    type ExpressRfqInviteStatus,
    SupplierZeroFrictionRfqService,
} from './SupplierZeroFrictionRfqService';
import {
    ConfirmSupplyProfileOptInRequestSchema,
    ConfirmWarehouseReceptionV3RequestSchema,
    CreateSupplyWarehouseRequestSchema,
    ExportConversationQuerySchema,
    GrantTemporaryChannelRequestSchema,
    RecordStockMovementRequestSchema,
    RevokeTemporaryChannelRequestSchema,
    SupplyWhatsAppChannelIdSchema,
    TankCycleCountRequestSchema,
    UpdateSupplyProfileChannelsRequestSchema,
    UpsertSupplyProfileRequestSchema,
} from '../../../contracts/supply.contracts';
import { ConversationAuditService } from './ConversationAuditService';
import {
    CanonicalSupplySkuSchema,
    EvidenceCasRefSchema,
    exportSiiDocumentsToCsv,
    HitlConfirmationKeywordSchema,
    LinePricingBasisSchema,
    maskPiiForLog,
    normalizeLegacyCostCenter,
    normalizeSupplyItemFromText,
    PaymentMethodSchema,
    ProcurementBucketSchema,
    PurchaseLineDestinationSchema,
    PurchaseModeSchema,
    RequisitionStatusSchema,
    SiiDteTypeSchema,
    SiiExpenseReportStatusSchema,
    SUPPLY_AUDIT_MODULE,
    SupplyCategoryCodeSchema,
    SupplyDemandNatureSchema,
    SupplyDemandOriginSchema,
    type SupplyMemberProfile,
    SupplyMemberProfileSchema,
    type SupplyOperationalRole,
    SupplyOperationalRoleSchema,
    type SupplyPurchaseLine,
    SupplySiteSchema,
    SupplyUrgencySchema,
} from './supply.types';

/**
 * SUPPLY CONTROLLER (`/api/supply/*`) — MINREPORT · ABASTECIMIENTO
 *
 * - Webhook oficial Meta Cloud API (`/whatsapp/webhook` GET+POST) protegido por
 *   verify_token + firma HMAC-SHA256 `X-Hub-Signature-256` (Fail-Closed).
 * - Todas las demás rutas protegidas por autenticación Firebase Admin + aislamiento
 *   multi-tenant estricto por `tenantId` (`requireSupplyTenantScope`).
 * - Mutaciones críticas exigen compuerta HITL `confirmationKeyword: 'ACTUALIZAR'`
 *   y registro criptográfico en `AuditLedger`.
 */

const TENANT_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024, // 25 MB para fotos/PDF/XML de comprobantes
    },
});

export type SupplyEffectiveRole = SupplyOperationalRole | 'READ_ONLY_VIEWER' | 'BILLING_ONLY';

export type SupplyEffectiveProfile = Omit<SupplyMemberProfile, 'role'> & {
    role: SupplyEffectiveRole;
};

export interface SupplySessionContext {
    tenantId: string;
    actorUid: string;
    actorEmail: string;
    actorName: string;
    accountTier: 1 | 2 | 3 | 4 | 5;
    isSystemPrivileged: boolean;
    isEduSandbox: boolean;
    isTestPilot: boolean;
    b2bRole: string;
    canMutate: boolean;
    supplyProfile: SupplyEffectiveProfile;
    phoneE164?: string;
}

export interface SupplyRequest extends Request {
    user?: any;
    rawBody?: Buffer;
    supplyContext?: SupplySessionContext;
}

const READ_ONLY_SUPPLY_ROLES = new Set(['VIEWER', 'BILLING_ONLY', 'SUBSCRIPTION_ADMIN']);

function asOperationalRole(role: SupplyEffectiveRole): SupplyOperationalRole {
    if (role === 'READ_ONLY_VIEWER' || role === 'BILLING_ONLY') {
        throw new SupplyForbiddenError('SUPPLY_RBAC_READ_ONLY: Operación no permitida en modo solo lectura.');
    }
    return role;
}

function isInactiveStatus(status: unknown): boolean {
    const st = String(status || 'ACTIVE').trim().toUpperCase();
    return st === 'SUSPENDED' || st === 'REVOKED' || st === 'INACTIVE' || st === 'DELETED';
}

function isReadOnlyB2bRole(role: string): boolean {
    return READ_ONLY_SUPPLY_ROLES.has(String(role || '').trim().toUpperCase());
}

function canAuthorizeCapex(ctx: SupplySessionContext): boolean {
    if (ctx.isSystemPrivileged) return true;
    const isCapexRole =
        ctx.supplyProfile.role === 'OWNER_EXEC' || ctx.supplyProfile.role === 'SITE_ADMIN';
    return Boolean(isCapexRole && ctx.supplyProfile.allowCapex === true);
}

function buildSupplyProfileFromData(
    rawProfile: unknown,
    b2bRole: string,
    isSystemPrivileged: boolean
): SupplyEffectiveProfile {
    const base = (rawProfile && typeof rawProfile === 'object' ? rawProfile : {}) as Record<string, any>;
    const normalizedB2bRole = String(b2bRole || '').trim().toUpperCase();

    // Prohibido promover VIEWER o BILLING_ONLY a CAMP_MANAGER (modo estrictamente solo lectura)
    if (!isSystemPrivileged && isReadOnlyB2bRole(normalizedB2bRole)) {
        const readOnlyRole: SupplyEffectiveRole =
            normalizedB2bRole === 'BILLING_ONLY' || normalizedB2bRole === 'SUBSCRIPTION_ADMIN'
                ? 'BILLING_ONLY'
                : 'READ_ONLY_VIEWER';
        const defaults = SupplyMemberProfileSchema.parse({
            ...base,
            role: 'WAREHOUSE_KEEPER',
            canRecordDirectPurchase: false,
            autoApproveDirectPurchase: false,
            allowCapex: false,
        });
        return {
            ...defaults,
            role: readOnlyRole,
            canRecordDirectPurchase: false,
            autoApproveDirectPurchase: false,
            allowCapex: false,
        };
    }

    let role: SupplyOperationalRole = base.role || 'CAMP_MANAGER';
    if (!base.role) {
        if (isSystemPrivileged || normalizedB2bRole === 'OWNER') {
            role = 'OWNER_EXEC';
        } else if (normalizedB2bRole === 'ADMIN') {
            role = 'SITE_ADMIN';
        } else {
            role = 'CAMP_MANAGER';
        }
    }

    const canRecordDirectPurchase =
        base.canRecordDirectPurchase !== undefined
            ? Boolean(base.canRecordDirectPurchase)
            : role === 'OWNER_EXEC' || role === 'SITE_ADMIN' || role === 'BUYER';
    const autoApproveDirectPurchase =
        base.autoApproveDirectPurchase !== undefined
            ? Boolean(base.autoApproveDirectPurchase)
            : role === 'OWNER_EXEC';
    const allowCapex =
        base.allowCapex !== undefined
            ? Boolean(base.allowCapex)
            : role === 'OWNER_EXEC' || role === 'SITE_ADMIN';

    return SupplyMemberProfileSchema.parse({
        ...base,
        role,
        canRecordDirectPurchase,
        autoApproveDirectPurchase,
        allowCapex,
    });
}

async function invokeSupplyModuleSessionScope(
    req: SupplyRequest
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, any> }> {
    return new Promise((resolve) => {
        let settled = false;
        const middleware = resolveModuleSessionScope('supply');
        const captureRes: any = {
            statusCode: 200,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(payload: Record<string, any>) {
                if (!settled) {
                    settled = true;
                    resolve({ ok: false, status: this.statusCode || 403, body: payload });
                }
                return this;
            },
        };
        void Promise.resolve(
            middleware(req as ScopedRequest, captureRes as Response, () => {
                if (!settled) {
                    settled = true;
                    resolve({ ok: true });
                }
            })
        ).catch(() => {
            if (!settled) {
                settled = true;
                resolve({
                    ok: false,
                    status: 401,
                    body: { error: 'No autorizado: Error verificando sesión.' },
                });
            }
        });
    });
}

function isAccountSupplyEntitled(
    accountData: Record<string, any> | null,
    globalModuleActive: boolean
): boolean {
    if (!accountData) return false;
    const rawEntitlements = accountData.entitlements ?? null;
    const hasStructuredEntitlements = Boolean(
        rawEntitlements &&
            (rawEntitlements.basePackage !== undefined ||
                rawEntitlements.baseModules !== undefined ||
                rawEntitlements.addonModules !== undefined)
    );
    const entitlementModulesMap =
        rawEntitlements?.modules && typeof rawEntitlements.modules === 'object'
            ? (rawEntitlements.modules as Record<string, boolean>)
            : null;
    const legacyAccountModulesMap =
        accountData.modules && typeof accountData.modules === 'object'
            ? (accountData.modules as Record<string, boolean>)
            : null;
    const hasAccountModuleConfig = Boolean(
        hasStructuredEntitlements ||
            entitlementModulesMap ||
            accountData.contract?.activeModules ||
            legacyAccountModulesMap ||
            Array.isArray(accountData.enabledPlugins)
    );
    const effectiveEntitlements =
        hasStructuredEntitlements &&
        entitlementModulesMap &&
        typeof entitlementModulesMap.supply === 'boolean' &&
        rawEntitlements?.addonModules?.supply === undefined &&
        rawEntitlements?.baseModules?.supply === undefined
            ? {
                  ...rawEntitlements,
                  addonModules: {
                      ...(rawEntitlements.addonModules || {}),
                      supply: { active: entitlementModulesMap.supply },
                  },
              }
            : hasStructuredEntitlements
              ? rawEntitlements
              : null;
    const mergedLegacyActiveModules = hasAccountModuleConfig
        ? {
              ...(legacyAccountModulesMap || {}),
              ...(accountData.contract?.activeModules || {}),
              ...(entitlementModulesMap || {}),
          }
        : { opermaq: true, stockpile: true };

    return resolveEffectiveModuleAccess({
        moduleKey: 'supply',
        globalModuleActive,
        hasFullSuiteOverride: false,
        entitlements: effectiveEntitlements,
        legacyContractActiveModules: mergedLegacyActiveModules,
        legacyEnabledPlugins: Array.isArray(accountData.enabledPlugins) ? accountData.enabledPlugins : null,
        memberRole: 'VIEWER',
        memberAllowedModules: null,
    });
}

interface VerifiedSupplyTestPilotSandbox {
    valid: boolean;
    allowedTenantIds: Set<string>;
    primaryPilotTenantId: string | null;
}

async function resolveVerifiedTestPilotSandbox(
    uid: string,
    tokenPilotExpiresAt?: unknown,
    profilePilotExpiresAt?: unknown
): Promise<VerifiedSupplyTestPilotSandbox> {
    if (
        !uid ||
        evaluatePilotExpiration(tokenPilotExpiresAt) ||
        evaluatePilotExpiration(profilePilotExpiresAt)
    ) {
        return { valid: false, allowedTenantIds: new Set(), primaryPilotTenantId: null };
    }

    const candidateDocs: Array<{ docId: string; data: Record<string, any> }> = [];
    const directSnap = await db.collection('test_pilots').doc(uid).get().catch(() => null);
    if (directSnap?.exists) {
        candidateDocs.push({ docId: directSnap.id, data: directSnap.data() || {} });
    }

    const querySnap = await db
        .collection('test_pilots')
        .where('userId', '==', uid)
        .get()
        .catch(() => null);
    if (querySnap && !querySnap.empty) {
        for (const doc of querySnap.docs) {
            if (!candidateDocs.some((entry) => entry.docId === doc.id)) {
                candidateDocs.push({ docId: doc.id, data: doc.data() || {} });
            }
        }
    }

    // Fail-closed: debe existir un registro ACTIVE y no expirado en `test_pilots`
    const validActiveDocs = candidateDocs.filter((entry) => {
        const st = String(entry.data.status || '').trim().toUpperCase();
        return (
            st === 'ACTIVE' &&
            !evaluatePilotExpiration(entry.data.expiresAt ?? entry.data.pilotExpiresAt)
        );
    });

    if (validActiveDocs.length === 0) {
        return { valid: false, allowedTenantIds: new Set(), primaryPilotTenantId: null };
    }

    const allowedTenantIds = new Set<string>();
    const canonicalSandbox = `pilot-${uid}`;
    for (const entry of validActiveDocs) {
        const explicitAccountId = String(
            entry.data.pilotAccountId || entry.data.accountId || ''
        ).trim();
        if (explicitAccountId && explicitAccountId.startsWith('pilot-')) {
            allowedTenantIds.add(explicitAccountId);
        }
        if (entry.docId.startsWith('pilot-')) {
            allowedTenantIds.add(entry.docId);
        }
        if (entry.docId === uid) {
            allowedTenantIds.add(canonicalSandbox);
        }
    }
    if (allowedTenantIds.size === 0) {
        allowedTenantIds.add(canonicalSandbox);
    }

    const primaryPilotTenantId = Array.from(allowedTenantIds)[0] || canonicalSandbox;
    return {
        valid: true,
        allowedTenantIds,
        primaryPilotTenantId,
    };
}

/**
 * Middleware soberano de sesión, entitlements y aislamiento multi-tenant para `/api/supply/*`.
 * Delega la resolución base a `resolveModuleSessionScope('supply')` (entitlements, `modules_status/supply`,
 * `allowedModules.supply`, `accountTier`, `isEduSandbox`) preservando íntegramente las compuertas E01
 * de hermeticidad `3º TEST-PILOT` (`test_pilots`) y `DEV_PRIVATE`, más modo solo lectura `VIEWER`/`BILLING_ONLY`.
 */
export async function requireSupplyTenantScope(
    req: SupplyRequest,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const scopeResult = await invokeSupplyModuleSessionScope(req);

        // Si el token no fue verificado (401) o DEV_PRIVATE bloqueó, retornar inmediatamente
        if (!scopeResult.ok && scopeResult.status === 401) {
            return res.status(401).json(scopeResult.body);
        }
        if (!scopeResult.ok && scopeResult.body?.code === 'RELEASE_STAGE_DEV_ONLY') {
            return res.status(403).json(scopeResult.body);
        }
        if (!scopeResult.ok && scopeResult.body?.code === 'PILOT_ACCOUNT_EXPIRED') {
            return res.status(403).json({
                error: 'Cuenta 3º TEST-PILOT expirada, revocada o sin registro activo.',
                code: 'PILOT_EXPIRED_OR_REVOKED',
            });
        }

        const decoded = req.user;
        if (!decoded?.uid) {
            return res.status(scopeResult.ok ? 401 : scopeResult.status).json(
                scopeResult.ok
                    ? { error: 'No autorizado: Sesión MINREPORT inválida.' }
                    : scopeResult.body
            );
        }

        const uid = String(decoded.uid || '').trim();
        const emailLower = String(decoded.email || '').trim().toLowerCase();
        const emailVerifiedOk = decoded.email_verified !== false;
        const tokenRole = String(decoded.role || '').toUpperCase();

        let profileData: Record<string, any> | null = null;
        try {
            const userSnap = await db.collection('users').doc(uid).get();
            if (userSnap.exists) {
                profileData = userSnap.data() || null;
            }
        } catch {
            profileData = null;
        }

        const serverUserRole = String(profileData?.role || '').toUpperCase();
        const userDisabled = isInactiveStatus(profileData?.status);

        const isDevRoot =
            decoded.isMasterDev === true ||
            tokenRole === 'DEV_ROOT' ||
            uid === 'dev-master-root-uid' ||
            (emailVerifiedOk && emailLower === 'dev@minreport.com');

        const isSuperAdmin =
            !isDevRoot &&
            (decoded.admin === true ||
                tokenRole === 'SUPER_ADMIN' ||
                uid === 'super-admin-uid' ||
                (emailVerifiedOk &&
                    (emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase() ||
                        emailLower === 'admin@minreport.com')));

        const isTestPilot =
            !isDevRoot &&
            !isSuperAdmin &&
            (tokenRole === 'TEST_PILOT' || serverUserRole === 'TEST_PILOT');

        const isSystemPrivileged = isDevRoot || isSuperAdmin;
        const headerTenantId = String(
            req.headers['x-active-account-id'] || req.headers['x-tenant-id'] || ''
        ).trim();

        // Compuerta E01 inquebrantable para 3º TEST-PILOT (jamás hereda hasFullSuiteOverride)
        let verifiedPilotSandbox: VerifiedSupplyTestPilotSandbox | null = null;
        if (isTestPilot) {
            if (userDisabled) {
                return res.status(403).json({
                    error: 'Cuenta 3º TEST-PILOT revocada o suspendida.',
                    code: 'PILOT_EXPIRED_OR_REVOKED',
                });
            }
            verifiedPilotSandbox = await resolveVerifiedTestPilotSandbox(
                uid,
                decoded.pilotExpiresAt,
                profileData?.pilotExpiresAt
            );
            if (!verifiedPilotSandbox.valid || !verifiedPilotSandbox.primaryPilotTenantId) {
                return res.status(403).json({
                    error: 'Cuenta 3º TEST-PILOT expirada, revocada o sin registro activo.',
                    code: 'PILOT_EXPIRED_OR_REVOKED',
                });
            }
        }

        // Si resolveModuleSessionScope('supply') rechazó, solo evaluar excepción de solo lectura para BILLING_ONLY
        let billingOnlyReadOnlyFallback = false;
        let fallbackTenantId = '';
        let fallbackAccountData: Record<string, any> | null = null;
        let fallbackMemberData: Record<string, any> | null = null;

        if (!scopeResult.ok) {
            const isSeatError =
                scopeResult.status === 403 &&
                String(scopeResult.body?.error || '').includes('MODULO_NO_AUTORIZADO_ASIENTO');
            if (!isSeatError) {
                return res.status(scopeResult.status).json(scopeResult.body);
            }

            const candidateTenant =
                headerTenantId ||
                String(decoded.activeAccountId || '').trim() ||
                String(profileData?.lastActiveAccountId || '').trim() ||
                String(profileData?.primaryAccountId || '').trim() ||
                String(profileData?.memberships?.[0]?.accountId || '').trim();

            if (!candidateTenant || !TENANT_ID_REGEX.test(candidateTenant)) {
                return res.status(scopeResult.status).json(scopeResult.body);
            }

            const [accSnap, memSnap] = await Promise.all([
                db.collection('accounts').doc(candidateTenant).get().catch(() => null),
                db
                    .collection('accounts')
                    .doc(candidateTenant)
                    .collection('members')
                    .doc(uid)
                    .get()
                    .catch(() => null),
            ]);
            const accData = accSnap?.exists ? accSnap.data() || null : null;
            const memData = memSnap?.exists ? memSnap.data() || null : null;
            const profMem = Array.isArray(profileData?.memberships)
                ? profileData!.memberships.find(
                      (m: any) => m?.accountId === candidateTenant && !isInactiveStatus(m?.status)
                  )
                : undefined;
            const rawSeatRole = String(memData?.role || profMem?.role || tokenRole || '')
                .trim()
                .toUpperCase();

            const memberStillActive =
                (memData && !isInactiveStatus(memData.status)) || Boolean(profMem);
            if (
                !memberStillActive ||
                (rawSeatRole !== 'BILLING_ONLY' && rawSeatRole !== 'SUBSCRIPTION_ADMIN') ||
                !isAccountSupplyEntitled(accData, true)
            ) {
                return res.status(scopeResult.status).json(scopeResult.body);
            }

            billingOnlyReadOnlyFallback = true;
            fallbackTenantId = candidateTenant;
            fallbackAccountData = accData;
            fallbackMemberData = memData;
        }

        const modCtx = (req as ScopedRequest).moduleContext;
        let resolvedTenantId = billingOnlyReadOnlyFallback
            ? fallbackTenantId
            : String(modCtx?.tenantId || '').trim();

        if (isTestPilot && verifiedPilotSandbox) {
            const candidatePilotTenant =
                headerTenantId ||
                String(decoded.activeAccountId || '').trim() ||
                verifiedPilotSandbox.primaryPilotTenantId!;
            if (!verifiedPilotSandbox.allowedTenantIds.has(candidatePilotTenant)) {
                return res.status(403).json({
                    error: 'TENANT_ACCESS_DENIED: Cuenta 3º TEST-PILOT confinada exclusivamente a su sandbox autorizado.',
                    code: 'TENANT_ACCESS_DENIED',
                });
            }
            resolvedTenantId = candidatePilotTenant;
        }

        if (!resolvedTenantId || !TENANT_ID_REGEX.test(resolvedTenantId)) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED: tenantId inválido o ausente.' });
        }

        if (!isSystemPrivileged && (userDisabled || resolvedTenantId === 'dev-master-sandbox')) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        // Comprobar modules_status/supply también para 3º TEST-PILOT (no es privilegiado)
        if (isTestPilot) {
            try {
                const modSnap = await db.collection('modules_status').doc('supply').get();
                if (modSnap.exists) {
                    const modData = modSnap.data() || {};
                    if (modData.enabled === false || modData.active === false) {
                        return res.status(403).json({
                            error: 'El módulo ABASTECIMIENTO se encuentra temporalmente deshabilitado.',
                            moduleDisabled: true,
                            moduleId: 'supply',
                        });
                    }
                }
            } catch {
                // Fail-open ante timeout transitorio
            }
        }

        let accountData: Record<string, any> | null = fallbackAccountData;
        if (!accountData && resolvedTenantId !== 'dev-master-sandbox') {
            const accSnap = await db.collection('accounts').doc(resolvedTenantId).get().catch(() => null);
            if (accSnap?.exists) {
                accountData = accSnap.data() || null;
            }
        }

        let memberData: Record<string, any> | null = fallbackMemberData;
        if (!memberData && resolvedTenantId !== 'dev-master-sandbox') {
            const memberSnap = await db
                .collection('accounts')
                .doc(resolvedTenantId)
                .collection('members')
                .doc(uid)
                .get()
                .catch(() => null);
            if (memberSnap?.exists) {
                memberData = memberSnap.data() || null;
            }
        }

        if (!isSystemPrivileged && memberData && isInactiveStatus(memberData.status)) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        const isOwner = Boolean(accountData?.ownerId && accountData.ownerId === uid);
        const profileMembership = Array.isArray(profileData?.memberships)
            ? profileData!.memberships.find(
                  (m: any) => m?.accountId === resolvedTenantId && !isInactiveStatus(m?.status)
              )
            : undefined;

        const b2bRole = String(
            (isOwner ? 'OWNER' : '') ||
                memberData?.role ||
                profileMembership?.role ||
                (isDevRoot ? 'DEV_ROOT' : isSuperAdmin ? 'SUPER_ADMIN' : isTestPilot ? 'TEST_PILOT' : 'OPERATOR')
        ).toUpperCase();

        const isEduSandbox = billingOnlyReadOnlyFallback
            ? !isSystemPrivileged &&
              !isTestPilot &&
              (String(accountData?.type || '').toUpperCase() === 'EDUCATIONAL' ||
                  Boolean(accountData?.isEduSandbox))
            : Boolean(modCtx?.isEduSandbox && !isSystemPrivileged && !isTestPilot);

        const accountTier: 1 | 2 | 3 | 4 | 5 = isDevRoot
            ? 1
            : isSuperAdmin
              ? 2
              : isTestPilot
                ? 3
                : isEduSandbox
                  ? 5
                  : (modCtx?.accountTier ?? 4);

        const canMutate = isSystemPrivileged || !isReadOnlyB2bRole(b2bRole);

        const supplyProfile = buildSupplyProfileFromData(
            memberData?.supplyProfile || profileMembership?.supplyProfile,
            b2bRole,
            isSystemPrivileged
        );

        req.supplyContext = {
            tenantId: resolvedTenantId,
            actorUid: uid,
            actorEmail: emailLower || `${uid}@minreport.local`,
            actorName: String(
                memberData?.displayName || profileData?.displayName || decoded.name || emailLower || uid
            ).trim(),
            accountTier,
            isSystemPrivileged,
            isEduSandbox,
            isTestPilot,
            b2bRole,
            canMutate,
            supplyProfile,
            phoneE164: typeof memberData?.phoneE164 === 'string' ? memberData.phoneE164 : undefined,
        };

        return next();
    } catch (err) {
        console.error(
            '[SUPPLY-CONTROLLER] Error resolviendo sesión supply:',
            err instanceof Error ? err.name : 'UnknownError'
        );
        return res.status(401).json({ error: 'No autorizado: Error verificando sesión.' });
    }
}

function requireSupplyMutationAllowed(
    req: SupplyRequest,
    res: Response,
    next: NextFunction
): any {
    const ctx = req.supplyContext;
    if (!ctx || !ctx.canMutate || isReadOnlyB2bRole(ctx.b2bRole)) {
        return res.status(403).json({
            error: 'SUPPLY_RBAC_READ_ONLY: Su perfil tiene acceso solo lectura en ABASTECIMIENTO.',
            code: 'SUPPLY_RBAC_READ_ONLY',
        });
    }
    return next();
}

// ---------------------------------------------------------------------------
// Zod Request Schemas
// ---------------------------------------------------------------------------

const CreateSiteBodySchema = SupplySiteSchema.omit({ tenantId: true, createdAt: true, updatedAt: true }).extend({
    siteId: z.string().trim().min(1).max(128).optional(),
    confirmationKeyword: HitlConfirmationKeywordSchema,
});

const PatchSiteBodySchema = SupplySiteSchema.omit({ tenantId: true, createdAt: true, updatedAt: true })
    .partial()
    .extend({
        confirmationKeyword: HitlConfirmationKeywordSchema,
    });

const UpsertCatalogBodySchema = CanonicalSupplySkuSchema.extend({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    scope: z.enum(['GLOBAL', 'TENANT']).optional().default('TENANT'),
});

const CreateRequisitionBodySchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    demandOrigin: SupplyDemandOriginSchema.default('DESKTOP_MANUAL'),
    demandNature: SupplyDemandNatureSchema.default('REACTIVE_FIELD'),
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMP-ALIMENTACION'),
    linkedAssetId: z.string().trim().max(128).optional(),
    linkedPlanRef: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z
        .array(
            z
                .object({
                    canonicalSkuId: z.string().trim().min(1).max(128).nullable().optional(),
                    rawDescription: z.string().trim().min(1).max(240).optional(),
                    normalizedName: z.string().trim().min(1).max(200).optional(),
                    itemName: z.string().trim().min(1).max(200).optional(),
                    categoryCode: SupplyCategoryCodeSchema.optional(),
                    procurementBucket: ProcurementBucketSchema.optional(),
                    unitSi: z.enum(['kg', 'L', 'un', 'par', 'm', 'm3', 'caja', 'bolsa']).optional(),
                    qtyRequested: z.number().positive(),
                    urgency: SupplyUrgencySchema.default('STANDARD'),
                    estimatedUnitClp: z.number().nonnegative().optional(),
                    attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
                    evidenceCasRef: EvidenceCasRefSchema.nullable().optional(),
                })
                .refine(
                    (l) => Boolean(l.rawDescription || l.normalizedName || l.itemName),
                    'Cada línea requiere rawDescription, normalizedName o itemName.'
                )
        )
        .min(1)
        .max(100),
});

const PatchRequisitionBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    status: RequisitionStatusSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
});

const TopLevelAllocationInputSchema = z.object({
    purchaseLineId: z.string().trim().min(1).max(128),
    requisitionId: z.string().trim().min(1).max(128).nullable().optional(),
    requisitionLineId: z.string().trim().min(1).max(128).nullable().optional(),
    allocationKind: z.enum(['REQUISITION_MATCH', 'UNSOLICITED_PURCHASE']).optional(),
    qtyAllocated: z.number().positive(),
    unitSi: z.enum(['kg', 'L', 'un', 'par', 'm', 'm3', 'caja', 'bolsa']).optional(),
    resultingRequisitionLineStatus: RequisitionStatusSchema.nullable().optional(),
});

const FlexiblePurchaseLineInputSchema = z.object({
    purchaseLineId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().min(1).max(128).nullable().optional(),
    description: z.string().trim().min(1).max(240).optional(),
    rawDescription: z.string().trim().min(1).max(240).optional(),
    normalizedName: z.string().trim().min(1).max(240).optional(),
    categoryCode: SupplyCategoryCodeSchema.optional(),
    procurementBucket: ProcurementBucketSchema.optional(),
    unitSi: z.enum(['kg', 'L', 'un', 'par', 'm', 'm3', 'caja', 'bolsa']).optional(),
    qtyPurchased: z.number().positive(),
    unitPriceClp: z.number().nonnegative().optional(),
    unitPriceNetClp: z.number().nonnegative().optional(),
    unitPriceGrossClp: z.number().nonnegative().optional(),
    subtotalClp: z.number().nonnegative().optional(),
    lineNetClp: z.number().nonnegative().optional(),
    lineVatClp: z.number().nonnegative().optional(),
    lineTotalClp: z.number().nonnegative().optional(),
    linePricingBasis: LinePricingBasisSchema.optional(),
    destination: PurchaseLineDestinationSchema.default('STOCK_IN_TRANSIT'),
    costCenter: z.string().trim().max(64).default('CC-CAMP-ALIMENTACION'),
    isCapexAsset: z.boolean().optional(),
    serialOrTag: z.string().trim().max(120).optional(),
    explicitAllocations: z
        .array(
            z.object({
                reqId: z.string().trim().min(1).max(128),
                reqLineId: z.string().trim().min(1).max(128),
                qtyAllocated: z.number().positive(),
            })
        )
        .optional(),
});

const CreatePurchaseBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    siteId: z.string().trim().min(1).max(128),
    purchaseMode: PurchaseModeSchema.default('REQUISITION_FULFILLMENT'),
    supplierTaxId: z.string().trim().min(3).max(32),
    supplierName: z.string().trim().min(1).max(200),
    documentType: SiiDteTypeSchema,
    folio: z.union([
        z.number().int().nonnegative(),
        z
            .string()
            .trim()
            .min(1)
            .max(64)
            .transform((val) => {
                const digits = val.replace(/\D/g, '');
                return digits ? Number(digits) : 0;
            }),
    ]),
    issueDate: z.string().trim().min(8).max(32),
    netAmountClp: z.number().nonnegative(),
    vatAmountClp: z.number().nonnegative(),
    totalAmountClp: z.number().nonnegative(),
    paymentMethod: PaymentMethodSchema,
    evidenceCasRef: EvidenceCasRefSchema.nullable().optional(),
    tedRawXml: z.string().max(16384).nullable().optional(),
    expectedReceiverTaxId: z.string().trim().max(32).optional(),
    countryCode: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
    allocations: z.array(TopLevelAllocationInputSchema).max(500).optional(),
    lines: z.array(FlexiblePurchaseLineInputSchema).min(1).max(200),
});

const ConfirmReceptionBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    receivedLines: z
        .array(
            z
                .object({
                    purchaseLineId: z.string().trim().min(1).max(128),
                    qtyReceived: z.number().nonnegative().optional(),
                    qtyReceivedNow: z.number().nonnegative().optional(),
                })
                .refine(
                    (l) => l.qtyReceived !== undefined || l.qtyReceivedNow !== undefined,
                    'Cada línea recibida requiere qtyReceivedNow o qtyReceived.'
                )
        )
        .optional(),
    notes: z.string().trim().max(500).optional(),
});

const LinkOpermaqBodySchema = z
    .object({
        confirmationKeyword: HitlConfirmationKeywordSchema,
        opermaqAssetId: z.string().trim().min(1).max(128).optional(),
        createOpermaqFleetUnit: z.boolean().optional(),
    })
    .refine(
        (d) => Boolean(d.opermaqAssetId) || d.createOpermaqFleetUnit === true,
        'Debe especificar opermaqAssetId o createOpermaqFleetUnit=true.'
    );

const CreateCashLedgerBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    siteId: z.string().trim().min(1).max(128),
    paymentMethod: PaymentMethodSchema,
    direction: z.enum(['ADVANCE_OUT', 'EXPENSE_RENDERED', 'REIMBURSEMENT_DUE', 'SETTLEMENT_IN']),
    amountClp: z.number().positive(),
    netAmountClp: z.number().nonnegative().optional(),
    vatCreditClp: z.number().nonnegative().optional(),
    isCapex: z.boolean().default(false),
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMP-ALIMENTACION'),
    referenceId: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(300),
});

const CreateExpenseReportBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    siteId: z.string().trim().min(1).max(128),
    paymentMethod: PaymentMethodSchema,
    title: z.string().trim().min(2).max(200),
    periodLabel: z.string().trim().min(2).max(80).optional(),
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMP-ALIMENTACION'),
    fundAdvanceClp: z.number().nonnegative(),
    siiDocumentIds: z.array(z.string().trim().min(1).max(160)).max(200).default([]),
});

const PatchExpenseReportBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    status: z.union([SiiExpenseReportStatusSchema, z.literal('PAID')]),
});

const RecalculateForecastBodySchema = z.object({
    siteId: z.string().trim().min(1).max(128).optional(),
});

const RefreshMarketplaceSignalsBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
});

const SimulateWhatsAppBodySchema = z.object({
    phoneE164: z.string().trim().min(8).max(24).optional(),
    fromPhoneE164: z.string().trim().min(8).max(24).optional(),
    wamid: z.string().trim().min(4).max(128).optional(),
    type: z.enum(['text', 'audio', 'image', 'document', 'interactive']).default('text'),
    text: z.string().max(4000).optional(),
    textBody: z.string().max(4000).optional(),
    interactiveReplyId: z.string().max(128).optional(),
    caption: z.string().max(1000).optional(),
    filename: z.string().max(200).optional(),
    mimeType: z.string().max(100).optional(),
    mediaBase64: z.string().max(15_000_000).optional(),
    xmlDteContent: z.string().max(500_000).optional(),
    xmlContent: z.string().max(500_000).optional(),
    tedRawXml: z.string().max(12_000).optional(),
    simulateSenderRole: SupplyOperationalRoleSchema.optional(),
    simulatedRole: SupplyOperationalRoleSchema.optional(),
    siteId: z.string().trim().min(1).max(128).optional(),
    flushImmediately: z.boolean().default(true),
    debounceWindowMs: z.number().int().min(8000).max(15000).optional(),
});

// ---------------------------------------------------------------------------
// Express Router (`/api/supply`)
// ---------------------------------------------------------------------------

const router = Router();

/**
 * 1. META WHATSAPP CLOUD API WEBHOOK (GET + POST)
 * Registrado ANTES de `requireSupplyTenantScope` porque Meta autentica mediante
 * `hub.verify_token` (GET) y firma HMAC-SHA256 `X-Hub-Signature-256` (POST).
 */
router.get('/whatsapp/webhook', async (req: Request, res: Response) => {
    const mode = typeof req.query['hub.mode'] === 'string' ? req.query['hub.mode'] : undefined;
    const verifyToken =
        typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : undefined;
    const challenge =
        typeof req.query['hub.challenge'] === 'string' ? req.query['hub.challenge'] : undefined;

    const verified = await MetaWhatsAppCloudAdapter.verifyWebhookChallenge({
        mode,
        verifyToken,
        challenge,
    });

    if (!verified.ok || !verified.challenge) {
        return res.status(403).json({ error: verified.error || 'Webhook verification failed.' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(verified.challenge);
});

router.post(
    '/whatsapp/webhook',
    express.json({
        limit: '5mb',
        verify: (req: any, _res, buf) => {
            if (!req.rawBody && buf?.length) {
                req.rawBody = Buffer.from(buf);
            }
        },
    }),
    async (req: SupplyRequest, res: Response) => {
        try {
            const sigHeader =
                typeof req.headers['x-hub-signature-256'] === 'string'
                    ? req.headers['x-hub-signature-256']
                    : undefined;

            if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length === 0) {
                return res.status(401).json({
                    error: 'INVALID_WHATSAPP_SIGNATURE',
                    message: 'Cuerpo crudo (rawBody) requerido para verificación criptográfica HMAC-SHA256.',
                });
            }

            const incomingPhoneNumberIds = MetaWhatsAppCloudAdapter.extractWebhookPhoneNumberIds(req.body);
            const resolvedChannels = new Map<
                string,
                Awaited<ReturnType<typeof MetaWhatsAppCloudAdapter.resolveChannelConfig>>
            >();
            for (const pid of incomingPhoneNumberIds) {
                resolvedChannels.set(pid, await MetaWhatsAppCloudAdapter.resolveChannelConfig(pid));
            }

            const channelAppSecret =
                Array.from(resolvedChannels.values()).find((cfg) => cfg?.appSecret)?.appSecret ||
                undefined;

            const isValidSig = await MetaWhatsAppCloudAdapter.verifyWebhookSignature(
                req.rawBody,
                sigHeader,
                channelAppSecret
            );

            if (!isValidSig) {
                return res.status(401).json({
                    error: 'INVALID_WHATSAPP_SIGNATURE',
                    message: 'Firma criptográfica X-Hub-Signature-256 inválida o ausente.',
                });
            }

            const isAuthorizedPhoneNumberId = (phoneNumberId?: string): boolean => {
                if (!phoneNumberId) return true;
                return Boolean(resolvedChannels.get(phoneNumberId));
            };

            const allStatusEvents = MetaWhatsAppCloudAdapter.extractStatusEvents(req.body);
            const authorizedStatusEvents = allStatusEvents.filter((st) =>
                isAuthorizedPhoneNumberId(st.phoneNumberId)
            );
            const statuses: Array<{ wamid: string; status: string; errorCodes: number[] }> = [];

            for (const st of authorizedStatusEvents) {
                const errorCodes = st.errors.map((e) => e.code);
                statuses.push({
                    wamid: st.wamid,
                    status: st.status,
                    errorCodes,
                });
                if (st.status === 'failed') {
                    console.warn(
                        `[SUPPLY-WA-STATUS] Entrega fallida wamid=${st.wamid} dest=${maskPiiForLog(st.recipientId || '')} codes=${errorCodes.join(',') || 'unknown'}`
                    );
                }
                const safeStatusDocId = st.wamid.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
                await db
                    .collection(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS)
                    .doc(safeStatusDocId)
                    .set(
                        {
                            wamid: st.wamid,
                            deliveryStatus: st.status,
                            deliveryStatusAt: new Date(st.timestampMs).toISOString(),
                            deliveryErrorCodes: errorCodes,
                            updatedAt: new Date().toISOString(),
                            ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(),
                        },
                        { merge: true }
                    )
                    .catch(() => {});
            }

            const allInboundEvents = MetaWhatsAppCloudAdapter.parseWebhookEvents(req.body);
            const inboundEvents = allInboundEvents.filter((ev) =>
                isAuthorizedPhoneNumberId(ev.phoneNumberId)
            );
            const ignoredUnknownChannels =
                allInboundEvents.length -
                inboundEvents.length +
                (allStatusEvents.length - authorizedStatusEvents.length);

            const flushImmediately =
                process.env.NODE_ENV === 'test' && req.query.flush === 'true';

            const results = [];
            for (const event of inboundEvents) {
                const preCheck = await CampChannel.preEnqueueWamidForWebhook(event.wamid);
                if (preCheck.duplicate || !preCheck.shouldEnqueue) {
                    results.push({
                        wamid: event.wamid,
                        handled: false,
                        duplicate: true,
                        buffered: false,
                        queued: false,
                    });
                    continue;
                }

                const enqueued = await SupplyTaskQueueService.enqueueInboundWhatsAppMessage({
                    event,
                    flushImmediately,
                    dispatchToken: preCheck.dispatchToken,
                });
                results.push({
                    wamid: event.wamid,
                    handled: true,
                    duplicate: false,
                    buffered: true,
                    queued: enqueued.enqueued,
                    dispatchMode: enqueued.dispatchMode,
                });
            }

            return res.status(200).json({
                ok: true,
                received: inboundEvents.length,
                ignoredUnknownChannels,
                statusesProcessed: statuses.length,
                statuses,
                results,
            });
        } catch (err) {
            console.error('[SUPPLY-WA-WEBHOOK] Error procesando webhook Meta:', err);
            return res.status(500).json({ error: 'Error interno procesando evento WhatsApp.' });
        }
    }
);

/**
 * 1.0b META WHATSAPP FLOWS v3.0 DATA ENDPOINT (`POST /api/supply/whatsapp/flow-exchange`)
 * Registrado ANTES de `requireSupplyTenantScope` porque Meta autentica mediante firma HMAC-SHA256
 * `X-Hub-Signature-256` sobre `req.rawBody` Buffer + cifrado híbrido RSA-2048 OAEP-SHA256 / AES-GCM
 * y `flow_token` firmado multi-tenant.
 */
router.post(
    '/whatsapp/flow-exchange',
    express.json({
        limit: '2mb',
        verify: (req: any, _res, buf) => {
            if (!req.rawBody && buf?.length) {
                req.rawBody = Buffer.from(buf);
            }
        },
    }),
    async (req: SupplyRequest, res: Response) => {
        try {
            const sigHeader =
                typeof req.headers['x-hub-signature-256'] === 'string'
                    ? req.headers['x-hub-signature-256']
                    : undefined;

            if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length === 0) {
                return res.status(401).json({
                    error: 'INVALID_WHATSAPP_SIGNATURE',
                    message:
                        'Cuerpo crudo (rawBody) requerido para verificación criptográfica HMAC-SHA256.',
                });
            }

            const isValidSig = await MetaWhatsAppCloudAdapter.verifyWebhookSignature(
                req.rawBody,
                sigHeader
            );

            if (!isValidSig) {
                return res.status(401).json({
                    error: 'INVALID_WHATSAPP_SIGNATURE',
                    message: 'Firma criptográfica X-Hub-Signature-256 inválida o ausente.',
                });
            }

            const { privateKeyPem, passphrase } = await resolveFlowsPrivateKeyMaterial();
            if (!privateKeyPem) {
                throw new WhatsAppFlowCryptoError(
                    'WHATSAPP_FLOWS_PRIVATE_KEY no configurada en Secret Manager (southamerica-west1).',
                    421,
                    'FLOW_PRIVATE_KEY_MISSING'
                );
            }

            const { decryptedBody, aesKeyBuffer, initialVectorBuffer } =
                WhatsAppFlowsCrypto.decryptFlowRequest(
                    req.body || {},
                    privateKeyPem,
                    passphrase
                );

            const responsePayload = await SupplyFlowsHandler.handle(decryptedBody, {
                ipAddress: extractClientIp(req),
            });

            const encryptedResponseBase64 = WhatsAppFlowsCrypto.encryptFlowResponse(
                responsePayload as unknown as Record<string, unknown>,
                aesKeyBuffer,
                initialVectorBuffer
            );

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send(encryptedResponseBase64);
        } catch (err) {
            if (err instanceof WhatsAppFlowCryptoError) {
                return res.status(err.statusCode || 421).json({
                    error: err.code,
                    message: err.message,
                });
            }
            console.error(
                '[SUPPLY-WA-FLOW-EXCHANGE] Error procesando Flow cifrado Meta v3.0:',
                err instanceof Error ? err.message : 'UnknownError'
            );
            return res.status(500).json({
                error: 'FLOW_EXCHANGE_INTERNAL_ERROR',
                message: 'Error interno procesando WhatsApp Flow v3.0.',
            });
        }
    }
);

const SupplyWorkerInboundBodySchema = z.object({
    event: z.object({
        wamid: z.string().trim().min(1).max(256),
        fromE164: z.string().trim().min(6).max(32),
        timestampMs: z.number().finite(),
        type: z.enum(['text', 'audio', 'image', 'document', 'interactive', 'unknown']),
        textBody: z.string().optional(),
        interactiveReplyId: z.string().optional(),
        interactiveReplyTitle: z.string().optional(),
        mediaId: z.string().optional(),
        mimeType: z.string().optional(),
        caption: z.string().optional(),
        filename: z.string().optional(),
        phoneNumberId: z.string().optional(),
        profileName: z.string().optional(),
    }),
    flushImmediately: z.boolean().optional(),
    dispatchToken: z.string().trim().max(128).optional(),
    skipOutboundSend: z.boolean().optional(),
    enqueuedAtMs: z.number().optional(),
});

const SupplyWorkerFlushBodySchema = z.object({
    sessionId: z.string().trim().min(4).max(160),
    tenantId: z.string().trim().max(128).optional(),
    expectedDebounceUntilMs: z.number().finite().optional(),
    skipOutboundSend: z.boolean().optional(),
    forceFlush: z.boolean().optional(),
    enqueuedAtMs: z.number().optional(),
});

/**
 * 1.1 CLOUD TASKS WORKER ENDPOINTS (Protegidos exclusivamente por `verifySupplyWorkerOidcAuth`)
 * Registrados antes de `requireSupplyTenantScope` porque son invocados por Google Cloud Tasks con OIDC SA.
 */
router.post(
    '/whatsapp/worker/inbound',
    verifySupplyWorkerOidcAuth,
    async (req: Request, res: Response) => {
        try {
            const parsed = SupplyWorkerInboundBodySchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload de worker inbound inválido.',
                    details: parsed.error.flatten(),
                });
            }

            const outcome = await CampChannel.handleInboundMessage(parsed.data.event, {
                flushImmediately: parsed.data.flushImmediately,
                dispatchToken: parsed.data.dispatchToken,
                skipOutboundSend: parsed.data.skipOutboundSend,
            });

            return res.status(200).json({
                ok: true,
                wamid: parsed.data.event.wamid,
                outcome,
            });
        } catch (err) {
            console.error(
                '[SUPPLY-WA-WORKER-INBOUND] Error procesando tarea inbound:',
                err instanceof Error ? err.message : 'UnknownError'
            );
            return res.status(500).json({ error: 'Error procesando mensaje WhatsApp en worker.' });
        }
    }
);

router.post(
    '/whatsapp/worker/flush',
    verifySupplyWorkerOidcAuth,
    async (req: Request, res: Response) => {
        try {
            const parsed = SupplyWorkerFlushBodySchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload de worker flush inválido.',
                    details: parsed.error.flatten(),
                });
            }

            const outcome = await CampChannel.flushDebouncedSession(
                parsed.data.sessionId,
                undefined,
                {
                    skipOutboundSend: parsed.data.skipOutboundSend,
                    forceFlush: parsed.data.forceFlush,
                    expectedDebounceUntilMs: parsed.data.expectedDebounceUntilMs,
                }
            );

            return res.status(200).json({
                ok: true,
                sessionId: parsed.data.sessionId,
                outcome,
            });
        } catch (err) {
            console.error(
                '[SUPPLY-WA-WORKER-FLUSH] Error ejecutando flush de sesión:',
                err instanceof Error ? err.message : 'UnknownError'
            );
            return res.status(500).json({ error: 'Error ejecutando flush diferido de sesión WhatsApp.' });
        }
    }
);

/**
 * 1.2 ONBOARDING CERO-FRICCIÓN PROVEEDORES LOCALES (`/rfq-express/:token`)
 * Registrado ANTES de `requireSupplyTenantScope` para permitir cotización exprés de un solo uso
 * sin portal ni licencia previa mediante token HMAC-SHA256 firmado + rate limiting.
 */
router.get(
    '/rfq-express/:token',
    (req: Request, res: Response, next: NextFunction) => {
        if (req.params.token === 'invites') {
            return next('route');
        }
        return authRateLimiter(req, res, next);
    },
    async (req: Request, res: Response) => {
        try {
            const token = String(req.params.token || '').trim();
            const invite = await SupplierZeroFrictionRfqService.inspectExpressRfqInvite(token);
            return res.status(200).json({
                success: true,
                invite,
            });
        } catch (err: any) {
            if (err instanceof ExpressRfqError) {
                return res.status(err.statusCode).json({
                    error: err.message,
                    code: err.code,
                });
            }
            console.error('[SUPPLY-RFQ-EXPRESS] Error inspeccionando invitación RFQ:', err);
            return res.status(500).json({ error: 'Error consultando invitación RFQ.' });
        }
    }
);

router.post(
    '/rfq-express/:token/submit',
    mutationRateLimiter,
    async (req: Request, res: Response) => {
        try {
            const token = String(req.params.token || '').trim();
            const result = await SupplierZeroFrictionRfqService.submitExpressRfqQuote(
                token,
                req.body || {},
                { ipAddress: extractClientIp(req) }
            );
            return res.status(201).json({
                success: true,
                quote: {
                    quoteId: result.quote.quoteId,
                    inviteId: result.quote.inviteId,
                    districtCode: result.quote.districtCode,
                    currencyCode: result.quote.currencyCode,
                    totalEstimatedNet: result.quote.totalEstimatedNet,
                    leadTimeDays: result.quote.leadTimeDays,
                    validUntilIso: result.quote.validUntilIso,
                    status: result.quote.status,
                    submittedAtIso: result.quote.submittedAtIso,
                },
            });
        } catch (err: any) {
            if (err instanceof ExpressRfqError) {
                return res.status(err.statusCode).json({
                    error: err.message,
                    code: err.code,
                });
            }
            console.error('[SUPPLY-RFQ-EXPRESS] Error enviando cotización RFQ:', err);
            return res.status(500).json({ error: 'Error procesando cotización RFQ.' });
        }
    }
);

// Todas las rutas siguientes exigen sesión verificada y aislamiento multi-tenant
router.use(requireSupplyTenantScope);

// Matriz RBAC solo lectura: bloquea TODA mutación para perfiles VIEWER / BILLING_ONLY
router.use((req: SupplyRequest, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return requireSupplyMutationAllowed(req, res, next);
    }
    return next();
});

// ---------------------------------------------------------------------------
// Sites (`/sites`)
// ---------------------------------------------------------------------------

router.get('/sites', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const sites = await SupplyRepository.listSites(ctx.tenantId);
        return res.status(200).json({ success: true, tenantId: ctx.tenantId, sites });
    } catch (err) {
        console.error('[SUPPLY] Error listando sitios:', err);
        return res.status(500).json({ error: 'Error consultando sitios de abastecimiento.' });
    }
});

router.post('/sites', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const parsed = CreateSiteBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Alta de sitio requiere confirmationKeyword="ACTUALIZAR" y payload válido.',
                details: parsed.error.flatten(),
            });
        }
        const { confirmationKeyword: _kw, ...sitePayload } = parsed.data;
        const isSandboxAccount =
            ctx.isEduSandbox || ctx.accountTier === 5 || ctx.isTestPilot || ctx.accountTier === 3;
        if (isSandboxAccount && sitePayload.marketplaceOptIn === true) {
            return res.status(403).json({
                error: 'MARKETPLACE_OPT_IN_FORBIDDEN_IN_SANDBOX: Las cuentas 5º EDU y 3º TEST-PILOT no pueden activar marketplaceOptIn.',
                code: 'MARKETPLACE_OPT_IN_FORBIDDEN_IN_SANDBOX',
            });
        }
        const safeSitePayload = isSandboxAccount
            ? { ...sitePayload, marketplaceOptIn: false }
            : sitePayload;
        const site = await SupplyRepository.upsertSite(ctx.tenantId, safeSitePayload, {
            actorUid: ctx.actorUid,
            actorEmail: ctx.actorEmail,
            ipAddress: extractClientIp(req),
        });
        return res.status(201).json({ success: true, site });
    } catch (err: any) {
        if (err instanceof SupplyForbiddenError) {
            return res.status(403).json({ error: err.message, code: err.code });
        }
        console.error('[SUPPLY] Error creando sitio:', err);
        return res.status(500).json({ error: 'Error creando sitio de abastecimiento.' });
    }
});

router.patch('/sites/:siteId', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = String(req.params.siteId || '').trim();
        const parsed = PatchSiteBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Mutación de sitio requiere confirmationKeyword="ACTUALIZAR" y campos válidos.',
                details: parsed.error.flatten(),
            });
        }
        const existing = await SupplyRepository.getSite(ctx.tenantId, siteId);
        if (!existing) {
            return res.status(404).json({ error: 'Sitio no encontrado en la cuenta activa.' });
        }
        const { confirmationKeyword: _kw, ...patch } = parsed.data;
        const isSandboxAccount =
            ctx.isEduSandbox || ctx.accountTier === 5 || ctx.isTestPilot || ctx.accountTier === 3;
        if (isSandboxAccount && patch.marketplaceOptIn === true) {
            return res.status(403).json({
                error: 'MARKETPLACE_OPT_IN_FORBIDDEN_IN_SANDBOX: Las cuentas 5º EDU y 3º TEST-PILOT no pueden activar marketplaceOptIn.',
                code: 'MARKETPLACE_OPT_IN_FORBIDDEN_IN_SANDBOX',
            });
        }
        const safeMergedSite = isSandboxAccount
            ? { ...existing, ...patch, marketplaceOptIn: false, siteId }
            : { ...existing, ...patch, siteId };
        const site = await SupplyRepository.upsertSite(
            ctx.tenantId,
            safeMergedSite,
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );
        return res.status(200).json({ success: true, site });
    } catch (err: any) {
        if (err instanceof SupplyForbiddenError) {
            return res.status(403).json({ error: err.message, code: err.code });
        }
        console.error('[SUPPLY] Error actualizando sitio:', err);
        return res.status(500).json({ error: 'Error actualizando sitio de abastecimiento.' });
    }
});

// ---------------------------------------------------------------------------
// Catalog (`/catalog`)
// ---------------------------------------------------------------------------

router.get('/catalog', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const items = await SupplyRepository.listCatalog({
            tenantId: ctx.tenantId,
            categoryCode: typeof req.query.categoryCode === 'string' ? req.query.categoryCode : undefined,
            procurementBucket:
                typeof req.query.procurementBucket === 'string' ? req.query.procurementBucket : undefined,
            search: typeof req.query.search === 'string' ? req.query.search : undefined,
        });
        return res.status(200).json({ success: true, count: items.length, items });
    } catch (err) {
        console.error('[SUPPLY] Error consultando catálogo:', err);
        return res.status(500).json({ error: 'Error consultando catálogo canónico.' });
    }
});

router.post('/catalog', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const parsed = UpsertCatalogBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Alta de SKU requiere confirmationKeyword="ACTUALIZAR" y esquema válido.',
                details: parsed.error.flatten(),
            });
        }
        const { confirmationKeyword: _kw, scope, ...skuData } = parsed.data;
        if (scope === 'GLOBAL' && ctx.accountTier > 2) {
            return res.status(403).json({
                error: 'Solo 1º DEV o 2º ADMIN pueden mutar el catálogo maestro global.',
            });
        }

        const saved = await SupplyRepository.upsertCatalogSku(
            {
                ...skuData,
                tenantId: scope === 'GLOBAL' ? undefined : ctx.tenantId,
            },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            },
            scope === 'GLOBAL' ? 'global' : ctx.tenantId
        );
        return res.status(201).json({ success: true, sku: saved });
    } catch (err: any) {
        if (err instanceof SupplyForbiddenError) {
            return res.status(403).json({ error: err.message, code: err.code });
        }
        console.error('[SUPPLY] Error guardando SKU:', err);
        return res.status(500).json({ error: 'Error guardando SKU de abastecimiento.' });
    }
});

// ---------------------------------------------------------------------------
// Requisitions (`/requisitions`) & Consolidated Lists (`/shopping-lists/consolidated`)
// ---------------------------------------------------------------------------

router.get('/requisitions', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const rawStatus = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
        const parsedStatus = rawStatus ? RequisitionStatusSchema.safeParse(rawStatus) : null;
        const origin = typeof req.query.origin === 'string' ? req.query.origin : undefined;

        const requisitions = await SupplyRepository.listRequisitions(ctx.tenantId, {
            siteId,
            status: parsedStatus?.success ? parsedStatus.data : undefined,
            origin,
        });
        return res.status(200).json({ success: true, count: requisitions.length, requisitions });
    } catch (err) {
        console.error('[SUPPLY] Error listando requisiciones:', err);
        return res.status(500).json({ error: 'Error listando requisiciones.' });
    }
});

router.post('/requisitions', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const parsed = CreateRequisitionBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload de requisición inválido.',
                details: parsed.error.flatten(),
            });
        }

        const [site, recentSiteReqs, siteInventory] = await Promise.all([
            SupplyRepository.getSite(ctx.tenantId, parsed.data.siteId),
            SupplyRepository.listRequisitions(ctx.tenantId, { siteId: parsed.data.siteId }).catch(() => []),
            SupplyRepository.listInventory(ctx.tenantId, parsed.data.siteId).catch(() => []),
        ]);
        const roleMismatchMode = site?.roleMismatchMode || 'FLAG_AND_ACCEPT';
        const actorOpRole = asOperationalRole(ctx.supplyProfile.role);
        const roleDefaults = DEFAULT_ROLE_PROFILES[actorOpRole];
        const domainMemberProfile = {
            ...roleDefaults,
            allowedCategories:
                ctx.supplyProfile.allowedCategories && ctx.supplyProfile.allowedCategories.length > 0
                    ? ctx.supplyProfile.allowedCategories
                    : roleDefaults.allowedCategories,
            deniedCategories:
                ctx.supplyProfile.deniedCategories && ctx.supplyProfile.deniedCategories.length > 0
                    ? ctx.supplyProfile.deniedCategories
                    : roleDefaults.deniedCategories,
            maxRequisitionClp: ctx.supplyProfile.maxRequisitionClp ?? roleDefaults.maxRequisitionClp,
            canRecordDirectPurchase: ctx.supplyProfile.canRecordDirectPurchase,
            autoApproveDirectPurchase: ctx.supplyProfile.autoApproveDirectPurchase,
            allowCapex: ctx.supplyProfile.allowCapex,
            licensedForControlledItems: Boolean(
                (ctx.supplyProfile as any).licensedForControlledItems ??
                    (ctx.isSystemPrivileged || actorOpRole === 'OWNER_EXEC')
            ),
        };

        // 1. Normalización de unidades SI + Ley del Saco 25 kg (`UnitNormalizationEngine` + `DefaultSupplyCatalogSeed`)
        const preparedLines = parsed.data.lines.map((rawLine, idx) => {
            const resolvedItemName = (
                rawLine.normalizedName ||
                rawLine.itemName ||
                rawLine.rawDescription ||
                ''
            ).trim();
            const rawTextForPolicy = `${rawLine.rawDescription || ''} ${resolvedItemName}`.trim();
            const norm = normalizeSupplyItemFromText(resolvedItemName, rawLine.qtyRequested, rawLine.unitSi);
            const domainSeedSku =
                (rawLine.canonicalSkuId
                    ? SupplyRepository.resolveCanonicalSkuFromSeed(rawLine.canonicalSkuId)
                    : undefined) || matchDomainCanonicalSkuByText(rawTextForPolicy);
            const unitNorm = normalizeQuantityToSi({
                quantity: rawLine.qtyRequested,
                unitRaw: rawLine.unitSi,
                itemText: rawTextForPolicy,
                sku: domainSeedSku,
            });
            const effectiveUnitSi = rawLine.unitSi || unitNorm.unitSi || norm.unitSi;
            const effectiveQtySi = rawLine.unitSi
                ? rawLine.qtyRequested
                : unitNorm.factorApplied !== 1
                  ? unitNorm.quantitySi
                  : rawLine.qtyRequested;
            const categoryCode = rawLine.categoryCode || domainSeedSku?.categoryCode || norm.categoryCode;
            const procurementBucket =
                rawLine.procurementBucket || domainSeedSku?.procurementBucket || norm.procurementBucket;
            const canonicalSkuId = rawLine.canonicalSkuId || norm.canonicalSkuId;

            return {
                itemKey: `line_${idx}`,
                rawLine,
                resolvedItemName,
                rawTextForPolicy,
                canonicalSkuId,
                categoryCode,
                procurementBucket,
                unitSi: effectiveUnitSi,
                qtySi: effectiveQtySi,
                leySaco25kgApplied: Boolean(unitNorm.leySaco25kgApplied || norm.leySaco25kgApplied),
                isCapexAsset: Boolean(norm.isCapexAsset || domainSeedSku?.isCapexAsset),
                domainSeedSku,
            };
        });

        // 2. Evaluación determinista de políticas (`SupplyPolicyAndAnomalyEngine`: DS 132 NFD/leet, DGMN explosivos, 5 flags)
        const policyCandidates: PolicyItemCandidate[] = preparedLines.map((p) => ({
            itemKey: p.itemKey,
            rawText: p.rawTextForPolicy,
            canonicalSkuId: p.canonicalSkuId,
            sku: p.domainSeedSku,
            categoryCode: p.categoryCode,
            quantitySi: p.qtySi,
            unitSi: p.unitSi,
            estimatedUnitClp: p.rawLine.estimatedUnitClp,
            isCapexAsset: p.isCapexAsset,
            isControlled: Boolean(p.domainSeedSku?.isControlled || p.categoryCode === 'EXPLOSIVOS_REGULADO'),
        }));

        const availableStockBySku: Record<string, { inWarehouseSi: number; inTransitSi: number }> = {};
        for (const inv of siteInventory) {
            availableStockBySku[inv.canonicalSkuId] = {
                inWarehouseSi: inv.qtyInWarehouse,
                inTransitSi: inv.qtyInTransit,
            };
        }

        const recentRequisitions = recentSiteReqs.flatMap((r) =>
            r.lines.map((l) => ({
                canonicalSkuId: l.canonicalSkuId,
                requestedAtIso: r.createdAt,
                qtyRequestedSi: l.qtyRequested,
            }))
        );

        const policyEval = evaluateRequisitionPolicy(policyCandidates, {
            requesterRole: actorOpRole,
            memberProfile: domainMemberProfile,
            demandNature: parsed.data.demandNature,
            roleMismatchMode,
            availableStockBySku,
            recentRequisitions,
        });

        const deniedItems: Array<{ itemName: string; reason: string; code?: string }> = [];
        for (const rej of policyEval.rejectedItems) {
            const matchPrep = preparedLines.find((p) => p.itemKey === rej.itemKey);
            deniedItems.push({
                itemName: matchPrep?.resolvedItemName || rej.rawText,
                reason: rej.reasonSpanish,
                code: rej.rejectionCode,
            });
            await SupplyRepository.recordPolicyAudit({
                tenantId: ctx.tenantId,
                siteId: parsed.data.siteId,
                actorUid: ctx.actorUid,
                eventType:
                    rej.rejectionCode === 'DGMN_EXPLOSIVES_BLOCK'
                        ? 'DGMN_EXPLOSIVES_BLOCK'
                        : rej.rejectionCode === 'ROLE_MISMATCH_STRICT_BLOCK'
                          ? 'ROLE_MISMATCH_BLOCK'
                          : 'POLICY_HARD_DENY',
                policyCode: rej.rejectionCode,
                severity:
                    rej.rejectionCode === 'DGMN_EXPLOSIVES_BLOCK' ||
                    rej.rejectionCode === 'DS132_ALCOHOL' ||
                    rej.rejectionCode === 'DS132_DRUGS'
                        ? 'CRITICAL'
                        : 'HIGH',
                rawItemText: rej.rawText,
                details: {
                    matchedTerm: rej.matchedTerm || null,
                    requesterRole: actorOpRole,
                    reason: rej.reasonSpanish,
                },
            }).catch(() => {});
        }

        const acceptedByKey = new Map(policyEval.acceptedItems.map((a) => [a.itemKey, a]));
        const acceptedLines = [];

        for (let idx = 0; idx < preparedLines.length; idx++) {
            const prep = preparedLines[idx];
            const accepted = acceptedByKey.get(prep.itemKey);
            if (!accepted) continue;

            const mergedAttributes = prep.leySaco25kgApplied
                ? { ...(prep.rawLine.attributes || {}), leySaco25kgApplied: true }
                : prep.rawLine.attributes;

            acceptedLines.push({
                lineId: `rline_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
                canonicalSkuId: prep.canonicalSkuId,
                itemName: prep.resolvedItemName,
                rawRequestedText: prep.rawLine.rawDescription || prep.resolvedItemName,
                categoryCode: prep.categoryCode,
                procurementBucket: prep.procurementBucket,
                unitSi: prep.unitSi,
                qtyRequested: prep.qtySi,
                qtyPurchased: 0,
                qtyReceived: 0,
                qtyPending: prep.qtySi,
                lineStatus: 'OPEN' as const,
                atypicalFlags: accepted.atypicalFlags,
                fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE' as const,
                urgency: prep.rawLine.urgency,
                estimatedUnitClp: prep.rawLine.estimatedUnitClp,
                attributes: mergedAttributes,
                evidenceCasRef: prep.rawLine.evidenceCasRef || undefined,
            });
        }

        if (acceptedLines.length === 0) {
            return res.status(422).json({
                error: 'GLOBAL_HARD_DENY: Ningún ítem de la solicitud superó las políticas de seguridad.',
                deniedItems,
            });
        }

        const requisition = await SupplyRepository.createRequisition(
            {
                tenantId: ctx.tenantId,
                siteId: parsed.data.siteId,
                requesterUid: ctx.actorUid,
                requesterName: ctx.actorName,
                requesterRole: actorOpRole,
                requesterPhoneE164: ctx.phoneE164,
                demandOrigin: parsed.data.demandOrigin,
                demandNature: parsed.data.demandNature,
                costCenter: parsed.data.costCenter,
                linkedAssetId: parsed.data.linkedAssetId,
                linkedPlanRef: parsed.data.linkedPlanRef,
                notes: parsed.data.notes,
                atypicalFlags: Array.from(new Set(acceptedLines.flatMap((l) => l.atypicalFlags))),
                lines: acceptedLines,
            },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );

        if (policyEval.hasAtypicalFlags) {
            await SupplyRepository.recordPolicyAudit({
                tenantId: ctx.tenantId,
                siteId: parsed.data.siteId,
                actorUid: ctx.actorUid,
                eventType: 'ATYPICAL_FLAG',
                policyCode: requisition.atypicalFlags.join('|') || 'ATYPICAL_FLAG',
                severity: 'MEDIUM',
                entityId: requisition.reqId,
                details: {
                    atypicalFlags: requisition.atypicalFlags,
                    requesterRole: actorOpRole,
                },
            }).catch(() => {});
        }

        return res.status(201).json({
            success: true,
            requisition,
            deniedItems,
        });
    } catch (err) {
        console.error('[SUPPLY] Error creando requisición:', err);
        return res.status(500).json({ error: 'Error creando requisición de abastecimiento.' });
    }
});

router.patch('/requisitions/:reqId', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const reqId = String(req.params.reqId || '').trim();
        const parsed = PatchRequisitionBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Actualización HITL requiere confirmationKeyword="ACTUALIZAR".',
                details: parsed.error.flatten(),
            });
        }

        const updated = await SupplyRepository.updateRequisitionStatus(
            ctx.tenantId,
            reqId,
            { status: parsed.data.status, notes: parsed.data.notes },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );
        return res.status(200).json({ success: true, requisition: updated });
    } catch (err: any) {
        if (err instanceof SupplyNotFoundError) {
            return res.status(404).json({ error: err.message });
        }
        console.error('[SUPPLY] Error actualizando requisición:', err);
        return res.status(500).json({ error: 'Error actualizando requisición.' });
    }
});

router.get('/shopping-lists/consolidated', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const consolidated = await SupplyRepository.getConsolidatedShoppingList(ctx.tenantId, siteId);
        return res.status(200).json({ success: true, consolidated });
    } catch (err) {
        console.error('[SUPPLY] Error consolidando lista de compras:', err);
        return res.status(500).json({ error: 'Error generando listas consolidadas de compra.' });
    }
});

// ---------------------------------------------------------------------------
// Receipt Intelligence Pipeline (`/receipts/analyze`)
// ---------------------------------------------------------------------------

const MAX_RECEIPT_BASE64_CHARS = 20 * 1024 * 1024; // 20 MB base64
const MAX_RECEIPT_DECODED_BYTES = 15 * 1024 * 1024; // 15 MB decodificados
const MAX_RECEIPT_XML_CHARS = 2 * 1024 * 1024; // 2 MB XML / TED

const AnalyzeReceiptEvidenceCasRefSchema = z.object({
    sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'sha256 CAS inválido.'),
    storagePath: z.string().trim().min(1).max(512).optional(),
    downloadUrl: z
        .string()
        .trim()
        .min(1)
        .max(1024)
        .refine(
            (val) => !val.toLowerCase().includes('data:') && !val.toLowerCase().includes(';base64,'),
            'Prohibido Base64 inline en evidenceCasRef.downloadUrl'
        )
        .optional(),
    phashHex: z.string().trim().regex(/^[a-f0-9]{16}$/i).optional(),
    mimeType: z.string().trim().min(3).max(120).optional(),
    extension: z.string().trim().min(1).max(16).optional(),
    profile: z.string().trim().max(64).optional(),
    originalBytes: z.number().int().nonnegative().optional(),
    optimizedBytes: z.number().int().nonnegative().optional(),
    savingsRatio: z.number().min(0).max(1).optional(),
    savingsPct: z.number().min(0).max(100).optional(),
    originalFilename: z.string().trim().max(240).optional(),
    createdAt: z.string().trim().max(64).optional(),
    capturedAt: z.string().trim().max(64).optional(),
    deduplicatedHit: z.boolean().optional(),
});

const AnalyzeReceiptBodySchema = z.object({
    siteId: z.string().trim().max(128).optional(),
    purchaseMode: PurchaseModeSchema.optional(),
    locale: z.string().trim().max(16).optional(),
    fileBase64: z.string().max(MAX_RECEIPT_BASE64_CHARS).optional(),
    mimeType: z.string().trim().max(120).optional(),
    originalFilename: z.string().trim().max(240).optional(),
    clientOriginalBytes: z.coerce.number().int().nonnegative().max(100 * 1024 * 1024).optional(),
    xmlDteContent: z.string().max(MAX_RECEIPT_XML_CHARS).optional(),
    xmlContent: z.string().max(MAX_RECEIPT_XML_CHARS).optional(),
    tedRawXml: z.string().max(MAX_RECEIPT_XML_CHARS).optional(),
    contextCaption: z.string().max(2000).optional(),
    defaultDestination: PurchaseLineDestinationSchema.optional(),
    defaultCostCenter: z.string().trim().max(120).optional(),
    evidenceCasRef: z.union([AnalyzeReceiptEvidenceCasRefSchema, z.null()]).optional(),
});

router.post(
    '/receipts/analyze',
    aiRateLimiter,
    (req, res, next) => {
        if (req.is('multipart/form-data')) {
            return upload.single('file')(req, res, (err: any) => {
                if (err) {
                    return res.status(400).json({
                        error: 'Error cargando archivo de comprobante o límite de tamaño excedido.',
                    });
                }
                return next();
            });
        }
        return next();
    },
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const uploadedFile = (req as any).file as Express.Multer.File | undefined;

            const rawBodyInput: Record<string, unknown> = { ...(req.body || {}) };
            if (typeof rawBodyInput.evidenceCasRef === 'string' && rawBodyInput.evidenceCasRef.trim()) {
                try {
                    rawBodyInput.evidenceCasRef = JSON.parse(rawBodyInput.evidenceCasRef);
                } catch {
                    return res.status(400).json({
                        error: 'Referencia evidenceCasRef malformada.',
                    });
                }
            }

            const parsedBody = AnalyzeReceiptBodySchema.safeParse(rawBodyInput);
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload inválido para análisis de comprobante.',
                    details: parsedBody.error.flatten(),
                });
            }

            const body = parsedBody.data;
            let rawBuffer: Buffer | undefined = uploadedFile?.buffer;
            const mimeType: string | undefined = uploadedFile?.mimetype || body.mimeType;
            const originalFilename: string | undefined =
                uploadedFile?.originalname || body.originalFilename;

            if (rawBuffer && rawBuffer.length > MAX_RECEIPT_DECODED_BYTES) {
                return res.status(400).json({
                    error: 'Archivo de comprobante excede el máximo de 15 MB permitidos.',
                });
            }

            if (!rawBuffer && body.fileBase64 && body.fileBase64.trim().length > 0) {
                const stripped = body.fileBase64.replace(/^data:[^;]+;base64,/, '').trim();
                const decodedBuf = Buffer.from(stripped, 'base64');
                if (decodedBuf.length > MAX_RECEIPT_DECODED_BYTES) {
                    return res.status(400).json({
                        error: 'Archivo base64 decodificado excede el máximo de 15 MB permitidos.',
                    });
                }
                if (decodedBuf.length > 0) {
                    rawBuffer = decodedBuf;
                }
            }

            const xmlContent =
                body.xmlDteContent && body.xmlDteContent.trim()
                    ? body.xmlDteContent
                    : body.xmlContent && body.xmlContent.trim()
                      ? body.xmlContent
                      : undefined;
            const tedRawXml = body.tedRawXml && body.tedRawXml.trim() ? body.tedRawXml : undefined;

            let existingEvidenceCasRef:
                | z.infer<typeof EvidenceCasRefSchema>
                | undefined;

            if (body.evidenceCasRef) {
                // Fail-closed anti-IDOR: jamás confiar en storagePath del cliente
                if (
                    body.evidenceCasRef.storagePath &&
                    !CasStorageService.isTenantPrivateStoragePath(
                        body.evidenceCasRef.storagePath,
                        ctx.tenantId
                    )
                ) {
                    return res.status(403).json({
                        error: 'Acceso denegado a referencia CAS de otra cuenta.',
                        code: 'CAS_TENANT_ACCESS_DENIED',
                    });
                }

                const cleanSha = body.evidenceCasRef.sha256.toLowerCase();
                const registryEntry = await CasStorageService.resolveRegistryEntryBySha256(cleanSha, {
                    scope: 'TENANT_PRIVATE',
                    tenantId: ctx.tenantId,
                });

                if (
                    !registryEntry ||
                    !registryEntry.storagePath ||
                    !CasStorageService.isTenantPrivateStoragePath(registryEntry.storagePath, ctx.tenantId)
                ) {
                    return res.status(403).json({
                        error: 'Acceso denegado: referencia CAS no registrada para la cuenta activa.',
                        code: 'CAS_TENANT_ACCESS_DENIED',
                    });
                }

                existingEvidenceCasRef = {
                    sha256: registryEntry.sha256,
                    phashHex: registryEntry.phashHex,
                    storagePath: registryEntry.storagePath,
                    downloadUrl: registryEntry.downloadUrl,
                    mimeType: registryEntry.mimeType,
                    extension: registryEntry.extension,
                    profile: registryEntry.profile,
                    originalBytes: registryEntry.originalBytes,
                    optimizedBytes: registryEntry.optimizedBytes,
                    savingsRatio: registryEntry.savingsRatio,
                    savingsPct:
                        typeof registryEntry.savingsPct === 'number'
                            ? registryEntry.savingsPct
                            : Number((registryEntry.savingsRatio * 100).toFixed(1)),
                    originalFilename: registryEntry.originalFilename,
                    createdAt: registryEntry.createdAt,
                };
            }

            if (!rawBuffer && !xmlContent && !tedRawXml && !existingEvidenceCasRef) {
                return res.status(400).json({
                    error: 'Debe adjuntar un archivo (imagen/PDF/XML), evidenceCasRef pre-digerido, xmlDteContent o tedRawXml.',
                });
            }

            const analysis = await ReceiptIntelligencePipeline.analyze({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorUid,
                rawBuffer,
                mimeType,
                originalFilename,
                clientOriginalBytes: body.clientOriginalBytes,
                existingEvidenceCasRef,
                xmlContent,
                tedRawXml,
                contextCaption: body.contextCaption,
                defaultDestination: body.defaultDestination || 'STOCK_IN_TRANSIT',
                defaultCostCenter: body.defaultCostCenter || ctx.supplyProfile.defaultCostCenter,
                checkDuplicateDedupeKey: (dedupeKey) =>
                    SupplyRepository.existsSiiDocument(ctx.tenantId, dedupeKey),
            });

            return res.status(200).json({
                success: true,
                analysis,
            });
        } catch (err: any) {
            if (err instanceof ReceiptCasAccessDeniedError) {
                return res.status(403).json({
                    error: 'Acceso denegado a referencia CAS fuera del ámbito de la cuenta activa.',
                    code: err.code,
                });
            }
            console.error(
                '[SUPPLY] Error en ReceiptIntelligencePipeline:',
                err instanceof Error ? err.name : 'UnknownError'
            );
            return res.status(500).json({
                error: 'Error interno analizando comprobante de compra.',
            });
        }
    }
);

// ---------------------------------------------------------------------------
// Purchases (`/purchases` & `/purchases/:id/confirm-reception`)
// ---------------------------------------------------------------------------

router.get('/purchases', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const purchases = await SupplyRepository.listPurchases(ctx.tenantId, siteId);
        return res.status(200).json({ success: true, count: purchases.length, purchases });
    } catch (err) {
        console.error('[SUPPLY] Error listando compras:', err);
        return res.status(500).json({ error: 'Error consultando compras registradas.' });
    }
});

router.post('/purchases', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const parsed = CreatePurchaseBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Registro de compra exige confirmationKeyword="ACTUALIZAR" y payload válido.',
                details: parsed.error.flatten(),
            });
        }

        const data = parsed.data;

        // Validar autoridad explícita vía `SupplyPolicyAndAnomalyEngine.evaluateDirectPurchaseAuthority` + RBAC
        const buyerOpRole = asOperationalRole(ctx.supplyProfile.role);
        const roleDefaults = DEFAULT_ROLE_PROFILES[buyerOpRole];
        const directAuth = evaluateDirectPurchaseAuthority({
            role: buyerOpRole,
            memberProfile: {
                ...roleDefaults,
                canRecordDirectPurchase: Boolean(
                    ctx.isSystemPrivileged || ctx.supplyProfile.canRecordDirectPurchase === true
                ),
                autoApproveDirectPurchase: Boolean(
                    ctx.isSystemPrivileged || ctx.supplyProfile.autoApproveDirectPurchase === true
                ),
                allowCapex: Boolean(canAuthorizeCapex(ctx)),
            },
            totalAmountClp: data.totalAmountClp,
            includesCapexAsset: false,
        });

        const canDirect =
            ctx.isSystemPrivileged ||
            (ctx.supplyProfile.canRecordDirectPurchase === true && directAuth.authorized);

        if (data.purchaseMode === 'DIRECT_AUTONOMOUS' && !canDirect) {
            return res.status(403).json({
                error:
                    directAuth.denialReasonSpanish ||
                    'DIRECT_PURCHASE_FORBIDDEN: Su perfil no está autorizado para registrar compras autónomas directas.',
                code: 'DIRECT_PURCHASE_FORBIDDEN',
            });
        }

        const authorizedByAuthority =
            ctx.isSystemPrivileged ||
            ctx.b2bRole === 'OWNER' ||
            ctx.supplyProfile.role === 'OWNER_EXEC' ||
            ctx.supplyProfile.autoApproveDirectPurchase;

        const topLevelAllocsByLine = new Map<
            string,
            Array<{ reqId: string; reqLineId: string; qtyAllocated: number }>
        >();
        for (const alloc of data.allocations || []) {
            if (
                alloc.allocationKind !== 'UNSOLICITED_PURCHASE' &&
                alloc.requisitionId &&
                alloc.requisitionLineId
            ) {
                const list = topLevelAllocsByLine.get(alloc.purchaseLineId) || [];
                list.push({
                    reqId: alloc.requisitionId,
                    reqLineId: alloc.requisitionLineId,
                    qtyAllocated: alloc.qtyAllocated,
                });
                topLevelAllocsByLine.set(alloc.purchaseLineId, list);
            }
        }

        const normalizedLines: SupplyPurchaseLine[] = data.lines.map((l) => {
            const desc = (l.normalizedName || l.description || l.rawDescription || 'Ítem Compra').trim();
            const norm = normalizeSupplyItemFromText(desc, l.qtyPurchased, l.unitSi);
            const hasExplicitNetOnly =
                l.linePricingBasis === 'NET' ||
                (l.lineTotalClp === undefined && l.lineNetClp !== undefined && l.lineVatClp === undefined);
            const linePricingBasis = l.linePricingBasis ?? (hasExplicitNetOnly ? 'NET' : 'GROSS');
            const subtotalClp = Math.round(
                l.lineTotalClp ??
                    l.subtotalClp ??
                    (linePricingBasis === 'NET'
                        ? (l.lineNetClp ??
                          l.qtyPurchased * (l.unitPriceNetClp ?? l.unitPriceClp ?? 0))
                        : ((l.lineNetClp ?? 0) + (l.lineVatClp ?? 0) ||
                          l.qtyPurchased * (l.unitPriceGrossClp ?? l.unitPriceClp ?? l.unitPriceNetClp ?? 0)))
            );
            const unitPriceClp = Math.round(
                linePricingBasis === 'NET'
                    ? (l.unitPriceNetClp ??
                      l.unitPriceClp ??
                      (l.qtyPurchased > 0 ? subtotalClp / l.qtyPurchased : 0))
                    : (l.unitPriceGrossClp ??
                      l.unitPriceClp ??
                      l.unitPriceNetClp ??
                      (l.qtyPurchased > 0 ? subtotalClp / l.qtyPurchased : 0))
            );
            const mergedExplicit = [
                ...(l.explicitAllocations || []),
                ...(topLevelAllocsByLine.get(l.purchaseLineId) || []),
            ];
            const effectiveCategory = l.categoryCode || norm.categoryCode;

            return {
                purchaseLineId: l.purchaseLineId,
                canonicalSkuId: l.canonicalSkuId || norm.canonicalSkuId,
                description: desc,
                categoryCode: effectiveCategory,
                procurementBucket: l.procurementBucket || norm.procurementBucket,
                unitSi: l.unitSi || norm.unitSi,
                qtyPurchased: l.qtyPurchased,
                unitPriceClp,
                subtotalClp,
                linePricingBasis,
                destination: l.destination,
                costCenter: normalizeLegacyCostCenter(
                    l.costCenter || 'CC-CAMP-ALIMENTACION',
                    effectiveCategory
                ),
                isCapexAsset: Boolean(l.isCapexAsset || l.destination === 'CAPEX_ASSET' || norm.isCapexAsset),
                serialOrTag: l.serialOrTag,
                explicitAllocations: mergedExplicit.length > 0 ? mergedExplicit : undefined,
            };
        });

        // Compuerta RBAC CAPEX: exige allowCapex===true + rol OWNER_EXEC / SITE_ADMIN / isSystemPrivileged
        const hasCapexPurchaseLine = normalizedLines.some(
            (l) => l.isCapexAsset || l.destination === 'CAPEX_ASSET'
        );
        if (hasCapexPurchaseLine && !canAuthorizeCapex(ctx)) {
            return res.status(403).json({
                error: 'CAPEX_NOT_AUTHORIZED: Su perfil no está autorizado para compras o altas de activos CAPEX.',
                code: 'CAPEX_NOT_AUTHORIZED',
            });
        }

        const result = await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: ctx.tenantId,
                siteId: data.siteId,
                buyerUid: ctx.actorUid,
                buyerRole: asOperationalRole(ctx.supplyProfile.role),
                purchaseMode: data.purchaseMode,
                authorizedByAuthority,
                supplierTaxId: data.supplierTaxId,
                supplierName: data.supplierName,
                documentType: data.documentType,
                folio: data.folio,
                issueDate: data.issueDate,
                netAmountClp: data.netAmountClp,
                vatAmountClp: data.vatAmountClp,
                totalAmountClp: data.totalAmountClp,
                paymentMethod: data.paymentMethod,
                evidenceCasRef: data.evidenceCasRef || undefined,
                tedRawXml: data.tedRawXml || undefined,
                expectedReceiverTaxId: data.expectedReceiverTaxId,
                countryCode: data.countryCode,
                lines: normalizedLines,
            },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );

        return res.status(201).json({
            success: true,
            ...result,
        });
    } catch (err: any) {
        if (err instanceof SupplyValidationError) {
            return res.status(400).json({
                error: err.message,
                code: err.code,
            });
        }
        if (err instanceof SupplyDuplicateSiiDocumentError) {
            return res.status(409).json({
                error: err.message,
                code: err.code,
                dedupeKey: err.dedupeKey,
            });
        }
        console.error('[SUPPLY] Error registrando compra:', err);
        return res.status(500).json({ error: 'Error registrando compra y conciliación.' });
    }
});

router.post(
    '/purchases/:id/confirm-reception',
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const purchaseId = String(req.params.id || '').trim();
            const parsed = ConfirmReceptionBodySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Confirmación de recepción exige confirmationKeyword="ACTUALIZAR".',
                    details: parsed.error.flatten(),
                });
            }

            const normalizedReceivedLines = parsed.data.receivedLines?.map((l) => ({
                purchaseLineId: l.purchaseLineId,
                qtyReceived: Number(l.qtyReceivedNow ?? l.qtyReceived ?? 0),
            }));

            const result = await SupplyRepository.confirmPurchaseReception(
                {
                    tenantId: ctx.tenantId,
                    purchaseId,
                    receivedLines: normalizedReceivedLines,
                    notes: parsed.data.notes,
                },
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );

            // Retroalimentación automática por WhatsApp a solicitantes en terreno (resolviendo teléfono real activo desde perfil, nunca el enmascarado)
            for (const reqItem of result.affectedRequisitions) {
                const activePhone = await SupplyRepository.resolveActiveMemberPhoneE164(
                    ctx.tenantId,
                    reqItem.requesterUid
                );
                const fallbackUnmasked =
                    reqItem.requesterPhoneE164 &&
                    !reqItem.requesterPhoneE164.includes('*') &&
                    /^\+[1-9]\d{6,14}$/.test(reqItem.requesterPhoneE164.trim())
                        ? reqItem.requesterPhoneE164.trim()
                        : null;
                const targetPhone = activePhone || fallbackUnmasked;
                if (targetPhone) {
                    const summaryLines = reqItem.lines.map(
                        (l) => `${l.itemName}: ${l.qtyReceived}/${l.qtyRequested} ${l.unitSi} recibido`
                    );
                    await EmailAndWhatsAppNotifier.sendFieldStatusUpdate({
                        toE164: targetPhone,
                        requisitionId: reqItem.reqId,
                        statusLabel: 'RECEPCIÓN EN BODEGA CONFIRMADA',
                        summaryLines,
                    }).catch(() => {});
                }
            }

            return res.status(200).json({
                success: true,
                purchase: result.purchase,
                receptionOutcome: result.receptionOutcome,
                receivedItemCount: result.receivedItemCount,
                affectedRequisitionIds: result.affectedRequisitions.map((r) => r.reqId),
            });
        } catch (err: any) {
            if (err instanceof SupplyValidationError) {
                return res.status(400).json({ error: err.message, code: err.code });
            }
            if (err instanceof SupplyNotFoundError) {
                return res.status(404).json({ error: err.message });
            }
            if (err instanceof SupplyConflictError) {
                return res.status(409).json({ error: err.message, code: err.code });
            }
            console.error('[SUPPLY] Error confirmando recepción:', err);
            return res.status(500).json({ error: 'Error confirmando recepción de compra.' });
        }
    }
);

// ---------------------------------------------------------------------------
// Assets (`/assets` & `/assets/:id/link-opermaq`)
// ---------------------------------------------------------------------------

router.get('/assets', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const assets = await SupplyRepository.listAssets(ctx.tenantId, siteId);
        return res.status(200).json({
            success: true,
            count: assets.length,
            missingInvoiceCount: assets.filter((a) => a.missingInvoiceAlert).length,
            assets,
        });
    } catch (err) {
        console.error('[SUPPLY] Error listando activos patrimoniales:', err);
        return res.status(500).json({ error: 'Error consultando bóveda de activos CAPEX.' });
    }
});

router.post(
    '/assets/:id/link-opermaq',
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canAuthorizeCapex(ctx)) {
                return res.status(403).json({
                    error: 'CAPEX_NOT_AUTHORIZED: Su perfil no está autorizado para vincular activos CAPEX con OPERMAQ.',
                    code: 'CAPEX_NOT_AUTHORIZED',
                });
            }
            const assetId = String(req.params.id || '').trim();
            const parsed = LinkOpermaqBodySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Enlace a OPERMAQ exige confirmationKeyword="ACTUALIZAR" y opermaqAssetId válido.',
                    details: parsed.error.flatten(),
                });
            }

            const resolvedOpermaqAssetId =
                parsed.data.opermaqAssetId?.trim() ||
                `opermaq_unit_${assetId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

            const asset = await SupplyRepository.linkAssetToOpermaq(
                ctx.tenantId,
                assetId,
                resolvedOpermaqAssetId,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({
                success: true,
                createdFleetUnitRef: Boolean(parsed.data.createOpermaqFleetUnit && !parsed.data.opermaqAssetId),
                asset,
            });
        } catch (err: any) {
            if (err instanceof SupplyNotFoundError) {
                return res.status(404).json({ error: err.message });
            }
            console.error('[SUPPLY] Error vinculando activo con OPERMAQ:', err);
            return res.status(500).json({ error: 'Error vinculando activo con OPERMAQ.' });
        }
    }
);

// ---------------------------------------------------------------------------
// Inventory (`/inventory`) & Cash Ledger (`/cash-ledger`) & Forecast (`/forecast`)
// ---------------------------------------------------------------------------

router.get('/inventory', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const items = await SupplyRepository.listInventory(ctx.tenantId, siteId);
        return res.status(200).json({
            success: true,
            count: items.length,
            totalInTransitSkus: items.filter((i) => i.qtyInTransit > 0).length,
            totalInWarehouseSkus: items.filter((i) => i.qtyInWarehouse > 0).length,
            items,
        });
    } catch (err) {
        console.error('[SUPPLY] Error consultando inventario:', err);
        return res.status(500).json({ error: 'Error consultando inventario de abastecimiento.' });
    }
});

router.get('/cash-ledger', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const entries = await SupplyRepository.listCashLedger(ctx.tenantId, siteId);

        const opexTotalClp = entries
            .filter((e) => !e.isCapex && (e.direction === 'EXPENSE_RENDERED' || e.direction === 'REIMBURSEMENT_DUE'))
            .reduce((acc, e) => acc + e.netAmountClp, 0);
        const capexTotalClp = entries
            .filter((e) => e.isCapex && (e.direction === 'EXPENSE_RENDERED' || e.direction === 'REIMBURSEMENT_DUE'))
            .reduce((acc, e) => acc + e.netAmountClp, 0);
        const vatCreditTotalClp = entries.reduce((acc, e) => acc + e.vatCreditClp, 0);

        return res.status(200).json({
            success: true,
            count: entries.length,
            summary: {
                opexTotalClp,
                capexTotalClp,
                vatCreditTotalClp,
            },
            entries,
        });
    } catch (err) {
        console.error('[SUPPLY] Error consultando cash-ledger:', err);
        return res.status(500).json({ error: 'Error consultando libro de caja y rendiciones.' });
    }
});

router.post('/cash-ledger', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const parsed = CreateCashLedgerBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Registro en cash-ledger exige confirmationKeyword="ACTUALIZAR".',
                details: parsed.error.flatten(),
            });
        }
        const d = parsed.data;
        const entry = await SupplyRepository.recordCashLedgerEntry(
            {
                tenantId: ctx.tenantId,
                siteId: d.siteId,
                paymentMethod: d.paymentMethod,
                direction: d.direction,
                amountClp: Math.round(d.amountClp),
                netAmountClp: Math.round(d.netAmountClp ?? d.amountClp),
                vatCreditClp: Math.round(d.vatCreditClp ?? 0),
                isCapex: d.isCapex,
                costCenter: d.costCenter,
                referenceId: d.referenceId,
                actorUid: ctx.actorUid,
                description: d.description,
            },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );
        return res.status(201).json({ success: true, entry });
    } catch (err) {
        console.error('[SUPPLY] Error registrando cash-ledger:', err);
        return res.status(500).json({ error: 'Error registrando movimiento de caja.' });
    }
});

router.get('/forecast', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const forecasts = await SupplyRepository.computeForecastReadOnly(ctx.tenantId, siteId);
        return res.status(200).json({ success: true, forecasts });
    } catch (err) {
        console.error('[SUPPLY] Error calculando forecast (solo lectura):', err);
        return res.status(500).json({ error: 'Error calculando pronóstico de demanda y autonomía.' });
    }
});

router.post(
    '/forecast/recalculate',
    mutationRateLimiter,
    requireSupplyMutationAllowed,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const parsed = RecalculateForecastBodySchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Parámetros inválidos para recálculo de pronóstico.',
                    details: parsed.error.flatten(),
                });
            }
            const siteId =
                parsed.data.siteId ||
                (typeof req.query.siteId === 'string' ? req.query.siteId : undefined);
            const forecasts = await SupplyRepository.computeAndStoreForecast(ctx.tenantId, siteId);
            return res.status(200).json({ success: true, persisted: true, forecasts });
        } catch (err) {
            console.error('[SUPPLY] Error recalculando y persistiendo forecast:', err);
            return res.status(500).json({ error: 'Error recalculando pronóstico de demanda y autonomía.' });
        }
    }
);

// ---------------------------------------------------------------------------
// SII Rendiciones (`/sii/documents`, `/sii/expense-reports`, `/sii/export`)
// ---------------------------------------------------------------------------

router.get('/sii/documents', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const rawDocType =
            typeof req.query.documentType === 'string'
                ? req.query.documentType
                : typeof req.query.dteType === 'string'
                  ? req.query.dteType
                  : undefined;
        const documentType =
            rawDocType && /^\d+$/.test(rawDocType) ? Number(rawDocType) : undefined;
        const missingInvoiceOnly = req.query.missingInvoiceOnly === 'true';
        const expiringSoonOnly = req.query.expiringSoon === 'true';

        let documents = await SupplyRepository.listSiiDocuments(ctx.tenantId, {
            siteId,
            documentType,
            missingInvoiceOnly,
        });

        if (expiringSoonOnly) {
            documents = documents.filter(
                (d) =>
                    d.rcvStatus === 'PENDING_ACCEPTANCE' &&
                    typeof d.rcvDaysRemaining === 'number' &&
                    d.rcvDaysRemaining <= 3
            );
        }

        const vatCreditTotalClp = documents.reduce((acc, d) => acc + d.vatCreditRecoverableClp, 0);
        return res.status(200).json({
            success: true,
            count: documents.length,
            vatCreditTotalClp,
            documents,
        });
    } catch (err) {
        console.error('[SUPPLY] Error consultando documentos SII:', err);
        return res.status(500).json({ error: 'Error consultando documentos tributarios SII.' });
    }
});

router.get('/sii/expense-reports', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const reports = await SupplyRepository.listExpenseReports(ctx.tenantId, siteId);
        return res.status(200).json({ success: true, count: reports.length, reports });
    } catch (err) {
        console.error('[SUPPLY] Error listando rendiciones SII:', err);
        return res.status(500).json({ error: 'Error listando sobres de rendición SII.' });
    }
});

router.post('/sii/expense-reports', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const parsed = CreateExpenseReportBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Creación de rendición SII exige confirmationKeyword="ACTUALIZAR".',
                details: parsed.error.flatten(),
            });
        }
        const report = await SupplyRepository.createExpenseReport(
            {
                tenantId: ctx.tenantId,
                siteId: parsed.data.siteId,
                custodianUid: ctx.actorUid,
                custodianName: ctx.actorName,
                paymentMethod: parsed.data.paymentMethod,
                title: parsed.data.title,
                periodLabel: parsed.data.periodLabel,
                costCenter: parsed.data.costCenter,
                fundAdvanceClp: parsed.data.fundAdvanceClp,
                siiDocumentIds: parsed.data.siiDocumentIds,
            },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );
        return res.status(201).json({ success: true, report });
    } catch (err: any) {
        if (err instanceof SupplyConflictError) {
            return res.status(409).json({ error: err.message, code: err.code });
        }
        if (err instanceof SupplyNotFoundError) {
            return res.status(404).json({ error: err.message });
        }
        if (err instanceof SupplyForbiddenError) {
            return res.status(403).json({ error: err.message, code: err.code });
        }
        console.error('[SUPPLY] Error creando rendición SII:', err);
        return res.status(500).json({ error: 'Error creando sobre de rendición SII.' });
    }
});

const EXPENSE_REPORT_APPROVAL_OR_PAYMENT_STATUSES = new Set([
    'APPROVED',
    'PAID',
    'REIMBURSED',
    'SETTLED',
]);

router.patch(
    '/sii/expense-reports/:reportId',
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const reportId = String(req.params.reportId || '').trim();
            const parsed = PatchExpenseReportBodySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Actualización de rendición SII exige confirmationKeyword="ACTUALIZAR".',
                    details: parsed.error.flatten(),
                });
            }

            const requestedStatus = parsed.data.status;
            if (EXPENSE_REPORT_APPROVAL_OR_PAYMENT_STATUSES.has(requestedStatus)) {
                const isAuthorizedApprover =
                    ctx.isSystemPrivileged ||
                    ctx.supplyProfile.role === 'OWNER_EXEC' ||
                    ctx.supplyProfile.role === 'SITE_ADMIN';
                if (!isAuthorizedApprover) {
                    return res.status(403).json({
                        error: 'APPROVER_ROLE_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o plataforma puede aprobar o pagar rendiciones SII.',
                        code: 'APPROVER_ROLE_REQUIRED',
                    });
                }

                const existingReport = await SupplyRepository.getExpenseReport(ctx.tenantId, reportId);
                if (!existingReport) {
                    return res.status(404).json({ error: 'Rendición SII no encontrada.' });
                }
                if (existingReport.custodianUid === ctx.actorUid) {
                    return res.status(403).json({
                        error: 'SELF_APPROVAL_FORBIDDEN: Segregación de funciones ISO 27001 prohíbe auto-aprobar o pagar su propia rendición SII.',
                        code: 'SELF_APPROVAL_FORBIDDEN',
                    });
                }
            }

            const persistedStatus = requestedStatus === 'PAID' ? 'REIMBURSED' : requestedStatus;
            const report = await SupplyRepository.updateExpenseReportStatus(
                ctx.tenantId,
                reportId,
                persistedStatus,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({ success: true, report });
        } catch (err: any) {
            if (err instanceof SupplyNotFoundError) {
                return res.status(404).json({ error: err.message });
            }
            console.error('[SUPPLY] Error actualizando rendición SII:', err);
            return res.status(500).json({ error: 'Error actualizando rendición SII.' });
        }
    }
);

const CreateErpWebhookBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    name: z.string().trim().min(2).max(120),
    targetUrl: z.string().trim().url().max(512),
    events: z.array(ErpWebhookEventSchema).min(1).max(10),
    secret: z.string().trim().min(16).max(256).optional(),
    active: z.boolean().optional().default(true),
});

const DeleteErpWebhookBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
});

function canManageErpWebhooks(ctx: SupplySessionContext): boolean {
    if (ctx.isSystemPrivileged) return true;
    if (!ctx.canMutate || isReadOnlyB2bRole(ctx.b2bRole)) return false;
    return ctx.supplyProfile.role === 'OWNER_EXEC' || ctx.supplyProfile.role === 'SITE_ADMIN';
}

async function buildAndSendAccountingExport(
    req: SupplyRequest,
    res: Response,
    options: { legacySiiDefault?: boolean }
): Promise<any> {
    const ctx = req.supplyContext!;
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
    const rawFormat = typeof req.query.format === 'string' ? req.query.format.trim().toUpperCase() : '';
    const rawProfile =
        typeof req.query.profile === 'string' ? req.query.profile.trim().toUpperCase() : '';
    const rawCurrency =
        typeof req.query.currencyCode === 'string'
            ? req.query.currencyCode.trim().toUpperCase()
            : 'CLP';

    // Retrocompatibilidad estricta de `/sii/export` cuando no se solicita formato/perfil nuevo
    if (options.legacySiiDefault && !rawFormat && !rawProfile) {
        const docs = await SupplyRepository.listSiiDocuments(ctx.tenantId, { siteId });
        const csv = exportSiiDocumentsToCsv(docs);
        const dateTag = new Date().toISOString().slice(0, 10);
        const sha256 = crypto.createHash('sha256').update(csv, 'utf8').digest('hex');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="minreport-sii-rcv-${dateTag}.csv"`);
        res.setHeader('X-Minreport-Export-Sha256', sha256);
        return res.status(200).send(csv);
    }

    const parsedFormat = AccountingExportFormatSchema.safeParse(rawFormat || 'CSV_RFC4180');
    if (!parsedFormat.success) {
        return res.status(400).json({
            error: 'INVALID_ACCOUNTING_EXPORT_FORMAT',
            details: parsedFormat.error.flatten(),
        });
    }

    const parsedProfile = AccountingExportProfileSchema.safeParse(rawProfile || 'CL_SII_RCV');
    if (!parsedProfile.success) {
        return res.status(400).json({
            error: 'INVALID_ACCOUNTING_EXPORT_PROFILE',
            details: parsedProfile.error.flatten(),
        });
    }

    const currencyCode = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'CLP';

    const [accountSnap, docs, purchases, expenseReports, catalogList] = await Promise.all([
        db.collection('accounts').doc(ctx.tenantId).get().catch(() => null),
        SupplyRepository.listSiiDocuments(ctx.tenantId, { siteId }),
        SupplyRepository.listPurchases(ctx.tenantId, siteId),
        SupplyRepository.listExpenseReports(ctx.tenantId, siteId),
        SupplyRepository.listCatalog({ tenantId: ctx.tenantId }).catch(() => []),
    ]);

    const accountData = accountSnap?.exists ? (accountSnap.data() as Record<string, any>) : null;
    const catalogBySkuId: Record<string, (typeof catalogList)[number]> = {};
    for (const sku of catalogList) {
        catalogBySkuId[sku.canonicalSkuId] = sku;
    }

    const exported = InternationalAccountingExporter.exportAccountingPackage({
        tenantId: ctx.tenantId,
        tenantName:
            typeof accountData?.name === 'string' && accountData.name.trim()
                ? accountData.name.trim()
                : ctx.tenantId,
        tenantTaxId:
            typeof accountData?.taxId === 'string' && accountData.taxId.trim()
                ? accountData.taxId.trim()
                : typeof accountData?.rut === 'string' && accountData.rut.trim()
                  ? accountData.rut.trim()
                  : undefined,
        tenantCountryCode:
            typeof accountData?.countryCode === 'string' && accountData.countryCode.trim()
                ? accountData.countryCode.trim()
                : 'CL',
        currencyCode,
        siteId,
        format: parsedFormat.data,
        profile: parsedProfile.data,
        documents: docs,
        purchases,
        expenseReports,
        catalogBySkuId,
    });

    res.setHeader('Content-Type', exported.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('X-Minreport-Export-Sha256', exported.sha256);
    res.setHeader('X-Minreport-Export-Format', exported.format);
    res.setHeader('X-Minreport-Export-Profile', exported.profile);
    res.setHeader('X-Minreport-Schema-Version', exported.schemaVersion);
    return res.status(200).send(exported.content);
}

router.get('/exports/accounting', async (req: SupplyRequest, res: Response) => {
    try {
        return await buildAndSendAccountingExport(req, res, { legacySiiDefault: false });
    } catch (err) {
        console.error('[SUPPLY] Error generando exportación contable internacional:', err);
        return res.status(500).json({ error: 'Error generando exportación contable internacional.' });
    }
});

router.get('/sii/export', async (req: SupplyRequest, res: Response) => {
    try {
        return await buildAndSendAccountingExport(req, res, { legacySiiDefault: true });
    } catch (err) {
        console.error('[SUPPLY] Error exportando CSV SII:', err);
        return res.status(500).json({ error: 'Error generando exportación contable SII.' });
    }
});

// ---------------------------------------------------------------------------
// Signed ERP Outbound Webhooks (`/erp-webhooks` — OWNER_EXEC / SITE_ADMIN)
// ---------------------------------------------------------------------------

router.get('/erp-webhooks', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        if (!canManageErpWebhooks(ctx)) {
            return res.status(403).json({
                error: 'ERP_WEBHOOK_ADMIN_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o plataforma puede consultar webhooks ERP.',
                code: 'ERP_WEBHOOK_ADMIN_REQUIRED',
            });
        }
        const webhooks = await SignedErpWebhookDispatcher.listWebhooks(ctx.tenantId);
        return res.status(200).json({
            success: true,
            count: webhooks.length,
            webhooks,
        });
    } catch (err) {
        console.error('[SUPPLY] Error listando webhooks ERP:', err);
        return res.status(500).json({ error: 'Error consultando webhooks ERP.' });
    }
});

router.post('/erp-webhooks', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        if (!canManageErpWebhooks(ctx)) {
            return res.status(403).json({
                error: 'ERP_WEBHOOK_ADMIN_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o plataforma puede registrar webhooks ERP.',
                code: 'ERP_WEBHOOK_ADMIN_REQUIRED',
            });
        }
        const parsed = CreateErpWebhookBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Registro de webhook ERP exige confirmationKeyword="ACTUALIZAR", targetUrl HTTPS y eventos válidos.',
                details: parsed.error.flatten(),
            });
        }

        const created = await SignedErpWebhookDispatcher.createWebhook(
            {
                tenantId: ctx.tenantId,
                name: parsed.data.name,
                targetUrl: parsed.data.targetUrl,
                events: parsed.data.events,
                secret: parsed.data.secret,
                active: parsed.data.active,
            },
            {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            }
        );

        return res.status(201).json({
            success: true,
            webhook: created.webhook,
            signingSecretOnce: created.signingSecretOnce,
        });
    } catch (err: any) {
        if (err instanceof SSRFBlockedError) {
            return res.status(403).json({
                error: err.message,
                code: err.code,
            });
        }
        console.error('[SUPPLY] Error registrando webhook ERP:', err);
        return res.status(500).json({ error: 'Error registrando webhook ERP.' });
    }
});

router.delete(
    '/erp-webhooks/:webhookId',
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canManageErpWebhooks(ctx)) {
                return res.status(403).json({
                    error: 'ERP_WEBHOOK_ADMIN_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o plataforma puede eliminar webhooks ERP.',
                    code: 'ERP_WEBHOOK_ADMIN_REQUIRED',
                });
            }
            const candidateKeyword =
                req.body?.confirmationKeyword ??
                (typeof req.query.confirmationKeyword === 'string'
                    ? req.query.confirmationKeyword
                    : undefined);
            const parsed = DeleteErpWebhookBodySchema.safeParse({
                confirmationKeyword: candidateKeyword,
            });
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Eliminación de webhook ERP exige confirmationKeyword="ACTUALIZAR".',
                    details: parsed.error.flatten(),
                });
            }

            const webhookId = String(req.params.webhookId || '').trim();
            const result = await SignedErpWebhookDispatcher.deleteWebhook(
                ctx.tenantId,
                webhookId,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({ success: true, ...result });
        } catch (err: any) {
            if (err instanceof SupplyNotFoundError) {
                return res.status(404).json({ error: err.message });
            }
            console.error('[SUPPLY] Error eliminando webhook ERP:', err);
            return res.status(500).json({ error: 'Error eliminando webhook ERP.' });
        }
    }
);

router.post(
    '/erp-webhooks/:webhookId/test',
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canManageErpWebhooks(ctx)) {
                return res.status(403).json({
                    error: 'ERP_WEBHOOK_ADMIN_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o plataforma puede probar webhooks ERP.',
                    code: 'ERP_WEBHOOK_ADMIN_REQUIRED',
                });
            }
            const webhookId = String(req.params.webhookId || '').trim();
            const delivery = await SignedErpWebhookDispatcher.sendTestWebhook(
                ctx.tenantId,
                webhookId,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({
                success: delivery.status === 'DELIVERED',
                delivery,
            });
        } catch (err: any) {
            if (err instanceof SupplyNotFoundError) {
                return res.status(404).json({ error: err.message });
            }
            if (err instanceof SSRFBlockedError) {
                return res.status(403).json({ error: err.message, code: err.code });
            }
            console.error('[SUPPLY] Error probando webhook ERP:', err);
            return res.status(500).json({ error: 'Error enviando evento de prueba ERP.' });
        }
    }
);

// ---------------------------------------------------------------------------
// Zero-Friction Supplier RFQ Invites (`/rfq-express/invites` — OWNER_EXEC / SITE_ADMIN / BUYER)
// ---------------------------------------------------------------------------

function canManageExpressRfqInvites(ctx: SupplySessionContext): boolean {
    if (ctx.isSystemPrivileged) return true;
    if (!ctx.canMutate || isReadOnlyB2bRole(ctx.b2bRole)) return false;
    return (
        ctx.supplyProfile.role === 'OWNER_EXEC' ||
        ctx.supplyProfile.role === 'SITE_ADMIN' ||
        ctx.supplyProfile.role === 'BUYER'
    );
}

router.get('/rfq-express/invites', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        if (!canManageExpressRfqInvites(ctx)) {
            return res.status(403).json({
                error: 'RFQ_INVITE_ROLE_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o BUYER puede gestionar invitaciones RFQ.',
                code: 'RFQ_INVITE_ROLE_REQUIRED',
            });
        }
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const rawStatus =
            typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
        const status: ExpressRfqInviteStatus | undefined =
            rawStatus === 'OPEN' ||
            rawStatus === 'SUBMITTED' ||
            rawStatus === 'EXPIRED' ||
            rawStatus === 'REVOKED'
                ? rawStatus
                : undefined;
        const rawLimit =
            typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)
                ? Number(req.query.limit)
                : undefined;

        const invites = await SupplierZeroFrictionRfqService.listExpressRfqInvites(ctx.tenantId, {
            siteId,
            status,
            limit: rawLimit,
        });
        return res.status(200).json({
            success: true,
            count: invites.length,
            invites,
        });
    } catch (err) {
        console.error('[SUPPLY] Error listando invitaciones RFQ exprés:', err);
        return res.status(500).json({ error: 'Error consultando invitaciones RFQ.' });
    }
});

router.post(
    '/rfq-express/invites',
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canManageExpressRfqInvites(ctx)) {
                return res.status(403).json({
                    error: 'RFQ_INVITE_ROLE_REQUIRED: Solo OWNER_EXEC, SITE_ADMIN o BUYER puede crear invitaciones RFQ.',
                    code: 'RFQ_INVITE_ROLE_REQUIRED',
                });
            }
            const parsed = CreateExpressRfqInviteSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Invitación RFQ inválida.',
                    details: parsed.error.flatten(),
                });
            }

            const created = await SupplierZeroFrictionRfqService.createExpressRfqInvite(
                {
                    tenantId: ctx.tenantId,
                    input: parsed.data,
                },
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );

            return res.status(201).json({
                success: true,
                invite: created.invite,
                expressPath: created.expressPath,
                dispatchedChannels: created.dispatchedChannels,
            });
        } catch (err: any) {
            if (err instanceof ExpressRfqError) {
                return res.status(err.statusCode).json({
                    error: err.message,
                    code: err.code,
                });
            }
            console.error('[SUPPLY] Error creando invitación RFQ exprés:', err);
            return res.status(500).json({ error: 'Error creando invitación RFQ.' });
        }
    }
);

// ---------------------------------------------------------------------------
// Anonymous Marketplace Demand Signals (`/marketplace-signals` — k >= 5 B2B)
// ---------------------------------------------------------------------------

router.get('/marketplace-signals', async (req: SupplyRequest, res: Response) => {
    try {
        const districtCode = typeof req.query.districtCode === 'string' ? req.query.districtCode : undefined;
        const categoryCode = typeof req.query.categoryCode === 'string' ? req.query.categoryCode : undefined;
        const signals = await SupplyRepository.listAnonymousDemandSignals({ districtCode, categoryCode });
        return res.status(200).json({
            success: true,
            kAnonymityMinimum: LEY21719_MIN_K_ANONYMITY,
            count: signals.length,
            signals,
        });
    } catch (err) {
        console.error('[SUPPLY] Error listando señales Marketplace:', err);
        return res.status(500).json({ error: 'Error consultando señales anónimas de demanda.' });
    }
});

router.post('/marketplace-signals/refresh', mutationRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        if (ctx.accountTier > 2) {
            return res.status(403).json({
                error: 'PRIVILEGED_ROLE_REQUIRED: Solo 1º DEV o 2º ADMIN pueden recalcular señales globales Marketplace.',
            });
        }
        const parsed = RefreshMarketplaceSignalsBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Recálculo global Marketplace exige confirmationKeyword="ACTUALIZAR".',
                details: parsed.error.flatten(),
            });
        }

        const signals = await SupplyRepository.refreshAnonymousDemandSignals();
        await AuditLedger.record({
            tenantId: 'global',
            actorUid: ctx.actorUid,
            actorEmail: ctx.actorEmail,
            action: 'SUPPLY_MARKETPLACE_SIGNALS_REFRESHED',
            module: SUPPLY_AUDIT_MODULE,
            targetEntity: 'market_demand_signals',
            details: {
                hitlConfirmed: true,
                emittedSignalCount: signals.length,
                kAnonymityMinimum: LEY21719_MIN_K_ANONYMITY,
            },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            kAnonymityMinimum: LEY21719_MIN_K_ANONYMITY,
            count: signals.length,
            signals,
        });
    } catch (err) {
        console.error('[SUPPLY] Error recalculando señales Marketplace:', err);
        return res.status(500).json({ error: 'Error recalculando señales anónimas de demanda.' });
    }
});

// ---------------------------------------------------------------------------
// WhatsApp Campamento Simulator (`/whatsapp/simulate` — DEV / ADMIN / TEST-PILOT)
// ---------------------------------------------------------------------------

router.post('/whatsapp/simulate', aiRateLimiter, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const isAllowedSimulator = ctx.accountTier <= 3;
        if (!isAllowedSimulator) {
            return res.status(403).json({
                error: 'SIMULATOR_RESTRICTED: El simulador interactivo WhatsApp solo está habilitado para DEV, ADMIN o TEST-PILOT.',
            });
        }

        const parsed = SimulateWhatsAppBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload de simulación WhatsApp inválido.',
                details: parsed.error.flatten(),
            });
        }

        const d = parsed.data;
        const phoneE164 = normalizeE164Phone(d.phoneE164 || d.fromPhoneE164 || '+56911112222');
        const wamid = d.wamid || `wamid.sim_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

        const simRole: SupplyOperationalRole =
            d.simulateSenderRole || d.simulatedRole || asOperationalRole(ctx.supplyProfile.role);
        const simProfile = SupplyMemberProfileSchema.parse({
            ...ctx.supplyProfile,
            role: simRole,
            canRecordDirectPurchase:
                simRole === 'OWNER_EXEC' || simRole === 'SITE_ADMIN' || simRole === 'BUYER',
            autoApproveDirectPurchase: simRole === 'OWNER_EXEC',
            allowCapex: simRole === 'OWNER_EXEC' || simRole === 'SITE_ADMIN',
        });

        let siteId = d.siteId || '';
        if (!siteId) {
            const sites = await SupplyRepository.listSites(ctx.tenantId);
            siteId = sites[0]?.siteId || 'default-site';
        }

        const overrideMember: ResolvedWhatsAppMember = {
            tenantId: ctx.tenantId,
            siteId,
            uid: ctx.actorUid,
            displayName: ctx.actorName,
            email: ctx.actorEmail,
            phoneE164,
            whatsappOptInAt: new Date().toISOString(),
            b2bRole: ctx.b2bRole,
            supplyProfile: simProfile,
        };

        const resolvedText = d.text ?? d.textBody;
        const inbound: InboundWhatsAppMessage = {
            wamid,
            fromE164: phoneE164,
            timestampMs: Date.now(),
            type: d.type,
            textBody: resolvedText,
            interactiveReplyId: d.interactiveReplyId,
            caption: d.caption,
            filename: d.filename,
            mimeType: d.mimeType,
        };

        const inlineMediaBuffer = d.mediaBase64
            ? Buffer.from(d.mediaBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
            : undefined;

        const outcome = await CampChannel.handleInboundMessage(inbound, {
            flushImmediately: d.flushImmediately,
            debounceWindowMs: d.debounceWindowMs,
            inlineMediaBuffer,
            inlineMediaMimeType: d.mimeType,
            inlineXmlContent: d.xmlDteContent || d.xmlContent,
            inlineTedRawXml: d.tedRawXml,
            overrideMember,
            skipOutboundSend: true,
        });

        return res.status(200).json({
            success: true,
            wamid,
            simulatedRole: simRole,
            fsmState: outcome.fsmState,
            replyText: outcome.replyText,
            replyButtons: outcome.replyButtons,
            deniedItems: outcome.deniedItems,
            atypicalFlags: outcome.atypicalFlags,
            outcome,
        });
    } catch (err: any) {
        console.error('[SUPPLY] Error en simulador WhatsApp:', err);
        return res.status(500).json({
            error: err?.message || 'Error ejecutando simulación conversacional WhatsApp.',
        });
    }
});

// ---------------------------------------------------------------------------
// V3-E02: Submódulo Provisorio `Perfiles & Canales WS` (`IHumanResourcesProfilePort`)
// ---------------------------------------------------------------------------

function canAdministerSupplyProfiles(ctx: SupplySessionContext): boolean {
    if (ctx.isSystemPrivileged) return true;
    return ctx.supplyProfile.role === 'OWNER_EXEC' || ctx.supplyProfile.role === 'SITE_ADMIN';
}

function handleProfilePortError(res: Response, err: any, fallbackMessage: string) {
    if (err instanceof SupplyValidationError) {
        return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err instanceof SupplyNotFoundError) {
        return res.status(404).json({ error: err.message, code: 'PROFILE_OR_GRANT_NOT_FOUND' });
    }
    if (err instanceof SupplyConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error('[SUPPLY-PROFILES] Error:', err);
    return res.status(500).json({ error: fallbackMessage });
}

router.get('/profiles', requireSupplyTenantScope, async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const atIsoRaw = typeof req.query.atIso === 'string' ? req.query.atIso.trim() : undefined;
        const atIso = atIsoRaw && Number.isFinite(Date.parse(atIsoRaw)) ? atIsoRaw : undefined;
        const evaluations = await ProvisionalSupplyProfileAdapter.listTenantProfiles(ctx.tenantId, atIso);
        return res.status(200).json({
            profiles: evaluations.map((ev) => ({
                ...ev.profile,
                effectiveChannels: ev.effectiveChannels,
                activeTemporaryGrants: ev.activeTemporaryGrants,
                expiredTemporaryGrantsCount: ev.expiredTemporaryGrantsCount,
                effectiveMaxAmountClp: ev.effectiveMaxAmountClp,
                effectiveAllowedSiteIds: ev.effectiveAllowedSiteIds,
                hasValidDgmnLicense: ev.hasValidDgmnLicense,
                whatsappDispatchAllowed: Boolean(ev.whatsappDispatchAllowed),
            })),
            count: evaluations.length,
        });
    } catch (err) {
        return handleProfilePortError(res, err, 'Error listando perfiles de canales WhatsApp.');
    }
});

router.post(
    '/profiles',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canAdministerSupplyProfiles(ctx)) {
                return res.status(403).json({
                    error: 'PROFILE_ADMIN_FORBIDDEN: Solo OWNER_EXEC, SITE_ADMIN o DEV/ADMIN pueden gestionar perfiles y canales WhatsApp.',
                    code: 'PROFILE_ADMIN_FORBIDDEN',
                });
            }
            const parsed = UpsertSupplyProfileRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload inválido o falta confirmación HITL "ACTUALIZAR".',
                    code: 'INVALID_PROFILE_GRANT_PAYLOAD',
                    details: parsed.error.flatten(),
                });
            }
            const ev = await ProvisionalSupplyProfileAdapter.upsertProfileGrant(
                ctx.tenantId,
                parsed.data,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({
                success: true,
                profile: ev.profile,
                effectiveChannels: ev.effectiveChannels,
                hasValidDgmnLicense: ev.hasValidDgmnLicense,
                whatsappDispatchAllowed: Boolean(ev.whatsappDispatchAllowed),
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error guardando perfil de canales WhatsApp.');
        }
    }
);

router.patch(
    '/profiles/:profileId/channels',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canAdministerSupplyProfiles(ctx)) {
                return res.status(403).json({
                    error: 'PROFILE_ADMIN_FORBIDDEN: Solo OWNER_EXEC, SITE_ADMIN o DEV/ADMIN pueden editar casillas WhatsApp.',
                    code: 'PROFILE_ADMIN_FORBIDDEN',
                });
            }
            const parsed = UpdateSupplyProfileChannelsRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload inválido o falta confirmación HITL "ACTUALIZAR".',
                    code: 'INVALID_CHANNEL_MATRIX_PAYLOAD',
                    details: parsed.error.flatten(),
                });
            }
            const ev = await ProvisionalSupplyProfileAdapter.updateProfileChannels(
                ctx.tenantId,
                String(req.params.profileId),
                parsed.data,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({
                success: true,
                profile: ev.profile,
                effectiveChannels: ev.effectiveChannels,
                hasValidDgmnLicense: ev.hasValidDgmnLicense,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error actualizando casillas del perfil WhatsApp.');
        }
    }
);

router.post(
    '/profiles/:profileId/temporary-grants',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canAdministerSupplyProfiles(ctx)) {
                return res.status(403).json({
                    error: 'PROFILE_ADMIN_FORBIDDEN: Solo OWNER_EXEC, SITE_ADMIN o DEV/ADMIN pueden otorgar permisos temporales.',
                    code: 'PROFILE_ADMIN_FORBIDDEN',
                });
            }
            const parsed = GrantTemporaryChannelRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload inválido o falta confirmación HITL "ACTUALIZAR".',
                    code: 'INVALID_TEMP_GRANT_PAYLOAD',
                    details: parsed.error.flatten(),
                });
            }
            const ev = await ProvisionalSupplyProfileAdapter.grantTemporaryChannel(
                ctx.tenantId,
                String(req.params.profileId),
                parsed.data,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(201).json({
                success: true,
                profile: ev.profile,
                effectiveChannels: ev.effectiveChannels,
                activeTemporaryGrants: ev.activeTemporaryGrants,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error creando permiso temporal de canal WhatsApp.');
        }
    }
);

router.delete(
    '/profiles/:profileId/temporary-grants/:grantItemId',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            if (!canAdministerSupplyProfiles(ctx)) {
                return res.status(403).json({
                    error: 'PROFILE_ADMIN_FORBIDDEN: Solo OWNER_EXEC, SITE_ADMIN o DEV/ADMIN pueden revocar permisos temporales.',
                    code: 'PROFILE_ADMIN_FORBIDDEN',
                });
            }
            const parsed = RevokeTemporaryChannelRequestSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Se requiere confirmación HITL "ACTUALIZAR" para revocar el permiso temporal.',
                    code: 'HITL_CONFIRMATION_REQUIRED',
                });
            }
            const ev = await ProvisionalSupplyProfileAdapter.revokeTemporaryChannel(
                ctx.tenantId,
                String(req.params.profileId),
                String(req.params.grantItemId),
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({
                success: true,
                profile: ev.profile,
                effectiveChannels: ev.effectiveChannels,
                activeTemporaryGrants: ev.activeTemporaryGrants,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error revocando permiso temporal.');
        }
    }
);

router.post(
    '/profiles/:profileId/opt-in/confirm',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const existing = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileById(
                ctx.tenantId,
                String(req.params.profileId)
            );
            if (!existing) {
                return res.status(404).json({
                    error: `Perfil ${req.params.profileId} no encontrado.`,
                    code: 'PROFILE_OR_GRANT_NOT_FOUND',
                });
            }
            const isLinkedSelf =
                Boolean(existing.profile.linkedMemberUid) &&
                existing.profile.linkedMemberUid === ctx.actorUid;
            if (!canAdministerSupplyProfiles(ctx) && !isLinkedSelf) {
                return res.status(403).json({
                    error: 'PROFILE_ADMIN_FORBIDDEN: No autorizado para confirmar o revocar consentimiento de este perfil.',
                    code: 'PROFILE_ADMIN_FORBIDDEN',
                });
            }
            const parsed = ConfirmSupplyProfileOptInRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload inválido o falta confirmación HITL "ACTUALIZAR".',
                    code: 'INVALID_OPT_IN_PAYLOAD',
                    details: parsed.error.flatten(),
                });
            }
            const ev = await ProvisionalSupplyProfileAdapter.confirmOrRevokeOptIn(
                ctx.tenantId,
                String(req.params.profileId),
                parsed.data,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            return res.status(200).json({
                success: true,
                profile: ev.profile,
                effectiveChannels: ev.effectiveChannels,
                whatsappDispatchAllowed: Boolean(ev.whatsappDispatchAllowed),
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error procesando Doble Opt-In de perfil.');
        }
    }
);

// ---------------------------------------------------------------------------
// V3-E03: Archivo Inmutable de Conversaciones WhatsApp (SHA-256 + RBAC + CSV/JSON)
// ---------------------------------------------------------------------------

router.get(
    '/conversations',
    requireSupplyTenantScope,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const profileId =
                typeof req.query.profileId === 'string' && req.query.profileId.trim()
                    ? req.query.profileId.trim()
                    : undefined;
            const channelIdRaw =
                typeof req.query.channelId === 'string' && req.query.channelId.trim()
                    ? req.query.channelId.trim().toUpperCase()
                    : undefined;
            let channelId: z.infer<typeof SupplyWhatsAppChannelIdSchema> | undefined;
            if (channelIdRaw) {
                const parsedCh = SupplyWhatsAppChannelIdSchema.safeParse(channelIdRaw);
                if (!parsedCh.success) {
                    return res.status(400).json({
                        error: `channelId inválido: ${channelIdRaw}`,
                        code: 'INVALID_CHANNEL_ID',
                    });
                }
                channelId = parsedCh.data;
            }
            const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;
            const allThreads = await ConversationAuditService.listThreads(ctx.tenantId, {
                profileId,
                channelId,
                limit: limitRaw,
            });
            const isAdmin = canAdministerSupplyProfiles(ctx);
            const threads = isAdmin
                ? allThreads
                : allThreads.filter((t) => t.profileId === ctx.actorUid);

            return res.status(200).json({
                threads,
                count: threads.length,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error listando hilos de conversación.');
        }
    }
);

router.get(
    '/conversations/:threadId/turns',
    requireSupplyTenantScope,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const threadId = String(req.params.threadId || '').trim();
            const thread = await ConversationAuditService.getThread(ctx.tenantId, threadId);
            if (!thread) {
                return res.status(404).json({
                    error: `Hilo de conversación ${threadId} no encontrado.`,
                    code: 'CONVERSATION_THREAD_NOT_FOUND',
                });
            }

            let isLinkedOwner = thread.profileId === ctx.actorUid;
            if (!isLinkedOwner) {
                const profileEv = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileById(
                    ctx.tenantId,
                    thread.profileId
                ).catch(() => null);
                isLinkedOwner = Boolean(profileEv?.profile.linkedMemberUid === ctx.actorUid);
            }
            if (!canAdministerSupplyProfiles(ctx) && !isLinkedOwner) {
                return res.status(403).json({
                    error: 'CONVERSATION_FORBIDDEN: No autorizado para consultar turnos de este hilo.',
                    code: 'CONVERSATION_FORBIDDEN',
                });
            }

            const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;
            const turns = await ConversationAuditService.listTurns(ctx.tenantId, threadId, limitRaw);
            const chainVerification = ConversationAuditService.verifyTurnChain(turns);
            return res.status(200).json({
                thread,
                turns,
                chainVerification,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error listando turnos de conversación.');
        }
    }
);

router.post(
    '/conversations/:threadId/export',
    requireSupplyTenantScope,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const threadId = String(req.params.threadId || '').trim();
            const parsed = ExportConversationQuerySchema.safeParse({
                format: req.body?.format ?? req.query?.format,
            });
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Formato de exportación inválido (usa JSON o CSV).',
                    code: 'INVALID_EXPORT_FORMAT',
                    details: parsed.error.flatten(),
                });
            }

            const thread = await ConversationAuditService.getThread(ctx.tenantId, threadId);
            if (!thread) {
                return res.status(404).json({
                    error: `Hilo de conversación ${threadId} no encontrado.`,
                    code: 'CONVERSATION_THREAD_NOT_FOUND',
                });
            }

            let isLinkedOwner = thread.profileId === ctx.actorUid;
            if (!isLinkedOwner) {
                const profileEv = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileById(
                    ctx.tenantId,
                    thread.profileId
                ).catch(() => null);
                isLinkedOwner = Boolean(profileEv?.profile.linkedMemberUid === ctx.actorUid);
            }
            if (!canAdministerSupplyProfiles(ctx) && !isLinkedOwner) {
                return res.status(403).json({
                    error: 'CONVERSATION_EXPORT_FORBIDDEN: Solo administradores o titular autorizado pueden exportar la conversación.',
                    code: 'CONVERSATION_EXPORT_FORBIDDEN',
                });
            }

            const exported = await ConversationAuditService.exportThread(
                ctx.tenantId,
                threadId,
                parsed.data.format,
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );
            res.setHeader('X-Content-SHA256', exported.sha256);
            if (parsed.data.format === 'CSV') {
                res.setHeader('Content-Type', exported.contentType);
                res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
                return res.status(200).send(exported.body);
            }
            return res.status(200).json({
                filename: exported.filename,
                sha256: exported.sha256,
                turnCount: exported.turnCount,
                chainVerification: exported.chainVerification,
                payload: JSON.parse(exported.body),
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error exportando historial de conversación.');
        }
    }
);

// ---------------------------------------------------------------------------
// V3-E04: Bodegas & Estanques Físicos, Kardex Transaccional, Recepción 4-Way y KPIs
// ---------------------------------------------------------------------------

router.get(
    '/warehouses',
    requireSupplyTenantScope,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const siteId =
                typeof req.query.siteId === 'string' && req.query.siteId.trim()
                    ? req.query.siteId.trim()
                    : undefined;
            const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;
            const [warehouses, balances] = await Promise.all([
                SupplyRepository.listWarehouses(ctx.tenantId, siteId, limitRaw),
                SupplyRepository.listWarehouseBalances(ctx.tenantId, { siteId, limit: limitRaw }),
            ]);
            return res.status(200).json({
                warehouses,
                balances,
                count: warehouses.length,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error listando bodegas físicas.');
        }
    }
);

router.post(
    '/warehouses',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const parsed = CreateSupplyWarehouseRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload inválido o falta confirmación HITL "ACTUALIZAR".',
                    code: 'INVALID_WAREHOUSE_PAYLOAD',
                    details: parsed.error.flatten(),
                });
            }
            const warehouse = await SupplyRepository.upsertWarehouse(ctx.tenantId, parsed.data, {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            });
            return res.status(200).json({
                success: true,
                warehouse,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error creando/actualizando bodega física.');
        }
    }
);

router.get(
    '/kardex',
    requireSupplyTenantScope,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const siteId =
                typeof req.query.siteId === 'string' && req.query.siteId.trim()
                    ? req.query.siteId.trim()
                    : undefined;
            const warehouseId =
                typeof req.query.warehouseId === 'string' && req.query.warehouseId.trim()
                    ? req.query.warehouseId.trim()
                    : undefined;
            const canonicalSkuId =
                typeof req.query.canonicalSkuId === 'string' && req.query.canonicalSkuId.trim()
                    ? req.query.canonicalSkuId.trim()
                    : undefined;
            const movementType =
                typeof req.query.movementType === 'string' && req.query.movementType.trim()
                    ? req.query.movementType.trim()
                    : undefined;
            const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;

            const [entries, balances, tankTelemetry] = await Promise.all([
                SupplyRepository.listStockLedger(ctx.tenantId, {
                    siteId,
                    warehouseId,
                    canonicalSkuId,
                    movementType,
                    limit: limitRaw,
                }),
                SupplyRepository.listWarehouseBalances(ctx.tenantId, {
                    siteId,
                    warehouseId,
                    canonicalSkuId,
                    limit: limitRaw,
                }),
                SupplyRepository.listTankTelemetry(ctx.tenantId, {
                    siteId,
                    warehouseId,
                    limit: 50,
                }),
            ]);
            return res.status(200).json({
                entries,
                balances,
                tankTelemetry,
                count: entries.length,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error consultando Kardex de bodega.');
        }
    }
);

router.post(
    '/kardex',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const actor = {
                actorUid: ctx.actorUid,
                actorEmail: ctx.actorEmail,
                ipAddress: extractClientIp(req),
            };
            const isCycleCount =
                req.body?.measuredLevelSi !== undefined ||
                req.body?.movementType === 'CYCLE_COUNT_ADJUSTMENT' ||
                req.body?.action === 'TANK_CYCLE_COUNT';

            if (isCycleCount) {
                const parsedCycle = TankCycleCountRequestSchema.safeParse(req.body);
                if (!parsedCycle.success) {
                    return res.status(400).json({
                        error: 'Aforo de estanque/polvorín inválido o falta confirmación HITL "ACTUALIZAR".',
                        code: 'INVALID_TANK_CYCLE_COUNT_PAYLOAD',
                        details: parsedCycle.error.flatten(),
                    });
                }
                const result = await SupplyRepository.recordTankCycleCount(
                    ctx.tenantId,
                    parsedCycle.data,
                    actor
                );
                return res.status(200).json({
                    success: true,
                    ...result,
                });
            }

            const parsedMove = RecordStockMovementRequestSchema.safeParse(req.body);
            if (!parsedMove.success) {
                return res.status(400).json({
                    error: 'Payload inválido para movimiento Kardex.',
                    code: 'INVALID_KARDEX_MOVEMENT_PAYLOAD',
                    details: parsedMove.error.flatten(),
                });
            }
            const result = await SupplyRepository.recordKardexMovement(
                ctx.tenantId,
                parsedMove.data,
                actor
            );
            return res.status(200).json({
                success: true,
                ...result,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error registrando movimiento de Kardex.');
        }
    }
);

router.post(
    '/warehouses/receptions',
    requireSupplyTenantScope,
    requireSupplyMutationAllowed,
    mutationRateLimiter,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const parsed = ConfirmWarehouseReceptionV3RequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Recepción física 4-Way inválida o falta confirmación HITL "ACTUALIZAR".',
                    code: 'INVALID_WAREHOUSE_RECEPTION_PAYLOAD',
                    details: parsed.error.flatten(),
                });
            }

            const result = await SupplyRepository.confirmPurchaseReception(
                {
                    tenantId: ctx.tenantId,
                    purchaseId: parsed.data.purchaseId,
                    warehouseId: parsed.data.warehouseId,
                    receivedLines: parsed.data.receivedLines.map((l) => ({
                        purchaseLineId: l.purchaseLineId,
                        qtyReceived: l.qtyReceivedNow,
                    })),
                    lineDetails: parsed.data.receivedLines.map((l) => ({
                        purchaseLineId: l.purchaseLineId,
                        warehouseId: l.warehouseId || parsed.data.warehouseId,
                        shrinkageQty: l.shrinkageQty,
                        shrinkageReason: l.shrinkageReason,
                        lotNumber: l.lotNumber,
                        expiryDateIso: l.expiryDateIso,
                        evidenceCasRef: l.evidenceCasRef || parsed.data.evidenceCasRef || undefined,
                    })),
                    evidenceCasRef: parsed.data.evidenceCasRef || undefined,
                    notes: parsed.data.notes,
                },
                {
                    actorUid: ctx.actorUid,
                    actorEmail: ctx.actorEmail,
                    ipAddress: extractClientIp(req),
                }
            );

            for (const reqItem of result.affectedRequisitions) {
                const activePhone = await SupplyRepository.resolveActiveMemberPhoneE164(
                    ctx.tenantId,
                    reqItem.requesterUid
                );
                const fallbackUnmasked =
                    reqItem.requesterPhoneE164 &&
                    !reqItem.requesterPhoneE164.includes('*') &&
                    /^\+[1-9]\d{6,14}$/.test(reqItem.requesterPhoneE164.trim())
                        ? reqItem.requesterPhoneE164.trim()
                        : null;
                const targetPhone = activePhone || fallbackUnmasked;
                if (targetPhone) {
                    const summaryLines = reqItem.lines.map(
                        (l) => `${l.itemName}: ${l.qtyReceived}/${l.qtyRequested} ${l.unitSi} recibido`
                    );
                    await EmailAndWhatsAppNotifier.sendFieldStatusUpdate({
                        toE164: targetPhone,
                        requisitionId: reqItem.reqId,
                        statusLabel:
                            result.receptionOutcome === 'RECEIVED_OK'
                                ? 'RECEPCIÓN EN BODEGA CONFIRMADA'
                                : 'RECEPCIÓN PARCIAL CON DISCREPANCIAS',
                        summaryLines,
                    }).catch(() => {});
                }
            }

            return res.status(200).json({
                success: true,
                purchase: result.purchase,
                receptionOutcome: result.receptionOutcome,
                receivedItemCount: result.receivedItemCount,
                affectedRequisitionIds: result.affectedRequisitions.map((r) => r.reqId),
                discrepancies: result.discrepancies,
                urgentRcvAlert: result.urgentRcvAlert,
                suggestCreditNote61: result.suggestCreditNote61,
            });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error confirmando recepción física 4-Way.');
        }
    }
);

router.get(
    '/kpis',
    requireSupplyTenantScope,
    async (req: SupplyRequest, res: Response) => {
        try {
            const ctx = req.supplyContext!;
            const siteId =
                typeof req.query.siteId === 'string' && req.query.siteId.trim()
                    ? req.query.siteId.trim()
                    : undefined;
            const periodDays = req.query.periodDays ? Number(req.query.periodDays) : undefined;
            const mineTonnageProcessed = req.query.tonnage ? Number(req.query.tonnage) : undefined;
            const kpis = await SupplyRepository.computeBusinessUnitKpis(ctx.tenantId, siteId, {
                periodDays: Number.isFinite(periodDays) ? periodDays : undefined,
                mineTonnageProcessed: Number.isFinite(mineTonnageProcessed)
                    ? mineTonnageProcessed
                    : undefined,
            });
            return res.status(200).json({ kpis });
        } catch (err) {
            return handleProfilePortError(res, err, 'Error calculando KPIs operacionales.');
        }
    }
);

export default router;
