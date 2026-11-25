/**
 * photogrammetry3d.service — Orquestador Soberano de Reconstrucción 3D (.glb) para MINREPORT · ACOPIOS
 *
 * Política Cero 3D Sintético:
 *  - Invoca `POST /api/geolapp/stockpiles/:stockpileId/reconstruct-3d` en `southamerica-west1`.
 *  - Soporta esquema unificado `boundingBoxM` (`{ widthX, heightY, depthZ }`) y legacy (`{ lengthM, heightM, widthM }`).
 *  - PROHIBIDO fabricar conos/pirámides sintéticos locales cuando falla la reconstrucción real.
 */

import { auth } from '../../../../config/firebase';
import {
    normalizeUnifiedBoundingBox,
    type UnifiedBoundingBoxM,
} from '../../../../contracts/acopios.contracts';
import { getApiUrl } from '../../../../utils/network';
import type { GeolappGeometryType } from '../types/GeolappTypes';
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
    | 'MAST3R_GPU_SOUTH_AMERICA_WEST1'
    | 'ARCORE_VIO_DEPTH_SOUTH_AMERICA_WEST1'
    | 'VIO_MVS_SOUTH_AMERICA_WEST1'
    | string;

export interface Reconstruct3DResult {
    meshUrl: string;
    sha256: string;
    tinVolumeM3: number;
    surfaceAreaM2: number;
    vertexCount: number;
    triangleCount: number;
    boundingBoxM: UnifiedBoundingBoxM;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    source: Reconstruct3DSource;
}

const RECONSTRUCT_TIMEOUT_MS = 28000;

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

export function parseBoundingBox(raw: unknown): UnifiedBoundingBoxM {
    return normalizeUnifiedBoundingBox(raw);
}

export function parseServerReconstructResponse(raw: unknown): Reconstruct3DResult | null {
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
        surfaceAreaM2: asFiniteNumber(payload.surfaceAreaM2 ?? payload.mesh_surface_area_m2 ?? payload.surface_area_m2, 0),
        vertexCount: asFiniteNumber(payload.vertexCount ?? payload.mesh_vertex_count ?? payload.vertex_count, 0),
        triangleCount: asFiniteNumber(payload.triangleCount ?? payload.mesh_triangle_count ?? payload.triangle_count, 0),
        boundingBoxM: parseBoundingBox(
            payload.boundingBoxM ?? payload.mesh_bounding_box_m ?? payload.bounding_box_m
        ),
        originalBytes: asFiniteNumber(payload.originalBytes ?? payload.mesh_original_bytes, 0),
        optimizedBytes: asFiniteNumber(payload.optimizedBytes ?? payload.mesh_optimized_bytes, 0),
        savingsPct: asFiniteNumber(payload.savingsPct ?? payload.mesh_savings_pct, 0),
        source:
            typeof sourceRaw === 'string' && sourceRaw.trim()
                ? sourceRaw.trim()
                : 'VIO_MVS_SOUTH_AMERICA_WEST1',
    };
}

export class Photogrammetry3DService {
    async reconstructStockpile3D(request: Reconstruct3DRequest): Promise<Reconstruct3DResult> {
        const stockpileId = request.stockpileId?.trim();
        if (!stockpileId) {
            throw new Error('stockpileId es obligatorio para reconstrucción 3D.');
        }

        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
        const currentUser = auth?.currentUser ?? null;
        if (!isOnline || !currentUser) {
            throw new Error(
                'RECONSTRUCT_3D_OFFLINE: La reconstrucción 3D GPU requiere conexión activa y sesión autenticada en southamerica-west1.'
            );
        }

        const cleanDimensions = sanitizeFiniteDimensions(request.dimensions);
        const cleanSamples = Array.isArray(request.profileSamples)
            ? request.profileSamples.filter((s) => typeof s === 'number' && Number.isFinite(s))
            : undefined;
        const activeAccountId = resolveActiveAccountId(request.tenantId);

        if (activeAccountId && !storageService.getTenantId()) {
            storageService.setTenantId(activeAccountId);
        }

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

            const json = await response.json().catch(() => null);
            if (!response.ok) {
                const detail =
                    json && typeof json === 'object' && 'error' in json
                        ? String((json as Record<string, unknown>).error)
                        : `HTTP ${response.status}`;
                throw new Error(`RECONSTRUCT_3D_UNAVAILABLE: ${detail}`);
            }

            const parsed = parseServerReconstructResponse(json);
            if (!parsed) {
                throw new Error('RECONSTRUCT_3D_INVALID_RESPONSE: Respuesta sin malla .glb válida.');
            }
            return parsed;
        } finally {
            globalThis.clearTimeout(timeoutId);
        }
    }
}

export const photogrammetry3dService = new Photogrammetry3DService();
