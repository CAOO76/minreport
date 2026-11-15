import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { auth, db, storage } from '../../config/firebase';
import {
    CanonicalGeoFixSchema,
    CreateGeoReportStampBodySchema,
    GeoReportStampSchema,
    GeoResolveRequestSchema,
    GeoResolvedCandidateSchema,
    PmtilesHeaderMetadataSchema,
    UtmCoordinateSchema,
} from '../../contracts/geo.contracts';
import {
    buildCanonicalGeoFix,
    buildGeoStampVectorSvg,
    computeDeterministicGeoStampHash,
    formatUtmCoordinate,
    resolveUtmLatitudeBand,
    resolveUtmZone,
    sha256Hex,
    utmToWgs84,
    wgs84ToUtm,
} from '../geo/wgs84UtmProjection';
import {
    PMTILES_V3_HEADER_BYTES,
    decodePmtilesDirectory,
    encodePmtilesDirectory,
    findTileInDirectory,
    parsePmtilesV3Header,
    pmtilesTileIdToZxy,
    serializePmtilesV3Header,
    toPmtilesHeaderMetadata,
    zxyToPmtilesTileId,
    type PmtilesDirectoryEntry,
    type PmtilesV3Header,
} from '../geo/pmtilesSpec';
import { ConfidentialityAirlockService } from '../privacy/ConfidentialityAirlockService';
import { SIX_YEARS_MIN_MS, THIRTY_DAYS_MS, toEpochMillis } from '../retention-policy';
import geoRouter from '../../api/geo.controller';

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371008.8;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createInMemoryFirestore() {
    const docs = new Map<string, Record<string, any>>();
    let autoIdSeq = 1;

    const makeDocRef = (docPath: string): any => {
        const parts = docPath.split('/');
        const id = parts[parts.length - 1];
        return {
            id,
            path: docPath,
            async get() {
                const stored = docs.get(docPath);
                return {
                    id,
                    exists: stored !== undefined,
                    data: () => (stored !== undefined ? { ...stored } : undefined),
                };
            },
            async set(payload: Record<string, any>, opts?: { merge?: boolean }) {
                const prev = opts?.merge ? { ...(docs.get(docPath) || {}) } : {};
                docs.set(docPath, { ...prev, ...payload });
            },
            collection(subName: string) {
                return makeColRef(`${docPath}/${subName}`);
            },
        };
    };

    const makeColRef = (colPath: string): any => ({
        doc(docId?: string) {
            const effectiveId = docId && docId.length > 0 ? docId : `auto_${autoIdSeq++}`;
            return makeDocRef(`${colPath}/${effectiveId}`);
        },
        where(field: string, op: string, value: any) {
            return {
                async get() {
                    const matched: any[] = [];
                    for (const [p, d] of docs.entries()) {
                        const segments = p.split('/');
                        if (segments.slice(0, -1).join('/') !== colPath) continue;
                        const ok = op === '==' ? d[field] === value : false;
                        if (ok) {
                            matched.push({
                                id: segments[segments.length - 1],
                                exists: true,
                                data: () => ({ ...d }),
                            });
                        }
                    }
                    return { empty: matched.length === 0, docs: matched };
                },
            };
        },
    });

    const runTransaction = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
        const staged: Array<() => void> = [];
        const tx = {
            async get(ref: any) {
                return ref.get();
            },
            set(ref: any, payload: Record<string, any>, opts?: { merge?: boolean }) {
                staged.push(() => {
                    const prev = opts?.merge ? { ...(docs.get(ref.path) || {}) } : {};
                    docs.set(ref.path, { ...prev, ...payload });
                });
            },
        };
        const result = await fn(tx);
        for (const apply of staged) {
            apply();
        }
        return result;
    };

    return {
        docs,
        collection(name: string) {
            return makeColRef(name);
        },
        runTransaction,
    };
}

async function dispatchGeoRoute(params: {
    method: 'post' | 'get';
    path: string;
    body?: any;
    params?: Record<string, string>;
    headers?: Record<string, string>;
}): Promise<{ statusCode: number; body: any; headers: Record<string, string> }> {
    const layer = (geoRouter as any).stack.find(
        (l: any) => l?.route?.path === params.path && l?.route?.methods?.[params.method]
    );
    assert.ok(layer, `Ruta ${params.method.toUpperCase()} ${params.path} debe estar registrada en geoRouter`);

    const handlers = layer.route.stack.map((s: any) => s.handle) as Array<
        (req: Request, res: Response, next: NextFunction) => any
    >;

    const req = {
        method: params.method.toUpperCase(),
        url: `/api/geo${params.path}`,
        baseUrl: '/api/geo',
        path: params.path,
        body: params.body ?? {},
        params: params.params ?? {},
        headers: { ...(params.headers ?? {}) },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    const capturedHeaders: Record<string, string> = {};
    let statusCode = 200;
    let responseBody: any = undefined;
    let finished = false;

    const res: any = {
        headersSent: false,
        setHeader(k: string, v: string) {
            capturedHeaders[k.toLowerCase()] = String(v);
        },
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: any) {
            responseBody = payload;
            finished = true;
            this.headersSent = true;
            return this;
        },
        send(payload: any) {
            responseBody = payload;
            finished = true;
            this.headersSent = true;
            return this;
        },
    };

    for (const handler of handlers) {
        if (finished) break;
        let nextCalled = false;
        let nextErr: any = null;
        await handler(req, res as Response, (err?: any) => {
            nextCalled = true;
            nextErr = err;
        });
        if (nextErr) throw nextErr;
        if (!nextCalled && !finished) {
            break;
        }
    }

    return { statusCode, body: responseBody, headers: capturedHeaders };
}

async function test1Wgs84UtmRoundTripAndSha256(): Promise<void> {
    // Validación síncrona FIPS 180-4 SHA-256 contra node:crypto
    for (const sample of [
        '',
        'abc',
        'MINREPORT 19K 509832.14 mE 7534912.08 mN',
        'Faena Minería Chile Ñ° — ' + 'x'.repeat(120),
    ]) {
        const expected = crypto.createHash('sha256').update(sample, 'utf8').digest('hex');
        assert.equal(sha256Hex(sample), expected, `sha256Hex debe coincidir con Node crypto para "${sample.slice(0, 20)}"`);
    }

    const cases: Array<{
        name: string;
        lat: number;
        lng: number;
        expectedZone: number;
        expectedBand: string;
        expectedHemi: 'N' | 'S';
        expectedEpsg: string;
    }> = [
        { name: 'CL Chuquicamata', lat: -22.2889, lng: -68.9022, expectedZone: 19, expectedBand: 'K', expectedHemi: 'S', expectedEpsg: 'EPSG:32719' },
        { name: 'CL Santiago', lat: -33.4489, lng: -70.6693, expectedZone: 19, expectedBand: 'H', expectedHemi: 'S', expectedEpsg: 'EPSG:32719' },
        { name: 'PE Lima', lat: -12.0464, lng: -77.0428, expectedZone: 18, expectedBand: 'L', expectedHemi: 'S', expectedEpsg: 'EPSG:32718' },
        { name: 'BR Carajás', lat: -6.0631, lng: -50.1683, expectedZone: 22, expectedBand: 'M', expectedHemi: 'S', expectedEpsg: 'EPSG:32722' },
        { name: 'AU Kalgoorlie', lat: -30.7489, lng: 121.4658, expectedZone: 51, expectedBand: 'J', expectedHemi: 'S', expectedEpsg: 'EPSG:32751' },
        { name: 'CA Sudbury', lat: 46.4917, lng: -80.993, expectedZone: 17, expectedBand: 'T', expectedHemi: 'N', expectedEpsg: 'EPSG:32617' },
        { name: 'Ecuador Norte', lat: 1.5, lng: -75.25, expectedZone: 18, expectedBand: 'N', expectedHemi: 'N', expectedEpsg: 'EPSG:32618' },
        { name: 'Ecuador Sur límite 10000000.00 mN', lat: -1e-8, lng: -51.06, expectedZone: 22, expectedBand: 'M', expectedHemi: 'S', expectedEpsg: 'EPSG:32722' },
        { name: 'Noruega 32V excepción', lat: 60.3913, lng: 4.5, expectedZone: 32, expectedBand: 'V', expectedHemi: 'N', expectedEpsg: 'EPSG:32632' },
        { name: 'Svalbard 33X excepción', lat: 78.2232, lng: 10.5, expectedZone: 33, expectedBand: 'X', expectedHemi: 'N', expectedEpsg: 'EPSG:32633' },
    ];

    for (const tc of cases) {
        assert.equal(resolveUtmLatitudeBand(tc.lat), tc.expectedBand, `${tc.name} band`);
        assert.equal(resolveUtmZone(tc.lat, tc.lng), tc.expectedZone, `${tc.name} zone`);

        const utm = wgs84ToUtm(tc.lat, tc.lng);
        UtmCoordinateSchema.parse(utm);
        assert.equal(utm.zone, tc.expectedZone, `${tc.name} utm.zone`);
        assert.equal(utm.band, tc.expectedBand, `${tc.name} utm.band`);
        assert.equal(utm.hemisphere, tc.expectedHemi, `${tc.name} utm.hemisphere`);
        assert.equal(utm.epsg, tc.expectedEpsg, `${tc.name} utm.epsg`);
        assert.equal(utm.datum, 'WGS84');

        const back = utmToWgs84({
            zone: utm.zone,
            hemisphere: utm.hemisphere,
            eastingM: utm.eastingM,
            northingM: utm.northingM,
        });
        const distMeters = haversineMeters(tc.lat, tc.lng, back.lat, back.lng);
        assert.ok(distMeters < 0.001, `${tc.name} error round-trip ${distMeters} m debe ser < 1 mm (0.001 m)`);

        const reprojected = wgs84ToUtm(back.lat, back.lng, utm.zone);
        assert.ok(Math.abs(reprojected.eastingM - utm.eastingM) < 0.001, `${tc.name} easting round-trip < 1 mm`);
        assert.ok(Math.abs(reprojected.northingM - utm.northingM) < 0.001, `${tc.name} northing round-trip < 1 mm`);
    }

    // Verificar formato y schema para borde ecuatorial sur (Northing 8 dígitos: 10000000.00 mN)
    const eqSouthFix = CanonicalGeoFixSchema.parse(
        buildCanonicalGeoFix({
            lat: -1e-8,
            lng: -51.06,
            source: 'MANUAL_INPUT',
            capturedAt: '2026-11-14T00:00:00.000Z',
        })
    );
    assert.ok(
        eqSouthFix.utm.formatted.endsWith(' 10000000.00 mN'),
        `Esperado Northing 10000000.00 mN en borde ecuatorial sur, recibido: ${eqSouthFix.utm.formatted}`
    );

    // Verificar padding exacto de formatUtmCoordinate en zona < 10 y northing ecuatorial < 1_000_000
    const formattedEq = formatUtmCoordinate({
        zone: 5,
        band: 'N',
        eastingM: 509832.14,
        northingM: 165834.22,
    });
    assert.equal(formattedEq, '05N 509832.14 mE 0165834.22 mN');
}

function test2PmtilesV3BinarySpec(): void {
    const header: PmtilesV3Header = {
        specVersion: 3,
        rootDirectoryOffset: 127,
        rootDirectoryLength: 1024,
        jsonMetadataOffset: 1151,
        jsonMetadataLength: 256,
        leafDirectoriesOffset: 1407,
        leafDirectoriesLength: 4096,
        tileDataOffset: 5503,
        tileDataLength: 9876543210,
        addressedTilesCount: 12500,
        tileEntriesCount: 4200,
        tileContentsCount: 4100,
        clustered: true,
        internalCompression: 'GZIP',
        tileCompression: 'NONE',
        tileType: 'MVT',
        minZoom: 0,
        maxZoom: 16,
        minLon: -75.6,
        minLat: -55.9,
        maxLon: -66.4,
        maxLat: -17.5,
        centerZoom: 6,
        centerLon: -70.6693,
        centerLat: -33.4489,
    };

    const bytes = serializePmtilesV3Header(header);
    assert.equal(bytes.byteLength, PMTILES_V3_HEADER_BYTES);
    assert.equal(PMTILES_V3_HEADER_BYTES, 127);

    const parsed = parsePmtilesV3Header(bytes);
    assert.equal(parsed.specVersion, 3);
    assert.equal(parsed.rootDirectoryOffset, header.rootDirectoryOffset);
    assert.equal(parsed.tileDataLength, header.tileDataLength);
    assert.equal(parsed.addressedTilesCount, header.addressedTilesCount);
    assert.equal(parsed.clustered, true);
    assert.equal(parsed.internalCompression, 'GZIP');
    assert.equal(parsed.tileCompression, 'NONE');
    assert.equal(parsed.tileType, 'MVT');
    assert.ok(Math.abs(parsed.centerLon - header.centerLon) < 1e-6);
    assert.ok(Math.abs(parsed.centerLat - header.centerLat) < 1e-6);

    const metadata = PmtilesHeaderMetadataSchema.parse(toPmtilesHeaderMetadata(parsed));
    assert.equal(metadata.specVersion, 3);
    assert.equal(metadata.tileType, 'MVT');

    // Biyección Hilbert exhaustiva para z = 0..5
    let expectedSeq = 0;
    for (let z = 0; z <= 5; z++) {
        const size = 1 << z;
        const levelIds = new Set<number>();
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const tileId = zxyToPmtilesTileId(z, x, y);
                levelIds.add(tileId);
                const back = pmtilesTileIdToZxy(tileId);
                assert.deepEqual(back, { z, x, y }, `Hilbert round-trip falló en z=${z}, x=${x}, y=${y}`);
            }
        }
        assert.equal(levelIds.size, size * size, `Hilbert debe ser biyectivo en z=${z}`);
        for (let i = 0; i < size * size; i++) {
            assert.ok(levelIds.has(expectedSeq + i), `Hilbert z=${z} debe cubrir id secuencial ${expectedSeq + i}`);
        }
        expectedSeq += size * size;
    }

    // Muestreo z = 6..16 (incluyendo límites 2^z - 1) y z = 26 BigInt-safe
    for (let z = 6; z <= 16; z++) {
        const maxC = (1 << z) - 1;
        const samples: Array<[number, number]> = [
            [0, 0],
            [maxC, 0],
            [0, maxC],
            [maxC, maxC],
            [Math.floor(maxC / 3), Math.floor((2 * maxC) / 3)],
        ];
        for (const [x, y] of samples) {
            const tileId = zxyToPmtilesTileId(z, x, y);
            assert.equal(Number.isSafeInteger(tileId), true);
            assert.deepEqual(pmtilesTileIdToZxy(tileId), { z, x, y });
        }
    }
    const z26Id = zxyToPmtilesTileId(26, (1 << 26) - 1, 1234567);
    assert.equal(Number.isSafeInteger(z26Id), true);
    assert.deepEqual(pmtilesTileIdToZxy(z26Id), { z: 26, x: (1 << 26) - 1, y: 1234567 });

    // Directorio varint (contiguo, no contiguo, run-length y hoja)
    const dirEntries: PmtilesDirectoryEntry[] = [
        { tileId: 1, offset: 0, length: 512, runLength: 1 },
        { tileId: 2, offset: 512, length: 256, runLength: 3 }, // contiguo (se comprime offset=0) y runLength=3
        { tileId: 10, offset: 2048, length: 128, runLength: 0 }, // hoja
        { tileId: 500000, offset: 9000000000, length: 4096, runLength: 1 }, // > 4GB offset (64-bit varint)
    ];
    const encodedDir = encodePmtilesDirectory(dirEntries);
    const decodedDir = decodePmtilesDirectory(encodedDir);
    assert.deepEqual(decodedDir, dirEntries);

    assert.equal(findTileInDirectory(decodedDir, 1)?.offset, 0);
    assert.equal(findTileInDirectory(decodedDir, 3)?.tileId, 2); // dentro de runLength 3 (2,3,4)
    assert.equal(findTileInDirectory(decodedDir, 4)?.tileId, 2);
    assert.equal(findTileInDirectory(decodedDir, 5), null);
    assert.equal(findTileInDirectory(decodedDir, 15)?.runLength, 0); // cubre hoja hasta antes de 500000
    assert.equal(findTileInDirectory(decodedDir, 500000)?.offset, 9000000000);
}

async function test3GeoResolveAndCacheHit(): Promise<void> {
    const mockDb = createInMemoryFirestore();
    const origVerifyIdToken = (auth as any).verifyIdToken;
    const origCollection = (db as any).collection;

    (auth as any).verifyIdToken = async () => ({
        uid: 'uid-b2b-geo-1',
        email: 'ops@minera-andes.cl',
        email_verified: true,
    });
    (db as any).collection = mockDb.collection.bind(mockDb);

    try {
        // Rechazar sin token y payload inválido
        const unauth = await dispatchGeoRoute({
            method: 'post',
            path: '/resolve',
            body: { mode: 'FORWARD', query: 'Calama' },
        });
        assert.equal(unauth.statusCode, 401);

        const badForward = await dispatchGeoRoute({
            method: 'post',
            path: '/resolve',
            headers: { authorization: 'Bearer test-token' },
            body: { mode: 'FORWARD' },
        });
        assert.equal(badForward.statusCode, 400);

        const badReverse = await dispatchGeoRoute({
            method: 'post',
            path: '/resolve',
            headers: { authorization: 'Bearer test-token' },
            body: { mode: 'REVERSE', lat: -22.45 },
        });
        assert.equal(badReverse.statusCode, 400);

        // Forward miss -> SOVEREIGN_GAZETTEER + guardado en caché 30 días
        const beforeMs = Date.now();
        const fwdMiss = await dispatchGeoRoute({
            method: 'post',
            path: '/resolve',
            headers: { authorization: 'Bearer test-token' },
            body: { mode: 'FORWARD', query: 'Calama', countryCode: 'cl', limit: 3 },
        });
        assert.equal(fwdMiss.statusCode, 200);
        assert.equal(fwdMiss.body.ok, true);
        assert.equal(fwdMiss.body.cached, false);
        assert.match(fwdMiss.body.cacheKey, /^[a-f0-9]{64}$/);
        assert.ok(Array.isArray(fwdMiss.body.candidates) && fwdMiss.body.candidates.length >= 1);
        const firstCand = GeoResolvedCandidateSchema.parse(fwdMiss.body.candidates[0]);
        assert.equal(firstCand.provider, 'SOVEREIGN_GAZETTEER');
        assert.equal(firstCand.countryCode, 'CL');
        assert.equal(firstCand.utm.zone, 19);
        assert.equal(firstCand.utm.band, 'K');

        const cachedDoc = mockDb.docs.get(`geo_resolve_cache/${fwdMiss.body.cacheKey}`);
        assert.ok(cachedDoc, 'Debe persistir caché en geo_resolve_cache/{cacheKey}');
        assert.ok(cachedDoc.expiresAt instanceof Timestamp, 'expiresAt debe ser Firestore Timestamp');
        const expiresMs = toEpochMillis(cachedDoc.expiresAt);
        assert.ok(
            expiresMs - beforeMs >= THIRTY_DAYS_MS - 5000 && expiresMs - beforeMs <= THIRTY_DAYS_MS + 10000,
            'expiresAt debe corresponder a TTL de 30 días'
        );

        // Forward hit -> CACHE_SHA256
        const fwdHit = await dispatchGeoRoute({
            method: 'post',
            path: '/resolve',
            headers: { authorization: 'Bearer test-token' },
            body: { mode: 'FORWARD', query: '  CALAMA ', countryCode: 'CL', limit: 3 },
        });
        assert.equal(fwdHit.statusCode, 200);
        assert.equal(fwdHit.body.cached, true);
        assert.equal(fwdHit.body.cacheKey, fwdMiss.body.cacheKey);
        assert.equal(fwdHit.body.candidates[0].provider, 'CACHE_SHA256');

        // Reverse geocoding Antofagasta
        const revRes = await dispatchGeoRoute({
            method: 'post',
            path: '/resolve',
            headers: { authorization: 'Bearer test-token' },
            body: { mode: 'REVERSE', lat: -23.6509, lng: -70.3975, language: 'es', limit: 2 },
        });
        assert.equal(revRes.statusCode, 200);
        assert.equal(revRes.body.cached, false);
        assert.equal(revRes.body.candidates[0].locality, 'Antofagasta');
        assert.equal(revRes.body.candidates[0].utm.zone, 19);
        assert.equal(revRes.body.candidates[0].utm.band, 'K');
    } finally {
        (auth as any).verifyIdToken = origVerifyIdToken;
        (db as any).collection = origCollection;
    }
}

async function test4ReportStampAndPmtilesEndpoints(): Promise<void> {
    const mockDb = createInMemoryFirestore();
    const origVerifyIdToken = (auth as any).verifyIdToken;
    const origCollection = (db as any).collection;
    const origRunTransaction = (db as any).runTransaction;
    const origBucket = (storage as any).bucket;

    const ownerUid = 'uid-owner-a';
    const crossUid = 'uid-intruder-b';
    const tenantId = 'acc-minera-norte';
    const pendingTenantId = 'acc-pending-01';
    const expiredPilotUid = 'uid-expired-pilot';

    mockDb.docs.set(`accounts/${tenantId}`, {
        id: tenantId,
        ownerId: ownerUid,
        status: 'ACTIVE',
        entitlements: {
            basePackage: 'CORE_BASE',
            baseModules: { opermaq: false, stockpile: false },
        },
    });
    mockDb.docs.set(`accounts/${pendingTenantId}`, {
        id: pendingTenantId,
        ownerId: ownerUid,
        status: 'PENDING_APPROVAL',
    });
    mockDb.docs.set(`users/${ownerUid}`, {
        uid: ownerUid,
        email: 'gerencia@mineranorte.cl',
        memberships: [{ accountId: tenantId, role: 'OWNER', status: 'ACTIVE' }],
    });
    mockDb.docs.set(`users/${crossUid}`, {
        uid: crossUid,
        email: 'externo@otraempresa.cl',
        memberships: [{ accountId: 'acc-otra', role: 'OWNER', status: 'ACTIVE' }],
    });
    mockDb.docs.set(`users/${expiredPilotUid}`, {
        uid: expiredPilotUid,
        email: 'piloto@minreport.com',
        role: 'TEST_PILOT',
        pilotExpiresAt: Date.now() - 60_000,
    });

    let activeToken: Record<string, any> = {
        uid: crossUid,
        email: 'externo@otraempresa.cl',
        email_verified: true,
    };

    (auth as any).verifyIdToken = async () => activeToken;
    (db as any).collection = mockDb.collection.bind(mockDb);
    (db as any).runTransaction = mockDb.runTransaction.bind(mockDb);

    // Mock Storage con un archivo PMTiles v3 real para el caso GCS + fallback sintético para otro basemapId
    const tileBytes = Buffer.from('TILE_PAYLOAD_MVT_SOVEREIGN');
    const dirBytes = Buffer.from(
        encodePmtilesDirectory([
            { tileId: zxyToPmtilesTileId(2, 1, 2), offset: 0, length: tileBytes.length, runLength: 1 },
        ])
    );
    const hdr = serializePmtilesV3Header({
        specVersion: 3,
        rootDirectoryOffset: PMTILES_V3_HEADER_BYTES,
        rootDirectoryLength: dirBytes.length,
        jsonMetadataOffset: 0,
        jsonMetadataLength: 0,
        leafDirectoriesOffset: 0,
        leafDirectoriesLength: 0,
        tileDataOffset: PMTILES_V3_HEADER_BYTES + dirBytes.length,
        tileDataLength: tileBytes.length,
        addressedTilesCount: 1,
        tileEntriesCount: 1,
        tileContentsCount: 1,
        clustered: true,
        internalCompression: 'NONE',
        tileCompression: 'NONE',
        tileType: 'MVT',
        minZoom: 0,
        maxZoom: 12,
        minLon: -72,
        minLat: -25,
        maxLon: -67,
        maxLat: -20,
        centerZoom: 6,
        centerLon: -68.9,
        centerLat: -22.3,
    });
    const fullPmtilesArchive = Buffer.concat([Buffer.from(hdr), dirBytes, tileBytes]);

    (storage as any).bucket = () => ({
        file(objectPath: string) {
            if (objectPath === 'cas_blobs/geo_pmtiles/chile-norte.pmtiles') {
                return {
                    async exists() {
                        return [true];
                    },
                    async download(opts: { start: number; end: number }) {
                        return [fullPmtilesArchive.subarray(opts.start, opts.end + 1)];
                    },
                };
            }
            return {
                async exists() {
                    return [false];
                },
            };
        },
    });

    try {
        const sampleFix = buildCanonicalGeoFix({
            lat: -22.2889,
            lng: -68.9022,
            altitudeM: 2850,
            accuracyM: 8.5,
            capturedAt: '2026-11-14T02:00:00.000Z',
            source: 'CAPACITOR_GNSS',
        });

        // 4a. Bloqueo Cross-Tenant -> 403
        const crossRes = await dispatchGeoRoute({
            method: 'post',
            path: '/report-stamp',
            headers: { authorization: 'Bearer token', 'x-active-account-id': tenantId },
            body: {
                accountId: tenantId,
                moduleId: 'b2b-core',
                entityType: 'TENANT_HQ_LOCATION',
                entityId: tenantId,
                fix: sampleFix,
            },
        });
        assert.equal(crossRes.statusCode, 403);

        // 4b. Bloqueo cuenta PENDING_APPROVAL -> 403
        activeToken = { uid: ownerUid, email: 'gerencia@mineranorte.cl', email_verified: true };
        const pendingRes = await dispatchGeoRoute({
            method: 'post',
            path: '/report-stamp',
            headers: { authorization: 'Bearer token', 'x-active-account-id': pendingTenantId },
            body: {
                accountId: pendingTenantId,
                moduleId: 'b2b-core',
                entityType: 'TENANT_HQ_LOCATION',
                entityId: pendingTenantId,
                fix: sampleFix,
            },
        });
        assert.equal(pendingRes.statusCode, 403);

        // 4c. Bloqueo TEST_PILOT expirado -> 403
        activeToken = { uid: expiredPilotUid, email: 'piloto@minreport.com', email_verified: true, role: 'TEST_PILOT' };
        const expiredRes = await dispatchGeoRoute({
            method: 'post',
            path: '/report-stamp',
            headers: { authorization: 'Bearer token' },
            body: {
                accountId: tenantId,
                moduleId: 'test-pilot',
                entityType: 'PILOT_DRILL',
                entityId: 'drill-1',
                fix: sampleFix,
            },
        });
        assert.equal(expiredRes.statusCode, 403);

        // 4d. Emisión autorizada en Core B2B (sin entitlement opermaq/stockpile) + escape XSS en SVG + AuditLedger sin coords crudas
        activeToken = { uid: ownerUid, email: 'gerencia@mineranorte.cl', email_verified: true };
        const beforeMs = Date.now();
        const okRes = await dispatchGeoRoute({
            method: 'post',
            path: '/report-stamp',
            headers: { authorization: 'Bearer token', 'x-active-account-id': tenantId },
            body: CreateGeoReportStampBodySchema.parse({
                accountId: tenantId,
                moduleId: 'b2b-core',
                entityType: 'TENANT_HQ_LOCATION',
                entityId: tenantId,
                fix: sampleFix,
                label: '<script>alert("xss")</script> Faena',
            }),
        });
        assert.equal(okRes.statusCode, 201);
        assert.equal(okRes.body.ok, true);

        const stamp = GeoReportStampSchema.parse(okRes.body.stamp);
        assert.ok(stamp.stampId.startsWith('gst_'));
        assert.equal(stamp.accountId, tenantId);
        assert.ok(stamp.vectorCutoutSvg.includes('&lt;script&gt;'), 'Debe escapar <script> en SVG');
        assert.equal(/<script/i.test(stamp.vectorCutoutSvg), false, 'SVG jamás debe contener etiqueta <script literal');
        assert.equal(
            /https?:\/\//i.test(
                stamp.vectorCutoutSvg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/gi, '')
            ),
            false,
            'SVG jamás debe contener URLs externas'
        );

        const persistedStamp = mockDb.docs.get(`geo_report_stamps/${stamp.stampId}`);
        assert.ok(persistedStamp, 'Debe persistir sello en geo_report_stamps');
        assert.equal(persistedStamp.tenantId, tenantId);
        assert.ok(persistedStamp.retentionUntil instanceof Timestamp);
        assert.ok(toEpochMillis(persistedStamp.retentionUntil) - beforeMs >= SIX_YEARS_MIN_MS);

        const ledgerEntry = Array.from(mockDb.docs.entries()).find(
            ([k, v]) => k.startsWith('audit_ledger/') && v.action === 'GEO_REPORT_STAMP_ISSUED'
        )?.[1];
        assert.ok(ledgerEntry, 'Debe registrar asiento GEO_REPORT_STAMP_ISSUED en audit_ledger');
        assert.equal(ledgerEntry.tenantId, tenantId);
        assert.equal(ledgerEntry.details.stampId, stamp.stampId);
        assert.equal(ledgerEntry.details.epsg, 'EPSG:32719');
        assert.equal(ledgerEntry.details.lat, undefined, 'Ley 21.719: AuditLedger no debe guardar lat cruda');
        assert.equal(ledgerEntry.details.lng, undefined, 'Ley 21.719: AuditLedger no debe guardar lng cruda');
        assert.equal(ledgerEntry.details.eastingM, undefined);
        assert.equal(ledgerEntry.details.northingM, undefined);

        // 4e. Endpoints PMTiles
        const badBasemap = await dispatchGeoRoute({
            method: 'get',
            path: '/pmtiles/:basemapId/metadata',
            headers: { authorization: 'Bearer token' },
            params: { basemapId: '../evil' },
        });
        assert.equal(badBasemap.statusCode, 400);

        const metaGcs = await dispatchGeoRoute({
            method: 'get',
            path: '/pmtiles/:basemapId/metadata',
            headers: { authorization: 'Bearer token' },
            params: { basemapId: 'chile-norte' },
        });
        assert.equal(metaGcs.statusCode, 200);
        assert.equal(metaGcs.body.source, 'GCS_PMTILES_V3');
        assert.equal(metaGcs.body.metadata.tileType, 'MVT');
        assert.equal(metaGcs.headers['cache-control'], 'private, max-age=86400');

        const tileGcs = await dispatchGeoRoute({
            method: 'get',
            path: '/pmtiles/:basemapId/tile/:z/:x/:y',
            headers: { authorization: 'Bearer token' },
            params: { basemapId: 'chile-norte', z: '2', x: '1', y: '2' },
        });
        assert.equal(tileGcs.statusCode, 200);
        assert.equal(Buffer.compare(tileGcs.body, tileBytes), 0);

        const tileSynthetic = await dispatchGeoRoute({
            method: 'get',
            path: '/pmtiles/:basemapId/tile/:z/:x/:y',
            headers: { authorization: 'Bearer token' },
            params: { basemapId: 'tactico-demo', z: '4', x: '4', y: '9' },
        });
        assert.equal(tileSynthetic.statusCode, 200);
        assert.ok(String(tileSynthetic.body).includes('<svg'));
        assert.equal(tileSynthetic.headers['cache-control'], 'private, max-age=86400');
    } finally {
        (auth as any).verifyIdToken = origVerifyIdToken;
        (db as any).collection = origCollection;
        (db as any).runTransaction = origRunTransaction;
        (storage as any).bucket = origBucket;
    }
}

function test5ConfidentialityAirlockUtmAndWgs84(): void {
    const sample = [
        'Inspección faena WGS84 -22.2889, -68.9022.',
        'Coordenada sur 19K 509832.14 mE 7534912.08 mN.',
        'Coordenada ecuatorial cero inicial 18N 500000.00 mE 0165834.22 mN.',
        'Coordenada ecuatorial sin cero inicial 18N 500000.00 mE 165834.22 mN y 18N 500000.00 mE 45210.12 mN.',
        'Coordenada ecuatorial sur 8 dígitos 22M 493323.00 mE 10000000.00 mN.',
        'Equipo CAT 797F / Excavadora PC200-8 / Cargador WA380-6 / Camión 930E-5 norma ISO 7000.',
    ].join(' ');

    const { scrubbed, redactedCategories } = ConfidentialityAirlockService.scrubDeterministicPii(sample, 'CL');
    assert.equal(scrubbed.includes('-22.2889'), false, 'WGS84 debe redactarse');
    assert.equal(scrubbed.includes('509832.14'), false, 'UTM sur 19K debe redactarse');
    assert.equal(scrubbed.includes('0165834.22'), false, 'UTM ecuatorial con 0 inicial debe redactarse');
    assert.equal(scrubbed.includes('165834.22'), false, 'UTM ecuatorial 6 dígitos con mN debe redactarse');
    assert.equal(scrubbed.includes('45210.12'), false, 'UTM ecuatorial 5 dígitos con mN debe redactarse');
    assert.equal(scrubbed.includes('10000000.00'), false, 'UTM ecuatorial sur 8 dígitos (10000000.00 mN) debe redactarse');
    assert.ok(scrubbed.includes('CAT 797F'), 'Código OEM CAT 797F debe preservarse');
    assert.ok(scrubbed.includes('PC200-8'), 'Código OEM PC200-8 debe preservarse');
    assert.ok(scrubbed.includes('WA380-6'), 'Código OEM WA380-6 debe preservarse');
    assert.ok(scrubbed.includes('930E-5'), 'Código OEM 930E-5 debe preservarse');
    assert.ok(scrubbed.includes('ISO 7000'), 'Norma ISO 7000 debe preservarse');
    assert.ok(redactedCategories.includes('GPS_FAENA'));
    assert.ok(redactedCategories.includes('UTM_FAENA'));
}

function test6StaticFrontendGooglePlacesPurge(): void {
    const repoRoot = path.resolve(__dirname, '../../..');
    const googleHookPath = path.join(repoRoot, 'web/src/hooks/useGooglePlaces.ts');
    const empresaPagePath = path.join(repoRoot, 'web/src/pages/b2b/EmpresaPage.tsx');

    assert.equal(
        fs.existsSync(googleHookPath),
        false,
        'web/src/hooks/useGooglePlaces.ts debe haber sido eliminado físicamente'
    );
    const empresaContent = fs.readFileSync(empresaPagePath, 'utf8');
    assert.equal(
        empresaContent.includes('useGooglePlaces'),
        false,
        'EmpresaPage.tsx no debe referenciar useGooglePlaces'
    );
    assert.equal(
        empresaContent.includes('VITE_GOOGLE_MAPS_API_KEY'),
        false,
        'EmpresaPage.tsx no debe referenciar VITE_GOOGLE_MAPS_API_KEY'
    );
}

async function run(): Promise<void> {
    const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
        { name: 'Test 1: WGS84 <-> UTM round-trip (< 1 mm) + SHA-256 TS puro', fn: test1Wgs84UtmRoundTripAndSha256 },
        { name: 'Test 2: PMTiles v3 (127B header, Hilbert z=0..26, varint dir)', fn: test2PmtilesV3BinarySpec },
        { name: 'Test 3: POST /api/geo/resolve forward/reverse + caché SHA-256 30d', fn: test3GeoResolveAndCacheHit },
        { name: 'Test 4: POST /api/geo/report-stamp + PMTiles endpoints', fn: test4ReportStampAndPmtilesEndpoints },
        { name: 'Test 5: ConfidentialityAirlockService redacta WGS84 y UTM ecuatorial', fn: test5ConfidentialityAirlockUtmAndWgs84 },
        { name: 'Test 6: Verificación estática purga useGooglePlaces en web/', fn: test6StaticFrontendGooglePlacesPurge },
    ];

    let passed = 0;
    let failed = 0;

    for (const t of tests) {
        try {
            await t.fn();
            console.log(`PASS: ${t.name}`);
            passed++;
        } catch (err: any) {
            console.error(`FAIL: ${t.name}`);
            console.error(err?.stack || err);
            failed++;
        }
    }

    console.log(`\nResumen Bloque 3.2: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

void run().then(() => {
    process.exit(0);
});
