import crypto from 'crypto';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import {
    type AtypicalFlagCode,
    BRIDGE_CATALOG_RULES,
    buildSiiDedupeKey,
    type CanonicalSupplySku,
    type CashLedgerEntry,
    computeRcvDeadline,
    type ConsolidatedShoppingList,
    consolidateOpenRequisitions,
    type DemandForecast,
    type DemandForecastLine,
    type DemandPoolSignal,
    type FulfillmentAllocation,
    type PaymentMethod,
    type PurchaseLineDestination,
    type PurchaseMode,
    type RequisitionStatus,
    type SiiDocumentRecord,
    type SiiDteType,
    type SiiExpenseReport,
    type StockLedgerEntry,
    SUPPLY_AUDIT_MODULE,
    type SupplyAsset,
    type SupplyInventoryItem,
    type SupplyOperationalRole,
    type SupplyPurchase,
    type SupplyPurchaseLine,
    type SupplyRequisition,
    type SupplySite,
} from './supply.types';

/**
 * SUPPLY REPOSITORY (Capa 5 — Base de Datos Única Cloud Firestore `southamerica-west1`)
 *
 * Gobierna la persistencia multi-tenant de MINREPORT · ABASTECIMIENTO con aislamiento
 * estricto por `tenantId`, anti-duplicación tributaria SII, conciliación FIFO N:M,
 * separación patrimonial CAPEX (`supply_assets`), anonimato k>=3 para Marketplace
 * y trazabilidad criptográfica inmutable en `AuditLedger`.
 */

export const SUPPLY_COLLECTIONS = {
    GLOBAL_CATALOG: 'global_supply_catalog',
    GLOBAL_SUPPLIERS: 'global_suppliers',
    TENANT_SUPPLIERS: 'tenant_suppliers',
    SITES: 'supply_sites',
    INVENTORY_ITEMS: 'supply_inventory_items',
    REQUISITIONS: 'supply_requisitions',
    PURCHASES: 'supply_purchases',
    FULFILLMENT_ALLOCATIONS: 'supply_fulfillment_allocations',
    ASSETS: 'supply_assets',
    STOCK_LEDGER: 'supply_stock_ledger',
    CASH_LEDGER: 'supply_cash_ledger',
    SII_DOCUMENTS: 'supply_sii_documents',
    EXPENSE_REPORTS: 'supply_expense_reports',
    DEMAND_FORECASTS: 'supply_demand_forecasts',
    MARKET_DEMAND_SIGNALS: 'market_demand_signals',
    WHATSAPP_SESSIONS: 'supply_whatsapp_sessions',
    WHATSAPP_WAMIDS: 'supply_whatsapp_wamids',
} as const;

export class SupplyDuplicateSiiDocumentError extends Error {
    public readonly statusCode = 409;
    public readonly code = 'SII_DUPLICATE_DOCUMENT';
    public readonly dedupeKey: string;

    constructor(dedupeKey: string) {
        super(`Documento SII duplicado ya registrado para esta cuenta (${dedupeKey}).`);
        this.name = 'SupplyDuplicateSiiDocumentError';
        this.dedupeKey = dedupeKey;
    }
}

export class SupplyNotFoundError extends Error {
    public readonly statusCode = 404;
    public readonly code = 'SUPPLY_ENTITY_NOT_FOUND';

    constructor(message: string) {
        super(message);
        this.name = 'SupplyNotFoundError';
    }
}

export class SupplyForbiddenError extends Error {
    public readonly statusCode = 403;
    public readonly code = 'TENANT_ACCESS_DENIED';

    constructor(message: string) {
        super(message);
        this.name = 'SupplyForbiddenError';
    }
}

export class SupplyConflictError extends Error {
    public readonly statusCode = 409;
    public readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'SupplyConflictError';
        this.code = code;
    }
}

export interface AuditActorContext {
    actorUid: string;
    actorEmail: string;
    ipAddress?: string;
}

function safeDocIdPart(raw: string): string {
    return String(raw || '')
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .slice(0, 96);
}

function buildSiiDocId(tenantId: string, dedupeKey: string): string {
    return `${safeDocIdPart(tenantId)}__${safeDocIdPart(dedupeKey)}`;
}

function buildInventoryDocId(tenantId: string, siteId: string, canonicalSkuId: string): string {
    return `${safeDocIdPart(tenantId)}__${safeDocIdPart(siteId)}__${safeDocIdPart(canonicalSkuId)}`;
}

function computeRequisitionAggregateStatus(lines: SupplyRequisition['lines']): RequisitionStatus {
    const activeLines = lines.filter((l) => l.lineStatus !== 'CANCELLED');
    if (activeLines.length === 0) return 'CANCELLED';
    if (activeLines.every((l) => l.lineStatus === 'FULFILLED' || l.qtyPending <= 0)) {
        return 'FULFILLED';
    }
    if (activeLines.some((l) => l.qtyPurchased > 0 || l.lineStatus === 'PARTIAL' || l.lineStatus === 'FULFILLED')) {
        return 'PARTIAL';
    }
    return 'OPEN';
}

export class SupplyRepository {
    private static async recordAudit(
        tenantId: string,
        actor: AuditActorContext,
        action: string,
        targetEntity: string,
        details: Record<string, unknown>
    ): Promise<void> {
        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail || actor.actorUid,
            action,
            module: SUPPLY_AUDIT_MODULE,
            targetEntity,
            details,
            ipAddress: actor.ipAddress,
        });
    }

    // -----------------------------------------------------------------------
    // Sites (`supply_sites`)
    // -----------------------------------------------------------------------

    public static async listSites(tenantId: string): Promise<SupplySite[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.SITES)
            .where('tenantId', '==', tenantId)
            .get();
        return snap.docs
            .map((d) => d.data() as SupplySite)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }

    public static async getSite(tenantId: string, siteId: string): Promise<SupplySite | null> {
        const snap = await db.collection(SUPPLY_COLLECTIONS.SITES).doc(siteId).get();
        if (!snap.exists) return null;
        const data = snap.data() as SupplySite;
        if (data.tenantId !== tenantId) return null;
        return data;
    }

    public static async upsertSite(
        tenantId: string,
        site: Omit<SupplySite, 'tenantId' | 'siteId' | 'createdAt' | 'updatedAt'> & { siteId?: string },
        actor: AuditActorContext
    ): Promise<SupplySite> {
        const now = new Date().toISOString();
        const siteId = site.siteId?.trim() || `site_${crypto.randomBytes(6).toString('hex')}`;
        const siteRef = db.collection(SUPPLY_COLLECTIONS.SITES).doc(siteId);
        const directSnap = await siteRef.get();
        let existing: SupplySite | null = null;

        if (directSnap.exists) {
            const raw = directSnap.data() as SupplySite;
            if (raw.tenantId && raw.tenantId !== tenantId) {
                throw new SupplyForbiddenError(
                    'TENANT_ACCESS_DENIED: El identificador de sitio pertenece a otra cuenta organizacional.'
                );
            }
            existing = raw;
        }

        const record: SupplySite = {
            ...site,
            siteId,
            tenantId,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        await siteRef.set(record, { merge: true });
        await this.recordAudit(tenantId, actor, existing ? 'SUPPLY_SITE_UPDATED' : 'SUPPLY_SITE_CREATED', siteId, {
            name: record.name,
            districtCode: record.districtCode,
            currentHeadcount: record.currentHeadcount,
            marketplaceOptIn: record.marketplaceOptIn,
        });
        return record;
    }

    // -----------------------------------------------------------------------
    // Catalog (`global_supply_catalog`) & Suppliers
    // -----------------------------------------------------------------------

    public static async listCatalog(options?: {
        tenantId?: string;
        categoryCode?: string;
        procurementBucket?: string;
        search?: string;
    }): Promise<CanonicalSupplySku[]> {
        const snap = await db.collection(SUPPLY_COLLECTIONS.GLOBAL_CATALOG).limit(500).get();
        let items: CanonicalSupplySku[] = snap.docs.map((d) => d.data() as CanonicalSupplySku);

        if (items.length === 0) {
            items = BRIDGE_CATALOG_RULES.map((r) => ({
                canonicalSkuId: r.canonicalSkuId,
                name: r.itemName,
                categoryCode: r.categoryCode,
                procurementBucket: r.procurementBucket,
                baseUnitSi: r.unitSi,
                requiredSlots: r.requiredSlots,
                isCapexAsset: Boolean(r.isCapexAsset),
                isControlled: false,
                leySaco25kgApplied: Boolean(r.packConversions?.some((c) => c.leySaco)),
            }));
        }

        if (options?.tenantId) {
            items = items.filter((it) => !it.tenantId || it.tenantId === options.tenantId);
        }
        if (options?.categoryCode) {
            items = items.filter((it) => it.categoryCode === options.categoryCode);
        }
        if (options?.procurementBucket) {
            items = items.filter((it) => it.procurementBucket === options.procurementBucket);
        }
        if (options?.search) {
            const q = options.search.toLowerCase().trim();
            items = items.filter(
                (it) =>
                    it.name.toLowerCase().includes(q) ||
                    it.canonicalSkuId.toLowerCase().includes(q) ||
                    (it.aliases || []).some((a) => a.toLowerCase().includes(q))
            );
        }

        return items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }

    public static async upsertCatalogSku(
        sku: CanonicalSupplySku,
        actor: AuditActorContext,
        auditTenantId: string = 'global'
    ): Promise<CanonicalSupplySku> {
        const now = new Date().toISOString();
        const isTenantScoped = Boolean(sku.tenantId && sku.tenantId.trim());
        const docId = isTenantScoped
            ? `tenant_${safeDocIdPart(sku.tenantId!)}__${safeDocIdPart(sku.canonicalSkuId)}`
            : safeDocIdPart(sku.canonicalSkuId);

        const docRef = db.collection(SUPPLY_COLLECTIONS.GLOBAL_CATALOG).doc(docId);
        const existingSnap = await docRef.get();
        if (existingSnap.exists) {
            const existing = existingSnap.data() as CanonicalSupplySku;
            if (isTenantScoped && (!existing.tenantId || existing.tenantId !== sku.tenantId)) {
                throw new SupplyForbiddenError(
                    'TENANT_ACCESS_DENIED: No está permitido sobrescribir un SKU global o de otra cuenta.'
                );
            }
        }

        const record: CanonicalSupplySku = {
            ...sku,
            updatedAt: now,
        };
        await docRef.set(record, { merge: true });
        await this.recordAudit(auditTenantId, actor, 'SUPPLY_CATALOG_SKU_UPSERTED', docId, {
            canonicalSkuId: sku.canonicalSkuId,
            scope: isTenantScoped ? 'TENANT' : 'GLOBAL',
            categoryCode: sku.categoryCode,
            procurementBucket: sku.procurementBucket,
            isCapexAsset: sku.isCapexAsset,
        });
        return record;
    }

    public static async upsertSupplier(params: {
        tenantId: string;
        supplierTaxId: string;
        supplierName: string;
        scope?: 'TENANT' | 'GLOBAL';
    }): Promise<string> {
        const now = new Date().toISOString();
        const safeRut = safeDocIdPart(params.supplierTaxId || params.supplierName);
        if (params.scope === 'GLOBAL') {
            const supplierId = `gsup_${safeRut}`;
            await db
                .collection(SUPPLY_COLLECTIONS.GLOBAL_SUPPLIERS)
                .doc(supplierId)
                .set(
                    {
                        supplierId,
                        supplierTaxId: params.supplierTaxId,
                        supplierName: params.supplierName,
                        updatedAt: now,
                    },
                    { merge: true }
                );
            return supplierId;
        }
        const supplierId = `tsup_${safeDocIdPart(params.tenantId)}_${safeRut}`;
        await db
            .collection(SUPPLY_COLLECTIONS.TENANT_SUPPLIERS)
            .doc(supplierId)
            .set(
                {
                    supplierId,
                    tenantId: params.tenantId,
                    supplierTaxId: params.supplierTaxId,
                    supplierName: params.supplierName,
                    updatedAt: now,
                },
                { merge: true }
            );
        return supplierId;
    }

    // -----------------------------------------------------------------------
    // Requisitions (`supply_requisitions`) & Consolidated Shopping Lists
    // -----------------------------------------------------------------------

    public static async listRequisitions(
        tenantId: string,
        filters?: { siteId?: string; status?: RequisitionStatus; origin?: string }
    ): Promise<SupplyRequisition[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.REQUISITIONS)
            .where('tenantId', '==', tenantId)
            .get();

        let list = snap.docs.map((d) => d.data() as SupplyRequisition);
        if (filters?.siteId) list = list.filter((r) => r.siteId === filters.siteId);
        if (filters?.status) list = list.filter((r) => r.status === filters.status);
        if (filters?.origin) list = list.filter((r) => r.demandOrigin === filters.origin);

        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async createRequisition(
        input: Omit<SupplyRequisition, 'reqId' | 'createdAt' | 'updatedAt' | 'status'> & {
            reqId?: string;
            status?: RequisitionStatus;
        },
        actor: AuditActorContext
    ): Promise<SupplyRequisition> {
        const now = new Date().toISOString();
        const reqId = input.reqId?.trim() || `req_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

        const normalizedLines = input.lines.map((line, idx) => {
            const qtyPurchased = Number(line.qtyPurchased || 0);
            const qtyPending = Math.max(0, Number((line.qtyRequested - qtyPurchased).toFixed(3)));
            return {
                ...line,
                lineId: line.lineId || `rline_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
                qtyPurchased,
                qtyReceived: Number(line.qtyReceived || 0),
                qtyPending,
                lineStatus:
                    qtyPending <= 0 ? ('FULFILLED' as const) : qtyPurchased > 0 ? ('PARTIAL' as const) : ('OPEN' as const),
            };
        });

        const aggregateFlags = Array.from(
            new Set([
                ...(input.atypicalFlags || []),
                ...normalizedLines.flatMap((l) => l.atypicalFlags || []),
            ])
        );

        const record: SupplyRequisition = {
            ...input,
            reqId,
            lines: normalizedLines,
            atypicalFlags: aggregateFlags,
            status: input.status || computeRequisitionAggregateStatus(normalizedLines),
            createdAt: now,
            updatedAt: now,
        };

        await db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(reqId).set(record);
        await this.recordAudit(record.tenantId, actor, 'SUPPLY_REQUISITION_CREATED', reqId, {
            siteId: record.siteId,
            demandOrigin: record.demandOrigin,
            lineCount: record.lines.length,
            atypicalFlags: record.atypicalFlags,
        });
        return record;
    }

    public static async updateRequisitionStatus(
        tenantId: string,
        reqId: string,
        patch: { status?: RequisitionStatus; notes?: string },
        actor: AuditActorContext
    ): Promise<SupplyRequisition> {
        const ref = db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(reqId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError('Requisición no encontrada.');
        }
        const existing = snap.data() as SupplyRequisition;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError('Requisición no pertenece a la cuenta activa.');
        }

        const updatedLines =
            patch.status === 'CANCELLED'
                ? existing.lines.map((l) =>
                      l.lineStatus === 'FULFILLED' ? l : { ...l, lineStatus: 'CANCELLED' as const, qtyPending: 0 }
                  )
                : existing.lines;

        const updated: SupplyRequisition = {
            ...existing,
            status: patch.status || existing.status,
            notes: patch.notes !== undefined ? patch.notes : existing.notes,
            lines: updatedLines,
            updatedAt: new Date().toISOString(),
        };

        await ref.set(updated, { merge: true });
        await this.recordAudit(tenantId, actor, 'SUPPLY_REQUISITION_UPDATED', reqId, {
            hitlConfirmed: true,
            newStatus: updated.status,
        });
        return updated;
    }

    public static async getConsolidatedShoppingList(
        tenantId: string,
        siteId?: string
    ): Promise<ConsolidatedShoppingList> {
        const reqs = await this.listRequisitions(tenantId, { siteId });
        return consolidateOpenRequisitions(tenantId, reqs, siteId);
    }

    // -----------------------------------------------------------------------
    // SII Duplicate Check & Purchases + FIFO N:M Reconciliation + Assets + Ledgers
    // -----------------------------------------------------------------------

    public static async existsSiiDocument(tenantId: string, dedupeKey: string): Promise<boolean> {
        const docId = buildSiiDocId(tenantId, dedupeKey);
        const snap = await db.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(docId).get();
        return snap.exists;
    }

    public static async listPurchases(tenantId: string, siteId?: string): Promise<SupplyPurchase[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.PURCHASES)
            .where('tenantId', '==', tenantId)
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyPurchase);
        if (siteId) list = list.filter((p) => p.siteId === siteId);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async createPurchaseWithReconciliation(
        params: {
            tenantId: string;
            siteId: string;
            buyerUid: string;
            buyerRole: SupplyOperationalRole;
            purchaseMode: PurchaseMode;
            authorizedByAuthority: boolean;
            supplierTaxId: string;
            supplierName: string;
            documentType: SiiDteType;
            folio: number;
            issueDate: string;
            netAmountClp: number;
            vatAmountClp: number;
            totalAmountClp: number;
            paymentMethod: PaymentMethod;
            evidenceCasRef?: SupplyPurchase['evidenceCasRef'];
            tedRawXml?: string;
            lines: SupplyPurchaseLine[];
            atypicalFlags?: AtypicalFlagCode[];
        },
        actor: AuditActorContext
    ): Promise<{
        purchase: SupplyPurchase;
        siiDocument: SiiDocumentRecord;
        allocations: FulfillmentAllocation[];
        createdAssets: SupplyAsset[];
        updatedRequisitionIds: string[];
        missingInvoiceAlert: boolean;
    }> {
        const now = new Date().toISOString();
        const dedupeKey = buildSiiDedupeKey(params.supplierTaxId, params.documentType, params.folio);

        // 1. Anti-duplicación tributaria SII (rutEmisor#tipoDte#folio)
        if (params.documentType !== 0 && params.folio > 0) {
            const alreadyExists = await this.existsSiiDocument(params.tenantId, dedupeKey);
            if (alreadyExists) {
                throw new SupplyDuplicateSiiDocumentError(dedupeKey);
            }
        }

        const purchaseId = `pur_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
        const supplierId = await this.upsertSupplier({
            tenantId: params.tenantId,
            supplierTaxId: params.supplierTaxId,
            supplierName: params.supplierName,
            scope: 'TENANT',
        });

        const hasCapexLine = params.lines.some((l) => l.isCapexAsset || l.destination === 'CAPEX_ASSET');
        const missingInvoiceAlert = hasCapexLine && params.documentType !== 33 && params.documentType !== 34;

        const atypicalFlags = Array.from(
            new Set<AtypicalFlagCode>([
                ...(params.atypicalFlags || []),
                ...(hasCapexLine ? (['ATYPICAL_HIGH_VALUE_OR_CAPEX'] as AtypicalFlagCode[]) : []),
                ...(missingInvoiceAlert ? (['ATYPICAL_ASSET_WITHOUT_INVOICE'] as AtypicalFlagCode[]) : []),
            ])
        );

        const hasInTransitLines = params.lines.some((l) => l.destination === 'STOCK_IN_TRANSIT');
        const hasWarehouseDirectLines = params.lines.some((l) => l.destination === 'STOCK_IN_WAREHOUSE');
        const receptionStatus: SupplyPurchase['receptionStatus'] = hasInTransitLines
            ? 'IN_TRANSIT'
            : hasWarehouseDirectLines
              ? 'RECEIVED'
              : 'NOT_APPLICABLE';

        const purchase: SupplyPurchase = {
            purchaseId,
            tenantId: params.tenantId,
            siteId: params.siteId,
            buyerUid: params.buyerUid,
            buyerRole: params.buyerRole,
            purchaseMode: params.purchaseMode,
            authorizedByAuthority: params.authorizedByAuthority,
            supplierTaxId: params.supplierTaxId,
            supplierName: params.supplierName,
            supplierId,
            documentType: params.documentType,
            folio: params.folio,
            dedupeKey,
            issueDate: params.issueDate,
            netAmountClp: Math.round(params.netAmountClp),
            vatAmountClp: Math.round(params.vatAmountClp),
            totalAmountClp: Math.round(params.totalAmountClp),
            paymentMethod: params.paymentMethod,
            evidenceCasRef: params.evidenceCasRef,
            tedRawXml: params.tedRawXml,
            receptionStatus,
            receivedAt: receptionStatus === 'RECEIVED' ? now : undefined,
            receivedByUid: receptionStatus === 'RECEIVED' ? actor.actorUid : undefined,
            atypicalFlags,
            lines: params.lines,
            createdAt: now,
            updatedAt: now,
        };

        // 2. Reserva atómica anti-duplicación SII (`supply_sii_documents`) dentro de transacción Firestore
        const { rcvDeadlineDate, rcvDaysRemaining } = computeRcvDeadline(
            params.issueDate,
            params.documentType
        );
        const vatCreditRecoverableClp = params.documentType === 33 ? Math.round(params.vatAmountClp) : 0;
        const enforceUniqueSii = params.documentType !== 0 && params.folio > 0;
        const siiDocId = enforceUniqueSii
            ? buildSiiDocId(params.tenantId, dedupeKey)
            : `${safeDocIdPart(params.tenantId)}__rural_${purchaseId}`;

        const siiDocument: SiiDocumentRecord = {
            docId: siiDocId,
            tenantId: params.tenantId,
            siteId: params.siteId,
            purchaseId,
            dedupeKey,
            supplierTaxId: params.supplierTaxId,
            supplierName: params.supplierName,
            documentType: params.documentType,
            folio: params.folio,
            issueDate: params.issueDate,
            netAmountClp: Math.round(params.netAmountClp),
            vatAmountClp: Math.round(params.vatAmountClp),
            vatCreditRecoverableClp,
            totalAmountClp: Math.round(params.totalAmountClp),
            rcvDeadlineDate,
            rcvDaysRemaining,
            rcvStatus: params.documentType === 33 || params.documentType === 34 ? 'PENDING_ACCEPTANCE' : 'NOT_APPLICABLE',
            missingInvoiceForCapex: missingInvoiceAlert,
            evidenceCasRef: params.evidenceCasRef,
            createdAt: now,
            updatedAt: now,
        };

        const siiRef = db.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(siiDocId);
        const purchaseRef = db.collection(SUPPLY_COLLECTIONS.PURCHASES).doc(purchaseId);

        if (typeof db.runTransaction === 'function') {
            await db.runTransaction(async (tx) => {
                if (enforceUniqueSii) {
                    const existingSii = await tx.get(siiRef);
                    if (existingSii.exists) {
                        throw new SupplyDuplicateSiiDocumentError(dedupeKey);
                    }
                }
                tx.set(siiRef, siiDocument);
                tx.set(purchaseRef, purchase);
            });
        } else {
            if (enforceUniqueSii && (await siiRef.get()).exists) {
                throw new SupplyDuplicateSiiDocumentError(dedupeKey);
            }
            await siiRef.set(siiDocument);
            await purchaseRef.set(purchase);
        }

        // 3. Conciliación N:M FIFO contra backlog de requisiciones (si aplica)
        const allocations: FulfillmentAllocation[] = [];
        const mutatedReqs = new Map<string, SupplyRequisition>();

        let openReqs: SupplyRequisition[] = [];
        if (
            params.purchaseMode === 'REQUISITION_FULFILLMENT' ||
            params.purchaseMode === 'MIXED_FULFILLMENT_AND_DIRECT'
        ) {
            const allReqs = await this.listRequisitions(params.tenantId, { siteId: params.siteId });
            openReqs = allReqs
                .filter((r) => r.status === 'OPEN' || r.status === 'PARTIAL')
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // FIFO oldest first
        }

        const reqById = new Map<string, SupplyRequisition>(
            openReqs.map((r) => [r.reqId, { ...r, lines: r.lines.map((l) => ({ ...l })) }])
        );

        const createdAssets: SupplyAsset[] = [];

        for (const pLine of params.lines) {
            const isCapex = pLine.isCapexAsset || pLine.destination === 'CAPEX_ASSET';
            let remainingQty = Number(pLine.qtyPurchased);

            if (!isCapex && params.purchaseMode !== 'DIRECT_AUTONOMOUS') {
                // 3.a Explicit allocations first
                if (Array.isArray(pLine.explicitAllocations)) {
                    for (const exp of pLine.explicitAllocations) {
                        if (remainingQty <= 0) break;
                        const targetReq = reqById.get(exp.reqId);
                        if (!targetReq) continue;
                        const targetLine = targetReq.lines.find((l) => l.lineId === exp.reqLineId);
                        if (!targetLine || targetLine.qtyPending <= 0) continue;

                        const allocQty = Math.min(remainingQty, exp.qtyAllocated, targetLine.qtyPending);
                        if (allocQty <= 0) continue;

                        targetLine.qtyPurchased = Number((targetLine.qtyPurchased + allocQty).toFixed(3));
                        targetLine.qtyPending = Math.max(
                            0,
                            Number((targetLine.qtyRequested - targetLine.qtyPurchased).toFixed(3))
                        );
                        if (pLine.destination === 'STOCK_IN_WAREHOUSE') {
                            targetLine.qtyReceived = Number((targetLine.qtyReceived + allocQty).toFixed(3));
                        }
                        targetLine.lineStatus = targetLine.qtyPending <= 0 ? 'FULFILLED' : 'PARTIAL';
                        targetReq.status = computeRequisitionAggregateStatus(targetReq.lines);
                        targetReq.updatedAt = now;
                        mutatedReqs.set(targetReq.reqId, targetReq);

                        remainingQty = Number((remainingQty - allocQty).toFixed(3));
                        allocations.push({
                            allocationId: `alloc_${crypto.randomBytes(5).toString('hex')}`,
                            tenantId: params.tenantId,
                            siteId: params.siteId,
                            purchaseId,
                            purchaseLineId: pLine.purchaseLineId,
                            requisitionId: targetReq.reqId,
                            requisitionLineId: targetLine.lineId,
                            canonicalSkuId: pLine.canonicalSkuId,
                            qtyAllocated: allocQty,
                            unitSi: pLine.unitSi,
                            destination: pLine.destination,
                            createdAt: now,
                        });
                    }
                }

                // 3.b Automatic FIFO matching by canonicalSkuId
                for (const targetReq of reqById.values()) {
                    if (remainingQty <= 0) break;
                    for (const targetLine of targetReq.lines) {
                        if (remainingQty <= 0) break;
                        if (targetLine.lineStatus === 'FULFILLED' || targetLine.lineStatus === 'CANCELLED') continue;
                        if (targetLine.qtyPending <= 0) continue;
                        if (targetLine.canonicalSkuId !== pLine.canonicalSkuId) continue;

                        const allocQty = Math.min(remainingQty, targetLine.qtyPending);
                        targetLine.qtyPurchased = Number((targetLine.qtyPurchased + allocQty).toFixed(3));
                        targetLine.qtyPending = Math.max(
                            0,
                            Number((targetLine.qtyRequested - targetLine.qtyPurchased).toFixed(3))
                        );
                        if (pLine.destination === 'STOCK_IN_WAREHOUSE') {
                            targetLine.qtyReceived = Number((targetLine.qtyReceived + allocQty).toFixed(3));
                        }
                        targetLine.lineStatus = targetLine.qtyPending <= 0 ? 'FULFILLED' : 'PARTIAL';
                        targetReq.status = computeRequisitionAggregateStatus(targetReq.lines);
                        targetReq.updatedAt = now;
                        mutatedReqs.set(targetReq.reqId, targetReq);

                        remainingQty = Number((remainingQty - allocQty).toFixed(3));
                        allocations.push({
                            allocationId: `alloc_${crypto.randomBytes(5).toString('hex')}`,
                            tenantId: params.tenantId,
                            siteId: params.siteId,
                            purchaseId,
                            purchaseLineId: pLine.purchaseLineId,
                            requisitionId: targetReq.reqId,
                            requisitionLineId: targetLine.lineId,
                            canonicalSkuId: pLine.canonicalSkuId,
                            qtyAllocated: allocQty,
                            unitSi: pLine.unitSi,
                            destination: pLine.destination,
                            createdAt: now,
                        });
                    }
                }
            }

            // 3.c Remainder -> UNSOLICITED_PURCHASE (direct autonomous purchase or CAPEX)
            if (remainingQty > 0) {
                allocations.push({
                    allocationId: `alloc_${crypto.randomBytes(5).toString('hex')}`,
                    tenantId: params.tenantId,
                    siteId: params.siteId,
                    purchaseId,
                    purchaseLineId: pLine.purchaseLineId,
                    requisitionId: 'UNSOLICITED_PURCHASE',
                    requisitionLineId: 'UNSOLICITED_PURCHASE',
                    canonicalSkuId: pLine.canonicalSkuId,
                    qtyAllocated: remainingQty,
                    unitSi: pLine.unitSi,
                    destination: pLine.destination,
                    createdAt: now,
                });
            }

            // 4. Stock & Assets Routing
            if (isCapex) {
                // Art. 31 Nº 5 LIR: Valor neto depreciable (sin contaminar OPEX diario de víveres)
                const lineNetClp =
                    params.documentType === 33
                        ? Math.round(pLine.subtotalClp / 1.19)
                        : Math.round(pLine.subtotalClp);
                const lineVatCreditClp =
                    params.documentType === 33 ? Math.max(0, Math.round(pLine.subtotalClp - lineNetClp)) : 0;

                const asset: SupplyAsset = {
                    assetId: `sasset_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
                    tenantId: params.tenantId,
                    siteId: params.siteId,
                    purchaseId,
                    name: pLine.description,
                    serialOrTag: pLine.serialOrTag,
                    acquisitionNetClp: lineNetClp,
                    vatCreditClp: lineVatCreditClp,
                    invoiceDteType: params.documentType,
                    invoiceFolio: params.folio,
                    supplierTaxId: params.supplierTaxId,
                    supplierName: params.supplierName,
                    evidenceCasRef: params.evidenceCasRef,
                    missingInvoiceAlert: params.documentType !== 33 && params.documentType !== 34,
                    costCenter: 'CC-CAPEX',
                    createdAt: now,
                    updatedAt: now,
                };
                await db.collection(SUPPLY_COLLECTIONS.ASSETS).doc(asset.assetId).set(asset);
                createdAssets.push(asset);
            } else if (
                pLine.destination === 'STOCK_IN_TRANSIT' ||
                pLine.destination === 'STOCK_IN_WAREHOUSE'
            ) {
                await this.applyInventoryDelta({
                    tenantId: params.tenantId,
                    siteId: params.siteId,
                    canonicalSkuId: pLine.canonicalSkuId,
                    itemName: pLine.description,
                    categoryCode: pLine.categoryCode,
                    procurementBucket: pLine.procurementBucket,
                    unitSi: pLine.unitSi,
                    inTransitDelta: pLine.destination === 'STOCK_IN_TRANSIT' ? pLine.qtyPurchased : 0,
                    inWarehouseDelta: pLine.destination === 'STOCK_IN_WAREHOUSE' ? pLine.qtyPurchased : 0,
                    unitCostClp: pLine.unitPriceClp,
                    movementType:
                        pLine.destination === 'STOCK_IN_TRANSIT'
                            ? 'INBOUND_IN_TRANSIT'
                            : 'INBOUND_WAREHOUSE_DIRECT',
                    referenceId: purchaseId,
                    actorUid: actor.actorUid,
                });
            }

            // 5. Cash Ledger imputation per line (separando isCapex para no contaminar OPEX alimentario)
            const lineVatCredit =
                params.documentType === 33
                    ? Math.round(pLine.subtotalClp - pLine.subtotalClp / 1.19)
                    : 0;
            const lineNet = Math.max(0, Math.round(pLine.subtotalClp - lineVatCredit));
            const cashEntry: CashLedgerEntry = {
                entryId: `cash_${crypto.randomBytes(5).toString('hex')}`,
                tenantId: params.tenantId,
                siteId: params.siteId,
                paymentMethod: params.paymentMethod,
                direction:
                    params.paymentMethod === 'REEMBOLSO_GERENCIA'
                        ? 'REIMBURSEMENT_DUE'
                        : 'EXPENSE_RENDERED',
                amountClp: Math.round(pLine.subtotalClp),
                netAmountClp: lineNet,
                vatCreditClp: lineVatCredit,
                isCapex,
                costCenter: isCapex ? 'CC-CAPEX' : pLine.costCenter || 'CC-CAMPAMENTO',
                referenceId: purchaseId,
                actorUid: actor.actorUid,
                description: `${pLine.description} (${pLine.qtyPurchased} ${pLine.unitSi}) · DTE ${params.documentType} #${params.folio}`,
                createdAt: now,
            };
            await db.collection(SUPPLY_COLLECTIONS.CASH_LEDGER).doc(cashEntry.entryId).set(cashEntry);
        }

        // Persistir allocations y requisiciones actualizadas
        for (const alloc of allocations) {
            await db.collection(SUPPLY_COLLECTIONS.FULFILLMENT_ALLOCATIONS).doc(alloc.allocationId).set(alloc);
        }
        for (const req of mutatedReqs.values()) {
            await db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(req.reqId).set(req, { merge: true });
        }

        await this.recordAudit(params.tenantId, actor, 'SUPPLY_PURCHASE_COMMITTED', purchaseId, {
            hitlConfirmed: true,
            purchaseMode: params.purchaseMode,
            dedupeKey,
            totalAmountClp: purchase.totalAmountClp,
            allocationsCount: allocations.length,
            createdAssetsCount: createdAssets.length,
            missingInvoiceAlert,
            casSha256: params.evidenceCasRef?.sha256 || null,
            casOriginalBytes: params.evidenceCasRef?.originalBytes || null,
            casOptimizedBytes: params.evidenceCasRef?.optimizedBytes || null,
            casSavingsPct: params.evidenceCasRef?.savingsPct || null,
        });

        return {
            purchase,
            siiDocument,
            allocations,
            createdAssets,
            updatedRequisitionIds: Array.from(mutatedReqs.keys()),
            missingInvoiceAlert,
        };
    }

    /**
     * Confirma recepción física en bodega: transiciona `qtyInTransit` -> `qtyInWarehouse`
     * y actualiza `qtyReceived` en requisiciones asignadas.
     */
    public static async confirmPurchaseReception(
        params: {
            tenantId: string;
            purchaseId: string;
            receivedLines?: Array<{ purchaseLineId: string; qtyReceived: number }>;
            notes?: string;
        },
        actor: AuditActorContext
    ): Promise<{
        purchase: SupplyPurchase;
        receivedItemCount: number;
        affectedRequisitions: SupplyRequisition[];
    }> {
        const ref = db.collection(SUPPLY_COLLECTIONS.PURCHASES).doc(params.purchaseId);
        const now = new Date().toISOString();
        const receivedMap = new Map(
            (params.receivedLines || []).map((r) => [r.purchaseLineId, r.qtyReceived])
        );

        let purchase!: SupplyPurchase;
        let hasDiscrepancy = false;

        // Bloqueo atómico anti doble-recepción (evita duplicar qtyInWarehouse y qtyReceived)
        const claimReception = async (tx?: any): Promise<void> => {
            const snap = tx ? await tx.get(ref) : await ref.get();
            if (!snap.exists) {
                throw new SupplyNotFoundError('Compra no encontrada.');
            }
            const loaded = snap.data() as SupplyPurchase;
            if (loaded.tenantId !== params.tenantId) {
                throw new SupplyNotFoundError('Compra no pertenece a la cuenta activa.');
            }
            if (loaded.receptionStatus === 'RECEIVED') {
                throw new SupplyConflictError(
                    'PURCHASE_ALREADY_RECEIVED',
                    'La recepción en bodega de esta compra ya fue confirmada previamente.'
                );
            }
            if (loaded.receptionStatus === 'NOT_APPLICABLE') {
                throw new SupplyConflictError(
                    'PURCHASE_RECEPTION_NOT_APPLICABLE',
                    'Esta compra no contiene ítems en tránsito pendientes de recepción en bodega.'
                );
            }

            purchase = loaded;
            for (const line of loaded.lines) {
                if (line.destination !== 'STOCK_IN_TRANSIT') continue;
                const qtyToReceive = receivedMap.has(line.purchaseLineId)
                    ? Math.max(0, Number(receivedMap.get(line.purchaseLineId)))
                    : line.qtyPurchased;
                if (qtyToReceive < line.qtyPurchased) {
                    hasDiscrepancy = true;
                }
            }

            const claimedPatch: Partial<SupplyPurchase> = {
                receptionStatus: hasDiscrepancy ? 'PARTIAL_DISCREPANCY' : 'RECEIVED',
                receivedAt: now,
                receivedByUid: actor.actorUid,
                updatedAt: now,
            };
            if (tx) {
                tx.set(ref, claimedPatch, { merge: true });
            } else {
                await ref.set(claimedPatch, { merge: true });
            }
        };

        if (typeof db.runTransaction === 'function') {
            await db.runTransaction(async (tx) => {
                await claimReception(tx);
            });
        } else {
            await claimReception();
        }

        let receivedItemCount = 0;

        for (const line of purchase.lines) {
            if (line.destination !== 'STOCK_IN_TRANSIT') continue;
            const qtyToReceive =
                receivedMap.has(line.purchaseLineId)
                    ? Math.max(0, Number(receivedMap.get(line.purchaseLineId)))
                    : line.qtyPurchased;

            if (qtyToReceive > 0) {
                receivedItemCount += 1;
                await this.applyInventoryDelta({
                    tenantId: params.tenantId,
                    siteId: purchase.siteId,
                    canonicalSkuId: line.canonicalSkuId,
                    itemName: line.description,
                    categoryCode: line.categoryCode,
                    procurementBucket: line.procurementBucket,
                    unitSi: line.unitSi,
                    inTransitDelta: -qtyToReceive,
                    inWarehouseDelta: qtyToReceive,
                    unitCostClp: line.unitPriceClp,
                    movementType: 'RECEPTION_CONFIRMED',
                    referenceId: purchase.purchaseId,
                    actorUid: actor.actorUid,
                });
            }
        }

        // Actualizar `qtyReceived` en requisiciones enlazadas mediante `supply_fulfillment_allocations`
        const allocSnap = await db
            .collection(SUPPLY_COLLECTIONS.FULFILLMENT_ALLOCATIONS)
            .where('tenantId', '==', params.tenantId)
            .where('purchaseId', '==', params.purchaseId)
            .get();

        const affectedReqIds = new Set<string>();
        const allocs = allocSnap.docs.map((d) => d.data() as FulfillmentAllocation);
        for (const alloc of allocs) {
            if (alloc.requisitionId !== 'UNSOLICITED_PURCHASE') {
                affectedReqIds.add(alloc.requisitionId);
            }
        }

        const affectedRequisitions: SupplyRequisition[] = [];
        for (const reqId of affectedReqIds) {
            const reqRef = db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(reqId);
            const reqSnap = await reqRef.get();
            if (!reqSnap.exists) continue;
            const reqData = reqSnap.data() as SupplyRequisition;
            if (reqData.tenantId !== params.tenantId) continue;

            const updatedLines = reqData.lines.map((l) => {
                const matchingAllocs = allocs.filter(
                    (a) => a.requisitionId === reqId && a.requisitionLineId === l.lineId
                );
                if (matchingAllocs.length === 0) return l;
                const addRec = matchingAllocs.reduce((acc, a) => acc + a.qtyAllocated, 0);
                return {
                    ...l,
                    qtyReceived: Math.min(l.qtyRequested, Number((l.qtyReceived + addRec).toFixed(3))),
                };
            });

            const updatedReq: SupplyRequisition = {
                ...reqData,
                lines: updatedLines,
                updatedAt: now,
            };
            await reqRef.set(updatedReq, { merge: true });
            affectedRequisitions.push(updatedReq);
        }

        const updatedPurchase: SupplyPurchase = {
            ...purchase,
            receptionStatus: hasDiscrepancy ? 'PARTIAL_DISCREPANCY' : 'RECEIVED',
            receivedAt: now,
            receivedByUid: actor.actorUid,
            updatedAt: now,
        };
        await ref.set(updatedPurchase, { merge: true });

        await this.recordAudit(params.tenantId, actor, 'SUPPLY_PURCHASE_RECEPTION_CONFIRMED', purchase.purchaseId, {
            hitlConfirmed: true,
            receptionStatus: updatedPurchase.receptionStatus,
            receivedItemCount,
            affectedRequisitionIds: Array.from(affectedReqIds),
        });

        return {
            purchase: updatedPurchase,
            receivedItemCount,
            affectedRequisitions,
        };
    }

    // -----------------------------------------------------------------------
    // Inventory (`supply_inventory_items`) & Stock Ledger (`supply_stock_ledger`)
    // -----------------------------------------------------------------------

    private static async applyInventoryDelta(params: {
        tenantId: string;
        siteId: string;
        canonicalSkuId: string;
        itemName: string;
        categoryCode: SupplyInventoryItem['categoryCode'];
        procurementBucket: SupplyInventoryItem['procurementBucket'];
        unitSi: SupplyInventoryItem['unitSi'];
        inTransitDelta: number;
        inWarehouseDelta: number;
        unitCostClp: number;
        movementType: StockLedgerEntry['movementType'];
        referenceId: string;
        actorUid: string;
    }): Promise<SupplyInventoryItem> {
        const now = new Date().toISOString();
        const docId = buildInventoryDocId(params.tenantId, params.siteId, params.canonicalSkuId);
        const ref = db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(docId);
        const snap = await ref.get();
        const existing = snap.exists ? (snap.data() as SupplyInventoryItem) : null;

        const nextInTransit = Math.max(
            0,
            Number(((existing?.qtyInTransit || 0) + params.inTransitDelta).toFixed(3))
        );
        const nextInWarehouse = Math.max(
            0,
            Number(((existing?.qtyInWarehouse || 0) + params.inWarehouseDelta).toFixed(3))
        );

        const prevQty = (existing?.qtyInWarehouse || 0) + (existing?.qtyInTransit || 0);
        const addedQty = Math.max(0, params.inTransitDelta + params.inWarehouseDelta);
        const avgUnitCostClp =
            addedQty > 0 && params.unitCostClp > 0
                ? Math.round(
                      ((existing?.avgUnitCostClp || 0) * prevQty + params.unitCostClp * addedQty) /
                          Math.max(1, prevQty + addedQty)
                  )
                : existing?.avgUnitCostClp || params.unitCostClp || 0;

        const record: SupplyInventoryItem = {
            inventoryKey: docId,
            tenantId: params.tenantId,
            siteId: params.siteId,
            canonicalSkuId: params.canonicalSkuId,
            itemName: existing?.itemName || params.itemName,
            categoryCode: existing?.categoryCode || params.categoryCode,
            procurementBucket: existing?.procurementBucket || params.procurementBucket,
            unitSi: existing?.unitSi || params.unitSi,
            qtyInTransit: nextInTransit,
            qtyInWarehouse: nextInWarehouse,
            avgUnitCostClp,
            dailyBurnRatePerPax: existing?.dailyBurnRatePerPax,
            updatedAt: now,
        };

        await ref.set(record, { merge: true });

        const ledgerEntry: StockLedgerEntry = {
            entryId: `stkl_${crypto.randomBytes(5).toString('hex')}`,
            tenantId: params.tenantId,
            siteId: params.siteId,
            canonicalSkuId: params.canonicalSkuId,
            movementType: params.movementType,
            qtyDelta: params.inWarehouseDelta !== 0 ? params.inWarehouseDelta : params.inTransitDelta,
            unitSi: params.unitSi,
            unitCostClp: params.unitCostClp,
            referenceId: params.referenceId,
            actorUid: params.actorUid,
            createdAt: now,
        };
        await db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(ledgerEntry.entryId).set(ledgerEntry);

        return record;
    }

    public static async listInventory(tenantId: string, siteId?: string): Promise<SupplyInventoryItem[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS)
            .where('tenantId', '==', tenantId)
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyInventoryItem);
        if (siteId) list = list.filter((i) => i.siteId === siteId);
        return list.sort((a, b) => a.itemName.localeCompare(b.itemName, 'es'));
    }

    // -----------------------------------------------------------------------
    // Assets (`supply_assets`) + OPERMAQ Link
    // -----------------------------------------------------------------------

    public static async listAssets(tenantId: string, siteId?: string): Promise<SupplyAsset[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.ASSETS)
            .where('tenantId', '==', tenantId)
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyAsset);
        if (siteId) list = list.filter((a) => a.siteId === siteId);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async linkAssetToOpermaq(
        tenantId: string,
        assetId: string,
        opermaqAssetId: string,
        actor: AuditActorContext
    ): Promise<SupplyAsset> {
        const ref = db.collection(SUPPLY_COLLECTIONS.ASSETS).doc(assetId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError('Activo patrimonial no encontrado.');
        }
        const existing = snap.data() as SupplyAsset;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError('Activo patrimonial no pertenece a la cuenta activa.');
        }

        const updated: SupplyAsset = {
            ...existing,
            opermaqAssetId: opermaqAssetId.trim(),
            updatedAt: new Date().toISOString(),
        };
        await ref.set(updated, { merge: true });

        await this.recordAudit(tenantId, actor, 'SUPPLY_ASSET_LINKED_OPERMAQ', assetId, {
            hitlConfirmed: true,
            opermaqAssetId: updated.opermaqAssetId,
        });
        return updated;
    }

    // -----------------------------------------------------------------------
    // Cash Ledger (`supply_cash_ledger`), SII Docs & Expense Reports
    // -----------------------------------------------------------------------

    public static async listCashLedger(tenantId: string, siteId?: string): Promise<CashLedgerEntry[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.CASH_LEDGER)
            .where('tenantId', '==', tenantId)
            .get();
        let list = snap.docs.map((d) => d.data() as CashLedgerEntry);
        if (siteId) list = list.filter((e) => e.siteId === siteId);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async recordCashLedgerEntry(
        entry: Omit<CashLedgerEntry, 'entryId' | 'createdAt'>,
        actor: AuditActorContext
    ): Promise<CashLedgerEntry> {
        const record: CashLedgerEntry = {
            ...entry,
            entryId: `cash_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
            createdAt: new Date().toISOString(),
        };
        await db.collection(SUPPLY_COLLECTIONS.CASH_LEDGER).doc(record.entryId).set(record);
        await this.recordAudit(record.tenantId, actor, 'SUPPLY_CASH_LEDGER_RECORDED', record.entryId, {
            hitlConfirmed: true,
            paymentMethod: record.paymentMethod,
            direction: record.direction,
            amountClp: record.amountClp,
            isCapex: record.isCapex,
        });
        return record;
    }

    public static async listSiiDocuments(
        tenantId: string,
        filters?: { siteId?: string; documentType?: number; missingInvoiceOnly?: boolean }
    ): Promise<SiiDocumentRecord[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS)
            .where('tenantId', '==', tenantId)
            .get();
        let list = snap.docs.map((d) => {
            const raw = d.data() as SiiDocumentRecord;
            const refreshedDeadline = computeRcvDeadline(raw.issueDate, raw.documentType);
            return {
                ...raw,
                rcvDeadlineDate: refreshedDeadline.rcvDeadlineDate,
                rcvDaysRemaining: refreshedDeadline.rcvDaysRemaining,
            };
        });
        if (filters?.siteId) list = list.filter((d) => d.siteId === filters.siteId);
        if (typeof filters?.documentType === 'number') {
            list = list.filter((d) => d.documentType === filters.documentType);
        }
        if (filters?.missingInvoiceOnly) {
            list = list.filter((d) => d.missingInvoiceForCapex);
        }
        return list.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    }

    public static async listExpenseReports(tenantId: string, siteId?: string): Promise<SiiExpenseReport[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS)
            .where('tenantId', '==', tenantId)
            .get();
        let list = snap.docs.map((d) => d.data() as SiiExpenseReport);
        if (siteId) list = list.filter((r) => r.siteId === siteId);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async createExpenseReport(
        input: {
            tenantId: string;
            siteId: string;
            custodianUid: string;
            custodianName: string;
            paymentMethod: PaymentMethod;
            title: string;
            periodLabel?: string;
            costCenter?: string;
            fundAdvanceClp: number;
            siiDocumentIds: string[];
        },
        actor: AuditActorContext
    ): Promise<SiiExpenseReport> {
        const now = new Date().toISOString();
        const reportId = `expr_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

        const allDocs = await this.listSiiDocuments(input.tenantId, { siteId: input.siteId });
        const selectedDocs = allDocs.filter((d) => input.siiDocumentIds.includes(d.docId));
        const renderedTotalClp = selectedDocs.reduce((acc, d) => acc + Number(d.totalAmountClp || 0), 0);
        const balanceClp = Math.round(input.fundAdvanceClp - renderedTotalClp);

        const report: SiiExpenseReport = {
            reportId,
            tenantId: input.tenantId,
            siteId: input.siteId,
            custodianUid: input.custodianUid,
            custodianName: input.custodianName,
            paymentMethod: input.paymentMethod,
            title: input.title,
            periodLabel: input.periodLabel,
            costCenter: (input.costCenter || 'CC-CAMPAMENTO').trim() || 'CC-CAMPAMENTO',
            fundAdvanceClp: Math.round(input.fundAdvanceClp),
            renderedTotalClp: Math.round(renderedTotalClp),
            balanceClp,
            siiDocumentIds: selectedDocs.map((d) => d.docId),
            status: 'SUBMITTED',
            createdAt: now,
            updatedAt: now,
        };

        await db.collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).doc(reportId).set(report);
        for (const doc of selectedDocs) {
            await db
                .collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS)
                .doc(doc.docId)
                .set({ expenseReportId: reportId, updatedAt: now }, { merge: true });
        }

        await this.recordAudit(input.tenantId, actor, 'SUPPLY_EXPENSE_REPORT_CREATED', reportId, {
            hitlConfirmed: true,
            fundAdvanceClp: report.fundAdvanceClp,
            renderedTotalClp: report.renderedTotalClp,
            balanceClp: report.balanceClp,
            siiDocumentCount: selectedDocs.length,
        });
        return report;
    }

    public static async updateExpenseReportStatus(
        tenantId: string,
        reportId: string,
        status: SiiExpenseReport['status'],
        actor: AuditActorContext
    ): Promise<SiiExpenseReport> {
        const ref = db.collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).doc(reportId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError('Rendición SII no encontrada.');
        }
        const existing = snap.data() as SiiExpenseReport;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError('Rendición SII no pertenece a la cuenta activa.');
        }

        const updated: SiiExpenseReport = {
            ...existing,
            status,
            updatedAt: new Date().toISOString(),
        };
        await ref.set(updated, { merge: true });
        await this.recordAudit(tenantId, actor, 'SUPPLY_EXPENSE_REPORT_STATUS_UPDATED', reportId, {
            hitlConfirmed: true,
            status,
        });
        return updated;
    }

    // -----------------------------------------------------------------------
    // Demand Forecast (`supply_demand_forecasts` — DS 594 Art. 14 + EWMA)
    // -----------------------------------------------------------------------

    public static async computeAndStoreForecast(tenantId: string, siteId?: string): Promise<DemandForecast[]> {
        const sites = siteId
            ? ([await this.getSite(tenantId, siteId)].filter(Boolean) as SupplySite[])
            : await this.listSites(tenantId);

        const effectiveSites: SupplySite[] =
            sites.length > 0
                ? sites
                : [
                      {
                          siteId: siteId || 'default-site',
                          tenantId,
                          name: 'Faena Principal',
                          districtCode: 'CL-ANTOFAGASTA',
                          shiftPattern: '7x7',
                          currentHeadcount: 20,
                          waterStorageCapacityL: 20000,
                          ds594DailyWaterTargetLPerPax: 120,
                          leadTimeDays: 7,
                          marketplaceOptIn: false,
                          roleMismatchMode: 'FLAG_AND_ACCEPT',
                          directPurchaseAlertThresholdClp: 500000,
                      },
                  ];

        const forecasts: DemandForecast[] = [];
        const now = new Date().toISOString();

        for (const site of effectiveSites) {
            const [inventory, cashEntries] = await Promise.all([
                this.listInventory(tenantId, site.siteId),
                this.listCashLedger(tenantId, site.siteId),
            ]);

            const headcount = Math.max(0, Number(site.currentHeadcount || 0));
            const leadTimeDays = Math.max(1, Number(site.leadTimeDays || 7));
            const altitudeM = Number(site.geoFix?.altitudeM || 0);
            const altitudeMultiplier = altitudeM > 3000 ? 1.15 : 1.0; // DS 28 hipobaria gran altitud
            const ds594Target = Math.max(100, Number(site.ds594DailyWaterTargetLPerPax || 120));

            const dailyWaterNeedL = headcount * ds594Target * altitudeMultiplier;
            const requiredWaterReserveL = Math.round(dailyWaterNeedL * leadTimeDays);
            const waterStorageCapacityL = Math.round(Number(site.waterStorageCapacityL || 0));
            const waterCoverageDays =
                dailyWaterNeedL > 0
                    ? Number((waterStorageCapacityL / dailyWaterNeedL).toFixed(2))
                    : 999;

            const waterAlertLevel: DemandForecast['waterAlertLevel'] =
                headcount > 0 && waterCoverageDays < leadTimeDays
                    ? waterCoverageDays < Math.max(2, leadTimeDays * 0.5)
                        ? 'CRITICAL'
                        : 'WARNING'
                    : 'NOMINAL';

            // OPEX diario alimentario por persona (excluyendo estrictamente isCapex === true)
            const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const foodOpex30d = cashEntries
                .filter(
                    (e) =>
                        !e.isCapex &&
                        e.costCenter === 'CC-CAMPAMENTO' &&
                        Date.parse(e.createdAt) >= thirtyDaysAgoMs
                )
                .reduce((acc, e) => acc + e.netAmountClp, 0);

            const dailyFoodOpexClpPerPax =
                headcount > 0 && foodOpex30d > 0 ? Math.round(foodOpex30d / (30 * headcount)) : null;

            const items: DemandForecastLine[] = inventory.map((inv) => {
                const defaultPerPax =
                    inv.categoryCode === 'AGUA_POTABLE'
                        ? ds594Target * altitudeMultiplier
                        : inv.categoryCode === 'VIVERES_ALIMENTACION'
                          ? 0.35
                          : 0.05;
                const ewmaDailyRate = Number(
                    ((inv.dailyBurnRatePerPax ?? defaultPerPax) * Math.max(1, headcount)).toFixed(3)
                );
                const totalAvailable = inv.qtyInWarehouse + inv.qtyInTransit;
                const doi = ewmaDailyRate > 0 ? Number((totalAvailable / ewmaDailyRate).toFixed(1)) : null;
                const targetBuffer = ewmaDailyRate * leadTimeDays * 1.25;
                const recommendedReorderQty = Math.max(0, Number((targetBuffer - totalAvailable).toFixed(2)));

                const riskLevel: DemandForecastLine['riskLevel'] =
                    doi !== null && doi < leadTimeDays * 0.5
                        ? 'CRITICAL'
                        : doi !== null && doi < leadTimeDays
                          ? 'WARNING'
                          : 'NOMINAL';

                return {
                    canonicalSkuId: inv.canonicalSkuId,
                    itemName: inv.itemName,
                    categoryCode: inv.categoryCode,
                    unitSi: inv.unitSi,
                    qtyInWarehouse: inv.qtyInWarehouse,
                    qtyInTransit: inv.qtyInTransit,
                    ewmaDailyRate,
                    daysOfInventory: doi,
                    recommendedReorderQty,
                    riskLevel,
                };
            });

            const forecastId = `fcst_${safeDocIdPart(tenantId)}_${safeDocIdPart(site.siteId)}`;
            const forecast: DemandForecast = {
                forecastId,
                tenantId,
                siteId: site.siteId,
                headcount,
                leadTimeDays,
                altitudeM,
                altitudeMultiplier,
                ds594WaterTargetLPerPax: ds594Target,
                requiredWaterReserveL,
                waterStorageCapacityL,
                waterCoverageDays,
                waterAlertLevel,
                dailyFoodOpexClpPerPax,
                items,
                computedAt: now,
            };

            await db.collection(SUPPLY_COLLECTIONS.DEMAND_FORECASTS).doc(forecastId).set(forecast);
            forecasts.push(forecast);
        }

        return forecasts;
    }

    // -----------------------------------------------------------------------
    // Marketplace Anonymous Demand Signals (`market_demand_signals` — k >= 3)
    // -----------------------------------------------------------------------

    /**
     * Proyecta señales anónimas de demanda agregada por distrito minero (Ley N° 21.719):
     * - Exige opt-in explícito del sitio (`marketplaceOptIn === true`).
     * - Impone anonimato k >= 3 estricto: mínimo 3 TENANTS distintos Y 3 SITIOS distintos
     *   por distrito+SKU (un solo tenant con 3 faenas JAMÁS puede emitir una señal).
     * - CERO `tenantId`, CERO `siteId`, CERO coordenadas GPS exactas.
     */
    public static async refreshAnonymousDemandSignals(): Promise<DemandPoolSignal[]> {
        const sitesSnap = await db
            .collection(SUPPLY_COLLECTIONS.SITES)
            .where('marketplaceOptIn', '==', true)
            .get();

        const optedSitesByKey = new Map<
            string,
            { districtCode: string; tenantKey: string; siteKey: string }
        >();
        for (const doc of sitesSnap.docs) {
            const s = doc.data() as SupplySite;
            if (!s.marketplaceOptIn || !s.districtCode || !s.tenantId || !s.siteId) continue;
            optedSitesByKey.set(`${s.tenantId}::${s.siteId}`, {
                districtCode: s.districtCode.trim().toUpperCase(),
                tenantKey: s.tenantId.trim(),
                siteKey: `${s.tenantId}::${s.siteId}`,
            });
        }

        const reqsSnap = await db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).limit(1000).get();
        const buckets = new Map<
            string,
            {
                districtCode: string;
                categoryCode: DemandPoolSignal['categoryCode'];
                procurementBucket: DemandPoolSignal['procurementBucket'];
                canonicalSkuId: string;
                skuName: string;
                unitSi: DemandPoolSignal['unitSi'];
                aggregatedQty: number;
                distinctTenants: Set<string>;
                distinctSites: Set<string>;
            }
        >();

        for (const doc of reqsSnap.docs) {
            const req = doc.data() as SupplyRequisition;
            if (req.status !== 'OPEN' && req.status !== 'PARTIAL') continue;
            const siteMeta = optedSitesByKey.get(`${req.tenantId}::${req.siteId}`);
            if (!siteMeta) continue;

            for (const line of req.lines) {
                if (line.lineStatus === 'FULFILLED' || line.lineStatus === 'CANCELLED') continue;
                if (line.qtyPending <= 0) continue;

                const key = `${siteMeta.districtCode}::${line.canonicalSkuId}`;
                const existing = buckets.get(key);
                if (!existing) {
                    buckets.set(key, {
                        districtCode: siteMeta.districtCode,
                        categoryCode: line.categoryCode,
                        procurementBucket: line.procurementBucket,
                        canonicalSkuId: line.canonicalSkuId,
                        skuName: line.itemName,
                        unitSi: line.unitSi,
                        aggregatedQty: line.qtyPending,
                        distinctTenants: new Set([siteMeta.tenantKey]),
                        distinctSites: new Set([siteMeta.siteKey]),
                    });
                } else {
                    existing.aggregatedQty = Number((existing.aggregatedQty + line.qtyPending).toFixed(3));
                    existing.distinctTenants.add(siteMeta.tenantKey);
                    existing.distinctSites.add(siteMeta.siteKey);
                }
            }
        }

        const now = new Date();
        const windowStartIso = now.toISOString();
        const windowEndIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const periodWindow = `${windowStartIso.slice(0, 10)}/${windowEndIso.slice(0, 10)}`;
        const emitted: DemandPoolSignal[] = [];

        for (const entry of buckets.values()) {
            // Compuerta estricta Ley N° 21.719: >= 3 tenants distintos Y >= 3 sitios distintos
            if (entry.distinctTenants.size < 3 || entry.distinctSites.size < 3) {
                continue;
            }
            const signalId = `sig_${safeDocIdPart(entry.districtCode)}_${safeDocIdPart(entry.canonicalSkuId)}`;
            const signal: DemandPoolSignal = {
                signalId,
                districtCode: entry.districtCode,
                periodWindow,
                canonicalSkuId: entry.canonicalSkuId,
                skuName: entry.skuName,
                categoryCode: entry.categoryCode,
                procurementBucket: entry.procurementBucket,
                unitSi: entry.unitSi,
                aggregatedQty: entry.aggregatedQty,
                participatingEntitiesCount: entry.distinctTenants.size,
                optInVerified: true,
                generatedAt: windowStartIso,
                expiresAt: windowEndIso,
            };
            await db.collection(SUPPLY_COLLECTIONS.MARKET_DEMAND_SIGNALS).doc(signalId).set(signal);
            emitted.push(signal);
        }

        return emitted.sort((a, b) => b.aggregatedQty - a.aggregatedQty);
    }

    public static async listAnonymousDemandSignals(filters?: {
        districtCode?: string;
        categoryCode?: string;
    }): Promise<DemandPoolSignal[]> {
        const snap = await db.collection(SUPPLY_COLLECTIONS.MARKET_DEMAND_SIGNALS).limit(500).get();
        let list = snap.docs
            .map((d) => d.data() as Record<string, any>)
            // Defensa en profundidad: jamás exponer registros con k < 3 o sin opt-in
            .filter((s) => {
                const entities = Number(s.participatingEntitiesCount ?? 0);
                return entities >= 3 && s.optInVerified === true;
            })
            // Strip estricto 1:1 con #9 DemandPoolSignalSchema.strict() (cero tenantId/GPS)
            .map((s): DemandPoolSignal => {
                const skuName = String(s.skuName || s.itemName || 'Insumo');
                const entities = Number(s.participatingEntitiesCount ?? 3);
                const generatedAt = String(s.generatedAt || new Date().toISOString());
                const expiresAt = String(s.expiresAt || generatedAt);
                return {
                    signalId: String(s.signalId),
                    districtCode: String(s.districtCode),
                    periodWindow: String(
                        s.periodWindow || `${generatedAt.slice(0, 10)}/${expiresAt.slice(0, 10)}`
                    ),
                    canonicalSkuId: String(s.canonicalSkuId),
                    skuName,
                    categoryCode: s.categoryCode,
                    procurementBucket: s.procurementBucket || 'SUPERMERCADO',
                    unitSi: s.unitSi,
                    aggregatedQty: Number(s.aggregatedQty || 0),
                    participatingEntitiesCount: entities,
                    optInVerified: true,
                    ...(typeof s.medianReferenceUnitClp === 'number'
                        ? { medianReferenceUnitClp: s.medianReferenceUnitClp }
                        : {}),
                    generatedAt,
                    expiresAt,
                };
            });

        if (filters?.districtCode) {
            const target = filters.districtCode.trim().toUpperCase();
            list = list.filter((s) => s.districtCode.toUpperCase() === target);
        }
        if (filters?.categoryCode) {
            list = list.filter((s) => s.categoryCode === filters.categoryCode);
        }

        return list.sort((a, b) => b.aggregatedQty - a.aggregatedQty);
    }
}
