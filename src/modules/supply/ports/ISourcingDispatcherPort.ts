/**
 * Puerto Hexagonal de Despacho de Abastecimiento (ISourcingDispatcherPort)
 *
 * Permite despachar listas consolidadas tanto por compra local tradicional como por
 * transferencia entre bodegas, futuro Marketplace RFQ / pool anónimo y protocolo M2M x402.
 */

import {
    ConsolidatedShoppingList,
    FulfillmentChannel,
    ProcurementBucket,
} from '../domain/types';

export interface SourcingDispatchRequest {
    tenantId: string;
    siteId: string;
    channel: FulfillmentChannel;
    shoppingList: ConsolidatedShoppingList;
    targetBuckets?: ProcurementBucket[];
    budgetCapClp?: number;
    anonymousPoolOptIn?: boolean;
    requestedByUid: string;
    requestedAt: string;
}

export type SourcingDispatchStatus =
    | 'DISPATCHED'
    | 'QUEUED_MANUAL'
    | 'RFQ_PUBLISHED'
    | 'POOL_AGGREGATED'
    | 'M2M_PAYMENT_REQUIRED';

export interface SourcingDispatchResult {
    dispatchId: string;
    channel: FulfillmentChannel;
    status: SourcingDispatchStatus;
    dispatchedAt: string;
    dispatchedSkuCount: number;
    estimatedTotalClp: number;
    externalReferenceId?: string;
    estimatedLeadTimeDays?: number;
    notes?: string;
}

export interface ISourcingDispatcherPort {
    /**
     * Indica si el adaptador concreto soporta el canal de cumplimiento solicitado.
     */
    supportsChannel(channel: FulfillmentChannel): boolean;

    /**
     * Despacha la lista consolidada por el canal configurado.
     */
    dispatch(request: SourcingDispatchRequest): Promise<SourcingDispatchResult>;
}
