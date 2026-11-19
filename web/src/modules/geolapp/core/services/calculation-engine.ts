import type {
    BoulderDetectionBox2D,
    CopperGovernanceAlert,
    CopperGovernanceResult,
    CopperMineralDomain,
    RosinRammlerProfile,
    StockpileAsset,
    StockpileMeasurement,
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

export interface StockpileMeasurementChainSummary {
    latestActive: StockpileMeasurement | null;
    previousActive: StockpileMeasurement | null;
    lastPhotoUrl?: string;
    lastVolumeM3: number | null;
    lastWeightT: number | null;
    lastDeltaVolumenM3: number | null;
    lastDeltaVolumenPct: number | null;
}

export interface StockpileMeasurementChainResult {
    enrichedMeasurements: StockpileMeasurement[];
    summary: StockpileMeasurementChainSummary;
}

function roundSignedTwo(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function roundSignedOne(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.round(value * 10) / 10;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function isCleanPhotoUrl(url?: string | null): url is string {
    return Boolean(url && typeof url === 'string' && url.trim().length > 0 && !url.startsWith('data:'));
}

/**
 * Calcula de forma determinista la cadena cronológica fotográfica (`previous_measurement_id`,
 * `previous_photo_url`) y las variaciones volumétricas/tonelaje (`delta_volumen`,
 * `delta_volumen_pct`, `delta_peso`) entre mediciones activas consecutivas de un acopio.
 */
export function computeStockpileMeasurementChain(
    measurements: StockpileMeasurement[],
    initialPhotoUrl?: string | null
): StockpileMeasurementChainResult {
    const cleanInitialPhoto = isCleanPhotoUrl(initialPhotoUrl) ? initialPhotoUrl : null;
    const sortedAsc = [...measurements].sort((a, b) => {
        const dt = (a.timestamp || 0) - (b.timestamp || 0);
        if (dt !== 0) return dt;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const enrichedById = new Map<string, StockpileMeasurement>();
    const activeAsc: StockpileMeasurement[] = [];

    for (const m of sortedAsc) {
        if (!m.ignored) {
            activeAsc.push(m);
        } else {
            enrichedById.set(m.id, { ...m });
        }
    }

    for (let i = 0; i < activeAsc.length; i++) {
        const curr = activeAsc[i];
        const prev = i > 0 ? activeAsc[i - 1] : null;
        const prevPhoto = prev
            ? isCleanPhotoUrl(prev.photo_url)
                ? prev.photo_url
                : cleanInitialPhoto
            : cleanInitialPhoto;
        const deltaVol = prev ? roundSignedTwo(curr.volumen_m3 - prev.volumen_m3) : 0;
        const deltaVolPct =
            prev && prev.volumen_m3 > 0
                ? roundSignedOne(((curr.volumen_m3 - prev.volumen_m3) / prev.volumen_m3) * 100)
                : null;
        const deltaWeight = prev ? roundSignedTwo(curr.peso_t - prev.peso_t) : 0;

        enrichedById.set(curr.id, {
            ...curr,
            previous_measurement_id: prev ? prev.id : null,
            previous_photo_url: prevPhoto,
            delta_volumen: deltaVol,
            delta_volumen_pct: deltaVolPct,
            delta_peso: deltaWeight,
        });
    }

    const enrichedAsc = sortedAsc.map((m) => enrichedById.get(m.id) || m);
    const enrichedMeasurements = [...enrichedAsc].reverse();

    const activeEnrichedAsc = activeAsc.map((m) => enrichedById.get(m.id) || m);
    const latestActive =
        activeEnrichedAsc.length > 0 ? activeEnrichedAsc[activeEnrichedAsc.length - 1] : null;
    const previousActive =
        activeEnrichedAsc.length > 1 ? activeEnrichedAsc[activeEnrichedAsc.length - 2] : null;

    let lastPhotoUrl: string | undefined = cleanInitialPhoto || undefined;
    for (let i = activeEnrichedAsc.length - 1; i >= 0; i--) {
        const candidate = activeEnrichedAsc[i].photo_url;
        if (isCleanPhotoUrl(candidate)) {
            lastPhotoUrl = candidate;
            break;
        }
    }

    return {
        enrichedMeasurements,
        summary: {
            latestActive,
            previousActive,
            lastPhotoUrl,
            lastVolumeM3: latestActive ? latestActive.volumen_m3 : null,
            lastWeightT: latestActive ? latestActive.peso_t : null,
            lastDeltaVolumenM3: latestActive ? (latestActive.delta_volumen ?? 0) : null,
            lastDeltaVolumenPct: latestActive ? (latestActive.delta_volumen_pct ?? null) : null,
        },
    };
}

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
     * Cálculo Manual / Motor v2: Cono Elíptico Truncado (Integral Prismoidal Exacta)
     * Fórmula: (PI * h / 24) * (2*d1*d2 + 2*d1p*d2p + d1*d2p + d2*d1p)
     * Válida incluso cuando el talud constante rompe la semejanza geométrica base/corona.
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
        if (d1p > d1 || d2p > d2) return 0;

        return ((Math.PI * h) / 24) * (2 * d1 * d2 + 2 * d1p * d2p + d1 * d2p + d2 * d1p);
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
        if (P <= 0 || Pp < 0 || h <= 0 || Pp > P) return 0;

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
     * Cordón / Botadero Longitudinal con cabeceras semiconoides naturales gobernadas por talud.
     */
    public calculateSlopeAwareWindrowVolume(input: {
        baseLengthM: number;
        baseWidthM: number;
        heightM: number;
        crestLengthM?: number;
        crestWidthM?: number;
        slopeAngleDeg?: number;
    }): number {
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
            crestWidthM !== undefined ? crestWidthM : Math.max(0, baseWidthM - 2 * deltaR);

        if (!Number.isFinite(effCrestWidth) || effCrestWidth < 0 || effCrestWidth > baseWidthM) {
            return 0;
        }
        if (
            crestLengthM !== undefined &&
            (!Number.isFinite(crestLengthM) || crestLengthM < 0 || crestLengthM > baseLengthM)
        ) {
            return 0;
        }

        const straightLength =
            crestLengthM !== undefined
                ? Math.max(0, Math.min(crestLengthM, baseLengthM - effCrestWidth))
                : Math.max(0, baseLengthM - baseWidthM);

        const centralVolume = ((baseWidthM + effCrestWidth) / 2) * heightM * straightLength;
        const endBaseDiameter = Math.max(0, baseLengthM - straightLength);
        const endVolume =
            endBaseDiameter > 0
                ? this.calculateTruncatedEllipticCone(
                      endBaseDiameter,
                      baseWidthM,
                      effCrestWidth,
                      effCrestWidth,
                      heightM
                  )
                : 0;

        return roundTwoDecimals(centralVolume + endVolume);
    }

    /**
     * Cálculo Manual: Pila Longitudinal / Windrow (Regla Prismoidal 3D o Cabeceras Semiconoides v2)
     */
    public calculateWindrowVolume(
        baseLengthM: number,
        baseWidthM: number,
        heightM: number,
        crestLengthM?: number,
        crestWidthM?: number,
        options?: { endcapMode?: 'PRISMOIDAL_LEGACY' | 'ROUNDED_CONICAL'; slopeAngleDeg?: number }
    ): number {
        if (options?.endcapMode === 'ROUNDED_CONICAL') {
            return this.calculateSlopeAwareWindrowVolume({
                baseLengthM,
                baseWidthM,
                heightM,
                crestLengthM,
                crestWidthM,
                slopeAngleDeg: options.slopeAngleDeg,
            });
        }

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
     * Cálculo Manual / Motor v2: Acopio Contra Muro (Bunker 3 Muros o 1 Muro Trasero con extremos libres)
     */
    public calculateToeWallStockpileVolume(
        lengthM: number,
        widthFromWallM: number,
        heightAtWallM: number,
        wallAngleDeg = 90,
        options?: {
            confinement?: 'BUNKER_3_WALLS' | 'SINGLE_WALL';
            slopeAngleDeg?: number;
            crestWidthM?: number;
        }
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

        if (options?.confinement === 'SINGLE_WALL') {
            const slopeDeg =
                typeof options.slopeAngleDeg === 'number' && Number.isFinite(options.slopeAngleDeg)
                    ? Math.min(89.9, Math.max(15, options.slopeAngleDeg))
                    : 40;
            const endRadiusM = Math.min(
                lengthM / 2,
                heightAtWallM / Math.tan((slopeDeg * Math.PI) / 180)
            );
            const straightLenM = Math.max(0, lengthM - 2 * endRadiusM);
            const volume =
                0.5 * straightLenM * effectiveWidth * heightAtWallM +
                (Math.PI / 6) * endRadiusM * effectiveWidth * heightAtWallM;
            return roundTwoDecimals(volume);
        }

        const crestW = Math.min(effectiveWidth, Math.max(0, options?.crestWidthM ?? 0));
        const volume = ((effectiveWidth + crestW) / 2) * lengthM * heightAtWallM;
        return roundTwoDecimals(volume);
    }

    public deriveHeightFromSlopeLength(slopeLengthM: number, slopeAngleDeg: number): number {
        if (!Number.isFinite(slopeLengthM) || !Number.isFinite(slopeAngleDeg)) return 0;
        if (slopeLengthM <= 0 || slopeAngleDeg <= 0 || slopeAngleDeg >= 90) return 0;
        return roundTwoDecimals(slopeLengthM * Math.sin((slopeAngleDeg * Math.PI) / 180));
    }

    public deriveHeightFromBaseAndSlope(
        baseSpanM: number,
        slopeAngleDeg: number,
        isDiameter = true
    ): number {
        if (!Number.isFinite(baseSpanM) || !Number.isFinite(slopeAngleDeg)) return 0;
        if (baseSpanM <= 0 || slopeAngleDeg <= 0 || slopeAngleDeg >= 90) return 0;
        const radius = isDiameter ? baseSpanM / 2 : baseSpanM;
        return roundTwoDecimals(radius * Math.tan((slopeAngleDeg * Math.PI) / 180));
    }

    public evaluateStockpileSlopePhysics(params: {
        geometryType: string;
        dimensions: Record<string, number | undefined>;
    }): {
        implicitSlopeDeg: number | null;
        withinReposeRange: boolean;
        status: 'OPTIMAL' | 'SHALLOW' | 'STEEP_WARNING' | 'UNDECLARED';
        warning: string | null;
    } {
        const dim = params.dimensions || {};
        const h = Number(dim.h ?? dim.heightM ?? 0);
        if (!Number.isFinite(h) || h <= 0) {
            return { implicitSlopeDeg: null, withinReposeRange: false, status: 'UNDECLARED', warning: null };
        }

        let runM = 0;
        if (params.geometryType === 'CONO_ELIPTICO') {
            const minDia = Math.min(Number(dim.a ?? 0), Number(dim.b ?? 0));
            runM = minDia > 0 ? minDia / 2 : 0;
        } else if (params.geometryType === 'CONO_ELIPTICO_TRUNCADO') {
            const runA = Number(dim.a ?? 0) > Number(dim.ap ?? 0) ? (Number(dim.a) - Number(dim.ap ?? 0)) / 2 : 0;
            const runB = Number(dim.b ?? 0) > Number(dim.bp ?? 0) ? (Number(dim.b) - Number(dim.bp ?? 0)) / 2 : 0;
            runM = runA > 0 && runB > 0 ? Math.min(runA, runB) : Math.max(runA, runB);
        } else if (params.geometryType === 'CONO_TRUNCADO_PERIMETRO') {
            const p = Number(dim.p ?? 0);
            const pp = Number(dim.pp ?? 0);
            runM = p > pp ? (p - pp) / (2 * Math.PI) : 0;
        } else if (params.geometryType === 'PILA_LONGITUDINAL_WINDROW') {
            const wb = Number(dim.base_width_m ?? dim.b ?? 0);
            const wc = Number(dim.crest_width_m ?? 0);
            runM = wb > wc ? (wb - wc) / 2 : 0;
        } else if (params.geometryType === 'ACOPIO_CONTRA_MURO') {
            runM = Number(dim.width_from_wall_m ?? dim.b ?? 0);
        }

        if (!Number.isFinite(runM) || runM <= 0) {
            return { implicitSlopeDeg: null, withinReposeRange: false, status: 'UNDECLARED', warning: null };
        }

        const angleDeg = Math.round((Math.atan2(h, runM) * 180) / Math.PI * 10) / 10;
        if (angleDeg > 48) {
            return {
                implicitSlopeDeg: angleDeg,
                withinReposeRange: false,
                status: 'STEEP_WARNING',
                warning: `Talud implícito ${angleDeg}° excede ángulo límite físico natural (~45°–48°).`,
            };
        }
        return {
            implicitSlopeDeg: angleDeg,
            withinReposeRange: angleDeg >= 28 && angleDeg <= 48,
            status: angleDeg < 28 ? 'SHALLOW' : 'OPTIMAL',
            warning: null,
        };
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
