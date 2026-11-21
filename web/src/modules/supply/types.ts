/**
 * MINREPORT · ABASTECIMIENTO — Canonical Frontend Types & Pure Formatting Helpers
 * 1:1 parity with `web/src/contracts/supply.contracts.ts` (#9) and `/api/supply/*`.
 */

export type SupplyDomainMode =
    | 'DEMAND'
    | 'WAREHOUSE'
    | 'PROCUREMENT'
    | 'FINANCE_RECON'
    | 'SII_EXPENSES'
    | 'FORECAST'
    | 'WHATSAPP_CHANNELS';

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

export type PurchaseLineDestination =
    | 'STOCK_IN_TRANSIT'
    | 'STOCK_IN_WAREHOUSE'
    | 'CAPEX_ASSET'
    | 'DIRECT_EXPENSE';

export type SiiDteType = 33 | 34 | 39 | 41 | 52 | 61 | 0;

export type PaymentMethod =
    | 'CAJA_CHICA'
    | 'FONDO_POR_RENDIR'
    | 'REEMBOLSO_GERENCIA'
    | 'TRANSFERENCIA'
    | 'TARJETA_CORPORATIVA'
    | 'CREDITO_PROVEEDOR'
    | 'EFECTIVO';

export type RequisitionUrgency = 'CRITICAL' | 'HIGH' | 'STANDARD' | 'PLANNED';

export type RequisitionLineStatus = 'OPEN' | 'PARTIAL' | 'FULFILLED' | 'CANCELLED';

export type RequisitionStatus = 'DRAFT' | 'OPEN' | 'PARTIAL' | 'FULFILLED' | 'CLOSED' | 'CANCELLED';

export type SiiDocumentRcvStatus =
    | 'PENDING_REVIEW'
    | 'PENDING_ACCEPTANCE'
    | 'ACCEPTED'
    | 'CLAIMED'
    | 'AUTO_ACCEPTED_8D'
    | 'NOT_APPLICABLE';

export type SiiExpenseReportStatus =
    | 'OPEN'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'REIMBURSED'
    | 'REJECTED'
    | 'CLOSED'
    | 'SETTLED';

export interface CasEvidenceRef {
    sha256: string;
    phashHex?: string;
    downloadUrl: string;
    storagePath?: string;
    mimeType: string;
    extension: string;
    originalFilename?: string;
    originalBytes: number;
    optimizedBytes: number;
    savingsRatio?: number;
    savingsPct: number;
    deduplicatedHit?: boolean;
    capturedAt?: string;
}

export interface SupplySite {
    siteId: string;
    tenantId: string;
    name: string;
    districtCode?: string;
    shiftPattern?: string;
    currentHeadcount: number;
    waterStorageCapacityL: number;
    ds594DailyWaterTargetLPerPax: number;
    leadTimeDays: number;
    altitudeM?: number;
    altitudeMeters?: number;
    monthlyBudgetClp?: number | null;
}

export interface CanonicalSupplySku {
    canonicalSkuId: string;
    name: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    baseUnitSi: SupplyUnitSi;
    unspscCode?: string;
    requiredSlots?: string[];
    isCapexAsset?: boolean;
    isControlled?: boolean;
    leySaco25kgApplied?: boolean;
}

export interface SupplyRequisitionLine {
    lineId: string;
    canonicalSkuId: string;
    rawDescription?: string;
    normalizedName?: string;
    name: string;
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
    urgency: RequisitionUrgency;
    estimatedUnitClp?: number;
    notes?: string;
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
    costCenter: string;
    linkedAssetId?: string | null;
    linkedPlanRef?: string | null;
    status: RequisitionStatus;
    lines: SupplyRequisitionLine[];
    createdAt: string;
    updatedAt?: string;
}

export interface ConsolidatedSourceRef {
    reqId: string;
    lineId: string;
    costCenter: string;
    requesterName?: string;
    demandOrigin?: SupplyDemandOrigin;
    qtyPending: number;
    urgency: RequisitionUrgency;
    atypicalFlags: AtypicalFlagCode[];
}

export interface ConsolidatedShoppingItem {
    canonicalSkuId: string;
    name: string;
    normalizedName?: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    totalQtyPending: number;
    priority: 'CRITICAL' | 'PARTIAL_PENDING' | 'STANDARD';
    highestUrgency?: RequisitionUrgency;
    hasPartialPending?: boolean;
    atypicalCount: number;
    atypicalFlags: AtypicalFlagCode[];
    estimatedClp?: number;
    sourceReqRefs: ConsolidatedSourceRef[];
}

export interface ConsolidatedShoppingBucketGroup {
    procurementBucket: ProcurementBucket;
    items: ConsolidatedShoppingItem[];
    totalLines: number;
    itemCount?: number;
    atypicalCount: number;
    estimatedClp: number;
    estimatedBucketClp?: number;
}

export interface SupplyPurchaseLineDraft {
    lineId: string;
    purchaseLineId?: string;
    canonicalSkuId?: string | null;
    rawDescription: string;
    normalizedName?: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket?: ProcurementBucket;
    qty: number;
    qtyPurchased?: number;
    qtyReceived?: number;
    unitSi: SupplyUnitSi;
    unitPriceClp: number;
    unitPriceNetClp?: number;
    unitPriceGrossClp?: number;
    subtotalClp: number;
    lineNetClp?: number;
    lineVatClp?: number;
    lineTotalClp?: number;
    destination: PurchaseLineDestination;
    costCenter?: string;
    isCapexAsset?: boolean;
    atypicalFlags?: AtypicalFlagCode[];
    matchedReqLineId?: string;
    matchedReqId?: string;
}

export interface SupplyPurchaseDraft {
    purchaseId?: string;
    siteId: string;
    purchaseMode: PurchaseMode;
    supplierTaxId: string;
    supplierName: string;
    documentType: SiiDteType;
    folio: string;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
    paymentMethod: PaymentMethod;
    evidenceCasRef?: CasEvidenceRef;
    tedRawXml?: string | null;
    arithmeticMismatch?: boolean;
    arithmeticDeltaClp?: number;
    duplicateDetected?: boolean;
    dedupeKey?: string;
    lines: SupplyPurchaseLineDraft[];
}

export interface SupplyPurchaseRecord extends SupplyPurchaseDraft {
    purchaseId: string;
    tenantId: string;
    buyerUid: string;
    buyerRole: SupplyOperationalRole;
    authorizedByAuthority?: boolean | string;
    receptionStatus?:
        | 'IN_TRANSIT'
        | 'PARTIALLY_RECEIVED'
        | 'RECEIVED_AT_SITE'
        | 'DIRECT_CONSUMED'
        | 'RECEIVED'
        | 'PARTIAL';
    createdAt: string;
}

export interface FulfillmentAllocationDraft {
    purchaseLineId: string;
    allocationKind: 'REQUISITION_MATCH' | 'UNSOLICITED_PURCHASE';
    requisitionId: string | null;
    requisitionLineId: string | null;
    qtyAllocated: number;
    unitSi: SupplyUnitSi;
    destination: PurchaseLineDestination;
    resultingRequisitionLineStatus: RequisitionLineStatus | null;
}

export interface SupplyInventoryItem {
    itemId: string;
    tenantId: string;
    siteId: string;
    canonicalSkuId: string;
    name: string;
    categoryCode: SupplyCategoryCode;
    unitSi: SupplyUnitSi;
    qtyInTransit: number;
    qtyInWarehouse: number;
    minSafetyQty: number;
    ewmaDailyRate: number;
    doiDays: number | null;
    pendingPurchaseIds?: string[];
    updatedAt?: string;
}

export interface SupplyAssetRecord {
    assetId: string;
    tenantId: string;
    siteId: string;
    name: string;
    serialOrTag?: string | null;
    categoryCode?: SupplyCategoryCode;
    acquisitionNetClp: number;
    vatCreditClp: number;
    invoiceDteType: SiiDteType;
    invoiceFolio: string;
    supplierTaxId: string;
    supplierName?: string;
    issueDate?: string;
    evidenceCasRef?: CasEvidenceRef;
    missingInvoiceAlert: boolean;
    warrantyUntil?: string | null;
    opermaqAssetId?: string | null;
    createdAt: string;
}

export interface SiiDocumentRecord {
    docId: string;
    tenantId: string;
    siteId?: string;
    purchaseId?: string | null;
    dedupeKey: string;
    supplierTaxId: string;
    supplierName: string;
    documentType: SiiDteType;
    folio: string;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
    paymentMethod: PaymentMethod;
    rcvDeadlineDate?: string | null;
    rcvDaysRemaining?: number | null;
    rcvStatus: SiiDocumentRcvStatus;
    isDuplicate?: boolean;
    expenseReportId?: string | null;
    evidenceCasRef?: CasEvidenceRef;
    createdAt: string;
}

export interface SiiExpenseReport {
    reportId: string;
    tenantId: string;
    siteId?: string;
    code: string;
    title: string;
    costCenter: string;
    holderName: string;
    holderUid?: string;
    periodLabel: string;
    paymentMethod: PaymentMethod;
    fundAdvanceClp: number;
    renderedTotalClp: number;
    balanceClp: number;
    documentCount: number;
    documentIds: string[];
    status: SiiExpenseReportStatus;
    createdAt: string;
}

export interface DemandForecastSummary {
    siteId: string;
    headcount: number;
    leadTimeDays: number;
    waterStoredL: number;
    waterDailyTargetL: number;
    waterRequiredLeadL: number;
    waterCoverageDays: number;
    waterCompliantDs594: boolean;
    dailyOpexPerPaxClp?: number;
    monthlyProjectedClp?: number;
}

export interface WhatsAppSimMessage {
    id: string;
    direction: 'INBOUND' | 'OUTBOUND';
    text: string;
    fsmState?: 'COLLECTING' | 'POLICY_CHECK' | 'SLOT_FILLING' | 'REVIEW_GATE' | 'COMMITTED' | 'CANCELLED';
    hardDeniedItems?: string[];
    atypicalFlags?: AtypicalFlagCode[];
    missingSlots?: string[];
    committedReqId?: string;
    timestamp: string;
}

export const PROCUREMENT_BUCKETS: ProcurementBucket[] = [
    'VERDULERIA',
    'SUPERMERCADO',
    'FERRETERIA',
    'REPUESTOS_OPERMAQ',
    'EPP_SEGURIDAD',
    'GAS_AGUA_COMBUSTIBLE',
    'MANTENCION_EQUIPAMIENTO',
];

export const SUPPLY_CATEGORIES: SupplyCategoryCode[] = [
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
];

export const SUPPLY_UNITS_SI: SupplyUnitSi[] = ['kg', 'L', 'un', 'par', 'm', 'm3', 'caja', 'bolsa'];

export const SII_DTE_TYPES: SiiDteType[] = [33, 34, 39, 41, 52, 61, 0];

export const PAYMENT_METHODS: PaymentMethod[] = [
    'CAJA_CHICA',
    'FONDO_POR_RENDIR',
    'REEMBOLSO_GERENCIA',
    'TRANSFERENCIA',
    'TARJETA_CORPORATIVA',
    'CREDITO_PROVEEDOR',
    'EFECTIVO',
];

export function formatClp(amount: number | undefined | null): string {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
    }).format(Math.round(amount));
}

export function formatCasBytes(bytes: number | undefined | null): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
}

export function computeSavingsPct(originalBytes: number, optimizedBytes: number): number {
    if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
    const raw = (1 - Math.max(0, optimizedBytes) / originalBytes) * 100;
    return Math.max(0, Math.round(raw * 10) / 10);
}

export function formatCasTelemetry(
    ref?: Pick<CasEvidenceRef, 'originalBytes' | 'optimizedBytes' | 'savingsPct'> | null
): string | null {
    if (!ref || ref.originalBytes <= 0) return null;
    const pct =
        typeof ref.savingsPct === 'number' && Number.isFinite(ref.savingsPct)
            ? ref.savingsPct
            : computeSavingsPct(ref.originalBytes, ref.optimizedBytes);
    return `ORIG: ${formatCasBytes(ref.originalBytes)} ➔ CAS: ${formatCasBytes(ref.optimizedBytes)} (-${pct.toFixed(1)}%)`;
}

export function computeRcvDaysRemaining(issueDate?: string): number | null {
    if (!issueDate) return null;
    const parsed = new Date(`${issueDate.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    const deadlineMs = parsed.getTime() + 8 * 24 * 60 * 60 * 1000;
    const nowUtc = new Date();
    const todayStart = Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate());
    return Math.ceil((deadlineMs - todayStart) / (24 * 60 * 60 * 1000));
}

export interface ParsedLocalTedHeader {
    supplierTaxId?: string;
    supplierName?: string;
    documentType?: SiiDteType;
    folio?: string;
    issueDate?: string;
    totalAmountClp?: number;
    firstItem?: string;
}

/**
 * Deterministic client-side preview parser for SII TED PDF417 or XML DTE payloads
 * before hitting `/api/supply/receipts/analyze`.
 */
export function parseLocalTedOrDteXml(rawXml: string): ParsedLocalTedHeader | null {
    const trimmed = String(rawXml || '').trim();
    if (!trimmed || !trimmed.includes('<')) return null;

    const readTag = (tag: string): string | undefined => {
        const rx = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
        const m = trimmed.match(rx);
        return m?.[1]?.trim();
    };

    const re = readTag('RE') || readTag('RUTEmisor');
    const tdRaw = readTag('TD') || readTag('TipoDTE');
    const folio = readTag('F') || readTag('Folio');
    const fe = readTag('FE') || readTag('FchEmis');
    const mntRaw = readTag('MNT') || readTag('MntTotal');
    const rzn = readTag('RznSoc') || readTag('RznSocEmisor');
    const it1 = readTag('IT1') || readTag('NmbItem');

    if (!re && !folio && !mntRaw) return null;

    const tdNum = tdRaw ? Number(tdRaw) : undefined;
    const validTd: SiiDteType | undefined =
        tdNum === 33 || tdNum === 34 || tdNum === 39 || tdNum === 41 || tdNum === 52 || tdNum === 61
            ? tdNum
            : undefined;
    const mntNum = mntRaw ? Number(mntRaw.replace(/[^\d.-]/g, '')) : undefined;

    return {
        supplierTaxId: re,
        supplierName: rzn,
        documentType: validTd,
        folio,
        issueDate: fe,
        totalAmountClp: typeof mntNum === 'number' && Number.isFinite(mntNum) ? mntNum : undefined,
        firstItem: it1,
    };
}
