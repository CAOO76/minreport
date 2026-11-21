/**
 * MINREPORT · ABASTECIMIENTO — Tipos de Dominio Puros (Zero External Dependencies)
 *
 * Contratos de dominio determinísticos alineados 1:1 con los esquemas canónicos
 * de `src/contracts/supply.contracts.ts` (Zod) para compilación aislada y
 * acoplamiento hexagonal limpio.
 */

export type SupplyCategoryCode =
    | 'VIVERES_ALIMENTACION'
    | 'AGUA_POTABLE'
    | 'ASEO_HIGIENE'
    | 'GAS_ENERGIA_CAMP'
    | 'EPP_SEGURIDAD'
    | 'FERRETERIA_CONSTRUCCION'
    | 'MANTENCION_CAMP'
    | 'REPUESTOS_MAQUINARIA'
    | 'LUBRICANTES_FILTROS'
    | 'PERFORACION_ACEROS'
    | 'FORTIFICACION'
    | 'COMBUSTIBLE_FAENA'
    | 'HERRAMIENTAS'
    | 'ACTIVO_EQUIPAMIENTO'
    | 'EXPLOSIVOS_REGULADO'
    | 'OTROS_OPERACIONAL';

export type ProcurementBucket =
    | 'VERDULERIA'
    | 'SUPERMERCADO'
    | 'FERRETERIA'
    | 'REPUESTOS_OPERMAQ'
    | 'EPP_SEGURIDAD'
    | 'GAS_AGUA_COMBUSTIBLE'
    | 'MANTENCION_EQUIPAMIENTO';

export type SupplyUnitSi = 'kg' | 'L' | 'un' | 'par' | 'm' | 'm3' | 'caja' | 'bolsa';

export type SupplyOperationalRole =
    | 'CAMP_MANAGER'
    | 'MECHANIC_TECH'
    | 'OPS_FOREMAN'
    | 'WAREHOUSE_KEEPER'
    | 'HSEC_OFFICER'
    | 'BUYER'
    | 'SITE_ADMIN'
    | 'OWNER_EXEC';

export type SupplyDemandOrigin =
    | 'WA_CAMP'
    | 'WA_MECHANIC'
    | 'WA_OPS'
    | 'WA_WAREHOUSE_HSEC'
    | 'WA_EXEC_DIRECT'
    | 'MODULE_PLANNING'
    | 'MODULE_HSEC'
    | 'MODULE_OPERMAQ'
    | 'MODULE_STOCKPILE'
    | 'DESKTOP_MANUAL';

export type SupplyDemandNature =
    | 'PLANNED_ENGINEERING'
    | 'REACTIVE_FIELD'
    | 'SAFETY_REPLENISHMENT'
    | 'AUTONOMOUS_PURCHASE';

export type AtypicalFlagCode =
    | 'ATYPICAL_ROLE_MISMATCH'
    | 'ATYPICAL_VOLUME_SPIKE'
    | 'ATYPICAL_DUPLICATE_FREQ'
    | 'ATYPICAL_HIGH_VALUE_OR_CAPEX'
    | 'ATYPICAL_UNPLANNED_DRIFT'
    | 'ATYPICAL_ASSET_WITHOUT_INVOICE';

export type FulfillmentChannel =
    | 'MANUAL_LOCAL_PURCHASE'
    | 'INTERNAL_WAREHOUSE_TRANSFER'
    | 'MARKETPLACE_RFQ_SINGLE'
    | 'MARKETPLACE_CONSOLIDATED_POOL'
    | 'M2M_X402_AUTOPROCURE';

export type PurchaseMode =
    | 'REQUISITION_FULFILLMENT'
    | 'DIRECT_AUTONOMOUS'
    | 'MIXED_FULFILLMENT_AND_DIRECT';

/**
 * Códigos DTE del Servicio de Impuestos Internos (SII Chile).
 * 33 = Factura Electrónica Afecta
 * 34 = Factura No Afecta o Exenta Electrónica
 * 39 = Boleta Electrónica Afecta
 * 41 = Boleta No Afecta o Exenta Electrónica
 * 52 = Guía de Despacho Electrónica
 * 61 = Nota de Crédito Electrónica
 * 0  = Comprobante informal / rural sin DTE
 */
export type SiiDteType = 33 | 34 | 39 | 41 | 52 | 61 | 0;

export type SupplyUrgency = 'CRITICAL' | 'HIGH' | 'STANDARD' | 'PLANNED';

export type SupplyCostCenter =
    | 'CC-CAMPAMENTO'
    | 'CC-FLOTA'
    | 'CC-OPERACIONES'
    | 'CC-HSEC'
    | 'CC-CAPEX'
    | 'CC-ADMINISTRACION'
    | (string & {});

export type SupplyPaymentMethod =
    | 'CAJA_CHICA'
    | 'FONDO_POR_RENDIR'
    | 'REEMBOLSO_GERENCIA'
    | 'TRANSFERENCIA'
    | 'TARJETA_CORPORATIVA'
    | 'CREDITO_PROVEEDOR'
    | 'EFECTIVO';

export type SupplyLineDestination =
    | 'STOCK_IN_TRANSIT'
    | 'STOCK_IN_WAREHOUSE'
    | 'CAPEX_ASSET'
    | 'DIRECT_EXPENSE';

export type RequisitionStatus =
    | 'DRAFT'
    | 'OPEN'
    | 'PARTIAL'
    | 'FULFILLED'
    | 'CANCELLED'
    | 'CLOSED'
    | 'PENDING_REVIEW';

export type RequisitionLineStatus = 'OPEN' | 'PARTIAL' | 'FULFILLED' | 'CANCELLED';

export type PolicyRoleMismatchMode = 'FLAG_AND_ACCEPT' | 'STRICT_BLOCK';

export type ConversationFsmState =
    | 'COLLECTING'
    | 'POLICY_CHECK'
    | 'SLOT_FILLING'
    | 'REVIEW_GATE'
    | 'COMMITTED';

export type RequiredSlotName =
    | 'quantity'
    | 'packagingUnit'
    | 'size'
    | 'location'
    | 'photoOptional'
    | 'linkedAssetId'
    | 'specification'
    | 'urgency';

export interface SupplyCommunicationStyle {
    register: 'COLLOQUIAL_FIELD' | 'TECHNICAL_DIRECT' | 'EXECUTIVE_BRIEF';
    preferredModality: 'TEXT' | 'AUDIO_VOICE' | 'HYBRID';
    dialect: 'es-CL' | 'es-PE' | 'es-AR' | 'pt-BR' | 'en-US';
}

export interface SupplyMemberProfile {
    role: SupplyOperationalRole;
    allowedCategories: SupplyCategoryCode[];
    deniedCategories: SupplyCategoryCode[];
    maxRequisitionClp?: number;
    canRecordDirectPurchase: boolean;
    autoApproveDirectPurchase: boolean;
    allowCapex: boolean;
    licensedForControlledItems: boolean;
    defaultCostCenter: SupplyCostCenter;
    assignedSiteIds: string[];
    communicationStyle: SupplyCommunicationStyle;
}

export interface DefaultPackConversion {
    packLabel: string;
    factorToSi: number;
    unitSi: SupplyUnitSi;
}

export interface CanonicalSupplySku {
    canonicalSkuId: string;
    name: string;
    aliases: string[];
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    baseUnitSi: SupplyUnitSi;
    unspscCode?: string;
    requiredSlots: RequiredSlotName[];
    defaultPackToSi?: DefaultPackConversion;
    referenceUnitPriceClp?: number;
    isCapexAsset: boolean;
    isControlled: boolean;
    leySaco25kgApplied?: boolean;
    slotQuestionTemplate?: string;
    expectedDailyPerPaxSi?: number;
    defaultCostCenter?: SupplyCostCenter;
}

export interface CasEvidenceRef {
    sha256: string;
    phashHex?: string;
    downloadUrl?: string;
    storagePath?: string;
    mimeType: string;
    extension?: string;
    originalFilename?: string;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    savingsRatio?: number;
    deduplicatedHit?: boolean;
    capturedAt?: string;
}

export type SupplyEvidenceCasRef = CasEvidenceRef;

export interface GeoFix {
    lat: number;
    lng: number;
}

export interface SupplySite {
    siteId: string;
    tenantId: string;
    name: string;
    districtCode: string;
    altitudeMeters?: number;
    geoFix?: GeoFix;
    shiftPattern: string;
    currentHeadcount: number;
    waterStorageCapacityL: number;
    ds594DailyWaterTargetLPerPax: number;
    leadTimeDays: number;
    monthlyBudgetClp?: number;
    marketplaceOptIn?: boolean;
}

export interface SupplyRequisitionLine {
    lineId: string;
    canonicalSkuId: string;
    description: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    qtyRequested: number;
    qtyPurchased: number;
    qtyReceived: number;
    qtyPending: number;
    lineStatus: RequisitionLineStatus;
    atypicalFlags: AtypicalFlagCode[];
    fulfillmentChannel: FulfillmentChannel;
    urgency: SupplyUrgency;
    estimatedUnitClp?: number;
    attributes?: Record<string, string | number | boolean>;
}

export interface SupplyRequisition {
    reqId: string;
    tenantId: string;
    siteId: string;
    requesterUid: string;
    requesterName: string;
    requesterRole: SupplyOperationalRole;
    demandOrigin: SupplyDemandOrigin;
    demandNature: SupplyDemandNature;
    costCenter: SupplyCostCenter;
    linkedAssetId?: string;
    linkedPlanRef?: string;
    status: RequisitionStatus;
    createdAt: string;
    updatedAt?: string;
    lines: SupplyRequisitionLine[];
}

export interface ConsolidatedShoppingListSourceRef {
    reqId: string;
    requisitionId: string;
    lineId: string;
    costCenter: SupplyCostCenter;
    requesterName: string;
    demandOrigin: SupplyDemandOrigin;
    qtyPending: number;
    urgency: SupplyUrgency;
    lineStatus: RequisitionLineStatus;
    atypicalFlags: AtypicalFlagCode[];
}

export type ShoppingListPriorityTier = 'CRITICAL' | 'PARTIAL_PENDING' | 'STANDARD';

export interface ConsolidatedSkuItem {
    canonicalSkuId: string;
    name: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    totalQtyPending: number;
    priorityTier: ShoppingListPriorityTier;
    highestUrgency: SupplyUrgency;
    hasPartialPending: boolean;
    atypicalFlags: AtypicalFlagCode[];
    atypicalCount: number;
    estimatedClp: number;
    sourceReqRefs: ConsolidatedShoppingListSourceRef[];
}

export interface ConsolidatedShoppingListBucket {
    procurementBucket: ProcurementBucket;
    items: ConsolidatedSkuItem[];
    totalLines: number;
    totalAtypicalCount: number;
    estimatedBucketClp: number;
}

export interface ConsolidatedShoppingList {
    tenantId: string;
    siteId: string;
    generatedAt: string;
    sourceRequisitionCount: number;
    totalUniqueSkus: number;
    totalAtypicalCount: number;
    totalEstimatedClp: number;
    buckets: ConsolidatedShoppingListBucket[];
}

export interface SupplyPurchaseLine {
    purchaseLineId: string;
    canonicalSkuId: string;
    description: string;
    categoryCode: SupplyCategoryCode;
    unitSi: SupplyUnitSi;
    qtyPurchased: number;
    unitPriceNetClp: number;
    unitPriceGrossClp: number;
    subtotalNetClp: number;
    subtotalGrossClp: number;
    destination: SupplyLineDestination;
    isCapexAsset?: boolean;
    costCenter?: SupplyCostCenter;
    serialOrTag?: string;
    warrantyUntil?: string;
    opermaqAssetId?: string;
}

export interface SupplyPurchase {
    purchaseId: string;
    tenantId: string;
    siteId: string;
    buyerUid: string;
    buyerRole: SupplyOperationalRole;
    purchaseMode: PurchaseMode;
    authorizedByAuthority: boolean;
    supplierTaxId: string;
    supplierName: string;
    supplierId?: string;
    documentType: SiiDteType;
    folio: string;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
    paymentMethod: SupplyPaymentMethod;
    evidenceCasRef?: CasEvidenceRef;
    tedRawXml?: string;
    costCenter?: SupplyCostCenter;
    createdAt?: string;
    lines: SupplyPurchaseLine[];
}

export type FulfillmentAllocationType =
    | 'REQUISITION_MATCH'
    | 'UNSOLICITED_PURCHASE'
    | 'DIRECT_AUTONOMOUS';

export interface FulfillmentAllocation {
    allocationId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    purchaseLineId: string;
    canonicalSkuId: string;
    allocationType: FulfillmentAllocationType;
    requisitionId: string | null;
    requisitionLineId: string | null;
    qtyAllocated: number;
    unitSi: SupplyUnitSi;
    destination: SupplyLineDestination;
    costCenter: SupplyCostCenter;
    createdAt: string;
}

export interface SupplyAsset {
    assetId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    purchaseLineId: string;
    canonicalSkuId: string;
    name: string;
    serialOrTag?: string;
    acquisitionNetClp: number;
    vatCreditClp: number;
    grossPaidClp: number;
    depreciableBasisClp: number;
    usefulLifeYearsSii?: number;
    invoiceDteType: SiiDteType;
    invoiceFolio: string;
    supplierTaxId: string;
    evidenceCasRef?: CasEvidenceRef;
    missingInvoiceAlert: boolean;
    atypicalFlags: AtypicalFlagCode[];
    warrantyUntil?: string;
    opermaqAssetId?: string;
    createdAt: string;
}

export interface SiiDocumentRecord {
    siiDocId: string;
    tenantId: string;
    siteId: string;
    dedupeKey: string;
    supplierTaxId: string;
    supplierTaxIdFormatted: string;
    supplierName: string;
    receiverTaxId?: string;
    dteType: SiiDteType;
    folio: string;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    vatRecoverableClp: number;
    vatNonRecoverableClp: number;
    totalAmountClp: number;
    rcvAcceptanceDeadlineIso?: string;
    rcvDaysRemaining?: number;
    rcvUrgencyAlert: boolean;
    sourceFormat: 'XML_DTE' | 'TED_PDF417' | 'MANUAL_OR_OCR';
    tedVerified: boolean;
    atypicalFlags: AtypicalFlagCode[];
    arithmeticValid: boolean;
    arithmeticDeltaClp: number;
}

export interface SiiExpenseReport {
    reportId: string;
    tenantId: string;
    siteId: string;
    responsibleUid: string;
    periodLabel: string;
    paymentMethod: SupplyPaymentMethod;
    fundAdvanceClp: number;
    renderedTotalClp: number;
    balanceClp: number;
    balanceDisposition: 'SURPLUS_TO_RETURN' | 'REIMBURSEMENT_TO_BUYER' | 'BALANCED';
    documentIds: string[];
    status: 'DRAFT' | 'SUBMITTED' | 'RECONCILED' | 'CLOSED';
}

export interface StockLedgerEntry {
    entryId: string;
    tenantId: string;
    siteId: string;
    canonicalSkuId: string;
    movementType:
        | 'PURCHASE_IN_TRANSIT'
        | 'WAREHOUSE_RECEPTION'
        | 'DIRECT_WAREHOUSE_IN'
        | 'CONSUMPTION_OUT'
        | 'ADJUSTMENT';
    deltaInTransit: number;
    deltaInWarehouse: number;
    unitSi: SupplyUnitSi;
    unitCostNetClp: number;
    referenceId: string;
    costCenter: SupplyCostCenter;
    recordedAt: string;
}

export interface CashLedgerEntry {
    entryId: string;
    tenantId: string;
    siteId: string;
    purchaseId: string;
    paymentMethod: SupplyPaymentMethod;
    entryType:
        | 'EXPENSE_OPEX'
        | 'CAPEX_ACQUISITION'
        | 'FUND_ADVANCE'
        | 'REIMBURSEMENT_DUE'
        | 'SUPPLIER_PAYABLE';
    categoryCode: SupplyCategoryCode;
    netAmountClp: number;
    vatRecoverableClp: number;
    vatNonRecoverableClp: number;
    grossAmountClp: number;
    opexImpactClp: number;
    capexImpactClp: number;
    costCenter: SupplyCostCenter;
    dteType: SiiDteType;
    dedupeKey: string;
    recordedAt: string;
}

export interface Ds594WaterGuardrailEvaluation {
    requiredDailyLPerPax: number;
    altitudeFactorApplied: number;
    requiredReserveL: number;
    currentAvailableL: number;
    currentWarehouseL: number;
    currentInTransitL: number;
    coverageDays: number;
    compliant: boolean;
    deficitL: number;
    storageCapacitySufficient: boolean;
}

export interface DemandForecast {
    siteId: string;
    tenantId: string;
    canonicalSkuId: string;
    unitSi: SupplyUnitSi;
    ewmaDailyTotalSi: number;
    ewmaDailyPerPaxSi: number;
    currentHeadcount: number;
    currentWarehouseStockSi: number;
    currentInTransitStockSi: number;
    daysOfInventoryWarehouse: number;
    daysOfInventoryEffective: number;
    reorderPointSi: number;
    recommendedOrderQtySi: number;
    ds594WaterGuardrail?: Ds594WaterGuardrailEvaluation;
    computedAt: string;
}

/**
 * Señal agregada y estrictamente anónima para futuro Marketplace MINREPORT.
 * Cumplimiento Ley N° 21.719: alineada 1:1 con `DemandPoolSignalSchema.strict()`,
 * sin `tenantId`, sin `siteId`, sin coordenadas GPS, exigiendo opt-in explícito y k-anonimato (k >= 3).
 */
export interface DemandPoolSignal {
    signalId: string;
    districtCode: string;
    periodWindow: string;
    canonicalSkuId: string;
    skuName: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    aggregatedQty: number;
    participatingEntitiesCount: number;
    optInVerified: true;
    medianReferenceUnitClp?: number;
    generatedAt: string;
    expiresAt: string;
}

/**
 * Utilidad numérica pura para evitar ruido de punto flotante IEEE 754 en cantidades SI.
 */
export function roundSupplyQty(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 10000) / 10000;
}

/**
 * Utilidad numérica pura para montos en pesos chilenos (CLP entero sin decimales).
 */
export function roundClp(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value);
}
