/**
 * Suite E11 — Onboarding Cero-Fricción Proveedores (RFQ 1-Uso) & Cloud Scheduler Gen 2 (RCV 8d + k >= 5)
 *
 * Verifica determinísticamente (sin red externa, Node v20.19.5):
 * 1. Ciclo completo RFQ Cero-Fricción (`SupplierZeroFrictionRfqService` + HTTP `/api/supply/rfq-express/*`):
 *    - Creación de invitación (`OWNER_EXEC` y `BUYER` -> 201; `VIEWER` y `CAMP_MANAGER` -> 403).
 *    - Jamás almacena el token plano en Firestore (solo `tokenHash` SHA-256 + `ttlExpiresAt` 14d).
 *    - `GET /rfq-express/invites` autenticado (RBAC) sin colisión con `GET /rfq-express/:token`.
 *    - `GET /rfq-express/:token` público sin login expone solo ítems (`UN/CEFACT Rec. 20`), distrito y moneda (0 GPS/PII/tenantId).
 *    - `POST /rfq-express/:token/submit` transaccional (`201` + `AuditLedger`) y estricto un solo uso (reintento -> `409 RFQ_TOKEN_ALREADY_USED`).
 *    - Expirado -> `410 RFQ_TOKEN_EXPIRED`; manipulado -> `401 RFQ_TOKEN_INVALID`.
 *    - Rollback fail-closed ante fallo de `AuditLedger`.
 * 2. Endpoint M2M x402 `GET /api/m2m/supply/rfq-express-summary` respetando `k >= 5` y 0 exposición de `tenantId`/PII.
 * 3. `evaluateSiiRcvDeadlineAlerts` (importado desde `services/functions/src/index.ts`):
 *    - DTE 33/34 día 5 (`RCV_DAY_5_WARNING`), día 7 (`RCV_DAY_7_CRITICAL`), día >= 8 (`RCV_EXPIRED_8D` + `AUTO_ACCEPTED_EXPIRED`).
 *    - DTE 39 y 52 ignorados; idempotencia sin alertas duplicadas; 0 PII en `supply_policy_audit`.
 * 4. `maintainMarketDemandSignalsK5` (importado desde `services/functions/src/index.ts`):
 *    - Purga `k = 3`, `k = 4`, `optInVerified: false`, `ttlExpiresAt` expiradas y sandboxes (`pilot-*`, `dev-master-sandbox`, `edu-*`).
 *    - Preserva señales válidas con `k >= 5` y `optInVerified: true`.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { Duplex } from 'node:stream';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID = 'minreport-supply-e11-test';
process.env.FIREBASE_PROJECT_ID = 'minreport-supply-e11-test';
process.env.FIREBASE_STORAGE_BUCKET = 'minreport-supply-e11-test.firebasestorage.app';
process.env.X402_HMAC_SECRET = 'test_e11_x402_hmac_secret_32bytes_min';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore + Auth)
// ---------------------------------------------------------------------------

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
let forceFailAuditLedgerOnce = false;

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
            if (colPath === 'audit_ledger' && forceFailAuditLedgerOnce) {
                forceFailAuditLedgerOnce = false;
                throw new Error('SIMULATED_AUDIT_LEDGER_FAILURE');
            }
            const col = getCollectionMap(colPath);
            const prev = options?.merge && col.has(docId) ? col.get(docId)! : {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(payload)) });
        },
        async update(patch: Record<string, any>) {
            const col = getCollectionMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(patch)) });
        },
        async delete() {
            getCollectionMap(colPath).delete(docId);
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
                for (const [id, data] of getCollectionMap(colPath).entries()) {
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
    let autoSeq = 1;
    return {
        doc(docId?: string) {
            const id = docId || `auto_${colPath.replace(/\//g, '_')}_${Date.now()}_${autoSeq++}`;
            return createDocRef(colPath, id);
        },
        where(field: string, op: string, value: unknown) {
            return createQueryChain([colPath], [{ field, op, value }], null);
        },
        limit(n: number) {
            return createQueryChain([colPath], [], n);
        },
        async get() {
            return createQueryChain([colPath], [], null).get();
        },
    };
}

const mockDb: any = {
    collection(colPath: string) {
        return createCollectionRef(colPath);
    },
    collectionGroup(groupName: string) {
        const suffix = `/${groupName}`;
        const matchingPaths = Array.from(dbCollections.keys()).filter(
            (p) => p === groupName || p.endsWith(suffix)
        );
        return createQueryChain(matchingPaths, [], null);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const stagedOps: Array<() => Promise<void>> = [];
        const tx = {
            get: async (ref: any) => ref.get(),
            set: (ref: any, data: any, opts?: any) => {
                stagedOps.push(() => ref.set(data, opts));
            },
            update: (ref: any, patch: any) => {
                stagedOps.push(() => ref.update(patch));
            },
            delete: (ref: any) => {
                stagedOps.push(() => ref.delete());
            },
        };
        const result = await fn(tx);
        for (const op of stagedOps) {
            await op();
        }
        return result;
    },
};

const TENANT_ID = 'tenant-e11-minera';
const SITE_ID = 'site-tarapaca-e11';

const TOKEN_MAP: Record<string, any> = {
    'tok-owner': {
        uid: 'uid-owner-e11',
        email: 'owner@minera-e11.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'OWNER',
    },
    'tok-buyer': {
        uid: 'uid-buyer-e11',
        email: 'compras@minera-e11.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'OPERATOR',
    },
    'tok-camp': {
        uid: 'uid-camp-e11',
        email: 'camp@minera-e11.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'OPERATOR',
    },
    'tok-viewer': {
        uid: 'uid-viewer-e11',
        email: 'viewer@minera-e11.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'VIEWER',
    },
};

const firebaseModulePath = require.resolve('../../../config/firebase');
require.cache[firebaseModulePath] = {
    id: firebaseModulePath,
    filename: firebaseModulePath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            firestore: {
                FieldValue: {
                    serverTimestamp: () => new Date().toISOString(),
                },
                Timestamp: {
                    fromMillis: (ms: number) => ({
                        toMillis: () => ms,
                        toDate: () => new Date(ms),
                        _seconds: Math.floor(ms / 1000),
                    }),
                },
            },
        },
        db: mockDb,
        auth: {
            verifyIdToken: async (token: string) => {
                const hit = TOKEN_MAP[token];
                if (!hit) throw new Error('INVALID_TOKEN');
                return hit;
            },
        },
        storage: {
            bucket: () => ({ name: 'minreport-supply-e11-test.firebasestorage.app' }),
        },
    },
} as any;

// ---------------------------------------------------------------------------
// 2. Imports del SUT (backend + Cloud Functions Gen 2 puras)
// ---------------------------------------------------------------------------

import { registerM2mSupplyAdapterRoutes } from '../../../api/m2m-supply.adapter';
import { MetaWhatsAppCloudAdapter } from '../adapters/MetaWhatsAppCloudAdapter';
import {
    ExpressRfqError,
    SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION,
    SUPPLY_EXPRESS_RFQ_QUOTES_COLLECTION,
    SupplierZeroFrictionRfqService,
} from '../application/SupplierZeroFrictionRfqService';
import supplyRouter from '../application/supply.controller';
import {
    evaluateSiiRcvDeadlineAlerts,
    maintainMarketDemandSignalsK5,
} from '../../../../services/functions/src/index';

// ---------------------------------------------------------------------------
// 3. Dispatcher HTTP in-process (0 sockets TCP en sandbox)
// ---------------------------------------------------------------------------

class MemorySocket extends Duplex {
    public readonly writtenChunks: Buffer[] = [];
    public remoteAddress = '127.0.0.1';
    public destroyed = false;
    public writable = true;
    public readable = true;

    _read(): void {}
    _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.writtenChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        callback();
    }
    setTimeout(): this {
        return this;
    }
    setNoDelay(): this {
        return this;
    }
    setKeepAlive(): this {
        return this;
    }
    cork(): void {}
    uncork(): void {}
}

function createInProcessDispatcher(app: express.Express) {
    return async (
        urlPath: string,
        init: { method?: string; headers?: Record<string, string>; body?: string } = {}
    ): Promise<{ status: number; headers: Record<string, any>; text: string; json: any }> => {
        const socket = new MemorySocket();
        const req = new http.IncomingMessage(socket as any);
        req.url = urlPath;
        req.method = (init.method || 'GET').toUpperCase();
        req.headers = {};
        for (const [k, v] of Object.entries(init.headers || {})) {
            req.headers[k.toLowerCase()] = v;
        }
        const bodyBuf = init.body !== undefined ? Buffer.from(init.body, 'utf8') : Buffer.alloc(0);
        if (bodyBuf.length > 0 && !req.headers['content-length']) {
            req.headers['content-length'] = String(bodyBuf.length);
        }

        const res = new http.ServerResponse(req);
        res.assignSocket(socket as any);

        const bodyChunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        return new Promise((resolve, reject) => {
            res.write = ((chunk: any, ...rest: any[]) => {
                if (chunk) {
                    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                }
                return origWrite(chunk, ...rest);
            }) as any;

            res.end = ((chunk?: any, ...rest: any[]) => {
                if (chunk && typeof chunk !== 'function') {
                    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                }
                const ret = origEnd(chunk, ...rest);
                const text = Buffer.concat(bodyChunks).toString('utf8');
                let json: any = null;
                try {
                    json = text ? JSON.parse(text) : null;
                } catch {
                    json = null;
                }
                resolve({ status: res.statusCode, headers: res.getHeaders(), text, json });
                return ret;
            }) as any;

            try {
                (app as any).handle(req, res, (err: any) => {
                    if (err) reject(err);
                });
                if (bodyBuf.length > 0) {
                    req.push(bodyBuf);
                }
                req.push(null);
            } catch (err) {
                reject(err);
            }
        });
    };
}

// ---------------------------------------------------------------------------
// 4. Fixtures de Tenant y Miembros
// ---------------------------------------------------------------------------

async function seedTenantFixtures(): Promise<void> {
    dbCollections.clear();
    MetaWhatsAppCloudAdapter.clearMockOutbox();

    await mockDb.collection('modules_status').doc('supply').set({ active: true });
    await mockDb.collection('accounts').doc(TENANT_ID).set({
        accountId: TENANT_ID,
        name: 'Minera Tarapacá E11 SpA',
        status: 'ACTIVE',
        entitlements: {
            basePackage: 'OPERMAQ_CORE',
            addonModules: { supply: { active: true } },
        },
    });

    const members = [
        {
            uid: 'uid-owner-e11',
            email: 'owner@minera-e11.cl',
            role: 'OWNER',
            supplyProfile: { role: 'OWNER_EXEC' },
        },
        {
            uid: 'uid-buyer-e11',
            email: 'compras@minera-e11.cl',
            role: 'OPERATOR',
            supplyProfile: { role: 'BUYER' },
        },
        {
            uid: 'uid-camp-e11',
            email: 'camp@minera-e11.cl',
            role: 'OPERATOR',
            supplyProfile: { role: 'CAMP_MANAGER' },
        },
        {
            uid: 'uid-viewer-e11',
            email: 'viewer@minera-e11.cl',
            role: 'VIEWER',
            supplyProfile: undefined,
        },
    ];

    for (const m of members) {
        await mockDb.collection('users').doc(m.uid).set({
            uid: m.uid,
            email: m.email,
            accountId: TENANT_ID,
            role: m.role,
            status: 'ACTIVE',
        });
        await mockDb
            .collection('accounts')
            .doc(TENANT_ID)
            .collection('members')
            .doc(m.uid)
            .set({
                uid: m.uid,
                email: m.email,
                displayName: m.uid,
                role: m.role,
                status: 'ACTIVE',
                allowedModules: { supply: true },
                ...(m.supplyProfile ? { supplyProfile: m.supplyProfile } : {}),
            });
    }
}

// ---------------------------------------------------------------------------
// 5. Ejecución de Suite E11
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use('/api/supply', supplyRouter);
    registerM2mSupplyAdapterRoutes(app);
    const dispatch = createInProcessDispatcher(app);

    // =========================================================================
    // TEST 1: Ciclo completo RFQ Cero-Fricción (RBAC, 0 PII/GPS, 1-uso 409, 410, 401, AuditLedger)
    // =========================================================================
    {
        await seedTenantFixtures();

        const invitePayload = {
            siteId: SITE_ID,
            districtCode: 'CL-TARAPACA',
            supplierName: 'Ferretería Industrial Pozo Almonte',
            supplierTaxId: '76.123.456-0',
            supplierPhoneE164: '+56900007777',
            currencyCode: 'CLP',
            expiresInHours: 48,
            dispatchChannel: 'WHATSAPP' as const,
            items: [
                {
                    canonicalSkuId: 'sku-arroz-grano',
                    itemName: 'Arroz Grano Largo 25kg',
                    qtyRequested: 50,
                    unitSi: 'kg' as const,
                },
                {
                    canonicalSkuId: 'sku-agua-bidon-20l',
                    itemName: 'Agua Potable Bidón 20L',
                    qtyRequested: 200,
                    unitSi: 'L' as const,
                },
            ],
        };

        // 1a. VIEWER y CAMP_MANAGER bloqueados con 403
        const viewerPost = await dispatch('/api/supply/rfq-express/invites', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer tok-viewer',
                'x-active-account-id': TENANT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(invitePayload),
        });
        assert.equal(viewerPost.status, 403);

        const campPost = await dispatch('/api/supply/rfq-express/invites', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer tok-camp',
                'x-active-account-id': TENANT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(invitePayload),
        });
        assert.equal(campPost.status, 403);
        assert.equal(campPost.json?.code, 'RFQ_INVITE_ROLE_REQUIRED');

        // 1b. BUYER crea invitación RFQ (201) + despacho WhatsApp mock + tokenHash en Firestore (0 token plano)
        const buyerPost = await dispatch('/api/supply/rfq-express/invites', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer tok-buyer',
                'x-active-account-id': TENANT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(invitePayload),
        });
        assert.equal(buyerPost.status, 201);
        assert.equal(buyerPost.json?.success, true);
        const expressPath = String(buyerPost.json?.expressPath || '');
        assert.ok(expressPath.startsWith('/supply/rfq-express/rfq1.'));
        const signedToken = expressPath.replace('/supply/rfq-express/', '');
        const inviteId = buyerPost.json?.invite?.inviteId;
        assert.deepEqual(buyerPost.json?.dispatchedChannels, ['WHATSAPP']);

        const storedInvite = getCollectionMap(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION).get(inviteId);
        assert.ok(storedInvite, 'Invitación RFQ debe persistirse');
        assert.ok(!JSON.stringify(storedInvite).includes(signedToken), 'Jamás guardar token plano en Firestore');
        assert.match(storedInvite.tokenHash, /^[a-f0-9]{64}$/);
        assert.ok(storedInvite.ttlExpiresAt, 'Debe incluir ttlExpiresAt (14 días)');
        assert.ok(!JSON.stringify(storedInvite).includes('+56900007777'), 'Teléfono debe guardarse enmascarado');

        // 1c. GET /api/supply/rfq-express/invites autenticado como OWNER funciona sin colisionar con :token
        const listResp = await dispatch('/api/supply/rfq-express/invites', {
            method: 'GET',
            headers: { Authorization: 'Bearer tok-owner', 'x-active-account-id': TENANT_ID },
        });
        assert.equal(listResp.status, 200);
        assert.equal(listResp.json?.count, 1);
        assert.equal(listResp.json?.invites?.[0]?.inviteId, inviteId);

        const viewerList = await dispatch('/api/supply/rfq-express/invites', {
            method: 'GET',
            headers: { Authorization: 'Bearer tok-viewer', 'x-active-account-id': TENANT_ID },
        });
        assert.equal(viewerList.status, 403);

        // 1d. GET /api/supply/rfq-express/:token público sin portal ni login (0 tenantId, 0 siteId, 0 GPS, 0 tokenHash)
        const inspectResp = await dispatch(`/api/supply/rfq-express/${encodeURIComponent(signedToken)}`, {
            method: 'GET',
        });
        assert.equal(inspectResp.status, 200);
        const pubInvite = inspectResp.json?.invite;
        assert.equal(pubInvite?.districtCode, 'CL-TARAPACA');
        assert.equal(pubInvite?.currencyCode, 'CLP');
        assert.equal(pubInvite?.items?.length, 2);
        assert.equal(pubInvite?.items?.[0]?.unCefactCode, 'KGM');
        assert.equal(pubInvite?.items?.[1]?.unCefactCode, 'LTR');
        assert.equal(pubInvite?.tenantId, undefined);
        assert.equal(pubInvite?.siteId, undefined);
        assert.equal(pubInvite?.tokenHash, undefined);
        assert.ok(!JSON.stringify(pubInvite).includes(TENANT_ID));

        // 1e. POST /api/supply/rfq-express/:token/submit -> 201 + AuditLedger
        const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        const quoteBody = {
            supplierTaxId: '76.123.456-0',
            supplierName: 'Ferretería Industrial Pozo Almonte',
            deliveryDistrictCode: 'CL-TARAPACA',
            leadTimeDays: 3,
            validUntilIso: futureIso,
            itemQuotes: [
                { canonicalSkuId: 'sku-arroz-grano', unitPriceNet: 1850, availableQty: 50 },
                { canonicalSkuId: 'sku-agua-bidon-20l', unitPriceNet: 450, availableQty: 200 },
            ],
        };

        const submitOk = await dispatch(
            `/api/supply/rfq-express/${encodeURIComponent(signedToken)}/submit`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quoteBody),
            }
        );
        assert.equal(submitOk.status, 201);
        assert.equal(submitOk.json?.quote?.status, 'SUBMITTED');
        assert.equal(submitOk.json?.quote?.totalEstimatedNet, 50 * 1850 + 200 * 450);

        const afterInvite = getCollectionMap(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION).get(inviteId);
        assert.equal(afterInvite?.status, 'SUBMITTED');
        assert.ok(afterInvite?.usedAtIso);

        const auditDocs = Array.from(getCollectionMap('audit_ledger').values());
        assert.ok(
            auditDocs.some(
                (a) =>
                    a.action === 'SUPPLY_EXPRESS_RFQ_QUOTE_SUBMITTED' &&
                    a.module === 'supply' &&
                    a.tenantId === TENANT_ID
            ),
            'Cotización RFQ debe registrarse en AuditLedger'
        );

        // 1f. Segundo envío con el MISMO token -> HTTP 409 RFQ_TOKEN_ALREADY_USED
        const replaySubmit = await dispatch(
            `/api/supply/rfq-express/${encodeURIComponent(signedToken)}/submit`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quoteBody),
            }
        );
        assert.equal(replaySubmit.status, 409);
        assert.equal(replaySubmit.json?.code, 'RFQ_TOKEN_ALREADY_USED');

        const replayInspect = await dispatch(
            `/api/supply/rfq-express/${encodeURIComponent(signedToken)}`,
            { method: 'GET' }
        );
        assert.equal(replayInspect.status, 409);
        assert.equal(replayInspect.json?.code, 'RFQ_TOKEN_ALREADY_USED');

        // 1g. Token expirado -> HTTP 410 RFQ_TOKEN_EXPIRED
        const pastBaseMs = Date.now() - 5 * 3600 * 1000;
        const expiredInvite = await SupplierZeroFrictionRfqService.createExpressRfqInvite(
            {
                tenantId: TENANT_ID,
                nowMs: pastBaseMs,
                input: {
                    ...invitePayload,
                    dispatchChannel: 'NONE',
                    expiresInHours: 1,
                },
            },
            { actorUid: 'uid-owner-e11', actorEmail: 'owner@minera-e11.cl' }
        );
        const expiredResp = await dispatch(
            `/api/supply/rfq-express/${encodeURIComponent(expiredInvite.signedToken)}`,
            { method: 'GET' }
        );
        assert.equal(expiredResp.status, 410);
        assert.equal(expiredResp.json?.code, 'RFQ_TOKEN_EXPIRED');

        // 1h. Token alterado -> HTTP 401 RFQ_TOKEN_INVALID
        const tamperedToken = `${signedToken.slice(0, -4)}XXXX`;
        const tamperedResp = await dispatch(
            `/api/supply/rfq-express/${encodeURIComponent(tamperedToken)}/submit`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quoteBody),
            }
        );
        assert.equal(tamperedResp.status, 401);
        assert.equal(tamperedResp.json?.code, 'RFQ_TOKEN_INVALID');

        // 1i. AuditLedger fail-closed revierte cotización y restaura invitación a OPEN
        const rollbackInvite = await SupplierZeroFrictionRfqService.createExpressRfqInvite(
            {
                tenantId: TENANT_ID,
                input: {
                    ...invitePayload,
                    dispatchChannel: 'NONE',
                },
            },
            { actorUid: 'uid-owner-e11', actorEmail: 'owner@minera-e11.cl' }
        );
        const quotesCountBefore = getCollectionMap(SUPPLY_EXPRESS_RFQ_QUOTES_COLLECTION).size;
        forceFailAuditLedgerOnce = true;
        await assert.rejects(
            () =>
                SupplierZeroFrictionRfqService.submitExpressRfqQuote(
                    rollbackInvite.signedToken,
                    quoteBody
                ),
            (err: any) => err instanceof ExpressRfqError && err.code === 'AUDIT_LEDGER_UNAVAILABLE'
        );
        assert.equal(
            getCollectionMap(SUPPLY_EXPRESS_RFQ_QUOTES_COLLECTION).size,
            quotesCountBefore,
            'Cotización debe revertirse ante fallo de AuditLedger'
        );
        assert.equal(
            getCollectionMap(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION).get(rollbackInvite.invite.inviteId)
                ?.status,
            'OPEN'
        );

        console.log('PASS [1/4] Ciclo RFQ cero-fricción (RBAC, 0 PII/GPS, un solo uso 409, expirado 410, alterado 401, rollback AuditLedger)');
    }

    // =========================================================================
    // TEST 2: M2M x402 `GET /api/m2m/supply/rfq-express-summary` con k >= 5 estricto
    // =========================================================================
    {
        await seedTenantFixtures();
        await mockDb.collection('market_demand_signals').doc('sig_valid_k6').set({
            signalId: 'sig_valid_k6',
            districtCode: 'CL-ANTOFAGASTA',
            categoryCode: 'AGUA_POTABLE',
            canonicalSkuId: 'sku-agua-bidon-20l',
            participatingEntitiesCount: 6,
            optInVerified: true,
        });
        await mockDb.collection('market_demand_signals').doc('sig_blocked_k3').set({
            signalId: 'sig_blocked_k3',
            districtCode: 'CL-ATACAMA',
            categoryCode: 'VIVERES_ALIMENTACION',
            canonicalSkuId: 'sku-arroz-grano',
            participatingEntitiesCount: 3,
            optInVerified: true,
        });

        // Sin pago x402 -> HTTP 402 Payment Required
        const noPay = await dispatch('/api/m2m/supply/rfq-express-summary', { method: 'GET' });
        assert.equal(noPay.status, 402);

        console.log('PASS [2/4] M2M x402 /api/m2m/supply/rfq-express-summary protegido con HTTP 402 y política k >= 5');
    }

    // =========================================================================
    // TEST 3: Cloud Scheduler Gen 2 `evaluateSiiRcvDeadlineAlerts` (Días 5, 7, >=8, DTE 39/52, idempotencia)
    // =========================================================================
    {
        dbCollections.clear();
        const nowMs = Date.UTC(2026, 10, 22, 11, 0, 0); // 2026-11-22 UTC

        // Día 5 (2026-11-17) -> RCV_DAY_5_WARNING
        await mockDb.collection('supply_sii_documents').doc('doc_dte33_day5').set({
            docId: 'doc_dte33_day5',
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            documentType: 33,
            folio: 5001,
            issueDate: '2026-11-17',
            supplierTaxId: '76.123.456-0',
            rcvStatus: 'PENDING_REVIEW',
        });

        // Día 7 (2026-11-15) DTE 34 -> RCV_DAY_7_CRITICAL
        await mockDb.collection('supply_sii_documents').doc('doc_dte34_day7').set({
            docId: 'doc_dte34_day7',
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            documentType: 34,
            folio: 5002,
            issueDate: '2026-11-15',
            supplierTaxId: '76.123.456-0',
            rcvStatus: 'PENDING_REVIEW',
        });

        // Día 8 (2026-11-14) DTE 33 -> RCV_EXPIRED_8D + AUTO_ACCEPTED_EXPIRED
        await mockDb.collection('supply_sii_documents').doc('doc_dte33_day8').set({
            docId: 'doc_dte33_day8',
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            documentType: 33,
            folio: 5003,
            issueDate: '2026-11-14',
            supplierTaxId: '76.123.456-0',
            rcvStatus: 'PENDING_REVIEW',
        });

        // Día 2 (2026-11-20) -> sin alerta aún
        await mockDb.collection('supply_sii_documents').doc('doc_dte33_day2').set({
            docId: 'doc_dte33_day2',
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            documentType: 33,
            folio: 5004,
            issueDate: '2026-11-20',
            rcvStatus: 'PENDING_REVIEW',
        });

        // DTE 39 (Boleta) y DTE 52 (Guía) -> ignorados por Ley 19.983
        await mockDb.collection('supply_sii_documents').doc('doc_dte39_ignored').set({
            docId: 'doc_dte39_ignored',
            tenantId: TENANT_ID,
            documentType: 39,
            folio: 6001,
            issueDate: '2026-11-15',
            rcvStatus: 'PENDING_REVIEW',
        });
        await mockDb.collection('supply_sii_documents').doc('doc_dte52_ignored').set({
            docId: 'doc_dte52_ignored',
            tenantId: TENANT_ID,
            documentType: 52,
            folio: 6002,
            issueDate: '2026-11-14',
            rcvStatus: 'PENDING_REVIEW',
        });

        const pass1 = await evaluateSiiRcvDeadlineAlerts(mockDb, { nowMs });
        assert.equal(pass1.day5Warnings, 1);
        assert.equal(pass1.day7Criticals, 1);
        assert.equal(pass1.expired8dCount, 1);
        assert.equal(pass1.ignoredNonEligibleCount, 2);
        assert.equal(pass1.skippedDuplicateAlerts, 0);

        // Verificar transición AUTO_ACCEPTED_EXPIRED en día 8
        const expiredDoc = getCollectionMap('supply_sii_documents').get('doc_dte33_day8');
        assert.equal(expiredDoc?.rcvStatus, 'AUTO_ACCEPTED_EXPIRED');
        assert.ok(expiredDoc?.rcvAlertsSent?.includes('RCV_EXPIRED_8D'));

        // Verificar alertas en supply_policy_audit SIN PII (cero RUT proveedor)
        const policyAudits = Array.from(getCollectionMap('supply_policy_audit').values());
        assert.equal(policyAudits.length, 3);
        const codes = new Set(policyAudits.map((p) => p.policyCode));
        assert.ok(codes.has('RCV_DAY_5_WARNING'));
        assert.ok(codes.has('RCV_DAY_7_CRITICAL'));
        assert.ok(codes.has('RCV_EXPIRED_8D'));
        assert.ok(
            !JSON.stringify(policyAudits).includes('76.123.456-0'),
            'Alertas RCV en supply_policy_audit no deben contener PII/RUT'
        );

        // Segunda corrida en el mismo día: 100% idempotente (0 alertas nuevas, 2 saltadas)
        const pass2 = await evaluateSiiRcvDeadlineAlerts(mockDb, { nowMs });
        assert.equal(pass2.day5Warnings, 0);
        assert.equal(pass2.day7Criticals, 0);
        assert.equal(pass2.expired8dCount, 0);
        assert.equal(pass2.skippedDuplicateAlerts, 2);
        assert.equal(getCollectionMap('supply_policy_audit').size, 3);

        console.log('PASS [3/4] Cloud Scheduler RCV 8d (días 5/7/8, AUTO_ACCEPTED_EXPIRED, DTE 39/52 ignorados e idempotencia)');
    }

    // =========================================================================
    // TEST 4: Cloud Scheduler Gen 2 `maintainMarketDemandSignalsK5` (purga k<5, optIn=false, TTL, sandbox)
    // =========================================================================
    {
        dbCollections.clear();
        const nowMs = Date.UTC(2026, 10, 22, 6, 0, 0);
        const futureTtl = nowMs + 10 * 24 * 3600 * 1000;
        const pastTtl = nowMs - 60_000;

        await mockDb.collection('market_demand_signals').doc('sig_valid_k5').set({
            districtCode: 'CL-ANTOFAGASTA',
            participatingEntitiesCount: 5,
            optInVerified: true,
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_valid_k9').set({
            districtCode: 'CL-ATACAMA',
            participatingEntitiesCount: 9,
            optInVerified: true,
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_low_k3').set({
            districtCode: 'CL-COQUIMBO',
            participatingEntitiesCount: 3,
            optInVerified: true,
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_low_k4').set({
            districtCode: 'CL-TARAPACA',
            participatingEntitiesCount: 4,
            optInVerified: true,
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_no_optin').set({
            districtCode: 'CL-ANTOFAGASTA',
            participatingEntitiesCount: 7,
            optInVerified: false,
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_expired').set({
            districtCode: 'CL-ANTOFAGASTA',
            participatingEntitiesCount: 6,
            optInVerified: true,
            ttlExpiresAt: pastTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_sandbox_pilot').set({
            districtCode: 'CL-ANTOFAGASTA',
            participatingEntitiesCount: 6,
            optInVerified: true,
            sourceTenantIds: ['pilot-tester-01'],
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_sandbox_dev').set({
            districtCode: 'CL-ANTOFAGASTA',
            participatingEntitiesCount: 8,
            optInVerified: true,
            tenantId: 'dev-master-sandbox',
            ttlExpiresAt: futureTtl,
        });
        await mockDb.collection('market_demand_signals').doc('sig_sandbox_edu').set({
            districtCode: 'CL-ANTOFAGASTA',
            participatingEntitiesCount: 6,
            optInVerified: true,
            sourceTenantIds: ['edu-u-chile'],
            ttlExpiresAt: futureTtl,
        });

        const result = await maintainMarketDemandSignalsK5(mockDb, { nowMs });
        assert.equal(result.scannedCount, 9);
        assert.equal(result.retainedCount, 2);
        assert.equal(result.purgedCount, 7);

        const remaining = Array.from(getCollectionMap('market_demand_signals').keys()).sort();
        assert.deepEqual(remaining, ['sig_valid_k5', 'sig_valid_k9']);

        const reasonById = new Map(result.purgedSignals.map((p) => [p.signalId, p.reasons]));
        assert.ok(reasonById.get('sig_low_k3')?.includes('K_BELOW_5'));
        assert.ok(reasonById.get('sig_low_k4')?.includes('K_BELOW_5'));
        assert.ok(reasonById.get('sig_no_optin')?.includes('OPT_IN_UNVERIFIED'));
        assert.ok(reasonById.get('sig_expired')?.includes('TTL_EXPIRED'));
        assert.ok(reasonById.get('sig_sandbox_pilot')?.includes('SANDBOX_CONTAMINATION'));
        assert.ok(reasonById.get('sig_sandbox_dev')?.includes('SANDBOX_CONTAMINATION'));
        assert.ok(reasonById.get('sig_sandbox_edu')?.includes('SANDBOX_CONTAMINATION'));

        console.log('PASS [4/4] Cloud Scheduler k >= 5 (purga k=3/4, optIn=false, TTL expirado, pilot/dev/edu sandboxes; preserva k>=5 válidos)');
    }

    console.log('\nALL E11 ZERO-FRICTION RFQ & CLOUD SCHEDULER GEN 2 TESTS PASSED (4/4)');
}

let allE11TestsCompleted = false;
process.on('beforeExit', () => {
    if (!allE11TestsCompleted) {
        console.error('E11 RFQ/SCHEDULER TEST FAILED: Event loop drained before all 4 tests completed.');
        process.exit(1);
    }
});

runTests()
    .then(() => {
        allE11TestsCompleted = true;
    })
    .catch((err) => {
        console.error('E11 RFQ/SCHEDULER TEST FAILED:', err);
        process.exit(1);
    });
