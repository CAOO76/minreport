/**
 * Suite Sandbox-Safe — Accesibilidad Universal 18-120 Años MINREPORT (Pilares 1 a 5)
 * - Pilar 1: Escala óptica 100/125/150%, auto-confort 125% TEST_PILOT, piso >= 13px (`0` sub-13px).
 * - Pilar 2 & 5: PilotWisdomExtractorService (Ley N° 21.719 PII pre/post, zero audio CAS persistence, auth guard),
 *              ReadAloudButton offline, SovereignVoiceInput, MiningAICopilot sin JSON crudo.
 * - Pilar 3: ContextOrientationBar, callouts 0ms, sin ruido meta-software ni paths crudos.
 * - Pilar 4: Passkey primario en AccessPage, /dev OTP TTL 600s + <label> visibles, HITL 'ACTUALIZAR' case-insensitive.
 * - Pilar 5 Campo: MobileScanner cero `animate-spin`, guía IMU sonora/háptica, parseSpokenStockpileSpecs (ES/EN/PT).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.DEV_ROOT_PASSWORD ||= 'TestDevRootPassword2026!';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';

// ---------------------------------------------------------------------------
// Stubs en memoria para Firebase Admin (antes de importar servicios backend)
// ---------------------------------------------------------------------------
const DELETE_SENTINEL = Symbol('FieldValue.delete');
const SERVER_TIMESTAMP_SENTINEL = Symbol('FieldValue.serverTimestamp');

class IncrementSentinel {
    constructor(public readonly operand: number) {}
}

class ArrayUnionSentinel {
    constructor(public readonly elements: unknown[]) {}
}

const mockFieldValue = {
    delete: () => DELETE_SENTINEL,
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
    increment: (n: number) => new IncrementSentinel(n),
    arrayUnion: (...elements: unknown[]) => new ArrayUnionSentinel(elements),
};

const mockTimestamp = {
    now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
    fromDate: (d: Date) => ({ toMillis: () => d.getTime(), toDate: () => d }),
};

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const storageFiles = new Map<string, { buffer: Buffer; metadata: Record<string, any> }>();
let autoSeq = 0;

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
        async delete() {
            getCollectionMap(colPath).delete(docId);
        },
    };
}

function createQueryRef(
    colPath: string,
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    limitCount?: number
): any {
    return {
        where(field: string, op: string, value: unknown) {
            return createQueryRef(colPath, [...filters, { field, op, value }], limitCount);
        },
        orderBy() {
            return createQueryRef(colPath, filters, limitCount);
        },
        limit(n: number) {
            return createQueryRef(colPath, filters, n);
        },
        async get() {
            let entries = Array.from(getCollectionMap(colPath).entries()).filter(([, docData]) => {
                for (const f of filters) {
                    if (f.op === '==' && docData[f.field] !== f.value) return false;
                }
                return true;
            });
            if (typeof limitCount === 'number') entries = entries.slice(0, limitCount);
            const docs = entries.map(([id, data]) => ({
                id,
                exists: true,
                ref: createDocRef(colPath, id),
                data: () => ({ ...data }),
            }));
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    };
}

function createCollectionRef(colPath: string): any {
    return {
        ...createQueryRef(colPath),
        doc(id?: string) {
            return createDocRef(colPath, id || `auto-${++autoSeq}`);
        },
        async add(payload: Record<string, any>) {
            const ref = createDocRef(colPath, `auto-${++autoSeq}`);
            await ref.set(payload);
            return ref;
        },
    };
}

const mockDb = {
    collection: (name: string) => createCollectionRef(name),
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        return fn({
            get: (ref: any) => ref.get(),
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => ref.set(data, opts),
            update: (ref: any, patch: Record<string, any>) => ref.update(patch),
            delete: (ref: any) => ref.delete(),
        });
    },
};

const mockAuth = {
    async verifyIdToken() {
        return {};
    },
    async getUserByEmail() {
        throw new Error('auth/user-not-found');
    },
};

const mockStorage = {
    bucket: () => ({
        name: 'minreport-sandbox-test.firebasestorage.app',
        file: (filePath: string) => ({
            async save(buf: Buffer, opts?: Record<string, any>) {
                storageFiles.set(filePath, { buffer: Buffer.from(buf), metadata: opts?.metadata || {} });
            },
            async exists() {
                return [storageFiles.has(filePath)];
            },
        }),
    }),
};

const mockFirestoreNamespace: any = () => mockDb;
mockFirestoreNamespace.FieldValue = mockFieldValue;
mockFirestoreNamespace.Timestamp = mockTimestamp;

const mockAdmin = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: mockFirestoreNamespace,
    auth: () => mockAuth,
    storage: () => mockStorage,
    messaging: () => ({}),
};

function installRequireStub(resolvedPath: string, exportsObj: any): void {
    require.cache[resolvedPath] = {
        id: resolvedPath,
        filename: resolvedPath,
        loaded: true,
        exports: exportsObj,
    } as any;
}

installRequireStub(require.resolve('../../config/firebase'), {
    __esModule: true,
    default: mockAdmin,
    db: mockDb,
    auth: mockAuth,
    storage: mockStorage,
    messaging: {},
});
installRequireStub(require.resolve('firebase-admin/firestore'), {
    __esModule: true,
    FieldValue: mockFieldValue,
    Timestamp: mockTimestamp,
});
installRequireStub(require.resolve('firebase-admin'), {
    __esModule: true,
    default: mockAdmin,
    apps: mockAdmin.apps,
    firestore: mockFirestoreNamespace,
    auth: () => mockAuth,
    storage: () => mockStorage,
});

const { DevChallengeService } = require('../../services/dev-challenge.service') as typeof import('../../services/dev-challenge.service');
const { EmailService } = require('../../services/EmailService') as typeof import('../../services/EmailService');
const {
    PilotWisdomExtractorService,
    UNDECLARED_FICHA_STATE,
} = require('../../services/pilot-wisdom-extractor.service') as typeof import('../../services/pilot-wisdom-extractor.service');
const { ResilientAIClient } = require('../../core/resilient-ai-client') as typeof import('../../core/resilient-ai-client');
const { AuditLedger } = require('../audit-ledger') as typeof import('../audit-ledger');
const pilotRouter = (require('../../api/pilot.controller') as typeof import('../../api/pilot.controller')).default;

const ROOT = path.resolve(__dirname, '../../..');
const WEB_SRC = path.join(ROOT, 'web/src');

function loadSpokenStockpileParser(): (transcript: string) => {
    baseMajorAxis?: string;
    baseMinorAxis?: string;
    totalHeight?: string;
    density?: string;
    classification?: 'COLPA' | 'GRANSA' | 'FINO';
} {
    const ts = require('typescript') as typeof import('typescript');
    const vm = require('node:vm') as typeof import('node:vm');
    const parserPath = path.join(WEB_SRC, 'modules/geolapp/core/utils/spokenStockpileParser.ts');
    const source = fs.readFileSync(parserPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: parserPath,
    });
    const mod: { exports: Record<string, any> } = { exports: {} };
    const fn = vm.runInNewContext(
        `(function (exports, module) {\n${transpiled.outputText}\n})`,
        { Object, Number, RegExp, String, Error }
    ) as (exports: Record<string, any>, module: { exports: Record<string, any> }) => void;
    fn(mod.exports, mod);
    const parser = mod.exports.parseSpokenStockpileSpecs as (transcript: string) => Record<string, any>;
    return (transcript: string) => ({ ...parser(transcript) });
}

const parseSpokenStockpileSpecs = loadSpokenStockpileParser();

function collectFiles(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectFiles(full, exts));
        } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
}

function createMockRes() {
    const res: any = {
        statusCode: 200,
        body: null,
        headers: {} as Record<string, string>,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.body = payload;
            return this;
        },
        setHeader(k: string, v: string) {
            this.headers[k] = v;
        },
    };
    return res as Response & { statusCode: number; body: any };
}

function getPilotRouteHandler(method: 'post' | 'patch' | 'get', routePath: string) {
    const layer = (pilotRouter as any).stack.find(
        (l: any) => l?.route?.path === routePath && l?.route?.methods?.[method]
    );
    assert.ok(layer, `Ruta ${method.toUpperCase()} ${routePath} debe existir en pilotRouter`);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle as (req: any, res: any) => Promise<any>;
}

async function testPillar1OpticalScaleAndTypographyFloor(): Promise<void> {
    const themeInit = fs.readFileSync(path.join(ROOT, 'web/public/theme-init.js'), 'utf8');
    assert.ok(themeInit.includes("minreport_ergonomic_scale"), 'theme-init.js debe leer escala ergonómica');
    assert.ok(themeInit.includes("'20px'") && themeInit.includes("'24px'") && themeInit.includes("'16px'"),
        'theme-init.js debe aplicar 16px/20px/24px sin FOUC');

    const scaleCtx = fs.readFileSync(path.join(WEB_SRC, 'context/ErgonomicScaleContext.tsx'), 'utf8');
    assert.ok(scaleCtx.includes("setScaleState('125')"), 'ErgonomicScaleContext debe activar confort 125% por defecto para TEST_PILOT');

    const twConfig = fs.readFileSync(path.join(ROOT, 'web/tailwind.config.js'), 'utf8');
    assert.ok(twConfig.includes("'microcopy': ['0.8125rem'"), 'Tailwind microcopy debe tener piso mínimo 0.8125rem (13px)');

    const files = collectFiles(WEB_SRC, ['.ts', '.tsx', '.css']);
    const violations: string[] = [];
    const sub13Pattern = /\btext-\[(?:[0-9]|1[0-2])px\]/;
    for (const f of files) {
        const content = fs.readFileSync(f, 'utf8');
        if (sub13Pattern.test(content)) {
            violations.push(path.relative(ROOT, f));
        }
    }
    assert.equal(violations.length, 0, `No debe existir ninguna clase text-[<=12px] en web/src. Encontradas: ${violations.join(', ')}`);
}

async function testPillar2And5PilotWisdomLey21719(): Promise<void> {
    dbCollections.clear();
    storageFiles.clear();

    const piiNarrative =
        'Soy Juan Perez RUT 12.345.678-5 fono +56 9 8765 4321 correo juan@minera.cl en -23.6509, -70.3975. En rampa sobre 4200 m la presión hidráulica de levante cae antes de lo que indica la ficha.';

    const fallbackRes = await PilotWisdomExtractorService.extractWisdom(
        {
            rawNarrative: piiNarrative,
            module: 'opermaq',
            contextPath: '/opermaq/vault/caex-797',
            countryCode: 'CL',
            preferredLang: 'es',
        },
        { forceDeterministicFallback: true }
    );

    assert.equal(fallbackRes.engineMode, 'DETERMINISTIC_FALLBACK');
    assert.equal(fallbackRes.currentFichaState, UNDECLARED_FICHA_STATE);
    assert.ok(fallbackRes.redactedCategories.length > 0, 'Debe registrar categorías de PII purgadas');
    for (const sensitive of ['12.345.678-5', '8765 4321', 'juan@minera.cl', '-23.6509']) {
        assert.equal(fallbackRes.cleanObservation.includes(sensitive), false, `No debe filtrar PII: ${sensitive}`);
        assert.equal(fallbackRes.proposedMaestroWisdom.includes(sensitive), false, `Propuesta no debe filtrar PII: ${sensitive}`);
        assert.equal(fallbackRes.expectedAiBehavior.includes(sensitive), false, `Comportamiento esperado no debe filtrar PII: ${sensitive}`);
    }

    // Simular respuesta de IA intentando devolver PII: verificar re-sanitización post-inferencia
    const origGenerate = ResilientAIClient.generate;
    (ResilientAIClient as any).generate = async () => ({
        text: JSON.stringify({
            category: 'AI_KNOWLEDGE_TRAINING',
            priority: 'HIGH',
            cleanObservation: 'En rampa sobre 4200m contactar a +56 9 8765 4321 o juan@minera.cl',
            currentFichaState: UNDECLARED_FICHA_STATE,
            proposedMaestroWisdom: 'Ajustar umbral de presión por altura; operador RUT 12.345.678-5',
            expectedAiBehavior: 'Alertar pérdida de presión en altura sin datos de -23.6509, -70.3975',
        }),
        tierUsed: 'SECONDARY',
    });

    try {
        const aiScrubbed = await PilotWisdomExtractorService.extractWisdom({
            rawNarrative: 'En rampa sobre 4200 m se requiere alerta temprana',
            module: 'opermaq',
            contextPath: '/opermaq/vault/caex-797',
            countryCode: 'CL',
            preferredLang: 'es',
        });
        assert.equal(aiScrubbed.engineMode, 'GEMINI_SWARM');
        assert.equal(aiScrubbed.cleanObservation.includes('8765 4321'), false);
        assert.equal(aiScrubbed.cleanObservation.includes('juan@minera.cl'), false);
        assert.equal(aiScrubbed.proposedMaestroWisdom.includes('12.345.678-5'), false);
        assert.equal(aiScrubbed.expectedAiBehavior.includes('-23.6509'), false);
    } finally {
        (ResilientAIClient as any).generate = origGenerate;
    }

    // Verificar guard de roles y cero persistencia CAS de audio efímero en POST /feedback/extract-wisdom
    const extractHandler = getPilotRouteHandler('post', '/feedback/extract-wisdom');

    // 1. Usuario B2B normal -> 403
    const b2bRes = createMockRes();
    await extractHandler(
        {
            user: { uid: 'b2b-normal', email: 'op@minera.cl', role: 'OPERATOR', email_verified: true },
            body: { rawNarrative: 'Observación de prueba' },
        },
        b2bRes
    );
    assert.equal(b2bRes.statusCode, 403, 'Usuario B2B regular debe recibir 403 en extract-wisdom');

    // 2. Piloto expirado -> 403 PILOT_ACCOUNT_EXPIRED
    const expiredRes = createMockRes();
    await extractHandler(
        {
            user: {
                uid: 'pilot-exp',
                email: 'exp@minreport.com',
                role: 'TEST_PILOT',
                pilotExpiresAt: Date.now() - 60_000,
                email_verified: true,
            },
            body: { rawNarrative: 'Observación piloto vencido' },
        },
        expiredRes
    );
    assert.equal(expiredRes.statusCode, 403);
    assert.equal(expiredRes.body?.code, 'PILOT_ACCOUNT_EXPIRED');

    // 3. Piloto válido con audio efímero -> 200 sin persistir audio en Storage ni Firestore
    (ResilientAIClient as any).generate = async () => {
        throw new Error('offline-fallback-test');
    };
    try {
        const validPilotRes = createMockRes();
        await extractHandler(
            {
                user: {
                    uid: 'pilot-ok',
                    email: 'maestro75@minreport.com',
                    role: 'TEST_PILOT',
                    pilotExpiresAt: Date.now() + 86_400_000,
                    email_verified: true,
                },
                body: {
                    rawNarrative: 'Revisar presión crítica de freno en bajada con carga completa.',
                    module: 'opermaq',
                    contextPath: '/opermaq/vault/caex',
                    ephemeralAudio: {
                        mimeType: 'audio/webm',
                        dataBase64: Buffer.from('audio-efimero-test-payload').toString('base64'),
                    },
                },
            },
            validPilotRes
        );
        assert.equal(validPilotRes.statusCode, 200);
        assert.equal(validPilotRes.body?.success, true);
        assert.equal(validPilotRes.body?.extraction?.priority, 'CRITICAL');
        assert.equal(storageFiles.size, 0, 'Audio efímero de dictado jamás debe almacenarse en Cloud Storage');
        const totalDocsWritten = Array.from(dbCollections.values()).reduce((sum, colMap) => sum + colMap.size, 0);
        assert.equal(totalDocsWritten, 0, 'Extracción preliminar no debe escribir documentos antes de confirmación del usuario');
    } finally {
        (ResilientAIClient as any).generate = origGenerate;
    }
}

async function testPillar3OrientationAndPillar4AccessHitl(): Promise<void> {
    // 1. Verificar TTL 600s en DevChallengeService.initChallenge
    dbCollections.clear();
    const origSendEmail = EmailService.sendEmail;
    EmailService.sendEmail = async () => ({ id: 'mock-email-ok' } as any);
    try {
        const before = Date.now();
        const challenge = await DevChallengeService.initChallenge('127.0.0.1', 'Mozilla/5.0 Test');
        const deltaMs = challenge.expiresAt - before;
        assert.ok(deltaMs >= 590_000 && deltaMs <= 610_000, `TTL /dev debe ser 600s (obtenido ${deltaMs}ms)`);
    } finally {
        EmailService.sendEmail = origSendEmail;
    }

    // 2. Verificar orientación, Passkey primario, labels visibles /dev y tolerancia 'ACTUALIZAR'
    const clientLayout = fs.readFileSync(path.join(WEB_SRC, 'layouts/ClientLayout.tsx'), 'utf8');
    assert.ok(clientLayout.includes('<ContextOrientationBar'), 'ClientLayout debe montar ContextOrientationBar');
    assert.ok(clientLayout.includes('SIDEBAR_CALLOUT_CLASS'), 'ClientLayout debe mostrar callouts 0ms en iconos laterales');

    const devGateway = fs.readFileSync(path.join(WEB_SRC, 'pages/dev/DevVaultGateway.tsx'), 'utf8');
    assert.ok(devGateway.includes('<ContextOrientationBar'), 'DevVaultGateway debe montar ContextOrientationBar');
    assert.ok(devGateway.includes('formatCountdownMmSs'), 'DevVaultGateway debe renderizar contador MM:SS legible');
    assert.ok(devGateway.includes('htmlFor="dev-login-email"') && devGateway.includes('htmlFor="dev-login-password"'),
        'DevVaultGateway debe mostrar <label> explícitos en autenticación');
    assert.ok(devGateway.includes("'PILOT_METRICS'") && !devGateway.includes('pilot_feedback'),
        'DevVaultGateway debe exponer únicamente monitoreo pasivo PILOT_METRICS sin bandeja pilot_feedback');

    const accessPage = fs.readFileSync(path.join(WEB_SRC, 'pages/AccessPage.tsx'), 'utf8');
    const passkeyPos = accessPage.indexOf("t('core_access.btn_passkey')");
    const emailInputPos = accessPage.indexOf('id="access_email_input"');
    assert.ok(accessPage.includes('<ErgonomicScaleSwitch compact />'), 'AccessPage debe ofrecer control de tamaño visual');
    assert.ok(passkeyPos > 0 && emailInputPos > passkeyPos, 'AccessPage debe priorizar Passkey antes del flujo por correo');

    assert.equal(fs.existsSync(path.join(WEB_SRC, 'components/pilot/TestPilotTransversalHUD.tsx')), false,
        'TestPilotTransversalHUD debe permanecer eliminado por aislamiento hermético 3º TEST-PILOT');

    const devFieldLaunchpad = fs.readFileSync(path.join(WEB_SRC, 'pages/mobile/DevFieldTestLaunchpad.tsx'), 'utf8');
    assert.ok(devFieldLaunchpad.includes('<ReadAloudButton compact'), 'DevFieldTestLaunchpad debe incluir lectura offline');
    assert.ok(devFieldLaunchpad.includes('useXCoverHardwareKey'), 'DevFieldTestLaunchpad debe soportar botón físico XCover Key');

    const pilotWs = fs.readFileSync(path.join(WEB_SRC, 'pages/pilot/TestPilotWorkspace.tsx'), 'utf8');
    assert.equal(pilotWs.includes('p3_reserved_notice'), false, 'TestPilotWorkspace no debe mostrar aviso meta-software en barra lateral');
    assert.ok(pilotWs.includes('<ReadAloudButton compact'), 'TestPilotWorkspace debe incluir lectura offline');

    const copilot = fs.readFileSync(path.join(WEB_SRC, 'components/ai/MiningAICopilot.tsx'), 'utf8');
    assert.equal(copilot.includes('JSON.stringify(raw.currentValues)'), false, 'MiningAICopilot no debe exponer JSON crudo');
    assert.equal(copilot.includes('core_ai.tier_label'), false, 'MiningAICopilot no debe exponer jerga TIER en burbujas');
    assert.ok(copilot.includes(".trim().toUpperCase() !== 'ACTUALIZAR'"), 'MiningAICopilot debe tolerar ACTUALIZAR en minúsculas');

    const kvDashboard = fs.readFileSync(path.join(WEB_SRC, 'modules/opermaq/components/KnowledgeVaultDashboard.tsx'), 'utf8');
    assert.ok(kvDashboard.includes(".trim().toUpperCase() !== 'ACTUALIZAR'"), 'KnowledgeVaultDashboard debe tolerar ACTUALIZAR en aprobación masiva');
    assert.ok(kvDashboard.includes('<ReadAloudButton compact'), 'KnowledgeVaultDashboard debe incluir ReadAloudButton en barra del pilar');

    assert.equal(fs.existsSync(path.join(WEB_SRC, 'modules/opermaq/components/VaultPilotFeedbackBox.tsx')), false,
        'VaultPilotFeedbackBox debe permanecer eliminado de OPERMAQ/DEV');

    // Verificar aislamiento hermético: DEV_ROOT rechazado con 403 en /api/pilot/feedback/:id/status
    dbCollections.clear();
    getCollectionMap('pilot_feedback').set('fb-1', {
        id: 'fb-1',
        tenantId: 'dev-master-sandbox',
        status: 'OPEN',
    });
    const origAuditRecord = AuditLedger.record;
    (AuditLedger as any).record = async () => 'audit-mock';
    try {
        const patchHandler = getPilotRouteHandler('patch', '/feedback/:id/status');
        const patchRes = createMockRes();
        await patchHandler(
            {
                params: { id: 'fb-1' },
                user: { uid: 'dev-master-root-uid', email: 'dev@minreport.com', isMasterDev: true, email_verified: true },
                headers: {},
                body: { status: 'IN_REVIEW', confirmationKeyword: '  actualizar  ' },
            },
            patchRes
        );
        assert.equal(patchRes.statusCode, 403, 'Aislamiento hermético: DEV_ROOT debe recibir 403 en /api/pilot/feedback/:id/status');
    } finally {
        (AuditLedger as any).record = origAuditRecord;
    }
}

async function testPillar5MobileScannerAndSpokenSpecs(): Promise<void> {
    const mobileScannerSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/MobileScanner.tsx'),
        'utf8'
    );
    assert.equal(mobileScannerSrc.includes('animate-spin'), false, 'MobileScanner no debe usar animate-spin');
    assert.ok(mobileScannerSrc.includes('<M3CircularProgress'), 'MobileScanner debe usar M3CircularProgress');
    assert.ok(mobileScannerSrc.includes('<M3LinearProgress'), 'MobileScanner debe usar M3LinearProgress');
    assert.ok(mobileScannerSrc.includes('<SovereignVoiceInput'), 'MobileScanner debe integrar dictado por voz');
    assert.ok(mobileScannerSrc.includes('880') && mobileScannerSrc.includes('vibrate'),
        'MobileScanner debe incluir guía acústica 880Hz y vibración háptica IMU');

    // Pruebas unitarias deterministas parseSpokenStockpileSpecs (ES / EN / PT + cero invención)
    const esParsed = parseSpokenStockpileSpecs(
        'Eje mayor 24,5 metros, eje menor 18 metros, altura 8,2 densidad 1,85 colpa'
    );
    assert.deepEqual(esParsed, {
        baseMajorAxis: '24.5',
        baseMinorAxis: '18',
        totalHeight: '8.2',
        density: '1.85',
        classification: 'COLPA',
    });

    const enParsed = parseSpokenStockpileSpecs(
        'major axis 30.2 minor axis 20 height 9 density 1.95 coarse'
    );
    assert.deepEqual(enParsed, {
        baseMajorAxis: '30.2',
        baseMinorAxis: '20',
        totalHeight: '9',
        density: '1.95',
        classification: 'COLPA',
    });

    const ptParsed = parseSpokenStockpileSpecs(
        'eixo maior 15,5 eixo menor 10,2 altura 4 densidade 2,1 fino'
    );
    assert.deepEqual(ptParsed, {
        baseMajorAxis: '15.5',
        baseMinorAxis: '10.2',
        totalHeight: '4',
        density: '2.1',
        classification: 'FINO',
    });

    const gransaParsed = parseSpokenStockpileSpecs('largo 22 ancho 14 alto 6.5 factor 1.72 gransa');
    assert.deepEqual(gransaParsed, {
        baseMajorAxis: '22',
        baseMinorAxis: '14',
        totalHeight: '6.5',
        density: '1.72',
        classification: 'GRANSA',
    });

    const noNumbers = parseSpokenStockpileSpecs('acopio sector norte revisado sin cinta métrica');
    assert.deepEqual(noNumbers, {}, 'parseSpokenStockpileSpecs jamás debe inventar medidas ausentes');
}

async function main(): Promise<void> {
    await testPillar1OpticalScaleAndTypographyFloor();
    await testPillar2And5PilotWisdomLey21719();
    await testPillar3OrientationAndPillar4AccessHitl();
    await testPillar5MobileScannerAndSpokenSpecs();
    console.log('✅ Universal Accessibility 18-120 Suite (5 Pillars) PASSED');
}

main().catch((err) => {
    console.error('❌ Universal Accessibility 18-120 Suite FAILED:', err);
    process.exit(1);
});
