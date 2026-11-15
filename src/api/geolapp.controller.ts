import { randomUUID } from 'crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { db } from '../config/firebase';
import { evaluatePilotExpiration } from '../contracts/session.contracts';
import { AuditLedger } from '../core/audit-ledger';
import { CasStorageService } from '../core/media/CasStorageService';
import { MediaDigestorServer } from '../core/media/MediaDigestorServer';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { extractClientIp, mutationRateLimiter } from '../middleware/rateLimiter';
import type { ScopedRequest } from '../middleware/sessionScope';
import {
    buildServerStockpileGlbMesh,
    inspectGlbBinaryMetrics,
    type GlbSurfaceBuildResult,
} from '../modules/geolapp/glb-surface.builder';
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
    clase: z.enum(['mineral', 'esteril', 'baja_ley']).optional(),
    status: StockpileStatusSchema.optional(),
    location_ref: z.string().trim().max(240).optional(),
    geo_point: z
        .object({
            latitude: z.number().finite().min(-90).max(90),
            longitude: z.number().finite().min(-180).max(180),
            altitude: z.number().finite().nullable(),
            accuracy: z.number().finite().nonnegative().optional(),
        })
        .optional(),
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

async function authorizeStockpileTenantMutation(
    req: AuthRequest,
    docTenantId: string
): Promise<TenantDocAuthResult> {
    const caller = req.user || {};
    const uid = String(caller.uid || '').trim();
    const emailLower = String(caller.email || '').toLowerCase();

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

    const emailVerifiedOk = caller.email_verified !== false;

    let profileData: Record<string, any> | null = null;
    try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            profileData = userSnap.data() || null;
        }
    } catch {
        profileData = null;
    }

    const tokenRole = String(caller.role || '').toUpperCase();
    const serverUserRole = String(profileData?.role || '').toUpperCase();

    const isDevRoot =
        caller.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        uid === 'dev-master-root-uid' ||
        (emailVerifiedOk && emailLower === 'dev@minreport.com');

    const isSuperAdmin =
        !isDevRoot &&
        (caller.admin === true ||
            tokenRole === 'SUPER_ADMIN' ||
            uid === 'super-admin-uid' ||
            (emailVerifiedOk &&
                (emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase() ||
                    emailLower === 'admin@minreport.com')));

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

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'GEOLAPP_HITL_UPDATE',
                module: 'stockpile',
                targetEntity: stockpileId,
                details: {
                    hitlConfirmed: true,
                    confirmationKeyword: parsedBody.data.confirmationKeyword,
                    patchedFields: Object.keys(sanitizedPatch),
                    diffSummary: parsedBody.data.diffSummary || [],
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

function validateSovereignMast3rGpuUrl(rawUrl: string): URL {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('GEOLAPP_MAST3R_GPU_URL debe usar HTTPS sin credenciales.');
    }
    if (/(drive|colab|notebooklm|ngrok|localhost|127\.0\.0\.1)/i.test(host)) {
        throw new Error('GEOLAPP_MAST3R_GPU_URL bloqueada: servicio externo no soberano.');
    }
    if (!host.endsWith('.run.app')) {
        throw new Error('GEOLAPP_MAST3R_GPU_URL debe residir en Cloud Run (.run.app).');
    }
    if (!host.includes('southamerica-west1') && !host.endsWith('-tl.a.run.app')) {
        throw new Error('GEOLAPP_MAST3R_GPU_URL debe residir exclusivamente en southamerica-west1.');
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

// ─── FASE 4: DOMINIOS GEOCIENTÍFICOS Y TOPOGRÁFICOS GEOLAPP® ───

const NonStockpileDomainModeSchema = z.enum([
    'GEOMENSURA_GEO',
    'EXPLORACION_SONDAJES',
    'ESTRUCTURAL_HIDRO',
]);

const DomainRecordStatusSchema = z.enum(['ACTIVE', 'VERIFIED', 'ARCHIVED']);

const DATA_URI_BASE64_REGEX = /^\s*data:/i;
const EMBEDDED_BASE64_DATA_URI_REGEX = /data:[a-z0-9.+\/-]*;base64,/i;

function containsDataBase64Url(value: unknown, depth = 0): boolean {
    if (depth > 16 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
        return (
            DATA_URI_BASE64_REGEX.test(value) ||
            EMBEDDED_BASE64_DATA_URI_REGEX.test(value)
        );
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            if (containsDataBase64Url(item, depth + 1)) return true;
        }
        return false;
    }
    if (typeof value === 'object') {
        for (const val of Object.values(value as Record<string, unknown>)) {
            if (containsDataBase64Url(val, depth + 1)) return true;
        }
    }
    return false;
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v !== undefined) {
                cleaned[k] = stripUndefinedDeep(v);
            }
        }
        return cleaned as T;
    }
    return value;
}

const GeolappDomainUtmFixSchema = z.object({
    zone: z.number().int().min(1).max(60),
    band: z.string().trim().min(1).max(8),
    hemisphere: z.enum(['N', 'S']),
    easting: z.number().finite(),
    northing: z.number().finite(),
    altitudeM: z.number().finite().nullable(),
    accuracyM: z.number().finite().nonnegative().nullable().optional(),
    fixQuality: z.string().trim().max(64).nullable().optional(),
});

const GeomensuraPolygonVertexSchema = z.object({
    code: z.string().trim().min(1).max(64),
    easting: z.number().finite(),
    northing: z.number().finite(),
    elevationM: z.number().finite().optional(),
});

const GeomensuraSurveyPayloadSchema = z.object({
    stationCode: z.string().trim().min(1).max(64),
    stationEasting: z.number().finite(),
    stationNorthing: z.number().finite(),
    stationElevationM: z.number().finite(),
    utmZone: z.number().int().min(1).max(60),
    hemisphere: z.enum(['N', 'S']),
    targetCode: z.string().trim().max(64).optional(),
    targetEasting: z.number().finite().optional(),
    targetNorthing: z.number().finite().optional(),
    targetElevationM: z.number().finite().optional(),
    deltaE: z.number().finite().optional(),
    deltaN: z.number().finite().optional(),
    deltaZ: z.number().finite().optional(),
    horizontalDistanceM: z.number().finite().nonnegative().optional(),
    slopeDistanceM: z.number().finite().nonnegative().optional(),
    azimuthDeg: z.number().finite().min(0).max(360).optional(),
    slopePct: z.number().finite().optional(),
    polygonVertices: z.array(GeomensuraPolygonVertexSchema).max(2000).optional(),
    polygonAreaM2: z.number().finite().nonnegative().nullable().optional(),
    polygonPerimeterM: z.number().finite().nonnegative().nullable().optional(),
    rtkFixQuality: z.string().trim().max(64).nullable().optional(),
    hdop: z.number().finite().nonnegative().nullable().optional(),
});

const DrillholeRqdQualitySchema = z.enum([
    'MUY_MALA',
    'MALA',
    'REGULAR',
    'BUENA',
    'EXCELENTE',
]);

const ExploracionIntervalItemSchema = z
    .object({
        id: z.string().trim().min(1).max(128),
        fromM: z.number().finite().nonnegative(),
        toM: z.number().finite().positive(),
        recoveredM: z.number().finite().nonnegative(),
        sumPiecesGe10cmM: z.number().finite().nonnegative(),
        recoveryPct: z.number().finite().min(0).max(100),
        rqdPct: z.number().finite().min(0).max(100),
        rqdQuality: DrillholeRqdQualitySchema,
        lithology: z.string().trim().max(160),
        alteration: z.string().trim().max(160),
        copperDomain: CopperDomainSchema,
        cuTotalPct: z.number().finite().min(0).max(100).nullable(),
        cuSolublePct: z.number().finite().min(0).max(100).nullable(),
        coreBoxPhotoUrl: z.string().trim().max(2048).nullable().optional(),
        coreBoxSha256: z.string().trim().max(128).nullable().optional(),
        coreBoxOriginalBytes: z.number().finite().nonnegative().nullable().optional(),
        coreBoxOptimizedBytes: z.number().finite().nonnegative().nullable().optional(),
        coreBoxSavingsPct: z.number().finite().nullable().optional(),
    })
    .refine((val) => val.toM > val.fromM, {
        message: 'En cada intervalo de sondaje, toM debe ser mayor que fromM.',
    });

const ExploracionSondajePayloadSchema = z.object({
    holeId: z.string().trim().min(1).max(64),
    method: z.enum(['DDH', 'RC']),
    collarEasting: z.number().finite(),
    collarNorthing: z.number().finite(),
    collarElevationM: z.number().finite(),
    utmZone: z.number().int().min(1).max(60),
    hemisphere: z.enum(['N', 'S']),
    azimuthDeg: z.number().finite().min(0).max(360),
    dipDeg: z.number().finite().min(-90).max(90),
    totalDepthM: z.number().finite().nonnegative(),
    intervals: z.array(ExploracionIntervalItemSchema).max(2000),
    weightedCuTotalPct: z.number().finite().min(0).max(100).nullable(),
    weightedCuSolublePct: z.number().finite().min(0).max(100).nullable(),
    meanRqdPct: z.number().finite().min(0).max(100).nullable(),
    meanRecoveryPct: z.number().finite().min(0).max(100).nullable().optional(),
    qaqcSampleType: z.enum(['NONE', 'STANDARD', 'BLANK', 'DUPLICATE']).optional(),
    qaqcOriginalPct: z.number().finite().min(0).max(100).nullable().optional(),
    qaqcCheckPct: z.number().finite().min(0).max(100).nullable().optional(),
    qaqcRpdPct: z.number().finite().nonnegative().nullable().optional(),
    qaqcPassed: z.boolean().nullable().optional(),
});

const EstructuralPlaneItemSchema = z.object({
    id: z.string().trim().min(1).max(128),
    structureType: z.string().trim().min(1).max(64),
    dipDeg: z.number().finite().min(0).max(90),
    dipDirectionDeg: z.number().finite().min(0).max(360),
    strikeDeg: z.number().finite().min(0).max(360),
    jrcBarton: z.number().finite().min(0).max(20).nullable().optional(),
    apertureMm: z.number().finite().nonnegative().nullable().optional(),
    infill: z.string().trim().max(160).optional(),
});

const HydrogeologyReadingSchema = z.object({
    piezometerId: z.string().trim().min(1).max(64),
    staticWaterLevelM: z.number().finite().nullable(),
    wellDepthM: z.number().finite().nonnegative().nullable(),
    ph: z.number().finite().min(0).max(14).nullable(),
    conductivityUsCm: z.number().finite().nonnegative().nullable(),
    temperatureC: z.number().finite().nullable(),
});

const EstructuralHidroPayloadSchema = z.object({
    stationCode: z.string().trim().min(1).max(64),
    easting: z.number().finite().nullable().optional(),
    northing: z.number().finite().nullable().optional(),
    elevationM: z.number().finite().nullable().optional(),
    utmZone: z.number().int().min(1).max(60).nullable().optional(),
    hemisphere: z.enum(['N', 'S']).nullable().optional(),
    planes: z.array(EstructuralPlaneItemSchema).max(2000),
    hydrogeology: HydrogeologyReadingSchema.nullable().optional(),
});

const DomainRecordCommonFields = {
    id: z.string().trim().regex(STOCKPILE_ID_REGEX).optional(),
    tenantId: z.string().trim().regex(TENANT_ID_REGEX),
    accountId: z.string().trim().regex(TENANT_ID_REGEX).optional(),
    code: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(180),
    status: DomainRecordStatusSchema.optional().default('ACTIVE'),
    utmFix: GeolappDomainUtmFixSchema.optional(),
    notes: z.string().trim().max(2500).optional(),
    createdAt: z.number().finite().nonnegative().optional(),
    updatedAt: z.number().finite().nonnegative().optional(),
    createdBy: z.string().trim().min(1).max(160).optional(),
    updatedBy: z.string().trim().min(1).max(160).optional(),
    synced: z.boolean().optional(),
};

const GeolappDomainRecordSchema = z
    .discriminatedUnion('domainMode', [
        z.object({
            ...DomainRecordCommonFields,
            domainMode: z.literal('GEOMENSURA_GEO'),
            payload: GeomensuraSurveyPayloadSchema,
        }),
        z.object({
            ...DomainRecordCommonFields,
            domainMode: z.literal('EXPLORACION_SONDAJES'),
            payload: ExploracionSondajePayloadSchema,
        }),
        z.object({
            ...DomainRecordCommonFields,
            domainMode: z.literal('ESTRUCTURAL_HIDRO'),
            payload: EstructuralHidroPayloadSchema,
        }),
    ])
    .refine((val) => !containsDataBase64Url(val), {
        message: 'BASE64_PROHIBITED: Prohibido almacenar URIs data: Base64 en geolapp_records.',
    });

const DomainRecordHitlPatchSchema = z.object({
    code: z.string().trim().min(1).max(64).optional(),
    title: z.string().trim().min(1).max(180).optional(),
    status: DomainRecordStatusSchema.optional(),
    utmFix: GeolappDomainUtmFixSchema.optional(),
    notes: z.string().trim().max(2500).optional(),
    payload: z.record(z.unknown()).optional(),
});

const DomainRecordHitlBodySchema = z.object({
    confirmationKeyword: z.literal('ACTUALIZAR'),
    patch: DomainRecordHitlPatchSchema,
    diffSummary: z.array(HitlDiffItemSchema).max(50).optional(),
});

function validatePayloadForDomainMode(
    domainMode: unknown,
    payload: unknown
): z.SafeParseReturnType<unknown, unknown> {
    if (domainMode === 'GEOMENSURA_GEO') {
        return GeomensuraSurveyPayloadSchema.safeParse(payload);
    }
    if (domainMode === 'EXPLORACION_SONDAJES') {
        return ExploracionSondajePayloadSchema.safeParse(payload);
    }
    if (domainMode === 'ESTRUCTURAL_HIDRO') {
        return EstructuralHidroPayloadSchema.safeParse(payload);
    }
    return {
        success: false,
        error: new z.ZodError([
            {
                code: z.ZodIssueCode.custom,
                path: ['domainMode'],
                message: 'domainMode no soportado para registro geocientifico.',
            },
        ]),
    };
}

/**
 * GET /api/geolapp/domain-records
 * Lista registros geocientíficos multi-tenant (Geomensura, Sondajes, Estructural/Hidro).
 */
router.get('/domain-records', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = String(req.query.tenantId || '').trim();
        const authz = await authorizeStockpileTenantMutation(req, tenantId);
        if (!authz.authorized) {
            return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
        }

        const rawDomainMode = req.query.domainMode
            ? String(req.query.domainMode).trim()
            : undefined;
        if (rawDomainMode) {
            const parsedMode = NonStockpileDomainModeSchema.safeParse(rawDomainMode);
            if (!parsedMode.success) {
                return res.status(400).json({
                    error: 'Parametro domainMode invalido.',
                    details: parsedMode.error.flatten(),
                });
            }
        }

        const snap = await db
            .collection('geolapp_records')
            .where('tenantId', '==', tenantId)
            .get();

        const items = snap.docs
            .map((doc) => ({
                ...(doc.data() || {}),
                id: doc.id,
            }))
            .filter((item: Record<string, unknown>) => {
                if (String(item.tenantId || item.accountId || '').trim() !== tenantId) {
                    return false;
                }
                if (rawDomainMode && item.domainMode !== rawDomainMode) {
                    return false;
                }
                return true;
            })
            .sort(
                (a: Record<string, unknown>, b: Record<string, unknown>) =>
                    Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
            );

        return res.status(200).json({
            success: true,
            items,
        });
    } catch (error) {
        console.error('[GEOLAPP-CONTROLLER] Error listando domain-records:', error);
        return res.status(500).json({ error: 'Error interno consultando domain-records.' });
    }
});

/**
 * POST /api/geolapp/domain-records
 * Crea o actualiza registro de dominio geocientífico con validación Zod estricta,
 * rechazo explícito de Base64 y trazabilidad en AuditLedger.
 */
router.post(
    '/domain-records',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            if (containsDataBase64Url(req.body)) {
                return res.status(400).json({
                    error: 'BASE64_PROHIBITED: Prohibido enviar o almacenar data: Base64 en geolapp_records.',
                });
            }

            const parsed = GeolappDomainRecordSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Payload de registro geocientifico invalido.',
                    details: parsed.error.flatten(),
                });
            }

            const data = parsed.data;
            const authz = await authorizeStockpileTenantMutation(req, data.tenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const now = Date.now();
            const recordId = data.id || `geo-${now}-${randomUUID().slice(0, 8)}`;
            const record = stripUndefinedDeep({
                ...data,
                id: recordId,
                tenantId: data.tenantId,
                accountId: data.tenantId,
                status: data.status || 'ACTIVE',
                createdAt: data.createdAt || now,
                updatedAt: now,
                createdBy: data.createdBy || authz.uid,
                synced: true,
            });

            await db.collection('geolapp_records').doc(recordId).set(record);

            await AuditLedger.record({
                tenantId: data.tenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'GEOLAPP_DOMAIN_RECORD_CREATED',
                module: 'stockpile',
                targetEntity: recordId,
                details: {
                    domainMode: data.domainMode,
                    code: data.code,
                    title: data.title,
                },
                ipAddress: extractClientIp(req),
            });

            return res.status(201).json({
                success: true,
                record,
            });
        } catch (error) {
            console.error('[GEOLAPP-CONTROLLER] Error creando domain-record:', error);
            return res.status(500).json({ error: 'Error interno guardando domain-record.' });
        }
    }
);

/**
 * PATCH /api/geolapp/domain-records/:id/hitl-update
 * Mutación oficial HITL sobre registro geocientífico con confirmación "ACTUALIZAR",
 * inmutabilidad de id/tenantId/accountId/domainMode, rechazo de Base64 y AuditLedger.
 */
router.patch(
    '/domain-records/:id/hitl-update',
    requireAuth,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response) => {
        try {
            const recordId = String(req.params.id || '').trim();
            if (!recordId || !STOCKPILE_ID_REGEX.test(recordId)) {
                return res.status(400).json({ error: 'Identificador de registro geocientifico invalido.' });
            }

            if (containsDataBase64Url(req.body)) {
                return res.status(400).json({
                    error: 'BASE64_PROHIBITED: Prohibido enviar o almacenar data: Base64 en actualizacion HITL.',
                });
            }

            const parsedBody = DomainRecordHitlBodySchema.safeParse(req.body);
            if (!parsedBody.success) {
                return res.status(400).json({
                    error: 'Payload HITL invalido: requiere confirmationKeyword="ACTUALIZAR" y patch valido.',
                    details: parsedBody.error.flatten(),
                });
            }

            const docRef = db.collection('geolapp_records').doc(recordId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Registro geocientifico no encontrado.' });
            }

            const existingData = (docSnap.data() || {}) as Record<string, any>;
            const docTenantId = String(existingData.tenantId || existingData.accountId || '').trim();
            const authz = await authorizeStockpileTenantMutation(req, docTenantId);
            if (!authz.authorized) {
                return res.status(authz.status).json({ error: authz.error || 'TENANT_ACCESS_DENIED' });
            }

            const rawPatchObj = (req.body?.patch || {}) as Record<string, unknown>;
            if (
                (rawPatchObj.id !== undefined && String(rawPatchObj.id).trim() !== recordId) ||
                (rawPatchObj.tenantId !== undefined &&
                    String(rawPatchObj.tenantId).trim() !== docTenantId) ||
                (rawPatchObj.accountId !== undefined &&
                    String(rawPatchObj.accountId).trim() !== docTenantId) ||
                (rawPatchObj.domainMode !== undefined &&
                    rawPatchObj.domainMode !== existingData.domainMode)
            ) {
                return res.status(400).json({
                    error: 'IMMUTABLE_FIELD_ERROR: No se permite modificar id, tenantId, accountId ni domainMode.',
                });
            }

            const sanitizedPatch: Record<string, unknown> = {};
            const parsedPatch = parsedBody.data.patch;
            if (parsedPatch.code !== undefined) sanitizedPatch.code = parsedPatch.code;
            if (parsedPatch.title !== undefined) sanitizedPatch.title = parsedPatch.title;
            if (parsedPatch.status !== undefined) sanitizedPatch.status = parsedPatch.status;
            if (parsedPatch.utmFix !== undefined) sanitizedPatch.utmFix = parsedPatch.utmFix;
            if (parsedPatch.notes !== undefined) sanitizedPatch.notes = parsedPatch.notes;

            if (parsedPatch.payload !== undefined) {
                const mergedPayloadCandidate = stripUndefinedDeep({
                    ...(existingData.payload && typeof existingData.payload === 'object'
                        ? existingData.payload
                        : {}),
                    ...parsedPatch.payload,
                });
                const payloadCheck = validatePayloadForDomainMode(
                    existingData.domainMode,
                    mergedPayloadCandidate
                );
                if (!payloadCheck.success) {
                    return res.status(400).json({
                        error: 'Payload geocientifico invalido para el dominio del registro.',
                        details: payloadCheck.error.flatten(),
                    });
                }
                sanitizedPatch.payload = payloadCheck.data;
            }

            if (Object.keys(sanitizedPatch).length === 0) {
                return res.status(400).json({
                    error: 'El bloque patch debe incluir al menos un campo tecnico valido.',
                });
            }

            const now = Date.now();
            const updatePayload = stripUndefinedDeep({
                ...sanitizedPatch,
                updatedAt: now,
                updatedBy: authz.uid,
            });

            await docRef.set(updatePayload, { merge: true });

            const updatedRecord = stripUndefinedDeep({
                ...existingData,
                ...updatePayload,
                id: recordId,
                tenantId: docTenantId,
                accountId: docTenantId,
                domainMode: existingData.domainMode,
                synced: true,
            });

            await AuditLedger.record({
                tenantId: docTenantId,
                actorUid: authz.uid,
                actorEmail: authz.emailLower || authz.uid,
                action: 'GEOLAPP_DOMAIN_RECORD_HITL_UPDATED',
                module: 'stockpile',
                targetEntity: recordId,
                details: {
                    domainMode: existingData.domainMode,
                    patchedFields: Object.keys(sanitizedPatch),
                    diffSummary: parsedBody.data.diffSummary || [],
                },
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                success: true,
                record: updatedRecord,
            });
        } catch (error) {
            console.error('[GEOLAPP-CONTROLLER] Error en hitl-update domain-record:', error);
            return res.status(500).json({ error: 'Error interno actualizando domain-record HITL.' });
        }
    }
);

export default router;
