import { coreAuthFetch } from '../../../core/network/coreAuthFetch';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { offlineStorage } from '../../../core/offline/OfflineStorage';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import type {
    StockLedgerEntry,
    SupplyReceptionDiscrepancy,
} from '../../../contracts/supply.contracts';
import {
    computeSavingsPct,
    type AtypicalFlagCode,
    type CanonicalSupplySku,
    type CasEvidenceRef,
    type ConfirmWarehouseReceptionV3Request,
    type ConsolidatedShoppingBucketGroup,
    type ConsolidatedShoppingItem,
    type CreateSupplyWarehouseRequest,
    type DemandForecastSummary,
    type FulfillmentAllocationDraft,
    type GrantTemporaryChannelRequest,
    type PaymentMethod,
    type ProcurementBucket,
    type PurchaseLineDestination,
    type PurchaseMode,
    type ReceiptAnalysisDraft,
    type ReceiptAnalysisSource,
    type ReceiptArithmeticCheckSummary,
    type RecordStockMovementRequest,
    type RequisitionUrgency,
    type SiiDocumentRcvStatus,
    type SiiDocumentRecord,
    type SiiDteType,
    type SiiExpenseReport,
    type SiiExpenseReportStatus,
    type StockLedgerMovementType,
    type SupplyAssetRecord,
    type SupplyBusinessUnitKpis,
    type SupplyCategoryCode,
    type SupplyConversationThread,
    type SupplyConversationTurn,
    type SupplyDemandNature,
    type SupplyDemandOrigin,
    type SupplyInventoryItem,
    type SupplyOperationalRole,
    type SupplyProfileViewRecord,
    type SupplyPurchaseDraft,
    type SupplyPurchaseLineDraft,
    type SupplyPurchaseReceptionStatus,
    type SupplyPurchaseRecord,
    type SupplyRequisition,
    type SupplyRequisitionLine,
    type SupplySite,
    type SupplyTankTelemetry,
    type SupplyUnitSi,
    type SupplyWarehouse,
    type SupplyWarehouseBalance,
    type SupplyWhatsAppChannelId,
    type TankCycleCountRequest,
    type TemporaryChannelGrant,
    type UpdateSupplyProfileChannelsRequest,
    type UpsertSupplyProfileRequest,
    type WhatsAppSimMessage,
} from '../types';

const SUPPLY_API_BASE = '/api/supply';

function isClientOffline(): boolean {
    if (!syncQueueEngine.isOnlineNow()) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return false;
}

function buildHeaders(tenantId?: string, jsonBody: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (jsonBody) headers['Content-Type'] = 'application/json';
    if (tenantId && tenantId.trim()) headers['X-Active-Account-Id'] = tenantId.trim();
    return headers;
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v).trim() !== '') {
            search.set(k, String(v));
        }
    }
    const qs = search.toString();
    return qs ? `?${qs}` : '';
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let parsed: unknown = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }

    if (!res.ok) {
        const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
        const rawMsg = obj?.error ?? obj?.message;
        const msg =
            typeof rawMsg === 'string' && rawMsg.trim().length > 0
                ? rawMsg
                : `HTTP ${res.status}`;
        throw new Error(msg);
    }

    return parsed as T;
}

function unwrapArray<T>(raw: unknown, ...keys: string[]): T[] {
    if (Array.isArray(raw)) return raw as T[];
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        for (const k of keys) {
            if (Array.isArray(obj[k])) return obj[k] as T[];
        }
        if (Array.isArray(obj.data)) return obj.data as T[];
        if (Array.isArray(obj.items)) return obj.items as T[];
    }
    return [];
}

function inferExtensionFromMime(mimeType: string): string {
    const lower = String(mimeType || '').toLowerCase();
    if (lower.includes('pdf')) return 'pdf';
    if (lower.includes('webp')) return 'webp';
    if (lower.includes('png')) return 'png';
    if (lower.includes('svg')) return 'svg';
    if (lower.includes('xml')) return 'xml';
    return 'jpg';
}

function normalizeRequisition(raw: Record<string, unknown>): SupplyRequisition {
    const rawLines = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : [];
    const lines: SupplyRequisitionLine[] = rawLines.map((l) => {
        const resolvedName = String(
            l.normalizedName || l.name || l.rawDescription || l.itemName || ''
        );
        return {
            ...(l as unknown as SupplyRequisitionLine),
            lineId: String(l.lineId || ''),
            canonicalSkuId: String(l.canonicalSkuId || resolvedName),
            rawDescription: String(l.rawDescription || resolvedName),
            normalizedName: resolvedName,
            name: resolvedName,
            atypicalFlags: Array.isArray(l.atypicalFlags)
                ? (l.atypicalFlags as AtypicalFlagCode[])
                : [],
        };
    });
    return {
        ...(raw as unknown as SupplyRequisition),
        lines,
    };
}

export function normalizePurchaseLineFromServer(
    raw: Record<string, unknown>
): SupplyPurchaseLineDraft {
    const id = String(
        raw.purchaseLineId || raw.lineId || `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );
    const qty = Number(raw.qtyPurchased ?? raw.qty ?? raw.quantity ?? 1) || 1;
    const total = Number(raw.lineTotalClp ?? raw.subtotalClp ?? 0) || 0;
    const unitGross =
        Number(raw.unitPriceGrossClp ?? raw.unitPriceClp ?? (qty > 0 ? Math.round(total / qty) : 0)) ||
        0;
    const desc = String(
        raw.rawDescription ||
            raw.description ||
            raw.normalizedName ||
            raw.name ||
            raw.itemName ||
            ''
    ).trim();

    return {
        lineId: id,
        purchaseLineId: id,
        canonicalSkuId: typeof raw.canonicalSkuId === 'string' ? raw.canonicalSkuId : undefined,
        rawDescription: desc,
        normalizedName: String(raw.normalizedName || desc),
        categoryCode: (raw.categoryCode as SupplyCategoryCode) || 'OTROS_OPERACIONAL',
        procurementBucket: raw.procurementBucket as ProcurementBucket | undefined,
        qty,
        qtyPurchased: qty,
        qtyReceived: Number(raw.qtyReceivedSoFar ?? raw.qtyReceived ?? 0) || 0,
        unitSi: (raw.unitSi as SupplyUnitSi) || 'un',
        unitPriceClp: unitGross,
        unitPriceNetClp: typeof raw.unitPriceNetClp === 'number' ? raw.unitPriceNetClp : undefined,
        unitPriceGrossClp: unitGross,
        subtotalClp: total,
        lineNetClp: typeof raw.lineNetClp === 'number' ? raw.lineNetClp : undefined,
        lineVatClp: typeof raw.lineVatClp === 'number' ? raw.lineVatClp : undefined,
        lineTotalClp: total,
        destination: (raw.destination as PurchaseLineDestination) || 'STOCK_IN_TRANSIT',
        costCenter: typeof raw.costCenter === 'string' ? raw.costCenter : undefined,
        isCapexAsset: Boolean(raw.isCapexAsset ?? raw.destination === 'CAPEX_ASSET'),
        atypicalFlags: Array.isArray(raw.atypicalFlags)
            ? (raw.atypicalFlags as AtypicalFlagCode[])
            : [],
    };
}

export function normalizePurchaseRecord(raw: Record<string, unknown>): SupplyPurchaseRecord {
    const rawReceptionStatus =
        typeof raw.receptionStatus === 'string' && raw.receptionStatus.trim().length > 0
            ? (raw.receptionStatus.trim() as SupplyPurchaseReceptionStatus)
            : undefined;
    return {
        ...(raw as unknown as SupplyPurchaseRecord),
        folio: String(raw.folio ?? ''),
        receptionStatus: rawReceptionStatus,
        lines: Array.isArray(raw.lines)
            ? (raw.lines as Record<string, unknown>[]).map(normalizePurchaseLineFromServer)
            : [],
    };
}

function mapReceiptExtractionSource(rawSource: unknown): ReceiptAnalysisSource | undefined {
    const upper = String(rawSource || '').trim().toUpperCase();
    if (!upper) return undefined;
    if (upper === 'XML_DTE') return 'XML_DTE';
    if (
        upper === 'TED_XML' ||
        upper === 'TED_PDF417' ||
        upper === 'TED_ONLY' ||
        upper === 'TED_PLUS_AI' ||
        upper === 'HYBRID_TED_OCR'
    ) {
        return 'TED_XML';
    }
    if (upper === 'OCR_GEMINI' || upper === 'AI_VISION_OCR' || upper === 'GEMINI_VISION_OCR') {
        return 'OCR_GEMINI';
    }
    return undefined;
}

export function normalizeReceiptAnalysisDraft(
    json: Record<string, unknown>,
    fallback?: Partial<AnalyzeReceiptRequest>
): ReceiptAnalysisDraft {
    const rawDraft = (json?.draft || json?.analysis || json?.data || json) as Record<
        string,
        unknown
    >;
    const rawLines = Array.isArray(rawDraft.lines)
        ? (rawDraft.lines as Record<string, unknown>[])
        : [];
    const normalizedLines = rawLines.map(normalizePurchaseLineFromServer);

    const rawCheck =
        rawDraft.arithmeticCheck && typeof rawDraft.arithmeticCheck === 'object'
            ? (rawDraft.arithmeticCheck as Record<string, unknown>)
            : null;
    const rawCheckValid =
        typeof rawCheck?.valid === 'boolean'
            ? rawCheck.valid
            : typeof rawCheck?.verified === 'boolean'
              ? rawCheck.verified
              : typeof rawDraft.arithmeticValid === 'boolean'
                ? rawDraft.arithmeticValid
                : undefined;
    const arithmeticDeltaClp =
        typeof rawCheck?.deltaClp === 'number'
            ? rawCheck.deltaClp
            : typeof rawDraft.arithmeticMismatchClp === 'number'
              ? rawDraft.arithmeticMismatchClp
              : typeof rawDraft.arithmeticDeltaClp === 'number'
                ? rawDraft.arithmeticDeltaClp
                : 0;
    const arithmeticMismatch =
        rawCheckValid !== undefined
            ? !rawCheckValid
            : Boolean(rawDraft.arithmeticMismatch || Math.abs(arithmeticDeltaClp) > 2);

    const linesSumClp =
        typeof rawCheck?.linesSumClp === 'number'
            ? rawCheck.linesSumClp
            : normalizedLines.reduce((acc, l) => acc + (Number(l.subtotalClp ?? l.lineTotalClp) || 0), 0);
    const totalAmountClp = Number(rawDraft.totalAmountClp ?? 0) || 0;
    const expectedTotalClp =
        typeof rawCheck?.expectedTotalClp === 'number' ? rawCheck.expectedTotalClp : totalAmountClp;
    const pricingBasis =
        rawCheck?.pricingBasis === 'GROSS' ||
        rawCheck?.pricingBasis === 'NET_PLUS_VAT' ||
        rawCheck?.pricingBasis === 'MISMATCH'
            ? rawCheck.pricingBasis
            : arithmeticMismatch
              ? 'MISMATCH'
              : 'GROSS';

    const arithmeticCheck: ReceiptArithmeticCheckSummary = {
        valid: !arithmeticMismatch,
        verified: !arithmeticMismatch,
        linesSumClp,
        expectedTotalClp,
        deltaClp: arithmeticDeltaClp,
        pricingBasis,
    };

    const supplierTaxIdValid =
        typeof rawDraft.supplierTaxIdValid === 'boolean'
            ? rawDraft.supplierTaxIdValid
            : typeof rawDraft.supplierRutValid === 'boolean'
              ? rawDraft.supplierRutValid
              : undefined;
    const duplicateDetected = Boolean(rawDraft.isDuplicate ?? rawDraft.duplicateDetected);
    const missingInvoiceAlert = Boolean(rawDraft.missingInvoiceAlert);
    const atypicalFlags = Array.isArray(rawDraft.atypicalFlags)
        ? (rawDraft.atypicalFlags as AtypicalFlagCode[])
        : [];
    const warnings = new Set<string>(
        Array.isArray(rawDraft.warnings)
            ? rawDraft.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
            : []
    );
    if (arithmeticMismatch) warnings.add('ARITHMETIC_MISMATCH');
    if (duplicateDetected) warnings.add('SII_DUPLICATE_DOCUMENT');
    if (missingInvoiceAlert) warnings.add('CAPEX_MISSING_INVOICE');
    if (supplierTaxIdValid === false) warnings.add('SUPPLIER_TAX_ID_INVALID');

    const rawSource = rawDraft.source ?? rawDraft.extractionSource;

    return {
        siteId: String(rawDraft.siteId || fallback?.siteId || ''),
        purchaseMode: (rawDraft.purchaseMode as PurchaseMode) || fallback?.purchaseMode || 'REQUISITION_FULFILLMENT',
        supplierTaxId: String(rawDraft.supplierTaxId || ''),
        supplierTaxIdValid,
        supplierName: String(rawDraft.supplierName || ''),
        documentType: Number(rawDraft.documentType ?? 39) as SiiDteType,
        folio: String(rawDraft.folio ?? ''),
        issueDate: String(rawDraft.issueDate || new Date().toISOString().slice(0, 10)),
        netAmountClp: Number(rawDraft.netAmountClp ?? 0) || 0,
        vatAmountClp: Number(rawDraft.vatAmountClp ?? 0) || 0,
        totalAmountClp,
        paymentMethod: (rawDraft.paymentMethod as PaymentMethod) || 'FONDO_POR_RENDIR',
        evidenceCasRef:
            (rawDraft.evidenceCasRef as CasEvidenceRef | undefined) || fallback?.evidenceCasRef,
        tedRawXml: typeof rawDraft.tedRawXml === 'string' ? rawDraft.tedRawXml : fallback?.tedRawXml,
        source: mapReceiptExtractionSource(rawSource),
        extractionSource: typeof rawSource === 'string' ? rawSource : undefined,
        arithmeticCheck,
        arithmeticMismatch,
        arithmeticDeltaClp,
        duplicateDetected,
        dedupeKey: typeof rawDraft.dedupeKey === 'string' ? rawDraft.dedupeKey : undefined,
        missingInvoiceAlert,
        atypicalFlags,
        warnings: Array.from(warnings),
        lines: normalizedLines,
    };
}

function serializePurchaseLineForApi(
    line: SupplyPurchaseLineDraft,
    documentType: SiiDteType
): Record<string, unknown> {
    const qty = Math.max(0.0001, Number(line.qtyPurchased ?? line.qty) || 1);
    const isTaxed = documentType === 33 || documentType === 39;
    const lineTotalClp = Math.max(
        0,
        Math.round(
            Number.isFinite(line.lineTotalClp)
                ? (line.lineTotalClp as number)
                : Number.isFinite(line.subtotalClp)
                  ? line.subtotalClp
                  : qty * (Number(line.unitPriceClp) || 0)
        )
    );
    const lineNetClp =
        typeof line.lineNetClp === 'number' && Number.isFinite(line.lineNetClp)
            ? Math.round(line.lineNetClp)
            : isTaxed
              ? Math.round(lineTotalClp / 1.19)
              : lineTotalClp;
    const lineVatClp =
        typeof line.lineVatClp === 'number' && Number.isFinite(line.lineVatClp)
            ? Math.round(line.lineVatClp)
            : isTaxed
              ? Math.max(0, lineTotalClp - lineNetClp)
              : 0;
    const unitPriceGrossClp =
        typeof line.unitPriceGrossClp === 'number' && Number.isFinite(line.unitPriceGrossClp)
            ? Math.round(line.unitPriceGrossClp)
            : Math.round(lineTotalClp / qty);
    const unitPriceNetClp =
        typeof line.unitPriceNetClp === 'number' && Number.isFinite(line.unitPriceNetClp)
            ? Math.round(line.unitPriceNetClp)
            : Math.round(lineNetClp / qty);
    const purchaseLineId = line.purchaseLineId || line.lineId;
    const rawDescription = (line.rawDescription || line.normalizedName || 'ITEM').trim();
    const normalizedName = (line.normalizedName || rawDescription).trim();
    const isCapexAsset = Boolean(line.isCapexAsset || line.destination === 'CAPEX_ASSET');
    const costCenter =
        line.costCenter?.trim() || (isCapexAsset ? 'CC-CAPEX' : 'CC-CAMPAMENTO');

    return {
        purchaseLineId,
        canonicalSkuId: line.canonicalSkuId || null,
        rawDescription,
        normalizedName,
        categoryCode: line.categoryCode,
        unitSi: line.unitSi,
        qtyPurchased: qty,
        qtyReceived:
            line.destination === 'STOCK_IN_WAREHOUSE' ? qty : Number(line.qtyReceived ?? 0) || 0,
        unitPriceNetClp,
        unitPriceGrossClp,
        lineNetClp,
        lineVatClp,
        lineTotalClp,
        destination: line.destination,
        costCenter,
        isCapexAsset,
        atypicalFlags: line.atypicalFlags || [],
    };
}

function normalizeConsolidatedBucket(raw: Record<string, unknown>): ConsolidatedShoppingBucketGroup {
    const rawItems = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
    const items: ConsolidatedShoppingItem[] = rawItems.map((it) => {
        const displayName = String(it.normalizedName || it.name || it.itemName || '');
        const highestUrgency = (it.highestUrgency || it.urgency || 'STANDARD') as RequisitionUrgency;
        const priority: ConsolidatedShoppingItem['priority'] =
            it.priority === 'CRITICAL' || highestUrgency === 'CRITICAL'
                ? 'CRITICAL'
                : it.priority === 'PARTIAL_PENDING' || Boolean(it.hasPartialPending)
                  ? 'PARTIAL_PENDING'
                  : 'STANDARD';
        return {
            canonicalSkuId: String(it.canonicalSkuId || displayName),
            name: displayName,
            normalizedName: displayName,
            categoryCode: (it.categoryCode as SupplyCategoryCode) || 'OTROS_OPERACIONAL',
            procurementBucket:
                (it.procurementBucket as ProcurementBucket) ||
                (raw.procurementBucket as ProcurementBucket),
            unitSi: (it.unitSi as SupplyUnitSi) || 'un',
            totalQtyPending: Number(it.totalQtyPending ?? 0) || 0,
            priority,
            highestUrgency,
            hasPartialPending: Boolean(it.hasPartialPending),
            atypicalCount: Number(it.atypicalCount ?? 0) || 0,
            atypicalFlags: Array.isArray(it.atypicalFlags)
                ? (it.atypicalFlags as AtypicalFlagCode[])
                : [],
            estimatedClp: Number(it.estimatedClp ?? 0) || 0,
            sourceReqRefs: Array.isArray(it.sourceReqRefs)
                ? (it.sourceReqRefs as ConsolidatedShoppingItem['sourceReqRefs'])
                : [],
        };
    });

    const totalLines = Number(raw.itemCount ?? raw.totalLines ?? items.length) || items.length;
    const estimatedClp =
        Number(
            raw.estimatedBucketClp ??
                raw.estimatedClp ??
                items.reduce((s, item) => s + (item.estimatedClp || 0), 0)
        ) || 0;

    return {
        procurementBucket: raw.procurementBucket as ProcurementBucket,
        items,
        totalLines,
        itemCount: totalLines,
        atypicalCount:
            Number(
                raw.atypicalCount ??
                    items.reduce(
                        (s, item) => s + (item.atypicalCount || item.atypicalFlags.length),
                        0
                    )
            ) || 0,
        estimatedClp,
        estimatedBucketClp: estimatedClp,
    };
}

export function normalizeInventoryItem(raw: Record<string, unknown>): SupplyInventoryItem {
    const itemId = String(raw.itemId || raw.inventoryKey || raw.canonicalSkuId || '');
    const qtyInTransit = Number(raw.qtyInTransit ?? 0) || 0;
    const qtyInWarehouse = Number(raw.qtyInWarehouse ?? raw.qtyOnHand ?? 0) || 0;
    const minSafetyQty = Number(raw.minSafetyStock ?? raw.minSafetyQty ?? 0) || 0;
    const ewmaDailyRate =
        Number(
            raw.ewmaDailyConsumption ??
                raw.ewmaDailyRatePerPax ??
                raw.ewmaDailyRate ??
                raw.dailyBurnRatePerPax ??
                0
        ) || 0;
    const doiDays =
        typeof raw.estimatedDoiDays === 'number'
            ? raw.estimatedDoiDays
            : typeof raw.doiDays === 'number'
              ? raw.doiDays
              : ewmaDailyRate > 0
                ? Number(((qtyInWarehouse + qtyInTransit) / ewmaDailyRate).toFixed(1))
                : null;

    return {
        itemId,
        inventoryKey: typeof raw.inventoryKey === 'string' ? raw.inventoryKey : itemId,
        tenantId: String(raw.tenantId || ''),
        siteId: String(raw.siteId || ''),
        canonicalSkuId: String(raw.canonicalSkuId || ''),
        name: String(raw.name || raw.normalizedName || raw.itemName || ''),
        categoryCode: (raw.categoryCode as SupplyCategoryCode) || 'OTROS_OPERACIONAL',
        procurementBucket: raw.procurementBucket as ProcurementBucket | undefined,
        unitSi: (raw.unitSi as SupplyUnitSi) || 'un',
        qtyInTransit,
        qtyInWarehouse,
        minSafetyQty,
        ewmaDailyRate,
        doiDays,
        avgUnitCostClp:
            typeof raw.avgUnitCostClp === 'number'
                ? raw.avgUnitCostClp
                : typeof raw.weightedAvgUnitCostClp === 'number'
                  ? raw.weightedAvgUnitCostClp
                  : undefined,
        pendingPurchaseIds: Array.isArray(raw.pendingPurchaseIds)
            ? (raw.pendingPurchaseIds as string[])
            : undefined,
        updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    };
}

function normalizeSiiDocument(raw: Record<string, unknown>): SiiDocumentRecord {
    const rawRcv = String(raw.rcvStatus || 'PENDING_REVIEW') as SiiDocumentRcvStatus;
    return {
        docId: String(raw.docId || raw.dedupeKey || ''),
        tenantId: String(raw.tenantId || ''),
        siteId: typeof raw.siteId === 'string' ? raw.siteId : undefined,
        purchaseId: typeof raw.purchaseId === 'string' ? raw.purchaseId : null,
        dedupeKey: String(raw.dedupeKey || ''),
        supplierTaxId: String(raw.emitterTaxId || raw.supplierTaxId || ''),
        supplierName: String(raw.emitterName || raw.supplierName || ''),
        documentType: (Number(raw.documentType ?? 39) as SiiDteType),
        folio: String(raw.folio ?? ''),
        issueDate: String(raw.issueDate || ''),
        netAmountClp: Number(raw.netAmountClp ?? 0) || 0,
        vatAmountClp: Number(raw.vatAmountClp ?? 0) || 0,
        totalAmountClp: Number(raw.totalAmountClp ?? 0) || 0,
        paymentMethod: (raw.paymentMethod as PaymentMethod) || 'TRANSFERENCIA',
        rcvDeadlineDate: typeof raw.rcvDeadlineDate === 'string' ? raw.rcvDeadlineDate : null,
        rcvDaysRemaining: typeof raw.rcvDaysRemaining === 'number' ? raw.rcvDaysRemaining : null,
        rcvStatus: rawRcv,
        isDuplicate: Boolean(raw.isDuplicate),
        expenseReportId: typeof raw.expenseReportId === 'string' ? raw.expenseReportId : null,
        evidenceCasRef: raw.evidenceCasRef as CasEvidenceRef | undefined,
        createdAt: String(raw.createdAt || ''),
    };
}

export function normalizeSiiExpenseReport(raw: Record<string, unknown>): SiiExpenseReport {
    const docIds = Array.isArray(raw.siiDocumentIds)
        ? (raw.siiDocumentIds as string[])
        : Array.isArray(raw.documentIds)
          ? (raw.documentIds as string[])
          : [];
    const title = String(raw.title || raw.code || raw.reportId || '');
    const code = String(raw.code || raw.title || raw.reportId || '');
    const rawStatus = String(raw.status || 'OPEN') as SiiExpenseReportStatus;
    const resolvedHolderName = String(raw.holderName || raw.custodianName || '');
    const resolvedHolderUid =
        typeof raw.holderUid === 'string'
            ? raw.holderUid
            : typeof raw.custodianUid === 'string'
              ? raw.custodianUid
              : undefined;
    const fundAdvanceClp = Number(raw.fundAdvanceClp ?? raw.advanceAmountClp ?? 0) || 0;
    const renderedTotalClp = Number(raw.renderedTotalClp ?? raw.totalRenderedClp ?? 0) || 0;
    const balanceClp =
        typeof raw.balanceClp === 'number'
            ? raw.balanceClp
            : typeof raw.balanceDueClp === 'number'
              ? raw.balanceDueClp
              : fundAdvanceClp - renderedTotalClp;

    return {
        reportId: String(raw.reportId || code),
        tenantId: String(raw.tenantId || ''),
        siteId: typeof raw.siteId === 'string' ? raw.siteId : undefined,
        code,
        title,
        costCenter: String(raw.costCenter || 'CC-CAMPAMENTO'),
        holderName: resolvedHolderName,
        holderUid: resolvedHolderUid,
        custodianName: resolvedHolderName,
        custodianUid: resolvedHolderUid,
        periodLabel: String(raw.periodLabel || ''),
        paymentMethod: (raw.paymentMethod as PaymentMethod) || 'FONDO_POR_RENDIR',
        fundAdvanceClp,
        renderedTotalClp,
        balanceClp,
        documentCount: Number(raw.documentCount ?? docIds.length) || docIds.length,
        documentIds: docIds,
        status: rawStatus,
        retentionUntil: typeof raw.retentionUntil === 'string' ? raw.retentionUntil : undefined,
        createdAt: String(raw.createdAt || ''),
    };
}

export function normalizeForecast(raw: Record<string, unknown>): DemandForecastSummary {
    const guardrail =
        raw.waterCoverageGuardrail && typeof raw.waterCoverageGuardrail === 'object'
            ? (raw.waterCoverageGuardrail as Record<string, unknown>)
            : null;
    const headcount = Number(raw.headcountBasis ?? raw.headcount ?? 0) || 0;
    const leadTimeDays = Number(raw.leadTimeDays ?? 7) || 7;
    const altitudeM = typeof raw.altitudeM === 'number' ? raw.altitudeM : 0;
    const altitudeMultiplier =
        Number(
            guardrail?.altitudeFactorApplied ??
                raw.altitudeMultiplier ??
                (altitudeM > 3000 ? 1.15 : 1)
        ) || 1;
    const ds594PerPax =
        Number(
            guardrail?.ds594TargetLPerPaxDay ??
                raw.ds594WaterTargetLPerPax ??
                raw.ds594DailyWaterTargetLPerPax ??
                120
        ) || 120;
    const waterStoredL =
        Number(
            guardrail?.availableWaterL ??
                raw.waterAvailableL ??
                raw.waterStorageCapacityL ??
                raw.waterStoredL ??
                0
        ) || 0;
    const waterDailyTargetL =
        Number(
            raw.dailyWaterRequirementL ??
                raw.waterDailyTargetL ??
                Math.round(headcount * ds594PerPax * altitudeMultiplier)
        ) || 0;
    const waterRequiredLeadL =
        Number(
            guardrail?.requiredWaterL ??
                raw.requiredWaterReserveL ??
                raw.waterRequiredLeadL ??
                Math.round(waterDailyTargetL * leadTimeDays)
        ) || 0;
    const waterCoverageDays =
        Number(
            guardrail?.coverageDays ??
                raw.waterCoverageDays ??
                (waterDailyTargetL > 0 ? Math.round((waterStoredL / waterDailyTargetL) * 10) / 10 : 0)
        ) || 0;
    const waterAlertLevel =
        raw.waterAlertLevel === 'CRITICAL' ||
        raw.waterAlertLevel === 'WARNING' ||
        raw.waterAlertLevel === 'NOMINAL'
            ? raw.waterAlertLevel
            : undefined;
    const waterCompliantDs594 =
        typeof guardrail?.compliant === 'boolean'
            ? guardrail.compliant
            : typeof raw.ds594Compliant === 'boolean'
              ? raw.ds594Compliant
              : typeof raw.waterCompliantDs594 === 'boolean'
                ? raw.waterCompliantDs594
                : waterAlertLevel !== undefined
                  ? waterAlertLevel === 'NOMINAL'
                  : waterRequiredLeadL > 0
                    ? waterStoredL >= waterRequiredLeadL
                    : true;

    const dailyOpexPerPaxClp =
        typeof raw.opexDailyPerPaxClp === 'number'
            ? raw.opexDailyPerPaxClp
            : typeof raw.dailyFoodOpexClpPerPax === 'number'
              ? raw.dailyFoodOpexClpPerPax
              : typeof raw.dailyOpexPerPaxClp === 'number'
                ? raw.dailyOpexPerPaxClp
                : undefined;
    const monthlyProjectedClp =
        typeof raw.projectedMonthlyOpexClp === 'number'
            ? raw.projectedMonthlyOpexClp
            : typeof raw.projectedOpexTotalClp === 'number'
              ? raw.projectedOpexTotalClp
              : typeof raw.monthlyProjectedClp === 'number'
                ? raw.monthlyProjectedClp
                : typeof dailyOpexPerPaxClp === 'number' && headcount > 0
                  ? Math.round(dailyOpexPerPaxClp * headcount * 30)
                  : undefined;

    return {
        siteId: String(raw.siteId || ''),
        headcount,
        leadTimeDays,
        altitudeM: typeof raw.altitudeM === 'number' ? raw.altitudeM : undefined,
        altitudeMultiplier,
        waterStoredL,
        waterDailyTargetL,
        waterRequiredLeadL,
        waterCoverageDays,
        waterCompliantDs594,
        waterAlertLevel,
        dailyOpexPerPaxClp,
        monthlyProjectedClp,
    };
}

export interface CreateRequisitionInput {
    siteId: string;
    costCenter: string;
    demandOrigin?: SupplyDemandOrigin;
    demandNature?: SupplyDemandNature;
    urgency?: RequisitionUrgency;
    lines: Array<{
        canonicalSkuId?: string;
        rawDescription: string;
        normalizedName?: string;
        categoryCode: SupplyCategoryCode;
        unitSi: SupplyUnitSi;
        qtyRequested: number;
        urgency?: RequisitionUrgency;
        notes?: string;
    }>;
}

export interface AnalyzeReceiptRequest {
    siteId: string;
    purchaseMode: PurchaseMode;
    defaultDestination?: PurchaseLineDestination;
    evidenceCasRef?: CasEvidenceRef;
    clientOriginalBytes?: number;
    tedRawXml?: string;
    xmlDteContent?: string;
    locale?: 'es' | 'en' | 'pt';
}

export interface CommitPurchaseRequest {
    draft: SupplyPurchaseDraft;
    allocations: FulfillmentAllocationDraft[];
    confirmationKeyword: 'ACTUALIZAR';
}

export interface ReceivedLineInput {
    purchaseLineId: string;
    qtyReceivedNow: number;
    notes?: string;
}

export interface CreateExpenseReportInput {
    siteId: string;
    title: string;
    costCenter: string;
    holderName: string;
    periodLabel: string;
    paymentMethod: PaymentMethod;
    fundAdvanceClp: number;
    siiDocumentIds?: string[];
    confirmationKeyword: 'ACTUALIZAR';
}

export interface WhatsAppSimulateInput {
    siteId?: string;
    phoneE164: string;
    simulateSenderRole: SupplyOperationalRole;
    text: string;
    resetSession?: boolean;
}

export interface WhatsAppSimulateResponse {
    replyText: string;
    fsmState?: WhatsAppSimMessage['fsmState'];
    hardDeniedItems?: string[];
    atypicalFlags?: WhatsAppSimMessage['atypicalFlags'];
    missingSlots?: string[];
    committedReqId?: string;
}

export function buildWhatsAppSimulateRequestPayload(
    input: WhatsAppSimulateInput
): Record<string, unknown> {
    const trimmedText = String(input.text || '').trim();
    const isResetIntent = Boolean(input.resetSession) || trimmedText.toLowerCase() === '/reset';
    return {
        phoneE164: input.phoneE164,
        siteId: input.siteId,
        // `supply.controller.ts` expone exclusivamente `POST /api/supply/whatsapp/simulate`;
        // traducir `/reset` o `resetSession: true` a `CANCELAR` limpia la sesión FSM sin crear un ítem ficticio.
        text: isResetIntent ? 'CANCELAR' : trimmedText,
        simulateSenderRole: input.simulateSenderRole,
        flushImmediately: true,
    };
}

export const supplyApi = {
    async listSites(tenantId?: string): Promise<SupplySite[]> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/sites`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<SupplySite>(json, 'sites');
    },

    async listCatalog(tenantId?: string): Promise<CanonicalSupplySku[]> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/catalog`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<CanonicalSupplySku>(json, 'catalog', 'skus');
    },

    async listRequisitions(
        params: { siteId?: string; status?: string; origin?: string } = {},
        tenantId?: string
    ): Promise<SupplyRequisition[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/requisitions${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<Record<string, unknown>>(json, 'requisitions').map(normalizeRequisition);
    },

    async createRequisition(
        input: CreateRequisitionInput,
        tenantId?: string
    ): Promise<{ requisition?: SupplyRequisition; queuedOffline?: boolean }> {
        const payload = {
            siteId: input.siteId,
            costCenter: input.costCenter,
            demandOrigin: input.demandOrigin || 'DESKTOP_MANUAL',
            demandNature: input.demandNature || 'REACTIVE_FIELD',
            lines: input.lines.map((l) => ({
                canonicalSkuId: l.canonicalSkuId || null,
                rawDescription: l.rawDescription,
                normalizedName: l.normalizedName || l.rawDescription,
                categoryCode: l.categoryCode,
                unitSi: l.unitSi,
                qtyRequested: l.qtyRequested,
                urgency: l.urgency || input.urgency || 'STANDARD',
            })),
        };

        if (isClientOffline()) {
            await syncQueueEngine.enqueueSupplyApiMutation(
                `${SUPPLY_API_BASE}/requisitions`,
                { ...payload, tenantId },
                'supply:requisition-synced',
                tenantId,
                'POST'
            );
            return { queuedOffline: true };
        }
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/requisitions`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const rawReq = (json?.requisition || json?.data || json) as Record<string, unknown>;
        return {
            requisition: normalizeRequisition(rawReq),
        };
    },

    async getConsolidatedShoppingLists(
        params: { siteId?: string; bucket?: string } = {},
        tenantId?: string
    ): Promise<ConsolidatedShoppingBucketGroup[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/shopping-lists/consolidated${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);

        // Support nested `json.consolidated.buckets` (#9 & #16) as well as flat `buckets`/`groups`/`lists`
        const consolidated =
            json?.consolidated && typeof json.consolidated === 'object'
                ? (json.consolidated as Record<string, unknown>)
                : null;
        const rawGroups = consolidated && Array.isArray(consolidated.buckets)
            ? (consolidated.buckets as Record<string, unknown>[])
            : unwrapArray<Record<string, unknown>>(json, 'buckets', 'groups', 'lists');

        if (rawGroups.length > 0 && rawGroups[0] && 'procurementBucket' in rawGroups[0]) {
            return rawGroups.map(normalizeConsolidatedBucket);
        }

        const flatItems = unwrapArray<Record<string, unknown>>(json, 'items');
        if (flatItems.length === 0) return [];
        const byBucket = new Map<string, Record<string, unknown>[]>();
        for (const item of flatItems) {
            const key = String(item.procurementBucket || 'SUPERMERCADO');
            const arr = byBucket.get(key) || [];
            arr.push(item);
            byBucket.set(key, arr);
        }
        return Array.from(byBucket.entries()).map(([procurementBucket, items]) =>
            normalizeConsolidatedBucket({ procurementBucket, items })
        );
    },

    /**
     * Pre-digests receipt photo, PDF or XML DTE through MINREPORT-MEDIA-DIGESTOR-CAS,
     * preserving true `clientOriginalBytes` and enforcing `TENANT_PRIVATE` isolation in `southamerica-west1`.
     * Supports explicit `XML_DTE_DOCUMENT` profile for Chilean SII `.xml` DTE files.
     */
    async digestEvidence(
        file: File | Blob,
        options: {
            tenantId?: string;
            filename?: string;
            profile?: 'IMAGE_FIELD_EVIDENCE' | 'PDF_HYBRID_OEM' | 'XML_DTE_DOCUMENT';
        } = {}
    ): Promise<CasEvidenceRef> {
        const rawSize = file.size;
        const resolvedFilename =
            options.filename || (file instanceof File ? file.name : 'evidence.bin');
        const lowerName = resolvedFilename.toLowerCase();
        const lowerMime = (file.type || '').toLowerCase();

        const isXml =
            options.profile === 'XML_DTE_DOCUMENT' ||
            lowerMime.includes('xml') ||
            lowerName.endsWith('.xml');

        if (isXml) {
            const xmlText =
                typeof file.text === 'function' ? await file.text() : await new Response(file).text();
            // Compactar únicamente espacios fuera de <TED>...</TED> para preservar la firma RSA-SHA1 del timbre
            const tedMatch = xmlText.match(/<TED\b[\s\S]*?<\/TED>/i);
            let compacted = xmlText.replace(/^\uFEFF/, '').trim();
            if (tedMatch) {
                const placeholder = '__MINREPORT_TED_PRESERVE_BLOCK__';
                compacted = compacted
                    .replace(tedMatch[0], placeholder)
                    .replace(/>\s+</g, '><')
                    .replace(placeholder, tedMatch[0]);
            } else {
                compacted = compacted.replace(/>\s+</g, '><');
            }
            const xmlBlob = new Blob([compacted], { type: 'application/xml' });
            const optimizedBytes = xmlBlob.size;
            const originalBytes = Math.max(rawSize, optimizedBytes);
            const sha256 = await mediaDigestorClient.computeSha256Hex(xmlBlob);
            const savingsPct = computeSavingsPct(originalBytes, optimizedBytes);
            const savingsRatio =
                originalBytes > 0
                    ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4)))
                    : 0;

            if (syncQueueEngine.isOnlineNow()) {
                try {
                    const preRes = await coreAuthFetch(
                        `/api/media/cas-preflight/${sha256}?scope=TENANT_PRIVATE`,
                        { method: 'GET', headers: buildHeaders(options.tenantId) }
                    );
                    if (preRes.ok) {
                        const preJson = (await preRes.json().catch(() => null)) as {
                            exists?: boolean;
                            descriptor?: Record<string, any>;
                        } | null;
                        if (preJson?.exists && preJson?.descriptor) {
                            const d = preJson.descriptor;
                            const dOrig = Math.max(originalBytes, Number(d.originalBytes || 0));
                            const dOpt = Number(d.optimizedBytes || optimizedBytes);
                            return {
                                sha256: String(d.sha256 || sha256),
                                downloadUrl: String(d.downloadUrl || `/api/media/blob/${sha256}`),
                                storagePath: typeof d.storagePath === 'string' ? d.storagePath : undefined,
                                mimeType: String(d.mimeType || 'application/xml'),
                                extension: String(d.extension || 'xml'),
                                originalFilename: resolvedFilename,
                                originalBytes: dOrig,
                                optimizedBytes: dOpt,
                                savingsRatio:
                                    typeof d.savingsRatio === 'number' ? d.savingsRatio : savingsRatio,
                                savingsPct:
                                    typeof d.savingsPct === 'number'
                                        ? d.savingsPct
                                        : computeSavingsPct(dOrig, dOpt),
                                deduplicatedHit: true,
                                capturedAt: String(d.createdAt || new Date().toISOString()),
                            };
                        }
                    }

                    const form = new FormData();
                    form.append('file', xmlBlob, resolvedFilename);
                    form.append('profile', 'XML_DTE_DOCUMENT');
                    form.append('scope', 'TENANT_PRIVATE');
                    form.append('clientOriginalBytes', String(originalBytes));

                    const upRes = await coreAuthFetch('/api/media/digest-upload', {
                        method: 'POST',
                        headers: buildHeaders(options.tenantId),
                        body: form,
                    });
                    if (upRes.ok) {
                        const upJson = (await upRes.json().catch(() => null)) as {
                            descriptor?: Record<string, any>;
                        } | null;
                        if (upJson?.descriptor) {
                            const d = upJson.descriptor;
                            const dOrig = Math.max(originalBytes, Number(d.originalBytes || 0));
                            const dOpt = Number(d.optimizedBytes || optimizedBytes);
                            return {
                                sha256: String(d.sha256 || sha256),
                                downloadUrl: String(d.downloadUrl || `/api/media/blob/${sha256}`),
                                storagePath: typeof d.storagePath === 'string' ? d.storagePath : undefined,
                                mimeType: String(d.mimeType || 'application/xml'),
                                extension: String(d.extension || 'xml'),
                                originalFilename: resolvedFilename,
                                originalBytes: dOrig,
                                optimizedBytes: dOpt,
                                savingsRatio:
                                    typeof d.savingsRatio === 'number' ? d.savingsRatio : savingsRatio,
                                savingsPct:
                                    typeof d.savingsPct === 'number'
                                        ? d.savingsPct
                                        : computeSavingsPct(dOrig, dOpt),
                                deduplicatedHit: Boolean(d.deduplicatedHit),
                                capturedAt: String(d.createdAt || new Date().toISOString()),
                            };
                        }
                    }
                } catch {
                    // Fallback offline CAS determinista sin perder trazabilidad de peso
                }
            }

            await offlineStorage
                .putCasBlob({
                    sha256,
                    blob: xmlBlob,
                    mimeType: 'application/xml',
                    profile: 'XML_DTE_DOCUMENT',
                    scope: 'TENANT_PRIVATE',
                    tenantId: options.tenantId,
                    filename: resolvedFilename,
                    originalBytes,
                    optimizedBytes,
                    updatedAt: Date.now(),
                })
                .catch(() => {});

            return {
                sha256,
                downloadUrl: `offline-cas://${sha256}.xml`,
                storagePath: `offline_cas/${sha256}.xml`,
                mimeType: 'application/xml',
                extension: 'xml',
                originalFilename: resolvedFilename,
                originalBytes,
                optimizedBytes,
                savingsRatio,
                savingsPct,
                deduplicatedHit: false,
                capturedAt: new Date().toISOString(),
            };
        }

        const isPdf =
            options.profile === 'PDF_HYBRID_OEM' ||
            lowerMime.includes('pdf') ||
            lowerName.endsWith('.pdf');

        const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(file, {
            profile: options.profile || (isPdf ? 'PDF_HYBRID_OEM' : 'IMAGE_FIELD_EVIDENCE'),
            scope: 'TENANT_PRIVATE',
            tenantId: options.tenantId,
            filename: resolvedFilename,
            clientOriginalBytes: rawSize,
        });

        const mimeType = descriptor.mimeType || digested.mimeType || (isPdf ? 'application/pdf' : 'image/webp');
        const extension =
            descriptor.extension || digested.extension || inferExtensionFromMime(mimeType);
        const originalBytes = Math.max(rawSize, descriptor.originalBytes || digested.originalBytes || 0);
        const optimizedBytes = descriptor.optimizedBytes || digested.optimizedBytes || 0;
        const savingsPct =
            typeof descriptor.savingsPct === 'number'
                ? descriptor.savingsPct
                : computeSavingsPct(originalBytes, optimizedBytes);
        const rawUrl = String(descriptor.downloadUrl || '');
        const safeDownloadUrl =
            rawUrl.startsWith('/api/media/') ||
            rawUrl.startsWith('https://') ||
            rawUrl.startsWith('offline-cas://')
                ? rawUrl
                : `offline-cas://${descriptor.sha256}.${extension}`;

        return {
            sha256: descriptor.sha256,
            phashHex: descriptor.phashHex || digested.phashHex,
            downloadUrl: safeDownloadUrl,
            storagePath: descriptor.storagePath,
            mimeType,
            extension,
            originalFilename: descriptor.originalFilename || options.filename,
            originalBytes,
            optimizedBytes,
            savingsRatio: descriptor.savingsRatio,
            savingsPct,
            deduplicatedHit: descriptor.deduplicatedHit,
            capturedAt: descriptor.createdAt || new Date().toISOString(),
        };
    },

    async digestReceiptMedia(
        file: File | Blob,
        options: {
            tenantId?: string;
            filename?: string;
            profile?: 'IMAGE_FIELD_EVIDENCE' | 'PDF_HYBRID_OEM' | 'XML_DTE_DOCUMENT';
        } = {}
    ): Promise<CasEvidenceRef> {
        return this.digestEvidence(file, options);
    },

    async analyzeReceipt(
        payload: AnalyzeReceiptRequest,
        tenantId?: string
    ): Promise<ReceiptAnalysisDraft> {
        const body = {
            siteId: payload.siteId,
            purchaseMode: payload.purchaseMode,
            defaultDestination: payload.defaultDestination || 'STOCK_IN_TRANSIT',
            evidenceCasRef: payload.evidenceCasRef,
            clientOriginalBytes: payload.clientOriginalBytes ?? payload.evidenceCasRef?.originalBytes,
            xmlDteContent: payload.xmlDteContent,
            tedRawXml: payload.tedRawXml,
            locale: payload.locale || 'es',
        };
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/receipts/analyze`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(body),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return normalizeReceiptAnalysisDraft(json, payload);
    },

    async listPurchases(
        params: { siteId?: string } = {},
        tenantId?: string
    ): Promise<SupplyPurchaseRecord[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/purchases${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<Record<string, unknown>>(json, 'purchases').map(normalizePurchaseRecord);
    },

    async commitPurchase(
        req: CommitPurchaseRequest,
        tenantId?: string
    ): Promise<{ purchase?: SupplyPurchaseRecord; queuedOffline?: boolean }> {
        const serializedLines = req.draft.lines.map((line) =>
            serializePurchaseLineForApi(line, req.draft.documentType)
        );

        const serializedAllocations = req.allocations.map((a) => ({
            purchaseLineId: a.purchaseLineId,
            allocationKind: a.allocationKind,
            requisitionId: a.requisitionId,
            requisitionLineId: a.requisitionLineId,
            qtyAllocated: a.qtyAllocated,
            unitSi: a.unitSi,
            destination: a.destination,
            resultingRequisitionLineStatus: a.resultingRequisitionLineStatus,
        }));

        const body = {
            siteId: req.draft.siteId,
            purchaseMode: req.draft.purchaseMode,
            supplierTaxId: req.draft.supplierTaxId,
            supplierName: req.draft.supplierName,
            documentType: req.draft.documentType,
            folio: String(req.draft.folio || '').trim(),
            issueDate: req.draft.issueDate,
            netAmountClp: Math.round(req.draft.netAmountClp),
            vatAmountClp: Math.round(req.draft.vatAmountClp),
            totalAmountClp: Math.round(req.draft.totalAmountClp),
            paymentMethod: req.draft.paymentMethod,
            evidenceCasRef: req.draft.evidenceCasRef,
            tedRawXml: req.draft.tedRawXml || null,
            lines: serializedLines,
            allocations: serializedAllocations,
            confirmationKeyword: req.confirmationKeyword,
            clientOriginalBytes: req.draft.evidenceCasRef?.originalBytes,
        };

        if (isClientOffline()) {
            // Stage 1: Ensure offline CAS blob uploads first on reconnect
            if (req.draft.evidenceCasRef?.sha256) {
                await syncQueueEngine.enqueueTask('CAS_MEDIA_UPLOAD', {
                    sha256: req.draft.evidenceCasRef.sha256,
                    module: 'supply',
                    scope: 'TENANT_PRIVATE',
                    profile: req.draft.evidenceCasRef.mimeType.includes('xml')
                        ? 'XML_DTE_DOCUMENT'
                        : req.draft.evidenceCasRef.mimeType.includes('pdf')
                          ? 'PDF_HYBRID_OEM'
                          : 'IMAGE_FIELD_EVIDENCE',
                    tenantId,
                    filename: req.draft.evidenceCasRef.originalFilename,
                });
            }
            // Stage 2: Drain purchase mutation via dedicated SUPPLY_PURCHASE_RECEIPT queue (CAS URL rewrite aware)
            await syncQueueEngine.enqueueSupplyPurchaseReceipt({
                endpoint: `${SUPPLY_API_BASE}/purchases`,
                method: 'POST',
                body: { ...body, tenantId },
                tenantId,
                siteId: req.draft.siteId,
                sha256: req.draft.evidenceCasRef?.sha256,
                eventName: 'supply:purchase-synced',
            });
            return { queuedOffline: true };
        }

        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/purchases`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(body),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            purchase: (json?.purchase || json?.data || json) as SupplyPurchaseRecord,
        };
    },

    async confirmPurchaseReception(
        purchaseId: string,
        receivedLines: ReceivedLineInput[],
        confirmationKeyword: 'ACTUALIZAR',
        tenantId?: string
    ): Promise<{
        purchase?: SupplyPurchaseRecord;
        receptionOutcome?: 'RECEIVED_OK' | 'PARTIAL_DISCREPANCY';
        receivedItemCount?: number;
        queuedOffline?: boolean;
    }> {
        const endpoint = `${SUPPLY_API_BASE}/purchases/${encodeURIComponent(purchaseId)}/confirm-reception`;
        const payload = {
            receivedLines: receivedLines.map((rl) => ({
                purchaseLineId: rl.purchaseLineId,
                qtyReceivedNow: rl.qtyReceivedNow,
                notes: rl.notes,
            })),
            confirmationKeyword,
        };
        if (isClientOffline()) {
            await syncQueueEngine.enqueueSupplyApiMutation(
                endpoint,
                { ...payload, tenantId },
                'supply:reception-synced',
                tenantId,
                'POST'
            );
            return { queuedOffline: true };
        }
        const res = await coreAuthFetch(endpoint, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const rawPurchase =
            json?.purchase && typeof json.purchase === 'object'
                ? (json.purchase as Record<string, unknown>)
                : null;
        const receptionOutcome =
            json?.receptionOutcome === 'PARTIAL_DISCREPANCY' ||
            json?.receptionOutcome === 'RECEIVED_OK'
                ? json.receptionOutcome
                : undefined;
        return {
            purchase: rawPurchase ? normalizePurchaseRecord(rawPurchase) : undefined,
            receptionOutcome,
            receivedItemCount:
                typeof json?.receivedItemCount === 'number' ? json.receivedItemCount : undefined,
        };
    },

    async listInventory(
        params: { siteId?: string } = {},
        tenantId?: string
    ): Promise<SupplyInventoryItem[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/inventory${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<Record<string, unknown>>(json, 'inventory', 'stock').map(
            normalizeInventoryItem
        );
    },

    async listAssets(
        params: { siteId?: string } = {},
        tenantId?: string
    ): Promise<SupplyAssetRecord[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/assets${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<SupplyAssetRecord>(json, 'assets');
    },

    async linkAssetToOpermaq(
        assetId: string,
        confirmationKeyword: 'ACTUALIZAR',
        tenantId?: string,
        options: { opermaqAssetId?: string; createOpermaqFleetUnit?: boolean } = {}
    ): Promise<{ opermaqAssetId?: string; queuedOffline?: boolean }> {
        const endpoint = `${SUPPLY_API_BASE}/assets/${encodeURIComponent(assetId)}/link-opermaq`;
        const payload = {
            opermaqAssetId: options.opermaqAssetId,
            createOpermaqFleetUnit: options.createOpermaqFleetUnit ?? !options.opermaqAssetId,
            confirmationKeyword,
        };
        if (isClientOffline()) {
            await syncQueueEngine.enqueueSupplyApiMutation(
                endpoint,
                { ...payload, tenantId },
                'supply:opermaq-link-synced',
                tenantId,
                'POST'
            );
            return { queuedOffline: true };
        }
        const res = await coreAuthFetch(endpoint, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            opermaqAssetId:
                typeof json?.opermaqAssetId === 'string'
                    ? json.opermaqAssetId
                    : typeof (json?.asset as Record<string, unknown> | undefined)?.opermaqAssetId ===
                        'string'
                      ? String((json.asset as Record<string, unknown>).opermaqAssetId)
                      : undefined,
        };
    },

    async getForecast(
        params: { siteId?: string } = {},
        tenantId?: string
    ): Promise<DemandForecastSummary | null> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/forecast${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const firstFromArray =
            Array.isArray(json?.forecasts) && json.forecasts.length > 0
                ? (json.forecasts[0] as Record<string, unknown>)
                : null;
        const rawSummary = (firstFromArray ||
            json?.forecast ||
            json?.summary ||
            json?.data ||
            json) as Record<string, unknown> | null;
        if (!rawSummary || typeof rawSummary !== 'object') return null;
        return normalizeForecast(rawSummary);
    },

    async listSiiDocuments(
        params: { siteId?: string; dteType?: string } = {},
        tenantId?: string
    ): Promise<SiiDocumentRecord[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/sii/documents${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<Record<string, unknown>>(json, 'documents', 'siiDocuments').map(
            normalizeSiiDocument
        );
    },

    async listSiiExpenseReports(
        params: { siteId?: string } = {},
        tenantId?: string
    ): Promise<SiiExpenseReport[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/sii/expense-reports${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<unknown>(res);
        return unwrapArray<Record<string, unknown>>(json, 'reports', 'expenseReports').map(
            normalizeSiiExpenseReport
        );
    },

    async createSiiExpenseReport(
        input: CreateExpenseReportInput,
        tenantId?: string
    ): Promise<SiiExpenseReport & { queuedOffline?: boolean }> {
        const body = {
            siteId: input.siteId,
            title: input.title,
            costCenter: input.costCenter,
            holderName: input.holderName,
            periodLabel: input.periodLabel,
            paymentMethod: input.paymentMethod,
            fundAdvanceClp: Math.round(input.fundAdvanceClp),
            siiDocumentIds: input.siiDocumentIds || [],
            confirmationKeyword: input.confirmationKeyword,
        };
        if (isClientOffline()) {
            await syncQueueEngine.enqueueSupplyApiMutation(
                `${SUPPLY_API_BASE}/sii/expense-reports`,
                { ...body, tenantId },
                'supply:sii-expense-report-synced',
                tenantId,
                'POST'
            );
            return {
                ...normalizeSiiExpenseReport({
                    reportId: `offline_rep_${Date.now()}`,
                    tenantId: tenantId || '',
                    siteId: body.siteId,
                    code: body.title,
                    title: body.title,
                    costCenter: body.costCenter,
                    holderName: body.holderName,
                    periodLabel: body.periodLabel,
                    paymentMethod: body.paymentMethod,
                    fundAdvanceClp: body.fundAdvanceClp,
                    renderedTotalClp: 0,
                    siiDocumentIds: body.siiDocumentIds,
                    status: 'OPEN',
                    createdAt: new Date().toISOString(),
                }),
                queuedOffline: true,
            };
        }
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/sii/expense-reports`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(body),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const rawReport = (json?.report || json?.expenseReport || json?.data || json) as Record<
            string,
            unknown
        >;
        return normalizeSiiExpenseReport(rawReport);
    },

    async createExpenseReport(
        input: CreateExpenseReportInput,
        tenantId?: string
    ): Promise<SiiExpenseReport & { queuedOffline?: boolean }> {
        return this.createSiiExpenseReport(input, tenantId);
    },

    async updateExpenseReportStatus(
        reportId: string,
        status: SiiExpenseReportStatus,
        confirmationKeyword: 'ACTUALIZAR',
        tenantId?: string
    ): Promise<{ report?: SiiExpenseReport; queuedOffline?: boolean }> {
        const endpoint = `${SUPPLY_API_BASE}/sii/expense-reports/${encodeURIComponent(reportId)}`;
        const body = { status, confirmationKeyword };
        if (isClientOffline()) {
            await syncQueueEngine.enqueueSupplyApiMutation(
                endpoint,
                { ...body, tenantId },
                'supply:sii-expense-report-status-synced',
                tenantId,
                'PATCH'
            );
            return { queuedOffline: true };
        }
        const res = await coreAuthFetch(endpoint, {
            method: 'PATCH',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(body),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const rawReport = (json?.report || json?.expenseReport || json?.data || json) as Record<
            string,
            unknown
        >;
        return {
            report: rawReport ? normalizeSiiExpenseReport(rawReport) : undefined,
        };
    },

    async exportSiiCsv(
        params: { siteId?: string; period?: string } = {},
        tenantId?: string
    ): Promise<void> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/sii/export${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `minreport-sii-rcv-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } finally {
            URL.revokeObjectURL(url);
        }
    },

    async simulateWhatsAppMessage(
        input: WhatsAppSimulateInput,
        tenantId?: string
    ): Promise<WhatsAppSimulateResponse> {
        const body = buildWhatsAppSimulateRequestPayload(input);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/whatsapp/simulate`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(body),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const outcome =
            json?.outcome && typeof json.outcome === 'object'
                ? (json.outcome as Record<string, unknown>)
                : null;
        const src = outcome || json;

        const replyText = String(
            json?.replyText ??
                outcome?.replyText ??
                outcome?.outboundText ??
                src?.reply ??
                src?.message ??
                ''
        );
        const fsmState = (json?.fsmState ??
            outcome?.fsmState ??
            outcome?.nextState ??
            src?.state) as WhatsAppSimMessage['fsmState'];
        const hardDeniedItems = Array.isArray(json?.hardDeniedItems)
            ? (json.hardDeniedItems as string[])
            : Array.isArray(outcome?.hardDeniedItems)
              ? (outcome.hardDeniedItems as string[])
              : undefined;
        const atypicalFlags = Array.isArray(json?.atypicalFlags)
            ? (json.atypicalFlags as WhatsAppSimMessage['atypicalFlags'])
            : Array.isArray(outcome?.atypicalFlags)
              ? (outcome.atypicalFlags as WhatsAppSimMessage['atypicalFlags'])
              : undefined;
        const missingSlots = Array.isArray(json?.missingSlots)
            ? (json.missingSlots as string[])
            : Array.isArray(outcome?.missingSlots)
              ? (outcome.missingSlots as string[])
              : undefined;
        const committedReqId =
            typeof json?.committedReqId === 'string'
                ? json.committedReqId
                : typeof outcome?.committedReqId === 'string'
                  ? outcome.committedReqId
                  : typeof outcome?.reqId === 'string'
                    ? outcome.reqId
                    : undefined;

        return {
            replyText,
            fsmState,
            hardDeniedItems,
            atypicalFlags,
            missingSlots,
            committedReqId,
        };
    },

    async listSupplyProfiles(
        params: { atIso?: string } = {},
        tenantId?: string
    ): Promise<SupplyProfileViewRecord[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/profiles${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return unwrapArray<Record<string, unknown>>(json, 'profiles').map(normalizeSupplyProfileView);
    },

    async upsertSupplyProfile(
        payload: UpsertSupplyProfileRequest,
        tenantId?: string
    ): Promise<SupplyProfileViewRecord> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/profiles`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return normalizeSupplyProfileMutationResponse(json);
    },

    async updateSupplyProfileChannels(
        profileId: string,
        payload: UpdateSupplyProfileChannelsRequest,
        tenantId?: string
    ): Promise<SupplyProfileViewRecord> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/profiles/${encodeURIComponent(profileId)}/channels`,
            {
                method: 'PATCH',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify(payload),
            }
        );
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return normalizeSupplyProfileMutationResponse(json);
    },

    async grantTemporarySupplyChannel(
        profileId: string,
        payload: GrantTemporaryChannelRequest,
        tenantId?: string
    ): Promise<SupplyProfileViewRecord> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/profiles/${encodeURIComponent(profileId)}/temporary-grants`,
            {
                method: 'POST',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify(payload),
            }
        );
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return normalizeSupplyProfileMutationResponse(json);
    },

    async revokeTemporarySupplyChannel(
        profileId: string,
        grantItemId: string,
        confirmationKeyword: 'ACTUALIZAR',
        tenantId?: string
    ): Promise<SupplyProfileViewRecord> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/profiles/${encodeURIComponent(profileId)}/temporary-grants/${encodeURIComponent(grantItemId)}`,
            {
                method: 'DELETE',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify({ confirmationKeyword }),
            }
        );
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return normalizeSupplyProfileMutationResponse(json);
    },

    async confirmSupplyProfileOptIn(
        profileId: string,
        action: 'CONFIRM' | 'REVOKE_STOP',
        confirmationKeyword: 'ACTUALIZAR',
        tenantId?: string
    ): Promise<SupplyProfileViewRecord> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/profiles/${encodeURIComponent(profileId)}/opt-in/confirm`,
            {
                method: 'POST',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify({ action, confirmationKeyword }),
            }
        );
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return normalizeSupplyProfileMutationResponse(json);
    },

    async listSupplyConversationThreads(
        params: { profileId?: string; channelId?: SupplyWhatsAppChannelId; limit?: number } = {},
        tenantId?: string
    ): Promise<SupplyConversationThread[]> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/conversations${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return unwrapArray<SupplyConversationThread>(json, 'threads');
    },

    async listSupplyConversationTurns(
        threadId: string,
        params: { limit?: number } = {},
        tenantId?: string
    ): Promise<SupplyConversationTurnsResponse> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/conversations/${encodeURIComponent(threadId)}/turns${qs}`,
            {
                method: 'GET',
                headers: buildHeaders(tenantId),
            }
        );
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const rawChain =
            json?.chainVerification && typeof json.chainVerification === 'object'
                ? (json.chainVerification as Record<string, unknown>)
                : {};
        const turns = unwrapArray<SupplyConversationTurn>(json, 'turns');
        return {
            thread: json.thread as SupplyConversationThread,
            turns,
            chainVerification: {
                valid: rawChain.valid !== false,
                turnCount:
                    typeof rawChain.turnCount === 'number' ? rawChain.turnCount : turns.length,
                brokenAtSeq:
                    typeof rawChain.brokenAtSeq === 'number' ? rawChain.brokenAtSeq : undefined,
                reason: typeof rawChain.reason === 'string' ? rawChain.reason : undefined,
            },
        };
    },

    async exportSupplyConversation(
        threadId: string,
        format: 'JSON' | 'CSV',
        tenantId?: string
    ): Promise<SupplyConversationExportResult> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/conversations/${encodeURIComponent(threadId)}/export`,
            {
                method: 'POST',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify({ format }),
            }
        );
        const headerSha = res.headers.get('X-Content-SHA256') || '';
        const contentType = res.headers.get('Content-Type') || '';
        if (format === 'CSV' || contentType.toLowerCase().includes('text/csv')) {
            if (!res.ok) {
                const errText = await res.text();
                let parsedErr: Record<string, unknown> | null = null;
                try {
                    parsedErr = errText ? (JSON.parse(errText) as Record<string, unknown>) : null;
                } catch {
                    parsedErr = null;
                }
                const msg =
                    typeof parsedErr?.error === 'string' && parsedErr.error.trim()
                        ? parsedErr.error
                        : `HTTP ${res.status}`;
                throw new Error(msg);
            }
            const bodyText = await res.text();
            return {
                format: 'CSV',
                filename: `${threadId}.csv`,
                sha256: headerSha,
                bodyText,
            };
        }

        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const sha256 =
            typeof json?.sha256 === 'string' && json.sha256.trim()
                ? json.sha256.trim()
                : headerSha;
        const payload = json?.payload ?? json;
        return {
            format: 'JSON',
            filename:
                typeof json?.filename === 'string' && json.filename.trim()
                    ? json.filename
                    : `${threadId}.json`,
            sha256,
            turnCount: typeof json?.turnCount === 'number' ? json.turnCount : undefined,
            chainVerification:
                json?.chainVerification && typeof json.chainVerification === 'object'
                    ? (json.chainVerification as SupplyConversationChainVerification)
                    : undefined,
            bodyText: JSON.stringify(payload, null, 2),
            payload,
        };
    },

    async listSupplyWarehouses(
        params: { siteId?: string; limit?: number } = {},
        tenantId?: string
    ): Promise<SupplyWarehouseListResult> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/warehouses${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            warehouses: unwrapArray<SupplyWarehouse>(json, 'warehouses'),
            balances: unwrapArray<SupplyWarehouseBalance>(json, 'balances'),
        };
    },

    async createSupplyWarehouse(
        payload: CreateSupplyWarehouseRequest,
        tenantId?: string
    ): Promise<SupplyWarehouse> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/warehouses`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return (json?.warehouse || json) as SupplyWarehouse;
    },

    async listSupplyKardex(
        params: {
            siteId?: string;
            warehouseId?: string;
            canonicalSkuId?: string;
            movementType?: StockLedgerMovementType;
            limit?: number;
        } = {},
        tenantId?: string
    ): Promise<SupplyKardexListResult> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/kardex${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            entries: unwrapArray<StockLedgerEntry>(json, 'entries'),
            balances: unwrapArray<SupplyWarehouseBalance>(json, 'balances'),
            tankTelemetry: unwrapArray<SupplyTankTelemetry>(json, 'tankTelemetry'),
        };
    },

    async recordSupplyKardexMovement(
        payload: RecordStockMovementRequest | TankCycleCountRequest,
        tenantId?: string
    ): Promise<Record<string, unknown>> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/kardex`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        return parseJsonResponse<Record<string, unknown>>(res);
    },

    async confirmWarehouseReceptionV3(
        payload: ConfirmWarehouseReceptionV3Request,
        tenantId?: string
    ): Promise<ConfirmWarehouseReceptionV3Result> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/warehouses/receptions`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            purchase: (json?.purchase as SupplyPurchaseRecord) || undefined,
            receptionOutcome:
                String(json?.receptionOutcome || 'RECEIVED_OK') === 'PARTIAL_OR_DISCREPANCY'
                    ? 'PARTIAL_OR_DISCREPANCY'
                    : 'RECEIVED_OK',
            receivedItemCount: Number(json?.receivedItemCount ?? 0) || 0,
            affectedRequisitionIds: Array.isArray(json?.affectedRequisitionIds)
                ? (json.affectedRequisitionIds as string[])
                : [],
            discrepancies: unwrapArray<SupplyReceptionDiscrepancy>(json, 'discrepancies'),
            urgentRcvAlert: Boolean(json?.urgentRcvAlert),
            suggestCreditNote61: Boolean(json?.suggestCreditNote61),
        };
    },

    async getSupplyBusinessUnitKpis(
        params: { siteId?: string; periodDays?: number; tonnage?: number } = {},
        tenantId?: string
    ): Promise<SupplyBusinessUnitKpis | null> {
        const qs = buildQuery(params);
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/kpis${qs}`, {
            method: 'GET',
            headers: buildHeaders(tenantId),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        if (!json?.kpis || typeof json.kpis !== 'object') return null;
        return json.kpis as SupplyBusinessUnitKpis;
    },
};

export interface SupplyWarehouseListResult {
    warehouses: SupplyWarehouse[];
    balances: SupplyWarehouseBalance[];
}

export interface SupplyKardexListResult {
    entries: StockLedgerEntry[];
    balances: SupplyWarehouseBalance[];
    tankTelemetry: SupplyTankTelemetry[];
}

export interface ConfirmWarehouseReceptionV3Result {
    purchase?: SupplyPurchaseRecord;
    receptionOutcome: 'RECEIVED_OK' | 'PARTIAL_OR_DISCREPANCY';
    receivedItemCount: number;
    affectedRequisitionIds: string[];
    discrepancies: SupplyReceptionDiscrepancy[];
    urgentRcvAlert: boolean;
    suggestCreditNote61: boolean;
}

export interface SupplyConversationChainVerification {
    valid: boolean;
    turnCount: number;
    brokenAtSeq?: number;
    reason?: string;
}

export interface SupplyConversationTurnsResponse {
    thread: SupplyConversationThread;
    turns: SupplyConversationTurn[];
    chainVerification: SupplyConversationChainVerification;
}

export interface SupplyConversationExportResult {
    format: 'JSON' | 'CSV';
    filename: string;
    sha256: string;
    turnCount?: number;
    chainVerification?: SupplyConversationChainVerification;
    bodyText: string;
    payload?: unknown;
}

function normalizeSupplyProfileView(raw: Record<string, unknown>): SupplyProfileViewRecord {
    const temporaryGrants = Array.isArray(raw.temporaryGrants)
        ? (raw.temporaryGrants as TemporaryChannelGrant[])
        : [];
    const activeTemporaryGrants = Array.isArray(raw.activeTemporaryGrants)
        ? (raw.activeTemporaryGrants as TemporaryChannelGrant[])
        : [];
    const permanentChannels = Array.isArray(raw.permanentChannels)
        ? (raw.permanentChannels as SupplyWhatsAppChannelId[])
        : [];
    const effectiveChannels = Array.isArray(raw.effectiveChannels)
        ? (raw.effectiveChannels as SupplyWhatsAppChannelId[])
        : permanentChannels;
    const allowedSiteIds = Array.isArray(raw.allowedSiteIds)
        ? (raw.allowedSiteIds as string[])
        : [];
    const effectiveAllowedSiteIds = Array.isArray(raw.effectiveAllowedSiteIds)
        ? (raw.effectiveAllowedSiteIds as string[])
        : allowedSiteIds;
    const maxAmountClp = Number(raw.maxAmountClp ?? 500_000) || 0;
    const effectiveMaxAmountClp =
        typeof raw.effectiveMaxAmountClp === 'number'
            ? raw.effectiveMaxAmountClp
            : maxAmountClp;

    return {
        ...(raw as unknown as SupplyProfileViewRecord),
        permanentChannels,
        temporaryGrants,
        effectiveChannels,
        activeTemporaryGrants,
        expiredTemporaryGrantsCount:
            typeof raw.expiredTemporaryGrantsCount === 'number'
                ? raw.expiredTemporaryGrantsCount
                : Math.max(0, temporaryGrants.length - activeTemporaryGrants.length),
        allowedSiteIds,
        allowedWarehouseIds: Array.isArray(raw.allowedWarehouseIds)
            ? (raw.allowedWarehouseIds as string[])
            : [],
        maxAmountClp,
        effectiveMaxAmountClp,
        effectiveAllowedSiteIds,
        hasValidDgmnLicense: Boolean(raw.hasValidDgmnLicense),
        whatsappDispatchAllowed: Boolean(raw.whatsappDispatchAllowed),
    };
}

function normalizeSupplyProfileMutationResponse(
    json: Record<string, unknown>
): SupplyProfileViewRecord {
    const profileObj =
        json?.profile && typeof json.profile === 'object'
            ? (json.profile as Record<string, unknown>)
            : json;
    return normalizeSupplyProfileView({
        ...profileObj,
        effectiveChannels: json?.effectiveChannels ?? profileObj.effectiveChannels,
        activeTemporaryGrants: json?.activeTemporaryGrants ?? profileObj.activeTemporaryGrants,
        hasValidDgmnLicense: json?.hasValidDgmnLicense ?? profileObj.hasValidDgmnLicense,
        whatsappDispatchAllowed:
            json?.whatsappDispatchAllowed ?? profileObj.whatsappDispatchAllowed,
        optInStatus: json?.optInStatus ?? profileObj.optInStatus,
    });
}

export default supplyApi;
