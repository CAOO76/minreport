/**
 * Motor Geométrico Determinista v2 (Servidor southamerica-west1)
 * Alineado 1:1 con web/src/modules/geolapp/core/services/calculation-engine.ts.
 * Considera taludes naturales de reposo (35°–45°) en acopios de mineral y botaderos.
 */

export type SlopeConfinementMode = 'BUNKER_3_WALLS' | 'SINGLE_WALL';

export interface SlopeAwareWindrowInput {
    baseLengthM: number;
    baseWidthM: number;
    heightM: number;
    crestLengthM?: number;
    crestWidthM?: number;
    slopeAngleDeg?: number;
}

export interface ToeWallVolumeOptions {
    confinement?: SlopeConfinementMode;
    slopeAngleDeg?: number;
    crestWidthM?: number;
}

export interface SlopePhysicsEvaluation {
    implicitSlopeDeg: number | null;
    withinReposeRange: boolean;
    status: 'OPTIMAL' | 'SHALLOW' | 'STEEP_WARNING' | 'UNDECLARED';
    warning: string | null;
}

function roundTwoDecimals(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * 100) / 100;
}

function roundOneDecimal(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 10) / 10;
}

export function calculateEllipticCone(d1: number, d2: number, h: number): number {
    if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(h)) return 0;
    if (d1 <= 0 || d2 <= 0 || h <= 0) return 0;
    const areaBase = Math.PI * (d1 / 2) * (d2 / 2);
    return (1 / 3) * areaBase * h;
}

/**
 * Integral prismoidal exacta para cono elíptico truncado sin exigir semejanza base/corona.
 * V = (pi * h / 24) * (2*d1*d2 + 2*d1p*d2p + d1*d2p + d2*d1p)
 */
export function calculateTruncatedEllipticCone(
    d1: number,
    d2: number,
    d1p: number,
    d2p: number,
    h: number
): number {
    if (
        !Number.isFinite(d1) ||
        !Number.isFinite(d2) ||
        !Number.isFinite(d1p) ||
        !Number.isFinite(d2p) ||
        !Number.isFinite(h)
    ) {
        return 0;
    }
    if (d1 <= 0 || d2 <= 0 || d1p < 0 || d2p < 0 || h <= 0) return 0;
    if (d1p > d1 || d2p > d2) return 0;

    return ((Math.PI * h) / 24) * (2 * d1 * d2 + 2 * d1p * d2p + d1 * d2p + d2 * d1p);
}

export function calculatePerimeterTruncatedCone(P: number, Pp: number, h: number): number {
    if (!Number.isFinite(P) || !Number.isFinite(Pp) || !Number.isFinite(h)) return 0;
    if (P <= 0 || Pp < 0 || h <= 0 || Pp > P) return 0;

    const R = P / (2 * Math.PI);
    const r = Pp / (2 * Math.PI);
    const areaBase = Math.PI * R * R;
    const areaTop = Math.PI * r * r;
    return (1 / 3) * h * (areaBase + areaTop + Math.sqrt(areaBase * areaTop));
}

/**
 * Cordón / Botadero longitudinal con cabeceras semiconoides naturales por talud.
 * Deduce cresta desde slopeAngleDeg si no se declara explícitamente.
 */
export function calculateSlopeAwareWindrowVolume(input: SlopeAwareWindrowInput): number {
    const { baseLengthM, baseWidthM, heightM, crestLengthM, crestWidthM } = input;
    const slopeAngleDeg =
        typeof input.slopeAngleDeg === 'number' && Number.isFinite(input.slopeAngleDeg)
            ? Math.min(89.9, Math.max(15, input.slopeAngleDeg))
            : 40;

    if (!Number.isFinite(baseLengthM) || !Number.isFinite(baseWidthM) || !Number.isFinite(heightM)) {
        return 0;
    }
    if (baseLengthM <= 0 || baseWidthM <= 0 || heightM <= 0) {
        return 0;
    }

    const deltaR = slopeAngleDeg < 89.9 ? heightM / Math.tan((slopeAngleDeg * Math.PI) / 180) : 0;
    const effCrestWidth =
        crestWidthM !== undefined
            ? crestWidthM
            : Math.max(0, baseWidthM - 2 * deltaR);

    if (!Number.isFinite(effCrestWidth) || effCrestWidth < 0 || effCrestWidth > baseWidthM) {
        return 0;
    }

    const straightLength =
        crestLengthM !== undefined
            ? Math.max(0, Math.min(crestLengthM, baseLengthM - effCrestWidth))
            : Math.max(0, baseLengthM - baseWidthM);

    if (crestLengthM !== undefined && (!Number.isFinite(crestLengthM) || crestLengthM < 0 || crestLengthM > baseLengthM)) {
        return 0;
    }

    const centralVolume = ((baseWidthM + effCrestWidth) / 2) * heightM * straightLength;
    const endBaseDiameter = Math.max(0, baseLengthM - straightLength);
    const endVolume =
        endBaseDiameter > 0
            ? calculateTruncatedEllipticCone(
                  endBaseDiameter,
                  baseWidthM,
                  effCrestWidth,
                  effCrestWidth,
                  heightM
              )
            : 0;

    return roundTwoDecimals(centralVolume + endVolume);
}

export function calculateToeWallStockpileVolume(
    lengthM: number,
    widthFromWallM: number,
    heightAtWallM: number,
    wallAngleDeg = 90,
    options: ToeWallVolumeOptions = {}
): number {
    if (
        !Number.isFinite(lengthM) ||
        !Number.isFinite(widthFromWallM) ||
        !Number.isFinite(heightAtWallM) ||
        !Number.isFinite(wallAngleDeg)
    ) {
        return 0;
    }
    if (lengthM <= 0 || widthFromWallM <= 0 || heightAtWallM <= 0 || wallAngleDeg <= 0) {
        return 0;
    }

    let effectiveWidth = widthFromWallM;
    if (wallAngleDeg > 0 && wallAngleDeg < 90) {
        const wallProjectionM = heightAtWallM / Math.tan((wallAngleDeg * Math.PI) / 180);
        effectiveWidth = Math.max(0, widthFromWallM - wallProjectionM);
    }
    if (effectiveWidth <= 0) return 0;

    if (options.confinement === 'SINGLE_WALL') {
        const slopeDeg =
            typeof options.slopeAngleDeg === 'number' && Number.isFinite(options.slopeAngleDeg)
                ? Math.min(89.9, Math.max(15, options.slopeAngleDeg))
                : 40;
        const endRadiusM = Math.min(
            lengthM / 2,
            heightAtWallM / Math.tan((slopeDeg * Math.PI) / 180)
        );
        const straightLenM = Math.max(0, lengthM - 2 * endRadiusM);
        const vol =
            0.5 * straightLenM * effectiveWidth * heightAtWallM +
            (Math.PI / 6) * endRadiusM * effectiveWidth * heightAtWallM;
        return roundTwoDecimals(vol);
    }

    const crestW = Math.min(effectiveWidth, Math.max(0, options.crestWidthM ?? 0));
    const vol = ((effectiveWidth + crestW) / 2) * lengthM * heightAtWallM;
    return roundTwoDecimals(vol);
}

export function evaluateStockpileSlopePhysics(params: {
    geometryType: string;
    dimensions: Record<string, number | undefined>;
}): SlopePhysicsEvaluation {
    const dim = params.dimensions || {};
    const h = Number(dim.h ?? dim.heightM ?? 0);
    if (!Number.isFinite(h) || h <= 0) {
        return {
            implicitSlopeDeg: null,
            withinReposeRange: false,
            status: 'UNDECLARED',
            warning: null,
        };
    }

    let runM = 0;
    switch (params.geometryType) {
        case 'CONO_ELIPTICO': {
            const a = Number(dim.a ?? dim.d1 ?? 0);
            const b = Number(dim.b ?? dim.d2 ?? 0);
            const minDia = Math.min(a, b);
            runM = minDia > 0 ? minDia / 2 : 0;
            break;
        }
        case 'CONO_ELIPTICO_TRUNCADO': {
            const a = Number(dim.a ?? dim.d1 ?? 0);
            const b = Number(dim.b ?? dim.d2 ?? 0);
            const ap = Number(dim.ap ?? dim.d1p ?? 0);
            const bp = Number(dim.bp ?? dim.d2p ?? 0);
            const runA = a > ap ? (a - ap) / 2 : 0;
            const runB = b > bp ? (b - bp) / 2 : 0;
            runM = runA > 0 && runB > 0 ? Math.min(runA, runB) : Math.max(runA, runB);
            break;
        }
        case 'CONO_TRUNCADO_PERIMETRO': {
            const p = Number(dim.p ?? 0);
            const pp = Number(dim.pp ?? 0);
            runM = p > pp ? (p - pp) / (2 * Math.PI) : 0;
            break;
        }
        case 'PILA_LONGITUDINAL_WINDROW': {
            const wb = Number(dim.base_width_m ?? dim.baseWidthM ?? dim.b ?? 0);
            const wc = Number(dim.crest_width_m ?? dim.crestWidthM ?? 0);
            runM = wb > wc ? (wb - wc) / 2 : 0;
            break;
        }
        case 'ACOPIO_CONTRA_MURO': {
            const w = Number(dim.width_from_wall_m ?? dim.widthFromWallM ?? dim.b ?? 0);
            runM = w > 0 ? w : 0;
            break;
        }
        default:
            break;
    }

    if (!Number.isFinite(runM) || runM <= 0) {
        return {
            implicitSlopeDeg: null,
            withinReposeRange: false,
            status: 'UNDECLARED',
            warning: null,
        };
    }

    const angleDeg = roundOneDecimal((Math.atan2(h, runM) * 180) / Math.PI);
    if (angleDeg > 48) {
        return {
            implicitSlopeDeg: angleDeg,
            withinReposeRange: false,
            status: 'STEEP_WARNING',
            warning: `Talud implícito ${angleDeg}° excede ángulo límite físico natural (~45°–48°). Verifique altura o escala.`,
        };
    }
    if (angleDeg < 28) {
        return {
            implicitSlopeDeg: angleDeg,
            withinReposeRange: false,
            status: 'SHALLOW',
            warning: null,
        };
    }
    return {
        implicitSlopeDeg: angleDeg,
        withinReposeRange: true,
        status: 'OPTIMAL',
        warning: null,
    };
}

export function computeStockpileVolumeV2(params: {
    geometryType: string;
    dimensions: Record<string, number | undefined>;
    confinement?: SlopeConfinementMode;
    slopeAngleDeg?: number;
}): number {
    const dim = params.dimensions || {};
    const a = Number(dim.a ?? dim.base_length_m ?? dim.length_m ?? 0);
    const b = Number(dim.b ?? dim.base_width_m ?? dim.width_from_wall_m ?? 0);
    const h = Number(dim.h ?? dim.heightM ?? 0);
    const ap = Number(dim.ap ?? dim.crest_length_m ?? 0);
    const bp = Number(dim.bp ?? dim.crest_width_m ?? 0);
    const slopeDeg =
        typeof params.slopeAngleDeg === 'number' && Number.isFinite(params.slopeAngleDeg)
            ? params.slopeAngleDeg
            : Number(dim.slope_angle_deg ?? 40);

    switch (params.geometryType) {
        case 'CONO_ELIPTICO':
            return roundTwoDecimals(calculateEllipticCone(a, b, h));
        case 'CONO_ELIPTICO_TRUNCADO':
            return roundTwoDecimals(calculateTruncatedEllipticCone(a, b, ap, bp, h));
        case 'PILA_LONGITUDINAL_WINDROW':
            return calculateSlopeAwareWindrowVolume({
                baseLengthM: a,
                baseWidthM: b,
                heightM: h,
                crestLengthM: Number.isFinite(dim.crest_length_m) ? dim.crest_length_m : undefined,
                crestWidthM: Number.isFinite(dim.crest_width_m) ? dim.crest_width_m : undefined,
                slopeAngleDeg: slopeDeg,
            });
        case 'ACOPIO_CONTRA_MURO':
            return calculateToeWallStockpileVolume(a, b, h, Number(dim.wall_angle_deg ?? 90), {
                confinement: params.confinement || 'SINGLE_WALL',
                slopeAngleDeg: slopeDeg,
                crestWidthM: Number.isFinite(dim.crest_width_m) ? dim.crest_width_m : undefined,
            });
        default:
            return roundTwoDecimals(calculateEllipticCone(a, b, h));
    }
}
