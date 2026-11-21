import { z } from 'zod';
import { CanonicalGeoFixSchema } from './geo.contracts';

/**
 * MINREPORT · ABASTECIMIENTO — Client / PWA Edge Mirror Contracts (Zod 4.6 / ESM)
 * Paridad 1:1 con `src/contracts/supply.contracts.ts` (Zod 3.25 / CJS).
 *
 * Cumplimiento estricto:
 * - Ley N° 19.628 y Nueva Ley N° 21.719 (Chile): k-anonimato >= 3 sin `tenantId` ni GPS exacto en `market_demand_signals`.
 * - MINREPORT-MEDIA-DIGESTOR-CAS: trazabilidad obligatoria `originalBytes`, `optimizedBytes`, `savingsPct`.
 * - HITL SpaceX Dragon Gate: confirmación explícita `confirmationKeyword: 'ACTUALIZAR'` en mutaciones críticas.
 */

export const SUPPLY_HITL_CONFIRM_KEYWORD = 'ACTUALIZAR' as const;

// ── 1. Taxonomías Canónicas de Abastecimiento ────────────────────────────────

export const SupplyDomainModeSchema = z.enum([
    'DEMAND',
    'WAREHOUSE',
    'PROCUREMENT',
    'FINANCE_RECON',
    'SII_EXPENSES',
    'FORECAST',
    'WHATSAPP_CHANNELS',
]);
export type SupplyDomainMode = z.infer<typeof SupplyDomainModeSchema>;

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

export const SupplyUnitSiSchema = z.enum([
    'kg',
    'L',
    'un',
    'par',
    'm',
    'm3',
    'caja',
    'bolsa',
]);
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

/**
 * Códigos DTE oficiales SII Chile + 0 (SIN_DTE comercio rural / vale simple).
 */
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

export const SupplyUrgencySchema = z.enum(['CRITICAL', 'HIGH', 'STANDARD', 'PLANNED']);
export type SupplyUrgency = z.infer<typeof SupplyUrgencySchema>;

export const SupplyRequisitionStatusSchema = z.enum([
    'DRAFT',
    'OPEN',
    'PARTIAL',
    'FULFILLED',
    'CANCELLED',
    'CLOSED',
]);
export type SupplyRequisitionStatus = z.infer<typeof SupplyRequisitionStatusSchema>;

export const SupplyRequisitionLineStatusSchema = z.enum([
    'OPEN',
    'PARTIAL',
    'FULFILLED',
    'CANCELLED',
]);
export type SupplyRequisitionLineStatus = z.infer<typeof SupplyRequisitionLineStatusSchema>;

export const SupplyPurchaseDestinationSchema = z.enum([
    'STOCK_IN_TRANSIT',
    'STOCK_IN_WAREHOUSE',
    'CAPEX_ASSET',
    'DIRECT_EXPENSE',
]);
export type SupplyPurchaseDestination = z.infer<typeof SupplyPurchaseDestinationSchema>;

export const SupplyPaymentMethodSchema = z.enum([
    'CAJA_CHICA',
    'FONDO_POR_RENDIR',
    'REEMBOLSO_GERENCIA',
    'TRANSFERENCIA',
    'TARJETA_CORPORATIVA',
    'CREDITO_PROVEEDOR',
    'EFECTIVO',
]);
export type SupplyPaymentMethod = z.infer<typeof SupplyPaymentMethodSchema>;

export const SupplyPolicyMismatchModeSchema = z.enum(['FLAG_AND_ACCEPT', 'STRICT_BLOCK']);
export type SupplyPolicyMismatchMode = z.infer<typeof SupplyPolicyMismatchModeSchema>;

export const WhatsAppFsmStateSchema = z.enum([
    'COLLECTING',
    'POLICY_CHECK',
    'SLOT_FILLING',
    'REVIEW_GATE',
    'COMMITTED',
    'CANCELLED',
]);
export type WhatsAppFsmState = z.infer<typeof WhatsAppFsmStateSchema>;

export const SiiDocumentRcvStatusSchema = z.enum([
    'PENDING_REVIEW',
    'ACCEPTED',
    'CLAIMED',
    'AUTO_ACCEPTED_8D',
    'NOT_APPLICABLE',
]);
export type SiiDocumentRcvStatus = z.infer<typeof SiiDocumentRcvStatusSchema>;

export const SiiExpenseReportStatusSchema = z.enum([
    'OPEN',
    'SUBMITTED',
    'APPROVED',
    'REIMBURSED',
    'REJECTED',
    'CLOSED',
]);
export type SiiExpenseReportStatus = z.infer<typeof SiiExpenseReportStatusSchema>;

export const CashLedgerEntryTypeSchema = z.enum([
    'ADVANCE_OUT',
    'PURCHASE_EXPENSE',
    'REIMBURSEMENT',
    'RETURN_IN',
    'ADJUSTMENT',
]);
export type CashLedgerEntryType = z.infer<typeof CashLedgerEntryTypeSchema>;

export const StockLedgerMovementTypeSchema = z.enum([
    'PURCHASE_IN_TRANSIT',
    'WAREHOUSE_RECEPTION',
    'CAMP_CONSUMPTION',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUSTMENT',
    'WASTE_SHRINKAGE',
]);
export type StockLedgerMovementType = z.infer<typeof StockLedgerMovementTypeSchema>;

export const STANDARD_SUPPLY_COST_CENTERS = [
    'CC-CAMPAMENTO',
    'CC-FLOTA',
    'CC-OPERACIONES',
    'CC-HSEC',
    'CC-CAPEX',
    'CC-ADMINISTRACION',
] as const;

// ── 2. Referencia de Evidencia CAS Obligatoria (MINREPORT-MEDIA-DIGESTOR-CAS) ──

export const SupplyEvidenceCasRefSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'SHA-256 CAS inválido (64 hex).'),
    phashHex: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
    downloadUrl: z
        .string()
        .min(5)
        .max(1024)
        .refine(
            (url) =>
                !url.toLowerCase().startsWith('data:') &&
                !url.toLowerCase().includes(';base64,') &&
                (url.startsWith('/api/media/') ||
                    url.startsWith('https://') ||
                    url.startsWith('offline-cas://')),
            'Evidencia CAS debe referenciar /api/media/, https:// u offline-cas:// sin base64 inline.'
        ),
    storagePath: z.string().min(1).max(512).optional(),
    mimeType: z.string().min(3).max(120),
    extension: z.string().min(2).max(12),
    originalFilename: z.string().max(240).optional(),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().nonnegative(),
    savingsPct: z.number().min(0).max(100),
    savingsRatio: z.number().min(0).max(1).optional(),
    deduplicatedHit: z.boolean().optional(),
    capturedAt: z.string().min(10).optional(),
});
export type SupplyEvidenceCasRef = z.infer<typeof SupplyEvidenceCasRefSchema>;

// ── 3. Perfil Operativo de Integrante y Preferencias de Notificación ─────────

export const SupplyCommunicationStyleSchema = z.object({
    register: z
        .enum(['COLLOQUIAL_FIELD', 'TECHNICAL_DIRECT', 'EXECUTIVE_BRIEF'])
        .default('TECHNICAL_DIRECT'),
    preferredModality: z.enum(['TEXT', 'AUDIO_VOICE', 'HYBRID']).default('HYBRID'),
    dialect: z.enum(['es-CL', 'es-PE', 'es-AR', 'pt-BR', 'en-US']).default('es-CL'),
});
export type SupplyCommunicationStyle = z.infer<typeof SupplyCommunicationStyleSchema>;

export const SupplyMemberProfileSchema = z.object({
    role: SupplyOperationalRoleSchema,
    allowedCategories: z.array(SupplyCategoryCodeSchema).default([]),
    deniedCategories: z.array(SupplyCategoryCodeSchema).default([]),
    maxRequisitionClp: z.number().nonnegative().nullable().default(null),
    canRecordDirectPurchase: z.boolean().default(false),
    autoApproveDirectPurchase: z.boolean().default(false),
    directPurchaseAlertThresholdClp: z.number().nonnegative().nullable().optional(),
    allowCapex: z.boolean().default(false),
    licensedForControlledItems: z.boolean().default(false),
    defaultCostCenter: z.string().trim().min(2).max(64).default('CC-CAMPAMENTO'),
    assignedSiteIds: z.array(z.string().trim().min(1).max(128)).default([]),
    communicationStyle: SupplyCommunicationStyleSchema.default({
        register: 'TECHNICAL_DIRECT',
        preferredModality: 'HYBRID',
        dialect: 'es-CL',
    }),
});
export type SupplyMemberProfile = z.infer<typeof SupplyMemberProfileSchema>;
export type SupplyMemberProfileInput = z.input<typeof SupplyMemberProfileSchema>;

export const MemberNotificationPreferencesSchema = z.object({
    emailEnabled: z.boolean().default(true),
    whatsappEnabled: z.boolean().default(false),
    notifyOnNewRequisition: z.boolean().default(true),
    notifyOnAtypicalFlag: z.boolean().default(true),
    notifyOnDirectPurchase: z.boolean().default(true),
    notifyOnPurchaseFulfilled: z.boolean().default(true),
    notifyOnSiiRcvDeadline: z.boolean().default(true),
    quietHoursStart: z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'Formato HH:MM inválido')
        .optional(),
    quietHoursEnd: z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'Formato HH:MM inválido')
        .optional(),
});
export type MemberNotificationPreferences = z.infer<typeof MemberNotificationPreferencesSchema>;
export type MemberNotificationPreferencesInput = z.input<
    typeof MemberNotificationPreferencesSchema
>;

// ── 4. Catálogo Maestro Canónico (`global_supply_catalog`) ───────────────────

export const SupplyPackToSiSchema = z.object({
    packLabel: z.string().trim().min(1).max(64),
    factorToSi: z.number().positive(),
    unitSi: SupplyUnitSiSchema,
});
export type SupplyPackToSi = z.infer<typeof SupplyPackToSiSchema>;

export const CanonicalSupplySkuSchema = z.object({
    canonicalSkuId: z.string().trim().min(2).max(128),
    name: z.string().trim().min(2).max(180),
    aliases: z.array(z.string().trim().min(1).max(100)).default([]),
    categoryCode: SupplyCategoryCodeSchema,
    procurementBucket: ProcurementBucketSchema,
    baseUnitSi: SupplyUnitSiSchema,
    unspscCode: z
        .string()
        .trim()
        .regex(/^\d{8}$/, 'Código UNSPSC debe tener 8 dígitos.')
        .optional(),
    requiredSlots: z.array(z.string().trim().min(1).max(64)).default(['quantity']),
    defaultPackToSi: SupplyPackToSiSchema.optional(),
    isCapexAsset: z.boolean().default(false),
    isControlled: z.boolean().default(false),
    leySaco25kgApplied: z.boolean().optional(),
    estimatedUnitPriceClp: z.number().nonnegative().optional(),
    perPaxDailyBaseline: z.number().nonnegative().optional(),
    active: z.boolean().default(true),
    createdAt: z.union([z.number(), z.string()]).optional(),
    updatedAt: z.union([z.number(), z.string()]).optional(),
});
export type CanonicalSupplySku = z.infer<typeof CanonicalSupplySkuSchema>;

// ── 5. Faenas y Campamentos (`supply_sites`) ─────────────────────────────────

export const SupplySiteSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(2).max(180),
    districtCode: z.string().trim().min(2).max(64),
    altitudeM: z.number().min(-500).max(6500).optional(),
    geoFix: CanonicalGeoFixSchema.nullable().optional(),
    shiftPattern: z.string().trim().min(1).max(40).default('7x7'),
    currentHeadcount: z.number().int().nonnegative().default(0),
    waterStorageCapacityL: z.number().nonnegative().default(0),
    ds594DailyWaterTargetLPerPax: z.number().min(100).max(500).default(120),
    leadTimeDays: z.number().positive().max(120).default(7),
    monthlyBudgetClp: z.number().nonnegative().nullable().optional(),
    roleMismatchPolicyMode: SupplyPolicyMismatchModeSchema.default('FLAG_AND_ACCEPT'),
    marketplaceDemandPoolOptIn: z.boolean().default(false),
    status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).default('ACTIVE'),
    createdAt: z.union([z.number(), z.string()]).optional(),
    updatedAt: z.union([z.number(), z.string()]).optional(),
});
export type SupplySite = z.infer<typeof SupplySiteSchema>;

// ── 6. Requisiciones Multi-Origen (`supply_requisitions`) ────────────────────

export const SupplyRequisitionLineSchema = z.object({
    lineId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().max(128).nullable().optional(),
    rawDescription: z.string().trim().min(1).max(300),
    normalizedName: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    procurementBucket: ProcurementBucketSchema,
    unitSi: SupplyUnitSiSchema,
    qtyRequested: z.number().positive(),
    qtyPurchased: z.number().nonnegative().default(0),
    qtyReceived: z.number().nonnegative().default(0),
    qtyPending: z.number().nonnegative(),
    lineStatus: SupplyRequisitionLineStatusSchema.default('OPEN'),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    atypicalNotes: z.array(z.string().trim().max(300)).optional(),
    fulfillmentChannel: FulfillmentChannelSchema.default('MANUAL_LOCAL_PURCHASE'),
    urgency: SupplyUrgencySchema.default('STANDARD'),
    estimatedUnitClp: z.number().nonnegative().optional(),
    estimatedTotalClp: z.number().nonnegative().optional(),
    attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema.nullable().optional(),
});
export type SupplyRequisitionLine = z.infer<typeof SupplyRequisitionLineSchema>;

export const SupplyRejectedItemSchema = z.object({
    rawText: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(300),
    code: z.string().trim().min(1).max(64),
});
export type SupplyRejectedItem = z.infer<typeof SupplyRejectedItemSchema>;

export const SupplyRequisitionSchema = z.object({
    reqId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    requesterUid: z.string().trim().min(1).max(128),
    requesterName: z.string().trim().min(1).max(160),
    requesterRole: SupplyOperationalRoleSchema,
    demandOrigin: SupplyDemandOriginSchema,
    demandNature: SupplyDemandNatureSchema,
    costCenter: z.string().trim().min(2).max(64),
    linkedAssetId: z.string().trim().max(128).nullable().optional(),
    linkedPlanRef: z.string().trim().max(160).nullable().optional(),
    whatsappMessageIds: z.array(z.string().trim().min(1).max(160)).optional(),
    status: SupplyRequisitionStatusSchema.default('OPEN'),
    lines: z.array(SupplyRequisitionLineSchema).min(1),
    atypicalSummaryFlags: z.array(AtypicalFlagCodeSchema).default([]),
    rejectedItems: z.array(SupplyRejectedItemSchema).optional(),
    notes: z.string().trim().max(1000).optional(),
    createdAt: z.union([z.number(), z.string()]),
    updatedAt: z.union([z.number(), z.string()]),
});
export type SupplyRequisition = z.infer<typeof SupplyRequisitionSchema>;

// ── 7. Lista de Compras Consolidada por Rubro (`ConsolidatedShoppingList`) ───

export const ConsolidatedSourceReqRefSchema = z.object({
    reqId: z.string().trim().min(1).max(128),
    lineId: z.string().trim().min(1).max(128),
    costCenter: z.string().trim().min(2).max(64),
    requesterName: z.string().trim().min(1).max(160),
    demandOrigin: SupplyDemandOriginSchema,
    qtyPending: z.number().positive(),
    urgency: SupplyUrgencySchema,
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
});
export type ConsolidatedSourceReqRef = z.infer<typeof ConsolidatedSourceReqRefSchema>;

export const ConsolidatedSkuItemSchema = z.object({
    canonicalSkuId: z.string().trim().min(1).max(128),
    normalizedName: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    procurementBucket: ProcurementBucketSchema,
    unitSi: SupplyUnitSiSchema,
    totalQtyPending: z.number().positive(),
    highestUrgency: SupplyUrgencySchema,
    hasPartialPending: z.boolean().default(false),
    atypicalCount: z.number().int().nonnegative().default(0),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    estimatedUnitClp: z.number().nonnegative().optional(),
    estimatedClp: z.number().nonnegative().default(0),
    sourceReqRefs: z.array(ConsolidatedSourceReqRefSchema).min(1),
});
export type ConsolidatedSkuItem = z.infer<typeof ConsolidatedSkuItemSchema>;

export const ConsolidatedBucketGroupSchema = z.object({
    procurementBucket: ProcurementBucketSchema,
    itemCount: z.number().int().nonnegative(),
    atypicalCount: z.number().int().nonnegative().default(0),
    estimatedBucketClp: z.number().nonnegative().default(0),
    items: z.array(ConsolidatedSkuItemSchema),
});
export type ConsolidatedBucketGroup = z.infer<typeof ConsolidatedBucketGroupSchema>;

export const ConsolidatedShoppingListSchema = z.object({
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().max(128).nullable().optional(),
    generatedAt: z.string().min(10),
    totalRequisitionsIncluded: z.number().int().nonnegative(),
    totalLinesIncluded: z.number().int().nonnegative(),
    totalAtypicalCount: z.number().int().nonnegative().default(0),
    totalEstimatedClp: z.number().nonnegative().default(0),
    buckets: z.array(ConsolidatedBucketGroupSchema),
});
export type ConsolidatedShoppingList = z.infer<typeof ConsolidatedShoppingListSchema>;

// ── 8. Compras y Boletas/Facturas (`supply_purchases`) ───────────────────────

export const SupplyPurchaseLineSchema = z.object({
    purchaseLineId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().max(128).nullable().optional(),
    rawDescription: z.string().trim().min(1).max(300),
    normalizedName: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    unitSi: SupplyUnitSiSchema,
    qtyPurchased: z.number().positive(),
    qtyReceived: z.number().nonnegative().default(0),
    unitPriceNetClp: z.number().nonnegative(),
    unitPriceGrossClp: z.number().nonnegative(),
    lineNetClp: z.number().nonnegative(),
    lineVatClp: z.number().nonnegative(),
    lineTotalClp: z.number().nonnegative(),
    destination: SupplyPurchaseDestinationSchema,
    costCenter: z.string().trim().min(2).max(64),
    isCapexAsset: z.boolean().default(false),
    linkedAssetId: z.string().trim().max(128).nullable().optional(),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
});
export type SupplyPurchaseLine = z.infer<typeof SupplyPurchaseLineSchema>;

export const SupplyPurchaseSchema = z.object({
    purchaseId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    buyerUid: z.string().trim().min(1).max(128),
    buyerName: z.string().trim().max(160).optional(),
    buyerRole: SupplyOperationalRoleSchema,
    purchaseMode: PurchaseModeSchema,
    authorizedByAuthority: z.boolean().default(false),
    supplierTaxId: z.string().trim().min(3).max(32),
    supplierName: z.string().trim().min(1).max(200),
    supplierId: z.string().trim().max(128).nullable().optional(),
    documentType: SiiDteTypeSchema,
    folio: z.string().trim().min(1).max(64),
    dedupeKey: z.string().trim().min(3).max(128).optional(),
    issueDate: z.string().trim().min(8).max(32),
    netAmountClp: z.number().nonnegative(),
    vatAmountClp: z.number().nonnegative(),
    totalAmountClp: z.number().nonnegative(),
    vatRecoverable: z.boolean().default(false),
    arithmeticMismatchClp: z.number().default(0),
    paymentMethod: SupplyPaymentMethodSchema,
    expenseReportId: z.string().trim().max(128).nullable().optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema,
    tedRawXml: z.string().max(16384).nullable().optional(),
    receptionStatus: z
        .enum(['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED_AT_SITE', 'DIRECT_CONSUMED'])
        .default('IN_TRANSIT'),
    lines: z.array(SupplyPurchaseLineSchema).min(1),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    createdAt: z.union([z.number(), z.string()]),
    updatedAt: z.union([z.number(), z.string()]),
});
export type SupplyPurchase = z.infer<typeof SupplyPurchaseSchema>;

// ── 9. Asignación N:M Compra <-> Requisición (`supply_fulfillment_allocations`)

export const FulfillmentAllocationSchema = z.object({
    allocationId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    purchaseId: z.string().trim().min(1).max(128),
    purchaseLineId: z.string().trim().min(1).max(128),
    allocationKind: z.enum(['REQUISITION_MATCH', 'UNSOLICITED_PURCHASE']),
    requisitionId: z.string().trim().max(128).nullable().default(null),
    requisitionLineId: z.string().trim().max(128).nullable().default(null),
    canonicalSkuId: z.string().trim().max(128).nullable().optional(),
    qtyAllocated: z.number().positive(),
    unitSi: SupplyUnitSiSchema,
    resultingRequisitionLineStatus: SupplyRequisitionLineStatusSchema.nullable().optional(),
    destination: SupplyPurchaseDestinationSchema,
    createdByUid: z.string().trim().min(1).max(128),
    createdAt: z.union([z.number(), z.string()]),
});
export type FulfillmentAllocation = z.infer<typeof FulfillmentAllocationSchema>;

// ── 10. Bóveda Patrimonial de Activos CAPEX (`supply_assets`) ────────────────

export const SupplyAssetSchema = z.object({
    assetId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(2).max(200),
    categoryCode: SupplyCategoryCodeSchema.default('ACTIVO_EQUIPAMIENTO'),
    serialOrTag: z.string().trim().max(120).nullable().optional(),
    acquisitionNetClp: z.number().nonnegative(),
    vatCreditClp: z.number().nonnegative().default(0),
    totalAcquisitionClp: z.number().nonnegative().optional(),
    invoiceDteType: SiiDteTypeSchema,
    invoiceFolio: z.string().trim().min(1).max(64),
    supplierTaxId: z.string().trim().min(3).max(32),
    supplierName: z.string().trim().max(200).optional(),
    purchaseId: z.string().trim().max(128).nullable().optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema,
    missingInvoiceAlert: z.boolean().default(false),
    warrantyUntil: z.string().trim().max(32).nullable().optional(),
    opermaqAssetId: z.string().trim().max(128).nullable().optional(),
    status: z
        .enum(['ACTIVE', 'IN_MAINTENANCE', 'DECOMMISSIONED', 'TRANSFERRED'])
        .default('ACTIVE'),
    costCenter: z.string().trim().min(2).max(64).default('CC-CAPEX'),
    createdAt: z.union([z.number(), z.string()]),
    updatedAt: z.union([z.number(), z.string()]),
});
export type SupplyAsset = z.infer<typeof SupplyAssetSchema>;

// ── 11. Sub-Módulo Tributario SII (`supply_sii_documents`, `supply_expense_reports`)

export const SiiDocumentRecordSchema = z.object({
    docId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().max(128).optional(),
    purchaseId: z.string().trim().max(128).nullable().optional(),
    expenseReportId: z.string().trim().max(128).nullable().optional(),
    dedupeKey: z
        .string()
        .trim()
        .min(3)
        .max(128)
        .regex(/^[^#]+#\d+#[^#]+$/, 'dedupeKey debe seguir formato rutEmisor#tipoDte#folio.'),
    emitterTaxId: z.string().trim().min(3).max(32),
    emitterName: z.string().trim().min(1).max(200),
    receiverTaxId: z.string().trim().max(32).optional(),
    documentType: SiiDteTypeSchema,
    folio: z.string().trim().min(1).max(64),
    issueDate: z.string().trim().min(8).max(32),
    netAmountClp: z.number().nonnegative(),
    exemptAmountClp: z.number().nonnegative().default(0),
    vatAmountClp: z.number().nonnegative(),
    totalAmountClp: z.number().nonnegative(),
    vatRecoverable: z.boolean().default(false),
    rcvDeadlineDate: z.string().trim().max(32).nullable().optional(),
    rcvDaysRemaining: z.number().int().nullable().optional(),
    rcvStatus: SiiDocumentRcvStatusSchema.default('PENDING_REVIEW'),
    tedVerified: z.boolean().default(false),
    tedRawXml: z.string().max(16384).nullable().optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema,
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
    createdAt: z.union([z.number(), z.string()]),
    updatedAt: z.union([z.number(), z.string()]),
});
export type SiiDocumentRecord = z.infer<typeof SiiDocumentRecordSchema>;

export const SiiExpenseReportSchema = z.object({
    reportId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(2).max(180),
    holderUid: z.string().trim().min(1).max(128),
    holderName: z.string().trim().min(1).max(160),
    periodLabel: z.string().trim().min(4).max(32),
    costCenter: z.string().trim().min(2).max(64),
    fundAdvanceClp: z.number().nonnegative().default(0),
    renderedTotalClp: z.number().nonnegative().default(0),
    recoverableVatClp: z.number().nonnegative().default(0),
    balanceClp: z.number(),
    siiDocumentIds: z.array(z.string().trim().min(1).max(128)).default([]),
    purchaseIds: z.array(z.string().trim().min(1).max(128)).default([]),
    status: SiiExpenseReportStatusSchema.default('OPEN'),
    approvedByUid: z.string().trim().max(128).nullable().optional(),
    approvedAt: z.union([z.number(), z.string()]).nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    createdAt: z.union([z.number(), z.string()]),
    updatedAt: z.union([z.number(), z.string()]),
});
export type SiiExpenseReport = z.infer<typeof SiiExpenseReportSchema>;

// ── 12. Ledgers Inmutables de Caja y Bodega (`supply_cash_ledger`, `supply_stock_ledger`)

export const CashLedgerEntrySchema = z.object({
    entryId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    actorUid: z.string().trim().min(1).max(128),
    actorName: z.string().trim().max(160).optional(),
    entryType: CashLedgerEntryTypeSchema,
    paymentMethod: SupplyPaymentMethodSchema,
    costCenter: z.string().trim().min(2).max(64),
    amountClp: z.number(),
    netAmountClp: z.number().nonnegative().default(0),
    vatCreditClp: z.number().nonnegative().default(0),
    isCapex: z.boolean().default(false),
    purchaseId: z.string().trim().max(128).nullable().optional(),
    expenseReportId: z.string().trim().max(128).nullable().optional(),
    siiDocId: z.string().trim().max(128).nullable().optional(),
    reference: z.string().trim().max(240).optional(),
    createdAt: z.union([z.number(), z.string()]),
});
export type CashLedgerEntry = z.infer<typeof CashLedgerEntrySchema>;

export const StockLedgerEntrySchema = z.object({
    ledgerId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().min(1).max(128),
    itemName: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    unitSi: SupplyUnitSiSchema,
    movementType: StockLedgerMovementTypeSchema,
    deltaInTransit: z.number(),
    deltaInWarehouse: z.number(),
    balanceInTransitAfter: z.number().nonnegative(),
    balanceInWarehouseAfter: z.number().nonnegative(),
    unitCostNetClp: z.number().nonnegative().default(0),
    purchaseId: z.string().trim().max(128).nullable().optional(),
    requisitionId: z.string().trim().max(128).nullable().optional(),
    actorUid: z.string().trim().min(1).max(128),
    notes: z.string().trim().max(500).optional(),
    createdAt: z.union([z.number(), z.string()]),
});
export type StockLedgerEntry = z.infer<typeof StockLedgerEntrySchema>;

export const SupplyInventoryItemSchema = z.object({
    itemId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    canonicalSkuId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    procurementBucket: ProcurementBucketSchema,
    unitSi: SupplyUnitSiSchema,
    qtyInTransit: z.number().nonnegative().default(0),
    qtyInWarehouse: z.number().nonnegative().default(0),
    minSafetyStock: z.number().nonnegative().default(0),
    ewmaDailyRatePerPax: z.number().nonnegative().optional(),
    estimatedDoiDays: z.number().nonnegative().nullable().optional(),
    weightedAvgUnitCostClp: z.number().nonnegative().default(0),
    updatedAt: z.union([z.number(), z.string()]),
});
export type SupplyInventoryItem = z.infer<typeof SupplyInventoryItemSchema>;

// ── 13. Pronóstico de Demanda (`supply_demand_forecasts`) & Pool Anónimo (`market_demand_signals`)

export const WaterCoverageGuardrailSchema = z.object({
    requiredWaterL: z.number().nonnegative(),
    availableWaterL: z.number().nonnegative(),
    ds594TargetLPerPaxDay: z.number().positive(),
    altitudeFactorApplied: z.number().min(1).default(1),
    coverageDays: z.number().nonnegative(),
    compliant: z.boolean(),
});
export type WaterCoverageGuardrail = z.infer<typeof WaterCoverageGuardrailSchema>;

export const DemandForecastSkuProjectionSchema = z.object({
    canonicalSkuId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    categoryCode: SupplyCategoryCodeSchema,
    unitSi: SupplyUnitSiSchema,
    ewmaDailyRatePerPax: z.number().nonnegative(),
    projectedQty: z.number().nonnegative(),
    currentAvailableQty: z.number().nonnegative(),
    currentDoiDays: z.number().nonnegative().nullable(),
    suggestedReorderQty: z.number().nonnegative(),
    estimatedCostClp: z.number().nonnegative(),
    isCritical: z.boolean().default(false),
});
export type DemandForecastSkuProjection = z.infer<typeof DemandForecastSkuProjectionSchema>;

export const DemandForecastSchema = z.object({
    forecastId: z.string().trim().min(1).max(128),
    tenantId: z.string().trim().min(1).max(128),
    siteId: z.string().trim().min(1).max(128),
    generatedAt: z.string().min(10),
    horizonDays: z.number().int().min(1).max(365),
    headcountBasis: z.number().int().nonnegative(),
    leadTimeDays: z.number().positive(),
    waterCoverageGuardrail: WaterCoverageGuardrailSchema,
    opexDailyPerPaxClp: z.number().nonnegative(),
    projectedOpexTotalClp: z.number().nonnegative(),
    skuProjections: z.array(DemandForecastSkuProjectionSchema),
});
export type DemandForecast = z.infer<typeof DemandForecastSchema>;

/**
 * Señal agregada y anónima de demanda distrital para futuro MINREPORT · MARKETPLACE.
 * Ley N° 21.719 (Chile): estrictamente opt-in, k-anonimato k >= 3 entidades distintas,
 * PROHIBIDO incluir `tenantId`, `siteId` o coordenadas GPS exactas (`.strict()`).
 */
export const DemandPoolSignalSchema = z
    .object({
        signalId: z.string().trim().min(1).max(128),
        districtCode: z.string().trim().min(2).max(64),
        periodWindow: z.string().trim().min(4).max(32),
        canonicalSkuId: z.string().trim().min(1).max(128),
        skuName: z.string().trim().min(2).max(180),
        categoryCode: SupplyCategoryCodeSchema,
        procurementBucket: ProcurementBucketSchema,
        unitSi: SupplyUnitSiSchema,
        aggregatedQty: z.number().positive(),
        participatingEntitiesCount: z
            .number()
            .int()
            .min(3, 'K-anonimato Ley N° 21.719 exige k >= 3 entidades distintas.'),
        optInVerified: z.literal(true),
        medianReferenceUnitClp: z.number().nonnegative().optional(),
        generatedAt: z.string().min(10),
        expiresAt: z.string().min(10),
    })
    .strict();
export type DemandPoolSignal = z.infer<typeof DemandPoolSignalSchema>;

// ── 14. Payloads Request / Response API (`/api/supply/*`) con Gate HITL ──────

export const CreateSupplySitePayloadSchema = z.object({
    name: z.string().trim().min(2).max(180),
    districtCode: z.string().trim().min(2).max(64),
    altitudeM: z.number().min(-500).max(6500).optional(),
    geoFix: CanonicalGeoFixSchema.nullable().optional(),
    shiftPattern: z.string().trim().min(1).max(40).default('7x7'),
    currentHeadcount: z.number().int().nonnegative().default(0),
    waterStorageCapacityL: z.number().nonnegative().default(0),
    ds594DailyWaterTargetLPerPax: z.number().min(100).max(500).default(120),
    leadTimeDays: z.number().positive().max(120).default(7),
    monthlyBudgetClp: z.number().nonnegative().nullable().optional(),
    roleMismatchPolicyMode: SupplyPolicyMismatchModeSchema.default('FLAG_AND_ACCEPT'),
    marketplaceDemandPoolOptIn: z.boolean().default(false),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type CreateSupplySitePayload = z.input<typeof CreateSupplySitePayloadSchema>;
export type CreateSupplySitePayloadOutput = z.infer<typeof CreateSupplySitePayloadSchema>;

export const UpdateSupplySitePayloadSchema = z.object({
    name: z.string().trim().min(2).max(180).optional(),
    districtCode: z.string().trim().min(2).max(64).optional(),
    altitudeM: z.number().min(-500).max(6500).optional(),
    geoFix: CanonicalGeoFixSchema.nullable().optional(),
    shiftPattern: z.string().trim().min(1).max(40).optional(),
    currentHeadcount: z.number().int().nonnegative().optional(),
    waterStorageCapacityL: z.number().nonnegative().optional(),
    ds594DailyWaterTargetLPerPax: z.number().min(100).max(500).optional(),
    leadTimeDays: z.number().positive().max(120).optional(),
    monthlyBudgetClp: z.number().nonnegative().nullable().optional(),
    roleMismatchPolicyMode: SupplyPolicyMismatchModeSchema.optional(),
    marketplaceDemandPoolOptIn: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type UpdateSupplySitePayload = z.input<typeof UpdateSupplySitePayloadSchema>;
export type UpdateSupplySitePayloadOutput = z.infer<typeof UpdateSupplySitePayloadSchema>;

export const CreateSupplyRequisitionLineInputSchema = z.object({
    canonicalSkuId: z.string().trim().max(128).nullable().optional(),
    rawDescription: z.string().trim().min(1).max(300),
    normalizedName: z.string().trim().min(1).max(200).optional(),
    categoryCode: SupplyCategoryCodeSchema.optional(),
    procurementBucket: ProcurementBucketSchema.optional(),
    unitSi: SupplyUnitSiSchema.default('un'),
    qtyRequested: z.number().positive(),
    urgency: SupplyUrgencySchema.default('STANDARD'),
    fulfillmentChannel: FulfillmentChannelSchema.default('MANUAL_LOCAL_PURCHASE'),
    estimatedUnitClp: z.number().nonnegative().optional(),
    attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema.nullable().optional(),
});
export type CreateSupplyRequisitionLineInput = z.input<
    typeof CreateSupplyRequisitionLineInputSchema
>;

export const CreateSupplyRequisitionPayloadSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    demandOrigin: SupplyDemandOriginSchema.default('DESKTOP_MANUAL'),
    demandNature: SupplyDemandNatureSchema.default('REACTIVE_FIELD'),
    costCenter: z.string().trim().min(2).max(64).default('CC-CAMPAMENTO'),
    linkedAssetId: z.string().trim().max(128).nullable().optional(),
    linkedPlanRef: z.string().trim().max(160).nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(CreateSupplyRequisitionLineInputSchema).min(1).max(100),
});
export type CreateSupplyRequisitionPayload = z.input<typeof CreateSupplyRequisitionPayloadSchema>;
export type CreateSupplyRequisitionPayloadOutput = z.infer<
    typeof CreateSupplyRequisitionPayloadSchema
>;

export const CancelSupplyRequisitionPayloadSchema = z.object({
    reason: z.string().trim().min(3).max(500),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type CancelSupplyRequisitionPayload = z.infer<typeof CancelSupplyRequisitionPayloadSchema>;

export const AnalyzeSupplyReceiptPayloadSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    purchaseMode: PurchaseModeSchema.default('REQUISITION_FULFILLMENT'),
    defaultDestination: SupplyPurchaseDestinationSchema.default('STOCK_IN_TRANSIT'),
    evidenceCasRef: SupplyEvidenceCasRefSchema.optional(),
    xmlDteContent: z.string().max(524288).optional(),
    tedRawXml: z.string().max(16384).optional(),
    locale: z.enum(['es', 'en', 'pt']).default('es'),
});
export type AnalyzeSupplyReceiptPayload = z.input<typeof AnalyzeSupplyReceiptPayloadSchema>;
export type AnalyzeSupplyReceiptPayloadOutput = z.infer<typeof AnalyzeSupplyReceiptPayloadSchema>;

export const CandidateFulfillmentAllocationSchema = z.object({
    purchaseLineId: z.string().trim().min(1).max(128),
    allocationKind: z.enum(['REQUISITION_MATCH', 'UNSOLICITED_PURCHASE']),
    requisitionId: z.string().trim().max(128).nullable().default(null),
    requisitionLineId: z.string().trim().max(128).nullable().default(null),
    qtyAllocated: z.number().positive(),
    unitSi: SupplyUnitSiSchema,
    destination: SupplyPurchaseDestinationSchema,
    resultingRequisitionLineStatus: SupplyRequisitionLineStatusSchema.nullable().optional(),
});
export type CandidateFulfillmentAllocation = z.infer<typeof CandidateFulfillmentAllocationSchema>;

export const AnalyzedReceiptDraftSchema = z.object({
    extractionSource: z.enum(['XML_DTE', 'TED_PDF417', 'GEMINI_VISION_OCR', 'HYBRID_TED_OCR']),
    supplierTaxId: z.string().trim().max(32),
    supplierTaxIdValid: z.boolean(),
    supplierName: z.string().trim().max(200),
    documentType: SiiDteTypeSchema,
    folio: z.string().trim().max(64),
    dedupeKey: z.string().trim().max(128),
    isDuplicate: z.boolean().default(false),
    issueDate: z.string().trim().max(32),
    netAmountClp: z.number().nonnegative(),
    vatAmountClp: z.number().nonnegative(),
    totalAmountClp: z.number().nonnegative(),
    vatRecoverable: z.boolean().default(false),
    arithmeticValid: z.boolean(),
    arithmeticMismatchClp: z.number(),
    tedRawXml: z.string().max(16384).nullable().optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema.optional(),
    lines: z.array(SupplyPurchaseLineSchema),
    candidateAllocations: z.array(CandidateFulfillmentAllocationSchema).default([]),
    atypicalFlags: z.array(AtypicalFlagCodeSchema).default([]),
});
export type AnalyzedReceiptDraft = z.infer<typeof AnalyzedReceiptDraftSchema>;

export const CommitSupplyPurchasePayloadSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    purchaseMode: PurchaseModeSchema,
    supplierTaxId: z.string().trim().min(3).max(32),
    supplierName: z.string().trim().min(1).max(200),
    supplierId: z.string().trim().max(128).nullable().optional(),
    documentType: SiiDteTypeSchema,
    folio: z.string().trim().min(1).max(64),
    issueDate: z.string().trim().min(8).max(32),
    netAmountClp: z.number().nonnegative(),
    vatAmountClp: z.number().nonnegative(),
    totalAmountClp: z.number().nonnegative(),
    paymentMethod: SupplyPaymentMethodSchema,
    expenseReportId: z.string().trim().max(128).nullable().optional(),
    evidenceCasRef: SupplyEvidenceCasRefSchema,
    tedRawXml: z.string().max(16384).nullable().optional(),
    lines: z.array(SupplyPurchaseLineSchema).min(1).max(200),
    allocations: z.array(CandidateFulfillmentAllocationSchema).default([]),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type CommitSupplyPurchasePayload = z.input<typeof CommitSupplyPurchasePayloadSchema>;
export type CommitSupplyPurchasePayloadOutput = z.infer<typeof CommitSupplyPurchasePayloadSchema>;

export const ConfirmPurchaseReceptionPayloadSchema = z.object({
    receivedLines: z
        .array(
            z.object({
                purchaseLineId: z.string().trim().min(1).max(128),
                qtyReceivedNow: z.number().nonnegative(),
                notes: z.string().trim().max(300).optional(),
            })
        )
        .min(1),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type ConfirmPurchaseReceptionPayload = z.infer<typeof ConfirmPurchaseReceptionPayloadSchema>;

export const LinkSupplyAssetOpermaqPayloadSchema = z.object({
    opermaqAssetId: z.string().trim().min(1).max(128).optional(),
    createOpermaqFleetUnit: z.boolean().default(false),
    serialOrTag: z.string().trim().max(120).optional(),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type LinkSupplyAssetOpermaqPayload = z.input<typeof LinkSupplyAssetOpermaqPayloadSchema>;
export type LinkSupplyAssetOpermaqPayloadOutput = z.infer<
    typeof LinkSupplyAssetOpermaqPayloadSchema
>;

export const CreateSiiExpenseReportPayloadSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(2).max(180),
    periodLabel: z.string().trim().min(4).max(32),
    costCenter: z.string().trim().min(2).max(64).default('CC-CAMPAMENTO'),
    fundAdvanceClp: z.number().nonnegative().default(0),
    notes: z.string().trim().max(1000).optional(),
});
export type CreateSiiExpenseReportPayload = z.input<typeof CreateSiiExpenseReportPayloadSchema>;
export type CreateSiiExpenseReportPayloadOutput = z.infer<
    typeof CreateSiiExpenseReportPayloadSchema
>;

export const UpdateSiiExpenseReportStatusPayloadSchema = z.object({
    status: SiiExpenseReportStatusSchema,
    notes: z.string().trim().max(1000).optional(),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type UpdateSiiExpenseReportStatusPayload = z.infer<
    typeof UpdateSiiExpenseReportStatusPayloadSchema
>;

export const RecordCashLedgerEntryPayloadSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    entryType: CashLedgerEntryTypeSchema,
    paymentMethod: SupplyPaymentMethodSchema,
    costCenter: z.string().trim().min(2).max(64),
    amountClp: z.number(),
    netAmountClp: z.number().nonnegative().default(0),
    vatCreditClp: z.number().nonnegative().default(0),
    isCapex: z.boolean().default(false),
    purchaseId: z.string().trim().max(128).nullable().optional(),
    expenseReportId: z.string().trim().max(128).nullable().optional(),
    siiDocId: z.string().trim().max(128).nullable().optional(),
    reference: z.string().trim().max(240).optional(),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type RecordCashLedgerEntryPayload = z.input<typeof RecordCashLedgerEntryPayloadSchema>;
export type RecordCashLedgerEntryPayloadOutput = z.infer<
    typeof RecordCashLedgerEntryPayloadSchema
>;

export const SimulateWhatsAppTurnPayloadSchema = z.object({
    phoneE164: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Teléfono E.164 inválido.'),
    siteId: z.string().trim().min(1).max(128).optional(),
    text: z.string().trim().max(4000).default(''),
    audioTranscript: z.string().trim().max(4000).optional(),
    mediaCasRef: SupplyEvidenceCasRefSchema.nullable().optional(),
    simulateSenderRole: SupplyOperationalRoleSchema.optional(),
});
export type SimulateWhatsAppTurnPayload = z.input<typeof SimulateWhatsAppTurnPayloadSchema>;
export type SimulateWhatsAppTurnPayloadOutput = z.infer<typeof SimulateWhatsAppTurnPayloadSchema>;
