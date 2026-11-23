/**
 * MINREPORT · ABASTECIMIENTO — Conciliador Semántico FinOps en Cascada de 3 Niveles (V3-E05)
 *
 * Cascada FinOps estricta (costo mínimo + cero alucinación):
 * - Nivel 1 (`LEVEL_1_DETERMINISTIC`, 0 ms, $0): GTIN exacto / mapa aprendido `tenant_supplier_sku_map` / match canónico exacto.
 * - Nivel 2 (`LEVEL_2_VECTOR_768D`): Similitud coseno con embeddings 768d (`gemini-embedding-001` vía `ResilientAIClient`).
 *   `>= 0.84` → match directo `EXACT_EQUIVALENT`; `0.68–0.84` o `< 0.68` → escala a Nivel 3.
 * - Nivel 3 (`LEVEL_3_AI_DECIDE`): `ResilientAIClient.decide()` con `dataClassification: 'TENANT_PRIVATE'`
 *   (`southamerica-west1`) clasificando `EXACT_EQUIVALENT`, `SUBSTITUTE_CANDIDATE`, `ACCESSORY_CHARGE`,
 *   `UNSOLICITED_OR_CAPEX`.
 * - Prorratea `ACCESSORY_CHARGE` + `<DscRcgGlobal>` mediante `LandedCostProrationEngine` (`prorateLandedCosts`).
 */

import crypto from 'node:crypto';
import { db } from '../../../config/firebase';
import {
    ResilientAIClient,
    type AIDecisionRequest,
    type AIDecisionResponse,
} from '../../../core/resilient-ai-client';
import {
    type CanonicalSupplySku,
    type SupplyCostCenter,
} from '../domain/types';
import {
    DEFAULT_SUPPLY_CATALOG_SEED,
    findCanonicalSkuById,
    normalizeCatalogText,
    resolveCanonicalSkuIdAlias,
} from '../catalog/DefaultSupplyCatalogSeed';
import { prorateLandedCosts } from '../domain/StockAssetCashCostReconciler';
import {
    type LandedCostProrationMode,
    type LinePricingBasis,
    type ReconciliationProposedLineMatch,
    type ReconciliationProposeLine,
    type SemanticMatchClassification,
    type TenantSupplierSkuMap,
} from '../../../contracts/supply.contracts';

export const TENANT_SUPPLIER_SKU_MAP_COLLECTION = 'tenant_supplier_sku_map';

export interface OpenRequisitionMatchCandidate {
    reqId: string;
    costCenter?: SupplyCostCenter;
    lines: Array<{
        lineId: string;
        canonicalSkuId: string;
        qtyPending: number;
    }>;
}

export interface CatalogVectorEntry {
    canonicalSkuId: string;
    name: string;
    embedding768: number[];
    source: 'CATALOG' | 'TENANT_MAP';
}

export type EmbedTextFn = (text: string, tenantId: string) => Promise<number[]>;
export type DecideFn = (
    req: AIDecisionRequest
) => Promise<
    Omit<AIDecisionResponse, 'latencyMs' | 'cached'> &
        Partial<Pick<AIDecisionResponse, 'latencyMs' | 'cached'>>
>;

export interface SemanticCascadeOptions {
    tenantId: string;
    supplierRutNormalized: string;
    documentType: number;
    prorationMode?: LandedCostProrationMode;
    globalAdjustmentNetClp?: number;
    catalog?: readonly CanonicalSupplySku[];
    learnedMaps?: readonly TenantSupplierSkuMap[];
    catalogVectors?: readonly CatalogVectorEntry[];
    openRequisitions?: readonly OpenRequisitionMatchCandidate[];
    embedFn?: EmbedTextFn;
    decideFn?: DecideFn;
    /** Desactiva llamadas remotas a Vertex/Gemini si es un entorno test sin red y sin stubs */
    allowNetworkAi?: boolean;
}

export interface SemanticProposalOutput {
    proposedLines: ReconciliationProposedLineMatch[];
    stats: {
        level1Hits: number;
        level2Hits: number;
        level3Hits: number;
        unmatchedCount: number;
    };
}

export function cosineSimilarity768(a: readonly number[], b: readonly number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const va = a[i];
        const vb = b[i];
        dot += va * vb;
        normA += va * va;
        normB += vb * vb;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (!Number.isFinite(denom) || denom <= 1e-12) return 0;
    return Math.max(-1, Math.min(1, dot / denom));
}

export function buildLearnedSupplierMapDocId(params: {
    tenantId: string;
    supplierRutNormalized: string;
    supplierItemCode?: string | null;
    supplierDescriptionNorm: string;
}): string {
    const keySeed = `${params.tenantId}|${params.supplierRutNormalized}|${params.supplierItemCode || ''}|${params.supplierDescriptionNorm}`;
    const hash = crypto.createHash('sha256').update(keySeed).digest('hex').slice(0, 24);
    return `ssmap_${hash}`;
}

function isLikelyAccessoryChargeText(normText: string): boolean {
    return /\b(flete|despacho|traslado|transporte|embalaje|pallet|envio|carguio|peaje)\b/.test(
        normText
    );
}

function defaultTokenMatchScore(normDesc: string, sku: CanonicalSupplySku): number {
    const skuNorm = normalizeCatalogText(sku.name);
    if (!normDesc || !skuNorm) return 0;
    if (normDesc === skuNorm) return 1;
    const descTokens = new Set(normDesc.split(' ').filter((t) => t.length >= 3));
    const skuTokens = skuNorm.split(' ').filter((t) => t.length >= 3);
    if (descTokens.size === 0 || skuTokens.length === 0) return 0;
    let hits = 0;
    for (const tk of skuTokens) {
        if (descTokens.has(tk)) hits++;
    }
    const union = new Set([...descTokens, ...skuTokens]).size;
    return union > 0 ? hits / union : 0;
}

function resolveLineNetSubtotalClp(
    line: ReconciliationProposeLine,
    documentType: number
): number {
    const basis: LinePricingBasis =
        line.linePricingBasis ||
        (documentType === 33 || documentType === 52 || documentType === 61 ? 'NET' : 'GROSS');
    const rawSub = Number(line.subtotalClp || line.unitPriceClp * line.quantity || 0);
    if (basis === 'NET') {
        return Math.round(rawSub);
    }
    if (documentType === 33 || documentType === 52 || documentType === 61) {
        return Math.round(rawSub / 1.19);
    }
    return Math.round(rawSub);
}

/**
 * Ejecuta la cascada semántica de 3 niveles + prorrateo Landed Cost sobre las líneas de un documento.
 */
export async function proposeSemanticReconciliation(
    rawLines: readonly ReconciliationProposeLine[],
    options: SemanticCascadeOptions
): Promise<SemanticProposalOutput> {
    const catalog = options.catalog || DEFAULT_SUPPLY_CATALOG_SEED;
    const learnedMaps = options.learnedMaps || [];
    const openRequisitions = options.openRequisitions || [];
    const allowNetworkAi = options.allowNetworkAi ?? process.env.NODE_ENV !== 'test';

    const embedFn: EmbedTextFn | null = options.embedFn
        ? options.embedFn
        : allowNetworkAi
          ? (text, tenantId) =>
                ResilientAIClient.embedText(text, {
                    taskType: 'SEMANTIC_SIMILARITY',
                    outputDimensionality: 768,
                    tenantId,
                })
          : null;

    const decideFn: DecideFn | null = options.decideFn
        ? options.decideFn
        : allowNetworkAi
          ? (req) => ResilientAIClient.decide(req)
          : null;

    const catalogVectors: CatalogVectorEntry[] = [...(options.catalogVectors || [])];
    for (const m of learnedMaps) {
        if (Array.isArray(m.embedding768) && m.embedding768.length === 768) {
            const sku = findCanonicalSkuById(m.canonicalSkuId, catalog);
            catalogVectors.push({
                canonicalSkuId: m.canonicalSkuId,
                name: sku?.name || m.supplierDescriptionNorm,
                embedding768: m.embedding768,
                source: 'TENANT_MAP',
            });
        }
    }

    let level1Hits = 0;
    let level2Hits = 0;
    let level3Hits = 0;
    let unmatchedCount = 0;

    interface IntermediateLine {
        purchaseLineId: string;
        rawDescription: string;
        classification: SemanticMatchClassification;
        matchedCanonicalSkuId: string | null;
        matchedSkuName: string | null;
        confidence: number;
        matchTier: ReconciliationProposedLineMatch['matchTier'];
        candidateRequisitionIds: string[];
        netSubtotalClp: number;
        qty: number;
        weightKg?: number;
        volumeL?: number;
        requiresHitlConfirmation: boolean;
        reasoning?: string;
    }

    const intermediate: IntermediateLine[] = [];

    for (let idx = 0; idx < rawLines.length; idx++) {
        const line = rawLines[idx];
        const purchaseLineId = line.purchaseLineId || `pline-${idx + 1}`;
        const normDesc = normalizeCatalogText(line.rawDescription);
        const normCode = (line.supplierItemCode || '').trim().toUpperCase();
        const gtin = (line.gtin || '').trim();
        const netSubtotalClp = resolveLineNetSubtotalClp(line, options.documentType);

        let classification: SemanticMatchClassification = 'UNSOLICITED_OR_CAPEX';
        let matchedSku: CanonicalSupplySku | undefined;
        let confidence = 0;
        let matchTier: ReconciliationProposedLineMatch['matchTier'] = 'UNMATCHED';
        let requiresHitl = true;
        let reasoning = '';

        // ── NIVEL 1 (0 ms, $0 AI): GTIN -> Mapa Aprendido -> Catálogo exacto ──
        if (gtin) {
            matchedSku = catalog.find((s) => s.gtin && s.gtin.trim() === gtin);
            if (matchedSku) {
                classification = matchedSku.isCapexAsset ? 'UNSOLICITED_OR_CAPEX' : 'EXACT_EQUIVALENT';
                confidence = 0.99;
                matchTier = 'LEVEL_1_DETERMINISTIC';
                requiresHitl = false;
                reasoning = `Match exacto GTIN (${gtin}).`;
                level1Hits++;
            }
        }

        if (!matchedSku && learnedMaps.length > 0) {
            const learned = learnedMaps.find(
                (m) =>
                    m.tenantId === options.tenantId &&
                    m.supplierRutNormalized === options.supplierRutNormalized &&
                    ((normCode && m.supplierItemCode && m.supplierItemCode.trim().toUpperCase() === normCode) ||
                        normalizeCatalogText(m.supplierDescriptionNorm) === normDesc)
            );
            if (learned) {
                matchedSku = findCanonicalSkuById(
                    resolveCanonicalSkuIdAlias(learned.canonicalSkuId),
                    catalog
                );
                classification = learned.classification || 'EXACT_EQUIVALENT';
                confidence = Math.max(0.95, learned.confidence || 0.96);
                matchTier = 'LEVEL_1_DETERMINISTIC';
                requiresHitl = false;
                reasoning = 'Match determinístico desde mapa aprendido tenant_supplier_sku_map.';
                level1Hits++;
            }
        }

        if (!matchedSku && !isLikelyAccessoryChargeText(normDesc)) {
            const exactSku = catalog.find(
                (s) =>
                    normalizeCatalogText(s.name) === normDesc ||
                    s.canonicalSkuId.toUpperCase() === normDesc.toUpperCase()
            );
            if (exactSku) {
                matchedSku = exactSku;
                classification = exactSku.isCapexAsset ? 'UNSOLICITED_OR_CAPEX' : 'EXACT_EQUIVALENT';
                confidence = 0.96;
                matchTier = 'LEVEL_1_DETERMINISTIC';
                requiresHitl = false;
                reasoning = 'Match exacto por nombre o código SKU canónico.';
                level1Hits++;
            }
        }

        // ── NIVEL 2 (Vectorial 768d: gemini-embedding-001) ──
        let bestVecSku: CanonicalSupplySku | undefined;
        let bestVecScore = 0;

        if (matchTier === 'UNMATCHED' && embedFn) {
            const lineVec = await embedFn(normDesc || line.rawDescription, options.tenantId);
            if (Array.isArray(lineVec) && lineVec.length === 768) {
                if (catalogVectors.length === 0) {
                    // Lazy populate top catalog candidates when embeddings exist
                    for (const sku of catalog.slice(0, 25)) {
                        const vec = await embedFn(sku.name, options.tenantId);
                        if (Array.isArray(vec) && vec.length === 768) {
                            catalogVectors.push({
                                canonicalSkuId: sku.canonicalSkuId,
                                name: sku.name,
                                embedding768: vec,
                                source: 'CATALOG',
                            });
                        }
                    }
                }

                for (const cv of catalogVectors) {
                    const sim = cosineSimilarity768(lineVec, cv.embedding768);
                    if (sim > bestVecScore) {
                        bestVecScore = sim;
                        bestVecSku = findCanonicalSkuById(cv.canonicalSkuId, catalog);
                    }
                }

                if (bestVecSku && bestVecScore >= 0.84) {
                    matchedSku = bestVecSku;
                    classification = bestVecSku.isCapexAsset
                        ? 'UNSOLICITED_OR_CAPEX'
                        : 'EXACT_EQUIVALENT';
                    confidence = Number(bestVecScore.toFixed(4));
                    matchTier = 'LEVEL_2_VECTOR_768D';
                    requiresHitl = false;
                    reasoning = `Match vectorial 768d fuerte (coseno ${bestVecScore.toFixed(3)} >= 0.84).`;
                    level2Hits++;
                }
            }
        }

        // ── NIVEL 3 (ResilientAIClient.decide TENANT_PRIVATE — 0.68..0.84 o < 0.68) ──
        if (matchTier === 'UNMATCHED') {
            let aiSolved = false;
            if (decideFn) {
                try {
                    const candidateHints = [
                        ...(bestVecSku
                            ? [`${bestVecSku.canonicalSkuId}:${bestVecSku.name} (cos=${bestVecScore.toFixed(3)})`]
                            : []),
                        ...catalog
                            .map((s) => ({ s, score: defaultTokenMatchScore(normDesc, s) }))
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 5)
                            .map(({ s }) => `${s.canonicalSkuId}:${s.name}`),
                    ];

                    const decision = await decideFn({
                        module: 'core',
                        tenantId: options.tenantId,
                        dataClassification: 'TENANT_PRIVATE',
                        countryCode: 'CL',
                        inputText: [
                            `Descripción proveedor: "${line.rawDescription}"`,
                            `Candidatos catálogo MINREPORT: ${candidateHints.join(' | ')}`,
                            `Es CAPEX declarado: ${Boolean(line.isCapexAsset)}`,
                        ].join('\n'),
                        questions: {
                            line_classification: {
                                type: 'choice',
                                instructions:
                                    'Clasifica la línea de factura frente al catálogo minero: EXACT_EQUIVALENT (mismo insumo), SUBSTITUTE_CANDIDATE (equivalente técnico/marca alternativa), ACCESSORY_CHARGE (flete, embalaje, recargo accesorio a prorratear), o UNSOLICITED_OR_CAPEX (no solicitado / activo CAPEX).',
                                criteria: {
                                    EXACT_EQUIVALENT: 'Insumo equivalente exacto del catálogo',
                                    SUBSTITUTE_CANDIDATE: 'Producto sustituto o marca equivalente compatible',
                                    ACCESSORY_CHARGE: 'Cargo accesorio (flete, despacho, pallet, embalaje)',
                                    UNSOLICITED_OR_CAPEX: 'Compra no solicitada o activo fijo CAPEX',
                                },
                            },
                        },
                    });

                    const clsAns = decision.answers?.line_classification;
                    if (clsAns && clsAns.type === 'choice') {
                        classification = clsAns.choice as SemanticMatchClassification;
                        confidence = Number((clsAns.confidence || 0.72).toFixed(4));
                        if (classification === 'ACCESSORY_CHARGE') {
                            matchedSku = undefined;
                        } else if (bestVecSku) {
                            matchedSku = bestVecSku;
                        } else {
                            const fallbackBest = catalog
                                .map((s) => ({ s, score: defaultTokenMatchScore(normDesc, s) }))
                                .sort((a, b) => b.score - a.score)[0];
                            if (fallbackBest && fallbackBest.score > 0.15) {
                                matchedSku = fallbackBest.s;
                            }
                        }
                        matchTier = 'LEVEL_3_AI_DECIDE';
                        requiresHitl = true;
                        reasoning = `Clasificado por Decisions API (coseno previo ${bestVecScore.toFixed(3)}).`;
                        level3Hits++;
                        aiSolved = true;
                    }
                } catch {
                    // Fallback determinístico seguro si no hay conectividad Vertex en entorno aislado
                }
            }

            if (!aiSolved) {
                if (isLikelyAccessoryChargeText(normDesc)) {
                    classification = 'ACCESSORY_CHARGE';
                    matchedSku = undefined;
                    confidence = 0.85;
                    matchTier = 'LEVEL_3_AI_DECIDE';
                    requiresHitl = true;
                    reasoning = 'Cargo accesorio (flete/embalaje) detectado para prorrateo Landed Cost.';
                    level3Hits++;
                } else if (bestVecSku && bestVecScore >= 0.68) {
                    matchedSku = bestVecSku;
                    classification = 'SUBSTITUTE_CANDIDATE';
                    confidence = Number(bestVecScore.toFixed(4));
                    matchTier = 'LEVEL_3_AI_DECIDE';
                    requiresHitl = true;
                    reasoning = `Candidato sustituto rango intermedio 768d (${bestVecScore.toFixed(3)}).`;
                    level3Hits++;
                } else {
                    const lexicalBest = catalog
                        .map((s) => ({ s, score: defaultTokenMatchScore(normDesc, s) }))
                        .sort((a, b) => b.score - a.score)[0];
                    if (lexicalBest && lexicalBest.score >= 0.45) {
                        matchedSku = lexicalBest.s;
                        classification = 'SUBSTITUTE_CANDIDATE';
                        confidence = Number(lexicalBest.score.toFixed(4));
                        matchTier = 'LEVEL_3_AI_DECIDE';
                        requiresHitl = true;
                        reasoning = 'Candidato sustituto léxico para validación HITL.';
                        level3Hits++;
                    } else {
                        classification = 'UNSOLICITED_OR_CAPEX';
                        matchedSku = undefined;
                        confidence = 0;
                        matchTier = 'UNMATCHED';
                        requiresHitl = true;
                        reasoning = 'Sin coincidencia en catálogo ni mapa proveedor; requiere revisión HITL.';
                        unmatchedCount++;
                    }
                }
            }
        }

        const candidateRequisitionIds = matchedSku
            ? openRequisitions
                  .filter((r) =>
                      r.lines.some(
                          (rl) =>
                              rl.canonicalSkuId === matchedSku!.canonicalSkuId && rl.qtyPending > 0
                      )
                  )
                  .map((r) => r.reqId)
            : [];

        intermediate.push({
            purchaseLineId,
            rawDescription: line.rawDescription,
            classification,
            matchedCanonicalSkuId: matchedSku?.canonicalSkuId || null,
            matchedSkuName: matchedSku?.name || null,
            confidence,
            matchTier,
            candidateRequisitionIds,
            netSubtotalClp,
            qty: Number(line.quantity || 1),
            weightKg: line.weightKg,
            volumeL: line.volumeL,
            requiresHitlConfirmation: requiresHitl,
            reasoning,
        });
    }

    // ── Prorrateo Landed Cost (ACCESSORY_CHARGE + <DscRcgGlobal>) ──
    const proration = prorateLandedCosts({
        lines: intermediate.map((l) => ({
            purchaseLineId: l.purchaseLineId,
            qtyPurchased: l.qty,
            netAmountClp: l.netSubtotalClp,
            isAccessoryCharge: l.classification === 'ACCESSORY_CHARGE',
            weightKg: l.weightKg,
            volumeL: l.volumeL,
        })),
        prorationMode: options.prorationMode || 'NET_VALUE',
        globalAdjustmentNetClp: options.globalAdjustmentNetClp || 0,
    });

    const proposedLines: ReconciliationProposedLineMatch[] = intermediate.map((l) => {
        const landedRow = proration.byLineId[l.purchaseLineId];
        const unitCostNetClp = l.qty > 0 ? Math.round(l.netSubtotalClp / l.qty) : 0;
        const landedUnitCostNetClp =
            l.classification === 'ACCESSORY_CHARGE'
                ? 0
                : landedRow?.landedUnitCostNetClp ?? unitCostNetClp;
        const allocatedFreightOrDiscountClp =
            l.classification === 'ACCESSORY_CHARGE'
                ? 0
                : landedRow?.allocatedAdjustmentClp ?? 0;

        return {
            purchaseLineId: l.purchaseLineId,
            rawDescription: l.rawDescription,
            classification: l.classification,
            matchedCanonicalSkuId: l.matchedCanonicalSkuId,
            matchedSkuName: l.matchedSkuName,
            confidence: l.confidence,
            matchTier: l.matchTier,
            candidateRequisitionIds: l.candidateRequisitionIds,
            unitCostNetClp,
            landedUnitCostNetClp,
            allocatedFreightOrDiscountClp,
            requiresHitlConfirmation: l.requiresHitlConfirmation,
            ...(l.reasoning ? { reasoning: l.reasoning } : {}),
        };
    });

    return {
        proposedLines,
        stats: {
            level1Hits,
            level2Hits,
            level3Hits,
            unmatchedCount,
        },
    };
}

export class SemanticRequisitionMatcher {
    public static async lookupTenantLearnedMaps(
        tenantId: string,
        supplierRutNormalized?: string
    ): Promise<TenantSupplierSkuMap[]> {
        let q: FirebaseFirestore.Query = db
            .collection(TENANT_SUPPLIER_SKU_MAP_COLLECTION)
            .where('tenantId', '==', tenantId);
        if (supplierRutNormalized) {
            q = q.where('supplierRutNormalized', '==', supplierRutNormalized);
        }
        const snap = await q.limit(300).get();
        return snap.docs.map((d) => d.data() as TenantSupplierSkuMap);
    }

    public static async saveLearnedSupplierMapping(params: {
        tenantId: string;
        supplierRutNormalized: string;
        supplierItemCode?: string | null;
        rawDescription: string;
        supplierGtin?: string | null;
        canonicalSkuId: string;
        classification: SemanticMatchClassification;
        confirmedByUid: string;
        embedFn?: EmbedTextFn;
        allowNetworkAi?: boolean;
    }): Promise<TenantSupplierSkuMap> {
        const normDesc = normalizeCatalogText(params.rawDescription) || params.rawDescription.toLowerCase();
        const mapId = buildLearnedSupplierMapDocId({
            tenantId: params.tenantId,
            supplierRutNormalized: params.supplierRutNormalized,
            supplierItemCode: params.supplierItemCode,
            supplierDescriptionNorm: normDesc,
        });
        const now = new Date().toISOString();

        let embedding768: number[] | undefined;
        const allowNet = params.allowNetworkAi ?? process.env.NODE_ENV !== 'test';
        const embedFn = params.embedFn
            ? params.embedFn
            : allowNet
              ? (txt: string, tId: string) =>
                    ResilientAIClient.embedText(txt, {
                        taskType: 'SEMANTIC_SIMILARITY',
                        outputDimensionality: 768,
                        tenantId: tId,
                    })
              : null;

        if (embedFn) {
            try {
                const vec = await embedFn(normDesc, params.tenantId);
                if (Array.isArray(vec) && vec.length === 768) {
                    embedding768 = vec;
                }
            } catch {
                // Opcional en entornos sin Vertex/API
            }
        }

        const record: TenantSupplierSkuMap = {
            mapId,
            tenantId: params.tenantId,
            supplierRutNormalized: params.supplierRutNormalized,
            supplierItemCode: params.supplierItemCode || null,
            supplierDescriptionNorm: normDesc,
            supplierGtin: params.supplierGtin || null,
            canonicalSkuId: params.canonicalSkuId,
            classification: params.classification,
            unitConversionFactor: 1,
            confidence: 1,
            ...(embedding768 ? { embedding768 } : {}),
            source: 'TENANT_LEARNED_HITL',
            confirmedByUid: params.confirmedByUid,
            updatedAt: now,
        };

        await db
            .collection(TENANT_SUPPLIER_SKU_MAP_COLLECTION)
            .doc(mapId)
            .set(record, { merge: true });
        return record;
    }
}
