/**
 * Suite Determinista Fase 4 GEOLAPP® (MINREPORT)
 * Verifica:
 * 1. Adaptadores de superficie & GNSS RTK NMEA (`UavPointCloudAdapter`, `MobileLidarAdapter`, `GnssRtkNmeaAdapter`),
 *    generación glTF 2.0 `.glb` desde nube de puntos (`buildPointCloudHeightfieldGlbMesh`) y digestión CAS `MESH_3D_GLB`.
 * 2. Cálculos geocientíficos deterministas (`computeUtmStakeout`, `computeUtmPolygonMensura`,
 *    `computeIntervalRqdAndRecovery`, `computeDrillholeComposites`, `evaluateQaQcRpd`,
 *    `imuToStructuralAttitude`, `computeStrikeRightHandRule`, `projectEqualAreaPole`,
 *    `buildEqualAreaGreatCircleSvgPath`).
 * 3. Contratos backend Fase 4: `/api/geolapp/domain-records` (GET/POST/PATCH HITL "ACTUALIZAR", anti-Base64,
 *    aislamiento multi-tenant), `/api/m2m/geolapp/domain-records` (x402 HTTP 402/400/403/200 + scrubbing PII Chile)
 *    y `firestore.rules` (`match /geolapp_records/{recordId}`).
 * 4. Guardrails `GEMINI.md §4`, paridad i18n (`es`/`en`/`pt`), aislamiento de portales y cero dependencias iOS.
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
        if (request.startsWith('.')) {
            const targetNorm = path.normalize(path.resolve(localDir, request));
            if (targetNorm.endsWith('config/firebase')) {
                return { auth: { currentUser: null }, db: {}, storage: {} };
            }
            if (targetNorm.endsWith('offline/OfflineStorage')) {
                return { offlineStorage: {} };
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
        storage: () => ({ bucket: () => ({}) }),
        messaging: () => ({}),
    };

    const firebaseMock = {
        __esModule: true,
        db,
        auth,
        firestore: firebaseAdminStub.firestore,
        storage: firebaseAdminStub.storage(),
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
            if (err) reject(err);
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
    // CASO 2: Matemática Geocientífica Determinista (Replanteo, Mensura, RQD,
    //         Compósitos, QA/QC RPD, Actitud IMU, Strike RHR, Red de Schmidt)
    // ------------------------------------------------------------------------
    const {
        computeUtmStakeout,
        computeUtmPolygonMensura,
        computeIntervalRqdAndRecovery,
        computeDrillholeComposites,
        evaluateQaQcRpd,
        computeStrikeRightHandRule,
        imuToStructuralAttitude,
        projectEqualAreaPole,
        buildEqualAreaGreatCircleSvgPath,
    } = loadWebModule(path.join(WEB_SRC, 'modules/geolapp/core/utils/geoscienceCalculations.ts'));

    const stakeout = computeUtmStakeout(
        { easting: 500000, northing: 7300000, elevationM: 3100 },
        { easting: 500030, northing: 7300040, elevationM: 3105 }
    );
    assert.equal(stakeout.deltaE, 30);
    assert.equal(stakeout.deltaN, 40);
    assert.equal(stakeout.deltaZ, 5);
    assert.equal(stakeout.horizontalDistanceM, 50);
    assert.ok(Math.abs(stakeout.slopeDistanceM - Math.hypot(50, 5)) < 1e-6);
    assert.ok(Math.abs(stakeout.azimuthDeg - (Math.atan2(30, 40) * 180) / Math.PI) < 0.01);
    assert.ok(Math.abs(stakeout.slopePct - 10) < 1e-6);

    const mensura = computeUtmPolygonMensura([
        { easting: 500000, northing: 7300000 },
        { easting: 500100, northing: 7300000 },
        { easting: 500100, northing: 7300050 },
        { easting: 500000, northing: 7300050 },
    ]);
    assert.ok(mensura !== null);
    assert.ok(Math.abs(mensura.areaM2 - 5000) < 1e-6);
    assert.ok(Math.abs(mensura.areaHa - 0.5) < 1e-9);
    assert.ok(Math.abs(mensura.perimeterM - 300) < 1e-6);
    assert.ok(Math.abs(mensura.centroid.easting - 500050) < 1e-6);
    assert.ok(Math.abs(mensura.centroid.northing - 7300025) < 1e-6);
    assert.equal(computeUtmPolygonMensura([{ easting: 0, northing: 0 }, { easting: 10, northing: 0 }]), null);

    const rqdGood = computeIntervalRqdAndRecovery(0, 2, 1.8, 1.5);
    assert.ok(rqdGood !== null);
    assert.equal(rqdGood.runLengthM, 2);
    assert.equal(rqdGood.recoveryPct, 90);
    assert.equal(rqdGood.rqdPct, 75);
    assert.equal(rqdGood.rqdQuality, 'BUENA');
    assert.equal(computeIntervalRqdAndRecovery(5, 3, 1, 1), null);

    const comp = computeDrillholeComposites([
        { fromM: 0, toM: 2, cuTotalPct: 1.0, cuSolublePct: 0.4, rqdPct: 80, recoveryPct: 95 },
        { fromM: 2, toM: 6, cuTotalPct: 0.4, cuSolublePct: 0.1, rqdPct: 50, recoveryPct: 80 },
    ]);
    assert.equal(comp.totalLoggedLengthM, 6);
    assert.ok(Math.abs((comp.weightedCuTotalPct ?? 0) - 0.6) < 1e-6);
    assert.ok(Math.abs((comp.weightedCuSolublePct ?? 0) - 0.2) < 1e-6);
    assert.ok(Math.abs((comp.meanRqdPct ?? 0) - 60) < 1e-6);
    assert.ok(Math.abs((comp.meanRecoveryPct ?? 0) - 85) < 1e-6);

    const qaqcPass = evaluateQaQcRpd(1.0, 1.04, 10);
    assert.equal(qaqcPass.passed, true);
    assert.ok(qaqcPass.rpdPct < 5);

    const qaqcFail = evaluateQaQcRpd(1.0, 1.4, 10);
    assert.equal(qaqcFail.passed, false);
    assert.ok(qaqcFail.rpdPct > 10);

    assert.equal(computeStrikeRightHandRule(90), 0);
    assert.equal(computeStrikeRightHandRule(180), 90);
    assert.equal(computeStrikeRightHandRule(0), 270);
    assert.equal(computeStrikeRightHandRule(270), 180);

    const attitude = imuToStructuralAttitude(30, 0, 120);
    assert.ok(attitude.dipDeg >= 0 && attitude.dipDeg <= 90);
    assert.ok(attitude.dipDirectionDeg >= 0 && attitude.dipDirectionDeg < 360);
    assert.ok(
        Math.abs(attitude.strikeDeg - computeStrikeRightHandRule(attitude.dipDirectionDeg)) < 0.01
    );

    const pole = projectEqualAreaPole(45, 90, 100);
    assert.ok(Number.isFinite(pole.x) && Number.isFinite(pole.y));
    assert.ok(pole.r >= 0 && pole.r <= 100);
    assert.ok(Math.hypot(pole.x, pole.y) <= 100.01);

    const gcInclined = buildEqualAreaGreatCircleSvgPath(45, 90, 150, 150, 100);
    assert.ok(gcInclined.startsWith('M ') && gcInclined.includes(' L '));
    const gcVertical = buildEqualAreaGreatCircleSvgPath(90, 90, 150, 150, 100);
    assert.ok(gcVertical.startsWith('M ') && gcVertical.includes(' L '));

    passedCases++;
    console.log('PASS [2/4] Cálculos deterministas Geomensura, Exploración DDH/RC QA/QC y Estructural/Schmidt');

    // ------------------------------------------------------------------------
    // CASO 3: Contratos Zod, Express Controllers (/api/geolapp & /api/m2m/geolapp)
    //         y firestore.rules Fase 4 (100% sandbox-safe en memoria)
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

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/geolapp', geolappRouter);
    registerM2mGeolappAdapterRoutes(app);

    const nowTs = Date.now();
    const geomRecord = {
        id: 'geom-f4-001',
        tenantId: 'tenant-a',
        accountId: 'tenant-a',
        domainMode: 'GEOMENSURA_GEO',
        code: 'REPL-R01',
        title: 'Replanteo Rampa Norte Contacto +56 9 8765 4321',
        status: 'ACTIVE',
        notes: 'Operador RUT 12.345.678-9 verificado en banco 3100',
        utmFix: {
            zone: 19,
            band: 'K',
            hemisphere: 'S',
            easting: 500000,
            northing: 7300000,
            altitudeM: 3100,
            fixQuality: 'RTK_FIXED',
        },
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: 'uid-tenant-a',
        payload: {
            stationCode: 'E-01',
            stationEasting: 500000,
            stationNorthing: 7300000,
            stationElevationM: 3100,
            utmZone: 19,
            hemisphere: 'S',
            targetCode: 'P-01',
            targetEasting: 500030,
            targetNorthing: 7300040,
            targetElevationM: 3105,
            deltaE: 30,
            deltaN: 40,
            deltaZ: 5,
            horizontalDistanceM: 50,
            slopeDistanceM: 50.25,
            azimuthDeg: 36.87,
            slopePct: 10,
            polygonVertices: [
                { code: 'V1', easting: 500000, northing: 7300000, elevationM: 3100 },
                { code: 'V2', easting: 500100, northing: 7300000, elevationM: 3100 },
                { code: 'V3', easting: 500100, northing: 7300050, elevationM: 3100 },
            ],
            polygonAreaM2: 2500,
            polygonPerimeterM: 211.8,
        },
    };

    const explorRecord = {
        id: 'expl-f4-001',
        tenantId: 'tenant-a',
        accountId: 'tenant-a',
        domainMode: 'EXPLORACION_SONDAJES',
        code: 'DDH-F4-01',
        title: 'Sondaje Diamantino Fase 4',
        status: 'ACTIVE',
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: 'uid-tenant-a',
        payload: {
            holeId: 'DDH-F4-01',
            method: 'DDH',
            collarEasting: 500200,
            collarNorthing: 7300200,
            collarElevationM: 3150,
            utmZone: 19,
            hemisphere: 'S',
            azimuthDeg: 120,
            dipDeg: -60,
            totalDepthM: 120,
            intervals: [
                {
                    id: 'iv-1',
                    fromM: 0,
                    toM: 2,
                    recoveredM: 1.8,
                    sumPiecesGe10cmM: 1.5,
                    recoveryPct: 90,
                    rqdPct: 75,
                    rqdQuality: 'BUENA',
                    lithology: 'PORFIDO_DACITICO',
                    alteration: 'POTASICA',
                    copperDomain: 'SULFURO_PRIMARIO_CU',
                    cuTotalPct: 0.92,
                    cuSolublePct: 0.14,
                    coreBoxPhotoUrl: 'https://storage.googleapis.com/cas-southamerica-west1/box-01.webp',
                },
            ],
            weightedCuTotalPct: 0.92,
            weightedCuSolublePct: 0.14,
            meanRqdPct: 75,
            meanRecoveryPct: 90,
        },
    };

    const estrRecord = {
        id: 'estr-f4-001',
        tenantId: 'tenant-a',
        accountId: 'tenant-a',
        domainMode: 'ESTRUCTURAL_HIDRO',
        code: 'EST-07',
        title: 'Estación Estructural Talud Oeste',
        status: 'ACTIVE',
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: 'uid-tenant-a',
        payload: {
            stationCode: 'EST-07',
            easting: 500300,
            northing: 7300100,
            elevationM: 3080,
            utmZone: 19,
            hemisphere: 'S',
            planes: [
                {
                    id: 'pl-1',
                    structureType: 'FALLA',
                    dipDeg: 48,
                    dipDirectionDeg: 135,
                    strikeDeg: 45,
                    jrcBarton: 10,
                    apertureMm: 1.5,
                    infill: 'ARCILLA',
                },
            ],
            hydrogeology: {
                piezometerId: 'PZ-07',
                staticWaterLevelM: 44.2,
                wellDepthM: 120,
                ph: 6.9,
                conductivityUsCm: 1380,
                temperatureC: 13.8,
            },
        },
    };

    for (const rec of [geomRecord, explorRecord, estrRecord]) {
        const postRes = await dispatchExpressInMemory(app, {
            method: 'POST',
            path: '/api/geolapp/domain-records',
            headers: { Authorization: 'Bearer tok-tenant-a' },
            body: rec,
        });
        assert.ok(
            postRes.status === 200 || postRes.status === 201,
            `POST ${rec.domainMode} falló (${postRes.status}): ${postRes.rawText}`
        );
        assert.equal(postRes.body?.success, true);
        assert.equal(postRes.body?.record?.id, rec.id);
    }

    // Rechazar Base64 data: URL en payload de Exploración
    const badBase64Record = JSON.parse(JSON.stringify(explorRecord));
    badBase64Record.id = 'expl-bad-b64';
    badBase64Record.payload.intervals[0].coreBoxPhotoUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const base64RejectRes = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/domain-records',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: badBase64Record,
    });
    assert.equal(base64RejectRes.status, 400, 'Debe rechazar data:...;base64, en coreBoxPhotoUrl');

    // Aislamiento multi-tenant en POST /domain-records
    const crossTenantPost = await dispatchExpressInMemory(app, {
        method: 'POST',
        path: '/api/geolapp/domain-records',
        headers: { Authorization: 'Bearer tok-tenant-b' },
        body: geomRecord,
    });
    assert.equal(crossTenantPost.status, 403, 'Tenant B no puede escribir registros en Tenant A');

    // GET /domain-records filtrado
    const getDomainRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/geolapp/domain-records?tenantId=tenant-a&domainMode=GEOMENSURA_GEO',
        headers: { Authorization: 'Bearer tok-tenant-a' },
    });
    assert.equal(getDomainRes.status, 200);
    assert.equal(getDomainRes.body?.success, true);
    assert.ok(Array.isArray(getDomainRes.body?.items) && getDomainRes.body.items.length === 1);
    assert.equal(getDomainRes.body.items[0].id, 'geom-f4-001');

    // PATCH HITL sin palabra clave "ACTUALIZAR" -> 400
    const badHitlKeywordRes = await dispatchExpressInMemory(app, {
        method: 'PATCH',
        path: '/api/geolapp/domain-records/geom-f4-001/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'CONFIRMAR',
            patch: { status: 'VERIFIED' },
        },
    });
    assert.equal(badHitlKeywordRes.status, 400, 'HITL debe exigir confirmationKeyword="ACTUALIZAR"');

    // PATCH HITL intentando alterar campo inmutable tenantId -> 400
    const immutablePatchRes = await dispatchExpressInMemory(app, {
        method: 'PATCH',
        path: '/api/geolapp/domain-records/geom-f4-001/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: { tenantId: 'tenant-b', status: 'VERIFIED' },
        },
    });
    assert.equal(immutablePatchRes.status, 400, 'HITL debe bloquear modificación de tenantId');

    // PATCH HITL válido con "ACTUALIZAR" + AuditLedger
    const validHitlRes = await dispatchExpressInMemory(app, {
        method: 'PATCH',
        path: '/api/geolapp/domain-records/geom-f4-001/hitl-update',
        headers: { Authorization: 'Bearer tok-tenant-a' },
        body: {
            confirmationKeyword: 'ACTUALIZAR',
            patch: { status: 'VERIFIED', notes: 'Revisado HITL Fase 4 sin PII' },
            diffSummary: [{ field: 'status', current: 'ACTIVE', suggested: 'VERIFIED' }],
        },
    });
    assert.equal(validHitlRes.status, 200, `HITL válido falló: ${validHitlRes.rawText}`);
    assert.equal(validHitlRes.body?.record?.status, 'VERIFIED');
    const ledgerDocs = Array.from(store.collections.get('audit_ledger')?.values() || []);
    assert.ok(
        ledgerDocs.some((d) => d.action === 'GEOLAPP_DOMAIN_RECORD_HITL_UPDATED' && d.targetEntity === 'geom-f4-001'),
        'AuditLedger debe registrar GEOLAPP_DOMAIN_RECORD_HITL_UPDATED'
    );

    // M2M x402 /api/m2m/geolapp/domain-records: Anónimo -> HTTP 402
    const m2mAnonRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/m2m/geolapp/domain-records',
    });
    assert.equal(m2mAnonRes.status, 402);
    assert.ok(m2mAnonRes.headers['www-authenticate']?.includes('x402'));
    assert.ok(Boolean(m2mAnonRes.headers['payment-required']));

    // M2M limit inválido -> HTTP 400
    const m2mBadLimit = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/m2m/geolapp/domain-records?limit=999',
        headers: {
            Authorization: 'Bearer tok-tenant-a',
            'x-tenant-id': 'tenant-a',
        },
    });
    assert.equal(m2mBadLimit.status, 400);

    // M2M cross-tenant query vs context -> HTTP 403
    const m2mCrossTenantQuery = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/m2m/geolapp/domain-records?tenantId=tenant-b',
        headers: {
            Authorization: 'Bearer tok-admin-1',
            'x-tenant-id': 'tenant-a',
        },
    });
    assert.equal(m2mCrossTenantQuery.status, 403);

    // Sembrar registro con PII chilena y validar scrubbing Ley N° 21.719 en M2M
    seedDoc('geolapp_records', 'geom-pii-test', {
        ...geomRecord,
        id: 'geom-pii-test',
        title: 'Contacto faena +56 9 8765 4321',
        notes: 'Operador RUT 12.345.678-9 verificado',
    });
    seedDoc('geolapp_records', 'geom-tenant-b', {
        ...geomRecord,
        id: 'geom-tenant-b',
        tenantId: 'tenant-b',
        accountId: 'tenant-b',
        title: 'Registro Confidencial Tenant B',
    });

    const m2mValidRes = await dispatchExpressInMemory(app, {
        method: 'GET',
        path: '/api/m2m/geolapp/domain-records?limit=20&domainMode=GEOMENSURA_GEO',
        headers: {
            Authorization: 'Bearer tok-tenant-a',
            'x-tenant-id': 'tenant-a',
        },
    });
    assert.equal(m2mValidRes.status, 200, `M2M GET válido falló: ${m2mValidRes.rawText}`);
    const m2mJson = JSON.stringify(m2mValidRes.body);
    assert.ok(!m2mJson.includes('12.345.678-9'), 'M2M debe purgar RUT chileno (Ley 21.719)');
    assert.ok(!m2mJson.includes('8765 4321'), 'M2M debe purgar teléfono +56 (Ley 21.719)');
    assert.ok(!m2mJson.includes('geom-tenant-b'), 'M2M debe aislar registros de otro tenant');

    // Validación firestore.rules Fase 4
    const firestoreRules = fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8');
    const geolappRulesIdx = firestoreRules.indexOf('match /geolapp_records/{recordId}');
    assert.ok(geolappRulesIdx >= 0, 'firestore.rules debe declarar match /geolapp_records/{recordId}');
    const nextMatchIdx = firestoreRules.indexOf('\n    match /', geolappRulesIdx + 10);
    const geolappRecordsBlock = firestoreRules.slice(
        geolappRulesIdx,
        nextMatchIdx > geolappRulesIdx ? nextMatchIdx : geolappRulesIdx + 3000
    );
    assert.ok(geolappRecordsBlock.includes('isAuthenticated()'));
    assert.ok(geolappRecordsBlock.includes('isBoundedPayload(request.resource.data)'));
    assert.ok(geolappRecordsBlock.includes('isAccountMember('));
    assert.ok(geolappRecordsBlock.includes('isSystemPrivileged()'));
    assert.ok(geolappRecordsBlock.includes('docTenantId(request.resource.data) == docTenantId(resource.data)'));
    assert.ok(geolappRecordsBlock.includes('isTenantAdminOrOwner('));

    passedCases++;
    console.log('PASS [3/4] Zod/Express /domain-records + HITL "ACTUALIZAR", M2M x402 PII scrub y firestore.rules');

    // ------------------------------------------------------------------------
    // CASO 4: Guardrails GEMINI.md §4, Paridad i18n, Portales y Cero iOS
    // ------------------------------------------------------------------------
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
    for (const suffix of [
        'geolapp_geomensura',
        'geolapp_exploracion',
        'geolapp_estructural',
        'loading_geolapp_geomensura',
        'loading_geolapp_exploracion',
        'loading_geolapp_estructural',
    ]) {
        assert.ok(
            Object.keys(shellEs).some((k) => k.endsWith(`.${suffix}`)),
            `coreShellLocales falta clave *.${suffix}`
        );
    }

    const dpEs = flattenLocaleKeys(coreDevPilotLocales.es);
    const dpEn = flattenLocaleKeys(coreDevPilotLocales.en);
    const dpPt = flattenLocaleKeys(coreDevPilotLocales.pt);
    assert.deepEqual(Object.keys(dpEn).sort(), Object.keys(dpEs).sort(), 'coreDevPilotLocales es/en parity');
    assert.deepEqual(Object.keys(dpPt).sort(), Object.keys(dpEs).sort(), 'coreDevPilotLocales es/pt parity');
    for (const suffix of ['geolapp_geomensura', 'geolapp_exploracion', 'geolapp_estructural']) {
        assert.ok(
            Object.keys(dpEs).some((k) => k.endsWith(`.${suffix}`)),
            `coreDevPilotLocales falta clave *.${suffix}`
        );
    }

    const pilotWsSrc = fs.readFileSync(path.join(WEB_SRC, 'pages/pilot/TestPilotWorkspace.tsx'), 'utf8');
    assert.equal(pilotWsSrc.includes('p3_reserved_notice'), false, 'PROHIBIDO p3_reserved_notice en TestPilotWorkspace');
    assert.equal(pilotWsSrc.includes('domainMode="CATALOG"'), false, 'PROHIBIDO domainMode="CATALOG" en TestPilotWorkspace');
    assert.ok(pilotWsSrc.includes('GEOLAPP_GEOMENSURA') && pilotWsSrc.includes('GEOLAPP_ESTRUCTURAL'));

    const devVaultSrc = fs.readFileSync(path.join(WEB_SRC, 'pages/dev/DevVaultGateway.tsx'), 'utf8');
    assert.equal(devVaultSrc.includes('pilot_feedback'), false, 'PROHIBIDO pilot_feedback en DevVaultGateway');
    assert.ok(devVaultSrc.includes('geolappDomainMode'));

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
        'modules/geolapp/components/GeomensuraWorkspace.tsx',
        'modules/geolapp/components/ExploracionWorkspace.tsx',
        'modules/geolapp/components/EstructuralHidroWorkspace.tsx',
        'modules/geolapp/components/ExternalSensorsPanel.tsx',
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

    passedCases++;
    console.log('PASS [4/4] Guardrails GEMINI.md §4, paridad i18n, aislamiento portales y cero dependencias iOS');
    console.log(`\nALL_PASSED ${passedCases}/4 geolapp-fase4-adapters-domains tests`);
}

run().catch((err) => {
    console.error('FAIL geolapp-fase4-adapters-domains.test.ts:', err);
    process.exit(1);
});
