import { Router, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env } from '../config/env';
import { db } from '../config/firebase';
import { evaluatePilotExpiration } from '../contracts/session.contracts';
import { AuditLedger } from '../core/audit-ledger';
import {
    AISwarmUnavailableError,
    ResilientAIClient,
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
    buildServerStockpileGlbMesh,
    buildSpatialPointCloudGlbMesh,
    inspectGlbBinaryMetrics,
    type GlbSurfaceBuildResult,
} from '../modules/geolapp/glb-surface.builder';
import {
    computeSpatialStockpileVolume,
    SpatialVolumeValidationError,
} from '../modules/geolapp/spatial-volume.engine';
import {
    getSpatialDeviceCatalog,
    importGooglePlayDeviceCatalogCsv,
    SpatialCatalogValidationError,
    syncSpatialDeviceCatalogFromOfficialSources,
} from '../modules/geolapp/device-compatibility.service';
import {
    computeStockpileVolumeV2,
    evaluateStockpileSlopePhysics,
    type SlopeConfinementMode,
} from '../modules/geolapp/stockpile-geometry.engine';
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
const StockpileClosureReasonSchema = z.enum(['SHIPPED', 'ZERO_VOLUME', 'MANUAL_CLOSE']);

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
    clase: z.enum(['mineral', 'esteril', 'baja_ley']).optional(),
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
    dispatch_reference: z.string().trim().max(240).nullable().optional(),
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
                    ...(sanitizedPatch.dispatch_reference
                        ? { dispatchReference: sanitizedPatch.dispatch_reference }
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
        let meshSource: 'MAST3R_GPU_SOUTH_AMERICA_WEST1' | 'PARAMETRIC_TIN_SOUTH_AMERICA_WEST1' =
            'PARAMETRIC_TIN_SOUTH_AMERICA_WEST1';

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
                    '[GEOLAPP-3D] Fallback a TIN parametrico tras respuesta no valida de GPU:',
                    (gpuError as Error)?.message
                );
            }
        }

        if (!meshResult) {
            try {
                meshResult = buildServerStockpileGlbMesh({
                    geometryType,
                    dimensions,
                    profileSamples,
                });
                meshSource = 'PARAMETRIC_TIN_SOUTH_AMERICA_WEST1';
            } catch (builderErr: any) {
                return res.status(400).json({
                    error:
                        builderErr?.message ||
                        'No es posible generar malla 3D sin geometria y cotas reales declaradas.',
                });
            }
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

const AiEnrichBodySchema = z
    .object({
        imageBase64: z.string().min(8).max(4_000_000).optional(),
        imageMimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
        labDocumentBase64: z.string().min(8).max(6_000_000).optional(),
        labDocumentMimeType: z
            .enum(['application/pdf', 'image/webp', 'image/jpeg', 'image/png'])
            .optional(),
        voiceNoteText: z.string().trim().max(2000).optional(),
        locale: z.enum(['es', 'en', 'pt']).optional(),
    })
    .superRefine((val, ctx) => {
        if (!val.imageBase64 && !val.labDocumentBase64 && !val.voiceNoteText) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Incluya fotografía, documento de laboratorio o nota de terreno para enriquecer con IA.',
            });
        }
    });

const AiEnrichExtractedSchema = z.object({
    description: z.string().trim().max(600).nullable().optional(),
    location_ref: z.string().trim().max(240).nullable().optional(),
    density_factor: z.number().finite().positive().max(15).nullable().optional(),
    moisture_pct: z.number().finite().min(0).max(99.9).nullable().optional(),
    cu_total_pct: z.number().finite().min(0).max(100).nullable().optional(),
    cu_soluble_pct: z.number().finite().min(0).max(100).nullable().optional(),
    tml_pct: z.number().finite().min(0).max(99.9).nullable().optional(),
    residence_days: z.number().finite().min(0).max(3650).nullable().optional(),
    peso_romana: z.number().finite().min(0).max(10_000_000).nullable().optional(),
    reasoning: z.string().trim().max(600).nullable().optional(),
});

function parseJsonObjectFromAiText(rawText: string): Record<string, unknown> | null {
    const cleaned = String(rawText || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
    if (!cleaned) return null;
    try {
        const parsed = JSON.parse(cleaned);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                const sliced = JSON.parse(cleaned.slice(start, end + 1));
                return sliced && typeof sliced === 'object' && !Array.isArray(sliced)
                    ? (sliced as Record<string, unknown>)
                    : null;
            } catch {
                return null;
            }
        }
        return null;
    }
}

/**
 * POST /api/geolapp/stockpiles/:id/ai-enrich
 * Enriquecimiento progresivo post-registro (Fase 2 MINREPORT · ACOPIOS):
 * Propone metadatos geo-metalúrgicos desde fotografía, nota de voz o certificado de laboratorio,
 * combinando ResilientAIClient.generate + ResilientAIClient.decide (HITL sin escritura automática).
 */
router.post(
    '/stockpiles/:id/ai-enrich',
    requireAuth,
    aiRateLimiter,
    async (req: AuthRequest, res: Response) => {
        const startTime = Date.now();
        try {
            const stockpileId = String(req.params.id || '').trim();
            if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
                return res.status(400).json({ error: 'Identificador de acopio invalido.' });
            }

            const parsedBody = AiEnrichBodySchema.safeParse(req.body);
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload de enriquecimiento IA invalido.',
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
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const {
                imageBase64,
                imageMimeType,
                labDocumentBase64,
                labDocumentMimeType,
                voiceNoteText,
                locale = 'es',
            } = parsedBody.data;

            const mediaParts: Array<{ mimeType: string; dataBase64: string }> = [];
            if (imageBase64) {
                mediaParts.push({
                    mimeType: imageMimeType || 'image/webp',
                    dataBase64: imageBase64,
                });
            }
            if (labDocumentBase64) {
                mediaParts.push({
                    mimeType: labDocumentMimeType || 'application/pdf',
                    dataBase64: labDocumentBase64,
                });
            }

            const contextLines = [
                `Stockpile ID/Nombre actual: ${String(existingData.name || stockpileId)}`,
                typeof existingData.last_volume_m3 === 'number'
                    ? `Volumen cubicado: ${existingData.last_volume_m3} m3`
                    : '',
                voiceNoteText ? `Nota de operador en terreno: ${voiceNoteText}` : '',
            ]
                .filter(Boolean)
                .join('\n');

            const extractionPrompt = [
                `Analiza estrictamente la evidencia adjunta (imagen de acopio, documento de laboratorio y/o nota de terreno) para el acopio minero indicado.`,
                `Idioma de salida para description/location_ref/reasoning: ${locale}.`,
                `REGLA CERO ALUCINACIONES: Devuelve null en cualquier campo numérico o de texto que NO esté explícita y verificablemente respaldado por la evidencia adjunta. Jamás inventes leyes CuT, CuS, humedad, TML ni pesos.`,
                contextLines,
                `Responde ÚNICAMENTE un objeto JSON válido con estas claves exactas: {"description": string|null, "location_ref": string|null, "density_factor": number|null, "moisture_pct": number|null, "cu_total_pct": number|null, "cu_soluble_pct": number|null, "tml_pct": number|null, "residence_days": number|null, "peso_romana": number|null, "reasoning": string|null}.`,
            ].join('\n');

            const [genRes, decisionRes] = await Promise.all([
                ResilientAIClient.generate({
                    prompt: extractionPrompt,
                    module: 'stockpile',
                    tenantId: docTenantId,
                    thinkingLevel: 'medium',
                    requireHITL: true,
                    responseMimeType: 'application/json',
                    media: mediaParts.length > 0 ? mediaParts : undefined,
                }),
                ResilientAIClient.decide({
                    module: 'stockpile',
                    tenantId: docTenantId,
                    dataClassification: 'TENANT_PRIVATE',
                    inputText: contextLines,
                    media: mediaParts.length > 0 ? mediaParts : undefined,
                    questions: {
                        copper_domain: {
                            type: 'choice',
                            instructions:
                                'Clasifica el dominio mineral de cobre más probable según coloración visual, textura o certificado de laboratorio.',
                            criteria: {
                                OXIDO_CU: 'Tonalidades verdosas/azuladas o mineral oxidado de cobre',
                                MIXTO_CU: 'Transición mixta óxido-sulfuro de cobre',
                                SULFURO_SECUNDARIO_CU: 'Calcocita/covelina o sulfuro secundario oscuro/azulado',
                                SULFURO_PRIMARIO_CU: 'Calcopirita/pirita o mena sulfurada primaria grisácea metálica',
                                CONCENTRADO_CU: 'Concentrado fino de flotación de alto brillo o humedad controlada',
                                BAJA_LEY_CU: 'Mineral marginal de baja ley enviado a botadero lixiviable',
                                ESTERIL_RIPIOS: 'Roca estéril o ripio lixiviado sin mineralización de cobre relevante',
                            },
                        },
                        tipo_granulometria: {
                            type: 'choice',
                            instructions:
                                'Clasifica la granulometría visual dominante del acopio.',
                            criteria: {
                                COLPAS: 'Bloques y fragmentos gruesos predominantes (> 150 mm)',
                                GRANSA: 'Material chancado intermedio uniforme',
                                MIXTO: 'Mezcla heterogénea de colpas, gransa y finos',
                                FINOS: 'Material fino arenoso o pulpa/concentrado seco (< 12 mm)',
                            },
                        },
                    },
                }).catch(() => null),
            ]);

            const parsedRaw = parseJsonObjectFromAiText(genRes.text);
            const extracted = AiEnrichExtractedSchema.safeParse(parsedRaw || {});

            type AiProposalItem = {
                field: string;
                current: string;
                suggested: string;
                rawValue: string | number;
                confidence: number;
                source: 'GEMINI_VISION' | 'GEMINI_DECISIONS' | 'GEMINI_LAB_DOC';
            };
            const proposals: AiProposalItem[] = [];

            const pushProposal = (
                field: string,
                rawValue: string | number | null | undefined,
                formattedSuggested: string,
                confidence: number,
                source: AiProposalItem['source']
            ) => {
                if (rawValue === null || rawValue === undefined) return;
                if (typeof rawValue === 'string' && rawValue.trim().length === 0) return;
                const currentRaw = existingData[field];
                const currentText =
                    currentRaw !== undefined && currentRaw !== null && String(currentRaw).trim() !== ''
                        ? String(currentRaw)
                        : '[Pendiente de registro]';
                if (String(currentRaw ?? '') === String(rawValue)) return;
                proposals.push({
                    field,
                    current: currentText,
                    suggested: formattedSuggested,
                    rawValue,
                    confidence: Math.round(confidence * 100) / 100,
                    source,
                });
            };

            const docSource: AiProposalItem['source'] = labDocumentBase64
                ? 'GEMINI_LAB_DOC'
                : 'GEMINI_VISION';

            if (decisionRes?.answers?.copper_domain?.type === 'choice') {
                const cd = decisionRes.answers.copper_domain;
                if (cd.choice && cd.confidence >= 0.45) {
                    pushProposal('copper_domain', cd.choice, cd.choice, cd.confidence, 'GEMINI_DECISIONS');
                }
            }

            if (decisionRes?.answers?.tipo_granulometria?.type === 'choice') {
                const tg = decisionRes.answers.tipo_granulometria;
                if (tg.choice && tg.confidence >= 0.45) {
                    pushProposal(
                        'tipo_granulometria',
                        tg.choice,
                        tg.choice,
                        tg.confidence,
                        'GEMINI_DECISIONS'
                    );
                }
            }

            if (extracted.success) {
                const e = extracted.data;
                if (e.location_ref) {
                    pushProposal('location_ref', e.location_ref, e.location_ref, 0.8, docSource);
                }
                if (e.description) {
                    pushProposal('description', e.description, e.description, 0.8, docSource);
                }
                if (typeof e.density_factor === 'number') {
                    pushProposal(
                        'density_factor',
                        e.density_factor,
                        `${e.density_factor} t/m3`,
                        0.72,
                        docSource
                    );
                }
                if (typeof e.moisture_pct === 'number') {
                    pushProposal(
                        'moisture_pct',
                        e.moisture_pct,
                        `${e.moisture_pct} %`,
                        0.9,
                        docSource
                    );
                }
                if (typeof e.cu_total_pct === 'number') {
                    pushProposal(
                        'cu_total_pct',
                        e.cu_total_pct,
                        `${e.cu_total_pct} %`,
                        0.9,
                        docSource
                    );
                }
                if (typeof e.cu_soluble_pct === 'number') {
                    pushProposal(
                        'cu_soluble_pct',
                        e.cu_soluble_pct,
                        `${e.cu_soluble_pct} %`,
                        0.9,
                        docSource
                    );
                }
                if (typeof e.tml_pct === 'number') {
                    pushProposal('tml_pct', e.tml_pct, `${e.tml_pct} %`, 0.9, docSource);
                }
                if (typeof e.residence_days === 'number') {
                    pushProposal(
                        'residence_days',
                        e.residence_days,
                        `${e.residence_days} d`,
                        0.85,
                        docSource
                    );
                }
                if (typeof e.peso_romana === 'number') {
                    pushProposal('peso_romana', e.peso_romana, `${e.peso_romana} t`, 0.9, docSource);
                }
            }

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'AI_INFERENCE_HITL_REQUEST',
                module: 'stockpile',
                targetEntity: stockpileId,
                details: {
                    proposalCount: proposals.length,
                    proposedFields: proposals.map((p) => p.field),
                    hasImage: Boolean(imageBase64),
                    hasLabDoc: Boolean(labDocumentBase64),
                    hasVoiceNote: Boolean(voiceNoteText),
                    modelUsed: genRes.model,
                    decisionsEngine: decisionRes?.engineUsed || 'NONE',
                },
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                verified: true,
                proposals,
                reasoning:
                    (extracted.success ? extracted.data.reasoning : null) ||
                    'Propuestas generadas bajo supervisión HITL sin modificar ficha oficial.',
                modelUsed: genRes.model,
                engineUsed: decisionRes?.engineUsed || 'SWARM_GENERATE',
                latencyMs: Date.now() - startTime,
            });
        } catch (error: any) {
            if (error instanceof AISwarmUnavailableError) {
                return res.status(503).json({ error: error.message });
            }
            console.error('[GEOLAPP-CONTROLLER] Error en ai-enrich:', error);
            return res.status(500).json({ error: 'Error interno ejecutando enriquecimiento IA.' });
        }
    }
);

const DigitalScaleAnchorEnum = z.enum([
    'CONO_070',
    'MIRA_100',
    'CASCO_030',
    'BALDE_280',
    'MANUAL_BASE_M',
    'NONE',
]);

const DEFAULT_ANCHOR_METERS: Record<string, number> = {
    CONO_070: 0.7,
    MIRA_100: 1.0,
    CASCO_030: 0.3,
    BALDE_280: 2.8,
};

const DigitalAnalyzeBodySchema = z
    .object({
        tenantId: z.string().trim().max(128).optional(),
        measurementId: z.string().trim().max(128).optional(),
        imageBase64: z.string().min(8).max(4_000_000).optional(),
        imageMimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
        extraImagesBase64: z.array(z.string().min(8).max(4_000_000)).max(3).optional(),
        photoUrl: z.string().trim().max(2048).optional(),
        scaleAnchorType: DigitalScaleAnchorEnum.optional().default('NONE'),
        scaleAnchorMeters: z.number().finite().positive().max(25).optional(),
        referenceBaseMeters: z.number().finite().positive().max(500).optional(),
        imuPitchDeg: z.number().finite().min(-90).max(90).optional(),
        imuRollDeg: z.number().finite().min(-180).max(180).optional(),
        locale: z.enum(['es', 'en', 'pt']).optional().default('es'),
    })
    .superRefine((val, ctx) => {
        if (!val.imageBase64 && !val.photoUrl) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Incluya imageBase64 o photoUrl para análisis fotográfico digital IA.',
            });
        }
    });

const DigitalAiExtractedSchema = z.object({
    anchor_detected: z.boolean().optional().default(false),
    slope_angle_left_deg: z.number().finite().min(5).max(89).nullable().optional(),
    slope_angle_right_deg: z.number().finite().min(5).max(89).nullable().optional(),
    slope_angle_avg_deg: z.number().finite().min(5).max(89).nullable().optional(),
    suggested_density_t_m3: z.number().finite().min(0.5).max(8).nullable().optional(),
    estimated_dimensions_m: z
        .object({
            a: z.number().finite().positive().max(1000),
            b: z.number().finite().positive().max(1000),
            h: z.number().finite().positive().max(300),
            ap: z.number().finite().nonnegative().max(1000).optional(),
            bp: z.number().finite().nonnegative().max(1000).optional(),
        })
        .nullable()
        .optional(),
    confidence: z.number().finite().min(0).max(1).optional().default(0.75),
    reasoning: z.string().trim().max(600).nullable().optional(),
});

const STOCKPILE_CLASSIFICATION_QUESTIONS = {
    geometry_type: {
        type: 'choice' as const,
        instructions: 'Identifica la forma geométrica dominante del acopio fotografiado.',
        criteria: {
            CONO_ELIPTICO: 'Pila cónica con vértice agudo y huella circular o elíptica libre',
            CONO_ELIPTICO_TRUNCADO: 'Pila cónica o botadero con plataforma superior plana horizontal',
            PILA_LONGITUDINAL_WINDROW: 'Cordón o camellón alargado lineal con cabeceras redondeadas',
            ACOPIO_CONTRA_MURO: 'Acopio descargado contra muro de contención o pared trasera/bunker',
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
    copper_domain: {
        type: 'choice' as const,
        instructions: 'Clasifica el material / dominio mineral visual más probable.',
        criteria: {
            OXIDO_CU: 'Tonalidades verdosas/azuladas o mineral oxidado de cobre',
            MIXTO_CU: 'Transición mixta óxido-sulfuro de cobre',
            SULFURO_SECUNDARIO_CU: 'Calcocita/covelina o sulfuro secundario oscuro/azulado',
            SULFURO_PRIMARIO_CU: 'Calcopirita/pirita o mena sulfurada primaria grisácea metálica',
            CONCENTRADO_CU: 'Concentrado fino de flotación oscuro/brillante',
            BAJA_LEY_CU: 'Mineral marginal o ripio mineralizado de baja ley',
            ESTERIL_RIPIOS: 'Roca estéril, lastre o árido sin mineralización relevante',
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

async function collectVisualMediaParts(params: {
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
    } else if (
        params.photoUrl &&
        /^https:\/\/(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\//i.test(params.photoUrl)
    ) {
        try {
            const imgRes = await safeFetchExternal(params.photoUrl, {
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

    if (Array.isArray(params.extraImagesBase64)) {
        for (const extra of params.extraImagesBase64.slice(0, params.maxExtra ?? 3)) {
            mediaParts.push({ mimeType: 'image/webp', dataBase64: extra });
        }
    }

    return mediaParts;
}

function parseStockpileDecisionChoices(decisionRes: any) {
    const rawGeomChoice =
        decisionRes?.answers?.geometry_type?.type === 'choice'
            ? decisionRes.answers.geometry_type.choice
            : 'CONO_ELIPTICO';
    const geometryType = (
        ['CONO_ELIPTICO', 'CONO_ELIPTICO_TRUNCADO', 'PILA_LONGITUDINAL_WINDROW', 'ACOPIO_CONTRA_MURO'].includes(
            rawGeomChoice
        )
            ? rawGeomChoice
            : 'CONO_ELIPTICO'
    ) as
        | 'CONO_ELIPTICO'
        | 'CONO_ELIPTICO_TRUNCADO'
        | 'PILA_LONGITUDINAL_WINDROW'
        | 'ACOPIO_CONTRA_MURO';

    const rawWallChoice =
        decisionRes?.answers?.wall_confinement?.type === 'choice'
            ? decisionRes.answers.wall_confinement.choice
            : 'NONE';
    const wallConfinement = (
        ['NONE', 'SINGLE_WALL', 'BUNKER_3_WALLS'].includes(rawWallChoice)
            ? rawWallChoice
            : geometryType === 'ACOPIO_CONTRA_MURO'
              ? 'SINGLE_WALL'
              : 'NONE'
    ) as 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';

    const copperDomain =
        decisionRes?.answers?.copper_domain?.type === 'choice' &&
        decisionRes.answers.copper_domain.confidence >= 0.45
            ? decisionRes.answers.copper_domain.choice
            : null;
    const granulometry =
        decisionRes?.answers?.tipo_granulometria?.type === 'choice' &&
        decisionRes.answers.tipo_granulometria.confidence >= 0.45
            ? decisionRes.answers.tipo_granulometria.choice
            : null;

    return { geometryType, wallConfinement, copperDomain, granulometry };
}

async function runDigitalStockpileAnalyze(params: {
    tenantId: string;
    body: z.infer<typeof DigitalAnalyzeBodySchema>;
}) {
    const { body, tenantId } = params;
    const mediaParts = await collectVisualMediaParts({
        imageBase64: body.imageBase64,
        imageMimeType: body.imageMimeType,
        extraImagesBase64: body.extraImagesBase64,
        photoUrl: body.photoUrl,
        maxExtra: 3,
    });

    if (mediaParts.length === 0) {
        throw new Error('No se dispuso de imagen decodificable para análisis visual IA.');
    }

    const anchorMeters =
        body.scaleAnchorMeters ?? DEFAULT_ANCHOR_METERS[body.scaleAnchorType] ?? undefined;
    const hasExplicitReferenceBase =
        typeof body.referenceBaseMeters === 'number' && Number.isFinite(body.referenceBaseMeters) && body.referenceBaseMeters > 0;

    const contextLines = [
        `Ancla de escala declarada: ${body.scaleAnchorType}${anchorMeters ? ` (${anchorMeters} m)` : ''}`,
        hasExplicitReferenceBase
            ? `Cota base de referencia medida por operador: ${body.referenceBaseMeters} m`
            : 'Sin cota manual ingresada; usar ancla visual solo si es claramente visible.',
        typeof body.imuPitchDeg === 'number'
            ? `Inclinacion IMU dispositivo (pitch): ${body.imuPitchDeg} grados (compensar perspectiva)`
            : '',
        typeof body.imuRollDeg === 'number'
            ? `Alabeo IMU dispositivo (roll): ${body.imuRollDeg} grados`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const extractionPrompt = [
        `Eres ingeniero geotécnico/geomensor de MINREPORT · ACOPIOS. Analiza las fotografías del acopio de mineral o árido.`,
        `Idioma de reasoning: ${body.locale}.`,
        `1. Determina los ángulos aparentes de talud izquierdo, derecho y promedio compensando la inclinación IMU si existe.`,
        `2. Verifica si el objeto ancla declarado (${body.scaleAnchorType}${anchorMeters ? ` = ${anchorMeters} m` : ''}) es claramente visible junto al acopio.`,
        `3. REGLA CERO ALUCINACIONES: Si anchor_detected es false Y no se proveyó cota base de referencia (${hasExplicitReferenceBase ? body.referenceBaseMeters : 'ninguna'}), DEBES devolver estimated_dimensions_m: null. Jamás inventes metros sin referencia métrica real.`,
        `4. Estima suggested_density_t_m3 solo acorde al tipo visual de mineral/árido (1.40 - 2.60 t/m3), o null si es indistinguible.`,
        contextLines,
        `Responde ÚNICAMENTE JSON válido exacto: {"anchor_detected": boolean, "slope_angle_left_deg": number|null, "slope_angle_right_deg": number|null, "slope_angle_avg_deg": number|null, "suggested_density_t_m3": number|null, "estimated_dimensions_m": {"a": number, "b": number, "h": number, "ap": number, "bp": number}|null, "confidence": number, "reasoning": string|null}.`,
    ].join('\n');

    const [genRes, decisionRes] = await Promise.all([
        ResilientAIClient.generate({
            prompt: extractionPrompt,
            module: 'stockpile',
            tenantId,
            thinkingLevel: 'medium',
            requireHITL: false,
            responseMimeType: 'application/json',
            media: mediaParts,
        }),
        ResilientAIClient.decide({
            module: 'stockpile',
            tenantId,
            dataClassification: 'TENANT_PRIVATE',
            inputText: contextLines,
            media: mediaParts,
            questions: STOCKPILE_CLASSIFICATION_QUESTIONS,
        }).catch(() => null),
    ]);

    const parsedRaw = parseJsonObjectFromAiText(genRes.text);
    const extractedRes = DigitalAiExtractedSchema.safeParse(parsedRaw || {});
    const extracted = extractedRes.success
        ? extractedRes.data
        : {
              anchor_detected: false,
              slope_angle_left_deg: null,
              slope_angle_right_deg: null,
              slope_angle_avg_deg: null,
              suggested_density_t_m3: null,
              estimated_dimensions_m: null,
              confidence: 0.5,
              reasoning: 'Respuesta parcial del analizador visual.',
          };

    const { geometryType, wallConfinement, copperDomain, granulometry } =
        parseStockpileDecisionChoices(decisionRes);

    const anchorDetected = Boolean(extracted.anchor_detected && body.scaleAnchorType !== 'NONE');
    const scaleVerified = Boolean(
        (anchorDetected || hasExplicitReferenceBase) &&
            extracted.estimated_dimensions_m &&
            extracted.estimated_dimensions_m.a > 0 &&
            extracted.estimated_dimensions_m.b > 0 &&
            extracted.estimated_dimensions_m.h > 0
    );

    const dimensionsM = scaleVerified && extracted.estimated_dimensions_m
        ? {
              a: Math.round(extracted.estimated_dimensions_m.a * 100) / 100,
              b: Math.round(extracted.estimated_dimensions_m.b * 100) / 100,
              h: Math.round(extracted.estimated_dimensions_m.h * 100) / 100,
              ...(typeof extracted.estimated_dimensions_m.ap === 'number'
                  ? { ap: Math.round(extracted.estimated_dimensions_m.ap * 100) / 100 }
                  : {}),
              ...(typeof extracted.estimated_dimensions_m.bp === 'number'
                  ? { bp: Math.round(extracted.estimated_dimensions_m.bp * 100) / 100 }
                  : {}),
          }
        : null;

    const avgSlope =
        typeof extracted.slope_angle_avg_deg === 'number'
            ? Math.round(extracted.slope_angle_avg_deg * 10) / 10
            : typeof extracted.slope_angle_left_deg === 'number' &&
                typeof extracted.slope_angle_right_deg === 'number'
              ? Math.round(
                    ((extracted.slope_angle_left_deg + extracted.slope_angle_right_deg) / 2) * 10
                ) / 10
              : null;

    let volumeM3 = 0;
    let slopeWarning: string | null = null;
    if (dimensionsM) {
        const confinementForCalc: SlopeConfinementMode =
            wallConfinement === 'BUNKER_3_WALLS' ? 'BUNKER_3_WALLS' : 'SINGLE_WALL';
        volumeM3 = computeStockpileVolumeV2({
            geometryType,
            dimensions: dimensionsM,
            confinement: confinementForCalc,
            slopeAngleDeg: avgSlope ?? 40,
        });
        const physics = evaluateStockpileSlopePhysics({
            geometryType,
            dimensions: dimensionsM,
        });
        slopeWarning = physics.warning;
    } else if (typeof avgSlope === 'number' && avgSlope > 48) {
        slopeWarning = `Ángulo detectado ${avgSlope}° supera talud natural típico (37°–45°).`;
    }

    const densityVal =
        typeof extracted.suggested_density_t_m3 === 'number'
            ? Math.round(extracted.suggested_density_t_m3 * 100) / 100
            : null;
    const weightT =
        volumeM3 > 0 && densityVal ? Math.round(volumeM3 * densityVal * 100) / 100 : 0;

    return {
        verified: true,
        scaleVerified,
        pendingScaleCalibration: !scaleVerified,
        geometryType,
        wallConfinement,
        copperDomain,
        granulometry,
        suggestedDensityTm3: densityVal,
        slopeAngleLeftDeg: extracted.slope_angle_left_deg ?? null,
        slopeAngleRightDeg: extracted.slope_angle_right_deg ?? null,
        slopeAngleAvgDeg: avgSlope,
        slopeWarning,
        anchorDetected,
        dimensionsM,
        volumeM3,
        weightT,
        confidence: extracted.confidence ?? 0.75,
        reasoning:
            extracted.reasoning ||
            (scaleVerified
                ? 'Cubicación digital verificada con referencia métrica y talud IA.'
                : 'Material y talud detectados. Falta referencia física de escala en encuadre o 1 cota base.'),
        modelUsed: genRes.model,
    };
}

/**
 * POST /api/geolapp/digital-analyze
 * Análisis digital inmediato en captura móvil (Opción B: Material + Geometría + Taludes + Escala -> m³ v2).
 */
router.post(
    '/digital-analyze',
    requireAuth,
    aiRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const parsedBody = DigitalAnalyzeBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload de análisis digital inválido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const isDevCaller = resolveCallerPrivilege(req.user).isDevRoot;
            const headerTenant = String(
                parsedBody.data.tenantId ||
                    req.headers['x-active-account-id'] ||
                    req.headers['x-tenant-id'] ||
                    (isDevCaller ? 'dev-master-sandbox' : '')
            ).trim();

            const authz = await authorizeStockpileTenantMutation(req, headerTenant);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const result = await runDigitalStockpileAnalyzeWrapper(headerTenant, parsedBody.data);

            await AuditLedger.record({
                tenantId: headerTenant,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'DIGITAL_STOCKPILE_PREVIEW_ANALYZE',
                module: 'stockpile',
                targetEntity: parsedBody.data.scaleAnchorType,
                details: {
                    scaleVerified: result.scaleVerified,
                    geometryType: result.geometryType,
                    volumeM3: result.volumeM3,
                    slopeAngleAvgDeg: result.slopeAngleAvgDeg,
                    modelUsed: result.modelUsed,
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof AISwarmUnavailableError) {
                return res.status(503).json({ error: error.message });
            }
            console.error('[GEOLAPP-CONTROLLER] Error en digital-analyze:', error);
            return res.status(500).json({ error: 'Error ejecutando análisis digital IA.' });
        }
    }
);

async function runDigitalStockpileAnalyzeWrapper(
    tenantId: string,
    body: z.infer<typeof DigitalAnalyzeBodySchema>
) {
    return runDigitalStockpileAnalyze({ tenantId, body });
}

/**
 * POST /api/geolapp/stockpiles/:id/digital-analyze
 * Procesa diferidamente o reanaliza un acopio capturado offline y consolida resultado en Firestore.
 */
router.post(
    '/stockpiles/:id/digital-analyze',
    requireAuth,
    aiRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const stockpileId = String(req.params.id || '').trim();
            if (!stockpileId || !STOCKPILE_ID_REGEX.test(stockpileId)) {
                return res.status(400).json({ error: 'Identificador de acopio inválido.' });
            }

            const parsedBody = DigitalAnalyzeBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload de análisis digital inválido.',
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

            const result = await runDigitalStockpileAnalyze({
                tenantId: docTenantId,
                body: effectiveBody,
            });

            const now = Date.now();
            const assetPatch: Record<string, unknown> = {
                analysis_status: result.scaleVerified ? 'AI_VERIFIED' : 'PENDING_SCALE',
                detected_slope_angle_deg: result.slopeAngleAvgDeg,
                slope_warning: result.slopeWarning,
                last_geometry_type: result.geometryType,
                geometria: result.geometryType,
                wall_confinement: result.wallConfinement,
                ...(result.copperDomain && !existingData.copper_domain
                    ? { copper_domain: result.copperDomain }
                    : {}),
                ...(result.granulometry && !existingData.tipo_granulometria
                    ? { tipo_granulometria: result.granulometry }
                    : {}),
                ...(result.suggestedDensityTm3 && !existingData.density_factor
                    ? { density_factor: result.suggestedDensityTm3 }
                    : {}),
                ...(result.scaleVerified && result.volumeM3 > 0
                    ? {
                          last_volume_m3: result.volumeM3,
                          volumen: result.volumeM3,
                          volume_m3: result.volumeM3,
                          last_weight_t: result.weightT,
                          weight_t: result.weightT,
                          peso_final_toneladas: result.weightT,
                      }
                    : {}),
                updatedAt: now,
            };

            await docRef.set(assetPatch, { merge: true });

            if (effectiveBody.measurementId) {
                const measRef = docRef.collection('measurements').doc(effectiveBody.measurementId);
                const measSnap = await measRef.get().catch(() => null);
                if (measSnap?.exists) {
                    await measRef.set(
                        {
                            analysis_status: result.scaleVerified ? 'AI_VERIFIED' : 'PENDING_SCALE',
                            detected_slope_angle_deg: result.slopeAngleAvgDeg,
                            slope_left_deg: result.slopeAngleLeftDeg,
                            slope_right_deg: result.slopeAngleRightDeg,
                            slope_warning: result.slopeWarning,
                            wall_confinement: result.wallConfinement,
                            ...(result.dimensionsM
                                ? {
                                      geometry: {
                                          type: result.geometryType,
                                          dimensions: result.dimensionsM,
                                      },
                                  }
                                : {}),
                            ...(result.scaleVerified && result.volumeM3 > 0
                                ? {
                                      volumen_m3: result.volumeM3,
                                      peso_t: result.weightT,
                                      ...(result.suggestedDensityTm3
                                          ? { density_factor: result.suggestedDensityTm3 }
                                          : {}),
                                  }
                                : {}),
                            updatedAt: now,
                        },
                        { merge: true }
                    );
                }
            }

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'DIGITAL_STOCKPILE_AI_ANALYZE',
                module: 'stockpile',
                targetEntity: stockpileId,
                details: {
                    measurementId: effectiveBody.measurementId || null,
                    scaleVerified: result.scaleVerified,
                    geometryType: result.geometryType,
                    volumeM3: result.volumeM3,
                    slopeAngleAvgDeg: result.slopeAngleAvgDeg,
                    modelUsed: result.modelUsed,
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof AISwarmUnavailableError) {
                return res.status(503).json({ error: error.message });
            }
            console.error('[GEOLAPP-CONTROLLER] Error en stockpiles/:id/digital-analyze:', error);
            return res.status(500).json({ error: 'Error ejecutando análisis digital en acopio.' });
        }
    }
);

const ImportDeviceCatalogCsvBodySchema = z.object({
    csvText: z.string().min(20).max(5_000_000),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});

/**
 * GET /api/geolapp/device-catalog
 * Retorna el catálogo vivo de compatibilidad hardware (Android/iOS) en `southamerica-west1`.
 */
router.get('/device-catalog', requireAuth, async (_req: AuthRequest, res: Response) => {
    try {
        const catalog = await getSpatialDeviceCatalog();
        return res.status(200).json({
            success: true,
            catalog,
        });
    } catch (error) {
        console.error('[MINREPORT-ACOPIOS] Error consultando device-catalog:', error);
        return res.status(500).json({ error: 'Error consultando catalogo de compatibilidad.' });
    }
});

/**
 * POST /api/geolapp/device-catalog/sync
 * Sincroniza el catálogo vivo desde fuentes oficiales ARCore (`DEV_ROOT` o `SUPER_ADMIN`).
 */
router.post(
    '/device-catalog/sync',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const privilege = resolveCallerPrivilege(req.user);
            if (!privilege.uid) {
                return res.status(401).json({ error: 'No autorizado: token de sesion ausente.' });
            }
            if (!privilege.isDevRoot && !privilege.isSuperAdmin) {
                return res.status(403).json({
                    error: 'FORBIDDEN: Solo DEV_ROOT o SUPER_ADMIN pueden sincronizar el catalogo de dispositivos.',
                });
            }

            const syncResult = await syncSpatialDeviceCatalogFromOfficialSources({
                uid: privilege.uid,
                email: privilege.emailLower || privilege.uid,
                tenantId: 'global',
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                success: true,
                catalog: syncResult.catalog,
                syncedFromRemote: syncResult.syncedFromRemote,
                fallbackUsed: syncResult.fallbackUsed,
                warning: syncResult.warning,
            });
        } catch (error) {
            console.error('[MINREPORT-ACOPIOS] Error sincronizando device-catalog:', error);
            return res.status(500).json({ error: 'Error sincronizando catalogo oficial de dispositivos.' });
        }
    }
);

export const schedulerOidcClient = new OAuth2Client();

const DEFAULT_SCHEDULER_CLOUD_RUN_AUDIENCE = 'https://minreport-api-d7uuryuo4a-tl.a.run.app';
const DEFAULT_SCHEDULER_SA = '493995072778-compute@developer.gserviceaccount.com';

/**
 * POST /api/geolapp/internal/device-catalog/scheduled-sync
 * Cron semanal ejecutado por Cloud Scheduler mediante verificación estricta Google OIDC (Fail-Closed).
 */
router.post(
    '/internal/device-catalog/scheduled-sync',
    mutationRateLimiter,
    async (req: Request, res: Response) => {
        try {
            const authHeader = String(req.headers.authorization || '').trim();
            if (!authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'UNAUTHORIZED: Token OIDC ausente.' });
            }
            const idToken = authHeader.slice(7).trim();
            if (!idToken) {
                return res.status(401).json({ error: 'UNAUTHORIZED: Token OIDC ausente.' });
            }

            const allowedAudiences = Array.from(
                new Set(
                    [process.env.CLOUD_RUN_SERVICE_URL, DEFAULT_SCHEDULER_CLOUD_RUN_AUDIENCE]
                        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                        .map((v) => v.trim().replace(/\/+$/, ''))
                )
            );

            let payload: Record<string, any> | undefined;
            try {
                const ticket = await schedulerOidcClient.verifyIdToken({
                    idToken,
                    audience: allowedAudiences,
                });
                payload = ticket.getPayload() as Record<string, any> | undefined;
            } catch {
                return res.status(401).json({ error: 'UNAUTHORIZED: Token OIDC invalido.' });
            }

            const configuredSAs = String(process.env.SPATIAL_CATALOG_SCHEDULER_SA || '')
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            const allowedServiceAccounts = new Set<string>([
                DEFAULT_SCHEDULER_SA,
                ...configuredSAs,
            ]);

            const tokenEmail = String(payload?.email || '').trim().toLowerCase();
            if (
                payload?.email_verified !== true ||
                !tokenEmail ||
                !allowedServiceAccounts.has(tokenEmail)
            ) {
                return res.status(403).json({
                    error: 'FORBIDDEN: Service Account no autorizada para cron de catalogo.',
                });
            }

            const syncResult = await syncSpatialDeviceCatalogFromOfficialSources({
                uid: 'cloud-scheduler',
                email: tokenEmail,
                tenantId: 'global',
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                success: true,
                syncedFromRemote: syncResult.syncedFromRemote,
                fallbackUsed: syncResult.fallbackUsed,
                warning: syncResult.warning,
                totalCount: syncResult.catalog.totalCount,
                optimalCount: syncResult.catalog.optimalCount,
                vioCount: syncResult.catalog.vioCount,
                ruggedCount: syncResult.catalog.ruggedCount,
                sourceHash: syncResult.catalog.sourceHash,
                updatedAtIso: syncResult.catalog.updatedAtIso,
            });
        } catch (error) {
            console.error('[MINREPORT-ACOPIOS] Error en scheduled-sync device-catalog:', error);
            return res.status(500).json({ error: 'Error ejecutando sincronizacion programada.' });
        }
    }
);

/**
 * POST /api/geolapp/device-catalog/import-csv
 * Importa CSV oficial de Google Play Console Device Catalog bajo compuerta HITL (`ACTUALIZAR`).
 */
router.post(
    '/device-catalog/import-csv',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const privilege = resolveCallerPrivilege(req.user);
            if (!privilege.uid) {
                return res.status(401).json({ error: 'No autorizado: token de sesion ausente.' });
            }
            if (!privilege.isDevRoot && !privilege.isSuperAdmin) {
                return res.status(403).json({
                    error: 'FORBIDDEN: Solo DEV_ROOT o SUPER_ADMIN pueden importar catalogo CSV.',
                });
            }

            const parsedBody = ImportDeviceCatalogCsvBodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload CSV invalido: requiere csvText y confirmationKeyword="ACTUALIZAR".',
                    details: parsedBody.error.flatten(),
                });
            }

            const result = await importGooglePlayDeviceCatalogCsv({
                csvText: parsedBody.data.csvText,
                actor: {
                    uid: privilege.uid,
                    email: privilege.emailLower || privilege.uid,
                    tenantId: 'global',
                    ipAddress: extractClientIp(req),
                },
            });

            return res.status(200).json({
                success: true,
                catalog: result.catalog,
                importedCount: result.importedCount,
            });
        } catch (error: any) {
            if (error instanceof SpatialCatalogValidationError) {
                return res.status(400).json({ error: error.message });
            }
            console.error('[MINREPORT-ACOPIOS] Error importando device-catalog CSV:', error);
            return res.status(500).json({ error: 'Error importando CSV de Google Play Console.' });
        }
    }
);

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
    sectorsCovered: z.number().int().min(0).max(16),
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
    pointsM: z.array(SpatialPointTupleSchema).min(20).max(12000),
    groundSamplesM: z.array(SpatialPointTupleSchema).max(4000).optional(),
    imageBase64: z.string().min(8).max(4_000_000).optional(),
    imageMimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
    extraImagesBase64: z.array(z.string().min(8).max(4_000_000)).max(5).optional(),
    photoUrl: z.string().trim().max(2048).optional(),
    locale: z.enum(['es', 'en', 'pt']).optional().default('es'),
});

const SpatialDensityExtractSchema = z.object({
    suggested_density_t_m3: z.number().finite().min(0.5).max(8).nullable().optional(),
    reasoning: z.string().trim().max(600).nullable().optional(),
});

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
        anchorCenter: body.anchorCenter,
        coveragePct: body.coveragePct,
        sectorsCovered: body.sectorsCovered,
        loopClosed: body.loopClosed,
        depthMode: body.depthMode,
    });

    if (!(spatial.volumeM3 > 0)) {
        throw new SpatialVolumeValidationError(
            'El volumen cubicado desde la nube 3D debe ser > 0 m3.'
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
                suggestedDensityTm3: null,
                reasoning: `Cubicación métrica 3D (${body.depthMode}, cobertura ${body.coveragePct}%, pie ${spatial.toeScore}/100).`,
            };
        }

        const contextLines = [
            `Dimensiones métricas reales de nube 3D: a=${spatial.dimensionsM.a}m, b=${spatial.dimensionsM.b}m, h=${spatial.dimensionsM.h}m`,
            `Volumen 3D ya calculado (NO modificar): ${spatial.volumeM3} m3`,
            `Talud medio medido: ${spatial.slopeAngleAvgDeg ?? 'N/A'}°`,
        ].join('\n');

        const densityPrompt = [
            `Eres ingeniero geo-metalúrgico de MINREPORT · ACOPIOS.`,
            `El volumen métrico 3D ya fue medido por fotogrametría/Depth (${spatial.volumeM3} m3); NO estimes dimensiones ni volumen.`,
            `Idioma de reasoning: ${body.locale}.`,
            `Estima únicamente suggested_density_t_m3 (1.40 - 2.60 t/m3) acorde al material visible en la fotografía, o null si no es determinable con certeza.`,
            contextLines,
            `Responde ÚNICAMENTE JSON válido: {"suggested_density_t_m3": number|null, "reasoning": string|null}.`,
        ].join('\n');

        const [genRes, decisionRes] = await Promise.all([
            ResilientAIClient.generate({
                prompt: densityPrompt,
                module: 'stockpile',
                tenantId,
                thinkingLevel: 'low',
                requireHITL: false,
                responseMimeType: 'application/json',
                media: mediaParts,
            }).catch(() => null),
            ResilientAIClient.decide({
                module: 'stockpile',
                tenantId,
                dataClassification: 'TENANT_PRIVATE',
                inputText: contextLines,
                media: mediaParts,
                questions: STOCKPILE_CLASSIFICATION_QUESTIONS,
            }).catch(() => null),
        ]);

        const choices = parseStockpileDecisionChoices(decisionRes);
        const parsedDensityRaw = genRes ? parseJsonObjectFromAiText(genRes.text) : null;
        const densityParsed = SpatialDensityExtractSchema.safeParse(parsedDensityRaw || {});

        const suggestedDensityTm3 =
            densityParsed.success && typeof densityParsed.data.suggested_density_t_m3 === 'number'
                ? Math.round(densityParsed.data.suggested_density_t_m3 * 100) / 100
                : null;
        const reasoning =
            (densityParsed.success && densityParsed.data.reasoning) ||
            `Cubicación métrica 3D (${body.depthMode}, cobertura ${body.coveragePct}%, pie ${spatial.toeScore}/100).`;

        return {
            geometryType: choices.geometryType,
            wallConfinement: choices.wallConfinement,
            copperDomain: choices.copperDomain,
            granulometry: choices.granulometry,
            suggestedDensityTm3,
            reasoning,
        };
    })();

    const [descriptor, visual] = await Promise.all([persistMeshPromise, visualClassifyPromise]);

    const weightT =
        visual.suggestedDensityTm3 !== null
            ? Math.round(spatial.volumeM3 * visual.suggestedDensityTm3 * 100) / 100
            : 0;
    const savingsPct =
        typeof descriptor.savingsPct === 'number'
            ? descriptor.savingsPct
            : Number((descriptor.savingsRatio * 100).toFixed(1));

    return {
        result: {
            verified: true,
            scaleVerified: true,
            volumeM3: spatial.volumeM3,
            weightT,
            uncertaintyPct: spatial.uncertaintyPct,
            toeScore: spatial.toeScore,
            coveragePct: body.coveragePct,
            depthMode: body.depthMode,
            groundSlopeDeg: spatial.groundSlopeDeg,
            geometryType: visual.geometryType,
            wallConfinement: visual.wallConfinement,
            copperDomain: visual.copperDomain,
            granulometry: visual.granulometry,
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

            const isDevCaller = resolveCallerPrivilege(req.user).isDevRoot;
            const headerTenant = String(
                parsedBody.data.tenantId ||
                    req.headers['x-active-account-id'] ||
                    req.headers['x-tenant-id'] ||
                    (isDevCaller ? 'dev-master-sandbox' : '')
            ).trim();

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
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof SpatialVolumeValidationError) {
                return res.status(400).json({ error: error.message });
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
            const resolvedWeightT =
                result.weightT > 0
                    ? result.weightT
                    : typeof existingData.density_factor === 'number' && existingData.density_factor > 0
                      ? Math.round(result.volumeM3 * existingData.density_factor * 100) / 100
                      : 0;

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
                ...(result.copperDomain && !existingData.copper_domain
                    ? { copper_domain: result.copperDomain }
                    : {}),
                ...(result.granulometry && !existingData.tipo_granulometria
                    ? { tipo_granulometria: result.granulometry }
                    : {}),
                ...(result.suggestedDensityTm3 && !existingData.density_factor
                    ? { density_factor: result.suggestedDensityTm3 }
                    : {}),
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
                        mesh_url: result.meshUrl,
                        mesh_sha256: result.meshSha256,
                        mesh_source: result.meshSource,
                        tin_volume_m3: persistence.meshResult.tinVolumeM3,
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
                        geometry: {
                            type: result.geometryType,
                            dimensions: result.dimensionsM,
                        },
                        ...(result.suggestedDensityTm3
                            ? { density_factor: result.suggestedDensityTm3 }
                            : {}),
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
                },
                ipAddress: extractClientIp(req),
            }).catch(() => {});

            return res.status(200).json({
                ...result,
                weightT: resolvedWeightT,
            });
        } catch (error: any) {
            if (error instanceof SpatialVolumeValidationError) {
                return res.status(400).json({ error: error.message });
            }
            console.error('[MINREPORT-ACOPIOS] Error en stockpiles/:id/spatial-analyze:', error);
            return res.status(500).json({ error: 'Error ejecutando análisis espacial 3D en acopio.' });
        }
    }
);

export default router;
