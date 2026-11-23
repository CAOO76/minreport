import crypto from 'crypto';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import {
    type DecryptedWhatsAppFlowBody,
    type SignedFlowTokenClaims,
    type SupplyWhatsAppFlowType,
    WhatsAppFlowTokenError,
    resolveFlowTokenSigningSecret,
    verifySignedFlowToken,
} from '../adapters/WhatsAppFlowsCrypto';
import {
    type AuditActorContext,
    SUPPLY_COLLECTIONS,
    SupplyConflictError,
    SupplyForbiddenError,
    SupplyNotFoundError,
    SupplyRepository,
    SupplyValidationError,
} from '../application/SupplyRepository';
import {
    type AtypicalFlagCode,
    normalizeSupplyItemFromText,
    SUPPLY_AUDIT_MODULE,
    type SupplyDemandOrigin,
    type SupplyMemberProfile,
    SupplyMemberProfileSchema,
    type SupplyOperationalRole,
    type SupplyPurchase,
    type SupplyRequisition,
    type SupplyUnitSi,
    type SupplyUrgency,
} from '../application/supply.types';
import {
    type PolicyItemCandidate,
    evaluateRequisitionPolicy,
} from '../domain/SupplyPolicyAndAnomalyEngine';
import { DynamicChannelScopeResolver } from './DynamicChannelScopeResolver';
import { ConversationAuditService } from '../application/ConversationAuditService';

/**
 * WHATSAPP FLOWS v3.0 DISPATCHER — MINREPORT · ABASTECIMIENTO
 *
 * Implementa los 4 Flows nativos cifrados de operación minera + health check `ping`:
 * 1. `OPT_IN` (`MINREPORT_OPTIN_LEY21719`): Doble Opt-In Ley N° 21.719 + `AuditLedger`.
 * 2. `CAMP_ORDER` (`MINREPORT_CAMP_REORDER`): Pedido de Campamento & 1-Tap Re-Order con validación DS 132 / DGMN.
 * 3. `RECEPTION_4WAY` (`MINREPORT_WAREHOUSE_4WAY`): Recepción Física Bodega 4-Way transaccional (anti sobre-recepción).
 * 4. `HITL_APPROVAL` (`MINREPORT_EXEC_HITL_APPROVAL`): Aprobación Gerencial HITL (`ACTUALIZAR` + segregación anti auto-aprobación).
 */

export interface WhatsAppFlowResponse {
    version: '3.0';
    screen?: string;
    data: Record<string, unknown>;
}

export interface SupplyFlowHandleOptions {
    tokenSecret?: string;
    nowMs?: number;
    ipAddress?: string;
}

interface VerifiedFlowMember {
    tenantId: string;
    memberUid: string;
    displayName: string;
    email: string;
    phoneE164?: string;
    b2bRole: string;
    status: string;
    whatsappOptInAt?: string | number | null;
    whatsappOptInStatus?: string | null;
    supplyProfile: SupplyMemberProfile;
    isReadOnly: boolean;
}

const READ_ONLY_B2B_ROLES = new Set(['VIEWER', 'BILLING_ONLY', 'SUBSCRIPTION_ADMIN']);
const INACTIVE_MEMBER_STATUSES = new Set(['SUSPENDED', 'REVOKED', 'INACTIVE', 'DELETED']);

export const SUPPLY_WHATSAPP_FLOW_IDS: Record<SupplyWhatsAppFlowType, string> = {
    OPT_IN: 'MINREPORT_OPTIN_LEY21719',
    CAMP_ORDER: 'MINREPORT_CAMP_REORDER',
    RECEPTION_4WAY: 'MINREPORT_WAREHOUSE_4WAY',
    HITL_APPROVAL: 'MINREPORT_EXEC_HITL_APPROVAL',
};

/**
 * Definiciones declarativas oficiales Meta Flows JSON v3.0 listas para registro en Meta Business Manager.
 */
export const SUPPLY_WHATSAPP_FLOW_DEFINITIONS = {
    MINREPORT_OPTIN_LEY21719: {
        version: '3.0',
        data_api_version: '3.0',
        routing_model: {
            OPT_IN_CONSENT: ['SUCCESS'],
        },
        screens: [
            {
                id: 'OPT_IN_CONSENT',
                title: 'MINREPORT · Consentimiento',
                data: {
                    member_name: { type: 'string', __example__: 'Operador Faena' },
                    law_reference: {
                        type: 'string',
                        __example__: 'Ley N° 21.719 (Chile) · southamerica-west1',
                    },
                    error_message: { type: 'string', __example__: '' },
                },
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'Form',
                            name: 'optin_form',
                            children: [
                                {
                                    type: 'TextSubheading',
                                    text: 'Autorización Canal WhatsApp MINREPORT',
                                },
                                {
                                    type: 'TextBody',
                                    text: '${data.law_reference}',
                                },
                                {
                                    type: 'OptIn',
                                    name: 'accepted',
                                    label: 'Autorizo recepción y envío operacional bajo Ley N° 21.719',
                                    required: true,
                                },
                                {
                                    type: 'Footer',
                                    label: 'CONFIRMAR OPT-IN',
                                    'on-click-action': {
                                        name: 'data_exchange',
                                        payload: {
                                            accepted: '${form.accepted}',
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            {
                id: 'SUCCESS',
                terminal: true,
                success: true,
                title: 'Canal Activado',
                data: {},
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'TextBody',
                            text: 'Doble Opt-In registrado en AuditLedger MINREPORT.',
                        },
                    ],
                },
            },
        ],
    },
    MINREPORT_CAMP_REORDER: {
        version: '3.0',
        data_api_version: '3.0',
        routing_model: {
            CAMP_REORDER_SELECT: ['SUCCESS'],
        },
        screens: [
            {
                id: 'CAMP_REORDER_SELECT',
                title: 'MINREPORT · Requisición',
                data: {
                    site_id: { type: 'string', __example__: 'site-norte-01' },
                    has_reorder_template: { type: 'boolean', __example__: true },
                    last_order_summary: { type: 'string', __example__: 'Agua Potable (200 L)' },
                    reorder_options: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                            },
                        },
                        __example__: [{ id: 'SKU-AGUA-BIDON', title: 'Agua 20L (10 un)' }],
                    },
                    error_message: { type: 'string', __example__: '' },
                },
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'Form',
                            name: 'camp_order_form',
                            children: [
                                {
                                    type: 'TextSubheading',
                                    text: '1-Tap Re-Order / Pedido Campamento',
                                },
                                {
                                    type: 'CheckboxGroup',
                                    name: 'selected_sku_ids',
                                    label: 'Insumos frecuentes de faena',
                                    'data-source': '${data.reorder_options}',
                                    required: false,
                                },
                                {
                                    type: 'TextInput',
                                    name: 'item_text',
                                    label: 'Insumo adicional (opcional)',
                                    required: false,
                                },
                                {
                                    type: 'TextInput',
                                    name: 'qty',
                                    label: 'Cantidad',
                                    'input-type': 'number',
                                    required: false,
                                },
                                {
                                    type: 'Footer',
                                    label: 'EMITIR REQUISICIÓN',
                                    'on-click-action': {
                                        name: 'data_exchange',
                                        payload: {
                                            mode: 'ONE_TAP_REORDER',
                                            selected_sku_ids: '${form.selected_sku_ids}',
                                            item_text: '${form.item_text}',
                                            qty: '${form.qty}',
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            {
                id: 'SUCCESS',
                terminal: true,
                success: true,
                title: 'Requisición Registrada',
                data: {},
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'TextBody',
                            text: 'Solicitud validada DS 132/DGMN y consolidada en MINREPORT.',
                        },
                    ],
                },
            },
        ],
    },
    MINREPORT_WAREHOUSE_4WAY: {
        version: '3.0',
        data_api_version: '3.0',
        routing_model: {
            WAREHOUSE_SELECT_PURCHASE: ['SUCCESS'],
        },
        screens: [
            {
                id: 'WAREHOUSE_SELECT_PURCHASE',
                title: 'MINREPORT · Bodega 4-Way',
                data: {
                    site_id: { type: 'string', __example__: 'site-norte-01' },
                    purchase_options: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                            },
                        },
                        __example__: [{ id: 'pur_001', title: 'Distribuidora · DTE 33 #1045' }],
                    },
                    error_message: { type: 'string', __example__: '' },
                },
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'Form',
                            name: 'warehouse_reception_form',
                            children: [
                                {
                                    type: 'TextSubheading',
                                    text: 'Confirmación Física de Recepción',
                                },
                                {
                                    type: 'Dropdown',
                                    name: 'purchase_id',
                                    label: 'Compra en tránsito',
                                    'data-source': '${data.purchase_options}',
                                    required: true,
                                },
                                {
                                    type: 'TextArea',
                                    name: 'notes',
                                    label: 'Observación de bodega (opcional)',
                                    required: false,
                                },
                                {
                                    type: 'Footer',
                                    label: 'CONFIRMAR RECEPCIÓN',
                                    'on-click-action': {
                                        name: 'data_exchange',
                                        payload: {
                                            purchase_id: '${form.purchase_id}',
                                            notes: '${form.notes}',
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            {
                id: 'SUCCESS',
                terminal: true,
                success: true,
                title: 'Recepción Confirmada',
                data: {},
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'TextBody',
                            text: 'Stock trasladado a bodega y auditado en MINREPORT.',
                        },
                    ],
                },
            },
        ],
    },
    MINREPORT_EXEC_HITL_APPROVAL: {
        version: '3.0',
        data_api_version: '3.0',
        routing_model: {
            EXEC_HITL_REVIEW: ['SUCCESS'],
        },
        screens: [
            {
                id: 'EXEC_HITL_REVIEW',
                title: 'MINREPORT · HITL',
                data: {
                    entity_id: { type: 'string', __example__: 'expr_001' },
                    entity_kind: { type: 'string', __example__: 'EXPENSE_REPORT' },
                    summary_text: { type: 'string', __example__: 'Rendición SII · CLP 450.000' },
                    error_message: { type: 'string', __example__: '' },
                },
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'Form',
                            name: 'exec_hitl_form',
                            children: [
                                {
                                    type: 'TextSubheading',
                                    text: 'Autorización Gerencial HITL',
                                },
                                {
                                    type: 'TextBody',
                                    text: '${data.summary_text}',
                                },
                                {
                                    type: 'RadioButtonsGroup',
                                    name: 'decision',
                                    label: 'Resolución',
                                    required: true,
                                    'data-source': [
                                        { id: 'APPROVE', title: 'Aprobar' },
                                        { id: 'REJECT', title: 'Rechazar' },
                                    ],
                                },
                                {
                                    type: 'TextInput',
                                    name: 'confirmation_keyword',
                                    label: 'Escriba ACTUALIZAR para confirmar',
                                    required: true,
                                },
                                {
                                    type: 'Footer',
                                    label: 'EJECUTAR RESOLUCIÓN',
                                    'on-click-action': {
                                        name: 'data_exchange',
                                        payload: {
                                            entity_id: '${data.entity_id}',
                                            entity_kind: '${data.entity_kind}',
                                            decision: '${form.decision}',
                                            confirmation_keyword: '${form.confirmation_keyword}',
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            {
                id: 'SUCCESS',
                terminal: true,
                success: true,
                title: 'Resolución Auditada',
                data: {},
                layout: {
                    type: 'SingleColumnLayout',
                    children: [
                        {
                            type: 'TextBody',
                            text: 'Decisión gerencial registrada en AuditLedger MINREPORT.',
                        },
                    ],
                },
            },
        ],
    },
} as const;

function buildFlowErrorResponse(
    screen: string,
    errorCode: string,
    errorMessage: string,
    extraData?: Record<string, unknown>
): WhatsAppFlowResponse {
    return {
        version: '3.0',
        screen,
        data: {
            ok: false,
            error_code: errorCode,
            error_message: errorMessage,
            ...(extraData || {}),
        },
    };
}

function deriveSupplyProfile(memberData: Record<string, any>): SupplyMemberProfile {
    const rawProfile =
        memberData.supplyProfile && typeof memberData.supplyProfile === 'object'
            ? memberData.supplyProfile
            : {};
    const b2bRole = String(memberData.role || '').trim().toUpperCase();

    let role: SupplyOperationalRole = rawProfile.role || 'CAMP_MANAGER';
    if (!rawProfile.role) {
        if (b2bRole === 'OWNER') role = 'OWNER_EXEC';
        else if (b2bRole === 'ADMIN') role = 'SITE_ADMIN';
        else role = 'CAMP_MANAGER';
    }

    const canRecordDirectPurchase =
        rawProfile.canRecordDirectPurchase !== undefined
            ? Boolean(rawProfile.canRecordDirectPurchase)
            : role === 'OWNER_EXEC' || role === 'SITE_ADMIN' || role === 'BUYER';
    const autoApproveDirectPurchase =
        rawProfile.autoApproveDirectPurchase !== undefined
            ? Boolean(rawProfile.autoApproveDirectPurchase)
            : role === 'OWNER_EXEC';
    const allowCapex =
        rawProfile.allowCapex !== undefined
            ? Boolean(rawProfile.allowCapex)
            : role === 'OWNER_EXEC' || role === 'SITE_ADMIN';

    return SupplyMemberProfileSchema.parse({
        ...rawProfile,
        role,
        canRecordDirectPurchase,
        autoApproveDirectPurchase,
        allowCapex,
    });
}

function resolveOriginForFlowRole(role: SupplyOperationalRole): SupplyDemandOrigin {
    if (role === 'MECHANIC_TECH') return 'WA_MECHANIC';
    if (role === 'OPS_FOREMAN') return 'WA_OPS';
    if (role === 'WAREHOUSE_KEEPER' || role === 'HSEC_OFFICER') return 'WA_WAREHOUSE_HSEC';
    if (role === 'OWNER_EXEC') return 'WA_EXEC_DIRECT';
    return 'WA_CAMP';
}

async function resolveAndAuthorizeFlowMember(
    claims: SignedFlowTokenClaims
): Promise<
    | { ok: true; member: VerifiedFlowMember }
    | { ok: false; errorCode: string; errorMessage: string }
> {
    const memberSnap = await db
        .collection('accounts')
        .doc(claims.tenantId)
        .collection('members')
        .doc(claims.memberUid)
        .get();

    if (!memberSnap?.exists) {
        return {
            ok: false,
            errorCode: 'FLOW_MEMBER_UNAUTHORIZED',
            errorMessage: 'Miembro no autorizado o inexistente en la cuenta organizacional.',
        };
    }

    const data = (memberSnap.data() || {}) as Record<string, any>;
    const statusUpper = String(data.status || 'ACTIVE').trim().toUpperCase();
    if (INACTIVE_MEMBER_STATUSES.has(statusUpper)) {
        return {
            ok: false,
            errorCode: 'FLOW_MEMBER_UNAUTHORIZED',
            errorMessage: 'Membresía suspendida, revocada o inactiva en MINREPORT.',
        };
    }

    if (claims.flowType !== 'OPT_IN' && statusUpper !== 'ACTIVE') {
        return {
            ok: false,
            errorCode: 'FLOW_MEMBER_UNAUTHORIZED',
            errorMessage: 'La membresía debe encontrarse ACTIVE para operar este Flow.',
        };
    }

    if (data.allowedModules && data.allowedModules.supply === false) {
        return {
            ok: false,
            errorCode: 'FLOW_MODULE_DISABLED',
            errorMessage: 'El módulo ABASTECIMIENTO no está habilitado para este usuario.',
        };
    }

    const optInStatusUpper = String(data.whatsappOptInStatus || '').trim().toUpperCase();
    if (claims.flowType !== 'OPT_IN') {
        if (!data.whatsappOptInAt || optInStatusUpper === 'REVOKED' || optInStatusUpper === 'OPTED_OUT') {
            return {
                ok: false,
                errorCode: 'WHATSAPP_OPT_IN_REQUIRED',
                errorMessage: 'Debe completar primero el Doble Opt-In Ley N° 21.719.',
            };
        }
    }

    const b2bRole = String(data.role || 'OPERATOR').trim().toUpperCase();
    const isReadOnly = READ_ONLY_B2B_ROLES.has(b2bRole);

    return {
        ok: true,
        member: {
            tenantId: claims.tenantId,
            memberUid: claims.memberUid,
            displayName: String(data.displayName || data.name || data.email || claims.memberUid).trim(),
            email: String(data.email || `${claims.memberUid}@minreport.local`).trim(),
            phoneE164: typeof data.phoneE164 === 'string' ? data.phoneE164.trim() : undefined,
            b2bRole,
            status: statusUpper,
            whatsappOptInAt: data.whatsappOptInAt ?? null,
            whatsappOptInStatus: data.whatsappOptInStatus ?? null,
            supplyProfile: deriveSupplyProfile(data),
            isReadOnly,
        },
    };
}

function buildActor(member: VerifiedFlowMember, ipAddress?: string): AuditActorContext {
    return {
        actorUid: member.memberUid,
        actorEmail: member.email,
        ipAddress,
    };
}

// ---------------------------------------------------------------------------
// Flow 1: OPT_IN (`MINREPORT_OPTIN_LEY21719`)
// ---------------------------------------------------------------------------

async function handleOptInFlow(
    action: string,
    body: DecryptedWhatsAppFlowBody,
    claims: SignedFlowTokenClaims,
    member: VerifiedFlowMember,
    options: { nowMs: number; ipAddress?: string }
): Promise<WhatsAppFlowResponse> {
    if (action === 'INIT' || action === 'BACK') {
        return {
            version: '3.0',
            screen: 'OPT_IN_CONSENT',
            data: {
                ok: true,
                flow_type: 'OPT_IN',
                flow_id: SUPPLY_WHATSAPP_FLOW_IDS.OPT_IN,
                tenant_id: claims.tenantId,
                site_id: claims.siteId,
                member_name: member.displayName,
                law_reference:
                    'Ley N° 19.628 y Nueva Ley N° 21.719 (Chile) · Residencia exclusiva southamerica-west1',
                opt_in_status:
                    member.whatsappOptInStatus ||
                    (member.whatsappOptInAt ? 'ACTIVE' : 'PENDING_DOUBLE_OPT_IN'),
            },
        };
    }

    const payload = (body.data || {}) as Record<string, any>;
    const accepted = payload.accepted === true || payload.consent_accepted === true;
    if (!accepted) {
        return buildFlowErrorResponse(
            'OPT_IN_CONSENT',
            'OPT_IN_NOT_ACCEPTED',
            'Debe marcar la aceptación expresa bajo Ley N° 21.719 para activar WhatsApp.'
        );
    }

    const nowIso = new Date(options.nowMs).toISOString();
    const memberRef = db
        .collection('accounts')
        .doc(claims.tenantId)
        .collection('members')
        .doc(claims.memberUid);

    await memberRef.set(
        {
            whatsappOptInAt: nowIso,
            whatsappOptInStatus: 'ACTIVE',
            whatsappOptInChannel: 'WHATSAPP_FLOW_V3',
            updatedAt: nowIso,
        },
        { merge: true }
    );

    const userRef = db.collection('users').doc(claims.memberUid);
    const userSnap = await userRef.get().catch(() => null);
    if (userSnap?.exists) {
        await userRef
            .set(
                {
                    whatsappOptInAt: nowIso,
                    whatsappOptInStatus: 'ACTIVE',
                    updatedAt: nowIso,
                },
                { merge: true }
            )
            .catch(() => {});
    }

    await AuditLedger.record({
        tenantId: claims.tenantId,
        actorUid: member.memberUid,
        actorEmail: member.email,
        action: 'SUPPLY_WHATSAPP_DOUBLE_OPT_IN_CONFIRMED',
        module: SUPPLY_AUDIT_MODULE,
        targetEntity: member.memberUid,
        details: {
            siteId: claims.siteId,
            flowId: SUPPLY_WHATSAPP_FLOW_IDS.OPT_IN,
            lawReference: 'LEY_21719',
            whatsappOptInAt: nowIso,
            whatsappOptInStatus: 'ACTIVE',
        },
        ipAddress: options.ipAddress,
    });

    return {
        version: '3.0',
        screen: 'SUCCESS',
        data: {
            ok: true,
            flow_type: 'OPT_IN',
            whatsappOptInAt: nowIso,
            whatsappOptInStatus: 'ACTIVE',
            extension_message_response: {
                params: {
                    flow_token: body.flow_token || '',
                    status: 'OPT_IN_CONFIRMED',
                    whatsappOptInAt: nowIso,
                },
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Flow 2: CAMP_ORDER (`MINREPORT_CAMP_REORDER` — Pedido & 1-Tap Re-Order)
// ---------------------------------------------------------------------------

interface FrequentSkuSummary {
    canonicalSkuId: string;
    itemName: string;
    categoryCode: SupplyRequisition['lines'][number]['categoryCode'];
    procurementBucket: SupplyRequisition['lines'][number]['procurementBucket'];
    unitSi: SupplyUnitSi;
    lastQty: number;
    avgQty: number;
    orderCount: number;
}

function summarizeFrequentSkus(requisitions: SupplyRequisition[]): FrequentSkuSummary[] {
    const activeReqs = requisitions.filter((r) => r.status !== 'CANCELLED');
    const bySku = new Map<
        string,
        {
            canonicalSkuId: string;
            itemName: string;
            categoryCode: SupplyRequisition['lines'][number]['categoryCode'];
            procurementBucket: SupplyRequisition['lines'][number]['procurementBucket'];
            unitSi: SupplyUnitSi;
            lastQty: number;
            totalQty: number;
            orderCount: number;
        }
    >();

    for (const req of activeReqs) {
        for (const line of req.lines) {
            if (line.lineStatus === 'CANCELLED') continue;
            const existing = bySku.get(line.canonicalSkuId);
            if (!existing) {
                bySku.set(line.canonicalSkuId, {
                    canonicalSkuId: line.canonicalSkuId,
                    itemName: line.itemName,
                    categoryCode: line.categoryCode,
                    procurementBucket: line.procurementBucket,
                    unitSi: line.unitSi,
                    lastQty: line.qtyRequested,
                    totalQty: line.qtyRequested,
                    orderCount: 1,
                });
            } else {
                existing.totalQty = Number((existing.totalQty + line.qtyRequested).toFixed(3));
                existing.orderCount += 1;
            }
        }
    }

    return Array.from(bySku.values())
        .sort((a, b) => b.orderCount - a.orderCount || a.itemName.localeCompare(b.itemName, 'es'))
        .slice(0, 10)
        .map((entry) => ({
            canonicalSkuId: entry.canonicalSkuId,
            itemName: entry.itemName,
            categoryCode: entry.categoryCode,
            procurementBucket: entry.procurementBucket,
            unitSi: entry.unitSi,
            lastQty: entry.lastQty,
            avgQty: Number((entry.totalQty / Math.max(1, entry.orderCount)).toFixed(3)),
            orderCount: entry.orderCount,
        }));
}

async function handleCampOrderFlow(
    action: string,
    body: DecryptedWhatsAppFlowBody,
    claims: SignedFlowTokenClaims,
    member: VerifiedFlowMember,
    options: { nowMs: number; ipAddress?: string }
): Promise<WhatsAppFlowResponse> {
    if (member.isReadOnly) {
        return buildFlowErrorResponse(
            'CAMP_REORDER_SELECT',
            'SUPPLY_RBAC_READ_ONLY',
            'Su perfil es de solo lectura y no puede emitir requisiciones.'
        );
    }

    const flowScope = await DynamicChannelScopeResolver.resolveScope({
        tenantId: claims.tenantId,
        siteId: claims.siteId,
        uid: member.memberUid,
        displayName: member.displayName,
        role: member.supplyProfile.role,
        phoneE164: member.phoneE164,
        licensedForControlledItems: member.supplyProfile.licensedForControlledItems,
    });

    const recentReqs = await SupplyRepository.listRequisitions(claims.tenantId, {
        siteId: claims.siteId,
        limit: 25,
    });
    const nonCancelledReqs = recentReqs.filter((r) => r.status !== 'CANCELLED');
    const lastConfirmedReq = nonCancelledReqs[0] || null;
    const allFrequentSkus = summarizeFrequentSkus(nonCancelledReqs);
    const frequentSkus = allFrequentSkus.filter(
        (sku) =>
            DynamicChannelScopeResolver.evaluateItemAgainstScope({
                canonicalSkuId: sku.canonicalSkuId,
                categoryCode: sku.categoryCode,
                scope: flowScope,
            }).allowed
    );

    if (action === 'INIT' || action === 'BACK') {
        return {
            version: '3.0',
            screen: 'CAMP_REORDER_SELECT',
            data: {
                ok: true,
                flow_type: 'CAMP_ORDER',
                flow_id: SUPPLY_WHATSAPP_FLOW_IDS.CAMP_ORDER,
                site_id: claims.siteId,
                has_reorder_template: Boolean(lastConfirmedReq),
                last_requisition_id: lastConfirmedReq?.reqId || null,
                last_order_summary: lastConfirmedReq
                    ? lastConfirmedReq.lines
                          .map((l) => `${l.itemName} (${l.qtyRequested} ${l.unitSi})`)
                          .join(', ')
                    : '',
                frequent_skus: frequentSkus,
                reorder_options: frequentSkus.map((sku) => ({
                    id: sku.canonicalSkuId,
                    title: `${sku.itemName} (${sku.lastQty} ${sku.unitSi})`.slice(0, 30),
                })),
            },
        };
    }

    const payload = (body.data || {}) as Record<string, any>;
    const modeUpper = String(payload.mode || '').trim().toUpperCase();
    const isOneTapReorder =
        modeUpper === 'ONE_TAP_REORDER' || payload.reorder_last === true || Boolean(payload.source_req_id);

    interface NormalizedOrderCandidate {
        itemKey: string;
        rawText: string;
        canonicalSkuId: string;
        itemName: string;
        categoryCode: SupplyRequisition['lines'][number]['categoryCode'];
        procurementBucket: SupplyRequisition['lines'][number]['procurementBucket'];
        unitSi: SupplyUnitSi;
        qtyRequested: number;
        urgency: SupplyUrgency;
        isCapexAsset: boolean;
        isControlled: boolean;
        estimatedUnitClp?: number;
    }

    const orderCandidates: NormalizedOrderCandidate[] = [];

    // 1. 1-Tap Re-Order desde última orden confirmada o SKUs seleccionados
    if (isOneTapReorder) {
        const requestedSourceId = String(payload.source_req_id || payload.sourceReqId || '').trim();
        const templateReq = requestedSourceId
            ? nonCancelledReqs.find((r) => r.reqId === requestedSourceId) || null
            : lastConfirmedReq;

        const selectedSkuIds = Array.isArray(payload.selected_sku_ids)
            ? new Set(payload.selected_sku_ids.map((id: unknown) => String(id).trim()).filter(Boolean))
            : null;
        const multiplier =
            typeof payload.qty_multiplier === 'number' &&
            Number.isFinite(payload.qty_multiplier) &&
            payload.qty_multiplier > 0
                ? Math.min(10, payload.qty_multiplier)
                : 1;

        if (templateReq) {
            const selectedLines = templateReq.lines.filter(
                (l) =>
                    l.lineStatus !== 'CANCELLED' &&
                    (!selectedSkuIds || selectedSkuIds.size === 0 || selectedSkuIds.has(l.canonicalSkuId))
            );
            for (let i = 0; i < selectedLines.length; i++) {
                const line = selectedLines[i];
                const seed = SupplyRepository.resolveCanonicalSkuFromSeed(line.canonicalSkuId);
                orderCandidates.push({
                    itemKey: `reorder_${i + 1}`,
                    rawText: line.rawRequestedText || line.itemName,
                    canonicalSkuId: line.canonicalSkuId,
                    itemName: line.itemName,
                    categoryCode: line.categoryCode,
                    procurementBucket: line.procurementBucket,
                    unitSi: line.unitSi,
                    qtyRequested: Math.max(0.001, Number((line.qtyRequested * multiplier).toFixed(3))),
                    urgency: line.urgency || 'STANDARD',
                    isCapexAsset: Boolean(seed?.isCapexAsset),
                    isControlled: Boolean(seed?.isControlled),
                    estimatedUnitClp: line.estimatedUnitClp ?? seed?.referenceUnitPriceClp,
                });
            }
        } else if (selectedSkuIds && selectedSkuIds.size > 0) {
            for (const skuId of selectedSkuIds) {
                const freq = frequentSkus.find((f) => f.canonicalSkuId === skuId);
                if (!freq) continue;
                const seed = SupplyRepository.resolveCanonicalSkuFromSeed(freq.canonicalSkuId);
                orderCandidates.push({
                    itemKey: `freq_${skuId}`,
                    rawText: freq.itemName,
                    canonicalSkuId: freq.canonicalSkuId,
                    itemName: freq.itemName,
                    categoryCode: freq.categoryCode,
                    procurementBucket: freq.procurementBucket,
                    unitSi: freq.unitSi,
                    qtyRequested: Math.max(0.001, Number((freq.lastQty * multiplier).toFixed(3))),
                    urgency: 'STANDARD',
                    isCapexAsset: Boolean(seed?.isCapexAsset),
                    isControlled: Boolean(seed?.isControlled),
                    estimatedUnitClp: seed?.referenceUnitPriceClp,
                });
            }
        } else if (!Array.isArray(payload.items) && !payload.item_text) {
            return buildFlowErrorResponse(
                'CAMP_REORDER_SELECT',
                'NO_PRIOR_ORDER_FOR_REORDER',
                'No existe una requisición previa confirmada en esta faena para 1-Tap Re-Order.'
            );
        }
    }

    // 2. Ítems explícitos en arreglo `data.items` o campos `item_text` + `qty`
    const rawItemsList: Array<Record<string, any>> = [];
    if (Array.isArray(payload.items)) {
        for (const it of payload.items) {
            if (it && typeof it === 'object') rawItemsList.push(it);
        }
    }
    if (typeof payload.item_text === 'string' && payload.item_text.trim()) {
        rawItemsList.push({
            rawText: payload.item_text.trim(),
            qty: Number(payload.qty ?? 1),
            unitRaw: typeof payload.unit === 'string' ? payload.unit.trim() : undefined,
            urgency: payload.urgency,
        });
    }

    for (let i = 0; i < rawItemsList.length; i++) {
        const raw = rawItemsList[i];
        const rawText = String(raw.rawText || raw.itemName || raw.description || '').trim();
        if (!rawText) continue;
        const parsedQty = Number(raw.qty ?? raw.qtyRequested ?? raw.quantity ?? 1);
        const qtyVal = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
        const unitRaw = typeof raw.unitRaw === 'string' ? raw.unitRaw : typeof raw.unitSi === 'string' ? raw.unitSi : undefined;

        const norm = normalizeSupplyItemFromText(rawText, qtyVal, unitRaw);
        const seed = SupplyRepository.resolveCanonicalSkuFromSeed(
            String(raw.canonicalSkuId || norm.canonicalSkuId || rawText)
        );
        const urgencyRaw = String(raw.urgency || 'STANDARD').trim().toUpperCase();
        const urgency: SupplyUrgency =
            urgencyRaw === 'CRITICAL' ||
            urgencyRaw === 'HIGH' ||
            urgencyRaw === 'STANDARD' ||
            urgencyRaw === 'PLANNED' ||
            urgencyRaw === 'LOW'
                ? urgencyRaw
                : 'STANDARD';

        orderCandidates.push({
            itemKey: `custom_${i + 1}`,
            rawText,
            canonicalSkuId: String(raw.canonicalSkuId || seed?.canonicalSkuId || norm.canonicalSkuId),
            itemName: String(raw.itemName || seed?.name || norm.itemName || rawText),
            categoryCode: (raw.categoryCode || seed?.categoryCode || norm.categoryCode) as SupplyRequisition['lines'][number]['categoryCode'],
            procurementBucket: (raw.procurementBucket ||
                seed?.procurementBucket ||
                norm.procurementBucket) as SupplyRequisition['lines'][number]['procurementBucket'],
            unitSi: (raw.unitSi || seed?.baseUnitSi || norm.unitSi) as SupplyUnitSi,
            qtyRequested: norm.qtySi ?? qtyVal,
            urgency,
            isCapexAsset: Boolean(norm.isCapexAsset || seed?.isCapexAsset),
            isControlled: Boolean(seed?.isControlled),
            estimatedUnitClp:
                typeof raw.estimatedUnitClp === 'number'
                    ? raw.estimatedUnitClp
                    : seed?.referenceUnitPriceClp,
        });
    }

    if (orderCandidates.length === 0) {
        return buildFlowErrorResponse(
            'CAMP_REORDER_SELECT',
            'EMPTY_ORDER_ITEMS',
            'Debe seleccionar al menos un insumo o activar 1-Tap Re-Order con una orden previa.'
        );
    }

    // 3. Validación determinista DS 132 / DGMN / Banderas Atípicas vía `SupplyPolicyAndAnomalyEngine`
    const site = await SupplyRepository.getSite(claims.tenantId, claims.siteId).catch(() => null);
    const nowIso = new Date(options.nowMs).toISOString();

    const policyCandidates: PolicyItemCandidate[] = orderCandidates.map((c) => ({
        itemKey: c.itemKey,
        rawText: c.rawText,
        canonicalSkuId: c.canonicalSkuId,
        categoryCode: c.categoryCode,
        quantitySi: c.qtyRequested,
        unitSi: c.unitSi,
        estimatedUnitClp: c.estimatedUnitClp,
        isCapexAsset: c.isCapexAsset,
        isControlled: c.isControlled,
    }));

    const policyEval = evaluateRequisitionPolicy(policyCandidates, {
        memberProfile: {
            role: member.supplyProfile.role,
            allowedCategories: member.supplyProfile.allowedCategories || [],
            deniedCategories: member.supplyProfile.deniedCategories || [],
            maxRequisitionClp:
                typeof member.supplyProfile.maxRequisitionClp === 'number'
                    ? member.supplyProfile.maxRequisitionClp
                    : undefined,
            canRecordDirectPurchase: Boolean(member.supplyProfile.canRecordDirectPurchase),
            autoApproveDirectPurchase: Boolean(member.supplyProfile.autoApproveDirectPurchase),
            allowCapex: Boolean(member.supplyProfile.allowCapex),
            licensedForControlledItems: Boolean(member.supplyProfile.licensedForControlledItems),
            defaultCostCenter: member.supplyProfile.defaultCostCenter || 'CC-CAMP-ALIMENTACION',
            assignedSiteIds: member.supplyProfile.assignedSiteIds || [],
            communicationStyle: {
                register: member.supplyProfile.communicationStyle?.register || 'COLLOQUIAL_FIELD',
                preferredModality: member.supplyProfile.communicationStyle?.preferredModality || 'HYBRID',
                dialect: (member.supplyProfile.communicationStyle?.dialect || 'es-CL') as
                    | 'es-CL'
                    | 'es-PE'
                    | 'es-AR'
                    | 'pt-BR'
                    | 'en-US',
            },
        },
        requesterRole: member.supplyProfile.role,
        demandNature: 'REACTIVE_FIELD',
        roleMismatchMode: site?.roleMismatchMode || 'FLAG_AND_ACCEPT',
        nowIso,
        recentRequisitions: nonCancelledReqs.flatMap((req) =>
            req.lines.map((l) => ({
                canonicalSkuId: l.canonicalSkuId,
                requestedAtIso: req.createdAt,
                qtyRequestedSi: l.qtyRequested,
            }))
        ),
    });

    for (const rej of policyEval.rejectedItems) {
        const isDgmn =
            rej.rejectionCode === 'DGMN_EXPLOSIVES_BLOCK' ||
            rej.rejectionCode === 'CONTROLLED_LICENSE_REQUIRED';
        await SupplyRepository.recordPolicyAudit({
            tenantId: claims.tenantId,
            siteId: claims.siteId,
            actorUid: member.memberUid,
            eventType: isDgmn
                ? 'DGMN_EXPLOSIVES_BLOCK'
                : rej.rejectionCode === 'ROLE_MISMATCH_STRICT_BLOCK'
                  ? 'ROLE_MISMATCH_BLOCK'
                  : 'POLICY_HARD_DENY',
            policyCode: rej.rejectionCode,
            severity: isDgmn || rej.rejectionCode.startsWith('DS132_') ? 'CRITICAL' : 'HIGH',
            rawItemText: rej.rawText,
            details: {
                channel: 'WHATSAPP_FLOW_V3',
                flowId: SUPPLY_WHATSAPP_FLOW_IDS.CAMP_ORDER,
                matchedTerm: rej.matchedTerm || null,
                reasonSpanish: rej.reasonSpanish,
            },
        });
    }

    if (policyEval.acceptedItems.length === 0) {
        const firstRej = policyEval.rejectedItems[0];
        return buildFlowErrorResponse(
            'CAMP_REORDER_SELECT',
            firstRej?.rejectionCode || 'POLICY_HARD_DENY',
            policyEval.politeRejectionSummarySpanish ||
                firstRej?.reasonSpanish ||
                'Solicitud rechazada por política DS 132 / DGMN.',
            {
                rejected_items: policyEval.rejectedItems,
            }
        );
    }

    const acceptedByKey = new Map(policyEval.acceptedItems.map((a) => [a.itemKey, a]));
    const scopeRejectedItems: Array<{
        itemKey: string;
        rawText: string;
        rejectionCode: string;
        reasonSpanish: string;
        matchedTerm?: string;
    }> = [...policyEval.rejectedItems];
    const scopeAuditIds: string[] = [];

    const scopeFilteredCandidates = [];
    for (const c of orderCandidates) {
        if (!acceptedByKey.has(c.itemKey)) continue;
        const scopeCheck = DynamicChannelScopeResolver.evaluateItemAgainstScope({
            canonicalSkuId: c.canonicalSkuId,
            categoryCode: c.categoryCode,
            isCapexAsset: c.isCapexAsset,
            scope: flowScope,
        });
        if (!scopeCheck.allowed) {
            const code = scopeCheck.rejectionCode || 'CHANNEL_SCOPE_DENIED';
            const audit = await SupplyRepository.recordPolicyAudit({
                tenantId: claims.tenantId,
                siteId: claims.siteId,
                actorUid: member.memberUid,
                eventType:
                    code === 'DGMN_EXPLOSIVES_BLOCK' || code === 'CONTROLLED_LICENSE_REQUIRED'
                        ? 'DGMN_EXPLOSIVES_BLOCK'
                        : 'POLICY_HARD_DENY',
                policyCode: code,
                severity: code === 'DGMN_EXPLOSIVES_BLOCK' ? 'CRITICAL' : 'HIGH',
                rawItemText: c.rawText,
                details: {
                    channel: 'WHATSAPP_FLOW_V3',
                    flowId: SUPPLY_WHATSAPP_FLOW_IDS.CAMP_ORDER,
                    requiredChannel: scopeCheck.requiredChannel,
                    effectiveChannels: flowScope.effectiveChannels,
                    scopeFingerprint: flowScope.scopeFingerprint,
                    reasonSpanish: scopeCheck.reasonSpanish,
                },
            });
            scopeAuditIds.push(audit.auditId);
            scopeRejectedItems.push({
                itemKey: c.itemKey,
                rawText: c.rawText,
                rejectionCode: code,
                reasonSpanish:
                    scopeCheck.reasonSpanish ||
                    `Ítem fuera de los canales habilitados para tu perfil.`,
                matchedTerm: scopeCheck.requiredChannel,
            });
            continue;
        }
        scopeFilteredCandidates.push(c);
    }

    if (scopeFilteredCandidates.length === 0) {
        const firstRej = scopeRejectedItems[0];
        return buildFlowErrorResponse(
            'CAMP_REORDER_SELECT',
            firstRej?.rejectionCode || 'CHANNEL_SCOPE_DENIED',
            firstRej?.reasonSpanish ||
                'Los ítems seleccionados no pertenecen a tus canales habilitados.',
            {
                rejected_items: scopeRejectedItems,
            }
        );
    }

    const acceptedOrderLines = scopeFilteredCandidates.map((c, idx) => {
        const evalItem = acceptedByKey.get(c.itemKey)!;
        return {
            lineId: `fline_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
            canonicalSkuId: c.canonicalSkuId,
            itemName: c.itemName,
            categoryCode: c.categoryCode,
            procurementBucket: c.procurementBucket,
            unitSi: c.unitSi,
            rawRequestedText: c.rawText,
            qtyRequested: c.qtyRequested,
            qtyPurchased: 0,
            qtyReceived: 0,
            qtyPending: c.qtyRequested,
            lineStatus: 'OPEN' as const,
            atypicalFlags: [...evalItem.atypicalFlags] as AtypicalFlagCode[],
            fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE' as const,
            urgency: c.urgency,
            estimatedUnitClp: c.estimatedUnitClp,
        };
    });

    const aggregateFlags = Array.from(
        new Set(acceptedOrderLines.flatMap((l) => l.atypicalFlags))
    );

    const createdReq = await SupplyRepository.createRequisition(
        {
            tenantId: claims.tenantId,
            siteId: claims.siteId,
            requesterUid: member.memberUid,
            requesterName: member.displayName,
            requesterRole: member.supplyProfile.role,
            requesterPhoneE164: member.phoneE164,
            demandOrigin: resolveOriginForFlowRole(member.supplyProfile.role),
            demandNature: 'REACTIVE_FIELD',
            costCenter:
                typeof payload.cost_center === 'string' && payload.cost_center.trim()
                    ? payload.cost_center.trim().slice(0, 64)
                    : 'CC-CAMP-ALIMENTACION',
            atypicalFlags: aggregateFlags,
            notes: isOneTapReorder
                ? `[WA_FLOW_1TAP_REORDER] ${typeof payload.notes === 'string' ? payload.notes.trim() : ''}`.trim()
                : typeof payload.notes === 'string' && payload.notes.trim()
                  ? `[WA_FLOW_CAMP] ${payload.notes.trim()}`
                  : '[WA_FLOW_CAMP]',
            lines: acceptedOrderLines,
        },
        buildActor(member, options.ipAddress)
    );

    await ConversationAuditService.appendTurn({
        tenantId: claims.tenantId,
        profileId: flowScope.profileId,
        displayName: member.displayName,
        role: member.supplyProfile.role,
        phoneE164: member.phoneE164,
        siteId: claims.siteId,
        direction: 'OUTBOUND',
        channelSource: 'WHATSAPP_FLOW_V3',
        rawContent: `Flow ${SUPPLY_WHATSAPP_FLOW_IDS.CAMP_ORDER} confirmado: ${createdReq.reqId} (${createdReq.lines.length} líneas).`,
        scopeSnapshot: flowScope.scopeSnapshot,
        policyAuditRefs: scopeAuditIds,
        linkedRequisitionIds: [createdReq.reqId],
    }).catch(() => {});

    return {
        version: '3.0',
        screen: 'SUCCESS',
        data: {
            ok: true,
            flow_type: 'CAMP_ORDER',
            reqId: createdReq.reqId,
            status: createdReq.status,
            lineCount: createdReq.lines.length,
            oneTapReorder: isOneTapReorder,
            atypicalFlags: createdReq.atypicalFlags,
            rejected_items: scopeRejectedItems,
            extension_message_response: {
                params: {
                    flow_token: body.flow_token || '',
                    reqId: createdReq.reqId,
                    status: createdReq.status,
                    lineCount: createdReq.lines.length,
                },
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Flow 3: RECEPTION_4WAY (`MINREPORT_WAREHOUSE_4WAY` — Recepción Bodega 4-Way)
// ---------------------------------------------------------------------------

function summarizePendingPurchase(purchase: SupplyPurchase) {
    const inTransitLines = (purchase.lines as Array<
        SupplyPurchase['lines'][number] & { qtyReceivedSoFar?: number }
    >).filter((l) => l.destination === 'STOCK_IN_TRANSIT');

    return {
        purchaseId: purchase.purchaseId,
        supplierName: purchase.supplierName,
        documentType: purchase.documentType,
        folio: purchase.folio,
        receptionStatus: purchase.receptionStatus,
        lines: inTransitLines.map((l) => {
            const receivedSoFar = Number(l.qtyReceivedSoFar ?? 0);
            const remaining = Math.max(0, Number((l.qtyPurchased - receivedSoFar).toFixed(3)));
            return {
                purchaseLineId: l.purchaseLineId,
                canonicalSkuId: l.canonicalSkuId,
                description: l.description,
                unitSi: l.unitSi,
                qtyPurchased: l.qtyPurchased,
                qtyReceivedSoFar: receivedSoFar,
                qtyRemaining: remaining,
            };
        }),
    };
}

async function handleReception4WayFlow(
    action: string,
    body: DecryptedWhatsAppFlowBody,
    claims: SignedFlowTokenClaims,
    member: VerifiedFlowMember,
    options: { nowMs: number; ipAddress?: string }
): Promise<WhatsAppFlowResponse> {
    if (member.isReadOnly) {
        return buildFlowErrorResponse(
            'WAREHOUSE_SELECT_PURCHASE',
            'SUPPLY_RBAC_READ_ONLY',
            'Su perfil es de solo lectura y no puede confirmar recepciones de bodega.'
        );
    }

    if (action === 'INIT' || action === 'BACK') {
        const purchases = await SupplyRepository.listPurchases(claims.tenantId, claims.siteId, 50);
        const pending = purchases.filter(
            (p) => p.receptionStatus === 'IN_TRANSIT' || p.receptionStatus === 'PARTIAL_DISCREPANCY'
        );

        return {
            version: '3.0',
            screen: 'WAREHOUSE_SELECT_PURCHASE',
            data: {
                ok: true,
                flow_type: 'RECEPTION_4WAY',
                flow_id: SUPPLY_WHATSAPP_FLOW_IDS.RECEPTION_4WAY,
                site_id: claims.siteId,
                selected_purchase_id: claims.entityId || pending[0]?.purchaseId || null,
                pending_purchases: pending.map(summarizePendingPurchase),
                purchase_options: pending.map((p) => ({
                    id: p.purchaseId,
                    title: `${p.supplierName} · #${p.folio}`.slice(0, 30),
                })),
            },
        };
    }

    const payload = (body.data || {}) as Record<string, any>;
    const purchaseId = String(payload.purchase_id || payload.purchaseId || claims.entityId || '').trim();
    if (!purchaseId) {
        return buildFlowErrorResponse(
            'WAREHOUSE_SELECT_PURCHASE',
            'PURCHASE_ID_REQUIRED',
            'Debe seleccionar una compra en tránsito para confirmar recepción.'
        );
    }

    const rawLines = payload.received_lines ?? payload.receivedLines;
    const defaultWarehouseId =
        typeof (payload.warehouse_id || payload.warehouseId) === 'string' &&
        String(payload.warehouse_id || payload.warehouseId).trim()
            ? String(payload.warehouse_id || payload.warehouseId).trim()
            : undefined;
    let receivedLines: Array<{ purchaseLineId: string; qtyReceived: number }> | undefined;
    let lineDetails:
        | Array<{
              purchaseLineId: string;
              warehouseId?: string;
              shrinkageQty?: number;
              shrinkageReason?: string;
              lotNumber?: string;
              expiryDateIso?: string;
              evidenceCasRef?: any;
          }>
        | undefined;
    if (Array.isArray(rawLines) && rawLines.length > 0) {
        receivedLines = rawLines.map((line: any) => ({
            purchaseLineId: String(line.purchaseLineId || line.purchase_line_id || '').trim(),
            qtyReceived: Number(line.qtyReceived ?? line.qty_received ?? line.qtyReceivedNow ?? 0),
        }));
        lineDetails = rawLines.map((line: any) => ({
            purchaseLineId: String(line.purchaseLineId || line.purchase_line_id || '').trim(),
            warehouseId:
                typeof (line.warehouseId || line.warehouse_id) === 'string' &&
                String(line.warehouseId || line.warehouse_id).trim()
                    ? String(line.warehouseId || line.warehouse_id).trim()
                    : defaultWarehouseId,
            shrinkageQty: Number(line.shrinkageQty ?? line.shrinkage_qty ?? 0) || 0,
            shrinkageReason:
                typeof (line.shrinkageReason || line.shrinkage_reason) === 'string'
                    ? String(line.shrinkageReason || line.shrinkage_reason).trim().slice(0, 240)
                    : undefined,
            lotNumber:
                typeof (line.lotNumber || line.lot_number) === 'string'
                    ? String(line.lotNumber || line.lot_number).trim().slice(0, 80)
                    : undefined,
            expiryDateIso:
                typeof (line.expiryDateIso || line.expiry_date_iso) === 'string'
                    ? String(line.expiryDateIso || line.expiry_date_iso).trim().slice(0, 40)
                    : undefined,
            evidenceCasRef: line.evidenceCasRef ?? line.evidence_cas_ref ?? undefined,
        }));
    }

    try {
        const result = await SupplyRepository.confirmPurchaseReception(
            {
                tenantId: claims.tenantId,
                purchaseId,
                warehouseId: defaultWarehouseId,
                receivedLines,
                lineDetails,
                evidenceCasRef: payload.evidenceCasRef ?? payload.evidence_cas_ref ?? undefined,
                notes:
                    typeof payload.notes === 'string' && payload.notes.trim()
                        ? `[WA_FLOW_4WAY] ${payload.notes.trim().slice(0, 450)}`
                        : '[WA_FLOW_4WAY]',
            },
            buildActor(member, options.ipAddress)
        );

        return {
            version: '3.0',
            screen: 'SUCCESS',
            data: {
                ok: true,
                flow_type: 'RECEPTION_4WAY',
                purchaseId: result.purchase.purchaseId,
                receptionStatus: result.purchase.receptionStatus,
                receptionOutcome: result.receptionOutcome,
                receivedItemCount: result.receivedItemCount,
                affectedRequisitionIds: result.affectedRequisitions.map((r) => r.reqId),
                discrepancies: result.discrepancies,
                urgentRcvAlert: result.urgentRcvAlert,
                suggestCreditNote61: result.suggestCreditNote61,
                extension_message_response: {
                    params: {
                        flow_token: body.flow_token || '',
                        purchaseId: result.purchase.purchaseId,
                        receptionStatus: result.purchase.receptionStatus,
                        receptionOutcome: result.receptionOutcome,
                        discrepanciesCount: result.discrepancies.length,
                    },
                },
            },
        };
    } catch (err: any) {
        if (
            err instanceof SupplyConflictError ||
            err instanceof SupplyValidationError ||
            err instanceof SupplyNotFoundError ||
            err instanceof SupplyForbiddenError
        ) {
            return buildFlowErrorResponse('WAREHOUSE_SELECT_PURCHASE', err.code, err.message);
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Flow 4: HITL_APPROVAL (`MINREPORT_EXEC_HITL_APPROVAL` — Aprobación Gerencial HITL)
// ---------------------------------------------------------------------------

function canExecuteHitlApproval(member: VerifiedFlowMember): boolean {
    if (member.isReadOnly) return false;
    return (
        member.supplyProfile.role === 'OWNER_EXEC' ||
        member.supplyProfile.role === 'SITE_ADMIN' ||
        member.b2bRole === 'OWNER' ||
        member.b2bRole === 'ADMIN'
    );
}

async function handleHitlApprovalFlow(
    action: string,
    body: DecryptedWhatsAppFlowBody,
    claims: SignedFlowTokenClaims,
    member: VerifiedFlowMember,
    options: { nowMs: number; ipAddress?: string }
): Promise<WhatsAppFlowResponse> {
    if (!canExecuteHitlApproval(member)) {
        return buildFlowErrorResponse(
            'EXEC_HITL_REVIEW',
            'SUPPLY_RBAC_APPROVAL_REQUIRED',
            'Solo perfiles OWNER_EXEC o SITE_ADMIN pueden ejecutar aprobaciones gerenciales HITL.'
        );
    }

    const payload = (body.data || {}) as Record<string, any>;
    const targetId = String(payload.entity_id || payload.entityId || claims.entityId || '').trim();
    const rawKind = String(payload.entity_kind || payload.entityKind || claims.entityKind || '')
        .trim()
        .toUpperCase();
    const entityKind: 'EXPENSE_REPORT' | 'REQUISITION' =
        rawKind === 'REQUISITION' || (!rawKind && targetId.startsWith('req_'))
            ? 'REQUISITION'
            : 'EXPENSE_REPORT';

    if (action === 'INIT' || action === 'BACK') {
        if (entityKind === 'EXPENSE_REPORT') {
            const report = targetId
                ? await SupplyRepository.getExpenseReport(claims.tenantId, targetId)
                : (await SupplyRepository.listExpenseReports(claims.tenantId, claims.siteId, 20)).find(
                      (r) => r.status === 'SUBMITTED' || r.status === 'OPEN'
                  ) || null;

            if (!report) {
                return buildFlowErrorResponse(
                    'EXEC_HITL_REVIEW',
                    'SUPPLY_ENTITY_NOT_FOUND',
                    'No se encontró rendición SII pendiente para revisión HITL.'
                );
            }

            return {
                version: '3.0',
                screen: 'EXEC_HITL_REVIEW',
                data: {
                    ok: true,
                    flow_type: 'HITL_APPROVAL',
                    flow_id: SUPPLY_WHATSAPP_FLOW_IDS.HITL_APPROVAL,
                    entity_kind: 'EXPENSE_REPORT',
                    entity_id: report.reportId,
                    title: report.title,
                    custodian_uid: report.custodianUid,
                    custodian_name: report.custodianName,
                    rendered_total_clp: report.renderedTotalClp,
                    fund_advance_clp: report.fundAdvanceClp,
                    balance_clp: report.balanceClp,
                    status: report.status,
                    requires_keyword: 'ACTUALIZAR',
                    summary_text: `${report.title} · Custodio: ${report.custodianName} · Rendido CLP ${report.renderedTotalClp}`,
                },
            };
        }

        const reqs = await SupplyRepository.listRequisitions(claims.tenantId, {
            siteId: claims.siteId,
            limit: 25,
        });
        const targetReq = targetId
            ? reqs.find((r) => r.reqId === targetId) || null
            : reqs.find((r) => r.status === 'DRAFT' || r.atypicalFlags.length > 0) || null;

        if (!targetReq) {
            return buildFlowErrorResponse(
                'EXEC_HITL_REVIEW',
                'SUPPLY_ENTITY_NOT_FOUND',
                'No se encontró requisición atípica pendiente para revisión HITL.'
            );
        }

        return {
            version: '3.0',
            screen: 'EXEC_HITL_REVIEW',
            data: {
                ok: true,
                flow_type: 'HITL_APPROVAL',
                flow_id: SUPPLY_WHATSAPP_FLOW_IDS.HITL_APPROVAL,
                entity_kind: 'REQUISITION',
                entity_id: targetReq.reqId,
                requester_uid: targetReq.requesterUid,
                requester_name: targetReq.requesterName,
                atypical_flags: targetReq.atypicalFlags,
                line_count: targetReq.lines.length,
                status: targetReq.status,
                requires_keyword: 'ACTUALIZAR',
                summary_text: `Req ${targetReq.reqId} · ${targetReq.requesterName} · Flags: ${targetReq.atypicalFlags.join(', ') || 'REVIEW'}`,
            },
        };
    }

    // Compuerta SpaceX Dragon HITL obligatoria: palabra exacta "ACTUALIZAR"
    const confirmationKeyword = String(
        payload.confirmation_keyword ?? payload.confirmationKeyword ?? ''
    ).trim();
    if (confirmationKeyword !== 'ACTUALIZAR') {
        return buildFlowErrorResponse(
            'EXEC_HITL_REVIEW',
            'HITL_KEYWORD_REQUIRED',
            'Compuerta HITL obligatoria: debe escribir exactamente "ACTUALIZAR" para confirmar la resolución.'
        );
    }

    if (!targetId) {
        return buildFlowErrorResponse(
            'EXEC_HITL_REVIEW',
            'ENTITY_ID_REQUIRED',
            'Identificador de entidad requerido para ejecutar aprobación HITL.'
        );
    }

    const decisionUpper = String(payload.decision || 'APPROVE').trim().toUpperCase();
    const decision: 'APPROVE' | 'REJECT' = decisionUpper === 'REJECT' ? 'REJECT' : 'APPROVE';
    const actor = buildActor(member, options.ipAddress);

    if (entityKind === 'EXPENSE_REPORT') {
        const report = await SupplyRepository.getExpenseReport(claims.tenantId, targetId);
        if (!report) {
            return buildFlowErrorResponse(
                'EXEC_HITL_REVIEW',
                'SUPPLY_ENTITY_NOT_FOUND',
                'Rendición SII no encontrada para la cuenta activa.'
            );
        }

        // Segregación financiera ISO 27001 inviolable: el custodio jamás puede auto-aprobar su rendición
        if (report.custodianUid === member.memberUid) {
            return buildFlowErrorResponse(
                'EXEC_HITL_REVIEW',
                'SELF_APPROVAL_FORBIDDEN',
                'Segregación financiera ISO 27001: el custodio no puede auto-aprobar su propia rendición SII.'
            );
        }

        const nextStatus = decision === 'REJECT' ? 'REJECTED' : 'APPROVED';
        const updated = await SupplyRepository.updateExpenseReportStatus(
            claims.tenantId,
            report.reportId,
            nextStatus,
            actor
        );

        return {
            version: '3.0',
            screen: 'SUCCESS',
            data: {
                ok: true,
                flow_type: 'HITL_APPROVAL',
                entity_kind: 'EXPENSE_REPORT',
                entity_id: updated.reportId,
                decision,
                status: updated.status,
                hitlConfirmed: true,
                extension_message_response: {
                    params: {
                        flow_token: body.flow_token || '',
                        entity_id: updated.reportId,
                        decision,
                        status: updated.status,
                    },
                },
            },
        };
    }

    const reqSnap = await db.collection(SUPPLY_COLLECTIONS.REQUISITIONS).doc(targetId).get();
    if (!reqSnap?.exists) {
        return buildFlowErrorResponse(
            'EXEC_HITL_REVIEW',
            'SUPPLY_ENTITY_NOT_FOUND',
            'Requisición no encontrada para aprobación HITL.'
        );
    }
    const existingReq = reqSnap.data() as SupplyRequisition;
    if (existingReq.tenantId !== claims.tenantId) {
        return buildFlowErrorResponse(
            'EXEC_HITL_REVIEW',
            'SUPPLY_ENTITY_NOT_FOUND',
            'Requisición no pertenece a la cuenta activa.'
        );
    }

    // Segregación operativa anti auto-aprobación
    if (existingReq.requesterUid === member.memberUid) {
        return buildFlowErrorResponse(
            'EXEC_HITL_REVIEW',
            'SELF_APPROVAL_FORBIDDEN',
            'Segregación operativa ISO 27001: el solicitante no puede auto-aprobar su propia requisición atípica.'
        );
    }

    const nextReqStatus = decision === 'REJECT' ? 'CANCELLED' : 'OPEN';
    const noteText =
        typeof payload.notes === 'string' && payload.notes.trim()
            ? `[HITL_FLOW_${decision}] ${payload.notes.trim().slice(0, 450)}`
            : `[HITL_FLOW_${decision}] Resolución gerencial confirmada vía WhatsApp Flow v3.0.`;

    const updatedReq = await SupplyRepository.updateRequisitionStatus(
        claims.tenantId,
        existingReq.reqId,
        {
            status: nextReqStatus,
            notes: noteText,
        },
        actor
    );

    return {
        version: '3.0',
        screen: 'SUCCESS',
        data: {
            ok: true,
            flow_type: 'HITL_APPROVAL',
            entity_kind: 'REQUISITION',
            entity_id: updatedReq.reqId,
            decision,
            status: updatedReq.status,
            hitlConfirmed: true,
            extension_message_response: {
                params: {
                    flow_token: body.flow_token || '',
                    entity_id: updatedReq.reqId,
                    decision,
                    status: updatedReq.status,
                },
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Dispatcher Principal `SupplyFlowsHandler`
// ---------------------------------------------------------------------------

export class SupplyFlowsHandler {
    public static async handle(
        decryptedBody: DecryptedWhatsAppFlowBody,
        options?: SupplyFlowHandleOptions
    ): Promise<WhatsAppFlowResponse> {
        const action = String(decryptedBody?.action || '').trim();
        const nowMs =
            typeof options?.nowMs === 'number' && Number.isFinite(options.nowMs)
                ? options.nowMs
                : Date.now();

        // Health check oficial Meta Flows v3.0
        if (action === 'ping') {
            return {
                version: '3.0',
                data: {
                    status: 'active',
                },
            };
        }

        const secret =
            options?.tokenSecret?.trim() || (await resolveFlowTokenSigningSecret()) || '';
        if (!secret) {
            return buildFlowErrorResponse(
                'FLOW_ERROR',
                'FLOW_TOKEN_SECRET_UNCONFIGURED',
                'Secreto de verificación flow_token no configurado en Secret Manager.'
            );
        }

        let claims: SignedFlowTokenClaims;
        try {
            claims = verifySignedFlowToken(decryptedBody?.flow_token, secret, nowMs);
        } catch (err) {
            if (err instanceof WhatsAppFlowTokenError) {
                return buildFlowErrorResponse('FLOW_ERROR', err.code, err.message);
            }
            return buildFlowErrorResponse(
                'FLOW_ERROR',
                'FLOW_TOKEN_INVALID',
                'flow_token inválido o rechazado.'
            );
        }

        const authz = await resolveAndAuthorizeFlowMember(claims);
        if (!authz.ok) {
            return buildFlowErrorResponse('FLOW_ERROR', authz.errorCode, authz.errorMessage);
        }

        const ctxOptions = { nowMs, ipAddress: options?.ipAddress };

        switch (claims.flowType) {
            case 'OPT_IN':
                return handleOptInFlow(action, decryptedBody, claims, authz.member, ctxOptions);
            case 'CAMP_ORDER':
                return handleCampOrderFlow(action, decryptedBody, claims, authz.member, ctxOptions);
            case 'RECEPTION_4WAY':
                return handleReception4WayFlow(action, decryptedBody, claims, authz.member, ctxOptions);
            case 'HITL_APPROVAL':
                return handleHitlApprovalFlow(action, decryptedBody, claims, authz.member, ctxOptions);
            default:
                return buildFlowErrorResponse(
                    'FLOW_ERROR',
                    'UNSUPPORTED_FLOW_TYPE',
                    'Tipo de WhatsApp Flow no soportado.'
                );
        }
    }
}
