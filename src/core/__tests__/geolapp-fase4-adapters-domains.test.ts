/**
 * Suite Determinista Fase 4 + STOCKPILE CONTROL Next-Gen GEOLAPP® (MINREPORT)
 * Verifica:
 * 1. Adaptadores de superficie & GNSS RTK NMEA (`UavPointCloudAdapter`, `MobileLidarAdapter`, `GnssRtkNmeaAdapter`),
 *    generación glTF 2.0 `.glb` desde nube de puntos (`buildPointCloudHeightfieldGlbMesh`) y digestión CAS `MESH_3D_GLB`.
 * 2. Cadena determinista de historial Next-Gen (`computeStockpileMeasurementChain`) y Certificado Vectorial PDF (`generateGeolappVectorPdf`).
 * 3. Contratos backend Next-Gen (`/api/geolapp/stockpiles/:id/hitl-update` incluyendo cierre `SHIPPED`, reapertura y bloqueo IMSBC 422),
 *    servicio server-side `generateAndStoreStaticSatelliteMap`, M2M x402 `/api/m2m/geolapp/stockpiles`, poda de rutas heredadas y `firestore.rules`.
 * 4. Anti-regresión de poda, guardrails `GEMINI.md §4`, paridad i18n (`es`/`en`/`pt`), aislamiento de portales y cero dependencias iOS.
 */

import assert from 'node:assert/strict';
import crypto, { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import Module from 'node:module';
import express from 'express';
import ts from 'typescript';

process.env.NODE_ENV = 'test';
process.env.ALLOW_TEST_X402_HMAC = 'true';
process.env.X402_HMAC_SECRET = process.env.X402_HMAC_SECRET || 'fase4-test-x402-hmac-secret-32chars';

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
    });
}

const ROOT_DIR = path.resolve(__dirname, '../../..');
const WEB_SRC = path.join(ROOT_DIR, 'web/src');

// ============================================================================
// 1. TRANSPILADOR EN MEMORIA TS->CJS PARA MÓDULOS WEB + STUBS SANDBOX-SAFE
// ============================================================================

const webModuleCache = new Map<string, any>();

function resolveTsFile(candidate: string): string | null {
    const attempts = [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        path.join(candidate, 'index.ts'),
        path.join(candidate, 'index.tsx'),
    ];
    for (const filePath of attempts) {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return filePath;
        }
    }
    return null;
}

function loadWebModule(tsFilePath: string): any {
    const normalizedPath = path.normalize(tsFilePath);
    if (webModuleCache.has(normalizedPath)) {
        return webModuleCache.get(normalizedPath);
    }

    const rawSource = fs.readFileSync(normalizedPath, 'utf8');
    // Reemplaza import.meta.url, import.meta.env y cualquier import.meta residual para CJS
    const source = rawSource
        .replace(/import\.meta\.url/g, `'file://${normalizedPath}'`)
        .replace(/import\.meta\.env/g, `({} as Record<string, any>)`)
        .replace(/\bimport\.meta\b/g, `({ url: 'file://${normalizedPath}', env: {} })`);
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            jsx: ts.JsxEmit.ReactJSX,
        },
        fileName: normalizedPath,
    });
    const cjsOutput = transpiled.outputText
        .replace(/import\.meta\.url/g, `'file://${normalizedPath}'`)
        .replace(/import\.meta\.env/g, `({})`)
        .replace(/\bimport\.meta\b/g, `({ url: '', env: {} })`);

    const mod: { exports: Record<string, any> } = { exports: {} };
    webModuleCache.set(normalizedPath, mod.exports);

    const localDir = path.dirname(normalizedPath);
    const customRequire = (request: string): any => {
        if (request === '@capacitor/core') {
            return { Capacitor: { isNativePlatform: () => false } };
        }
        if (request === '@capacitor/filesystem') {
            return { Filesystem: {}, Directory: {} };
        }
        if (request === '@capacitor/share') {
            return { Share: {} };
        }
        if (request.startsWith('.')) {
            const targetNorm = path.normalize(path.resolve(localDir, request));
            if (targetNorm.endsWith('config/firebase')) {
                return { auth: { currentUser: null }, db: {}, storage: {} };
            }
            if (targetNorm.endsWith('offline/OfflineStorage')) {
                return { offlineStorage: {} };
            }
            if (targetNorm.endsWith('services/StorageService')) {
                return {
                    resolveStockpileImageUrl: async (u?: string) => u || null,
                };
            }
            const resolved = resolveTsFile(targetNorm);
            if (resolved) {
                return loadWebModule(resolved);
            }
        }
        return require(request);
    };

    const wrapper = new Function('require', 'module', 'exports', '__filename', '__dirname', cjsOutput);
    wrapper(customRequire, mod, mod.exports, normalizedPath, localDir);
    webModuleCache.set(normalizedPath, mod.exports);
    return mod.exports;
}

// ============================================================================
// 2. HELPERS BINARIOS (GLB, LAS 1.2, NMEA CHECKSUM) & FIRESTORE EN MEMORIA
// ============================================================================

function assertValidGlbChunks(buf: Buffer | Uint8Array | ArrayBuffer, contextLabel: string): {
    totalLength: number;
    jsonText: string;
    jsonObj: Record<string, any>;
    binLength: number;
} {
    const buffer =
        buf instanceof Buffer
            ? buf
            : buf instanceof ArrayBuffer
                ? Buffer.from(buf)
                : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);

    assert.ok(buffer.length >= 28, `${contextLabel}: .glb demasiado corto (${buffer.length} bytes)`);
    assert.equal(buffer.readUInt32LE(0), 0x46546c67, `${contextLabel}: magic glTF inválido`);
    assert.equal(buffer.readUInt32LE(4), 2, `${contextLabel}: versión glTF debe ser 2`);
    const totalLength = buffer.readUInt32LE(8);
    assert.equal(totalLength, buffer.length, `${contextLabel}: header length no coincide`);

    const jsonChunkLen = buffer.readUInt32LE(12);
    assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, `${contextLabel}: primer chunk debe ser JSON`);
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonChunkLen;
    assert.ok(jsonEnd <= buffer.length, `${contextLabel}: JSON chunk fuera de límites`);
    const jsonText = buffer.subarray(jsonStart, jsonEnd).toString('utf8').trim();
    const jsonObj = JSON.parse(jsonText);
    assert.equal(jsonObj.asset?.version, '2.0', `${contextLabel}: asset.version glTF 2.0 requerido`);

    assert.ok(jsonEnd + 8 <= buffer.length, `${contextLabel}: falta BIN chunk`);
    const binChunkLen = buffer.readUInt32LE(jsonEnd);
    assert.equal(buffer.readUInt32LE(jsonEnd + 4), 0x004e4942, `${contextLabel}: segundo chunk debe ser BIN`);
    assert.equal(jsonEnd + 8 + binChunkLen, buffer.length, `${contextLabel}: BIN chunk desalineado`);

    return { totalLength, jsonText, jsonObj, binLength: binChunkLen };
}

function buildSyntheticLas12Buffer(points: Array<{ x: number; y: number; z: number }>): ArrayBuffer {
    const headerSize = 227;
    const recordLength = 20;
    const totalBytes = headerSize + points.length * recordLength;
    const buf = Buffer.alloc(totalBytes);

    buf.write('LASF', 0, 4, 'ascii');
    buf.writeUInt8(1, 24); // Version Major
    buf.writeUInt8(2, 25); // Version Minor
    buf.writeUInt16LE(headerSize, 94);
    buf.writeUInt32LE(headerSize, 96); // Offset to point data
    buf.writeUInt8(0, 104); // Point Data Record Format 0
    buf.writeUInt16LE(recordLength, 105);
    buf.writeUInt32LE(points.length, 107);

    const scale = 0.01;
    buf.writeDoubleLE(scale, 131); // X scale
    buf.writeDoubleLE(scale, 139); // Y scale
    buf.writeDoubleLE(scale, 147); // Z scale
    buf.writeDoubleLE(0, 155); // X offset
    buf.writeDoubleLE(0, 163); // Y offset
    buf.writeDoubleLE(0, 171); // Z offset

    for (let i = 0; i < points.length; i++) {
        const offset = headerSize + i * recordLength;
        buf.writeInt32LE(Math.round(points[i].x / scale), offset);
        buf.writeInt32LE(Math.round(points[i].y / scale), offset + 4);
        buf.writeInt32LE(Math.round(points[i].z / scale), offset + 8);
    }

    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function withNmeaChecksum(sentenceWithoutChecksum: string): string {
    const body = sentenceWithoutChecksum.startsWith('$')
        ? sentenceWithoutChecksum.slice(1)
        : sentenceWithoutChecksum;
    let xor = 0;
    for (let i = 0; i < body.length; i++) {
        xor ^= body.charCodeAt(i);
    }
    return `$${body}*${xor.toString(16).toUpperCase().padStart(2, '0')}`;
}

interface MockStore {
    collections: Map<string, Map<string, Record<string, any>>>;
}

function createInMemoryFirestoreAndAuth(): {
    store: MockStore;
    firebaseMock: Record<string, any>;
    seedDoc: (collectionName: string, docId: string, data: Record<string, any>) => void;
} {
    const store: MockStore = { collections: new Map() };
    let autoIdSeq = 1;

    const getCollectionMap = (colPath: string): Map<string, Record<string, any>> => {
        if (!store.collections.has(colPath)) {
            store.collections.set(colPath, new Map());
        }
        return store.collections.get(colPath)!;
    };

    const buildQuery = (
        colPath: string,
        filters: Array<{ field: string; op: string; value: any }> = [],
        maxLimit?: number
    ): any => ({
        where(field: string, op: string, value: any) {
            return buildQuery(colPath, [...filters, { field, op, value }], maxLimit);
        },
        limit(n: number) {
            return buildQuery(colPath, filters, n);
        },
        orderBy() {
            return buildQuery(colPath, filters, maxLimit);
        },
        async get() {
            const colMap = getCollectionMap(colPath);
            const docs: any[] = [];
            for (const [id, rawData] of colMap.entries()) {
                let match = true;
                for (const f of filters) {
                    if (f.op === '==' && rawData[f.field] !== f.value) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    docs.push({
                        id,
                        exists: true,
                        data: () => ({ ...rawData }),
                    });
                }
            }
            const sliced = typeof maxLimit === 'number' ? docs.slice(0, maxLimit) : docs;
            return {
                empty: sliced.length === 0,
                size: sliced.length,
                docs: sliced,
            };
        },
    });

    const buildCollectionRef = (colPath: string): any => {
        const baseQuery = buildQuery(colPath);
        return {
            ...baseQuery,
            doc(docId?: string) {
                const resolvedId = docId || `auto-doc-${autoIdSeq++}`;
                return {
                    id: resolvedId,
                    path: `${colPath}/${resolvedId}`,
                    _colPath: colPath,
                    collection(subCol: string) {
                        return buildCollectionRef(`${colPath}/${resolvedId}/${subCol}`);
                    },
                    async get() {
                        const colMap = getCollectionMap(colPath);
                        const existing = colMap.get(resolvedId);
                        return {
                            id: resolvedId,
                            exists: existing !== undefined,
                            data: () => (existing ? { ...existing } : undefined),
                        };
                    },
                    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
                        const colMap = getCollectionMap(colPath);
                        const prev = opts?.merge ? colMap.get(resolvedId) || {} : {};
                        colMap.set(resolvedId, { ...prev, ...data });
                    },
                    async update(data: Record<string, any>) {
                        const colMap = getCollectionMap(colPath);
                        const prev = colMap.get(resolvedId) || {};
                        colMap.set(resolvedId, { ...prev, ...data });
                    },
                };
            },
        };
    };

    const db: any = {
        settings: () => undefined,
        collection: (name: string) => buildCollectionRef(name),
        async runTransaction(fn: (tx: any) => Promise<any>) {
            const tx = {
                async get(ref: any) {
                    return ref.get();
                },
                set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
                    const colMap = getCollectionMap(ref._colPath);
                    const prev = opts?.merge ? colMap.get(ref.id) || {} : {};
                    colMap.set(ref.id, { ...prev, ...data });
                    return tx;
                },
                update(ref: any, data: Record<string, any>) {
                    const colMap = getCollectionMap(ref._colPath);
                    const prev = colMap.get(ref.id) || {};
                    colMap.set(ref.id, { ...prev, ...data });
                    return tx;
                },
            };
            return fn(tx);
        },
        batch() {
            const ops: Array<() => void> = [];
            return {
                set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
                    ops.push(() => {
                        const colMap = getCollectionMap(ref._colPath);
                        const prev = opts?.merge ? colMap.get(ref.id) || {} : {};
                        colMap.set(ref.id, { ...prev, ...data });
                    });
                },
                async commit() {
                    ops.forEach((op) => op());
                },
            };
        },
    };

    const tokens: Record<string, Record<string, any>> = {
        'tok-tenant-a': {
            uid: 'uid-tenant-a',
            email: 'geo.a@tenant-a.cl',
            email_verified: true,
            activeAccountId: 'tenant-a',
            role: 'B2B_ENGINEER',
        },
        'tok-tenant-b': {
            uid: 'uid-tenant-b',
            email: 'geo.b@tenant-b.cl',
            email_verified: true,
            activeAccountId: 'tenant-b',
            role: 'B2B_ENGINEER',
        },
        'tok-admin-1': {
            uid: 'super-admin-uid',
            email: 'admin@minreport.com',
            email_verified: true,
            admin: true,
            role: 'SUPER_ADMIN',
        },
    };

    const auth = {
        async verifyIdToken(token: string) {
            const decoded = tokens[token];
            if (!decoded) {
                throw new Error('INVALID_TEST_TOKEN');
            }
            return decoded;
        },
    };

    const storedBlobs = new Map<string, Buffer>();
    const storageStub = {
        bucket: () => ({
            file: (filePath: string) => ({
                async save(buf: Buffer) {
                    storedBlobs.set(filePath, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
                },
                async exists() {
                    return [storedBlobs.has(filePath)];
                },
            }),
        }),
    };

    const firebaseAdminStub = {
        apps: [{}],
        firestore: Object.assign(() => db, {
            FieldValue: {
                increment: (n: number) => n,
                serverTimestamp: () => new Date().toISOString(),
            },
            Timestamp: {
                now: () => ({ toMillis: () => Date.now() }),
                fromMillis: (ms: number) => ({ toMillis: () => ms }),
            },
        }),
        auth: () => auth,
        storage: () => storageStub,
        messaging: () => ({}),
    };

    const firebaseMock = {
        __esModule: true,
        db,
        auth,
        firestore: firebaseAdminStub.firestore,
        storage: storageStub,
        messaging: firebaseAdminStub.messaging(),
        default: firebaseAdminStub,
    };

    const seedDoc = (collectionName: string, docId: string, data: Record<string, any>) => {
        getCollectionMap(collectionName).set(docId, { ...data });
    };

    return { store, firebaseMock, seedDoc };
}

/**
 * Invoca una instancia Express en memoria sin abrir puertos TCP ni sockets externos (100% sandbox-safe).
 */
async function dispatchExpressInMemory(
    app: express.Express,
    options: {
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: unknown;
    }
): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
    rawText: string;
}> {
    return new Promise((resolve, reject) => {
        const reqSocket = new PassThrough() as any;
        reqSocket.remoteAddress = '127.0.0.1';
        reqSocket.encrypted = false;

        const req = new http.IncomingMessage(reqSocket);
        req.method = options.method.toUpperCase();
        req.url = options.path;
        const normalizedHeaders: Record<string, string> = { host: 'localhost' };
        if (options.headers) {
            for (const [k, v] of Object.entries(options.headers)) {
                normalizedHeaders[k.toLowerCase()] = v;
            }
        }

        const rawPayload =
            options.body !== undefined ? Buffer.from(JSON.stringify(options.body), 'utf8') : null;
        if (rawPayload) {
            normalizedHeaders['content-type'] = 'application/json';
            normalizedHeaders['content-length'] = String(rawPayload.length);
        }
        req.headers = normalizedHeaders;

        const resSink = new PassThrough();
        const chunks: Buffer[] = [];
        resSink.on('data', (chunk: Buffer) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        const res = new http.ServerResponse(req);
        res.sendDate = false;
        res.assignSocket(resSink as any);

        res.on('finish', () => {
            const fullRaw = Buffer.concat(chunks);
            const headerSepIdx = fullRaw.indexOf('\r\n\r\n');
            const bodyBuf = headerSepIdx >= 0 ? fullRaw.subarray(headerSepIdx + 4) : fullRaw;
            const rawText = bodyBuf.toString('utf8');

            const outHeaders: Record<string, string> = {};
            const rawHeaders = res.getHeaders();
            for (const [key, val] of Object.entries(rawHeaders)) {
                if (val !== undefined) {
                    outHeaders[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : String(val);
                }
            }

            let parsedBody: any = rawText;
            try {
                parsedBody = rawText ? JSON.parse(rawText) : null;
            } catch {
                // Mantener texto crudo si no es JSON
            }

            resolve({
                status: res.statusCode,
                headers: outHeaders,
                body: parsedBody,
                rawText,
            });
        });

        res.on('error', reject);
        (app as any)(req, res, (err: any) => {
            if (err) {
                reject(err);
                return;
            }
            if (!res.writableEnded) {
                res.statusCode = 404;
                res.end();
            }
        });

        if (rawPayload) {
            req.push(rawPayload);
        }
        req.push(null);
    });
}

// ============================================================================
// 3. EJECUCIÓN DE CASOS DETERMINISTAS FASE 4
// ============================================================================

async function run() {
    let passedCases = 0;

    // ------------------------------------------------------------------------
    // CASO 1: Adaptadores de Superficie (UAV .xyz/.csv/.las, LiDAR .ply/.glb),
    //         GNSS RTK NMEA-0183 GGA/RMC, GLB Heightfield y CAS MESH_3D_GLB
    // ------------------------------------------------------------------------
    const { uavPointCloudAdapter } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/adapters/UavPointCloudAdapter.ts')
    );
    const { mobileLidarAdapter } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/adapters/MobileLidarAdapter.ts')
    );
    const {
        gnssRtkNmeaAdapter,
        parseNmeaSentence,
        parseNmeaStream,
    } = loadWebModule(path.join(WEB_SRC, 'modules/geolapp/core/adapters/GnssRtkNmeaAdapter.ts'));
    const { buildPointCloudHeightfieldGlbMesh } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/utils/glbMeshBuilder.ts')
    );
    const { mediaDigestorClient } = loadWebModule(
        path.join(WEB_SRC, 'core/media/MediaDigestorClient.ts')
    );

    assert.equal(uavPointCloudAdapter.canHandle('levantamiento_dron.las'), true);
    assert.equal(uavPointCloudAdapter.canHandle('superficie.xyz'), true);
    assert.equal(uavPointCloudAdapter.canHandle('puntos.csv'), true);
    assert.equal(uavPointCloudAdapter.canHandle('comprimido.laz'), false);

    const moundPoints = [
        { x: 500000, y: 7300000, z: 3100.0 },
        { x: 500005, y: 7300000, z: 3101.2 },
        { x: 500010, y: 7300000, z: 3100.0 },
        { x: 500000, y: 7300005, z: 3101.0 },
        { x: 500005, y: 7300005, z: 3104.5 },
        { x: 500010, y: 7300005, z: 3101.0 },
        { x: 500000, y: 7300010, z: 3100.0 },
        { x: 500005, y: 7300010, z: 3101.1 },
        { x: 500010, y: 7300010, z: 3100.0 },
    ];

    const xyzPayload = moundPoints.map((p) => `${p.x} ${p.y} ${p.z}`).join('\n');
    const xyzSummary = await uavPointCloudAdapter.parse(xyzPayload, {
        filename: 'pila_norte.xyz',
        gridSize: 8,
    });
    assert.equal(xyzSummary.sourceKind, 'UAV_PHOTOGRAMMETRY');
    assert.equal(xyzSummary.pointCount, 9);
    assert.ok(xyzSummary.tinVolumeM3 > 0, 'Volumen TIN .xyz debe ser > 0');
    assertValidGlbChunks(xyzSummary.glbBuffer, 'UavPointCloudAdapter/.xyz');

    const csvPayload = ['X,Y,Z', ...moundPoints.map((p) => `${p.x},${p.y},${p.z}`)].join('\n');
    const csvSummary = await uavPointCloudAdapter.parse(csvPayload, {
        filename: 'pila_norte.csv',
        gridSize: 8,
    });
    assert.equal(csvSummary.pointCount, 9);
    assert.ok(Math.abs(csvSummary.tinVolumeM3 - xyzSummary.tinVolumeM3) < 0.01);

    const lasBuffer = buildSyntheticLas12Buffer(moundPoints);
    const lasSummary = await uavPointCloudAdapter.parse(lasBuffer, {
        filename: 'vuelo_dji_m300.las',
        gridSize: 8,
    });
    assert.equal(lasSummary.pointCount, 9);
    assert.ok(lasSummary.tinVolumeM3 > 0, 'Volumen TIN .las binario debe ser > 0');
    assertValidGlbChunks(lasSummary.glbBuffer, 'UavPointCloudAdapter/.las');

    await assert.rejects(
        () => uavPointCloudAdapter.parse(new ArrayBuffer(16), { filename: 'vuelo.laz' }),
        /LAZ/i
    );

    assert.equal(mobileLidarAdapter.canHandle('iphone_lidar.ply'), true);
    assert.equal(mobileLidarAdapter.canHandle('escaneo.glb'), true);

    const plyAscii = [
        'ply',
        'format ascii 1.0',
        `element vertex ${moundPoints.length}`,
        'property float x',
        'property float y',
        'property float z',
        'end_header',
        ...moundPoints.map((p) => `${p.x - 500000} ${p.y - 7300000} ${p.z - 3100}`),
    ].join('\n');

    const plySummary = await mobileLidarAdapter.parse(plyAscii, {
        filename: 'talud_frente_1.ply',
        gridSize: 8,
    });
    assert.equal(plySummary.sourceKind, 'MOBILE_LIDAR');
    assert.equal(plySummary.pointCount, 9);
    assert.ok(plySummary.tinVolumeM3 > 0, 'Volumen .ply ASCII debe ser > 0');
    assertValidGlbChunks(plySummary.glbBuffer, 'MobileLidarAdapter/.ply');

    const directGlb = buildPointCloudHeightfieldGlbMesh(moundPoints, {
        gridSize: 8,
        name: 'heightfield-fase4',
    });
    assert.ok(directGlb !== null, 'buildPointCloudHeightfieldGlbMesh debe generar GLB');
    const directGlbParsed = assertValidGlbChunks(directGlb.glbBuffer, 'buildPointCloudHeightfieldGlbMesh');
    assert.ok(directGlbParsed.jsonObj.accessors?.[0]?.count > 0);
    assert.ok(directGlb.tinVolumeM3 > 0);

    const glbRoundTrip = await mobileLidarAdapter.parse(directGlb.glbBuffer, {
        filename: 'heightfield-fase4.glb',
    });
    assert.equal(glbRoundTrip.sourceKind, 'MOBILE_LIDAR');
    assert.ok(glbRoundTrip.pointCount > 0, 'MobileLidarAdapter debe inspeccionar vértices glTF .glb');
    assertValidGlbChunks(glbRoundTrip.glbBuffer, 'MobileLidarAdapter/.glb');

    const glbBlob = new Blob([directGlb.glbBuffer], { type: 'model/gltf-binary' });
    const digestedGlb = await mediaDigestorClient.digestGlb(glbBlob);
    const expectedSha256 = crypto
        .createHash('sha256')
        .update(Buffer.from(directGlb.glbBuffer))
        .digest('hex');
    assert.equal(digestedGlb.profile, 'MESH_3D_GLB');
    assert.equal(digestedGlb.extension, 'glb');
    assert.equal(digestedGlb.mimeType, 'model/gltf-binary');
    assert.equal(digestedGlb.sha256, expectedSha256);
    assert.equal(digestedGlb.originalBytes, directGlb.glbBuffer.byteLength);
    assert.equal(digestedGlb.optimizedBytes, directGlb.glbBuffer.byteLength);

    await assert.rejects(
        () => mediaDigestorClient.digestGlb(new Blob([Buffer.from('CORRUPT_BIN_GLB_DATA')])),
        /glb|glTF|invalido|inválido/i
    );

    // GNSS RTK NMEA-0183 GGA / RMC
    const ggaFixedLine = withNmeaChecksum(
        '$GNGGA,183045.00,2416.2000,S,06904.2000,W,4,16,0.7,3120.5,M,15.2,M,,'
    );
    const rmcLine = withNmeaChecksum(
        '$GPRMC,183046.00,A,2416.2000,S,06904.2000,W,0.02,0.0,151126,0.0,W,D'
    );
    const ggaSpsLine = withNmeaChecksum(
        '$GPGGA,183040.00,2416.2000,S,06904.2000,W,1,7,2.4,3119.0,M,15.2,M,,'
    );
    const badChecksumLine = '$GNGGA,183045.00,2416.2000,S,06904.2000,W,4,16,0.7,3120.5,M,15.2,M,,*FF';

    const ggaFix = parseNmeaSentence(ggaFixedLine);
    assert.ok(ggaFix !== null, 'GGA RTK_FIXED debe parsearse');
    assert.equal(ggaFix.sentenceType, 'GGA');
    assert.equal(ggaFix.fixQuality, 'RTK_FIXED');
    assert.equal(ggaFix.utmZone, 19);
    assert.equal(ggaFix.utmBand, 'J');
    assert.equal(ggaFix.epsg, 32719);
    assert.equal(ggaFix.orthometricAltitudeM, 3120.5);
    assert.equal(ggaFix.satellitesUsed, 16);
    assert.equal(ggaFix.hdop, 0.7);
    assert.ok(Math.abs(ggaFix.latitude - -24.27) < 0.001);
    assert.ok(Math.abs(ggaFix.longitude - -69.07) < 0.001);

    const rmcFix = parseNmeaSentence(rmcLine);
    assert.ok(rmcFix !== null, 'RMC activo debe parsearse');
    assert.equal(rmcFix.sentenceType, 'RMC');
    assert.equal(rmcFix.epsg, 32719);
    assert.equal(rmcFix.utmZone, 19);

    assert.equal(parseNmeaSentence(badChecksumLine), null, 'Checksum NMEA corrupto debe rechazarse');

    const nmeaStream = [ggaSpsLine, rmcLine, ggaFixedLine, badChecksumLine].join('\n');
    const streamRes = parseNmeaStream(nmeaStream);
    assert.equal(streamRes.fixes.length, 3);
    assert.equal(streamRes.rejectedCount, 1);
    assert.equal(streamRes.bestFix?.fixQuality, 'RTK_FIXED');

    const adapterFixes = await gnssRtkNmeaAdapter.parse(nmeaStream);
    assert.equal(adapterFixes.length, 3);

    passedCases++;
    console.log('PASS [1/4] Adaptadores UAV/LiDAR, GNSS RTK NMEA GGA/RMC, GLB Heightfield y CAS MESH_3D_GLB');

    // ------------------------------------------------------------------------
    // CASO 2: Cadena Determinista de Historial Next-Gen y PDF Vectorial
    // ------------------------------------------------------------------------
    const { computeStockpileMeasurementChain } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/services/calculation-engine.ts')
    );
    const { generateGeolappVectorPdf } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/utils/vectorPdfGenerator.ts')
    );

    const t0 = Date.UTC(2026, 10, 1, 10, 0, 0);
    const t1 = Date.UTC(2026, 10, 5, 14, 0, 0);
    const t2 = Date.UTC(2026, 10, 10, 18, 0, 0);

    const chainRes = computeStockpileMeasurementChain(
        [
            {
                id: 'm-1',
                assetId: 'stk-chain-01',
                timestamp: t0,
                volumen_m3: 100,
                peso_t: 220,
                photo_url: '/api/media/blob/tenant/tenant-a/photo-1.webp',
                method: 'manual',
            },
            {
                id: 'm-2',
                assetId: 'stk-chain-01',
                timestamp: t1,
                volumen_m3: 150,
                peso_t: 330,
                photo_url: '/api/media/blob/tenant/tenant-a/photo-2.webp',
                method: 'manual',
            },
            {
                id: 'm-3',
                assetId: 'stk-chain-01',
                timestamp: t2,
                volumen_m3: 0,
                peso_t: 0,
                photo_url: '/api/media/blob/tenant/tenant-a/photo-3.webp',
                method: 'manual',
                is_closure_measurement: true,
                closure_reason: 'ZERO_VOLUME',
            },
        ],
        '/api/media/blob/tenant/tenant-a/photo-init.webp'
    );

    assert.equal(chainRes.enrichedMeasurements.length, 3);
    assert.equal(chainRes.enrichedMeasurements[0].id, 'm-3', 'Debe ordenar descendente por timestamp');
    assert.equal(chainRes.enrichedMeasurements[0].delta_volumen, -150);
    assert.equal(chainRes.enrichedMeasurements[0].delta_volumen_pct, -100);
    assert.equal(
        chainRes.enrichedMeasurements[0].previous_photo_url,
        '/api/media/blob/tenant/tenant-a/photo-2.webp'
    );
    assert.equal(chainRes.enrichedMeasurements[1].delta_volumen, 50);
    assert.equal(chainRes.enrichedMeasurements[1].delta_volumen_pct, 50);
    assert.equal(
        chainRes.enrichedMeasurements[2].previous_photo_url,
        '/api/media/blob/tenant/tenant-a/photo-init.webp',
        'La primera medición hereda initial_photo_url del acopio como foto previa'
    );
    assert.equal(chainRes.enrichedMeasurements[2].delta_volumen, 0);
    assert.equal(chainRes.enrichedMeasurements[2].delta_volumen_pct, null);
    assert.equal(chainRes.summary.lastVolumeM3, 0);
    assert.equal(chainRes.summary.lastDeltaVolumenM3, -150);

    // Recálculo determinista al ignorar medición intermedia m-2
    const recalcIgnored = computeStockpileMeasurementChain(
        chainRes.enrichedMeasurements.map((item: any) =>
            item.id === 'm-2' ? { ...item, ignored: true } : item
        ),
        '/api/media/blob/tenant/tenant-a/photo-init.webp'
    );
    const recalcM3 = recalcIgnored.enrichedMeasurements.find((item: any) => item.id === 'm-3');
    assert.equal(recalcM3.delta_volumen, -100);
    assert.equal(recalcM3.delta_volumen_pct, -100);
    assert.equal(recalcM3.previous_photo_url, '/api/media/blob/tenant/tenant-a/photo-1.webp');

    // PDF Vectorial Next-Gen con PNG embebidos (cover + mapa estático), descripción, cierre y DELTA V
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    const tinyPngBuf: Buffer = await sharp({
        create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 198, g: 131, b: 70 },
        },
    })
        .png()
        .toBuffer();

    const { PDFDocument } = require('pdf-lib');
    const pdfOut = await generateGeolappVectorPdf(
        {
            id: 'stk-pdf-01',
            name: 'PILA_OXIDO_NORTE_01',
            description: 'Acopio de mineral oxidado lixiviable sector frente norte.',
            clase: 'mineral',
            copper_domain: 'OXIDO_CU',
            location_ref: 'CANCHA_OXIDOS_N2',
            status: 'CLOSED',
            closure_reason: 'SHIPPED',
            closed_at: t2,
            dispatch_transport: 'FLOTA TOLVA SUR 07',
            dispatch_destination: 'PLANTA CHANCADO NORTE',
            dispatch_timestamp: t2,
            dispatch_reference: 'BL-NORTE-2026',
            shipped_weight_t: 410,
            pre_closure_volume_m3: 205,
            geo_point: {
                latitude: -24.27,
                longitude: -69.07,
                altitude: 3120,
                accuracy: 2.5,
            },
            createdAt: t0,
            createdBy: 'uid-tenant-a',
            last_volume_m3: 0,
            last_weight_t: 0,
            last_delta_volumen_m3: -150,
            last_delta_volumen_pct: -100,
        },
        chainRes.enrichedMeasurements,
        {
            locale: 'es',
            coverPhotoBytes: new Uint8Array(tinyPngBuf),
            staticMapBytes: new Uint8Array(tinyPngBuf),
        }
    );
    assert.equal(Buffer.from(pdfOut.bytes.slice(0, 5)).toString('ascii'), '%PDF-');
    assert.ok(pdfOut.bytes.byteLength > 2000);
    const parsedPdfDoc = await PDFDocument.load(pdfOut.bytes);
    assert.ok(parsedPdfDoc.getPageCount() >= 1);

    passedCases++;
    console.log('PASS [2/4] Cadena determinista Next-Gen (ΔV + recálculo ignore) y Certificado PDF vectorial');

    // ------------------------------------------------------------------------
    // CASO 3: Backend Next-Gen (HITL Ciclo de Vida + IMSBC 422 + Mapa Estático CAS
    //         + M2M x402 PII Scrub + Poda rutas huérfanas + firestore.rules)
    // ------------------------------------------------------------------------
    const { firebaseMock, seedDoc, store } = createInMemoryFirestoreAndAuth();
    const firebaseConfigPath = require.resolve('../../config/firebase');
    require.cache[firebaseConfigPath] = new Module(firebaseConfigPath, module);
    require.cache[firebaseConfigPath]!.exports = firebaseMock;
    require.cache[firebaseConfigPath]!.loaded = true;

    seedDoc('accounts', 'tenant-a', {
        ownerId: 'uid-tenant-a',
        contract: { status: 'ACTIVE' },
    });
    seedDoc('users', 'uid-tenant-a', {
        activeAccountId: 'tenant-a',
        memberships: [{ accountId: 'tenant-a', status: 'ACTIVE', role: 'ENGINEER' }],
    });
    seedDoc('accounts', 'tenant-b', {
        ownerId: 'uid-tenant-b',
        contract: { status: 'ACTIVE' },
    });
    seedDoc('users', 'uid-tenant-b', {
        activeAccountId: 'tenant-b',
        memberships: [{ accountId: 'tenant-b', status: 'ACTIVE', role: 'ENGINEER' }],
    });

    const geolappControllerMod = await import('../../api/geolapp.controller');
    const geolappRouter = geolappControllerMod.default;
    const { registerM2mGeolappAdapterRoutes } = await import('../../api/m2m-geolapp.adapter');
    const { generateAndStoreStaticSatelliteMap } = await import(
        '../../modules/geolapp/stockpile-static-map.service'
    );

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/geolapp', geolappRouter);
    registerM2mGeolappAdapterRoutes(app);

    const legacyApiPath = ['/api/geolapp/domain', 'records'].join('-');
    const legacyM2mPath = ['/api/m2m/geolapp/domain', 'records'].join('-');

    const prunedGetRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: legacyApiPath,
        headers: { Authorization: 'Bearer tok-tenant-a' },
    });
    assert.equal(prunedGetRes.status, 404, 'Ruta heredada podada GET debe retornar 404');

    const prunedPostRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: legacyApiPath,
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: { id: 'x' },
    });
    assert.equal(prunedPostRes.status, 404, 'Ruta heredada podada POST debe retornar 404');

    const prunedM2mRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: legacyM2mPath,
    });
    assert.equal(prunedM2mRes.status, 404, 'Ruta heredada M2M podada debe retornar 404');

    const nowTs = Date.now();
    seedDoc('stockpiles', 'stk-imsbc-01', {
        id: 'stk-imsbc-01',
        tenantId: 'tenant-a',
        accountId: 'tenant-a',
        name: 'CONCENTRADO_IMSBC_01',
        clase: 'mineral',
        copper_domain: 'CONCENTRADO_CU',
        moisture_pct: 11.5,
        tml_pct: 10.0,
        status: 'ACTIVE',
        last_volume_m3: 80,
        last_weight_t: 220,
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: 'uid-tenant-a',
    });

    const imsbcBlockRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-imsbc-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                closure_origin: 'MOBILE_FIELD',
                dispatch_transport: 'CAMION CONCENTRADO 04',
                dispatch_destination: 'PUERTO ANGAMOS',
                dispatch_timestamp: nowTs,
                dispatch_reference: 'BL-001',
            },
        },
    });
    assert.equal(
        imsbcBlockRes.status,
        422,
        `Embarque Concentrado Cu con humedad >= TML debe bloquearse con HTTP 422 (${imsbcBlockRes.rawText})`
    );

    seedDoc('stockpiles', 'stk-nextgen-01', {
        id: 'stk-nextgen-01',
        tenantId: 'tenant-a',
        accountId: 'tenant-a',
        name: 'PILA_SUR_CU',
        description: 'Contacto faena +56 9 8765 4321 Operador RUT 12.345.678-9 frente sur',
        clase: 'mineral',
        copper_domain: 'OXIDO_CU',
        location_ref: 'SECTOR_SUR_B2',
        status: 'ACTIVE',
        last_volume_m3: 240,
        last_weight_t: 528,
        last_delta_volumen_m3: -60,
        last_delta_volumen_pct: -20,
        geo_point: { latitude: -24.27, longitude: -69.07, altitude: 3120, accuracy: 2.0 },
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: 'uid-tenant-a',
    });

    seedDoc('stockpiles', 'stk-tenant-b', {
        id: 'stk-tenant-b',
        tenantId: 'tenant-b',
        accountId: 'tenant-b',
        name: 'PILA_PRIVADA_TENANT_B',
        status: 'ACTIVE',
        last_volume_m3: 500,
        last_weight_t: 1100,
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: 'uid-tenant-b',
    });

    // Bloqueo estricto de cierre desde escritorio / sin origen móvil de terreno
    const desktopCloseBlockRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                dispatch_reference: 'GUIA-DESKTOP-BLOCK',
            },
        },
    });
    assert.equal(
        desktopCloseBlockRes.status,
        403,
        `Cierre sin closure_origin MOBILE_FIELD debe rechazarse con 403 (${desktopCloseBlockRes.rawText})`
    );

    // Validación obligatoria de transporte, destino y fecha/hora al cerrar por despacho
    const missingTransportShippedRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                closure_origin: 'MOBILE_FIELD',
                dispatch_destination: 'PLANTA SUR',
                dispatch_timestamp: nowTs,
            },
        },
    });
    assert.equal(
        missingTransportShippedRes.status,
        400,
        `Cierre SHIPPED sin transporte debe rechazarse con 400 (${missingTransportShippedRes.rawText})`
    );

    const missingDestShippedRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                closure_origin: 'MOBILE_FIELD',
                dispatch_transport: 'TOLVA-01',
                dispatch_timestamp: nowTs,
            },
        },
    });
    assert.equal(
        missingDestShippedRes.status,
        400,
        `Cierre SHIPPED sin destino debe rechazarse con 400 (${missingDestShippedRes.rawText})`
    );

    const missingTsShippedRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                closure_origin: 'MOBILE_FIELD',
                dispatch_transport: 'TOLVA-01',
                dispatch_destination: 'PLANTA SUR',
            },
        },
    });
    assert.equal(
        missingTsShippedRes.status,
        400,
        `Cierre SHIPPED sin fecha/hora debe rechazarse con 400 (${missingTsShippedRes.rawText})`
    );

    // Validación obligatoria de causa al cerrar por eliminación en terreno
    const missingCauseRemovedRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'FIELD_REMOVED',
                closure_origin: 'MOBILE_FIELD',
                closure_cause: '',
            },
        },
    });
    assert.equal(
        missingCauseRemovedRes.status,
        400,
        `Cierre FIELD_REMOVED sin causa debe rechazarse con 400 (${missingCauseRemovedRes.rawText})`
    );

    const closeHitlRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'SHIPPED',
                closure_origin: 'MOBILE_FIELD',
                dispatch_transport: 'TOLVA MINERA 12',
                dispatch_destination: 'CHANCADO PRIMARIO',
                dispatch_timestamp: nowTs,
                dispatch_reference: 'GUIA-900',
                shipped_weight_t: 420,
                pre_closure_volume_m3: 240,
                closed_at: nowTs,
            },
            diffSummary: [{ field: 'status', current: 'ACTIVE', suggested: 'CLOSED' }],
        },
    });
    assert.equal(closeHitlRes.status, 200, `Cierre por despacho móvil HITL falló: ${closeHitlRes.rawText}`);
    assert.equal(closeHitlRes.body?.asset?.status, 'CLOSED');
    assert.equal(closeHitlRes.body?.asset?.dispatch_transport, 'TOLVA MINERA 12');
    assert.equal(closeHitlRes.body?.asset?.dispatch_destination, 'CHANCADO PRIMARIO');
    assert.equal(closeHitlRes.body?.asset?.dispatch_timestamp, nowTs);
    assert.equal(closeHitlRes.body?.asset?.dispatch_reference, 'GUIA-900');
    assert.equal(closeHitlRes.body?.asset?.closure_origin, 'MOBILE_FIELD');

    const desktopReopenBlockRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'ACTIVE',
                closure_reason: null,
            },
        },
    });
    assert.equal(
        desktopReopenBlockRes.status,
        403,
        `Reapertura sin closure_origin MOBILE_FIELD debe rechazarse con 403 (${desktopReopenBlockRes.rawText})`
    );

    const reopenHitlRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'ACTIVE',
                closure_reason: null,
                closure_cause: null,
                closure_origin: 'MOBILE_FIELD',
            },
        },
    });
    assert.equal(reopenHitlRes.status, 200, `Reapertura HITL falló: ${reopenHitlRes.rawText}`);
    assert.equal(reopenHitlRes.body?.asset?.status, 'ACTIVE');
    assert.equal(reopenHitlRes.body?.asset?.closure_origin, null);
    assert.equal(reopenHitlRes.body?.asset?.dispatch_transport, null);
    assert.equal(reopenHitlRes.body?.asset?.dispatch_destination, null);
    assert.equal(reopenHitlRes.body?.asset?.dispatch_timestamp, null);
    assert.equal(reopenHitlRes.body?.asset?.dispatch_reference, null);

    // Cierre auditable por eliminación en terreno desde móvil
    const closeRemovedRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'CLOSED',
                closure_reason: 'FIELD_REMOVED',
                closure_origin: 'MOBILE_FIELD',
                closure_cause: 'RETIRADO DE CANCHA POR OPERACIÓN',
                closed_at: nowTs + 1000,
            },
        },
    });
    assert.equal(
        closeRemovedRes.status,
        200,
        `Cierre FIELD_REMOVED con causa desde móvil falló: ${closeRemovedRes.rawText}`
    );
    assert.equal(closeRemovedRes.body?.asset?.closure_reason, 'FIELD_REMOVED');
    assert.equal(
        closeRemovedRes.body?.asset?.closure_cause,
        'RETIRADO DE CANCHA POR OPERACIÓN'
    );

    const reopenSecondRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/stockpiles/stk-nextgen-01/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: {
                status: 'ACTIVE',
                closure_reason: null,
                closure_cause: null,
                closure_origin: 'MOBILE_FIELD',
            },
        },
    });
    assert.equal(reopenSecondRes.status, 200);

    const ledgerDocs = Array.from(store.collections.get('audit_ledger')?.values() || []);
    assert.ok(
        ledgerDocs.some((d) => d.action === 'STOCKPILE_CYCLE_CLOSED' && d.targetEntity === 'stk-nextgen-01'),
        'AuditLedger debe registrar STOCKPILE_CYCLE_CLOSED'
    );
    assert.ok(
        ledgerDocs.some((d) => d.action === 'STOCKPILE_CYCLE_REOPENED' && d.targetEntity === 'stk-nextgen-01'),
        'AuditLedger debe registrar STOCKPILE_CYCLE_REOPENED'
    );

    // Servicio soberano de Mapa Satelital Estático CAS (mock deps)
    const zeroCoordsMapRes = await generateAndStoreStaticSatelliteMap({
        stockpileId: 'stk-nextgen-01',
        tenantId: 'tenant-a',
        actorUid: 'uid-tenant-a',
        latitude: 0,
        longitude: 0,
    });
    assert.equal(zeroCoordsMapRes.ok, false);
    assert.equal(zeroCoordsMapRes.reason, 'INVALID_COORDINATES');

    const missingSecretMapRes = await generateAndStoreStaticSatelliteMap(
        {
            stockpileId: 'stk-nextgen-01',
            tenantId: 'tenant-a',
            actorUid: 'uid-tenant-a',
            latitude: -24.27,
            longitude: -69.07,
        },
        { resolveSecret: async () => null }
    );
    assert.equal(missingSecretMapRes.ok, true);
    assert.equal(missingSecretMapRes.available, false);
    assert.equal(missingSecretMapRes.reason, 'SECRET_UNCONFIGURED');

    const okStaticMapRes = await generateAndStoreStaticSatelliteMap(
        {
            stockpileId: 'stk-nextgen-01',
            tenantId: 'tenant-a',
            actorUid: 'uid-tenant-a',
            latitude: -24.27,
            longitude: -69.07,
        },
        {
            apiKey: 'mock-static-maps-secret',
            fetcher: async () => ({
                ok: true,
                status: 200,
                contentType: 'image/png',
                buffer: tinyPngBuf,
            }),
        }
    );
    assert.equal(okStaticMapRes.ok, true);
    assert.equal(okStaticMapRes.available, true);
    assert.ok(okStaticMapRes.staticMapUrl?.startsWith('/api/media/blob/tenant/tenant-a/'));
    assert.equal(okStaticMapRes.sha256?.length, 64);

    // Persistir static_map_url en el documento mock para verificar exposición M2M
    const currentStk = store.collections.get('stockpiles')!.get('stk-nextgen-01')!;
    currentStk.static_map_url = okStaticMapRes.staticMapUrl;

    // M2M x402 /api/m2m/geolapp/stockpiles: Anónimo -> HTTP 402
    const m2mAnonRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/m2m/geolapp/stockpiles',
    });
    assert.equal(m2mAnonRes.status, 402);
    assert.ok(m2mAnonRes.headers['www-authenticate']?.includes('x402'));
    assert.ok(Boolean(m2mAnonRes.headers['payment-required']));

    // M2M autenticado -> HTTP 200 con scrubbing PII Chile y aislamiento multi-tenant
    const m2mValidRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/m2m/geolapp/stockpiles?limit=20',
        headers: {
            Authorization: 'Bearer tok-tenant-a',
            'x-tenant-id': 'tenant-a',
        },
    });
    assert.equal(m2mValidRes.status, 200, `M2M /stockpiles GET falló: ${m2mValidRes.rawText}`);
    const m2mJson = JSON.stringify(m2mValidRes.body);
    assert.ok(!m2mJson.includes('12.345.678-9'), 'M2M debe purgar RUT chileno (Ley 21.719)');
    assert.ok(!m2mJson.includes('8765 4321'), 'M2M debe purgar teléfono +56 (Ley 21.719)');
    assert.ok(!m2mJson.includes('stk-tenant-b'), 'M2M debe aislar stockpiles de otro tenant');
    const nextgenFeedItem = (m2mValidRes.body?.data?.stockpiles || []).find(
        (it: any) => it.id === 'stk-nextgen-01'
    );
    assert.ok(Boolean(nextgenFeedItem));
    assert.equal(nextgenFeedItem.lastDeltaVolumeM3, -60);
    assert.equal(nextgenFeedItem.lastDeltaVolumePct, -20);
    assert.equal(nextgenFeedItem.staticMapUrl, okStaticMapRes.staticMapUrl);

    // Validación firestore.rules: cero colección eliminada, reglas Stockpile Next-Gen activas
    const firestoreRules = fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8');
    const forbiddenCollectionToken = ['geolapp', 'records'].join('_');
    assert.equal(
        firestoreRules.includes(forbiddenCollectionToken),
        false,
        'firestore.rules no debe conservar la colección eliminada'
    );
    assert.ok(firestoreRules.includes('match /stockpiles/{stkId}'));
    assert.ok(firestoreRules.includes('isValidStockpilePayload'));
    assert.ok(firestoreRules.includes('isValidStockpileMeasurementPayload'));

    passedCases++;
    console.log('PASS [3/4] Backend Next-Gen HITL ciclo/IMSBC 422, Mapa Estático CAS, M2M x402 y firestore.rules');

    // ------------------------------------------------------------------------
    // CASO 4: Anti-Regresión de Poda, Guardrails GEMINI.md §4, Paridad i18n y Cero iOS
    // ------------------------------------------------------------------------
    const forbiddenModeGeom = ['GEOMENSURA', 'GEO'].join('_');
    const forbiddenModeExpl = ['EXPLORACION', 'SONDAJES'].join('_');
    const forbiddenModeEstr = ['ESTRUCTURAL', 'HIDRO'].join('_');
    const forbiddenColl = ['geolapp', 'records'].join('_');
    const forbiddenRoute = ['/domain', 'records'].join('-');
    const forbiddenMapsApiHost = ['maps.googleapis', 'com'].join('.');
    const forbiddenTokens = [
        forbiddenModeGeom,
        forbiddenModeExpl,
        forbiddenModeEstr,
        forbiddenColl,
        forbiddenRoute,
    ];

    const removedFiles = [
        'modules/geolapp/components/GeomensuraWorkspace.tsx',
        'modules/geolapp/components/ExploracionWorkspace.tsx',
        'modules/geolapp/components/EstructuralHidroWorkspace.tsx',
        'modules/geolapp/core/utils/geoscienceCalculations.ts',
    ];
    for (const relRemoved of removedFiles) {
        assert.equal(
            fs.existsSync(path.join(WEB_SRC, relRemoved)),
            false,
            `Archivo eliminado no debe reaparecer: ${relRemoved}`
        );
    }

    const { coreShellLocales } = loadWebModule(path.join(WEB_SRC, 'locales/coreShellLocales.ts'));
    const { coreDevPilotLocales } = loadWebModule(path.join(WEB_SRC, 'locales/coreDevPilotLocales.ts'));
    const flattenLocaleKeys = (obj: Record<string, any>, prefix = ''): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj || {})) {
            const nextKey = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                Object.assign(out, flattenLocaleKeys(v, nextKey));
            } else {
                out[nextKey] = String(v ?? '');
            }
        }
        return out;
    };

    const shellEs = flattenLocaleKeys(coreShellLocales.es);
    const shellEn = flattenLocaleKeys(coreShellLocales.en);
    const shellPt = flattenLocaleKeys(coreShellLocales.pt);
    assert.deepEqual(Object.keys(shellEn).sort(), Object.keys(shellEs).sort(), 'coreShellLocales es/en parity');
    assert.deepEqual(Object.keys(shellPt).sort(), Object.keys(shellEs).sort(), 'coreShellLocales es/pt parity');

    const dpEs = flattenLocaleKeys(coreDevPilotLocales.es);
    const dpEn = flattenLocaleKeys(coreDevPilotLocales.en);
    const dpPt = flattenLocaleKeys(coreDevPilotLocales.pt);
    assert.deepEqual(Object.keys(dpEn).sort(), Object.keys(dpEs).sort(), 'coreDevPilotLocales es/en parity');
    assert.deepEqual(Object.keys(dpPt).sort(), Object.keys(dpEs).sort(), 'coreDevPilotLocales es/pt parity');

    const geolappLocaleEs = JSON.parse(
        fs.readFileSync(path.join(WEB_SRC, 'modules/geolapp/i18n/locales/es.json'), 'utf8')
    );
    const geolappLocaleEn = JSON.parse(
        fs.readFileSync(path.join(WEB_SRC, 'modules/geolapp/i18n/locales/en.json'), 'utf8')
    );
    const geolappLocalePt = JSON.parse(
        fs.readFileSync(path.join(WEB_SRC, 'modules/geolapp/i18n/locales/pt.json'), 'utf8')
    );
    const glEsKeys = Object.keys(flattenLocaleKeys(geolappLocaleEs)).sort();
    const glEnKeys = Object.keys(flattenLocaleKeys(geolappLocaleEn)).sort();
    const glPtKeys = Object.keys(flattenLocaleKeys(geolappLocalePt)).sort();
    assert.deepEqual(glEnKeys, glEsKeys, 'geolapp locales es/en parity');
    assert.deepEqual(glPtKeys, glEsKeys, 'geolapp locales es/pt parity');
    for (const reqNs of ['lifecycle', 'hero', 'history', 'projects', 'desktop']) {
        assert.ok(glEsKeys.some((k) => k.startsWith(`${reqNs}.`)), `Falta namespace ${reqNs} en locales`);
    }

    const coreBackendModReg = loadWebModule(path.join(ROOT_DIR, 'src/core/modules/module-registry.ts'));
    assert.deepEqual(coreBackendModReg.CORE_MODULE_REGISTRY.stockpile.domainModes, ['STOCKPILE']);
    const coreWebModReg = loadWebModule(path.join(WEB_SRC, 'core/modules/module-registry.ts'));
    assert.deepEqual(
        coreWebModReg.CORE_MODULE_MAP.stockpile.clientNavItems.map((i: any) => i.domainMode),
        ['STOCKPILE']
    );

    const pilotWsSrc = fs.readFileSync(path.join(WEB_SRC, 'pages/pilot/TestPilotWorkspace.tsx'), 'utf8');
    assert.equal(pilotWsSrc.includes('p3_reserved_notice'), false, 'PROHIBIDO p3_reserved_notice en TestPilotWorkspace');
    assert.equal(pilotWsSrc.includes('domainMode="CATALOG"'), false, 'PROHIBIDO domainMode="CATALOG" en TestPilotWorkspace');

    const devVaultSrc = fs.readFileSync(path.join(WEB_SRC, 'pages/dev/DevVaultGateway.tsx'), 'utf8');
    assert.equal(devVaultSrc.includes('pilot_feedback'), false, 'PROHIBIDO pilot_feedback en DevVaultGateway');

    for (const checkRel of [
        'pages/pilot/TestPilotWorkspace.tsx',
        'pages/dev/DevVaultGateway.tsx',
        'modules/geolapp/GeolappApp.tsx',
        'modules/geolapp/components/StockpileStaticMapCard.tsx',
    ]) {
        const src = fs.readFileSync(path.join(WEB_SRC, checkRel), 'utf8');
        for (const tok of forbiddenTokens) {
            assert.equal(src.includes(tok), false, `${checkRel}: no debe contener token podado`);
        }
        assert.equal(src.includes(forbiddenMapsApiHost), false, `${checkRel}: prohíbe URL directa externa`);
    }

    function extractOpeningTags(source: string, tagNames: string[]): string[] {
        const tags: string[] = [];
        const nameGroup = tagNames.join('|');
        const startRegex = new RegExp(`<(?:${nameGroup})(?=[\\s>/])`, 'g');
        let match: RegExpExecArray | null;

        while ((match = startRegex.exec(source)) !== null) {
            let idx = match.index;
            let braceDepth = 0;
            let quote: string | null = null;
            while (idx < source.length) {
                const ch = source[idx];
                const prev = idx > 0 ? source[idx - 1] : '';
                if (quote) {
                    if (ch === quote && prev !== '\\') quote = null;
                } else if (ch === '"' || ch === "'" || ch === '`') {
                    quote = ch;
                } else if (ch === '{') {
                    braceDepth++;
                } else if (ch === '}') {
                    if (braceDepth > 0) braceDepth--;
                } else if (ch === '>' && braceDepth === 0) {
                    tags.push(source.slice(match.index, idx + 1));
                    break;
                }
                idx++;
            }
        }
        return tags;
    }

    const fase4UiFiles = [
        'modules/geolapp/GeolappApp.tsx',
        'modules/geolapp/GeolappModule.tsx',
        'modules/geolapp/layouts/MainLayout.tsx',
        'modules/geolapp/components/MobileAcopiosHub.tsx',
        'modules/geolapp/components/MobileCalibrationView.tsx',
        'modules/geolapp/components/MobileFaenaList.tsx',
        'modules/geolapp/components/MobileHome.tsx',
        'modules/geolapp/components/MobileFaenaMonitoring.tsx',
        'modules/geolapp/components/StockpileDossierView.tsx',
        'modules/geolapp/components/MobileStockpileClosureView.tsx',
        'modules/geolapp/components/StockpileVisualStage.tsx',
        'modules/geolapp/components/QuickStockpileCapture.tsx',
        'modules/geolapp/components/MobileScanner.tsx',
        'modules/geolapp/components/MeasurementDetail.tsx',
        'modules/geolapp/components/DesktopAnalytics.tsx',
        'modules/geolapp/components/desktop/DesktopShell.tsx',
        'modules/geolapp/components/desktop/DesktopCalibrationAuditView.tsx',
        'modules/geolapp/components/desktop/DesktopDeviceCompatibilityView.tsx',
        'modules/geolapp/components/desktop/DesktopFaenaDirectory.tsx',
        'modules/geolapp/components/desktop/DesktopFaenaStockpiles.tsx',
        'modules/geolapp/components/desktop/DesktopStageWorkspace.tsx',
        'modules/geolapp/components/desktop/DesktopDossierPanel.tsx',
        'modules/geolapp/components/desktop/DesktopFaenaMonitoring.tsx',
        'modules/geolapp/components/StockpileStaticMapCard.tsx',
        'modules/geolapp/components/ExternalSensorsPanel.tsx',
        'components/mobile/MobileAppTopBar.tsx',
        'pages/mobile/DevFieldTestLaunchpad.tsx',
        'pages/mobile/DevFieldTestModuleShell.tsx',
    ];
    for (const relPath of fase4UiFiles) {
        const absPath = path.join(WEB_SRC, relPath);
        const content = fs.readFileSync(absPath, 'utf8');
        assert.equal(/#ffcd00/i.test(content), false, `${relPath}: PROHIBIDO amarillo #FFCD00`);
        assert.equal(/Google Sans|Roboto/i.test(content), false, `${relPath}: PROHIBIDO Google Sans / Roboto`);
        assert.equal(/progress_activity/i.test(content), false, `${relPath}: PROHIBIDO progress_activity`);
        assert.equal(/animate-spin/.test(content), false, `${relPath}: PROHIBIDO animate-spin`);
        assert.equal(/\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/.test(content), false, `${relPath}: debe respetar rounded-none`);
        assert.equal(/text-\[(?:[0-9]|1[0-2])px\]/.test(content), false, `${relPath}: PROHIBIDO texto <= 12px`);

        const formTags = extractOpeningTags(content, ['form']);
        for (const tag of formTags) {
            assert.ok(tag.includes('autoComplete="off"'), `${relPath}: falta autoComplete="off" en ${tag}`);
        }

        const formFieldTags = extractOpeningTags(content, ['input', 'textarea']);
        for (const tag of formFieldTags) {
            if (!/type=["'](?:checkbox|radio|file|hidden)["']/.test(tag)) {
                assert.ok(tag.includes('autoComplete="off"'), `${relPath}: falta autoComplete="off" en ${tag}`);
                assert.ok(tag.includes('spellCheck={false}'), `${relPath}: falta spellCheck={false} en ${tag}`);
            }
        }
    }

    // Cero dependencias iOS / Xcode en MINREPORT
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    const webPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'web/package.json'), 'utf8'));
    const allDeps = {
        ...(rootPkg.dependencies || {}),
        ...(rootPkg.devDependencies || {}),
        ...(webPkg.dependencies || {}),
        ...(webPkg.devDependencies || {}),
    };
    assert.equal(Boolean(allDeps['@capacitor/ios']), false, 'PROHIBIDO @capacitor/ios en MINREPORT');
    assert.equal(Boolean(allDeps['capacitor-ios']), false, 'PROHIBIDO capacitor-ios en MINREPORT');
    const allScripts = JSON.stringify({ ...(rootPkg.scripts || {}), ...(webPkg.scripts || {}) });
    assert.equal(/\bcap\s+(?:add|open|sync|run)\s+ios\b/i.test(allScripts), false, 'PROHIBIDO scripts Capacitor iOS');

    // Motor de estadísticas por faena (Monitoring) + poda de "Nuevo Acopio" en escritorio
    const {
        computeFaenaMetrics,
        computeAllFaenasBreakdown,
    } = loadWebModule(path.join(WEB_SRC, 'modules/geolapp/core/services/stockpile-faena-metrics.ts'));

    const d1 = Date.UTC(2026, 10, 10, 10, 0, 0);
    const d2 = Date.UTC(2026, 10, 12, 10, 0, 0);
    const testAssets = [
        {
            id: 'a-faena1-1',
            name: 'STK-F1-01',
            clase: 'mineral',
            status: 'ACTIVE',
            project_id: 'faena_escondida',
            project_name: 'FAENA NORTE',
            last_volume_m3: 250,
            last_weight_t: 550,
            copper_domain: 'OXIDO_CU',
            createdAt: d1,
            createdBy: 'dev',
        },
        {
            id: 'a-faena2-1',
            name: 'STK-F2-01',
            clase: 'mineral',
            status: 'CLOSED',
            closure_reason: 'SHIPPED',
            shipped_weight_t: 310,
            project_id: 'faena_sur',
            project_name: 'FAENA SUR',
            last_volume_m3: 0,
            last_weight_t: 0,
            createdAt: d1,
            createdBy: 'dev',
        },
    ];
    const testMeasurements = [
        {
            id: 'm-f1-1',
            assetId: 'a-faena1-1',
            timestamp: d1,
            volumen_m3: 200,
            peso_t: 440,
            photo_url: '/api/media/cas/x.webp',
            method: 'digital',
        },
        {
            id: 'm-f1-2',
            assetId: 'a-faena1-1',
            timestamp: d2,
            volumen_m3: 250,
            peso_t: 550,
            photo_url: '/api/media/cas/y.webp',
            method: 'digital',
        },
    ];
    const faena1Metrics = computeFaenaMetrics(testAssets, testMeasurements, 'faena_escondida', [
        {
            id: 'faena_escondida',
            tenantId: 't1',
            accountId: 't1',
            name: 'FAENA NORTE',
            status: 'ACTIVE',
            source: 'DEV_MANUAL_REGISTRY',
            createdAt: d1,
            createdBy: 'dev',
        },
    ]);
    assert.equal(faena1Metrics.activeCount, 1);
    assert.equal(faena1Metrics.activeVolumeM3, 250);
    assert.equal(faena1Metrics.activeWetWeightT, 550);
    assert.equal(faena1Metrics.activeDryWeightT, null, 'TMS ausente no debe inventarse');
    assert.equal(faena1Metrics.activeFineCuT, null, 'Cu fino ausente no debe inventarse');
    assert.equal(faena1Metrics.timeline.length, 2);
    assert.equal(faena1Metrics.netDeltaVolumeM3, 50);

    const allFaenasSummary = computeAllFaenasBreakdown(testAssets, testMeasurements);
    assert.equal(allFaenasSummary.length, 2);

    const desktopRailPath = path.join(
        WEB_SRC,
        'modules/geolapp/components/desktop/DesktopInventoryRail.tsx'
    );
    assert.equal(
        fs.existsSync(desktopRailPath),
        false,
        'DesktopInventoryRail.tsx debe permanecer eliminado'
    );

    const desktopShellSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/desktop/DesktopShell.tsx'),
        'utf8'
    );
    assert.equal(
        desktopShellSrc.includes("t('analytics.new_asset_button'"),
        false,
        'DesktopShell no debe incluir botón NUEVO ACOPIO'
    );
    assert.equal(
        /<select\b/i.test(desktopShellSrc),
        false,
        'DesktopShell no debe incluir selectores <select> de navegación'
    );
    assert.equal(
        desktopShellSrc.includes('>menu<'),
        false,
        'DesktopShell no debe incluir botón hamburguesa'
    );
    assert.ok(
        desktopShellSrc.includes("useState<DesktopNavLevel>('FAENAS')"),
        'DesktopShell debe iniciar en Nivel 1 FAENAS'
    );
    assert.ok(desktopShellSrc.includes('DesktopFaenaDirectory'), 'DesktopShell debe usar DesktopFaenaDirectory');
    assert.ok(desktopShellSrc.includes('DesktopFaenaStockpiles'), 'DesktopShell debe usar DesktopFaenaStockpiles');
    assert.ok(desktopShellSrc.includes('chevron_left') && desktopShellSrc.includes('chevron_right'), 'DesktopShell debe incluir flechas discreta prev/next en Nivel 3');
    assert.ok(desktopShellSrc.includes('landscape') && desktopShellSrc.includes('monitoring'), 'DesktopShell debe incluir par de modos landscape/monitoring');

    const desktopStockpilesSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/desktop/DesktopFaenaStockpiles.tsx'),
        'utf8'
    );
    assert.equal(
        desktopStockpilesSrc.includes("t('analytics.new_asset_button'"),
        false,
        'DesktopFaenaStockpiles no debe incluir botón NUEVO ACOPIO'
    );
    assert.equal(
        /<select\b/i.test(desktopStockpilesSrc),
        false,
        'DesktopFaenaStockpiles no debe incluir <select>'
    );

    const desktopStageSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/desktop/DesktopStageWorkspace.tsx'),
        'utf8'
    );
    assert.ok(
        desktopStageSrc.includes('desktop.campaign_comparison') &&
        desktopStageSrc.includes('desktop.open_in_3d'),
        'DesktopStageWorkspace debe incluir visor Comparativa de Campaña con enlace al Gemelo 3D'
    );

    for (const removedRel of [
        'modules/geolapp/components/CaptureSelection.tsx',
        'modules/geolapp/components/FieldNumPad.tsx',
        'modules/geolapp/components/GeometrySelection.tsx',
        'modules/geolapp/components/StockpileDashboard.tsx',
        'modules/geolapp/components/StockpileRegistration.tsx',
        'modules/geolapp/components/StockpileSummary.tsx',
        'modules/geolapp/components/ManualCapture.tsx',
        'modules/geolapp/components/StockList.tsx',
        'modules/geolapp/components/desktop/DesktopQuickCaptureModal.tsx',
    ]) {
        assert.equal(
            fs.existsSync(path.join(WEB_SRC, removedRel)),
            false,
            `${removedRel} debe permanecer eliminado`
        );
    }

    assert.equal(
        desktopStageSrc.includes('onNewMeasurement'),
        false,
        'DesktopStageWorkspace no debe incluir onNewMeasurement en escritorio'
    );
    assert.equal(
        desktopStageSrc.includes('analytics.cubicar_button'),
        false,
        'DesktopStageWorkspace no debe incluir botón CUBICAR en escritorio'
    );
    assert.ok(
        desktopShellSrc.includes('DesktopCalibrationAuditView'),
        'DesktopShell debe integrar DesktopCalibrationAuditView'
    );
    const staticMapCardSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/StockpileStaticMapCard.tsx'),
        'utf8'
    );
    assert.equal(
        staticMapCardSrc.includes('SovereignGeoMapLazy'),
        false,
        'StockpileStaticMapCard no debe incluir mapa interactivo SovereignGeoMapLazy'
    );

    const devLaunchpadSrc = fs.readFileSync(
        path.join(WEB_SRC, 'pages/mobile/DevFieldTestLaunchpad.tsx'),
        'utf8'
    );
    assert.equal(
        devLaunchpadSrc.includes('bg-[#F8FAFC]') || devLaunchpadSrc.includes('bg-[#07090D]'),
        false,
        'DevFieldTestLaunchpad no debe usar fondos de tarjeta'
    );
    assert.equal(
        devLaunchpadSrc.includes('min-h-[144px]'),
        false,
        'DevFieldTestLaunchpad no debe renderizar tarjetas en Home móvil'
    );
    assert.ok(
        devLaunchpadSrc.includes('aria-label={mod.name}'),
        'DevFieldTestLaunchpad debe usar botones solo-icono accesibles'
    );

    const geolappAppSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/GeolappApp.tsx'),
        'utf8'
    );
    assert.ok(
        geolappAppSrc.includes("return 'hub'"),
        'GeolappApp móvil debe iniciar en hub medir/calibrar'
    );
    assert.ok(
        geolappAppSrc.includes('MobileAcopiosHub') &&
        geolappAppSrc.includes('MobileCalibrationView'),
        'GeolappApp debe montar MobileAcopiosHub y MobileCalibrationView'
    );
    assert.ok(
        /canRegisterDevFaena\s*=\s*Boolean\(\s*isDesktopLayout/.test(geolappAppSrc),
        'Alta manual DEV de faenas debe restringirse exclusivamente a escritorio'
    );

    const mobileFaenaListSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/MobileFaenaList.tsx'),
        'utf8'
    );
    assert.ok(mobileFaenaListSrc.includes('computeAllFaenasBreakdown'));
    assert.equal(mobileFaenaListSrc.includes('<form'), false, 'MobileFaenaList no debe incluir alta de faenas');

    const mobileHomeSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/MobileHome.tsx'),
        'utf8'
    );
    assert.equal(mobileHomeSrc.includes('domain_add'), false, 'MobileHome no debe incluir domain_add');
    assert.ok(mobileHomeSrc.includes('onStartNewStockpile'), 'MobileHome debe incluir botón + de nuevo acopio en faena');
    assert.ok(
        mobileHomeSrc.includes('sortStockpilesByLifecycle') &&
            mobileHomeSrc.includes('delivery_truck_speed') &&
            mobileHomeSrc.includes('delete_sweep'),
        'MobileHome debe ordenar por ciclo y distinguir SHIPPED (delivery_truck_speed) de FIELD_REMOVED (delete_sweep)'
    );

    const scannerSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/MobileScanner.tsx'),
        'utf8'
    );
    assert.equal(
        scannerSrc.includes('MEDIR VOLUMEN'),
        false,
        'MobileScanner no debe incluir botón con texto prohibido MEDIR VOLUMEN'
    );
    assert.ok(
        scannerSrc.includes('autoStartScan') && scannerSrc.includes('tune'),
        'MobileScanner debe disparar captura directa e incluir icono tune'
    );

    const quickCaptureSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/QuickStockpileCapture.tsx'),
        'utf8'
    );
    assert.equal(
        quickCaptureSrc.includes('register_continue_btn'),
        false,
        'QuickStockpileCapture móvil no debe permitir crear faenas'
    );

    const mainLayoutSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/layouts/MainLayout.tsx'),
        'utf8'
    );
    assert.equal(
        mainLayoutSrc.includes('showMobileBottomNav'),
        false,
        'MainLayout no debe contener barra inferior muerta showMobileBottomNav'
    );

    const dossierSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/StockpileDossierView.tsx'),
        'utf8'
    );
    assert.ok(
        dossierSrc.includes('picture_as_pdf') &&
        dossierSrc.includes('add_a_photo') &&
        dossierSrc.includes('done_all') &&
        dossierSrc.includes('lock_open') &&
        dossierSrc.includes('onOpenClosure'),
        'StockpileDossierView móvil debe incluir barra inferior fija de 3 iconos ad hoc y navegar a interfaz dedicada de cierre'
    );
    assert.equal(
        dossierSrc.includes('showClosureForm') || dossierSrc.includes('quickCauses'),
        false,
        'StockpileDossierView no debe mantener diálogo ni chips de cierre inline'
    );

    const closureViewSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/MobileStockpileClosureView.tsx'),
        'utf8'
    );
    assert.ok(
        closureViewSrc.includes('arrow_back') &&
        closureViewSrc.includes('close') &&
        closureViewSrc.includes('check') &&
        closureViewSrc.includes('delivery_truck_speed') &&
        closureViewSrc.includes('delete_sweep') &&
        closureViewSrc.includes('FIELD_REMOVED') &&
        closureViewSrc.includes('closeAssetInField'),
        'MobileStockpileClosureView debe implementar interfaz dedicada dual de cierre con iconos ad hoc'
    );
    assert.equal(
        closureViewSrc.includes('quickCauses') || closureViewSrc.includes('chip_removed_cleared'),
        false,
        'MobileStockpileClosureView no debe incluir razones preestablecidas'
    );

    const visualStageSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/StockpileVisualStage.tsx'),
        'utf8'
    );
    assert.equal(
        visualStageSrc.includes('StagePhotoThumb'),
        false,
        'StockpileVisualStage no debe renderizar carrusel StagePhotoThumb'
    );
    assert.ok(
        visualStageSrc.includes('photo_camera') &&
        visualStageSrc.includes('deployed_code') &&
        visualStageSrc.includes('view_column_2') &&
        visualStageSrc.includes('satellite_alt'),
        'StockpileVisualStage debe conmutar modos visuales mediante iconos puros'
    );

    const desktopClosureExists = fs.existsSync(
        path.join(WEB_SRC, 'modules/geolapp/components/desktop/DesktopClosureModal.tsx')
    );
    assert.equal(desktopClosureExists, false, 'DesktopClosureModal.tsx debe estar eliminado');

    const desktopStageReadOnlySrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/desktop/DesktopStageWorkspace.tsx'),
        'utf8'
    );
    const desktopDossierSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/desktop/DesktopDossierPanel.tsx'),
        'utf8'
    );
    assert.equal(
        desktopStageReadOnlySrc.includes('onRequestClosure') ||
        desktopStageReadOnlySrc.includes('toggleIgnoreMeasurement'),
        false,
        'DesktopStageWorkspace debe permanecer 100% solo lectura sin cierre/borrado ni mutación'
    );
    assert.ok(
        desktopDossierSrc.includes('canEdit={false}') &&
        !desktopDossierSrc.includes('GeolappAiEnrichDrawer'),
        'DesktopDossierPanel debe permanecer 100% solo lectura sin edición ni IA'
    );

    // Aserciones publicación privada 1º DEV en minreport.com + App móvil MINREPORT ACOPIOS-only
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'Dockerfile')), 'Debe existir Dockerfile raíz para Cloud Run southamerica-west1');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, '.dockerignore')), 'Debe existir .dockerignore raíz');
    assert.ok(fs.existsSync(path.join(WEB_SRC, 'config/releaseStage.ts')), 'Debe existir web/src/config/releaseStage.ts');
    const robotsTxtPath = path.join(ROOT_DIR, 'web/public/robots.txt');
    assert.ok(fs.existsSync(robotsTxtPath), 'Debe existir web/public/robots.txt');
    const robotsTxt = fs.readFileSync(robotsTxtPath, 'utf8');
    assert.ok(robotsTxt.includes('Disallow: /'), 'robots.txt debe bloquear indexación (Disallow: /)');

    const backendIndexSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/index.ts'), 'utf8');
    const authMiddlewareSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/middleware/auth.ts'), 'utf8');
    const sessionScopeSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/middleware/sessionScope.ts'), 'utf8');
    const backendEnvSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/config/env.ts'), 'utf8');
    const webauthnSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/api/webauthn.controller.ts'), 'utf8');
    const webAppSrc = fs.readFileSync(path.join(WEB_SRC, 'App.tsx'), 'utf8');
    const webNetworkSrc = fs.readFileSync(path.join(WEB_SRC, 'utils/network.ts'), 'utf8');
    const firebaseJsonSrc = fs.readFileSync(path.join(ROOT_DIR, 'firebase.json'), 'utf8');
    const viteConfigSrc = fs.readFileSync(path.join(ROOT_DIR, 'web/vite.config.ts'), 'utf8');
    const androidManifestSrc = fs.readFileSync(
        path.join(ROOT_DIR, 'web/android/app/src/main/AndroidManifest.xml'),
        'utf8'
    );
    const gitignoreSrc = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');

    assert.ok(
        backendIndexSrc.includes('RELEASE_STAGE_DEV_ONLY') &&
        authMiddlewareSrc.includes('RELEASE_STAGE_DEV_ONLY') &&
        sessionScopeSrc.includes('RELEASE_STAGE_DEV_ONLY') &&
        webAppSrc.includes('isDevPrivateReleaseStage'),
        'Backend y Web deben implementar compuerta DEV_PRIVATE / RELEASE_STAGE_DEV_ONLY'
    );
    assert.ok(
        backendIndexSrc.includes('https://minreport.com') &&
        backendEnvSrc.includes('https://minreport.com') &&
        webauthnSrc.includes('https://minreport.com') &&
        webNetworkSrc.includes('https://minreport.com') &&
        firebaseJsonSrc.includes('https://minreport.com'),
        'El dominio canónico https://minreport.com debe estar configurado en backend, WebAuthn, frontend y Firebase Hosting'
    );
    assert.ok(
        firebaseJsonSrc.includes('X-Robots-Tag') && firebaseJsonSrc.includes('noindex, nofollow, noarchive'),
        'firebase.json debe declarar X-Robots-Tag: noindex, nofollow, noarchive'
    );
    assert.ok(
        viteConfigSrc.includes('/^\\/api\\//') || viteConfigSrc.includes('/^\\\\/api\\\\//'),
        'web/vite.config.ts debe excluir /^\\/api\\// en navigateFallbackDenylist'
    );
    assert.ok(
        devLaunchpadSrc.includes('items-center justify-center') &&
        devLaunchpadSrc.includes("id: 'stockpile'") &&
        !devLaunchpadSrc.includes("id: 'opermaq'"),
        'DevFieldTestLaunchpad debe centrar el icono único de MINREPORT ACOPIOS sin mostrar otros módulos aún'
    );
    assert.ok(
        androidManifestSrc.includes('android:usesCleartextTraffic="false"'),
        'AndroidManifest principal debe bloquear cleartext en Release (usesCleartextTraffic="false")'
    );
    for (const ignoredPattern of ['*.keystore', '*.jks', 'keystore.properties', '*.apk']) {
        assert.ok(
            gitignoreSrc.includes(ignoredPattern),
            `.gitignore debe proteger ${ignoredPattern}`
        );
    }

    // Orden determinista de ciclo y tipo de cierre (ACTIVE -> SHIPPED -> FIELD_REMOVED -> CLOSED otros)
    const faenaMetricsMod = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/services/stockpile-faena-metrics.ts')
    );
    const orderedSample = faenaMetricsMod.sortStockpilesByLifecycle([
        { id: 'z1', name: 'Z-ZERO', status: 'CLOSED', closure_reason: 'ZERO_VOLUME', closed_at: 4000, createdAt: 4000 },
        { id: 'r1', name: 'R-OLD', status: 'CLOSED', closure_reason: 'FIELD_REMOVED', closed_at: 1000, createdAt: 1000 },
        { id: 's1', name: 'S-OLD', status: 'CLOSED', closure_reason: 'SHIPPED', dispatch_timestamp: 2000, createdAt: 2000 },
        { id: 'a1', name: 'A-OLD', status: 'ACTIVE', last_measured_at: 1500, createdAt: 1500 },
        { id: 'r2', name: 'R-NEW', status: 'CLOSED', closure_reason: 'FIELD_REMOVED', closed_at: 5000, createdAt: 5000 },
        { id: 's2', name: 'S-NEW', status: 'CLOSED', closure_reason: 'SHIPPED', dispatch_timestamp: 6000, createdAt: 6000 },
        { id: 'a2', name: 'A-NEW', status: 'ACTIVE', last_measured_at: 7000, createdAt: 7000 },
    ]);
    assert.deepEqual(
        orderedSample.map((item: any) => item.id),
        ['a2', 'a1', 's2', 's1', 'r2', 'r1', 'z1'],
        'sortStockpilesByLifecycle debe ordenar ACTIVE -> SHIPPED -> FIELD_REMOVED -> otros cierres por fecha descendente'
    );

    passedCases++;
    assert.equal(
        passedCases,
        4,
        `Se esperaban 4 casos ejecutados, pero solo pasaron ${passedCases}`
    );
    console.log('PASS [4/4] Anti-regresión, guardrails GEMINI.md §4, paridad i18n y cero dependencias iOS');
    console.log(`\nALL_PASSED ${passedCases}/4 geolapp-fase4-adapters-domains tests`);
}

let suiteCompleted = false;

process.on('beforeExit', (code) => {
    if (!suiteCompleted && code === 0) {
        console.error(
            'FAIL geolapp-fase4-adapters-domains.test.ts: Event loop drained before ALL_PASSED 4/4'
        );
        process.exit(1);
    }
});

run()
    .then(() => {
        suiteCompleted = true;
    })
    .catch((err) => {
        console.error('FAIL geolapp-fase4-adapters-domains.test.ts:', err);
        process.exit(1);
    });
