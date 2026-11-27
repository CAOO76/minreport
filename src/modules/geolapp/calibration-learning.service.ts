import { randomUUID } from 'crypto';
import {
    CalibrationAiDiagnosisSchema,
    CalibrationProfileSchema,
    MeasurementDeviationMetricsSchema,
    type CalibrationAiDiagnosis,
    type CalibrationProfile,
    type GroundTruthEstimatedSnapshot,
    type GroundTruthRecord,
    type GroundTruthReferenceMethod,
    type MeasurementDeviationMetrics,
} from '../../contracts/acopios.contracts';
import { ResilientAIClient } from '../../core/resilient-ai-client';

/**
 * MINREPORT · ACOPIOS — Motor Determinista de Desviaciones, Calibración LOOCV
 * y Diagnóstico IA Soberano (`southamerica-west1`, Ley N° 21.719).
 *
 * Reglas inviolables:
 * - Nunca muta `volumen_m3` comercial de mediciones previas.
 * - Excluye registros `isEduSandbox: true` del pool de calibración.
 * - Rechaza outliers estadísticos con `z_MAD > 3.5`.
 * - Exige `N >= 3` registros válidos tras filtrado.
 * - Ejecuta Leave-One-Out Cross-Validation (mediana out-of-sample) y acota factores
 *   `volumeScaleFactor ∈ [0.75, 1.25]`, `heightScaleFactor ∈ [0.80, 1.20]`, `baseScaleFactor ∈ [0.80, 1.20]`.
 * - Todo perfil nace en estado `'DRAFT'` y exige `calibratedMapePct < rawMapePct` para recomendar activación.
 * - La inferencia IA recibe exclusivamente ratios numéricos anónimos y modelo de hardware (cero PII/GPS/nombres).
 */

export const DEVIATION_ALERT_THRESHOLD_PCT = 8.0;
export const LOOCV_MIN_SAMPLES = 3;
export const MAD_OUTLIER_THRESHOLD = 3.5;

export const VOLUME_SCALE_MIN = 0.75;
export const VOLUME_SCALE_MAX = 1.25;
export const AXIS_SCALE_MIN = 0.8;
export const AXIS_SCALE_MAX = 1.2;

export interface GroundTruthRealMeasures {
    realHeightM?: number;
    realBaseLengthM?: number;
    realBaseWidthM?: number;
    realDiameterM?: number;
    realVolumeM3?: number;
    realSlopeAngleDeg?: number;
}

export class CalibrationInsufficientSamplesError extends Error {
    public readonly code = 'INSUFFICIENT_SAMPLES';
    public readonly validCount: number;
    public readonly requiredCount: number;
    public readonly outliersExcluded: number;

    constructor(validCount: number, outliersExcluded: number, requiredCount = LOOCV_MIN_SAMPLES) {
        super(
            `Muestras válidas insuficientes para LOOCV (${validCount}/${requiredCount}, outliers descartados=${outliersExcluded}).`
        );
        this.name = 'CalibrationInsufficientSamplesError';
        this.validCount = validCount;
        this.requiredCount = requiredCount;
        this.outliersExcluded = outliersExcluded;
    }
}

export interface RecomputeLoocvOptions {
    tenantId: string;
    deviceModel?: string;
    includeEduSandbox?: boolean;
    now?: number;
    profileId?: string;
}

export interface LoocvAiInputSummary {
    tenantId?: string;
    deviceModel: string;
    sampleCount: number;
    outliersExcluded: number;
    volumeScaleFactor: number;
    heightScaleFactor: number;
    baseScaleFactor: number;
    rawMapePct: number;
    calibratedMapePct: number;
    rmsePct: number;
    biasPct: number;
    improved: boolean;
    referenceMethodCounts?: Partial<Record<GroundTruthReferenceMethod, number>>;
}

function round2(value: number): number {
    return Number(value.toFixed(2));
}

function round4(value: number): number {
    return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function isPositiveFinite(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function median(values: ReadonlyArray<number>): number {
    if (values.length === 0) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: ReadonlyArray<number>): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

function sanitizeHardwareModelLabel(raw?: string | null): string {
    const clean = String(raw || '')
        .replace(/[^A-Za-z0-9._\s/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
    return clean || 'ALL_DEVICES';
}

/**
 * Calcula desviaciones porcentuales exactas `Δ% = ((APP - REAL) / REAL) * 100`
 * y clasifica `ALERT` si `maxAbsDeltaPct > 8%`.
 */
export function computeDeviationMetrics(
    estimated: GroundTruthEstimatedSnapshot,
    real: GroundTruthRealMeasures
): MeasurementDeviationMetrics {
    const pctValues: number[] = [];

    const calcPct = (est?: number, realVal?: number): number | undefined => {
        if (!isPositiveFinite(est) || !isPositiveFinite(realVal)) return undefined;
        const pct = round2(((est - realVal) / realVal) * 100);
        pctValues.push(pct);
        return pct;
    };

    const estDiameter =
        isPositiveFinite(estimated.diameterM)
            ? estimated.diameterM
            : isPositiveFinite(estimated.baseLengthM) && isPositiveFinite(estimated.baseWidthM)
              ? (estimated.baseLengthM + estimated.baseWidthM) / 2
              : isPositiveFinite(estimated.baseLengthM)
                ? estimated.baseLengthM
                : isPositiveFinite(estimated.baseWidthM)
                  ? estimated.baseWidthM
                  : undefined;

    const deltaHeightPct = calcPct(estimated.heightM, real.realHeightM);
    const deltaLengthPct = calcPct(estimated.baseLengthM, real.realBaseLengthM);
    const deltaWidthPct = calcPct(estimated.baseWidthM, real.realBaseWidthM);
    const deltaDiameterPct = calcPct(estDiameter, real.realDiameterM);
    const deltaVolumePct = calcPct(estimated.volumeM3, real.realVolumeM3);

    const deltaSlopeDeg =
        typeof estimated.slopeAngleDeg === 'number' &&
        Number.isFinite(estimated.slopeAngleDeg) &&
        typeof real.realSlopeAngleDeg === 'number' &&
        Number.isFinite(real.realSlopeAngleDeg)
            ? round2(estimated.slopeAngleDeg - real.realSlopeAngleDeg)
            : undefined;

    let maxAbsDeltaPct = 0;
    if (pctValues.length > 0) {
        maxAbsDeltaPct = round2(Math.max(...pctValues.map((v) => Math.abs(v))));
    } else if (
        deltaSlopeDeg !== undefined &&
        isPositiveFinite(real.realSlopeAngleDeg)
    ) {
        maxAbsDeltaPct = round2(Math.abs((deltaSlopeDeg / real.realSlopeAngleDeg) * 100));
    }

    const statusBand = maxAbsDeltaPct > DEVIATION_ALERT_THRESHOLD_PCT ? 'ALERT' : 'OPTIMAL';

    return MeasurementDeviationMetricsSchema.parse({
        ...(deltaHeightPct !== undefined ? { deltaHeightPct } : {}),
        ...(deltaLengthPct !== undefined ? { deltaLengthPct } : {}),
        ...(deltaWidthPct !== undefined ? { deltaWidthPct } : {}),
        ...(deltaDiameterPct !== undefined ? { deltaDiameterPct } : {}),
        ...(deltaVolumePct !== undefined ? { deltaVolumePct } : {}),
        ...(deltaSlopeDeg !== undefined ? { deltaSlopeDeg } : {}),
        maxAbsDeltaPct,
        statusBand,
    });
}

interface PrimaryCalibrationSample {
    est: number;
    real: number;
    ratio: number;
    record: GroundTruthRecord;
}

/**
 * Filtra outliers por puntuación Z robusta basada en MAD (`z_MAD = 0.6745 * |r - med| / MAD > 3.5`).
 * Si `MAD == 0` (clúster con ratios idénticos + outlier extremo), usa MeanAD como escala de respaldo
 * (`z = |r - med| / (1.253314 * MeanAD)`) para garantizar rechazo determinista de aberraciones.
 */
export function filterOutliersByMad<T extends { ratio: number }>(
    samples: ReadonlyArray<T>,
    threshold = MAD_OUTLIER_THRESHOLD
): { inliers: T[]; outliers: T[] } {
    if (samples.length <= 2) {
        return { inliers: [...samples], outliers: [] };
    }
    const ratios = samples.map((s) => s.ratio);
    const med = median(ratios);
    const absDevs = ratios.map((r) => Math.abs(r - med));
    const mad = median(absDevs);

    const inliers: T[] = [];
    const outliers: T[] = [];

    if (mad > 1e-9) {
        for (const s of samples) {
            const zMad = (0.6745 * Math.abs(s.ratio - med)) / mad;
            if (zMad > threshold) {
                outliers.push(s);
            } else {
                inliers.push(s);
            }
        }
        return { inliers, outliers };
    }

    // Caso degenerado: >= 50% de las muestras tienen exactamente el mismo ratio (MAD = 0)
    const meanAbsDev = mean(absDevs);
    if (meanAbsDev <= 1e-9) {
        return { inliers: [...samples], outliers: [] };
    }
    for (const s of samples) {
        const diff = Math.abs(s.ratio - med);
        // Descarta solo desviaciones claramente aberrantes respecto al clúster constante
        const zFallback = diff / (1.253314 * meanAbsDev);
        if (diff > Math.max(0.2, 0.25 * Math.abs(med)) && zFallback >= 1.5) {
            outliers.push(s);
        } else {
            inliers.push(s);
        }
    }
    return { inliers, outliers };
}

function extractPrimarySample(record: GroundTruthRecord): PrimaryCalibrationSample | null {
    // Prioridad 1: par de volumen (realVolumeM3 vs estimated.volumeM3)
    if (isPositiveFinite(record.real.realVolumeM3) && isPositiveFinite(record.estimated.volumeM3)) {
        return {
            est: record.estimated.volumeM3,
            real: record.real.realVolumeM3,
            ratio: record.real.realVolumeM3 / record.estimated.volumeM3,
            record,
        };
    }
    return null;
}

function extractAxisRatios(records: ReadonlyArray<GroundTruthRecord>): {
    heightRatios: number[];
    baseRatios: number[];
} {
    const heightRatios: number[] = [];
    const baseRatios: number[] = [];

    for (const r of records) {
        if (isPositiveFinite(r.real.realHeightM) && isPositiveFinite(r.estimated.heightM)) {
            heightRatios.push(r.real.realHeightM / r.estimated.heightM);
        }
        if (isPositiveFinite(r.real.realBaseLengthM) && isPositiveFinite(r.estimated.baseLengthM)) {
            baseRatios.push(r.real.realBaseLengthM / r.estimated.baseLengthM);
        }
        if (isPositiveFinite(r.real.realBaseWidthM) && isPositiveFinite(r.estimated.baseWidthM)) {
            baseRatios.push(r.real.realBaseWidthM / r.estimated.baseWidthM);
        }
        if (isPositiveFinite(r.real.realDiameterM)) {
            const estD = isPositiveFinite(r.estimated.diameterM)
                ? r.estimated.diameterM
                : isPositiveFinite(r.estimated.baseLengthM) && isPositiveFinite(r.estimated.baseWidthM)
                  ? (r.estimated.baseLengthM + r.estimated.baseWidthM) / 2
                  : undefined;
            if (isPositiveFinite(estD)) {
                baseRatios.push(r.real.realDiameterM / estD);
            }
        }
    }

    return { heightRatios, baseRatios };
}

/**
 * Ejecuta Calibración Determinista con Leave-One-Out Cross-Validation (LOOCV).
 * - Excluye registros `isEduSandbox === true` por defecto.
 * - Filtra outliers por `z_MAD > 3.5`.
 * - Exige `N >= 3` muestras válidas tras filtrado.
 * - Calcula factores acotados `[0.75..1.25]` (volumen) y `[0.80..1.20]` (altura/base).
 * - Exige `calibratedMapePct < rawMapePct` (`improved === true`) para recomendar activación.
 * - Siempre devuelve `status: 'DRAFT'` (jamás auto-activa).
 */
export function recomputeCalibrationProfileLOOCV(
    records: ReadonlyArray<GroundTruthRecord>,
    options: RecomputeLoocvOptions
): CalibrationProfile {
    const requestedDevice = options.deviceModel?.trim();
    const normalizedFilter = requestedDevice ? requestedDevice.toLowerCase() : null;

    const scopedRecords = records.filter((rec) => {
        if (!rec) return false;
        if (!options.includeEduSandbox && rec.isEduSandbox === true) {
            return false;
        }
        if (normalizedFilter && normalizedFilter !== 'all_devices') {
            const recModel = String(rec.deviceModel || '').trim().toLowerCase();
            if (recModel !== normalizedFilter) {
                return false;
            }
        }
        return true;
    });

    const rawSamples = scopedRecords
        .map(extractPrimarySample)
        .filter((s): s is PrimaryCalibrationSample => s !== null);

    const { inliers, outliers } = filterOutliersByMad(rawSamples, MAD_OUTLIER_THRESHOLD);

    if (inliers.length < LOOCV_MIN_SAMPLES) {
        throw new CalibrationInsufficientSamplesError(inliers.length, outliers.length);
    }

    // Leave-One-Out Cross-Validation (out-of-sample median scale factor)
    const rawAbsErrorsPct: number[] = [];
    const calAbsErrorsPct: number[] = [];
    const calSignedErrorsPct: number[] = [];
    const calSquaredErrorsPct: number[] = [];

    for (let i = 0; i < inliers.length; i++) {
        const trainRatios: number[] = [];
        for (let j = 0; j < inliers.length; j++) {
            if (j !== i) trainRatios.push(inliers[j].ratio);
        }
        const foldScale = clamp(median(trainRatios), VOLUME_SCALE_MIN, VOLUME_SCALE_MAX);
        const test = inliers[i];

        const rawErrPct = ((test.est - test.real) / test.real) * 100;
        const predCal = test.est * foldScale;
        const calErrPct = ((predCal - test.real) / test.real) * 100;

        rawAbsErrorsPct.push(Math.abs(rawErrPct));
        calAbsErrorsPct.push(Math.abs(calErrPct));
        calSignedErrorsPct.push(calErrPct);
        calSquaredErrorsPct.push(calErrPct * calErrPct);
    }

    const rawMapePct = round2(mean(rawAbsErrorsPct));
    const calibratedMapePct = round2(mean(calAbsErrorsPct));
    const rmsePct = round2(Math.sqrt(mean(calSquaredErrorsPct)));
    const biasPct = round2(mean(calSignedErrorsPct));
    const improved = calibratedMapePct < rawMapePct;

    const fullVolumeFactor = round4(
        clamp(median(inliers.map((s) => s.ratio)), VOLUME_SCALE_MIN, VOLUME_SCALE_MAX)
    );

    const inlierRecords = inliers.map((s) => s.record);
    const { heightRatios, baseRatios } = extractAxisRatios(inlierRecords);
    const cleanHeight = filterOutliersByMad(
        heightRatios.map((ratio) => ({ ratio })),
        MAD_OUTLIER_THRESHOLD
    ).inliers.map((x) => x.ratio);
    const cleanBase = filterOutliersByMad(
        baseRatios.map((ratio) => ({ ratio })),
        MAD_OUTLIER_THRESHOLD
    ).inliers.map((x) => x.ratio);

    const heightScaleFactor =
        cleanHeight.length >= 2
            ? round4(clamp(median(cleanHeight), AXIS_SCALE_MIN, AXIS_SCALE_MAX))
            : 1.0;
    const baseScaleFactor =
        cleanBase.length >= 2
            ? round4(clamp(median(cleanBase), AXIS_SCALE_MIN, AXIS_SCALE_MAX))
            : 1.0;

    const inferredModel =
        requestedDevice ||
        inlierRecords.find((r) => r.deviceModel && r.deviceModel.trim())?.deviceModel ||
        'ALL_DEVICES';

    const now = options.now ?? Date.now();
    const profileId = options.profileId || `calprof_${now}_${randomUUID().slice(0, 8)}`;

    return CalibrationProfileSchema.parse({
        profileId,
        tenantId: options.tenantId,
        deviceModel: sanitizeHardwareModelLabel(inferredModel),
        status: 'DRAFT',
        sampleCount: inliers.length,
        outliersExcluded: outliers.length,
        volumeScaleFactor: fullVolumeFactor,
        heightScaleFactor,
        baseScaleFactor,
        loocvMetrics: {
            rawMapePct,
            calibratedMapePct,
            rmsePct,
            biasPct,
            improved,
        },
        createdAt: now,
        activatedAt: null,
        activatedBy: null,
        region: 'southamerica-west1',
    });
}

function buildDeterministicDiagnosis(summary: LoocvAiInputSummary): CalibrationAiDiagnosis {
    const causes: string[] = [];
    if (summary.volumeScaleFactor > 1.03) {
        causes.push(
            `Subestimación sistemática de volumen (factor ×${summary.volumeScaleFactor.toFixed(4)}).`
        );
    } else if (summary.volumeScaleFactor < 0.97) {
        causes.push(
            `Sobreestimación sistemática de volumen (factor ×${summary.volumeScaleFactor.toFixed(4)}).`
        );
    }
    if (Math.abs(summary.heightScaleFactor - 1) > 0.03) {
        causes.push(
            `Desviación vertical en eje H (factor ×${summary.heightScaleFactor.toFixed(4)}).`
        );
    }
    if (Math.abs(summary.baseScaleFactor - 1) > 0.03) {
        causes.push(
            `Desviación en huella basal L/A (factor ×${summary.baseScaleFactor.toFixed(4)}).`
        );
    }
    if (summary.outliersExcluded > 0) {
        causes.push(
            `${summary.outliersExcluded} muestra(s) atípica(s) descartada(s) por criterio z_MAD > 3.5.`
        );
    }
    if (causes.length === 0) {
        causes.push('Dispersión aleatoria dentro de tolerancia sin sesgo lineal dominante.');
    }

    let recommendedAction: CalibrationAiDiagnosis['recommendedAction'];
    if (summary.improved && summary.calibratedMapePct <= DEVIATION_ALERT_THRESHOLD_PCT) {
        recommendedAction = 'ACTIVATE_PROFILE';
    } else if (summary.sampleCount < 5) {
        recommendedAction = 'COLLECT_MORE_SAMPLES';
    } else if (!summary.improved) {
        recommendedAction = 'REVIEW_CAPTURE_PROTOCOL';
    } else {
        recommendedAction = 'RECALIBRATE_DEVICE';
    }

    const deltaMape = round2(summary.rawMapePct - summary.calibratedMapePct);
    const summaryText = summary.improved
        ? `LOOCV (N=${summary.sampleCount}, ${summary.deviceModel}): MAPE ${summary.rawMapePct.toFixed(2)}% -> ${summary.calibratedMapePct.toFixed(2)}% (${deltaMape >= 0 ? '-' : '+'}${Math.abs(deltaMape).toFixed(2)} pp), RMSE ${summary.rmsePct.toFixed(2)}%, Bias ${summary.biasPct >= 0 ? '+' : ''}${summary.biasPct.toFixed(2)}%.`
        : `LOOCV (N=${summary.sampleCount}, ${summary.deviceModel}): Sin mejora out-of-sample (MAPE ${summary.rawMapePct.toFixed(2)}% -> ${summary.calibratedMapePct.toFixed(2)}%). Mantener borrador sin activar.`;

    return CalibrationAiDiagnosisSchema.parse({
        summary: summaryText.slice(0, 600),
        rootCauses: causes.slice(0, 6),
        recommendedAction,
        modelUsed: 'DETERMINISTIC_LOOCV_ENGINE',
        generatedAt: Date.now(),
        deterministicFallback: true,
    });
}

/**
 * Genera diagnóstico técnico soberano vía `ResilientAIClient` (`southamerica-west1`, Ley N° 21.719).
 * Envía EXCLUSIVAMENTE ratios numéricos anónimos y modelo de hardware (cero PII, cero GPS, cero nombres).
 * Degrada determinísticamente en local/tests cuando el enjambre IA no está disponible.
 */
export async function generateSovereignAiCalibrationDiagnosis(
    loocvSummary: LoocvAiInputSummary
): Promise<CalibrationAiDiagnosis> {
    const safeDeviceModel = sanitizeHardwareModelLabel(loocvSummary.deviceModel);
    const anonymousPayload = {
        deviceModel: safeDeviceModel,
        sampleCount: loocvSummary.sampleCount,
        outliersExcluded: loocvSummary.outliersExcluded,
        volumeScaleFactor: round4(loocvSummary.volumeScaleFactor),
        heightScaleFactor: round4(loocvSummary.heightScaleFactor),
        baseScaleFactor: round4(loocvSummary.baseScaleFactor),
        rawMapePct: round2(loocvSummary.rawMapePct),
        calibratedMapePct: round2(loocvSummary.calibratedMapePct),
        rmsePct: round2(loocvSummary.rmsePct),
        biasPct: round2(loocvSummary.biasPct),
        improved: Boolean(loocvSummary.improved),
        ...(loocvSummary.referenceMethodCounts
            ? { referenceMethodCounts: loocvSummary.referenceMethodCounts }
            : {}),
    };

    try {
        const aiRes = await ResilientAIClient.generate({
            module: 'stockpile',
            tenantId: loocvSummary.tenantId,
            dataClassification: 'TENANT_PRIVATE',
            useGoogleSearch: false,
            preferredTier: 'SECONDARY',
            thinkingLevel: 'low',
            temperature: 0.1,
            maxOutputTokens: 450,
            responseMimeType: 'application/json',
            systemInstruction:
                'Eres ingeniero metrológico de MINREPORT. Analiza métricas anónimas LOOCV y responde SOLO JSON válido con { "summary": string (max 280 chars, lenguaje técnico aséptico sin marketing), "rootCauses": string[] (1 a 4 causas breves), "recommendedAction": "ACTIVATE_PROFILE" | "COLLECT_MORE_SAMPLES" | "RECALIBRATE_DEVICE" | "REVIEW_CAPTURE_PROTOCOL" }. Si improved=false, NUNCA recomiendes ACTIVATE_PROFILE.',
            prompt: `Métricas LOOCV anónimas:\n${JSON.stringify(anonymousPayload)}`,
        });

        const parsedRaw = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text)) as Record<
            string,
            unknown
        >;
        const rawAction = String(parsedRaw.recommendedAction || '').trim();
        const enforcedAction =
            !loocvSummary.improved && rawAction === 'ACTIVATE_PROFILE'
                ? 'REVIEW_CAPTURE_PROTOCOL'
                : rawAction;

        const candidate = CalibrationAiDiagnosisSchema.safeParse({
            summary: typeof parsedRaw.summary === 'string' ? parsedRaw.summary : '',
            rootCauses: Array.isArray(parsedRaw.rootCauses)
                ? parsedRaw.rootCauses.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 6)
                : [],
            recommendedAction: enforcedAction,
            modelUsed: aiRes.model || 'gemini-swarm',
            generatedAt: Date.now(),
            deterministicFallback: false,
        });

        if (candidate.success && candidate.data.rootCauses.length > 0) {
            return candidate.data;
        }
    } catch {
        // Degradación determinista limpia en tests/offline o indisponibilidad del enjambre IA
    }

    return buildDeterministicDiagnosis({
        ...loocvSummary,
        deviceModel: safeDeviceModel,
    });
}
