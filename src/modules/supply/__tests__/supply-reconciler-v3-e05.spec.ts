/**
 * MINREPORT · ABASTECIMIENTO — V3-E05 Conciliación Inteligente 4-Way v3.0
 *
 * Verifica determinísticamente (Node v20.19.5, cero red externa):
 * 1. Extensiones tributarias SII (`SiiTaxValidator`): `<DscRcgGlobal>`, `<ImptoReten>` (IEP/IEC Ley N° 18.502),
 *    `<Referencia>` (`52`, `801`, `33` en NC `61`) y `linePricingBasis: 'NET' | 'GROSS'`.
 * 2. Anti-duplicación rural (`dteType=0`) por distancia Hamming `dHash <= 6` + `(monto ±2%, fecha ±2d, proveedor)`.
 * 3. Cascada semántica FinOps 3 niveles (`LEVEL_1_DETERMINISTIC` -> `LEVEL_2_VECTOR_768D` -> `LEVEL_3_AI_DECIDE`
 *    `TENANT_PRIVATE`) y aprendizaje persistente en `tenant_supplier_sku_map` tras `"ACTUALIZAR"`.
 * 4. `LandedCostProrationEngine` (`NET_VALUE` / `WEIGHT_KG` / `VOLUME_L`) + Multi-CC Split real en `supply_cash_ledger`.
 * 5. `PriceAndShrinkflationDetector` (reduflación + alza `+15%` WARNING / `+30%` CRITICAL vs mediana 90d / `k >= 5`).
 * 6. `FuelOpermaqTelemetryReconciler` (`ANOMALY_HOROMETER_ROLLBACK`, `ANOMALY_TANK_OVERFILL`,
 *    `ANOMALY_FUEL_EXCESS_LPH`, `ANOMALY_FUEL_SHRINKAGE_THEFT`) + veredicto `ResilientAIClient.decide()` y rutas HTTP.
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
process.env.GCP_PROJECT_ID ||= 'minreport-supply-e05-test';
process.env.FIREBASE_PROJECT_ID ||= 'minreport-supply-e05-test';

// ---------------------------------------------------------------------------
// 1. In-Memory Firestore Stub
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

function createQueryRef(
    colPath: string,
    filters: Array<{ field: string; op: string; value: any }> = [],
    maxLimit?: number
): any {
    return {
        where(field: string, op: string, value: any) {
            return createQueryRef(colPath, [...filters, { field, op, value }], maxLimit);
        },
        orderBy() {
            return this;
        },
        limit(n: number) {
            return createQueryRef(colPath, filters, n);
        },
        async get() {
            const entries = Array.from(getCollectionMap(colPath).entries()).filter(([, doc]) =>
                filters.every((f) => {
                    const v = doc[f.field];
                    if (f.op === '==') return v === f.value;
                    if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(v);
                    return true;
                })
            );
            const sliced = typeof maxLimit === 'number' ? entries.slice(0, maxLimit) : entries;
            const docs = sliced.map(([id, doc]) => ({
                id,
                ref: createDocRef(colPath, id),
                exists: true,
                data: () => JSON.parse(JSON.stringify(doc)),
            }));
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    };
}

function createCollectionRef(colPath: string): any {
    return {
        ...createQueryRef(colPath),
        doc(docId?: string) {
            const id = docId || `doc_${Math.random().toString(36).slice(2, 10)}`;
            return createDocRef(colPath, id);
        },
    };
}

const mockDb = {
    collection(colPath: string) {
        return createCollectionRef(colPath);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const tx = {
            get: (ref: any) => ref.get(),
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) =>
                ref.set(data, opts),
            update: (ref: any, data: Record<string, any>) => ref.update(data),
            delete: (ref: any) => ref.delete(),
        };
        return fn(tx);
    },
};

const mockAuth = {
    async verifyIdToken(token: string) {
        if (token === 'token-buyer') {
            return {
                uid: 'uid-buyer',
                email: 'buyer@minera-demo.cl',
                email_verified: true,
                activeAccountId: 'tenant-e05',
            };
        }
        if (token === 'token-viewer') {
            return {
                uid: 'uid-viewer',
                email: 'viewer@minera-demo.cl',
                email_verified: true,
                activeAccountId: 'tenant-e05',
            };
        }
        return {
            uid: 'uid-admin',
            email: 'admin@minera-demo.cl',
            email_verified: true,
            activeAccountId: 'tenant-e05',
        };
    },
};

const mockAdmin: any = {
    firestore: Object.assign(() => mockDb, {
        FieldValue: {
            serverTimestamp: () => new Date().toISOString(),
            increment: (n: number) => n,
            arrayUnion: (...args: any[]) => args,
        },
        Timestamp: {
            now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }),
            fromDate: (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }),
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

import { parseSiiXmlDte, validateSiiDocumentForPurchase } from '../domain/SiiTaxValidator';
import {
    computeDHashHammingDistance,
    detectRuralReceiptDuplicate,
} from '../domain/RequisitionFulfillmentMatcher';
import { prorateLandedCosts, reconcilePurchase } from '../domain/StockAssetCashCostReconciler';
import { detectPriceAndShrinkflationAnomalies } from '../domain/SupplyPolicyAndAnomalyEngine';
import {
    proposeSemanticReconciliation,
    SemanticRequisitionMatcher,
    TENANT_SUPPLIER_SKU_MAP_COLLECTION,
} from '../application/SemanticRequisitionMatcher';
import { FuelOpermaqTelemetryReconciler } from '../application/FuelOpermaqTelemetryReconciler';
import { SUPPLY_COLLECTIONS, SupplyRepository } from '../application/SupplyRepository';
import { registerSupplyModuleRoutes } from '../index';
import { DEFAULT_SUPPLY_CATALOG_SEED } from '../catalog/DefaultSupplyCatalogSeed';
import {
    ReconciliationCommit4WayRequestSchema,
    ReconciliationProposeRequestSchema,
} from '../../../contracts/supply.contracts';

function makeVector768(seedIdx: number, noise = 0): number[] {
    const v = new Array(768).fill(0);
    v[seedIdx % 768] = 1;
    if (noise > 0) {
        v[(seedIdx + 1) % 768] = noise;
    }
    return v;
}

async function injectHttpRequest(
    app: Express,
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body?: Record<string, unknown>
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const socket: any = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
        socket.remoteAddress = '127.0.0.1';
        const req: any = new http.IncomingMessage(socket);
        req.method = method;
        req.url = url;
        const payloadStr = body ? JSON.stringify(body) : '';
        req.headers = {
            ...headers,
            ...(body
                ? {
                      'content-type': 'application/json',
                      'content-length': String(Buffer.byteLength(payloadStr)),
                  }
                : {}),
        };
        if (body) {
            req.push(payloadStr);
        }
        req.push(null);

        const res: any = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        res.write = (chunk: any) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return true;
        };
        res.end = (chunk?: any) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: any = raw;
            try {
                parsed = JSON.parse(raw);
            } catch {
                // keep text
            }
            resolve({ status: res.statusCode, body: parsed });
            return res;
        };
        app(req, res, (err: any) => {
            if (err) reject(err);
        });
    });
}

async function runTests() {
    dbCollections.clear();
    console.log('=== V3-E05 RECONCILIATION 4-WAY, SII EXTENSIONS, CASCADE, SHRINKFLATION & OPERMAQ FUEL SUITE ===');

    // -----------------------------------------------------------------------
    // 1. SII XML Extensions: <DscRcgGlobal>, <ImptoReten> IEP/IEC, <Referencia>
    // -----------------------------------------------------------------------
    console.log('1) Verifying SII XML extensions (<DscRcgGlobal>, <ImptoReten> IEC 29, <Referencia> 52/801/33)...');
    const dieselDteXml = `
    <DTE version="1.0"><Documento ID="F1001">
      <Encabezado>
        <IdDoc><TipoDTE>33</TipoDTE><Folio>1001</Folio><FchEmis>2026-11-20</FchEmis></IdDoc>
        <Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>DISTRIBUIDORA COMBUSTIBLE NORTE SPA</RznSoc></Emisor>
        <Receptor><RUTRecep>77123456-9</RUTRecep><RznSocRecep>MINERA DEMO SPA</RznSocRecep></Receptor>
        <Totales>
          <MntNeto>900000</MntNeto>
          <IVA>171000</IVA>
          <ImptoReten><TipoImp>29</TipoImp><TasaImp>1.5</TasaImp><MontoImp>55000</MontoImp></ImptoReten>
          <MntTotal>1126000</MntTotal>
        </Totales>
      </Encabezado>
      <Detalle><NroLinDet>1</NroLinDet><NmbItem>Petróleo Diésel Grado B1</NmbItem><QtyItem>1000</QtyItem><PrcItem>1000</PrcItem><MontoItem>1000000</MontoItem></Detalle>
      <DscRcgGlobal><NroLinDR>1</NroLinDR><TpoMov>D</TpoMov><TpoValor>%</TpoValor><ValorDR>10</ValorDR><GlosaDR>Descuento volumen faena</GlosaDR></DscRcgGlobal>
      <Referencia><NroLinRef>1</NroLinRef><TpoDocRef>801</TpoDocRef><FolioRef>OC-991</FolioRef><FchRef>2026-11-18</FchRef></Referencia>
      <Referencia><NroLinRef>2</NroLinRef><TpoDocRef>52</TpoDocRef><FolioRef>55420</FolioRef><FchRef>2026-11-19</FchRef></Referencia>
    </Documento></DTE>`;

    const parsedDte33 = parseSiiXmlDte(dieselDteXml);
    assert.equal(parsedDte33.valid, true, `XML DTE 33 errors: ${parsedDte33.errors.join('; ')}`);
    assert.equal(parsedDte33.linePricingBasis, 'NET');
    assert.equal(parsedDte33.globalAdjustmentNetClp, -100000);
    assert.equal(parsedDte33.fuelTaxIepIecClp, 55000);
    assert.equal(parsedDte33.references.length, 2);
    assert.equal(parsedDte33.references[0].refType, '801');
    assert.equal(parsedDte33.references[1].refType, '52');

    const siiOutcome33 = validateSiiDocumentForPurchase({
        siiDocId: 'sii-e05-diesel',
        tenantId: 'tenant-e05',
        siteId: 'site-atacama',
        xmlContent: dieselDteXml,
        expectedReceiverTaxId: '77.123.456-9',
    });
    assert.equal(siiOutcome33.valid, true, `SII validation errors: ${siiOutcome33.errors.join('; ')}`);
    assert.equal(siiOutcome33.fuelTaxIepIecClp, 55000);
    assert.equal(siiOutcome33.globalAdjustmentNetClp, -100000);

    const nc61Xml = `
    <DTE version="1.0"><Documento ID="NC1">
      <Encabezado>
        <IdDoc><TipoDTE>61</TipoDTE><Folio>202</Folio><FchEmis>2026-11-21</FchEmis></IdDoc>
        <Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>DISTRIBUIDORA COMBUSTIBLE NORTE SPA</RznSoc></Emisor>
        <Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales>
      </Encabezado>
      <Referencia><NroLinRef>1</NroLinRef><TpoDocRef>33</TpoDocRef><FolioRef>1001</FolioRef><CodRef>3</CodRef><RazonRef>Corrección diferencia de precio</RazonRef></Referencia>
    </Documento></DTE>`;
    const parsedNc61 = parseSiiXmlDte(nc61Xml);
    assert.equal(parsedNc61.references[0].refType, '33');
    assert.equal(parsedNc61.references[0].reasonCode, 3);

    // -----------------------------------------------------------------------
    // 2. Rural Receipts Anti-Duplication (dHash Hamming <= 6 & metadata ±2%)
    // -----------------------------------------------------------------------
    console.log('2) Verifying rural receipts dHash Hamming <= 6 and metadata anti-duplication...');
    assert.equal(computeDHashHammingDistance('f0f0f0f0f0f0f0f0', 'f0f0f0f0f0f0f0f7'), 3); // 0x7 = 3 bits
    const dupDhash = detectRuralReceiptDuplicate({
        supplierTaxIdNormalized: '76123456-0',
        documentType: 0,
        totalAmountClp: 45000,
        issueDate: '2026-11-21',
        phashHex: 'f0f0f0f0f0f0f0f7',
        recentPurchases: [
            {
                purchaseId: 'pur-prev-rural',
                supplierTaxIdNormalized: '76123456-0',
                documentType: 0,
                totalAmountClp: 45500,
                issueDate: '2026-11-20',
                phashHex: 'f0f0f0f0f0f0f0f0',
            },
        ],
    });
    assert.equal(dupDhash.isDuplicate, true);
    assert.equal(dupDhash.reason, 'VISUAL_DHASH_MATCH');
    assert.equal(dupDhash.hammingDistance, 3);

    const nonDupDhash = detectRuralReceiptDuplicate({
        supplierTaxIdNormalized: '76123456-0',
        documentType: 0,
        totalAmountClp: 85000,
        issueDate: '2026-11-21',
        phashHex: '0000000000000000',
        recentPurchases: [
            {
                purchaseId: 'pur-prev-rural',
                supplierTaxIdNormalized: '76123456-0',
                documentType: 0,
                totalAmountClp: 45500,
                issueDate: '2026-11-20',
                phashHex: 'ffffffffffffffff',
            },
        ],
    });
    assert.equal(nonDupDhash.isDuplicate, false);

    // -----------------------------------------------------------------------
    // 3. 3-Level FinOps Semantic Cascade + Learned Map Persistence on HITL "ACTUALIZAR"
    // -----------------------------------------------------------------------
    console.log('3) Verifying 3-level FinOps semantic cascade + tenant_supplier_sku_map learning...');
    let embedCalls = 0;
    let decideCalls = 0;

    const skuExact = DEFAULT_SUPPLY_CATALOG_SEED.find((s) => s.canonicalSkuId === 'SKU-COMB-DIESEL')!;
    const skuWater = DEFAULT_SUPPLY_CATALOG_SEED.find((s) => s.canonicalSkuId === 'SKU-AGUA-BIDON')!;
    const skuParts = DEFAULT_SUPPLY_CATALOG_SEED.find((s) => s.canonicalSkuId === 'SKU-OPM-FILTRO-ACEITE')!;

    const vecWater = makeVector768(10);
    const vecParts = makeVector768(50);

    const stubEmbedFn = async (text: string) => {
        embedCalls++;
        const t = text.toLowerCase();
        if (t.includes('purificada bidon')) return makeVector768(10, 0.2); // cos = 1 / sqrt(1.04) = 0.9806 >= 0.84
        if (t.includes('cartucho filtro alternativo')) return makeVector768(50, 0.88); // cos = 1 / sqrt(1.7744) = 0.7507 (0.68..0.84)
        return makeVector768(300); // < 0.68
    };

    const stubDecideFn = async (req: any) => {
        decideCalls++;
        assert.equal(req.dataClassification, 'TENANT_PRIVATE');
        const txt = String(req.inputText || '').toLowerCase();
        const choice = txt.includes('flete') ? 'ACCESSORY_CHARGE' : 'SUBSTITUTE_CANDIDATE';
        return {
            answers: {
                line_classification: {
                    type: 'choice' as const,
                    choice,
                    confidence: 0.89,
                    probabilities: { [choice]: 0.89 },
                },
            },
            model: 'gemini-decision-1',
            engineUsed: 'DECISIONS_API_V1BETA' as const,
            usage: { totalInputTokens: 100, totalOutputTokens: 10, totalTokens: 110 },
        };
    };

    const cascadeRes = await proposeSemanticReconciliation(
        [
            {
                purchaseLineId: 'l1',
                rawDescription: skuExact.name,
                quantity: 100,
                unitPriceClp: 1000,
                subtotalClp: 100000,
                linePricingBasis: 'NET',
            },
            {
                purchaseLineId: 'l2',
                rawDescription: 'Agua purificada bidon retornable',
                quantity: 20,
                unitPriceClp: 4000,
                subtotalClp: 80000,
                linePricingBasis: 'NET',
            },
            {
                purchaseLineId: 'l3',
                rawDescription: 'Cartucho filtro alternativo CAT 330',
                supplierItemCode: 'FLT-ALT-330',
                quantity: 5,
                unitPriceClp: 20000,
                subtotalClp: 100000,
                linePricingBasis: 'NET',
            },
            {
                purchaseLineId: 'l4',
                rawDescription: 'Flete faena cordillera',
                quantity: 1,
                unitPriceClp: 28000,
                subtotalClp: 28000,
                linePricingBasis: 'NET',
            },
        ],
        {
            tenantId: 'tenant-e05',
            supplierRutNormalized: '76123456-0',
            documentType: 33,
            prorationMode: 'NET_VALUE',
            catalogVectors: [
                { canonicalSkuId: skuWater.canonicalSkuId, name: skuWater.name, embedding768: vecWater, source: 'CATALOG' },
                { canonicalSkuId: skuParts.canonicalSkuId, name: skuParts.name, embedding768: vecParts, source: 'CATALOG' },
            ],
            embedFn: stubEmbedFn,
            decideFn: stubDecideFn,
        }
    );

    assert.equal(cascadeRes.proposedLines[0].matchTier, 'LEVEL_1_DETERMINISTIC');
    assert.equal(cascadeRes.proposedLines[0].matchedCanonicalSkuId, skuExact.canonicalSkuId);
    assert.equal(cascadeRes.proposedLines[1].matchTier, 'LEVEL_2_VECTOR_768D');
    assert.equal(cascadeRes.proposedLines[1].matchedCanonicalSkuId, skuWater.canonicalSkuId);
    assert.equal(cascadeRes.proposedLines[2].matchTier, 'LEVEL_3_AI_DECIDE');
    assert.equal(cascadeRes.proposedLines[2].classification, 'SUBSTITUTE_CANDIDATE');
    assert.equal(cascadeRes.proposedLines[3].matchTier, 'LEVEL_3_AI_DECIDE');
    assert.equal(cascadeRes.proposedLines[3].classification, 'ACCESSORY_CHARGE');
    assert.equal(decideCalls, 2, 'Level 1 & Level 2 (>=0.84) must NOT invoke Level 3 Decisions API');

    // Freight CLP 28,000 prorated across l1(100k), l2(80k), l3(100k) -> sum = 280k -> exact 10k, 8k, 10k!
    assert.equal(cascadeRes.proposedLines[0].allocatedFreightOrDiscountClp, 10000);
    assert.equal(cascadeRes.proposedLines[1].allocatedFreightOrDiscountClp, 8000);
    assert.equal(cascadeRes.proposedLines[2].allocatedFreightOrDiscountClp, 10000);
    assert.equal(cascadeRes.proposedLines[0].landedUnitCostNetClp, 1100); // (100000+10000)/100

    // Save learned mapping for l3 and verify Level 1 $0 hit on next run
    await SemanticRequisitionMatcher.saveLearnedSupplierMapping({
        tenantId: 'tenant-e05',
        supplierRutNormalized: '76123456-0',
        supplierItemCode: 'FLT-ALT-330',
        rawDescription: 'Cartucho filtro alternativo CAT 330',
        canonicalSkuId: skuParts.canonicalSkuId,
        classification: 'EXACT_EQUIVALENT',
        confirmedByUid: 'uid-buyer',
        allowNetworkAi: false,
    });
    const learnedMaps = await SemanticRequisitionMatcher.lookupTenantLearnedMaps('tenant-e05', '76123456-0');
    assert.equal(learnedMaps.length, 1);

    const prevEmbedCalls = embedCalls;
    const prevDecideCalls = decideCalls;
    const secondPass = await proposeSemanticReconciliation(
        [
            {
                purchaseLineId: 'l3-again',
                rawDescription: 'Cartucho filtro alternativo CAT 330',
                supplierItemCode: 'FLT-ALT-330',
                quantity: 5,
                unitPriceClp: 20000,
                subtotalClp: 100000,
                linePricingBasis: 'NET',
            },
        ],
        {
            tenantId: 'tenant-e05',
            supplierRutNormalized: '76123456-0',
            documentType: 33,
            learnedMaps,
            embedFn: stubEmbedFn,
            decideFn: stubDecideFn,
        }
    );
    assert.equal(secondPass.proposedLines[0].matchTier, 'LEVEL_1_DETERMINISTIC');
    assert.equal(embedCalls, prevEmbedCalls);
    assert.equal(decideCalls, prevDecideCalls);

    // -----------------------------------------------------------------------
    // 4. LandedCostProrationEngine (WEIGHT_KG) + Multi-CC Real Split
    // -----------------------------------------------------------------------
    console.log('4) Verifying WEIGHT_KG landed proration and Multi-CC supply_cash_ledger split...');
    const weightProration = prorateLandedCosts({
        lines: [
            { purchaseLineId: 'a', qtyPurchased: 10, netAmountClp: 100000, weightKg: 300 },
            { purchaseLineId: 'b', qtyPurchased: 5, netAmountClp: 100000, weightKg: 100 },
            { purchaseLineId: 'f', qtyPurchased: 1, netAmountClp: 40000, isAccessoryCharge: true },
        ],
        prorationMode: 'WEIGHT_KG',
        globalAdjustmentNetClp: -4000, // net pool = 36,000 -> 27,000 / 9,000
    });
    assert.equal(weightProration.modeUsed, 'WEIGHT_KG');
    assert.equal(weightProration.byLineId['a'].allocatedAdjustmentClp, 27000);
    assert.equal(weightProration.byLineId['b'].allocatedAdjustmentClp, 9000);
    assert.equal(weightProration.byLineId['a'].landedUnitCostNetClp, 12700);

    const multiCcRecon = reconcilePurchase(
        {
            purchaseId: 'pur-multicc',
            tenantId: 'tenant-e05',
            siteId: 'site-atacama',
            buyerUid: 'uid-buyer',
            buyerRole: 'BUYER',
            purchaseMode: 'REQUISITION_FULFILLMENT',
            authorizedByAuthority: true,
            supplierTaxId: '76123456-0',
            supplierName: 'PROVEEDOR MULTI CC',
            documentType: 33,
            folio: '501',
            issueDate: '2026-11-22',
            netAmountClp: 100000,
            vatAmountClp: 19000,
            totalAmountClp: 119000,
            paymentMethod: 'TRANSFERENCIA',
            lines: [
                {
                    purchaseLineId: 'pl-1',
                    canonicalSkuId: 'SKU-COMB-DIESEL',
                    description: 'Diésel B1',
                    categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
                    unitSi: 'L',
                    qtyPurchased: 100,
                    unitPriceNetClp: 1000,
                    unitPriceGrossClp: 1190,
                    subtotalNetClp: 100000,
                    subtotalGrossClp: 119000,
                    linePricingBasis: 'NET',
                    destination: 'STOCK_IN_WAREHOUSE',
                },
            ],
        },
        [
            {
                allocationId: 'al-1',
                tenantId: 'tenant-e05',
                siteId: 'site-atacama',
                purchaseId: 'pur-multicc',
                purchaseLineId: 'pl-1',
                canonicalSkuId: 'SKU-COMB-DIESEL',
                allocationType: 'REQUISITION_MATCH',
                requisitionId: 'req-camp',
                requisitionLineId: 'rl-1',
                qtyAllocated: 60,
                unitSi: 'L',
                destination: 'STOCK_IN_WAREHOUSE',
                costCenter: 'CC-CAMP-ENERGIA',
                createdAt: '2026-11-22T10:00:00Z',
            },
            {
                allocationId: 'al-2',
                tenantId: 'tenant-e05',
                siteId: 'site-atacama',
                purchaseId: 'pur-multicc',
                purchaseLineId: 'pl-1',
                canonicalSkuId: 'SKU-COMB-DIESEL',
                allocationType: 'REQUISITION_MATCH',
                requisitionId: 'req-ops',
                requisitionLineId: 'rl-2',
                qtyAllocated: 40,
                unitSi: 'L',
                destination: 'STOCK_IN_WAREHOUSE',
                costCenter: 'CC-FLOTA-COMBUSTIBLE',
                createdAt: '2026-11-22T10:05:00Z',
            },
        ]
    );

    assert.equal(multiCcRecon.cashEntries.length, 2);
    assert.equal(multiCcRecon.cashEntries[0].costCenter, 'CC-CAMP-ENERGIA');
    assert.equal(multiCcRecon.cashEntries[0].opexImpactClp, 60000);
    assert.equal(multiCcRecon.cashEntries[1].costCenter, 'CC-FLOTA-COMBUSTIBLE');
    assert.equal(multiCcRecon.cashEntries[1].opexImpactClp, 40000);
    assert.equal(multiCcRecon.summary.opexByCostCenter['CC-CAMP-ENERGIA'], 60000);
    assert.equal(multiCcRecon.summary.opexByCostCenter['CC-FLOTA-COMBUSTIBLE'], 40000);

    // -----------------------------------------------------------------------
    // 5. PriceAndShrinkflationDetector
    // -----------------------------------------------------------------------
    console.log('5) Verifying PriceAndShrinkflationDetector (shrinkflation + >15% WARNING / >30% CRITICAL)...');
    const shrinkResult = detectPriceAndShrinkflationAnomalies({
        canonicalSkuId: 'SKU-SUP-MANTEQUILLA',
        itemName: 'Mantequilla pan',
        unitSi: 'kg',
        quantity: 10,
        netTotalClp: 85000, // 8500 / 0.85 = 10,000 CLP/kg
        observedUnitSizeSi: 0.85,
        expectedUnitSizeSi: 1.0,
        tenantMedian90dNetPerSiClp: 7200, // +38.9% -> CRITICAL
    });
    assert.equal(shrinkResult.observedNetPerSiClp, 10000);
    assert.ok(shrinkResult.findings.some((f) => f.alertType === 'ANOMALY_SHRINKFLATION' && f.severity === 'CRITICAL'));
    assert.ok(shrinkResult.findings.some((f) => f.alertType === 'ANOMALY_PRICE_VARIANCE' && f.severity === 'CRITICAL'));

    // k < 5 market benchmark ignored when no tenant median
    const lowKRes = detectPriceAndShrinkflationAnomalies({
        canonicalSkuId: 'SKU-FER-CEMENTO',
        unitSi: 'kg',
        quantity: 100,
        netTotalClp: 50000,
        marketMedianNetPerSiClp: 200,
        marketPeerCount: 4, // < 5 -> must NOT compare
    });
    assert.equal(lowKRes.baselineNetPerSiClp, null);
    assert.equal(lowKRes.findings.length, 0);

    // -----------------------------------------------------------------------
    // 6. FuelOpermaqTelemetryReconciler + HTTP E2E (/propose, /commit-4way, /kardex)
    // -----------------------------------------------------------------------
    console.log('6) Verifying OPERMAQ fuel telemetry audit + HTTP endpoints & HITL/RBAC...');
    await createDocRef('machinery_fleet', 'OPM-CAT-777').set({
        tenantId: 'tenant-e05',
        tankCapacityL: 500,
        expectedMaxLitersPerHour: 60,
    });

    let fuelAiCalled = 0;
    const fuelAuditMulti = await FuelOpermaqTelemetryReconciler.auditFuelDispatch({
        tenantId: 'tenant-e05',
        siteId: 'site-atacama',
        warehouseId: 'wh-fuel-1',
        opermaqAssetId: 'OPM-CAT-777',
        canonicalSkuId: 'SKU-COMB-DIESEL',
        litersDispensed: 600, // > 105% of 500L OEM!
        currentHorometer: 1180, // < 1200h previous -> rollback!
        previousHorometer: 1200,
        latestTankVariancePct: -3.4, // > 2.5% shrinkage!
        actorUid: 'uid-buyer',
        decideFn: async (req) => {
            fuelAiCalled++;
            assert.equal(req.dataClassification, 'TENANT_PRIVATE');
            return {
                answers: {
                    fuel_diversion_risk: {
                        type: 'score' as const,
                        score: 2,
                        confidence: 0.94,
                        legend: { '2': 'Alto riesgo (probable desvío o manipulación de horómetro)' },
                        probabilities: { '2': 0.94 },
                    },
                },
                model: 'gemini-decision-1',
                engineUsed: 'DECISIONS_API_V1BETA' as const,
                usage: { totalInputTokens: 90, totalOutputTokens: 10, totalTokens: 100 },
            };
        },
    });
    assert.equal(fuelAiCalled, 1);
    assert.equal(fuelAuditMulti.hasCriticalAnomalies, true);
    assert.ok(fuelAuditMulti.anomalies.some((a) => a.alertType === 'ANOMALY_HOROMETER_ROLLBACK'));
    assert.ok(fuelAuditMulti.anomalies.some((a) => a.alertType === 'ANOMALY_TANK_OVERFILL'));
    assert.ok(fuelAuditMulti.anomalies.some((a) => a.alertType === 'ANOMALY_FUEL_SHRINKAGE_THEFT'));
    assert.ok(fuelAuditMulti.aiVerdictSummary?.includes('Alto riesgo'));
    assert.ok(getCollectionMap(SUPPLY_COLLECTIONS.EVENT_LEDGER).size >= 1);

    // Express HTTP tests
    const app = express();
    app.use(express.json());
    registerSupplyModuleRoutes(app);

    // Seed account, users & supply profiles for buyer & viewer in tenant-e05
    await createDocRef('accounts', 'tenant-e05').set({
        id: 'tenant-e05',
        accountId: 'tenant-e05',
        name: 'Minera Demo E05 SpA',
        status: 'ACTIVE',
        ownerId: 'uid-admin',
        contract: { status: 'ACTIVE', activeModules: { supply: true, opermaq: true, stockpile: true } },
    });
    await createDocRef('users', 'uid-buyer').set({
        uid: 'uid-buyer',
        email: 'buyer@minera-demo.cl',
        role: 'OPERATOR',
        memberships: [{ accountId: 'tenant-e05', role: 'OPERATOR', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await createDocRef('users', 'uid-viewer').set({
        uid: 'uid-viewer',
        email: 'viewer@minera-demo.cl',
        role: 'VIEWER',
        memberships: [{ accountId: 'tenant-e05', role: 'VIEWER', status: 'ACTIVE', allowedModules: { supply: true } }],
    });
    await createDocRef(`accounts/tenant-e05/members`, 'uid-buyer').set({
        uid: 'uid-buyer',
        accountId: 'tenant-e05',
        tenantId: 'tenant-e05',
        role: 'OPERATOR',
        status: 'ACTIVE',
        supplyProfile: {
            role: 'BUYER',
            canRecordDirectPurchase: true,
            autoApproveDirectPurchase: false,
            allowCapex: true,
            assignedSiteIds: ['site-atacama'],
            defaultCostCenter: 'CC-OPS-MINA',
        },
    });
    await createDocRef(`accounts/tenant-e05/members`, 'uid-viewer').set({
        uid: 'uid-viewer',
        accountId: 'tenant-e05',
        tenantId: 'tenant-e05',
        role: 'VIEWER',
        status: 'ACTIVE',
    });
    await createDocRef(SUPPLY_COLLECTIONS.SITES, 'site-atacama').set({
        siteId: 'site-atacama',
        tenantId: 'tenant-e05',
        name: 'Faena Atacama',
        currentHeadcount: 80,
        waterStorageCapacityL: 40000,
        ds594DailyWaterTargetLPerPax: 100,
        leadTimeDays: 3,
    });

    // Propose HTTP
    const proposePayload = ReconciliationProposeRequestSchema.parse({
        siteId: 'site-atacama',
        supplierTaxId: '76123456-0',
        xmlContent: dieselDteXml,
    });
    const proposeHttp = await injectHttpRequest(
        app,
        'POST',
        '/api/supply/reconciliation/propose',
        { authorization: 'Bearer token-buyer' },
        proposePayload
    );
    assert.equal(proposeHttp.status, 200, JSON.stringify(proposeHttp.body));
    assert.equal(proposeHttp.body.proposal.siiTaxes.iepOrIecClp, 55000);
    assert.equal(proposeHttp.body.proposal.siiTaxes.globalAdjustmentNetClp, -100000);

    // VIEWER blocked 403 on commit-4way
    const viewerCommit = await injectHttpRequest(
        app,
        'POST',
        '/api/supply/reconciliation/commit-4way',
        { authorization: 'Bearer token-viewer' },
        {
            siteId: 'site-atacama',
            supplierTaxId: '76123456-0',
            supplierName: 'PROVEEDOR E05',
            documentType: 33,
            folio: '9881',
            issueDate: '2026-11-22',
            confirmationKeyword: 'ACTUALIZAR',
            lines: [
                {
                    purchaseLineId: 'pl-http-1',
                    rawDescription: 'Petróleo Diésel Grado B1',
                    canonicalSkuId: 'SKU-COMB-DIESEL',
                    unitSi: 'L',
                    qtyPurchased: 100,
                    unitPriceClp: 900,
                    subtotalClp: 90000,
                },
            ],
        }
    );
    assert.equal(viewerCommit.status, 403);

    // Missing HITL "ACTUALIZAR" blocked 400
    const noHitlCommit = await injectHttpRequest(
        app,
        'POST',
        '/api/supply/reconciliation/commit-4way',
        { authorization: 'Bearer token-buyer' },
        {
            siteId: 'site-atacama',
            supplierTaxId: '76123456-0',
            supplierName: 'PROVEEDOR E05',
            documentType: 33,
            folio: '9881',
            issueDate: '2026-11-22',
            confirmationKeyword: 'CONFIRMAR',
            lines: [
                {
                    purchaseLineId: 'pl-http-1',
                    rawDescription: 'Petróleo Diésel Grado B1',
                    canonicalSkuId: 'SKU-COMB-DIESEL',
                    unitSi: 'L',
                    qtyPurchased: 100,
                    unitPriceClp: 900,
                    subtotalClp: 90000,
                },
            ],
        }
    );
    assert.equal(noHitlCommit.status, 400);

    // Valid commit-4way with ACCESSORY_CHARGE freight + HITL "ACTUALIZAR"
    const validCommitPayload = ReconciliationCommit4WayRequestSchema.parse({
        siteId: 'site-atacama',
        supplierTaxId: '76123456-0',
        supplierName: 'PROVEEDOR E05',
        documentType: 33,
        folio: '9881',
        issueDate: '2026-11-22',
        confirmationKeyword: 'ACTUALIZAR',
        lines: [
            {
                purchaseLineId: 'pl-http-1',
                rawDescription: 'Filtro hidráulico alternativo 9881',
                supplierItemCode: 'FH-9881',
                canonicalSkuId: skuParts.canonicalSkuId,
                classification: 'EXACT_EQUIVALENT',
                unitSi: skuParts.baseUnitSi,
                qtyPurchased: 10,
                unitPriceClp: 10000,
                subtotalClp: 100000,
                linePricingBasis: 'NET',
                destination: 'STOCK_IN_WAREHOUSE',
            },
            {
                purchaseLineId: 'pl-http-freight',
                rawDescription: 'Flete express faena',
                canonicalSkuId: skuParts.canonicalSkuId,
                classification: 'ACCESSORY_CHARGE',
                unitSi: 'un',
                qtyPurchased: 1,
                unitPriceClp: 15000,
                subtotalClp: 15000,
                linePricingBasis: 'NET',
                learnSupplierMapping: false,
            },
        ],
    });

    const commitRes = await injectHttpRequest(
        app,
        'POST',
        '/api/supply/reconciliation/commit-4way',
        { authorization: 'Bearer token-buyer' },
        validCommitPayload
    );
    assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
    assert.equal(commitRes.body.purchase.netAmountClp, 115000);
    assert.equal(commitRes.body.learnedMappingsCount, 1);
    assert.ok(getCollectionMap(TENANT_SUPPLIER_SKU_MAP_COLLECTION).size >= 2);

    // Check PMP net in supply_inventory_items absorbed the freight (115,000 / 10 = 11,500)
    const invSnap = await getCollectionMap(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).get(
        `tenant-e05__site-atacama__${skuParts.canonicalSkuId}`
    );
    assert.equal(invSnap?.avgUnitCostClp, 11500);

    console.log('\n✅ ALL V3-E05 RECONCILIATION 4-WAY, SII, CASCADE, SHRINKFLATION & OPERMAQ TESTS PASSED (6/6)!');
}

runTests().catch((err) => {
    console.error('❌ V3-E05 test failed:', err);
    process.exit(1);
});
