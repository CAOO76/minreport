/**
 * TEST DE INTEGRACIÓN END-TO-END — REMEDIACIÓN ATÓMICA R1–R3 (CORE MINREPORT)
 *
 * Verifica de forma integrada y sin red ni emuladores externos:
 *   1) R1.1: POST /api/auth/passkey/login-verify acepta `userHandle: null` (sin error Zod 400).
 *   2) R1.2: `revokeTestPilot` revoca refresh tokens, deshabilita usuario en Auth, marca
 *            `accounts/{id}/members/{uid}.status = 'REVOKED'`, y `firestore.rules` exige `isNotRevokedPilotUser()`.
 *   3) R1.3 + C2-j1: `POST /api/ai/hitl-candidates/:id/resolve` exige `"ACTUALIZAR"` al aprobar,
 *            autoriza `OWNER` B2B en su cuenta y registra en `AuditLedger`, rechaza `403` a `VIEWER`,
 *            otro tenant y `5º EDU`; `resolveAuthorizedAiTenantContext` cubre `PROFESSOR` y `STUDENT`.
 *   4) R1.4: Verificación estática de `isEduSandbox` en `firestore.rules` (`accounts/{accountId}`),
 *            `disallowEdu` en `App.tsx`, y retiro de `/api/public/accounts-by-id` en `MobileLogin.tsx`.
 *   5) R2.2: `updateTenantStatus` asigna `accountTier: 5` para `isEdu`, propaga `SUSPENDED`/`REJECTED`
 *            a todos los miembros de `accounts/{id}/members`, y `sendAccessEmailOtp` usa `redactSensitiveOtp: true`.
 *   6) R2.3 + C1-e2: `setupAccountPassword` incluye `pilotExpiresAt` en `createCustomToken` y
 *            preserva Tax ID extranjero `12-3456789` sin corrupción `formatRut`.
 *   7) R2.4: `POST /api/equipment-onboarding/:requestId/publish` invalida el caché de proyección en `0ms`,
 *            `GET /api/assets/catalog` preserva parámetros libres (`Peso operativo: 505000 kg`,
 *            `Voltaje sistema tracción AC 2600V`) junto a ejes canónicos (`Potencia: 2014 kW`),
 *            y un segundo intento con mismo `unitIdentifierValue` devuelve `409 IDENTIFICADOR_DUPLICADO_EN_FLOTA`.
 *   8) R3: `DevChallengeService.loginFinal` con `DEV_ROOT` en Auth en frío asegura `dev-master-root-uid`
 *          antes de `auth.updateUser` sin error `No user dev-master-root-uid`, y `firestore.indexes.json`
 *          define `fieldOverrides` TTL sobre `ttlExpiresAt` en las 10 colecciones requeridas.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response, Router } from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.WEBAUTHN_RP_ID = 'minreport-access.web.app';
process.env.DEV_ROOT_PASSWORD = 'TestDevRootPassword!2026';

// ============================================================================
// 1. ARNÉS EN MEMORIA PARA FIRESTORE / AUTH / SECRETOS / AI CLIENT
// ============================================================================

interface MockTimestampLike {
    toMillis(): number;
    toDate(): Date;
    seconds: number;
    nanoseconds: number;
    _seconds: number;
    _nanoseconds: number;
}

class MockTimestamp implements MockTimestampLike {
    public readonly seconds: number;
    public readonly nanoseconds: number;
    public readonly _seconds: number;
    public readonly _nanoseconds: number;

    constructor(private readonly ms: number) {
        this.seconds = Math.floor(ms / 1000);
        this.nanoseconds = (ms % 1000) * 1_000_000;
        this._seconds = this.seconds;
        this._nanoseconds = this.nanoseconds;
    }

    static now(): MockTimestamp {
        return new MockTimestamp(Date.now());
    }

    static fromDate(d: Date): MockTimestamp {
        return new MockTimestamp(d.getTime());
    }

    static fromMillis(ms: number): MockTimestamp {
        return new MockTimestamp(ms);
    }

    toMillis(): number {
        return this.ms;
    }

    toDate(): Date {
        return new Date(this.ms);
    }
}

const DELETE_FIELD_SENTINEL = { __mockFieldOp: 'delete' };

class MockFieldValue {
    static serverTimestamp(): MockTimestamp {
        return MockTimestamp.now();
    }
    static delete(): typeof DELETE_FIELD_SENTINEL {
        return DELETE_FIELD_SENTINEL;
    }
    static increment(delta: number): { __mockFieldOp: 'increment'; delta: number } {
        return { __mockFieldOp: 'increment', delta };
    }
    static arrayUnion(...items: any[]): { __mockFieldOp: 'arrayUnion'; items: any[] } {
        return { __mockFieldOp: 'arrayUnion', items };
    }
    static arrayRemove(...items: any[]): { __mockFieldOp: 'arrayRemove'; items: any[] } {
        return { __mockFieldOp: 'arrayRemove', items };
    }
}

interface AuthUserState {
    uid: string;
    email?: string;
    displayName?: string;
    password?: string;
    emailVerified: boolean;
    disabled: boolean;
    customClaims: Record<string, any>;
}

const collections = new Map<string, Map<string, Record<string, any>>>();
const authUsersByUid = new Map<string, AuthUserState>();

let updateUserCalls: Array<{ uid: string; props: Record<string, any> }> = [];
let revokeRefreshTokensCalls: string[] = [];
let customClaimsCalls: Array<{ uid: string; claims: Record<string, any> }> = [];
let customTokenCalls: Array<{ uid: string; claims: Record<string, any> }> = [];
let capturedResilientAiCalls: Array<Record<string, any>> = [];
let emailSendSpyCalls: Array<Record<string, any>> = [];

let autoIdSeq = 0;

function cloneData<T>(value: T): T {
    if (value === null || value === undefined || typeof value !== 'object') {
        return value;
    }
    if (value instanceof MockTimestamp || typeof (value as any).toMillis === 'function') {
        return value;
    }
    if (value instanceof Date) {
        return new Date(value.getTime()) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneData(item)) as unknown as T;
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
        out[k] = cloneData(v);
    }
    return out as T;
}

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
    let map = collections.get(colPath);
    if (!map) {
        map = new Map<string, Record<string, any>>();
        collections.set(colPath, map);
    }
    return map;
}

function readNestedField(obj: Record<string, any>, fieldPath: string): any {
    const parts = fieldPath.split('.');
    let cursor: any = obj;
    for (const part of parts) {
        if (cursor == null || typeof cursor !== 'object') return undefined;
        cursor = cursor[part];
    }
    return cursor;
}

function applyFieldTransform(target: Record<string, any>, key: string, val: any): void {
    if (val && typeof val === 'object' && !Array.isArray(val) && '__mockFieldOp' in val) {
        if (val.__mockFieldOp === 'delete') {
            delete target[key];
            return;
        }
        if (val.__mockFieldOp === 'increment') {
            const cur = Number(target[key] || 0);
            target[key] = cur + Number(val.delta || 0);
            return;
        }
        if (val.__mockFieldOp === 'arrayUnion') {
            const existing = Array.isArray(target[key]) ? [...target[key]] : [];
            for (const item of val.items) {
                if (!existing.includes(item)) existing.push(item);
            }
            target[key] = existing;
            return;
        }
        if (val.__mockFieldOp === 'arrayRemove') {
            const existing = Array.isArray(target[key]) ? target[key] : [];
            target[key] = existing.filter((x) => !val.items.includes(x));
            return;
        }
    }
    target[key] = cloneData(val);
}

function applyPatchToDoc(existing: Record<string, any>, patch: Record<string, any>): Record<string, any> {
    const next = cloneData(existing);
    for (const [rawKey, rawVal] of Object.entries(patch)) {
        if (rawKey.includes('.')) {
            const parts = rawKey.split('.');
            let cursor: Record<string, any> = next;
            for (let i = 0; i < parts.length - 1; i++) {
                const seg = parts[i];
                if (!cursor[seg] || typeof cursor[seg] !== 'object') {
                    cursor[seg] = {};
                }
                cursor = cursor[seg];
            }
            applyFieldTransform(cursor, parts[parts.length - 1], rawVal);
        } else {
            applyFieldTransform(next, rawKey, rawVal);
        }
    }
    return next;
}

function projectFields(data: Record<string, any>, selectedFields: string[] | null): Record<string, any> {
    if (!selectedFields) return cloneData(data);
    const projected: Record<string, any> = {};
    for (const field of selectedFields) {
        if (field in data) {
            projected[field] = cloneData(data[field]);
        }
    }
    return projected;
}

function makeDocRef(colPath: string, docId: string): any {
    return {
        id: docId,
        path: `${colPath}/${docId}`,
        collection: (subCol: string) => makeCollectionRef(`${colPath}/${docId}/${subCol}`),
        get: async () => {
            const raw = getCollectionMap(colPath).get(docId);
            const snapData = raw ? cloneData(raw) : undefined;
            return {
                id: docId,
                exists: Boolean(raw),
                ref: makeDocRef(colPath, docId),
                data: () => snapData,
            };
        },
        set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
            const map = getCollectionMap(colPath);
            if (opts?.merge && map.has(docId)) {
                map.set(docId, applyPatchToDoc(map.get(docId)!, data));
            } else {
                map.set(docId, applyPatchToDoc({}, data));
            }
        },
        update: async (patch: Record<string, any>) => {
            const map = getCollectionMap(colPath);
            const existing = map.get(docId);
            if (!existing) {
                const err = new Error(`No document to update: ${colPath}/${docId}`);
                (err as any).code = 5;
                throw err;
            }
            map.set(docId, applyPatchToDoc(existing, patch));
        },
        delete: async () => {
            getCollectionMap(colPath).delete(docId);
        },
    };
}

interface QueryFilter {
    field: string;
    op: string;
    value: any;
}

interface QueryOrder {
    field: string;
    dir: 'asc' | 'desc';
}

function matchesFilter(docData: Record<string, any>, filter: QueryFilter): boolean {
    const val = readNestedField(docData, filter.field);
    switch (filter.op) {
        case '==':
            return val === filter.value;
        case '!=':
            return val !== filter.value;
        case 'in':
            return Array.isArray(filter.value) && filter.value.includes(val);
        case 'not-in':
            return Array.isArray(filter.value) && !filter.value.includes(val);
        case 'array-contains':
            return Array.isArray(val) && val.includes(filter.value);
        case '>':
            return val > filter.value;
        case '>=':
            return val >= filter.value;
        case '<':
            return val < filter.value;
        case '<=':
            return val <= filter.value;
        default:
            return false;
    }
}

function makeQueryRef(
    colPath: string,
    filters: QueryFilter[] = [],
    orders: QueryOrder[] = [],
    limitCount: number | null = null,
    selectedFields: string[] | null = null
): any {
    const runEntries = () => {
        let entries = Array.from(getCollectionMap(colPath).entries()).filter(([, d]) =>
            filters.every((f) => matchesFilter(d, f))
        );
        if (orders.length > 0) {
            entries = [...entries].sort(([idA, a], [idB, b]) => {
                for (const ord of orders) {
                    const va = ord.field === '__name__' ? idA : readNestedField(a, ord.field);
                    const vb = ord.field === '__name__' ? idB : readNestedField(b, ord.field);
                    if (va === vb) continue;
                    const cmp = va < vb ? -1 : 1;
                    return ord.dir === 'desc' ? -cmp : cmp;
                }
                return 0;
            });
        }
        if (typeof limitCount === 'number') {
            entries = entries.slice(0, limitCount);
        }
        return entries;
    };

    const query: any = {
        where: (field: string, op: string, value: any) =>
            makeQueryRef(colPath, [...filters, { field, op, value }], orders, limitCount, selectedFields),
        orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') =>
            makeQueryRef(colPath, filters, [...orders, { field, dir }], limitCount, selectedFields),
        limit: (n: number) =>
            makeQueryRef(colPath, filters, orders, n, selectedFields),
        select: (...fields: string[]) =>
            makeQueryRef(colPath, filters, orders, limitCount, fields),
        count: () => ({
            get: async () => ({
                data: () => ({ count: runEntries().length }),
            }),
        }),
        get: async () => {
            const entries = runEntries();
            const docs = entries.map(([id, data]) => {
                const projected = projectFields(data, selectedFields);
                return {
                    id,
                    exists: true,
                    ref: makeDocRef(colPath, id),
                    data: () => cloneData(projected),
                };
            });
            return {
                empty: docs.length === 0,
                size: docs.length,
                docs,
                forEach: (cb: (doc: any) => void) => docs.forEach(cb),
            };
        },
    };
    return query;
}

function makeCollectionRef(colPath: string): any {
    const baseQuery = makeQueryRef(colPath);
    return {
        ...baseQuery,
        doc: (id?: string) => {
            const resolvedId = id || `auto_${++autoIdSeq}`;
            return makeDocRef(colPath, resolvedId);
        },
        add: async (data: Record<string, any>) => {
            const resolvedId = `auto_${++autoIdSeq}`;
            const ref = makeDocRef(colPath, resolvedId);
            await ref.set(data);
            return ref;
        },
    };
}

const mockDb: any = {
    collection: (name: string) => makeCollectionRef(name),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
        const tx = {
            get: async (refOrQuery: any) => refOrQuery.get(),
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) =>
                ref.set(data, opts),
            update: (ref: any, patch: Record<string, any>) => ref.update(patch),
            delete: (ref: any) => ref.delete(),
        };
        return fn(tx);
    },
    batch: () => {
        const ops: Array<() => Promise<void>> = [];
        return {
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
                ops.push(() => ref.set(data, opts));
            },
            update: (ref: any, patch: Record<string, any>) => {
                ops.push(() => ref.update(patch));
            },
            delete: (ref: any) => {
                ops.push(() => ref.delete());
            },
            commit: async () => {
                for (const op of ops) await op();
            },
        };
    },
};

function makeAuthError(code: string, message: string): Error {
    const err = new Error(message);
    (err as any).code = code;
    return err;
}

const mockAuth: any = {
    verifyIdToken: async (token: string) => {
        if (!token.startsWith('mock-token:')) {
            throw makeAuthError('auth/invalid-id-token', 'Token inválido en arnés');
        }
        const json = Buffer.from(token.slice('mock-token:'.length), 'base64url').toString('utf8');
        return JSON.parse(json);
    },
    getUser: async (uid: string) => {
        const u = authUsersByUid.get(uid);
        if (!u) {
            throw makeAuthError('auth/user-not-found', `No user ${uid}`);
        }
        return { ...u, customClaims: { ...u.customClaims } };
    },
    getUserByEmail: async (email: string) => {
        const cleanEmail = email.trim().toLowerCase();
        for (const u of authUsersByUid.values()) {
            if ((u.email || '').toLowerCase() === cleanEmail) {
                return { ...u, customClaims: { ...u.customClaims } };
            }
        }
        throw makeAuthError('auth/user-not-found', `No user with email ${cleanEmail}`);
    },
    createUser: async (props: Partial<AuthUserState> & { uid?: string }) => {
        const uid = props.uid || `uid_${++autoIdSeq}`;
        const user: AuthUserState = {
            uid,
            email: props.email,
            displayName: props.displayName,
            password: props.password,
            emailVerified: Boolean(props.emailVerified),
            disabled: Boolean(props.disabled),
            customClaims: { ...(props.customClaims || {}) },
        };
        authUsersByUid.set(uid, user);
        return { ...user };
    },
    updateUser: async (uid: string, props: Partial<AuthUserState>) => {
        const existing = authUsersByUid.get(uid);
        if (!existing) {
            throw makeAuthError('auth/user-not-found', `No user ${uid}`);
        }
        updateUserCalls.push({ uid, props: { ...props } });
        const next: AuthUserState = { ...existing, ...props };
        authUsersByUid.set(uid, next);
        return { ...next };
    },
    deleteUser: async (uid: string) => {
        authUsersByUid.delete(uid);
    },
    revokeRefreshTokens: async (uid: string) => {
        revokeRefreshTokensCalls.push(uid);
    },
    setCustomUserClaims: async (uid: string, claims: Record<string, any>) => {
        customClaimsCalls.push({ uid, claims: { ...claims } });
        const existing = authUsersByUid.get(uid);
        if (existing) {
            existing.customClaims = { ...claims };
        }
    },
    createCustomToken: async (uid: string, claims: Record<string, any> = {}) => {
        customTokenCalls.push({ uid, claims: { ...claims } });
        return `custom-token:${uid}:${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    },
};

const mockStorage: any = {
    bucket: () => ({
        name: 'minreport-mock-bucket',
        file: (filePath: string) => ({
            name: filePath,
            save: async () => {},
            exists: async () => [false],
            download: async () => [Buffer.alloc(0)],
            getSignedUrl: async () => [`https://storage.mock.local/${filePath}`],
        }),
    }),
};

const mockAdmin: any = {
    apps: [{ name: 'mock-app' }],
    initializeApp: () => ({}),
    credential: { applicationDefault: () => ({}) },
    firestore: Object.assign(() => mockDb, {
        FieldValue: MockFieldValue,
        Timestamp: MockTimestamp,
    }),
    auth: () => mockAuth,
    storage: () => mockStorage,
};

function resetHarnessState(): void {
    collections.clear();
    authUsersByUid.clear();
    updateUserCalls = [];
    revokeRefreshTokensCalls = [];
    customClaimsCalls = [];
    customTokenCalls = [];
    capturedResilientAiCalls = [];
    emailSendSpyCalls = [];
    autoIdSeq = 0;
}

function encodeMockBearer(claims: Record<string, any>): string {
    return `Bearer mock-token:${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}`;
}

function installModuleStubs(): void {
    const firebaseModPath = require.resolve('../../config/firebase');
    require.cache[firebaseModPath] = {
        id: firebaseModPath,
        filename: firebaseModPath,
        loaded: true,
        exports: {
            __esModule: true,
            default: mockAdmin,
            db: mockDb,
            auth: mockAuth,
            storage: mockStorage,
        },
    } as any;

    const adminModPath = require.resolve('firebase-admin');
    require.cache[adminModPath] = {
        id: adminModPath,
        filename: adminModPath,
        loaded: true,
        exports: Object.assign(mockAdmin, { __esModule: true, default: mockAdmin }),
    } as any;

    try {
        const firestoreModPath = require.resolve('firebase-admin/firestore');
        require.cache[firestoreModPath] = {
            id: firestoreModPath,
            filename: firestoreModPath,
            loaded: true,
            exports: {
                __esModule: true,
                FieldValue: MockFieldValue,
                Timestamp: MockTimestamp,
                getFirestore: () => mockDb,
            },
        } as any;
    } catch {
        // Ignorar si no existe submódulo separado
    }

    const secretsModPath = require.resolve('../../config/secrets');
    const realSecrets = require(secretsModPath);
    require.cache[secretsModPath] = {
        id: secretsModPath,
        filename: secretsModPath,
        loaded: true,
        exports: {
            ...realSecrets,
            resolveDevRootPassword: async () => process.env.DEV_ROOT_PASSWORD || 'TestDevRootPassword!2026',
            resolveSuperAdminPassword: async () => 'TestSuperAdmin!2026',
            resolveResendApiKey: async () => 're_test_mock_key',
            hydrateCoreSecrets: async () => {},
        },
    } as any;

    const aiClientPath = require.resolve('../resilient-ai-client');
    const realAiClientModule = require(aiClientPath);
    if (realAiClientModule?.ResilientAIClient) {
        realAiClientModule.ResilientAIClient.generate = async (opts: Record<string, any>) => {
            capturedResilientAiCalls.push(opts);
            return {
                text: 'OK_MOCK_AI_RESPONSE',
                tierUsed: 'FLASH',
                model: 'gemini-2.5-flash',
                latencyMs: 18,
            };
        };
    }
}

installModuleStubs();

// ============================================================================
// 2. HELPERS HTTP EXPRESS SIN BIND DE PUERTOS
// ============================================================================

interface MockResResult {
    status: number;
    body: any;
    headers: Record<string, string>;
}

async function invokeHandlerStack(
    handlers: Array<(req: Request, res: Response, next: (err?: any) => void) => any>,
    options: {
        method?: string;
        path?: string;
        params?: Record<string, string>;
        query?: Record<string, any>;
        body?: any;
        headers?: Record<string, string>;
        ip?: string;
        user?: Record<string, any>;
        devUser?: Record<string, any>;
        opermaqContext?: Record<string, any>;
    }
): Promise<MockResResult> {
    const normalizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.headers || {})) {
        normalizedHeaders[k.toLowerCase()] = v;
    }

    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: any = undefined;
    let settled = false;

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
    });

    const markSettled = () => {
        if (!settled) {
            settled = true;
            resolveDone();
        }
    };

    const req: any = {
        method: (options.method || 'POST').toUpperCase(),
        path: options.path || '/',
        originalUrl: options.path || '/',
        params: options.params || {},
        query: options.query || {},
        body: options.body ?? {},
        headers: normalizedHeaders,
        ip: options.ip || '10.10.0.1',
        socket: { remoteAddress: options.ip || '10.10.0.1' },
        get: (headerName: string) => normalizedHeaders[headerName.toLowerCase()],
        header: (headerName: string) => normalizedHeaders[headerName.toLowerCase()],
        user: options.user,
        devUser: options.devUser,
        opermaqContext: options.opermaqContext,
    };

    const res: any = {
        get statusCode() {
            return statusCode;
        },
        set statusCode(code: number) {
            statusCode = code;
        },
        setHeader(name: string, val: string) {
            responseHeaders[name.toLowerCase()] = String(val);
        },
        getHeader(name: string) {
            return responseHeaders[name.toLowerCase()];
        },
        status(code: number) {
            statusCode = code;
            return res;
        },
        json(payload: any) {
            responseBody = payload;
            markSettled();
            return res;
        },
        send(payload: any) {
            responseBody = payload;
            markSettled();
            return res;
        },
        end(payload?: any) {
            if (payload !== undefined) responseBody = payload;
            markSettled();
            return res;
        },
    };

    let idx = 0;
    const runNext = async (err?: any): Promise<void> => {
        if (err) {
            statusCode = 500;
            responseBody = { error: err?.message || String(err) };
            markSettled();
            return;
        }
        if (settled || idx >= handlers.length) {
            markSettled();
            return;
        }
        const fn = handlers[idx++];
        let nextCalled = false;
        const next = (nextErr?: any) => {
            nextCalled = true;
            void runNext(nextErr);
        };
        try {
            const ret = fn(req, res, next);
            if (ret && typeof ret.then === 'function') {
                await ret;
            }
            if (!nextCalled && !settled && idx >= handlers.length) {
                markSettled();
            }
        } catch (thrown: any) {
            statusCode = 500;
            responseBody = { error: thrown?.message || 'Unhandled error' };
            markSettled();
        }
    };

    void runNext();
    await donePromise;

    return {
        status: statusCode,
        body: responseBody,
        headers: responseHeaders,
    };
}

function getRouteHandlersFromRouter(
    routerOrApp: Router | Express,
    routePath: string,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete'
): Array<(req: Request, res: Response, next: (err?: any) => void) => any> {
    const stackHolder = (routerOrApp as any)._router || routerOrApp;
    const stack: any[] = stackHolder?.stack || [];
    const layer = stack.find(
        (l) => l.route?.path === routePath && Boolean(l.route?.methods?.[method])
    );
    assert.ok(layer, `Ruta ${method.toUpperCase()} ${routePath} debe existir en router/app`);
    return layer.route.stack.map((s: any) => s.handle);
}

// Importar módulos bajo prueba DESPUÉS de instalar stubs en `require.cache`
const app: Express = require('../../index').default;
const { webauthnRouter } = require('../../api/webauthn.controller') as {
    webauthnRouter: Router;
};
const { revokeTestPilot } = require('../../api/dev.controller') as {
    revokeTestPilot: (req: Request, res: Response) => Promise<any>;
};
const { updateTenantStatus } = require('../../api/admin.controller') as {
    updateTenantStatus: (req: Request, res: Response) => Promise<any>;
};
const { sendAccessEmailOtp } = require('../../api/access.controller') as {
    sendAccessEmailOtp: (req: Request, res: Response) => Promise<any>;
};
const { EmailService } = require('../../services/EmailService') as {
    EmailService: { sendEmail: (opts: Record<string, any>) => Promise<void> };
};
const { setupAccountPassword } = require('../../api/setup.controller') as {
    setupAccountPassword: (req: Request, res: Response) => Promise<any>;
};
const equipmentOnboardingRouter: Router = require('../../api/equipment-onboarding.controller').default;
const assetsRouter: Router = require('../../modules/opermaq/routes/assets.routes').default;
const { DevChallengeService } = require('../../services/dev-challenge.service') as {
    DevChallengeService: {
        loginFinal: (
            challengeId: string,
            clientToken: string,
            stepToken: string,
            username: string,
            password: string,
            newPassword?: string
        ) => Promise<{ success: boolean; token?: string; firebaseToken?: string; user?: any; error?: string }>;
    };
};

// Espía no destructivo sobre EmailService.sendEmail manteniendo `mockEmail`
const originalSendEmail = EmailService.sendEmail.bind(EmailService);
EmailService.sendEmail = async (opts: Record<string, any>) => {
    emailSendSpyCalls.push(opts);
    return originalSendEmail(opts);
};

// ============================================================================
// 3. SUITE DE PRUEBAS R1–R3
// ============================================================================

async function testR1_1_WebAuthnNullUserHandle(): Promise<void> {
    resetHarnessState();

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
    });
    const spkiBase64 = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

    const uid = 'b2b-passkey-uid-1';
    const accountId = 'acc-b2b-passkey-1';
    const challengeId = crypto.randomUUID();
    const challengeB64 = crypto.randomBytes(32).toString('base64url');
    const credentialId = crypto.randomBytes(24).toString('base64url');
    const rpId = 'minreport-access.web.app';

    await mockDb.collection('users').doc(uid).set({
        uid,
        email: 'owner@mineria.cl',
        role: 'OWNER',
        status: 'ACTIVE',
        memberships: [{ accountId, role: 'OWNER', status: 'ACTIVE' }],
    });
    await mockDb.collection('webauthn_challenges').doc(challengeId).set({
        id: challengeId,
        purpose: 'LOGIN',
        expectedUid: uid,
        accountId,
        rpId,
        challenge: challengeB64,
        expiresAt: Date.now() + 60_000,
        used: false,
    });
    await mockDb.collection('webauthn_credentials').doc(credentialId).set({
        uid,
        email: 'owner@mineria.cl',
        status: 'ACTIVE',
        rpId,
        publicKeySpkiBase64: spkiBase64,
        coseAlg: -7,
        signCount: 0,
    });

    const clientDataJsonBuf = Buffer.from(
        JSON.stringify({
            type: 'webauthn.get',
            challenge: challengeB64,
            origin: 'https://minreport-access.web.app',
        }),
        'utf8'
    );
    const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
    const flagsAndCounter = Buffer.alloc(5);
    flagsAndCounter[0] = 0x05; // UP + UV
    flagsAndCounter.writeUInt32BE(1, 1);
    const authDataBuf = Buffer.concat([rpIdHash, flagsAndCounter]);

    const clientDataHash = crypto.createHash('sha256').update(clientDataJsonBuf).digest();
    const signedPayload = Buffer.concat([authDataBuf, clientDataHash]);
    const signatureBuf = crypto.sign('sha256', signedPayload, privateKey);

    const loginVerifyHandlers = getRouteHandlersFromRouter(webauthnRouter, '/login-verify', 'post');
    const res = await invokeHandlerStack(loginVerifyHandlers, {
        method: 'POST',
        path: '/api/auth/passkey/login-verify',
        ip: '10.1.1.1',
        body: {
            challengeId,
            credentialId,
            clientDataJSON: clientDataJsonBuf.toString('base64url'),
            authenticatorData: authDataBuf.toString('base64url'),
            signature: signatureBuf.toString('base64url'),
            userHandle: null,
            accountId,
        },
    });

    assert.equal(res.status, 200, `Esperado HTTP 200 con userHandle: null, recibido ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.uid, uid);
    assert.ok(typeof res.body?.customToken === 'string' && res.body.customToken.length > 0);

    const passkeyServiceSrc = fs.readFileSync(
        path.resolve(__dirname, '../../../web/src/services/passkeyService.ts'),
        'utf8'
    );
    assert.match(
        passkeyServiceSrc,
        /response\.userHandle\s*\?\s*arrayBufferToBase64Url\(response\.userHandle\)\s*:\s*undefined/,
        'passkeyService.ts debe normalizar userHandle ausente a undefined y nunca a null'
    );
    console.log('✅ [R1.1] WebAuthn login-verify acepta userHandle: null sin error 400');
}

async function testR1_2_RevokeTestPilotAndRules(): Promise<void> {
    resetHarnessState();

    const pilotAccountId = 'pilot-rev-001';
    const pilotUid = 'uid_pilot_rev_001';

    await mockAuth.createUser({
        uid: pilotUid,
        email: 'piloto@minreport.com',
        emailVerified: true,
        disabled: false,
        customClaims: { role: 'TEST_PILOT', pilotExpiresAt: Date.now() + 86_400_000 },
    });

    await mockDb.collection('test_pilots').doc(pilotAccountId).set({
        id: pilotAccountId,
        userId: pilotUid,
        email: 'piloto@minreport.com',
        status: 'ACTIVE',
        expiresAt: Date.now() + 86_400_000,
    });
    await mockDb.collection('accounts').doc(pilotAccountId).set({
        id: pilotAccountId,
        ownerId: pilotUid,
        type: 'TEST_PILOT',
        status: 'ACTIVE',
    });
    await mockDb
        .collection('accounts')
        .doc(pilotAccountId)
        .collection('members')
        .doc(pilotUid)
        .set({
            userId: pilotUid,
            uid: pilotUid,
            role: 'TEST_PILOT',
            status: 'ACTIVE',
        });
    await mockDb.collection('users').doc(pilotUid).set({
        uid: pilotUid,
        email: 'piloto@minreport.com',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
    });

    const res = await invokeHandlerStack([revokeTestPilot], {
        method: 'DELETE',
        params: { id: pilotAccountId },
        ip: '10.1.2.1',
        devUser: { uid: 'dev-master-root-uid', email: 'dev@minreport.com' },
    });

    assert.equal(res.status, 200);
    assert.ok(revokeRefreshTokensCalls.includes(pilotUid), 'revokeRefreshTokens debe invocarse sobre pilotUid');
    assert.ok(
        updateUserCalls.some((c) => c.uid === pilotUid && c.props.disabled === true),
        'auth.updateUser debe deshabilitar al usuario piloto'
    );
    const updatedAuthUser = await mockAuth.getUser(pilotUid);
    assert.equal(updatedAuthUser.disabled, true);

    const memberSnap = await mockDb
        .collection('accounts')
        .doc(pilotAccountId)
        .collection('members')
        .doc(pilotUid)
        .get();
    assert.equal(memberSnap.data()?.status, 'REVOKED');

    const userSnap = await mockDb.collection('users').doc(pilotUid).get();
    assert.equal(userSnap.data()?.status, 'REVOKED');

    const pilotSnap = await mockDb.collection('test_pilots').doc(pilotAccountId).get();
    assert.equal(pilotSnap.data()?.status, 'REVOKED');

    const rulesSrc = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const isTestPilotFnMatch = rulesSrc.match(/function\s+isTestPilot\(\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(isTestPilotFnMatch, 'firestore.rules debe declarar function isTestPilot()');
    assert.ok(
        isTestPilotFnMatch[0].includes('isNotRevokedPilotUser()'),
        'isTestPilot() en firestore.rules debe verificar isNotRevokedPilotUser()'
    );
    console.log('✅ [R1.2] revokeTestPilot invalida tokens/Auth/members y firestore.rules verifica isNotRevokedPilotUser()');
}

async function testR1_3_HitlResolveAndProfessorAiContext(): Promise<void> {
    resetHarnessState();

    await mockDb.collection('accounts').doc('b2b-1').set({
        id: 'b2b-1',
        ownerId: 'owner-b2b-1',
        type: 'BUSINESS',
        status: 'ACTIVE',
    });
    await mockDb.collection('accounts').doc('b2b-1').collection('members').doc('viewer-b2b-1').set({
        userId: 'viewer-b2b-1',
        role: 'VIEWER',
        status: 'ACTIVE',
    });
    await mockDb.collection('accounts').doc('b2b-2').set({
        id: 'b2b-2',
        ownerId: 'owner-b2b-2',
        type: 'BUSINESS',
        status: 'ACTIVE',
    });
    await mockDb.collection('accounts').doc('edu-1').set({
        id: 'edu-1',
        ownerId: 'edu-owner-1',
        type: 'EDUCATIONAL',
        classification: 'edu',
        isEduSandbox: true,
        status: 'ACTIVE',
    });
    await mockDb.collection('users').doc('prof-1').set({
        uid: 'prof-1',
        email: 'profesor@uni.cl',
        role: 'PROFESSOR',
        status: 'ACTIVE',
        memberships: [{ accountId: 'edu-1', role: 'PROFESSOR', status: 'ACTIVE' }],
    });
    await mockDb.collection('users').doc('pilot-ok').set({
        uid: 'pilot-ok',
        role: 'TEST_PILOT',
        status: 'ACTIVE',
        pilotExpiresAt: Date.now() + 86_400_000,
    });
    await mockDb.collection('users').doc('pilot-revoked').set({
        uid: 'pilot-revoked',
        role: 'TEST_PILOT',
        status: 'REVOKED',
    });

    await mockDb.collection('hitl_candidates').doc('cand-1').set({
        id: 'cand-1',
        tenantId: 'b2b-1',
        module: 'opermaq',
        status: 'PENDING',
    });
    await mockDb.collection('hitl_candidates').doc('cand-2').set({
        id: 'cand-2',
        tenantId: 'b2b-1',
        module: 'opermaq',
        status: 'PENDING',
    });
    await mockDb.collection('hitl_candidates').doc('cand-edu').set({
        id: 'cand-edu',
        tenantId: 'edu-1',
        module: 'opermaq',
        status: 'PENDING',
    });

    const hitlHandlers = getRouteHandlersFromRouter(app, '/api/ai/hitl-candidates/:id/resolve', 'post');

    // 1) Aprobar sin "ACTUALIZAR" -> 400
    const missingKwRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-1' },
        ip: '10.1.3.1',
        headers: { authorization: encodeMockBearer({ uid: 'owner-b2b-1', email: 'owner1@mineria.cl', role: 'OWNER' }) },
        body: { status: 'APPROVED' },
    });
    assert.equal(missingKwRes.status, 400);

    // 2) VIEWER de b2b-1 -> 403
    const viewerRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-1' },
        ip: '10.1.3.2',
        headers: { authorization: encodeMockBearer({ uid: 'viewer-b2b-1', email: 'viewer1@mineria.cl', role: 'VIEWER' }) },
        body: { status: 'APPROVED', confirmKeyword: 'ACTUALIZAR' },
    });
    assert.equal(viewerRes.status, 403);

    // 3) Otro tenant (owner-b2b-2) sobre cand-1 -> 403
    const crossTenantRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-1' },
        ip: '10.1.3.3',
        headers: { authorization: encodeMockBearer({ uid: 'owner-b2b-2', email: 'owner2@otra.cl', role: 'OWNER' }) },
        body: { status: 'APPROVED', confirmKeyword: 'ACTUALIZAR' },
    });
    assert.equal(crossTenantRes.status, 403);

    // 4) 5º EDU (owner/PROFESSOR) sobre cand-edu -> 403
    const eduRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-edu' },
        ip: '10.1.3.4',
        headers: { authorization: encodeMockBearer({ uid: 'edu-owner-1', email: 'prof@uni.cl', role: 'PROFESSOR' }) },
        body: { status: 'APPROVED', confirmKeyword: 'ACTUALIZAR' },
    });
    assert.equal(eduRes.status, 403);

    // 5) TEST_PILOT revocado -> 403
    const revokedPilotRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-1' },
        ip: '10.1.3.5',
        headers: { authorization: encodeMockBearer({ uid: 'pilot-revoked', email: 'rev@minreport.com', role: 'TEST_PILOT' }) },
        body: { status: 'APPROVED', confirmKeyword: 'ACTUALIZAR' },
    });
    assert.equal(revokedPilotRes.status, 403);

    // 6) OWNER B2B en su cuenta con "ACTUALIZAR" -> 200 + AuditLedger
    const approveRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-1' },
        ip: '10.1.3.6',
        headers: { authorization: encodeMockBearer({ uid: 'owner-b2b-1', email: 'owner1@mineria.cl', role: 'OWNER' }) },
        body: { status: 'APPROVED', confirmKeyword: 'ACTUALIZAR' },
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body?.status, 'APPROVED');

    const cand1After = (await mockDb.collection('hitl_candidates').doc('cand-1').get()).data();
    assert.equal(cand1After?.status, 'APPROVED');
    assert.equal(cand1After?.reviewedByUid, 'owner-b2b-1');

    // 7) TEST_PILOT activo rechaza cand-2 -> 200
    const rejectPilotRes = await invokeHandlerStack(hitlHandlers, {
        method: 'POST',
        params: { id: 'cand-2' },
        ip: '10.1.3.7',
        headers: {
            authorization: encodeMockBearer({
                uid: 'pilot-ok',
                email: 'pilot@minreport.com',
                role: 'TEST_PILOT',
                pilotExpiresAt: Date.now() + 86_400_000,
            }),
        },
        body: { status: 'REJECTED' },
    });
    assert.equal(rejectPilotRes.status, 200);

    const ledgerSnap = await mockDb.collection('audit_ledger').get();
    const actions = ledgerSnap.docs.map((d: any) => d.data()?.action);
    assert.ok(actions.includes('AI_HITL_CANDIDATE_APPROVED'), 'Debe registrar AI_HITL_CANDIDATE_APPROVED en AuditLedger');
    assert.ok(actions.includes('AI_HITL_CANDIDATE_REJECTED'), 'Debe registrar AI_HITL_CANDIDATE_REJECTED en AuditLedger');

    // C2-j1: POST /api/ai/inference con roles PROFESSOR y STUDENT -> isEduSandbox: true
    const aiInferenceHandlers = getRouteHandlersFromRouter(app, '/api/ai/inference', 'post');
    const profNoAccountRes = await invokeHandlerStack(aiInferenceHandlers, {
        method: 'POST',
        ip: '10.1.3.8',
        headers: {
            authorization: encodeMockBearer({ uid: 'prof-1', email: 'profesor@uni.cl', role: 'PROFESSOR' }),
        },
        body: { prompt: 'Resumen técnico de chancado primario', module: 'opermaq' },
    });
    assert.equal(profNoAccountRes.status, 200);

    const profWithEduRes = await invokeHandlerStack(aiInferenceHandlers, {
        method: 'POST',
        ip: '10.1.3.9',
        headers: {
            authorization: encodeMockBearer({ uid: 'prof-1', email: 'profesor@uni.cl', role: 'PROFESSOR' }),
            'x-active-account-id': 'edu-1',
        },
        body: { prompt: 'Análisis académico sandbox', module: 'opermaq' },
    });
    assert.equal(profWithEduRes.status, 200);

    const studentNoAccountRes = await invokeHandlerStack(aiInferenceHandlers, {
        method: 'POST',
        ip: '10.1.3.10',
        headers: {
            authorization: encodeMockBearer({ uid: 'stud-1', email: 'estudiante@uni.cl', role: 'STUDENT' }),
        },
        body: { prompt: 'Consulta estudiantil en sandbox', module: 'opermaq' },
    });
    assert.equal(studentNoAccountRes.status, 200);

    assert.equal(capturedResilientAiCalls[0]?.isEduSandbox, true, 'PROFESSOR sin accountId debe ir marcado isEduSandbox: true');
    assert.equal(capturedResilientAiCalls[1]?.isEduSandbox, true, 'PROFESSOR en edu-1 debe ir marcado isEduSandbox: true');
    assert.equal(capturedResilientAiCalls[2]?.isEduSandbox, true, 'STUDENT sin accountId debe ir marcado isEduSandbox: true');
    console.log('✅ [R1.3 + C2-j1] HITL resolve (ACTUALIZAR + multi-tenant + AuditLedger) y contexto PROFESSOR/STUDENT verificados');
}

async function testR1_4_EduIsolationStaticGuardrails(): Promise<void> {
    const rulesSrc = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const accountBlockMatch = rulesSrc.match(/match\s+\/accounts\/\{accountId\}\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(accountBlockMatch, 'firestore.rules debe contener match /accounts/{accountId}');
    assert.ok(
        accountBlockMatch[0].includes("isEduSandbox in resource.data") ||
            accountBlockMatch[0].includes("'isEduSandbox' in resource.data"),
        'accounts/{accountId} en firestore.rules debe verificar isEduSandbox'
    );

    const appTsxSrc = fs.readFileSync(path.resolve(__dirname, '../../../web/src/App.tsx'), 'utf8');
    assert.match(
        appTsxSrc,
        /path="\/b2b\/empresa"[\s\S]{0,220}disallowEdu/,
        '/b2b/empresa en App.tsx debe exigir disallowEdu'
    );
    assert.match(
        appTsxSrc,
        /path="\/b2b\/metricas"[\s\S]{0,220}disallowEdu/,
        '/b2b/metricas en App.tsx debe exigir disallowEdu'
    );

    const mobileLoginSrc = fs.readFileSync(
        path.resolve(__dirname, '../../../web/src/pages/mobile/MobileLogin.tsx'),
        'utf8'
    );
    assert.equal(
        mobileLoginSrc.includes('/api/public/accounts-by-id'),
        false,
        'MobileLogin.tsx no debe invocar el endpoint retirado /api/public/accounts-by-id'
    );
    console.log('✅ [R1.4] firestore.rules (isEduSandbox), App.tsx (disallowEdu) y MobileLogin.tsx verificados');
}

async function testR2_2_TenantStatusAndOtpRedaction(): Promise<void> {
    resetHarnessState();

    // 1) Aprobación EDU -> accountTier: 5 y auth.updateUser(emailVerified: true, disabled: false)
    const eduAccId = 'edu-inst-001';
    const eduOwnerUid = 'edu-owner-001';
    await mockAuth.createUser({
        uid: eduOwnerUid,
        email: 'decano@universidad.cl',
        emailVerified: false,
        disabled: true,
    });
    await mockDb.collection('accounts').doc(eduAccId).set({
        id: eduAccId,
        name: 'Facultad Ingeniería Minera',
        ownerId: eduOwnerUid,
        type: 'EDUCATIONAL',
        classification: 'edu',
        isEduSandbox: true,
        countryCode: 'CL',
        taxId: '60910000-1',
        status: 'PENDING_APPROVAL',
        mandatario: { email: 'decano@universidad.cl', jobTitle: 'PROFESSOR' },
    });
    await mockDb.collection('tenants').doc(eduAccId).set({
        id: eduAccId,
        type: 'EDUCATIONAL',
        isEduSandbox: true,
        email: 'decano@universidad.cl',
        rut: '60910000-1',
        status: 'PENDING_APPROVAL',
    });

    const approveEduRes = await invokeHandlerStack([updateTenantStatus], {
        method: 'PATCH',
        params: { uid: eduAccId },
        ip: '10.2.2.1',
        user: { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN', admin: true },
        body: { status: 'ACTIVE', confirmationKeyword: 'ACTUALIZAR' },
    });
    assert.equal(approveEduRes.status, 200);
    const eduClaimsCall = customClaimsCalls.find((c) => c.uid === eduOwnerUid);
    assert.equal(eduClaimsCall?.claims?.accountTier, 5, 'Cuenta EDU debe recibir accountTier: 5');
    assert.ok(
        updateUserCalls.some(
            (c) => c.uid === eduOwnerUid && c.props.emailVerified === true && c.props.disabled === false
        ),
        'updateTenantStatus ACTIVE debe habilitar y marcar emailVerified: true en Auth'
    );

    // 2) Suspensión propaga SUSPENDED a TODOS los miembros de accounts/{id}/members
    const suspId = 'b2b-susp-001';
    for (const mUid of ['mem-s1', 'mem-s2']) {
        await mockAuth.createUser({ uid: mUid, email: `${mUid}@empresa.cl`, emailVerified: true, disabled: false });
        await mockDb.collection('accounts').doc(suspId).collection('members').doc(mUid).set({
            userId: mUid,
            role: mUid === 'mem-s1' ? 'OWNER' : 'ADMIN',
            status: 'ACTIVE',
        });
        await mockDb.collection('users').doc(mUid).set({
            uid: mUid,
            status: 'ACTIVE',
            memberships: [{ accountId: suspId, role: 'OWNER', status: 'ACTIVE' }],
        });
    }
    await mockDb.collection('accounts').doc(suspId).set({
        id: suspId,
        name: 'Minera Norte SpA',
        ownerId: 'mem-s1',
        type: 'BUSINESS',
        status: 'ACTIVE',
    });

    const suspRes = await invokeHandlerStack([updateTenantStatus], {
        method: 'PATCH',
        params: { uid: suspId },
        ip: '10.2.2.2',
        user: { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN', admin: true },
        body: { status: 'SUSPENDED', confirmationKeyword: 'ACTUALIZAR' },
    });
    assert.equal(suspRes.status, 200);
    for (const mUid of ['mem-s1', 'mem-s2']) {
        const mSnap = await mockDb.collection('accounts').doc(suspId).collection('members').doc(mUid).get();
        assert.equal(mSnap.data()?.status, 'SUSPENDED');
        const uSnap = await mockDb.collection('users').doc(mUid).get();
        assert.equal(uSnap.data()?.memberships?.[0]?.status, 'SUSPENDED');
    }

    // 3) Rechazo propaga REJECTED a TODOS los miembros de accounts/{id}/members
    const rejId = 'b2b-rej-001';
    for (const mUid of ['mem-r1', 'mem-r2']) {
        await mockAuth.createUser({ uid: mUid, email: `${mUid}@empresa.cl`, emailVerified: false, disabled: false });
        await mockDb.collection('accounts').doc(rejId).collection('members').doc(mUid).set({
            userId: mUid,
            role: mUid === 'mem-r1' ? 'OWNER' : 'OPERATOR',
            status: 'PENDING_APPROVAL',
        });
        await mockDb.collection('users').doc(mUid).set({
            uid: mUid,
            status: 'PENDING_APPROVAL',
            memberships: [{ accountId: rejId, role: 'OWNER', status: 'PENDING_APPROVAL' }],
        });
    }
    await mockDb.collection('accounts').doc(rejId).set({
        id: rejId,
        name: 'Faena Sur Ltda',
        ownerId: 'mem-r1',
        type: 'BUSINESS',
        status: 'PENDING_APPROVAL',
    });

    const rejRes = await invokeHandlerStack([updateTenantStatus], {
        method: 'PATCH',
        params: { uid: rejId },
        ip: '10.2.2.3',
        user: { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN', admin: true },
        body: {
            status: 'REJECTED',
            rejectionReason: 'Documentación tributaria incompleta',
            confirmationKeyword: 'ACTUALIZAR',
        },
    });
    assert.equal(rejRes.status, 200);
    for (const mUid of ['mem-r1', 'mem-r2']) {
        const mSnap = await mockDb.collection('accounts').doc(rejId).collection('members').doc(mUid).get();
        assert.equal(mSnap.data()?.status, 'REJECTED');
        const uSnap = await mockDb.collection('users').doc(mUid).get();
        assert.equal(uSnap.data()?.memberships?.[0]?.status, 'REJECTED');
    }

    // 4) sendAccessEmailOtp pasa redactSensitiveOtp: true y oculta OTP en system_emails
    const otpRes = await invokeHandlerStack([sendAccessEmailOtp], {
        method: 'POST',
        ip: '10.2.2.4',
        user: { uid: 'otp-user-1', email: 'acceso@mineria.cl' },
        body: {},
    });
    assert.equal(otpRes.status, 200);
    assert.equal(emailSendSpyCalls.at(-1)?.redactSensitiveOtp, true);
    const emailDocs = (await mockDb.collection('system_emails').get()).docs.map((d: any) => d.data());
    const otpEmailDoc = emailDocs.find((d: any) => d?.to === 'acceso@mineria.cl');
    assert.ok(otpEmailDoc, 'Debe haberse capturado el email OTP en system_emails');
    assert.ok(
        String(otpEmailDoc.body || '').includes('[OTP_REDACTED]'),
        'system_emails debe almacenar el OTP redactado como [OTP_REDACTED]'
    );
    console.log('✅ [R2.2] updateTenantStatus (Tier 5 EDU, propagación SUSPENDED/REJECTED) y OTP redacted verificados');
}

async function testR2_3_PilotExpiresAtAndForeignTaxId(): Promise<void> {
    resetHarnessState();

    // Caso A: Piloto incluye pilotExpiresAt en createCustomToken
    const pilotAccId = 'pilot-setup-1';
    const pilotUid = 'uid_pilot_setup_1';
    const pilotToken = 'setup-token-pilot-001';
    const expiresAtFuture = Date.now() + 7 * 86_400_000;

    await mockAuth.createUser({
        uid: pilotUid,
        email: 'piloto.setup@minreport.com',
        emailVerified: true,
        customClaims: { role: 'TEST_PILOT', activeAccountId: pilotAccId },
    });
    await mockDb.collection('test_pilots').doc(pilotAccId).set({
        id: pilotAccId,
        userId: pilotUid,
        status: 'PENDING_SETUP',
        expiresAt: expiresAtFuture,
    });
    await mockDb.collection('accounts').doc(pilotAccId).set({
        id: pilotAccId,
        status: 'ACTIVE',
        type: 'TEST_PILOT',
    });
    await mockDb.collection('users').doc(pilotUid).set({
        uid: pilotUid,
        email: 'piloto.setup@minreport.com',
        role: 'TEST_PILOT',
        memberships: [{ accountId: pilotAccId, role: 'TEST_PILOT', status: 'PENDING', authEmail: 'piloto.setup@minreport.com' }],
    });
    await mockDb.collection('setup_tokens').doc(pilotToken).set({
        accountId: pilotAccId,
        uid: pilotUid,
        taxId: pilotUid,
        used: false,
        expiresAt: Date.now() + 86_400_000,
    });

    const pilotSetupRes = await invokeHandlerStack([setupAccountPassword], {
        method: 'POST',
        ip: '10.2.3.1',
        body: {
            token: pilotToken,
            accountId: pilotAccId,
            password: 'PilotPassword!2026',
            taxId: '12-3456789',
        },
    });
    assert.equal(pilotSetupRes.status, 200, `Setup piloto falló: ${JSON.stringify(pilotSetupRes.body)}`);
    const lastCustomToken = customTokenCalls.find((c) => c.uid === pilotUid);
    assert.equal(
        lastCustomToken?.claims?.pilotExpiresAt,
        expiresAtFuture,
        'createCustomToken para TEST_PILOT debe propagar pilotExpiresAt'
    );

    // Caso B: Tax ID extranjero (EIN 12-3456789) NO se corrompe con formatRut
    const usAccId = 'b2b-us-setup-1';
    const usUid = 'uid_us_owner_1';
    const usToken = 'setup-token-us-001';

    await mockAuth.createUser({
        uid: usUid,
        email: 'ops@nevadamining.us',
        emailVerified: true,
        customClaims: { role: 'OWNER', activeAccountId: usAccId },
    });
    await mockDb.collection('accounts').doc(usAccId).set({
        id: usAccId,
        status: 'ACTIVE',
        type: 'BUSINESS',
        countryCode: 'US',
    });
    await mockDb.collection('users').doc(usUid).set({
        uid: usUid,
        email: 'ops@nevadamining.us',
        taxId: '12-3456789',
        role: 'OWNER',
        memberships: [{ accountId: usAccId, role: 'OWNER', status: 'PENDING', authEmail: 'ops@nevadamining.us' }],
    });
    await mockDb.collection('setup_tokens').doc(usToken).set({
        accountId: usAccId,
        uid: usUid,
        taxId: '12-3456789',
        used: false,
        expiresAt: Date.now() + 86_400_000,
    });

    const usSetupRes = await invokeHandlerStack([setupAccountPassword], {
        method: 'POST',
        ip: '10.2.3.2',
        body: {
            token: usToken,
            accountId: usAccId,
            password: 'NevadaPassword!2026',
            taxId: '12-3456789',
        },
    });
    assert.equal(usSetupRes.status, 200, `Setup Tax ID extranjero falló: ${JSON.stringify(usSetupRes.body)}`);
    const usUserAfter = (await mockDb.collection('users').doc(usUid).get()).data();
    assert.equal(
        usUserAfter?.taxId,
        '12-3456789',
        'Tax ID extranjero 12-3456789 no debe alterarse ni perder su guión interno'
    );
    console.log('✅ [R2.3 + C1-e2] setupAccountPassword propaga pilotExpiresAt y preserva Tax ID extranjero 12-3456789');
}

async function testR2_4_CatalogPublishCacheInvalidationSpecsAndUniqueness(): Promise<void> {
    resetHarnessState();

    // 1) Precalentar caché de proyección de GET /api/assets/catalog (TTL 30s)
    await mockDb.collection('global_asset_catalog').doc('KOMATSU_930E').set({
        make_oficial: 'KOMATSU',
        model_oficial: '930E',
        tipo_equipo: 'Camión Tolva',
        categoria_equipo: 'TRANSPORTE_MINERO',
        caracteristicas_principales: ['Potencia: 2013 kW'],
        contexto_operativo: ['MINERIA'],
    });

    const catalogHandlers = getRouteHandlersFromRouter(assetsRouter, '/catalog', 'get');
    const warmRes = await invokeHandlerStack(catalogHandlers, {
        method: 'GET',
        ip: '10.2.4.1',
        opermaqContext: {
            uid: 'dev-master-root-uid',
            capabilities: { canViewMasterCatalog: true, canCurateAI: true },
        },
    });
    assert.equal(warmRes.status, 200);
    assert.equal(warmRes.body?.items?.length, 1);

    // 2) Publicar solicitud desde equipment-onboarding mientras el caché está vivo
    const tenantId = 'b2b-fleet-caex';
    await mockDb.collection('equipment_onboarding_requests').doc('req-caex-1').set({
        tenantId,
        accountId: tenantId,
        unitIdentifierType: 'SERIE',
        unitIdentifierValue: 'CAEX-797-01',
        status: 'PENDING_DEV_REVIEW',
        resources: [
            {
                kind: 'MANUAL_PDF',
                downloadUrl: 'https://storage.googleapis.com/cas/cat-797f-manual.pdf',
                sha256: 'a'.repeat(64),
                originalBytes: 250_000,
                optimizedBytes: 42_000,
            },
        ],
    });

    const publishHandlers = getRouteHandlersFromRouter(equipmentOnboardingRouter, '/:requestId/publish', 'post');
    const publishRes = await invokeHandlerStack(publishHandlers, {
        method: 'POST',
        params: { requestId: 'req-caex-1' },
        ip: '10.2.4.2',
        user: {
            uid: 'dev-master-root-uid',
            email: 'dev@minreport.com',
            role: 'DEV_ROOT',
            isMasterDev: true,
            email_verified: true,
        },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            makeOficial: 'CATERPILLAR',
            modelOficial: '797F',
            tipoEquipo: 'Camión Tolva Minero CAEX',
            categoriaEquipo: 'TRANSPORTE_MINERO',
            version: 'AC-TIER4',
            ambienteOperativo: ['MINERIA_RAJO_ABIERTO'],
            contextoOperativo: ['ACARREO_MINA'],
            caracteristicasPrincipales: [
                'Potencia: 2014 kW',
                'Peso operativo: 505000 kg',
                'Voltaje sistema tracción AC: 2600V',
                'Capacidad tolva 291 t',
            ],
            autoRegisterFleetUnit: true,
        },
    });
    assert.equal(publishRes.status, 200, `Publish falló: ${JSON.stringify(publishRes.body)}`);

    // 3) En 0ms (sin esperar TTL 30s), GET /api/assets/catalog debe retornar el equipo y sus specs
    const instantCatalogRes = await invokeHandlerStack(catalogHandlers, {
        method: 'GET',
        ip: '10.2.4.3',
        opermaqContext: {
            uid: 'dev-master-root-uid',
            capabilities: { canViewMasterCatalog: true, canCurateAI: true },
        },
    });
    assert.equal(instantCatalogRes.status, 200);
    const items: any[] = instantCatalogRes.body?.items || [];
    const publishedItem = items.find(
        (it) => it.make_oficial === 'CATERPILLAR' && it.model_oficial === '797F'
    );
    assert.ok(publishedItem, 'Catálogo debe reflejar en 0ms el nuevo equipo tras invalidateCatalogProjectionCache()');

    const serializedJoined = (publishedItem.caracteristicas_principales || []).join(' | ');
    assert.ok(serializedJoined.includes('2014 kW'), `Falta potencia canónica en: ${serializedJoined}`);
    assert.ok(serializedJoined.includes('505000 kg'), `Falta Peso operativo libre en: ${serializedJoined}`);
    assert.ok(
        serializedJoined.includes('Voltaje sistema tracción AC') && serializedJoined.includes('2600V'),
        `Falta parámetro libre con dos puntos en: ${serializedJoined}`
    );
    assert.ok(
        serializedJoined.includes('Capacidad tolva') && serializedJoined.includes('291 t'),
        `Falta parámetro libre sin dos puntos en: ${serializedJoined}`
    );

    // 4) Segundo intento en el mismo tenant con mismo unitIdentifierValue -> 409 IDENTIFICADOR_DUPLICADO_EN_FLOTA
    const catalogBeforeDupCount = (await mockDb.collection('global_asset_catalog').get()).size;
    const fleetBeforeDupCount = (await mockDb.collection('tenant_assets').get()).size;

    await mockDb.collection('equipment_onboarding_requests').doc('req-caex-dup').set({
        tenantId,
        accountId: tenantId,
        unitIdentifierType: 'SERIE',
        unitIdentifierValue: 'caex 797 01',
        status: 'PENDING_DEV_REVIEW',
        resources: [
            {
                kind: 'MANUAL_PDF',
                downloadUrl: 'https://storage.googleapis.com/cas/cat-797f-dup.pdf',
                sha256: 'b'.repeat(64),
                originalBytes: 120_000,
                optimizedBytes: 25_000,
            },
        ],
    });

    const dupPublishRes = await invokeHandlerStack(publishHandlers, {
        method: 'POST',
        params: { requestId: 'req-caex-dup' },
        ip: '10.2.4.4',
        user: {
            uid: 'dev-master-root-uid',
            email: 'dev@minreport.com',
            role: 'DEV_ROOT',
            isMasterDev: true,
            email_verified: true,
        },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            makeOficial: 'CATERPILLAR',
            modelOficial: '798AC',
            tipoEquipo: 'Camión Tolva Minero CAEX',
            categoriaEquipo: 'TRANSPORTE_MINERO',
            version: 'AC',
            ambienteOperativo: ['MINERIA_RAJO_ABIERTO'],
            contextoOperativo: ['ACARREO_MINA'],
            caracteristicasPrincipales: ['Potencia: 2610 kW', 'Peso operativo: 510000 kg'],
            autoRegisterFleetUnit: true,
        },
    });
    assert.equal(dupPublishRes.status, 409);
    assert.equal(dupPublishRes.body?.error, 'IDENTIFICADOR_DUPLICADO_EN_FLOTA');

    assert.equal(
        (await mockDb.collection('global_asset_catalog').get()).size,
        catalogBeforeDupCount,
        'Un 409 IDENTIFICADOR_DUPLICADO_EN_FLOTA no debe crear documentos en global_asset_catalog'
    );
    assert.equal(
        (await mockDb.collection('tenant_assets').get()).size,
        fleetBeforeDupCount,
        'Un 409 IDENTIFICADOR_DUPLICADO_EN_FLOTA no debe crear documentos en tenant_assets'
    );
    console.log('✅ [R2.4] Publish invalida caché en 0ms, preserva canonical_specs libres y bloquea duplicados 409 antes de escribir');
}

async function testR3_ColdAuthDevLoginAndTtlIndexes(): Promise<void> {
    resetHarnessState();

    // Firebase Auth completamente vacío (en frío: sin dev-master-root-uid)
    assert.equal(authUsersByUid.has('dev-master-root-uid'), false);

    const password = process.env.DEV_ROOT_PASSWORD || 'TestDevRootPassword!2026';
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');

    await mockDb.collection('system_dev_meta').doc('credentials').set({
        passwordHash,
        salt,
        passwordRotatedAt: Date.now() - 40 * 86_400_000, // Fuerza rotación y llamada a auth.updateUser(DEV_ROOT_UID)
        rotationDays: 30,
    });

    const challengeId = 'dev-chal-cold-1';
    const clientToken = 'client-tok-cold-1';
    const stepToken = 'step-tok-cold-1';
    const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

    await mockDb.collection('dev_challenges').doc(challengeId).set({
        id: challengeId,
        clientTokenHash: sha(clientToken),
        emailTokenHash: sha('email-tok'),
        otpHash: sha('123456'),
        stepTokenHash: sha(stepToken),
        status: 'OTP_VERIFIED',
        attemptsRemaining: 3,
        ip: '127.0.0.1',
        userAgent: 'TestRunner',
        createdAt: Date.now(),
        expiresAt: Date.now() + 180_000,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ idToken: encodeMockBearer({ uid: 'dev-master-root-uid' }).replace(/^Bearer\s+/, '') }),
    })) as any;

    let loginRes: Awaited<ReturnType<typeof DevChallengeService.loginFinal>>;
    try {
        loginRes = await DevChallengeService.loginFinal(
            challengeId,
            clientToken,
            stepToken,
            'dev@minreport.com',
            password,
            'NewRotatedDevPassword!2026'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(loginRes.success, true, `loginFinal en frío falló: ${loginRes.error}`);
    assert.ok(typeof loginRes.firebaseToken === 'string' && loginRes.firebaseToken.length > 0);
    assert.equal(
        authUsersByUid.has('dev-master-root-uid'),
        true,
        'loginFinal debe aprovisionar dev-master-root-uid antes de auth.updateUser en Auth frío'
    );

    const indexesRaw = fs.readFileSync(path.resolve(__dirname, '../../../firestore.indexes.json'), 'utf8');
    const indexesJson = JSON.parse(indexesRaw) as {
        indexes: unknown[];
        fieldOverrides: Array<{
            collectionGroup: string;
            fieldPath: string;
            ttl?: boolean;
            indexes: unknown[];
        }>;
    };
    const expectedTtlCollections = [
        'ai_inference_cache',
        'auth_otp_challenges',
        'dev_challenges',
        'equipment_onboarding_requests',
        'setup_tokens',
        'tenants',
        'accounts',
        'test_pilots',
        'users',
        'webauthn_challenges',
    ];
    for (const col of expectedTtlCollections) {
        const override = indexesJson.fieldOverrides.find(
            (o) => o.collectionGroup === col && o.fieldPath === 'ttlExpiresAt'
        );
        assert.ok(override, `firestore.indexes.json debe definir fieldOverride TTL en ${col}.ttlExpiresAt`);
        assert.equal(override.ttl, true);
        assert.deepEqual(override.indexes, []);
    }
    console.log('✅ [R3] loginFinal en DB fría aprovisiona DEV_ROOT antes de updateUser y firestore.indexes.json define 10 TTL overrides');
}

async function runAll(): Promise<void> {
    await testR1_1_WebAuthnNullUserHandle();
    await testR1_2_RevokeTestPilotAndRules();
    await testR1_3_HitlResolveAndProfessorAiContext();
    await testR1_4_EduIsolationStaticGuardrails();
    await testR2_2_TenantStatusAndOtpRedaction();
    await testR2_3_PilotExpiresAtAndForeignTaxId();
    await testR2_4_CatalogPublishCacheInvalidationSpecsAndUniqueness();
    await testR3_ColdAuthDevLoginAndTtlIndexes();
    console.log('ALL_PASSED 8/8 bloque-r1-r3-integration tests');
}

runAll().catch((err) => {
    console.error('❌ Fallo en bloque-r1-r3-integration.test.ts:', err);
    process.exit(1);
});
