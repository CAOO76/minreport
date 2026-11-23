/**
 * MINREPORT · ABASTECIMIENTO — V3-E04 Bodegas y Estanques Físicos, Kardex Transaccional, Recepción 4-Way y KPIs Mineros
 *
 * Verifica de forma determinista (Node v20.19.5, cero red):
 * 1. CRUD `supply_warehouses` (11 clases soportadas, HITL `"ACTUALIZAR"`, RBAC `VIEWER` 403).
 * 2. Guardrail DS 594 Art. 14 + DS 28 calculado EXCLUSIVAMENTE desde `POTABLE_WATER_TANK` (jamás suma `INDUSTRIAL_WATER_POND`).
 * 3. Kardex transaccional (`supply_stock_ledger` + `supply_warehouse_balances`):
 *    - PMP neto aterrizado ponderado
 *    - Orden FEFO de lotes/vencimientos
 *    - Salidas flota exigiendo `linkedAssetId` + `horometer` (`L/hr`)
 *    - Cilindros `fullCount`/`emptyCount` en `GLP_CAGE`
 *    - Traspaso atómico `TRANSFER_OUT` + `TRANSFER_IN` con `transferGroupId` y rechazo `409` por stock insuficiente
 * 4. Aforos por varilla `CYCLE_COUNT_ADJUSTMENT` bajo HITL `"ACTUALIZAR"`: alerta automática si >2.5% combustible o >0% polvorín DGMN.
 * 5. Recepción parcial / mermas 4-Way (`POST /api/supply/warehouses/receptions` y Flow `MINREPORT_WAREHOUSE_4WAY`):
 *    persiste discrepancias en `supply_reception_discrepancies` y activa alerta RCV urgente (`<= 3` días) + sugerencia NC 61.
 * 6. 3 drivers ROP (`PER_PAX`, `PER_ASSET_HOUR`, `DAILY_SITE_OR_MINMAX` con factor cordillera) y KPIs por unidad de negocio sin contaminación CAPEX/aseo.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express, { type Express } from 'express';

process.env.NODE_ENV = 'test';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.GCP_PROJECT_ID ||= 'minreport-supply-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-supply-test';

// ---------------------------------------------------------------------------
// 1. In-Memory Firebase Stub
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

function compareValues(aVal: unknown, bVal: unknown): number {
    if (aVal === bVal) return 0;
    if (aVal === undefined || aVal === null) return -1;
    if (bVal === undefined || bVal === null) return 1;
    if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
    return String(aVal).localeCompare(String(bVal));
}

function createQueryChain(
    colPaths: string[],
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    orders: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
    maxLimit = 1000
): any {
    return {
        where(field: string, op: string, value: unknown) {
            return createQueryChain(colPaths, [...filters, { field, op, value }], orders, maxLimit);
        },
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
            return createQueryChain(colPaths, filters, [...orders, { field, dir }], maxLimit);
        },
        limit(n: number) {
            return createQueryChain(colPaths, filters, orders, n);
        },
        async get() {
            const matched: Array<{ id: string; colPath: string; data: Record<string, any> }> = [];
            for (const colPath of colPaths) {
                for (const [id, data] of getCollectionMap(colPath).entries()) {
                    const ok = filters.every((f) =>
                        f.op === '==' ? data[f.field] === f.value : true
                    );
                    if (ok) matched.push({ id, colPath, data });
                }
            }
            if (orders.length > 0) {
                matched.sort((a, b) => {
                    for (const ord of orders) {
                        const cmp = compareValues(a.data[ord.field], b.data[ord.field]);
                        if (cmp !== 0) return ord.dir === 'desc' ? -cmp : cmp;
                    }
                    return 0;
                });
            }
            const sliced = matched.slice(0, maxLimit).map((m) => ({
                id: m.id,
                ref: createDocRef(m.colPath, m.id),
                exists: true,
                data: () => JSON.parse(JSON.stringify(m.data)),
            }));
            return { empty: sliced.length === 0, size: sliced.length, docs: sliced };
        },
    };
}

function createCollectionRef(colPath: string): any {
    let autoSeq = 1;
    return {
        doc(docId?: string) {
            const id = docId || `auto_${Date.now()}_${autoSeq++}`;
            return createDocRef(colPath, id);
        },
        async add(payload: Record<string, any>) {
            const id = `add_${Date.now()}_${autoSeq++}`;
            const ref = createDocRef(colPath, id);
            await ref.set(payload);
            return ref;
        },
        where(field: string, op: string, value: unknown) {
            return createQueryChain([colPath], [{ field, op, value }]);
        },
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
            return createQueryChain([colPath], [], [{ field, dir }]);
        },
        limit(n: number) {
            return createQueryChain([colPath], [], [], n);
        },
        async get() {
            return createQueryChain([colPath]).get();
        },
    };
}

const mockDb: any = {
    collection(colName: string) {
        return createCollectionRef(colName);
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

const mockTokens = new Map<string, Record<string, any>>();
const mockAuth: any = {
    async verifyIdToken(token: string) {
        const payload = mockTokens.get(token);
        if (!payload) throw new Error('auth/invalid-token');
        return payload;
    },
};

const mockAdmin: any = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: Object.assign(() => mockDb, {
        FieldValue: {
            serverTimestamp: () => Date.now(),
            increment: (n: number) => ({ __inc: n }),
        },
        Timestamp: {
            fromMillis: (ms: number) => ({ toMillis: () => ms }),
        },
    }),
    auth: () => mockAuth,
};

const firebaseResolved = require.resolve(path.resolve(__dirname, '../../../config/firebase'));
require.cache[firebaseResolved] = {
    id: firebaseResolved,
    filename: firebaseResolved,
    loaded: true,
    exports: { __esModule: true, default: mockAdmin, db: mockDb, auth: mockAuth, storage: {} },
} as any;

import {
    createSignedFlowToken,
    resolveFlowTokenSigningSecret,
} from '../adapters/WhatsAppFlowsCrypto';
import { SUPPLY_COLLECTIONS, SupplyRepository } from '../application/SupplyRepository';
import { SupplyFlowsHandler } from '../channels/supply.flows';
import { calculateDynamicReorderPoint } from '../domain/DemandAndCostForecaster';
import { registerSupplyModuleRoutes } from '../index';

async function dispatchJson(
    app: Express,
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body?: unknown
): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
        const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } }) as any;
        socket.remoteAddress = '127.0.0.1';
        socket.encrypted = false;

        const req = new http.IncomingMessage(socket);
        req.method = method;
        req.url = urlPath;
        const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
        req.headers = { host: 'localhost' };
        for (const [k, v] of Object.entries(headers)) {
            req.headers[k.toLowerCase()] = v;
        }
        if (payload && !req.headers['content-type']) {
            req.headers['content-type'] = 'application/json';
            req.headers['content-length'] = String(payload.length);
        }

        const res = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);
        (res as any).write = (chunk: any, enc?: any, cb?: any) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
            return origWrite(chunk, enc, cb);
        };
        (res as any).end = (chunk?: any, enc?: any, cb?: any) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: any = raw;
            try {
                parsed = raw ? JSON.parse(raw) : {};
            } catch {
                // fallback raw
            }
            const out = origEnd(chunk, enc, cb);
            resolve({ status: res.statusCode, json: parsed });
            return out;
        };

        (app as any).handle(req as any, res as any, (err: any) => {
            if (err) reject(err);
        });
        process.nextTick(() => {
            if (payload) req.push(payload);
            req.push(null);
        });
    });
}

// ---------------------------------------------------------------------------
// 2. Suite V3-E04
// ---------------------------------------------------------------------------

async function runTests() {
    dbCollections.clear();
    const TENANT_ID = 'tenant-v3-e04';
    const SITE_ID = 'FAENA-CORDILLERA';
    const ADMIN_UID = 'uid-admin-e04';
    const VIEWER_UID = 'uid-viewer-e04';
    const KEEPER_UID = 'uid-keeper-e04';

    await mockDb.collection('accounts').doc(TENANT_ID).set({
        id: TENANT_ID,
        accountId: TENANT_ID,
        name: 'Faena Cordillera V3 E04 SpA',
        status: 'ACTIVE',
        ownerId: ADMIN_UID,
        contract: { status: 'ACTIVE', activeModules: { supply: true, opermaq: true, stockpile: true } },
    });
    await mockDb.collection('users').doc(ADMIN_UID).set({
        uid: ADMIN_UID,
        email: 'admin.e04@minreport.cl',
        role: 'OWNER',
        memberships: [{ accountId: TENANT_ID, role: 'OWNER', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('users').doc(VIEWER_UID).set({
        uid: VIEWER_UID,
        email: 'viewer.e04@minreport.cl',
        role: 'VIEWER',
        memberships: [{ accountId: TENANT_ID, role: 'VIEWER', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('users').doc(KEEPER_UID).set({
        uid: KEEPER_UID,
        email: 'bodega.e04@minreport.cl',
        role: 'OPERATOR',
        memberships: [{ accountId: TENANT_ID, role: 'OPERATOR', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await mockDb.collection('accounts').doc(TENANT_ID).collection('members').doc(KEEPER_UID).set({
        uid: KEEPER_UID,
        accountId: TENANT_ID,
        role: 'OPERATOR',
        status: 'ACTIVE',
        displayName: 'Bodeguero Turno E04',
        email: 'bodega.e04@minreport.cl',
        phoneE164: '+56900004401',
        whatsappOptInAt: '2026-06-01T10:00:00.000Z',
        supplyProfile: {
            role: 'WAREHOUSE_KEEPER',
            assignedSiteIds: [SITE_ID],
            defaultCostCenter: 'CC-OPS-MINA',
        },
    });

    mockTokens.set('tok-admin', {
        uid: ADMIN_UID,
        email: 'admin.e04@minreport.cl',
        email_verified: true,
        activeAccountId: TENANT_ID,
    });
    mockTokens.set('tok-viewer', {
        uid: VIEWER_UID,
        email: 'viewer.e04@minreport.cl',
        email_verified: true,
        activeAccountId: TENANT_ID,
    });
    mockTokens.set('tok-keeper', {
        uid: KEEPER_UID,
        email: 'bodega.e04@minreport.cl',
        email_verified: true,
        activeAccountId: TENANT_ID,
    });

    await SupplyRepository.upsertSite(
        TENANT_ID,
        {
            siteId: SITE_ID,
            name: 'Faena Cordillera 3500m',
            districtCode: 'ATACAMA-ALTA',
            geoFix: { latitude: -27.1, longitude: -69.2, altitudeM: 3500 },
            shiftPattern: '7x7',
            currentHeadcount: 45,
            waterStorageCapacityL: 60_000,
            ds594DailyWaterTargetLPerPax: 120,
            leadTimeDays: 7,
            marketplaceOptIn: false,
            roleMismatchMode: 'FLAG_AND_ACCEPT',
            directPurchaseAlertThresholdClp: 500_000,
        },
        { actorUid: ADMIN_UID, actorEmail: 'admin.e04@minreport.cl' }
    );

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    registerSupplyModuleRoutes(app);

    // -----------------------------------------------------------------------
    // Test 1: CRUD Bodegas Físicas + RBAC VIEWER 403 + HITL
    // -----------------------------------------------------------------------
    console.log('Test 1: CRUD supply_warehouses + RBAC VIEWER 403...');
    const viewerForbidden = await dispatchJson(
        app,
        'POST',
        '/api/supply/warehouses',
        { authorization: 'Bearer tok-viewer' },
        {
            siteId: SITE_ID,
            code: 'WH-VIEWER',
            name: 'Bloqueada',
            warehouseClass: 'DRY_WAREHOUSE',
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(viewerForbidden.status, 403);

    const whDefinitions = [
        {
            warehouseId: 'wh_potable',
            siteId: SITE_ID,
            code: 'TK-AGUA-POT-01',
            name: 'Estanque Agua Potable Campamento',
            warehouseClass: 'POTABLE_WATER_TANK',
            allowedChannelIds: ['CH_CAMP_POTABLE_WATER'],
            defaultCostCenter: 'CC-CAMP-AGUA',
            capacityUnitSi: 'L',
            maxCapacitySi: 60_000,
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_industrial_water',
            siteId: SITE_ID,
            code: 'PISC-IND-01',
            name: 'Piscina Agua Industrial Proceso',
            warehouseClass: 'INDUSTRIAL_WATER_POND',
            allowedChannelIds: ['CH_OPS_IND_WATER'],
            defaultCostCenter: 'CC-OPS-AGUA-IND',
            capacityUnitSi: 'L',
            maxCapacitySi: 1_000_000,
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_fuel_fleet',
            siteId: SITE_ID,
            code: 'TK-DIESEL-FLOTA',
            name: 'Estanque Diésel Flota SEC TC4',
            warehouseClass: 'FUEL_TANK_FLEET',
            allowedChannelIds: ['CH_OPS_FLEET_FUEL'],
            defaultCostCenter: 'CC-FLOTA-COMBUSTIBLE',
            capacityUnitSi: 'L',
            maxCapacitySi: 50_000,
            secTc4Code: 'SEC-TC4-2026-0091',
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_fuel_camp',
            siteId: SITE_ID,
            code: 'TK-DIESEL-CAMP',
            name: 'Estanque Diésel Generador Campamento',
            warehouseClass: 'FUEL_TANK_CAMP',
            allowedChannelIds: ['CH_CAMP_FUEL'],
            defaultCostCenter: 'CC-CAMP-ENERGIA',
            capacityUnitSi: 'L',
            maxCapacitySi: 15_000,
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_glp',
            siteId: SITE_ID,
            code: 'JAULA-GLP-01',
            name: 'Jaula Cilindros GLP Campamento',
            warehouseClass: 'GLP_CAGE',
            allowedChannelIds: ['CH_CAMP_GLP_GAS'],
            defaultCostCenter: 'CC-CAMP-ENERGIA',
            capacityUnitSi: 'kg',
            maxCapacitySi: 4_500,
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_dry',
            siteId: SITE_ID,
            code: 'BOD-SECA-01',
            name: 'Bodega Seca Principal',
            warehouseClass: 'DRY_WAREHOUSE',
            allowedChannelIds: ['CH_CAMP_FOOD', 'CH_OPS_PARTS_LUBES'],
            defaultCostCenter: 'CC-CAMP-ALIMENTACION',
            capacityUnitSi: 'kg',
            maxCapacitySi: 10_000,
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_cold',
            siteId: SITE_ID,
            code: 'CAM-FRIO-01',
            name: 'Cámara Frío Campamento',
            warehouseClass: 'COLD_STORAGE',
            allowedChannelIds: ['CH_CAMP_FOOD'],
            defaultCostCenter: 'CC-CAMP-ALIMENTACION',
            capacityUnitSi: 'kg',
            maxCapacitySi: 5_000,
            confirmationKeyword: 'ACTUALIZAR',
        },
        {
            warehouseId: 'wh_dgmn',
            siteId: SITE_ID,
            code: 'POLV-DGMN-01',
            name: 'Polvorín Autorizado DGMN',
            warehouseClass: 'MAGAZINE_DGMN',
            allowedChannelIds: ['CH_CONTROLLED_DGMN'],
            defaultCostCenter: 'CC-OPS-TRONADURA',
            capacityUnitSi: 'un',
            maxCapacitySi: 2_000,
            dgmnResolutionCode: 'RES-DGMN-AT-441/2026',
            confirmationKeyword: 'ACTUALIZAR',
        },
    ];
    for (const wh of whDefinitions) {
        const res = await dispatchJson(
            app,
            'POST',
            '/api/supply/warehouses',
            { authorization: 'Bearer tok-admin' },
            wh
        );
        assert.equal(res.status, 200, `Failed creating warehouse ${wh.warehouseId}: ${JSON.stringify(res.json)}`);
    }

    const whListRes = await dispatchJson(
        app,
        'GET',
        `/api/supply/warehouses?siteId=${SITE_ID}`,
        { authorization: 'Bearer tok-keeper' }
    );
    assert.equal(whListRes.status, 200);
    assert.equal(whListRes.json.count, 8);

    // -----------------------------------------------------------------------
    // Test 2: DS 594 exclusivo desde `POTABLE_WATER_TANK` (jamás `INDUSTRIAL_WATER_POND`)
    // -----------------------------------------------------------------------
    console.log('Test 2: Guardrail DS 594 solo suma POTABLE_WATER_TANK...');
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_industrial_water',
            canonicalSkuId: 'SKU-AGUA-INDUSTRIAL',
            categoryCode: 'AGUA_INDUSTRIAL',
            procurementBucket: 'AGUA_INDUSTRIAL_ALJIBE',
            unitSi: 'L',
            movementType: 'DIRECT_RECEIPT',
            qtySi: 500_000,
            unitCostNetClp: 12,
        }
    );
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_potable',
            canonicalSkuId: 'SKU-AGUA-BIDON',
            categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
            procurementBucket: 'AGUA_POTABLE',
            unitSi: 'L',
            movementType: 'DIRECT_RECEIPT',
            qtySi: 2_000,
            unitCostNetClp: 250,
        }
    );

    const forecasts = await SupplyRepository.computeForecastReadOnly(TENANT_ID, SITE_ID);
    assert.equal(forecasts.length, 1);
    assert.equal(forecasts[0].availableWaterL, 2_000, 'DS 594 NO debe sumar 500.000 L de piscina industrial');
    assert.equal(forecasts[0].ds594Compliant, false);
    assert.equal(forecasts[0].altitudeMultiplier, 1.2);

    // -----------------------------------------------------------------------
    // Test 3: Kardex PMP neto, flota con horómetro, GLP cilindros y traspaso atómico
    // -----------------------------------------------------------------------
    console.log('Test 3: Kardex PMP neto, flota horómetro, GLP cilindros y traspaso atómico...');
    // PMP ponderado en combustible flota: 1000 L @ 900 + 1000 L @ 1100 -> PMP = 1000
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
            procurementBucket: 'COMBUSTIBLE_GRANEL',
            unitSi: 'L',
            movementType: 'DIRECT_RECEIPT',
            qtySi: 1_000,
            unitCostNetClp: 900,
        }
    );
    const secondFuelIn = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
            procurementBucket: 'COMBUSTIBLE_GRANEL',
            unitSi: 'L',
            movementType: 'DIRECT_RECEIPT',
            qtySi: 1_000,
            unitCostNetClp: 1_100,
        }
    );
    assert.equal(secondFuelIn.status, 200);
    assert.equal(secondFuelIn.json.originBalance.pmpNetClp, 1_000);

    // Salida flota sin horómetro -> 400
    const missingHorometer = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
            unitSi: 'L',
            movementType: 'ISSUE_CONSUMPTION',
            qtySi: 500,
            linkedAssetId: 'CAEX-01',
        }
    );
    assert.equal(missingHorometer.status, 400);

    // Dos salidas flota con horómetro (delta 10 hrs, total 1000 L => 100 L/hr; saldo restante = 1000 L)
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
            unitSi: 'L',
            movementType: 'ISSUE_CONSUMPTION',
            qtySi: 500,
            linkedAssetId: 'CAEX-01',
            horometer: 10_200,
        }
    );
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
            unitSi: 'L',
            movementType: 'ISSUE_CONSUMPTION',
            qtySi: 500,
            linkedAssetId: 'CAEX-01',
            horometer: 10_210,
        }
    );

    // GLP cilindros fullCount / emptyCount
    const glpReturn = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_glp',
            canonicalSkuId: 'SKU-GAS-GLP45',
            categoryCode: 'GAS_DOMESTICO_GLP',
            procurementBucket: 'GAS_GLP_DOMESTICO',
            unitSi: 'kg',
            movementType: 'RETURN_TO_WAREHOUSE',
            qtySi: 450,
            unitCostNetClp: 1_500,
            fullCount: 10,
            emptyCount: 4,
        }
    );
    assert.equal(glpReturn.status, 200);
    assert.equal(glpReturn.json.originBalance.fullCount, 10);
    assert.equal(glpReturn.json.originBalance.emptyCount, 4);

    // Traspaso atómico wh_dry -> wh_cold (SKU-SUP-ARROZ) + rechazo 409 por sobre-consumo
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_dry',
            canonicalSkuId: 'SKU-SUP-ARROZ',
            categoryCode: 'VIVERES_ALIMENTACION',
            procurementBucket: 'SUPERMERCADO',
            unitSi: 'kg',
            movementType: 'DIRECT_RECEIPT',
            qtySi: 100,
            unitCostNetClp: 1_200,
            lotNumber: 'LOTE-ARROZ-01',
            expiryDateIso: '2026-11-30',
        }
    );
    const overTransfer = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_dry',
            toWarehouseId: 'wh_cold',
            canonicalSkuId: 'SKU-SUP-ARROZ',
            movementType: 'TRANSFER_OUT',
            qtySi: 250,
        }
    );
    assert.equal(overTransfer.status, 409);

    const atomicTransfer = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_dry',
            toWarehouseId: 'wh_cold',
            canonicalSkuId: 'SKU-SUP-ARROZ',
            categoryCode: 'VIVERES_ALIMENTACION',
            procurementBucket: 'SUPERMERCADO',
            unitSi: 'kg',
            movementType: 'TRANSFER_OUT',
            qtySi: 40,
            lotNumber: 'LOTE-ARROZ-01',
            expiryDateIso: '2026-11-30',
        }
    );
    assert.equal(atomicTransfer.status, 200);
    assert.ok(atomicTransfer.json.transferGroupId);
    assert.equal(atomicTransfer.json.entries.length, 2);
    assert.equal(atomicTransfer.json.entries[0].movementType, 'TRANSFER_OUT');
    assert.equal(atomicTransfer.json.entries[1].movementType, 'TRANSFER_IN');
    assert.equal(atomicTransfer.json.originBalance.qtyOnHand, 60);
    assert.equal(atomicTransfer.json.destinationBalance.qtyOnHand, 40);
    assert.equal(atomicTransfer.json.destinationBalance.pmpNetClp, 1_200);

    // -----------------------------------------------------------------------
    // Test 4: Aforo varilla (`CYCLE_COUNT_ADJUSTMENT`): >2.5% combustible y >0% polvorín DGMN
    // -----------------------------------------------------------------------
    console.log('Test 4: Aforo CYCLE_COUNT_ADJUSTMENT (>2.5% combustible, >0% polvorín DGMN)...');
    // Saldo combustible actual = 1000 L. Medición 985 L -> 1.5% varianza (nominal, sin alerta)
    const nominalAforo = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            measuredLevelSi: 985,
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(nominalAforo.status, 200);
    assert.equal(nominalAforo.json.telemetry.anomalyFlag, false);
    assert.equal(nominalAforo.json.anomalyAlertCode, null);

    // Medición 900 L sobre 985 L -> 8.63% varianza (> 2.5%!) -> alerta automática
    const fuelAnomalyAforo = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_fuel_fleet',
            canonicalSkuId: 'SKU-COMB-DIESEL',
            measuredLevelSi: 900,
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(fuelAnomalyAforo.status, 200);
    assert.equal(fuelAnomalyAforo.json.telemetry.anomalyFlag, true);
    assert.equal(fuelAnomalyAforo.json.anomalyAlertCode, 'FUEL_TANK_VARIANCE_OVER_2_5_PCT');

    // Polvorín DGMN: 100 detonadores -> aforo 99 detonadores (1% > 0%!) -> alerta CRITICAL DGMN
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-admin' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_dgmn',
            canonicalSkuId: 'SKU-EXP-DETONADOR',
            categoryCode: 'EXPLOSIVOS_REGULADO',
            procurementBucket: 'CONTROLADOS_DGMN',
            unitSi: 'un',
            movementType: 'DIRECT_RECEIPT',
            qtySi: 100,
            unitCostNetClp: 4_500,
        }
    );
    const dgmnAnomalyAforo = await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-admin' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_dgmn',
            canonicalSkuId: 'SKU-EXP-DETONADOR',
            measuredLevelSi: 99,
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(dgmnAnomalyAforo.status, 200);
    assert.equal(dgmnAnomalyAforo.json.telemetry.anomalyFlag, true);
    assert.equal(dgmnAnomalyAforo.json.anomalyAlertCode, 'DGMN_MAGAZINE_VARIANCE_ALERT');

    // -----------------------------------------------------------------------
    // Test 5: Recepción Parcial + Merma 4-Way (`supply_reception_discrepancies` + RCV 8d)
    // -----------------------------------------------------------------------
    console.log('Test 5: Recepción Parcial + Merma 4-Way y Flow MINREPORT_WAREHOUSE_4WAY...');
    // Compra DTE 33 emitida hace 6 días (quedan <= 2 días para RCV 8d!) con 100 kg fideos en tránsito
    const issueSixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const createdPurchase = await SupplyRepository.createPurchaseWithReconciliation(
        {
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            buyerUid: ADMIN_UID,
            buyerRole: 'OWNER_EXEC',
            purchaseMode: 'DIRECT_AUTONOMOUS',
            authorizedByAuthority: true,
            supplierTaxId: '76.123.456-0',
            supplierName: 'Distribuidora Atacama Ltda',
            documentType: 33,
            folio: 90441,
            issueDate: issueSixDaysAgo,
            netAmountClp: 150_000,
            vatAmountClp: 28_500,
            totalAmountClp: 178_500,
            paymentMethod: 'TRANSFERENCIA',
            lines: [
                {
                    purchaseLineId: 'pline_e04_1',
                    canonicalSkuId: 'SKU-SUP-TALLARINES',
                    description: 'Tallarines campamento',
                    categoryCode: 'VIVERES_ALIMENTACION',
                    procurementBucket: 'SUPERMERCADO',
                    unitSi: 'kg',
                    qtyPurchased: 100,
                    unitPriceClp: 1_500,
                    subtotalClp: 150_000,
                    linePricingBasis: 'NET',
                    destination: 'STOCK_IN_TRANSIT',
                    costCenter: 'CC-CAMP-ALIMENTACION',
                    isCapexAsset: false,
                },
            ],
        },
        { actorUid: ADMIN_UID, actorEmail: 'admin.e04@minreport.cl' }
    );

    const recRes = await dispatchJson(
        app,
        'POST',
        '/api/supply/warehouses/receptions',
        { authorization: 'Bearer tok-keeper' },
        {
            purchaseId: createdPurchase.purchase.purchaseId,
            warehouseId: 'wh_dry',
            receivedLines: [
                {
                    purchaseLineId: 'pline_e04_1',
                    qtyReceivedNow: 80,
                    shrinkageQty: 5,
                    shrinkageReason: 'Envases rotos en transporte',
                    lotNumber: 'LOTE-FID-88',
                    expiryDateIso: '2026-12-20',
                },
            ],
            confirmationKeyword: 'ACTUALIZAR',
        }
    );
    assert.equal(recRes.status, 200, `Reception failed: ${JSON.stringify(recRes.json)}`);
    assert.equal(recRes.json.receptionOutcome, 'PARTIAL_DISCREPANCY');
    assert.equal(recRes.json.discrepancies.length, 1);
    assert.equal(recRes.json.discrepancies[0].shortageQty, 20);
    assert.equal(recRes.json.discrepancies[0].shrinkageQty, 5);
    assert.equal(recRes.json.urgentRcvAlert, true);
    assert.equal(recRes.json.suggestCreditNote61, true);

    // Verificar persistencia real en `supply_reception_discrepancies` y saldo neto (80 - 5 = 75 kg) en wh_dry
    const discSnap = await mockDb.collection(SUPPLY_COLLECTIONS.RECEPTION_DISCREPANCIES).get();
    assert.equal(discSnap.docs.length, 1);
    const whDryBalances = await SupplyRepository.listWarehouseBalances(TENANT_ID, {
        siteId: SITE_ID,
        warehouseId: 'wh_dry',
        canonicalSkuId: 'SKU-SUP-TALLARINES',
    });
    assert.equal(whDryBalances[0].qtyOnHand, 75);

    // Segunda recepción parcial vía WhatsApp Flow `MINREPORT_WAREHOUSE_4WAY` por los 20 kg restantes
    const flowSecret = (await resolveFlowTokenSigningSecret()) || 'test_flow_hmac_secret_2026';
    const flowToken = createSignedFlowToken(
        {
            flowType: 'RECEPTION_4WAY',
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            memberUid: KEEPER_UID,
            expiresAtMs: Date.now() + 600_000,
        },
        flowSecret
    );
    const flowRecRes = await SupplyFlowsHandler.handle(
        {
            version: '3.0',
            action: 'data_exchange',
            flow_token: flowToken,
            data: {
                purchase_id: createdPurchase.purchase.purchaseId,
                warehouse_id: 'wh_dry',
                received_lines: [
                    {
                        purchaseLineId: 'pline_e04_1',
                        qtyReceivedNow: 20,
                        shrinkageQty: 0,
                        lotNumber: 'LOTE-FID-89',
                    },
                ],
            },
        },
        { tokenSecret: flowSecret }
    );
    assert.equal(flowRecRes.screen, 'SUCCESS');
    assert.equal(flowRecRes.data.receptionStatus, 'RECEIVED');

    // -----------------------------------------------------------------------
    // Test 6: 3 Drivers ROP & KPIs por Unidad de Negocio sin contaminación CAPEX/Aseo
    // -----------------------------------------------------------------------
    console.log('Test 6: 3 Drivers ROP y KPIs Mineros por Unidad de Negocio...');
    const siteForRop = {
        siteId: SITE_ID,
        tenantId: TENANT_ID,
        name: 'Cordillera',
        districtCode: 'ATACAMA-ALTA',
        altitudeMeters: 3500,
        shiftPattern: '7x7',
        currentHeadcount: 45,
        waterStorageCapacityL: 60_000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
        marketplaceOptIn: false,
    };
    const ropPax = calculateDynamicReorderPoint({
        canonicalSkuId: 'SKU-AGUA-BIDON',
        categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
        unitSi: 'L',
        site: siteForRop,
        currentWarehouseStockSi: 2_000,
        currentInTransitStockSi: 0,
        ewmaDailyPerPaxSi: 50, // DS 594 * DS 28 (120 * 1.2 = 144) debe mandar sobre 50!
    });
    assert.equal(ropPax.driver, 'PER_PAX');
    assert.equal(ropPax.isCritical, true);
    assert.equal(ropPax.mountainFactorApplied, 1.2);

    const ropAsset = calculateDynamicReorderPoint({
        canonicalSkuId: 'SKU-COMB-DIESEL',
        categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
        unitSi: 'L',
        site: siteForRop,
        currentWarehouseStockSi: 900,
        currentInTransitStockSi: 0,
        activeAssetCount: 2,
        avgDailyHoursPerAsset: 10,
        consumptionPerAssetHourSi: 25,
    });
    assert.equal(ropAsset.driver, 'PER_ASSET_HOUR');
    assert.equal(ropAsset.dailyDemandSi, 500);
    assert.equal(ropAsset.mountainFactorApplied, 1.25);

    const ropSite = calculateDynamicReorderPoint({
        canonicalSkuId: 'SKU-FER-CEMENTO',
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        unitSi: 'kg',
        site: siteForRop,
        currentWarehouseStockSi: 500,
        currentInTransitStockSi: 0,
        ewmaDailySiteSi: 80,
        minStockSi: 200,
    });
    assert.equal(ropSite.driver, 'DAILY_SITE_OR_MINMAX');
    assert.equal(ropSite.mountainFactorApplied, 1.25);

    // Sembramos gastos de ASEO_HIGIENE y CAPEX para verificar que NO contaminan foodOpex30dClp ni foodOpexPerPaxDayClp
    await SupplyRepository.recordCashLedgerEntry(
        {
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            paymentMethod: 'TRANSFERENCIA',
            direction: 'EXPENSE_RENDERED',
            amountClp: 200_000,
            netAmountClp: 168_067,
            vatCreditClp: 31_933,
            isCapex: false,
            categoryCode: 'ASEO_HIGIENE',
            costCenter: 'CC-CAMP-MANTENCION',
            referenceId: 'aseo-test-01',
            actorUid: ADMIN_UID,
            description: 'Cloro y detergentes campamento',
        },
        { actorUid: ADMIN_UID, actorEmail: 'admin.e04@minreport.cl' }
    );
    await SupplyRepository.recordCashLedgerEntry(
        {
            tenantId: TENANT_ID,
            siteId: SITE_ID,
            paymentMethod: 'TRANSFERENCIA',
            direction: 'EXPENSE_RENDERED',
            amountClp: 3_000_000,
            netAmountClp: 2_521_008,
            vatCreditClp: 478_992,
            isCapex: true,
            categoryCode: 'ACTIVO_EQUIPAMIENTO',
            costCenter: 'CC-CAPEX',
            referenceId: 'capex-test-01',
            actorUid: ADMIN_UID,
            description: 'Cocina industrial CAPEX',
        },
        { actorUid: ADMIN_UID, actorEmail: 'admin.e04@minreport.cl' }
    );

    // Despacho agua industrial 50 m3 (50.000 L) y consultar KPIs con tonnage = 1000 t
    await dispatchJson(
        app,
        'POST',
        '/api/supply/kardex',
        { authorization: 'Bearer tok-keeper' },
        {
            siteId: SITE_ID,
            warehouseId: 'wh_industrial_water',
            canonicalSkuId: 'SKU-AGUA-INDUSTRIAL',
            categoryCode: 'AGUA_INDUSTRIAL',
            unitSi: 'L',
            movementType: 'ISSUE_CONSUMPTION',
            qtySi: 50_000,
        }
    );

    const kpisRes = await dispatchJson(
        app,
        'GET',
        `/api/supply/kpis?siteId=${SITE_ID}&tonnage=1000`,
        { authorization: 'Bearer tok-admin' }
    );
    assert.equal(kpisRes.status, 200);
    const kpis = kpisRes.json.kpis;
    // La única compra alimentaria fue de $150.000 neto -> foodOpex30dClp debe ser EXACTAMENTE 150.000 (sin aseo 168.067 ni CAPEX 2.521.008!)
    assert.equal(kpis.camp.foodOpex30dClp, 150_000);
    assert.equal(kpis.camp.potableWaterWarehouseL, 2_000);
    assert.equal(kpis.fleetAndWorkshop.fleetAvgLitersPerHour, 100);
    assert.equal(kpis.fleetAndWorkshop.tankAnomalyCount, 2);
    assert.equal(kpis.fleetAndWorkshop.cylinderFullCount, 10);
    assert.equal(kpis.fleetAndWorkshop.cylinderEmptyCount, 4);
    assert.equal(kpis.mineAndPlant.industrialWaterM3PerTon, 0.05);
    assert.equal(kpis.financeSii.capexInOpexCount, 0);
    assert.equal(kpis.financeSii.capexLeakagePct, 0);
    assert.ok(kpis.ropSummary.totalEvaluatedSkus >= 4);

    console.log('ALL V3-E04 WAREHOUSE, KARDEX & MINING KPIS TESTS PASSED');
}

runTests().catch((err) => {
    console.error('V3-E04 TEST FAILED:', err);
    process.exit(1);
});
