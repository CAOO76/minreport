import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import backendIndexSource from '../../../../../src/index.ts?raw';
import backendMediaRoutesSource from '../../../../../src/api/media.routes.ts?raw';
import {
    CaptureSessionPackageV2Schema as WebCaptureSessionPackageV2Schema,
    type CaptureSessionPackageV2,
} from '../../../contracts/acopios.contracts';
import {
    CAPTURE_SESSION_CAS_UPLOAD_CONCURRENCY,
    syncQueueEngine,
} from '../../../core/offline/SyncQueueEngine';
import { localCasFilesystem } from '../../../core/offline/LocalCasFilesystemService';
import { offlineStorage } from '../../../core/offline/OfflineStorage';
import * as CoreAuthFetchMod from '../../../core/network/coreAuthFetch';
import { applyStockpileVisualMaterialState } from '../components/StockpileTwin3D';
import { resolveMeasurementHardwareTelemetry } from '../components/MobileScanner';
import {
    CasPreflightBatchRequestSchema,
} from '../../../../../src/contracts/media.contracts';
import {
    CaptureSessionPackageV2Schema as BackendCaptureSessionPackageV2Schema,
} from '../../../../../src/contracts/acopios.contracts';

function makeHexHash(index: number): string {
    return index.toString(16).padStart(64, '0');
}

function makePendingCaptureSession(keyframeCount: number): CaptureSessionPackageV2 {
    const keyframes = Array.from({ length: keyframeCount }, (_, i) => {
        const sha256 = makeHexHash(i + 1);
        return {
            index: i,
            sha256,
            offlineCasRef: `offline-cas://${sha256}.webp`,
            mimeType: 'image/webp' as const,
            originalBytes: 400_000,
            optimizedBytes: 60_000,
            savingsPct: 85,
            displayRotationDeg: 0,
            poseSE3: { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [i * 0.5, 1.5, 4.0] as [number, number, number] },
            intrinsics: { fx: 960, fy: 960, cx: 640, cy: 480, width: 1280, height: 960 },
            timestampNs: (i + 1) * 1_000_000_000,
            azimuthDeg: (i * 30) % 360,
            sharpnessScore: 140,
        };
    });

    const bundleSha = makeHexHash(999);

    return WebCaptureSessionPackageV2Schema.parse({
        sessionId: 'sess_sprint0_batch_01',
        schemaVersion: '2.0',
        tenantId: 'tenant-atacama-01',
        assetId: 'asset_acopio_sprint0',
        measurementId: 'meas_acopio_sprint0',
        capturedAt: 1700000000000,
        scannerEngineVersion: '2.0-vio-mvs',
        orientationMode: 'LANDSCAPE_4_3',
        depthMode: 'VIO_MVS_OFFLINE',
        deviceModel: 'Samsung SM-G556B',
        lifecycle_status: 'CAPTURED_OFFLINE_VALID',
        metrology_grade: 'VALID_IN_SITU',
        reconciliation_status: 'PENDING_CLOUD',
        keyframes,
        walkRingPoses: [
            [0, 1.5, 4],
            [4, 1.5, 0],
            [0, 1.5, -4],
            [-4, 1.5, 0],
        ],
        rawSpatialBundle: {
            sha256: bundleSha,
            offlineCasRef: `offline-cas://${bundleSha}.json`,
            originalBytes: 128_000,
            optimizedBytes: 128_000,
            savingsPct: 0,
        },
        inSituMetrology: {
            volumeM3: 48.2,
            baseLengthM: 8.1,
            baseWidthM: 6.4,
            heightMaxM: 2.9,
            footprintAreaM2: 40.7,
            groundPlane: { a: 0, b: 0, d: 0, slopeDeg: 1.2, toeScore: 91 },
            uncertaintyPct: 5.4,
            toeScore: 91,
            coveragePct: 92,
            occludedVolumePct: 1.8,
            zeroCellsInside: 0,
            loopDriftPct: 0.9,
            metrologyGrade: 'VALID_IN_SITU',
            metrologyReasons: [],
            engineVersion: '2.0-vio-mvs',
        },
        casIntegrity: {
            manifestSha256: bundleSha,
            totalOriginalBytes: keyframeCount * 400_000 + 128_000,
            totalOptimizedBytes: keyframeCount * 60_000 + 128_000,
            totalSavingsPct: 82.4,
        },
        reconciliation: {
            offlineInSituM3: 48.2,
        },
    });
}

describe('Sprint 0 — CORS Idempotency-Key (src/index.ts)', () => {
    it('incluye Idempotency-Key e idempotency-key en allowedHeaders y https://localhost en orígenes CORS', () => {
        const allowedHeadersMatch = backendIndexSource.match(/allowedHeaders:\s*\[([\s\S]*?)\]/);
        expect(allowedHeadersMatch).not.toBeNull();
        const block = allowedHeadersMatch![1];
        expect(block).toContain("'Idempotency-Key'");
        expect(block).toContain("'idempotency-key'");
        expect(backendIndexSource).toContain("'https://localhost'");
    });

    it('registra POST /cas-preflight-batch protegido con resolveMinReportSessionScope y concurrencia acotada en src/api/media.routes.ts', () => {
        expect(backendMediaRoutesSource).toContain("'/cas-preflight-batch'");
        expect(backendMediaRoutesSource).toContain('resolveMinReportSessionScope');
        expect(backendMediaRoutesSource).toContain('CasPreflightBatchRequestSchema.safeParse');
        expect(backendMediaRoutesSource).toContain('CasStorageService.preflightCheck(sha256, effectiveScope, ctx.tenantId)');
    });
});

describe('Sprint 0 — Contratos Batch Preflight CAS y Telemetría Hardware/Calibración', () => {
    it('valida hashes SHA-256 (1..64), normaliza a minúsculas y usa TENANT_PRIVATE por defecto', () => {
        const upperHash = 'A'.repeat(64);
        const parsed = CasPreflightBatchRequestSchema.parse({ hashes: [upperHash] });
        expect(parsed.hashes).toEqual(['a'.repeat(64)]);
        expect(parsed.scope).toBe('TENANT_PRIVATE');
        expect(parsed.profile).toBeUndefined();

        expect(CasPreflightBatchRequestSchema.safeParse({ hashes: [] }).success).toBe(false);
        expect(
            CasPreflightBatchRequestSchema.safeParse({
                hashes: Array.from({ length: 65 }, (_, i) => makeHexHash(i + 1)),
            }).success
        ).toBe(false);
        expect(
            CasPreflightBatchRequestSchema.safeParse({ hashes: ['not-a-sha256'] }).success
        ).toBe(false);
    });

    it('CaptureSessionPackageV2Schema backend acepta campos opcionales hardware/calibración en camelCase y snake_case sin romper payloads legacy', () => {
        const basePkg = {
            sessionId: 'sess_telemetry_01',
            capturedAt: 1700000000000,
            inSituMetrology: {
                volumeM3: 32.5,
                uncertaintyPct: 4.5,
                toeScore: 88,
                metrologyGrade: 'VALID_IN_SITU',
            },
        };

        // Sin telemetría hardware/calibración (retrocompatible)
        const legacy = BackendCaptureSessionPackageV2Schema.parse(basePkg);
        expect(legacy.deviceModel).toBeUndefined();
        expect(legacy.calibrationId).toBeUndefined();
        expect(legacy.calibrationScaleFactor).toBeUndefined();
        expect(legacy.scannerEngineVersion).toBeUndefined();

        // Con snake_case
        const snake = BackendCaptureSessionPackageV2Schema.parse({
            ...basePkg,
            device_model: 'Samsung SM-G556B',
            calibration_id: 'cal_2026_001',
            calibration_scale_factor: 1.024,
            scanner_engine_version: '2.0-vio-mvs',
        });
        expect(snake.deviceModel).toBe('Samsung SM-G556B');
        expect(snake.calibrationId).toBe('cal_2026_001');
        expect(snake.calibrationScaleFactor).toBe(1.024);
        expect(snake.scannerEngineVersion).toBe('2.0-vio-mvs');

        // Con camelCase
        const camel = BackendCaptureSessionPackageV2Schema.parse({
            ...basePkg,
            deviceModel: 'Samsung SM-G736B',
            calibrationId: 'cal_2026_002',
            calibrationScaleFactor: 0.985,
            scannerEngineVersion: '2.1-vio-depth',
        });
        expect(camel.deviceModel).toBe('Samsung SM-G736B');
        expect(camel.calibrationId).toBe('cal_2026_002');
        expect(camel.calibrationScaleFactor).toBe(0.985);
        expect(camel.scannerEngineVersion).toBe('2.1-vio-depth');
    });

    it('resolveMeasurementHardwareTelemetry propaga device_model, calibration_id, calibration_scale_factor y scanner_engine_version con fallback limpio', () => {
        const fromScan = resolveMeasurementHardwareTelemetry({
            spatialScan: {
                deviceModel: 'Samsung SM-G556B',
                calibrationId: 'cal_scan_01',
                calibrationScaleFactor: 1.015,
                scannerEngineVersion: '2.0-vio-mvs',
            },
        });
        expect(fromScan).toEqual({
            device_model: 'Samsung SM-G556B',
            calibration_id: 'cal_scan_01',
            calibration_scale_factor: 1.015,
            scanner_engine_version: '2.0-vio-mvs',
        });

        // Fallback a capability + calibración válida en caché cuando faltan en spatialScan
        const fromFallback = resolveMeasurementHardwareTelemetry({
            spatialScan: null,
            capability: { manufacturer: 'Samsung', model: 'SM-G736B' },
            cachedCalibration: {
                calibrated: true,
                scaleFactor: 0.992,
                referenceDistanceM: 2.0,
                calibratedAt: Date.now(),
                calibrationId: 'cal_cached_02',
            },
        });
        expect(fromFallback).toEqual({
            device_model: 'Samsung SM-G736B',
            calibration_id: 'cal_cached_02',
            calibration_scale_factor: 0.992,
        });

        // Sin datos presentes devuelve objeto vacío sin inyectar claves undefined
        const empty = resolveMeasurementHardwareTelemetry({
            spatialScan: null,
            capability: null,
            cachedCalibration: null,
        });
        expect(Object.keys(empty)).toHaveLength(0);
    });
});

describe('Sprint 0 — SyncQueueEngine: Batch CAS Preflight + Pool Concurrencia 5 + Guardado Único', () => {
    const origFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    });

    afterEach(() => {
        globalThis.fetch = origFetch;
        vi.restoreAllMocks();
    });

    it('ejecuta 1 llamada cas-preflight-batch, sube faltantes con concurrencia máxima 5 y persiste sesión una sola vez al completar Etapa 1', async () => {
        expect(CAPTURE_SESSION_CAS_UPLOAD_CONCURRENCY).toBe(5);
        const session = makePendingCaptureSession(12); // 12 keyframes + 1 bundle = 13 hashes pendientes
        let savedSession: any = { ...session, updatedAt: Date.now() };
        const tasks: any[] = [
            {
                id: 'task_batch_parallel_01',
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

        const preHitHashes = new Set([session.keyframes[0].sha256, session.keyframes[1].sha256, session.keyframes[2].sha256]);
        let batchCalls = 0;
        let unitPreflightCalls = 0;
        let uploadCalls = 0;
        let inFlightUploads = 0;
        let maxInFlightUploads = 0;
        const saveCaptureSessionSpy = vi
            .spyOn(offlineStorage, 'saveCaptureSession')
            .mockImplementation(async (s) => {
                savedSession = { ...s, updatedAt: Date.now() };
            });

        vi.spyOn(offlineStorage, 'getCaptureSession').mockImplementation(async () => savedSession);
        vi.spyOn(offlineStorage, 'getOfflineMetadata').mockResolvedValue(null);
        vi.spyOn(offlineStorage, 'putOfflineMetadata').mockResolvedValue(undefined);
        vi.spyOn(offlineStorage, 'getStockpileMeasurement').mockResolvedValue(null);
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

        vi.spyOn(localCasFilesystem, 'getBlob').mockImplementation(async (sha) => ({
            blob: new Blob([JSON.stringify({ pointsM: [[0, 1, 0]] })], { type: 'application/json' }),
            record: {
                sha256: sha,
                mimeType: 'application/octet-stream',
                profile: 'IMAGE_FIELD_EVIDENCE',
                scope: 'TENANT_PRIVATE',
                tenantId: session.tenantId,
                filename: `${sha}.webp`,
                originalBytes: 120,
                optimizedBytes: 60,
                updatedAt: Date.now(),
            },
        }));

        vi.spyOn(CoreAuthFetchMod, 'coreAuthFetch').mockImplementation(async (url, init) => {
            const urlStr = String(url);
            if (urlStr === '/api/media/cas-preflight-batch') {
                batchCalls += 1;
                const body = JSON.parse(String(init?.body || '{}')) as { hashes: string[]; scope: string };
                expect(body.hashes).toHaveLength(13);
                expect(body.scope).toBe('TENANT_PRIVATE');
                const results: Record<string, { exists: boolean; descriptor?: { downloadUrl: string } }> = {};
                for (const h of body.hashes) {
                    if (preHitHashes.has(h)) {
                        results[h] = {
                            exists: true,
                            descriptor: {
                                downloadUrl: `/api/media/blob/tenant/${session.tenantId}/${h}.webp`,
                            },
                        };
                    } else {
                        results[h] = { exists: false };
                    }
                }
                return new Response(JSON.stringify({ results }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (urlStr.startsWith('/api/media/cas-preflight/')) {
                unitPreflightCalls += 1;
                return new Response(JSON.stringify({ exists: false }), { status: 200 });
            }

            if (urlStr === '/api/media/digest-upload') {
                uploadCalls += 1;
                inFlightUploads += 1;
                maxInFlightUploads = Math.max(maxInFlightUploads, inFlightUploads);
                await new Promise((resolve) => setTimeout(resolve, 15));
                inFlightUploads -= 1;
                const fakeSha = makeHexHash(500 + uploadCalls);
                return new Response(
                    JSON.stringify({
                        descriptor: {
                            downloadUrl: `/api/media/blob/tenant/${session.tenantId}/${fakeSha}.webp`,
                        },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (urlStr.includes('/capture-sessions')) {
                return new Response(
                    JSON.stringify({
                        lifecycle_status: 'CLOUD_3D_VERIFIED',
                        effectiveVolumeM3: 48.2,
                        reconciliation: { status: 'AUTO_CONCILIATED', deltaPct: 0 },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            return new Response('{}', { status: 200 });
        });

        await syncQueueEngine.drainQueue();

        expect(batchCalls).toBe(1);
        expect(unitPreflightCalls).toBe(0);
        expect(uploadCalls).toBe(10); // 13 pendientes - 3 hits en batch
        expect(maxInFlightUploads).toBe(5);
        // 3 escrituras totales: (1) SYNCING_RAW_CAS, (2) único guardado en finally tras Etapa 1, (3) CLOUD_3D_VERIFIED
        expect(saveCaptureSessionSpy).toHaveBeenCalledTimes(3);
        expect(savedSession.lifecycle_status).toBe('CLOUD_3D_VERIFIED');
        expect(savedSession.keyframes.every((kf: any) => Boolean(kf.remoteCasUrl))).toBe(true);
        expect(Boolean(savedSession.rawSpatialBundle?.remoteCasUrl)).toBe(true);
    });

    it('hace fallback automático al flujo unitario /api/media/cas-preflight/:sha256 cuando batch responde 404 y persiste progreso parcial en finally si falla', async () => {
        const session = makePendingCaptureSession(3); // 3 keyframes + 1 bundle = 4 pendientes
        let savedSession: any = { ...session, updatedAt: Date.now() };
        const tasks: any[] = [
            {
                id: 'task_fallback_404',
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

        const unitPreflightSeen: string[] = [];
        const saveCaptureSessionSpy = vi
            .spyOn(offlineStorage, 'saveCaptureSession')
            .mockImplementation(async (s) => {
                savedSession = { ...s, updatedAt: Date.now() };
            });

        vi.spyOn(offlineStorage, 'getCaptureSession').mockImplementation(async () => savedSession);
        vi.spyOn(offlineStorage, 'getOfflineMetadata').mockResolvedValue(null);
        vi.spyOn(offlineStorage, 'putOfflineMetadata').mockResolvedValue(undefined);
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

        vi.spyOn(localCasFilesystem, 'getBlob').mockImplementation(async (sha) => {
            // Simular fallo en el bundle para verificar persistencia parcial en finally
            if (sha === session.rawSpatialBundle?.sha256) {
                return null;
            }
            return {
                blob: new Blob(['ok'], { type: 'image/webp' }),
                record: {
                    sha256: sha,
                    mimeType: 'image/webp',
                    profile: 'IMAGE_FIELD_EVIDENCE',
                    scope: 'TENANT_PRIVATE',
                    tenantId: session.tenantId,
                    filename: `${sha}.webp`,
                    originalBytes: 100,
                    optimizedBytes: 50,
                    updatedAt: Date.now(),
                },
            };
        });

        vi.spyOn(CoreAuthFetchMod, 'coreAuthFetch').mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr === '/api/media/cas-preflight-batch') {
                return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
            }
            if (urlStr.startsWith('/api/media/cas-preflight/')) {
                const sha = decodeURIComponent(urlStr.replace('/api/media/cas-preflight/', ''));
                unitPreflightSeen.push(sha);
                if (sha === session.keyframes[0].sha256) {
                    return new Response(
                        JSON.stringify({
                            exists: true,
                            descriptor: {
                                downloadUrl: `/api/media/blob/tenant/${session.tenantId}/${sha}.webp`,
                            },
                        }),
                        { status: 200 }
                    );
                }
                return new Response(JSON.stringify({ exists: false }), { status: 200 });
            }
            if (urlStr === '/api/media/digest-upload') {
                return new Response(
                    JSON.stringify({
                        descriptor: {
                            downloadUrl: `/api/media/blob/tenant/${session.tenantId}/${makeHexHash(777)}.webp`,
                        },
                    }),
                    { status: 200 }
                );
            }
            return new Response('{}', { status: 200 });
        });

        await syncQueueEngine.drainQueue();

        expect(unitPreflightSeen.length).toBeGreaterThanOrEqual(1);
        expect(unitPreflightSeen).toContain(session.keyframes[0].sha256);
        // Al fallar el bundle (404 no reintentable), finally persiste en 1 sola llamada el progreso parcial de los keyframes ya subidos
        expect(saveCaptureSessionSpy).toHaveBeenCalledTimes(2); // (1) SYNCING_RAW_CAS + (2) finally parcial
        expect(savedSession.keyframes[0].remoteCasUrl).toContain(session.keyframes[0].sha256);
    });
});

describe('Sprint 0 — StockpileTwin3D: Protección de Texturas Fotográficas Reales', () => {
    it('conserva color blanco neutro (0xffffff) cuando mat.map está presente en modo sólido sin teñir a cobre 0xc68346', () => {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const photoTexture = new THREE.Texture();
        const texturedStdMat = new THREE.MeshStandardMaterial({
            color: 0xc68346,
            map: photoTexture,
        });
        const untexturedStdMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
        });
        const texturedBasicMat = new THREE.MeshBasicMaterial({
            color: 0xc68346,
            map: photoTexture,
        });

        const group = new THREE.Group();
        group.add(new THREE.Mesh(geometry, texturedStdMat));
        group.add(new THREE.Mesh(geometry, untexturedStdMat));
        group.add(new THREE.Mesh(geometry, texturedBasicMat));

        // Modo sólido sin wireframe ni capa de confianza -> protege textura real con 0xffffff
        applyStockpileVisualMaterialState(group, false, false);
        expect(texturedStdMat.color.getHex()).toBe(0xffffff);
        expect(texturedStdMat.emissive.getHex()).toBe(0x000000);
        expect(texturedStdMat.wireframe).toBe(false);
        expect(texturedStdMat.vertexColors).toBe(false);

        // Material sin textura conserva cobre industrial MINREPORT #C68346
        expect(untexturedStdMat.color.getHex()).toBe(0xc68346);

        // MeshBasicMaterial con textura también preserva 0xffffff
        expect(texturedBasicMat.color.getHex()).toBe(0xffffff);

        // En wireframe sigue aplicando cian técnico #00AEEF
        applyStockpileVisualMaterialState(group, true, false);
        expect(texturedStdMat.wireframe).toBe(true);
        expect(texturedStdMat.color.getHex()).toBe(0x00aeef);
        expect(texturedStdMat.emissive.getHex()).toBe(0x004966);
        expect(texturedBasicMat.color.getHex()).toBe(0x00aeef);

        // Volver a sólido restaura 0xffffff en textura y 0xc68346 en malla sin textura
        applyStockpileVisualMaterialState(group, false, false);
        expect(texturedStdMat.color.getHex()).toBe(0xffffff);
        expect(untexturedStdMat.color.getHex()).toBe(0xc68346);

        geometry.dispose();
        photoTexture.dispose();
        texturedStdMat.dispose();
        untexturedStdMat.dispose();
        texturedBasicMat.dispose();
    });
});
