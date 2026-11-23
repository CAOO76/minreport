import crypto from 'crypto';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import {
    computeShortTtlTimestamp,
    computeSixYearRetentionTimestamp,
} from '../../../core/retention-policy';
import {
    DEFAULT_SUPPLY_CATALOG_SEED,
    findCanonicalSkuById as findDomainCanonicalSkuById,
    matchCanonicalSkuByText as matchDomainCanonicalSkuByText,
} from '../catalog/DefaultSupplyCatalogSeed';
import {
    LEY21719_MIN_K_ANONYMITY,
    type TenantDemandObservation,
    calculateDynamicReorderPoint,
    computeSupplyBusinessUnitKpis,
    evaluateDs594FromPotableTanks,
    evaluateDs594WaterGuardrail,
    forecastSkuDemand,
    isHumanPotableWaterCategory,
    isSandboxTenantId,
    projectAnonymousDemandSignals,
} from '../domain/DemandAndCostForecaster';
import {
    ConfirmWarehouseReceptionV3RequestSchema,
    CreateSupplyWarehouseRequestSchema,
    ReconciliationCommit4WayRequestSchema,
    ReconciliationProposalSchema,
    ReconciliationProposeRequestSchema,
    RecordStockMovementRequestSchema,
    type ReconciliationProposal,
    type SupplyAnomalyAlert,
    type SupplyBusinessUnitKpis,
    type SupplyReceptionDiscrepancy,
    type SupplyTankTelemetry,
    type SupplyWarehouse,
    type SupplyWarehouseBalance,
    TankCycleCountRequestSchema,
    normalizeLegacyProcurementBucket,
    normalizeLegacySupplyCategoryCode,
} from '../../../contracts/supply.contracts';
import {
    detectRuralReceiptDuplicate,
    matchPurchaseToRequisitions,
} from '../domain/RequisitionFulfillmentMatcher';
import {
    buildSiiDedupeKey as buildDomainSiiDedupeKey,
    computeChileanVatBreakdown,
    computeRcvAcceptanceDeadline,
    isValidPositiveFolio,
    parseSiiXmlDte,
    validateSiiDocumentForPurchase,
} from '../domain/SiiTaxValidator';
import { consolidateRequisitionsToShoppingList } from '../domain/SmartShoppingListConsolidator';
import {
    confirmWarehouseReception,
    prorateLandedCosts,
    reconcilePurchase,
} from '../domain/StockAssetCashCostReconciler';
import {
    type SplitInvoiceSmurfingResult,
    detectPriceAndShrinkflationAnomalies,
    detectSplitInvoiceSmurfing,
} from '../domain/SupplyPolicyAndAnomalyEngine';
import {
    FuelOpermaqTelemetryReconciler,
    type FuelDispatchAuditResult,
} from './FuelOpermaqTelemetryReconciler';
import {
    SemanticRequisitionMatcher,
    TENANT_SUPPLIER_SKU_MAP_COLLECTION,
    proposeSemanticReconciliation,
    type DecideFn,
    type EmbedTextFn,
} from './SemanticRequisitionMatcher';
import type {
    RequisitionLineStatus as DomainRequisitionLineStatus,
    RequisitionStatus as DomainRequisitionStatus,
    SupplyPurchase as DomainSupplyPurchase,
    SupplyRequisition as DomainSupplyRequisition,
    SupplySite as DomainSupplySite,
    SupplyUrgency as DomainSupplyUrgency,
} from '../domain/types';
import { getTaxJurisdictionAdapter } from '../ports/ITaxJurisdictionAdapter';
import {
    type AtypicalFlagCode,
    BRIDGE_CATALOG_RULES,
    type CanonicalSupplySku,
    type CashLedgerEntry,
    type ConsolidatedShoppingBucket,
    type ConsolidatedShoppingItem,
    type ConsolidatedShoppingList,
    type DemandForecast,
    type DemandForecastLine,
    type DemandPoolSignal,
    type EvidenceCasRef,
    type FulfillmentAllocation,
    type PaymentMethod,
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
    normalizeLegacyCostCenter,
} from './supply.types';

/**
 * SUPPLY REPOSITORY (Capa 5 — Base de Datos Única Cloud Firestore `southamerica-west1`)
 *
 * Gobierna la persistencia multi-tenant de MINREPORT · ABASTECIMIENTO con aislamiento
 * estricto por `tenantId`, anti-duplicación tributaria SII (con validación RSA-SHA1/DL 825),
 * conciliación FIFO N:M (`RequisitionFulfillmentMatcher` + `StockAssetCashCostReconciler`),
 * separación patrimonial CAPEX (`supply_assets` + `event_ledger`), pronóstico DS 594 sobre
 * stock real (`DemandAndCostForecaster`), auditoría de políticas (`supply_policy_audit`),
 * anonimato `k >= 5` B2B para Marketplace y trazabilidad criptográfica en `AuditLedger`.
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
    WAREHOUSES: 'supply_warehouses',
    WAREHOUSE_BALANCES: 'supply_warehouse_balances',
    TANK_TELEMETRY: 'supply_tank_telemetry',
    RECEPTION_DISCREPANCIES: 'supply_reception_discrepancies',
    STOCK_LEDGER: 'supply_stock_ledger',
    CASH_LEDGER: 'supply_cash_ledger',
    SII_DOCUMENTS: 'supply_sii_documents',
    EXPENSE_REPORTS: 'supply_expense_reports',
    DEMAND_FORECASTS: 'supply_demand_forecasts',
    MARKET_DEMAND_SIGNALS: 'market_demand_signals',
    POLICY_AUDIT: 'supply_policy_audit',
    EVENT_LEDGER: 'event_ledger',
    WHATSAPP_SESSIONS: 'supply_whatsapp_sessions',
    WHATSAPP_WAMIDS: 'supply_whatsapp_wamids',
    CHANNEL_GRANTS: 'supply_channel_grants',
    CONVERSATION_THREADS: 'supply_conversation_threads',
    CONVERSATION_TURNS: 'supply_conversation_turns',
    TENANT_SUPPLIER_SKU_MAP: TENANT_SUPPLIER_SKU_MAP_COLLECTION,
} as const;

export interface SupplyPolicyAuditEntry {
    auditId: string;
    tenantId: string;
    siteId?: string;
    actorUid: string;
    eventType:
        | 'POLICY_HARD_DENY'
        | 'DGMN_EXPLOSIVES_BLOCK'
        | 'ROLE_MISMATCH_BLOCK'
        | 'ATYPICAL_FLAG'
        | 'SPLIT_INVOICE_SMURFING'
        | 'SII_FISCAL_WARNING';
    policyCode: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    entityId?: string;
    rawItemText?: string;
    details: Record<string, unknown>;
    createdAt: string;
}

export type DemandForecastWithRealWater = DemandForecast & {
    availableWaterL: number;
    waterStoredL: number;
    waterInTransitL: number;
    ds594Compliant: boolean;
    waterDeficitL: number;
    storageCapacitySufficient: boolean;
};

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

export class SupplyValidationError extends Error {
    public readonly statusCode = 400;
    public readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'SupplyValidationError';
        this.code = code;
    }
}

type PurchaseLineWithReceptionProgress = SupplyPurchaseLine & {
    qtyReceivedSoFar?: number;
};

export interface AuditActorContext {
    actorUid: string;
    actorEmail: string;
    ipAddress?: string;
}

export const WHATSAPP_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const WHATSAPP_WAMID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;

export function resolveListLimit(requested?: number, fallback: number = DEFAULT_LIST_LIMIT): number {
    if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
        return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(fallback)));
    }
    return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(requested)));
}

/**
 * Enmascara teléfono E.164 para minimización PII Ley N° 21.719 (ej. `+56900001234` -> `+569****1234`).
 */
export function maskPhoneE164(rawPhone?: string | null): string | undefined {
    const clean = String(rawPhone || '').trim();
    if (!clean) return undefined;
    const compact = clean.replace(/\s+/g, '');
    if (compact.includes('****')) return compact;
    if (compact.length <= 4) return '****';
    const prefixLen = compact.startsWith('+')
        ? Math.min(4, compact.length - 4)
        : Math.min(3, compact.length - 4);
    return `${compact.slice(0, Math.max(0, prefixLen))}****${compact.slice(-4)}`;
}

/**
 * Huella determinista SHA-256 del teléfono E.164 para correlación ARCO-P sin persistir texto plano.
 */
export function hashPhoneE164(rawPhone?: string | null): string | undefined {
    const clean = String(rawPhone || '').trim();
    if (!clean) return undefined;
    return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Calcula retención legal de 6 años ISO-8601 UTC (Art. 17 Código Tributario de Chile).
 */
export function computeSixYearRetentionIso(baseIsoOrDate?: string): string {
    const parsedMs = baseIsoOrDate ? Date.parse(baseIsoOrDate) : NaN;
    const baseMs = Number.isFinite(parsedMs) ? parsedMs : Date.now();
    const ts = computeSixYearRetentionTimestamp(baseMs);
    return new Date(ts.toMillis()).toISOString();
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

function buildWarehouseBalanceDocId(
    tenantId: string,
    siteId: string,
    warehouseId: string,
    canonicalSkuId: string
): string {
    return `${safeDocIdPart(tenantId)}__${safeDocIdPart(siteId)}__${safeDocIdPart(warehouseId)}__${safeDocIdPart(canonicalSkuId)}`;
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

function toDomainUrgency(urgency: string | undefined): DomainSupplyUrgency {
    if (urgency === 'CRITICAL' || urgency === 'HIGH' || urgency === 'STANDARD' || urgency === 'PLANNED') {
        return urgency;
    }
    return 'PLANNED';
}

function toDomainLineStatus(status: string | undefined): DomainRequisitionLineStatus {
    if (status === 'OPEN' || status === 'PARTIAL' || status === 'FULFILLED' || status === 'CANCELLED') {
        return status;
    }
    return 'OPEN';
}

function toDomainReqStatus(status: string | undefined): DomainRequisitionStatus {
    if (
        status === 'DRAFT' ||
        status === 'OPEN' ||
        status === 'PARTIAL' ||
        status === 'FULFILLED' ||
        status === 'CANCELLED' ||
        status === 'CLOSED' ||
        status === 'PENDING_REVIEW'
    ) {
        return status;
    }
    return 'OPEN';
}

function mapAppReqToDomain(req: SupplyRequisition): DomainSupplyRequisition {
    return {
        reqId: req.reqId,
        tenantId: req.tenantId,
        siteId: req.siteId,
        requesterUid: req.requesterUid,
        requesterName: req.requesterName,
        requesterRole: req.requesterRole,
        demandOrigin: req.demandOrigin,
        demandNature: req.demandNature,
        costCenter: req.costCenter,
        linkedAssetId: req.linkedAssetId,
        linkedPlanRef: req.linkedPlanRef,
        status: toDomainReqStatus(req.status),
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
        lines: req.lines.map((l) => ({
            lineId: l.lineId,
            canonicalSkuId: l.canonicalSkuId,
            description: l.itemName,
            categoryCode: l.categoryCode,
            procurementBucket: l.procurementBucket,
            unitSi: l.unitSi,
            qtyRequested: l.qtyRequested,
            qtyPurchased: l.qtyPurchased,
            qtyReceived: l.qtyReceived,
            qtyPending: l.qtyPending,
            lineStatus: toDomainLineStatus(l.lineStatus),
            atypicalFlags: [...(l.atypicalFlags || [])],
            fulfillmentChannel: l.fulfillmentChannel,
            urgency: toDomainUrgency(l.urgency),
            estimatedUnitClp: l.estimatedUnitClp,
            attributes: l.attributes,
        })),
    };
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

    /**
     * Persiste registro inmutable de auditoría de políticas (`supply_policy_audit`)
     * para bloqueos DS 132, explosivos DGMN Ley N° 17.798, banderas atípicas y smurfing.
     */
    public static async recordPolicyAudit(
        input: Omit<SupplyPolicyAuditEntry, 'auditId' | 'createdAt'>
    ): Promise<SupplyPolicyAuditEntry> {
        const now = new Date().toISOString();
        const auditId = `paud_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const record: SupplyPolicyAuditEntry = {
            ...input,
            auditId,
            createdAt: now,
        };
        await db.collection(SUPPLY_COLLECTIONS.POLICY_AUDIT).doc(auditId).set(record);
        return record;
    }

    // -----------------------------------------------------------------------
    // Sites (`supply_sites`)
    // -----------------------------------------------------------------------

    public static async listSites(tenantId: string, limit?: number): Promise<SupplySite[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.SITES)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
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
            const bridgeItems: CanonicalSupplySku[] = BRIDGE_CATALOG_RULES.map((r) => ({
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
            const seenIds = new Set(bridgeItems.map((i) => i.canonicalSkuId));
            const seedItems: CanonicalSupplySku[] = DEFAULT_SUPPLY_CATALOG_SEED.filter(
                (seed) => !seenIds.has(seed.canonicalSkuId)
            ).map((seed) => ({
                canonicalSkuId: seed.canonicalSkuId,
                name: seed.name,
                categoryCode: seed.categoryCode,
                procurementBucket: seed.procurementBucket,
                baseUnitSi: seed.baseUnitSi,
                unspscCode: seed.unspscCode,
                requiredSlots: [...seed.requiredSlots],
                defaultPackToSi: seed.defaultPackToSi?.factorToSi,
                isCapexAsset: seed.isCapexAsset,
                isControlled: seed.isControlled,
                leySaco25kgApplied: seed.leySaco25kgApplied,
                aliases: [...seed.aliases],
            }));
            items = [...bridgeItems, ...seedItems];
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

    /**
     * Resuelve un SKU canónico usando `DefaultSupplyCatalogSeed` (por ID o texto libre).
     */
    public static resolveCanonicalSkuFromSeed(rawIdOrText: string) {
        return (
            findDomainCanonicalSkuById(rawIdOrText) ||
            matchDomainCanonicalSkuByText(rawIdOrText)
        );
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
        filters?: { siteId?: string; status?: RequisitionStatus; origin?: string; limit?: number }
    ): Promise<SupplyRequisition[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.REQUISITIONS)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit))
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

        const requesterPhoneMasked = maskPhoneE164(input.requesterPhoneE164);
        const requesterPhoneHash = hashPhoneE164(input.requesterPhoneE164);

        const record: SupplyRequisition & {
            requesterPhoneMasked?: string;
            requesterPhoneHash?: string;
        } = {
            ...input,
            reqId,
            // Ley N° 21.719 minimización PII: jamás persistir teléfono E.164 en texto plano dentro de `supply_requisitions`
            requesterPhoneE164: requesterPhoneMasked,
            ...(requesterPhoneMasked ? { requesterPhoneMasked } : {}),
            ...(requesterPhoneHash ? { requesterPhoneHash } : {}),
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
        const reqRoleById = new Map<string, SupplyOperationalRole>(
            reqs.map((r) => [r.reqId, r.requesterRole])
        );
        const domainReqs = reqs.map(mapAppReqToDomain);
        const domainConsolidated = consolidateRequisitionsToShoppingList(domainReqs, {
            tenantId,
            siteId: siteId || '',
        });

        let totalPendingLines = 0;
        const buckets: ConsolidatedShoppingBucket[] = domainConsolidated.buckets.map((bucket) => {
            const items: ConsolidatedShoppingItem[] = bucket.items.map((item) => {
                totalPendingLines += item.sourceReqRefs.length;
                return {
                    canonicalSkuId: item.canonicalSkuId,
                    itemName: item.name,
                    categoryCode: item.categoryCode,
                    procurementBucket: item.procurementBucket,
                    unitSi: item.unitSi,
                    totalQtyPending: item.totalQtyPending,
                    highestUrgency: item.highestUrgency,
                    hasPartialPending: item.hasPartialPending,
                    atypicalCount: item.atypicalCount,
                    estimatedClp: item.estimatedClp,
                    sourceReqRefs: item.sourceReqRefs.map((ref) => ({
                        reqId: ref.reqId,
                        lineId: ref.lineId,
                        costCenter: ref.costCenter,
                        requesterRole: reqRoleById.get(ref.reqId) || 'CAMP_MANAGER',
                        qtyPending: ref.qtyPending,
                        urgency: ref.urgency,
                        atypicalFlags: ref.atypicalFlags,
                    })),
                };
            });
            return {
                procurementBucket: bucket.procurementBucket,
                itemCount: items.length,
                atypicalCount: bucket.totalAtypicalCount,
                estimatedBucketClp: bucket.estimatedBucketClp,
                items,
            };
        });

        return {
            tenantId,
            siteId,
            generatedAt: domainConsolidated.generatedAt,
            openRequisitionCount: domainConsolidated.sourceRequisitionCount,
            totalPendingLines,
            totalEstimatedClp: domainConsolidated.totalEstimatedClp,
            buckets,
        };
    }

    // -----------------------------------------------------------------------
    // SII Duplicate Check & Purchases + FIFO N:M Reconciliation + Assets + Ledgers
    // -----------------------------------------------------------------------

    public static async existsSiiDocument(tenantId: string, dedupeKey: string): Promise<boolean> {
        const docId = buildSiiDocId(tenantId, dedupeKey);
        const snap = await db.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(docId).get();
        return snap.exists;
    }

    public static async listPurchases(
        tenantId: string,
        siteId?: string,
        limit?: number
    ): Promise<SupplyPurchase[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.PURCHASES)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyPurchase);
        if (siteId) list = list.filter((p) => p.siteId === siteId);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    private static computeNextInventoryState(
        existing: SupplyInventoryItem | null,
        params: {
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
            now: string;
        }
    ): { docId: string; record: SupplyInventoryItem; ledgerEntry: StockLedgerEntry } {
        const docId = buildInventoryDocId(params.tenantId, params.siteId, params.canonicalSkuId);
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
            updatedAt: params.now,
        };

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
            createdAt: params.now,
        };

        return { docId, record, ledgerEntry };
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
            expectedReceiverTaxId?: string;
            countryCode?: string;
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
        tedRsaVerified?: boolean | null;
        smurfingAlert?: SplitInvoiceSmurfingResult;
    }> {
        const now = new Date().toISOString();

        // 1. Validación fiscal determinista vía `SiiTaxValidator` + puerto `ITaxJurisdictionAdapter`
        if (params.documentType !== 0 && (!Number.isInteger(params.folio) || !isValidPositiveFolio(String(params.folio)))) {
            throw new SupplyValidationError(
                'FOLIO_MUST_BE_POSITIVE',
                `FOLIO_MUST_BE_POSITIVE: El folio tributario debe ser mayor que cero para DTE ${params.documentType}.`
            );
        }

        const taxAdapter = getTaxJurisdictionAdapter(params.countryCode || 'CL');
        if (params.documentType !== 0 && taxAdapter.countryCode === 'CL') {
            const rutValidation = taxAdapter.validateTaxId(params.supplierTaxId);
            if (!rutValidation.valid) {
                throw new SupplyValidationError(
                    'INVALID_SUPPLIER_TAX_ID',
                    `INVALID_SUPPLIER_TAX_ID: RUT proveedor inválido (${params.supplierTaxId}): ${rutValidation.reason || 'fallo Módulo-11'}.`
                );
            }
        }

        const hasCapexLine = params.lines.some((l) => l.isCapexAsset || l.destination === 'CAPEX_ASSET');

        const siiValidation = validateSiiDocumentForPurchase({
            siiDocId: `val_${Date.now().toString(36)}`,
            tenantId: params.tenantId,
            siteId: params.siteId,
            tedRawXml: params.tedRawXml,
            manualFallback: !params.tedRawXml
                ? {
                      supplierTaxId: params.supplierTaxId,
                      supplierName: params.supplierName,
                      dteType: params.documentType,
                      folio: String(params.folio),
                      issueDate: params.issueDate,
                      netAmountClp: params.netAmountClp,
                      vatAmountClp: params.vatAmountClp,
                      totalAmountClp: params.totalAmountClp,
                  }
                : undefined,
            expectedReceiverTaxId: params.expectedReceiverTaxId,
            hasCapexAsset: hasCapexLine,
        });

        if (siiValidation.errors.some((e) => e.includes('FOLIO_MUST_BE_POSITIVE'))) {
            throw new SupplyValidationError(
                'FOLIO_MUST_BE_POSITIVE',
                siiValidation.errors.find((e) => e.includes('FOLIO_MUST_BE_POSITIVE'))!
            );
        }
        if (siiValidation.tedRsaVerified === false) {
            throw new SupplyValidationError(
                'TED_RSA_SIGNATURE_INVALID',
                'TED_RSA_SIGNATURE_INVALID: La firma criptográfica RSA-SHA1 del timbre TED no coincide con la clave pública CAF.'
            );
        }
        if (siiValidation.receiverTaxIdMismatch) {
            throw new SupplyValidationError(
                'RECEIVER_TAX_ID_MISMATCH',
                siiValidation.errors.find((e) => e.includes('RECEIVER_TAX_ID_MISMATCH')) ||
                    'RECEIVER_TAX_ID_MISMATCH: El RUT receptor del documento no coincide con la empresa.'
            );
        }

        const dedupeKey = buildDomainSiiDedupeKey(
            params.supplierTaxId,
            params.documentType,
            String(params.folio)
        );
        const purchaseId = `pur_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
        const safeRut = safeDocIdPart(params.supplierTaxId || params.supplierName);
        const supplierId = `tsup_${safeDocIdPart(params.tenantId)}_${safeRut}`;

        // 2. Detección determinista de fraccionamiento de facturas (`SPLIT_INVOICE_SMURFING` <= 48h)
        const [siteDoc, recentSitePurchases] = await Promise.all([
            this.getSite(params.tenantId, params.siteId).catch(() => null),
            this.listPurchases(params.tenantId, params.siteId).catch(() => []),
        ]);
        const approvalThresholdClp = Math.max(
            1,
            Number(siteDoc?.directPurchaseAlertThresholdClp ?? 500_000)
        );
        const smurfingAlert = detectSplitInvoiceSmurfing({
            supplierTaxId: params.supplierTaxId,
            currentAmountClp: params.totalAmountClp,
            currentTimestampIso: now,
            recentPurchases: recentSitePurchases.map((p) => ({
                purchaseId: p.purchaseId,
                supplierTaxId: p.supplierTaxId,
                totalAmountClp: p.totalAmountClp,
                createdAtIso: p.createdAt,
            })),
            approvalThresholdClp,
            windowHours: 48,
        });

        const missingInvoiceAlert = hasCapexLine && params.documentType !== 33 && params.documentType !== 34;

        const atypicalFlags = Array.from(
            new Set<AtypicalFlagCode>([
                ...(params.atypicalFlags || []),
                ...(hasCapexLine ? (['ATYPICAL_HIGH_VALUE_OR_CAPEX'] as AtypicalFlagCode[]) : []),
                ...(smurfingAlert.detected ? (['ATYPICAL_HIGH_VALUE_OR_CAPEX'] as AtypicalFlagCode[]) : []),
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

        const purchaseLinesWithProgress: PurchaseLineWithReceptionProgress[] = params.lines.map((l) => ({
            ...l,
            qtyReceivedSoFar:
                l.destination === 'STOCK_IN_WAREHOUSE'
                    ? Number(l.qtyPurchased)
                    : l.destination === 'STOCK_IN_TRANSIT'
                      ? 0
                      : undefined,
        }));

        const fiscalRetentionUntil = computeSixYearRetentionIso(params.issueDate || now);

        const purchase: SupplyPurchase & {
            retentionUntil: string;
            tedRsaVerified?: boolean | null;
            policyAlerts?: string[];
        } = {
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
            tedRsaVerified: siiValidation.tedRsaVerified,
            ...(smurfingAlert.detected ? { policyAlerts: ['SPLIT_INVOICE_SMURFING'] } : {}),
            receptionStatus,
            receivedAt: receptionStatus === 'RECEIVED' ? now : undefined,
            receivedByUid: receptionStatus === 'RECEIVED' ? actor.actorUid : undefined,
            atypicalFlags,
            lines: purchaseLinesWithProgress,
            retentionUntil: fiscalRetentionUntil,
            createdAt: now,
            updatedAt: now,
        };

        const rcvDomain = computeRcvAcceptanceDeadline(params.issueDate, params.documentType);
        const rcvDeadlineDate = rcvDomain.applicable ? rcvDomain.deadlineIso ?? null : null;
        const rcvDaysRemaining = rcvDomain.applicable ? rcvDomain.daysRemaining ?? null : null;

        // DL 825 exacto vía `SiiTaxValidator.computeChileanVatBreakdown`:
        // DTE 33 => +vat, DTE 52 => 0, DTE 61 => -vat (Nota de Crédito), DTE 39 => 0
        const vatBreakdown = computeChileanVatBreakdown({
            dteType: params.documentType,
            totalAmountClp: params.totalAmountClp,
            netAmountClp: params.netAmountClp,
            vatAmountClp: params.vatAmountClp,
        });
        const vatCreditRecoverableClp = vatBreakdown.vatRecoverableClp;
        const enforceUniqueSii = params.documentType !== 0 && params.folio > 0;
        const siiDocId = enforceUniqueSii
            ? buildSiiDocId(params.tenantId, dedupeKey)
            : `${safeDocIdPart(params.tenantId)}__rural_${purchaseId}`;

        const siiDocument: SiiDocumentRecord & {
            retentionUntil: string;
            tedRsaVerified?: boolean | null;
            isCreditNote?: boolean;
        } = {
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
            tedRsaVerified: siiValidation.tedRsaVerified,
            isCreditNote: vatBreakdown.isCreditNote,
            retentionUntil: fiscalRetentionUntil,
            createdAt: now,
            updatedAt: now,
        };

        // Pre-identificar requisiciones candidatas (se releen y mutan atómicamente dentro de runTransaction)
        const candidateReqIds = new Set<string>();
        if (
            params.purchaseMode === 'REQUISITION_FULFILLMENT' ||
            params.purchaseMode === 'MIXED_FULFILLMENT_AND_DIRECT'
        ) {
            const allReqs = await this.listRequisitions(params.tenantId, { siteId: params.siteId });
            for (const req of allReqs) {
                if (req.status === 'OPEN' || req.status === 'PARTIAL') {
                    candidateReqIds.add(req.reqId);
                }
            }
            for (const pLine of params.lines) {
                if (Array.isArray(pLine.explicitAllocations)) {
                    for (const exp of pLine.explicitAllocations) {
                        if (exp.reqId) candidateReqIds.add(exp.reqId);
                    }
                }
            }
        }

        const uniqueInvKeys = Array.from(
            new Set(
                params.lines
                    .filter(
                        (l) =>
                            !(l.isCapexAsset || l.destination === 'CAPEX_ASSET') &&
                            (l.destination === 'STOCK_IN_TRANSIT' || l.destination === 'STOCK_IN_WAREHOUSE')
                    )
                    .map((l) => buildInventoryDocId(params.tenantId, params.siteId, l.canonicalSkuId))
            )
        );

        const siiRef = db.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(siiDocId);
        const purchaseRef = db.collection(SUPPLY_COLLECTIONS.PURCHASES).doc(purchaseId);
        const supplierRef = db.collection(SUPPLY_COLLECTIONS.TENANT_SUPPLIERS).doc(supplierId);

        let allocations: FulfillmentAllocation[] = [];
        let createdAssets: SupplyAsset[] = [];
        let mutatedReqIds: string[] = [];

        // Transacción atómica única: unicidad SII + compra + CAPEX + cash ledger + inventario + allocations + requisiciones
        await db.runTransaction(async (tx) => {
            // FASE 1: TODAS LAS LECTURAS PRIMERO (regla estricta Firestore)
            if (enforceUniqueSii) {
                const existingSii = await tx.get(siiRef);
                if (existingSii.exists) {
                    throw new SupplyDuplicateSiiDocumentError(dedupeKey);
                }
            }

            const invByDocId = new Map<string, SupplyInventoryItem | null>();
            for (const invDocId of uniqueInvKeys) {
                const invSnap = await tx.get(db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(invDocId));
                invByDocId.set(invDocId, invSnap.exists ? (invSnap.data() as SupplyInventoryItem) : null);
            }

            const txOpenReqs: SupplyRequisition[] = [];
            for (const reqId of candidateReqIds) {
                const reqSnap = await tx.get(db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(reqId));
                if (!reqSnap.exists) continue;
                const reqData = reqSnap.data() as SupplyRequisition;
                if (reqData.tenantId !== params.tenantId) continue;
                if (reqData.status === 'OPEN' || reqData.status === 'PARTIAL') {
                    txOpenReqs.push({
                        ...reqData,
                        lines: reqData.lines.map((l) => ({ ...l })),
                    });
                }
            }
            txOpenReqs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

            // FASE 2: CÁLCULO DETERMINISTA EN MEMORIA VÍA MOTORES DE DOMINIO
            // (`RequisitionFulfillmentMatcher` + `StockAssetCashCostReconciler`)
            const reqById = new Map<string, SupplyRequisition>(txOpenReqs.map((r) => [r.reqId, r]));
            const mutatedReqs = new Map<string, SupplyRequisition>();
            const txAllocations: FulfillmentAllocation[] = [];
            const txCreatedAssets: SupplyAsset[] = [];
            const txCashEntries: CashLedgerEntry[] = [];
            const txStockLedgers: StockLedgerEntry[] = [];
            const txUpdatedInventory = new Map<string, SupplyInventoryItem>();
            const remainingQtyByLineId = new Map<string, number>();

            // 2a. Aplicar primero asignaciones explícitas confirmadas por el usuario en UI HITL
            for (const pLine of params.lines) {
                const isCapex = pLine.isCapexAsset || pLine.destination === 'CAPEX_ASSET';
                let remainingQty = Number(pLine.qtyPurchased);

                if (!isCapex && params.purchaseMode !== 'DIRECT_AUTONOMOUS' && Array.isArray(pLine.explicitAllocations)) {
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
                        txAllocations.push({
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
                remainingQtyByLineId.set(pLine.purchaseLineId, remainingQty);
            }

            // 2b. Invocar `RequisitionFulfillmentMatcher` para conciliación N:M FIFO de los remanentes
            const computePurchaseLineVat = (
                line: SupplyPurchaseLine,
                ratio = 1
            ): ReturnType<typeof computeChileanVatBreakdown> => {
                const scaledSubtotal = Math.round(line.subtotalClp * ratio);
                const isNetLine =
                    line.linePricingBasis === 'NET' &&
                    (params.documentType === 33 || params.documentType === 52 || params.documentType === 61);
                if (isNetLine) {
                    const grossEstimated = Math.round(scaledSubtotal * 1.19);
                    return computeChileanVatBreakdown({
                        dteType: params.documentType,
                        totalAmountClp: grossEstimated,
                        netAmountClp: scaledSubtotal,
                    });
                }
                return computeChileanVatBreakdown({
                    dteType: params.documentType,
                    totalAmountClp: scaledSubtotal,
                });
            };

            const domainOpenReqs = Array.from(reqById.values()).map(mapAppReqToDomain);
            const domainLinesForMatcher = params.lines
                .filter((l) => (remainingQtyByLineId.get(l.purchaseLineId) || 0) > 0)
                .map((l) => {
                    const remQty = remainingQtyByLineId.get(l.purchaseLineId) || 0;
                    const ratio = l.qtyPurchased > 0 ? remQty / l.qtyPurchased : 1;
                    const lineVat = computePurchaseLineVat(l, ratio);
                    const lineGross = Math.abs(lineVat.totalAmountClp);
                    return {
                        purchaseLineId: l.purchaseLineId,
                        canonicalSkuId: l.canonicalSkuId,
                        description: l.description,
                        categoryCode: l.categoryCode,
                        unitSi: l.unitSi,
                        qtyPurchased: remQty,
                        unitPriceNetClp: remQty > 0 ? Math.round(Math.abs(lineVat.netAmountClp) / remQty) : 0,
                        unitPriceGrossClp:
                            remQty > 0 ? Math.round(lineGross / remQty) : l.unitPriceClp,
                        subtotalNetClp: Math.abs(lineVat.netAmountClp),
                        subtotalGrossClp: lineGross,
                        destination: l.destination,
                        isCapexAsset: l.isCapexAsset || l.destination === 'CAPEX_ASSET',
                        costCenter: l.costCenter,
                        serialOrTag: l.serialOrTag,
                    };
                });

            const domainRemainingPurchase: DomainSupplyPurchase = {
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
                folio: String(params.folio),
                issueDate: params.issueDate,
                netAmountClp: Math.round(params.netAmountClp),
                vatAmountClp: Math.round(params.vatAmountClp),
                totalAmountClp: Math.round(params.totalAmountClp),
                paymentMethod: params.paymentMethod,
                tedRawXml: params.tedRawXml,
                createdAt: now,
                lines: domainLinesForMatcher,
            };

            const fulfillmentResult = matchPurchaseToRequisitions(
                domainRemainingPurchase,
                domainOpenReqs,
                { matchedAt: now }
            );

            // Sincronizar requisiciones actualizadas por FIFO del dominio hacia el estado transaccional
            for (const updatedDomReq of fulfillmentResult.updatedRequisitions) {
                const targetAppReq = reqById.get(updatedDomReq.reqId);
                if (!targetAppReq) continue;
                let changed = false;
                for (const domLine of updatedDomReq.lines) {
                    const appLine = targetAppReq.lines.find((l) => l.lineId === domLine.lineId);
                    if (!appLine) continue;
                    const deltaPurchased = Number((domLine.qtyPurchased - appLine.qtyPurchased).toFixed(3));
                    if (deltaPurchased > 0) {
                        changed = true;
                        appLine.qtyPurchased = Number(domLine.qtyPurchased.toFixed(3));
                        appLine.qtyPending = Number(domLine.qtyPending.toFixed(3));
                        appLine.lineStatus = domLine.lineStatus;
                        const matchingAlloc = fulfillmentResult.allocations.find(
                            (a) =>
                                a.requisitionId === updatedDomReq.reqId &&
                                a.requisitionLineId === domLine.lineId &&
                                a.destination === 'STOCK_IN_WAREHOUSE'
                        );
                        if (matchingAlloc) {
                            appLine.qtyReceived = Number((appLine.qtyReceived + deltaPurchased).toFixed(3));
                        }
                    }
                }
                if (changed) {
                    targetAppReq.status = computeRequisitionAggregateStatus(targetAppReq.lines);
                    targetAppReq.updatedAt = now;
                    mutatedReqs.set(targetAppReq.reqId, targetAppReq);
                }
            }

            for (const domAlloc of fulfillmentResult.allocations) {
                txAllocations.push({
                    allocationId: `alloc_${crypto.randomBytes(5).toString('hex')}`,
                    tenantId: params.tenantId,
                    siteId: params.siteId,
                    purchaseId,
                    purchaseLineId: domAlloc.purchaseLineId,
                    requisitionId: domAlloc.requisitionId || 'UNSOLICITED_PURCHASE',
                    requisitionLineId: domAlloc.requisitionLineId || 'UNSOLICITED_PURCHASE',
                    canonicalSkuId: domAlloc.canonicalSkuId,
                    qtyAllocated: domAlloc.qtyAllocated,
                    unitSi: domAlloc.unitSi,
                    destination: domAlloc.destination,
                    createdAt: now,
                });
            }

            // 2c. Invocar `StockAssetCashCostReconciler.reconcilePurchase` para separar CAPEX vs OPEX / Caja / Stock
            const domainFullPurchase: DomainSupplyPurchase = {
                ...domainRemainingPurchase,
                lines: params.lines.map((l) => {
                    const lineVat = computePurchaseLineVat(l, 1);
                    const lineGross = Math.abs(lineVat.totalAmountClp);
                    return {
                        purchaseLineId: l.purchaseLineId,
                        canonicalSkuId: l.canonicalSkuId,
                        description: l.description,
                        categoryCode: l.categoryCode,
                        unitSi: l.unitSi,
                        qtyPurchased: l.qtyPurchased,
                        unitPriceNetClp:
                            l.qtyPurchased > 0 ? Math.round(Math.abs(lineVat.netAmountClp) / l.qtyPurchased) : 0,
                        unitPriceGrossClp:
                            l.qtyPurchased > 0 ? Math.round(lineGross / l.qtyPurchased) : l.unitPriceClp,
                        subtotalNetClp: Math.abs(lineVat.netAmountClp),
                        subtotalGrossClp: lineGross,
                        destination: l.destination,
                        isCapexAsset: l.isCapexAsset || l.destination === 'CAPEX_ASSET',
                        costCenter: l.costCenter,
                        serialOrTag: l.serialOrTag,
                    };
                }),
            };

            const domainRecon = reconcilePurchase(domainFullPurchase, fulfillmentResult.allocations, {
                recordedAt: now,
            });

            const domainAssetByLineId = new Map(
                domainRecon.createdAssets.map((a) => [a.purchaseLineId, a])
            );
            const hasRecoverableVatDte = params.documentType === 33 || params.documentType === 61;

            for (let idx = 0; idx < params.lines.length; idx++) {
                const pLine = params.lines[idx];
                const lineVat = computePurchaseLineVat(pLine, 1);
                const accountingCostBasisClp = hasRecoverableVatDte
                    ? Math.abs(lineVat.netAmountClp)
                    : Math.abs(lineVat.totalAmountClp);
                const domAsset = domainAssetByLineId.get(pLine.purchaseLineId);
                const domCash = domainRecon.cashEntries[idx];
                const isCapex = Boolean(domAsset || pLine.isCapexAsset || pLine.destination === 'CAPEX_ASSET');

                if (isCapex) {
                    const lineVatCreditClp = domAsset
                        ? domAsset.vatCreditClp
                        : lineVat.vatRecoverableClp;
                    const lineNetClp = domAsset
                        ? domAsset.acquisitionNetClp
                        : Math.abs(lineVat.netAmountClp);

                    txCreatedAssets.push({
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
                        missingInvoiceAlert: domAsset
                            ? domAsset.missingInvoiceAlert
                            : params.documentType !== 33 && params.documentType !== 34,
                        costCenter: 'CC-CAPEX',
                        createdAt: now,
                        updatedAt: now,
                    });
                } else if (
                    pLine.destination === 'STOCK_IN_TRANSIT' ||
                    pLine.destination === 'STOCK_IN_WAREHOUSE'
                ) {
                    const invDocId = buildInventoryDocId(params.tenantId, params.siteId, pLine.canonicalSkuId);
                    const currentInv = txUpdatedInventory.get(invDocId) ?? invByDocId.get(invDocId) ?? null;
                    const netUnitCostForPmp =
                        pLine.qtyPurchased > 0 ? Math.round(accountingCostBasisClp / pLine.qtyPurchased) : 0;
                    const computed = this.computeNextInventoryState(currentInv, {
                        tenantId: params.tenantId,
                        siteId: params.siteId,
                        canonicalSkuId: pLine.canonicalSkuId,
                        itemName: pLine.description,
                        categoryCode: pLine.categoryCode,
                        procurementBucket: pLine.procurementBucket,
                        unitSi: pLine.unitSi,
                        inTransitDelta: pLine.destination === 'STOCK_IN_TRANSIT' ? pLine.qtyPurchased : 0,
                        inWarehouseDelta: pLine.destination === 'STOCK_IN_WAREHOUSE' ? pLine.qtyPurchased : 0,
                        unitCostClp: netUnitCostForPmp,
                        movementType:
                            pLine.destination === 'STOCK_IN_TRANSIT'
                                ? 'INBOUND_TRANSIT'
                                : 'DIRECT_RECEIPT',
                        referenceId: purchaseId,
                        actorUid: actor.actorUid,
                        now,
                    });
                    txUpdatedInventory.set(invDocId, computed.record);
                    txStockLedgers.push(computed.ledgerEntry);
                }

                // Costo tributario contable: cuando no hay IVA crédito fiscal recuperable (ej. Boleta 39, DTE 52),
                // el monto pagado completo constituye base de costo (DL 825 Art. 23).
                const domCashSplits = domainRecon.cashEntries.filter(
                    (c) => c.purchaseLineId === pLine.purchaseLineId
                );
                if (!isCapex && domCashSplits.length > 0) {
                    for (const domCashSplit of domCashSplits) {
                        const splitNetBasis =
                            params.documentType === 61
                                ? -Math.abs(domCashSplit.opexImpactClp)
                                : domCashSplit.opexImpactClp;
                        const splitGrossAmountClp =
                            params.documentType === 61
                                ? -Math.abs(domCashSplit.grossAmountClp)
                                : Math.abs(domCashSplit.grossAmountClp);

                        txCashEntries.push({
                            entryId: `cash_${crypto.randomBytes(5).toString('hex')}`,
                            tenantId: params.tenantId,
                            siteId: params.siteId,
                            paymentMethod: params.paymentMethod,
                            direction:
                                params.paymentMethod === 'REEMBOLSO_GERENCIA'
                                    ? 'REIMBURSEMENT_DUE'
                                    : 'EXPENSE_RENDERED',
                            amountClp: splitGrossAmountClp,
                            netAmountClp: splitNetBasis,
                            vatCreditClp: domCashSplit.vatRecoverableClp,
                            isCapex: false,
                            categoryCode: pLine.categoryCode,
                            costCenter:
                                domCashSplit.costCenter ||
                                normalizeLegacyCostCenter(pLine.costCenter, pLine.categoryCode),
                            referenceId: purchaseId,
                            actorUid: actor.actorUid,
                            description: `${pLine.description} (${pLine.qtyPurchased} ${pLine.unitSi}) · ${domCashSplit.costCenter} · DTE ${params.documentType} #${params.folio}`,
                            createdAt: now,
                        });
                    }
                } else {
                    const domCash =
                        domainRecon.cashEntries.find((c) => c.purchaseLineId === pLine.purchaseLineId) ||
                        domainRecon.cashEntries[idx];
                    const lineVatCredit = domCash ? domCash.vatRecoverableClp : lineVat.vatRecoverableClp;
                    const lineNetBasis =
                        params.documentType === 61
                            ? -Math.abs(accountingCostBasisClp)
                            : accountingCostBasisClp;
                    const lineGrossAmountClp =
                        params.documentType === 61
                            ? -Math.abs(lineVat.totalAmountClp)
                            : Math.abs(lineVat.totalAmountClp);

                    txCashEntries.push({
                        entryId: `cash_${crypto.randomBytes(5).toString('hex')}`,
                        tenantId: params.tenantId,
                        siteId: params.siteId,
                        paymentMethod: params.paymentMethod,
                        direction:
                            params.paymentMethod === 'REEMBOLSO_GERENCIA'
                                ? 'REIMBURSEMENT_DUE'
                                : 'EXPENSE_RENDERED',
                        amountClp: lineGrossAmountClp,
                        netAmountClp: lineNetBasis,
                        vatCreditClp: lineVatCredit,
                        isCapex,
                        categoryCode: pLine.categoryCode,
                        costCenter: isCapex
                            ? 'CC-CAPEX'
                            : domCash?.costCenter || normalizeLegacyCostCenter(pLine.costCenter, pLine.categoryCode),
                        referenceId: purchaseId,
                        actorUid: actor.actorUid,
                        description: `${pLine.description} (${pLine.qtyPurchased} ${pLine.unitSi}) · DTE ${params.documentType} #${params.folio}`,
                        createdAt: now,
                    });
                }
            }

            // FASE 3: TODAS LAS ESCRITURAS ATÓMICAS EN LA MISMA TRANSACCIÓN
            tx.set(
                supplierRef,
                {
                    supplierId,
                    tenantId: params.tenantId,
                    supplierTaxId: params.supplierTaxId,
                    supplierName: params.supplierName,
                    updatedAt: now,
                },
                { merge: true }
            );
            tx.set(siiRef, siiDocument);
            tx.set(purchaseRef, purchase);

            for (const asset of txCreatedAssets) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.ASSETS).doc(asset.assetId), asset);
            }
            for (const cashEntry of txCashEntries) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.CASH_LEDGER).doc(cashEntry.entryId), cashEntry);
            }
            for (const [invDocId, invRecord] of txUpdatedInventory.entries()) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(invDocId), invRecord, {
                    merge: true,
                });
            }
            for (const ledgerEntry of txStockLedgers) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(ledgerEntry.entryId), ledgerEntry);
            }
            for (const alloc of txAllocations) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.FULFILLMENT_ALLOCATIONS).doc(alloc.allocationId), alloc);
            }
            for (const req of mutatedReqs.values()) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(req.reqId), req, { merge: true });
            }

            allocations = txAllocations;
            createdAssets = txCreatedAssets;
            mutatedReqIds = Array.from(mutatedReqs.keys());
        });

        if (smurfingAlert.detected) {
            await this.recordPolicyAudit({
                tenantId: params.tenantId,
                siteId: params.siteId,
                actorUid: actor.actorUid,
                eventType: 'SPLIT_INVOICE_SMURFING',
                policyCode: 'SPLIT_INVOICE_SMURFING',
                severity: 'HIGH',
                entityId: purchaseId,
                details: {
                    supplierTaxId: smurfingAlert.supplierTaxIdNormalized,
                    purchaseCount: smurfingAlert.purchaseCount,
                    cumulativeAmountClp: smurfingAlert.cumulativeAmountClp,
                    approvalThresholdClp: smurfingAlert.approvalThresholdClp,
                    windowHours: smurfingAlert.windowHours,
                    relatedPurchaseIds: smurfingAlert.relatedPurchaseIds,
                },
            });
        }

        await this.recordAudit(params.tenantId, actor, 'SUPPLY_PURCHASE_COMMITTED', purchaseId, {
            hitlConfirmed: true,
            purchaseMode: params.purchaseMode,
            dedupeKey,
            totalAmountClp: purchase.totalAmountClp,
            allocationsCount: allocations.length,
            createdAssetsCount: createdAssets.length,
            missingInvoiceAlert,
            tedRsaVerified: siiValidation.tedRsaVerified,
            smurfingDetected: smurfingAlert.detected,
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
            updatedRequisitionIds: mutatedReqIds,
            missingInvoiceAlert,
            tedRsaVerified: siiValidation.tedRsaVerified,
            ...(smurfingAlert.detected ? { smurfingAlert } : {}),
        };
    }

    /**
     * Confirma recepción física en bodega de forma 100% atómica (`db.runTransaction`):
     * acumula `qtyReceivedSoFar` por línea, rechaza sobre-recepción (`OVER_RECEIVE_NOT_ALLOWED`, HTTP 409)
     * y cantidades negativas (HTTP 400), transiciona `qtyInTransit` -> `qtyInWarehouse` y actualiza requisiciones.
     */
    public static async confirmPurchaseReception(
        params: {
            tenantId: string;
            purchaseId: string;
            warehouseId?: string;
            receivedLines?: Array<{ purchaseLineId: string; qtyReceived: number }>;
            lineDetails?: Array<{
                purchaseLineId: string;
                warehouseId?: string;
                shrinkageQty?: number;
                shrinkageReason?: string;
                lotNumber?: string;
                expiryDateIso?: string;
                evidenceCasRef?: EvidenceCasRef;
            }>;
            evidenceCasRef?: EvidenceCasRef;
            notes?: string;
        },
        actor: AuditActorContext
    ): Promise<{
        purchase: SupplyPurchase;
        receptionOutcome: 'RECEIVED_OK' | 'PARTIAL_DISCREPANCY';
        receivedItemCount: number;
        affectedRequisitions: SupplyRequisition[];
        discrepancies: SupplyReceptionDiscrepancy[];
        urgentRcvAlert: boolean;
        suggestCreditNote61: boolean;
    }> {
        const ref = db.collection(SUPPLY_COLLECTIONS.PURCHASES).doc(params.purchaseId);
        const now = new Date().toISOString();

        const receivedMap = new Map<string, number>();
        for (const item of params.receivedLines || []) {
            const qty = Number(item.qtyReceived);
            if (!Number.isFinite(qty) || qty < 0) {
                throw new SupplyValidationError(
                    'INVALID_RECEPTION_QUANTITY',
                    'Las cantidades de recepción en bodega no pueden ser negativas.'
                );
            }
            receivedMap.set(item.purchaseLineId, qty);
        }

        const lineDetailMap = new Map<
            string,
            {
                warehouseId?: string;
                shrinkageQty: number;
                shrinkageReason?: string;
                lotNumber?: string;
                expiryDateIso?: string;
                evidenceCasRef?: EvidenceCasRef;
            }
        >();
        for (const det of params.lineDetails || []) {
            lineDetailMap.set(det.purchaseLineId, {
                warehouseId: det.warehouseId?.trim() || params.warehouseId?.trim(),
                shrinkageQty: Math.max(0, Number(det.shrinkageQty || 0)),
                shrinkageReason: det.shrinkageReason,
                lotNumber: det.lotNumber,
                expiryDateIso: det.expiryDateIso,
                evidenceCasRef: det.evidenceCasRef || params.evidenceCasRef,
            });
        }

        // Allocations de esta compra (inmutables tras alta de compra)
        const allocSnap = await db
            .collection(SUPPLY_COLLECTIONS.FULFILLMENT_ALLOCATIONS)
            .where('tenantId', '==', params.tenantId)
            .where('purchaseId', '==', params.purchaseId)
            .limit(MAX_LIST_LIMIT)
            .get();
        const allocs = allocSnap.docs.map((d) => d.data() as FulfillmentAllocation);
        const affectedReqIds = Array.from(
            new Set(
                allocs
                    .filter((a) => a.requisitionId !== 'UNSOLICITED_PURCHASE')
                    .map((a) => a.requisitionId)
            )
        );

        let updatedPurchase!: SupplyPurchase;
        let receptionOutcome: 'RECEIVED_OK' | 'PARTIAL_DISCREPANCY' = 'RECEIVED_OK';
        let receivedItemCount = 0;
        let affectedRequisitions: SupplyRequisition[] = [];
        let createdDiscrepancies: SupplyReceptionDiscrepancy[] = [];
        let urgentRcvAlert = false;
        let suggestCreditNote61 = false;

        await db.runTransaction(async (tx) => {
            // FASE 1: TODAS LAS LECTURAS PRIMERO
            const snap = await tx.get(ref);
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

            const inTransitLines = (loaded.lines as PurchaseLineWithReceptionProgress[]).filter(
                (l) => l.destination === 'STOCK_IN_TRANSIT'
            );

            // Validar cantidades entrantes y sobre-recepción ANTES de cualquier escritura
            const incomingByLineId = new Map<string, { prev: number; incoming: number; next: number }>();
            for (const line of inTransitLines) {
                const prevReceived = Number(line.qtyReceivedSoFar ?? 0);
                const remaining = Math.max(0, Number((line.qtyPurchased - prevReceived).toFixed(3)));
                const incomingQty = receivedMap.has(line.purchaseLineId)
                    ? Number(receivedMap.get(line.purchaseLineId))
                    : remaining;

                if (!Number.isFinite(incomingQty) || incomingQty < 0) {
                    throw new SupplyValidationError(
                        'INVALID_RECEPTION_QUANTITY',
                        'Las cantidades de recepción en bodega no pueden ser negativas.'
                    );
                }

                const nextReceived = Number((prevReceived + incomingQty).toFixed(3));
                if (nextReceived > Number(line.qtyPurchased) + 1e-6) {
                    throw new SupplyConflictError(
                        'OVER_RECEIVE_NOT_ALLOWED',
                        `Sobre-recepción rechazada en línea ${line.purchaseLineId}: acumulado ${nextReceived} excede comprado ${line.qtyPurchased}.`
                    );
                }
                incomingByLineId.set(line.purchaseLineId, {
                    prev: prevReceived,
                    incoming: incomingQty,
                    next: nextReceived,
                });
            }

            // Leer documento SII asociado para verificar urgencia RCV Ley 19.983
            let siiDocId: string | null = null;
            if (loaded.dedupeKey) {
                const candidateSiiId = buildSiiDocId(params.tenantId, loaded.dedupeKey);
                const siiSnap = await tx.get(
                    db.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(candidateSiiId)
                );
                if (siiSnap.exists) {
                    siiDocId = (siiSnap.data() as SiiDocumentRecord).docId || candidateSiiId;
                }
            }

            // Leer ítems de inventario involucrados
            const uniqueInvKeys = Array.from(
                new Set(
                    inTransitLines
                        .filter((l) => (incomingByLineId.get(l.purchaseLineId)?.incoming || 0) > 0)
                        .map((l) => buildInventoryDocId(params.tenantId, loaded.siteId, l.canonicalSkuId))
                )
            );
            const invByDocId = new Map<string, SupplyInventoryItem | null>();
            for (const invDocId of uniqueInvKeys) {
                const invSnap = await tx.get(db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(invDocId));
                invByDocId.set(invDocId, invSnap.exists ? (invSnap.data() as SupplyInventoryItem) : null);
            }

            // Leer bodegas físicas y saldos por bodega si se indicó warehouseId
            const targetWarehouseIds = Array.from(
                new Set(
                    inTransitLines
                        .map(
                            (l) =>
                                lineDetailMap.get(l.purchaseLineId)?.warehouseId ||
                                params.warehouseId?.trim() ||
                                ''
                        )
                        .filter(Boolean)
                )
            );
            const warehouseById = new Map<string, SupplyWarehouse>();
            for (const whId of targetWarehouseIds) {
                const whSnap = await tx.get(db.collection(SUPPLY_COLLECTIONS.WAREHOUSES).doc(whId));
                if (whSnap.exists) {
                    const whData = whSnap.data() as SupplyWarehouse;
                    if (whData.tenantId === params.tenantId) {
                        warehouseById.set(whId, whData);
                    }
                }
            }
            const whBalanceByDocId = new Map<string, SupplyWarehouseBalance | null>();
            for (const line of inTransitLines) {
                const whId =
                    lineDetailMap.get(line.purchaseLineId)?.warehouseId ||
                    params.warehouseId?.trim();
                if (!whId || !warehouseById.has(whId)) continue;
                const balId = buildWarehouseBalanceDocId(
                    params.tenantId,
                    loaded.siteId,
                    whId,
                    line.canonicalSkuId
                );
                if (!whBalanceByDocId.has(balId)) {
                    const balSnap = await tx.get(
                        db.collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES).doc(balId)
                    );
                    whBalanceByDocId.set(
                        balId,
                        balSnap.exists ? (balSnap.data() as SupplyWarehouseBalance) : null
                    );
                }
            }

            // Leer requisiciones enlazadas
            const txReqs = new Map<string, SupplyRequisition>();
            for (const reqId of affectedReqIds) {
                const reqSnap = await tx.get(db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(reqId));
                if (!reqSnap.exists) continue;
                const reqData = reqSnap.data() as SupplyRequisition;
                if (reqData.tenantId === params.tenantId) {
                    txReqs.set(reqId, {
                        ...reqData,
                        lines: reqData.lines.map((l) => ({ ...l })),
                    });
                }
            }

            // FASE 2: CÁLCULO ATÓMICO EN MEMORIA (evaluado vía `StockAssetCashCostReconciler.confirmWarehouseReception`)
            const resolveLineNetUnitCostClp = (line: PurchaseLineWithReceptionProgress): number => {
                const subtotalBase = Math.round(line.subtotalClp || 0);
                const hasRecoverableVat = loaded.documentType === 33 || loaded.documentType === 61;
                const isNetLine =
                    line.linePricingBasis === 'NET' &&
                    (loaded.documentType === 33 || loaded.documentType === 52 || loaded.documentType === 61);
                const vat = isNetLine
                    ? computeChileanVatBreakdown({
                          dteType: loaded.documentType,
                          totalAmountClp: Math.round(subtotalBase * 1.19),
                          netAmountClp: subtotalBase,
                      })
                    : computeChileanVatBreakdown({
                          dteType: loaded.documentType,
                          totalAmountClp: subtotalBase,
                      });
                const costBasis = hasRecoverableVat ? Math.abs(vat.netAmountClp) : Math.abs(vat.totalAmountClp);
                return line.qtyPurchased > 0 ? Math.round(costBasis / line.qtyPurchased) : Math.round(line.unitPriceClp || 0);
            };

            const receptionId = `rec_${loaded.purchaseId}_${Date.now().toString(36)}`;
            const domainReception = confirmWarehouseReception({
                receptionId,
                tenantId: params.tenantId,
                siteId: loaded.siteId,
                purchaseId: loaded.purchaseId,
                recordedAt: now,
                lines: inTransitLines.map((line) => {
                    const prog = incomingByLineId.get(line.purchaseLineId)!;
                    return {
                        canonicalSkuId: line.canonicalSkuId,
                        unitSi: line.unitSi,
                        expectedInTransitQty: Math.max(0, Number((line.qtyPurchased - prog.prev).toFixed(3))),
                        receivedQty: prog.incoming,
                        unitCostNetClp: resolveLineNetUnitCostClp(line),
                        costCenter: normalizeLegacyCostCenter(line.costCenter, line.categoryCode),
                    };
                }),
            });

            const rcvEval = computeRcvAcceptanceDeadline(loaded.issueDate, loaded.documentType);
            const rcvDaysRemaining =
                rcvEval.applicable && typeof rcvEval.daysRemaining === 'number'
                    ? rcvEval.daysRemaining
                    : null;
            const isUrgentRcv =
                typeof rcvDaysRemaining === 'number' && rcvDaysRemaining >= 0 && rcvDaysRemaining <= 3;

            let txReceivedItemCount = 0;
            const txUpdatedInventory = new Map<string, SupplyInventoryItem>();
            const txUpdatedWhBalances = new Map<string, SupplyWarehouseBalance>();
            const txStockLedgers: StockLedgerEntry[] = [];
            const txDiscrepancies: SupplyReceptionDiscrepancy[] = [];

            const updatedPurchaseLines: PurchaseLineWithReceptionProgress[] = (
                loaded.lines as PurchaseLineWithReceptionProgress[]
            ).map((line) => {
                if (line.destination !== 'STOCK_IN_TRANSIT') return line;
                const prog = incomingByLineId.get(line.purchaseLineId)!;
                const det = lineDetailMap.get(line.purchaseLineId);
                const targetWhId = det?.warehouseId || params.warehouseId?.trim();
                const shrinkageQty = Math.min(prog.incoming, Math.max(0, Number(det?.shrinkageQty || 0)));
                const netUsableReceived = Math.max(0, Number((prog.incoming - shrinkageQty).toFixed(3)));
                const netUnitCost = resolveLineNetUnitCostClp(line);

                if (prog.incoming > 0) {
                    txReceivedItemCount += 1;
                    const invDocId = buildInventoryDocId(params.tenantId, loaded.siteId, line.canonicalSkuId);
                    const currentInv = txUpdatedInventory.get(invDocId) ?? invByDocId.get(invDocId) ?? null;
                    const computed = this.computeNextInventoryState(currentInv, {
                        tenantId: params.tenantId,
                        siteId: loaded.siteId,
                        canonicalSkuId: line.canonicalSkuId,
                        itemName: line.description,
                        categoryCode: line.categoryCode,
                        procurementBucket: line.procurementBucket,
                        unitSi: line.unitSi,
                        inTransitDelta: -prog.incoming,
                        inWarehouseDelta: netUsableReceived,
                        unitCostClp: netUnitCost,
                        movementType: 'RECEIPT_AT_WAREHOUSE',
                        referenceId: loaded.purchaseId,
                        actorUid: actor.actorUid,
                        now,
                    });
                    computed.ledgerEntry.warehouseId = targetWhId;
                    computed.ledgerEntry.lotNumber = det?.lotNumber || null;
                    computed.ledgerEntry.expiryDateIso = det?.expiryDateIso || null;
                    txUpdatedInventory.set(invDocId, computed.record);
                    txStockLedgers.push(computed.ledgerEntry);

                    if (shrinkageQty > 0) {
                        txStockLedgers.push({
                            entryId: `stk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
                            tenantId: params.tenantId,
                            siteId: loaded.siteId,
                            warehouseId: targetWhId,
                            canonicalSkuId: line.canonicalSkuId,
                            movementType: 'SHRINKAGE_WASTE',
                            qtyDelta: -shrinkageQty,
                            unitSi: line.unitSi,
                            unitCostClp: netUnitCost,
                            shrinkageReason: det?.shrinkageReason || 'Merma detectada en recepción física 4-Way',
                            lotNumber: det?.lotNumber || null,
                            expiryDateIso: det?.expiryDateIso || null,
                            referenceId: loaded.purchaseId,
                            actorUid: actor.actorUid,
                            createdAt: now,
                        });
                    }

                    // Actualizar balance en bodega física si fue indicada y pertenece al tenant
                    if (targetWhId && warehouseById.has(targetWhId) && netUsableReceived > 0) {
                        const wh = warehouseById.get(targetWhId)!;
                        const balDocId = buildWarehouseBalanceDocId(
                            params.tenantId,
                            loaded.siteId,
                            targetWhId,
                            line.canonicalSkuId
                        );
                        const prevBal = txUpdatedWhBalances.get(balDocId) ?? whBalanceByDocId.get(balDocId) ?? null;
                        const prevQty = Number(prevBal?.qtyOnHand || 0);
                        const prevPmp = Number(prevBal?.pmpNetClp || 0);
                        const nextQty = Number((prevQty + netUsableReceived).toFixed(3));
                        const nextPmp =
                            netUnitCost > 0
                                ? Math.round((prevQty * prevPmp + netUsableReceived * netUnitCost) / Math.max(1, nextQty))
                                : prevPmp;
                        txUpdatedWhBalances.set(balDocId, {
                            balanceId: balDocId,
                            tenantId: params.tenantId,
                            siteId: loaded.siteId,
                            warehouseId: targetWhId,
                            warehouseClass: wh.warehouseClass,
                            canonicalSkuId: line.canonicalSkuId,
                            itemName: prevBal?.itemName || line.description,
                            categoryCode: line.categoryCode,
                            procurementBucket: line.procurementBucket,
                            unitSi: line.unitSi,
                            qtyOnHand: nextQty,
                            qtyInTransit: 0,
                            pmpNetClp: nextPmp,
                            totalValueNetClp: Math.round(nextQty * nextPmp),
                            fullCount: prevBal?.fullCount ?? null,
                            emptyCount: prevBal?.emptyCount ?? null,
                            lotNumber: det?.lotNumber || prevBal?.lotNumber || null,
                            expiryDateIso: det?.expiryDateIso || prevBal?.expiryDateIso || null,
                            updatedAt: now,
                        });
                    }
                }

                // Persistir discrepancia real de recepción o merma por línea
                const expectedQty = Math.max(0, Number((line.qtyPurchased - prog.prev).toFixed(3)));
                const domainDisc = domainReception.discrepancies.find(
                    (d) => d.canonicalSkuId === line.canonicalSkuId
                );
                if ((domainDisc && (domainDisc.shortageQty > 0 || domainDisc.excessQty > 0)) || shrinkageQty > 0) {
                    const shortageQty = prog.incoming < expectedQty ? Number((expectedQty - prog.incoming).toFixed(3)) : 0;
                    const excessQty = prog.incoming > expectedQty ? Number((prog.incoming - expectedQty).toFixed(3)) : 0;
                    const needCreditNote = shortageQty > 0 || shrinkageQty > 0;
                    txDiscrepancies.push({
                        discrepancyId: `disc_${loaded.purchaseId}_${line.purchaseLineId}_${Date.now().toString(36)}`,
                        tenantId: params.tenantId,
                        siteId: loaded.siteId,
                        purchaseId: loaded.purchaseId,
                        purchaseLineId: line.purchaseLineId,
                        warehouseId: targetWhId || null,
                        canonicalSkuId: line.canonicalSkuId,
                        itemName: line.description,
                        unitSi: line.unitSi,
                        expectedQty,
                        receivedQty: prog.incoming,
                        shortageQty,
                        excessQty,
                        shrinkageQty,
                        shrinkageReason: det?.shrinkageReason || null,
                        evidenceCasRef: det?.evidenceCasRef || params.evidenceCasRef || null,
                        siiDocId,
                        rcvDaysRemaining,
                        urgentRcvClaimRequired: isUrgentRcv && needCreditNote,
                        suggestCreditNote61: needCreditNote,
                        status: 'OPEN',
                        actorUid: actor.actorUid,
                        createdAtIso: now,
                        updatedAtIso: now,
                    });
                }

                return {
                    ...line,
                    qtyReceivedSoFar: prog.next,
                };
            });

            const allInTransitComplete = updatedPurchaseLines
                .filter((l) => l.destination === 'STOCK_IN_TRANSIT')
                .every((l) => Number(l.qtyReceivedSoFar ?? 0) >= Number(l.qtyPurchased) - 1e-6);

            const nextStatus: SupplyPurchase['receptionStatus'] =
                allInTransitComplete && txDiscrepancies.every((d) => d.shrinkageQty === 0)
                    ? 'RECEIVED'
                    : 'PARTIAL_DISCREPANCY';
            const nextOutcome: 'RECEIVED_OK' | 'PARTIAL_DISCREPANCY' =
                nextStatus === 'RECEIVED' ? 'RECEIVED_OK' : 'PARTIAL_DISCREPANCY';

            // Distribuir qty entrante hacia requisiciones sin doble conteo entre recepciones parciales
            const txAffectedReqs: SupplyRequisition[] = [];
            for (const [reqId, reqData] of txReqs.entries()) {
                let mutated = false;
                const updatedLines = reqData.lines.map((l) => {
                    const matchingAllocs = allocs.filter(
                        (a) => a.requisitionId === reqId && a.requisitionLineId === l.lineId
                    );
                    if (matchingAllocs.length === 0) return l;
                    let addRec = 0;
                    for (const alloc of matchingAllocs) {
                        const prog = incomingByLineId.get(alloc.purchaseLineId);
                        if (!prog || prog.incoming <= 0) continue;
                        const pLine = inTransitLines.find((pl) => pl.purchaseLineId === alloc.purchaseLineId);
                        const ratio =
                            pLine && pLine.qtyPurchased > 0
                                ? Math.min(1, prog.incoming / pLine.qtyPurchased)
                                : 1;
                        addRec += Number((alloc.qtyAllocated * ratio).toFixed(3));
                    }
                    if (addRec <= 0) return l;
                    mutated = true;
                    return {
                        ...l,
                        qtyReceived: Math.min(l.qtyRequested, Number((l.qtyReceived + addRec).toFixed(3))),
                    };
                });
                if (mutated) {
                    const nextReq: SupplyRequisition = {
                        ...reqData,
                        lines: updatedLines,
                        updatedAt: now,
                    };
                    txReqs.set(reqId, nextReq);
                    txAffectedReqs.push(nextReq);
                }
            }

            const nextPurchase: SupplyPurchase = {
                ...loaded,
                lines: updatedPurchaseLines,
                receptionStatus: nextStatus,
                receivedAt: now,
                receivedByUid: actor.actorUid,
                updatedAt: now,
            };

            // FASE 3: TODAS LAS ESCRITURAS ATÓMICAS EN LA MISMA TRANSACCIÓN
            tx.set(ref, nextPurchase, { merge: true });
            for (const [invDocId, invRecord] of txUpdatedInventory.entries()) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(invDocId), invRecord, {
                    merge: true,
                });
            }
            for (const [balDocId, balRecord] of txUpdatedWhBalances.entries()) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES).doc(balDocId), balRecord, {
                    merge: true,
                });
            }
            for (const ledgerEntry of txStockLedgers) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(ledgerEntry.entryId), ledgerEntry);
            }
            for (const disc of txDiscrepancies) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.RECEPTION_DISCREPANCIES).doc(disc.discrepancyId), disc);
            }
            for (const reqItem of txAffectedReqs) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(reqItem.reqId), reqItem, {
                    merge: true,
                });
            }

            updatedPurchase = nextPurchase;
            receptionOutcome = nextOutcome;
            receivedItemCount = txReceivedItemCount;
            affectedRequisitions = txAffectedReqs;
            createdDiscrepancies = txDiscrepancies;
            urgentRcvAlert = txDiscrepancies.some((d) => d.urgentRcvClaimRequired);
            suggestCreditNote61 = txDiscrepancies.some((d) => d.suggestCreditNote61);
        });

        if (urgentRcvAlert) {
            await this.recordPolicyAudit({
                tenantId: params.tenantId,
                siteId: updatedPurchase.siteId,
                actorUid: actor.actorUid,
                eventType: 'SII_FISCAL_WARNING',
                policyCode: 'RCV_URGENT_DISCREPANCY_CLAIM',
                severity: 'HIGH',
                entityId: updatedPurchase.purchaseId,
                details: {
                    discrepancyCount: createdDiscrepancies.length,
                    suggestCreditNote61,
                    rcvDaysRemaining: createdDiscrepancies[0]?.rcvDaysRemaining ?? null,
                },
            });
        }

        await this.recordAudit(params.tenantId, actor, 'SUPPLY_PURCHASE_RECEPTION_CONFIRMED', updatedPurchase.purchaseId, {
            hitlConfirmed: true,
            receptionStatus: updatedPurchase.receptionStatus,
            receptionOutcome,
            receivedItemCount,
            discrepancyCount: createdDiscrepancies.length,
            urgentRcvAlert,
            suggestCreditNote61,
            affectedRequisitionIds: affectedRequisitions.map((r) => r.reqId),
        });

        return {
            purchase: updatedPurchase,
            receptionOutcome,
            receivedItemCount,
            affectedRequisitions,
            discrepancies: createdDiscrepancies,
            urgentRcvAlert,
            suggestCreditNote61,
        };
    }

    // -----------------------------------------------------------------------
    // V3-E04: Bodegas Físicas (`supply_warehouses`), Kardex Transaccional & Aforos
    // -----------------------------------------------------------------------

    public static async listWarehouses(
        tenantId: string,
        siteId?: string,
        limit?: number
    ): Promise<SupplyWarehouse[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.WAREHOUSES)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyWarehouse);
        if (siteId) list = list.filter((w) => w.siteId === siteId);
        return list.sort((a, b) => a.code.localeCompare(b.code, 'es'));
    }

    public static async upsertWarehouse(
        tenantId: string,
        rawInput: unknown,
        actor: AuditActorContext
    ): Promise<SupplyWarehouse> {
        const parsed = CreateSupplyWarehouseRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_WAREHOUSE_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para bodega física.'
            );
        }

        const input = parsed.data;
        const now = new Date().toISOString();
        const codeSlug = input.code
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        const warehouseId =
            input.warehouseId?.trim() ||
            `wh_${safeDocIdPart(tenantId)}_${safeDocIdPart(input.siteId)}_${codeSlug || crypto.randomBytes(3).toString('hex')}`;

        const ref = db.collection(SUPPLY_COLLECTIONS.WAREHOUSES).doc(warehouseId);
        const existingSnap = await ref.get();
        if (existingSnap.exists) {
            const prev = existingSnap.data() as SupplyWarehouse;
            if (prev.tenantId && prev.tenantId !== tenantId) {
                throw new SupplyForbiddenError(
                    'TENANT_ACCESS_DENIED: La bodega pertenece a otra cuenta organizacional.'
                );
            }
        }

        const existingData = existingSnap.exists ? (existingSnap.data() as SupplyWarehouse) : null;
        const warehouse: SupplyWarehouse = {
            warehouseId,
            tenantId,
            siteId: input.siteId,
            code: input.code,
            name: input.name,
            warehouseClass: input.warehouseClass,
            allowedChannelIds: Array.from(new Set(input.allowedChannelIds)),
            defaultCostCenter: input.defaultCostCenter,
            capacityUnitSi: input.capacityUnitSi,
            maxCapacitySi: input.maxCapacitySi,
            secTc4Code: input.secTc4Code ?? existingData?.secTc4Code ?? null,
            dgmnResolutionCode: input.dgmnResolutionCode ?? existingData?.dgmnResolutionCode ?? null,
            geoFix: input.geoFix ?? existingData?.geoFix ?? null,
            status: input.status,
            createdAt: existingData?.createdAt || now,
            updatedAt: now,
        };

        await ref.set(warehouse, { merge: true });
        await this.recordAudit(tenantId, actor, 'SUPPLY_WAREHOUSE_UPSERTED', warehouseId, {
            hitlConfirmed: true,
            siteId: warehouse.siteId,
            warehouseClass: warehouse.warehouseClass,
            code: warehouse.code,
        });
        return warehouse;
    }

    public static async listWarehouseBalances(
        tenantId: string,
        filters?: { siteId?: string; warehouseId?: string; canonicalSkuId?: string; limit?: number }
    ): Promise<SupplyWarehouseBalance[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyWarehouseBalance);
        if (filters?.siteId) list = list.filter((b) => b.siteId === filters.siteId);
        if (filters?.warehouseId) list = list.filter((b) => b.warehouseId === filters.warehouseId);
        if (filters?.canonicalSkuId) list = list.filter((b) => b.canonicalSkuId === filters.canonicalSkuId);
        return list.sort((a, b) => {
            if (a.expiryDateIso && b.expiryDateIso) {
                return a.expiryDateIso.localeCompare(b.expiryDateIso);
            }
            if (a.expiryDateIso) return -1;
            if (b.expiryDateIso) return 1;
            return a.itemName.localeCompare(b.itemName, 'es');
        });
    }

    public static async listStockLedger(
        tenantId: string,
        filters?: {
            siteId?: string;
            warehouseId?: string;
            canonicalSkuId?: string;
            movementType?: string;
            limit?: number;
        }
    ): Promise<StockLedgerEntry[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.STOCK_LEDGER)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit))
            .get();
        let list = snap.docs.map((d) => d.data() as StockLedgerEntry);
        if (filters?.siteId) list = list.filter((e) => e.siteId === filters.siteId);
        if (filters?.warehouseId) {
            list = list.filter(
                (e) => e.warehouseId === filters.warehouseId || e.toWarehouseId === filters.warehouseId
            );
        }
        if (filters?.canonicalSkuId) list = list.filter((e) => e.canonicalSkuId === filters.canonicalSkuId);
        if (filters?.movementType) list = list.filter((e) => e.movementType === filters.movementType);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async listReceptionDiscrepancies(
        tenantId: string,
        filters?: { siteId?: string; purchaseId?: string; status?: string; limit?: number }
    ): Promise<SupplyReceptionDiscrepancy[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.RECEPTION_DISCREPANCIES)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyReceptionDiscrepancy);
        if (filters?.siteId) list = list.filter((d) => d.siteId === filters.siteId);
        if (filters?.purchaseId) list = list.filter((d) => d.purchaseId === filters.purchaseId);
        if (filters?.status) list = list.filter((d) => d.status === filters.status);
        return list.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    }

    public static async listTankTelemetry(
        tenantId: string,
        filters?: { siteId?: string; warehouseId?: string; limit?: number }
    ): Promise<SupplyTankTelemetry[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.TANK_TELEMETRY)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyTankTelemetry);
        if (filters?.siteId) list = list.filter((t) => t.siteId === filters.siteId);
        if (filters?.warehouseId) list = list.filter((t) => t.warehouseId === filters.warehouseId);
        return list.sort((a, b) => b.measuredAtIso.localeCompare(a.measuredAtIso));
    }

    public static async recordKardexMovement(
        tenantId: string,
        rawInput: unknown,
        actor: AuditActorContext
    ): Promise<{
        entries: StockLedgerEntry[];
        originBalance: SupplyWarehouseBalance;
        destinationBalance?: SupplyWarehouseBalance;
        transferGroupId?: string;
        fuelTelemetryAudit?: FuelDispatchAuditResult;
    }> {
        const parsed = RecordStockMovementRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_KARDEX_MOVEMENT_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para movimiento de Kardex.'
            );
        }
        const input = parsed.data;
        const catalogSku = findDomainCanonicalSkuById(input.canonicalSkuId);
        const categoryCode = normalizeLegacySupplyCategoryCode(
            input.categoryCode || catalogSku?.categoryCode || 'OTROS_OPERACIONAL'
        );
        const procurementBucket = normalizeLegacyProcurementBucket(
            input.procurementBucket || catalogSku?.procurementBucket || 'FERRETERIA_INSUMOS'
        );
        const itemName = input.itemName || catalogSku?.name || input.canonicalSkuId;
        const unitSi = input.unitSi || catalogSku?.baseUnitSi || 'un';

        if (
            input.movementType === 'ISSUE_CONSUMPTION' &&
            (categoryCode === 'COMBUSTIBLE_FLOTA_PROD' ||
                categoryCode === 'REPUESTOS_MAQUINARIA' ||
                categoryCode === 'LUBRICANTES_FILTROS')
        ) {
            if (!input.linkedAssetId || !input.linkedAssetId.trim()) {
                throw new SupplyValidationError(
                    'ASSET_ID_REQUIRED_FOR_FLEET_ISSUE',
                    'Los despachos de combustible flota, lubricantes y repuestos requieren linkedAssetId (código equipo OPERMAQ).'
                );
            }
            if (
                categoryCode === 'COMBUSTIBLE_FLOTA_PROD' &&
                (typeof input.horometer !== 'number' || !Number.isFinite(input.horometer) || input.horometer < 0)
            ) {
                throw new SupplyValidationError(
                    'HOROMETER_REQUIRED_FOR_FLEET_FUEL',
                    'Los despachos de combustible flota requieren lectura de horómetro válida (>= 0).'
                );
            }
        }

        const now = new Date().toISOString();
        const originWhRef = db.collection(SUPPLY_COLLECTIONS.WAREHOUSES).doc(input.warehouseId);
        const originBalDocId = buildWarehouseBalanceDocId(
            tenantId,
            input.siteId,
            input.warehouseId,
            input.canonicalSkuId
        );
        const originBalRef = db.collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES).doc(originBalDocId);
        const invDocId = buildInventoryDocId(tenantId, input.siteId, input.canonicalSkuId);
        const invRef = db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(invDocId);

        const isTransfer = input.movementType === 'TRANSFER_OUT';
        const destWhId = isTransfer ? input.toWarehouseId! : undefined;
        const destWhRef = destWhId ? db.collection(SUPPLY_COLLECTIONS.WAREHOUSES).doc(destWhId) : null;
        const destBalDocId = destWhId
            ? buildWarehouseBalanceDocId(tenantId, input.siteId, destWhId, input.canonicalSkuId)
            : null;
        const destBalRef = destBalDocId
            ? db.collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES).doc(destBalDocId)
            : null;

        let resultEntries: StockLedgerEntry[] = [];
        let resultOriginBalance!: SupplyWarehouseBalance;
        let resultDestBalance: SupplyWarehouseBalance | undefined;
        let transferGroupId: string | undefined;

        await db.runTransaction(async (tx) => {
            const originWhSnap = await tx.get(originWhRef);
            if (!originWhSnap.exists) {
                throw new SupplyNotFoundError(`Bodega origen ${input.warehouseId} no encontrada.`);
            }
            const originWh = originWhSnap.data() as SupplyWarehouse;
            if (originWh.tenantId !== tenantId) {
                throw new SupplyForbiddenError('TENANT_ACCESS_DENIED: Bodega origen pertenece a otro tenant.');
            }
            if (originWh.siteId !== input.siteId) {
                throw new SupplyValidationError(
                    'SITE_WAREHOUSE_MISMATCH',
                    `Bodega ${input.warehouseId} no pertenece al sitio ${input.siteId}.`
                );
            }

            let destWh: SupplyWarehouse | null = null;
            if (destWhRef) {
                const destSnap = await tx.get(destWhRef);
                if (!destSnap.exists) {
                    throw new SupplyNotFoundError(`Bodega destino ${destWhId} no encontrada.`);
                }
                destWh = destSnap.data() as SupplyWarehouse;
                if (destWh.tenantId !== tenantId) {
                    throw new SupplyForbiddenError('TENANT_ACCESS_DENIED: Bodega destino pertenece a otro tenant.');
                }
                if (destWh.siteId !== input.siteId) {
                    throw new SupplyValidationError(
                        'SITE_WAREHOUSE_MISMATCH',
                        `Bodega destino ${destWhId} no pertenece al sitio ${input.siteId}.`
                    );
                }
            }

            const originBalSnap = await tx.get(originBalRef);
            const prevOriginBal = originBalSnap.exists
                ? (originBalSnap.data() as SupplyWarehouseBalance)
                : null;
            const destBalSnap = destBalRef ? await tx.get(destBalRef) : null;
            const prevDestBal =
                destBalSnap && destBalSnap.exists
                    ? (destBalSnap.data() as SupplyWarehouseBalance)
                    : null;
            const invSnap = await tx.get(invRef);
            const prevInv = invSnap.exists ? (invSnap.data() as SupplyInventoryItem) : null;

            const isInbound =
                input.movementType === 'DIRECT_RECEIPT' ||
                input.movementType === 'RECEIPT_AT_WAREHOUSE' ||
                input.movementType === 'TRANSFER_IN' ||
                input.movementType === 'RETURN_TO_WAREHOUSE';
            const isOutbound =
                input.movementType === 'ISSUE_CONSUMPTION' ||
                input.movementType === 'TRANSFER_OUT' ||
                input.movementType === 'SHRINKAGE_WASTE';

            const prevQty = Number(prevOriginBal?.qtyOnHand || 0);
            const prevPmp = Number(prevOriginBal?.pmpNetClp || 0);

            if (isOutbound && prevQty + 1e-6 < input.qtySi) {
                throw new SupplyConflictError(
                    'INSUFFICIENT_WAREHOUSE_STOCK',
                    `Saldo insuficiente en bodega ${input.warehouseId} para ${input.canonicalSkuId}: disponible ${prevQty} ${unitSi}, solicitado ${input.qtySi} ${unitSi}.`
                );
            }

            const signedDelta = isOutbound ? -input.qtySi : input.qtySi;
            const nextQty = Math.max(0, Number((prevQty + signedDelta).toFixed(3)));
            const inputCost = Number(input.unitCostNetClp ?? prevPmp ?? catalogSku?.referenceUnitPriceClp ?? 0);
            const nextPmp =
                isInbound && inputCost > 0 && nextQty > 0
                    ? Math.round((prevQty * prevPmp + input.qtySi * inputCost) / nextQty)
                    : prevPmp || inputCost;
            const entryUnitCost = isOutbound ? prevPmp || inputCost : inputCost;

            const nextFullCount =
                typeof input.fullCount === 'number'
                    ? input.fullCount
                    : prevOriginBal?.fullCount ?? null;
            const nextEmptyCount =
                typeof input.emptyCount === 'number'
                    ? input.emptyCount
                    : prevOriginBal?.emptyCount ?? null;

            const nextOriginBal: SupplyWarehouseBalance = {
                balanceId: originBalDocId,
                tenantId,
                siteId: input.siteId,
                warehouseId: input.warehouseId,
                warehouseClass: originWh.warehouseClass,
                canonicalSkuId: input.canonicalSkuId,
                itemName: prevOriginBal?.itemName || itemName,
                categoryCode,
                procurementBucket,
                unitSi,
                qtyOnHand: nextQty,
                qtyInTransit: Number(prevOriginBal?.qtyInTransit || 0),
                pmpNetClp: nextPmp,
                totalValueNetClp: Math.round(nextQty * nextPmp),
                fullCount: nextFullCount,
                emptyCount: nextEmptyCount,
                lotNumber: input.lotNumber ?? prevOriginBal?.lotNumber ?? null,
                expiryDateIso: input.expiryDateIso ?? prevOriginBal?.expiryDateIso ?? null,
                updatedAt: now,
            };

            const effectiveTransferGroup = isTransfer
                ? `trf_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
                : undefined;

            const primaryEntry: StockLedgerEntry = {
                entryId: `stk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
                tenantId,
                siteId: input.siteId,
                warehouseId: input.warehouseId,
                ...(destWhId ? { toWarehouseId: destWhId } : {}),
                canonicalSkuId: input.canonicalSkuId,
                movementType: input.movementType,
                qtyDelta: signedDelta,
                unitSi,
                unitCostClp: entryUnitCost,
                costCenter: input.costCenter || originWh.defaultCostCenter,
                linkedAssetId: input.linkedAssetId ?? null,
                horometer: input.horometer ?? null,
                fullCount: input.fullCount ?? null,
                emptyCount: input.emptyCount ?? null,
                transferGroupId: effectiveTransferGroup ?? null,
                lotNumber: input.lotNumber ?? null,
                expiryDateIso: input.expiryDateIso ?? null,
                shrinkageReason: input.shrinkageReason ?? null,
                notes: input.notes,
                referenceId: input.referenceId || effectiveTransferGroup || input.warehouseId,
                actorUid: actor.actorUid,
                createdAt: now,
            };

            const entriesToWrite: StockLedgerEntry[] = [primaryEntry];
            let nextDestBal: SupplyWarehouseBalance | undefined;

            if (isTransfer && destWh && destBalDocId) {
                const destPrevQty = Number(prevDestBal?.qtyOnHand || 0);
                const destPrevPmp = Number(prevDestBal?.pmpNetClp || 0);
                const transferUnitCost = prevPmp || inputCost;
                const destNextQty = Number((destPrevQty + input.qtySi).toFixed(3));
                const destNextPmp =
                    transferUnitCost > 0 && destNextQty > 0
                        ? Math.round((destPrevQty * destPrevPmp + input.qtySi * transferUnitCost) / destNextQty)
                        : destPrevPmp;

                nextDestBal = {
                    balanceId: destBalDocId,
                    tenantId,
                    siteId: input.siteId,
                    warehouseId: destWh.warehouseId,
                    warehouseClass: destWh.warehouseClass,
                    canonicalSkuId: input.canonicalSkuId,
                    itemName: prevDestBal?.itemName || itemName,
                    categoryCode,
                    procurementBucket,
                    unitSi,
                    qtyOnHand: destNextQty,
                    qtyInTransit: Number(prevDestBal?.qtyInTransit || 0),
                    pmpNetClp: destNextPmp,
                    totalValueNetClp: Math.round(destNextQty * destNextPmp),
                    fullCount: prevDestBal?.fullCount ?? null,
                    emptyCount: prevDestBal?.emptyCount ?? null,
                    lotNumber: input.lotNumber ?? prevDestBal?.lotNumber ?? null,
                    expiryDateIso: input.expiryDateIso ?? prevDestBal?.expiryDateIso ?? null,
                    updatedAt: now,
                };

                entriesToWrite.push({
                    entryId: `stk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
                    tenantId,
                    siteId: input.siteId,
                    warehouseId: destWh.warehouseId,
                    canonicalSkuId: input.canonicalSkuId,
                    movementType: 'TRANSFER_IN',
                    qtyDelta: input.qtySi,
                    unitSi,
                    unitCostClp: transferUnitCost,
                    costCenter: input.costCenter || destWh.defaultCostCenter,
                    transferGroupId: effectiveTransferGroup!,
                    lotNumber: input.lotNumber ?? null,
                    expiryDateIso: input.expiryDateIso ?? null,
                    notes: input.notes,
                    referenceId: effectiveTransferGroup!,
                    actorUid: actor.actorUid,
                    createdAt: now,
                });
            }

            let nextInvRecord: SupplyInventoryItem | null = null;
            if (!isTransfer) {
                const prevSiteQty = Number(prevInv?.qtyInWarehouse || 0);
                const nextSiteQty = Math.max(0, Number((prevSiteQty + signedDelta).toFixed(3)));
                const prevSiteAvg = Number(prevInv?.avgUnitCostClp || 0);
                const nextSiteAvg =
                    isInbound && entryUnitCost > 0 && nextSiteQty > 0
                        ? Math.round((prevSiteQty * prevSiteAvg + input.qtySi * entryUnitCost) / nextSiteQty)
                        : prevSiteAvg || nextPmp;
                nextInvRecord = {
                    inventoryKey: invDocId,
                    tenantId,
                    siteId: input.siteId,
                    canonicalSkuId: input.canonicalSkuId,
                    itemName: prevInv?.itemName || itemName,
                    categoryCode: prevInv?.categoryCode || categoryCode,
                    procurementBucket: prevInv?.procurementBucket || procurementBucket,
                    unitSi: prevInv?.unitSi || unitSi,
                    qtyInTransit: Number(prevInv?.qtyInTransit || 0),
                    qtyInWarehouse: nextSiteQty,
                    avgUnitCostClp: nextSiteAvg,
                    updatedAt: now,
                };
            }

            tx.set(originBalRef, nextOriginBal, { merge: true });
            if (destBalRef && nextDestBal) {
                tx.set(destBalRef, nextDestBal, { merge: true });
            }
            for (const entry of entriesToWrite) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(entry.entryId), entry);
            }
            if (nextInvRecord) {
                tx.set(invRef, nextInvRecord, { merge: true });
            }

            resultEntries = entriesToWrite;
            resultOriginBalance = nextOriginBal;
            resultDestBalance = nextDestBal;
            transferGroupId = effectiveTransferGroup;
        });

        await this.recordAudit(
            tenantId,
            actor,
            isTransfer ? 'SUPPLY_WAREHOUSE_TRANSFER_RECORDED' : 'SUPPLY_KARDEX_MOVEMENT_RECORDED',
            resultEntries[0].entryId,
            {
                warehouseId: input.warehouseId,
                toWarehouseId: destWhId || null,
                transferGroupId: transferGroupId || null,
                canonicalSkuId: input.canonicalSkuId,
                movementType: input.movementType,
                qtySi: input.qtySi,
                linkedAssetId: input.linkedAssetId || null,
                horometer: input.horometer ?? null,
            }
        );

        let fuelTelemetryAudit: FuelDispatchAuditResult | undefined;
        if (
            input.movementType === 'ISSUE_CONSUMPTION' &&
            categoryCode === 'COMBUSTIBLE_FLOTA_PROD' &&
            input.linkedAssetId &&
            typeof input.horometer === 'number'
        ) {
            const latestTeleSnap = await db
                .collection(SUPPLY_COLLECTIONS.TANK_TELEMETRY)
                .where('tenantId', '==', tenantId)
                .where('warehouseId', '==', input.warehouseId)
                .limit(10)
                .get()
                .catch(() => null);
            const latestVariance = latestTeleSnap?.docs
                ?.map((d) => d.data() as SupplyTankTelemetry)
                ?.sort((a, b) =>
                    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
                )?.[0]?.variancePct;

            fuelTelemetryAudit = await FuelOpermaqTelemetryReconciler.auditFuelDispatch({
                tenantId,
                siteId: input.siteId,
                warehouseId: input.warehouseId,
                opermaqAssetId: input.linkedAssetId,
                canonicalSkuId: input.canonicalSkuId,
                litersDispensed: input.qtySi,
                currentHorometer: input.horometer,
                latestTankVariancePct: latestVariance ?? null,
                actorUid: actor.actorUid,
                dispatchRefId: resultEntries[0].entryId,
            });
        }

        return {
            entries: resultEntries,
            originBalance: resultOriginBalance,
            ...(resultDestBalance ? { destinationBalance: resultDestBalance } : {}),
            ...(transferGroupId ? { transferGroupId } : {}),
            ...(fuelTelemetryAudit ? { fuelTelemetryAudit } : {}),
        };
    }

    public static async recordTankCycleCount(
        tenantId: string,
        rawInput: unknown,
        actor: AuditActorContext
    ): Promise<{
        telemetry: SupplyTankTelemetry;
        ledgerEntry: StockLedgerEntry;
        balance: SupplyWarehouseBalance;
        anomalyAlertCode: string | null;
    }> {
        const parsed = TankCycleCountRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_TANK_CYCLE_COUNT_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para aforo de estanque/polvorín.'
            );
        }

        const input = parsed.data;
        const now = new Date().toISOString();
        const measuredAtIso = input.measuredAtIso || now;
        const catalogSku = findDomainCanonicalSkuById(input.canonicalSkuId);

        const whRef = db.collection(SUPPLY_COLLECTIONS.WAREHOUSES).doc(input.warehouseId);
        const balDocId = buildWarehouseBalanceDocId(
            tenantId,
            input.siteId,
            input.warehouseId,
            input.canonicalSkuId
        );
        const balRef = db.collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES).doc(balDocId);
        const invDocId = buildInventoryDocId(tenantId, input.siteId, input.canonicalSkuId);
        const invRef = db.collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS).doc(invDocId);

        let resultTelemetry!: SupplyTankTelemetry;
        let resultLedger!: StockLedgerEntry;
        let resultBalance!: SupplyWarehouseBalance;
        let anomalyAlertCode: string | null = null;

        await db.runTransaction(async (tx) => {
            const whSnap = await tx.get(whRef);
            if (!whSnap.exists) {
                throw new SupplyNotFoundError(`Bodega/Estanque ${input.warehouseId} no encontrado.`);
            }
            const wh = whSnap.data() as SupplyWarehouse;
            if (wh.tenantId !== tenantId) {
                throw new SupplyForbiddenError('TENANT_ACCESS_DENIED: Estanque pertenece a otro tenant.');
            }
            if (wh.siteId !== input.siteId) {
                throw new SupplyValidationError(
                    'SITE_WAREHOUSE_MISMATCH',
                    `Estanque ${input.warehouseId} no pertenece al sitio ${input.siteId}.`
                );
            }

            const balSnap = await tx.get(balRef);
            const prevBal = balSnap.exists ? (balSnap.data() as SupplyWarehouseBalance) : null;
            const invSnap = await tx.get(invRef);
            const prevInv = invSnap.exists ? (invSnap.data() as SupplyInventoryItem) : null;

            const categoryCode = normalizeLegacySupplyCategoryCode(
                prevBal?.categoryCode || catalogSku?.categoryCode || 'OTROS_OPERACIONAL'
            );
            const procurementBucket = normalizeLegacyProcurementBucket(
                prevBal?.procurementBucket || catalogSku?.procurementBucket || 'FERRETERIA_INSUMOS'
            );
            const unitSi = prevBal?.unitSi || catalogSku?.baseUnitSi || wh.capacityUnitSi || 'L';
            const itemName = prevBal?.itemName || catalogSku?.name || input.canonicalSkuId;

            const bookBalanceSi = Number(prevBal?.qtyOnHand || 0);
            const varianceSi = Number((input.measuredLevelSi - bookBalanceSi).toFixed(3));
            const variancePct =
                bookBalanceSi > 0
                    ? Number(((Math.abs(varianceSi) / bookBalanceSi) * 100).toFixed(2))
                    : input.measuredLevelSi > 0
                      ? 100
                      : 0;
            const capacitySi = Math.max(0, Number(wh.maxCapacitySi || 0));
            const occupancyPct =
                capacitySi > 0
                    ? Math.min(200, Number(((input.measuredLevelSi / capacitySi) * 100).toFixed(2)))
                    : 0;

            const isMagazine =
                wh.warehouseClass === 'MAGAZINE_DGMN' || categoryCode === 'EXPLOSIVOS_REGULADO';
            const isFuelTank =
                wh.warehouseClass === 'FUEL_TANK_CAMP' || wh.warehouseClass === 'FUEL_TANK_FLEET';
            const anomalyFlag =
                (isMagazine && Math.abs(varianceSi) > 0) || (isFuelTank && variancePct > 2.5);

            if (isMagazine && Math.abs(varianceSi) > 0) {
                anomalyAlertCode = 'DGMN_MAGAZINE_VARIANCE_ALERT';
            } else if (isFuelTank && variancePct > 2.5) {
                anomalyAlertCode = 'FUEL_TANK_VARIANCE_OVER_2_5_PCT';
            }

            const telemetryId = `tlm_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
            const telemetry: SupplyTankTelemetry = {
                telemetryId,
                tenantId,
                siteId: input.siteId,
                warehouseId: wh.warehouseId,
                warehouseClass: wh.warehouseClass,
                canonicalSkuId: input.canonicalSkuId,
                measuredAtIso,
                measuredLevelSi: input.measuredLevelSi,
                capacitySi,
                occupancyPct,
                bookBalanceSi,
                varianceSi,
                variancePct,
                anomalyFlag,
                measuredByUid: actor.actorUid,
                notes: input.notes,
                evidenceCasRef: input.evidenceCasRef || null,
                createdAt: now,
            };

            const pmpNetClp = Number(prevBal?.pmpNetClp || prevInv?.avgUnitCostClp || 0);
            const nextBalance: SupplyWarehouseBalance = {
                balanceId: balDocId,
                tenantId,
                siteId: input.siteId,
                warehouseId: wh.warehouseId,
                warehouseClass: wh.warehouseClass,
                canonicalSkuId: input.canonicalSkuId,
                itemName,
                categoryCode,
                procurementBucket,
                unitSi,
                qtyOnHand: input.measuredLevelSi,
                qtyInTransit: Number(prevBal?.qtyInTransit || 0),
                pmpNetClp,
                totalValueNetClp: Math.round(input.measuredLevelSi * pmpNetClp),
                fullCount: prevBal?.fullCount ?? null,
                emptyCount: prevBal?.emptyCount ?? null,
                lotNumber: prevBal?.lotNumber ?? null,
                expiryDateIso: prevBal?.expiryDateIso ?? null,
                updatedAt: now,
            };

            const ledgerEntry: StockLedgerEntry = {
                entryId: `stk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
                tenantId,
                siteId: input.siteId,
                warehouseId: wh.warehouseId,
                canonicalSkuId: input.canonicalSkuId,
                movementType: 'CYCLE_COUNT_ADJUSTMENT',
                qtyDelta: varianceSi,
                unitSi,
                unitCostClp: pmpNetClp,
                costCenter: wh.defaultCostCenter,
                variancePct,
                anomalyFlag,
                notes:
                    input.notes ||
                    `Aforo varilla/cíclico: libro ${bookBalanceSi} -> medido ${input.measuredLevelSi} (${variancePct}%)`,
                referenceId: telemetryId,
                actorUid: actor.actorUid,
                createdAt: now,
            };

            const nextSiteQty = Math.max(
                0,
                Number((Number(prevInv?.qtyInWarehouse || 0) + varianceSi).toFixed(3))
            );
            const nextInvRecord: SupplyInventoryItem = {
                inventoryKey: invDocId,
                tenantId,
                siteId: input.siteId,
                canonicalSkuId: input.canonicalSkuId,
                itemName: prevInv?.itemName || itemName,
                categoryCode: prevInv?.categoryCode || categoryCode,
                procurementBucket: prevInv?.procurementBucket || procurementBucket,
                unitSi: prevInv?.unitSi || unitSi,
                qtyInTransit: Number(prevInv?.qtyInTransit || 0),
                qtyInWarehouse: nextSiteQty,
                avgUnitCostClp: prevInv?.avgUnitCostClp || pmpNetClp,
                updatedAt: now,
            };

            tx.set(db.collection(SUPPLY_COLLECTIONS.TANK_TELEMETRY).doc(telemetryId), telemetry);
            tx.set(balRef, nextBalance, { merge: true });
            tx.set(db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(ledgerEntry.entryId), ledgerEntry);
            tx.set(invRef, nextInvRecord, { merge: true });

            resultTelemetry = telemetry;
            resultLedger = ledgerEntry;
            resultBalance = nextBalance;
        });

        if (anomalyAlertCode) {
            await this.recordPolicyAudit({
                tenantId,
                siteId: input.siteId,
                actorUid: actor.actorUid,
                eventType:
                    anomalyAlertCode === 'DGMN_MAGAZINE_VARIANCE_ALERT'
                        ? 'DGMN_EXPLOSIVES_BLOCK'
                        : 'ATYPICAL_FLAG',
                policyCode: anomalyAlertCode,
                severity: anomalyAlertCode === 'DGMN_MAGAZINE_VARIANCE_ALERT' ? 'CRITICAL' : 'HIGH',
                entityId: resultTelemetry.telemetryId,
                details: {
                    warehouseId: input.warehouseId,
                    warehouseClass: resultTelemetry.warehouseClass,
                    canonicalSkuId: input.canonicalSkuId,
                    bookBalanceSi: resultTelemetry.bookBalanceSi,
                    measuredLevelSi: resultTelemetry.measuredLevelSi,
                    varianceSi: resultTelemetry.varianceSi,
                    variancePct: resultTelemetry.variancePct,
                },
            });
        }

        await this.recordAudit(
            tenantId,
            actor,
            anomalyAlertCode ? 'SUPPLY_TANK_CYCLE_COUNT_ALERT' : 'SUPPLY_TANK_CYCLE_COUNT_RECORDED',
            resultTelemetry.telemetryId,
            {
                hitlConfirmed: true,
                warehouseId: input.warehouseId,
                warehouseClass: resultTelemetry.warehouseClass,
                canonicalSkuId: input.canonicalSkuId,
                bookBalanceSi: resultTelemetry.bookBalanceSi,
                measuredLevelSi: resultTelemetry.measuredLevelSi,
                variancePct: resultTelemetry.variancePct,
                anomalyFlag: resultTelemetry.anomalyFlag,
                anomalyAlertCode,
            }
        );

        return {
            telemetry: resultTelemetry,
            ledgerEntry: resultLedger,
            balance: resultBalance,
            anomalyAlertCode,
        };
    }

    // -----------------------------------------------------------------------
    // Inventory (`supply_inventory_items`) & Stock Ledger (`supply_stock_ledger`)
    // -----------------------------------------------------------------------

    public static async applyInventoryDelta(params: {
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
        let resultRecord!: SupplyInventoryItem;

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const existing = snap.exists ? (snap.data() as SupplyInventoryItem) : null;
            const computed = this.computeNextInventoryState(existing, {
                ...params,
                now,
            });
            tx.set(ref, computed.record, { merge: true });
            tx.set(
                db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(computed.ledgerEntry.entryId),
                computed.ledgerEntry
            );
            resultRecord = computed.record;
        });

        return resultRecord;
    }

    public static async listInventory(
        tenantId: string,
        siteId?: string,
        limit?: number
    ): Promise<SupplyInventoryItem[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.INVENTORY_ITEMS)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SupplyInventoryItem);
        if (siteId) list = list.filter((i) => i.siteId === siteId);
        return list.sort((a, b) => a.itemName.localeCompare(b.itemName, 'es'));
    }

    // -----------------------------------------------------------------------
    // Assets (`supply_assets`) + OPERMAQ Link
    // -----------------------------------------------------------------------

    public static async listAssets(
        tenantId: string,
        siteId?: string,
        limit?: number
    ): Promise<SupplyAsset[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.ASSETS)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
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

        const timestampIso = new Date().toISOString();
        const updated: SupplyAsset = {
            ...existing,
            opermaqAssetId: opermaqAssetId.trim(),
            updatedAt: timestampIso,
        };
        await ref.set(updated, { merge: true });

        // Emitir evento trazable inter-módulo en `event_ledger` (supply -> opermaq) con payloadHash SHA-256
        const ledgerEventPayload = {
            eventType: 'SUPPLY_ASSET_LINKED_TO_OPERMAQ' as const,
            sourceModule: 'supply' as const,
            targetModule: 'opermaq' as const,
            tenantId,
            siteId: updated.siteId,
            assetId,
            opermaqAssetId: updated.opermaqAssetId!,
            actorUid: actor.actorUid,
            timestampIso,
        };
        const payloadHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(ledgerEventPayload))
            .digest('hex');
        const eventId = `evt_sup_opm_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        await db.collection(SUPPLY_COLLECTIONS.EVENT_LEDGER).doc(eventId).set({
            eventId,
            ...ledgerEventPayload,
            payloadHash,
        });

        await this.recordAudit(tenantId, actor, 'SUPPLY_ASSET_LINKED_OPERMAQ', assetId, {
            hitlConfirmed: true,
            opermaqAssetId: updated.opermaqAssetId,
            eventLedgerId: eventId,
            payloadHash,
        });
        return updated;
    }

    // -----------------------------------------------------------------------
    // Cash Ledger (`supply_cash_ledger`), SII Docs & Expense Reports
    // -----------------------------------------------------------------------

    public static async listCashLedger(
        tenantId: string,
        siteId?: string,
        limit?: number
    ): Promise<CashLedgerEntry[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.CASH_LEDGER)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
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
        filters?: { siteId?: string; documentType?: number; missingInvoiceOnly?: boolean; limit?: number }
    ): Promise<SiiDocumentRecord[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit))
            .get();
        let list = snap.docs.map((d) => {
            const raw = d.data() as SiiDocumentRecord;
            const refreshedDeadline = computeRcvAcceptanceDeadline(raw.issueDate, raw.documentType);
            return {
                ...raw,
                rcvDeadlineDate: refreshedDeadline.applicable ? refreshedDeadline.deadlineIso ?? null : null,
                rcvDaysRemaining: refreshedDeadline.applicable ? refreshedDeadline.daysRemaining ?? null : null,
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

    public static async listExpenseReports(
        tenantId: string,
        siteId?: string,
        limit?: number
    ): Promise<SiiExpenseReport[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(limit))
            .get();
        let list = snap.docs.map((d) => d.data() as SiiExpenseReport);
        if (siteId) list = list.filter((r) => r.siteId === siteId);
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async getExpenseReport(
        tenantId: string,
        reportId: string
    ): Promise<SiiExpenseReport | null> {
        const snap = await db.collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).doc(reportId).get();
        if (!snap.exists) return null;
        const data = snap.data() as SiiExpenseReport;
        if (data.tenantId !== tenantId) return null;
        return data;
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
        const uniqueDocIds = Array.from(
            new Set(input.siiDocumentIds.map((id) => String(id || '').trim()).filter(Boolean))
        );

        const reportRef = db.collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS).doc(reportId);
        let createdReport!: SiiExpenseReport;

        await db.runTransaction(async (tx) => {
            // FASE 1: LEER TODOS LOS DOCUMENTOS SII EN LA TRANSACCIÓN
            const selectedDocs: Array<{ ref: FirebaseFirestore.DocumentReference; data: SiiDocumentRecord }> = [];
            for (const docId of uniqueDocIds) {
                const docRef = db.collection(SUPPLY_COLLECTIONS.SII_DOCUMENTS).doc(docId);
                const snap = await tx.get(docRef);
                if (!snap.exists) {
                    throw new SupplyNotFoundError(`Documento SII ${docId} no encontrado.`);
                }
                const docData = snap.data() as SiiDocumentRecord;
                if (docData.tenantId !== input.tenantId) {
                    throw new SupplyForbiddenError(
                        'TENANT_ACCESS_DENIED: Documento SII no pertenece a la cuenta activa.'
                    );
                }
                if (docData.expenseReportId) {
                    throw new SupplyConflictError(
                        'SII_DOC_ALREADY_REPORTED',
                        `El documento SII ${docId} ya fue incluido en la rendición ${docData.expenseReportId}.`
                    );
                }
                selectedDocs.push({ ref: docRef, data: docData });
            }

            // FASE 2: CÁLCULO
            const renderedTotalClp = selectedDocs.reduce(
                (acc, item) => acc + Number(item.data.totalAmountClp || 0),
                0
            );
            const balanceClp = Math.round(input.fundAdvanceClp - renderedTotalClp);

            const report: SiiExpenseReport & { retentionUntil: string } = {
                reportId,
                tenantId: input.tenantId,
                siteId: input.siteId,
                custodianUid: input.custodianUid,
                custodianName: input.custodianName,
                paymentMethod: input.paymentMethod,
                title: input.title,
                periodLabel: input.periodLabel,
                costCenter: normalizeLegacyCostCenter(input.costCenter || 'CC-CAMP-ALIMENTACION'),
                fundAdvanceClp: Math.round(input.fundAdvanceClp),
                renderedTotalClp: Math.round(renderedTotalClp),
                balanceClp,
                siiDocumentIds: selectedDocs.map((item) => item.data.docId),
                status: 'SUBMITTED',
                retentionUntil: computeSixYearRetentionIso(now),
                createdAt: now,
                updatedAt: now,
            };

            // FASE 3: ESCRITURAS ATÓMICAS EN LA MISMA TRANSACCIÓN
            tx.set(reportRef, report);
            for (const item of selectedDocs) {
                tx.set(item.ref, { expenseReportId: reportId, updatedAt: now }, { merge: true });
            }
            createdReport = report;
        });

        await this.recordAudit(input.tenantId, actor, 'SUPPLY_EXPENSE_REPORT_CREATED', reportId, {
            hitlConfirmed: true,
            fundAdvanceClp: createdReport.fundAdvanceClp,
            renderedTotalClp: createdReport.renderedTotalClp,
            balanceClp: createdReport.balanceClp,
            siiDocumentCount: createdReport.siiDocumentIds.length,
        });
        return createdReport;
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
    // Demand Forecast (`supply_demand_forecasts` — DS 594 Art. 14 + EWMA sobre stock real)
    // -----------------------------------------------------------------------

    /**
     * Cálculo puro de pronóstico (100% solo lectura, 0 escrituras en Firestore).
     * Delega el guardrail sanitario DS 594 + DS 28 y el cálculo EWMA/DOI al motor
     * `DemandAndCostForecaster`, calculando `availableWaterL` estrictamente desde el
     * stock real de agua potable registrado (`supply_inventory_items`), nunca asumiendo
     * tanque lleno `waterStorageCapacityL`.
     */
    public static async computeForecastReadOnly(
        tenantId: string,
        siteId?: string
    ): Promise<DemandForecastWithRealWater[]> {
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

        const forecasts: DemandForecastWithRealWater[] = [];
        const now = new Date().toISOString();

        for (const site of effectiveSites) {
            const [inventory, cashEntries, warehouses, warehouseBalances] = await Promise.all([
                this.listInventory(tenantId, site.siteId),
                this.listCashLedger(tenantId, site.siteId),
                this.listWarehouses(tenantId, site.siteId),
                this.listWarehouseBalances(tenantId, { siteId: site.siteId }),
            ]);

            const headcount = Math.max(0, Number(site.currentHeadcount || 0));
            const leadTimeDays = Math.max(1, Number(site.leadTimeDays || 7));
            const altitudeM = Number(site.geoFix?.altitudeM || 0);
            const ds594Target = Math.max(100, Number(site.ds594DailyWaterTargetLPerPax || 120));
            const waterStorageCapacityL = Math.round(Number(site.waterStorageCapacityL || 0));

            const hasPotableTanks = warehouses.some((w) => w.warehouseClass === 'POTABLE_WATER_TANK');
            const waterItems = inventory.filter((inv) => isHumanPotableWaterCategory(inv.categoryCode));
            const waterInTransitL = waterItems.reduce(
                (acc, inv) => acc + Math.max(0, Number(inv.qtyInTransit || 0)),
                0
            );
            const waterWarehouseL = hasPotableTanks
                ? warehouseBalances
                      .filter((b) => b.warehouseClass === 'POTABLE_WATER_TANK' && b.unitSi === 'L')
                      .reduce((acc, b) => acc + Math.max(0, Number(b.qtyOnHand || 0)), 0)
                : waterItems.reduce(
                      (acc, inv) => acc + Math.max(0, Number(inv.qtyInWarehouse || 0)),
                      0
                  );

            const domainSite: DomainSupplySite = {
                siteId: site.siteId,
                tenantId: site.tenantId,
                name: site.name,
                districtCode: site.districtCode,
                altitudeMeters: altitudeM,
                shiftPattern: site.shiftPattern,
                currentHeadcount: headcount,
                waterStorageCapacityL,
                ds594DailyWaterTargetLPerPax: ds594Target,
                leadTimeDays,
                monthlyBudgetClp: site.monthlyBudgetClp,
                marketplaceOptIn: site.marketplaceOptIn,
            };

            const ds594Guard = hasPotableTanks
                ? evaluateDs594FromPotableTanks({
                      site: domainSite,
                      balances: warehouseBalances,
                      extraInTransitPotableL: waterInTransitL,
                  })
                : evaluateDs594WaterGuardrail({
                      site: domainSite,
                      currentWaterWarehouseL: waterWarehouseL,
                      currentWaterInTransitL: waterInTransitL,
                  });

            const altitudeMultiplier = ds594Guard.altitudeFactorApplied;
            const requiredWaterReserveL = Math.round(ds594Guard.requiredReserveL);
            const availableWaterL = Math.round(ds594Guard.currentAvailableL);
            const waterCoverageDays = Number(ds594Guard.coverageDays.toFixed(2));
            const ds594Compliant = ds594Guard.compliant;

            const waterAlertLevel: DemandForecast['waterAlertLevel'] =
                headcount > 0 && waterCoverageDays < leadTimeDays
                    ? waterCoverageDays < Math.max(2, leadTimeDays * 0.5)
                        ? 'CRITICAL'
                        : 'WARNING'
                    : 'NOMINAL';

            // OPEX diario alimentario por persona (excluyendo estrictamente CAPEX, aseo, mantención, combustible y gas)
            const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const foodOpex30d = cashEntries
                .filter((e) => {
                    if (e.isCapex) return false;
                    if (e.direction && e.direction !== 'EXPENSE_RENDERED' && e.direction !== 'REIMBURSEMENT_DUE') {
                        return false;
                    }
                    if (Date.parse(e.createdAt) < thirtyDaysAgoMs) return false;
                    if (e.categoryCode) {
                        return e.categoryCode === 'VIVERES_ALIMENTACION' || isHumanPotableWaterCategory(e.categoryCode);
                    }
                    const normalizedCc = normalizeLegacyCostCenter(e.costCenter);
                    return (
                        normalizedCc === 'CC-CAMP-ALIMENTACION' ||
                        normalizedCc === 'CC-CAMP-AGUA' ||
                        e.costCenter === 'CC-CAMPAMENTO'
                    );
                })
                .reduce((acc, e) => acc + e.netAmountClp, 0);

            const dailyFoodOpexClpPerPax =
                headcount > 0 && foodOpex30d > 0 ? Math.round(foodOpex30d / (30 * headcount)) : null;

            const items: DemandForecastLine[] = inventory.map((inv) => {
                const defaultPerPax =
                    isHumanPotableWaterCategory(inv.categoryCode)
                        ? ds594Target * altitudeMultiplier
                        : inv.categoryCode === 'VIVERES_ALIMENTACION'
                          ? 0.35
                          : 0.05;
                const domainForecast = forecastSkuDemand({
                    site: domainSite,
                    canonicalSkuId: inv.canonicalSkuId,
                    categoryCode: inv.categoryCode,
                    unitSi: inv.unitSi,
                    history: [],
                    currentWarehouseStockSi: inv.qtyInWarehouse,
                    currentInTransitStockSi: inv.qtyInTransit,
                    fallbackDailyPerPaxSi: inv.dailyBurnRatePerPax ?? defaultPerPax,
                    computedAt: now,
                });

                const ewmaDailyRate = Number(domainForecast.ewmaDailyTotalSi.toFixed(3));
                const doi =
                    ewmaDailyRate > 0 ? Number(domainForecast.daysOfInventoryEffective.toFixed(1)) : null;
                const recommendedReorderQty = Number(domainForecast.recommendedOrderQtySi.toFixed(2));

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
            forecasts.push({
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
                availableWaterL,
                waterStoredL: Math.round(waterWarehouseL),
                waterInTransitL: Math.round(waterInTransitL),
                ds594Compliant,
                waterDeficitL: Math.round(ds594Guard.deficitL),
                storageCapacitySufficient: ds594Guard.storageCapacitySufficient,
                waterCoverageDays,
                waterAlertLevel,
                dailyFoodOpexClpPerPax,
                items,
                computedAt: now,
            });
        }

        return forecasts;
    }

    /**
     * Calcula KPIs reales por unidad de negocio (Campamento, Flota & Taller, Mina/Planta, Finanzas SII)
     * y evalúa los 3 drivers dinámicos de Punto de Reorden (PER_PAX, PER_ASSET_HOUR, DAILY_SITE_OR_MINMAX).
     */
    public static async computeBusinessUnitKpis(
        tenantId: string,
        siteId?: string,
        options?: { periodDays?: number; mineTonnageProcessed?: number }
    ): Promise<SupplyBusinessUnitKpis> {
        const sites = siteId
            ? ([await this.getSite(tenantId, siteId)].filter(Boolean) as SupplySite[])
            : await this.listSites(tenantId);

        const targetSite: SupplySite =
            sites[0] || {
                siteId: siteId || 'default-site',
                tenantId,
                name: 'Faena Principal',
                districtCode: 'CL-ANTOFAGASTA',
                shiftPattern: '7x7',
                currentHeadcount: 0,
                waterStorageCapacityL: 0,
                ds594DailyWaterTargetLPerPax: 120,
                leadTimeDays: 7,
                marketplaceOptIn: false,
                roleMismatchMode: 'FLAG_AND_ACCEPT',
                directPurchaseAlertThresholdClp: 500000,
            };

        const effectiveSiteId = targetSite.siteId;
        const [
            balances,
            stockMovements,
            cashEntries,
            siiDocuments,
            purchases,
            discrepancies,
            tankTelemetry,
            inventory,
        ] = await Promise.all([
            this.listWarehouseBalances(tenantId, { siteId: effectiveSiteId }),
            this.listStockLedger(tenantId, { siteId: effectiveSiteId, limit: 500 }),
            this.listCashLedger(tenantId, effectiveSiteId, 500),
            this.listSiiDocuments(tenantId, { siteId: effectiveSiteId, limit: 500 }),
            this.listPurchases(tenantId, effectiveSiteId, 500),
            this.listReceptionDiscrepancies(tenantId, { siteId: effectiveSiteId, status: 'OPEN', limit: 200 }),
            this.listTankTelemetry(tenantId, { siteId: effectiveSiteId, limit: 200 }),
            this.listInventory(tenantId, effectiveSiteId, 500),
        ]);

        const domainSite: DomainSupplySite = {
            siteId: targetSite.siteId,
            tenantId: targetSite.tenantId,
            name: targetSite.name,
            districtCode: targetSite.districtCode,
            altitudeMeters: Number(targetSite.geoFix?.altitudeM || 0),
            shiftPattern: targetSite.shiftPattern,
            currentHeadcount: Math.max(0, Number(targetSite.currentHeadcount || 0)),
            waterStorageCapacityL: Math.max(0, Number(targetSite.waterStorageCapacityL || 0)),
            ds594DailyWaterTargetLPerPax: Math.max(100, Number(targetSite.ds594DailyWaterTargetLPerPax || 120)),
            leadTimeDays: Math.max(1, Number(targetSite.leadTimeDays || 7)),
            monthlyBudgetClp: targetSite.monthlyBudgetClp,
            marketplaceOptIn: targetSite.marketplaceOptIn,
        };

        // Consolidar stock por SKU para evaluación ROP dinámica
        const stockBySku = new Map<
            string,
            {
                canonicalSkuId: string;
                categoryCode: SupplyInventoryItem['categoryCode'];
                unitSi: SupplyInventoryItem['unitSi'];
                onHand: number;
                inTransit: number;
            }
        >();
        for (const bal of balances) {
            const prev = stockBySku.get(bal.canonicalSkuId);
            if (prev) {
                prev.onHand += Number(bal.qtyOnHand || 0);
                prev.inTransit += Number(bal.qtyInTransit || 0);
            } else {
                stockBySku.set(bal.canonicalSkuId, {
                    canonicalSkuId: bal.canonicalSkuId,
                    categoryCode: bal.categoryCode,
                    unitSi: bal.unitSi,
                    onHand: Number(bal.qtyOnHand || 0),
                    inTransit: Number(bal.qtyInTransit || 0),
                });
            }
        }
        for (const inv of inventory) {
            if (!stockBySku.has(inv.canonicalSkuId)) {
                stockBySku.set(inv.canonicalSkuId, {
                    canonicalSkuId: inv.canonicalSkuId,
                    categoryCode: inv.categoryCode,
                    unitSi: inv.unitSi,
                    onHand: Number(inv.qtyInWarehouse || 0),
                    inTransit: Number(inv.qtyInTransit || 0),
                });
            }
        }

        const ropEvaluations = Array.from(stockBySku.values()).map((sku) =>
            calculateDynamicReorderPoint({
                canonicalSkuId: sku.canonicalSkuId,
                categoryCode: sku.categoryCode,
                unitSi: sku.unitSi,
                site: domainSite,
                currentWarehouseStockSi: sku.onHand,
                currentInTransitStockSi: sku.inTransit,
                ewmaDailyPerPaxSi: isHumanPotableWaterCategory(sku.categoryCode) ? domainSite.ds594DailyWaterTargetLPerPax : 0.4,
                ewmaDailySiteSi: 1,
                consumptionPerAssetHourSi: 2,
            })
        );

        return computeSupplyBusinessUnitKpis({
            tenantId,
            site: domainSite,
            periodDays: options?.periodDays,
            mineTonnageProcessed: options?.mineTonnageProcessed,
            balances,
            stockMovements: stockMovements.map((m) => ({
                movementType: m.movementType,
                categoryCode:
                    stockBySku.get(m.canonicalSkuId)?.categoryCode ||
                    findDomainCanonicalSkuById(m.canonicalSkuId)?.categoryCode,
                canonicalSkuId: m.canonicalSkuId,
                unitSi: m.unitSi,
                qtyDelta: m.qtyDelta,
                unitCostClp: m.unitCostClp,
                linkedAssetId: m.linkedAssetId,
                horometer: m.horometer,
                createdAt: m.createdAt,
            })),
            cashEntries,
            siiDocuments,
            purchases,
            openDiscrepanciesCount: discrepancies.length,
            tankTelemetry,
            ropEvaluations,
        });
    }

    /**
     * Recalcula y persiste bajo demanda (`POST /forecast/recalculate`).
     */
    public static async computeAndStoreForecast(
        tenantId: string,
        siteId?: string
    ): Promise<DemandForecastWithRealWater[]> {
        const forecasts = await this.computeForecastReadOnly(tenantId, siteId);
        for (const forecast of forecasts) {
            await db.collection(SUPPLY_COLLECTIONS.DEMAND_FORECASTS).doc(forecast.forecastId).set(forecast);
        }
        return forecasts;
    }

    // -----------------------------------------------------------------------
    // Marketplace Anonymous Demand Signals (`market_demand_signals` — k >= 5 B2B)
    // -----------------------------------------------------------------------

    /**
     * Proyecta señales anónimas de demanda agregada por distrito minero (Ley N° 21.719):
     * - Exige opt-in explícito del sitio (`marketplaceOptIn === true`).
     * - Excluye estrictamente cuentas sandbox (`5º EDU` / `isEduSandbox`, `3º TEST-PILOT` / `pilot-*`, `1º DEV` / `dev-master-sandbox`).
     * - Impone anonimato `k >= 5` estricto vía `DemandAndCostForecaster.projectAnonymousDemandSignals`:
     *   mínimo 5 TENANTS B2B distintos Y 5 SITIOS distintos por distrito+SKU.
     * - CERO `tenantId`, CERO `siteId`, CERO coordenadas GPS exactas.
     */
    public static async refreshAnonymousDemandSignals(): Promise<DemandPoolSignal[]> {
        const sitesSnap = await db
            .collection(SUPPLY_COLLECTIONS.SITES)
            .where('marketplaceOptIn', '==', true)
            .limit(MAX_LIST_LIMIT)
            .get();

        // Verificar en `accounts` que ningún tenant EDU / TEST-PILOT / DEV entre al pool B2B
        const accountMetaCache = new Map<string, { isEduSandbox: boolean; accountType?: string }>();
        const resolveAccountMeta = async (
            tenantId: string
        ): Promise<{ isEduSandbox: boolean; accountType?: string }> => {
            const cached = accountMetaCache.get(tenantId);
            if (cached) return cached;
            let isEduSandbox = false;
            let accountType: string | undefined;
            try {
                const accSnap = await db.collection('accounts').doc(tenantId).get();
                if (accSnap.exists) {
                    const data = accSnap.data() || {};
                    const rawType = String(data.type || '').trim().toUpperCase();
                    const rawClass = String(data.classification || '').trim().toLowerCase();
                    isEduSandbox =
                        data.isEduSandbox === true ||
                        rawType === 'EDUCATIONAL' ||
                        rawClass === 'edu';
                    accountType = rawType || undefined;
                }
            } catch {
                // Fallback a verificación por prefijo en `isSandboxTenantId`
            }
            const meta = { isEduSandbox, accountType };
            accountMetaCache.set(tenantId, meta);
            return meta;
        };

        const optedSitesByKey = new Map<
            string,
            {
                districtCode: string;
                tenantKey: string;
                siteId: string;
                isEduSandbox: boolean;
                accountType?: string;
            }
        >();

        for (const doc of sitesSnap.docs) {
            const s = doc.data() as SupplySite;
            if (!s.marketplaceOptIn || !s.districtCode || !s.tenantId || !s.siteId) continue;
            const tenantKey = s.tenantId.trim();
            const accMeta = await resolveAccountMeta(tenantKey);
            if (isSandboxTenantId(tenantKey, accMeta.isEduSandbox, accMeta.accountType)) {
                continue;
            }
            optedSitesByKey.set(`${tenantKey}::${s.siteId}`, {
                districtCode: s.districtCode.trim().toUpperCase(),
                tenantKey,
                siteId: s.siteId,
                isEduSandbox: accMeta.isEduSandbox,
                accountType: accMeta.accountType,
            });
        }

        const reqsSnap = await db
            .collection(SUPPLY_COLLECTIONS.REQUISITIONS)
            .limit(MAX_LIST_LIMIT)
            .get();
        const observations: TenantDemandObservation[] = [];

        for (const doc of reqsSnap.docs) {
            const req = doc.data() as SupplyRequisition;
            if (req.status !== 'OPEN' && req.status !== 'PARTIAL') continue;
            const siteMeta = optedSitesByKey.get(`${req.tenantId}::${req.siteId}`);
            if (!siteMeta) continue;

            for (const line of req.lines) {
                if (line.lineStatus === 'FULFILLED' || line.lineStatus === 'CANCELLED') continue;
                if (line.qtyPending <= 0) continue;

                observations.push({
                    tenantId: siteMeta.tenantKey,
                    siteId: siteMeta.siteId,
                    districtCode: siteMeta.districtCode,
                    optInMarketplace: true,
                    isEduSandbox: siteMeta.isEduSandbox,
                    accountType: siteMeta.accountType,
                    canonicalSkuId: line.canonicalSkuId,
                    skuName: line.itemName,
                    categoryCode: line.categoryCode,
                    procurementBucket: line.procurementBucket,
                    unitSi: line.unitSi,
                    projectedDemandSi: line.qtyPending,
                    unitPriceClp: line.estimatedUnitClp,
                });
            }
        }

        const now = new Date();
        const windowStartIso = now.toISOString();
        const windowEndIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const periodWindow = `${windowStartIso.slice(0, 10)}/${windowEndIso.slice(0, 10)}`;

        const projected = projectAnonymousDemandSignals(observations, {
            windowStartIso,
            windowEndIso,
            periodWindow,
            expiresAt: windowEndIso,
            minK: LEY21719_MIN_K_ANONYMITY,
            generatedAt: windowStartIso,
        });

        const emitted: DemandPoolSignal[] = [];
        for (const sig of projected.signals) {
            const signalId = `sig_${safeDocIdPart(sig.districtCode)}_${safeDocIdPart(sig.canonicalSkuId)}`;
            const strictSignal: DemandPoolSignal = {
                signalId,
                districtCode: sig.districtCode,
                periodWindow: sig.periodWindow,
                canonicalSkuId: sig.canonicalSkuId,
                skuName: sig.skuName,
                categoryCode: sig.categoryCode,
                procurementBucket: sig.procurementBucket,
                unitSi: sig.unitSi,
                aggregatedQty: sig.aggregatedQty,
                participatingEntitiesCount: sig.participatingEntitiesCount,
                optInVerified: true,
                ...(typeof sig.medianReferenceUnitClp === 'number'
                    ? { medianReferenceUnitClp: sig.medianReferenceUnitClp }
                    : {}),
                generatedAt: sig.generatedAt,
                expiresAt: sig.expiresAt,
            };
            await db.collection(SUPPLY_COLLECTIONS.MARKET_DEMAND_SIGNALS).doc(signalId).set(strictSignal);
            emitted.push(strictSignal);
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
            // Defensa en profundidad: jamás exponer registros con k < 5 o sin opt-in
            .filter((s) => {
                const entities = Number(s.participatingEntitiesCount ?? 0);
                return entities >= LEY21719_MIN_K_ANONYMITY && s.optInVerified === true;
            })
            // Strip estricto 1:1 con #9 DemandPoolSignalSchema.strict() (cero tenantId/GPS)
            .map((s): DemandPoolSignal => {
                const skuName = String(s.skuName || s.itemName || 'Insumo');
                const entities = Number(s.participatingEntitiesCount ?? LEY21719_MIN_K_ANONYMITY);
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

    // -----------------------------------------------------------------------
    // Ephemeral WhatsApp State TTL (24h sessions / 7d wamids — Ley N° 21.719)
    // -----------------------------------------------------------------------

    public static computeWhatsAppSessionTtl(fromMs?: number) {
        return computeShortTtlTimestamp(WHATSAPP_SESSION_TTL_MS, fromMs);
    }

    public static computeWhatsAppWamidTtl(fromMs?: number) {
        return computeShortTtlTimestamp(WHATSAPP_WAMID_TTL_MS, fromMs);
    }

    public static async saveWhatsAppSession(
        sessionId: string,
        sessionData: Record<string, unknown>
    ): Promise<void> {
        const ttlExpiresAt = this.computeWhatsAppSessionTtl();
        await db
            .collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS)
            .doc(sessionId)
            .set(
                {
                    ...sessionData,
                    ttlExpiresAt,
                    updatedAt: new Date().toISOString(),
                },
                { merge: true }
            );
    }

    public static async resolveActiveMemberPhoneE164(
        tenantId: string,
        uid: string
    ): Promise<string | null> {
        const cleanTenant = String(tenantId || '').trim();
        const cleanUid = String(uid || '').trim();
        if (!cleanTenant || !cleanUid) return null;
        const snap = await db
            .collection('accounts')
            .doc(cleanTenant)
            .collection('members')
            .doc(cleanUid)
            .get();
        if (!snap.exists) return null;
        const data = snap.data() as Record<string, unknown> | undefined;
        if (!data) return null;
        const status = String(data.status || '').toUpperCase();
        if (status && status !== 'ACTIVE') return null;
        const phone = typeof data.phoneE164 === 'string' ? data.phoneE164.trim() : '';
        if (!phone || phone.includes('*') || !/^\+[1-9]\d{6,14}$/.test(phone)) {
            return null;
        }
        return phone;
    }

    public static async recordWhatsAppWamid(
        wamidDocId: string,
        payload: { wamid: string; tenantId: string; processedAt?: string }
    ): Promise<void> {
        const ttlExpiresAt = this.computeWhatsAppWamidTtl();
        await db
            .collection(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS)
            .doc(wamidDocId)
            .set({
                wamid: payload.wamid,
                tenantId: payload.tenantId,
                processedAt: payload.processedAt || new Date().toISOString(),
                ttlExpiresAt,
            });
    }

    // -----------------------------------------------------------------------
    // V3-E05: Propuesta Semántica 3 Niveles & Commit Atómico 4-Way
    // -----------------------------------------------------------------------

    public static async proposeReconciliation(
        tenantId: string,
        rawInput: unknown,
        _actor: AuditActorContext,
        options?: {
            embedFn?: EmbedTextFn;
            decideFn?: DecideFn;
            allowNetworkAi?: boolean;
        }
    ): Promise<ReconciliationProposal> {
        const parsed = ReconciliationProposeRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_RECONCILIATION_PROPOSE_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para propuesta de conciliación.'
            );
        }
        const input = parsed.data;
        const now = new Date().toISOString();

        let dteType = input.documentType;
        let folio = input.folio || '0';
        let issueDate = input.issueDate || now.slice(0, 10);
        let supplierTaxIdRaw = input.supplierTaxId;
        let globalAdjustmentNetClp = Number(input.globalDiscountOrChargeClp || 0);
        let iepOrIecClp = 0;
        let linePricingBasis: 'NET' | 'GROSS' =
            dteType === 33 || dteType === 52 || dteType === 61 ? 'NET' : 'GROSS';
        let dteReferences: ReconciliationProposal['dteReferences'] = [];
        let lines = [...input.lines];
        let totalAmountForDedupe = Number(input.totalAmountClp || 0);

        if (input.xmlContent && input.xmlContent.trim()) {
            const parsedXml = parseSiiXmlDte(input.xmlContent);
            dteType = parsedXml.dteType;
            folio = parsedXml.folio || folio;
            issueDate = parsedXml.issueDate || issueDate;
            supplierTaxIdRaw = parsedXml.emitterRutNormalized || supplierTaxIdRaw;
            globalAdjustmentNetClp =
                input.globalDiscountOrChargeClp !== undefined
                    ? Number(input.globalDiscountOrChargeClp)
                    : parsedXml.globalAdjustmentNetClp;
            iepOrIecClp = parsedXml.fuelTaxIepIecClp;
            linePricingBasis = parsedXml.linePricingBasis;
            dteReferences = parsedXml.references;
            totalAmountForDedupe = totalAmountForDedupe || parsedXml.totalAmountClp;

            if (lines.length === 0 && parsedXml.lines.length > 0) {
                lines = parsedXml.lines.map((l) => ({
                    purchaseLineId: `xml-line-${l.lineNumber}`,
                    lineNumber: l.lineNumber,
                    rawDescription: l.name,
                    supplierItemCode: l.supplierItemCode,
                    quantity: l.quantity,
                    unitPriceClp: l.unitPriceClp,
                    subtotalClp: l.subtotalClp,
                    linePricingBasis: parsedXml.linePricingBasis,
                }));
            }
        }

        const taxAdapter = getTaxJurisdictionAdapter('CL');
        const rutCheck = taxAdapter.validateTaxId(supplierTaxIdRaw);
        const supplierTaxIdNormalized =
            rutCheck.normalized || supplierTaxIdRaw.replace(/[\s.]/g, '').toUpperCase();

        if (!totalAmountForDedupe) {
            totalAmountForDedupe = lines.reduce((acc, l) => acc + Number(l.subtotalClp || 0), 0);
        }

        const [learnedMaps, reqSnap, recentPurchasesSnap, balancesSnap, signalsSnap] =
            await Promise.all([
                SemanticRequisitionMatcher.lookupTenantLearnedMaps(
                    tenantId,
                    supplierTaxIdNormalized
                ),
                db
                    .collection(SUPPLY_COLLECTIONS.REQUISITIONS)
                    .where('tenantId', '==', tenantId)
                    .where('siteId', '==', input.siteId)
                    .limit(150)
                    .get(),
                db
                    .collection(SUPPLY_COLLECTIONS.PURCHASES)
                    .where('tenantId', '==', tenantId)
                    .limit(100)
                    .get(),
                db
                    .collection(SUPPLY_COLLECTIONS.WAREHOUSE_BALANCES)
                    .where('tenantId', '==', tenantId)
                    .limit(200)
                    .get(),
                db.collection(SUPPLY_COLLECTIONS.MARKET_DEMAND_SIGNALS).limit(200).get(),
            ]);

        const recentPurchases = recentPurchasesSnap.docs.map((d) => d.data() as SupplyPurchase);
        const ruralDup = detectRuralReceiptDuplicate({
            supplierTaxIdNormalized,
            documentType: dteType,
            totalAmountClp: totalAmountForDedupe,
            issueDate,
            phashHex: input.phashHex,
            recentPurchases: recentPurchases.map((p) => ({
                purchaseId: p.purchaseId,
                supplierTaxIdNormalized: p.supplierTaxId,
                documentType: p.documentType,
                totalAmountClp: p.totalAmountClp,
                issueDate: p.issueDate,
                phashHex: p.evidenceCasRef?.phashHex || null,
            })),
        });

        const anomalies: SupplyAnomalyAlert[] = [];
        let ruralDuplicateAlert: SupplyAnomalyAlert | null = null;
        if (ruralDup.isDuplicate) {
            ruralDuplicateAlert = {
                alertId: `anom_rural_${Date.now().toString(36)}`,
                alertType: 'ANOMALY_RURAL_DUPLICATE_DHASH',
                severity: 'CRITICAL',
                messageSpanish: ruralDup.messageSpanish || 'Posible comprobante rural duplicado.',
                observedValue: ruralDup.hammingDistance ?? null,
                baselineValue: 6,
                evidenceRef: ruralDup.matchedPurchaseId || null,
                detectedAtIso: now,
            };
            anomalies.push(ruralDuplicateAlert);
        }

        const openRequisitions = reqSnap.docs
            .map((d) => d.data() as SupplyRequisition)
            .filter(
                (r) =>
                    (input.requisitionIds.length === 0 || input.requisitionIds.includes(r.reqId)) &&
                    (r.status === 'OPEN' || r.status === 'PARTIAL')
            )
            .map((r) => ({
                reqId: r.reqId,
                costCenter: r.costCenter,
                lines: r.lines.map((rl) => ({
                    lineId: rl.lineId,
                    canonicalSkuId: rl.canonicalSkuId,
                    qtyPending: rl.qtyPending,
                })),
            }));

        const cascade = await proposeSemanticReconciliation(lines, {
            tenantId,
            supplierRutNormalized: supplierTaxIdNormalized,
            documentType: dteType,
            prorationMode: input.prorationMode,
            globalAdjustmentNetClp,
            learnedMaps,
            openRequisitions,
            embedFn: options?.embedFn,
            decideFn: options?.decideFn,
            allowNetworkAi: options?.allowNetworkAi,
        });

        // Evaluar desviaciones de precio / shrinkflation sobre líneas con SKU resuelto
        const pmpBySku = new Map<string, number>();
        for (const doc of balancesSnap.docs) {
            const b = doc.data() as SupplyWarehouseBalance;
            if (b.pmpNetClp > 0 && !pmpBySku.has(b.canonicalSkuId)) {
                pmpBySku.set(b.canonicalSkuId, b.pmpNetClp);
            }
        }
        const marketBySku = new Map<string, { median: number; peers: number }>();
        for (const doc of signalsSnap.docs) {
            const sig = doc.data() as DemandPoolSignal;
            if (
                typeof sig.medianReferenceUnitClp === 'number' &&
                sig.medianReferenceUnitClp > 0 &&
                sig.participatingEntitiesCount >= LEY21719_MIN_K_ANONYMITY
            ) {
                marketBySku.set(sig.canonicalSkuId, {
                    median: sig.medianReferenceUnitClp,
                    peers: sig.participatingEntitiesCount,
                });
            }
        }

        for (let i = 0; i < cascade.proposedLines.length; i++) {
            const prop = cascade.proposedLines[i];
            const rawLine = lines[i];
            if (!prop.matchedCanonicalSkuId || prop.classification === 'ACCESSORY_CHARGE') continue;
            const sku = findDomainCanonicalSkuById(prop.matchedCanonicalSkuId);
            const baseline = pmpBySku.get(prop.matchedCanonicalSkuId);
            const mkt = marketBySku.get(prop.matchedCanonicalSkuId);
            const shrinkRes = detectPriceAndShrinkflationAnomalies({
                canonicalSkuId: prop.matchedCanonicalSkuId,
                itemName: prop.matchedSkuName || prop.rawDescription,
                unitSi: sku?.baseUnitSi || 'un',
                quantity: Number(rawLine?.quantity || 1),
                netTotalClp: prop.landedUnitCostNetClp * Number(rawLine?.quantity || 1),
                observedUnitSizeSi: rawLine?.observedUnitSizeSi,
                tenantMedian90dNetPerSiClp: baseline,
                marketMedianNetPerSiClp: mkt?.median,
                marketPeerCount: mkt?.peers,
                detectedAtIso: now,
            });
            for (const f of shrinkRes.findings) {
                anomalies.push({
                    alertId: f.alertId,
                    alertType: f.alertType,
                    severity: f.severity,
                    canonicalSkuId: f.canonicalSkuId,
                    messageSpanish: f.messageSpanish,
                    observedValue: f.observedValue,
                    baselineValue: f.baselineValue,
                    variancePct: f.variancePct,
                    detectedAtIso: f.detectedAtIso,
                });
            }
        }

        return ReconciliationProposalSchema.parse({
            proposalId: `rprop_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
            tenantId,
            siteId: input.siteId,
            supplierTaxIdNormalized,
            documentType: dteType,
            folio,
            issueDate,
            dteReferences,
            siiTaxes: {
                iepOrIecClp,
                globalAdjustmentNetClp,
                linePricingBasis,
            },
            ruralDuplicateAlert,
            proposedLines: cascade.proposedLines,
            anomalies,
            createdAtIso: now,
        });
    }

    public static async commit4WayReconciliation(
        tenantId: string,
        rawInput: unknown,
        actor: AuditActorContext,
        buyerRole: SupplyOperationalRole = 'BUYER',
        options?: {
            embedFn?: EmbedTextFn;
            allowNetworkAi?: boolean;
        }
    ) {
        const parsed = ReconciliationCommit4WayRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_RECONCILIATION_COMMIT_PAYLOAD',
                parsed.error.issues[0]?.message || 'Confirmación HITL "ACTUALIZAR" o payload inválido.'
            );
        }
        const input = parsed.data;
        const acceptedLines = input.lines.filter((l) => l.accepted);
        if (acceptedLines.length === 0) {
            throw new SupplyValidationError(
                'NO_ACCEPTED_RECONCILIATION_LINES',
                'Debe aceptar al menos una línea para confirmar la conciliación 4-Way.'
            );
        }

        const proration = prorateLandedCosts({
            lines: acceptedLines.map((l) => {
                const rawNet =
                    l.linePricingBasis === 'NET'
                        ? Math.round(l.subtotalClp)
                        : input.documentType === 33 ||
                            input.documentType === 52 ||
                            input.documentType === 61
                          ? Math.round(l.subtotalClp / 1.19)
                          : Math.round(l.subtotalClp);
                return {
                    purchaseLineId: l.purchaseLineId,
                    qtyPurchased: l.qtyPurchased,
                    netAmountClp: rawNet,
                    isAccessoryCharge: l.classification === 'ACCESSORY_CHARGE',
                    weightKg: l.weightKg,
                    volumeL: l.volumeL,
                };
            }),
            prorationMode: input.prorationMode,
            globalAdjustmentNetClp: input.globalDiscountOrChargeClp,
        });

        const goodsLines = acceptedLines.filter((l) => l.classification !== 'ACCESSORY_CHARGE');
        const effectivePurchaseLines = goodsLines.length > 0 ? goodsLines : acceptedLines;

        const mappedPurchaseLines: SupplyPurchaseLine[] = effectivePurchaseLines.map((l) => {
            const sku = findDomainCanonicalSkuById(l.canonicalSkuId);
            const landed = proration.byLineId[l.purchaseLineId];
            const landedNetTotal = landed ? landed.landedTotalNetClp : Math.round(l.subtotalClp);
            const landedUnitNet =
                l.qtyPurchased > 0 ? Math.round(landedNetTotal / l.qtyPurchased) : 0;
            const categoryCode = normalizeLegacySupplyCategoryCode(
                l.categoryCode || sku?.categoryCode || 'FERRETERIA_CONSTRUCCION'
            );
            const procurementBucket = normalizeLegacyProcurementBucket(
                sku?.procurementBucket || 'FERRETERIA_INSUMOS'
            );
            const isCapex = Boolean(
                l.isCapexAsset || l.destination === 'CAPEX_ASSET' || sku?.isCapexAsset
            );
            return {
                purchaseLineId: l.purchaseLineId,
                canonicalSkuId: l.canonicalSkuId,
                description: sku?.name || l.rawDescription,
                categoryCode,
                procurementBucket,
                unitSi: l.unitSi || sku?.baseUnitSi || 'un',
                qtyPurchased: l.qtyPurchased,
                unitPriceClp: landedUnitNet,
                subtotalClp: landedNetTotal,
                linePricingBasis: 'NET',
                destination: isCapex ? 'CAPEX_ASSET' : l.destination,
                isCapexAsset: isCapex,
                costCenter: normalizeLegacyCostCenter(
                    isCapex ? 'CC-CAPEX' : l.costCenter,
                    categoryCode
                ),
                opermaqAssetId: l.opermaqAssetId,
            };
        });

        const netAmountClp = mappedPurchaseLines.reduce((s, l) => s + Math.round(l.subtotalClp), 0);
        const hasRecoverableVat = input.documentType === 33 || input.documentType === 61;
        const vatAmountClp = hasRecoverableVat ? Math.round(netAmountClp * 0.19) : 0;
        const totalAmountClp = Math.round(
            netAmountClp + vatAmountClp + Number(input.iepOrIecFuelTaxClp || 0)
        );
        const parsedFolio = input.documentType === 0 ? 0 : Math.max(1, Number(input.folio) || 0);

        const taxAdapter = getTaxJurisdictionAdapter('CL');
        const rutNorm =
            taxAdapter.validateTaxId(input.supplierTaxId).normalized ||
            input.supplierTaxId.replace(/[\s.]/g, '').toUpperCase();

        const purchaseResult = await this.createPurchaseWithReconciliation(
            {
                tenantId,
                siteId: input.siteId,
                buyerUid: actor.actorUid,
                buyerRole,
                purchaseMode: input.purchaseMode,
                authorizedByAuthority: true,
                supplierTaxId: input.supplierTaxId,
                supplierName: input.supplierName,
                documentType: input.documentType,
                folio: parsedFolio,
                issueDate: input.issueDate,
                netAmountClp,
                vatAmountClp,
                totalAmountClp,
                paymentMethod: input.paymentMethod,
                evidenceCasRef: input.phashHex
                    ? {
                          sha256: crypto
                              .createHash('sha256')
                              .update(`${tenantId}|${rutNorm}|${input.folio}|${input.phashHex}`)
                              .digest('hex'),
                          phashHex: input.phashHex,
                          downloadUrl: `cas://supply/${tenantId}/${input.phashHex}`,
                          mimeType: 'image/webp',
                          extension: 'webp',
                          originalBytes: 1024,
                          optimizedBytes: 512,
                          savingsPct: 50,
                      }
                    : undefined,
                lines: mappedPurchaseLines,
            },
            actor
        );

        // Persistir aprendizaje proveedor -> SKU en `tenant_supplier_sku_map` tras confirmación HITL "ACTUALIZAR"
        const learnedMappings = [];
        for (const l of effectivePurchaseLines) {
            if (!l.learnSupplierMapping) continue;
            const saved = await SemanticRequisitionMatcher.saveLearnedSupplierMapping({
                tenantId,
                supplierRutNormalized: rutNorm,
                supplierItemCode: l.supplierItemCode || null,
                rawDescription: l.rawDescription,
                supplierGtin: l.gtin || null,
                canonicalSkuId: l.canonicalSkuId,
                classification: l.classification,
                confirmedByUid: actor.actorUid,
                embedFn: options?.embedFn,
                allowNetworkAi: options?.allowNetworkAi,
            });
            learnedMappings.push(saved);
        }

        return {
            ...purchaseResult,
            landedCostProration: proration,
            learnedMappingsCount: learnedMappings.length,
            learnedMappings,
        };
    }
}
