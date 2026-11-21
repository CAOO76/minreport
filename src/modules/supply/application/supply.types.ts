import { z } from 'zod';
import type { AuditLedgerModule } from '../../../core/audit-ledger';
import type { AIModuleScope } from '../../../core/resilient-ai-client';
import { validateChileanRut } from '../../../utils/taxIdValidator';

/**
 * MINREPORT · ABASTECIMIENTO (`supply`) — Local Application Bridge Types, Schemas & Deterministic Helpers
 *
 * Bridges canonical shapes matching `@contracts-core` (`src/contracts/supply.contracts.ts`)
 * and `@domain-engines` (`src/modules/supply/domain/*`) so the API & WhatsApp workspace
 * compiles and executes standalone prior to final branch landing.
 */

export const SUPPLY_AI_MODULE = 'supply' as unknown as AIModuleScope;
export const SUPPLY_AUDIT_MODULE = 'supply' as unknown as AuditLedgerModule;

// ---------------------------------------------------------------------------
// Canonical Enums (1:1 parity with supply.contracts.ts)
// ---------------------------------------------------------------------------

export const SupplyCategoryCodeSchema = z.enum([
    'VIVERES_ALIMENTACION',
    'AGUA_POTABLE',
    'ASEO_HIGIENE',
    'GAS_ENERGIA_CAMP',
    'EPP_SEGURIDAD',
    'FERRETERIA_CONSTRUCCION',
    'MANTENCION_CAMP',
    'REPUESTOS_MAQUINARIA',
    'LUBRICANTES_FILTROS',
    'PERFORACION_ACEROS',
    'FORTIFICACION',
    'COMBUSTIBLE_FAENA',
    'HERRAMIENTAS',
    'ACTIVO_EQUIPAMIENTO',
    'EXPLOSIVOS_REGULADO',
    'OTROS_OPERACIONAL',
]);
export type SupplyCategoryCode = z.infer<typeof SupplyCategoryCodeSchema>;

export const ProcurementBucketSchema = z.enum([
    'VERDULERIA',
    'SUPERMERCADO',
    'FERRETERIA',
    'REPUESTOS_OPERMAQ',
    'EPP_SEGURIDAD',
    'GAS_AGUA_COMBUSTIBLE',
    'MANTENCION_EQUIPAMIENTO',
]);
export type ProcurementBucket = z.infer<typeof ProcurementBucketSchema>;

export const SupplyUnitSiSchema = z.enum(['kg', 'L', 'un', 'par', 'm', 'm3', 'caja', 'bolsa']);
export type SupplyUnitSi = z.infer<typeof SupplyUnitSiSchema>;

export const SupplyOperationalRoleSchema = z.enum([
    'CAMP_MANAGER',
    'MECHANIC_TECH',
    'OPS_FOREMAN',
    'WAREHOUSE_KEEPER',
    'HSEC_OFFICER',
    'BUYER',
    'SITE_ADMIN',
    'OWNER_EXEC',
]);
export type SupplyOperationalRole = z.infer<typeof SupplyOperationalRoleSchema>;

export const SupplyDemandOriginSchema = z.enum([
    'WA_CAMP',
    'WA_MECHANIC',
    'WA_OPS',
    'WA_WAREHOUSE_HSEC',
    'WA_EXEC_DIRECT',
    'MODULE_PLANNING',
    'MODULE_HSEC',
    'MODULE_OPERMAQ',
    'MODULE_STOCKPILE',
    'DESKTOP_MANUAL',
]);
export type SupplyDemandOrigin = z.infer<typeof SupplyDemandOriginSchema>;

export const SupplyDemandNatureSchema = z.enum([
    'PLANNED_ENGINEERING',
    'REACTIVE_FIELD',
    'SAFETY_REPLENISHMENT',
    'AUTONOMOUS_PURCHASE',
]);
export type SupplyDemandNature = z.infer<typeof SupplyDemandNatureSchema>;

export const AtypicalFlagCodeSchema = z.enum([
    'ATYPICAL_ROLE_MISMATCH',
    'ATYPICAL_VOLUME_SPIKE',
    'ATYPICAL_DUPLICATE_FREQ',
    'ATYPICAL_HIGH_VALUE_OR_CAPEX',
    'ATYPICAL_UNPLANNED_DRIFT',
    'ATYPICAL_ASSET_WITHOUT_INVOICE',
]);
export type AtypicalFlagCode = z.infer<typeof AtypicalFlagCodeSchema>;

export const FulfillmentChannelSchema = z.enum([
    'MANUAL_LOCAL_PURCHASE',
    'INTERNAL_WAREHOUSE_TRANSFER',
    'MARKETPLACE_RFQ_SINGLE',
    'MARKETPLACE_CONSOLIDATED_POOL',
    'M2M_X402_AUTOPROCURE',
]);
export type FulfillmentChannel = z.infer<typeof FulfillmentChannelSchema>;

export const PurchaseModeSchema = z.enum([
    'REQUISITION_FULFILLMENT',
    'DIRECT_AUTONOMOUS',
    'MIXED_FULFILLMENT_AND_DIRECT',
]);
export type PurchaseMode = z.infer<typeof PurchaseModeSchema>;

export const SiiDteTypeSchema = z.union([
    z.literal(33),
    z.literal(34),
    z.literal(39),
    z.literal(41),
    z.literal(52),
    z.literal(61),
    z.literal(0),
]);
export type SiiDteType = z.infer<typeof SiiDteTypeSchema>;

export const PurchaseLineDestinationSchema = z.enum([
    'STOCK_IN_TRANSIT',
    'STOCK_IN_WAREHOUSE',
    'CAPEX_ASSET',
    'DIRECT_EXPENSE',
]);
export type PurchaseLineDestination = z.infer<typeof PurchaseLineDestinationSchema>;

export const SupplyUrgencySchema = z.enum(['CRITICAL', 'HIGH', 'STANDARD', 'LOW']);
export type SupplyUrgency = z.infer<typeof SupplyUrgencySchema>;

export const PaymentMethodSchema = z.enum([
    'CAJA_CHICA',
    'FONDO_POR_RENDIR',
    'REEMBOLSO_GERENCIA',
    'TRANSFERENCIA',
    'CREDITO_PROVEEDOR',
    'TARJETA_CORPORATIVA',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const RequisitionStatusSchema = z.enum(['OPEN', 'PARTIAL', 'FULFILLED', 'CANCELLED']);
export type RequisitionStatus = z.infer<typeof RequisitionStatusSchema>;

export const HitlConfirmationKeywordSchema = z.literal('ACTUALIZAR');

// ---------------------------------------------------------------------------
// Core Entities & CAS Evidence Reference
// ---------------------------------------------------------------------------

export const EvidenceCasRefSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    phashHex: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
    storagePath: z.string().min(1).max(512),
    downloadUrl: z
        .string()
        .min(1)
        .max(1024)
        .refine(
            (val) => !val.toLowerCase().includes('data:') && !val.toLowerCase().includes(';base64,'),
            'Prohibido Base64 inline en evidenceCasRef.downloadUrl'
        ),
    mimeType: z.string().min(3).max(120),
    extension: z.string().min(1).max(16),
    profile: z.string().min(1).max(64),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().nonnegative(),
    savingsRatio: z.number().min(0).max(1),
    savingsPct: z.number().min(0).max(100),
    originalFilename: z.string().max(240).optional(),
    createdAt: z.string().optional(),
});
export type EvidenceCasRef = z.infer<typeof EvidenceCasRefSchema>;

export const NotificationPreferencesSchema = z.object({
    email: z.boolean().default(true),
    whatsapp: z.boolean().default(false),
    digestMode: z.enum(['IMMEDIATE', 'DAILY_DIGEST']).default('IMMEDIATE'),
    urgentOnly: z.boolean().default(false),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const SupplyMemberProfileSchema = z.object({
    role: SupplyOperationalRoleSchema.default('CAMP_MANAGER'),
    allowedCategories: z.array(SupplyCategoryCodeSchema).default([]),
    deniedCategories: z.array(SupplyCategoryCodeSchema).default([]),
    maxRequisitionClp: z.number().nonnegative().nullable().default(null),
    canRecordDirectPurchase: z.boolean().default(false),
    autoApproveDirectPurchase: z.boolean().default(false),
    allowCapex: z.boolean().default(false),
    licensedForControlledItems: z.boolean().default(false),
    defaultCostCenter: z.string().trim().max(64).default('CC-CAMPAMENTO'),
    assignedSiteIds: z.array(z.string().trim().min(1).max(128)).default([]),
    communicationStyle: z
        .object({
            register: z.enum(['TERRENO_DIRECTO', 'TECNICO_FORMAL', 'EJECUTIVO']).default('TERRENO_DIRECTO'),
            preferredModality: z.enum(['TEXT', 'AUDIO', 'MIXED']).default('MIXED'),
            dialect: z.enum(['ES_CL', 'ES_PE', 'ES_AR', 'PT_BR', 'EN_US']).default('ES_CL'),
        })
        .default({ register: 'TERRENO_DIRECTO', preferredModality: 'MIXED', dialect: 'ES_CL' }),
});
export type SupplyMemberProfile = z.infer<typeof SupplyMemberProfileSchema>;

export const CanonicalSupplySkuSchema = z.object({
    canonicalSkuId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    procurementBucket: ProcurementBucketSchema,
    baseUnitSi: SupplyUnitSiSchema,
    unspscCode: z.string().trim().max(32).optional(),
    requiredSlots: z.array(z.string().trim().min(1).max(64)).default(['quantity']),
    defaultPackToSi: z.number().positive().optional(),
    isCapexAsset: z.boolean().default(false),
    isControlled: z.boolean().default(false),
    leySaco25kgApplied: z.boolean().optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).optional(),
    tenantId: z.string().trim().max(128).optional(),
    updatedAt: z.string().optional(),
});
export type CanonicalSupplySku = z.infer<typeof CanonicalSupplySkuSchema>;

export const SupplySiteSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(160),
    districtCode: z.string().trim().min(1).max(64),
    geoFix: z
        .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            altitudeM: z.number().min(-500).max(7000).optional(),
        })
        .optional(),
    shiftPattern: z.string().trim().min(1).max(64).default('7x7'),
    currentHeadcount: z.number().int().nonnegative().default(0),
    waterStorageCapacityL: z.number().nonnegative().default(0),
    ds594DailyWaterTargetLPerPax: z.number().positive().default(120),
    leadTimeDays: z.number().positive().default(7),
    monthlyBudgetClp: z.number().nonnegative().optional(),
    marketplaceOptIn: z.boolean().default(false),
    roleMismatchMode: z.enum(['FLAG_AND_ACCEPT', 'STRICT_BLOCK']).default('FLAG_AND_ACCEPT'),
    directPurchaseAlertThresholdClp: z.number().nonnegative().default(500000),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});
export type SupplySite = z.infer<typeof SupplySiteSchema>;

export const SupplyRequisitionLineSchema = z.object({
    lineId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().min(1).max(128),
    itemName: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    procurementBucket: ProcurementBucketSchema,
    unitSi: SupplyUnitSiSchema,
    rawRequestedText: z.string().trim().max(240).optional(),
    qtyRequested: z.number().positive(),
    qtyPurchased: z.number().nonnegative().default(0),
    qtyReceived: z.number().nonnegative().default(0),
    qtyPending: z.number().nonnegative(),
    lineStatus: RequisitionStatusSchema.default('OPEN'),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    fulfillmentChannel: FulfillmentChannelSchema.default('MANUAL_LOCAL_PURCHASE'),
    urgency: SupplyUrgencySchema.default('STANDARD'),
    estimatedUnitClp: z.number().nonnegative().optional(),
    attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    evidenceCasRef: EvidenceCasRefSchema.optional(),
});
export type SupplyRequisitionLine = z.infer<typeof SupplyRequisitionLineSchema>;

export const SupplyRequisitionSchema = z.object({
    reqId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    requesterUid: z.string().trim().min(1).max(128),
    requesterName: z.string().trim().min(1).max(160),
    requesterRole: SupplyOperationalRoleSchema,
    requesterPhoneE164: z.string().trim().max(32).optional(),
    demandOrigin: SupplyDemandOriginSchema,
    demandNature: SupplyDemandNatureSchema.default('REACTIVE_FIELD'),
    costCenter: z.string().trim().min(1).max(64).default('CC-CAMPAMENTO'),
    linkedAssetId: z.string().trim().max(128).optional(),
    linkedPlanRef: z.string().trim().max(128).optional(),
    status: RequisitionStatusSchema.default('OPEN'),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(SupplyRequisitionLineSchema).min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type SupplyRequisition = z.infer<typeof SupplyRequisitionSchema>;

export const SupplyPurchaseLineSchema = z.object({
    purchaseLineId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(240),
    categoryCode: SupplyCategoryCodeSchema.default('OTROS_OPERACIONAL'),
    procurementBucket: ProcurementBucketSchema.default('SUPERMERCADO'),
    unitSi: SupplyUnitSiSchema.default('un'),
    qtyPurchased: z.number().positive(),
    unitPriceClp: z.number().nonnegative(),
    subtotalClp: z.number().nonnegative(),
    destination: PurchaseLineDestinationSchema.default('STOCK_IN_TRANSIT'),
    costCenter: z.string().trim().max(64).default('CC-CAMPAMENTO'),
    isCapexAsset: z.boolean().default(false),
    serialOrTag: z.string().trim().max(120).optional(),
    explicitAllocations: z
        .array(
            z.object({
                reqId: z.string().trim().min(1).max(128),
                reqLineId: z.string().trim().min(1).max(128),
                qtyAllocated: z.number().positive(),
            })
        )
        .optional(),
});
export type SupplyPurchaseLine = z.infer<typeof SupplyPurchaseLineSchema>;

export const SupplyPurchaseSchema = z.object({
    purchaseId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    buyerUid: z.string().trim().min(1).max(128),
    buyerRole: SupplyOperationalRoleSchema,
    purchaseMode: PurchaseModeSchema,
    authorizedByAuthority: z.boolean().default(false),
    supplierTaxId: z.string().trim().min(3).max(32),
    supplierName: z.string().trim().min(1).max(200),
    supplierId: z.string().trim().max(128).optional(),
    documentType: SiiDteTypeSchema,
    folio: z.number().int().nonnegative(),
    dedupeKey: z.string().trim().min(1).max(128),
    issueDate: z.string().trim().min(8).max(32),
    netAmountClp: z.number().nonnegative(),
    vatAmountClp: z.number().nonnegative(),
    totalAmountClp: z.number().nonnegative(),
    paymentMethod: PaymentMethodSchema,
    evidenceCasRef: EvidenceCasRefSchema.optional(),
    tedRawXml: z.string().max(12000).optional(),
    receptionStatus: z.enum(['IN_TRANSIT', 'RECEIVED', 'PARTIAL_DISCREPANCY', 'NOT_APPLICABLE']).default('IN_TRANSIT'),
    receivedAt: z.string().optional(),
    receivedByUid: z.string().optional(),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    lines: z.array(SupplyPurchaseLineSchema).min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type SupplyPurchase = z.infer<typeof SupplyPurchaseSchema>;

export interface FulfillmentAllocation {
    allocationId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    purchaseLineId: string;
    requisitionId: string | 'UNSOLICITED_PURCHASE';
    requisitionLineId: string | 'UNSOLICITED_PURCHASE';
    canonicalSkuId: string;
    qtyAllocated: number;
    unitSi: SupplyUnitSi;
    destination: PurchaseLineDestination;
    createdAt: string;
}

export interface SupplyAsset {
    assetId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    name: string;
    serialOrTag?: string;
    acquisitionNetClp: number;
    vatCreditClp: number;
    invoiceDteType: SiiDteType;
    invoiceFolio: number;
    supplierTaxId: string;
    supplierName: string;
    evidenceCasRef?: EvidenceCasRef;
    missingInvoiceAlert: boolean;
    warrantyUntil?: string;
    opermaqAssetId?: string;
    costCenter: string;
    createdAt: string;
    updatedAt: string;
}

export interface SiiDocumentRecord {
    docId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    dedupeKey: string;
    supplierTaxId: string;
    supplierName: string;
    documentType: SiiDteType;
    folio: number;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    vatCreditRecoverableClp: number;
    totalAmountClp: number;
    rcvDeadlineDate: string | null;
    rcvDaysRemaining: number | null;
    rcvStatus: 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'CLAIMED' | 'NOT_APPLICABLE';
    missingInvoiceForCapex: boolean;
    evidenceCasRef?: EvidenceCasRef;
    expenseReportId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface SiiExpenseReport {
    reportId: string;
    tenantId: string;
    siteId: string;
    custodianUid: string;
    custodianName: string;
    paymentMethod: PaymentMethod;
    title: string;
    fundAdvanceClp: number;
    renderedTotalClp: number;
    balanceClp: number;
    siiDocumentIds: string[];
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'SETTLED' | 'REJECTED';
    createdAt: string;
    updatedAt: string;
}

export interface SupplyInventoryItem {
    inventoryKey: string;
    tenantId: string;
    siteId: string;
    canonicalSkuId: string;
    itemName: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    qtyInTransit: number;
    qtyInWarehouse: number;
    avgUnitCostClp: number;
    dailyBurnRatePerPax?: number;
    updatedAt: string;
}

export interface StockLedgerEntry {
    entryId: string;
    tenantId: string;
    siteId: string;
    canonicalSkuId: string;
    movementType: 'INBOUND_IN_TRANSIT' | 'RECEPTION_CONFIRMED' | 'INBOUND_WAREHOUSE_DIRECT' | 'CONSUMPTION' | 'ADJUSTMENT';
    qtyDelta: number;
    unitSi: SupplyUnitSi;
    unitCostClp: number;
    referenceId: string;
    actorUid: string;
    createdAt: string;
}

export interface CashLedgerEntry {
    entryId: string;
    tenantId: string;
    siteId: string;
    paymentMethod: PaymentMethod;
    direction: 'ADVANCE_OUT' | 'EXPENSE_RENDERED' | 'REIMBURSEMENT_DUE' | 'SETTLEMENT_IN';
    amountClp: number;
    netAmountClp: number;
    vatCreditClp: number;
    isCapex: boolean;
    costCenter: string;
    referenceId: string;
    actorUid: string;
    description: string;
    createdAt: string;
}

export interface ConsolidatedShoppingSourceRef {
    reqId: string;
    lineId: string;
    costCenter: string;
    requesterRole: SupplyOperationalRole;
    qtyPending: number;
    urgency: SupplyUrgency;
    atypicalFlags: AtypicalFlagCode[];
}

export interface ConsolidatedShoppingItem {
    canonicalSkuId: string;
    itemName: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    totalQtyPending: number;
    highestUrgency: SupplyUrgency;
    hasPartialPending: boolean;
    atypicalCount: number;
    estimatedClp: number;
    sourceReqRefs: ConsolidatedShoppingSourceRef[];
}

export interface ConsolidatedShoppingBucket {
    procurementBucket: ProcurementBucket;
    itemCount: number;
    atypicalCount: number;
    estimatedBucketClp: number;
    items: ConsolidatedShoppingItem[];
}

export interface ConsolidatedShoppingList {
    tenantId: string;
    siteId?: string;
    generatedAt: string;
    openRequisitionCount: number;
    totalPendingLines: number;
    totalEstimatedClp: number;
    buckets: ConsolidatedShoppingBucket[];
}

export interface DemandForecastLine {
    canonicalSkuId: string;
    itemName: string;
    categoryCode: SupplyCategoryCode;
    unitSi: SupplyUnitSi;
    qtyInWarehouse: number;
    qtyInTransit: number;
    ewmaDailyRate: number;
    daysOfInventory: number | null;
    recommendedReorderQty: number;
    riskLevel: 'CRITICAL' | 'WARNING' | 'NOMINAL';
}

export interface DemandForecast {
    forecastId: string;
    tenantId: string;
    siteId: string;
    headcount: number;
    leadTimeDays: number;
    altitudeM: number;
    altitudeMultiplier: number;
    ds594WaterTargetLPerPax: number;
    requiredWaterReserveL: number;
    waterStorageCapacityL: number;
    waterCoverageDays: number;
    waterAlertLevel: 'CRITICAL' | 'WARNING' | 'NOMINAL';
    dailyFoodOpexClpPerPax: number | null;
    items: DemandForecastLine[];
    computedAt: string;
}

export interface DemandPoolSignal {
    signalId: string;
    districtCode: string;
    categoryCode: SupplyCategoryCode;
    canonicalSkuId: string;
    itemName: string;
    unitSi: SupplyUnitSi;
    aggregatedQty: number;
    distinctSiteCount: number;
    kAnonymityVerified: boolean;
    optInVerified: boolean;
    windowStartIso: string;
    windowEndIso: string;
    generatedAt: string;
}

// ---------------------------------------------------------------------------
// Deterministic Bridge Helpers (Zero LLM Arithmetic, Ley N° 21.719 / SII)
// ---------------------------------------------------------------------------

export function maskPiiForLog(raw: string): string {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '[REDACTED]';
    if (trimmed.length <= 4) return '****';
    return `***${trimmed.slice(-4)}`;
}

export const GLOBAL_HARD_DENY_PATTERNS: Array<{ pattern: RegExp; label: string; reason: string }> = [
    {
        pattern: /\b(cerveza|cervezas|chela|chelas|vino|vinos|pisco|ron|whisky|whiskey|vodka|tequila|licor|licores|alcohol\s+bebible|espumante|champagne)\b/i,
        label: 'ALCOHOL_DS132',
        reason: 'Prohibido por política de seguridad minera DS 132 (alcohol en faena).',
    },
    {
        pattern: /\b(marihuana|coca[ií]na|pasta\s+base|droga|drogas|estupefaciente|cannabis)\b/i,
        label: 'DRUGS_DS132',
        reason: 'Prohibido por política tolerancia cero DS 132 (sustancias ilícitas).',
    },
    {
        pattern: /\b(cigarro|cigarros|cigarrillo|cigarrillos|tabaco|vaper|vapeador)\b/i,
        label: 'TOBACCO_POLICY',
        reason: 'Ítem restringido por política sanitaria y de campamento.',
    },
    {
        pattern: /\b(helic[oó]ptero|helic[oó]pteros|yate|yates|avi[oó]n|aviones|jet\s+privado|ferrari|lamborghini|mansi[oó]n)\b/i,
        label: 'OUT_OF_DOMAIN_ABSURD',
        reason: 'Solicitud fuera del dominio operacional de abastecimiento minero.',
    },
];

export function checkGlobalHardDeny(itemText: string): { denied: boolean; code?: string; reason?: string } {
    const clean = String(itemText || '').trim();
    for (const rule of GLOBAL_HARD_DENY_PATTERNS) {
        if (rule.pattern.test(clean)) {
            return { denied: true, code: rule.label, reason: rule.reason };
        }
    }
    return { denied: false };
}

export interface NormalizedSupplyItemMatch {
    canonicalSkuId: string;
    itemName: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    qtySi: number | null;
    packagingLabel?: string;
    requiredSlots: string[];
    isCapexAsset: boolean;
    leySaco25kgApplied?: boolean;
}

interface CatalogRule {
    canonicalSkuId: string;
    itemName: string;
    regex: RegExp;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    requiredSlots: string[];
    isCapexAsset?: boolean;
    packConversions?: Array<{ regex: RegExp; factor: number; label: string; leySaco?: boolean }>;
}

export const BRIDGE_CATALOG_RULES: CatalogRule[] = [
    {
        canonicalSkuId: 'sku-papas',
        itemName: 'Papas',
        regex: /\b(papa|papas)\b/i,
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'VERDULERIA',
        unitSi: 'kg',
        requiredSlots: ['quantity'],
        packConversions: [
            { regex: /\b(malla|mallas|saco|sacos)\b/i, factor: 25, label: 'malla (25 kg Ley del Saco)', leySaco: true },
        ],
    },
    {
        canonicalSkuId: 'sku-mantequilla',
        itemName: 'Mantequilla',
        regex: /\b(mantequilla|mantequillas)\b/i,
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        unitSi: 'kg',
        requiredSlots: ['quantity', 'packagingUnit'],
        packConversions: [
            { regex: /\b(pote|potes|pan|panes|barra|barras|paquete|paquetes)\b/i, factor: 0.25, label: 'pote/pan (250 g)' },
        ],
    },
    {
        canonicalSkuId: 'sku-huevos',
        itemName: 'Huevos',
        regex: /\b(huevo|huevos)\b/i,
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        unitSi: 'un',
        requiredSlots: ['quantity'],
        packConversions: [
            { regex: /\b(bandeja|bandejas|maple|maples)\b/i, factor: 30, label: 'bandeja (30 un)' },
            { regex: /\b(docena|docenas)\b/i, factor: 12, label: 'docena (12 un)' },
            { regex: /\b(caja|cajas)\b/i, factor: 180, label: 'caja (180 un)' },
        ],
    },
    {
        canonicalSkuId: 'sku-pan',
        itemName: 'Pan',
        regex: /\b(pan|marraqueta|hallulla)\b/i,
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        unitSi: 'kg',
        requiredSlots: ['quantity'],
    },
    {
        canonicalSkuId: 'sku-tallarines',
        itemName: 'Tallarines / Fideos',
        regex: /\b(tallar[ií]n|tallarines|fideo|fideos|pasta)\b/i,
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        unitSi: 'kg',
        requiredSlots: ['quantity'],
        packConversions: [{ regex: /\b(paquete|paquetes)\b/i, factor: 0.4, label: 'paquete (400 g)' }],
    },
    {
        canonicalSkuId: 'sku-agua-bidon',
        itemName: 'Agua Purificada Bidón',
        regex: /\b(agua|bid[oó]n|bidones)\b/i,
        categoryCode: 'AGUA_POTABLE',
        procurementBucket: 'GAS_AGUA_COMBUSTIBLE',
        unitSi: 'L',
        requiredSlots: ['quantity'],
        packConversions: [{ regex: /\b(bid[oó]n|bidones)\b/i, factor: 20, label: 'bidón 20 L' }],
    },
    {
        canonicalSkuId: 'sku-gas-glp',
        itemName: 'Gas Licuado GLP',
        regex: /\b(gas|glp|bal[oó]n|balones|cilindro)\b/i,
        categoryCode: 'GAS_ENERGIA_CAMP',
        procurementBucket: 'GAS_AGUA_COMBUSTIBLE',
        unitSi: 'kg',
        requiredSlots: ['quantity'],
        packConversions: [
            { regex: /\b45\s*kg?\b|\bde\s*45\b/i, factor: 45, label: 'balón 45 kg' },
            { regex: /\b15\s*kg?\b|\bde\s*15\b/i, factor: 15, label: 'balón 15 kg' },
        ],
    },
    {
        canonicalSkuId: 'sku-pernos',
        itemName: 'Pernos Industriales',
        regex: /\b(perno|pernos|tuerca|tuercas)\b/i,
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        procurementBucket: 'FERRETERIA',
        unitSi: 'un',
        requiredSlots: ['quantity'],
    },
    {
        canonicalSkuId: 'sku-cemento',
        itemName: 'Cemento Portland',
        regex: /\b(cemento)\b/i,
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        procurementBucket: 'FERRETERIA',
        unitSi: 'kg',
        requiredSlots: ['quantity'],
        packConversions: [
            { regex: /\b(saco|sacos)\b/i, factor: 25, label: 'saco (25 kg Ley del Saco)', leySaco: true },
        ],
    },
    {
        canonicalSkuId: 'sku-epp-bototos',
        itemName: 'Zapatos / Bototos de Seguridad',
        regex: /\b(bototo|bototos|zapato\s+de\s+seguridad|zapatos\s+de\s+seguridad)\b/i,
        categoryCode: 'EPP_SEGURIDAD',
        procurementBucket: 'EPP_SEGURIDAD',
        unitSi: 'par',
        requiredSlots: ['quantity', 'size'],
    },
    {
        canonicalSkuId: 'sku-filtro-hidraulico',
        itemName: 'Filtro Hidráulico Maquinaria',
        regex: /\b(filtro\s+hidr[aá]ulico|filtro\s+aceite|repuesto|caterpillar|komatsu|inyector|manguera\s+hidr[aá]ulica)\b/i,
        categoryCode: 'REPUESTOS_MAQUINARIA',
        procurementBucket: 'REPUESTOS_OPERMAQ',
        unitSi: 'un',
        requiredSlots: ['quantity'],
    },
    {
        canonicalSkuId: 'sku-cocina-industrial',
        itemName: 'Cocina Industrial Campamento',
        regex: /\b(cocina|cocinilla\s+industrial|horno\s+industrial|refrigerador|congelador|generador|compresor|motobomba|soldadora)\b/i,
        categoryCode: 'ACTIVO_EQUIPAMIENTO',
        procurementBucket: 'MANTENCION_EQUIPAMIENTO',
        unitSi: 'un',
        requiredSlots: ['quantity'],
        isCapexAsset: true,
    },
];

export function normalizeSupplyItemFromText(
    rawName: string,
    rawQty?: number | null,
    rawUnit?: string | null
): NormalizedSupplyItemMatch {
    const combined = `${rawName} ${rawUnit || ''}`.trim();
    const matchedRule = BRIDGE_CATALOG_RULES.find((r) => r.regex.test(combined));
    if (matchedRule) {
        let qtySi: number | null = typeof rawQty === 'number' && Number.isFinite(rawQty) && rawQty > 0 ? rawQty : null;
        let packagingLabel: string | undefined;
        let leySaco25kgApplied: boolean | undefined;

        if (matchedRule.packConversions && qtySi !== null) {
            for (const conv of matchedRule.packConversions) {
                if (conv.regex.test(combined)) {
                    qtySi = Number((qtySi * conv.factor).toFixed(3));
                    packagingLabel = conv.label;
                    if (conv.leySaco) leySaco25kgApplied = true;
                    break;
                }
            }
        }

        // Convert grams to kg if unit is g / gr / gramos
        if (qtySi !== null && matchedRule.unitSi === 'kg' && /\b(g|gr|gramo|gramos)\b/i.test(rawUnit || '')) {
            qtySi = Number((qtySi / 1000).toFixed(3));
        }

        return {
            canonicalSkuId: matchedRule.canonicalSkuId,
            itemName: matchedRule.itemName,
            categoryCode: matchedRule.categoryCode,
            procurementBucket: matchedRule.procurementBucket,
            unitSi: matchedRule.unitSi,
            qtySi,
            packagingLabel,
            requiredSlots: matchedRule.requiredSlots,
            isCapexAsset: Boolean(matchedRule.isCapexAsset),
            leySaco25kgApplied,
        };
    }

    const slug = rawName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);

    const inferredUnit: SupplyUnitSi = /\b(kg|kilo|kilos)\b/i.test(rawUnit || '')
        ? 'kg'
        : /\b(l|lt|litro|litros)\b/i.test(rawUnit || '')
          ? 'L'
          : /\b(par|pares)\b/i.test(rawUnit || '')
            ? 'par'
            : /\b(caja|cajas)\b/i.test(rawUnit || '')
              ? 'caja'
              : /\b(bolsa|bolsas)\b/i.test(rawUnit || '')
                ? 'bolsa'
                : 'un';

    return {
        canonicalSkuId: `sku-${slug || 'generico'}`,
        itemName: rawName.trim() || 'Insumo Operacional',
        categoryCode: 'OTROS_OPERACIONAL',
        procurementBucket: 'SUPERMERCADO',
        unitSi: inferredUnit,
        qtySi: typeof rawQty === 'number' && Number.isFinite(rawQty) && rawQty > 0 ? rawQty : null,
        requiredSlots: ['quantity'],
        isCapexAsset: false,
    };
}

export const DEFAULT_ALLOWED_CATEGORIES_BY_ROLE: Record<SupplyOperationalRole, SupplyCategoryCode[]> = {
    CAMP_MANAGER: ['VIVERES_ALIMENTACION', 'AGUA_POTABLE', 'ASEO_HIGIENE', 'GAS_ENERGIA_CAMP', 'MANTENCION_CAMP'],
    MECHANIC_TECH: ['REPUESTOS_MAQUINARIA', 'LUBRICANTES_FILTROS', 'HERRAMIENTAS', 'COMBUSTIBLE_FAENA'],
    OPS_FOREMAN: ['PERFORACION_ACEROS', 'FORTIFICACION', 'FERRETERIA_CONSTRUCCION', 'HERRAMIENTAS', 'COMBUSTIBLE_FAENA'],
    WAREHOUSE_KEEPER: [
        'VIVERES_ALIMENTACION',
        'AGUA_POTABLE',
        'ASEO_HIGIENE',
        'GAS_ENERGIA_CAMP',
        'EPP_SEGURIDAD',
        'FERRETERIA_CONSTRUCCION',
        'MANTENCION_CAMP',
        'REPUESTOS_MAQUINARIA',
        'LUBRICANTES_FILTROS',
        'HERRAMIENTAS',
        'OTROS_OPERACIONAL',
    ],
    HSEC_OFFICER: ['EPP_SEGURIDAD', 'AGUA_POTABLE', 'ASEO_HIGIENE'],
    BUYER: SupplyCategoryCodeSchema.options,
    SITE_ADMIN: SupplyCategoryCodeSchema.options,
    OWNER_EXEC: SupplyCategoryCodeSchema.options,
};

export function evaluateAtypicalFlagsForLine(params: {
    role: SupplyOperationalRole;
    profile?: Partial<SupplyMemberProfile>;
    categoryCode: SupplyCategoryCode;
    isCapexAsset?: boolean;
    estimatedTotalClp?: number;
}): AtypicalFlagCode[] {
    const flags: AtypicalFlagCode[] = [];
    const allowed =
        params.profile?.allowedCategories && params.profile.allowedCategories.length > 0
            ? params.profile.allowedCategories
            : DEFAULT_ALLOWED_CATEGORIES_BY_ROLE[params.role] || [];

    if (
        params.role !== 'OWNER_EXEC' &&
        params.role !== 'SITE_ADMIN' &&
        params.role !== 'BUYER' &&
        !allowed.includes(params.categoryCode)
    ) {
        flags.push('ATYPICAL_ROLE_MISMATCH');
    }

    if (
        params.isCapexAsset ||
        params.categoryCode === 'ACTIVO_EQUIPAMIENTO' ||
        (typeof params.estimatedTotalClp === 'number' &&
            typeof params.profile?.maxRequisitionClp === 'number' &&
            params.profile.maxRequisitionClp > 0 &&
            params.estimatedTotalClp > params.profile.maxRequisitionClp)
    ) {
        flags.push('ATYPICAL_HIGH_VALUE_OR_CAPEX');
    }

    return Array.from(new Set(flags));
}

export function buildSiiDedupeKey(rawRut: string, documentType: SiiDteType, folio: number): string {
    const rutCheck = validateChileanRut(rawRut);
    const normalizedRut = rutCheck.valid
        ? rutCheck.normalized
        : String(rawRut || 'SIN-RUT')
              .replace(/[\s.]/g, '')
              .toUpperCase();
    return `${normalizedRut}#${documentType}#${folio}`;
}

export function computeRcvDeadline(issueDateIso: string, documentType: SiiDteType): {
    rcvDeadlineDate: string | null;
    rcvDaysRemaining: number | null;
} {
    if (documentType !== 33 && documentType !== 34) {
        return { rcvDeadlineDate: null, rcvDaysRemaining: null };
    }
    const parsedMs = Date.parse(issueDateIso);
    if (!Number.isFinite(parsedMs)) {
        return { rcvDeadlineDate: null, rcvDaysRemaining: null };
    }
    const deadlineMs = parsedMs + 8 * 24 * 60 * 60 * 1000;
    const deadlineIso = new Date(deadlineMs).toISOString().slice(0, 10);
    const daysRemaining = Math.ceil((deadlineMs - Date.now()) / (24 * 60 * 60 * 1000));
    return {
        rcvDeadlineDate: deadlineIso,
        rcvDaysRemaining: daysRemaining,
    };
}

export interface ParsedSiiHeader {
    source: 'XML_DTE' | 'TED_PDF417';
    supplierTaxId: string;
    supplierRutValid: boolean;
    supplierName?: string;
    receiverTaxId?: string;
    documentType: SiiDteType;
    folio: number;
    issueDate: string;
    netAmountClp?: number;
    vatAmountClp?: number;
    totalAmountClp: number;
    firstItemSummary?: string;
    tedRawXml?: string;
    xmlLines?: Array<{
        description: string;
        qty: number;
        unitRaw?: string;
        unitPriceClp: number;
        subtotalClp: number;
    }>;
}

function extractXmlTag(xml: string, tagName: string): string | null {
    const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

function coerceSiiDteType(rawCode: number): SiiDteType {
    if (rawCode === 33 || rawCode === 34 || rawCode === 39 || rawCode === 41 || rawCode === 52 || rawCode === 61) {
        return rawCode;
    }
    return 0;
}

export function parseSiiTedOrXmlDeterministic(rawXml: string): ParsedSiiHeader | null {
    const clean = String(rawXml || '').trim();
    if (!clean) return null;

    // 1. Full XML DTE (<DTE><Documento><Encabezado>...)
    if (/<Encabezado\b/i.test(clean) && /<IdDoc\b/i.test(clean)) {
        const tipoRaw = Number(extractXmlTag(clean, 'TipoDTE') || 0);
        const folioRaw = Number(extractXmlTag(clean, 'Folio') || 0);
        const issueDate = extractXmlTag(clean, 'FchEmis') || new Date().toISOString().slice(0, 10);
        const rutEmisor = extractXmlTag(clean, 'RUTEmisor') || '';
        const rznSoc = extractXmlTag(clean, 'RznSoc') || extractXmlTag(clean, 'RznSocEmisor') || undefined;
        const rutRecep = extractXmlTag(clean, 'RUTRecep') || undefined;
        const mntNeto = extractXmlTag(clean, 'MntNeto');
        const iva = extractXmlTag(clean, 'IVA');
        const mntTotal = Number(extractXmlTag(clean, 'MntTotal') || 0);
        const tedBlockMatch = clean.match(/<TED\b[\s\S]*?<\/TED>/i);

        const xmlLines: ParsedSiiHeader['xmlLines'] = [];
        const detailMatches = clean.matchAll(/<Detalle\b[^>]*>([\s\S]*?)<\/Detalle>/gi);
        for (const m of detailMatches) {
            const block = m[1];
            const desc = extractXmlTag(block, 'NmbItem') || extractXmlTag(block, 'DscItem') || 'Ítem DTE';
            const qty = Number(extractXmlTag(block, 'QtyItem') || 1);
            const unitRaw = extractXmlTag(block, 'UnmdItem') || undefined;
            const prc = Number(extractXmlTag(block, 'PrcItem') || 0);
            const monto = Number(extractXmlTag(block, 'MontoItem') || Math.round(qty * prc));
            xmlLines.push({
                description: desc,
                qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
                unitRaw,
                unitPriceClp: Number.isFinite(prc) && prc >= 0 ? prc : Math.round(monto / Math.max(1, qty)),
                subtotalClp: Number.isFinite(monto) && monto >= 0 ? monto : 0,
            });
        }

        const rutCheck = validateChileanRut(rutEmisor);
        return {
            source: 'XML_DTE',
            supplierTaxId: rutCheck.valid ? rutCheck.normalized : rutEmisor.trim(),
            supplierRutValid: rutCheck.valid,
            supplierName: rznSoc,
            receiverTaxId: rutRecep,
            documentType: coerceSiiDteType(tipoRaw),
            folio: Number.isFinite(folioRaw) ? folioRaw : 0,
            issueDate,
            netAmountClp: mntNeto !== null ? Number(mntNeto) : undefined,
            vatAmountClp: iva !== null ? Number(iva) : undefined,
            totalAmountClp: Number.isFinite(mntTotal) ? mntTotal : 0,
            tedRawXml: tedBlockMatch ? tedBlockMatch[0] : undefined,
            xmlLines: xmlLines.length > 0 ? xmlLines : undefined,
        };
    }

    // 2. TED PDF417 (<TED><DD><RE>...<TD>...<F>...<FE>...<MNT>...</DD><FRMT>...</TED>)
    if (/<TED\b/i.test(clean) || /<DD\b/i.test(clean)) {
        const re = extractXmlTag(clean, 'RE') || '';
        const td = Number(extractXmlTag(clean, 'TD') || 0);
        const f = Number(extractXmlTag(clean, 'F') || 0);
        const fe = extractXmlTag(clean, 'FE') || new Date().toISOString().slice(0, 10);
        const rr = extractXmlTag(clean, 'RR') || undefined;
        const mnt = Number(extractXmlTag(clean, 'MNT') || 0);
        const it1 = extractXmlTag(clean, 'IT1') || undefined;
        const rutCheck = validateChileanRut(re);

        const dteType = coerceSiiDteType(td);
        const netCalc = dteType === 33 ? Math.round(mnt / 1.19) : mnt;
        const vatCalc = dteType === 33 ? mnt - netCalc : 0;

        return {
            source: 'TED_PDF417',
            supplierTaxId: rutCheck.valid ? rutCheck.normalized : re.trim(),
            supplierRutValid: rutCheck.valid,
            receiverTaxId: rr,
            documentType: dteType,
            folio: Number.isFinite(f) ? f : 0,
            issueDate: fe,
            netAmountClp: netCalc,
            vatAmountClp: vatCalc,
            totalAmountClp: Number.isFinite(mnt) ? mnt : 0,
            firstItemSummary: it1,
            tedRawXml: clean.slice(0, 12000),
        };
    }

    return null;
}

export function verifyReceiptArithmetic(params: {
    lines: Array<{ qtyPurchased: number; unitPriceClp: number; subtotalClp: number }>;
    netAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
    documentType: SiiDteType;
}): {
    verified: boolean;
    linesSumClp: number;
    expectedTotalClp: number;
    deltaClp: number;
    pricingBasis: 'GROSS' | 'NET_PLUS_VAT' | 'MISMATCH';
} {
    const linesSumClp = Math.round(
        params.lines.reduce((acc, line) => acc + Number(line.subtotalClp || 0), 0)
    );
    const totalClp = Math.round(params.totalAmountClp || 0);
    const netClp = Math.round(params.netAmountClp || 0);

    if (totalClp <= 0 && linesSumClp > 0) {
        return {
            verified: true,
            linesSumClp,
            expectedTotalClp: linesSumClp,
            deltaClp: 0,
            pricingBasis: 'GROSS',
        };
    }

    const grossDelta = Math.abs(linesSumClp - totalClp);
    if (grossDelta <= 2) {
        return {
            verified: true,
            linesSumClp,
            expectedTotalClp: totalClp,
            deltaClp: linesSumClp - totalClp,
            pricingBasis: 'GROSS',
        };
    }

    // DTE 33 Facturas often show net item subtotals while header adds 19% IVA
    const netDelta = Math.abs(linesSumClp - netClp);
    if (params.documentType === 33 && netClp > 0 && netDelta <= 2) {
        const expectedGrossFromLines = Math.round(linesSumClp * 1.19);
        if (Math.abs(expectedGrossFromLines - totalClp) <= 5) {
            return {
                verified: true,
                linesSumClp,
                expectedTotalClp: totalClp,
                deltaClp: expectedGrossFromLines - totalClp,
                pricingBasis: 'NET_PLUS_VAT',
            };
        }
    }

    return {
        verified: false,
        linesSumClp,
        expectedTotalClp: totalClp,
        deltaClp: linesSumClp - totalClp,
        pricingBasis: 'MISMATCH',
    };
}

export function consolidateOpenRequisitions(
    tenantId: string,
    requisitions: SupplyRequisition[],
    siteIdFilter?: string
): ConsolidatedShoppingList {
    const openReqs = requisitions.filter(
        (r) =>
            (r.status === 'OPEN' || r.status === 'PARTIAL') &&
            (!siteIdFilter || r.siteId === siteIdFilter)
    );

    const urgencyWeight: Record<SupplyUrgency, number> = {
        CRITICAL: 3,
        HIGH: 2,
        STANDARD: 1,
        LOW: 0,
    };

    const grouped = new Map<string, ConsolidatedShoppingItem>();
    let totalPendingLines = 0;

    for (const req of openReqs) {
        for (const line of req.lines) {
            if (line.lineStatus === 'FULFILLED' || line.lineStatus === 'CANCELLED') continue;
            const pending = Number(line.qtyPending ?? Math.max(0, line.qtyRequested - line.qtyPurchased));
            if (pending <= 0) continue;

            totalPendingLines += 1;
            const key = `${line.procurementBucket}::${line.canonicalSkuId}`;
            const existing = grouped.get(key);
            const lineEstimated = Math.round(pending * Number(line.estimatedUnitClp || 0));
            const sourceRef: ConsolidatedShoppingSourceRef = {
                reqId: req.reqId,
                lineId: line.lineId,
                costCenter: req.costCenter,
                requesterRole: req.requesterRole,
                qtyPending: pending,
                urgency: line.urgency,
                atypicalFlags: line.atypicalFlags || [],
            };

            if (!existing) {
                grouped.set(key, {
                    canonicalSkuId: line.canonicalSkuId,
                    itemName: line.itemName,
                    categoryCode: line.categoryCode,
                    procurementBucket: line.procurementBucket,
                    unitSi: line.unitSi,
                    totalQtyPending: Number(pending.toFixed(3)),
                    highestUrgency: line.urgency,
                    hasPartialPending: line.lineStatus === 'PARTIAL' || line.qtyPurchased > 0,
                    atypicalCount: (line.atypicalFlags || []).length > 0 ? 1 : 0,
                    estimatedClp: lineEstimated,
                    sourceReqRefs: [sourceRef],
                });
            } else {
                existing.totalQtyPending = Number((existing.totalQtyPending + pending).toFixed(3));
                if (urgencyWeight[line.urgency] > urgencyWeight[existing.highestUrgency]) {
                    existing.highestUrgency = line.urgency;
                }
                if (line.lineStatus === 'PARTIAL' || line.qtyPurchased > 0) {
                    existing.hasPartialPending = true;
                }
                if ((line.atypicalFlags || []).length > 0) {
                    existing.atypicalCount += 1;
                }
                existing.estimatedClp += lineEstimated;
                existing.sourceReqRefs.push(sourceRef);
            }
        }
    }

    const byBucket = new Map<ProcurementBucket, ConsolidatedShoppingItem[]>();
    for (const item of grouped.values()) {
        const list = byBucket.get(item.procurementBucket) || [];
        list.push(item);
        byBucket.set(item.procurementBucket, list);
    }

    const buckets: ConsolidatedShoppingBucket[] = Array.from(byBucket.entries())
        .map(([bucket, items]) => {
            items.sort((a, b) => {
                const uDiff = urgencyWeight[b.highestUrgency] - urgencyWeight[a.highestUrgency];
                if (uDiff !== 0) return uDiff;
                if (a.hasPartialPending !== b.hasPartialPending) return a.hasPartialPending ? -1 : 1;
                return a.itemName.localeCompare(b.itemName, 'es');
            });
            return {
                procurementBucket: bucket,
                itemCount: items.length,
                atypicalCount: items.reduce((s, it) => s + it.atypicalCount, 0),
                estimatedBucketClp: items.reduce((s, it) => s + it.estimatedClp, 0),
                items,
            };
        })
        .sort((a, b) => a.procurementBucket.localeCompare(b.procurementBucket));

    return {
        tenantId,
        siteId: siteIdFilter,
        generatedAt: new Date().toISOString(),
        openRequisitionCount: openReqs.length,
        totalPendingLines,
        totalEstimatedClp: buckets.reduce((s, b) => s + b.estimatedBucketClp, 0),
        buckets,
    };
}

export function exportSiiDocumentsToCsv(docs: SiiDocumentRecord[]): string {
    const header = [
        'DEDUPE_KEY',
        'RUT_EMISOR',
        'PROVEEDOR',
        'TIPO_DTE',
        'FOLIO',
        'FECHA_EMISION',
        'NETO_CLP',
        'IVA_CLP',
        'CREDITO_FISCAL_IVA_CLP',
        'TOTAL_CLP',
        'LIMITE_RCV_8D',
        'ESTADO_RCV',
        'ALERTA_ACTIVO_SIN_FACTURA',
        'CAS_SHA256',
    ].join(';');

    const escapeCell = (val: unknown): string => {
        let s = String(val ?? '');
        // Protección anti-CSV injection (OWASP / ISO 27001) en celdas de texto
        if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
            s = `'${s}`;
        }
        s = s.replace(/"/g, '""');
        return /[;"\r\n]/.test(s) ? `"${s}"` : s;
    };

    const rows = docs.map((d) =>
        [
            d.dedupeKey,
            d.supplierTaxId,
            d.supplierName,
            d.documentType,
            d.folio,
            d.issueDate,
            d.netAmountClp,
            d.vatAmountClp,
            d.vatCreditRecoverableClp,
            d.totalAmountClp,
            d.rcvDeadlineDate || '',
            d.rcvStatus,
            d.missingInvoiceForCapex ? 'SI' : 'NO',
            d.evidenceCasRef?.sha256 || '',
        ]
            .map(escapeCell)
            .join(';')
    );

    return `\uFEFF${header}\n${rows.join('\n')}\n`;
}
