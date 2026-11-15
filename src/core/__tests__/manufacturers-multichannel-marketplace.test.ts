/**
 * Suite Sandbox-Safe E2E — OPERMAQ · FABRICANTES v2.0 (Multicanal 4D, Zero-Preset, CAS SVG, Ley 21.719, x402)
 *
 * IMPORTANTE (macOS Sandbox): Registra stubs en `require.cache` ANTES de importar módulos
 * que carguen `config/firebase` o `firebase-admin`, evitando inicializar gRPC/Keychain (`SecItemCopyMatching`).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
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
const storageFiles = new Map<string, { buffer: Buffer; metadata: Record<string, any> }>();
const verifyIdTokenMap = new Map<string, Record<string, any>>();
let autoDocSeq = 0;

function resetMocks(): void {
    dbCollections.clear();
    storageFiles.clear();
    verifyIdTokenMap.clear();
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
                } else if (f.op === 'array-contains') {
                    if (!Array.isArray(candidate) || !candidate.includes(f.value)) return false;
                } else if (f.op === 'array-contains-any') {
                    if (
                        !Array.isArray(candidate) ||
                        !Array.isArray(f.value) ||
                        !f.value.some((v) => candidate.includes(v))
                    ) {
                        return false;
                    }
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
                        if (!entry) throw new Error(`No such object: ${filePath}`);
                        return [
                            {
                                contentType: entry.metadata.contentType || 'application/octet-stream',
                                size: String(entry.buffer.length),
                                metadata: entry.metadata,
                            },
                        ];
                    },
                    async download() {
                        const entry = storageFiles.get(filePath);
                        if (!entry) throw new Error(`No such object: ${filePath}`);
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
        if (!decoded) throw new Error(`Invalid token: ${token}`);
        return decoded;
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
const ssrfGuard = require('../../utils/ssrfGuard') as typeof import('../../utils/ssrfGuard');
const { AISwarmUnavailableError, ResilientAIClient } = require('../../core/resilient-ai-client') as typeof import('../../core/resilient-ai-client');
const { AuditLedger } = require('../../core/audit-ledger') as typeof import('../../core/audit-ledger');
const { x402Gatekeeper } = require('../../middleware/x402Gatekeeper') as typeof import('../../middleware/x402Gatekeeper');
const { SupplierChannelResolveQuerySchema } =
    require('../../contracts/manufacturers.contracts') as typeof import('../../contracts/manufacturers.contracts');
const {
    clearLearnedManufacturerAliasesForTest,
    detectCanonicalMake,
    parseIndustrialSearchQuery,
} = require('../../modules/opermaq/services/CanonicalEntityResolver') as typeof import('../../modules/opermaq/services/CanonicalEntityResolver');
const {
    ensureManufacturerOnEquipmentRegistration,
    normalizeManufacturerKey,
    sanitizeCorporatePhone,
    sanitizeFunctionalCorporateEmail,
    ManufacturerRegistryService,
} = require('../../modules/opermaq/services/ManufacturerRegistryService') as typeof import('../../modules/opermaq/services/ManufacturerRegistryService');
const { ManufacturerLogoHunterService } =
    require('../../modules/opermaq/services/ManufacturerLogoHunterService') as typeof import('../../modules/opermaq/services/ManufacturerLogoHunterService');
const {
    buildSupplierKey,
    normalizeTaxIdCompact,
    SupplierChannelResolverService,
} = require('../../modules/opermaq/services/SupplierChannelResolverService') as typeof import('../../modules/opermaq/services/SupplierChannelResolverService');
const manufacturersRouter =
    require('../../modules/opermaq/routes/manufacturers.routes').default as import('express').Router;

function createMockRes(): {
    res: Response;
    statusCode: () => number;
    jsonBody: () => any;
    headers: Record<string, string>;
    donePromise: Promise<void>;
} {
    let status = 200;
    let body: any = null;
    const headers: Record<string, string> = {};
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
    });

    const res: any = {
        headersSent: false,
        status(code: number) {
            status = code;
            return res;
        },
        set(k: string | Record<string, string>, v?: string) {
            if (typeof k === 'string') headers[k.toLowerCase()] = String(v ?? '');
            else for (const [hk, hv] of Object.entries(k)) headers[hk.toLowerCase()] = String(hv);
            return res;
        },
        setHeader(k: string, v: string) {
            headers[k.toLowerCase()] = String(v);
        },
        getHeader(k: string) {
            return headers[k.toLowerCase()];
        },
        json(payload: any) {
            body = payload;
            res.headersSent = true;
            resolveDone();
            return res;
        },
        send(payload: any) {
            body = payload;
            res.headersSent = true;
            resolveDone();
            return res;
        },
        end() {
            res.headersSent = true;
            resolveDone();
            return res;
        },
    };

    return {
        res: res as Response,
        statusCode: () => status,
        jsonBody: () => body,
        headers,
        donePromise,
    };
}

async function invokeManufacturersRouter(opts: {
    method: string;
    url: string;
    body?: any;
    opermaqContext: Record<string, any>;
    user?: { uid: string; email?: string };
}): Promise<{ status: number; body: any }> {
    const req: any = {
        method: opts.method.toUpperCase(),
        url: opts.url,
        originalUrl: `/api/manufacturers${opts.url}`,
        path: opts.url.split('?')[0],
        headers: { 'content-type': 'application/json' },
        body: opts.body ?? {},
        query: {},
        opermaqContext: opts.opermaqContext,
        user: opts.user || { uid: opts.opermaqContext.actorId || 'uid-test', email: 'test@minreport.com' },
    };

    const queryString = opts.url.includes('?') ? opts.url.split('?')[1] : '';
    if (queryString) {
        const params = new URLSearchParams(queryString);
        for (const [k, v] of params.entries()) {
            req.query[k] = v;
        }
    }

    const mock = createMockRes();
    let finalized = false;
    const routerPromise = new Promise<void>((resolve, reject) => {
        (manufacturersRouter as any)(req as Request, mock.res, (err?: any) => {
            if (err) reject(err);
            else resolve();
        });
    });

    await Promise.race([
        mock.donePromise.then(() => {
            finalized = true;
        }),
        routerPromise.then(() => {
            finalized = true;
        }),
    ]);

    assert.equal(finalized, true, `Router did not finalize for ${opts.method} ${opts.url}`);
    return { status: mock.statusCode(), body: mock.jsonBody() };
}

async function run(): Promise<void> {
    const originalGenerate = ResilientAIClient.generate;
    const originalGenerateStructured = ResilientAIClient.generateStructured;
    const originalSafeFetchExternal = ssrfGuard.safeFetchExternal;
    const originalAssertSafeExternalUrl = ssrfGuard.assertSafeExternalUrl;
    const originalAuditRecord = AuditLedger.record;

    const cleanSvgSample =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#111111"/><path d="M10 10H110V30H10Z" fill="#C68346"/></svg>';

    // Stub determinista sin red ni APIs externas en sandbox macOS
    (ssrfGuard as any).assertSafeExternalUrl = async (rawUrl: string) => new URL(rawUrl);
    (ssrfGuard as any).safeFetchExternal = async (url: string) => {
        const htmlSites: Record<string, string> = {
            'https://www.caterpillar.com': '<link rel="icon" href="/assets/cat-logo.svg">',
            'https://www.macktrucks.com': '<link rel="icon" href="/assets/mack-logo.svg">',
            'https://www.peugeot.com': '<link rel="icon" href="/assets/peugeot-logo.svg">',
        };
        if (htmlSites[url]) {
            return {
                ok: true,
                status: 200,
                headers: new Map([['content-type', 'text/html; charset=utf-8']]),
                text: async () => `<html><head>${htmlSites[url]}</head><body></body></html>`,
                arrayBuffer: async () => Buffer.from(''),
            };
        }
        if (
            url === 'https://www.caterpillar.com/assets/cat-logo.svg' ||
            url === 'https://www.macktrucks.com/assets/mack-logo.svg' ||
            url === 'https://www.peugeot.com/assets/peugeot-logo.svg'
        ) {
            const buf = Buffer.from(cleanSvgSample, 'utf8');
            return {
                ok: true,
                status: 200,
                headers: new Map([['content-type', 'image/svg+xml']]),
                text: async () => cleanSvgSample,
                arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            };
        }
        return {
            ok: false,
            status: 404,
            headers: new Map(),
            arrayBuffer: async () => new ArrayBuffer(0),
            text: async () => '',
        };
    };

    let aiBrandMode: 'KNOWN_CAT' | 'NO_WEB_LOCAL' = 'KNOWN_CAT';
    (ResilientAIClient as any).generate = async (req: { prompt: string }) => {
        if (req.prompt.includes('Investiga distribuidores autorizados')) {
            return {
                text: 'Finning Chile S.A. (distribuidor autorizado CAT, sucursal Antofagasta) y SKC Maquinarias SpA (arriendo y usados multimarca).',
                groundingSources: [{ title: 'Finning Chile Oficial', uri: 'https://www.finning.com/es_CL.html' }],
                model: 'test-stub',
            };
        }
        if (aiBrandMode === 'NO_WEB_LOCAL') {
            return {
                text: 'Maestranza o taller hidráulico local sin sitio web corporativo público verificable.',
                groundingSources: [],
                model: 'test-stub',
            };
        }
        if (req.prompt.includes('Marca=Mack')) {
            return {
                text: 'Mack Trucks, Inc. es fabricante OEM de camiones pesados con sede en Greensboro, US y portal https://www.macktrucks.com.',
                groundingSources: [{ title: 'Mack Trucks Official', uri: 'https://www.macktrucks.com' }],
                model: 'test-stub',
            };
        }
        if (req.prompt.includes('Marca=Peugeot')) {
            return {
                text: 'Automobiles Peugeot es fabricante OEM automotriz con sede en Poissy, FR y portal https://www.peugeot.com.',
                groundingSources: [{ title: 'Peugeot Official', uri: 'https://www.peugeot.com' }],
                model: 'test-stub',
            };
        }
        return {
            text: 'Caterpillar Inc. es fabricante OEM de maquinaria pesada con sede en Irving, US, web https://www.caterpillar.com y repuestos https://parts.cat.com.',
            groundingSources: [{ title: 'Caterpillar Official', uri: 'https://www.caterpillar.com' }],
            model: 'test-stub',
        };
    };

    (ResilientAIClient as any).generateStructured = async (req: { prompt: string }) => {
        if (req.prompt.includes('empresas proveedoras/distribuidoras')) {
            return {
                data: {
                    suppliers: [
                        {
                            tradeName: 'Finning Chile S.A.',
                            legalName: 'Finning Chile S.A.',
                            countryIso2: 'CL',
                            supplierTaxId: '96.515.490-0',
                            officialWebsiteUrl: 'https://www.finning.com',
                            divisionName: 'División Minería y Repuestos CAT',
                            isOfficialDealer: true,
                            channels: ['NEW', 'PARTS', 'SERVICE'],
                            manufacturerNames: ['Caterpillar'],
                            archetypeIds: ['CAMION_TOLVA_CAEX'],
                            territories: ['CL', 'CL-AN'],
                            branches: [
                                {
                                    branchName: 'Sucursal La Negra',
                                    city: 'Antofagasta',
                                    regionIso: 'CL-AN',
                                    phone: '+56 55 200 1000',
                                    roleEmail: 'repuestos.antofagasta@finning.com',
                                    portalUrl: 'https://www.finning.com/es_CL.html',
                                },
                            ],
                        },
                        {
                            tradeName: 'SKC Maquinarias SpA',
                            legalName: 'SKC Maquinarias SpA',
                            countryIso2: 'CL',
                            supplierTaxId: '76.112.233-4',
                            officialWebsiteUrl: 'https://www.skc.cl',
                            divisionName: 'División Arriendo y Usados Multimarca',
                            isOfficialDealer: false,
                            channels: ['RENTAL', 'USED'],
                            manufacturerNames: ['Caterpillar'],
                            archetypeIds: ['ALL'],
                            territories: ['CL'],
                            branches: [
                                {
                                    branchName: 'Casa Matriz',
                                    city: 'Santiago',
                                    regionIso: 'CL-RM',
                                    phone: '+56 2 2400 3000',
                                    roleEmail: 'arriendo@skc.cl',
                                    portalUrl: 'https://www.skc.cl',
                                },
                            ],
                        },
                    ],
                },
                meta: { groundingSources: [], model: 'test-stub' },
            };
        }

        if (aiBrandMode === 'NO_WEB_LOCAL') {
            return {
                data: {
                    hasPublicWebFootprint: false,
                    officialName: 'Taller Hidráulico Norte Ltda',
                    legalCorporateName: null,
                    hqCountryIso2: 'CL',
                    hqCity: 'Antofagasta',
                    officialWebsiteUrl: null,
                    corporateContactUrl: null,
                    corporateEmail: null,
                    corporatePhone: null,
                    officialPartsUrl: null,
                    officialSupportUrl: null,
                    dealerLocatorUrl: null,
                    aliases: ['TALLER HIDRAULICO NORTE'],
                },
                meta: { groundingSources: [], model: 'test-stub' },
            };
        }

        if (req.prompt.includes('el fabricante "Mack"')) {
            return {
                data: {
                    hasPublicWebFootprint: true,
                    officialName: 'Mack',
                    legalCorporateName: 'Mack Trucks, Inc.',
                    hqCountryIso2: 'US',
                    hqCity: 'Greensboro',
                    officialWebsiteUrl: 'https://www.macktrucks.com',
                    corporateContactUrl: 'https://www.macktrucks.com/contact-us/',
                    corporateEmail: null,
                    corporatePhone: null,
                    officialPartsUrl: 'https://www.macktrucks.com/parts-and-services/',
                    officialSupportUrl: null,
                    dealerLocatorUrl: 'https://www.macktrucks.com/dealers/',
                    aliases: ['MACK', 'MACK TRUCKS'],
                },
                meta: {
                    groundingSources: [{ title: 'Mack Trucks Official', uri: 'https://www.macktrucks.com' }],
                    model: 'test-stub',
                },
            };
        }

        if (req.prompt.includes('el fabricante "Peugeot"')) {
            return {
                data: {
                    hasPublicWebFootprint: true,
                    officialName: 'Peugeot',
                    legalCorporateName: 'Automobiles Peugeot',
                    hqCountryIso2: 'FR',
                    hqCity: 'Poissy',
                    officialWebsiteUrl: 'https://www.peugeot.com',
                    corporateContactUrl: 'https://www.peugeot.com/en/contact.html',
                    corporateEmail: null,
                    corporatePhone: null,
                    officialPartsUrl: null,
                    officialSupportUrl: null,
                    dealerLocatorUrl: 'https://www.peugeot.com/en/dealers.html',
                    aliases: ['PEUGEOT', 'AUTOMOBILES PEUGEOT'],
                },
                meta: {
                    groundingSources: [{ title: 'Peugeot Official', uri: 'https://www.peugeot.com' }],
                    model: 'test-stub',
                },
            };
        }

        return {
            data: {
                hasPublicWebFootprint: true,
                officialName: 'Caterpillar',
                legalCorporateName: 'Caterpillar Inc.',
                hqCountryIso2: 'US',
                hqCity: 'Irving',
                officialWebsiteUrl: 'https://www.caterpillar.com',
                corporateContactUrl: 'https://www.caterpillar.com/en/company/contact.html',
                corporateEmail: null,
                corporatePhone: null,
                officialPartsUrl: 'https://parts.cat.com',
                officialSupportUrl: 'https://www.cat.com/en_US/support.html',
                dealerLocatorUrl: 'https://www.caterpillar.com/en/dealers.html',
                aliases: ['CAT', 'CATERPILLAR INC'],
            },
            meta: {
                groundingSources: [{ title: 'Caterpillar Official', uri: 'https://www.caterpillar.com' }],
                model: 'test-stub',
            },
        };
    };

    try {
        resetMocks();
        clearLearnedManufacturerAliasesForTest();
        AuditLedger.record = async () => 'ledger_mock_ok';

        // -------------------------------------------------------------------
        // (a.0) Escaneo retroactivo sobre equipos existentes + saneamiento Top Cat
        // -------------------------------------------------------------------
        {
            await mockDb.collection('global_asset_catalog').doc('caterpillar_242d').set({
                make_oficial: 'CATERPILLAR',
                model_oficial: '242D ESTANDAR',
                archetype_id: 'MINICARGADOR_SSL_CTL',
            });
            await mockDb.collection('global_asset_catalog').doc('caterpillar_272d').set({
                make_oficial: 'CATERPILLAR',
                model_oficial: '272D XHP',
                archetype_id: 'MINICARGADOR_SSL_CTL',
            });
            await mockDb.collection('global_asset_catalog').doc('mack_granite_gu813').set({
                make_oficial: 'MACK',
                model_oficial: 'GRANITE GU813 8X4 AUTOMATIC',
                archetype_id: 'CAMION_TOLVA_RUTA',
            });
            await mockDb.collection('global_asset_catalog').doc('mack_gu813_mp8').set({
                make_oficial: 'MACK',
                model_oficial: 'GU813 MP8',
                archetype_id: 'CAMION_TOLVA_RUTA',
            });
            await mockDb.collection('global_asset_catalog').doc('peugeot_landtrek').set({
                make_oficial: 'PEUGEOT',
                model_oficial: 'LANDTREK 4X4',
                archetype_id: 'VEHICULO_LIVIANO_TRANSPORTE',
            });

            const badLogoRef = {
                candidateId: 'cand_bad_topcat',
                sha256: 'a'.repeat(64),
                phashHex: '0123456789abcdef',
                storagePath: 'media_cas/global_oem/bad.svg',
                downloadUrl: `/api/media/blob/global_oem/${'a'.repeat(64)}.svg`,
                sourceKind: 'WIKIMEDIA_COMMONS_SVG',
                sourceUrl: 'https://commons.wikimedia.org/wiki/File:Top_Cat_logo.svg',
                originalBytes: 1000,
                optimizedBytes: 800,
                savingsPct: 20,
                wasVectorized: false,
                invertInDark: false,
                createdAt: Date.now() - 10000,
            };
            await mockDb.collection('global_manufacturers').doc('caterpillar').set({
                manufacturerKey: 'caterpillar',
                officialName: 'cat',
                legalCorporateName: null,
                aliases: ['CAT'],
                hqCountryIso2: 'MX',
                hqCity: null,
                officialWebsiteUrl: null,
                observedArchetypeIds: [],
                sampleModels: [],
                logoSvg: {
                    sha256: badLogoRef.sha256,
                    downloadUrl: badLogoRef.downloadUrl,
                    sourceKind: badLogoRef.sourceKind,
                    sourceUrl: badLogoRef.sourceUrl,
                    originalBytes: 1000,
                    optimizedBytes: 800,
                    savingsPct: 20,
                    invertInDark: false,
                },
                logoCandidates: [badLogoRef],
                curationStatus: 'AUTO_DISCOVERED',
                hasPublicWebFootprint: true,
                equipmentCount: 1,
                createdAt: Date.now() - 10000,
                updatedAt: Date.now() - 10000,
                verifiedByUid: null,
            });

            const syncRes = await ManufacturerRegistryService.syncManufacturersFromExistingEquipment({
                actorUid: 'uid-dev-sync',
                runAi: true,
                forceRefreshBroken: true,
            });

            assert.equal(syncRes.syncedCount, 3, 'Debe agrupar 5 equipos en 3 marcas OEM únicas (CAT, Mack, Peugeot)');
            const byKey = new Map(syncRes.manufacturers.map((m) => [m.manufacturerKey, m]));
            const catRec = byKey.get('caterpillar');
            const mackRec = byKey.get('mack');
            const peugeotRec = byKey.get('peugeot');

            assert.ok(catRec && mackRec && peugeotRec);
            assert.equal(catRec.equipmentCount, 2);
            assert.notEqual(catRec.officialName, 'cat');
            assert.equal(catRec.officialWebsiteUrl, 'https://www.caterpillar.com');
            assert.equal(catRec.officialContacts.officialPartsUrl, 'https://parts.cat.com');
            assert.equal(JSON.stringify(catRec).includes('Top_Cat'), false, 'Debe purgar contaminación Top_Cat');

            assert.equal(mackRec.equipmentCount, 2);
            assert.equal(mackRec.officialWebsiteUrl, 'https://www.macktrucks.com');

            assert.equal(peugeotRec.equipmentCount, 1);
            assert.equal(peugeotRec.hqCountryIso2, 'FR');

            console.log('✓ [a.0] Sincronización retroactiva 3 marcas OEM + saneamiento Top Cat OK');

            resetMocks();
            clearLearnedManufacturerAliasesForTest();
        }

        // -------------------------------------------------------------------
        // (a) Detección automática al registrar equipo + Auto-población IA (Zero-Preset)
        // -------------------------------------------------------------------
        {
            const catStub = await ensureManufacturerOnEquipmentRegistration({
                rawMake: 'Cat',
                archetypeId: 'CAMION_TOLVA_CAEX',
                actorUid: 'uid-op-1',
                skipBackgroundAi: true,
            });
            assert.ok(catStub);
            assert.equal(catStub.manufacturerKey, 'caterpillar');
            assert.equal(catStub.curationStatus, 'AUTO_DISCOVERED');
            assert.equal(catStub.equipmentCount, 1);

            const populatedCat = await ManufacturerRegistryService.autoPopulateManufacturerWithAi({
                manufacturerKey: 'caterpillar',
                actorUid: 'uid-sys',
            });
            assert.equal(populatedCat.curationStatus, 'AUTO_DISCOVERED', 'Auto-población sin pisar estado VERIFIED');
            assert.equal(populatedCat.officialName, 'Caterpillar');
            assert.equal(populatedCat.legalCorporateName, 'Caterpillar Inc.');
            assert.equal(populatedCat.hqCountryIso2, 'US');
            assert.equal(populatedCat.officialWebsiteUrl, 'https://www.caterpillar.com');
            assert.equal(populatedCat.officialContacts.officialPartsUrl, 'https://parts.cat.com');
            assert.ok(populatedCat.logoSvg !== null, 'Debe auto-poblar logoSvg desde sitio web');
            assert.ok(populatedCat.logoCandidates.length >= 1);

            const parsedQuery = parseIndustrialSearchQuery('Cat 797');
            assert.equal(parsedQuery.canonicalMake, 'CATERPILLAR');
            assert.equal(detectCanonicalMake('Caterpillar Inc'), 'CATERPILLAR');

            // Marca local sin presencia web: tolerancia cero a inventar URLs
            aiBrandMode = 'NO_WEB_LOCAL';
            await ensureManufacturerOnEquipmentRegistration({
                rawMake: 'Taller Hidráulico Norte',
                actorUid: 'uid-op-2',
                skipBackgroundAi: true,
            });
            const workshopKey = normalizeManufacturerKey('Taller Hidráulico Norte');
            const localWorkshop = await ManufacturerRegistryService.autoPopulateManufacturerWithAi({
                manufacturerKey: workshopKey,
                actorUid: 'uid-sys',
            });
            assert.equal(localWorkshop.hasPublicWebFootprint, false);
            assert.equal(localWorkshop.officialWebsiteUrl, null);
            assert.equal(localWorkshop.logoSvg, null);
            aiBrandMode = 'KNOWN_CAT';

            // Alta directa excepcional DEV
            const directTega = await ManufacturerRegistryService.createDirectManufacturer({
                actorUid: 'uid-dev-1',
                actorEmail: 'dev@minreport.com',
                isDevRoot: true,
                isEduSandbox: false,
                body: {
                    rawMake: 'Tega Industrias Andinas',
                    hqCountryIso2: 'CL',
                    officialWebsiteUrl: 'https://www.tegaindustries.com',
                    hasPublicWebFootprint: true,
                    runAiDiscovery: false,
                    confirmWord: 'ACTUALIZAR',
                },
            });
            assert.equal(directTega.curationStatus, 'VERIFIED');
            assert.equal(directTega.officialName, 'Tega Industrias Andinas');

            console.log('✓ [a] Detección automática y auto-población IA Zero-Preset + Taller Local OK');
        }

        // -------------------------------------------------------------------
        // (b) Digestión CAS SVG (XSS stripping, @visioncortex/vtracer, dHash, HITL)
        // -------------------------------------------------------------------
        {
            const dirtySvg = Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" onload="alert(1)"><script>fetch("https://evil.test")</script><rect x="0" y="0" width="120" height="40" fill="#111111"/><text x="12" y="26" fill="#C68346">CAT</text></svg>',
                'utf8'
            );
            const cleanCand = await ManufacturerLogoHunterService.ingestLogoBufferToCas(dirtySvg, {
                filename: 'cat_dirty.svg',
                actorUid: 'uid-dev-1',
                sourceKind: 'OFFICIAL_SVG',
                sourceUrl: 'https://www.caterpillar.com/logo.svg',
            });
            assert.ok(cleanCand.downloadUrl.startsWith('/api/media/blob/global_oem/'));
            assert.ok(cleanCand.storagePath && storageFiles.has(cleanCand.storagePath));
            const storedSvg = storageFiles.get(cleanCand.storagePath!)!.buffer.toString('utf8');
            assert.equal(storedSvg.includes('<script'), false, 'svgo debe purgar <script>');
            assert.equal(storedSvg.includes('onload'), false, 'svgo debe purgar atributos on*');
            assert.ok(cleanCand.originalBytes >= cleanCand.optimizedBytes);

            const rasterPng = await sharp({
                create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
            })
                .composite([
                    {
                        input: Buffer.from(
                            '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="16" y="32" width="96" height="64" fill="#111111"/></svg>'
                        ),
                        top: 0,
                        left: 0,
                    },
                ])
                .png()
                .toBuffer();

            const vecCand = await ManufacturerLogoHunterService.ingestLogoBufferToCas(rasterPng, {
                filename: 'cat_raster.png',
                actorUid: 'uid-dev-1',
                sourceKind: 'OFFICIAL_SVG',
            });
            assert.equal(vecCand.wasVectorized, true, '@visioncortex/vtracer debe vectorizar PNG -> SVG');
            assert.equal(vecCand.sourceKind, 'RASTER_VECTORIZED_VTRACER');
            assert.equal(vecCand.phashHex?.length, 16);

            const deduped = ManufacturerLogoHunterService.deduplicateCandidates([], [cleanCand, cleanCand, vecCand]);
            assert.equal(deduped.length, 2, 'deduplicateCandidates debe dedup SHA-256 idéntico');

            const uploadRes = await ManufacturerRegistryService.appendManualLogoCandidate({
                manufacturerKey: 'caterpillar',
                fileBuffer: dirtySvg,
                filename: 'manual_cat.svg',
                actorUid: 'uid-dev-1',
            });
            const verified = await ManufacturerRegistryService.updateManufacturerHitl({
                manufacturerKey: 'caterpillar',
                actorUid: 'uid-dev-1',
                actorEmail: 'dev@minreport.com',
                body: {
                    officialName: 'Caterpillar Inc.',
                    selectedLogoCandidateId: uploadRes.candidate.candidateId,
                    invertInDark: true,
                    confirmWord: 'ACTUALIZAR',
                },
            });
            assert.equal(verified.curationStatus, 'VERIFIED');
            assert.equal(verified.logoSvg?.sha256, uploadRes.candidate.sha256);
            assert.equal(verified.logoSvg?.invertInDark, true);

            console.log('✓ [b] Digestión CAS SVG (XSS, @visioncortex/vtracer, dHash, HITL ACTUALIZAR) OK');
        }

        // -------------------------------------------------------------------
        // (c) Dominio 2 Desacoplado: Descubrimiento IA Proveedores + Divisiones N:M
        // -------------------------------------------------------------------
        {
            const discovered = await SupplierChannelResolverService.discoverSuppliersWithAi({
                regionQuery: 'Antofagasta, Chile',
                manufacturerKey: 'caterpillar',
                actorUid: 'uid-dev-1',
            });
            assert.equal(discovered.suggestions.length, 2);
            const preApproveSuppliers = await SupplierChannelResolverService.listSuppliers();
            assert.equal(preApproveSuppliers.length, 0, 'HITL: IA no persiste sin aprobación DEV + ACTUALIZAR');

            const approved = await SupplierChannelResolverService.approveSupplierAiSuggestions({
                suggestions: discovered.suggestions,
                actorUid: 'uid-dev-1',
                actorEmail: 'dev@minreport.com',
            });
            assert.equal(approved.suppliers.length, 2);

            // Deduplicación multimarca N:M en colección única global_suppliers por countryIso2 + supplierTaxId
            await ensureManufacturerOnEquipmentRegistration({
                rawMake: 'Komatsu',
                archetypeId: 'EXCAVADORA_HIDRAULICA',
                actorUid: 'uid-op-3',
                skipBackgroundAi: true,
            });
            const sharedDealer = await SupplierChannelResolverService.upsertSupplierDivision({
                actorUid: 'uid-dev-1',
                actorEmail: 'dev@minreport.com',
                manufacturerKeys: ['komatsu'],
                tradeName: 'Finning Chile S.A.',
                countryIso2: 'CL',
                supplierTaxId: '965154900',
                divisionName: 'División Multimarca Repuestos',
                isOfficialDealer: false,
                channels: ['PARTS', 'SERVICE'],
                archetypeIds: ['EXCAVADORA_HIDRAULICA'],
                territories: ['CL', 'CL-AN'],
                city: 'Antofagasta',
                confirmWord: 'ACTUALIZAR',
            });
            assert.ok(sharedDealer.manufacturerKeys.includes('caterpillar'));
            assert.ok(sharedDealer.manufacturerKeys.includes('komatsu'));
            assert.equal(sharedDealer.divisions.length, 2, 'Un solo documento global_suppliers con 2 divisiones');

            const partsMatch = await SupplierChannelResolverService.resolveSupplierChannels({
                manufacturerKey: 'caterpillar',
                archetypeId: 'CAMION_TOLVA_CAEX',
                regionIso: 'CL-AN',
                channelIntent: 'PARTS',
            });
            assert.equal(partsMatch.officialMatches.length, 1);
            assert.equal(partsMatch.officialMatches[0].supplier.tradeName, 'Finning Chile S.A.');
            assert.equal(partsMatch.officialMatches[0].division.divisionName, 'División Minería y Repuestos CAT');

            const rentalMatch = await SupplierChannelResolverService.resolveSupplierChannels({
                manufacturerKey: 'caterpillar',
                regionIso: 'CL',
                channelIntent: 'RENTAL',
            });
            assert.equal(rentalMatch.independentMatches.length, 1);
            assert.equal(rentalMatch.independentMatches[0].supplier.tradeName, 'SKC Maquinarias SpA');

            console.log('✓ [c] Dominio 2 Descubrimiento IA proveedores + Divisiones N:M + Canales OK');
        }

        // -------------------------------------------------------------------
        // (d) Agenda Privada Multi-Tenant (Aislamiento estricto + Opcional sin marca)
        // -------------------------------------------------------------------
        {
            const cA = await SupplierChannelResolverService.upsertTenantPrivateContact({
                tenantId: 'tenant-a',
                actorUid: 'uid-a',
                manufacturerKey: 'caterpillar',
                distributorName: 'Maestranza La Negra Privada',
                channelType: 'SERVICE',
                cityRegion: 'Antofagasta',
                phone: '+56 9 1111 2222',
                emailOrWeb: 'taller@tenant-a.cl',
            });
            const cAGeneral = await SupplierChannelResolverService.upsertTenantPrivateContact({
                tenantId: 'tenant-a',
                actorUid: 'uid-a',
                manufacturerKey: null,
                distributorName: 'Tornería Industrial Multimarca Norte',
                channelType: 'PARTS',
                cityRegion: 'Calama',
                phone: '+56 55 233 9000',
            });

            await SupplierChannelResolverService.upsertTenantPrivateContact({
                tenantId: 'tenant-b',
                actorUid: 'uid-b',
                manufacturerKey: 'caterpillar',
                distributorName: 'Proveedor Secreto Tenant B',
                channelType: 'PARTS',
                cityRegion: 'Copiapó',
            });

            const resA = await SupplierChannelResolverService.resolveSupplierChannels({
                manufacturerKey: 'caterpillar',
                tenantId: 'tenant-a',
            });
            assert.equal(resA.tenantPrivateContacts.length, 1);
            assert.equal(resA.tenantPrivateContacts[0].distributorName, 'Maestranza La Negra Privada');

            const allPrivateA = await SupplierChannelResolverService.listTenantPrivateContacts('tenant-a');
            assert.equal(allPrivateA.length, 2, 'Agenda privada del tenant incluye contacto CAT y contacto multimarca sin marca fija');
            assert.ok(allPrivateA.some((c) => c.manufacturerKey === null && c.distributorName === 'Tornería Industrial Multimarca Norte'));

            const resGeneralA = await SupplierChannelResolverService.resolveSupplierChannels({
                tenantId: 'tenant-a',
            });
            assert.equal(resGeneralA.tenantPrivateContacts.length, 2);

            await SupplierChannelResolverService.deleteTenantPrivateContact({
                tenantId: 'tenant-a',
                contactId: cA.contactId,
                actorUid: 'uid-a',
            });
            await SupplierChannelResolverService.deleteTenantPrivateContact({
                tenantId: 'tenant-a',
                contactId: cAGeneral.contactId,
                actorUid: 'uid-a',
            });
            const afterDelA = await SupplierChannelResolverService.listTenantPrivateContacts('tenant-a');
            assert.equal(afterDelA.length, 0);

            console.log('✓ [d] Aislamiento multi-tenant contactos privados de empresa OK');
        }

        // -------------------------------------------------------------------
        // (e) Aportes Compartidos Ley N° 21.719 (Purga PII + TTL 30d rechazo)
        // -------------------------------------------------------------------
        {
            const contrib = await SupplierChannelResolverService.submitSupplierContribution({
                tenantId: 'tenant-a',
                actorUid: 'uid-a',
                manufacturerKey: 'caterpillar',
                distributorName: 'Servicio Hidráulico Norte',
                channelType: 'PARTS',
                countryIso2: 'CL',
                cityRegion: 'Antofagasta',
                phone: '+56 55 211 0000',
                notes: 'Atiende RUT 12.345.678-9 celular +56 9 8765 4321 en faena -23.65, -70.40',
            });
            assert.ok(contrib.piiPurgedCount > 0, 'Debe detectar y purgar PII chilena');
            assert.equal((contrib.sanitizedNotes || '').includes('12.345.678-9'), false);
            assert.equal((contrib.sanitizedNotes || '').includes('8765 4321'), false);

            const beforeRejectMs = Date.now();
            const rejected = await SupplierChannelResolverService.moderateSupplierContribution({
                contributionId: contrib.contributionId,
                decision: 'REJECT',
                actorUid: 'uid-dev-1',
                actorEmail: 'dev@minreport.com',
            });
            assert.equal(rejected.contribution.status, 'REJECTED');
            const ttlMs = (rejected.contribution.ttlExpiresAt as any)?.toMillis?.();
            assert.ok(typeof ttlMs === 'number', 'Rechazo debe fijar Timestamp nativo ttlExpiresAt');
            const daysDelta = (ttlMs - beforeRejectMs) / (1000 * 60 * 60 * 24);
            assert.ok(daysDelta >= 29.9 && daysDelta <= 30.1, `TTL esperado ~30 días, obtenido ${daysDelta}`);

            const secondContrib = await SupplierChannelResolverService.submitSupplierContribution({
                tenantId: 'tenant-a',
                actorUid: 'uid-a',
                manufacturerKey: 'caterpillar',
                distributorName: 'Suministros Mineros Calama',
                channelType: 'PARTS',
                countryIso2: 'CL',
                cityRegion: 'Calama',
            });
            const approved = await SupplierChannelResolverService.moderateSupplierContribution({
                contributionId: secondContrib.contributionId,
                decision: 'APPROVE',
                actorUid: 'uid-dev-1',
                actorEmail: 'dev@minreport.com',
            });
            assert.equal(approved.contribution.status, 'APPROVED');
            assert.ok(approved.supplier?.manufacturerKeys.includes('caterpillar'));

            console.log('✓ [e] Aportes Ley N° 21.719 (Purga PII + TTL 30d rechazo + promoción global) OK');
        }

        // -------------------------------------------------------------------
        // (f) Bloqueo HTTP 403 5º EDU + Lectura Pública 200
        // -------------------------------------------------------------------
        {
            const eduCtx = {
                tenantId: 'edu-sandbox-uc',
                actorId: 'uid-edu-1',
                actorEmail: 'alumno@uc.cl',
                countryCode: 'CL',
                accountTier: 5,
                isEduSandbox: true,
                capabilities: { canCurateAI: false },
            };

            const blockedRequests = [
                { method: 'POST', url: '/', body: { rawMake: 'Marca EDU', confirmWord: 'ACTUALIZAR' } },
                { method: 'POST', url: '/sync-existing', body: { runAi: false } },
                { method: 'POST', url: '/contacts/private', body: { manufacturerKey: 'caterpillar', distributorName: 'X', channelType: 'PARTS', cityRegion: 'CL' } },
                { method: 'DELETE', url: '/contacts/private/priv_123' },
                { method: 'POST', url: '/contributions', body: { distributorName: 'X', channelType: 'PARTS', cityRegion: 'CL' } },
                { method: 'POST', url: '/suppliers', body: { tradeName: 'X', divisionName: 'Repuestos', channels: ['PARTS'], confirmWord: 'ACTUALIZAR' } },
                { method: 'POST', url: '/suppliers/discover-ai', body: { regionQuery: 'Antofagasta, Chile' } },
                { method: 'POST', url: '/suppliers/approve-ai', body: { suggestions: [], confirmWord: 'ACTUALIZAR' } },
                { method: 'PUT', url: '/caterpillar', body: { officialName: 'Hack', confirmWord: 'ACTUALIZAR' } },
            ];
            for (const req of blockedRequests) {
                const res = await invokeManufacturersRouter({ ...req, opermaqContext: eduCtx });
                assert.equal(res.status, 403, `5º EDU bloqueado en ${req.method} ${req.url}`);
            }

            const rGet = await invokeManufacturersRouter({
                method: 'GET',
                url: '/resolve-channels?manufacturerKey=caterpillar&channelIntent=PARTS&regionIso=CL-AN',
                opermaqContext: eduCtx,
            });
            assert.equal(rGet.status, 200, '5º EDU sí puede consultar canales públicos');
            assert.equal(rGet.body.tenantPrivateContacts.length, 0);

            const rSuppliers = await invokeManufacturersRouter({
                method: 'GET',
                url: '/suppliers?manufacturerKey=caterpillar',
                opermaqContext: eduCtx,
            });
            assert.equal(rSuppliers.status, 200, '5º EDU sí puede leer agenda pública de proveedores');

            console.log('✓ [f] Bloqueo HTTP 403 en mutaciones 5º EDU y lectura pública OK');
        }

        // -------------------------------------------------------------------
        // (g) Monetización M2M x402 (`/api/m2m/suppliers/resolve`)
        // -------------------------------------------------------------------
        {
            const recordedAuditEntries: any[] = [];
            AuditLedger.record = async (entry: any) => {
                recordedAuditEntries.push(entry);
                return `ledger_mfg_${recordedAuditEntries.length}`;
            };

            const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
            const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

            await mockDb.collection('m2m_wallets').doc('agent-mfg-01').set({
                status: 'ACTIVE',
                tenantId: 'tenant-m2m-buyer',
                balanceMicroUsd: 100_000,
                publicKeyPem,
            });

            const middleware = x402Gatekeeper({
                priceMicroUSD: 15_000,
                destinationWallet: 'minreport-treasury-southamerica-west1',
                acceptedTokens: ['USDC', 'X402_CREDIT'],
                resourceId: 'opermaq-suppliers-4d-resolver',
            });

            // 1. Anónimo -> 402 Payment Required
            {
                let nextCalled = false;
                const req: any = {
                    ip: '198.51.100.10',
                    path: '/api/m2m/suppliers/resolve',
                    originalUrl: '/api/m2m/suppliers/resolve',
                    headers: {},
                    query: { manufacturerKey: 'caterpillar', channelIntent: 'PARTS', regionIso: 'CL-AN' },
                    socket: { remoteAddress: '198.51.100.10' },
                };
                const mock = createMockRes();
                await middleware(req, mock.res, () => {
                    nextCalled = true;
                });
                assert.equal(nextCalled, false);
                assert.equal(mock.statusCode(), 402);
                assert.ok(mock.headers['www-authenticate']?.includes('x402'));
            }

            // 2. Pago válido Ed25519 -> 200 solo canales públicos (0 privados) y descuento de billetera
            {
                const nowTs = Date.now();
                const nonce = 'nonce_mfg_x402_0001';
                const resource = 'opermaq-suppliers-4d-resolver';
                const amountMicroUsd = 15_000;
                const canonicalMsg = `agent-mfg-01|${resource}|${amountMicroUsd}|${nonce}|${nowTs}`;
                const sigB64 = crypto.sign(null, Buffer.from(canonicalMsg, 'utf8'), privateKey).toString('base64');

                let nextCalled = false;
                const req: any = {
                    ip: '198.51.100.11',
                    path: '/api/m2m/suppliers/resolve',
                    originalUrl: '/api/m2m/suppliers/resolve',
                    headers: {
                        'payment-signature': Buffer.from(
                            JSON.stringify({
                                agentId: 'agent-mfg-01',
                                resource,
                                amountMicroUsd,
                                nonce,
                                timestamp: nowTs,
                                signature: sigB64,
                                scheme: 'ED25519',
                            }),
                            'utf8'
                        ).toString('base64'),
                    },
                    query: {
                        manufacturerKey: 'caterpillar',
                        archetypeId: 'CAMION_TOLVA_CAEX',
                        channelIntent: 'PARTS',
                        regionIso: 'CL-AN',
                    },
                    socket: { remoteAddress: '198.51.100.11' },
                };
                const mock = createMockRes();
                await middleware(req, mock.res, () => {
                    nextCalled = true;
                });
                assert.equal(nextCalled, true, 'x402 Ed25519 válido debe habilitar resolución M2M');

                const parsed = SupplierChannelResolveQuerySchema.parse(req.query);
                const result = await SupplierChannelResolverService.resolveSupplierChannels({
                    manufacturerKey: parsed.manufacturerKey,
                    make: parsed.make,
                    archetypeId: parsed.archetypeId,
                    equipmentClass: parsed.equipmentClass,
                    regionIso: parsed.regionIso,
                    channelIntent: parsed.channelIntent,
                    includeIndependentSpecialists: parsed.includeIndependentSpecialists,
                });
                assert.equal(result.officialMatches.length, 1);
                assert.equal(result.tenantPrivateContacts.length, 0, 'M2M jamás expone contactos privados de empresa');

                const walletAfter = (await mockDb.collection('m2m_wallets').doc('agent-mfg-01').get()).data();
                assert.equal(walletAfter?.balanceMicroUsd, 85_000);
                assert.equal(recordedAuditEntries.length, 1);
            }

            console.log('✓ [g] Monetización M2M x402 (402 anónimo -> 200 Ed25519 + 0 contactos privados) OK');
        }

        // -------------------------------------------------------------------
        // (h) Buscador IA 1-Pass JSON, dealerLocatorUrl, Zero-Preset, Anti-Placeholder y Fail-Closed 503
        // -------------------------------------------------------------------
        {
            const prevGenerate = ResilientAIClient.generate;
            const prevStructured = ResilientAIClient.generateStructured;

            try {
                // Seed dealerLocatorUrl en Caterpillar existente
                await ManufacturerRegistryService.updateManufacturerHitl({
                    manufacturerKey: 'caterpillar',
                    actorUid: 'uid-dev-1',
                    actorEmail: 'dev@minreport.com',
                    body: {
                        officialContacts: {
                            dealerLocatorUrl: 'https://www.cat.com/en_US/support/dealer-locator.html',
                        },
                        confirmWord: 'ACTUALIZAR',
                    },
                });

                let pass2Calls = 0;
                const capturedPrompts: string[] = [];

                (ResilientAIClient as any).generateStructured = async () => {
                    pass2Calls += 1;
                    return { data: { suppliers: [] }, meta: { model: 'unexpected-pass2' } };
                };

                (ResilientAIClient as any).generate = async (req: { prompt: string }) => {
                    capturedPrompts.push(req.prompt);
                    return {
                        text: JSON.stringify({
                            suppliers: [
                                {
                                    tradeName: 'Finning Chile S.A.',
                                    legalName: 'Finning Chile S.A.',
                                    countryIso2: 'CL',
                                    supplierTaxId: '96.515.490-0',
                                    officialWebsiteUrl: 'https://www.finning.com',
                                    divisionName: 'División Minería CAT 1-Pass',
                                    isOfficialDealer: true,
                                    channels: ['PARTS', 'SERVICE'],
                                    manufacturerNames: ['Caterpillar'],
                                    archetypeIds: ['CAMION_TOLVA_CAEX'],
                                    territories: ['CL', 'CL-AN'],
                                    branches: [
                                        {
                                            branchName: 'Sucursal Antofagasta',
                                            city: 'Antofagasta',
                                            regionIso: 'CL-AN',
                                            phone: '+56 55 200 1000',
                                            roleEmail: 'repuestos@finning.com',
                                            portalUrl: 'https://www.finning.com/es_CL.html',
                                        },
                                    ],
                                },
                            ],
                        }),
                        groundingSources: [
                            { title: 'Finning Chile', uri: 'https://www.finning.com/es_CL.html' },
                        ],
                        model: 'gemini-3-flash-preview',
                    };
                };

                // 1. 1-Pass JSON + inyección de dealerLocatorUrl sin llamar a Pass 2
                const onePassRes = await SupplierChannelResolverService.discoverSuppliersWithAi({
                    regionQuery: 'Antofagasta, Chile',
                    manufacturerKey: 'caterpillar',
                    actorUid: 'uid-dev-1',
                });
                assert.equal(pass2Calls, 0, 'JSON válido en Pasada 1 no debe invocar Pasada 2');
                assert.equal(onePassRes.suggestions.length, 1);
                assert.equal(onePassRes.suggestions[0].supplierTaxId, '965154900');
                assert.ok(
                    capturedPrompts[0].includes('dealer-locator.html'),
                    'Prompt Pasada 1 debe incluir dealerLocatorUrl del fabricante OEM'
                );

                // 2. brandQuery Zero-Preset + channelFocus sin fabricante previo en global_manufacturers
                const zeroPresetRes = await SupplierChannelResolverService.discoverSuppliersWithAi({
                    regionQuery: 'Santiago, Chile',
                    brandQuery: 'Epiroc',
                    channelFocus: 'PARTS',
                    actorUid: 'uid-dev-1',
                });
                assert.equal(zeroPresetRes.manufacturerKey, 'epiroc');
                assert.ok(capturedPrompts[1].includes('Epiroc'));
                assert.ok(capturedPrompts[1].includes('PARTS'));

                // 3. Blindaje Anti-Placeholders Ley N° 21.719
                assert.equal(normalizeTaxIdCompact('[RUT_RESERVADO]'), null);
                assert.equal(normalizeTaxIdCompact('RUTRESERVADO'), null);
                const keyAlpha = buildSupplierKey('CL', '[RUT_RESERVADO]', 'Proveedor Alfa');
                const keyBeta = buildSupplierKey('CL', '[RUT_RESERVADO]', 'Proveedor Beta');
                assert.notEqual(keyAlpha, keyBeta, 'Placeholders jamás deben colisionar en cl_rutreservado');
                assert.equal(keyAlpha.includes('rutreservado'), false);
                assert.equal(sanitizeCorporatePhone('[TEL_RESERVADO]'), null);
                assert.equal(sanitizeFunctionalCorporateEmail('[EMAIL_RESERVADO]'), null);

                // 4. Tolerancia por sucursal en rescate Pasada 2 + Type.OBJECT responseSchema
                let receivedResponseSchema: any = null;
                (ResilientAIClient as any).generate = async () => ({
                    text: 'Distribuidor Komatsu con casa matriz en Santiago.',
                    groundingSources: [{ title: 'Komatsu', uri: 'https://www.komatsu.cl' }],
                    model: 'gemini-3-flash-preview',
                });
                (ResilientAIClient as any).generateStructured = async (req: { responseSchema?: any }) => {
                    receivedResponseSchema = req.responseSchema;
                    return {
                        data: {
                            suppliers: [
                                {
                                    tradeName: 'Komatsu Chile S.A.',
                                    countryIso2: 'CL',
                                    divisionName: 'División Repuestos',
                                    channels: ['PARTS'],
                                    manufacturerNames: ['Komatsu'],
                                    branches: [
                                        { branchName: 'Casa Matriz', city: 'Santiago', phone: '+56 2 2500 0000' },
                                        { branchName: 'Sucursal Incompleta', city: '' },
                                    ],
                                },
                            ],
                        },
                        meta: { model: 'gemini-3-flash-preview' },
                    };
                };

                const rescueRes = await SupplierChannelResolverService.discoverSuppliersWithAi({
                    regionQuery: 'Chile',
                    manufacturerKey: 'komatsu',
                    actorUid: 'uid-dev-1',
                });
                assert.ok(receivedResponseSchema, 'Rescate Pasada 2 debe enviar responseSchema Type.OBJECT');
                assert.equal(rescueRes.suggestions.length, 1);
                assert.equal(
                    rescueRes.suggestions[0].branches.length,
                    1,
                    'Sucursal sin city debe filtrarse sin hacer fallar el lote completo'
                );

                // 5. Fail-Closed HTTP 503 cuando el enjambre IA no está disponible
                (ResilientAIClient as any).generate = async () => {
                    throw new AISwarmUnavailableError('Swarm sin cuota disponible');
                };
                const failRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: '/suppliers/discover-ai',
                    body: { regionQuery: 'Chile', brandQuery: 'Caterpillar' },
                    opermaqContext: {
                        tenantId: 'dev-master-sandbox',
                        actorId: 'dev-master-root-uid',
                        actorEmail: 'dev@minreport.com',
                        countryCode: 'CL',
                        accountTier: 1,
                        isEduSandbox: false,
                        capabilities: { canCurateAI: true },
                    },
                });
                assert.equal(failRes.status, 503, 'Errores del Enjambre IA deben propagarse como HTTP 503 Fail-Closed');

                console.log(
                    '✓ [h] Buscador IA 1-Pass JSON, dealerLocatorUrl, Zero-Preset, Anti-Placeholder y Fail-Closed 503 OK'
                );
            } finally {
                (ResilientAIClient as any).generate = prevGenerate;
                (ResilientAIClient as any).generateStructured = prevStructured;
            }
        }

        // -------------------------------------------------------------------
        // (i) Flujo 3 Niveles (Marca + País -> Distribuidor -> Áreas Abiertas
        //     Zero-Preset), SII DTE_v10, Reglas Privadas B2B y Guardrails UI
        // -------------------------------------------------------------------
        {
            resetMocks();
            const prevGenerate = (ResilientAIClient as any).generate;
            const prevStructured = (ResilientAIClient as any).generateStructured;

            const devCtx = {
                tenantId: 'dev-master-sandbox',
                actorId: 'dev-master-root-uid',
                actorEmail: 'dev@minreport.com',
                countryCode: 'CL',
                accountTier: 1,
                isEduSandbox: false,
                capabilities: { canCurateAI: true },
            };
            const b2bTenantACtx = {
                tenantId: 'tenant-faena-a',
                actorId: 'uid-b2b-a',
                actorEmail: 'compras@faena-a.cl',
                countryCode: 'CL',
                accountTier: 4,
                isEduSandbox: false,
                capabilities: { canCurateAI: false },
            };
            const b2bTenantBCtx = {
                tenantId: 'tenant-faena-b',
                actorId: 'uid-b2b-b',
                actorEmail: 'compras@faena-b.cl',
                countryCode: 'CL',
                accountTier: 4,
                isEduSandbox: false,
                capabilities: { canCurateAI: false },
            };
            const eduCtx = {
                tenantId: 'edu-sandbox-univ',
                actorId: 'uid-edu-1',
                actorEmail: 'alumno@universidad.cl',
                countryCode: 'CL',
                accountTier: 5,
                isEduSandbox: true,
                capabilities: { canCurateAI: false },
            };

            try {
                // Sembrar marcas OEM y equipo en catálogo maestro
                await mockDb.collection('global_manufacturers').doc('caterpillar').set({
                    manufacturerKey: 'caterpillar',
                    officialName: 'CATERPILLAR',
                    legalCorporateName: 'Caterpillar Inc.',
                    aliases: ['CAT'],
                    hqCountryIso2: 'US',
                    hqCity: 'Irving',
                    officialWebsiteUrl: 'https://www.cat.com',
                    officialContacts: {
                        dealerLocatorUrl: 'https://www.cat.com/en_US/support/dealer-locator.html',
                        officialPartsUrl: 'https://parts.cat.com',
                    },
                    observedArchetypeIds: ['CAMION_TOLVA_CAEX'],
                    sampleModels: ['797F'],
                    logoSvg: null,
                    logoCandidates: [],
                    curationStatus: 'VERIFIED_DEV',
                    hasPublicWebFootprint: true,
                    equipmentCount: 1,
                    linkedSuppliersCount: 0,
                    createdAt: Date.now() - 5000,
                    updatedAt: Date.now() - 5000,
                    verifiedByUid: 'dev-master-root-uid',
                });
                await mockDb.collection('global_manufacturers').doc('sandvik').set({
                    manufacturerKey: 'sandvik',
                    officialName: 'SANDVIK',
                    legalCorporateName: 'Sandvik AB',
                    aliases: [],
                    hqCountryIso2: 'SE',
                    hqCity: 'Stockholm',
                    officialWebsiteUrl: 'https://www.rocktechnology.sandvik',
                    officialContacts: {},
                    observedArchetypeIds: [],
                    sampleModels: [],
                    logoSvg: null,
                    logoCandidates: [],
                    curationStatus: 'VERIFIED_DEV',
                    hasPublicWebFootprint: true,
                    equipmentCount: 0,
                    linkedSuppliersCount: 0,
                    createdAt: Date.now() - 5000,
                    updatedAt: Date.now() - 5000,
                    verifiedByUid: 'dev-master-root-uid',
                });
                await mockDb.collection('global_asset_catalog').doc('cat_797f').set({
                    make_oficial: 'CATERPILLAR',
                    model_oficial: '797F',
                    archetype_id: 'CAMION_TOLVA_CAEX',
                    equipment_type: 'Camión Extracción CAEX',
                    category: 'Minería Superficie',
                    short_description: 'Camión minero de gran tonelaje 400 ton.',
                });

                // 1. Flujo Marca + País (CATERPILLAR + CL -> FINNING) y Deduplicación N:M por CL + RUT
                (ResilientAIClient as any).generateStructured = async () => ({
                    data: { suppliers: [] },
                    meta: { model: 'gemini-3-flash-preview' },
                });
                (ResilientAIClient as any).generate = async () => ({
                    text: JSON.stringify({
                        suppliers: [
                            {
                                tradeName: 'Finning Chile',
                                legalName: 'Finning Chile S.A.',
                                countryIso2: 'CL',
                                supplierTaxId: '96.515.490-6',
                                officialWebsiteUrl: 'https://www.finning.com/es_CL.html',
                                divisionName: 'Repuestos CAT',
                                isOfficialDealer: true,
                                channels: ['PARTS'],
                                manufacturerNames: ['Caterpillar'],
                                archetypeIds: ['CAMION_TOLVA_CAEX'],
                                territories: ['CL', 'CL-AN'],
                                branches: [
                                    {
                                        branchName: 'Casa Matriz Repuestos',
                                        city: 'Antofagasta',
                                        regionIso: 'CL-AN',
                                        phone: '+56 2 2927 7000',
                                        roleEmail: 'repuestos@finning.com',
                                        portalUrl: 'https://www.finning.com/es_CL.html',
                                    },
                                ],
                                contacts: [
                                    {
                                        areaName: 'Repuestos',
                                        roleEmail: 'repuestos@finning.com',
                                        cityRegion: 'Antofagasta',
                                    },
                                ],
                            },
                        ],
                    }),
                    groundingSources: [{ title: 'Finning Chile', uri: 'https://www.finning.com/es_CL.html' }],
                    model: 'gemini-3-flash-preview',
                });

                const discoverRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: '/suppliers/discover-ai',
                    body: { countryIso2: 'CL', manufacturerKey: 'caterpillar' },
                    opermaqContext: devCtx,
                });
                assert.equal(discoverRes.status, 200);
                assert.equal(discoverRes.body.suggestions.length, 1);

                const approveRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: '/suppliers/approve-ai',
                    body: {
                        suggestions: discoverRes.body.suggestions,
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(approveRes.status, 200);
                assert.equal(approveRes.body.suppliers.length, 1);
                const finning = approveRes.body.suppliers[0];
                const finningKey = finning.supplierKey;
                assert.equal(finning.supplierTaxId, '965154906');
                assert.equal(finning.siiTaxProfile.siiRutNormalized, '96515490-6');
                assert.equal(finning.siiTaxProfile.siiRutDisplay, '96.515.490-6');
                assert.ok(finning.manufacturerKeys.includes('caterpillar'));

                // Segunda representación OEM sobre el mismo CL + RUT (no duplica documento)
                const mergeRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: '/suppliers/direct',
                    body: {
                        tradeName: 'Finning Sudamérica',
                        legalName: 'Finning Chile S.A.',
                        countryIso2: 'CL',
                        supplierTaxId: '96.515.490-6',
                        manufacturerKeys: ['sandvik'],
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(mergeRes.status, 200);
                assert.equal(mergeRes.body.supplier.supplierKey, finningKey);
                assert.ok(mergeRes.body.supplier.manufacturerKeys.includes('caterpillar'));
                assert.ok(mergeRes.body.supplier.manufacturerKeys.includes('sandvik'));

                const globalSuppliersSnap = await mockDb.collection('global_suppliers').get();
                assert.equal(globalSuppliersSnap.size, 1, 'No debe duplicar distribuidor para mismo país + RUT');

                const mfgDetailRes = await invokeManufacturersRouter({
                    method: 'GET',
                    url: '/caterpillar',
                    opermaqContext: devCtx,
                });
                assert.equal(mfgDetailRes.status, 200);
                assert.equal(mfgDetailRes.body.linkedSuppliersCount, 1);
                assert.ok(
                    mfgDetailRes.body.registeredEquipment.some((e: any) => e.model === '797F'),
                    'Detalle de fabricante debe exponer equipos registrados en global_asset_catalog'
                );

                // 2. Agenda Comercial por Área Abierta (Zero-Preset) + Resolución M2M areaQuery + IA Áreas
                const addLubRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: `/suppliers/${finningKey}/contacts`,
                    body: {
                        areaName: 'Lubricantes Especiales',
                        contactLabel: 'Mesa Lubricación Faena',
                        roleEmail: 'lubricantes@finning.com',
                        cityRegion: 'Antofagasta',
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(addLubRes.status, 200);

                const addOtrRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: `/suppliers/${finningKey}/contacts`,
                    body: {
                        areaName: 'Neumáticos OTR',
                        phone: '+56 2 2927 7000',
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(addOtrRes.status, 200);
                const contactsList = addOtrRes.body.supplier.contacts;
                const lubEntry = contactsList.find((c: any) => c.areaKey === 'lubricantes_especiales');
                const otrEntry = contactsList.find((c: any) => c.areaKey === 'neumaticos_otr');
                assert.ok(lubEntry && otrEntry, 'Debe generar areaKey normalizado sin presets cerrados');

                const m2mAreaMatch = await SupplierChannelResolverService.resolveSupplierChannels({
                    manufacturerKey: 'caterpillar',
                    regionIso: 'CL',
                    areaQuery: 'lubricantes',
                });
                assert.equal(m2mAreaMatch.officialMatches.length, 1);
                assert.equal(m2mAreaMatch.officialMatches[0].matchedAreaName, 'Lubricantes Especiales');
                assert.ok(
                    m2mAreaMatch.officialMatches[0].supplier.contacts.some(
                        (c) => c.areaName === 'Lubricantes Especiales'
                    )
                );

                const delOtrRes = await invokeManufacturersRouter({
                    method: 'DELETE',
                    url: `/suppliers/${finningKey}/contacts/${otrEntry.contactId}`,
                    body: { confirmWord: 'ACTUALIZAR' },
                    opermaqContext: devCtx,
                });
                assert.equal(delOtrRes.status, 200);
                assert.equal(
                    delOtrRes.body.supplier.contacts.some((c: any) => c.areaKey === 'neumaticos_otr'),
                    false
                );

                (ResilientAIClient as any).generate = async () => ({
                    text: JSON.stringify({
                        contacts: [
                            {
                                areaName: 'Equipos Usados y Remanufacturados',
                                contactLabel: 'Gerencia Equipos Usados',
                                roleEmail: 'usados@finning.com',
                                cityRegion: 'Santiago',
                            },
                        ],
                        taxHint: {
                            siiRut: '96.515.490-0',
                            taxCiudad: 'Santiago',
                        },
                    }),
                    groundingSources: [{ title: 'Finning Usados', uri: 'https://www.finning.com/es_CL/used.html' }],
                    model: 'gemini-3-flash-preview',
                });
                const discoverAreasRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: `/suppliers/${finningKey}/discover-areas-ai`,
                    body: { countryIso2: 'CL', areaFocus: 'Usados' },
                    opermaqContext: devCtx,
                });
                assert.equal(discoverAreasRes.status, 200);
                assert.equal(discoverAreasRes.body.suggestions.length, 1);
                assert.equal(discoverAreasRes.body.suggestions[0].areaName, 'Equipos Usados y Remanufacturados');

                // 3. Perfil Tributario Oficial SII DTE_v10.xsd + Internacional US
                const invalidRutRes = await invokeManufacturersRouter({
                    method: 'PUT',
                    url: `/suppliers/${finningKey}/profile`,
                    body: {
                        supplierTaxId: '96.515.490-9',
                        siiTaxProfile: {
                            taxRegimeScope: 'SII_CL',
                            siiRutNormalized: '96515490-9',
                        },
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(invalidRutRes.status, 400, 'RUT Módulo 11 inválido debe rechazarse con HTTP 400');

                const longGiroEmis =
                    'VENTA Y ARRIENDO DE MAQUINARIA PESADA REPUESTOS Y SERVICIO TECNICO MINERO';
                const validSiiRes = await invokeManufacturersRouter({
                    method: 'PUT',
                    url: `/suppliers/${finningKey}/profile`,
                    body: {
                        supplierTaxId: '96.515.490-6',
                        siiTaxProfile: {
                            taxRegimeScope: 'SII_CL',
                            siiRutNormalized: '96515490-6',
                            siiRznSoc: 'FINNING CHILE S.A.',
                            siiGiroEmis: longGiroEmis,
                            siiGiroRecep: null,
                            actecoCodes: ['465909'],
                            taxAddressDir: 'Av. Los Libertadores 15000',
                            taxComuna: 'Colina',
                            taxCiudad: 'Santiago',
                            dteInterchangeEmail: 'dte@finning.com',
                            apBillingEmail: 'cobranza@finning.com',
                            supportedDteTypes: [33, 52, 61],
                            isDteCertified: true,
                        },
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(validSiiRes.status, 200);
                const updatedFinning = validSiiRes.body.supplier;
                assert.equal(updatedFinning.siiTaxProfile.siiRutNormalized, '96515490-6');
                assert.ok(updatedFinning.siiTaxProfile.siiGiroRecep);
                assert.ok(updatedFinning.siiTaxProfile.siiGiroRecep.length <= 40);
                assert.equal(updatedFinning.taxReadiness.scope, 'SII_CL');
                assert.equal(updatedFinning.taxReadiness.score, 6);
                assert.equal(updatedFinning.taxReadiness.total, 6);
                assert.equal(updatedFinning.taxReadiness.isReady, true);

                const usSupplierRes = await invokeManufacturersRouter({
                    method: 'POST',
                    url: '/suppliers/direct',
                    body: {
                        tradeName: 'OEM Parts USA',
                        legalName: 'OEM Parts USA LLC',
                        countryIso2: 'US',
                        supplierTaxId: 'US-99-1234567',
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(usSupplierRes.status, 200);
                const usKey = usSupplierRes.body.supplier.supplierKey;
                const usProfileRes = await invokeManufacturersRouter({
                    method: 'PUT',
                    url: `/suppliers/${usKey}/profile`,
                    body: {
                        siiTaxProfile: {
                            taxRegimeScope: 'INTERNATIONAL',
                            foreignTaxId: 'US-99-1234567',
                            siiRznSoc: 'OEM Parts USA LLC',
                            taxAddressDir: '500 Industrial Blvd',
                            taxComuna: 'Texas',
                            taxCiudad: 'Houston',
                            apBillingEmail: 'ap@oempartsusa.com',
                        },
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: devCtx,
                });
                assert.equal(usProfileRes.status, 200);
                assert.equal(usProfileRes.body.supplier.taxReadiness.scope, 'INTERNATIONAL');
                assert.equal(usProfileRes.body.supplier.taxReadiness.total, 4);
                assert.equal(usProfileRes.body.supplier.taxReadiness.isReady, true);

                // 4. Reglas Contractuales Privadas B2B (Ley N° 21.131 y Ley N° 19.983) + Aislamiento Tenant + Bloqueo 5º EDU
                const invalidTermRes = await invokeManufacturersRouter({
                    method: 'PUT',
                    url: `/suppliers/${finningKey}/billing-rule`,
                    body: {
                        paymentTermDays: 60,
                        hasExceptionalPaymentAgreement: false,
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: b2bTenantACtx,
                });
                assert.equal(
                    invalidTermRes.status,
                    400,
                    'Ley N° 21.131: plazo > 30d sin acuerdo excepcional MEFT debe rechazarse con HTTP 400'
                );

                const validRuleRes = await invokeManufacturersRouter({
                    method: 'PUT',
                    url: `/suppliers/${finningKey}/billing-rule`,
                    body: {
                        requiresPurchaseOrder801: true,
                        requiresContract803: false,
                        requiresDispatchGuide52: true,
                        requiresReceptionTokenType: 'HES',
                        defaultFormaPagoDte: 2,
                        paymentTermDays: 45,
                        hasExceptionalPaymentAgreement: true,
                        exceptionalAgreementNote: 'Registro MEFT #8821',
                        dteClaimWindowDays: 8,
                        rcvClaimAlertEmail: 'rcv@faena-a.cl',
                        allowFactoringCesion: true,
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: b2bTenantACtx,
                });
                assert.equal(validRuleRes.status, 200);
                assert.equal(validRuleRes.body.billingRule.paymentTermDays, 45);
                assert.equal(validRuleRes.body.billingRule.dteClaimWindowDays, 8);

                const tenantBRuleRes = await invokeManufacturersRouter({
                    method: 'GET',
                    url: `/suppliers/${finningKey}/billing-rule`,
                    opermaqContext: b2bTenantBCtx,
                });
                assert.equal(tenantBRuleRes.status, 200);
                assert.equal(
                    tenantBRuleRes.body.billingRule,
                    null,
                    'Regla contractual de tenant-faena-a no debe filtrarse a tenant-faena-b'
                );

                const eduRuleRes = await invokeManufacturersRouter({
                    method: 'PUT',
                    url: `/suppliers/${finningKey}/billing-rule`,
                    body: {
                        paymentTermDays: 30,
                        confirmWord: 'ACTUALIZAR',
                    },
                    opermaqContext: eduCtx,
                });
                assert.equal(eduRuleRes.status, 403, 'Cuenta 5º EDU debe recibir HTTP 403 en reglas de facturación');

                // 5. Auditoría Estática de Guardrails UI/UX Minimalismo Industrial + Paridad i18n
                const fsMod = await import('node:fs');
                const tsMod = await import('typescript');
                const uiComponentPaths = [
                    'web/src/modules/opermaq/components/SupplierCountryDiscoveryModal.tsx',
                    'web/src/modules/opermaq/components/SupplierContactAreaModal.tsx',
                    'web/src/modules/opermaq/components/SupplierSiiTaxPillarPanel.tsx',
                    'web/src/modules/opermaq/components/SupplierWorkspace.tsx',
                    'web/src/modules/opermaq/components/ManufacturersDirectoryDashboard.tsx',
                    'web/src/modules/opermaq/components/SuppliersDirectoryDashboard.tsx',
                ];
                const forbiddenPatterns = [
                    /rounded-(sm|md|lg|xl|2xl|full)/,
                    /shadow-(sm|md|lg|xl|2xl)/,
                    /animate-spin/,
                    /progress_activity/,
                    /#FFCD00/i,
                ];
                for (const filePath of uiComponentPaths) {
                    const source = fsMod.readFileSync(filePath, 'utf8');
                    for (const pat of forbiddenPatterns) {
                        assert.equal(pat.test(source), false, `Patrón prohibido ${pat} encontrado en ${filePath}`);
                    }
                    const sf = tsMod.createSourceFile(filePath, source, tsMod.ScriptTarget.Latest, true, tsMod.ScriptKind.TSX);
                    const checkAttrs = (node: any) => {
                        if (tsMod.isJsxOpeningElement(node) || tsMod.isJsxSelfClosingElement(node)) {
                            const tag = node.tagName.getText(sf);
                            if (tag === 'form' || tag === 'input' || tag === 'textarea') {
                                const rawTag = node.getText(sf);
                                const isCheckbox = tag === 'input' && /type\s*=\s*["']checkbox["']/.test(rawTag);
                                if (!isCheckbox) {
                                    const attrNames = node.attributes.properties.map((p: any) =>
                                        tsMod.isJsxAttribute(p) ? p.name.getText(sf) : ''
                                    );
                                    assert.ok(
                                        attrNames.includes('autoComplete') && attrNames.includes('spellCheck'),
                                        `Elemento <${tag}> sin autoComplete/spellCheck en ${filePath}`
                                    );
                                }
                            }
                        }
                        tsMod.forEachChild(node, checkAttrs);
                    };
                    checkAttrs(sf);
                }

                const esJson = JSON.parse(fsMod.readFileSync('web/src/modules/opermaq/locales/es.json', 'utf8'));
                const enJson = JSON.parse(fsMod.readFileSync('web/src/modules/opermaq/locales/en.json', 'utf8'));
                const ptJson = JSON.parse(fsMod.readFileSync('web/src/modules/opermaq/locales/pt.json', 'utf8'));
                const esKeys = Object.keys(esJson.suppliers_v2 || {}).sort();
                const enKeys = Object.keys(enJson.suppliers_v2 || {}).sort();
                const ptKeys = Object.keys(ptJson.suppliers_v2 || {}).sort();
                assert.ok(esKeys.length >= 160);
                assert.deepEqual(enKeys, esKeys, 'Paridad exacta suppliers_v2 ES vs EN');
                assert.deepEqual(ptKeys, esKeys, 'Paridad exacta suppliers_v2 ES vs PT');

                console.log(
                    '✓ [i] Flujo 3 Niveles (Marca+País, Áreas Abiertas Zero-Preset, SII DTE_v10, Reglas B2B Ley 21.131/19.983 y Guardrails UI/i18n) OK'
                );
            } finally {
                (ResilientAIClient as any).generate = prevGenerate;
                (ResilientAIClient as any).generateStructured = prevStructured;
            }
        }

        console.log('✅ OPERMAQ · FABRICANTES & PROVEEDORES Desacoplados E2E Suite PASSED');
    } finally {
        (ResilientAIClient as any).generate = originalGenerate;
        (ResilientAIClient as any).generateStructured = originalGenerateStructured;
        (ssrfGuard as any).safeFetchExternal = originalSafeFetchExternal;
        (ssrfGuard as any).assertSafeExternalUrl = originalAssertSafeExternalUrl;
        AuditLedger.record = originalAuditRecord;
    }
}

void run().catch((err) => {
    console.error('❌ E2E Suite failed:', err);
    process.exit(1);
});
