import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import {
    buildThreeGeometryFromDemGridV1,
    type DemGridGeometryUserData,
    type DemGridInput,
} from '../core/utils/demGridGeometry';
import {
    buildTwin3DDimensionsOverlay,
    disposeObject3DTree,
    formatTwin3DVolumeM3,
} from '../core/utils/twin3dDimensionsOverlay';
import {
    applyStockpileVisualMaterialState,
    StockpileTwin3D,
} from '../components/StockpileTwin3D';

function encodeBytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback || _key,
        i18n: { language: 'es', resolvedLanguage: 'es' },
    }),
}));

/**
 * Construye un cilindro real de altura 54 cm y diámetro 33 cm (radio 16.5 cm)
 * muestreado a `cellSizeM = 0.03 m` con margen exterior de ceros (sin "carpa dentada").
 */
function makeCylinder54x33Dem(withRgb = false): {
    grid: DemGridInput;
    rgbBytes: Uint8Array;
    demVolumeM3: number;
    activeCells: number;
} {
    const cellSizeM = 0.03;
    const nx = 17;
    const nz = 17;
    const originX = -((nx - 1) * cellSizeM) * 0.5;
    const originZ = -((nz - 1) * cellSizeM) * 0.5;
    const radiusM = 0.165;
    const heightM = 0.54;

    const heightsM = new Array<number>(nx * nz).fill(0);
    const confidenceMask = new Array<number>(nx * nz).fill(0);
    const rgbBytes = new Uint8Array(nx * nz * 3);

    let activeCells = 0;
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const x = originX + ix * cellSizeM;
            const z = originZ + iz * cellSizeM;
            const idx = iz * nx + ix;
            if (Math.hypot(x, z) <= radiusM + 1e-9) {
                heightsM[idx] = heightM;
                confidenceMask[idx] = 2;
                // Color mineral cobre/terracota real sRGB (180, 120, 64)
                rgbBytes[idx * 3] = 180;
                rgbBytes[idx * 3 + 1] = 120;
                rgbBytes[idx * 3 + 2] = 64;
                activeCells++;
            }
        }
    }

    const demVolumeM3 = activeCells * cellSizeM * cellSizeM * heightM;
    const rgbB64 = withRgb ? encodeBytesToBase64(rgbBytes) : undefined;

    const grid: DemGridInput = {
        format: withRgb ? 'dem_grid_v2' : 'dem_grid_v1',
        nx,
        nz,
        cellSizeM,
        originX,
        originZ,
        heightsM,
        confidenceMask,
        groundPlane: { a: 0, b: 0, d: 0, slopeDeg: 0 },
        ...(withRgb ? { rgbB64 } : {}),
    };

    return { grid, rgbBytes, demVolumeM3, activeCells };
}

describe('v230 Bloque C — Malla 3D Watertight Sin Carpa + dem_grid_v2 RGB', () => {
    it('(a) cilindro 54×33 cm (0.03 m/celda): tinVolumeM3 dentro de ±3% del DEM, sin expansión carpa (+2*cellSize), base y=0 y normales split-edge', () => {
        const { grid, demVolumeM3 } = makeCylinder54x33Dem(false);
        const built = buildThreeGeometryFromDemGridV1(grid);
        expect(built).not.toBeNull();

        // 1. Volumen TIN coincide con DEM dentro de ±3% (y usa 3 decimales para < 1.0 m³)
        const relErrPct = (Math.abs(built!.tinVolumeM3 - demVolumeM3) / demVolumeM3) * 100;
        expect(relErrPct).toBeLessThanOrEqual(3.0);
        expect(built!.tinVolumeM3).toBeGreaterThan(0.044);
        expect(built!.tinVolumeM3).toBeLessThan(0.05);

        // 2. Sin expansión exterior tipo carpa: bbox coincide con 0.33 m (jamás 0.33 + 2*0.03 = 0.39 m)
        expect(built!.boundingBoxM.widthX).toBeCloseTo(0.33, 2);
        expect(built!.boundingBoxM.depthZ).toBeCloseTo(0.33, 2);
        expect(built!.boundingBoxM.heightY).toBeCloseTo(0.54, 2);
        expect(built!.boundingBoxM.widthX).toBeLessThan(0.35);
        expect(built!.boundingBoxM.depthZ).toBeLessThan(0.35);

        // 3. Base estrictamente asentada en y = 0
        const bb = built!.geometry.boundingBox!;
        expect(bb.min.y).toBe(0);
        expect(bb.max.y).toBeCloseTo(0.54, 3);

        // 4. Split-edge normals: techo +Y puro, base -Y puro, faldones horizontales hacia afuera (cero sangrado!)
        const pos = built!.geometry.getAttribute('position');
        const norm = built!.geometry.getAttribute('normal');
        let topUpCount = 0;
        let botDownCount = 0;
        let skirtOutwardCount = 0;
        let blendedArtifacts = 0;

        for (let i = 0; i < pos.count; i++) {
            const nxV = norm.getX(i);
            const nyV = norm.getY(i);
            const nzV = norm.getZ(i);
            if (nyV > 0.99) {
                topUpCount++;
            } else if (nyV < -0.99) {
                botDownCount++;
            } else if (Math.abs(nyV) < 0.05) {
                const dotXZ = pos.getX(i) * nxV + pos.getZ(i) * nzV;
                expect(dotXZ).toBeGreaterThan(0);
                skirtOutwardCount++;
            } else {
                // Ningún vértice en un cilindro plano vertical debe sufrir sangrado de normal entre techo y pared
                blendedArtifacts++;
            }
        }

        expect(topUpCount).toBeGreaterThan(50);
        expect(botDownCount).toBeGreaterThan(50);
        expect(skirtOutwardCount).toBeGreaterThan(20);
        expect(blendedArtifacts).toBe(0);

        built!.geometry.dispose();
    });

    it('(b) decodifica dem_grid_v2 rgbB64 a photoColors (sRGB->linear) y conmuta photoColors <-> confidenceColors en applyStockpileVisualMaterialState', () => {
        const { grid } = makeCylinder54x33Dem(true);
        const built = buildThreeGeometryFromDemGridV1(grid);
        expect(built).not.toBeNull();
        expect(built!.hasPhotoVertexColors).toBe(true);

        const userData = built!.geometry.userData as DemGridGeometryUserData;
        expect(userData.hasPhotoVertexColors).toBe(true);
        expect(userData.photoColors).toBeInstanceOf(Float32Array);
        expect(userData.confidenceColors).toBeInstanceOf(Float32Array);
        expect(userData.photoColors!.length).toBe(built!.vertexCount * 3);
        expect(userData.confidenceColors.length).toBe(built!.vertexCount * 3);

        // Verificar conversión sRGB -> linear para (180, 120, 64) en un vértice del techo
        const expectedR = Math.pow((180 / 255 + 0.055) / 1.055, 2.4);
        const expectedG = Math.pow((120 / 255 + 0.055) / 1.055, 2.4);
        const expectedB = Math.pow((64 / 255 + 0.055) / 1.055, 2.4);
        expect(userData.photoColors![0]).toBeCloseTo(expectedR, 2);
        expect(userData.photoColors![1]).toBeCloseTo(expectedG, 2);
        expect(userData.photoColors![2]).toBeCloseTo(expectedB, 2);

        // Verificar conmutación de material: default = photoColors + vertexColors=true + color=0xffffff
        const mat = new THREE.MeshStandardMaterial({ color: 0xc68346, vertexColors: false });
        const mesh = new THREE.Mesh(built!.geometry, mat);
        const group = new THREE.Group();
        group.add(mesh);

        applyStockpileVisualMaterialState(group, false, false);
        expect(mat.vertexColors).toBe(true);
        expect(mat.color.getHex()).toBe(0xffffff);
        const colAttrPhoto = built!.geometry.getAttribute('color') as THREE.BufferAttribute;
        expect(colAttrPhoto.getX(0)).toBeCloseTo(expectedR, 2);

        // Al activar layers (showConfidenceLayer = true), intercambia atributo color a confidenceColors ISA-101 (#00AEEF)
        applyStockpileVisualMaterialState(group, false, true);
        expect(mat.vertexColors).toBe(true);
        expect(mat.color.getHex()).toBe(0xffffff);
        const colAttrConf = built!.geometry.getAttribute('color') as THREE.BufferAttribute;
        expect(colAttrConf.getX(0)).toBeCloseTo(0.0, 2);
        expect(colAttrConf.getZ(0)).toBeCloseTo(0.855, 2);

        // Volver a modo fotográfico restaura photoColors
        applyStockpileVisualMaterialState(group, false, false);
        expect(colAttrConf.getX(0)).toBeCloseTo(expectedR, 2);

        disposeObject3DTree(group);
    });
});

describe('v230 Bloque C — Cotas 3D CAD (twin3dDimensionsOverlay + StockpileTwin3D)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('(d) buildTwin3DDimensionsOverlay genera H, Ø, α, V (3 dec < 1m³), S y limpia todos los recursos en dispose', () => {
        const overlay = buildTwin3DDimensionsOverlay({
            boundingBoxM: { widthX: 0.33, depthZ: 0.33, heightY: 0.54 },
            dimensionsM: { a: 0.33, b: 0.33, h: 0.54 },
            volumeM3: 0.0462,
            slopeAngleDeg: 85.0,
            footprintAreaM2: 0.086,
            isDark: true,
        });

        const sprites: THREE.Sprite[] = [];
        const lines: THREE.LineSegments[] = [];
        overlay.traverse((obj) => {
            if ((obj as THREE.Sprite).isSprite) sprites.push(obj as THREE.Sprite);
            if ((obj as THREE.LineSegments).isLineSegments) lines.push(obj as THREE.LineSegments);
        });

        const byKey = new Map(sprites.map((s) => [s.userData.dimensionKey, s.userData]));
        expect(byKey.get('H')).toMatchObject({ text: 'H 0.54 m', accentHex: '#C68346' });
        expect(byKey.get('D')).toMatchObject({ text: 'Ø 0.33 m', accentHex: '#00AEEF' });
        expect(byKey.has('L')).toBe(false);
        expect(byKey.has('A')).toBe(false);
        expect(byKey.get('ALPHA')).toMatchObject({ text: 'α 85.0°', accentHex: '#C68346' });
        expect(byKey.get('V')).toMatchObject({ text: 'V 0.046 m³', accentHex: '#C68346' });
        expect(byKey.get('S')).toMatchObject({ text: 'S 0.086 m²', accentHex: '#00AEEF' });
        expect(lines.length).toBeGreaterThanOrEqual(2);

        // Todos los sprites usan depthTest: false para legibilidad CAD sobre la malla
        for (const s of sprites) {
            expect(s.material.depthTest).toBe(false);
        }

        // Verificar que disposeObject3DTree libera CanvasTexture, SpriteMaterial, LineBasicMaterial y BufferGeometry
        const geomSpies = lines.map((l) => vi.spyOn(l.geometry, 'dispose'));
        const lineMatSpies = lines.map((l) => vi.spyOn(l.material as THREE.Material, 'dispose'));
        const spriteMatSpies = sprites.map((s) => vi.spyOn(s.material, 'dispose'));
        const texSpies = sprites
            .map((s) => s.material.map)
            .filter((t): t is THREE.Texture => Boolean(t))
            .map((t) => vi.spyOn(t, 'dispose'));

        disposeObject3DTree(overlay);

        expect(geomSpies.length).toBeGreaterThan(0);
        expect(texSpies.length).toBe(sprites.length);
        for (const sp of [...geomSpies, ...lineMatSpies, ...spriteMatSpies, ...texSpies]) {
            expect(sp).toHaveBeenCalledTimes(1);
        }
    });

    it('(e) buildTwin3DDimensionsOverlay emite L y A para pilas elongadas, α Cian <= 38° y JAMÁS inventa S ni α faltantes', () => {
        const elongated = buildTwin3DDimensionsOverlay({
            boundingBoxM: { widthX: 8.4, depthZ: 4.2, heightY: 2.6 },
            dimensionsM: { a: 8.4, b: 4.2, h: 2.6 },
            volumeM3: 32.45,
            slopeAngleDeg: 34.2,
            footprintAreaM2: null,
            isDark: false,
        });

        const keys = new Map<string, Record<string, unknown>>();
        elongated.traverse((obj) => {
            if ((obj as THREE.Sprite).isSprite) {
                keys.set(obj.userData.dimensionKey, obj.userData);
            }
        });

        expect(keys.get('L')).toMatchObject({ text: 'L 8.40 m', accentHex: '#00AEEF' });
        expect(keys.get('A')).toMatchObject({ text: 'A 4.20 m', accentHex: '#00AEEF' });
        expect(keys.has('D')).toBe(false);
        expect(keys.get('ALPHA')).toMatchObject({ text: 'α 34.2°', accentHex: '#00AEEF' });
        expect(keys.get('V')).toMatchObject({ text: 'V 32.45 m³' });
        // JAMÁS inventar S si footprintAreaM2 es null/undefined
        expect(keys.has('S')).toBe(false);
        disposeObject3DTree(elongated);

        const minimal = buildTwin3DDimensionsOverlay({
            boundingBoxM: { widthX: 2.0, depthZ: 2.0, heightY: 1.0 },
            isDark: true,
        });
        const minKeys = new Set<string>();
        minimal.traverse((obj) => {
            if ((obj as THREE.Sprite).isSprite) minKeys.add(obj.userData.dimensionKey);
        });
        expect(minKeys.has('ALPHA')).toBe(false);
        expect(minKeys.has('S')).toBe(false);
        expect(minKeys.has('V')).toBe(false);
        disposeObject3DTree(minimal);
    });

    it('(f) StockpileTwin3D activa cotas por defecto (straighten aria-pressed="true") y formatea < 1.0 m³ con 3 decimales', async () => {
        expect(formatTwin3DVolumeM3(0.0462)).toBe('0.046');
        expect(formatTwin3DVolumeM3(42.5)).toBe('42.50');

        const { grid } = makeCylinder54x33Dem(true);
        render(
            React.createElement(StockpileTwin3D, {
                compact: true,
                meshUrl: null,
                localPreviewMesh: grid,
                dimensionsM: { a: 0.33, b: 0.33, h: 0.54 },
                volumeM3: 0.0462,
                tinVolumeM3: 0.0462,
                slopeAngleDeg: 85.0,
                footprintAreaM2: 0.086,
            })
        );

        await waitFor(() => {
            expect(screen.getByText('IN-SITU')).toBeInTheDocument();
        });

        // Precisión de 3 decimales para volúmenes < 1.0 m³
        expect(screen.getByText(/0\.046 m³/)).toBeInTheDocument();

        // Botón Icon-First `straighten` visible, >= 48px, rounded-none y activo por defecto
        const dimBtn = screen.getByRole('button', { name: 'COTAS 3D' });
        expect(dimBtn).toHaveAttribute('aria-pressed', 'true');
        expect(dimBtn.className).toContain('min-w-[48px]');
        expect(dimBtn.className).toContain('min-h-[48px]');
        expect(dimBtn.className).toContain('rounded-none');
        expect(dimBtn.textContent).toContain('straighten');

        // También verificar con showDimensionsDefault={false}
        render(
            React.createElement(StockpileTwin3D, {
                meshUrl: null,
                localPreviewMesh: grid,
                showDimensionsDefault: false,
                tinVolumeM3: 0.0462,
            })
        );
        const allDimBtns = screen.getAllByRole('button', { name: 'COTAS 3D' });
        expect(allDimBtns[1]).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(allDimBtns[1]);
    });
});
