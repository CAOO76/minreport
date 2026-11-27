/**
 * Motor Volumétrico Espacial Real v2 (Walk-Ring Toe Solver + Delaunay Sin Cráteres + Incertidumbre Honesta)
 * Sistema de coordenadas ARCore: `y` vertical arriba (+Y gravedad IMU), `(x, z)` plano horizontal en metros.
 * Ejecución determinista 100% en `southamerica-west1` sin aleatoriedad no reproducible.
 */

export type SpatialPoint3D = [number, number, number];

export type WallConfinementMode = 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';

export type MetrologyGrade = 'VALID_IN_SITU' | 'LOW_CONFIDENCE_RECAPTURE' | 'REJECTED';

export type SlopeProfile = 'NATURAL_REPOSE' | 'STEEP_ALERT' | 'VERTICAL_STRUCTURE';

export interface TargetVolumeConstraint {
    anchorXZ?: [number, number];
    radiusM?: number;
    polygonXZ?: Array<[number, number]>;
    padReferenceY?: number;
}

export interface WalkRingPose {
    x: number;
    y: number;
    z: number;
    floorY?: number;
    timestampMs?: number;
}

export interface VerticalWallPlane {
    nx: number;
    nz: number;
    d: number;
    inlierRatio: number;
}

export interface InclinedGroundPlaneResult {
    a: number;
    b: number;
    d: number;
    residualRmsM: number;
    sigmaGroundM?: number;
    groundSlopeDeg: number;
    toeScore: number;
    walkRingSlopeDeg?: number;
    planeMismatchDeg: number;
    usedWalkRingRegularization: boolean;
    wallPlane?: VerticalWallPlane | null;
}

export interface SpatialSurfaceGrid {
    originX: number;
    originZ: number;
    cellSizeM: number;
    nx: number;
    nz: number;
    heightsM: number[];
    observationCount?: number[];
    interpolatedMask?: number[];
    slopeDegGrid?: number[];
    groundPlane: {
        a: number;
        b: number;
        d: number;
    };
}

export interface SpatialVolumeInput {
    pointsM: ReadonlyArray<SpatialPoint3D>;
    groundSamplesM?: ReadonlyArray<SpatialPoint3D>;
    walkRingPoses?: ReadonlyArray<WalkRingPose>;
    wallConfinement?: WallConfinementMode;
    operatorHeightM?: number;
    anchorCenter?: { x: number; y: number; z: number } | null;
    coveragePct?: number;
    sectorsCovered?: number;
    sectorsTotal?: number;
    roiRadiusM?: number;
    calibrationScaleFactor?: number;
    calibrationId?: string;
    calibrationPlaneNoiseRmsM?: number;
    deviceCalibratedAt?: number;
    loopClosed?: boolean;
    loopDriftPct?: number;
    hasScaleAnchor?: boolean;
    crestClippedRatio?: number;
    depthMode?: 'RAW_DEPTH_ONLY' | 'AUTOMATIC' | 'VIO_POINTCLOUD' | 'KNOWN_POSE_MVS_OFFLINE' | string;
    targetConstraint?: TargetVolumeConstraint | null;
}

export interface SpatialVolumeResult {
    volumeM3: number;
    heightM: number;
    footprintAreaM2: number;
    baseLengthM: number;
    baseWidthM: number;
    slopeAngleLeftDeg: number | null;
    slopeAngleRightDeg: number | null;
    slopeAngleAvgDeg: number | null;
    slopeProfile: SlopeProfile | null;
    slopeWarning: string | null;
    groundSlopeDeg: number;
    planeMismatchDeg: number;
    toeScore: number;
    zeroCellsInside: number;
    occludedVolumePct: number;
    loopDriftPct: number;
    uncertaintyPct: number;
    confidence: number;
    metrologyGrade: MetrologyGrade;
    metrologyReasons: string[];
    dimensionsM: {
        a: number;
        b: number;
        h: number;
    };
    groundPlane: InclinedGroundPlaneResult;
    surfaceGrid: SpatialSurfaceGrid;
}

export type SpatialRejectionCode =
    | 'OBJECT_TOO_SMALL'
    | 'INSUFFICIENT_COVERAGE'
    | 'INVALID_POINT_CLOUD';

export class SpatialVolumeValidationError extends Error {
    public readonly statusCode = 422;
    public readonly code: SpatialRejectionCode;

    constructor(message: string, code: SpatialRejectionCode = 'INVALID_POINT_CLOUD') {
        super(message);
        this.name = 'SpatialVolumeValidationError';
        this.code = code;
    }
}

const MAX_GROUND_SLOPE_RAD = (15 * Math.PI) / 180;
const MAX_GROUND_TAN = Math.tan(MAX_GROUND_SLOPE_RAD);
const MAX_WALK_RING_MISMATCH_DEG = 3.5;
const RANSAC_INLIER_TOL_M = 0.06;
const RANSAC_ITERATIONS = 120;
const RADIAL_SECTORS = 16;
const DEFAULT_OPERATOR_HEIGHT_M = 1.45;

function round4(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function round1(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10) / 10;
}

export function classifySlopeProfile(slopeAngleAvgDeg: number | null): SlopeProfile | null {
    if (slopeAngleAvgDeg === null || !Number.isFinite(slopeAngleAvgDeg)) {
        return null;
    }
    if (slopeAngleAvgDeg > 65) {
        return 'VERTICAL_STRUCTURE';
    }
    if (slopeAngleAvgDeg > 38) {
        return 'STEEP_ALERT';
    }
    return 'NATURAL_REPOSE';
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    if (sortedAsc.length === 1) return sortedAsc[0];
    const idx = clamp(p, 0, 1) * (sortedAsc.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(sortedAsc.length - 1, lo + 1);
    const frac = idx - lo;
    return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return percentile(sorted, 0.5);
}

function sanitizePoints(points?: ReadonlyArray<SpatialPoint3D>): SpatialPoint3D[] {
    if (!Array.isArray(points)) return [];
    const valid: SpatialPoint3D[] = [];
    for (const pt of points) {
        if (
            Array.isArray(pt) &&
            pt.length >= 3 &&
            Number.isFinite(pt[0]) &&
            Number.isFinite(pt[1]) &&
            Number.isFinite(pt[2])
        ) {
            valid.push([pt[0], pt[1], pt[2]]);
        }
    }
    return valid;
}

function sanitizeWalkRingPoses(poses?: ReadonlyArray<WalkRingPose>): WalkRingPose[] {
    if (!Array.isArray(poses)) return [];
    const valid: WalkRingPose[] = [];
    for (const p of poses) {
        if (
            p &&
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            Number.isFinite(p.z)
        ) {
            valid.push({
                x: p.x,
                y: p.y,
                z: p.z,
                floorY: typeof p.floorY === 'number' && Number.isFinite(p.floorY) ? p.floorY : undefined,
                timestampMs:
                    typeof p.timestampMs === 'number' && Number.isFinite(p.timestampMs)
                        ? p.timestampMs
                        : undefined,
            });
        }
    }
    return valid;
}

/**
 * Resuelve sistema lineal 3x3 por eliminación Gaussiana con pivoteo parcial
 * para ajustar y = a*x + b*z + d por mínimos cuadrados ordinarios.
 */
function fitPlaneOls(samples: ReadonlyArray<SpatialPoint3D>): { a: number; b: number; d: number } | null {
    if (samples.length < 3) return null;

    let sxx = 0;
    let sxz = 0;
    let sx = 0;
    let szz = 0;
    let sz = 0;
    let sxy = 0;
    let szy = 0;
    let sy = 0;
    const n = samples.length;

    for (const [x, y, z] of samples) {
        sxx += x * x;
        sxz += x * z;
        sx += x;
        szz += z * z;
        sz += z;
        sxy += x * y;
        szy += z * y;
        sy += y;
    }

    const m: number[][] = [
        [sxx, sxz, sx, sxy],
        [sxz, szz, sz, szy],
        [sx, sz, n, sy],
    ];

    for (let col = 0; col < 3; col++) {
        let pivotRow = col;
        let maxAbs = Math.abs(m[col][col]);
        for (let r = col + 1; r < 3; r++) {
            const absVal = Math.abs(m[r][col]);
            if (absVal > maxAbs) {
                maxAbs = absVal;
                pivotRow = r;
            }
        }
        if (maxAbs < 1e-10) return null;
        if (pivotRow !== col) {
            const tmp = m[col];
            m[col] = m[pivotRow];
            m[pivotRow] = tmp;
        }
        const diag = m[col][col];
        for (let c = col; c < 4; c++) m[col][c] /= diag;
        for (let r = 0; r < 3; r++) {
            if (r === col) continue;
            const factor = m[r][col];
            for (let c = col; c < 4; c++) {
                m[r][c] -= factor * m[col][c];
            }
        }
    }

    const a = m[0][3];
    const b = m[1][3];
    const d = m[2][3];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(d)) return null;
    return { a, b, d };
}

function fitPlaneWls(
    samples: ReadonlyArray<SpatialPoint3D>,
    weights: ReadonlyArray<number>
): { a: number; b: number; d: number } | null {
    if (samples.length < 3 || weights.length !== samples.length) return null;

    let sxx = 0;
    let sxz = 0;
    let sx = 0;
    let szz = 0;
    let sz = 0;
    let sw = 0;
    let sxy = 0;
    let szy = 0;
    let sy = 0;

    for (let i = 0; i < samples.length; i++) {
        const w = weights[i];
        if (!Number.isFinite(w) || w <= 0) continue;
        const [x, y, z] = samples[i];
        sxx += w * x * x;
        sxz += w * x * z;
        sx += w * x;
        szz += w * z * z;
        sz += w * z;
        sw += w;
        sxy += w * x * y;
        szy += w * z * y;
        sy += w * y;
    }

    if (sw < 1e-6) return null;

    const m: number[][] = [
        [sxx, sxz, sx, sxy],
        [sxz, szz, sz, szy],
        [sx, sz, sw, sy],
    ];

    for (let col = 0; col < 3; col++) {
        let pivotRow = col;
        let maxAbs = Math.abs(m[col][col]);
        for (let r = col + 1; r < 3; r++) {
            const absVal = Math.abs(m[r][col]);
            if (absVal > maxAbs) {
                maxAbs = absVal;
                pivotRow = r;
            }
        }
        if (maxAbs < 1e-10) return null;
        if (pivotRow !== col) {
            const tmp = m[col];
            m[col] = m[pivotRow];
            m[pivotRow] = tmp;
        }
        const diag = m[col][col];
        for (let c = col; c < 4; c++) m[col][c] /= diag;
        for (let r = 0; r < 3; r++) {
            if (r === col) continue;
            const factor = m[r][col];
            for (let c = col; c < 4; c++) {
                m[r][c] -= factor * m[col][c];
            }
        }
    }

    const a = m[0][3];
    const b = m[1][3];
    const d = m[2][3];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(d)) return null;
    return { a, b, d };
}

/**
 * Refina un plano y = a*x + b*z + d mediante IRLS con función de pérdida Huber
 * y ajuste final de término independiente `d` por mediana `p50` (cero sesgo negativo).
 */
function fitPlaneIrlsHuber(
    samples: ReadonlyArray<SpatialPoint3D>,
    initial: { a: number; b: number; d: number },
    iterations = 5
): { a: number; b: number; d: number } {
    if (samples.length < 3) return initial;

    let current = { ...initial };
    const weights = new Array<number>(samples.length).fill(1);

    for (let iter = 0; iter < iterations; iter++) {
        const absResiduals = new Array<number>(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const [x, y, z] = samples[i];
            absResiduals[i] = Math.abs(y - (current.a * x + current.b * z + current.d));
        }
        const mad = median(absResiduals);
        const delta = Math.max(0.02, 1.345 * 1.4826 * mad);

        for (let i = 0; i < samples.length; i++) {
            const r = absResiduals[i];
            weights[i] = r <= delta ? 1.0 : delta / Math.max(1e-6, r);
        }

        const next = fitPlaneWls(samples, weights);
        if (!next || Math.hypot(next.a, next.b) > MAX_GROUND_TAN) {
            break;
        }
        current = next;
    }

    const offsets = samples.map(([x, y, z]) => y - (current.a * x + current.b * z));
    return {
        a: current.a,
        b: current.b,
        d: median(offsets),
    };
}

function computeEmpiricalGroundSigma(residuals: ReadonlyArray<number>, fallbackRms: number): number {
    if (residuals.length < 4) {
        return clamp(fallbackRms, 0.012, 0.06);
    }
    const med = median([...residuals]);
    const absDev = residuals.map((r) => Math.abs(r - med));
    const mad = median(absDev);
    return clamp(1.4826 * mad, 0.012, 0.06);
}

function sanitizeTargetConstraint(
    constraint?: TargetVolumeConstraint | null,
    scaleFactor = 1.0
): TargetVolumeConstraint | null {
    if (!constraint || typeof constraint !== 'object') return null;

    let anchorXZ: [number, number] | undefined;
    if (
        Array.isArray(constraint.anchorXZ) &&
        constraint.anchorXZ.length >= 2 &&
        Number.isFinite(constraint.anchorXZ[0]) &&
        Number.isFinite(constraint.anchorXZ[1])
    ) {
        anchorXZ = [constraint.anchorXZ[0] * scaleFactor, constraint.anchorXZ[1] * scaleFactor];
    }

    const radiusM =
        typeof constraint.radiusM === 'number' &&
        Number.isFinite(constraint.radiusM) &&
        constraint.radiusM > 0
            ? constraint.radiusM * scaleFactor
            : undefined;

    let polygonXZ: Array<[number, number]> | undefined;
    if (Array.isArray(constraint.polygonXZ)) {
        const cleanVerts: Array<[number, number]> = [];
        for (const v of constraint.polygonXZ) {
            if (
                Array.isArray(v) &&
                v.length >= 2 &&
                Number.isFinite(v[0]) &&
                Number.isFinite(v[1])
            ) {
                cleanVerts.push([v[0] * scaleFactor, v[1] * scaleFactor]);
            }
        }
        if (cleanVerts.length >= 3 && cleanVerts.length <= 8) {
            polygonXZ = cleanVerts;
        }
    }

    const padReferenceY =
        typeof constraint.padReferenceY === 'number' && Number.isFinite(constraint.padReferenceY)
            ? constraint.padReferenceY * scaleFactor
            : undefined;

    if (!anchorXZ && radiusM === undefined && !polygonXZ && padReferenceY === undefined) {
        return null;
    }

    return { anchorXZ, radiusM, polygonXZ, padReferenceY };
}

function pointInPolygonXZ(
    px: number,
    pz: number,
    polygon: ReadonlyArray<[number, number]>
): boolean {
    const n = polygon.length;
    if (n < 3) return true;

    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i][0];
        const zi = polygon[i][1];
        const xj = polygon[j][0];
        const zj = polygon[j][1];

        // Inclusión exacta sobre aristas
        const cross = (pz - zi) * (xj - xi) - (px - xi) * (zj - zi);
        if (Math.abs(cross) <= 1e-9) {
            const minX = Math.min(xi, xj) - 1e-9;
            const maxX = Math.max(xi, xj) + 1e-9;
            const minZ = Math.min(zi, zj) - 1e-9;
            const maxZ = Math.max(zi, zj) + 1e-9;
            if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
                return true;
            }
        }

        const intersects =
            zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 0.0) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

function fitPlaneThroughThreePoints(
    p0: SpatialPoint3D,
    p1: SpatialPoint3D,
    p2: SpatialPoint3D
): { a: number; b: number; d: number } | null {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    if (Math.abs(ny) < 1e-7) return null;
    const a = -nx / ny;
    const b = -nz / ny;
    const d = p0[1] - a * p0[0] - b * p0[2];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(d)) return null;
    return { a, b, d };
}

function createDeterministicPrng(seed = 0x5f3759df): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function angleBetweenGroundPlanesDeg(
    p1: { a: number; b: number },
    p2: { a: number; b: number }
): number {
    // Normales unitarias n = (-a, 1, -b) / sqrt(a^2 + b^2 + 1)
    const n1Len = Math.hypot(p1.a, 1, p1.b);
    const n2Len = Math.hypot(p2.a, 1, p2.b);
    const dot = clamp((p1.a * p2.a + 1 + p1.b * p2.b) / (n1Len * n2Len), -1, 1);
    return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Ajusta el plano de referencia del terreno sobre las poses de la trayectoria Walk-Ring
 * (usando floorY explícito si viene de ARCore o y_cam - operatorHeightM con rechazo de outliers).
 */
function fitWalkRingGroundPlane(
    walkRingPoses: ReadonlyArray<WalkRingPose>,
    operatorHeightM: number
): { a: number; b: number; d: number; slopeDeg: number; floorSamples: SpatialPoint3D[] } | null {
    if (walkRingPoses.length < 4) return null;

    const floorSamples: SpatialPoint3D[] = walkRingPoses.map((p) => [
        p.x,
        p.floorY !== undefined ? p.floorY : p.y - operatorHeightM,
        p.z,
    ]);

    const ols = fitPlaneOls(floorSamples);
    if (!ols) {
        const d = median(floorSamples.map((p) => p[1]));
        return { a: 0, b: 0, d, slopeDeg: 0, floorSamples };
    }

    // Refinamiento robusto (1 paso Huber/recorte inliers <= 0.15 m)
    const residuals = floorSamples.map((pt) => Math.abs(pt[1] - (ols.a * pt[0] + ols.b * pt[2] + ols.d)));
    const inliers = floorSamples.filter((_, idx) => residuals[idx] <= 0.15);
    const refined = inliers.length >= 4 ? fitPlaneOls(inliers) ?? ols : ols;

    const slopeTan = Math.hypot(refined.a, refined.b);
    if (slopeTan > MAX_GROUND_TAN) {
        const d = median(floorSamples.map((p) => p[1]));
        return { a: 0, b: 0, d, slopeDeg: 0, floorSamples };
    }

    const slopeDeg = (Math.atan(slopeTan) * 180) / Math.PI;
    return { ...refined, slopeDeg, floorSamples };
}

/**
 * Selecciona candidatos de suelo deduplicados y filtrados estrictamente por elevación baja (`y`),
 * eliminando la contaminación legacy de `byRadiusDesc` sobre laderas recortadas por ROI.
 */
function selectGroundCandidates(
    points: ReadonlyArray<SpatialPoint3D>,
    groundSamples: ReadonlyArray<SpatialPoint3D>,
    cx: number,
    cz: number,
    walkPlane?: { a: number; b: number; d: number } | null
): SpatialPoint3D[] {
    const candidates: SpatialPoint3D[] = [];
    const seenKeys = new Set<string>();

    const pushUnique = (pt: SpatialPoint3D) => {
        const key = `${Math.round(pt[0] * 100)}:${Math.round(pt[1] * 100)}:${Math.round(pt[2] * 100)}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        candidates.push(pt);
    };

    if (groundSamples.length > 0) {
        const filteredGround = walkPlane
            ? groundSamples.filter(
                  (pt) => Math.abs(pt[1] - (walkPlane.a * pt[0] + walkPlane.b * pt[2] + walkPlane.d)) <= 0.45
              )
            : groundSamples;
        const effectiveGround = filteredGround.length >= 6 ? filteredGround : groundSamples;
        const stride = Math.max(1, Math.floor(effectiveGround.length / 240));
        for (let i = 0; i < effectiveGround.length; i += stride) {
            pushUnique(effectiveGround[i]);
        }
        // Si ya disponemos de suficientes muestras explícitas de suelo (>= 12), evitar sesgar
        // el conjunto con mínimos del borde exterior de la nube de puntos del objeto.
        if (candidates.length >= 12) {
            return candidates;
        }
    }

    if (points.length === 0) return candidates;

    const withRadius = points.map((pt) => {
        const dx = pt[0] - cx;
        const dz = pt[2] - cz;
        const r = Math.hypot(dx, dz);
        const angle = Math.atan2(dz, dx);
        const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * RADIAL_SECTORS) % RADIAL_SECTORS;
        return { pt, r, sector };
    });

    const sectorBuckets: Array<Array<{ pt: SpatialPoint3D; r: number }>> = Array.from(
        { length: RADIAL_SECTORS },
        () => []
    );

    for (const item of withRadius) {
        sectorBuckets[item.sector].push({ pt: item.pt, r: item.r });
    }

    // Por cada sector radial: distinguir suelo circundante plano/inclinado (banda simétrica sin sesgo -2σ)
    // vs talud de acopio puro sin piso externo (perímetro extremo `r >= 0.90 * rMax`).
    for (const bucket of sectorBuckets) {
        if (bucket.length === 0) continue;
        const rSectorMax = Math.max(...bucket.map((b) => b.r));

        const outerRing = bucket.filter((b) => b.r >= rSectorMax * 0.88);
        const innerRing = bucket.filter(
            (b) => b.r >= rSectorMax * 0.72 && b.r < rSectorMax * 0.88
        );

        const isFlatSurroundingFloor =
            outerRing.length >= 3 &&
            innerRing.length >= 3 &&
            Math.abs(
                median(innerRing.map((b) => b.pt[1])) - median(outerRing.map((b) => b.pt[1]))
            ) <= 0.08;

        const pool = (
            isFlatSurroundingFloor
                ? bucket.filter((b) => b.r >= rSectorMax * 0.75)
                : outerRing.length > 0
                  ? outerRing
                  : bucket.filter((b) => b.r >= rSectorMax * 0.78)
        ).sort((a, b) => a.pt[1] - b.pt[1]);

        if (pool.length === 0) continue;
        const minSectorY = pool[0].pt[1];

        if (isFlatSurroundingFloor) {
            // Tomar la banda simétrica completa del piso (<= minY + 0.12 m) para p50 sin sesgo negativo
            const floorBand = pool.filter((item) => item.pt[1] <= minSectorY + 0.12);
            const stride = Math.max(1, Math.floor(floorBand.length / 16));
            for (let i = 0; i < floorBand.length; i += stride) {
                pushUnique(floorBand[i].pt);
            }
        } else {
            const lowTake = Math.max(1, Math.min(4, Math.ceil(pool.length * 0.16)));
            let taken = 0;
            for (const item of pool) {
                if (taken >= lowTake) break;
                if (taken > 0 && item.pt[1] > minSectorY + 0.06) break;
                pushUnique(item.pt);
                taken += 1;
            }
        }
    }

    return candidates;
}

/**
 * RANSAC determinista de muro vertical 2D (`nx*x + nz*z + d = 0`) para acopios confinados
 * (`SINGLE_WALL` / `BUNKER_3_WALLS`), identificando el plano vertical de contención trasero.
 */
function detectVerticalWallPlane(
    points: ReadonlyArray<SpatialPoint3D>,
    groundPlane: { a: number; b: number; d: number }
): VerticalWallPlane | null {
    const elevated = points
        .map(([x, y, z]) => ({ x, z, h: y - (groundPlane.a * x + groundPlane.b * z + groundPlane.d) }))
        .filter((p) => p.h > 0.35);

    if (elevated.length < 16) return null;

    const maxH = Math.max(...elevated.map((p) => p.h));
    const backCandidates = elevated.filter((p) => p.h >= maxH * 0.45);
    if (backCandidates.length < 8) return null;

    const nextRand = createDeterministicPrng(0x27d4eb2d);
    const n = backCandidates.length;
    const tolM = 0.12;
    let bestScore = -Infinity;
    let bestWall: VerticalWallPlane | null = null;

    for (let iter = 0; iter < 80; iter++) {
        const i0 = Math.floor(nextRand() * n);
        const i1 = Math.floor(nextRand() * n);
        if (i0 === i1) continue;

        const p0 = backCandidates[i0];
        const p1 = backCandidates[i1];
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.4) continue;

        let nx = -dz / len;
        let nz = dx / len;
        let d = -(nx * p0.x + nz * p0.z);

        let posSide = 0;
        let negSide = 0;
        let inliers = 0;
        for (const p of backCandidates) {
            const dist = nx * p.x + nz * p.z + d;
            if (Math.abs(dist) <= tolM) {
                inliers += 1;
            } else if (dist > tolM) {
                posSide += 1;
            } else {
                negSide += 1;
            }
        }

        // Orientar la normal hacia el lado donde reside el acopio (dist >= 0)
        if (negSide > posSide) {
            nx = -nx;
            nz = -nz;
            d = -d;
            const tmp = posSide;
            posSide = negSide;
            negSide = tmp;
        }

        const behindRatio = negSide / n;
        if (behindRatio > 0.12) continue;

        const score = inliers - negSide * 2;
        if (score > bestScore && inliers >= 6) {
            bestScore = score;
            bestWall = {
                nx: Number(nx.toFixed(6)),
                nz: Number(nz.toFixed(6)),
                d: Number(d.toFixed(5)),
                inlierRatio: round2(inliers / n),
            };
        }
    }

    return bestWall;
}

export interface FitGroundPlaneOptions {
    walkRingPoses?: ReadonlyArray<WalkRingPose>;
    wallConfinement?: WallConfinementMode;
    operatorHeightM?: number;
    targetConstraint?: TargetVolumeConstraint | null;
}

/**
 * Walk-Ring Toe Solver RANSAC determinista (`120` iteraciones) + IRLS Huber + mediana p50:
 * ajusta plano de cancha `y = a*x + b*z + d` sin sesgo negativo, respeta `padReferenceY`,
 * calcula ruido empírico `sigmaGround = clamp(1.4826 * MAD, 0.012, 0.06)` y soporta muro confinado.
 */
export function fitInclinedGroundPlane(
    pointsM: ReadonlyArray<SpatialPoint3D>,
    groundSamplesM?: ReadonlyArray<SpatialPoint3D>,
    anchorCenter?: { x: number; y: number; z: number } | null,
    options?: FitGroundPlaneOptions
): InclinedGroundPlaneResult {
    const points = sanitizePoints(pointsM);
    const groundSamples = sanitizePoints(groundSamplesM);
    const walkRingPoses = sanitizeWalkRingPoses(options?.walkRingPoses);
    const wallConfinement: WallConfinementMode = options?.wallConfinement || 'NONE';
    const constraint = sanitizeTargetConstraint(options?.targetConstraint, 1.0);
    const operatorHeightM =
        typeof options?.operatorHeightM === 'number' &&
        Number.isFinite(options.operatorHeightM) &&
        options.operatorHeightM > 0.4
            ? options.operatorHeightM
            : DEFAULT_OPERATOR_HEIGHT_M;

    const refPoints = points.length > 0 ? points : groundSamples;
    if (refPoints.length === 0) {
        const dFallback =
            constraint?.padReferenceY !== undefined
                ? constraint.padReferenceY
                : anchorCenter && Number.isFinite(anchorCenter.y)
                  ? anchorCenter.y
                  : 0;
        return {
            a: 0,
            b: 0,
            d: dFallback,
            residualRmsM: 0,
            sigmaGroundM: 0.012,
            groundSlopeDeg: 0,
            toeScore: 0,
            planeMismatchDeg: 0,
            usedWalkRingRegularization: false,
            wallPlane: null,
        };
    }

    const walkPlane = fitWalkRingGroundPlane(walkRingPoses, operatorHeightM);

    const cx = constraint?.anchorXZ
        ? constraint.anchorXZ[0]
        : anchorCenter && Number.isFinite(anchorCenter.x) && walkRingPoses.length === 0 && points.length === 0
          ? anchorCenter.x
          : walkRingPoses.length >= 4
            ? median(walkRingPoses.map((p) => p.x))
            : points.length > 0
              ? median(points.map((p) => p[0]))
              : median(refPoints.map((p) => p[0]));
    const cz = constraint?.anchorXZ
        ? constraint.anchorXZ[1]
        : anchorCenter && Number.isFinite(anchorCenter.z) && walkRingPoses.length === 0 && points.length === 0
          ? anchorCenter.z
          : walkRingPoses.length >= 4
            ? median(walkRingPoses.map((p) => p.z))
            : points.length > 0
              ? median(points.map((p) => p[2]))
              : median(refPoints.map((p) => p[2]));

    const candidates = selectGroundCandidates(points, groundSamples, cx, cz, walkPlane);

    // Si el operador fijó explícitamente una cota de patio (`padReferenceY`), respetarla como datum soberano.
    if (constraint?.padReferenceY !== undefined) {
        const baseA = walkPlane ? walkPlane.a : 0;
        const baseB = walkPlane ? walkPlane.b : 0;
        const d = constraint.padReferenceY - baseA * cx - baseB * cz;
        const residPool = groundSamples.length >= 4 ? groundSamples : candidates;
        const residuals = residPool
            .map((p) => p[1] - (baseA * p[0] + baseB * p[2] + d))
            .filter((r) => Math.abs(r) <= 0.12);
        const rms =
            residuals.length > 0
                ? Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / residuals.length)
                : 0.02;
        const sigmaGroundM = computeEmpiricalGroundSigma(residuals, rms);
        const slopeDeg = (Math.atan(Math.hypot(baseA, baseB)) * 180) / Math.PI;
        const toeScore = computeToeCoverageScore(
            points,
            groundSamples,
            baseA,
            baseB,
            d,
            cx,
            cz,
            rms,
            wallConfinement
        );
        return {
            a: Number(baseA.toFixed(6)),
            b: Number(baseB.toFixed(6)),
            d: Number(d.toFixed(5)),
            residualRmsM: Number(rms.toFixed(4)),
            sigmaGroundM: Number(sigmaGroundM.toFixed(4)),
            groundSlopeDeg: round2(slopeDeg),
            toeScore,
            walkRingSlopeDeg: walkPlane ? round2(walkPlane.slopeDeg) : undefined,
            planeMismatchDeg: 0,
            usedWalkRingRegularization: Boolean(walkPlane),
            wallPlane:
                wallConfinement !== 'NONE'
                    ? detectVerticalWallPlane(points, { a: baseA, b: baseB, d })
                    : null,
        };
    }

    const horizontalFallback = (): InclinedGroundPlaneResult => {
        const baseA = walkPlane ? walkPlane.a : 0;
        const baseB = walkPlane ? walkPlane.b : 0;
        const offsetPool = candidates.length >= 3 ? candidates : refPoints;
        const offsets = offsetPool
            .map((p) => p[1] - (baseA * p[0] + baseB * p[2]))
            .sort((a, b) => a - b);
        const d = candidates.length >= 3 ? percentile(offsets, 0.5) : percentile(offsets, 0.05);
        const residuals = offsetPool
            .map((p) => p[1] - (baseA * p[0] + baseB * p[2] + d))
            .filter((r) => Math.abs(r) <= 0.12);
        const rms =
            residuals.length > 0
                ? Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / residuals.length)
                : 0;
        const sigmaGroundM = computeEmpiricalGroundSigma(residuals, rms);
        const toeScore = computeToeCoverageScore(
            points,
            groundSamples,
            baseA,
            baseB,
            d,
            cx,
            cz,
            rms,
            wallConfinement
        );
        const slopeDeg = (Math.atan(Math.hypot(baseA, baseB)) * 180) / Math.PI;
        return {
            a: Number(baseA.toFixed(6)),
            b: Number(baseB.toFixed(6)),
            d: Number(d.toFixed(5)),
            residualRmsM: Number(rms.toFixed(4)),
            sigmaGroundM: Number(sigmaGroundM.toFixed(4)),
            groundSlopeDeg: round2(slopeDeg),
            toeScore,
            walkRingSlopeDeg: walkPlane ? round2(walkPlane.slopeDeg) : undefined,
            planeMismatchDeg: 0,
            usedWalkRingRegularization: Boolean(walkPlane),
            wallPlane:
                wallConfinement !== 'NONE'
                    ? detectVerticalWallPlane(points, { a: baseA, b: baseB, d })
                    : null,
        };
    };

    if (candidates.length < 6) {
        return horizontalFallback();
    }

    const supportSampleStride = Math.max(1, Math.floor(points.length / 180));
    const supportSample: SpatialPoint3D[] = [];
    for (let i = 0; i < points.length; i += supportSampleStride) {
        supportSample.push(points[i]);
    }

    const nextRand = createDeterministicPrng(0x5f3759df);
    let bestScore = -Infinity;
    let bestInliers: SpatialPoint3D[] = [];
    let bestPlane: { a: number; b: number; d: number } | null = null;

    const nCand = candidates.length;
    for (let iter = 0; iter < RANSAC_ITERATIONS; iter++) {
        const i0 = Math.floor(nextRand() * nCand);
        const i1 = Math.floor(nextRand() * nCand);
        const i2 = Math.floor(nextRand() * nCand);
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;

        const plane = fitPlaneThroughThreePoints(candidates[i0], candidates[i1], candidates[i2]);
        if (!plane) continue;

        const slopeTan = Math.hypot(plane.a, plane.b);
        if (slopeTan > MAX_GROUND_TAN) continue;

        const mismatchDeg = walkPlane ? angleBetweenGroundPlanesDeg(plane, walkPlane) : 0;
        if (walkPlane && mismatchDeg > MAX_WALK_RING_MISMATCH_DEG) {
            continue;
        }

        const inliers: SpatialPoint3D[] = [];
        let errorSumSq = 0;
        for (const pt of candidates) {
            const err = pt[1] - (plane.a * pt[0] + plane.b * pt[2] + plane.d);
            if (Math.abs(err) <= RANSAC_INLIER_TOL_M) {
                inliers.push(pt);
                errorSumSq += err * err;
            }
        }

        if (inliers.length < 3) continue;

        const belowLimit = -RANSAC_INLIER_TOL_M * 1.2;
        let belowCount = 0;
        for (const pt of supportSample) {
            const h = pt[1] - (plane.a * pt[0] + plane.b * pt[2] + plane.d);
            if (h < belowLimit) {
                belowCount += 1;
            }
        }
        const belowRatio = supportSample.length > 0 ? belowCount / supportSample.length : 0;
        const rmsInliers = Math.sqrt(errorSumSq / inliers.length);
        const belowPenaltyWeight = groundSamples.length >= 6 ? 1.5 : 2.2;
        const slopeDegCand = (Math.atan(slopeTan) * 180) / Math.PI;
        const gravityPriorPenalty =
            groundSamples.length < 6 && !walkPlane && slopeDegCand > 4.5
                ? (slopeDegCand - 4.5) * 1.6
                : 0;
        const walkMismatchPenalty = walkPlane ? mismatchDeg * 1.8 : 0;

        const score =
            inliers.length -
            belowRatio * nCand * belowPenaltyWeight -
            rmsInliers * 8 -
            gravityPriorPenalty -
            walkMismatchPenalty;

        if (score > bestScore) {
            bestScore = score;
            bestInliers = inliers;
            bestPlane = plane;
        }
    }

    if (!bestPlane || bestInliers.length < 3) {
        return horizontalFallback();
    }

    // Refinamiento robusto: OLS + IRLS Huber + mediana p50 (reemplaza p15 sin sesgo negativo)
    const olsRefined = fitPlaneOls(bestInliers) ?? bestPlane;
    const initRefined = Math.hypot(olsRefined.a, olsRefined.b) <= MAX_GROUND_TAN ? olsRefined : bestPlane;
    let finalPlane = fitPlaneIrlsHuber(bestInliers, initRefined);

    let usedWalkRingRegularization = false;
    let planeMismatchDeg = 0;

    if (walkPlane) {
        planeMismatchDeg = angleBetweenGroundPlanesDeg(finalPlane, walkPlane);
        if (planeMismatchDeg > MAX_WALK_RING_MISMATCH_DEG) {
            // Bloquear inclinación espuria anclando (a, b) al plano real del Walk-Ring con mediana p50
            const anchorPool = groundSamples.length >= 4 ? groundSamples : bestInliers.length >= 4 ? bestInliers : candidates;
            const offsets = anchorPool
                .map((pt) => pt[1] - (walkPlane.a * pt[0] + walkPlane.b * pt[2]))
                .sort((a, b) => a - b);
            finalPlane = {
                a: walkPlane.a,
                b: walkPlane.b,
                d: offsets.length > 0 ? percentile(offsets, 0.5) : walkPlane.d,
            };
            usedWalkRingRegularization = true;
        }
    } else {
        // Sin Walk-Ring ni muestras reales de suelo: bloquear pendientes espurias (> 5.5°) sin cobertura perimetral real
        const rawSlopeDeg = (Math.atan(Math.hypot(finalPlane.a, finalPlane.b)) * 180) / Math.PI;
        const preToeScore = computeToeCoverageScore(
            points,
            groundSamples,
            finalPlane.a,
            finalPlane.b,
            finalPlane.d,
            cx,
            cz,
            RANSAC_INLIER_TOL_M,
            wallConfinement
        );
        if (groundSamples.length < 6 && rawSlopeDeg > 5.5 && preToeScore < 65) {
            planeMismatchDeg = rawSlopeDeg;
            const candY = bestInliers.map((pt) => pt[1]).sort((a, b) => a - b);
            finalPlane = {
                a: 0,
                b: 0,
                d: percentile(candY, 0.5),
            };
            usedWalkRingRegularization = true;
        }
    }

    const residSource = groundSamples.length >= 6 ? groundSamples : candidates;
    const finalResiduals: number[] = [];
    for (const pt of residSource) {
        const err = pt[1] - (finalPlane.a * pt[0] + finalPlane.b * pt[2] + finalPlane.d);
        if (Math.abs(err) <= 0.12) {
            finalResiduals.push(err);
        }
    }
    const rms =
        finalResiduals.length > 0
            ? Math.sqrt(finalResiduals.reduce((acc, r) => acc + r * r, 0) / finalResiduals.length)
            : RANSAC_INLIER_TOL_M;
    const sigmaGroundM = computeEmpiricalGroundSigma(finalResiduals, rms);

    const slopeDeg = (Math.atan(Math.hypot(finalPlane.a, finalPlane.b)) * 180) / Math.PI;
    const toeScore = computeToeCoverageScore(
        points,
        groundSamples,
        finalPlane.a,
        finalPlane.b,
        finalPlane.d,
        cx,
        cz,
        rms,
        wallConfinement
    );

    const wallPlane =
        wallConfinement !== 'NONE' ? detectVerticalWallPlane(points, finalPlane) : null;

    return {
        a: Number(finalPlane.a.toFixed(6)),
        b: Number(finalPlane.b.toFixed(6)),
        d: Number(finalPlane.d.toFixed(5)),
        residualRmsM: Number(rms.toFixed(4)),
        sigmaGroundM: Number(sigmaGroundM.toFixed(4)),
        groundSlopeDeg: round2(slopeDeg),
        toeScore,
        walkRingSlopeDeg: walkPlane ? round2(walkPlane.slopeDeg) : undefined,
        planeMismatchDeg: round2(planeMismatchDeg),
        usedWalkRingRegularization,
        wallPlane,
    };
}

function computeToeCoverageScore(
    points: ReadonlyArray<SpatialPoint3D>,
    groundSamples: ReadonlyArray<SpatialPoint3D>,
    a: number,
    b: number,
    d: number,
    cx: number,
    cz: number,
    residualRmsM: number,
    wallConfinement: WallConfinementMode = 'NONE'
): number {
    const coveredSectors = new Set<number>();
    const combined = [...points, ...groundSamples];
    for (const [x, y, z] of combined) {
        const h = y - (a * x + b * z + d);
        if (Math.abs(h) <= 0.15) {
            const angle = Math.atan2(z - cz, x - cx);
            const sector =
                Math.floor(((angle + Math.PI) / (2 * Math.PI)) * RADIAL_SECTORS) % RADIAL_SECTORS;
            coveredSectors.add(sector);
        }
    }

    const expectedSectors =
        wallConfinement === 'BUNKER_3_WALLS'
            ? 8
            : wallConfinement === 'SINGLE_WALL'
              ? 10
              : RADIAL_SECTORS;
    const sectorRatio = clamp(coveredSectors.size / expectedSectors, 0, 1);
    const fitFactor = clamp(1 - residualRmsM / 0.15, 0.55, 1.0);
    return Math.round(clamp(sectorRatio * 100 * fitFactor, 0, 100));
}

class MinPriorityQueue {
    private readonly keys: number[] = [];
    private readonly values: number[] = [];

    get size(): number {
        return this.keys.length;
    }

    push(key: number, value: number): void {
        let i = this.keys.length;
        this.keys.push(key);
        this.values.push(value);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[parent] <= this.keys[i]) break;
            const tk = this.keys[parent];
            this.keys[parent] = this.keys[i];
            this.keys[i] = tk;
            const tv = this.values[parent];
            this.values[parent] = this.values[i];
            this.values[i] = tv;
            i = parent;
        }
    }

    pop(): number {
        const top = this.values[0];
        const lastKey = this.keys.pop()!;
        const lastVal = this.values.pop()!;
        if (this.keys.length > 0) {
            this.keys[0] = lastKey;
            this.values[0] = lastVal;
            let i = 0;
            const n = this.keys.length;
            while (true) {
                const l = (i << 1) + 1;
                const r = l + 1;
                let smallest = i;
                if (l < n && this.keys[l] < this.keys[smallest]) smallest = l;
                if (r < n && this.keys[r] < this.keys[smallest]) smallest = r;
                if (smallest === i) break;
                const tk = this.keys[i];
                this.keys[i] = this.keys[smallest];
                this.keys[smallest] = tk;
                const tv = this.values[i];
                this.values[i] = this.values[smallest];
                this.values[smallest] = tv;
                i = smallest;
            }
        }
        return top;
    }
}

/**
 * Detecta picos competidores (`>= max(0.20, 0.25 * hTarget)` separados por silla >= 15%)
 * y ejecuta Priority-Flood Watershed 3D sobre `-h(x, z)` para cortar por la línea de valle.
 */
function buildWatershedTargetMask(
    observed: Uint8Array,
    allowedMask: Uint8Array,
    heightsM: number[],
    nx: number,
    nz: number,
    originX: number,
    originZ: number,
    cellSizeM: number,
    hSeed: number,
    hToe: number,
    anchorXZ: [number, number] | null
): Uint8Array | null {
    const total = nx * nz;
    const smoothH = new Float64Array(total);
    const smoothValid = new Uint8Array(total);

    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!allowedMask[idx]) continue;

            let sum = 0;
            let wSum = 0;
            let obsNeighbors = 0;
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nIdx = (iz + dz) * nx + (ix + dx);
                    if (!allowedMask[nIdx] || !observed[nIdx] || heightsM[nIdx] < hToe) continue;
                    const w = dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1;
                    sum += heightsM[nIdx] * w;
                    wSum += w;
                    if (dx !== 0 || dz !== 0) obsNeighbors += 1;
                }
            }

            if (observed[idx] && heightsM[idx] >= hToe && wSum > 0) {
                smoothH[idx] = sum / wSum;
                smoothValid[idx] = 1;
            } else if (!observed[idx] && obsNeighbors >= 4 && wSum > 0) {
                // Puentes de 1 celda solo para no crear falsas sillas por micro-oclusiones
                smoothH[idx] = sum / wSum;
                smoothValid[idx] = 1;
            }
        }
    }

    const rWin = clamp(Math.round(0.45 / cellSizeM), 2, 5);
    const localMaxIndices: number[] = [];

    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!observed[idx] || !allowedMask[idx] || smoothH[idx] < hSeed) continue;

            const hVal = smoothH[idx];
            let isMax = true;
            for (let dz = -rWin; dz <= rWin && isMax; dz++) {
                const nzC = iz + dz;
                if (nzC <= 0 || nzC >= nz - 1) continue;
                for (let dx = -rWin; dx <= rWin; dx++) {
                    if (dx === 0 && dz === 0) continue;
                    if (dx * dx + dz * dz > rWin * rWin) continue;
                    const nxC = ix + dx;
                    if (nxC <= 0 || nxC >= nx - 1) continue;
                    const nIdx = nzC * nx + nxC;
                    if (!smoothValid[nIdx]) continue;
                    const nh = smoothH[nIdx];
                    if (nh > hVal + 1e-6 || (Math.abs(nh - hVal) <= 1e-6 && nIdx < idx)) {
                        isMax = false;
                        break;
                    }
                }
            }

            if (isMax) {
                localMaxIndices.push(idx);
            }
        }
    }

    if (localMaxIndices.length < 2) {
        return null;
    }

    // Elegir pico objetivo: más cercano a anchorXZ si existe, o pico más alto en caso contrario
    let targetPeak = localMaxIndices[0];
    if (anchorXZ) {
        let bestDistSq = Infinity;
        for (const pIdx of localMaxIndices) {
            const px = originX + (pIdx % nx) * cellSizeM;
            const pz = originZ + Math.floor(pIdx / nx) * cellSizeM;
            const dSq = (px - anchorXZ[0]) ** 2 + (pz - anchorXZ[1]) ** 2;
            if (
                dSq < bestDistSq - 1e-6 ||
                (Math.abs(dSq - bestDistSq) <= 1e-6 && smoothH[pIdx] > smoothH[targetPeak])
            ) {
                bestDistSq = dSq;
                targetPeak = pIdx;
            }
        }
    } else {
        for (const pIdx of localMaxIndices) {
            if (smoothH[pIdx] > smoothH[targetPeak]) {
                targetPeak = pIdx;
            }
        }
    }

    const hTarget = smoothH[targetPeak];
    const minCompetitorH = Math.max(0.2, 0.25 * hTarget);
    const competingPeaks: number[] = [];

    const bfsVisited = new Uint8Array(total);
    const bfsQueue = new Int32Array(total);

    const isConnectedAbove = (startIdx: number, endIdx: number, thresholdH: number): boolean => {
        bfsVisited.fill(0);
        let head = 0;
        let tail = 0;
        bfsVisited[startIdx] = 1;
        bfsQueue[tail++] = startIdx;

        while (head < tail) {
            const curr = bfsQueue[head++];
            if (curr === endIdx) return true;
            const cx = curr % nx;
            const cz = Math.floor(curr / nx);
            for (let dz = -1; dz <= 1; dz++) {
                const nzC = cz + dz;
                if (nzC <= 0 || nzC >= nz - 1) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0) continue;
                    const nxC = cx + dx;
                    if (nxC <= 0 || nxC >= nx - 1) continue;
                    const nIdx = nzC * nx + nxC;
                    if (bfsVisited[nIdx] || !smoothValid[nIdx] || smoothH[nIdx] <= thresholdH) {
                        continue;
                    }
                    bfsVisited[nIdx] = 1;
                    bfsQueue[tail++] = nIdx;
                }
            }
        }
        return false;
    };

    for (const pIdx of localMaxIndices) {
        if (pIdx === targetPeak) continue;
        const hp = smoothH[pIdx];
        if (hp < minCompetitorH) continue;
        // Verificar silla/valle real (>= 15% de caída respecto al menor de los dos picos)
        const saddleLimit = 0.85 * Math.min(hTarget, hp);
        if (!isConnectedAbove(targetPeak, pIdx, saddleLimit)) {
            competingPeaks.push(pIdx);
        }
    }

    if (competingPeaks.length === 0) {
        return null;
    }

    // Priority-Flood Watershed 3D sobre `-h(x, z)`
    const label = new Int32Array(total);
    const pq = new MinPriorityQueue();

    label[targetPeak] = 1;
    pq.push(-smoothH[targetPeak], targetPeak);

    for (let i = 0; i < competingPeaks.length; i++) {
        const cIdx = competingPeaks[i];
        label[cIdx] = i + 2;
        pq.push(-smoothH[cIdx], cIdx);
    }

    while (pq.size > 0) {
        const curr = pq.pop();
        const currLabel = label[curr];
        const cx = curr % nx;
        const cz = Math.floor(curr / nx);

        for (let dz = -1; dz <= 1; dz++) {
            const nzC = cz + dz;
            if (nzC <= 0 || nzC >= nz - 1) continue;
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dz === 0) continue;
                const nxC = cx + dx;
                if (nxC <= 0 || nxC >= nx - 1) continue;
                const nIdx = nzC * nx + nxC;
                if (label[nIdx] !== 0 || !allowedMask[nIdx] || !smoothValid[nIdx]) continue;
                label[nIdx] = currLabel;
                pq.push(-smoothH[nIdx], nIdx);
            }
        }
    }

    const targetBasin = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        if (label[i] === 1) {
            targetBasin[i] = 1;
        }
    }
    return targetBasin;
}

/**
 * Segmentación Pie-Objeto por Histéresis Dual (`hSeed` / `hToe`) + Componente Conexo 8-vecinos +
 * Expansión Geodésica acotada (`<= max(2 celdas, 0.25 * rCore)`) + Recorte `polygonXZ` + Watershed 3D.
 */
function segmentTargetObjectMask(params: {
    observed: Uint8Array;
    heightsM: number[];
    nx: number;
    nz: number;
    originX: number;
    originZ: number;
    cellSizeM: number;
    sigmaGroundM: number;
    anchorXZ: [number, number] | null;
    targetRadiusM?: number;
    polygonXZ?: ReadonlyArray<[number, number]>;
}): {
    objectObservedMask: Uint8Array;
    allowedMask: Uint8Array;
    hSeed: number;
    hToe: number;
    usedWatershed: boolean;
} {
    const {
        observed,
        heightsM,
        nx,
        nz,
        originX,
        originZ,
        cellSizeM,
        sigmaGroundM,
        anchorXZ,
        targetRadiusM,
        polygonXZ,
    } = params;

    const total = nx * nz;
    const allowedMask = new Uint8Array(total);
    allowedMask.fill(1);

    const hasPoly = Boolean(polygonXZ && polygonXZ.length >= 3);
    const hasRadius = targetRadiusM !== undefined && targetRadiusM > 0 && anchorXZ !== null;

    if (hasPoly || hasRadius) {
        const maxR = hasRadius ? targetRadiusM! * 1.02 : Infinity;
        for (let iz = 0; iz < nz; iz++) {
            const wz = originZ + iz * cellSizeM;
            for (let ix = 0; ix < nx; ix++) {
                const wx = originX + ix * cellSizeM;
                const idx = iz * nx + ix;
                if (hasPoly && !pointInPolygonXZ(wx, wz, polygonXZ!)) {
                    allowedMask[idx] = 0;
                    continue;
                }
                if (hasRadius) {
                    const dist = Math.hypot(wx - anchorXZ![0], wz - anchorXZ![1]);
                    if (dist > maxR) {
                        allowedMask[idx] = 0;
                    }
                }
            }
        }
    }

    // Estimar hPeak en la región objetivo (priorizando proximidad al anchorXZ si existe)
    let hPeakLocal = 0;
    let hPeakGlobal = 0;
    const localProbeR = targetRadiusM !== undefined ? Math.max(0.5, targetRadiusM) : 1.5;

    for (let iz = 1; iz < nz - 1; iz++) {
        const wz = originZ + iz * cellSizeM;
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!observed[idx] || !allowedMask[idx]) continue;
            const h = heightsM[idx];
            if (h > hPeakGlobal) hPeakGlobal = h;
            if (anchorXZ) {
                const wx = originX + ix * cellSizeM;
                if (Math.hypot(wx - anchorXZ[0], wz - anchorXZ[1]) <= localProbeR && h > hPeakLocal) {
                    hPeakLocal = h;
                }
            }
        }
    }

    const hPeak = hPeakLocal > 0.08 ? hPeakLocal : hPeakGlobal;
    const hSeed = Math.max(0.08, 3.5 * sigmaGroundM, 0.15 * hPeak);
    const hToe = Math.max(0.03, 2.0 * sigmaGroundM, 0.04 * hPeak);

    // Watershed 3D cuando existe pico competidor dentro de la grilla/ROI
    const watershedBasin = buildWatershedTargetMask(
        observed,
        allowedMask,
        heightsM,
        nx,
        nz,
        originX,
        originZ,
        cellSizeM,
        hSeed,
        hToe,
        anchorXZ
    );

    const effectiveAllowed = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        effectiveAllowed[i] = allowedMask[i] && (!watershedBasin || watershedBasin[i]) ? 1 : 0;
    }

    // 1. Extraer componentes conexos 8-vecinos del núcleo (`h >= hSeed`)
    const visited = new Uint8Array(total);
    interface CoreCluster {
        cells: number[];
        minDistSq: number;
        centroidDistSq: number;
        maxH: number;
    }
    const clusters: CoreCluster[] = [];
    const queue: number[] = [];

    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const startIdx = iz * nx + ix;
            if (
                visited[startIdx] ||
                !observed[startIdx] ||
                !effectiveAllowed[startIdx] ||
                heightsM[startIdx] < hSeed
            ) {
                continue;
            }

            visited[startIdx] = 1;
            queue.length = 0;
            queue.push(startIdx);
            const cells: number[] = [];
            let minDistSq = Infinity;
            let sumX = 0;
            let sumZ = 0;
            let maxClusterH = 0;

            let head = 0;
            while (head < queue.length) {
                const curr = queue[head++];
                cells.push(curr);
                if (heightsM[curr] > maxClusterH) maxClusterH = heightsM[curr];
                const cxCell = curr % nx;
                const czCell = Math.floor(curr / nx);
                const wx = originX + cxCell * cellSizeM;
                const wz = originZ + czCell * cellSizeM;
                sumX += wx;
                sumZ += wz;
                if (anchorXZ) {
                    const dSq = (wx - anchorXZ[0]) ** 2 + (wz - anchorXZ[1]) ** 2;
                    if (dSq < minDistSq) minDistSq = dSq;
                }

                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nxCell = cxCell + dx;
                        const nzCell = czCell + dz;
                        if (nxCell <= 0 || nxCell >= nx - 1 || nzCell <= 0 || nzCell >= nz - 1) {
                            continue;
                        }
                        const nIdx = nzCell * nx + nxCell;
                        if (
                            visited[nIdx] ||
                            !observed[nIdx] ||
                            !effectiveAllowed[nIdx] ||
                            heightsM[nIdx] < hSeed
                        ) {
                            continue;
                        }
                        visited[nIdx] = 1;
                        queue.push(nIdx);
                    }
                }
            }

            const meanX = sumX / cells.length;
            const meanZ = sumZ / cells.length;
            const centroidDistSq = anchorXZ
                ? (meanX - anchorXZ[0]) ** 2 + (meanZ - anchorXZ[1]) ** 2
                : 0;
            clusters.push({
                cells,
                minDistSq: anchorXZ ? minDistSq : 0,
                centroidDistSq,
                maxH: maxClusterH,
            });
        }
    }

    const objectObservedMask = new Uint8Array(total);
    if (clusters.length === 0) {
        return {
            objectObservedMask,
            allowedMask: effectiveAllowed,
            hSeed,
            hToe,
            usedWatershed: Boolean(watershedBasin),
        };
    }

    // Selección del núcleo principal: alrededor de anchorXZ o núcleo más alto sin anchor
    let selectedCluster: CoreCluster;
    if (anchorXZ) {
        const nearbyMulti = clusters.filter(
            (c) => c.cells.length >= 2 && Math.sqrt(c.minDistSq) <= Math.max(0.35, cellSizeM * 5)
        );
        const pool = nearbyMulti.length > 0 ? nearbyMulti : clusters;
        const distTieTolSq = (cellSizeM * 1.5) ** 2;

        pool.sort((a, b) => {
            const aSubstantial = a.cells.length >= 4;
            const bSubstantial = b.cells.length >= 4;
            if (aSubstantial !== bSubstantial && nearbyMulti.length > 1) {
                return aSubstantial ? -1 : 1;
            }
            if (Math.abs(a.minDistSq - b.minDistSq) > distTieTolSq) {
                return a.minDistSq - b.minDistSq;
            }
            if (Math.abs(a.centroidDistSq - b.centroidDistSq) > distTieTolSq) {
                return a.centroidDistSq - b.centroidDistSq;
            }
            return b.cells.length - a.cells.length;
        });
        selectedCluster = pool[0];
    } else {
        const substantial = clusters.filter((c) => c.cells.length >= 4);
        const pool = substantial.length > 0 ? substantial : clusters;
        pool.sort((a, b) => {
            if (Math.abs(b.maxH - a.maxH) > 0.05) {
                return b.maxH - a.maxH;
            }
            return b.cells.length - a.cells.length;
        });
        selectedCluster = pool[0];
    }

    // 2. Expansión geodésica acotada Core -> Toe (`<= max(2 celdas, 0.25 * rCore)`)
    const rCoreM = Math.sqrt((selectedCluster.cells.length * cellSizeM * cellSizeM) / Math.PI);
    const maxExpandM = Math.max(2 * cellSizeM, 0.25 * rCoreM);
    const distFromCore = new Float64Array(total);
    distFromCore.fill(Infinity);
    const pq = new MinPriorityQueue();

    for (const idx of selectedCluster.cells) {
        objectObservedMask[idx] = 1;
        distFromCore[idx] = 0;
        pq.push(0, idx);
    }

    const SQRT2 = Math.SQRT2;
    while (pq.size > 0) {
        const curr = pq.pop();
        const currDist = distFromCore[curr];
        if (currDist >= maxExpandM) continue;

        const cxCell = curr % nx;
        const czCell = Math.floor(curr / nx);
        const currH = heightsM[curr];

        for (let dz = -1; dz <= 1; dz++) {
            const nzCell = czCell + dz;
            if (nzCell <= 0 || nzCell >= nz - 1) continue;
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dz === 0) continue;
                const nxCell = cxCell + dx;
                if (nxCell <= 0 || nxCell >= nx - 1) continue;
                const nIdx = nzCell * nx + nxCell;
                if (!observed[nIdx] || !effectiveAllowed[nIdx] || heightsM[nIdx] < hToe) {
                    continue;
                }
                const stepM = dx === 0 || dz === 0 ? cellSizeM : cellSizeM * SQRT2;
                const nextDist = currDist + stepM;
                if (nextDist > maxExpandM + 1e-6 || nextDist >= distFromCore[nIdx]) {
                    continue;
                }
                // Evitar propagación plana sobre suelo ruidoso que apenas alcanza hToe
                const nh = heightsM[nIdx];
                const slopeStep = Math.abs(currH - nh) / stepM;
                if (nh < 0.5 * hSeed && slopeStep < 0.12) {
                    continue;
                }
                distFromCore[nIdx] = nextDist;
                objectObservedMask[nIdx] = 1;
                pq.push(nextDist, nIdx);
            }
        }
    }

    return {
        objectObservedMask,
        allowedMask: effectiveAllowed,
        hSeed,
        hToe,
        usedWatershed: Boolean(watershedBasin),
    };
}

interface DelaunayVertex2D {
    x: number;
    z: number;
    h: number;
}

interface DelaunayTriangle2D {
    i0: number;
    i1: number;
    i2: number;
    cx: number;
    cz: number;
    rSq: number;
}

function makeDelaunayTriangle(
    verts: ReadonlyArray<DelaunayVertex2D>,
    i0: number,
    i1: number,
    i2: number
): DelaunayTriangle2D | null {
    const a = verts[i0];
    const b = verts[i1];
    const c = verts[i2];
    const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
    if (Math.abs(d) < 1e-10) return null;
    const a2 = a.x * a.x + a.z * a.z;
    const b2 = b.x * b.x + b.z * b.z;
    const c2 = c.x * c.x + c.z * c.z;
    const cx = (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d;
    const cz = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    const rSq = (a.x - cx) * (a.x - cx) + (a.z - cz) * (a.z - cz);
    return { i0, i1, i2, cx, cz, rSq };
}

/**
 * Triangulación Delaunay 2D Bowyer-Watson determinista sobre celdas observadas de borde/ancla
 * para interpolar huecos internos sin cráteres (`zeroCellsInside = 0`).
 */
function buildDelaunay2D(inputVerts: ReadonlyArray<DelaunayVertex2D>): DelaunayTriangle2D[] {
    if (inputVerts.length < 3) return [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const v of inputVerts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }

    const dx = Math.max(1, maxX - minX);
    const dz = Math.max(1, maxZ - minZ);
    const deltaMax = Math.max(dx, dz) * 10;
    const midX = (minX + maxX) * 0.5;
    const midZ = (minZ + maxZ) * 0.5;

    const verts: DelaunayVertex2D[] = [
        ...inputVerts,
        { x: midX - deltaMax, z: midZ - deltaMax, h: 0 },
        { x: midX, z: midZ + deltaMax * 2, h: 0 },
        { x: midX + deltaMax, z: midZ - deltaMax, h: 0 },
    ];
    const st0 = inputVerts.length;
    const st1 = inputVerts.length + 1;
    const st2 = inputVerts.length + 2;

    const superTri = makeDelaunayTriangle(verts, st0, st1, st2);
    if (!superTri) return [];
    let triangles: DelaunayTriangle2D[] = [superTri];

    for (let vi = 0; vi < inputVerts.length; vi++) {
        const pt = verts[vi];
        const badTriangles: DelaunayTriangle2D[] = [];
        const goodTriangles: DelaunayTriangle2D[] = [];

        for (const tri of triangles) {
            const distSq = (pt.x - tri.cx) * (pt.x - tri.cx) + (pt.z - tri.cz) * (pt.z - tri.cz);
            if (distSq <= tri.rSq + 1e-9) {
                badTriangles.push(tri);
            } else {
                goodTriangles.push(tri);
            }
        }

        const edgeCounts = new Map<string, { a: number; b: number; count: number }>();
        const addEdge = (a: number, b: number) => {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const key = `${lo}:${hi}`;
            const prev = edgeCounts.get(key);
            if (prev) prev.count += 1;
            else edgeCounts.set(key, { a, b, count: 1 });
        };

        for (const tri of badTriangles) {
            addEdge(tri.i0, tri.i1);
            addEdge(tri.i1, tri.i2);
            addEdge(tri.i2, tri.i0);
        }

        for (const edge of edgeCounts.values()) {
            if (edge.count === 1) {
                const nt = makeDelaunayTriangle(verts, edge.a, edge.b, vi);
                if (nt) goodTriangles.push(nt);
            }
        }

        triangles = goodTriangles;
    }

    return triangles.filter((t) => t.i0 < st0 && t.i1 < st0 && t.i2 < st0);
}

function interpolateHeightDelaunay(
    px: number,
    pz: number,
    verts: ReadonlyArray<DelaunayVertex2D>,
    triangles: ReadonlyArray<DelaunayTriangle2D>
): number | null {
    for (const tri of triangles) {
        const a = verts[tri.i0];
        const b = verts[tri.i1];
        const c = verts[tri.i2];
        const denom = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(denom) < 1e-10) continue;
        const w0 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / denom;
        const w1 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
            return w0 * a.h + w1 * b.h + w2 * c.h;
        }
    }
    return null;
}

/**
 * Rellena el 100% de los huecos interiores de la huella (`zeroCellsInside = 0`)
 * mediante flood-fill exterior + triangulación Delaunay 2D + relajación armónica acotada,
 * devolviendo la máscara `interpolatedMask` para trazabilidad de oclusión e ISA-101.
 */
function fillInteriorHolesDelaunay(
    primaryCluster: Uint8Array,
    heightsM: number[],
    nx: number,
    nz: number,
    allowedMask?: Uint8Array
): {
    interpolatedMask: number[];
    exteriorMask: Uint8Array;
    zeroCellsInside: number;
} {
    const total = nx * nz;
    const exteriorMask = new Uint8Array(total);
    const queue: number[] = [];

    // 1. Flood-fill 4-conectado desde el perímetro de la grilla para identificar el exterior real
    const enqueueExterior = (ix: number, iz: number) => {
        const idx = iz * nx + ix;
        if (exteriorMask[idx] || primaryCluster[idx]) return;
        exteriorMask[idx] = 1;
        queue.push(idx);
    };

    for (let ix = 0; ix < nx; ix++) {
        enqueueExterior(ix, 0);
        enqueueExterior(ix, nz - 1);
    }
    for (let iz = 0; iz < nz; iz++) {
        enqueueExterior(0, iz);
        enqueueExterior(nx - 1, iz);
    }

    let head = 0;
    while (head < queue.length) {
        const curr = queue[head++];
        const cx = curr % nx;
        const cz = Math.floor(curr / nx);
        if (cx > 0) enqueueExterior(cx - 1, cz);
        if (cx < nx - 1) enqueueExterior(cx + 1, cz);
        if (cz > 0) enqueueExterior(cx, cz - 1);
        if (cz < nz - 1) enqueueExterior(cx, cz + 1);
    }

    // 2. Identificar TODOS los huecos interiores (no alcanzables desde el exterior) + micro-muescas >= 5 vecinos
    const holeMask = new Uint8Array(total);
    let holeCount = 0;

    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (primaryCluster[idx]) continue;
            if (allowedMask && !allowedMask[idx]) {
                exteriorMask[idx] = 1;
                continue;
            }

            if (!exteriorMask[idx]) {
                holeMask[idx] = 1;
                holeCount += 1;
                continue;
            }

            let clusterNeighbors = 0;
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0) continue;
                    if (primaryCluster[(iz + dz) * nx + (ix + dx)]) {
                        clusterNeighbors += 1;
                    }
                }
            }
            if (clusterNeighbors >= 5) {
                holeMask[idx] = 1;
                exteriorMask[idx] = 0;
                holeCount += 1;
            }
        }
    }

    const interpolatedMask = new Array<number>(total).fill(0);
    if (holeCount === 0) {
        return { interpolatedMask, exteriorMask, zeroCellsInside: 0 };
    }

    // 3. Recolectar vértices frontera de `primaryCluster` adyacentes a huecos (y anclas de soporte) para Delaunay 2D
    const boundaryVerts: DelaunayVertex2D[] = [];
    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!primaryCluster[idx]) continue;

            let touchesHole = false;
            for (let dz = -1; dz <= 1 && !touchesHole; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (holeMask[(iz + dz) * nx + (ix + dx)]) {
                        touchesHole = true;
                        break;
                    }
                }
            }
            if (touchesHole) {
                boundaryVerts.push({ x: ix, z: iz, h: heightsM[idx] });
            }
        }
    }

    // Limitar vértices Delaunay para latencia determinista < 10 ms manteniendo cobertura de frontera
    const maxDelaunayVerts = 420;
    const delaunayVerts =
        boundaryVerts.length > maxDelaunayVerts
            ? boundaryVerts.filter(
                  (_, i) => i % Math.ceil(boundaryVerts.length / maxDelaunayVerts) === 0
              )
            : boundaryVerts;

    const triangles = buildDelaunay2D(delaunayVerts);

    // 4. Interpolar cada celda de hueco mediante Delaunay 2D con respaldo IDW sobre frontera observada
    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!holeMask[idx]) continue;

            let interpH = interpolateHeightDelaunay(ix, iz, delaunayVerts, triangles);
            if (interpH === null || !Number.isFinite(interpH) || interpH <= 0.02) {
                // Respaldo IDW (ponderación inversa al cuadrado de la distancia) sobre vértices observados
                let wSum = 0;
                let hSum = 0;
                for (const v of boundaryVerts) {
                    const dSq = (ix - v.x) * (ix - v.x) + (iz - v.z) * (iz - v.z);
                    const w = 1 / Math.max(0.25, dSq);
                    wSum += w;
                    hSum += w * v.h;
                }
                interpH = wSum > 0 ? hSum / wSum : 0.025;
            }

            heightsM[idx] = Number(Math.max(0.021, interpH).toFixed(4));
            interpolatedMask[idx] = 1;
        }
    }

    // 5. Suavizado armónico (Laplace) estrictamente dentro de la huella (NUNCA promedia ceros del exterior)
    for (let step = 0; step < 16; step++) {
        for (let iz = 1; iz < nz - 1; iz++) {
            for (let ix = 1; ix < nx - 1; ix++) {
                const idx = iz * nx + ix;
                if (!holeMask[idx]) continue;

                let sum = 0;
                let cnt = 0;
                const neighbors = [idx - 1, idx + 1, idx - nx, idx + nx];
                for (const nIdx of neighbors) {
                    if (primaryCluster[nIdx] || holeMask[nIdx]) {
                        sum += heightsM[nIdx];
                        cnt += 1;
                    }
                }
                if (cnt > 0) {
                    heightsM[idx] = Number(Math.max(0.021, sum / cnt).toFixed(4));
                }
            }
        }
    }

    let zeroCellsInside = 0;
    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!exteriorMask[idx] && heightsM[idx] <= 0) {
                zeroCellsInside += 1;
            }
        }
    }

    return { interpolatedMask, exteriorMask, zeroCellsInside };
}

function computePrincipalFootprintAxes(
    cells: ReadonlyArray<{ x: number; z: number }>,
    cellSizeM: number
): { baseLengthM: number; baseWidthM: number; axisU: [number, number]; axisV: [number, number] } {
    if (cells.length === 0) {
        return { baseLengthM: 0, baseWidthM: 0, axisU: [1, 0], axisV: [0, 1] };
    }
    let meanX = 0;
    let meanZ = 0;
    for (const c of cells) {
        meanX += c.x;
        meanZ += c.z;
    }
    meanX /= cells.length;
    meanZ /= cells.length;

    let cxx = 0;
    let czz = 0;
    let cxz = 0;
    for (const c of cells) {
        const dx = c.x - meanX;
        const dz = c.z - meanZ;
        cxx += dx * dx;
        czz += dz * dz;
        cxz += dx * dz;
    }

    const angle = 0.5 * Math.atan2(2 * cxz, cxx - czz);
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const vx = -uz;
    const vz = ux;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const c of cells) {
        const dx = c.x - meanX;
        const dz = c.z - meanZ;
        const u = dx * ux + dz * uz;
        const v = dx * vx + dz * vz;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }

    const spanU = maxU - minU + cellSizeM;
    const spanV = maxV - minV + cellSizeM;

    if (spanU >= spanV) {
        return {
            baseLengthM: round2(spanU),
            baseWidthM: round2(spanV),
            axisU: [ux, uz],
            axisV: [vx, vz],
        };
    }
    return {
        baseLengthM: round2(spanV),
        baseWidthM: round2(spanU),
        axisU: [vx, vz],
        axisV: [ux, uz],
    };
}

/**
 * Fórmula estricta de Talud del Objeto (`slopeAngleAvgDeg` + `slopeProfile`):
 * - Dominio exclusivo: celdas observadas dentro de `objectMask` en cinturón de flancos
 *   `h ∈ [max(0.18 * H, hToe + 2 * sigmaGround), 0.82 * H]`.
 * - Primario: perfil radial `h(d_edge)` Theil-Sen por 16 sectores (`median(atan2(|Δh|, |Δd_edge|))`).
 * - Secundario / DEM corregido: suma `+ planeA` y `+ planeB` respecto a `+Y` gravedad,
 *   diferencias unilaterales en el borde de `objectMask`, descarte mesetas `< 12°`, techo `89.5°`.
 */
function computeStrictObjectSlope(params: {
    relativePoints: ReadonlyArray<{ x: number; z: number; h: number }>;
    objectObservedMask: Uint8Array;
    objectMask: Uint8Array;
    interpolatedMask: ReadonlyArray<number>;
    heightsM: ReadonlyArray<number>;
    nx: number;
    nz: number;
    originX: number;
    originZ: number;
    cellSizeM: number;
    maxH: number;
    hToe: number;
    sigmaGroundM: number;
    groundPlane: { a: number; b: number };
    objectCenterX: number;
    objectCenterZ: number;
    axisV: [number, number];
}): {
    slopeDegGrid: number[];
    slopeAngleAvgDeg: number | null;
    slopeAngleLeftDeg: number | null;
    slopeAngleRightDeg: number | null;
    slopeProfile: SlopeProfile | null;
} {
    const {
        relativePoints,
        objectObservedMask,
        objectMask,
        interpolatedMask,
        heightsM,
        nx,
        nz,
        originX,
        originZ,
        cellSizeM,
        maxH,
        hToe,
        sigmaGroundM,
        groundPlane,
        objectCenterX,
        objectCenterZ,
        axisV,
    } = params;

    const totalCells = nx * nz;
    const slopeDegGrid = new Array<number>(totalCells).fill(0);

    if (maxH < 0.5) {
        return {
            slopeDegGrid,
            slopeAngleAvgDeg: null,
            slopeAngleLeftDeg: null,
            slopeAngleRightDeg: null,
            slopeProfile: null,
        };
    }

    const hMinFlank = Math.max(0.18 * maxH, hToe + 2 * sigmaGroundM);
    const hMaxFlank = 0.82 * maxH;

    // 1. Colectar celdas exteriores inmediatamente adyacentes al borde de objectMask para d_edge euclidiana
    const outsideEdgeCoords: Array<{ x: number; z: number }> = [];
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            if (objectMask[idx] === 1) continue;
            let touchesObject = false;
            for (let dz = -1; dz <= 1 && !touchesObject; dz++) {
                const nzC = iz + dz;
                if (nzC < 0 || nzC >= nz) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nxC = ix + dx;
                    if (nxC < 0 || nxC >= nx) continue;
                    if (objectMask[nzC * nx + nxC] === 1) {
                        touchesObject = true;
                        break;
                    }
                }
            }
            if (touchesObject) {
                outsideEdgeCoords.push({
                    x: originX + ix * cellSizeM,
                    z: originZ + iz * cellSizeM,
                });
            }
        }
    }

    const computeEdgeDist = (px: number, pz: number): number => {
        let minSq = Infinity;
        for (let i = 0; i < outsideEdgeCoords.length; i++) {
            const dx = px - outsideEdgeCoords[i].x;
            const dz = pz - outsideEdgeCoords[i].z;
            const dSq = dx * dx + dz * dz;
            if (dSq < minSq) minSq = dSq;
        }
        return minSq < Infinity ? Math.max(0, Math.sqrt(minSq) - 0.5 * cellSizeM) : 0;
    };

    // 2. Primario: Perfil radial h(d_edge) Theil-Sen por 16 sectores sobre puntos observados en cinturón de flancos
    const primarySectorAngles: number[] = [];
    const primaryLeftAngles: number[] = [];
    const primaryRightAngles: number[] = [];

    if (outsideEdgeCoords.length > 0 && hMinFlank < hMaxFlank) {
        const sectorBuckets: Array<Array<{ x: number; z: number; h: number; dEdge: number }>> =
            Array.from({ length: RADIAL_SECTORS }, () => []);

        for (const pt of relativePoints) {
            if (pt.h < hMinFlank || pt.h > hMaxFlank) continue;
            const ix = Math.round((pt.x - originX) / cellSizeM);
            const iz = Math.round((pt.z - originZ) / cellSizeM);
            if (ix <= 0 || ix >= nx - 1 || iz <= 0 || iz >= nz - 1) continue;
            const idx = iz * nx + ix;
            if (!objectMask[idx] || !objectObservedMask[idx] || interpolatedMask[idx] === 1) {
                continue;
            }
            const angle = Math.atan2(pt.z - objectCenterZ, pt.x - objectCenterX);
            const sector =
                Math.floor(((angle + Math.PI) / (2 * Math.PI)) * RADIAL_SECTORS) % RADIAL_SECTORS;
            sectorBuckets[sector].push({
                x: pt.x,
                z: pt.z,
                h: pt.h,
                dEdge: computeEdgeDist(pt.x, pt.z),
            });
        }

        const minDd = Math.max(0.04, cellSizeM * 0.6);
        const minDhVert = Math.max(0.08, 3.0 * sigmaGroundM);

        for (let s = 0; s < RADIAL_SECTORS; s++) {
            const rawBucket = sectorBuckets[s];
            if (rawBucket.length < 4) continue;

            rawBucket.sort((a, b) => a.h - b.h);
            const maxPts = 48;
            const bucket =
                rawBucket.length > maxPts
                    ? rawBucket.filter(
                          (_, i) => i % Math.ceil(rawBucket.length / maxPts) === 0
                      )
                    : rawBucket;

            const pairAngles: number[] = [];
            for (let i = 0; i < bucket.length; i++) {
                const pi = bucket[i];
                for (let j = i + 1; j < bucket.length; j++) {
                    const pj = bucket[j];
                    const dd = pj.dEdge - pi.dEdge;
                    const dyWorld =
                        pj.h -
                        pi.h +
                        groundPlane.a * (pj.x - pi.x) +
                        groundPlane.b * (pj.z - pi.z);
                    if (Math.abs(dd) < minDd && Math.abs(dyWorld) < minDhVert) continue;
                    const angDeg = clamp(
                        (Math.atan2(Math.abs(dyWorld), Math.max(1e-4, Math.abs(dd))) * 180) /
                            Math.PI,
                        0,
                        89.5
                    );
                    if (angDeg < 12) continue;
                    pairAngles.push(angDeg);
                }
            }

            if (pairAngles.length >= 3) {
                const medSector = median(pairAngles);
                primarySectorAngles.push(medSector);
                const meanX = bucket.reduce((acc, p) => acc + p.x, 0) / bucket.length - objectCenterX;
                const meanZ = bucket.reduce((acc, p) => acc + p.z, 0) / bucket.length - objectCenterZ;
                const sideProj = meanX * axisV[0] + meanZ * axisV[1];
                if (sideProj < 0) primaryLeftAngles.push(medSector);
                else primaryRightAngles.push(medSector);
            }
        }
    }

    // 3. Secundario / Gradiente DEM corregido (+ planeA, + planeB, unilaterales en borde, techo 89.5°)
    const secondaryAnglesAll: number[] = [];
    const secondaryAnglesLeft: number[] = [];
    const secondaryAnglesRight: number[] = [];

    const isObsInObj = (idx: number): boolean =>
        objectMask[idx] === 1 && objectObservedMask[idx] === 1 && interpolatedMask[idx] === 0;

    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (!isObsInObj(idx)) continue;

            const nL = idx - 1;
            const nR = idx + 1;
            const nU = idx - nx;
            const nD = idx + nx;

            const h = heightsM[idx];
            const outL = objectMask[nL] === 0;
            const outR = objectMask[nR] === 0;
            const outU = objectMask[nU] === 0;
            const outD = objectMask[nD] === 0;
            const isBorderCell = outL || outR || outU || outD;

            let dhdx: number | null = null;
            if (isObsInObj(nL) && isObsInObj(nR)) {
                dhdx = (heightsM[nR] - heightsM[nL]) / (2 * cellSizeM);
            } else if (outL && !outR) {
                const edgeGrad = h / cellSizeM;
                const innerGrad = isObsInObj(nR) ? (heightsM[nR] - h) / cellSizeM : 0;
                dhdx = Math.abs(edgeGrad) >= Math.abs(innerGrad) ? edgeGrad : innerGrad;
            } else if (outR && !outL) {
                const edgeGrad = -h / cellSizeM;
                const innerGrad = isObsInObj(nL) ? (h - heightsM[nL]) / cellSizeM : 0;
                dhdx = Math.abs(edgeGrad) >= Math.abs(innerGrad) ? edgeGrad : innerGrad;
            } else if (outL && outR) {
                dhdx = h / cellSizeM;
            } else if (isObsInObj(nR)) {
                dhdx = (heightsM[nR] - h) / cellSizeM;
            } else if (isObsInObj(nL)) {
                dhdx = (h - heightsM[nL]) / cellSizeM;
            }

            let dhdz: number | null = null;
            if (isObsInObj(nU) && isObsInObj(nD)) {
                dhdz = (heightsM[nD] - heightsM[nU]) / (2 * cellSizeM);
            } else if (outU && !outD) {
                const edgeGrad = h / cellSizeM;
                const innerGrad = isObsInObj(nD) ? (heightsM[nD] - h) / cellSizeM : 0;
                dhdz = Math.abs(edgeGrad) >= Math.abs(innerGrad) ? edgeGrad : innerGrad;
            } else if (outD && !outU) {
                const edgeGrad = -h / cellSizeM;
                const innerGrad = isObsInObj(nU) ? (h - heightsM[nU]) / cellSizeM : 0;
                dhdz = Math.abs(edgeGrad) >= Math.abs(innerGrad) ? edgeGrad : innerGrad;
            } else if (outU && outD) {
                dhdz = h / cellSizeM;
            } else if (isObsInObj(nD)) {
                dhdz = (heightsM[nD] - h) / cellSizeM;
            } else if (isObsInObj(nU)) {
                dhdz = (h - heightsM[nU]) / cellSizeM;
            }

            if (dhdx === null && dhdz === null) continue;

            const dydx = (dhdx ?? 0) + groundPlane.a;
            const dydz = (dhdz ?? 0) + groundPlane.b;
            const gradMag = Math.hypot(dydx, dydz);
            const angleDeg = clamp((Math.atan(gradMag) * 180) / Math.PI, 0, 89.5);
            slopeDegGrid[idx] = round1(angleDeg);

            if (angleDeg < 12) continue;

            const inFlankBelt = h >= hMinFlank && h <= hMaxFlank;
            const isVerticalCliffBorder = isBorderCell && h >= hMinFlank && angleDeg >= 65;
            if (!inFlankBelt && !isVerticalCliffBorder) continue;

            secondaryAnglesAll.push(angleDeg);
            const wx = originX + ix * cellSizeM - objectCenterX;
            const wz = originZ + iz * cellSizeM - objectCenterZ;
            const sideProj = wx * axisV[0] + wz * axisV[1];
            if (sideProj < 0) secondaryAnglesLeft.push(angleDeg);
            else secondaryAnglesRight.push(angleDeg);
        }
    }

    const usePrimary =
        primarySectorAngles.length >= 3 ||
        (primarySectorAngles.length > 0 && secondaryAnglesAll.length === 0);

    const slopeAngleAvgDeg = usePrimary
        ? round1(median(primarySectorAngles))
        : secondaryAnglesAll.length > 0
          ? round1(median(secondaryAnglesAll))
          : null;

    const leftPool = usePrimary ? primaryLeftAngles : secondaryAnglesLeft;
    const rightPool = usePrimary ? primaryRightAngles : secondaryAnglesRight;

    const slopeAngleLeftDeg =
        leftPool.length > 0 ? round1(median(leftPool)) : slopeAngleAvgDeg;
    const slopeAngleRightDeg =
        rightPool.length > 0 ? round1(median(rightPool)) : slopeAngleAvgDeg;

    return {
        slopeDegGrid,
        slopeAngleAvgDeg,
        slopeAngleLeftDeg,
        slopeAngleRightDeg,
        slopeProfile: classifySlopeProfile(slopeAngleAvgDeg),
    };
}

/**
 * Calcula volumen métrico real desde nube 3D (MVS Offline / ARCore VIO):
 * Calibración -> Walk-Ring Toe Solver IRLS Huber + p50 sin sesgo negativo ->
 * Grilla adaptativa -> Mediana p50 por celda -> Histéresis Dual + Clustering 8-conectado + Watershed 3D ->
 * Relleno Delaunay solo interior sin cráteres (zeroCellsInside = 0) -> p99 altura +
 * Talud estricto Theil-Sen h(d_edge) + gradiente DEM +Y hasta 89.5° -> Incertidumbre honesta ±Δ% + MetrologyGrade.
 */
export function computeSpatialStockpileVolume(input: SpatialVolumeInput): SpatialVolumeResult {
    const rawPoints = sanitizePoints(input.pointsM);
    if (rawPoints.length < 20) {
        throw new SpatialVolumeValidationError(
            `Nube espacial insuficiente (${rawPoints.length} puntos; minimo 20 requeridos).`,
            'INVALID_POINT_CLOUD'
        );
    }

    const effectiveSectorsTotal =
        typeof input.sectorsTotal === 'number' &&
        Number.isFinite(input.sectorsTotal) &&
        input.sectorsTotal > 0
            ? input.sectorsTotal
            : RADIAL_SECTORS;

    const declaredCoveragePct =
        typeof input.coveragePct === 'number' && Number.isFinite(input.coveragePct)
            ? clamp(input.coveragePct, 0, 100)
            : typeof input.sectorsCovered === 'number' && Number.isFinite(input.sectorsCovered)
              ? clamp((input.sectorsCovered / effectiveSectorsTotal) * 100, 0, 100)
              : null;

    if (declaredCoveragePct !== null && declaredCoveragePct < 35) {
        throw new SpatialVolumeValidationError(
            'Falta rodear más el acopio para obtener una medición confiable',
            'INSUFFICIENT_COVERAGE'
        );
    }

    const scaleFactor =
        typeof input.calibrationScaleFactor === 'number' &&
        Number.isFinite(input.calibrationScaleFactor)
            ? clamp(input.calibrationScaleFactor, 0.85, 1.15)
            : 1.0;

    const scaledPoints: SpatialPoint3D[] =
        scaleFactor === 1.0
            ? rawPoints
            : rawPoints.map(([x, y, z]) => [x * scaleFactor, y * scaleFactor, z * scaleFactor]);

    const rawGroundSamples = sanitizePoints(input.groundSamplesM);
    const scaledGroundSamples: SpatialPoint3D[] =
        scaleFactor === 1.0
            ? rawGroundSamples
            : rawGroundSamples.map(([x, y, z]) => [
                  x * scaleFactor,
                  y * scaleFactor,
                  z * scaleFactor,
              ]);

    const rawWalkRing = sanitizeWalkRingPoses(input.walkRingPoses);
    const scaledWalkRing: WalkRingPose[] =
        scaleFactor === 1.0
            ? rawWalkRing
            : rawWalkRing.map((p) => ({
                  ...p,
                  x: p.x * scaleFactor,
                  y: p.y * scaleFactor,
                  z: p.z * scaleFactor,
                  floorY: p.floorY !== undefined ? p.floorY * scaleFactor : undefined,
              }));

    const scaledAnchorCenter =
        input.anchorCenter &&
        Number.isFinite(input.anchorCenter.x) &&
        Number.isFinite(input.anchorCenter.y) &&
        Number.isFinite(input.anchorCenter.z)
            ? {
                  x: input.anchorCenter.x * scaleFactor,
                  y: input.anchorCenter.y * scaleFactor,
                  z: input.anchorCenter.z * scaleFactor,
              }
            : null;

    const scaledConstraint = sanitizeTargetConstraint(input.targetConstraint, scaleFactor);

    const effectiveRoiRadiusM =
        typeof input.roiRadiusM === 'number' &&
        Number.isFinite(input.roiRadiusM) &&
        input.roiRadiusM > 0
            ? input.roiRadiusM * scaleFactor
            : undefined;

    const effectiveAnchorXZ: [number, number] | null =
        scaledConstraint?.anchorXZ ??
        (scaledAnchorCenter ? [scaledAnchorCenter.x, scaledAnchorCenter.z] : null);

    const roiCenterX = effectiveAnchorXZ
        ? effectiveAnchorXZ[0]
        : median(scaledPoints.map((p) => p[0]));
    const roiCenterZ = effectiveAnchorXZ
        ? effectiveAnchorXZ[1]
        : median(scaledPoints.map((p) => p[2]));

    // Aplicar roiRadiusM legado antes del plano base (manteniendo suelo circundante si solo viene targetConstraint)
    const points = effectiveRoiRadiusM
        ? scaledPoints.filter(
              ([x, , z]) => Math.hypot(x - roiCenterX, z - roiCenterZ) <= effectiveRoiRadiusM * 1.15
          )
        : scaledPoints;

    const groundSamples = effectiveRoiRadiusM
        ? scaledGroundSamples.filter(
              ([x, , z]) => Math.hypot(x - roiCenterX, z - roiCenterZ) <= effectiveRoiRadiusM * 1.35
          )
        : scaledGroundSamples;

    if (points.length < 10) {
        throw new SpatialVolumeValidationError(
            'Los puntos dentro del radio seleccionado son insuficientes para medir.',
            'INVALID_POINT_CLOUD'
        );
    }

    const wallConfinement: WallConfinementMode = input.wallConfinement || 'NONE';

    const groundPlane = fitInclinedGroundPlane(points, groundSamples, scaledAnchorCenter, {
        walkRingPoses: scaledWalkRing,
        wallConfinement,
        operatorHeightM: input.operatorHeightM,
        targetConstraint: scaledConstraint,
    });

    const sigmaGroundM =
        typeof groundPlane.sigmaGroundM === 'number' && Number.isFinite(groundPlane.sigmaGroundM)
            ? clamp(groundPlane.sigmaGroundM, 0.012, 0.06)
            : clamp(groundPlane.residualRmsM, 0.012, 0.06);

    const relativePoints: Array<{ x: number; z: number; h: number }> = [];
    for (const [x, y, z] of points) {
        const h = y - (groundPlane.a * x + groundPlane.b * z + groundPlane.d);
        if (h < -0.25 || h > 60) continue;
        relativePoints.push({ x, z, h });
    }

    if (relativePoints.length < 10) {
        throw new SpatialVolumeValidationError(
            'Los puntos capturados no definen un acopio valido sobre el plano base.',
            'INVALID_POINT_CLOUD'
        );
    }

    // Restricción espacial opcional para delimitar la grilla al objeto objetivo
    const targetRelativePoints = relativePoints.filter((pt) => {
        if (
            scaledConstraint?.polygonXZ &&
            !pointInPolygonXZ(pt.x, pt.z, scaledConstraint.polygonXZ)
        ) {
            return false;
        }
        if (scaledConstraint?.radiusM !== undefined && effectiveAnchorXZ) {
            const dist = Math.hypot(pt.x - effectiveAnchorXZ[0], pt.z - effectiveAnchorXZ[1]);
            if (dist > scaledConstraint.radiusM * 1.05) {
                return false;
            }
        }
        return true;
    });

    const activeRelPoints =
        targetRelativePoints.length >= 6 ? targetRelativePoints : relativePoints;

    let hPeakPre = 0;
    for (const pt of activeRelPoints) {
        if (pt.h > hPeakPre) hPeakPre = pt.h;
    }
    const hSeedPre = Math.max(0.08, 3.5 * sigmaGroundM, 0.15 * hPeakPre);
    const hToePre = Math.max(0.03, 2.0 * sigmaGroundM, 0.04 * hPeakPre);

    const seedPoints = activeRelPoints.filter((p) => p.h >= hSeedPre);
    let boundSource: Array<{ x: number; z: number; h: number }>;

    if (seedPoints.length >= 6) {
        let sMinX = Infinity;
        let sMaxX = -Infinity;
        let sMinZ = Infinity;
        let sMaxZ = -Infinity;
        for (const p of seedPoints) {
            if (p.x < sMinX) sMinX = p.x;
            if (p.x > sMaxX) sMaxX = p.x;
            if (p.z < sMinZ) sMinZ = p.z;
            if (p.z > sMaxZ) sMaxZ = p.z;
        }
        const seedMaxSpan = Math.max(0.04, sMaxX - sMinX, sMaxZ - sMinZ);
        const pad = Math.max(0.35, 0.35 * seedMaxSpan);
        const nearToePoints = activeRelPoints.filter(
            (p) =>
                p.h >= hToePre &&
                p.x >= sMinX - pad &&
                p.x <= sMaxX + pad &&
                p.z >= sMinZ - pad &&
                p.z <= sMaxZ + pad
        );
        boundSource = nearToePoints.length >= 6 ? nearToePoints : seedPoints;
    } else {
        const pilePoints = activeRelPoints.filter((p) => p.h > 0.015);
        boundSource = pilePoints.length >= 6 ? pilePoints : activeRelPoints;
    }

    const xs = boundSource.map((p) => p.x).sort((a, b) => a - b);
    const zs = boundSource.map((p) => p.z).sort((a, b) => a - b);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const minZ = zs[0];
    const maxZ = zs[zs.length - 1];

    const spanX = Math.max(0.04, maxX - minX);
    const spanZ = Math.max(0.04, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanZ);

    // Grilla adaptativa:
    // - Retrocompatibilidad miniatura con roiRadiusM <= 1.0 y maxSpan < 1.0 -> 0.04 m exacto.
    // - Objetos pequeños (< 1.5 m, ej. cilindro 54x33 cm) -> [0.03..0.04 m] para preservar paredes y volumen.
    // - Acopios mineros reales (>= 1.5 m) -> [0.08..0.25 m].
    const isLegacyMiniatureRoi =
        maxSpan < 1.0 &&
        effectiveRoiRadiusM !== undefined &&
        effectiveRoiRadiusM <= 1.0 &&
        !scaledConstraint;
    const isSmallObject = maxSpan < 1.5;
    const densityCellSize = Math.sqrt((spanX * spanZ) / Math.max(40, boundSource.length * 0.95));
    const cellSizeM = isLegacyMiniatureRoi
        ? 0.04
        : isSmallObject
          ? Number(clamp(Math.max(maxSpan / 56, densityCellSize * 0.9), 0.02, 0.04).toFixed(4))
          : Number(
                Math.max(
                    clamp(Math.max(maxSpan / 64, densityCellSize * 1.15), 0.08, 0.25),
                    maxSpan / 120
                ).toFixed(4)
            );

    const nx = Math.min(128, Math.max(8, Math.ceil(spanX / cellSizeM) + 4));
    const nz = Math.min(128, Math.max(8, Math.ceil(spanZ / cellSizeM) + 4));
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const originX = centerX - ((nx - 1) * cellSizeM) * 0.5;
    const originZ = centerZ - ((nz - 1) * cellSizeM) * 0.5;

    const totalCells = nx * nz;
    const cellBuckets: number[][] = Array.from({ length: totalCells }, () => []);

    for (const pt of activeRelPoints) {
        const ix = Math.round((pt.x - originX) / cellSizeM);
        const iz = Math.round((pt.z - originZ) / cellSizeM);
        if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
        cellBuckets[iz * nx + ix].push(pt.h);
    }

    const observed = new Uint8Array(totalCells);
    const observationCount = new Array<number>(totalCells).fill(0);
    const heightsM = new Array<number>(totalCells).fill(0);

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            const bucket = cellBuckets[idx];
            if (bucket.length === 0) continue;

            observed[idx] = 1;
            observationCount[idx] = bucket.length;
            const sorted = [...bucket].sort((a, b) => a - b);
            const repHeight = Math.max(0, percentile(sorted, 0.5));
            const isGridBorder = ix === 0 || ix === nx - 1 || iz === 0 || iz === nz - 1;
            heightsM[idx] = isGridBorder ? 0 : Number(repHeight.toFixed(4));
        }
    }

    // Segmentación Pie-Objeto por Histéresis Dual + Clustering 8-vecinos + Watershed 3D + Polígono
    const {
        objectObservedMask,
        allowedMask,
        hToe,
    } = segmentTargetObjectMask({
        observed,
        heightsM,
        nx,
        nz,
        originX,
        originZ,
        cellSizeM,
        sigmaGroundM,
        anchorXZ: effectiveAnchorXZ,
        targetRadiusM: scaledConstraint?.radiusM,
        polygonXZ: scaledConstraint?.polygonXZ,
    });

    for (let idx = 0; idx < totalCells; idx++) {
        if (!objectObservedMask[idx]) {
            heightsM[idx] = 0;
            observationCount[idx] = 0;
        }
    }

    // Relleno Delaunay solo de huecos interiores (zeroCellsInside = 0, sin puentes globales)
    const { interpolatedMask, zeroCellsInside } = fillInteriorHolesDelaunay(
        objectObservedMask,
        heightsM,
        nx,
        nz,
        allowedMask
    );

    const objectMask = new Uint8Array(totalCells);
    for (let idx = 0; idx < totalCells; idx++) {
        if (objectObservedMask[idx] === 1 || interpolatedMask[idx] === 1) {
            objectMask[idx] = 1;
        }
    }

    // Integral volumétrica discreta + altura p99 + oclusión + huella activa
    const cellArea = cellSizeM * cellSizeM;
    let rawVolume = 0;
    let interpolatedVolume = 0;
    let maxH = 0;
    const activeHeights: number[] = [];
    const activeFootprintCells: Array<{ x: number; z: number }> = [];

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            if (!objectMask[idx]) continue;
            const h = heightsM[idx];
            if (h > 0) {
                const cellVol = h * cellArea;
                rawVolume += cellVol;
                if (interpolatedMask[idx] === 1) {
                    interpolatedVolume += cellVol;
                }
                if (h > maxH) maxH = h;
            }
            if (h > 0.02) {
                activeHeights.push(h);
                activeFootprintCells.push({
                    x: originX + ix * cellSizeM,
                    z: originZ + iz * cellSizeM,
                });
            }
        }
    }

    if (maxH < 0.25) {
        throw new SpatialVolumeValidationError(
            'Objeto muy bajo para medir con cámara (mínimo 25 cm de altura)',
            'OBJECT_TOO_SMALL'
        );
    }

    activeHeights.sort((a, b) => a - b);
    const p99H = activeHeights.length >= 10 ? percentile(activeHeights, 0.99) : maxH;

    const volumeM3 = rawVolume < 1.0 ? round4(rawVolume) : round2(rawVolume);
    const heightM = round2(p99H);
    const rawFootprintArea = activeFootprintCells.length * cellArea;
    const footprintAreaM2 = rawFootprintArea < 1.0 ? round4(rawFootprintArea) : round2(rawFootprintArea);
    const occludedVolumePct =
        rawVolume > 0 ? round1(clamp((interpolatedVolume / rawVolume) * 100, 0, 100)) : 0;

    const { baseLengthM, baseWidthM, axisV } = computePrincipalFootprintAxes(
        activeFootprintCells,
        cellSizeM
    );

    const objectCenterX =
        activeFootprintCells.length > 0
            ? activeFootprintCells.reduce((acc, c) => acc + c.x, 0) / activeFootprintCells.length
            : centerX;
    const objectCenterZ =
        activeFootprintCells.length > 0
            ? activeFootprintCells.reduce((acc, c) => acc + c.z, 0) / activeFootprintCells.length
            : centerZ;

    // Fórmula estricta de Talud del Objeto (Theil-Sen h(d_edge) + DEM +Y hasta 89.5° + slopeProfile)
    const {
        slopeDegGrid,
        slopeAngleAvgDeg,
        slopeAngleLeftDeg,
        slopeAngleRightDeg,
        slopeProfile,
    } = computeStrictObjectSlope({
        relativePoints: activeRelPoints,
        objectObservedMask,
        objectMask,
        interpolatedMask,
        heightsM,
        nx,
        nz,
        originX,
        originZ,
        cellSizeM,
        maxH,
        hToe,
        sigmaGroundM,
        groundPlane,
        objectCenterX,
        objectCenterZ,
        axisV,
    });

    let slopeWarning: string | null = null;
    if (maxH >= 0.5 && slopeAngleAvgDeg !== null && slopeAngleAvgDeg > 48 && wallConfinement === 'NONE') {
        slopeWarning = `Talud medido ${slopeAngleAvgDeg}° supera ángulo límite físico natural (~45°–48°).`;
    } else if (maxH >= 0.5 && slopeAngleAvgDeg !== null && slopeAngleAvgDeg > 38) {
        slopeWarning = `Talud medido ${slopeAngleAvgDeg}° supera referencia de 38°. Verificar estabilidad operativa.`;
    }

    const loopDriftPct =
        typeof input.loopDriftPct === 'number' && Number.isFinite(input.loopDriftPct)
            ? round2(Math.max(0, input.loopDriftPct))
            : 0;
    const hasAnchor = Boolean(input.hasScaleAnchor);
    const loopClosed = input.loopClosed !== false;
    const crestClippedRatio =
        typeof input.crestClippedRatio === 'number' && Number.isFinite(input.crestClippedRatio)
            ? clamp(input.crestClippedRatio, 0, 1)
            : 0;

    // Fórmula honesta de incertidumbre ±Δ% acotada en [2.5%, 45.0%]
    let uncertaintyRaw =
        3.5 +
        1.5 * loopDriftPct +
        0.35 * occludedVolumePct +
        0.12 * Math.max(0, 80 - groundPlane.toeScore) +
        1.2 * Math.max(0, groundPlane.planeMismatchDeg) +
        (loopClosed ? 0 : 3.5) -
        (hasAnchor ? 1.5 : 0);

    // Penalización adicional honesta cuando hay cobertura parcial (< 80%) o fuente VIO dispersa
    if (declaredCoveragePct !== null && declaredCoveragePct < 80) {
        uncertaintyRaw += (80 - declaredCoveragePct) * 0.15;
    }
    if (String(input.depthMode || '').toUpperCase() === 'VIO_POINTCLOUD') {
        uncertaintyRaw += 3.5;
    }

    const uncertaintyPct = round1(clamp(uncertaintyRaw, 2.5, 45.0));
    const confidence = round2(clamp(1 - uncertaintyPct / 50, 0.15, 0.99));

    // Semáforo metrológico honesto (MetrologyGrade)
    const metrologyReasons: string[] = [];
    if (uncertaintyPct > 25) metrologyReasons.push(`Incertidumbre crítica ±${uncertaintyPct}% (> 25%).`);
    if (groundPlane.toeScore < 45) metrologyReasons.push(`Cobertura de pie insuficiente (${groundPlane.toeScore}/100).`);
    if (loopDriftPct > 5) metrologyReasons.push(`Deriva VIO excesiva (${loopDriftPct}% > 5%).`);
    if (occludedVolumePct > 40) metrologyReasons.push(`Oclusión volumétrica excesiva (${occludedVolumePct}% > 40%).`);

    let metrologyGrade: MetrologyGrade = 'VALID_IN_SITU';
    if (metrologyReasons.length > 0) {
        metrologyGrade = 'REJECTED';
    } else {
        if (uncertaintyPct > 12) {
            metrologyReasons.push(`Incertidumbre elevada ±${uncertaintyPct}% (> 12%).`);
        }
        if (groundPlane.toeScore < 65) {
            metrologyReasons.push(`Cobertura de pie parcial (${groundPlane.toeScore}/100 < 65).`);
        }
        if (occludedVolumePct > 20) {
            metrologyReasons.push(`Volumen interpolado elevado (${occludedVolumePct}% > 20%).`);
        }
        if (loopDriftPct > 2.5) {
            metrologyReasons.push(`Deriva VIO moderada (${loopDriftPct}% > 2.5%).`);
        }
        if (crestClippedRatio > 0.15) {
            metrologyReasons.push(`Corona recortada en encuadre (${round1(crestClippedRatio * 100)}%).`);
        }
        if (
            wallConfinement === 'NONE' &&
            slopeAngleAvgDeg !== null &&
            slopeAngleAvgDeg > 50
        ) {
            metrologyReasons.push(`Talud anómalo (${slopeAngleAvgDeg}° > 50°).`);
        }
        if (metrologyReasons.length > 0) {
            metrologyGrade = 'LOW_CONFIDENCE_RECAPTURE';
        }
    }

    return {
        volumeM3,
        heightM,
        footprintAreaM2,
        baseLengthM,
        baseWidthM,
        slopeAngleLeftDeg,
        slopeAngleRightDeg,
        slopeAngleAvgDeg,
        slopeProfile,
        slopeWarning,
        groundSlopeDeg: groundPlane.groundSlopeDeg,
        planeMismatchDeg: groundPlane.planeMismatchDeg,
        toeScore: groundPlane.toeScore,
        zeroCellsInside,
        occludedVolumePct,
        loopDriftPct,
        uncertaintyPct,
        confidence,
        metrologyGrade,
        metrologyReasons,
        dimensionsM: {
            a: baseLengthM,
            b: baseWidthM,
            h: heightM,
        },
        groundPlane,
        surfaceGrid: {
            originX: Number(originX.toFixed(4)),
            originZ: Number(originZ.toFixed(4)),
            cellSizeM,
            nx,
            nz,
            heightsM,
            observationCount,
            interpolatedMask,
            slopeDegGrid,
            groundPlane: {
                a: groundPlane.a,
                b: groundPlane.b,
                d: groundPlane.d,
            },
        },
    };
}
