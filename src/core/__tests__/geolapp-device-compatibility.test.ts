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
        async delete() {
            getColMap(colPath).delete(docId);
        },
    };
}

function createColRef(colPath: string): any {
    let autoCounter = 1;
    const makeQuery = (filters: Array<{ field: string; value: any }> = []): any => ({
        where(field: string, _op: string, value: any) {
            return makeQuery([...filters, { field, value }]);
        },
        limit() {
            return this;
        },
        orderBy() {
            return this;
        },
        async get() {
            const col = getColMap(colPath);
            const docs = Array.from(col.entries())
                .filter(([, data]) => filters.every((f) => data[f.field] === f.value))
                .map(([id, data]) => ({
                    id,
                    exists: true,
                    data: () => structuredClone(data),
                }));
            return {
                empty: docs.length === 0,
                size: docs.length,
                docs,
            };
        },
    });

    return {
        doc(docId?: string) {
            const resolvedId = docId || `doc_${autoCounter++}`;
            return createDocRef(colPath, resolvedId);
        },
        async get() {
            return makeQuery().get();
        },
        where(field: string, op: string, value: any) {
            return makeQuery().where(field, op, value);
        },
        limit() {
            return makeQuery();
        },
    };
}

const mockDb = {
    collection(colPath: string) {
        return createColRef(colPath);
    },
    batch() {
        const ops: Array<() => Promise<void>> = [];
        return {
            set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
                ops.push(() => ref.set(data, opts));
            },
            update(ref: any, patch: Record<string, any>) {
                ops.push(() => ref.update(patch));
            },
            delete(ref: any) {
                ops.push(() => ref.delete());
            },
            async commit() {
                for (const op of ops) {
                    await op();
                }
            },
        };
    },
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
    ResilientAIClient,
    UngroundedEvidenceError,
} = require('../../core/resilient-ai-client') as typeof import('../../core/resilient-ai-client');
const {
    DEVICE_COMPATIBILITY_COLLECTION,
    DeviceCompatibilityRecordSchema,
    DeviceCompatibilityRegistrySnapshotSchema,
    DeviceCompatibilityValidationError,
    checkDeviceCompatibilityOnDemand,
    computeDeterministicDeviceTier,
    listRegisteredDeviceCompatibility,
    normalizeDeviceQueryKey,
} = require('../../modules/geolapp/device-compatibility.service') as typeof import('../../modules/geolapp/device-compatibility.service');
const geolappController =
    require('../../api/geolapp.controller') as typeof import('../../api/geolapp.controller');
require('../../modules/geolapp/glb-surface.builder');

function findRouteHandlers(routePath: string, method: 'get' | 'post'): any[] {
    const routerAny = geolappController.default as any;
    const layer = (routerAny.stack || []).find(
        (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
    );
    assert.ok(layer, `Falta ruta ${method.toUpperCase()} ${routePath} en geolapp.controller`);
    return layer.route.stack.map((s: any) => s.handle);
}

function createMockResponse() {
    const state: {
        statusCode: number;
        bodyPayload: any;
    } = {
        statusCode: 200,
        bodyPayload: null,
    };

    const res: any = {
        setHeader() {
            return this;
        },
        status(code: number) {
            state.statusCode = code;
            return this;
        },
        json(payload: any) {
            state.bodyPayload = payload;
            return this;
        },
    };
    return { res, state };
}

test('Motor On-Demand device-compatibility: normalización, veredicto determinístico y registro inicialmente vacío', async () => {
    dbCollections.clear();

    assert.equal(normalizeDeviceQueryKey('  Samsung   Galaxy A17 5G '), 'samsung-galaxy-a17-5g');
    assert.equal(
        computeDeterministicDeviceTier({
            hasGyroscope: false,
            arSupported: true,
            depthSupported: true,
            lidarSupported: false,
        }),
        'INCOMPATIBLE'
    );
    assert.equal(
        computeDeterministicDeviceTier({
            hasGyroscope: true,
            arSupported: false,
            depthSupported: false,
            lidarSupported: false,
        }),
        'INCOMPATIBLE'
    );
    assert.equal(
        computeDeterministicDeviceTier({
            hasGyroscope: true,
            arSupported: true,
            depthSupported: true,
            lidarSupported: false,
        }),
        'OPTIMAL_SPATIAL'
    );
    assert.equal(
        computeDeterministicDeviceTier({
            hasGyroscope: true,
            arSupported: true,
            depthSupported: false,
            lidarSupported: false,
        }),
        'COMPATIBLE_VIO'
    );
    assert.equal(
        computeDeterministicDeviceTier({
            hasGyroscope: true,
            arSupported: null,
            depthSupported: null,
            lidarSupported: null,
        }),
        'UNVERIFIED'
    );

    // Registro inicialmente 100% vacío (cero listados predefinidos)
    const emptySnapshot = await listRegisteredDeviceCompatibility();
    DeviceCompatibilityRegistrySnapshotSchema.parse(emptySnapshot);
    assert.equal(emptySnapshot.totalCount, 0);
    assert.deepEqual(emptySnapshot.devices, []);
});

test('Motor On-Demand: primera consulta usa Gemini Grounded + Zod + Firestore + AuditLedger y segunda consulta usa caché (0 llamadas IA)', async () => {
    dbCollections.clear();

    const originalGenerate = ResilientAIClient.generate;
    const originalAuditRecord = AuditLedger.record;
    const aiCalls: Array<Record<string, any>> = [];
    const auditEntries: Array<Record<string, any>> = [];

    (ResilientAIClient as any).generate = async (opts: any) => {
        aiCalls.push(opts);
        if (/a17/i.test(opts.prompt)) {
            return {
                text: JSON.stringify({
                    manufacturer: 'Samsung',
                    model: 'Galaxy A17 5G',
                    deviceCode: 'SM-A176B',
                    platform: 'ANDROID',
                    hasGyroscope: true,
                    arSupported: true,
                    depthSupported: false,
                    lidarSupported: false,
                    rugged: false,
                    ruggedRating: null,
                    verdictSummary:
                        'Compatible con VIO ARCore y giroscopio hardware; sin soporte Depth API verificado.',
                }),
                model: 'gemini-2.5-flash',
                groundingSources: [
                    {
                        title: 'Google ARCore Supported Devices',
                        uri: 'https://developers.google.com/ar/devices',
                    },
                ],
            };
        }
        return {
            text: JSON.stringify({
                manufacturer: 'Generico',
                model: 'Equipo Basico Sin Giroscopio',
                deviceCode: 'GEN-001',
                platform: 'ANDROID',
                hasGyroscope: false,
                arSupported: false,
                depthSupported: false,
                lidarSupported: false,
                rugged: false,
                ruggedRating: null,
                verdictSummary:
                    'Incompatible: carece de giroscopio hardware y certificación Google ARCore.',
            }),
            model: 'gemini-2.5-flash',
            groundingSources: [
                {
                    title: 'Especificaciones Técnicas Fabricante',
                    uri: 'https://developer.android.com/guide/topics/sensors/sensors_motion',
                },
            ],
        };
    };

    (AuditLedger as any).record = async (entry: any) => {
        auditEntries.push(entry);
        return `audit_${auditEntries.length}`;
    };

    try {
        // 1. Primera consulta: Samsung Galaxy A17 5G
        const first = await checkDeviceCompatibilityOnDemand({
            query: 'Samsung Galaxy A17 5G',
            actor: { uid: 'uid-dev', email: 'dev@minreport.com', tenantId: 'global' },
        });
        DeviceCompatibilityRecordSchema.parse(first.device);
        assert.equal(first.cached, false);
        assert.equal(first.device.manufacturer, 'Samsung');
        assert.equal(first.device.model, 'Galaxy A17 5G');
        assert.equal(first.device.tier, 'COMPATIBLE_VIO');
        assert.equal(first.device.queryCount, 1);
        assert.equal(first.registry.totalCount, 1);
        assert.equal(aiCalls.length, 1);
        assert.equal(aiCalls[0].useGoogleSearch, true);
        assert.equal(aiCalls[0].requireGroundedEvidence, true);
        assert.equal(aiCalls[0].tenantId, 'GLOBAL');
        assert.equal(auditEntries.length, 1);
        assert.equal(auditEntries[0].action, 'DEVICE_COMPATIBILITY_EVALUATED');

        // 2. Segunda consulta por alias ("galaxy a17 5g"): responde desde BD sin consumir IA
        const second = await checkDeviceCompatibilityOnDemand({
            query: 'galaxy a17 5g',
            actor: { uid: 'uid-admin', email: 'admin@minreport.com', tenantId: 'global' },
        });
        assert.equal(second.cached, true);
        assert.equal(second.device.canonicalKey, first.device.canonicalKey);
        assert.equal(second.device.queryCount, 2);
        assert.equal(second.registry.totalCount, 1);
        assert.equal(aiCalls.length, 1, 'No debe repetir búsqueda Gemini si el modelo ya está registrado');

        // 3. forceRefresh: true vuelve a consultar Gemini con bypassCache: true
        const refreshed = await checkDeviceCompatibilityOnDemand({
            query: 'SM-A176B',
            forceRefresh: true,
            actor: { uid: 'uid-dev', email: 'dev@minreport.com', tenantId: 'global' },
        });
        assert.equal(refreshed.cached, false);
        assert.equal(aiCalls.length, 2);
        assert.equal(aiCalls[1].bypassCache, true);
        assert.equal(refreshed.device.queryCount, 3);
        assert.equal(refreshed.registry.totalCount, 1);

        // 4. Equipo incompatible también se persiste en registro auditable
        const incompatible = await checkDeviceCompatibilityOnDemand({
            query: 'Equipo Basico Sin Giroscopio',
            actor: { uid: 'uid-dev', email: 'dev@minreport.com', tenantId: 'global' },
        });
        assert.equal(incompatible.cached, false);
        assert.equal(incompatible.device.tier, 'INCOMPATIBLE');
        assert.equal(incompatible.device.hasGyroscope, false);
        assert.equal(incompatible.registry.totalCount, 2);
        assert.equal(incompatible.registry.incompatibleCount, 1);
        assert.equal(incompatible.registry.vioCount, 1);

        const colMap = getColMap(DEVICE_COMPATIBILITY_COLLECTION);
        assert.equal(colMap.size, 2);
    } finally {
        (ResilientAIClient as any).generate = originalGenerate;
        (AuditLedger as any).record = originalAuditRecord;
    }
});

test('Endpoints HTTP on-demand, Fail-Closed Ungrounded (422), validateSovereignMast3rGpuUrl y purga legacy', async () => {
    dbCollections.clear();

    const originalGenerate = ResilientAIClient.generate;
    try {
        const listHandlers = findRouteHandlers('/device-compatibility', 'get');
        const listAliasHandlers = findRouteHandlers('/device-catalog', 'get');
        const checkHandlers = findRouteHandlers('/device-compatibility/check', 'post');
        const checkAliasHandlers = findRouteHandlers('/device-catalog/check', 'post');

        assert.ok(listHandlers.length >= 2);
        assert.ok(listAliasHandlers.length >= 2);
        assert.ok(checkHandlers.length >= 2);
        assert.ok(checkAliasHandlers.length >= 2);

        // Rutas obsoletas de listado curado / CSV / cron deben estar eliminadas
        const routerAny = geolappController.default as any;
        for (const removedPath of [
            '/device-catalog/sync',
            '/device-catalog/import-csv',
            '/internal/device-catalog/scheduled-sync',
        ]) {
            const exists = (routerAny.stack || []).some((l: any) => l.route?.path === removedPath);
            assert.equal(exists, false, `La ruta obsoleta ${removedPath} debe haber sido eliminada`);
        }

        // GET /device-compatibility vacío inicialmente
        const getHandler = listHandlers[listHandlers.length - 1];
        const getRes = createMockResponse();
        await getHandler({ user: { uid: 'u-1', email: 'dev@minreport.com' } }, getRes.res, () => {});
        assert.equal(getRes.state.statusCode, 200);
        assert.equal(getRes.state.bodyPayload?.registry?.totalCount, 0);

        // POST /device-compatibility/check query demasiado corta -> 400
        const postHandler = checkHandlers[checkHandlers.length - 1];
        const badRes = createMockResponse();
        await postHandler(
            {
                user: { uid: 'u-1', email: 'dev@minreport.com' },
                body: { query: 'A' },
            },
            badRes.res,
            () => {}
        );
        assert.equal(badRes.state.statusCode, 400);

        // Fail-Closed cuando Gemini no aporta groundingSources verificables -> 422
        (ResilientAIClient as any).generate = async () => {
            throw new UngroundedEvidenceError('Sin fuentes web verificables.');
        };
        const ungroundedRes = createMockResponse();
        await postHandler(
            {
                user: { uid: 'u-1', email: 'dev@minreport.com' },
                body: { query: 'Modelo Inexistente XYZ 999' },
            },
            ungroundedRes.res,
            () => {}
        );
        assert.equal(ungroundedRes.state.statusCode, 422);
        assert.equal(getColMap(DEVICE_COMPATIBILITY_COLLECTION).size, 0);

        // DeviceCompatibilityValidationError expone statusCode controlado
        const valErr = new DeviceCompatibilityValidationError('Error test', 422, 'UNGROUNDED');
        assert.equal(valErr.statusCode, 422);
        assert.equal(valErr.code, 'UNGROUNDED');
    } finally {
        (ResilientAIClient as any).generate = originalGenerate;
    }

    // validateSovereignMast3rGpuUrl: Santiago Cloud Run / minreport.com permitidos, SSRF bloqueado
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl('https://mast3r-gpu-xyz-tl.a.run.app')
            .hostname,
        'mast3r-gpu-xyz-tl.a.run.app'
    );
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl(
            'https://mast3r-gpu.southamerica-west1.run.app'
        ).hostname,
        'mast3r-gpu.southamerica-west1.run.app'
    );
    assert.equal(
        geolappController.validateSovereignMast3rGpuUrl(
            'https://mast3r.southamerica-west1.minreport.com'
        ).hostname,
        'mast3r.southamerica-west1.minreport.com'
    );
    for (const forbiddenUrl of [
        'http://127.0.0.1:8080/reconstruct',
        'http://169.254.169.254/latest/meta-data',
        'https://evil.example.org/mast3r',
    ]) {
        assert.throws(() => geolappController.validateSovereignMast3rGpuUrl(forbiddenUrl));
    }

    // Purga de marcas heredadas en glb-surface.builder.ts y geolapp.controller.ts
    const rootDir = path.resolve(__dirname, '../../..');
    for (const relPath of [
        'src/modules/geolapp/glb-surface.builder.ts',
        'src/api/geolapp.controller.ts',
    ]) {
        const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
        assert.equal(
            /GEOLAPP®|MINREPORT GEOLAPP/i.test(content),
            false,
            `${relPath} no debe exponer marcas heredadas`
        );
    }
});
