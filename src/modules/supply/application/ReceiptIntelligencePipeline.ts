import crypto from 'crypto';
import { z } from 'zod';
import type { MediaDigestionProfile } from '../../../contracts/media.contracts';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import { validateChileanRut } from '../../../utils/taxIdValidator';
import {
    type AtypicalFlagCode,
    buildSiiDedupeKey,
    computeRcvDeadline,
    type EvidenceCasRef,
    type LinePricingBasis,
    normalizeLegacyCostCenter,
    normalizeSupplyItemFromText,
    type ParsedSiiHeader,
    parseSiiTedOrXmlDeterministic,
    type PurchaseLineDestination,
    type SiiDteType,
    SUPPLY_AI_MODULE,
    type SupplyPurchaseLine,
    verifyReceiptArithmetic,
} from './supply.types';

/**
 * RECEIPT INTELLIGENCE PIPELINE (MINREPORT · ABASTECIMIENTO)
 *
 * Procesa boletas, facturas electrónicas (DTE 33/34/39/41/52/61), comprobantes rurales (0),
 * XML SII y códigos TED PDF417:
 * 1. Digestión obligatoria vía `MediaDigestorServer` + `CasStorageService.digestAndStore`
 *    (`TENANT_PRIVATE`, preservando `originalBytes`, `optimizedBytes`, `savingsPct`).
 * 2. Extracción determinista prioritaria desde XML DTE / TED PDF417 (Módulo-11 RUT + anti-duplicado).
 * 3. Sanitización pre-vuelo Ley N° 21.719 (`ConfidentialityAirlockService.scrubDeterministicPii`).
 * 4. Extracción multimodal de ítems vía `ResilientAIClient` (Gemini Flash Structured Output;
 *    prohibido instanciar `new GoogleGenAI` fuera de `resilient-ai-client.ts`).
 * 5. Verificación aritmética determinista (±2 CLP) y alerta CAPEX sin Factura Electrónica.
 */

const ReceiptAiLineSchema = z.object({
    description: z.string().min(1).max(240),
    quantity: z.number().positive(),
    unitRaw: z.string().max(40).optional(),
    unitPriceClp: z.number().nonnegative(),
    subtotalClp: z.number().nonnegative(),
    isCapexSuspected: z.boolean().optional(),
});

const ReceiptAiExtractionSchema = z.object({
    supplierName: z.string().max(200).optional(),
    supplierTaxId: z.string().max(32).optional(),
    documentType: z.number().int().optional(),
    folio: z.number().int().nonnegative().optional(),
    issueDate: z.string().max(32).optional(),
    netAmountClp: z.number().nonnegative().optional(),
    vatAmountClp: z.number().nonnegative().optional(),
    totalAmountClp: z.number().nonnegative().optional(),
    lines: z.array(ReceiptAiLineSchema).optional(),
});

export interface AnalyzeReceiptInput {
    tenantId: string;
    actorUid: string;
    rawBuffer?: Buffer;
    mimeType?: string;
    originalFilename?: string;
    clientOriginalBytes?: number;
    existingEvidenceCasRef?: EvidenceCasRef;
    xmlContent?: string;
    tedRawXml?: string;
    contextCaption?: string;
    defaultDestination?: PurchaseLineDestination;
    defaultCostCenter?: string;
    checkDuplicateDedupeKey?: (dedupeKey: string) => Promise<boolean>;
}

export interface ReceiptArithmeticCheck {
    verified: boolean;
    linesSumClp: number;
    expectedTotalClp: number;
    deltaClp: number;
    pricingBasis: 'GROSS' | 'NET_PLUS_VAT' | 'MISMATCH';
}

export interface AnalyzedReceiptResult {
    extractionSource: 'XML_DTE' | 'TED_PLUS_AI' | 'AI_VISION_OCR' | 'TED_ONLY';
    supplierTaxId: string;
    supplierRutValid: boolean;
    supplierName: string;
    documentType: SiiDteType;
    folio: number;
    dedupeKey: string;
    duplicateDetected: boolean;
    issueDate: string;
    netAmountClp: number;
    vatAmountClp: number;
    vatCreditRecoverableClp: number;
    totalAmountClp: number;
    rcvDeadlineDate: string | null;
    rcvDaysRemaining: number | null;
    lines: SupplyPurchaseLine[];
    arithmeticCheck: ReceiptArithmeticCheck;
    atypicalFlags: AtypicalFlagCode[];
    missingInvoiceAlert: boolean;
    evidenceCasRef?: EvidenceCasRef;
    tedRawXml?: string;
    scrubbedRedactedCategories: string[];
    aiModelUsed?: string;
}

function coerceDteType(code: number | undefined): SiiDteType {
    if (code === 33 || code === 34 || code === 39 || code === 41 || code === 52 || code === 61) {
        return code;
    }
    return 0;
}

function resolveDigestionProfile(mimeType: string): MediaDigestionProfile {
    const lower = (mimeType || '').toLowerCase();
    if (lower.includes('pdf')) return 'PDF_HYBRID_OEM';
    if (lower.includes('xml')) return 'XML_DTE_DOCUMENT';
    if (lower.startsWith('image/')) return 'IMAGE_TECHNICAL_HD';
    return 'VIDEO_FIELD_COMPACT';
}

export class ReceiptCasAccessDeniedError extends Error {
    public readonly code = 'CAS_TENANT_ACCESS_DENIED' as const;

    constructor(
        message: string = 'CAS_TENANT_ACCESS_DENIED: Referencia CAS fuera del ámbito de la cuenta activa.'
    ) {
        super(message);
        this.name = 'ReceiptCasAccessDeniedError';
    }
}

export class ReceiptIntelligencePipeline {
    /**
     * Analiza una boleta, factura, PDF o XML DTE cumpliendo CAS + Ley 21.719 + ResilientAIClient.
     */
    public static async analyze(input: AnalyzeReceiptInput): Promise<AnalyzedReceiptResult> {
        if (!input.tenantId || !input.tenantId.trim()) {
            throw new Error('tenantId es obligatorio para analizar comprobantes en TENANT_PRIVATE.');
        }

        const defaultDest: PurchaseLineDestination = input.defaultDestination || 'STOCK_IN_TRANSIT';
        const defaultCc = (input.defaultCostCenter || 'CC-CAMP-ALIMENTACION').trim() || 'CC-CAMP-ALIMENTACION';

        let rawBuf = input.rawBuffer;
        let mimeType = (input.mimeType || '').toLowerCase().trim();
        let xmlCandidate = (input.xmlContent || '').trim();
        const tedCandidate = (input.tedRawXml || '').trim();

        if (!rawBuf && xmlCandidate) {
            rawBuf = Buffer.from(xmlCandidate, 'utf8');
            mimeType = 'application/xml';
        } else if (rawBuf && (mimeType.includes('xml') || input.originalFilename?.toLowerCase().endsWith('.xml'))) {
            if (!xmlCandidate) {
                xmlCandidate = rawBuf.toString('utf8').trim();
            }
            mimeType = 'application/xml';
        }

        // 1. Digestión obligatoria y almacenamiento CAS (`TENANT_PRIVATE`) preservando trazabilidad de peso
        let evidenceCasRef: EvidenceCasRef | undefined = input.existingEvidenceCasRef;
        let aiMediaBuffer: Buffer | undefined;
        let aiMediaMimeType: string | undefined;

        if (evidenceCasRef) {
            // Fail-closed: nunca confiar en `storagePath` provisto por cliente; validar pertenencia + resolver solo por `sha256`
            if (
                evidenceCasRef.storagePath &&
                !CasStorageService.isTenantPrivateStoragePath(evidenceCasRef.storagePath, input.tenantId)
            ) {
                throw new ReceiptCasAccessDeniedError();
            }

            const cleanSha = String(evidenceCasRef.sha256 || '').trim().toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(cleanSha)) {
                throw new ReceiptCasAccessDeniedError();
            }

            const verifiedEntry = await CasStorageService.resolveRegistryEntryBySha256(cleanSha, {
                scope: 'TENANT_PRIVATE',
                tenantId: input.tenantId,
            });
            if (
                !verifiedEntry ||
                !verifiedEntry.storagePath ||
                !CasStorageService.isTenantPrivateStoragePath(verifiedEntry.storagePath, input.tenantId)
            ) {
                throw new ReceiptCasAccessDeniedError();
            }

            evidenceCasRef = {
                sha256: verifiedEntry.sha256,
                phashHex: verifiedEntry.phashHex,
                storagePath: verifiedEntry.storagePath,
                downloadUrl: verifiedEntry.downloadUrl,
                mimeType: verifiedEntry.mimeType,
                extension: verifiedEntry.extension,
                profile: verifiedEntry.profile,
                originalBytes: verifiedEntry.originalBytes,
                optimizedBytes: verifiedEntry.optimizedBytes,
                savingsRatio: verifiedEntry.savingsRatio,
                savingsPct:
                    typeof verifiedEntry.savingsPct === 'number'
                        ? verifiedEntry.savingsPct
                        : Number((verifiedEntry.savingsRatio * 100).toFixed(1)),
                originalFilename: verifiedEntry.originalFilename,
                createdAt: verifiedEntry.createdAt,
            };

            if (!rawBuf) {
                // Reutilizar binario pre-digerido exclusivamente vía `sha256` + scope `TENANT_PRIVATE`
                const blob = await CasStorageService.readCasBlob(verifiedEntry.sha256, {
                    scope: 'TENANT_PRIVATE',
                    tenantId: input.tenantId,
                });
                if (blob) {
                    if (blob.contentType.includes('xml') && !xmlCandidate) {
                        xmlCandidate = blob.buffer.toString('utf8').trim();
                    } else if (
                        blob.contentType.startsWith('image/') ||
                        blob.contentType === 'application/pdf'
                    ) {
                        aiMediaBuffer = blob.buffer;
                        aiMediaMimeType = blob.contentType;
                    }
                }
            }
        }

        if (rawBuf && rawBuf.length > 0) {
            const trueClientOriginalBytes = Math.max(
                Number(input.clientOriginalBytes || 0),
                rawBuf.length
            );

            // Preservar bytes originales de XML DTE para que `MediaDigestorServer.digestXmlDte` conserve `<TED>` y `<Signature>` intactos
            const profile = resolveDigestionProfile(mimeType || 'image/jpeg');
            const { descriptor, digested } = await CasStorageService.digestAndStore(
                rawBuf,
                mimeType || 'image/jpeg',
                profile,
                {
                    scope: 'TENANT_PRIVATE',
                    tenantId: input.tenantId,
                    actorUid: input.actorUid,
                    originalFilename: input.originalFilename || 'receipt_evidence',
                    clientOriginalBytes: trueClientOriginalBytes,
                    enableSelectiveRaster: true,
                }
            );

            evidenceCasRef = {
                sha256: descriptor.sha256,
                phashHex: descriptor.phashHex,
                storagePath: descriptor.storagePath,
                downloadUrl: descriptor.downloadUrl,
                mimeType: descriptor.mimeType,
                extension: descriptor.extension,
                profile: descriptor.profile,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                savingsPct:
                    typeof descriptor.savingsPct === 'number'
                        ? descriptor.savingsPct
                        : Number((descriptor.savingsRatio * 100).toFixed(1)),
                originalFilename: descriptor.originalFilename,
                createdAt: descriptor.createdAt,
            };

            if (digested.mimeType.startsWith('image/') || digested.mimeType === 'application/pdf') {
                aiMediaBuffer = digested.buffer;
                aiMediaMimeType = digested.mimeType;
            }
        }

        // 2. Extracción determinista prioritaria (XML DTE completo o TED PDF417)
        let deterministicHeader: ParsedSiiHeader | null = null;
        if (xmlCandidate) {
            deterministicHeader = parseSiiTedOrXmlDeterministic(xmlCandidate);
        }
        if (!deterministicHeader && tedCandidate) {
            deterministicHeader = parseSiiTedOrXmlDeterministic(tedCandidate);
        }

        // 3. Sanitización pre-vuelo Ley N° 21.719 antes de cualquier llamada IA
        const rawPromptContext = [
            input.contextCaption || '',
            deterministicHeader?.firstItemSummary ? `Referencia TED IT1: ${deterministicHeader.firstItemSummary}` : '',
        ]
            .filter(Boolean)
            .join(' | ');

        const airlock = ConfidentialityAirlockService.scrubDeterministicPii(rawPromptContext, 'CL');

        let aiExtracted: z.infer<typeof ReceiptAiExtractionSchema> | null = null;
        let aiModelUsed: string | undefined;

        const hasDeterministicXmlLines = Boolean(
            deterministicHeader?.source === 'XML_DTE' &&
                deterministicHeader.xmlLines &&
                deterministicHeader.xmlLines.length > 0
        );

        // 4. Si no tenemos detalle completo desde XML DTE, extraer ítems con Gemini Flash Structured Output
        if (!hasDeterministicXmlLines && (aiMediaBuffer || airlock.scrubbed.length > 0)) {
            const prompt = [
                'Eres un extractor estructurado de comprobantes de compra mineros en Chile (SII DTE 33/34/39/41/52/61 o vale rural 0).',
                'Extrae estrictamente los ítems visibles en la boleta/factura sin inventar precios ni cantidades.',
                'Devuelve JSON válido con:',
                '- supplierName (razón social o comercio)',
                '- supplierTaxId (RUT emisor si es visible, ej. 76123456-K, o vacío)',
                '- documentType (33=Factura, 34=Factura Exenta, 39=Boleta, 41=Boleta Exenta, 52=Guía, 61=Nota Crédito, 0=Sin DTE)',
                '- folio (entero, 0 si no visible)',
                '- issueDate (YYYY-MM-DD)',
                '- netAmountClp, vatAmountClp, totalAmountClp (enteros CLP)',
                '- lines: [{ description, quantity, unitRaw, unitPriceClp, subtotalClp, isCapexSuspected }]',
                'Marca isCapexSuspected=true para activos durables o equipamiento (cocina industrial, generador, compresor, bomba, soldadora, refrigerador).',
                airlock.scrubbed ? `Contexto sanitizado adicional: ${airlock.scrubbed}` : '',
            ]
                .filter(Boolean)
                .join('\n');

            const { data, meta } = await ResilientAIClient.generateStructured(
                {
                    module: SUPPLY_AI_MODULE,
                    preferredTier: 'SECONDARY',
                    temperature: 0,
                    tenantId: input.tenantId,
                    dataClassification: 'TENANT_PRIVATE',
                    prompt,
                    media:
                        aiMediaBuffer && aiMediaMimeType
                            ? [
                                  {
                                      mimeType: aiMediaMimeType,
                                      dataBase64: aiMediaBuffer.toString('base64'),
                                  },
                              ]
                            : undefined,
                },
                ReceiptAiExtractionSchema
            );
            aiExtracted = data;
            aiModelUsed = meta.model;
        }

        // 5. Fusión determinista (XML/TED manda sobre OCR IA para todos los campos tributarios)
        const rawSupplierTaxId =
            deterministicHeader?.supplierTaxId || aiExtracted?.supplierTaxId || 'SIN-RUT';
        const rutValidation = validateChileanRut(rawSupplierTaxId);
        const supplierTaxId = rutValidation.valid
            ? rutValidation.normalized
            : rawSupplierTaxId.trim() || 'SIN-RUT';
        const supplierRutValid = rutValidation.valid;

        const supplierName =
            deterministicHeader?.supplierName ||
            aiExtracted?.supplierName ||
            '[Información técnica no declarada en ficha]';

        const documentType: SiiDteType = deterministicHeader
            ? deterministicHeader.documentType
            : coerceDteType(aiExtracted?.documentType);

        const folio =
            deterministicHeader && deterministicHeader.folio > 0
                ? deterministicHeader.folio
                : Number(aiExtracted?.folio || 0);

        const issueDate =
            deterministicHeader?.issueDate ||
            aiExtracted?.issueDate ||
            new Date().toISOString().slice(0, 10);

        const rawLinesSource = hasDeterministicXmlLines
            ? (deterministicHeader!.xmlLines || []).map((l) => ({
                  description: l.description,
                  quantity: l.qty,
                  unitRaw: l.unitRaw || 'un',
                  unitPriceClp: l.unitPriceClp,
                  subtotalClp: l.subtotalClp,
                  isCapexSuspected: false,
              }))
            : aiExtracted?.lines && aiExtracted.lines.length > 0
              ? aiExtracted.lines
              : deterministicHeader?.firstItemSummary
                ? [
                      {
                          description: deterministicHeader.firstItemSummary,
                          quantity: 1,
                          unitRaw: 'un',
                          unitPriceClp: deterministicHeader.totalAmountClp,
                          subtotalClp: deterministicHeader.totalAmountClp,
                          isCapexSuspected: false,
                      },
                  ]
                : [];

        const xmlOrNetDte =
            hasDeterministicXmlLines &&
            (documentType === 33 || documentType === 52 || documentType === 61);
        const xmlHeaderEstimated = xmlOrNetDte && !deterministicHeader?.totalAmountClp;

        const lines: SupplyPurchaseLine[] = rawLinesSource.map((rawLine, idx) => {
            const norm = normalizeSupplyItemFromText(rawLine.description, rawLine.quantity, rawLine.unitRaw);
            const isCapex = Boolean(norm.isCapexAsset || rawLine.isCapexSuspected);
            const qty = norm.qtySi && norm.qtySi > 0 ? norm.qtySi : rawLine.quantity;
            const subtotalClp = Math.round(
                rawLine.subtotalClp > 0 ? rawLine.subtotalClp : rawLine.quantity * rawLine.unitPriceClp
            );
            const unitPriceClp =
                qty > 0 ? Math.round(subtotalClp / qty) : Math.round(rawLine.unitPriceClp || 0);
            const effectiveCategory = isCapex ? 'ACTIVO_EQUIPAMIENTO' : norm.categoryCode;

            return {
                purchaseLineId: `pline_${idx + 1}_${crypto.randomBytes(3).toString('hex')}`,
                canonicalSkuId: norm.canonicalSkuId,
                description: rawLine.description.trim(),
                categoryCode: effectiveCategory,
                procurementBucket: isCapex ? 'ACTIVOS_CAPEX' : norm.procurementBucket,
                unitSi: norm.unitSi,
                qtyPurchased: qty,
                unitPriceClp,
                subtotalClp,
                linePricingBasis: xmlHeaderEstimated ? 'NET' : 'GROSS',
                destination: isCapex ? 'CAPEX_ASSET' : defaultDest,
                costCenter: isCapex ? 'CC-CAPEX' : normalizeLegacyCostCenter(defaultCc, effectiveCategory),
                isCapexAsset: isCapex,
            };
        });

        const summedLinesClp = lines.reduce((acc, l) => acc + l.subtotalClp, 0);
        const totalAmountClp = Math.round(
            deterministicHeader?.totalAmountClp ||
                aiExtracted?.totalAmountClp ||
                (xmlOrNetDte ? Math.round(summedLinesClp * 1.19) : summedLinesClp)
        );

        let netAmountClp: number;
        let vatAmountClp: number;
        if (typeof deterministicHeader?.netAmountClp === 'number' && typeof deterministicHeader?.vatAmountClp === 'number') {
            netAmountClp = Math.round(deterministicHeader.netAmountClp);
            vatAmountClp = Math.round(deterministicHeader.vatAmountClp);
        } else if (documentType === 33 || documentType === 52 || documentType === 61) {
            netAmountClp =
                typeof aiExtracted?.netAmountClp === 'number' && aiExtracted.netAmountClp > 0
                    ? Math.round(aiExtracted.netAmountClp)
                    : Math.round(Math.abs(totalAmountClp) / 1.19);
            vatAmountClp =
                typeof aiExtracted?.vatAmountClp === 'number' && aiExtracted.vatAmountClp >= 0
                    ? Math.round(aiExtracted.vatAmountClp)
                    : Math.max(0, Math.abs(totalAmountClp) - netAmountClp);
        } else if (documentType === 39) {
            netAmountClp = Math.round(totalAmountClp / 1.19);
            vatAmountClp = Math.max(0, totalAmountClp - netAmountClp);
        } else {
            netAmountClp = totalAmountClp;
            vatAmountClp = 0;
        }

        // Crédito fiscal IVA recuperable positivo en Factura Electrónica (DTE 33) y negativo (ajuste/rebaja) en Nota de Crédito (DTE 61)
        const vatCreditRecoverableClp =
            documentType === 33
                ? Math.abs(vatAmountClp)
                : documentType === 61
                  ? -Math.abs(vatAmountClp)
                  : 0;

        // 6. Verificación aritmética determinista
        const arithmeticCheck = verifyReceiptArithmetic({
            lines,
            netAmountClp,
            vatAmountClp,
            totalAmountClp,
            documentType,
        });

        const resolvedLinePricingBasis: LinePricingBasis =
            arithmeticCheck.pricingBasis === 'NET_PLUS_VAT'
                ? 'NET'
                : arithmeticCheck.pricingBasis === 'GROSS'
                  ? 'GROSS'
                  : xmlHeaderEstimated
                    ? 'NET'
                    : 'GROSS';
        for (const line of lines) {
            line.linePricingBasis = resolvedLinePricingBasis;
        }

        // 7. Llave anti-duplicación SII y plazo 8 días RCV (Ley N° 19.983)
        const dedupeKey = buildSiiDedupeKey(supplierTaxId, documentType, folio);
        const duplicateDetected =
            documentType !== 0 && folio > 0 && input.checkDuplicateDedupeKey
                ? await input.checkDuplicateDedupeKey(dedupeKey)
                : false;

        const { rcvDeadlineDate, rcvDaysRemaining } = computeRcvDeadline(issueDate, documentType);

        const hasCapexLine = lines.some((l) => l.isCapexAsset || l.destination === 'CAPEX_ASSET');
        const missingInvoiceAlert = hasCapexLine && documentType !== 33 && documentType !== 34;

        const atypicalFlags: AtypicalFlagCode[] = [];
        if (hasCapexLine) {
            atypicalFlags.push('ATYPICAL_HIGH_VALUE_OR_CAPEX');
        }
        if (missingInvoiceAlert) {
            atypicalFlags.push('ATYPICAL_ASSET_WITHOUT_INVOICE');
        }

        const extractionSource: AnalyzedReceiptResult['extractionSource'] = hasDeterministicXmlLines
            ? 'XML_DTE'
            : deterministicHeader && aiExtracted
              ? 'TED_PLUS_AI'
              : deterministicHeader
                ? 'TED_ONLY'
                : 'AI_VISION_OCR';

        return {
            extractionSource,
            supplierTaxId,
            supplierRutValid,
            supplierName,
            documentType,
            folio,
            dedupeKey,
            duplicateDetected,
            issueDate,
            netAmountClp,
            vatAmountClp,
            vatCreditRecoverableClp,
            totalAmountClp,
            rcvDeadlineDate,
            rcvDaysRemaining,
            lines,
            arithmeticCheck,
            atypicalFlags: Array.from(new Set(atypicalFlags)),
            missingInvoiceAlert,
            evidenceCasRef,
            tedRawXml: deterministicHeader?.tedRawXml || (tedCandidate || undefined),
            scrubbedRedactedCategories: airlock.redactedCategories,
            aiModelUsed,
        };
    }
}
