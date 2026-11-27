import {
    CalibrationProfileSchema,
    GroundTruthRecordSchema,
    MeasurementDeviationMetricsSchema,
    MeasurementGroundTruthInputSchema,
    type CalibrationProfile,
    type GroundTruthEstimatedSnapshot,
    type GroundTruthRecord,
    type GroundTruthReferenceMethod,
    type MeasurementDeviationMetrics,
    type MeasurementGroundTruthInput,
} from '../../../../contracts/acopios.contracts';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { offlineStorage } from '../../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../../core/offline/SyncQueueEngine';
import type { StockpileAsset, StockpileMeasurement } from '../types/GeolappTypes';

/**
 * Cliente Offline-First de Mediciones Reales (Ground-Truth), Desviaciones y Calibración LOOCV/IA.
 * - Residencia exclusiva southamerica-west1, cumplimiento Ley N° 21.719.
 * - Nunca muta `volumen_m3` comercial de la medición base.
 * - Encola automáticamente contrastes confirmados con `"ACTUALIZAR"` cuando no hay red.
 */

export const GROUND_TRUTH_ALERT_THRESHOLD_PCT = 8.0;

const gtStorageKey = (tenantId?: string) =>
    `minreport_acopios_ground_truth_${(tenantId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
const profStorageKey = (tenantId?: string) =>
    `minreport_acopios_cal_profiles_${(tenantId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

export interface GroundTruthRealMeasuresInput {
    realHeightM?: number;
    realBaseLengthM?: number;
    realBaseWidthM?: number;
    realDiameterM?: number;
    realVolumeM3?: number;
    realSlopeAngleDeg?: number;
}

export interface GroundTruthAggregateSummary {
    count: number;
    mapePct: number | null;
    rmsePct: number | null;
    biasPct: number | null;
    alertCount: number;
}

function isPositiveFinite(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function round2(v: number): number {
    return Number(v.toFixed(2));
}

export function extractEstimatedSnapshotFromMeasurement(
    measurement: StockpileMeasurement,
    asset?: StockpileAsset | null
): GroundTruthEstimatedSnapshot {
    const dims = measurement.geometry?.dimensions || {};
    const bbox = measurement.mesh_bounding_box_m ?? asset?.mesh_bounding_box_m;

    const baseLengthM =
        dims.a ?? dims.d1 ?? dims.baseLengthM ?? dims.lengthM ?? bbox?.widthX ?? undefined;
    const baseWidthM =
        dims.b ?? dims.d2 ?? dims.baseWidthM ?? dims.widthFromWallM ?? bbox?.depthZ ?? undefined;
    const heightM =
        dims.h ?? dims.heightM ?? dims.heightAtWallM ?? bbox?.heightY ?? undefined;
    const diameterM =
        isPositiveFinite(baseLengthM) && isPositiveFinite(baseWidthM)
            ? round2((baseLengthM + baseWidthM) / 2)
            : isPositiveFinite(baseLengthM)
              ? round2(baseLengthM)
              : undefined;
    const volumeM3 = isPositiveFinite(measurement.volumen_m3)
        ? measurement.volumen_m3
        : isPositiveFinite(measurement.offline_in_situ_m3)
          ? measurement.offline_in_situ_m3
          : undefined;
    const slopeAngleDeg =
        typeof measurement.detected_slope_angle_deg === 'number' &&
        Number.isFinite(measurement.detected_slope_angle_deg)
            ? measurement.detected_slope_angle_deg
            : typeof asset?.detected_slope_angle_deg === 'number' &&
                Number.isFinite(asset.detected_slope_angle_deg)
              ? asset.detected_slope_angle_deg
              : undefined;
    const footprintAreaM2 =
        typeof measurement.footprint_area_m2 === 'number' &&
        Number.isFinite(measurement.footprint_area_m2)
            ? measurement.footprint_area_m2
            : typeof asset?.footprint_area_m2 === 'number' &&
                Number.isFinite(asset.footprint_area_m2)
              ? asset.footprint_area_m2
              : undefined;

    return {
        ...(isPositiveFinite(heightM) ? { heightM: round2(heightM) } : {}),
        ...(isPositiveFinite(baseLengthM) ? { baseLengthM: round2(baseLengthM) } : {}),
        ...(isPositiveFinite(baseWidthM) ? { baseWidthM: round2(baseWidthM) } : {}),
        ...(isPositiveFinite(diameterM) ? { diameterM } : {}),
        ...(isPositiveFinite(volumeM3) ? { volumeM3: Number(volumeM3.toFixed(4)) } : {}),
        ...(typeof slopeAngleDeg === 'number' ? { slopeAngleDeg: round2(slopeAngleDeg) } : {}),
        ...(typeof footprintAreaM2 === 'number'
            ? { footprintAreaM2: round2(footprintAreaM2) }
            : {}),
    };
}

/**
 * Cálculo inmediato en cliente de desviaciones `Δ% = ((APP - REAL) / REAL) * 100`.
 * Idéntico al motor determinista del servidor (`calibration-learning.service.ts`).
 */
export function computeClientDeviationMetrics(
    estimated: GroundTruthEstimatedSnapshot,
    real: GroundTruthRealMeasuresInput
): MeasurementDeviationMetrics {
    const pctValues: number[] = [];

    const calcPct = (est?: number, realVal?: number): number | undefined => {
        if (!isPositiveFinite(est) || !isPositiveFinite(realVal)) return undefined;
        const pct = round2(((est - realVal) / realVal) * 100);
        pctValues.push(pct);
        return pct;
    };

    const estDiameter = isPositiveFinite(estimated.diameterM)
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
    } else if (deltaSlopeDeg !== undefined && isPositiveFinite(real.realSlopeAngleDeg)) {
        maxAbsDeltaPct = round2(Math.abs((deltaSlopeDeg / real.realSlopeAngleDeg) * 100));
    }

    return MeasurementDeviationMetricsSchema.parse({
        ...(deltaHeightPct !== undefined ? { deltaHeightPct } : {}),
        ...(deltaLengthPct !== undefined ? { deltaLengthPct } : {}),
        ...(deltaWidthPct !== undefined ? { deltaWidthPct } : {}),
        ...(deltaDiameterPct !== undefined ? { deltaDiameterPct } : {}),
        ...(deltaVolumePct !== undefined ? { deltaVolumePct } : {}),
        ...(deltaSlopeDeg !== undefined ? { deltaSlopeDeg } : {}),
        maxAbsDeltaPct,
        statusBand: maxAbsDeltaPct > GROUND_TRUTH_ALERT_THRESHOLD_PCT ? 'ALERT' : 'OPTIMAL',
    });
}

export function computeAggregateDeviationSummary(
    records: ReadonlyArray<GroundTruthRecord>
): GroundTruthAggregateSummary {
    const count = records.length;
    if (count === 0) {
        return { count: 0, mapePct: null, rmsePct: null, biasPct: null, alertCount: 0 };
    }
    const alertCount = records.filter((r) => r.deviations.statusBand === 'ALERT').length;
    const primaryDeltas: number[] = [];
    for (const r of records) {
        if (typeof r.deviations.deltaVolumePct === 'number') {
            primaryDeltas.push(r.deviations.deltaVolumePct);
        } else if (typeof r.deviations.deltaHeightPct === 'number') {
            primaryDeltas.push(r.deviations.deltaHeightPct);
        } else if (typeof r.deviations.deltaDiameterPct === 'number') {
            primaryDeltas.push(r.deviations.deltaDiameterPct);
        } else if (typeof r.deviations.deltaLengthPct === 'number') {
            primaryDeltas.push(r.deviations.deltaLengthPct);
        } else if (typeof r.deviations.deltaWidthPct === 'number') {
            primaryDeltas.push(r.deviations.deltaWidthPct);
        }
    }
    if (primaryDeltas.length === 0) {
        return { count, mapePct: null, rmsePct: null, biasPct: null, alertCount };
    }
    const absSum = primaryDeltas.reduce((acc, v) => acc + Math.abs(v), 0);
    const sqSum = primaryDeltas.reduce((acc, v) => acc + v * v, 0);
    const signedSum = primaryDeltas.reduce((acc, v) => acc + v, 0);
    return {
        count,
        mapePct: round2(absSum / primaryDeltas.length),
        rmsePct: round2(Math.sqrt(sqSum / primaryDeltas.length)),
        biasPct: round2(signedSum / primaryDeltas.length),
        alertCount,
    };
}

async function readLocalGroundTruth(tenantId?: string): Promise<GroundTruthRecord[]> {
    const key = gtStorageKey(tenantId);
    try {
        const stored = await offlineStorage.getOfflineMetadata<GroundTruthRecord[]>(key);
        if (Array.isArray(stored)) return stored;
    } catch {
        // Fallback localStorage
    }
    if (typeof window !== 'undefined') {
        try {
            const raw = window.localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed as GroundTruthRecord[];
            }
        } catch {
            // Ignorar JSON corrupto
        }
    }
    return [];
}

async function writeLocalGroundTruth(
    tenantId: string | undefined,
    records: GroundTruthRecord[]
): Promise<void> {
    const key = gtStorageKey(tenantId);
    const trimmed = [...records]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 200);
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(key, JSON.stringify(trimmed));
        } catch {
            // Cuota
        }
    }
    try {
        await offlineStorage.putOfflineMetadata(key, trimmed);
    } catch {
        // Entorno sin IDB
    }
}

async function readLocalProfiles(tenantId?: string): Promise<CalibrationProfile[]> {
    const key = profStorageKey(tenantId);
    try {
        const stored = await offlineStorage.getOfflineMetadata<CalibrationProfile[]>(key);
        if (Array.isArray(stored)) return stored;
    } catch {
        // Fallback localStorage
    }
    if (typeof window !== 'undefined') {
        try {
            const raw = window.localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed as CalibrationProfile[];
            }
        } catch {
            // Ignorar JSON corrupto
        }
    }
    return [];
}

async function writeLocalProfiles(
    tenantId: string | undefined,
    profiles: CalibrationProfile[]
): Promise<void> {
    const key = profStorageKey(tenantId);
    const trimmed = [...profiles]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 100);
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(key, JSON.stringify(trimmed));
        } catch {
            // Cuota
        }
    }
    try {
        await offlineStorage.putOfflineMetadata(key, trimmed);
    } catch {
        // Entorno sin IDB
    }
}

function mergeGroundTruthLists(
    remote: GroundTruthRecord[],
    local: GroundTruthRecord[]
): GroundTruthRecord[] {
    const byId = new Map<string, GroundTruthRecord>();
    for (const r of remote) {
        byId.set(r.id, { ...r, syncedToCloud: true });
    }
    for (const l of local) {
        if (!byId.has(l.id)) {
            const dupRemote = remote.some(
                (r) =>
                    r.measurementId === l.measurementId &&
                    Math.abs((r.createdAt || 0) - (l.createdAt || 0)) < 5000
            );
            if (!dupRemote) {
                byId.set(l.id, l);
            }
        }
    }
    return Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function fetchGroundTruthRecords(params: {
    tenantId?: string;
    assetId?: string;
    measurementId?: string;
}): Promise<{ records: GroundTruthRecord[]; summary: GroundTruthAggregateSummary }> {
    const local = await readLocalGroundTruth(params.tenantId);
    const filterLocal = (items: GroundTruthRecord[]) =>
        items.filter(
            (r) =>
                (!params.assetId || r.assetId === params.assetId) &&
                (!params.measurementId || r.measurementId === params.measurementId)
        );

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const filtered = filterLocal(local);
        return { records: filtered, summary: computeAggregateDeviationSummary(filtered) };
    }

    try {
        const qs = new URLSearchParams();
        if (params.tenantId) qs.set('tenantId', params.tenantId);
        if (params.assetId) qs.set('assetId', params.assetId);
        if (params.measurementId) qs.set('measurementId', params.measurementId);
        const headers: Record<string, string> = {};
        if (params.tenantId) headers['X-Active-Account-Id'] = params.tenantId;

        const res = await coreAuthFetch(`/api/geolapp/ground-truth?${qs.toString()}`, {
            method: 'GET',
            headers,
        });
        if (!res.ok) {
            const filtered = filterLocal(local);
            return { records: filtered, summary: computeAggregateDeviationSummary(filtered) };
        }
        const json = (await res.json().catch(() => ({}))) as {
            records?: unknown[];
        };
        const remoteRecords: GroundTruthRecord[] = [];
        for (const item of json.records || []) {
            const parsed = GroundTruthRecordSchema.safeParse(item);
            if (parsed.success) {
                remoteRecords.push({ ...parsed.data, syncedToCloud: true });
            }
        }
        const merged = mergeGroundTruthLists(remoteRecords, filterLocal(local));
        if (!params.assetId && !params.measurementId) {
            await writeLocalGroundTruth(params.tenantId, merged);
        }
        return {
            records: merged,
            summary: computeAggregateDeviationSummary(merged),
        };
    } catch {
        const filtered = filterLocal(local);
        return { records: filtered, summary: computeAggregateDeviationSummary(filtered) };
    }
}

export async function submitMeasurementGroundTruth(params: {
    tenantId?: string;
    assetId: string;
    assetName?: string;
    measurementId: string;
    deviceModel?: string;
    estimated: GroundTruthEstimatedSnapshot;
    input: MeasurementGroundTruthInput;
}): Promise<{ record: GroundTruthRecord; queuedOffline: boolean }> {
    const validated = MeasurementGroundTruthInputSchema.parse(params.input);
    const deviations = computeClientDeviationMetrics(params.estimated, validated);
    const now = Date.now();
    const localRecord: GroundTruthRecord = {
        id: `gt_local_${now}_${Math.random().toString(36).slice(2, 7)}`,
        tenantId: params.tenantId || 'offline-local',
        assetId: params.assetId,
        ...(params.assetName ? { assetName: params.assetName } : {}),
        measurementId: params.measurementId,
        ...(params.deviceModel ? { deviceModel: params.deviceModel } : {}),
        isEduSandbox: false,
        referenceMethod: validated.referenceMethod,
        ...(validated.fieldNotes ? { fieldNotes: validated.fieldNotes } : {}),
        estimated: params.estimated,
        real: {
            ...(validated.realHeightM !== undefined ? { realHeightM: validated.realHeightM } : {}),
            ...(validated.realBaseLengthM !== undefined
                ? { realBaseLengthM: validated.realBaseLengthM }
                : {}),
            ...(validated.realBaseWidthM !== undefined
                ? { realBaseWidthM: validated.realBaseWidthM }
                : {}),
            ...(validated.realDiameterM !== undefined
                ? { realDiameterM: validated.realDiameterM }
                : {}),
            ...(validated.realVolumeM3 !== undefined
                ? { realVolumeM3: validated.realVolumeM3 }
                : {}),
            ...(validated.realSlopeAngleDeg !== undefined
                ? { realSlopeAngleDeg: validated.realSlopeAngleDeg }
                : {}),
        },
        deviations,
        createdAt: now,
        region: 'southamerica-west1',
        syncedToCloud: false,
    };

    const endpoint = `/api/geolapp/stockpiles/${encodeURIComponent(
        params.assetId
    )}/measurements/${encodeURIComponent(params.measurementId)}/ground-truth`;

    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    if (isOnline) {
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (params.tenantId) headers['X-Active-Account-Id'] = params.tenantId;

            const res = await coreAuthFetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(validated),
            });
            if (res.ok) {
                const json = (await res.json().catch(() => ({}))) as { record?: unknown };
                const parsedServer = GroundTruthRecordSchema.safeParse(json.record);
                const saved: GroundTruthRecord = parsedServer.success
                    ? { ...parsedServer.data, syncedToCloud: true }
                    : { ...localRecord, syncedToCloud: true };
                const prev = await readLocalGroundTruth(params.tenantId);
                await writeLocalGroundTruth(params.tenantId, [saved, ...prev]);
                return { record: saved, queuedOffline: false };
            }
            if (res.status >= 400 && res.status < 500) {
                const errJson = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(errJson.error || `Error HTTP ${res.status} guardando contraste real.`);
            }
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('Error HTTP')) {
                throw err;
            }
            // Fall through to offline queue on network failure
        }
    }

    const prev = await readLocalGroundTruth(params.tenantId);
    await writeLocalGroundTruth(params.tenantId, [localRecord, ...prev]);
    try {
        await syncQueueEngine.enqueueApiMutation(
            endpoint,
            validated as unknown as Record<string, unknown>,
            'GEOLAPP_GROUND_TRUTH',
            params.tenantId || 'offline-local',
            'POST'
        );
    } catch {
        // Best-effort offline queue
    }

    return { record: localRecord, queuedOffline: true };
}

export async function fetchCalibrationProfiles(tenantId?: string): Promise<CalibrationProfile[]> {
    const local = await readLocalProfiles(tenantId);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return local;
    }

    try {
        const headers: Record<string, string> = {};
        if (tenantId) headers['X-Active-Account-Id'] = tenantId;
        const url = tenantId
            ? `/api/geolapp/calibration-profiles?tenantId=${encodeURIComponent(tenantId)}`
            : '/api/geolapp/calibration-profiles';
        const res = await coreAuthFetch(url, { method: 'GET', headers });
        if (!res.ok) return local;
        const json = (await res.json().catch(() => ({}))) as { profiles?: unknown[] };
        const parsed: CalibrationProfile[] = [];
        for (const row of json.profiles || []) {
            const p = CalibrationProfileSchema.safeParse(row);
            if (p.success) parsed.push(p.data);
        }
        await writeLocalProfiles(tenantId, parsed);
        return parsed;
    } catch {
        return local;
    }
}

export async function recomputeCalibrationProfile(params: {
    tenantId?: string;
    deviceModel?: string;
}): Promise<CalibrationProfile> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.tenantId) headers['X-Active-Account-Id'] = params.tenantId;

    const res = await coreAuthFetch('/api/geolapp/calibration-profiles/recompute', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            ...(params.tenantId ? { tenantId: params.tenantId } : {}),
            ...(params.deviceModel ? { deviceModel: params.deviceModel } : {}),
        }),
    });
    const json = (await res.json().catch(() => ({}))) as {
        profile?: unknown;
        error?: string;
        message?: string;
    };
    if (!res.ok) {
        throw new Error(json.message || json.error || `Error recomputando LOOCV (HTTP ${res.status}).`);
    }
    const parsed = CalibrationProfileSchema.parse(json.profile);
    const prev = await readLocalProfiles(params.tenantId);
    await writeLocalProfiles(params.tenantId, [
        parsed,
        ...prev.filter((p) => p.profileId !== parsed.profileId),
    ]);
    return parsed;
}

export async function activateCalibrationProfileHitl(params: {
    tenantId?: string;
    profileId: string;
    hitlConfirmation: 'ACTUALIZAR';
}): Promise<CalibrationProfile> {
    if (String(params.hitlConfirmation || '').trim().toUpperCase() !== 'ACTUALIZAR') {
        throw new Error('Confirmación HITL obligatoria: escriba exactamente "ACTUALIZAR".');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.tenantId) headers['X-Active-Account-Id'] = params.tenantId;

    const res = await coreAuthFetch(
        `/api/geolapp/calibration-profiles/${encodeURIComponent(params.profileId)}/activate`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                hitlConfirmation: 'ACTUALIZAR',
                ...(params.tenantId ? { tenantId: params.tenantId } : {}),
            }),
        }
    );
    const json = (await res.json().catch(() => ({}))) as {
        profile?: unknown;
        error?: string;
        message?: string;
    };
    if (!res.ok) {
        throw new Error(json.message || json.error || `Error activando perfil (HTTP ${res.status}).`);
    }
    const parsed = CalibrationProfileSchema.parse(json.profile);
    const prev = await readLocalProfiles(params.tenantId);
    const updated = prev.map((p) => {
        if (p.profileId === parsed.profileId) return parsed;
        if (p.deviceModel === parsed.deviceModel && p.status === 'ACTIVE') {
            return { ...p, status: 'SUPERSEDED' as const };
        }
        return p;
    });
    if (!updated.some((p) => p.profileId === parsed.profileId)) {
        updated.unshift(parsed);
    }
    await writeLocalProfiles(params.tenantId, updated);
    return parsed;
}

export const REFERENCE_METHODS: ReadonlyArray<GroundTruthReferenceMethod> = [
    'TAPE_MEASURE',
    'LASER_DISTOMETER',
    'TOTAL_STATION',
    'DRONE_LIDAR',
    'SCALE_TRUCK',
    'KNOWN_GEOMETRY',
];
