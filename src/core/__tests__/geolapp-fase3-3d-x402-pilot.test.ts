/**
 * Suite Sandbox-Safe — GEOLAPP® Fase 3 (Gemelo 3D .glb, Rosin-Rammler, M2M x402 y Aislamiento Pilot)
 * Ejecutable vía: ./node_modules/.bin/ts-node src/core/__tests__/geolapp-fase3-3d-x402-pilot.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.DEV_ROOT_PASSWORD ||= 'TestDevRootPassword2026!';
process.env.SUPER_ADMIN_EMAIL ||= 'admin@minreport.com';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';

const ROOT = path.resolve(__dirname, '../../..');
const WEB_SRC = path.join(ROOT, 'web/src');

// ---------------------------------------------------------------------------
// Stubs en memoria para Firebase Admin antes de importar controladores/middlewares
// ---------------------------------------------------------------------------
const dbCollections = new Map<string, Map<string, Record<string, any>>>();

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
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
            return createCollectionRef(`${colPath}/${docId}/${subName}`);
        },
        async get() {
            const data = getCollectionMap(colPath).get(docId);
            return {
                id: docId,
                exists: Boolean(data),
                data: () => (data ? { ...data } : undefined),
            };
        },
        async set(payload: Record<string, any>, options?: { merge?: boolean }) {
            const col = getCollectionMap(colPath);
            const prev = options?.merge && col.has(docId) ? col.get(docId) : {};
            col.set(docId, { ...prev, ...payload });
        },
        async update(patch: Record<string, any>) {
            const col = getCollectionMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...patch });
        },
    };
}

function createQueryChain(
    colPath: string,
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    maxLimit = 500
): any {
    return {
        where(field: string, op: string, value: unknown) {
            return createQueryChain(colPath, [...filters, { field, op, value }], maxLimit);
        },
        orderBy() {
            return createQueryChain(colPath, filters, maxLimit);
        },
        limit(n: number) {
            return createQueryChain(colPath, filters, n);
        },
        async get() {
            const docs = Array.from(getCollectionMap(colPath).entries())
                .filter(([, d]) =>
                    filters.every((f) => {
                        if (f.op === '==') return d[f.field] === f.value;
                        return true;
                    })
                )
                .slice(0, maxLimit)
                .map(([id, data]) => ({
                    id,
                    exists: true,
                    data: () => ({ ...data }),
                }));
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    };
}

function createCollectionRef(colPath: string): any {
    const baseChain = createQueryChain(colPath);
    return {
        doc(id?: string) {
            const docId = id || `auto_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            return createDocRef(colPath, docId);
        },
        where: baseChain.where,
        orderBy: baseChain.orderBy,
        limit: baseChain.limit,
        get: baseChain.get,
    };
}

const tokenRegistry = new Map<string, Record<string, any>>();

const mockDb = {
    collection: (name: string) => createCollectionRef(name),
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

const mockFirestoreNamespace: any = () => mockDb;
mockFirestoreNamespace.FieldValue = {
    delete: () => Symbol('delete'),
    serverTimestamp: () => Symbol('serverTimestamp'),
    increment: (n: number) => n,
};
mockFirestoreNamespace.Timestamp = {
    now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
};

const mockAdmin = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: mockFirestoreNamespace,
    auth: () => ({
        verifyIdToken: async (token: string) => {
            const claims = tokenRegistry.get(token);
            if (!claims) throw new Error('Invalid test token');
            return claims;
        },
    }),
    storage: () => ({ bucket: () => ({ name: 'minreport-sandbox-test' }) }),
};

require.cache[require.resolve('../../config/firebase')] = {
    id: require.resolve('../../config/firebase'),
    filename: require.resolve('../../config/firebase'),
    loaded: true,
    exports: {
        __esModule: true,
        default: mockAdmin,
        db: mockDb,
        auth: mockAdmin.auth(),
        storage: mockAdmin.storage(),
    },
} as any;

const { MediaDigestionProfileSchema } =
    require('../../contracts/media.contracts') as typeof import('../../contracts/media.contracts');
const { MediaDigestorServer } =
    require('../../core/media/MediaDigestorServer') as typeof import('../../core/media/MediaDigestorServer');
const { buildServerStockpileGlbMesh } =
    require('../../modules/geolapp/glb-surface.builder') as typeof import('../../modules/geolapp/glb-surface.builder');
const { registerM2mGeolappAdapterRoutes } =
    require('../../api/m2m-geolapp.adapter') as typeof import('../../api/m2m-geolapp.adapter');
const pilotRouter = (require('../../api/pilot.controller') as { default: express.Router }).default;

// ---------------------------------------------------------------------------
// Loader TypeScript in-memory para módulos frontend sin romper rootDir ./src
// ---------------------------------------------------------------------------
const ts = require('typescript') as typeof import('typescript');
const moduleCache = new Map<string, any>();

function resolveTsFile(baseDir: string, spec: string): string {
    const raw = path.resolve(baseDir, spec);
    const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, path.join(raw, 'index.ts'), path.join(raw, 'index.tsx')];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
            return c;
        }
    }
    throw new Error(`No se encontro modulo TS: ${spec} desde ${baseDir}`);
}

function loadWebModule(absPath: string): any {
    const normalized = path.resolve(absPath);
    if (moduleCache.has(normalized)) {
        return moduleCache.get(normalized);
    }

    const source = fs.readFileSync(normalized, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: normalized,
    });

    const mod: { exports: Record<string, any> } = { exports: {} };
    moduleCache.set(normalized, mod.exports);

    const localRequire = (spec: string) => {
        if (spec.startsWith('.')) {
            const target = resolveTsFile(path.dirname(normalized), spec);
            return loadWebModule(target);
        }
        return require(spec);
    };

    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled.outputText);
    fn(mod.exports, localRequire, mod, normalized, path.dirname(normalized));
    moduleCache.set(normalized, mod.exports);
    return mod.exports;
}

function assertValidGlbChunks(glbBuf: Buffer, label: string): any {
    assert.ok(glbBuf.length >= 28, `${label}: GLB demasiado corto (${glbBuf.length}B)`);
    assert.equal(glbBuf.readUInt32LE(0), 0x46546c67, `${label}: magic debe ser 0x46546c67`);
    assert.equal(glbBuf.readUInt32LE(4), 2, `${label}: version glTF debe ser 2`);
    assert.equal(glbBuf.readUInt32LE(8), glbBuf.length, `${label}: longitud declarada debe coincidir con buffer`);

    const jsonLen = glbBuf.readUInt32LE(12);
    const jsonType = glbBuf.readUInt32LE(16);
    assert.equal(jsonLen % 4, 0, `${label}: chunk JSON debe estar alineado a 4 bytes`);
    assert.equal(jsonType, 0x4e4f534a, `${label}: chunk 0 tipo JSON`);
    assert.ok(20 + jsonLen + 8 <= glbBuf.length, `${label}: chunk JSON fuera de limites`);

    const jsonText = glbBuf.subarray(20, 20 + jsonLen).toString('utf8').trim();
    const gltf = JSON.parse(jsonText);
    assert.equal(gltf?.asset?.version, '2.0', `${label}: asset.version glTF 2.0`);

    const binHeaderOffset = 20 + jsonLen;
    const binLen = glbBuf.readUInt32LE(binHeaderOffset);
    const binType = glbBuf.readUInt32LE(binHeaderOffset + 4);
    assert.equal(binLen % 4, 0, `${label}: chunk BIN debe estar alineado a 4 bytes`);
    assert.equal(binType, 0x004e4942, `${label}: chunk 1 tipo BIN\\0`);
    assert.equal(binHeaderOffset + 8 + binLen, glbBuf.length, `${label}: chunk BIN exacto hasta EOF`);

    return gltf;
}

function listTsFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listTsFilesRecursive(full));
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

async function httpRequest(
    baseUrl: string,
    routePath: string,
    options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any; rawText: string }> {
    const targetUrl = new URL(routePath, baseUrl);
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: targetUrl.hostname,
                port: Number(targetUrl.port),
                path: `${targetUrl.pathname}${targetUrl.search}`,
                method: options.method || 'GET',
                headers: {
                    ...(payload
                        ? {
                              'Content-Type': 'application/json',
                              'Content-Length': Buffer.byteLength(payload),
                          }
                        : {}),
                    ...(options.headers || {}),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on('end', () => {
                    const rawText = Buffer.concat(chunks).toString('utf8');
                    let parsed: any = null;
                    try {
                        parsed = rawText ? JSON.parse(rawText) : null;
                    } catch {
                        parsed = null;
                    }
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        json: parsed,
                        rawText,
                    });
                });
            }
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function run() {
    let passedCases = 0;

    // =========================================================================
    // CASO 1: Validación glTF 2.0 .glb + Paridad V_TIN + CAS MESH_3D_GLB
    // =========================================================================
    const { CalculationEngine } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/services/calculation-engine.ts')
    );
    const { buildStockpileGlbMesh } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/utils/glbMeshBuilder.ts')
    );

    const calc = new CalculationEngine();
    assert.equal(MediaDigestionProfileSchema.parse('MESH_3D_GLB'), 'MESH_3D_GLB');

    const geometryParityCases: Array<{
        label: string;
        geometryType: string;
        dimensions: Record<string, number>;
        expectedVolumeM3: number;
        maxRelError: number;
    }> = [
        {
            label: 'CONO_ELIPTICO',
            geometryType: 'CONO_ELIPTICO',
            dimensions: { d1: 20, d2: 16, h: 6 },
            expectedVolumeM3: calc.calculateEllipticCone(20, 16, 6),
            maxRelError: 0.015,
        },
        {
            label: 'TRONCO_CONO_ELIPTICO',
            geometryType: 'TRONCO_CONO_ELIPTICO',
            dimensions: { d1: 24, d2: 18, d1p: 12, d2p: 9, h: 5 },
            expectedVolumeM3: calc.calculateTruncatedEllipticCone(24, 18, 12, 9, 5),
            maxRelError: 0.015,
        },
        {
            label: 'TRONCO_PIRAMIDAL',
            geometryType: 'TRONCO_PIRAMIDAL',
            dimensions: { baseLengthM: 20, baseWidthM: 12, crestLengthM: 10, crestWidthM: 4, heightM: 6 },
            expectedVolumeM3: calc.calculateWindrowVolume(20, 12, 6, 10, 4),
            maxRelError: 0.005,
        },
        {
            label: 'PILA_LONGITUDINAL_WINDROW',
            geometryType: 'PILA_LONGITUDINAL_WINDROW',
            dimensions: { baseLengthM: 30, baseWidthM: 10, heightM: 4 },
            expectedVolumeM3: calc.calculateWindrowVolume(30, 10, 4),
            maxRelError: 0.005,
        },
        {
            label: 'ACOPIO_CONTRA_MURO',
            geometryType: 'ACOPIO_CONTRA_MURO',
            dimensions: { lengthM: 18, widthFromWallM: 12, heightAtWallM: 5, wallAngleDeg: 60 },
            expectedVolumeM3: calc.calculateToeWallStockpileVolume(18, 12, 5, 60),
            maxRelError: 0.005,
        },
    ];

    for (const tc of geometryParityCases) {
        assert.ok(tc.expectedVolumeM3 > 0, `${tc.label}: volumen analítico > 0`);

        const serverRes = buildServerStockpileGlbMesh({
            geometryType: tc.geometryType,
            dimensions: tc.dimensions,
        });
        assertValidGlbChunks(serverRes.glbBuffer, `server/${tc.label}`);
        const serverRelErr = Math.abs(serverRes.tinVolumeM3 - tc.expectedVolumeM3) / tc.expectedVolumeM3;
        assert.ok(
            serverRelErr <= tc.maxRelError,
            `server/${tc.label}: V_TIN=${serverRes.tinVolumeM3} vs calc=${tc.expectedVolumeM3} (err=${serverRelErr})`
        );
        assert.ok(serverRes.rawUnindexedBytes > serverRes.optimizedGlbBytes, `${tc.label}: ahorro CAS`);

        const clientRes = buildStockpileGlbMesh({
            geometryType: tc.geometryType,
            dimensions: tc.dimensions,
        });
        assert.ok(clientRes !== null, `client/${tc.label}: debe generar GLB`);
        const clientBuf = Buffer.from(clientRes.glbBuffer);
        assertValidGlbChunks(clientBuf, `client/${tc.label}`);
        const clientRelErr = Math.abs(clientRes.tinVolumeM3 - tc.expectedVolumeM3) / tc.expectedVolumeM3;
        assert.ok(
            clientRelErr <= tc.maxRelError,
            `client/${tc.label}: V_TIN=${clientRes.tinVolumeM3} vs calc=${tc.expectedVolumeM3} (err=${clientRelErr})`
        );

        const digested = await MediaDigestorServer.digestAny(
            serverRes.glbBuffer,
            'model/gltf-binary',
            'MESH_3D_GLB'
        );
        assert.equal(digested.profile, 'MESH_3D_GLB');
        assert.equal(digested.extension, 'glb');
        assert.equal(digested.mimeType, 'model/gltf-binary');
        assert.equal(digested.originalBytes, serverRes.glbBuffer.length);
        assert.equal(digested.optimizedBytes, serverRes.glbBuffer.length);
        assert.match(digested.sha256, /^[a-f0-9]{64}$/);
    }

    // Fail-closed ante cotas faltantes o <= 0 y binario .glb corrupto
    assert.throws(() =>
        buildServerStockpileGlbMesh({ geometryType: 'CONO_ELIPTICO', dimensions: { d1: 0, d2: 10, h: 5 } })
    );
    assert.throws(() =>
        buildServerStockpileGlbMesh({ geometryType: 'CONO_ELIPTICO', dimensions: { d1: 12, h: 5 } })
    );
    assert.equal(
        buildStockpileGlbMesh({ geometryType: 'CONO_ELIPTICO', dimensions: { d1: -2, d2: 10, h: 5 } }),
        null
    );
    assert.equal(
        buildStockpileGlbMesh({ geometryType: 'TRONCO_PIRAMIDAL', dimensions: { baseLengthM: 10 } }),
        null
    );
    await assert.rejects(
        () => MediaDigestorServer.digestAny(Buffer.from('CORRUPT_BIN_12345'), 'model/gltf-binary', 'MESH_3D_GLB'),
        /invalido/i
    );
    await assert.rejects(
        () => MediaDigestorServer.digestAny(Buffer.alloc(10), 'model/gltf-binary', 'MESH_3D_GLB'),
        /invalido/i
    );

    passedCases++;
    console.log('PASS [1/4] glTF 2.0 .glb, paridad V_TIN en 5 geometrias, fail-closed y CAS MESH_3D_GLB');

    // =========================================================================
    // CASO 2: Matemática Rosin-Rammler (rosinRammler.ts)
    // =========================================================================
    const {
        computeRosinRammlerFromPercentiles,
        computeRosinRammlerFromBoxes,
    } = loadWebModule(path.join(WEB_SRC, 'modules/geolapp/core/utils/rosinRammler.ts'));

    const rrFromPct = computeRosinRammlerFromPercentiles({
        p80Mm: 160,
        p50Mm: 80,
        oversizeThresholdMm: 250,
    });
    assert.ok(rrFromPct !== null, 'computeRosinRammlerFromPercentiles debe resolver entrada valida');
    assert.equal(rrFromPct.p80_mm, 160);
    assert.equal(rrFromPct.p50_mm, 80);
    assert.ok(rrFromPct.p20_mm > 0 && rrFromPct.p20_mm < rrFromPct.p50_mm, 'P20 < P50 < P80');
    assert.ok(rrFromPct.xc_mm > rrFromPct.p50_mm && rrFromPct.xc_mm < rrFromPct.p80_mm, 'xc consistente (63.2%)');
    assert.ok(rrFromPct.uniformity_n > 0, 'Indice de uniformidad n > 0');
    assert.equal(rrFromPct.oversize_threshold_mm, 250);
    // Verificación identidad RRSB: R(x) = exp(-(x/xc)^n) => 1 - exp(-(p80/xc)^n) ~= 0.80 y p50 ~= 0.50
    const pass80 = 1 - Math.exp(-Math.pow(rrFromPct.p80_mm / rrFromPct.xc_mm, rrFromPct.uniformity_n));
    const pass50 = 1 - Math.exp(-Math.pow(rrFromPct.p50_mm / rrFromPct.xc_mm, rrFromPct.uniformity_n));
    const pass20 = 1 - Math.exp(-Math.pow(rrFromPct.p20_mm / rrFromPct.xc_mm, rrFromPct.uniformity_n));
    assert.ok(Math.abs(pass80 - 0.8) < 0.005, `pass80=${pass80}`);
    assert.ok(Math.abs(pass50 - 0.5) < 0.005, `pass50=${pass50}`);
    assert.ok(Math.abs(pass20 - 0.2) < 0.005, `pass20=${pass20}`);

    assert.equal(computeRosinRammlerFromPercentiles({ p80Mm: 80, p50Mm: 120 }), null);
    assert.equal(computeRosinRammlerFromPercentiles({ p80Mm: 100, p50Mm: 0 }), null);
    assert.equal(computeRosinRammlerFromPercentiles({ p80Mm: -10, p50Mm: 5 }), null);

    const boxes = [
        { box_2d: [100, 100, 130, 130] as [number, number, number, number], label: 'b1' }, // 30 * 5 = 150 mm
        { box_2d: [200, 200, 245, 245] as [number, number, number, number], label: 'b2' }, // 45 * 5 = 225 mm
        { box_2d: [300, 300, 360, 360] as [number, number, number, number], label: 'b3' }, // 60 * 5 = 300 mm (>= 250)
        { box_2d: [400, 400, 480, 480] as [number, number, number, number], label: 'b4' }, // 80 * 5 = 400 mm (>= 250)
    ];
    const rrFromBoxes = computeRosinRammlerFromBoxes(boxes, 5, 250);
    assert.ok(rrFromBoxes !== null, 'computeRosinRammlerFromBoxes debe ajustar curva con >= 2 cajas');
    assert.equal(rrFromBoxes.oversize_count, 2, 'Exactamente 2 colpas >= 250 mm');
    assert.equal(rrFromBoxes.source, 'VISION_BOX2D_SCALED');
    assert.ok(rrFromBoxes.p80_mm > rrFromBoxes.p50_mm && rrFromBoxes.p50_mm > rrFromBoxes.p20_mm);

    assert.equal(computeRosinRammlerFromBoxes([boxes[0]], 5, 250), null);
    assert.equal(computeRosinRammlerFromBoxes(boxes, 0, 250), null);
    assert.equal(computeRosinRammlerFromBoxes(boxes, -3, 250), null);

    passedCases++;
    console.log('PASS [2/4] Rosin-Rammler (percentiles + box_2d escaladas + rechazos fail-closed)');

    // =========================================================================
    // CASO 3: Adaptador M2M x402 sobre servidor HTTP Express real en 127.0.0.1
    // =========================================================================
    dbCollections.clear();
    tokenRegistry.clear();

    tokenRegistry.set('tok-b2b-alpha', {
        uid: 'uid-alpha',
        email: 'ops@alpha-cu.cl',
        email_verified: true,
        role: 'B2B_OPERATOR',
    });
    tokenRegistry.set('tok-dev-root', {
        uid: 'dev-master-root-uid',
        email: 'dev@minreport.com',
        email_verified: true,
        role: 'DEV_ROOT',
        isMasterDev: true,
    });
    tokenRegistry.set('tok-super-admin', {
        uid: 'super-admin-uid',
        email: 'admin@minreport.com',
        email_verified: true,
        role: 'SUPER_ADMIN',
        admin: true,
    });
    tokenRegistry.set('tok-pilot-1', {
        uid: 'uid-pilot-1',
        email: 'pilot1@faena.cl',
        email_verified: true,
        role: 'TEST_PILOT',
    });

    getCollectionMap('accounts').set('tenant-alpha', {
        ownerId: 'uid-alpha',
        status: 'ACTIVE',
        contract: { status: 'ACTIVE' },
    });
    getCollectionMap('users').set('uid-pilot-1', {
        role: 'TEST_PILOT',
        status: 'ACTIVE',
    });
    getCollectionMap('stockpiles').set('stk-demo', {
        tenantId: 'tenant-alpha',
        accountId: 'tenant-alpha',
        name: 'Acopio Norte RUT 11.222.333-4 +56987654321',
        clase: 'mineral',
        status: 'ACTIVE',
        copper_domain: 'OXIDO_CU',
        wet_weight_thm: 1850,
        dry_weight_tms: 1739,
        moisture_pct: 6.0,
        cu_total_pct: 1.25,
        cu_soluble_pct: 0.98,
        fine_cu_t: 21.74,
        mediciones: [],
        updatedAt: 1731600000000,
    });
    getCollectionMap('stockpiles/stk-demo/measurements').set('meas-latest', {
        timestamp: 1731600500000,
        volumen: 1005.31,
        tin_volume_m3: 1005.31,
        p80_mm: 52.4,
        mesh_sha256: 'b'.repeat(64),
        mesh_url: '/api/media/cas/b',
    });
    getCollectionMap('stockpiles').set('stk-bravo', {
        tenantId: 'tenant-bravo',
        accountId: 'tenant-bravo',
        name: 'Acopio Privado Bravo',
        copper_domain: 'SULFURO_PRIMARIO_CU',
    });

    const app = express();
    app.use(express.json());
    registerM2mGeolappAdapterRoutes(app);
    app.use('/api/pilot', pilotRouter);

    const server = await new Promise<http.Server>((resolve) => {
        const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });

    try {
        const port = (server.address() as AddressInfo).port;
        const baseUrl = `http://127.0.0.1:${port}`;

        // 3a. HTTP 402 Payment Required + WWW-Authenticate + PAYMENT-REQUIRED (Base64) sin pago en las 3 rutas M2M
        for (const m2mRoute of [
            '/api/m2m/data-feed',
            '/api/m2m/geolapp/stockpiles',
            '/api/m2m/geolapp/stockpiles/stk-demo/dossier',
        ]) {
            const res402 = await httpRequest(baseUrl, m2mRoute);
            assert.equal(res402.status, 402, `${m2mRoute} sin pago debe responder HTTP 402`);
            const wwwAuth = String(res402.headers['www-authenticate'] || '');
            assert.ok(wwwAuth.toLowerCase().includes('x402'), `${m2mRoute}: WWW-Authenticate debe indicar x402`);
            const paymentReqHeader = String(res402.headers['payment-required'] || '');
            assert.ok(paymentReqHeader.length > 0, `${m2mRoute}: debe emitir header PAYMENT-REQUIRED`);
            const parsedChallenge = JSON.parse(
                Buffer.from(paymentReqHeader, 'base64').toString('utf8')
            );
            assert.equal(parsedChallenge.x402Version, 1);
            assert.equal(parsedChallenge.scheme, 'exact');
            assert.equal(res402.json?.standard, 'x402 Foundation v1.0');
        }

        // 3b. Con contrato corporativo activo: validacion Zod limit 400 vs respuesta 200 + fallback measurements + PII scrub
        const corpHeaders = {
            Authorization: 'Bearer tok-b2b-alpha',
            'x-tenant-id': 'tenant-alpha',
        };
        for (const badLimit of ['abc', '0', '-5', '101']) {
            const badDf = await httpRequest(baseUrl, `/api/m2m/data-feed?limit=${badLimit}`, {
                headers: corpHeaders,
            });
            assert.equal(badDf.status, 400, `/api/m2m/data-feed?limit=${badLimit} debe retornar 400`);

            const badSp = await httpRequest(baseUrl, `/api/m2m/geolapp/stockpiles?limit=${badLimit}`, {
                headers: corpHeaders,
            });
            assert.equal(badSp.status, 400, `/api/m2m/geolapp/stockpiles?limit=${badLimit} debe retornar 400`);
        }

        const okDf = await httpRequest(baseUrl, '/api/m2m/data-feed?limit=10', { headers: corpHeaders });
        assert.equal(okDf.status, 200);
        assert.equal(okDf.json?.status, 'success');
        assert.equal(okDf.json?.protocol, 'x402');
        assert.equal(okDf.json?.region, 'southamerica-west1');
        assert.equal(okDf.json?.data?.tenantId, 'tenant-alpha');
        assert.equal(okDf.json?.data?.stockpiles?.length, 1);
        assert.equal(okDf.json?.data?.stockpiles?.[0]?.p80Mm, 52.4);
        assert.equal(okDf.json?.data?.stockpiles?.[0]?.meshSha256, 'b'.repeat(64));
        assert.ok(!String(okDf.json?.data?.stockpiles?.[0]?.name).includes('11.222.333-4'));

        const okSp = await httpRequest(baseUrl, '/api/m2m/geolapp/stockpiles?copperDomain=OXIDO_CU&limit=5', {
            headers: corpHeaders,
        });
        assert.equal(okSp.status, 200);
        assert.equal(okSp.json?.data?.total, 1);

        const okDos = await httpRequest(baseUrl, '/api/m2m/geolapp/stockpiles/stk-demo/dossier', {
            headers: corpHeaders,
        });
        assert.equal(okDos.status, 200);
        assert.equal(okDos.json?.data?.digitalTwin3d?.tinVolumeM3, 1005.31);

        const crossDos = await httpRequest(baseUrl, '/api/m2m/geolapp/stockpiles/stk-bravo/dossier', {
            headers: corpHeaders,
        });
        assert.equal(crossDos.status, 403, 'Dossier cross-tenant debe retornar HTTP 403');

        passedCases++;
        console.log('PASS [3/4] Adaptador M2M x402 en 127.0.0.1 (402 + headers, Zod limit 400 y aislamiento tenant)');

        // =====================================================================
        // CASO 4: Aislamiento hermético (DEV/PILOT/B2B) + Higiene 3D WebGL
        // =====================================================================
        for (const blockedToken of ['tok-dev-root', 'tok-super-admin']) {
            const getRes = await httpRequest(baseUrl, '/api/pilot/feedback', {
                headers: { Authorization: `Bearer ${blockedToken}` },
            });
            assert.equal(getRes.status, 403, `${blockedToken} bloqueado con 403 en GET /api/pilot/feedback`);

            const postRes = await httpRequest(baseUrl, '/api/pilot/feedback', {
                method: 'POST',
                headers: { Authorization: `Bearer ${blockedToken}` },
                body: { module: 'geolapp', category: 'BUG_CORRECTION', observation: 'Test' },
            });
            assert.equal(postRes.status, 403, `${blockedToken} bloqueado con 403 en POST /api/pilot/feedback`);

            const extRes = await httpRequest(baseUrl, '/api/pilot/feedback/extract-wisdom', {
                method: 'POST',
                headers: { Authorization: `Bearer ${blockedToken}` },
                body: { module: 'geolapp', rawNarrative: 'Relato tecnico de prueba' },
            });
            assert.equal(
                extRes.status,
                403,
                `${blockedToken} bloqueado con 403 en POST /api/pilot/feedback/extract-wisdom`
            );
        }

        const pilotGetRes = await httpRequest(baseUrl, '/api/pilot/feedback', {
            headers: { Authorization: 'Bearer tok-pilot-1' },
        });
        assert.equal(pilotGetRes.status, 200, 'TEST_PILOT acreditado accede a GET /api/pilot/feedback');
    } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    const devVaultSrc = fs.readFileSync(path.join(WEB_SRC, 'pages/dev/DevVaultGateway.tsx'), 'utf8');
    assert.ok(devVaultSrc.includes("'PILOT_METRICS'"), "DevVaultGateway.tsx debe incluir 'PILOT_METRICS'");
    assert.ok(devVaultSrc.includes('pilot-metrics'), 'DevVaultGateway.tsx debe invocar /api/dev/pilot-metrics');
    assert.equal(
        devVaultSrc.includes('pilot_feedback'),
        false,
        "DevVaultGateway.tsx debe tener 0 ocurrencias de 'pilot_feedback'"
    );

    const pilotWsSrc = fs.readFileSync(path.join(WEB_SRC, 'pages/pilot/TestPilotWorkspace.tsx'), 'utf8');
    assert.ok(
        pilotWsSrc.includes('TestPilotAiStudio'),
        'TestPilotWorkspace.tsx debe importar TestPilotAiStudio'
    );

    const clientLayoutSrc = fs.readFileSync(path.join(WEB_SRC, 'layouts/ClientLayout.tsx'), 'utf8');
    assert.equal(
        clientLayoutSrc.includes('TestPilotAiStudio'),
        false,
        'ClientLayout.tsx no debe importar TestPilotAiStudio'
    );
    assert.equal(
        devVaultSrc.includes('TestPilotAiStudio'),
        false,
        'DevVaultGateway.tsx no debe importar TestPilotAiStudio'
    );

    const isolatedDirs = [
        path.join(WEB_SRC, 'modules/opermaq'),
        path.join(WEB_SRC, 'modules/geolapp'),
    ];
    for (const dir of isolatedDirs) {
        for (const filePath of listTsFilesRecursive(dir)) {
            const content = fs.readFileSync(filePath, 'utf8');
            assert.equal(
                content.includes('TestPilotAiStudio'),
                false,
                `Prohibido importar TestPilotAiStudio en ${filePath}`
            );
        }
    }

    const twin3dSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/StockpileTwin3D.tsx'),
        'utf8'
    );
    assert.ok(twin3dSrc.includes('.dispose()'), 'StockpileTwin3D.tsx debe invocar .dispose()');
    assert.ok(
        twin3dSrc.includes('renderer.dispose()'),
        'StockpileTwin3D.tsx debe invocar renderer.dispose()'
    );
    assert.ok(
        twin3dSrc.includes('forceContextLoss()'),
        'StockpileTwin3D.tsx debe invocar forceContextLoss()'
    );

    const twin3dLazySrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/StockpileTwin3DLazy.tsx'),
        'utf8'
    );
    assert.ok(twin3dLazySrc.includes('React.lazy'), 'StockpileTwin3DLazy.tsx debe usar React.lazy');
    assert.ok(
        twin3dLazySrc.includes('M3LinearProgress'),
        'StockpileTwin3DLazy.tsx debe usar M3LinearProgress en Suspense'
    );

    passedCases++;
    console.log('PASS [4/4] Aislamiento hermetico (DEV/PILOT/B2B) + higiene GPU 3D-DIGITAL-TWIN');
    console.log(`\nALL_PASSED ${passedCases}/4 geolapp-fase3-3d-x402-pilot tests`);
}

run().catch((err) => {
    console.error('FAIL geolapp-fase3-3d-x402-pilot.test.ts:', err);
    process.exit(1);
});
