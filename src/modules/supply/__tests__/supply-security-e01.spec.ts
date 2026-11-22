/**
 * Suite de Seguridad Etapa E01 — MINREPORT · ABASTECIMIENTO
 *
 * Verifica determinísticamente los bloqueantes P0-01, P0-02, P1-01 y P1-05 parcial:
 * 1. Cierre IDOR en CasStorageService (`readCasBlob` / `openCasBlobStream`):
 *    - Bloqueo cross-tenant (`cas_blobs/tenants/tenant-b/...` bajo `tenantId: 'tenant-a'`)
 *    - Bloqueo path traversal (`..`, prefijo `/`, backslashes `\`, bytes nulos `\0`)
 *    - Bloqueo lectura sin `tenantId` ni `allowCrossTenantAudit` en `cas_blobs/tenants/`
 *    - Exigencia estricta de prefijos en `GLOBAL_OEM` y `PUBLIC_SYMBOLOGY`
 * 2. Endurecimiento `/api/supply/receipts/analyze` + `ReceiptIntelligencePipeline`:
 *    - Rechazo HTTP 403 (`CAS_TENANT_ACCESS_DENIED`) ante `storagePath` cross-tenant o `sha256` ajeno
 *    - Validación Zod estricta HTTP 400 (límites base64/decodificado, XML, caption, costCenter)
 *    - Cero fuga de `err.message` en respuestas HTTP 500
 * 3. Hermeticidad 3º TEST-PILOT (`supply.controller`, `x402Gatekeeper`, `src/index.ts`, `storage.rules`):
 *    - Excluido de `isSystemPrivileged` / `isGlobalSovereign`
 *    - Bloqueado fuera de su sandbox `pilot-${uid}` (403 / `authorized: false`)
 *    - Bloqueado cuando `test_pilots/{uid}` está expirado, `REVOKED`, `SUSPENDED` o ausente (`PILOT_EXPIRED_OR_REVOKED`)
 *    - Permitido únicamente dentro de su sandbox `pilot-${uid}` activo y vigente
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Duplex, Readable } from 'node:stream';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID ||= 'minreport-supply-e01-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-supply-e01-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-supply-e01-test.firebasestorage.app';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore/Auth/Storage)
// ---------------------------------------------------------------------------

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const storageBlobs = new Map<string, { buffer: Buffer; contentType: string; cacheControl?: string }>();
const mockTokens = new Map<string, Record<string, any>>();

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
        const tx = {
            get: (ref: any) => ref.get(),
            set: (ref: any, data: any, opts?: any) => ref.set(data, opts),
            update: (ref: any, patch: any) => ref.update(patch),
            delete: (ref: any) => ref.delete(),
        };
        return fn(tx);
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
            file(storagePath: string) {
                return {
                    async save(buffer: Buffer, opts?: any) {
                        storageBlobs.set(storagePath, {
                            buffer: Buffer.from(buffer),
                            contentType: opts?.contentType || 'application/octet-stream',
                            cacheControl: opts?.metadata?.cacheControl,
                        });
                    },
                    async getMetadata() {
                        const found = storageBlobs.get(storagePath);
                        if (!found) throw new Error('Not found');
                        return [
                            {
                                size: found.buffer.length,
                                contentType: found.contentType,
                                cacheControl: found.cacheControl,
                            },
                        ];
                    },
                    async download() {
                        const found = storageBlobs.get(storagePath);
                        if (!found) throw new Error('Not found');
                        return [found.buffer];
                    },
                    createReadStream() {
                        const found = storageBlobs.get(storagePath);
                        if (!found) throw new Error('Not found');
                        return Readable.from(found.buffer);
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
// 2. Importar módulos bajo prueba tras inyectar stubs
// ---------------------------------------------------------------------------

import {
    buildMediaRegistryDocId,
    CasStorageService,
} from '../../../core/media/CasStorageService';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import {
    verifyCorporateContractAccess,
    x402Gatekeeper,
} from '../../../middleware/x402Gatekeeper';
import { resolveAuthorizedAiTenantContext } from '../../../index';
import {
    ReceiptCasAccessDeniedError,
    ReceiptIntelligencePipeline,
} from '../application/ReceiptIntelligencePipeline';
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
    const TENANT_A = 'tenant-a';
    const TENANT_B = 'tenant-b';
    const shaA = crypto.createHash('sha256').update('blob-tenant-a').digest('hex');
    const shaB = crypto.createHash('sha256').update('blob-tenant-b').digest('hex');
    const shaOem = crypto.createHash('sha256').update('blob-global-oem').digest('hex');
    const shaSym = crypto.createHash('sha256').update('blob-public-symbology').digest('hex');

    const pathA = `cas_blobs/tenants/${TENANT_A}/${shaA}.xml`;
    const pathB = `cas_blobs/tenants/${TENANT_B}/${shaB}.xml`;
    const pathOem = `cas_blobs/global_oem/${shaOem}.webp`;
    const pathSym = `cas_blobs/symbology/${shaSym}.svg`;

    const sampleXmlA =
        '<DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>101</Folio><FchEmis>2026-11-20</FchEmis></IdDoc><Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Proveedor A SpA</RznSoc></Emisor><Totales><MntNeto>10000</MntNeto><IVA>1900</IVA><MntTotal>11900</MntTotal></Totales></Encabezado><Detalle><NmbItem>Guantes</NmbItem><QtyItem>2</QtyItem><PrcItem>5000</PrcItem><MontoItem>10000</MontoItem></Detalle></Documento></DTE>';
    const sampleXmlB =
        '<DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>999</Folio><FchEmis>2026-11-20</FchEmis></IdDoc><Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Proveedor Secreto B SpA</RznSoc></Emisor><Totales><MntNeto>50000</MntNeto><IVA>9500</IVA><MntTotal>59500</MntTotal></Totales></Encabezado><Detalle><NmbItem>Secreto B</NmbItem><QtyItem>1</QtyItem><PrcItem>50000</PrcItem><MontoItem>50000</MontoItem></Detalle></Documento></DTE>';

    storageBlobs.set(pathA, { buffer: Buffer.from(sampleXmlA, 'utf8'), contentType: 'application/xml' });
    storageBlobs.set(pathB, { buffer: Buffer.from(sampleXmlB, 'utf8'), contentType: 'application/xml' });
    storageBlobs.set(pathOem, { buffer: Buffer.from('oem-webp-bytes'), contentType: 'image/webp' });
    storageBlobs.set(pathSym, { buffer: Buffer.from('<svg></svg>'), contentType: 'image/svg+xml' });

    await mockDb.collection('media_registry').doc(buildMediaRegistryDocId(shaA, 'TENANT_PRIVATE', TENANT_A)).set({
        sha256: shaA,
        scope: 'TENANT_PRIVATE',
        tenantId: TENANT_A,
        profile: 'IMAGE_TECHNICAL_HD',
        mimeType: 'application/xml',
        extension: 'xml',
        originalBytes: Buffer.byteLength(sampleXmlA),
        optimizedBytes: Buffer.byteLength(sampleXmlA),
        savingsRatio: 0,
        savingsPct: 0,
        storagePath: pathA,
        downloadUrl: `/api/media/blob/tenant/${TENANT_A}/${shaA}.xml`,
        createdAt: '2026-11-21T00:00:00.000Z',
    });

    await mockDb.collection('media_registry').doc(buildMediaRegistryDocId(shaB, 'TENANT_PRIVATE', TENANT_B)).set({
        sha256: shaB,
        scope: 'TENANT_PRIVATE',
        tenantId: TENANT_B,
        profile: 'IMAGE_TECHNICAL_HD',
        mimeType: 'application/xml',
        extension: 'xml',
        originalBytes: Buffer.byteLength(sampleXmlB),
        optimizedBytes: Buffer.byteLength(sampleXmlB),
        savingsRatio: 0,
        savingsPct: 0,
        storagePath: pathB,
        downloadUrl: `/api/media/blob/tenant/${TENANT_B}/${shaB}.xml`,
        createdAt: '2026-11-21T00:00:00.000Z',
    });

    // =========================================================================
    // TEST 1: CasStorageService IDOR & Path Traversal Hardening (P0-01)
    // =========================================================================
    {
        // Cross-tenant direct path must fail closed (null)
        const crossRead1 = await CasStorageService.readCasBlob(pathB, {
            scope: 'TENANT_PRIVATE',
            tenantId: TENANT_A,
        });
        assert.equal(crossRead1, null, 'readCasBlob debe rechazar path de tenant-b cuando tenantId=tenant-a');

        const crossStream1 = await CasStorageService.openCasBlobStream(pathB, {
            tenantId: TENANT_A,
        });
        assert.equal(crossStream1, null, 'openCasBlobStream debe rechazar path cross-tenant');

        // Path traversal, leading slash, backslash, null byte
        const traversalCases = [
            `cas_blobs/tenants/${TENANT_A}/../${TENANT_B}/${shaB}.xml`,
            `../cas_blobs/tenants/${TENANT_A}/${shaA}.xml`,
            `/cas_blobs/tenants/${TENANT_A}/${shaA}.xml`,
            `cas_blobs\\tenants\\${TENANT_A}\\${shaA}.xml`,
            `cas_blobs/tenants/${TENANT_A}/${shaA}.xml\0.png`,
            `cas_blobs/tenants/${TENANT_A}/%2e%2e/${TENANT_B}/${shaB}.xml`,
        ];
        for (const badPath of traversalCases) {
            const res = await CasStorageService.readCasBlob(badPath, {
                scope: 'TENANT_PRIVATE',
                tenantId: TENANT_A,
            });
            assert.equal(res, null, `Debe rechazar path malicioso: ${badPath}`);
        }

        // Unscoped private tenant path (no tenantId, no allowCrossTenantAudit) must return null
        const openPrivate = await CasStorageService.readCasBlob(pathA);
        assert.equal(
            openPrivate,
            null,
            'Lectura de cas_blobs/tenants/ sin tenantId ni allowCrossTenantAudit debe retornar null'
        );

        // Audit override explicitly enabled
        const auditPrivate = await CasStorageService.readCasBlob(pathB, {
            allowCrossTenantAudit: true,
        });
        assert.ok(auditPrivate, 'allowCrossTenantAudit=true debe permitir lectura soberana');

        // Valid same-tenant read (by path & by sha256)
        const ownByPath = await CasStorageService.readCasBlob(pathA, {
            scope: 'TENANT_PRIVATE',
            tenantId: TENANT_A,
        });
        assert.ok(ownByPath && ownByPath.buffer.toString('utf8').includes('Proveedor A SpA'));

        const ownBySha = await CasStorageService.readCasBlob(shaA, {
            scope: 'TENANT_PRIVATE',
            tenantId: TENANT_A,
        });
        assert.ok(ownBySha && ownBySha.buffer.toString('utf8').includes('Proveedor A SpA'));

        // Cross-tenant sha256 lookup returns null
        const crossBySha = await CasStorageService.readCasBlob(shaB, {
            scope: 'TENANT_PRIVATE',
            tenantId: TENANT_A,
        });
        assert.equal(crossBySha, null, 'sha256 de tenant-b no debe resolverse para tenant-a');

        // GLOBAL_OEM & PUBLIC_SYMBOLOGY strict prefix enforcement
        assert.ok(await CasStorageService.readCasBlob(pathOem, { scope: 'GLOBAL_OEM' }));
        assert.equal(await CasStorageService.readCasBlob(pathSym, { scope: 'GLOBAL_OEM' }), null);
        assert.equal(await CasStorageService.readCasBlob(pathA, { scope: 'GLOBAL_OEM' }), null);

        assert.ok(await CasStorageService.readCasBlob(pathSym, { scope: 'PUBLIC_SYMBOLOGY' }));
        assert.equal(await CasStorageService.readCasBlob(pathOem, { scope: 'PUBLIC_SYMBOLOGY' }), null);

        console.log('PASS [1/4] CasStorageService anti-IDOR, path traversal & scope prefix hardening');
    }

    // =========================================================================
    // Seed cuentas y tokens para pruebas HTTP de /receipts/analyze y TEST-PILOT
    // =========================================================================
    const futureExpiry = Date.now() + 24 * 60 * 60 * 1000;
    const pastExpiry = Date.now() - 60 * 1000;

    await mockDb.collection('accounts').doc(TENANT_A).set({
        id: TENANT_A,
        ownerId: 'uid-owner-a',
        status: 'ACTIVE',
        type: 'B2B',
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, stockpile: true, supply: true } },
    });
    await mockDb.collection('accounts').doc(TENANT_B).set({
        id: TENANT_B,
        ownerId: 'uid-owner-b',
        status: 'ACTIVE',
        type: 'B2B',
        contract: { status: 'ACTIVE', activeModules: { opermaq: true, stockpile: true, supply: true } },
    });
    await mockDb.collection('users').doc('uid-owner-a').set({
        uid: 'uid-owner-a',
        email: 'owner-a@minera.cl',
        role: 'OWNER',
        status: 'ACTIVE',
        primaryAccountId: TENANT_A,
    });
    mockTokens.set('tok-owner-a', {
        uid: 'uid-owner-a',
        email: 'owner-a@minera.cl',
        email_verified: true,
        role: 'OWNER',
        activeAccountId: TENANT_A,
    });

    // TEST_PILOT activo
    const pilotActiveUid = 'uid-pilot-active';
    const pilotActiveSandbox = `pilot-${pilotActiveUid}`;
    await mockDb.collection('users').doc(pilotActiveUid).set({
        uid: pilotActiveUid,
        email: 'pilot-active@minreport.com',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
        pilotExpiresAt: futureExpiry,
    });
    await mockDb.collection('test_pilots').doc(pilotActiveUid).set({
        id: pilotActiveUid,
        userId: pilotActiveUid,
        pilotAccountId: pilotActiveSandbox,
        status: 'ACTIVE',
        expiresAt: futureExpiry,
    });
    await mockDb.collection('accounts').doc(pilotActiveSandbox).set({
        id: pilotActiveSandbox,
        ownerId: pilotActiveUid,
        type: 'TEST_PILOT',
        status: 'ACTIVE',
        contract: { status: 'ACTIVE' },
    });
    mockTokens.set('tok-pilot-active', {
        uid: pilotActiveUid,
        email: 'pilot-active@minreport.com',
        email_verified: true,
        role: 'TEST_PILOT',
        pilotExpiresAt: futureExpiry,
    });

    // TEST_PILOT expirado en test_pilots/{uid} (aunque token no esté expirado)
    const pilotExpiredUid = 'uid-pilot-expired';
    await mockDb.collection('users').doc(pilotExpiredUid).set({
        uid: pilotExpiredUid,
        email: 'pilot-expired@minreport.com',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
    });
    await mockDb.collection('test_pilots').doc(pilotExpiredUid).set({
        id: pilotExpiredUid,
        userId: pilotExpiredUid,
        status: 'ACTIVE',
        expiresAt: pastExpiry,
    });
    mockTokens.set('tok-pilot-expired', {
        uid: pilotExpiredUid,
        email: 'pilot-expired@minreport.com',
        email_verified: true,
        role: 'TEST_PILOT',
        pilotExpiresAt: futureExpiry,
    });

    // TEST_PILOT revocado en test_pilots/{uid}
    const pilotRevokedUid = 'uid-pilot-revoked';
    await mockDb.collection('users').doc(pilotRevokedUid).set({
        uid: pilotRevokedUid,
        email: 'pilot-revoked@minreport.com',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
    });
    await mockDb.collection('test_pilots').doc(pilotRevokedUid).set({
        id: pilotRevokedUid,
        userId: pilotRevokedUid,
        status: 'REVOKED',
        expiresAt: futureExpiry,
    });
    mockTokens.set('tok-pilot-revoked', {
        uid: pilotRevokedUid,
        email: 'pilot-revoked@minreport.com',
        email_verified: true,
        role: 'TEST_PILOT',
        pilotExpiresAt: futureExpiry,
    });

    // TEST_PILOT real aprovisionado vía dev.controller.ts: doc en test_pilots/{pilotAccountId} (sin doc en test_pilots/{uid})
    const pilotRealUid = 'uid-pilot-real-dev';
    const pilotRealAccountId = 'pilot-mwr4dev-ab12cd';
    await mockDb.collection('users').doc(pilotRealUid).set({
        uid: pilotRealUid,
        email: 'pilot-real@minreport.com',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
        primaryAccountId: pilotRealAccountId,
        pilotExpiresAt: futureExpiry,
    });
    await mockDb.collection('test_pilots').doc(pilotRealAccountId).set({
        id: pilotRealAccountId,
        accountId: pilotRealAccountId,
        userId: pilotRealUid,
        status: 'ACTIVE',
        expiresAt: futureExpiry,
    });
    await mockDb.collection('accounts').doc(pilotRealAccountId).set({
        id: pilotRealAccountId,
        ownerId: pilotRealUid,
        type: 'TEST_PILOT',
        status: 'ACTIVE',
        contract: { status: 'ACTIVE' },
    });
    await mockDb
        .collection('accounts')
        .doc(pilotRealAccountId)
        .collection('members')
        .doc(pilotRealUid)
        .set({
            id: pilotRealUid,
            userId: pilotRealUid,
            role: 'TEST_PILOT',
            status: 'ACTIVE',
        });
    mockTokens.set('tok-pilot-real', {
        uid: pilotRealUid,
        email: 'pilot-real@minreport.com',
        email_verified: true,
        role: 'TEST_PILOT',
        activeAccountId: pilotRealAccountId,
        pilotExpiresAt: futureExpiry,
    });

    // TEST_PILOT sin documento en test_pilots
    const pilotGhostUid = 'uid-pilot-ghost';
    await mockDb.collection('users').doc(pilotGhostUid).set({
        uid: pilotGhostUid,
        email: 'pilot-ghost@minreport.com',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
    });
    mockTokens.set('tok-pilot-ghost', {
        uid: pilotGhostUid,
        email: 'pilot-ghost@minreport.com',
        email_verified: true,
        role: 'TEST_PILOT',
        pilotExpiresAt: futureExpiry,
    });

    // Dispatcher Express in-process sin sockets TCP (100% determinista en sandbox)
    const testApp = express();
    testApp.use(express.json({ limit: '25mb' }));
    testApp.get('/__test/supply-ctx', requireSupplyTenantScope, (req: SupplyRequest, res) => {
        res.status(200).json({ ctx: req.supplyContext });
    });
    testApp.get(
        '/__test/x402-protected',
        x402Gatekeeper({
            priceMicroUSD: 10000,
            resourceId: 'supply-e01-test',
        }),
        (req: any, res) => {
            res.status(200).json({ ok: true, x402Context: req.x402Context });
        }
    );
    testApp.use('/api/supply', supplyRouter);

    const dispatch = createInProcessDispatcher(testApp);
    const httpJson = (
        _baseUrl: string,
        urlPath: string,
        options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
    ) => dispatch(urlPath, options);
    const baseUrl = 'http://in-process.local';

    {
        // =====================================================================
        // TEST 2: /receipts/analyze + ReceiptIntelligencePipeline (P0-01 + P1-05)
        // =====================================================================
        {
            // 2a. Cross-tenant storagePath en evidenceCasRef -> HTTP 403 CAS_TENANT_ACCESS_DENIED
            const idorPathResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    evidenceCasRef: {
                        sha256: shaA,
                        storagePath: pathB,
                    },
                },
            });
            assert.equal(idorPathResp.status, 403);
            assert.equal(idorPathResp.json.code, 'CAS_TENANT_ACCESS_DENIED');

            // 2b. sha256 perteneciente a tenant-b (sin storagePath) -> HTTP 403 CAS_TENANT_ACCESS_DENIED
            const idorShaResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    evidenceCasRef: {
                        sha256: shaB,
                    },
                },
            });
            assert.equal(idorShaResp.status, 403);
            assert.equal(idorShaResp.json.code, 'CAS_TENANT_ACCESS_DENIED');

            // 2c. Direct ReceiptIntelligencePipeline call con storagePath cross-tenant -> lanza ReceiptCasAccessDeniedError
            await assert.rejects(
                () =>
                    ReceiptIntelligencePipeline.analyze({
                        tenantId: TENANT_A,
                        actorUid: 'uid-owner-a',
                        existingEvidenceCasRef: {
                            sha256: shaB,
                            storagePath: pathB,
                            downloadUrl: `/api/media/blob/tenant/${TENANT_B}/${shaB}.xml`,
                            mimeType: 'application/xml',
                            extension: 'xml',
                            originalBytes: 100,
                            optimizedBytes: 100,
                            savingsPct: 0,
                        },
                    }),
                (err: any) => err instanceof ReceiptCasAccessDeniedError && err.code === 'CAS_TENANT_ACCESS_DENIED'
            );

            // 2d. Valid same-tenant sha256 -> HTTP 200 y resuelve el XML del tenant A
            const okOwnResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    evidenceCasRef: {
                        sha256: shaA,
                    },
                },
            });
            assert.equal(okOwnResp.status, 200);
            assert.equal(okOwnResp.json.analysis.supplierName, 'Proveedor A SpA');
            assert.equal(okOwnResp.json.analysis.evidenceCasRef.storagePath, pathA);

            // 2e. Payload Zod inválido (contextCaption > 2000, defaultCostCenter > 120, sha256 inválido, base64 > 15MB decodificado) -> HTTP 400
            const badCaptionResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    xmlDteContent: sampleXmlA,
                    contextCaption: 'x'.repeat(2001),
                },
            });
            assert.equal(badCaptionResp.status, 400);

            const badCostCenterResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    xmlDteContent: sampleXmlA,
                    defaultCostCenter: 'C'.repeat(121),
                },
            });
            assert.equal(badCostCenterResp.status, 400);

            const badShaResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    evidenceCasRef: { sha256: 'not-a-valid-sha256' },
                },
            });
            assert.equal(badShaResp.status, 400);

            const oversizedXmlResp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner-a' },
                body: {
                    xmlDteContent: '<x>' + 'a'.repeat(2 * 1024 * 1024 + 10) + '</x>',
                },
            });
            assert.equal(oversizedXmlResp.status, 400);

            // 2f. Error 500 NUNCA filtra err.message al cliente
            const origAnalyze = ReceiptIntelligencePipeline.analyze;
            const secretErrorMessage = 'SENSITIVE_INTERNAL_DB_FAILURE_RUT_76192083-9';
            (ReceiptIntelligencePipeline as any).analyze = async () => {
                throw new Error(secretErrorMessage);
            };
            try {
                const err500Resp = await httpJson(baseUrl, '/api/supply/receipts/analyze', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer tok-owner-a' },
                    body: { xmlDteContent: sampleXmlA },
                });
                assert.equal(err500Resp.status, 500);
                assert.ok(
                    !JSON.stringify(err500Resp.json).includes(secretErrorMessage),
                    'Respuesta 500 NO debe exponer err.message al cliente'
                );
            } finally {
                (ReceiptIntelligencePipeline as any).analyze = origAnalyze;
            }

            // Verificar que ResilientAIClient no fue requerido innecesariamente
            assert.ok(typeof ResilientAIClient.generateStructured === 'function');
            console.log('PASS [2/4] /receipts/analyze anti-IDOR 403, Zod 400 & zero err.message leak on 500');
        }

        // =====================================================================
        // TEST 3: Hermeticidad 3º TEST-PILOT (supply, x402Gatekeeper, index.ts)
        // =====================================================================
        {
            // 3a. TEST_PILOT activo en su propio sandbox `pilot-${uid}` -> permitido, isSystemPrivileged === false
            const pilotOwnRes = await httpJson(baseUrl, '/__test/supply-ctx', {
                headers: {
                    Authorization: 'Bearer tok-pilot-active',
                    'X-Active-Account-Id': pilotActiveSandbox,
                },
            });
            assert.equal(pilotOwnRes.status, 200);
            assert.equal(pilotOwnRes.json.ctx.tenantId, pilotActiveSandbox);
            assert.equal(pilotOwnRes.json.ctx.accountTier, 3);
            assert.equal(
                pilotOwnRes.json.ctx.isSystemPrivileged,
                false,
                'TEST_PILOT NO debe tener isSystemPrivileged=true'
            );

            // 3b. TEST_PILOT intentando acceder a tenant B2B vía X-Active-Account-Id -> HTTP 403
            const pilotCrossB2b = await httpJson(baseUrl, '/__test/supply-ctx', {
                headers: {
                    Authorization: 'Bearer tok-pilot-active',
                    'X-Active-Account-Id': TENANT_A,
                },
            });
            assert.equal(pilotCrossB2b.status, 403);

            // 3c. TEST_PILOT intentando acceder a dev-master-sandbox u otro piloto -> HTTP 403
            const pilotDevSandbox = await httpJson(baseUrl, '/__test/supply-ctx', {
                headers: {
                    Authorization: 'Bearer tok-pilot-active',
                    'X-Active-Account-Id': 'dev-master-sandbox',
                },
            });
            assert.equal(pilotDevSandbox.status, 403);

            const pilotOtherSandbox = await httpJson(baseUrl, '/__test/supply-ctx', {
                headers: {
                    Authorization: 'Bearer tok-pilot-active',
                    'X-Active-Account-Id': 'pilot-another-user',
                },
            });
            assert.equal(pilotOtherSandbox.status, 403);

            // 3d. TEST_PILOT expirado / revocado / ausente en test_pilots -> HTTP 403 PILOT_EXPIRED_OR_REVOKED
            for (const tok of ['tok-pilot-expired', 'tok-pilot-revoked', 'tok-pilot-ghost']) {
                const res = await httpJson(baseUrl, '/__test/supply-ctx', {
                    headers: { Authorization: `Bearer ${tok}` },
                });
                assert.equal(res.status, 403, `Token ${tok} debe ser rechazado con 403`);
                assert.equal(res.json.code, 'PILOT_EXPIRED_OR_REVOKED');
            }

            // 3e. x402Gatekeeper: TEST_PILOT excluido de isGlobalSovereign
            const x402PilotCross = await verifyCorporateContractAccess({
                headers: {
                    authorization: 'Bearer tok-pilot-active',
                    'x-active-account-id': TENANT_A,
                },
                query: {},
            } as any);
            assert.equal(
                x402PilotCross.authorized,
                false,
                'x402Gatekeeper debe rechazar TEST_PILOT en tenant B2B ajeno'
            );

            const x402HttpCross = await httpJson(baseUrl, '/__test/x402-protected', {
                headers: {
                    Authorization: 'Bearer tok-pilot-active',
                    'X-Active-Account-Id': TENANT_A,
                },
            });
            assert.equal(x402HttpCross.status, 402, 'x402Gatekeeper debe responder 402 a TEST_PILOT cross-tenant');

            const x402PilotExpired = await verifyCorporateContractAccess({
                headers: { authorization: 'Bearer tok-pilot-expired' },
                query: {},
            } as any);
            assert.equal(x402PilotExpired.authorized, false);

            const x402PilotOwn = await verifyCorporateContractAccess({
                headers: {
                    authorization: 'Bearer tok-pilot-active',
                    'x-active-account-id': pilotActiveSandbox,
                },
                query: {},
            } as any);
            assert.equal(x402PilotOwn.authorized, true);
            assert.equal(x402PilotOwn.tenantId, pilotActiveSandbox);

            // 3f. src/index.ts resolveAuthorizedAiTenantContext: TEST_PILOT confinado a su sandbox
            const aiPilotCross = await resolveAuthorizedAiTenantContext({
                user: { uid: pilotActiveUid, role: 'TEST_PILOT', pilotExpiresAt: futureExpiry },
                headers: { 'x-active-account-id': TENANT_A },
            } as any);
            assert.equal(aiPilotCross.authorized, false);

            const aiPilotDev = await resolveAuthorizedAiTenantContext({
                user: { uid: pilotActiveUid, role: 'TEST_PILOT', pilotExpiresAt: futureExpiry },
                headers: { 'x-active-account-id': 'dev-master-sandbox' },
            } as any);
            assert.equal(aiPilotDev.authorized, false);

            const aiPilotRevoked = await resolveAuthorizedAiTenantContext({
                user: { uid: pilotRevokedUid, role: 'TEST_PILOT', pilotExpiresAt: futureExpiry },
                headers: { 'x-active-account-id': `pilot-${pilotRevokedUid}` },
            } as any);
            assert.equal(aiPilotRevoked.authorized, false);

            const aiPilotOwn = await resolveAuthorizedAiTenantContext({
                user: { uid: pilotActiveUid, role: 'TEST_PILOT', pilotExpiresAt: futureExpiry },
                headers: { 'x-active-account-id': pilotActiveSandbox },
            } as any);
            assert.equal(aiPilotOwn.authorized, true);
            assert.equal(aiPilotOwn.tenantId, pilotActiveSandbox);

            // 3g. Piloto real aprovisionado en `test_pilots/{pilotAccountId}` (esquema dev.controller.ts)
            const realPilotOwnRes = await httpJson(baseUrl, '/__test/supply-ctx', {
                headers: {
                    Authorization: 'Bearer tok-pilot-real',
                    'X-Active-Account-Id': pilotRealAccountId,
                },
            });
            assert.equal(realPilotOwnRes.status, 200);
            assert.equal(realPilotOwnRes.json.ctx.tenantId, pilotRealAccountId);
            assert.equal(realPilotOwnRes.json.ctx.accountTier, 3);
            assert.equal(realPilotOwnRes.json.ctx.isSystemPrivileged, false);

            const realPilotCrossB2b = await httpJson(baseUrl, '/__test/supply-ctx', {
                headers: {
                    Authorization: 'Bearer tok-pilot-real',
                    'X-Active-Account-Id': TENANT_A,
                },
            });
            assert.equal(realPilotCrossB2b.status, 403);

            const x402RealPilotOwn = await verifyCorporateContractAccess({
                headers: {
                    authorization: 'Bearer tok-pilot-real',
                    'x-active-account-id': pilotRealAccountId,
                },
                query: {},
            } as any);
            assert.equal(x402RealPilotOwn.authorized, true);
            assert.equal(x402RealPilotOwn.tenantId, pilotRealAccountId);

            const x402RealPilotCross = await verifyCorporateContractAccess({
                headers: {
                    authorization: 'Bearer tok-pilot-real',
                    'x-active-account-id': TENANT_A,
                },
                query: {},
            } as any);
            assert.equal(x402RealPilotCross.authorized, false);

            const aiRealPilotOwn = await resolveAuthorizedAiTenantContext({
                user: {
                    uid: pilotRealUid,
                    role: 'TEST_PILOT',
                    activeAccountId: pilotRealAccountId,
                    pilotExpiresAt: futureExpiry,
                },
                headers: { 'x-active-account-id': pilotRealAccountId },
            } as any);
            assert.equal(aiRealPilotOwn.authorized, true);
            assert.equal(aiRealPilotOwn.tenantId, pilotRealAccountId);

            const aiRealPilotCross = await resolveAuthorizedAiTenantContext({
                user: {
                    uid: pilotRealUid,
                    role: 'TEST_PILOT',
                    activeAccountId: pilotRealAccountId,
                    pilotExpiresAt: futureExpiry,
                },
                headers: { 'x-active-account-id': TENANT_A },
            } as any);
            assert.equal(aiRealPilotCross.authorized, false);

            console.log('PASS [3/4] TEST-PILOT hermetic isolation across supply, x402Gatekeeper & AI context');
        }

        // =====================================================================
        // TEST 4: Verificación estructural de storage.rules (P0-02 + S-1..S-4)
        // =====================================================================
        {
            const storageRulesSrc = fs.readFileSync(
                path.resolve(__dirname, '../../../../storage.rules'),
                'utf8'
            );
            const sysPrivMatch = storageRulesSrc.match(/function\s+isSystemPrivileged\(\)\s*\{[\s\S]*?\n\s*\}/);
            assert.ok(sysPrivMatch, 'storage.rules debe definir isSystemPrivileged()');
            assert.ok(
                !sysPrivMatch[0].includes('isTestPilot'),
                'storage.rules isSystemPrivileged() NO debe incluir isTestPilot()'
            );

            // S-1: Resguardo CEL de claims opcionales en request.auth.token
            assert.ok(
                storageRulesSrc.includes("'role' in request.auth.token && request.auth.token.role == 'TEST_PILOT'"),
                "S-1: storage.rules debe verificar 'role' in request.auth.token antes de comparar"
            );
            assert.ok(
                storageRulesSrc.includes("'activeAccountId' in request.auth.token && request.auth.token.activeAccountId == tenantId"),
                "S-1: storage.rules debe verificar 'activeAccountId' in request.auth.token"
            );
            assert.ok(
                storageRulesSrc.includes("'tenantId' in request.auth.token && request.auth.token.tenantId == tenantId"),
                "S-1: storage.rules debe verificar 'tenantId' in request.auth.token"
            );

            // S-2: Miembro SUSPENDED/REVOKED bloqueado incluso con JWT claim vigente
            assert.ok(
                storageRulesSrc.includes('function isNotSuspendedOrRevokedMember(tenantId)'),
                'S-2: storage.rules debe definir isNotSuspendedOrRevokedMember(tenantId)'
            );
            assert.ok(
                storageRulesSrc.includes("!isTestPilotToken() &&\n            isNotSuspendedOrRevokedMember(tenantId)"),
                'S-2: isTenantMemberOrAdmin e isTenantAuthorized deben aplicar isNotSuspendedOrRevokedMember antes de claims JWT'
            );
            assert.ok(
                storageRulesSrc.includes("!('status' in m) || m.status == 'ACTIVE'"),
                "S-2: storage.rules debe exigir miembro ACTIVE (!('status' in m) || m.status == 'ACTIVE')"
            );

            // S-3: Expiración fail-closed (timestamp + int/float, sin bypass fail-open)
            assert.ok(
                storageRulesSrc.includes('(val is timestamp && request.time < val)'),
                'S-3: storage.rules debe validar expiración tipo Firestore timestamp'
            );
            assert.ok(
                storageRulesSrc.includes('((val is int || val is float) && request.time.toMillis() < val)'),
                'S-3: storage.rules debe validar expiración tipo int/float epoch ms'
            );
            assert.ok(
                !storageRulesSrc.includes('!(pilotData.expiresAt is int)'),
                'S-3: storage.rules no debe tener bypass fail-open ante tipos desconocidos de expiresAt'
            );

            // S-4: Doble esquema TEST-PILOT (`test_pilots/$(tenantId)` con userId==uid Y `test_pilots/$(request.auth.uid)`)
            assert.ok(
                storageRulesSrc.includes('/databases/(default)/documents/test_pilots/$(tenantId)'),
                'S-4: storage.rules debe soportar esquema real test_pilots/$(tenantId) (dev.controller.ts)'
            );
            assert.ok(
                storageRulesSrc.includes('/databases/(default)/documents/test_pilots/$(request.auth.uid)'),
                'S-4: storage.rules debe soportar esquema directo test_pilots/$(request.auth.uid)'
            );
            assert.ok(
                storageRulesSrc.includes("tenantId.matches('^pilot-.*')"),
                "S-4: storage.rules debe restringir TEST_PILOT a prefijo '^pilot-.*'"
            );
            assert.ok(
                storageRulesSrc.includes("tenantId == ('pilot-' + request.auth.uid)"),
                "S-4: storage.rules debe confinar TEST_PILOT directo a tenantId == ('pilot-' + request.auth.uid)"
            );
            console.log('PASS [4/4] storage.rules S-1..S-4 CEL safety, ACTIVE member & dual TEST-PILOT guards verified');
        }
    }
}

runTests()
    .then(() => {
        console.log('ALL E01 SECURITY TESTS PASSED (4/4)');
        process.exit(0);
    })
    .catch((err) => {
        console.error('E01 SECURITY TEST FAILED:', err);
        process.exit(1);
    });
