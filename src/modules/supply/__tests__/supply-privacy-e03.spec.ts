/**
 * MINREPORT · ABASTECIMIENTO — E03 Ley N° 21.719 Privacy, Vertex CDPA, Multimodal Cache, CAS XML/dHash & ARCO-P Suite
 *
 * Pruebas deterministas 100% en memoria (cero red, cero TCP loopback, compatible con Node v20.19.5 sandbox):
 * 1. `ResilientAIClient`: CDPA Zero-Training fail-closed en producción + caché SHA-256 multimodal aislada por tenant.
 * 2. `MediaDigestorServer` + `ReceiptIntelligencePipeline`: perfil `XML_DTE_DOCUMENT` (`.xml` preservando `<TED>`/`<Signature>`)
 *    y rechazo fail-closed `PDF_SANITIZATION_FAILED` ante PDF corrupto sin purga XMP.
 * 3. `CasStorageService`: deduplicación perceptual `dHash` 64-bit dentro de `TENANT_PRIVATE` sin cruce cross-tenant.
 * 4. `EmailService` + `SupplyRepository`: enmascarado PII en logs, enmascarado de teléfono en requisiciones,
 *    retención legal 6 años (`retentionUntil`) y `ttlExpiresAt` (24h sesiones / 7d wamids).
 * 5. ARCO-P: `DELETE /api/staff/members/:memberUid` (purga sesiones WhatsApp, anonimización fiscal y AuditLedger sin correo plano)
 *    y `purgeTenant` (purga 16+ colecciones `supply_*`, subcolección `lines`, `media_registry`, blobs Storage y bloqueo cuentas protegidas).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Duplex } from 'node:stream';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// 1. In-Memory Firestore + Auth + Storage Stub (intercepts src/config/firebase)
// ---------------------------------------------------------------------------

type DocData = Record<string, any>;
const collectionsStore = new Map<string, Map<string, DocData>>();
const subcollectionsStore = new Map<string, Map<string, DocData>>();
const storageBlobs = new Map<string, { buffer: Buffer; contentType: string; cacheControl: string }>();

function getCollectionMap(name: string): Map<string, DocData> {
    let m = collectionsStore.get(name);
    if (!m) {
        m = new Map<string, DocData>();
        collectionsStore.set(name, m);
    }
    return m;
}

function getSubcollectionMap(pathKey: string): Map<string, DocData> {
    let m = subcollectionsStore.get(pathKey);
    if (!m) {
        m = new Map<string, DocData>();
        subcollectionsStore.set(pathKey, m);
    }
    return m;
}

function clone<T>(v: T): T {
    if (v === undefined || v === null) return v;
    if (typeof v === 'object' && typeof (v as any).toMillis === 'function') {
        return v;
    }
    return JSON.parse(JSON.stringify(v));
}

function preserveTimestampsClone(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (typeof obj.toMillis === 'function') return obj;
    if (Array.isArray(obj)) return obj.map((item) => preserveTimestampsClone(item));
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
            out[k] = preserveTimestampsClone(v);
        }
    }
    return out;
}

function createDocRef(store: Map<string, DocData>, docPathPrefix: string, id: string): any {
    const fullPath = `${docPathPrefix}/${id}`;
    const ref: any = {
        id,
        path: fullPath,
        async get() {
            const existing = store.get(id);
            return {
                id,
                exists: existing !== undefined,
                ref,
                data: () => (existing !== undefined ? preserveTimestampsClone(existing) : undefined),
            };
        },
        async set(data: DocData, options?: { merge?: boolean }) {
            const incoming = preserveTimestampsClone(data);
            if (options?.merge && store.has(id)) {
                store.set(id, { ...store.get(id)!, ...incoming });
            } else {
                store.set(id, incoming);
            }
        },
        async update(patch: DocData) {
            const existing = store.get(id) || {};
            store.set(id, { ...existing, ...preserveTimestampsClone(patch) });
        },
        async delete() {
            store.delete(id);
        },
        collection(subName: string) {
            const subPath = `${fullPath}/${subName}`;
            return createCollectionRef(getSubcollectionMap(subPath), subPath);
        },
    };
    return ref;
}

function applyWhereFilter(
    entries: Array<[string, DocData]>,
    field: string,
    op: string,
    val: any
): Array<[string, DocData]> {
    return entries.filter(([, data]) => {
        const actual = field.split('.').reduce<any>((acc, k) => (acc ? acc[k] : undefined), data);
        if (op === '==') return actual === val;
        if (op === 'in' && Array.isArray(val)) return val.includes(actual);
        return false;
    });
}

function createQuery(
    store: Map<string, DocData>,
    colPath: string,
    filters: Array<{ field: string; op: string; val: any }> = [],
    maxLimit?: number
): any {
    return {
        where(field: string, op: string, val: any) {
            return createQuery(store, colPath, [...filters, { field, op, val }], maxLimit);
        },
        orderBy() {
            return createQuery(store, colPath, filters, maxLimit);
        },
        limit(n: number) {
            return createQuery(store, colPath, filters, n);
        },
        async get() {
            let entries = Array.from(store.entries());
            for (const f of filters) {
                entries = applyWhereFilter(entries, f.field, f.op, f.val);
            }
            if (typeof maxLimit === 'number') {
                entries = entries.slice(0, maxLimit);
            }
            const docs = entries.map(([id, data]) => {
                const ref = createDocRef(store, colPath, id);
                return {
                    id,
                    exists: true,
                    ref,
                    data: () => preserveTimestampsClone(data),
                };
            });
            return { docs, empty: docs.length === 0, size: docs.length };
        },
    };
}

function createCollectionRef(store: Map<string, DocData>, colPath: string): any {
    const q = createQuery(store, colPath);
    return {
        ...q,
        doc(id?: string) {
            const resolvedId = id || `auto_${crypto.randomBytes(6).toString('hex')}`;
            return createDocRef(store, colPath, resolvedId);
        },
        async add(data: DocData) {
            const resolvedId = `auto_${crypto.randomBytes(6).toString('hex')}`;
            const ref = createDocRef(store, colPath, resolvedId);
            await ref.set(data);
            return ref;
        },
    };
}

const mockDb: any = {
    collection(name: string) {
        return createCollectionRef(getCollectionMap(name), name);
    },
    async getAll(...refs: any[]) {
        return Promise.all(refs.map((r) => r.get()));
    },
    batch() {
        const ops: Array<() => Promise<void>> = [];
        return {
            set(ref: any, data: DocData, options?: { merge?: boolean }) {
                ops.push(() => ref.set(data, options));
            },
            update(ref: any, patch: DocData) {
                ops.push(() => ref.update(patch));
            },
            delete(ref: any) {
                ops.push(() => ref.delete());
            },
            async commit() {
                for (const op of ops) {
                    await op();
                }
            },
        };
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const stagedWrites: Array<() => Promise<void>> = [];
        const tx = {
            async get(ref: any) {
                return ref.get();
            },
            set(ref: any, data: DocData, options?: { merge?: boolean }) {
                stagedWrites.push(() => ref.set(data, options));
            },
            update(ref: any, patch: DocData) {
                stagedWrites.push(() => ref.update(patch));
            },
            delete(ref: any) {
                stagedWrites.push(() => ref.delete());
            },
        };
        const result = await fn(tx);
        for (const w of stagedWrites) {
            await w();
        }
        return result;
    },
};

const mockTokens = new Map<string, Record<string, any>>();
const deletedAuthUids: string[] = [];
const mockAuth: any = {
    async verifyIdToken(token: string) {
        const claim = mockTokens.get(token);
        if (!claim) throw new Error('Invalid token');
        return claim;
    },
    async deleteUser(uid: string) {
        deletedAuthUids.push(uid);
    },
};

const mockStorage: any = {
    bucket() {
        return {
            file(filePath: string) {
                return {
                    name: filePath,
                    async save(buffer: Buffer, opts?: any) {
                        storageBlobs.set(filePath, {
                            buffer: Buffer.from(buffer),
                            contentType: opts?.contentType || 'application/octet-stream',
                            cacheControl: opts?.metadata?.cacheControl || 'private, max-age=86400',
                        });
                    },
                    async getMetadata() {
                        const item = storageBlobs.get(filePath);
                        if (!item) throw new Error(`Not found: ${filePath}`);
                        return [
                            {
                                size: String(item.buffer.length),
                                contentType: item.contentType,
                                cacheControl: item.cacheControl,
                            },
                        ];
                    },
                    async download() {
                        const item = storageBlobs.get(filePath);
                        if (!item) throw new Error(`Not found: ${filePath}`);
                        return [Buffer.from(item.buffer)];
                    },
                    async delete() {
                        storageBlobs.delete(filePath);
                    },
                };
            },
            async getFiles(opts?: { prefix?: string }) {
                const prefix = opts?.prefix || '';
                const matched = Array.from(storageBlobs.keys())
                    .filter((k) => k.startsWith(prefix))
                    .map((k) => ({
                        name: k,
                        async delete() {
                            storageBlobs.delete(k);
                        },
                    }));
                return [matched];
            },
        };
    },
};

// Inject firebase stub into require.cache before loading app modules
const firebaseModulePath = require.resolve('../../../config/firebase');
require.cache[firebaseModulePath] = {
    id: firebaseModulePath,
    filename: firebaseModulePath,
    loaded: true,
    exports: {
        __esModule: true,
        default: { firestore: { FieldValue: { serverTimestamp: () => new Date().toISOString() } } },
        db: mockDb,
        auth: mockAuth,
        storage: mockStorage,
    },
} as any;

process.env.MOCK_EMAILS = 'true';

import { ResilientAIClient, AISwarmUnavailableError } from '../../../core/resilient-ai-client';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ReceiptIntelligencePipeline } from '../application/ReceiptIntelligencePipeline';
import {
    SupplyRepository,
    SUPPLY_COLLECTIONS,
    maskPhoneE164,
    hashPhoneE164,
} from '../application/SupplyRepository';
import { EmailService, maskEmailForLog } from '../../../services/EmailService';
import staffRouter from '../../../api/staff.controller';
import { purgeTenant } from '../../../api/admin.controller';

function resetStores(): void {
    collectionsStore.clear();
    subcollectionsStore.clear();
    storageBlobs.clear();
    mockTokens.clear();
    deletedAuthUids.length = 0;
}

function createInProcessDispatcher(app: express.Express) {
    return (
        method: string,
        urlPath: string,
        options: { headers?: Record<string, string>; body?: any } = {}
    ): Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }> =>
        new Promise((resolve, reject) => {
            const rawChunks: Buffer[] = [];
            const socket: any = new Duplex({
                read() {},
                write(chunk, _enc, cb) {
                    rawChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    cb();
                },
            });
            socket.remoteAddress = '127.0.0.1';
            socket.encrypted = false;
            socket.destroy = () => socket;
            socket.setTimeout = () => socket;
            socket.setNoDelay = () => socket;
            socket.setKeepAlive = () => socket;

            const req = new http.IncomingMessage(socket);
            req.method = method.toUpperCase();
            req.url = urlPath;

            const bodyStr =
                options.body !== undefined
                    ? typeof options.body === 'string'
                        ? options.body
                        : JSON.stringify(options.body)
                    : '';
            const bodyBuf = Buffer.from(bodyStr, 'utf8');

            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(options.headers || {})) {
                headers[k.toLowerCase()] = v;
            }
            if (bodyBuf.length > 0 && !headers['content-type']) {
                headers['content-type'] = 'application/json';
            }
            if (bodyBuf.length > 0) {
                headers['content-length'] = String(bodyBuf.length);
            }
            req.headers = headers;

            const res = new http.ServerResponse(req);
            res.assignSocket(socket);
            res.on('finish', () => {
                const rawResponse = Buffer.concat(rawChunks);
                const sepIdx = rawResponse.indexOf('\r\n\r\n');
                const bodyPart = sepIdx >= 0 ? rawResponse.subarray(sepIdx + 4) : Buffer.alloc(0);
                const transferEncoding = String(res.getHeader('transfer-encoding') || '').toLowerCase();
                let finalBody = bodyPart;
                if (transferEncoding.includes('chunked')) {
                    const parts: Buffer[] = [];
                    let offset = 0;
                    while (offset < bodyPart.length) {
                        const lineEnd = bodyPart.indexOf('\r\n', offset);
                        if (lineEnd < 0) break;
                        const size = parseInt(bodyPart.subarray(offset, lineEnd).toString('ascii').trim(), 16);
                        if (!Number.isFinite(size) || size <= 0) break;
                        const start = lineEnd + 2;
                        parts.push(bodyPart.subarray(start, start + size));
                        offset = start + size + 2;
                    }
                    finalBody = Buffer.concat(parts);
                }
                const txt = finalBody.toString('utf8');
                resolve({
                    status: res.statusCode,
                    text: async () => txt,
                    json: async () => JSON.parse(txt),
                });
            });
            res.on('error', reject);

            if (bodyBuf.length > 0) req.push(bodyBuf);
            req.push(null);
            (app as any)(req, res);
        });
}

async function buildTexturedTestImage(quality: number, tintOffset: number = 0): Promise<Buffer> {
    const width = 160;
    const height = 120;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            const blockX = Math.floor(x / 20);
            const blockY = Math.floor(y / 15);
            const isDark = (blockX + blockY) % 2 === 0;
            const gradient = Math.floor((x / width) * 90 + (y / height) * 60);
            const base = isDark ? 35 + gradient : 185 - Math.floor(gradient / 2);
            raw[idx] = Math.min(255, Math.max(0, base + tintOffset));
            raw[idx + 1] = Math.min(255, Math.max(0, base));
            raw[idx + 2] = Math.min(255, Math.max(0, 255 - base));
        }
    }
    return sharp(raw, { raw: { width, height, channels: 3 } })
        .jpeg({ quality })
        .toBuffer();
}

async function runTests(): Promise<void> {
    console.log('=== E03 PRIVACY, VERTEX CDPA, MULTIMODAL CACHE, CAS XML/dHash & ARCO-P SUITE ===');

    // -----------------------------------------------------------------------
    // 1. ResilientAIClient: CDPA Zero-Training in Production + Multimodal Cache
    // -----------------------------------------------------------------------
    console.log('1) Testing ResilientAIClient CDPA Zero-Training guard & tenant-isolated multimodal SHA-256 cache...');
    {
        resetStores();
        ResilientAIClient.clearInferenceCacheForTesting();

        const origNodeEnv = process.env.NODE_ENV;
        const origUseVertex = process.env.USE_VERTEX_AI;
        const origVertexLoc = process.env.VERTEX_AI_LOCATION;
        const origGeminiKey = process.env.GEMINI_API_KEY;

        let modelInvocations = 0;
        const fakeSdkClient: any = {
            models: {
                async generateContent() {
                    modelInvocations += 1;
                    return {
                        text: JSON.stringify({ ok: true, callIndex: modelInvocations }),
                        candidates: [{}],
                    };
                },
            },
        };
        ResilientAIClient.setTestSDKClientForTesting(fakeSdkClient);

        try {
            const mediaA = Buffer.from('RECEIPT_IMAGE_BINARY_ALPHA_V1').toString('base64');
            const mediaB = Buffer.from('RECEIPT_IMAGE_BINARY_BETA_V2').toString('base64');

            // 1a. Production without Vertex AI or PROD_SECRET_MANAGER_GCP -> CDPA_REQUIRED_IN_PRODUCTION
            process.env.NODE_ENV = 'production';
            process.env.USE_VERTEX_AI = 'false';
            process.env.GEMINI_API_KEY = 'local-dev-free-tier-key';

            await assert.rejects(
                () =>
                    ResilientAIClient.generate({
                        module: 'supply',
                        tenantId: 'tenant-alpha',
                        prompt: 'Extraer líneas de factura',
                        temperature: 0,
                        media: [{ mimeType: 'image/webp', dataBase64: mediaA }],
                    }),
                (err: any) =>
                    err instanceof AISwarmUnavailableError && err.code === 'CDPA_REQUIRED_IN_PRODUCTION'
            );
            assert.equal(modelInvocations, 0, 'No model call allowed when CDPA check fails');

            await assert.rejects(
                () =>
                    ResilientAIClient.generate({
                        module: 'supply',
                        tenantId: 'tenant-alpha',
                        dataClassification: 'TENANT_PRIVATE',
                        prompt: 'Resumen financiero privado',
                        temperature: 0,
                    }),
                (err: any) =>
                    err instanceof AISwarmUnavailableError && err.code === 'CDPA_REQUIRED_IN_PRODUCTION'
            );
            assert.equal(modelInvocations, 0);

            // 1b. Production with USE_VERTEX_AI=true in non-Chile region -> REJECTED
            process.env.USE_VERTEX_AI = 'true';
            process.env.VERTEX_AI_LOCATION = 'us-central1';
            await assert.rejects(
                () =>
                    ResilientAIClient.generate({
                        module: 'supply',
                        tenantId: 'tenant-alpha',
                        prompt: 'Extraer líneas de factura',
                        temperature: 0,
                        media: [{ mimeType: 'image/webp', dataBase64: mediaA }],
                    }),
                (err: any) =>
                    err instanceof AISwarmUnavailableError && err.code === 'CDPA_REQUIRED_IN_PRODUCTION'
            );
            assert.equal(modelInvocations, 0);

            // 1c. Production with Vertex AI in southamerica-west1 -> PASS + Multimodal SHA-256 Cache
            process.env.VERTEX_AI_LOCATION = 'southamerica-west1';

            const firstCall = await ResilientAIClient.generate({
                module: 'supply',
                tenantId: 'tenant-alpha',
                prompt: 'Extraer ítems factura',
                temperature: 0,
                preferredTier: 'SECONDARY',
                media: [{ mimeType: 'image/webp', dataBase64: mediaA }],
            });
            assert.equal(firstCall.cached, false);
            assert.equal(modelInvocations, 1);

            // Second IDENTICAL call (same tenant + same binary) -> L1 hit, 0 extra model calls!
            const secondCall = await ResilientAIClient.generate({
                module: 'supply',
                tenantId: 'tenant-alpha',
                prompt: 'Extraer ítems factura',
                temperature: 0,
                preferredTier: 'SECONDARY',
                media: [{ mimeType: 'image/webp', dataBase64: mediaA }],
            });
            assert.equal(secondCall.cached, true);
            assert.equal(secondCall.text, firstCall.text);
            assert.equal(modelInvocations, 1, 'Identical multimodal request for same tenant must hit L1 cache');

            // Different tenantId with SAME binary -> MUST MISS (strict tenant isolation!)
            const otherTenantCall = await ResilientAIClient.generate({
                module: 'supply',
                tenantId: 'tenant-beta',
                prompt: 'Extraer ítems factura',
                temperature: 0,
                preferredTier: 'SECONDARY',
                media: [{ mimeType: 'image/webp', dataBase64: mediaA }],
            });
            assert.equal(otherTenantCall.cached, false);
            assert.equal(modelInvocations, 2, 'Different tenantId must NOT reuse another tenant multimodal cache');

            // Same tenantId with DIFFERENT binary -> MUST MISS!
            const otherBinaryCall = await ResilientAIClient.generate({
                module: 'supply',
                tenantId: 'tenant-alpha',
                prompt: 'Extraer ítems factura',
                temperature: 0,
                preferredTier: 'SECONDARY',
                media: [{ mimeType: 'image/webp', dataBase64: mediaB }],
            });
            assert.equal(otherBinaryCall.cached, false);
            assert.equal(modelInvocations, 3, 'Different media binary must compute distinct SHA-256 cache key');
        } finally {
            ResilientAIClient.setTestSDKClientForTesting(null);
            ResilientAIClient.clearInferenceCacheForTesting();
            if (origNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = origNodeEnv;
            if (origUseVertex === undefined) delete process.env.USE_VERTEX_AI;
            else process.env.USE_VERTEX_AI = origUseVertex;
            if (origVertexLoc === undefined) delete process.env.VERTEX_AI_LOCATION;
            else process.env.VERTEX_AI_LOCATION = origVertexLoc;
            if (origGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
            else process.env.GEMINI_API_KEY = origGeminiKey;
        }
    }

    // -----------------------------------------------------------------------
    // 2. MediaDigestorServer: XML_DTE_DOCUMENT & Corrupt PDF Fail-Closed
    // -----------------------------------------------------------------------
    console.log('2) Testing MediaDigestorServer XML_DTE_DOCUMENT (<TED>/<Signature> intact) & PDF_SANITIZATION_FAILED...');
    {
        resetStores();

        const tedBlock = `<TED version="1.0">\n  <DD>\n    <RE>76192083-9</RE>\n    <TD>33</TD>\n    <F>9012</F>\n    <FE>2026-11-20</FE>\n    <MNT>119000</MNT>\n    <IT1>Pernos M12</IT1>\n  </DD>\n  <FRMT algoritmo="SHA1withRSA">AbCdEf123456==</FRMT>\n</TED>`;
        const sigBlock = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">\n  <SignedInfo>  EXACT_BYTES  </SignedInfo>\n</Signature>`;
        const dteBody = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<DTE version="1.0"><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>9012</Folio><FchEmis>2026-11-20</FchEmis></IdDoc><Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Proveedor Minero SpA</RznSoc></Emisor><Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales></Encabezado><Detalle><NmbItem>Pernos M12</NmbItem><QtyItem>10</QtyItem><UnmdItem>un</UnmdItem><PrcItem>10000</PrcItem><MontoItem>100000</MontoItem></Detalle>${tedBlock}</Documento>${sigBlock}</DTE>`;
        const xmlWithBomAndOuterSpaces = Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from(`   \n\t${dteBody}\n   `, 'utf8'),
        ]);

        const digestedXml = await MediaDigestorServer.digestAny(
            xmlWithBomAndOuterSpaces,
            'application/xml',
            'XML_DTE_DOCUMENT'
        );
        assert.equal(digestedXml.profile, 'XML_DTE_DOCUMENT');
        assert.equal(digestedXml.mimeType, 'application/xml');
        assert.equal(digestedXml.extension, 'xml');
        assert.equal(digestedXml.originalBytes, xmlWithBomAndOuterSpaces.length);
        assert.ok(digestedXml.optimizedBytes < digestedXml.originalBytes);
        assert.ok(digestedXml.savingsRatio > 0);
        const outXmlStr = digestedXml.buffer.toString('utf8');
        assert.ok(outXmlStr.includes(tedBlock), '<TED> block bytes must be preserved intact');
        assert.ok(outXmlStr.includes(sigBlock), '<Signature> block bytes must be preserved intact');

        // Auto-routing by text/xml MIME without explicit profile -> XML_DTE_DOCUMENT (never VIDEO_FIELD_COMPACT/.bin)
        const autoXml = await MediaDigestorServer.digestAny(xmlWithBomAndOuterSpaces, 'text/xml');
        assert.equal(autoXml.profile, 'XML_DTE_DOCUMENT');
        assert.equal(autoXml.extension, 'xml');

        // ReceiptIntelligencePipeline stores XML DTE under XML_DTE_DOCUMENT profile (.xml)
        const analyzedXml = await ReceiptIntelligencePipeline.analyze({
            tenantId: 'tenant-xml',
            actorUid: 'uid-buyer',
            rawBuffer: xmlWithBomAndOuterSpaces,
            mimeType: 'application/xml',
            originalFilename: 'dte_9012.xml',
        });
        assert.equal(analyzedXml.evidenceCasRef?.profile, 'XML_DTE_DOCUMENT');
        assert.equal(analyzedXml.evidenceCasRef?.extension, 'xml');
        assert.equal(analyzedXml.evidenceCasRef?.mimeType, 'application/xml');
        assert.equal(analyzedXml.folio, 9012);

        // Corrupt PDF MUST throw PDF_SANITIZATION_FAILED (never store unpurged raw buffer)
        const corruptPdf = Buffer.from('%PDF-1.7\n<< /Author (Juan Secreto) >> CORRUPT_STREAM_DATA', 'utf8');
        await assert.rejects(
            () => MediaDigestorServer.digestAny(corruptPdf, 'application/pdf', 'PDF_HYBRID_OEM'),
            (err: any) =>
                err instanceof Error &&
                (err as any).code === 'PDF_SANITIZATION_FAILED' &&
                err.message.includes('PDF_SANITIZATION_FAILED')
        );

        // Valid PDF with Author/Producer metadata MUST be purged (and never reverted to unpurged raw buffer)
        const rawDoc = await PDFDocument.create();
        rawDoc.addPage([200, 200]);
        rawDoc.setAuthor('Confidencial Operador Minero');
        rawDoc.setProducer('Private Workstation PDF');
        const rawPdfBuf = Buffer.from(await rawDoc.save());

        const sanitizedPdf = await MediaDigestorServer.digestPdf(rawPdfBuf, { enableSelectiveRaster: false });
        const reloaded = await PDFDocument.load(sanitizedPdf.buffer, { updateMetadata: false });
        assert.equal(reloaded.getAuthor(), '');
        assert.equal(reloaded.getProducer(), 'MINREPORT Industrial Core');
    }

    // -----------------------------------------------------------------------
    // 3. CasStorageService: Perceptual dHash Dedup in TENANT_PRIVATE (No Cross-Tenant)
    // -----------------------------------------------------------------------
    console.log('3) Testing CasStorageService 64-bit dHash perceptual dedup in TENANT_PRIVATE (strict tenant boundary)...');
    {
        resetStores();

        const jpegHigh = await buildTexturedTestImage(92, 0);
        const jpegLow = await buildTexturedTestImage(60, 0);

        const digestedA = await MediaDigestorServer.digestImage(jpegHigh, 'IMAGE_TECHNICAL_HD');
        const digestedB = await MediaDigestorServer.digestImage(jpegLow, 'IMAGE_TECHNICAL_HD');

        assert.ok(digestedA.phashHex && digestedA.phashHex !== '0000000000000000');
        assert.ok(digestedB.phashHex && digestedB.phashHex !== '0000000000000000');
        assert.notEqual(digestedA.sha256, digestedB.sha256, 'Re-encoded image must have distinct SHA-256');
        const hamming = MediaDigestorServer.hammingDistanceHex64(digestedA.phashHex, digestedB.phashHex);
        assert.ok(hamming <= 2, `Expected near-duplicate Hamming <= 2, got ${hamming}`);

        // 3a. First upload for tenant-a -> stored fresh
        const storedA = await CasStorageService.persistDigestedBinary(digestedA, {
            scope: 'TENANT_PRIVATE',
            tenantId: 'tenant-a',
            actorUid: 'uid-a',
            originalFilename: 'receipt_a1.jpg',
        });
        assert.equal(storedA.deduplicatedHit, false);

        // 3b. Near-duplicate upload for SAME tenant-a -> perceptual dHash dedup hit!
        const storedB = await CasStorageService.persistDigestedBinary(digestedB, {
            scope: 'TENANT_PRIVATE',
            tenantId: 'tenant-a',
            actorUid: 'uid-a',
            originalFilename: 'receipt_a2_recompressed.jpg',
        });
        assert.equal(storedB.deduplicatedHit, true);
        assert.equal(storedB.nearDuplicateOf, storedA.sha256);
        assert.equal(storedB.sha256, storedA.sha256);

        // 3c. Same near-duplicate upload for DIFFERENT tenant-b -> MUST NOT deduplicate cross-tenant!
        const storedOtherTenant = await CasStorageService.persistDigestedBinary(digestedB, {
            scope: 'TENANT_PRIVATE',
            tenantId: 'tenant-b',
            actorUid: 'uid-b',
            originalFilename: 'receipt_b1.jpg',
        });
        assert.equal(storedOtherTenant.deduplicatedHit, false);
        assert.equal(storedOtherTenant.sha256, digestedB.sha256);
        assert.ok(storedOtherTenant.storagePath.startsWith('cas_blobs/tenants/tenant-b/'));

        // 3d. Opt-out via enablePerceptualDedup: false stores distinct SHA-256 within tenant-a
        const storedOptOut = await CasStorageService.persistDigestedBinary(digestedB, {
            scope: 'TENANT_PRIVATE',
            tenantId: 'tenant-a',
            actorUid: 'uid-a',
            originalFilename: 'receipt_a2_exact.jpg',
            enablePerceptualDedup: false,
        });
        assert.equal(storedOptOut.deduplicatedHit, false);
        assert.equal(storedOptOut.sha256, digestedB.sha256);
    }

    // -----------------------------------------------------------------------
    // 4. EmailService PII Log Masking + SupplyRepository Phone Masking, 6Y Retention & TTL
    // -----------------------------------------------------------------------
    console.log('4) Testing EmailService PII log masking & SupplyRepository phone masking, 6Y retentionUntil and TTL...');
    {
        resetStores();

        const capturedLogs: string[] = [];
        const origLog = console.log;
        const origWarn = console.warn;
        const origError = console.error;
        console.log = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
        console.warn = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
        console.error = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));

        try {
            await EmailService.sendEmail({
                from: 'MINREPORT <no-reply@minreport.com>',
                to: 'operador.privado@mineraatacama.cl',
                subject: 'Alta RUT 12.345.678-5 tel +56988887777 token=supersecret999',
                html: '<p>Acceso seguro</p>',
            });
        } finally {
            console.log = origLog;
            console.warn = origWarn;
            console.error = origError;
        }

        const allLogs = capturedLogs.join('\n');
        assert.ok(!allLogs.includes('operador.privado@mineraatacama.cl'), 'Full email MUST NOT appear in logs');
        assert.ok(!allLogs.includes('12.345.678-5'), 'RUT MUST NOT appear in logs');
        assert.ok(!allLogs.includes('88887777'), 'Phone MUST NOT appear in logs');
        assert.ok(!allLogs.includes('supersecret999'), 'Token MUST NOT appear in logs');
        assert.ok(allLogs.includes(maskEmailForLog('operador.privado@mineraatacama.cl')));

        // SupplyRepository phone masking in supply_requisitions
        const rawPhone = '+56900001234';
        const reqRecord = await SupplyRepository.createRequisition(
            {
                tenantId: 'tenant-p',
                siteId: 'site-p',
                requesterUid: 'uid-op1',
                requesterName: 'Pedro Terreno',
                requesterRole: 'CAMP_MANAGER',
                requesterPhoneE164: rawPhone,
                demandOrigin: 'WA_CAMP',
                demandNature: 'REACTIVE_FIELD',
                costCenter: 'CC-CAMPAMENTO',
                atypicalFlags: [],
                lines: [
                    {
                        lineId: 'l1',
                        canonicalSkuId: 'sku-papas',
                        itemName: 'Papas',
                        categoryCode: 'VIVERES_ALIMENTACION',
                        procurementBucket: 'VERDULERIA',
                        unitSi: 'kg',
                        qtyRequested: 10,
                        qtyPurchased: 0,
                        qtyReceived: 0,
                        qtyPending: 10,
                        lineStatus: 'OPEN',
                        atypicalFlags: [],
                        fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                        urgency: 'STANDARD',
                    },
                ],
            },
            { actorUid: 'uid-op1', actorEmail: 'op1@minera.cl' }
        );

        const storedReq = getCollectionMap(SUPPLY_COLLECTIONS.REQUISITIONS).get(reqRecord.reqId)!;
        assert.ok(!JSON.stringify(storedReq).includes(rawPhone), 'Plaintext E.164 phone must NEVER persist in supply_requisitions');
        assert.equal(storedReq.requesterPhoneMasked, maskPhoneE164(rawPhone));
        assert.equal(storedReq.requesterPhoneMasked, '+569****1234');
        assert.equal(storedReq.requesterPhoneE164, '+569****1234');
        assert.equal(storedReq.requesterPhoneHash, hashPhoneE164(rawPhone));

        // 6-year retentionUntil on supply_purchases, supply_sii_documents and supply_expense_reports
        const purchaseOut = await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: 'tenant-p',
                siteId: 'site-p',
                buyerUid: 'uid-buyer',
                buyerRole: 'BUYER',
                purchaseMode: 'DIRECT_AUTONOMOUS',
                authorizedByAuthority: true,
                supplierTaxId: '76192083-9',
                supplierName: 'Ferretería Atacama',
                documentType: 33,
                folio: 5001,
                issueDate: '2026-11-20',
                netAmountClp: 100000,
                vatAmountClp: 19000,
                totalAmountClp: 119000,
                paymentMethod: 'FONDO_POR_RENDIR',
                lines: [
                    {
                        purchaseLineId: 'pl1',
                        canonicalSkuId: 'sku-papas',
                        description: 'Papas',
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
            { actorUid: 'uid-buyer', actorEmail: 'buyer@minera.cl' }
        );

        const storedPurchase = getCollectionMap(SUPPLY_COLLECTIONS.PURCHASES).get(purchaseOut.purchase.purchaseId)!;
        const storedSiiDoc = getCollectionMap(SUPPLY_COLLECTIONS.SII_DOCUMENTS).get(purchaseOut.siiDocument.docId)!;
        assert.equal(storedPurchase.retentionUntil, '2032-11-20T00:00:00.000Z');
        assert.equal(storedSiiDoc.retentionUntil, '2032-11-20T00:00:00.000Z');

        const expenseReport = await SupplyRepository.createExpenseReport(
            {
                tenantId: 'tenant-p',
                siteId: 'site-p',
                custodianUid: 'uid-buyer',
                custodianName: 'Comprador Faena',
                paymentMethod: 'FONDO_POR_RENDIR',
                title: 'Rendición Noviembre',
                fundAdvanceClp: 150000,
                siiDocumentIds: [purchaseOut.siiDocument.docId],
            },
            { actorUid: 'uid-buyer', actorEmail: 'buyer@minera.cl' }
        );
        const storedExp = getCollectionMap(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).get(expenseReport.reportId)!;
        assert.ok(typeof storedExp.retentionUntil === 'string');
        const expRetYear = new Date(storedExp.retentionUntil).getUTCFullYear();
        assert.ok(expRetYear >= new Date().getUTCFullYear() + 6);

        // Ephemeral TTL (24h sessions / 7d wamids)
        const beforeMs = Date.now();
        await SupplyRepository.saveWhatsAppSession('wasess_test_1', { tenantId: 'tenant-p', memberUid: 'uid-op1' });
        await SupplyRepository.recordWhatsAppWamid('wamid_test_1', { wamid: 'wamid.1', tenantId: 'tenant-p' });
        const sessDoc = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).get('wasess_test_1')!;
        const wamidDoc = getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).get('wamid_test_1')!;
        const sessTtlMs = sessDoc.ttlExpiresAt.toMillis();
        const wamidTtlMs = wamidDoc.ttlExpiresAt.toMillis();
        assert.ok(sessTtlMs - beforeMs >= 23.5 * 3600_000 && sessTtlMs - beforeMs <= 24.5 * 3600_000);
        assert.ok(wamidTtlMs - beforeMs >= 6.9 * 86400_000 && wamidTtlMs - beforeMs <= 7.1 * 86400_000);
    }

    // -----------------------------------------------------------------------
    // 5. ARCO-P: DELETE /api/staff/members/:memberUid & admin purgeTenant
    // -----------------------------------------------------------------------
    console.log('5) Testing ARCO-P member removal (staff.controller) & full tenant purge (admin.controller)...');
    {
        resetStores();

        const tenantId = 'tenant-arco';
        const ownerUid = 'uid-owner-arco';
        const exWorkerUid = 'uid-ex-worker';
        const stayWorkerUid = 'uid-stay-worker';
        const exEmail = 'ex.trabajador@mineraarco.cl';
        const exPhone = '+56977771234';

        await mockDb.collection('accounts').doc(tenantId).set({
            id: tenantId,
            name: 'Minera ARCO SpA',
            ownerId: ownerUid,
            countryCode: 'CL',
            status: 'ACTIVE',
        });
        await mockDb.collection('accounts').doc(tenantId).collection('members').doc(exWorkerUid).set({
            uid: exWorkerUid,
            userId: exWorkerUid,
            email: exEmail,
            fullName: 'Juan Ex-Trabajador',
            phoneE164: exPhone,
            role: 'OPERATOR',
            status: 'ACTIVE',
        });
        await mockDb.collection('users').doc(exWorkerUid).set({
            uid: exWorkerUid,
            email: exEmail,
            phoneE164: exPhone,
            memberships: [{ accountId: tenantId, role: 'OPERATOR', status: 'ACTIVE' }],
        });

        await mockDb.collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).doc('sess-ex').set({
            sessionId: 'sess-ex',
            tenantId,
            memberUid: exWorkerUid,
            phoneE164: exPhone,
            fsmState: 'SLOT_FILLING',
        });
        await mockDb.collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).doc('sess-stay').set({
            sessionId: 'sess-stay',
            tenantId,
            memberUid: stayWorkerUid,
            phoneE164: '+56977779999',
            fsmState: 'COLLECTING',
        });

        await mockDb.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc('req-ex-1').set({
            reqId: 'req-ex-1',
            tenantId,
            siteId: 'site-arco',
            requesterUid: exWorkerUid,
            requesterName: 'Juan Ex-Trabajador',
            requesterPhoneE164: '+569****1234',
            requesterPhoneMasked: '+569****1234',
            requesterPhoneHash: hashPhoneE164(exPhone),
            status: 'OPEN',
            lines: [{ lineId: 'l1', itemName: 'Papas', qtyRequested: 20 }],
            createdAt: '2026-11-20T10:00:00.000Z',
            updatedAt: '2026-11-20T10:00:00.000Z',
        });

        await mockDb.collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).doc('expr-ex-1').set({
            reportId: 'expr-ex-1',
            tenantId,
            siteId: 'site-arco',
            custodianUid: exWorkerUid,
            custodianName: 'Juan Ex-Trabajador',
            renderedTotalClp: 119000,
            siiDocumentIds: ['doc-1'],
            retentionUntil: '2032-11-20T00:00:00.000Z',
            status: 'SUBMITTED',
        });

        mockTokens.set('tok-owner-arco', {
            uid: ownerUid,
            email: 'owner@mineraarco.cl',
            email_verified: true,
            role: 'OWNER',
        });

        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/staff', staffRouter);
        const dispatchStaff = createInProcessDispatcher(staffApp);

        const delRes = await dispatchStaff('DELETE', `/api/staff/members/${exWorkerUid}`, {
            headers: { Authorization: 'Bearer tok-owner-arco' },
            body: { accountId: tenantId, confirmationKeyword: 'ACTUALIZAR' },
        });
        assert.equal(delRes.status, 200);
        const delJson = await delRes.json();
        assert.equal(delJson.success, true);
        assert.equal(delJson.arcoCleanup.purgedWhatsappSessions, 1);
        assert.equal(delJson.arcoCleanup.anonymizedRequisitions, 1);
        assert.equal(delJson.arcoCleanup.anonymizedExpenseReports, 1);

        // Ex-worker session deleted, stay-worker session untouched
        assert.equal(getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).has('sess-ex'), false);
        assert.equal(getCollectionMap(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).has('sess-stay'), true);

        // Requisition anonymized while preserving operational lines
        const anonReq = getCollectionMap(SUPPLY_COLLECTIONS.REQUISITIONS).get('req-ex-1')!;
        assert.equal(anonReq.requesterName, '[ANONIMIZADO_ARCO_P]');
        assert.equal(anonReq.requesterPhoneE164, null);
        assert.equal(anonReq.requesterPhoneMasked, null);
        assert.equal(anonReq.requesterPhoneHash, null);
        assert.equal(anonReq.lines.length, 1);

        // Expense report anonymized while preserving fiscal figures & retention
        const anonExp = getCollectionMap(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).get('expr-ex-1')!;
        assert.equal(anonExp.custodianName, '[ANONIMIZADO_ARCO_P]');
        assert.equal(anonExp.renderedTotalClp, 119000);
        assert.equal(anonExp.retentionUntil, '2032-11-20T00:00:00.000Z');

        // AuditLedger must NOT contain plaintext email in details
        const ledgerEntries = Array.from(getCollectionMap('audit_ledger').values());
        const removalEntry = ledgerEntries.find((e) => e.action === 'B2B_TEAM_MEMBER_REMOVED');
        assert.ok(removalEntry);
        assert.ok(!JSON.stringify(removalEntry.details).includes(exEmail));
        assert.equal(removalEntry.details.removedEmailMasked, maskEmailForLog(exEmail));
        assert.equal(
            removalEntry.details.removedEmailHash,
            crypto.createHash('sha256').update(exEmail).digest('hex')
        );

        // 5b. purgeTenant: reject protected accounts + purge all 16 supply_* + lines + media_registry + Storage blobs
        const adminApp = express();
        adminApp.use(express.json());
        adminApp.delete('/api/admin/tenants/:uid/purge', (req: any, res) => {
            req.user = { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN' };
            return purgeTenant(req, res);
        });
        const dispatchAdmin = createInProcessDispatcher(adminApp);

        for (const protectedId of ['dev-master-root-uid', 'super-admin-uid', 'dev-master-sandbox']) {
            const protRes = await dispatchAdmin('DELETE', `/api/admin/tenants/${protectedId}/purge`, {
                body: { reason: 'Attempted accidental purge' },
            });
            assert.equal(protRes.status, 403, `Protected account ${protectedId} must NEVER be purgeable`);
        }

        const purgeId = 'tenant-purge-me';
        const keepId = 'tenant-keep-safe';
        const allSupplyCols = [
            'supply_sites',
            'supply_warehouses',
            'supply_inventory_items',
            'supply_requisitions',
            'supply_purchases',
            'supply_sii_documents',
            'supply_expense_reports',
            'supply_cash_ledger',
            'supply_stock_ledger',
            'supply_assets',
            'supply_fulfillment_allocations',
            'supply_forecast_snapshots',
            'supply_demand_forecasts',
            'supply_whatsapp_sessions',
            'supply_whatsapp_wamids',
            'supply_policy_audit',
            'tenant_suppliers',
        ];

        await mockDb.collection('tenants').doc(purgeId).set({ id: purgeId, status: 'DELETED' });
        await mockDb.collection('accounts').doc(purgeId).set({ id: purgeId, status: 'DELETED' });

        for (const col of allSupplyCols) {
            await mockDb.collection(col).doc(`doc_${purgeId}`).set({ tenantId: purgeId, col });
            await mockDb.collection(col).doc(`doc_${keepId}`).set({ tenantId: keepId, col });
        }
        // Subcollection `lines` under supply_requisitions/{id}/lines
        await mockDb
            .collection('supply_requisitions')
            .doc(`doc_${purgeId}`)
            .collection('lines')
            .doc('line-1')
            .set({ lineId: 'line-1', itemName: 'Papas' });

        await mockDb.collection('media_registry').doc(`tenant_${purgeId}_sha1`).set({
            sha256: 'a'.repeat(64),
            scope: 'TENANT_PRIVATE',
            tenantId: purgeId,
        });
        await mockDb.collection('media_registry').doc(`legacy_${purgeId}_sha2`).set({
            sha256: 'b'.repeat(64),
            scope: 'TENANT_PRIVATE',
            tenant_id: purgeId,
        });
        await mockDb.collection('media_registry').doc(`tenant_${keepId}_sha3`).set({
            sha256: 'c'.repeat(64),
            scope: 'TENANT_PRIVATE',
            tenantId: keepId,
        });

        storageBlobs.set(`cas_blobs/tenants/${purgeId}/${'a'.repeat(64)}.webp`, {
            buffer: Buffer.from('img-purge'),
            contentType: 'image/webp',
            cacheControl: 'private',
        });
        storageBlobs.set(`cas_blobs/tenants/${keepId}/${'c'.repeat(64)}.webp`, {
            buffer: Buffer.from('img-keep'),
            contentType: 'image/webp',
            cacheControl: 'private',
        });

        const purgeRes = await dispatchAdmin('DELETE', `/api/admin/tenants/${purgeId}/purge`, {
            body: { reason: 'Solicitud ARCO-P Supresión Definitiva' },
        });
        assert.equal(purgeRes.status, 200);
        const purgeJson = await purgeRes.json();
        assert.equal(purgeJson.success, true);
        assert.equal(purgeJson.arcoPurge.purgedSupplyDocs, allSupplyCols.length + 1); // 17 docs + 1 subcollection line
        assert.equal(purgeJson.arcoPurge.purgedMediaRegistryDocs, 2);
        assert.equal(purgeJson.arcoPurge.purgedStorageBlobs, 1);

        // Verify ZERO remaining supply_* / lines / media_registry / Storage blobs for purgeId, while keepId is 100% intact
        for (const col of allSupplyCols) {
            assert.equal(getCollectionMap(col).has(`doc_${purgeId}`), false, `${col} must be purged for ${purgeId}`);
            assert.equal(getCollectionMap(col).has(`doc_${keepId}`), true, `${col} must remain intact for ${keepId}`);
        }
        assert.equal(
            getSubcollectionMap(`supply_requisitions/doc_${purgeId}/lines`).size,
            0,
            'supply_requisitions/{id}/lines subcollection must be purged'
        );
        assert.equal(getCollectionMap('media_registry').has(`tenant_${purgeId}_sha1`), false);
        assert.equal(getCollectionMap('media_registry').has(`legacy_${purgeId}_sha2`), false);
        assert.equal(getCollectionMap('media_registry').has(`tenant_${keepId}_sha3`), true);
        assert.equal(storageBlobs.has(`cas_blobs/tenants/${purgeId}/${'a'.repeat(64)}.webp`), false);
        assert.equal(storageBlobs.has(`cas_blobs/tenants/${keepId}/${'c'.repeat(64)}.webp`), true);
    }

    console.log('\n✅ ALL E03 PRIVACY, CDPA, MULTIMODAL CACHE, CAS XML/dHash & ARCO-P TESTS PASSED (5/5)!');
}

runTests().catch((err) => {
    console.error('\n❌ E03 PRIVACY TEST SUITE FAILED:', err);
    process.exit(1);
});
