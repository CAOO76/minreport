/**
 * MINREPORT · ABASTECIMIENTO — Validador Tributario SII Chile (XML DTE & TED PDF417)
 *
 * Implementación 100% determinística (cero XML parser vulnerable a XXE, cero aritmética LLM):
 * - Parseo de timbre electrónico **TED PDF417** (`<TED><DD><RE><TD><F><FE><RR><MNT><IT1>...</DD><FRMT>...</TED>`).
 * - Parseo de **XML DTE** SII (`<DTE>` / `<EnvioDTE>`).
 * - Validación criptográfica Módulo-11 de RUT vía `validateChileanRut`.
 * - Llave determinística anti-duplicación `${normalizedRut}#${dteType}#${folio}`.
 * - Plazo legal de 8 días corridos RCV (Ley N° 19.983) para Facturas Electrónicas (DTE 33/34).
 * - Alerta `ATYPICAL_ASSET_WITHOUT_INVOICE` cuando un activo CAPEX carece de Factura 33/34.
 * - Guardrail aritmético `sum(lineSubtotals) === documentTotal` (tolerancia ±2 CLP).
 * - Exportación CSV lista para contabilidad chilena / conciliación RCV SII.
 */

import { validateChileanRut } from '../../../utils/taxIdValidator';
import {
    AtypicalFlagCode,
    SiiDocumentRecord,
    SiiDteType,
    roundClp,
} from './types';

export const CHILE_VAT_RATE = 0.19;
export const LEY_19983_RCV_DAYS = 8;
export const DEFAULT_ARITHMETIC_TOLERANCE_CLP = 2;

const VALID_SII_DTE_TYPES = new Set<number>([33, 34, 39, 41, 52, 61, 0]);

export interface ParsedSiiTedPdf417 {
    valid: boolean;
    errors: string[];
    emitterRutRaw: string;
    emitterRutNormalized: string;
    emitterRutFormatted: string;
    emitterRutValid: boolean;
    dteType: SiiDteType;
    folio: string;
    issueDate: string;
    receiverRutRaw?: string;
    receiverRutNormalized?: string;
    receiverRutValid?: boolean;
    receiverName?: string;
    totalAmountClp: number;
    firstItemSummary?: string;
    tedTimestamp?: string;
    tedSignaturePresent: boolean;
    dedupeKey: string;
}

export interface ParsedSiiXmlDteLine {
    lineNumber: number;
    name: string;
    quantity: number;
    unitPriceClp: number;
    subtotalClp: number;
}

export interface ParsedSiiXmlDte {
    valid: boolean;
    errors: string[];
    dteType: SiiDteType;
    folio: string;
    issueDate: string;
    emitterRutRaw: string;
    emitterRutNormalized: string;
    emitterRutFormatted: string;
    emitterRutValid: boolean;
    emitterName: string;
    receiverRutRaw?: string;
    receiverRutNormalized?: string;
    receiverRutValid?: boolean;
    receiverName?: string;
    netAmountClp: number;
    exemptAmountClp: number;
    vatAmountClp: number;
    totalAmountClp: number;
    lines: ParsedSiiXmlDteLine[];
    embeddedTed?: ParsedSiiTedPdf417;
    dedupeKey: string;
}

export interface RcvDeadlineResult {
    applicable: boolean;
    deadlineIso?: string;
    daysRemaining?: number;
    isOverdue: boolean;
    rcvUrgencyAlert: boolean;
}

export interface ArithmeticGuardrailResult {
    valid: boolean;
    linesSumClp: number;
    documentTotalClp: number;
    deltaClp: number;
    toleranceClp: number;
    vatCoherent: boolean;
    errors: string[];
}

export interface ValidateSiiDocumentInput {
    siiDocId: string;
    tenantId: string;
    siteId: string;
    xmlContent?: string;
    tedRawXml?: string;
    manualFallback?: {
        supplierTaxId: string;
        supplierName: string;
        receiverTaxId?: string;
        dteType: SiiDteType;
        folio: string;
        issueDate: string;
        netAmountClp?: number;
        vatAmountClp?: number;
        totalAmountClp: number;
    };
    lineSubtotalsGrossClp?: readonly number[];
    hasCapexAsset?: boolean;
    existingDedupeKeys?: readonly string[] | ReadonlySet<string>;
    referenceDateIso?: string;
    arithmeticToleranceClp?: number;
}

export interface SiiDocumentValidationOutcome {
    valid: boolean;
    isDuplicate: boolean;
    errors: string[];
    warnings: string[];
    atypicalFlags: AtypicalFlagCode[];
    arithmetic: ArithmeticGuardrailResult;
    rcvDeadline: RcvDeadlineResult;
    record: SiiDocumentRecord;
}

function decodeXmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
}

function extractXmlTagValue(xml: string, tagName: string): string | undefined {
    const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
    const match = xml.match(regex);
    if (!match) return undefined;
    return decodeXmlEntities(match[1]);
}

function extractAllXmlTagBlocks(xml: string, tagName: string): string[] {
    const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'gi');
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        blocks.push(match[1]);
    }
    return blocks;
}

function parseDteTypeCode(raw: string | number | undefined): SiiDteType | null {
    const num = Number(String(raw ?? '').trim());
    if (!Number.isInteger(num) || !VALID_SII_DTE_TYPES.has(num)) {
        return null;
    }
    return num as SiiDteType;
}

function normalizeFolio(rawFolio: string): string {
    const cleaned = String(rawFolio || '').trim().replace(/\s+/g, '');
    if (!cleaned) return '';
    if (/^\d+$/.test(cleaned)) {
        return cleaned.replace(/^0+(?=\d)/, '');
    }
    return cleaned.toUpperCase();
}

/**
 * Construye la llave determinística anti-duplicación SII:
 * `${normalizedRut}#${dteType}#${folio}` (ej. `76123456-K#33#12345`).
 */
export function buildSiiDedupeKey(rawRut: string, dteType: SiiDteType, folio: string): string {
    const rutCheck = validateChileanRut(rawRut);
    const normalizedRut = rutCheck.normalized || String(rawRut || '').replace(/[\s.]/g, '').toUpperCase();
    const normalizedFolio = normalizeFolio(folio);
    return `${normalizedRut}#${dteType}#${normalizedFolio}`;
}

export function checkSiiDuplicate(
    dedupeKey: string,
    existingDedupeKeys: readonly string[] | ReadonlySet<string> | undefined
): boolean {
    if (!existingDedupeKeys) return false;
    if (existingDedupeKeys instanceof Set) {
        return existingDedupeKeys.has(dedupeKey);
    }
    return (existingDedupeKeys as readonly string[]).includes(dedupeKey);
}

/**
 * Calcula los montos neto / IVA recuperable (crédito fiscal DTE 33) vs no recuperable (Boleta 39/41 / DTE 0).
 */
export function computeChileanVatBreakdown(params: {
    dteType: SiiDteType;
    totalAmountClp: number;
    netAmountClp?: number;
    vatAmountClp?: number;
}): {
    netAmountClp: number;
    vatAmountClp: number;
    vatRecoverableClp: number;
    vatNonRecoverableClp: number;
    totalAmountClp: number;
} {
    const total = roundClp(params.totalAmountClp);

    // Documentos exentos (DTE 34 Factura Exenta, DTE 41 Boleta Exenta) o comprobante rural sin DTE (0)
    if (params.dteType === 34 || params.dteType === 41 || params.dteType === 0) {
        return {
            netAmountClp: total,
            vatAmountClp: 0,
            vatRecoverableClp: 0,
            vatNonRecoverableClp: 0,
            totalAmountClp: total,
        };
    }

    // DTE 33 (Factura Afecta), 52 (Guía), 61 (Nota de Crédito) — IVA 19% es Crédito Fiscal recuperable
    if (params.dteType === 33 || params.dteType === 52 || params.dteType === 61) {
        const net =
            params.netAmountClp !== undefined
                ? roundClp(params.netAmountClp)
                : roundClp(total / (1 + CHILE_VAT_RATE));
        const vat =
            params.vatAmountClp !== undefined
                ? roundClp(params.vatAmountClp)
                : roundClp(total - net);
        return {
            netAmountClp: net,
            vatAmountClp: vat,
            vatRecoverableClp: vat,
            vatNonRecoverableClp: 0,
            totalAmountClp: total,
        };
    }

    // DTE 39 (Boleta Electrónica Afecta): incluye 19% IVA en el precio, pero NO da derecho a Crédito Fiscal (DL 825)
    const impliedNet =
        params.netAmountClp !== undefined
            ? roundClp(params.netAmountClp)
            : roundClp(total / (1 + CHILE_VAT_RATE));
    const impliedVat =
        params.vatAmountClp !== undefined
            ? roundClp(params.vatAmountClp)
            : roundClp(total - impliedNet);

    return {
        netAmountClp: impliedNet,
        vatAmountClp: impliedVat,
        vatRecoverableClp: 0,
        vatNonRecoverableClp: impliedVat,
        totalAmountClp: total,
    };
}

/**
 * Parsea determinísticamente un Timbre Electrónico SII (TED PDF417).
 * Formato oficial SII:
 * `<TED version="1.0"><DD><RE>...</RE><TD>...</TD><F>...</F><FE>...</FE><RR>...</RR><RSR>...</RSR><MNT>...</MNT><IT1>...</IT1>...</DD><FRMT ...>...</FRMT></TED>`
 */
export function parseSiiTedPdf417(tedRawXml: string): ParsedSiiTedPdf417 {
    const errors: string[] = [];
    const raw = String(tedRawXml || '').trim();
    const ddBlock = extractXmlTagValue(raw, 'DD') || raw;
    const frmtValue = extractXmlTagValue(raw, 'FRMT');

    const re = extractXmlTagValue(ddBlock, 'RE') || '';
    const tdRaw = extractXmlTagValue(ddBlock, 'TD') || '';
    const folioRaw = extractXmlTagValue(ddBlock, 'F') || '';
    const fe = extractXmlTagValue(ddBlock, 'FE') || '';
    const rr = extractXmlTagValue(ddBlock, 'RR');
    const rsr = extractXmlTagValue(ddBlock, 'RSR');
    const mntRaw = extractXmlTagValue(ddBlock, 'MNT') || '';
    const it1 = extractXmlTagValue(ddBlock, 'IT1');
    const tsted = extractXmlTagValue(ddBlock, 'TSTED');

    const emitterRutRes = validateChileanRut(re);
    if (!emitterRutRes.valid) {
        errors.push(`RUT Emisor TED inválido (${re || 'vacío'}): ${emitterRutRes.reason || 'formato incorrecto'}.`);
    }

    const parsedTd = parseDteTypeCode(tdRaw);
    if (parsedTd === null) {
        errors.push(`Tipo DTE (<TD>) inválido en TED: "${tdRaw}".`);
    }
    const dteType: SiiDteType = parsedTd ?? 0;

    const folio = normalizeFolio(folioRaw);
    if (!folio) {
        errors.push('Folio (<F>) ausente en TED.');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fe)) {
        errors.push(`Fecha emisión (<FE>) inválida en TED: "${fe}".`);
    }

    const totalAmountClp = Number(mntRaw.replace(/[^\d-]/g, ''));
    if (!Number.isFinite(totalAmountClp) || totalAmountClp < 0 || !mntRaw) {
        errors.push(`Monto total (<MNT>) inválido en TED: "${mntRaw}".`);
    }

    let receiverRutNormalized: string | undefined;
    let receiverRutValid: boolean | undefined;
    if (rr && rr !== '66666666-6') {
        const rrRes = validateChileanRut(rr);
        receiverRutNormalized = rrRes.normalized;
        receiverRutValid = rrRes.valid;
        if (!rrRes.valid) {
            errors.push(`RUT Receptor TED inválido (${rr}).`);
        }
    } else if (rr === '66666666-6') {
        // RUT genérico SII permitido en Boletas Electrónicas a consumidor final
        receiverRutNormalized = '66666666-6';
        receiverRutValid = true;
    }

    const tedSignaturePresent = Boolean(frmtValue && frmtValue.length >= 8);
    if (!tedSignaturePresent) {
        errors.push('Firma electrónica <FRMT> ausente o truncada en TED.');
    }

    const dedupeKey = buildSiiDedupeKey(re, dteType, folio);

    return {
        valid: errors.length === 0,
        errors,
        emitterRutRaw: re,
        emitterRutNormalized: emitterRutRes.normalized,
        emitterRutFormatted: emitterRutRes.formatted,
        emitterRutValid: emitterRutRes.valid,
        dteType,
        folio,
        issueDate: fe,
        receiverRutRaw: rr,
        receiverRutNormalized,
        receiverRutValid,
        receiverName: rsr,
        totalAmountClp: Number.isFinite(totalAmountClp) ? roundClp(totalAmountClp) : 0,
        firstItemSummary: it1,
        tedTimestamp: tsted,
        tedSignaturePresent,
        dedupeKey,
    };
}

/**
 * Parsea determinísticamente un documento tributario XML DTE del SII Chile.
 */
export function parseSiiXmlDte(xmlString: string): ParsedSiiXmlDte {
    const errors: string[] = [];
    const xml = String(xmlString || '').trim();

    const idDocBlock = extractXmlTagValue(xml, 'IdDoc') || xml;
    const emisorBlock = extractXmlTagValue(xml, 'Emisor') || xml;
    const receptorBlock = extractXmlTagValue(xml, 'Receptor') || '';
    const totalesBlock = extractXmlTagValue(xml, 'Totales') || xml;

    const tipoDteRaw = extractXmlTagValue(idDocBlock, 'TipoDTE');
    const folioRaw = extractXmlTagValue(idDocBlock, 'Folio') || '';
    const fchEmis = extractXmlTagValue(idDocBlock, 'FchEmis') || '';

    const rutEmisorRaw = extractXmlTagValue(emisorBlock, 'RUTEmisor') || '';
    const rznSoc =
        extractXmlTagValue(emisorBlock, 'RznSoc') ||
        extractXmlTagValue(emisorBlock, 'RznSocEmisor') ||
        '';

    const rutRecepRaw = receptorBlock ? extractXmlTagValue(receptorBlock, 'RUTRecep') : undefined;
    const rznSocRecep = receptorBlock ? extractXmlTagValue(receptorBlock, 'RznSocRecep') : undefined;

    const mntNeto = Number(extractXmlTagValue(totalesBlock, 'MntNeto') || '0');
    const mntExe = Number(extractXmlTagValue(totalesBlock, 'MntExe') || '0');
    const iva = Number(extractXmlTagValue(totalesBlock, 'IVA') || '0');
    const mntTotalRaw = extractXmlTagValue(totalesBlock, 'MntTotal');
    const mntTotal = Number(mntTotalRaw || '0');

    const parsedDte = parseDteTypeCode(tipoDteRaw);
    if (parsedDte === null) {
        errors.push(`TipoDTE inválido en XML DTE: "${tipoDteRaw || ''}".`);
    }
    const dteType: SiiDteType = parsedDte ?? 0;

    const folio = normalizeFolio(folioRaw);
    if (!folio) errors.push('Folio ausente en XML DTE.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fchEmis)) {
        errors.push(`FchEmis inválida en XML DTE: "${fchEmis}".`);
    }

    const emitterRutRes = validateChileanRut(rutEmisorRaw);
    if (!emitterRutRes.valid) {
        errors.push(`RUTEmisor inválido (${rutEmisorRaw}): ${emitterRutRes.reason || ''}`);
    }

    let receiverRutNormalized: string | undefined;
    let receiverRutValid: boolean | undefined;
    if (rutRecepRaw) {
        if (rutRecepRaw === '66666666-6') {
            receiverRutNormalized = '66666666-6';
            receiverRutValid = true;
        } else {
            const rr = validateChileanRut(rutRecepRaw);
            receiverRutNormalized = rr.normalized;
            receiverRutValid = rr.valid;
            if (!rr.valid) errors.push(`RUTRecep inválido (${rutRecepRaw}).`);
        }
    }

    if (!mntTotalRaw || !Number.isFinite(mntTotal) || mntTotal < 0) {
        errors.push(`MntTotal inválido en XML DTE: "${mntTotalRaw || ''}".`);
    }

    const detailBlocks = extractAllXmlTagBlocks(xml, 'Detalle');
    const lines: ParsedSiiXmlDteLine[] = detailBlocks.map((block, idx) => {
        const nro = Number(extractXmlTagValue(block, 'NroLinDet') || String(idx + 1));
        const name = extractXmlTagValue(block, 'NmbItem') || `Ítem ${idx + 1}`;
        const qty = Number(extractXmlTagValue(block, 'QtyItem') || '1');
        const prc = Number(extractXmlTagValue(block, 'PrcItem') || '0');
        const monto = Number(extractXmlTagValue(block, 'MontoItem') || '0');
        return {
            lineNumber: Number.isFinite(nro) ? nro : idx + 1,
            name,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            unitPriceClp: Number.isFinite(prc) ? roundClp(prc) : 0,
            subtotalClp: Number.isFinite(monto) ? roundClp(monto) : 0,
        };
    });

    const tedMatch = xml.match(/<TED\b[\s\S]*?<\/TED>/i);
    const embeddedTed = tedMatch ? parseSiiTedPdf417(tedMatch[0]) : undefined;

    const dedupeKey = buildSiiDedupeKey(rutEmisorRaw, dteType, folio);

    return {
        valid: errors.length === 0,
        errors,
        dteType,
        folio,
        issueDate: fchEmis,
        emitterRutRaw: rutEmisorRaw,
        emitterRutNormalized: emitterRutRes.normalized,
        emitterRutFormatted: emitterRutRes.formatted,
        emitterRutValid: emitterRutRes.valid,
        emitterName: rznSoc,
        receiverRutRaw: rutRecepRaw,
        receiverRutNormalized,
        receiverRutValid,
        receiverName: rznSocRecep,
        netAmountClp: Number.isFinite(mntNeto) ? roundClp(mntNeto) : 0,
        exemptAmountClp: Number.isFinite(mntExe) ? roundClp(mntExe) : 0,
        vatAmountClp: Number.isFinite(iva) ? roundClp(iva) : 0,
        totalAmountClp: Number.isFinite(mntTotal) ? roundClp(mntTotal) : 0,
        lines,
        embeddedTed,
        dedupeKey,
    };
}

/**
 * Calcula el plazo legal de 8 días corridos de aceptación o reclamo en el Registro de Compras y Ventas (RCV)
 * conforme a la Ley N° 19.983 para Facturas Electrónicas (DTE 33 y 34).
 */
export function computeRcvAcceptanceDeadline(
    issueDateIso: string,
    dteType: SiiDteType,
    referenceDateIso?: string
): RcvDeadlineResult {
    if (dteType !== 33 && dteType !== 34) {
        return {
            applicable: false,
            isOverdue: false,
            rcvUrgencyAlert: false,
        };
    }

    const issueMatch = String(issueDateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!issueMatch) {
        return {
            applicable: true,
            isOverdue: false,
            rcvUrgencyAlert: true,
        };
    }

    const issueUtcMs = Date.UTC(
        Number(issueMatch[1]),
        Number(issueMatch[2]) - 1,
        Number(issueMatch[3])
    );
    const deadlineUtcMs = issueUtcMs + LEY_19983_RCV_DAYS * 86_400_000;
    const deadlineDate = new Date(deadlineUtcMs);
    const deadlineIso = deadlineDate.toISOString().slice(0, 10);

    const refDateStr = (referenceDateIso || new Date().toISOString()).slice(0, 10);
    const refMatch = refDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const refUtcMs = refMatch
        ? Date.UTC(Number(refMatch[1]), Number(refMatch[2]) - 1, Number(refMatch[3]))
        : Date.now();

    const daysRemaining = Math.floor((deadlineUtcMs - refUtcMs) / 86_400_000);
    const isOverdue = daysRemaining < 0;
    const rcvUrgencyAlert = daysRemaining <= 2;

    return {
        applicable: true,
        deadlineIso,
        daysRemaining,
        isOverdue,
        rcvUrgencyAlert,
    };
}

/**
 * Guardrail aritmético determinístico:
 * Verifica que `sum(lineSubtotals) === documentTotal` dentro de la tolerancia de redondeo (±2 CLP).
 */
export function verifyDocumentArithmetic(params: {
    lineSubtotalsClp: readonly number[];
    documentTotalClp: number;
    dteType?: SiiDteType;
    netAmountClp?: number;
    vatAmountClp?: number;
    toleranceClp?: number;
}): ArithmeticGuardrailResult {
    const toleranceClp = params.toleranceClp ?? DEFAULT_ARITHMETIC_TOLERANCE_CLP;
    const linesSumClp = roundClp(
        params.lineSubtotalsClp.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0)
    );
    const documentTotalClp = roundClp(params.documentTotalClp);
    const deltaClp = roundClp(linesSumClp - documentTotalClp);
    const errors: string[] = [];

    if (params.lineSubtotalsClp.length > 0 && Math.abs(deltaClp) > toleranceClp) {
        errors.push(
            `Descuadre aritmético en líneas: suma CLP ${linesSumClp} vs total documento CLP ${documentTotalClp} (diferencia CLP ${deltaClp}, tolerancia ±${toleranceClp}).`
        );
    }

    let vatCoherent = true;
    if (
        params.dteType === 33 &&
        params.netAmountClp !== undefined &&
        params.vatAmountClp !== undefined
    ) {
        const expectedVat = roundClp(params.netAmountClp * CHILE_VAT_RATE);
        const netPlusVatDelta = Math.abs(params.netAmountClp + params.vatAmountClp - documentTotalClp);
        const vatDelta = Math.abs(params.vatAmountClp - expectedVat);
        if (netPlusVatDelta > toleranceClp || vatDelta > Math.max(toleranceClp, 5)) {
            vatCoherent = false;
            errors.push(
                `IVA 19% incoherente en DTE 33: neto ${params.netAmountClp} + IVA ${params.vatAmountClp} vs total ${documentTotalClp} (IVA esperado ${expectedVat}).`
            );
        }
    }

    return {
        valid: errors.length === 0,
        linesSumClp,
        documentTotalClp,
        deltaClp,
        toleranceClp,
        vatCoherent,
        errors,
    };
}

/**
 * Valida íntegramente un documento tributario SII (XML DTE, TED PDF417 o manual/OCR),
 * aplicando anti-duplicación, plazo RCV 8 días, alerta CAPEX sin factura y guardrail aritmético.
 */
export function validateSiiDocumentForPurchase(
    input: ValidateSiiDocumentInput
): SiiDocumentValidationOutcome {
    const errors: string[] = [];
    const warnings: string[] = [];
    const atypicalFlags: AtypicalFlagCode[] = [];

    let sourceFormat: SiiDocumentRecord['sourceFormat'] = 'MANUAL_OR_OCR';
    let supplierTaxIdRaw = '';
    let supplierName = '';
    let receiverTaxId: string | undefined;
    let dteType: SiiDteType = 0;
    let folio = '';
    let issueDate = '';
    let rawNet: number | undefined;
    let rawVat: number | undefined;
    let totalAmountClp = 0;
    let tedVerified = false;
    let lineSubtotalsForCheck: number[] = input.lineSubtotalsGrossClp
        ? [...input.lineSubtotalsGrossClp]
        : [];

    if (input.xmlContent && input.xmlContent.trim()) {
        sourceFormat = 'XML_DTE';
        const parsedXml = parseSiiXmlDte(input.xmlContent);
        errors.push(...parsedXml.errors);
        supplierTaxIdRaw = parsedXml.emitterRutRaw;
        supplierName = parsedXml.emitterName || input.manualFallback?.supplierName || '';
        receiverTaxId = parsedXml.receiverRutNormalized;
        dteType = parsedXml.dteType;
        folio = parsedXml.folio;
        issueDate = parsedXml.issueDate;
        rawNet = parsedXml.netAmountClp || parsedXml.exemptAmountClp;
        rawVat = parsedXml.vatAmountClp;
        totalAmountClp = parsedXml.totalAmountClp;
        tedVerified = Boolean(parsedXml.embeddedTed?.valid);

        // Si el caller no entregó subtotales explícitos, usar las líneas del XML (en DTE 33 los Detalles son netos)
        if (lineSubtotalsForCheck.length === 0 && parsedXml.lines.length > 0) {
            const sumNet = parsedXml.lines.reduce((s, l) => s + l.subtotalClp, 0);
            lineSubtotalsForCheck =
                dteType === 33 ? [roundClp(sumNet + parsedXml.vatAmountClp)] : parsedXml.lines.map((l) => l.subtotalClp);
        }
    } else if (input.tedRawXml && input.tedRawXml.trim()) {
        sourceFormat = 'TED_PDF417';
        const parsedTed = parseSiiTedPdf417(input.tedRawXml);
        errors.push(...parsedTed.errors);
        supplierTaxIdRaw = parsedTed.emitterRutRaw;
        supplierName = input.manualFallback?.supplierName || parsedTed.firstItemSummary || 'Emisor TED SII';
        receiverTaxId = parsedTed.receiverRutNormalized;
        dteType = parsedTed.dteType;
        folio = parsedTed.folio;
        issueDate = parsedTed.issueDate;
        totalAmountClp = parsedTed.totalAmountClp;
        tedVerified = parsedTed.valid && parsedTed.tedSignaturePresent;
    } else if (input.manualFallback) {
        sourceFormat = 'MANUAL_OR_OCR';
        supplierTaxIdRaw = input.manualFallback.supplierTaxId;
        supplierName = input.manualFallback.supplierName;
        receiverTaxId = input.manualFallback.receiverTaxId;
        dteType = input.manualFallback.dteType;
        folio = normalizeFolio(input.manualFallback.folio);
        issueDate = input.manualFallback.issueDate;
        rawNet = input.manualFallback.netAmountClp;
        rawVat = input.manualFallback.vatAmountClp;
        totalAmountClp = input.manualFallback.totalAmountClp;
    } else {
        errors.push('No se proporcionó XML DTE, TED PDF417 ni cabecera manual para validación SII.');
    }

    const rutCheck = validateChileanRut(supplierTaxIdRaw);
    if (!rutCheck.valid && !errors.some((e) => e.includes('RUT'))) {
        errors.push(`RUT proveedor inválido (${supplierTaxIdRaw}): ${rutCheck.reason || ''}`);
    }

    const dedupeKey = buildSiiDedupeKey(supplierTaxIdRaw, dteType, folio);
    const isDuplicate = checkSiiDuplicate(dedupeKey, input.existingDedupeKeys);
    if (isDuplicate) {
        errors.push(`Documento duplicado detectado en el tenant (${dedupeKey}).`);
    }

    const vat = computeChileanVatBreakdown({
        dteType,
        totalAmountClp,
        netAmountClp: rawNet,
        vatAmountClp: rawVat,
    });

    const arithmetic = verifyDocumentArithmetic({
        lineSubtotalsClp: lineSubtotalsForCheck,
        documentTotalClp: totalAmountClp,
        dteType,
        netAmountClp: rawNet !== undefined ? vat.netAmountClp : undefined,
        vatAmountClp: rawVat !== undefined ? vat.vatAmountClp : undefined,
        toleranceClp: input.arithmeticToleranceClp,
    });
    if (!arithmetic.valid) {
        errors.push(...arithmetic.errors);
    }

    const rcvDeadline = computeRcvAcceptanceDeadline(issueDate, dteType, input.referenceDateIso);
    if (rcvDeadline.applicable && rcvDeadline.rcvUrgencyAlert) {
        warnings.push(
            rcvDeadline.isOverdue
                ? `Plazo RCV Ley N° 19.983 vencido (${rcvDeadline.deadlineIso}).`
                : `Quedan ${rcvDeadline.daysRemaining} día(s) para aceptar/reclamar en RCV SII (vence ${rcvDeadline.deadlineIso}).`
        );
    }

    // Regla tributaria crítica: activo CAPEX respaldado por Boleta (39/41) o informal (0) sin Factura (33/34)
    if (input.hasCapexAsset && dteType !== 33 && dteType !== 34) {
        atypicalFlags.push('ATYPICAL_ASSET_WITHOUT_INVOICE');
        warnings.push(
            `Activo CAPEX respaldado con DTE ${dteType} (sin Factura Electrónica 33/34): pérdida de Crédito Fiscal IVA y observación tributaria Art. 31 N° 5 LIR.`
        );
    }

    const record: SiiDocumentRecord = {
        siiDocId: input.siiDocId,
        tenantId: input.tenantId,
        siteId: input.siteId,
        dedupeKey,
        supplierTaxId: rutCheck.normalized,
        supplierTaxIdFormatted: rutCheck.formatted,
        supplierName,
        receiverTaxId,
        dteType,
        folio: normalizeFolio(folio),
        issueDate,
        netAmountClp: vat.netAmountClp,
        vatAmountClp: vat.vatAmountClp,
        vatRecoverableClp: vat.vatRecoverableClp,
        vatNonRecoverableClp: vat.vatNonRecoverableClp,
        totalAmountClp: vat.totalAmountClp,
        rcvAcceptanceDeadlineIso: rcvDeadline.deadlineIso,
        rcvDaysRemaining: rcvDeadline.daysRemaining,
        rcvUrgencyAlert: rcvDeadline.rcvUrgencyAlert,
        sourceFormat,
        tedVerified,
        atypicalFlags,
        arithmeticValid: arithmetic.valid,
        arithmeticDeltaClp: arithmetic.deltaClp,
    };

    return {
        valid: errors.length === 0,
        isDuplicate,
        errors,
        warnings,
        atypicalFlags,
        arithmetic,
        rcvDeadline,
        record,
    };
}

function escapeCsvCell(rawValue: string | number | boolean | undefined, delimiter: string): string {
    let str = rawValue === undefined || rawValue === null ? '' : String(rawValue);
    // Protección contra inyección de fórmulas en hojas de cálculo (=, +, -, @)
    if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
    }
    const needsQuotes =
        str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r');
    if (!needsQuotes) return str;
    return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Genera exportación CSV lista para contador chileno / conciliación RCV SII (delimitador `;` por defecto).
 */
export function exportSiiDocumentsToAccountantCsv(
    documents: readonly SiiDocumentRecord[],
    options?: { delimiter?: ';' | ',' }
): string {
    const delimiter = options?.delimiter || ';';
    const headers = [
        'DEDUPE_KEY',
        'TIPO_DTE',
        'FOLIO',
        'FECHA_EMISION',
        'RUT_PROVEEDOR',
        'RAZON_SOCIAL',
        'MONTO_NETO_CLP',
        'IVA_CREDITO_RECUPERABLE_CLP',
        'IVA_NO_RECUPERABLE_CLP',
        'MONTO_TOTAL_CLP',
        'PLAZO_RCV_8D',
        'ALERTA_RCV',
        'ORIGEN_SII',
        'TED_VERIFICADO',
        'BANDERAS_ATIPICAS',
    ];

    const rows = [headers.join(delimiter)];

    for (const doc of documents) {
        const cells = [
            doc.dedupeKey,
            doc.dteType,
            doc.folio,
            doc.issueDate,
            doc.supplierTaxIdFormatted,
            doc.supplierName,
            doc.netAmountClp,
            doc.vatRecoverableClp,
            doc.vatNonRecoverableClp,
            doc.totalAmountClp,
            doc.rcvAcceptanceDeadlineIso || '',
            doc.rcvUrgencyAlert ? 'SI' : 'NO',
            doc.sourceFormat,
            doc.tedVerified ? 'SI' : 'NO',
            doc.atypicalFlags.join('|'),
        ].map((v) => escapeCsvCell(v, delimiter));

        rows.push(cells.join(delimiter));
    }

    return rows.join('\n');
}
