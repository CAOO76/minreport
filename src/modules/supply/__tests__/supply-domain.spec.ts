/**
 * MINREPORT · ABASTECIMIENTO — Suite Completa de Pruebas Unitarias de Motores de Dominio
 *
 * Ejecutable standalone sin Firestore ni llamadas de red:
 *   npx ts-node src/modules/supply/__tests__/supply-domain.spec.ts
 *
 * Cubre determinísticamente los 8 motores de dominio y todos los escenarios reales de negocio.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
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
    checkDgmnExplosives,
    checkGlobalHardDeny,
    detectSplitInvoiceSmurfing,
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
    computeChileanVatBreakdown,
    computeRcvAcceptanceDeadline,
    exportSiiDocumentsToAccountantCsv,
    parseSiiTedPdf417,
    parseSiiXmlDte,
    validateSiiDocumentForPurchase,
    verifyDocumentArithmetic,
    verifySiiTedRsaSignature,
    // 8. DemandAndCostForecaster
    LEY21719_MIN_K_ANONYMITY,
    TenantDemandObservation,
    computeEwmaSeries,
    evaluateDs594WaterGuardrail,
    forecastSkuDemand,
    projectAnonymousDemandSignals,
    // 9. International Tax & Safety Ports
    ChileMiningSafetyPolicyPack,
    ChileSiiTaxJurisdictionAdapter,
    getSiteSafetyPolicyPack,
    getTaxJurisdictionAdapter,
} from '../domain';

interface TestCase {
    name: string;
    fn: () => void | Promise<void>;
}

const tests: TestCase[] = [];
function test(name: string, fn: () => void | Promise<void>): void {
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

    // Insumo controlado (explosivos DGMN Ley N° 17.798) bloqueado sin licencia y permitido con licencia
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
    assert.equal(unlicensed.rejectedItems[0].rejectionCode, 'DGMN_EXPLOSIVES_BLOCK');

    // Otros insumos controlados (no explosivos) sin licencia -> CONTROLLED_LICENSE_REQUIRED
    const unlicensedNonExplosive = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'ctrl1',
                rawText: '20 L acido sulfurico reactivo',
                categoryCode: 'OTROS_OPERACIONAL',
                quantitySi: 20,
                unitSi: 'L',
                isControlled: true,
            },
        ],
        { requesterRole: 'CAMP_MANAGER', demandNature: 'REACTIVE_FIELD' }
    );
    assert.equal(unlicensedNonExplosive.rejectedItems[0].rejectionCode, 'CONTROLLED_LICENSE_REQUIRED');

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
            memberProfile: {
                ...DEFAULT_ROLE_PROFILES.OWNER_EXEC,
                licensedForControlledItems: true,
            },
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
        mkReq('REQ-07', 'CC-OPS-MINA', 'WA_OPS', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
                qtyRequested: 20, qtyPurchased: 0, qtyReceived: 0, qtyPending: 20,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ]),
        // 8. Ferretería PARTIAL (pernos 15 un pendientes) + cemento CRITICAL (100 kg)
        mkReq('REQ-08', 'CC-OPS-MINA', 'MODULE_PLANNING', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
                qtyRequested: 30, qtyPurchased: 15, qtyReceived: 15, qtyPending: 15,
                lineStatus: 'PARTIAL', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-FER-CEMENTO', description: 'Cemento Portland',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'kg',
                qtyRequested: 100, qtyPurchased: 0, qtyReceived: 0, qtyPending: 100,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ], 'PARTIAL'),
        // 9. Ferretería OPEN (clavos 10 kg) + línea YA FULFILLED (no debe sumarse!)
        mkReq('REQ-09', 'CC-OPS-MINA', 'WA_OPS', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-FER-CLAVOS', description: 'Clavos corrientes',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'kg',
                qtyRequested: 10, qtyPurchased: 0, qtyReceived: 0, qtyPending: 10,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-FER-PERNOS', description: 'Pernos ya cubiertos',
                categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
                qtyRequested: 50, qtyPurchased: 50, qtyReceived: 50, qtyPending: 0,
                lineStatus: 'FULFILLED', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
        ], 'PARTIAL'),
        // 10. Repuestos OPERMAQ CRITICAL (filtro aceite 3 un)
        mkReq('REQ-10', 'CC-FLOTA-MANTENCION', 'MODULE_OPERMAQ', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-OPM-FILTRO-ACEITE', description: 'Filtro de aceite motor',
                categoryCode: 'LUBRICANTES_FILTROS', procurementBucket: 'REPUESTOS_LUBRICANTES', unitSi: 'un',
                qtyRequested: 3, qtyPurchased: 0, qtyReceived: 0, qtyPending: 3,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
        ]),
        // 11. Repuestos OPERMAQ OPEN (filtro aceite 2 un + aceite 15W40 40 L)
        mkReq('REQ-11', 'CC-FLOTA-MANTENCION', 'WA_MECHANIC', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-OPM-FILTRO-ACEITE', description: 'Filtro de aceite motor',
                categoryCode: 'LUBRICANTES_FILTROS', procurementBucket: 'REPUESTOS_LUBRICANTES', unitSi: 'un',
                qtyRequested: 2, qtyPurchased: 0, qtyReceived: 0, qtyPending: 2,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'STANDARD',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-OPM-ACEITE-15W40', description: 'Aceite motor 15W-40',
                categoryCode: 'LUBRICANTES_FILTROS', procurementBucket: 'REPUESTOS_LUBRICANTES', unitSi: 'L',
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
        // 13. Gas GLP Doméstico + Agua Potable CRITICAL separados
        mkReq('REQ-13', 'CC-CAMP-ENERGIA', 'WA_CAMP', [
            {
                lineId: 'L1', canonicalSkuId: 'SKU-GAS-GLP45', description: 'Gas licuado GLP 45 kg',
                categoryCode: 'GAS_DOMESTICO_GLP', procurementBucket: 'GAS_GLP_DOMESTICO', unitSi: 'kg',
                qtyRequested: 90, qtyPurchased: 0, qtyReceived: 0, qtyPending: 90,
                lineStatus: 'OPEN', atypicalFlags: [], fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE', urgency: 'CRITICAL',
            },
            {
                lineId: 'L2', canonicalSkuId: 'SKU-AGUA-BIDON', description: 'Agua potable en bidón',
                categoryCode: 'AGUA_POTABLE_BEBESTIBLE', procurementBucket: 'AGUA_POTABLE', unitSi: 'L',
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
    assert.equal(list.buckets.length, 7); // Verdulería, Supermercado, Ferretería, Repuestos, EPP, Agua Potable, Gas GLP
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

    // Verificar orden CRITICAL -> PARTIAL_PENDING -> STANDARD en FERRETERIA_INSUMOS y exclusión de línea FULFILLED
    const ferreteria = list.buckets.find((b) => b.procurementBucket === 'FERRETERIA_INSUMOS')!;
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
                    categoryCode: 'FERRETERIA_CONSTRUCCION', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
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
    assert.equal(reconMulti.summary.opexByCostCenter['CC-FLOTA-MANTENCION'], 28_000);
    assert.equal(reconMulti.summary.opexByCostCenter['CC-HSEC'], 54_000);
    assert.equal(reconMulti.cashEntries[0].entryType, 'SUPPLIER_PAYABLE');
    assert.equal(reconMulti.stockEntries[0].movementType, 'DIRECT_RECEIPT');
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
        categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
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

test('8.2 DemandAndCostForecaster: DemandSignalProjector (Ley N° 21.719) exige opt-in, excluye sandboxes y exige k >= 5 B2B sin fuga PII/GPS', () => {
    const observations: TenantDemandObservation[] = [
        // Distrito CL-III-COPIAPO: 5 tenants B2B distintos con opt-in (DEBE EMITIRSE) + 1 opt-out + 3 sandboxes (EDU, pilot-*, dev-master-sandbox)
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
            tenantId: 'tenant-secret-F', siteId: 'site-F1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.3500, lng: -70.3100 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 200, unitPriceClp: 1120,
        },
        {
            tenantId: 'tenant-secret-G', siteId: 'site-G1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.3800, lng: -70.3500 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 300, unitPriceClp: 1180,
        },
        {
            tenantId: 'tenant-optout-D', siteId: 'site-D1', districtCode: 'CL-III-COPIAPO',
            geoFix: { lat: -27.5000, lng: -70.5000 }, optInMarketplace: false,
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 999, unitPriceClp: 1000,
        },
        {
            tenantId: 'edu-u-atacama', siteId: 'site-edu-1', districtCode: 'CL-III-COPIAPO',
            optInMarketplace: true, isEduSandbox: true, accountType: 'EDUCATIONAL',
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 500, unitPriceClp: 1000,
        },
        {
            tenantId: 'pilot-user-01', siteId: 'site-pilot-1', districtCode: 'CL-III-COPIAPO',
            optInMarketplace: true, accountType: 'TEST_PILOT',
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 500, unitPriceClp: 1000,
        },
        {
            tenantId: 'dev-master-sandbox', siteId: 'site-dev-1', districtCode: 'CL-III-COPIAPO',
            optInMarketplace: true, accountType: 'DEV',
            canonicalSkuId: 'SKU-VIV-PAPAS', procurementBucket: 'VERDULERIA', unitSi: 'kg',
            projectedDemandSi: 500, unitPriceClp: 1000,
        },
        // Distrito CL-II-ANTOFAGASTA: solo 4 tenants B2B distintos (k = 4 < 5 => DEBE SUPRIMIRSE incluso si piden minK: 1!)
        {
            tenantId: 'tenant-antofa-1', siteId: 'site-AN1', districtCode: 'CL-II-ANTOFAGASTA',
            geoFix: { lat: -23.6509, lng: -70.3975 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-FER-CEMENTO', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'kg',
            projectedDemandSi: 1000, unitPriceClp: 220,
        },
        {
            tenantId: 'tenant-antofa-2', siteId: 'site-AN2', districtCode: 'CL-II-ANTOFAGASTA',
            geoFix: { lat: -23.7000, lng: -70.4100 }, optInMarketplace: true,
            canonicalSkuId: 'SKU-FER-CEMENTO', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'kg',
            projectedDemandSi: 800, unitPriceClp: 230,
        },
        {
            tenantId: 'tenant-antofa-3', siteId: 'site-AN3', districtCode: 'CL-II-ANTOFAGASTA',
            optInMarketplace: true,
            canonicalSkuId: 'SKU-FER-CEMENTO', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'kg',
            projectedDemandSi: 600, unitPriceClp: 210,
        },
        {
            tenantId: 'tenant-antofa-4', siteId: 'site-AN4', districtCode: 'CL-II-ANTOFAGASTA',
            optInMarketplace: true,
            canonicalSkuId: 'SKU-FER-CEMENTO', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'kg',
            projectedDemandSi: 700, unitPriceClp: 215,
        },
        // Mismo tenant con 5 sitios distintos en CL-IV-COQUIMBO (solo 1 tenant => DEBE SUPRIMIRSE!)
        {
            tenantId: 'tenant-single-E', siteId: 'site-E1', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
            projectedDemandSi: 100,
        },
        {
            tenantId: 'tenant-single-E', siteId: 'site-E2', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
            projectedDemandSi: 100,
        },
        {
            tenantId: 'tenant-single-E', siteId: 'site-E3', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
            projectedDemandSi: 100,
        },
        {
            tenantId: 'tenant-single-E', siteId: 'site-E4', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
            projectedDemandSi: 100,
        },
        {
            tenantId: 'tenant-single-E', siteId: 'site-E5', districtCode: 'CL-IV-COQUIMBO',
            optInMarketplace: true, canonicalSkuId: 'SKU-FER-PERNOS', procurementBucket: 'FERRETERIA_INSUMOS', unitSi: 'un',
            projectedDemandSi: 100,
        },
    ];

    const projected = projectAnonymousDemandSignals(observations, {
        windowStartIso: '2026-11-21T00:00:00Z',
        windowEndIso: '2026-11-28T00:00:00Z',
        minK: 1, // Intento malicioso de bajar k < 5: debe forzarse piso >= 5!
    });

    assert.equal(LEY21719_MIN_K_ANONYMITY, 5);
    assert.equal(projected.enforcedK, 5);
    assert.equal(projected.droppedOptOutCount, 1);
    assert.equal(projected.droppedSandboxCount, 3); // EDU + pilot-* + dev-master-sandbox excluidos
    assert.equal(projected.suppressedLowKGroupCount, 2); // Antofagasta (4 tenants) + Coquimbo (1 tenant)
    assert.equal(projected.signals.length, 1);

    const signal = projected.signals[0];
    assert.equal(signal.districtCode, 'CL-III-COPIAPO');
    assert.equal(signal.periodWindow, '2026-11-21..2026-11-28');
    assert.equal(signal.skuName, 'Papas');
    assert.equal(signal.categoryCode, 'VIVERES_ALIMENTACION');
    assert.equal(signal.participatingEntitiesCount, 5);
    assert.equal(signal.aggregatedQty, 1500); // 300 + 450 + 250 + 200 + 300 (opt-out y sandboxes excluidos!)
    assert.equal(signal.medianReferenceUnitClp, 1150);
    assert.equal(signal.optInVerified, true);
    assert.equal(signal.expiresAt, '2026-11-28T00:00:00Z');

    // Verificar estrictamente que las llaves coinciden 1:1 con DemandPoolSignalSchema.strict() (#9)
    const allowedStrictKeys = new Set([
        'signalId',
        'districtCode',
        'periodWindow',
        'canonicalSkuId',
        'skuName',
        'categoryCode',
        'procurementBucket',
        'unitSi',
        'aggregatedQty',
        'participatingEntitiesCount',
        'optInVerified',
        'medianReferenceUnitClp',
        'generatedAt',
        'expiresAt',
    ]);
    for (const k of Object.keys(signal)) {
        assert.ok(allowedStrictKeys.has(k), `Llave inesperada fuera de DemandPoolSignalSchema.strict(): ${k}`);
    }

    // Auditoría estricta de cero fuga PII/tenantId/GPS en JSON emitido
    const serialized = JSON.stringify(projected.signals);
    assert.equal(serialized.includes('tenant-secret'), false);
    assert.equal(serialized.includes('tenantId'), false);
    assert.equal(serialized.includes('site-A1'), false);
    assert.equal(serialized.includes('geoFix'), false);
    assert.equal(serialized.includes('-27.3668'), false);
});

// ============================================================================
// 9. ETAPA E05 — TED RSA-SHA1, DL 825 (52/61/folio=0/<RR>), NFD/LEET/DGMN/SMURFING,
//    DOI REAL, PUERTOS INTERNACIONALES Y WIRING EN RUNTIME
// ============================================================================
function buildSignedTedXmlFixture(): { validTedXml: string; tamperedTedXml: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 1024,
    });
    const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
    const mBase64 = Buffer.from(jwk.n, 'base64url').toString('base64');
    const eBase64 = Buffer.from(jwk.e, 'base64url').toString('base64');

    const ddBlock =
        `<DD><RE>76123465-K</RE><TD>33</TD><F>54321</F><FE>2026-11-21</FE><RR>76123456-0</RR>` +
        `<RSR>MINERA ATACAMA SPA</RSR><MNT>571200</MNT><IT1>Cocina industrial 4 platos</IT1>` +
        `<CAF version="1.0"><DA><RE>76123465-K</RE><RS>COMERCIAL ATACAMA SPA</RS><TD>33</TD>` +
        `<RNG><D>1</D><H>99999</H></RNG><FA>2026-01-01</FA>` +
        `<RSAPK><M>${mBase64}</M><E>${eBase64}</E></RSAPK><IDK>100</IDK></DA>` +
        `<FRMA algoritmo="SHA1withRSA">Q0FGU0lH</FRMA></CAF><TSTED>2026-11-21T10:30:00</TSTED></DD>`;

    const signer = crypto.createSign('RSA-SHA1');
    signer.update(Buffer.from(ddBlock, 'utf8'));
    signer.end();
    const signatureBase64 = signer.sign(privateKey, 'base64');

    const validTedXml = `<TED version="1.0">${ddBlock}<FRMT algoritmo="SHA1withRSA">${signatureBase64}</FRMT></TED>`;
    const tamperedTedXml = validTedXml.replace('<MNT>571200</MNT>', '<MNT>971200</MNT>');
    return { validTedXml, tamperedTedXml };
}

test('9.1 E05 SiiTaxValidator: verificación criptográfica real TED RSA-SHA1 (válida true vs manipulada false)', () => {
    const { validTedXml, tamperedTedXml } = buildSignedTedXmlFixture();

    const okRsa = verifySiiTedRsaSignature(validTedXml);
    assert.equal(okRsa.tedRsaVerified, true);
    assert.equal(okRsa.reason, 'VALID_SIGNATURE');

    const okValidation = validateSiiDocumentForPurchase({
        siiDocId: 'SII-RSA-OK',
        tenantId: 't1',
        siteId: 's1',
        tedRawXml: validTedXml,
        expectedReceiverTaxId: '76.123.456-0',
        referenceDateIso: '2026-11-21',
    });
    assert.equal(okValidation.valid, true);
    assert.equal(okValidation.tedRsaVerified, true);
    assert.equal(okValidation.record.tedVerified, true);
    assert.equal(okValidation.record.tedRsaVerified, true);
    assert.equal(okValidation.receiverTaxIdMismatch, false);

    // Manipulación del monto en <DD> sin re-firmar -> TED_RSA_SIGNATURE_INVALID
    const badRsa = verifySiiTedRsaSignature(tamperedTedXml);
    assert.equal(badRsa.tedRsaVerified, false);
    assert.equal(badRsa.reason, 'INVALID_SIGNATURE');

    const badValidation = validateSiiDocumentForPurchase({
        siiDocId: 'SII-RSA-BAD',
        tenantId: 't1',
        siteId: 's1',
        tedRawXml: tamperedTedXml,
        referenceDateIso: '2026-11-21',
    });
    assert.equal(badValidation.valid, false);
    assert.equal(badValidation.tedRsaVerified, false);
    assert.equal(badValidation.record.tedVerified, false);
    assert.ok(badValidation.errors.some((e) => e.includes('TED_RSA_SIGNATURE_INVALID')));
});

test('9.2 E05 SiiTaxValidator: folio="0" rechazado en DTE 33, DTE 52 IVA=0, DTE 61 negativo y <RR> mismatch', () => {
    // folio='0' rechazado en DTE 33 (cero bypass de unicidad SII)
    const zeroFolioRes = validateSiiDocumentForPurchase({
        siiDocId: 'SII-ZERO-FOLIO',
        tenantId: 't1',
        siteId: 's1',
        manualFallback: {
            supplierTaxId: '76.123.465-K',
            supplierName: 'Comercial Norte SpA',
            dteType: 33,
            folio: '0',
            issueDate: '2026-11-21',
            totalAmountClp: 119_000,
        },
    });
    assert.equal(zeroFolioRes.valid, false);
    assert.ok(zeroFolioRes.errors.some((e) => e.includes('FOLIO_MUST_BE_POSITIVE')));

    // DTE 52 Guía de Despacho: NO otorga Crédito Fiscal (DL 825)
    const vat52 = computeChileanVatBreakdown({ dteType: 52, totalAmountClp: 119_000 });
    assert.equal(vat52.vatRecoverableClp, 0);
    assert.equal(vat52.vatNonRecoverableClp, 0);
    assert.equal(vat52.isCreditNote, false);

    // DTE 61 Nota de Crédito: reduce Crédito Fiscal (`vatRecoverableClp < 0`, `isCreditNote: true`)
    const vat61 = computeChileanVatBreakdown({ dteType: 61, totalAmountClp: 119_000 });
    assert.equal(vat61.vatRecoverableClp, -19_000);
    assert.equal(vat61.vatAmountClp, -19_000);
    assert.equal(vat61.netAmountClp, -100_000);
    assert.equal(vat61.totalAmountClp, -119_000);
    assert.equal(vat61.isCreditNote, true);

    // <RR> mismatch contra expectedReceiverTaxId del tenant
    const { validTedXml } = buildSignedTedXmlFixture();
    const rrMismatch = validateSiiDocumentForPurchase({
        siiDocId: 'SII-RR-MISMATCH',
        tenantId: 't1',
        siteId: 's1',
        tedRawXml: validTedXml,
        expectedReceiverTaxId: '76.192.083-9', // distinto de 76123456-0 en <RR>
    });
    assert.equal(rrMismatch.valid, false);
    assert.equal(rrMismatch.receiverTaxIdMismatch, true);
    assert.ok(rrMismatch.errors.some((e) => e.includes('RECEIVER_TAX_ID_MISMATCH')));
});

test('9.3 E05 SupplyPolicyAndAnomalyEngine: DS 132 NFD/leetspeak, DGMN explosivos y SPLIT_INVOICE_SMURFING', () => {
    // Evasiones Unicode NFD y leetspeak bloqueadas determinísticamente
    assert.equal(checkGlobalHardDeny('2 cajas de cérvèzâ artesanal').denied, true);
    assert.equal(checkGlobalHardDeny('2 cajas de c3rv3za').denied, true);
    assert.equal(checkGlobalHardDeny('mar1hu4na para turno').denied, true);
    assert.equal(checkGlobalHardDeny('botella de p!sc0 y v1n0').denied, true);
    assert.equal(checkGlobalHardDeny('c@nn@b1$').denied, true);
    // Whitelist sanitaria preservada
    assert.equal(checkGlobalHardDeny('alcohol gel 70 desinfectante 5L').denied, false);
    assert.equal(checkGlobalHardDeny('alcohol isopropilico industrial').denied, false);

    // DGMN Ley N° 17.798 explosivos detectados incluso como texto libre en categoría no controlada
    assert.equal(checkDgmnExplosives('5 cajas de dinamita').isExplosive, true);
    assert.equal(checkDgmnExplosives('2 sacos de 4nf0').isExplosive, true);
    assert.equal(checkDgmnExplosives('10 d3t0n@d0res y mecha lenta').isExplosive, true);

    const dgmnBlocked = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'd1',
                rawText: '5 cajas de dinamita',
                categoryCode: 'FERRETERIA_CONSTRUCCION',
                quantitySi: 5,
                unitSi: 'caja',
            },
            {
                itemKey: 'd2',
                rawText: '2 sacos de anfo',
                categoryCode: 'OTROS_OPERACIONAL',
                quantitySi: 50,
                unitSi: 'kg',
            },
        ],
        { requesterRole: 'OPS_FOREMAN', demandNature: 'REACTIVE_FIELD' }
    );
    assert.equal(dgmnBlocked.acceptedItems.length, 0);
    assert.equal(dgmnBlocked.rejectedItems.length, 2);
    assert.equal(dgmnBlocked.rejectedItems[0].rejectionCode, 'DGMN_EXPLOSIVES_BLOCK');
    assert.equal(dgmnBlocked.rejectedItems[1].rejectionCode, 'DGMN_EXPLOSIVES_BLOCK');

    // Sin licencia DGMN vigente, ni siquiera OWNER_EXEC por defecto puede pedir explosivos
    const ownerDefaultBlocked = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'd3-blocked',
                rawText: '2 sacos de anfo',
                categoryCode: 'EXPLOSIVOS_REGULADO',
                quantitySi: 50,
                unitSi: 'kg',
            },
        ],
        {
            requesterRole: 'OWNER_EXEC',
            memberProfile: DEFAULT_ROLE_PROFILES.OWNER_EXEC,
            demandNature: 'PLANNED_ENGINEERING',
        }
    );
    assert.equal(ownerDefaultBlocked.rejectedItems.length, 1);

    // Con licencia DGMN explícita autorizada (OWNER_EXEC) sí pasa
    const dgmnAllowed = evaluateRequisitionPolicy(
        [
            {
                itemKey: 'd3',
                rawText: '2 sacos de anfo',
                categoryCode: 'EXPLOSIVOS_REGULADO',
                quantitySi: 50,
                unitSi: 'kg',
            },
        ],
        {
            requesterRole: 'OWNER_EXEC',
            memberProfile: {
                ...DEFAULT_ROLE_PROFILES.OWNER_EXEC,
                licensedForControlledItems: true,
            },
            demandNature: 'PLANNED_ENGINEERING',
        }
    );
    assert.equal(dgmnAllowed.acceptedItems.length, 1);

    // SPLIT_INVOICE_SMURFING: 2+ compras al mismo proveedor en <= 48h bajo umbral que juntas lo superan
    const smurf = detectSplitInvoiceSmurfing({
        supplierTaxId: '76.192.083-9',
        currentAmountClp: 290_000,
        currentTimestampIso: '2026-11-21T18:00:00Z',
        approvalThresholdClp: 500_000,
        windowHours: 48,
        recentPurchases: [
            {
                purchaseId: 'pur-prev-1',
                supplierTaxId: '76192083-9',
                totalAmountClp: 320_000,
                createdAtIso: '2026-11-21T09:00:00Z', // 9h atrás (< 48h)
            },
        ],
    });
    assert.equal(smurf.detected, true);
    assert.equal(smurf.code, 'SPLIT_INVOICE_SMURFING');
    assert.equal(smurf.purchaseCount, 2);
    assert.equal(smurf.cumulativeAmountClp, 610_000);
    assert.deepEqual(smurf.relatedPurchaseIds, ['pur-prev-1']);

    // Fuera de ventana 48h -> NO dispara smurfing
    const noSmurfOld = detectSplitInvoiceSmurfing({
        supplierTaxId: '76.192.083-9',
        currentAmountClp: 290_000,
        currentTimestampIso: '2026-11-21T18:00:00Z',
        approvalThresholdClp: 500_000,
        windowHours: 48,
        recentPurchases: [
            {
                purchaseId: 'pur-old-1',
                supplierTaxId: '76192083-9',
                totalAmountClp: 320_000,
                createdAtIso: '2026-11-18T09:00:00Z', // > 72h atrás
            },
        ],
    });
    assert.equal(noSmurfOld.detected, false);
});

test('9.4 E05 DemandAndCostForecaster: DOI DS 594 sobre stock real menor a capacidad física', () => {
    const site: SupplySite = {
        siteId: 'site-water-real',
        tenantId: 't-b2b-1',
        name: 'Campamento Real Stock',
        districtCode: 'CL-ATACAMA',
        altitudeMeters: 3400, // factor DS 28 = 1.2
        shiftPattern: '7x7',
        currentHeadcount: 40,
        waterStorageCapacityL: 50_000, // Capacidad física sobrada (>= 40320 L)
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    };

    // Stock real = 0 L aunque estanque tenga 50.000 L de capacidad -> compliant: false, available: 0
    const emptyTank = evaluateDs594WaterGuardrail({
        site,
        currentWaterWarehouseL: 0,
        currentWaterInTransitL: 0,
    });
    assert.equal(emptyTank.currentAvailableL, 0);
    assert.equal(emptyTank.waterStorageCapacityL, 50_000);
    assert.equal(emptyTank.storageCapacitySufficient, true);
    assert.equal(emptyTank.compliant, false);
    assert.equal(emptyTank.coverageDays, 0);
    assert.equal(emptyTank.deficitL, 40_320);

    // Stock real parcial (10.000 L bodega + 5.000 L tránsito = 15.000 L < 40.320 L)
    const partialTank = evaluateDs594WaterGuardrail({
        site,
        currentWaterWarehouseL: 10_000,
        currentWaterInTransitL: 5_000,
    });
    assert.equal(partialTank.currentAvailableL, 15_000);
    assert.equal(partialTank.compliant, false);
    assert.equal(partialTank.deficitL, 25_320);
});

test('9.5 E05 ITaxJurisdictionAdapter & ISiteSafetyPolicyPack: Chile activo + stubs PE/BR/MX/CO/AR/AU/EU', () => {
    assert.equal(getTaxJurisdictionAdapter('CL'), ChileSiiTaxJurisdictionAdapter);
    assert.equal(ChileSiiTaxJurisdictionAdapter.implemented, true);
    assert.equal(ChileSiiTaxJurisdictionAdapter.currencyCode, 'CLP');
    assert.equal(ChileSiiTaxJurisdictionAdapter.validateTaxId('76.123.465-K').valid, true);
    assert.equal(ChileSiiTaxJurisdictionAdapter.computeTaxBreakdown({ documentType: 52, totalAmount: 119_000 }).recoverableTaxAmount, 0);
    assert.equal(ChileSiiTaxJurisdictionAdapter.computeTaxBreakdown({ documentType: 61, totalAmount: 119_000 }).recoverableTaxAmount, -19_000);

    const pe = getTaxJurisdictionAdapter('PE');
    assert.equal(pe.currencyCode, 'PEN');
    assert.equal(pe.implemented, false);
    assert.equal(pe.validateTaxId('20100047218').valid, true);
    assert.equal(pe.computeTaxBreakdown({ documentType: '01', totalAmount: 118 }).taxAmount, 18);

    const mx = getTaxJurisdictionAdapter('MX');
    assert.equal(mx.currencyCode, 'MXN');
    assert.equal(mx.validateTaxId('MIN260101AB3').valid, true);

    const br = getTaxJurisdictionAdapter('BR');
    assert.equal(br.currencyCode, 'BRL');
    assert.equal(br.validateTaxId('12.345.678/0001-99'.replace(/\//g, '')).valid, true);

    const co = getTaxJurisdictionAdapter('CO');
    assert.equal(co.currencyCode, 'COP');
    assert.equal(co.validateTaxId('900123456-7').valid, true);

    const ar = getTaxJurisdictionAdapter('AR');
    assert.equal(ar.currencyCode, 'ARS');
    assert.equal(ar.validateTaxId('30-71234567-9').valid, true);

    const au = getTaxJurisdictionAdapter('AU');
    assert.equal(au.currencyCode, 'AUD');
    assert.equal(au.validateTaxId('51 824 753 556').valid, true);

    const eu = getTaxJurisdictionAdapter('EU');
    assert.equal(eu.currencyCode, 'EUR');
    assert.equal(eu.validateTaxId('DE123456789').valid, true);
    const euDoc = eu.validateDocument({
        documentId: 'eu-1',
        tenantId: 't-eu',
        siteId: 's-eu',
        supplierTaxId: 'DE123456789',
        supplierName: 'EuroMine GmbH',
        documentType: '380',
        folio: 'INV-1001',
        issueDate: '2026-11-21',
        totalAmount: 1200,
    });
    assert.equal(euDoc.valid, true);
    assert.ok(euDoc.warnings.some((w) => w.includes('JURISDICTION_ADAPTER_STUB')));

    const safetyPack = getSiteSafetyPolicyPack('CL');
    assert.equal(safetyPack, ChileMiningSafetyPolicyPack);
    assert.equal(safetyPack.maxManualLoadKg, 25);
    assert.equal(safetyPack.minWaterLitersPerPaxDay, 100);
    assert.equal(safetyPack.checkProhibitedItem('c3rv3za').denied, true);
    assert.equal(safetyPack.checkControlledExplosives('dinamita', false).blocked, true);
    assert.equal(safetyPack.checkControlledExplosives('dinamita', true).blocked, false);
});

test('9.6 E05 Runtime Wiring: SupplyRepository (supply_policy_audit, event_ledger, DOI real, SII folio/RSA y k>=5 sin sandboxes)', async () => {
    // Instalar stub determinista en memoria solo para este test de wiring de runtime
    const collections = new Map<string, Map<string, Record<string, any>>>();
    const getCol = (name: string) => {
        let c = collections.get(name);
        if (!c) {
            c = new Map();
            collections.set(name, c);
        }
        return c;
    };
    const mkDocRef = (colName: string, docId: string): any => ({
        id: docId,
        path: `${colName}/${docId}`,
        collection(subCol: string) {
            const subPath = `${colName}/${docId}/${subCol}`;
            return {
                doc: (subId?: string) => mkDocRef(subPath, subId || `auto_${Date.now()}`),
                where: (f: string, op: string, v: unknown) => mkQuery(subPath, [{ f, v }]),
                limit: () => mkQuery(subPath, []),
                get: () => mkQuery(subPath, []).get(),
            };
        },
        async get() {
            const d = getCol(colName).get(docId);
            return { id: docId, exists: Boolean(d), data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) };
        },
        async set(payload: Record<string, any>, opts?: { merge?: boolean }) {
            const prev = opts?.merge && getCol(colName).has(docId) ? getCol(colName).get(docId)! : {};
            getCol(colName).set(docId, { ...prev, ...JSON.parse(JSON.stringify(payload)) });
        },
    });
    const mkQuery = (colName: string, filters: Array<{ f: string; v: unknown }> = []): any => ({
        where(f: string, _op: string, v: unknown) {
            return mkQuery(colName, [...filters, { f, v }]);
        },
        limit() {
            return mkQuery(colName, filters);
        },
        async get() {
            const docs = Array.from(getCol(colName).entries())
                .filter(([, data]) => filters.every((fl) => data[fl.f] === fl.v))
                .map(([id, data]) => ({
                    id,
                    exists: true,
                    data: () => JSON.parse(JSON.stringify(data)),
                }));
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    });
    const fakeDb: any = {
        collection(colName: string) {
            return {
                doc: (id?: string) => mkDocRef(colName, id || `auto_${Date.now()}`),
                where: (f: string, op: string, v: unknown) => mkQuery(colName, [{ f, v }]),
                limit: () => mkQuery(colName, []),
                get: () => mkQuery(colName, []).get(),
            };
        },
        async runTransaction(fn: (tx: any) => Promise<any>) {
            const ops: Array<() => Promise<void>> = [];
            const tx = {
                get: (ref: any) => ref.get(),
                set: (ref: any, data: any, opts?: any) => {
                    ops.push(() => ref.set(data, opts));
                    return tx;
                },
            };
            const res = await fn(tx);
            for (const op of ops) await op();
            return res;
        },
    };
    const fakeAdmin: any = {
        apps: [{ name: '[DEFAULT]' }],
        firestore: Object.assign(() => fakeDb, {
            Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
            FieldValue: { serverTimestamp: () => Date.now() },
        }),
    };
    const firebaseResolved = require.resolve(path.resolve(__dirname, '../../../config/firebase'));
    require.cache[firebaseResolved] = {
        id: firebaseResolved,
        filename: firebaseResolved,
        loaded: true,
        exports: { __esModule: true, default: fakeAdmin, db: fakeDb, auth: {}, storage: {} },
    } as any;

    const { SUPPLY_COLLECTIONS, SupplyRepository } = require('../application/SupplyRepository') as typeof import('../application/SupplyRepository');
    const actor = { actorUid: 'uid-e05', actorEmail: 'e05@minreport.test' };

    // 1. DefaultSupplyCatalogSeed conectado en listCatalog()
    const catalog = await SupplyRepository.listCatalog();
    assert.ok(catalog.some((s) => s.canonicalSkuId === 'SKU-VIV-PAPAS'));
    assert.ok(catalog.some((s) => s.canonicalSkuId === 'SKU-EXP-DETONADOR'));

    // 2. Site con estanque 50.000 L pero 0 stock real de agua -> availableWaterL === 0, ds594Compliant === false
    await SupplyRepository.upsertSite(
        'tenant-b2b-1',
        {
            siteId: 'site-e05',
            name: 'Faena E05 Cordillera',
            districtCode: 'CL-ATACAMA',
            geoFix: { latitude: -27.3, longitude: -70.3, altitudeM: 3400 },
            shiftPattern: '7x7',
            currentHeadcount: 40,
            waterStorageCapacityL: 50_000,
            ds594DailyWaterTargetLPerPax: 120,
            leadTimeDays: 7,
            marketplaceOptIn: true,
            roleMismatchMode: 'FLAG_AND_ACCEPT',
            directPurchaseAlertThresholdClp: 500_000,
        },
        actor
    );
    const [fcEmpty] = await SupplyRepository.computeForecastReadOnly('tenant-b2b-1', 'site-e05');
    assert.equal(fcEmpty.availableWaterL, 0);
    assert.equal(fcEmpty.waterStorageCapacityL, 50_000);
    assert.equal(fcEmpty.ds594Compliant, false);
    assert.equal(fcEmpty.altitudeMultiplier, 1.2);

    // 3. SiiTaxValidator en runtime: rechaza folio=0 y TED RSA-SHA1 manipulado
    const { tamperedTedXml } = buildSignedTedXmlFixture();
    await assert.rejects(
        () =>
            SupplyRepository.createPurchaseWithReconciliation(
                {
                    tenantId: 'tenant-b2b-1',
                    siteId: 'site-e05',
                    buyerUid: 'uid-e05',
                    buyerRole: 'OWNER_EXEC',
                    purchaseMode: 'DIRECT_AUTONOMOUS',
                    authorizedByAuthority: true,
                    supplierTaxId: '76123465-K',
                    supplierName: 'Comercial Norte SpA',
                    documentType: 33,
                    folio: 0,
                    issueDate: '2026-11-21',
                    netAmountClp: 100_000,
                    vatAmountClp: 19_000,
                    totalAmountClp: 119_000,
                    paymentMethod: 'TRANSFERENCIA',
                    lines: [
                        {
                            purchaseLineId: 'pl-zero',
                            canonicalSkuId: 'sku-papas',
                            description: 'Papas',
                            categoryCode: 'VIVERES_ALIMENTACION',
                            procurementBucket: 'VERDULERIA',
                            unitSi: 'kg',
                            qtyPurchased: 100,
                            unitPriceClp: 1190,
                            subtotalClp: 119_000,
                            destination: 'STOCK_IN_WAREHOUSE',
                            costCenter: 'CC-CAMPAMENTO',
                            isCapexAsset: false,
                        },
                    ],
                },
                actor
            ),
        /FOLIO_MUST_BE_POSITIVE/
    );

    await assert.rejects(
        () =>
            SupplyRepository.createPurchaseWithReconciliation(
                {
                    tenantId: 'tenant-b2b-1',
                    siteId: 'site-e05',
                    buyerUid: 'uid-e05',
                    buyerRole: 'OWNER_EXEC',
                    purchaseMode: 'DIRECT_AUTONOMOUS',
                    authorizedByAuthority: true,
                    supplierTaxId: '76123465-K',
                    supplierName: 'Comercial Norte SpA',
                    documentType: 33,
                    folio: 54321,
                    issueDate: '2026-11-21',
                    netAmountClp: 480_000,
                    vatAmountClp: 91_200,
                    totalAmountClp: 571_200,
                    paymentMethod: 'TRANSFERENCIA',
                    tedRawXml: tamperedTedXml,
                    lines: [
                        {
                            purchaseLineId: 'pl-tamper',
                            canonicalSkuId: 'SKU-CAPEX-COCINA',
                            description: 'Cocina industrial',
                            categoryCode: 'ACTIVO_EQUIPAMIENTO',
                            procurementBucket: 'ACTIVOS_CAPEX',
                            unitSi: 'un',
                            qtyPurchased: 1,
                            unitPriceClp: 571_200,
                            subtotalClp: 571_200,
                            destination: 'CAPEX_ASSET',
                            costCenter: 'CC-CAPEX',
                            isCapexAsset: true,
                        },
                    ],
                },
                actor
            ),
        /TED_RSA_SIGNATURE_INVALID/
    );

    // 4. Dos compras fraccionadas (< 500k cada una, suma 620k > 500k en < 48h) -> escribe `supply_policy_audit` SPLIT_INVOICE_SMURFING
    const p1 = await SupplyRepository.createPurchaseWithReconciliation(
        {
            tenantId: 'tenant-b2b-1',
            siteId: 'site-e05',
            buyerUid: 'uid-e05',
            buyerRole: 'OWNER_EXEC',
            purchaseMode: 'DIRECT_AUTONOMOUS',
            authorizedByAuthority: true,
            supplierTaxId: '76123465-K',
            supplierName: 'Comercial Norte SpA',
            documentType: 33,
            folio: 8001,
            issueDate: '2026-11-21',
            netAmountClp: 268_908,
            vatAmountClp: 51_092,
            totalAmountClp: 320_000,
            paymentMethod: 'TRANSFERENCIA',
            lines: [
                {
                    purchaseLineId: 'pl-smurf-1',
                    canonicalSkuId: 'SKU-CAPEX-COCINA',
                    description: 'Cocina Campamento',
                    categoryCode: 'ACTIVO_EQUIPAMIENTO',
                    procurementBucket: 'ACTIVOS_CAPEX',
                    unitSi: 'un',
                    qtyPurchased: 1,
                    unitPriceClp: 320_000,
                    subtotalClp: 320_000,
                    destination: 'CAPEX_ASSET',
                    costCenter: 'CC-CAPEX',
                    isCapexAsset: true,
                },
            ],
        },
        actor
    );
    const p2 = await SupplyRepository.createPurchaseWithReconciliation(
        {
            tenantId: 'tenant-b2b-1',
            siteId: 'site-e05',
            buyerUid: 'uid-e05',
            buyerRole: 'OWNER_EXEC',
            purchaseMode: 'DIRECT_AUTONOMOUS',
            authorizedByAuthority: true,
            supplierTaxId: '76123465-K',
            supplierName: 'Comercial Norte SpA',
            documentType: 52, // Guía de Despacho -> vatCreditRecoverableClp === 0
            folio: 8002,
            issueDate: '2026-11-21',
            netAmountClp: 252_101,
            vatAmountClp: 47_899,
            totalAmountClp: 300_000,
            paymentMethod: 'TRANSFERENCIA',
            lines: [
                {
                    purchaseLineId: 'pl-smurf-2',
                    canonicalSkuId: 'sku-papas',
                    description: 'Papas',
                    categoryCode: 'VIVERES_ALIMENTACION',
                    procurementBucket: 'VERDULERIA',
                    unitSi: 'kg',
                    qtyPurchased: 250,
                    unitPriceClp: 1200,
                    subtotalClp: 300_000,
                    destination: 'STOCK_IN_WAREHOUSE',
                    costCenter: 'CC-CAMPAMENTO',
                    isCapexAsset: false,
                },
            ],
        },
        actor
    );
    assert.equal(p2.siiDocument.vatCreditRecoverableClp, 0);
    assert.equal(p2.smurfingAlert?.detected, true);
    assert.equal(p2.smurfingAlert?.code, 'SPLIT_INVOICE_SMURFING');
    const policyAudits = Array.from(getCol(SUPPLY_COLLECTIONS.POLICY_AUDIT).values());
    assert.ok(policyAudits.some((a) => a.policyCode === 'SPLIT_INVOICE_SMURFING'));

    // 5. linkAssetToOpermaq emite evento trazable en `event_ledger` con payloadHash SHA-256
    const assetId = p1.createdAssets[0].assetId;
    await SupplyRepository.linkAssetToOpermaq('tenant-b2b-1', assetId, 'opm-eq-777', actor);
    const ledgerEvents = Array.from(getCol(SUPPLY_COLLECTIONS.EVENT_LEDGER).values());
    assert.equal(ledgerEvents.length, 1);
    assert.equal(ledgerEvents[0].eventType, 'SUPPLY_ASSET_LINKED_TO_OPERMAQ');
    assert.equal(ledgerEvents[0].sourceModule, 'supply');
    assert.equal(ledgerEvents[0].targetModule, 'opermaq');
    assert.equal(ledgerEvents[0].assetId, assetId);
    assert.equal(ledgerEvents[0].opermaqAssetId, 'opm-eq-777');
    assert.match(ledgerEvents[0].payloadHash, /^[a-f0-9]{64}$/);

    // 6. refreshAnonymousDemandSignals: k >= 5 B2B y excluye EDU, pilot-* y dev-master-sandbox
    await fakeDb.collection('accounts').doc('edu-u-chile').set({ type: 'EDUCATIONAL', isEduSandbox: true });
    await fakeDb.collection('accounts').doc('pilot-sandbox-9').set({ type: 'TEST_PILOT' });
    await fakeDb.collection('accounts').doc('dev-master-sandbox').set({ type: 'DEV' });
    const seedTenants = [
        'tenant-b2b-1',
        'tenant-b2b-2',
        'tenant-b2b-3',
        'tenant-b2b-4',
        'edu-u-chile',
        'pilot-sandbox-9',
        'dev-master-sandbox',
    ];
    for (const tid of seedTenants) {
        const sid = `site-${tid}`;
        await fakeDb.collection(SUPPLY_COLLECTIONS.SITES).doc(sid).set({
            siteId: sid,
            tenantId: tid,
            name: `Site ${tid}`,
            districtCode: 'CL-ANTOFAGASTA',
            marketplaceOptIn: true,
            currentHeadcount: 10,
            waterStorageCapacityL: 10_000,
            ds594DailyWaterTargetLPerPax: 120,
            leadTimeDays: 5,
            shiftPattern: '7x7',
            roleMismatchMode: 'FLAG_AND_ACCEPT',
            directPurchaseAlertThresholdClp: 500_000,
        });
        await SupplyRepository.createRequisition(
            {
                tenantId: tid,
                siteId: sid,
                requesterUid: `u-${tid}`,
                requesterName: 'Op',
                requesterRole: 'CAMP_MANAGER',
                demandOrigin: 'WA_CAMP',
                demandNature: 'REACTIVE_FIELD',
                costCenter: 'CC-CAMPAMENTO',
                atypicalFlags: [],
                lines: [
                    {
                        lineId: `l-${tid}`,
                        canonicalSkuId: 'SKU-FER-CEMENTO',
                        itemName: 'Cemento Portland',
                        categoryCode: 'FERRETERIA_CONSTRUCCION',
                        procurementBucket: 'FERRETERIA_INSUMOS',
                        unitSi: 'kg',
                        qtyRequested: 100,
                        qtyPurchased: 0,
                        qtyReceived: 0,
                        qtyPending: 100,
                        lineStatus: 'OPEN',
                        atypicalFlags: [],
                        fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                        urgency: 'STANDARD',
                    },
                ],
            },
            actor
        );
    }
    // Solo 4 tenants B2B + 3 sandboxes => 4 < 5 => 0 señales emitidas (sandboxes NO cuentan!)
    const signalsWith4B2b = await SupplyRepository.refreshAnonymousDemandSignals();
    assert.equal(signalsWith4B2b.length, 0);

    // Agregar 5º tenant B2B => ahora k = 5 B2B => se emite 1 señal con aggregatedQty = 500 (sin los 300 de sandboxes!)
    await fakeDb.collection(SUPPLY_COLLECTIONS.SITES).doc('site-tenant-b2b-5').set({
        siteId: 'site-tenant-b2b-5',
        tenantId: 'tenant-b2b-5',
        name: 'Site B2B 5',
        districtCode: 'CL-ANTOFAGASTA',
        marketplaceOptIn: true,
        currentHeadcount: 10,
        waterStorageCapacityL: 10_000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 5,
        shiftPattern: '7x7',
        roleMismatchMode: 'FLAG_AND_ACCEPT',
        directPurchaseAlertThresholdClp: 500_000,
    });
    await SupplyRepository.createRequisition(
        {
            tenantId: 'tenant-b2b-5',
            siteId: 'site-tenant-b2b-5',
            requesterUid: 'u-b2b-5',
            requesterName: 'Op 5',
            requesterRole: 'CAMP_MANAGER',
            demandOrigin: 'WA_CAMP',
            demandNature: 'REACTIVE_FIELD',
            costCenter: 'CC-CAMPAMENTO',
            atypicalFlags: [],
            lines: [
                {
                    lineId: 'l-b2b-5',
                    canonicalSkuId: 'SKU-FER-CEMENTO',
                    itemName: 'Cemento Portland',
                    categoryCode: 'FERRETERIA_CONSTRUCCION',
                    procurementBucket: 'FERRETERIA_INSUMOS',
                    unitSi: 'kg',
                    qtyRequested: 100,
                    qtyPurchased: 0,
                    qtyReceived: 0,
                    qtyPending: 100,
                    lineStatus: 'OPEN',
                    atypicalFlags: [],
                    fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                    urgency: 'STANDARD',
                },
            ],
        },
        actor
    );
    const signalsWith5B2b = await SupplyRepository.refreshAnonymousDemandSignals();
    assert.equal(signalsWith5B2b.length, 1);
    assert.equal(signalsWith5B2b[0].participatingEntitiesCount, 5);
    assert.equal(signalsWith5B2b[0].aggregatedQty, 500);
});

// ============================================================================
// 10. V3-E01: 15 CANALES WS, UNIFICACIÓN SKU-*, REGEX NO-DESTRUCTIVAS, DTE 33 NETO & DTE 61
// ============================================================================
test('10.1 V3-E01 Taxonomía 15 Canales WS, Catálogo Unificado SKU-* y Guardrails DGMN', () => {
    const seedMod = require('../catalog/DefaultSupplyCatalogSeed');
    const channelIds = Object.keys(seedMod.SUPPLY_CHANNELS_META);
    assert.equal(channelIds.length, 15);
    assert.ok(channelIds.includes('CH_CAMP_FOOD'));
    assert.ok(channelIds.includes('CH_CAMP_POTABLE_WATER'));
    assert.ok(channelIds.includes('CH_OPS_IND_WATER'));
    assert.ok(channelIds.includes('CH_OPS_FLEET_FUEL'));
    assert.ok(channelIds.includes('CH_OPS_IND_GASES'));
    assert.ok(channelIds.includes('CH_CONTROLLED_DGMN'));
    assert.ok(channelIds.includes('CH_CAPEX_ASSETS'));
    assert.ok(channelIds.includes('CH_WAREHOUSE_RECEPTION'));
    assert.ok(channelIds.includes('CH_DIRECT_PURCHASE_EXEC'));

    // Unificación SKU-* + alias legacy
    for (const sku of seedMod.DEFAULT_SUPPLY_CATALOG_SEED) {
        assert.ok(sku.canonicalSkuId.startsWith('SKU-'), `SKU debe usar prefijo canónico SKU-: ${sku.canonicalSkuId}`);
    }
    assert.equal(seedMod.resolveCanonicalSkuIdAlias('sku-papas'), 'SKU-VIV-PAPAS');
    assert.equal(seedMod.resolveCanonicalSkuIdAlias('sku-agua-bidon-20l'), 'SKU-AGUA-BIDON');

    // SKU-EXP-DETONADOR corregido a CONTROLADOS_DGMN + CC-OPS-TRONADURA + sin permiso por defecto
    const det = findCanonicalSkuById('SKU-EXP-DETONADOR');
    assert.ok(det);
    assert.equal(det.procurementBucket, 'CONTROLADOS_DGMN');
    assert.equal(det.categoryCode, 'EXPLOSIVOS_REGULADO');
    assert.equal(det.isControlled, true);

    assert.equal(DEFAULT_ROLE_PROFILES.OWNER_EXEC.licensedForControlledItems, false);
    assert.equal(DEFAULT_ROLE_PROFILES.BUYER.licensedForControlledItems, false);
    assert.equal(DEFAULT_ROLE_PROFILES.SITE_ADMIN.licensedForControlledItems, false);
    assert.ok(!DEFAULT_ROLE_PROFILES.BUYER.allowedCategories.includes('EXPLOSIVOS_REGULADO'));
    assert.ok(!DEFAULT_ROLE_PROFILES.SITE_ADMIN.allowedCategories.includes('EXPLOSIVOS_REGULADO'));

    // Routing por rol y por SKU
    const campChannels = seedMod.getChannelsForProfileRole('CAMP_MANAGER');
    assert.ok(campChannels.includes('CH_CAMP_FOOD'));
    assert.ok(!campChannels.includes('CH_CONTROLLED_DGMN'));
    assert.equal(seedMod.classifySkuToChannel({ canonicalSkuId: 'SKU-GAS-OXIGENO', categoryCode: 'GASES_INDUSTRIALES' }), 'CH_OPS_IND_GASES');
    assert.equal(seedMod.classifySkuToChannel({ canonicalSkuId: 'SKU-AGUA-INDUSTRIAL', categoryCode: 'AGUA_INDUSTRIAL' }), 'CH_OPS_IND_WATER');
    assert.equal(seedMod.classifySkuToChannel({ canonicalSkuId: 'SKU-EXP-DETONADOR', categoryCode: 'EXPLOSIVOS_REGULADO' }), 'CH_CONTROLLED_DGMN');
});

test('10.2 V3-E01 Regex no-destructivas, bidón por metadata de SKU y DS 594 solo agua potable humana', () => {
    const appTypes = require('../application/supply.types');
    const forecaster = require('../domain/DemandAndCostForecaster');

    // "bidon de cloro" -> aseo 5 L (NO agua potable 20 L)
    const cloroNorm = appTypes.normalizeSupplyItemFromText('2 bidones de cloro industrial', 2, 'bidon');
    assert.equal(cloroNorm.canonicalSkuId, 'SKU-ASEO-CLORO');
    assert.equal(cloroNorm.categoryCode, 'ASEO_HIGIENE');
    assert.equal(cloroNorm.qtySi, 10);

    const cloroUnit = normalizeUnitExpression('2 bidones de cloro industrial');
    assert.equal(cloroUnit.canonicalSkuHint, 'SKU-ASEO-CLORO');
    assert.equal(cloroUnit.quantitySi, 10);
    assert.equal(cloroUnit.unitSi, 'L');

    // "bidón" genérico sin volumen ni metadata -> ambiguo
    const bidonGenerico = normalizeUnitExpression('2 bidones');
    assert.equal(bidonGenerico.isAmbiguous, true);

    // "agua industrial" -> AGUA_INDUSTRIAL (NO potable)
    const aguaInd = appTypes.normalizeSupplyItemFromText('10000 L agua industrial camión aljibe', 10000, 'L');
    assert.equal(aguaInd.categoryCode, 'AGUA_INDUSTRIAL');
    assert.equal(aguaInd.procurementBucket, 'AGUA_INDUSTRIAL_ALJIBE');

    // "oxígeno" / "cilindro hidráulico" != GLP doméstico
    const oxigeno = appTypes.normalizeSupplyItemFromText('2 cilindros de oxígeno oxicorte', 2, 'un');
    assert.equal(oxigeno.categoryCode, 'GASES_INDUSTRIALES');
    assert.equal(oxigeno.procurementBucket, 'GASES_INDUSTRIALES');

    const hidraulico = appTypes.normalizeSupplyItemFromText('1 cilindro hidráulico excavadora', 1, 'un');
    assert.equal(hidraulico.categoryCode, 'REPUESTOS_MAQUINARIA');
    assert.equal(hidraulico.procurementBucket, 'REPUESTOS_LUBRICANTES');

    // "generador" separado de cocina industrial, pero CAPEX
    const generador = appTypes.normalizeSupplyItemFromText('1 generador 15kva', 1, 'un');
    assert.equal(generador.canonicalSkuId, 'SKU-CAPEX-GENERADOR');
    assert.equal(generador.procurementBucket, 'ACTIVOS_CAPEX');
    assert.equal(generador.isCapexAsset, true);

    // DS 594 solo cuenta agua potable humana
    assert.equal(forecaster.isHumanPotableWaterCategory('AGUA_POTABLE_BEBESTIBLE'), true);
    assert.equal(forecaster.isHumanPotableWaterCategory('AGUA_POTABLE_SANITAR'), true);
    assert.equal(forecaster.isHumanPotableWaterCategory('AGUA_INDUSTRIAL'), false);
});

test('10.3 V3-E01 DTE 33 XML neto (sin doble descuento IVA + PMP neto), DTE 61 negativo, foodOpex30d y teléfono activo', async () => {
    const { db } = require('../../../config/firebase');
    const { CasStorageService } = require('../../../core/media/CasStorageService');
    const { ResilientAIClient } = require('../../../core/resilient-ai-client');
    const { ReceiptIntelligencePipeline } = require('../application/ReceiptIntelligencePipeline');
    const { SupplyRepository, SUPPLY_COLLECTIONS } = require('../application/SupplyRepository');

    const tenantV3 = 'tenant-v3-e01';
    const siteV3 = 'site-v3-e01';
    await db.collection(SUPPLY_COLLECTIONS.SITES).doc(siteV3).set({
        siteId: siteV3,
        tenantId: tenantV3,
        name: 'Faena V3 E01',
        districtCode: 'CL-ATACAMA',
        currentHeadcount: 10,
        waterStorageCapacityL: 20_000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 5,
        shiftPattern: '7x7',
        roleMismatchMode: 'FLAG_AND_ACCEPT',
        directPurchaseAlertThresholdClp: 500_000,
    });

    // Perfil activo real para resolver teléfono sin depender del campo enmascarado
    await db.collection('accounts').doc(tenantV3).collection('members').doc('uid-req-v3').set({
        uid: 'uid-req-v3',
        status: 'ACTIVE',
        phoneE164: '+56987654321',
    });
    const resolvedPhone = await SupplyRepository.resolveActiveMemberPhoneE164(tenantV3, 'uid-req-v3');
    assert.equal(resolvedPhone, '+56987654321');

    // Stub temporal CAS + ResilientAIClient
    const origDigestAndStore = CasStorageService.digestAndStore;
    const origGenerateStructured = ResilientAIClient.generateStructured;
    let capturedDataClass: string | undefined;

    CasStorageService.digestAndStore = (async (_buf: Buffer, mime: string) => ({
        descriptor: {
            sha256: 'a'.repeat(64),
            phashHex: '0'.repeat(16),
            storagePath: `tenants/${tenantV3}/supply/receipts/test.bin`,
            downloadUrl: '',
            mimeType: mime,
            extension: mime === 'image/png' ? 'png' : 'xml',
            profile: mime === 'image/png' ? 'SUPPLY_RECEIPT_IMAGE' : 'XML_DTE_DOCUMENT',
            originalBytes: 512,
            optimizedBytes: 512,
            savingsRatio: 0,
            savingsPct: 0,
            originalFilename: 'dte33_net.xml',
            createdAt: new Date().toISOString(),
        },
        digested: {
            buffer: _buf,
            mimeType: mime,
            originalBytes: 512,
            optimizedBytes: 512,
        },
    })) as any;

    ResilientAIClient.generateStructured = (async (req: any) => {
        capturedDataClass = req.dataClassification;
        return {
            data: {
                supplierName: 'Comercial Prueba SpA',
                documentType: 39,
                folio: 123,
                totalAmountClp: 11900,
                lines: [
                    { description: 'Detergente aseo', quantity: 1, unitPriceClp: 11900, subtotalClp: 11900 },
                ],
            },
            meta: { model: 'gemini-test' },
        };
    }) as any;

    try {
        // 1. DTE 33 XML con <MontoItem> NETO (100.000 neto + 19.000 IVA = 119.000 total)
        const dte33NetXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0"><Documento>
  <Encabezado>
    <IdDoc><TipoDTE>33</TipoDTE><Folio>9901</Folio><FchEmis>2026-11-22</FchEmis></IdDoc>
    <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Proveedor Papas SpA</RznSoc></Emisor>
    <Receptor><RUTRecep>77123456-K</RUTRecep></Receptor>
    <Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales>
  </Encabezado>
  <Detalle><NmbItem>Papas 100 kg</NmbItem><QtyItem>100</QtyItem><UnmdItem>kg</UnmdItem><PrcItem>1000</PrcItem><MontoItem>100000</MontoItem></Detalle>
</Documento></DTE>`;

        const analyzed = await ReceiptIntelligencePipeline.analyze({
            tenantId: tenantV3,
            actorUid: 'uid-buyer-v3',
            xmlContent: dte33NetXml,
            defaultDestination: 'STOCK_IN_WAREHOUSE',
            defaultCostCenter: 'CC-CAMP-ALIMENTACION',
        });

        assert.equal(analyzed.arithmeticCheck.verified, true);
        assert.equal(analyzed.arithmeticCheck.pricingBasis, 'NET_PLUS_VAT');
        assert.equal(analyzed.lines[0].linePricingBasis, 'NET');
        assert.equal(analyzed.lines[0].subtotalClp, 100000);
        assert.equal(analyzed.vatCreditRecoverableClp, 19000);

        // Guardar compra -> NO debe dividir por 1.19 dos veces: PMP neto debe ser 1000 (NO 840!)
        const actor = { actorUid: 'uid-buyer-v3', actorEmail: 'buyer@v3.cl' };
        await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: tenantV3,
                siteId: siteV3,
                buyerUid: 'uid-buyer-v3',
                buyerRole: 'BUYER',
                purchaseMode: 'DIRECT_AUTONOMOUS',
                authorizedByAuthority: true,
                supplierTaxId: analyzed.supplierTaxId,
                supplierName: analyzed.supplierName,
                documentType: analyzed.documentType,
                folio: analyzed.folio,
                issueDate: analyzed.issueDate,
                netAmountClp: analyzed.netAmountClp,
                vatAmountClp: analyzed.vatAmountClp,
                totalAmountClp: analyzed.totalAmountClp,
                paymentMethod: 'TRANSFERENCIA',
                lines: analyzed.lines,
            },
            actor
        );

        const inv = await SupplyRepository.listInventory(tenantV3, siteV3);
        const papasInv = inv.find((i: any) => i.canonicalSkuId === 'SKU-VIV-PAPAS');
        assert.ok(papasInv);
        assert.equal(papasInv.avgUnitCostClp, 1000);

        // Compra no alimentaria (cloro aseo) + agua industrial NO deben contaminar foodOpex30d ni DS 594
        await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: tenantV3,
                siteId: siteV3,
                buyerUid: 'uid-buyer-v3',
                buyerRole: 'BUYER',
                purchaseMode: 'DIRECT_AUTONOMOUS',
                authorizedByAuthority: true,
                supplierTaxId: '76192083-9',
                supplierName: 'Química Industrial SpA',
                documentType: 33,
                folio: 9902,
                issueDate: '2026-11-22',
                netAmountClp: 50000,
                vatAmountClp: 9500,
                totalAmountClp: 59500,
                paymentMethod: 'TRANSFERENCIA',
                lines: [
                    {
                        purchaseLineId: 'pl-cloro',
                        canonicalSkuId: 'SKU-ASEO-CLORO',
                        description: 'Cloro industrial',
                        categoryCode: 'ASEO_HIGIENE',
                        procurementBucket: 'ASEO_HIGIENE',
                        unitSi: 'L',
                        qtyPurchased: 50,
                        unitPriceClp: 1000,
                        subtotalClp: 50000,
                        linePricingBasis: 'NET',
                        destination: 'STOCK_IN_WAREHOUSE',
                        costCenter: 'CC-CAMP-MANTENCION',
                        isCapexAsset: false,
                    },
                    {
                        purchaseLineId: 'pl-aguaind',
                        canonicalSkuId: 'SKU-AGUA-INDUSTRIAL',
                        description: 'Agua industrial aljibe',
                        categoryCode: 'AGUA_INDUSTRIAL',
                        procurementBucket: 'AGUA_INDUSTRIAL_ALJIBE',
                        unitSi: 'L',
                        qtyPurchased: 10000,
                        unitPriceClp: 10,
                        subtotalClp: 100000,
                        linePricingBasis: 'NET',
                        destination: 'STOCK_IN_WAREHOUSE',
                        costCenter: 'CC-OPS-AGUA-IND',
                        isCapexAsset: false,
                    },
                ],
            },
            actor
        );

        const forecasts = await SupplyRepository.computeForecastReadOnly(tenantV3, siteV3);
        const forecast = forecasts[0];
        assert.ok(forecast);
        assert.equal(forecast.dailyFoodOpexClpPerPax, Math.round(100000 / (30 * 10)));
        assert.equal(forecast.waterCoverageDays, 0); // Agua industrial NO cuenta como reserva potable DS 594

        // 2. DTE 61 Nota de Crédito -> vatCreditRecoverableClp negativo
        const dte61Xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0"><Documento>
  <Encabezado>
    <IdDoc><TipoDTE>61</TipoDTE><Folio>401</Folio><FchEmis>2026-11-22</FchEmis></IdDoc>
    <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>Proveedor Papas SpA</RznSoc></Emisor>
    <Receptor><RUTRecep>77123456-K</RUTRecep></Receptor>
    <Totales><MntNeto>20000</MntNeto><IVA>3800</IVA><MntTotal>23800</MntTotal></Totales>
  </Encabezado>
  <Detalle><NmbItem>Devolución Papas</NmbItem><QtyItem>20</QtyItem><UnmdItem>kg</UnmdItem><PrcItem>1000</PrcItem><MontoItem>20000</MontoItem></Detalle>
</Documento></DTE>`;

        const nc61 = await ReceiptIntelligencePipeline.analyze({
            tenantId: tenantV3,
            actorUid: 'uid-buyer-v3',
            xmlContent: dte61Xml,
        });
        assert.equal(nc61.documentType, 61);
        assert.equal(nc61.vatCreditRecoverableClp, -3800);
        assert.equal(nc61.lines[0].linePricingBasis, 'NET');

        // 3. Llamada AI vision pasa dataClassification: 'TENANT_PRIVATE'
        await ReceiptIntelligencePipeline.analyze({
            tenantId: tenantV3,
            actorUid: 'uid-buyer-v3',
            rawBuffer: Buffer.from([137, 80, 78, 71]),
            mimeType: 'image/png',
            originalFilename: 'boleta.png',
        });
        assert.equal(capturedDataClass, 'TENANT_PRIVATE');
    } finally {
        CasStorageService.digestAndStore = origDigestAndStore;
        ResilientAIClient.generateStructured = origGenerateStructured;
    }
});

// ============================================================================
// RUNNER DETERMINÍSTICO
// ============================================================================
async function runSuite(): Promise<void> {
    let passed = 0;
    let failed = 0;

    console.log('\n=== MINREPORT · ABASTECIMIENTO — Domain Engines Unit Test Suite ===');
    for (const tc of tests) {
        try {
            await tc.fn();
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

void runSuite();
