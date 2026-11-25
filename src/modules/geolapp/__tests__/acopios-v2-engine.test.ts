import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';
process.env.SUPER_ADMIN_EMAIL ||= 'admin@minreport.com';

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const storedBlobs = new Map<string, { buffer: Buffer; contentType: string }>();

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
    const filterDocs = (filters: Array<{ field: string; value: any }>) => {
        const col = getColMap(colPath);
        return Array.from(col.entries())
            .filter(([, data]) => filters.every((f) => data?.[f.field] === f.value))
            .map(([id, data]) => ({
                id,
                exists: true,
                data: () => structuredClone(data),
            }));
    };

    const makeQuery = (filters: Array<{ field: string; value: any }> = []): any => ({
        where(field: string, _op: string, value: any) {
            return makeQuery([...filters, { field, value }]);
        },
        limit() {
            return {
                async get() {
                    const docs = filterDocs(filters);
                    return { empty: docs.length === 0, size: docs.length, docs };
                },
            };
        },
        async get() {
            const docs = filterDocs(filters);
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    });

    return {
        doc(id?: string) {
            const docId = id || `auto_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            return createDocRef(colPath, docId);
        },
        where(field: string, op: string, value: any) {
            return makeQuery().where(field, op, value);
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
            async save(buffer: Buffer, opts?: any) {
                storedBlobs.set(storagePath, {
                    buffer: Buffer.from(buffer),
                    contentType: opts?.contentType || 'application/octet-stream',
                });
            },
            async getMetadata() {
                const entry = storedBlobs.get(storagePath);
                if (!entry) throw new Error('Not found');
                return [{ contentType: entry.contentType, size: entry.buffer.length }];
            },
            async download() {
                const entry = storedBlobs.get(storagePath);
                if (!entry) throw new Error('Not found');
                return [Buffer.from(entry.buffer)];
            },
        }),
    }),
};

require.cache[require.resolve('../../../config/firebase')] = {
    id: require.resolve('../../../config/firebase'),
    filename: require.resolve('../../../config/firebase'),
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
    require('../../../core/audit-ledger') as typeof import('../../../core/audit-ledger');
const { MediaDigestorServer } =
    require('../../../core/media/MediaDigestorServer') as typeof import('../../../core/media/MediaDigestorServer');
const { MediaDigestionProfileSchema } =
    require('../../../contracts/media.contracts') as typeof import('../../../contracts/media.contracts');
const {
    CaptureSessionPackageV2Schema,
    evaluateStockpileReconciliation,
} = require('../../../contracts/acopios.contracts') as typeof import('../../../contracts/acopios.contracts');
const {
    computeSpatialStockpileVolume,
    fitInclinedGroundPlane,
} = require('../spatial-volume.engine') as typeof import('../spatial-volume.engine');
const {
    buildSpatialPointCloudGlbMesh,
    inspectGlbBinaryMetrics,
} = require('../glb-surface.builder') as typeof import('../glb-surface.builder');
const geolappController =
    require('../../../api/geolapp.controller') as typeof import('../../../api/geolapp.controller');

function parseGlbJson(buf: Buffer): any {
    const jsonLen = buf.readUInt32LE(12);
    return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8').trim());
}

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

function buildConeWithWalkRing(params: {
    radiusM: number;
    heightM: number;
    slopeX?: number;
    slopeZ?: number;
    holeRadiusM?: number;
    includeGroundSamples?: boolean;
}) {
    const {
        radiusM,
        heightM,
        slopeX = 0,
        slopeZ = 0,
        holeRadiusM = 0,
        includeGroundSamples = false,
    } = params;

    const pointsM: Array<[number, number, number]> = [];
    const groundSamplesM: Array<[number, number, number]> = [];
    const walkRing: Array<{ x: number; y: number; z: number; floorY: number }> = [];

    const step = 0.14;
    for (let x = -radiusM - 0.3; x <= radiusM + 0.3; x += step) {
        for (let z = -radiusM - 0.3; z <= radiusM + 0.3; z += step) {
            const r = Math.hypot(x, z);
            const yg = slopeX * x + slopeZ * z;
            if (r <= radiusM) {
                // Simular un cráter interior sin puntos (ej. oclusión de 0.6 m de radio en el costado)
                if (holeRadiusM > 0 && Math.hypot(x - 0.8, z - 0.6) < holeRadiusM) {
                    continue;
                }
                const h = heightM * (1 - r / radiusM);
                pointsM.push([Number(x.toFixed(4)), Number((yg + h).toFixed(4)), Number(z.toFixed(4))]);
                // Segunda observación por celda para validar COLOR_0 Cian (#00AEEF)
                pointsM.push([
                    Number((x + 0.01).toFixed(4)),
                    Number((yg + h).toFixed(4)),
                    Number((z + 0.01).toFixed(4)),
                ]);
            } else if (includeGroundSamples && r <= radiusM + 0.3) {
                groundSamplesM.push([Number(x.toFixed(4)), Number(yg.toFixed(4)), Number(z.toFixed(4))]);
            }
        }
    }

    const walkR = radiusM + 1.8;
    for (let i = 0; i < 24; i++) {
        const theta = (i / 24) * Math.PI * 2;
        const wx = walkR * Math.cos(theta);
        const wz = walkR * Math.sin(theta);
        const yg = slopeX * wx + slopeZ * wz;
        walkRing.push({
            x: Number(wx.toFixed(4)),
            y: Number((yg + 1.45).toFixed(4)),
            z: Number(wz.toFixed(4)),
            floorY: Number(yg.toFixed(4)),
        });
    }

    return { pointsM, groundSamplesM, walkRing };
}

test('(a) GLB watertight: base nivelada y=0, winding CCW exterior sin sangrado de normales, COLOR_0 ISA-101 y volumen tetraedrico < 0.5%', () => {
    // Prisma rectangular exacto: 10x10 celdas interiores de 0.20 m con altura uniforme 2.0 m
    // Borde exterior en h=0 => área base exacta en quads = 10 * 10 * 0.2 * 0.2 = 4.0 m2?
    // Más directo: plataforma uniforme 10x10 celdas activas (nx=11, nz=11), todas las esquinas h=2.0 m
    // => volumen prismático exacto = (10 * 0.2) * (10 * 0.2) * 2.0 = 8.000 m3!
    const nx = 11;
    const nz = 11;
    const cellSizeM = 0.2;
    const heightsM = new Array<number>(nx * nz).fill(2.0);
    const observationCount = new Array<number>(nx * nz).fill(3);
    const interpolatedMask = new Array<number>(nx * nz).fill(0);
    const slopeDegGrid = new Array<number>(nx * nz).fill(0);
    // Marcar 1 vértice interior como interpolado para verificar Cobre (#C68346) en COLOR_0
    interpolatedMask[5 * nx + 5] = 1;

    const glbRes = buildSpatialPointCloudGlbMesh({
        originX: -1.0,
        originZ: -1.0,
        cellSizeM,
        nx,
        nz,
        heightsM,
        observationCount,
        interpolatedMask,
        slopeDegGrid,
        // Plano inclinado no-cero para comprobar que la base GLB queda igualmente nivelada en y = 0
        groundPlane: { a: 0.12, b: -0.08, d: 0.5 },
    });

    const exactVol = 2.0 * 2.0 * 2.0; // 8.0 m3
    const relErrPct = (Math.abs(glbRes.tinVolumeM3 - exactVol) / exactVol) * 100;
    assert.ok(
        relErrPct < 0.5,
        `Volumen tetraédrico GLB (${glbRes.tinVolumeM3} m3) debe tener error < 0.5% vs exacto (${exactVol} m3)`
    );

    // Base nivelada en y=0 y boundingBoxM unificado { widthX, depthZ, heightY }
    assert.equal(glbRes.boundingBoxM.minY, 0, 'La base de la malla debe descansar exactamente en y = 0');
    assert.equal(glbRes.boundingBoxM.heightY, 2.0, 'bbox.heightY debe coincidir con h = 2.0 m');
    assert.equal(glbRes.boundingBoxM.widthX, 2.0);
    assert.equal(glbRes.boundingBoxM.depthZ, 2.0);

    // Verificar glTF JSON: COLOR_0 presente y Uint16 (5123) para malla < 65535 vértices
    const gltf = parseGlbJson(glbRes.glbBuffer);
    const prim = gltf.meshes[0].primitives[0];
    assert.ok(typeof prim.attributes.COLOR_0 === 'number', 'Debe emitir atributo COLOR_0 ANSI/ISA-101');
    assert.equal(gltf.accessors[prim.indices].componentType, 5123, 'Malla <= 65535 vértices usa Uint16');

    // Verificar vértices separados en faldón: 121 top + 121 bot + 40 aristas * 4 vértices de faldón = 402 vértices
    assert.equal(glbRes.vertexCount, 121 + 121 + 40 * 4, 'Faldón debe usar vértices dedicados (cero sangrado)');

    // Verificar volumen al re-inspeccionar binario GLB (winding exterior CCW consistente)
    const inspected = inspectGlbBinaryMetrics(glbRes.glbBuffer);
    assert.ok(
        Math.abs(inspected.tinVolumeM3 - exactVol) < 0.01,
        `inspectGlbBinaryMetrics debe confirmar volumen exacto (${inspected.tinVolumeM3} vs ${exactVol})`
    );
});

test('(b) GLB soporta automaticamente indices Uint32 (componentType 5125) cuando vertexCount > 65535', () => {
    // Grilla 185 x 185 = 34,225 top + 34,225 bot + faldones => > 71,000 vértices (> 65535)
    const nx = 185;
    const nz = 185;
    const heightsM = new Array<number>(nx * nz).fill(1.0);
    const glbRes = buildSpatialPointCloudGlbMesh({
        originX: 0,
        originZ: 0,
        cellSizeM: 0.1,
        nx,
        nz,
        heightsM,
        groundPlane: { a: 0, b: 0, d: 0 },
    });

    assert.ok(glbRes.vertexCount > 65535, `vertexCount (${glbRes.vertexCount}) debe superar 65535`);
    const gltf = parseGlbJson(glbRes.glbBuffer);
    const idxAccessor = gltf.accessors[gltf.meshes[0].primitives[0].indices];
    assert.equal(
        idxAccessor.componentType,
        5125,
        'Debe conmutar automáticamente a UNSIGNED_INT (5125) cuando vertexCount > 65535'
    );

    const inspected = inspectGlbBinaryMetrics(glbRes.glbBuffer);
    const exactVol = 18.4 * 18.4 * 1.0; // 338.56 m3
    assert.ok(
        Math.abs(inspected.tinVolumeM3 - exactVol) / exactVol < 0.005,
        `Volumen Uint32 (${inspected.tinVolumeM3}) debe igualar exacto (${exactVol})`
    );
});

test('(c) Walk-Ring Toe Solver bloquea inclinacion falsa tipo AC-9046 (12.66°) en cancha plana, recupera rampa 5% y garantiza zeroCellsInside=0', () => {
    // 1. Escenario adverso: ladera sesgada sobre cancha plana (sin groundSamplesM) + walkRing plano
    const flatConeWithHole = buildConeWithWalkRing({
        radiusM: 4.0,
        heightM: 2.5,
        slopeX: 0,
        slopeZ: 0,
        holeRadiusM: 0.65,
        includeGroundSamples: false,
    });
    // Introducir sesgo artificial en el borde (simula ladera recortada por ROI en un lado)
    const croppedHillsidePoints = flatConeWithHole.pointsM.filter(([x]) => x >= -2.4);

    const resFlat = computeSpatialStockpileVolume({
        pointsM: croppedHillsidePoints,
        walkRingPoses: flatConeWithHole.walkRing,
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
        loopDriftPct: 0.8,
        depthMode: 'KNOWN_POSE_MVS_OFFLINE',
    });

    assert.ok(
        resFlat.groundSlopeDeg <= 3.5,
        `Walk-Ring Toe Solver debe impedir inclinación espuria >3.5° en cancha plana (obtenido ${resFlat.groundSlopeDeg}°)`
    );
    assert.equal(
        resFlat.zeroCellsInside,
        0,
        `Relleno Delaunay debe eliminar todos los cráteres interiores (zeroCellsInside=${resFlat.zeroCellsInside})`
    );
    assert.ok(
        resFlat.surfaceGrid.cellSizeM >= 0.08 && resFlat.surfaceGrid.cellSizeM <= 0.25,
        `Grilla adaptativa en pilas reales debe estar en [0.08..0.25]m (obtenido ${resFlat.surfaceGrid.cellSizeM}m)`
    );
    assert.ok(
        resFlat.occludedVolumePct > 0,
        'Debe reportar occludedVolumePct > 0 cuando existió un hueco real rellenado por Delaunay'
    );

    // 2. Escenario cancha inclinada real al 5% (~2.86°) con Walk-Ring inclinado
    const inclined = buildConeWithWalkRing({
        radiusM: 3.5,
        heightM: 2.4,
        slopeX: 0.05,
        slopeZ: 0,
        holeRadiusM: 0.5,
        includeGroundSamples: true,
    });
    const exactInclinedVol = (1 / 3) * Math.PI * 3.5 * 3.5 * 2.4;
    const resInclined = computeSpatialStockpileVolume({
        pointsM: inclined.pointsM,
        groundSamplesM: inclined.groundSamplesM,
        walkRingPoses: inclined.walkRing,
        coveragePct: 96,
        sectorsCovered: 16,
        loopClosed: true,
        loopDriftPct: 0.5,
        hasScaleAnchor: true,
        depthMode: 'KNOWN_POSE_MVS_OFFLINE',
    });

    assert.ok(
        Math.abs(resInclined.groundSlopeDeg - 2.86) < 0.8,
        `Debe recuperar pendiente real ~2.86° (obtenido ${resInclined.groundSlopeDeg}°)`
    );
    assert.equal(resInclined.zeroCellsInside, 0);
    assert.equal(resInclined.metrologyGrade, 'VALID_IN_SITU');
    const volErrPct = (Math.abs(resInclined.volumeM3 - exactInclinedVol) / exactInclinedVol) * 100;
    assert.ok(
        volErrPct < 8,
        `Volumen con hueco rellenado sobre rampa 5% debe mantener error < 8% (${volErrPct.toFixed(2)}%)`
    );

    // 3. Escenario confinamiento contra muro SINGLE_WALL
    const wallPoints = flatConeWithHole.pointsM.filter(([, , z]) => z >= -1.0);
    // Agregar puntos de muro vertical en z = -1.0
    for (let x = -2.5; x <= 2.5; x += 0.25) {
        for (let y = 0.5; y <= 2.2; y += 0.25) {
            wallPoints.push([Number(x.toFixed(3)), Number(y.toFixed(3)), -1.0]);
        }
    }
    const wallGround = fitInclinedGroundPlane(wallPoints, [], null, {
        walkRingPoses: flatConeWithHole.walkRing,
        wallConfinement: 'SINGLE_WALL',
    });
    assert.ok(wallGround.wallPlane !== null, 'Debe detectar plano vertical de muro en SINGLE_WALL');
});

test('(d) Contratos Zod V2, perfil SPATIAL_SESSION_BUNDLE, purga endpoints legacy, collectVisualMediaParts CAS, idempotencia y conciliacion AuditLedger', async () => {
    dbCollections.clear();
    storedBlobs.clear();

    // 1. Perfil CAS SPATIAL_SESSION_BUNDLE
    assert.equal(MediaDigestionProfileSchema.parse('SPATIAL_SESSION_BUNDLE'), 'SPATIAL_SESSION_BUNDLE');
    const bundleDigested = await MediaDigestorServer.digestAny(
        Buffer.from(JSON.stringify({ sessionId: 'sess-001', ok: true })),
        'application/json',
        'SPATIAL_SESSION_BUNDLE'
    );
    assert.equal(bundleDigested.profile, 'SPATIAL_SESSION_BUNDLE');
    assert.match(bundleDigested.sha256, /^[a-f0-9]{64}$/);

    // 2. Conciliación determinista: AUTO_CONCILIATED vs REQUIRES_HITL_REVIEW
    const autoRec = evaluateStockpileReconciliation({
        offlineInSituM3: 42.0,
        inSituUncertaintyPct: 6.0,
        cloudRefinedM3: 44.5, // +5.95% <= max(8%, 6%)
    });
    assert.equal(autoRec.status, 'AUTO_CONCILIATED');
    assert.equal(autoRec.activeSource, 'CLOUD_REFINED');
    assert.equal(autoRec.withinTolerance, true);

    const hitlRec = evaluateStockpileReconciliation({
        offlineInSituM3: 42.0,
        inSituUncertaintyPct: 6.0,
        cloudRefinedM3: 52.0, // +23.81% > 8%
    });
    assert.equal(hitlRec.status, 'REQUIRES_HITL_REVIEW');
    assert.equal(hitlRec.activeSource, 'IN_SITU_OFFLINE');
    assert.equal(hitlRec.withinTolerance, false);

    // 3. Verificación de rutas purgadas y nuevas rutas V2 en geolapp.controller
    const routerStack = (geolappController.default as any).stack as Array<any>;
    for (const removed of [
        '/stockpiles/:id/ai-enrich',
        '/digital-analyze',
        '/stockpiles/:id/digital-analyze',
        '/device-catalog',
        '/device-catalog/check',
    ]) {
        const found = routerStack.some((l) => l.route?.path === removed);
        assert.equal(found, false, `Endpoint legacy ${removed} debe haber sido eliminado`);
    }

    const postSessionLayer = routerStack.find(
        (l) => l.route?.path === '/stockpiles/:id/capture-sessions' && l.route.methods.post
    );
    const getSessionLayer = routerStack.find(
        (l) => l.route?.path === '/stockpiles/:id/capture-sessions/:sessionId' && l.route.methods.get
    );
    assert.ok(postSessionLayer?.route, 'Debe existir POST /stockpiles/:id/capture-sessions');
    assert.ok(getSessionLayer?.route, 'Debe existir GET /stockpiles/:id/capture-sessions/:sessionId');

    // 4. collectVisualMediaParts con URL CAS interna (/api/media/blob/tenant/...) y bloqueo cross-tenant
    const fakeSha = 'a'.repeat(64);
    storedBlobs.set(`cas_blobs/tenants/tenant-alpha/${fakeSha}.webp`, {
        buffer: Buffer.from('synthetic-webp-image-bytes'),
        contentType: 'image/webp',
    });
    const allowedMedia = await geolappController.collectVisualMediaParts({
        tenantId: 'tenant-alpha',
        photoUrl: `/api/media/blob/tenant/tenant-alpha/${fakeSha}.webp`,
    });
    assert.equal(allowedMedia.length, 1, 'Debe cargar blob CAS interno del propio tenant');
    assert.equal(allowedMedia[0].mimeType, 'image/webp');

    const crossTenantMedia = await geolappController.collectVisualMediaParts({
        tenantId: 'tenant-bravo',
        photoUrl: `/api/media/blob/tenant/tenant-alpha/${fakeSha}.webp`,
    });
    assert.equal(crossTenantMedia.length, 0, 'Debe bloquear lectura CAS cross-tenant');

    // 5. /reconstruct-3d sin GPU debe responder 422 (prohibido fallback a cono sintético)
    getColMap('accounts').set('tenant-alpha', {
        id: 'tenant-alpha',
        ownerId: 'uid-alpha',
        status: 'ACTIVE',
    });
    getColMap('stockpiles').set('stk-v2-1', {
        id: 'stk-v2-1',
        tenantId: 'tenant-alpha',
        accountId: 'tenant-alpha',
        name: 'ACOPIO V2 NORTE',
        density_factor: 1.85,
        status: 'ACTIVE',
    });

    const prevGpuUrl = process.env.GEOLAPP_MAST3R_GPU_URL;
    delete process.env.GEOLAPP_MAST3R_GPU_URL;
    const recRes = createMockResponse();
    await geolappController.postGeolappReconstruct3d(
        {
            params: { id: 'stk-v2-1' },
            user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
            headers: { 'x-active-account-id': 'tenant-alpha' },
            body: { geometryType: 'CONO_ELIPTICO', dimensions: { a: 6, b: 6, h: 2.5 } },
        } as any,
        recRes
    );
    if (prevGpuUrl !== undefined) process.env.GEOLAPP_MAST3R_GPU_URL = prevGpuUrl;
    assert.equal(recRes.statusCode, 422, 'reconstruct-3d sin GPU real debe fallar cerrado con HTTP 422');
    assert.equal(recRes.bodyPayload?.error, 'NO_REAL_3D_RECONSTRUCTION_AVAILABLE');

    // 6. Flujo E2E POST/GET /capture-sessions: AUTO_CONCILIATED, idempotencia, persistencia simétrica y REQUIRES_HITL_REVIEW
    const postHandler = postSessionLayer.route.stack[postSessionLayer.route.stack.length - 1].handle;
    const getHandler = getSessionLayer.route.stack[getSessionLayer.route.stack.length - 1].handle;

    const coneData = buildConeWithWalkRing({
        radiusM: 3.0,
        heightM: 2.4,
        includeGroundSamples: true,
    });
    const expectedVol = computeSpatialStockpileVolume({
        pointsM: coneData.pointsM,
        groundSamplesM: coneData.groundSamplesM,
        walkRingPoses: coneData.walkRing,
        coveragePct: 95,
        sectorsCovered: 16,
        loopClosed: true,
    }).volumeM3;

    const validPackage = CaptureSessionPackageV2Schema.parse({
        schemaVersion: '2.0',
        sessionId: 'sess_auto_001',
        measurementId: 'meas_auto_001',
        capturedAt: Date.now(),
        keyframes: [
            {
                index: 0,
                sha256: fakeSha,
                downloadUrl: `/api/media/blob/tenant/tenant-alpha/${fakeSha}.webp`,
                mimeType: 'image/webp',
                originalBytes: 500000,
                optimizedBytes: 95000,
                savingsPct: 81.0,
                poseSE3: { tx: 4, ty: 1.45, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
                intrinsics: { fx: 900, fy: 900, cx: 640, cy: 360, widthPx: 1280, heightPx: 720 },
            },
        ],
        walkRing: coneData.walkRing,
        pointsM: coneData.pointsM,
        groundSamplesM: coneData.groundSamplesM,
        inSituMetrology: {
            volumeM3: Number((expectedVol * 0.97).toFixed(2)), // ~3% diff => AUTO_CONCILIATED
            uncertaintyPct: 6.5,
            toeScore: 88,
            occludedVolumePct: 2.0,
            zeroCellsInside: 0,
            loopDriftPct: 0.6,
            groundSlopeDeg: 0.4,
            planeMismatchDeg: 0.2,
            slopeAngleAvgDeg: 38.0,
            dimensionsM: { a: 6.0, b: 6.0, h: 2.3 },
            metrologyGrade: 'VALID_IN_SITU',
            coveragePct: 95,
            sectorsCovered: 16,
            sectorsTotal: 16,
            loopClosed: true,
            computedAt: Date.now(),
            engineVersion: 'acopios-offline-v2',
        },
    });

    const auditCalls: any[] = [];
    const origAuditRecord = AuditLedger.record;
    (AuditLedger as any).record = async (entry: any) => {
        auditCalls.push(entry);
        return `audit-${auditCalls.length}`;
    };

    try {
        // 6a. Primera ejecución -> AUTO_CONCILIATED
        const res1 = createMockResponse();
        await postHandler(
            {
                params: { id: 'stk-v2-1' },
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha', 'idempotency-key': 'sess_auto_001' },
                body: validPackage,
            },
            res1,
            () => {}
        );
        assert.equal(res1.statusCode, 200);
        assert.equal(res1.bodyPayload?.idempotentHit, false);
        assert.equal(res1.bodyPayload?.lifecycle_status, 'CLOUD_3D_VERIFIED');
        assert.equal(res1.bodyPayload?.reconciliation_status, 'AUTO_CONCILIATED');
        assert.equal(res1.bodyPayload?.active_volume_source, 'CLOUD_REFINED');

        // Verificar persistencia simétrica de TODAS las métricas mesh_* en stockpile y measurement
        const stkDoc = getColMap('stockpiles').get('stk-v2-1');
        const measDoc = getColMap('stockpiles/stk-v2-1/measurements').get('meas_auto_001');
        for (const field of [
            'mesh_url',
            'mesh_sha256',
            'mesh_source',
            'mesh_original_bytes',
            'mesh_optimized_bytes',
            'mesh_savings_pct',
            'mesh_vertex_count',
            'mesh_triangle_count',
            'mesh_bounding_box_m',
        ]) {
            assert.ok(stkDoc?.[field] !== undefined, `stockpiles debe persistir ${field}`);
            assert.deepEqual(
                measDoc?.[field],
                stkDoc?.[field],
                `measurements debe persistir simétricamente ${field}`
            );
        }

        // 6b. Reenvío idempotente -> idempotentHit=true sin duplicar AuditLedger
        const auditCountBefore = auditCalls.length;
        const resIdem = createMockResponse();
        await postHandler(
            {
                params: { id: 'stk-v2-1' },
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha', 'idempotency-key': 'sess_auto_001' },
                body: validPackage,
            },
            resIdem,
            () => {}
        );
        assert.equal(resIdem.statusCode, 200);
        assert.equal(resIdem.bodyPayload?.idempotentHit, true);
        assert.equal(auditCalls.length, auditCountBefore, 'Idempotencia no debe duplicar AuditLedger');

        // 6c. GET /capture-sessions/:sessionId
        const getRes = createMockResponse();
        await getHandler(
            {
                params: { id: 'stk-v2-1', sessionId: 'sess_auto_001' },
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha' },
            },
            getRes,
            () => {}
        );
        assert.equal(getRes.statusCode, 200);
        assert.equal(getRes.bodyPayload?.session?.sessionId, 'sess_auto_001');

        // 6d. Divergencia grande (> max(8%, unc)) -> REQUIRES_HITL_REVIEW sin sobrescribir offline_in_situ_m3
        const hitlPayload = {
            ...validPackage,
            sessionId: 'sess_hitl_002',
            measurementId: 'meas_hitl_002',
            inSituMetrology: {
                ...validPackage.inSituMetrology,
                volumeM3: Number((expectedVol * 0.55).toFixed(2)), // ~81% diff => REQUIRES_HITL_REVIEW
                uncertaintyPct: 7.0,
            },
        };
        const resHitl = createMockResponse();
        await postHandler(
            {
                params: { id: 'stk-v2-1' },
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha', 'idempotency-key': 'sess_hitl_002' },
                body: hitlPayload,
            },
            resHitl,
            () => {}
        );
        assert.equal(resHitl.statusCode, 200);
        assert.equal(resHitl.bodyPayload?.reconciliation_status, 'REQUIRES_HITL_REVIEW');
        assert.equal(resHitl.bodyPayload?.active_volume_source, 'IN_SITU_OFFLINE');
        const stkAfterHitl = getColMap('stockpiles').get('stk-v2-1');
        assert.equal(
            stkAfterHitl?.volumen_m3,
            hitlPayload.inSituMetrology.volumeM3,
            'REQUIRES_HITL_REVIEW no debe sobrescribir offline_in_situ_m3'
        );
        assert.ok(
            auditCalls.some(
                (a) =>
                    a.action === 'STOCKPILE_CLOUD_RECONCILIATION' &&
                    a.details?.sessionId === 'sess_hitl_002' &&
                    a.details?.reconciliationStatus === 'REQUIRES_HITL_REVIEW'
            ),
            'Debe auditar STOCKPILE_CLOUD_RECONCILIATION en AuditLedger'
        );
    } finally {
        (AuditLedger as any).record = origAuditRecord;
    }
});

test('(e) Interoperabilidad Cross-Contract Android + Frontend verbatim -> CaptureSessionPackageV2Schema -> POST /capture-sessions', async () => {
    dbCollections.clear();
    storedBlobs.clear();

    getColMap('accounts').set('tenant-cross', {
        id: 'tenant-cross',
        ownerId: 'uid-cross',
        status: 'ACTIVE',
    });
    getColMap('stockpiles').set('stk-cross-1', {
        id: 'stk-cross-1',
        tenantId: 'tenant-cross',
        accountId: 'tenant-cross',
        name: 'ACOPIO CROSS CONTRACT',
        density_factor: 1.9,
        status: 'ACTIVE',
    });

    const kfSha = 'b'.repeat(64);
    const bundleSha = 'c'.repeat(64);
    const cols = 6;
    const rows = 6;
    const heightsM = new Array<number>(cols * rows).fill(1.5);
    const observedMask = new Array<number>(cols * rows).fill(1);
    observedMask[2 * cols + 2] = 0; // 1 celda interpolada

    // Payload exacto estilo Android + Frontend (matriz SE3 3x3, width/height, remoteCasUrl, walkRingPoses, cols/rows/observedMask, rawSpatialBundle, baseLengthM/groundPlane)
    const androidFrontendVerbatimPayload = {
        schemaVersion: '2.0',
        sessionId: 'sess_cross_android_001',
        measurementId: 'meas_cross_android_001',
        capturedAt: Date.now(),
        keyframes: [
            {
                index: 0,
                sha256: kfSha,
                remoteCasUrl: `/api/media/blob/tenant/tenant-cross/${kfSha}.webp`,
                mimeType: 'image/webp',
                originalBytes: 420000,
                optimizedBytes: 84000,
                savingsPct: 80.0,
                imuPitchDeg: -14.5,
                displayRotationDeg: 90,
                poseSE3: {
                    r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                    t: [3.2, 1.45, 0.1],
                },
                intrinsics: {
                    fx: 920,
                    fy: 920,
                    cx: 640,
                    cy: 360,
                    width: 1280,
                    height: 720,
                },
            },
        ],
        walkRingPoses: [
            { x: 3.0, y: 1.45, z: 0.0, fx: -1, fy: 0, fz: 0, ts: 1732150000100 },
            { x: 0.0, y: 1.45, z: 3.0, fx: 0, fy: 0, fz: -1, ts: 1732150001100 },
            { x: -3.0, y: 1.45, z: 0.0, fx: 1, fy: 0, fz: 0, ts: 1732150002100 },
            { x: 0.0, y: 1.45, z: -3.0, fx: 0, fy: 0, fz: 1, ts: 1732150003100 },
        ],
        rawSpatialBundle: {
            sha256: bundleSha,
            remoteCasUrl: `/api/media/blob/tenant/tenant-cross/${bundleSha}.json`,
            originalBytes: 180000,
            optimizedBytes: 64000,
            savingsPct: 64.4,
        },
        inSituMetrology: {
            volumeM3: 1.5, // exacto para 5*0.2 * 5*0.2 * 1.5 = 1.50 m3
            uncertaintyPct: 6.2,
            toeScore: 84,
            baseLengthM: 1.0,
            baseWidthM: 1.0,
            heightMaxM: 1.5,
            groundPlane: { a: 0, b: 0, d: 0, slopeDeg: 0.3 },
            metrologyGrade: 'VALID_IN_SITU',
        },
        localPreviewMesh: {
            format: 'dem_grid_v1',
            originX: -0.5,
            originZ: -0.5,
            cellSizeM: 0.2,
            cols,
            rows,
            heightsM,
            observedMask,
            groundSlopeDeg: 0.3,
        },
    };

    const parsed = CaptureSessionPackageV2Schema.parse(androidFrontendVerbatimPayload);
    assert.equal(parsed.keyframes[0].downloadUrl, `/api/media/blob/tenant/tenant-cross/${kfSha}.webp`);
    assert.equal(parsed.keyframes[0].intrinsics.widthPx, 1280);
    assert.equal(parsed.keyframes[0].intrinsics.heightPx, 720);
    assert.equal(parsed.keyframes[0].poseSE3.tx, 3.2);
    assert.equal(parsed.keyframes[0].poseSE3.qw, 1);
    assert.equal(parsed.walkRing.length, 4);
    assert.equal(parsed.rawBundleSha256, bundleSha);
    assert.equal(parsed.localPreviewMesh?.nx, 6);
    assert.equal(parsed.localPreviewMesh?.nz, 6);
    assert.equal(parsed.localPreviewMesh?.interpolatedMask?.[2 * cols + 2], 1);
    assert.equal(parsed.inSituMetrology.dimensionsM.h, 1.5);

    const routerStack = (geolappController.default as any).stack as Array<any>;
    const postSessionLayer = routerStack.find(
        (l) => l.route?.path === '/stockpiles/:id/capture-sessions' && l.route.methods.post
    );
    const postHandler = postSessionLayer.route.stack[postSessionLayer.route.stack.length - 1].handle;

    const origAuditRecord = AuditLedger.record;
    (AuditLedger as any).record = async () => 'audit-cross-1';
    try {
        const res = createMockResponse();
        await postHandler(
            {
                params: { id: 'stk-cross-1' },
                user: { uid: 'uid-cross', email: 'op@cross.cl', email_verified: true },
                headers: {
                    'x-active-account-id': 'tenant-cross',
                    'idempotency-key': 'sess_cross_android_001',
                },
                body: androidFrontendVerbatimPayload,
            },
            res,
            () => {}
        );
        assert.equal(res.statusCode, 200, `Esperado HTTP 200, obtenido ${res.statusCode}: ${JSON.stringify(res.bodyPayload)}`);
        assert.equal(res.bodyPayload?.reconciliation_status, 'AUTO_CONCILIATED');
        assert.equal(res.bodyPayload?.cloud_refined_m3, 1.5);
        assert.equal(res.bodyPayload?.cloud_refined?.volume_m3, 1.5);
        assert.equal(res.bodyPayload?.reconciliation_delta_pct, 0);
        assert.equal(res.bodyPayload?.reconciliation?.deltaPct, 0);

        // Validar que el hit idempotente también incluye los alias raíz cloud_refined_m3 y reconciliation_delta_pct
        const resIdem = createMockResponse();
        await postHandler(
            {
                params: { id: 'stk-cross-1' },
                user: { uid: 'uid-cross', email: 'op@cross.cl', email_verified: true },
                headers: {
                    'x-active-account-id': 'tenant-cross',
                    'idempotency-key': 'sess_cross_android_001',
                },
                body: androidFrontendVerbatimPayload,
            },
            resIdem,
            () => {}
        );
        assert.equal(resIdem.statusCode, 200);
        assert.equal(resIdem.bodyPayload?.idempotentHit, true);
        assert.equal(resIdem.bodyPayload?.cloud_refined_m3, 1.5);
        assert.equal(resIdem.bodyPayload?.reconciliation_delta_pct, 0);
    } finally {
        (AuditLedger as any).record = origAuditRecord;
    }
});
