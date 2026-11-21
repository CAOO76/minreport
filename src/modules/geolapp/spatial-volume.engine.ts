/**
 * Motor Volumétrico Espacial Real (Toe Solver RANSAC + Grilla Métrica + Incertidumbre Calibrada)
 * Sistema de coordenadas ARCore: `y` vertical arriba, `(x, z)` plano horizontal en metros.
 * Ejecución determinista 100% en `southamerica-west1` sin aleatoriedad no reproducible.
 */

export type SpatialPoint3D = [number, number, number];

export interface InclinedGroundPlaneResult {
    a: number;
    b: number;
    d: number;
    residualRmsM: number;
    groundSlopeDeg: number;
    toeScore: number;
}

export interface SpatialSurfaceGrid {
    originX: number;
    originZ: number;
    cellSizeM: number;
    nx: number;
    nz: number;
    heightsM: number[];
    groundPlane: {
        a: number;
        b: number;
        d: number;
    };
}

export interface SpatialVolumeInput {
    pointsM: ReadonlyArray<SpatialPoint3D>;
    groundSamplesM?: ReadonlyArray<SpatialPoint3D>;
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
    depthMode?: 'RAW_DEPTH_ONLY' | 'AUTOMATIC' | 'VIO_POINTCLOUD' | string;
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
    slopeWarning: string | null;
    groundSlopeDeg: number;
    toeScore: number;
    uncertaintyPct: number;
    confidence: number;
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
const RANSAC_INLIER_TOL_M = 0.06;
const RANSAC_ITERATIONS = 120;
const RADIAL_SECTORS = 16;

function round2(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function round1(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10) / 10;
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

    // Normal del plano (nx, ny, nz) = u x v; ny*y + nx*x + nz*z = const
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

function selectGroundCandidates(
    points: ReadonlyArray<SpatialPoint3D>,
    groundSamples: ReadonlyArray<SpatialPoint3D>,
    cx: number,
    cz: number
): SpatialPoint3D[] {
    const candidates: SpatialPoint3D[] = [];

    if (groundSamples.length > 0) {
        const stride = Math.max(1, Math.floor(groundSamples.length / 240));
        for (let i = 0; i < groundSamples.length; i += stride) {
            candidates.push(groundSamples[i]);
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

    const sortedRadii = withRadius.map((p) => p.r).sort((a, b) => a - b);
    const r98 = percentile(sortedRadii, 0.98);
    const outerThreshold = r98 * 0.85;

    // 1. Anillo externo (15% exterior radial): incluir banda más externa y bajas locales
    const outerBand = withRadius.filter((p) => p.r >= outerThreshold);
    const sectorBuckets: Array<Array<{ pt: SpatialPoint3D; r: number }>> = Array.from(
        { length: RADIAL_SECTORS },
        () => []
    );

    for (const item of withRadius) {
        sectorBuckets[item.sector].push({ pt: item.pt, r: item.r });
    }

    for (const bucket of sectorBuckets) {
        if (bucket.length === 0) continue;
        const rSectorMax = Math.max(...bucket.map((b) => b.r));
        // Preferir puntos del borde más externo (r >= 94% o mayores radios) ordenados por y ascendente
        const byRadiusDesc = [...bucket].sort((a, b) => b.r - a.r || a.pt[1] - b.pt[1]);
        const outerSlice = bucket
            .filter((b) => b.r >= rSectorMax * 0.94)
            .sort((a, b) => a.pt[1] - b.pt[1]);
        const lowerHalfSlice = bucket
            .filter((b) => b.r >= rSectorMax * 0.72)
            .sort((a, b) => a.pt[1] - b.pt[1]);
        const lowTake = Math.max(1, Math.min(2, Math.ceil(lowerHalfSlice.length * 0.1)));

        for (const item of byRadiusDesc.slice(0, 2)) {
            candidates.push(item.pt);
        }
        for (const item of outerSlice.slice(0, 2)) {
            candidates.push(item.pt);
        }
        for (let i = 0; i < lowTake; i++) {
            candidates.push(lowerHalfSlice[i].pt);
        }
    }

    // Incluir puntos del anillo exterior (si hay pocos por sector) filtrados hacia abajo por cuadrante
    if (candidates.length < 24 && outerBand.length > 0) {
        const stride = Math.max(1, Math.floor(outerBand.length / 48));
        for (let i = 0; i < outerBand.length; i += stride) {
            candidates.push(outerBand[i].pt);
        }
    }

    return candidates;
}

/**
 * Toe Solver RANSAC determinista (`120` iteraciones): ajusta plano de cancha `y = a*x + b*z + d`
 * con tolerancia `0.06 m` y pendiente máxima admisible `<= 15°`.
 */
export function fitInclinedGroundPlane(
    pointsM: ReadonlyArray<SpatialPoint3D>,
    groundSamplesM?: ReadonlyArray<SpatialPoint3D>,
    anchorCenter?: { x: number; y: number; z: number } | null
): InclinedGroundPlaneResult {
    const points = sanitizePoints(pointsM);
    const groundSamples = sanitizePoints(groundSamplesM);

    const refPoints = points.length > 0 ? points : groundSamples;
    if (refPoints.length === 0) {
        return {
            a: 0,
            b: 0,
            d: anchorCenter && Number.isFinite(anchorCenter.y) ? anchorCenter.y : 0,
            residualRmsM: 0,
            groundSlopeDeg: 0,
            toeScore: 0,
        };
    }

    const cx =
        points.length > 0
            ? median(points.map((p) => p[0]))
            : anchorCenter && Number.isFinite(anchorCenter.x)
              ? anchorCenter.x
              : median(refPoints.map((p) => p[0]));
    const cz =
        points.length > 0
            ? median(points.map((p) => p[2]))
            : anchorCenter && Number.isFinite(anchorCenter.z)
              ? anchorCenter.z
              : median(refPoints.map((p) => p[2]));

    const candidates = selectGroundCandidates(points, groundSamples, cx, cz);

    const horizontalFallback = (): InclinedGroundPlaneResult => {
        const sortedY = refPoints.map((p) => p[1]).sort((a, b) => a - b);
        const d = percentile(sortedY, 0.05);
        const residuals = candidates.map((p) => p[1] - d);
        const rms =
            residuals.length > 0
                ? Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / residuals.length)
                : 0;
        const toeScore = computeToeCoverageScore(points, groundSamples, 0, 0, d, cx, cz, rms);
        return {
            a: 0,
            b: 0,
            d: Number(d.toFixed(5)),
            residualRmsM: Number(rms.toFixed(4)),
            groundSlopeDeg: 0,
            toeScore,
        };
    };

    if (candidates.length < 6) {
        return horizontalFallback();
    }

    // Muestra representativa de la nube para verificar soporte inferior (evita planos flotantes sobre el talud)
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

        // Penalizar planos que dejan puntos del acopio por debajo del supuesto suelo
        const belowLimit = groundSamples.length >= 6 ? -RANSAC_INLIER_TOL_M * 1.2 : -0.025;
        let belowCount = 0;
        for (const pt of supportSample) {
            const h = pt[1] - (plane.a * pt[0] + plane.b * pt[2] + plane.d);
            if (h < belowLimit) {
                belowCount += 1;
            }
        }
        const belowRatio = supportSample.length > 0 ? belowCount / supportSample.length : 0;
        const rmsInliers = Math.sqrt(errorSumSq / inliers.length);
        const belowPenaltyWeight = groundSamples.length >= 6 ? 1.5 : 2.5;
        const score = inliers.length - belowRatio * nCand * belowPenaltyWeight - rmsInliers * 8;

        if (score > bestScore) {
            bestScore = score;
            bestInliers = inliers;
            bestPlane = plane;
        }
    }

    if (!bestPlane || bestInliers.length < 3) {
        return horizontalFallback();
    }

    const refined = fitPlaneOls(bestInliers) ?? bestPlane;
    const refinedSlopeTan = Math.hypot(refined.a, refined.b);
    let finalPlane = refinedSlopeTan <= MAX_GROUND_TAN ? refined : bestPlane;

    // Sin muestras dedicadas de suelo, el borde de la pila tiene sesgo positivo (h >= 0);
    // anclar el intercepto d al percentil inferior de los inliers evita truncar la base.
    if (groundSamples.length < 6 && bestInliers.length >= 6) {
        const inlierOffsets = bestInliers
            .map((pt) => pt[1] - (finalPlane.a * pt[0] + finalPlane.b * pt[2]))
            .sort((a, b) => a - b);
        finalPlane = {
            ...finalPlane,
            d: percentile(inlierOffsets, 0.15),
        };
    }

    // Recalcular inliers finales y RMS
    const finalResiduals: number[] = [];
    for (const pt of candidates) {
        const err = pt[1] - (finalPlane.a * pt[0] + finalPlane.b * pt[2] + finalPlane.d);
        if (Math.abs(err) <= RANSAC_INLIER_TOL_M) {
            finalResiduals.push(err);
        }
    }
    const rms =
        finalResiduals.length > 0
            ? Math.sqrt(finalResiduals.reduce((acc, r) => acc + r * r, 0) / finalResiduals.length)
            : RANSAC_INLIER_TOL_M;

    const slopeDeg = (Math.atan(Math.hypot(finalPlane.a, finalPlane.b)) * 180) / Math.PI;
    const toeScore = computeToeCoverageScore(
        points,
        groundSamples,
        finalPlane.a,
        finalPlane.b,
        finalPlane.d,
        cx,
        cz,
        rms
    );

    return {
        a: Number(finalPlane.a.toFixed(6)),
        b: Number(finalPlane.b.toFixed(6)),
        d: Number(finalPlane.d.toFixed(5)),
        residualRmsM: Number(rms.toFixed(4)),
        groundSlopeDeg: round2(slopeDeg),
        toeScore,
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
    residualRmsM: number
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

    const sectorRatio = coveredSectors.size / RADIAL_SECTORS;
    const fitFactor = clamp(1 - residualRmsM / 0.15, 0.55, 1.0);
    return Math.round(clamp(sectorRatio * 100 * fitFactor, 0, 100));
}

function selectPrimaryClusterMask(
    observed: Uint8Array,
    heightsM: number[],
    nx: number,
    nz: number,
    originX: number,
    originZ: number,
    cellSizeM: number,
    targetCx: number,
    targetCz: number
): Uint8Array {
    const total = nx * nz;
    const inCluster = new Uint8Array(total);
    const visited = new Uint8Array(total);

    interface ClusterCandidate {
        cells: number[];
        minDistSq: number;
        centroidDistSq: number;
    }

    const clusters: ClusterCandidate[] = [];
    const queue: number[] = [];

    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const startIdx = iz * nx + ix;
            if (visited[startIdx] || !observed[startIdx] || heightsM[startIdx] <= 0.02) {
                continue;
            }

            visited[startIdx] = 1;
            queue.length = 0;
            queue.push(startIdx);
            const cells: number[] = [];
            let minDistSq = Infinity;
            let sumX = 0;
            let sumZ = 0;

            let head = 0;
            while (head < queue.length) {
                const curr = queue[head++];
                cells.push(curr);
                const cxCell = curr % nx;
                const czCell = Math.floor(curr / nx);
                const wx = originX + cxCell * cellSizeM;
                const wz = originZ + czCell * cellSizeM;
                sumX += wx;
                sumZ += wz;
                const dSq = (wx - targetCx) ** 2 + (wz - targetCz) ** 2;
                if (dSq < minDistSq) minDistSq = dSq;

                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nxCell = cxCell + dx;
                        const nzCell = czCell + dz;
                        if (nxCell <= 0 || nxCell >= nx - 1 || nzCell <= 0 || nzCell >= nz - 1) {
                            continue;
                        }
                        const nIdx = nzCell * nx + nxCell;
                        if (visited[nIdx] || !observed[nIdx] || heightsM[nIdx] <= 0.02) {
                            continue;
                        }
                        visited[nIdx] = 1;
                        queue.push(nIdx);
                    }
                }
            }

            const meanX = sumX / cells.length;
            const meanZ = sumZ / cells.length;
            const centroidDistSq = (meanX - targetCx) ** 2 + (meanZ - targetCz) ** 2;
            clusters.push({ cells, minDistSq, centroidDistSq });
        }
    }

    if (clusters.length === 0) {
        return inCluster;
    }

    const nearbyMulti = clusters.filter(
        (c) => c.cells.length >= 2 && Math.sqrt(c.minDistSq) <= Math.max(0.2, cellSizeM * 4)
    );
    const pool = nearbyMulti.length > 0 ? nearbyMulti : clusters;
    const distTieTolSq = (cellSizeM * 1.5) ** 2;

    pool.sort((a, b) => {
        if (Math.abs(a.minDistSq - b.minDistSq) > distTieTolSq) {
            return a.minDistSq - b.minDistSq;
        }
        if (Math.abs(a.centroidDistSq - b.centroidDistSq) > distTieTolSq) {
            return a.centroidDistSq - b.centroidDistSq;
        }
        return b.cells.length - a.cells.length;
    });

    for (const idx of pool[0].cells) {
        inCluster[idx] = 1;
    }
    return inCluster;
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
 * Calcula volumen métrico real desde nube 3D ARCore VIO/Depth:
 * Calibración -> Recorte ROI -> Toe Solver RANSAC -> Grilla adaptativa (0.04m o 0.08..0.25m) ->
 * Mediana p50 por celda -> Clustering 8-conectado -> Micro-huecos (>= 5 vecinos) ->
 * Compuertas físicas (OBJECT_TOO_SMALL / INSUFFICIENT_COVERAGE) -> Incertidumbre ±Δ%.
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

    const effectiveRoiRadiusM =
        typeof input.roiRadiusM === 'number' &&
        Number.isFinite(input.roiRadiusM) &&
        input.roiRadiusM > 0
            ? input.roiRadiusM * scaleFactor
            : undefined;

    const roiCenterX = scaledAnchorCenter
        ? scaledAnchorCenter.x
        : median(scaledPoints.map((p) => p[0]));
    const roiCenterZ = scaledAnchorCenter
        ? scaledAnchorCenter.z
        : median(scaledPoints.map((p) => p[2]));

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

    const groundPlane = fitInclinedGroundPlane(points, groundSamples, scaledAnchorCenter);

    const relativePoints: Array<{ x: number; z: number; h: number }> = [];
    for (const [x, y, z] of points) {
        const h = y - (groundPlane.a * x + groundPlane.b * z + groundPlane.d);
        // Descartar outliers negativos extremos (< -0.25m) o puntos flotantes irreales (> 60m)
        if (h < -0.25 || h > 60) continue;
        relativePoints.push({ x, z, h });
    }

    if (relativePoints.length < 10) {
        throw new SpatialVolumeValidationError(
            'Los puntos capturados no definen un acopio valido sobre el plano base.',
            'INVALID_POINT_CLOUD'
        );
    }

    const pilePoints = relativePoints.filter((p) => p.h > 0.015);
    const boundSource = pilePoints.length >= 6 ? pilePoints : relativePoints;

    const xs = boundSource.map((p) => p.x).sort((a, b) => a - b);
    const zs = boundSource.map((p) => p.z).sort((a, b) => a - b);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const minZ = zs[0];
    const maxZ = zs[zs.length - 1];

    const spanX = Math.max(0.04, maxX - minX);
    const spanZ = Math.max(0.04, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanZ);

    // Grilla métrica nx × nz <= 64 × 64: 0.04m para objetos/ROI <= 2.5m; 0.08..0.25m en acopios grandes
    const minCellForLimit = maxSpan / 60;
    const isSmallOrCompact =
        (effectiveRoiRadiusM !== undefined && effectiveRoiRadiusM <= 2.5) || maxSpan < 2.5;
    let cellSizeM: number;
    if (isSmallOrCompact) {
        cellSizeM = Number(Math.max(0.04, minCellForLimit).toFixed(4));
    } else {
        const densityCellSize = Math.sqrt((spanX * spanZ) / Math.max(40, pilePoints.length * 0.95));
        cellSizeM = Number(
            Math.max(clamp(Math.max(maxSpan / 48, densityCellSize), 0.08, 0.25), minCellForLimit).toFixed(4)
        );
    }

    const nx = Math.min(64, Math.max(8, Math.ceil(spanX / cellSizeM) + 2));
    const nz = Math.min(64, Math.max(8, Math.ceil(spanZ / cellSizeM) + 2));
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const originX = centerX - ((nx - 1) * cellSizeM) * 0.5;
    const originZ = centerZ - ((nz - 1) * cellSizeM) * 0.5;

    const totalCells = nx * nz;
    const cellBuckets: number[][] = Array.from({ length: totalCells }, () => []);

    for (const pt of relativePoints) {
        const ix = Math.round((pt.x - originX) / cellSizeM);
        const iz = Math.round((pt.z - originZ) / cellSizeM);
        if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
        cellBuckets[iz * nx + ix].push(Math.max(0, pt.h));
    }

    const observed = new Uint8Array(totalCells);
    const heightsM = new Array<number>(totalCells).fill(0);

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            const bucket = cellBuckets[idx];
            if (bucket.length === 0) continue;

            observed[idx] = 1;
            const sorted = [...bucket].sort((a, b) => a - b);
            const repHeight = percentile(sorted, 0.5);
            // Borde exterior de grilla siempre en 0 para cerrar malla watertight
            const isGridBorder = ix === 0 || ix === nx - 1 || iz === 0 || iz === nz - 1;
            heightsM[idx] = isGridBorder ? 0 : Number(repHeight.toFixed(4));
        }
    }

    // Clustering 8-conectado: conservar únicamente el componente conectado principal más cercano a anchorCenter
    const targetClusterCx = scaledAnchorCenter ? scaledAnchorCenter.x : centerX;
    const targetClusterCz = scaledAnchorCenter ? scaledAnchorCenter.z : centerZ;
    const primaryCluster = selectPrimaryClusterMask(
        observed,
        heightsM,
        nx,
        nz,
        originX,
        originZ,
        cellSizeM,
        targetClusterCx,
        targetClusterCz
    );

    for (let idx = 0; idx < totalCells; idx++) {
        if (!primaryCluster[idx]) {
            heightsM[idx] = 0;
        }
    }

    // Interpolar únicamente micro-huecos rodeados por >= 5 vecinos observados del mismo clúster conectado
    const microHoleMask = new Uint8Array(totalCells);
    for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
            const idx = iz * nx + ix;
            if (primaryCluster[idx]) continue;

            let clusterNeighbors = 0;
            let sum = 0;
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0) continue;
                    const jIdx = (iz + dz) * nx + (ix + dx);
                    if (primaryCluster[jIdx]) {
                        clusterNeighbors += 1;
                        sum += heightsM[jIdx];
                    }
                }
            }
            if (clusterNeighbors >= 5) {
                microHoleMask[idx] = 1;
                heightsM[idx] = clusterNeighbors > 0 ? sum / clusterNeighbors : 0.0;
            }
        }
    }

    for (let step = 0; step < 24; step++) {
        for (let iz = 1; iz < nz - 1; iz++) {
            for (let ix = 1; ix < nx - 1; ix++) {
                const idx = iz * nx + ix;
                if (!microHoleMask[idx]) continue;
                const avg =
                    0.25 *
                    (heightsM[idx - 1] +
                        heightsM[idx + 1] +
                        heightsM[idx - nx] +
                        heightsM[idx + nx]);
                heightsM[idx] = Number(avg.toFixed(4));
            }
        }
    }

    // Integral volumétrica discreta + altura máxima + huella activa
    const cellArea = cellSizeM * cellSizeM;
    let rawVolume = 0;
    let maxH = 0;
    const activeFootprintCells: Array<{ x: number; z: number }> = [];

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const h = heightsM[iz * nx + ix];
            if (h > 0) {
                rawVolume += h * cellArea;
                if (h > maxH) maxH = h;
            }
            if (h > 0.02) {
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

    const volumeM3 = round2(rawVolume);
    const heightM = round2(maxH);
    const footprintAreaM2 = round2(activeFootprintCells.length * cellArea);

    const { baseLengthM, baseWidthM, axisV } = computePrincipalFootprintAxes(
        activeFootprintCells,
        cellSizeM
    );

    // Talud honesto: únicamente si maxH >= 0.50 m
    const flankAnglesAll: number[] = [];
    const flankAnglesLeft: number[] = [];
    const flankAnglesRight: number[] = [];

    if (maxH >= 0.5) {
        const minFlankH = 0.15 * maxH;
        const maxFlankH = 0.85 * maxH;

        for (let iz = 1; iz < nz - 1; iz++) {
            for (let ix = 1; ix < nx - 1; ix++) {
                const idx = iz * nx + ix;
                const h = heightsM[idx];
                if (h <= minFlankH || h >= maxFlankH) continue;

                const dhdx = (heightsM[idx + 1] - heightsM[idx - 1]) / (2 * cellSizeM);
                const dhdz = (heightsM[idx + nx] - heightsM[idx - nx]) / (2 * cellSizeM);
                const gradMag = Math.hypot(dhdx, dhdz);
                if (gradMag < 0.08) continue;

                const angleDeg = (Math.atan(gradMag) * 180) / Math.PI;
                if (angleDeg > 82) continue;

                flankAnglesAll.push(angleDeg);
                const wx = originX + ix * cellSizeM - centerX;
                const wz = originZ + iz * cellSizeM - centerZ;
                const sideProj = wx * axisV[0] + wz * axisV[1];
                if (sideProj < 0) flankAnglesLeft.push(angleDeg);
                else flankAnglesRight.push(angleDeg);
            }
        }
    }

    const slopeAngleAvgDeg =
        maxH >= 0.5 && flankAnglesAll.length > 0 ? round1(median(flankAnglesAll)) : null;
    const slopeAngleLeftDeg =
        maxH >= 0.5
            ? flankAnglesLeft.length > 0
                ? round1(median(flankAnglesLeft))
                : slopeAngleAvgDeg
            : null;
    const slopeAngleRightDeg =
        maxH >= 0.5
            ? flankAnglesRight.length > 0
                ? round1(median(flankAnglesRight))
                : slopeAngleAvgDeg
            : null;

    let slopeWarning: string | null = null;
    if (maxH >= 0.5 && slopeAngleAvgDeg !== null && slopeAngleAvgDeg > 48) {
        slopeWarning = `Talud medido ${slopeAngleAvgDeg}° supera ángulo límite físico natural (~45°–48°).`;
    } else if (maxH >= 0.5 && slopeAngleAvgDeg !== null && slopeAngleAvgDeg > 38) {
        slopeWarning = `Talud medido ${slopeAngleAvgDeg}° supera referencia de 38°. Verificar estabilidad operativa.`;
    }

    const effectiveCoveragePct = clamp(
        declaredCoveragePct !== null ? declaredCoveragePct : groundPlane.toeScore,
        0,
        100
    );

    // Incertidumbre honesta y calibrada ±Δ% acotada en [1.8%, 35.0%]
    let uncertaintyRaw = 2.5 + (100 - effectiveCoveragePct) * 0.18;
    if (groundPlane.toeScore < 75) {
        uncertaintyRaw += (75 - groundPlane.toeScore) * 0.12;
    }
    if (String(input.depthMode || '').toUpperCase() === 'VIO_POINTCLOUD') {
        uncertaintyRaw += 3.5;
    } else if (String(input.depthMode || '').toUpperCase() === 'AUTOMATIC') {
        uncertaintyRaw += 0.5;
    }
    if (input.loopClosed === false) {
        uncertaintyRaw += 1.5;
    }
    if (points.length < 150) {
        uncertaintyRaw += 2.0;
    }
    const uncertaintyPct = round1(clamp(uncertaintyRaw, 1.8, 35.0));
    const confidence = round2(clamp(1 - uncertaintyPct / 45, 0.25, 0.99));

    return {
        volumeM3,
        heightM,
        footprintAreaM2,
        baseLengthM,
        baseWidthM,
        slopeAngleLeftDeg,
        slopeAngleRightDeg,
        slopeAngleAvgDeg,
        slopeWarning,
        groundSlopeDeg: groundPlane.groundSlopeDeg,
        toeScore: groundPlane.toeScore,
        uncertaintyPct,
        confidence,
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
            groundPlane: {
                a: groundPlane.a,
                b: groundPlane.b,
                d: groundPlane.d,
            },
        },
    };
}
