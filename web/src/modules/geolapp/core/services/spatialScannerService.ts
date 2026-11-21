/**
 * Servicio Espacial Nativo Solo-Camara ARCore VIO + Depth API y Analitica 3D CAS.
 * Conecta el plugin Android `MinreportSpatialScanner` con `/api/geolapp/*spatial-analyze`
 * en `southamerica-west1` y la persistencia CAS offline en IndexedDB (`OfflineStorage`).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { mediaDigestorClient } from '../../../../core/media/MediaDigestorClient';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { offlineStorage } from '../../../../core/offline/OfflineStorage';
import type { CopperMineralDomain, GeolappGeometryType } from '../types/GeolappTypes';

export type SpatialDepthMode = 'RAW_DEPTH_ONLY' | 'AUTOMATIC' | 'VIO_POINTCLOUD';

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
    keyframeCount?: number;
    loopClosed?: boolean;
    anchorCenter?: { x: number; y: number; z: number };
    pointsM?: Array<[number, number, number]>;
    groundSamplesM?: Array<[number, number, number]>;
    keyframes?: SpatialScanKeyframe[];
    rejectedBlurCount?: number;
}

export interface SpatialOfflineStoredPayload {
    scanId?: string;
    deviceModel?: string;
    depthMode: SpatialDepthMode;
    coveragePct: number;
    sectorsCovered: number;
    keyframeCount: number;
    loopClosed: boolean;
    anchorCenter?: { x: number; y: number; z: number };
    pointsM: Array<[number, number, number]>;
    groundSamplesM?: Array<[number, number, number]>;
    rejectedBlurCount?: number;
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
    wallConfinement?: 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';
    copperDomain: CopperMineralDomain | null;
    granulometry: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
    suggestedDensityTm3: number | null;
    slopeAngleLeftDeg?: number | null;
    slopeAngleRightDeg?: number | null;
    slopeAngleAvgDeg: number | null;
    slopeWarning: string | null;
    dimensionsM: Record<string, number> | null;
    meshUrl: string | null;
    meshSha256: string | null;
    meshSource: string | null;
    reasoning: string;
}

interface MinreportSpatialScannerNative {
    startSpatialScan(): Promise<SpatialScanNativeResult>;
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

function buildStoredPayload(scan: SpatialScanNativeResult): SpatialOfflineStoredPayload {
    const pointsM = Array.isArray(scan.pointsM) ? scan.pointsM : [];
    const groundSamplesM = Array.isArray(scan.groundSamplesM) ? scan.groundSamplesM : undefined;
    return {
        scanId: scan.scanId,
        deviceModel: scan.deviceModel,
        depthMode: scan.depthMode || 'VIO_POINTCLOUD',
        coveragePct: typeof scan.coveragePct === 'number' && Number.isFinite(scan.coveragePct) ? scan.coveragePct : 0,
        sectorsCovered:
            typeof scan.sectorsCovered === 'number' && Number.isFinite(scan.sectorsCovered)
                ? scan.sectorsCovered
                : 0,
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
    };
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
    const storedBody = buildStoredPayload(request.scan);

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

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(
            (data as { error?: string })?.error || `HTTP ${res.status} en análisis espacial 3D`
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }

    return data as SpatialAnalyzeResult;
}
