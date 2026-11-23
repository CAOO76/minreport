/**
 * MINREPORT · ABASTECIMIENTO — E04 Canonical Contracts, Global Primitives & supplyApi Normalizers Suite
 *
 * Verifica de forma 100% determinista (Node v20.19.5, cero red):
 * 1. Paridad staff <-> supply (`P0-04`): `SupplyMemberProfileSchema` y `EvidenceCasRefSchema`
 *    convergidos en fuente única, aceptando tanto payloads canónicos (`COLLOQUIAL_FIELD`/`AUDIO_VOICE`/`es-CL`)
 *    como legacy (`TERRENO_DIRECTO`/`MIXED`/`ES_CL`) y normalizándolos al formato canónico sin `ZodError`.
 * 2. Primitivas Global-Ready (`MoneyAmountSchema`, `TaxIdentifierSchema`, `InternationalPhoneE164Schema`,
 *    `IanaTimezoneSchema`, `UnspscCodeSchema`, `Gs1GtinSchema`, `UNIT_SI_TO_UNCEFACT_REC20`) y allowlist
 *    estricta de URLs en `EvidenceCasRefSchema` (rechaza `javascript:`, `http:`, `file:`, `data:`, `;base64,`).
 * 3. Normalizadores reales de `web/src/modules/supply/services/supplyApi.ts` (`P0-07`, `P0-08`):
 *    - `normalizePurchaseLineFromServer` & `normalizeReceiptAnalysisDraft` (0 pérdida de `description` a `'ITEM'`,
 *      propagación real de `arithmeticCheck`, `arithmeticMismatch`, `arithmeticDeltaClp`, `source`, `warnings`).
 *    - `normalizeInventoryItem`, `normalizeSiiExpenseReport`, `normalizeForecast` (`waterStoredL > 0`, `holderName === custodianName`).
 *    - Preservación de `PARTIAL_DISCREPANCY` en compras/recepciones y traducción segura `/reset` -> `CANCELAR`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// 1. In-memory CJS loader for `web/src/**` ESM TypeScript modules under ts-node
// ---------------------------------------------------------------------------

const webRoot = path.resolve(__dirname, '../../../../web/src');
const webModuleCache = new Map<string, any>();

const stubbedWebModules = new Map<string, any>([
    [
        path.join(webRoot, 'core/network/coreAuthFetch.ts'),
        {
            coreAuthFetch: async () => {
                throw new Error('coreAuthFetch should not execute network calls in unit tests');
            },
        },
    ],
    [path.join(webRoot, 'core/media/MediaDigestorClient.ts'), { mediaDigestorClient: {} }],
    [
        path.join(webRoot, 'core/offline/SyncQueueEngine.ts'),
        { syncQueueEngine: { isOnlineNow: () => true } },
    ],
]);

function resolveWebTsPath(fromDir: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(fromDir, specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

function loadWebTsModule(absPath: string): any {
    if (stubbedWebModules.has(absPath)) return stubbedWebModules.get(absPath);
    if (webModuleCache.has(absPath)) return webModuleCache.get(absPath);

    const source = fs.readFileSync(absPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        fileName: absPath,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    });

    const mod = { exports: {} as any };
    webModuleCache.set(absPath, mod.exports);
    const dir = path.dirname(absPath);
    const localRequire = (specifier: string) => {
        const resolved = resolveWebTsPath(dir, specifier);
        if (resolved) {
            return loadWebTsModule(resolved);
        }
        return require(specifier);
    };

    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled.outputText);
    fn(mod.exports, localRequire, mod, absPath, dir);
    webModuleCache.set(absPath, mod.exports);
    return mod.exports;
}

import {
    CanonicalSupplySkuSchema,
    EvidenceCasRefSchema as CanonicalEvidenceCasRefSchema,
    Gs1GtinSchema,
    IanaTimezoneSchema,
    InternationalPhoneE164Schema,
    MoneyAmountSchema,
    SupplyCommunicationStyleSchema,
    SupplyEvidenceCasRefSchema,
    SupplyMemberProfileSchema as CanonicalMemberProfileSchema,
    SupplySiteSchema,
    TaxIdentifierSchema,
    UnCefactRec20CodeSchema,
    UNIT_SI_TO_UNCEFACT_REC20,
    UnspscCodeSchema,
} from '../../../contracts/supply.contracts';
import {
    EvidenceCasRefSchema as AppEvidenceCasRefSchema,
    SupplyMemberProfileSchema as AppMemberProfileSchema,
} from '../application/supply.types';

const webContractsMod = loadWebTsModule(path.join(webRoot, 'contracts/supply.contracts.ts')) as {
    SupplyMemberProfileSchema: typeof CanonicalMemberProfileSchema;
    MoneyAmountSchema: typeof MoneyAmountSchema;
    SupplyEvidenceCasRefSchema: typeof SupplyEvidenceCasRefSchema;
    UNIT_SI_TO_UNCEFACT_REC20: typeof UNIT_SI_TO_UNCEFACT_REC20;
};

const supplyApiMod = loadWebTsModule(path.join(webRoot, 'modules/supply/services/supplyApi.ts')) as {
    normalizePurchaseLineFromServer: (raw: Record<string, unknown>) => any;
    normalizeReceiptAnalysisDraft: (json: Record<string, unknown>, fallback?: any) => any;
    normalizePurchaseRecord: (raw: Record<string, unknown>) => any;
    normalizeInventoryItem: (raw: Record<string, unknown>) => any;
    normalizeSiiExpenseReport: (raw: Record<string, unknown>) => any;
    normalizeForecast: (raw: Record<string, unknown>) => any;
    buildWhatsAppSimulateRequestPayload: (input: any) => Record<string, unknown>;
};

async function runTests(): Promise<void> {
    console.log('=== E04 CANONICAL CONTRACTS, GLOBAL PRIMITIVES & SUPPLY API NORMALIZERS SUITE ===');

    // -----------------------------------------------------------------------
    // 1. Staff <-> Supply Parity & Zero Split-Brain (P0-04)
    // -----------------------------------------------------------------------
    console.log('1) Testing staff <-> supply SupplyMemberProfileSchema convergence & legacy alias normalization...');
    {
        assert.strictEqual(
            AppMemberProfileSchema,
            CanonicalMemberProfileSchema,
            'supply.types.ts MUST re-export the exact canonical SupplyMemberProfileSchema'
        );
        assert.strictEqual(
            AppEvidenceCasRefSchema,
            CanonicalEvidenceCasRefSchema,
            'supply.types.ts MUST re-export the exact canonical EvidenceCasRefSchema'
        );
        assert.strictEqual(CanonicalEvidenceCasRefSchema, SupplyEvidenceCasRefSchema);

        // Canonical format from staff.controller.ts / supply.contracts.ts
        const canonicalParsed = AppMemberProfileSchema.parse({
            role: 'CAMP_MANAGER',
            communicationStyle: {
                register: 'COLLOQUIAL_FIELD',
                preferredModality: 'AUDIO_VOICE',
                dialect: 'es-CL',
            },
        });
        assert.equal(canonicalParsed.communicationStyle.register, 'COLLOQUIAL_FIELD');
        assert.equal(canonicalParsed.communicationStyle.preferredModality, 'AUDIO_VOICE');
        assert.equal(canonicalParsed.communicationStyle.dialect, 'es-CL');

        // Legacy format from old supply.types.ts (TERRENO_DIRECTO / MIXED / ES_CL) -> normalized without ZodError
        const legacyFieldParsed = AppMemberProfileSchema.parse({
            role: 'MECHANIC_TECH',
            communicationStyle: {
                register: 'TERRENO_DIRECTO',
                preferredModality: 'MIXED',
                dialect: 'ES_CL',
            },
        });
        assert.equal(legacyFieldParsed.communicationStyle.register, 'COLLOQUIAL_FIELD');
        assert.equal(legacyFieldParsed.communicationStyle.preferredModality, 'HYBRID');
        assert.equal(legacyFieldParsed.communicationStyle.dialect, 'es-CL');

        // Additional legacy mappings (TECNICO_FORMAL / AUDIO / PT_BR and EJECUTIVO / EN_US)
        const legacyTech = SupplyCommunicationStyleSchema.parse({
            register: 'TECNICO_FORMAL',
            preferredModality: 'AUDIO',
            dialect: 'PT_BR',
        });
        assert.deepEqual(legacyTech, {
            register: 'TECHNICAL_DIRECT',
            preferredModality: 'AUDIO_VOICE',
            dialect: 'pt-BR',
        });

        const legacyExec = SupplyCommunicationStyleSchema.parse({
            register: 'EJECUTIVO',
            preferredModality: 'TEXT',
            dialect: 'EN_US',
        });
        assert.deepEqual(legacyExec, {
            register: 'EXECUTIVE_BRIEF',
            preferredModality: 'TEXT',
            dialect: 'en-US',
        });

        // Global BCP-47 dialects (es-MX, es-CO, en-AU)
        const globalDialect = SupplyCommunicationStyleSchema.parse({
            register: 'TECHNICAL_DIRECT',
            preferredModality: 'HYBRID',
            dialect: 'en-AU',
        });
        assert.equal(globalDialect.dialect, 'en-AU');

        // Verify web mirror `web/src/contracts/supply.contracts.ts` parses identical legacy & canonical payloads
        const webLegacy = webContractsMod.SupplyMemberProfileSchema.parse({
            role: 'CAMP_MANAGER',
            communicationStyle: {
                register: 'TERRENO_DIRECTO',
                preferredModality: 'MIXED',
                dialect: 'ES_CL',
            },
        });
        assert.deepEqual(webLegacy.communicationStyle, {
            register: 'COLLOQUIAL_FIELD',
            preferredModality: 'HYBRID',
            dialect: 'es-CL',
        });
        assert.deepEqual(webContractsMod.UNIT_SI_TO_UNCEFACT_REC20, UNIT_SI_TO_UNCEFACT_REC20);

        // Invalid values MUST still fail strictly
        assert.throws(() =>
            SupplyCommunicationStyleSchema.parse({
                register: 'INVALID_REGISTER',
                preferredModality: 'HYBRID',
                dialect: 'es-CL',
            })
        );
    }

    // -----------------------------------------------------------------------
    // 2. Global-Ready Primitives & EvidenceCasRefSchema URL Allowlist
    // -----------------------------------------------------------------------
    console.log('2) Testing global primitives (ISO 4217, TaxIdentifier, E.164, IANA, UNSPSC, GTIN, UN/CEFACT) & CAS URL allowlist...');
    {
        const clpMoney = MoneyAmountSchema.parse({
            amountMinor: 238000,
            currencyCode: 'CLP',
            minorUnitDigits: 0,
        });
        assert.equal(clpMoney.currencyCode, 'CLP');

        const usdMoney = MoneyAmountSchema.parse({
            amountMinor: 12550,
            currencyCode: 'USD',
            minorUnitDigits: 2,
            fxRateToBase: 950.25,
            fxDateIso: '2026-11-21',
            baseCurrencyCode: 'CLP',
        });
        assert.equal(usdMoney.minorUnitDigits, 2);

        const penMoney = MoneyAmountSchema.parse({ amountMinor: 45000, currencyCode: 'PEN', minorUnitDigits: 2 });
        const brlMoney = MoneyAmountSchema.parse({ amountMinor: 9900, currencyCode: 'BRL', minorUnitDigits: 2 });
        assert.equal(penMoney.currencyCode, 'PEN');
        assert.equal(brlMoney.currencyCode, 'BRL');

        assert.throws(() => MoneyAmountSchema.parse({ amountMinor: 12.5, currencyCode: 'USD', minorUnitDigits: 2 }));
        assert.throws(() => MoneyAmountSchema.parse({ amountMinor: 100, currencyCode: 'clp', minorUnitDigits: 0 }));

        const taxCl = TaxIdentifierSchema.parse({
            countryCode: 'CL',
            scheme: 'CL_RUT',
            value: '76.192.083-9',
            normalized: '76192083-9',
        });
        const taxAu = TaxIdentifierSchema.parse({
            countryCode: 'AU',
            scheme: 'AU_ABN',
            value: '51 824 753 556',
            normalized: '51824753556',
        });
        assert.equal(taxCl.scheme, 'CL_RUT');
        assert.equal(taxAu.scheme, 'AU_ABN');
        assert.throws(() =>
            TaxIdentifierSchema.parse({ countryCode: 'CHL', scheme: 'CL_RUT', value: '1-9', normalized: '1-9' })
        );

        assert.equal(InternationalPhoneE164Schema.parse('+56900001234'), '+56900001234');
        assert.equal(InternationalPhoneE164Schema.parse('+61412345678'), '+61412345678');
        assert.throws(() => InternationalPhoneE164Schema.parse('900001234'));

        assert.equal(IanaTimezoneSchema.parse('America/Santiago'), 'America/Santiago');
        assert.equal(IanaTimezoneSchema.parse('Australia/Perth'), 'Australia/Perth');
        assert.throws(() => IanaTimezoneSchema.parse('Santiago Local'));

        assert.equal(UnspscCodeSchema.parse('40161505'), '40161505');
        assert.throws(() => UnspscCodeSchema.parse('4016'));

        assert.equal(Gs1GtinSchema.parse('7801234567890'), '7801234567890');
        assert.throws(() => Gs1GtinSchema.parse('1234567890'));

        assert.equal(UNIT_SI_TO_UNCEFACT_REC20.kg, 'KGM');
        assert.equal(UNIT_SI_TO_UNCEFACT_REC20.L, 'LTR');
        assert.equal(UNIT_SI_TO_UNCEFACT_REC20.un, 'EA');
        assert.equal(UnCefactRec20CodeSchema.parse(UNIT_SI_TO_UNCEFACT_REC20.m3), 'MTQ');

        // Global optional fields on CanonicalSupplySkuSchema & SupplySiteSchema
        const skuGlobal = CanonicalSupplySkuSchema.parse({
            canonicalSkuId: 'sku-filter-cat',
            name: 'Filtro Hidráulico CAT',
            categoryCode: 'REPUESTOS_MAQUINARIA',
            procurementBucket: 'REPUESTOS_OPERMAQ',
            baseUnitSi: 'un',
            unspscCode: '40161505',
            gtin: '00012345678905',
            unCefactCode: 'EA',
            iso14224AssetClass: 'HEAVY_MOBILE_EQ',
        });
        assert.equal(skuGlobal.gtin, '00012345678905');
        assert.equal(skuGlobal.iso14224AssetClass, 'HEAVY_MOBILE_EQ');

        const siteDefault = SupplySiteSchema.parse({
            siteId: 'site-1',
            tenantId: 'tenant-1',
            name: 'Faena Atacama',
            districtCode: 'CL-ATACAMA',
        });
        assert.equal(siteDefault.countryCode, 'CL');
        assert.equal(siteDefault.currencyCode, 'CLP');
        assert.equal(siteDefault.timezoneIana, 'America/Santiago');

        // EvidenceCasRefSchema URL scheme allowlist (accept safe schemes, reject dangerous schemes)
        const baseCas = {
            sha256: 'a'.repeat(64),
            mimeType: 'image/webp',
            extension: 'webp',
            originalBytes: 10000,
            optimizedBytes: 2500,
            savingsPct: 75,
        };
        assert.ok(CanonicalEvidenceCasRefSchema.parse({ ...baseCas, downloadUrl: '/api/media/blob/tenant/t1/a.webp' }));
        assert.ok(CanonicalEvidenceCasRefSchema.parse({ ...baseCas, downloadUrl: 'https://cdn.minreport.com/a.webp' }));
        assert.ok(CanonicalEvidenceCasRefSchema.parse({ ...baseCas, downloadUrl: 'offline-cas://aaaa.webp' }));

        for (const badUrl of [
            'javascript:alert(1)',
            'JAVASCRIPT:void(0)',
            'http://insecure.example.com/a.webp',
            'file:///etc/passwd',
            'data:image/png;base64,iVBORw0KGgo=',
            '/api/media/blob/fake;base64,AAAA',
        ]) {
            assert.throws(
                () => CanonicalEvidenceCasRefSchema.parse({ ...baseCas, downloadUrl: badUrl }),
                `Dangerous CAS downloadUrl MUST be rejected: ${badUrl}`
            );
        }
    }

    // -----------------------------------------------------------------------
    // 3. Real supplyApi.ts Normalizers Against Backend Payloads (P0-07, P0-08)
    // -----------------------------------------------------------------------
    console.log('3) Testing real supplyApi.ts normalizers (Receipt OCR, Inventory, ExpenseReport, Forecast, PARTIAL_DISCREPANCY & /reset)...');
    {
        // 3a. ReceiptIntelligencePipeline real payload with `lines[].description` and `arithmeticCheck` mismatch
        const receiptDraft = supplyApiMod.normalizeReceiptAnalysisDraft(
            {
                success: true,
                analysis: {
                    extractionSource: 'TED_PLUS_AI',
                    supplierTaxId: '76192083-9',
                    supplierRutValid: true,
                    supplierName: 'Ferretería Industrial Norte SpA',
                    documentType: 33,
                    folio: 4501,
                    issueDate: '2026-11-21',
                    netAmountClp: 100000,
                    vatAmountClp: 19000,
                    totalAmountClp: 119000,
                    duplicateDetected: false,
                    missingInvoiceAlert: false,
                    arithmeticCheck: {
                        valid: false,
                        verified: false,
                        linesSumClp: 120500,
                        expectedTotalClp: 119000,
                        deltaClp: 1500,
                        pricingBasis: 'MISMATCH',
                    },
                    lines: [
                        {
                            purchaseLineId: 'pl_ocr_1',
                            canonicalSkuId: 'sku-filtro-hidraulico',
                            description: 'Filtro Hidráulico CAT 1R-0750',
                            categoryCode: 'REPUESTOS_MAQUINARIA',
                            procurementBucket: 'REPUESTOS_OPERMAQ',
                            unitSi: 'un',
                            qtyPurchased: 2,
                            unitPriceClp: 60250,
                            subtotalClp: 120500,
                            destination: 'STOCK_IN_TRANSIT',
                        },
                    ],
                },
            },
            { siteId: 'site-atacama', purchaseMode: 'REQUISITION_FULFILLMENT' }
        );

        assert.equal(receiptDraft.lines.length, 1);
        assert.equal(
            receiptDraft.lines[0].rawDescription,
            'Filtro Hidráulico CAT 1R-0750',
            'OCR raw.description must NEVER be lost or fall back to ITEM'
        );
        assert.equal(receiptDraft.lines[0].normalizedName, 'Filtro Hidráulico CAT 1R-0750');
        assert.equal(receiptDraft.arithmeticMismatch, true);
        assert.equal(receiptDraft.arithmeticDeltaClp, 1500);
        assert.equal(receiptDraft.arithmeticCheck.valid, false);
        assert.equal(receiptDraft.source, 'TED_XML');
        assert.equal(receiptDraft.supplierTaxIdValid, true);
        assert.ok(receiptDraft.warnings.includes('ARITHMETIC_MISMATCH'));

        // Also test AI_VISION_OCR source mapping
        const ocrDraft = supplyApiMod.normalizeReceiptAnalysisDraft({
            extractionSource: 'AI_VISION_OCR',
            arithmeticCheck: { valid: true, deltaClp: 0 },
            lines: [{ description: 'Bandeja Huevos Primera', quantity: 2, subtotalClp: 12000 }],
        });
        assert.equal(ocrDraft.source, 'OCR_GEMINI');
        assert.equal(ocrDraft.arithmeticMismatch, false);
        assert.equal(ocrDraft.lines[0].rawDescription, 'Bandeja Huevos Primera');

        // 3b. Inventory item normalizer with backend `inventoryKey`, `qtyOnHand`, `ewmaDailyConsumption`
        const inv = supplyApiMod.normalizeInventoryItem({
            inventoryKey: 'tenant-1__site-atacama__sku-papas',
            tenantId: 'tenant-1',
            siteId: 'site-atacama',
            canonicalSkuId: 'sku-papas',
            itemName: 'Papas Malla 25kg',
            categoryCode: 'VIVERES_ALIMENTACION',
            unitSi: 'kg',
            qtyOnHand: 150,
            qtyInTransit: 25,
            ewmaDailyConsumption: 12.5,
            minSafetyStock: 50,
            estimatedDoiDays: 14,
        });
        assert.equal(inv.itemId, 'tenant-1__site-atacama__sku-papas');
        assert.equal(inv.siteId, 'site-atacama');
        assert.equal(inv.qtyInWarehouse, 150);
        assert.equal(inv.ewmaDailyRate, 12.5);
        assert.equal(inv.minSafetyQty, 50);
        assert.equal(inv.doiDays, 14);

        // 3c. SII Expense Report normalizer with backend `custodianName`, `custodianUid`, `advanceAmountClp`
        const exp = supplyApiMod.normalizeSiiExpenseReport({
            reportId: 'expr_nov_2026',
            tenantId: 'tenant-1',
            siteId: 'site-atacama',
            title: 'Rendición Turno Noviembre',
            custodianName: 'Carlos Bodega',
            custodianUid: 'uid-bodega',
            advanceAmountClp: 500000,
            totalRenderedClp: 380000,
            balanceDueClp: 120000,
            siiDocumentIds: ['sii_1', 'sii_2'],
            status: 'SUBMITTED',
            retentionUntil: '2032-11-21T00:00:00.000Z',
        });
        assert.equal(exp.holderName, 'Carlos Bodega');
        assert.equal(exp.custodianName, 'Carlos Bodega');
        assert.equal(exp.holderUid, 'uid-bodega');
        assert.equal(exp.fundAdvanceClp, 500000);
        assert.equal(exp.renderedTotalClp, 380000);
        assert.equal(exp.balanceClp, 120000);
        assert.deepEqual(exp.documentIds, ['sii_1', 'sii_2']);

        // 3d. Forecast normalizer with real SupplyRepository.computeForecastReadOnly payload (waterStoredL > 0!)
        const forecast = supplyApiMod.normalizeForecast({
            forecastId: 'fcst_t1_site1',
            tenantId: 'tenant-1',
            siteId: 'site-atacama',
            headcount: 40,
            leadTimeDays: 7,
            altitudeM: 3400,
            altitudeMultiplier: 1.15,
            ds594WaterTargetLPerPax: 120,
            requiredWaterReserveL: 38640,
            waterStorageCapacityL: 25000,
            waterCoverageDays: 4.53,
            waterAlertLevel: 'WARNING',
            dailyFoodOpexClpPerPax: 9500,
        });
        assert.equal(forecast.waterStoredL, 25000, 'waterStoredL must read waterStorageCapacityL and never collapse to 0');
        assert.equal(forecast.waterRequiredLeadL, 38640);
        assert.equal(forecast.waterCoverageDays, 4.53);
        assert.equal(forecast.waterCompliantDs594, false);
        assert.equal(forecast.dailyOpexPerPaxClp, 9500);
        assert.equal(forecast.monthlyProjectedClp, 11400000);

        // 3e. PARTIAL_DISCREPANCY preservation & /reset -> CANCELAR simulator alignment
        const partialPurchase = supplyApiMod.normalizePurchaseRecord({
            purchaseId: 'pur_partial_1',
            tenantId: 'tenant-1',
            siteId: 'site-atacama',
            folio: 8821,
            receptionStatus: 'PARTIAL_DISCREPANCY',
            lines: [
                {
                    purchaseLineId: 'pl_1',
                    description: 'Cemento Portland 25kg',
                    qtyPurchased: 10,
                    qtyReceivedSoFar: 4,
                    unitSi: 'kg',
                },
            ],
        });
        assert.equal(partialPurchase.receptionStatus, 'PARTIAL_DISCREPANCY');
        assert.equal(partialPurchase.folio, '8821');
        assert.equal(partialPurchase.lines[0].rawDescription, 'Cemento Portland 25kg');
        assert.equal(partialPurchase.lines[0].qtyReceived, 4);

        const resetPayload = supplyApiMod.buildWhatsAppSimulateRequestPayload({
            phoneE164: '+56900001234',
            siteId: 'site-atacama',
            simulateSenderRole: 'CAMP_MANAGER',
            text: '/reset',
            resetSession: true,
        });
        assert.equal(resetPayload.text, 'CANCELAR');
        assert.equal(resetPayload.flushImmediately, true);
    }

    console.log('4) Testing V3-E01 contracts: 15 WS channels, warehouses, tank telemetry, ledger movement types & legacy normalizers...');
    {
        const contractsMod = require('../../../contracts/supply.contracts');
        const mirrorMod = webContractsMod as Record<string, any>;
        assert.equal(contractsMod.ANONYMITY_K_MIN, 5);
        assert.equal(mirrorMod.ANONYMITY_K_MIN, 5);
        assert.equal(contractsMod.CANONICAL_WHATSAPP_CHANNEL_IDS.length, 15);
        assert.deepEqual(mirrorMod.CANONICAL_WHATSAPP_CHANNEL_IDS, contractsMod.CANONICAL_WHATSAPP_CHANNEL_IDS);
        assert.equal(contractsMod.CANONICAL_SUPPLY_CATEGORIES.length, 21);
        assert.deepEqual(mirrorMod.CANONICAL_SUPPLY_CATEGORIES, contractsMod.CANONICAL_SUPPLY_CATEGORIES);
        assert.equal(contractsMod.CANONICAL_PROCUREMENT_BUCKETS.length, 15);
        assert.deepEqual(mirrorMod.CANONICAL_PROCUREMENT_BUCKETS, contractsMod.CANONICAL_PROCUREMENT_BUCKETS);
        assert.equal(contractsMod.STANDARD_SUPPLY_COST_CENTERS.length, 11);
        assert.deepEqual(mirrorMod.STANDARD_SUPPLY_COST_CENTERS, contractsMod.STANDARD_SUPPLY_COST_CENTERS);
        assert.equal(contractsMod.CANONICAL_STOCK_LEDGER_MOVEMENT_TYPES.length, 9);
        assert.deepEqual(mirrorMod.CANONICAL_STOCK_LEDGER_MOVEMENT_TYPES, contractsMod.CANONICAL_STOCK_LEDGER_MOVEMENT_TYPES);

        assert.equal(contractsMod.SupplyWhatsAppChannelIdSchema.parse('CH_CAMP_POTABLE_WATER'), 'CH_CAMP_POTABLE_WATER');
        assert.equal(contractsMod.SupplyWhatsAppChannelIdSchema.parse('CH_CONTROLLED_DGMN'), 'CH_CONTROLLED_DGMN');
        assert.equal(contractsMod.LinePricingBasisSchema.parse('NET'), 'NET');
        assert.equal(contractsMod.SupplyCategoryCodeSchema.parse('AGUA_POTABLE'), 'AGUA_POTABLE_BEBESTIBLE');
        assert.equal(contractsMod.ProcurementBucketSchema.parse('FERRETERIA'), 'FERRETERIA_INSUMOS');
        assert.equal(contractsMod.ProcurementBucketSchema.parse('REPUESTOS_OPERMAQ'), 'REPUESTOS_LUBRICANTES');
        assert.equal(contractsMod.StockLedgerMovementTypeSchema.parse('INBOUND_IN_TRANSIT'), 'INBOUND_TRANSIT');
        assert.equal(contractsMod.StockLedgerMovementTypeSchema.parse('RECEPTION_CONFIRMED'), 'RECEIPT_AT_WAREHOUSE');
        assert.equal(contractsMod.normalizeLegacyCostCenter('CC-CAMPAMENTO', 'AGUA_POTABLE_BEBESTIBLE'), 'CC-CAMP-AGUA');
        assert.equal(contractsMod.normalizeLegacyCostCenter('CC-OPERACIONES'), 'CC-OPS-MINA');

        const wh = contractsMod.SupplyWarehouseSchema.parse({
            warehouseId: 'wh-camp-water-1',
            tenantId: 'tenant-atacama',
            siteId: 'site-norte',
            code: 'BOD-AGUA-CAMP-01',
            name: 'Estanque Agua Potable Norte',
            warehouseClass: 'POTABLE_WATER_TANK',
            allowedChannelIds: ['CH_CAMP_POTABLE_WATER'],
            defaultCostCenter: 'CC-CAMP-AGUA',
            capacityUnitSi: 'L',
            maxCapacitySi: 40000,
        });
        assert.equal(wh.warehouseClass, 'POTABLE_WATER_TANK');
        assert.equal(wh.code, 'BOD-AGUA-CAMP-01');

        const tank = contractsMod.SupplyTankTelemetrySchema.parse({
            telemetryId: 'tlm-1',
            tenantId: 'tenant-atacama',
            siteId: 'site-norte',
            warehouseId: 'wh-camp-water-1',
            warehouseClass: 'POTABLE_WATER_TANK',
            canonicalSkuId: 'SKU-AGUA-POTABLE-CAMION',
            measuredAtIso: '2026-11-23T12:00:00Z',
            measuredLevelSi: 28000,
            capacitySi: 40000,
            occupancyPct: 70,
            bookBalanceSi: 28000,
            varianceSi: 0,
            variancePct: 0,
            measuredByUid: 'uid-camp-1',
        });
        assert.equal(tank.occupancyPct, 70);
    }

    console.log('\n✅ ALL E04 CANONICAL CONTRACTS, GLOBAL PRIMITIVES & NORMALIZER TESTS PASSED (4/4)!');
}

runTests().catch((err) => {
    console.error('\n❌ E04 CONTRACTS TEST SUITE FAILED:', err);
    process.exit(1);
});
