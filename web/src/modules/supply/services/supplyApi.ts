import { coreAuthFetch } from '../../../core/network/coreAuthFetch';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import {
    computeSavingsPct,
    type AtypicalFlagCode,
    type CanonicalSupplySku,
    type CasEvidenceRef,
    type ConsolidatedShoppingBucketGroup,
    type ConsolidatedShoppingItem,
    type DemandForecastSummary,
    type FulfillmentAllocationDraft,
    type PaymentMethod,
    type ProcurementBucket,
    type PurchaseLineDestination,
    type PurchaseMode,
    type RequisitionUrgency,
    type SiiDocumentRcvStatus,
    type SiiDocumentRecord,
    type SiiDteType,
    type SiiExpenseReport,
    type SiiExpenseReportStatus,
    type SupplyAssetRecord,
    type SupplyCategoryCode,
    type SupplyDemandNature,
    type SupplyDemandOrigin,
    type SupplyInventoryItem,
    type SupplyOperationalRole,
    type SupplyPurchaseDraft,
    type SupplyPurchaseLineDraft,
    type SupplyPurchaseRecord,
    type SupplyRequisition,
    type SupplyRequisitionLine,
    type SupplySite,
    type SupplyUnitSi,
    type WhatsAppSimMessage,
} from '../types';

const SUPPLY_API_BASE = '/api/supply';

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

function normalizePurchaseLineFromServer(raw: Record<string, unknown>): SupplyPurchaseLineDraft {
    const id = String(
        raw.purchaseLineId || raw.lineId || `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );
    const qty = Number(raw.qtyPurchased ?? raw.qty ?? 1) || 1;
    const total = Number(raw.lineTotalClp ?? raw.subtotalClp ?? 0) || 0;
    const unitGross =
        Number(raw.unitPriceGrossClp ?? raw.unitPriceClp ?? (qty > 0 ? Math.round(total / qty) : 0)) ||
        0;
    const desc = String(raw.rawDescription || raw.normalizedName || raw.name || '');

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
        qtyReceived: Number(raw.qtyReceived ?? 0) || 0,
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

function normalizeInventoryItem(raw: Record<string, unknown>): SupplyInventoryItem {
    return {
        itemId: String(raw.itemId || raw.canonicalSkuId || ''),
        tenantId: String(raw.tenantId || ''),
        siteId: String(raw.siteId || ''),
        canonicalSkuId: String(raw.canonicalSkuId || ''),
        name: String(raw.name || raw.normalizedName || raw.itemName || ''),
        categoryCode: (raw.categoryCode as SupplyCategoryCode) || 'OTROS_OPERACIONAL',
        unitSi: (raw.unitSi as SupplyUnitSi) || 'un',
        qtyInTransit: Number(raw.qtyInTransit ?? 0) || 0,
        qtyInWarehouse: Number(raw.qtyInWarehouse ?? 0) || 0,
        minSafetyQty: Number(raw.minSafetyStock ?? raw.minSafetyQty ?? 0) || 0,
        ewmaDailyRate: Number(raw.ewmaDailyRatePerPax ?? raw.ewmaDailyRate ?? 0) || 0,
        doiDays:
            typeof raw.estimatedDoiDays === 'number'
                ? raw.estimatedDoiDays
                : typeof raw.doiDays === 'number'
                  ? raw.doiDays
                  : null,
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

function normalizeSiiExpenseReport(raw: Record<string, unknown>): SiiExpenseReport {
    const docIds = Array.isArray(raw.siiDocumentIds)
        ? (raw.siiDocumentIds as string[])
        : Array.isArray(raw.documentIds)
          ? (raw.documentIds as string[])
          : [];
    const title = String(raw.title || raw.code || raw.reportId || '');
    const code = String(raw.code || raw.title || raw.reportId || '');
    const rawStatus = String(raw.status || 'OPEN') as SiiExpenseReportStatus;

    return {
        reportId: String(raw.reportId || code),
        tenantId: String(raw.tenantId || ''),
        siteId: typeof raw.siteId === 'string' ? raw.siteId : undefined,
        code,
        title,
        costCenter: String(raw.costCenter || 'CC-CAMPAMENTO'),
        holderName: String(raw.holderName || ''),
        holderUid: typeof raw.holderUid === 'string' ? raw.holderUid : undefined,
        periodLabel: String(raw.periodLabel || ''),
        paymentMethod: (raw.paymentMethod as PaymentMethod) || 'FONDO_POR_RENDIR',
        fundAdvanceClp: Number(raw.fundAdvanceClp ?? 0) || 0,
        renderedTotalClp: Number(raw.renderedTotalClp ?? 0) || 0,
        balanceClp: Number(raw.balanceClp ?? 0) || 0,
        documentCount: Number(raw.documentCount ?? docIds.length) || docIds.length,
        documentIds: docIds,
        status: rawStatus,
        createdAt: String(raw.createdAt || ''),
    };
}

function normalizeForecast(raw: Record<string, unknown>): DemandForecastSummary {
    const guardrail =
        raw.waterCoverageGuardrail && typeof raw.waterCoverageGuardrail === 'object'
            ? (raw.waterCoverageGuardrail as Record<string, unknown>)
            : null;
    const headcount = Number(raw.headcountBasis ?? raw.headcount ?? 0) || 0;
    const leadTimeDays = Number(raw.leadTimeDays ?? 7) || 7;
    const ds594PerPax = Number(guardrail?.ds594TargetLPerPaxDay ?? 120) || 120;
    const waterStoredL = Number(guardrail?.availableWaterL ?? raw.waterStoredL ?? 0) || 0;
    const waterDailyTargetL =
        Number(raw.waterDailyTargetL ?? headcount * ds594PerPax) || 0;
    const waterRequiredLeadL =
        Number(guardrail?.requiredWaterL ?? raw.waterRequiredLeadL ?? waterDailyTargetL * leadTimeDays) ||
        0;
    const waterCoverageDays =
        Number(
            guardrail?.coverageDays ??
                raw.waterCoverageDays ??
                (waterDailyTargetL > 0 ? Math.round((waterStoredL / waterDailyTargetL) * 10) / 10 : 0)
        ) || 0;
    const waterCompliantDs594 =
        typeof guardrail?.compliant === 'boolean'
            ? guardrail.compliant
            : typeof raw.waterCompliantDs594 === 'boolean'
              ? raw.waterCompliantDs594
              : waterRequiredLeadL > 0
                ? waterStoredL >= waterRequiredLeadL
                : true;

    return {
        siteId: String(raw.siteId || ''),
        headcount,
        leadTimeDays,
        waterStoredL,
        waterDailyTargetL,
        waterRequiredLeadL,
        waterCoverageDays,
        waterCompliantDs594,
        dailyOpexPerPaxClp:
            typeof raw.opexDailyPerPaxClp === 'number'
                ? raw.opexDailyPerPaxClp
                : typeof raw.dailyOpexPerPaxClp === 'number'
                  ? raw.dailyOpexPerPaxClp
                  : undefined,
        monthlyProjectedClp:
            typeof raw.projectedOpexTotalClp === 'number'
                ? raw.projectedOpexTotalClp
                : typeof raw.monthlyProjectedClp === 'number'
                  ? raw.monthlyProjectedClp
                  : undefined,
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

        if (!syncQueueEngine.isOnlineNow()) {
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
     * Pre-digests receipt photo or PDF through MINREPORT-MEDIA-DIGESTOR-CAS (`MediaDigestorClient`),
     * preserving true `clientOriginalBytes` and enforcing `TENANT_PRIVATE` isolation in `southamerica-west1`.
     * Guarantees #9 `SupplyEvidenceCasRefSchema` compliance (`mimeType`, `extension`, non-`blob:` URL).
     */
    async digestReceiptMedia(
        file: File | Blob,
        options: { tenantId?: string; filename?: string } = {}
    ): Promise<CasEvidenceRef> {
        const rawSize = file.size;
        const isPdf =
            file.type.toLowerCase().includes('pdf') ||
            (options.filename || (file instanceof File ? file.name : '')).toLowerCase().endsWith('.pdf');

        const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(file, {
            profile: isPdf ? 'PDF_HYBRID_OEM' : 'IMAGE_FIELD_EVIDENCE',
            scope: 'TENANT_PRIVATE',
            tenantId: options.tenantId,
            filename: options.filename || (file instanceof File ? file.name : undefined),
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

    async analyzeReceipt(
        payload: AnalyzeReceiptRequest,
        tenantId?: string
    ): Promise<SupplyPurchaseDraft> {
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
        const rawDraft = (json?.draft || json?.analysis || json?.data || json) as Record<
            string,
            unknown
        >;
        const rawLines = Array.isArray(rawDraft.lines)
            ? (rawDraft.lines as Record<string, unknown>[])
            : [];
        const arithmeticDeltaClp =
            typeof rawDraft.arithmeticMismatchClp === 'number'
                ? rawDraft.arithmeticMismatchClp
                : typeof rawDraft.arithmeticDeltaClp === 'number'
                  ? rawDraft.arithmeticDeltaClp
                  : 0;
        const arithmeticMismatch =
            typeof rawDraft.arithmeticValid === 'boolean'
                ? !rawDraft.arithmeticValid
                : Boolean(rawDraft.arithmeticMismatch || Math.abs(arithmeticDeltaClp) > 2);

        return {
            siteId: String(rawDraft.siteId || payload.siteId),
            purchaseMode: (rawDraft.purchaseMode as PurchaseMode) || payload.purchaseMode,
            supplierTaxId: String(rawDraft.supplierTaxId || ''),
            supplierName: String(rawDraft.supplierName || ''),
            documentType: (Number(rawDraft.documentType ?? 39) as SiiDteType),
            folio: String(rawDraft.folio ?? ''),
            issueDate: String(rawDraft.issueDate || new Date().toISOString().slice(0, 10)),
            netAmountClp: Number(rawDraft.netAmountClp ?? 0) || 0,
            vatAmountClp: Number(rawDraft.vatAmountClp ?? 0) || 0,
            totalAmountClp: Number(rawDraft.totalAmountClp ?? 0) || 0,
            paymentMethod: (rawDraft.paymentMethod as PaymentMethod) || 'FONDO_POR_RENDIR',
            evidenceCasRef:
                (rawDraft.evidenceCasRef as CasEvidenceRef | undefined) || payload.evidenceCasRef,
            tedRawXml: typeof rawDraft.tedRawXml === 'string' ? rawDraft.tedRawXml : payload.tedRawXml,
            arithmeticMismatch,
            arithmeticDeltaClp,
            duplicateDetected: Boolean(rawDraft.isDuplicate ?? rawDraft.duplicateDetected),
            dedupeKey: typeof rawDraft.dedupeKey === 'string' ? rawDraft.dedupeKey : undefined,
            lines: rawLines.map(normalizePurchaseLineFromServer),
        };
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
        return unwrapArray<Record<string, unknown>>(json, 'purchases').map((raw) => ({
            ...(raw as unknown as SupplyPurchaseRecord),
            folio: String(raw.folio ?? ''),
            lines: Array.isArray(raw.lines)
                ? (raw.lines as Record<string, unknown>[]).map(normalizePurchaseLineFromServer)
                : [],
        }));
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

        if (!syncQueueEngine.isOnlineNow()) {
            // Stage 1: Ensure offline CAS blob uploads first on reconnect
            if (req.draft.evidenceCasRef?.sha256) {
                await syncQueueEngine.enqueueTask('CAS_MEDIA_UPLOAD', {
                    sha256: req.draft.evidenceCasRef.sha256,
                    scope: 'TENANT_PRIVATE',
                    profile: req.draft.evidenceCasRef.mimeType.includes('pdf')
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
    ): Promise<void> {
        const endpoint = `${SUPPLY_API_BASE}/purchases/${encodeURIComponent(purchaseId)}/confirm-reception`;
        const payload = {
            receivedLines: receivedLines.map((rl) => ({
                purchaseLineId: rl.purchaseLineId,
                qtyReceivedNow: rl.qtyReceivedNow,
                notes: rl.notes,
            })),
            confirmationKeyword,
        };
        if (!syncQueueEngine.isOnlineNow()) {
            await syncQueueEngine.enqueueSupplyApiMutation(
                endpoint,
                { ...payload, tenantId },
                'supply:reception-synced',
                tenantId,
                'POST'
            );
            return;
        }
        const res = await coreAuthFetch(endpoint, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        await parseJsonResponse(res);
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
    ): Promise<{ opermaqAssetId?: string }> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/assets/${encodeURIComponent(assetId)}/link-opermaq`,
            {
                method: 'POST',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify({
                    opermaqAssetId: options.opermaqAssetId,
                    createOpermaqFleetUnit: options.createOpermaqFleetUnit ?? !options.opermaqAssetId,
                    confirmationKeyword,
                }),
            }
        );
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
    ): Promise<SiiExpenseReport> {
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
        const body = {
            phoneE164: input.phoneE164,
            siteId: input.siteId,
            text: input.text,
            simulateSenderRole: input.simulateSenderRole,
            resetSession: input.resetSession,
        };
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
};

export default supplyApi;
