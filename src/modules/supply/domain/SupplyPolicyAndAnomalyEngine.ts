/**
 * MINREPORT · ABASTECIMIENTO — Motor de Políticas, Bloqueo DS 132 y Detección de Atípicos
 *
 * Implementa con 100% determinismo (cero aritmética LLM):
 * 1. `GLOBAL_HARD_DENY` inviolable (DS 132 alcohol, drogas, tabaco y absurdos fuera de dominio).
 *    Soporta solicitudes mixtas: rechaza ítems prohibidos con mensaje cortés en español y acepta los válidos.
 * 2. Recepción universal con 5 banderas atípicas (`ATYPICAL_ROLE_MISMATCH`, `ATYPICAL_VOLUME_SPIKE`,
 *    `ATYPICAL_DUPLICATE_FREQ`, `ATYPICAL_HIGH_VALUE_OR_CAPEX`, `ATYPICAL_UNPLANNED_DRIFT`) y modo
 *    configurable `FLAG_AND_ACCEPT` (default) vs `STRICT_BLOCK`.
 * 3. Matriz de autoridad de compra directa autónoma (`OWNER_EXEC`, `SITE_ADMIN`, `BUYER`).
 */

import {
    AtypicalFlagCode,
    CanonicalSupplySku,
    PolicyRoleMismatchMode,
    SupplyCategoryCode,
    SupplyDemandNature,
    SupplyMemberProfile,
    SupplyOperationalRole,
    SupplyUnitSi,
} from './types';
import { DEFAULT_ROLE_PROFILES, normalizeCatalogText } from '../catalog/DefaultSupplyCatalogSeed';

export type HardDenyCategory =
    | 'DS132_ALCOHOL'
    | 'DS132_DRUGS'
    | 'DS132_TOBACCO'
    | 'OUT_OF_DOMAIN_ABSURD';

export interface HardDenyCheckResult {
    denied: boolean;
    category?: HardDenyCategory;
    matchedTerm?: string;
    reasonSpanish?: string;
}

export interface PolicyItemCandidate {
    itemKey: string;
    rawText: string;
    canonicalSkuId?: string;
    sku?: CanonicalSupplySku;
    categoryCode: SupplyCategoryCode;
    quantitySi: number;
    unitSi: SupplyUnitSi;
    estimatedUnitClp?: number;
    isCapexAsset?: boolean;
    isControlled?: boolean;
}

export interface RecentRequisitionRecord {
    canonicalSkuId: string;
    requestedAtIso: string;
    qtyRequestedSi: number;
}

export interface PolicyEvaluationContext {
    memberProfile?: SupplyMemberProfile;
    requesterRole: SupplyOperationalRole;
    demandNature: SupplyDemandNature;
    roleMismatchMode?: PolicyRoleMismatchMode;
    nowIso?: string;
    /** Consumo EWMA esperado para el horizonte de reposición (por SKU, en unidad SI) */
    ewmaExpectedQtyBySku?: Readonly<Record<string, number>>;
    /** Stock actual en bodega + tránsito por SKU (en unidad SI) */
    availableStockBySku?: Readonly<Record<string, { inWarehouseSi: number; inTransitSi: number }>>;
    /** Requisiciones recientes del mismo sitio para detectar duplicidad < 48h */
    recentRequisitions?: readonly RecentRequisitionRecord[];
    /** SKUs contemplados en el plan de ingeniería/operaciones vigente */
    plannedSkuIds?: readonly string[];
    /** Umbrales configurables por tenant */
    thresholds?: {
        volumeSpikePct?: number; // default 0.45 (+45%)
        duplicateWindowHours?: number; // default 48
        highValueLineClp?: number; // default 350_000
    };
}

export interface AcceptedPolicyItem {
    itemKey: string;
    rawText: string;
    canonicalSkuId?: string;
    categoryCode: SupplyCategoryCode;
    atypicalFlags: AtypicalFlagCode[];
    flagDetails: Array<{ code: AtypicalFlagCode; detail: string }>;
}

export interface RejectedPolicyItem {
    itemKey: string;
    rawText: string;
    rejectionCode: HardDenyCategory | 'ROLE_MISMATCH_STRICT_BLOCK' | 'CONTROLLED_LICENSE_REQUIRED';
    reasonSpanish: string;
    matchedTerm?: string;
}

export interface RequisitionPolicyEvaluation {
    acceptedItems: AcceptedPolicyItem[];
    rejectedItems: RejectedPolicyItem[];
    hasHardDenies: boolean;
    hasAtypicalFlags: boolean;
    politeRejectionSummarySpanish?: string;
}

export interface DirectPurchaseAuthorityResult {
    authorized: boolean;
    autoApproved: boolean;
    authorizedByAuthority: boolean;
    capexAllowed: boolean;
    notifyOwnerInfoOnly: boolean;
    alertReason?: string;
    denialReasonSpanish?: string;
}

/**
 * Términos sanitarios/industriales legítimos que contienen "alcohol" y NO deben bloquearse por DS 132.
 */
const SAFE_INDUSTRIAL_ALCOHOL_PHRASES: readonly string[] = [
    'alcohol gel',
    'alcohol isopropilico',
    'alcohol desinfectante',
    'alcohol medicinal',
    'alcohol 70',
    'alcohol 96',
    'alcohol para limpieza',
    'alcohol industrial',
    'alcohol de quemar',
];

const HARD_DENY_PATTERNS: ReadonlyArray<{
    category: HardDenyCategory;
    terms: readonly string[];
    reasonTemplate: (term: string) => string;
}> = [
    {
        category: 'DS132_ALCOHOL',
        terms: [
            'cerveza',
            'cervezas',
            'chela',
            'chelas',
            'vino',
            'vinos',
            'pisco',
            'piscola',
            'ron',
            'whisky',
            'whiskey',
            'vodka',
            'tequila',
            'ginebra',
            'gin',
            'licor',
            'licores',
            'espumante',
            'champana',
            'champagne',
            'chicha',
            'fernet',
            'aguardiente',
            'copete',
            'trago',
            'bebida alcoholica',
            'bebidas alcoholicas',
        ],
        reasonTemplate: (term) =>
            `No podemos procesar "${term}": está estrictamente prohibido en faena minera por normativa DS 132 (alcohol).`,
    },
    {
        category: 'DS132_DRUGS',
        terms: [
            'marihuana',
            'cannabis',
            'cocaina',
            'pasta base',
            'droga',
            'drogas',
            'estupefaciente',
            'estupefacientes',
            'tusi',
            'anfetamina',
            'extasis',
            'lsd',
            'heroina',
        ],
        reasonTemplate: (term) =>
            `No podemos procesar "${term}": sustancia estrictamente prohibida en faena minera por normativa DS 132.`,
    },
    {
        category: 'DS132_TOBACCO',
        terms: [
            'cigarro',
            'cigarros',
            'cigarrillo',
            'cigarrillos',
            'tabaco',
            'vaper',
            'vapeador',
            'puro',
            'habano',
            'cajetilla',
        ],
        reasonTemplate: (term) =>
            `No podemos procesar "${term}": excluido por política corporativa de abastecimiento y seguridad DS 132 (tabaco).`,
    },
    {
        category: 'OUT_OF_DOMAIN_ABSURD',
        terms: [
            'helicoptero',
            'helicopteros',
            'yate',
            'yates',
            'avion',
            'aviones',
            'jet privado',
            'ferrari',
            'lamborghini',
            'porsche',
            'rolex',
            'mansion',
            'crucero',
            'diamante',
            'playstation',
            'ps5',
            'xbox',
        ],
        reasonTemplate: (term) =>
            `No podemos procesar "${term}": artículo fuera del dominio operacional de abastecimiento minero.`,
    },
];

function containsWholePhrase(text: string, phrase: string): boolean {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
}

/**
 * Evalúa la lista inviolable `GLOBAL_HARD_DENY` (DS 132 + absurdos fuera de dominio).
 * Aplica a TODOS los roles sin excepción (incluido `OWNER_EXEC`).
 */
export function checkGlobalHardDeny(rawText: string): HardDenyCheckResult {
    const normalized = normalizeCatalogText(rawText);
    if (!normalized) return { denied: false };

    // Verificar primero excepciones sanitarias/industriales (ej. "alcohol gel")
    let sanitizedForAlcohol = normalized;
    for (const safePhrase of SAFE_INDUSTRIAL_ALCOHOL_PHRASES) {
        if (containsWholePhrase(sanitizedForAlcohol, safePhrase)) {
            sanitizedForAlcohol = sanitizedForAlcohol.replace(
                new RegExp(`(^|\\s)${safePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'g'),
                ' '
            );
        }
    }

    for (const group of HARD_DENY_PATTERNS) {
        const target = group.category === 'DS132_ALCOHOL' ? sanitizedForAlcohol : normalized;
        for (const term of group.terms) {
            if (containsWholePhrase(target, term)) {
                return {
                    denied: true,
                    category: group.category,
                    matchedTerm: term,
                    reasonSpanish: group.reasonTemplate(term),
                };
            }
        }
    }

    return { denied: false };
}

/**
 * Evalúa una solicitud completa (uno o varios ítems) bajo política DS 132 y banderas atípicas.
 * En solicitudes mixtas descarta únicamente los ítems bloqueados y acepta los válidos con sus flags.
 */
export function evaluateRequisitionPolicy(
    items: readonly PolicyItemCandidate[],
    context: PolicyEvaluationContext
): RequisitionPolicyEvaluation {
    const profile = context.memberProfile || DEFAULT_ROLE_PROFILES[context.requesterRole];
    const roleMismatchMode: PolicyRoleMismatchMode = context.roleMismatchMode || 'FLAG_AND_ACCEPT';
    const nowMs = context.nowIso ? Date.parse(context.nowIso) : Date.now();

    const volumeSpikePct = context.thresholds?.volumeSpikePct ?? 0.45;
    const duplicateWindowHours = context.thresholds?.duplicateWindowHours ?? 48;
    const highValueLineClp = context.thresholds?.highValueLineClp ?? 350_000;

    const acceptedItems: AcceptedPolicyItem[] = [];
    const rejectedItems: RejectedPolicyItem[] = [];

    for (const item of items) {
        // 1. GLOBAL_HARD_DENY inviolable (DS 132 y absurdos)
        const hardDeny = checkGlobalHardDeny(item.rawText);
        if (hardDeny.denied && hardDeny.category && hardDeny.reasonSpanish) {
            rejectedItems.push({
                itemKey: item.itemKey,
                rawText: item.rawText,
                rejectionCode: hardDeny.category,
                reasonSpanish: hardDeny.reasonSpanish,
                matchedTerm: hardDeny.matchedTerm,
            });
            continue;
        }

        // 2. Artículos controlados (ej. explosivos regulados DGMN)
        const isControlled = Boolean(
            item.isControlled || item.sku?.isControlled || item.categoryCode === 'EXPLOSIVOS_REGULADO'
        );
        if (isControlled && !profile.licensedForControlledItems) {
            rejectedItems.push({
                itemKey: item.itemKey,
                rawText: item.rawText,
                rejectionCode: 'CONTROLLED_LICENSE_REQUIRED',
                reasonSpanish: `No podemos procesar "${item.rawText}": insumo regulado que requiere licencia vigente (DGMN / autorizado).`,
            });
            continue;
        }

        const atypicalFlags: AtypicalFlagCode[] = [];
        const flagDetails: Array<{ code: AtypicalFlagCode; detail: string }> = [];

        // 3. ATYPICAL_ROLE_MISMATCH (configurable FLAG_AND_ACCEPT default vs STRICT_BLOCK)
        const isExplicitlyDeniedCategory = profile.deniedCategories.includes(item.categoryCode);
        const isOutsideAllowedCategories =
            profile.allowedCategories.length > 0 &&
            !profile.allowedCategories.includes(item.categoryCode);

        if (isExplicitlyDeniedCategory || isOutsideAllowedCategories) {
            if (roleMismatchMode === 'STRICT_BLOCK') {
                rejectedItems.push({
                    itemKey: item.itemKey,
                    rawText: item.rawText,
                    rejectionCode: 'ROLE_MISMATCH_STRICT_BLOCK',
                    reasonSpanish: `El rol ${profile.role} no tiene habilitada la categoría ${item.categoryCode} en modo bloqueo estricto.`,
                });
                continue;
            }
            atypicalFlags.push('ATYPICAL_ROLE_MISMATCH');
            flagDetails.push({
                code: 'ATYPICAL_ROLE_MISMATCH',
                detail: `Categoría ${item.categoryCode} fuera del ámbito habitual del rol ${profile.role}.`,
            });
        }

        // 4. ATYPICAL_VOLUME_SPIKE (> +45% sobre EWMA esperado para dotación PAX)
        const skuId = item.canonicalSkuId || item.sku?.canonicalSkuId;
        if (skuId && context.ewmaExpectedQtyBySku && context.ewmaExpectedQtyBySku[skuId] !== undefined) {
            const baseline = context.ewmaExpectedQtyBySku[skuId];
            if (baseline > 0 && item.quantitySi > baseline * (1 + volumeSpikePct)) {
                const spikePct = Math.round(((item.quantitySi - baseline) / baseline) * 100);
                atypicalFlags.push('ATYPICAL_VOLUME_SPIKE');
                flagDetails.push({
                    code: 'ATYPICAL_VOLUME_SPIKE',
                    detail: `Cantidad ${item.quantitySi} ${item.unitSi} supera en +${spikePct}% la base EWMA (${baseline} ${item.unitSi}).`,
                });
            }
        }

        // 5. ATYPICAL_DUPLICATE_FREQ (< 48h desde solicitud previa O stock bodega+tránsito suficiente)
        let duplicateDetected = false;
        let duplicateDetail = '';

        if (skuId && context.recentRequisitions && context.recentRequisitions.length > 0) {
            const windowMs = duplicateWindowHours * 3600 * 1000;
            const recentHit = context.recentRequisitions.find((rec) => {
                if (rec.canonicalSkuId !== skuId) return false;
                const recMs = Date.parse(rec.requestedAtIso);
                if (!Number.isFinite(recMs)) return false;
                const diff = nowMs - recMs;
                return diff >= 0 && diff <= windowMs;
            });
            if (recentHit) {
                duplicateDetected = true;
                duplicateDetail = `SKU ${skuId} ya solicitado dentro de las últimas ${duplicateWindowHours}h (${recentHit.qtyRequestedSi} ${item.unitSi}).`;
            }
        }

        if (!duplicateDetected && skuId && context.availableStockBySku?.[skuId]) {
            const stock = context.availableStockBySku[skuId];
            const effectiveStock = stock.inWarehouseSi + stock.inTransitSi;
            if (item.quantitySi > 0 && effectiveStock >= item.quantitySi) {
                duplicateDetected = true;
                duplicateDetail = `Stock disponible (${stock.inWarehouseSi} bodega + ${stock.inTransitSi} en tránsito) ya cubre ${item.quantitySi} ${item.unitSi}.`;
            }
        }

        if (duplicateDetected) {
            atypicalFlags.push('ATYPICAL_DUPLICATE_FREQ');
            flagDetails.push({
                code: 'ATYPICAL_DUPLICATE_FREQ',
                detail: duplicateDetail,
            });
        }

        // 6. ATYPICAL_HIGH_VALUE_OR_CAPEX
        const isCapex = Boolean(
            item.isCapexAsset || item.sku?.isCapexAsset || item.categoryCode === 'ACTIVO_EQUIPAMIENTO'
        );
        const unitPrice = item.estimatedUnitClp ?? item.sku?.referenceUnitPriceClp ?? 0;
        const estimatedLineClp = Math.round(unitPrice * item.quantitySi);
        const exceedsRoleLimit =
            profile.maxRequisitionClp !== undefined && estimatedLineClp > profile.maxRequisitionClp;

        if (isCapex || estimatedLineClp >= highValueLineClp || exceedsRoleLimit) {
            atypicalFlags.push('ATYPICAL_HIGH_VALUE_OR_CAPEX');
            flagDetails.push({
                code: 'ATYPICAL_HIGH_VALUE_OR_CAPEX',
                detail: isCapex
                    ? `Ítem clasificado como activo CAPEX (${item.categoryCode}).`
                    : `Monto estimado CLP ${estimatedLineClp} supera umbral de revisión.`,
            });
        }

        // 7. ATYPICAL_UNPLANNED_DRIFT
        if (
            context.demandNature === 'REACTIVE_FIELD' &&
            skuId &&
            context.plannedSkuIds &&
            context.plannedSkuIds.length > 0 &&
            !context.plannedSkuIds.includes(skuId)
        ) {
            atypicalFlags.push('ATYPICAL_UNPLANNED_DRIFT');
            flagDetails.push({
                code: 'ATYPICAL_UNPLANNED_DRIFT',
                detail: `Demanda reactiva para ${skuId} fuera del programa planificado vigente.`,
            });
        }

        acceptedItems.push({
            itemKey: item.itemKey,
            rawText: item.rawText,
            canonicalSkuId: skuId,
            categoryCode: item.categoryCode,
            atypicalFlags,
            flagDetails,
        });
    }

    const hasHardDenies = rejectedItems.some(
        (r) =>
            r.rejectionCode === 'DS132_ALCOHOL' ||
            r.rejectionCode === 'DS132_DRUGS' ||
            r.rejectionCode === 'DS132_TOBACCO' ||
            r.rejectionCode === 'OUT_OF_DOMAIN_ABSURD'
    );

    let politeRejectionSummarySpanish: string | undefined;
    if (rejectedItems.length > 0) {
        const lines = rejectedItems.map((r) => `- ${r.reasonSpanish}`);
        const suffix =
            acceptedItems.length > 0
                ? '\nEl resto de los insumos válidos sí fue considerado en tu solicitud.'
                : '';
        politeRejectionSummarySpanish = `${lines.join('\n')}${suffix}`;
    }

    return {
        acceptedItems,
        rejectedItems,
        hasHardDenies,
        hasAtypicalFlags: acceptedItems.some((a) => a.atypicalFlags.length > 0),
        politeRejectionSummarySpanish,
    };
}

/**
 * Evalúa la autoridad para registrar una compra directa autónoma (sin requisición previa).
 * - `OWNER_EXEC` (Gerente General): discreción ilimitada, auto-aprobado, CAPEX permitido.
 * - `SITE_ADMIN` y `BUYER`: habilitados con alerta informativa configurable hacia `OWNER_EXEC`.
 */
export function evaluateDirectPurchaseAuthority(params: {
    role: SupplyOperationalRole;
    memberProfile?: SupplyMemberProfile;
    totalAmountClp: number;
    includesCapexAsset: boolean;
    ownerInfoAlertThresholdClp?: number;
}): DirectPurchaseAuthorityResult {
    const profile = params.memberProfile || DEFAULT_ROLE_PROFILES[params.role];
    const alertThreshold = params.ownerInfoAlertThresholdClp ?? 250_000;

    if (params.role === 'OWNER_EXEC') {
        return {
            authorized: true,
            autoApproved: true,
            authorizedByAuthority: true,
            capexAllowed: true,
            notifyOwnerInfoOnly: false,
        };
    }

    if (!profile.canRecordDirectPurchase) {
        return {
            authorized: false,
            autoApproved: false,
            authorizedByAuthority: false,
            capexAllowed: false,
            notifyOwnerInfoOnly: false,
            denialReasonSpanish: `El rol ${params.role} no está autorizado para registrar compras directas autónomas sin requisición previa.`,
        };
    }

    if (params.includesCapexAsset && !profile.allowCapex) {
        return {
            authorized: false,
            autoApproved: false,
            authorizedByAuthority: false,
            capexAllowed: false,
            notifyOwnerInfoOnly: false,
            denialReasonSpanish: `El rol ${params.role} no tiene autorización para adquirir activos CAPEX de forma autónoma.`,
        };
    }

    const triggersInfoAlert =
        params.totalAmountClp >= alertThreshold || params.includesCapexAsset;

    const reasons: string[] = [];
    if (params.totalAmountClp >= alertThreshold) {
        reasons.push(
            `monto CLP ${Math.round(params.totalAmountClp)} supera umbral informativo (CLP ${alertThreshold})`
        );
    }
    if (params.includesCapexAsset) {
        reasons.push('incluye activo CAPEX');
    }

    return {
        authorized: true,
        autoApproved: profile.autoApproveDirectPurchase,
        authorizedByAuthority: true,
        capexAllowed: profile.allowCapex,
        notifyOwnerInfoOnly: triggersInfoAlert,
        alertReason: triggersInfoAlert
            ? `Aviso informativo a Gerencia (${params.role}): ${reasons.join(' y ')}.`
            : undefined,
    };
}
