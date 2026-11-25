import { z } from 'zod';

/**
 * MINREPORT · ACOPIOS — Contratos Soberanos V2 (Backend southamerica-west1)
 * Cumplimiento Ley N° 21.719 (cero PII, residencia exclusiva en Santiago) y CAS SHA-256.
 * Define los 3 ejes ortogonales de estado y el paquete de sesión de captura offline/cloud.
 */

export const AcopiosLifecycleStatusSchema = z.enum([
    'CAPTURED_OFFLINE_VALID',
    'SYNCING_RAW_CAS',
    'CLOUD_3D_VERIFIED',
    'REJECTED_METROLOGY',
]);
export type AcopiosLifecycleStatus = z.infer<typeof AcopiosLifecycleStatusSchema>;

export const AcopiosMetrologyGradeSchema = z.enum([
    'VALID_IN_SITU',
    'LOW_CONFIDENCE_RECAPTURE',
    'REJECTED',
]);
export type AcopiosMetrologyGrade = z.infer<typeof AcopiosMetrologyGradeSchema>;

export const AcopiosReconciliationStatusSchema = z.enum([
    'PENDING_CLOUD',
    'AUTO_CONCILIATED',
    'REQUIRES_HITL_REVIEW',
]);
export type AcopiosReconciliationStatus = z.infer<typeof AcopiosReconciliationStatusSchema>;

export const WallConfinementModeSchema = z.enum(['NONE', 'SINGLE_WALL', 'BUNKER_3_WALLS']);
export type WallConfinementMode = z.infer<typeof WallConfinementModeSchema>;

const SAFE_SHA256_REGEX = /^[a-f0-9]{64}$/;
const SAFE_SESSION_ID_REGEX = /^[A-Za-z0-9._-]{4,128}$/;

const NonBase64UrlSchema = z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(
        (val) => !val.toLowerCase().startsWith('data:') && !val.toLowerCase().includes(';base64,'),
        'Prohibido Base64 en URLs CAS; debe ser ruta /api/media/blob/... o HTTPS.'
    );

export const PoseSE3Schema = z.object({
    tx: z.number().finite(),
    ty: z.number().finite(),
    tz: z.number().finite(),
    qx: z.number().finite(),
    qy: z.number().finite(),
    qz: z.number().finite(),
    qw: z.number().finite(),
    timestampMs: z.number().finite().nonnegative().optional(),
});
export type PoseSE3 = z.infer<typeof PoseSE3Schema>;

export const CameraIntrinsicsSchema = z.object({
    fx: z.number().finite().positive(),
    fy: z.number().finite().positive(),
    cx: z.number().finite().nonnegative(),
    cy: z.number().finite().nonnegative(),
    widthPx: z.number().int().positive().max(16384),
    heightPx: z.number().int().positive().max(16384),
});
export type CameraIntrinsics = z.infer<typeof CameraIntrinsicsSchema>;

export const KeyframeCasEntrySchema = z.object({
    index: z.number().int().nonnegative().max(512),
    sha256: z.string().regex(SAFE_SHA256_REGEX),
    downloadUrl: NonBase64UrlSchema,
    mimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).default('image/webp'),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().nonnegative(),
    savingsPct: z.number().finite().min(0).max(100),
    blurScore: z.number().finite().nonnegative().optional(),
    angleDeg: z.number().finite().min(-360).max(360).optional(),
    displayRotationDeg: z.number().finite().min(-360).max(360).optional(),
    poseSE3: PoseSE3Schema,
    intrinsics: CameraIntrinsicsSchema,
});
export type KeyframeCasEntry = z.infer<typeof KeyframeCasEntrySchema>;

export const WalkRingPoseSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    floorY: z.number().finite().optional(),
    timestampMs: z.number().finite().nonnegative().optional(),
});
export type WalkRingPose = z.infer<typeof WalkRingPoseSchema>;

export const SpatialPoint3DSchema = z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
]);

export const InSituMetrologySchema = z.object({
    volumeM3: z.number().finite().nonnegative(),
    uncertaintyPct: z.number().finite().min(0).max(100),
    toeScore: z.number().finite().min(0).max(100),
    occludedVolumePct: z.number().finite().min(0).max(100).default(0),
    zeroCellsInside: z.number().int().nonnegative().default(0),
    loopDriftPct: z.number().finite().min(0).max(100).default(0),
    groundSlopeDeg: z.number().finite().min(0).max(90).default(0),
    planeMismatchDeg: z.number().finite().min(0).max(90).default(0),
    slopeAngleAvgDeg: z.number().finite().min(0).max(90).nullable().optional(),
    slopeAngleLeftDeg: z.number().finite().min(0).max(90).nullable().optional(),
    slopeAngleRightDeg: z.number().finite().min(0).max(90).nullable().optional(),
    dimensionsM: z.object({
        a: z.number().finite().nonnegative(),
        b: z.number().finite().nonnegative(),
        h: z.number().finite().nonnegative(),
    }),
    footprintAreaM2: z.number().finite().nonnegative().optional(),
    metrologyGrade: AcopiosMetrologyGradeSchema,
    metrologyReasons: z.array(z.string().trim().max(200)).max(20).optional().default([]),
    coveragePct: z.number().finite().min(0).max(100),
    sectorsCovered: z.number().int().min(0).max(64),
    sectorsTotal: z.number().int().min(1).max(64).optional().default(8),
    loopClosed: z.boolean(),
    wallConfinement: WallConfinementModeSchema.optional().default('NONE'),
    depthMode: z.string().trim().max(48).optional().default('KNOWN_POSE_MVS_OFFLINE'),
    hasScaleAnchor: z.boolean().optional().default(false),
    computedAt: z.number().finite().nonnegative(),
    engineVersion: z.string().trim().min(1).max(64).default('acopios-offline-v2'),
});
export type InSituMetrology = z.infer<typeof InSituMetrologySchema>;

export const LocalPreviewMeshSchema = z
    .object({
        format: z.literal('dem_grid_v1').default('dem_grid_v1'),
        originX: z.number().finite(),
        originZ: z.number().finite(),
        cellSizeM: z.number().finite().positive().max(5),
        nx: z.number().int().min(2).max(128),
        nz: z.number().int().min(2).max(128),
        heightsM: z.array(z.number().finite().nonnegative()).min(4).max(16384),
        interpolatedMask: z.array(z.number().int().min(0).max(1)).max(16384).optional(),
        observationCount: z.array(z.number().int().nonnegative()).max(16384).optional(),
        slopeDegGrid: z.array(z.number().finite().nonnegative()).max(16384).optional(),
        groundPlane: z.object({
            a: z.number().finite(),
            b: z.number().finite(),
            d: z.number().finite(),
        }),
        byteLength: z.number().int().nonnegative().optional(),
    })
    .superRefine((grid, ctx) => {
        const expected = grid.nx * grid.nz;
        if (grid.heightsM.length !== expected) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `heightsM.length (${grid.heightsM.length}) debe igualar nx*nz (${expected}).`,
            });
        }
    });
export type LocalPreviewMesh = z.infer<typeof LocalPreviewMeshSchema>;

export const CaptureSessionPackageV2Schema = z.object({
    schemaVersion: z.literal('2.0').optional().default('2.0'),
    sessionId: z.string().trim().regex(SAFE_SESSION_ID_REGEX),
    measurementId: z.string().trim().regex(SAFE_SESSION_ID_REGEX).optional(),
    tenantId: z.string().trim().max(128).optional(),
    deviceModel: z.string().trim().max(120).optional(),
    rawBundleSha256: z.string().regex(SAFE_SHA256_REGEX).optional(),
    rawBundleUrl: NonBase64UrlSchema.optional(),
    rawBundleOriginalBytes: z.number().int().nonnegative().optional(),
    rawBundleOptimizedBytes: z.number().int().nonnegative().optional(),
    rawBundleSavingsPct: z.number().finite().min(0).max(100).optional(),
    capturedAt: z.number().finite().nonnegative(),
    locale: z.enum(['es', 'en', 'pt']).optional().default('es'),
    keyframes: z.array(KeyframeCasEntrySchema).max(64).default([]),
    walkRing: z.array(WalkRingPoseSchema).max(1024).default([]),
    pointsM: z.array(SpatialPoint3DSchema).max(20000).optional(),
    groundSamplesM: z.array(SpatialPoint3DSchema).max(4000).optional(),
    anchorCenter: z
        .object({
            x: z.number().finite(),
            y: z.number().finite(),
            z: z.number().finite(),
        })
        .nullable()
        .optional(),
    roiRadiusM: z.number().finite().positive().max(100).optional(),
    calibrationScaleFactor: z.number().finite().min(0.85).max(1.15).optional(),
    wallConfinement: WallConfinementModeSchema.optional().default('NONE'),
    inSituMetrology: InSituMetrologySchema,
    localPreviewMesh: LocalPreviewMeshSchema.optional(),
    primaryPhotoUrl: NonBase64UrlSchema.optional(),
    primaryPhotoSha256: z.string().regex(SAFE_SHA256_REGEX).optional(),
    primaryImageBase64: z.string().min(8).max(4_000_000).optional(),
    primaryImageMimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
});
export type CaptureSessionPackageV2 = z.infer<typeof CaptureSessionPackageV2Schema>;

export const CloudRefinedMetrologySchema = z.object({
    volumeM3: z.number().finite().nonnegative(),
    tinVolumeM3: z.number().finite().nonnegative(),
    uncertaintyPct: z.number().finite().min(0).max(100),
    toeScore: z.number().finite().min(0).max(100),
    occludedVolumePct: z.number().finite().min(0).max(100),
    zeroCellsInside: z.number().int().nonnegative(),
    groundSlopeDeg: z.number().finite().min(0).max(90),
    slopeAngleAvgDeg: z.number().finite().min(0).max(90).nullable(),
    dimensionsM: z.object({
        a: z.number().finite().nonnegative(),
        b: z.number().finite().nonnegative(),
        h: z.number().finite().nonnegative(),
    }),
    meshUrl: NonBase64UrlSchema,
    meshSha256: z.string().regex(SAFE_SHA256_REGEX),
    meshSource: z.string().trim().min(1).max(80),
    computedAt: z.number().finite().nonnegative(),
    engineVersion: z.string().trim().min(1).max(64),
});
export type CloudRefinedMetrology = z.infer<typeof CloudRefinedMetrologySchema>;

export const ReconciliationRecordSchema = z.object({
    offlineInSituM3: z.number().finite().nonnegative(),
    cloudRefinedM3: z.number().finite().nonnegative(),
    deltaM3: z.number().finite(),
    deltaPct: z.number().finite(),
    tolerancePct: z.number().finite().positive(),
    withinTolerance: z.boolean(),
    status: AcopiosReconciliationStatusSchema,
    activeSource: z.enum(['IN_SITU_OFFLINE', 'CLOUD_REFINED']),
    evaluatedAt: z.number().finite().nonnegative(),
});
export type ReconciliationRecord = z.infer<typeof ReconciliationRecordSchema>;

/**
 * Evalúa determinísticamente la conciliación entre volumen offline in-situ y refinamiento cloud.
 * Regla soberana:
 * - Si |delta_pct| <= max(8%, inSituUncertaintyPct) => AUTO_CONCILIATED (promociona cloud_refined sin perder in_situ_offline).
 * - Si supera la banda => REQUIRES_HITL_REVIEW (conserva offline_in_situ_m3 como activo hasta confirmación "ACTUALIZAR").
 */
export function evaluateStockpileReconciliation(params: {
    offlineInSituM3: number;
    inSituUncertaintyPct: number;
    cloudRefinedM3: number;
    evaluatedAt?: number;
}): ReconciliationRecord {
    const offline = Number.isFinite(params.offlineInSituM3) ? Math.max(0, params.offlineInSituM3) : 0;
    const cloud = Number.isFinite(params.cloudRefinedM3) ? Math.max(0, params.cloudRefinedM3) : 0;
    const unc = Number.isFinite(params.inSituUncertaintyPct)
        ? Math.max(0, params.inSituUncertaintyPct)
        : 8;

    const tolerancePct = Number(Math.max(8, unc).toFixed(2));
    const deltaM3 = Number((cloud - offline).toFixed(2));
    const deltaPct =
        offline > 0
            ? Number((((cloud - offline) / offline) * 100).toFixed(2))
            : cloud > 0
              ? 100
              : 0;
    const withinTolerance = Math.abs(deltaPct) <= tolerancePct;

    return {
        offlineInSituM3: Number(offline.toFixed(2)),
        cloudRefinedM3: Number(cloud.toFixed(2)),
        deltaM3,
        deltaPct,
        tolerancePct,
        withinTolerance,
        status: withinTolerance ? 'AUTO_CONCILIATED' : 'REQUIRES_HITL_REVIEW',
        activeSource: withinTolerance ? 'CLOUD_REFINED' : 'IN_SITU_OFFLINE',
        evaluatedAt: params.evaluatedAt ?? Date.now(),
    };
}
