import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifySlopeProfile,
    computeSpatialStockpileVolume,
    fitInclinedGroundPlane,
    type SpatialPoint3D,
} from '../spatial-volume.engine';

function createPrng(seed = 0x1337c0de): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * Genera cilindro vertical sintético (ej. AC-5102: H = 0.54 m, D = 0.33 m, V_real = 0.0462 m³)
 * sobre piso de 2.5 m × 2.5 m con ruido determinista uniforme ±noiseM (default ±0.04 m).
 */
function generateCylinderOnNoisyFloor(params: {
    heightM: number;
    diameterM: number;
    floorSpanM: number;
    floorNoiseM: number;
    includeSideWall?: boolean;
    floorOffsetY?: number;
    seed?: number;
}): {
    pointsM: SpatialPoint3D[];
    groundSamplesM: SpatialPoint3D[];
} {
    const {
        heightM,
        diameterM,
        floorSpanM,
        floorNoiseM,
        includeSideWall = true,
        floorOffsetY = 0,
        seed = 0x5102cafe,
    } = params;

    const rand = createPrng(seed);
    const radius = diameterM / 2;
    const halfFloor = floorSpanM / 2;
    const pointsM: SpatialPoint3D[] = [];
    const groundSamplesM: SpatialPoint3D[] = [];

    // 1. Piso 2.5m x 2.5m con ruido ±4 cm alrededor de floorOffsetY
    const floorStep = 0.06;
    for (let x = -halfFloor; x <= halfFloor + 1e-6; x += floorStep) {
        for (let z = -halfFloor; z <= halfFloor + 1e-6; z += floorStep) {
            const r = Math.hypot(x, z);
            if (r <= radius + 0.015) continue;
            const noise = (rand() * 2 - 1) * floorNoiseM;
            const y = Number((floorOffsetY + noise).toFixed(4));
            const pt: SpatialPoint3D = [Number(x.toFixed(4)), y, Number(z.toFixed(4))];
            pointsM.push(pt);
            if (r >= radius + 0.12) {
                groundSamplesM.push(pt);
            }
        }
    }

    // 2. Tapa superior del cilindro (malla fina cada 1.5 cm)
    const topStep = 0.015;
    for (let x = -radius; x <= radius + 1e-6; x += topStep) {
        for (let z = -radius; z <= radius + 1e-6; z += topStep) {
            if (Math.hypot(x, z) <= radius) {
                const topNoise = (rand() * 2 - 1) * 0.005;
                pointsM.push([
                    Number(x.toFixed(4)),
                    Number((floorOffsetY + heightM + topNoise).toFixed(4)),
                    Number(z.toFixed(4)),
                ]);
            }
        }
    }

    // 3. Pared vertical lateral del cilindro (32 azimuts × niveles verticales cada 2 cm)
    if (includeSideWall) {
        const azSteps = 48;
        for (let a = 0; a < azSteps; a++) {
            const theta = (a / azSteps) * Math.PI * 2;
            const wx = Math.cos(theta) * radius;
            const wz = Math.sin(theta) * radius;
            for (let h = 0.04; h <= heightM - 0.01; h += 0.025) {
                const radialJitter = (rand() * 2 - 1) * 0.004;
                const rx = wx * (1 + radialJitter / radius);
                const rz = wz * (1 + radialJitter / radius);
                pointsM.push([
                    Number(rx.toFixed(4)),
                    Number((floorOffsetY + h).toFixed(4)),
                    Number(rz.toFixed(4)),
                ]);
            }
        }
    }

    return { pointsM, groundSamplesM };
}

function generateConeStockpile(params: {
    centerX?: number;
    centerZ?: number;
    radiusM: number;
    slopeDeg: number;
    groundOffsetY?: number;
    slopeX?: number;
    slopeZ?: number;
    step?: number;
    floorMarginM?: number;
    floorNoiseM?: number;
    seed?: number;
}): {
    pointsM: SpatialPoint3D[];
    groundSamplesM: SpatialPoint3D[];
    heightM: number;
    exactVolumeM3: number;
} {
    const {
        centerX = 0,
        centerZ = 0,
        radiusM,
        slopeDeg,
        groundOffsetY = 0,
        slopeX = 0,
        slopeZ = 0,
        step = 0.14,
        floorMarginM = 0.45,
        floorNoiseM = 0,
        seed = 0x2026abcd,
    } = params;

    const rand = createPrng(seed);
    const heightM = radiusM * Math.tan((slopeDeg * Math.PI) / 180);
    const exactVolumeM3 = (1 / 3) * Math.PI * radiusM * radiusM * heightM;
    const pointsM: SpatialPoint3D[] = [];
    const groundSamplesM: SpatialPoint3D[] = [];

    const maxExtent = radiusM + floorMarginM;
    for (let dx = -maxExtent; dx <= maxExtent + 1e-6; dx += step) {
        for (let dz = -maxExtent; dz <= maxExtent + 1e-6; dz += step) {
            const x = centerX + dx;
            const z = centerZ + dz;
            const r = Math.hypot(dx, dz);
            const yGround = slopeX * x + slopeZ * z + groundOffsetY;
            const noise = floorNoiseM > 0 ? (rand() * 2 - 1) * floorNoiseM : 0;

            if (r <= radiusM) {
                const h = heightM * (1 - r / radiusM);
                pointsM.push([
                    Number(x.toFixed(4)),
                    Number((yGround + h + noise * 0.25).toFixed(4)),
                    Number(z.toFixed(4)),
                ]);
            } else if (r <= maxExtent) {
                const gp: SpatialPoint3D = [
                    Number(x.toFixed(4)),
                    Number((yGround + noise).toFixed(4)),
                    Number(z.toFixed(4)),
                ];
                pointsM.push(gp);
                groundSamplesM.push(gp);
            }
        }
    }

    return { pointsM, groundSamplesM, heightM, exactVolumeM3 };
}

test('(a) Cilindro 54 cm x 33 cm sobre piso 2.5 m x 2.5 m con ruido ±4 cm recupera V∈[0.039,0.054] m³, H~0.54 m, talud > 78° y VERTICAL_STRUCTURE', () => {
    const exactVol = Math.PI * 0.165 * 0.165 * 0.54; // 0.046186 m³
    const { pointsM, groundSamplesM } = generateCylinderOnNoisyFloor({
        heightM: 0.54,
        diameterM: 0.33,
        floorSpanM: 2.5,
        floorNoiseM: 0.04,
        includeSideWall: true,
    });

    // 1. Con targetConstraint anclado al cilindro
    const resTargeted = computeSpatialStockpileVolume({
        pointsM,
        groundSamplesM,
        targetConstraint: {
            anchorXZ: [0, 0],
            radiusM: 0.45,
        },
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'KNOWN_POSE_MVS_OFFLINE',
    });

    assert.ok(
        Math.abs(resTargeted.groundPlane.d) < 0.015,
        `Plano base IRLS Huber + p50 debe eliminar sesgo negativo (d=${resTargeted.groundPlane.d})`
    );
    assert.ok(
        (resTargeted.groundPlane.sigmaGroundM ?? 0) >= 0.018 &&
            (resTargeted.groundPlane.sigmaGroundM ?? 0) <= 0.06,
        `sigmaGroundM debe reflejar ruido empírico ±4 cm (obtenido=${resTargeted.groundPlane.sigmaGroundM})`
    );
    assert.ok(
        resTargeted.volumeM3 >= 0.039 && resTargeted.volumeM3 <= 0.054,
        `Volumen del cilindro debe caer en [0.039, 0.054] m³ (exacto=${exactVol.toFixed(4)}, obtenido=${resTargeted.volumeM3})`
    );
    assert.ok(
        Math.abs(resTargeted.heightM - 0.54) <= 0.04,
        `Altura esperada ~0.54 m (±4 cm), obtenida=${resTargeted.heightM}`
    );
    assert.ok(
        resTargeted.baseLengthM <= 0.45 && resTargeted.baseWidthM <= 0.45,
        `Huella debe quedar acotada al cilindro sin arrastrar piso 2.5 m (L=${resTargeted.baseLengthM}, W=${resTargeted.baseWidthM})`
    );
    assert.ok(
        resTargeted.slopeAngleAvgDeg !== null && resTargeted.slopeAngleAvgDeg > 78,
        `Talud del cilindro vertical debe ser > 78°, obtenido=${resTargeted.slopeAngleAvgDeg}°`
    );
    assert.equal(resTargeted.slopeProfile, 'VERTICAL_STRUCTURE');

    // 2. Incluso SIN groundSamplesM ni targetConstraint explícito, p50 + IRLS Huber + Histéresis Dual
    // debe aislar el cilindro del piso ruidoso 2.5 m x 2.5 m
    const resAuto = computeSpatialStockpileVolume({
        pointsM,
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'KNOWN_POSE_MVS_OFFLINE',
    });
    assert.ok(
        resAuto.volumeM3 >= 0.039 && resAuto.volumeM3 <= 0.054,
        `Sin targetConstraint el cilindro también debe caer en [0.039, 0.054] m³ (obtenido=${resAuto.volumeM3})`
    );
    assert.ok(
        resAuto.slopeAngleAvgDeg !== null && resAuto.slopeAngleAvgDeg > 78,
        `Talud automático del cilindro debe ser > 78°, obtenido=${resAuto.slopeAngleAvgDeg}°`
    );
    assert.equal(resAuto.slopeProfile, 'VERTICAL_STRUCTURE');

    // 3. Cilindro solo con tapa superior (sin puntos en pared lateral) respaldado por gradiente unilateral DEM
    const topOnly = generateCylinderOnNoisyFloor({
        heightM: 0.54,
        diameterM: 0.33,
        floorSpanM: 2.5,
        floorNoiseM: 0.04,
        includeSideWall: false,
    });
    const resTopOnly = computeSpatialStockpileVolume({
        pointsM: topOnly.pointsM,
        groundSamplesM: topOnly.groundSamplesM,
        targetConstraint: { anchorXZ: [0, 0] },
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
    });
    assert.ok(
        resTopOnly.volumeM3 >= 0.039 && resTopOnly.volumeM3 <= 0.054,
        `Cilindro tapa superior debe caer en [0.039, 0.054] m³ (obtenido=${resTopOnly.volumeM3})`
    );
    assert.ok(
        resTopOnly.slopeAngleAvgDeg !== null && resTopOnly.slopeAngleAvgDeg > 78,
        `Gradiente unilateral DEM debe detectar pared > 78°, obtenido=${resTopOnly.slopeAngleAvgDeg}°`
    );
    assert.equal(resTopOnly.slopeProfile, 'VERTICAL_STRUCTURE');
});

test('(b) Acopio minero cónico 35° (NATURAL_REPOSE) y talud crítico 42° (STEEP_ALERT)', () => {
    // 1. Cono minero 35° (reposo natural)
    const cone35 = generateConeStockpile({
        radiusM: 3.2,
        slopeDeg: 35,
        floorNoiseM: 0.02,
    });
    const res35 = computeSpatialStockpileVolume({
        pointsM: cone35.pointsM,
        groundSamplesM: cone35.groundSamplesM,
        coveragePct: 96,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'KNOWN_POSE_MVS_OFFLINE',
    });

    assert.ok(
        res35.slopeAngleAvgDeg !== null && Math.abs(res35.slopeAngleAvgDeg - 35) <= 2.5,
        `Talud esperado ~35° (±2.5°), obtenido=${res35.slopeAngleAvgDeg}°`
    );
    assert.equal(res35.slopeProfile, 'NATURAL_REPOSE');
    assert.equal(res35.slopeWarning, null);
    const err35Pct = (Math.abs(res35.volumeM3 - cone35.exactVolumeM3) / cone35.exactVolumeM3) * 100;
    assert.ok(err35Pct < 6, `Error volumétrico cono 35° (${err35Pct.toFixed(2)}%) debe ser < 6%`);

    // 2. Acopio con talud crítico 42° (STEEP_ALERT)
    const cone42 = generateConeStockpile({
        radiusM: 3.0,
        slopeDeg: 42,
        floorNoiseM: 0.02,
    });
    const res42 = computeSpatialStockpileVolume({
        pointsM: cone42.pointsM,
        groundSamplesM: cone42.groundSamplesM,
        coveragePct: 96,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'KNOWN_POSE_MVS_OFFLINE',
    });

    assert.ok(
        res42.slopeAngleAvgDeg !== null && Math.abs(res42.slopeAngleAvgDeg - 42) <= 2.5,
        `Talud esperado ~42° (±2.5°), obtenido=${res42.slopeAngleAvgDeg}°`
    );
    assert.equal(res42.slopeProfile, 'STEEP_ALERT');
    assert.ok(
        res42.slopeWarning !== null && res42.slopeWarning.includes('38°'),
        `Talud 42° debe emitir alerta operativa > 38° (obtenido=${res42.slopeWarning})`
    );
    const err42Pct = (Math.abs(res42.volumeM3 - cone42.exactVolumeM3) / cone42.exactVolumeM3) * 100;
    assert.ok(err42Pct < 6, `Error volumétrico cono 42° (${err42Pct.toFixed(2)}%) debe ser < 6%`);

    // Helper classifySlopeProfile directo
    assert.equal(classifySlopeProfile(35), 'NATURAL_REPOSE');
    assert.equal(classifySlopeProfile(42), 'STEEP_ALERT');
    assert.equal(classifySlopeProfile(84), 'VERTICAL_STRUCTURE');
    assert.equal(classifySlopeProfile(null), null);
});

test('(c) Dos acopios tocándose separados limpiamente por anchorXZ + Watershed 3D y por polygonXZ (+ padReferenceY)', () => {
    // Acopio A en (-2.0, 0): R=2.8m, talud=35° (H≈1.96m, V_solo≈16.1m³)
    // Acopio B en (+2.0, 0): R=2.8m, talud=42° (H≈2.52m, V_solo≈20.7m³)
    // Se superponen formando una silla continua en x ≈ -0.15 m de altura ~0.55 m (> hSeed)
    const centerA: [number, number] = [-2.0, 0];
    const centerB: [number, number] = [2.0, 0];
    const rA = 2.8;
    const rB = 2.8;
    const hA = rA * Math.tan((35 * Math.PI) / 180); // ~1.96 m
    const hB = rB * Math.tan((42 * Math.PI) / 180); // ~2.52 m
    const exactVolA = (1 / 3) * Math.PI * rA * rA * hA; // ~16.09 m³
    const exactVolB = (1 / 3) * Math.PI * rB * rB * hB; // ~20.70 m³
    const padY = 1.25;

    const mergedPoints: SpatialPoint3D[] = [];
    const groundSamplesM: SpatialPoint3D[] = [];
    const step = 0.16;

    for (let x = -5.4; x <= 5.4 + 1e-6; x += step) {
        for (let z = -3.4; z <= 3.4 + 1e-6; z += step) {
            const dA = Math.hypot(x - centerA[0], z - centerA[1]);
            const dB = Math.hypot(x - centerB[0], z - centerB[1]);
            const pileHA = dA <= rA ? hA * (1 - dA / rA) : 0;
            const pileHB = dB <= rB ? hB * (1 - dB / rB) : 0;
            const hSurface = Math.max(pileHA, pileHB);
            const pt: SpatialPoint3D = [
                Number(x.toFixed(4)),
                Number((padY + hSurface).toFixed(4)),
                Number(z.toFixed(4)),
            ];
            mergedPoints.push(pt);
            if (hSurface === 0) {
                groundSamplesM.push(pt);
            }
        }
    }

    // 1. Separación por anchorXZ en Acopio A + Priority-Flood Watershed 3D (sin polygonXZ ni radiusM)
    const resWatershedA = computeSpatialStockpileVolume({
        pointsM: mergedPoints,
        groundSamplesM,
        targetConstraint: {
            anchorXZ: centerA,
        },
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
    });

    const maxGridHA = Math.max(...resWatershedA.surfaceGrid.heightsM);
    assert.ok(
        resWatershedA.heightM >= hA * 0.85 && resWatershedA.heightM <= hA * 1.05,
        `Watershed sobre A debe mantener altura p99 de A (~${(hA * 0.9).toFixed(2)}m) y no tomar pico de B (${hB.toFixed(2)}m), obtenido=${resWatershedA.heightM}m`
    );
    assert.ok(
        Math.abs(maxGridHA - hA) <= 0.16 && maxGridHA < hB - 0.3,
        `Pico DEM de A esperado ~${hA.toFixed(2)}m (excluyendo B=${hB.toFixed(2)}m), obtenido=${maxGridHA.toFixed(2)}m`
    );
    assert.ok(
        resWatershedA.volumeM3 >= exactVolA * 0.8 && resWatershedA.volumeM3 <= exactVolA * 1.15,
        `Watershed sobre A debe aislar V_A (~${exactVolA.toFixed(2)} m³) excluyendo B (${exactVolB.toFixed(2)} m³), obtenido=${resWatershedA.volumeM3} m³`
    );
    assert.ok(
        resWatershedA.baseLengthM < 6.5,
        `Huella de A no debe abarcar ambos acopios (~10.4 m), obtenido baseLengthM=${resWatershedA.baseLengthM}m`
    );

    // 2. Separación por anchorXZ en Acopio B + Watershed 3D
    const resWatershedB = computeSpatialStockpileVolume({
        pointsM: mergedPoints,
        groundSamplesM,
        targetConstraint: {
            anchorXZ: centerB,
        },
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
    });

    const maxGridHB = Math.max(...resWatershedB.surfaceGrid.heightsM);
    assert.ok(
        resWatershedB.heightM >= hB * 0.85 && resWatershedB.heightM <= hB * 1.05,
        `Watershed sobre B debe recuperar altura p99 de B (~${(hB * 0.9).toFixed(2)}m), obtenido=${resWatershedB.heightM}m`
    );
    assert.ok(
        Math.abs(maxGridHB - hB) <= 0.16,
        `Pico DEM de B esperado ~${hB.toFixed(2)}m, obtenido=${maxGridHB.toFixed(2)}m`
    );
    assert.ok(
        resWatershedB.volumeM3 >= exactVolB * 0.8 && resWatershedB.volumeM3 <= exactVolB * 1.15,
        `Watershed sobre B debe aislar V_B (~${exactVolB.toFixed(2)} m³), obtenido=${resWatershedB.volumeM3} m³`
    );

    // 3. Recorte estricto por polygonXZ (4..6 vértices rodeando Acopio A) + padReferenceY explícito sin groundSamplesM
    const polyA: Array<[number, number]> = [
        [-5.1, -3.1],
        [-0.1, -3.1],
        [-0.1, 3.1],
        [-5.1, 3.1],
    ];
    const resPolyA = computeSpatialStockpileVolume({
        pointsM: mergedPoints,
        targetConstraint: {
            anchorXZ: centerA,
            polygonXZ: polyA,
            padReferenceY: padY,
        },
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
    });

    assert.equal(resPolyA.groundPlane.d, padY, 'Debe respetar padReferenceY exacto como cota de patio');
    assert.ok(
        resPolyA.heightM >= hA * 0.85 && resPolyA.heightM <= hA * 1.05,
        `polygonXZ sobre A debe aislar altura p99 de A (~${(hA * 0.9).toFixed(2)}m), obtenido=${resPolyA.heightM}m`
    );
    assert.ok(
        resPolyA.volumeM3 >= exactVolA * 0.8 && resPolyA.volumeM3 <= exactVolA * 1.15,
        `polygonXZ sobre A debe aislar V_A (~${exactVolA.toFixed(2)} m³), obtenido=${resPolyA.volumeM3} m³`
    );
});

test('(d) Retrocompatibilidad 100% sin targetConstraint (llamadores legacy de fitInclinedGroundPlane y computeSpatialStockpileVolume)', () => {
    const coneLegacy = generateConeStockpile({
        radiusM: 3.0,
        slopeDeg: 36,
        slopeX: 0.05,
        groundOffsetY: 0.3,
    });

    // Llamada legacy a fitInclinedGroundPlane sin 4º argumento ni targetConstraint
    const ground = fitInclinedGroundPlane(coneLegacy.pointsM, coneLegacy.groundSamplesM);
    assert.ok(Math.abs(ground.a - 0.05) < 0.01, `Pendiente X esperada ~0.05, obtenida=${ground.a}`);
    assert.ok(Math.abs(ground.d - 0.3) < 0.03, `Offset d esperado ~0.30, obtenido=${ground.d}`);
    assert.ok(
        typeof ground.sigmaGroundM === 'number' &&
            ground.sigmaGroundM >= 0.012 &&
            ground.sigmaGroundM <= 0.06
    );

    // Llamada legacy a computeSpatialStockpileVolume sin targetConstraint
    const res = computeSpatialStockpileVolume({
        pointsM: coneLegacy.pointsM,
        groundSamplesM: coneLegacy.groundSamplesM,
        coveragePct: 94,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'RAW_DEPTH_ONLY',
    });

    const relErrPct =
        (Math.abs(res.volumeM3 - coneLegacy.exactVolumeM3) / coneLegacy.exactVolumeM3) * 100;
    assert.ok(relErrPct < 6, `Error volumétrico legacy (${relErrPct.toFixed(2)}%) debe ser < 6%`);
    assert.equal(res.zeroCellsInside, 0);
    assert.equal(res.slopeProfile, 'NATURAL_REPOSE');
    assert.ok(
        res.slopeAngleAvgDeg !== null && Math.abs(res.slopeAngleAvgDeg - 36) <= 3,
        `Talud legacy sobre rampa 5% esperado ~36°, obtenido=${res.slopeAngleAvgDeg}°`
    );
});

test('(e) Multi-sólido v2.3.0: caja rectangular 0.60x0.40x0.45 m, acopio con mordida cóncava interior y prioridad targetConstraint sobre roiRadiusM legacy', () => {
    // 1. Caja rectangular 0.60 x 0.40 x 0.45 m (exacto = 0.108 m³) con paredes verticales densas
    const exactBoxVol = 0.6 * 0.4 * 0.45; // 0.108 m³
    const boxPts: SpatialPoint3D[] = [];
    const boxGround: SpatialPoint3D[] = [];
    for (let x = -1.0; x <= 1.0 + 1e-6; x += 0.05) {
        for (let z = -1.0; z <= 1.0 + 1e-6; z += 0.05) {
            if (Math.abs(x) > 0.32 || Math.abs(z) > 0.22) {
                const gp: SpatialPoint3D = [Number(x.toFixed(4)), 0, Number(z.toFixed(4))];
                boxPts.push(gp);
                boxGround.push(gp);
            }
        }
    }
    // Tapa superior densa
    for (let x = -0.3; x <= 0.3 + 1e-6; x += 0.015) {
        for (let z = -0.2; z <= 0.2 + 1e-6; z += 0.015) {
            boxPts.push([Number(x.toFixed(4)), 0.45, Number(z.toFixed(4))]);
        }
    }
    // Paredes verticales densas (con p50 erosionaba -50%; con envolvente superior MAD+p90 preserva 100%)
    for (let h = 0.04; h <= 0.44; h += 0.03) {
        for (let x = -0.3; x <= 0.3 + 1e-6; x += 0.025) {
            boxPts.push([Number(x.toFixed(4)), Number(h.toFixed(4)), -0.2]);
            boxPts.push([Number(x.toFixed(4)), Number(h.toFixed(4)), 0.2]);
        }
        for (let z = -0.2; z <= 0.2 + 1e-6; z += 0.025) {
            boxPts.push([-0.3, Number(h.toFixed(4)), Number(z.toFixed(4))]);
            boxPts.push([0.3, Number(h.toFixed(4)), Number(z.toFixed(4))]);
        }
    }

    const resBox = computeSpatialStockpileVolume({
        pointsM: boxPts,
        groundSamplesM: boxGround,
        // Pasar un roiRadiusM legacy pequeño (0.20 m) + targetConstraint real -> debe priorizar targetConstraint!
        roiRadiusM: 0.2,
        anchorCenter: { x: 0, y: 0, z: 0.2 },
        targetConstraint: {
            anchorXZ: [0, 0],
            radiusM: 0.6,
        },
        coveragePct: 96,
        sectorsCovered: 16,
        loopClosed: true,
    });

    const boxErrPct = (Math.abs(resBox.volumeM3 - exactBoxVol) / exactBoxVol) * 100;
    assert.ok(
        boxErrPct < 8,
        `Caja rectangular 0.60x0.40x0.45 m debe tener error < 8% (exacto=0.108, obtenido=${resBox.volumeM3}, err=${boxErrPct.toFixed(2)}%)`
    );
    assert.ok(
        Math.abs(resBox.heightM - 0.45) <= 0.04,
        `Altura de caja esperada ~0.45 m, obtenida=${resBox.heightM}`
    );

    // 2. Acopio cónico 35° con mordida cóncava interior real (< ±8% respecto a volumen analítico con mordida)
    const rCone = 3.0;
    const hCone = rCone * Math.tan((35 * Math.PI) / 180);
    const concavePts: SpatialPoint3D[] = [];
    const concaveGround: SpatialPoint3D[] = [];
    const step = 0.12;
    let exactConcaveVol = 0;
    for (let x = -3.6; x <= 3.6 + 1e-6; x += step) {
        for (let z = -3.6; z <= 3.6 + 1e-6; z += step) {
            const r = Math.hypot(x, z);
            if (r <= rCone) {
                let h = hCone * (1 - r / rCone);
                // Mordida cóncava interior (scoop de cargador frontal en cuadrante +X)
                if (x >= 0.3 && x <= 2.2 && Math.abs(z) <= 1.2) {
                    h *= 0.35;
                }
                exactConcaveVol += h * step * step;
                concavePts.push([Number(x.toFixed(4)), Number(h.toFixed(4)), Number(z.toFixed(4))]);
            } else {
                const gp: SpatialPoint3D = [Number(x.toFixed(4)), 0, Number(z.toFixed(4))];
                concavePts.push(gp);
                concaveGround.push(gp);
            }
        }
    }

    const resConcave = computeSpatialStockpileVolume({
        pointsM: concavePts,
        groundSamplesM: concaveGround,
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
    });
    const concaveErrPct = (Math.abs(resConcave.volumeM3 - exactConcaveVol) / exactConcaveVol) * 100;
    assert.ok(
        concaveErrPct < 8,
        `Acopio con mordida cóncava debe estar dentro de ±8% (exacto=${exactConcaveVol.toFixed(2)}, obtenido=${resConcave.volumeM3}, err=${concaveErrPct.toFixed(2)}%)`
    );
});
