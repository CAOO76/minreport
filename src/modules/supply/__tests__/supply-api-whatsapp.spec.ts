/**
 * Suite Integrada Determinista — MINREPORT · ABASTECIMIENTO (API REST, Receipt Intelligence,
 * Meta WhatsApp Cloud API Gateway, Campamento FSM + Direct Purchase Shortcut, SII & M2M x402)
 *
 * Ejecución directa sin Firestore/Meta/Gemini en vivo:
 *   ./node_modules/.bin/ts-node src/modules/supply/__tests__/supply-api-whatsapp.spec.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express from 'express';
import sharp from 'sharp';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.GCP_PROJECT_ID ||= 'minreport-supply-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-supply-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-supply-test.firebasestorage.app';
process.env.WHATSAPP_APP_SECRET = 'test_meta_app_secret_2026';
process.env.WHATSAPP_VERIFY_TOKEN = 'test_meta_verify_token_2026';
process.env.WHATSAPP_ACCESS_TOKEN = 'test_meta_access_token_2026';
process.env.WHATSAPP_PHONE_NUMBER_ID = '109876543210';

// ---------------------------------------------------------------------------
// 1. In-Memory Stubs for Firebase Admin (Firestore + Auth + Storage)
// ---------------------------------------------------------------------------

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const storageBlobs = new Map<string, { buffer: Buffer; contentType: string; metadata: any }>();

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
    let col = dbCollections.get(colPath);
    if (!col) {
        col = new Map();
        dbCollections.set(colPath, col);
    }
    return col;
}

function applyFieldValueTransforms(prev: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...prev };
    for (const [k, v] of Object.entries(incoming)) {
        if (v && typeof v === 'object' && '__inc' in v) {
            out[k] = Number(prev[k] || 0) + Number((v as any).__inc);
        } else {
            out[k] = v;
        }
    }
    return out;
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
            col.set(docId, applyFieldValueTransforms(prev, payload));
        },
        async update(patch: Record<string, any>) {
            const col = getCollectionMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, applyFieldValueTransforms(prev, patch));
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
            const id = `add_${Date.now()}_${autoSeq++}`;
            const ref = createDocRef(colPath, id);
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
        const tx = {
            get: (ref: any) => ref.get(),
            set: (ref: any, data: any, opts?: any) => ref.set(data, opts),
            update: (ref: any, patch: any) => ref.update(patch),
            delete: (ref: any) => ref.delete(),
        };
        return fn(tx);
    },
};

const mockTokens = new Map<string, Record<string, any>>();

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
            file(storagePath: string) {
                return {
                    async save(buffer: Buffer, opts?: any) {
                        storageBlobs.set(storagePath, {
                            buffer: Buffer.from(buffer),
                            contentType: opts?.contentType || 'application/octet-stream',
                            metadata: opts?.metadata || {},
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
            increment: (n: number) => ({ __inc: n }),
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
// 2. Import Modules Under Test AFTER Stubbing Firebase
// ---------------------------------------------------------------------------

import { ResilientAIClient } from '../../../core/resilient-ai-client';
import { registerM2mSupplyAdapterRoutes } from '../../../api/m2m-supply.adapter';
import { MetaWhatsAppCloudAdapter } from '../adapters/MetaWhatsAppCloudAdapter';
import { ReceiptIntelligencePipeline } from '../application/ReceiptIntelligencePipeline';
import { SUPPLY_COLLECTIONS, SupplyRepository } from '../application/SupplyRepository';
import { CampChannel } from '../channels/camp.channel';
import { registerSupplyModuleRoutes } from '../index';

// ---------------------------------------------------------------------------
// 3. Mock ResilientAIClient.generateStructured (capture calls for privacy check)
// ---------------------------------------------------------------------------

interface CapturedAiCall {
    module: string;
    prompt: string;
    mediaCount: number;
    mediaMimes: string[];
}

const capturedAiCalls: CapturedAiCall[] = [];
let nextMockAiResponse: any = null;

(ResilientAIClient as any).generateStructured = async (req: any, zodSchema?: any) => {
    capturedAiCalls.push({
        module: String(req.module),
        prompt: String(req.prompt || ''),
        mediaCount: Array.isArray(req.media) ? req.media.length : 0,
        mediaMimes: Array.isArray(req.media) ? req.media.map((m: any) => m.mimeType) : [],
    });

    const payload =
        typeof nextMockAiResponse === 'function' ? nextMockAiResponse(req) : nextMockAiResponse;
    const validated = zodSchema ? zodSchema.parse(payload) : payload;
    return {
        data: validated,
        meta: {
            text: JSON.stringify(validated),
            model: 'gemini-3-flash-preview',
            tierUsed: 'SECONDARY',
            latencyMs: 42,
            requiresHumanApproval: false,
            groundingSources: [],
            webSearchQueries: [],
        },
    };
};

// ---------------------------------------------------------------------------
// 4. Seed Tenants, Members, Tokens & Spin Up Local Express Test Server
// ---------------------------------------------------------------------------

const TENANT_A = 'tenant-minera-atacama';
const SITE_A = 'site-faena-norte';

async function seedBaseFixtures(): Promise<void> {
    dbCollections.clear();
    storageBlobs.clear();
    MetaWhatsAppCloudAdapter.clearMockOutbox();
    capturedAiCalls.length = 0;

    // Account A (ACTIVE + Corporate Contract ACTIVE)
    await mockDb.collection('accounts').doc(TENANT_A).set({
        id: TENANT_A,
        name: 'Minera Atacama SpA',
        status: 'ACTIVE',
        ownerId: 'uid-owner',
        countryCode: 'CL',
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, stockpile: true, supply: true } },
    });

    // Site A (Altitud 3400m -> DS 28 multiplier 1.15, opt-in Marketplace)
    await mockDb.collection(SUPPLY_COLLECTIONS.SITES).doc(SITE_A).set({
        siteId: SITE_A,
        tenantId: TENANT_A,
        name: 'Campamento Faena Norte',
        districtCode: 'CL-ATACAMA',
        geoFix: { latitude: -27.366, longitude: -70.332, altitudeM: 3400 },
        shiftPattern: '7x7',
        currentHeadcount: 40,
        waterStorageCapacityL: 25000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
        marketplaceOptIn: true,
        roleMismatchMode: 'FLAG_AND_ACCEPT',
        directPurchaseAlertThresholdClp: 500000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });

    // Members in accounts/tenant-minera-atacama/members
    const membersCol = mockDb.collection('accounts').doc(TENANT_A).collection('members');

    // 1) Camp Manager (ACTIVE + whatsappOptInAt)
    await membersCol.doc('uid-camp').set({
        uid: 'uid-camp',
        displayName: 'Carlos Campamento',
        email: 'camp@atacama.cl',
        role: 'OPERATOR',
        status: 'ACTIVE',
        phoneE164: '+56988881111',
        whatsappOptInAt: '2026-01-10T10:00:00Z',
        supplyProfile: {
            role: 'CAMP_MANAGER',
            defaultCostCenter: 'CC-CAMPAMENTO',
            assignedSiteIds: [SITE_A],
        },
    });

    // 2) Buyer (ACTIVE + dual notifications email + whatsapp)
    await membersCol.doc('uid-buyer').set({
        uid: 'uid-buyer',
        displayName: 'Marta Compras',
        email: 'compras@atacama.cl',
        role: 'ADMIN',
        status: 'ACTIVE',
        phoneE164: '+56988882222',
        whatsappOptInAt: '2026-01-10T10:00:00Z',
        notificationPreferences: { email: true, whatsapp: true, digestMode: 'IMMEDIATE', urgentOnly: false },
        supplyProfile: {
            role: 'BUYER',
            canRecordDirectPurchase: true,
            autoApproveDirectPurchase: false,
            defaultCostCenter: 'CC-CAMPAMENTO',
            assignedSiteIds: [SITE_A],
        },
    });

    // 3) Gerente General / Owner (OWNER_EXEC + whatsappOptInAt + #9 emailEnabled/whatsappEnabled prefs)
    await membersCol.doc('uid-owner').set({
        uid: 'uid-owner',
        displayName: 'Roberto Gerente General',
        email: 'gerencia@atacama.cl',
        role: 'OWNER',
        status: 'ACTIVE',
        phoneE164: '+56988883333',
        whatsappOptInAt: '2026-01-10T10:00:00Z',
        notificationPreferences: { emailEnabled: true, whatsappEnabled: true },
        supplyProfile: {
            role: 'OWNER_EXEC',
            canRecordDirectPurchase: true,
            autoApproveDirectPurchase: true,
            allowCapex: true,
            defaultCostCenter: 'CC-GERENCIA',
            assignedSiteIds: [SITE_A],
        },
    });

    // 4) Member WITHOUT whatsappOptInAt (must be blocked by Ley 21.719 gate)
    await membersCol.doc('uid-no-optin').set({
        uid: 'uid-no-optin',
        displayName: 'Sin OptIn',
        email: 'nooptin@atacama.cl',
        role: 'OPERATOR',
        status: 'ACTIVE',
        phoneE164: '+56988884444',
        whatsappOptInAt: null,
    });

    // 5) Suspended Member WITH whatsappOptInAt (must be blocked)
    await membersCol.doc('uid-suspended').set({
        uid: 'uid-suspended',
        displayName: 'Suspendido',
        email: 'susp@atacama.cl',
        role: 'OPERATOR',
        status: 'SUSPENDED',
        phoneE164: '+56988885555',
        whatsappOptInAt: '2026-01-10T10:00:00Z',
    });

    // Auth tokens
    mockTokens.set('tok-owner', {
        uid: 'uid-owner',
        email: 'gerencia@atacama.cl',
        email_verified: true,
        activeAccountId: TENANT_A,
    });
    mockTokens.set('tok-camp', {
        uid: 'uid-camp',
        email: 'camp@atacama.cl',
        email_verified: true,
        activeAccountId: TENANT_A,
    });
    mockTokens.set('tok-dev', {
        uid: 'dev-master-root-uid',
        email: 'dev@minreport.com',
        email_verified: true,
        isMasterDev: true,
        role: 'DEV_ROOT',
    });
}

interface InProcessResponse {
    status: number;
    headers: Headers;
    text: () => Promise<string>;
    json: () => Promise<any>;
}

function createTestDispatcher(): (
    urlOrPath: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }
) => Promise<InProcessResponse> {
    const app = express();
    app.use(
        express.json({
            limit: '15mb',
            verify: (req: any, _res, buf) => {
                req.rawBody = Buffer.from(buf);
            },
        })
    );
    registerSupplyModuleRoutes(app);
    registerM2mSupplyAdapterRoutes(app);

    return (urlOrPath, init = {}) =>
        new Promise<InProcessResponse>((resolve, reject) => {
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
            req.method = (init.method || 'GET').toUpperCase();
            req.url = urlOrPath.startsWith('http')
                ? new URL(urlOrPath).pathname + new URL(urlOrPath).search
                : urlOrPath;

            const bodyBuf =
                init.body === undefined
                    ? Buffer.alloc(0)
                    : Buffer.isBuffer(init.body)
                      ? init.body
                      : Buffer.from(init.body, 'utf8');

            const normalizedHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(init.headers || {})) {
                normalizedHeaders[k.toLowerCase()] = v;
            }
            if (bodyBuf.length > 0 && !normalizedHeaders['content-length']) {
                normalizedHeaders['content-length'] = String(bodyBuf.length);
            }
            req.headers = normalizedHeaders;

            const res = new http.ServerResponse(req);
            res.assignSocket(socket);

            res.on('finish', () => {
                const rawResponse = Buffer.concat(rawChunks);
                const sepIdx = rawResponse.indexOf('\r\n\r\n');
                const bodyPart = sepIdx >= 0 ? rawResponse.subarray(sepIdx + 4) : Buffer.alloc(0);

                // Decode chunked transfer encoding if present
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

                const outHeaders = new Headers();
                for (const [k, v] of Object.entries(res.getHeaders())) {
                    if (v === undefined) continue;
                    outHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
                }

                const bodyStr = finalBodyBuf.toString('utf8');
                resolve({
                    status: res.statusCode,
                    headers: outHeaders,
                    text: async () => bodyStr,
                    json: async () => JSON.parse(bodyStr),
                });
            });

            res.on('error', reject);

            if (bodyBuf.length > 0) {
                req.push(bodyBuf);
            }
            req.push(null);

            (app as any)(req, res);
        });
}

function buildMetaTextWebhookBody(wamid: string, fromDigits: string, textBody: string) {
    return {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'WABA_1',
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
    };
}

async function runTests(): Promise<void> {
    await seedBaseFixtures();
    const apiFetch = createTestDispatcher();
    const baseUrl = 'http://in-process.local';

    {
        console.log('1) Testing Meta WhatsApp Webhook GET challenge & POST HMAC-SHA256...');
        {
            // Valid GET challenge
            const okChallenge = await apiFetch(
                `${baseUrl}/api/supply/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test_meta_verify_token_2026&hub.challenge=CHALLENGE_9981`
            );
            assert.equal(okChallenge.status, 200);
            assert.equal(await okChallenge.text(), 'CHALLENGE_9981');

            // Invalid GET token -> 403
            const badChallenge = await apiFetch(
                `${baseUrl}/api/supply/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=CHALLENGE_9981`
            );
            assert.equal(badChallenge.status, 403);

            // POST without signature -> 401 Fail-Closed
            const bodyObj = buildMetaTextWebhookBody('wamid.hmac_fail', '56988881111', 'hola');
            const rawJson = JSON.stringify(bodyObj);
            const noSigResp = await apiFetch(`${baseUrl}/api/supply/whatsapp/webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: rawJson,
            });
            assert.equal(noSigResp.status, 401);

            // POST with tampered signature -> 401 Fail-Closed
            const badSigResp = await apiFetch(`${baseUrl}/api/supply/whatsapp/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64),
                },
                body: rawJson,
            });
            assert.equal(badSigResp.status, 401);

            // POST with valid HMAC-SHA256 -> 200 & buffered in debounce queue
            const validSig = MetaWhatsAppCloudAdapter.computeWebhookSignature(
                rawJson,
                process.env.WHATSAPP_APP_SECRET!
            );
            const okPost = await apiFetch(`${baseUrl}/api/supply/whatsapp/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hub-Signature-256': validSig,
                },
                body: rawJson,
            });
            assert.equal(okPost.status, 200);
            const postJson: any = await okPost.json();
            assert.equal(postJson.ok, true);
            assert.equal(postJson.results[0].buffered, true);

            // Replay SAME wamid -> idempotent duplicate=true
            const dupPost = await apiFetch(`${baseUrl}/api/supply/whatsapp/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hub-Signature-256': validSig,
                },
                body: rawJson,
            });
            assert.equal(dupPost.status, 200);
            const dupJson: any = await dupPost.json();
            assert.equal(dupJson.results[0].duplicate, true);
            assert.equal(dupJson.results[0].handled, false);
        }

        console.log('2) Testing Ley 21.719 Opt-In & Active Membership Gate...');
        {
            const noOptIn = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.no_optin_1',
                    fromE164: '+56988884444',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 kilos de papas',
                },
                { flushImmediately: true, skipOutboundSend: true }
            );
            assert.equal(noOptIn.unauthorized, true);
            assert.equal(noOptIn.handled, false);

            const suspended = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.suspended_1',
                    fromE164: '+56988885555',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 kilos de papas',
                },
                { flushImmediately: true, skipOutboundSend: true }
            );
            assert.equal(suspended.unauthorized, true);

            const unknown = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.unknown_1',
                    fromE164: '+56999990000',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: 'hola',
                },
                { flushImmediately: true, skipOutboundSend: true }
            );
            assert.equal(unknown.unauthorized, true);
        }

        console.log('3) Testing Campamento FSM (Mantequilla + 2 kg papas + huevos) + Debounce + Dual Notification...');
        {
            await seedBaseFixtures();

            // Send 3 rapid bubbles within 8-15s debounce window
            const b1 = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.deb_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: 'Mantequilla',
                },
                { debounceWindowMs: 10000 }
            );
            const b2 = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.deb_2',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 kilos de papas',
                },
                { debounceWindowMs: 10000 }
            );
            const b3 = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.deb_3',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: 'y huevos',
                },
                { debounceWindowMs: 10000 }
            );
            assert.equal(b1.buffered, true);
            assert.equal(b2.buffered, true);
            assert.equal(b3.buffered, true);
            assert.equal(MetaWhatsAppCloudAdapter.getMockOutbox().length, 0); // ZERO premature replies!

            // Flush debounced turn -> ONE consolidated single-bubble SLOT_FILLING reply
            const turn1 = await CampChannel.flushDebouncedSession(b3.sessionId!, undefined, {
                forceFlush: true,
            });
            assert.equal(turn1.fsmState, 'SLOT_FILLING');
            assert.ok(turn1.replyText?.includes('Papas: 2 kg'));
            assert.ok(turn1.replyText?.includes('mantequilla'));
            assert.ok(turn1.replyText?.includes('bandejas'));
            assert.equal(MetaWhatsAppCloudAdapter.getMockOutbox().length, 1);

            // Turn 2: Fill missing slots -> transitions to REVIEW_GATE with normalized SI units
            const turn2 = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.slot_reply_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 potes de mantequilla y 2 bandejas de huevos',
                },
                { flushImmediately: true }
            );
            assert.equal(turn2.fsmState, 'REVIEW_GATE');
            assert.ok(turn2.replyText?.includes('0.5 kg')); // 2 potes * 0.25 kg
            assert.ok(turn2.replyText?.includes('60 un')); // 2 bandejas * 30 un
            assert.equal(turn2.replyButtons?.length, 2);

            // Turn 3: Confirm with "OK" -> COMMITTED + AuditLedger + Dual buyer notification (Email + WhatsApp)
            const turn3 = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.confirm_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: 'OK',
                },
                { flushImmediately: true }
            );
            assert.equal(turn3.fsmState, 'COMMITTED');
            assert.ok(turn3.committedRequisition?.reqId);
            assert.equal(turn3.committedRequisition?.lines.length, 3);

            // Verify AuditLedger entry recorded
            const auditEntries = Array.from(getCollectionMap('audit_ledger').values());
            assert.ok(
                auditEntries.some(
                    (e) => e.action === 'SUPPLY_REQUISITION_CREATED' && e.module === 'supply'
                )
            );

            // Verify dual buyer notification: Resend mock email (`system_emails`) + WhatsApp Utility template
            const mockEmails = Array.from(getCollectionMap('system_emails').values());
            assert.ok(mockEmails.length >= 1, 'Buyer email notification must be sent');
            const waTemplates = MetaWhatsAppCloudAdapter.getMockOutbox().filter((m) => m.kind === 'template');
            assert.ok(waTemplates.length >= 1, 'Buyer WhatsApp Utility template must be sent');
        }

        console.log('4) Testing GLOBAL_HARD_DENY (DS 132) + ATYPICAL_ROLE_MISMATCH + Audio .ogg extraction...');
        {
            // Mixed request: 2 kg tallarines + 24 cervezas + 1 helicóptero
            const hardDenyRes = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.hard_deny_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 kilos de tallarines, 24 cervezas y 1 helicóptero',
                },
                { flushImmediately: true, skipOutboundSend: true }
            );
            assert.equal(hardDenyRes.fsmState, 'REVIEW_GATE');
            assert.equal(hardDenyRes.deniedItems?.length, 2);
            assert.ok(hardDenyRes.replyText?.includes('Tallarines'));
            assert.ok(hardDenyRes.replyText?.includes('DS 132'));

            // Cancel draft before next test
            await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.cancel_hd',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: 'CANCELAR',
                },
                { flushImmediately: true, skipOutboundSend: true }
            );

            // Universal reception with ATYPICAL_ROLE_MISMATCH (CAMP_MANAGER asking for hydraulic filter)
            const atypicalRes = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.atypical_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'text',
                    textBody: '2 filtros hidráulicos Caterpillar',
                },
                { flushImmediately: true, skipOutboundSend: true }
            );
            assert.equal(atypicalRes.fsmState, 'REVIEW_GATE');
            assert.ok(atypicalRes.atypicalFlags?.includes('ATYPICAL_ROLE_MISMATCH'));

            // Audio .ogg multimodal transcription via ResilientAIClient
            nextMockAiResponse = {
                transcript: 'Necesito 3 mallas de papas',
                intent: 'ADD_ITEMS',
                items: [{ rawText: '3 mallas de papas', itemName: 'malla de papas', quantity: 3, unitRaw: 'mallas' }],
            };
            const audioRes = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.audio_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'audio',
                    mimeType: 'audio/ogg',
                },
                {
                    flushImmediately: true,
                    skipOutboundSend: true,
                    inlineMediaBuffer: Buffer.from('OggS_fake_opus_audio_bytes'),
                    inlineMediaMimeType: 'audio/ogg',
                }
            );
            assert.equal(audioRes.fsmState, 'REVIEW_GATE');
            assert.ok(audioRes.replyText?.includes('75 kg')); // 3 mallas * 25 kg Ley del Saco!
            assert.ok(capturedAiCalls.some((c) => c.module === 'supply' && c.mediaMimes.includes('audio/ogg')));
        }

        console.log('5) Testing ReceiptIntelligencePipeline (CAS + PII Scrub + TED PDF417 + XML DTE + Arithmetic)...');
        {
            // Create real small PNG via sharp so MediaDigestorServer digests it into WebP & strips EXIF
            const syntheticReceiptPng = await sharp({
                create: { width: 320, height: 240, channels: 3, background: { r: 245, g: 245, b: 245 } },
            })
                .png()
                .toBuffer();

            const validTedXml = `<TED version="1.0"><DD><RE>76192083-9</RE><TD>33</TD><F>4501</F><FE>2026-11-20</FE><RR>77123456-K</RR><MNT>238000</MNT><IT1>Cocina Industrial 4 Platos</IT1></DD><FRMT>FAKE</FRMT></TED>`;

            // Mock AI returns mismatched total + wrong RUT -> deterministic TED must override header!
            nextMockAiResponse = {
                supplierName: 'Comercial Industrial Norte Ltda',
                supplierTaxId: '11111111-1',
                documentType: 39,
                folio: 999,
                issueDate: '2026-01-01',
                totalAmountClp: 238000,
                lines: [
                    {
                        description: 'Cocina Industrial 4 Platos',
                        quantity: 1,
                        unitRaw: 'un',
                        unitPriceClp: 200000,
                        subtotalClp: 200000,
                        isCapexSuspected: true,
                    },
                ],
            };

            capturedAiCalls.length = 0;
            const analyzed = await ReceiptIntelligencePipeline.analyze({
                tenantId: TENANT_A,
                actorUid: 'uid-owner',
                rawBuffer: syntheticReceiptPng,
                mimeType: 'image/png',
                originalFilename: 'factura_cocina.png',
                clientOriginalBytes: 512000,
                tedRawXml: validTedXml,
                contextCaption: 'Enviado por contacto@atacama.cl tel +56 9 8888 3333 RUT 12.345.678-5',
            });

            // TED overrides AI header deterministically
            assert.equal(analyzed.supplierTaxId, '76192083-9');
            assert.equal(analyzed.supplierRutValid, true);
            assert.equal(analyzed.documentType, 33);
            assert.equal(analyzed.folio, 4501);
            assert.equal(analyzed.dedupeKey, '76192083-9#33#4501');
            assert.equal(analyzed.vatCreditRecoverableClp, 38000);
            assert.equal(analyzed.missingInvoiceAlert, false); // DTE 33 backs CAPEX cleanly
            assert.equal(analyzed.arithmeticCheck.verified, true); // 200000 net * 1.19 = 238000 gross
            assert.equal(analyzed.arithmeticCheck.pricingBasis, 'NET_PLUS_VAT');

            // Verify CAS storage telemetry preserved (`originalBytes`, `optimizedBytes`, `savingsPct`)
            assert.ok(analyzed.evidenceCasRef);
            assert.equal(analyzed.evidenceCasRef!.originalBytes, 512000);
            assert.ok(analyzed.evidenceCasRef!.optimizedBytes > 0);
            assert.ok(analyzed.evidenceCasRef!.savingsPct > 0);
            assert.ok(analyzed.evidenceCasRef!.storagePath.startsWith(`cas_blobs/tenants/${TENANT_A}/`));

            // Verify PII was scrubbed BEFORE reaching ResilientAIClient
            assert.equal(capturedAiCalls.length, 1);
            assert.ok(!capturedAiCalls[0].prompt.includes('contacto@atacama.cl'));
            assert.ok(!capturedAiCalls[0].prompt.includes('8888 3333'));
            assert.ok(!capturedAiCalls[0].prompt.includes('12.345.678-5'));
            assert.ok(analyzed.scrubbedRedactedCategories.includes('EMAIL'));
            assert.ok(analyzed.scrubbedRedactedCategories.includes('TELEFONO'));
            assert.ok(analyzed.scrubbedRedactedCategories.includes('RUT_IDENTIFICADOR'));

            // Arithmetic mismatch check
            nextMockAiResponse = {
                supplierName: 'Ferretería Prueba',
                supplierTaxId: '76192083-9',
                documentType: 39,
                folio: 120,
                issueDate: '2026-11-20',
                totalAmountClp: 50000,
                lines: [
                    { description: 'Pernos', quantity: 10, unitRaw: 'un', unitPriceClp: 1000, subtotalClp: 10000 },
                ],
            };
            const mismatch = await ReceiptIntelligencePipeline.analyze({
                tenantId: TENANT_A,
                actorUid: 'uid-buyer',
                rawBuffer: syntheticReceiptPng,
                mimeType: 'image/png',
            });
            assert.equal(mismatch.arithmeticCheck.verified, false);
            assert.equal(mismatch.arithmeticCheck.pricingBasis, 'MISMATCH');
            assert.equal(mismatch.arithmeticCheck.deltaClp, -40000);
        }

        console.log('6) Testing Executive Direct Purchase Shortcut (OWNER_EXEC WhatsApp) + CAPEX Boleta Alert...');
        {
            const dteXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0"><Documento>
  <Encabezado>
    <IdDoc><TipoDTE>33</TipoDTE><Folio>7701</Folio><FchEmis>2026-11-20</FchEmis></IdDoc>
    <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Equipamiento Minero SA</RznSoc></Emisor>
    <Receptor><RUTRecep>77123456-K</RUTRecep></Receptor>
    <Totales><MntNeto>300000</MntNeto><IVA>57000</IVA><MntTotal>357000</MntTotal></Totales>
  </Encabezado>
  <Detalle><NmbItem>Cocina Industrial Campamento</NmbItem><QtyItem>1</QtyItem><UnmdItem>un</UnmdItem><PrcItem>357000</PrcItem><MontoItem>357000</MontoItem></Detalle>
</Documento></DTE>`;

            const ownerDraft = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.owner_direct_1',
                    fromE164: '+56988883333',
                    timestampMs: Date.now(),
                    type: 'document',
                    mimeType: 'application/xml',
                    filename: 'dte_7701.xml',
                },
                { flushImmediately: true, inlineXmlContent: dteXml }
            );
            assert.equal(ownerDraft.fsmState, 'REVIEW_GATE');
            assert.ok(ownerDraft.directPurchaseDraft);
            assert.equal(ownerDraft.directPurchaseDraft!.documentType, 33);
            assert.equal(ownerDraft.directPurchaseDraft!.missingInvoiceAlert, false);

            const ownerCommit = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.owner_direct_ok',
                    fromE164: '+56988883333',
                    timestampMs: Date.now(),
                    type: 'interactive',
                    interactiveReplyId: 'DIRECT_PURCHASE_CONFIRM',
                },
                { flushImmediately: true }
            );
            assert.equal(ownerCommit.fsmState, 'COMMITTED');
            assert.ok(ownerCommit.committedPurchaseId);

            // Confirm CAPEX asset was created in `supply_assets` without invoice alert
            const assets = await SupplyRepository.listAssets(TENANT_A, SITE_A);
            assert.equal(assets.length, 1);
            assert.equal(assets[0].missingInvoiceAlert, false);
            assert.equal(assets[0].acquisitionNetClp, 300000);
            assert.equal(assets[0].vatCreditClp, 57000);

            // Re-submitting SAME DTE via REST API -> HTTP 409 SII_DUPLICATE_DOCUMENT
            const dupResp = await apiFetch(`${baseUrl}/api/supply/purchases`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    siteId: SITE_A,
                    purchaseMode: 'DIRECT_AUTONOMOUS',
                    supplierTaxId: '76192083-9',
                    supplierName: 'Equipamiento Minero SA',
                    documentType: 33,
                    folio: 7701,
                    issueDate: '2026-11-20',
                    netAmountClp: 300000,
                    vatAmountClp: 57000,
                    totalAmountClp: 357000,
                    paymentMethod: 'REEMBOLSO_GERENCIA',
                    lines: [
                        {
                            purchaseLineId: 'pl_dup',
                            canonicalSkuId: 'sku-cocina-industrial',
                            description: 'Cocina Industrial Campamento',
                            categoryCode: 'ACTIVO_EQUIPAMIENTO',
                            procurementBucket: 'MANTENCION_EQUIPAMIENTO',
                            unitSi: 'un',
                            qtyPurchased: 1,
                            unitPriceClp: 357000,
                            subtotalClp: 357000,
                            destination: 'CAPEX_ASSET',
                            isCapexAsset: true,
                        },
                    ],
                }),
            });
            assert.equal(dupResp.status, 409);
            const dupBody: any = await dupResp.json();
            assert.equal(dupBody.code, 'SII_DUPLICATE_DOCUMENT');

            // Missing HITL keyword -> HTTP 400
            const noHitlResp = await apiFetch(`${baseUrl}/api/supply/purchases`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'GUARDAR',
                    siteId: SITE_A,
                    purchaseMode: 'DIRECT_AUTONOMOUS',
                    supplierTaxId: '76192083-9',
                    supplierName: 'Equipamiento Minero SA',
                    documentType: 39,
                    folio: 9002,
                    issueDate: '2026-11-20',
                    netAmountClp: 100000,
                    vatAmountClp: 19000,
                    totalAmountClp: 119000,
                    paymentMethod: 'REEMBOLSO_GERENCIA',
                    lines: [
                        {
                            purchaseLineId: 'pl_nohitl',
                            canonicalSkuId: 'sku-pan',
                            description: 'Pan',
                            unitSi: 'kg',
                            qtyPurchased: 5,
                            unitPriceClp: 2000,
                            subtotalClp: 10000,
                            destination: 'STOCK_IN_TRANSIT',
                        },
                    ],
                }),
            });
            assert.equal(noHitlResp.status, 400);
        }

        console.log('7) Testing 13 Mixed Requisitions Consolidation + FIFO Backlog (huevos/pernos/pan) vs Purchase (pan/pernos/cocina) + Reception...');
        {
            await seedBaseFixtures();

            // Exact user backlog: 60 huevos, 10 pernos, 10 kg pan
            const reqBacklog = await SupplyRepository.createRequisition(
                {
                    tenantId: TENANT_A,
                    siteId: SITE_A,
                    requesterUid: 'uid-camp',
                    requesterName: 'Carlos Campamento',
                    requesterRole: 'CAMP_MANAGER',
                    requesterPhoneE164: '+56988881111',
                    demandOrigin: 'WA_CAMP',
                    demandNature: 'REACTIVE_FIELD',
                    costCenter: 'CC-CAMPAMENTO',
                    atypicalFlags: [],
                    lines: [
                        {
                            lineId: 'ln_huevos',
                            canonicalSkuId: 'sku-huevos',
                            itemName: 'Huevos',
                            categoryCode: 'VIVERES_ALIMENTACION',
                            procurementBucket: 'SUPERMERCADO',
                            unitSi: 'un',
                            qtyRequested: 60,
                            qtyPurchased: 0,
                            qtyReceived: 0,
                            qtyPending: 60,
                            lineStatus: 'OPEN',
                            atypicalFlags: [],
                            fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                            urgency: 'STANDARD',
                        },
                        {
                            lineId: 'ln_pernos',
                            canonicalSkuId: 'sku-pernos',
                            itemName: 'Pernos Industriales',
                            categoryCode: 'FERRETERIA_CONSTRUCCION',
                            procurementBucket: 'FERRETERIA',
                            unitSi: 'un',
                            qtyRequested: 10,
                            qtyPurchased: 0,
                            qtyReceived: 0,
                            qtyPending: 10,
                            lineStatus: 'OPEN',
                            atypicalFlags: [],
                            fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                            urgency: 'HIGH',
                        },
                        {
                            lineId: 'ln_pan',
                            canonicalSkuId: 'sku-pan',
                            itemName: 'Pan',
                            categoryCode: 'VIVERES_ALIMENTACION',
                            procurementBucket: 'SUPERMERCADO',
                            unitSi: 'kg',
                            qtyRequested: 10,
                            qtyPurchased: 0,
                            qtyReceived: 0,
                            qtyPending: 10,
                            lineStatus: 'OPEN',
                            atypicalFlags: [],
                            fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                            urgency: 'CRITICAL',
                        },
                    ],
                },
                { actorUid: 'uid-camp', actorEmail: 'camp@atacama.cl' }
            );

            // Seed 12 more mixed requisitions (total 13) across all commerce buckets
            const mixedSpecs: Array<{
                sku: string;
                name: string;
                cat: any;
                bucket: any;
                unit: any;
                qty: number;
            }> = [
                { sku: 'sku-papas', name: 'Papas', cat: 'VIVERES_ALIMENTACION', bucket: 'VERDULERIA', unit: 'kg', qty: 25 },
                { sku: 'sku-papas', name: 'Papas', cat: 'VIVERES_ALIMENTACION', bucket: 'VERDULERIA', unit: 'kg', qty: 50 },
                { sku: 'sku-agua-bidon', name: 'Agua Purificada', cat: 'AGUA_POTABLE', bucket: 'GAS_AGUA_COMBUSTIBLE', unit: 'L', qty: 200 },
                { sku: 'sku-gas-glp', name: 'Gas Licuado GLP', cat: 'GAS_ENERGIA_CAMP', bucket: 'GAS_AGUA_COMBUSTIBLE', unit: 'kg', qty: 45 },
                { sku: 'sku-cemento', name: 'Cemento', cat: 'FERRETERIA_CONSTRUCCION', bucket: 'FERRETERIA', unit: 'kg', qty: 50 },
                { sku: 'sku-epp-bototos', name: 'Bototos Seguridad', cat: 'EPP_SEGURIDAD', bucket: 'EPP_SEGURIDAD', unit: 'par', qty: 4 },
                { sku: 'sku-filtro-hidraulico', name: 'Filtro Hidráulico', cat: 'REPUESTOS_MAQUINARIA', bucket: 'REPUESTOS_OPERMAQ', unit: 'un', qty: 2 },
                { sku: 'sku-tallarines', name: 'Tallarines', cat: 'VIVERES_ALIMENTACION', bucket: 'SUPERMERCADO', unit: 'kg', qty: 12 },
                { sku: 'sku-mantequilla', name: 'Mantequilla', cat: 'VIVERES_ALIMENTACION', bucket: 'SUPERMERCADO', unit: 'kg', qty: 3 },
                { sku: 'sku-pernos', name: 'Pernos Industriales', cat: 'FERRETERIA_CONSTRUCCION', bucket: 'FERRETERIA', unit: 'un', qty: 15 },
                { sku: 'sku-pan', name: 'Pan', cat: 'VIVERES_ALIMENTACION', bucket: 'SUPERMERCADO', unit: 'kg', qty: 5 },
                { sku: 'sku-agua-bidon', name: 'Agua Purificada', cat: 'AGUA_POTABLE', bucket: 'GAS_AGUA_COMBUSTIBLE', unit: 'L', qty: 100 },
            ];

            for (let i = 0; i < mixedSpecs.length; i++) {
                const s = mixedSpecs[i];
                await SupplyRepository.createRequisition(
                    {
                        tenantId: TENANT_A,
                        siteId: SITE_A,
                        requesterUid: 'uid-camp',
                        requesterName: `Solicitante ${i + 2}`,
                        requesterRole: 'CAMP_MANAGER',
                        demandOrigin: 'WA_CAMP',
                        demandNature: 'REACTIVE_FIELD',
                        costCenter: 'CC-CAMPAMENTO',
                        atypicalFlags: [],
                        lines: [
                            {
                                lineId: `m_line_${i}`,
                                canonicalSkuId: s.sku,
                                itemName: s.name,
                                categoryCode: s.cat,
                                procurementBucket: s.bucket,
                                unitSi: s.unit,
                                qtyRequested: s.qty,
                                qtyPurchased: 0,
                                qtyReceived: 0,
                                qtyPending: s.qty,
                                lineStatus: 'OPEN',
                                atypicalFlags: [],
                                fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                                urgency: 'STANDARD',
                            },
                        ],
                    },
                    { actorUid: 'uid-camp', actorEmail: 'camp@atacama.cl' }
                );
            }

            // GET /api/supply/shopping-lists/consolidated -> 13 requisitions grouped by commerce bucket
            const consResp = await apiFetch(`${baseUrl}/api/supply/shopping-lists/consolidated?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(consResp.status, 200);
            const consJson: any = await consResp.json();
            assert.equal(consJson.consolidated.openRequisitionCount, 13);
            assert.ok(consJson.consolidated.buckets.length >= 5);
            const verdBucket = consJson.consolidated.buckets.find((b: any) => b.procurementBucket === 'VERDULERIA');
            assert.equal(verdBucket.items[0].totalQtyPending, 75);
            assert.equal(verdBucket.items[0].sourceReqRefs.length, 2);

            // Commit Mixed Purchase via REST API: 4 kg pan + 10 pernos + 1 cocina (Boleta DTE 39 -> missingInvoiceAlert!)
            const purResp = await apiFetch(`${baseUrl}/api/supply/purchases`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    siteId: SITE_A,
                    purchaseMode: 'MIXED_FULFILLMENT_AND_DIRECT',
                    supplierTaxId: '76192083-9',
                    supplierName: 'Comercial Mixta Copiapó',
                    documentType: 39,
                    folio: 3001,
                    issueDate: '2026-11-21',
                    netAmountClp: 200000,
                    vatAmountClp: 38000,
                    totalAmountClp: 238000,
                    paymentMethod: 'FONDO_POR_RENDIR',
                    lines: [
                        {
                            purchaseLineId: 'pl_pan',
                            canonicalSkuId: 'sku-pan',
                            description: 'Pan Hallulla',
                            categoryCode: 'VIVERES_ALIMENTACION',
                            procurementBucket: 'SUPERMERCADO',
                            unitSi: 'kg',
                            qtyPurchased: 4,
                            unitPriceClp: 2000,
                            subtotalClp: 8000,
                            destination: 'STOCK_IN_TRANSIT',
                            explicitAllocations: [
                                { reqId: reqBacklog.reqId, reqLineId: 'ln_pan', qtyAllocated: 4 },
                            ],
                        },
                        {
                            purchaseLineId: 'pl_pernos',
                            canonicalSkuId: 'sku-pernos',
                            description: 'Pernos Industriales',
                            categoryCode: 'FERRETERIA_CONSTRUCCION',
                            procurementBucket: 'FERRETERIA',
                            unitSi: 'un',
                            qtyPurchased: 10,
                            unitPriceClp: 1000,
                            subtotalClp: 10000,
                            destination: 'STOCK_IN_TRANSIT',
                            explicitAllocations: [
                                { reqId: reqBacklog.reqId, reqLineId: 'ln_pernos', qtyAllocated: 10 },
                            ],
                        },
                        {
                            purchaseLineId: 'pl_cocina',
                            canonicalSkuId: 'sku-cocina-industrial',
                            description: 'Cocina Campamento',
                            categoryCode: 'ACTIVO_EQUIPAMIENTO',
                            procurementBucket: 'MANTENCION_EQUIPAMIENTO',
                            unitSi: 'un',
                            qtyPurchased: 1,
                            unitPriceClp: 220000,
                            subtotalClp: 220000,
                            destination: 'CAPEX_ASSET',
                            isCapexAsset: true,
                        },
                    ],
                }),
            });
            assert.equal(purResp.status, 201);
            const purJson: any = await purResp.json();
            assert.equal(purJson.missingInvoiceAlert, true); // CAPEX backed by Boleta 39!
            assert.equal(purJson.createdAssets.length, 1);
            assert.equal(purJson.createdAssets[0].missingInvoiceAlert, true);

            // Verify backlog exact reconciliation: pernos FULFILLED, pan PARTIAL (6 kg left), huevos OPEN (60 left)
            const freshReqSnap = await mockDb
                .collection(SUPPLY_COLLECTIONS.REQUISITIONS)
                .doc(reqBacklog.reqId)
                .get();
            const freshReq = freshReqSnap.data();
            const panLine = freshReq.lines.find((l: any) => l.lineId === 'ln_pan');
            const pernosLine = freshReq.lines.find((l: any) => l.lineId === 'ln_pernos');
            const huevosLine = freshReq.lines.find((l: any) => l.lineId === 'ln_huevos');
            assert.equal(pernosLine.lineStatus, 'FULFILLED');
            assert.equal(pernosLine.qtyPending, 0);
            assert.equal(panLine.lineStatus, 'PARTIAL');
            assert.equal(panLine.qtyPending, 6);
            assert.equal(huevosLine.lineStatus, 'OPEN');
            assert.equal(huevosLine.qtyPending, 60);

            // Verify inventory is IN_TRANSIT before reception confirmation
            const invBeforeResp = await apiFetch(`${baseUrl}/api/supply/inventory?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            const invBefore: any = await invBeforeResp.json();
            const panInvBefore = invBefore.items.find((i: any) => i.canonicalSkuId === 'sku-pan');
            assert.equal(panInvBefore.qtyInTransit, 4);
            assert.equal(panInvBefore.qtyInWarehouse, 0);

            // Confirm reception with HITL "ACTUALIZAR" -> IN_TRANSIT -> IN_WAREHOUSE
            const recResp = await apiFetch(
                `${baseUrl}/api/supply/purchases/${purJson.purchase.purchaseId}/confirm-reception`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer tok-owner',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ confirmationKeyword: 'ACTUALIZAR' }),
                }
            );
            assert.equal(recResp.status, 200);

            const invAfterResp = await apiFetch(`${baseUrl}/api/supply/inventory?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            const invAfter: any = await invAfterResp.json();
            const panInvAfter = invAfter.items.find((i: any) => i.canonicalSkuId === 'sku-pan');
            assert.equal(panInvAfter.qtyInTransit, 0);
            assert.equal(panInvAfter.qtyInWarehouse, 4);

            // Link CAPEX asset to OPERMAQ with HITL "ACTUALIZAR"
            const linkResp = await apiFetch(
                `${baseUrl}/api/supply/assets/${purJson.createdAssets[0].assetId}/link-opermaq`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer tok-owner',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        confirmationKeyword: 'ACTUALIZAR',
                        opermaqAssetId: 'opermaq_asset_cocina_01',
                    }),
                }
            );
            assert.equal(linkResp.status, 200);
            const linkJson: any = await linkResp.json();
            assert.equal(linkJson.asset.opermaqAssetId, 'opermaq_asset_cocina_01');
        }

        console.log('8) Testing SII Export CSV, DS 594 Forecast, k>=3 Anonymous Marketplace, M2M x402 & Simulator RBAC...');
        {
            // SII CSV Export
            const csvResp = await apiFetch(`${baseUrl}/api/supply/sii/export?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(csvResp.status, 200);
            const csvText = await csvResp.text();
            assert.ok(csvText.includes('DEDUPE_KEY;RUT_EMISOR;PROVEEDOR'));
            assert.ok(csvText.includes('76192083-9#39#3001'));

            // Forecast DS 594 + altitude 3400m multiplier 1.15
            const fcResp = await apiFetch(`${baseUrl}/api/supply/forecast?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(fcResp.status, 200);
            const fcJson: any = await fcResp.json();
            assert.equal(fcJson.forecasts[0].altitudeMultiplier, 1.15);
            assert.equal(fcJson.forecasts[0].requiredWaterReserveL, Math.round(40 * 120 * 1.15 * 7));
            assert.equal(fcJson.forecasts[0].waterAlertLevel, 'WARNING'); // 25000L < 38640L required for 7d

            // Also seed a SINGLE tenant with 3 sites in CL-TARAPACA (must be blocked: distinctTenants=1 < 3!)
            for (const extra of [
                { tenantId: 'tenant-b', siteId: 'site-b', districtCode: 'CL-ATACAMA' },
                { tenantId: 'tenant-c', siteId: 'site-c', districtCode: 'CL-ATACAMA' },
                { tenantId: 'tenant-d', siteId: 'site-d', districtCode: 'CL-COQUIMBO' },
                { tenantId: 'tenant-e', siteId: 'site-e', districtCode: 'CL-COQUIMBO' },
                { tenantId: 'tenant-single', siteId: 'site-single-1', districtCode: 'CL-TARAPACA' },
                { tenantId: 'tenant-single', siteId: 'site-single-2', districtCode: 'CL-TARAPACA' },
                { tenantId: 'tenant-single', siteId: 'site-single-3', districtCode: 'CL-TARAPACA' },
            ]) {
                await mockDb.collection(SUPPLY_COLLECTIONS.SITES).doc(extra.siteId).set({
                    siteId: extra.siteId,
                    tenantId: extra.tenantId,
                    name: `Faena ${extra.siteId}`,
                    districtCode: extra.districtCode,
                    marketplaceOptIn: true,
                    currentHeadcount: 15,
                    waterStorageCapacityL: 15000,
                    ds594DailyWaterTargetLPerPax: 120,
                    leadTimeDays: 7,
                    shiftPattern: '7x7',
                    roleMismatchMode: 'FLAG_AND_ACCEPT',
                    directPurchaseAlertThresholdClp: 500000,
                });
                await SupplyRepository.createRequisition(
                    {
                        tenantId: extra.tenantId,
                        siteId: extra.siteId,
                        requesterUid: `uid-${extra.tenantId}`,
                        requesterName: 'Operador',
                        requesterRole: 'CAMP_MANAGER',
                        demandOrigin: 'WA_CAMP',
                        demandNature: 'REACTIVE_FIELD',
                        costCenter: 'CC-CAMPAMENTO',
                        atypicalFlags: [],
                        lines: [
                            {
                                lineId: `l_${extra.siteId}`,
                                canonicalSkuId: 'sku-papas',
                                itemName: 'Papas',
                                categoryCode: 'VIVERES_ALIMENTACION',
                                procurementBucket: 'VERDULERIA',
                                unitSi: 'kg',
                                qtyRequested: 50,
                                qtyPurchased: 0,
                                qtyReceived: 0,
                                qtyPending: 50,
                                lineStatus: 'OPEN',
                                atypicalFlags: [],
                                fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                                urgency: 'STANDARD',
                            },
                        ],
                    },
                    { actorUid: `uid-${extra.tenantId}`, actorEmail: 'op@test.cl' }
                );
            }

            // Unprivileged B2B OWNER cannot refresh global marketplace signals -> HTTP 403
            const refreshForbidden = await apiFetch(`${baseUrl}/api/supply/marketplace-signals/refresh`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ confirmationKeyword: 'ACTUALIZAR' }),
            });
            assert.equal(refreshForbidden.status, 403);

            // DEV_ROOT without HITL keyword -> HTTP 400
            const refreshNoHitl = await apiFetch(`${baseUrl}/api/supply/marketplace-signals/refresh`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-dev',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            assert.equal(refreshNoHitl.status, 400);

            // DEV_ROOT with HITL "ACTUALIZAR" -> HTTP 200
            const refreshResp = await apiFetch(`${baseUrl}/api/supply/marketplace-signals/refresh`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-dev',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ confirmationKeyword: 'ACTUALIZAR' }),
            });
            assert.equal(refreshResp.status, 200);
            const refreshJson: any = await refreshResp.json();
            // ONLY CL-ATACAMA (3 distinct tenants + 3 distinct sites)! CL-COQUIMBO (k=2) & CL-TARAPACA (1 tenant, 3 sites) suppressed!
            assert.equal(refreshJson.count, 1);
            assert.equal(refreshJson.signals[0].districtCode, 'CL-ATACAMA');
            assert.equal(refreshJson.signals[0].participatingEntitiesCount, 3);
            assert.equal(refreshJson.signals[0].optInVerified, true);
            assert.equal(refreshJson.signals[0].skuName, 'Papas');
            assert.equal(refreshJson.signals[0].procurementBucket, 'VERDULERIA');
            assert.ok(refreshJson.signals[0].periodWindow);
            assert.ok(refreshJson.signals[0].expiresAt);
            assert.equal('tenantId' in refreshJson.signals[0], false);
            assert.equal('geoFix' in refreshJson.signals[0], false);
            // Exact .strict() keyset parity with #9 DemandPoolSignalSchema
            const allowedStrictKeys = new Set([
                'signalId',
                'districtCode',
                'periodWindow',
                'canonicalSkuId',
                'skuName',
                'categoryCode',
                'procurementBucket',
                'unitSi',
                'aggregatedQty',
                'participatingEntitiesCount',
                'optInVerified',
                'medianReferenceUnitClp',
                'generatedAt',
                'expiresAt',
            ]);
            for (const k of Object.keys(refreshJson.signals[0])) {
                assert.ok(allowedStrictKeys.has(k), `Unexpected non-strict signal key: ${k}`);
            }

            // M2M x402 Gatekeeper: unauthenticated -> HTTP 402 Payment Required
            const m2m402 = await apiFetch(`${baseUrl}/api/m2m/supply/demand-signals`);
            assert.equal(m2m402.status, 402);
            const m2m402Json: any = await m2m402.json();
            assert.equal(m2m402Json.standard, 'x402 Foundation v1.0');
            assert.ok(m2m402.headers.get('payment-required'));

            // M2M x402 with Corporate Contract Bearer -> HTTP 200
            const m2mOk = await apiFetch(`${baseUrl}/api/m2m/supply/demand-signals?districtCode=CL-ATACAMA`, {
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'x-tenant-id': TENANT_A,
                },
            });
            assert.equal(m2mOk.status, 200);
            const m2mOkJson: any = await m2mOk.json();
            assert.equal(m2mOkJson.count, 1);
            assert.equal(m2mOkJson.privacyCompliance, 'LEY_21719_K_ANONYMITY_GE_3');

            // Simulator endpoint works for DEV_ROOT
            const simOk = await apiFetch(`${baseUrl}/api/supply/whatsapp/simulate`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-dev',
                    'Content-Type': 'application/json',
                    'x-tenant-id': TENANT_A,
                },
                body: JSON.stringify({
                    fromPhoneE164: '+56977776666',
                    textBody: 'Mantequilla, 2 kilos de papas y huevos',
                    simulatedRole: 'CAMP_MANAGER',
                    siteId: SITE_A,
                    flushImmediately: true,
                }),
            });
            assert.equal(simOk.status, 200);
            const simJson: any = await simOk.json();
            assert.equal(simJson.outcome.fsmState, 'SLOT_FILLING');

            // Simulator endpoint rejects regular B2B OPERATOR with HTTP 403
            const simBlocked = await apiFetch(`${baseUrl}/api/supply/whatsapp/simulate`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-camp',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ textBody: '2 kilos de papas' }),
            });
            assert.equal(simBlocked.status, 403);

            // Cross-tenant isolation check -> HTTP 403 TENANT_ACCESS_DENIED
            const crossTenant = await apiFetch(`${baseUrl}/api/supply/sites`, {
                headers: {
                    Authorization: 'Bearer tok-camp',
                    'x-tenant-id': 'tenant-b',
                },
            });
            assert.equal(crossTenant.status, 403);

            // REST API: POST /api/supply/receipts/analyze (XML DTE), SII Expense Report, Cash Ledger & Catalog
            const analyzeHttp = await apiFetch(`${baseUrl}/api/supply/receipts/analyze`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tedRawXml: `<TED version="1.0"><DD><RE>76192083-9</RE><TD>39</TD><F>3001</F><FE>2026-11-21</FE><MNT>238000</MNT><IT1>Pan</IT1></DD></TED>`,
                }),
            });
            assert.equal(analyzeHttp.status, 200);
            const analyzeHttpJson: any = await analyzeHttp.json();
            assert.equal(analyzeHttpJson.analysis.duplicateDetected, true); // Already registered in test 7!

            const siiDocsResp = await apiFetch(`${baseUrl}/api/supply/sii/documents?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(siiDocsResp.status, 200);
            const siiDocsJson: any = await siiDocsResp.json();
            assert.ok(siiDocsJson.documents.length >= 1);

            const expReportResp = await apiFetch(`${baseUrl}/api/supply/sii/expense-reports`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    siteId: SITE_A,
                    paymentMethod: 'FONDO_POR_RENDIR',
                    title: 'Rendición Turno Noviembre',
                    fundAdvanceClp: 300000,
                    siiDocumentIds: [siiDocsJson.documents[0].docId],
                }),
            });
            assert.equal(expReportResp.status, 201);
            const expReportJson: any = await expReportResp.json();
            assert.equal(expReportJson.report.renderedTotalClp, 238000);
            assert.equal(expReportJson.report.balanceClp, 62000);

            const cashResp = await apiFetch(`${baseUrl}/api/supply/cash-ledger?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(cashResp.status, 200);
            const cashJson: any = await cashResp.json();
            assert.equal(cashJson.summary.capexTotalClp, 220000); // Cocina separated in CAPEX!
            assert.equal(cashJson.summary.opexTotalClp, 18000); // Only pan + pernos in OPEX!

            const catalogResp = await apiFetch(`${baseUrl}/api/supply/catalog?search=papas`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(catalogResp.status, 200);
            const catalogJson: any = await catalogResp.json();
            assert.ok(catalogJson.items.some((i: any) => i.canonicalSkuId === 'sku-papas'));

            // M2M x402: Catalog SKUs & RFQ Quote submission
            const m2mCatResp = await apiFetch(`${baseUrl}/api/m2m/supply/catalog/skus`, {
                headers: { Authorization: 'Bearer tok-owner', 'x-tenant-id': TENANT_A },
            });
            assert.equal(m2mCatResp.status, 200);
            const m2mCatJson: any = await m2mCatResp.json();
            assert.ok(m2mCatJson.skus.length > 0);

            const signalId = m2mOkJson.signals[0].signalId;
            const rfqResp = await apiFetch(`${baseUrl}/api/m2m/supply/rfq-quotes`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'x-tenant-id': TENANT_A,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    signalId,
                    supplierTaxId: '76192083-9',
                    supplierName: 'Distribuidora Atacama Mayorista',
                    deliveryDistrictCode: 'CL-ATACAMA',
                    unitPriceNetClp: 850,
                    minOrderQty: 50,
                    maxAvailableQty: 500,
                    leadTimeDays: 2,
                    validUntilIso: '2026-12-01T00:00:00Z',
                }),
            });
            assert.equal(rfqResp.status, 201);

            // MetaWhatsAppCloudAdapter.downloadMedia CDN allowlist verification
            MetaWhatsAppCloudAdapter.setCustomFetchForTests(async (url: any) => {
                const u = String(url);
                if (u.includes('graph.facebook.com/v21.0/media_ok_123')) {
                    return new Response(
                        JSON.stringify({
                            url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123',
                            mime_type: 'audio/ogg; codecs=opus',
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    );
                }
                if (u.includes('graph.facebook.com/v21.0/media_evil_999')) {
                    return new Response(
                        JSON.stringify({
                            url: 'https://evil.example.com/steal-bearer',
                            mime_type: 'audio/ogg',
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    );
                }
                return new Response(Buffer.from('OggS_verified_binary'), {
                    status: 200,
                    headers: { 'Content-Type': 'audio/ogg' },
                });
            });

            const downloaded = await MetaWhatsAppCloudAdapter.downloadMedia('media_ok_123');
            assert.equal(downloaded.mimeType, 'audio/ogg');
            assert.equal(downloaded.buffer.toString('utf8'), 'OggS_verified_binary');

            await assert.rejects(
                () => MetaWhatsAppCloudAdapter.downloadMedia('media_evil_999'),
                /lista blanca CDN/i
            );
            MetaWhatsAppCloudAdapter.setCustomFetchForTests(null);
        }

        console.log('9) Testing Security Guards (Site/Catalog IDOR, Zero Base64 in Firestore, Double-Reception 409, #9/#11 Contract Alignment)...');
        {
            // Seed second tenant account + owner token to test cross-tenant IDOR attacks
            await mockDb.collection('accounts').doc('tenant-b').set({
                id: 'tenant-b',
                name: 'Minera Rival SpA',
                status: 'ACTIVE',
                ownerId: 'uid-owner-b',
                countryCode: 'CL',
                contract: { status: 'ACTIVE', activeModules: { supply: true } },
            });
            mockTokens.set('tok-owner-b', {
                uid: 'uid-owner-b',
                email: 'owner@rival.cl',
                email_verified: true,
                activeAccountId: 'tenant-b',
            });

            // 9.1 POST /sites requires HITL "ACTUALIZAR" -> HTTP 400 without it
            const siteNoHitl = await apiFetch(`${baseUrl}/api/supply/sites`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner-b',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: 'Nuevo Sitio',
                    districtCode: 'CL-ATACAMA',
                }),
            });
            assert.equal(siteNoHitl.status, 400);

            // 9.2 Site IDOR guard: tenant-b trying to overwrite TENANT_A's siteId -> HTTP 403!
            const siteIdor = await apiFetch(`${baseUrl}/api/supply/sites`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner-b',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    siteId: SITE_A,
                    name: 'HACKED SITE',
                    districtCode: 'CL-ATACAMA',
                }),
            });
            assert.equal(siteIdor.status, 403);
            const intactSiteA = await SupplyRepository.getSite(TENANT_A, SITE_A);
            assert.equal(intactSiteA?.name, 'Campamento Faena Norte');

            // 9.3 Catalog SKU IDOR guard: tenant-b SKU is namespaced and NEVER overwrites global master SKU
            const devGlobalSku = await apiFetch(`${baseUrl}/api/supply/catalog`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-dev',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    scope: 'GLOBAL',
                    canonicalSkuId: 'sku-master-global-1',
                    name: 'SKU Maestro Oficial',
                    categoryCode: 'FERRETERIA_CONSTRUCCION',
                    procurementBucket: 'FERRETERIA',
                    baseUnitSi: 'un',
                }),
            });
            assert.equal(devGlobalSku.status, 201);

            const tenantSku = await apiFetch(`${baseUrl}/api/supply/catalog`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner-b',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    scope: 'TENANT',
                    canonicalSkuId: 'sku-master-global-1',
                    name: 'Override Privado Tenant B',
                    categoryCode: 'FERRETERIA_CONSTRUCCION',
                    procurementBucket: 'FERRETERIA',
                    baseUnitSi: 'un',
                }),
            });
            assert.equal(tenantSku.status, 201);
            const globalMasterDoc = getCollectionMap(SUPPLY_COLLECTIONS.GLOBAL_CATALOG).get('sku-master-global-1');
            assert.equal(globalMasterDoc?.name, 'SKU Maestro Oficial');
            const namespacedTenantDoc = getCollectionMap(SUPPLY_COLLECTIONS.GLOBAL_CATALOG).get(
                'tenant_tenant-b__sku-master-global-1'
            );
            assert.equal(namespacedTenantDoc?.tenantId, 'tenant-b');

            // 9.4 ZERO Base64 persisted in Firestore `supply_whatsapp_sessions` when buffering image
            const samplePng = await sharp({
                create: { width: 120, height: 90, channels: 3, background: { r: 220, g: 220, b: 220 } },
            })
                .png()
                .toBuffer();

            const bufImgOutcome = await CampChannel.handleInboundMessage(
                {
                    wamid: 'wamid.cas_no_b64_1',
                    fromE164: '+56988881111',
                    timestampMs: Date.now(),
                    type: 'image',
                    mimeType: 'image/png',
                    caption: 'llave rota',
                },
                {
                    debounceWindowMs: 10000,
                    inlineMediaBuffer: samplePng,
                    inlineMediaMimeType: 'image/png',
                    skipOutboundSend: true,
                }
            );
            assert.equal(bufImgOutcome.buffered, true);
            const persistedSession = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).get(
                bufImgOutcome.sessionId!
            );
            const serializedSession = JSON.stringify(persistedSession);
            assert.ok(!serializedSession.includes('inlineMediaBase64'));
            assert.ok(!serializedSession.includes('data:image'));
            assert.ok(persistedSession?.pendingBuffer?.some((t: any) => t.evidenceCasRef?.sha256));

            // 9.5 Contract alignment (#9 & #11): rawDescription, evidenceCasRef analyze, string folio + EFECTIVO + allocations[], qtyReceivedNow, double-reception 409, createOpermaqFleetUnit, dteType, REIMBURSED, #9 simulate
            const req9 = await apiFetch(`${baseUrl}/api/supply/requisitions`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    siteId: SITE_A,
                    lines: [
                        {
                            rawDescription: '5 bolsas de cemento portland',
                            normalizedName: 'Cemento Portland',
                            qtyRequested: 125,
                            unitSi: 'kg',
                            urgency: 'PLANNED',
                        },
                    ],
                }),
            });
            assert.equal(req9.status, 201);
            const req9Json: any = await req9.json();

            const preDigestedCas = persistedSession!.pendingBuffer.find((t: any) => t.evidenceCasRef).evidenceCasRef;
            nextMockAiResponse = {
                supplierName: 'Ferretería Copiapó',
                supplierTaxId: '76192083-9',
                documentType: 33,
                folio: 8844,
                issueDate: '2026-11-21',
                totalAmountClp: 119000,
                lines: [
                    {
                        description: 'Cemento Portland',
                        quantity: 125,
                        unitRaw: 'kg',
                        unitPriceClp: 800,
                        subtotalClp: 100000,
                    },
                ],
            };
            const analyzeCas = await apiFetch(`${baseUrl}/api/supply/receipts/analyze`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    evidenceCasRef: preDigestedCas,
                }),
            });
            assert.equal(analyzeCas.status, 200);
            const analyzeCasJson: any = await analyzeCas.json();
            assert.equal(analyzeCasJson.analysis.evidenceCasRef.sha256, preDigestedCas.sha256);

            const pur9 = await apiFetch(`${baseUrl}/api/supply/purchases`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    siteId: SITE_A,
                    purchaseMode: 'MIXED_FULFILLMENT_AND_DIRECT',
                    supplierTaxId: '76192083-9',
                    supplierName: 'Ferretería Copiapó',
                    documentType: 33,
                    folio: '8844',
                    issueDate: '2026-11-21',
                    netAmountClp: 100000,
                    vatAmountClp: 19000,
                    totalAmountClp: 119000,
                    paymentMethod: 'EFECTIVO',
                    evidenceCasRef: preDigestedCas,
                    lines: [
                        {
                            purchaseLineId: 'pl_cem_9',
                            canonicalSkuId: 'sku-cemento',
                            rawDescription: 'Cemento Portland 25kg',
                            normalizedName: 'Cemento Portland',
                            qtyPurchased: 125,
                            unitSi: 'kg',
                            unitPriceNetClp: 800,
                            unitPriceGrossClp: 952,
                            lineNetClp: 100000,
                            lineVatClp: 19000,
                            lineTotalClp: 119000,
                            destination: 'STOCK_IN_TRANSIT',
                            costCenter: 'CC-OPERACIONES',
                        },
                        {
                            purchaseLineId: 'pl_gen_9',
                            canonicalSkuId: 'sku-generador',
                            rawDescription: 'Generador 5kVA',
                            normalizedName: 'Generador 5kVA',
                            qtyPurchased: 1,
                            unitSi: 'un',
                            lineNetClp: 500000,
                            lineVatClp: 95000,
                            lineTotalClp: 595000,
                            destination: 'CAPEX_ASSET',
                            isCapexAsset: true,
                            costCenter: 'CC-CAPEX',
                        },
                    ],
                    allocations: [
                        {
                            purchaseLineId: 'pl_cem_9',
                            requisitionId: req9Json.requisition.reqId,
                            requisitionLineId: req9Json.requisition.lines[0].lineId,
                            allocationKind: 'REQUISITION_MATCH',
                            qtyAllocated: 125,
                            unitSi: 'kg',
                            resultingRequisitionLineStatus: 'FULFILLED',
                        },
                    ],
                }),
            });
            assert.equal(pur9.status, 201);
            const pur9Json: any = await pur9.json();

            // Reception with #9 `qtyReceivedNow` -> 200
            const recFirst = await apiFetch(
                `${baseUrl}/api/supply/purchases/${pur9Json.purchase.purchaseId}/confirm-reception`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer tok-owner',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        confirmationKeyword: 'ACTUALIZAR',
                        receivedLines: [{ purchaseLineId: 'pl_cem_9', qtyReceivedNow: 125 }],
                    }),
                }
            );
            assert.equal(recFirst.status, 200);

            // Second reception call on SAME purchase -> HTTP 409 PURCHASE_ALREADY_RECEIVED (no double-count!)
            const recSecond = await apiFetch(
                `${baseUrl}/api/supply/purchases/${pur9Json.purchase.purchaseId}/confirm-reception`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer tok-owner',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        confirmationKeyword: 'ACTUALIZAR',
                        receivedLines: [{ purchaseLineId: 'pl_cem_9', qtyReceivedNow: 125 }],
                    }),
                }
            );
            assert.equal(recSecond.status, 409);
            const recSecondJson: any = await recSecond.json();
            assert.equal(recSecondJson.code, 'PURCHASE_ALREADY_RECEIVED');

            const invCemResp = await apiFetch(`${baseUrl}/api/supply/inventory?siteId=${SITE_A}`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            const invCemJson: any = await invCemResp.json();
            const cemInv = invCemJson.items.find((i: any) => i.canonicalSkuId === 'sku-cemento');
            assert.equal(cemInv.qtyInWarehouse, 125); // NOT 250!

            // Link asset with #9 `createOpermaqFleetUnit: true` (omitting opermaqAssetId)
            const linkAuto = await apiFetch(
                `${baseUrl}/api/supply/assets/${pur9Json.createdAssets[0].assetId}/link-opermaq`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer tok-owner',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        confirmationKeyword: 'ACTUALIZAR',
                        createOpermaqFleetUnit: true,
                    }),
                }
            );
            assert.equal(linkAuto.status, 200);
            const linkAutoJson: any = await linkAuto.json();
            assert.equal(linkAutoJson.createdFleetUnitRef, true);
            assert.ok(linkAutoJson.asset.opermaqAssetId.startsWith('opermaq_unit_'));

            // GET /sii/documents?dteType=33 alias + expense report periodLabel/costCenter/REIMBURSED
            const dteAliasResp = await apiFetch(`${baseUrl}/api/supply/sii/documents?dteType=33`, {
                headers: { Authorization: 'Bearer tok-owner' },
            });
            assert.equal(dteAliasResp.status, 200);
            const dteAliasJson: any = await dteAliasResp.json();
            assert.ok(dteAliasJson.documents.every((d: any) => d.documentType === 33));

            const exp9 = await apiFetch(`${baseUrl}/api/supply/sii/expense-reports`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    siteId: SITE_A,
                    paymentMethod: 'EFECTIVO',
                    title: 'Rendición Mensual',
                    periodLabel: '2026-11',
                    costCenter: 'CC-OPERACIONES',
                    fundAdvanceClp: 200000,
                    siiDocumentIds: [dteAliasJson.documents[0].docId],
                }),
            });
            assert.equal(exp9.status, 201);
            const exp9Json: any = await exp9.json();
            assert.equal(exp9Json.report.periodLabel, '2026-11');
            assert.equal(exp9Json.report.costCenter, 'CC-OPERACIONES');

            const expPatch = await apiFetch(
                `${baseUrl}/api/supply/sii/expense-reports/${exp9Json.report.reportId}`,
                {
                    method: 'PATCH',
                    headers: {
                        Authorization: 'Bearer tok-owner',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        confirmationKeyword: 'ACTUALIZAR',
                        status: 'REIMBURSED',
                    }),
                }
            );
            assert.equal(expPatch.status, 200);

            // Simulate WhatsApp with #9 field names (`phoneE164`, `text`, `simulateSenderRole`)
            const sim9 = await apiFetch(`${baseUrl}/api/supply/whatsapp/simulate`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-dev',
                    'Content-Type': 'application/json',
                    'x-tenant-id': TENANT_A,
                },
                body: JSON.stringify({
                    phoneE164: '+56966665555',
                    text: '2 kilos de papas',
                    simulateSenderRole: 'CAMP_MANAGER',
                    siteId: SITE_A,
                }),
            });
            assert.equal(sim9.status, 200);
            const sim9Json: any = await sim9.json();
            assert.equal(sim9Json.fsmState, 'REVIEW_GATE');
            assert.ok(typeof sim9Json.replyText === 'string' && sim9Json.replyText.includes('Papas'));
        }

        console.log('\n✅ ALL SUPPLY API + WHATSAPP + RECEIPT + SII + M2M x402 TESTS PASSED!');
    }
}

runTests().catch((err) => {
    console.error('\n❌ SUPPLY API/WHATSAPP TEST SUITE FAILED:', err);
    process.exit(1);
});
