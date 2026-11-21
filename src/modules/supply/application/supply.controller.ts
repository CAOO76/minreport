import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env, isDevPrivateReleaseStage } from '../../../config/env';
import { auth, db } from '../../../config/firebase';
import { evaluatePilotExpiration } from '../../../contracts/session.contracts';
import { AuditLedger } from '../../../core/audit-ledger';
import { isDecodedDevRootToken, logThrottledAuthFailure } from '../../../middleware/auth';
import {
    aiRateLimiter,
    extractClientIp,
    mutationRateLimiter,
} from '../../../middleware/rateLimiter';
import { normalizeE164Phone } from '../../../utils/taxIdValidator';
import { EmailAndWhatsAppNotifier } from '../adapters/EmailAndWhatsAppNotifier';
import {
    type InboundWhatsAppMessage,
    MetaWhatsAppCloudAdapter,
} from '../adapters/MetaWhatsAppCloudAdapter';
import { CampChannel, type ResolvedWhatsAppMember } from '../channels/camp.channel';
import { ReceiptIntelligencePipeline } from './ReceiptIntelligencePipeline';
import {
    SupplyConflictError,
    SupplyDuplicateSiiDocumentError,
    SupplyForbiddenError,
    SupplyNotFoundError,
    SupplyRepository,
} from './SupplyRepository';
import {
    CanonicalSupplySkuSchema,
    checkGlobalHardDeny,
    evaluateAtypicalFlagsForLine,
    EvidenceCasRefSchema,
    exportSiiDocumentsToCsv,
    HitlConfirmationKeywordSchema,
    normalizeSupplyItemFromText,
    PaymentMethodSchema,
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

export interface SupplySessionContext {
    tenantId: string;
    actorUid: string;
    actorEmail: string;
    actorName: string;
    accountTier: 1 | 2 | 3 | 4 | 5;
    isSystemPrivileged: boolean;
    b2bRole: string;
    supplyProfile: SupplyMemberProfile;
    phoneE164?: string;
}

export interface SupplyRequest extends Request {
    user?: any;
    rawBody?: Buffer;
    supplyContext?: SupplySessionContext;
}

function isInactiveStatus(status: unknown): boolean {
    const st = String(status || 'ACTIVE').trim().toUpperCase();
    return st === 'SUSPENDED' || st === 'REVOKED' || st === 'INACTIVE' || st === 'DELETED';
}

function buildSupplyProfileFromData(
    rawProfile: unknown,
    b2bRole: string,
    isSystemPrivileged: boolean
): SupplyMemberProfile {
    const base = (rawProfile && typeof rawProfile === 'object' ? rawProfile : {}) as Record<string, any>;
    let role: SupplyOperationalRole = base.role || 'CAMP_MANAGER';
    if (!base.role) {
        if (isSystemPrivileged || b2bRole === 'OWNER') {
            role = 'OWNER_EXEC';
        } else if (b2bRole === 'ADMIN') {
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

/**
 * Middleware soberano de sesión y aislamiento multi-tenant para `/api/supply/*`.
 */
export async function requireSupplyTenantScope(
    req: SupplyRequest,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No autorizado: Token de sesión MINREPORT requerido.' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return res.status(401).json({ error: 'No autorizado: Token de sesión vacío.' });
        }

        let decoded: Awaited<ReturnType<typeof auth.verifyIdToken>>;
        try {
            decoded = await auth.verifyIdToken(token);
        } catch (authErr) {
            logThrottledAuthFailure('SUPPLY-API', req, authErr);
            return res.status(401).json({ error: 'No autorizado: Fallo al verificar sesión MINREPORT.' });
        }

        if (isDevPrivateReleaseStage() && !isDecodedDevRootToken(decoded)) {
            return res.status(403).json({
                error: 'RELEASE_STAGE_DEV_ONLY: Acceso restringido exclusivamente a 1º DEV.',
                code: 'RELEASE_STAGE_DEV_ONLY',
            });
        }

        req.user = decoded;
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
            !userDisabled &&
            (tokenRole === 'TEST_PILOT' || serverUserRole === 'TEST_PILOT');

        if (isTestPilot) {
            const candidateExpiry = decoded.pilotExpiresAt ?? profileData?.pilotExpiresAt;
            if (evaluatePilotExpiration(candidateExpiry)) {
                return res.status(403).json({
                    error: 'Cuenta 3º TEST-PILOT expirada.',
                    code: 'PILOT_ACCOUNT_EXPIRED',
                });
            }
        }

        const isSystemPrivileged = isDevRoot || isSuperAdmin || isTestPilot;

        const headerTenantId = String(
            req.headers['x-active-account-id'] || req.headers['x-tenant-id'] || ''
        ).trim();

        const resolvedTenantId =
            headerTenantId ||
            String(decoded.activeAccountId || '').trim() ||
            String(profileData?.lastActiveAccountId || '').trim() ||
            String(profileData?.primaryAccountId || '').trim() ||
            String(profileData?.memberships?.[0]?.accountId || '').trim() ||
            (isSystemPrivileged ? 'dev-master-sandbox' : '');

        if (!resolvedTenantId || !TENANT_ID_REGEX.test(resolvedTenantId)) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED: tenantId inválido o ausente.' });
        }

        if (!isSystemPrivileged && (userDisabled || resolvedTenantId === 'dev-master-sandbox')) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        let accountData: Record<string, any> | null = null;
        if (resolvedTenantId !== 'dev-master-sandbox') {
            const accSnap = await db.collection('accounts').doc(resolvedTenantId).get();
            if (accSnap.exists) {
                accountData = accSnap.data() || null;
            } else if (!isSystemPrivileged) {
                return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
            }
        }

        const accountStatus = String(accountData?.status || 'ACTIVE').toUpperCase();
        if (
            !isSystemPrivileged &&
            (accountStatus === 'PENDING_APPROVAL' ||
                accountStatus === 'REJECTED' ||
                accountStatus === 'SUSPENDED')
        ) {
            return res.status(403).json({
                error: `CUENTA_${accountStatus}: La cuenta organizacional no está habilitada.`,
            });
        }

        // Comprobar estado global del módulo `supply` para cuentas no privilegiadas
        if (!isSystemPrivileged) {
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
                // Fail-open ante timeout transitorio de lectura de estado
            }
        }

        let memberData: Record<string, any> | null = null;
        if (resolvedTenantId !== 'dev-master-sandbox') {
            try {
                const memberSnap = await db
                    .collection('accounts')
                    .doc(resolvedTenantId)
                    .collection('members')
                    .doc(uid)
                    .get();
                if (memberSnap.exists) {
                    memberData = memberSnap.data() || null;
                }
            } catch {
                memberData = null;
            }
        }

        const isOwner = Boolean(accountData?.ownerId && accountData.ownerId === uid);
        const profileMembership = Array.isArray(profileData?.memberships)
            ? profileData!.memberships.find(
                  (m: any) => m?.accountId === resolvedTenantId && !isInactiveStatus(m?.status)
              )
            : undefined;
        const hasActiveMemberDoc = Boolean(memberData && !isInactiveStatus(memberData.status));

        if (!isSystemPrivileged && !isOwner && !profileMembership && !hasActiveMemberDoc) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        const b2bRole = String(
            (isOwner ? 'OWNER' : '') ||
                memberData?.role ||
                profileMembership?.role ||
                (isDevRoot ? 'DEV_ROOT' : isSuperAdmin ? 'SUPER_ADMIN' : isTestPilot ? 'TEST_PILOT' : 'OPERATOR')
        ).toUpperCase();

        const isEduSandbox =
            !isSystemPrivileged &&
            (String(accountData?.type || '').toUpperCase() === 'EDUCATIONAL' ||
                Boolean(accountData?.isEduSandbox));

        const accountTier: 1 | 2 | 3 | 4 | 5 = isDevRoot
            ? 1
            : isSuperAdmin
              ? 2
              : isTestPilot
                ? 3
                : isEduSandbox
                  ? 5
                  : 4;

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
            b2bRole,
            supplyProfile,
            phoneE164: typeof memberData?.phoneE164 === 'string' ? memberData.phoneE164 : undefined,
        };

        return next();
    } catch (err) {
        console.error('[SUPPLY-CONTROLLER] Error resolviendo sesión supply:', err);
        return res.status(401).json({ error: 'No autorizado: Error verificando sesión.' });
    }
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
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMPAMENTO'),
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
                    procurementBucket: z
                        .enum([
                            'VERDULERIA',
                            'SUPERMERCADO',
                            'FERRETERIA',
                            'REPUESTOS_OPERMAQ',
                            'EPP_SEGURIDAD',
                            'GAS_AGUA_COMBUSTIBLE',
                            'MANTENCION_EQUIPAMIENTO',
                        ])
                        .optional(),
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
    procurementBucket: z
        .enum([
            'VERDULERIA',
            'SUPERMERCADO',
            'FERRETERIA',
            'REPUESTOS_OPERMAQ',
            'EPP_SEGURIDAD',
            'GAS_AGUA_COMBUSTIBLE',
            'MANTENCION_EQUIPAMIENTO',
        ])
        .optional(),
    unitSi: z.enum(['kg', 'L', 'un', 'par', 'm', 'm3', 'caja', 'bolsa']).optional(),
    qtyPurchased: z.number().positive(),
    unitPriceClp: z.number().nonnegative().optional(),
    unitPriceNetClp: z.number().nonnegative().optional(),
    unitPriceGrossClp: z.number().nonnegative().optional(),
    subtotalClp: z.number().nonnegative().optional(),
    lineNetClp: z.number().nonnegative().optional(),
    lineVatClp: z.number().nonnegative().optional(),
    lineTotalClp: z.number().nonnegative().optional(),
    destination: PurchaseLineDestinationSchema.default('STOCK_IN_TRANSIT'),
    costCenter: z.string().trim().max(64).default('CC-CAMPAMENTO'),
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
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMPAMENTO'),
    referenceId: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(300),
});

const CreateExpenseReportBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    siteId: z.string().trim().min(1).max(128),
    paymentMethod: PaymentMethodSchema,
    title: z.string().trim().min(2).max(200),
    periodLabel: z.string().trim().min(2).max(80).optional(),
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMPAMENTO'),
    fundAdvanceClp: z.number().nonnegative(),
    siiDocumentIds: z.array(z.string().trim().min(1).max(160)).max(200).default([]),
});

const PatchExpenseReportBodySchema = z.object({
    confirmationKeyword: HitlConfirmationKeywordSchema,
    status: SiiExpenseReportStatusSchema,
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

            const rawBodyForHmac: Buffer = Buffer.isBuffer(req.rawBody)
                ? req.rawBody
                : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

            const isValidSig = await MetaWhatsAppCloudAdapter.verifyWebhookSignature(
                rawBodyForHmac,
                sigHeader
            );

            if (!isValidSig) {
                return res.status(401).json({
                    error: 'INVALID_WHATSAPP_SIGNATURE',
                    message: 'Firma criptográfica X-Hub-Signature-256 inválida o ausente.',
                });
            }

            const inboundEvents = MetaWhatsAppCloudAdapter.parseWebhookEvents(req.body);
            const flushImmediately =
                process.env.NODE_ENV === 'test' && req.query.flush === 'true';

            const results = [];
            for (const event of inboundEvents) {
                const outcome = await CampChannel.handleInboundMessage(event, {
                    flushImmediately,
                });
                results.push({
                    wamid: event.wamid,
                    handled: outcome.handled,
                    duplicate: Boolean(outcome.duplicate),
                    buffered: Boolean(outcome.buffered),
                    fsmState: outcome.fsmState,
                });
            }

            return res.status(200).json({
                ok: true,
                received: inboundEvents.length,
                results,
            });
        } catch (err) {
            console.error('[SUPPLY-WA-WEBHOOK] Error procesando webhook Meta:', err);
            return res.status(500).json({ error: 'Error interno procesando evento WhatsApp.' });
        }
    }
);

// Todas las rutas siguientes exigen sesión verificada y aislamiento multi-tenant
router.use(requireSupplyTenantScope);

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
        const site = await SupplyRepository.upsertSite(ctx.tenantId, sitePayload, {
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
        const site = await SupplyRepository.upsertSite(
            ctx.tenantId,
            { ...existing, ...patch, siteId },
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

        const site = await SupplyRepository.getSite(ctx.tenantId, parsed.data.siteId);
        const roleMismatchMode = site?.roleMismatchMode || 'FLAG_AND_ACCEPT';
        const deniedItems: Array<{ itemName: string; reason: string }> = [];
        const acceptedLines = [];

        for (let idx = 0; idx < parsed.data.lines.length; idx++) {
            const rawLine = parsed.data.lines[idx];
            const resolvedItemName = (
                rawLine.normalizedName ||
                rawLine.itemName ||
                rawLine.rawDescription ||
                ''
            ).trim();
            const rawTextForPolicy = `${rawLine.rawDescription || ''} ${resolvedItemName}`.trim();
            const hardDeny = checkGlobalHardDeny(rawTextForPolicy);
            if (hardDeny.denied) {
                deniedItems.push({
                    itemName: resolvedItemName,
                    reason: hardDeny.reason || 'Bloqueado por política DS 132.',
                });
                continue;
            }

            const norm = normalizeSupplyItemFromText(resolvedItemName, rawLine.qtyRequested, rawLine.unitSi);
            const categoryCode = rawLine.categoryCode || norm.categoryCode;
            const flags = evaluateAtypicalFlagsForLine({
                role: ctx.supplyProfile.role,
                profile: ctx.supplyProfile,
                categoryCode,
                isCapexAsset: norm.isCapexAsset,
                estimatedTotalClp: rawLine.estimatedUnitClp
                    ? rawLine.estimatedUnitClp * rawLine.qtyRequested
                    : undefined,
            });

            if (roleMismatchMode === 'STRICT_BLOCK' && flags.includes('ATYPICAL_ROLE_MISMATCH')) {
                deniedItems.push({
                    itemName: resolvedItemName,
                    reason: `Categoría ${categoryCode} restringida para rol ${ctx.supplyProfile.role}.`,
                });
                continue;
            }

            acceptedLines.push({
                lineId: `rline_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
                canonicalSkuId: rawLine.canonicalSkuId || norm.canonicalSkuId,
                itemName: resolvedItemName,
                rawRequestedText: rawLine.rawDescription || resolvedItemName,
                categoryCode,
                procurementBucket: rawLine.procurementBucket || norm.procurementBucket,
                unitSi: rawLine.unitSi || norm.unitSi,
                qtyRequested: rawLine.qtyRequested,
                qtyPurchased: 0,
                qtyReceived: 0,
                qtyPending: rawLine.qtyRequested,
                lineStatus: 'OPEN' as const,
                atypicalFlags: flags,
                fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE' as const,
                urgency: rawLine.urgency,
                estimatedUnitClp: rawLine.estimatedUnitClp,
                attributes: rawLine.attributes,
                evidenceCasRef: rawLine.evidenceCasRef || undefined,
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
                requesterRole: ctx.supplyProfile.role,
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

router.post(
    '/receipts/analyze',
    aiRateLimiter,
    (req, res, next) => {
        if (req.is('multipart/form-data')) {
            return upload.single('file')(req, res, (err: any) => {
                if (err) {
                    return res.status(400).json({ error: `Error cargando comprobante: ${err.message}` });
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
            const body = (req.body || {}) as Record<string, any>;

            let rawBuffer: Buffer | undefined = uploadedFile?.buffer;
            let mimeType: string | undefined = uploadedFile?.mimetype || body.mimeType;
            const originalFilename: string | undefined =
                uploadedFile?.originalname || body.originalFilename;

            if (!rawBuffer && typeof body.fileBase64 === 'string' && body.fileBase64.trim().length > 0) {
                const stripped = body.fileBase64.replace(/^data:[^;]+;base64,/, '');
                rawBuffer = Buffer.from(stripped, 'base64');
            }

            const xmlContent =
                typeof body.xmlDteContent === 'string' && body.xmlDteContent.trim()
                    ? body.xmlDteContent
                    : typeof body.xmlContent === 'string' && body.xmlContent.trim()
                      ? body.xmlContent
                      : undefined;
            const tedRawXml =
                typeof body.tedRawXml === 'string' && body.tedRawXml.trim()
                    ? body.tedRawXml
                    : undefined;

            const parsedCasRef = body.evidenceCasRef
                ? EvidenceCasRefSchema.safeParse(body.evidenceCasRef)
                : null;
            const existingEvidenceCasRef = parsedCasRef?.success ? parsedCasRef.data : undefined;

            if (!rawBuffer && !xmlContent && !tedRawXml && !existingEvidenceCasRef) {
                return res.status(400).json({
                    error: 'Debe adjuntar un archivo (imagen/PDF/XML), evidenceCasRef pre-digerido, xmlDteContent o tedRawXml.',
                });
            }

            const clientOriginalBytes =
                body.clientOriginalBytes !== undefined ? Number(body.clientOriginalBytes) : undefined;
            const parsedDest = PurchaseLineDestinationSchema.safeParse(body.defaultDestination);

            const analysis = await ReceiptIntelligencePipeline.analyze({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorUid,
                rawBuffer,
                mimeType,
                originalFilename,
                clientOriginalBytes:
                    typeof clientOriginalBytes === 'number' && Number.isFinite(clientOriginalBytes)
                        ? clientOriginalBytes
                        : undefined,
                existingEvidenceCasRef,
                xmlContent,
                tedRawXml,
                contextCaption: typeof body.contextCaption === 'string' ? body.contextCaption : undefined,
                defaultDestination: parsedDest.success ? parsedDest.data : 'STOCK_IN_TRANSIT',
                defaultCostCenter:
                    typeof body.defaultCostCenter === 'string'
                        ? body.defaultCostCenter
                        : ctx.supplyProfile.defaultCostCenter,
                checkDuplicateDedupeKey: (dedupeKey) =>
                    SupplyRepository.existsSiiDocument(ctx.tenantId, dedupeKey),
            });

            return res.status(200).json({
                success: true,
                analysis,
            });
        } catch (err: any) {
            console.error('[SUPPLY] Error en ReceiptIntelligencePipeline:', err);
            return res.status(500).json({
                error: err?.message || 'Error analizando comprobante de compra.',
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

        // Validar autoridad para compra directa autónoma sin requisición previa
        const canDirect =
            ctx.isSystemPrivileged ||
            ctx.b2bRole === 'OWNER' ||
            ctx.b2bRole === 'ADMIN' ||
            ctx.supplyProfile.canRecordDirectPurchase ||
            ctx.supplyProfile.role === 'OWNER_EXEC' ||
            ctx.supplyProfile.role === 'SITE_ADMIN' ||
            ctx.supplyProfile.role === 'BUYER';

        if (data.purchaseMode === 'DIRECT_AUTONOMOUS' && !canDirect) {
            return res.status(403).json({
                error: 'DIRECT_PURCHASE_FORBIDDEN: Su perfil no está autorizado para registrar compras autónomas directas.',
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
            const subtotalClp = Math.round(
                l.lineTotalClp ??
                    l.subtotalClp ??
                    ((l.lineNetClp ?? 0) + (l.lineVatClp ?? 0) ||
                        l.qtyPurchased * (l.unitPriceGrossClp ?? l.unitPriceClp ?? l.unitPriceNetClp ?? 0))
            );
            const unitPriceClp = Math.round(
                l.unitPriceGrossClp ??
                    l.unitPriceClp ??
                    l.unitPriceNetClp ??
                    (l.qtyPurchased > 0 ? subtotalClp / l.qtyPurchased : 0)
            );
            const mergedExplicit = [
                ...(l.explicitAllocations || []),
                ...(topLevelAllocsByLine.get(l.purchaseLineId) || []),
            ];

            return {
                purchaseLineId: l.purchaseLineId,
                canonicalSkuId: l.canonicalSkuId || norm.canonicalSkuId,
                description: desc,
                categoryCode: l.categoryCode || norm.categoryCode,
                procurementBucket: l.procurementBucket || norm.procurementBucket,
                unitSi: l.unitSi || norm.unitSi,
                qtyPurchased: l.qtyPurchased,
                unitPriceClp,
                subtotalClp,
                destination: l.destination,
                costCenter: l.costCenter || 'CC-CAMPAMENTO',
                isCapexAsset: Boolean(l.isCapexAsset || l.destination === 'CAPEX_ASSET' || norm.isCapexAsset),
                serialOrTag: l.serialOrTag,
                explicitAllocations: mergedExplicit.length > 0 ? mergedExplicit : undefined,
            };
        });

        const result = await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: ctx.tenantId,
                siteId: data.siteId,
                buyerUid: ctx.actorUid,
                buyerRole: ctx.supplyProfile.role,
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

            // Retroalimentación automática por WhatsApp a solicitantes en terreno
            for (const reqItem of result.affectedRequisitions) {
                if (reqItem.requesterPhoneE164) {
                    const summaryLines = reqItem.lines.map(
                        (l) => `${l.itemName}: ${l.qtyReceived}/${l.qtyRequested} ${l.unitSi} recibido`
                    );
                    await EmailAndWhatsAppNotifier.sendFieldStatusUpdate({
                        toE164: reqItem.requesterPhoneE164,
                        requisitionId: reqItem.reqId,
                        statusLabel: 'RECEPCIÓN EN BODEGA CONFIRMADA',
                        summaryLines,
                    }).catch(() => {});
                }
            }

            return res.status(200).json({
                success: true,
                purchase: result.purchase,
                receivedItemCount: result.receivedItemCount,
                affectedRequisitionIds: result.affectedRequisitions.map((r) => r.reqId),
            });
        } catch (err: any) {
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
        const forecasts = await SupplyRepository.computeAndStoreForecast(ctx.tenantId, siteId);
        return res.status(200).json({ success: true, forecasts });
    } catch (err) {
        console.error('[SUPPLY] Error calculando forecast:', err);
        return res.status(500).json({ error: 'Error calculando pronóstico de demanda y autonomía.' });
    }
});

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
    } catch (err) {
        console.error('[SUPPLY] Error creando rendición SII:', err);
        return res.status(500).json({ error: 'Error creando sobre de rendición SII.' });
    }
});

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
            const report = await SupplyRepository.updateExpenseReportStatus(
                ctx.tenantId,
                reportId,
                parsed.data.status,
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

router.get('/sii/export', async (req: SupplyRequest, res: Response) => {
    try {
        const ctx = req.supplyContext!;
        const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
        const docs = await SupplyRepository.listSiiDocuments(ctx.tenantId, { siteId });
        const csv = exportSiiDocumentsToCsv(docs);
        const dateTag = new Date().toISOString().slice(0, 10);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="minreport-sii-rcv-${dateTag}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        console.error('[SUPPLY] Error exportando CSV SII:', err);
        return res.status(500).json({ error: 'Error generando exportación CSV contable SII.' });
    }
});

// ---------------------------------------------------------------------------
// Anonymous Marketplace Demand Signals (`/marketplace-signals` — k >= 3)
// ---------------------------------------------------------------------------

router.get('/marketplace-signals', async (req: SupplyRequest, res: Response) => {
    try {
        const districtCode = typeof req.query.districtCode === 'string' ? req.query.districtCode : undefined;
        const categoryCode = typeof req.query.categoryCode === 'string' ? req.query.categoryCode : undefined;
        const signals = await SupplyRepository.listAnonymousDemandSignals({ districtCode, categoryCode });
        return res.status(200).json({
            success: true,
            kAnonymityMinimum: 3,
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
                kAnonymityMinimum: 3,
            },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            kAnonymityMinimum: 3,
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
            d.simulateSenderRole || d.simulatedRole || ctx.supplyProfile.role;
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

export default router;
