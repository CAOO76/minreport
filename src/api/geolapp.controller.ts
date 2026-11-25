import { Router, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { db } from '../config/firebase';
import { evaluatePilotExpiration } from '../contracts/session.contracts';
import { AuditLedger } from '../core/audit-ledger';
import {
    AISwarmUnavailableError,
    ResilientAIClient,
    UngroundedEvidenceError,
} from '../core/resilient-ai-client';
import { CasStorageService } from '../core/media/CasStorageService';
import { MediaDigestorServer } from '../core/media/MediaDigestorServer';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import {
    aiRateLimiter,
    extractClientIp,
    mutationRateLimiter,
} from '../middleware/rateLimiter';
import type { ScopedRequest } from '../middleware/sessionScope';
import {
    buildSpatialPointCloudGlbMesh,
    inspectGlbBinaryMetrics,
    type GlbSurfaceBuildResult,
} from '../modules/geolapp/glb-surface.builder';
import {
    computeSpatialStockpileVolume,
    SpatialVolumeValidationError,
    type SpatialSurfaceGrid,
} from '../modules/geolapp/spatial-volume.engine';
import {
    checkDeviceCompatibilityOnDemand,
    DeviceCompatibilityValidationError,
    listRegisteredDeviceCompatibility,
} from '../modules/geolapp/device-compatibility.service';
import {
    AcopiosLifecycleStatusSchema,
    AcopiosMetrologyGradeSchema,
    AcopiosReconciliationStatusSchema,
    CaptureSessionPackageV2Schema,
    evaluateStockpileReconciliation,
    WalkRingPoseSchema,
    WallConfinementModeSchema,
    type AcopiosMetrologyGrade,
} from '../contracts/acopios.contracts';
import {
    generateAndStoreStaticSatelliteMap,
    isValidStaticMapCoordinatePair,
} from '../modules/geolapp/stockpile-static-map.service';
import { safeFetchExternal } from '../utils/ssrfGuard';

const router = Router();

const TENANT_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;
const STOCKPILE_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

const CopperDomainSchema = z.enum([
    'OXIDO_CU',
    'MIXTO_CU',
    'SULFURO_SECUNDARIO_CU',
    'SULFURO_PRIMARIO_CU',
    'CONCENTRADO_CU',
    'BAJA_LEY_CU',
    'ESTERIL_RIPIOS',
]);

const StockpileStatusSchema = z.enum(['ACTIVE', 'ARCHIVED', 'CONCILIATED', 'CLOSED']);
const StockpileClosureReasonSchema = z.enum([
    'SHIPPED',
    'FIELD_REMOVED',
    'ZERO_VOLUME',
    'MANUAL_CLOSE',
]);

const CopperGovernanceAlertSchema = z.object({
    code: z.enum([
        'SULFIDE_AGING_WARNING',
        'SULFIDE_AGING_CRITICAL',
        'CONCENTRATE_TML_EXCEEDED',
    ]),
    severity: z.enum(['WARNING', 'CRITICAL', 'BLOCK']),
    message: z.string().max(500),
    residenceDays: z.number().finite().optional(),
    moisturePct: z.number().finite().optional(),
    tmlLimitPct: z.number().finite().optional(),
});

const RosinRammlerCurvePointSchema = z.object({
    size_mm: z.number().finite().positive(),
    passing_pct: z.number().finite().min(0).max(100),
});

const RosinRammlerHitlSchema = z
    .object({
        xc_mm: z.number().finite().positive(),
        uniformity_n: z.number().finite().positive(),
        p80_mm: z.number().finite().nonnegative(),
        p50_mm: z.number().finite().nonnegative(),
        p20_mm: z.number().finite().nonnegative(),
        oversize_count: z.number().int().nonnegative(),
        oversize_threshold_mm: z.number().finite().positive(),
        source: z.string().trim().min(1).max(80),
        max_boulder_mm: z.number().finite().nonnegative().optional(),
        curve: z.array(RosinRammlerCurvePointSchema).max(64).optional(),
    })
    .nullable()
    .optional();

const HitlPatchSchema = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2500).optional(),
    clase: z.enum(['mineral', 'esteril', 'baja_ley']).nullable().optional(),
    status: StockpileStatusSchema.optional(),
    location_ref: z.string().trim().max(240).optional(),
    project_id: z.string().trim().max(128).nullable().optional(),
    project_name: z.string().trim().max(240).nullable().optional(),
    geo_point: z
        .object({
            latitude: z.number().finite().min(-90).max(90),
            longitude: z.number().finite().min(-180).max(180),
            altitude: z.number().finite().nullable(),
            accuracy: z.number().finite().nonnegative().optional(),
        })
        .optional(),
    static_map_url: z
        .string()
        .max(2048)
        .refine((val) => !val.startsWith('data:'), 'Prohibido Base64 en static_map_url')
        .optional(),
    static_map_sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    static_map_original_bytes: z.number().finite().nonnegative().optional(),
    static_map_optimized_bytes: z.number().finite().nonnegative().optional(),
    static_map_savings_pct: z.number().finite().min(0).max(100).optional(),
    initial_photo_url: z
        .string()
        .max(2048)
        .refine((val) => !val.startsWith('data:'), 'Prohibido Base64 en initial_photo_url')
        .optional(),
    thumbnail_url: z
        .string()
        .max(2048)
        .refine((val) => !val.startsWith('data:'), 'Prohibido Base64 en thumbnail_url')
        .optional(),
    last_photo_url: z
        .string()
        .max(2048)
        .refine((val) => !val.startsWith('data:'), 'Prohibido Base64 en last_photo_url')
        .optional(),
    last_volume_m3: z.number().finite().nonnegative().optional(),
    last_weight_t: z.number().finite().nonnegative().optional(),
    last_measured_at: z.number().finite().nonnegative().optional(),
    last_geometry_type: z.string().trim().max(80).optional(),
    last_delta_volumen_m3: z.number().finite().nullable().optional(),
    last_delta_volumen_pct: z.number().finite().nullable().optional(),
    closed_at: z.number().finite().nonnegative().nullable().optional(),
    closed_by: z.string().trim().max(160).nullable().optional(),
    closure_reason: StockpileClosureReasonSchema.nullable().optional(),
    closure_cause: z.string().trim().max(300).nullable().optional(),
    closure_origin: z.enum(['MOBILE_FIELD']).nullable().optional(),
    dispatch_reference: z.string().trim().max(240).nullable().optional(),
    dispatch_transport: z.string().trim().max(200).nullable().optional(),
    dispatch_destination: z.string().trim().max(200).nullable().optional(),
    dispatch_timestamp: z.number().finite().nonnegative().nullable().optional(),
    shipped_weight_t: z.number().finite().nonnegative().nullable().optional(),
    pre_closure_volume_m3: z.number().finite().nonnegative().nullable().optional(),
    volumen: z.number().finite().nonnegative().optional(),
    volume_m3: z.number().finite().nonnegative().optional(),
    weight_t: z.number().finite().nonnegative().optional(),
    peso_final_toneladas: z.number().finite().nonnegative().optional(),
    density_factor: z.number().finite().positive().max(25).optional(),
    tipo_granulometria: z.enum(['COLPAS', 'GRANSA', 'MIXTO', 'FINOS']).optional(),
    geometria: z.string().trim().max(80).optional(),
    peso_romana: z.number().finite().nonnegative().nullable().optional(),
    factor_real: z.number().finite().positive().max(25).optional(),
    copper_domain: CopperDomainSchema.optional(),
    moisture_pct: z.number().finite().min(0).max(100).nullable().optional(),
    tml_pct: z.number().finite().min(0).max(100).nullable().optional(),
    wet_weight_thm: z.number().finite().nonnegative().nullable().optional(),
    dry_weight_tms: z.number().finite().nonnegative().nullable().optional(),
    cu_total_pct: z.number().finite().min(0).max(100).nullable().optional(),
    cu_soluble_pct: z.number().finite().min(0).max(100).nullable().optional(),
    fine_cu_t: z.number().finite().nonnegative().nullable().optional(),
    residence_days: z.number().finite().nonnegative().nullable().optional(),
    copper_governance_alerts: z.array(CopperGovernanceAlertSchema).max(20).optional(),
    p80_mm: z.number().finite().nonnegative().nullable().optional(),
    rosin_rammler: RosinRammlerHitlSchema,
    mesh_url: z
        .string()
        .max(2048)
        .refine((val) => !val.startsWith('data:'), 'Prohibido Base64 en mesh_url')
        .nullable()
        .optional(),
    mesh_sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
        .optional(),
    tin_volume_m3: z.number().finite().nonnegative().nullable().optional(),
    lifecycle_status: AcopiosLifecycleStatusSchema.optional(),
    metrology_grade: AcopiosMetrologyGradeSchema.optional(),
    reconciliation_status: AcopiosReconciliationStatusSchema.optional(),
    active_volume_source: z.enum(['IN_SITU_OFFLINE', 'CLOUD_REFINED']).optional(),
    offline_in_situ_m3: z.number().finite().nonnegative().nullable().optional(),
    cloud_refined_m3: z.number().finite().nonnegative().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
});

const HitlDiffItemSchema = z.object({
    field: z.string().trim().min(1).max(120),
    current: z.string().max(1000),
    suggested: z.string().max(1000),
});

const HitlUpdateBodySchema = z.object({
    confirmationKeyword: z.literal('ACTUALIZAR'),
    patch: HitlPatchSchema,
    diffSummary: z.array(HitlDiffItemSchema).max(50).optional(),
});

function isInactiveMembershipStatus(status: unknown): boolean {
    const st = String(status || 'ACTIVE').trim().toUpperCase();
    return st === 'SUSPENDED' || st === 'REVOKED' || st === 'INACTIVE' || st === 'DELETED';
}

interface TenantDocAuthResult {
    authorized: boolean;
    status: number;
    error?: string;
    uid: string;
    emailLower: string;
    isSystemPrivileged: boolean;
}

interface CallerPrivilegeInfo {
    uid: string;
    emailLower: string;
    emailVerifiedOk: boolean;
    tokenRole: string;
    isDevRoot: boolean;
    isSuperAdmin: boolean;
}

function resolveCallerPrivilege(caller: Record<string, any> | undefined): CallerPrivilegeInfo {
    const safeCaller = caller || {};
    const uid = String(safeCaller.uid || '').trim();
    const emailLower = String(safeCaller.email || '').trim().toLowerCase();
    const emailVerifiedOk = safeCaller.email_verified !== false;
    const tokenRole = String(safeCaller.role || '').toUpperCase();

    const isDevRoot =
        safeCaller.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        uid === 'dev-master-root-uid' ||
        (emailVerifiedOk && emailLower === 'dev@minreport.com');

    const isSuperAdmin =
        !isDevRoot &&
        (safeCaller.admin === true ||
            tokenRole === 'SUPER_ADMIN' ||
            uid === 'super-admin-uid' ||
            (emailVerifiedOk &&
                (emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase() ||
                    emailLower === 'admin@minreport.com')));

    return {
        uid,
        emailLower,
        emailVerifiedOk,
        tokenRole,
        isDevRoot,
        isSuperAdmin,
    };
}

async function authorizeStockpileTenantMutation(
    req: AuthRequest,
    docTenantId: string
): Promise<TenantDocAuthResult> {
    const caller = req.user || {};
    const { uid, emailLower, tokenRole, isDevRoot, isSuperAdmin } = resolveCallerPrivilege(caller);

    if (!uid) {
        return {
            authorized: false,
            status: 401,
            error: 'No autorizado: token de sesion ausente.',
            uid: '',
            emailLower: '',
            isSystemPrivileged: false,
        };
    }

    if (!docTenantId || !TENANT_ID_REGEX.test(docTenantId)) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED: El acopio no posee un tenantId valido.',
            uid,
            emailLower,
            isSystemPrivileged: false,
        };
    }

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

    const userAccountDisabled =
        String(profileData?.status || '').toUpperCase() === 'SUSPENDED' ||
        String(profileData?.status || '').toUpperCase() === 'REVOKED';

    const isTestPilot =
        !isDevRoot &&
        !isSuperAdmin &&
        !userAccountDisabled &&
        (tokenRole === 'TEST_PILOT' || serverUserRole === 'TEST_PILOT');

    if (isTestPilot) {
        const candidateExpiry = caller.pilotExpiresAt ?? profileData?.pilotExpiresAt;
        let isExpiredPilot = evaluatePilotExpiration(candidateExpiry);
        if (!isExpiredPilot) {
            const pilotsSnap = await db
                .collection('test_pilots')
                .where('userId', '==', uid)
                .get()
                .catch(() => null);
            if (pilotsSnap && !pilotsSnap.empty) {
                const docs = pilotsSnap.docs.map((d) => d.data() || {});
                const activeDocs = docs.filter((p) => String(p.status || '').toUpperCase() === 'ACTIVE');
                if (activeDocs.length > 0 && activeDocs.every((p) => evaluatePilotExpiration(p.expiresAt))) {
                    isExpiredPilot = true;
                }
            }
        }
        if (isExpiredPilot) {
            return {
                authorized: false,
                status: 403,
                error: 'Cuenta 3o TEST-PILOT expirada.',
                uid,
                emailLower,
                isSystemPrivileged: false,
            };
        }
    }

    const isSystemPrivileged = isDevRoot || isSuperAdmin || isTestPilot;
    if (isSystemPrivileged) {
        return {
            authorized: true,
            status: 200,
            uid,
            emailLower,
            isSystemPrivileged: true,
        };
    }

    if (userAccountDisabled || docTenantId === 'dev-master-sandbox') {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            uid,
            emailLower,
            isSystemPrivileged: false,
        };
    }

    const headerAccountId = String(
        req.headers['x-active-account-id'] || req.headers['x-tenant-id'] || ''
    ).trim();
    if (headerAccountId && headerAccountId !== docTenantId) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED: Conflicto con cabecera de cuenta activa.',
            uid,
            emailLower,
            isSystemPrivileged: false,
        };
    }

    const accSnap = await db.collection('accounts').doc(docTenantId).get();
    if (!accSnap.exists) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            uid,
            emailLower,
            isSystemPrivileged: false,
        };
    }

    const accountData = accSnap.data() || {};
    const accountStatus = String(accountData.status || 'ACTIVE').toUpperCase();
    if (
        accountStatus === 'PENDING_APPROVAL' ||
        accountStatus === 'REJECTED' ||
        accountStatus === 'SUSPENDED'
    ) {
        return {
            authorized: false,
            status: 403,
            error: `CUENTA_${accountStatus}: La cuenta organizacional no esta habilitada.`,
            uid,
            emailLower,
            isSystemPrivileged: false,
        };
    }

    const isOwner = String(accountData.ownerId || '') === uid;
    const hasProfileMembership =
        Array.isArray(profileData?.memberships) &&
        profileData!.memberships.some(
            (m: any) => m?.accountId === docTenantId && !isInactiveMembershipStatus(m?.status)
        );

    let hasMemberDoc = false;
    if (!isOwner && !hasProfileMembership) {
        const memberSnap = await db
            .collection('accounts')
            .doc(docTenantId)
            .collection('members')
            .doc(uid)
            .get()
            .catch(() => null);
        if (memberSnap?.exists) {
            const mData = memberSnap.data() || {};
            hasMemberDoc = !isInactiveMembershipStatus(mData.status);
        }
    }

    if (!isOwner && !hasProfileMembership && !hasMemberDoc) {
        return {
            authorized: false,
            status: 403,
            error: 'TENANT_ACCESS_DENIED',
            uid,
            emailLower,
            isSystemPrivileged: false,
        };
    }

    return {
        authorized: true,
        status: 200,
        uid,
        emailLower,
        isSystemPrivileged: false,
    };
}

/**
 * POST /api/geolapp/stockpiles/:id/hitl-update
 * Mutación oficial HITL con confirmación obligatoria "ACTUALIZAR", validación Zod,
 * aislamiento multi-tenant estricto y registro inmutable en AuditLedger.
 */
router.post(
    '/stockpiles/:id/hitl-update',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const stockpileId = String(req.params.id || '').trim();
            if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
                return res.status(400).json({ error: 'Identificador de acopio invalido.' });
            }

            const parsedBody = HitlUpdateBodySchema.safeParse(req.body);
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload HITL invalido: requiere confirmationKeyword="ACTUALIZAR" y patch valido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const sanitizedPatch: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(parsedBody.data.patch)) {
                if (value !== undefined) {
                    sanitizedPatch[key] = value;
                }
            }

            if (Object.keys(sanitizedPatch).length === 0) {
                return res.status(400).json({
                    error: 'El bloque patch debe incluir al menos un campo tecnico valido.',
                });
            }

            const docRef = db.collection('stockpiles').doc(stockpileId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Acopio no encontrado.' });
            }

            const existingData = docSnap.data() || {};
            const docTenantId = String(existingData.tenantId || existingData.accountId || '').trim();
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);

            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const effectiveCopperDomain = String(
                sanitizedPatch.copper_domain ?? existingData.copper_domain ?? ''
            ).toUpperCase();
            const effectiveMoisture =
                typeof sanitizedPatch.moisture_pct === 'number'
                    ? sanitizedPatch.moisture_pct
                    : typeof existingData.moisture_pct === 'number'
                      ? existingData.moisture_pct
                      : null;
            const effectiveTml =
                typeof sanitizedPatch.tml_pct === 'number'
                    ? sanitizedPatch.tml_pct
                    : typeof existingData.tml_pct === 'number'
                      ? existingData.tml_pct
                      : null;

            const isClosingCycle = sanitizedPatch.status === 'CLOSED';
            const isReopeningCycle =
                existingData.status === 'CLOSED' && sanitizedPatch.status === 'ACTIVE';

            if (isClosingCycle) {
                if (sanitizedPatch.closure_origin !== 'MOBILE_FIELD') {
                    return res.status(403).json({
                        error: 'MOBILE_FIELD_ONLY_CLOSURE: El cierre de acopio solo puede ejecutarse en terreno desde la aplicación móvil MINREPORT.',
                    });
                }
                const effectiveReason = String(
                    sanitizedPatch.closure_reason || existingData.closure_reason || ''
                ).toUpperCase();
                if (effectiveReason === 'SHIPPED') {
                    const effectiveTransport = String(
                        sanitizedPatch.dispatch_transport ?? existingData.dispatch_transport ?? ''
                    ).trim();
                    const effectiveDestination = String(
                        sanitizedPatch.dispatch_destination ?? existingData.dispatch_destination ?? ''
                    ).trim();
                    const rawDispatchTs =
                        sanitizedPatch.dispatch_timestamp ?? existingData.dispatch_timestamp;
                    const effectiveDispatchTs =
                        typeof rawDispatchTs === 'number' &&
                        Number.isFinite(rawDispatchTs) &&
                        rawDispatchTs > 0
                            ? rawDispatchTs
                            : null;
                    if (effectiveTransport.length < 2) {
                        return res.status(400).json({
                            error: 'DISPATCH_TRANSPORT_REQUIRED: Debe indicar el transporte para cerrar por despacho.',
                        });
                    }
                    if (effectiveDestination.length < 2) {
                        return res.status(400).json({
                            error: 'DISPATCH_DESTINATION_REQUIRED: Debe indicar el destino para cerrar por despacho.',
                        });
                    }
                    if (!effectiveDispatchTs) {
                        return res.status(400).json({
                            error: 'DISPATCH_TIMESTAMP_REQUIRED: Debe indicar fecha y hora válidas de despacho.',
                        });
                    }
                }
                if (effectiveReason === 'FIELD_REMOVED') {
                    const effectiveCause = String(sanitizedPatch.closure_cause ?? '').trim();
                    if (effectiveCause.length < 3) {
                        return res.status(400).json({
                            error: 'CLOSURE_CAUSE_REQUIRED: Debe indicar la causa de eliminación en terreno (mínimo 3 caracteres).',
                        });
                    }
                }
            }

            if (isReopeningCycle && sanitizedPatch.closure_origin !== 'MOBILE_FIELD') {
                return res.status(403).json({
                    error: 'MOBILE_FIELD_ONLY_REOPEN: La reapertura del ciclo solo puede ejecutarse desde la aplicación móvil MINREPORT.',
                });
            }

            if (
                sanitizedPatch.status === 'CLOSED' &&
                sanitizedPatch.closure_reason === 'SHIPPED' &&
                effectiveCopperDomain === 'CONCENTRADO_CU' &&
                effectiveMoisture !== null &&
                effectiveTml !== null &&
                effectiveMoisture >= effectiveTml
            ) {
                return res.status(422).json({
                    error: 'IMSBC_TML_BLOCK: Humedad >= TML impide cerrar por embarque concentrado de cobre.',
                });
            }

            const now = Date.now();
            const updatePayload: Record<string, unknown> = {
                ...sanitizedPatch,
                ...(isReopeningCycle
                    ? {
                          closure_cause: null,
                          closure_origin: null,
                          dispatch_reference: null,
                          dispatch_transport: null,
                          dispatch_destination: null,
                          dispatch_timestamp: null,
                          shipped_weight_t: null,
                      }
                    : {}),
                updatedAt: now,
                lastHitlUpdatedBy: authz.uid,
                lastHitlUpdatedAt: now,
            };

            await docRef.set(updatePayload, { merge: true });

            const updatedAsset = {
                ...existingData,
                ...updatePayload,
                id: stockpileId,
                tenantId: docTenantId,
                accountId: docTenantId,
            };

            const auditAction =
                existingData.status !== 'CLOSED' && sanitizedPatch.status === 'CLOSED'
                    ? 'STOCKPILE_CYCLE_CLOSED'
                    : existingData.status === 'CLOSED' && sanitizedPatch.status === 'ACTIVE'
                      ? 'STOCKPILE_CYCLE_REOPENED'
                      : 'GEOLAPP_HITL_UPDATE';

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: auditAction,
                module: 'stockpile',
                targetEntity: stockpileId,
                details: {
                    hitlConfirmed: true,
                    confirmationKeyword: parsedBody.data.confirmationKeyword,
                    patchedFields: Object.keys(sanitizedPatch),
                    diffSummary: parsedBody.data.diffSummary || [],
                    ...(sanitizedPatch.closure_reason
                        ? { closureReason: sanitizedPatch.closure_reason }
                        : {}),
                    ...(sanitizedPatch.closure_cause
                        ? { closureCause: sanitizedPatch.closure_cause }
                        : {}),
                    ...(sanitizedPatch.closure_origin
                        ? { closureOrigin: sanitizedPatch.closure_origin }
                        : {}),
                    ...(sanitizedPatch.dispatch_reference
                        ? { dispatchReference: sanitizedPatch.dispatch_reference }
                        : {}),
                    ...(sanitizedPatch.dispatch_transport
                        ? { dispatchTransport: sanitizedPatch.dispatch_transport }
                        : {}),
                    ...(sanitizedPatch.dispatch_destination
                        ? { dispatchDestination: sanitizedPatch.dispatch_destination }
                        : {}),
                    ...(typeof sanitizedPatch.dispatch_timestamp === 'number'
                        ? { dispatchTimestamp: sanitizedPatch.dispatch_timestamp }
                        : {}),
                },
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                success: true,
                asset: updatedAsset,
            });
        } catch (error) {
            console.error('[GEOLAPP-CONTROLLER] Error en hitl-update:', error);
            return res.status(500).json({ error: 'Error interno procesando actualizacion HITL.' });
        }
    }
);

const Reconstruct3dBodySchema = z.object({
    measurementId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{1,128}$/)
        .optional(),
    geometryType: z.string().trim().min(1).max(80).optional(),
    dimensions: z.record(z.union([z.number().finite(), z.null(), z.undefined()])).optional(),
    profileSamples: z.array(z.number().finite().nonnegative()).max(512).optional(),
    photoUrls: z
        .array(
            z
                .string()
                .trim()
                .max(2048)
                .refine((val) => !val.startsWith('data:'), 'Prohibido Base64 en photoUrls')
        )
        .max(24)
        .optional(),
});

const KNOWN_DIMENSION_KEYS = [
    'd1',
    'd2',
    'd1p',
    'd2p',
    'a',
    'b',
    'ap',
    'bp',
    'h',
    'p',
    'P',
    'pp',
    'Pp',
    'baseLengthM',
    'base_length_m',
    'baseWidthM',
    'base_width_m',
    'crestLengthM',
    'crest_length_m',
    'crestWidthM',
    'crest_width_m',
    'topLengthM',
    'topWidthM',
    'heightM',
    'height_m',
    'lengthM',
    'length_m',
    'widthM',
    'wallLengthM',
    'widthFromWallM',
    'width_from_wall_m',
    'wallWidthM',
    'heightAtWallM',
    'height_at_wall_m',
    'wallAngleDeg',
    'wall_angle_deg',
    'perimeterBaseM',
    'perimeterTopM',
];

function extractDeclaredDimensions(
    primary: Record<string, number | null | undefined> | undefined,
    ...fallbacks: Array<Record<string, any> | undefined>
): Record<string, number | null | undefined> {
    const merged: Record<string, number | null | undefined> = {};

    for (const source of [...fallbacks].reverse()) {
        if (!source || typeof source !== 'object') continue;
        const dimObj =
            source.dimensions && typeof source.dimensions === 'object'
                ? source.dimensions
                : source;
        for (const [k, v] of Object.entries(dimObj)) {
            if (typeof v === 'number' && Number.isFinite(v)) {
                merged[k] = v;
            }
        }
        for (const key of KNOWN_DIMENSION_KEYS) {
            const val = source[key];
            if (typeof val === 'number' && Number.isFinite(val)) {
                merged[key] = val;
            }
        }
    }

    if (primary && typeof primary === 'object') {
        for (const [k, v] of Object.entries(primary)) {
            if (typeof v === 'number' && Number.isFinite(v)) {
                merged[k] = v;
            }
        }
    }

    return merged;
}

export function validateSovereignMast3rGpuUrl(rawUrl: string): URL {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('GEOLAPP_MAST3R_GPU_URL debe usar HTTPS sin credenciales.');
    }
    if (/(drive|colab|notebooklm|ngrok|localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|metadata\.google)/i.test(host)) {
        throw new Error('GEOLAPP_MAST3R_GPU_URL bloqueada: servicio externo no soberano.');
    }

    const isSovereignCloudRunSantiago =
        host.endsWith('.run.app') &&
        (host.includes('southamerica-west1') || host.endsWith('-tl.a.run.app'));

    const isSovereignComputeOrVpcSantiago =
        host.includes('southamerica-west1') &&
        (host.endsWith('.internal') ||
            host.endsWith('.googleapis.com') ||
            host.endsWith('.cloudfunctions.net') ||
            host.endsWith('.googleusercontent.com') ||
            host.endsWith('.minreport.com') ||
            host.endsWith('.minreport.cl') ||
            host.endsWith('.minreport.app'));

    if (!isSovereignCloudRunSantiago && !isSovereignComputeOrVpcSantiago) {
        throw new Error(
            'GEOLAPP_MAST3R_GPU_URL debe residir exclusivamente en southamerica-west1 (Cloud Run, Compute Engine o VPC interno).'
        );
    }
    return parsed;
}

/**
 * POST /api/geolapp/stockpiles/:id/reconstruct-3d
 * Reconstruye o genera determinísticamente un gemelo digital 3D glTF 2.0 (`.glb`),
 * lo ingesta mediante MediaDigestorServer (`MESH_3D_GLB`) + CasStorageService (`TENANT_PRIVATE`)
 * y consolida trazabilidad completa en Firestore + AuditLedger.
 */
export async function postGeolappReconstruct3d(req: AuthRequest, res: Response) {
    try {
        const stockpileId = String(req.params.id || '').trim();
        if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
            return res.status(400).json({ error: 'Identificador de acopio invalido.' });
        }

        const parsedBody = Reconstruct3dBodySchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({
                error: 'Parametros de reconstruccion 3D invalidos.',
                details: parsedBody.error.flatten(),
            });
        }

        const docRef = db.collection('stockpiles').doc(stockpileId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Acopio no encontrado.' });
        }

        const existingData = docSnap.data() || {};
        const docTenantId = String(existingData.tenantId || existingData.accountId || '').trim();
        if (!docTenantId) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED: Acopio sin tenantId.' });
        }

        const scopedCtx = (req as ScopedRequest).opermaqContext;
        if (
            scopedCtx &&
            scopedCtx.accountTier > 2 &&
            scopedCtx.tenantId &&
            scopedCtx.tenantId !== docTenantId
        ) {
            return res.status(403).json({
                error: 'TENANT_ACCESS_DENIED: El acopio pertenece a otro tenant.',
            });
        }

        const authz = await authorizeStockpileTenantMutation(req, docTenantId);
        if (!authz.authorized) {
            return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
        }

        const { measurementId, photoUrls, profileSamples } = parsedBody.data;
        let measurementData: Record<string, any> | undefined;
        if (measurementId) {
            const mSnap = await docRef
                .collection('measurements')
                .doc(measurementId)
                .get()
                .catch(() => null);
            if (mSnap?.exists) {
                measurementData = mSnap.data() || {};
            }
        }

        const geometryType = String(
            parsedBody.data.geometryType ||
                measurementData?.geometryType ||
                measurementData?.geometria ||
                existingData.last_geometry_type ||
                existingData.geometria ||
                ''
        ).trim();

        const dimensions = extractDeclaredDimensions(
            parsedBody.data.dimensions,
            measurementData,
            existingData
        );

        let meshResult: GlbSurfaceBuildResult | null = null;
        let meshSource: 'MAST3R_GPU_SOUTH_AMERICA_WEST1' = 'MAST3R_GPU_SOUTH_AMERICA_WEST1';

        const configuredGpuUrl = String(process.env.GEOLAPP_MAST3R_GPU_URL || '').trim();
        if (configuredGpuUrl) {
            let gpuUrl: URL;
            try {
                gpuUrl = validateSovereignMast3rGpuUrl(configuredGpuUrl);
            } catch (err: any) {
                return res.status(403).json({
                    error: `SOVEREIGN_REGION_VIOLATION: ${err?.message || 'Endpoint GPU no autorizado.'}`,
                });
            }

            try {
                const gpuResponse = await safeFetchExternal(gpuUrl.toString(), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'model/gltf-binary, application/octet-stream',
                    },
                    body: JSON.stringify({
                        stockpileId,
                        measurementId: measurementId || null,
                        tenantId: docTenantId,
                        geometryType,
                        dimensions,
                        profileSamples: profileSamples || [],
                        photoUrls: photoUrls || [],
                    }),
                    timeoutMs: 25000,
                    maxBytes: 30 * 1024 * 1024,
                });

                if (gpuResponse.ok) {
                    const gpuBuffer = Buffer.from(await gpuResponse.arrayBuffer());
                    if (
                        gpuBuffer.length >= 28 &&
                        gpuBuffer.readUInt32LE(0) === 0x46546c67 &&
                        gpuBuffer.readUInt32LE(4) === 2
                    ) {
                        meshResult = inspectGlbBinaryMetrics(gpuBuffer);
                        meshSource = 'MAST3R_GPU_SOUTH_AMERICA_WEST1';
                    }
                }
            } catch (gpuError) {
                console.warn(
                    '[GEOLAPP-3D] Reconstruccion GPU no disponible (prohibido fallback a cono sintetico):',
                    (gpuError as Error)?.message
                );
            }
        }

        if (!meshResult) {
            return res.status(422).json({
                error: 'NO_REAL_3D_RECONSTRUCTION_AVAILABLE',
                message:
                    'No existe reconstrucción 3D real disponible en southamerica-west1. Prohibido sustituir con malla paramétrica sintética.',
            });
        }

        const digested = await MediaDigestorServer.digestAny(
            meshResult.glbBuffer,
            'model/gltf-binary',
            'MESH_3D_GLB'
        );

        const descriptor = await CasStorageService.persistDigestedBinary(digested, {
            scope: 'TENANT_PRIVATE',
            tenantId: docTenantId,
            actorUid: authz.uid,
            originalFilename: `${stockpileId}_${measurementId || 'latest'}.glb`,
            clientOriginalBytes: meshResult.rawUnindexedBytes,
        });

        const savingsPct =
            typeof descriptor.savingsPct === 'number'
                ? descriptor.savingsPct
                : Number((descriptor.savingsRatio * 100).toFixed(1));

        const now = Date.now();
        const meshPersistencePayload: Record<string, unknown> = {
            mesh_url: descriptor.downloadUrl,
            mesh_sha256: descriptor.sha256,
            tin_volume_m3: meshResult.tinVolumeM3,
            mesh_original_bytes: descriptor.originalBytes,
            mesh_optimized_bytes: descriptor.optimizedBytes,
            mesh_savings_pct: savingsPct,
            mesh_source: meshSource,
            mesh_vertex_count: meshResult.vertexCount,
            mesh_triangle_count: meshResult.triangleCount,
            mesh_surface_area_m2: meshResult.surfaceAreaM2,
            mesh_bounding_box_m: meshResult.boundingBoxM,
            mesh_reconstructed_at: now,
            updatedAt: now,
        };

        await docRef.set(meshPersistencePayload, { merge: true });
        if (measurementId) {
            await docRef
                .collection('measurements')
                .doc(measurementId)
                .set(meshPersistencePayload, { merge: true });
        }

        await AuditLedger.record({
            tenantId: docTenantId,
            actorUid: authz.uid,
            actorEmail: authz.emailLower || authz.uid,
            action: 'STOCKPILE_3D_GLB_RECONSTRUCTED',
            module: 'stockpile',
            targetEntity: measurementId ? `${stockpileId}/measurements/${measurementId}` : stockpileId,
            details: {
                stockpileId,
                measurementId: measurementId || null,
                geometryType,
                meshSource,
                meshSha256: descriptor.sha256,
                meshUrl: descriptor.downloadUrl,
                tinVolumeM3: meshResult.tinVolumeM3,
                surfaceAreaM2: meshResult.surfaceAreaM2,
                vertexCount: meshResult.vertexCount,
                triangleCount: meshResult.triangleCount,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsPct,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            stockpileId,
            measurementId: measurementId || null,
            meshUrl: descriptor.downloadUrl,
            sha256: descriptor.sha256,
            tinVolumeM3: meshResult.tinVolumeM3,
            surfaceAreaM2: meshResult.surfaceAreaM2,
            vertexCount: meshResult.vertexCount,
            triangleCount: meshResult.triangleCount,
            boundingBoxM: meshResult.boundingBoxM,
            originalBytes: descriptor.originalBytes,
            optimizedBytes: descriptor.optimizedBytes,
            savingsPct,
            source: meshSource,
        });
    } catch (error) {
        console.error('[GEOLAPP-CONTROLLER] Error en reconstruct-3d:', error);
        return res.status(500).json({ error: 'Error interno reconstruyendo gemelo digital 3D .glb.' });
    }
}

const StaticMapRequestBodySchema = z.object({
    latitude: z.number().finite().min(-85).max(85).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    zoom: z.number().int().min(12).max(20).optional(),
});

/**
 * POST /api/geolapp/stockpiles/:id/static-map
 * Descarga server-side una imagen satelital estática (sin interacción cliente) leyendo
 * el secreto en Cloud Secret Manager y la consolida una sola vez en CAS (SHA-256).
 */
router.post(
    '/stockpiles/:id/static-map',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const stockpileId = String(req.params.id || '').trim();
            if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
                return res.status(400).json({ error: 'Identificador de acopio invalido.' });
            }

            const parsedBody = StaticMapRequestBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Parametros geograficos invalidos para mapa satelital estatico.',
                    details: parsedBody.error.flatten(),
                });
            }

            const docRef = db.collection('stockpiles').doc(stockpileId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Acopio no encontrado.' });
            }

            const existingData = (docSnap.data() || {}) as Record<string, any>;
            const docTenantId = String(
                existingData.tenantId || existingData.accountId || ''
            ).trim();
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const latitude =
                typeof parsedBody.data.latitude === 'number'
                    ? parsedBody.data.latitude
                    : Number(existingData.geo_point?.latitude ?? existingData.location?.lat);
            const longitude =
                typeof parsedBody.data.longitude === 'number'
                    ? parsedBody.data.longitude
                    : Number(existingData.geo_point?.longitude ?? existingData.location?.lng);

            if (!isValidStaticMapCoordinatePair(latitude, longitude)) {
                return res.status(400).json({
                    error: 'INVALID_COORDINATES: Coordenadas GNSS validas requeridas (distintas de 0,0).',
                });
            }

            if (
                typeof existingData.static_map_url === 'string' &&
                existingData.static_map_url.trim().length > 0 &&
                !existingData.static_map_url.startsWith('data:')
            ) {
                return res.status(200).json({
                    ok: true,
                    available: true,
                    staticMapUrl: existingData.static_map_url,
                    sha256: existingData.static_map_sha256 || undefined,
                    originalBytes: existingData.static_map_original_bytes ?? undefined,
                    optimizedBytes: existingData.static_map_optimized_bytes ?? undefined,
                    savingsPct: existingData.static_map_savings_pct ?? undefined,
                });
            }

            const result = await generateAndStoreStaticSatelliteMap({
                stockpileId,
                tenantId: docTenantId,
                actorUid: authz.uid,
                latitude,
                longitude,
                zoom: parsedBody.data.zoom,
            });

            if (result.available && result.staticMapUrl) {
                await docRef.set(
                    {
                        static_map_url: result.staticMapUrl,
                        ...(result.sha256 ? { static_map_sha256: result.sha256 } : {}),
                        ...(result.originalBytes !== undefined
                            ? { static_map_original_bytes: result.originalBytes }
                            : {}),
                        ...(result.optimizedBytes !== undefined
                            ? { static_map_optimized_bytes: result.optimizedBytes }
                            : {}),
                        ...(result.savingsPct !== undefined
                            ? { static_map_savings_pct: result.savingsPct }
                            : {}),
                        updatedAt: Date.now(),
                    },
                    { merge: true }
                );
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error('[GEOLAPP-CONTROLLER] Error generando static-map:', error);
            return res.status(500).json({ error: 'Error interno generando mapa satelital estatico.' });
        }
    }
);

const STOCKPILE_CLASSIFICATION_QUESTIONS = {
    is_stockpile_scene: {
        type: 'choice' as const,
        instructions: 'Indica si la escena corresponde realmente a un acopio de material granular/mineral/árido o a un objeto ajeno.',
        criteria: {
            ACOPIO_MINERAL_ARIDO: 'Montículo o acopio real de mineral, concentrado, ripio o áridos en cancha o bunker',
            NO_ES_ACOPIO: 'Objeto ajeno, caja, habitación, suelo plano sin pila o equipamiento sin acopio',
        },
    },
    geometry_type: {
        type: 'choice' as const,
        instructions: 'Identifica la forma geométrica dominante del acopio fotografiado o si no corresponde a un acopio minero/árido.',
        criteria: {
            CONO_ELIPTICO: 'Pila cónica con vértice agudo y huella circular o elíptica libre',
            CONO_ELIPTICO_TRUNCADO: 'Pila cónica o botadero con plataforma superior plana horizontal',
            PILA_LONGITUDINAL_WINDROW: 'Cordón o camellón alargado lineal con cabeceras redondeadas',
            ACOPIO_CONTRA_MURO: 'Acopio descargado contra muro de contención o pared trasera/bunker',
            INDETERMINADO: 'Objeto pequeño, caja, equipo, suelo vacío o escena que no corresponde a un acopio minero/árido',
        },
    },
    wall_confinement: {
        type: 'choice' as const,
        instructions: 'Si apoya contra muro, indica si es abierto en los extremos (1 muro) o bunker cerrado (3 muros).',
        criteria: {
            NONE: 'Acopio exento sin muros de contención',
            SINGLE_WALL: 'Apoyado contra 1 muro trasero con extremos laterales libres',
            BUNKER_3_WALLS: 'Confinado lateralmente dentro de bunker/cajón de 3 muros',
        },
    },
    tipo_granulometria: {
        type: 'choice' as const,
        instructions: 'Clasifica la granulometría visual dominante del material.',
        criteria: {
            COLPAS: 'Bloques y fragmentos gruesos predominantes (> 150 mm)',
            GRANSA: 'Material chancado intermedio uniforme',
            MIXTO: 'Mezcla heterogénea de colpas, gransa y finos',
            FINOS: 'Material fino arenoso o concentrado (< 12 mm)',
        },
    },
};

const TENANT_CAS_PHOTO_URL_REGEX =
    /^\/api\/media\/blob\/tenant\/([A-Za-z0-9._-]+)\/([a-f0-9]{64})\.(webp|jpg|jpeg|png)$/i;

export async function collectVisualMediaParts(params: {
    tenantId?: string;
    imageBase64?: string;
    imageMimeType?: string;
    extraImagesBase64?: string[];
    photoUrl?: string;
    maxExtra?: number;
}): Promise<Array<{ mimeType: string; dataBase64: string }>> {
    const mediaParts: Array<{ mimeType: string; dataBase64: string }> = [];

    if (params.imageBase64) {
        mediaParts.push({
            mimeType: params.imageMimeType || 'image/webp',
            dataBase64: params.imageBase64,
        });
    } else if (params.photoUrl) {
        const cleanUrl = params.photoUrl.trim();
        const casMatch = TENANT_CAS_PHOTO_URL_REGEX.exec(cleanUrl);
        if (casMatch) {
            const [, urlTenantId, sha256, ext] = casMatch;
            const requestedTenant = String(params.tenantId || '').trim();
            // Aislamiento multi-tenant estricto: solo leer blobs CAS del propio tenant autorizado
            if (requestedTenant && urlTenantId === requestedTenant) {
                try {
                    const storagePath = CasStorageService.buildStoragePath(
                        'TENANT_PRIVATE',
                        sha256.toLowerCase(),
                        ext.toLowerCase(),
                        requestedTenant
                    );
                    const blob = await CasStorageService.readCasBlob(storagePath, {
                        scope: 'TENANT_PRIVATE',
                        tenantId: requestedTenant,
                    });
                    if (blob && blob.buffer.length > 0 && blob.buffer.length <= 4 * 1024 * 1024) {
                        mediaParts.push({
                            mimeType:
                                blob.contentType && blob.contentType.startsWith('image/')
                                    ? blob.contentType
                                    : ext.toLowerCase() === 'png'
                                      ? 'image/png'
                                      : ext.toLowerCase() === 'webp'
                                        ? 'image/webp'
                                        : 'image/jpeg',
                            dataBase64: blob.buffer.toString('base64'),
                        });
                    }
                } catch {
                    // Continuar con manejo controlado si el blob CAS no está accesible
                }
            }
        } else if (
            /^https:\/\/(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\//i.test(cleanUrl)
        ) {
            try {
                const imgRes = await safeFetchExternal(cleanUrl, {
                    method: 'GET',
                    maxBytes: 4 * 1024 * 1024,
                });
                if (imgRes.ok) {
                    const arr = Buffer.from(await imgRes.arrayBuffer());
                    mediaParts.push({
                        mimeType: imgRes.headers.get('content-type') || 'image/webp',
                        dataBase64: arr.toString('base64'),
                    });
                }
            } catch {
                // Continuar con manejo controlado si no fue descargable
            }
        }
    }

    if (Array.isArray(params.extraImagesBase64)) {
        for (const extra of params.extraImagesBase64.slice(0, params.maxExtra ?? 3)) {
            mediaParts.push({ mimeType: 'image/webp', dataBase64: extra });
        }
    }

    return mediaParts;
}

function estimateReferenceDensityByGranulometry(
    granulometry: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null | undefined,
    isNonStockpile?: boolean
): number | null {
    if (isNonStockpile || !granulometry) return null;
    switch (granulometry) {
        case 'COLPAS':
            return 1.55;
        case 'GRANSA':
            return 1.65;
        case 'MIXTO':
            return 1.75;
        case 'FINOS':
            return 1.9;
        default:
            return null;
    }
}

function parseStockpileDecisionChoices(decisionRes: any) {
    const rawGeomChoice =
        decisionRes?.answers?.geometry_type?.type === 'choice'
            ? decisionRes.answers.geometry_type.choice
            : 'CONO_ELIPTICO';
    const rawSceneChoice =
        decisionRes?.answers?.is_stockpile_scene?.type === 'choice'
            ? decisionRes.answers.is_stockpile_scene.choice
            : null;
    const legacyNoAcopioChoice =
        decisionRes?.answers?.copper_domain?.type === 'choice' &&
        decisionRes.answers.copper_domain.choice === 'NO_ES_ACOPIO' &&
        decisionRes.answers.copper_domain.confidence >= 0.45;

    const isNonStockpile =
        rawGeomChoice === 'INDETERMINADO' ||
        rawSceneChoice === 'NO_ES_ACOPIO' ||
        legacyNoAcopioChoice;

    const geometryType = (
        isNonStockpile
            ? 'INDETERMINADO'
            : [
                    'CONO_ELIPTICO',
                    'CONO_ELIPTICO_TRUNCADO',
                    'PILA_LONGITUDINAL_WINDROW',
                    'ACOPIO_CONTRA_MURO',
                ].includes(rawGeomChoice)
              ? rawGeomChoice
              : 'CONO_ELIPTICO'
    ) as
        | 'CONO_ELIPTICO'
        | 'CONO_ELIPTICO_TRUNCADO'
        | 'PILA_LONGITUDINAL_WINDROW'
        | 'ACOPIO_CONTRA_MURO'
        | 'INDETERMINADO';

    const rawWallChoice =
        decisionRes?.answers?.wall_confinement?.type === 'choice'
            ? decisionRes.answers.wall_confinement.choice
            : 'NONE';
    const wallConfinement = (
        isNonStockpile
            ? 'NONE'
            : ['NONE', 'SINGLE_WALL', 'BUNKER_3_WALLS'].includes(rawWallChoice)
              ? rawWallChoice
              : geometryType === 'ACOPIO_CONTRA_MURO'
                ? 'SINGLE_WALL'
                : 'NONE'
    ) as 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';

    const aiSuggestedGranulometry = isNonStockpile
        ? null
        : decisionRes?.answers?.tipo_granulometria?.type === 'choice' &&
            decisionRes.answers.tipo_granulometria.confidence >= 0.55
          ? decisionRes.answers.tipo_granulometria.choice
          : null;

    return {
        geometryType,
        wallConfinement,
        copperDomain: null,
        granulometry: null,
        aiSuggestedGranulometry,
        isNonStockpile,
    };
}

const DeviceCompatibilityCheckBodySchema = z.object({
    query: z.string().trim().min(2).max(120),
    forceRefresh: z.boolean().optional().default(false),
});

/**
 * GET /api/geolapp/device-compatibility
 * Retorna exclusivamente los dispositivos consultados on-demand y persistidos en `device_compatibility_registry`
 * (`southamerica-west1`). Cero listados predefinidos.
 */
async function handleListDeviceCompatibility(_req: AuthRequest, res: Response) {
    try {
        const registry = await listRegisteredDeviceCompatibility();
        return res.status(200).json({
            success: true,
            registry,
            catalog: registry,
        });
    } catch (error) {
        console.error('[MINREPORT-ACOPIOS] Error consultando device-compatibility:', error);
        return res.status(500).json({ error: 'Error consultando registro de compatibilidad.' });
    }
}

router.get('/device-compatibility', requireAuth, handleListDeviceCompatibility);

/**
 * POST /api/geolapp/device-compatibility/check
 * Motor On-Demand de compatibilidad móvil:
 * - Si el modelo ya fue consultado y persistido (`!forceRefresh`), responde en caché sin gastar búsqueda/IA.
 * - Si no existe en BD, evalúa con Gemini Grounded + Zod, calcula veredicto determinísticamente en servidor
 *   y persiste en `device_compatibility_registry` (`southamerica-west1`) + `AuditLedger`.
 */
async function handleCheckDeviceCompatibility(req: AuthRequest, res: Response) {
    try {
        const parsedBody = DeviceCompatibilityCheckBodySchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({
                error: 'Modelo inválido: ingrese entre 2 y 120 caracteres.',
                details: parsedBody.error.flatten(),
            });
        }

        const privilege = resolveCallerPrivilege(req.user);
        if (!privilege.uid) {
            return res.status(401).json({ error: 'No autorizado: sesion requerida.' });
        }

        const result = await checkDeviceCompatibilityOnDemand({
            query: parsedBody.data.query,
            forceRefresh: parsedBody.data.forceRefresh,
            actor: {
                uid: privilege.uid,
                email: privilege.emailLower || privilege.uid,
                tenantId: 'global',
                ipAddress: extractClientIp(req),
            },
        });

        return res.status(200).json({
            success: true,
            device: result.device,
            cached: result.cached,
            registry: result.registry,
        });
    } catch (error: any) {
        if (error instanceof DeviceCompatibilityValidationError) {
            return res.status(error.statusCode).json({
                error: error.message,
                code: error.code,
            });
        }
        if (error instanceof UngroundedEvidenceError) {
            return res.status(422).json({
                error: error.message,
                code: error.code,
            });
        }
        if (error instanceof AISwarmUnavailableError) {
            return res.status(503).json({ error: error.message });
        }
        console.error('[MINREPORT-ACOPIOS] Error verificando compatibilidad de dispositivo:', error);
        return res.status(500).json({ error: 'Error evaluando compatibilidad del dispositivo.' });
    }
}

router.post('/device-compatibility/check', requireAuth, aiRateLimiter, handleCheckDeviceCompatibility);

const SpatialPointTupleSchema = z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
]);

const SpatialAnalyzeBodySchema = z.object({
    measurementId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{1,128}$/)
        .optional(),
    tenantId: z.string().trim().max(128).optional(),
    scanId: z.string().trim().max(128).optional(),
    depthMode: z.enum(['RAW_DEPTH_ONLY', 'AUTOMATIC', 'VIO_POINTCLOUD']),
    coveragePct: z.number().finite().min(0).max(100),
    sectorsCovered: z.number().int().min(0).max(32),
    sectorsTotal: z.number().int().min(1).max(32).optional(),
    roiRadiusM: z.number().finite().positive().max(100).optional(),
    calibrationScaleFactor: z.number().finite().min(0.85).max(1.15).optional(),
    calibrationId: z.string().trim().max(128).optional(),
    calibrationPlaneNoiseRmsM: z.number().finite().nonnegative().max(1).optional(),
    deviceCalibratedAt: z.number().finite().nonnegative().optional(),
    keyframeCount: z.number().int().min(1).max(512),
    loopClosed: z.boolean(),
    anchorCenter: z
        .object({
            x: z.number().finite(),
            y: z.number().finite(),
            z: z.number().finite(),
        })
        .nullable()
        .optional(),
    pointsM: z.array(SpatialPointTupleSchema).min(20).max(20000),
    groundSamplesM: z.array(SpatialPointTupleSchema).max(4000).optional(),
    walkRingPoses: z.array(WalkRingPoseSchema).max(1024).optional(),
    wallConfinement: WallConfinementModeSchema.optional(),
    loopDriftPct: z.number().finite().min(0).max(100).optional(),
    hasScaleAnchor: z.boolean().optional(),
    crestClippedRatio: z.number().finite().min(0).max(1).optional(),
    imageBase64: z.string().min(8).max(4_000_000).optional(),
    imageMimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
    extraImagesBase64: z.array(z.string().min(8).max(4_000_000)).max(5).optional(),
    photoUrl: z.string().trim().max(2048).optional(),
    locale: z.enum(['es', 'en', 'pt']).optional().default('es'),
});

const DeviceCalibrationBodySchema = z.object({
    scaleFactor: z.number().finite().min(0.85).max(1.15),
    referenceDistanceM: z.number().finite().positive().max(50),
    measuredDistanceM: z.number().finite().positive().max(50),
    planeNoiseRmsM: z.number().finite().nonnegative().max(1),
    imuPitchOffsetDeg: z.number().finite().min(-90).max(90),
    imuRollOffsetDeg: z.number().finite().min(-180).max(180),
    calibratedAt: z.number().finite().nonnegative(),
    tenantId: z.string().trim().max(128).optional(),
    deviceModel: z.string().trim().max(120).optional(),
    platform: z.string().trim().max(32).optional(),
});

function resolveScopedTenantId(req: AuthRequest, bodyTenantId?: string): string {
    const isDevCaller = resolveCallerPrivilege(req.user).isDevRoot;
    return String(
        bodyTenantId ||
            req.headers['x-active-account-id'] ||
            req.headers['x-tenant-id'] ||
            (isDevCaller ? 'dev-master-sandbox' : '')
    ).trim();
}

async function runSpatialStockpileAnalyze(params: {
    tenantId: string;
    actorUid: string;
    stockpileId?: string;
    body: z.infer<typeof SpatialAnalyzeBodySchema>;
}) {
    const { tenantId, actorUid, stockpileId, body } = params;

    const spatial = computeSpatialStockpileVolume({
        pointsM: body.pointsM,
        groundSamplesM: body.groundSamplesM,
        walkRingPoses: body.walkRingPoses,
        wallConfinement: body.wallConfinement,
        anchorCenter: body.anchorCenter,
        coveragePct: body.coveragePct,
        sectorsCovered: body.sectorsCovered,
        sectorsTotal: body.sectorsTotal,
        roiRadiusM: body.roiRadiusM,
        calibrationScaleFactor: body.calibrationScaleFactor,
        calibrationId: body.calibrationId,
        calibrationPlaneNoiseRmsM: body.calibrationPlaneNoiseRmsM,
        deviceCalibratedAt: body.deviceCalibratedAt,
        loopClosed: body.loopClosed,
        loopDriftPct: body.loopDriftPct,
        hasScaleAnchor: body.hasScaleAnchor,
        crestClippedRatio: body.crestClippedRatio,
        depthMode: body.depthMode,
    });

    if (!(spatial.volumeM3 > 0)) {
        throw new SpatialVolumeValidationError(
            'El volumen cubicado desde la nube 3D debe ser > 0 m3.',
            'INVALID_POINT_CLOUD'
        );
    }

    const meshResult = buildSpatialPointCloudGlbMesh(spatial.surfaceGrid);
    const meshSource = 'ARCORE_VIO_DEPTH_SOUTH_AMERICA_WEST1' as const;

    const persistMeshPromise = (async () => {
        const digested = await MediaDigestorServer.digestAny(
            meshResult.glbBuffer,
            'model/gltf-binary',
            'MESH_3D_GLB'
        );
        return CasStorageService.persistDigestedBinary(digested, {
            scope: 'TENANT_PRIVATE',
            tenantId,
            actorUid,
            originalFilename: `${stockpileId || body.scanId || 'spatial'}_${body.measurementId || 'latest'}.glb`,
            clientOriginalBytes: meshResult.rawUnindexedBytes,
        });
    })();

    const visualClassifyPromise = (async () => {
        const mediaParts = await collectVisualMediaParts({
            tenantId,
            imageBase64: body.imageBase64,
            imageMimeType: body.imageMimeType,
            extraImagesBase64: body.extraImagesBase64,
            photoUrl: body.photoUrl,
            maxExtra: 5,
        });

        if (mediaParts.length === 0) {
            return {
                geometryType: 'CONO_ELIPTICO' as const,
                wallConfinement: 'NONE' as const,
                copperDomain: null,
                granulometry: null,
                aiSuggestedGranulometry: null,
                isNonStockpile: false,
                suggestedDensityTm3: null,
                reasoning: `Cubicación métrica 3D (${body.depthMode}, cobertura ${body.coveragePct}%, pie ${spatial.toeScore}/100).`,
            };
        }

        const contextLines = [
            `Dimensiones métricas reales de nube 3D: a=${spatial.dimensionsM.a}m, b=${spatial.dimensionsM.b}m, h=${spatial.dimensionsM.h}m`,
            `Volumen 3D ya calculado (NO modificar): ${spatial.volumeM3} m3`,
            `Talud medio medido: ${spatial.slopeAngleAvgDeg ?? 'N/A'}°`,
        ].join('\n');

        const decisionRes = await ResilientAIClient.decide({
            module: 'stockpile',
            tenantId,
            dataClassification: 'TENANT_PRIVATE',
            inputText: contextLines,
            media: mediaParts,
            questions: STOCKPILE_CLASSIFICATION_QUESTIONS,
        }).catch(() => null);

        const choices = parseStockpileDecisionChoices(decisionRes);
        const reasoning = choices.isNonStockpile
            ? 'Escena detectada como no correspondiente a acopio mineral/árido; sin asignación de densidad.'
            : `Cubicación métrica 3D (${body.depthMode}, cobertura ${body.coveragePct}%, pie ${spatial.toeScore}/100).`;

        return {
            geometryType: choices.geometryType,
            wallConfinement: choices.wallConfinement,
            copperDomain: null,
            granulometry: null,
            aiSuggestedGranulometry: choices.aiSuggestedGranulometry,
            isNonStockpile: choices.isNonStockpile,
            suggestedDensityTm3: estimateReferenceDensityByGranulometry(
                choices.aiSuggestedGranulometry,
                choices.isNonStockpile
            ),
            reasoning,
        };
    })();

    const [descriptor, visual] = await Promise.all([persistMeshPromise, visualClassifyPromise]);

    const savingsPct =
        typeof descriptor.savingsPct === 'number'
            ? descriptor.savingsPct
            : Number((descriptor.savingsRatio * 100).toFixed(1));

    return {
        result: {
            verified: true,
            scaleVerified: true,
            isNonStockpile: visual.isNonStockpile,
            volumeM3: spatial.volumeM3,
            weightT: 0,
            uncertaintyPct: spatial.uncertaintyPct,
            toeScore: spatial.toeScore,
            coveragePct: body.coveragePct,
            depthMode: body.depthMode,
            groundSlopeDeg: spatial.groundSlopeDeg,
            geometryType: visual.geometryType,
            wallConfinement: visual.wallConfinement,
            copperDomain: null,
            granulometry: null,
            aiSuggestedGranulometry: visual.aiSuggestedGranulometry,
            suggestedDensityTm3: visual.suggestedDensityTm3,
            slopeAngleLeftDeg: spatial.slopeAngleLeftDeg,
            slopeAngleRightDeg: spatial.slopeAngleRightDeg,
            slopeAngleAvgDeg: spatial.slopeAngleAvgDeg,
            slopeWarning: spatial.slopeWarning,
            dimensionsM: spatial.dimensionsM,
            meshUrl: descriptor.downloadUrl,
            meshSha256: descriptor.sha256,
            meshSource,
            tinVolumeM3: meshResult.tinVolumeM3,
            reasoning: visual.reasoning,
        },
        persistence: {
            descriptor,
            meshResult,
            savingsPct,
            spatial,
        },
    };
}

/**
 * GET /api/geolapp/device-calibrations
 * Lista el historial auditable append-only de calibraciones por tenant (`southamerica-west1`, sin PII).
 */
router.get(
    '/device-calibrations',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const queryTenant =
                typeof req.query?.tenantId === 'string' ? req.query.tenantId : undefined;
            const headerTenant = resolveScopedTenantId(req, queryTenant);
            const authz = await authorizeStockpileTenantMutation(req, headerTenant);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const snap = await db
                .collection('device_calibrations')
                .where('tenantId', '==', headerTenant)
                .limit(100)
                .get();

            const calibrations = (snap?.docs || [])
                .map((docSnap) => {
                    const d = (typeof docSnap.data === 'function' ? docSnap.data() : {}) || {};
                    return {
                        calibrationId: String(d.calibrationId || docSnap.id || ''),
                        tenantId: String(d.tenantId || headerTenant),
                        actorUid: String(d.actorUid || ''),
                        scaleFactor: Number(d.scaleFactor ?? 1),
                        referenceDistanceM: Number(d.referenceDistanceM ?? 2),
                        measuredDistanceM: Number(d.measuredDistanceM ?? 2),
                        planeNoiseRmsM: Number(d.planeNoiseRmsM ?? 0),
                        imuPitchOffsetDeg: Number(d.imuPitchOffsetDeg ?? 0),
                        imuRollOffsetDeg: Number(d.imuRollOffsetDeg ?? 0),
                        calibratedAt: Number(d.calibratedAt || d.createdAt || 0),
                        ...(typeof d.deviceModel === 'string' && d.deviceModel
                            ? { deviceModel: d.deviceModel }
                            : {}),
                        ...(typeof d.platform === 'string' && d.platform
                            ? { platform: d.platform }
                            : {}),
                        region: String(d.region || 'southamerica-west1'),
                        createdAt: Number(d.createdAt || d.calibratedAt || 0),
                    };
                })
                .filter((item) => item.calibrationId.length > 0 && item.calibratedAt > 0)
                .sort((a, b) => b.calibratedAt - a.calibratedAt)
                .slice(0, 50);

            return res.status(200).json({
                success: true,
                calibrations,
            });
        } catch (error) {
            console.error('[MINREPORT-ACOPIOS] Error consultando device-calibrations:', error);
            return res.status(500).json({ error: 'Error consultando historial de calibraciones.' });
        }
    }
);

/**
 * POST /api/geolapp/device-calibration
 * Registra y audita la calibración métrica en terreno (`southamerica-west1`, sin PII).
 */
router.post(
    '/device-calibration',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const parsedBody = DeviceCalibrationBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload de calibracion de dispositivo invalido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const headerTenant = resolveScopedTenantId(req, parsedBody.data.tenantId);
            const authz = await authorizeStockpileTenantMutation(req, headerTenant);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const d = parsedBody.data;
            const docRef = db.collection('device_calibrations').doc();
            const calibrationId = docRef.id;
            const calibrationDoc = {
                calibrationId,
                tenantId: headerTenant,
                actorUid: authz.uid,
                scaleFactor: Number(d.scaleFactor.toFixed(4)),
                referenceDistanceM: Number(d.referenceDistanceM.toFixed(4)),
                measuredDistanceM: Number(d.measuredDistanceM.toFixed(4)),
                planeNoiseRmsM: Number(d.planeNoiseRmsM.toFixed(5)),
                imuPitchOffsetDeg: Number(d.imuPitchOffsetDeg.toFixed(2)),
                imuRollOffsetDeg: Number(d.imuRollOffsetDeg.toFixed(2)),
                calibratedAt: d.calibratedAt,
                ...(d.deviceModel ? { deviceModel: d.deviceModel } : {}),
                ...(d.platform ? { platform: d.platform } : {}),
                region: 'southamerica-west1',
                createdAt: Date.now(),
            };

            await docRef.set(calibrationDoc);

            await AuditLedger.record({
                tenantId: headerTenant,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'DEVICE_SPATIAL_CALIBRATION_RECORDED',
                module: 'stockpile',
                targetEntity: calibrationId,
                details: {
                    scaleFactor: calibrationDoc.scaleFactor,
                    referenceDistanceM: calibrationDoc.referenceDistanceM,
                    measuredDistanceM: calibrationDoc.measuredDistanceM,
                    planeNoiseRmsM: calibrationDoc.planeNoiseRmsM,
                    ...(calibrationDoc.deviceModel ? { deviceModel: calibrationDoc.deviceModel } : {}),
                    calibratedAt: calibrationDoc.calibratedAt,
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json({
                calibrationId,
                calibrated: true,
                scaleFactor: calibrationDoc.scaleFactor,
                referenceDistanceM: calibrationDoc.referenceDistanceM,
                measuredDistanceM: calibrationDoc.measuredDistanceM,
                planeNoiseRmsM: calibrationDoc.planeNoiseRmsM,
                imuPitchOffsetDeg: calibrationDoc.imuPitchOffsetDeg,
                imuRollOffsetDeg: calibrationDoc.imuRollOffsetDeg,
                calibratedAt: calibrationDoc.calibratedAt,
                ...(calibrationDoc.deviceModel ? { deviceModel: calibrationDoc.deviceModel } : {}),
                ...(calibrationDoc.platform ? { platform: calibrationDoc.platform } : {}),
            });
        } catch (error) {
            console.error('[MINREPORT-ACOPIOS] Error en device-calibration:', error);
            return res.status(500).json({ error: 'Error registrando calibracion de dispositivo.' });
        }
    }
);

/**
 * POST /api/geolapp/spatial-analyze
 * Cubicación espacial métrica real desde ARCore VIO/Depth (preview o captura nueva).
 */
router.post(
    '/spatial-analyze',
    requireAuth,
    aiRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const parsedBody = SpatialAnalyzeBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload de análisis espacial 3D inválido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const headerTenant = resolveScopedTenantId(req, parsedBody.data.tenantId);
            const authz = await authorizeStockpileTenantMutation(req, headerTenant);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const { result } = await runSpatialStockpileAnalyze({
                tenantId: headerTenant,
                actorUid: authz.uid,
                body: parsedBody.data,
            });

            await AuditLedger.record({
                tenantId: headerTenant,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'SPATIAL_STOCKPILE_3D_ANALYZE',
                module: 'stockpile',
                targetEntity: parsedBody.data.scanId || parsedBody.data.depthMode,
                details: {
                    volumeM3: result.volumeM3,
                    uncertaintyPct: result.uncertaintyPct,
                    toeScore: result.toeScore,
                    coveragePct: result.coveragePct,
                    depthMode: result.depthMode,
                    groundSlopeDeg: result.groundSlopeDeg,
                    meshSha256: result.meshSha256,
                    meshSource: result.meshSource,
                    isNonStockpile: result.isNonStockpile,
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof SpatialVolumeValidationError) {
                const rejectionCode = error.code || 'INVALID_POINT_CLOUD';
                return res.status(422).json({
                    error: rejectionCode,
                    rejectionCode,
                    message: error.message,
                });
            }
            console.error('[MINREPORT-ACOPIOS] Error en spatial-analyze:', error);
            return res.status(500).json({ error: 'Error ejecutando análisis espacial 3D.' });
        }
    }
);

/**
 * POST /api/geolapp/stockpiles/:id/spatial-analyze
 * Procesa nube métrica 3D ARCore VIO/Depth para un acopio existente y consolida `.glb` + métricas en Firestore.
 */
router.post(
    '/stockpiles/:id/spatial-analyze',
    requireAuth,
    aiRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const stockpileId = String(req.params.id || '').trim();
            if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
                return res.status(400).json({ error: 'Identificador de acopio inválido.' });
            }

            const parsedBody = SpatialAnalyzeBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload de análisis espacial 3D inválido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const docRef = db.collection('stockpiles').doc(stockpileId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Acopio no encontrado.' });
            }

            const existingData = (docSnap.data() || {}) as Record<string, any>;
            const docTenantId = String(
                existingData.tenantId || existingData.accountId || ''
            ).trim();
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const effectiveBody = {
                ...parsedBody.data,
                photoUrl:
                    parsedBody.data.photoUrl ||
                    (typeof existingData.last_photo_url === 'string'
                        ? existingData.last_photo_url
                        : existingData.initial_photo_url),
            };

            const { result, persistence } = await runSpatialStockpileAnalyze({
                tenantId: docTenantId,
                actorUid: authz.uid,
                stockpileId,
                body: effectiveBody,
            });

            const now = Date.now();
            const resolvedWeightT = result.isNonStockpile
                ? 0
                : result.weightT > 0
                  ? result.weightT
                  : typeof existingData.density_factor === 'number' && existingData.density_factor > 0
                    ? Math.round(result.volumeM3 * existingData.density_factor * 100) / 100
                    : 0;

            const symmetricMeshMetrics: Record<string, unknown> = {
                mesh_url: result.meshUrl,
                mesh_sha256: result.meshSha256,
                mesh_source: result.meshSource,
                tin_volume_m3: persistence.meshResult.tinVolumeM3,
                mesh_original_bytes: persistence.descriptor.originalBytes,
                mesh_optimized_bytes: persistence.descriptor.optimizedBytes,
                mesh_savings_pct: persistence.savingsPct,
                mesh_vertex_count: persistence.meshResult.vertexCount,
                mesh_triangle_count: persistence.meshResult.triangleCount,
                mesh_surface_area_m2: persistence.meshResult.surfaceAreaM2,
                mesh_bounding_box_m: persistence.meshResult.boundingBoxM,
                mesh_reconstructed_at: now,
            };

            const assetPatch: Record<string, unknown> = {
                analysis_status: 'AI_VERIFIED',
                scale_anchor_type: 'ARCORE_VIO_DEPTH',
                volumen_m3: result.volumeM3,
                last_volume_m3: result.volumeM3,
                volumen: result.volumeM3,
                volume_m3: result.volumeM3,
                peso_t: resolvedWeightT,
                ...(resolvedWeightT > 0
                    ? {
                          last_weight_t: resolvedWeightT,
                          weight_t: resolvedWeightT,
                          peso_final_toneladas: resolvedWeightT,
                      }
                    : {}),
                ...symmetricMeshMetrics,
                uncertainty_pct: result.uncertaintyPct,
                toe_score: result.toeScore,
                coverage_pct: result.coveragePct,
                depth_mode: result.depthMode,
                ground_slope_deg: result.groundSlopeDeg,
                detected_slope_angle_deg: result.slopeAngleAvgDeg,
                slope_warning: result.slopeWarning,
                last_geometry_type: result.geometryType,
                geometria: result.geometryType,
                wall_confinement: result.wallConfinement,
                metrology_grade: persistence.spatial.metrologyGrade,
                occluded_volume_pct: persistence.spatial.occludedVolumePct,
                zero_cells_inside: persistence.spatial.zeroCellsInside,
                updatedAt: now,
            };

            await docRef.set(assetPatch, { merge: true });

            if (effectiveBody.measurementId) {
                const measRef = docRef.collection('measurements').doc(effectiveBody.measurementId);
                await measRef.set(
                    {
                        analysis_status: 'AI_VERIFIED',
                        scale_anchor_type: 'ARCORE_VIO_DEPTH',
                        volumen_m3: result.volumeM3,
                        peso_t: resolvedWeightT,
                        ...symmetricMeshMetrics,
                        uncertainty_pct: result.uncertaintyPct,
                        toe_score: result.toeScore,
                        coverage_pct: result.coveragePct,
                        depth_mode: result.depthMode,
                        ground_slope_deg: result.groundSlopeDeg,
                        detected_slope_angle_deg: result.slopeAngleAvgDeg,
                        slope_left_deg: result.slopeAngleLeftDeg,
                        slope_right_deg: result.slopeAngleRightDeg,
                        slope_warning: result.slopeWarning,
                        wall_confinement: result.wallConfinement,
                        metrology_grade: persistence.spatial.metrologyGrade,
                        occluded_volume_pct: persistence.spatial.occludedVolumePct,
                        zero_cells_inside: persistence.spatial.zeroCellsInside,
                        geometry: {
                            type: result.geometryType,
                            dimensions: result.dimensionsM,
                        },
                        updatedAt: now,
                    },
                    { merge: true }
                );
            }

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'SPATIAL_STOCKPILE_3D_ANALYZE',
                module: 'stockpile',
                targetEntity: stockpileId,
                details: {
                    measurementId: effectiveBody.measurementId || null,
                    volumeM3: result.volumeM3,
                    weightT: resolvedWeightT,
                    uncertaintyPct: result.uncertaintyPct,
                    toeScore: result.toeScore,
                    coveragePct: result.coveragePct,
                    depthMode: result.depthMode,
                    groundSlopeDeg: result.groundSlopeDeg,
                    meshSha256: result.meshSha256,
                    meshSource: result.meshSource,
                    tinVolumeM3: persistence.meshResult.tinVolumeM3,
                    isNonStockpile: result.isNonStockpile,
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json({
                ...result,
                weightT: resolvedWeightT,
            });
        } catch (error: any) {
            if (error instanceof SpatialVolumeValidationError) {
                const rejectionCode = error.code || 'INVALID_POINT_CLOUD';
                return res.status(422).json({
                    error: rejectionCode,
                    rejectionCode,
                    message: error.message,
                });
            }
            console.error('[MINREPORT-ACOPIOS] Error en stockpiles/:id/spatial-analyze:', error);
            return res.status(500).json({ error: 'Error ejecutando análisis espacial 3D en acopio.' });
        }
    }
);

/**
 * POST /api/geolapp/stockpiles/:id/capture-sessions
 * Endpoint único idempotente V2 (Fase 2 MINREPORT · ACOPIOS):
 * - Idempotencia estricta por `sessionId` / `Idempotency-Key`.
 * - Validación Zod `CaptureSessionPackageV2Schema` con 3 ejes ortogonales.
 * - Preserva siempre `in_situ_offline` sin sobrescribir evidencia.
 * - Reconstrucción soberana en `southamerica-west1` (GPU `GEOLAPP_MAST3R_GPU_URL` o CPU determinista).
 * - Conciliación inmutable: `AUTO_CONCILIATED` si `|delta_pct| <= max(8%, uncertainty_pct)`,
 *   o `REQUIRES_HITL_REVIEW` sin sobrescribir `offline_in_situ_m3` + registro en `AuditLedger`.
 */
router.post(
    '/stockpiles/:id/capture-sessions',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const stockpileId = String(req.params.id || '').trim();
            if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
                return res.status(400).json({ error: 'Identificador de acopio inválido.' });
            }

            const parsedBody = CaptureSessionPackageV2Schema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload CaptureSessionPackageV2 inválido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const body = parsedBody.data;
            const idempotencyHeader = String(req.headers['idempotency-key'] || '').trim();
            if (idempotencyHeader && idempotencyHeader !== body.sessionId) {
                return res.status(400).json({
                    error: 'IDEMPOTENCY_KEY_MISMATCH: Idempotency-Key debe coincidir con sessionId.',
                });
            }

            const docRef = db.collection('stockpiles').doc(stockpileId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Acopio no encontrado.' });
            }

            const existingData = (docSnap.data() || {}) as Record<string, any>;
            const docTenantId = String(
                existingData.tenantId || existingData.accountId || ''
            ).trim();
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const sessionId = body.sessionId;
            const measurementId = body.measurementId || sessionId;
            const sessionRef = docRef.collection('capture_sessions').doc(sessionId);
            const existingSessionSnap = await sessionRef.get();

            if (existingSessionSnap.exists) {
                const prev = (existingSessionSnap.data() || {}) as Record<string, any>;
                if (
                    prev.tenantId === docTenantId &&
                    (prev.lifecycle_status === 'CLOUD_3D_VERIFIED' ||
                        prev.lifecycle_status === 'REJECTED_METROLOGY')
                ) {
                    const prevCloudVol =
                        prev.cloud_refined_m3 ?? prev.cloud_refined?.volume_m3 ?? null;
                    const prevOfflineVol =
                        prev.offline_in_situ_m3 ?? prev.in_situ_offline?.volume_m3 ?? 0;
                    const prevEffectiveVol =
                        prev.active_volume_source === 'CLOUD_REFINED' && typeof prevCloudVol === 'number'
                            ? prevCloudVol
                            : prevOfflineVol;
                    const prevDeltaM3 =
                        prev.reconciliation_delta_m3 ?? prev.reconciliation?.deltaM3 ?? 0;
                    const prevDeltaPct =
                        prev.reconciliation_delta_pct ?? prev.reconciliation?.deltaPct ?? 0;
                    return res.status(200).json({
                        success: true,
                        idempotentHit: true,
                        sessionId,
                        measurementId: prev.measurementId || measurementId,
                        stockpileId,
                        lifecycle_status: prev.lifecycle_status,
                        metrology_grade: prev.metrology_grade,
                        reconciliation_status: prev.reconciliation_status,
                        active_volume_source: prev.active_volume_source || 'IN_SITU_OFFLINE',
                        effectiveVolumeM3: prevEffectiveVol,
                        volumeM3: prevEffectiveVol,
                        offline_in_situ_m3: prevOfflineVol,
                        cloud_refined_m3: prevCloudVol,
                        reconciliation_delta_m3: prevDeltaM3,
                        reconciliation_delta_pct: prevDeltaPct,
                        in_situ_offline: prev.in_situ_offline,
                        cloud_refined: prev.cloud_refined || null,
                        reconciliation: prev.reconciliation || null,
                        mesh_url: prev.mesh_url || null,
                        mesh_sha256: prev.mesh_sha256 || null,
                    });
                }
            }

            const now = Date.now();
            const inSituOffline = {
                volume_m3: Number(body.inSituMetrology.volumeM3.toFixed(2)),
                uncertainty_pct: body.inSituMetrology.uncertaintyPct,
                toe_score: body.inSituMetrology.toeScore,
                occluded_volume_pct: body.inSituMetrology.occludedVolumePct,
                zero_cells_inside: body.inSituMetrology.zeroCellsInside,
                loop_drift_pct: body.inSituMetrology.loopDriftPct,
                ground_slope_deg: body.inSituMetrology.groundSlopeDeg,
                plane_mismatch_deg: body.inSituMetrology.planeMismatchDeg,
                slope_angle_avg_deg: body.inSituMetrology.slopeAngleAvgDeg ?? null,
                dimensions_m: body.inSituMetrology.dimensionsM,
                metrology_grade: body.inSituMetrology.metrologyGrade,
                metrology_reasons: body.inSituMetrology.metrologyReasons || [],
                coverage_pct: body.inSituMetrology.coveragePct,
                sectors_covered: body.inSituMetrology.sectorsCovered,
                loop_closed: body.inSituMetrology.loopClosed,
                wall_confinement: body.inSituMetrology.wallConfinement || body.wallConfinement || 'NONE',
                depth_mode: body.inSituMetrology.depthMode || 'KNOWN_POSE_MVS_OFFLINE',
                computed_at: body.inSituMetrology.computedAt,
                engine_version: body.inSituMetrology.engineVersion,
                raw_bundle_sha256: body.rawBundleSha256 || null,
                raw_bundle_url: body.rawBundleUrl || null,
            };

            // Rechazo metrológico explícito: preserva evidencia cruda y no sobrescribe el acopio con 0 m³
            if (body.inSituMetrology.metrologyGrade === 'REJECTED') {
                const rejectedRecord: Record<string, unknown> = {
                    sessionId,
                    measurementId,
                    stockpileId,
                    tenantId: docTenantId,
                    region: 'southamerica-west1',
                    lifecycle_status: 'REJECTED_METROLOGY',
                    metrology_grade: 'REJECTED',
                    reconciliation_status: 'PENDING_CLOUD',
                    in_situ_offline: inSituOffline,
                    cloud_refined: null,
                    reconciliation: null,
                    keyframes_count: body.keyframes.length,
                    walk_ring_count: body.walkRing.length,
                    capturedAt: body.capturedAt,
                    updatedAt: now,
                };
                await sessionRef.set(rejectedRecord, { merge: true });
                await docRef
                    .collection('measurements')
                    .doc(measurementId)
                    .set(
                        {
                            sessionId,
                            lifecycle_status: 'REJECTED_METROLOGY',
                            metrology_grade: 'REJECTED',
                            reconciliation_status: 'PENDING_CLOUD',
                            in_situ_offline: inSituOffline,
                            updatedAt: now,
                        },
                        { merge: true }
                    );

                await AuditLedger.record({
                    tenantId: docTenantId,
                    actorUid: authz.uid,
                    actorEmail: authz.emailLower || authz.uid,
                    action: 'STOCKPILE_CAPTURE_SESSION_REJECTED',
                    module: 'stockpile',
                    targetEntity: `${stockpileId}/capture_sessions/${sessionId}`,
                    details: {
                        sessionId,
                        measurementId,
                        metrologyGrade: 'REJECTED',
                        reasons: inSituOffline.metrology_reasons,
                        rawBundleSha256: body.rawBundleSha256 || null,
                    },
                    ipAddress: extractClientIp(req),
                }).catch(() => {});

                return res.status(422).json({
                    error: 'REJECTED_METROLOGY',
                    rejectionCode: 'REJECTED_METROLOGY',
                    message:
                        'Sesión rechazada por compuerta metrológica; evidencia preservada sin corromper inventario.',
                    sessionId,
                    measurementId,
                    lifecycle_status: 'REJECTED_METROLOGY',
                    metrology_grade: 'REJECTED',
                    reconciliation_status: 'PENDING_CLOUD',
                });
            }

            // Reconstrucción 3D soberana en southamerica-west1 (GPU MASt3R o CPU determinista)
            let meshResult: GlbSurfaceBuildResult | null = null;
            let meshSource = 'SOVEREIGN_CPU_DELAUNAY_SOUTH_AMERICA_WEST1';
            let cloudVolumeM3 = 0;
            let cloudUncertaintyPct = body.inSituMetrology.uncertaintyPct;
            let cloudToeScore = body.inSituMetrology.toeScore;
            let cloudOccludedPct = body.inSituMetrology.occludedVolumePct;
            let cloudZeroCellsInside = 0;
            let cloudGroundSlopeDeg = body.inSituMetrology.groundSlopeDeg;
            let cloudSlopeAvgDeg = body.inSituMetrology.slopeAngleAvgDeg ?? null;
            let cloudSlopeLeftDeg = body.inSituMetrology.slopeAngleLeftDeg ?? null;
            let cloudSlopeRightDeg = body.inSituMetrology.slopeAngleRightDeg ?? null;
            let cloudSlopeWarning: string | null = null;
            let cloudDimensionsM = body.inSituMetrology.dimensionsM;
            let cloudMetrologyGrade: AcopiosMetrologyGrade = body.inSituMetrology.metrologyGrade;

            const configuredGpuUrl = String(process.env.GEOLAPP_MAST3R_GPU_URL || '').trim();
            if (configuredGpuUrl && body.keyframes.length >= 2) {
                let gpuUrl: URL;
                try {
                    gpuUrl = validateSovereignMast3rGpuUrl(configuredGpuUrl);
                } catch (err: any) {
                    return res.status(403).json({
                        error: `SOVEREIGN_REGION_VIOLATION: ${err?.message || 'Endpoint GPU no autorizado.'}`,
                    });
                }

                try {
                    const gpuResponse = await safeFetchExternal(gpuUrl.toString(), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'model/gltf-binary, application/octet-stream',
                        },
                        body: JSON.stringify({
                            stockpileId,
                            sessionId,
                            measurementId,
                            tenantId: docTenantId,
                            keyframes: body.keyframes,
                            walkRing: body.walkRing,
                            wallConfinement: body.wallConfinement,
                        }),
                        timeoutMs: 30000,
                        maxBytes: 30 * 1024 * 1024,
                    });
                    if (gpuResponse.ok) {
                        const gpuBuf = Buffer.from(await gpuResponse.arrayBuffer());
                        if (
                            gpuBuf.length >= 28 &&
                            gpuBuf.readUInt32LE(0) === 0x46546c67 &&
                            gpuBuf.readUInt32LE(4) === 2
                        ) {
                            meshResult = inspectGlbBinaryMetrics(gpuBuf);
                            meshSource = 'MAST3R_GPU_SOUTH_AMERICA_WEST1';
                            cloudVolumeM3 = Number(meshResult.tinVolumeM3.toFixed(2));
                            cloudUncertaintyPct = Number(
                                Math.max(2.0, Math.min(body.inSituMetrology.uncertaintyPct, 4.5)).toFixed(1)
                            );
                        }
                    }
                } catch (gpuErr) {
                    console.warn(
                        '[MINREPORT-ACOPIOS] GPU soberana no disponible en capture-sessions; usando respaldo CPU determinista:',
                        (gpuErr as Error)?.message
                    );
                }
            }

            // Respaldo CPU determinista soberano (NUNCA cono paramétrico sintético)
            if (!meshResult) {
                if (Array.isArray(body.pointsM) && body.pointsM.length >= 20) {
                    const spatial = computeSpatialStockpileVolume({
                        pointsM: body.pointsM,
                        groundSamplesM: body.groundSamplesM,
                        walkRingPoses: body.walkRing,
                        wallConfinement: body.wallConfinement,
                        anchorCenter: body.anchorCenter,
                        roiRadiusM: body.roiRadiusM,
                        calibrationScaleFactor: body.calibrationScaleFactor,
                        coveragePct: body.inSituMetrology.coveragePct,
                        sectorsCovered: body.inSituMetrology.sectorsCovered,
                        sectorsTotal: body.inSituMetrology.sectorsTotal,
                        loopClosed: body.inSituMetrology.loopClosed,
                        loopDriftPct: body.inSituMetrology.loopDriftPct,
                        hasScaleAnchor: body.inSituMetrology.hasScaleAnchor,
                        depthMode: body.inSituMetrology.depthMode,
                    });
                    meshResult = buildSpatialPointCloudGlbMesh(spatial.surfaceGrid);
                    meshSource = 'SOVEREIGN_CPU_DELAUNAY_SOUTH_AMERICA_WEST1';
                    cloudVolumeM3 = spatial.volumeM3;
                    cloudUncertaintyPct = spatial.uncertaintyPct;
                    cloudToeScore = spatial.toeScore;
                    cloudOccludedPct = spatial.occludedVolumePct;
                    cloudZeroCellsInside = spatial.zeroCellsInside;
                    cloudGroundSlopeDeg = spatial.groundSlopeDeg;
                    cloudSlopeAvgDeg = spatial.slopeAngleAvgDeg;
                    cloudSlopeLeftDeg = spatial.slopeAngleLeftDeg;
                    cloudSlopeRightDeg = spatial.slopeAngleRightDeg;
                    cloudSlopeWarning = spatial.slopeWarning;
                    cloudDimensionsM = spatial.dimensionsM;
                    cloudMetrologyGrade = spatial.metrologyGrade;
                } else if (body.localPreviewMesh) {
                    const previewGrid: SpatialSurfaceGrid = {
                        originX: body.localPreviewMesh.originX,
                        originZ: body.localPreviewMesh.originZ,
                        cellSizeM: body.localPreviewMesh.cellSizeM,
                        nx: body.localPreviewMesh.nx,
                        nz: body.localPreviewMesh.nz,
                        heightsM: body.localPreviewMesh.heightsM,
                        interpolatedMask: body.localPreviewMesh.interpolatedMask,
                        observationCount: body.localPreviewMesh.observationCount,
                        slopeDegGrid: body.localPreviewMesh.slopeDegGrid,
                        groundPlane: body.localPreviewMesh.groundPlane,
                    };
                    meshResult = buildSpatialPointCloudGlbMesh(previewGrid);
                    meshSource = 'SOVEREIGN_DEM_GRID_SOUTH_AMERICA_WEST1';
                    cloudVolumeM3 = Number(meshResult.tinVolumeM3.toFixed(2));
                } else {
                    return res.status(422).json({
                        error: 'INSUFFICIENT_SPATIAL_DATA',
                        rejectionCode: 'INSUFFICIENT_SPATIAL_DATA',
                        message:
                            'No se recibieron puntos 3D, grilla local ni reconstrucción GPU soberana; prohibido generar malla sintética.',
                    });
                }
            }

            const digestedMesh = await MediaDigestorServer.digestAny(
                meshResult.glbBuffer,
                'model/gltf-binary',
                'MESH_3D_GLB'
            );
            const descriptor = await CasStorageService.persistDigestedBinary(digestedMesh, {
                scope: 'TENANT_PRIVATE',
                tenantId: docTenantId,
                actorUid: authz.uid,
                originalFilename: `${stockpileId}_${sessionId}.glb`,
                clientOriginalBytes: meshResult.rawUnindexedBytes,
            });
            const savingsPct =
                typeof descriptor.savingsPct === 'number'
                    ? descriptor.savingsPct
                    : Number((descriptor.savingsRatio * 100).toFixed(1));

            // Clasificación visual opcional sin sobrescribir la metrología 3D
            const primaryPhotoUrl =
                body.primaryPhotoUrl ||
                body.keyframes[0]?.downloadUrl ||
                (typeof existingData.last_photo_url === 'string'
                    ? existingData.last_photo_url
                    : existingData.initial_photo_url);

            const mediaParts = await collectVisualMediaParts({
                tenantId: docTenantId,
                imageBase64: body.primaryImageBase64,
                imageMimeType: body.primaryImageMimeType,
                photoUrl: primaryPhotoUrl,
            });

            let visualChoices = parseStockpileDecisionChoices(null);
            if (mediaParts.length > 0) {
                const visualContext = [
                    `Dimensiones métricas reales de nube 3D: a=${cloudDimensionsM.a}m, b=${cloudDimensionsM.b}m, h=${cloudDimensionsM.h}m`,
                    `Volumen 3D ya calculado (NO modificar): ${cloudVolumeM3} m3`,
                    `Talud medio medido: ${cloudSlopeAvgDeg ?? 'N/A'}°`,
                ].join('\n');
                const decisionRes = await ResilientAIClient.decide({
                    module: 'stockpile',
                    tenantId: docTenantId,
                    dataClassification: 'TENANT_PRIVATE',
                    inputText: visualContext,
                    media: mediaParts,
                    questions: STOCKPILE_CLASSIFICATION_QUESTIONS,
                }).catch(() => null);
                visualChoices = parseStockpileDecisionChoices(decisionRes);
            }

            const reconciliation = evaluateStockpileReconciliation({
                offlineInSituM3: inSituOffline.volume_m3,
                inSituUncertaintyPct: inSituOffline.uncertainty_pct,
                cloudRefinedM3: cloudVolumeM3,
                evaluatedAt: now,
            });

            const effectiveVolumeM3 =
                reconciliation.activeSource === 'CLOUD_REFINED'
                    ? reconciliation.cloudRefinedM3
                    : reconciliation.offlineInSituM3;

            const resolvedWeightT =
                typeof existingData.density_factor === 'number' && existingData.density_factor > 0
                    ? Math.round(effectiveVolumeM3 * existingData.density_factor * 100) / 100
                    : 0;

            const symmetricMeshMetrics: Record<string, unknown> = {
                mesh_url: descriptor.downloadUrl,
                mesh_sha256: descriptor.sha256,
                mesh_source: meshSource,
                tin_volume_m3: meshResult.tinVolumeM3,
                mesh_original_bytes: descriptor.originalBytes,
                mesh_optimized_bytes: descriptor.optimizedBytes,
                mesh_savings_pct: savingsPct,
                mesh_vertex_count: meshResult.vertexCount,
                mesh_triangle_count: meshResult.triangleCount,
                mesh_surface_area_m2: meshResult.surfaceAreaM2,
                mesh_bounding_box_m: meshResult.boundingBoxM,
                mesh_reconstructed_at: now,
            };

            const cloudRefined = {
                volume_m3: cloudVolumeM3,
                tin_volume_m3: meshResult.tinVolumeM3,
                uncertainty_pct: cloudUncertaintyPct,
                toe_score: cloudToeScore,
                occluded_volume_pct: cloudOccludedPct,
                zero_cells_inside: cloudZeroCellsInside,
                ground_slope_deg: cloudGroundSlopeDeg,
                slope_angle_avg_deg: cloudSlopeAvgDeg,
                dimensions_m: cloudDimensionsM,
                mesh_url: descriptor.downloadUrl,
                mesh_sha256: descriptor.sha256,
                mesh_source: meshSource,
                computed_at: now,
                engine_version: 'acopios-cloud-v2',
            };

            const lifecycleStatus = 'CLOUD_3D_VERIFIED' as const;
            const sessionDoc: Record<string, unknown> = {
                sessionId,
                measurementId,
                stockpileId,
                tenantId: docTenantId,
                region: 'southamerica-west1',
                lifecycle_status: lifecycleStatus,
                metrology_grade: cloudMetrologyGrade,
                reconciliation_status: reconciliation.status,
                active_volume_source: reconciliation.activeSource,
                offline_in_situ_m3: reconciliation.offlineInSituM3,
                cloud_refined_m3: reconciliation.cloudRefinedM3,
                reconciliation_delta_m3: reconciliation.deltaM3,
                reconciliation_delta_pct: reconciliation.deltaPct,
                in_situ_offline: inSituOffline,
                cloud_refined: cloudRefined,
                reconciliation,
                ...symmetricMeshMetrics,
                keyframes_count: body.keyframes.length,
                walk_ring_count: body.walkRing.length,
                raw_bundle_sha256: body.rawBundleSha256 || null,
                raw_bundle_url: body.rawBundleUrl || null,
                raw_bundle_original_bytes: body.rawBundleOriginalBytes ?? null,
                raw_bundle_optimized_bytes: body.rawBundleOptimizedBytes ?? null,
                raw_bundle_savings_pct: body.rawBundleSavingsPct ?? null,
                capturedAt: body.capturedAt,
                updatedAt: now,
            };

            await sessionRef.set(sessionDoc, { merge: true });

            // Persistencia simétrica completa en measurements/{measurementId}
            const measRef = docRef.collection('measurements').doc(measurementId);
            await measRef.set(
                {
                    sessionId,
                    lifecycle_status: lifecycleStatus,
                    metrology_grade: cloudMetrologyGrade,
                    reconciliation_status: reconciliation.status,
                    active_volume_source: reconciliation.activeSource,
                    analysis_status:
                        reconciliation.status === 'AUTO_CONCILIATED'
                            ? 'AI_VERIFIED'
                            : 'REQUIRES_HITL_REVIEW',
                    volumen_m3: effectiveVolumeM3,
                    offline_in_situ_m3: reconciliation.offlineInSituM3,
                    cloud_refined_m3: reconciliation.cloudRefinedM3,
                    reconciliation_delta_m3: reconciliation.deltaM3,
                    reconciliation_delta_pct: reconciliation.deltaPct,
                    peso_t: resolvedWeightT,
                    in_situ_offline: inSituOffline,
                    cloud_refined: cloudRefined,
                    reconciliation,
                    ...symmetricMeshMetrics,
                    uncertainty_pct:
                        reconciliation.activeSource === 'CLOUD_REFINED'
                            ? cloudUncertaintyPct
                            : inSituOffline.uncertainty_pct,
                    toe_score: cloudToeScore,
                    occluded_volume_pct: cloudOccludedPct,
                    zero_cells_inside: cloudZeroCellsInside,
                    coverage_pct: body.inSituMetrology.coveragePct,
                    depth_mode: body.inSituMetrology.depthMode,
                    ground_slope_deg: cloudGroundSlopeDeg,
                    detected_slope_angle_deg: cloudSlopeAvgDeg,
                    slope_left_deg: cloudSlopeLeftDeg,
                    slope_right_deg: cloudSlopeRightDeg,
                    slope_warning: cloudSlopeWarning,
                    wall_confinement: body.wallConfinement,
                    geometry: {
                        type: visualChoices.geometryType,
                        dimensions: cloudDimensionsM,
                    },
                    updatedAt: now,
                },
                { merge: true }
            );

            // Persistencia simétrica en stockpiles/{id}: si REQUIRES_HITL_REVIEW, NO sobrescribe offline_in_situ_m3
            const assetPatch: Record<string, unknown> = {
                lifecycle_status: lifecycleStatus,
                metrology_grade: cloudMetrologyGrade,
                reconciliation_status: reconciliation.status,
                active_volume_source: reconciliation.activeSource,
                analysis_status:
                    reconciliation.status === 'AUTO_CONCILIATED'
                        ? 'AI_VERIFIED'
                        : 'REQUIRES_HITL_REVIEW',
                offline_in_situ_m3: reconciliation.offlineInSituM3,
                cloud_refined_m3: reconciliation.cloudRefinedM3,
                reconciliation_delta_m3: reconciliation.deltaM3,
                reconciliation_delta_pct: reconciliation.deltaPct,
                volumen_m3: effectiveVolumeM3,
                last_volume_m3: effectiveVolumeM3,
                volumen: effectiveVolumeM3,
                volume_m3: effectiveVolumeM3,
                peso_t: resolvedWeightT,
                ...(resolvedWeightT > 0
                    ? {
                          last_weight_t: resolvedWeightT,
                          weight_t: resolvedWeightT,
                          peso_final_toneladas: resolvedWeightT,
                      }
                    : {}),
                ...symmetricMeshMetrics,
                uncertainty_pct:
                    reconciliation.activeSource === 'CLOUD_REFINED'
                        ? cloudUncertaintyPct
                        : inSituOffline.uncertainty_pct,
                toe_score: cloudToeScore,
                occluded_volume_pct: cloudOccludedPct,
                zero_cells_inside: cloudZeroCellsInside,
                coverage_pct: body.inSituMetrology.coveragePct,
                depth_mode: body.inSituMetrology.depthMode,
                ground_slope_deg: cloudGroundSlopeDeg,
                detected_slope_angle_deg: cloudSlopeAvgDeg,
                slope_warning: cloudSlopeWarning,
                last_geometry_type: visualChoices.geometryType,
                geometria: visualChoices.geometryType,
                wall_confinement: body.wallConfinement,
                last_session_id: sessionId,
                updatedAt: now,
            };
            await docRef.set(assetPatch, { merge: true });

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'STOCKPILE_CLOUD_RECONCILIATION',
                module: 'stockpile',
                targetEntity: `${stockpileId}/capture_sessions/${sessionId}`,
                details: {
                    sessionId,
                    measurementId,
                    lifecycleStatus,
                    metrologyGrade: cloudMetrologyGrade,
                    reconciliationStatus: reconciliation.status,
                    activeSource: reconciliation.activeSource,
                    offlineInSituM3: reconciliation.offlineInSituM3,
                    cloudRefinedM3: reconciliation.cloudRefinedM3,
                    deltaM3: reconciliation.deltaM3,
                    deltaPct: reconciliation.deltaPct,
                    tolerancePct: reconciliation.tolerancePct,
                    meshSha256: descriptor.sha256,
                    meshSource,
                    rawBundleSha256: body.rawBundleSha256 || null,
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json({
                success: true,
                idempotentHit: false,
                sessionId,
                measurementId,
                stockpileId,
                lifecycle_status: lifecycleStatus,
                metrology_grade: cloudMetrologyGrade,
                reconciliation_status: reconciliation.status,
                active_volume_source: reconciliation.activeSource,
                effectiveVolumeM3,
                volumeM3: effectiveVolumeM3,
                offline_in_situ_m3: reconciliation.offlineInSituM3,
                cloud_refined_m3: reconciliation.cloudRefinedM3,
                reconciliation_delta_m3: reconciliation.deltaM3,
                reconciliation_delta_pct: reconciliation.deltaPct,
                weightT: resolvedWeightT,
                in_situ_offline: inSituOffline,
                cloud_refined: cloudRefined,
                reconciliation,
                ...symmetricMeshMetrics,
            });
        } catch (error: any) {
            if (error instanceof SpatialVolumeValidationError) {
                const rejectionCode = error.code || 'INVALID_POINT_CLOUD';
                return res.status(422).json({
                    error: rejectionCode,
                    rejectionCode,
                    lifecycle_status: 'REJECTED_METROLOGY',
                    metrology_grade: 'REJECTED',
                    message: error.message,
                });
            }
            console.error('[MINREPORT-ACOPIOS] Error en POST capture-sessions:', error);
            return res.status(500).json({ error: 'Error interno procesando sesión de captura V2.' });
        }
    }
);

/**
 * GET /api/geolapp/stockpiles/:id/capture-sessions/:sessionId
 * Consulta auditable de estado, evidencia in-situ y conciliación cloud de una sesión V2.
 */
router.get(
    '/stockpiles/:id/capture-sessions/:sessionId',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
        try {
            const stockpileId = String(req.params.id || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (
                !stockpileId ||
                !STOCKPILE_ID_REGEX.test(stockpileId) ||
                !sessionId ||
                !STOCKPILE_ID_REGEX.test(sessionId)
            ) {
                return res.status(400).json({ error: 'Identificador de acopio o sesión inválido.' });
            }

            const docRef = db.collection('stockpiles').doc(stockpileId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Acopio no encontrado.' });
            }

            const existingData = (docSnap.data() || {}) as Record<string, any>;
            const docTenantId = String(
                existingData.tenantId || existingData.accountId || ''
            ).trim();
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const sessionSnap = await docRef.collection('capture_sessions').doc(sessionId).get();
            if (!sessionSnap.exists) {
                return res.status(404).json({ error: 'Sesión de captura no encontrada.' });
            }

            const sessionData = (sessionSnap.data() || {}) as Record<string, any>;
            if (sessionData.tenantId && sessionData.tenantId !== docTenantId) {
                return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
            }

            return res.status(200).json({
                success: true,
                session: sessionData,
            });
        } catch (error) {
            console.error('[MINREPORT-ACOPIOS] Error en GET capture-sessions/:sessionId:', error);
            return res.status(500).json({ error: 'Error consultando sesión de captura V2.' });
        }
    }
);

export default router;
