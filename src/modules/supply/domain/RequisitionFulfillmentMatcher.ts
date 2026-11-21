/**
 * MINREPORT · ABASTECIMIENTO — Motor N:M FIFO de Conciliación Requisición ↔ Compra
 *
 * Soporta los 3 modos operativos de compra:
 * 1. `REQUISITION_FULFILLMENT`: asigna líneas compradas contra el backlog abierto/parcial
 *    en estricto orden FIFO (`createdAt` ascendente), dejando saldos parciales exactos y
 *    clasificando compras no solicitadas como `UNSOLICITED_PURCHASE` (enrutando activos CAPEX
 *    directamente a `CAPEX_ASSET` / `CC-CAPEX`).
 * 2. `DIRECT_AUTONOMOUS` (ej. Gerente General `OWNER_EXEC`): agrega directamente a stock o
 *    bóveda CAPEX sin exigir requisición previa, ofreciendo sugerencias no bloqueantes si
 *    existen requisiciones abiertas coincidentes.
 * 3. `MIXED_FULFILLMENT_AND_DIRECT`: combina cumplimiento FIFO con adquisiciones autónomas.
 */

import {
    CanonicalSupplySku,
    FulfillmentAllocation,
    RequisitionLineStatus,
    RequisitionStatus,
    SupplyCostCenter,
    SupplyLineDestination,
    SupplyPurchase,
    SupplyPurchaseLine,
    SupplyRequisition,
    SupplyRequisitionLine,
    SupplyUnitSi,
    roundSupplyQty,
} from './types';
import {
    CATEGORY_DEFAULT_COST_CENTER,
    findCanonicalSkuById,
} from '../catalog/DefaultSupplyCatalogSeed';

export interface SuggestedBacklogMatch {
    purchaseLineId: string;
    canonicalSkuId: string;
    requisitionId: string;
    requisitionLineId: string;
    reqPendingQty: number;
    purchasedQty: number;
    suggestedAllocatableQty: number;
    unitSi: SupplyUnitSi;
    requesterName: string;
}

export interface HitlComparativeRow {
    canonicalSkuId: string;
    description: string;
    unitSi: SupplyUnitSi;
    requestedBeforeQty: number;
    pendingBeforeQty: number;
    detectedInPurchaseQty: number;
    pendingAfterQty: number;
    resultingState: 'FULFILLED' | 'PARTIAL' | 'OPEN' | 'UNSOLICITED_CAPEX' | 'UNSOLICITED_STOCK' | 'DIRECT_AUTONOMOUS';
    destination: SupplyLineDestination;
}

export interface FulfillmentMatchOptions {
    matchedAt?: string;
    customCatalog?: readonly CanonicalSupplySku[];
    /** Si true en modo DIRECT_AUTONOMOUS, además vincula automáticamente contra el backlog; por defecto false (no bloqueante). */
    autoApplyDirectToBacklog?: boolean;
}

export interface FulfillmentMatchResult {
    purchaseId: string;
    purchaseMode: SupplyPurchase['purchaseMode'];
    allocations: FulfillmentAllocation[];
    unsolicitedAllocations: FulfillmentAllocation[];
    updatedRequisitions: SupplyRequisition[];
    suggestedBacklogMatches: SuggestedBacklogMatch[];
    hitlComparativeRows: HitlComparativeRow[];
}

function isLineCapex(
    line: SupplyPurchaseLine,
    customCatalog?: readonly CanonicalSupplySku[]
): boolean {
    if (line.destination === 'CAPEX_ASSET') return true;
    if (line.isCapexAsset) return true;
    if (line.categoryCode === 'ACTIVO_EQUIPAMIENTO') return true;
    const sku = findCanonicalSkuById(line.canonicalSkuId, customCatalog);
    return Boolean(sku?.isCapexAsset);
}

function resolveLineDestination(
    line: SupplyPurchaseLine,
    customCatalog?: readonly CanonicalSupplySku[]
): SupplyLineDestination {
    if (isLineCapex(line, customCatalog)) {
        return 'CAPEX_ASSET';
    }
    return line.destination || 'STOCK_IN_TRANSIT';
}

function resolveLineCostCenter(
    line: SupplyPurchaseLine,
    destination: SupplyLineDestination,
    fallbackCostCenter?: SupplyCostCenter
): SupplyCostCenter {
    if (destination === 'CAPEX_ASSET') return 'CC-CAPEX';
    if (line.costCenter) return line.costCenter;
    if (fallbackCostCenter) return fallbackCostCenter;
    return CATEGORY_DEFAULT_COST_CENTER[line.categoryCode] || 'CC-OPERACIONES';
}

function recomputeRequisitionStatus(lines: readonly SupplyRequisitionLine[], currentStatus: RequisitionStatus): RequisitionStatus {
    if (currentStatus === 'CANCELLED') return 'CANCELLED';
    const activeLines = lines.filter((l) => l.lineStatus !== 'CANCELLED');
    if (activeLines.length === 0) return 'CANCELLED';

    const allFulfilled = activeLines.every((l) => l.lineStatus === 'FULFILLED' || l.qtyPending <= 0);
    if (allFulfilled) return 'FULFILLED';

    const anyProgress = activeLines.some(
        (l) => l.lineStatus === 'FULFILLED' || l.lineStatus === 'PARTIAL' || l.qtyPurchased > 0
    );
    return anyProgress ? 'PARTIAL' : 'OPEN';
}

function cloneRequisitions(reqs: readonly SupplyRequisition[]): SupplyRequisition[] {
    return reqs.map((req) => ({
        ...req,
        lines: req.lines.map((line) => ({
            ...line,
            atypicalFlags: [...line.atypicalFlags],
            attributes: line.attributes ? { ...line.attributes } : undefined,
        })),
    }));
}

/**
 * Ejecuta la asignación determinística N:M FIFO de una compra contra el backlog de requisiciones.
 */
export function matchPurchaseToRequisitions(
    purchase: SupplyPurchase,
    openRequisitions: readonly SupplyRequisition[],
    options?: FulfillmentMatchOptions
): FulfillmentMatchResult {
    const matchedAt = options?.matchedAt || purchase.createdAt || new Date().toISOString();
    const clonedReqs = cloneRequisitions(openRequisitions);

    // Construir índice FIFO de líneas elegibles (ordenadas cronológicamente por createdAt ascendente)
    interface FifoCandidate {
        req: SupplyRequisition;
        line: SupplyRequisitionLine;
        createdMs: number;
    }

    const fifoCandidates: FifoCandidate[] = [];
    const beforeSnapshotBySku = new Map<
        string,
        { description: string; unitSi: SupplyUnitSi; requested: number; pendingBefore: number }
    >();

    for (const req of clonedReqs) {
        if (req.status === 'CANCELLED' || req.status === 'FULFILLED') continue;
        const createdMs = Date.parse(req.createdAt) || 0;
        for (const line of req.lines) {
            if (line.lineStatus === 'CANCELLED' || line.lineStatus === 'FULFILLED') continue;
            if (line.qtyPending <= 0) continue;

            fifoCandidates.push({ req, line, createdMs });

            const prev = beforeSnapshotBySku.get(line.canonicalSkuId);
            if (!prev) {
                beforeSnapshotBySku.set(line.canonicalSkuId, {
                    description: line.description,
                    unitSi: line.unitSi,
                    requested: line.qtyRequested,
                    pendingBefore: line.qtyPending,
                });
            } else {
                prev.requested = roundSupplyQty(prev.requested + line.qtyRequested);
                prev.pendingBefore = roundSupplyQty(prev.pendingBefore + line.qtyPending);
            }
        }
    }

    fifoCandidates.sort((a, b) => {
        if (a.createdMs !== b.createdMs) return a.createdMs - b.createdMs;
        const reqCmp = a.req.reqId.localeCompare(b.req.reqId);
        if (reqCmp !== 0) return reqCmp;
        return a.line.lineId.localeCompare(b.line.lineId);
    });

    const allocations: FulfillmentAllocation[] = [];
    const unsolicitedAllocations: FulfillmentAllocation[] = [];
    const suggestedBacklogMatches: SuggestedBacklogMatch[] = [];
    const detectedQtyBySku = new Map<string, number>();
    const destinationBySku = new Map<string, SupplyLineDestination>();
    const descriptionBySku = new Map<string, { description: string; unitSi: SupplyUnitSi }>();

    let allocSeq = 1;
    const nextAllocId = () => `alloc-${purchase.purchaseId}-${allocSeq++}`;

    const shouldApplyFifo =
        purchase.purchaseMode === 'REQUISITION_FULFILLMENT' ||
        purchase.purchaseMode === 'MIXED_FULFILLMENT_AND_DIRECT' ||
        (purchase.purchaseMode === 'DIRECT_AUTONOMOUS' && Boolean(options?.autoApplyDirectToBacklog));

    for (const pLine of purchase.lines) {
        const qtyPurchased = roundSupplyQty(pLine.qtyPurchased);
        if (qtyPurchased <= 0) continue;

        const resolvedDest = resolveLineDestination(pLine, options?.customCatalog);
        detectedQtyBySku.set(
            pLine.canonicalSkuId,
            roundSupplyQty((detectedQtyBySku.get(pLine.canonicalSkuId) || 0) + qtyPurchased)
        );
        destinationBySku.set(pLine.canonicalSkuId, resolvedDest);
        descriptionBySku.set(pLine.canonicalSkuId, {
            description: pLine.description,
            unitSi: pLine.unitSi,
        });

        // Caso 1: DIRECT_AUTONOMOUS (Gerente General / compra directa sin bloquear ni exigir requisición)
        if (!shouldApplyFifo) {
            const directCostCenter = resolveLineCostCenter(pLine, resolvedDest, purchase.costCenter);
            const directAlloc: FulfillmentAllocation = {
                allocationId: nextAllocId(),
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                purchaseId: purchase.purchaseId,
                purchaseLineId: pLine.purchaseLineId,
                canonicalSkuId: pLine.canonicalSkuId,
                allocationType: 'DIRECT_AUTONOMOUS',
                requisitionId: null,
                requisitionLineId: null,
                qtyAllocated: qtyPurchased,
                unitSi: pLine.unitSi,
                destination: resolvedDest,
                costCenter: directCostCenter,
                createdAt: matchedAt,
            };
            allocations.push(directAlloc);

            // Generar sugerencias informativas no bloqueantes si hay backlog abierto del mismo SKU
            let suggestRemaining = qtyPurchased;
            for (const cand of fifoCandidates) {
                if (suggestRemaining <= 0) break;
                if (
                    cand.line.canonicalSkuId === pLine.canonicalSkuId &&
                    cand.line.unitSi === pLine.unitSi &&
                    cand.line.qtyPending > 0
                ) {
                    const allocatable = roundSupplyQty(Math.min(suggestRemaining, cand.line.qtyPending));
                    suggestedBacklogMatches.push({
                        purchaseLineId: pLine.purchaseLineId,
                        canonicalSkuId: pLine.canonicalSkuId,
                        requisitionId: cand.req.reqId,
                        requisitionLineId: cand.line.lineId,
                        reqPendingQty: cand.line.qtyPending,
                        purchasedQty: qtyPurchased,
                        suggestedAllocatableQty: allocatable,
                        unitSi: pLine.unitSi,
                        requesterName: cand.req.requesterName,
                    });
                    suggestRemaining = roundSupplyQty(suggestRemaining - allocatable);
                }
            }
            continue;
        }

        // Caso 2: REQUISITION_FULFILLMENT o MIXED_FULFILLMENT_AND_DIRECT (N:M FIFO)
        let remainingToAllocate = qtyPurchased;

        for (const cand of fifoCandidates) {
            if (remainingToAllocate <= 0) break;
            if (cand.line.canonicalSkuId !== pLine.canonicalSkuId) continue;
            if (cand.line.unitSi !== pLine.unitSi) continue;
            if (cand.line.qtyPending <= 0) continue;

            const allocatedQty = roundSupplyQty(Math.min(remainingToAllocate, cand.line.qtyPending));
            if (allocatedQty <= 0) continue;

            cand.line.qtyPurchased = roundSupplyQty(cand.line.qtyPurchased + allocatedQty);
            cand.line.qtyPending = roundSupplyQty(
                Math.max(0, cand.line.qtyRequested - cand.line.qtyPurchased)
            );
            const newStatus: RequisitionLineStatus =
                cand.line.qtyPending <= 0
                    ? 'FULFILLED'
                    : cand.line.qtyPurchased > 0
                      ? 'PARTIAL'
                      : 'OPEN';
            cand.line.lineStatus = newStatus;

            remainingToAllocate = roundSupplyQty(remainingToAllocate - allocatedQty);

            allocations.push({
                allocationId: nextAllocId(),
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                purchaseId: purchase.purchaseId,
                purchaseLineId: pLine.purchaseLineId,
                canonicalSkuId: pLine.canonicalSkuId,
                allocationType: 'REQUISITION_MATCH',
                requisitionId: cand.req.reqId,
                requisitionLineId: cand.line.lineId,
                qtyAllocated: allocatedQty,
                unitSi: pLine.unitSi,
                destination: resolvedDest,
                costCenter: resolvedDest === 'CAPEX_ASSET' ? 'CC-CAPEX' : cand.req.costCenter,
                createdAt: matchedAt,
            });
        }

        // Remanente o ítem no solicitado en ninguna requisición abierta (ej. cocina CAPEX)
        if (remainingToAllocate > 0) {
            const unsolicitedCostCenter = resolveLineCostCenter(
                pLine,
                resolvedDest,
                purchase.costCenter
            );
            const unsolicitedAlloc: FulfillmentAllocation = {
                allocationId: nextAllocId(),
                tenantId: purchase.tenantId,
                siteId: purchase.siteId,
                purchaseId: purchase.purchaseId,
                purchaseLineId: pLine.purchaseLineId,
                canonicalSkuId: pLine.canonicalSkuId,
                allocationType: 'UNSOLICITED_PURCHASE',
                requisitionId: null,
                requisitionLineId: null,
                qtyAllocated: remainingToAllocate,
                unitSi: pLine.unitSi,
                destination: resolvedDest,
                costCenter: unsolicitedCostCenter,
                createdAt: matchedAt,
            };
            allocations.push(unsolicitedAlloc);
            unsolicitedAllocations.push(unsolicitedAlloc);
        }
    }

    // Recalcular estado global de cada requisición actualizada
    for (const req of clonedReqs) {
        req.status = recomputeRequisitionStatus(req.lines, req.status);
        req.updatedAt = matchedAt;
    }

    // Construir tabla comparativa HITL ([Solicitado / Pendiente] -> [Detectado] -> [Nuevo Estado])
    const pendingAfterBySku = new Map<string, number>();
    for (const req of clonedReqs) {
        if (req.status === 'CANCELLED') continue;
        for (const line of req.lines) {
            if (line.lineStatus === 'CANCELLED') continue;
            pendingAfterBySku.set(
                line.canonicalSkuId,
                roundSupplyQty((pendingAfterBySku.get(line.canonicalSkuId) || 0) + line.qtyPending)
            );
        }
    }

    const allSkuIds = new Set<string>([
        ...beforeSnapshotBySku.keys(),
        ...detectedQtyBySku.keys(),
    ]);

    const hitlComparativeRows: HitlComparativeRow[] = [];
    for (const skuId of allSkuIds) {
        const before = beforeSnapshotBySku.get(skuId);
        const detected = detectedQtyBySku.get(skuId) || 0;
        const pendingAfter = pendingAfterBySku.get(skuId) || 0;
        const dest = destinationBySku.get(skuId) || 'STOCK_IN_TRANSIT';
        const meta = descriptionBySku.get(skuId) || {
            description: before?.description || skuId,
            unitSi: before?.unitSi || 'un',
        };

        let resultingState: HitlComparativeRow['resultingState'];
        if (!before) {
            if (purchase.purchaseMode === 'DIRECT_AUTONOMOUS') {
                resultingState = 'DIRECT_AUTONOMOUS';
            } else {
                resultingState = dest === 'CAPEX_ASSET' ? 'UNSOLICITED_CAPEX' : 'UNSOLICITED_STOCK';
            }
        } else if (purchase.purchaseMode === 'DIRECT_AUTONOMOUS' && !options?.autoApplyDirectToBacklog) {
            resultingState = detected > 0 ? 'DIRECT_AUTONOMOUS' : 'OPEN';
        } else if (pendingAfter <= 0) {
            resultingState = 'FULFILLED';
        } else if (detected > 0) {
            resultingState = 'PARTIAL';
        } else {
            resultingState = 'OPEN';
        }

        hitlComparativeRows.push({
            canonicalSkuId: skuId,
            description: meta.description,
            unitSi: meta.unitSi,
            requestedBeforeQty: before?.requested || 0,
            pendingBeforeQty: before?.pendingBefore || 0,
            detectedInPurchaseQty: detected,
            pendingAfterQty: pendingAfter,
            resultingState,
            destination: dest,
        });
    }

    return {
        purchaseId: purchase.purchaseId,
        purchaseMode: purchase.purchaseMode,
        allocations,
        unsolicitedAllocations,
        updatedRequisitions: clonedReqs,
        suggestedBacklogMatches,
        hitlComparativeRows,
    };
}
