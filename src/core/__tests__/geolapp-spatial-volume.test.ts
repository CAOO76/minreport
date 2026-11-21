import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';
process.env.SUPER_ADMIN_EMAIL ||= 'admin@minreport.com';

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const storedBlobs = new Map<string, Buffer>();

function getColMap(colPath: string): Map<string, Record<string, any>> {
    let col = dbCollections.get(colPath);
    if (!col) {
        col = new Map();
        dbCollections.set(colPath, col);
    }
    return col;
}

function createDocRef(colPath: string, docId: string): any {
    return {
        id: docId,
        path: `${colPath}/${docId}`,
        collection(subName: string) {
            return createColRef(`${colPath}/${docId}/${subName}`);
        },
        async get() {
            const data = getColMap(colPath).get(docId);
            return {
                id: docId,
                exists: Boolean(data),
                data: () => (data ? structuredClone(data) : undefined),
            };
        },
        async set(payload: Record<string, any>, options?: { merge?: boolean }) {
            const col = getColMap(colPath);
            const prev = options?.merge && col.has(docId) ? col.get(docId) : {};
            col.set(docId, { ...prev, ...structuredClone(payload) });
        },
        async update(patch: Record<string, any>) {
            const col = getColMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...structuredClone(patch) });
        },
    };
}

function createColRef(colPath: string): any {
    return {
        doc(id?: string) {
            const docId = id || `auto_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            return createDocRef(colPath, docId);
        },
        where() {
            return {
                limit() {
                    return {
                        async get() {
                            return { empty: true, size: 0, docs: [] };
                        },
                    };
                },
                async get() {
                    return { empty: true, size: 0, docs: [] };
                },
            };
        },
    };
}

const mockDb = {
    collection: (name: string) => createColRef(name),
    settings: () => {},
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        return fn({
            get: (ref: any) => ref.get(),
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) =>
                ref.set(data, opts),
            update: (ref: any, patch: Record<string, any>) => ref.update(patch),
            delete: () => Promise.resolve(),
        });
    },
};

const mockStorage = {
    bucket: () => ({
        name: 'minreport-sandbox-test',
        file: (storagePath: string) => ({
            async save(buffer: Buffer) {
                storedBlobs.set(storagePath, Buffer.from(buffer));
            },
        }),
    }),
};

require.cache[require.resolve('../../config/firebase')] = {
    id: require.resolve('../../config/firebase'),
    filename: require.resolve('../../config/firebase'),
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            apps: [{ name: '[DEFAULT]' }],
            firestore: () => mockDb,
            auth: () => ({ verifyIdToken: async () => ({}) }),
            storage: () => mockStorage,
        },
        db: mockDb,
        auth: { verifyIdToken: async () => ({}) },
        storage: mockStorage,
        messaging: {},
    },
} as any;

const { AuditLedger } =
    require('../../core/audit-ledger') as typeof import('../../core/audit-ledger');
const {
    computeSpatialStockpileVolume,
    fitInclinedGroundPlane,
    SpatialVolumeValidationError,
} = require('../../modules/geolapp/spatial-volume.engine') as typeof import('../../modules/geolapp/spatial-volume.engine');
const { buildSpatialPointCloudGlbMesh } =
    require('../../modules/geolapp/glb-surface.builder') as typeof import('../../modules/geolapp/glb-surface.builder');
const geolappController =
    require('../../api/geolapp.controller') as typeof import('../../api/geolapp.controller');

function createMockResponse() {
    const res: any = {
        statusCode: 200,
        bodyPayload: undefined,
        headers: {} as Record<string, string>,
        setHeader(k: string, v: string) {
            this.headers[k] = v;
        },
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            this.bodyPayload = payload;
            return this;
        },
    };
    return res;
}

function generateSyntheticConeCloud(params: {
    radiusM: number;
    heightM: number;
    slopeX?: number;
    slopeZ?: number;
    groundOffsetY?: number;
    maxAngleRad?: number;
}): {
    pointsM: Array<[number, number, number]>;
    groundSamplesM: Array<[number, number, number]>;
} {
    const {
        radiusM,
        heightM,
        slopeX = 0,
        slopeZ = 0,
        groundOffsetY = 0,
        maxAngleRad = Math.PI * 2,
    } = params;

    const pointsM: Array<[number, number, number]> = [];
    const groundSamplesM: Array<[number, number, number]> = [];

    const step = 0.16;
    for (let x = -radiusM - 0.35; x <= radiusM + 0.35; x += step) {
        for (let z = -radiusM - 0.35; z <= radiusM + 0.35; z += step) {
            const r = Math.hypot(x, z);
            const rawAngle = Math.atan2(z, x);
            const normAngle = rawAngle < 0 ? rawAngle + Math.PI * 2 : rawAngle;
            if (normAngle > maxAngleRad) continue;

            const yGround = slopeX * x + slopeZ * z + groundOffsetY;
            if (r <= radiusM) {
                const h = heightM * (1 - r / radiusM);
                pointsM.push([
                    Number(x.toFixed(4)),
                    Number((yGround + h).toFixed(4)),
                    Number(z.toFixed(4)),
                ]);
            } else if (r <= radiusM + 0.35) {
                groundSamplesM.push([
                    Number(x.toFixed(4)),
                    Number(yGround.toFixed(4)),
                    Number(z.toFixed(4)),
                ]);
            }
        }
    }

    return { pointsM, groundSamplesM };
}

test('Cono conocido (r=3m, h=2.5m, V=23.56m3) sobre piso plano obtiene error < 5%', () => {
    const exactVolume = (1 / 3) * Math.PI * 3 * 3 * 2.5; // ~23.5619 m3
    const { pointsM, groundSamplesM } = generateSyntheticConeCloud({
        radiusM: 3,
        heightM: 2.5,
    });

    const res = computeSpatialStockpileVolume({
        pointsM,
        groundSamplesM,
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'RAW_DEPTH_ONLY',
    });

    const relErrorPct = (Math.abs(res.volumeM3 - exactVolume) / exactVolume) * 100;
    assert.ok(
        relErrorPct < 5,
        `Error volumetrico (${relErrorPct.toFixed(2)}%) debe ser < 5% (obtenido=${res.volumeM3} m3, exacto=${exactVolume.toFixed(2)} m3)`
    );
    assert.ok(res.toeScore >= 85, `toeScore esperado >= 85, obtenido ${res.toeScore}`);
    assert.ok(res.groundSlopeDeg <= 0.5, `groundSlopeDeg plano esperado <= 0.5, obtenido ${res.groundSlopeDeg}`);
    assert.ok(res.heightM >= 2.35 && res.heightM <= 2.6, `Altura esperada ~2.5m, obtenida ${res.heightM}`);
    assert.ok(
        res.slopeAngleAvgDeg !== null && Math.abs(res.slopeAngleAvgDeg - 39.8) < 4,
        `Talud esperado ~39.8°, obtenido ${res.slopeAngleAvgDeg}`
    );
});

test('Cono sobre cancha inclinada al 5% (y = 0.05*x) recupera pendiente ~2.86°, error < 6% y toeScore >= 75', () => {
    const exactVolume = (1 / 3) * Math.PI * 3 * 3 * 2.5;
    const { pointsM } = generateSyntheticConeCloud({
        radiusM: 3,
        heightM: 2.5,
        slopeX: 0.05,
        slopeZ: 0,
        groundOffsetY: 0.25,
    });

    // Probar sin groundSamplesM para validar que el anillo externo + 16 sectores del Toe Solver funciona por sí solo
    const ground = fitInclinedGroundPlane(pointsM);
    const expectedSlopeDeg = (Math.atan(0.05) * 180) / Math.PI; // ~2.8624°

    assert.ok(
        Math.abs(ground.a - 0.05) < 0.01,
        `Coeficiente pendiente X esperado ~0.05, obtenido ${ground.a}`
    );
    assert.ok(
        Math.abs(ground.groundSlopeDeg - expectedSlopeDeg) < 0.5,
        `Pendiente esperada ~${expectedSlopeDeg.toFixed(2)}°, obtenida ${ground.groundSlopeDeg}°`
    );
    assert.ok(ground.toeScore >= 75, `toeScore esperado >= 75, obtenido ${ground.toeScore}`);

    const res = computeSpatialStockpileVolume({
        pointsM,
        coveragePct: 92,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'RAW_DEPTH_ONLY',
    });

    const relErrorPct = (Math.abs(res.volumeM3 - exactVolume) / exactVolume) * 100;
    assert.ok(
        relErrorPct < 6,
        `Error volumetrico en cancha inclinada 5% (${relErrorPct.toFixed(2)}%) debe ser < 6% (obtenido=${res.volumeM3} m3)`
    );
    assert.ok(res.toeScore >= 75, `toeScore esperado >= 75, obtenido ${res.toeScore}`);
});

test('Cobertura parcial (coveragePct=35%) y modo VIO_POINTCLOUD elevan honestamente uncertaintyPct', () => {
    const full = generateSyntheticConeCloud({ radiusM: 3, heightM: 2.5 });
    const partial = generateSyntheticConeCloud({
        radiusM: 3,
        heightM: 2.5,
        maxAngleRad: Math.PI * 0.75,
    });

    const fullRes = computeSpatialStockpileVolume({
        pointsM: full.pointsM,
        groundSamplesM: full.groundSamplesM,
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'RAW_DEPTH_ONLY',
    });

    const partialRes = computeSpatialStockpileVolume({
        pointsM: partial.pointsM,
        groundSamplesM: partial.groundSamplesM,
        coveragePct: 35,
        sectorsCovered: 6,
        loopClosed: false,
        depthMode: 'VIO_POINTCLOUD',
    });

    assert.ok(
        partialRes.uncertaintyPct > fullRes.uncertaintyPct + 10,
        `Incertidumbre parcial (${partialRes.uncertaintyPct}%) debe superar significativamente a escaneo completo (${fullRes.uncertaintyPct}%)`
    );
    assert.ok(partialRes.uncertaintyPct >= 15 && partialRes.uncertaintyPct <= 35);
    assert.ok(partialRes.confidence < fullRes.confidence);

    assert.throws(
        () =>
            computeSpatialStockpileVolume({
                pointsM: [[0, 0, 0], [1, 0, 0]],
            }),
        (err: unknown) => err instanceof SpatialVolumeValidationError
    );
});

test('buildSpatialPointCloudGlbMesh genera binario glTF 2.0 watertight valido con tinVolumeM3 > 0', () => {
    const { pointsM, groundSamplesM } = generateSyntheticConeCloud({
        radiusM: 3,
        heightM: 2.5,
        slopeX: 0.05,
    });
    const volRes = computeSpatialStockpileVolume({
        pointsM,
        groundSamplesM,
        coveragePct: 92,
        sectorsCovered: 16,
        loopClosed: true,
        depthMode: 'RAW_DEPTH_ONLY',
    });

    const glb = buildSpatialPointCloudGlbMesh(volRes.surfaceGrid);
    assert.ok(glb.glbBuffer.length >= 28);
    assert.equal(glb.glbBuffer.readUInt32LE(0), 0x46546c67, 'Magic glTF 0x46546c67');
    assert.equal(glb.glbBuffer.readUInt32LE(4), 2, 'Version glTF 2');
    assert.equal(glb.glbBuffer.readUInt32LE(8), glb.glbBuffer.length, 'Longitud exacta de GLB');

    const jsonLen = glb.glbBuffer.readUInt32LE(12);
    const jsonType = glb.glbBuffer.readUInt32LE(16);
    assert.equal(jsonType, 0x4e4f534a);
    const gltfDoc = JSON.parse(glb.glbBuffer.subarray(20, 20 + jsonLen).toString('utf8').trim());
    assert.equal(gltfDoc.asset.version, '2.0');
    assert.equal(gltfDoc.asset.generator, 'MINREPORT-ACOPIOS-TIN-BUILDER-southamerica-west1');

    const binHeader = 20 + jsonLen;
    const binLen = glb.glbBuffer.readUInt32LE(binHeader);
    const binType = glb.glbBuffer.readUInt32LE(binHeader + 4);
    assert.equal(binType, 0x004e4942);
    assert.equal(binHeader + 8 + binLen, glb.glbBuffer.length);

    assert.ok(glb.tinVolumeM3 > 20 && glb.tinVolumeM3 < 28, `tinVolumeM3 esperado ~23.5m3, obtenido ${glb.tinVolumeM3}`);
    assert.ok(glb.vertexCount > 50 && glb.vertexCount <= 65535);
    assert.ok(glb.triangleCount > 50);
});

test('Endpoints POST /spatial-analyze y POST /stockpiles/:id/spatial-analyze validan, aislan tenant, guardan .glb CAS y auditan', async () => {
    dbCollections.clear();
    storedBlobs.clear();

    const routerStack = (geolappController.default as any).stack as Array<any>;
    const previewLayer = routerStack.find(
        (l) => l.route?.path === '/spatial-analyze' && l.route.methods.post
    );
    const stockpileLayer = routerStack.find(
        (l) => l.route?.path === '/stockpiles/:id/spatial-analyze' && l.route.methods.post
    );

    assert.ok(previewLayer?.route, 'Debe existir POST /spatial-analyze');
    assert.ok(stockpileLayer?.route, 'Debe existir POST /stockpiles/:id/spatial-analyze');

    const previewHandler = previewLayer.route.stack[previewLayer.route.stack.length - 1].handle;
    const stockpileHandler = stockpileLayer.route.stack[stockpileLayer.route.stack.length - 1].handle;

    getColMap('accounts').set('tenant-alpha', {
        id: 'tenant-alpha',
        ownerId: 'uid-alpha',
        status: 'ACTIVE',
    });
    getColMap('stockpiles').set('stk-sp-1', {
        id: 'stk-sp-1',
        tenantId: 'tenant-alpha',
        accountId: 'tenant-alpha',
        name: 'ACOPIO OXIDO NORTE',
        density_factor: 1.9,
        status: 'ACTIVE',
    });

    const { pointsM, groundSamplesM } = generateSyntheticConeCloud({
        radiusM: 3,
        heightM: 2.5,
        slopeX: 0.05,
    });

    const validPayload = {
        measurementId: 'meas-sp-1',
        scanId: 'scan-xcover7-1',
        depthMode: 'RAW_DEPTH_ONLY',
        coveragePct: 91.5,
        sectorsCovered: 15,
        keyframeCount: 18,
        loopClosed: true,
        pointsM,
        groundSamplesM,
        locale: 'es',
    };

    const auditCalls: any[] = [];
    const origAuditRecord = AuditLedger.record;
    (AuditLedger as any).record = async (entry: any) => {
        auditCalls.push(entry);
        return 'audit-sp-1';
    };

    try {
        // 1. Validación Zod 400 (< 20 puntos)
        const res400 = createMockResponse();
        await previewHandler(
            {
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha' },
                body: { ...validPayload, pointsM: pointsM.slice(0, 5) },
            },
            res400,
            () => {}
        );
        assert.equal(res400.statusCode, 400);

        // 2. Aislamiento multi-tenant 403
        const res403 = createMockResponse();
        await stockpileHandler(
            {
                params: { id: 'stk-sp-1' },
                user: { uid: 'uid-bravo', email: 'op@bravo.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-bravo' },
                body: validPayload,
            },
            res403,
            () => {}
        );
        assert.equal(res403.statusCode, 403);

        // 3. Preview POST /spatial-analyze -> 200 con .glb en CAS
        const previewRes = createMockResponse();
        await previewHandler(
            {
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha' },
                body: validPayload,
            },
            previewRes,
            () => {}
        );
        assert.equal(previewRes.statusCode, 200);
        assert.equal(previewRes.bodyPayload?.verified, true);
        assert.equal(previewRes.bodyPayload?.scaleVerified, true);
        assert.equal(previewRes.bodyPayload?.meshSource, 'ARCORE_VIO_DEPTH_SOUTH_AMERICA_WEST1');
        assert.ok(previewRes.bodyPayload?.volumeM3 > 20);
        assert.ok(
            previewRes.bodyPayload?.meshUrl?.startsWith('/api/media/blob/tenant/tenant-alpha/'),
            `meshUrl esperado /api/media/blob/tenant/tenant-alpha/..., obtenido ${previewRes.bodyPayload?.meshUrl}`
        );
        assert.match(String(previewRes.bodyPayload?.meshSha256 || ''), /^[a-f0-9]{64}$/);
        assert.ok(storedBlobs.size >= 1, 'Debe haber guardado el .glb en Storage CAS');
        const firstStoredGlb = Array.from(storedBlobs.values())[0];
        assert.equal(firstStoredGlb.readUInt32LE(0), 0x46546c67, 'Blob guardado en CAS debe ser glTF 2.0 .glb');

        // 4. POST /stockpiles/:id/spatial-analyze -> 200 + consolida Firestore + AuditLedger
        const spRes = createMockResponse();
        await stockpileHandler(
            {
                params: { id: 'stk-sp-1' },
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha' },
                body: validPayload,
            },
            spRes,
            () => {}
        );
        assert.equal(spRes.statusCode, 200);
        assert.equal(spRes.bodyPayload?.meshSource, 'ARCORE_VIO_DEPTH_SOUTH_AMERICA_WEST1');
        assert.ok(spRes.bodyPayload?.weightT > 35, 'Debe calcular peso usando density_factor=1.9');

        const updatedStockpile = getColMap('stockpiles').get('stk-sp-1');
        assert.equal(updatedStockpile?.analysis_status, 'AI_VERIFIED');
        assert.equal(updatedStockpile?.scale_anchor_type, 'ARCORE_VIO_DEPTH');
        assert.equal(updatedStockpile?.mesh_source, 'ARCORE_VIO_DEPTH_SOUTH_AMERICA_WEST1');
        assert.equal(updatedStockpile?.volumen_m3, spRes.bodyPayload?.volumeM3);
        assert.equal(updatedStockpile?.toe_score, spRes.bodyPayload?.toeScore);

        const measDoc = getColMap('stockpiles/stk-sp-1/measurements').get('meas-sp-1');
        assert.ok(measDoc, 'Debe consolidar subdocumento measurement');
        assert.equal(measDoc?.scale_anchor_type, 'ARCORE_VIO_DEPTH');
        assert.equal(measDoc?.volumen_m3, spRes.bodyPayload?.volumeM3);

        assert.equal(auditCalls.length, 2);
        assert.equal(auditCalls[1].action, 'SPATIAL_STOCKPILE_3D_ANALYZE');
        assert.equal(auditCalls[1].module, 'stockpile');
    } finally {
        (AuditLedger as any).record = origAuditRecord;
    }
});
