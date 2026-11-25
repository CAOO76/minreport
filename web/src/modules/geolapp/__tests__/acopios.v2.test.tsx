import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import {
    CaptureSessionPackageV2Schema,
    DemGridV1Schema,
    normalizeUnifiedBoundingBox,
    type CaptureSessionPackageV2,
    type DemGridV1,
} from '../../../contracts/acopios.contracts';
import { buildThreeGeometryFromDemGridV1 } from '../core/utils/demGridGeometry';
import {
    parseBoundingBox,
    parseServerReconstructResponse,
    photogrammetry3dService,
} from '../core/services/photogrammetry3d.service';
import { LocalCasFilesystemService } from '../../../core/offline/LocalCasFilesystemService';
import { offlineStorage, type OfflineCasBlobRecord } from '../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import * as StorageServiceMod from '../core/services/StorageService';
import * as CoreAuthFetchMod from '../../../core/network/coreAuthFetch';
import { StockpileTwin3D } from '../components/StockpileTwin3D';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback || _key,
        i18n: { language: 'es', resolvedLanguage: 'es' },
    }),
}));

const VALID_SHA_A = 'a'.repeat(64);
const VALID_SHA_B = 'b'.repeat(64);
const VALID_SHA_C = 'c'.repeat(64);

function makeSampleDemGrid(): DemGridV1 {
    // Bloque prismático 4x4 (3x3 quads de 1m x 1m): interior 2x2 a altura 2.0m
    // En grilla 4x4: ix=1,2 y iz=1,2 tienen h=2.0m, borde en 0 -> volumen tetraédrico exacto
    const nx = 5;
    const nz = 5;
    const heightsM = new Array<number>(nx * nz).fill(0);
    const confidenceMask = new Array<number>(nx * nz).fill(0);
    for (let iz = 1; iz <= 3; iz++) {
        for (let ix = 1; ix <= 3; ix++) {
            const idx = iz * nx + ix;
            heightsM[idx] = ix === 2 && iz === 2 ? 2.0 : 1.0;
            confidenceMask[idx] = ix === 2 && iz === 2 ? 1 : 2;
        }
    }
    return {
        format: 'dem_grid_v1',
        nx,
        nz,
        cellSizeM: 1.0,
        originX: 0,
        originZ: 0,
        heightsM,
        confidenceMask,
        groundPlane: { a: 0, b: 0, d: 0, slopeDeg: 0 },
    };
}

function makeSampleSession(overrides: Partial<CaptureSessionPackageV2> = {}): CaptureSessionPackageV2 {
    return CaptureSessionPackageV2Schema.parse({
        sessionId: 'sess_test_v2_001',
        schemaVersion: '2.0',
        tenantId: 'tenant-atacama-01',
        assetId: 'asset_acopio_01',
        measurementId: 'meas_acopio_01',
        capturedAt: Date.now(),
        scannerEngineVersion: '2.0-vio-mvs',
        orientationMode: 'LANDSCAPE_4_3',
        depthMode: 'DISABLED',
        lifecycle_status: 'CAPTURED_OFFLINE_VALID',
        metrology_grade: 'VALID_IN_SITU',
        reconciliation_status: 'PENDING_CLOUD',
        keyframes: [
            {
                index: 0,
                sha256: VALID_SHA_A,
                offlineCasRef: `offline-cas://${VALID_SHA_A}.webp`,
                mimeType: 'image/webp',
                originalBytes: 420_000,
                optimizedBytes: 68_000,
                savingsPct: 83.8,
                displayRotationDeg: 0,
                poseSE3: { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 1.5, 4.0] },
                intrinsics: { fx: 960, fy: 960, cx: 640, cy: 480, width: 1280, height: 960 },
                timestampNs: 1_000_000_000,
                azimuthDeg: 0,
                sharpnessScore: 142.5,
            },
        ],
        walkRingPoses: [
            [0, 1.5, 4.0],
            [4.0, 1.5, 0],
            [0, 1.5, -4.0],
            [-4.0, 1.5, 0],
        ],
        rawSpatialBundle: {
            sha256: VALID_SHA_B,
            offlineCasRef: `offline-cas://${VALID_SHA_B}.json`,
            originalBytes: 120_000,
            optimizedBytes: 120_000,
            savingsPct: 0,
        },
        inSituMetrology: {
            volumeM3: 42.5,
            footprintAreaM2: 38.2,
            heightMaxM: 2.8,
            baseLengthM: 7.4,
            baseWidthM: 6.5,
            groundPlane: { a: 0.01, b: -0.01, d: 0, slopeDeg: 0.8, toeScore: 88 },
            slopeAngleAvgDeg: 35.4,
            uncertaintyPct: 5.2,
            coveragePct: 93.8,
            toeScore: 88,
            zeroCellsInside: 0,
            metrologyGrade: 'VALID_IN_SITU',
        },
        localPreviewMesh: makeSampleDemGrid(),
        casIntegrity: {
            manifestSha256: VALID_SHA_C,
            totalOriginalBytes: 540_000,
            totalOptimizedBytes: 188_000,
            totalSavingsPct: 65.2,
        },
        reconciliation: {
            offlineInSituM3: 42.5,
        },
        ...overrides,
    });
}

describe('Acopios V2 Contracts & Unified BoundingBox', () => {
    it('valida CaptureSessionPackageV2 con los 3 ejes ortogonales y rechaza heightsM inconsistente', () => {
        const session = makeSampleSession();
        expect(session.lifecycle_status).toBe('CAPTURED_OFFLINE_VALID');
        expect(session.metrology_grade).toBe('VALID_IN_SITU');
        expect(session.reconciliation_status).toBe('PENDING_CLOUD');
        expect(session.inSituMetrology.volumeM3).toBe(42.5);

        const badDem = DemGridV1Schema.safeParse({
            format: 'dem_grid_v1',
            nx: 4,
            nz: 4,
            cellSizeM: 0.5,
            heightsM: [0, 1, 2],
        });
        expect(badDem.success).toBe(false);
    });

    it('normaliza boundingBoxM tanto en esquema unificado como legacy servidor', () => {
        expect(normalizeUnifiedBoundingBox({ widthX: 6.4, heightY: 2.3, depthZ: 5.8 })).toEqual({
            widthX: 6.4,
            heightY: 2.3,
            depthZ: 5.8,
        });
        expect(parseBoundingBox({ lengthM: 7.1, heightM: 2.9, widthM: 6.2 })).toEqual({
            widthX: 7.1,
            heightY: 2.9,
            depthZ: 6.2,
        });

        const parsed = parseServerReconstructResponse({
            meshUrl: `/api/media/blob/tenant/t1/${VALID_SHA_A}.glb`,
            sha256: VALID_SHA_A,
            tinVolumeM3: 44.1,
            boundingBoxM: { lengthM: 8.0, heightM: 3.1, widthM: 7.5 },
            source: 'MAST3R_GPU_SOUTH_AMERICA_WEST1',
        });
        expect(parsed?.boundingBoxM).toEqual({ widthX: 8.0, heightY: 3.1, depthZ: 7.5 });
    });

    it('photogrammetry3dService NO fabrica cono sintético cuando está offline', async () => {
        const origOnLine = navigator.onLine;
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        try {
            await expect(
                photogrammetry3dService.reconstructStockpile3D({
                    stockpileId: 'asset_1',
                    geometryType: 'CONO_ELIPTICO',
                    dimensions: { a: 6, b: 6, h: 2.5 },
                })
            ).rejects.toThrow(/RECONSTRUCT_3D_OFFLINE/);
        } finally {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: origOnLine });
        }
    });
});

describe('dem_grid_v1 BufferGeometry (Nivel 1 Offline)', () => {
    it('construye malla cerrada en y=0, faldones CCW hacia afuera y COLOR_0 ISA-101', () => {
        // Prisma plano 3x3 con h=2.0 en toda la grilla -> volumen exacto 2m * 2m * 2m = 8.0 m³
        const boxDem: DemGridV1 = {
            format: 'dem_grid_v1',
            nx: 3,
            nz: 3,
            cellSizeM: 1.0,
            originX: 0,
            originZ: 0,
            heightsM: new Array(9).fill(2.0),
            confidenceMask: [2, 2, 2, 2, 1, 2, 2, 2, 2],
        };

        const built = buildThreeGeometryFromDemGridV1(boxDem);
        expect(built).not.toBeNull();
        expect(built!.boundingBoxM).toEqual({ widthX: 2, heightY: 2, depthZ: 2 });
        expect(built!.tinVolumeM3).toBeCloseTo(8.0, 2);
        expect(built!.geometry.getAttribute('color')).toBeDefined();
        expect(built!.geometry.getAttribute('normal')).toBeDefined();

        // Verificar que la base está estrictamente asentada en y = 0
        const bb = built!.geometry.boundingBox!;
        expect(bb.min.y).toBe(0);
        expect(bb.max.y).toBe(2);

        // Verificar que las normales de los vértices del faldón apuntan hacia afuera (dot(posXZ, normXZ) > 0)
        const pos = built!.geometry.getAttribute('position');
        const norm = built!.geometry.getAttribute('normal');
        let skirtChecked = 0;
        for (let i = 0; i < pos.count; i++) {
            const ny = norm.getY(i);
            if (Math.abs(ny) < 0.05) {
                const dotXZ = pos.getX(i) * norm.getX(i) + pos.getZ(i) * norm.getZ(i);
                expect(dotXZ).toBeGreaterThan(0);
                skirtChecked++;
            }
        }
        expect(skirtChecked).toBeGreaterThan(0);
        built!.geometry.dispose();
    });
});

describe('StockpileTwin3D — Cero 3D Sintético + Nivel 1 dem_grid_v1', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('muestra estado honesto SIN MODELO 3D + motivo + botón refresh cuando falla CAS (cero cono sintético)', async () => {
        vi.spyOn(StorageServiceMod, 'resolveStockpileMeshBinary').mockResolvedValue({
            arrayBuffer: null,
            sourceLabel: 'CAS_HTTP_404',
        });

        render(
            <StockpileTwin3D
                compact
                meshUrl={`/api/media/blob/tenant/t1/${VALID_SHA_A}.glb`}
                meshSource="ARCORE_VIO_DEPTH_SOUTH_AMERICA_WEST1"
                tinVolumeM3={12.4}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('SIN MODELO 3D')).toBeInTheDocument();
        });
        expect(screen.getByText('CAS_HTTP_404')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'REINTENTAR' })).toBeInTheDocument();
        // No debe aparecer ninguna etiqueta falsificada de malla cargada
        expect(screen.queryByText(/TRI/)).not.toBeInTheDocument();
    });

    it('renderiza Nivel 1 Offline desde localPreviewMesh (dem_grid_v1) con franja hairline IN-SITU', async () => {
        const dem = makeSampleDemGrid();
        // En jsdom no hay WebGL real; comprobamos que intenta montar DEM_V1 y muestra franja hairline IN-SITU
        render(
            <StockpileTwin3D
                compact
                meshUrl={null}
                localPreviewMesh={dem}
                lifecycleStatus="CAPTURED_OFFLINE_VALID"
                tinVolumeM3={42.5}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('IN-SITU')).toBeInTheDocument();
        });
        expect(screen.getByText(/42\.50 m³/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CAPA CONFIANZA ISA-101' })).toBeInTheDocument();
    });
});

describe('LocalCasFilesystemService — Retención Anti-Pérdida', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('guarda, recupera en fallback Web PWA y nunca purga blobs anclados a sesiones pendientes', async () => {
        const casMap = new Map<string, OfflineCasBlobRecord>();
        vi.spyOn(offlineStorage, 'putCasBlob').mockImplementation(async (rec) => {
            casMap.set(rec.sha256, rec);
        });
        vi.spyOn(offlineStorage, 'getCasBlob').mockImplementation(async (sha) => {
            return casMap.get(sha) ?? null;
        });
        vi.spyOn(offlineStorage, 'getAllCasBlobs').mockImplementation(async () => {
            return Array.from(casMap.values());
        });
        vi.spyOn(offlineStorage, 'deleteCasBlob').mockImplementation(async (sha) => {
            casMap.delete(sha);
        });
        vi.spyOn(offlineStorage, 'getAllSyncTasks').mockResolvedValue([]);
        vi.spyOn(offlineStorage, 'getPendingCaptureSessions').mockResolvedValue([
            { ...makeSampleSession(), updatedAt: Date.now() },
        ]);

        const svc = new LocalCasFilesystemService();
        const pinnedBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
        const unpinnedBlob = new Blob([new Uint8Array([9, 8, 7, 6, 5, 4])], {
            type: 'model/gltf-binary',
        });

        await svc.putBlob({
            sha256: VALID_SHA_A,
            blob: pinnedBlob,
            mimeType: 'image/webp',
            profile: 'IMAGE_FIELD_EVIDENCE',
            tenantId: 'tenant-atacama-01',
        });
        await svc.putBlob({
            sha256: 'd'.repeat(64),
            blob: unpinnedBlob,
            mimeType: 'model/gltf-binary',
            profile: 'MESH_3D_GLB',
            tenantId: 'tenant-atacama-01',
        });

        const readBack = await svc.getBlob(VALID_SHA_A);
        expect(readBack).not.toBeNull();
        expect(readBack!.record.storageBackend).toBe('INDEXED_DB');

        // Forzar cuota mínima de 1 byte: debe purgar solo el no-anclado ('d'...) y conservar VALID_SHA_A
        const deleted = await svc.pruneUnpinnedBlobs(1);
        expect(deleted).toBe(1);
        expect(casMap.has(VALID_SHA_A)).toBe(true);
        expect(casMap.has('d'.repeat(64))).toBe(false);
    });
});

describe('SyncQueueEngine — HTTP 422 -> REJECTED_METROLOGY + CAPTURE_SESSION_UPLOAD', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('trata HTTP 422 en CAPTURE_SESSION_UPLOAD como NonRetryableSyncError (1 intento -> DEAD_LETTER + REJECTED_METROLOGY)', async () => {
        const session = makeSampleSession({
            keyframes: [
                {
                    index: 0,
                    sha256: VALID_SHA_A,
                    remoteCasUrl: `/api/media/blob/tenant/tenant-atacama-01/${VALID_SHA_A}.webp`,
                    mimeType: 'image/webp',
                    originalBytes: 420_000,
                    optimizedBytes: 68_000,
                    savingsPct: 83.8,
                    displayRotationDeg: 0,
                    poseSE3: { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 1.5, 4.0] },
                    intrinsics: { fx: 960, fy: 960, cx: 640, cy: 480, width: 1280, height: 960 },
                    timestampNs: 1_000_000_000,
                },
            ],
            rawSpatialBundle: null,
        });

        let savedSession: any = { ...session, updatedAt: Date.now() };
        let savedMeas: any = {
            id: session.measurementId,
            assetId: session.assetId,
            tenantId: session.tenantId,
            payload: { id: session.measurementId, volumen_m3: 42.5 },
            timestamp: session.capturedAt,
            synced: false,
        };
        const tasks: any[] = [
            {
                id: 'task_422_test',
                type: 'CAPTURE_SESSION_UPLOAD',
                payload: {
                    sessionId: session.sessionId,
                    assetId: session.assetId,
                    measurementId: session.measurementId,
                    tenantId: session.tenantId,
                },
                timestamp: new Date().toISOString(),
                attempts: 0,
                status: 'PENDING',
            },
        ];

        vi.spyOn(offlineStorage, 'getCaptureSession').mockImplementation(async () => savedSession);
        vi.spyOn(offlineStorage, 'saveCaptureSession').mockImplementation(async (s) => {
            savedSession = { ...s, updatedAt: Date.now() };
        });
        vi.spyOn(offlineStorage, 'getStockpileMeasurement').mockImplementation(async () => savedMeas);
        vi.spyOn(offlineStorage, 'saveStockpileMeasurement').mockImplementation(async (m) => {
            savedMeas = m;
        });
        vi.spyOn(offlineStorage, 'getAllSyncTasks').mockImplementation(async () => [...tasks]);
        vi.spyOn(offlineStorage, 'putSyncTask').mockImplementation(async (t) => {
            const idx = tasks.findIndex((x) => x.id === t.id);
            if (idx >= 0) tasks[idx] = t;
            else tasks.push(t);
        });
        vi.spyOn(offlineStorage, 'deleteSyncTask').mockImplementation(async (id) => {
            const idx = tasks.findIndex((x) => x.id === id);
            if (idx >= 0) tasks.splice(idx, 1);
        });

        vi.spyOn(CoreAuthFetchMod, 'coreAuthFetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    error: 'INSUFFICIENT_COVERAGE',
                    rejectionCode: 'INSUFFICIENT_COVERAGE',
                    message: 'Cobertura menor al 50% en validación cloud',
                }),
                { status: 422, headers: { 'Content-Type': 'application/json' } }
            )
        );

        // Mock health probe fetch para evitar llamada de red real en jsdom
        const origFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        try {
            await syncQueueEngine.drainQueue();
        } finally {
            globalThis.fetch = origFetch;
        }

        expect(tasks[0].status).toBe('DEAD_LETTER');
        expect(tasks[0].httpStatus).toBe(422);
        expect(tasks[0].attempts).toBe(1);
        expect(savedSession.lifecycle_status).toBe('REJECTED_METROLOGY');
        expect(savedSession.metrology_grade).toBe('REJECTED');
        expect(savedMeas.payload.lifecycle_status).toBe('REJECTED_METROLOGY');
        expect(savedMeas.payload.rejection_code).toBe('INSUFFICIENT_COVERAGE');
    });
});
