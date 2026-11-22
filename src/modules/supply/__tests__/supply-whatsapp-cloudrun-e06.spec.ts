/**
 * Suite E06 Cloud Run Stateless WhatsApp & FinOps — MINREPORT · ABASTECIMIENTO
 *
 * Verifica determinísticamente los hallazgos P0-09, P0-10, P0-12 y P2-05:
 * 1. `POST /api/supply/whatsapp/webhook` responde HTTP `200` en `< 500ms` incluso cuando el worker
 *    tarda `1200ms` (ACK asíncrono vía `SupplyTaskQueueService`), y completa el turno en background.
 * 2. WAMID State Machine transaccional (`supply_whatsapp_wamids/{wamid}`):
 *    - `DONE` bloquea duplicados (`false`)
 *    - `FAILED` permite reintento exitoso (`attempts === 2` -> `DONE`)
 *    - `PROCESSING` con lease expirado (`leaseExpiresAtMs < Date.now()`) permite recuperación (`attempts === 2` -> `DONE`).
 * 3. Dos mensajes concurrentes (`Promise.all`) sobre la misma sesión preservan ambos turnos en
 *    `pendingBuffer` con `version` incrementada sin lost update + staging stateless CAS (`XML_DTE_DOCUMENT`).
 * 4. `verifySupplyWorkerOidcAuth` bloquea llamadas sin OIDC o con SA errónea en producción (`401`/`403`)
 *    y permite llamadas con token OIDC válido para `/whatsapp/worker/inbound` y `/whatsapp/worker/flush`.
 * 5. `firestore.indexes.json` es JSON válido sin duplicados e incluye `members.phoneE164` (`COLLECTION_GROUP`),
 *    los 3 TTLs (`supply_whatsapp_sessions`, `supply_whatsapp_wamids`, `market_demand_signals`) y los 2 índices
 *    compuestos de `supply_fulfillment_allocations`.
 * 6. Caps FinOps `.limit()` en `SupplyRepository` (`DEFAULT_LIST_LIMIT = 200`, `MAX_LIST_LIMIT = 500`).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID = 'minreport-supply-e06-test';
process.env.FIREBASE_PROJECT_ID = 'minreport-supply-e06-test';
process.env.FIREBASE_STORAGE_BUCKET = 'minreport-supply-e06-test.firebasestorage.app';
process.env.WHATSAPP_APP_SECRET = 'test_e06_meta_app_secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test_e06_verify_token';
process.env.WHATSAPP_ACCESS_TOKEN = 'test_e06_access_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '109876543210';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore + Storage)
// ---------------------------------------------------------------------------

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const storageBlobs = new Map<string, { buffer: Buffer; contentType: string }>();
const recordedQueryLimits: Array<{ colPath: string; limit: number | null }> = [];

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
            recordedQueryLimits.push({ colPath: colPaths.join(','), limit: maxLimit });
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
    collection(colName: string) {
        return createCollectionRef(colName);
    },
    collectionGroup(subCollectionName: string) {
        const matchingPaths = Array.from(dbCollections.keys()).filter(
            (p) => p === subCollectionName || p.endsWith(`/${subCollectionName}`)
        );
        return createQueryChain(matchingPaths, [], null);
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
        // Valida estricto read-before-write de Firestore y commit atómico
        let writeStarted = false;
        const pendingOps: Array<() => Promise<void>> = [];
        const tx = {
            async get(ref: any) {
                if (writeStarted) {
                    throw new Error('Firestore transactions require all reads before all writes.');
                }
                // Pequeña pausa asíncrona para exponer carreras si faltara serialización
                await new Promise((r) => setTimeout(r, 5));
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
        for (const op of pendingOps) await op();
        return result;
    },
};

const mockStorage: any = {
    bucket() {
        return {
            file(storagePath: string) {
                return {
                    async save(buffer: Buffer, opts?: any) {
                        storageBlobs.set(storagePath, {
                            buffer: Buffer.from(buffer),
                            contentType: opts?.contentType || 'application/octet-stream',
                        });
                    },
                    async getMetadata() {
                        const found = storageBlobs.get(storagePath);
                        if (!found) throw new Error('Not found');
                        return [{ size: found.buffer.length, contentType: found.contentType }];
                    },
                    async download() {
                        const found = storageBlobs.get(storagePath);
                        if (!found) throw new Error('Not found');
                        return [found.buffer];
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
    auth: () => ({ async verifyIdToken() { throw new Error('unused'); } }),
    storage: () => mockStorage,
};

const fbResolved = require.resolve(path.resolve(__dirname, '../../../config/firebase'));
require.cache[fbResolved] = {
    id: fbResolved,
    filename: fbResolved,
    loaded: true,
    exports: {
        __esModule: true,
        default: mockAdmin,
        db: mockDb,
        auth: mockAdmin.auth(),
        storage: mockStorage,
    },
} as any;

// ---------------------------------------------------------------------------
// 2. Importar módulos bajo prueba
// ---------------------------------------------------------------------------

import { MetaWhatsAppCloudAdapter } from '../adapters/MetaWhatsAppCloudAdapter';
import {
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    SUPPLY_COLLECTIONS,
    SupplyRepository,
    resolveListLimit,
} from '../application/SupplyRepository';
import {
    clearLocalSupplyTaskTimers,
    registerSupplyTaskHandlers,
    setCustomOidcVerifierForTests,
    waitForLocalSupplyTasksForTests,
} from '../application/SupplyTaskQueueService';
import supplyRouter from '../application/supply.controller';
import { CampChannel } from '../channels/camp.channel';

function createInProcessDispatcher(app: express.Express) {
    return (
        urlPath: string,
        options: { method?: string; headers?: Record<string, string>; body?: string | Record<string, unknown> } = {}
    ): Promise<{ status: number; json: any; elapsedMs: number }> =>
        new Promise((resolve, reject) => {
            const startedAt = Date.now();
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
                options.body === undefined
                    ? Buffer.alloc(0)
                    : typeof options.body === 'string'
                      ? Buffer.from(options.body, 'utf8')
                      : Buffer.from(JSON.stringify(options.body), 'utf8');

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
                const elapsedMs = Date.now() - startedAt;
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
                resolve({ status: res.statusCode || 0, json, elapsedMs });
            });

            res.on('error', reject);
            if (bodyBuf.length > 0) req.push(bodyBuf);
            req.push(null);

            (app as any)(req, res);
        });
}

function buildMetaTextWebhookBody(wamid: string, fromDigits: string, textBody: string): string {
    return JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'WABA_E06',
                changes: [
                    {
                        field: 'messages',
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: { phone_number_id: '109876543210' },
                            messages: [
                                {
                                    from: fromDigits,
                                    id: wamid,
                                    timestamp: String(Math.floor(Date.now() / 1000)),
                                    type: 'text',
                                    text: { body: textBody },
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    });
}

async function seedTenantAndMember(): Promise<void> {
    dbCollections.clear();
    storageBlobs.clear();
    recordedQueryLimits.length = 0;
    clearLocalSupplyTaskTimers();
    MetaWhatsAppCloudAdapter.clearMockOutbox();

    await mockDb.collection('accounts').doc('tenant-e06').set({
        id: 'tenant-e06',
        name: 'Minera E06 SpA',
        status: 'ACTIVE',
        ownerId: 'uid-owner-e06',
        type: 'B2B',
        contract: { status: 'ACTIVE', activeModules: { supply: true } },
    });
    await mockDb.collection(SUPPLY_COLLECTIONS.SITES).doc('site-e06').set({
        siteId: 'site-e06',
        tenantId: 'tenant-e06',
        name: 'Faena E06',
        districtCode: 'CL-ATACAMA',
        shiftPattern: '7x7',
        currentHeadcount: 25,
        waterStorageCapacityL: 20000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
        marketplaceOptIn: false,
        roleMismatchMode: 'FLAG_AND_ACCEPT',
        directPurchaseAlertThresholdClp: 500000,
    });
    await mockDb
        .collection('accounts')
        .doc('tenant-e06')
        .collection('members')
        .doc('uid-camp-e06')
        .set({
            uid: 'uid-camp-e06',
            displayName: 'Operador E06',
            email: 'camp@e06.cl',
            role: 'OPERATOR',
            status: 'ACTIVE',
            phoneE164: '+56900001234',
            whatsappOptInAt: '2026-01-10T10:00:00Z',
            supplyProfile: {
                role: 'CAMP_MANAGER',
                defaultCostCenter: 'CC-CAMPAMENTO',
                assignedSiteIds: ['site-e06'],
            },
        });
    await mockDb
        .collection('accounts')
        .doc('tenant-e06')
        .collection('members')
        .doc('uid-owner-e06')
        .set({
            uid: 'uid-owner-e06',
            displayName: 'Gerencia E06',
            email: 'owner@e06.cl',
            role: 'OWNER',
            status: 'ACTIVE',
            phoneE164: '+56900005678',
            whatsappOptInAt: '2026-01-10T10:00:00Z',
            supplyProfile: {
                role: 'OWNER_EXEC',
                canRecordDirectPurchase: true,
                autoApproveDirectPurchase: true,
                allowCapex: true,
                defaultCostCenter: 'CC-CAPEX',
                assignedSiteIds: ['site-e06'],
            },
        });
}

async function runTests(): Promise<void> {
    const app = express();
    app.use(
        express.json({
            limit: '10mb',
            verify: (req: any, _res, buf) => {
                req.rawBody = Buffer.from(buf);
            },
        })
    );
    app.use('/api/supply', supplyRouter);
    const dispatch = createInProcessDispatcher(app);

    // =========================================================================
    // TEST 1: POST /whatsapp/webhook responde HTTP 200 en < 500ms con worker lento (1200ms)
    // =========================================================================
    {
        await seedTenantAndMember();
        let workerExecuted = false;
        registerSupplyTaskHandlers({
            onInbound: async (payload) => {
                await new Promise((r) => setTimeout(r, 1200));
                await CampChannel.handleInboundMessage(payload.event, {
                    flushImmediately: payload.flushImmediately,
                    dispatchToken: payload.dispatchToken,
                    skipOutboundSend: true,
                });
                workerExecuted = true;
            },
            onFlush: async (payload) =>
                CampChannel.flushDebouncedSession(payload.sessionId, undefined, {
                    skipOutboundSend: true,
                    forceFlush: payload.forceFlush,
                }),
        });

        try {
            const rawBody = buildMetaTextWebhookBody('wamid.e06_fast_ack', '56900001234', '2 kilos de papas');
            const sig = MetaWhatsAppCloudAdapter.computeWebhookSignature(
                rawBody,
                process.env.WHATSAPP_APP_SECRET!
            );
            const resp = await dispatch('/api/supply/whatsapp/webhook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hub-Signature-256': sig,
                },
                body: rawBody,
            });
            assert.equal(resp.status, 200);
            assert.equal(resp.json.ok, true);
            assert.equal(resp.json.results[0].queued, true);
            assert.ok(
                resp.elapsedMs < 500,
                `POST /whatsapp/webhook tardó ${resp.elapsedMs}ms (>= 500ms); debe hacer ACK asíncrono inmediato`
            );
            assert.equal(workerExecuted, false, 'Worker lento de 1200ms no debe bloquear la respuesta HTTP 200');

            // Esperar finalización del worker en segundo plano y verificar que el WAMID pasó a DONE
            await waitForLocalSupplyTasksForTests();
            assert.equal(workerExecuted, true);
            const wamidDoc = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).get('wamid.e06_fast_ack');
            assert.equal(wamidDoc?.status, 'DONE');
            assert.equal(wamidDoc?.attempts, 1);
            assert.ok(wamidDoc?.ttlExpiresAt, 'WAMID debe incluir ttlExpiresAt (7 días)');
        } finally {
            registerSupplyTaskHandlers(null);
            clearLocalSupplyTaskTimers();
        }

        console.log('PASS [1/6] POST /whatsapp/webhook ACK < 500ms con worker de 1200ms (Cloud Tasks async)');
    }

    // =========================================================================
    // TEST 2: WAMID State Machine (DONE bloquea duplicado, FAILED y lease expirado permiten retry)
    // =========================================================================
    {
        await seedTenantAndMember();

        // 2a. DONE bloquea duplicado
        const c1 = await CampChannel.tryClaimWamid('wamid.e06_done', 'tenant-e06');
        assert.equal(c1, true);
        await CampChannel.markWamidDone('wamid.e06_done', 'tenant-e06');
        const c1Dup = await CampChannel.tryClaimWamid('wamid.e06_done', 'tenant-e06');
        assert.equal(c1Dup, false, 'WAMID en estado DONE debe rechazar duplicado');

        // 2b. FAILED permite reintento exitoso (attempts === 2 -> DONE)
        const cFail1 = await CampChannel.tryClaimWamid('wamid.e06_fail_retry', 'tenant-e06');
        assert.equal(cFail1, true);
        await CampChannel.markWamidFailed('wamid.e06_fail_retry', 'tenant-e06', 'Simulated Gemini 503');
        const failedSnap = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).get('wamid.e06_fail_retry');
        assert.equal(failedSnap?.status, 'FAILED');
        assert.equal(failedSnap?.attempts, 1);

        const cFail2 = await CampChannel.tryClaimWamid('wamid.e06_fail_retry', 'tenant-e06');
        assert.equal(cFail2, true, 'WAMID FAILED debe permitir reintento');
        await CampChannel.markWamidDone('wamid.e06_fail_retry', 'tenant-e06');
        const recoveredSnap = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).get('wamid.e06_fail_retry');
        assert.equal(recoveredSnap?.status, 'DONE');
        assert.equal(recoveredSnap?.attempts, 2);

        // 2c. PROCESSING con lease expirado permite reintento exitoso (attempts === 2 -> DONE)
        const cLease1 = await CampChannel.tryClaimWamid('wamid.e06_lease_expired', 'tenant-e06');
        assert.equal(cLease1, true);
        // Mientras lease sigue vigente, un segundo worker concurrente NO puede reclamarlo
        const cLeaseConcurrent = await CampChannel.tryClaimWamid('wamid.e06_lease_expired', 'tenant-e06');
        assert.equal(cLeaseConcurrent, false);
        // Expirar lease simulando caída de instancia Cloud Run
        const leaseDoc = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).get('wamid.e06_lease_expired')!;
        leaseDoc.leaseExpiresAtMs = Date.now() - 5_000;
        const cLease2 = await CampChannel.tryClaimWamid('wamid.e06_lease_expired', 'tenant-e06');
        assert.equal(cLease2, true, 'WAMID PROCESSING con lease expirado debe permitir recuperación');
        await CampChannel.markWamidDone('wamid.e06_lease_expired', 'tenant-e06');
        const leaseRecovered = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).get('wamid.e06_lease_expired');
        assert.equal(leaseRecovered?.status, 'DONE');
        assert.equal(leaseRecovered?.attempts, 2);

        console.log('PASS [2/6] WAMID State Machine (DONE bloquea, FAILED & lease expirado reintentan con attempts=2)');
    }

    // =========================================================================
    // TEST 3: Concurrencia en sesión (Promise.all sin lost update + version) & Staging Stateless XML_DTE_DOCUMENT
    // =========================================================================
    {
        await seedTenantAndMember();

        const [r1, r2] = await Promise.all([
            CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.e06_conc_1',
                    fromE164: '+56900001234',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 kilos de papas',
                },
                { debounceWindowMs: 12000, skipOutboundSend: true }
            ),
            CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.e06_conc_2',
                    fromE164: '+56900001234',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '4 potes de mantequilla',
                },
                { debounceWindowMs: 12000, skipOutboundSend: true }
            ),
        ]);

        assert.equal(r1.buffered, true);
        assert.equal(r2.buffered, true);
        assert.equal(r1.sessionId, r2.sessionId);

        const sessDoc = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).get(r1.sessionId!);
        assert.ok(sessDoc, 'Sesión debe existir en Firestore');
        assert.equal(sessDoc.pendingBuffer.length, 2, 'Ambos turnos concurrentes deben preservarse sin lost update');
        assert.equal(sessDoc.version, 2, 'version optimista debe incrementarse a 2');
        assert.ok(sessDoc.ttlExpiresAt, 'Sesión debe incluir ttlExpiresAt (24h)');
        const bufferedWamids = new Set(sessDoc.pendingBuffer.map((t: any) => t.wamid));
        assert.ok(bufferedWamids.has('wamid.e06_conc_1'));
        assert.ok(bufferedWamids.has('wamid.e06_conc_2'));

        // Staging stateless XML DTE -> perfil XML_DTE_DOCUMENT en CAS TENANT_PRIVATE (cero VIDEO_FIELD_COMPACT, cero RAM)
        const dteXml = `<?xml version="1.0" encoding="ISO-8859-1"?><DTE version="1.0"><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>9911</Folio><FchEmis>2026-11-21</FchEmis></IdDoc><Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Proveedor E06 SpA</RznSoc></Emisor><Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales></Encabezado><Detalle><NmbItem>Pernos Acero</NmbItem><QtyItem>10</QtyItem><PrcItem>10000</PrcItem><MontoItem>100000</MontoItem></Detalle></Documento></DTE>`;
        const xmlRes = await CampChannel.handleInboundMessage(
            {
                wamid: 'wamid.e06_xml_cas',
                fromE164: '+56900005678',
                timestampMs: Date.now(),
                type: 'document',
                mimeType: 'application/xml',
                filename: 'dte_9911.xml',
            },
            { flushImmediately: true, skipOutboundSend: true, inlineXmlContent: dteXml }
        );
        assert.equal(xmlRes.fsmState, 'REVIEW_GATE');
        assert.equal(xmlRes.directPurchaseDraft?.evidenceCasRef?.profile, 'XML_DTE_DOCUMENT');
        assert.ok(xmlRes.directPurchaseDraft?.evidenceCasRef?.sha256);

        clearLocalSupplyTaskTimers();
        console.log('PASS [3/6] Concurrencia Promise.all sin lost update (version=2) y staging CAS XML_DTE_DOCUMENT');
    }

    // =========================================================================
    // TEST 4: verifySupplyWorkerOidcAuth (401/403 fail-closed en producción, 200 autorizado)
    // =========================================================================
    {
        await seedTenantAndMember();
        const prevNodeEnv = process.env.NODE_ENV;
        const prevWorkerUrl = process.env.WORKER_SERVICE_URL;
        const prevWorkerSa = process.env.WORKER_SA_EMAIL;

        process.env.NODE_ENV = 'production';
        process.env.WORKER_SERVICE_URL = 'https://minreport-worker.southamerica-west1.run.app';
        process.env.WORKER_SA_EMAIL = 'supply-tasks-sa@minreport.iam.gserviceaccount.com';

        setCustomOidcVerifierForTests(async (idToken, audience) => {
            if (idToken === 'valid-oidc-token' && audience === process.env.WORKER_SERVICE_URL) {
                return { email: 'supply-tasks-sa@minreport.iam.gserviceaccount.com', email_verified: true };
            }
            if (idToken === 'wrong-sa-token') {
                return { email: 'attacker@evil.iam.gserviceaccount.com', email_verified: true };
            }
            throw new Error('invalid_token');
        });

        try {
            const inboundPayload = {
                event: {
                    wamid: 'wamid.e06_oidc_1',
                    fromE164: '+56900001234',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 kilos de papas',
                },
                flushImmediately: true,
                skipOutboundSend: true,
            };

            // 4a. Sin header Authorization -> 401
            const noAuth = await dispatch('/api/supply/whatsapp/worker/inbound', {
                method: 'POST',
                body: inboundPayload,
            });
            assert.equal(noAuth.status, 401);
            assert.equal(noAuth.json.code, 'WORKER_OIDC_TOKEN_REQUIRED');

            // 4b. Token inválido -> 401
            const badToken = await dispatch('/api/supply/whatsapp/worker/inbound', {
                method: 'POST',
                headers: { Authorization: 'Bearer invalid-token' },
                body: inboundPayload,
            });
            assert.equal(badToken.status, 401);
            assert.equal(badToken.json.code, 'WORKER_OIDC_INVALID');

            // 4c. Service Account incorrecta -> 403
            const wrongSa = await dispatch('/api/supply/whatsapp/worker/inbound', {
                method: 'POST',
                headers: { Authorization: 'Bearer wrong-sa-token' },
                body: inboundPayload,
            });
            assert.equal(wrongSa.status, 403);
            assert.equal(wrongSa.json.code, 'WORKER_OIDC_SA_FORBIDDEN');

            // 4d. Token OIDC válido con SA autorizada -> 200 en /worker/inbound y /worker/flush
            const okInbound = await dispatch('/api/supply/whatsapp/worker/inbound', {
                method: 'POST',
                headers: { Authorization: 'Bearer valid-oidc-token' },
                body: inboundPayload,
            });
            assert.equal(okInbound.status, 200);
            assert.equal(okInbound.json.ok, true);
            assert.equal(okInbound.json.outcome.fsmState, 'REVIEW_GATE');

            const okFlush = await dispatch('/api/supply/whatsapp/worker/flush', {
                method: 'POST',
                headers: { Authorization: 'Bearer valid-oidc-token' },
                body: {
                    sessionId: okInbound.json.outcome.sessionId,
                    skipOutboundSend: true,
                },
            });
            assert.equal(okFlush.status, 200);
            assert.equal(okFlush.json.ok, true);
        } finally {
            setCustomOidcVerifierForTests(null);
            process.env.NODE_ENV = prevNodeEnv;
            if (prevWorkerUrl === undefined) delete process.env.WORKER_SERVICE_URL;
            else process.env.WORKER_SERVICE_URL = prevWorkerUrl;
            if (prevWorkerSa === undefined) delete process.env.WORKER_SA_EMAIL;
            else process.env.WORKER_SA_EMAIL = prevWorkerSa;
        }

        console.log('PASS [4/6] verifySupplyWorkerOidcAuth fail-closed (401/403) y autorizado (200) en producción');
    }

    // =========================================================================
    // TEST 5: firestore.indexes.json válido sin duplicados (members.phoneE164, 3 TTLs, 2 índices allocations)
    // =========================================================================
    {
        const indexesPath = path.resolve(__dirname, '../../../../firestore.indexes.json');
        const raw = fs.readFileSync(indexesPath, 'utf8');
        const parsed = JSON.parse(raw) as { indexes: any[]; fieldOverrides: any[] };

        assert.ok(Array.isArray(parsed.indexes));
        assert.ok(Array.isArray(parsed.fieldOverrides));

        // Sin duplicados en indexes ni fieldOverrides
        const indexKeys = parsed.indexes.map((i) => JSON.stringify(i));
        assert.equal(new Set(indexKeys).size, indexKeys.length, 'firestore.indexes.json contiene índices duplicados');
        const overrideKeys = parsed.fieldOverrides.map((o) => `${o.collectionGroup}::${o.fieldPath}`);
        assert.equal(
            new Set(overrideKeys).size,
            overrideKeys.length,
            'firestore.indexes.json contiene fieldOverrides duplicados'
        );

        // members.phoneE164 con COLLECTION + COLLECTION_GROUP ASCENDING
        const phoneOverride = parsed.fieldOverrides.find(
            (o) => o.collectionGroup === 'members' && o.fieldPath === 'phoneE164'
        );
        assert.ok(phoneOverride, 'Falta fieldOverride members.phoneE164');
        assert.ok(
            phoneOverride.indexes.some((ix: any) => ix.queryScope === 'COLLECTION_GROUP' && ix.order === 'ASCENDING'),
            'Falta índice COLLECTION_GROUP ASCENDING en members.phoneE164'
        );
        assert.ok(
            phoneOverride.indexes.some((ix: any) => ix.queryScope === 'COLLECTION' && ix.order === 'ASCENDING'),
            'Falta índice COLLECTION ASCENDING en members.phoneE164'
        );

        // 3 TTLs (`ttl: true`, `fieldPath: "ttlExpiresAt"`)
        for (const col of ['supply_whatsapp_sessions', 'supply_whatsapp_wamids', 'market_demand_signals']) {
            const ttlOverride = parsed.fieldOverrides.find(
                (o) => o.collectionGroup === col && o.fieldPath === 'ttlExpiresAt' && o.ttl === true
            );
            assert.ok(ttlOverride, `Falta TTL override para ${col}.ttlExpiresAt`);
        }

        // 2 índices compuestos de `supply_fulfillment_allocations`
        const allocIndexes = parsed.indexes.filter((i) => i.collectionGroup === 'supply_fulfillment_allocations');
        assert.ok(
            allocIndexes.some(
                (i) =>
                    i.fields?.length === 3 &&
                    i.fields[0].fieldPath === 'tenantId' &&
                    i.fields[0].order === 'ASCENDING' &&
                    i.fields[1].fieldPath === 'requisitionId' &&
                    i.fields[1].order === 'ASCENDING' &&
                    i.fields[2].fieldPath === 'createdAt' &&
                    i.fields[2].order === 'DESCENDING'
            ),
            'Falta índice compuesto supply_fulfillment_allocations (tenantId, requisitionId, createdAt DESC)'
        );
        assert.ok(
            allocIndexes.some(
                (i) =>
                    i.fields?.length === 3 &&
                    i.fields[0].fieldPath === 'tenantId' &&
                    i.fields[0].order === 'ASCENDING' &&
                    i.fields[1].fieldPath === 'purchaseId' &&
                    i.fields[1].order === 'ASCENDING' &&
                    i.fields[2].fieldPath === 'createdAt' &&
                    i.fields[2].order === 'DESCENDING'
            ),
            'Falta índice compuesto supply_fulfillment_allocations (tenantId, purchaseId, createdAt DESC)'
        );

        console.log('PASS [5/6] firestore.indexes.json válido sin duplicados (members.phoneE164, 3 TTLs, 2 allocations)');
    }

    // =========================================================================
    // TEST 6: Caps FinOps `.limit()` en SupplyRepository (DEFAULT 200 / MAX 500)
    // =========================================================================
    {
        await seedTenantAndMember();
        assert.equal(DEFAULT_LIST_LIMIT, 200);
        assert.equal(MAX_LIST_LIMIT, 500);
        assert.equal(resolveListLimit(undefined), 200);
        assert.equal(resolveListLimit(9999), 500);
        assert.equal(resolveListLimit(50), 50);

        recordedQueryLimits.length = 0;
        await SupplyRepository.listSites('tenant-e06');
        await SupplyRepository.listRequisitions('tenant-e06');
        await SupplyRepository.listPurchases('tenant-e06', undefined, 9999);
        await SupplyRepository.listInventory('tenant-e06');
        await SupplyRepository.listAssets('tenant-e06');
        await SupplyRepository.listCashLedger('tenant-e06');
        await SupplyRepository.listSiiDocuments('tenant-e06');
        await SupplyRepository.listExpenseReports('tenant-e06');

        assert.ok(recordedQueryLimits.length >= 8);
        for (const q of recordedQueryLimits) {
            assert.ok(
                typeof q.limit === 'number' && q.limit > 0 && q.limit <= MAX_LIST_LIMIT,
                `Query en ${q.colPath} sin cota .limit() segura: ${q.limit}`
            );
        }
        const purchasesQuery = recordedQueryLimits.find((q) => q.colPath === SUPPLY_COLLECTIONS.PURCHASES);
        assert.equal(purchasesQuery?.limit, MAX_LIST_LIMIT);

        console.log('PASS [6/6] Caps FinOps .limit() aplicados en todas las queries de SupplyRepository (200/500)');
    }
}

runTests()
    .then(() => {
        console.log('ALL E06 CLOUD RUN WHATSAPP & FINOPS TESTS PASSED (6/6)');
        process.exit(0);
    })
    .catch((err) => {
        console.error('E06 TEST SUITE FAILED:', err);
        process.exit(1);
    });
