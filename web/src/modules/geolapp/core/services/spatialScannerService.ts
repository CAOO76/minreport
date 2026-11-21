/**
 * Servicio Espacial Nativo Solo-Camara ARCore VIO + Depth API y Analitica 3D CAS.
 * Conecta el plugin Android `MinreportSpatialScanner` con `/api/geolapp/*spatial-analyze`
 * en `southamerica-west1` y la persistencia CAS offline en IndexedDB (`OfflineStorage`).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { mediaDigestorClient } from '../../../../core/media/MediaDigestorClient';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { offlineStorage } from '../../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../../core/offline/SyncQueueEngine';
import { probeSpatialDeviceCapability } from './spatialDeviceCapability';
import type { CopperMineralDomain, GeolappGeometryType } from '../types/GeolappTypes';

export type SpatialDepthMode = 'RAW_DEPTH_ONLY' | 'AUTOMATIC' | 'VIO_POINTCLOUD';

const CALIBRATION_STORAGE_KEY = 'minreport_spatial_device_calibration_v1';
const CALIBRATION_HISTORY_STORAGE_KEY = 'spatial_device_calibration_history_v1';
export const CALIBRATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Formatea m³ para operación industrial: 2 decimales si < 10 m³, 1 decimal si >= 10 m³.
 */
export function formatStockpileVolumeM3(volumeM3: number): string {
    if (!Number.isFinite(volumeM3) || volumeM3 <= 0) {
        return '0.00';
    }
    return volumeM3 < 10 ? volumeM3.toFixed(2) : volumeM3.toFixed(1);
}

export class SpatialScanRejectedError extends Error {
    public readonly status = 422;
    public readonly rejectionCode: string;

    constructor(rejectionCode: string, message: string) {
        super(message);
        this.name = 'SpatialScanRejectedError';
        this.rejectionCode = rejectionCode;
    }
}

export interface NativeCalibrationResult {
    cancelled?: boolean;
    calibrated: boolean;
    scaleFactor: number;
    referenceDistanceM: number;
    measuredDistanceM?: number;
    planeNoiseRmsM?: number;
    imuPitchOffsetDeg?: number;
    imuRollOffsetDeg?: number;
    calibratedAt: number;
    calibrationId?: string;
    localId?: string;
    deviceModel?: string;
    platform?: string;
    actorUid?: string;
    region?: string;
    syncedToCloud?: boolean;
}

export type DeviceCalibrationRecord = NativeCalibrationResult;

export interface SpatialScanKeyframe {
    index: number;
    angleDeg: number;
    blurScore: number;
    photoPath?: string;
}

export interface SpatialScanNativeResult {
    cancelled?: boolean;
    scanId?: string;
    deviceModel?: string;
    depthMode?: SpatialDepthMode;
    coveragePct?: number;
    sectorsCovered?: number;
    sectorsTotal?: number;
    roiRadiusM?: number;
    keyframeCount?: number;
    loopClosed?: boolean;
    anchorCenter?: { x: number; y: number; z: number };
    pointsM?: Array<[number, number, number]>;
    groundSamplesM?: Array<[number, number, number]>;
    keyframes?: SpatialScanKeyframe[];
    rejectedBlurCount?: number;
    calibrationScaleFactor?: number;
    calibrationId?: string;
    calibrationPlaneNoiseRmsM?: number;
    deviceCalibratedAt?: number;
}

export interface SpatialOfflineStoredPayload {
    scanId?: string;
    deviceModel?: string;
    depthMode: SpatialDepthMode;
    coveragePct: number;
    sectorsCovered: number;
    sectorsTotal?: number;
    roiRadiusM?: number;
    keyframeCount: number;
    loopClosed: boolean;
    anchorCenter?: { x: number; y: number; z: number };
    pointsM: Array<[number, number, number]>;
    groundSamplesM?: Array<[number, number, number]>;
    rejectedBlurCount?: number;
    calibrationScaleFactor?: number;
    calibrationId?: string;
    calibrationPlaneNoiseRmsM?: number;
    deviceCalibratedAt?: number;
}

export interface SpatialAnalyzeRequest {
    stockpileId?: string;
    measurementId?: string;
    tenantId?: string;
    scan: SpatialScanNativeResult;
    primaryBlob?: Blob;
    extraBlobs?: Blob[];
    photoUrl?: string;
    locale?: 'es' | 'en' | 'pt';
    calibrationId?: string;
    calibrationScaleFactor?: number;
    calibrationPlaneNoiseRmsM?: number;
    deviceCalibratedAt?: number;
}

export interface SpatialAnalyzeResult {
    verified: boolean;
    scaleVerified: boolean;
    volumeM3: number;
    weightT: number;
    uncertaintyPct: number;
    toeScore: number;
    coveragePct: number;
    depthMode: SpatialDepthMode | string;
    groundSlopeDeg: number;
    geometryType: GeolappGeometryType;
    isNonStockpile?: boolean;
    wallConfinement?: 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';
    copperDomain: CopperMineralDomain | null;
    granulometry: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
    aiSuggestedGranulometry?: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
    suggestedDensityTm3: number | null;
    slopeAngleLeftDeg?: number | null;
    slopeAngleRightDeg?: number | null;
    slopeAngleAvgDeg: number | null;
    slopeWarning: string | null;
    dimensionsM: Record<string, number> | null;
    meshUrl: string | null;
    meshSha256: string | null;
    meshSource: string | null;
    tinVolumeM3?: number | null;
    reasoning: string;
}

interface MinreportSpatialScannerNative {
    startSpatialScan(): Promise<SpatialScanNativeResult>;
    startCalibration(): Promise<NativeCalibrationResult>;
    getCalibrationStatus(): Promise<NativeCalibrationResult>;
}

const MinreportSpatialScanner =
    registerPlugin<MinreportSpatialScannerNative>('MinreportSpatialScanner');

function blobToBase64Raw(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const raw = String(reader.result || '');
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
        };
        reader.onerror = () => reject(new Error('No se pudo codificar la fotografía espacial.'));
        reader.readAsDataURL(blob);
    });
}

async function prepareImageBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
    try {
        const digested = await mediaDigestorClient.digestFile(blob, 'IMAGE_FIELD_EVIDENCE');
        return {
            base64: await blobToBase64Raw(digested.blob),
            mimeType: digested.mimeType || 'image/webp',
        };
    } catch {
        return {
            base64: await blobToBase64Raw(blob),
            mimeType: blob.type || 'image/webp',
        };
    }
}

async function computeBlobSha256Hex(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    return `spatial_${Date.now()}_${buffer.byteLength}`;
}

export function getCachedCalibration(): NativeCalibrationResult | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as NativeCalibrationResult;
        return parsed && typeof parsed.scaleFactor === 'number' ? parsed : null;
    } catch {
        return null;
    }
}

export function isCalibrationValid(cal?: NativeCalibrationResult | null): boolean {
    if (!cal || !cal.calibrated) return false;
    if (
        typeof cal.scaleFactor !== 'number' ||
        !Number.isFinite(cal.scaleFactor) ||
        cal.scaleFactor < 0.85 ||
        cal.scaleFactor > 1.15
    ) {
        return false;
    }
    if (typeof cal.calibratedAt !== 'number' || cal.calibratedAt <= 0) return false;
    return Date.now() - cal.calibratedAt <= CALIBRATION_MAX_AGE_MS;
}

export function calibrationRemainingDays(cal: NativeCalibrationResult | null): number {
    if (!cal || !cal.calibrated || typeof cal.calibratedAt !== 'number' || cal.calibratedAt <= 0) {
        return 0;
    }
    const remainingMs = cal.calibratedAt + CALIBRATION_MAX_AGE_MS - Date.now();
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

function mergeAndSortCalibrations(items: NativeCalibrationResult[]): NativeCalibrationResult[] {
    const byKey = new Map<string, NativeCalibrationResult>();
    for (const item of items) {
        if (!item || !item.calibratedAt) continue;
        const key = item.calibrationId
            ? `id:${item.calibrationId}`
            : `ts:${item.calibratedAt}:${Number(item.scaleFactor || 1).toFixed(4)}`;
        const prev = byKey.get(key);
        if (!prev || (!prev.syncedToCloud && item.syncedToCloud)) {
            byKey.set(key, item);
        }
    }
    return Array.from(byKey.values())
        .sort((a, b) => Number(b.calibratedAt || 0) - Number(a.calibratedAt || 0))
        .slice(0, 50);
}

async function persistCachedCalibration(cal: NativeCalibrationResult): Promise<void> {
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(cal));
        } catch {
            // Ignorar cuotas de localStorage
        }
    }
    try {
        await offlineStorage.putOfflineMetadata('spatial_device_calibration', cal);
    } catch {
        // Entorno sin IndexedDB
    }
}

async function appendLocalCalibrationHistory(
    cal: NativeCalibrationResult
): Promise<NativeCalibrationResult[]> {
    const existing = await getCachedCalibrationHistory();
    const next = mergeAndSortCalibrations([cal, ...existing]);
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(CALIBRATION_HISTORY_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Ignorar cuotas de localStorage
        }
    }
    try {
        await offlineStorage.putOfflineMetadata(CALIBRATION_HISTORY_STORAGE_KEY, next);
    } catch {
        // Entorno sin IndexedDB
    }
    return next;
}

export async function getCachedCalibrationHistory(): Promise<NativeCalibrationResult[]> {
    try {
        const stored = await offlineStorage.getOfflineMetadata<NativeCalibrationResult[]>(
            CALIBRATION_HISTORY_STORAGE_KEY
        );
        if (Array.isArray(stored) && stored.length > 0) {
            return mergeAndSortCalibrations(stored);
        }
    } catch {
        // Fallback localStorage
    }
    if (typeof window !== 'undefined') {
        try {
            const raw = window.localStorage.getItem(CALIBRATION_HISTORY_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as NativeCalibrationResult[];
                if (Array.isArray(parsed)) {
                    return mergeAndSortCalibrations(parsed);
                }
            }
        } catch {
            // Ignorar JSON corrupto
        }
    }
    const single = getCachedCalibration();
    return single && single.calibratedAt > 0 ? [single] : [];
}

/**
 * Obtiene el historial auditable de calibraciones del tenant en `southamerica-west1`,
 * combinando registros cloud con calibraciones pendientes en cola offline.
 */
export async function fetchDeviceCalibrationHistory(
    tenantId?: string
): Promise<NativeCalibrationResult[]> {
    const localHistory = await getCachedCalibrationHistory();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return localHistory;
    }

    try {
        const headers: Record<string, string> = {};
        if (tenantId) {
            headers['X-Active-Account-Id'] = tenantId;
        }
        const url = tenantId
            ? `/api/geolapp/device-calibrations?tenantId=${encodeURIComponent(tenantId)}`
            : '/api/geolapp/device-calibrations';
        const res = await coreAuthFetch(url, { method: 'GET', headers });
        if (!res.ok) {
            return localHistory;
        }
        const data = (await res.json().catch(() => ({}))) as {
            calibrations?: Array<Record<string, any>>;
        };
        const remoteItems: NativeCalibrationResult[] = (data.calibrations || []).map((row) => ({
            calibrated: true,
            calibrationId: String(row.calibrationId || ''),
            scaleFactor: Number(row.scaleFactor ?? 1),
            referenceDistanceM: Number(row.referenceDistanceM ?? 2),
            measuredDistanceM:
                typeof row.measuredDistanceM === 'number' ? row.measuredDistanceM : undefined,
            planeNoiseRmsM:
                typeof row.planeNoiseRmsM === 'number' ? row.planeNoiseRmsM : undefined,
            imuPitchOffsetDeg:
                typeof row.imuPitchOffsetDeg === 'number' ? row.imuPitchOffsetDeg : undefined,
            imuRollOffsetDeg:
                typeof row.imuRollOffsetDeg === 'number' ? row.imuRollOffsetDeg : undefined,
            calibratedAt: Number(row.calibratedAt || row.createdAt || 0),
            deviceModel: typeof row.deviceModel === 'string' ? row.deviceModel : undefined,
            platform: typeof row.platform === 'string' ? row.platform : undefined,
            actorUid: typeof row.actorUid === 'string' ? row.actorUid : undefined,
            region: typeof row.region === 'string' ? row.region : 'southamerica-west1',
            syncedToCloud: true,
        }));

        const pendingLocal = localHistory.filter(
            (loc) =>
                !loc.syncedToCloud &&
                !remoteItems.some(
                    (rem) =>
                        rem.calibratedAt === loc.calibratedAt &&
                        Math.abs(rem.scaleFactor - loc.scaleFactor) < 0.0005
                )
        );

        const merged = mergeAndSortCalibrations([...remoteItems, ...pendingLocal]);
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem(CALIBRATION_HISTORY_STORAGE_KEY, JSON.stringify(merged));
            } catch {
                // Ignorar cuota
            }
        }
        try {
            await offlineStorage.putOfflineMetadata(CALIBRATION_HISTORY_STORAGE_KEY, merged);
        } catch {
            // Entorno sin IDB
        }
        return merged;
    } catch {
        return localHistory;
    }
}

function buildStoredPayload(
    scan: SpatialScanNativeResult,
    overrides?: {
        calibrationId?: string;
        calibrationScaleFactor?: number;
        calibrationPlaneNoiseRmsM?: number;
        deviceCalibratedAt?: number;
    }
): SpatialOfflineStoredPayload {
    const pointsM = Array.isArray(scan.pointsM) ? scan.pointsM : [];
    const groundSamplesM = Array.isArray(scan.groundSamplesM) ? scan.groundSamplesM : undefined;
    const cachedCal = getCachedCalibration();
    const fallbackCalValid = isCalibrationValid(cachedCal);

    const calibrationScaleFactor =
        typeof overrides?.calibrationScaleFactor === 'number'
            ? overrides.calibrationScaleFactor
            : typeof scan.calibrationScaleFactor === 'number'
              ? scan.calibrationScaleFactor
              : fallbackCalValid && cachedCal
                ? cachedCal.scaleFactor
                : undefined;

    const calibrationId =
        overrides?.calibrationId ||
        scan.calibrationId ||
        (fallbackCalValid && cachedCal?.calibrationId ? cachedCal.calibrationId : undefined);

    const calibrationPlaneNoiseRmsM =
        typeof overrides?.calibrationPlaneNoiseRmsM === 'number'
            ? overrides.calibrationPlaneNoiseRmsM
            : typeof scan.calibrationPlaneNoiseRmsM === 'number'
              ? scan.calibrationPlaneNoiseRmsM
              : fallbackCalValid && cachedCal
                ? cachedCal.planeNoiseRmsM
                : undefined;

    const deviceCalibratedAt =
        typeof overrides?.deviceCalibratedAt === 'number'
            ? overrides.deviceCalibratedAt
            : typeof scan.deviceCalibratedAt === 'number'
              ? scan.deviceCalibratedAt
              : fallbackCalValid && cachedCal
                ? cachedCal.calibratedAt
                : undefined;

    return {
        scanId: scan.scanId,
        deviceModel: scan.deviceModel,
        depthMode: scan.depthMode || 'VIO_POINTCLOUD',
        coveragePct: typeof scan.coveragePct === 'number' && Number.isFinite(scan.coveragePct) ? scan.coveragePct : 0,
        sectorsCovered:
            typeof scan.sectorsCovered === 'number' && Number.isFinite(scan.sectorsCovered)
                ? scan.sectorsCovered
                : 0,
        sectorsTotal:
            typeof scan.sectorsTotal === 'number' && Number.isFinite(scan.sectorsTotal)
                ? scan.sectorsTotal
                : undefined,
        roiRadiusM:
            typeof scan.roiRadiusM === 'number' && Number.isFinite(scan.roiRadiusM)
                ? scan.roiRadiusM
                : undefined,
        keyframeCount: Math.max(
            1,
            typeof scan.keyframeCount === 'number' && Number.isFinite(scan.keyframeCount)
                ? scan.keyframeCount
                : Array.isArray(scan.keyframes)
                  ? Math.max(1, scan.keyframes.length)
                  : 1
        ),
        loopClosed: Boolean(scan.loopClosed),
        anchorCenter: scan.anchorCenter,
        pointsM,
        groundSamplesM,
        rejectedBlurCount: scan.rejectedBlurCount,
        ...(typeof calibrationScaleFactor === 'number' ? { calibrationScaleFactor } : {}),
        ...(calibrationId ? { calibrationId } : {}),
        ...(typeof calibrationPlaneNoiseRmsM === 'number' ? { calibrationPlaneNoiseRmsM } : {}),
        ...(typeof deviceCalibratedAt === 'number' ? { deviceCalibratedAt } : {}),
    };
}

/**
 * Consulta el estado persistido de calibración métrica (2.00 m con huincha) en Android
 * con fallback limpio a caché local offline.
 */
export async function getNativeCalibrationStatus(): Promise<NativeCalibrationResult> {
    const cached = getCachedCalibration();
    const idbCached =
        cached ||
        (await offlineStorage
            .getOfflineMetadata<NativeCalibrationResult>('spatial_device_calibration')
            .catch(() => null));

    if (Capacitor.isNativePlatform()) {
        try {
            const nativeRes = await MinreportSpatialScanner.getCalibrationStatus();
            if (nativeRes && nativeRes.calibrated) {
                const merged: NativeCalibrationResult = {
                    ...nativeRes,
                    calibrationId:
                        idbCached?.calibratedAt === nativeRes.calibratedAt
                            ? idbCached.calibrationId
                            : nativeRes.calibrationId,
                    syncedToCloud:
                        idbCached?.calibratedAt === nativeRes.calibratedAt
                            ? idbCached.syncedToCloud
                            : false,
                };
                await persistCachedCalibration(merged);
                return merged;
            }
        } catch {
            // Mantener fallback a caché local
        }
    }

    return (
        idbCached || {
            calibrated: false,
            scaleFactor: 1.0,
            referenceDistanceM: 2.0,
            calibratedAt: 0,
        }
    );
}

/**
 * Envía y audita la calibración del dispositivo en `southamerica-west1` (`POST /api/geolapp/device-calibration`).
 */
export async function syncDeviceCalibrationToBackend(
    cal: NativeCalibrationResult,
    tenantId?: string
): Promise<NativeCalibrationResult> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (tenantId) {
        headers['X-Active-Account-Id'] = tenantId;
    }

    const measuredDistanceM =
        typeof cal.measuredDistanceM === 'number' && Number.isFinite(cal.measuredDistanceM)
            ? cal.measuredDistanceM
            : Number(((cal.referenceDistanceM || 2.0) / (cal.scaleFactor || 1.0)).toFixed(4));

    let deviceModel = cal.deviceModel;
    let platform = cal.platform;
    if (!deviceModel || !platform) {
        try {
            const cap = await probeSpatialDeviceCapability();
            if (!deviceModel) {
                const rawModel = [cap.manufacturer, cap.model].filter(Boolean).join(' ').trim();
                deviceModel = rawModel ? rawModel.slice(0, 120) : undefined;
            }
            if (!platform && cap.platform) {
                platform = cap.platform.toUpperCase();
            }
        } catch {
            // Best-effort sin bloquear calibración
        }
    }

    const calibratedAt = cal.calibratedAt || Date.now();
    const enrichedLocal: NativeCalibrationResult = {
        ...cal,
        measuredDistanceM,
        calibratedAt,
        ...(deviceModel ? { deviceModel } : {}),
        ...(platform ? { platform } : {}),
    };

    const res = await coreAuthFetch('/api/geolapp/device-calibration', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            scaleFactor: enrichedLocal.scaleFactor,
            referenceDistanceM: enrichedLocal.referenceDistanceM || 2.0,
            measuredDistanceM,
            planeNoiseRmsM: enrichedLocal.planeNoiseRmsM ?? 0,
            imuPitchOffsetDeg: enrichedLocal.imuPitchOffsetDeg ?? 0,
            imuRollOffsetDeg: enrichedLocal.imuRollOffsetDeg ?? 0,
            calibratedAt,
            tenantId,
            ...(deviceModel ? { deviceModel } : {}),
            ...(platform ? { platform } : {}),
        }),
    });

    const data = (await res.json().catch(() => ({}))) as { calibrationId?: string };
    if (!res.ok) {
        return { ...enrichedLocal, syncedToCloud: false };
    }

    const synced: NativeCalibrationResult = {
        ...enrichedLocal,
        calibrationId: data.calibrationId || enrichedLocal.calibrationId,
        syncedToCloud: true,
    };
    await persistCachedCalibration(synced);
    await appendLocalCalibrationHistory(synced);
    return synced;
}

/**
 * Inicia el asistente nativo de calibración de huincha 2.00 m en suelo plano (`MinreportSpatialScanner.startCalibration`).
 * Registra siempre historial local + cloud (`POST /api/geolapp/device-calibration`) con cola offline automática.
 */
export async function startNativeCalibration(tenantId?: string): Promise<NativeCalibrationResult> {
    if (!Capacitor.isNativePlatform()) {
        return {
            cancelled: true,
            calibrated: false,
            scaleFactor: 1.0,
            referenceDistanceM: 2.0,
            calibratedAt: 0,
        };
    }

    let raw: NativeCalibrationResult;
    try {
        raw = await MinreportSpatialScanner.startCalibration();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err || '');
        if (/cancel/i.test(msg)) {
            return {
                cancelled: true,
                calibrated: false,
                scaleFactor: 1.0,
                referenceDistanceM: 2.0,
                calibratedAt: 0,
            };
        }
        throw err instanceof Error ? err : new Error(msg || 'Error calibrando sensor espacial.');
    }

    if (!raw || raw.cancelled || !raw.calibrated) {
        return {
            cancelled: Boolean(raw?.cancelled ?? true),
            calibrated: false,
            scaleFactor: 1.0,
            referenceDistanceM: 2.0,
            calibratedAt: 0,
        };
    }

    let deviceModel = raw.deviceModel;
    let platform = raw.platform;
    try {
        const cap = await probeSpatialDeviceCapability();
        if (!deviceModel) {
            const rawModel = [cap.manufacturer, cap.model].filter(Boolean).join(' ').trim();
            deviceModel = rawModel ? rawModel.slice(0, 120) : undefined;
        }
        if (!platform && cap.platform) {
            platform = cap.platform.toUpperCase();
        }
    } catch {
        // Ignorar fallo de sonda hardware
    }

    const calibratedAt = raw.calibratedAt || Date.now();
    const measuredDistanceM =
        typeof raw.measuredDistanceM === 'number' && Number.isFinite(raw.measuredDistanceM)
            ? raw.measuredDistanceM
            : Number(((raw.referenceDistanceM || 2.0) / (raw.scaleFactor || 1.0)).toFixed(4));

    const localCal: NativeCalibrationResult = {
        ...raw,
        localId: `cal_${calibratedAt}`,
        measuredDistanceM,
        calibratedAt,
        ...(deviceModel ? { deviceModel } : {}),
        ...(platform ? { platform } : {}),
        syncedToCloud: false,
    };
    await persistCachedCalibration(localCal);
    await appendLocalCalibrationHistory(localCal);

    try {
        const synced = await syncDeviceCalibrationToBackend(localCal, tenantId);
        if (synced.syncedToCloud) {
            return synced;
        }
    } catch {
        // Sin conectividad: encolar sincronización offline garantizada
    }

    try {
        await syncQueueEngine.enqueue({
            module: 'stockpile',
            entityType: 'DEVICE_CALIBRATION',
            tenantId,
            payload: {
                id: localCal.localId,
                scaleFactor: localCal.scaleFactor,
                referenceDistanceM: localCal.referenceDistanceM || 2.0,
                measuredDistanceM,
                planeNoiseRmsM: localCal.planeNoiseRmsM ?? 0,
                imuPitchOffsetDeg: localCal.imuPitchOffsetDeg ?? 0,
                imuRollOffsetDeg: localCal.imuRollOffsetDeg ?? 0,
                calibratedAt,
                ...(tenantId ? { tenantId } : {}),
                ...(deviceModel ? { deviceModel } : {}),
                ...(platform ? { platform } : {}),
            },
        });
    } catch {
        // Ignorar error de encolado offline
    }

    return localCal;
}

/**
 * Ejecuta el escáner espacial nativo Android ARCore VIO/Depth y convierte las rutas locales
 * `keyframes[].photoPath` a `Blob[]` reales listos para digestión CAS y vista previa.
 */
export async function startNativeSpatialScan(): Promise<{
    scan: SpatialScanNativeResult;
    photoBlobs: Blob[];
}> {
    if (!Capacitor.isNativePlatform()) {
        return { scan: { cancelled: true }, photoBlobs: [] };
    }

    let raw: SpatialScanNativeResult;
    try {
        raw = await MinreportSpatialScanner.startSpatialScan();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err || '');
        if (/cancel/i.test(msg)) {
            return { scan: { cancelled: true }, photoBlobs: [] };
        }
        throw err instanceof Error ? err : new Error(msg || 'Error iniciando escaneo espacial.');
    }

    if (!raw || raw.cancelled) {
        return { scan: { ...(raw || {}), cancelled: true }, photoBlobs: [] };
    }

    const keyframes = Array.isArray(raw.keyframes) ? raw.keyframes : [];
    const photoBlobs: Blob[] = [];

    for (const kf of keyframes) {
        const path = typeof kf?.photoPath === 'string' ? kf.photoPath.trim() : '';
        if (!path) continue;
        try {
            const webSrc = Capacitor.convertFileSrc(path);
            const res = await fetch(webSrc);
            if (!res.ok) continue;
            const rawBlob = await res.blob();
            if (!rawBlob || rawBlob.size <= 0) continue;
            if (rawBlob.type && rawBlob.type.startsWith('image/')) {
                photoBlobs.push(rawBlob);
            } else {
                const ab = await rawBlob.arrayBuffer();
                photoBlobs.push(new Blob([ab], { type: 'image/jpeg' }));
            }
        } catch {
            // Omitir keyframe ilegible sin abortar la nube métrica capturada
        }
    }

    return { scan: raw, photoBlobs };
}

/**
 * Persiste la nube métrica espacial (`application/json`) en IndexedDB CAS (`OfflineStorage`)
 * evitando saturar `localStorage` cuando no hay conectividad en faena.
 */
export async function saveOfflineSpatialPayload(
    scan: SpatialScanNativeResult,
    tenantId?: string
): Promise<string> {
    const stored = buildStoredPayload(scan);
    const jsonText = JSON.stringify(stored);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const sha256 = await computeBlobSha256Hex(blob);
    const resolvedTenant =
        tenantId?.trim() ||
        (typeof window !== 'undefined'
            ? window.localStorage.getItem('minreport_active_account_id')?.trim() || undefined
            : undefined) ||
        'offline-local';

    await offlineStorage.putCasBlob({
        sha256,
        blob,
        mimeType: 'application/json',
        profile: 'SPATIAL_CLOUD_JSON',
        scope: 'TENANT_PRIVATE',
        tenantId: resolvedTenant,
        filename: `spatial_${stored.scanId || Date.now()}.json`,
        originalBytes: blob.size,
        optimizedBytes: blob.size,
        updatedAt: Date.now(),
    });

    return sha256;
}

/**
 * Recupera desde IndexedDB CAS una nube métrica espacial almacenada offline por su SHA-256.
 */
export async function loadOfflineSpatialPayload(
    sha256: string
): Promise<SpatialOfflineStoredPayload | null> {
    if (!sha256) return null;
    const record = await offlineStorage.getCasBlob(sha256).catch(() => null);
    if (!record?.blob) return null;
    const text = await record.blob.text();
    const parsed = JSON.parse(text) as SpatialOfflineStoredPayload;
    return parsed && Array.isArray(parsed.pointsM) ? parsed : null;
}

/**
 * Envía la nube métrica 3D y evidencia fotográfica digerida por CAS al backend en `southamerica-west1`
 * para ejecutar Toe Solver RANSAC + malla `.glb` watertight + clasificación geo-metalúrgica.
 */
export async function analyzeSpatialScan(
    request: SpatialAnalyzeRequest
): Promise<SpatialAnalyzeResult> {
    const storedBody = buildStoredPayload(request.scan, {
        calibrationId: request.calibrationId,
        calibrationScaleFactor: request.calibrationScaleFactor,
        calibrationPlaneNoiseRmsM: request.calibrationPlaneNoiseRmsM,
        deviceCalibratedAt: request.deviceCalibratedAt,
    });

    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (request.primaryBlob) {
        const prepared = await prepareImageBase64(request.primaryBlob);
        imageBase64 = prepared.base64;
        imageMimeType = prepared.mimeType;
    }

    const extraImagesBase64: string[] = [];
    if (Array.isArray(request.extraBlobs)) {
        for (const extraBlob of request.extraBlobs.slice(0, 3)) {
            const preparedExtra = await prepareImageBase64(extraBlob);
            if (preparedExtra.base64) {
                extraImagesBase64.push(preparedExtra.base64);
            }
        }
    }

    const endpoint = request.stockpileId
        ? `/api/geolapp/stockpiles/${encodeURIComponent(request.stockpileId)}/spatial-analyze`
        : '/api/geolapp/spatial-analyze';

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (request.tenantId) {
        headers['X-Active-Account-Id'] = request.tenantId;
    }

    const safePhotoUrl =
        request.photoUrl &&
        !request.photoUrl.startsWith('offline-cas://') &&
        !request.photoUrl.startsWith('blob:') &&
        !request.photoUrl.startsWith('data:')
            ? request.photoUrl
            : undefined;

    const res = await coreAuthFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            measurementId: request.measurementId,
            tenantId: request.tenantId,
            ...storedBody,
            imageBase64,
            imageMimeType,
            extraImagesBase64: extraImagesBase64.length > 0 ? extraImagesBase64 : undefined,
            photoUrl: safePhotoUrl,
            locale: request.locale || 'es',
        }),
    });

    const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        rejectionCode?: string;
        message?: string;
    };
    if (res.status === 422) {
        const rejectionCode = String(data?.rejectionCode || data?.error || 'INVALID_POINT_CLOUD');
        const message = String(
            data?.message || data?.error || 'La captura fue rechazada por validación física.'
        );
        throw new SpatialScanRejectedError(rejectionCode, message);
    }
    if (!res.ok) {
        const err = new Error(
            data?.message || data?.error || `HTTP ${res.status} en análisis espacial 3D`
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }

    return data as SpatialAnalyzeResult;
}
