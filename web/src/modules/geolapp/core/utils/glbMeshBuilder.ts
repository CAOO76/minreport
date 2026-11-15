/**
 * glbMeshBuilder — Generador Determinista de Mallas 3D glTF 2.0 (.glb) en Navegador
 *
 * Estándar GEOLAPP® / MINREPORT:
 *  - Puro navegador (`ArrayBuffer`, `DataView`, `Uint8Array`, `Float32Array`, `Uint16Array`).
 *  - Generación 100% determinista sin APIs binarias de servidor ni aleatoriedad no determinista.
 *  - Soporta las 5 geometrías operacionales de GEOLAPP® con cotas declaradas reales.
 *  - Tolerancia cero a dimensiones inventadas: retorna `null` si faltan cotas o son <= 0.
 *  - Calcula métricas TIN reales sobre la malla cerrada (`tinVolumeM3` por suma tetraédrica firmada,
 *    `surfaceAreaM2`, `vertexCount`, `triangleCount`, `boundingBoxM`, `rawUnindexedBytes`, `optimizedGlbBytes`).
 */

import type { GeolappGeometryType } from '../types/GeolappTypes';

export type GlbGeometryKind =
    | GeolappGeometryType
    | 'TRONCO_CONO_ELIPTICO'
    | 'TRONCO_PIRAMIDAL'
    | 'elliptic-cone'
    | 'truncated-elliptic-cone'
    | 'perimeter-cone'
    | 'windrow'
    | 'toe-wall'
    | string;

export interface GlbBoundingBoxM {
    widthX: number;
    heightY: number;
    depthZ: number;
}

export interface BuildStockpileGlbInput {
    geometryType: GlbGeometryKind;
    dimensions: Record<string, number | undefined | null>;
    profileSamples?: number[];
    name?: string;
}

export interface GlbMeshBuildResult {
    glbBuffer: ArrayBuffer;
    tinVolumeM3: number;
    surfaceAreaM2: number;
    vertexCount: number;
    triangleCount: number;
    boundingBoxM: GlbBoundingBoxM;
    rawUnindexedBytes: number;
    optimizedGlbBytes: number;
    geometryType: string;
}

export interface Point3DInput {
    x: number;
    y: number;
    z: number;
}

interface RawSurfaceMesh {
    positions: number[];
    indices: number[];
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const MAX_UINT16_VERTICES = 65535;

/** Color Cobre Industrial #C68346 convertido a espacio lineal glTF 2.0 */
const COPPER_LINEAR_RGBA: [number, number, number, number] = [0.56471, 0.22697, 0.06125, 1.0];

function align4(n: number): number {
    return (n + 3) & ~3;
}

function clamp(val: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, val));
}

function roundTo(val: number, decimals: number): number {
    if (!Number.isFinite(val)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
}

function readPosDim(
    dims: Record<string, number | undefined | null>,
    keys: string[]
): number | null {
    for (const key of keys) {
        const val = dims[key];
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
            return val;
        }
    }
    return null;
}

function readNonNegDim(
    dims: Record<string, number | undefined | null>,
    keys: string[]
): number | null {
    for (const key of keys) {
        const val = dims[key];
        if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
            return val;
        }
    }
    return null;
}

function readOptionalNonNegDim(
    dims: Record<string, number | undefined | null>,
    keys: string[]
): number | undefined | 'INVALID' {
    let sawDefined = false;
    for (const key of keys) {
        if (!(key in dims)) continue;
        const val = dims[key];
        if (val === undefined || val === null) continue;
        sawDefined = true;
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
            return 'INVALID';
        }
        return val;
    }
    return sawDefined ? 'INVALID' : undefined;
}

function readOptionalWallAngleDeg(
    dims: Record<string, number | undefined | null>,
    keys: string[]
): number | 'INVALID' {
    for (const key of keys) {
        if (!(key in dims)) continue;
        const val = dims[key];
        if (val === undefined || val === null) continue;
        if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 90) {
            return 'INVALID';
        }
        return val;
    }
    return 90;
}

function normalizeProfileMultipliers(samples?: number[]): number[] | null {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    const valid = samples.filter((s) => typeof s === 'number' && Number.isFinite(s));
    if (valid.length === 0) return null;

    let minVal = Infinity;
    let maxVal = -Infinity;
    let sum = 0;
    for (const v of valid) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
        sum += v;
    }

    if (minVal >= 0.5 && maxVal <= 1.5) {
        return valid.map((v) => clamp(v, 0.75, 1.25));
    }

    if (minVal < 0.5 && maxVal <= 0.5) {
        return valid.map((v) => clamp(1 + v, 0.75, 1.25));
    }

    const mean = sum / valid.length;
    if (mean <= 0) return null;
    return valid.map((v) => clamp(v / mean, 0.75, 1.25));
}

function sampleProfilePeriodic(multipliers: number[] | null, t01: number): number {
    if (!multipliers || multipliers.length === 0) return 1;
    if (multipliers.length === 1) return multipliers[0];
    const wrapped = ((t01 % 1) + 1) % 1;
    const scaled = wrapped * multipliers.length;
    const i0 = Math.floor(scaled) % multipliers.length;
    const i1 = (i0 + 1) % multipliers.length;
    const frac = scaled - Math.floor(scaled);
    return multipliers[i0] * (1 - frac) + multipliers[i1] * frac;
}

function sampleProfileLinear(multipliers: number[] | null, t01: number): number {
    if (!multipliers || multipliers.length === 0) return 1;
    if (multipliers.length === 1) return multipliers[0];
    const clamped = clamp(t01, 0, 1);
    const scaled = clamped * (multipliers.length - 1);
    const i0 = Math.floor(scaled);
    const i1 = Math.min(multipliers.length - 1, i0 + 1);
    const frac = scaled - i0;
    return multipliers[i0] * (1 - frac) + multipliers[i1] * frac;
}

function pushVertex(positions: number[], x: number, y: number, z: number): number {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    return idx;
}

/**
 * Construye cono elíptico o tronco de cono elíptico cerrado y watertight (CCW exterior).
 */
function buildEllipticConeOrFrustum(
    rxBase: number,
    rzBase: number,
    rxTop: number,
    rzTop: number,
    heightM: number,
    multipliers: number[] | null
): RawSurfaceMesh {
    const radialSegments = 48;
    const heightRings = 8;
    const positions: number[] = [];
    const indices: number[] = [];
    const isPointed = rxTop <= 0 && rzTop <= 0;

    // 1. Manto lateral (con costura cerrada al final compartiendo vértice i=0)
    const sideStart = positions.length / 3;
    const sideRingCount = isPointed ? heightRings : heightRings + 1;

    for (let k = 0; k < sideRingCount; k++) {
        const v = k / heightRings;
        const y = v * heightM;
        const baseRx = rxBase * (1 - v) + rxTop * v;
        const baseRz = rzBase * (1 - v) + rzTop * v;
        const envelope = Math.sin(v * Math.PI);

        for (let i = 0; i < radialSegments; i++) {
            const u = i / radialSegments;
            const theta = u * Math.PI * 2;
            const mod =
                k === 0 || k === heightRings
                    ? 1
                    : 1 + (sampleProfilePeriodic(multipliers, u) - 1) * envelope;
            const rx = baseRx * mod;
            const rz = baseRz * mod;
            pushVertex(positions, rx * Math.cos(theta), y, rz * Math.sin(theta));
        }
    }

    for (let k = 0; k < sideRingCount - 1; k++) {
        for (let i = 0; i < radialSegments; i++) {
            const nextI = (i + 1) % radialSegments;
            const a = sideStart + k * radialSegments + i;
            const b = sideStart + k * radialSegments + nextI;
            const c = sideStart + (k + 1) * radialSegments + i;
            const d = sideStart + (k + 1) * radialSegments + nextI;
            // CCW exterior con x=cos(theta), z=sin(theta)
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }

    if (isPointed) {
        const topRing = sideStart + (sideRingCount - 1) * radialSegments;
        const apexIdx = pushVertex(positions, 0, heightM, 0);
        for (let i = 0; i < radialSegments; i++) {
            const nextI = (i + 1) % radialSegments;
            indices.push(topRing + i, apexIdx, topRing + nextI);
        }
    } else {
        // Tapa superior separada para arista nítida
        const topCenter = pushVertex(positions, 0, heightM, 0);
        const topRingStart = positions.length / 3;
        for (let i = 0; i < radialSegments; i++) {
            const theta = (i / radialSegments) * Math.PI * 2;
            pushVertex(positions, rxTop * Math.cos(theta), heightM, rzTop * Math.sin(theta));
        }
        for (let i = 0; i < radialSegments; i++) {
            const nextI = (i + 1) % radialSegments;
            indices.push(topCenter, topRingStart + nextI, topRingStart + i);
        }
    }

    // 2. Tapa basal cerrada (y = 0, normal -Y)
    const botCenter = pushVertex(positions, 0, 0, 0);
    const botRingStart = positions.length / 3;
    for (let i = 0; i < radialSegments; i++) {
        const theta = (i / radialSegments) * Math.PI * 2;
        pushVertex(positions, rxBase * Math.cos(theta), 0, rzBase * Math.sin(theta));
    }
    for (let i = 0; i < radialSegments; i++) {
        const nextI = (i + 1) % radialSegments;
        indices.push(botCenter, botRingStart + i, botRingStart + nextI);
    }

    return { positions, indices };
}

/**
 * Construye tronco piramidal o windrow longitudinal prismoidal cerrado (CCW exterior).
 */
function buildPrismoidalFrustumMesh(
    baseL: number,
    baseW: number,
    topL: number,
    topW: number,
    heightM: number,
    multipliers: number[] | null
): RawSurfaceMesh {
    const segU = 12;
    const segV = 6;
    const positions: number[] = [];
    const indices: number[] = [];

    const hbL = baseL / 2;
    const hbW = baseW / 2;
    const htL = topL / 2;
    const htW = topW / 2;

    const addSubdividedQuadFace = (
        b0: [number, number, number],
        b1: [number, number, number],
        t0: [number, number, number],
        t1: [number, number, number],
        perimStart: number,
        perimSpan: number,
        collapseTopToSingleVertex: boolean
    ) => {
        const startIdx = positions.length / 3;
        const rows = collapseTopToSingleVertex ? segV : segV + 1;

        for (let j = 0; j < rows; j++) {
            const v = j / segV;
            const envelope = Math.sin(v * Math.PI);
            for (let i = 0; i <= segU; i++) {
                const u = i / segU;
                const bx = b0[0] * (1 - u) + b1[0] * u;
                const bz = b0[2] * (1 - u) + b1[2] * u;
                const tx = t0[0] * (1 - u) + t1[0] * u;
                const tz = t0[2] * (1 - u) + t1[2] * u;
                const xBase = bx * (1 - v) + tx * v;
                const zBase = bz * (1 - v) + tz * v;
                const y = heightM * v;

                const tPerim = perimStart + u * perimSpan;
                const mod =
                    j === 0 || j === segV
                        ? 1
                        : 1 + (sampleProfilePeriodic(multipliers, tPerim) - 1) * envelope;
                pushVertex(positions, xBase * mod, y, zBase * mod);
            }
        }

        const stride = segU + 1;
        const quadRows = collapseTopToSingleVertex ? segV - 1 : segV;
        for (let j = 0; j < quadRows; j++) {
            for (let i = 0; i < segU; i++) {
                const a = startIdx + j * stride + i;
                const b = startIdx + j * stride + i + 1;
                const c = startIdx + (j + 1) * stride + i;
                const d = startIdx + (j + 1) * stride + i + 1;
                indices.push(a, b, d);
                indices.push(a, d, c);
            }
        }

        if (collapseTopToSingleVertex) {
            const apexIdx = pushVertex(positions, t0[0], heightM, t0[2]);
            const lastRowStart = startIdx + (segV - 1) * stride;
            for (let i = 0; i < segU; i++) {
                indices.push(lastRowStart + i, lastRowStart + i + 1, apexIdx);
            }
        }
    };

    const isPointedApex = htL <= 0 && htW <= 0;
    const isSharpRidgeX = htL > 0 && htW <= 0;

    // 4 caras laterales en recorrido CCW visto desde +Y:
    // Front (+Z): (-X,+Z) -> (+X,+Z)
    addSubdividedQuadFace(
        [-hbL, 0, hbW],
        [hbL, 0, hbW],
        [-htL, heightM, htW],
        [htL, heightM, htW],
        0.0,
        0.25,
        isPointedApex
    );

    // Right (+X): (+X,+Z) -> (+X,-Z)
    addSubdividedQuadFace(
        [hbL, 0, hbW],
        [hbL, 0, -hbW],
        [htL, heightM, htW],
        [htL, heightM, -htW],
        0.25,
        0.25,
        isPointedApex || isSharpRidgeX
    );

    // Back (-Z): (+X,-Z) -> (-X,-Z)
    addSubdividedQuadFace(
        [hbL, 0, -hbW],
        [-hbL, 0, -hbW],
        [htL, heightM, -htW],
        [-htL, heightM, -htW],
        0.5,
        0.25,
        isPointedApex
    );

    // Left (-X): (-X,-Z) -> (-X,+Z)
    addSubdividedQuadFace(
        [-hbL, 0, -hbW],
        [-hbL, 0, hbW],
        [-htL, heightM, -htW],
        [-htL, heightM, htW],
        0.75,
        0.25,
        isPointedApex || isSharpRidgeX
    );

    // Tapa superior plana (solo si cresta tiene ancho > 0 y largo > 0)
    if (htL > 0 && htW > 0) {
        const t0 = pushVertex(positions, -htL, heightM, htW);
        const t1 = pushVertex(positions, htL, heightM, htW);
        const t2 = pushVertex(positions, htL, heightM, -htW);
        const t3 = pushVertex(positions, -htL, heightM, -htW);
        indices.push(t0, t1, t2);
        indices.push(t0, t2, t3);
    }

    // Tapa basal plana en y = 0 (normal -Y)
    const b0 = pushVertex(positions, -hbL, 0, hbW);
    const b1 = pushVertex(positions, hbL, 0, hbW);
    const b2 = pushVertex(positions, hbL, 0, -hbW);
    const b3 = pushVertex(positions, -hbL, 0, -hbW);
    indices.push(b0, b2, b1);
    indices.push(b0, b3, b2);

    return { positions, indices };
}

/**
 * Construye cuña de acopio contra muro de contención (ACOPIO_CONTRA_MURO) centrada en X y Z.
 */
function buildToeWallMesh(
    lengthM: number,
    widthFromWallM: number,
    heightAtWallM: number,
    wallAngleDeg: number,
    multipliers: number[] | null
): RawSurfaceMesh | null {
    const wallProjectionM =
        wallAngleDeg < 90 ? heightAtWallM / Math.tan((wallAngleDeg * Math.PI) / 180) : 0;
    const effectiveWidth = widthFromWallM - wallProjectionM;
    if (!Number.isFinite(effectiveWidth) || effectiveWidth <= 1e-6) {
        return null;
    }

    const segX = 16;
    const segV = 6;
    const positions: number[] = [];
    const indices: number[] = [];

    const halfL = lengthM / 2;
    const halfW = widthFromWallM / 2;
    const zCrest = -halfW; // pared superior (y = H)
    const zWallFoot = wallProjectionM - halfW; // pie en muro (y = 0)
    const zToe = widthFromWallM - halfW; // pie exterior (y = 0)

    const evalSlopePoint = (u: number, v: number): [number, number, number] => {
        const x = -halfL + u * lengthM;
        const y = v * heightAtWallM;
        const zBase = zToe * (1 - v) + zCrest * v;
        if (v <= 0 || v >= 1 || !multipliers) {
            return [x, y, zBase];
        }
        const envelope = Math.sin(v * Math.PI);
        const mod = 1 + (sampleProfileLinear(multipliers, u) - 1) * envelope;
        const zWallAtV = zWallFoot * (1 - v) + zCrest * v;
        const z = zWallAtV + Math.max(0.05, (zBase - zWallAtV) * mod);
        return [x, y, z];
    };

    // 1. Talud frontal (+Z)
    const slopeStart = positions.length / 3;
    for (let j = 0; j <= segV; j++) {
        const v = j / segV;
        for (let i = 0; i <= segX; i++) {
            const u = i / segX;
            const [x, y, z] = evalSlopePoint(u, v);
            pushVertex(positions, x, y, z);
        }
    }
    const stride = segX + 1;
    for (let j = 0; j < segV; j++) {
        for (let i = 0; i < segX; i++) {
            const a = slopeStart + j * stride + i;
            const b = slopeStart + j * stride + i + 1;
            const c = slopeStart + (j + 1) * stride + i;
            const d = slopeStart + (j + 1) * stride + i + 1;
            indices.push(a, b, d);
            indices.push(a, d, c);
        }
    }

    // 2. Cara contra muro (-Z): u de +halfL a -halfL, v de 0 a 1 -> normal (-Z / hacia muro)
    const wallStart = positions.length / 3;
    for (let j = 0; j <= segV; j++) {
        const v = j / segV;
        const y = v * heightAtWallM;
        const z = zWallFoot * (1 - v) + zCrest * v;
        for (let i = 0; i <= segX; i++) {
            const u = i / segX;
            const x = halfL - u * lengthM;
            pushVertex(positions, x, y, z);
        }
    }
    for (let j = 0; j < segV; j++) {
        for (let i = 0; i < segX; i++) {
            const a = wallStart + j * stride + i;
            const b = wallStart + j * stride + i + 1;
            const c = wallStart + (j + 1) * stride + i;
            const d = wallStart + (j + 1) * stride + i + 1;
            indices.push(a, b, d);
            indices.push(a, d, c);
        }
    }

    // 3. Base en piso y = 0 (normal -Y)
    const b0 = pushVertex(positions, -halfL, 0, zToe);
    const b1 = pushVertex(positions, halfL, 0, zToe);
    const b2 = pushVertex(positions, halfL, 0, zWallFoot);
    const b3 = pushVertex(positions, -halfL, 0, zWallFoot);
    indices.push(b0, b2, b1);
    indices.push(b0, b3, b2);

    // 4. Tapas laterales izquierda (-X) y derecha (+X) manteniendo hermeticidad con talud
    // Tapa derecha (x = +halfL, u = 1): en plano YZ, muro a la izquierda (-Z), talud a la derecha (+Z)
    const rightStart = positions.length / 3;
    for (let j = 0; j <= segV; j++) {
        const v = j / segV;
        const y = v * heightAtWallM;
        const zWall = zWallFoot * (1 - v) + zCrest * v;
        const [, , zSlope] = evalSlopePoint(1, v);
        pushVertex(positions, halfL, y, zWall);
        pushVertex(positions, halfL, y, zSlope);
    }
    for (let j = 0; j < segV; j++) {
        const w0 = rightStart + j * 2;
        const s0 = rightStart + j * 2 + 1;
        const w1 = rightStart + (j + 1) * 2;
        const s1 = rightStart + (j + 1) * 2 + 1;
        if (j < segV - 1) {
            // Normal +X: vector (s0 - w0) = +Z, vector (w1 - w0) = +Y -> (s0-w0) x (w1-w0) = (+Z) x (+Y) = -X -> invertir!
            // (w1 - w0) x (s0 - w0) = (+Y) x (+Z) = +X
            indices.push(w0, w1, s0);
            indices.push(s0, w1, s1);
        } else {
            // En j = segV - 1, w1 y s1 convergen en la cresta zCrest
            indices.push(w0, w1, s0);
        }
    }

    // Tapa izquierda (x = -halfL, u = 0): normal -X
    const leftStart = positions.length / 3;
    for (let j = 0; j <= segV; j++) {
        const v = j / segV;
        const y = v * heightAtWallM;
        const zWall = zWallFoot * (1 - v) + zCrest * v;
        const [, , zSlope] = evalSlopePoint(0, v);
        pushVertex(positions, -halfL, y, zWall);
        pushVertex(positions, -halfL, y, zSlope);
    }
    for (let j = 0; j < segV; j++) {
        const w0 = leftStart + j * 2;
        const s0 = leftStart + j * 2 + 1;
        const w1 = leftStart + (j + 1) * 2;
        const s1 = leftStart + (j + 1) * 2 + 1;
        if (j < segV - 1) {
            // Normal -X: (s0 - w0) x (w1 - w0) = (+Z) x (+Y) = -X
            indices.push(w0, s0, w1);
            indices.push(s0, s1, w1);
        } else {
            indices.push(w0, s0, w1);
        }
    }

    return { positions, indices };
}

function computeMeshMetricsAndNormals(
    positions: number[],
    indices: number[]
): {
    normals: Float32Array;
    tinVolumeM3: number;
    surfaceAreaM2: number;
    boundingBoxM: GlbBoundingBoxM;
    minPos: [number, number, number];
    maxPos: [number, number, number];
} {
    const vertexCount = positions.length / 3;
    const normals = new Float32Array(positions.length);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }

    let signedVolSum6 = 0;
    let totalArea = 0;

    for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t];
        const i1 = indices[t + 1];
        const i2 = indices[t + 2];

        const x0 = positions[i0 * 3];
        const y0 = positions[i0 * 3 + 1];
        const z0 = positions[i0 * 3 + 2];

        const x1 = positions[i1 * 3];
        const y1 = positions[i1 * 3 + 1];
        const z1 = positions[i1 * 3 + 2];

        const x2 = positions[i2 * 3];
        const y2 = positions[i2 * 3 + 1];
        const z2 = positions[i2 * 3 + 2];

        // v1 x v2 para volumen tetraédrico firmado: v0 . (v1 x v2) / 6
        const c12x = y1 * z2 - z1 * y2;
        const c12y = z1 * x2 - x1 * z2;
        const c12z = x1 * y2 - y1 * x2;
        signedVolSum6 += x0 * c12x + y0 * c12y + z0 * c12z;

        // Normal de cara ponderada por 2 * área: (v1 - v0) x (v2 - v0)
        const e1x = x1 - x0;
        const e1y = y1 - y0;
        const e1z = z1 - z0;
        const e2x = x2 - x0;
        const e2y = y2 - y0;
        const e2z = z2 - z0;

        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;

        const doubleArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
        totalArea += 0.5 * doubleArea;

        normals[i0 * 3] += nx;
        normals[i0 * 3 + 1] += ny;
        normals[i0 * 3 + 2] += nz;

        normals[i1 * 3] += nx;
        normals[i1 * 3 + 1] += ny;
        normals[i1 * 3 + 2] += nz;

        normals[i2 * 3] += nx;
        normals[i2 * 3 + 1] += ny;
        normals[i2 * 3 + 2] += nz;
    }

    for (let i = 0; i < vertexCount; i++) {
        const idx = i * 3;
        const nx = normals[idx];
        const ny = normals[idx + 1];
        const nz = normals[idx + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 1e-8) {
            normals[idx] = nx / len;
            normals[idx + 1] = ny / len;
            normals[idx + 2] = nz / len;
        } else {
            normals[idx] = 0;
            normals[idx + 1] = 1;
            normals[idx + 2] = 0;
        }
    }

    return {
        normals,
        tinVolumeM3: roundTo(Math.abs(signedVolSum6) / 6, 3),
        surfaceAreaM2: roundTo(totalArea, 3),
        boundingBoxM: {
            widthX: roundTo(maxX - minX, 3),
            heightY: roundTo(maxY - minY, 3),
            depthZ: roundTo(maxZ - minZ, 3),
        },
        minPos: [minX, minY, minZ],
        maxPos: [maxX, maxY, maxZ],
    };
}

function encodeGlbBinary(
    positions: Float32Array,
    normals: Float32Array,
    indices: Uint16Array,
    minPos: [number, number, number],
    maxPos: [number, number, number],
    meshName: string
): ArrayBuffer {
    const posByteLength = positions.length * 4;
    const normByteLength = normals.length * 4;
    const idxByteLength = indices.length * 2;
    const binRawLength = posByteLength + normByteLength + idxByteLength;
    const binPaddedLength = align4(binRawLength);

    const gltfJson = {
        asset: {
            version: '2.0',
            generator: 'MINREPORT-GEOLAPP-TIN-GLB-1.0',
        },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: meshName }],
        meshes: [
            {
                name: meshName,
                primitives: [
                    {
                        attributes: {
                            POSITION: 0,
                            NORMAL: 1,
                        },
                        indices: 2,
                        material: 0,
                        mode: 4, // TRIANGLES
                    },
                ],
            },
        ],
        materials: [
            {
                name: 'CopperMineralSurface',
                pbrMetallicRoughness: {
                    baseColorFactor: COPPER_LINEAR_RGBA,
                    metallicFactor: 0.14,
                    roughnessFactor: 0.78,
                },
                doubleSided: false,
                extras: {
                    colorHex: '#C68346',
                },
            },
        ],
        buffers: [
            {
                byteLength: binPaddedLength,
            },
        ],
        bufferViews: [
            {
                buffer: 0,
                byteOffset: 0,
                byteLength: posByteLength,
                target: 34962, // ARRAY_BUFFER
            },
            {
                buffer: 0,
                byteOffset: posByteLength,
                byteLength: normByteLength,
                target: 34962, // ARRAY_BUFFER
            },
            {
                buffer: 0,
                byteOffset: posByteLength + normByteLength,
                byteLength: idxByteLength,
                target: 34963, // ELEMENT_ARRAY_BUFFER
            },
        ],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126, // FLOAT
                count: positions.length / 3,
                type: 'VEC3',
                min: [minPos[0], minPos[1], minPos[2]],
                max: [maxPos[0], maxPos[1], maxPos[2]],
            },
            {
                bufferView: 1,
                componentType: 5126, // FLOAT
                count: normals.length / 3,
                type: 'VEC3',
            },
            {
                bufferView: 2,
                componentType: 5123, // UNSIGNED_SHORT
                count: indices.length,
                type: 'SCALAR',
            },
        ],
    };

    const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(gltfJson));
    const jsonPaddedLength = align4(jsonBytesRaw.length);

    const totalLength = 12 + 8 + jsonPaddedLength + 8 + binPaddedLength;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Cabecera glTF 2.0 (12 bytes little-endian)
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, GLB_VERSION, true);
    view.setUint32(8, totalLength, true);

    // Chunk 0: JSON (relleno 0x20)
    const jsonHeaderOffset = 12;
    view.setUint32(jsonHeaderOffset, jsonPaddedLength, true);
    view.setUint32(jsonHeaderOffset + 4, CHUNK_TYPE_JSON, true);
    const jsonDataOffset = jsonHeaderOffset + 8;
    bytes.set(jsonBytesRaw, jsonDataOffset);
    for (let i = jsonBytesRaw.length; i < jsonPaddedLength; i++) {
        bytes[jsonDataOffset + i] = 0x20;
    }

    // Chunk 1: BIN (relleno 0x00)
    const binHeaderOffset = jsonDataOffset + jsonPaddedLength;
    view.setUint32(binHeaderOffset, binPaddedLength, true);
    view.setUint32(binHeaderOffset + 4, CHUNK_TYPE_BIN, true);
    let cursor = binHeaderOffset + 8;

    for (let i = 0; i < positions.length; i++) {
        view.setFloat32(cursor, positions[i], true);
        cursor += 4;
    }
    for (let i = 0; i < normals.length; i++) {
        view.setFloat32(cursor, normals[i], true);
        cursor += 4;
    }
    for (let i = 0; i < indices.length; i++) {
        view.setUint16(cursor, indices[i], true);
        cursor += 2;
    }
    // El padding final 0x00 queda garantizado por la inicialización en cero de ArrayBuffer

    return buffer;
}

function normalizeGeometryType(rawType: string): string {
    const clean = String(rawType || '').trim();
    switch (clean) {
        case 'elliptic-cone':
            return 'CONO_ELIPTICO';
        case 'truncated-elliptic-cone':
            return 'CONO_ELIPTICO_TRUNCADO';
        case 'perimeter-cone':
            return 'CONO_TRUNCADO_PERIMETRO';
        case 'windrow':
            return 'PILA_LONGITUDINAL_WINDROW';
        case 'toe-wall':
            return 'ACOPIO_CONTRA_MURO';
        default:
            return clean;
    }
}

export function buildStockpileGlbMesh(input: BuildStockpileGlbInput): GlbMeshBuildResult | null;
export function buildStockpileGlbMesh(
    geometryType: GlbGeometryKind,
    dimensions: Record<string, number | undefined | null>,
    profileSamples?: number[]
): GlbMeshBuildResult | null;
export function buildStockpileGlbMesh(
    inputOrType: BuildStockpileGlbInput | GlbGeometryKind,
    dimensionsArg?: Record<string, number | undefined | null>,
    profileSamplesArg?: number[]
): GlbMeshBuildResult | null {
    const resolved: BuildStockpileGlbInput =
        typeof inputOrType === 'string'
            ? {
                  geometryType: inputOrType,
                  dimensions: dimensionsArg || {},
                  profileSamples: profileSamplesArg,
              }
            : inputOrType;

    const dims = resolved.dimensions || {};
    const canonicalType = normalizeGeometryType(resolved.geometryType);
    const multipliers = normalizeProfileMultipliers(resolved.profileSamples);

    let rawMesh: RawSurfaceMesh | null = null;

    if (canonicalType === 'CONO_ELIPTICO') {
        const d1 = readPosDim(dims, ['d1', 'a', 'baseLengthM', 'base_length_m']);
        const d2 = readPosDim(dims, ['d2', 'b', 'baseWidthM', 'base_width_m']);
        const h = readPosDim(dims, ['h', 'heightM', 'height_m']);
        if (!d1 || !d2 || !h) return null;
        rawMesh = buildEllipticConeOrFrustum(d1 / 2, d2 / 2, 0, 0, h, multipliers);
    } else if (
        canonicalType === 'TRONCO_CONO_ELIPTICO' ||
        canonicalType === 'CONO_ELIPTICO_TRUNCADO' ||
        canonicalType === 'CONO_TRUNCADO_PERIMETRO'
    ) {
        const h = readPosDim(dims, ['h', 'heightM', 'height_m']);
        if (!h) return null;

        if (canonicalType === 'CONO_TRUNCADO_PERIMETRO') {
            const p = readPosDim(dims, ['p', 'P']);
            const pp = readNonNegDim(dims, ['pp', 'Pp']);
            if (!p || pp === null) return null;
            const rBase = p / (2 * Math.PI);
            const rTop = pp / (2 * Math.PI);
            rawMesh = buildEllipticConeOrFrustum(rBase, rBase, rTop, rTop, h, multipliers);
        } else {
            const d1 = readPosDim(dims, ['d1', 'a']);
            const d2 = readPosDim(dims, ['d2', 'b']);
            if (d1 && d2) {
                const d1p = readNonNegDim(dims, ['d1p', 'ap']);
                const d2p = readNonNegDim(dims, ['d2p', 'bp']);
                if (d1p === null || d2p === null) return null;
                if ((d1p === 0) !== (d2p === 0)) return null;
                rawMesh = buildEllipticConeOrFrustum(
                    d1 / 2,
                    d2 / 2,
                    d1p / 2,
                    d2p / 2,
                    h,
                    multipliers
                );
            } else {
                const p = readPosDim(dims, ['p', 'P']);
                const pp = readNonNegDim(dims, ['pp', 'Pp']);
                if (!p || pp === null) return null;
                const rBase = p / (2 * Math.PI);
                const rTop = pp / (2 * Math.PI);
                rawMesh = buildEllipticConeOrFrustum(rBase, rBase, rTop, rTop, h, multipliers);
            }
        }
    } else if (canonicalType === 'TRONCO_PIRAMIDAL') {
        const baseL = readPosDim(dims, [
            'baseLengthM',
            'base_length_m',
            'lengthM',
            'length_m',
            'd1',
            'a',
        ]);
        const baseW = readPosDim(dims, [
            'baseWidthM',
            'base_width_m',
            'widthM',
            'width_m',
            'widthFromWallM',
            'width_from_wall_m',
            'd2',
            'b',
        ]);
        const h = readPosDim(dims, ['h', 'heightM', 'height_m']);
        const topL = readNonNegDim(dims, ['crestLengthM', 'crest_length_m', 'd1p', 'ap']);
        const topW = readNonNegDim(dims, ['crestWidthM', 'crest_width_m', 'd2p', 'bp']);
        if (!baseL || !baseW || !h || topL === null || topW === null) return null;
        if ((topL === 0) !== (topW === 0)) return null;
        rawMesh = buildPrismoidalFrustumMesh(baseL, baseW, topL, topW, h, multipliers);
    } else if (canonicalType === 'PILA_LONGITUDINAL_WINDROW') {
        const baseL = readPosDim(dims, ['baseLengthM', 'base_length_m', 'lengthM', 'length_m']);
        const baseW = readPosDim(dims, ['baseWidthM', 'base_width_m', 'widthM', 'width_m']);
        const h = readPosDim(dims, ['h', 'heightM', 'height_m']);
        if (!baseL || !baseW || !h) return null;

        const optCrestL = readOptionalNonNegDim(dims, ['crestLengthM', 'crest_length_m']);
        const optCrestW = readOptionalNonNegDim(dims, ['crestWidthM', 'crest_width_m']);
        if (optCrestL === 'INVALID' || optCrestW === 'INVALID') return null;

        const crestL = optCrestL === undefined ? baseL : optCrestL;
        const crestW = optCrestW === undefined ? 0 : optCrestW;
        if (crestL === 0 && crestW > 0) return null;

        rawMesh = buildPrismoidalFrustumMesh(baseL, baseW, crestL, crestW, h, multipliers);
    } else if (canonicalType === 'ACOPIO_CONTRA_MURO') {
        const lengthM = readPosDim(dims, [
            'lengthM',
            'length_m',
            'wallLengthM',
            'wall_length_m',
            'baseLengthM',
            'base_length_m',
        ]);
        const widthFromWallM = readPosDim(dims, [
            'widthFromWallM',
            'width_from_wall_m',
            'wallWidthM',
            'wall_width_m',
            'baseWidthM',
            'base_width_m',
        ]);
        const heightAtWallM = readPosDim(dims, [
            'heightAtWallM',
            'height_at_wall_m',
            'h',
            'heightM',
            'height_m',
        ]);
        if (!lengthM || !widthFromWallM || !heightAtWallM) return null;

        const wallAngleDeg = readOptionalWallAngleDeg(dims, ['wallAngleDeg', 'wall_angle_deg']);
        if (wallAngleDeg === 'INVALID') return null;

        rawMesh = buildToeWallMesh(lengthM, widthFromWallM, heightAtWallM, wallAngleDeg, multipliers);
    } else {
        return null;
    }

    if (!rawMesh || rawMesh.positions.length === 0 || rawMesh.indices.length === 0) {
        return null;
    }

    const vertexCount = rawMesh.positions.length / 3;
    if (vertexCount > MAX_UINT16_VERTICES) {
        return null;
    }

    const triangleCount = rawMesh.indices.length / 3;
    const { normals, tinVolumeM3, surfaceAreaM2, boundingBoxM, minPos, maxPos } =
        computeMeshMetricsAndNormals(rawMesh.positions, rawMesh.indices);

    const posArray = new Float32Array(rawMesh.positions);
    const idxArray = new Uint16Array(rawMesh.indices);
    const glbBuffer = encodeGlbBinary(
        posArray,
        normals,
        idxArray,
        minPos,
        maxPos,
        resolved.name || `Stockpile_${canonicalType}`
    );

    return {
        glbBuffer,
        tinVolumeM3,
        surfaceAreaM2,
        vertexCount,
        triangleCount,
        boundingBoxM,
        rawUnindexedBytes: triangleCount * 3 * 24,
        optimizedGlbBytes: glbBuffer.byteLength,
        geometryType: canonicalType,
    };
}

function interpolateIdwElevation(
    gx: number,
    gy: number,
    refPoints: Point3DInput[],
    kNearest: number
): number {
    let exactSum = 0;
    let exactCount = 0;

    const k = Math.min(kNearest, refPoints.length);
    const bestD2 = new Float64Array(k);
    const bestZ = new Float64Array(k);
    bestD2.fill(Infinity);
    let filled = 0;
    let maxIdx = 0;
    let maxD2 = Infinity;

    for (let i = 0; i < refPoints.length; i++) {
        const pt = refPoints[i];
        const dx = gx - pt.x;
        const dy = gy - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-12) {
            exactSum += pt.z;
            exactCount++;
            continue;
        }
        if (exactCount > 0) continue;

        if (filled < k) {
            bestD2[filled] = d2;
            bestZ[filled] = pt.z;
            filled++;
            if (filled === k) {
                maxIdx = 0;
                maxD2 = bestD2[0];
                for (let j = 1; j < k; j++) {
                    if (bestD2[j] > maxD2) {
                        maxD2 = bestD2[j];
                        maxIdx = j;
                    }
                }
            }
        } else if (d2 < maxD2) {
            bestD2[maxIdx] = d2;
            bestZ[maxIdx] = pt.z;
            maxIdx = 0;
            maxD2 = bestD2[0];
            for (let j = 1; j < k; j++) {
                if (bestD2[j] > maxD2) {
                    maxD2 = bestD2[j];
                    maxIdx = j;
                }
            }
        }
    }

    if (exactCount > 0) {
        return exactSum / exactCount;
    }

    let weightSum = 0;
    let weightedZSum = 0;
    for (let j = 0; j < filled; j++) {
        const w = 1 / bestD2[j];
        weightSum += w;
        weightedZSum += w * bestZ[j];
    }

    return weightSum > 0 ? weightedZSum / weightSum : 0;
}

/**
 * Construye una malla 3D cerrada glTF 2.0 (`.glb`) en espacio Y-up desde una nube de puntos 3D reales
 * (`x = Este`, `y = Norte`, `z = Elevación`) mediante proyección heightfield 2.5D e interpolación IDW determinista.
 */
export function buildPointCloudHeightfieldGlbMesh(
    points: Point3DInput[],
    options?: { gridSize?: number; baseElevationM?: number; name?: string }
): GlbMeshBuildResult | null {
    if (!Array.isArray(points) || points.length === 0) return null;

    const validPoints: Point3DInput[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (
            !pt ||
            typeof pt.x !== 'number' ||
            !Number.isFinite(pt.x) ||
            typeof pt.y !== 'number' ||
            !Number.isFinite(pt.y) ||
            typeof pt.z !== 'number' ||
            !Number.isFinite(pt.z)
        ) {
            continue;
        }
        validPoints.push(pt);
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
    }

    if (validPoints.length < 4) return null;

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const baseZ =
        typeof options?.baseElevationM === 'number' && Number.isFinite(options.baseElevationM)
            ? options.baseElevationM
            : minZ;
    const relief = maxZ - baseZ;

    if (spanX <= 0.01 || spanY <= 0.01 || relief <= 0.005) {
        return null;
    }

    let gridN =
        typeof options?.gridSize === 'number' && Number.isFinite(options.gridSize)
            ? clamp(Math.round(options.gridSize), 4, 64)
            : clamp(Math.round(Math.sqrt(validPoints.length) * 2), 4, 64);

    const estimateVertices = (n: number): number => n * n + 4 * n * 2 + (1 + 4 * (n - 1));
    while (estimateVertices(gridN) > MAX_UINT16_VERTICES && gridN > 4) {
        gridN--;
    }

    // Consolidación espacial determinista por celda cuando hay > 2048 puntos para mantener IDW rápido
    let refPoints: Point3DInput[] = validPoints;
    if (validPoints.length > 2048) {
        const cellCount = gridN * gridN;
        const sumX = new Float64Array(cellCount);
        const sumY = new Float64Array(cellCount);
        const sumZ = new Float64Array(cellCount);
        const counts = new Uint32Array(cellCount);

        for (let i = 0; i < validPoints.length; i++) {
            const pt = validPoints[i];
            const c = Math.min(gridN - 1, Math.max(0, Math.floor(((pt.x - minX) / spanX) * (gridN - 1) + 0.5)));
            const r = Math.min(gridN - 1, Math.max(0, Math.floor(((pt.y - minY) / spanY) * (gridN - 1) + 0.5)));
            const cellIdx = r * gridN + c;
            sumX[cellIdx] += pt.x;
            sumY[cellIdx] += pt.y;
            sumZ[cellIdx] += pt.z;
            counts[cellIdx] += 1;
        }

        const binned: Point3DInput[] = [];
        for (let idx = 0; idx < cellCount; idx++) {
            const cnt = counts[idx];
            if (cnt > 0) {
                binned.push({
                    x: sumX[idx] / cnt,
                    y: sumY[idx] / cnt,
                    z: sumZ[idx] / cnt,
                });
            }
        }
        if (binned.length >= 4) {
            refPoints = binned;
        }
    }

    const centerE = (minX + maxX) * 0.5;
    const centerN = (minY + maxY) * 0.5;

    const xCoords = new Float64Array(gridN);
    const zCoords = new Float64Array(gridN);
    const heightGrid = new Float64Array(gridN * gridN);

    for (let col = 0; col < gridN; col++) {
        const e = minX + (col / (gridN - 1)) * spanX;
        xCoords[col] = e - centerE;
    }
    for (let row = 0; row < gridN; row++) {
        const n = minY + (row / (gridN - 1)) * spanY;
        zCoords[row] = -(n - centerN);
    }

    let maxGridHeight = 0;
    for (let row = 0; row < gridN; row++) {
        const gy = minY + (row / (gridN - 1)) * spanY;
        for (let col = 0; col < gridN; col++) {
            const gx = minX + (col / (gridN - 1)) * spanX;
            const zInterp = interpolateIdwElevation(gx, gy, refPoints, 16);
            const h = Math.max(0, zInterp - baseZ);
            heightGrid[row * gridN + col] = h;
            if (h > maxGridHeight) maxGridHeight = h;
        }
    }

    if (maxGridHeight <= 0.005) {
        return null;
    }

    const positions: number[] = [];
    const indices: number[] = [];

    // 1. Superficie superior heightfield (+Y arriba)
    const topStart = positions.length / 3;
    for (let row = 0; row < gridN; row++) {
        const z = zCoords[row];
        for (let col = 0; col < gridN; col++) {
            pushVertex(positions, xCoords[col], heightGrid[row * gridN + col], z);
        }
    }
    for (let row = 0; row < gridN - 1; row++) {
        for (let col = 0; col < gridN - 1; col++) {
            const p00 = topStart + row * gridN + col;
            const p01 = p00 + 1;
            const p10 = p00 + gridN;
            const p11 = p10 + 1;
            indices.push(p00, p01, p11);
            indices.push(p00, p11, p10);
        }
    }

    // 2. Faldones laterales hacia y = 0 (aristas separadas para normales limpias y volumen watertight)
    // 2a. Sur (row = 0, normal +Z)
    const southStart = positions.length / 3;
    for (let col = 0; col < gridN; col++) {
        const x = xCoords[col];
        const z = zCoords[0];
        pushVertex(positions, x, heightGrid[col], z);
        pushVertex(positions, x, 0, z);
    }
    for (let col = 0; col < gridN - 1; col++) {
        const t0 = southStart + col * 2;
        const b0 = t0 + 1;
        const t1 = t0 + 2;
        const b1 = t0 + 3;
        indices.push(t0, b0, b1);
        indices.push(t0, b1, t1);
    }

    // 2b. Norte (row = gridN - 1, normal -Z)
    const northStart = positions.length / 3;
    const northRowOffset = (gridN - 1) * gridN;
    for (let col = 0; col < gridN; col++) {
        const x = xCoords[col];
        const z = zCoords[gridN - 1];
        pushVertex(positions, x, heightGrid[northRowOffset + col], z);
        pushVertex(positions, x, 0, z);
    }
    for (let col = 0; col < gridN - 1; col++) {
        const t0 = northStart + col * 2;
        const b0 = t0 + 1;
        const t1 = t0 + 2;
        const b1 = t0 + 3;
        indices.push(t0, t1, b1);
        indices.push(t0, b1, b0);
    }

    // 2c. Este (col = gridN - 1, normal +X)
    const eastStart = positions.length / 3;
    for (let row = 0; row < gridN; row++) {
        const x = xCoords[gridN - 1];
        const z = zCoords[row];
        pushVertex(positions, x, heightGrid[row * gridN + (gridN - 1)], z);
        pushVertex(positions, x, 0, z);
    }
    for (let row = 0; row < gridN - 1; row++) {
        const t0 = eastStart + row * 2;
        const b0 = t0 + 1;
        const t1 = t0 + 2;
        const b1 = t0 + 3;
        indices.push(t0, b0, b1);
        indices.push(t0, b1, t1);
    }

    // 2d. Oeste (col = 0, normal -X)
    const westStart = positions.length / 3;
    for (let row = 0; row < gridN; row++) {
        const x = xCoords[0];
        const z = zCoords[row];
        pushVertex(positions, x, heightGrid[row * gridN], z);
        pushVertex(positions, x, 0, z);
    }
    for (let row = 0; row < gridN - 1; row++) {
        const t0 = westStart + row * 2;
        const b0 = t0 + 1;
        const t1 = t0 + 2;
        const b1 = t0 + 3;
        indices.push(t0, t1, b1);
        indices.push(t0, b1, b0);
    }

    // 3. Tapa basal cerrada en y = 0 (normal -Y) compartiendo vértices perimetrales exactos
    const botCenter = pushVertex(positions, 0, 0, 0);
    const ringStart = positions.length / 3;
    for (let col = 0; col < gridN - 1; col++) {
        pushVertex(positions, xCoords[col], 0, zCoords[0]);
    }
    for (let row = 0; row < gridN - 1; row++) {
        pushVertex(positions, xCoords[gridN - 1], 0, zCoords[row]);
    }
    for (let col = gridN - 1; col >= 1; col--) {
        pushVertex(positions, xCoords[col], 0, zCoords[gridN - 1]);
    }
    for (let row = gridN - 1; row >= 1; row--) {
        pushVertex(positions, xCoords[0], 0, zCoords[row]);
    }
    const perimCount = 4 * (gridN - 1);
    for (let k = 0; k < perimCount; k++) {
        const nextK = (k + 1) % perimCount;
        indices.push(botCenter, ringStart + nextK, ringStart + k);
    }

    const vertexCount = positions.length / 3;
    if (vertexCount > MAX_UINT16_VERTICES) {
        return null;
    }

    const triangleCount = indices.length / 3;
    const { normals, tinVolumeM3, surfaceAreaM2, boundingBoxM, minPos, maxPos } =
        computeMeshMetricsAndNormals(positions, indices);

    if (tinVolumeM3 <= 0) {
        return null;
    }

    const posArray = new Float32Array(positions);
    const idxArray = new Uint16Array(indices);
    const glbBuffer = encodeGlbBinary(
        posArray,
        normals,
        idxArray,
        minPos,
        maxPos,
        options?.name || 'PointCloudHeightfield'
    );

    return {
        glbBuffer,
        tinVolumeM3,
        surfaceAreaM2,
        vertexCount,
        triangleCount,
        boundingBoxM,
        rawUnindexedBytes: triangleCount * 3 * 24,
        optimizedGlbBytes: glbBuffer.byteLength,
        geometryType: 'POINT_CLOUD_HEIGHTFIELD_2_5D',
    };
}
