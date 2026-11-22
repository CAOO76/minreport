import { z } from 'zod';
import type {
    CanonicalSupplySku,
    IsoCurrencyCode,
    SiiDocumentRecord,
    SiiExpenseReport,
    SupplyPurchase,
    SupplyUnitSi,
    UnCefactRec20Code,
} from '../application/supply.types';

/**
 * PUERTO HEXAGONAL DE EXPORTACIÓN CONTABLE INTERNACIONAL (MINREPORT · ABASTECIMIENTO)
 *
 * Define contratos canónicos agnósticos para exportación tributaria y contable multi-ERP:
 * - Estándares internacionales: OASIS UBL 2.1 / Peppol BIS 3.0, OECD SAF-T 2.0,
 *   ISO 20022 `pain.001.001.09`, JSON Schema v2.0, CSV RFC 4180 y OOXML XLSX nativo.
 * - Perfiles Chile: SII RCV, Chipax, Clay, Defontana, Nubox y Softland.
 * - Perfiles ERP Global: SAP S/4HANA, Oracle NetSuite, Microsoft Dynamics 365,
 *   Pronto Xi, Xero, QuickBooks y Standard.
 */

export const ACCOUNTING_EXPORT_FORMATS = [
    'UBL_2_1_PEPPOL',
    'SAFT_OECD',
    'ISO_20022_PAIN001',
    'JSON_SCHEMA_V2',
    'CSV_RFC4180',
    'XLSX_OOXML',
] as const;

export const AccountingExportFormatSchema = z.enum(ACCOUNTING_EXPORT_FORMATS);
export type AccountingExportFormat = z.infer<typeof AccountingExportFormatSchema>;

export const CHILE_ACCOUNTING_PROFILES = [
    'CL_SII_RCV',
    'CL_CHIPAX',
    'CL_CLAY',
    'CL_DEFONTANA',
    'CL_NUBOX',
    'CL_SOFTLAND',
] as const;

export const GLOBAL_ERP_ACCOUNTING_PROFILES = [
    'GLOBAL_SAP_S4HANA',
    'GLOBAL_NETSUITE',
    'GLOBAL_DYNAMICS_365',
    'GLOBAL_PRONTO_XI',
    'GLOBAL_XERO',
    'GLOBAL_QUICKBOOKS',
    'GLOBAL_STANDARD',
] as const;

export const ACCOUNTING_EXPORT_PROFILES = [
    ...CHILE_ACCOUNTING_PROFILES,
    ...GLOBAL_ERP_ACCOUNTING_PROFILES,
] as const;

export const AccountingExportProfileSchema = z.enum(ACCOUNTING_EXPORT_PROFILES);
export type AccountingExportProfile = z.infer<typeof AccountingExportProfileSchema>;

export interface AccountingExportDocumentLine {
    lineId: string;
    canonicalSkuId: string;
    description: string;
    categoryCode: string;
    unitSi: SupplyUnitSi;
    unCefactCode: UnCefactRec20Code;
    unspscCode?: string;
    gtin?: string;
    qty: number;
    unitPriceMinor: number;
    subtotalMinor: number;
    costCenter: string;
    isCapexAsset: boolean;
}

export interface AccountingExportInput {
    tenantId: string;
    tenantName?: string;
    tenantTaxId?: string;
    tenantCountryCode?: string;
    currencyCode?: IsoCurrencyCode;
    siteId?: string;
    format: AccountingExportFormat;
    profile: AccountingExportProfile;
    generatedAtIso?: string;
    documents: SiiDocumentRecord[];
    purchases?: SupplyPurchase[];
    expenseReports?: SiiExpenseReport[];
    catalogBySkuId?: Readonly<Record<string, Partial<CanonicalSupplySku>>>;
}

export interface AccountingExportResult {
    format: AccountingExportFormat;
    profile: AccountingExportProfile;
    filename: string;
    mimeType: string;
    content: string | Buffer;
    sha256: string;
    recordCount: number;
    schemaVersion: string;
}

export interface IAccountingExportAdapter {
    readonly supportedFormats: readonly AccountingExportFormat[];
    readonly supportedProfiles: readonly AccountingExportProfile[];
    exportAccountingPackage(input: AccountingExportInput): AccountingExportResult;
}
