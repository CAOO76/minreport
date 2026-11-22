import crypto from 'crypto';
import zlib from 'zlib';
import {
    type CanonicalSupplySku,
    type IsoCurrencyCode,
    type MoneyAmount,
    type SiiDocumentRecord,
    type SiiExpenseReport,
    type SupplyPurchase,
    type SupplyUnitSi,
    type TaxIdentifier,
    type TaxIdentifierScheme,
    type UnCefactRec20Code,
    UNIT_SI_TO_UNCEFACT_REC20,
} from '../application/supply.types';
import {
    ACCOUNTING_EXPORT_FORMATS,
    ACCOUNTING_EXPORT_PROFILES,
    type AccountingExportDocumentLine,
    type AccountingExportFormat,
    type AccountingExportInput,
    type AccountingExportProfile,
    type AccountingExportResult,
    type IAccountingExportAdapter,
} from '../ports/IAccountingExportAdapter';

/**
 * EXPORTADOR CONTABLE INTERNACIONAL MULTI-FORMATO (MINREPORT · ABASTECIMIENTO)
 *
 * 100% determinista utilizando exclusivamente módulos nativos de Node.js (`crypto`, `zlib`).
 * Soporta 6 formatos estándar (`UBL_2_1_PEPPOL`, `SAFT_OECD`, `ISO_20022_PAIN001`,
 * `JSON_SCHEMA_V2`, `CSV_RFC4180`, `XLSX_OOXML`) y 13 perfiles contables (6 Chile + 7 Global ERP).
 * Aplica escape estricto XML y neutralización OWASP contra CSV/Excel Formula Injection.
 */

const ZERO_DECIMAL_CURRENCIES = new Set<string>(['CLP', 'JPY', 'KRW', 'PYG', 'VND']);

function resolveMinorUnitDigits(currencyCode: IsoCurrencyCode): number {
    return ZERO_DECIMAL_CURRENCIES.has(currencyCode.toUpperCase()) ? 0 : 2;
}

function formatIsoMoneyDecimal(amountMinor: number, currencyCode: IsoCurrencyCode): string {
    const digits = resolveMinorUnitDigits(currencyCode);
    const rounded = Math.round(Number(amountMinor) || 0);
    if (digits === 0) return String(rounded);
    return (rounded / Math.pow(10, digits)).toFixed(digits);
}

function inferTaxIdentifierScheme(countryCode: string): TaxIdentifierScheme {
    const cc = countryCode.trim().toUpperCase();
    switch (cc) {
        case 'CL':
            return 'CL_RUT';
        case 'PE':
            return 'PE_RUC';
        case 'BR':
            return 'BR_CNPJ';
        case 'MX':
            return 'MX_RFC';
        case 'CO':
            return 'CO_NIT';
        case 'AR':
            return 'AR_CUIT';
        case 'AU':
            return 'AU_ABN';
        case 'US':
            return 'US_EIN';
        default:
            return 'INTL_TIN';
    }
}

function buildTaxIdentifier(rawTaxId: string, countryCode: string): TaxIdentifier {
    const cc = /^[A-Z]{2}$/.test(countryCode.trim().toUpperCase())
        ? countryCode.trim().toUpperCase()
        : 'CL';
    const raw = String(rawTaxId || 'NOT_DECLARED').trim() || 'NOT_DECLARED';
    const normalized = raw.replace(/[\s.]/g, '').toUpperCase();
    return {
        countryCode: cc,
        scheme: inferTaxIdentifierScheme(cc),
        value: raw,
        normalized,
    };
}

function buildMoneyAmount(amountMinor: number, currencyCode: IsoCurrencyCode): MoneyAmount {
    return {
        amountMinor: Math.round(Number(amountMinor) || 0),
        currencyCode,
        minorUnitDigits: resolveMinorUnitDigits(currencyCode),
    };
}

/**
 * Escape estricto XML 1.0 eliminando caracteres de control prohibidos.
 */
export function escapeXml(raw: unknown): string {
    return String(raw ?? '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Neutralización OWASP anti-inyección de fórmulas para CSV y XLSX:
 * Cualquier celda de texto que comience (aun tras espacios/tabs/CR iniciales) con
 * `=`, `+`, `-`, `@`, `\t`, `\r` o `|` —exceptuando literales numéricos puros negativos
 * o positivos sin operadores— es neutralizada con apóstrofo inicial `'`.
 */
export function neutralizeSpreadsheetFormula(raw: unknown): string {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return String(raw);
    }
    const str = String(raw ?? '');
    if (!str) return '';

    const startsWithControlPrefix = /^[\t\r\n]/.test(str);
    const trimmedLeading = str.replace(/^[\s\t\r\n\u00A0]+/, '');
    const startsWithFormulaTrigger = /^[=+\-@|]/.test(trimmedLeading);
    const isPureSignedNumeric = /^-?\d+(?:\.\d+)?$/.test(str.trim()) && !startsWithControlPrefix;

    if ((startsWithControlPrefix || startsWithFormulaTrigger) && !isPureSignedNumeric) {
        return `'${str}`;
    }
    return str;
}

/**
 * Formatea una celda conforme a RFC 4180 con neutralización anti-inyección de fórmulas OWASP.
 */
export function formatCsvCellRfc4180(raw: unknown, delimiter: ',' | ';' = ','): string {
    const safe = neutralizeSpreadsheetFormula(raw);
    const escapedQuotes = safe.replace(/"/g, '""');
    const needsQuoting =
        escapedQuotes.includes(delimiter) ||
        escapedQuotes.includes('"') ||
        escapedQuotes.includes('\r') ||
        escapedQuotes.includes('\n') ||
        escapedQuotes.includes('|') ||
        escapedQuotes.includes('\t');
    return needsQuoting ? `"${escapedQuotes}"` : escapedQuotes;
}

// ---------------------------------------------------------------------------
// Enriquecimiento normalizado de documentos + líneas de compra + catálogo
// ---------------------------------------------------------------------------

interface EnrichedAccountingDocument {
    doc: SiiDocumentRecord & { retentionUntil?: string };
    purchase?: SupplyPurchase;
    costCenter: string;
    isCapex: boolean;
    lines: AccountingExportDocumentLine[];
}

function mapUnitToUnCefact(unitSi: SupplyUnitSi | string | undefined): UnCefactRec20Code {
    if (unitSi && unitSi in UNIT_SI_TO_UNCEFACT_REC20) {
        return UNIT_SI_TO_UNCEFACT_REC20[unitSi as SupplyUnitSi];
    }
    return 'EA';
}

function enrichDocuments(input: AccountingExportInput): EnrichedAccountingDocument[] {
    const purchaseById = new Map<string, SupplyPurchase>();
    for (const pur of input.purchases || []) {
        purchaseById.set(pur.purchaseId, pur);
    }
    const catalog = input.catalogBySkuId || {};

    return (input.documents || []).map((doc) => {
        const purchase = doc.purchaseId ? purchaseById.get(doc.purchaseId) : undefined;
        const lines: AccountingExportDocumentLine[] =
            purchase && Array.isArray(purchase.lines) && purchase.lines.length > 0
                ? purchase.lines.map((line) => {
                      const skuMeta: Partial<CanonicalSupplySku> | undefined =
                          catalog[line.canonicalSkuId];
                      return {
                          lineId: line.purchaseLineId,
                          canonicalSkuId: line.canonicalSkuId,
                          description: line.description,
                          categoryCode: line.categoryCode,
                          unitSi: line.unitSi,
                          unCefactCode: skuMeta?.unCefactCode || mapUnitToUnCefact(line.unitSi),
                          unspscCode: skuMeta?.unspscCode,
                          gtin: skuMeta?.gtin,
                          qty: line.qtyPurchased,
                          unitPriceMinor: Math.round(line.unitPriceClp),
                          subtotalMinor: Math.round(line.subtotalClp),
                          costCenter: line.costCenter || 'CC-CAMPAMENTO',
                          isCapexAsset: Boolean(line.isCapexAsset || line.destination === 'CAPEX_ASSET'),
                      };
                  })
                : [
                      {
                          lineId: `line_${doc.docId}`,
                          canonicalSkuId: `dte-${doc.documentType}-${doc.folio}`,
                          description: `${doc.supplierName} · DTE ${doc.documentType} #${doc.folio}`,
                          categoryCode: doc.missingInvoiceForCapex
                              ? 'ACTIVO_EQUIPAMIENTO'
                              : 'OTROS_OPERACIONAL',
                          unitSi: 'un',
                          unCefactCode: 'EA',
                          qty: 1,
                          unitPriceMinor: Math.round(doc.netAmountClp),
                          subtotalMinor: Math.round(doc.netAmountClp),
                          costCenter: doc.missingInvoiceForCapex ? 'CC-CAPEX' : 'CC-CAMPAMENTO',
                          isCapexAsset: Boolean(doc.missingInvoiceForCapex),
                      },
                  ];

        const primaryCostCenter = lines[0]?.costCenter || 'CC-CAMPAMENTO';
        const isCapex = lines.some((l) => l.isCapexAsset) || Boolean(doc.missingInvoiceForCapex);

        return {
            doc: doc as SiiDocumentRecord & { retentionUntil?: string },
            purchase,
            costCenter: primaryCostCenter,
            isCapex,
            lines,
        };
    });
}

// ---------------------------------------------------------------------------
// Proyección Tabular por Perfil (6 Chile + 7 Global ERP)
// ---------------------------------------------------------------------------

interface TabularExportMatrix {
    headers: string[];
    rows: Array<Array<string | number>>;
    csvDelimiter: ',' | ';';
}

function buildTabularMatrixForProfile(
    profile: AccountingExportProfile,
    enrichedDocs: EnrichedAccountingDocument[],
    currencyCode: IsoCurrencyCode,
    tenantId: string
): TabularExportMatrix {
    switch (profile) {
        case 'CL_SII_RCV':
            return {
                csvDelimiter: ';',
                headers: [
                    'TIPO_DTE',
                    'FOLIO',
                    'RUT_EMISOR',
                    'RAZON_SOCIAL',
                    'FECHA_EMISION',
                    'MONTO_NETO_CLP',
                    'MONTO_IVA_CLP',
                    'IVA_RECUPERABLE_CLP',
                    'MONTO_TOTAL_CLP',
                    'ESTADO_RCV',
                    'LIMITE_RCV_8D',
                    'CAPEX_SIN_FACTURA',
                    'CAS_SHA256',
                ],
                rows: enrichedDocs.map(({ doc }) => [
                    doc.documentType,
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.vatCreditRecoverableClp,
                    doc.totalAmountClp,
                    doc.rcvStatus,
                    doc.rcvDeadlineDate || '',
                    doc.missingInvoiceForCapex ? 'SI' : 'NO',
                    doc.evidenceCasRef?.sha256 || '',
                ]),
            };

        case 'CL_CHIPAX':
            return {
                csvDelimiter: ';',
                headers: [
                    'CHIPAX_TIPO_DOC',
                    'CHIPAX_FOLIO',
                    'CHIPAX_RUT_PROVEEDOR',
                    'CHIPAX_PROVEEDOR',
                    'CHIPAX_FECHA',
                    'CHIPAX_MONEDA',
                    'CHIPAX_NETO',
                    'CHIPAX_IVA',
                    'CHIPAX_TOTAL',
                    'CHIPAX_CENTRO_COSTO',
                    'CHIPAX_REFERENCIA',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    `DTE_${doc.documentType}`,
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    doc.dedupeKey,
                ]),
            };

        case 'CL_CLAY':
            return {
                csvDelimiter: ';',
                headers: [
                    'CLAY_DTE',
                    'CLAY_NUMERO',
                    'CLAY_RUT',
                    'CLAY_RAZON_SOCIAL',
                    'CLAY_FECHA_EMISION',
                    'CLAY_NETO',
                    'CLAY_IVA',
                    'CLAY_TOTAL',
                    'CLAY_ESTADO_RCV',
                    'CLAY_CUENTA_CONTABLE',
                ],
                rows: enrichedDocs.map(({ doc, isCapex }) => [
                    doc.documentType,
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    doc.rcvStatus,
                    isCapex ? '120101-ACTIVO-FIJO' : '510101-ABASTECIMIENTO',
                ]),
            };

        case 'CL_DEFONTANA':
            return {
                csvDelimiter: ';',
                headers: [
                    'DEF_TIPO_DOC',
                    'DEF_FOLIO',
                    'DEF_RUT_PROV',
                    'DEF_PROVEEDOR',
                    'DEF_FECHA',
                    'DEF_MONEDA',
                    'DEF_NETO',
                    'DEF_IVA',
                    'DEF_TOTAL',
                    'DEF_CCOSTO',
                    'DEF_GLOSA',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    doc.documentType === 33 ? 'FAC' : doc.documentType === 61 ? 'NC' : `DTE${doc.documentType}`,
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    `MINREPORT ${doc.siteId} ${doc.dedupeKey}`,
                ]),
            };

        case 'CL_NUBOX':
            return {
                csvDelimiter: ';',
                headers: [
                    'NUBOX_TIPO_DTE',
                    'NUBOX_FOLIO',
                    'NUBOX_RUT',
                    'NUBOX_PROVEEDOR',
                    'NUBOX_FECHA',
                    'NUBOX_AFECTO',
                    'NUBOX_IVA',
                    'NUBOX_TOTAL',
                    'NUBOX_RCV',
                ],
                rows: enrichedDocs.map(({ doc }) => [
                    doc.documentType,
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    doc.rcvStatus,
                ]),
            };

        case 'CL_SOFTLAND':
            return {
                csvDelimiter: ';',
                headers: [
                    'SOFTLAND_COD_DOC',
                    'SOFTLAND_NUM_DOC',
                    'SOFTLAND_AUX_RUT',
                    'SOFTLAND_AUX_NOM',
                    'SOFTLAND_FEC_EMI',
                    'SOFTLAND_NETO',
                    'SOFTLAND_IVA',
                    'SOFTLAND_TOTAL',
                    'SOFTLAND_CCOSTO',
                    'SOFTLAND_GLOSA',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    String(doc.documentType).padStart(2, '0'),
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    `${doc.supplierName} #${doc.folio}`,
                ]),
            };

        case 'GLOBAL_SAP_S4HANA':
            return {
                csvDelimiter: ',',
                headers: [
                    'BUKRS',
                    'BLART',
                    'XBLNR',
                    'LIFNR_TAXID',
                    'VENDOR_NAME',
                    'BLDAT',
                    'WAERS',
                    'NETWR',
                    'MWSKZ_AMT',
                    'WRBTR',
                    'KOSTL',
                    'UNCEFACT_UOM',
                ],
                rows: enrichedDocs.map(({ doc, costCenter, lines }) => [
                    tenantId.slice(0, 16).toUpperCase(),
                    doc.documentType === 61 ? 'KG' : 'KR',
                    `${doc.documentType}-${doc.folio}`,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    lines[0]?.unCefactCode || 'EA',
                ]),
            };

        case 'GLOBAL_NETSUITE':
            return {
                csvDelimiter: ',',
                headers: [
                    'ExternalID',
                    'TranDate',
                    'VendorTaxID',
                    'VendorName',
                    'TranID',
                    'Currency',
                    'NetAmount',
                    'TaxAmount',
                    'GrossAmount',
                    'Department_CostCenter',
                    'Memo',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    doc.dedupeKey,
                    doc.issueDate,
                    doc.supplierTaxId,
                    doc.supplierName,
                    String(doc.folio),
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    `MINREPORT Supply ${doc.siteId}`,
                ]),
            };

        case 'GLOBAL_DYNAMICS_365':
            return {
                csvDelimiter: ',',
                headers: [
                    'JournalBatch',
                    'DocumentType',
                    'InvoiceNumber',
                    'VendorTaxId',
                    'VendorName',
                    'InvoiceDate',
                    'CurrencyCode',
                    'NetAmount',
                    'SalesTaxAmount',
                    'InvoiceAmount',
                    'FinancialDimension_CC',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    `MR-SUP-${doc.issueDate.slice(0, 7)}`,
                    `DTE-${doc.documentType}`,
                    String(doc.folio),
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                ]),
            };

        case 'GLOBAL_PRONTO_XI':
            return {
                csvDelimiter: ',',
                headers: [
                    'PRONTO_SUPPLIER_TAX',
                    'PRONTO_SUPPLIER',
                    'PRONTO_INV_NO',
                    'PRONTO_INV_DATE',
                    'PRONTO_CURR',
                    'PRONTO_NET',
                    'PRONTO_TAX',
                    'PRONTO_GROSS',
                    'PRONTO_COST_CENTRE',
                    'PRONTO_SITE',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    doc.supplierTaxId,
                    doc.supplierName,
                    `${doc.documentType}-${doc.folio}`,
                    doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    doc.siteId,
                ]),
            };

        case 'GLOBAL_XERO':
            return {
                csvDelimiter: ',',
                headers: [
                    'ContactName',
                    'ContactTaxNumber',
                    'InvoiceNumber',
                    'InvoiceDate',
                    'DueDate',
                    'Currency',
                    'SubTotal',
                    'TotalTax',
                    'Total',
                    'TrackingName1',
                    'Description',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    doc.supplierName,
                    doc.supplierTaxId,
                    `DTE${doc.documentType}-${doc.folio}`,
                    doc.issueDate,
                    doc.rcvDeadlineDate || doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    `MINREPORT ${doc.siteId}`,
                ]),
            };

        case 'GLOBAL_QUICKBOOKS':
            return {
                csvDelimiter: ',',
                headers: [
                    'BillNo',
                    'Vendor',
                    'VendorTaxId',
                    'BillDate',
                    'DueDate',
                    'Currency',
                    'AmountNet',
                    'TaxAmount',
                    'TotalAmount',
                    'Class_CostCenter',
                    'Memo',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    `${doc.documentType}-${doc.folio}`,
                    doc.supplierName,
                    doc.supplierTaxId,
                    doc.issueDate,
                    doc.rcvDeadlineDate || doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.totalAmountClp,
                    costCenter,
                    `MINREPORT Supply ${doc.dedupeKey}`,
                ]),
            };

        case 'GLOBAL_STANDARD':
        default:
            return {
                csvDelimiter: ',',
                headers: [
                    'DEDUPE_KEY',
                    'DOCUMENT_TYPE',
                    'DOCUMENT_NUMBER',
                    'SUPPLIER_TAX_ID',
                    'SUPPLIER_NAME',
                    'ISSUE_DATE',
                    'CURRENCY',
                    'NET_AMOUNT',
                    'TAX_AMOUNT',
                    'RECOVERABLE_TAX',
                    'TOTAL_AMOUNT',
                    'COST_CENTER',
                    'CAS_SHA256',
                ],
                rows: enrichedDocs.map(({ doc, costCenter }) => [
                    doc.dedupeKey,
                    doc.documentType,
                    doc.folio,
                    doc.supplierTaxId,
                    doc.supplierName,
                    doc.issueDate,
                    currencyCode,
                    doc.netAmountClp,
                    doc.vatAmountClp,
                    doc.vatCreditRecoverableClp,
                    doc.totalAmountClp,
                    costCenter,
                    doc.evidenceCasRef?.sha256 || '',
                ]),
            };
    }
}

// ---------------------------------------------------------------------------
// 1. OASIS UBL 2.1 / Peppol BIS 3.0 XML
// ---------------------------------------------------------------------------

function buildUbl21PeppolXml(
    input: AccountingExportInput,
    enrichedDocs: EnrichedAccountingDocument[],
    currencyCode: IsoCurrencyCode,
    countryCode: string,
    generatedDate: string
): string {
    const primaryDoc = enrichedDocs[0]?.doc;
    const invoiceId = primaryDoc
        ? `${primaryDoc.documentType}-${primaryDoc.folio}`
        : `MINREPORT-${generatedDate}`;
    const issueDate = primaryDoc?.issueDate?.slice(0, 10) || generatedDate;
    const supplierName = primaryDoc?.supplierName || 'MINREPORT CONSOLIDATED SUPPLIERS';
    const supplierTax = primaryDoc?.supplierTaxId || 'NOT_DECLARED';
    const customerName = input.tenantName || input.tenantId;
    const customerTax = input.tenantTaxId || input.tenantId;

    const totalNet = enrichedDocs.reduce((acc, e) => acc + Math.round(e.doc.netAmountClp || 0), 0);
    const totalVat = enrichedDocs.reduce((acc, e) => acc + Math.round(e.doc.vatAmountClp || 0), 0);
    const totalGross = enrichedDocs.reduce(
        (acc, e) => acc + Math.round(e.doc.totalAmountClp || 0),
        0
    );

    const flatLines: Array<{
        index: number;
        docRef: string;
        line: AccountingExportDocumentLine;
    }> = [];
    let idx = 1;
    for (const entry of enrichedDocs) {
        const docRef = `DTE-${entry.doc.documentType}-${entry.doc.folio}`;
        for (const line of entry.lines) {
            flatLines.push({ index: idx++, docRef, line });
        }
    }

    const invoiceLinesXml = flatLines
        .map(({ index, docRef, line }) => {
            const gtinBlock = line.gtin
                ? `\n      <cac:StandardItemIdentification><cbc:ID schemeID="0160">${escapeXml(line.gtin)}</cbc:ID></cac:StandardItemIdentification>`
                : '';
            const unspscBlock = line.unspscCode
                ? `\n      <cac:CommodityClassification><cbc:ItemClassificationCode listID="TST">${escapeXml(line.unspscCode)}</cbc:ItemClassificationCode></cac:CommodityClassification>`
                : '';
            return [
                '  <cac:InvoiceLine>',
                `    <cbc:ID>${index}</cbc:ID>`,
                `    <cbc:Note>${escapeXml(`${docRef} · CC:${line.costCenter}`)}</cbc:Note>`,
                `    <cbc:InvoicedQuantity unitCode="${escapeXml(line.unCefactCode)}">${escapeXml(line.qty)}</cbc:InvoicedQuantity>`,
                `    <cbc:LineExtensionAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(line.subtotalMinor, currencyCode)}</cbc:LineExtensionAmount>`,
                `    <cbc:AccountingCost>${escapeXml(line.costCenter)}</cbc:AccountingCost>`,
                '    <cac:Item>',
                `      <cbc:Name>${escapeXml(line.description)}</cbc:Name>`,
                `      <cac:SellersItemIdentification><cbc:ID>${escapeXml(line.canonicalSkuId)}</cbc:ID></cac:SellersItemIdentification>${gtinBlock}${unspscBlock}`,
                '      <cac:ClassifiedTaxCategory>',
                '        <cbc:ID>S</cbc:ID>',
                '        <cbc:Percent>19</cbc:Percent>',
                '        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>',
                '      </cac:ClassifiedTaxCategory>',
                '    </cac:Item>',
                '    <cac:Price>',
                `      <cbc:PriceAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(line.unitPriceMinor, currencyCode)}</cbc:PriceAmount>`,
                '    </cac:Price>',
                '  </cac:InvoiceLine>',
            ].join('\n');
        })
        .join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">',
        '  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>',
        '  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>',
        '  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>',
        `  <cbc:ID>${escapeXml(invoiceId)}</cbc:ID>`,
        `  <cbc:IssueDate>${escapeXml(issueDate)}</cbc:IssueDate>`,
        `  <cbc:InvoiceTypeCode>${primaryDoc?.documentType === 61 ? '381' : '380'}</cbc:InvoiceTypeCode>`,
        `  <cbc:DocumentCurrencyCode>${escapeXml(currencyCode)}</cbc:DocumentCurrencyCode>`,
        '  <cac:AccountingSupplierParty>',
        '    <cac:Party>',
        `      <cac:PartyName><cbc:Name>${escapeXml(supplierName)}</cbc:Name></cac:PartyName>`,
        '      <cac:PostalAddress>',
        `        <cac:Country><cbc:IdentificationCode>${escapeXml(countryCode)}</cbc:IdentificationCode></cac:Country>`,
        '      </cac:PostalAddress>',
        '      <cac:PartyTaxScheme>',
        `        <cbc:CompanyID>${escapeXml(supplierTax)}</cbc:CompanyID>`,
        '        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>',
        '      </cac:PartyTaxScheme>',
        '      <cac:PartyLegalEntity>',
        `        <cbc:RegistrationName>${escapeXml(supplierName)}</cbc:RegistrationName>`,
        '      </cac:PartyLegalEntity>',
        '    </cac:Party>',
        '  </cac:AccountingSupplierParty>',
        '  <cac:AccountingCustomerParty>',
        '    <cac:Party>',
        `      <cac:PartyName><cbc:Name>${escapeXml(customerName)}</cbc:Name></cac:PartyName>`,
        '      <cac:PostalAddress>',
        `        <cac:Country><cbc:IdentificationCode>${escapeXml(countryCode)}</cbc:IdentificationCode></cac:Country>`,
        '      </cac:PostalAddress>',
        '      <cac:PartyTaxScheme>',
        `        <cbc:CompanyID>${escapeXml(customerTax)}</cbc:CompanyID>`,
        '        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>',
        '      </cac:PartyTaxScheme>',
        '      <cac:PartyLegalEntity>',
        `        <cbc:RegistrationName>${escapeXml(customerName)}</cbc:RegistrationName>`,
        '      </cac:PartyLegalEntity>',
        '    </cac:Party>',
        '  </cac:AccountingCustomerParty>',
        '  <cac:TaxTotal>',
        `    <cbc:TaxAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalVat, currencyCode)}</cbc:TaxAmount>`,
        '    <cac:TaxSubtotal>',
        `      <cbc:TaxableAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalNet, currencyCode)}</cbc:TaxableAmount>`,
        `      <cbc:TaxAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalVat, currencyCode)}</cbc:TaxAmount>`,
        '      <cac:TaxCategory>',
        '        <cbc:ID>S</cbc:ID>',
        '        <cbc:Percent>19</cbc:Percent>',
        '        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>',
        '      </cac:TaxCategory>',
        '    </cac:TaxSubtotal>',
        '  </cac:TaxTotal>',
        '  <cac:LegalMonetaryTotal>',
        `    <cbc:LineExtensionAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalNet, currencyCode)}</cbc:LineExtensionAmount>`,
        `    <cbc:TaxExclusiveAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalNet, currencyCode)}</cbc:TaxExclusiveAmount>`,
        `    <cbc:TaxInclusiveAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalGross, currencyCode)}</cbc:TaxInclusiveAmount>`,
        `    <cbc:PayableAmount currencyID="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(totalGross, currencyCode)}</cbc:PayableAmount>`,
        '  </cac:LegalMonetaryTotal>',
        invoiceLinesXml,
        '</Invoice>',
    ]
        .filter(Boolean)
        .join('\n');
}

// ---------------------------------------------------------------------------
// 2. OECD SAF-T 2.0 XML
// ---------------------------------------------------------------------------

function buildSaftOecdXml(
    input: AccountingExportInput,
    enrichedDocs: EnrichedAccountingDocument[],
    currencyCode: IsoCurrencyCode,
    countryCode: string,
    generatedDate: string
): string {
    const suppliersByTax = new Map<string, { taxId: string; name: string }>();
    const productsBySku = new Map<string, AccountingExportDocumentLine>();

    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of enrichedDocs) {
        const key = entry.doc.supplierTaxId || entry.doc.supplierName;
        if (!suppliersByTax.has(key)) {
            suppliersByTax.set(key, {
                taxId: entry.doc.supplierTaxId,
                name: entry.doc.supplierName,
            });
        }
        for (const line of entry.lines) {
            if (!productsBySku.has(line.canonicalSkuId)) {
                productsBySku.set(line.canonicalSkuId, line);
            }
        }
        if (entry.doc.documentType === 61) {
            totalCredit += Math.abs(Math.round(entry.doc.totalAmountClp || 0));
        } else {
            totalDebit += Math.round(entry.doc.totalAmountClp || 0);
        }
    }

    const suppliersXml = Array.from(suppliersByTax.values())
        .map(
            (sup, idx) => [
                '      <Supplier>',
                `        <RegistrationNumber>${escapeXml(sup.taxId)}</RegistrationNumber>`,
                `        <Name>${escapeXml(sup.name)}</Name>`,
                `        <SupplierID>SUP-${idx + 1}</SupplierID>`,
                '        <TaxRegistration>',
                `          <TaxRegistrationNumber>${escapeXml(sup.taxId)}</TaxRegistrationNumber>`,
                '        </TaxRegistration>',
                '      </Supplier>',
            ].join('\n')
        )
        .join('\n');

    const productsXml = Array.from(productsBySku.values())
        .map((prod) =>
            [
                '      <Product>',
                `        <ProductCode>${escapeXml(prod.canonicalSkuId)}</ProductCode>`,
                `        <Description>${escapeXml(prod.description)}</Description>`,
                `        <ProductNumberCode>${escapeXml(prod.gtin || prod.unspscCode || prod.canonicalSkuId)}</ProductNumberCode>`,
                `        <UOMBase>${escapeXml(prod.unCefactCode)}</UOMBase>`,
                '      </Product>',
            ].join('\n')
        )
        .join('\n');

    const invoicesXml = enrichedDocs
        .map((entry) => {
            const { doc, lines } = entry;
            const linesXml = lines
                .map((l, idx) =>
                    [
                        '        <Line>',
                        `          <LineNumber>${idx + 1}</LineNumber>`,
                        `          <ProductCode>${escapeXml(l.canonicalSkuId)}</ProductCode>`,
                        `          <Description>${escapeXml(l.description)}</Description>`,
                        `          <Quantity>${escapeXml(l.qty)}</Quantity>`,
                        `          <InvoiceUOM>${escapeXml(l.unCefactCode)}</InvoiceUOM>`,
                        `          <UnitPrice>${formatIsoMoneyDecimal(l.unitPriceMinor, currencyCode)}</UnitPrice>`,
                        `          <InvoiceLineAmount><Amount>${formatIsoMoneyDecimal(l.subtotalMinor, currencyCode)}</Amount></InvoiceLineAmount>`,
                        '        </Line>',
                    ].join('\n')
                )
                .join('\n');

            return [
                '      <Invoice>',
                `        <InvoiceNo>${escapeXml(`${doc.documentType}-${doc.folio}`)}</InvoiceNo>`,
                '        <SupplierInfo>',
                `          <SupplierID>${escapeXml(doc.supplierTaxId)}</SupplierID>`,
                `          <Name>${escapeXml(doc.supplierName)}</Name>`,
                '        </SupplierInfo>',
                `        <InvoiceDate>${escapeXml(doc.issueDate.slice(0, 10))}</InvoiceDate>`,
                `        <InvoiceType>${escapeXml(String(doc.documentType))}</InvoiceType>`,
                linesXml,
                '        <DocumentTotals>',
                `          <TaxPayable>${formatIsoMoneyDecimal(doc.vatAmountClp, currencyCode)}</TaxPayable>`,
                `          <NetTotal>${formatIsoMoneyDecimal(doc.netAmountClp, currencyCode)}</NetTotal>`,
                `          <GrossTotal>${formatIsoMoneyDecimal(doc.totalAmountClp, currencyCode)}</GrossTotal>`,
                '        </DocumentTotals>',
                '      </Invoice>',
            ].join('\n');
        })
        .join('\n');

    const startDate =
        enrichedDocs.length > 0
            ? enrichedDocs.map((d) => d.doc.issueDate.slice(0, 10)).sort()[0]
            : generatedDate;
    const endDate =
        enrichedDocs.length > 0
            ? enrichedDocs.map((d) => d.doc.issueDate.slice(0, 10)).sort().slice(-1)[0]
            : generatedDate;

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:2.00">',
        '  <Header>',
        '    <AuditFileVersion>2.00</AuditFileVersion>',
        `    <AuditFileCountry>${escapeXml(countryCode)}</AuditFileCountry>`,
        `    <AuditFileDateCreated>${escapeXml(generatedDate)}</AuditFileDateCreated>`,
        '    <SoftwareCompanyName>MINREPORT</SoftwareCompanyName>',
        '    <SoftwareID>MINREPORT-SUPPLY</SoftwareID>',
        '    <SoftwareVersion>2.0.0</SoftwareVersion>',
        '    <Company>',
        `      <RegistrationNumber>${escapeXml(input.tenantTaxId || input.tenantId)}</RegistrationNumber>`,
        `      <Name>${escapeXml(input.tenantName || input.tenantId)}</Name>`,
        '    </Company>',
        `    <DefaultCurrencyCode>${escapeXml(currencyCode)}</DefaultCurrencyCode>`,
        '    <SelectionCriteria>',
        `      <SelectionStartDate>${escapeXml(startDate)}</SelectionStartDate>`,
        `      <SelectionEndDate>${escapeXml(endDate)}</SelectionEndDate>`,
        '    </SelectionCriteria>',
        '  </Header>',
        '  <MasterFiles>',
        '    <Suppliers>',
        suppliersXml,
        '    </Suppliers>',
        '    <Products>',
        productsXml,
        '    </Products>',
        '  </MasterFiles>',
        '  <SourceDocuments>',
        '    <PurchaseInvoices>',
        `      <NumberOfEntries>${enrichedDocs.length}</NumberOfEntries>`,
        `      <TotalDebit>${formatIsoMoneyDecimal(totalDebit, currencyCode)}</TotalDebit>`,
        `      <TotalCredit>${formatIsoMoneyDecimal(totalCredit, currencyCode)}</TotalCredit>`,
        invoicesXml,
        '    </PurchaseInvoices>',
        '  </SourceDocuments>',
        '</AuditFile>',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// 3. ISO 20022 `pain.001.001.09` Customer Credit Transfer Initiation XML
// ---------------------------------------------------------------------------

function buildIso20022Pain001Xml(
    input: AccountingExportInput,
    enrichedDocs: EnrichedAccountingDocument[],
    currencyCode: IsoCurrencyCode,
    generatedAtIso: string
): string {
    const generatedDate = generatedAtIso.slice(0, 10);
    const reports: SiiExpenseReport[] = input.expenseReports || [];

    interface PaymentTxItem {
        endToEndId: string;
        creditorName: string;
        amountMinor: number;
        remittanceInfo: string;
    }

    const txs: PaymentTxItem[] = [];
    for (const rep of reports) {
        const amount = Math.abs(Math.round(rep.renderedTotalClp || rep.fundAdvanceClp || 0));
        if (amount <= 0) continue;
        txs.push({
            endToEndId: `REND-${rep.reportId}`.slice(0, 35),
            creditorName: rep.custodianName || rep.custodianUid,
            amountMinor: amount,
            remittanceInfo: `${rep.title} (${rep.costCenter})`.slice(0, 140),
        });
    }

    if (txs.length === 0) {
        for (const { doc, costCenter } of enrichedDocs) {
            if (doc.documentType === 61 || doc.totalAmountClp <= 0) continue;
            txs.push({
                endToEndId: `DTE${doc.documentType}-${doc.folio}`.slice(0, 35),
                creditorName: doc.supplierName,
                amountMinor: Math.round(doc.totalAmountClp),
                remittanceInfo: `DTE ${doc.documentType} #${doc.folio} RUT ${doc.supplierTaxId} CC ${costCenter}`.slice(
                    0,
                    140
                ),
            });
        }
    }

    const ctrlSumMinor = txs.reduce((acc, t) => acc + t.amountMinor, 0);
    const msgId = `MR-${generatedDate.replace(/-/g, '')}-${crypto
        .createHash('sha256')
        .update(`${input.tenantId}:${generatedAtIso}:${txs.length}`)
        .digest('hex')
        .slice(0, 10)
        .toUpperCase()}`;

    const txsXml = txs
        .map((tx) =>
            [
                '      <CdtTrfTxInf>',
                `        <PmtId><EndToEndId>${escapeXml(tx.endToEndId)}</EndToEndId></PmtId>`,
                '        <Amt>',
                `          <InstdAmt Ccy="${escapeXml(currencyCode)}">${formatIsoMoneyDecimal(tx.amountMinor, currencyCode)}</InstdAmt>`,
                '        </Amt>',
                `        <Cdtr><Nm>${escapeXml(tx.creditorName)}</Nm></Cdtr>`,
                `        <RmtInf><Ustrd>${escapeXml(tx.remittanceInfo)}</Ustrd></RmtInf>`,
                '      </CdtTrfTxInf>',
            ].join('\n')
        )
        .join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">',
        '  <CstmrCdtTrfInitn>',
        '    <GrpHdr>',
        `      <MsgId>${escapeXml(msgId)}</MsgId>`,
        `      <CreDtTm>${escapeXml(generatedAtIso)}</CreDtTm>`,
        `      <NbOfTxs>${txs.length}</NbOfTxs>`,
        `      <CtrlSum>${formatIsoMoneyDecimal(ctrlSumMinor, currencyCode)}</CtrlSum>`,
        `      <InitgPty><Nm>${escapeXml(input.tenantName || input.tenantId)}</Nm></InitgPty>`,
        '    </GrpHdr>',
        '    <PmtInf>',
        `      <PmtInfId>${escapeXml(`PMT-${msgId}`)}</PmtInfId>`,
        '      <PmtMtd>TRF</PmtMtd>',
        `      <NbOfTxs>${txs.length}</NbOfTxs>`,
        `      <CtrlSum>${formatIsoMoneyDecimal(ctrlSumMinor, currencyCode)}</CtrlSum>`,
        `      <ReqdExctnDt><Dt>${escapeXml(generatedDate)}</Dt></ReqdExctnDt>`,
        `      <Dbtr><Nm>${escapeXml(input.tenantName || input.tenantId)}</Nm></Dbtr>`,
        '      <DbtrAcct><Id><Othr><Id>MINREPORT-TREASURY</Id></Othr></Id></DbtrAcct>',
        txsXml,
        '    </PmtInf>',
        '  </CstmrCdtTrfInitn>',
        '</Document>',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. JSON Schema v2.0.0 Canónico
// ---------------------------------------------------------------------------

function buildJsonSchemaV2(
    input: AccountingExportInput,
    enrichedDocs: EnrichedAccountingDocument[],
    matrix: TabularExportMatrix,
    currencyCode: IsoCurrencyCode,
    countryCode: string,
    generatedAtIso: string
): string {
    const totalNetMinor = enrichedDocs.reduce((s, d) => s + Math.round(d.doc.netAmountClp || 0), 0);
    const totalVatMinor = enrichedDocs.reduce((s, d) => s + Math.round(d.doc.vatAmountClp || 0), 0);
    const totalVatRecoverableMinor = enrichedDocs.reduce(
        (s, d) => s + Math.round(d.doc.vatCreditRecoverableClp || 0),
        0
    );
    const totalGrossMinor = enrichedDocs.reduce(
        (s, d) => s + Math.round(d.doc.totalAmountClp || 0),
        0
    );

    const payload = {
        schemaVersion: '2.0.0',
        brand: 'MINREPORT',
        module: 'supply',
        format: 'JSON_SCHEMA_V2',
        profile: input.profile,
        generatedAtIso,
        tenant: {
            tenantId: input.tenantId,
            name: input.tenantName || input.tenantId,
            taxIdentifier: buildTaxIdentifier(input.tenantTaxId || input.tenantId, countryCode),
            currencyCode,
        },
        summary: {
            documentCount: enrichedDocs.length,
            expenseReportCount: (input.expenseReports || []).length,
            net: buildMoneyAmount(totalNetMinor, currencyCode),
            vat: buildMoneyAmount(totalVatMinor, currencyCode),
            vatRecoverable: buildMoneyAmount(totalVatRecoverableMinor, currencyCode),
            total: buildMoneyAmount(totalGrossMinor, currencyCode),
        },
        documents: enrichedDocs.map(({ doc, costCenter, isCapex, lines }) => ({
            docId: doc.docId,
            dedupeKey: doc.dedupeKey,
            siteId: doc.siteId,
            documentType: doc.documentType,
            folio: doc.folio,
            issueDate: doc.issueDate,
            supplierName: doc.supplierName,
            supplierTaxIdentifier: buildTaxIdentifier(doc.supplierTaxId, countryCode),
            costCenter,
            isCapex,
            rcvStatus: doc.rcvStatus,
            rcvDeadlineDate: doc.rcvDeadlineDate,
            retentionUntil: doc.retentionUntil || null,
            money: {
                net: buildMoneyAmount(doc.netAmountClp, currencyCode),
                vat: buildMoneyAmount(doc.vatAmountClp, currencyCode),
                vatRecoverable: buildMoneyAmount(doc.vatCreditRecoverableClp, currencyCode),
                total: buildMoneyAmount(doc.totalAmountClp, currencyCode),
            },
            evidenceCasRef: doc.evidenceCasRef || null,
            lines: lines.map((l) => ({
                lineId: l.lineId,
                canonicalSkuId: l.canonicalSkuId,
                description: l.description,
                categoryCode: l.categoryCode,
                unitSi: l.unitSi,
                unCefactCode: l.unCefactCode,
                unspscCode: l.unspscCode || null,
                gtin: l.gtin || null,
                qty: l.qty,
                unitPrice: buildMoneyAmount(l.unitPriceMinor, currencyCode),
                subtotal: buildMoneyAmount(l.subtotalMinor, currencyCode),
                costCenter: l.costCenter,
                isCapexAsset: l.isCapexAsset,
            })),
        })),
        expenseReports: (input.expenseReports || []).map((r) => ({
            reportId: r.reportId,
            siteId: r.siteId,
            title: r.title,
            costCenter: r.costCenter,
            status: r.status,
            fundAdvance: buildMoneyAmount(r.fundAdvanceClp, currencyCode),
            renderedTotal: buildMoneyAmount(r.renderedTotalClp, currencyCode),
            balance: buildMoneyAmount(r.balanceClp, currencyCode),
            siiDocumentIds: r.siiDocumentIds,
        })),
        profileProjection: {
            profile: input.profile,
            columns: matrix.headers,
            rowCount: matrix.rows.length,
        },
    };

    return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// 5. CSV RFC 4180 (CRLF + Anti-Inyección OWASP)
// ---------------------------------------------------------------------------

function buildCsvRfc4180(matrix: TabularExportMatrix): string {
    const headerLine = matrix.headers
        .map((h) => formatCsvCellRfc4180(h, matrix.csvDelimiter))
        .join(matrix.csvDelimiter);
    const dataLines = matrix.rows.map((row) =>
        row.map((cell) => formatCsvCellRfc4180(cell, matrix.csvDelimiter)).join(matrix.csvDelimiter)
    );
    return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// 6. OOXML XLSX Genuino (PKZIP + zlib.deflateRawSync + CRC32 IEEE 802.3 — 0 deps npm)
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function computeCrc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchiveBuffer(entries: Array<{ name: string; content: Buffer }>): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const uncompBuf = entry.content;
        const compBuf = zlib.deflateRawSync(uncompBuf);
        const crc = computeCrc32(uncompBuf);

        // Local File Header (30 bytes + filename)
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
        localHeader.writeUInt16LE(20, 4); // version needed (2.0)
        localHeader.writeUInt16LE(0, 6); // general purpose bit flag
        localHeader.writeUInt16LE(8, 8); // compression method: DEFLATE
        localHeader.writeUInt16LE(0, 10); // mod time
        localHeader.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compBuf.length, 18);
        localHeader.writeUInt32LE(uncompBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28); // extra field len

        localParts.push(localHeader, nameBuf, compBuf);

        // Central Directory Header (46 bytes + filename)
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
        centralHeader.writeUInt16LE(20, 4); // version made by
        centralHeader.writeUInt16LE(20, 6); // version needed
        centralHeader.writeUInt16LE(0, 8); // flags
        centralHeader.writeUInt16LE(8, 10); // compression: DEFLATE
        centralHeader.writeUInt16LE(0, 12); // mod time
        centralHeader.writeUInt16LE(0x21, 14); // mod date
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compBuf.length, 20);
        centralHeader.writeUInt32LE(uncompBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30); // extra len
        centralHeader.writeUInt16LE(0, 32); // comment len
        centralHeader.writeUInt16LE(0, 34); // disk start
        centralHeader.writeUInt16LE(0, 36); // internal attrs
        centralHeader.writeUInt32LE(0, 38); // external attrs
        centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

        centralParts.push(centralHeader, nameBuf);

        offset += localHeader.length + nameBuf.length + compBuf.length;
    }

    const centralDirBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
    eocd.writeUInt16LE(0, 4); // disk num
    eocd.writeUInt16LE(0, 6); // start disk
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20); // comment len

    return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function columnIndexToExcelRef(zeroBasedIdx: number): string {
    let n = zeroBasedIdx + 1;
    let col = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        col = String.fromCharCode(65 + rem) + col;
        n = Math.floor((n - 1) / 26);
    }
    return col;
}

function buildWorksheetXml(matrix: TabularExportMatrix): string {
    const allRows: Array<Array<string | number>> = [matrix.headers, ...matrix.rows];
    const rowsXml = allRows
        .map((row, rowIdx) => {
            const rNum = rowIdx + 1;
            const cellsXml = row
                .map((cell, colIdx) => {
                    const cellRef = `${columnIndexToExcelRef(colIdx)}${rNum}`;
                    if (rowIdx > 0 && typeof cell === 'number' && Number.isFinite(cell)) {
                        return `<c r="${cellRef}" t="n"><v>${cell}</v></c>`;
                    }
                    const safeText = escapeXml(neutralizeSpreadsheetFormula(cell));
                    return `<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${safeText}</t></is></c>`;
                })
                .join('');
            return `<row r="${rNum}">${cellsXml}</row>`;
        })
        .join('');

    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        `<sheetData>${rowsXml}</sheetData>`,
        '</worksheet>',
    ].join('');
}

function buildXlsxOoxmlBuffer(matrix: TabularExportMatrix, profile: AccountingExportProfile): Buffer {
    const sheetName = `MINREPORT_${profile}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 31);

    const contentTypesXml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '</Types>',
    ].join('');

    const rootRelsXml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
        '</Relationships>',
    ].join('');

    const workbookXml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`,
        '</workbook>',
    ].join('');

    const workbookRelsXml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '</Relationships>',
    ].join('');

    const stylesXml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<fonts count="1"><font><sz val="11"/><name val="Atkinson Hyperlegible Next"/></font></fonts>',
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>',
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>',
        '</styleSheet>',
    ].join('');

    const sheet1Xml = buildWorksheetXml(matrix);

    return createZipArchiveBuffer([
        { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
        { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
        { name: 'xl/workbook.xml', content: Buffer.from(workbookXml, 'utf8') },
        { name: 'xl/_rels/workbook.xml.rels', content: Buffer.from(workbookRelsXml, 'utf8') },
        { name: 'xl/styles.xml', content: Buffer.from(stylesXml, 'utf8') },
        { name: 'xl/worksheets/sheet1.xml', content: Buffer.from(sheet1Xml, 'utf8') },
    ]);
}

// ---------------------------------------------------------------------------
// Exportador Principal `InternationalAccountingExporter`
// ---------------------------------------------------------------------------

export class InternationalAccountingExporter implements IAccountingExportAdapter {
    public readonly supportedFormats = ACCOUNTING_EXPORT_FORMATS;
    public readonly supportedProfiles = ACCOUNTING_EXPORT_PROFILES;

    public static exportAccountingPackage(input: AccountingExportInput): AccountingExportResult {
        const generatedAtIso = input.generatedAtIso || new Date().toISOString();
        const dateTag = generatedAtIso.slice(0, 10);
        const currencyCode: IsoCurrencyCode = (input.currencyCode || 'CLP').toUpperCase();
        const countryCode = (input.tenantCountryCode || 'CL').toUpperCase();
        const enrichedDocs = enrichDocuments(input);
        const matrix = buildTabularMatrixForProfile(
            input.profile,
            enrichedDocs,
            currencyCode,
            input.tenantId
        );
        const safeProfileSlug = input.profile.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        let content: string | Buffer;
        let mimeType: string;
        let filename: string;
        let schemaVersion: string;
        let recordCount = enrichedDocs.length;

        switch (input.format) {
            case 'UBL_2_1_PEPPOL':
                content = buildUbl21PeppolXml(
                    input,
                    enrichedDocs,
                    currencyCode,
                    countryCode,
                    dateTag
                );
                mimeType = 'application/xml; charset=utf-8';
                filename = `minreport-ubl21-${safeProfileSlug}-${dateTag}.xml`;
                schemaVersion = 'UBL-2.1-PEPPOL-BIS-3.0';
                break;

            case 'SAFT_OECD':
                content = buildSaftOecdXml(
                    input,
                    enrichedDocs,
                    currencyCode,
                    countryCode,
                    dateTag
                );
                mimeType = 'application/xml; charset=utf-8';
                filename = `minreport-saft-${safeProfileSlug}-${dateTag}.xml`;
                schemaVersion = 'OECD-SAF-T-2.0';
                break;

            case 'ISO_20022_PAIN001':
                content = buildIso20022Pain001Xml(
                    input,
                    enrichedDocs,
                    currencyCode,
                    generatedAtIso
                );
                mimeType = 'application/xml; charset=utf-8';
                filename = `minreport-iso20022-pain001-${safeProfileSlug}-${dateTag}.xml`;
                schemaVersion = 'ISO-20022-pain.001.001.09';
                recordCount =
                    (input.expenseReports?.length || 0) > 0
                        ? input.expenseReports!.length
                        : enrichedDocs.length;
                break;

            case 'JSON_SCHEMA_V2':
                content = buildJsonSchemaV2(
                    input,
                    enrichedDocs,
                    matrix,
                    currencyCode,
                    countryCode,
                    generatedAtIso
                );
                mimeType = 'application/json; charset=utf-8';
                filename = `minreport-accounting-v2-${safeProfileSlug}-${dateTag}.json`;
                schemaVersion = '2.0.0';
                break;

            case 'XLSX_OOXML':
                content = buildXlsxOoxmlBuffer(matrix, input.profile);
                mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                filename = `minreport-accounting-${safeProfileSlug}-${dateTag}.xlsx`;
                schemaVersion = 'OOXML-XLSX-1.0';
                break;

            case 'CSV_RFC4180':
            default:
                content = buildCsvRfc4180(matrix);
                mimeType = 'text/csv; charset=utf-8';
                filename = `minreport-accounting-${safeProfileSlug}-${dateTag}.csv`;
                schemaVersion = 'RFC-4180-MINREPORT-2.0';
                break;
        }

        const sha256 = crypto
            .createHash('sha256')
            .update(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'))
            .digest('hex');

        return {
            format: input.format,
            profile: input.profile,
            filename,
            mimeType,
            content,
            sha256,
            recordCount,
            schemaVersion,
        };
    }

    public exportAccountingPackage(input: AccountingExportInput): AccountingExportResult {
        return InternationalAccountingExporter.exportAccountingPackage(input);
    }
}

export const internationalAccountingExporter: IAccountingExportAdapter =
    new InternationalAccountingExporter();

export const SUPPORTED_ACCOUNTING_FORMATS: readonly AccountingExportFormat[] =
    ACCOUNTING_EXPORT_FORMATS;
export const SUPPORTED_ACCOUNTING_PROFILES: readonly AccountingExportProfile[] =
    ACCOUNTING_EXPORT_PROFILES;
