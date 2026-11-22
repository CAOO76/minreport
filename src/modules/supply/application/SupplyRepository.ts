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
    evaluateDs594WaterGuardrail,
    forecastSkuDemand,
    isSandboxTenantId,
    projectAnonymousDemandSignals,
} from '../domain/DemandAndCostForecaster';
import { matchPurchaseToRequisitions } from '../domain/RequisitionFulfillmentMatcher';
import {
    buildSiiDedupeKey as buildDomainSiiDedupeKey,
    computeChileanVatBreakdown,
    computeRcvAcceptanceDeadline,
    isValidPositiveFolio,
    validateSiiDocumentForPurchase,
} from '../domain/SiiTaxValidator';
import { consolidateRequisitionsToShoppingList } from '../domain/SmartShoppingListConsolidator';
import {
    confirmWarehouseReception,
    reconcilePurchase,
} from '../domain/StockAssetCashCostReconciler';
import {
    type SplitInvoiceSmurfingResult,
    detectSplitInvoiceSmurfing,
} from '../domain/SupplyPolicyAndAnomalyEngine';
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

    public static async listPurchases(tenantId: string, siteId?: string): Promise<SupplyPurchase[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.PURCHASES)
            .where('tenantId', '==', tenantId)
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
            const domainOpenReqs = Array.from(reqById.values()).map(mapAppReqToDomain);
            const domainLinesForMatcher = params.lines
                .filter((l) => (remainingQtyByLineId.get(l.purchaseLineId) || 0) > 0)
                .map((l) => {
                    const remQty = remainingQtyByLineId.get(l.purchaseLineId) || 0;
                    const ratio = l.qtyPurchased > 0 ? remQty / l.qtyPurchased : 1;
                    const lineGross = Math.round(l.subtotalClp * ratio);
                    const lineVat = computeChileanVatBreakdown({
                        dteType: params.documentType,
                        totalAmountClp: lineGross,
                    });
                    return {
                        purchaseLineId: l.purchaseLineId,
                        canonicalSkuId: l.canonicalSkuId,
                        description: l.description,
                        categoryCode: l.categoryCode,
                        unitSi: l.unitSi,
                        qtyPurchased: remQty,
                        unitPriceNetClp: remQty > 0 ? Math.round(Math.abs(lineVat.netAmountClp) / remQty) : 0,
                        unitPriceGrossClp: l.unitPriceClp,
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
                    const lineVat = computeChileanVatBreakdown({
                        dteType: params.documentType,
                        totalAmountClp: l.subtotalClp,
                    });
                    return {
                        purchaseLineId: l.purchaseLineId,
                        canonicalSkuId: l.canonicalSkuId,
                        description: l.description,
                        categoryCode: l.categoryCode,
                        unitSi: l.unitSi,
                        qtyPurchased: l.qtyPurchased,
                        unitPriceNetClp:
                            l.qtyPurchased > 0 ? Math.round(Math.abs(lineVat.netAmountClp) / l.qtyPurchased) : 0,
                        unitPriceGrossClp: l.unitPriceClp,
                        subtotalNetClp: Math.abs(lineVat.netAmountClp),
                        subtotalGrossClp: l.subtotalClp,
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

            for (let idx = 0; idx < params.lines.length; idx++) {
                const pLine = params.lines[idx];
                const domAsset = domainAssetByLineId.get(pLine.purchaseLineId);
                const domCash = domainRecon.cashEntries[idx];
                const isCapex = Boolean(domAsset || pLine.isCapexAsset || pLine.destination === 'CAPEX_ASSET');

                if (isCapex) {
                    const lineVatCreditClp = domAsset
                        ? domAsset.vatCreditClp
                        : computeChileanVatBreakdown({
                              dteType: params.documentType,
                              totalAmountClp: pLine.subtotalClp,
                          }).vatRecoverableClp;
                    const lineNetClp = domAsset
                        ? domAsset.acquisitionNetClp
                        : Math.max(0, Math.round(pLine.subtotalClp - Math.max(0, lineVatCreditClp)));

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
                        unitCostClp: pLine.unitPriceClp,
                        movementType:
                            pLine.destination === 'STOCK_IN_TRANSIT'
                                ? 'INBOUND_IN_TRANSIT'
                                : 'INBOUND_WAREHOUSE_DIRECT',
                        referenceId: purchaseId,
                        actorUid: actor.actorUid,
                        now,
                    });
                    txUpdatedInventory.set(invDocId, computed.record);
                    txStockLedgers.push(computed.ledgerEntry);
                }

                // Costo tributario contable: cuando no hay IVA crédito fiscal recuperable (ej. Boleta 39, DTE 52),
                // el monto pagado completo constituye base de costo (DL 825 Art. 23).
                const lineVatCredit = domCash
                    ? domCash.vatRecoverableClp
                    : computeChileanVatBreakdown({
                          dteType: params.documentType,
                          totalAmountClp: pLine.subtotalClp,
                      }).vatRecoverableClp;
                const lineNetBasis =
                    params.documentType === 61
                        ? -Math.abs(Math.round(pLine.subtotalClp - Math.abs(lineVatCredit)))
                        : Math.max(0, Math.round(pLine.subtotalClp - Math.max(0, lineVatCredit)));

                txCashEntries.push({
                    entryId: `cash_${crypto.randomBytes(5).toString('hex')}`,
                    tenantId: params.tenantId,
                    siteId: params.siteId,
                    paymentMethod: params.paymentMethod,
                    direction:
                        params.paymentMethod === 'REEMBOLSO_GERENCIA'
                            ? 'REIMBURSEMENT_DUE'
                            : 'EXPENSE_RENDERED',
                    amountClp: params.documentType === 61 ? -Math.abs(Math.round(pLine.subtotalClp)) : Math.round(pLine.subtotalClp),
                    netAmountClp: lineNetBasis,
                    vatCreditClp: lineVatCredit,
                    isCapex,
                    costCenter: isCapex ? 'CC-CAPEX' : domCash?.costCenter || pLine.costCenter || 'CC-CAMPAMENTO',
                    referenceId: purchaseId,
                    actorUid: actor.actorUid,
                    description: `${pLine.description} (${pLine.qtyPurchased} ${pLine.unitSi}) · DTE ${params.documentType} #${params.folio}`,
                    createdAt: now,
                });
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
            receivedLines?: Array<{ purchaseLineId: string; qtyReceived: number }>;
            notes?: string;
        },
        actor: AuditActorContext
    ): Promise<{
        purchase: SupplyPurchase;
        receptionOutcome: 'RECEIVED_OK' | 'PARTIAL_DISCREPANCY';
        receivedItemCount: number;
        affectedRequisitions: SupplyRequisition[];
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

        // Allocations de esta compra (inmutables tras alta de compra)
        const allocSnap = await db
            .collection(SUPPLY_COLLECTIONS.FULFILLMENT_ALLOCATIONS)
            .where('tenantId', '==', params.tenantId)
            .where('purchaseId', '==', params.purchaseId)
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
            confirmWarehouseReception({
                receptionId: `rec_${loaded.purchaseId}_${Date.now().toString(36)}`,
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
                        unitCostNetClp: line.unitPriceClp,
                        costCenter: line.costCenter || 'CC-CAMPAMENTO',
                    };
                }),
            });

            let txReceivedItemCount = 0;
            const txUpdatedInventory = new Map<string, SupplyInventoryItem>();
            const txStockLedgers: StockLedgerEntry[] = [];

            const updatedPurchaseLines: PurchaseLineWithReceptionProgress[] = (
                loaded.lines as PurchaseLineWithReceptionProgress[]
            ).map((line) => {
                if (line.destination !== 'STOCK_IN_TRANSIT') return line;
                const prog = incomingByLineId.get(line.purchaseLineId)!;
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
                        inWarehouseDelta: prog.incoming,
                        unitCostClp: line.unitPriceClp,
                        movementType: 'RECEPTION_CONFIRMED',
                        referenceId: loaded.purchaseId,
                        actorUid: actor.actorUid,
                        now,
                    });
                    txUpdatedInventory.set(invDocId, computed.record);
                    txStockLedgers.push(computed.ledgerEntry);
                }
                return {
                    ...line,
                    qtyReceivedSoFar: prog.next,
                };
            });

            const allInTransitComplete = updatedPurchaseLines
                .filter((l) => l.destination === 'STOCK_IN_TRANSIT')
                .every((l) => Number(l.qtyReceivedSoFar ?? 0) >= Number(l.qtyPurchased) - 1e-6);

            const nextStatus: SupplyPurchase['receptionStatus'] = allInTransitComplete
                ? 'RECEIVED'
                : 'PARTIAL_DISCREPANCY';
            const nextOutcome: 'RECEIVED_OK' | 'PARTIAL_DISCREPANCY' = allInTransitComplete
                ? 'RECEIVED_OK'
                : 'PARTIAL_DISCREPANCY';

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
            for (const ledgerEntry of txStockLedgers) {
                tx.set(db.collection(SUPPLY_COLLECTIONS.STOCK_LEDGER).doc(ledgerEntry.entryId), ledgerEntry);
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
        });

        await this.recordAudit(params.tenantId, actor, 'SUPPLY_PURCHASE_RECEPTION_CONFIRMED', updatedPurchase.purchaseId, {
            hitlConfirmed: true,
            receptionStatus: updatedPurchase.receptionStatus,
            receptionOutcome,
            receivedItemCount,
            affectedRequisitionIds: affectedRequisitions.map((r) => r.reqId),
        });

        return {
            purchase: updatedPurchase,
            receptionOutcome,
            receivedItemCount,
            affectedRequisitions,
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

    public static async listExpenseReports(tenantId: string, siteId?: string): Promise<SiiExpenseReport[]> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.EXPENSE_REPORTS)
            .where('tenantId', '==', tenantId)
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
                costCenter: (input.costCenter || 'CC-CAMPAMENTO').trim() || 'CC-CAMPAMENTO',
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
            const [inventory, cashEntries] = await Promise.all([
                this.listInventory(tenantId, site.siteId),
                this.listCashLedger(tenantId, site.siteId),
            ]);

            const headcount = Math.max(0, Number(site.currentHeadcount || 0));
            const leadTimeDays = Math.max(1, Number(site.leadTimeDays || 7));
            const altitudeM = Number(site.geoFix?.altitudeM || 0);
            const ds594Target = Math.max(100, Number(site.ds594DailyWaterTargetLPerPax || 120));
            const waterStorageCapacityL = Math.round(Number(site.waterStorageCapacityL || 0));

            // Stock REAL de agua potable en bodega y tránsito (`supply_inventory_items`) — jamás asumir tanque lleno
            const waterItems = inventory.filter((inv) => inv.categoryCode === 'AGUA_POTABLE');
            const waterWarehouseL = waterItems.reduce(
                (acc, inv) => acc + Math.max(0, Number(inv.qtyInWarehouse || 0)),
                0
            );
            const waterInTransitL = waterItems.reduce(
                (acc, inv) => acc + Math.max(0, Number(inv.qtyInTransit || 0)),
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

            const ds594Guard = evaluateDs594WaterGuardrail({
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

        const reqsSnap = await db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).limit(1000).get();
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
}
