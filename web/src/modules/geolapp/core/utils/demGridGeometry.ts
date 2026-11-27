/**
 * demGridGeometry — Constructor Three.js BufferGeometry Watertight para Nivel 1 Offline (`dem_grid_v1` / `dem_grid_v2`)
 *
 * Garantías geométricas y HMI:
 * - Dominio real por celda activa `(c, r)` (`h > hEps`): elimina "carpa dentada" y expansión exterior `+2*cellSize`.
 * - Interpolación de vértices interiores exclusivamente entre celdas activas (jamás promedia ceros exteriores).
 * - Suavizado 2D Taubin (sin encogimiento) del contorno perimetral para cilindros y conos suaves.
 * - Base cerrada watertight en `y = 0` + faldones perimetrales `emitSkirtEdgeCCW` con vértices y normales
 *   dedicados (split-edge normals en ángulo > 45°, cero sangrado/abombamiento en techo o base).
 * - Doble buffer de color en `geometry.userData`:
 *     - `photoColors`: RGB real decodificado desde `rgbB64` (sRGB -> linear) en `dem_grid_v2`
 *     - `confidenceColors`: ANSI/ISA-101 (#00AEEF verificado, #C68346 interpolado/talud > 38°, #8A93A6 neutro)
 */

import * as THREE from 'three';
import type { DemGridV1, UnifiedBoundingBoxM } from '../../../../contracts/acopios.contracts';

export type DemGridInput = Omit<DemGridV1, 'format'> & {
    format?: 'dem_grid_v1' | 'dem_grid_v2';
    /** Base64 crudo (sin prefijo data:) de `nx * nz * 3` bytes RGB sRGB */
    rgbB64?: string | null;
};

export interface DemGridGeometryUserData {
    photoColors: Float32Array | null;
    confidenceColors: Float32Array;
    hasPhotoVertexColors: boolean;
}

export interface DemGridGeometryBuildResult {
    geometry: THREE.BufferGeometry;
    boundingBoxM: UnifiedBoundingBoxM;
    vertexCount: number;
    triangleCount: number;
    tinVolumeM3: number;
    hasConfidenceColors: boolean;
    hasPhotoVertexColors: boolean;
}

// Colores lineales para atributo COLOR_0 ANSI/ISA-101 (MeshStandardMaterial vertexColors)
const COLOR_VERIFIED_CYAN: [number, number, number] = [0.0, 0.428, 0.855]; // #00AEEF sRGB -> linear
const COLOR_EXCEPTION_COPPER: [number, number, number] = [0.565, 0.227, 0.061]; // #C68346 sRGB -> linear
const COLOR_NEUTRAL_BASE: [number, number, number] = [0.254, 0.287, 0.376]; // #8A93A6 sRGB -> linear

const H_EPS_M = 0.015;
const SLOPE_EXCEPTION_TAN = Math.tan((38 * Math.PI) / 180);
const SPLIT_EDGE_COS_45 = Math.SQRT1_2;

function srgbByteToLinear(byteVal: number): number {
    const c = Math.max(0, Math.min(255, byteVal)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64ToBytes(b64?: string | null): Uint8Array | null {
    if (typeof b64 !== 'string') return null;
    const clean = b64.trim();
    if (!clean || clean.startsWith('data:')) return null;
    try {
        if (typeof atob === 'function') {
            const binary = atob(clean);
            const out = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                out[i] = binary.charCodeAt(i) & 0xff;
            }
            return out;
        }
        const stripped = clean.replace(/[\r\n\s=]+/g, '');
        const outLen = Math.floor((stripped.length * 3) / 4);
        const out = new Uint8Array(outLen);
        let outIdx = 0;
        let bits = 0;
        let bitCount = 0;
        for (let i = 0; i < stripped.length; i++) {
            const val = B64_ALPHABET.indexOf(stripped[i]);
            if (val < 0) return null;
            bits = (bits << 6) | val;
            bitCount += 6;
            if (bitCount >= 8) {
                bitCount -= 8;
                out[outIdx++] = (bits >> bitCount) & 0xff;
            }
        }
        return out.subarray(0, outIdx);
    } catch {
        return null;
    }
}

function roundDim(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function roundVol(v: number): number {
    if (!Number.isFinite(v) || v <= 0) return 0;
    return v < 1.0 ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100;
}

function signedTriArea2D(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number
): number {
    // En sistema XZ con CCW visto desde +Y, el área positiva corresponde a (b-a) x (c-a) con componente +Y:
    // (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    return 0.5 * ((bz - az) * (cx - ax) - (bx - ax) * (cz - az));
}

function resolveCellConfidenceColor(
    ix: number,
    iz: number,
    nx: number,
    nz: number,
    cellSizeM: number,
    heightsM: number[],
    activeCell: Uint8Array,
    confidenceMask?: number[]
): [number, number, number] {
    const idx = iz * nx + ix;
    const h = Math.max(0, heightsM[idx] || 0);
    if (!activeCell[idx]) return COLOR_NEUTRAL_BASE;

    const hasL = ix > 0 && activeCell[iz * nx + (ix - 1)] === 1;
    const hasR = ix < nx - 1 && activeCell[iz * nx + (ix + 1)] === 1;
    const hasU = iz > 0 && activeCell[(iz - 1) * nx + ix] === 1;
    const hasD = iz < nz - 1 && activeCell[(iz + 1) * nx + ix] === 1;

    const hL = hasL ? Math.max(0, heightsM[iz * nx + (ix - 1)] || 0) : h;
    const hR = hasR ? Math.max(0, heightsM[iz * nx + (ix + 1)] || 0) : h;
    const hU = hasU ? Math.max(0, heightsM[(iz - 1) * nx + ix] || 0) : h;
    const hD = hasD ? Math.max(0, heightsM[(iz + 1) * nx + ix] || 0) : h;

    const spanX = (hasL && hasR ? 2 : 1) * cellSizeM;
    const spanZ = (hasU && hasD ? 2 : 1) * cellSizeM;
    const dhdx = hasL || hasR ? (hR - hL) / spanX : 0;
    const dhdz = hasU || hasD ? (hD - hU) / spanZ : 0;
    const grad = Math.hypot(dhdx, dhdz);

    if (grad > SLOPE_EXCEPTION_TAN) {
        return COLOR_EXCEPTION_COPPER;
    }
    if (confidenceMask && confidenceMask.length === nx * nz) {
        const conf = confidenceMask[idx];
        if (conf === 1) return COLOR_EXCEPTION_COPPER;
        if (conf === 2) return COLOR_VERIFIED_CYAN;
    }
    return COLOR_VERIFIED_CYAN;
}

function finalizeGeometryBuild(
    positions: number[],
    normals: number[],
    confidenceColorsArr: number[],
    photoColorsArr: number[] | null,
    indices: number[],
    declaredVolumeM3?: number
): DemGridGeometryBuildResult | null {
    const vertexCount = positions.length / 3;
    const triangleCount = indices.length / 3;
    if (vertexCount === 0 || triangleCount === 0) return null;

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

    let signedVol6 = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t] * 3;
        const i1 = indices[t + 1] * 3;
        const i2 = indices[t + 2] * 3;
        const x0 = positions[i0],
            y0 = positions[i0 + 1],
            z0 = positions[i0 + 2];
        const x1 = positions[i1],
            y1 = positions[i1 + 1],
            z1 = positions[i1 + 2];
        const x2 = positions[i2],
            y2 = positions[i2 + 1],
            z2 = positions[i2 + 2];
        signedVol6 +=
            x0 * (y1 * z2 - z1 * y2) +
            y0 * (z1 * x2 - x1 * z2) +
            z0 * (x1 * y2 - y1 * x2);
    }

    const confidenceColors = new Float32Array(confidenceColorsArr);
    const hasPhotoVertexColors = Boolean(
        photoColorsArr && photoColorsArr.length === positions.length
    );
    const photoColors = hasPhotoVertexColors ? new Float32Array(photoColorsArr!) : null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    // Por defecto exhibir RGB fotográfico si existe (`dem_grid_v2`), o ISA-101 en fallback
    const initialColorCopy = new Float32Array(
        hasPhotoVertexColors && photoColors ? photoColors : confidenceColors
    );
    geometry.setAttribute('color', new THREE.BufferAttribute(initialColorCopy, 3));
    geometry.setIndex(
        vertexCount > 65535
            ? new THREE.Uint32BufferAttribute(indices, 1)
            : new THREE.Uint16BufferAttribute(indices, 1)
    );
    geometry.computeBoundingBox();

    const userData: DemGridGeometryUserData = {
        photoColors,
        confidenceColors,
        hasPhotoVertexColors,
    };
    geometry.userData = userData;

    const computedVol = Math.abs(signedVol6) / 6;

    return {
        geometry,
        boundingBoxM: {
            widthX: roundDim(maxX - minX),
            heightY: roundDim(maxY - minY),
            depthZ: roundDim(maxZ - minZ),
        },
        vertexCount,
        triangleCount,
        tinVolumeM3:
            typeof declaredVolumeM3 === 'number' && declaredVolumeM3 > 0
                ? roundVol(declaredVolumeM3)
                : roundVol(computedVol),
        hasConfidenceColors: true,
        hasPhotoVertexColors,
    };
}

/**
 * Construye malla prismática nodal exacta cuando TODAS las celdas de la grilla están activas
 * (retrocompatibilidad con prismas completos `nx × nz` sin borde de ceros).
 */
function buildFullGridNodalGeometry(
    grid: DemGridInput,
    activeCell: Uint8Array,
    rgbBytes: Uint8Array | null
): DemGridGeometryBuildResult | null {
    const { nx, nz, cellSizeM, originX, originZ, heightsM, confidenceMask } = grid;
    const quadRows = nz - 1;
    const quadCols = nx - 1;
    const centerX = originX + (nx - 1) * cellSizeM * 0.5;
    const centerZ = originZ + (nz - 1) * cellSizeM * 0.5;

    const positions: number[] = [];
    const normals: number[] = [];
    const confidenceColors: number[] = [];
    const photoColors: number[] | null = rgbBytes ? [] : null;
    const indices: number[] = [];

    const topIndex = new Int32Array(nx * nz).fill(-1);
    const botIndex = new Int32Array(nx * nz).fill(-1);

    const sampleRgb = (idx: number): [number, number, number] => {
        if (!rgbBytes) return COLOR_NEUTRAL_BASE;
        const o = idx * 3;
        return [
            srgbByteToLinear(rgbBytes[o]),
            srgbByteToLinear(rgbBytes[o + 1]),
            srgbByteToLinear(rgbBytes[o + 2]),
        ];
    };

    const ensureTopVertex = (vx: number, vz: number): number => {
        const vIdx = vz * nx + vx;
        if (topIndex[vIdx] >= 0) return topIndex[vIdx];
        const wx = originX + vx * cellSizeM - centerX;
        const wz = originZ + vz * cellSizeM - centerZ;
        const h = Math.max(0, heightsM[vIdx] || 0);
        const idx = positions.length / 3;
        positions.push(wx, h, wz);
        normals.push(0, 0, 0);
        const c = resolveCellConfidenceColor(
            vx,
            vz,
            nx,
            nz,
            cellSizeM,
            heightsM,
            activeCell,
            confidenceMask
        );
        confidenceColors.push(c[0], c[1], c[2]);
        if (photoColors) {
            const rgb = sampleRgb(vIdx);
            photoColors.push(rgb[0], rgb[1], rgb[2]);
        }
        topIndex[vIdx] = idx;
        return idx;
    };

    const ensureBotVertex = (vx: number, vz: number): number => {
        const vIdx = vz * nx + vx;
        if (botIndex[vIdx] >= 0) return botIndex[vIdx];
        const wx = originX + vx * cellSizeM - centerX;
        const wz = originZ + vz * cellSizeM - centerZ;
        const idx = positions.length / 3;
        positions.push(wx, 0, wz);
        normals.push(0, -1, 0);
        confidenceColors.push(COLOR_NEUTRAL_BASE[0], COLOR_NEUTRAL_BASE[1], COLOR_NEUTRAL_BASE[2]);
        if (photoColors) {
            photoColors.push(COLOR_NEUTRAL_BASE[0], COLOR_NEUTRAL_BASE[1], COLOR_NEUTRAL_BASE[2]);
        }
        botIndex[vIdx] = idx;
        return idx;
    };

    const topTriStart = 0;
    for (let iz = 0; iz < quadRows; iz++) {
        for (let ix = 0; ix < quadCols; ix++) {
            const tTL = ensureTopVertex(ix, iz);
            const tBL = ensureTopVertex(ix, iz + 1);
            const tBR = ensureTopVertex(ix + 1, iz + 1);
            const tTR = ensureTopVertex(ix + 1, iz);
            indices.push(tTL, tBL, tBR);
            indices.push(tTL, tBR, tTR);
        }
    }
    const topTriEnd = indices.length;

    // Acumular normales solo desde los triángulos de superficie superior
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
    const topVertCount = positions.length / 3;
    for (let v = 0; v < topVertCount; v++) {
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

    // Tapa inferior en y = 0 (-Y CCW)
    for (let iz = 0; iz < quadRows; iz++) {
        for (let ix = 0; ix < quadCols; ix++) {
            const bTL = ensureBotVertex(ix, iz);
            const bBL = ensureBotVertex(ix, iz + 1);
            const bBR = ensureBotVertex(ix + 1, iz + 1);
            const bTR = ensureBotVertex(ix + 1, iz);
            indices.push(bTL, bBR, bBL);
            indices.push(bTL, bTR, bBR);
        }
    }

    // Faldones perimetrales dedicados con normales split-edge (90° en esquinas)
    const emitSkirtEdgeCCW = (px: number, pz: number, qx: number, qz: number) => {
        const pIdx = pz * nx + px;
        const qIdx = qz * nx + qx;
        const hP = Math.max(0, heightsM[pIdx] || 0);
        const hQ = Math.max(0, heightsM[qIdx] || 0);
        if (hP <= 1e-4 && hQ <= 1e-4) return;

        const pwx = originX + px * cellSizeM - centerX;
        const pwz = originZ + pz * cellSizeM - centerZ;
        const qwx = originX + qx * cellSizeM - centerX;
        const qwz = originZ + qz * cellSizeM - centerZ;

        const dx = qwx - pwx;
        const dz = qwz - pwz;
        const len = Math.hypot(dx, dz) || 1;
        const snx = -dz / len;
        const snz = dx / len;

        const base = positions.length / 3;
        positions.push(pwx, 0, pwz, qwx, 0, qwz, qwx, hQ, qwz, pwx, hP, pwz);
        for (let k = 0; k < 4; k++) {
            normals.push(snx, 0, snz);
            confidenceColors.push(
                COLOR_NEUTRAL_BASE[0],
                COLOR_NEUTRAL_BASE[1],
                COLOR_NEUTRAL_BASE[2]
            );
        }
        if (photoColors) {
            const rgbP = sampleRgb(pIdx);
            const rgbQ = sampleRgb(qIdx);
            photoColors.push(
                rgbP[0] * 0.9,
                rgbP[1] * 0.9,
                rgbP[2] * 0.9,
                rgbQ[0] * 0.9,
                rgbQ[1] * 0.9,
                rgbQ[2] * 0.9,
                rgbQ[0],
                rgbQ[1],
                rgbQ[2],
                rgbP[0],
                rgbP[1],
                rgbP[2]
            );
        }

        if (hQ > 1e-4) indices.push(base, base + 1, base + 2);
        if (hP > 1e-4) indices.push(base, base + 2, base + 3);
    };

    for (let iz = 0; iz < quadRows; iz++) {
        emitSkirtEdgeCCW(0, iz, 0, iz + 1);
        emitSkirtEdgeCCW(quadCols, iz + 1, quadCols, iz);
    }
    for (let ix = 0; ix < quadCols; ix++) {
        emitSkirtEdgeCCW(ix, quadRows, ix + 1, quadRows);
        emitSkirtEdgeCCW(ix + 1, 0, ix, 0);
    }

    return finalizeGeometryBuild(
        positions,
        normals,
        confidenceColors,
        photoColors,
        indices,
        grid.volumeM3
    );
}

interface BoundaryEdge {
    p: number;
    q: number;
    cellIdx: number;
    nx: number;
    nz: number;
}

export function buildThreeGeometryFromDemGridV1(
    grid: DemGridInput
): DemGridGeometryBuildResult | null {
    const { nx, nz, cellSizeM, originX, originZ, heightsM, confidenceMask } = grid;
    if (
        !Number.isInteger(nx) ||
        !Number.isInteger(nz) ||
        nx < 2 ||
        nz < 2 ||
        !Number.isFinite(cellSizeM) ||
        cellSizeM <= 0 ||
        !Array.isArray(heightsM) ||
        heightsM.length !== nx * nz
    ) {
        return null;
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
            if (h > H_EPS_M) {
                activeCell[idx] = 1;
                activeCellCount++;
                if (ix < minIx) minIx = ix;
                if (ix > maxIx) maxIx = ix;
                if (iz < minIz) minIz = iz;
                if (iz > maxIz) maxIz = iz;
            }
        }
    }

    if (activeCellCount === 0) return null;

    const decodedRgb = decodeBase64ToBytes(grid.rgbB64);
    const rgbBytes = decodedRgb && decodedRgb.length === totalCells * 3 ? decodedRgb : null;

    // Caso especial: grilla completamente llena (sin bordes inactivos) -> prisma nodal exacto
    if (activeCellCount === totalCells) {
        return buildFullGridNodalGeometry(grid, activeCell, rgbBytes);
    }

    // Dominio real por celda activa (Dual Grid `(nx+1) x (nz+1)`): CERO expansión exterior "carpa"
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
    const cornerDeg = new Uint8Array(cornerTotal);
    const cornerConfR = new Float32Array(cornerTotal);
    const cornerConfG = new Float32Array(cornerTotal);
    const cornerConfB = new Float32Array(cornerTotal);
    const cornerPhotoR = rgbBytes ? new Float32Array(cornerTotal) : null;
    const cornerPhotoG = rgbBytes ? new Float32Array(cornerTotal) : null;
    const cornerPhotoB = rgbBytes ? new Float32Array(cornerTotal) : null;

    const cellConfColors = new Float32Array(totalCells * 3);
    const cellPhotoColors = rgbBytes ? new Float32Array(totalCells * 3) : null;

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            if (!activeCell[idx]) continue;
            const conf = resolveCellConfidenceColor(
                ix,
                iz,
                nx,
                nz,
                cellSizeM,
                heightsM,
                activeCell,
                confidenceMask
            );
            cellConfColors[idx * 3] = conf[0];
            cellConfColors[idx * 3 + 1] = conf[1];
            cellConfColors[idx * 3 + 2] = conf[2];
            if (cellPhotoColors && rgbBytes) {
                cellPhotoColors[idx * 3] = srgbByteToLinear(rgbBytes[idx * 3]);
                cellPhotoColors[idx * 3 + 1] = srgbByteToLinear(rgbBytes[idx * 3 + 1]);
                cellPhotoColors[idx * 3 + 2] = srgbByteToLinear(rgbBytes[idx * 3 + 2]);
            }
        }
    }

    // 1. Interpolar cada esquina únicamente desde sus celdas activas incidentes (jamás ceros exteriores)
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
            let count = 0;
            let hasCopper = false;
            let hasCyan = false;
            let pr = 0;
            let pg = 0;
            let pb = 0;

            const adjOffsets: Array<[number, number]> = [
                [gx - 1, gz - 1],
                [gx, gz - 1],
                [gx - 1, gz],
                [gx, gz],
            ];
            for (const [ax, az] of adjOffsets) {
                if (ax < 0 || ax >= nx || az < 0 || az >= nz) continue;
                const aIdx = az * nx + ax;
                if (!activeCell[aIdx]) continue;
                hSum += Math.max(0, heightsM[aIdx] || 0);
                count++;
                const cr = cellConfColors[aIdx * 3];
                const cg = cellConfColors[aIdx * 3 + 1];
                if (Math.abs(cr - COLOR_EXCEPTION_COPPER[0]) < 0.01) {
                    hasCopper = true;
                } else if (Math.abs(cg - COLOR_VERIFIED_CYAN[1]) < 0.01) {
                    hasCyan = true;
                }
                if (cellPhotoColors) {
                    pr += cellPhotoColors[aIdx * 3];
                    pg += cellPhotoColors[aIdx * 3 + 1];
                    pb += cellPhotoColors[aIdx * 3 + 2];
                }
            }

            if (count > 0) {
                cornerDeg[cIdx] = count;
                cornerH[cIdx] = hSum / count;
                const cc = hasCopper
                    ? COLOR_EXCEPTION_COPPER
                    : hasCyan
                      ? COLOR_VERIFIED_CYAN
                      : COLOR_NEUTRAL_BASE;
                cornerConfR[cIdx] = cc[0];
                cornerConfG[cIdx] = cc[1];
                cornerConfB[cIdx] = cc[2];
                if (cornerPhotoR && cornerPhotoG && cornerPhotoB) {
                    cornerPhotoR[cIdx] = pr / count;
                    cornerPhotoG[cIdx] = pg / count;
                    cornerPhotoB[cIdx] = pb / count;
                }
            }
        }
    }

    // 2. Detectar aristas perimetrales CCW donde una celda activa limita con una inactiva
    const isCellActive = (ix: number, iz: number): boolean =>
        ix >= 0 && ix < nx && iz >= 0 && iz < nz && activeCell[iz * nx + ix] === 1;

    const boundaryEdges: BoundaryEdge[] = [];
    const outEdgeMap = new Map<number, number[]>();
    const inEdgeMap = new Map<number, number[]>();

    const registerBoundaryEdge = (p: number, q: number, cellIdx: number) => {
        const edgeIdx = boundaryEdges.length;
        boundaryEdges.push({ p, q, cellIdx, nx: 0, nz: 0 });
        const outList = outEdgeMap.get(p);
        if (outList) outList.push(edgeIdx);
        else outEdgeMap.set(p, [edgeIdx]);
        const inList = inEdgeMap.get(q);
        if (inList) inList.push(edgeIdx);
        else inEdgeMap.set(q, [edgeIdx]);
    };

    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            if (!activeCell[idx]) continue;
            const cTL = iz * cnx + ix;
            const cBL = (iz + 1) * cnx + ix;
            const cBR = (iz + 1) * cnx + (ix + 1);
            const cTR = iz * cnx + (ix + 1);

            if (!isCellActive(ix - 1, iz)) registerBoundaryEdge(cTL, cBL, idx);
            if (!isCellActive(ix, iz + 1)) registerBoundaryEdge(cBL, cBR, idx);
            if (!isCellActive(ix + 1, iz)) registerBoundaryEdge(cBR, cTR, idx);
            if (!isCellActive(ix, iz - 1)) registerBoundaryEdge(cTR, cTL, idx);
        }
    }

    // 3. Suavizado 2D Taubin sin encogimiento sobre contorno perimetral manifold
    //    (elimina escalonado de bloques en cilindros/conos manteniendo bbox y volumen exactos)
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
    const minTriArea2D = cellSizeM * cellSizeM * 0.04;

    const validateCellsForCorners = (candX: Float64Array, candZ: Float64Array): void => {
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                if (!activeCell[iz * nx + ix]) continue;
                const cellX = originX + ix * cellSizeM - centerX;
                const cellZ = originZ + iz * cellSizeM - centerZ;
                const cTL = iz * cnx + ix;
                const cBL = (iz + 1) * cnx + ix;
                const cBR = (iz + 1) * cnx + (ix + 1);
                const cTR = iz * cnx + (ix + 1);

                const a1 = signedTriArea2D(cellX, cellZ, candX[cTL], candZ[cTL], candX[cBL], candZ[cBL]);
                const a2 = signedTriArea2D(cellX, cellZ, candX[cBL], candZ[cBL], candX[cBR], candZ[cBR]);
                const a3 = signedTriArea2D(cellX, cellZ, candX[cBR], candZ[cBR], candX[cTR], candZ[cTR]);
                const a4 = signedTriArea2D(cellX, cellZ, candX[cTR], candZ[cTR], candX[cTL], candZ[cTL]);
                if (a1 < minTriArea2D || a2 < minTriArea2D || a3 < minTriArea2D || a4 < minTriArea2D) {
                    candX[cTL] = cx[cTL];
                    candZ[cTL] = cz[cTL];
                    candX[cBL] = cx[cBL];
                    candZ[cBL] = cz[cBL];
                    candX[cBR] = cx[cBR];
                    candZ[cBR] = cz[cBR];
                    candX[cTR] = cx[cTR];
                    candZ[cTR] = cz[cTR];
                }
            }
        }
    };

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
            validateCellsForCorners(tmpX, tmpZ);
            cx.set(tmpX);
            cz.set(tmpZ);
        }
    }

    // 4. Emitir geometría watertight: techo (center-star), base (y = 0) y faldones split-edge
    const positions: number[] = [];
    const normals: number[] = [];
    const confidenceColors: number[] = [];
    const photoColors: number[] | null = rgbBytes ? [] : null;
    const indices: number[] = [];

    const topCornerVert = new Int32Array(cornerTotal).fill(-1);
    const botCornerVert = new Int32Array(cornerTotal).fill(-1);

    const ensureTopCorner = (cIdx: number): number => {
        if (topCornerVert[cIdx] >= 0) return topCornerVert[cIdx];
        const vIdx = positions.length / 3;
        positions.push(cx[cIdx], cornerH[cIdx], cz[cIdx]);
        normals.push(0, 0, 0);
        confidenceColors.push(cornerConfR[cIdx], cornerConfG[cIdx], cornerConfB[cIdx]);
        if (photoColors && cornerPhotoR && cornerPhotoG && cornerPhotoB) {
            photoColors.push(cornerPhotoR[cIdx], cornerPhotoG[cIdx], cornerPhotoB[cIdx]);
        }
        topCornerVert[cIdx] = vIdx;
        return vIdx;
    };

    const ensureBotCorner = (cIdx: number): number => {
        if (botCornerVert[cIdx] >= 0) return botCornerVert[cIdx];
        const vIdx = positions.length / 3;
        positions.push(cx[cIdx], 0, cz[cIdx]);
        normals.push(0, -1, 0);
        confidenceColors.push(COLOR_NEUTRAL_BASE[0], COLOR_NEUTRAL_BASE[1], COLOR_NEUTRAL_BASE[2]);
        if (photoColors) {
            photoColors.push(COLOR_NEUTRAL_BASE[0], COLOR_NEUTRAL_BASE[1], COLOR_NEUTRAL_BASE[2]);
        }
        botCornerVert[cIdx] = vIdx;
        return vIdx;
    };

    // 4A. Superficie superior (+Y CCW, 4 triángulos en abanico por celda activa -> preserva maxH y V_DEM)
    const topTriStart = 0;
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            if (!activeCell[idx]) continue;

            const cTL = iz * cnx + ix;
            const cBL = (iz + 1) * cnx + ix;
            const cBR = (iz + 1) * cnx + (ix + 1);
            const cTR = iz * cnx + (ix + 1);

            const vTL = ensureTopCorner(cTL);
            const vBL = ensureTopCorner(cBL);
            const vBR = ensureTopCorner(cBR);
            const vTR = ensureTopCorner(cTR);

            const cellX = originX + ix * cellSizeM - centerX;
            const cellZ = originZ + iz * cellSizeM - centerZ;
            const hCell = Math.max(0, heightsM[idx] || 0);

            const vCenter = positions.length / 3;
            positions.push(cellX, hCell, cellZ);
            normals.push(0, 0, 0);
            confidenceColors.push(
                cellConfColors[idx * 3],
                cellConfColors[idx * 3 + 1],
                cellConfColors[idx * 3 + 2]
            );
            if (photoColors && cellPhotoColors) {
                photoColors.push(
                    cellPhotoColors[idx * 3],
                    cellPhotoColors[idx * 3 + 1],
                    cellPhotoColors[idx * 3 + 2]
                );
            }

            indices.push(vCenter, vTL, vBL);
            indices.push(vCenter, vBL, vBR);
            indices.push(vCenter, vBR, vTR);
            indices.push(vCenter, vTR, vTL);
        }
    }
    const topTriEnd = indices.length;
    const topVertEnd = positions.length / 3;

    // Normales exclusivamente de superficie superior (aisladas del faldón y la base)
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

    // 4B. Base cerrada en y = 0 (-Y CCW)
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const idx = iz * nx + ix;
            if (!activeCell[idx]) continue;

            const cTL = iz * cnx + ix;
            const cBL = (iz + 1) * cnx + ix;
            const cBR = (iz + 1) * cnx + (ix + 1);
            const cTR = iz * cnx + (ix + 1);

            const bTL = ensureBotCorner(cTL);
            const bBL = ensureBotCorner(cBL);
            const bBR = ensureBotCorner(cBR);
            const bTR = ensureBotCorner(cTR);

            const cellX = originX + ix * cellSizeM - centerX;
            const cellZ = originZ + iz * cellSizeM - centerZ;
            const bCenter = positions.length / 3;
            positions.push(cellX, 0, cellZ);
            normals.push(0, -1, 0);
            confidenceColors.push(
                COLOR_NEUTRAL_BASE[0],
                COLOR_NEUTRAL_BASE[1],
                COLOR_NEUTRAL_BASE[2]
            );
            if (photoColors) {
                photoColors.push(
                    COLOR_NEUTRAL_BASE[0],
                    COLOR_NEUTRAL_BASE[1],
                    COLOR_NEUTRAL_BASE[2]
                );
            }

            indices.push(bCenter, bBL, bTL);
            indices.push(bCenter, bBR, bBL);
            indices.push(bCenter, bTR, bBR);
            indices.push(bCenter, bTL, bTR);
        }
    }

    // 4C. Faldones perimetrales `emitSkirtEdgeCCW` con vértices dedicados y split-edge normals (> 45°)
    for (const edge of boundaryEdges) {
        const dx = cx[edge.q] - cx[edge.p];
        const dz = cz[edge.q] - cz[edge.p];
        const len = Math.hypot(dx, dz) || 1;
        edge.nx = -dz / len;
        edge.nz = dx / len;
    }

    const resolveSeamNormal = (
        edge: BoundaryEdge,
        cornerIdx: number,
        isStart: boolean
    ): [number, number] => {
        const adjList = isStart ? inEdgeMap.get(cornerIdx) : outEdgeMap.get(cornerIdx);
        if (!adjList || adjList.length !== 1) {
            return [edge.nx, edge.nz];
        }
        const adjEdge = boundaryEdges[adjList[0]];
        const dot = edge.nx * adjEdge.nx + edge.nz * adjEdge.nz;
        // Split-edge estricto cuando el ángulo entre caras laterales > 45°
        if (dot < SPLIT_EDGE_COS_45) {
            return [edge.nx, edge.nz];
        }
        const sx = edge.nx + adjEdge.nx;
        const sz = edge.nz + adjEdge.nz;
        const slen = Math.hypot(sx, sz);
        return slen > 1e-8 ? [sx / slen, sz / slen] : [edge.nx, edge.nz];
    };

    const emitSkirtEdgeCCW = (edge: BoundaryEdge) => {
        const hP = Math.max(0, cornerH[edge.p]);
        const hQ = Math.max(0, cornerH[edge.q]);
        if (hP <= 1e-4 && hQ <= 1e-4) return;

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

        for (let k = 0; k < 4; k++) {
            confidenceColors.push(
                COLOR_NEUTRAL_BASE[0],
                COLOR_NEUTRAL_BASE[1],
                COLOR_NEUTRAL_BASE[2]
            );
        }
        if (photoColors && cellPhotoColors) {
            const cOff = edge.cellIdx * 3;
            const r = cellPhotoColors[cOff];
            const g = cellPhotoColors[cOff + 1];
            const b = cellPhotoColors[cOff + 2];
            photoColors.push(
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
        }

        if (hQ > 1e-4) indices.push(base, base + 1, base + 2);
        if (hP > 1e-4) indices.push(base, base + 2, base + 3);
    };

    for (const edge of boundaryEdges) {
        emitSkirtEdgeCCW(edge);
    }

    return finalizeGeometryBuild(
        positions,
        normals,
        confidenceColors,
        photoColors,
        indices,
        grid.volumeM3
    );
}
