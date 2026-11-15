/**
 * Motor Determinista de Cálculos Geocientíficos y Topográficos (Fase 4 GEOLAPP®).
 * Funciones puras sin dependencias externas para geomensura UTM, exploración/RQD,
 * QA/QC RPD, regla de mano derecha y proyección equiareal Lambert-Schmidt.
 */

import type { DrillholeRqdQuality } from '../types/GeolappTypes';

export interface UtmCoordinate3D {
    easting: number;
    northing: number;
    elevationM: number;
}

export interface UtmCoordinate2D {
    easting: number;
    northing: number;
}

export interface UtmStakeoutResult {
    deltaE: number;
    deltaN: number;
    deltaZ: number;
    horizontalDistanceM: number;
    slopeDistanceM: number;
    azimuthDeg: number;
    slopePct: number;
}

export interface UtmPolygonMensuraResult {
    areaM2: number;
    areaHa: number;
    perimeterM: number;
    centroid: UtmCoordinate2D;
}

export interface IntervalRqdRecoveryResult {
    runLengthM: number;
    recoveryPct: number;
    rqdPct: number;
    rqdQuality: DrillholeRqdQuality;
}

export interface CompositeIntervalInput {
    fromM: number;
    toM: number;
    recoveryPct?: number | null;
    rqdPct?: number | null;
    cuTotalPct?: number | null;
    cuSolublePct?: number | null;
}

export interface DrillholeCompositesResult {
    weightedCuTotalPct: number | null;
    weightedCuSolublePct: number | null;
    meanRqdPct: number | null;
    meanRecoveryPct: number | null;
    totalLoggedLengthM: number;
}

export interface QaQcRpdResult {
    rpdPct: number;
    maxRpdPct: number;
    passed: boolean;
}

export interface StructuralAttitudeResult {
    dipDeg: number;
    dipDirectionDeg: number;
    strikeDeg: number;
}

export interface EqualAreaPoleProjection {
    x: number;
    y: number;
    r: number;
}

function normalizeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

function normalizeAzimuthDeg(deg: number): number {
    const wrapped = ((deg % 360) + 360) % 360;
    return normalizeZero(wrapped >= 360 ? 0 : wrapped);
}

/**
 * Calcula vectores de replanteo y radiación topográfica entre estación y objetivo UTM 3D.
 */
export function computeUtmStakeout(
    station: UtmCoordinate3D,
    target: UtmCoordinate3D
): UtmStakeoutResult {
    const deltaE = normalizeZero(target.easting - station.easting);
    const deltaN = normalizeZero(target.northing - station.northing);
    const deltaZ = normalizeZero(target.elevationM - station.elevationM);
    const horizontalDistanceM = normalizeZero(Math.hypot(deltaE, deltaN));
    const slopeDistanceM = normalizeZero(Math.hypot(horizontalDistanceM, deltaZ));
    const azimuthDeg =
        horizontalDistanceM === 0
            ? 0
            : normalizeAzimuthDeg((Math.atan2(deltaE, deltaN) * 180) / Math.PI);
    const slopePct =
        horizontalDistanceM > 0 ? normalizeZero((deltaZ / horizontalDistanceM) * 100) : 0;

    return {
        deltaE,
        deltaN,
        deltaZ,
        horizontalDistanceM,
        slopeDistanceM,
        azimuthDeg,
        slopePct,
    };
}

/**
 * Calcula superficie, perímetro y centroide de un polígono UTM mediante fórmula de Gauss (Shoelace)
 * desplazada al vértice origen para estabilidad numérica en coordenadas métricas sudamericanas.
 */
export function computeUtmPolygonMensura(
    vertices: UtmCoordinate2D[]
): UtmPolygonMensuraResult | null {
    if (!Array.isArray(vertices) || vertices.length < 3) {
        return null;
    }

    for (const v of vertices) {
        if (!v || !Number.isFinite(v.easting) || !Number.isFinite(v.northing)) {
            return null;
        }
    }

    const e0 = vertices[0].easting;
    const n0 = vertices[0].northing;

    let twiceSignedArea = 0;
    let cxSum = 0;
    let cySum = 0;
    let perimeterM = 0;

    const count = vertices.length;
    for (let i = 0; i < count; i += 1) {
        const current = vertices[i];
        const next = vertices[(i + 1) % count];
        const x1 = current.easting - e0;
        const y1 = current.northing - n0;
        const x2 = next.easting - e0;
        const y2 = next.northing - n0;

        const cross = x1 * y2 - x2 * y1;
        twiceSignedArea += cross;
        cxSum += (x1 + x2) * cross;
        cySum += (y1 + y2) * cross;
        perimeterM += Math.hypot(x2 - x1, y2 - y1);
    }

    const areaM2 = Math.abs(twiceSignedArea) / 2;
    if (!Number.isFinite(areaM2) || areaM2 <= 0) {
        return null;
    }

    const areaHa = areaM2 / 10000;
    const centroidEasting = e0 + cxSum / (3 * twiceSignedArea);
    const centroidNorthing = n0 + cySum / (3 * twiceSignedArea);

    return {
        areaM2: normalizeZero(areaM2),
        areaHa: normalizeZero(areaHa),
        perimeterM: normalizeZero(perimeterM),
        centroid: {
            easting: normalizeZero(centroidEasting),
            northing: normalizeZero(centroidNorthing),
        },
    };
}

/**
 * Calcula recuperación de testigo (TCR) y RQD bajo escala de Deere (1964) para una corrida de sondaje.
 */
export function computeIntervalRqdAndRecovery(
    fromM: number,
    toM: number,
    recoveredM: number,
    sumPiecesGe10cmM: number
): IntervalRqdRecoveryResult | null {
    if (
        !Number.isFinite(fromM) ||
        !Number.isFinite(toM) ||
        !Number.isFinite(recoveredM) ||
        !Number.isFinite(sumPiecesGe10cmM)
    ) {
        return null;
    }

    if (fromM < 0 || toM <= fromM) {
        return null;
    }

    const runLengthM = toM - fromM;
    const clampedRecoveredM = Math.min(runLengthM, Math.max(0, recoveredM));
    const clampedPiecesM = Math.min(clampedRecoveredM, Math.max(0, sumPiecesGe10cmM));

    const recoveryPct = normalizeZero((clampedRecoveredM / runLengthM) * 100);
    const rqdPct = normalizeZero((clampedPiecesM / runLengthM) * 100);

    let rqdQuality: DrillholeRqdQuality;
    if (rqdPct < 25) {
        rqdQuality = 'MUY_MALA';
    } else if (rqdPct < 50) {
        rqdQuality = 'MALA';
    } else if (rqdPct < 75) {
        rqdQuality = 'REGULAR';
    } else if (rqdPct < 90) {
        rqdQuality = 'BUENA';
    } else {
        rqdQuality = 'EXCELENTE';
    }

    return {
        runLengthM: normalizeZero(runLengthM),
        recoveryPct,
        rqdPct,
        rqdQuality,
    };
}

/**
 * Calcula compositado ponderado por largo de muestra (toM - fromM) en un sondaje.
 */
export function computeDrillholeComposites(
    intervals: CompositeIntervalInput[]
): DrillholeCompositesResult {
    if (!Array.isArray(intervals) || intervals.length === 0) {
        return {
            weightedCuTotalPct: null,
            weightedCuSolublePct: null,
            meanRqdPct: null,
            meanRecoveryPct: null,
            totalLoggedLengthM: 0,
        };
    }

    let totalLoggedLengthM = 0;
    let cuTotalWeightedSum = 0;
    let cuTotalLen = 0;
    let cuSolubleWeightedSum = 0;
    let cuSolubleLen = 0;
    let rqdWeightedSum = 0;
    let rqdLen = 0;
    let recWeightedSum = 0;
    let recLen = 0;

    for (const item of intervals) {
        if (!item || !Number.isFinite(item.fromM) || !Number.isFinite(item.toM)) {
            continue;
        }
        const len = item.toM - item.fromM;
        if (len <= 0) {
            continue;
        }
        totalLoggedLengthM += len;

        if (typeof item.cuTotalPct === 'number' && Number.isFinite(item.cuTotalPct)) {
            cuTotalWeightedSum += item.cuTotalPct * len;
            cuTotalLen += len;
        }
        if (typeof item.cuSolublePct === 'number' && Number.isFinite(item.cuSolublePct)) {
            cuSolubleWeightedSum += item.cuSolublePct * len;
            cuSolubleLen += len;
        }
        if (typeof item.rqdPct === 'number' && Number.isFinite(item.rqdPct)) {
            rqdWeightedSum += item.rqdPct * len;
            rqdLen += len;
        }
        if (typeof item.recoveryPct === 'number' && Number.isFinite(item.recoveryPct)) {
            recWeightedSum += item.recoveryPct * len;
            recLen += len;
        }
    }

    return {
        weightedCuTotalPct:
            cuTotalLen > 0 ? normalizeZero(cuTotalWeightedSum / cuTotalLen) : null,
        weightedCuSolublePct:
            cuSolubleLen > 0 ? normalizeZero(cuSolubleWeightedSum / cuSolubleLen) : null,
        meanRqdPct: rqdLen > 0 ? normalizeZero(rqdWeightedSum / rqdLen) : null,
        meanRecoveryPct: recLen > 0 ? normalizeZero(recWeightedSum / recLen) : null,
        totalLoggedLengthM: normalizeZero(totalLoggedLengthM),
    };
}

/**
 * Evalúa Diferencia Porcentual Relativa (RPD) para control QA/QC de duplicados geoquímicos.
 */
export function evaluateQaQcRpd(
    originalVal: number,
    duplicateVal: number,
    maxRpdPct = 10
): QaQcRpdResult {
    const safeMax = Number.isFinite(maxRpdPct) && maxRpdPct >= 0 ? maxRpdPct : 10;

    if (!Number.isFinite(originalVal) || !Number.isFinite(duplicateVal)) {
        return { rpdPct: 0, maxRpdPct: safeMax, passed: false };
    }

    if (originalVal === 0 && duplicateVal === 0) {
        return { rpdPct: 0, maxRpdPct: safeMax, passed: true };
    }

    const denom = (Math.abs(originalVal) + Math.abs(duplicateVal)) / 2;
    if (denom === 0) {
        return { rpdPct: 0, maxRpdPct: safeMax, passed: false };
    }

    const rpdPct = normalizeZero((Math.abs(originalVal - duplicateVal) / denom) * 100);
    return {
        rpdPct,
        maxRpdPct: safeMax,
        passed: rpdPct <= safeMax,
    };
}

/**
 * Calcula rumbo estructural (Strike) bajo Regla de la Mano Derecha (RHR) a partir de Dip Direction.
 */
export function computeStrikeRightHandRule(dipDirectionDeg: number): number {
    if (!Number.isFinite(dipDirectionDeg)) {
        return 0;
    }
    return normalizeAzimuthDeg(dipDirectionDeg - 90);
}

/**
 * Convierte lecturas inerciales (pitch/roll en grados) y rumbo magnético opcional en actitud estructural.
 */
export function imuToStructuralAttitude(
    pitchDeg: number,
    rollDeg: number,
    compassAzimuthDeg?: number | null
): StructuralAttitudeResult {
    const safePitch = Number.isFinite(pitchDeg) ? pitchDeg : 0;
    const safeRoll = Number.isFinite(rollDeg) ? rollDeg : 0;

    const dipDeg = normalizeZero(
        Math.min(90, Math.round(Math.hypot(safePitch, safeRoll) * 10) / 10)
    );

    const hasTilt = safePitch !== 0 || safeRoll !== 0;
    const tiltOffsetDeg = hasTilt ? (Math.atan2(safeRoll, safePitch) * 180) / Math.PI : 0;

    const baseAzimuth =
        typeof compassAzimuthDeg === 'number' && Number.isFinite(compassAzimuthDeg)
            ? compassAzimuthDeg
            : 0;

    const dipDirectionDeg = normalizeAzimuthDeg(baseAzimuth + tiltOffsetDeg);
    const strikeDeg = computeStrikeRightHandRule(dipDirectionDeg);

    return {
        dipDeg,
        dipDirectionDeg,
        strikeDeg,
    };
}

/**
 * Proyecta el polo normal de un plano en red equiareal Lambert-Schmidt (hemisferio inferior).
 */
export function projectEqualAreaPole(
    dipDeg: number,
    dipDirectionDeg: number,
    radiusPx: number
): EqualAreaPoleProjection {
    const safeRadius = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
    const clampedDip = Number.isFinite(dipDeg) ? Math.min(90, Math.max(0, dipDeg)) : 0;
    const safeDipDir = Number.isFinite(dipDirectionDeg) ? dipDirectionDeg : 0;

    const r = normalizeZero(
        Math.min(safeRadius, safeRadius * Math.SQRT2 * Math.sin((clampedDip * Math.PI) / 360))
    );
    const thetaDeg = normalizeAzimuthDeg(safeDipDir + 180);
    const thetaRad = (thetaDeg * Math.PI) / 180;

    const x = normalizeZero(r * Math.sin(thetaRad));
    const y = normalizeZero(-r * Math.cos(thetaRad));

    return { x, y, r };
}

/**
 * Genera el trazado SVG (`M ... L ...`) del círculo mayor de un plano estructural
 * en proyección equiareal Lambert-Schmidt (hemisferio inferior) centrado en (cx, cy).
 */
export function buildEqualAreaGreatCircleSvgPath(
    dipDeg: number,
    dipDirectionDeg: number,
    cx: number,
    cy: number,
    radiusPx: number,
    segments = 36
): string {
    const safeRadius = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
    const safeCx = Number.isFinite(cx) ? cx : 0;
    const safeCy = Number.isFinite(cy) ? cy : 0;
    const safeSegments = Number.isInteger(segments) && segments >= 2 ? segments : 36;
    const clampedDip = Number.isFinite(dipDeg) ? Math.min(90, Math.max(0, dipDeg)) : 0;
    const safeDipDir = Number.isFinite(dipDirectionDeg) ? dipDirectionDeg : 0;

    const points: Array<{ x: number; y: number }> = [];

    if (clampedDip >= 89.95) {
        const strikeRad = (computeStrikeRightHandRule(safeDipDir) * Math.PI) / 180;
        for (let i = 0; i <= safeSegments; i += 1) {
            const t = -1 + (2 * i) / safeSegments;
            const x = safeCx + safeRadius * t * Math.sin(strikeRad);
            const y = safeCy - safeRadius * t * Math.cos(strikeRad);
            points.push({ x, y });
        }
    } else {
        const dipRad = (clampedDip * Math.PI) / 180;
        const tanDip = Math.tan(dipRad);
        for (let i = 0; i <= safeSegments; i += 1) {
            const psiDeg = -90 + (180 * i) / safeSegments;
            const psiRad = (psiDeg * Math.PI) / 180;
            const pAppRad = Math.atan(tanDip * Math.cos(psiRad));
            const r = Math.min(
                safeRadius,
                safeRadius * Math.SQRT2 * Math.sin((Math.PI / 2 - pAppRad) / 2)
            );
            const trendDeg = normalizeAzimuthDeg(safeDipDir + psiDeg);
            const trendRad = (trendDeg * Math.PI) / 180;
            const x = safeCx + r * Math.sin(trendRad);
            const y = safeCy - r * Math.cos(trendRad);
            points.push({ x, y });
        }
    }

    return points
        .map((pt, idx) => {
            const cmd = idx === 0 ? 'M' : 'L';
            return `${cmd} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
        })
        .join(' ');
}
