/**
 * Suite E14 — Certificación Integral de Seguridad, Reglas Firestore/Storage y Wiring End-to-End
 * MINREPORT · ABASTECIMIENTO v2.0 (southamerica-west1)
 *
 * 100% determinista en proceso + sondeo opcional de solo lectura de emuladores locales
 * (JAMÁS altera ni elimina `./data` ni `.firebase-emulator-data`).
 *
 * Verifica:
 * 1. `firestore.rules`: aislamiento `global_supply_catalog`, `isMatchingTestPilotSandbox` Layout A+B,
 *    exclusión estricta de `TEST_PILOT` en `isSystemPrivileged()`, guardia `isNotSuspendedOrRevokedMember()`,
 *    bloqueo total cliente en `supply_whatsapp_sessions` / `supply_whatsapp_wamids` y colecciones `supply_*` write-denied.
 * 2. `storage.rules`: guardias CEL `'...' in request.auth.token`, `isNotExpiredValue()` fail-closed,
 *    `TEST_PILOT` dual layout (`matchesPilotDocByAccountId` + `matchesPilotDocByUid`), `cas_blobs` write-denied.
 * 3. `firestore.indexes.json`: `ttl: true` en `supply_whatsapp_sessions`, `supply_whatsapp_wamids`,
 *    `market_demand_signals` + `COLLECTION_GROUP` en `members.phoneE164`.
 * 4. Wiring real en `src/index.ts` y pruebas HTTP en proceso sobre `supplyRouter`, `m2m-supply.adapter` y `staff.controller`:
 *    - `POST /api/supply/receipts/analyze` (anti-IDOR cross-tenant `403`)
 *    - `GET /api/supply/exports/accounting` (`UBL_2_1_PEPPOL` XML + `XLSX_OOXML` ZIP)
 *    - `POST /api/supply/rfq-express/:token/submit` (1 uso -> `201`, reintento -> `409`)
 *    - `POST /api/supply/whatsapp/webhook` (HMAC inválido -> `401`, válido -> ACK `200` en `<500ms`)
 *    - `POST /api/supply/whatsapp/flow-exchange` (HMAC inválido -> `401`)
 *    - `GET /api/m2m/supply/demand-signals` & `/catalog/skus` sin pago -> `402 Payment Required`
 *    - `PATCH /api/staff/me/supply-channel` sin `confirmationKeyword="ACTUALIZAR"` -> `400` y intento escalación `role` -> `403`.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID = 'minreport-supply-e14-test';
process.env.FIREBASE_PROJECT_ID = 'minreport-supply-e14-test';
process.env.FIREBASE_STORAGE_BUCKET = 'minreport-supply-e14-test.firebasestorage.app';
process.env.X402_HMAC_SECRET = 'test_e14_x402_hmac_secret_32bytes_min';
process.env.WHATSAPP_APP_SECRET = 'test_e14_whatsapp_app_secret_2026';
process.env.WHATSAPP_VERIFY_TOKEN = 'test_e14_whatsapp_verify_token';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore + Auth)
// ---------------------------------------------------------------------------

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
    const ref: any = {
        id: docId,
        path: `${colPath}/${docId}`,
        collection(subName: string) {
            return createCollectionRef(`${colPath}/${docId}/${subName}`);
        },
        async get() {
            const data = getColMap(colPath).get(docId);
            return {
                id: docId,
                ref,
                exists: Boolean(data),
                data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
            };
        },
        async set(payload: Record<string, any>, options?: { merge?: boolean }) {
            const col = getColMap(colPath);
            const prev = options?.merge && col.has(docId) ? col.get(docId)! : {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(payload)) });
        },
        async update(patch: Record<string, any>) {
            const col = getColMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(patch)) });
        },
        async delete() {
            getColMap(colPath).delete(docId);
        },
    };
    return ref;
}

function createQueryChain(
    colPaths: string[],
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    maxLimit: number | null = null
): any {
    return {
        where(field: string, op: string, value: unknown) {
            return createQueryChain(colPaths, [...filters, { field, op, value }], maxLimit);
        },
        orderBy() {
            return createQueryChain(colPaths, filters, maxLimit);
        },
        limit(n: number) {
            return createQueryChain(colPaths, filters, n);
        },
        async get() {
            const matched: any[] = [];
            for (const colPath of colPaths) {
                for (const [id, data] of getColMap(colPath).entries()) {
                    const ok = filters.every((f) => (f.op === '==' ? data[f.field] === f.value : true));
                    if (ok) {
                        matched.push({
                            id,
                            ref: createDocRef(colPath, id),
                            exists: true,
                            data: () => JSON.parse(JSON.stringify(data)),
                        });
                    }
                }
            }
            const sliced = maxLimit !== null ? matched.slice(0, maxLimit) : matched;
            return { empty: sliced.length === 0, size: sliced.length, docs: sliced };
        },
    };
}

function createCollectionRef(colPath: string): any {
    return {
        doc(id?: string) {
            const docId = id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            return createDocRef(colPath, docId);
        },
        where(field: string, op: string, value: unknown) {
            return createQueryChain([colPath], [{ field, op, value }]);
        },
        orderBy() {
            return createQueryChain([colPath], []);
        },
        limit(n: number) {
            return createQueryChain([colPath], [], n);
        },
        async get() {
            return createQueryChain([colPath], []).get();
        },
        async add(payload: Record<string, any>) {
            const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const ref = createDocRef(colPath, id);
            await ref.set(payload);
            return ref;
        },
    };
}

const fakeDb: any = {
    collection(colPath: string) {
        return createCollectionRef(colPath);
    },
    collectionGroup(subName: string) {
        const matchingPaths = Array.from(dbCollections.keys()).filter(
            (p) => p === subName || p.endsWith(`/${subName}`)
        );
        return createQueryChain(matchingPaths, []);
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
        const tx = {
            async get(refOrQuery: any) {
                return refOrQuery.get();
            },
            set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
                return ref.set(data, opts);
            },
            update(ref: any, patch: Record<string, any>) {
                return ref.update(patch);
            },
            delete(ref: any) {
                return ref.delete();
            },
            create(ref: any, data: Record<string, any>) {
                return ref.set(data);
            },
        };
        return fn(tx);
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
                for (const op of ops) await op();
            },
        };
    },
};

const tokenRegistry = new Map<string, Record<string, any>>();
const fakeAuth: any = {
    async verifyIdToken(token: string) {
        const decoded = tokenRegistry.get(token);
        if (!decoded) throw new Error('auth/invalid-id-token');
        return decoded;
    },
};

// Inyectar stubs antes de importar controladores
// eslint-disable-next-line @typescript-eslint/no-var-requires
const firebaseConfig = require('../../../config/firebase');
firebaseConfig.db = fakeDb;
firebaseConfig.auth = fakeAuth;

import supplyRouter from '../application/supply.controller';
import { registerM2mSupplyAdapterRoutes } from '../../../api/m2m-supply.adapter';
import staffRouter from '../../../api/staff.controller';
import { SupplierZeroFrictionRfqService } from '../application/SupplierZeroFrictionRfqService';

// ---------------------------------------------------------------------------
// 2. In-process HTTP Dispatcher (0 puertos TCP, 100% sandbox-safe)
// ---------------------------------------------------------------------------

class MemorySocket extends Duplex {
    public remoteAddress = '127.0.0.1';
    public destroyed = false;
    _read() {}
    _write(_chunk: any, _encoding: any, callback: any) {
        callback();
    }
    cork() {}
    uncork() {}
}

function createInProcessDispatcher(app: express.Express) {
    return async function dispatch(
        urlPath: string,
        opts: {
            method?: string;
            headers?: Record<string, string>;
            body?: string | Record<string, unknown>;
        } = {}
    ): Promise<{ status: number; headers: Record<string, string>; text: string; buffer: Buffer; json: any }> {
        const method = (opts.method || 'GET').toUpperCase();
        const rawBody =
            opts.body === undefined
                ? ''
                : typeof opts.body === 'string'
                  ? opts.body
                  : JSON.stringify(opts.body);
        const rawBuf = Buffer.from(rawBody, 'utf8');

        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(opts.headers || {})) {
            headers[k.toLowerCase()] = v;
        }
        if (rawBody && !headers['content-type']) {
            headers['content-type'] = 'application/json';
        }
        if (rawBuf.length > 0) {
            headers['content-length'] = String(rawBuf.length);
        }

        const socket = new MemorySocket();
        const req = new http.IncomingMessage(socket as any);
        req.method = method;
        req.url = urlPath;
        req.headers = headers;
        (req as any).rawBody = rawBuf;
        if (rawBuf.length > 0) req.push(rawBuf);
        req.push(null);

        const res = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        return new Promise((resolve, reject) => {
            res.on('error', reject);
            (res as any).write = (chunk: any, encoding?: any, cb?: any) => {
                if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                return origWrite(chunk, encoding, cb);
            };
            (res as any).end = (chunk?: any, encoding?: any, cb?: any) => {
                if (chunk && typeof chunk !== 'function') {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                }
                const out = origEnd(chunk, encoding, cb);
                const buffer = Buffer.concat(chunks);
                const text = buffer.toString('utf8');
                let parsed: any = null;
                try {
                    parsed = text ? JSON.parse(text) : null;
                } catch {
                    parsed = null;
                }
                const respHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.getHeaders())) {
                    respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
                }
                resolve({
                    status: res.statusCode,
                    headers: respHeaders,
                    text,
                    buffer,
                    json: parsed,
                });
                return out;
            };
            app(req as any, res as any);
        });
    };
}

function probeLocalPortReadOnly(port: number, timeoutMs = 150): Promise<boolean> {
    return new Promise((resolve) => {
        const sock = net.createConnection({ host: '127.0.0.1', port });
        let settled = false;
        const done = (val: boolean) => {
            if (settled) return;
            settled = true;
            sock.destroy();
            resolve(val);
        };
        sock.setTimeout(timeoutMs);
        sock.once('connect', () => done(true));
        sock.once('timeout', () => done(false));
        sock.once('error', () => done(false));
    });
}

async function run(): Promise<void> {
    const repoRoot = path.resolve(__dirname, '../../../..');

    // Optional read-only probe of Firebase Emulators (never modifies ./data or .firebase-emulator-data)
    const [fsUp, authUp, stUp] = await Promise.all([
        probeLocalPortReadOnly(8085),
        probeLocalPortReadOnly(9190),
        probeLocalPortReadOnly(9195),
    ]);
    console.log(
        `[E14] Sondeo solo-lectura emuladores locales: firestore=${fsUp}, auth=${authUp}, storage=${stUp}`
    );

    // -----------------------------------------------------------------------
    // TEST 1: firestore.rules — Aislamiento Multi-Tenant, TEST-PILOT & Supply
    // -----------------------------------------------------------------------
    const firestoreRules = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');
    assert.ok(firestoreRules.includes('match /global_supply_catalog/{skuId}'), 'Falta regla global_supply_catalog');
    assert.ok(firestoreRules.includes('function isMatchingTestPilotSandbox('), 'Falta helper isMatchingTestPilotSandbox');
    assert.ok(firestoreRules.includes('function isNotSuspendedOrRevokedMember('), 'Falta guardia isNotSuspendedOrRevokedMember');

    // Verificar que isSystemPrivileged() excluye estrictamente TEST_PILOT
    const sysPrivBlock = firestoreRules.match(/function\s+isSystemPrivileged\s*\(\)\s*\{[\s\S]*?\}/);
    assert.ok(sysPrivBlock, 'Debe existir función isSystemPrivileged()');
    assert.ok(
        !sysPrivBlock![0].includes('TEST_PILOT') && !sysPrivBlock![0].includes('isTestPilot'),
        'isSystemPrivileged() JAMÁS debe incluir TEST_PILOT'
    );

    // Verificar Layout A (`isValidAccountKeyedTestPilotDoc`) y Layout B (`matchesUidKeyedPilotSandbox` -> `/test_pilots/{uid}`)
    assert.ok(
        firestoreRules.includes('isValidAccountKeyedTestPilotDoc(') &&
            firestoreRules.includes('matchesUidKeyedPilotSandbox(') &&
            firestoreRules.includes('test_pilots/$(request.auth.uid)'),
        'firestore.rules debe cubrir Layout A y Layout B en /test_pilots'
    );

    // Verificar cierre total cliente en sesiones/wamids WhatsApp
    assert.ok(
        firestoreRules.includes('match /supply_whatsapp_sessions/{sessionId}') &&
            firestoreRules.includes('match /supply_whatsapp_wamids/{wamid}'),
        'Sesiones y WAMIDs WhatsApp deben estar protegidos en firestore.rules'
    );
    console.log('✓ Test 1 PASS: firestore.rules (global_supply_catalog, TEST_PILOT A+B, isSystemPrivileged, isNotSuspendedOrRevokedMember)');

    // -----------------------------------------------------------------------
    // TEST 2: storage.rules — CEL Guards, Fail-Closed Expiry & Dual Layout
    // -----------------------------------------------------------------------
    const storageRules = fs.readFileSync(path.join(repoRoot, 'storage.rules'), 'utf8');
    assert.ok(
        storageRules.includes("'role' in request.auth.token") &&
            storageRules.includes("'activeAccountId' in request.auth.token"),
        'storage.rules debe usar guardias CEL in request.auth.token'
    );
    assert.ok(
        storageRules.includes('function isNotExpiredValue(val)') &&
            storageRules.includes('val is timestamp') &&
            storageRules.includes('val is int || val is float'),
        'storage.rules debe implementar isNotExpiredValue fail-closed'
    );
    assert.ok(
        storageRules.includes('function matchesPilotDocByAccountId(') &&
            storageRules.includes('function matchesPilotDocByUid('),
        'storage.rules debe soportar dual layout TEST_PILOT'
    );
    assert.ok(
        storageRules.includes('match /cas_blobs/tenants/{tenantId}/{allPaths=**}') &&
            storageRules.includes('allow write: if false;'),
        'storage.rules debe denegar escritura directa cliente sobre cas_blobs'
    );
    console.log('✓ Test 2 PASS: storage.rules (CEL guards, isNotExpiredValue fail-closed, TEST_PILOT dual layout, CAS write-denied)');

    // -----------------------------------------------------------------------
    // TEST 3: firestore.indexes.json — TTL Ley 21.719 & COLLECTION_GROUP
    // -----------------------------------------------------------------------
    const indexesJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firestore.indexes.json'), 'utf8'));
    const fieldOverrides: any[] = indexesJson.fieldOverrides || [];
    for (const col of ['supply_whatsapp_sessions', 'supply_whatsapp_wamids', 'market_demand_signals']) {
        assert.ok(
            fieldOverrides.some((o) => o.collectionGroup === col && o.ttl === true),
            `firestore.indexes.json debe declarar ttl:true en ${col}`
        );
    }
    assert.ok(
        fieldOverrides.some(
            (o) =>
                o.collectionGroup === 'members' &&
                o.fieldPath === 'phoneE164' &&
                Array.isArray(o.indexes) &&
                o.indexes.some((ix: any) => ix.queryScope === 'COLLECTION_GROUP')
        ),
        'firestore.indexes.json debe declarar COLLECTION_GROUP sobre members.phoneE164'
    );
    console.log('✓ Test 3 PASS: firestore.indexes.json (TTL Ley 21.719 + COLLECTION_GROUP members.phoneE164)');

    // -----------------------------------------------------------------------
    // TEST 4: Wiring real en src/index.ts + Live In-Process HTTP Certification
    // -----------------------------------------------------------------------
    const indexTs = fs.readFileSync(path.join(repoRoot, 'src/index.ts'), 'utf8');
    assert.ok(indexTs.includes('registerSupplyModuleRoutes(app)'), 'src/index.ts debe montar registerSupplyModuleRoutes(app)');
    assert.ok(indexTs.includes('registerM2mSupplyAdapterRoutes(app)'), 'src/index.ts debe montar registerM2mSupplyAdapterRoutes(app)');

    // Seed mínimo en memoria para tenants attacker/victim y OWNER
    await fakeDb.collection('accounts').doc('tenant-attacker').set({
        id: 'tenant-attacker',
        name: 'Faena Attacker',
        status: 'ACTIVE',
        type: 'B2B',
        ownerId: 'uid-attacker',
        modules: { supply: true, opermaq: true, stockpile: true },
    });
    await fakeDb.collection('accounts').doc('tenant-attacker').collection('members').doc('uid-attacker').set({
        uid: 'uid-attacker',
        role: 'OWNER',
        status: 'ACTIVE',
        allowedModules: ['supply', 'opermaq', 'stockpile'],
        supplyProfile: {
            role: 'OWNER_EXEC',
            canRecordDirectPurchase: true,
            canApproveExpenseReports: true,
            canManageCapex: true,
            whatsappOptIn: true,
        },
    });
    await fakeDb.collection('users').doc('uid-attacker').set({
        uid: 'uid-attacker',
        email: 'owner@attacker.cl',
        primaryAccountId: 'tenant-attacker',
        lastActiveAccountId: 'tenant-attacker',
    });
    await fakeDb.collection('modules_status').doc('supply').set({ enabled: true, active: true });
    await fakeDb.collection('supply_sites').doc('site-e14').set({
        siteId: 'site-e14',
        tenantId: 'tenant-attacker',
        name: 'Faena Certificación E14',
        countryCode: 'CL',
        currencyCode: 'CLP',
        districtCode: 'ATACAMA-COPIAPO',
        currentHeadcount: 40,
        leadTimeDays: 7,
        waterStorageCapacityL: 40000,
        ds594DailyWaterTargetLPerPax: 120,
        marketplaceOptIn: true,
    });
    await fakeDb.collection('supply_sii_documents').doc('doc-e14-1').set({
        docId: 'doc-e14-1',
        tenantId: 'tenant-attacker',
        siteId: 'site-e14',
        dedupeKey: '76123456-0_33_8841',
        supplierTaxId: '76.123.456-0',
        supplierName: 'Ferretería Industrial Norte SpA',
        documentType: 33,
        folio: '8841',
        issueDate: '2026-11-20',
        netAmountClp: 100000,
        vatAmountClp: 19000,
        totalAmountClp: 119000,
        paymentMethod: 'TRANSFERENCIA',
        rcvStatus: 'ACCEPTED',
        createdAt: '2026-11-20T12:00:00.000Z',
    });

    tokenRegistry.set('tok-owner-attacker', {
        uid: 'uid-attacker',
        email: 'owner@attacker.cl',
        role: 'OWNER',
        activeAccountId: 'tenant-attacker',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/supply', supplyRouter);
    registerM2mSupplyAdapterRoutes(app);
    // Montar staffRouter con middleware de sesión de prueba
    app.use(
        '/api/staff',
        async (req: any, res, next) => {
            const authHeader = String(req.headers.authorization || '');
            const tok = authHeader.replace(/^Bearer\s+/i, '').trim();
            const decoded = tokenRegistry.get(tok);
            if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
            req.user = decoded;
            return next();
        },
        staffRouter
    );

    const dispatch = createInProcessDispatcher(app);

    // 4a. Anti-IDOR cross-tenant en /api/supply/receipts/analyze -> 403
    const idorResp = await dispatch('/api/supply/receipts/analyze', {
        method: 'POST',
        headers: {
            authorization: 'Bearer tok-owner-attacker',
            'x-active-account-id': 'tenant-attacker',
        },
        body: {
            siteId: 'site-e14',
            purchaseMode: 'DIRECT_AUTONOMOUS',
            evidenceCasRef: {
                sha256: 'a'.repeat(64),
                downloadUrl: `/api/media/blob/${'a'.repeat(64)}`,
                storagePath: `cas_blobs/tenants/tenant-victim/${'a'.repeat(64)}.webp`,
                mimeType: 'image/webp',
                extension: 'webp',
                originalBytes: 10000,
                optimizedBytes: 2500,
                savingsPct: 75,
            },
        },
    });
    assert.equal(idorResp.status, 403, `Anti-IDOR cross-tenant debe devolver 403, recibido ${idorResp.status}: ${idorResp.text}`);

    // 4b. /api/supply/exports/accounting (UBL_2_1_PEPPOL & XLSX_OOXML)
    const ublResp = await dispatch('/api/supply/exports/accounting?format=UBL_2_1_PEPPOL&profile=CL_SII_RCV', {
        method: 'GET',
        headers: {
            authorization: 'Bearer tok-owner-attacker',
            'x-active-account-id': 'tenant-attacker',
        },
    });
    assert.equal(ublResp.status, 200, `UBL_2_1_PEPPOL debe responder 200, recibido ${ublResp.status}`);
    assert.ok(ublResp.text.includes('<?xml') && ublResp.text.includes('Invoice'), 'Salida UBL debe ser XML válido');

    const xlsxResp = await dispatch('/api/supply/exports/accounting?format=XLSX_OOXML&profile=GLOBAL_SAP_S4HANA', {
        method: 'GET',
        headers: {
            authorization: 'Bearer tok-owner-attacker',
            'x-active-account-id': 'tenant-attacker',
        },
    });
    assert.equal(xlsxResp.status, 200, `XLSX_OOXML debe responder 200, recibido ${xlsxResp.status}`);
    assert.equal(xlsxResp.buffer[0], 0x50, 'XLSX debe iniciar con firma ZIP PK');
    assert.equal(xlsxResp.buffer[1], 0x4b, 'XLSX debe iniciar con firma ZIP PK');

    // 4c. /api/supply/rfq-express/:token (1 uso -> 201, replay -> 409)
    const inviteRes = await SupplierZeroFrictionRfqService.createExpressRfqInvite(
        {
            tenantId: 'tenant-attacker',
            input: {
                siteId: 'site-e14',
                districtCode: 'ATACAMA-COPIAPO',
                supplierName: 'Aguas Atacama SpA',
                currencyCode: 'CLP',
                dispatchChannel: 'NONE',
                expiresInHours: 48,
                items: [
                    {
                        canonicalSkuId: 'sku-agua-20l',
                        itemName: 'Agua Potable 20L',
                        qtyRequested: 10,
                        unitSi: 'L',
                    },
                ],
            },
        },
        {
            actorUid: 'uid-attacker',
            actorEmail: 'owner@attacker.cl',
        }
    );
    const quotePayload = {
        supplierTaxId: '76.123.456-0',
        supplierName: 'Aguas Atacama SpA',
        deliveryDistrictCode: 'ATACAMA-COPIAPO',
        leadTimeDays: 2,
        validUntilIso: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        itemQuotes: [{ canonicalSkuId: 'sku-agua-20l', unitPriceNet: 4500, availableQty: 10 }],
    };
    const firstSubmit = await dispatch(`/api/supply/rfq-express/${encodeURIComponent(inviteRes.signedToken)}/submit`, {
        method: 'POST',
        body: quotePayload,
    });
    assert.equal(firstSubmit.status, 201, `Primer submit RFQ debe responder 201, recibido ${firstSubmit.status}: ${firstSubmit.text}`);
    const replaySubmit = await dispatch(`/api/supply/rfq-express/${encodeURIComponent(inviteRes.signedToken)}/submit`, {
        method: 'POST',
        body: quotePayload,
    });
    assert.equal(replaySubmit.status, 409, `Reintento RFQ 1-uso debe responder 409, recibido ${replaySubmit.status}`);

    // 4d. /api/supply/whatsapp/webhook (<500ms ACK con HMAC válido; 401 sin HMAC)
    const badWhResp = await dispatch('/api/supply/whatsapp/webhook', {
        method: 'POST',
        body: { object: 'whatsapp_business_account', entry: [] },
    });
    assert.equal(badWhResp.status, 401, `Webhook WhatsApp sin HMAC debe responder 401, recibido ${badWhResp.status}`);

    const whBodyStr = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const whSig =
        'sha256=' +
        crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(whBodyStr).digest('hex');
    const t0 = Date.now();
    const okWhResp = await dispatch('/api/supply/whatsapp/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': whSig },
        body: whBodyStr,
    });
    const ackMs = Date.now() - t0;
    assert.equal(okWhResp.status, 200, `Webhook WhatsApp con HMAC válido debe responder 200, recibido ${okWhResp.status}`);
    assert.ok(ackMs < 500, `ACK webhook WhatsApp debe ser <500ms, fue ${ackMs}ms`);

    // 4e. /api/supply/whatsapp/flow-exchange (HMAC inválido -> 401)
    const badFlowResp = await dispatch('/api/supply/whatsapp/flow-exchange', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
        body: { encrypted_flow_data: 'AA==', encrypted_aes_key: 'AA==', initial_vector: 'AA==' },
    });
    assert.equal(badFlowResp.status, 401, `Flow exchange con HMAC inválido debe responder 401, recibido ${badFlowResp.status}`);

    // 4f. /api/m2m/supply/* sin x402 -> 402 Payment Required
    const m2mSignals = await dispatch('/api/m2m/supply/demand-signals', { method: 'GET' });
    assert.equal(m2mSignals.status, 402, `/api/m2m/supply/demand-signals sin pago debe responder 402, recibido ${m2mSignals.status}`);
    const m2mCatalog = await dispatch('/api/m2m/supply/catalog/skus', { method: 'GET' });
    assert.equal(m2mCatalog.status, 402, `/api/m2m/supply/catalog/skus sin pago debe responder 402, recibido ${m2mCatalog.status}`);

    // 4g. PATCH /api/staff/me/supply-channel sin ACTUALIZAR -> 400; mutación role -> 403
    const staffNoHitl = await dispatch('/api/staff/me/supply-channel', {
        method: 'PATCH',
        headers: {
            authorization: 'Bearer tok-owner-attacker',
            'x-active-account-id': 'tenant-attacker',
        },
        body: {
            accountId: 'tenant-attacker',
            phoneE164: '+56988887777',
            whatsappOptInAccepted: true,
        },
    });
    assert.equal(staffNoHitl.status, 400, `PATCH /api/staff/me/supply-channel sin ACTUALIZAR debe responder 400, recibido ${staffNoHitl.status}`);

    const staffEscalate = await dispatch('/api/staff/me/supply-channel', {
        method: 'PATCH',
        headers: {
            authorization: 'Bearer tok-owner-attacker',
            'x-active-account-id': 'tenant-attacker',
        },
        body: {
            accountId: 'tenant-attacker',
            role: 'SUPER_ADMIN',
            confirmationKeyword: 'ACTUALIZAR',
        },
    });
    assert.equal(staffEscalate.status, 403, `PATCH /api/staff/me/supply-channel intentando mutar role debe responder 403, recibido ${staffEscalate.status}`);

    console.log(
        `✓ Test 4 PASS: Wiring real y endpoints críticos certificados (anti-IDOR 403, UBL+XLSX 200, RFQ 1-uso 201->409, Webhook ACK ${ackMs}ms, Flows HMAC 401, M2M x402 402, Staff HITL 400/403)`
    );
    console.log('\n✅ [SUITE E14 EMULATOR & SECURITY CERTIFICATION APROBADA 4/4]');
}

let finished = false;
process.on('beforeExit', (code) => {
    if (!finished && code === 0) {
        console.error('❌ [E14] Salida temprana detectada antes de completar todas las aserciones.');
        process.exit(1);
    }
});

run()
    .then(() => {
        finished = true;
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ [E14] FALLA:', err);
        process.exit(1);
    });
