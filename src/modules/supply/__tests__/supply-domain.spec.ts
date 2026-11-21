/**
 * MINREPORT · ABASTECIMIENTO — Suite Completa de Pruebas Unitarias de Motores de Dominio
 *
 * Ejecutable standalone sin Firestore ni llamadas de red:
 *   npx ts-node src/modules/supply/__tests__/supply-domain.spec.ts
 *
 * Cubre determinísticamente los 8 motores de dominio y todos los escenarios reales de negocio.
 */

import assert from 'node:assert/strict';
import {
    // Catalog & Types
    DEFAULT_ROLE_PROFILES,
    SupplyPurchase,
    SupplyRequisition,
    SupplySite,
    findCanonicalSkuById,
    // 1. UnitNormalizationEngine
    normalizeQuantityToSi,
    normalizeUnitExpression,
    // 2. SupplyPolicyAndAnomalyEngine
    checkGlobalHardDeny,
    evaluateDirectPurchaseAuthority,
    evaluateRequisitionPolicy,
    // 3. ConversationSlotValidator
    ConversationDraftSession,
    advanceConversationTurn,
    // 4. SmartShoppingListConsolidator
    consolidateRequisitionsToShoppingList,
    // 5. RequisitionFulfillmentMatcher
    matchPurchaseToRequisitions,
    // 6. StockAssetCashCostReconciler
    computeFoodCostPerPaxDay,
    computeInventoryBalances,
    confirmWarehouseReception,
    reconcileFundAdvanceReport,
    reconcilePurchase,
    // 7. SiiTaxValidator
    buildSiiDedupeKey,
    computeRcvAcceptanceDeadline,
    exportSiiDocumentsToAccountantCsv,
    parseSiiTedPdf417,
    parseSiiXmlDte,
    validateSiiDocumentForPurchase,
    verifyDocumentArithmetic,
    // 8. DemandAndCostForecaster
    TenantDemandObservation,
    computeEwmaSeries,
    evaluateDs594WaterGuardrail,
    forecastSkuDemand,
    projectAnonymousDemandSignals,
} from '../domain';

interface TestCase {
    name: string;
    fn: () => void;
}

const tests: TestCase[] = [];
function test(name: string, fn: () => void): void {
    tests.push({ name, fn });
}

// ============================================================================
// 1. UNIT NORMALIZATION ENGINE
// ============================================================================
test('1.1 UnitNormalizationEngine: normaliza jerga minera chilena/LatAm y Ley del Saco 25 kg', () => {
    const mallaPapas = normalizeUnitExpression('malla de papas');
    assert.equal(mallaPapas.quantitySi, 25);
    assert.equal(mallaPapas.unitSi, 'kg');
    assert.equal(mallaPapas.leySaco25kgApplied, true);
    assert.equal(mallaPapas.canonicalSkuHint, 'SKU-VIV-PAPAS');

    const dosMallasPapas = normalizeUnitExpression('2 mallas de papas');
    assert.equal(dosMallasPapas.quantitySi, 50);
    assert.equal(dosMallasPapas.unitSi, 'kg');
    assert.equal(dosMallasPapas.leySaco25kgApplied, true);

    const sacoCemento = normalizeUnitExpression('saco de cemento');
    assert.equal(sacoCemento.quantitySi, 25);
    assert.equal(sacoCemento.unitSi, 'kg');
    assert.equal(sacoCemento.leySaco25kgApplied, true);

    const bandejaHuevos = normalizeUnitExpression('bandeja de huevos');
    assert.equal(bandejaHuevos.quantitySi, 30);
    assert.equal(bandejaHuevos.unitSi, 'un');

    const poteMantequilla = normalizeUnitExpression('pote de mantequilla');
    assert.equal(poteMantequilla.quantitySi, 0.25);
    assert.equal(poteMantequilla.unitSi, 'kg');

    const balon45 = normalizeUnitExpression('balón de 45');
    assert.equal(balon45.quantitySi, 45);
    assert.equal(balon45.unitSi, 'kg');

    const balon15 = normalizeUnitExpression('2 balones de 15');
    assert.equal(balon15.quantitySi, 30);
    assert.equal(balon15.unitSi, 'kg');

    const bototos = normalizeUnitExpression('3 bototos');
    assert.equal(bototos.quantitySi, 3);
    assert.equal(bototos.unitSi, 'par');

    const bidon20 = normalizeUnitExpression('bidón 20L');
    assert.equal(bidon20.quantitySi, 20);
    assert.equal(bidon20.unitSi, 'L');

    const bidon20Space = normalizeUnitExpression('3 bidones 20 L');
    assert.equal(bidon20Space.quantitySi, 60);
    assert.equal(bidon20Space.unitSi, 'L');

    const decimalComma = normalizeUnitExpression('1,5 kilos de papas');
    assert.equal(decimalComma.quantitySi, 1.5);
    assert.equal(decimalComma.unitSi, 'kg');

    const mediaDocena = normalizeUnitExpression('media docena de huevos');
    assert.equal(mediaDocena.quantitySi, 6);
    assert.equal(mediaDocena.unitSi, 'un');
});

test('1.2 UnitNormalizationEngine: respeta alias personalizados por tenant con máxima prioridad', () => {
    const customRes = normalizeQuantityToSi({
        quantity: 3,
        unitRaw: 'jaba minera',
        itemText: 'agua purificada',
        tenantAliases: [
            {
                alias: 'jaba minera',
                factorToSi: 12,
                unitSi: 'L',
            },
        ],
    });
    assert.equal(customRes.quantitySi, 36);
    assert.equal(customRes.unitSi, 'L');
    assert.equal(customRes.matchedAlias, 'jaba minera');
});

// ============================================================================
// 2. SUPPLY POLICY AND ANOMALY ENGINE
// ============================================================================
test('2.1 SupplyPolicyAndAnomalyEngine: GLOBAL_HARD_DENY (DS 132) bloquea cerveza/helicóptero y acepta tallarines en solicitud mixta', () => {
    // Bloqueo absoluto incluso para OWNER_EXEC
    assert.equal(checkGlobalHardDeny('2 cajas de cerveza').denied, true);
    assert.equal(checkGlobalHardDeny('un helicóptero para la faena').denied, true);
    assert.equal(checkGlobalHardDeny('botella de pisco y vino').denied, true);
    assert.equal(checkGlobalHardDeny('cajetilla de cigarros').denied, true);
    assert.equal(checkGlobalHardDeny('ferrari rojo').denied, true);

    // Excepciones legítimas (no falsos positivos)
    assert.equal(checkGlobalHardDeny('alcohol gel desinfectante 5L').denied, false);
    assert.equal(checkGlobalHardDeny('balón de 45 kg GLP').denied, false);

    // Solicitud mixta exacta: cerveza + helicóptero + tallarines
    const mixed = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'i1',
                rawText: '2 cajas de cerveza',
                categoryCode: 'VIVERES_ALIMENTACION',
                quantitySi: 2,
                unitSi: 'caja',
            },
            {
                itemKey: 'i2',
                rawText: '1 helicóptero',
                categoryCode: 'ACTIVO_EQUIPAMIENTO',
                quantitySi: 1,
                unitSi: 'un',
            },
            {
                itemKey: 'i3',
                rawText: '10 paquetes de tallarines',
                canonicalSkuId: 'SKU-SUP-TALLARINES',
                sku: findCanonicalSkuById('SKU-SUP-TALLARINES'),
                categoryCode: 'VIVERES_ALIMENTACION',
                quantitySi: 4,
                unitSi: 'kg',
            },
        ],
        {
            requesterRole: 'OWNER_EXEC',
            demandNature: 'REACTIVE_FIELD',
        }
    );

    assert.equal(mixed.hasHardDenies, true);
    assert.equal(mixed.rejectedItems.length, 2);
    assert.equal(mixed.acceptedItems.length, 1);
    assert.equal(mixed.acceptedItems[0].canonicalSkuId, 'SKU-SUP-TALLARINES');
    assert.ok(mixed.politeRejectionSummarySpanish?.includes('DS 132'));
    assert.ok(mixed.politeRejectionSummarySpanish?.includes('insumos válidos sí fue considerado'));
});

test('2.2 SupplyPolicyAndAnomalyEngine: 5 banderas atípicas y modo FLAG_AND_ACCEPT vs STRICT_BLOCK', () => {
    const filtroSku = findCanonicalSkuById('SKU-OPM-FILTRO-ACEITE')!;
    const cocinaSku = findCanonicalSkuById('SKU-CAPEX-COCINA')!;

    const evalFlagAccept = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'a1',
                rawText: '5 filtros de aceite',
                canonicalSkuId: filtroSku.canonicalSkuId,
                sku: filtroSku,
                categoryCode: filtroSku.categoryCode,
                quantitySi: 5,
                unitSi: 'un',
            },
            {
                itemKey: 'a2',
                rawText: '1 cocina industrial',
                canonicalSkuId: cocinaSku.canonicalSkuId,
                sku: cocinaSku,
                categoryCode: cocinaSku.categoryCode,
                quantitySi: 1,
                unitSi: 'un',
                isCapexAsset: true,
            },
        ],
        {
            requesterRole: 'CAMP_MANAGER',
            demandNature: 'REACTIVE_FIELD',
            roleMismatchMode: 'FLAG_AND_ACCEPT',
            nowIso: '2026-11-21T12:00:00Z',
            ewmaExpectedQtyBySku: { [filtroSku.canonicalSkuId]: 2 }, // 5 > 2 * 1.45 -> SPIKE!
            recentRequisitions: [
                {
                    canonicalSkuId: filtroSku.canonicalSkuId,
                    requestedAtIso: '2026-11-20T18:00:00Z', // 18h atrás (< 48h) -> DUPLICATE_FREQ!
                    qtyRequestedSi: 2,
                },
            ],
            plannedSkuIds: ['SKU-VIV-PAPAS', 'SKU-SUP-PAN'], // filtro fuera de plan -> UNPLANNED_DRIFT!
        }
    );

    assert.equal(evalFlagAccept.acceptedItems.length, 2);
    const filtroFlags = evalFlagAccept.acceptedItems[0].atypicalFlags;
    assert.ok(filtroFlags.includes('ATYPICAL_ROLE_MISMATCH'));
    assert.ok(filtroFlags.includes('ATYPICAL_VOLUME_SPIKE'));
    assert.ok(filtroFlags.includes('ATYPICAL_DUPLICATE_FREQ'));
    assert.ok(filtroFlags.includes('ATYPICAL_UNPLANNED_DRIFT'));

    const cocinaFlags = evalFlagAccept.acceptedItems[1].atypicalFlags;
    assert.ok(cocinaFlags.includes('ATYPICAL_HIGH_VALUE_OR_CAPEX'));
    assert.ok(cocinaFlags.includes('ATYPICAL_ROLE_MISMATCH'));

    // Modo STRICT_BLOCK bloquea rol incompatible
    const evalStrict = evaluateRequisitionPolicy(
        [
            {
                itemKey: 's1',
                rawText: '2 filtros de aceite',
                canonicalSkuId: filtroSku.canonicalSkuId,
                sku: filtroSku,
                categoryCode: filtroSku.categoryCode,
                quantitySi: 2,
                unitSi: 'un',
            },
        ],
        {
            requesterRole: 'CAMP_MANAGER',
            demandNature: 'REACTIVE_FIELD',
            roleMismatchMode: 'STRICT_BLOCK',
        }
    );
    assert.equal(evalStrict.acceptedItems.length, 0);
    assert.equal(evalStrict.rejectedItems.length, 1);
    assert.equal(evalStrict.rejectedItems[0].rejectionCode, 'ROLE_MISMATCH_STRICT_BLOCK');

    // Stock suficiente en bodega + tránsito dispara ATYPICAL_DUPLICATE_FREQ sin requisición previa
    const papasSku = findCanonicalSkuById('SKU-VIV-PAPAS')!;
    const stockCover = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'stk1',
                rawText: '25 kilos de papas',
                canonicalSkuId: papasSku.canonicalSkuId,
                sku: papasSku,
                categoryCode: papasSku.categoryCode,
                quantitySi: 25,
                unitSi: 'kg',
            },
        ],
        {
            requesterRole: 'CAMP_MANAGER',
            demandNature: 'REACTIVE_FIELD',
            availableStockBySku: {
                [papasSku.canonicalSkuId]: { inWarehouseSi: 15, inTransitSi: 20 },
            },
        }
    );
    assert.ok(stockCover.acceptedItems[0].atypicalFlags.includes('ATYPICAL_DUPLICATE_FREQ'));

    // Insumo controlado (explosivos) bloqueado sin licencia DGMN y permitido con licencia
    const detSku = findCanonicalSkuById('SKU-EXP-DETONADOR')!;
    const unlicensed = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'exp1',
                rawText: '10 detonadores',
                canonicalSkuId: detSku.canonicalSkuId,
                sku: detSku,
                categoryCode: detSku.categoryCode,
                quantitySi: 10,
                unitSi: 'un',
                isControlled: true,
            },
        ],
        { requesterRole: 'CAMP_MANAGER', demandNature: 'REACTIVE_FIELD' }
    );
    assert.equal(unlicensed.rejectedItems[0].rejectionCode, 'CONTROLLED_LICENSE_REQUIRED');

    const licensed = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'exp2',
                rawText: '10 detonadores',
                canonicalSkuId: detSku.canonicalSkuId,
                sku: detSku,
                categoryCode: detSku.categoryCode,
                quantitySi: 10,
                unitSi: 'un',
                isControlled: true,
            },
        ],
        {
            requesterRole: 'OWNER_EXEC',
            memberProfile: DEFAULT_ROLE_PROFILES.OWNER_EXEC,
            demandNature: 'PLANNED_ENGINEERING',
        }
    );
    assert.equal(licensed.acceptedItems.length, 1);
});

test('2.3 SupplyPolicyAndAnomalyEngine: autoridad de compra directa autónoma (OWNER_EXEC, SITE_ADMIN, BUYER, CAMP_MANAGER)', () => {
    const ownerAuth = evaluateDirectPurchaseAuthority({
        role: 'OWNER_EXEC',
        totalAmountClp: 5_000_000,
        includesCapexAsset: true,
    });
    assert.equal(ownerAuth.authorized, true);
    assert.equal(ownerAuth.autoApproved, true);
    assert.equal(ownerAuth.capexAllowed, true);
    assert.equal(ownerAuth.notifyOwnerInfoOnly, false);

    const buyerHighAuth = evaluateDirectPurchaseAuthority({
        role: 'BUYER',
        totalAmountClp: 480_000,
        includesCapexAsset: true,
        ownerInfoAlertThresholdClp: 250_000,
    });
    assert.equal(buyerHighAuth.authorized, true);
    assert.equal(buyerHighAuth.notifyOwnerInfoOnly, true);
    assert.ok(buyerHighAuth.alertReason?.includes('Gerencia'));

    const adminLowAuth = evaluateDirectPurchaseAuthority({
        role: 'SITE_ADMIN',
        totalAmountClp: 85_000,
        includesCapexAsset: false,
        ownerInfoAlertThresholdClp: 250_000,
    });
    assert.equal(adminLowAuth.authorized, true);
    assert.equal(adminLowAuth.notifyOwnerInfoOnly, false);

    const campAuth = evaluateDirectPurchaseAuthority({
        role: 'CAMP_MANAGER',
        totalAmountClp: 50_000,
        includesCapexAsset: false,
    });
    assert.equal(campAuth.authorized, false);
});

// ============================================================================
// 3. CONVERSATION SLOT VALIDATOR (FSM)
// ============================================================================
test('3.1 ConversationSlotValidator: escenario exacto "Mantequilla, 2 kilos de papas y huevos" -> SLOT_FILLING -> REVIEW_GATE -> COMMITTED', () => {
    const initialSession: ConversationDraftSession = {
        sessionId: 'wa-sess-001',
        tenantId: 'tenant-atacama-01',
        siteId: 'site-copiapo-01',
        requesterUid: 'uid-camp-01',
        requesterName: 'María Campamento',
        requesterRole: 'CAMP_MANAGER',
        demandOrigin: 'WA_CAMP',
        demandNature: 'REACTIVE_FIELD',
        costCenter: 'CC-CAMPAMENTO',
        state: 'COLLECTING',
        items: [],
        rejectedItems: [],
    };

    // Turno 1: mensaje incompleto
    const turn1 = advanceConversationTurn(
        initialSession,
        'Mantequilla, 2 kilos de papas y huevos',
        { policyContext: {} }
    );

    assert.equal(turn1.nextState, 'SLOT_FILLING');
    assert.deepEqual(turn1.passedThroughStates, ['COLLECTING', 'POLICY_CHECK', 'SLOT_FILLING']);

    const papasSlot = turn1.slotResults.find((s) => s.canonicalSkuId === 'SKU-VIV-PAPAS');
    const mantequillaSlot = turn1.slotResults.find((s) => s.canonicalSkuId === 'SKU-SUP-MANTEQUILLA');
    const huevosSlot = turn1.slotResults.find((s) => s.canonicalSkuId === 'SKU-SUP-HUEVOS');

    assert.ok(papasSlot?.complete);
    assert.deepEqual(papasSlot?.missingMandatorySlots, []);

    assert.equal(mantequillaSlot?.complete, false);
    assert.ok(mantequillaSlot?.missingMandatorySlots.includes('quantity'));
    assert.ok(mantequillaSlot?.missingMandatorySlots.includes('packagingUnit'));
    assert.equal(mantequillaSlot?.questionSpanish, '¿Cuántos potes o panes de mantequilla?');

    assert.equal(huevosSlot?.complete, false);
    assert.deepEqual(huevosSlot?.missingMandatorySlots, ['quantity']);
    assert.equal(huevosSlot?.questionSpanish, '¿Cuántas bandejas (30 un) o cuántos huevos?');

    // Burbuja única consolidada (FinOps) contiene ambas preguntas
    assert.ok(turn1.outboundBubbleSpanish.includes('¿Cuántos potes o panes de mantequilla?'));
    assert.ok(turn1.outboundBubbleSpanish.includes('¿Cuántas bandejas (30 un) o cuántos huevos?'));

    // Turno 2: usuario responde los slots faltantes en un solo mensaje
    const turn2 = advanceConversationTurn(
        turn1.session,
        '4 potes de mantequilla y 2 bandejas de huevos',
        { policyContext: {} }
    );

    assert.equal(turn2.nextState, 'REVIEW_GATE');
    assert.ok(turn2.slotResults.every((s) => s.complete));
    assert.ok(turn2.outboundBubbleSpanish.includes('1. '));
    assert.ok(turn2.outboundBubbleSpanish.includes('2. '));
    assert.ok(turn2.outboundBubbleSpanish.includes('3. '));
    assert.ok(turn2.outboundBubbleSpanish.includes('OK'));

    // Turno 3: confirmación explícita
    const turn3 = advanceConversationTurn(turn2.session, 'OK', { policyContext: {} });
    assert.equal(turn3.nextState, 'COMMITTED');
    assert.equal(turn3.committedLines?.length, 3);

    const committedPapas = turn3.committedLines!.find((l) => l.canonicalSkuId === 'SKU-VIV-PAPAS');
    const committedMantequilla = turn3.committedLines!.find((l) => l.canonicalSkuId === 'SKU-SUP-MANTEQUILLA');
    const committedHuevos = turn3.committedLines!.find((l) => l.canonicalSkuId === 'SKU-SUP-HUEVOS');

    assert.equal(committedPapas?.qtyRequested, 2);
    assert.equal(committedPapas?.unitSi, 'kg');
    assert.equal(committedMantequilla?.qtyRequested, 1); // 4 potes * 0.25 kg
    assert.equal(committedMantequilla?.unitSi, 'kg');
    assert.equal(committedHuevos?.qtyRequested, 60); // 2 bandejas * 30 un
    assert.equal(committedHuevos?.unitSi, 'un');
});

test('3.2 ConversationSlotValidator: exige talla en EPP, ubicación en reparación (foto opcional) y equipo en mecánico', () => {
    const eppSession: ConversationDraftSession = {
        sessionId: 'wa-epp-1',
        tenantId: 't1',
        siteId: 's1',
        requesterUid: 'u-hsec',
        requesterName: 'Carlos HSEC',
        requesterRole: 'HSEC_OFFICER',
        demandOrigin: 'WA_WAREHOUSE_HSEC',
        demandNature: 'REACTIVE_FIELD',
        costCenter: 'CC-HSEC',
        state: 'COLLECTING',
        items: [],
        rejectedItems: [],
    };
    const eppT1 = advanceConversationTurn(eppSession, '2 pares de bototos', { policyContext: {} });
    assert.equal(eppT1.nextState, 'SLOT_FILLING');
    assert.deepEqual(eppT1.slotResults[0].missingMandatorySlots, ['size']);

    const eppT2 = advanceConversationTurn(eppT1.session, '42', { policyContext: {} });
    assert.equal(eppT2.nextState, 'REVIEW_GATE');
    assert.equal(eppT2.session.items[0].size, '42');
    assert.equal(eppT2.session.items[0].quantitySi, 2); // Respuesta bare "42" no sobreescribe los 2 pares!

    // Solicitud mixta con hard-deny dentro de la FSM: rechaza cerveza y helicóptero, pasa tallarines a REVIEW_GATE
    const mixedFsmSession: ConversationDraftSession = {
        ...eppSession,
        sessionId: 'wa-mixed-1',
        requesterRole: 'CAMP_MANAGER',
        demandOrigin: 'WA_CAMP',
        costCenter: 'CC-CAMPAMENTO',
    };
    const mixedT1 = advanceConversationTurn(
        mixedFsmSession,
        '2 cajas de cerveza, 1 helicóptero y 10 paquetes de tallarines',
        { policyContext: {} }
    );
    assert.equal(mixedT1.nextState, 'REVIEW_GATE');
    assert.equal(mixedT1.session.rejectedItems.length, 2);
    assert.equal(mixedT1.session.items.length, 1);
    assert.equal(mixedT1.session.items[0].quantitySi, 4); // 10 * 0.4 kg
    assert.ok(mixedT1.outboundBubbleSpanish.includes('descartados por política'));
    assert.ok(mixedT1.outboundBubbleSpanish.includes('Tallarines: 4 kg'));

    // Reparación campamento: ubicación obligatoria, foto opcional no bloquea
    const repairSession: ConversationDraftSession = {
        ...eppSession,
        sessionId: 'wa-rep-1',
        requesterRole: 'CAMP_MANAGER',
        demandOrigin: 'WA_CAMP',
        costCenter: 'CC-CAMPAMENTO',
    };
    const repT1 = advanceConversationTurn(repairSession, 'reparación fuga de agua', {
        policyContext: {},
    });
    assert.equal(repT1.nextState, 'SLOT_FILLING');
    assert.deepEqual(repT1.slotResults[0].missingMandatorySlots, ['location']);
    assert.ok(repT1.slotResults[0].optionalHints.includes('photoOptional'));

    const repT2 = advanceConversationTurn(repT1.session, 'baño pabellón B', { policyContext: {} });
    assert.equal(repT2.nextState, 'REVIEW_GATE'); // Sin foto igualmente avanza

    // Mecánico: exige linkedAssetId
    const mechSession: ConversationDraftSession = {
        ...eppSession,
        sessionId: 'wa-mech-1',
        requesterRole: 'MECHANIC_TECH',
        demandOrigin: 'WA_MECHANIC',
        costCenter: 'CC-FLOTA',
    };
    const mechT1 = advanceConversationTurn(mechSession, '2 filtros de aceite', { policyContext: {} });
    assert.equal(mechT1.nextState, 'SLOT_FILLING');
    assert.deepEqual(mechT1.slotResults[0].missingMandatorySlots, ['linkedAssetId']);

    const mechT2 = advanceConversationTurn(mechT1.session, 'para equipo CAT-320', { policyContext: {} });
    assert.equal(mechT2.nextState, 'REVIEW_GATE');
    assert.equal(mechT2.session.items[0].linkedAssetId, 'CAT-320');
});

// ============================================================================
// 4. SMART SHOPPING LIST CONSOLIDATOR (13 REQUISICIONES MIXTAS)
// ============================================================================
test('4.1 SmartShoppingListConsolidator: consolida 13 requisiciones mixtas por comercio, ordena CRITICAL->PARTIAL->STANDARD y conserva trazabilidad inversa', () => {
    const mkReq = (
        id: string,
        costCenter: string,
        origin: SupplyRequisition['demandOrigin'],
        lines: SupplyRequisition['lines'],
        status: SupplyRequisition['status'] = 'OPEN'
    ): SupplyRequisition => ({
        reqId: id,
        tenantId: 'tenant-norte-01',
        siteId: 'site-faena-01',
        requesterUid: `uid-${id}`,
        requesterName: `Solicitante ${id}`,
        requesterRole: 'CAMP_MANAGER',
        demandOrigin: origin,
        demandNature: 'REACTIVE_FIELD',
        costCenter,
        status,
        createdAt: `2026-11-20T0${id.slice(-1)}:00:00Z`,
        lines,
    });

    const requisitions: SupplyRequisition[] = [
        // 1. Verdulería STANDARD (papas 50 kg)
        mkReq('REQ-01', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-VIV-PAPAS', description: 'Papas',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'VERDULERIA', unitSi: 'kg',
                qtyRequested: 50, qtyPurchased: 0, qtyReceived: 0, qtyPending: 50,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ]),
        // 2. Verdulería PARTIAL (papas 25 kg restantes de 50) + tomates STANDARD
        mkReq('REQ-02', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-VIV-PAPAS', description: 'Papas',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'VERDULERIA', unitSi: 'kg',
                qtyRequested: 50, qtyPurchased: 25, qtyReceived: 25, qtyPending: 25,
                lineStatus: 'PARTIAL', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-VIV-TOMATES', description: 'Tomates',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'VERDULERIA', unitSi: 'kg',
                qtyRequested: 18, qtyPurchased: 0, qtyReceived: 0, qtyPending: 18,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ], 'PARTIAL'),
        // 3. Verdulería CRITICAL (cebollas 25 kg)
        mkReq('REQ-03', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-VIV-CEBOLLAS', description: 'Cebollas',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'VERDULERIA', unitSi: 'kg',
                qtyRequested: 25, qtyPurchased: 0, qtyReceived: 0, qtyPending: 25,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ]),
        // 4. Supermercado PARTIAL (pan 6 kg pendientes)
        mkReq('REQ-04', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'kg',
                qtyRequested: 10, qtyPurchased: 4, qtyReceived: 0, qtyPending: 6,
                lineStatus: 'PARTIAL', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ], 'PARTIAL'),
        // 5. Supermercado OPEN (huevos 60 un + pan 10 kg)
        mkReq('REQ-05', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-SUP-HUEVOS', description: 'Huevos',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'un',
                qtyRequested: 60, qtyPurchased: 0, qtyReceived: 0, qtyPending: 60,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'kg',
                qtyRequested: 10, qtyPurchased: 0, qtyReceived: 0, qtyPending: 10,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ]),
        // 6. Supermercado CRITICAL + ATYPICAL (mantequilla 5 kg)
        mkReq('REQ-06', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-SUP-MANTEQUILLA', description: 'Mantequilla',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'kg',
                qtyRequested: 5, qtyPurchased: 0, qtyReceived: 0, qtyPending: 5,
                lineStatus: 'OPEN', atypicalFlags: ['ATYPICAL_VOLUME_SPIKE'], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ]),
        // 7. Ferretería OPEN (pernos 20 un)
        mkReq('REQ-07', 'CC-OPERACIONES', 'WA_OPS', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA', unitSi: 'un',
                qtyRequested: 20, qtyPurchased: 0, qtyReceived: 0, qtyPending: 20,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ]),
        // 8. Ferretería PARTIAL (pernos 15 un pendientes) + cemento CRITICAL (100 kg)
        mkReq('REQ-08', 'CC-OPERACIONES', 'MODULE_PLANNING', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA', unitSi: 'un',
                qtyRequested: 30, qtyPurchased: 15, qtyReceived: 15, qtyPending: 15,
                lineStatus: 'PARTIAL', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-FER-CEMENTO', description: 'Cemento Portland',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA', unitSi: 'kg',
                qtyRequested: 100, qtyPurchased: 0, qtyReceived: 0, qtyPending: 100,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ], 'PARTIAL'),
        // 9. Ferretería OPEN (clavos 10 kg) + línea YA FULFILLED (no debe sumarse!)
        mkReq('REQ-09', 'CC-OPERACIONES', 'WA_OPS', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-FER-CLAVOS', description: 'Clavos corrientes',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA', unitSi: 'kg',
                qtyRequested: 10, qtyPurchased: 0, qtyReceived: 0, qtyPending: 10,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos ya cubiertos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA', unitSi: 'un',
                qtyRequested: 50, qtyPurchased: 50, qtyReceived: 50, qtyPending: 0,
                lineStatus: 'FULFILLED', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ], 'PARTIAL'),
        // 10. Repuestos OPERMAQ CRITICAL (filtro aceite 3 un)
        mkReq('REQ-10', 'CC-FLOTA', 'MODULE_OPERMAQ', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-OPM-FILTRO-ACEITE', description: 'Filtro de aceite motor',
                categoryCode: 'LUBRICANTES_FILTROS', procurementBucket: 'REPUESTOS_OPERMAQ', unitSi: 'un',
                qtyRequested: 3, qtyPurchased: 0, qtyReceived: 0, qtyPending: 3,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ]),
        // 11. Repuestos OPERMAQ OPEN (filtro aceite 2 un + aceite 15W40 40 L)
        mkReq('REQ-11', 'CC-FLOTA', 'WA_MECHANIC', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-OPM-FILTRO-ACEITE', description: 'Filtro de aceite motor',
                categoryCode: 'LUBRICANTES_FILTROS', procurementBucket: 'REPUESTOS_OPERMAQ', unitSi: 'un',
                qtyRequested: 2, qtyPurchased: 0, qtyReceived: 0, qtyPending: 2,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-OPM-ACEITE-15W40', description: 'Aceite motor 15W-40',
                categoryCode: 'LUBRICANTES_FILTROS', procurementBucket: 'REPUESTOS_OPERMAQ', unitSi: 'L',
                qtyRequested: 40, qtyPurchased: 0, qtyReceived: 0, qtyPending: 40,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ]),
        // 12. EPP Seguridad (bototos 4 par + guantes 12 par)
        mkReq('REQ-12', 'CC-HSEC', 'MODULE_HSEC', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-EPP-BOTOTOS', description: 'Bototos de seguridad',
                categoryCode: 'EPP_SEGURIDAD', procurementBucket: 'EPP_SEGURIDAD', unitSi: 'par',
                qtyRequested: 4, qtyPurchased: 0, qtyReceived: 0, qtyPending: 4,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'HIGH',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-EPP-GUANTES', description: 'Guantes de seguridad',
                categoryCode: 'EPP_SEGURIDAD', procurementBucket: 'EPP_SEGURIDAD', unitSi: 'par',
                qtyRequested: 12, qtyPurchased: 0, qtyReceived: 0, qtyPending: 12,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ]),
        // 13. Gas / Agua CRITICAL (GLP 45 kg * 2 = 90 kg + agua bidón 200 L)
        mkReq('REQ-13', 'CC-CAMPAMENTO', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-GAS-GLP45', description: 'Gas licuado GLP 45 kg',
                categoryCode: 'GAS_ENERGIA_CAMP', procurementBucket: 'GAS_AGUA_COMBUSTIBLE', unitSi: 'kg',
                qtyRequested: 90, qtyPurchased: 0, qtyReceived: 0, qtyPending: 90,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-AGUA-BIDON', description: 'Agua potable en bidón',
                categoryCode: 'AGUA_POTABLE', procurementBucket: 'GAS_AGUA_COMBUSTIBLE', unitSi: 'L',
                qtyRequested: 200, qtyPurchased: 0, qtyReceived: 0, qtyPending: 200,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ]),
    ];

    assert.equal(requisitions.length, 13);

    const list = consolidateRequisitionsToShoppingList(requisitions, {
        generatedAt: '2026-11-21T10:00:00Z',
    });

    assert.equal(list.sourceRequisitionCount, 13);
    assert.equal(list.buckets.length, 6); // Verdulería, Supermercado, Ferretería, Repuestos, EPP, Gas/Agua
    assert.equal(list.totalAtypicalCount, 1);

    // Verificar orden CRITICAL -> PARTIAL_PENDING -> STANDARD en VERDULERIA
    const verduleria = list.buckets.find((b) => b.procurementBucket === 'VERDULERIA')!;
    assert.deepEqual(
        verduleria.items.map((i) => `${i.canonicalSkuId}:${i.priorityTier}`),
        [
            'SKU-VIV-CEBOLLAS:CRITICAL',
            'SKU-VIV-PAPAS:PARTIAL_PENDING',
            'SKU-VIV-TOMATES:STANDARD',
        ]
    );
    const papasConsolidated = verduleria.items.find((i) => i.canonicalSkuId === 'SKU-VIV-PAPAS')!;
    assert.equal(papasConsolidated.totalQtyPending, 75); // 50 + 25
    assert.equal(papasConsolidated.sourceReqRefs.length, 2);

    // Verificar orden CRITICAL -> PARTIAL_PENDING -> STANDARD en FERRETERIA y exclusión de línea FULFILLED
    const ferreteria = list.buckets.find((b) => b.procurementBucket === 'FERRETERIA')!;
    assert.deepEqual(
        ferreteria.items.map((i) => `${i.canonicalSkuId}:${i.priorityTier}`),
        [
            'SKU-FER-CEMENTO:CRITICAL',
            'SKU-FER-PERNOS:PARTIAL_PENDING',
            'SKU-FER-CLAVOS:STANDARD',
        ]
    );
    const pernosConsolidated = ferreteria.items.find((i) => i.canonicalSkuId === 'SKU-FER-PERNOS')!;
    assert.equal(pernosConsolidated.totalQtyPending, 35); // 20 + 15 (excluyendo los 50 ya FULFILLED)

    // Verificar conservación exacta de trazabilidad inversa en TODOS los SKUs de TODOS los buckets
    for (const bucket of list.buckets) {
        for (const skuItem of bucket.items) {
            const sumRefs = skuItem.sourceReqRefs.reduce((acc, r) => acc + r.qtyPending, 0);
            assert.equal(sumRefs, skuItem.totalQtyPending);
            for (const ref of skuItem.sourceReqRefs) {
                assert.ok(ref.requisitionId.startsWith('REQ-'));
                assert.ok(ref.costCenter.startsWith('CC-'));
                assert.ok(ref.lineId.length > 0);
            }
        }
    }
});

// ============================================================================
// 5. REQUISITION FULFILLMENT MATCHER (N:M FIFO + DIRECT AUTONOMOUS)
// ============================================================================
test('5.1 RequisitionFulfillmentMatcher: escenario exacto Backlog {huevos 60, pernos 10, pan 10} vs Compra {pan 4, pernos 10, cocina 1}', () => {
    const backlog: SupplyRequisition[] = [
        {
            reqId: 'REQ-BACKLOG-1',
            tenantId: 't-minera',
            siteId: 's-1',
            requesterUid: 'u-camp',
            requesterName: 'Jefe Campamento',
            requesterRole: 'CAMP_MANAGER',
            demandOrigin: 'WA_CAMP',
            demandNature: 'REACTIVE_FIELD',
            costCenter: 'CC-CAMPAMENTO',
            status: 'OPEN',
            createdAt: '2026-11-20T08:00:00Z',
            lines: [
                {
                    lineId: 'L-HUEVOS', canonicalSkuId: 'SKU-SUP-HUEVOS', description: 'Huevos',
                    categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'un',
                    qtyRequested: 60, qtyPurchased: 0, qtyReceived: 0, qtyPending: 60,
                    lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
                },
                {
                    lineId: 'L-PAN', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                    categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'kg',
                    qtyRequested: 10, qtyPurchased: 0, qtyReceived: 0, qtyPending: 10,
                    lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
                },
            ],
        },
        {
            reqId: 'REQ-BACKLOG-2',
            tenantId: 't-minera',
            siteId: 's-1',
            requesterUid: 'u-ops',
            requesterName: 'Capataz Operaciones',
            requesterRole: 'OPS_FOREMAN',
            demandOrigin: 'WA_OPS',
            demandNature: 'REACTIVE_FIELD',
            costCenter: 'CC-OPERACIONES',
            status: 'OPEN',
            createdAt: '2026-11-20T09:00:00Z',
            lines: [
                {
                    lineId: 'L-PERNOS', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos',
                    categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA', unitSi: 'un',
                    qtyRequested: 10, qtyPurchased: 0, qtyReceived: 0, qtyPending: 10,
                    lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'HIGH',
                },
            ],
        },
    ];

    const purchase: SupplyPurchase = {
        purchaseId: 'PUR-001',
        tenantId: 't-minera',
        siteId: 's-1',
        buyerUid: 'u-buyer',
        buyerRole: 'BUYER',
        purchaseMode: 'MIXED_FULFILLMENT_AND_DIRECT',
        authorizedByAuthority: true,
        supplierTaxId: '76123465-K',
        supplierName: 'Comercial Atacama SpA',
        documentType: 33,
        folio: '12345',
        issueDate: '2026-11-21',
        netAmountClp: 492_941,
        vatAmountClp: 93_659,
        totalAmountClp: 586_600,
        paymentMethod: 'FONDO_POR_RENDIR',
        lines: [
            {
                purchaseLineId: 'PL-PAN', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                categoryCode: 'VIVERES_ALIMENTACION', unitSi: 'kg', qtyPurchased: 4,
                unitPriceNetClp: 1849, unitPriceGrossClp: 2200, subtotalNetClp: 7395, subtotalGrossClp: 8800,
                destination: 'STOCK_IN_TRANSIT',
            },
            {
                purchaseLineId: 'PL-PERNOS', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', unitSi: 'un', qtyPurchased: 10,
                unitPriceNetClp: 555, unitPriceGrossClp: 660, subtotalNetClp: 5546, subtotalGrossClp: 6600,
                destination: 'STOCK_IN_TRANSIT',
            },
            {
                purchaseLineId: 'PL-COCINA', canonicalSkuId: 'SKU-CAPEX-COCINA', description: 'Cocina industrial 4 platos',
                categoryCode: 'ACTIVO_EQUIPAMIENTO', unitSi: 'un', qtyPurchased: 1,
                unitPriceNetClp: 480_000, unitPriceGrossClp: 571_200, subtotalNetClp: 480_000, subtotalGrossClp: 571_200,
                destination: 'CAPEX_ASSET', isCapexAsset: true,
            },
        ],
    };

    const matched = matchPurchaseToRequisitions(purchase, backlog, {
        matchedAt: '2026-11-21T14:00:00Z',
    });

    const req1 = matched.updatedRequisitions.find((r) => r.reqId === 'REQ-BACKLOG-1')!;
    const req2 = matched.updatedRequisitions.find((r) => r.reqId === 'REQ-BACKLOG-2')!;

    const huevosLine = req1.lines.find((l) => l.lineId === 'L-HUEVOS')!;
    const panLine = req1.lines.find((l) => l.lineId === 'L-PAN')!;
    const pernosLine = req2.lines.find((l) => l.lineId === 'L-PERNOS')!;

    // Pernos: FULFILLED (10/10)
    assert.equal(pernosLine.lineStatus, 'FULFILLED');
    assert.equal(pernosLine.qtyPurchased, 10);
    assert.equal(pernosLine.qtyPending, 0);
    assert.equal(req2.status, 'FULFILLED');

    // Pan: PARTIAL (4/10, 6 kg pending)
    assert.equal(panLine.lineStatus, 'PARTIAL');
    assert.equal(panLine.qtyPurchased, 4);
    assert.equal(panLine.qtyPending, 6);

    // Huevos: OPEN (0/60 pending)
    assert.equal(huevosLine.lineStatus, 'OPEN');
    assert.equal(huevosLine.qtyPurchased, 0);
    assert.equal(huevosLine.qtyPending, 60);
    assert.equal(req1.status, 'PARTIAL');

    // Cocina: UNSOLICITED_PURCHASE -> CAPEX_ASSET
    assert.equal(matched.unsolicitedAllocations.length, 1);
    const cocinaAlloc = matched.unsolicitedAllocations[0];
    assert.equal(cocinaAlloc.canonicalSkuId, 'SKU-CAPEX-COCINA');
    assert.equal(cocinaAlloc.allocationType, 'UNSOLICITED_PURCHASE');
    assert.equal(cocinaAlloc.destination, 'CAPEX_ASSET');
    assert.equal(cocinaAlloc.costCenter, 'CC-CAPEX');
    assert.equal(cocinaAlloc.requisitionId, null);

    // Tabla comparativa HITL completa
    const rowPan = matched.hitlComparativeRows.find((r) => r.canonicalSkuId === 'SKU-SUP-PAN');
    const rowPernos = matched.hitlComparativeRows.find((r) => r.canonicalSkuId === 'SKU-FER-PERNOS');
    const rowHuevos = matched.hitlComparativeRows.find((r) => r.canonicalSkuId === 'SKU-SUP-HUEVOS');
    const rowCocina = matched.hitlComparativeRows.find((r) => r.canonicalSkuId === 'SKU-CAPEX-COCINA');
    assert.equal(rowPernos?.resultingState, 'FULFILLED');
    assert.equal(rowPan?.resultingState, 'PARTIAL');
    assert.equal(rowPan?.pendingAfterQty, 6);
    assert.equal(rowHuevos?.resultingState, 'OPEN');
    assert.equal(rowCocina?.resultingState, 'UNSOLICITED_CAPEX');
});

test('5.3 RequisitionFulfillmentMatcher: estricto orden FIFO entre múltiples requisiciones del mismo SKU', () => {
    const reqOlder: SupplyRequisition = {
        reqId: 'REQ-FIFO-OLD',
        tenantId: 't1',
        siteId: 's1',
        requesterUid: 'u1',
        requesterName: 'Turno A',
        requesterRole: 'CAMP_MANAGER',
        demandOrigin: 'WA_CAMP',
        demandNature: 'REACTIVE_FIELD',
        costCenter: 'CC-CAMPAMENTO',
        status: 'OPEN',
        createdAt: '2026-11-19T08:00:00Z',
        lines: [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'kg',
                qtyRequested: 6, qtyPurchased: 0, qtyReceived: 0, qtyPending: 6,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ],
    };
    const reqNewer: SupplyRequisition = {
        ...reqOlder,
        reqId: 'REQ-FIFO-NEW',
        requesterName: 'Turno B',
        createdAt: '2026-11-20T08:00:00Z',
        lines: [{ ...reqOlder.lines[0], lineId: 'L2' }],
    };

    const purchase8kg: SupplyPurchase = {
        purchaseId: 'PUR-FIFO-1',
        tenantId: 't1',
        siteId: 's1',
        buyerUid: 'u-b',
        buyerRole: 'BUYER',
        purchaseMode: 'REQUISITION_FULFILLMENT',
        authorizedByAuthority: true,
        supplierTaxId: '76123465-K',
        supplierName: 'Panadería Copiapó',
        documentType: 33,
        folio: '301',
        issueDate: '2026-11-21',
        netAmountClp: 14_790,
        vatAmountClp: 2_810,
        totalAmountClp: 17_600,
        paymentMethod: 'TRANSFERENCIA',
        lines: [
            {
                purchaseLineId: 'PL1', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                categoryCode: 'VIVERES_ALIMENTACION', unitSi: 'kg', qtyPurchased: 8,
                unitPriceNetClp: 1849, unitPriceGrossClp: 2200, subtotalNetClp: 14_790, subtotalGrossClp: 17_600,
                destination: 'STOCK_IN_TRANSIT',
            },
        ],
    };

    // Pasamos reqNewer ANTES en el array para probar que el orden FIFO es por createdAt, no por orden de entrada
    const fifoRes = matchPurchaseToRequisitions(purchase8kg, [reqNewer, reqOlder]);
    const oldUpdated = fifoRes.updatedRequisitions.find((r) => r.reqId === 'REQ-FIFO-OLD')!;
    const newUpdated = fifoRes.updatedRequisitions.find((r) => r.reqId === 'REQ-FIFO-NEW')!;

    assert.equal(oldUpdated.lines[0].lineStatus, 'FULFILLED');
    assert.equal(oldUpdated.lines[0].qtyPending, 0);
    assert.equal(newUpdated.lines[0].lineStatus, 'PARTIAL');
    assert.equal(newUpdated.lines[0].qtyPurchased, 2);
    assert.equal(newUpdated.lines[0].qtyPending, 4);
});

test('5.2 RequisitionFulfillmentMatcher: compra directa autónoma del Gerente General (OWNER_EXEC) sin requisición + sugerencias no bloqueantes', () => {
    const openReqs: SupplyRequisition[] = [
        {
            reqId: 'REQ-OPEN-PAN',
            tenantId: 't-minera',
            siteId: 's-1',
            requesterUid: 'u-camp',
            requesterName: 'Encargada Campamento',
            requesterRole: 'CAMP_MANAGER',
            demandOrigin: 'WA_CAMP',
            demandNature: 'REACTIVE_FIELD',
            costCenter: 'CC-CAMPAMENTO',
            status: 'OPEN',
            createdAt: '2026-11-21T07:00:00Z',
            lines: [
                {
                    lineId: 'L1', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                    categoryCode: 'VIVERES_ALIMENTACION', procurementBucket: 'SUPERMERCADO', unitSi: 'kg',
                    qtyRequested: 8, qtyPurchased: 0, qtyReceived: 0, qtyPending: 8,
                    lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
                },
            ],
        },
    ];

    const execPurchase: SupplyPurchase = {
        purchaseId: 'PUR-EXEC-001',
        tenantId: 't-minera',
        siteId: 's-1',
        buyerUid: 'u-owner',
        buyerRole: 'OWNER_EXEC',
        purchaseMode: 'DIRECT_AUTONOMOUS',
        authorizedByAuthority: true,
        supplierTaxId: '76123465-K',
        supplierName: 'Maquinarias del Norte Ltda.',
        documentType: 33,
        folio: '8821',
        issueDate: '2026-11-21',
        netAmountClp: 1_668_487,
        vatAmountClp: 317_013,
        totalAmountClp: 1_985_500,
        paymentMethod: 'REEMBOLSO_GERENCIA',
        lines: [
            {
                purchaseLineId: 'PL-GEN', canonicalSkuId: 'SKU-CAPEX-GENERADOR', description: 'Generador 10 kVA',
                categoryCode: 'ACTIVO_EQUIPAMIENTO', unitSi: 'un', qtyPurchased: 1,
                unitPriceNetClp: 1_650_000, unitPriceGrossClp: 1_963_500, subtotalNetClp: 1_650_000, subtotalGrossClp: 1_963_500,
                destination: 'CAPEX_ASSET', isCapexAsset: true,
            },
            {
                purchaseLineId: 'PL-PAN-DIR', canonicalSkuId: 'SKU-SUP-PAN', description: 'Pan',
                categoryCode: 'VIVERES_ALIMENTACION', unitSi: 'kg', qtyPurchased: 10,
                unitPriceNetClp: 1849, unitPriceGrossClp: 2200, subtotalNetClp: 18_487, subtotalGrossClp: 22_000,
                destination: 'STOCK_IN_WAREHOUSE',
            },
        ],
    };

    const res = matchPurchaseToRequisitions(execPurchase, openReqs);
    assert.equal(res.allocations.length, 2);
    assert.ok(res.allocations.every((a) => a.allocationType === 'DIRECT_AUTONOMOUS'));
    // Backlog abierto NO bloquea ni muta sin aprobación explícita
    assert.equal(res.updatedRequisitions[0].lines[0].qtyPending, 8);
    // Pero ofrece sugerencia no bloqueante para el pan
    assert.equal(res.suggestedBacklogMatches.length, 1);
    assert.equal(res.suggestedBacklogMatches[0].requisitionId, 'REQ-OPEN-PAN');
    assert.equal(res.suggestedBacklogMatches[0].suggestedAllocatableQty, 8);
});

// ============================================================================
// 6. STOCK, ASSET CAPEX, CASH & COST CENTER RECONCILER
// ============================================================================
test('6.1 StockAssetCashCostReconciler: separa IN_TRANSIT vs IN_WAREHOUSE, aisla CAPEX de food CLP/PAX/día y distingue IVA DTE 33 vs Boleta 39', () => {
    const purchaseFactura33: SupplyPurchase = {
        purchaseId: 'PUR-REC-33',
        tenantId: 't-minera',
        siteId: 's-1',
        buyerUid: 'u-owner',
        buyerRole: 'OWNER_EXEC',
        purchaseMode: 'MIXED_FULFILLMENT_AND_DIRECT',
        authorizedByAuthority: true,
        supplierTaxId: '76123465-K',
        supplierName: 'Proveedora Industrial Chile SpA',
        documentType: 33,
        folio: '5001',
        issueDate: '2026-11-21',
        netAmountClp: 580_000,
        vatAmountClp: 110_200,
        totalAmountClp: 690_200,
        paymentMethod: 'FONDO_POR_RENDIR',
        lines: [
            {
                purchaseLineId: 'L-FOOD', canonicalSkuId: 'SKU-VIV-PAPAS', description: 'Papas',
                categoryCode: 'VIVERES_ALIMENTACION', unitSi: 'kg', qtyPurchased: 100,
                unitPriceNetClp: 1000, unitPriceGrossClp: 1190, subtotalNetClp: 100_000, subtotalGrossClp: 119_000,
                destination: 'STOCK_IN_TRANSIT',
            },
            {
                purchaseLineId: 'L-COCINA', canonicalSkuId: 'SKU-CAPEX-COCINA', description: 'Cocina industrial',
                categoryCode: 'ACTIVO_EQUIPAMIENTO', unitSi: 'un', qtyPurchased: 1,
                unitPriceNetClp: 480_000, unitPriceGrossClp: 571_200, subtotalNetClp: 480_000, subtotalGrossClp: 571_200,
                destination: 'CAPEX_ASSET', isCapexAsset: true,
            },
        ],
    };

    const recon = reconcilePurchase(purchaseFactura33, []);

    // CAPEX estrictamente en supply_assets con base depreciable neta Art. 31 N° 5 LIR (480.000) + crédito fiscal IVA (91.200)
    assert.equal(recon.createdAssets.length, 1);
    assert.equal(recon.createdAssets[0].depreciableBasisClp, 480_000);
    assert.equal(recon.createdAssets[0].vatCreditClp, 91_200);
    assert.equal(recon.createdAssets[0].missingInvoiceAlert, false);

    // Stock: solo papas en IN_TRANSIT (cocina NO entra a inventario consumible)
    assert.equal(recon.stockEntries.length, 1);
    assert.equal(recon.stockEntries[0].canonicalSkuId, 'SKU-VIV-PAPAS');
    assert.equal(recon.stockEntries[0].deltaInTransit, 100);
    assert.equal(recon.stockEntries[0].deltaInWarehouse, 0);

    // Transición IN_TRANSIT -> IN_WAREHOUSE (recepción parcial 95 kg con faltante 5 kg)
    const reception = confirmWarehouseReception({
        receptionId: 'REC-001',
        tenantId: 't-minera',
        siteId: 's-1',
        purchaseId: 'PUR-REC-33',
        lines: [
            {
                canonicalSkuId: 'SKU-VIV-PAPAS',
                unitSi: 'kg',
                expectedInTransitQty: 100,
                receivedQty: 95,
                unitCostNetClp: 1000,
                costCenter: 'CC-CAMPAMENTO',
            },
        ],
    });
    assert.equal(reception.isCompleteReception, false);
    assert.equal(reception.discrepancies[0].shortageQty, 5);

    const balances = computeInventoryBalances([...recon.stockEntries, ...reception.stockEntries]);
    assert.equal(balances['SKU-VIV-PAPAS'].qtyInTransit, 5);
    assert.equal(balances['SKU-VIV-PAPAS'].qtyInWarehouse, 95);
    assert.equal(balances['SKU-VIV-PAPAS'].totalEffectiveStock, 100);

    // KPI alimentación diaria CLP/PAX/día: 100.000 / (20 PAX * 1 día) = 5.000 CLP/PAX/día
    // La cocina CAPEX de 480.000 NO contamina el indicador!
    const foodKpi = computeFoodCostPerPaxDay({
        cashEntries: recon.cashEntries,
        headcount: 20,
        days: 1,
    });
    assert.equal(foodKpi.totalFoodOpexClp, 100_000);
    assert.equal(foodKpi.excludedCapexClp, 480_000);
    assert.equal(foodKpi.clpPerPaxDay, 5_000);

    // Boleta 39 para activo CAPEX -> IVA no recuperable y alerta ATYPICAL_ASSET_WITHOUT_INVOICE
    const boletaCapex: SupplyPurchase = {
        ...purchaseFactura33,
        purchaseId: 'PUR-BOL-39',
        documentType: 39,
        folio: '9912',
        netAmountClp: 480_000,
        vatAmountClp: 91_200,
        totalAmountClp: 571_200,
        paymentMethod: 'CAJA_CHICA',
        lines: [purchaseFactura33.lines[1]],
    };
    const reconBoleta = reconcilePurchase(boletaCapex, []);
    assert.equal(reconBoleta.summary.totalVatRecoverableClp, 0);
    assert.equal(reconBoleta.summary.totalVatNonRecoverableClp, 91_200);
    assert.equal(reconBoleta.createdAssets[0].missingInvoiceAlert, true);
    assert.ok(reconBoleta.createdAssets[0].atypicalFlags.includes('ATYPICAL_ASSET_WITHOUT_INVOICE'));

    // Rendición de fondo por rendir (anticipo 600.000 vs rendido 690.200 -> reembolso al comprador)
    const expenseReport = reconcileFundAdvanceReport({
        reportId: 'REND-2026-11',
        tenantId: 't-minera',
        siteId: 's-1',
        responsibleUid: 'u-buyer',
        periodLabel: '2026-11-S3',
        paymentMethod: 'FONDO_POR_RENDIR',
        fundAdvanceClp: 600_000,
        renderedDocuments: [{ documentId: 'D1', totalAmountClp: 690_200 }],
    });
    assert.equal(expenseReport.balanceClp, -90_200);
    assert.equal(expenseReport.balanceDisposition, 'REIMBURSEMENT_TO_BUYER');

    // Sobrante a devolver (CAJA_CHICA) y cuadrado (CREDITO_PROVEEDOR)
    const surplusReport = reconcileFundAdvanceReport({
        reportId: 'REND-SURPLUS',
        tenantId: 't-minera',
        siteId: 's-1',
        responsibleUid: 'u-buyer',
        periodLabel: '2026-11-S4',
        paymentMethod: 'CAJA_CHICA',
        fundAdvanceClp: 200_000,
        renderedDocuments: [{ documentId: 'D2', totalAmountClp: 150_000 }],
    });
    assert.equal(surplusReport.balanceClp, 50_000);
    assert.equal(surplusReport.balanceDisposition, 'SURPLUS_TO_RETURN');

    // Todos los métodos de pago y centros de costo (CC-FLOTA + CREDITO_PROVEEDOR, CC-HSEC + TRANSFERENCIA)
    const multiCostPurchase: SupplyPurchase = {
        ...purchaseFactura33,
        purchaseId: 'PUR-MULTI-CC',
        folio: '5099',
        paymentMethod: 'CREDITO_PROVEEDOR',
        netAmountClp: 82_000,
        vatAmountClp: 15_580,
        totalAmountClp: 97_580,
        lines: [
            {
                purchaseLineId: 'L-FLOTA', canonicalSkuId: 'SKU-OPM-FILTRO-ACEITE', description: 'Filtro aceite',
                categoryCode: 'LUBRICANTES_FILTROS', unitSi: 'un', qtyPurchased: 1,
                unitPriceNetClp: 28_000, unitPriceGrossClp: 33_320, subtotalNetClp: 28_000, subtotalGrossClp: 33_320,
                destination: 'STOCK_IN_WAREHOUSE',
            },
            {
                purchaseLineId: 'L-HSEC', canonicalSkuId: 'SKU-EPP-BOTOTOS', description: 'Bototos',
                categoryCode: 'EPP_SEGURIDAD', unitSi: 'par', qtyPurchased: 1,
                unitPriceNetClp: 54_000, unitPriceGrossClp: 64_260, subtotalNetClp: 54_000, subtotalGrossClp: 64_260,
                destination: 'STOCK_IN_WAREHOUSE',
            },
        ],
    };
    const reconMulti = reconcilePurchase(multiCostPurchase, []);
    assert.equal(reconMulti.summary.opexByCostCenter['CC-FLOTA'], 28_000);
    assert.equal(reconMulti.summary.opexByCostCenter['CC-HSEC'], 54_000);
    assert.equal(reconMulti.cashEntries[0].entryType, 'SUPPLIER_PAYABLE');
    assert.equal(reconMulti.stockEntries[0].movementType, 'DIRECT_WAREHOUSE_IN');
});

// ============================================================================
// 7. SII TAX VALIDATOR (TED PDF417, XML DTE, RUT MÓDULO-11, RCV 8 DÍAS, CSV)
// ============================================================================
test('7.1 SiiTaxValidator: parseo TED PDF417, XML DTE, anti-duplicación, plazo RCV 8 días, alerta CAPEX sin factura y exportación CSV', () => {
    const tedXml = `<TED version="1.0"><DD><RE>76123465-K</RE><TD>33</TD><F>0012345</F><FE>2026-11-15</FE><RR>76123456-0</RR><RSR>MINERA ATACAMA SPA</RSR><MNT>571200</MNT><IT1>Cocina industrial 4 platos</IT1><TSTED>2026-11-15T10:30:00</TSTED></DD><FRMT algoritmo="SHA1withRSA">SGVsbG9TSUlTaWduYXR1cmU=</FRMT></TED>`;

    const ted = parseSiiTedPdf417(tedXml);
    assert.equal(ted.valid, true);
    assert.equal(ted.emitterRutValid, true);
    assert.equal(ted.emitterRutNormalized, '76123465-K');
    assert.equal(ted.dteType, 33);
    assert.equal(ted.folio, '12345');
    assert.equal(ted.totalAmountClp, 571_200);
    assert.equal(ted.tedSignaturePresent, true);
    assert.equal(ted.dedupeKey, '76123465-K#33#12345');

    // Anti-duplicación insensible a puntos, minúsculas y ceros a la izquierda
    assert.equal(buildSiiDedupeKey('76.123.465-k', 33, '000012345'), '76123465-K#33#12345');

    // XML DTE completo con Detalle y TED embebido
    const fullXmlDte = `
        <DTE version="1.0">
            <Documento>
                <Encabezado>
                    <IdDoc><TipoDTE>33</TipoDTE><Folio>12345</Folio><FchEmis>2026-11-15</FchEmis></IdDoc>
                    <Emisor><RUTEmisor>76.123.465-K</RUTEmisor><RznSoc>COMERCIAL ATACAMA SPA</RznSoc></Emisor>
                    <Receptor><RUTRecep>76.123.456-0</RUTRecep><RznSocRecep>MINERA ATACAMA SPA</RznSocRecep></Receptor>
                    <Totales><MntNeto>480000</MntNeto><IVA>91200</IVA><MntTotal>571200</MntTotal></Totales>
                </Encabezado>
                <Detalle><NroLinDet>1</NroLinDet><NmbItem>Cocina industrial 4 platos</NmbItem><QtyItem>1</QtyItem><PrcItem>480000</PrcItem><MontoItem>480000</MontoItem></Detalle>
                ${tedXml}
            </Documento>
        </DTE>
    `;

    const parsedXml = parseSiiXmlDte(fullXmlDte);
    assert.equal(parsedXml.valid, true);
    assert.equal(parsedXml.lines.length, 1);
    assert.equal(parsedXml.embeddedTed?.valid, true);

    // Validación integral con plazo RCV 8 días (emitida 2026-11-15 -> vence 2026-11-23; ref 2026-11-21 => 2 días -> alerta!)
    const validatedXml = validateSiiDocumentForPurchase({
        siiDocId: 'SII-001',
        tenantId: 't1',
        siteId: 's1',
        xmlContent: fullXmlDte,
        hasCapexAsset: true,
        referenceDateIso: '2026-11-21',
    });
    assert.equal(validatedXml.valid, true);
    assert.equal(validatedXml.isDuplicate, false);
    assert.equal(validatedXml.rcvDeadline.deadlineIso, '2026-11-23');
    assert.equal(validatedXml.rcvDeadline.daysRemaining, 2);
    assert.equal(validatedXml.rcvDeadline.rcvUrgencyAlert, true);
    assert.equal(validatedXml.atypicalFlags.length, 0); // DTE 33 sí respalda CAPEX

    // Detección de duplicado
    const duplicateCheck = validateSiiDocumentForPurchase({
        siiDocId: 'SII-001-DUP',
        tenantId: 't1',
        siteId: 's1',
        tedRawXml: tedXml,
        existingDedupeKeys: new Set(['76123465-K#33#12345']),
        referenceDateIso: '2026-11-21',
    });
    assert.equal(duplicateCheck.isDuplicate, true);
    assert.equal(duplicateCheck.valid, false);

    // Boleta 39 respaldando activo CAPEX -> ATYPICAL_ASSET_WITHOUT_INVOICE y RCV no aplicable
    const boletaCapexValidation = validateSiiDocumentForPurchase({
        siiDocId: 'SII-BOL-01',
        tenantId: 't1',
        siteId: 's1',
        manualFallback: {
            supplierTaxId: '76.123.465-K',
            supplierName: '=Ferretería Test', // prueba sanitización CSV formula injection
            dteType: 39,
            folio: '4455',
            issueDate: '2026-11-21',
            totalAmountClp: 571_200,
        },
        lineSubtotalsGrossClp: [571_200],
        hasCapexAsset: true,
    });
    assert.equal(boletaCapexValidation.valid, true);
    assert.equal(boletaCapexValidation.rcvDeadline.applicable, false);
    assert.ok(boletaCapexValidation.atypicalFlags.includes('ATYPICAL_ASSET_WITHOUT_INVOICE'));

    // RUT con dígito verificador inválido rechazado
    const badRut = validateSiiDocumentForPurchase({
        siiDocId: 'SII-BAD-RUT',
        tenantId: 't1',
        siteId: 's1',
        manualFallback: {
            supplierTaxId: '76.123.465-9',
            supplierName: 'Inválido SpA',
            dteType: 33,
            folio: '10',
            issueDate: '2026-11-21',
            totalAmountClp: 100_000,
        },
    });
    assert.equal(badRut.valid, false);

    // Guardrail aritmético (±2 CLP tolerancia)
    assert.equal(
        verifyDocumentArithmetic({ lineSubtotalsClp: [50_000, 50_001], documentTotalClp: 100_000 }).valid,
        true
    );
    assert.equal(
        verifyDocumentArithmetic({ lineSubtotalsClp: [50_000, 50_050], documentTotalClp: 100_000 }).valid,
        false
    );

    // Plazo RCV vencido
    const overdueRcv = computeRcvAcceptanceDeadline('2026-11-01', 33, '2026-11-21');
    assert.equal(overdueRcv.isOverdue, true);
    assert.equal(overdueRcv.rcvUrgencyAlert, true);

    // Exportación CSV para contador chileno con protección contra formula injection
    const csv = exportSiiDocumentsToAccountantCsv([validatedXml.record, boletaCapexValidation.record]);
    assert.ok(csv.includes('DEDUPE_KEY;TIPO_DTE;FOLIO'));
    assert.ok(csv.includes('76123465-K#33#12345'));
    assert.ok(csv.includes("'=Ferretería Test"));
});

// ============================================================================
// 8. DEMAND & COST FORECASTER + DS 594 WATER + LEY 21.719 K>=3 ANONYMITY
// ============================================================================
test('8.1 DemandAndCostForecaster: EWMA per-cápita, DOI y guardrail DS 594 Art. 14 + altura DS 28 (>3000m)', () => {
    const ewma = computeEwmaSeries([10, 12, 14, 16], 0.5);
    // S0=10, S1=11, S2=12.5, S3=14.25
    assert.equal(ewma, 14.25);

    const highAltitudeSite: SupplySite = {
        siteId: 'site-cordillera',
        tenantId: 't-minera',
        name: 'Faena Alta Cordillera',
        districtCode: 'CL-III-COPIAPO',
        altitudeMeters: 3800, // > 3000m -> factor DS 28 = 1.2x
        shiftPattern: '7x7',
        currentHeadcount: 50,
        waterStorageCapacityL: 40_000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 5,
    };

    // 120 L * 1.2 (DS 28 altura) = 144 L/PAX/día -> 50 PAX = 7.200 L/día -> 5 días = 36.000 L reserva obligatoria
    const waterGuard = evaluateDs594WaterGuardrail({
        site: highAltitudeSite,
        currentWaterWarehouseL: 20_000,
        currentWaterInTransitL: 5_000,
    });
    assert.equal(waterGuard.altitudeFactorApplied, 1.2);
    assert.equal(waterGuard.requiredDailyLPerPax, 144);
    assert.equal(waterGuard.requiredReserveL, 36_000);
    assert.equal(waterGuard.compliant, false);
    assert.equal(waterGuard.deficitL, 11_000);
    assert.equal(waterGuard.storageCapacitySufficient, true);

    const waterForecast = forecastSkuDemand({
        site: highAltitudeSite,
        canonicalSkuId: 'SKU-AGUA-BIDON',
        categoryCode: 'AGUA_POTABLE',
        unitSi: 'L',
        history: [
            { dateIso: '2026-11-18', consumedQtySi: 6000, headcount: 50 },
            { dateIso: '2026-11-19', consumedQtySi: 6500, headcount: 50 },
        ],
        currentWarehouseStockSi: 20_000,
        currentInTransitStockSi: 5_000,
    });
    assert.equal(waterForecast.ewmaDailyPerPaxSi, 144); // Piso legal DS 594 + DS 28 prevalece
    assert.equal(waterForecast.ewmaDailyTotalSi, 7200);
    assert.ok(waterForecast.recommendedOrderQtySi >= 11_000);
    assert.equal(waterForecast.ds594WaterGuardrail?.compliant, false);
    assert.equal(waterForecast.daysOfInventoryWarehouse, 2.7778);
    assert.equal(waterForecast.daysOfInventoryEffective, 3.4722);

    // Muy alta cordillera (> 4.000 msnm -> factor 1.3x DS 28) y piso legal DS 594 (>= 100 L/PAX/día)
    const extremeSite: SupplySite = {
        ...highAltitudeSite,
        siteId: 'site-4300m',
        altitudeMeters: 4300,
        ds594DailyWaterTargetLPerPax: 80, // Intento bajo mínimo legal -> debe forzarse a >= 100!
    };
    const extremeGuard = evaluateDs594WaterGuardrail({
        site: extremeSite,
        currentWaterWarehouseL: 35_000,
        currentWaterInTransitL: 0,
    });
    assert.equal(extremeGuard.altitudeFactorApplied, 1.3);
    assert.equal(extremeGuard.requiredDailyLPerPax, 130); // 100 * 1.3
    assert.equal(extremeGuard.requiredReserveL, 32_500); // 130 * 50 * 5
    assert.equal(extremeGuard.compliant, true);
});

test('8.2 DemandAndCostForecaster: DemandSignalProjector (Ley N° 21.719) exige opt-in y k >= 3 sin fuga de tenantId ni GPS', () => {
    const observations: TenantDemandObservation[] = [
        // Distrito CL-III-COPIAPO: 3 tenants distintos con opt-in (DEBE EMITIRSE) + 1 opt-out (DEBE DESCARTARSE)
        {
            tenantId: 'tenant-secret-A', siteId: 'site-A1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.3668, lng: -70.3322 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 300, unitPriceClp: 1100,
        },
        {
            tenantId: 'tenant-secret-B', siteId: 'site-B1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.4101, lng: -70.2905 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 450, unitPriceClp: 1200,
        },
        {
            tenantId: 'tenant-secret-C', siteId: 'site-C1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.3911, lng: -70.4002 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 250, unitPriceClp: 1150,
        },
        {
            tenantId: 'tenant-optout-D', siteId: 'site-D1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.5000, lng: -70.5000 }, optInMarketplace: false,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 999, unitPriceClp: 1000,
        },
        // Distrito CL-II-ANTOFAGASTA: solo 2 tenants distintos (k = 2 < 3 => DEBE SUPRIMIRSE incluso si piden minK: 1!)
        {
            tenantId: 'tenant-antofa-1', siteId: 'site-AN1', districtCode: 'CL-II-ANTOFAGASTA',
            geoFix: { lat: -23.6509, lng: -70.3975 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-FER-CEMENTO', procurementBucket: 'FERRETERIA', unitSi: 'kg',
            projectedDemandSi: 1000, unitPriceClp: 220,
        },
        {
            tenantId: 'tenant-antofa-2', siteId: 'site-AN2', districtCode: 'CL-II-ANTOFAGASTA',
            geoFix: { lat: -23.7000, lng: -70.4100 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-FER-CEMENTO', procurementBucket: 'FERRETERIA', unitSi: 'kg',
            projectedDemandSi: 800, unitPriceClp: 230,
        },
        // Mismo tenant con 3 sitios distintos en CL-IV-COQUIMBO (solo 1 tenant => DEBE SUPRIMIRSE!)
        {
            tenantId: 'tenant-single-E', siteId: 'site-E1', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA', unitSi: 'un',
            projectedDemandSi: 100,
        },
        {
            tenantId: 'tenant-single-E', siteId: 'site-E2', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA', unitSi: 'un',
            projectedDemandSi: 100,
        },
        {
            tenantId: 'tenant-single-E', siteId: 'site-E3', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA', unitSi: 'un',
            projectedDemandSi: 100,
        },
    ];

    const projected = projectAnonymousDemandSignals(observations, {
        windowStartIso: '2026-11-21T00:00:00Z',
        windowEndIso: '2026-11-28T00:00:00Z',
        minK: 1, // Intento malicioso de bajar k < 3: debe forzarse piso >= 3!
    });

    assert.equal(projected.enforcedK, 3);
    assert.equal(projected.droppedOptOutCount, 1);
    assert.equal(projected.suppressedLowKGroupCount, 2); // Antofagasta (2 tenants) + Coquimbo (1 tenant)
    assert.equal(projected.signals.length, 1);

    const signal = projected.signals[0];
    assert.equal(signal.districtCode, 'CL-III-COPIAPO');
    assert.equal(signal.contributingTenantCount, 3);
    assert.equal(signal.contributingSiteCount, 3);
    assert.equal(signal.aggregatedDemandSi, 1000); // 300 + 450 + 250 (opt-out 999 excluido!)
    assert.equal(signal.ley21719Compliant, true);

    // Auditoría estricta de cero fuga PII/tenantId/GPS en JSON emitido
    const serialized = JSON.stringify(projected.signals);
    assert.equal(serialized.includes('tenant-secret'), false);
    assert.equal(serialized.includes('tenantId'), false);
    assert.equal(serialized.includes('site-A1'), false);
    assert.equal(serialized.includes('geoFix'), false);
    assert.equal(serialized.includes('-27.3668'), false);
});

// ============================================================================
// RUNNER DETERMINÍSTICO
// ============================================================================
function runSuite(): void {
    let passed = 0;
    let failed = 0;

    console.log('\n=== MINREPORT · ABASTECIMIENTO — Domain Engines Unit Test Suite ===');
    for (const tc of tests) {
        try {
            tc.fn();
            passed += 1;
            console.log(`  [PASS] ${tc.name}`);
        } catch (err) {
            failed += 1;
            console.error(`  [FAIL] ${tc.name}`);
            console.error(err);
        }
    }

    console.log(`\nResultado: ${passed}/${tests.length} pruebas aprobadas, ${failed} fallidas.`);
    if (failed > 0) {
        process.exit(1);
    }
}

runSuite();
