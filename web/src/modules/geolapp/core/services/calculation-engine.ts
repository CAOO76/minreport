import type {
    BoulderDetectionBox2D,
    CopperGovernanceAlert,
    CopperGovernanceResult,
    CopperMineralDomain,
    RosinRammlerProfile,
    StockpileAsset,
} from '../types/GeolappTypes';
import {
    computeRosinRammlerFromBoxes,
    computeRosinRammlerFromPercentiles,
    type RosinRammlerPercentilesInput,
} from '../utils/rosinRammler';

export {
    computeRosinRammlerFromBoxes,
    computeRosinRammlerFromPercentiles,
    type RosinRammlerPercentilesInput,
};

export interface AssetCalculation {
    volume_m3: number;
    factor_applied: number;
    weight_t: number;
    confidence_level: number;
    source: 'manual' | 'inference' | 'default';
}

export interface SuggestionIA {
    density: number;
    confidence: number;
    reasoning: string;
    texture_features?: Record<string, number>;
}

export interface CopperGovernanceInput {
    copperDomain?: CopperMineralDomain | string;
    residenceDays?: number | null;
    moisturePct?: number | null;
    tmlLimitPct?: number | null;
}

function roundTwoDecimals(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * 100) / 100;
}

export class CalculationEngine {
    /**
     * Cálculo Manual: Cono Elíptico
     * Fórmula: (1/3) * PI * r1 * r2 * h (recibe diámetros d1, d2)
     */
    public calculateEllipticCone(d1: number, d2: number, h: number): number {
        if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(h)) return 0;
        if (d1 <= 0 || d2 <= 0 || h <= 0) return 0;
        const r1 = d1 / 2;
        const r2 = d2 / 2;
        const areaBase = Math.PI * r1 * r2;
        return (1 / 3) * areaBase * h;
    }

    /** Alias explícito para cono elíptico */
    public calculateEllipticalConeVolume(d1: number, d2: number, h: number): number {
        return this.calculateEllipticCone(d1, d2, h);
    }

    /**
     * Cálculo Manual: Cono Elíptico Truncado
     * Fórmula: (1/3) * h * (AreaBase + AreaTop + sqrt(AreaBase * AreaTop))
     */
    public calculateTruncatedEllipticCone(
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

        const r1 = d1 / 2;
        const r2 = d2 / 2;
        const r1p = d1p / 2;
        const r2p = d2p / 2;

        const areaBase = Math.PI * r1 * r2;
        const areaTop = Math.PI * r1p * r2p;

        return (1 / 3) * h * (areaBase + areaTop + Math.sqrt(areaBase * areaTop));
    }

    /** Alias explícito para cono elíptico truncado */
    public calculateTruncatedEllipticalConeVolume(
        d1: number,
        d2: number,
        d1p: number,
        d2p: number,
        h: number
    ): number {
        return this.calculateTruncatedEllipticCone(d1, d2, d1p, d2p, h);
    }

    /**
     * Cálculo Manual: Cono Truncado con Perímetro
     * Fórmula: (1/3) * h * (AreaBase + AreaTop + sqrt(AreaBase * AreaTop))
     */
    public calculatePerimeterTruncatedCone(P: number, Pp: number, h: number): number {
        if (!Number.isFinite(P) || !Number.isFinite(Pp) || !Number.isFinite(h)) return 0;
        if (P <= 0 || Pp < 0 || h <= 0) return 0;

        const R = P / (2 * Math.PI);
        const r = Pp / (2 * Math.PI);

        const areaBase = Math.PI * (R * R);
        const areaTop = Math.PI * (r * r);

        return (1 / 3) * h * (areaBase + areaTop + Math.sqrt(areaBase * areaTop));
    }

    /** Alias explícito para cono truncado por perímetro */
    public calculateTruncatedConePerimeterVolume(P: number, Pp: number, h: number): number {
        return this.calculatePerimeterTruncatedCone(P, Pp, h);
    }

    /**
     * Cálculo Manual: Pila Longitudinal / Windrow (Regla Prismoidal 3D)
     * V = (H / 6) * (A_base + 4 * A_mid + A_top)
     * Si crestLengthM se omite usa baseLengthM y si crestWidthM se omite usa 0 (prisma triangular 0.5*L*W*H).
     */
    public calculateWindrowVolume(
        baseLengthM: number,
        baseWidthM: number,
        heightM: number,
        crestLengthM?: number,
        crestWidthM?: number
    ): number {
        if (!Number.isFinite(baseLengthM) || !Number.isFinite(baseWidthM) || !Number.isFinite(heightM)) {
            return 0;
        }
        if (baseLengthM <= 0 || baseWidthM <= 0 || heightM <= 0) {
            return 0;
        }

        const effectiveCrestLength = crestLengthM === undefined ? baseLengthM : crestLengthM;
        const effectiveCrestWidth = crestWidthM === undefined ? 0 : crestWidthM;

        if (!Number.isFinite(effectiveCrestLength) || !Number.isFinite(effectiveCrestWidth)) {
            return 0;
        }
        if (effectiveCrestLength < 0 || effectiveCrestWidth < 0) {
            return 0;
        }

        const areaBase = baseLengthM * baseWidthM;
        const areaTop = effectiveCrestLength * effectiveCrestWidth;
        const midLength = (baseLengthM + effectiveCrestLength) / 2;
        const midWidth = (baseWidthM + effectiveCrestWidth) / 2;
        const areaMid = midLength * midWidth;

        const volume = (heightM / 6) * (areaBase + 4 * areaMid + areaTop);
        return roundTwoDecimals(volume);
    }

    /**
     * Cálculo Manual: Acopio Contra Muro de Contención (Toe-Wall)
     * V = 0.5 * L * W_efectivo * H, descontando cuña del muro si 0 < wallAngleDeg < 90.
     */
    public calculateToeWallStockpileVolume(
        lengthM: number,
        widthFromWallM: number,
        heightAtWallM: number,
        wallAngleDeg = 90
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

        const volume = 0.5 * lengthM * effectiveWidth * heightAtWallM;
        return roundTwoDecimals(volume);
    }

    /**
     * Estima altura total del acopio mediante clinometría trigonométrica IMU.
     * H = max(0, eyeHeight + d_horizontal * tan(pitchDeg))
     */
    public computeHeightFromClinometer(
        pitchDeg: number,
        horizontalDistanceM: number,
        operatorEyeHeightM = 1.6
    ): number {
        if (
            !Number.isFinite(pitchDeg) ||
            !Number.isFinite(horizontalDistanceM) ||
            !Number.isFinite(operatorEyeHeightM)
        ) {
            return 0;
        }
        if (horizontalDistanceM < 0 || operatorEyeHeightM < 0 || Math.abs(pitchDeg) >= 89.9) {
            return 0;
        }
        const rawHeight = Math.max(
            0,
            operatorEyeHeightM + horizontalDistanceM * Math.tan((pitchDeg * Math.PI) / 180)
        );
        return Math.round(rawHeight * 100) / 100;
    }

    /**
     * Evalúa reglas operacionales de envejecimiento de sulfuros Cu y bloqueo TML de concentrado.
     */
    public evaluateCopperGovernance(input: CopperGovernanceInput): CopperGovernanceResult {
        const alerts: CopperGovernanceAlert[] = [];
        const domain = input.copperDomain;

        if (domain === 'SULFURO_SECUNDARIO_CU' || domain === 'SULFURO_PRIMARIO_CU') {
            if (typeof input.residenceDays === 'number' && Number.isFinite(input.residenceDays)) {
                if (input.residenceDays >= 30) {
                    alerts.push({
                        code: 'SULFIDE_AGING_CRITICAL',
                        severity: 'CRITICAL',
                        message:
                            'Envejecimiento critico de sulfuros (>= 30 dias): riesgo de oxidacion superficial y caida de recuperacion metalurgica.',
                        residenceDays: input.residenceDays,
                    });
                } else if (input.residenceDays >= 14) {
                    alerts.push({
                        code: 'SULFIDE_AGING_WARNING',
                        severity: 'WARNING',
                        message:
                            'Alerta de residencia de sulfuros (>= 14 dias): priorizar alimentacion a planta.',
                        residenceDays: input.residenceDays,
                    });
                }
            }
        }

        if (domain === 'CONCENTRADO_CU') {
            if (
                input.moisturePct != null &&
                input.tmlLimitPct != null &&
                Number.isFinite(input.moisturePct) &&
                Number.isFinite(input.tmlLimitPct) &&
                input.moisturePct >= input.tmlLimitPct
            ) {
                alerts.push({
                    code: 'CONCENTRATE_TML_EXCEEDED',
                    severity: 'BLOCK',
                    message:
                        'Humedad >= TML: despacho restringido por limite de humedad transportable en concentrado de cobre.',
                    moisturePct: input.moisturePct,
                    tmlLimitPct: input.tmlLimitPct,
                });
            }
        }

        const hasCriticalBlock = alerts.some((alert) => alert.severity === 'BLOCK');
        return {
            alerts,
            hasCriticalBlock,
            isValidForDispatch: !hasCriticalBlock,
        };
    }

    /**
     * Lógica de Peso: P = V * D
     */
    public computeTotalMass(volume: number, density: number): number {
        if (!Number.isFinite(volume) || !Number.isFinite(density)) return 0;
        return volume * density;
    }

    /**
     * Calcula el factor de densidad real basado en pesaje de romana: D = P / V
     */
    public computeRealTonnage(volume: number, realWeight: number): number {
        if (!Number.isFinite(volume) || !Number.isFinite(realWeight) || volume <= 0) return 0;
        return realWeight / volume;
    }

    /**
     * Compara tonelaje estimado vs real (tolerancia 5%)
     */
    public compareTonnage(estWeight: number, realWeight: number) {
        if (!Number.isFinite(estWeight) || !Number.isFinite(realWeight) || estWeight <= 0) {
            return { differencePercent: 0, isWithinTolerance: true };
        }
        const diff = Math.abs(estWeight - realWeight);
        const percent = (diff / estWeight) * 100;
        return {
            differencePercent: percent,
            isWithinTolerance: percent <= 5,
        };
    }

    /**
     * Sugiere calibración basada en histórico de factores reales
     */
    public getSuggestedCalibration(history: { realFactor: number }[]): number | null {
        if (history.length === 0) return null;
        const sum = history.reduce((acc, curr) => acc + curr.realFactor, 0);
        return parseFloat((sum / history.length).toFixed(3));
    }

    /**
     * Resuelve perfil granulométrico Rosin-Rammler (RRSB) desde percentiles P80 y P50 [mm].
     */
    public computeRosinRammlerFromPercentiles(
        input: RosinRammlerPercentilesInput
    ): RosinRammlerProfile | null {
        return computeRosinRammlerFromPercentiles(input);
    }

    /**
     * Ajusta perfil Rosin-Rammler (RRSB) por regresión Weibull ponderada por d_i^3
     * desde detecciones `box_2d` escaladas por `referenceWidthMeters`.
     */
    public computeRosinRammlerFromBoxes(
        boxes: BoulderDetectionBox2D[],
        referenceWidthMeters: number,
        oversizeThresholdMm = 250
    ): RosinRammlerProfile | null {
        return computeRosinRammlerFromBoxes(boxes, referenceWidthMeters, oversizeThresholdMm);
    }

    /**
     * Prepara metadatos de calibración IA (Predicción -> Corrección Humana -> Resultado Físico)
     */
    public prepareTrainingData(
        asset: Partial<StockpileAsset>,
        suggestion: SuggestionIA | null,
        finalDensity: number
    ): StockpileAsset['training_data'] {
        if (!suggestion) return undefined;

        const applied = asset.tipo_granulometria as string | undefined;

        return {
            original_granulometry_prediction: suggestion.reasoning,
            applied_granulometry: applied,
            photo_texture_features: suggestion.texture_features,
            user_correction: Math.abs(suggestion.density - finalDensity) > 0.05,
        };
    }
}

export const calculationEngine = new CalculationEngine();
