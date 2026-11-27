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

export const CameraIntrinsicsSchema = z.preprocess(
    (raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        const obj = raw as Record<string, unknown>;
        return {
            ...obj,
            width: obj.width ?? obj.widthPx,
            height: obj.height ?? obj.heightPx,
        };
    },
    z.object({
        fx: z.number().finite().positive(),
        fy: z.number().finite().positive(),
        cx: z.number().finite(),
        cy: z.number().finite(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        widthPx: z.number().int().positive().optional(),
        heightPx: z.number().int().positive().optional(),
    })
);
export type CameraIntrinsics = z.infer<typeof CameraIntrinsicsSchema>;

export const CaptureKeyframeV2Schema = z.preprocess(
    (raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        const obj = raw as Record<string, unknown>;
        return {
            ...obj,
            remoteCasUrl: obj.remoteCasUrl ?? obj.downloadUrl,
            pitchDeg: obj.pitchDeg ?? obj.imuPitchDeg,
        };
    },
    z.object({
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
        downloadUrl: z
            .string()
            .min(1)
            .max(1024)
            .refine((u) => !u.startsWith('data:'), 'Prohibido Base64 en downloadUrl')
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
        imuPitchDeg: z.number().finite().optional(),
        sharpnessScore: z.number().finite().nonnegative().optional(),
    })
);
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
 * Acepta tanto `nx`/`nz`/`confidenceMask` como `cols`/`rows`/`observedMask`/`interpolatedMask`.
 */
export const DemGridV1Schema = z.preprocess(
    (raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        const obj = raw as Record<string, unknown>;
        const nx = typeof obj.nx === 'number' ? obj.nx : obj.cols;
        const nz = typeof obj.nz === 'number' ? obj.nz : obj.rows;
        const heightsM = Array.isArray(obj.heightsM) ? (obj.heightsM as number[]) : undefined;

        let confidenceMask = obj.confidenceMask;
        if (!Array.isArray(confidenceMask)) {
            if (Array.isArray(obj.observedMask)) {
                confidenceMask = (obj.observedMask as unknown[]).map((obs, idx) => {
                    if (obs === 1 || obs === true) return 2;
                    const h = heightsM && typeof heightsM[idx] === 'number' ? heightsM[idx] : 0;
                    return h > 0.015 ? 1 : 0;
                });
            } else if (Array.isArray(obj.interpolatedMask)) {
                confidenceMask = (obj.interpolatedMask as unknown[]).map((interp, idx) => {
                    const h = heightsM && typeof heightsM[idx] === 'number' ? heightsM[idx] : 0;
                    if (h <= 0.015) return 0;
                    return interp === 1 || interp === true ? 1 : 2;
                });
            }
        }

        let groundPlane = obj.groundPlane;
        if (!groundPlane && typeof obj.groundSlopeDeg === 'number' && Number.isFinite(obj.groundSlopeDeg)) {
            groundPlane = { a: 0, b: 0, d: 0, slopeDeg: obj.groundSlopeDeg };
        }

        return {
            ...obj,
            format: obj.format === 'dem_grid_v2' ? 'dem_grid_v2' : 'dem_grid_v1',
            nx,
            nz,
            ...(typeof obj.rgbB64 === 'string' && obj.rgbB64.length > 0
                ? { rgbB64: obj.rgbB64 }
                : {}),
            ...(Array.isArray(confidenceMask) ? { confidenceMask } : {}),
            ...(groundPlane ? { groundPlane } : {}),
        };
    },
    z
        .object({
            format: z.enum(['dem_grid_v1', 'dem_grid_v2']).default('dem_grid_v1'),
            nx: z.number().int().min(2).max(128),
            nz: z.number().int().min(2).max(128),
            cellSizeM: z.number().finite().positive().max(5),
            originX: z.number().finite().default(0),
            originZ: z.number().finite().default(0),
            heightsM: z.array(z.number().finite().nonnegative()),
            /** Base64 crudo (sin prefijo data:) de nx*nz*3 bytes RGB por celda para dem_grid_v2 */
            rgbB64: z
                .string()
                .max(120_000)
                .refine(
                    (v) => !v.toLowerCase().startsWith('data:'),
                    'Prohibido prefijo data: en rgbB64'
                )
                .nullable()
                .optional(),
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
        })
);
export type DemGridV1 = z.infer<typeof DemGridV1Schema>;

export const InSituMetrologySchema = z.object({
    volumeM3: z.number().finite().positive(),
    footprintAreaM2: z.number().finite().nonnegative(),
    footprint_area_m2: z.number().finite().nonnegative().optional(),
    heightMaxM: z.number().finite().positive(),
    baseLengthM: z.number().finite().positive(),
    baseWidthM: z.number().finite().positive(),
    dimensionsM: z
        .object({
            a: z.number().finite().nonnegative(),
            b: z.number().finite().nonnegative(),
            h: z.number().finite().nonnegative(),
        })
        .optional(),
    groundPlane: GroundPlaneParamsSchema,
    groundSlopeDeg: z.number().finite().min(0).max(90).optional(),
    slopeAngleAvgDeg: z.number().finite().nullable().optional(),
    slopeAngleLeftDeg: z.number().finite().nullable().optional(),
    slopeAngleRightDeg: z.number().finite().nullable().optional(),
    slopeWarning: z.string().max(320).nullable().optional(),
    uncertaintyPct: z.number().finite().min(0).max(100),
    coveragePct: z.number().finite().min(0).max(100),
    sectorsCovered: z.number().int().nonnegative().optional(),
    toeScore: z.number().finite().min(0).max(100),
    occludedVolumePct: z.number().finite().min(0).max(100).optional(),
    loopClosureDriftM: z.number().finite().nonnegative().optional(),
    loopClosed: z.boolean().optional(),
    computedAt: z.number().int().positive().optional(),
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
    z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite(),
        fx: z.number().finite().optional(),
        fy: z.number().finite().optional(),
        fz: z.number().finite().optional(),
        ts: z.number().finite().nonnegative().optional(),
        floorY: z.number().finite().optional(),
        timestampMs: z.number().finite().nonnegative().optional(),
    }),
]);
export type WalkRingPose = z.infer<typeof WalkRingPoseSchema>;

export interface NormalizedWalkRingPoint {
    x: number;
    y: number;
    z: number;
    fx?: number;
    fy?: number;
    fz?: number;
    floorY?: number;
    timestampMs?: number;
}

export function normalizeWalkRingPoseToXyz(pose: WalkRingPose): NormalizedWalkRingPoint {
    if (Array.isArray(pose)) {
        return { x: pose[0], y: pose[1], z: pose[2] };
    }
    if ('t' in pose) {
        return {
            x: pose.t[0],
            y: pose.t[1],
            z: pose.t[2],
            ...(typeof pose.timestampNs === 'number'
                ? { timestampMs: Math.round(pose.timestampNs / 1_000_000) }
                : {}),
        };
    }
    return {
        x: pose.x,
        y: pose.y,
        z: pose.z,
        ...(typeof pose.fx === 'number' ? { fx: pose.fx } : {}),
        ...(typeof pose.fy === 'number' ? { fy: pose.fy } : {}),
        ...(typeof pose.fz === 'number' ? { fz: pose.fz } : {}),
        ...(typeof pose.floorY === 'number' ? { floorY: pose.floorY } : {}),
        ...(typeof pose.timestampMs === 'number'
            ? { timestampMs: pose.timestampMs }
            : typeof pose.ts === 'number'
              ? { timestampMs: pose.ts > 1e13 ? Math.round(pose.ts / 1_000_000) : pose.ts }
              : {}),
    };
}

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

// ─── SPRINT 3: GROUND-TRUTH REAL, DESVIACIONES, CALIBRACIÓN LOOCV & IA SOBERANA ───

export const GroundTruthReferenceMethodSchema = z.enum([
    'TAPE_MEASURE',
    'LASER_DISTOMETER',
    'TOTAL_STATION',
    'DRONE_LIDAR',
    'SCALE_TRUCK',
    'KNOWN_GEOMETRY',
]);
export type GroundTruthReferenceMethod = z.infer<typeof GroundTruthReferenceMethodSchema>;

export const MeasurementGroundTruthInputSchema = z
    .object({
        hitlConfirmation: z.literal('ACTUALIZAR'),
        realHeightM: z.number().finite().positive().max(500).optional(),
        realBaseLengthM: z.number().finite().positive().max(2000).optional(),
        realBaseWidthM: z.number().finite().positive().max(2000).optional(),
        realDiameterM: z.number().finite().positive().max(2000).optional(),
        realVolumeM3: z.number().finite().positive().max(50_000_000).optional(),
        realSlopeAngleDeg: z.number().finite().min(0).max(90).optional(),
        referenceMethod: GroundTruthReferenceMethodSchema,
        fieldNotes: z.string().trim().max(300).optional(),
    })
    .refine(
        (v) =>
            v.realHeightM !== undefined ||
            v.realBaseLengthM !== undefined ||
            v.realBaseWidthM !== undefined ||
            v.realDiameterM !== undefined ||
            v.realVolumeM3 !== undefined ||
            v.realSlopeAngleDeg !== undefined,
        {
            message:
                'Debe ingresar al menos una medida real (H, L, A, Ø, V o α) para registrar contraste.',
        }
    );
export type MeasurementGroundTruthInput = z.infer<typeof MeasurementGroundTruthInputSchema>;

export const MeasurementDeviationMetricsSchema = z.object({
    deltaHeightPct: z.number().finite().optional(),
    deltaLengthPct: z.number().finite().optional(),
    deltaWidthPct: z.number().finite().optional(),
    deltaDiameterPct: z.number().finite().optional(),
    deltaVolumePct: z.number().finite().optional(),
    deltaSlopeDeg: z.number().finite().optional(),
    maxAbsDeltaPct: z.number().finite().nonnegative(),
    statusBand: z.enum(['OPTIMAL', 'ALERT']),
});
export type MeasurementDeviationMetrics = z.infer<typeof MeasurementDeviationMetricsSchema>;

export const GroundTruthEstimatedSnapshotSchema = z.object({
    heightM: z.number().finite().nonnegative().optional(),
    baseLengthM: z.number().finite().nonnegative().optional(),
    baseWidthM: z.number().finite().nonnegative().optional(),
    diameterM: z.number().finite().nonnegative().optional(),
    volumeM3: z.number().finite().nonnegative().optional(),
    slopeAngleDeg: z.number().finite().min(0).max(90).optional(),
    footprintAreaM2: z.number().finite().nonnegative().optional(),
});
export type GroundTruthEstimatedSnapshot = z.infer<typeof GroundTruthEstimatedSnapshotSchema>;

export const GroundTruthRecordSchema = z.object({
    id: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    assetId: z.string().trim().min(1).max(128),
    assetName: z.string().trim().max(160).optional(),
    measurementId: z.string().trim().min(1).max(128),
    deviceModel: z.string().trim().max(120).optional(),
    isEduSandbox: z.boolean().optional().default(false),
    referenceMethod: GroundTruthReferenceMethodSchema,
    fieldNotes: z.string().trim().max(300).optional(),
    estimated: GroundTruthEstimatedSnapshotSchema,
    real: z.object({
        realHeightM: z.number().finite().positive().optional(),
        realBaseLengthM: z.number().finite().positive().optional(),
        realBaseWidthM: z.number().finite().positive().optional(),
        realDiameterM: z.number().finite().positive().optional(),
        realVolumeM3: z.number().finite().positive().optional(),
        realSlopeAngleDeg: z.number().finite().min(0).max(90).optional(),
    }),
    deviations: MeasurementDeviationMetricsSchema,
    createdAt: z.number().finite().nonnegative(),
    createdBy: z.string().trim().max(128).optional(),
    region: z.string().trim().max(64).optional().default('southamerica-west1'),
    syncedToCloud: z.boolean().optional(),
});
export type GroundTruthRecord = z.infer<typeof GroundTruthRecordSchema>;

export const CalibrationAiDiagnosisSchema = z.object({
    summary: z.string().trim().min(1).max(600),
    rootCauses: z.array(z.string().trim().min(1).max(240)).max(6),
    recommendedAction: z.enum([
        'ACTIVATE_PROFILE',
        'COLLECT_MORE_SAMPLES',
        'RECALIBRATE_DEVICE',
        'REVIEW_CAPTURE_PROTOCOL',
    ]),
    modelUsed: z.string().trim().min(1).max(120),
    generatedAt: z.number().finite().nonnegative(),
    deterministicFallback: z.boolean().optional(),
});
export type CalibrationAiDiagnosis = z.infer<typeof CalibrationAiDiagnosisSchema>;

export const CalibrationProfileSchema = z.object({
    profileId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    deviceModel: z.string().trim().min(1).max(120),
    status: z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED']),
    sampleCount: z.number().int().nonnegative(),
    outliersExcluded: z.number().int().nonnegative().optional().default(0),
    volumeScaleFactor: z.number().finite().min(0.75).max(1.25),
    heightScaleFactor: z.number().finite().min(0.8).max(1.2),
    baseScaleFactor: z.number().finite().min(0.8).max(1.2),
    loocvMetrics: z.object({
        rawMapePct: z.number().finite().nonnegative(),
        calibratedMapePct: z.number().finite().nonnegative(),
        rmsePct: z.number().finite().nonnegative(),
        biasPct: z.number().finite(),
        improved: z.boolean(),
    }),
    aiDiagnosis: CalibrationAiDiagnosisSchema.optional(),
    createdAt: z.number().finite().nonnegative().optional(),
    activatedAt: z.number().finite().nonnegative().nullable().optional(),
    activatedBy: z.string().trim().max(128).nullable().optional(),
    region: z.string().trim().max(64).optional().default('southamerica-west1'),
});
export type CalibrationProfile = z.infer<typeof CalibrationProfileSchema>;
