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
            lengthM: round3(maxX - minX),
            heightM: round3(maxY - minY),
            widthM: round3(maxZ - minZ),
        },
    };
}

function packGlbBuffer(
    positions: number[],
    normals: number[],
    indices: number[],
    bbox: GlbBoundingBoxM
): Buffer {
    const vertexCount = positions.length / 3;
    const indexCount = indices.length;
    if (vertexCount > 65535) {
        throw new Error(`Malla excede limite Uint16 glTF (${vertexCount} > 65535).`);
    }

    const posFloat = new Float32Array(positions);
    const normFloat = new Float32Array(normals);
    const idxUint16 = new Uint16Array(indices);

    const posBytes = Buffer.from(posFloat.buffer, posFloat.byteOffset, posFloat.byteLength);
    const normBytes = Buffer.from(normFloat.buffer, normFloat.byteOffset, normFloat.byteLength);
    const idxBytes = Buffer.from(idxUint16.buffer, idxUint16.byteOffset, idxUint16.byteLength);

    const rawBinLength = posBytes.length + normBytes.length + idxBytes.length;
    const binPad = (4 - (rawBinLength % 4)) % 4;
    const binPaddedLength = rawBinLength + binPad;

    const gltfJson = {
        asset: {
            version: '2.0',
            generator: 'MINREPORT-GEOLAPP-TIN-BUILDER-southamerica-west1',
        },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'StockpileTinMesh' }],
        meshes: [
            {
                name: 'StockpileSurface',
                primitives: [
                    {
                        attributes: {
                            POSITION: 0,
                            NORMAL: 1,
                        },
                        indices: 2,
                        material: 0,
                    },
                ],
            },
        ],
        materials: [
            {
                name: 'MinreportCopperOreMat',
                doubleSided: false,
                pbrMetallicRoughness: {
                    baseColorFactor: [0.7765, 0.5137, 0.2745, 1.0],
                    metallicFactor: 0.15,
                    roughnessFactor: 0.85,
                },
            },
        ],
        buffers: [{ byteLength: binPaddedLength }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
            { buffer: 0, byteOffset: posBytes.length, byteLength: normBytes.length, target: 34962 },
            {
                buffer: 0,
                byteOffset: posBytes.length + normBytes.length,
                byteLength: idxBytes.length,
                target: 34963,
            },
        ],
        accessors: [
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
            {
                bufferView: 2,
                componentType: 5123,
                count: indexCount,
                type: 'SCALAR',
            },
        ],
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
    idxBytes.copy(glb, offset);
    offset += idxBytes.length;
    for (let i = 0; i < binPad; i++) {
        glb.writeUInt8(0x00, offset++);
    }

    return glb;
}

/**
 * Construye de manera determinista en Node.js (sin WebGL/navegador) un binario glTF 2.0 `.glb`
 * watertight para cualquiera de las 5 geometrias oficiales de GEOLAPP®.
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
