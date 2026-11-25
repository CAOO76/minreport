/**
 * demGridGeometry — Constructor Three.js BufferGeometry para Nivel 1 Offline (`dem_grid_v1`)
 *
 * Garantías geométricas y HMI:
 * - Base nivelada horizontalmente en y = 0 (elimina cuña flotante e inflación de heightY).
 * - Faldones perimetrales con vértices propios y winding CCW exterior (cero sangrado de normales).
 * - Atributo COLOR_0 por vértice ANSI/ISA-101:
 *     #00AEEF (Cian): superficie observada verificada (confidenceMask === 2)
 *     #C68346 (Cobre): celda interpolada/ocluida (confidenceMask === 1) o talud local > 38°
 *     #8A93A6 (Neutro): superficie base / faldón / tapa inferior
 */

import * as THREE from 'three';
import type { DemGridV1, UnifiedBoundingBoxM } from '../../../../contracts/acopios.contracts';

export interface DemGridGeometryBuildResult {
    geometry: THREE.BufferGeometry;
    boundingBoxM: UnifiedBoundingBoxM;
    vertexCount: number;
    triangleCount: number;
    tinVolumeM3: number;
    hasConfidenceColors: boolean;
}

// Colores lineales para atributo COLOR_0 (MeshStandardMaterial vertexColors)
const COLOR_VERIFIED_CYAN: [number, number, number] = [0.0, 0.428, 0.855]; // #00AEEF sRGB -> linear
const COLOR_EXCEPTION_COPPER: [number, number, number] = [0.565, 0.227, 0.061]; // #C68346 sRGB -> linear
const COLOR_NEUTRAL_BASE: [number, number, number] = [0.254, 0.287, 0.376]; // #8A93A6 sRGB -> linear

const SLOPE_EXCEPTION_TAN = Math.tan((38 * Math.PI) / 180);

export function buildThreeGeometryFromDemGridV1(
    grid: DemGridV1
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

    const quadRows = nz - 1;
    const quadCols = nx - 1;
    const activeQuad = new Uint8Array(quadRows * quadCols);
    let activeQuadCount = 0;

    for (let iz = 0; iz < quadRows; iz++) {
        for (let ix = 0; ix < quadCols; ix++) {
            const hTL = Math.max(0, heightsM[iz * nx + ix] || 0);
            const hTR = Math.max(0, heightsM[iz * nx + (ix + 1)] || 0);
            const hBL = Math.max(0, heightsM[(iz + 1) * nx + ix] || 0);
            const hBR = Math.max(0, heightsM[(iz + 1) * nx + (ix + 1)] || 0);
            if (hTL > 0.015 || hTR > 0.015 || hBL > 0.015 || hBR > 0.015) {
                activeQuad[iz * quadCols + ix] = 1;
                activeQuadCount++;
            }
        }
    }

    if (activeQuadCount === 0) return null;

    const centerX = originX + (nx - 1) * cellSizeM * 0.5;
    const centerZ = originZ + (nz - 1) * cellSizeM * 0.5;

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const topIndex = new Int32Array(nx * nz).fill(-1);
    const botIndex = new Int32Array(nx * nz).fill(-1);

    const hasMask = Array.isArray(confidenceMask) && confidenceMask.length === nx * nz;

    const resolveTopVertexColor = (vx: number, vz: number): [number, number, number] => {
        const idx = vz * nx + vx;
        const h = Math.max(0, heightsM[idx] || 0);
        const hL = vx > 0 ? Math.max(0, heightsM[vz * nx + (vx - 1)] || 0) : h;
        const hR = vx < nx - 1 ? Math.max(0, heightsM[vz * nx + (vx + 1)] || 0) : h;
        const hU = vz > 0 ? Math.max(0, heightsM[(vz - 1) * nx + vx] || 0) : h;
        const hD = vz < nz - 1 ? Math.max(0, heightsM[(vz + 1) * nx + vx] || 0) : h;
        const dhdx = (hR - hL) / ((vx > 0 && vx < nx - 1 ? 2 : 1) * cellSizeM);
        const dhdz = (hD - hU) / ((vz > 0 && vz < nz - 1 ? 2 : 1) * cellSizeM);
        const grad = Math.hypot(dhdx, dhdz);

        if (grad > SLOPE_EXCEPTION_TAN) {
            return COLOR_EXCEPTION_COPPER;
        }
        if (hasMask) {
            const conf = confidenceMask![idx];
            if (conf === 1) return COLOR_EXCEPTION_COPPER;
            if (conf === 2) return COLOR_VERIFIED_CYAN;
        }
        return h > 0.015 ? COLOR_VERIFIED_CYAN : COLOR_NEUTRAL_BASE;
    };

    const ensureTopVertex = (vx: number, vz: number): number => {
        const vIdx = vz * nx + vx;
        if (topIndex[vIdx] >= 0) return topIndex[vIdx];
        const wx = originX + vx * cellSizeM - centerX;
        const wz = originZ + vz * cellSizeM - centerZ;
        const h = Math.max(0, heightsM[vIdx] || 0);
        const idx = positions.length / 3;
        positions.push(wx, h, wz);
        const c = resolveTopVertexColor(vx, vz);
        colors.push(c[0], c[1], c[2]);
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
        colors.push(COLOR_NEUTRAL_BASE[0], COLOR_NEUTRAL_BASE[1], COLOR_NEUTRAL_BASE[2]);
        botIndex[vIdx] = idx;
        return idx;
    };

    const isQuadActive = (ix: number, iz: number): boolean => {
        if (ix < 0 || ix >= quadCols || iz < 0 || iz >= quadRows) return false;
        return activeQuad[iz * quadCols + ix] === 1;
    };

    /**
     * Emite faldón perimetral con vértices propios (cero sangrado de normales)
     * y winding CCW exterior para arista P -> Q en recorrido CCW visto desde +Y.
     */
    const emitSkirtEdgeCCW = (px: number, pz: number, qx: number, qz: number) => {
        const hP = Math.max(0, heightsM[pz * nx + px] || 0);
        const hQ = Math.max(0, heightsM[qz * nx + qx] || 0);
        if (hP <= 1e-4 && hQ <= 1e-4) return;

        const pwx = originX + px * cellSizeM - centerX;
        const pwz = originZ + pz * cellSizeM - centerZ;
        const qwx = originX + qx * cellSizeM - centerX;
        const qwz = originZ + qz * cellSizeM - centerZ;

        const base = positions.length / 3;
        positions.push(pwx, 0, pwz);
        positions.push(qwx, 0, qwz);
        positions.push(qwx, hQ, qwz);
        positions.push(pwx, hP, pwz);

        for (let k = 0; k < 4; k++) {
            colors.push(COLOR_NEUTRAL_BASE[0], COLOR_NEUTRAL_BASE[1], COLOR_NEUTRAL_BASE[2]);
        }

        // Mirando desde afuera de la arista P -> Q (P a la izquierda, Q a la derecha):
        // pBot -> qBot -> qTop y pBot -> qTop -> pTop es estrictamente CCW exterior.
        if (hQ > 1e-4) {
            indices.push(base, base + 1, base + 2);
        }
        if (hP > 1e-4) {
            indices.push(base, base + 2, base + 3);
        }
    };

    for (let iz = 0; iz < quadRows; iz++) {
        for (let ix = 0; ix < quadCols; ix++) {
            if (!isQuadActive(ix, iz)) continue;

            // Superficie superior (+Y CCW)
            const tTL = ensureTopVertex(ix, iz);
            const tBL = ensureTopVertex(ix, iz + 1);
            const tBR = ensureTopVertex(ix + 1, iz + 1);
            const tTR = ensureTopVertex(ix + 1, iz);
            indices.push(tTL, tBL, tBR);
            indices.push(tTL, tBR, tTR);

            // Tapa inferior en y = 0 (-Y CCW)
            const bTL = ensureBotVertex(ix, iz);
            const bBL = ensureBotVertex(ix, iz + 1);
            const bBR = ensureBotVertex(ix + 1, iz + 1);
            const bTR = ensureBotVertex(ix + 1, iz);
            indices.push(bTL, bBR, bBL);
            indices.push(bTL, bTR, bBR);

            // Faldones CCW hacia afuera en bordes sin vecino activo
            if (!isQuadActive(ix - 1, iz)) emitSkirtEdgeCCW(ix, iz, ix, iz + 1);
            if (!isQuadActive(ix, iz + 1)) emitSkirtEdgeCCW(ix, iz + 1, ix + 1, iz + 1);
            if (!isQuadActive(ix + 1, iz)) emitSkirtEdgeCCW(ix + 1, iz + 1, ix + 1, iz);
            if (!isQuadActive(ix, iz - 1)) emitSkirtEdgeCCW(ix + 1, iz, ix, iz);
        }
    }

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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(
        vertexCount > 65535
            ? new THREE.Uint32BufferAttribute(indices, 1)
            : new THREE.Uint16BufferAttribute(indices, 1)
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const computedVol = Math.abs(signedVol6) / 6;

    return {
        geometry,
        boundingBoxM: {
            widthX: round2(maxX - minX),
            heightY: round2(maxY - minY),
            depthZ: round2(maxZ - minZ),
        },
        vertexCount,
        triangleCount,
        tinVolumeM3:
            typeof grid.volumeM3 === 'number' && grid.volumeM3 > 0
                ? round2(grid.volumeM3)
                : round2(computedVol),
        hasConfidenceColors: true,
    };
}
