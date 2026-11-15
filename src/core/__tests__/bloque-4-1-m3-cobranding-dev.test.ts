/**
 * Suite Sandbox-Safe — Bloque Atómico 4.1 (MINREPORT)
 * - Co-Branding CAS (`TenantLogoDescriptorSchema`, autorización `SYMBOLOGY_MASTER` B2B, `sessionScope`)
 * - Identidad Maestra MINREPORT exclusiva `1º DEV` (`#C68346`, HITL `"ACTUALIZAR"`, purga `svgDataUris`, CAS `sharp`, `AuditLedger`)
 * - Endurecimiento `/dev` (`devLogin` 403, `impersonateClient` 410, `DevChallengeService` sin `clientToken` plaintext)
 * - Guardrails estáticos M3 / F3 en `web/src/**`
 *
 * IMPORTANTE (macOS Sandbox): Registra stubs en `require.cache` ANTES de importar módulos
 * que carguen `config/firebase` o `firebase-admin`, evitando inicializar gRPC/Keychain (`SecItemCopyMatching`).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.DEV_ROOT_PASSWORD ||= 'TestDevRootPassword2026!';
process.env.GCP_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-sandbox-test';
process.env.FIREBASE_STORAGE_BUCKET ||= 'minreport-sandbox-test.firebasestorage.app';

// ---------------------------------------------------------------------------
// Stubs en memoria para Firebase Admin / Firestore / Auth / Storage
// ---------------------------------------------------------------------------
const DELETE_SENTINEL = Symbol('FieldValue.delete');
const SERVER_TIMESTAMP_SENTINEL = Symbol('FieldValue.serverTimestamp');

class IncrementSentinel {
    constructor(public readonly operand: number) {}
}

class ArrayUnionSentinel {
    constructor(public readonly elements: unknown[]) {}
}

const mockFieldValue = {
    delete: () => DELETE_SENTINEL,
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
    increment: (n: number) => new IncrementSentinel(n),
    arrayUnion: (...elements: unknown[]) => new ArrayUnionSentinel(elements),
};

const mockTimestamp = {
    now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
    fromDate: (d: Date) => ({ toMillis: () => d.getTime(), toDate: () => d }),
};

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const dbSetCalls: Array<{ path: string; rawPayload: Record<string, any>; merge: boolean }> = [];
const storageFiles = new Map<string, { buffer: Buffer; metadata: Record<string, any> }>();
const authUsersByUid = new Map<string, any>();
const authUsersByEmail = new Map<string, any>();
const verifyIdTokenMap = new Map<string, Record<string, any>>();
const customClaimsCalls: Array<{ uid: string; claims: Record<string, any> }> = [];
const customTokenCalls: Array<{ uid: string; claims?: Record<string, any> }> = [];
let autoDocSeq = 0;

function resetMocks(): void {
    dbCollections.clear();
    dbSetCalls.length = 0;
    storageFiles.clear();
    authUsersByUid.clear();
    authUsersByEmail.clear();
    verifyIdTokenMap.clear();
    customClaimsCalls.length = 0;
    customTokenCalls.length = 0;
    autoDocSeq = 0;
}

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
    let col = dbCollections.get(colPath);
    if (!col) {
        col = new Map();
        dbCollections.set(colPath, col);
    }
    return col;
}

function clonePlain(val: unknown): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'symbol' || val instanceof IncrementSentinel || val instanceof ArrayUnionSentinel) {
        return val;
    }
    if (Buffer.isBuffer(val)) return Buffer.from(val);
    if (val instanceof Date) return new Date(val.getTime());
    if (Array.isArray(val)) return val.map((item) => clonePlain(item));
    if (typeof val === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(val as Record<string, any>)) {
            out[k] = clonePlain(v);
        }
        return out;
    }
    return val;
}

function isPlainObject(val: unknown): val is Record<string, any> {
    if (!val || typeof val !== 'object') return false;
    if (
        Array.isArray(val) ||
        val instanceof Date ||
        Buffer.isBuffer(val) ||
        val instanceof IncrementSentinel ||
        val instanceof ArrayUnionSentinel
    ) {
        return false;
    }
    const proto = Object.getPrototypeOf(val);
    return proto === Object.prototype || proto === null;
}

function resolveSentinelValue(existingVal: unknown, incomingVal: unknown): { deleted: boolean; value?: any } {
    if (incomingVal === DELETE_SENTINEL) {
        return { deleted: true };
    }
    if (incomingVal === SERVER_TIMESTAMP_SENTINEL) {
        return { deleted: false, value: Date.now() };
    }
    if (incomingVal instanceof IncrementSentinel) {
        const base = typeof existingVal === 'number' ? existingVal : 0;
        return { deleted: false, value: base + incomingVal.operand };
    }
    if (incomingVal instanceof ArrayUnionSentinel) {
        const prev = Array.isArray(existingVal) ? [...existingVal] : [];
        for (const el of incomingVal.elements) {
            if (!prev.includes(el)) prev.push(clonePlain(el));
        }
        return { deleted: false, value: prev };
    }
    if (isPlainObject(incomingVal)) {
        const target = isPlainObject(existingVal) ? clonePlain(existingVal) : {};
        for (const [k, v] of Object.entries(incomingVal)) {
            const resolved = resolveSentinelValue(target[k], v);
            if (resolved.deleted) {
                delete target[k];
            } else {
                target[k] = resolved.value;
            }
        }
        return { deleted: false, value: target };
    }
    return { deleted: false, value: clonePlain(incomingVal) };
}

function setNestedField(target: Record<string, any>, dottedKey: string, val: unknown): void {
    const parts = dottedKey.split('.');
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!isPlainObject(cursor[seg])) {
            cursor[seg] = {};
        }
        cursor = cursor[seg];
    }
    const last = parts[parts.length - 1];
    const resolved = resolveSentinelValue(cursor[last], val);
    if (resolved.deleted) {
        delete cursor[last];
    } else {
        cursor[last] = resolved.value;
    }
}

function getNestedField(target: Record<string, any>, dottedKey: string): unknown {
    const parts = dottedKey.split('.');
    let cursor: any = target;
    for (const seg of parts) {
        if (cursor == null || typeof cursor !== 'object') return undefined;
        cursor = cursor[seg];
    }
    return cursor;
}

function createDocRef(colPath: string, docId: string): any {
    return {
        id: docId,
        path: `${colPath}/${docId}`,
        collection(subName: string) {
            return createCollectionRef(`${colPath}/${docId}/${subName}`);
        },
        async get() {
            const col = getCollectionMap(colPath);
            const data = col.get(docId);
            return {
                id: docId,
                exists: Boolean(data),
                data: () => (data ? clonePlain(data) : undefined),
            };
        },
        async set(payload: Record<string, any>, options?: { merge?: boolean }) {
            const col = getCollectionMap(colPath);
            const merge = Boolean(options?.merge);
            dbSetCalls.push({ path: `${colPath}/${docId}`, rawPayload: payload, merge });
            const current = merge && col.has(docId) ? clonePlain(col.get(docId)) : {};
            const resolved = resolveSentinelValue(current, payload);
            col.set(docId, resolved.value || {});
        },
        async update(patch: Record<string, any>) {
            const col = getCollectionMap(colPath);
            const current = col.has(docId) ? clonePlain(col.get(docId)) : {};
            for (const [key, val] of Object.entries(patch)) {
                setNestedField(current, key, val);
            }
            col.set(docId, current);
        },
        async delete() {
            getCollectionMap(colPath).delete(docId);
        },
    };
}

interface FilterSpec {
    field: string;
    op: string;
    value: unknown;
}

function createQueryRef(
    colPath: string,
    filters: FilterSpec[] = [],
    limitCount?: number,
    orderSpec?: { field: string; dir: 'asc' | 'desc' }
): any {
    const evaluate = () => {
        const col = getCollectionMap(colPath);
        let entries = Array.from(col.entries()).filter(([, docData]) => {
            for (const f of filters) {
                const candidate = getNestedField(docData, f.field);
                if (f.op === '==') {
                    if (candidate !== f.value) return false;
                } else if (f.op === '!=') {
                    if (candidate === f.value) return false;
                } else if (f.op === 'in') {
                    if (!Array.isArray(f.value) || !f.value.includes(candidate)) return false;
                } else if (f.op === '>=') {
                    if (typeof candidate !== 'number' || candidate < (f.value as number)) return false;
                } else if (f.op === '<=') {
                    if (typeof candidate !== 'number' || candidate > (f.value as number)) return false;
                } else if (f.op === '>') {
                    if (typeof candidate !== 'number' || candidate <= (f.value as number)) return false;
                } else if (f.op === '<') {
                    if (typeof candidate !== 'number' || candidate >= (f.value as number)) return false;
                }
            }
            return true;
        });

        if (orderSpec) {
            entries.sort((a, b) => {
                const av = getNestedField(a[1], orderSpec.field);
                const bv = getNestedField(b[1], orderSpec.field);
                const cmp = av === bv ? 0 : (av as any) > (bv as any) ? 1 : -1;
                return orderSpec.dir === 'desc' ? -cmp : cmp;
            });
        }

        if (typeof limitCount === 'number') {
            entries = entries.slice(0, limitCount);
        }

        return entries;
    };

    return {
        where(field: string, op: string, value: unknown) {
            return createQueryRef(colPath, [...filters, { field, op, value }], limitCount, orderSpec);
        },
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
            return createQueryRef(colPath, filters, limitCount, { field, dir });
        },
        limit(n: number) {
            return createQueryRef(colPath, filters, n, orderSpec);
        },
        count() {
            return {
                async get() {
                    const matched = evaluate();
                    return { data: () => ({ count: matched.length }) };
                },
            };
        },
        async get() {
            const matched = evaluate();
            const docs = matched.map(([id, data]) => ({
                id,
                exists: true,
                ref: createDocRef(colPath, id),
                data: () => clonePlain(data),
            }));
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    };
}

function createCollectionRef(colPath: string): any {
    const queryBase = createQueryRef(colPath);
    return {
        ...queryBase,
        doc(id?: string) {
            const docId = id || `auto-${++autoDocSeq}`;
            return createDocRef(colPath, docId);
        },
        async add(payload: Record<string, any>) {
            const docId = `auto-${++autoDocSeq}`;
            const ref = createDocRef(colPath, docId);
            await ref.set(payload);
            return ref;
        },
    };
}

const mockDb = {
    collection(name: string) {
        return createCollectionRef(name);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const tx = {
            get: (ref: any) => ref.get(),
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => ref.set(data, opts),
            update: (ref: any, patch: Record<string, any>) => ref.update(patch),
            delete: (ref: any) => ref.delete(),
        };
        return fn(tx);
    },
};

const mockStorage = {
    bucket() {
        return {
            name: 'minreport-sandbox-test.firebasestorage.app',
            file(filePath: string) {
                return {
                    async save(data: Buffer | Uint8Array | string, opts?: Record<string, any>) {
                        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
                        storageFiles.set(filePath, {
                            buffer: buf,
                            metadata: opts?.metadata || {},
                        });
                    },
                    async exists() {
                        return [storageFiles.has(filePath)];
                    },
                    async getMetadata() {
                        const entry = storageFiles.get(filePath);
                        if (!entry) {
                            throw new Error(`No such object: ${filePath}`);
                        }
                        return [
                            {
                                contentType: entry.metadata.contentType || 'application/octet-stream',
                                size: String(entry.buffer.length),
                                metadata: entry.metadata,
                            },
                        ];
                    },
                    createReadStream() {
                        const entry = storageFiles.get(filePath);
                        if (!entry) {
                            return new Readable({
                                read() {
                                    this.destroy(new Error(`No such object: ${filePath}`));
                                },
                            });
                        }
                        return Readable.from([entry.buffer]);
                    },
                    async download() {
                        const entry = storageFiles.get(filePath);
                        if (!entry) {
                            throw new Error(`No such object: ${filePath}`);
                        }
                        return [entry.buffer];
                    },
                };
            },
        };
    },
};

const mockAuth = {
    async verifyIdToken(token: string) {
        const decoded = verifyIdTokenMap.get(token);
        if (!decoded) {
            throw new Error(`Invalid test token: ${token}`);
        }
        return decoded;
    },
    async getUser(uid: string) {
        const u = authUsersByUid.get(uid);
        if (!u) {
            const err: any = new Error(`User not found: ${uid}`);
            err.code = 'auth/user-not-found';
            throw err;
        }
        return u;
    },
    async getUserByEmail(email: string) {
        const u = authUsersByEmail.get(email.toLowerCase());
        if (!u) {
            const err: any = new Error(`User not found: ${email}`);
            err.code = 'auth/user-not-found';
            throw err;
        }
        return u;
    },
    async createUser(props: Record<string, any>) {
        const uid = props.uid || `uid-${++autoDocSeq}`;
        const userRecord = {
            uid,
            email: props.email,
            displayName: props.displayName || '',
            customClaims: {},
        };
        authUsersByUid.set(uid, userRecord);
        if (props.email) {
            authUsersByEmail.set(String(props.email).toLowerCase(), userRecord);
        }
        return userRecord;
    },
    async updateUser(uid: string, props: Record<string, any>) {
        const existing = authUsersByUid.get(uid) || { uid };
        const updated = { ...existing, ...props };
        authUsersByUid.set(uid, updated);
        if (updated.email) {
            authUsersByEmail.set(String(updated.email).toLowerCase(), updated);
        }
        return updated;
    },
    async setCustomUserClaims(uid: string, claims: Record<string, any>) {
        customClaimsCalls.push({ uid, claims: clonePlain(claims) });
        const existing = authUsersByUid.get(uid);
        if (existing) {
            existing.customClaims = clonePlain(claims);
        }
    },
    async createCustomToken(uid: string, claims?: Record<string, any>) {
        customTokenCalls.push({ uid, claims: claims ? clonePlain(claims) : undefined });
        return `mock-custom-token-${uid}`;
    },
};

const mockFirestoreNamespace: any = () => mockDb;
mockFirestoreNamespace.FieldValue = mockFieldValue;
mockFirestoreNamespace.Timestamp = mockTimestamp;

const mockAdmin = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: mockFirestoreNamespace,
    auth: () => mockAuth,
    storage: () => mockStorage,
    messaging: () => ({}),
};

function installRequireStub(resolvedPath: string, exportsObj: any): void {
    require.cache[resolvedPath] = {
        id: resolvedPath,
        filename: resolvedPath,
        loaded: true,
        exports: exportsObj,
    } as any;
}

installRequireStub(require.resolve('../../config/firebase'), {
    __esModule: true,
    default: mockAdmin,
    db: mockDb,
    auth: mockAuth,
    storage: mockStorage,
    messaging: {},
});

installRequireStub(require.resolve('firebase-admin/firestore'), {
    __esModule: true,
    FieldValue: mockFieldValue,
    Timestamp: mockTimestamp,
});

installRequireStub(require.resolve('firebase-admin'), {
    __esModule: true,
    default: mockAdmin,
    apps: mockAdmin.apps,
    firestore: mockFirestoreNamespace,
    auth: () => mockAuth,
    storage: () => mockStorage,
});

// ---------------------------------------------------------------------------
// Carga diferida de módulos bajo prueba (después de inyectar `require.cache`)
// ---------------------------------------------------------------------------
const sharp = require('sharp') as typeof import('sharp');
const { TenantLogoDescriptorSchema } = require('../../contracts/media.contracts') as typeof import('../../contracts/media.contracts');
const mediaRouterModule = require('../../api/media.routes') as typeof import('../../api/media.routes');
const { CasStorageService } = require('../../core/media/CasStorageService') as typeof import('../../core/media/CasStorageService');
const { AuditLedger } = require('../../core/audit-ledger') as typeof import('../../core/audit-ledger');
const { resolveModuleSessionScope } = require('../../middleware/sessionScope') as typeof import('../../middleware/sessionScope');
const { updateBrandingSettings } = require('../../api/admin.controller') as typeof import('../../api/admin.controller');
const { devLogin, impersonateClient } = require('../../api/dev.controller') as typeof import('../../api/dev.controller');
const { DevChallengeService } = require('../../services/dev-challenge.service') as typeof import('../../services/dev-challenge.service');
const { EmailService } = require('../../services/EmailService') as typeof import('../../services/EmailService');

// ---------------------------------------------------------------------------
// Utilidades HTTP mock
// ---------------------------------------------------------------------------
interface MockResCapture {
    res: Response;
    getStatus: () => number;
    getBody: () => any;
}

function createMockResponse(): MockResCapture {
    let statusCode = 200;
    let body: any = undefined;
    const resObj: any = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: any) {
            body = payload;
            return this;
        },
        send(payload: any) {
            body = payload;
            return this;
        },
        setHeader() {
            return this;
        },
    };
    return {
        res: resObj as Response,
        getStatus: () => statusCode,
        getBody: () => body,
    };
}

function extractRouteHandler(router: any, method: 'get' | 'post', routePath: string): (req: any, res: any) => Promise<any> {
    const layer = (router.stack || []).find(
        (l: any) => l.route && l.route.path === routePath && l.route.methods?.[method]
    );
    assert.ok(layer, `Route ${method.toUpperCase()} ${routePath} must exist on mediaRouter`);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle;
}

async function runTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, '../../..');
    let passed = 0;

    // -----------------------------------------------------------------------
    // Test 1: TenantLogoDescriptorSchema
    // -----------------------------------------------------------------------
    resetMocks();
    {
        const validSha = 'a'.repeat(64);
        const validSvg = {
            sha256: validSha,
            downloadUrl: `/api/media/blob/symbology/${validSha}.svg`,
            mimeType: 'image/svg+xml',
            extension: 'svg',
            profile: 'VECTOR_SVG_CLEAN',
            originalBytes: 18420,
            optimizedBytes: 4210,
            savingsPct: 77.14,
            updatedAt: Date.now(),
        };
        const parsed = TenantLogoDescriptorSchema.parse(validSvg);
        assert.equal(parsed.sha256, validSha);
        assert.equal(parsed.profile, 'VECTOR_SVG_CLEAN');

        const validHttps = TenantLogoDescriptorSchema.parse({
            sha256: 'b'.repeat(64),
            downloadUrl: 'https://minreport-access.web.app/api/media/blob/symbology/' + 'b'.repeat(64) + '.webp',
            mimeType: 'image/webp',
            profile: 'IMAGE_ISO_SYMBOL',
            originalBytes: 1024,
            optimizedBytes: 512,
            savingsPct: 50,
            updatedAt: '2026-11-14T00:00:00Z',
        });
        assert.equal(validHttps.profile, 'IMAGE_ISO_SYMBOL');

        assert.throws(() =>
            TenantLogoDescriptorSchema.parse({
                ...validSvg,
                downloadUrl: 'data:image/png;base64,iVBORw0KGgo=',
            })
        );
        assert.throws(() =>
            TenantLogoDescriptorSchema.parse({
                ...validSvg,
                downloadUrl: '/other/path/logo.png',
            })
        );
        assert.throws(() =>
            TenantLogoDescriptorSchema.parse({
                ...validSvg,
                downloadUrl: '/api/media/x;base64,abc',
            })
        );
        assert.throws(() =>
            TenantLogoDescriptorSchema.parse({
                ...validSvg,
                sha256: 'not-hex-64',
            })
        );
        assert.throws(() =>
            TenantLogoDescriptorSchema.parse({
                ...validSvg,
                profile: 'PHOTO_INSPECTION_EVIDENCE',
            })
        );
        assert.throws(() =>
            TenantLogoDescriptorSchema.parse({
                ...validSvg,
                savingsPct: 120,
            })
        );
        passed++;
        console.log('PASS [1/5] TenantLogoDescriptorSchema validates CAS URIs and rejects data:/base64/invalid ranges');
    }

    // -----------------------------------------------------------------------
    // Test 2: CAS Authorization Co-Branding B2B in media.routes.ts & sessionScope.ts priority
    // -----------------------------------------------------------------------
    resetMocks();
    {
        const mediaRouter = mediaRouterModule.default;
        const preflightHandler = extractRouteHandler(mediaRouter, 'get', '/cas-preflight/:sha256');
        const digestUploadHandler = extractRouteHandler(mediaRouter, 'post', '/digest-upload');

        const origPreflight = CasStorageService.preflightCheck;
        const origDigestAndStore = CasStorageService.digestAndStore;
        const origAuditRecord = AuditLedger.record;

        const recordedScopesPreflight: string[] = [];
        const recordedScopesUpload: string[] = [];

        CasStorageService.preflightCheck = (async (_sha256: string, scope: any) => {
            recordedScopesPreflight.push(scope);
            return { exists: false, casScope: scope, sha256: 'c'.repeat(64) } as any;
        }) as any;

        CasStorageService.digestAndStore = (async (_buf: Buffer, _mime: string, prof: any, opts: any) => {
            recordedScopesUpload.push(opts.scope);
            return {
                descriptor: {
                    sha256: 'c'.repeat(64),
                    scope: opts.scope,
                    tenantId: opts.tenantId,
                    profile: prof,
                    mimeType: 'image/svg+xml',
                    extension: 'svg',
                    originalBytes: 1200,
                    optimizedBytes: 400,
                    savingsRatio: 0.6667,
                    savingsPct: 66.67,
                    storagePath: `assets/symbology/cas/${'c'.repeat(64)}.svg`,
                    downloadUrl: `/api/media/blob/symbology/${'c'.repeat(64)}.svg`,
                    deduplicatedHit: false,
                    createdAt: new Date().toISOString(),
                },
            } as any;
        }) as any;

        AuditLedger.record = (async () => ({ success: true } as any)) as any;

        try {
            const makeCtx = (
                overrides: Record<string, any> = {},
                capOverrides: Record<string, boolean> = {}
            ) => ({
                tenantId: 'tenant-b2b',
                actorId: 'u-1',
                actorEmail: 'user@faena.cl',
                accountTier: 4,
                isEduSandbox: false,
                isTestPilot: false,
                dataScope: 'PRODUCTION',
                capabilities: {
                    canInspect: true,
                    canManageFleet: true,
                    canViewVaults: true,
                    canViewMasterCatalog: false,
                    canCurateAI: false,
                    ...capOverrides,
                },
                ...overrides,
            });

            const runPreflight = async (ctx: any, scope: string, profile?: string) => {
                const cap = createMockResponse();
                await preflightHandler(
                    {
                        params: { sha256: 'c'.repeat(64) },
                        query: { scope, ...(profile ? { profile } : {}) },
                        opermaqContext: ctx,
                    } as unknown as Request,
                    cap.res
                );
                assert.equal(cap.getStatus(), 200);
                return recordedScopesPreflight[recordedScopesPreflight.length - 1];
            };

            const runUpload = async (ctx: any, scope: string, profile: string) => {
                const cap = createMockResponse();
                await digestUploadHandler(
                    {
                        query: { scope, profile },
                        body: {},
                        file: {
                            buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
                            mimetype: 'image/svg+xml',
                            originalname: 'logo.svg',
                            size: 46,
                        },
                        opermaqContext: ctx,
                    } as unknown as Request,
                    cap.res
                );
                assert.equal(cap.getStatus(), 200);
                return recordedScopesUpload[recordedScopesUpload.length - 1];
            };

            // 1º DEV -> GLOBAL_OEM & SYMBOLOGY_MASTER allowed
            const devCtx = makeCtx(
                { accountTier: 1, tenantId: 'dev-master-sandbox', actorEmail: 'dev@minreport.com' },
                { canCurateAI: true, canViewMasterCatalog: true }
            );
            assert.equal(await runPreflight(devCtx, 'GLOBAL_OEM', 'IMAGE_ISO_SYMBOL'), 'GLOBAL_OEM');
            assert.equal(await runUpload(devCtx, 'SYMBOLOGY_MASTER', 'IMAGE_FIELD_EVIDENCE'), 'SYMBOLOGY_MASTER');

            // 2º ADMIN -> GLOBAL_OEM degrades to TENANT_PRIVATE, SYMBOLOGY_MASTER allowed
            const adminCtx = makeCtx(
                { accountTier: 2, tenantId: 'admin-root', actorEmail: 'admin@minreport.com' },
                { canCurateAI: false }
            );
            assert.equal(await runPreflight(adminCtx, 'GLOBAL_OEM', 'IMAGE_ISO_SYMBOL'), 'TENANT_PRIVATE');
            assert.equal(await runUpload(adminCtx, 'SYMBOLOGY_MASTER', 'IMAGE_FIELD_EVIDENCE'), 'SYMBOLOGY_MASTER');

            // 4º B2B OWNER/ADMIN -> SYMBOLOGY_MASTER allowed ONLY for IMAGE_ISO_SYMBOL & VECTOR_SVG_CLEAN
            const b2bAdminCtx = makeCtx(
                { accountTier: 4, isEduSandbox: false },
                { canManageFleet: true, canCurateAI: false }
            );
            assert.equal(await runPreflight(b2bAdminCtx, 'GLOBAL_OEM', 'IMAGE_ISO_SYMBOL'), 'TENANT_PRIVATE');
            assert.equal(await runPreflight(b2bAdminCtx, 'SYMBOLOGY_MASTER', 'IMAGE_ISO_SYMBOL'), 'SYMBOLOGY_MASTER');
            assert.equal(await runUpload(b2bAdminCtx, 'SYMBOLOGY_MASTER', 'VECTOR_SVG_CLEAN'), 'SYMBOLOGY_MASTER');
            assert.equal(await runUpload(b2bAdminCtx, 'SYMBOLOGY_MASTER', 'IMAGE_FIELD_EVIDENCE'), 'TENANT_PRIVATE');
            assert.equal(await runPreflight(b2bAdminCtx, 'SYMBOLOGY_MASTER'), 'TENANT_PRIVATE');

            // 4º B2B OPERATOR/VIEWER -> degrades to TENANT_PRIVATE even for VECTOR_SVG_CLEAN
            const b2bOpCtx = makeCtx(
                { accountTier: 4 },
                { canManageFleet: false, canCurateAI: false }
            );
            assert.equal(await runUpload(b2bOpCtx, 'SYMBOLOGY_MASTER', 'VECTOR_SVG_CLEAN'), 'TENANT_PRIVATE');

            // 3º TEST-PILOT (accountTier 3 even with canCurateAI) & 5º EDU -> degrade SYMBOLOGY_MASTER to TENANT_PRIVATE
            const pilotCtx = makeCtx(
                { accountTier: 3, isTestPilot: true, dataScope: 'SANDBOX' },
                { canManageFleet: true, canCurateAI: true }
            );
            assert.equal(await runUpload(pilotCtx, 'SYMBOLOGY_MASTER', 'IMAGE_ISO_SYMBOL'), 'TENANT_PRIVATE');
            assert.equal(await runPreflight(pilotCtx, 'GLOBAL_OEM', 'IMAGE_ISO_SYMBOL'), 'TENANT_PRIVATE');

            const eduCtx = makeCtx(
                { accountTier: 5, isEduSandbox: true, dataScope: 'SANDBOX' },
                { canManageFleet: true, canCurateAI: false }
            );
            assert.equal(await runPreflight(eduCtx, 'SYMBOLOGY_MASTER', 'IMAGE_ISO_SYMBOL'), 'TENANT_PRIVATE');
        } finally {
            CasStorageService.preflightCheck = origPreflight;
            CasStorageService.digestAndStore = origDigestAndStore;
            AuditLedger.record = origAuditRecord;
        }

        // Priority check in sessionScope.ts: eduInstitutionLogo > corporateLogo > coBrandingLogoUrl
        getCollectionMap('modules_status').set('opermaq', { status: 'ACTIVE', enabled: true });
        getCollectionMap('users').set('b2b-uid', {
            role: 'CLIENT_OWNER',
            primaryAccountId: 'acc-cobrand',
            memberships: [{ accountId: 'acc-cobrand', role: 'OWNER', status: 'ACTIVE' }],
            email: 'owner@minera.cl',
            accountTier: 4,
        });
        verifyIdTokenMap.set('tok-b2b', {
            uid: 'b2b-uid',
            email: 'owner@minera.cl',
            role: 'CLIENT_OWNER',
            activeAccountId: 'acc-cobrand',
        });

        // Fallback to account.coBrandingLogoUrl when corporateLogo & eduInstitutionLogo absent
        getCollectionMap('accounts').set('acc-cobrand', {
            ownerId: 'b2b-uid',
            coBrandingLogoUrl: '/api/media/blob/symbology/' + '1'.repeat(64) + '.png',
            status: 'ACTIVE',
        });
        {
            const mw = resolveModuleSessionScope('opermaq');
            const req: any = { headers: { authorization: 'Bearer tok-b2b' }, path: '/api/opermaq/assets' };
            const cap = createMockResponse();
            let nextCalled = false;
            await mw(req, cap.res, (() => {
                nextCalled = true;
            }) as NextFunction);
            assert.equal(nextCalled, true);
            assert.equal(req.opermaqContext.coBrandingLogoUrl, '/api/media/blob/symbology/' + '1'.repeat(64) + '.png');
        }

        // corporateLogo overrides coBrandingLogoUrl
        getCollectionMap('accounts').set('acc-cobrand', {
            ownerId: 'b2b-uid',
            corporateLogo: { downloadUrl: '/api/media/blob/symbology/' + '2'.repeat(64) + '.svg' },
            coBrandingLogoUrl: '/api/media/blob/symbology/' + '1'.repeat(64) + '.png',
            status: 'ACTIVE',
        });
        {
            const mw = resolveModuleSessionScope('opermaq');
            const req: any = { headers: { authorization: 'Bearer tok-b2b' }, path: '/api/opermaq/assets' };
            const cap = createMockResponse();
            await mw(req, cap.res, (() => {}) as NextFunction);
            assert.equal(req.opermaqContext.coBrandingLogoUrl, '/api/media/blob/symbology/' + '2'.repeat(64) + '.svg');
        }

        // eduInstitutionLogo overrides both corporateLogo and coBrandingLogoUrl
        getCollectionMap('accounts').set('acc-cobrand', {
            ownerId: 'b2b-uid',
            eduInstitutionLogo: { downloadUrl: '/api/media/blob/symbology/' + '3'.repeat(64) + '.svg' },
            corporateLogo: { downloadUrl: '/api/media/blob/symbology/' + '2'.repeat(64) + '.svg' },
            coBrandingLogoUrl: '/api/media/blob/symbology/' + '1'.repeat(64) + '.png',
            status: 'ACTIVE',
        });
        {
            const mw = resolveModuleSessionScope('opermaq');
            const req: any = { headers: { authorization: 'Bearer tok-b2b' }, path: '/api/opermaq/assets' };
            const cap = createMockResponse();
            await mw(req, cap.res, (() => {}) as NextFunction);
            assert.equal(req.opermaqContext.coBrandingLogoUrl, '/api/media/blob/symbology/' + '3'.repeat(64) + '.svg');
        }

        passed++;
        console.log('PASS [2/5] CAS SYMBOLOGY_MASTER scope enforcement & sessionScope co-branding fallback priority');
    }

    // -----------------------------------------------------------------------
    // Test 3: updateBrandingSettings exclusive 1º DEV + HITL + #C68346 + CAS sharp + AuditLedger + src/index.ts
    // -----------------------------------------------------------------------
    resetMocks();
    {
        // Seed legacy svgDataUris on settings/branding to prove purge
        await getCollectionMap('settings').set('branding', {
            primaryColor: '#FFCD00',
            svgDataUris: { mainLogo: 'data:image/svg+xml;base64,PHN2Zz4=' },
        });

        // 3a: SUPER_ADMIN rejected with 403
        {
            const cap = createMockResponse();
            await updateBrandingSettings(
                {
                    user: { uid: 'admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN' },
                    headers: { 'x-hitl-confirmation': 'ACTUALIZAR' },
                    body: { confirmationKeyword: 'ACTUALIZAR', light: { imagotype: 'https://cdn.minreport.cl/logo.svg' } },
                } as unknown as Request,
                cap.res
            );
            assert.equal(cap.getStatus(), 403);
            assert.match(String(cap.getBody()?.error), /1º DEV|DEV_ROOT/);
        }

        // 3b: DEV_ROOT rejected with 400 when HITL !== "ACTUALIZAR"
        {
            const cap = createMockResponse();
            await updateBrandingSettings(
                {
                    devUser: { uid: 'dev-master-root-uid', email: 'dev@minreport.com', role: 'DEV_ROOT' },
                    headers: {},
                    body: {
                        confirmationKeyword: 'CONFIRMAR',
                        light: { imagotype: '/api/media/blob/symbology/' + 'd'.repeat(64) + '.svg' },
                    },
                } as unknown as Request,
                cap.res
            );
            assert.equal(cap.getStatus(), 400);
            assert.match(String(cap.getBody()?.error), /ACTUALIZAR/);
        }

        // 3c: DEV_ROOT rejected with 400 on data: or ;base64, URIs
        {
            const cap = createMockResponse();
            await updateBrandingSettings(
                {
                    devUser: { uid: 'dev-master-root-uid', email: 'dev@minreport.com', role: 'DEV_ROOT' },
                    headers: { 'x-hitl-confirmation': 'ACTUALIZAR' },
                    body: {
                        confirmationKeyword: 'ACTUALIZAR',
                        light: { imagotype: 'data:image/png;base64,AAAA' },
                    },
                } as unknown as Request,
                cap.res
            );
            assert.equal(cap.getStatus(), 400);
            assert.match(String(cap.getBody()?.error), /Data URIs|Base64/i);
        }

        // 3d: Valid DEV_ROOT update with CAS pwaIcon -> sharp PNG 192 & 512, forced #C68346, purge svgDataUris, AuditLedger
        {
            const pngSha = 'e'.repeat(64);
            const svgSha = 'f'.repeat(64);
            const tinyPng = await sharp({
                create: {
                    width: 64,
                    height: 64,
                    channels: 4,
                    background: { r: 198, g: 131, b: 70, alpha: 1 },
                },
            })
                .png()
                .toBuffer();

            await mockStorage
                .bucket()
                .file(`assets/symbology/cas/${pngSha}.png`)
                .save(tinyPng, { metadata: { contentType: 'image/png' } });

            const cap = createMockResponse();
            await updateBrandingSettings(
                {
                    devUser: { uid: 'dev-master-root-uid', email: 'dev@minreport.com', role: 'DEV_ROOT' },
                    ip: '127.0.0.1',
                    headers: { 'x-hitl-confirmation': 'ACTUALIZAR', 'user-agent': 'sandbox-test' },
                    body: {
                        confirmationKeyword: 'ACTUALIZAR',
                        primaryColor: '#FFCD00',
                        light: {
                            imagotype: `/api/media/blob/symbology/${svgSha}.svg`,
                            pwaIcon: `/api/media/blob/symbology/${pngSha}.png`,
                        },
                        dark: {
                            imagotype: `/api/media/blob/symbology/${svgSha}.svg`,
                        },
                        assetTelemetry: {
                            imagotype: {
                                sha256: svgSha,
                                originalBytes: 12000,
                                optimizedBytes: 3000,
                                savingsPct: 75,
                                profile: 'VECTOR_SVG_CLEAN',
                            },
                            pwaIcon: {
                                sha256: pngSha,
                                originalBytes: 40000,
                                optimizedBytes: 8000,
                                savingsPct: 80,
                                profile: 'IMAGE_ISO_SYMBOL',
                            },
                        },
                    },
                } as unknown as Request,
                cap.res
            );

            assert.equal(cap.getStatus(), 200);
            const resp = cap.getBody();
            assert.equal(resp.success, true);
            assert.equal(resp.primaryColor, '#C68346');
            assert.equal(resp.generatedAssets?.pwaIcon192Path, 'branding/pwa-192x192.png');
            assert.equal(resp.generatedAssets?.pwaIcon512Path, 'branding/pwa-512x512.png');

            const pwa192 = storageFiles.get('branding/pwa-192x192.png');
            const pwa512 = storageFiles.get('branding/pwa-512x512.png');
            assert.ok(pwa192 && pwa192.buffer.length > 0, 'pwa-192x192.png generated via CAS sharp');
            assert.ok(pwa512 && pwa512.buffer.length > 0, 'pwa-512x512.png generated via CAS sharp');

            const savedBranding = getCollectionMap('settings').get('branding');
            assert.ok(savedBranding, 'settings/branding saved');
            assert.equal(savedBranding?.primaryColor, '#C68346');
            assert.equal('svgDataUris' in (savedBranding || {}), false, 'legacy svgDataUris must be purged');
            assert.equal(savedBranding?.assetTelemetry?.imagotype?.sha256, svgSha);

            const lastBrandingWrite = dbSetCalls.filter((c) => c.path === 'settings/branding').pop();
            assert.equal(lastBrandingWrite?.rawPayload?.svgDataUris, DELETE_SENTINEL);

            const auditDocs = Array.from(getCollectionMap('audit_ledger').values());
            const brandingEvent = auditDocs.find((d) => d.action === 'GLOBAL_BRANDING_UPDATED');
            assert.ok(brandingEvent, 'AuditLedger GLOBAL_BRANDING_UPDATED recorded');
            assert.equal(brandingEvent?.module, 'core');
            assert.equal(brandingEvent?.targetEntity, 'settings/branding');
        }

        // Verify src/index.ts branding & dev route wiring
        const indexSource = fs.readFileSync(path.join(repoRoot, 'src/index.ts'), 'utf8');
        assert.match(indexSource, /app\.get\('\/api\/dev\/settings\/branding',\s*requireDevRoot,\s*getBrandingSettings\)/);
        assert.match(
            indexSource,
            /app\.put\('\/api\/dev\/settings\/branding',\s*requireDevRoot,\s*mutationRateLimiter,\s*updateBrandingSettings\)/
        );
        assert.match(
            indexSource,
            /app\.put\('\/api\/admin\/settings\/branding',\s*requireDevRoot,\s*mutationRateLimiter,\s*updateBrandingSettings\)/
        );
        assert.match(indexSource, /app\.get\('\/api\/admin\/settings\/branding',\s*requireSuperAdmin,\s*getBrandingSettings\)/);
        assert.match(indexSource, /app\.get\('\/api\/settings\/branding',\s*getPublicBrandingSettings\)/);
        assert.equal(indexSource.includes('/api/dev/impersonate-client'), false, 'impersonate-client route removed');

        passed++;
        console.log('PASS [3/5] updateBrandingSettings 1º DEV + HITL + #C68346 + CAS sharp + AuditLedger + index.ts');
    }

    // -----------------------------------------------------------------------
    // Test 4: Hardening /dev (devLogin 403, impersonateClient 410, DevChallengeService flow)
    // -----------------------------------------------------------------------
    resetMocks();
    {
        // 4a: devLogin returns 403
        {
            const cap = createMockResponse();
            await devLogin({ body: { email: 'dev@minreport.com', password: 'any' } } as unknown as Request, cap.res);
            assert.equal(cap.getStatus(), 403);
        }

        // 4b: impersonateClient returns 410 without creating custom token
        {
            const cap = createMockResponse();
            await impersonateClient(
                { devUser: { uid: 'dev-master-root-uid', role: 'DEV_ROOT' }, body: { tenantId: 't1' } } as unknown as Request,
                cap.res
            );
            assert.equal(cap.getStatus(), 410);
            assert.equal(customTokenCalls.length, 0);
        }

        // 4c: DevChallengeService full flow without plaintext clientToken in Firestore or redirect URL
        const creds = await DevChallengeService.ensureCredentialsMeta();
        assert.ok(creds?.passwordHash, 'DevCredentialsMeta created');
        assert.ok(creds?.salt, 'DevCredentialsMeta salt created');

        let capturedOtp = '';
        let capturedEmailToken = '';
        const origSendEmail = EmailService.sendEmail.bind(EmailService);
        const origConsoleLog = console.log;

        EmailService.sendEmail = async (opts) => {
            const subjMatch = String(opts.subject || '').match(/\b(\d{6})\b/);
            if (subjMatch) capturedOtp = subjMatch[1];
            return origSendEmail(opts);
        };
        console.log = (...args: any[]) => {
            const joined = args.map((a) => String(a)).join(' ');
            const tokMatch = joined.match(/token=([a-f0-9]{64})/i);
            if (tokMatch) capturedEmailToken = tokMatch[1];
            origConsoleLog(...args);
        };

        let initRes: { challengeId: string; clientToken: string; expiresAt: number };
        try {
            initRes = await DevChallengeService.initChallenge('127.0.0.1', 'sandbox-ua');
        } finally {
            EmailService.sendEmail = origSendEmail;
            console.log = origConsoleLog;
        }
        assert.ok(initRes.challengeId);
        assert.ok(initRes.clientToken);

        const challengeDoc = getCollectionMap('dev_challenges').get(initRes.challengeId);
        assert.ok(challengeDoc, 'dev_challenges doc created');
        assert.equal('clientToken' in (challengeDoc || {}), false, 'plaintext clientToken must NOT be saved in Firestore');
        const expectedClientHash = crypto.createHash('sha256').update(initRes.clientToken).digest('hex');
        assert.equal(challengeDoc?.clientTokenHash, expectedClientHash);

        // Verify mock system_emails redacted OTP cleanly and captured confirm token & OTP
        const emailDocs = Array.from(getCollectionMap('system_emails').values());
        assert.equal(emailDocs.length, 1);
        assert.ok(String(emailDocs[0].body || '').includes('[OTP_REDACTED]'), 'system_emails must redact OTP');
        assert.ok(/^[a-f0-9]{64}$/i.test(capturedEmailToken), 'email confirm token captured');
        assert.ok(/^\d{6}$/.test(capturedOtp), '6-digit OTP captured');

        const confirmRes = await DevChallengeService.confirmChallenge(initRes.challengeId, capturedEmailToken);
        assert.equal(confirmRes.success, true);
        assert.equal(confirmRes.status, 302);
        assert.ok(
            confirmRes.redirectUrl?.endsWith(`/dev?cid=${encodeURIComponent(initRes.challengeId)}`),
            `unexpected redirectUrl: ${confirmRes.redirectUrl}`
        );
        assert.equal(confirmRes.redirectUrl?.includes(initRes.clientToken), false, 'redirectUrl must not leak clientToken');
        assert.equal(confirmRes.redirectUrl?.includes('&token='), false);

        const statusRes = await DevChallengeService.getChallengeStatus(initRes.challengeId, initRes.clientToken);
        assert.equal(statusRes.status, 'EMAIL_CONFIRMED');

        const otpRes = await DevChallengeService.verifyOtp(initRes.challengeId, initRes.clientToken, capturedOtp);
        assert.equal(otpRes.success, true);
        assert.ok(otpRes.stepToken);

        const verifyRes = await DevChallengeService.verifyUser(
            initRes.challengeId,
            initRes.clientToken,
            otpRes.stepToken,
            'dev@minreport.com'
        );
        assert.equal(verifyRes.valid, true);

        const devPassword = process.env.DEV_ROOT_PASSWORD!;
        const origFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) } as any)) as any;
        try {
            const finalRes = await DevChallengeService.loginFinal(
                initRes.challengeId,
                initRes.clientToken,
                otpRes.stepToken,
                'dev@minreport.com',
                devPassword
            );
            assert.equal(finalRes.success, true);
            assert.equal(finalRes.user.role, 'DEV_ROOT');
            assert.equal(finalRes.user.accountTier, 1);
            assert.equal(finalRes.user.classification, 'dev-root');
            assert.equal(finalRes.user.isMasterDev, true);
            assert.equal(finalRes.user.suiteAccess, true);

            const lastClaims = customClaimsCalls[customClaimsCalls.length - 1];
            assert.ok(lastClaims);
            assert.deepEqual(lastClaims.claims, {
                role: 'DEV_ROOT',
                accountTier: 1,
                classification: 'dev-root',
                isMasterDev: true,
                suiteAccess: true,
            });
            assert.equal(getCollectionMap('dev_challenges').get(initRes.challengeId)?.status, 'COMPLETED');
        } finally {
            globalThis.fetch = origFetch;
        }

        passed++;
        console.log('PASS [4/5] devLogin 403, impersonateClient 410, DevChallengeService full flow without clientToken leak');
    }

    // -----------------------------------------------------------------------
    // Test 5: Static verification of M3 primitives & F3 guardrails in web/src/**
    // -----------------------------------------------------------------------
    {
        const requiredWebFiles = [
            'web/src/components/common/M3LinearProgress.tsx',
            'web/src/components/common/M3CircularProgress.tsx',
            'web/src/components/common/ReportBlockEditable.tsx',
            'web/src/components/common/HitlConfirmModal.tsx',
            'web/src/components/common/CoBrandedReportHeader.tsx',
            'web/src/components/common/M3Switch.tsx',
            'web/src/context/BrandingContext.tsx',
        ];
        for (const rel of requiredWebFiles) {
            assert.equal(fs.existsSync(path.join(repoRoot, rel)), true, `Missing required frontend file: ${rel}`);
        }

        const removedWebFiles = [
            'web/src/pages/b2b/BrandingPage.tsx',
            'web/src/components/dev/DevImpersonationHUD.tsx',
        ];
        for (const rel of removedWebFiles) {
            assert.equal(fs.existsSync(path.join(repoRoot, rel)), false, `Legacy file must remain deleted: ${rel}`);
        }

        const m3SwitchSrc = fs.readFileSync(path.join(repoRoot, 'web/src/components/common/M3Switch.tsx'), 'utf8');
        assert.ok(m3SwitchSrc.includes('#C68346'), 'M3Switch must use industrial copper #C68346');

        const brandingCtxSrc = fs.readFileSync(path.join(repoRoot, 'web/src/context/BrandingContext.tsx'), 'utf8');
        for (const sym of [
            'LogoSet',
            'BrandingConfig',
            'getCanonicalBrandingPath',
            'fixBrandingUrl',
            'useBranding',
            'BrandingProvider',
            '#C68346',
        ]) {
            assert.ok(brandingCtxSrc.includes(sym), `BrandingContext missing F3 export/token: ${sym}`);
        }

        const offendingMatches: string[] = [];
        const walkWebSrc = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
                if (
                    rel.startsWith('web/src/modules/opermaq') ||
                    entry.name === 'node_modules'
                ) {
                    continue;
                }
                if (entry.isDirectory()) {
                    walkWebSrc(full);
                } else if (/\.(ts|tsx|js|jsx|css)$/.test(entry.name)) {
                    const content = fs.readFileSync(full, 'utf8');
                    if (content.includes('progress_activity') || content.includes('animate-spin')) {
                        offendingMatches.push(rel);
                    }
                }
            }
        };
        walkWebSrc(path.join(repoRoot, 'web/src'));
        assert.deepEqual(offendingMatches, [], `Forbidden spinner classes outside isolated modules: ${offendingMatches.join(', ')}`);

        passed++;
        console.log('PASS [5/5] Frontend M3 primitives, deleted legacy files, BrandingContext F3, and zero banned spinners');
    }

    console.log(`ALL_PASSED ${passed}/5 tests`);
}

runTests().catch((err) => {
    console.error('TEST_FAILED', err);
    process.exit(1);
});
