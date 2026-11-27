import { z } from 'zod';

/**
 * MINREPORT · ACOPIOS — Contratos Soberanos V2 (Backend southamerica-west1)
 * Cumplimiento Ley N° 21.719 (cero PII, residencia exclusiva en Santiago) y CAS SHA-256.
 * Define los 3 ejes ortogonales de estado y el paquete de sesión de captura offline/cloud
 * con normalización interoperable Android (matriz SE3 / cols-rows) <-> Frontend <-> Backend.
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

/**
 * Convierte matriz de rotación 3x3 (row-major `r[0..8]`) a cuaternión unitario `(qx, qy, qz, qw)`
 * mediante el método estable de Shepperd.
 */
export function rotationMatrix3x3ToQuaternion(r: ReadonlyArray<number>): {
    qx: number;
    qy: number;
    qz: number;
    qw: number;
} {
    const m00 = r[0] ?? 1;
    const m01 = r[1] ?? 0;
    const m02 = r[2] ?? 0;
    const m10 = r[3] ?? 0;
    const m11 = r[4] ?? 1;
    const m12 = r[5] ?? 0;
    const m20 = r[6] ?? 0;
    const m21 = r[7] ?? 0;
    const m22 = r[8] ?? 1;

    const trace = m00 + m11 + m22;
    let qx = 0;
    let qy = 0;
    let qz = 0;
    let qw = 1;

    if (trace > 0) {
        const s = Math.sqrt(trace + 1.0) * 2;
        qw = 0.25 * s;
        qx = (m21 - m12) / s;
        qy = (m02 - m20) / s;
        qz = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(Math.max(1e-12, 1.0 + m00 - m11 - m22)) * 2;
        qw = (m21 - m12) / s;
        qx = 0.25 * s;
        qy = (m01 + m10) / s;
        qz = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = Math.sqrt(Math.max(1e-12, 1.0 + m11 - m00 - m22)) * 2;
        qw = (m02 - m20) / s;
        qx = (m01 + m10) / s;
        qy = 0.25 * s;
        qz = (m12 + m21) / s;
    } else {
        const s = Math.sqrt(Math.max(1e-12, 1.0 + m22 - m00 - m11)) * 2;
        qw = (m10 - m01) / s;
        qx = (m02 + m20) / s;
        qy = (m12 + m21) / s;
        qz = 0.25 * s;
    }

    const len = Math.hypot(qx, qy, qz, qw) || 1;
    return {
        qx: Number((qx / len).toFixed(6)),
        qy: Number((qy / len).toFixed(6)),
        qz: Number((qz / len).toFixed(6)),
        qw: Number((qw / len).toFixed(6)),
    };
}

const PoseSE3QuaternionSchema = z.object({
    tx: z.number().finite(),
    ty: z.number().finite(),
    tz: z.number().finite(),
    qx: z.number().finite(),
    qy: z.number().finite(),
    qz: z.number().finite(),
    qw: z.number().finite(),
    r: z.array(z.number().finite()).length(9).optional(),
    t: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    timestampMs: z.number().finite().nonnegative().optional(),
});

const PoseSE3MatrixSchema = z.object({
    r: z.array(z.number().finite()).length(9),
    t: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    timestampMs: z.number().finite().nonnegative().optional(),
    timestampNs: z.number().finite().nonnegative().optional(),
});

export const PoseSE3Schema = z
    .union([PoseSE3QuaternionSchema, PoseSE3MatrixSchema])
    .transform((pose) => {
        if ('tx' in pose) {
            return {
                tx: pose.tx,
                ty: pose.ty,
                tz: pose.tz,
                qx: pose.qx,
                qy: pose.qy,
                qz: pose.qz,
                qw: pose.qw,
                ...(pose.r ? { r: pose.r } : {}),
                ...(pose.t ? { t: pose.t } : { t: [pose.tx, pose.ty, pose.tz] as [number, number, number] }),
                ...(pose.timestampMs !== undefined ? { timestampMs: pose.timestampMs } : {}),
            };
        }
        const q = rotationMatrix3x3ToQuaternion(pose.r);
        const tsMs =
            pose.timestampMs !== undefined
                ? pose.timestampMs
                : pose.timestampNs !== undefined
                  ? Math.round(pose.timestampNs / 1e6)
                  : undefined;
        return {
            tx: pose.t[0],
            ty: pose.t[1],
            tz: pose.t[2],
            qx: q.qx,
            qy: q.qy,
            qz: q.qz,
            qw: q.qw,
            r: pose.r,
            t: pose.t,
            ...(tsMs !== undefined ? { timestampMs: tsMs } : {}),
        };
    });
export type PoseSE3 = z.infer<typeof PoseSE3Schema>;

export const CameraIntrinsicsSchema = z
    .object({
        fx: z.number().finite().positive(),
        fy: z.number().finite().positive(),
        cx: z.number().finite().nonnegative(),
        cy: z.number().finite().nonnegative(),
        widthPx: z.number().int().positive().max(16384).optional(),
        heightPx: z.number().int().positive().max(16384).optional(),
        width: z.number().int().positive().max(16384).optional(),
        height: z.number().int().positive().max(16384).optional(),
    })
    .superRefine((v, ctx) => {
        if (v.widthPx === undefined && v.width === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'intrinsics requiere widthPx o width.',
            });
        }
        if (v.heightPx === undefined && v.height === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'intrinsics requiere heightPx o height.',
            });
        }
    })
    .transform((v) => {
        const widthPx = (v.widthPx ?? v.width)!;
        const heightPx = (v.heightPx ?? v.height)!;
        return {
            fx: v.fx,
            fy: v.fy,
            cx: v.cx,
            cy: v.cy,
            widthPx,
            heightPx,
            width: widthPx,
            height: heightPx,
        };
    });
export type CameraIntrinsics = z.infer<typeof CameraIntrinsicsSchema>;

export const KeyframeCasEntrySchema = z
    .object({
        index: z.number().int().nonnegative().max(512),
        sha256: z.string().regex(SAFE_SHA256_REGEX),
        downloadUrl: NonBase64UrlSchema.optional(),
        remoteCasUrl: NonBase64UrlSchema.optional(),
        mimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).default('image/webp'),
        originalBytes: z.number().int().nonnegative(),
        optimizedBytes: z.number().int().nonnegative(),
        savingsPct: z.number().finite().min(0).max(100),
        blurScore: z.number().finite().nonnegative().optional(),
        angleDeg: z.number().finite().min(-360).max(360).optional(),
        displayRotationDeg: z.number().finite().min(-360).max(360).optional(),
        imuPitchDeg: z.number().finite().min(-90).max(90).optional(),
        pitchDeg: z.number().finite().min(-90).max(90).optional(),
        poseSE3: PoseSE3Schema,
        intrinsics: CameraIntrinsicsSchema,
    })
    .superRefine((v, ctx) => {
        if (!v.downloadUrl && !v.remoteCasUrl) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'keyframe requiere downloadUrl o remoteCasUrl.',
            });
        }
    })
    .transform((v) => {
        const downloadUrl = (v.downloadUrl ?? v.remoteCasUrl)!;
        return {
            index: v.index,
            sha256: v.sha256,
            downloadUrl,
            remoteCasUrl: downloadUrl,
            mimeType: v.mimeType,
            originalBytes: v.originalBytes,
            optimizedBytes: v.optimizedBytes,
            savingsPct: v.savingsPct,
            ...(v.blurScore !== undefined ? { blurScore: v.blurScore } : {}),
            ...(v.angleDeg !== undefined ? { angleDeg: v.angleDeg } : {}),
            ...(v.displayRotationDeg !== undefined ? { displayRotationDeg: v.displayRotationDeg } : {}),
            ...(v.imuPitchDeg !== undefined || v.pitchDeg !== undefined
                ? { imuPitchDeg: v.imuPitchDeg ?? v.pitchDeg }
                : {}),
            poseSE3: v.poseSE3,
            intrinsics: v.intrinsics,
        };
    });
export type KeyframeCasEntry = z.infer<typeof KeyframeCasEntrySchema>;

const WalkRingObjectSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    fx: z.number().finite().optional(),
    fy: z.number().finite().optional(),
    fz: z.number().finite().optional(),
    floorY: z.number().finite().optional(),
    ts: z.number().finite().nonnegative().optional(),
    timestampMs: z.number().finite().nonnegative().optional(),
});

const WalkRingTuplePoseSchema = z.object({
    t: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    yawDeg: z.number().finite().optional(),
    floorY: z.number().finite().optional(),
    timestampMs: z.number().finite().nonnegative().optional(),
    timestampNs: z.number().finite().nonnegative().optional(),
});

const WalkRingRawTupleSchema = z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
]);

export const WalkRingPoseSchema = z
    .union([WalkRingObjectSchema, WalkRingTuplePoseSchema, WalkRingRawTupleSchema])
    .transform((entry) => {
        if (Array.isArray(entry)) {
            return { x: entry[0], y: entry[1], z: entry[2] };
        }
        if ('t' in entry) {
            const tsMs =
                entry.timestampMs !== undefined
                    ? entry.timestampMs
                    : entry.timestampNs !== undefined
                      ? Math.round(entry.timestampNs / 1e6)
                      : undefined;
            return {
                x: entry.t[0],
                y: entry.t[1],
                z: entry.t[2],
                ...(entry.floorY !== undefined ? { floorY: entry.floorY } : {}),
                ...(tsMs !== undefined ? { timestampMs: tsMs } : {}),
            };
        }
        const tsMs = entry.timestampMs ?? entry.ts;
        return {
            x: entry.x,
            y: entry.y,
            z: entry.z,
            ...(entry.floorY !== undefined ? { floorY: entry.floorY } : {}),
            ...(tsMs !== undefined ? { timestampMs: tsMs } : {}),
        };
    });
export type WalkRingPose = z.infer<typeof WalkRingPoseSchema>;

export const SpatialPoint3DSchema = z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
]);

export const InSituMetrologySchema = z
    .object({
        volumeM3: z.number().finite().nonnegative(),
        uncertaintyPct: z.number().finite().min(0).max(100),
        toeScore: z.number().finite().min(0).max(100),
        occludedVolumePct: z.number().finite().min(0).max(100).optional().default(0),
        zeroCellsInside: z.number().int().nonnegative().optional().default(0),
        loopDriftPct: z.number().finite().min(0).max(100).optional().default(0),
        groundSlopeDeg: z.number().finite().min(0).max(90).optional(),
        groundPlane: z
            .object({
                a: z.number().finite().optional().default(0),
                b: z.number().finite().optional().default(0),
                d: z.number().finite().optional().default(0),
                slopeDeg: z.number().finite().min(0).max(90).optional(),
            })
            .optional(),
        planeMismatchDeg: z.number().finite().min(0).max(90).optional().default(0),
        slopeAngleAvgDeg: z.number().finite().min(0).max(90).nullable().optional(),
        slopeAngleLeftDeg: z.number().finite().min(0).max(90).nullable().optional(),
        slopeAngleRightDeg: z.number().finite().min(0).max(90).nullable().optional(),
        dimensionsM: z
            .object({
                a: z.number().finite().nonnegative(),
                b: z.number().finite().nonnegative(),
                h: z.number().finite().nonnegative(),
            })
            .optional(),
        baseLengthM: z.number().finite().nonnegative().optional(),
        baseWidthM: z.number().finite().nonnegative().optional(),
        heightMaxM: z.number().finite().nonnegative().optional(),
        footprintAreaM2: z.number().finite().nonnegative().optional(),
        metrologyGrade: AcopiosMetrologyGradeSchema,
        metrologyReasons: z.array(z.string().trim().max(200)).max(20).optional().default([]),
        coveragePct: z.number().finite().min(0).max(100).optional().default(100),
        sectorsCovered: z.number().int().min(0).max(64).optional().default(8),
        sectorsTotal: z.number().int().min(1).max(64).optional().default(8),
        loopClosed: z.boolean().optional().default(true),
        wallConfinement: WallConfinementModeSchema.optional().default('NONE'),
        depthMode: z.string().trim().max(48).optional().default('KNOWN_POSE_MVS_OFFLINE'),
        hasScaleAnchor: z.boolean().optional().default(false),
        computedAt: z.number().finite().nonnegative().optional(),
        engineVersion: z.string().trim().min(1).max(64).optional().default('acopios-offline-v2'),
    })
    .transform((m) => {
        const a = m.dimensionsM?.a ?? m.baseLengthM ?? 0;
        const b = m.dimensionsM?.b ?? m.baseWidthM ?? 0;
        const h = m.dimensionsM?.h ?? m.heightMaxM ?? 0;
        const computedSlopeFromPlane =
            m.groundPlane?.slopeDeg !== undefined
                ? m.groundPlane.slopeDeg
                : m.groundPlane
                  ? Number(
                        (
                            (Math.atan(Math.hypot(m.groundPlane.a, m.groundPlane.b)) * 180) /
                            Math.PI
                        ).toFixed(2)
                    )
                  : 0;
        const groundSlopeDeg = m.groundSlopeDeg ?? computedSlopeFromPlane;
        return {
            volumeM3: m.volumeM3,
            uncertaintyPct: m.uncertaintyPct,
            toeScore: m.toeScore,
            occludedVolumePct: m.occludedVolumePct,
            zeroCellsInside: m.zeroCellsInside,
            loopDriftPct: m.loopDriftPct,
            groundSlopeDeg,
            planeMismatchDeg: m.planeMismatchDeg,
            slopeAngleAvgDeg: m.slopeAngleAvgDeg ?? null,
            slopeAngleLeftDeg: m.slopeAngleLeftDeg ?? null,
            slopeAngleRightDeg: m.slopeAngleRightDeg ?? null,
            dimensionsM: { a, b, h },
            footprintAreaM2: m.footprintAreaM2,
            metrologyGrade: m.metrologyGrade,
            metrologyReasons: m.metrologyReasons,
            coveragePct: m.coveragePct,
            sectorsCovered: m.sectorsCovered,
            sectorsTotal: m.sectorsTotal,
            loopClosed: m.loopClosed,
            wallConfinement: m.wallConfinement,
            depthMode: m.depthMode,
            hasScaleAnchor: m.hasScaleAnchor,
            computedAt: m.computedAt ?? Date.now(),
            engineVersion: m.engineVersion,
        };
    });
export type InSituMetrology = z.infer<typeof InSituMetrologySchema>;

export const LocalPreviewMeshSchema = z
    .object({
        format: z.literal('dem_grid_v1').optional().default('dem_grid_v1'),
        originX: z.number().finite(),
        originZ: z.number().finite(),
        cellSizeM: z.number().finite().positive().max(5),
        nx: z.number().int().min(2).max(128).optional(),
        nz: z.number().int().min(2).max(128).optional(),
        cols: z.number().int().min(2).max(128).optional(),
        rows: z.number().int().min(2).max(128).optional(),
        heightsM: z.array(z.number().finite().nonnegative()).min(4).max(16384),
        interpolatedMask: z.array(z.number().int().min(0).max(1)).max(16384).optional(),
        observedMask: z.array(z.number().int().min(0).max(1)).max(16384).optional(),
        confidenceMask: z.array(z.number().int().min(0).max(2)).max(16384).optional(),
        observationCount: z.array(z.number().int().nonnegative()).max(16384).optional(),
        slopeDegGrid: z.array(z.number().finite().nonnegative()).max(16384).optional(),
        groundPlane: z
            .object({
                a: z.number().finite(),
                b: z.number().finite(),
                d: z.number().finite(),
            })
            .optional(),
        groundSlopeDeg: z.number().finite().min(0).max(90).optional(),
        byteLength: z.number().int().nonnegative().optional(),
    })
    .superRefine((grid, ctx) => {
        const nx = grid.nx ?? grid.cols;
        const nz = grid.nz ?? grid.rows;
        if (nx === undefined || nz === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'localPreviewMesh requiere (nx, nz) o (cols, rows).',
            });
            return;
        }
        const expected = nx * nz;
        if (grid.heightsM.length !== expected) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `heightsM.length (${grid.heightsM.length}) debe igualar nx*nz (${expected}).`,
            });
        }
    })
    .transform((grid) => {
        const nx = (grid.nx ?? grid.cols)!;
        const nz = (grid.nz ?? grid.rows)!;
        const interpolatedMask =
            grid.interpolatedMask ??
            (grid.confidenceMask
                ? grid.confidenceMask.map((c) => (c === 1 ? 1 : 0))
                : grid.observedMask
                  ? grid.observedMask.map((obs, idx) =>
                        obs === 0 && (grid.heightsM[idx] ?? 0) > 0.02 ? 1 : 0
                    )
                  : undefined);
        const observationCount =
            grid.observationCount ??
            (grid.confidenceMask
                ? grid.confidenceMask.map((c) => (c === 2 ? 2 : c === 1 ? 0 : 0))
                : grid.observedMask
                  ? grid.observedMask.map((obs) => (obs === 1 ? 2 : 0))
                  : undefined);
        const fallbackTanA =
            grid.groundSlopeDeg !== undefined && grid.groundSlopeDeg > 0
                ? Number(Math.tan((grid.groundSlopeDeg * Math.PI) / 180).toFixed(6))
                : 0;
        const groundPlane = grid.groundPlane ?? { a: fallbackTanA, b: 0, d: 0 };

        return {
            format: 'dem_grid_v1' as const,
            originX: grid.originX,
            originZ: grid.originZ,
            cellSizeM: grid.cellSizeM,
            nx,
            nz,
            heightsM: grid.heightsM,
            ...(interpolatedMask ? { interpolatedMask } : {}),
            ...(observationCount ? { observationCount } : {}),
            ...(grid.slopeDegGrid ? { slopeDegGrid: grid.slopeDegGrid } : {}),
            groundPlane,
            ...(grid.byteLength !== undefined ? { byteLength: grid.byteLength } : {}),
        };
    });
export type LocalPreviewMesh = z.infer<typeof LocalPreviewMeshSchema>;

const RawSpatialBundleAliasSchema = z.object({
    sha256: z.string().regex(SAFE_SHA256_REGEX).optional(),
    downloadUrl: NonBase64UrlSchema.optional(),
    remoteCasUrl: NonBase64UrlSchema.optional(),
    originalBytes: z.number().int().nonnegative().optional(),
    optimizedBytes: z.number().int().nonnegative().optional(),
    savingsPct: z.number().finite().min(0).max(100).optional(),
});

export const CaptureSessionPackageV2Schema = z
    .object({
        schemaVersion: z.literal('2.0').optional().default('2.0'),
        sessionId: z.string().trim().regex(SAFE_SESSION_ID_REGEX),
        measurementId: z.string().trim().regex(SAFE_SESSION_ID_REGEX).optional(),
        tenantId: z.string().trim().max(128).optional(),
        deviceModel: z.string().trim().max(120).optional(),
        device_model: z.string().trim().max(120).optional(),
        calibrationId: z.string().trim().max(128).optional(),
        calibration_id: z.string().trim().max(128).optional(),
        scannerEngineVersion: z.string().trim().max(64).optional(),
        scanner_engine_version: z.string().trim().max(64).optional(),
        rawBundleSha256: z.string().regex(SAFE_SHA256_REGEX).optional(),
        rawBundleUrl: NonBase64UrlSchema.optional(),
        rawBundleOriginalBytes: z.number().int().nonnegative().optional(),
        rawBundleOptimizedBytes: z.number().int().nonnegative().optional(),
        rawBundleSavingsPct: z.number().finite().min(0).max(100).optional(),
        rawSpatialBundle: RawSpatialBundleAliasSchema.nullable().optional(),
        capturedAt: z.number().finite().nonnegative(),
        locale: z.enum(['es', 'en', 'pt']).optional().default('es'),
        keyframes: z.array(KeyframeCasEntrySchema).max(64).optional().default([]),
        walkRing: z.array(WalkRingPoseSchema).max(1024).optional(),
        walkRingPoses: z.array(WalkRingPoseSchema).max(1024).optional(),
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
        calibration_scale_factor: z.number().finite().min(0.85).max(1.15).optional(),
        wallConfinement: WallConfinementModeSchema.optional().default('NONE'),
        inSituMetrology: InSituMetrologySchema,
        localPreviewMesh: LocalPreviewMeshSchema.nullable().optional(),
        primaryPhotoUrl: NonBase64UrlSchema.optional(),
        primaryPhotoSha256: z.string().regex(SAFE_SHA256_REGEX).optional(),
        primaryImageBase64: z.string().min(8).max(4_000_000).optional(),
        primaryImageMimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
    })
    .transform((pkg) => {
        const walkRing =
            pkg.walkRing && pkg.walkRing.length > 0
                ? pkg.walkRing
                : pkg.walkRingPoses ?? [];
        const rawSpatialBundle = pkg.rawSpatialBundle ?? undefined;
        const localPreviewMesh = pkg.localPreviewMesh ?? undefined;
        const rawBundleSha256 = pkg.rawBundleSha256 ?? rawSpatialBundle?.sha256;
        const rawBundleUrl =
            pkg.rawBundleUrl ??
            rawSpatialBundle?.downloadUrl ??
            rawSpatialBundle?.remoteCasUrl;
        const rawBundleOriginalBytes =
            pkg.rawBundleOriginalBytes ?? rawSpatialBundle?.originalBytes;
        const rawBundleOptimizedBytes =
            pkg.rawBundleOptimizedBytes ?? rawSpatialBundle?.optimizedBytes;
        const rawBundleSavingsPct =
            pkg.rawBundleSavingsPct ?? rawSpatialBundle?.savingsPct;

        const deviceModel = pkg.deviceModel ?? pkg.device_model;
        const calibrationId = pkg.calibrationId ?? pkg.calibration_id;
        const calibrationScaleFactor =
            pkg.calibrationScaleFactor ?? pkg.calibration_scale_factor;
        const scannerEngineVersion =
            pkg.scannerEngineVersion ?? pkg.scanner_engine_version;

        return {
            schemaVersion: pkg.schemaVersion,
            sessionId: pkg.sessionId,
            measurementId: pkg.measurementId,
            tenantId: pkg.tenantId,
            deviceModel,
            calibrationId,
            scannerEngineVersion,
            rawBundleSha256,
            rawBundleUrl,
            rawBundleOriginalBytes,
            rawBundleOptimizedBytes,
            rawBundleSavingsPct,
            capturedAt: pkg.capturedAt,
            locale: pkg.locale,
            keyframes: pkg.keyframes,
            walkRing,
            pointsM: pkg.pointsM,
            groundSamplesM: pkg.groundSamplesM,
            anchorCenter: pkg.anchorCenter,
            roiRadiusM: pkg.roiRadiusM,
            calibrationScaleFactor,
            wallConfinement: pkg.wallConfinement,
            inSituMetrology: pkg.inSituMetrology,
            localPreviewMesh,
            primaryPhotoUrl: pkg.primaryPhotoUrl,
            primaryPhotoSha256: pkg.primaryPhotoSha256,
            primaryImageBase64: pkg.primaryImageBase64,
            primaryImageMimeType: pkg.primaryImageMimeType,
        };
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
