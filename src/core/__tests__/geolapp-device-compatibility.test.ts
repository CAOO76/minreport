import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';
process.env.SUPER_ADMIN_EMAIL ||= 'admin@minreport.com';

const dbCollections = new Map<string, Map<string, Record<string, any>>>();

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
            storage: () => ({ bucket: () => ({ name: 'minreport-sandbox-test' }) }),
        },
        db: mockDb,
        auth: { verifyIdToken: async () => ({}) },
        storage: { bucket: () => ({ name: 'minreport-sandbox-test' }) },
        messaging: {},
    },
} as any;

const { AuditLedger } =
    require('../../core/audit-ledger') as typeof import('../../core/audit-ledger');
const {
    CATALOG_AUTO_REFRESH_TTL_MS,
    CURATED_RUGGED_BASELINE,
    SpatialDeviceCatalogSchema,
    SpatialCatalogValidationError,
    buildBaselineSpatialDeviceCatalog,
    clearSpatialDeviceCatalogCache,
    getPendingCatalogAutoRefresh,
    getSpatialDeviceCatalog,
    importGooglePlayDeviceCatalogCsv,
    parseGooglePlayDeviceCatalogCsv,
    parseOfficialArCoreDevicesHtml,
    syncSpatialDeviceCatalogFromOfficialSources,
} = require('../../modules/geolapp/device-compatibility.service') as typeof import('../../modules/geolapp/device-compatibility.service');
const geolappController =
    require('../../api/geolapp.controller') as typeof import('../../api/geolapp.controller');
const { buildServerStockpileGlbMesh } =
    require('../../modules/geolapp/glb-surface.builder') as typeof import('../../modules/geolapp/glb-surface.builder');

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

function buildSyntheticArCoreHtml(count: number): string {
    const rows: string[] = [
        '<tr><td>Samsung</td><td>Galaxy XCover 7 (SM-G556B)</td><td>Supports Depth API</td></tr>',
        '<tr><td>Samsung</td><td>Galaxy S24 Ultra (SM-S928B)</td><td>Supports Depth API</td></tr>',
        '<tr><td>Doogee</td><td>Doogee V30 Pro</td><td>Supports Depth API</td></tr>',
        '<tr><td>Xiaomi</td><td>Redmi Note 13</td><td>ARCore supported</td></tr>',
    ];
    for (let i = rows.length; i < count; i++) {
        const depthNote = i % 3 === 0 ? 'Supports Depth API' : 'ARCore supported';
        rows.push(`<tr><td>Vendor${i}</td><td>Model-${i} (V${i}00)</td><td>${depthNote}</td></tr>`);
    }
    return `
        <html><body>
            <table>
                <thead><tr><th>Manufacturer</th><th>Device model</th><th>Comments</th></tr></thead>
                <tbody>${rows.join('\n')}</tbody>
            </table>
        </body></html>
    `;
}

test('CURATED_RUGGED_BASELINE incluye Samsung Galaxy XCover 7 (SM-G556B), flagships, iPhone LiDAR e incompatibles', async () => {
    dbCollections.clear();
    clearSpatialDeviceCatalogCache();

    const xcover7 = CURATED_RUGGED_BASELINE.find(
        (d) => d.manufacturer === 'Samsung' && d.model === 'Galaxy XCover 7'
    );
    assert.ok(xcover7, 'Debe incluir Samsung Galaxy XCover 7 en baseline');
    assert.equal(xcover7.deviceCode, 'SM-G556B');
    assert.equal(xcover7.platform, 'ANDROID');
    assert.equal(xcover7.arSupported, true);
    assert.equal(xcover7.depthSupported, true);
    assert.equal(xcover7.lidarSupported, false);
    assert.equal(xcover7.rugged, true);
    assert.equal(xcover7.ruggedRating, 'IP68 · MIL-STD-810H');
    assert.equal(xcover7.tier, 'OPTIMAL_SPATIAL');

    const catalog = await getSpatialDeviceCatalog();
    const parsed = SpatialDeviceCatalogSchema.safeParse(catalog);
    assert.equal(parsed.success, true, 'El catálogo baseline debe validar contra Zod');
    assert.ok(
        catalog.devices.some((d) => d.model === 'iPhone 16 Pro Max' && d.lidarSupported && d.tier === 'OPTIMAL_SPATIAL')
    );
    assert.ok(
        catalog.devices.some((d) => d.model === 'iPhone 12 Pro' && d.lidarSupported && d.tier === 'OPTIMAL_SPATIAL')
    );
    assert.ok(
        catalog.devices.some((d) => d.tier === 'INCOMPATIBLE' && !d.arSupported)
    );
});

test('parseOfficialArCoreDevicesHtml detecta Supports Depth API, codigos entre parentesis, rowspan y familias rugged', () => {
    const html = `
        <table>
            <tr><th>Summary</th><th>Value</th></tr>
            <tr><td>Region</td><td>southamerica-west1</td></tr>
        </table>
        <table>
            <thead>
                <tr><th>Manufacturer</th><th>Device model</th><th>Comments</th></tr>
            </thead>
            <tbody>
                <tr>
                    <td rowspan="3">Samsung</td>
                    <td>Galaxy XCover 7 (SM-G556B)</td>
                    <td>Supports Depth API</td>
                </tr>
                <tr>
                    <td>Galaxy A54 5G</td>
                    <td>ARCore supported without extra depth sensor</td>
                </tr>
                <tr>
                    <td>Galaxy S25 Ultra (SM-S938B)</td>
                    <td>Supports Depth API</td>
                </tr>
                <tr>
                    <td>Ulefone</td>
                    <td>Armor 24</td>
                    <td>Supports Depth API</td>
                </tr>
                <tr>
                    <td>Oukitel</td>
                    <td>WP30 Pro</td>
                    <td>Supports Depth API</td>
                </tr>
                <tr>
                    <td>Kyocera</td>
                    <td>DuraForce Ultra 5G</td>
                    <td>Does not support Depth API</td>
                </tr>
                <tr>
                    <td>Sonim</td>
                    <td>XP10</td>
                    <td>Supports Depth API</td>
                </tr>
                <tr>
                    <td>CAT</td>
                    <td>S75</td>
                    <td>Supports Depth API</td>
                </tr>
            </tbody>
        </table>
    `;

    const devices = parseOfficialArCoreDevicesHtml(html);
    assert.equal(devices.length, 8);

    const xcover7 = devices.find((d) => d.model === 'Galaxy XCover 7');
    assert.ok(xcover7);
    assert.equal(xcover7.deviceCode, 'SM-G556B');
    assert.equal(xcover7.depthSupported, true);
    assert.equal(xcover7.rugged, true);
    assert.equal(xcover7.tier, 'OPTIMAL_SPATIAL');

    const a54 = devices.find((d) => d.model === 'Galaxy A54 5G');
    assert.ok(a54);
    assert.equal(a54.depthSupported, false);
    assert.equal(a54.tier, 'COMPATIBLE_VIO');
    assert.equal(a54.rugged, false);

    const kyocera = devices.find((d) => d.manufacturer === 'Kyocera');
    assert.ok(kyocera);
    assert.equal(kyocera.rugged, true);
    assert.equal(kyocera.depthSupported, false);
    assert.equal(kyocera.tier, 'COMPATIBLE_VIO');

    for (const brand of ['Ulefone', 'Oukitel', 'Sonim', 'CAT']) {
        const entry = devices.find((d) => d.manufacturer === brand);
        assert.ok(entry, `Debe parsear ${brand}`);
        assert.equal(entry.rugged, true);
        assert.equal(entry.tier, 'OPTIMAL_SPATIAL');
    }
});

test('syncSpatialDeviceCatalogFromOfficialSources aplica Fail-Closed < 100 dispositivos sin sobrescribir Firestore y sincroniza >= 100', async () => {
    dbCollections.clear();
    clearSpatialDeviceCatalogCache();

    const auditCalls: any[] = [];
    const origRecord = AuditLedger.record;
    (AuditLedger as any).record = async (entry: any) => {
        auditCalls.push(entry);
        return 'audit-sync-1';
    };

    try {
        // 1. Sin doc en Firestore y remoto con < 100 dispositivos -> fallback a baseline, sin escribir Firestore
        const lowCountRes = await syncSpatialDeviceCatalogFromOfficialSources(
            { uid: 'dev-master-root-uid', email: 'dev@minreport.com' },
            {
                fetcher: async () =>
                    new Response(buildSyntheticArCoreHtml(12), { status: 200 }),
            }
        );
        assert.equal(lowCountRes.syncedFromRemote, false);
        assert.equal(lowCountRes.fallbackUsed, true);
        assert.ok(lowCountRes.warning && lowCountRes.warning.includes('< 100'));
        assert.equal(getColMap('system_config').has('spatial_device_catalog'), false);

        // 2. Sync válido con >= 100 dispositivos -> escribe system_config/spatial_device_catalog y registra AuditLedger
        const validSyncRes = await syncSpatialDeviceCatalogFromOfficialSources(
            { uid: 'dev-master-root-uid', email: 'dev@minreport.com', ipAddress: '127.0.0.1' },
            {
                fetcher: async () =>
                    new Response(buildSyntheticArCoreHtml(115), { status: 200 }),
            }
        );
        assert.equal(validSyncRes.syncedFromRemote, true);
        assert.equal(validSyncRes.fallbackUsed, false);
        assert.ok(validSyncRes.catalog.totalCount >= 115);
        assert.equal(getColMap('system_config').has('spatial_device_catalog'), true);
        assert.equal(auditCalls.length, 1);
        assert.equal(auditCalls[0].action, 'SPATIAL_DEVICE_CATALOG_SYNC');
        assert.equal(auditCalls[0].module, 'stockpile');

        const persistedHash = validSyncRes.catalog.sourceHash;
        const persistedCount = validSyncRes.catalog.totalCount;

        // 3. Falla posterior (HTTP 503) NO debe sobrescribir el documento válido existente en Firestore
        clearSpatialDeviceCatalogCache();
        const failedSyncRes = await syncSpatialDeviceCatalogFromOfficialSources(
            { uid: 'dev-master-root-uid', email: 'dev@minreport.com' },
            {
                fetcher: async () => new Response('Service Unavailable', { status: 503 }),
            }
        );
        assert.equal(failedSyncRes.syncedFromRemote, false);
        assert.equal(failedSyncRes.fallbackUsed, true);
        assert.equal(failedSyncRes.catalog.sourceHash, persistedHash);
        assert.equal(failedSyncRes.catalog.totalCount, persistedCount);
        const docAfterFail = getColMap('system_config').get('spatial_device_catalog');
        assert.equal(docAfterFail?.sourceHash, persistedHash);
    } finally {
        (AuditLedger as any).record = origRecord;
    }
});

test('parseGooglePlayDeviceCatalogCsv e importGooglePlayDeviceCatalogCsv validan filas y auditan', async () => {
    dbCollections.clear();
    clearSpatialDeviceCatalogCache();

    const csvLines = [
        'Retail Branding,Marketing Name,Device,Model Name',
        '"Samsung","Galaxy XCover 7","xcover7","SM-G556B"',
        '"Samsung","Galaxy S24 Ultra, 5G","e3q","SM-S928B"',
        '"Google","Pixel 9 Pro","caiman","Pixel 9 Pro"',
        '"CAT","CAT S75","s75","S75"',
        '"Doogee","Doogee V30 Pro","v30pro","V30 Pro"',
        '"Motorola","Moto G84 5G","bangkk","XT2347-2"',
        '"Xiaomi","Redmi Note 13 Pro","garnet","2312DRA50G"',
        '"Ulefone","Armor 22","armor22","Armor 22"',
        '"Oukitel","WP28","wp28","WP28"',
        '"Kyocera","DuraSport 5G","kce1","C6930"',
    ];
    const parsed = parseGooglePlayDeviceCatalogCsv(csvLines.join('\n'));
    assert.equal(parsed.length, 10);

    const xcover = parsed.find((d) => d.deviceCode === 'SM-G556B');
    assert.ok(xcover);
    assert.equal(xcover.manufacturer, 'Samsung');
    assert.equal(xcover.model, 'Galaxy XCover 7');
    assert.equal(xcover.rugged, true);
    assert.equal(xcover.tier, 'OPTIMAL_SPATIAL');

    await assert.rejects(
        () =>
            importGooglePlayDeviceCatalogCsv({
                csvText: csvLines.slice(0, 4).join('\n'),
                actor: { uid: 'dev-master-root-uid', email: 'dev@minreport.com' },
            }),
        (err: unknown) => err instanceof SpatialCatalogValidationError
    );

    const auditCalls: any[] = [];
    const origRecord = AuditLedger.record;
    (AuditLedger as any).record = async (entry: any) => {
        auditCalls.push(entry);
        return 'audit-csv-1';
    };

    try {
        const res = await importGooglePlayDeviceCatalogCsv({
            csvText: csvLines.join('\n'),
            actor: { uid: 'super-admin-uid', email: 'admin@minreport.com' },
        });
        assert.equal(res.importedCount, 10);
        assert.ok(SpatialDeviceCatalogSchema.safeParse(res.catalog).success);
        assert.equal(auditCalls.length, 1);
        assert.equal(auditCalls[0].action, 'SPATIAL_DEVICE_CATALOG_CSV_IMPORT');
    } finally {
        (AuditLedger as any).record = origRecord;
    }
});

test('Endpoints /device-catalog, /device-catalog/sync, /device-catalog/import-csv, validateSovereignMast3rGpuUrl y purga legacy', async () => {
    dbCollections.clear();
    clearSpatialDeviceCatalogCache();

    const routerStack = (geolappController.default as any).stack as Array<any>;
    const getLayer = routerStack.find((l) => l.route?.path === '/device-catalog' && l.route.methods.get);
    const syncLayer = routerStack.find((l) => l.route?.path === '/device-catalog/sync' && l.route.methods.post);
    const importLayer = routerStack.find(
        (l) => l.route?.path === '/device-catalog/import-csv' && l.route.methods.post
    );

    assert.ok(getLayer?.route, 'Debe existir GET /device-catalog');
    assert.ok(syncLayer?.route, 'Debe existir POST /device-catalog/sync');
    assert.ok(importLayer?.route, 'Debe existir POST /device-catalog/import-csv');

    const getHandler = getLayer.route.stack[getLayer.route.stack.length - 1].handle;
    const syncHandler = syncLayer.route.stack[syncLayer.route.stack.length - 1].handle;
    const importHandler = importLayer.route.stack[importLayer.route.stack.length - 1].handle;

    // GET /device-catalog -> 200
    const getRes = createMockResponse();
    await getHandler({ user: { uid: 'b2b-user-1', email: 'op@faena.cl' }, headers: {} }, getRes, () => {});
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.bodyPayload?.success, true);
    assert.equal(SpatialDeviceCatalogSchema.safeParse(getRes.bodyPayload?.catalog).success, true);

    // POST /device-catalog/sync -> 403 para usuario B2B incluso si falsifica x-cloudscheduler
    const sync403Res = createMockResponse();
    await syncHandler(
        {
            user: { uid: 'b2b-user-1', email: 'op@faena.cl', role: 'B2B' },
            headers: { 'x-cloudscheduler': 'true' },
        },
        sync403Res,
        () => {}
    );
    assert.equal(sync403Res.statusCode, 403);

    // POST /device-catalog/import-csv -> 403 para B2B, 400 sin ACTUALIZAR, 400 con < 10 filas
    const import403Res = createMockResponse();
    await importHandler(
        {
            user: { uid: 'b2b-user-1', email: 'op@faena.cl' },
            headers: {},
            body: { csvText: 'a,b,c,d\n1,2,3,4\n', confirmationKeyword: 'ACTUALIZAR' },
        },
        import403Res,
        () => {}
    );
    assert.equal(import403Res.statusCode, 403);

    const import400Keyword = createMockResponse();
    await importHandler(
        {
            user: { uid: 'dev-master-root-uid', email: 'dev@minreport.com' },
            headers: {},
            body: { csvText: 'Retail Branding,Marketing Name,Device,Model Name\n', confirmationKeyword: 'NO' },
        },
        import400Keyword,
        () => {}
    );
    assert.equal(import400Keyword.statusCode, 400);

    const import400SmallCsv = createMockResponse();
    await importHandler(
        {
            user: { uid: 'super-admin-uid', email: 'admin@minreport.com' },
            headers: {},
            body: {
                csvText: 'Retail Branding,Marketing Name,Device,Model Name\nSamsung,Galaxy XCover 7,xcover7,SM-G556B',
                confirmationKeyword: 'ACTUALIZAR',
            },
        },
        import400SmallCsv,
        () => {}
    );
    assert.equal(import400SmallCsv.statusCode, 400);

    // POST /device-catalog/import-csv -> 200 con DEV_ROOT + ACTUALIZAR + >= 10 filas
    const validCsv10 = [
        'Retail Branding,Marketing Name,Device,Model Name',
        'Samsung,Galaxy XCover 7,xcover7,SM-G556B',
        'Samsung,Galaxy XCover 6 Pro,xcoverpro2,SM-G736B',
        'Samsung,Galaxy S24 Ultra,e3q,SM-S928B',
        'Samsung,Galaxy S25 Ultra,pa3q,SM-S938B',
        'Google,Pixel 8 Pro,husky,Pixel 8 Pro',
        'Google,Pixel 9 Pro,caiman,Pixel 9 Pro',
        'CAT,CAT S75,s75,S75',
        'Doogee,Doogee V30 Pro,v30pro,V30 Pro',
        'Ulefone,Armor 24,armor24,Armor 24',
        'Oukitel,WP30 Pro,wp30pro,WP30 Pro',
    ].join('\n');
    const origAuditRecord = AuditLedger.record;
    (AuditLedger as any).record = async () => 'audit-ctrl-1';
    try {
        const import200Res = createMockResponse();
        await importHandler(
            {
                user: { uid: 'dev-master-root-uid', email: 'dev@minreport.com' },
                headers: {},
                body: { csvText: validCsv10, confirmationKeyword: 'ACTUALIZAR' },
            },
            import200Res,
            () => {}
        );
        assert.equal(import200Res.statusCode, 200);
        assert.equal(import200Res.bodyPayload?.success, true);
        assert.equal(import200Res.bodyPayload?.importedCount, 10);

        const sync200Res = createMockResponse();
        await syncHandler(
            {
                user: { uid: 'super-admin-uid', email: 'admin@minreport.com' },
                headers: {},
            },
            sync200Res,
            () => {}
        );
        assert.equal(sync200Res.statusCode, 200);
        assert.equal(sync200Res.bodyPayload?.success, true);
        assert.equal(typeof sync200Res.bodyPayload?.syncedFromRemote, 'boolean');
        assert.equal(typeof sync200Res.bodyPayload?.fallbackUsed, 'boolean');
        assert.equal(SpatialDeviceCatalogSchema.safeParse(sync200Res.bodyPayload?.catalog).success, true);
    } finally {
        (AuditLedger as any).record = origAuditRecord;
    }

    // validateSovereignMast3rGpuUrl: Santiago Cloud Run + Compute Engine / VPC interno vs bloqueados
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl('https://mast3r-gpu-xyz-tl.a.run.app').hostname,
        'mast3r-gpu-xyz-tl.a.run.app'
    );
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl('https://mast3r-gpu.southamerica-west1.run.app').hostname,
        'mast3r-gpu.southamerica-west1.run.app'
    );
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl(
            'https://mast3r-vm.southamerica-west1-a.c.minreport-8f2a8.internal'
        ).hostname,
        'mast3r-vm.southamerica-west1-a.c.minreport-8f2a8.internal'
    );
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl('https://mast3r.southamerica-west1.minreport.com').hostname,
        'mast3r.southamerica-west1.minreport.com'
    );

    for (const forbiddenUrl of [
        'https://drive.google.com/file/d/123',
        `https://${['colab', 'research', 'google', 'com'].join('.')}/abc`,
        `https://${['notebooklm', 'google', 'com'].join('.')}/notebook/123`,
        'https://demo.ngrok.io/reconstruct',
        'https://localhost:8443/reconstruct',
        'https://mast3r-gpu.us-central1.run.app',
        'http://mast3r-gpu-tl.a.run.app',
    ]) {
        assert.throws(
            () => geolappController.validateSovereignMast3rGpuUrl(forbiddenUrl),
            `URL no soberana debe ser rechazada: ${forbiddenUrl}`
        );
    }

    // Purga legacy en glb-surface.builder.ts y geolapp.controller.ts
    const glbRes = buildServerStockpileGlbMesh({
        geometryType: 'CONO_ELIPTICO',
        dimensions: { d1: 12, d2: 10, h: 4 },
    });
    const jsonChunkLen = glbRes.glbBuffer.readUInt32LE(12);
    const gltfJson = JSON.parse(glbRes.glbBuffer.subarray(20, 20 + jsonChunkLen).toString('utf8').trim());
    assert.equal(gltfJson.asset.generator, 'MINREPORT-ACOPIOS-TIN-BUILDER-southamerica-west1');

    const rootDir = path.resolve(__dirname, '../../..');
    const glbSrc = fs.readFileSync(path.join(rootDir, 'src/modules/geolapp/glb-surface.builder.ts'), 'utf8');
    const ctrlSrc = fs.readFileSync(path.join(rootDir, 'src/api/geolapp.controller.ts'), 'utf8');
    assert.equal(/GEOLAPP®|MINREPORT-GEOLAPP-TIN-BUILDER|MINREPORT GEOLAPP/i.test(glbSrc), false);
    assert.equal(/GEOLAPP®|MINREPORT GEOLAPP/i.test(ctrlSrc), false);
});

test('Stale-While-Revalidate dispara backgroundSyncPromise single-flight (1 vez) sin bloquear respuesta', async () => {
    dbCollections.clear();
    clearSpatialDeviceCatalogCache();

    const staleUpdatedAt = Date.now() - CATALOG_AUTO_REFRESH_TTL_MS - 60_000;
    const staleCatalog = buildBaselineSpatialDeviceCatalog(staleUpdatedAt);
    getColMap('system_config').set('spatial_device_catalog', staleCatalog);

    const origRecord = AuditLedger.record;
    (AuditLedger as any).record = async () => 'audit-swr-1';

    let fetchCount = 0;
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
        releaseFetch = resolve;
    });

    const slowFetcher = async () => {
        fetchCount += 1;
        await fetchGate;
        return new Response(buildSyntheticArCoreHtml(112), { status: 200 });
    };

    try {
        // Dos llamadas concurrentes sobre catálogo obsoleto (> 7 días)
        const [firstCatalog, secondCatalog] = await Promise.all([
            getSpatialDeviceCatalog({ allowAutoRefresh: true, fetcher: slowFetcher }),
            getSpatialDeviceCatalog({ allowAutoRefresh: true, fetcher: slowFetcher }),
        ]);

        // Retorna inmediatamente el catálogo previo sin bloquear por la red
        assert.equal(firstCatalog.updatedAt, staleUpdatedAt);
        assert.equal(secondCatalog.updatedAt, staleUpdatedAt);
        assert.equal(fetchCount, 1, 'Single-flight debe disparar exactamente 1 descarga en segundo plano');

        const pending = getPendingCatalogAutoRefresh();
        assert.ok(pending, 'Debe existir backgroundSyncPromise activa');

        releaseFetch();
        await pending;

        assert.equal(getPendingCatalogAutoRefresh(), null, 'Debe limpiar backgroundSyncPromise al finalizar');
        const refreshed = await getSpatialDeviceCatalog({ allowAutoRefresh: true, fetcher: slowFetcher });
        assert.ok(refreshed.updatedAt > staleUpdatedAt);
        assert.ok(refreshed.totalCount >= 112);
        assert.equal(fetchCount, 1, 'No debe volver a disparar sync cuando el catálogo ya está vigente');
    } finally {
        (AuditLedger as any).record = origRecord;
    }
});

test('POST /api/geolapp/internal/device-catalog/scheduled-sync aplica fail-closed OIDC (401/403/200)', async () => {
    dbCollections.clear();
    clearSpatialDeviceCatalogCache();

    const routerStack = (geolappController.default as any).stack as Array<any>;
    const cronLayer = routerStack.find(
        (l) => l.route?.path === '/internal/device-catalog/scheduled-sync' && l.route.methods.post
    );
    assert.ok(cronLayer?.route, 'Debe existir POST /internal/device-catalog/scheduled-sync');
    const cronHandler = cronLayer.route.stack[cronLayer.route.stack.length - 1].handle;

    // 1. Sin cabecera Authorization -> 401
    const resNoAuth = createMockResponse();
    await cronHandler({ headers: {} }, resNoAuth, () => {});
    assert.equal(resNoAuth.statusCode, 401);

    // 2. Token Bearer forjado/inválido -> 401 real via OAuth2Client.verifyIdToken
    const resForged = createMockResponse();
    await cronHandler(
        { headers: { authorization: 'Bearer forged.invalid.oidc.jwt' } },
        resForged,
        () => {}
    );
    assert.equal(resForged.statusCode, 401);

    // 3. Token OIDC firmado pero Service Account no autorizada o email_verified=false -> 403
    const origVerifyIdToken = geolappController.schedulerOidcClient.verifyIdToken.bind(
        geolappController.schedulerOidcClient
    );
    const origAuditRecord = AuditLedger.record;
    (AuditLedger as any).record = async () => 'audit-cron-1';

    try {
        (geolappController.schedulerOidcClient as any).verifyIdToken = async () => ({
            getPayload: () => ({
                email: 'attacker@evil-project.iam.gserviceaccount.com',
                email_verified: true,
            }),
        });
        const res403Sa = createMockResponse();
        await cronHandler(
            { headers: { authorization: 'Bearer valid-signature-wrong-sa' } },
            res403Sa,
            () => {}
        );
        assert.equal(res403Sa.statusCode, 403);

        (geolappController.schedulerOidcClient as any).verifyIdToken = async () => ({
            getPayload: () => ({
                email: '493995072778-compute@developer.gserviceaccount.com',
                email_verified: false,
            }),
        });
        const res403Unverified = createMockResponse();
        await cronHandler(
            { headers: { authorization: 'Bearer valid-sa-unverified-email' } },
            res403Unverified,
            () => {}
        );
        assert.equal(res403Unverified.statusCode, 403);

        // 4. Token OIDC válido con Service Account permitida y email_verified=true -> 200
        (geolappController.schedulerOidcClient as any).verifyIdToken = async () => ({
            getPayload: () => ({
                email: '493995072778-compute@developer.gserviceaccount.com',
                email_verified: true,
            }),
        });
        const res200 = createMockResponse();
        await cronHandler(
            { headers: { authorization: 'Bearer valid-scheduler-oidc-token' } },
            res200,
            () => {}
        );
        assert.equal(res200.statusCode, 200);
        assert.equal(res200.bodyPayload?.success, true);
        assert.equal(typeof res200.bodyPayload?.totalCount, 'number');
        assert.match(String(res200.bodyPayload?.sourceHash || ''), /^[a-f0-9]{64}$/);
        assert.ok(typeof res200.bodyPayload?.updatedAtIso === 'string');
    } finally {
        (geolappController.schedulerOidcClient as any).verifyIdToken = origVerifyIdToken;
        (AuditLedger as any).record = origAuditRecord;
    }
});
