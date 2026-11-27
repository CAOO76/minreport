/**
 * twin3dDimensionsOverlay — Overlay de Cotas 3D CAD para MINREPORT · ACOPIOS
 *
 * Estándar HMI Aeroespacial & Industrial (Leica Captivate / ANSI/ISA-101):
 * - Geometría 0px (`rounded-none`, sin sombras ornamentales).
 * - Tipografía exclusiva `Atkinson Hyperlegible Mono` en CanvasTexture con contraste WCAG 2.2 AAA (claro/oscuro).
 * - Color por Excepción:
 *     - H (altura): Cobre Industrial `#C68346`
 *     - Ø (diámetro si |a - b| / max(a, b) < 8%) o L / A: Cian Técnico `#00AEEF`
 *     - α (talud, solo si existe): `#C68346` si > 38°, `#00AEEF` si nominal
 *     - V (volumen, 3 decimales si < 1.0 m³) y S (área base en m², solo si declarada — jamás inventada)
 * - Limpieza estricta GPU (`disposeObject3DTree` libera CanvasTexture, SpriteMaterial, LineBasicMaterial, BufferGeometry).
 */

import * as THREE from 'three';
import type { UnifiedBoundingBoxM } from '../../../../contracts/acopios.contracts';

export interface Twin3DDimensionsInput {
    boundingBoxM: UnifiedBoundingBoxM;
    dimensionsM?: { a?: number | null; b?: number | null; h?: number | null } | null;
    volumeM3?: number | null;
    slopeAngleDeg?: number | null;
    footprintAreaM2?: number | null;
    isDark: boolean;
    compact?: boolean;
}

export type DimensionLabelKey = 'H' | 'D' | 'L' | 'A' | 'ALPHA' | 'V' | 'S';

const COPPER_HEX = '#C68346';
const CYAN_HEX = '#00AEEF';
const COPPER_NUM = 0xc68346;
const CYAN_NUM = 0x00aeef;

function isPositiveFinite(v?: number | null): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export function formatTwin3DVolumeM3(volumeM3: number): string {
    if (!Number.isFinite(volumeM3) || volumeM3 <= 0) return '0.000';
    return volumeM3 < 1.0 ? volumeM3.toFixed(3) : volumeM3.toFixed(2);
}

export function disposeMaterialResources(material: THREE.Material): void {
    const record = material as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        const value = record[key];
        if (
            value &&
            typeof value === 'object' &&
            'isTexture' in value &&
            typeof (value as THREE.Texture).dispose === 'function'
        ) {
            (value as THREE.Texture).dispose();
        }
    }
    material.dispose();
}

export function disposeObject3DTree(root: THREE.Object3D): void {
    root.traverse((obj) => {
        const renderable = obj as unknown as {
            geometry?: THREE.BufferGeometry;
            material?: THREE.Material | THREE.Material[];
        };
        if (renderable.geometry && typeof renderable.geometry.dispose === 'function') {
            renderable.geometry.dispose();
        }
        if (renderable.material) {
            const mats = Array.isArray(renderable.material)
                ? renderable.material
                : [renderable.material];
            for (const mat of mats) {
                disposeMaterialResources(mat);
            }
        }
    });
}

function createCadLabelSprite(params: {
    key: DimensionLabelKey;
    text: string;
    accentHex: string;
    isDark: boolean;
    scaleHeight: number;
    position: [number, number, number];
}): THREE.Sprite {
    const { key, text, accentHex, isDark, scaleHeight, position } = params;

    const canvasW = 320;
    const canvasH = 76;
    let texture: THREE.Texture;

    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvasW, canvasH);
            const bg = isDark ? 'rgba(0, 0, 0, 0.90)' : 'rgba(255, 255, 255, 0.95)';
            const fg = isDark ? '#F3F4F6' : '#0F172A';

            ctx.font = '700 30px "Atkinson Hyperlegible Mono", ui-monospace, monospace';
            const measuredW = Math.ceil(ctx.measureText(text).width);
            const boxW = Math.min(canvasW - 8, Math.max(120, measuredW + 34));
            const boxH = 54;
            const x0 = Math.round((canvasW - boxW) * 0.5);
            const y0 = Math.round((canvasH - boxH) * 0.5);

            // Geometría estricta 0px (rounded-none, sin sombras)
            ctx.fillStyle = bg;
            ctx.fillRect(x0, y0, boxW, boxH);

            // Barra lateral izquierda ISA-101 de 4px + borde 1px
            ctx.fillStyle = accentHex;
            ctx.fillRect(x0, y0, 5, boxH);

            ctx.strokeStyle = accentHex;
            ctx.lineWidth = 2;
            ctx.strokeRect(x0 + 1, y0 + 1, boxW - 2, boxH - 2);

            ctx.fillStyle = fg;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvasW * 0.5 + 2, canvasH * 0.5 + 1);
        }
        const canvasTex = new THREE.CanvasTexture(canvas);
        canvasTex.colorSpace = THREE.SRGBColorSpace;
        canvasTex.needsUpdate = true;
        texture = canvasTex;
    } else {
        const data = new Uint8Array([0, 0, 0, 255]);
        texture = new THREE.DataTexture(data, 1, 1);
        texture.needsUpdate = true;
    }

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    const aspect = canvasW / canvasH;
    sprite.scale.set(scaleHeight * aspect, scaleHeight, 1);
    sprite.position.set(position[0], position[1], position[2]);
    sprite.renderOrder = 25;
    sprite.name = `dim-label-${key}`;
    sprite.userData = {
        dimensionKey: key,
        text,
        accentHex,
        isDark,
    };
    return sprite;
}

function pushLineSeg(
    arr: number[],
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
): void {
    arr.push(x0, y0, z0, x1, y1, z1);
}

function buildLineSegmentsNode(
    name: string,
    verts: number[],
    colorHex: number
): THREE.LineSegments | null {
    if (verts.length < 6) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
    });
    const segs = new THREE.LineSegments(geom, mat);
    segs.name = name;
    segs.renderOrder = 20;
    return segs;
}

export function buildTwin3DDimensionsOverlay(input: Twin3DDimensionsInput): THREE.Group {
    const {
        boundingBoxM,
        dimensionsM,
        volumeM3,
        slopeAngleDeg,
        footprintAreaM2,
        isDark,
        compact = false,
    } = input;

    const group = new THREE.Group();
    group.name = 'StockpileDimensionsOverlay';

    const boxW = isPositiveFinite(boundingBoxM?.widthX) ? boundingBoxM.widthX : 0;
    const boxD = isPositiveFinite(boundingBoxM?.depthZ) ? boundingBoxM.depthZ : 0;
    const boxH = isPositiveFinite(boundingBoxM?.heightY) ? boundingBoxM.heightY : 0;

    const dimA = isPositiveFinite(dimensionsM?.a) ? dimensionsM!.a! : boxW > 0 ? boxW : null;
    const dimB = isPositiveFinite(dimensionsM?.b) ? dimensionsM!.b! : boxD > 0 ? boxD : null;
    const dimH = isPositiveFinite(dimensionsM?.h) ? dimensionsM!.h! : boxH > 0 ? boxH : null;

    const maxSpan = Math.max(boxW, boxD, boxH, dimA ?? 0, dimB ?? 0, dimH ?? 0, 0.25);
    const halfW = (boxW > 0 ? boxW : dimA ?? maxSpan) * 0.5;
    const halfD = (boxD > 0 ? boxD : dimB ?? maxSpan) * 0.5;
    const visualH = boxH > 0 ? boxH : dimH ?? 0;

    const offset = Math.max(0.05, maxSpan * 0.14);
    const tick = Math.max(0.018, maxSpan * 0.045);
    const labelScaleH = Math.max(0.08, maxSpan * (compact ? 0.175 : 0.15));

    const copperVerts: number[] = [];
    const cyanVerts: number[] = [];

    // 1. Cota Vertical H (Cobre Industrial #C68346)
    if (dimH !== null && visualH > 0) {
        const hx = halfW + offset;
        const hz = halfD * 0.35;
        // Línea vertical principal
        pushLineSeg(copperVerts, hx, 0, hz, hx, visualH, hz);
        // Ticks extremos
        pushLineSeg(copperVerts, hx - tick, 0, hz, hx + tick, 0, hz);
        pushLineSeg(copperVerts, hx - tick, visualH, hz, hx + tick, visualH, hz);
        // Líneas de referencia (witness) hacia arista superior e inferior
        pushLineSeg(copperVerts, halfW + tick * 0.35, 0, hz, hx, 0, hz);
        pushLineSeg(copperVerts, halfW + tick * 0.35, visualH, hz, hx, visualH, hz);

        group.add(
            createCadLabelSprite({
                key: 'H',
                text: `H ${dimH.toFixed(2)} m`,
                accentHex: COPPER_HEX,
                isDark,
                scaleHeight: labelScaleH,
                position: [hx + offset * 0.72, visualH * 0.52, hz],
            })
        );
    }

    // 2. Cotas Horizontales: Ø (si |a - b| / max(a, b) < 8%) o L y A (Cian #00AEEF)
    const yBase = 0.004;
    if (dimA !== null && dimB !== null) {
        const maxAB = Math.max(dimA, dimB);
        const isCircular = maxAB > 0 && Math.abs(dimA - dimB) / maxAB < 0.08;
        if (isCircular) {
            const diameter = (dimA + dimB) * 0.5;
            const zLine = halfD + offset;
            pushLineSeg(cyanVerts, -halfW, yBase, zLine, halfW, yBase, zLine);
            pushLineSeg(cyanVerts, -halfW, yBase, zLine - tick, -halfW, yBase, zLine + tick);
            pushLineSeg(cyanVerts, halfW, yBase, zLine - tick, halfW, yBase, zLine + tick);
            pushLineSeg(cyanVerts, -halfW, yBase, halfD + tick * 0.3, -halfW, yBase, zLine);
            pushLineSeg(cyanVerts, halfW, yBase, halfD + tick * 0.3, halfW, yBase, zLine);

            group.add(
                createCadLabelSprite({
                    key: 'D',
                    text: `Ø ${diameter.toFixed(2)} m`,
                    accentHex: CYAN_HEX,
                    isDark,
                    scaleHeight: labelScaleH,
                    position: [0, yBase + labelScaleH * 0.42, zLine + offset * 0.55],
                })
            );
        } else {
            const lVal = Math.max(dimA, dimB);
            const aVal = Math.min(dimA, dimB);
            const xIsLonger = boxW >= boxD;

            // Eje X frontal
            const zLine = halfD + offset;
            pushLineSeg(cyanVerts, -halfW, yBase, zLine, halfW, yBase, zLine);
            pushLineSeg(cyanVerts, -halfW, yBase, zLine - tick, -halfW, yBase, zLine + tick);
            pushLineSeg(cyanVerts, halfW, yBase, zLine - tick, halfW, yBase, zLine + tick);
            pushLineSeg(cyanVerts, -halfW, yBase, halfD + tick * 0.3, -halfW, yBase, zLine);
            pushLineSeg(cyanVerts, halfW, yBase, halfD + tick * 0.3, halfW, yBase, zLine);

            group.add(
                createCadLabelSprite({
                    key: xIsLonger ? 'L' : 'A',
                    text: `${xIsLonger ? 'L' : 'A'} ${(xIsLonger ? lVal : aVal).toFixed(2)} m`,
                    accentHex: CYAN_HEX,
                    isDark,
                    scaleHeight: labelScaleH,
                    position: [0, yBase + labelScaleH * 0.42, zLine + offset * 0.55],
                })
            );

            // Eje Z lateral izquierdo
            const xLine = -halfW - offset;
            pushLineSeg(cyanVerts, xLine, yBase, -halfD, xLine, yBase, halfD);
            pushLineSeg(cyanVerts, xLine - tick, yBase, -halfD, xLine + tick, yBase, -halfD);
            pushLineSeg(cyanVerts, xLine - tick, yBase, halfD, xLine + tick, yBase, halfD);
            pushLineSeg(cyanVerts, -halfW - tick * 0.3, yBase, -halfD, xLine, yBase, -halfD);
            pushLineSeg(cyanVerts, -halfW - tick * 0.3, yBase, halfD, xLine, yBase, halfD);

            group.add(
                createCadLabelSprite({
                    key: xIsLonger ? 'A' : 'L',
                    text: `${xIsLonger ? 'A' : 'L'} ${(xIsLonger ? aVal : lVal).toFixed(2)} m`,
                    accentHex: CYAN_HEX,
                    isDark,
                    scaleHeight: labelScaleH,
                    position: [xLine - offset * 0.58, yBase + labelScaleH * 0.42, 0],
                })
            );
        }
    } else if (dimA !== null) {
        const zLine = halfD + offset;
        pushLineSeg(cyanVerts, -halfW, yBase, zLine, halfW, yBase, zLine);
        pushLineSeg(cyanVerts, -halfW, yBase, zLine - tick, -halfW, yBase, zLine + tick);
        pushLineSeg(cyanVerts, halfW, yBase, zLine - tick, halfW, yBase, zLine + tick);
        group.add(
            createCadLabelSprite({
                key: 'L',
                text: `L ${dimA.toFixed(2)} m`,
                accentHex: CYAN_HEX,
                isDark,
                scaleHeight: labelScaleH,
                position: [0, yBase + labelScaleH * 0.42, zLine + offset * 0.55],
            })
        );
    } else if (dimB !== null) {
        const xLine = -halfW - offset;
        pushLineSeg(cyanVerts, xLine, yBase, -halfD, xLine, yBase, halfD);
        pushLineSeg(cyanVerts, xLine - tick, yBase, -halfD, xLine + tick, yBase, -halfD);
        pushLineSeg(cyanVerts, xLine - tick, yBase, halfD, xLine + tick, yBase, halfD);
        group.add(
            createCadLabelSprite({
                key: 'A',
                text: `A ${dimB.toFixed(2)} m`,
                accentHex: CYAN_HEX,
                isDark,
                scaleHeight: labelScaleH,
                position: [xLine - offset * 0.58, yBase + labelScaleH * 0.42, 0],
            })
        );
    }

    // 3. Cota Angular α (Talud — solo si existe, jamás inventado)
    if (typeof slopeAngleDeg === 'number' && Number.isFinite(slopeAngleDeg)) {
        const isSteep = slopeAngleDeg > 38;
        const slopeAccentHex = isSteep ? COPPER_HEX : CYAN_HEX;
        const slopeVerts = isSteep ? copperVerts : cyanVerts;

        const rad = (Math.max(1, Math.min(89, slopeAngleDeg)) * Math.PI) / 180;
        const baseX = -halfW - offset * 0.45;
        const baseZ = -halfD * 0.25;
        const segLen = Math.max(0.08, maxSpan * 0.22);
        // Línea horizontal de referencia + segmento inclinado a ángulo α
        pushLineSeg(slopeVerts, baseX, yBase, baseZ, baseX + segLen, yBase, baseZ);
        pushLineSeg(
            slopeVerts,
            baseX,
            yBase,
            baseZ,
            baseX + segLen * Math.cos(rad),
            yBase + segLen * Math.sin(rad),
            baseZ
        );

        group.add(
            createCadLabelSprite({
                key: 'ALPHA',
                text: `α ${slopeAngleDeg.toFixed(1)}°`,
                accentHex: slopeAccentHex,
                isDark,
                scaleHeight: labelScaleH * 0.92,
                position: [
                    baseX - offset * 0.25,
                    Math.max(visualH * 0.62, yBase + segLen * Math.sin(rad) + labelScaleH * 0.35),
                    baseZ,
                ],
            })
        );
    }

    // 4. Cota Volumétrica V (3 decimales si < 1.0 m³, solo si > 0)
    if (isPositiveFinite(volumeM3)) {
        const vY = visualH + Math.max(0.07, maxSpan * 0.18);
        group.add(
            createCadLabelSprite({
                key: 'V',
                text: `V ${formatTwin3DVolumeM3(volumeM3)} m³`,
                accentHex: COPPER_HEX,
                isDark,
                scaleHeight: labelScaleH * 1.06,
                position: [0, vY, 0],
            })
        );
    }

    // 5. Cota Superficie Base S (solo si footprintAreaM2 existe — jamás inventar datos!)
    if (isPositiveFinite(footprintAreaM2)) {
        const sText = `S ${footprintAreaM2 < 1.0 ? footprintAreaM2.toFixed(3) : footprintAreaM2.toFixed(2)} m²`;
        group.add(
            createCadLabelSprite({
                key: 'S',
                text: sText,
                accentHex: CYAN_HEX,
                isDark,
                scaleHeight: labelScaleH * 0.92,
                position: [halfW + offset * 0.55, yBase + labelScaleH * 0.4, -halfD - offset * 0.4],
            })
        );
    }

    const copperLines = buildLineSegmentsNode('dim-lines-copper', copperVerts, COPPER_NUM);
    if (copperLines) group.add(copperLines);

    const cyanLines = buildLineSegmentsNode('dim-lines-cyan', cyanVerts, CYAN_NUM);
    if (cyanLines) group.add(cyanLines);

    return group;
}
