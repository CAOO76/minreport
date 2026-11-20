/**
 * Suite Sandbox-Safe — GEOLAPP® Fase 2 (Motores Geométricos, Gobernanza Cu, PDF Vectorial, i18n, Reglas y HITL)
 * Ejecutable vía: npx ts-node src/core/__tests__/geolapp-fase2-engine.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { PDFDocument } from 'pdf-lib';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.DEV_ROOT_PASSWORD ||= 'TestDevRootPassword2026!';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';

const ROOT = path.resolve(__dirname, '../../..');
const WEB_SRC = path.join(ROOT, 'web/src');

// ---------------------------------------------------------------------------
// Stubs en memoria para Firebase Admin antes de importar controladores
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

function createCollectionRef(colPath: string): any {
    return {
        doc(id: string) {
            return createDocRef(colPath, id);
        },
        where(field: string, op: string, value: unknown) {
            return {
                async get() {
                    const docs = Array.from(getCollectionMap(colPath).entries())
                        .filter(([, d]) => (op === '==' ? d[field] === value : true))
                        .map(([id, data]) => ({
                            id,
                            exists: true,
                            data: () => ({ ...data }),
                        }));
                    return { empty: docs.length === 0, size: docs.length, docs };
                },
            };
        },
    };
}

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
};
mockFirestoreNamespace.Timestamp = {
    now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
};

const mockAdmin = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: mockFirestoreNamespace,
    auth: () => ({ verifyIdToken: async () => ({}) }),
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

const { AuditLedger } = require('../../core/audit-ledger') as typeof import('../../core/audit-ledger');
const geolappRouter = require('../../api/geolapp.controller').default as {
    stack: Array<{
        route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: Array<{ handle: (req: any, res: any, next: any) => any }>;
        };
    }>;
};

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
        if (spec === '@capacitor/core') {
            return { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } };
        }
        if (spec === '@capacitor/filesystem') {
            return { Filesystem: {}, Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' } };
        }
        if (spec === '@capacitor/share') {
            return { Share: {} };
        }
        if (spec.endsWith('/StorageService') || spec === '../services/StorageService') {
            return { resolveStockpileImageUrl: async (u: string) => u };
        }
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

function createMockResponse(): Response & { statusCode: number; bodyPayload: any } {
    const res: any = {
        statusCode: 200,
        bodyPayload: null,
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

function flattenKeys(obj: unknown, prefix = ''): string[] {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return prefix ? [prefix] : [];
    }
    const keys: string[] = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const nextPrefix = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            keys.push(...flattenKeys(v, nextPrefix));
        } else {
            keys.push(nextPrefix);
        }
    }
    return keys.sort();
}

async function run(): Promise<void> {
    // 1. CalculationEngine: Windrow, ToeWall, Clinometer, CopperGovernance
    const { calculationEngine } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/services/calculation-engine.ts')
    );

    assert.equal(calculationEngine.calculateWindrowVolume(20, 10, 4), 400);
    assert.equal(calculationEngine.calculateWindrowVolume(20, 10, 4, 16, 4), 512);
    assert.equal(calculationEngine.calculateWindrowVolume(0, 10, 4), 0);
    assert.equal(calculationEngine.calculateWindrowVolume(-2, 10, 4), 0);
    assert.equal(calculationEngine.calculateWindrowVolume(20, 10, NaN), 0);

    assert.equal(calculationEngine.calculateToeWallStockpileVolume(10, 8, 4, 90), 160);
    assert.equal(calculationEngine.calculateToeWallStockpileVolume(10, 8, 4, 45), 80);
    assert.equal(calculationEngine.calculateToeWallStockpileVolume(10, 2, 10, 45), 0);
    assert.equal(calculationEngine.calculateToeWallStockpileVolume(-1, 8, 4, 90), 0);

    assert.equal(calculationEngine.computeHeightFromClinometer(45, 10, 1.6), 11.6);
    assert.equal(calculationEngine.computeHeightFromClinometer(-30, 10, 1.6), 0);
    assert.equal(calculationEngine.computeHeightFromClinometer(90, 10, 1.6), 0);

    const sulfWarn = calculationEngine.evaluateCopperGovernance({
        copperDomain: 'SULFURO_SECUNDARIO_CU',
        residenceDays: 14,
    });
    assert.equal(sulfWarn.alerts.length, 1);
    assert.equal(sulfWarn.alerts[0].code, 'SULFIDE_AGING_WARNING');
    assert.equal(sulfWarn.alerts[0].severity, 'WARNING');
    assert.equal(sulfWarn.isValidForDispatch, true);

    const sulfCrit = calculationEngine.evaluateCopperGovernance({
        copperDomain: 'SULFURO_PRIMARIO_CU',
        residenceDays: 30,
    });
    assert.equal(sulfCrit.alerts.length, 1);
    assert.equal(sulfCrit.alerts[0].code, 'SULFIDE_AGING_CRITICAL');
    assert.equal(sulfCrit.alerts[0].severity, 'CRITICAL');

    const tmlBlock = calculationEngine.evaluateCopperGovernance({
        copperDomain: 'CONCENTRADO_CU',
        moisturePct: 9.4,
        tmlLimitPct: 9.0,
    });
    assert.equal(tmlBlock.alerts[0].code, 'CONCENTRATE_TML_EXCEEDED');
    assert.equal(tmlBlock.alerts[0].severity, 'BLOCK');
    assert.equal(tmlBlock.hasCriticalBlock, true);
    assert.equal(tmlBlock.isValidForDispatch, false);

    const noInventedAlerts = calculationEngine.evaluateCopperGovernance({
        copperDomain: 'CONCENTRADO_CU',
        moisturePct: null,
        tmlLimitPct: 9.0,
        residenceDays: null,
    });
    assert.equal(noInventedAlerts.alerts.length, 0);
    assert.equal(noInventedAlerts.isValidForDispatch, true);

    console.log('PASS [1/5] CalculationEngine: Windrow, Toe-Wall, Clinometer IMU & Copper Governance');

    // 2. Vector PDF Generator real con pdf-lib (0 GPS seguro sin 0,0 + alertas Cu + CAS)
    const { generateGeolappVectorPdf } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/utils/vectorPdfGenerator.ts')
    );

    const pdfAsset = {
        id: 'stk-fase2-01',
        tenantId: 'tenant-cobre-cl',
        name: 'PILA-SULFURO-NORTE',
        clase: 'mineral' as const,
        createdAt: Date.UTC(2026, 10, 15, 12, 0, 0),
        createdBy: 'geologo@faena.cl',
        copper_domain: 'CONCENTRADO_CU' as const,
        moisture_pct: 9.4,
        tml_pct: 9.0,
        wet_weight_thm: 2400,
        dry_weight_tms: 2174.4,
        cu_total_pct: 28.5,
        cu_soluble_pct: 1.2,
        fine_cu_t: 619.7,
        residence_days: 18,
        cas_original_bytes: 2_400_000,
        cas_optimized_bytes: 180_000,
        cas_savings_pct: 92.5,
    };
    const pdfMeasurements = [
        {
            id: 'meas-01',
            assetId: 'stk-fase2-01',
            timestamp: Date.UTC(2026, 10, 15, 13, 0, 0),
            volumen_m3: 512,
            peso_t: 972.8,
            density_factor: 1.9,
            photo_url: 'offline-cas://abc123.webp',
            method: 'manual' as const,
            geometry: {
                type: 'PILA_LONGITUDINAL_WINDROW',
                dimensions: { length: 20, width: 10, height: 4, crestLength: 16, crestWidth: 4 },
            },
            imu_pitch_deg: 24.5,
            imu_height_m: 4.0,
            cas_original_bytes: 2_400_000,
            cas_optimized_bytes: 180_000,
            cas_savings_pct: 92.5,
            copper_governance_alerts: tmlBlock.alerts,
        },
    ];

    const pdfResult = await generateGeolappVectorPdf(pdfAsset, pdfMeasurements, {
        locale: 'es',
        authorEmail: 'geologo@faena.cl',
        governanceAlerts: tmlBlock.alerts,
    });

    assert.ok(pdfResult.bytes instanceof Uint8Array && pdfResult.bytes.length > 1000);
    const header = Buffer.from(pdfResult.bytes.slice(0, 5)).toString('ascii');
    assert.equal(header, '%PDF-', 'PDF vectorial debe iniciar con cabecera %PDF-');
    const parsedPdf = await PDFDocument.load(pdfResult.bytes);
    assert.ok(parsedPdf.getPageCount() >= 1, 'PDF debe contener al menos 1 pagina');

    const pdfRawText = Buffer.from(pdfResult.bytes).toString('latin1');
    assert.equal(pdfRawText.includes('0.000000, 0.000000'), false, 'Cero coordenadas ficticias 0,0 cuando no hay GPS');

    console.log('PASS [2/5] generateGeolappVectorPdf real (%PDF-, sin 0,0 ficticio, Cu & CAS)');

    // 3. Paridad i18n es/en/pt + 0 emojis
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    const localeDir = path.join(WEB_SRC, 'modules/geolapp/i18n/locales');
    const esJson = JSON.parse(fs.readFileSync(path.join(localeDir, 'es.json'), 'utf8'));
    const enJson = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
    const ptJson = JSON.parse(fs.readFileSync(path.join(localeDir, 'pt.json'), 'utf8'));

    assert.equal(emojiRe.test(JSON.stringify(esJson)), false, 'es.json libre de emojis');
    assert.equal(emojiRe.test(JSON.stringify(enJson)), false, 'en.json libre de emojis');
    assert.equal(emojiRe.test(JSON.stringify(ptJson)), false, 'pt.json libre de emojis');

    const esKeys = flattenKeys(esJson);
    const enKeys = flattenKeys(enJson);
    const ptKeys = flattenKeys(ptJson);
    assert.ok(esKeys.length > 50, 'es.json debe contener diccionario completo GEOLAPP');
    assert.deepEqual(enKeys, esKeys, 'Paridad 100% de llaves entre en.json y es.json');
    assert.deepEqual(ptKeys, esKeys, 'Paridad 100% de llaves entre pt.json y es.json');

    console.log(`PASS [3/5] Paridad i18n ES/EN/PT (${esKeys.length} llaves) y 0 emojis`);

    // 4. StockpileSurveyTelemetrySchema (windrow / toe-wall) + firestore.rules subcolección
    const { StockpileSurveyTelemetrySchema } = loadWebModule(path.join(WEB_SRC, 'contracts/index.ts'));
    for (const shape of ['elliptic-cone', 'truncated-elliptic-cone', 'perimeter-cone', 'windrow', 'toe-wall']) {
        const parsed = StockpileSurveyTelemetrySchema.safeParse({
            surveyId: `srv_${shape}`,
            tag: `ACOPIO_${shape}`,
            material: 'mineral',
            shape,
            volumeM3: 150,
            density: 1.8,
            tonnage: 270,
            confidence: 95,
            surveyDate: new Date().toISOString(),
        });
        assert.equal(parsed.success, true, `Shape '${shape}' debe ser aceptado por StockpileSurveyTelemetrySchema`);
    }

    const rulesSrc = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.ok(
        rulesSrc.includes('match /measurements/{measId}'),
        'firestore.rules debe declarar subcoleccion match /measurements/{measId} bajo stockpiles/{stkId}'
    );

    console.log('PASS [4/5] Contratos Zod windrow/toe-wall y regla firestore.rules');

    // 5. Backend POST /api/geolapp/stockpiles/:id/hitl-update (HTTP 400 sin 'ACTUALIZAR', 403 cross-tenant, 200 + AuditLedger)
    const routeLayer = geolappRouter.stack.find(
        (layer) => layer.route?.path === '/stockpiles/:id/hitl-update' && layer.route.methods.post
    );
    assert.ok(routeLayer?.route, 'Debe existir ruta POST /stockpiles/:id/hitl-update en geolappRouter');
    const hitlHandler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;

    dbCollections.clear();
    getCollectionMap('stockpiles').set('stk-hitl-1', {
        id: 'stk-hitl-1',
        tenantId: 'tenant-alpha',
        accountId: 'tenant-alpha',
        name: 'ACOPIO SUR',
        clase: 'mineral',
    });
    getCollectionMap('accounts').set('tenant-alpha', {
        id: 'tenant-alpha',
        ownerId: 'uid-alpha',
        status: 'ACTIVE',
    });

    const auditCalls: any[] = [];
    const origRecord = AuditLedger.record;
    (AuditLedger as any).record = async (entry: any) => {
        auditCalls.push(entry);
        return 'audit-geolapp-1';
    };

    try {
        // 5a. Rechazo HTTP 400 si confirmationKeyword != 'ACTUALIZAR'
        for (const badKeyword of [undefined, '', 'UPDATE', 'actualizar']) {
            const res400 = createMockResponse();
            await hitlHandler(
                {
                    params: { id: 'stk-hitl-1' },
                    user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                    headers: { 'x-active-account-id': 'tenant-alpha' },
                    body: {
                        confirmationKeyword: badKeyword,
                        patch: { density_factor: 1.92 },
                    },
                },
                res400,
                () => {}
            );
            assert.equal(
                res400.statusCode,
                400,
                `confirmationKeyword='${String(badKeyword)}' debe rechazarse con HTTP 400`
            );
        }

        // 5b. Aislamiento multi-tenant HTTP 403
        const res403 = createMockResponse();
        await hitlHandler(
            {
                params: { id: 'stk-hitl-1' },
                user: { uid: 'uid-bravo', email: 'op@bravo.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-bravo' },
                body: {
                    confirmationKeyword: 'ACTUALIZAR',
                    patch: { density_factor: 1.92 },
                },
            },
            res403,
            () => {}
        );
        assert.equal(res403.statusCode, 403, 'Otro tenant debe recibir HTTP 403');

        // 5c. Mutación válida HTTP 200 + registro AuditLedger
        const res200 = createMockResponse();
        await hitlHandler(
            {
                params: { id: 'stk-hitl-1' },
                user: { uid: 'uid-alpha', email: 'op@alpha.cl', email_verified: true },
                headers: { 'x-active-account-id': 'tenant-alpha' },
                body: {
                    confirmationKeyword: 'ACTUALIZAR',
                    patch: { density_factor: 1.95 },
                    diffSummary: [{ field: 'density_factor', current: '1.80', suggested: '1.95' }],
                },
            },
            res200,
            () => {}
        );
        assert.equal(res200.statusCode, 200);
        assert.equal(res200.bodyPayload?.success, true);
        assert.equal(res200.bodyPayload?.asset?.density_factor, 1.95);
        assert.equal(auditCalls.length, 1);
        assert.equal(auditCalls[0].action, 'GEOLAPP_HITL_UPDATE');
        assert.equal(auditCalls[0].module, 'stockpile');
        assert.equal(auditCalls[0].tenantId, 'tenant-alpha');
    } finally {
        (AuditLedger as any).record = origRecord;
    }

    console.log('PASS [5/5] Endpoint HITL /api/geolapp/stockpiles/:id/hitl-update (400 / 403 / 200 + AuditLedger)');
}

run().catch((err) => {
    console.error('FAIL geolapp-fase2-engine.test.ts:', err);
    process.exit(1);
});
