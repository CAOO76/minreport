import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { db } from '../../config/firebase';
import { AuditLedger, type LedgerEntry } from '../audit-ledger';
import { buildMediaRegistryDocId, CasStorageService } from '../media/CasStorageService';
import { m2mRateLimiter } from '../../middleware/rateLimiter';
import { x402Gatekeeper, type X402AuthenticatedRequest } from '../../middleware/x402Gatekeeper';

interface MockHttpCapture {
    statusCode: number;
    headers: Record<string, string>;
    jsonBody: any;
    res: Response;
}

function createMockResponse(): MockHttpCapture {
    const capture: MockHttpCapture = {
        statusCode: 200,
        headers: {},
        jsonBody: null,
        res: null as unknown as Response,
    };

    const resObj: any = {
        setHeader(name: string, value: string) {
            capture.headers[name.toLowerCase()] = String(value);
            return resObj;
        },
        status(code: number) {
            capture.statusCode = code;
            return resObj;
        },
        json(payload: any) {
            capture.jsonBody = payload;
            return resObj;
        },
        end() {
            return resObj;
        },
    };

    capture.res = resObj as Response;
    return capture;
}

async function testMediaRegistryIsolationAndLegacyFallback(): Promise<void> {
    const sampleSha = 'a'.repeat(64);

    const tenantADocId = buildMediaRegistryDocId(sampleSha, 'TENANT_PRIVATE', 'tenantA');
    const tenantBDocId = buildMediaRegistryDocId(sampleSha, 'TENANT_PRIVATE', 'tenantB');
    const globalCatalogDocId = buildMediaRegistryDocId(sampleSha, 'GLOBAL_CATALOG');
    const globalOemDocId = buildMediaRegistryDocId(sampleSha, 'GLOBAL_OEM');
    const isoSymbologyDocId = buildMediaRegistryDocId(sampleSha, 'ISO_SYMBOLOGY');

    assert.equal(tenantADocId, `tenant_tenantA_${sampleSha}`);
    assert.equal(tenantBDocId, `tenant_tenantB_${sampleSha}`);
    assert.notEqual(tenantADocId, tenantBDocId, 'tenantA y tenantB no deben colisionar en media_registry');

    assert.equal(globalCatalogDocId, `global_catalog_${sampleSha}`);
    assert.equal(globalOemDocId, `global_oem_${sampleSha}`);
    assert.equal(isoSymbologyDocId, `iso_symbology_${sampleSha}`);
    assert.notEqual(tenantADocId, globalCatalogDocId);
    assert.notEqual(globalCatalogDocId, isoSymbologyDocId);

    assert.throws(
        () => buildMediaRegistryDocId(sampleSha, 'TENANT_PRIVATE', ''),
        /tenantId es obligatorio/
    );

    // Verificar fallback de solo lectura a `.doc(sha256)` sin fuga cross-tenant
    const originalCollection = db.collection.bind(db);
    const docsInMemory = new Map<string, Record<string, any>>([
        [
            sampleSha,
            {
                sha256: sampleSha,
                scope: 'TENANT_PRIVATE',
                tenantId: 'tenantA',
                profile: 'IMAGE_FIELD_EVIDENCE',
                mimeType: 'image/webp',
                extension: 'webp',
                originalBytes: 2048,
                optimizedBytes: 1024,
                savingsRatio: 0.5,
                storagePath: `cas_blobs/tenants/tenantA/${sampleSha}.webp`,
                downloadUrl: `/api/media/blob/tenant/tenantA/${sampleSha}.webp`,
                createdAt: '2026-11-12T00:00:00.000Z',
            },
        ],
    ]);

    (db as any).collection = (name: string) => {
        if (name === 'media_registry') {
            return {
                doc: (id: string) => ({
                    async get() {
                        const found = docsInMemory.get(id);
                        return {
                            exists: Boolean(found),
                            id,
                            data: () => found,
                        };
                    },
                }),
            };
        }
        return originalCollection(name);
    };

    try {
        const hitTenantA = await CasStorageService.preflightCheck(sampleSha, 'TENANT_PRIVATE', 'tenantA');
        assert.ok(hitTenantA, 'Fallback legacy .doc(sha256) debe funcionar para el mismo tenantA');
        assert.equal(hitTenantA.sha256, sampleSha);

        const hitTenantB = await CasStorageService.preflightCheck(sampleSha, 'TENANT_PRIVATE', 'tenantB');
        assert.equal(hitTenantB, null, 'Fallback legacy .doc(sha256) debe bloquear lectura cruzada desde tenantB');

        const hitGlobal = await CasStorageService.preflightCheck(sampleSha, 'GLOBAL_OEM');
        assert.equal(hitGlobal, null, 'Blob privado legacy no debe filtrarse a GLOBAL_OEM');
    } finally {
        (db as any).collection = originalCollection;
    }
}

async function testM2mRateLimiterThreshold(): Promise<void> {
    const testIp = '198.51.100.42';
    const agentAlpha = 'agent-rate-alpha';
    const agentBeta = 'agent-rate-beta';

    for (let i = 1; i <= 120; i++) {
        let nextCalled = false;
        const req = {
            ip: testIp,
            headers: { 'x-agent-id': agentAlpha },
            socket: { remoteAddress: testIp },
        } as unknown as Request;
        const mock = createMockResponse();

        m2mRateLimiter(req, mock.res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true, `Solicitud #${i} dentro del umbral (120/60s) debía pasar`);
        assert.equal(mock.statusCode, 200);
    }

    // Solicitud #121 para la misma dupla IP + x-agent-id debe bloquearse con HTTP 429
    {
        let nextCalled = false;
        const req = {
            ip: testIp,
            headers: { 'x-agent-id': agentAlpha },
            socket: { remoteAddress: testIp },
        } as unknown as Request;
        const mock = createMockResponse();

        m2mRateLimiter(req, mock.res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false, 'Solicitud #121 debía ser bloqueada por m2mRateLimiter');
        assert.equal(mock.statusCode, 429);
        assert.equal(mock.jsonBody?.error, 'TOO_MANY_REQUESTS');
        assert.ok(Number(mock.headers['retry-after']) >= 1);
    }

    // Otro x-agent-id desde la misma IP mantiene su propio bucket aislado
    {
        let nextCalled = false;
        const req = {
            ip: testIp,
            headers: { 'x-agent-id': agentBeta },
            socket: { remoteAddress: testIp },
        } as unknown as Request;
        const mock = createMockResponse();

        m2mRateLimiter(req, mock.res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true, 'Agente distinto en la misma IP no debe sufrir bloqueo cruzado');
    }
}

async function testX402GatekeeperSecurityInvariants(): Promise<void> {
    const originalCollection = db.collection.bind(db);
    const originalRunTransaction = db.runTransaction.bind(db);
    const originalAuditRecord = AuditLedger.record.bind(AuditLedger);
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowHmac = process.env.ALLOW_TEST_X402_HMAC;
    const prevHmacSecret = process.env.X402_HMAC_SECRET;

    let firestoreOps = 0;
    const recordedAuditEntries: LedgerEntry[] = [];

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

    const walletsStore = new Map<string, Record<string, any>>([
        [
            'agent-sec-01',
            {
                status: 'ACTIVE',
                tenantId: 'tenant-m2m-alpha',
                balanceMicroUsd: 250_000,
                publicKeyPem,
            },
        ],
    ]);
    const receiptsStore = new Map<string, Record<string, any>>();

    (db as any).collection = (name: string) => {
        firestoreOps += 1;
        if (name === 'm2m_wallets') {
            return {
                doc: (id: string) => ({
                    id,
                    async get() {
                        const data = walletsStore.get(id);
                        return { exists: Boolean(data), data: () => data };
                    },
                }),
            };
        }
        if (name === 'x402_receipts') {
            return {
                doc: (id: string) => ({
                    id,
                    async get() {
                        const data = receiptsStore.get(id);
                        return { exists: Boolean(data), data: () => data };
                    },
                }),
            };
        }
        if (name === 'accounts') {
            return {
                doc: (id: string) => ({
                    id,
                    async get() {
                        return { exists: true, data: () => ({ id, type: 'ENTERPRISE', isEduSandbox: false }) };
                    },
                    collection: () => ({
                        doc: () => ({
                            async set() {},
                        }),
                    }),
                }),
            };
        }
        return originalCollection(name);
    };

    (db as any).runTransaction = async (updateFn: (tx: any) => Promise<any>) => {
        firestoreOps += 1;
        const tx = {
            async get(ref: { id: string }) {
                if (walletsStore.has(ref.id)) {
                    const d = walletsStore.get(ref.id);
                    return { exists: true, data: () => d };
                }
                if (receiptsStore.has(ref.id)) {
                    const d = receiptsStore.get(ref.id);
                    return { exists: true, data: () => d };
                }
                return { exists: false, data: () => undefined };
            },
            update(ref: { id: string }, patch: Record<string, any>) {
                const curr = walletsStore.get(ref.id) || {};
                walletsStore.set(ref.id, { ...curr, ...patch });
            },
            set(ref: { id: string }, payload: Record<string, any>) {
                receiptsStore.set(ref.id, payload);
            },
        };
        return updateFn(tx);
    };

    AuditLedger.record = async (entry: LedgerEntry): Promise<string> => {
        recordedAuditEntries.push(entry);
        return `mock_ledger_${recordedAuditEntries.length}`;
    };

    const middleware = x402Gatekeeper({
        priceMicroUSD: 25_000,
        resourceId: 'mining-telemetry-feed',
    });

    try {
        // 3a) Petición anónima sin cabeceras M2M -> 402 y CERO escrituras/lecturas a Firestore o AuditLedger
        firestoreOps = 0;
        recordedAuditEntries.length = 0;
        {
            let nextCalled = false;
            const req = {
                ip: '203.0.113.10',
                path: '/api/m2m/data-feed',
                originalUrl: '/api/m2m/data-feed',
                headers: {},
                query: {},
                socket: { remoteAddress: '203.0.113.10' },
            } as unknown as X402AuthenticatedRequest;
            const mock = createMockResponse();

            await middleware(req, mock.res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, false);
            assert.equal(mock.statusCode, 402);
            assert.equal(mock.jsonBody?.reason, 'MISSING_PAYMENT_OR_ACTIVE_CONTRACT');
            assert.ok(mock.headers['www-authenticate']?.includes('x402'));
            assert.ok(mock.headers['payment-required']);
            assert.equal(
                recordedAuditEntries.length,
                0,
                'Descubrimiento anónimo HTTP 402 NO debe escribir en AuditLedger'
            );
            assert.equal(
                firestoreOps,
                0,
                'Descubrimiento anónimo HTTP 402 NO debe tocar Firestore'
            );
        }

        // 3b) Fallback simétrico HMAC global debe rechazarse cuando ALLOW_TEST_X402_HMAC no está activo
        process.env.NODE_ENV = 'test';
        delete process.env.ALLOW_TEST_X402_HMAC;
        process.env.X402_HMAC_SECRET = 'shared-symmetric-secret-for-negative-test';
        recordedAuditEntries.length = 0;
        {
            const nowTs = Date.now();
            const nonce = 'nonce_hmac_blocked_0001';
            const resource = 'mining-telemetry-feed';
            const amountMicroUsd = 25_000;
            const canonicalPipeMsg = `agent-sec-01|${resource}|${amountMicroUsd}|${nonce}|${nowTs}`;
            const validHmacSig = crypto
                .createHmac('sha256', process.env.X402_HMAC_SECRET)
                .update(canonicalPipeMsg, 'utf8')
                .digest('hex');

            const proofHeader = Buffer.from(
                JSON.stringify({
                    agentId: 'agent-sec-01',
                    resource,
                    amountMicroUsd,
                    nonce,
                    timestamp: nowTs,
                    signature: validHmacSig,
                    scheme: 'HMAC-SHA256',
                }),
                'utf8'
            ).toString('base64');

            let nextCalled = false;
            const req = {
                ip: '203.0.113.11',
                path: '/api/m2m/data-feed',
                originalUrl: '/api/m2m/data-feed',
                headers: { 'x-402-token': proofHeader },
                query: {},
                socket: { remoteAddress: '203.0.113.11' },
            } as unknown as X402AuthenticatedRequest;
            const mock = createMockResponse();

            await middleware(req, mock.res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, false, 'HMAC global debe ser rechazado sin ALLOW_TEST_X402_HMAC=true');
            assert.equal(mock.statusCode, 402);
            assert.equal(mock.jsonBody?.reason, 'X402_INVALID_CRYPTOGRAPHIC_SIGNATURE');
            assert.equal(
                recordedAuditEntries.length,
                1,
                'Intento fallido de agente identificado SÍ debe registrarse en AuditLedger'
            );
            assert.equal(recordedAuditEntries[0].actorUid, 'm2m:agent-sec-01');
            assert.equal(recordedAuditEntries[0].tenantId, 'tenant-m2m-alpha');
        }

        // 3c) Incluso con ALLOW_TEST_X402_HMAC='true', en NODE_ENV='production' HMAC sigue bloqueado
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TEST_X402_HMAC = 'true';
        recordedAuditEntries.length = 0;
        {
            const nowTs = Date.now();
            const nonce = 'nonce_hmac_prod_blocked_0002';
            const resource = 'mining-telemetry-feed';
            const amountMicroUsd = 25_000;
            const canonicalPipeMsg = `agent-sec-01|${resource}|${amountMicroUsd}|${nonce}|${nowTs}`;
            const validHmacSig = crypto
                .createHmac('sha256', process.env.X402_HMAC_SECRET!)
                .update(canonicalPipeMsg, 'utf8')
                .digest('hex');

            let nextCalled = false;
            const req = {
                ip: '203.0.113.12',
                path: '/api/m2m/data-feed',
                originalUrl: '/api/m2m/data-feed',
                headers: {
                    'x-402-token': JSON.stringify({
                        agentId: 'agent-sec-01',
                        resource,
                        amountMicroUsd,
                        nonce,
                        timestamp: nowTs,
                        signature: validHmacSig,
                    }),
                },
                query: {},
                socket: { remoteAddress: '203.0.113.12' },
            } as unknown as X402AuthenticatedRequest;
            const mock = createMockResponse();

            await middleware(req, mock.res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, false, 'HMAC global jamás debe aceptarse en producción');
            assert.equal(mock.statusCode, 402);
            assert.equal(mock.jsonBody?.reason, 'X402_INVALID_CRYPTOGRAPHIC_SIGNATURE');
        }

        // 3d) Firma asimétrica Ed25519 válida por agente liquida y autoriza en producción
        delete process.env.ALLOW_TEST_X402_HMAC;
        recordedAuditEntries.length = 0;
        {
            const nowTs = Date.now();
            const nonce = 'nonce_ed25519_valid_0003';
            const resource = 'mining-telemetry-feed';
            const amountMicroUsd = 25_000;
            const canonicalPipeMsg = `agent-sec-01|${resource}|${amountMicroUsd}|${nonce}|${nowTs}`;
            const ed25519SigB64 = crypto
                .sign(null, Buffer.from(canonicalPipeMsg, 'utf8'), privateKey)
                .toString('base64');

            let nextCalled = false;
            const req = {
                ip: '203.0.113.13',
                path: '/api/m2m/data-feed',
                originalUrl: '/api/m2m/data-feed',
                headers: {
                    'payment-signature': Buffer.from(
                        JSON.stringify({
                            agentId: 'agent-sec-01',
                            resource,
                            amountMicroUsd,
                            nonce,
                            timestamp: nowTs,
                            signature: ed25519SigB64,
                            scheme: 'ED25519',
                        }),
                        'utf8'
                    ).toString('base64'),
                },
                query: {},
                socket: { remoteAddress: '203.0.113.13' },
            } as unknown as X402AuthenticatedRequest;
            const mock = createMockResponse();

            await middleware(req, mock.res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, true, 'Firma asimétrica Ed25519 válida debe autorizar acceso M2M');
            assert.equal(req.x402Context?.mode, 'M2M_WALLET');
            assert.equal(req.x402Context?.agentId, 'agent-sec-01');
            assert.equal(walletsStore.get('agent-sec-01')?.balanceMicroUsd, 225_000);
            assert.equal(recordedAuditEntries.length, 1);
            assert.equal(recordedAuditEntries[0].action, 'X402_M2M_PAYMENT_SETTLED');
        }
    } finally {
        (db as any).collection = originalCollection;
        (db as any).runTransaction = originalRunTransaction;
        AuditLedger.record = originalAuditRecord;
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
        if (prevAllowHmac === undefined) delete process.env.ALLOW_TEST_X402_HMAC;
        else process.env.ALLOW_TEST_X402_HMAC = prevAllowHmac;
        if (prevHmacSecret === undefined) delete process.env.X402_HMAC_SECRET;
        else process.env.X402_HMAC_SECRET = prevHmacSecret;
    }
}

async function main(): Promise<void> {
    await testMediaRegistryIsolationAndLegacyFallback();
    console.log('✓ [1/3] buildMediaRegistryDocId + aislamiento multi-tenant CAS + fallback legacy OK');

    await testM2mRateLimiterThreshold();
    console.log('✓ [2/3] m2mRateLimiter (120 req/60s por IP + x-agent-id -> HTTP 429) OK');

    await testX402GatekeeperSecurityInvariants();
    console.log('✓ [3/3] x402Gatekeeper (402 anónimo 0-writes + bloqueo HMAC global + Ed25519) OK');

    console.log('✅ BLOQUE 1.1 SECURITY SUITE: TODAS LAS ASERCIONES APROBADAS');
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ FALLO EN BLOQUE 1.1 SECURITY SUITE:', err);
        process.exit(1);
    });
