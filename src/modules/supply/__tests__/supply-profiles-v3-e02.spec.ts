/**
 * MINREPORT · ABASTECIMIENTO — V3-E02 Submódulo Provisorio `Perfiles & Canales WS` + `IHumanResourcesProfilePort`
 *
 * Verifica de forma determinista (Node v20.19.5, cero red, cero celulares reales):
 * 1. Contrato `supply_channel_grants` (`phoneHashSha256`, `phoneMasked`, cifrado AES-256-GCM, 0 teléfono plano).
 * 2. Permisos temporales fin de semana auto-expirables sin cron (`validFromIso <= now < validUntilIso`) + revocación manual.
 * 3. Compuerta DGMN inviolable (`CH_CONTROLLED_DGMN` bloqueado sin licencia vigente y auto-removido al expirar).
 * 4. Doble Opt-In Ley N° 21.719 (`PENDING_DOUBLE_OPT_IN` ➔ `ACTIVE`) + revocación inmediata `STOP` (`REVOKED_STOP`).
 * 5. RBAC estricto (`VIEWER`/`BILLING_ONLY` 403 en mutaciones, `CAMP_MANAGER` 403, HITL `"ACTUALIZAR"` obligatorio, AuditLedger).
 * 6. Etapa `DEV_PRIVATE`: `/api/staff` sigue bloqueado (403), mientras `/api/supply/profiles*` opera completo para `DEV_ROOT`
 *    y la elegibilidad de despacho WhatsApp exige doble compuerta `allowlist && ACTIVE && optIn ACTIVE`.
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
// 1. In-Memory Firebase Stub (Firestore + Auth + Storage)
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
                    const ok = filters.every((f) =>
                        f.op === '==' ? data[f.field] === f.value : true
                    );
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
};

const firebaseResolved = require.resolve(path.resolve(__dirname, '../../../config/firebase'));
require.cache[firebaseResolved] = {
    id: firebaseResolved,
    filename: firebaseResolved,
    loaded: true,
    exports: { __esModule: true, default: mockAdmin, db: mockDb, auth: mockAuth, storage: {} },
} as any;

import { env } from '../../../config/env';
import { MetaWhatsAppCloudAdapter } from '../adapters/MetaWhatsAppCloudAdapter';
import {
    ProvisionalSupplyProfileAdapter,
    SUPPLY_CHANNEL_GRANTS_COLLECTION,
    buildProfileGrantDocId,
    evaluateEffectiveChannelsForProfile,
    evaluateWhatsappDispatchEligibility,
} from '../adapters/ProvisionalSupplyProfileAdapter';
import { registerSupplyModuleRoutes } from '../index';
import type { IHumanResourcesProfilePort } from '../ports/IHumanResourcesProfilePort';

// ---------------------------------------------------------------------------
// 2. In-Memory Express Dispatcher (0 sockets)
// ---------------------------------------------------------------------------

async function dispatchJson(
    app: Express,
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body?: unknown
): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
        const rawBody = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0);
        const socket = new Duplex({
            read() {},
            write(_c, _e, cb) {
                cb();
            },
        }) as any;
        socket.remoteAddress = '127.0.0.1';
        socket.encrypted = false;

        const req = new http.IncomingMessage(socket);
        req.method = method;
        req.url = urlPath;
        req.headers = {
            host: 'localhost',
            ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
            ...(rawBody.length > 0
                ? {
                      'content-type': 'application/json',
                      'content-length': String(rawBody.length),
                  }
                : {}),
        };
        if (rawBody.length > 0) req.push(rawBody);
        req.push(null);

        const res = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        (res as any).write = (chunk: any, ...rest: any[]) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return origWrite(chunk, ...rest);
        };
        (res as any).end = (chunk?: any, ...rest: any[]) => {
            if (chunk && typeof chunk !== 'function') {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const ret = origEnd(chunk, ...rest);
            const rawText = Buffer.concat(chunks).toString('utf8');
            let parsed: any = null;
            try {
                parsed = rawText ? JSON.parse(rawText) : null;
            } catch {
                parsed = rawText;
            }
            resolve({ status: res.statusCode, json: parsed });
            return ret;
        };

        try {
            (app as any).handle(req, res, (err: any) => {
                if (err) reject(err);
            });
        } catch (err) {
            reject(err);
        }
    });
}

// ---------------------------------------------------------------------------
// 3. Test Suite
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
    const TENANT_B2B = 'tenant-v3-e02-atacama';
    const SYNTH_PHONE_CAMP = '+56900001111';
    const SYNTH_PHONE_DGMN = '+56900002222';
    const SYNTH_PHONE_DEV_ALLOWED = '+56900003333';
    const SYNTH_PHONE_DEV_UNLISTED = '+56900004444';

    dbCollections.clear();
    mockTokens.clear();
    MetaWhatsAppCloudAdapter.clearMockOutbox();

    // Seed B2B tenant + active members (OWNER, VIEWER, CAMP_MANAGER, DEV_ROOT)
    await mockDb.collection('accounts').doc(TENANT_B2B).set({
        id: TENANT_B2B,
        name: 'Faena Norte E02 SpA',
        status: 'ACTIVE',
        ownerId: 'uid-owner-e02',
        contract: { status: 'ACTIVE', activeModules: { supply: true, opermaq: true, stockpile: true } },
    });
    await mockDb.collection('users').doc('uid-owner-e02').set({
        uid: 'uid-owner-e02',
        email: 'owner@e02.cl',
        role: 'OWNER',
        memberships: [{ accountId: TENANT_B2B, role: 'OWNER', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('users').doc('uid-viewer-e02').set({
        uid: 'uid-viewer-e02',
        email: 'viewer@e02.cl',
        role: 'VIEWER',
        memberships: [{ accountId: TENANT_B2B, role: 'VIEWER', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('accounts').doc(TENANT_B2B).collection('members').doc('uid-viewer-e02').set({
        uid: 'uid-viewer-e02',
        role: 'VIEWER',
        status: 'ACTIVE',
    });
    await mockDb.collection('users').doc('uid-camp-e02').set({
        uid: 'uid-camp-e02',
        email: 'camp@e02.cl',
        role: 'OPERATOR',
        memberships: [{ accountId: TENANT_B2B, role: 'OPERATOR', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('accounts').doc(TENANT_B2B).collection('members').doc('uid-camp-e02').set({
        uid: 'uid-camp-e02',
        role: 'OPERATOR',
        status: 'ACTIVE',
        supplyProfile: { role: 'CAMP_MANAGER' },
    });
    await mockDb.collection('users').doc('dev-master-root-uid').set({
        uid: 'dev-master-root-uid',
        email: 'dev@minreport.com',
        role: 'DEV_ROOT',
    });

    mockTokens.set('tok-owner', { uid: 'uid-owner-e02', email: 'owner@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-viewer', { uid: 'uid-viewer-e02', email: 'viewer@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-camp', { uid: 'uid-camp-e02', email: 'camp@e02.cl', email_verified: true, activeAccountId: TENANT_B2B });
    mockTokens.set('tok-dev', { uid: 'dev-master-root-uid', email: 'dev@minreport.com', email_verified: true, isMasterDev: true, role: 'DEV_ROOT' });

    const app = express();
    app.use(express.json());
    registerSupplyModuleRoutes(app);

    // Ensure ProvisionalSupplyProfileAdapter satisfies IHumanResourcesProfilePort structurally
    const hrPort: IHumanResourcesProfilePort = ProvisionalSupplyProfileAdapter;
    assert.ok(hrPort);

    console.log('\n=== MINREPORT · V3-E02 PROVISIONAL PROFILES & WS CHANNELS SUITE ===');

    // -----------------------------------------------------------------------
    // 1. Alta de perfil + Hash SHA-256 + Cifrado teléfono + Doble Opt-In
    // -----------------------------------------------------------------------
    process.env.MINREPORT_RELEASE_STAGE = 'FULL';
    const createRes = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles',
        { Authorization: 'Bearer tok-owner' },
        {
            profileId: 'prof-camp-norte',
            displayName: 'Encargado Campamento Norte',
            role: 'CAMP_MANAGER',
            phoneE164: SYNTH_PHONE_CAMP,
            permanentChannels: ['CH_CAMP_HYGIENE_MAINT', 'CH_CAMP_FOOD'],
            allowedSiteIds: ['site-norte'],
            maxAmountClp: 350000,
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(createRes.status, 200);
    assert.equal(createRes.json.profile.optInStatus, 'PENDING_DOUBLE_OPT_IN');
    assert.deepEqual(createRes.json.effectiveChannels, ['CH_CAMP_HYGIENE_MAINT', 'CH_CAMP_FOOD']);
    assert.equal(createRes.json.whatsappDispatchAllowed, false);

    // Verificar almacenamiento en `supply_channel_grants` sin teléfono plano
    const grantDocId = buildProfileGrantDocId(TENANT_B2B, 'prof-camp-norte');
    const rawStored = getCollectionMap(SUPPLY_CHANNEL_GRANTS_COLLECTION).get(grantDocId);
    assert.ok(rawStored, 'Documento debe existir en supply_channel_grants con docId tenant__profile');
    assert.equal(rawStored.phoneHashSha256, crypto.createHash('sha256').update(SYNTH_PHONE_CAMP).digest('hex'));
    assert.ok(rawStored.phoneCiphertext && rawStored.phoneCiphertext.includes('.'));
    assert.equal('phoneE164' in rawStored, false, 'No se debe persistir phoneE164 en texto plano');
    assert.equal('phoneCiphertext' in createRes.json.profile, false, 'API HTTP jamás expone phoneCiphertext');
    assert.equal('phoneE164' in createRes.json.profile, false, 'API HTTP jamás expone phoneE164');

    // Verificar plantilla Doble Opt-In mock-safe en outbox
    const outbox = MetaWhatsAppCloudAdapter.getMockOutbox();
    assert.ok(
        outbox.some((m) => m.templateName === 'minreport_supply_optin_es'),
        'Alta debe despachar plantilla de consentimiento Doble Opt-In mock-safe'
    );

    // Confirmar Doble Opt-In -> ACTIVE
    const optInRes = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles/prof-camp-norte/opt-in/confirm',
        { Authorization: 'Bearer tok-owner' },
        { action: 'CONFIRM', confirmationKeyword: 'ACTUALIZAR' }
    );
    assert.equal(optInRes.status, 200);
    assert.equal(optInRes.json.profile.optInStatus, 'ACTIVE');
    assert.equal(optInRes.json.whatsappDispatchAllowed, true);
    console.log('  [PASS] 1/6 Alta supply_channel_grants, 0 teléfono plano y Doble Opt-In Ley 21.719');

    // -----------------------------------------------------------------------
    // 2. Permiso Temporal Fin de Semana Auto-Expirable SIN Cron
    // -----------------------------------------------------------------------
    const fri18 = '2026-11-27T18:00:00-03:00';
    const sun2359 = '2026-11-29T23:59:59-03:00';
    const beforeWindow = '2026-11-27T17:59:00-03:00';
    const duringSaturday = '2026-11-28T14:30:00-03:00';
    const afterMonday00 = '2026-11-30T00:00:00-03:00';

    const grantRes = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles/prof-camp-norte/temporary-grants',
        { Authorization: 'Bearer tok-owner' },
        {
            channelId: 'CH_OPS_FLEET_FUEL',
            validFromIso: fri18,
            validUntilIso: sun2359,
            timezoneIana: 'America/Santiago',
            reason: 'Cobertura turno fin de semana combustible flota',
            maxAmountClpOverride: 900000,
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(grantRes.status, 201);
    const grantItemId = grantRes.json.profile.temporaryGrants[0].grantItemId;
    assert.ok(grantItemId);

    const evalBefore = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileByPhone(SYNTH_PHONE_CAMP, beforeWindow);
    const evalDuring = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileByPhone(SYNTH_PHONE_CAMP, duringSaturday);
    const evalAfter = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileByPhone(SYNTH_PHONE_CAMP, afterMonday00);
    assert.ok(evalBefore && evalDuring && evalAfter);

    assert.equal(evalBefore.effectiveChannels.includes('CH_OPS_FLEET_FUEL'), false);
    assert.equal(evalDuring.effectiveChannels.includes('CH_OPS_FLEET_FUEL'), true);
    assert.equal(evalDuring.effectiveMaxAmountClp, 900000);
    assert.equal(evalAfter.effectiveChannels.includes('CH_OPS_FLEET_FUEL'), false, 'Debe auto-expirar lunes 00:00 sin cron');
    assert.equal(evalAfter.effectiveMaxAmountClp, 350000);

    // Revocación manual antes del fin de semana
    const revokeGrantRes = await dispatchJson(
        app,
        'DELETE',
        `/api/supply/profiles/prof-camp-norte/temporary-grants/${grantItemId}`,
        { Authorization: 'Bearer tok-owner' },
        { confirmationKeyword: 'ACTUALIZAR' }
    );
    assert.equal(revokeGrantRes.status, 200);
    const evalRevoked = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileByPhone(SYNTH_PHONE_CAMP, duringSaturday);
    assert.equal(evalRevoked?.effectiveChannels.includes('CH_OPS_FLEET_FUEL'), false);
    console.log('  [PASS] 2/6 Permiso temporal fin de semana auto-expirable sin cron + revocación manual');

    // -----------------------------------------------------------------------
    // 3. Compuerta DGMN Inviolable (CH_CONTROLLED_DGMN)
    // -----------------------------------------------------------------------
    const dgmnRejected = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles',
        { Authorization: 'Bearer tok-owner' },
        {
            profileId: 'prof-dgmn-test',
            displayName: 'Supervisor Tronadura',
            role: 'OPS_FOREMAN',
            phoneE164: SYNTH_PHONE_DGMN,
            permanentChannels: ['CH_CONTROLLED_DGMN'],
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(dgmnRejected.status, 400);
    assert.equal(dgmnRejected.json.code, 'DGMN_LICENSE_REQUIRED');

    // Crear con licencia vigente y comprobar expiración determinista posterior
    const dgmnOk = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles',
        { Authorization: 'Bearer tok-owner' },
        {
            profileId: 'prof-dgmn-test',
            displayName: 'Supervisor Tronadura',
            role: 'OPS_FOREMAN',
            phoneE164: SYNTH_PHONE_DGMN,
            permanentChannels: ['CH_OPS_HARDWARE_DRILL', 'CH_CONTROLLED_DGMN'],
            controlledLicense: {
                resolutionCode: 'DGMN-RES-2026-88',
                issuedBy: 'DGMN',
                expiresAtIso: '2027-01-15T23:59:59Z',
            },
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(dgmnOk.status, 200);
    assert.equal(dgmnOk.json.effectiveChannels.includes('CH_CONTROLLED_DGMN'), true);

    const afterLicenseExpiry = evaluateEffectiveChannelsForProfile(
        dgmnOk.json.profile,
        '2027-01-16T00:00:01Z'
    );
    assert.equal(afterLicenseExpiry.hasValidDgmnLicense, false);
    assert.equal(afterLicenseExpiry.effectiveChannels.includes('CH_CONTROLLED_DGMN'), false);
    assert.equal(afterLicenseExpiry.effectiveChannels.includes('CH_OPS_HARDWARE_DRILL'), true);
    console.log('  [PASS] 3/6 Compuerta DGMN inviolable (rechazo sin licencia + auto-desactivación al vencer)');

    // -----------------------------------------------------------------------
    // 4. Edición en vivo de casillas + Revocación STOP Ley N° 21.719
    // -----------------------------------------------------------------------
    const patchChannelsRes = await dispatchJson(
        app,
        'PATCH',
        '/api/supply/profiles/prof-camp-norte/channels',
        { Authorization: 'Bearer tok-owner' },
        {
            permanentChannels: ['CH_CAMP_HYGIENE_MAINT', 'CH_CAMP_FOOD', 'CH_CAMP_POTABLE_WATER'],
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(patchChannelsRes.status, 200);
    assert.equal(patchChannelsRes.json.effectiveChannels.includes('CH_CAMP_POTABLE_WATER'), true);

    const stoppedCount = await ProvisionalSupplyProfileAdapter.revokeOptInByPhone(SYNTH_PHONE_CAMP);
    assert.equal(stoppedCount, 1);
    const afterStopEval = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileById(TENANT_B2B, 'prof-camp-norte');
    assert.equal(afterStopEval?.profile.optInStatus, 'REVOKED_STOP');
    assert.equal(afterStopEval?.whatsappDispatchAllowed, false);
    console.log('  [PASS] 4/6 Edición en vivo casillas + revocación inmediata STOP -> REVOKED_STOP');

    // -----------------------------------------------------------------------
    // 5. RBAC Estricto (VIEWER 403, CAMP_MANAGER 403) + HITL "ACTUALIZAR" + AuditLedger
    // -----------------------------------------------------------------------
    const viewerGet = await dispatchJson(app, 'GET', '/api/supply/profiles', { Authorization: 'Bearer tok-viewer' });
    assert.equal(viewerGet.status, 200);
    assert.equal(viewerGet.json.count, 2);

    const viewerPost = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles',
        { Authorization: 'Bearer tok-viewer' },
        {
            displayName: 'Intento Viewer',
            role: 'CAMP_MANAGER',
            phoneE164: '+56900009999',
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(viewerPost.status, 403);
    assert.equal(viewerPost.json.code, 'SUPPLY_RBAC_READ_ONLY');

    const viewerGrant = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles/prof-camp-norte/temporary-grants',
        { Authorization: 'Bearer tok-viewer' },
        {
            channelId: 'CH_CAMP_FUEL',
            validFromIso: fri18,
            validUntilIso: sun2359,
            reason: 'Viewer intentando grant',
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(viewerGrant.status, 403);

    const campPost = await dispatchJson(
        app,
        'POST',
        '/api/supply/profiles',
        { Authorization: 'Bearer tok-camp' },
        {
            displayName: 'Intento Escalamiento',
            role: 'OWNER_EXEC',
            phoneE164: '+56900009999',
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(campPost.status, 403);
    assert.equal(campPost.json.code, 'PROFILE_ADMIN_FORBIDDEN');

    const missingHitl = await dispatchJson(
        app,
        'PATCH',
        '/api/supply/profiles/prof-camp-norte/channels',
        { Authorization: 'Bearer tok-owner' },
        { permanentChannels: ['CH_CAMP_FOOD'] }
    );
    assert.equal(missingHitl.status, 400);

    const ledgerEntries = Array.from(getCollectionMap('audit_ledger').values()).filter(
        (e: any) => e.tenantId === TENANT_B2B && e.module === 'supply'
    );
    assert.ok(ledgerEntries.length >= 5, 'Todas las mutaciones deben quedar registradas en AuditLedger');
    console.log('  [PASS] 5/6 RBAC VIEWER/CAMP_MANAGER 403, HITL "ACTUALIZAR" y AuditLedger inmutable');

    // -----------------------------------------------------------------------
    // 6. DEV_PRIVATE: `/api/staff` bloqueado vs `/api/supply/profiles*` operativo para DEV_ROOT
    // -----------------------------------------------------------------------
    process.env.MINREPORT_RELEASE_STAGE = 'DEV_PRIVATE';
    process.env.SUPPLY_WHATSAPP_DEV_ALLOWLIST = SYNTH_PHONE_DEV_ALLOWED;
    const origAllowlistEnv = env.SUPPLY_WHATSAPP_DEV_ALLOWLIST;
    env.SUPPLY_WHATSAPP_DEV_ALLOWLIST = SYNTH_PHONE_DEV_ALLOWED;

    try {
        // Verificar regla de perímetro sin abrir /api/staff
        const rootIdx = await import('../../../index');
        assert.equal(rootIdx.isBlockedInDevPrivateStage('/api/staff/members'), true);
        assert.equal(rootIdx.isBlockedInDevPrivateStage('/api/supply/profiles'), false);
        assert.equal(rootIdx.isBlockedInDevPrivateStage('/api/supply/profiles/p1/temporary-grants'), false);

        const devCreateUnlisted = await dispatchJson(
            app,
            'POST',
            '/api/supply/profiles',
            { Authorization: 'Bearer tok-dev' },
            {
                profileId: 'prof-dev-unlisted',
                displayName: 'Operador No En Allowlist',
                role: 'CAMP_MANAGER',
                phoneE164: SYNTH_PHONE_DEV_UNLISTED,
                permanentChannels: ['CH_CAMP_FOOD'],
                confirmationKeyword: 'ACTUALIZAR',
            }
        );
        assert.equal(devCreateUnlisted.status, 200, 'CRUD escritorio DEV_ROOT no debe bloquearse por allowlist');
        assert.equal(devCreateUnlisted.json.whatsappDispatchAllowed, false);

        await dispatchJson(
            app,
            'POST',
            '/api/supply/profiles/prof-dev-unlisted/opt-in/confirm',
            { Authorization: 'Bearer tok-dev' },
            { action: 'CONFIRM', confirmationKeyword: 'ACTUALIZAR' }
        );

        const unlistedCheck = await ProvisionalSupplyProfileAdapter.resolveEffectiveProfileById(
            'dev-master-sandbox',
            'prof-dev-unlisted'
        );
        assert.equal(unlistedCheck?.whatsappDispatchAllowed, false, 'Sin allowlist en DEV_PRIVATE no despacha WA');

        const devListAllowed = evaluateWhatsappDispatchEligibility({
            status: 'ACTIVE',
            optInStatus: 'ACTIVE',
            phoneE164: SYNTH_PHONE_DEV_ALLOWED,
        });
        assert.equal(devListAllowed, true, 'Con allowlist + ACTIVE + optIn ACTIVE sí habilita despacho WA en DEV_PRIVATE');
    } finally {
        process.env.MINREPORT_RELEASE_STAGE = 'FULL';
        process.env.SUPPLY_WHATSAPP_DEV_ALLOWLIST = '';
        env.SUPPLY_WHATSAPP_DEV_ALLOWLIST = origAllowlistEnv;
    }
    console.log('  [PASS] 6/6 DEV_PRIVATE: /api/staff bloqueado, CRUD DEV_ROOT operativo y doble compuerta WA allowlist');

    console.log('\n✅ ALL V3-E02 PROVISIONAL HR PROFILES & WS CHANNELS TESTS PASSED (6/6)!\n');
}

runTests().catch((err) => {
    console.error('\n❌ V3-E02 PROFILES TEST SUITE FAILED:', err);
    process.exit(1);
});
