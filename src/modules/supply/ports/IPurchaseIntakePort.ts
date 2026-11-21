/**
 * Puerto Hexagonal de Ingesta de Compras y Comprobantes Tributarios (IPurchaseIntakePort)
 *
 * Unifica captura por fotografía/PDF (CAS), XML DTE SII, código de barras TED PDF417,
 * reenvío WhatsApp de Gerencia/Comprador y carga manual de escritorio.
 */

import {
    AtypicalFlagCode,
    CasEvidenceRef,
    PurchaseMode,
    SiiDocumentRecord,
    SiiDteType,
    SupplyCostCenter,
    SupplyOperationalRole,
    SupplyPaymentMethod,
    SupplyPurchase,
    SupplyPurchaseLine,
} from '../domain/types';

export type PurchaseIntakeSource =
    | 'PHOTO_BOLETA'
    | 'PDF_DTE'
    | 'XML_DTE'
    | 'TED_PDF417'
    | 'MANUAL_FORM'
    | 'WHATSAPP_EXEC_FORWARD';

export interface RawPurchaseIntakePayload {
    tenantId: string;
    siteId: string;
    buyerUid: string;
    buyerRole: SupplyOperationalRole;
    purchaseMode: PurchaseMode;
    source: PurchaseIntakeSource;
    paymentMethod: SupplyPaymentMethod;
    costCenter?: SupplyCostCenter;
    xmlContent?: string;
    tedRawXml?: string;
    evidenceCasRef?: CasEvidenceRef;
    manualHeader?: {
        supplierTaxId: string;
        supplierName: string;
        documentType: SiiDteType;
        folio: string;
        issueDate: string;
        netAmountClp?: number;
        vatAmountClp?: number;
        totalAmountClp: number;
    };
    lines?: SupplyPurchaseLine[];
}

export interface PurchaseIntakeNormalizedResult {
    purchase: SupplyPurchase;
    siiDocument: SiiDocumentRecord;
    arithmeticValid: boolean;
    isDuplicateDocument: boolean;
    atypicalFlags: AtypicalFlagCode[];
    warnings: string[];
}

export interface IPurchaseIntakePort {
    /**
     * Procesa y normaliza un comprobante tributario / compra en formato canónico auditable.
     */
    ingestPurchase(payload: RawPurchaseIntakePayload): Promise<PurchaseIntakeNormalizedResult>;

    /**
     * Verifica existencia previa de la llave determinística `${rutEmisor}#${tipoDte}#${folio}` en el tenant.
     */
    checkAntiDuplication(tenantId: string, dedupeKey: string): Promise<{
        isDuplicate: boolean;
        existingPurchaseId?: string;
    }>;
}
