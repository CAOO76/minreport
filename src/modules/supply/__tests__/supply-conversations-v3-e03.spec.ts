/**
 * MINREPORT · ABASTECIMIENTO — V3-E03 Guardrail Dinámico por Turno + Archivo Inmutable SHA-256 + Índices
 *
 * Verifica de forma determinista (Node v20.19.5, cero red, cero celulares reales):
 * 1. Cambio de canal en vivo dentro de la misma conversación (`scopeFingerprint` y `systemInstruction` dinámicos, `dataClassification: 'TENANT_PRIVATE'`).
 * 2. Expiración de permiso temporal justo antes de `OK` (`commitCampRequisition` remueve solo el ítem expirado, audita `TEMPORARY_GRANT_EXPIRED_ATTEMPT` y solicita confirmación de los ítems vigentes).
 * 3. Rechazo cortés `CHANNEL_SCOPE_DENIED` + `DS132` manteniendo ítems válidos y conversación viva + filtrado en WhatsApp Flows (`handleCampOrderFlow`).
 * 4. Cero `phoneE164` en texto plano dentro de `supply_whatsapp_sessions` (`phoneMasked` + `phoneHashSha256`) y cadena `SHA-256` íntegra en `supply_conversation_turns` (detecta tampering).
 * 5. Retención diferenciada `OPERATIONAL_24M` vs `TAX_HOLD_6Y` (`linkedRequisitionIds` / `linkedDteIds`) y `LEGAL_HOLD_PSEUDONYMIZED` ante ARCO-P.
 * 6. Endpoints HTTP `/api/supply/conversations`, `/:threadId/turns` y `/:threadId/export` (`JSON` / `CSV` + `X-Content-SHA256` + RBAC `403`).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express, { type Express } from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.GCP_PROJECT_ID ||= 'minreport-supply-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-supply-test';
process.env.WHATSAPP_APP_SECRET ||= 'test_meta_app_secret_2026';

// ---------------------------------------------------------------------------
// 1. In-Memory Firebase Stub con soporte `orderBy` real, `collectionGroup` y `runTransaction`
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

function compareFieldValues(aVal: unknown, bVal: unknown): number {
    if (aVal === bVal) return 0;
    if (aVal === undefined || aVal === null) return -1;
    if (bVal === undefined || bVal === null) return 1;
    if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
    return String(aVal).localeCompare(String(bVal));
}

function createQueryChain(
    colPaths: string[],
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    orders: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
    maxLimit = 1000
): any {
    return {
        where(field: string, op: string, value: unknown) {
            return createQueryChain(colPaths, [...filters, { field, op, value }], orders, maxLimit);
        },
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
            return createQueryChain(colPaths, filters, [...orders, { field, dir }], maxLimit);
        },
        limit(n: number) {
            return createQueryChain(colPaths, filters, orders, n);
        },
        async get() {
            const matched: Array<{ id: string; colPath: string; data: Record<string, any> }> = [];
            for (const colPath of colPaths) {
                for (const [id, data] of getCollectionMap(colPath).entries()) {
                    const ok = filters.every((f) => {
                        const fieldVal = data[f.field];
                        if (f.op === '==') return fieldVal === f.value;
                        if (f.op === 'array-contains') {
                            return Array.isArray(fieldVal) && fieldVal.includes(f.value);
                        }
                        if (f.op === 'in' && Array.isArray(f.value)) {
                            return f.value.includes(fieldVal);
                        }
                        if (f.op === '>=') return compareFieldValues(fieldVal, f.value) >= 0;
                        if (f.op === '<=') return compareFieldValues(fieldVal, f.value) <= 0;
                        return true;
                    });
                    if (ok) {
                        matched.push({ id, colPath, data });
                    }
                }
            }
            if (orders.length > 0) {
                matched.sort((a, b) => {
                    for (const ord of orders) {
                        const cmp = compareFieldValues(a.data[ord.field], b.data[ord.field]);
                        if (cmp !== 0) return ord.dir === 'desc' ? -cmp : cmp;
                    }
                    return 0;
                });
            }
            const sliced = matched.slice(0, maxLimit).map((m) => ({
                id: m.id,
                ref: createDocRef(m.colPath, m.id),
                exists: true,
                data: () => JSON.parse(JSON.stringify(m.data)),
            }));
            return { empty: sliced.length === 0, size: sliced.length, docs: sliced };
        },
    };
}

function createCollectionRef(colPath: string): any {
    let autoSeq = 1;
    return {
        doc(docId?: string) {
            const id = docId || `auto_${Date.now()}_${autoSeq++}`;
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
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
            return createQueryChain([colPath], [], [{ field, dir }]);
        },
        limit(n: number) {
            return createQueryChain([colPath], [], [], n);
        },
        async get() {
            return createQueryChain([colPath]).get();
        },
    };
}

const mockDb: any = {
    collection(colName: string) {
        return createCollectionRef(colName);
    },
    collectionGroup(subName: string) {
        const suffix = `/${subName}`;
        const matchingPaths = Array.from(dbCollections.keys()).filter(
            (p) => p === subName || p.endsWith(suffix)
        );
        return createQueryChain(matchingPaths);
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

const storageBlobs = new Map<string, { buffer: Buffer; contentType: string; metadata: any }>();
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
        },
        Timestamp: {
            fromMillis: (ms: number) => ({ toMillis: () => ms }),
        },
    }),
    auth: () => mockAuth,
    storage: () => mockStorage,
};

const firebaseResolved = require.resolve(path.resolve(__dirname, '../../../config/firebase'));
require.cache[firebaseResolved] = {
    id: firebaseResolved,
    filename: firebaseResolved,
    loaded: true,
    exports: { __esModule: true, default: mockAdmin, db: mockDb, auth: mockAuth, storage: mockStorage },
} as any;

import { ResilientAIClient } from '../../../core/resilient-ai-client';
import {
    buildProfileGrantDocId,
    ProvisionalSupplyProfileAdapter,
} from '../adapters/ProvisionalSupplyProfileAdapter';
import {
    createSignedFlowToken,
    resolveFlowTokenSigningSecret,
} from '../adapters/WhatsAppFlowsCrypto';
import {
    buildConversationThreadId,
    ConversationAuditService,
    GENESIS_CONVERSATION_HASH,
} from '../application/ConversationAuditService';
import { SUPPLY_COLLECTIONS, SupplyRepository } from '../application/SupplyRepository';
import { CampChannel } from '../channels/camp.channel';
import {
    buildDynamicChannelSystemInstruction,
    computeChannelScopeFingerprint,
    DynamicChannelScopeResolver,
} from '../channels/DynamicChannelScopeResolver';
import { SupplyFlowsHandler } from '../channels/supply.flows';
import { registerSupplyModuleRoutes } from '../index';

// ---------------------------------------------------------------------------
// 2. Mock ResilientAIClient para capturar systemInstruction / dataClassification por turno
// ---------------------------------------------------------------------------

interface CapturedAiCall {
    module: string;
    systemInstruction: string;
    dataClassification?: string;
    prompt: string;
}

const capturedAiCalls: CapturedAiCall[] = [];

(ResilientAIClient as any).generateStructured = async function (req: any) {
    capturedAiCalls.push({
        module: String(req.module || ''),
        systemInstruction: String(req.systemInstruction || ''),
        dataClassification: req.dataClassification,
        prompt: String(req.prompt || ''),
    });
    const promptLower = String(req.prompt || '').toLowerCase();
    const mediaDecoded = String(req.media?.[0]?.dataBase64 || '')
        ? Buffer.from(String(req.media[0].dataBase64), 'base64').toString('utf8')
        : '';
    if (mediaDecoded.includes('PRE_OK_TEST2') || promptLower.includes('pre-ok-test2')) {
        return {
            data: {
                transcript: '20 kg arroz y 2 filtros de aceite para pala 101',
                intent: 'ADD_ITEMS',
                items: [
                    {
                        rawText: '20 kg arroz',
                        itemName: 'arroz',
                        quantity: 20,
                        unitRaw: 'kg',
                    },
                    {
                        rawText: '2 filtro aceite cat PALA-101',
                        itemName: 'filtro de aceite',
                        quantity: 2,
                        unitRaw: 'un',
                        linkedAssetId: 'PALA-101',
                    },
                ],
            },
            modelUsed: 'gemini-2.5-flash-test',
        };
    }
    if (promptLower.includes('transcribe este audio') || promptLower.includes('manguera hidráulica')) {
        return {
            data: {
                transcript: 'necesito 2 mangueras hidráulicas para la pala 101',
                intent: 'ADD_ITEMS',
                items: [
                    {
                        rawText: '2 manguera hidráulica pala 101',
                        itemName: 'manguera hidráulica',
                        quantity: 2,
                        unitRaw: 'un',
                        linkedAssetId: 'PALA-101',
                    },
                ],
            },
            modelUsed: 'gemini-2.5-flash-test',
        };
    }
    return {
        data: {
            transcript: '',
            intent: 'ADD_ITEMS',
            items: [],
        },
        modelUsed: 'gemini-2.5-flash-test',
    };
};

// ---------------------------------------------------------------------------
// 3. In-Memory Express Dispatcher
// ---------------------------------------------------------------------------

async function dispatchHttp(
    app: Express,
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body?: unknown
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string; json: any }> {
    return new Promise((resolve, reject) => {
        const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } }) as any;
        socket.remoteAddress = '127.0.0.1';
        socket.encrypted = false;

        const req = new http.IncomingMessage(socket);
        req.method = method;
        req.url = urlPath;
        const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
        req.headers = { host: 'localhost' };
        for (const [k, v] of Object.entries(headers)) {
            req.headers[k.toLowerCase()] = v;
        }
        if (payload && !req.headers['content-type']) {
            req.headers['content-type'] = 'application/json';
            req.headers['content-length'] = String(payload.length);
        }

        const res = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        (res as any).write = (chunk: any, enc?: any, cb?: any) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
            return origWrite(chunk, enc, cb);
        };
        (res as any).end = (chunk?: any, enc?: any, cb?: any) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: any = text;
            try {
                parsed = text ? JSON.parse(text) : {};
            } catch {
                // CSV o texto plano
            }
            const outHeaders: Record<string, string | string[] | undefined> = {};
            for (const [hk, hv] of Object.entries(res.getHeaders())) {
                outHeaders[hk.toLowerCase()] = hv as any;
            }
            const result = origEnd(chunk, enc, cb);
            resolve({ status: res.statusCode, headers: outHeaders, text, json: parsed });
            return result;
        };

        (app as any).handle(req as any, res as any, (err: any) => {
            if (err) reject(err);
        });
        process.nextTick(() => {
            if (payload) req.push(payload);
            req.push(null);
        });
    });
}

// ---------------------------------------------------------------------------
// 4. Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-e03-audit';
const SITE_ID = 'FAENA-NORTE';
const ADMIN_UID = 'uid-admin-e03';
const OPERATOR_UID = 'uid-op-e03';
const OTHER_UID = 'uid-other-e03';
const PHONE_OPERATOR = '+56900001101';
const PHONE_OTHER = '+56900001102';

async function seedBaseTenant() {
    dbCollections.clear();
    storageBlobs.clear();
    capturedAiCalls.length = 0;

    await mockDb.collection('accounts').doc(TENANT_ID).set({
        id: TENANT_ID,
        accountId: TENANT_ID,
        name: 'Faena Norte Audit E03',
        status: 'ACTIVE',
        ownerId: ADMIN_UID,
        contract: { status: 'ACTIVE', activeModules: { supply: true, opermaq: true, stockpile: true } },
    });
    await mockDb.collection('users').doc(ADMIN_UID).set({
        uid: ADMIN_UID,
        email: 'admin.e03@minreport.cl',
        role: 'OWNER',
        memberships: [{ accountId: TENANT_ID, role: 'OWNER', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('users').doc(OPERATOR_UID).set({
        uid: OPERATOR_UID,
        email: 'operador.e03@minreport.cl',
        role: 'OPERATOR',
        memberships: [{ accountId: TENANT_ID, role: 'OPERATOR', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('users').doc(OTHER_UID).set({
        uid: OTHER_UID,
        email: 'otro.e03@minreport.cl',
        role: 'OPERATOR',
        memberships: [{ accountId: TENANT_ID, role: 'OPERATOR', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('accounts').doc(TENANT_ID).collection('members').doc(ADMIN_UID).set({
        uid: ADMIN_UID,
        accountId: TENANT_ID,
        role: 'OWNER',
        status: 'ACTIVE',
        displayName: 'Director Operaciones E03',
        email: 'admin.e03@minreport.cl',
        supplyProfile: {
            role: 'OWNER_EXEC',
            assignedSiteIds: [SITE_ID],
            defaultCostCenter: 'CC-OPS-MINA',
        },
    });
    await mockDb.collection('accounts').doc(TENANT_ID).collection('members').doc(OTHER_UID).set({
        uid: OTHER_UID,
        accountId: TENANT_ID,
        role: 'OPERATOR',
        status: 'ACTIVE',
        displayName: 'Otro Operador',
        email: 'otro.e03@minreport.cl',
        phoneE164: PHONE_OTHER,
        whatsappOptInAt: '2026-06-01T10:00:00.000Z',
        supplyProfile: {
            role: 'CAMP_MANAGER',
            assignedSiteIds: [SITE_ID],
            defaultCostCenter: 'CC-CAMP-ALIMENTACION',
        },
    });

    await SupplyRepository.upsertSite(
        TENANT_ID,
        {
            siteId: SITE_ID,
            name: 'Campamento & Faena Norte',
            districtCode: 'ANTOFAGASTA-NORTE',
            shiftPattern: '7x7',
            currentHeadcount: 45,
            waterStorageCapacityL: 50_000,
            ds594DailyWaterTargetLPerPax: 120,
            leadTimeDays: 7,
            marketplaceOptIn: false,
            roleMismatchMode: 'FLAG_AND_ACCEPT',
            directPurchaseAlertThresholdClp: 500_000,
        },
        { actorUid: ADMIN_UID, actorEmail: 'admin.e03@minreport.cl' }
    );

    mockTokens.set('tok-admin', {
        uid: ADMIN_UID,
        email: 'admin.e03@minreport.cl',
        email_verified: true,
        activeAccountId: TENANT_ID,
        accountId: TENANT_ID,
        role: 'OWNER',
        tier: 'B2B',
    });
    mockTokens.set('tok-operator', {
        uid: OPERATOR_UID,
        email: 'operador.e03@minreport.cl',
        email_verified: true,
        activeAccountId: TENANT_ID,
        accountId: TENANT_ID,
        role: 'OPERATOR',
        tier: 'B2B',
    });
    mockTokens.set('tok-other', {
        uid: OTHER_UID,
        email: 'otro.e03@minreport.cl',
        email_verified: true,
        activeAccountId: TENANT_ID,
        accountId: TENANT_ID,
        role: 'OPERATOR',
        tier: 'B2B',
    });
}

// ---------------------------------------------------------------------------
// 5. Suite V3-E03
// ---------------------------------------------------------------------------

async function runTests() {
    await seedBaseTenant();

    const actorAdmin = { actorUid: ADMIN_UID, actorEmail: 'admin.e03@minreport.cl' };
    const createdProfile = await ProvisionalSupplyProfileAdapter.upsertProfileGrant(
        TENANT_ID,
        {
            displayName: 'Jefe Campamento Turno E03',
            phoneE164: PHONE_OPERATOR,
            linkedMemberUid: OPERATOR_UID,
            role: 'CAMP_MANAGER',
            allowedSiteIds: [SITE_ID],
            permanentChannels: ['CH_CAMP_FOOD', 'CH_CAMP_POTABLE_WATER'],
            maxAmountClp: 500_000,
            allowCapex: false,
            controlledLicense: null,
            confirmationKeyword: 'ACTUALIZAR',
        },
        actorAdmin
    );
    await ProvisionalSupplyProfileAdapter.confirmOrRevokeOptIn(
        TENANT_ID,
        createdProfile.profile.profileId,
        { action: 'CONFIRM', confirmationKeyword: 'ACTUALIZAR' },
        actorAdmin
    );

    // -----------------------------------------------------------------------
    // Test 1: Cambio de canal en vivo dentro de la misma conversación
    // -----------------------------------------------------------------------
    console.log('Test 1: Cambio de canal en vivo dentro de la misma conversación...');
    const t1Turn1 = await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t1-1',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now(),
            type: 'audio',
            mediaId: 'wa-media-audio-t1-1',
            mimeType: 'audio/ogg',
        },
        {
            flushImmediately: true,
            skipOutboundSend: true,
            nowIso: '2026-06-15T09:00:00.000Z',
            inlineMediaBuffer: Buffer.from('OggS\x00\x02test_field_voice_turn_1'),
            inlineMediaMimeType: 'audio/ogg',
        }
    );
    assert.equal(t1Turn1.handled, true);
    assert.equal(capturedAiCalls.length, 1);
    const call1 = capturedAiCalls[0];
    assert.equal(call1.dataClassification, 'TENANT_PRIVATE');
    assert.ok(call1.systemInstruction.includes('CH_CAMP_FOOD'));
    assert.ok(!call1.systemInstruction.includes('CH_OPS_PARTS_LUBES'));
    const fp1Match = call1.systemInstruction.match(/\[scope:([a-f0-9]{12})/);
    assert.ok(fp1Match, 'Debe incluir [scope:<12hex>] en systemInstruction');

    // En la primera llamada CH_OPS_PARTS_LUBES fue denegado educadamente porque solo tenía alimento/agua
    assert.equal(t1Turn1.deniedItems?.length, 1);
    assert.ok(
        t1Turn1.replyText?.includes('CH_OPS_PARTS_LUBES') ||
            t1Turn1.replyText?.toLowerCase().includes('no está habilitado') ||
            t1Turn1.replyText?.toLowerCase().includes('no habilitado')
    );

    // Admin habilita CH_OPS_PARTS_LUBES en vivo mientras la conversación sigue abierta
    await ProvisionalSupplyProfileAdapter.updateProfileChannels(
        TENANT_ID,
        createdProfile.profile.profileId,
        {
            permanentChannels: ['CH_CAMP_FOOD', 'CH_CAMP_POTABLE_WATER', 'CH_OPS_PARTS_LUBES'],
            confirmationKeyword: 'ACTUALIZAR',
        },
        actorAdmin
    );

    const t1Turn2 = await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t1-2',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now() + 1000,
            type: 'audio',
            mediaId: 'wa-media-audio-t1-2',
            mimeType: 'audio/ogg',
        },
        {
            flushImmediately: true,
            skipOutboundSend: true,
            nowIso: '2026-06-15T09:02:00.000Z',
            inlineMediaBuffer: Buffer.from('OggS\x00\x02test_field_voice_turn_2'),
            inlineMediaMimeType: 'audio/ogg',
        }
    );
    assert.equal(t1Turn2.handled, true);
    assert.equal(capturedAiCalls.length, 2);
    const call2 = capturedAiCalls[1];
    assert.equal(call2.dataClassification, 'TENANT_PRIVATE');
    assert.ok(call2.systemInstruction.includes('CH_OPS_PARTS_LUBES'));
    const fp2Match = call2.systemInstruction.match(/\[scope:([a-f0-9]{12})/);
    assert.ok(fp2Match);
    assert.notEqual(fp1Match![1], fp2Match![1], 'scopeFingerprint debe cambiar en vivo entre turnos');
    assert.equal(t1Turn2.fsmState, 'REVIEW_GATE', 'Ahora CH_OPS_PARTS_LUBES pasa sin reiniciar sesión');
    assert.equal(t1Turn2.deniedItems?.length || 0, 0);

    // Cancelamos el borrador de Test 1 para partir limpio en Test 2
    await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t1-cancel',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now() + 2000,
            type: 'text',
            textBody: 'cancelar',
        },
        { flushImmediately: true, skipOutboundSend: true, nowIso: '2026-06-15T09:03:00.000Z' }
    );

    // -----------------------------------------------------------------------
    // Test 2: Expiración temporal pre-`OK` en `commitCampRequisition`
    // -----------------------------------------------------------------------
    console.log('Test 2: Expiración temporal pre-OK en commitCampRequisition...');
    // Quitamos CH_OPS_PARTS_LUBES permanente y otorgamos permiso temporal [10:00Z, 12:00Z)
    await ProvisionalSupplyProfileAdapter.updateProfileChannels(
        TENANT_ID,
        createdProfile.profile.profileId,
        {
            permanentChannels: ['CH_CAMP_FOOD', 'CH_CAMP_POTABLE_WATER'],
            confirmationKeyword: 'ACTUALIZAR',
        },
        actorAdmin
    );
    await ProvisionalSupplyProfileAdapter.grantTemporaryChannel(
        TENANT_ID,
        createdProfile.profile.profileId,
        {
            channelId: 'CH_OPS_PARTS_LUBES',
            validFromIso: '2026-06-15T10:00:00.000Z',
            validUntilIso: '2026-06-15T12:00:00.000Z',
            reason: 'Turno mantención fin de semana',
            confirmationKeyword: 'ACTUALIZAR',
        },
        actorAdmin
    );

    // A las 11:00Z pide arroz + filtro de aceite (ambos en scope -> REVIEW_GATE)
    const t2Draft = await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t2-draft',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now() + 3000,
            type: 'audio',
            mediaId: 'wa-media-audio-t2-draft',
            mimeType: 'audio/ogg',
        },
        {
            flushImmediately: true,
            skipOutboundSend: true,
            nowIso: '2026-06-15T11:00:00.000Z',
            inlineMediaBuffer: Buffer.from('OggS\x00\x02PRE_OK_TEST2'),
            inlineMediaMimeType: 'audio/ogg',
        }
    );
    assert.equal(
        t2Draft.fsmState,
        'REVIEW_GATE',
        `Expected REVIEW_GATE, got ${t2Draft.fsmState} | replyText=${t2Draft.replyText} | denied=${JSON.stringify(t2Draft.deniedItems)}`
    );
    assert.equal(t2Draft.deniedItems?.length || 0, 0, `Unexpected deniedItems: ${JSON.stringify(t2Draft.deniedItems)}`);

    // A las 12:05Z (grant temporal expirado!) envía OK -> debe remover solo el filtro y pedir reconfirmación de arroz
    const t2LateOk = await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t2-ok-expired',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now() + 4000,
            type: 'text',
            textBody: 'OK',
        },
        { flushImmediately: true, skipOutboundSend: true, nowIso: '2026-06-15T12:05:00.000Z' }
    );
    assert.equal(t2LateOk.fsmState, 'REVIEW_GATE');
    assert.equal(t2LateOk.committedRequisition, undefined, 'No debe emitir requisición sin reconfirmar ítems restantes');
    assert.equal(t2LateOk.deniedItems?.length, 1);
    assert.ok(t2LateOk.replyText?.toLowerCase().includes('removidos') || t2LateOk.replyText?.includes('vigentes'));

    // Reconfirma los ítems vigentes -> ahora sí crea requisición solo con arroz
    const t2Reconfirm = await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t2-reconfirm',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now() + 5000,
            type: 'text',
            textBody: 'OK',
        },
        { flushImmediately: true, skipOutboundSend: true, nowIso: '2026-06-15T12:06:00.000Z' }
    );
    assert.equal(t2Reconfirm.fsmState, 'COMMITTED');
    assert.ok(t2Reconfirm.committedRequisition);
    assert.equal(t2Reconfirm.committedRequisition!.lines.length, 1);
    assert.equal(t2Reconfirm.committedRequisition!.lines[0].categoryCode, 'VIVERES_ALIMENTACION');

    // Verificar que `TEMPORARY_GRANT_EXPIRED_ATTEMPT` quedó registrado en `supply_policy_audit`
    const policyAuditsSnap = await mockDb.collection(SUPPLY_COLLECTIONS.POLICY_AUDIT).get();
    const policyAuditCodes = policyAuditsSnap.docs.map((d: any) => d.data().policyCode);
    assert.ok(
        policyAuditCodes.includes('TEMPORARY_GRANT_EXPIRED_ATTEMPT'),
        `Debe auditar TEMPORARY_GRANT_EXPIRED_ATTEMPT; hallados: ${policyAuditCodes.join(', ')}`
    );

    // -----------------------------------------------------------------------
    // Test 3: Solicitud mixta (`DS132` + `CHANNEL_SCOPE_DENIED` + válido) + Flow filtering
    // -----------------------------------------------------------------------
    console.log('Test 3: Rechazo cortés DS132 + CHANNEL_SCOPE_DENIED preservando ítems válidos...');
    const t3Mixed = await CampChannel.handleInboundMessage(
        {
            wamid: 'wamid-e03-t3-mixed',
            fromE164: PHONE_OPERATOR,
            timestampMs: Date.now() + 6000,
            type: 'text',
            textBody: '10 kg tallarines, 2 cajas de cerveza, 3 filtro aceite cat',
        },
        { flushImmediately: true, skipOutboundSend: true, nowIso: '2026-06-15T13:00:00.000Z' }
    );
    assert.equal(t3Mixed.fsmState, 'REVIEW_GATE', 'El ítem válido (tallarines) debe continuar hacia REVIEW_GATE');
    assert.equal(t3Mixed.deniedItems?.length, 2, 'Cerveza (DS132) + filtro expirado deben rechazarse sin botar tallarines');
    assert.ok(t3Mixed.replyText?.toLowerCase().includes('tallarines'));

    // Verificamos también filtrado en WhatsApp Flows INIT (solo canales vigentes en frequent_skus)
    const flowSecret = (await resolveFlowTokenSigningSecret()) || 'test_flow_hmac_secret_2026';
    const flowToken = createSignedFlowToken(
        {
            flowType: 'CAMP_ORDER',
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            memberUid: OPERATOR_UID,
            expiresAtMs: Date.now() + 600_000,
        },
        flowSecret
    );
    // Creamos un member mínimo en `accounts/.../members` para que `resolveVerifiedFlowMember` vincule al operador y filtre por `DynamicChannelScopeResolver`
    await mockDb.collection('accounts').doc(TENANT_ID).collection('members').doc(OPERATOR_UID).set({
        uid: OPERATOR_UID,
        accountId: TENANT_ID,
        role: 'OPERATOR',
        status: 'ACTIVE',
        displayName: 'Jefe Campamento Turno E03',
        email: 'operador.e03@minreport.cl',
        phoneE164: PHONE_OPERATOR,
        whatsappOptInAt: '2026-06-01T10:00:00.000Z',
        supplyProfile: {
            role: 'CAMP_MANAGER',
            assignedSiteIds: [SITE_ID],
            defaultCostCenter: 'CC-CAMP-ALIMENTACION',
        },
    });
    // Sembrar una requisición previa con un SKU de repuesto para probar filtrado en INIT
    await SupplyRepository.createRequisition(
        {
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            requesterUid: ADMIN_UID,
            requesterName: 'Director',
            requesterRole: 'OWNER_EXEC',
            demandOrigin: 'WA_OPS',
            demandNature: 'REACTIVE_FIELD',
            costCenter: 'CC-FLOTA-MANTENCION',
            atypicalFlags: [],
            lines: [
                {
                    lineId: 'seed-l1',
                    canonicalSkuId: 'SKU-FILTRO-HIDRAULICO',
                    itemName: 'Filtro hidráulico',
                    categoryCode: 'LUBRICANTES_FILTROS',
                    procurementBucket: 'REPUESTOS_LUBRICANTES',
                    unitSi: 'un',
                    rawRequestedText: '1 filtro hidraulico',
                    qtyRequested: 1,
                    qtyPurchased: 0,
                    qtyReceived: 0,
                    qtyPending: 1,
                    lineStatus: 'OPEN',
                    atypicalFlags: [],
                    fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                    urgency: 'STANDARD',
                },
            ],
        },
        actorAdmin
    );
    const flowInit = await SupplyFlowsHandler.handle(
        {
            version: '3.0',
            action: 'INIT',
            flow_token: flowToken,
            data: {},
        },
        { tokenSecret: flowSecret }
    );
    assert.equal(flowInit.screen, 'CAMP_REORDER_SELECT');
    const freqIds = ((flowInit.data?.frequent_skus as Array<Record<string, any>>) || []).map(
        (s) => s.canonicalSkuId
    );
    assert.ok(!freqIds.includes('SKU-FILTRO-HIDRAULICO'), 'Flow INIT no debe ofrecer SKU-FILTRO-HIDRAULICO cuando CH_OPS_PARTS_LUBES está expirado');
    assert.ok(freqIds.includes('SKU-SUP-ARROZ'), 'Flow INIT sí debe ofrecer SKU-SUP-ARROZ (CH_CAMP_FOOD vigente)');

    // -----------------------------------------------------------------------
    // Test 4: Cero `phoneE164` en sesión WhatsApp + Integridad cadena SHA-256
    // -----------------------------------------------------------------------
    console.log('Test 4: Cero phoneE164 en sesiones WhatsApp + cadena SHA-256 íntegra...');
    const sessionsSnap = await mockDb.collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).get();
    assert.ok(sessionsSnap.docs.length >= 1);
    for (const sDoc of sessionsSnap.docs) {
        const sData = sDoc.data();
        assert.equal('phoneE164' in sData, false, 'PROHIBIDO guardar phoneE164 en texto plano en supply_whatsapp_sessions');
        assert.ok(typeof sData.phoneMasked === 'string' && sData.phoneMasked.includes('****'));
        assert.ok(typeof sData.phoneHashSha256 === 'string' && sData.phoneHashSha256.length === 64);
    }

    const threadIdOp = buildConversationThreadId(
        TENANT_ID,
        createdProfile.profile.profileId
    );
    const opTurns = await ConversationAuditService.listTurns(TENANT_ID, threadIdOp, 100);
    assert.ok(opTurns.length >= 4, `Debe haber turnos auditados; encontrados: ${opTurns.length}`);
    assert.equal(opTurns[0].seq, 1);
    assert.equal(opTurns[0].prevHash, GENESIS_CONVERSATION_HASH);
    const chainOk = ConversationAuditService.verifyTurnChain(opTurns);
    assert.equal(chainOk.valid, true, `Cadena SHA-256 debe ser válida: ${chainOk.reason || ''}`);

    // Simular manipulación (tampering) en memoria y validar detección
    const tamperedTurns = opTurns.map((t, idx) =>
        idx === 1 ? { ...t, contentScrubbed: 'MENSAJE_ADULTERADO_SIN_FIRMA' } : t
    );
    const chainBroken = ConversationAuditService.verifyTurnChain(tamperedTurns);
    assert.equal(chainBroken.valid, false);
    assert.equal(chainBroken.brokenAtSeq, 2);

    // -----------------------------------------------------------------------
    // Test 5: Retención 24M vs 6Y + ARCO-P `LEGAL_HOLD_PSEUDONYMIZED`
    // -----------------------------------------------------------------------
    console.log('Test 5: Retención diferenciada 24M vs 6Y + ARCO-P...');
    const opThread = await ConversationAuditService.getThread(TENANT_ID, threadIdOp);
    assert.ok(opThread);
    assert.equal(opThread!.retentionPolicy, 'TAX_HOLD_6Y', 'Hilo con requisición confirmada debe quedar bajo TAX_HOLD_6Y');
    assert.equal(opThread!.legalHoldTaxYears, 6);

    // Hilo puramente operativo sin requisición ni compra/DTE -> OPERATIONAL_24M
    const scopeOther = await DynamicChannelScopeResolver.resolveScope({
        tenantId: TENANT_ID,
        siteId: SITE_ID,
        uid: OTHER_UID,
        displayName: 'Otro Operador',
        role: 'CAMP_MANAGER',
        phoneE164: PHONE_OTHER,
    });
    const otherTurnResult = await ConversationAuditService.appendTurn({
        tenantId: TENANT_ID,
        profileId: scopeOther.profileId,
        displayName: 'Otro Operador',
        role: 'CAMP_MANAGER',
        phoneE164: PHONE_OTHER,
        siteId: SITE_ID,
        direction: 'INBOUND',
        channelSource: 'WHATSAPP_CLOUD',
        rawContent: 'consulta estado campamento rut 12.345.678-9',
        scopeSnapshot: scopeOther.scopeSnapshot,
    });
    assert.equal(otherTurnResult.thread.retentionPolicy, 'OPERATIONAL_24M');
    assert.equal(otherTurnResult.thread.legalHoldTaxYears, 0);
    assert.ok(!otherTurnResult.turn.contentScrubbed.includes('12.345.678-9'), 'Debe sanitizar RUT antes de guardar turno');

    // ARCO-P sobre hilo operativo (24M) -> DELETED
    const arco24m = await ConversationAuditService.applyArcoPSuppressOrPseudonymize(
        TENANT_ID,
        scopeOther.profileId,
        actorAdmin
    );
    assert.equal(arco24m.mode, 'DELETED');
    const deletedThread = await ConversationAuditService.getThread(TENANT_ID, arco24m.threadId);
    assert.equal(deletedThread, null);

    // ARCO-P sobre hilo tributario (6Y) -> LEGAL_HOLD_PSEUDONYMIZED preservado 6 años
    const arco6y = await ConversationAuditService.applyArcoPSuppressOrPseudonymize(
        TENANT_ID,
        createdProfile.profile.profileId,
        actorAdmin
    );
    assert.equal(arco6y.mode, 'LEGAL_HOLD_PSEUDONYMIZED');
    const pseudoThread = await ConversationAuditService.getThread(TENANT_ID, threadIdOp);
    assert.ok(pseudoThread);
    assert.equal(pseudoThread!.retentionPolicy, 'LEGAL_HOLD_PSEUDONYMIZED');
    assert.equal(pseudoThread!.displayName, 'TITULAR PSEUDONIMIZADO (LEY 21.719)');
    assert.equal(pseudoThread!.legalHoldTaxYears, 6);

    // -----------------------------------------------------------------------
    // Test 6: Endpoints HTTP `/api/supply/conversations*` + RBAC + JSON/CSV Export SHA-256
    // -----------------------------------------------------------------------
    console.log('Test 6: Endpoints HTTP /api/supply/conversations* + Export JSON/CSV + RBAC...');
    process.env.MINREPORT_RELEASE_STAGE = 'FULL';
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    registerSupplyModuleRoutes(app);

    const listRes = await dispatchHttp(app, 'GET', '/api/supply/conversations', {
        authorization: 'Bearer tok-admin',
    });
    assert.equal(listRes.status, 200, `Unexpected status ${listRes.status}: ${JSON.stringify(listRes.json)}`);
    assert.ok(listRes.json.count >= 1);

    const turnsRes = await dispatchHttp(
        app,
        'GET',
        `/api/supply/conversations/${encodeURIComponent(threadIdOp)}/turns`,
        { authorization: 'Bearer tok-admin' }
    );
    assert.equal(turnsRes.status, 200);
    assert.equal(turnsRes.json.chainVerification.valid, true);
    assert.ok(turnsRes.json.turns.length >= 4);

    // Operador no titular (`OTHER_UID`) no puede leer turnos ni exportar hilo ajeno (403)
    const forbiddenTurns = await dispatchHttp(
        app,
        'GET',
        `/api/supply/conversations/${encodeURIComponent(threadIdOp)}/turns`,
        { authorization: 'Bearer tok-other' }
    );
    assert.equal(forbiddenTurns.status, 403);

    const forbiddenExport = await dispatchHttp(
        app,
        'POST',
        `/api/supply/conversations/${encodeURIComponent(threadIdOp)}/export`,
        { authorization: 'Bearer tok-other' },
        { format: 'JSON' }
    );
    assert.equal(forbiddenExport.status, 403);

    // El titular (`OPERATOR_UID`, vinculado al `profileId`) sí puede exportar JSON con SHA-256
    const exportJsonRes = await dispatchHttp(
        app,
        'POST',
        `/api/supply/conversations/${encodeURIComponent(threadIdOp)}/export`,
        { authorization: 'Bearer tok-operator' },
        { format: 'JSON' }
    );
    assert.equal(exportJsonRes.status, 200);
    const jsonHeaderSha = String(exportJsonRes.headers['x-content-sha256'] || '');
    assert.equal(jsonHeaderSha.length, 64);
    assert.equal(exportJsonRes.json.sha256, jsonHeaderSha);
    assert.equal(exportJsonRes.json.chainVerification.valid, true);

    // Admin exporta en CSV y validamos que X-Content-SHA256 coincide exactamente con el SHA-256 del cuerpo CSV
    const exportCsvRes = await dispatchHttp(
        app,
        'POST',
        `/api/supply/conversations/${encodeURIComponent(threadIdOp)}/export`,
        { authorization: 'Bearer tok-admin' },
        { format: 'CSV' }
    );
    assert.equal(exportCsvRes.status, 200);
    const csvHeaderSha = String(exportCsvRes.headers['x-content-sha256'] || '');
    const computedCsvSha = crypto.createHash('sha256').update(exportCsvRes.text, 'utf8').digest('hex');
    assert.equal(csvHeaderSha, computedCsvSha, 'X-Content-SHA256 debe coincidir exactamente con el CSV exportado');
    assert.ok(exportCsvRes.text.includes('SEQ;CREATED_AT_ISO;DIRECTION;SOURCE;EFFECTIVE_CHANNELS'));

    // Verificación auxiliar de helpers del resolver
    const fpVerify = computeChannelScopeFingerprint({
        effectiveChannels: ['CH_CAMP_FOOD', 'CH_CAMP_POTABLE_WATER'],
        role: 'CAMP_MANAGER',
        siteId: SITE_ID,
    });
    const instrVerify = buildDynamicChannelSystemInstruction({
        effectiveChannels: ['CH_CAMP_FOOD', 'CH_CAMP_POTABLE_WATER'],
        role: 'CAMP_MANAGER',
        siteId: SITE_ID,
        scopeFingerprint: fpVerify,
    });
    assert.ok(instrVerify.includes(fpVerify.slice(0, 12)));

    // Verificación que buildProfileGrantDocId es consistente
    assert.ok(buildProfileGrantDocId(TENANT_ID, createdProfile.profile.profileId).includes(createdProfile.profile.profileId));

    console.log('ALL V3-E03 CONVERSATION AUDIT & DYNAMIC GUARDRAIL TESTS PASSED');
}

runTests().catch((err) => {
    console.error('V3-E03 TEST FAILED:', err);
    process.exit(1);
});
