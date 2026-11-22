import crypto from 'crypto';
import type express from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { AuditLedger } from '../core/audit-ledger';
import { extractClientIp } from '../middleware/rateLimiter';
import { x402Gatekeeper, type X402AuthenticatedRequest } from '../middleware/x402Gatekeeper';
import { SupplyRepository } from '../modules/supply/application/SupplyRepository';
import { SupplyCategoryCodeSchema } from '../modules/supply/application/supply.types';
import { validateChileanRut } from '../utils/taxIdValidator';

const MAX_M2M_UNIT_PRICE_NET_CLP = 1_000_000_000_000;
const ISO_DATE_OR_DATETIME_REGEX =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/;
const STRICT_SUPPLIER_TAX_ID_REGEX = /^[A-Z0-9][A-Z0-9.-]{3,30}[A-Z0-9]$/;
const CHILEAN_RUT_SHAPE_REGEX = /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/;

function isValidStrictSupplierTaxId(raw: string): boolean {
    const trimmed = String(raw || '').trim();
    if (!STRICT_SUPPLIER_TAX_ID_REGEX.test(trimmed.toUpperCase())) {
        return false;
    }
    if (CHILEAN_RUT_SHAPE_REGEX.test(trimmed)) {
        return validateChileanRut(trimmed).valid;
    }
    const compact = trimmed.toUpperCase().replace(/\./g, '');
    return /^[A-Z0-9-]{5,24}$/.test(compact) && !compact.includes('--');
}

/**
 * ADAPTADOR M2M x402 DESACOPLADO PARA MINREPORT · ABASTECIMIENTO (`supply`)
 *
 * Expone endpoints agénticos (`/api/m2m/supply/*`) protegidos estrictamente con
 * `x402Gatekeeper` (HTTP 402 Payment Required bajo estándar x402 Foundation) para
 * futuros proveedores Marketplace / RFQ agénticos:
 * - Jamás expone `tenantId`, nombres de faena ni coordenadas GPS exactas (Ley N° 21.719).
 * - Exige k-anonymity `k >= 3` sitios/tenants distintos y `optInVerified === true`.
 */

export const M2mSupplyDemandSignalsQuerySchema = z.object({
    districtCode: z.string().trim().min(2).max(64).optional(),
    categoryCode: SupplyCategoryCodeSchema.optional(),
});

export const M2mSupplyCatalogQuerySchema = z.object({
    categoryCode: SupplyCategoryCodeSchema.optional(),
    search: z.string().trim().min(1).max(120).optional(),
});

export const M2mRfqQuoteSubmitSchema = z
    .object({
        signalId: z.string().trim().min(4).max(128),
        supplierTaxId: z
            .string()
            .trim()
            .min(5)
            .max(32)
            .refine(
                isValidStrictSupplierTaxId,
                'supplierTaxId inválido (RUT chileno Módulo-11 o Tax ID internacional estricto requerido).'
            ),
        supplierName: z.string().trim().min(2).max(200),
        deliveryDistrictCode: z.string().trim().min(2).max(64),
        unitPriceNetClp: z.number().finite().positive().max(MAX_M2M_UNIT_PRICE_NET_CLP),
        minOrderQty: z.number().finite().positive().max(1_000_000_000),
        maxAvailableQty: z.number().finite().positive().max(1_000_000_000),
        leadTimeDays: z.number().int().min(1).max(120),
        validUntilIso: z
            .string()
            .trim()
            .min(10)
            .max(40)
            .refine((v) => {
                if (!ISO_DATE_OR_DATETIME_REGEX.test(v)) return false;
                const parsedMs = Date.parse(v);
                return Number.isFinite(parsedMs) && parsedMs > Date.now();
            }, 'validUntilIso debe ser una fecha ISO 8601 válida estrictamente futura.'),
        notes: z.string().trim().max(500).optional(),
    })
    .refine((d) => d.maxAvailableQty >= d.minOrderQty, {
        message: 'maxAvailableQty debe ser mayor o igual a minOrderQty.',
        path: ['maxAvailableQty'],
    });

export function registerM2mSupplyAdapterRoutes(app: express.Application): void {
    /**
     * GET /api/m2m/supply/demand-signals
     * Señales anónimas de demanda agrupada por distrito minero (k >= 3, opt-in Ley 21.719).
     */
    app.get(
        '/api/m2m/supply/demand-signals',
        x402Gatekeeper({
            priceMicroUSD: 25000,
            resourceId: 'supply-marketplace-demand-signals',
        }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const parsed = M2mSupplyDemandSignalsQuerySchema.safeParse(req.query || {});
                if (!parsed.success) {
                    return res.status(400).json({
                        error: 'Parámetros inválidos para señales anónimas de demanda M2M.',
                        details: parsed.error.flatten(),
                    });
                }

                const signals = await SupplyRepository.listAnonymousDemandSignals({
                    districtCode: parsed.data.districtCode,
                    categoryCode: parsed.data.categoryCode,
                });

                return res.status(200).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    privacyCompliance: 'LEY_21719_K_ANONYMITY_GE_3',
                    settlementMode: req.x402Context?.mode || 'VERIFIED',
                    timestamp: new Date().toISOString(),
                    count: signals.length,
                    signals,
                });
            } catch (err) {
                console.error('[M2M-SUPPLY-SIGNALS] Error exportando señales M2M:', err);
                return res.status(500).json({ error: 'Error consultando señales de demanda M2M.' });
            }
        }
    );

    /**
     * GET /api/m2m/supply/catalog/skus
     * Catálogo canónico no privado (`global_supply_catalog`) para homologación ERP/agentes proveedores.
     */
    app.get(
        '/api/m2m/supply/catalog/skus',
        x402Gatekeeper({
            priceMicroUSD: 15000,
            resourceId: 'supply-canonical-sku-catalog',
        }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const parsed = M2mSupplyCatalogQuerySchema.safeParse(req.query || {});
                if (!parsed.success) {
                    return res.status(400).json({
                        error: 'Parámetros de consulta de catálogo M2M inválidos.',
                        details: parsed.error.flatten(),
                    });
                }

                const items = (
                    await SupplyRepository.listCatalog({
                        categoryCode: parsed.data.categoryCode,
                        search: parsed.data.search,
                    })
                )
                    // Exponer únicamente SKUs globales (jamás SKUs privados de un tenant)
                    .filter((sku) => !sku.tenantId)
                    .map((sku) => ({
                        canonicalSkuId: sku.canonicalSkuId,
                        name: sku.name,
                        categoryCode: sku.categoryCode,
                        procurementBucket: sku.procurementBucket,
                        baseUnitSi: sku.baseUnitSi,
                        unspscCode: sku.unspscCode || null,
                        leySaco25kgApplied: Boolean(sku.leySaco25kgApplied),
                    }));

                return res.status(200).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    settlementMode: req.x402Context?.mode || 'VERIFIED',
                    timestamp: new Date().toISOString(),
                    count: items.length,
                    skus: items,
                });
            } catch (err) {
                console.error('[M2M-SUPPLY-CATALOG] Error consultando catálogo M2M:', err);
                return res.status(500).json({ error: 'Error consultando catálogo canónico M2M.' });
            }
        }
    );

    /**
     * POST /api/m2m/supply/rfq-quotes
     * Ingesta agéntica de cotizaciones de proveedores contra una señal anónima de demanda.
     */
    app.post(
        '/api/m2m/supply/rfq-quotes',
        x402Gatekeeper({
            priceMicroUSD: 30000,
            resourceId: 'supply-m2m-rfq-quote-intake',
        }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const parsed = M2mRfqQuoteSubmitSchema.safeParse(req.body || {});
                if (!parsed.success) {
                    return res.status(400).json({
                        error: 'Cotización RFQ M2M inválida.',
                        details: parsed.error.flatten(),
                    });
                }

                const signalSnap = await db
                    .collection('market_demand_signals')
                    .doc(parsed.data.signalId)
                    .get();
                if (!signalSnap.exists) {
                    return res.status(404).json({
                        error: 'Señal anónima de demanda no encontrada o expirada.',
                    });
                }
                const signalData = signalSnap.data() || {};
                const entityCount = Number(signalData.participatingEntitiesCount ?? 0);
                if (entityCount < 3 || signalData.optInVerified !== true) {
                    return res.status(403).json({
                        error: 'Señal bloqueada por política de anonimato k >= 3 entidades distintas (Ley N° 21.719).',
                    });
                }

                const quoteId = `rfqq_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
                const nowIso = new Date().toISOString();
                const agentId = req.x402Context?.agentId || req.x402Context?.uid || 'm2m-agent';

                const quoteDoc = {
                    quoteId,
                    signalId: parsed.data.signalId,
                    canonicalSkuId: signalData.canonicalSkuId || null,
                    districtCode: signalData.districtCode || parsed.data.deliveryDistrictCode,
                    agentId,
                    supplierTaxId: parsed.data.supplierTaxId,
                    supplierName: parsed.data.supplierName,
                    deliveryDistrictCode: parsed.data.deliveryDistrictCode.toUpperCase(),
                    unitPriceNetClp: Math.round(parsed.data.unitPriceNetClp),
                    minOrderQty: parsed.data.minOrderQty,
                    maxAvailableQty: parsed.data.maxAvailableQty,
                    leadTimeDays: parsed.data.leadTimeDays,
                    validUntilIso: parsed.data.validUntilIso,
                    notes: parsed.data.notes || null,
                    status: 'SUBMITTED',
                    createdAt: nowIso,
                };

                const quoteRef = db.collection('market_rfq_quotes').doc(quoteId);
                await quoteRef.set(quoteDoc);

                try {
                    await AuditLedger.record({
                        tenantId: req.x402Context?.tenantId || 'global',
                        actorUid: `m2m:${agentId}`,
                        actorEmail: `${agentId}@m2m.minreport.internal`,
                        action: 'M2M_SUPPLY_RFQ_QUOTE_SUBMITTED',
                        module: 'web3-m2m',
                        targetEntity: quoteId,
                        details: {
                            signalId: parsed.data.signalId,
                            districtCode: quoteDoc.districtCode,
                            unitPriceNetClp: quoteDoc.unitPriceNetClp,
                            leadTimeDays: quoteDoc.leadTimeDays,
                        },
                        ipAddress: extractClientIp(req),
                    });
                } catch (auditErr) {
                    await quoteRef.delete().catch(() => {});
                    console.error(
                        '[M2M-SUPPLY-RFQ] Error AuditLedger fail-closed; cotización revertida:',
                        auditErr instanceof Error ? auditErr.name : 'UnknownError'
                    );
                    return res.status(500).json({
                        error: 'AUDIT_LEDGER_UNAVAILABLE: No se pudo sellar trazabilidad en AuditLedger; cotización revertida.',
                        code: 'AUDIT_LEDGER_UNAVAILABLE',
                    });
                }

                return res.status(201).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    settlementMode: req.x402Context?.mode || 'VERIFIED',
                    quote: {
                        quoteId,
                        signalId: quoteDoc.signalId,
                        status: quoteDoc.status,
                        createdAt: quoteDoc.createdAt,
                    },
                });
            } catch (err) {
                console.error('[M2M-SUPPLY-RFQ] Error registrando cotización RFQ M2M:', err);
                return res.status(500).json({ error: 'Error registrando cotización RFQ M2M.' });
            }
        }
    );
}
