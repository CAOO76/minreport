/**
 * MINREPORT · ABASTECIMIENTO — Consolidador Inteligente de Listas de Compra
 *
 * Consolida N requisiciones abiertas o parciales en rutas de compra agrupadas por
 * tipo de comercio (`ProcurementBucket`) + `canonicalSkuId`, sumando únicamente
 * `qtyPending > 0`, ordenando `CRITICAL -> PARTIAL_PENDING -> STANDARD` y preservando
 * 100% trazabilidad inversa (`sourceReqRefs[]` con reqId, lineId, costCenter y qtyPending).
 */

import {
    AtypicalFlagCode,
    CanonicalSupplySku,
    ConsolidatedShoppingList,
    ConsolidatedShoppingListBucket,
    ConsolidatedShoppingListSourceRef,
    ConsolidatedSkuItem,
    ProcurementBucket,
    ShoppingListPriorityTier,
    SupplyRequisition,
    SupplyUrgency,
    roundClp,
    roundSupplyQty,
} from './types';
import { findCanonicalSkuById } from '../catalog/DefaultSupplyCatalogSeed';

export interface ConsolidatorOptions {
    tenantId?: string;
    siteId?: string;
    generatedAt?: string;
    customCatalog?: readonly CanonicalSupplySku[];
    filterBuckets?: readonly ProcurementBucket[];
}

const PRIORITY_TIER_RANK: Readonly<Record<ShoppingListPriorityTier, number>> = {
    CRITICAL: 0,
    PARTIAL_PENDING: 1,
    STANDARD: 2,
};

const URGENCY_RANK: Readonly<Record<SupplyUrgency, number>> = {
    CRITICAL: 0,
    HIGH: 1,
    STANDARD: 2,
    PLANNED: 3,
};

const CANONICAL_BUCKET_ORDER: readonly ProcurementBucket[] = [
    'VERDULERIA',
    'SUPERMERCADO',
    'AGUA_POTABLE',
    'AGUA_INDUSTRIAL_ALJIBE',
    'GAS_GLP_DOMESTICO',
    'GASES_INDUSTRIALES',
    'COMBUSTIBLE_GRANEL',
    'REPUESTOS_LUBRICANTES',
    'FERRETERIA_INSUMOS',
    'PERFORACION_FORTIFICACION',
    'EPP_SEGURIDAD',
    'CONTROLADOS_DGMN',
    'ACTIVOS_CAPEX',
    'ASEO_HIGIENE',
    'MANTENCION_CAMP',
];

function resolveHigherUrgency(a: SupplyUrgency, b: SupplyUrgency): SupplyUrgency {
    return URGENCY_RANK[a] <= URGENCY_RANK[b] ? a : b;
}

function resolvePriorityTier(
    highestUrgency: SupplyUrgency,
    hasPartialPending: boolean
): ShoppingListPriorityTier {
    if (highestUrgency === 'CRITICAL') return 'CRITICAL';
    if (hasPartialPending) return 'PARTIAL_PENDING';
    return 'STANDARD';
}

/**
 * Consolida N requisiciones abiertas/parciales en una `ConsolidatedShoppingList` determinística.
 */
export function consolidateRequisitionsToShoppingList(
    requisitions: readonly SupplyRequisition[],
    options?: ConsolidatorOptions
): ConsolidatedShoppingList {
    const allowedBuckets =
        options?.filterBuckets && options.filterBuckets.length > 0
            ? new Set(options.filterBuckets)
            : undefined;

    const bucketMap = new Map<
        ProcurementBucket,
        Map<
            string,
            {
                canonicalSkuId: string;
                name: string;
                categoryCode: ConsolidatedSkuItem['categoryCode'];
                procurementBucket: ProcurementBucket;
                unitSi: ConsolidatedSkuItem['unitSi'];
                totalQtyPending: number;
                highestUrgency: SupplyUrgency;
                hasPartialPending: boolean;
                atypicalFlagSet: Set<AtypicalFlagCode>;
                atypicalLineCount: number;
                estimatedClp: number;
                sourceReqRefs: ConsolidatedShoppingListSourceRef[];
            }
        >
    >();

    const contributingReqIds = new Set<string>();
    let inferredTenantId = options?.tenantId || '';
    let inferredSiteId = options?.siteId || '';

    for (const req of requisitions) {
        if (!inferredTenantId && req.tenantId) inferredTenantId = req.tenantId;
        if (!inferredSiteId && req.siteId) inferredSiteId = req.siteId;

        if (
            req.status === 'CANCELLED' ||
            req.status === 'FULFILLED' ||
            req.status === 'CLOSED' ||
            req.status === 'DRAFT'
        ) {
            continue;
        }

        for (const line of req.lines) {
            if (line.lineStatus === 'CANCELLED' || line.lineStatus === 'FULFILLED') {
                continue;
            }
            const qtyPending = roundSupplyQty(line.qtyPending);
            if (qtyPending <= 0) {
                continue;
            }
            if (allowedBuckets && !allowedBuckets.has(line.procurementBucket)) {
                continue;
            }

            contributingReqIds.add(req.reqId);

            let skuMap = bucketMap.get(line.procurementBucket);
            if (!skuMap) {
                skuMap = new Map();
                bucketMap.set(line.procurementBucket, skuMap);
            }

            const skuCatalog = findCanonicalSkuById(line.canonicalSkuId, options?.customCatalog);
            const groupKey = `${line.canonicalSkuId}::${line.unitSi}`;
            const unitEstClp = line.estimatedUnitClp ?? skuCatalog?.referenceUnitPriceClp ?? 0;
            const lineEstClp = roundClp(unitEstClp * qtyPending);
            const isPartial =
                line.lineStatus === 'PARTIAL' || (line.qtyPurchased > 0 && qtyPending > 0);

            const sourceRef: ConsolidatedShoppingListSourceRef = {
                reqId: req.reqId,
                requisitionId: req.reqId,
                lineId: line.lineId,
                costCenter: req.costCenter,
                requesterName: req.requesterName,
                demandOrigin: req.demandOrigin,
                qtyPending,
                urgency: line.urgency,
                lineStatus: line.lineStatus,
                atypicalFlags: [...line.atypicalFlags],
            };

            const existing = skuMap.get(groupKey);
            if (!existing) {
                skuMap.set(groupKey, {
                    canonicalSkuId: line.canonicalSkuId,
                    name: skuCatalog?.name || line.description,
                    categoryCode: line.categoryCode,
                    procurementBucket: line.procurementBucket,
                    unitSi: line.unitSi,
                    totalQtyPending: qtyPending,
                    highestUrgency: line.urgency,
                    hasPartialPending: isPartial,
                    atypicalFlagSet: new Set(line.atypicalFlags),
                    atypicalLineCount: line.atypicalFlags.length > 0 ? 1 : 0,
                    estimatedClp: lineEstClp,
                    sourceReqRefs: [sourceRef],
                });
            } else {
                existing.totalQtyPending = roundSupplyQty(existing.totalQtyPending + qtyPending);
                existing.highestUrgency = resolveHigherUrgency(existing.highestUrgency, line.urgency);
                existing.hasPartialPending = existing.hasPartialPending || isPartial;
                for (const flag of line.atypicalFlags) {
                    existing.atypicalFlagSet.add(flag);
                }
                if (line.atypicalFlags.length > 0) {
                    existing.atypicalLineCount += 1;
                }
                existing.estimatedClp = roundClp(existing.estimatedClp + lineEstClp);
                existing.sourceReqRefs.push(sourceRef);
            }
        }
    }

    const buckets: ConsolidatedShoppingListBucket[] = [];

    for (const bucketKey of CANONICAL_BUCKET_ORDER) {
        const skuMap = bucketMap.get(bucketKey);
        if (!skuMap || skuMap.size === 0) continue;

        const items: ConsolidatedSkuItem[] = [...skuMap.values()].map((acc) => {
            const priorityTier = resolvePriorityTier(acc.highestUrgency, acc.hasPartialPending);
            // Orden determinístico de referencias inversas (críticas primero, luego parciales, luego reqId)
            const sortedRefs = [...acc.sourceReqRefs].sort((a, b) => {
                const urgDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
                if (urgDiff !== 0) return urgDiff;
                return a.reqId.localeCompare(b.reqId);
            });

            return {
                canonicalSkuId: acc.canonicalSkuId,
                name: acc.name,
                categoryCode: acc.categoryCode,
                procurementBucket: acc.procurementBucket,
                unitSi: acc.unitSi,
                totalQtyPending: acc.totalQtyPending,
                priorityTier,
                highestUrgency: acc.highestUrgency,
                hasPartialPending: acc.hasPartialPending,
                atypicalFlags: [...acc.atypicalFlagSet],
                atypicalCount: acc.atypicalLineCount,
                estimatedClp: acc.estimatedClp,
                sourceReqRefs: sortedRefs,
            };
        });

        // Orden estricto dentro de cada comercio: CRITICAL -> PARTIAL_PENDING -> STANDARD
        items.sort((a, b) => {
            const tierDiff = PRIORITY_TIER_RANK[a.priorityTier] - PRIORITY_TIER_RANK[b.priorityTier];
            if (tierDiff !== 0) return tierDiff;
            const urgDiff = URGENCY_RANK[a.highestUrgency] - URGENCY_RANK[b.highestUrgency];
            if (urgDiff !== 0) return urgDiff;
            const qtyDiff = b.totalQtyPending - a.totalQtyPending;
            if (qtyDiff !== 0) return qtyDiff;
            return a.canonicalSkuId.localeCompare(b.canonicalSkuId);
        });

        const totalAtypicalCount = items.reduce((sum, item) => sum + item.atypicalCount, 0);
        const estimatedBucketClp = roundClp(items.reduce((sum, item) => sum + item.estimatedClp, 0));

        buckets.push({
            procurementBucket: bucketKey,
            items,
            totalLines: items.length,
            totalAtypicalCount,
            estimatedBucketClp,
        });
    }

    const totalUniqueSkus = buckets.reduce((sum, b) => sum + b.items.length, 0);
    const totalAtypicalCount = buckets.reduce((sum, b) => sum + b.totalAtypicalCount, 0);
    const totalEstimatedClp = roundClp(buckets.reduce((sum, b) => sum + b.estimatedBucketClp, 0));

    return {
        tenantId: inferredTenantId,
        siteId: inferredSiteId,
        generatedAt: options?.generatedAt || new Date().toISOString(),
        sourceRequisitionCount: contributingReqIds.size,
        totalUniqueSkus,
        totalAtypicalCount,
        totalEstimatedClp,
        buckets,
    };
}
