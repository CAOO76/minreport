/**
 * MINREPORT · ABASTECIMIENTO — Conciliador de Stock, Activos CAPEX, Caja y Centros de Costo
 *
 * Implementación 100% determinística:
 * - Separa estrictamente `qtyInTransit` vs `qtyInWarehouse` y gestiona la transición de
 *   recepción física `IN_TRANSIT -> IN_WAREHOUSE` (completa o parcial con discrepancias).
 * - Enruta activos CAPEX (`cocina`, `generador`, etc.) exclusivamente hacia `supply_assets`
 *   con valor neto depreciable (Art. 31 N° 5 LIR), SIN contaminar el OPEX diario de alimentación
 *   (`CLP/PAX/día`).
 * - Concilia métodos de pago (`CAJA_CHICA`, `FONDO_POR_RENDIR`, `REEMBOLSO_GERENCIA`,
 *   `TRANSFERENCIA`, `CREDITO_PROVEEDOR`), IVA 19% crédito fiscal (DTE 33) vs no recuperable
 *   (Boleta 39/41), e imputación a centros de costo (`CC-CAMPAMENTO`, `CC-FLOTA`,
 *   `CC-OPERACIONES`, `CC-HSEC`, `CC-CAPEX`).
 */

import {
    AtypicalFlagCode,
    CanonicalSupplySku,
    CashLedgerEntry,
    FulfillmentAllocation,
    SiiDteType,
    SiiExpenseReport,
    StockLedgerEntry,
    SupplyAsset,
    SupplyCategoryCode,
    SupplyCostCenter,
    SupplyPaymentMethod,
    SupplyPurchase,
    SupplyPurchaseLine,
    SupplyUnitSi,
    roundClp,
    roundSupplyQty,
} from './types';
import {
    CATEGORY_DEFAULT_COST_CENTER,
    findCanonicalSkuById,
} from '../catalog/DefaultSupplyCatalogSeed';
import {
    buildSiiDedupeKey,
    computeChileanVatBreakdown,
} from './SiiTaxValidator';

export interface ReconcilePurchaseOptions {
    recordedAt?: string;
    customCatalog?: readonly CanonicalSupplySku[];
    /** Vida útil tributaria SII por defecto en años (Art. 31 N° 5 LIR) para activos de equipamiento */
    defaultUsefulLifeYearsSii?: number;
}

export interface PurchaseReconciliationResult {
    purchaseId: string;
    dedupeKey: string;
    stockEntries: StockLedgerEntry[];
    createdAssets: SupplyAsset[];
    cashEntries: CashLedgerEntry[];
    summary: {
        totalGrossClp: number;
        totalNetClp: number;
        totalVatRecoverableClp: number;
        totalVatNonRecoverableClp: number;
        totalOpexImpactClp: number;
        totalCapexImpactClp: number;
        campFoodOpexClp: number;
        opexByCostCenter: Record<string, number>;
        capexByCostCenter: Record<string, number>;
    };
}

export interface WarehouseReceptionLineInput {
    canonicalSkuId: string;
    unitSi: SupplyUnitSi;
    expectedInTransitQty: number;
    receivedQty: number;
    unitCostNetClp: number;
    costCenter: SupplyCostCenter;
}

export interface WarehouseReceptionInput {
    receptionId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    recordedAt?: string;
    lines: readonly WarehouseReceptionLineInput[];
}

export interface WarehouseReceptionDiscrepancy {
    canonicalSkuId: string;
    expectedQty: number;
    receivedQty: number;
    shortageQty: number;
    excessQty: number;
}

export interface WarehouseReceptionResult {
    receptionId: string;
    stockEntries: StockLedgerEntry[];
    discrepancies: WarehouseReceptionDiscrepancy[];
    isCompleteReception: boolean;
}

export interface SkuInventoryBalance {
    canonicalSkuId: string;
    unitSi: SupplyUnitSi;
    qtyInTransit: number;
    qtyInWarehouse: number;
    totalEffectiveStock: number;
    weightedAvgUnitCostNetClp: number;
}

const FOOD_OPEX_CATEGORIES = new Set<SupplyCategoryCode>([
    'VIVERES_ALIMENTACION',
    'AGUA_POTABLE_BEBESTIBLE',
    'AGUA_POTABLE_SANITAR',
]);

function isPurchaseLineCapex(
    line: SupplyPurchaseLine,
    allocationsForLine: readonly FulfillmentAllocation[],
    customCatalog?: readonly CanonicalSupplySku[]
): boolean {
    if (line.destination === 'CAPEX_ASSET' || line.isCapexAsset) return true;
    if (line.categoryCode === 'ACTIVO_EQUIPAMIENTO') return true;
    if (allocationsForLine.some((a) => a.destination === 'CAPEX_ASSET')) return true;
    const sku = findCanonicalSkuById(line.canonicalSkuId, customCatalog);
    return Boolean(sku?.isCapexAsset);
}

function resolveCashEntryType(
    paymentMethod: SupplyPaymentMethod,
    isCapex: boolean
): CashLedgerEntry['entryType'] {
    if (isCapex) return 'CAPEX_ACQUISITION';
    if (paymentMethod === 'REEMBOLSO_GERENCIA') return 'REIMBURSEMENT_DUE';
    if (paymentMethod === 'CREDITO_PROVEEDOR') return 'SUPPLIER_PAYABLE';
    return 'EXPENSE_OPEX';
}

function resolveCostCenterForLine(
    line: SupplyPurchaseLine,
    isCapex: boolean,
    allocationsForLine: readonly FulfillmentAllocation[],
    purchaseFallbackCostCenter?: SupplyCostCenter
): SupplyCostCenter {
    if (isCapex) return 'CC-CAPEX';
    if (line.costCenter) return line.costCenter;
    if (allocationsForLine.length > 0 && allocationsForLine[0].costCenter) {
        return allocationsForLine[0].costCenter;
    }
    if (purchaseFallbackCostCenter) return purchaseFallbackCostCenter;
    return CATEGORY_DEFAULT_COST_CENTER[line.categoryCode] || 'CC-OPS-MINA';
}

/**
 * Concilia una compra en:
 * 1. `StockLedgerEntry[]` (separando `IN_TRANSIT` vs `IN_WAREHOUSE`).
 * 2. `SupplyAsset[]` (bóveda CAPEX aislada con base depreciable neta Art. 31 N° 5 LIR).
 * 3. `CashLedgerEntry[]` (caja/rendición/IVA recuperable vs no recuperable/centros de costo).
 */
export function reconcilePurchase(
    purchase: SupplyPurchase,
    allocations: readonly FulfillmentAllocation[],
    options?: ReconcilePurchaseOptions
): PurchaseReconciliationResult {
    const recordedAt = options?.recordedAt || purchase.createdAt || new Date().toISOString();
    const dedupeKey = buildSiiDedupeKey(purchase.supplierTaxId, purchase.documentType, purchase.folio);
    const defaultUsefulLife = options?.defaultUsefulLifeYearsSii ?? 7;

    const stockEntries: StockLedgerEntry[] = [];
    const createdAssets: SupplyAsset[] = [];
    const cashEntries: CashLedgerEntry[] = [];

    const opexByCostCenter: Record<string, number> = {};
    const capexByCostCenter: Record<string, number> = {};

    let totalGrossClp = 0;
    let totalNetClp = 0;
    let totalVatRecoverableClp = 0;
    let totalVatNonRecoverableClp = 0;
    let totalOpexImpactClp = 0;
    let totalCapexImpactClp = 0;
    let campFoodOpexClp = 0;

    const isCreditNote = purchase.documentType === 61;
    const sign = isCreditNote ? -1 : 1;

    let stockSeq = 1;
    let assetSeq = 1;
    let cashSeq = 1;

    for (const line of purchase.lines) {
        const lineAllocs = allocations.filter((a) => a.purchaseLineId === line.purchaseLineId);
        const isCapex = isPurchaseLineCapex(line, lineAllocs, options?.customCatalog);
        const costCenter = resolveCostCenterForLine(
            line,
            isCapex,
            lineAllocs,
            purchase.costCenter
        );

        const isNetLine = line.linePricingBasis === 'NET';
        const inferredGross =
            line.subtotalGrossClp > 0
                ? line.subtotalGrossClp
                : isNetLine && line.subtotalNetClp > 0
                  ? purchase.documentType === 33 ||
                    purchase.documentType === 52 ||
                    purchase.documentType === 61
                      ? roundClp(line.subtotalNetClp * 1.19)
                      : line.subtotalNetClp
                  : line.unitPriceGrossClp * line.qtyPurchased;
        const lineGross = roundClp(inferredGross * sign);
        const lineNetInput =
            line.subtotalNetClp > 0
                ? roundClp(line.subtotalNetClp * sign)
                : undefined;

        const vat = computeChileanVatBreakdown({
            dteType: purchase.documentType,
            totalAmountClp: lineGross,
            netAmountClp: lineNetInput,
        });

        // Base de costo contable:
        // - Si el DTE otorga IVA crédito fiscal recuperable (33, 52, 61): costo/activo = Neto.
        // - Si el IVA NO es recuperable (Boleta 39/41) o sin DTE (0): OPEX absorbe el total pagado;
        //   para CAPEX bajo Art. 31 N° 5 LIR se registra la base neta y se dispara `ATYPICAL_ASSET_WITHOUT_INVOICE`.
        const hasRecoverableVat =
            purchase.documentType === 33 ||
            purchase.documentType === 52 ||
            purchase.documentType === 61;
        const accountingCostBasisClp = hasRecoverableVat
            ? vat.netAmountClp
            : vat.totalAmountClp;

        totalGrossClp = roundClp(totalGrossClp + vat.totalAmountClp);
        totalNetClp = roundClp(totalNetClp + vat.netAmountClp);
        totalVatRecoverableClp = roundClp(totalVatRecoverableClp + vat.vatRecoverableClp);
        totalVatNonRecoverableClp = roundClp(totalVatNonRecoverableClp + vat.vatNonRecoverableClp);

        if (isCapex) {
            // ── RUTA CAPEX ESTRICTA (`supply_assets`) — NO contamina OPEX de alimentos ni stock consumible
            const missingInvoiceAlert =
                purchase.documentType !== 33 && purchase.documentType !== 34;
            const atypicalFlags: AtypicalFlagCode[] = missingInvoiceAlert
                ? ['ATYPICAL_ASSET_WITHOUT_INVOICE']
                : [];

            // Art. 31 N° 5 LIR: valor neto depreciable del activo (excluyendo IVA crédito fiscal)
            const depreciableBasisClp = vat.netAmountClp;

            createdAssets.push({
                assetId: `asset-${purchase.purchaseId}-${assetSeq++}`,
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                purchaseId: purchase.purchaseId,
                purchaseLineId: line.purchaseLineId,
                canonicalSkuId: line.canonicalSkuId,
                name: line.description,
                serialOrTag: line.serialOrTag,
                acquisitionNetClp: vat.netAmountClp,
                vatCreditClp: vat.vatRecoverableClp,
                grossPaidClp: vat.totalAmountClp,
                depreciableBasisClp,
                usefulLifeYearsSii: defaultUsefulLife,
                invoiceDteType: purchase.documentType,
                invoiceFolio: purchase.folio,
                supplierTaxId: purchase.supplierTaxId,
                evidenceCasRef: purchase.evidenceCasRef,
                missingInvoiceAlert,
                atypicalFlags,
                warrantyUntil: line.warrantyUntil,
                opermaqAssetId: line.opermaqAssetId,
                createdAt: recordedAt,
            });

            totalCapexImpactClp = roundClp(totalCapexImpactClp + depreciableBasisClp);
            capexByCostCenter[costCenter] = roundClp(
                (capexByCostCenter[costCenter] || 0) + depreciableBasisClp
            );

            cashEntries.push({
                entryId: `cash-${purchase.purchaseId}-${cashSeq++}`,
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                purchaseId: purchase.purchaseId,
                paymentMethod: purchase.paymentMethod,
                entryType: resolveCashEntryType(purchase.paymentMethod, true),
                categoryCode: line.categoryCode,
                netAmountClp: vat.netAmountClp,
                vatRecoverableClp: vat.vatRecoverableClp,
                vatNonRecoverableClp: vat.vatNonRecoverableClp,
                grossAmountClp: vat.totalAmountClp,
                opexImpactClp: 0,
                capexImpactClp: depreciableBasisClp,
                costCenter: 'CC-CAPEX',
                dteType: purchase.documentType,
                dedupeKey,
                recordedAt,
            });
            continue;
        }

        // ── RUTA OPEX / INVENTARIO CONSUMIBLE ───────────────────────────────
        const qty = roundSupplyQty(line.qtyPurchased);
        const unitCostNetClp = qty > 0 ? roundClp(accountingCostBasisClp / qty) : 0;

        if (line.destination === 'STOCK_IN_TRANSIT') {
            stockEntries.push({
                entryId: `stk-${purchase.purchaseId}-${stockSeq++}`,
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                canonicalSkuId: line.canonicalSkuId,
                movementType: 'INBOUND_TRANSIT',
                deltaInTransit: qty,
                deltaInWarehouse: 0,
                unitSi: line.unitSi,
                unitCostNetClp,
                referenceId: purchase.purchaseId,
                costCenter,
                recordedAt,
            });
        } else if (line.destination === 'STOCK_IN_WAREHOUSE') {
            stockEntries.push({
                entryId: `stk-${purchase.purchaseId}-${stockSeq++}`,
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                canonicalSkuId: line.canonicalSkuId,
                movementType: 'DIRECT_RECEIPT',
                deltaInTransit: 0,
                deltaInWarehouse: qty,
                unitSi: line.unitSi,
                unitCostNetClp,
                referenceId: purchase.purchaseId,
                costCenter,
                recordedAt,
            });
        }
        // Si destination === 'DIRECT_EXPENSE', impacta directamente OPEX sin crear asiento de bodega

        totalOpexImpactClp = roundClp(totalOpexImpactClp + accountingCostBasisClp);
        opexByCostCenter[costCenter] = roundClp(
            (opexByCostCenter[costCenter] || 0) + accountingCostBasisClp
        );

        if (FOOD_OPEX_CATEGORIES.has(line.categoryCode)) {
            campFoodOpexClp = roundClp(campFoodOpexClp + accountingCostBasisClp);
        }

        cashEntries.push({
            entryId: `cash-${purchase.purchaseId}-${cashSeq++}`,
            tenantId: purchase.tenantId,
            siteId: purchase.siteId,
            purchaseId: purchase.purchaseId,
            paymentMethod: purchase.paymentMethod,
            entryType: resolveCashEntryType(purchase.paymentMethod, false),
            categoryCode: line.categoryCode,
            netAmountClp: vat.netAmountClp,
            vatRecoverableClp: vat.vatRecoverableClp,
            vatNonRecoverableClp: vat.vatNonRecoverableClp,
            grossAmountClp: vat.totalAmountClp,
            opexImpactClp: accountingCostBasisClp,
            capexImpactClp: 0,
            costCenter,
            dteType: purchase.documentType,
            dedupeKey,
            recordedAt,
        });
    }

    return {
        purchaseId: purchase.purchaseId,
        dedupeKey,
        stockEntries,
        createdAssets,
        cashEntries,
        summary: {
            totalGrossClp,
            totalNetClp,
            totalVatRecoverableClp,
            totalVatNonRecoverableClp,
            totalOpexImpactClp,
            totalCapexImpactClp,
            campFoodOpexClp,
            opexByCostCenter,
            capexByCostCenter,
        },
    };
}

/**
 * Ejecuta la transición física auditable `IN_TRANSIT -> IN_WAREHOUSE` en recepción de bodega.
 */
export function confirmWarehouseReception(
    input: WarehouseReceptionInput
): WarehouseReceptionResult {
    const recordedAt = input.recordedAt || new Date().toISOString();
    const stockEntries: StockLedgerEntry[] = [];
    const discrepancies: WarehouseReceptionDiscrepancy[] = [];

    let seq = 1;
    for (const line of input.lines) {
        const expected = roundSupplyQty(Math.max(0, line.expectedInTransitQty));
        const received = roundSupplyQty(Math.max(0, line.receivedQty));
        // Lo que sale de tránsito nunca supera lo esperado en tránsito
        const transitCleared = roundSupplyQty(Math.min(expected, received));

        if (received > 0) {
            stockEntries.push({
                entryId: `stk-rec-${input.receptionId}-${seq++}`,
                tenantId: input.tenantId,
                siteId: input.siteId,
                canonicalSkuId: line.canonicalSkuId,
                movementType: 'RECEIPT_AT_WAREHOUSE',
                deltaInTransit: -transitCleared,
                deltaInWarehouse: received,
                unitSi: line.unitSi,
                unitCostNetClp: roundClp(line.unitCostNetClp),
                referenceId: input.receptionId,
                costCenter: line.costCenter,
                recordedAt,
            });
        }

        if (received !== expected) {
            discrepancies.push({
                canonicalSkuId: line.canonicalSkuId,
                expectedQty: expected,
                receivedQty: received,
                shortageQty: received < expected ? roundSupplyQty(expected - received) : 0,
                excessQty: received > expected ? roundSupplyQty(received - expected) : 0,
            });
        }
    }

    return {
        receptionId: input.receptionId,
        stockEntries,
        discrepancies,
        isCompleteReception: discrepancies.length === 0,
    };
}

/**
 * Agrega asientos de `StockLedgerEntry` en saldos exactos `qtyInTransit` vs `qtyInWarehouse` por SKU.
 */
export function computeInventoryBalances(
    entries: readonly StockLedgerEntry[]
): Record<string, SkuInventoryBalance> {
    const map: Record<
        string,
        {
            unitSi: SupplyUnitSi;
            qtyInTransit: number;
            qtyInWarehouse: number;
            totalInboundQty: number;
            totalInboundCostClp: number;
        }
    > = {};

    for (const entry of entries) {
        if (!map[entry.canonicalSkuId]) {
            map[entry.canonicalSkuId] = {
                unitSi: entry.unitSi,
                qtyInTransit: 0,
                qtyInWarehouse: 0,
                totalInboundQty: 0,
                totalInboundCostClp: 0,
            };
        }
        const acc = map[entry.canonicalSkuId];
        acc.qtyInTransit = roundSupplyQty(Math.max(0, acc.qtyInTransit + entry.deltaInTransit));
        acc.qtyInWarehouse = roundSupplyQty(Math.max(0, acc.qtyInWarehouse + entry.deltaInWarehouse));

        if (entry.deltaInWarehouse > 0) {
            acc.totalInboundQty = roundSupplyQty(acc.totalInboundQty + entry.deltaInWarehouse);
            acc.totalInboundCostClp += entry.deltaInWarehouse * entry.unitCostNetClp;
        }
    }

    const result: Record<string, SkuInventoryBalance> = {};
    for (const [skuId, acc] of Object.entries(map)) {
        result[skuId] = {
            canonicalSkuId: skuId,
            unitSi: acc.unitSi,
            qtyInTransit: acc.qtyInTransit,
            qtyInWarehouse: acc.qtyInWarehouse,
            totalEffectiveStock: roundSupplyQty(acc.qtyInTransit + acc.qtyInWarehouse),
            weightedAvgUnitCostNetClp:
                acc.totalInboundQty > 0 ? roundClp(acc.totalInboundCostClp / acc.totalInboundQty) : 0,
        };
    }

    return result;
}

/**
 * Concilia una rendición de fondos (`CAJA_CHICA`, `FONDO_POR_RENDIR`, `REEMBOLSO_GERENCIA`).
 * - `balanceClp > 0`: sobrante a devolver a caja empresa (`SURPLUS_TO_RETURN`).
 * - `balanceClp < 0`: reembolso adeudado al comprador / gerencia (`REIMBURSEMENT_TO_BUYER`).
 * - `balanceClp === 0`: cuadrado (`BALANCED`).
 */
export function reconcileFundAdvanceReport(params: {
    reportId: string;
    tenantId: string;
    siteId: string;
    responsibleUid: string;
    periodLabel: string;
    paymentMethod: SupplyPaymentMethod;
    fundAdvanceClp: number;
    renderedDocuments: readonly { documentId: string; totalAmountClp: number }[];
    status?: SiiExpenseReport['status'];
}): SiiExpenseReport {
    const fundAdvanceClp = roundClp(params.fundAdvanceClp);
    const renderedTotalClp = roundClp(
        params.renderedDocuments.reduce((sum, d) => sum + roundClp(d.totalAmountClp), 0)
    );
    const balanceClp = roundClp(fundAdvanceClp - renderedTotalClp);

    const balanceDisposition: SiiExpenseReport['balanceDisposition'] =
        balanceClp > 0
            ? 'SURPLUS_TO_RETURN'
            : balanceClp < 0
              ? 'REIMBURSEMENT_TO_BUYER'
              : 'BALANCED';

    return {
        reportId: params.reportId,
        tenantId: params.tenantId,
        siteId: params.siteId,
        responsibleUid: params.responsibleUid,
        periodLabel: params.periodLabel,
        paymentMethod: params.paymentMethod,
        fundAdvanceClp,
        renderedTotalClp,
        balanceClp,
        balanceDisposition,
        documentIds: params.renderedDocuments.map((d) => d.documentId),
        status: params.status || 'RECONCILED',
    };
}

/**
 * Calcula el indicador OPEX diario de alimentación por persona (`CLP / PAX / día`),
 * excluyendo estrictamente toda adquisición CAPEX (`opexImpactClp === 0`).
 */
export function computeFoodCostPerPaxDay(params: {
    cashEntries: readonly CashLedgerEntry[];
    headcount: number;
    days: number;
}): {
    totalFoodOpexClp: number;
    excludedCapexClp: number;
    clpPerPaxDay: number;
} {
    let totalFoodOpexClp = 0;
    let excludedCapexClp = 0;

    for (const entry of params.cashEntries) {
        if (entry.capexImpactClp > 0) {
            excludedCapexClp = roundClp(excludedCapexClp + entry.capexImpactClp);
        }
        if (
            entry.opexImpactClp > 0 &&
            FOOD_OPEX_CATEGORIES.has(entry.categoryCode) &&
            (entry.costCenter === 'CC-CAMP-ALIMENTACION' ||
                entry.costCenter === 'CC-CAMP-AGUA' ||
                entry.costCenter === 'CC-CAMPAMENTO')
        ) {
            totalFoodOpexClp = roundClp(totalFoodOpexClp + entry.opexImpactClp);
        }
    }

    const denom = params.headcount * params.days;
    const clpPerPaxDay = denom > 0 ? roundClp(totalFoodOpexClp / denom) : 0;

    return {
        totalFoodOpexClp,
        excludedCapexClp,
        clpPerPaxDay,
    };
}
