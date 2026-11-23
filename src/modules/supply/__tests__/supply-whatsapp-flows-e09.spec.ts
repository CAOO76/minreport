/**
 * Suite E09 — WhatsApp Flows v3.0 Cifrados (`RSA-2048 OAEP-SHA256 + AES-128/256-GCM`) & 1-Tap Re-Order
 *
 * Verifica determinísticamente (sin red externa, par RSA-2048 efímero en memoria, Node v20.19.5):
 * 1. Vector criptográfico oficial Meta Flows v3.0 (`RSA-OAEP-SHA256` + `AES-128-GCM` / `AES-256-GCM`
 *    + llave privada con passphrase + respuesta cifrada con IV invertido `iv ^ 0xff`).
 * 2. Compuertas HTTP `POST /api/supply/whatsapp/flow-exchange`:
 *    - Firma `X-Hub-Signature-256` ausente/inválida -> HTTP `401`.
 *    - Llave RSA incorrecta o ciphertext manipulado -> HTTP `421`.
 * 3. Health check oficial `action: 'ping'` -> HTTP `200`, `Content-Type: text/plain`, cuerpo cifrado
 *    descifrado exactamente a `{ version: '3.0', data: { status: 'active' } }`.
 * 4. Token `flow_token` firmado HMAC-SHA256: rechazo de manipulación cross-tenant, expiración y miembro inactivo.
 * 5. Flow 1 `OPT_IN` (`MINREPORT_OPTIN_LEY21719`): actualiza `whatsappOptInAt` + `whatsappOptInStatus: 'ACTIVE'`
 *    y registra `SUPPLY_WHATSAPP_DOUBLE_OPT_IN_CONFIRMED` en `AuditLedger`.
 * 6. Flow 2 `CAMP_ORDER` (`MINREPORT_CAMP_REORDER`): `INIT` carga 1-Tap Re-Order + SKUs frecuentes,
 *    `data_exchange` 1-Tap crea requisición real vía `SupplyRepository`, y bloquea ítems DS 132 (alcohol)
 *    y DGMN (explosivos) registrando `supply_policy_audit`.
 * 7. Flow 3 `RECEPTION_4WAY` (`MINREPORT_WAREHOUSE_4WAY`): `INIT` lista compras en tránsito,
 *    `data_exchange` invoca `confirmPurchaseReception` transaccional, acumula `qtyReceivedSoFar` y bloquea
 *    sobre-recepción (`OVER_RECEIVE_NOT_ALLOWED`).
 * 8. Flow 4 `HITL_APPROVAL` (`MINREPORT_EXEC_HITL_APPROVAL`): exige palabra clave exacta `ACTUALIZAR`,
 *    bloquea auto-aprobación (`custodianUid === actorUid` / `requesterUid === actorUid`), y aprueba
 *    cuando la ejecuta otro ejecutivo autorizado (`OWNER_EXEC` / `SITE_ADMIN`).
 * 9. Definiciones declarativas JSON v3.0 (`SUPPLY_WHATSAPP_FLOW_DEFINITIONS`) y `MetaWhatsAppCloudAdapter.sendFlowMessage`.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Duplex } from 'node:stream';
import express from 'express';

// Generar pares RSA-2048 efímeros en memoria (jamás hardcodeados)
const PRIMARY_RSA_KEYPAIR = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const WRONG_RSA_KEYPAIR = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ENCRYPTED_RSA_PASSPHRASE = `ephemeral_pass_${crypto.randomBytes(8).toString('hex')}`;
const ENCRYPTED_RSA_KEYPAIR = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: ENCRYPTED_RSA_PASSPHRASE,
    },
});

const TEST_APP_SECRET = `test_e09_meta_secret_${crypto.randomBytes(6).toString('hex')}`;

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID = 'minreport-supply-e09-test';
process.env.FIREBASE_PROJECT_ID = 'minreport-supply-e09-test';
process.env.FIREBASE_STORAGE_BUCKET = 'minreport-supply-e09-test.firebasestorage.app';
process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = 'test_e09_verify_token';
process.env.WHATSAPP_ACCESS_TOKEN = 'test_e09_access_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '109876543219';
process.env.WHATSAPP_FLOWS_PRIVATE_KEY = PRIMARY_RSA_KEYPAIR.privateKey;
process.env.WHATSAPP_FLOWS_PASSPHRASE = '';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore + Storage)
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
            verifyIdToken: async () => {
                throw new Error('UNEXPECTED_AUTH_CALL');
            },
        },
        storage: {
            bucket: () => ({ name: 'minreport-supply-e09-test.firebasestorage.app' }),
        },
    },
} as any;

// ---------------------------------------------------------------------------
// 2. Imports del SUT (tras registrar stub Firestore)
// ---------------------------------------------------------------------------

import { MetaWhatsAppCloudAdapter } from '../adapters/MetaWhatsAppCloudAdapter';
import {
    WhatsAppFlowCryptoError,
    WhatsAppFlowsCrypto,
    WhatsAppFlowTokenError,
    createSignedFlowToken,
    decryptFlowRequest,
    encryptFlowResponse,
    verifySignedFlowToken,
} from '../adapters/WhatsAppFlowsCrypto';
import {
    SUPPLY_WHATSAPP_FLOW_DEFINITIONS,
    SUPPLY_WHATSAPP_FLOW_IDS,
} from '../channels/supply.flows';
import { SUPPLY_COLLECTIONS, SupplyRepository } from '../application/SupplyRepository';
import supplyRouter from '../application/supply.controller';

// ---------------------------------------------------------------------------
// 3. Helpers criptográficos cliente Meta Flows v3.0 + Dispatcher HTTP en memoria
// ---------------------------------------------------------------------------

function simulateMetaClientEncryptRequest(
    payload: Record<string, unknown>,
    serverPublicKeyPem: string,
    aesKeyLengthBytes: 16 | 32 = 16
): {
    envelope: {
        encrypted_flow_data: string;
        encrypted_aes_key: string;
        initial_vector: string;
    };
    aesKey: Buffer;
    iv: Buffer;
} {
    const aesKey = crypto.randomBytes(aesKeyLengthBytes);
    const iv = crypto.randomBytes(16);
    const cipherAlg = aesKeyLengthBytes === 32 ? 'aes-256-gcm' : 'aes-128-gcm';

    const encryptedAesKey = crypto.publicEncrypt(
        {
            key: serverPublicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        aesKey
    );

    const cipher = crypto.createCipheriv(cipherAlg, aesKey, iv);
    const encryptedData = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
    ]);

    return {
        envelope: {
            encrypted_flow_data: encryptedData.toString('base64'),
            encrypted_aes_key: encryptedAesKey.toString('base64'),
            initial_vector: iv.toString('base64'),
        },
        aesKey,
        iv,
    };
}

function simulateMetaClientDecryptResponse(
    base64Response: string,
    aesKey: Buffer,
    originalIv: Buffer
): Record<string, any> {
    const cipherAlg = aesKey.length === 32 ? 'aes-256-gcm' : 'aes-128-gcm';
    const flippedIv = Buffer.allocUnsafe(originalIv.length);
    for (let i = 0; i < originalIv.length; i++) {
        flippedIv[i] = originalIv[i] ^ 0xff;
    }

    const rawBuf = Buffer.from(base64Response.trim(), 'base64');
    const ciphertext = rawBuf.subarray(0, rawBuf.length - 16);
    const authTag = rawBuf.subarray(rawBuf.length - 16);

    const decipher = crypto.createDecipheriv(cipherAlg, aesKey, flippedIv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
}

class MemorySocket extends Duplex {
    public readonly writtenChunks: Buffer[] = [];
    public remoteAddress = '127.0.0.1';
    public destroyed = false;
    public writable = true;
    public readable = true;

    _read(): void {
        // Sin lectura activa
    }

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
                resolve({
                    status: res.statusCode,
                    headers: res.getHeaders(),
                    text,
                    json,
                });
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

const TENANT_ID = 'tenant-e09-minera';
const SITE_ID = 'site-cordillera-e09';

async function seedFixtures(): Promise<void> {
    dbCollections.clear();
    MetaWhatsAppCloudAdapter.clearMockOutbox();

    await mockDb.collection('accounts').doc(TENANT_ID).set({
        accountId: TENANT_ID,
        name: 'Minera Cordillera E09 SpA',
        status: 'ACTIVE',
    });

    await mockDb.collection(SUPPLY_COLLECTIONS.SITES).doc(SITE_ID).set({
        siteId: SITE_ID,
        tenantId: TENANT_ID,
        name: 'Faena Cordillera E09',
        districtCode: 'CL-ANTOFAGASTA',
        shiftPattern: '7x7',
        currentHeadcount: 40,
        waterStorageCapacityL: 40000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
        marketplaceOptIn: false,
        roleMismatchMode: 'FLAG_AND_ACCEPT',
        directPurchaseAlertThresholdClp: 500000,
    });

    // Miembro pendiente de Doble Opt-In (para Flow 1 OPT_IN)
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-pending-optin')
        .set({
            uid: 'uid-pending-optin',
            displayName: 'Operador Nuevo Terreno',
            email: 'nuevo@minera-e09.cl',
            role: 'OPERATOR',
            status: 'ACTIVE',
            phoneE164: '+56900001111',
            whatsappOptInAt: null,
            whatsappOptInStatus: 'PENDING_DOUBLE_OPT_IN',
            allowedModules: { supply: true },
            supplyProfile: { role: 'CAMP_MANAGER' },
        });
    await mockDb.collection('users').doc('uid-pending-optin').set({
        uid: 'uid-pending-optin',
        email: 'nuevo@minera-e09.cl',
        whatsappOptInAt: null,
    });

    // Jefe de Campamento activo con Opt-In (para Flow 2 CAMP_ORDER)
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-camp-e09')
        .set({
            uid: 'uid-camp-e09',
            displayName: 'Jefe Campamento E09',
            email: 'camp@minera-e09.cl',
            role: 'OPERATOR',
            status: 'ACTIVE',
            phoneE164: '+56900002222',
            whatsappOptInAt: '2026-01-01T00:00:00.000Z',
            whatsappOptInStatus: 'ACTIVE',
            allowedModules: { supply: true },
            supplyProfile: { role: 'CAMP_MANAGER', licensedForControlledItems: false },
        });

    // Bodeguero activo (para Flow 3 RECEPTION_4WAY)
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-warehouse-e09')
        .set({
            uid: 'uid-warehouse-e09',
            displayName: 'Bodeguero Faena E09',
            email: 'bodega@minera-e09.cl',
            role: 'OPERATOR',
            status: 'ACTIVE',
            phoneE164: '+56900003333',
            whatsappOptInAt: '2026-01-01T00:00:00.000Z',
            whatsappOptInStatus: 'ACTIVE',
            allowedModules: { supply: true },
            supplyProfile: { role: 'WAREHOUSE_KEEPER' },
        });

    // Ejecutivo Aprobador OWNER_EXEC (para Flow 4 HITL_APPROVAL)
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-exec-e09')
        .set({
            uid: 'uid-exec-e09',
            displayName: 'Gerente Operaciones E09',
            email: 'gerencia@minera-e09.cl',
            role: 'OWNER',
            status: 'ACTIVE',
            phoneE164: '+56900004444',
            whatsappOptInAt: '2026-01-01T00:00:00.000Z',
            whatsappOptInStatus: 'ACTIVE',
            allowedModules: { supply: true },
            supplyProfile: { role: 'OWNER_EXEC', allowCapex: true },
        });

    // Custodio con rol SITE_ADMIN (prueba bloqueo de auto-aprobación ISO 27001)
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-custodian-e09')
        .set({
            uid: 'uid-custodian-e09',
            displayName: 'Administrador Faena Custodio',
            email: 'custodio@minera-e09.cl',
            role: 'ADMIN',
            status: 'ACTIVE',
            phoneE164: '+56900005555',
            whatsappOptInAt: '2026-01-01T00:00:00.000Z',
            whatsappOptInStatus: 'ACTIVE',
            allowedModules: { supply: true },
            supplyProfile: { role: 'SITE_ADMIN', allowCapex: true },
        });

    // Miembro suspendido (para validar rechazo de membresía inactiva)
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-suspended-e09')
        .set({
            uid: 'uid-suspended-e09',
            displayName: 'Usuario Suspendido',
            email: 'suspendido@minera-e09.cl',
            role: 'OPERATOR',
            status: 'SUSPENDED',
            whatsappOptInAt: '2026-01-01T00:00:00.000Z',
            allowedModules: { supply: true },
            supplyProfile: { role: 'CAMP_MANAGER' },
        });
}

// ---------------------------------------------------------------------------
// 5. Ejecución de Suite E09
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
    const app = express();
    app.use('/api/supply', supplyRouter);
    const dispatch = createInProcessDispatcher(app);

    const postEncryptedFlow = async (
        payload: Record<string, unknown>,
        opts?: {
            publicKeyPem?: string;
            signatureOverride?: string | null;
            aesKeyLen?: 16 | 32;
            tamperCiphertext?: boolean;
        }
    ) => {
        const { envelope, aesKey, iv } = simulateMetaClientEncryptRequest(
            payload,
            opts?.publicKeyPem || PRIMARY_RSA_KEYPAIR.publicKey,
            opts?.aesKeyLen || 16
        );
        if (opts?.tamperCiphertext) {
            const buf = Buffer.from(envelope.encrypted_flow_data, 'base64');
            buf[0] ^= 0x01;
            envelope.encrypted_flow_data = buf.toString('base64');
        }
        const rawBody = JSON.stringify(envelope);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (opts?.signatureOverride !== null) {
            headers['X-Hub-Signature-256'] =
                opts?.signatureOverride ||
                MetaWhatsAppCloudAdapter.computeWebhookSignature(rawBody, TEST_APP_SECRET);
        }

        const resp = await dispatch('/api/supply/whatsapp/flow-exchange', {
            method: 'POST',
            headers,
            body: rawBody,
        });

        let decrypted: Record<string, any> | null = null;
        if (resp.status === 200) {
            decrypted = simulateMetaClientDecryptResponse(resp.text, aesKey, iv);
        }

        return { resp, decrypted };
    };

    // =========================================================================
    // TEST 1: Vector criptográfico oficial Meta Flows v3.0 (AES-128-GCM + AES-256-GCM + Passphrase)
    // =========================================================================
    {
        // 1a. AES-128-GCM sin passphrase
        const sampleReq = {
            version: '3.0',
            action: 'data_exchange',
            screen: 'CAMP_REORDER_SELECT',
            data: { items: [{ rawText: 'Agua potable 20L', qty: 10 }] },
            flow_token: 'mf3.sample.token',
        };
        const { envelope, aesKey, iv } = simulateMetaClientEncryptRequest(
            sampleReq,
            PRIMARY_RSA_KEYPAIR.publicKey,
            16
        );
        const dec = decryptFlowRequest(envelope, PRIMARY_RSA_KEYPAIR.privateKey);
        assert.deepEqual(dec.decryptedBody, sampleReq);
        assert.ok(dec.aesKeyBuffer.equals(aesKey));
        assert.ok(dec.initialVectorBuffer.equals(iv));

        const serverResponsePayload = {
            version: '3.0',
            screen: 'SUCCESS',
            data: { ok: true, reqId: 'req_crypto_ok' },
        };
        const encryptedBase64 = encryptFlowResponse(
            serverResponsePayload,
            dec.aesKeyBuffer,
            dec.initialVectorBuffer
        );
        const clientDecrypted = simulateMetaClientDecryptResponse(encryptedBase64, aesKey, iv);
        assert.deepEqual(clientDecrypted, serverResponsePayload);

        // 1b. AES-256-GCM + llave privada RSA-2048 cifrada con passphrase
        const {
            envelope: env256,
            aesKey: aesKey256,
            iv: iv256,
        } = simulateMetaClientEncryptRequest(
            { version: '3.0', action: 'ping' },
            ENCRYPTED_RSA_KEYPAIR.publicKey,
            32
        );
        const dec256 = decryptFlowRequest(
            env256,
            ENCRYPTED_RSA_KEYPAIR.privateKey,
            ENCRYPTED_RSA_PASSPHRASE
        );
        assert.equal(dec256.decryptedBody.action, 'ping');
        const enc256Resp = encryptFlowResponse(
            { version: '3.0', data: { status: 'active' } },
            dec256.aesKeyBuffer,
            dec256.initialVectorBuffer
        );
        assert.deepEqual(simulateMetaClientDecryptResponse(enc256Resp, aesKey256, iv256), {
            version: '3.0',
            data: { status: 'active' },
        });

        // 1c. Llave privada incorrecta dispara WhatsAppFlowCryptoError(421)
        assert.throws(
            () => decryptFlowRequest(envelope, WRONG_RSA_KEYPAIR.privateKey),
            (err: any) =>
                err instanceof WhatsAppFlowCryptoError &&
                err.statusCode === 421 &&
                err.code === 'FLOW_RSA_DECRYPT_FAILED'
        );

        console.log('PASS [1/9] Vector criptográfico oficial Meta Flows v3.0 (RSA-OAEP-SHA256 + AES-128/256-GCM + IV^0xff + passphrase)');
    }

    // =========================================================================
    // TEST 2: Compuertas HTTP 401 (HMAC inválido/ausente) y HTTP 421 (RSA/AES fallo)
    // =========================================================================
    {
        await seedFixtures();

        // 2a. Firma X-Hub-Signature-256 ausente -> 401
        const noSig = await postEncryptedFlow(
            { version: '3.0', action: 'ping' },
            { signatureOverride: null }
        );
        assert.equal(noSig.resp.status, 401);
        assert.equal(noSig.resp.json?.error, 'INVALID_WHATSAPP_SIGNATURE');

        // 2b. Firma X-Hub-Signature-256 inválida -> 401
        const badSig = await postEncryptedFlow(
            { version: '3.0', action: 'ping' },
            { signatureOverride: `sha256=${'0'.repeat(64)}` }
        );
        assert.equal(badSig.resp.status, 401);
        assert.equal(badSig.resp.json?.error, 'INVALID_WHATSAPP_SIGNATURE');

        // 2c. Cifrado con llave pública RSA incorrecta -> HTTP 421 (dispara refresco clave pública en Meta)
        const wrongKey = await postEncryptedFlow(
            { version: '3.0', action: 'ping' },
            { publicKeyPem: WRONG_RSA_KEYPAIR.publicKey }
        );
        assert.equal(wrongKey.resp.status, 421);
        assert.equal(wrongKey.resp.json?.error, 'FLOW_RSA_DECRYPT_FAILED');

        // 2d. Ciphertext/authTag GCM alterado -> HTTP 421
        const tamperedCipher = await postEncryptedFlow(
            { version: '3.0', action: 'ping' },
            { tamperCiphertext: true }
        );
        assert.equal(tamperedCipher.resp.status, 421);
        assert.equal(tamperedCipher.resp.json?.error, 'FLOW_AES_DECRYPT_FAILED');

        console.log('PASS [2/9] Compuertas HTTP POST /whatsapp/flow-exchange (401 HMAC fail-closed + 421 RSA/GCM fallo)');
    }

    // =========================================================================
    // TEST 3: Health Check oficial Meta `action: 'ping'`
    // =========================================================================
    {
        const pingRes = await postEncryptedFlow({ version: '3.0', action: 'ping' });
        assert.equal(pingRes.resp.status, 200);
        assert.ok(
            String(pingRes.resp.headers['content-type'] || '').startsWith('text/plain'),
            'Meta Flows v3.0 exige Content-Type: text/plain'
        );
        assert.deepEqual(pingRes.decrypted, {
            version: '3.0',
            data: { status: 'active' },
        });

        console.log('PASS [3/9] Health check Meta Flows v3.0 (action: ping -> HTTP 200 text/plain cifrado { version: 3.0, status: active })');
    }

    // =========================================================================
    // TEST 4: Seguridad `flow_token` HMAC-SHA256 (tampering, expiración, cross-tenant, suspendido)
    // =========================================================================
    {
        await seedFixtures();
        const validToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-camp-e09',
                siteId: SITE_ID,
                flowType: 'CAMP_ORDER',
                expiresAtMs: Date.now() + 10 * 60_000,
            },
            TEST_APP_SECRET
        );
        const verified = verifySignedFlowToken(validToken, TEST_APP_SECRET);
        assert.equal(verified.tenantId, TENANT_ID);
        assert.equal(verified.memberUid, 'uid-camp-e09');

        // 4a. Manipulación cross-tenant del payload base64url manteniendo firma original -> rechazado
        const [prefix, payloadB64, sigB64] = validToken.split('.');
        const forgedClaims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        forgedClaims.tenantId = 'tenant-victima-externa';
        const tamperedToken = `${prefix}.${Buffer.from(JSON.stringify(forgedClaims), 'utf8').toString('base64url')}.${sigB64}`;

        assert.throws(
            () => verifySignedFlowToken(tamperedToken, TEST_APP_SECRET),
            (err: any) => err instanceof WhatsAppFlowTokenError && err.code === 'FLOW_TOKEN_INVALID'
        );

        const httpTampered = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: tamperedToken,
        });
        assert.equal(httpTampered.resp.status, 200);
        assert.equal(httpTampered.decrypted?.data?.ok, false);
        assert.equal(httpTampered.decrypted?.data?.error_code, 'FLOW_TOKEN_INVALID');

        // 4b. Token expirado -> rechazado
        const expiredToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-camp-e09',
                siteId: SITE_ID,
                flowType: 'CAMP_ORDER',
                expiresAtMs: Date.now() - 10_000,
            },
            TEST_APP_SECRET
        );
        assert.throws(
            () => verifySignedFlowToken(expiredToken, TEST_APP_SECRET),
            (err: any) => err instanceof WhatsAppFlowTokenError && err.code === 'FLOW_TOKEN_EXPIRED'
        );
        const httpExpired = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: expiredToken,
        });
        assert.equal(httpExpired.resp.status, 200);
        assert.equal(httpExpired.decrypted?.data?.ok, false);
        assert.equal(httpExpired.decrypted?.data?.error_code, 'FLOW_TOKEN_EXPIRED');

        // 4c. Miembro suspendido -> rechazado sin mutaciones
        const suspendedToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-suspended-e09',
                siteId: SITE_ID,
                flowType: 'CAMP_ORDER',
                expiresAtMs: Date.now() + 60_000,
            },
            TEST_APP_SECRET
        );
        const httpSuspended = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: suspendedToken,
        });
        assert.equal(httpSuspended.decrypted?.data?.ok, false);
        assert.equal(httpSuspended.decrypted?.data?.error_code, 'FLOW_MEMBER_UNAUTHORIZED');

        console.log('PASS [4/9] Seguridad flow_token HMAC-SHA256 (rechazo cross-tenant manipulado, expirado y miembro suspendido)');
    }

    // =========================================================================
    // TEST 5: Flow 1 `OPT_IN` (`MINREPORT_OPTIN_LEY21719`)
    // =========================================================================
    {
        await seedFixtures();
        const optInToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-pending-optin',
                siteId: SITE_ID,
                flowType: 'OPT_IN',
                expiresAtMs: Date.now() + 15 * 60_000,
            },
            TEST_APP_SECRET
        );

        const initRes = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: optInToken,
        });
        assert.equal(initRes.resp.status, 200);
        assert.equal(initRes.decrypted?.screen, 'OPT_IN_CONSENT');
        assert.equal(initRes.decrypted?.data?.ok, true);

        // Sin aceptación -> bloqueado
        const rejectRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'OPT_IN_CONSENT',
            flow_token: optInToken,
            data: { accepted: false },
        });
        assert.equal(rejectRes.decrypted?.data?.ok, false);
        assert.equal(rejectRes.decrypted?.data?.error_code, 'OPT_IN_NOT_ACCEPTED');
        assert.equal(
            getCollectionMap(`accounts/${TENANT_ID}/members`).get('uid-pending-optin')?.whatsappOptInAt,
            null
        );

        // Con aceptación -> actualiza miembro + usuario + AuditLedger
        const acceptRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'OPT_IN_CONSENT',
            flow_token: optInToken,
            data: { accepted: true },
        });
        assert.equal(acceptRes.resp.status, 200);
        assert.equal(acceptRes.decrypted?.screen, 'SUCCESS');
        assert.equal(acceptRes.decrypted?.data?.ok, true);
        assert.equal(acceptRes.decrypted?.data?.whatsappOptInStatus, 'ACTIVE');

        const updatedMember = getCollectionMap(`accounts/${TENANT_ID}/members`).get('uid-pending-optin');
        assert.ok(typeof updatedMember?.whatsappOptInAt === 'string' && updatedMember.whatsappOptInAt.length > 10);
        assert.equal(updatedMember?.whatsappOptInStatus, 'ACTIVE');

        const auditRecords = Array.from(getCollectionMap('audit_ledger').values());
        assert.ok(
            auditRecords.some(
                (entry) =>
                    entry.action === 'SUPPLY_WHATSAPP_DOUBLE_OPT_IN_CONFIRMED' &&
                    entry.module === 'supply' &&
                    entry.tenantId === TENANT_ID &&
                    entry.targetEntity === 'uid-pending-optin'
            ),
            'Doble Opt-In debe registrarse en AuditLedger'
        );

        console.log('PASS [5/9] Flow 1 OPT_IN (MINREPORT_OPTIN_LEY21719 -> whatsappOptInAt + ACTIVE + AuditLedger)');
    }

    // =========================================================================
    // TEST 6: Flow 2 `CAMP_ORDER` (`MINREPORT_CAMP_REORDER` — 1-Tap Re-Order + Bloqueo DS 132 / DGMN)
    // =========================================================================
    {
        await seedFixtures();
        // Sembrar requisición confirmada previa en el sitio para habilitar 1-Tap Re-Order
        const priorReq = await SupplyRepository.createRequisition(
            {
                tenantId: TENANT_ID,
                siteId: SITE_ID,
                requesterUid: 'uid-camp-e09',
                requesterName: 'Jefe Campamento E09',
                requesterRole: 'CAMP_MANAGER',
                demandOrigin: 'WA_CAMP',
                demandNature: 'REACTIVE_FIELD',
                costCenter: 'CC-CAMPAMENTO',
                atypicalFlags: [],
                lines: [
                    {
                        lineId: 'prior_l1',
                        canonicalSkuId: 'SKU-AGUA-BIDON',
                        itemName: 'Agua Potable Bidón 20L',
                        categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
                        procurementBucket: 'AGUA_POTABLE',
                        unitSi: 'L',
                        qtyRequested: 200,
                        qtyPurchased: 200,
                        qtyReceived: 200,
                        qtyPending: 0,
                        lineStatus: 'FULFILLED',
                        atypicalFlags: [],
                        fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                        urgency: 'STANDARD',
                    },
                    {
                        lineId: 'prior_l2',
                        canonicalSkuId: 'sku-arroz-grano',
                        itemName: 'Arroz Grano Largo',
                        categoryCode: 'VIVERES_ALIMENTACION',
                        procurementBucket: 'SUPERMERCADO',
                        unitSi: 'kg',
                        qtyRequested: 25,
                        qtyPurchased: 25,
                        qtyReceived: 25,
                        qtyPending: 0,
                        lineStatus: 'FULFILLED',
                        atypicalFlags: [],
                        fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                        urgency: 'STANDARD',
                    },
                ],
            },
            { actorUid: 'uid-camp-e09', actorEmail: 'camp@minera-e09.cl' }
        );

        const campToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-camp-e09',
                siteId: SITE_ID,
                flowType: 'CAMP_ORDER',
                expiresAtMs: Date.now() + 15 * 60_000,
            },
            TEST_APP_SECRET
        );

        // 6a. INIT carga plantilla de 1-Tap Re-Order y SKUs frecuentes
        const initCamp = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: campToken,
        });
        assert.equal(initCamp.resp.status, 200);
        assert.equal(initCamp.decrypted?.screen, 'CAMP_REORDER_SELECT');
        assert.equal(initCamp.decrypted?.data?.has_reorder_template, true);
        assert.equal(initCamp.decrypted?.data?.last_requisition_id, priorReq.reqId);
        assert.equal(initCamp.decrypted?.data?.frequent_skus?.length, 2);

        // 6b. 1-Tap Re-Order crea requisición real en SupplyRepository
        const oneTapRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'CAMP_REORDER_SELECT',
            flow_token: campToken,
            data: { mode: 'ONE_TAP_REORDER' },
        });
        assert.equal(oneTapRes.resp.status, 200);
        assert.equal(oneTapRes.decrypted?.screen, 'SUCCESS');
        assert.equal(oneTapRes.decrypted?.data?.ok, true);
        assert.equal(oneTapRes.decrypted?.data?.oneTapReorder, true);
        assert.equal(oneTapRes.decrypted?.data?.lineCount, 2);

        const createdReqId = String(oneTapRes.decrypted?.data?.reqId || '');
        const persistedReq = getCollectionMap(SUPPLY_COLLECTIONS.REQUISITIONS).get(createdReqId);
        assert.ok(persistedReq, 'La requisición 1-Tap Re-Order debe persistirse en Firestore');
        assert.equal(persistedReq.lines.length, 2);
        assert.equal(persistedReq.lines[0].canonicalSkuId, 'SKU-AGUA-BIDON');

        // 6c. Bloqueo DS 132 (alcohol ofuscado con acentos/leetspeak) -> rechazado sin crear requisición
        const reqCountBefore = getCollectionMap(SUPPLY_COLLECTIONS.REQUISITIONS).size;
        const ds132Res = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'CAMP_REORDER_SELECT',
            flow_token: campToken,
            data: {
                items: [{ rawText: '2 cajas de c3rv3za', qty: 2 }],
            },
        });
        assert.equal(ds132Res.decrypted?.data?.ok, false);
        assert.equal(ds132Res.decrypted?.data?.error_code, 'DS132_ALCOHOL');
        assert.equal(getCollectionMap(SUPPLY_COLLECTIONS.REQUISITIONS).size, reqCountBefore);

        // 6d. Bloqueo DGMN Ley N° 17.798 (explosivos sin licencia) -> rechazado y auditado
        const dgmnRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'CAMP_REORDER_SELECT',
            flow_token: campToken,
            data: {
                items: [{ rawText: '5 cajas de dinamita', qty: 5 }],
            },
        });
        assert.equal(dgmnRes.decrypted?.data?.ok, false);
        assert.equal(dgmnRes.decrypted?.data?.error_code, 'DGMN_EXPLOSIVES_BLOCK');
        assert.equal(getCollectionMap(SUPPLY_COLLECTIONS.REQUISITIONS).size, reqCountBefore);

        const policyAudits = Array.from(getCollectionMap(SUPPLY_COLLECTIONS.POLICY_AUDIT).values());
        assert.ok(policyAudits.some((p) => p.policyCode === 'DS132_ALCOHOL'));
        assert.ok(policyAudits.some((p) => p.policyCode === 'DGMN_EXPLOSIVES_BLOCK'));

        console.log('PASS [6/9] Flow 2 CAMP_ORDER (1-Tap Re-Order real + bloqueo DS 132 alcohol + bloqueo DGMN explosivos + policy_audit)');
    }

    // =========================================================================
    // TEST 7: Flow 3 `RECEPTION_4WAY` (`MINREPORT_WAREHOUSE_4WAY` + Anti Sobre-Recepción)
    // =========================================================================
    {
        await seedFixtures();
        // Sembrar compra en tránsito con 10 sacos (250 kg)
        const purchaseRes = await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: TENANT_ID,
                siteId: SITE_ID,
                buyerUid: 'uid-exec-e09',
                buyerRole: 'OWNER_EXEC',
                purchaseMode: 'DIRECT_AUTONOMOUS',
                authorizedByAuthority: true,
                supplierTaxId: '76.123.456-0',
                supplierName: 'Distribuidora Norte SpA',
                documentType: 33,
                folio: 9012,
                issueDate: '2026-11-20',
                netAmountClp: 100000,
                vatAmountClp: 19000,
                totalAmountClp: 119000,
                paymentMethod: 'TRANSFERENCIA',
                lines: [
                    {
                        purchaseLineId: 'pline_e09_1',
                        canonicalSkuId: 'sku-papa-saco',
                        description: 'Papas Saco 25kg',
                        categoryCode: 'VIVERES_ALIMENTACION',
                        procurementBucket: 'VERDULERIA',
                        unitSi: 'kg',
                        qtyPurchased: 10,
                        unitPriceClp: 11900,
                        subtotalClp: 119000,
                        destination: 'STOCK_IN_TRANSIT',
                        costCenter: 'CC-CAMPAMENTO',
                        isCapexAsset: false,
                    },
                ],
            },
            { actorUid: 'uid-exec-e09', actorEmail: 'gerencia@minera-e09.cl' }
        );
        const purchaseId = purchaseRes.purchase.purchaseId;

        const receptionToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-warehouse-e09',
                siteId: SITE_ID,
                flowType: 'RECEPTION_4WAY',
                entityId: purchaseId,
                expiresAtMs: Date.now() + 15 * 60_000,
            },
            TEST_APP_SECRET
        );

        // 7a. INIT lista compras en tránsito
        const initRec = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: receptionToken,
        });
        assert.equal(initRec.decrypted?.screen, 'WAREHOUSE_SELECT_PURCHASE');
        assert.equal(initRec.decrypted?.data?.pending_purchases?.length, 1);
        assert.equal(initRec.decrypted?.data?.pending_purchases[0].purchaseId, purchaseId);

        // 7b. Recepción parcial (4 de 10) -> PARTIAL_DISCREPANCY y qtyReceivedSoFar = 4
        const partialRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'WAREHOUSE_SELECT_PURCHASE',
            flow_token: receptionToken,
            data: {
                purchase_id: purchaseId,
                received_lines: [{ purchaseLineId: 'pline_e09_1', qtyReceived: 4 }],
            },
        });
        assert.equal(partialRes.decrypted?.screen, 'SUCCESS');
        assert.equal(partialRes.decrypted?.data?.ok, true);
        assert.equal(partialRes.decrypted?.data?.receptionStatus, 'PARTIAL_DISCREPANCY');

        // 7c. Intento de sobre-recepción (4 + 8 = 12 > 10) -> bloqueado OVER_RECEIVE_NOT_ALLOWED
        const overRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'WAREHOUSE_SELECT_PURCHASE',
            flow_token: receptionToken,
            data: {
                purchase_id: purchaseId,
                received_lines: [{ purchaseLineId: 'pline_e09_1', qtyReceived: 8 }],
            },
        });
        assert.equal(overRes.decrypted?.data?.ok, false);
        assert.equal(overRes.decrypted?.data?.error_code, 'OVER_RECEIVE_NOT_ALLOWED');
        const purchaseAfterOver = getCollectionMap(SUPPLY_COLLECTIONS.PURCHASES).get(purchaseId);
        assert.equal(purchaseAfterOver?.lines?.[0]?.qtyReceivedSoFar, 4);

        // 7d. Recepción del saldo exacto (6) -> RECEIVED y stock completo en bodega
        const finalRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'WAREHOUSE_SELECT_PURCHASE',
            flow_token: receptionToken,
            data: {
                purchase_id: purchaseId,
                received_lines: [{ purchaseLineId: 'pline_e09_1', qtyReceived: 6 }],
            },
        });
        assert.equal(finalRes.decrypted?.screen, 'SUCCESS');
        assert.equal(finalRes.decrypted?.data?.receptionStatus, 'RECEIVED');
        const invItems = await SupplyRepository.listInventory(TENANT_ID, SITE_ID);
        assert.equal(invItems[0]?.qtyInTransit, 0);
        assert.equal(invItems[0]?.qtyInWarehouse, 10);

        console.log('PASS [7/9] Flow 3 RECEPTION_4WAY (parcial + bloqueo OVER_RECEIVE_NOT_ALLOWED + recepción final atómica)');
    }

    // =========================================================================
    // TEST 8: Flow 4 `HITL_APPROVAL` (`MINREPORT_EXEC_HITL_APPROVAL` — ACTUALIZAR + Anti Auto-Aprobación)
    // =========================================================================
    {
        await seedFixtures();
        const report = await SupplyRepository.createExpenseReport(
            {
                tenantId: TENANT_ID,
                siteId: SITE_ID,
                custodianUid: 'uid-custodian-e09',
                custodianName: 'Administrador Faena Custodio',
                paymentMethod: 'FONDO_POR_RENDIR',
                title: 'Rendición Semanal Faena E09',
                fundAdvanceClp: 500000,
                siiDocumentIds: [],
            },
            { actorUid: 'uid-custodian-e09', actorEmail: 'custodio@minera-e09.cl' }
        );

        const execToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-exec-e09',
                siteId: SITE_ID,
                flowType: 'HITL_APPROVAL',
                entityId: report.reportId,
                entityKind: 'EXPENSE_REPORT',
                expiresAtMs: Date.now() + 15 * 60_000,
            },
            TEST_APP_SECRET
        );

        // 8a. INIT presenta resumen HITL exigiendo palabra clave ACTUALIZAR
        const initHitl = await postEncryptedFlow({
            version: '3.0',
            action: 'INIT',
            flow_token: execToken,
        });
        assert.equal(initHitl.decrypted?.screen, 'EXEC_HITL_REVIEW');
        assert.equal(initHitl.decrypted?.data?.entity_id, report.reportId);
        assert.equal(initHitl.decrypted?.data?.requires_keyword, 'ACTUALIZAR');

        // 8b. Palabra clave incorrecta -> bloqueado HITL_KEYWORD_REQUIRED
        const wrongKw = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'EXEC_HITL_REVIEW',
            flow_token: execToken,
            data: {
                entity_id: report.reportId,
                entity_kind: 'EXPENSE_REPORT',
                decision: 'APPROVE',
                confirmation_keyword: 'SI',
            },
        });
        assert.equal(wrongKw.decrypted?.data?.ok, false);
        assert.equal(wrongKw.decrypted?.data?.error_code, 'HITL_KEYWORD_REQUIRED');
        assert.equal(
            (await SupplyRepository.getExpenseReport(TENANT_ID, report.reportId))?.status,
            'SUBMITTED'
        );

        // 8c. Auto-aprobación del propio custodio (incluso con ACTUALIZAR) -> bloqueado SELF_APPROVAL_FORBIDDEN
        const selfApprovalToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-custodian-e09',
                siteId: SITE_ID,
                flowType: 'HITL_APPROVAL',
                entityId: report.reportId,
                entityKind: 'EXPENSE_REPORT',
                expiresAtMs: Date.now() + 15 * 60_000,
            },
            TEST_APP_SECRET
        );
        const selfRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'EXEC_HITL_REVIEW',
            flow_token: selfApprovalToken,
            data: {
                entity_id: report.reportId,
                entity_kind: 'EXPENSE_REPORT',
                decision: 'APPROVE',
                confirmation_keyword: 'ACTUALIZAR',
            },
        });
        assert.equal(selfRes.decrypted?.data?.ok, false);
        assert.equal(selfRes.decrypted?.data?.error_code, 'SELF_APPROVAL_FORBIDDEN');
        assert.equal(
            (await SupplyRepository.getExpenseReport(TENANT_ID, report.reportId))?.status,
            'SUBMITTED'
        );

        // 8d. Aprobación por otro ejecutivo autorizado (OWNER_EXEC) con palabra exacta ACTUALIZAR -> APPROVED
        const approveRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'EXEC_HITL_REVIEW',
            flow_token: execToken,
            data: {
                entity_id: report.reportId,
                entity_kind: 'EXPENSE_REPORT',
                decision: 'APPROVE',
                confirmation_keyword: 'ACTUALIZAR',
            },
        });
        assert.equal(approveRes.decrypted?.screen, 'SUCCESS');
        assert.equal(approveRes.decrypted?.data?.ok, true);
        assert.equal(approveRes.decrypted?.data?.status, 'APPROVED');
        assert.equal(approveRes.decrypted?.data?.hitlConfirmed, true);
        assert.equal(
            (await SupplyRepository.getExpenseReport(TENANT_ID, report.reportId))?.status,
            'APPROVED'
        );

        // 8e. También validar aprobación HITL sobre requisición atípica (anti auto-aprobación + ACTUALIZAR)
        const atypicalReq = await SupplyRepository.createRequisition(
            {
                tenantId: TENANT_ID,
                siteId: SITE_ID,
                requesterUid: 'uid-custodian-e09',
                requesterName: 'Administrador Faena Custodio',
                requesterRole: 'SITE_ADMIN',
                demandOrigin: 'WA_CAMP',
                demandNature: 'REACTIVE_FIELD',
                costCenter: 'CC-CAPEX',
                status: 'DRAFT',
                atypicalFlags: ['ATYPICAL_HIGH_VALUE_OR_CAPEX'],
                lines: [
                    {
                        lineId: 'atyp_l1',
                        canonicalSkuId: 'SKU-CAPEX-COCINA',
                        itemName: 'Cocina Industrial Campamento',
                        categoryCode: 'ACTIVO_EQUIPAMIENTO',
                        procurementBucket: 'ACTIVOS_CAPEX',
                        unitSi: 'un',
                        qtyRequested: 1,
                        qtyPurchased: 0,
                        qtyReceived: 0,
                        qtyPending: 1,
                        lineStatus: 'OPEN',
                        atypicalFlags: ['ATYPICAL_HIGH_VALUE_OR_CAPEX'],
                        fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                        urgency: 'HIGH',
                    },
                ],
            },
            { actorUid: 'uid-custodian-e09', actorEmail: 'custodio@minera-e09.cl' }
        );

        const reqHitlToken = createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-exec-e09',
                siteId: SITE_ID,
                flowType: 'HITL_APPROVAL',
                entityId: atypicalReq.reqId,
                entityKind: 'REQUISITION',
                expiresAtMs: Date.now() + 15 * 60_000,
            },
            TEST_APP_SECRET
        );
        const reqApproveRes = await postEncryptedFlow({
            version: '3.0',
            action: 'data_exchange',
            screen: 'EXEC_HITL_REVIEW',
            flow_token: reqHitlToken,
            data: {
                entity_id: atypicalReq.reqId,
                entity_kind: 'REQUISITION',
                decision: 'APPROVE',
                confirmation_keyword: 'ACTUALIZAR',
            },
        });
        assert.equal(reqApproveRes.decrypted?.screen, 'SUCCESS');
        assert.equal(reqApproveRes.decrypted?.data?.status, 'OPEN');

        console.log('PASS [8/9] Flow 4 HITL_APPROVAL (exige ACTUALIZAR + bloquea auto-aprobación + aprueba rendición SII y req atípica)');
    }

    // =========================================================================
    // TEST 9: Definiciones JSON v3.0 + `MetaWhatsAppCloudAdapter.sendFlowMessage`
    // =========================================================================
    {
        // 9a. Verificar 4 definiciones declarativas v3.0 listas para Meta Business Manager
        for (const flowId of Object.values(SUPPLY_WHATSAPP_FLOW_IDS)) {
            const def = (SUPPLY_WHATSAPP_FLOW_DEFINITIONS as Record<string, any>)[flowId];
            assert.ok(def, `Definición declarativa faltante para ${flowId}`);
            assert.equal(def.version, '3.0');
            assert.equal(def.data_api_version, '3.0');
            assert.ok(Array.isArray(def.screens) && def.screens.length >= 2);
        }

        // 9b. sendFlowMessage en modo mock registra en mockOutbox sin PII en texto plano
        MetaWhatsAppCloudAdapter.clearMockOutbox();
        const flowToken = WhatsAppFlowsCrypto.createSignedFlowToken(
            {
                tenantId: TENANT_ID,
                memberUid: 'uid-camp-e09',
                siteId: SITE_ID,
                flowType: 'CAMP_ORDER',
                expiresAtMs: Date.now() + 30 * 60_000,
            },
            TEST_APP_SECRET
        );
        const mockSend = await MetaWhatsAppCloudAdapter.sendFlowMessage('+56900002222', {
            flowId: SUPPLY_WHATSAPP_FLOW_IDS.CAMP_ORDER,
            flowToken,
            flowCta: '1-TAP RE-ORDER',
            bodyText: 'Repetir última orden confirmada de campamento.',
            mode: 'published',
        });
        assert.equal(mockSend.ok, true);
        assert.equal(mockSend.mocked, true);
        const outbox = MetaWhatsAppCloudAdapter.getMockOutbox();
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].kind, 'flow');
        assert.equal(outbox[0].flowId, 'MINREPORT_CAMP_REORDER');
        assert.equal(outbox[0].flowMode, 'published');

        // 9c. sendFlowMessage sobre Graph API v24.0 real (stub fetch) emite estructura oficial Meta v3
        let capturedUrl = '';
        let capturedPayload: any = null;
        MetaWhatsAppCloudAdapter.setCustomFetchForTests(async (url: any, init: any) => {
            capturedUrl = String(url);
            capturedPayload = JSON.parse(String(init?.body || '{}'));
            return {
                ok: true,
                status: 200,
                json: async () => ({ messages: [{ id: 'wamid.flow_v3_sent' }] }),
                text: async () => JSON.stringify({ messages: [{ id: 'wamid.flow_v3_sent' }] }),
            } as any;
        });
        try {
            const liveSend = await MetaWhatsAppCloudAdapter.sendFlowMessage('+56900002222', {
                flowId: SUPPLY_WHATSAPP_FLOW_IDS.OPT_IN,
                flowToken,
                flowCta: 'ACTIVAR CANAL',
                bodyText: 'Confirme Doble Opt-In Ley N° 21.719.',
                headerText: 'MINREPORT · ABASTECIMIENTO',
                mode: 'draft',
                flowAction: 'data_exchange',
            });
            assert.equal(liveSend.ok, true);
            assert.equal(liveSend.mocked, false);
            assert.equal(liveSend.messageId, 'wamid.flow_v3_sent');
            assert.ok(capturedUrl.includes('/v24.0/109876543219/messages'));
            assert.equal(capturedPayload?.type, 'interactive');
            assert.equal(capturedPayload?.interactive?.type, 'flow');
            assert.equal(capturedPayload?.interactive?.action?.name, 'flow');
            assert.equal(capturedPayload?.interactive?.action?.parameters?.flow_message_version, '3');
            assert.equal(capturedPayload?.interactive?.action?.parameters?.mode, 'draft');
            assert.equal(capturedPayload?.interactive?.action?.parameters?.flow_id, 'MINREPORT_OPTIN_LEY21719');
        } finally {
            MetaWhatsAppCloudAdapter.setCustomFetchForTests(null);
        }

        // 9d. Producción jamás permite modo mock
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            assert.equal(MetaWhatsAppCloudAdapter.isMockMode(), false);
        } finally {
            process.env.NODE_ENV = prevEnv;
        }

        console.log('PASS [9/9] Definiciones declarativas JSON v3.0 + MetaWhatsAppCloudAdapter.sendFlowMessage (mock + v24.0 + prod guard)');
    }

    console.log('\nALL E09 WHATSAPP FLOWS v3.0 TESTS PASSED (9/9)');
}

let allE09TestsCompleted = false;
process.on('beforeExit', () => {
    if (!allE09TestsCompleted) {
        console.error('E09 WHATSAPP FLOWS TEST FAILED: Event loop drained before all 9 tests completed.');
        process.exit(1);
    }
});

runTests()
    .then(() => {
        allE09TestsCompleted = true;
    })
    .catch((err) => {
        console.error('E09 WHATSAPP FLOWS TEST FAILED:', err);
        process.exit(1);
    });
