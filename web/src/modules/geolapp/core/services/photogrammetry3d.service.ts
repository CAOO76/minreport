/**
 * photogrammetry3d.service — Orquestador de Reconstrucción 3D (.glb) para GEOLAPP®
 *
 * Estrategia Híbrida Offline-First (Capa 2 / Capa 5 southamerica-west1):
 *  1. Online con sesión Firebase Auth activa: invoca
 *     `POST /api/geolapp/stockpiles/:stockpileId/reconstruct-3d` (timeout 12000 ms).
 *  2. Offline o ante falla/no-200 del endpoint: construye el binario `.glb` glTF 2.0
 *     deterministamente en cliente mediante `buildStockpileGlbMesh(...)` y lo persiste
 *     vía `storageService.uploadStockpileMesh(...)` preservando trazabilidad CAS completa.
 */

import { auth } from '../../../../config/firebase';
import { getApiUrl } from '../../../../utils/network';
import type { GeolappGeometryType } from '../types/GeolappTypes';
import {
    buildStockpileGlbMesh,
    type GlbBoundingBoxM,
} from '../utils/glbMeshBuilder';
import { storageService } from './StorageService';

export interface Reconstruct3DRequest {
    stockpileId: string;
    measurementId?: string;
    geometryType: GeolappGeometryType | string;
    dimensions: Record<string, number | undefined>;
    photoUrls?: string[];
    profileSamples?: number[];
    tenantId?: string;
}

export type Reconstruct3DSource =
    | 'GPU_MAST3R_CLOUD_RUN'
    | 'PARAMETRIC_TIN_SOUTH_AMERICA_WEST1'
    | 'LOCAL_DETERMINISTIC_TIN_GLB'
    | string;

export interface Reconstruct3DResult {
    meshUrl: string;
    sha256: string;
    tinVolumeM3: number;
    surfaceAreaM2: number;
    vertexCount: number;
    triangleCount: number;
    boundingBoxM: GlbBoundingBoxM;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    source: Reconstruct3DSource;
}

const RECONSTRUCT_TIMEOUT_MS = 12000;

function sanitizeFiniteDimensions(
    dimensions: Record<string, number | undefined>
): Record<string, number> {
    const clean: Record<string, number> = {};
    for (const [key, value] of Object.entries(dimensions || {})) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            clean[key] = value;
        }
    }
    return clean;
}

function resolveActiveAccountId(explicitTenantId?: string): string {
    if (explicitTenantId && explicitTenantId.trim()) {
        return explicitTenantId.trim();
    }
    const serviceTenant = storageService.getTenantId();
    if (serviceTenant && serviceTenant.trim()) {
        return serviceTenant.trim();
    }
    if (typeof window !== 'undefined') {
        return window.localStorage.getItem('minreport_active_account_id')?.trim() || '';
    }
    return '';
}

function asFiniteNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseBoundingBox(raw: unknown): GlbBoundingBoxM {
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        return {
            widthX: asFiniteNumber(obj.widthX, 0),
            heightY: asFiniteNumber(obj.heightY, 0),
            depthZ: asFiniteNumber(obj.depthZ, 0),
        };
    }
    return { widthX: 0, heightY: 0, depthZ: 0 };
}

function parseServerReconstructResponse(raw: unknown): Reconstruct3DResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const root = raw as Record<string, unknown>;
    const payload =
        root.data && typeof root.data === 'object'
            ? (root.data as Record<string, unknown>)
            : root;

    const meshUrlRaw = payload.meshUrl ?? payload.mesh_url;
    if (typeof meshUrlRaw !== 'string' || !meshUrlRaw.trim()) {
        return null;
    }

    const sha256Raw = payload.sha256 ?? payload.mesh_sha256;
    const sourceRaw = payload.source ?? payload.mesh_source;

    return {
        meshUrl: meshUrlRaw.trim(),
        sha256: typeof sha256Raw === 'string' ? sha256Raw.trim() : '',
        tinVolumeM3: asFiniteNumber(payload.tinVolumeM3 ?? payload.tin_volume_m3, 0),
        surfaceAreaM2: asFiniteNumber(payload.surfaceAreaM2 ?? payload.surface_area_m2, 0),
        vertexCount: asFiniteNumber(payload.vertexCount ?? payload.vertex_count, 0),
        triangleCount: asFiniteNumber(payload.triangleCount ?? payload.triangle_count, 0),
        boundingBoxM: parseBoundingBox(payload.boundingBoxM ?? payload.bounding_box_m),
        originalBytes: asFiniteNumber(payload.originalBytes ?? payload.mesh_original_bytes, 0),
        optimizedBytes: asFiniteNumber(payload.optimizedBytes ?? payload.mesh_optimized_bytes, 0),
        savingsPct: asFiniteNumber(payload.savingsPct ?? payload.mesh_savings_pct, 0),
        source:
            typeof sourceRaw === 'string' && sourceRaw.trim()
                ? sourceRaw.trim()
                : 'PARAMETRIC_TIN_SOUTH_AMERICA_WEST1',
    };
}

export class Photogrammetry3DService {
    async reconstructStockpile3D(request: Reconstruct3DRequest): Promise<Reconstruct3DResult> {
        const stockpileId = request.stockpileId?.trim();
        if (!stockpileId) {
            throw new Error('stockpileId es obligatorio para reconstrucción 3D.');
        }

        const cleanDimensions = sanitizeFiniteDimensions(request.dimensions);
        const cleanSamples = Array.isArray(request.profileSamples)
            ? request.profileSamples.filter((s) => typeof s === 'number' && Number.isFinite(s))
            : undefined;
        const activeAccountId = resolveActiveAccountId(request.tenantId);

        if (activeAccountId && !storageService.getTenantId()) {
            storageService.setTenantId(activeAccountId);
        }

        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
        const currentUser = auth?.currentUser ?? null;

        if (isOnline && currentUser) {
            const controller = new AbortController();
            const timeoutId = globalThis.setTimeout(
                () => controller.abort(),
                RECONSTRUCT_TIMEOUT_MS
            );

            try {
                const token = await currentUser.getIdToken();
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                };
                if (activeAccountId) {
                    headers['X-Active-Account-Id'] = activeAccountId;
                }

                const endpoint = getApiUrl(
                    `/api/geolapp/stockpiles/${encodeURIComponent(stockpileId)}/reconstruct-3d`
                );
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    signal: controller.signal,
                    body: JSON.stringify({
                        measurementId: request.measurementId,
                        geometryType: request.geometryType,
                        dimensions: cleanDimensions,
                        photoUrls: request.photoUrls,
                        profileSamples: cleanSamples,
                    }),
                });

                if (response.status === 200) {
                    const json = await response.json();
                    const parsed = parseServerReconstructResponse(json);
                    if (parsed) {
                        return parsed;
                    }
                }
            } catch (err) {
                console.warn(
                    '[Photogrammetry3DService] Reconstrucción remota no disponible, ejecutando malla TIN .glb local:',
                    err
                );
            } finally {
                globalThis.clearTimeout(timeoutId);
            }
        }

        const localMesh = buildStockpileGlbMesh({
            geometryType: request.geometryType,
            dimensions: cleanDimensions,
            profileSamples: cleanSamples,
            name: `Stockpile_${stockpileId}`,
        });

        if (!localMesh) {
            throw new Error(
                'No fue posible generar la malla 3D .glb: dimensiones geométricas faltantes o <= 0.'
            );
        }

        const upload = await storageService.uploadStockpileMesh(
            localMesh.glbBuffer,
            stockpileId,
            request.measurementId,
            localMesh.rawUnindexedBytes
        );

        const originalBytes = upload.originalBytes ?? localMesh.rawUnindexedBytes;
        const optimizedBytes = upload.optimizedBytes ?? localMesh.optimizedGlbBytes;
        const savingsPct =
            typeof upload.savingsPct === 'number'
                ? upload.savingsPct
                : originalBytes > 0
                  ? Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 1000) / 10)
                  : 0;

        return {
            meshUrl: upload.url,
            sha256: upload.sha256 || '',
            tinVolumeM3: localMesh.tinVolumeM3,
            surfaceAreaM2: localMesh.surfaceAreaM2,
            vertexCount: localMesh.vertexCount,
            triangleCount: localMesh.triangleCount,
            boundingBoxM: localMesh.boundingBoxM,
            originalBytes,
            optimizedBytes,
            savingsPct,
            source: 'LOCAL_DETERMINISTIC_TIN_GLB',
        };
    }
}

export const photogrammetry3dService = new Photogrammetry3DService();
