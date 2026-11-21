import { coreAuthFetch } from '../../../core/network/coreAuthFetch';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import {
    computeSavingsPct,
    type CanonicalSupplySku,
    type CasEvidenceRef,
    type ConsolidatedShoppingBucketGroup,
    type ConsolidatedShoppingItem,
    type DemandForecastSummary,
    type FulfillmentAllocationDraft,
    type PaymentMethod,
    type PurchaseMode,
    type SiiDocumentRecord,
    type SiiExpenseReport,
    type SupplyAssetRecord,
    type SupplyCategoryCode,
    type SupplyDemandNature,
    type SupplyDemandOrigin,
    type SupplyInventoryItem,
    type SupplyOperationalRole,
    type SupplyPurchaseDraft,
    type SupplyPurchaseRecord,
    type SupplyRequisition,
    type SupplySite,
    type SupplyUnitSi,
    type RequisitionUrgency,
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

export interface CreateRequisitionInput {
    siteId: string;
    costCenter: string;
    demandOrigin?: SupplyDemandOrigin;
    demandNature?: SupplyDemandNature;
    urgency?: RequisitionUrgency;
    lines: Array<{
        canonicalSkuId?: string;
        name: string;
        categoryCode: SupplyCategoryCode;
        unitSi: SupplyUnitSi;
        qtyRequested: number;
        urgency?: RequisitionUrgency;
        notes?: string;
    }>;
}

export interface AnalyzeReceiptRequest {
    siteId?: string;
    purchaseMode: PurchaseMode;
    evidenceCasRef?: CasEvidenceRef;
    clientOriginalBytes?: number;
    tedRawXml?: string;
    xmlDteRaw?: string;
    fileBase64?: string;
    mimeType?: string;
}

export interface CommitPurchaseRequest {
    draft: SupplyPurchaseDraft;
    allocations: FulfillmentAllocationDraft[];
    confirmationKeyword: 'ACTUALIZAR';
}

export interface CreateExpenseReportInput {
    siteId?: string;
    holderName: string;
    periodLabel: string;
    paymentMethod: PaymentMethod;
    fundAdvanceClp: number;
    documentIds?: string[];
}

export interface WhatsAppSimulateInput {
    siteId?: string;
    phoneE164: string;
    role: SupplyOperationalRole;
    messageText: string;
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
        return unwrapArray<SupplyRequisition>(json, 'requisitions');
    },

    async createRequisition(
        input: CreateRequisitionInput,
        tenantId?: string
    ): Promise<{ requisition?: SupplyRequisition; queuedOffline?: boolean }> {
        if (!syncQueueEngine.isOnlineNow()) {
            await syncQueueEngine.enqueueApiMutation(
                `${SUPPLY_API_BASE}/requisitions`,
                { ...input, tenantId },
                'supply:requisition-synced',
                tenantId,
                'POST'
            );
            return { queuedOffline: true };
        }
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/requisitions`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(input),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            requisition: (json?.requisition || json?.data || json) as SupplyRequisition,
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
        const json = await parseJsonResponse<unknown>(res);
        const groups = unwrapArray<ConsolidatedShoppingBucketGroup>(json, 'groups', 'buckets', 'lists');
        if (groups.length > 0 && groups[0] && 'procurementBucket' in groups[0]) {
            return groups;
        }
        // Fallback normalization if server returns flat items array
        const flatItems = unwrapArray<ConsolidatedShoppingItem>(json, 'items');
        if (flatItems.length === 0) return [];
        const map = new Map<string, ConsolidatedShoppingBucketGroup>();
        for (const item of flatItems) {
            const key = item.procurementBucket;
            const current = map.get(key) || {
                procurementBucket: key,
                items: [],
                totalLines: 0,
                atypicalCount: 0,
                estimatedClp: 0,
            };
            current.items.push(item);
            current.totalLines += 1;
            current.atypicalCount += item.atypicalCount || (item.atypicalFlags?.length ? 1 : 0);
            current.estimatedClp += item.estimatedClp || 0;
            map.set(key, current);
        }
        return Array.from(map.values());
    },

    /**
     * Pre-digests receipt photo or PDF through MINREPORT-MEDIA-DIGESTOR-CAS (`MediaDigestorClient`),
     * preserving true `clientOriginalBytes` and enforcing `TENANT_PRIVATE` isolation in `southamerica-west1`.
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

        const originalBytes = Math.max(rawSize, descriptor.originalBytes || digested.originalBytes || 0);
        const optimizedBytes = descriptor.optimizedBytes || digested.optimizedBytes || 0;
        const savingsPct =
            typeof descriptor.savingsPct === 'number'
                ? descriptor.savingsPct
                : computeSavingsPct(originalBytes, optimizedBytes);

        return {
            sha256: descriptor.sha256,
            downloadUrl: descriptor.downloadUrl,
            mimeType: descriptor.mimeType,
            originalFilename: descriptor.originalFilename || options.filename,
            originalBytes,
            optimizedBytes,
            savingsRatio: descriptor.savingsRatio,
            savingsPct,
            deduplicatedHit: descriptor.deduplicatedHit,
        };
    },

    async analyzeReceipt(
        payload: AnalyzeReceiptRequest,
        tenantId?: string
    ): Promise<SupplyPurchaseDraft> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/receipts/analyze`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(payload),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        const draft = (json?.draft || json?.analysis || json?.data || json) as SupplyPurchaseDraft;
        return {
            ...draft,
            evidenceCasRef: draft.evidenceCasRef || payload.evidenceCasRef,
            lines: Array.isArray(draft.lines) ? draft.lines : [],
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
        return unwrapArray<SupplyPurchaseRecord>(json, 'purchases');
    },

    async commitPurchase(
        req: CommitPurchaseRequest,
        tenantId?: string
    ): Promise<{ purchase?: SupplyPurchaseRecord; queuedOffline?: boolean }> {
        const body = {
            ...req.draft,
            allocations: req.allocations,
            confirmationKeyword: req.confirmationKeyword,
            clientOriginalBytes: req.draft.evidenceCasRef?.originalBytes,
        };

        if (!syncQueueEngine.isOnlineNow()) {
            // Stage 1: Ensure offline CAS blob uploads first on reconnect
            if (req.draft.evidenceCasRef?.sha256) {
                await syncQueueEngine.enqueueTask('CAS_MEDIA_UPLOAD', {
                    sha256: req.draft.evidenceCasRef.sha256,
                    scope: 'TENANT_PRIVATE',
                    profile: req.draft.evidenceCasRef.mimeType?.includes('pdf')
                        ? 'PDF_HYBRID_OEM'
                        : 'IMAGE_FIELD_EVIDENCE',
                    tenantId,
                    filename: req.draft.evidenceCasRef.originalFilename,
                });
            }
            // Stage 2: Drain purchase mutation via authenticated core queue
            await syncQueueEngine.enqueueApiMutation(
                `${SUPPLY_API_BASE}/purchases`,
                { ...body, tenantId },
                'supply:purchase-synced',
                tenantId,
                'POST'
            );
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
        confirmationKeyword: 'ACTUALIZAR',
        tenantId?: string
    ): Promise<void> {
        const endpoint = `${SUPPLY_API_BASE}/purchases/${encodeURIComponent(purchaseId)}/confirm-reception`;
        const payload = { confirmationKeyword };
        if (!syncQueueEngine.isOnlineNow()) {
            await syncQueueEngine.enqueueApiMutation(
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
        return unwrapArray<SupplyInventoryItem>(json, 'inventory', 'stock');
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
        tenantId?: string
    ): Promise<{ opermaqAssetId?: string }> {
        const res = await coreAuthFetch(
            `${SUPPLY_API_BASE}/assets/${encodeURIComponent(assetId)}/link-opermaq`,
            {
                method: 'POST',
                headers: buildHeaders(tenantId, true),
                body: JSON.stringify({ confirmationKeyword }),
            }
        );
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            opermaqAssetId:
                typeof json?.opermaqAssetId === 'string'
                    ? json.opermaqAssetId
                    : typeof (json?.asset as Record<string, unknown> | undefined)?.opermaqAssetId === 'string'
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
        const summary = (json?.forecast || json?.summary || json?.data || json) as DemandForecastSummary | null;
        if (!summary || typeof summary !== 'object') return null;
        return summary;
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
        return unwrapArray<SiiDocumentRecord>(json, 'documents', 'siiDocuments');
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
        return unwrapArray<SiiExpenseReport>(json, 'reports', 'expenseReports');
    },

    async createSiiExpenseReport(
        input: CreateExpenseReportInput,
        tenantId?: string
    ): Promise<SiiExpenseReport> {
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/sii/expense-reports`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(input),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return (json?.report || json?.expenseReport || json?.data || json) as SiiExpenseReport;
    },

    async exportSiiCsv(params: { siteId?: string; period?: string } = {}, tenantId?: string): Promise<void> {
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
        const res = await coreAuthFetch(`${SUPPLY_API_BASE}/whatsapp/simulate`, {
            method: 'POST',
            headers: buildHeaders(tenantId, true),
            body: JSON.stringify(input),
        });
        const json = await parseJsonResponse<Record<string, unknown>>(res);
        return {
            replyText: String(json?.replyText || json?.reply || json?.message || ''),
            fsmState: (json?.fsmState || json?.state) as WhatsAppSimMessage['fsmState'],
            hardDeniedItems: Array.isArray(json?.hardDeniedItems)
                ? (json.hardDeniedItems as string[])
                : undefined,
            atypicalFlags: Array.isArray(json?.atypicalFlags)
                ? (json.atypicalFlags as WhatsAppSimMessage['atypicalFlags'])
                : undefined,
            missingSlots: Array.isArray(json?.missingSlots)
                ? (json.missingSlots as string[])
                : undefined,
            committedReqId: typeof json?.committedReqId === 'string' ? json.committedReqId : undefined,
        };
    },
};

export default supplyApi;
