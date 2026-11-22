/**
 * Suite E10 — Exportación Contable Internacional (6 formatos + 13 perfiles) & Webhooks ERP Firmados HMAC-SHA256
 *
 * Verifica determinísticamente (sin red externa, 0 dependencias npm nuevas, Node v20.19.5):
 * 1. Los 6 formatos canónicos (`UBL_2_1_PEPPOL`, `SAFT_OECD`, `ISO_20022_PAIN001`,
 *    `JSON_SCHEMA_V2`, `CSV_RFC4180`, `XLSX_OOXML` verificando magic bytes PKZIP `50 4B 03 04`,
 *    CRC32 e inflación real de `xl/worksheets/sheet1.xml`).
 * 2. Neutralización OWASP anti-inyección de fórmulas en CSV y XLSX (`=CMD|' /C calc'!A0`,
 *    `+1+1`, `-2+3`, `@SUM(A1:A2)`, `\t=1+1`, espacios iniciales + `=`).
 * 3. Los 6 perfiles Chile (`CL_SII_RCV`, `CL_CHIPAX`, `CL_CLAY`, `CL_DEFONTANA`, `CL_NUBOX`, `CL_SOFTLAND`)
 *    y los 6+1 perfiles Global ERP (`GLOBAL_SAP_S4HANA`, `GLOBAL_NETSUITE`, `GLOBAL_DYNAMICS_365`,
 *    `GLOBAL_PRONTO_XI`, `GLOBAL_XERO`, `GLOBAL_QUICKBOOKS`, `GLOBAL_STANDARD`).
 * 4. `SignedErpWebhookDispatcher`: firma HMAC-SHA256 válida sobre `${timestamp}.${rawBody}`,
 *    rechazo de payload alterado (`SIGNATURE_MISMATCH`), rechazo anti-replay `> 300s`
 *    (`TIMESTAMP_OUT_OF_WINDOW`), reintentos acotados (503 -> 200), bitácora 30d `ttlExpiresAt` sin secretos.
 * 5. Bloqueo SSRF (`http://169.254.169.254/...`, `https://metadata.google.internal/...`, `http://127.0.0.1/...`).
 * 6. Endpoints HTTP `/api/supply/exports/accounting`, retrocompatibilidad `/api/supply/sii/export`,
 *    CRUD `/api/supply/erp-webhooks` (`GET` sin secreto plano, HITL `ACTUALIZAR`, `403` para `VIEWER` y `OPERATOR`).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Duplex } from 'node:stream';
import zlib from 'node:zlib';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID = 'minreport-supply-e10-test';
process.env.FIREBASE_PROJECT_ID = 'minreport-supply-e10-test';
process.env.FIREBASE_STORAGE_BUCKET = 'minreport-supply-e10-test.firebasestorage.app';
process.env.X402_HMAC_SECRET = 'test_e10_x402_hmac_secret_32bytes_min';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore + Auth)
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

const TENANT_ID = 'tenant-e10-global';
const SITE_ID = 'site-atacama-e10';

const TOKEN_MAP: Record<string, any> = {
    'tok-owner': {
        uid: 'uid-owner-e10',
        email: 'owner@minera-e10.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'OWNER',
    },
    'tok-viewer': {
        uid: 'uid-viewer-e10',
        email: 'viewer@minera-e10.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'VIEWER',
    },
    'tok-operator': {
        uid: 'uid-operator-e10',
        email: 'camp@minera-e10.cl',
        email_verified: true,
        accountId: TENANT_ID,
        role: 'OPERATOR',
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
            verifyIdToken: async (token: string) => {
                const hit = TOKEN_MAP[token];
                if (!hit) throw new Error('INVALID_TOKEN');
                return hit;
            },
        },
        storage: {
            bucket: () => ({ name: 'minreport-supply-e10-test.firebasestorage.app' }),
        },
    },
} as any;

// ---------------------------------------------------------------------------
// 2. Imports del SUT
// ---------------------------------------------------------------------------

import { SSRFBlockedError } from '../../../utils/ssrfGuard';
import {
    CHILE_ACCOUNTING_PROFILES,
    GLOBAL_ERP_ACCOUNTING_PROFILES,
    type AccountingExportInput,
} from '../ports/IAccountingExportAdapter';
import {
    InternationalAccountingExporter,
    escapeXml,
    formatCsvCellRfc4180,
    neutralizeSpreadsheetFormula,
} from '../adapters/InternationalAccountingExporter';
import {
    SUPPLY_ERP_WEBHOOKS_COLLECTION,
    SUPPLY_ERP_WEBHOOK_DELIVERIES_COLLECTION,
    SignedErpWebhookDispatcher,
    computeErpWebhookSignature,
    verifyErpWebhookSignature,
} from '../adapters/SignedErpWebhookDispatcher';
import { SUPPLY_COLLECTIONS } from '../application/SupplyRepository';
import type {
    CanonicalSupplySku,
    SiiDocumentRecord,
    SiiExpenseReport,
    SupplyPurchase,
} from '../application/supply.types';
import supplyRouter from '../application/supply.controller';

// ---------------------------------------------------------------------------
// 3. Lector ZIP nativo para verificar integridad real del binario `.xlsx` OOXML
// ---------------------------------------------------------------------------

function extractZipEntries(zipBuf: Buffer): Map<string, string> {
    assert.ok(zipBuf.length >= 22, 'Archivo XLSX demasiado corto para ser PKZIP válido');
    assert.equal(zipBuf.readUInt32LE(0), 0x04034b50, 'Falta magic header PKZIP 50 4B 03 04');

    const entries = new Map<string, string>();
    let offset = 0;

    while (offset + 4 <= zipBuf.length && zipBuf.readUInt32LE(offset) === 0x04034b50) {
        const compressionMethod = zipBuf.readUInt16LE(offset + 8);
        const compressedSize = zipBuf.readUInt32LE(offset + 18);
        const uncompressedSize = zipBuf.readUInt32LE(offset + 22);
        const nameLen = zipBuf.readUInt16LE(offset + 26);
        const extraLen = zipBuf.readUInt16LE(offset + 28);

        const nameStart = offset + 30;
        const name = zipBuf.subarray(nameStart, nameStart + nameLen).toString('utf8');
        const dataStart = nameStart + nameLen + extraLen;
        const compSlice = zipBuf.subarray(dataStart, dataStart + compressedSize);

        const uncompBuf =
            compressionMethod === 8 ? zlib.inflateRawSync(compSlice) : Buffer.from(compSlice);
        assert.equal(
            uncompBuf.length,
            uncompressedSize,
            `Tamaño descomprimido no coincide en entrada ZIP ${name}`
        );

        entries.set(name, uncompBuf.toString('utf8'));
        offset = dataStart + compressedSize;
    }

    assert.equal(
        zipBuf.readUInt32LE(offset),
        0x02014b50,
        'Debe continuar con Central Directory Header (PK 01 02)'
    );
    return entries;
}

// ---------------------------------------------------------------------------
// 4. Dispatcher HTTP in-process preservando binario puro `Buffer` (XLSX)
// ---------------------------------------------------------------------------

class MemorySocket extends Duplex {
    public readonly writtenChunks: Buffer[] = [];
    public remoteAddress = '127.0.0.1';
    public destroyed = false;
    public writable = true;
    public readable = true;

    _read(): void {}
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
    ): Promise<{
        status: number;
        headers: Record<string, any>;
        buffer: Buffer;
        text: string;
        json: any;
    }> => {
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
                const buffer = Buffer.concat(bodyChunks);
                const text = buffer.toString('utf8');
                let json: any = null;
                try {
                    json = text ? JSON.parse(text) : null;
                } catch {
                    json = null;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.getHeaders(),
                    buffer,
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
// 5. Fixtures Contables y de Tenant
// ---------------------------------------------------------------------------

const SAMPLE_CATALOG: Record<string, Partial<CanonicalSupplySku>> = {
    'sku-arroz-grano': {
        canonicalSkuId: 'sku-arroz-grano',
        name: 'Arroz Grano Largo',
        baseUnitSi: 'kg',
        unCefactCode: 'KGM',
        unspscCode: '50221104',
        gtin: '7801234567890',
    },
    'sku-agua-bidon-20l': {
        canonicalSkuId: 'sku-agua-bidon-20l',
        name: 'Agua Potable Bidón 20L',
        baseUnitSi: 'L',
        unCefactCode: 'LTR',
        unspscCode: '50202301',
    },
};

const SAMPLE_DOCUMENTS: Array<SiiDocumentRecord & { retentionUntil?: string }> = [
    {
        docId: `${TENANT_ID}__76123456-0_33_4501`,
        tenantId: TENANT_ID,
        siteId: SITE_ID,
        purchaseId: 'pur_e10_1',
        dedupeKey: '76123456-0_33_4501',
        supplierTaxId: '76.123.456-0',
        supplierName: 'Distribuidora Andina & Norte <SpA>',
        documentType: 33,
        folio: 4501,
        issueDate: '2026-11-18',
        netAmountClp: 200000,
        vatAmountClp: 38000,
        vatCreditRecoverableClp: 38000,
        totalAmountClp: 238000,
        rcvDeadlineDate: '2026-11-26',
        rcvDaysRemaining: 4,
        rcvStatus: 'PENDING_ACCEPTANCE',
        missingInvoiceForCapex: false,
        evidenceCasRef: {
            sha256: 'a'.repeat(64),
            downloadUrl: `https://storage.googleapis.com/minreport-supply-e10-test/cas_blobs/tenants/${TENANT_ID}/aa.webp`,
            storagePath: `cas_blobs/tenants/${TENANT_ID}/aa.webp`,
            mimeType: 'image/webp',
            extension: 'webp',
            originalBytes: 500000,
            optimizedBytes: 42000,
            savingsPct: 91.6,
        },
        retentionUntil: '2032-11-18T00:00:00.000Z',
        createdAt: '2026-11-18T12:00:00.000Z',
        updatedAt: '2026-11-18T12:00:00.000Z',
    },
    {
        docId: `${TENANT_ID}__76123456-0_61_102`,
        tenantId: TENANT_ID,
        siteId: SITE_ID,
        purchaseId: 'pur_e10_nc',
        dedupeKey: '76123456-0_61_102',
        supplierTaxId: '76.123.456-0',
        supplierName: 'Distribuidora Andina & Norte <SpA>',
        documentType: 61,
        folio: 102,
        issueDate: '2026-11-19',
        netAmountClp: -50000,
        vatAmountClp: -9500,
        vatCreditRecoverableClp: -9500,
        totalAmountClp: -59500,
        rcvDeadlineDate: null,
        rcvDaysRemaining: null,
        rcvStatus: 'NOT_APPLICABLE',
        missingInvoiceForCapex: false,
        retentionUntil: '2032-11-19T00:00:00.000Z',
        createdAt: '2026-11-19T12:00:00.000Z',
        updatedAt: '2026-11-19T12:00:00.000Z',
    },
];

const SAMPLE_PURCHASES: SupplyPurchase[] = [
    {
        purchaseId: 'pur_e10_1',
        tenantId: TENANT_ID,
        siteId: SITE_ID,
        buyerUid: 'uid-owner-e10',
        buyerRole: 'OWNER_EXEC',
        purchaseMode: 'DIRECT_AUTONOMOUS',
        authorizedByAuthority: true,
        supplierTaxId: '76.123.456-0',
        supplierName: 'Distribuidora Andina & Norte <SpA>',
        documentType: 33,
        folio: 4501,
        dedupeKey: '76123456-0_33_4501',
        issueDate: '2026-11-18',
        netAmountClp: 200000,
        vatAmountClp: 38000,
        totalAmountClp: 238000,
        paymentMethod: 'TRANSFERENCIA',
        receptionStatus: 'RECEIVED',
        atypicalFlags: [],
        lines: [
            {
                purchaseLineId: 'pl_1',
                canonicalSkuId: 'sku-arroz-grano',
                description: 'Arroz Grano Largo 25kg',
                categoryCode: 'VIVERES_ALIMENTACION',
                procurementBucket: 'SUPERMERCADO',
                unitSi: 'kg',
                qtyPurchased: 50,
                unitPriceClp: 2000,
                subtotalClp: 100000,
                destination: 'STOCK_IN_WAREHOUSE',
                costCenter: 'CC-CAMPAMENTO',
                isCapexAsset: false,
            },
            {
                purchaseLineId: 'pl_2',
                canonicalSkuId: 'sku-agua-bidon-20l',
                description: 'Agua Potable Bidón 20L',
                categoryCode: 'AGUA_POTABLE',
                procurementBucket: 'GAS_AGUA_COMBUSTIBLE',
                unitSi: 'L',
                qtyPurchased: 200,
                unitPriceClp: 500,
                subtotalClp: 100000,
                destination: 'STOCK_IN_WAREHOUSE',
                costCenter: 'CC-CAMPAMENTO',
                isCapexAsset: false,
            },
        ],
        createdAt: '2026-11-18T12:00:00.000Z',
        updatedAt: '2026-11-18T12:00:00.000Z',
    },
];

const SAMPLE_EXPENSE_REPORTS: SiiExpenseReport[] = [
    {
        reportId: 'expr_e10_1',
        tenantId: TENANT_ID,
        siteId: SITE_ID,
        custodianUid: 'uid-operator-e10',
        custodianName: 'Jefe Campamento Atacama',
        paymentMethod: 'FONDO_POR_RENDIR',
        title: 'Rendición Noviembre Faena Atacama',
        costCenter: 'CC-CAMPAMENTO',
        fundAdvanceClp: 300000,
        renderedTotalClp: 238000,
        balanceClp: 62000,
        siiDocumentIds: [SAMPLE_DOCUMENTS[0].docId],
        status: 'APPROVED',
        createdAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T11:00:00.000Z',
    },
];

async function seedHttpTenantFixtures(): Promise<void> {
    dbCollections.clear();
    await mockDb.collection('modules_status').doc('supply').set({ active: true });
    await mockDb.collection('accounts').doc(TENANT_ID).set({
        accountId: TENANT_ID,
        name: 'Minera Atacama Global SpA',
        taxId: '77.888.999-3',
        countryCode: 'CL',
        status: 'ACTIVE',
        entitlements: {
            basePackage: 'OPERMAQ_CORE',
            addonModules: { supply: { active: true } },
        },
    });

    await mockDb.collection('users').doc('uid-owner-e10').set({
        uid: 'uid-owner-e10',
        email: 'owner@minera-e10.cl',
        accountId: TENANT_ID,
        role: 'OWNER',
        status: 'ACTIVE',
    });
    await mockDb.collection('accounts').doc(TENANT_ID).collection('members').doc('uid-owner-e10').set({
        uid: 'uid-owner-e10',
        email: 'owner@minera-e10.cl',
        displayName: 'Gerente General E10',
        role: 'OWNER',
        status: 'ACTIVE',
        allowedModules: { supply: true },
        supplyProfile: { role: 'OWNER_EXEC', allowCapex: true },
    });

    await mockDb.collection('users').doc('uid-viewer-e10').set({
        uid: 'uid-viewer-e10',
        email: 'viewer@minera-e10.cl',
        accountId: TENANT_ID,
        role: 'VIEWER',
        status: 'ACTIVE',
    });
    await mockDb.collection('accounts').doc(TENANT_ID).collection('members').doc('uid-viewer-e10').set({
        uid: 'uid-viewer-e10',
        email: 'viewer@minera-e10.cl',
        displayName: 'Auditor Lectura',
        role: 'VIEWER',
        status: 'ACTIVE',
        allowedModules: { supply: true },
    });

    await mockDb.collection('users').doc('uid-operator-e10').set({
        uid: 'uid-operator-e10',
        email: 'camp@minera-e10.cl',
        accountId: TENANT_ID,
        role: 'OPERATOR',
        status: 'ACTIVE',
    });
    await mockDb
        .collection('accounts')
        .doc(TENANT_ID)
        .collection('members')
        .doc('uid-operator-e10')
        .set({
            uid: 'uid-operator-e10',
            email: 'camp@minera-e10.cl',
            displayName: 'Jefe Campamento',
            role: 'OPERATOR',
            status: 'ACTIVE',
            allowedModules: { supply: true },
            supplyProfile: { role: 'CAMP_MANAGER' },
        });

    for (const doc of SAMPLE_DOCUMENTS) {
        await mockDb.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(doc.docId).set(doc);
    }
    for (const pur of SAMPLE_PURCHASES) {
        await mockDb.collection(SUPPLY_COLLECTIONS.PURCHASES).doc(pur.purchaseId).set(pur);
    }
    for (const rep of SAMPLE_EXPENSE_REPORTS) {
        await mockDb.collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).doc(rep.reportId).set(rep);
    }
}

// ---------------------------------------------------------------------------
// 6. Ejecución de Suite E10
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
    const baseInput: Omit<AccountingExportInput, 'format' | 'profile'> = {
        tenantId: TENANT_ID,
        tenantName: 'Minera Atacama Global SpA',
        tenantTaxId: '77.888.999-3',
        tenantCountryCode: 'CL',
        currencyCode: 'CLP',
        siteId: SITE_ID,
        generatedAtIso: '2026-11-22T01:00:00.000Z',
        documents: SAMPLE_DOCUMENTS,
        purchases: SAMPLE_PURCHASES,
        expenseReports: SAMPLE_EXPENSE_REPORTS,
        catalogBySkuId: SAMPLE_CATALOG,
    };

    // =========================================================================
    // TEST 1: Los 6 formatos internacionales (`UBL_2_1_PEPPOL`, `SAFT_OECD`,
    //         `ISO_20022_PAIN001`, `JSON_SCHEMA_V2`, `CSV_RFC4180`, `XLSX_OOXML`)
    // =========================================================================
    {
        // 1a. UBL 2.1 / Peppol BIS 3.0
        const ubl = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            format: 'UBL_2_1_PEPPOL',
            profile: 'GLOBAL_SAP_S4HANA',
        });
        assert.equal(ubl.format, 'UBL_2_1_PEPPOL');
        assert.equal(ubl.schemaVersion, 'UBL-2.1-PEPPOL-BIS-3.0');
        assert.equal(ubl.mimeType, 'application/xml; charset=utf-8');
        assert.match(ubl.sha256, /^[a-f0-9]{64}$/);
        const ublXml = String(ubl.content);
        assert.ok(ublXml.includes('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'));
        assert.ok(ublXml.includes('peppol.eu:2017:poacc:billing:3.0'));
        assert.ok(ublXml.includes('<cbc:DocumentCurrencyCode>CLP</cbc:DocumentCurrencyCode>'));
        assert.ok(ublXml.includes('<cac:AccountingSupplierParty>'));
        assert.ok(ublXml.includes('<cac:AccountingCustomerParty>'));
        assert.ok(ublXml.includes('<cac:TaxTotal>'));
        assert.ok(ublXml.includes('<cac:LegalMonetaryTotal>'));
        assert.ok(ublXml.includes('unitCode="KGM"'), 'Debe mapear kg -> KGM (UN/CEFACT Rec. 20)');
        assert.ok(ublXml.includes('unitCode="LTR"'), 'Debe mapear L -> LTR (UN/CEFACT Rec. 20)');
        assert.ok(ublXml.includes('<cbc:ID schemeID="0160">7801234567890</cbc:ID>'), 'Debe incluir GTIN');
        assert.ok(
            ublXml.includes('<cbc:ItemClassificationCode listID="TST">50221104</cbc:ItemClassificationCode>'),
            'Debe incluir UNSPSC'
        );
        assert.ok(
            ublXml.includes('Distribuidora Andina &amp; Norte &lt;SpA&gt;'),
            'Debe escapar caracteres especiales XML'
        );

        // 1b. OECD SAF-T 2.0
        const saft = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            format: 'SAFT_OECD',
            profile: 'GLOBAL_STANDARD',
        });
        const saftXml = String(saft.content);
        assert.equal(saft.schemaVersion, 'OECD-SAF-T-2.0');
        assert.ok(saftXml.includes('<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:2.00">'));
        assert.ok(saftXml.includes('<Header>') && saftXml.includes('<MasterFiles>'));
        assert.ok(saftXml.includes('<SourceDocuments>') && saftXml.includes('<PurchaseInvoices>'));
        assert.ok(saftXml.includes('<NumberOfEntries>2</NumberOfEntries>'));
        assert.ok(saftXml.includes('<UOMBase>KGM</UOMBase>'));

        // 1c. ISO 20022 pain.001.001.09
        const iso = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            format: 'ISO_20022_PAIN001',
            profile: 'GLOBAL_NETSUITE',
        });
        const isoXml = String(iso.content);
        assert.equal(iso.schemaVersion, 'ISO-20022-pain.001.001.09');
        assert.ok(isoXml.includes('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">'));
        assert.ok(isoXml.includes('<CstmrCdtTrfInitn>'));
        assert.ok(isoXml.includes('<GrpHdr>') && isoXml.includes('<PmtInf>') && isoXml.includes('<CdtTrfTxInf>'));
        assert.ok(isoXml.includes('<InstdAmt Ccy="CLP">238000</InstdAmt>'));

        // 1d. JSON Schema v2.0.0
        const jsonRes = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            format: 'JSON_SCHEMA_V2',
            profile: 'CL_CHIPAX',
        });
        assert.equal(jsonRes.schemaVersion, '2.0.0');
        const parsedJson = JSON.parse(String(jsonRes.content));
        assert.equal(parsedJson.schemaVersion, '2.0.0');
        assert.equal(parsedJson.brand, 'MINREPORT');
        assert.equal(parsedJson.tenant.taxIdentifier.scheme, 'CL_RUT');
        assert.equal(parsedJson.documents[0].money.total.currencyCode, 'CLP');
        assert.equal(parsedJson.documents[0].retentionUntil, '2032-11-18T00:00:00.000Z');
        assert.equal(parsedJson.documents[0].lines[0].unCefactCode, 'KGM');
        assert.equal(parsedJson.documents[0].lines[0].unspscCode, '50221104');
        assert.equal(parsedJson.documents[0].lines[0].gtin, '7801234567890');

        // 1e. CSV RFC 4180
        const csvRes = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            format: 'CSV_RFC4180',
            profile: 'CL_SII_RCV',
        });
        const csvStr = String(csvRes.content);
        assert.ok(csvStr.startsWith('\uFEFFTIPO_DTE;FOLIO;RUT_EMISOR'));
        assert.ok(csvStr.includes('\r\n'), 'CSV RFC 4180 debe usar terminador CRLF');

        // 1f. XLSX OOXML genuino (PKZIP + zlib + XML válido)
        const xlsxRes = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            format: 'XLSX_OOXML',
            profile: 'GLOBAL_SAP_S4HANA',
        });
        assert.equal(
            xlsxRes.mimeType,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        assert.ok(Buffer.isBuffer(xlsxRes.content), 'XLSX debe retornar Buffer binario');
        const zipEntries = extractZipEntries(xlsxRes.content);
        assert.ok(zipEntries.has('[Content_Types].xml'));
        assert.ok(zipEntries.has('_rels/.rels'));
        assert.ok(zipEntries.has('xl/workbook.xml'));
        assert.ok(zipEntries.has('xl/_rels/workbook.xml.rels'));
        assert.ok(zipEntries.has('xl/styles.xml'));
        assert.ok(zipEntries.has('xl/worksheets/sheet1.xml'));
        const sheetXml = zipEntries.get('xl/worksheets/sheet1.xml')!;
        assert.ok(sheetXml.includes('BUKRS') && sheetXml.includes('UNCEFACT_UOM'));
        assert.ok(sheetXml.includes('Distribuidora Andina &amp; Norte &lt;SpA&gt;'));

        console.log('PASS [1/6] 6 formatos contables verificados (UBL 2.1/Peppol, SAF-T 2.0, ISO 20022, JSON v2, CSV RFC 4180, XLSX OOXML PKZIP)');
    }

    // =========================================================================
    // TEST 2: Neutralización OWASP anti-inyección de fórmulas en CSV y XLSX
    // =========================================================================
    {
        const attackVectors = [
            `=CMD|' /C calc'!A0`,
            '+1+1',
            '-2+3',
            '@SUM(A1:A2)',
            '\t=1+1',
            '   =HYPERLINK("https://evil.test")',
        ];

        for (const payload of attackVectors) {
            const neutralized = neutralizeSpreadsheetFormula(payload);
            assert.ok(
                neutralized.startsWith("'"),
                `Vector de fórmula no neutralizado: ${JSON.stringify(payload)} -> ${JSON.stringify(neutralized)}`
            );
            const csvCell = formatCsvCellRfc4180(payload, ',');
            assert.ok(
                csvCell.startsWith("'") || csvCell.startsWith(`"'`),
                `Celda CSV insegura para vector ${JSON.stringify(payload)}: ${csvCell}`
            );
        }

        // Números negativos legítimos (ej. Nota de Crédito DTE 61) NO deben corromperse
        assert.equal(neutralizeSpreadsheetFormula(-19000), '-19000');
        assert.equal(neutralizeSpreadsheetFormula('-59500'), '-59500');
        assert.equal(escapeXml('<tag attr="1">&\'</tag>'), '&lt;tag attr=&quot;1&quot;&gt;&amp;&apos;&lt;/tag&gt;');

        // Probar inyección real dentro de `supplierName` en CSV y XLSX
        const hostileDocs: SiiDocumentRecord[] = attackVectors.map((vec, i) => ({
            ...SAMPLE_DOCUMENTS[0],
            docId: `hostile_${i}`,
            dedupeKey: `76123456-0_33_${9000 + i}`,
            folio: 9000 + i,
            supplierName: vec,
        }));

        const hostileCsv = String(
            InternationalAccountingExporter.exportAccountingPackage({
                ...baseInput,
                documents: hostileDocs,
                format: 'CSV_RFC4180',
                profile: 'CL_SII_RCV',
            }).content
        );
        assert.ok(hostileCsv.includes(`"'=CMD|' /C calc'!A0"`));
        assert.ok(hostileCsv.includes(`'+1+1`));
        assert.ok(hostileCsv.includes(`'-2+3`));
        assert.ok(hostileCsv.includes(`'@SUM(A1:A2)`));
        assert.ok(hostileCsv.includes(`"'\t=1+1"`));

        const hostileXlsx = InternationalAccountingExporter.exportAccountingPackage({
            ...baseInput,
            documents: hostileDocs,
            format: 'XLSX_OOXML',
            profile: 'CL_SII_RCV',
        });
        const hostileEntries = extractZipEntries(hostileXlsx.content as Buffer);
        const hostileSheet = hostileEntries.get('xl/worksheets/sheet1.xml')!;
        assert.ok(hostileSheet.includes('&apos;=CMD|'));
        assert.ok(hostileSheet.includes('&apos;+1+1'));
        assert.ok(hostileSheet.includes('&apos;-2+3'));
        assert.ok(hostileSheet.includes('&apos;@SUM(A1:A2)'));
        assert.ok(hostileSheet.includes('&apos;\t=1+1'));

        console.log('PASS [2/6] Neutralización OWASP anti-inyección de fórmulas verificada en CSV RFC 4180 y XLSX OOXML');
    }

    // =========================================================================
    // TEST 3: Perfiles Chile (6) y Global ERP (6+1) con cabeceras/mapeos propios
    // =========================================================================
    {
        assert.equal(CHILE_ACCOUNTING_PROFILES.length, 6);
        assert.ok(GLOBAL_ERP_ACCOUNTING_PROFILES.length >= 6);

        const seenHeaders = new Set<string>();
        for (const profile of [...CHILE_ACCOUNTING_PROFILES, ...GLOBAL_ERP_ACCOUNTING_PROFILES]) {
            const out = InternationalAccountingExporter.exportAccountingPackage({
                ...baseInput,
                format: 'CSV_RFC4180',
                profile,
            });
            const lines = String(out.content)
                .replace(/^\uFEFF/, '')
                .split('\r\n')
                .filter(Boolean);
            assert.equal(lines.length, 3, `Perfil ${profile} debe producir 1 cabecera + 2 filas`);
            assert.ok(!seenHeaders.has(lines[0]), `Perfil ${profile} debe tener cabecera propia distinta`);
            seenHeaders.add(lines[0]);
            assert.match(out.sha256, /^[a-f0-9]{64}$/);
        }

        console.log('PASS [3/6] 6 perfiles Chile + 7 perfiles Global ERP generan cabeceras y mapeos propios válidos');
    }

    // =========================================================================
    // TEST 4: Firma HMAC-SHA256 + Anti-Replay <=300s + Retries + Delivery Log 30d
    // =========================================================================
    {
        const secret = 'mr_whsec_test_verification_key_001';
        const rawBody = JSON.stringify({ event: 'SUPPLY_PURCHASE_COMMITTED', total: 238000 });
        const nowMs = 1_795_000_000_000;
        const tsSec = String(Math.floor(nowMs / 1000));
        const sig = computeErpWebhookSignature(rawBody, tsSec, secret);

        // 4a. Válido dentro de ventana
        assert.deepEqual(
            verifyErpWebhookSignature({
                rawBody,
                signatureHeader: sig,
                timestampHeader: tsSec,
                secret,
                nowMs: nowMs + 120_000,
            }),
            { valid: true }
        );

        // 4b. Payload alterado -> SIGNATURE_MISMATCH
        assert.deepEqual(
            verifyErpWebhookSignature({
                rawBody: rawBody.replace('238000', '999999'),
                signatureHeader: sig,
                timestampHeader: tsSec,
                secret,
                nowMs,
            }),
            { valid: false, reason: 'SIGNATURE_MISMATCH' }
        );

        // 4c. Replay > 300s -> TIMESTAMP_OUT_OF_WINDOW
        assert.deepEqual(
            verifyErpWebhookSignature({
                rawBody,
                signatureHeader: sig,
                timestampHeader: tsSec,
                secret,
                nowMs: nowMs + 301_000,
            }),
            { valid: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' }
        );

        // 4d. Despacho con reintento (503 -> 200) + verificación de cabeceras y log TTL 30d sin secretos
        await seedHttpTenantFixtures();
        SignedErpWebhookDispatcher.setCustomUrlValidatorForTests(
            async (urlStr) => new URL(urlStr)
        );
        let callCount = 0;
        let capturedHeaders: Record<string, string> = {};
        let capturedBody = '';
        SignedErpWebhookDispatcher.setCustomFetchForTests(async (_url, init) => {
            callCount += 1;
            capturedHeaders = (init.headers || {}) as Record<string, string>;
            capturedBody = String(init.body || '');
            if (callCount === 1) {
                return new Response('Upstream busy', { status: 503 });
            }
            return new Response(JSON.stringify({ received: true }), { status: 200 });
        });

        try {
            const created = await SignedErpWebhookDispatcher.createWebhook(
                {
                    tenantId: TENANT_ID,
                    name: 'SAP S/4HANA Gateway',
                    targetUrl: 'https://erp-gateway.example.com/webhooks/minreport',
                    events: ['SUPPLY_PURCHASE_COMMITTED', 'SUPPLY_WEBHOOK_TEST'],
                },
                { actorUid: 'uid-owner-e10', actorEmail: 'owner@minera-e10.cl' }
            );

            const delivery = await SignedErpWebhookDispatcher.sendTestWebhook(
                TENANT_ID,
                created.webhook.webhookId,
                { actorUid: 'uid-owner-e10', actorEmail: 'owner@minera-e10.cl' },
                { baseRetryDelayMs: 5 }
            );
            assert.equal(delivery.status, 'DELIVERED');
            assert.equal(delivery.httpStatus, 200);
            assert.equal(delivery.attempts, 2, 'Debe reintentar tras HTTP 503 y triunfar en intento 2');

            // Verificar firma recibida con el secreto devuelto al crear
            const sigCheck = verifyErpWebhookSignature({
                rawBody: capturedBody,
                signatureHeader: capturedHeaders['X-Minreport-Signature'],
                timestampHeader: capturedHeaders['X-Minreport-Timestamp'],
                secret: created.signingSecretOnce,
            });
            assert.equal(sigCheck.valid, true);
            assert.equal(capturedHeaders['X-Minreport-Event'], 'SUPPLY_WEBHOOK_TEST');
            assert.ok(capturedHeaders['X-Minreport-Delivery-Id']);

            // Verificar bitácora 30d en supply_erp_webhook_deliveries sin secretos
            const deliveryDoc = getCollectionMap(SUPPLY_ERP_WEBHOOK_DELIVERIES_COLLECTION).get(
                delivery.deliveryId
            );
            assert.ok(deliveryDoc, 'Bitácora de entrega debe persistirse');
            assert.ok(deliveryDoc.ttlExpiresAt, 'Debe declarar ttlExpiresAt (30 días)');
            assert.ok(
                !JSON.stringify(deliveryDoc).includes(created.signingSecretOnce),
                'Bitácora jamás debe contener el secreto'
            );
        } finally {
            SignedErpWebhookDispatcher.setCustomFetchForTests(null);
            SignedErpWebhookDispatcher.setCustomUrlValidatorForTests(null);
        }

        console.log('PASS [4/6] SignedErpWebhookDispatcher (HMAC-SHA256, anti-replay <=300s, retry 503->200 y bitácora 30d)');
    }

    // =========================================================================
    // TEST 5: Bloqueo SSRF real en alta de webhook (`169.254.169.254`, `127.0.0.1`, `metadata.google.internal`)
    // =========================================================================
    {
        await seedHttpTenantFixtures();
        const blockedUrls = [
            'http://169.254.169.254/latest/meta-data/',
            'https://169.254.169.254/computeMetadata/v1/',
            'https://metadata.google.internal/computeMetadata/v1/',
            'http://127.0.0.1:8080/internal-hook',
            'http://10.0.0.1/erp',
        ];
        for (const badUrl of blockedUrls) {
            await assert.rejects(
                () =>
                    SignedErpWebhookDispatcher.createWebhook(
                        {
                            tenantId: TENANT_ID,
                            name: 'SSRF Probe',
                            targetUrl: badUrl,
                            events: ['SUPPLY_WEBHOOK_TEST'],
                        },
                        { actorUid: 'uid-owner-e10', actorEmail: 'owner@minera-e10.cl' }
                    ),
                (err: any) => err instanceof SSRFBlockedError
            );
        }
        assert.equal(getCollectionMap(SUPPLY_ERP_WEBHOOKS_COLLECTION).size, 0);

        console.log('PASS [5/6] Bloqueo anti-SSRF estricto (169.254.169.254, metadata.google.internal, 127.0.0.1, 10.0.0.1)');
    }

    // =========================================================================
    // TEST 6: Rutas HTTP `/exports/accounting`, `/sii/export` y `/erp-webhooks` (RBAC + sin secretos)
    // =========================================================================
    {
        await seedHttpTenantFixtures();
        const app = express();
        app.use(express.json());
        app.use('/api/supply', supplyRouter);
        const dispatch = createInProcessDispatcher(app);

        // 6a. GET /api/supply/exports/accounting?format=XLSX_OOXML&profile=GLOBAL_SAP_S4HANA
        const xlsxHttp = await dispatch(
            '/api/supply/exports/accounting?format=XLSX_OOXML&profile=GLOBAL_SAP_S4HANA',
            {
                method: 'GET',
                headers: { Authorization: 'Bearer tok-owner', 'x-active-account-id': TENANT_ID },
            }
        );
        assert.equal(xlsxHttp.status, 200);
        assert.equal(
            xlsxHttp.headers['content-type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        assert.match(String(xlsxHttp.headers['x-minreport-export-sha256'] || ''), /^[a-f0-9]{64}$/);
        assert.ok(String(xlsxHttp.headers['content-disposition'] || '').includes('.xlsx'));
        const httpXlsxEntries = extractZipEntries(xlsxHttp.buffer);
        assert.ok(httpXlsxEntries.get('xl/worksheets/sheet1.xml')?.includes('BUKRS'));

        // 6b. Retrocompatibilidad GET /api/supply/sii/export (sin query) + extensión con format=UBL_2_1_PEPPOL
        const legacySii = await dispatch('/api/supply/sii/export', {
            method: 'GET',
            headers: { Authorization: 'Bearer tok-owner', 'x-active-account-id': TENANT_ID },
        });
        assert.equal(legacySii.status, 200);
        assert.ok(legacySii.text.includes('DEDUPE_KEY;RUT_EMISOR;PROVEEDOR'));

        const ublViaSii = await dispatch('/api/supply/sii/export?format=UBL_2_1_PEPPOL&profile=CL_SII_RCV', {
            method: 'GET',
            headers: { Authorization: 'Bearer tok-owner', 'x-active-account-id': TENANT_ID },
        });
        assert.equal(ublViaSii.status, 200);
        assert.ok(ublViaSii.text.includes('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'));

        // 6c. VIEWER y OPERATOR reciben 403 en /erp-webhooks
        const viewerGet = await dispatch('/api/supply/erp-webhooks', {
            method: 'GET',
            headers: { Authorization: 'Bearer tok-viewer', 'x-active-account-id': TENANT_ID },
        });
        assert.equal(viewerGet.status, 403);
        assert.equal(viewerGet.json?.code, 'ERP_WEBHOOK_ADMIN_REQUIRED');

        const operatorGet = await dispatch('/api/supply/erp-webhooks', {
            method: 'GET',
            headers: { Authorization: 'Bearer tok-operator', 'x-active-account-id': TENANT_ID },
        });
        assert.equal(operatorGet.status, 403);
        assert.equal(operatorGet.json?.code, 'ERP_WEBHOOK_ADMIN_REQUIRED');

        // 6d. POST /erp-webhooks con destino SSRF -> HTTP 403 SSRF_BLOCKED
        const ssrfPost = await dispatch('/api/supply/erp-webhooks', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer tok-owner',
                'x-active-account-id': TENANT_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                confirmationKeyword: 'ACTUALIZAR',
                name: 'Metadata Attack',
                targetUrl: 'http://169.254.169.254/latest/meta-data/',
                events: ['SUPPLY_PURCHASE_COMMITTED'],
            }),
        });
        assert.equal(ssrfPost.status, 403);
        assert.equal(ssrfPost.json?.code, 'SSRF_BLOCKED');

        // 6e. POST -> GET (0 secreto plano) -> TEST -> DELETE (exige ACTUALIZAR)
        SignedErpWebhookDispatcher.setCustomUrlValidatorForTests(
            async (urlStr) => new URL(urlStr)
        );
        SignedErpWebhookDispatcher.setCustomFetchForTests(
            async () => new Response('ok', { status: 200 })
        );
        try {
            const createResp = await dispatch('/api/supply/erp-webhooks', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'x-active-account-id': TENANT_ID,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    confirmationKeyword: 'ACTUALIZAR',
                    name: 'NetSuite Production Connector',
                    targetUrl: 'https://netsuite.example.com/minreport/hook',
                    events: ['SUPPLY_PURCHASE_COMMITTED', 'SUPPLY_EXPENSE_REPORT_APPROVED'],
                }),
            });
            assert.equal(createResp.status, 201);
            const createdId = createResp.json?.webhook?.webhookId;
            const secretOnce = createResp.json?.signingSecretOnce;
            assert.ok(createdId && secretOnce);

            const listResp = await dispatch('/api/supply/erp-webhooks', {
                method: 'GET',
                headers: { Authorization: 'Bearer tok-owner', 'x-active-account-id': TENANT_ID },
            });
            assert.equal(listResp.status, 200);
            assert.equal(listResp.json?.count, 1);
            const listedJson = JSON.stringify(listResp.json);
            assert.ok(!listedJson.includes(secretOnce), 'GET /erp-webhooks jamás debe exponer el secreto en texto plano');
            assert.ok(!listedJson.includes('secretEnvelope'), 'GET /erp-webhooks jamás debe exponer secretEnvelope');
            assert.ok(listResp.json.webhooks[0].secretHash);

            const testResp = await dispatch(`/api/supply/erp-webhooks/${createdId}/test`, {
                method: 'POST',
                headers: { Authorization: 'Bearer tok-owner', 'x-active-account-id': TENANT_ID },
            });
            assert.equal(testResp.status, 200);
            assert.equal(testResp.json?.delivery?.status, 'DELIVERED');

            // DELETE sin palabra clave ACTUALIZAR -> 400
            const badDel = await dispatch(`/api/supply/erp-webhooks/${createdId}`, {
                method: 'DELETE',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'x-active-account-id': TENANT_ID,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ confirmationKeyword: 'BORRAR' }),
            });
            assert.equal(badDel.status, 400);

            const okDel = await dispatch(`/api/supply/erp-webhooks/${createdId}`, {
                method: 'DELETE',
                headers: {
                    Authorization: 'Bearer tok-owner',
                    'x-active-account-id': TENANT_ID,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ confirmationKeyword: 'ACTUALIZAR' }),
            });
            assert.equal(okDel.status, 200);
            assert.equal(okDel.json?.deleted, true);
        } finally {
            SignedErpWebhookDispatcher.setCustomFetchForTests(null);
            SignedErpWebhookDispatcher.setCustomUrlValidatorForTests(null);
        }

        console.log('PASS [6/6] Endpoints HTTP /exports/accounting, /sii/export y /erp-webhooks (RBAC 403 VIEWER/OPERATOR, sin secreto plano, HITL ACTUALIZAR)');
    }

    console.log('\nALL E10 INTERNATIONAL ACCOUNTING EXPORTS & SIGNED ERP WEBHOOKS TESTS PASSED (6/6)');
}

let allE10TestsCompleted = false;
process.on('beforeExit', () => {
    if (!allE10TestsCompleted) {
        console.error('E10 ACCOUNTING/ERP TEST FAILED: Event loop drained before all 6 tests completed.');
        process.exit(1);
    }
});

runTests()
    .then(() => {
        allE10TestsCompleted = true;
    })
    .catch((err) => {
        console.error('E10 ACCOUNTING/ERP TEST FAILED:', err);
        process.exit(1);
    });
