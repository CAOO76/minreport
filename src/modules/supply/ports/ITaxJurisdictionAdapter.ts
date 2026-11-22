/**
 * MINREPORT · ABASTECIMIENTO — Puertos Hexagonales de Jurisdicción Tributaria y Políticas de Seguridad en Faena
 *
 * Desacopla la normativa fiscal chilena (SII / DL 825 / Ley 19.983) y las políticas de seguridad minera
 * (DS 132 / DGMN Ley 17.798 / DS 594 / DS 28 / Ley del Saco N° 20.949) para habilitar escalamiento
 * internacional (PE, BR, MX, CO, AR, AU, EU) sin contaminar el núcleo del dominio.
 */

import { validateChileanRut } from '../../../utils/taxIdValidator';
import {
    AtypicalFlagCode,
    SiiDteType,
    roundClp,
} from '../domain/types';
import {
    CHILE_VAT_RATE,
    LEY_19983_RCV_DAYS,
    buildSiiDedupeKey,
    computeChileanVatBreakdown,
    computeRcvAcceptanceDeadline,
    validateSiiDocumentForPurchase,
} from '../domain/SiiTaxValidator';
import {
    checkDgmnExplosives,
    checkGlobalHardDeny,
} from '../domain/SupplyPolicyAndAnomalyEngine';
import {
    DS594_DEFAULT_WATER_L_PER_PAX_DAY,
    DS594_MIN_WATER_L_PER_PAX_DAY,
    resolveAltitudeHydrationFactor,
} from '../domain/DemandAndCostForecaster';

export type SupportedTaxCountryCode = 'CL' | 'PE' | 'BR' | 'MX' | 'CO' | 'AR' | 'AU' | 'EU';

export interface TaxIdValidationResult {
    valid: boolean;
    countryCode: SupportedTaxCountryCode;
    scheme: 'CL_RUT' | 'PE_RUC' | 'BR_CNPJ' | 'MX_RFC' | 'CO_NIT' | 'AR_CUIT' | 'AU_ABN' | 'EU_VAT';
    normalized: string;
    formatted: string;
    reason?: string;
}

export interface TaxBreakdownInput {
    documentType: number | string;
    totalAmount: number;
    netAmount?: number;
    taxAmount?: number;
    isCreditNote?: boolean;
    isTaxExempt?: boolean;
}

export interface TaxBreakdownResult {
    currencyCode: string;
    vatRate: number;
    netAmount: number;
    taxAmount: number;
    recoverableTaxAmount: number;
    nonRecoverableTaxAmount: number;
    totalAmount: number;
    isCreditNote: boolean;
}

export interface AcceptanceDeadlineResult {
    applicable: boolean;
    statutoryWindowDays: number;
    deadlineIso?: string;
    daysRemaining?: number;
    isOverdue: boolean;
    urgencyAlert: boolean;
}

export interface JurisdictionDocumentValidationInput {
    documentId: string;
    tenantId: string;
    siteId: string;
    supplierTaxId: string;
    supplierName: string;
    receiverTaxId?: string;
    expectedReceiverTaxId?: string;
    documentType: number | string;
    folio: string;
    issueDate: string;
    netAmount?: number;
    taxAmount?: number;
    totalAmount: number;
    xmlContent?: string;
    tedRawXml?: string;
    lineSubtotalsGross?: readonly number[];
    hasCapexAsset?: boolean;
    existingDedupeKeys?: readonly string[] | ReadonlySet<string>;
    referenceDateIso?: string;
}

export interface JurisdictionDocumentValidationResult {
    valid: boolean;
    implemented: boolean;
    countryCode: SupportedTaxCountryCode;
    currencyCode: string;
    isDuplicate: boolean;
    dedupeKey: string;
    errors: string[];
    warnings: string[];
    atypicalFlags: AtypicalFlagCode[];
    taxBreakdown: TaxBreakdownResult;
    acceptanceDeadline: AcceptanceDeadlineResult;
    tedRsaVerified?: boolean | null;
}

export interface ITaxJurisdictionAdapter {
    readonly countryCode: SupportedTaxCountryCode;
    readonly currencyCode: string;
    readonly taxAuthorityName: string;
    readonly standardVatRate: number;
    readonly implemented: boolean;

    validateTaxId(rawTaxId: string): TaxIdValidationResult;
    computeTaxBreakdown(params: TaxBreakdownInput): TaxBreakdownResult;
    validateDocument(input: JurisdictionDocumentValidationInput): JurisdictionDocumentValidationResult;
    computeAcceptanceDeadline(
        issueDateIso: string,
        documentType: number | string,
        referenceDateIso?: string
    ): AcceptanceDeadlineResult;
}

export interface ISiteSafetyPolicyPack {
    readonly countryCode: SupportedTaxCountryCode;
    readonly regulationCode: string;
    readonly minWaterLitersPerPaxDay: number;
    readonly defaultWaterLitersPerPaxDay: number;
    readonly maxManualLoadKg: number;

    resolveAltitudeHydrationFactor(altitudeMeters?: number): number;
    checkProhibitedItem(rawText: string): {
        denied: boolean;
        category?: string;
        matchedTerm?: string;
        reason?: string;
    };
    checkControlledExplosives(
        rawText: string,
        licensedForControlledItems: boolean
    ): {
        blocked: boolean;
        code?: 'DGMN_EXPLOSIVES_BLOCK';
        matchedTerm?: string;
        reason?: string;
    };
}

// ============================================================================
// 1. ADAPTADOR ACTIVO CHILE — SII (DL 825, Ley N° 19.983 RCV 8 días, TED RSA-SHA1)
// ============================================================================

function coerceChileanDteType(raw: number | string): SiiDteType {
    const n = Number(raw);
    if (n === 33 || n === 34 || n === 39 || n === 41 || n === 52 || n === 61 || n === 0) {
        return n;
    }
    return 0;
}

export const ChileSiiTaxJurisdictionAdapter: ITaxJurisdictionAdapter = {
    countryCode: 'CL',
    currencyCode: 'CLP',
    taxAuthorityName: 'SII (Servicio de Impuestos Internos)',
    standardVatRate: CHILE_VAT_RATE,
    implemented: true,

    validateTaxId(rawTaxId: string): TaxIdValidationResult {
        const res = validateChileanRut(rawTaxId);
        return {
            valid: res.valid,
            countryCode: 'CL',
            scheme: 'CL_RUT',
            normalized: res.normalized,
            formatted: res.formatted,
            reason: res.reason,
        };
    },

    computeTaxBreakdown(params: TaxBreakdownInput): TaxBreakdownResult {
        const dteType = coerceChileanDteType(params.documentType);
        const breakdown = computeChileanVatBreakdown({
            dteType,
            totalAmountClp: params.totalAmount,
            netAmountClp: params.netAmount,
            vatAmountClp: params.taxAmount,
        });
        return {
            currencyCode: 'CLP',
            vatRate: CHILE_VAT_RATE,
            netAmount: breakdown.netAmountClp,
            taxAmount: breakdown.vatAmountClp,
            recoverableTaxAmount: breakdown.vatRecoverableClp,
            nonRecoverableTaxAmount: breakdown.vatNonRecoverableClp,
            totalAmount: breakdown.totalAmountClp,
            isCreditNote: breakdown.isCreditNote,
        };
    },

    computeAcceptanceDeadline(
        issueDateIso: string,
        documentType: number | string,
        referenceDateIso?: string
    ): AcceptanceDeadlineResult {
        const dteType = coerceChileanDteType(documentType);
        const rcv = computeRcvAcceptanceDeadline(issueDateIso, dteType, referenceDateIso);
        return {
            applicable: rcv.applicable,
            statutoryWindowDays: LEY_19983_RCV_DAYS,
            deadlineIso: rcv.deadlineIso,
            daysRemaining: rcv.daysRemaining,
            isOverdue: rcv.isOverdue,
            urgencyAlert: rcv.rcvUrgencyAlert,
        };
    },

    validateDocument(input: JurisdictionDocumentValidationInput): JurisdictionDocumentValidationResult {
        const dteType = coerceChileanDteType(input.documentType);
        const outcome = validateSiiDocumentForPurchase({
            siiDocId: input.documentId,
            tenantId: input.tenantId,
            siteId: input.siteId,
            xmlContent: input.xmlContent,
            tedRawXml: input.tedRawXml,
            manualFallback:
                !input.xmlContent && !input.tedRawXml
                    ? {
                          supplierTaxId: input.supplierTaxId,
                          supplierName: input.supplierName,
                          receiverTaxId: input.receiverTaxId,
                          dteType,
                          folio: input.folio,
                          issueDate: input.issueDate,
                          netAmountClp: input.netAmount,
                          vatAmountClp: input.taxAmount,
                          totalAmountClp: input.totalAmount,
                      }
                    : undefined,
            expectedReceiverTaxId: input.expectedReceiverTaxId,
            lineSubtotalsGrossClp: input.lineSubtotalsGross,
            hasCapexAsset: input.hasCapexAsset,
            existingDedupeKeys: input.existingDedupeKeys,
            referenceDateIso: input.referenceDateIso,
        });

        return {
            valid: outcome.valid,
            implemented: true,
            countryCode: 'CL',
            currencyCode: 'CLP',
            isDuplicate: outcome.isDuplicate,
            dedupeKey: outcome.record.dedupeKey || buildSiiDedupeKey(input.supplierTaxId, dteType, input.folio),
            errors: outcome.errors,
            warnings: outcome.warnings,
            atypicalFlags: outcome.atypicalFlags,
            taxBreakdown: {
                currencyCode: 'CLP',
                vatRate: CHILE_VAT_RATE,
                netAmount: outcome.record.netAmountClp,
                taxAmount: outcome.record.vatAmountClp,
                recoverableTaxAmount: outcome.record.vatRecoverableClp,
                nonRecoverableTaxAmount: outcome.record.vatNonRecoverableClp,
                totalAmount: outcome.record.totalAmountClp,
                isCreditNote: Boolean(outcome.record.isCreditNote),
            },
            acceptanceDeadline: {
                applicable: outcome.rcvDeadline.applicable,
                statutoryWindowDays: LEY_19983_RCV_DAYS,
                deadlineIso: outcome.rcvDeadline.deadlineIso,
                daysRemaining: outcome.rcvDeadline.daysRemaining,
                isOverdue: outcome.rcvDeadline.isOverdue,
                urgencyAlert: outcome.rcvDeadline.rcvUrgencyAlert,
            },
            tedRsaVerified: outcome.tedRsaVerified,
        };
    },
};

// ============================================================================
// 2. ADAPTADORES INTERNACIONALES EXTENSIBLES (STUBS TIPADOS: PE, BR, MX, CO, AR, AU, EU)
// ============================================================================

interface InternationalStubConfig {
    countryCode: Exclude<SupportedTaxCountryCode, 'CL'>;
    currencyCode: string;
    taxAuthorityName: string;
    scheme: Exclude<TaxIdValidationResult['scheme'], 'CL_RUT'>;
    standardVatRate: number;
    taxIdRegex: RegExp;
    taxIdHelp: string;
    statutoryAcceptanceDays: number;
}

function roundCurrency(amount: number, currencyCode: string): number {
    if (!Number.isFinite(amount)) return 0;
    if (currencyCode === 'CLP' || currencyCode === 'COP') {
        return roundClp(amount);
    }
    return Math.round(amount * 100) / 100;
}

function createInternationalTaxStubAdapter(cfg: InternationalStubConfig): ITaxJurisdictionAdapter {
    return {
        countryCode: cfg.countryCode,
        currencyCode: cfg.currencyCode,
        taxAuthorityName: cfg.taxAuthorityName,
        standardVatRate: cfg.standardVatRate,
        implemented: false,

        validateTaxId(rawTaxId: string): TaxIdValidationResult {
            const normalized = String(rawTaxId || '')
                .trim()
                .toUpperCase()
                .replace(/[\s.]/g, '');
            const compact = normalized.replace(/-/g, '');
            const valid = cfg.taxIdRegex.test(compact) || cfg.taxIdRegex.test(normalized);
            return {
                valid,
                countryCode: cfg.countryCode,
                scheme: cfg.scheme,
                normalized: compact,
                formatted: normalized,
                ...(valid ? {} : { reason: `Formato ${cfg.scheme} inválido (${cfg.taxIdHelp}).` }),
            };
        },

        computeTaxBreakdown(params: TaxBreakdownInput): TaxBreakdownResult {
            const sign = params.isCreditNote ? -1 : 1;
            const absTotal = Math.abs(roundCurrency(params.totalAmount, cfg.currencyCode));
            if (params.isTaxExempt) {
                return {
                    currencyCode: cfg.currencyCode,
                    vatRate: 0,
                    netAmount: roundCurrency(absTotal * sign, cfg.currencyCode),
                    taxAmount: 0,
                    recoverableTaxAmount: 0,
                    nonRecoverableTaxAmount: 0,
                    totalAmount: roundCurrency(absTotal * sign, cfg.currencyCode),
                    isCreditNote: Boolean(params.isCreditNote),
                };
            }
            const absNet =
                params.netAmount !== undefined
                    ? Math.abs(roundCurrency(params.netAmount, cfg.currencyCode))
                    : roundCurrency(absTotal / (1 + cfg.standardVatRate), cfg.currencyCode);
            const absTax =
                params.taxAmount !== undefined
                    ? Math.abs(roundCurrency(params.taxAmount, cfg.currencyCode))
                    : roundCurrency(absTotal - absNet, cfg.currencyCode);
            return {
                currencyCode: cfg.currencyCode,
                vatRate: cfg.standardVatRate,
                netAmount: roundCurrency(absNet * sign, cfg.currencyCode),
                taxAmount: roundCurrency(absTax * sign, cfg.currencyCode),
                recoverableTaxAmount: roundCurrency(absTax * sign, cfg.currencyCode),
                nonRecoverableTaxAmount: 0,
                totalAmount: roundCurrency(absTotal * sign, cfg.currencyCode),
                isCreditNote: Boolean(params.isCreditNote),
            };
        },

        computeAcceptanceDeadline(
            issueDateIso: string,
            _documentType: number | string,
            referenceDateIso?: string
        ): AcceptanceDeadlineResult {
            if (cfg.statutoryAcceptanceDays <= 0) {
                return {
                    applicable: false,
                    statutoryWindowDays: 0,
                    isOverdue: false,
                    urgencyAlert: false,
                };
            }
            const m = String(issueDateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) {
                return {
                    applicable: true,
                    statutoryWindowDays: cfg.statutoryAcceptanceDays,
                    isOverdue: false,
                    urgencyAlert: true,
                };
            }
            const issueMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            const deadlineMs = issueMs + cfg.statutoryAcceptanceDays * 86_400_000;
            const deadlineIso = new Date(deadlineMs).toISOString().slice(0, 10);
            const refStr = (referenceDateIso || new Date().toISOString()).slice(0, 10);
            const refM = refStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
            const refMs = refM
                ? Date.UTC(Number(refM[1]), Number(refM[2]) - 1, Number(refM[3]))
                : Date.now();
            const daysRemaining = Math.floor((deadlineMs - refMs) / 86_400_000);
            return {
                applicable: true,
                statutoryWindowDays: cfg.statutoryAcceptanceDays,
                deadlineIso,
                daysRemaining,
                isOverdue: daysRemaining < 0,
                urgencyAlert: daysRemaining <= 2,
            };
        },

        validateDocument(input: JurisdictionDocumentValidationInput): JurisdictionDocumentValidationResult {
            const errors: string[] = [];
            const warnings: string[] = [
                `JURISDICTION_ADAPTER_STUB: Validación fiscal completa para ${cfg.countryCode} (${cfg.taxAuthorityName}) en modo stub extensible.`,
            ];
            const taxIdRes = this.validateTaxId(input.supplierTaxId);
            if (!taxIdRes.valid) {
                errors.push(taxIdRes.reason || `Identificador tributario ${cfg.scheme} inválido.`);
            }
            const cleanFolio = String(input.folio || '').trim();
            if (!cleanFolio || cleanFolio === '0') {
                errors.push('FOLIO_MUST_BE_POSITIVE: El folio/número de documento fiscal es obligatorio.');
            }
            const dedupeKey = `${cfg.countryCode}:${taxIdRes.normalized}#${String(input.documentType)}#${cleanFolio}`;
            const isDuplicate = input.existingDedupeKeys
                ? Array.isArray(input.existingDedupeKeys)
                    ? input.existingDedupeKeys.includes(dedupeKey)
                    : (input.existingDedupeKeys as ReadonlySet<string>).has(dedupeKey)
                : false;
            if (isDuplicate) {
                errors.push(`Documento duplicado detectado (${dedupeKey}).`);
            }
            const taxBreakdown = this.computeTaxBreakdown({
                documentType: input.documentType,
                totalAmount: input.totalAmount,
                netAmount: input.netAmount,
                taxAmount: input.taxAmount,
            });
            const acceptanceDeadline = this.computeAcceptanceDeadline(
                input.issueDate,
                input.documentType,
                input.referenceDateIso
            );

            return {
                valid: errors.length === 0,
                implemented: false,
                countryCode: cfg.countryCode,
                currencyCode: cfg.currencyCode,
                isDuplicate,
                dedupeKey,
                errors,
                warnings,
                atypicalFlags: [],
                taxBreakdown,
                acceptanceDeadline,
                tedRsaVerified: null,
            };
        },
    };
}

export const TAX_JURISDICTION_ADAPTERS: Readonly<Record<SupportedTaxCountryCode, ITaxJurisdictionAdapter>> = {
    CL: ChileSiiTaxJurisdictionAdapter,
    PE: createInternationalTaxStubAdapter({
        countryCode: 'PE',
        currencyCode: 'PEN',
        taxAuthorityName: 'SUNAT (CPE UBL 2.1)',
        scheme: 'PE_RUC',
        standardVatRate: 0.18,
        taxIdRegex: /^(10|15|17|20)\d{9}$/,
        taxIdHelp: 'RUC peruano de 11 dígitos (prefijo 10/15/17/20)',
        statutoryAcceptanceDays: 8,
    }),
    BR: createInternationalTaxStubAdapter({
        countryCode: 'BR',
        currencyCode: 'BRL',
        taxAuthorityName: 'Receita Federal / SEFAZ (NF-e)',
        scheme: 'BR_CNPJ',
        standardVatRate: 0.17,
        taxIdRegex: /^\d{14}$/,
        taxIdHelp: 'CNPJ brasileño de 14 dígitos',
        statutoryAcceptanceDays: 0,
    }),
    MX: createInternationalTaxStubAdapter({
        countryCode: 'MX',
        currencyCode: 'MXN',
        taxAuthorityName: 'SAT (CFDI 4.0)',
        scheme: 'MX_RFC',
        standardVatRate: 0.16,
        taxIdRegex: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/,
        taxIdHelp: 'RFC mexicano de 12 o 13 caracteres',
        statutoryAcceptanceDays: 0,
    }),
    CO: createInternationalTaxStubAdapter({
        countryCode: 'CO',
        currencyCode: 'COP',
        taxAuthorityName: 'DIAN (Factura Electrónica UBL 2.1)',
        scheme: 'CO_NIT',
        standardVatRate: 0.19,
        taxIdRegex: /^\d{8,10}-?\d$/,
        taxIdHelp: 'NIT colombiano con dígito de verificación',
        statutoryAcceptanceDays: 3,
    }),
    AR: createInternationalTaxStubAdapter({
        countryCode: 'AR',
        currencyCode: 'ARS',
        taxAuthorityName: 'ARCA / AFIP (Factura Electrónica CAE)',
        scheme: 'AR_CUIT',
        standardVatRate: 0.21,
        taxIdRegex: /^\d{11}$/,
        taxIdHelp: 'CUIT argentino de 11 dígitos',
        statutoryAcceptanceDays: 0,
    }),
    AU: createInternationalTaxStubAdapter({
        countryCode: 'AU',
        currencyCode: 'AUD',
        taxAuthorityName: 'ATO (Peppol eInvoicing / GST)',
        scheme: 'AU_ABN',
        standardVatRate: 0.1,
        taxIdRegex: /^\d{11}$/,
        taxIdHelp: 'ABN australiano de 11 dígitos',
        statutoryAcceptanceDays: 0,
    }),
    EU: createInternationalTaxStubAdapter({
        countryCode: 'EU',
        currencyCode: 'EUR',
        taxAuthorityName: 'EU VAT / Peppol BIS EN 16931',
        scheme: 'EU_VAT',
        standardVatRate: 0.2,
        taxIdRegex: /^[A-Z]{2}[A-Z0-9]{8,12}$/,
        taxIdHelp: 'EU VAT ID con prefijo ISO-2 de país miembro',
        statutoryAcceptanceDays: 0,
    }),
};

export function getTaxJurisdictionAdapter(countryCode?: string): ITaxJurisdictionAdapter {
    const normalized = String(countryCode || 'CL').trim().toUpperCase() as SupportedTaxCountryCode;
    return TAX_JURISDICTION_ADAPTERS[normalized] || ChileSiiTaxJurisdictionAdapter;
}

// ============================================================================
// 3. PACK DE POLÍTICAS DE SEGURIDAD EN FAENA (`ISiteSafetyPolicyPack`)
// ============================================================================

export const ChileMiningSafetyPolicyPack: ISiteSafetyPolicyPack = {
    countryCode: 'CL',
    regulationCode: 'CL-DS132-DS594-DS28-LEY20949-LEY17798',
    minWaterLitersPerPaxDay: DS594_MIN_WATER_L_PER_PAX_DAY,
    defaultWaterLitersPerPaxDay: DS594_DEFAULT_WATER_L_PER_PAX_DAY,
    maxManualLoadKg: 25,

    resolveAltitudeHydrationFactor(altitudeMeters?: number): number {
        return resolveAltitudeHydrationFactor(altitudeMeters);
    },

    checkProhibitedItem(rawText: string) {
        const res = checkGlobalHardDeny(rawText);
        return {
            denied: res.denied,
            category: res.category,
            matchedTerm: res.matchedTerm,
            reason: res.reasonSpanish,
        };
    },

    checkControlledExplosives(rawText: string, licensedForControlledItems: boolean) {
        const exp = checkDgmnExplosives(rawText);
        if (exp.isExplosive && !licensedForControlledItems) {
            return {
                blocked: true,
                code: 'DGMN_EXPLOSIVES_BLOCK' as const,
                matchedTerm: exp.matchedTerm,
                reason: exp.reasonSpanish,
            };
        }
        return { blocked: false };
    },
};

export function getSiteSafetyPolicyPack(countryCode?: string): ISiteSafetyPolicyPack {
    const normalized = String(countryCode || 'CL').trim().toUpperCase();
    if (normalized === 'CL') {
        return ChileMiningSafetyPolicyPack;
    }
    return {
        ...ChileMiningSafetyPolicyPack,
        countryCode: (TAX_JURISDICTION_ADAPTERS[normalized as SupportedTaxCountryCode]?.countryCode || 'CL'),
        regulationCode: `${normalized}-MINING-SAFETY-BASELINE`,
    };
}
