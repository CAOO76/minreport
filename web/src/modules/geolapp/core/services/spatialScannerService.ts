/**
 * Servicio Espacial Nativo Solo-Camara ARCore VIO + Depth API y Analitica 3D CAS.
 * Conecta el plugin Android `MinreportSpatialScanner` con `/api/geolapp/*spatial-analyze`
 * en `southamerica-west1` y la persistencia CAS offline en IndexedDB (`OfflineStorage`).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import {
    CaptureSessionPackageV2Schema,
    DemGridV1Schema,
    InSituMetrologySchema,
    WalkRingPoseSchema,
    type CaptureKeyframeV2,
    type CaptureSessionPackageV2,
    type DemGridV1,
    type InSituMetrology,
    type WalkRingPose,
} from '../../../../contracts/acopios.contracts';
import { mediaDigestorClient } from '../../../../core/media/MediaDigestorClient';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { localCasFilesystem } from '../../../../core/offline/LocalCasFilesystemService';
import { offlineStorage } from '../../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../../core/offline/SyncQueueEngine';
import { probeSpatialDeviceCapability } from './spatialDeviceCapability';
import type { CopperMineralDomain, GeolappGeometryType } from '../types/GeolappTypes';

export type SpatialDepthMode =
    | 'DISABLED'
    | 'VIO_ORB_MVS'
    | 'VIO_MVS_OFFLINE'
    | 'RAW_DEPTH_ONLY'
    | 'HARDWARE_TOF_DEPTH'
    | 'AUTOMATIC'
    | 'VIO_POINTCLOUD';

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

export interface SpatialScanKeyframeV2Native {
    index: number;
    photoPath?: string;
    mimeType?: string;
    originalBytes?: number;
    optimizedBytes?: number;
    savingsPct?: number;
    displayRotationDeg?: number;
    poseSE3?: {
        r: number[];
        t: [number, number, number];
    };
    intrinsics?: {
        fx: number;
        fy: number;
        cx: number;
        cy: number;
        width?: number;
        height?: number;
        widthPx?: number;
        heightPx?: number;
    };
    timestampNs?: number;
    azimuthDeg?: number;
    pitchDeg?: number;
    imuPitchDeg?: number;
    sharpnessScore?: number;
    angleDeg?: number;
    blurScore?: number;
}

export interface PairedSpatialKeyframe {
    blob: Blob;
    meta?: SpatialScanKeyframeV2Native;
}

export interface SpatialScanNativeResult {
    cancelled?: boolean;
    errorCode?: string;
    errorMessage?: string;
    scanId?: string;
    scannerEngineVersion?: string;
    orientationMode?: string;
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
    walkRingPoses?: WalkRingPose[];
    keyframes?: SpatialScanKeyframe[];
    keyframesV2?: SpatialScanKeyframeV2Native[];
    inSituMetrology?: InSituMetrology | null;
    localPreviewMesh?: DemGridV1 | null;
    captureImuPitchDeg?: number;
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
 * Normaliza un resultado crudo emitido por `MinreportSpatialScannerActivity.java` (Android V2)
 * o por un payload canónico de frontend hacia `SpatialScanNativeResult`, evitando cualquier
 * `TypeError` o desajuste Zod entre Android (`dimensionsM`, `cols`/`rows`/`observedMask`,
 * `walkRingPoses {x,y,z,fx,fy,fz,ts}`, `imuPitchDeg`, `groundSlopeDeg`) y los contratos Web V2.
 */
export function normalizeNativeSpatialScan(rawInput: unknown): SpatialScanNativeResult {
    if (!rawInput || typeof rawInput !== 'object') {
        return { cancelled: true };
    }
    const raw = rawInput as Record<string, unknown>;
    if (raw.cancelled === true) {
        return { ...(raw as SpatialScanNativeResult), cancelled: true };
    }

    const toFinite = (val: unknown): number | undefined =>
        typeof val === 'number' && Number.isFinite(val) ? val : undefined;

    // 1. Normalizar keyframesV2 (imuPitchDeg -> pitchDeg, widthPx/heightPx -> width/height)
    const rawKeyframesV2 = Array.isArray(raw.keyframesV2)
        ? (raw.keyframesV2 as Array<Record<string, unknown>>)
        : [];
    const normalizedKeyframesV2: SpatialScanKeyframeV2Native[] = rawKeyframesV2.map((kf, idx) => {
        const pitchVal = toFinite(kf.pitchDeg) ?? toFinite(kf.imuPitchDeg);
        const rawIntr =
            kf.intrinsics && typeof kf.intrinsics === 'object'
                ? (kf.intrinsics as Record<string, unknown>)
                : null;
        const intrinsics = rawIntr
            ? {
                  fx: toFinite(rawIntr.fx) ?? 960,
                  fy: toFinite(rawIntr.fy) ?? 960,
                  cx: toFinite(rawIntr.cx) ?? 640,
                  cy: toFinite(rawIntr.cy) ?? 480,
                  width: Math.round(toFinite(rawIntr.width) ?? toFinite(rawIntr.widthPx) ?? 1280),
                  height: Math.round(toFinite(rawIntr.height) ?? toFinite(rawIntr.heightPx) ?? 960),
              }
            : undefined;
        return {
            ...(kf as unknown as SpatialScanKeyframeV2Native),
            index: typeof kf.index === 'number' ? kf.index : idx,
            displayRotationDeg: toFinite(kf.displayRotationDeg) ?? 0,
            ...(intrinsics ? { intrinsics } : {}),
            ...(pitchVal !== undefined ? { pitchDeg: pitchVal, imuPitchDeg: pitchVal } : {}),
            ...(toFinite(kf.azimuthDeg) !== undefined
                ? { azimuthDeg: toFinite(kf.azimuthDeg) }
                : toFinite(kf.angleDeg) !== undefined
                  ? { azimuthDeg: toFinite(kf.angleDeg) }
                  : {}),
            ...(toFinite(kf.sharpnessScore) !== undefined
                ? { sharpnessScore: toFinite(kf.sharpnessScore) }
                : toFinite(kf.blurScore) !== undefined
                  ? { sharpnessScore: toFinite(kf.blurScore) }
                  : {}),
        };
    });

    // 2. Calcular captureImuPitchDeg (valor explícito o mediana de imuPitchDeg/pitchDeg en keyframes)
    let captureImuPitchDeg = toFinite(raw.captureImuPitchDeg);
    if (captureImuPitchDeg === undefined) {
        const pitches = normalizedKeyframesV2
            .map((kf) => toFinite(kf.pitchDeg ?? kf.imuPitchDeg))
            .filter((v): v is number => v !== undefined)
            .sort((a, b) => a - b);
        if (pitches.length > 0) {
            const mid = Math.floor(pitches.length / 2);
            captureImuPitchDeg =
                pitches.length % 2 === 1
                    ? pitches[mid]
                    : Number(((pitches[mid - 1] + pitches[mid]) / 2).toFixed(2));
        }
    }

    // 3. Normalizar walkRingPoses aceptando { x, y, z, fx, fy, fz, ts }, [x,y,z] y { t: [x,y,z] }
    const rawWalkRing = Array.isArray(raw.walkRingPoses)
        ? raw.walkRingPoses
        : Array.isArray(raw.walkRing)
          ? raw.walkRing
          : undefined;
    const normalizedWalkRingPoses: WalkRingPose[] | undefined = rawWalkRing
        ? rawWalkRing
              .map((entry) => WalkRingPoseSchema.safeParse(entry))
              .filter((r): r is { success: true; data: WalkRingPose } => r.success)
              .map((r) => r.data)
        : undefined;

    // 4. Normalizar localPreviewMesh (cols/rows -> nx/nz, observedMask -> confidenceMask, groundSlopeDeg -> groundPlane)
    let normalizedPreviewMesh: DemGridV1 | null = null;
    if (raw.localPreviewMesh && typeof raw.localPreviewMesh === 'object') {
        const parsedDem = DemGridV1Schema.safeParse(raw.localPreviewMesh);
        if (parsedDem.success) {
            normalizedPreviewMesh = parsedDem.data;
        }
    }

    // 5. Normalizar inSituMetrology (Android dimensionsM/groundSlopeDeg -> baseLengthM/baseWidthM/heightMaxM/groundPlane)
    let normalizedMetrology: InSituMetrology | null = null;
    if (raw.inSituMetrology && typeof raw.inSituMetrology === 'object') {
        const m = raw.inSituMetrology as Record<string, unknown>;
        const volumeM3 = toFinite(m.volumeM3);
        if (volumeM3 !== undefined && volumeM3 > 0) {
            const dims =
                m.dimensionsM && typeof m.dimensionsM === 'object'
                    ? (m.dimensionsM as Record<string, unknown>)
                    : null;
            const rawGp =
                m.groundPlane && typeof m.groundPlane === 'object'
                    ? (m.groundPlane as Record<string, unknown>)
                    : null;

            const baseLengthM = Math.max(
                0.05,
                toFinite(m.baseLengthM) ?? toFinite(dims?.a) ?? toFinite(dims?.lengthM) ?? 0.5
            );
            const baseWidthM = Math.max(
                0.05,
                toFinite(m.baseWidthM) ?? toFinite(dims?.b) ?? toFinite(dims?.widthM) ?? baseLengthM
            );
            const heightMaxM = Math.max(
                0.02,
                toFinite(m.heightMaxM) ??
                    toFinite(dims?.h) ??
                    toFinite(dims?.heightM) ??
                    toFinite(m.maxHeightM) ??
                    normalizedPreviewMesh?.maxHeightM ??
                    0.1
            );
            const footprintAreaM2 = Math.max(
                0,
                toFinite(m.footprintAreaM2) ??
                    Number((Math.PI * (baseLengthM * 0.5) * (baseWidthM * 0.5)).toFixed(2))
            );
            const sectorsCovered = toFinite(m.sectorsCovered) ?? toFinite(raw.sectorsCovered);
            const sectorsTotal = Math.max(1, toFinite(m.sectorsTotal) ?? toFinite(raw.sectorsTotal) ?? 16);
            const coveragePct = Math.min(
                100,
                Math.max(
                    0,
                    toFinite(m.coveragePct) ??
                        toFinite(raw.coveragePct) ??
                        (sectorsCovered !== undefined
                            ? Number(((sectorsCovered / sectorsTotal) * 100).toFixed(1))
                            : 0)
                )
            );
            const toeScore = Math.min(
                100,
                Math.max(0, toFinite(m.toeScore) ?? toFinite(rawGp?.toeScore) ?? 0)
            );
            const groundSlopeDeg = Math.min(
                90,
                Math.max(
                    0,
                    toFinite(m.groundSlopeDeg) ??
                        toFinite(rawGp?.slopeDeg) ??
                        toFinite(normalizedPreviewMesh?.groundPlane?.slopeDeg) ??
                        0
                )
            );
            const groundPlane = {
                a: toFinite(rawGp?.a) ?? toFinite(normalizedPreviewMesh?.groundPlane?.a) ?? 0,
                b: toFinite(rawGp?.b) ?? toFinite(normalizedPreviewMesh?.groundPlane?.b) ?? 0,
                d: toFinite(rawGp?.d) ?? toFinite(normalizedPreviewMesh?.groundPlane?.d) ?? 0,
                slopeDeg: groundSlopeDeg,
                toeScore,
                ...(toFinite(rawGp?.residualRmsM) !== undefined
                    ? { residualRmsM: toFinite(rawGp?.residualRmsM) }
                    : {}),
            };
            const rawGrade = typeof m.metrologyGrade === 'string' ? m.metrologyGrade : 'VALID_IN_SITU';
            const metrologyGrade =
                rawGrade === 'VALID_IN_SITU' ||
                rawGrade === 'LOW_CONFIDENCE_RECAPTURE' ||
                rawGrade === 'REJECTED'
                    ? rawGrade
                    : 'VALID_IN_SITU';

            const parsedMetrology = InSituMetrologySchema.safeParse({
                ...m,
                volumeM3,
                footprintAreaM2,
                heightMaxM,
                baseLengthM,
                baseWidthM,
                dimensionsM: {
                    a: Number(baseLengthM.toFixed(2)),
                    b: Number(baseWidthM.toFixed(2)),
                    h: Number(heightMaxM.toFixed(2)),
                },
                groundPlane,
                groundSlopeDeg,
                uncertaintyPct: Math.min(100, Math.max(0, toFinite(m.uncertaintyPct) ?? 15)),
                coveragePct,
                ...(sectorsCovered !== undefined ? { sectorsCovered: Math.round(sectorsCovered) } : {}),
                toeScore,
                ...(typeof (m.loopClosed ?? raw.loopClosed) === 'boolean'
                    ? { loopClosed: Boolean(m.loopClosed ?? raw.loopClosed) }
                    : {}),
                computedAt: toFinite(m.computedAt) ? Math.round(toFinite(m.computedAt)!) : Date.now(),
                metrologyGrade,
            });
            if (parsedMetrology.success) {
                normalizedMetrology = parsedMetrology.data;
            }
        }
    }

    return {
        ...(raw as unknown as SpatialScanNativeResult),
        ...(normalizedKeyframesV2.length > 0 ? { keyframesV2: normalizedKeyframesV2 } : {}),
        ...(normalizedWalkRingPoses ? { walkRingPoses: normalizedWalkRingPoses } : {}),
        inSituMetrology: normalizedMetrology,
        localPreviewMesh: normalizedPreviewMesh,
        ...(captureImuPitchDeg !== undefined ? { captureImuPitchDeg } : {}),
    };
}

/**
 * Carga blobs locales de keyframes preservando emparejamiento estricto 1:1 entre `photoBlobs`
 * y `keyframesV2` (si un `fetch` falla, ese índice también se descarta de `keyframesV2` y
 * `pairedKeyframes` para que jamás se asigne una pose `SE(3)` a la imagen equivocada).
 */
export async function loadPairedScanKeyframes(
    scan: SpatialScanNativeResult,
    options?: {
        convertFileSrc?: (path: string) => string;
        fetchFn?: typeof fetch;
    }
): Promise<{
    scan: SpatialScanNativeResult;
    photoBlobs: Blob[];
    pairedKeyframes: PairedSpatialKeyframe[];
}> {
    const convertSrc = options?.convertFileSrc ?? ((p: string) => Capacitor.convertFileSrc(p));
    const fetchImpl = options?.fetchFn ?? fetch;

    const hasV2 = Array.isArray(scan.keyframesV2) && scan.keyframesV2.length > 0;
    const hasLegacy = Array.isArray(scan.keyframes) && scan.keyframes.length > 0;

    const photoBlobs: Blob[] = [];
    const pairedKeyframes: PairedSpatialKeyframe[] = [];
    const survivingV2: SpatialScanKeyframeV2Native[] = [];
    const survivingLegacy: SpatialScanKeyframe[] = [];

    const loadBlobForPath = async (rawPath: unknown): Promise<Blob | null> => {
        const path = typeof rawPath === 'string' ? rawPath.trim() : '';
        if (!path) return null;
        try {
            const webSrc = convertSrc(path);
            const res = await fetchImpl(webSrc);
            if (!res.ok) return null;
            const rawBlob = await res.blob();
            if (!rawBlob || rawBlob.size <= 0) return null;
            if (rawBlob.type && rawBlob.type.startsWith('image/')) {
                return rawBlob;
            }
            const ab = await rawBlob.arrayBuffer();
            const inferredType = path.toLowerCase().endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg';
            return new Blob([ab], { type: inferredType });
        } catch {
            return null;
        }
    };

    if (hasV2) {
        const legacyByIdx = hasLegacy
            ? new Map(scan.keyframes!.map((k) => [k.index, k]))
            : null;
        for (let i = 0; i < scan.keyframesV2!.length; i++) {
            const kf = scan.keyframesV2![i];
            const blob = await loadBlobForPath(kf?.photoPath);
            if (!blob) continue;
            photoBlobs.push(blob);
            survivingV2.push(kf);
            pairedKeyframes.push({ blob, meta: kf });
            if (legacyByIdx) {
                const legacyMatch = legacyByIdx.get(kf.index) ?? scan.keyframes?.[i];
                if (legacyMatch) survivingLegacy.push(legacyMatch);
            }
        }
    } else if (hasLegacy) {
        for (const kf of scan.keyframes!) {
            const blob = await loadBlobForPath(kf?.photoPath);
            if (!blob) continue;
            photoBlobs.push(blob);
            survivingLegacy.push(kf);
            pairedKeyframes.push({ blob });
        }
    }

    const alignedScan: SpatialScanNativeResult = {
        ...scan,
        ...(hasV2 ? { keyframesV2: survivingV2 } : {}),
        ...(hasLegacy ? { keyframes: survivingLegacy } : {}),
    };

    return {
        scan: alignedScan,
        photoBlobs,
        pairedKeyframes,
    };
}

/**
 * Ejecuta el escáner espacial nativo Android ARCore VIO/Depth y convierte las rutas locales
 * `keyframes[].photoPath` a `Blob[]` reales emparejados 1:1 con `keyframesV2`.
 */
export async function startNativeSpatialScan(): Promise<{
    scan: SpatialScanNativeResult;
    photoBlobs: Blob[];
    pairedKeyframes: PairedSpatialKeyframe[];
}> {
    if (!Capacitor.isNativePlatform()) {
        return { scan: { cancelled: true }, photoBlobs: [], pairedKeyframes: [] };
    }

    let raw: SpatialScanNativeResult;
    try {
        raw = await MinreportSpatialScanner.startSpatialScan();
    } catch (err: unknown) {
        const errObj =
            err && typeof err === 'object'
                ? (err as { code?: unknown; message?: unknown })
                : null;
        const code = typeof errObj?.code === 'string' ? errObj.code.trim() : '';
        const msg =
            err instanceof Error
                ? err.message
                : typeof errObj?.message === 'string'
                  ? errObj.message
                  : String(err || '');
        const isExplicitCancel = /cancel/i.test(code) || (!code && /cancel/i.test(msg));
        if (isExplicitCancel) {
            return { scan: { cancelled: true }, photoBlobs: [], pairedKeyframes: [] };
        }
        const formattedMsg =
            code && msg && !msg.includes(code)
                ? `${code}: ${msg}`
                : msg || code || 'Error iniciando escaneo espacial.';
        const wrapped = new Error(formattedMsg) as Error & { code?: string };
        if (code) wrapped.code = code;
        throw wrapped;
    }

    const rawErrorCode = typeof raw?.errorCode === 'string' ? raw.errorCode.trim() : '';
    const rawErrorMessage = typeof raw?.errorMessage === 'string' ? raw.errorMessage.trim() : '';
    if (rawErrorCode || rawErrorMessage) {
        const formattedMsg =
            rawErrorCode && rawErrorMessage && !rawErrorMessage.includes(rawErrorCode)
                ? `${rawErrorCode}: ${rawErrorMessage}`
                : rawErrorMessage || rawErrorCode;
        const wrapped = new Error(formattedMsg) as Error & { code?: string };
        if (rawErrorCode) wrapped.code = rawErrorCode;
        throw wrapped;
    }

    if (!raw || raw.cancelled) {
        return { scan: { ...(raw || {}), cancelled: true }, photoBlobs: [], pairedKeyframes: [] };
    }

    const normalizedScan = normalizeNativeSpatialScan(raw);
    return loadPairedScanKeyframes(normalizedScan);
}

/**
 * Persiste la nube métrica espacial (`application/json`) en LocalCasFilesystemService
 * (`@capacitor/filesystem` en nativo / IndexedDB en web PWA).
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

    await localCasFilesystem.putBlob({
        sha256,
        blob,
        mimeType: 'application/json',
        profile: 'SPATIAL_SESSION_BUNDLE',
        scope: 'TENANT_PRIVATE',
        tenantId: resolvedTenant,
        filename: `spatial_${stored.scanId || Date.now()}.json`,
        extension: 'json',
        originalBytes: blob.size,
        optimizedBytes: blob.size,
    });

    return sha256;
}

/**
 * Recupera desde LocalCasFilesystemService una nube métrica espacial almacenada offline.
 */
export async function loadOfflineSpatialPayload(
    sha256: string
): Promise<SpatialOfflineStoredPayload | null> {
    if (!sha256) return null;
    const localRes = await localCasFilesystem.getBlob(sha256).catch(() => null);
    if (!localRes?.blob) return null;
    const text = await localRes.blob.text();
    const parsed = JSON.parse(text) as SpatialOfflineStoredPayload;
    return parsed && Array.isArray(parsed.pointsM) ? parsed : null;
}

/**
 * Construye, valida con Zod (`CaptureSessionPackageV2Schema`), persiste en disco/IDB local
 * y encola para sincronización resumible en 2 etapas (`CAPTURE_SESSION_UPLOAD`).
 */
export async function persistCaptureSessionOffline(params: {
    sessionId: string;
    tenantId: string;
    assetId: string;
    measurementId: string;
    capturedAt: number;
    scan: SpatialScanNativeResult;
    keyframeBlobs: Blob[];
    pairedKeyframes?: PairedSpatialKeyframe[];
    inSituMetrology: InSituMetrology;
    localPreviewMesh?: DemGridV1 | null;
    locale?: 'es' | 'en' | 'pt';
}): Promise<CaptureSessionPackageV2> {
    const {
        sessionId,
        tenantId,
        assetId,
        measurementId,
        capturedAt,
        scan,
        keyframeBlobs,
        pairedKeyframes,
        inSituMetrology,
        localPreviewMesh = null,
        locale = 'es',
    } = params;

    const resolvedTenant = tenantId.trim() || 'offline-local';
    const v2Meta = Array.isArray(scan.keyframesV2) ? scan.keyframesV2 : [];
    const resolvedPairs: PairedSpatialKeyframe[] =
        Array.isArray(pairedKeyframes) && pairedKeyframes.length > 0
            ? pairedKeyframes
            : keyframeBlobs.map((blob, idx) => ({
                  blob,
                  meta: v2Meta[idx],
              }));
    const keyframes: CaptureKeyframeV2[] = [];
    let totalOriginalBytes = 0;
    let totalOptimizedBytes = 0;

    for (let i = 0; i < resolvedPairs.length; i++) {
        const { blob: rawBlob, meta } = resolvedPairs[i];
        let digestedBlob = rawBlob;
        let mimeType = rawBlob.type || meta?.mimeType || 'image/webp';
        let extension = mimeType.includes('webp') ? 'webp' : 'jpg';
        let originalBytes = meta?.originalBytes ?? rawBlob.size;
        let optimizedBytes = rawBlob.size;
        let sha256 = '';

        try {
            const digested = await mediaDigestorClient.digestFile(rawBlob, 'IMAGE_FIELD_EVIDENCE');
            digestedBlob = digested.blob;
            mimeType = digested.mimeType || 'image/webp';
            extension = digested.extension || 'webp';
            originalBytes = Math.max(originalBytes, digested.originalBytes || rawBlob.size);
            optimizedBytes = digested.optimizedBytes || digested.blob.size;
            sha256 = digested.sha256;
        } catch {
            sha256 = await computeBlobSha256Hex(rawBlob);
        }

        const savingsPct =
            originalBytes > 0
                ? Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 1000) / 10)
                : 0;

        await localCasFilesystem.putBlob({
            sha256,
            blob: digestedBlob,
            mimeType,
            profile: 'IMAGE_FIELD_EVIDENCE',
            scope: 'TENANT_PRIVATE',
            tenantId: resolvedTenant,
            filename: `${sessionId}_kf_${i}.${extension}`,
            extension,
            originalBytes,
            optimizedBytes,
        });

        totalOriginalBytes += originalBytes;
        totalOptimizedBytes += optimizedBytes;

        keyframes.push({
            index: meta?.index ?? i,
            sha256,
            offlineCasRef: `offline-cas://${sha256}.${extension}`,
            mimeType,
            originalBytes,
            optimizedBytes,
            savingsPct,
            displayRotationDeg: meta?.displayRotationDeg ?? 0,
            poseSE3: meta?.poseSE3 ?? {
                r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                t: [0, 0, 0],
            },
            intrinsics: meta?.intrinsics
                ? {
                      fx: meta.intrinsics.fx,
                      fy: meta.intrinsics.fy,
                      cx: meta.intrinsics.cx,
                      cy: meta.intrinsics.cy,
                      width: meta.intrinsics.width ?? meta.intrinsics.widthPx ?? 1280,
                      height: meta.intrinsics.height ?? meta.intrinsics.heightPx ?? 960,
                  }
                : {
                      fx: 960,
                      fy: 960,
                      cx: 640,
                      cy: 480,
                      width: 1280,
                      height: 960,
                  },
            timestampNs: meta?.timestampNs ?? capturedAt * 1_000_000 + i * 250_000_000,
            azimuthDeg: meta?.azimuthDeg ?? meta?.angleDeg,
            pitchDeg: meta?.pitchDeg ?? meta?.imuPitchDeg,
            sharpnessScore: meta?.sharpnessScore ?? meta?.blurScore,
        });
    }

    let rawSpatialBundle: CaptureSessionPackageV2['rawSpatialBundle'] = null;
    if (
        (Array.isArray(scan.pointsM) && scan.pointsM.length > 0) ||
        (Array.isArray(scan.walkRingPoses) && scan.walkRingPoses.length > 0)
    ) {
        const bundlePayload = {
            pointsM: scan.pointsM || [],
            groundSamplesM: scan.groundSamplesM || [],
            walkRingPoses: scan.walkRingPoses || [],
            anchorCenter: scan.anchorCenter || null,
            roiRadiusM: scan.roiRadiusM,
            coveragePct: scan.coveragePct,
            sectorsCovered: scan.sectorsCovered,
            sectorsTotal: scan.sectorsTotal,
            loopClosed: scan.loopClosed,
        };
        const bundleJson = JSON.stringify(bundlePayload);
        const bundleBlob = new Blob([bundleJson], { type: 'application/json' });
        const bundleSha = await computeBlobSha256Hex(bundleBlob);
        await localCasFilesystem.putBlob({
            sha256: bundleSha,
            blob: bundleBlob,
            mimeType: 'application/json',
            profile: 'SPATIAL_SESSION_BUNDLE',
            scope: 'TENANT_PRIVATE',
            tenantId: resolvedTenant,
            filename: `${sessionId}_bundle.json`,
            extension: 'json',
            originalBytes: bundleBlob.size,
            optimizedBytes: bundleBlob.size,
        });
        totalOriginalBytes += bundleBlob.size;
        totalOptimizedBytes += bundleBlob.size;
        rawSpatialBundle = {
            sha256: bundleSha,
            offlineCasRef: `offline-cas://${bundleSha}.json`,
            originalBytes: bundleBlob.size,
            optimizedBytes: bundleBlob.size,
            savingsPct: 0,
        };
    }

    const totalSavingsPct =
        totalOriginalBytes > 0
            ? Math.max(0, Math.round((1 - totalOptimizedBytes / totalOriginalBytes) * 1000) / 10)
            : 0;

    const manifestBase = JSON.stringify({
        sessionId,
        assetId,
        measurementId,
        capturedAt,
        keyframes: keyframes.map((k) => k.sha256),
        bundle: rawSpatialBundle?.sha256 || null,
    });
    const manifestSha256 = await computeBlobSha256Hex(
        new Blob([manifestBase], { type: 'application/json' })
    );

    const validated = CaptureSessionPackageV2Schema.parse({
        sessionId,
        schemaVersion: '2.0',
        tenantId: resolvedTenant,
        assetId,
        measurementId,
        capturedAt,
        scannerEngineVersion: scan.scannerEngineVersion || '2.0-vio-mvs',
        orientationMode: scan.orientationMode || 'LANDSCAPE_4_3',
        depthMode: scan.depthMode || 'DISABLED',
        deviceModel: scan.deviceModel,
        lifecycle_status: 'CAPTURED_OFFLINE_VALID',
        metrology_grade: inSituMetrology.metrologyGrade,
        reconciliation_status: 'PENDING_CLOUD',
        keyframes,
        walkRingPoses: scan.walkRingPoses,
        rawSpatialBundle,
        inSituMetrology,
        localPreviewMesh,
        casIntegrity: {
            manifestSha256,
            totalOriginalBytes,
            totalOptimizedBytes,
            totalSavingsPct,
        },
        reconciliation: {
            offlineInSituM3: inSituMetrology.volumeM3,
        },
        locale,
    });

    await offlineStorage.saveCaptureSession(validated);
    await syncQueueEngine.enqueueTask('CAPTURE_SESSION_UPLOAD', {
        sessionId: validated.sessionId,
        assetId: validated.assetId,
        measurementId: validated.measurementId,
        tenantId: validated.tenantId,
        locale,
    });

    return validated;
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
