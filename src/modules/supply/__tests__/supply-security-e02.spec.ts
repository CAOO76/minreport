/**
 * Suite de Seguridad Etapa E02 — MINREPORT · ABASTECIMIENTO
 *
 * Verifica determinísticamente los hallazgos P0-03, P1-02, P1-04 y P1-05:
 * 1. RBAC solo lectura (`VIEWER` y `BILLING_ONLY` -> 403 `SUPPLY_RBAC_READ_ONLY`, sin promoción a `CAMP_MANAGER`),
 *    entitlements vía `resolveModuleSessionScope('supply')`, bloqueo `marketplaceOptIn` en `5º EDU` y `3º TEST-PILOT`,
 *    y guards CAPEX (`CAPEX_NOT_AUTHORIZED`) + compra directa (`DIRECT_PURCHASE_FORBIDDEN`).
 * 2. Segregación de funciones ISO 27001 en `PATCH /sii/expense-reports/:reportId`:
 *    - Auto-aprobación del custodio rechazada con 403 (`SELF_APPROVAL_FORBIDDEN`)
 *    - Aprobación por tercero autorizado pasa (`200`).
 * 3. Doble rendición del mismo `siiDocumentId` rechazada atómicamente con 409 (`SII_DOC_ALREADY_REPORTED`).
 * 4. Sobre-recepción en `confirmPurchaseReception` rechazada con 409 (`OVER_RECEIVE_NOT_ALLOWED`),
 *    cantidades negativas con 400, mientras 2 recepciones parciales acumulan `qtyReceivedSoFar` hasta completar.
 * 5. `GET /forecast` ejecuta 0 escrituras en Firestore; `POST /forecast/recalculate` persiste bajo demanda.
 * 6. `x402` en `/api/m2m/supply/rfq-quotes`: sin pago -> 402; `maxAvailableQty < minOrderQty` o `validUntilIso`
 *    pasada -> 400; si `AuditLedger.record` falla -> 500 (`AUDIT_LEDGER_UNAVAILABLE`) y cotización revertida.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID ||= 'minreport-supply-e02-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-supply-e02-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-supply-e02-test.firebasestorage.app';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria con contador de escrituras Firestore
// ---------------------------------------------------------------------------

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const mockTokens = new Map<string, Record<string, any>>();
let firestoreWriteCount = 0;

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
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
            const data = getCollectionMap(colPath).get(docId);
            return {
                id: docId,
                ref,
                exists: Boolean(data),
                data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
            };
        },
        async set(payload: Record<string, any>, options?: { merge?: boolean }) {
            firestoreWriteCount += 1;
            const col = getCollectionMap(colPath);
            const prev = options?.merge && col.has(docId) ? col.get(docId)! : {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(payload)) });
        },
        async update(patch: Record<string, any>) {
            firestoreWriteCount += 1;
            const col = getCollectionMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(patch)) });
        },
        async delete() {
            firestoreWriteCount += 1;
            getCollectionMap(colPath).delete(docId);
        },
    };
    return ref;
}

function createQueryChain(
    colPaths: string[],
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    maxLimit = 1000
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
                for (const [id, data] of getCollectionMap(colPath).entries()) {
                    const ok = filters.every((f) => {
                        if (f.op === '==') return data[f.field] === f.value;
                        return true;
                    });
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
            const sliced = matched.slice(0, maxLimit);
            return { empty: sliced.length === 0, size: sliced.length, docs: sliced };
        },
    };
}

function createCollectionRef(colPath: string): any {
    let autoSeq = 1;
    return {
        doc(docId?: string) {
            const id = docId || `auto_${colPath.replace(/\//g, '_')}_${Date.now()}_${autoSeq++}`;
            return createDocRef(colPath, id);
        },
        async add(payload: Record<string, any>) {
            const ref = createDocRef(colPath, `add_${Date.now()}_${autoSeq++}`);
            await ref.set(payload);
            return ref;
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
    };
}

const mockDb: any = {
    collection(colName: string) {
        return createCollectionRef(colName);
    },
    collectionGroup(subCollectionName: string) {
        const matchingPaths = Array.from(dbCollections.keys()).filter(
            (p) => p === subCollectionName || p.endsWith(`/${subCollectionName}`)
        );
        return createQueryChain(matchingPaths, []);
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
        // Simula aislamiento transaccional real: valida read-before-write y aplica escrituras solo si fn resuelve
        let writeStarted = false;
        const pendingOps: Array<() => Promise<void>> = [];
        const tx = {
            async get(ref: any) {
                if (writeStarted) {
                    throw new Error('Firestore transactions require all reads to be executed before all writes.');
                }
                return ref.get();
            },
            set(ref: any, data: any, opts?: any) {
                writeStarted = true;
                pendingOps.push(() => ref.set(data, opts));
                return tx;
            },
            update(ref: any, patch: any) {
                writeStarted = true;
                pendingOps.push(() => ref.update(patch));
                return tx;
            },
            delete(ref: any) {
                writeStarted = true;
                pendingOps.push(() => ref.delete());
                return tx;
            },
        };
        const result = await fn(tx);
        for (const op of pendingOps) {
            await op();
        }
        return result;
    },
};

const mockAuth: any = {
    async verifyIdToken(token: string) {
        const payload = mockTokens.get(token);
        if (!payload) throw new Error('auth/invalid-token');
        return payload;
    },
};

const mockStorage: any = {
    bucket() {
        return {
            file() {
                return {
                    async save() {},
                    async getMetadata() {
                        throw new Error('Not found');
                    },
                    async download() {
                        throw new Error('Not found');
                    },
                };
            },
        };
    },
};

const mockAdmin: any = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: Object.assign(() => mockDb, {
        FieldValue: {
            serverTimestamp: () => Date.now(),
            increment: (n: number) => n,
            delete: () => undefined,
        },
        Timestamp: {
            fromMillis: (ms: number) => ({ toMillis: () => ms }),
        },
    }),
    auth: () => mockAuth,
    storage: () => mockStorage,
};

function installStub(relPathFromRoot: string, exportsObj: any): void {
    const resolved = require.resolve(path.resolve(__dirname, '../../../..', relPathFromRoot));
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exportsObj,
    } as any;
}

installStub('src/config/firebase.ts', {
    __esModule: true,
    default: mockAdmin,
    db: mockDb,
    auth: mockAuth,
    storage: mockStorage,
});

// ---------------------------------------------------------------------------
// 2. Importar módulos bajo prueba
// ---------------------------------------------------------------------------

import { registerM2mSupplyAdapterRoutes } from '../../../api/m2m-supply.adapter';
import { AuditLedger } from '../../../core/audit-ledger';
import { SUPPLY_COLLECTIONS } from '../application/SupplyRepository';
import supplyRouter, {
    requireSupplyTenantScope,
    type SupplyRequest,
} from '../application/supply.controller';

function createInProcessDispatcher(app: express.Express) {
    return (
        urlPath: string,
        options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
    ): Promise<{ status: number; json: any }> =>
        new Promise((resolve, reject) => {
            const rawChunks: Buffer[] = [];
            const socket: any = new Duplex({
                read() {},
                write(chunk, _encoding, callback) {
                    rawChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    callback();
                },
            });
            socket.remoteAddress = '127.0.0.1';
            socket.remotePort = 50000;
            socket.writable = true;
            socket.readable = true;
            socket.destroy = () => socket;
            socket.setTimeout = () => socket;
            socket.setNoDelay = () => socket;
            socket.setKeepAlive = () => socket;

            const req = new http.IncomingMessage(socket);
            req.method = (options.method || 'GET').toUpperCase();
            req.url = urlPath;

            const bodyBuf =
                options.body !== undefined
                    ? Buffer.from(JSON.stringify(options.body), 'utf8')
                    : Buffer.alloc(0);

            const normalizedHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(options.headers || {})) {
                normalizedHeaders[k.toLowerCase()] = v;
            }
            if (bodyBuf.length > 0) {
                normalizedHeaders['content-type'] = normalizedHeaders['content-type'] || 'application/json';
                normalizedHeaders['content-length'] = String(bodyBuf.length);
            }
            req.headers = normalizedHeaders;

            const res = new http.ServerResponse(req);
            res.assignSocket(socket);

            res.on('finish', () => {
                const rawResponse = Buffer.concat(rawChunks);
                const sepIdx = rawResponse.indexOf('\r\n\r\n');
                const bodyPart = sepIdx >= 0 ? rawResponse.subarray(sepIdx + 4) : Buffer.alloc(0);
                const transferEncoding = String(res.getHeader('transfer-encoding') || '').toLowerCase();
                let finalBodyBuf = bodyPart;
                if (transferEncoding.includes('chunked')) {
                    const decodedParts: Buffer[] = [];
                    let offset = 0;
                    while (offset < bodyPart.length) {
                        const lineEnd = bodyPart.indexOf('\r\n', offset);
                        if (lineEnd < 0) break;
                        const sizeHex = bodyPart.subarray(offset, lineEnd).toString('ascii').trim();
                        const chunkSize = parseInt(sizeHex, 16);
                        if (!Number.isFinite(chunkSize) || chunkSize <= 0) break;
                        const chunkStart = lineEnd + 2;
                        decodedParts.push(bodyPart.subarray(chunkStart, chunkStart + chunkSize));
                        offset = chunkStart + chunkSize + 2;
                    }
                    finalBodyBuf = Buffer.concat(decodedParts);
                }

                const text = finalBodyBuf.toString('utf8');
                let json: any = null;
                try {
                    json = JSON.parse(text);
                } catch {
                    json = { raw: text };
                }
                resolve({ status: res.statusCode || 0, json });
            });

            res.on('error', reject);
            if (bodyBuf.length > 0) req.push(bodyBuf);
            req.push(null);

            (app as any)(req, res);
        });
}

async function runTests(): Promise<void> {
    const TENANT_B2B = 'tenant-atacama-e02';
    const TENANT_NO_SUPPLY = 'tenant-no-supply-e02';
    const TENANT_EDU = 'edu-u-atacama-e02';
    const PILOT_UID = 'uid-pilot-e02';
    const PILOT_SANDBOX = 'pilot-e02-sandbox';
    const SITE_ID = 'site-faena-e02';
    const futureExpiry = Date.now() + 24 * 60 * 60 * 1000;

    // Seed accounts
    await mockDb.collection('accounts').doc(TENANT_B2B).set({
        id: TENANT_B2B,
        ownerId: 'uid-owner',
        type: 'B2B',
        status: 'ACTIVE',
        entitlements: {
            basePackage: 'OPERMAQ_BASE',
            addonModules: { supply: { active: true } },
        },
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, supply: true } },
    });

    await mockDb.collection('accounts').doc(TENANT_NO_SUPPLY).set({
        id: TENANT_NO_SUPPLY,
        ownerId: 'uid-nosupply',
        type: 'B2B',
        status: 'ACTIVE',
        entitlements: {
            basePackage: 'OPERMAQ_BASE',
            addonModules: { supply: { active: false } },
        },
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, supply: false } },
    });

    await mockDb.collection('accounts').doc(TENANT_EDU).set({
        id: TENANT_EDU,
        ownerId: 'uid-edu-prof',
        type: 'EDUCATIONAL',
        classification: 'edu',
        isEduSandbox: true,
        status: 'ACTIVE',
        entitlements: {
            basePackage: 'ACADEMIC_SANDBOX',
            addonModules: { supply: { active: true } },
        },
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, supply: true } },
    });

    await mockDb.collection('test_pilots').doc(PILOT_SANDBOX).set({
        id: PILOT_SANDBOX,
        accountId: PILOT_SANDBOX,
        userId: PILOT_UID,
        status: 'ACTIVE',
        expiresAt: futureExpiry,
    });
    await mockDb.collection('accounts').doc(PILOT_SANDBOX).set({
        id: PILOT_SANDBOX,
        ownerId: PILOT_UID,
        type: 'TEST_PILOT',
        status: 'ACTIVE',
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, stockpile: true, supply: true } },
    });

    // Seed site
    await mockDb.collection(SUPPLY_COLLECTIONS.SITES).doc(SITE_ID).set({
        siteId: SITE_ID,
        tenantId: TENANT_B2B,
        name: 'Faena E02 Norte',
        districtCode: 'CL-ATACAMA',
        shiftPattern: '7x7',
        currentHeadcount: 30,
        waterStorageCapacityL: 30000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
        marketplaceOptIn: false,
        roleMismatchMode: 'FLAG_AND_ACCEPT',
        directPurchaseAlertThresholdClp: 500000,
    });

    // Seed members on TENANT_B2B
    const membersCol = mockDb.collection('accounts').doc(TENANT_B2B).collection('members');
    await membersCol.doc('uid-owner').set({
        uid: 'uid-owner',
        role: 'OWNER',
        status: 'ACTIVE',
        supplyProfile: {
            role: 'OWNER_EXEC',
            canRecordDirectPurchase: true,
            autoApproveDirectPurchase: true,
            allowCapex: true,
        },
    });
    await membersCol.doc('uid-site-admin').set({
        uid: 'uid-site-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        supplyProfile: {
            role: 'SITE_ADMIN',
            canRecordDirectPurchase: true,
            autoApproveDirectPurchase: false,
            allowCapex: true,
        },
    });
    await membersCol.doc('uid-buyer-nocapex').set({
        uid: 'uid-buyer-nocapex',
        role: 'OPERATOR',
        status: 'ACTIVE',
        allowedModules: { opermaq: true, supply: true },
        supplyProfile: {
            role: 'BUYER',
            canRecordDirectPurchase: true,
            autoApproveDirectPurchase: false,
            allowCapex: false,
        },
    });
    await membersCol.doc('uid-camp').set({
        uid: 'uid-camp',
        role: 'OPERATOR',
        status: 'ACTIVE',
        allowedModules: { opermaq: true, supply: true },
        supplyProfile: {
            role: 'CAMP_MANAGER',
            canRecordDirectPurchase: false,
            autoApproveDirectPurchase: false,
            allowCapex: false,
        },
    });
    await membersCol.doc('uid-viewer').set({
        uid: 'uid-viewer',
        role: 'VIEWER',
        status: 'ACTIVE',
        allowedModules: { opermaq: true, supply: true },
    });
    await membersCol.doc('uid-billing').set({
        uid: 'uid-billing',
        role: 'BILLING_ONLY',
        status: 'ACTIVE',
    });

    // Seed users + tokens
    await mockDb.collection('users').doc('uid-edu-prof').set({
        uid: 'uid-edu-prof',
        role: 'PROFESSOR',
        status: 'ACTIVE',
        primaryAccountId: TENANT_EDU,
    });
    await mockDb.collection('users').doc(PILOT_UID).set({
        uid: PILOT_UID,
        role: 'TEST_PILOT',
        status: 'ACTIVE',
        primaryAccountId: PILOT_SANDBOX,
        pilotExpiresAt: futureExpiry,
    });

    mockTokens.set('tok-owner', { uid: 'uid-owner', email: 'owner@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-site-admin', { uid: 'uid-site-admin', email: 'admin@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-buyer', { uid: 'uid-buyer-nocapex', email: 'buyer@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-camp', { uid: 'uid-camp', email: 'camp@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-viewer', { uid: 'uid-viewer', email: 'viewer@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-billing', { uid: 'uid-billing', email: 'billing@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-nosupply', { uid: 'uid-nosupply', email: 'no@e02.cl', email_verified: true, activeAccountId: TENANT_NO_SUPPLY });
    mockTokens.set('tok-edu', { uid: 'uid-edu-prof', email: 'prof@edu.cl', email_verified: true, role: 'PROFESSOR', activeAccountId: TENANT_EDU });
    mockTokens.set('tok-pilot', {
        uid: PILOT_UID,
        email: 'pilot@minreport.com',
        email_verified: true,
        role: 'TEST_PILOT',
        activeAccountId: PILOT_SANDBOX,
        pilotExpiresAt: futureExpiry,
    });

    // Seed anonymous demand signal (k >= 3) for M2M RFQ tests
    await mockDb.collection(SUPPLY_COLLECTIONS.MARKET_DEMAND_SIGNALS).doc('sig_CL-ATACAMA_sku-cemento').set({
        signalId: 'sig_CL-ATACAMA_sku-cemento',
        districtCode: 'CL-ATACAMA',
        canonicalSkuId: 'sku-cemento',
        skuName: 'Cemento Portland',
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        procurementBucket: 'FERRETERIA',
        unitSi: 'kg',
        aggregatedQty: 500,
        participatingEntitiesCount: 4,
        optInVerified: true,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    });

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.get('/__test/supply-ctx', requireSupplyTenantScope, (req: SupplyRequest, res) => {
        res.status(200).json({ ctx: req.supplyContext });
    });
    app.use('/api/supply', supplyRouter);
    registerM2mSupplyAdapterRoutes(app);

    const dispatch = createInProcessDispatcher(app);

    // =========================================================================
    // TEST 1: Entitlements, VIEWER/BILLING_ONLY read-only, Sandbox marketplaceOptIn, CAPEX/Direct RBAC
    // =========================================================================
    {
        // Cuenta sin entitlement supply -> 403 desde resolveModuleSessionScope('supply')
        const noSupplyRes = await dispatch('/api/supply/sites', {
            headers: { Authorization: 'Bearer tok-nosupply' },
        });
        assert.equal(noSupplyRes.status, 403, 'Cuenta sin entitlement supply debe ser rechazada con 403');

        // VIEWER: GET permitido, canMutate=false, NO promovido a CAMP_MANAGER, mutaciones -> 403 SUPPLY_RBAC_READ_ONLY
        const viewerCtx = await dispatch('/__test/supply-ctx', {
            headers: { Authorization: 'Bearer tok-viewer' },
        });
        assert.equal(viewerCtx.status, 200);
        assert.equal(viewerCtx.json.ctx.canMutate, false);
        assert.notEqual(viewerCtx.json.ctx.supplyProfile.role, 'CAMP_MANAGER');
        assert.equal(viewerCtx.json.ctx.supplyProfile.allowCapex, false);
        assert.equal(viewerCtx.json.ctx.supplyProfile.canRecordDirectPurchase, false);

        const viewerMut = await dispatch('/api/supply/requisitions', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-viewer' },
            body: {
                siteId: SITE_ID,
                lines: [{ rawDescription: 'Papas', qtyRequested: 5, unitSi: 'kg' }],
            },
        });
        assert.equal(viewerMut.status, 403);
        assert.equal(viewerMut.json.code, 'SUPPLY_RBAC_READ_ONLY');

        // BILLING_ONLY: GET permitido, canMutate=false, mutaciones -> 403 SUPPLY_RBAC_READ_ONLY
        const billingGet = await dispatch('/api/supply/sii/documents', {
            headers: { Authorization: 'Bearer tok-billing' },
        });
        assert.equal(billingGet.status, 200);

        const billingCtx = await dispatch('/__test/supply-ctx', {
            headers: { Authorization: 'Bearer tok-billing' },
        });
        assert.equal(billingCtx.status, 200);
        assert.equal(billingCtx.json.ctx.canMutate, false);
        assert.notEqual(billingCtx.json.ctx.supplyProfile.role, 'CAMP_MANAGER');

        const billingMut = await dispatch('/api/supply/sites', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-billing' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                name: 'Faena Ilegal',
                districtCode: 'CL-ATACAMA',
            },
        });
        assert.equal(billingMut.status, 403);
        assert.equal(billingMut.json.code, 'SUPPLY_RBAC_READ_ONLY');

        // 5º EDU y 3º TEST-PILOT bloqueados de activar marketplaceOptIn: true
        for (const tok of ['tok-edu', 'tok-pilot']) {
            const optInBlocked = await dispatch('/api/supply/sites', {
                method: 'POST',
                headers: { Authorization: `Bearer ${tok}` },
                body: {
                    confirmationKeyword: 'ACTUALIZAR',
                    name: 'Faena Sandbox',
                    districtCode: 'CL-ATACAMA',
                    marketplaceOptIn: true,
                },
            });
            assert.equal(optInBlocked.status, 403, `${tok} no debe poder activar marketplaceOptIn`);
            assert.equal(optInBlocked.json.code, 'MARKETPLACE_OPT_IN_FORBIDDEN_IN_SANDBOX');

            const optInOffOk = await dispatch('/api/supply/sites', {
                method: 'POST',
                headers: { Authorization: `Bearer ${tok}` },
                body: {
                    confirmationKeyword: 'ACTUALIZAR',
                    name: 'Faena Sandbox OK',
                    districtCode: 'CL-ATACAMA',
                    marketplaceOptIn: false,
                },
            });
            assert.equal(optInOffOk.status, 201, `${tok} debe poder operar en su sandbox con marketplaceOptIn=false`);
        }

        // BUYER sin allowCapex bloqueado en compra CAPEX -> 403 CAPEX_NOT_AUTHORIZED
        const buyerCapexBlocked = await dispatch('/api/supply/purchases', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-buyer' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                siteId: SITE_ID,
                purchaseMode: 'DIRECT_AUTONOMOUS',
                supplierTaxId: '76192083-9',
                supplierName: 'Maquinarias Atacama',
                documentType: 33,
                folio: 9101,
                issueDate: '2026-11-21',
                netAmountClp: 500000,
                vatAmountClp: 95000,
                totalAmountClp: 595000,
                paymentMethod: 'TRANSFERENCIA',
                lines: [
                    {
                        purchaseLineId: 'pl_capex_1',
                        description: 'Generador 10kVA',
                        qtyPurchased: 1,
                        unitPriceClp: 595000,
                        subtotalClp: 595000,
                        destination: 'CAPEX_ASSET',
                        isCapexAsset: true,
                    },
                ],
            },
        });
        assert.equal(buyerCapexBlocked.status, 403);
        assert.equal(buyerCapexBlocked.json.code, 'CAPEX_NOT_AUTHORIZED');

        // CAMP_MANAGER sin canRecordDirectPurchase bloqueado en compra directa -> 403 DIRECT_PURCHASE_FORBIDDEN
        const campDirectBlocked = await dispatch('/api/supply/purchases', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-camp' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                siteId: SITE_ID,
                purchaseMode: 'DIRECT_AUTONOMOUS',
                supplierTaxId: '76192083-9',
                supplierName: 'Verdulería Local',
                documentType: 39,
                folio: 9102,
                issueDate: '2026-11-21',
                netAmountClp: 10000,
                vatAmountClp: 1900,
                totalAmountClp: 11900,
                paymentMethod: 'CAJA_CHICA',
                lines: [
                    {
                        purchaseLineId: 'pl_opex_1',
                        description: 'Papas 10kg',
                        qtyPurchased: 10,
                        unitPriceClp: 1190,
                        subtotalClp: 11900,
                        destination: 'STOCK_IN_TRANSIT',
                    },
                ],
            },
        });
        assert.equal(campDirectBlocked.status, 403);
        assert.equal(campDirectBlocked.json.code, 'DIRECT_PURCHASE_FORBIDDEN');

        console.log('PASS [1/6] RBAC read-only (VIEWER/BILLING_ONLY), entitlements, sandbox opt-in & CAPEX/Direct guards');
    }

    // =========================================================================
    // TEST 2 & 3: Compra Atómica + Segregación ISO 27001 (SELF_APPROVAL_FORBIDDEN) + Doble Rendición (409)
    // =========================================================================
    let createdPurchaseId = '';
    let createdAssetId = '';
    let createdSiiDocId = '';
    {
        const purRes = await dispatch('/api/supply/purchases', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                siteId: SITE_ID,
                purchaseMode: 'DIRECT_AUTONOMOUS',
                supplierTaxId: '76192083-9',
                supplierName: 'Ferretería Copiapó SpA',
                documentType: 33,
                folio: 7701,
                issueDate: '2026-11-21',
                netAmountClp: 300000,
                vatAmountClp: 57000,
                totalAmountClp: 357000,
                paymentMethod: 'FONDO_POR_RENDIR',
                lines: [
                    {
                        purchaseLineId: 'pl_pernos_e02',
                        canonicalSkuId: 'sku-pernos',
                        description: 'Pernos Acero',
                        qtyPurchased: 10,
                        unitSi: 'un',
                        unitPriceClp: 10000,
                        subtotalClp: 100000,
                        destination: 'STOCK_IN_TRANSIT',
                    },
                    {
                        purchaseLineId: 'pl_compresor_e02',
                        description: 'Compresor Industrial',
                        qtyPurchased: 1,
                        unitSi: 'un',
                        unitPriceClp: 257000,
                        subtotalClp: 257000,
                        destination: 'CAPEX_ASSET',
                        isCapexAsset: true,
                    },
                ],
            },
        });
        assert.equal(purRes.status, 201);
        createdPurchaseId = purRes.json.purchase.purchaseId;
        createdAssetId = purRes.json.createdAssets[0].assetId;
        createdSiiDocId = purRes.json.siiDocument.docId;

        // BUYER sin allowCapex bloqueado en link-opermaq -> 403 CAPEX_NOT_AUTHORIZED
        const buyerLinkBlocked = await dispatch(`/api/supply/assets/${createdAssetId}/link-opermaq`, {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-buyer' },
            body: { confirmationKeyword: 'ACTUALIZAR', opermaqAssetId: 'eq_01' },
        });
        assert.equal(buyerLinkBlocked.status, 403);
        assert.equal(buyerLinkBlocked.json.code, 'CAPEX_NOT_AUTHORIZED');

        // tok-owner crea rendición SII -> 201
        const exp1 = await dispatch('/api/supply/sii/expense-reports', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                siteId: SITE_ID,
                paymentMethod: 'FONDO_POR_RENDIR',
                title: 'Rendición E02 Turno 1',
                fundAdvanceClp: 400000,
                siiDocumentIds: [createdSiiDocId],
            },
        });
        assert.equal(exp1.status, 201);
        const reportId = exp1.json.report.reportId;

        // Auto-aprobación por el mismo custodianUid (tok-owner) -> 403 SELF_APPROVAL_FORBIDDEN
        for (const targetStatus of ['APPROVED', 'PAID', 'REIMBURSED']) {
            const selfApprove = await dispatch(`/api/supply/sii/expense-reports/${reportId}`, {
                method: 'PATCH',
                headers: { Authorization: 'Bearer tok-owner' },
                body: { confirmationKeyword: 'ACTUALIZAR', status: targetStatus },
            });
            assert.equal(selfApprove.status, 403, `Auto-aprobación con ${targetStatus} debe ser 403`);
            assert.equal(selfApprove.json.code, 'SELF_APPROVAL_FORBIDDEN');
        }

        // Rol no aprobador (CAMP_MANAGER) -> 403 APPROVER_ROLE_REQUIRED
        const campApprove = await dispatch(`/api/supply/sii/expense-reports/${reportId}`, {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-camp' },
            body: { confirmationKeyword: 'ACTUALIZAR', status: 'APPROVED' },
        });
        assert.equal(campApprove.status, 403);
        assert.equal(campApprove.json.code, 'APPROVER_ROLE_REQUIRED');

        // Aprobación por tercero autorizado (tok-site-admin) -> 200
        const thirdPartyApprove = await dispatch(`/api/supply/sii/expense-reports/${reportId}`, {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-site-admin' },
            body: { confirmationKeyword: 'ACTUALIZAR', status: 'APPROVED' },
        });
        assert.equal(thirdPartyApprove.status, 200);
        assert.equal(thirdPartyApprove.json.report.status, 'APPROVED');

        console.log('PASS [2/6] ISO 27001 segregation of duties (SELF_APPROVAL_FORBIDDEN vs third-party approval)');

        // Doble rendición del mismo siiDocumentId -> 409 SII_DOC_ALREADY_REPORTED
        const expDup = await dispatch('/api/supply/sii/expense-reports', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-site-admin' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                siteId: SITE_ID,
                paymentMethod: 'FONDO_POR_RENDIR',
                title: 'Rendición Duplicada E02',
                fundAdvanceClp: 400000,
                siiDocumentIds: [createdSiiDocId],
            },
        });
        assert.equal(expDup.status, 409);
        assert.equal(expDup.json.code, 'SII_DOC_ALREADY_REPORTED');

        console.log('PASS [3/6] Atomic double expense report prevention (409 SII_DOC_ALREADY_REPORTED)');
    }

    // =========================================================================
    // TEST 4: Recepciones Parciales Acumulativas & Sobre-Recepción (OVER_RECEIVE_NOT_ALLOWED)
    // =========================================================================
    {
        // Recepción parcial #1: 4 de 10 -> PARTIAL_DISCREPANCY, qtyReceivedSoFar=4
        const rec1 = await dispatch(`/api/supply/purchases/${createdPurchaseId}/confirm-reception`, {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-camp' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                receivedLines: [{ purchaseLineId: 'pl_pernos_e02', qtyReceivedNow: 4 }],
            },
        });
        assert.equal(rec1.status, 200);
        assert.equal(rec1.json.purchase.receptionStatus, 'PARTIAL_DISCREPANCY');
        assert.equal(rec1.json.receptionOutcome, 'PARTIAL_DISCREPANCY');
        assert.equal(rec1.json.purchase.lines[0].qtyReceivedSoFar, 4);

        // Cantidad negativa -> 400
        const recNeg = await dispatch(`/api/supply/purchases/${createdPurchaseId}/confirm-reception`, {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-camp' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                receivedLines: [{ purchaseLineId: 'pl_pernos_e02', qtyReceivedNow: -2 }],
            },
        });
        assert.equal(recNeg.status, 400);

        // Intento de sobre-recepción: 7 más (4 + 7 = 11 > 10) -> 409 OVER_RECEIVE_NOT_ALLOWED
        const recOver = await dispatch(`/api/supply/purchases/${createdPurchaseId}/confirm-reception`, {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-camp' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                receivedLines: [{ purchaseLineId: 'pl_pernos_e02', qtyReceivedNow: 7 }],
            },
        });
        assert.equal(recOver.status, 409);
        assert.equal(recOver.json.code, 'OVER_RECEIVE_NOT_ALLOWED');

        // Confirmar que el inventario NO se corrompió tras el 409 (sigue 6 en tránsito, 4 en bodega)
        const invMid = await dispatch(`/api/supply/inventory?siteId=${SITE_ID}`, {
            headers: { Authorization: 'Bearer tok-owner' },
        });
        const pernosMid = invMid.json.items.find((i: any) => i.canonicalSkuId === 'sku-pernos');
        assert.equal(pernosMid.qtyInTransit, 6);
        assert.equal(pernosMid.qtyInWarehouse, 4);

        // Recepción parcial #2: 6 restantes (4 + 6 = 10) -> RECEIVED / RECEIVED_OK, qtyReceivedSoFar=10
        const rec2 = await dispatch(`/api/supply/purchases/${createdPurchaseId}/confirm-reception`, {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-camp' },
            body: {
                confirmationKeyword: 'ACTUALIZAR',
                receivedLines: [{ purchaseLineId: 'pl_pernos_e02', qtyReceivedNow: 6 }],
            },
        });
        assert.equal(rec2.status, 200);
        assert.equal(rec2.json.purchase.receptionStatus, 'RECEIVED');
        assert.equal(rec2.json.receptionOutcome, 'RECEIVED_OK');
        assert.equal(rec2.json.purchase.lines[0].qtyReceivedSoFar, 10);

        const invEnd = await dispatch(`/api/supply/inventory?siteId=${SITE_ID}`, {
            headers: { Authorization: 'Bearer tok-owner' },
        });
        const pernosEnd = invEnd.json.items.find((i: any) => i.canonicalSkuId === 'sku-pernos');
        assert.equal(pernosEnd.qtyInTransit, 0);
        assert.equal(pernosEnd.qtyInWarehouse, 10);

        console.log('PASS [4/6] Atomic partial receptions, qtyReceivedSoFar accumulation & 409 OVER_RECEIVE_NOT_ALLOWED');
    }

    // =========================================================================
    // TEST 5: GET /forecast 0 escrituras vs POST /forecast/recalculate persiste
    // =========================================================================
    {
        const writesBeforeGet = firestoreWriteCount;
        const fcGet = await dispatch(`/api/supply/forecast?siteId=${SITE_ID}`, {
            headers: { Authorization: 'Bearer tok-viewer' },
        });
        assert.equal(fcGet.status, 200);
        assert.equal(fcGet.json.forecasts.length, 1);
        assert.equal(
            firestoreWriteCount,
            writesBeforeGet,
            'GET /forecast NO debe ejecutar ninguna escritura en Firestore'
        );
        assert.equal(getCollectionMap(SUPPLY_COLLECTIONS.DEMAND_FORECASTS).size, 0);

        // VIEWER bloqueado en POST /forecast/recalculate -> 403 SUPPLY_RBAC_READ_ONLY
        const fcPostViewer = await dispatch('/api/supply/forecast/recalculate', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-viewer' },
            body: { siteId: SITE_ID },
        });
        assert.equal(fcPostViewer.status, 403);
        assert.equal(fcPostViewer.json.code, 'SUPPLY_RBAC_READ_ONLY');

        // OWNER ejecuta POST /forecast/recalculate -> 200 y persiste en supply_demand_forecasts
        const fcPostOk = await dispatch('/api/supply/forecast/recalculate', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner' },
            body: { siteId: SITE_ID },
        });
        assert.equal(fcPostOk.status, 200);
        assert.equal(fcPostOk.json.persisted, true);
        assert.ok(firestoreWriteCount > writesBeforeGet);
        assert.equal(getCollectionMap(SUPPLY_COLLECTIONS.DEMAND_FORECASTS).size, 1);

        console.log('PASS [5/6] GET /forecast pure read-only (0 writes) & POST /forecast/recalculate persistence');
    }

    // =========================================================================
    // TEST 6: M2M x402 /api/m2m/supply/rfq-quotes (402, Zod 400, AuditLedger fail-closed 500 + rollback)
    // =========================================================================
    {
        const futureIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
        const pastIso = new Date(Date.now() - 86400 * 1000).toISOString();

        // 6a. Sin pago ni contrato -> HTTP 402
        const noPayRes = await dispatch('/api/m2m/supply/rfq-quotes', {
            method: 'POST',
            body: {
                signalId: 'sig_CL-ATACAMA_sku-cemento',
                supplierTaxId: '76192083-9',
                supplierName: 'Proveedor M2M',
                deliveryDistrictCode: 'CL-ATACAMA',
                unitPriceNetClp: 850,
                minOrderQty: 50,
                maxAvailableQty: 500,
                leadTimeDays: 3,
                validUntilIso: futureIso,
            },
        });
        assert.equal(noPayRes.status, 402);

        // 6b. maxAvailableQty < minOrderQty -> HTTP 400
        const badQtyRes = await dispatch('/api/m2m/supply/rfq-quotes', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_B2B },
            body: {
                signalId: 'sig_CL-ATACAMA_sku-cemento',
                supplierTaxId: '76192083-9',
                supplierName: 'Proveedor M2M',
                deliveryDistrictCode: 'CL-ATACAMA',
                unitPriceNetClp: 850,
                minOrderQty: 500,
                maxAvailableQty: 100,
                leadTimeDays: 3,
                validUntilIso: futureIso,
            },
        });
        assert.equal(badQtyRes.status, 400);

        // 6c. validUntilIso pasada -> HTTP 400
        const pastDateRes = await dispatch('/api/m2m/supply/rfq-quotes', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_B2B },
            body: {
                signalId: 'sig_CL-ATACAMA_sku-cemento',
                supplierTaxId: '76192083-9',
                supplierName: 'Proveedor M2M',
                deliveryDistrictCode: 'CL-ATACAMA',
                unitPriceNetClp: 850,
                minOrderQty: 50,
                maxAvailableQty: 500,
                leadTimeDays: 3,
                validUntilIso: pastIso,
            },
        });
        assert.equal(pastDateRes.status, 400);

        // 6d. unitPriceNetClp > 1_000_000_000_000 o supplierTaxId inválido -> HTTP 400
        const badPriceRes = await dispatch('/api/m2m/supply/rfq-quotes', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_B2B },
            body: {
                signalId: 'sig_CL-ATACAMA_sku-cemento',
                supplierTaxId: '76192083-9',
                supplierName: 'Proveedor M2M',
                deliveryDistrictCode: 'CL-ATACAMA',
                unitPriceNetClp: 2_000_000_000_000,
                minOrderQty: 50,
                maxAvailableQty: 500,
                leadTimeDays: 3,
                validUntilIso: futureIso,
            },
        });
        assert.equal(badPriceRes.status, 400);

        const badTaxRes = await dispatch('/api/m2m/supply/rfq-quotes', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_B2B },
            body: {
                signalId: 'sig_CL-ATACAMA_sku-cemento',
                supplierTaxId: '76192083-0', // DV inválido
                supplierName: 'Proveedor M2M',
                deliveryDistrictCode: 'CL-ATACAMA',
                unitPriceNetClp: 850,
                minOrderQty: 50,
                maxAvailableQty: 500,
                leadTimeDays: 3,
                validUntilIso: futureIso,
            },
        });
        assert.equal(badTaxRes.status, 400);

        // 6e. AuditLedger.record fail-closed -> HTTP 500 AUDIT_LEDGER_UNAVAILABLE y cotización revertida
        const origAuditRecord = AuditLedger.record;
        (AuditLedger as any).record = async () => {
            throw new Error('Simulated AuditLedger failure');
        };
        try {
            const failClosedRes = await dispatch('/api/m2m/supply/rfq-quotes', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_B2B },
                body: {
                    signalId: 'sig_CL-ATACAMA_sku-cemento',
                    supplierTaxId: '76192083-9',
                    supplierName: 'Proveedor M2M',
                    deliveryDistrictCode: 'CL-ATACAMA',
                    unitPriceNetClp: 850,
                    minOrderQty: 50,
                    maxAvailableQty: 500,
                    leadTimeDays: 3,
                    validUntilIso: futureIso,
                },
            });
            assert.equal(failClosedRes.status, 500);
            assert.equal(failClosedRes.json.code, 'AUDIT_LEDGER_UNAVAILABLE');
            assert.equal(
                getCollectionMap('market_rfq_quotes').size,
                0,
                'Cotización debe haberse eliminado/revertido si AuditLedger falla'
            );
        } finally {
            (AuditLedger as any).record = origAuditRecord;
        }

        // 6f. Caso válido con AuditLedger saludable -> HTTP 201
        const okRfqRes = await dispatch('/api/m2m/supply/rfq-quotes', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_B2B },
            body: {
                signalId: 'sig_CL-ATACAMA_sku-cemento',
                supplierTaxId: '76192083-9',
                supplierName: 'Proveedor M2M',
                deliveryDistrictCode: 'CL-ATACAMA',
                unitPriceNetClp: 850,
                minOrderQty: 50,
                maxAvailableQty: 500,
                leadTimeDays: 3,
                validUntilIso: futureIso,
            },
        });
        assert.equal(okRfqRes.status, 201);
        assert.equal(getCollectionMap('market_rfq_quotes').size, 1);

        console.log('PASS [6/6] M2M x402 rfq-quotes (402, strict Zod 400 & fail-closed AuditLedger 500 rollback)');
    }
}

runTests()
    .then(() => {
        console.log('ALL E02 SECURITY TESTS PASSED (6/6)');
        process.exit(0);
    })
    .catch((err) => {
        console.error('E02 SECURITY TEST FAILED:', err);
        process.exit(1);
    });
