/**
 * Puerto Hexagonal de Ingesta de Demanda (IDemandSourcePort)
 *
 * Permite conectar orígenes heterogéneos (WhatsApp Campamento, WhatsApp Mecánicos,
 * Planificación Minera, HSEC, OPERMAQ, ACOPIOS, Escritorio Manual) hacia el motor
 * unificado de requisiciones de MINREPORT · ABASTECIMIENTO.
 */

import {
    SupplyCategoryCode,
    SupplyCostCenter,
    SupplyDemandNature,
    SupplyDemandOrigin,
    SupplyOperationalRole,
    SupplyRequisition,
    SupplyUnitSi,
    SupplyUrgency,
} from '../domain/types';

export interface IncomingDemandLineDraft {
    rawText: string;
    canonicalSkuId?: string;
    categoryCode?: SupplyCategoryCode;
    quantity?: number;
    unitRaw?: string;
    unitSi?: SupplyUnitSi;
    urgency?: SupplyUrgency;
    attributes?: Record<string, string | number | boolean>;
}

export interface IncomingDemandPayload {
    externalCorrelationId: string;
    tenantId: string;
    siteId: string;
    requesterUid: string;
    requesterName: string;
    requesterRole: SupplyOperationalRole;
    demandOrigin: SupplyDemandOrigin;
    demandNature: SupplyDemandNature;
    costCenter?: SupplyCostCenter;
    linkedAssetId?: string;
    linkedPlanRef?: string;
    receivedAt: string;
    lines: IncomingDemandLineDraft[];
}

export interface DemandCommitAcknowledgement {
    externalCorrelationId: string;
    reqId: string;
    acceptedLineCount: number;
    rejectedLineCount: number;
    committedAt: string;
}

export interface IDemandSourcePort {
    readonly origin: SupplyDemandOrigin;

    /**
     * Normaliza un evento bruto del canal de origen hacia el borrador canónico de demanda.
     */
    parseIncomingDemand(rawEvent: unknown): Promise<IncomingDemandPayload | null>;

    /**
     * Consulta demandas planificadas o pendientes del origen (ej. Planificación / OPERMAQ).
     */
    fetchPendingDemands?(tenantId: string, siteId: string): Promise<IncomingDemandPayload[]>;

    /**
     * Notifica al origen que la requisición fue consolidada en el ledger de abastecimiento.
     */
    acknowledgeDemandCommitted(
        ack: DemandCommitAcknowledgement,
        requisition: SupplyRequisition
    ): Promise<void>;
}
