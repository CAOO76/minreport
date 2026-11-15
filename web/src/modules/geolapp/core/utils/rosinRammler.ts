import type {
    BoulderDetectionBox2D,
    RosinRammlerProfile,
    RosinRammlerSievePoint,
} from '../types/GeolappTypes';

export interface RosinRammlerPercentilesInput {
    p80Mm: number;
    p50Mm: number;
    oversizeThresholdMm?: number;
}

export const STANDARD_ROSIN_RAMMLER_SIEVES_MM: readonly number[] = [
    12.5, 25, 50, 75, 100, 150, 200, 250, 350, 500, 750, 1000,
];

const LN_K80 = Math.log(-Math.log(1 - 0.8)); // ln(ln(5))
const LN_K50 = Math.log(-Math.log(1 - 0.5)); // ln(ln(2))
const K80 = -Math.log(1 - 0.8); // ln(5)
const K50 = -Math.log(1 - 0.5); // ln(2)
const K20 = -Math.log(1 - 0.2); // ln(1.25)

function roundDecimals(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function clampPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, roundDecimals(value, 2)));
}

/**
 * Valida estrictamente una caja normalizada `[ymin, xmin, ymax, xmax]` en rango `0..1000`.
 */
export function isValidBox2D(box2d: unknown): box2d is [number, number, number, number] {
    if (!Array.isArray(box2d) || box2d.length !== 4) return false;
    const [ymin, xmin, ymax, xmax] = box2d;
    if (
        typeof ymin !== 'number' ||
        typeof xmin !== 'number' ||
        typeof ymax !== 'number' ||
        typeof xmax !== 'number' ||
        !Number.isFinite(ymin) ||
        !Number.isFinite(xmin) ||
        !Number.isFinite(ymax) ||
        !Number.isFinite(xmax)
    ) {
        return false;
    }
    return ymin >= 0 && ymin < ymax && ymax <= 1000 && xmin >= 0 && xmin < xmax && xmax <= 1000;
}

/**
 * Calcula el diámetro equivalente en milímetros de una detección `box_2d` `[ymin, xmin, ymax, xmax]`
 * escalada por el ancho real de la escena (`referenceWidthMeters > 0`).
 */
export function computeBoxEquivalentDiameterMm(
    box2d: [number, number, number, number],
    referenceWidthMeters: number
): number | null {
    if (!isValidBox2D(box2d) || !Number.isFinite(referenceWidthMeters) || referenceWidthMeters <= 0) {
        return null;
    }
    const [ymin, xmin, ymax, xmax] = box2d;
    const widthMm = (xmax - xmin) * referenceWidthMeters;
    const heightMm = (ymax - ymin) * referenceWidthMeters;
    const eqMm = Math.sqrt(widthMm * heightMm);
    return Number.isFinite(eqMm) && eqMm > 0 ? eqMm : null;
}

/**
 * Genera la curva granulométrica estándar RRSB:
 * `R(x) = exp(-(x / xc)^n)` y `P(x) = 1 - R(x)`.
 */
export function buildRosinRammlerCurve(xcMm: number, uniformityN: number): RosinRammlerSievePoint[] {
    return STANDARD_ROSIN_RAMMLER_SIEVES_MM.map((sizeMm) => {
        const exponent = -Math.pow(sizeMm / xcMm, uniformityN);
        const passingRaw = 100 * (1 - Math.exp(exponent));
        const passingPct = clampPct(passingRaw);
        const retainedPct = clampPct(100 - passingPct);
        return {
            size_mm: sizeMm,
            passing_pct: passingPct,
            retained_pct: retainedPct,
        };
    });
}

/**
 * Resuelve de forma determinista el modelo Rosin-Rammler-Sperling-Bennet (RRSB)
 * a partir de percentiles medidos `P80 > P50 > 0` [mm].
 * Retorna `null` si los parámetros son inválidos (tolerancia cero a datos inventados).
 */
export function computeRosinRammlerFromPercentiles(
    input: RosinRammlerPercentilesInput
): RosinRammlerProfile | null {
    const { p80Mm, p50Mm, oversizeThresholdMm = 250 } = input || ({} as RosinRammlerPercentilesInput);

    if (
        !Number.isFinite(p80Mm) ||
        !Number.isFinite(p50Mm) ||
        !Number.isFinite(oversizeThresholdMm) ||
        p50Mm <= 0 ||
        p80Mm <= p50Mm ||
        oversizeThresholdMm <= 0
    ) {
        return null;
    }

    const logRatio = Math.log(p80Mm / p50Mm);
    if (!Number.isFinite(logRatio) || logRatio <= 0) {
        return null;
    }

    const uniformityN = (LN_K80 - LN_K50) / logRatio;
    if (!Number.isFinite(uniformityN) || uniformityN <= 0) {
        return null;
    }

    const xcMm = p50Mm / Math.pow(K50, 1 / uniformityN);
    if (!Number.isFinite(xcMm) || xcMm <= 0) {
        return null;
    }

    const p20Mm = xcMm * Math.pow(K20, 1 / uniformityN);
    if (!Number.isFinite(p20Mm) || p20Mm <= 0) {
        return null;
    }

    return {
        xc_mm: roundDecimals(xcMm, 2),
        uniformity_n: roundDecimals(uniformityN, 4),
        p80_mm: roundDecimals(p80Mm, 2),
        p50_mm: roundDecimals(p50Mm, 2),
        p20_mm: roundDecimals(p20Mm, 2),
        oversize_count: 0,
        oversize_threshold_mm: roundDecimals(oversizeThresholdMm, 2),
        source: 'MANUAL_PERCENTILES',
        curve: buildRosinRammlerCurve(xcMm, uniformityN),
    };
}

/**
 * Ajusta el perfil Rosin-Rammler `(xc_mm, uniformity_n)` mediante regresión lineal Weibull
 * sobre la distribución acumulada ponderada por volumen (`d_i^3`) a partir de detecciones `box_2d`
 * escaladas por `referenceWidthMeters`.
 * Retorna `null` si existen `< 2` cajas válidas, `referenceWidthMeters <= 0` o varianza nula de tamaños.
 */
export function computeRosinRammlerFromBoxes(
    boxes: BoulderDetectionBox2D[],
    referenceWidthMeters: number,
    oversizeThresholdMm = 250
): RosinRammlerProfile | null {
    if (
        !Array.isArray(boxes) ||
        !Number.isFinite(referenceWidthMeters) ||
        referenceWidthMeters <= 0 ||
        !Number.isFinite(oversizeThresholdMm) ||
        oversizeThresholdMm <= 0
    ) {
        return null;
    }

    const diametersMm: number[] = [];
    for (const box of boxes) {
        if (!box || !isValidBox2D(box.box_2d)) continue;
        const eqMm = computeBoxEquivalentDiameterMm(box.box_2d, referenceWidthMeters);
        if (eqMm !== null && eqMm > 0) {
            diametersMm.push(eqMm);
        }
    }

    if (diametersMm.length < 2) {
        return null;
    }

    diametersMm.sort((a, b) => a - b);
    const maxBoulderMm = diametersMm[diametersMm.length - 1];
    const oversizeCount = diametersMm.filter((d) => d >= oversizeThresholdMm).length;

    // Ponderación volumétrica d_i^3 para aproximar fracción másica acumulada
    const weights = diametersMm.map((d) => Math.pow(d, 3));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return null;
    }

    const xPoints: number[] = [];
    const yPoints: number[] = [];
    let cumulativeWeight = 0;

    for (let i = 0; i < diametersMm.length; i++) {
        const w = weights[i];
        const passingMid = (cumulativeWeight + 0.5 * w) / totalWeight;
        cumulativeWeight += w;

        const clampedPassing = Math.min(1 - 1e-9, Math.max(1e-9, passingMid));
        const retained = 1 - clampedPassing;
        const weibullY = Math.log(-Math.log(retained));
        const logX = Math.log(diametersMm[i]);

        if (!Number.isFinite(weibullY) || !Number.isFinite(logX)) {
            return null;
        }
        xPoints.push(logX);
        yPoints.push(weibullY);
    }

    const count = xPoints.length;
    const meanX = xPoints.reduce((acc, x) => acc + x, 0) / count;
    const meanY = yPoints.reduce((acc, y) => acc + y, 0) / count;

    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < count; i++) {
        const dx = xPoints[i] - meanX;
        const dy = yPoints[i] - meanY;
        sxx += dx * dx;
        sxy += dx * dy;
    }

    // Sin varianza en los diámetros medidos no es posible ajustar pendiente sin inventar parámetros
    if (!Number.isFinite(sxx) || sxx <= 1e-12 || !Number.isFinite(sxy) || sxy <= 0) {
        return null;
    }

    const uniformityN = sxy / sxx;
    if (!Number.isFinite(uniformityN) || uniformityN <= 0) {
        return null;
    }

    const xcMm = Math.exp(meanX - meanY / uniformityN);
    if (!Number.isFinite(xcMm) || xcMm <= 0) {
        return null;
    }

    const p80Mm = xcMm * Math.pow(K80, 1 / uniformityN);
    const p50Mm = xcMm * Math.pow(K50, 1 / uniformityN);
    const p20Mm = xcMm * Math.pow(K20, 1 / uniformityN);

    if (!Number.isFinite(p80Mm) || !Number.isFinite(p50Mm) || !Number.isFinite(p20Mm)) {
        return null;
    }

    return {
        xc_mm: roundDecimals(xcMm, 2),
        uniformity_n: roundDecimals(uniformityN, 4),
        p80_mm: roundDecimals(p80Mm, 2),
        p50_mm: roundDecimals(p50Mm, 2),
        p20_mm: roundDecimals(p20Mm, 2),
        max_boulder_mm: roundDecimals(maxBoulderMm, 2),
        oversize_count: oversizeCount,
        oversize_threshold_mm: roundDecimals(oversizeThresholdMm, 2),
        source: 'VISION_BOX2D_SCALED',
        curve: buildRosinRammlerCurve(xcMm, uniformityN),
    };
}
