import type { SpatialSurfaceGrid } from './spatial-volume.engine';

export type StockpileGlbGeometryKind =
    | 'CONO_ELIPTICO'
    | 'TRONCO_CONO_ELIPTICO'
    | 'CONO_ELIPTICO_TRUNCADO'
    | 'CONO_TRUNCADO_PERIMETRO'
    | 'TRONCO_PIRAMIDAL'
    | 'PILA_LONGITUDINAL_WINDROW'
    | 'ACOPIO_CONTRA_MURO'
    | string;

export interface GlbSurfaceBuilderInput {
    geometryType: StockpileGlbGeometryKind;
    dimensions: Record<string, number | undefined | null>;
    profileSamples?: number[];
}

export interface GlbBoundingBoxM {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    /** Esquema canónico unificado V2 */
    widthX: number;
    depthZ: number;
    heightY: number;
    /** Alias legacy de lectura compatible */
    lengthM: number;
    heightM: number;
    widthM: number;
}

export interface GlbSurfaceBuildResult {
    glbBuffer: Buffer;
    tinVolumeM3: number;
    surfaceAreaM2: number;
    vertexCount: number;
    triangleCount: number;
    boundingBoxM: GlbBoundingBoxM;
    rawUnindexedBytes: number;
    optimizedGlbBytes: number;
}

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;

function requirePositiveDim(
    dims: Record<string, number | undefined | null>,
    keys: string[],
    label: string
): number {
    for (const key of keys) {
        const val = dims[key];
        if (typeof val === 'number' && Number.isFinite(val)) {
            if (val <= 0) {
                throw new Error(`Dimension requerida '${label}' (${key}) debe ser > 0.`);
            }
            return val;
        }
    }
    throw new Error(`Dimension requerida '${label}' no declarada (${keys.join('|')}).`);
}

function requireNonNegativeDim(
    dims: Record<string, number | undefined | null>,
    keys: string[],
    label: string
): number {
    for (const key of keys) {
        const val = dims[key];
        if (typeof val === 'number' && Number.isFinite(val)) {
            if (val < 0) {
                throw new Error(`Dimension requerida '${label}' (${key}) debe ser >= 0.`);
            }
            return val;
        }
    }
    throw new Error(`Dimension requerida '${label}' no declarada (${keys.join('|')}).`);
}

function optionalNonNegativeDim(
    dims: Record<string, number | undefined | null>,
    keys: string[],
    fallback: number,
    label: string
): number {
    for (const key of keys) {
        const val = dims[key];
        if (val !== undefined && val !== null) {
            if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
                throw new Error(`Dimension opcional '${label}' (${key}) invalida.`);
            }
            return val;
        }
    }
    return fallback;
}

function normalizeGeometryKind(raw: string): string {
    const normalized = String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/-/g, '_');

    switch (normalized) {
        case 'ELLIPTIC_CONE':
        case 'CONO_ELIPTICO':
            return 'CONO_ELIPTICO';
        case 'TRUNCATED_ELLIPTIC_CONE':
        case 'TRONCO_CONO_ELIPTICO':
        case 'CONO_ELIPTICO_TRUNCADO':
            return 'TRONCO_CONO_ELIPTICO';
        case 'PERIMETER_CONE':
        case 'CONO_TRUNCADO_PERIMETRO':
            return 'CONO_TRUNCADO_PERIMETRO';
        case 'TRUNCATED_PYRAMID':
        case 'TRONCO_PIRAMIDAL':
            return 'TRONCO_PIRAMIDAL';
        case 'WINDROW':
        case 'PILA_LONGITUDINAL_WINDROW':
            return 'PILA_LONGITUDINAL_WINDROW';
        case 'TOE_WALL':
        case 'ACOPIO_CONTRA_MURO':
            return 'ACOPIO_CONTRA_MURO';
        default:
            throw new Error(`Geometria de acopio no soportada para malla .glb: '${raw}'.`);
    }
}

function sanitizeProfileSamples(samples?: number[]): number[] {
    if (!Array.isArray(samples) || samples.length === 0) return [];
    return samples.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

function sampleProfileModulation(samples: number[], tNorm: number): number {
    if (samples.length === 0) return 1.0;
    const mean = samples.reduce((acc, s) => acc + s, 0) / samples.length;
    if (mean <= 0) return 1.0;

    const clampedT = Math.max(0, Math.min(1, tNorm));
    const scaledIdx = clampedT * (samples.length - 1);
    const lo = Math.floor(scaledIdx);
    const hi = Math.min(samples.length - 1, lo + 1);
    const frac = scaledIdx - lo;
    const rawVal = samples[lo] * (1 - frac) + samples[hi] * frac;
    const ratio = rawVal / mean;
    // Acotar deformacion paramétrica al rango [0.75, 1.25] para preservar coherencia volumétrica
    return Math.max(0.75, Math.min(1.25, 0.8 + 0.2 * ratio));
}

interface IndexedMeshData {
    positions: number[];
    indices: number[];
}

function pushTriangle(indices: number[], a: number, b: number, c: number): void {
    indices.push(a, b, c);
}

function buildEllipticFrustumMesh(
    rxBottom: number,
    rzBottom: number,
    rxTop: number,
    rzTop: number,
    heightM: number,
    profileSamples: number[],
    radialSegments = 40,
    stacks = 6
): IndexedMeshData {
    const positions: number[] = [];
    const indices: number[] = [];

    const hasTopCap = rxTop > 1e-6 && rzTop > 1e-6;
    const effectiveTopRx = hasTopCap ? rxTop : 0;
    const effectiveTopRz = hasTopCap ? rzTop : 0;

    // 1. Manto lateral (vertices propios para normales suaves sin sangrado hacia la base plana)
    const sideStart = positions.length / 3;
    const cols = radialSegments + 1;

    for (let s = 0; s <= stacks; s++) {
        const vFrac = s / stacks;
        const rx = rxBottom + (effectiveTopRx - rxBottom) * vFrac;
        const rz = rzBottom + (effectiveTopRz - rzBottom) * vFrac;

        for (let r = 0; r <= radialSegments; r++) {
            const theta = (r / radialSegments) * Math.PI * 2;
            const mod =
                s > 0 && profileSamples.length > 0
                    ? sampleProfileModulation(profileSamples, (r % radialSegments) / radialSegments)
                    : 1.0;
            const y = vFrac * heightM * mod;
            const x = rx * Math.cos(theta);
            // Invertimos seno para que al avanzar theta, la malla cierre en CCW visto desde fuera (+Y arriba)
            const z = -rz * Math.sin(theta);
            positions.push(x, y, z);
        }
    }

    for (let s = 0; s < stacks; s++) {
        for (let r = 0; r < radialSegments; r++) {
            const bl = sideStart + s * cols + r;
            const br = bl + 1;
            const tl = sideStart + (s + 1) * cols + r;
            const tr = tl + 1;

            pushTriangle(indices, bl, br, tr);
            if (s < stacks - 1 || hasTopCap) {
                pushTriangle(indices, bl, tr, tl);
            }
        }
    }

    // 2. Tapa inferior (y = 0, normal -Y)
    const bottomCenterIdx = positions.length / 3;
    positions.push(0, 0, 0);
    const bottomRingStart = positions.length / 3;
    for (let r = 0; r <= radialSegments; r++) {
        const theta = (r / radialSegments) * Math.PI * 2;
        positions.push(rxBottom * Math.cos(theta), 0, -rzBottom * Math.sin(theta));
    }
    for (let r = 0; r < radialSegments; r++) {
        pushTriangle(indices, bottomCenterIdx, bottomRingStart + r + 1, bottomRingStart + r);
    }

    // 3. Tapa superior si es cono truncado (normal +Y)
    if (hasTopCap) {
        const topRingStart = positions.length / 3;
        let topYSum = 0;
        for (let r = 0; r <= radialSegments; r++) {
            const theta = (r / radialSegments) * Math.PI * 2;
            const mod =
                profileSamples.length > 0
                    ? sampleProfileModulation(profileSamples, (r % radialSegments) / radialSegments)
                    : 1.0;
            const yTop = heightM * mod;
            if (r < radialSegments) topYSum += yTop;
            positions.push(effectiveTopRx * Math.cos(theta), yTop, -effectiveTopRz * Math.sin(theta));
        }
        const topCenterIdx = positions.length / 3;
        positions.push(0, topYSum / radialSegments, 0);

        for (let r = 0; r < radialSegments; r++) {
            pushTriangle(indices, topCenterIdx, topRingStart + r, topRingStart + r + 1);
        }
    }

    return { positions, indices };
}

function pushQuadCCW(
    positions: number[],
    indices: number[],
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number]
): void {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    pushTriangle(indices, base, base + 1, base + 2);
    pushTriangle(indices, base, base + 2, base + 3);
}

function buildLinearLoftFrustumMesh(
    baseLengthM: number,
    baseWidthM: number,
    crestLengthM: number,
    crestWidthM: number,
    heightM: number,
    profileSamples: number[],
    xStations = 12
): IndexedMeshData {
    const positions: number[] = [];
    const indices: number[] = [];

    const stations = profileSamples.length > 0 ? Math.max(xStations, 16) : xStations;
    const cols = stations + 1;

    // Perfil de bordes longitudinales: bLeft/bRight (base y=0), tLeft/tRight (cresta y=H*mod)
    const bxCoords: number[] = [];
    const txCoords: number[] = [];
    const tyCoords: number[] = [];

    const halfLb = baseLengthM / 2;
    const halfWb = baseWidthM / 2;
    const halfLc = crestLengthM / 2;
    const halfWc = crestWidthM / 2;

    for (let i = 0; i <= stations; i++) {
        const u = i / stations;
        const sSigned = -1 + 2 * u; // [-1 .. 1]
        bxCoords.push(sSigned * halfLb);
        txCoords.push(sSigned * halfLc);
        const mod = profileSamples.length > 0 ? sampleProfileModulation(profileSamples, u) : 1.0;
        tyCoords.push(heightM * mod);
    }

    // 1. Cara frontal (+Z): base (+halfWb) -> cresta (+halfWc)
    const frontStart = positions.length / 3;
    for (let i = 0; i <= stations; i++) positions.push(bxCoords[i], 0, halfWb);
    for (let i = 0; i <= stations; i++) positions.push(txCoords[i], tyCoords[i], halfWc);
    for (let i = 0; i < stations; i++) {
        const bl = frontStart + i;
        const br = bl + 1;
        const tl = frontStart + cols + i;
        const tr = tl + 1;
        pushTriangle(indices, bl, br, tr);
        pushTriangle(indices, bl, tr, tl);
    }

    // 2. Cara trasera (-Z): base (-halfWb) -> cresta (-halfWc)
    const backStart = positions.length / 3;
    for (let i = 0; i <= stations; i++) positions.push(bxCoords[stations - i], 0, -halfWb);
    for (let i = 0; i <= stations; i++)
        positions.push(txCoords[stations - i], tyCoords[stations - i], -halfWc);
    for (let i = 0; i < stations; i++) {
        const bl = backStart + i;
        const br = bl + 1;
        const tl = backStart + cols + i;
        const tr = tl + 1;
        pushTriangle(indices, bl, br, tr);
        pushTriangle(indices, bl, tr, tl);
    }

    // 3. Base inferior (y = 0, normal -Y)
    const botStart = positions.length / 3;
    for (let i = 0; i <= stations; i++) positions.push(bxCoords[i], 0, halfWb);
    for (let i = 0; i <= stations; i++) positions.push(bxCoords[i], 0, -halfWb);
    for (let i = 0; i < stations; i++) {
        const fl = botStart + i;
        const fr = fl + 1;
        const bl = botStart + cols + i;
        const br = bl + 1;
        pushTriangle(indices, fl, br, fr);
        pushTriangle(indices, fl, bl, br);
    }

    // 4. Meseta superior (si crestWidthM > 0, normal +Y)
    if (halfWc > 1e-6) {
        const topStart = positions.length / 3;
        for (let i = 0; i <= stations; i++) positions.push(txCoords[i], tyCoords[i], halfWc);
        for (let i = 0; i <= stations; i++) positions.push(txCoords[i], tyCoords[i], -halfWc);
        for (let i = 0; i < stations; i++) {
            const fl = topStart + i;
            const fr = fl + 1;
            const bl = topStart + cols + i;
            const br = bl + 1;
            pushTriangle(indices, fl, fr, br);
            pushTriangle(indices, fl, br, bl);
        }
    }

    // 5. Talud extremo derecho (+X) y extremo izquierdo (-X)
    const pR_bf: [number, number, number] = [halfLb, 0, halfWb];
    const pR_bb: [number, number, number] = [halfLb, 0, -halfWb];
    const pR_tf: [number, number, number] = [halfLc, tyCoords[stations], halfWc];
    const pR_tb: [number, number, number] = [halfLc, tyCoords[stations], -halfWc];

    if (halfWc > 1e-6) {
        pushQuadCCW(positions, indices, pR_bf, pR_bb, pR_tb, pR_tf);
    } else {
        const base = positions.length / 3;
        positions.push(...pR_bf, ...pR_bb, ...pR_tf);
        pushTriangle(indices, base, base + 1, base + 2);
    }

    const pL_bb: [number, number, number] = [-halfLb, 0, -halfWb];
    const pL_bf: [number, number, number] = [-halfLb, 0, halfWb];
    const pL_tb: [number, number, number] = [-halfLc, tyCoords[0], -halfWc];
    const pL_tf: [number, number, number] = [-halfLc, tyCoords[0], halfWc];

    if (halfWc > 1e-6) {
        pushQuadCCW(positions, indices, pL_bb, pL_bf, pL_tf, pL_tb);
    } else {
        const base = positions.length / 3;
        positions.push(...pL_bb, ...pL_bf, ...pL_tf);
        pushTriangle(indices, base, base + 1, base + 2);
    }

    return { positions, indices };
}

function buildWallWedgeMesh(
    lengthM: number,
    effectiveWidthM: number,
    heightAtWallM: number,
    profileSamples: number[],
    xStations = 12
): IndexedMeshData {
    const positions: number[] = [];
    const indices: number[] = [];

    const stations = profileSamples.length > 0 ? Math.max(xStations, 16) : xStations;
    const cols = stations + 1;
    const halfL = lengthM / 2;
    const halfW = effectiveWidthM / 2;

    const xArr: number[] = [];
    const yArr: number[] = [];
    for (let i = 0; i <= stations; i++) {
        const u = i / stations;
        xArr.push((-1 + 2 * u) * halfL);
        const mod = profileSamples.length > 0 ? sampleProfileModulation(profileSamples, u) : 1.0;
        yArr.push(heightAtWallM * mod);
    }

    // 1. Talud libre: baja desde cresta contra muro (-halfW, y) hacia pie (+halfW, 0)
    const slopeStart = positions.length / 3;
    for (let i = 0; i <= stations; i++) positions.push(xArr[i], 0, halfW);
    for (let i = 0; i <= stations; i++) positions.push(xArr[i], yArr[i], -halfW);
    for (let i = 0; i < stations; i++) {
        const bl = slopeStart + i;
        const br = bl + 1;
        const tl = slopeStart + cols + i;
        const tr = tl + 1;
        pushTriangle(indices, bl, br, tr);
        pushTriangle(indices, bl, tr, tl);
    }

    // 2. Cara contra muro (-halfW): vertical desde y=0 hasta y=H
    const wallStart = positions.length / 3;
    for (let i = 0; i <= stations; i++) positions.push(xArr[stations - i], 0, -halfW);
    for (let i = 0; i <= stations; i++) positions.push(xArr[stations - i], yArr[stations - i], -halfW);
    for (let i = 0; i < stations; i++) {
        const bl = wallStart + i;
        const br = bl + 1;
        const tl = wallStart + cols + i;
        const tr = tl + 1;
        pushTriangle(indices, bl, br, tr);
        pushTriangle(indices, bl, tr, tl);
    }

    // 3. Base sobre suelo (y = 0)
    const botStart = positions.length / 3;
    for (let i = 0; i <= stations; i++) positions.push(xArr[i], 0, halfW);
    for (let i = 0; i <= stations; i++) positions.push(xArr[i], 0, -halfW);
    for (let i = 0; i < stations; i++) {
        const fl = botStart + i;
        const fr = fl + 1;
        const bl = botStart + cols + i;
        const br = bl + 1;
        pushTriangle(indices, fl, br, fr);
        pushTriangle(indices, fl, bl, br);
    }

    // 4. Tapas triangulares en x = +halfL y x = -halfL
    const rBase = positions.length / 3;
    positions.push(halfL, 0, halfW, halfL, 0, -halfW, halfL, yArr[stations], -halfW);
    pushTriangle(indices, rBase, rBase + 1, rBase + 2);

    const lBase = positions.length / 3;
    positions.push(-halfL, 0, -halfW, -halfL, 0, halfW, -halfL, yArr[0], -halfW);
    pushTriangle(indices, lBase, lBase + 1, lBase + 2);

    return { positions, indices };
}

function computeMeshPhysicsAndNormals(mesh: IndexedMeshData): {
    normals: number[];
    tinVolumeM3: number;
    surfaceAreaM2: number;
    boundingBoxM: GlbBoundingBoxM;
    indices: number[];
} {
    const { positions } = mesh;
    let indices = [...mesh.indices];
    const vertexCount = positions.length / 3;

    if (vertexCount === 0 || indices.length < 3) {
        throw new Error(`Malla .glb invalida: vertices=${vertexCount}, indices=${indices.length}.`);
    }

    const computeMetrics = (idxList: number[]) => {
        let signedVol6 = 0;
        let area = 0;
        const normals = new Array<number>(positions.length).fill(0);

        for (let t = 0; t < idxList.length; t += 3) {
            const i0 = idxList[t];
            const i1 = idxList[t + 1];
            const i2 = idxList[t + 2];

            const x0 = positions[i0 * 3];
            const y0 = positions[i0 * 3 + 1];
            const z0 = positions[i0 * 3 + 2];

            const x1 = positions[i1 * 3];
            const y1 = positions[i1 * 3 + 1];
            const z1 = positions[i1 * 3 + 2];

            const x2 = positions[i2 * 3];
            const y2 = positions[i2 * 3 + 1];
            const z2 = positions[i2 * 3 + 2];

            // Volumen tetraedrico firmado: v0 . (v1 x v2)
            const c12x = y1 * z2 - z1 * y2;
            const c12y = z1 * x2 - x1 * z2;
            const c12z = x1 * y2 - y1 * x2;
            signedVol6 += x0 * c12x + y0 * c12y + z0 * c12z;

            // Normal de cara: (v1 - v0) x (v2 - v0)
            const ux = x1 - x0;
            const uy = y1 - y0;
            const uz = z1 - z0;
            const vx = x2 - x0;
            const vy = y2 - y0;
            const vz = z2 - z0;

            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;

            const triArea2 = Math.hypot(nx, ny, nz);
            area += triArea2 * 0.5;

            if (triArea2 > 1e-12) {
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
        }

        return { signedVol6, area, normals };
    };

    let metrics = computeMetrics(indices);
    if (metrics.signedVol6 < 0) {
        const flipped: number[] = [];
        for (let t = 0; t < indices.length; t += 3) {
            flipped.push(indices[t], indices[t + 2], indices[t + 1]);
        }
        indices = flipped;
        metrics = computeMetrics(indices);
    }

    for (let v = 0; v < vertexCount; v++) {
        const nx = metrics.normals[v * 3];
        const ny = metrics.normals[v * 3 + 1];
        const nz = metrics.normals[v * 3 + 2];
        const len = Math.hypot(nx, ny, nz);
        if (len > 1e-12) {
            metrics.normals[v * 3] = nx / len;
            metrics.normals[v * 3 + 1] = ny / len;
            metrics.normals[v * 3 + 2] = nz / len;
        } else {
            metrics.normals[v * 3] = 0;
            metrics.normals[v * 3 + 1] = 1;
            metrics.normals[v * 3 + 2] = 0;
        }
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let v = 0; v < vertexCount; v++) {
        const x = positions[v * 3];
        const y = positions[v * 3 + 1];
        const z = positions[v * 3 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }

    const round3 = (n: number) => Number(n.toFixed(3));
    const widthX = round3(maxX - minX);
    const heightY = round3(maxY - minY);
    const depthZ = round3(maxZ - minZ);
    return {
        normals: metrics.normals,
        tinVolumeM3: round3(Math.abs(metrics.signedVol6) / 6),
        surfaceAreaM2: round3(metrics.area),
        indices,
        boundingBoxM: {
            minX: round3(minX),
            maxX: round3(maxX),
            minY: round3(minY),
            maxY: round3(maxY),
            minZ: round3(minZ),
            maxZ: round3(maxZ),
            widthX,
            depthZ,
            heightY,
            lengthM: widthX,
            heightM: heightY,
            widthM: depthZ,
        },
    };
}

// Paleta lineal RGB (glTF 2.0 COLOR_0) bajo ANSI/ISA-101 MINREPORT
const ISA101_COLOR_NEUTRAL: [number, number, number] = [0.2542, 0.2918, 0.3813]; // Neutro técnico (#8A93A6)
const ISA101_COLOR_CYAN_VERIFIED: [number, number, number] = [0.0, 0.4233, 0.8632]; // Cian (#00AEEF) >= 2 obs
const ISA101_COLOR_COPPER_ALERT: [number, number, number] = [0.5647, 0.227, 0.0612]; // Cobre (#C68346) interpolado / talud > 38°

const GRID_H_EPS_M = 0.015;
const SPLIT_EDGE_COS_45 = Math.SQRT1_2;

export type SpatialSurfaceGridInput = SpatialSurfaceGrid & {
    /** Bytes RGB sRGB opcionales (`nx * nz * 3`) para emitir COLOR_0 fotográfico real en GLB */
    rgbBytes?: Uint8Array | null;
};

function srgbByteToLinearGlb(byteVal: number): number {
    const c = Math.max(0, Math.min(255, byteVal)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function signedTriArea2DGlb(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number
): number {
    return 0.5 * ((bz - az) * (cx - ax) - (bx - ax) * (cz - az));
}

function packGlbBuffer(
    positions: number[],
    normals: number[],
    indices: number[],
    bbox: GlbBoundingBoxM,
    colors?: number[]
): Buffer {
    const vertexCount = positions.length / 3;
    const indexCount = indices.length;
    const useUint32 = vertexCount > 65535;
    const hasColors = Array.isArray(colors) && colors.length === positions.length;

    const posFloat = new Float32Array(positions);
    const normFloat = new Float32Array(normals);
    const colorFloat = hasColors ? new Float32Array(colors!) : null;
    const idxArray = useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
    const idxComponentType = useUint32 ? 5125 : 5123;

    const posBytes = Buffer.from(posFloat.buffer, posFloat.byteOffset, posFloat.byteLength);
    const normBytes = Buffer.from(normFloat.buffer, normFloat.byteOffset, normFloat.byteLength);
    const colorBytes = colorFloat
        ? Buffer.from(colorFloat.buffer, colorFloat.byteOffset, colorFloat.byteLength)
        : null;
    const idxBytes = Buffer.from(idxArray.buffer, idxArray.byteOffset, idxArray.byteLength);

    const rawBinLength =
        posBytes.length + normBytes.length + (colorBytes ? colorBytes.length : 0) + idxBytes.length;
    const binPad = (4 - (rawBinLength % 4)) % 4;
    const binPaddedLength = rawBinLength + binPad;

    const bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number; target: number }> = [
        { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
        { buffer: 0, byteOffset: posBytes.length, byteLength: normBytes.length, target: 34962 },
    ];
    const accessors: Array<Record<string, unknown>> = [
        {
            bufferView: 0,
            componentType: 5126,
            count: vertexCount,
            type: 'VEC3',
            min: [bbox.minX, bbox.minY, bbox.minZ],
            max: [bbox.maxX, bbox.maxY, bbox.maxZ],
        },
        {
            bufferView: 1,
            componentType: 5126,
            count: vertexCount,
            type: 'VEC3',
        },
    ];

    const attributes: Record<string, number> = {
        POSITION: 0,
        NORMAL: 1,
    };

    let runningOffset = posBytes.length + normBytes.length;
    if (colorBytes) {
        const colorViewIdx = bufferViews.length;
        bufferViews.push({
            buffer: 0,
            byteOffset: runningOffset,
            byteLength: colorBytes.length,
            target: 34962,
        });
        const colorAccIdx = accessors.length;
        accessors.push({
            bufferView: colorViewIdx,
            componentType: 5126,
            count: vertexCount,
            type: 'VEC3',
        });
        attributes.COLOR_0 = colorAccIdx;
        runningOffset += colorBytes.length;
    }

    const idxViewIdx = bufferViews.length;
    bufferViews.push({
        buffer: 0,
        byteOffset: runningOffset,
        byteLength: idxBytes.length,
        target: 34963,
    });
    const idxAccIdx = accessors.length;
    accessors.push({
        bufferView: idxViewIdx,
        componentType: idxComponentType,
        count: indexCount,
        type: 'SCALAR',
    });

    const gltfJson = {
        asset: {
            version: '2.0',
            generator: 'MINREPORT-ACOPIOS-TIN-BUILDER-southamerica-west1',
        },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'StockpileTinMesh' }],
        meshes: [
            {
                name: 'StockpileSurface',
                primitives: [
                    {
                        attributes,
                        indices: idxAccIdx,
                        material: 0,
                    },
                ],
            },
        ],
        materials: [
            {
                name: hasColors ? 'MinreportIsa101SurfaceMat' : 'MinreportCopperOreMat',
                doubleSided: false,
                pbrMetallicRoughness: {
                    baseColorFactor: hasColors
                        ? [1.0, 1.0, 1.0, 1.0]
                        : [0.7765, 0.5137, 0.2745, 1.0],
                    metallicFactor: 0.12,
                    roughnessFactor: 0.85,
                },
            },
        ],
        buffers: [{ byteLength: binPaddedLength }],
        bufferViews,
        accessors,
    };

    const jsonRaw = Buffer.from(JSON.stringify(gltfJson), 'utf8');
    const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
    const jsonPaddedLength = jsonRaw.length + jsonPad;

    const totalLength = 12 + 8 + jsonPaddedLength + 8 + binPaddedLength;
    const glb = Buffer.alloc(totalLength);

    let offset = 0;
    glb.writeUInt32LE(GLB_MAGIC, offset);
    offset += 4;
    glb.writeUInt32LE(GLB_VERSION, offset);
    offset += 4;
    glb.writeUInt32LE(totalLength, offset);
    offset += 4;

    glb.writeUInt32LE(jsonPaddedLength, offset);
    offset += 4;
    glb.writeUInt32LE(GLB_CHUNK_JSON, offset);
    offset += 4;
    jsonRaw.copy(glb, offset);
    offset += jsonRaw.length;
    for (let i = 0; i < jsonPad; i++) {
        glb.writeUInt8(0x20, offset++);
    }

    glb.writeUInt32LE(binPaddedLength, offset);
    offset += 4;
    glb.writeUInt32LE(GLB_CHUNK_BIN, offset);
    offset += 4;
    posBytes.copy(glb, offset);
    offset += posBytes.length;
    normBytes.copy(glb, offset);
    offset += normBytes.length;
    if (colorBytes) {
        colorBytes.copy(glb, offset);
        offset += colorBytes.length;
    }
    idxBytes.copy(glb, offset);
    offset += idxBytes.length;
    for (let i = 0; i < binPad; i++) {
        glb.writeUInt8(0x00, offset++);
    }

    return glb;
}

/**
 * Construye de manera determinista en Node.js (sin WebGL/navegador) un binario glTF 2.0 `.glb`
 * watertight para cualquiera de las 5 geometrias oficiales de MINREPORT · ACOPIOS.
 * Falla de forma cerrada si faltan cotas declaradas o son <= 0.
 */
export function buildServerStockpileGlbMesh(input: GlbSurfaceBuilderInput): GlbSurfaceBuildResult {
    const geom = normalizeGeometryKind(input.geometryType);
    const dims = input.dimensions || {};
    const profileSamples = sanitizeProfileSamples(input.profileSamples);

    let rawMesh: IndexedMeshData;

    if (geom === 'CONO_ELIPTICO') {
        const d1 = requirePositiveDim(dims, ['d1', 'a', 'baseLengthM', 'base_length_m'], 'd1');
        const d2 = requirePositiveDim(dims, ['d2', 'b', 'baseWidthM', 'base_width_m'], 'd2');
        const h = requirePositiveDim(dims, ['h', 'heightM', 'height_m'], 'h');
        rawMesh = buildEllipticFrustumMesh(d1 / 2, d2 / 2, 0, 0, h, profileSamples);
    } else if (geom === 'TRONCO_CONO_ELIPTICO') {
        const d1 = requirePositiveDim(dims, ['d1', 'a', 'baseLengthM', 'base_length_m'], 'd1');
        const d2 = requirePositiveDim(dims, ['d2', 'b', 'baseWidthM', 'base_width_m'], 'd2');
        const d1p = requireNonNegativeDim(
            dims,
            ['d1p', 'ap', 'crestLengthM', 'crest_length_m'],
            'd1p'
        );
        const d2p = requireNonNegativeDim(
            dims,
            ['d2p', 'bp', 'crestWidthM', 'crest_width_m'],
            'd2p'
        );
        const h = requirePositiveDim(dims, ['h', 'heightM', 'height_m'], 'h');
        rawMesh = buildEllipticFrustumMesh(d1 / 2, d2 / 2, d1p / 2, d2p / 2, h, profileSamples);
    } else if (geom === 'CONO_TRUNCADO_PERIMETRO') {
        const pBase = requirePositiveDim(dims, ['p', 'P', 'perimeterBaseM'], 'p');
        const pTop = requireNonNegativeDim(dims, ['pp', 'Pp', 'perimeterTopM'], 'pp');
        const h = requirePositiveDim(dims, ['h', 'heightM', 'height_m'], 'h');
        const rBase = pBase / (2 * Math.PI);
        const rTop = pTop / (2 * Math.PI);
        rawMesh = buildEllipticFrustumMesh(rBase, rBase, rTop, rTop, h, profileSamples);
    } else if (geom === 'TRONCO_PIRAMIDAL') {
        const baseLengthM = requirePositiveDim(
            dims,
            ['baseLengthM', 'base_length_m', 'lengthM', 'd1', 'a'],
            'baseLengthM'
        );
        const baseWidthM = requirePositiveDim(
            dims,
            ['baseWidthM', 'base_width_m', 'widthM', 'd2', 'b'],
            'baseWidthM'
        );
        const crestLengthM = requireNonNegativeDim(
            dims,
            ['crestLengthM', 'crest_length_m', 'topLengthM', 'd1p', 'ap'],
            'crestLengthM'
        );
        const crestWidthM = requireNonNegativeDim(
            dims,
            ['crestWidthM', 'crest_width_m', 'topWidthM', 'd2p', 'bp'],
            'crestWidthM'
        );
        const heightM = requirePositiveDim(dims, ['h', 'heightM', 'height_m'], 'heightM');
        rawMesh = buildLinearLoftFrustumMesh(
            baseLengthM,
            baseWidthM,
            crestLengthM,
            crestWidthM,
            heightM,
            profileSamples
        );
    } else if (geom === 'PILA_LONGITUDINAL_WINDROW') {
        const baseLengthM = requirePositiveDim(
            dims,
            ['baseLengthM', 'base_length_m', 'lengthM', 'd1', 'a'],
            'baseLengthM'
        );
        const baseWidthM = requirePositiveDim(
            dims,
            ['baseWidthM', 'base_width_m', 'widthM', 'd2', 'b'],
            'baseWidthM'
        );
        const heightM = requirePositiveDim(dims, ['heightM', 'height_m', 'h'], 'heightM');
        const crestLengthM = optionalNonNegativeDim(
            dims,
            ['crestLengthM', 'crest_length_m'],
            baseLengthM,
            'crestLengthM'
        );
        const crestWidthM = optionalNonNegativeDim(
            dims,
            ['crestWidthM', 'crest_width_m'],
            0,
            'crestWidthM'
        );
        rawMesh = buildLinearLoftFrustumMesh(
            baseLengthM,
            baseWidthM,
            crestLengthM,
            crestWidthM,
            heightM,
            profileSamples
        );
    } else {
        // ACOPIO_CONTRA_MURO
        const lengthM = requirePositiveDim(
            dims,
            ['lengthM', 'length_m', 'wallLengthM', 'baseLengthM', 'base_length_m'],
            'lengthM'
        );
        const widthFromWallM = requirePositiveDim(
            dims,
            ['widthFromWallM', 'width_from_wall_m', 'wallWidthM', 'baseWidthM', 'base_width_m'],
            'widthFromWallM'
        );
        const heightAtWallM = requirePositiveDim(
            dims,
            ['heightAtWallM', 'height_at_wall_m', 'heightM', 'height_m', 'h'],
            'heightAtWallM'
        );
        const wallAngleRaw = optionalNonNegativeDim(
            dims,
            ['wallAngleDeg', 'wall_angle_deg'],
            90,
            'wallAngleDeg'
        );
        const wallAngleDeg = wallAngleRaw === 0 ? 90 : wallAngleRaw;
        if (wallAngleDeg < 1 || wallAngleDeg > 90) {
            throw new Error(`wallAngleDeg fuera de rango operativo [1..90]: ${wallAngleDeg}`);
        }
        const effectiveWidthM =
            wallAngleDeg < 90
                ? widthFromWallM - heightAtWallM / Math.tan((wallAngleDeg * Math.PI) / 180)
                : widthFromWallM;
        if (!(effectiveWidthM > 0)) {
            throw new Error(
                `Ancho efectivo contra muro <= 0 (${effectiveWidthM.toFixed(3)}m) para angulo ${wallAngleDeg} deg.`
            );
        }
        rawMesh = buildWallWedgeMesh(lengthM, effectiveWidthM, heightAtWallM, profileSamples);
    }

    const physics = computeMeshPhysicsAndNormals(rawMesh);
    const glbBuffer = packGlbBuffer(
        rawMesh.positions,
        physics.normals,
        physics.indices,
        physics.boundingBoxM
    );

    const vertexCount = rawMesh.positions.length / 3;
    const triangleCount = physics.indices.length / 3;
    // Equivalente sin deduplicacion de vertices ni compresion de indices (3 vertices * (vec3 pos + vec3 norm) = 24 bytes/vertice)
    const rawUnindexedBytes = triangleCount * 3 * 24;

    return {
        glbBuffer,
        tinVolumeM3: physics.tinVolumeM3,
        surfaceAreaM2: physics.surfaceAreaM2,
        vertexCount,
        triangleCount,
        boundingBoxM: physics.boundingBoxM,
        rawUnindexedBytes,
        optimizedGlbBytes: glbBuffer.length,
    };
}

/**
 * Extrae metricas volumetricas y geometricas desde un binario glTF 2.0 `.glb` valido
 * devuelto por el servicio GPU multi-vista, validando chunks e integridad de buffers.
 */
export function inspectGlbBinaryMetrics(glbBuffer: Buffer): GlbSurfaceBuildResult {
    if (
        !Buffer.isBuffer(glbBuffer) ||
        glbBuffer.length < 28 ||
        glbBuffer.readUInt32LE(0) !== GLB_MAGIC ||
        glbBuffer.readUInt32LE(4) !== GLB_VERSION
    ) {
        throw new Error('GLB invalido: cabecera glTF 2.0 corrupta.');
    }

    const totalLen = glbBuffer.readUInt32LE(8);
    if (totalLen > glbBuffer.length) {
        throw new Error('GLB truncado respecto a su longitud declarada.');
    }

    const jsonLen = glbBuffer.readUInt32LE(12);
    const jsonType = glbBuffer.readUInt32LE(16);
    if (jsonType !== GLB_CHUNK_JSON || 20 + jsonLen + 8 > glbBuffer.length) {
        throw new Error('GLB invalido: chunk JSON ausente o truncado.');
    }

    const jsonText = glbBuffer.subarray(20, 20 + jsonLen).toString('utf8').trim();
    const doc = JSON.parse(jsonText) as any;

    const binHeaderOffset = 20 + jsonLen;
    const binLen = glbBuffer.readUInt32LE(binHeaderOffset);
    const binType = glbBuffer.readUInt32LE(binHeaderOffset + 4);
    const binDataStart = binHeaderOffset + 8;
    if (binType !== GLB_CHUNK_BIN || binDataStart + binLen > glbBuffer.length) {
        throw new Error('GLB invalido: chunk BIN ausente o truncado.');
    }

    const primitive = doc?.meshes?.[0]?.primitives?.[0];
    const posAccessorIdx = primitive?.attributes?.POSITION;
    const idxAccessorIdx = primitive?.indices;
    if (typeof posAccessorIdx !== 'number') {
        throw new Error('GLB sin accessor POSITION en primitive[0].');
    }

    const posAcc = doc.accessors?.[posAccessorIdx];
    const posView = doc.bufferViews?.[posAcc?.bufferView];
    if (!posAcc || !posView || posAcc.componentType !== 5126 || posAcc.type !== 'VEC3') {
        throw new Error('GLB accessor POSITION incompatible (se requiere FLOAT VEC3).');
    }

    const vCount = Number(posAcc.count || 0);
    const posByteOffset = binDataStart + Number(posView.byteOffset || 0) + Number(posAcc.byteOffset || 0);
    const posStride = Number(posView.byteStride || 12);
    const positions: number[] = [];
    for (let i = 0; i < vCount; i++) {
        const pOff = posByteOffset + i * posStride;
        positions.push(
            glbBuffer.readFloatLE(pOff),
            glbBuffer.readFloatLE(pOff + 4),
            glbBuffer.readFloatLE(pOff + 8)
        );
    }

    const indices: number[] = [];
    if (typeof idxAccessorIdx === 'number') {
        const idxAcc = doc.accessors?.[idxAccessorIdx];
        const idxView = doc.bufferViews?.[idxAcc?.bufferView];
        const iCount = Number(idxAcc?.count || 0);
        const iStart =
            binDataStart + Number(idxView?.byteOffset || 0) + Number(idxAcc?.byteOffset || 0);
        const compType = idxAcc?.componentType;
        const elemSize = compType === 5125 ? 4 : compType === 5123 ? 2 : 1;
        for (let i = 0; i < iCount; i++) {
            const o = iStart + i * elemSize;
            indices.push(
                compType === 5125
                    ? glbBuffer.readUInt32LE(o)
                    : compType === 5123
                    ? glbBuffer.readUInt16LE(o)
                    : glbBuffer.readUInt8(o)
            );
        }
    } else {
        for (let i = 0; i < vCount; i++) indices.push(i);
    }

    const physics = computeMeshPhysicsAndNormals({ positions, indices });
    const triangleCount = physics.indices.length / 3;
    const rawUnindexedBytes = Math.max(glbBuffer.length, triangleCount * 3 * 24);

    return {
        glbBuffer,
        tinVolumeM3: physics.tinVolumeM3,
        surfaceAreaM2: physics.surfaceAreaM2,
        vertexCount: vCount,
        triangleCount,
        boundingBoxM: physics.boundingBoxM,
        rawUnindexedBytes,
        optimizedGlbBytes: glbBuffer.length,
    };
}

/**
 * Construye de manera determinista un binario glTF 2.0 `.glb` watertight
 * desde la grilla espacial real (`SpatialSurfaceGrid`) calculada por `spatial-volume.engine.ts`:
 * - Dominio real por celda activa (elimina "carpa dentada" y expansión exterior `+2*cellSize`).
 * - Suavizado 2D Taubin sin encogimiento del contorno perimetral + interpolación solo entre celdas activas.
 * - Base nivelada en `y = 0` + faldones `emitSkirtEdgeCCW` con vértices y normales dedicados (split-edge > 45°).
 * - Atributo por vértice `COLOR_0`: RGB fotográfico real si `rgbBytes` (`nx * nz * 3`) está presente, o ANSI/ISA-101.
 * - Soporte automático `Uint32` (`5125`) cuando `vertexCount > 65535`.
 */
export function buildSpatialPointCloudGlbMesh(
    surfaceGrid: SpatialSurfaceGridInput
): GlbSurfaceBuildResult {
    const {
        originX,
        originZ,
        cellSizeM,
        nx,
        nz,
        heightsM,
        observationCount,
        interpolatedMask,
        slopeDegGrid,
        rgbBytes: rawRgbBytes,
    } = surfaceGrid;
    if (
        !Number.isFinite(cellSizeM) ||
        cellSizeM <= 0 ||
        !Number.isInteger(nx) ||
        !Number.isInteger(nz) ||
        nx < 2 ||
        nz < 2 ||
        !Array.isArray(heightsM) ||
        heightsM.length !== nx * nz
    ) {
        throw new Error('Grilla espacial invalida para construir malla .glb watertight.');
    }

    const totalCells = nx * nz;
    const activeCell = new Uint8Array(totalCells);
    let activeCellCount = 0;
    let minIx = nx;
    let maxIx = -1;
    let minIz = nz;
    let maxIz = -1;

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            const h = Math.max(0, heightsM[idx] || 0);
            if (h > GRID_H_EPS_M) {
                activeCell[idx] = 1;
                activeCellCount += 1;
                if (ix < minIx) minIx = ix;
                if (ix > maxIx) maxIx = ix;
                if (iz < minIz) minIz = iz;
                if (iz > maxIz) maxIz = iz;
            }
        }
    }

    if (activeCellCount === 0) {
        throw new Error('No hay volumen espacial suficiente sobre el plano base para malla .glb.');
    }

    const rgbBytes =
        rawRgbBytes instanceof Uint8Array && rawRgbBytes.length === totalCells * 3
            ? rawRgbBytes
            : null;

    const resolveCellColor = (vIdx: number): [number, number, number] => {
        if (rgbBytes) {
            const o = vIdx * 3;
            return [
                srgbByteToLinearGlb(rgbBytes[o]),
                srgbByteToLinearGlb(rgbBytes[o + 1]),
                srgbByteToLinearGlb(rgbBytes[o + 2]),
            ];
        }
        const isInterpolated = interpolatedMask?.[vIdx] === 1;
        const localSlope = slopeDegGrid?.[vIdx] ?? 0;
        if (isInterpolated || localSlope > 38) {
            return ISA101_COLOR_COPPER_ALERT;
        }
        const obs = observationCount?.[vIdx] ?? 0;
        if (obs >= 2) {
            return ISA101_COLOR_CYAN_VERIFIED;
        }
        return ISA101_COLOR_NEUTRAL;
    };

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let customNormals: number[] | null = null;

    if (activeCellCount === totalCells) {
        // Prisma completo sin bordes inactivos: topología nodal exacta (nx-1) x (nz-1)
        const quadRows = nz - 1;
        const quadCols = nx - 1;
        const centerX = originX + (nx - 1) * cellSizeM * 0.5;
        const centerZ = originZ + (nz - 1) * cellSizeM * 0.5;

        const topIndex = new Int32Array(totalCells).fill(-1);
        const botIndex = new Int32Array(totalCells).fill(-1);

        const ensureTopVertex = (vx: number, vz: number): number => {
            const vIdx = vz * nx + vx;
            if (topIndex[vIdx] >= 0) return topIndex[vIdx];
            const wx = originX + vx * cellSizeM;
            const wz = originZ + vz * cellSizeM;
            const h = Math.max(0, heightsM[vIdx] || 0);
            const idx = positions.length / 3;
            positions.push(wx - centerX, h, wz - centerZ);
            const c = resolveCellColor(vIdx);
            colors.push(c[0], c[1], c[2]);
            topIndex[vIdx] = idx;
            return idx;
        };

        const ensureBotVertex = (vx: number, vz: number): number => {
            const vIdx = vz * nx + vx;
            if (botIndex[vIdx] >= 0) return botIndex[vIdx];
            const wx = originX + vx * cellSizeM;
            const wz = originZ + vz * cellSizeM;
            const idx = positions.length / 3;
            positions.push(wx - centerX, 0, wz - centerZ);
            colors.push(
                ISA101_COLOR_NEUTRAL[0],
                ISA101_COLOR_NEUTRAL[1],
                ISA101_COLOR_NEUTRAL[2]
            );
            botIndex[vIdx] = idx;
            return idx;
        };

        const emitSkirtEdgeCCW = (px: number, pz: number, qx: number, qz: number) => {
            const pIdx = pz * nx + px;
            const qIdx = qz * nx + qx;
            const hP = Math.max(0, heightsM[pIdx] || 0);
            const hQ = Math.max(0, heightsM[qIdx] || 0);
            if (hP <= 1e-6 && hQ <= 1e-6) return;

            const xP = originX + px * cellSizeM - centerX;
            const zP = originZ + pz * cellSizeM - centerZ;
            const xQ = originX + qx * cellSizeM - centerX;
            const zQ = originZ + qz * cellSizeM - centerZ;

            const base = positions.length / 3;
            positions.push(xP, 0, zP, xQ, 0, zQ, xQ, hQ, zQ, xP, hP, zP);
            if (rgbBytes) {
                const cP = resolveCellColor(pIdx);
                const cQ = resolveCellColor(qIdx);
                colors.push(
                    cP[0] * 0.88,
                    cP[1] * 0.88,
                    cP[2] * 0.88,
                    cQ[0] * 0.88,
                    cQ[1] * 0.88,
                    cQ[2] * 0.88,
                    cQ[0],
                    cQ[1],
                    cQ[2],
                    cP[0],
                    cP[1],
                    cP[2]
                );
            } else {
                for (let k = 0; k < 4; k++) {
                    colors.push(
                        ISA101_COLOR_NEUTRAL[0],
                        ISA101_COLOR_NEUTRAL[1],
                        ISA101_COLOR_NEUTRAL[2]
                    );
                }
            }

            if (hQ > 1e-6) pushTriangle(indices, base, base + 1, base + 2);
            if (hP > 1e-6) pushTriangle(indices, base, base + 2, base + 3);
        };

        for (let iz = 0; iz < quadRows; iz++) {
            for (let ix = 0; ix < quadCols; ix++) {
                const tTL = ensureTopVertex(ix, iz);
                const tBL = ensureTopVertex(ix, iz + 1);
                const tBR = ensureTopVertex(ix + 1, iz + 1);
                const tTR = ensureTopVertex(ix + 1, iz);
                pushTriangle(indices, tTL, tBL, tBR);
                pushTriangle(indices, tTL, tBR, tTR);

                const bTL = ensureBotVertex(ix, iz);
                const bBL = ensureBotVertex(ix, iz + 1);
                const bBR = ensureBotVertex(ix + 1, iz + 1);
                const bTR = ensureBotVertex(ix + 1, iz);
                pushTriangle(indices, bTL, bBR, bBL);
                pushTriangle(indices, bTL, bTR, bBR);

                if (ix === 0) emitSkirtEdgeCCW(ix, iz, ix, iz + 1);
                if (iz === quadRows - 1) emitSkirtEdgeCCW(ix, iz + 1, ix + 1, iz + 1);
                if (ix === quadCols - 1) emitSkirtEdgeCCW(ix + 1, iz + 1, ix + 1, iz);
                if (iz === 0) emitSkirtEdgeCCW(ix + 1, iz, ix, iz);
            }
        }
    } else {
        // Dominio dual por celda activa: cero "carpa dentada", suavizado Taubin 2D y normales split-edge > 45°
        const rawMinX = originX + (minIx - 0.5) * cellSizeM;
        const rawMaxX = originX + (maxIx + 0.5) * cellSizeM;
        const rawMinZ = originZ + (minIz - 0.5) * cellSizeM;
        const rawMaxZ = originZ + (maxIz + 0.5) * cellSizeM;
        const centerX = (rawMinX + rawMaxX) * 0.5;
        const centerZ = (rawMinZ + rawMaxZ) * 0.5;

        const cnx = nx + 1;
        const cnz = nz + 1;
        const cornerTotal = cnx * cnz;

        const origCX = new Float64Array(cornerTotal);
        const origCZ = new Float64Array(cornerTotal);
        const cx = new Float64Array(cornerTotal);
        const cz = new Float64Array(cornerTotal);
        const cornerH = new Float64Array(cornerTotal);
        const cornerR = new Float32Array(cornerTotal);
        const cornerG = new Float32Array(cornerTotal);
        const cornerB = new Float32Array(cornerTotal);

        const cellColors = new Float32Array(totalCells * 3);
        for (let idx = 0; idx < totalCells; idx++) {
            if (!activeCell[idx]) continue;
            const c = resolveCellColor(idx);
            cellColors[idx * 3] = c[0];
            cellColors[idx * 3 + 1] = c[1];
            cellColors[idx * 3 + 2] = c[2];
        }

        for (let gz = 0; gz < cnz; gz++) {
            for (let gx = 0; gx < cnx; gx++) {
                const cIdx = gz * cnx + gx;
                const wx = originX + (gx - 0.5) * cellSizeM - centerX;
                const wz = originZ + (gz - 0.5) * cellSizeM - centerZ;
                origCX[cIdx] = wx;
                origCZ[cIdx] = wz;
                cx[cIdx] = wx;
                cz[cIdx] = wz;

                let hSum = 0;
                let rSum = 0;
                let gSum = 0;
                let bSum = 0;
                let count = 0;
                const adj: Array<[number, number]> = [
                    [gx - 1, gz - 1],
                    [gx, gz - 1],
                    [gx - 1, gz],
                    [gx, gz],
                ];
                for (const [ax, az] of adj) {
                    if (ax < 0 || ax >= nx || az < 0 || az >= nz) continue;
                    const aIdx = az * nx + ax;
                    if (!activeCell[aIdx]) continue;
                    hSum += Math.max(0, heightsM[aIdx] || 0);
                    rSum += cellColors[aIdx * 3];
                    gSum += cellColors[aIdx * 3 + 1];
                    bSum += cellColors[aIdx * 3 + 2];
                    count++;
                }
                if (count > 0) {
                    cornerH[cIdx] = hSum / count;
                    cornerR[cIdx] = rSum / count;
                    cornerG[cIdx] = gSum / count;
                    cornerB[cIdx] = bSum / count;
                }
            }
        }

        const isCellActive = (ix: number, iz: number): boolean =>
            ix >= 0 && ix < nx && iz >= 0 && iz < nz && activeCell[iz * nx + ix] === 1;

        interface GlbBoundaryEdge {
            p: number;
            q: number;
            cellIdx: number;
            nx: number;
            nz: number;
        }
        const boundaryEdges: GlbBoundaryEdge[] = [];
        const outEdgeMap = new Map<number, number[]>();
        const inEdgeMap = new Map<number, number[]>();

        const addEdge = (p: number, q: number, cellIdx: number) => {
            const eIdx = boundaryEdges.length;
            boundaryEdges.push({ p, q, cellIdx, nx: 0, nz: 0 });
            const oL = outEdgeMap.get(p);
            if (oL) oL.push(eIdx);
            else outEdgeMap.set(p, [eIdx]);
            const iL = inEdgeMap.get(q);
            if (iL) iL.push(eIdx);
            else inEdgeMap.set(q, [eIdx]);
        };

        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const idx = iz * nx + ix;
                if (!activeCell[idx]) continue;
                const cTL = iz * cnx + ix;
                const cBL = (iz + 1) * cnx + ix;
                const cBR = (iz + 1) * cnx + (ix + 1);
                const cTR = iz * cnx + (ix + 1);
                if (!isCellActive(ix - 1, iz)) addEdge(cTL, cBL, idx);
                if (!isCellActive(ix, iz + 1)) addEdge(cBL, cBR, idx);
                if (!isCellActive(ix + 1, iz)) addEdge(cBR, cTR, idx);
                if (!isCellActive(ix, iz - 1)) addEdge(cTR, cTL, idx);
            }
        }

        const manifoldVerts: Array<{ v: number; prev: number; next: number }> = [];
        for (const [v, outList] of outEdgeMap.entries()) {
            const inList = inEdgeMap.get(v);
            if (outList.length === 1 && inList && inList.length === 1) {
                const prev = boundaryEdges[inList[0]].p;
                const next = boundaryEdges[outList[0]].q;
                if (prev !== v && next !== v && prev !== next) {
                    manifoldVerts.push({ v, prev, next });
                }
            }
        }

        const maxDisp = cellSizeM * 0.36;
        const minTriArea = cellSizeM * cellSizeM * 0.04;
        const taubinWeights = [0.5, -0.515, 0.5, -0.515, 0.35, -0.36];
        const tmpX = new Float64Array(cornerTotal);
        const tmpZ = new Float64Array(cornerTotal);

        if (manifoldVerts.length >= 4) {
            for (const w of taubinWeights) {
                tmpX.set(cx);
                tmpZ.set(cz);
                for (const { v, prev, next } of manifoldVerts) {
                    const midX = 0.5 * (cx[prev] + cx[next]);
                    const midZ = 0.5 * (cz[prev] + cz[next]);
                    let nxPos = cx[v] + w * (midX - cx[v]);
                    let nzPos = cz[v] + w * (midZ - cz[v]);
                    const dx0 = nxPos - origCX[v];
                    const dz0 = nzPos - origCZ[v];
                    const d0 = Math.hypot(dx0, dz0);
                    if (d0 > maxDisp) {
                        const s = maxDisp / d0;
                        nxPos = origCX[v] + dx0 * s;
                        nzPos = origCZ[v] + dz0 * s;
                    }
                    tmpX[v] = nxPos;
                    tmpZ[v] = nzPos;
                }
                for (let iz = 0; iz < nz; iz++) {
                    for (let ix = 0; ix < nx; ix++) {
                        if (!activeCell[iz * nx + ix]) continue;
                        const cellX = originX + ix * cellSizeM - centerX;
                        const cellZ = originZ + iz * cellSizeM - centerZ;
                        const cTL = iz * cnx + ix;
                        const cBL = (iz + 1) * cnx + ix;
                        const cBR = (iz + 1) * cnx + (ix + 1);
                        const cTR = iz * cnx + (ix + 1);
                        const a1 = signedTriArea2DGlb(cellX, cellZ, tmpX[cTL], tmpZ[cTL], tmpX[cBL], tmpZ[cBL]);
                        const a2 = signedTriArea2DGlb(cellX, cellZ, tmpX[cBL], tmpZ[cBL], tmpX[cBR], tmpZ[cBR]);
                        const a3 = signedTriArea2DGlb(cellX, cellZ, tmpX[cBR], tmpZ[cBR], tmpX[cTR], tmpZ[cTR]);
                        const a4 = signedTriArea2DGlb(cellX, cellZ, tmpX[cTR], tmpZ[cTR], tmpX[cTL], tmpZ[cTL]);
                        if (a1 < minTriArea || a2 < minTriArea || a3 < minTriArea || a4 < minTriArea) {
                            tmpX[cTL] = cx[cTL];
                            tmpZ[cTL] = cz[cTL];
                            tmpX[cBL] = cx[cBL];
                            tmpZ[cBL] = cz[cBL];
                            tmpX[cBR] = cx[cBR];
                            tmpZ[cBR] = cz[cBR];
                            tmpX[cTR] = cx[cTR];
                            tmpZ[cTR] = cz[cTR];
                        }
                    }
                }
                cx.set(tmpX);
                cz.set(tmpZ);
            }
        }

        const normals: number[] = [];
        const topCornerVert = new Int32Array(cornerTotal).fill(-1);
        const botCornerVert = new Int32Array(cornerTotal).fill(-1);

        const ensureTopCorner = (cIdx: number): number => {
            if (topCornerVert[cIdx] >= 0) return topCornerVert[cIdx];
            const vIdx = positions.length / 3;
            positions.push(cx[cIdx], cornerH[cIdx], cz[cIdx]);
            normals.push(0, 0, 0);
            colors.push(cornerR[cIdx], cornerG[cIdx], cornerB[cIdx]);
            topCornerVert[cIdx] = vIdx;
            return vIdx;
        };

        const ensureBotCorner = (cIdx: number): number => {
            if (botCornerVert[cIdx] >= 0) return botCornerVert[cIdx];
            const vIdx = positions.length / 3;
            positions.push(cx[cIdx], 0, cz[cIdx]);
            normals.push(0, -1, 0);
            colors.push(
                ISA101_COLOR_NEUTRAL[0],
                ISA101_COLOR_NEUTRAL[1],
                ISA101_COLOR_NEUTRAL[2]
            );
            botCornerVert[cIdx] = vIdx;
            return vIdx;
        };

        // Superficie superior (+Y CCW)
        const topTriStart = 0;
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const idx = iz * nx + ix;
                if (!activeCell[idx]) continue;
                const vTL = ensureTopCorner(iz * cnx + ix);
                const vBL = ensureTopCorner((iz + 1) * cnx + ix);
                const vBR = ensureTopCorner((iz + 1) * cnx + (ix + 1));
                const vTR = ensureTopCorner(iz * cnx + (ix + 1));

                const cellX = originX + ix * cellSizeM - centerX;
                const cellZ = originZ + iz * cellSizeM - centerZ;
                const vCenter = positions.length / 3;
                positions.push(cellX, Math.max(0, heightsM[idx] || 0), cellZ);
                normals.push(0, 0, 0);
                colors.push(
                    cellColors[idx * 3],
                    cellColors[idx * 3 + 1],
                    cellColors[idx * 3 + 2]
                );

                pushTriangle(indices, vCenter, vTL, vBL);
                pushTriangle(indices, vCenter, vBL, vBR);
                pushTriangle(indices, vCenter, vBR, vTR);
                pushTriangle(indices, vCenter, vTR, vTL);
            }
        }
        const topTriEnd = indices.length;
        const topVertEnd = positions.length / 3;

        for (let t = topTriStart; t < topTriEnd; t += 3) {
            const i0 = indices[t];
            const i1 = indices[t + 1];
            const i2 = indices[t + 2];
            const ax = positions[i0 * 3],
                ay = positions[i0 * 3 + 1],
                az = positions[i0 * 3 + 2];
            const ux = positions[i1 * 3] - ax,
                uy = positions[i1 * 3 + 1] - ay,
                uz = positions[i1 * 3 + 2] - az;
            const vx = positions[i2 * 3] - ax,
                vy = positions[i2 * 3 + 1] - ay,
                vz = positions[i2 * 3 + 2] - az;
            const nxT = uy * vz - uz * vy;
            const nyT = uz * vx - ux * vz;
            const nzT = ux * vy - uy * vx;
            for (const vi of [i0, i1, i2]) {
                normals[vi * 3] += nxT;
                normals[vi * 3 + 1] += nyT;
                normals[vi * 3 + 2] += nzT;
            }
        }
        for (let v = 0; v < topVertEnd; v++) {
            const len = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
            if (len > 1e-12) {
                normals[v * 3] /= len;
                normals[v * 3 + 1] /= len;
                normals[v * 3 + 2] /= len;
            } else {
                normals[v * 3] = 0;
                normals[v * 3 + 1] = 1;
                normals[v * 3 + 2] = 0;
            }
        }

        // Base cerrada en y = 0 (-Y CCW)
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const idx = iz * nx + ix;
                if (!activeCell[idx]) continue;
                const bTL = ensureBotCorner(iz * cnx + ix);
                const bBL = ensureBotCorner((iz + 1) * cnx + ix);
                const bBR = ensureBotCorner((iz + 1) * cnx + (ix + 1));
                const bTR = ensureBotCorner(iz * cnx + (ix + 1));

                const cellX = originX + ix * cellSizeM - centerX;
                const cellZ = originZ + iz * cellSizeM - centerZ;
                const bCenter = positions.length / 3;
                positions.push(cellX, 0, cellZ);
                normals.push(0, -1, 0);
                colors.push(
                    ISA101_COLOR_NEUTRAL[0],
                    ISA101_COLOR_NEUTRAL[1],
                    ISA101_COLOR_NEUTRAL[2]
                );

                pushTriangle(indices, bCenter, bBL, bTL);
                pushTriangle(indices, bCenter, bBR, bBL);
                pushTriangle(indices, bCenter, bTR, bBR);
                pushTriangle(indices, bCenter, bTL, bTR);
            }
        }

        // Faldones perimetrales `emitSkirtEdgeCCW` con normales dedicadas split-edge > 45°
        for (const edge of boundaryEdges) {
            const dx = cx[edge.q] - cx[edge.p];
            const dz = cz[edge.q] - cz[edge.p];
            const len = Math.hypot(dx, dz) || 1;
            edge.nx = -dz / len;
            edge.nz = dx / len;
        }

        const resolveSeamNormal = (
            edge: GlbBoundaryEdge,
            cornerIdx: number,
            isStart: boolean
        ): [number, number] => {
            const adjList = isStart ? inEdgeMap.get(cornerIdx) : outEdgeMap.get(cornerIdx);
            if (!adjList || adjList.length !== 1) return [edge.nx, edge.nz];
            const adjEdge = boundaryEdges[adjList[0]];
            const dot = edge.nx * adjEdge.nx + edge.nz * adjEdge.nz;
            if (dot < SPLIT_EDGE_COS_45) return [edge.nx, edge.nz];
            const sx = edge.nx + adjEdge.nx;
            const sz = edge.nz + adjEdge.nz;
            const slen = Math.hypot(sx, sz);
            return slen > 1e-8 ? [sx / slen, sz / slen] : [edge.nx, edge.nz];
        };

        const emitSkirtEdgeCCW = (edge: GlbBoundaryEdge) => {
            const hP = Math.max(0, cornerH[edge.p]);
            const hQ = Math.max(0, cornerH[edge.q]);
            if (hP <= 1e-6 && hQ <= 1e-6) return;

            const [nPx, nPz] = resolveSeamNormal(edge, edge.p, true);
            const [nQx, nQz] = resolveSeamNormal(edge, edge.q, false);

            const base = positions.length / 3;
            positions.push(
                cx[edge.p],
                0,
                cz[edge.p],
                cx[edge.q],
                0,
                cz[edge.q],
                cx[edge.q],
                hQ,
                cz[edge.q],
                cx[edge.p],
                hP,
                cz[edge.p]
            );
            normals.push(nPx, 0, nPz, nQx, 0, nQz, nQx, 0, nQz, nPx, 0, nPz);

            if (rgbBytes) {
                const cOff = edge.cellIdx * 3;
                const r = cellColors[cOff];
                const g = cellColors[cOff + 1];
                const b = cellColors[cOff + 2];
                colors.push(
                    r * 0.88,
                    g * 0.88,
                    b * 0.88,
                    r * 0.88,
                    g * 0.88,
                    b * 0.88,
                    r,
                    g,
                    b,
                    r,
                    g,
                    b
                );
            } else {
                for (let k = 0; k < 4; k++) {
                    colors.push(
                        ISA101_COLOR_NEUTRAL[0],
                        ISA101_COLOR_NEUTRAL[1],
                        ISA101_COLOR_NEUTRAL[2]
                    );
                }
            }

            if (hQ > 1e-6) pushTriangle(indices, base, base + 1, base + 2);
            if (hP > 1e-6) pushTriangle(indices, base, base + 2, base + 3);
        };

        for (const edge of boundaryEdges) {
            emitSkirtEdgeCCW(edge);
        }
        customNormals = normals;
    }

    const physics = computeMeshPhysicsAndNormals({ positions, indices });
    const finalNormals =
        customNormals && customNormals.length === positions.length
            ? customNormals
            : physics.normals;
    const glbBuffer = packGlbBuffer(
        positions,
        finalNormals,
        physics.indices,
        physics.boundingBoxM,
        colors
    );

    const vertexCount = positions.length / 3;
    const triangleCount = physics.indices.length / 3;
    const rawUnindexedBytes = triangleCount * 3 * 24;

    return {
        glbBuffer,
        tinVolumeM3: physics.tinVolumeM3,
        surfaceAreaM2: physics.surfaceAreaM2,
        vertexCount,
        triangleCount,
        boundingBoxM: physics.boundingBoxM,
        rawUnindexedBytes,
        optimizedGlbBytes: glbBuffer.length,
    };
}
