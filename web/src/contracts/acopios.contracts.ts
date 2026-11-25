import { z } from 'zod';

/**
 * MINREPORT · ACOPIOS V2 CONTRACTS (Offline-First Capture Session + 3 Orthogonal Axes)
 * Ley N° 21.719 (residencia exclusiva southamerica-west1, cero PII en blobs) y CAS SHA-256.
 */

export const MeasurementLifecycleStatusSchema = z.enum([
    'CAPTURED_OFFLINE_VALID',
    'SYNCING_RAW_CAS',
    'CLOUD_3D_VERIFIED',
    'REJECTED_METROLOGY',
]);
export type MeasurementLifecycleStatus = z.infer<typeof MeasurementLifecycleStatusSchema>;

export const MetrologyGradeSchema = z.enum([
    'VALID_IN_SITU',
    'LOW_CONFIDENCE_RECAPTURE',
    'REJECTED',
]);
export type MetrologyGrade = z.infer<typeof MetrologyGradeSchema>;

export const ReconciliationStatusSchema = z.enum([
    'PENDING_CLOUD',
    'AUTO_CONCILIATED',
    'REQUIRES_HITL_REVIEW',
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

export const UnifiedBoundingBoxMSchema = z.object({
    widthX: z.number().finite().nonnegative(),
    heightY: z.number().finite().nonnegative(),
    depthZ: z.number().finite().nonnegative(),
});
export type UnifiedBoundingBoxM = z.infer<typeof UnifiedBoundingBoxMSchema>;

export const CameraPoseSE3Schema = z.object({
    /** Matriz de rotación 3x3 row-major (9 valores finitos) */
    r: z.array(z.number().finite()).length(9),
    /** Traslación [tx, ty, tz] en metros marco VIO Y-up */
    t: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
});
export type CameraPoseSE3 = z.infer<typeof CameraPoseSE3Schema>;

export const CameraIntrinsicsSchema = z.object({
    fx: z.number().finite().positive(),
    fy: z.number().finite().positive(),
    cx: z.number().finite(),
    cy: z.number().finite(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
});
export type CameraIntrinsics = z.infer<typeof CameraIntrinsicsSchema>;

export const CaptureKeyframeV2Schema = z.object({
    index: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    phashHex: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
    offlineCasRef: z.string().min(1).max(256).optional(),
    remoteCasUrl: z
        .string()
        .min(1)
        .max(1024)
        .refine((u) => !u.startsWith('data:'), 'Prohibido Base64 en remoteCasUrl')
        .optional(),
    mimeType: z.string().min(3).max(64).default('image/webp'),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().nonnegative(),
    savingsPct: z.number().min(0).max(100),
    displayRotationDeg: z.number().finite().optional().default(0),
    poseSE3: CameraPoseSE3Schema,
    intrinsics: CameraIntrinsicsSchema,
    timestampNs: z.number().finite().nonnegative(),
    azimuthDeg: z.number().finite().optional(),
    pitchDeg: z.number().finite().optional(),
    sharpnessScore: z.number().finite().nonnegative().optional(),
});
export type CaptureKeyframeV2 = z.infer<typeof CaptureKeyframeV2Schema>;

export const GroundPlaneParamsSchema = z.object({
    a: z.number().finite(),
    b: z.number().finite(),
    d: z.number().finite(),
    slopeDeg: z.number().finite().min(0).max(90),
    toeScore: z.number().finite().min(0).max(100),
    residualRmsM: z.number().finite().nonnegative().optional(),
});
export type GroundPlaneParams = z.infer<typeof GroundPlaneParamsSchema>;

/**
 * Superficie DEM 2.5D compacta (< 60 KB) generada in-situ en Android para renderizado
 * Nivel 1 Offline instantáneo en StockpileTwin3D con base nivelada y = 0 y faldones CCW.
 */
export const DemGridV1Schema = z
    .object({
        format: z.literal('dem_grid_v1').default('dem_grid_v1'),
        nx: z.number().int().min(2).max(128),
        nz: z.number().int().min(2).max(128),
        cellSizeM: z.number().finite().positive().max(5),
        originX: z.number().finite().default(0),
        originZ: z.number().finite().default(0),
        heightsM: z.array(z.number().finite().nonnegative()),
        /** 0 = vacío/exterior, 1 = interpolado/ocluido (#C68346), 2 = observado verificado (#00AEEF) */
        confidenceMask: z.array(z.number().int().min(0).max(2)).optional(),
        groundPlane: z
            .object({
                a: z.number().finite(),
                b: z.number().finite(),
                d: z.number().finite(),
                slopeDeg: z.number().finite().optional(),
            })
            .optional(),
        volumeM3: z.number().finite().nonnegative().optional(),
        maxHeightM: z.number().finite().nonnegative().optional(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    })
    .superRefine((grid, ctx) => {
        if (grid.heightsM.length !== grid.nx * grid.nz) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['heightsM'],
                message: `heightsM.length (${grid.heightsM.length}) debe igualar nx * nz (${grid.nx * grid.nz})`,
            });
        }
        if (grid.confidenceMask && grid.confidenceMask.length !== grid.nx * grid.nz) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['confidenceMask'],
                message: `confidenceMask.length debe igualar nx * nz (${grid.nx * grid.nz})`,
            });
        }
    });
export type DemGridV1 = z.infer<typeof DemGridV1Schema>;

export const InSituMetrologySchema = z.object({
    volumeM3: z.number().finite().positive(),
    footprintAreaM2: z.number().finite().nonnegative(),
    heightMaxM: z.number().finite().positive(),
    baseLengthM: z.number().finite().positive(),
    baseWidthM: z.number().finite().positive(),
    groundPlane: GroundPlaneParamsSchema,
    slopeAngleAvgDeg: z.number().finite().nullable().optional(),
    slopeAngleLeftDeg: z.number().finite().nullable().optional(),
    slopeAngleRightDeg: z.number().finite().nullable().optional(),
    slopeWarning: z.string().max(320).nullable().optional(),
    uncertaintyPct: z.number().finite().min(0).max(100),
    coveragePct: z.number().finite().min(0).max(100),
    toeScore: z.number().finite().min(0).max(100),
    occludedVolumePct: z.number().finite().min(0).max(100).optional(),
    loopClosureDriftM: z.number().finite().nonnegative().optional(),
    loopClosed: z.boolean().optional(),
    zeroCellsInside: z.number().int().nonnegative().optional(),
    metrologyGrade: MetrologyGradeSchema,
});
export type InSituMetrology = z.infer<typeof InSituMetrologySchema>;

export const WalkRingPoseSchema = z.union([
    z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    z.object({
        t: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        yawDeg: z.number().finite().optional(),
        timestampNs: z.number().finite().nonnegative().optional(),
    }),
]);
export type WalkRingPose = z.infer<typeof WalkRingPoseSchema>;

export const CasBundleRefSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    offlineCasRef: z.string().min(1).max(256).optional(),
    remoteCasUrl: z.string().min(1).max(1024).optional(),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().nonnegative(),
    savingsPct: z.number().min(0).max(100),
});
export type CasBundleRef = z.infer<typeof CasBundleRefSchema>;

export const CasSessionIntegritySchema = z.object({
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    totalOriginalBytes: z.number().int().nonnegative(),
    totalOptimizedBytes: z.number().int().nonnegative(),
    totalSavingsPct: z.number().min(0).max(100),
});
export type CasSessionIntegrity = z.infer<typeof CasSessionIntegritySchema>;

export const ReconciliationSummarySchema = z.object({
    offlineInSituM3: z.number().finite().nonnegative(),
    cloudRefinedM3: z.number().finite().nonnegative().nullable().optional(),
    deltaPct: z.number().finite().nullable().optional(),
    reconciledAt: z.number().int().positive().nullable().optional(),
    hitlConfirmedBy: z.string().max(128).nullable().optional(),
    hitlConfirmedAt: z.number().int().positive().nullable().optional(),
    rejectionCode: z.string().max(64).nullable().optional(),
    rejectionReason: z.string().max(320).nullable().optional(),
});
export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;

export const CaptureSessionPackageV2Schema = z.object({
    sessionId: z.string().trim().min(4).max(128),
    schemaVersion: z.literal('2.0').default('2.0'),
    tenantId: z.string().trim().min(1).max(128),
    assetId: z.string().trim().min(1).max(128),
    measurementId: z.string().trim().min(1).max(128),
    capturedAt: z.number().int().positive(),
    scannerEngineVersion: z.string().trim().max(64).optional(),
    orientationMode: z.string().trim().max(32).optional(),
    depthMode: z.string().trim().max(32).optional(),
    deviceModel: z.string().trim().max(120).optional(),
    lifecycle_status: MeasurementLifecycleStatusSchema,
    metrology_grade: MetrologyGradeSchema,
    reconciliation_status: ReconciliationStatusSchema,
    keyframes: z.array(CaptureKeyframeV2Schema).min(1).max(48),
    walkRingPoses: z.array(WalkRingPoseSchema).max(2048).optional(),
    rawSpatialBundle: CasBundleRefSchema.nullable().optional(),
    inSituMetrology: InSituMetrologySchema,
    localPreviewMesh: DemGridV1Schema.nullable().optional(),
    casIntegrity: CasSessionIntegritySchema,
    reconciliation: ReconciliationSummarySchema.optional(),
    locale: z.enum(['es', 'en', 'pt']).optional().default('es'),
});
export type CaptureSessionPackageV2 = z.infer<typeof CaptureSessionPackageV2Schema>;

/**
 * Normaliza boundingBoxM tanto del esquema unificado `{ widthX, heightY, depthZ }`
 * como del esquema legacy servidor `{ lengthM, heightM, widthM }`.
 */
export function normalizeUnifiedBoundingBox(raw: unknown): UnifiedBoundingBoxM {
    if (!raw || typeof raw !== 'object') {
        return { widthX: 0, heightY: 0, depthZ: 0 };
    }
    const obj = raw as Record<string, unknown>;
    const pick = (...keys: string[]): number => {
        for (const k of keys) {
            const v = obj[k];
            if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
                return v;
            }
        }
        return 0;
    };
    return {
        widthX: pick('widthX', 'lengthM', 'x'),
        heightY: pick('heightY', 'heightM', 'y'),
        depthZ: pick('depthZ', 'widthM', 'z'),
    };
}
