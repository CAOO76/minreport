import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../../config/firebase';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import { normalizeE164Phone } from '../../../utils/taxIdValidator';
import {
    EmailAndWhatsAppNotifier,
    type SupplyNotificationRecipient,
} from '../adapters/EmailAndWhatsAppNotifier';
import {
    type InboundWhatsAppMessage,
    MetaWhatsAppCloudAdapter,
} from '../adapters/MetaWhatsAppCloudAdapter';
import {
    type AnalyzedReceiptResult,
    ReceiptIntelligencePipeline,
} from '../application/ReceiptIntelligencePipeline';
import { SUPPLY_COLLECTIONS, SupplyRepository } from '../application/SupplyRepository';
import { SupplyTaskQueueService } from '../application/SupplyTaskQueueService';
import type { MediaDigestionProfile } from '../../../contracts/media.contracts';
import {
    type AtypicalFlagCode,
    checkGlobalHardDeny,
    evaluateAtypicalFlagsForLine,
    type EvidenceCasRef,
    maskPiiForLog,
    normalizeSupplyItemFromText,
    type PaymentMethod,
    type ProcurementBucket,
    type PurchaseMode,
    SUPPLY_AI_MODULE,
    type SupplyCategoryCode,
    type SupplyDemandOrigin,
    type SupplyMemberProfile,
    SupplyMemberProfileSchema,
    type SupplyOperationalRole,
    type SupplyRequisition,
    type SupplyUnitSi,
} from '../application/supply.types';

/**
 * WHATSAPP CAMPAMENTO CHANNEL + EXECUTIVE DIRECT PURCHASE SHORTCUT (`camp.channel.ts`)
 *
 * Sub-módulo conversacional soberano para MINREPORT · ABASTECIMIENTO:
 * - Resolución de identidad por teléfono E.164 en `accounts/* /members` + verificación
 *   estricta de `status === 'ACTIVE'` y `whatsappOptInAt` (Ley N° 21.719).
 * - Idempotencia atómica por `wamid` + buffer de debounce de turno (8–15s) en
 *   `supply_whatsapp_sessions` para consolidar ráfagas de mensajes en 1 sola llamada IA y 1 burbuja.
 * - Transcripción/extracción multimodal (`.ogg` audio, texto, fotos CAS) exclusivamente vía `ResilientAIClient`.
 * - FSM determinista: `COLLECTING -> POLICY_CHECK -> SLOT_FILLING -> REVIEW_GATE -> COMMITTED`.
 * - Atajo Ejecutivo de Compra Directa (`OWNER_EXEC` / `BUYER` / `SITE_ADMIN`) al reenviar
 *   boleta/factura/PDF/XML sin exigir requisición previa.
 */

export type CampFsmState =
    | 'COLLECTING'
    | 'POLICY_CHECK'
    | 'SLOT_FILLING'
    | 'REVIEW_GATE'
    | 'COMMITTED';

export interface CampDraftItem {
    draftLineId: string;
    canonicalSkuId: string;
    itemName: string;
    rawText: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    qtySi: number | null;
    rawQty?: number | null;
    packagingUnit?: string | null;
    size?: string | null;
    location?: string | null;
    linkedAssetId?: string | null;
    requiredSlots: string[];
    missingSlots: string[];
    atypicalFlags: AtypicalFlagCode[];
    isCapexAsset: boolean;
    evidenceCasRef?: EvidenceCasRef;
}

export interface PendingBufferedTurn {
    wamid: string;
    receivedAtMs: number;
    type: InboundWhatsAppMessage['type'];
    text?: string;
    interactiveReplyId?: string;
    mediaId?: string;
    mimeType?: string;
    caption?: string;
    filename?: string;
    evidenceCasRef?: EvidenceCasRef;
    tedRawXml?: string;
}

export interface WhatsAppCampSession {
    sessionId: string;
    tenantId: string;
    siteId: string;
    memberUid: string;
    memberName: string;
    memberRole: SupplyOperationalRole;
    phoneE164: string;
    fsmState: CampFsmState;
    draftItems: CampDraftItem[];
    deniedNotices: string[];
    pendingDirectPurchaseDraft?: {
        analysis: AnalyzedReceiptResult;
        purchaseMode: PurchaseMode;
        paymentMethod: PaymentMethod;
        createdAt: string;
    } | null;
    pendingBuffer: PendingBufferedTurn[];
    debounceUntilMs: number | null;
    processedWamids: string[];
    version?: number;
    ttlExpiresAt?: unknown;
    lastReplyText?: string;
    lastCommittedReqId?: string;
    lastCommittedPurchaseId?: string;
    updatedAt: string;
}

export type WamidStateStatus = 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface WamidStateRecord {
    wamid: string;
    tenantId: string;
    status: WamidStateStatus;
    attempts: number;
    leaseExpiresAtMs: number;
    dispatchToken?: string | null;
    lastError?: string | null;
    processedAt?: string;
    completedAt?: string;
    failedAt?: string;
    updatedAt: string;
    ttlExpiresAt: unknown;
}

export interface ResolvedWhatsAppMember {
    tenantId: string;
    siteId: string;
    uid: string;
    displayName: string;
    email: string;
    phoneE164: string;
    whatsappOptInAt: string | number;
    b2bRole: string;
    supplyProfile: SupplyMemberProfile;
}

export interface CampChannelProcessResult {
    handled: boolean;
    duplicate?: boolean;
    buffered?: boolean;
    unauthorized?: boolean;
    sessionId?: string;
    fsmState?: CampFsmState;
    replyText?: string;
    replyButtons?: Array<{ id: string; title: string }>;
    deniedItems?: Array<{ rawText: string; reason: string }>;
    atypicalFlags?: AtypicalFlagCode[];
    committedRequisition?: SupplyRequisition;
    committedPurchaseId?: string;
    directPurchaseDraft?: AnalyzedReceiptResult;
}

export interface HandleInboundOptions {
    flushImmediately?: boolean;
    debounceWindowMs?: number;
    inlineMediaBuffer?: Buffer;
    inlineMediaMimeType?: string;
    inlineXmlContent?: string;
    inlineTedRawXml?: string;
    overrideMember?: ResolvedWhatsAppMember;
    skipOutboundSend?: boolean;
    dispatchToken?: string;
}

const DEFAULT_DEBOUNCE_MS = 10_000;
const MIN_DEBOUNCE_MS = 8_000;
const MAX_DEBOUNCE_MS = 15_000;
export const WAMID_LEASE_MS = 60_000;
const MAX_SESSION_TX_RETRIES = 5;

const AiMessageExtractionSchema = z.object({
    transcript: z.string().optional(),
    intent: z
        .enum(['ADD_ITEMS', 'FILL_SLOTS', 'CONFIRM_COMMIT', 'CANCEL', 'STATUS_QUERY', 'UNKNOWN'])
        .optional(),
    items: z
        .array(
            z.object({
                rawText: z.string().min(1).max(200),
                itemName: z.string().min(1).max(160),
                quantity: z.number().positive().nullable().optional(),
                unitRaw: z.string().max(40).nullable().optional(),
                packagingUnit: z.string().max(40).nullable().optional(),
                size: z.string().max(32).nullable().optional(),
                location: z.string().max(120).nullable().optional(),
                linkedAssetId: z.string().max(80).nullable().optional(),
            })
        )
        .optional(),
});

const CONFIRM_REGEX = /^(ok|okay|si|sí|confirmo|confirmar|dale|listo|aprobado|enviar|REQ_CONFIRM|DIRECT_PURCHASE_CONFIRM)$/i;
const CANCEL_REGEX = /^(cancelar|anular|no|borrar|salir|REQ_CANCEL|DIRECT_PURCHASE_CANCEL)$/i;

function clampDebounceMs(rawMs?: number): number {
    if (typeof rawMs !== 'number' || !Number.isFinite(rawMs)) return DEFAULT_DEBOUNCE_MS;
    return Math.min(MAX_DEBOUNCE_MS, Math.max(MIN_DEBOUNCE_MS, Math.round(rawMs)));
}

function buildSessionId(tenantId: string, phoneE164: string): string {
    const hash = crypto.createHash('sha256').update(`${tenantId}::${phoneE164}`).digest('hex').slice(0, 20);
    const safeTenant = tenantId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    return `wasess_${safeTenant}_${hash}`;
}

function deriveSupplyRoleFromMember(memberData: Record<string, any>, isAccountOwner: boolean): SupplyMemberProfile {
    const rawProfile = memberData.supplyProfile || {};
    const b2bRole = String(memberData.role || '').trim().toUpperCase();

    let inferredRole: SupplyOperationalRole = 'CAMP_MANAGER';
    if (rawProfile.role) {
        inferredRole = rawProfile.role;
    } else if (isAccountOwner || b2bRole === 'OWNER') {
        inferredRole = 'OWNER_EXEC';
    } else if (b2bRole === 'ADMIN') {
        inferredRole = 'SITE_ADMIN';
    }

    const canDirect =
        rawProfile.canRecordDirectPurchase !== undefined
            ? Boolean(rawProfile.canRecordDirectPurchase)
            : inferredRole === 'OWNER_EXEC' || inferredRole === 'SITE_ADMIN' || inferredRole === 'BUYER';

    const autoApproveDirect =
        rawProfile.autoApproveDirectPurchase !== undefined
            ? Boolean(rawProfile.autoApproveDirectPurchase)
            : inferredRole === 'OWNER_EXEC';

    const allowCapex =
        rawProfile.allowCapex !== undefined
            ? Boolean(rawProfile.allowCapex)
            : inferredRole === 'OWNER_EXEC' || inferredRole === 'SITE_ADMIN';

    return SupplyMemberProfileSchema.parse({
        ...rawProfile,
        role: inferredRole,
        canRecordDirectPurchase: canDirect,
        autoApproveDirectPurchase: autoApproveDirect,
        allowCapex,
    });
}

function resolveOriginForRole(role: SupplyOperationalRole): SupplyDemandOrigin {
    if (role === 'MECHANIC_TECH') return 'WA_MECHANIC';
    if (role === 'OPS_FOREMAN') return 'WA_OPS';
    if (role === 'WAREHOUSE_KEEPER' || role === 'HSEC_OFFICER') return 'WA_WAREHOUSE_HSEC';
    if (role === 'OWNER_EXEC') return 'WA_EXEC_DIRECT';
    return 'WA_CAMP';
}

function computeMissingSlotsForDraft(item: {
    canonicalSkuId: string;
    categoryCode: SupplyCategoryCode;
    qtySi: number | null;
    packagingUnit?: string | null;
    size?: string | null;
    location?: string | null;
    linkedAssetId?: string | null;
    requiredSlots: string[];
    role: SupplyOperationalRole;
}): string[] {
    const missing: string[] = [];
    if (item.qtySi === null || !Number.isFinite(item.qtySi) || item.qtySi <= 0) {
        missing.push('quantity');
    }
    if (
        item.requiredSlots.includes('packagingUnit') &&
        !item.packagingUnit &&
        (item.qtySi === null || item.qtySi <= 0)
    ) {
        missing.push('packagingUnit');
    }
    if (item.requiredSlots.includes('size') && !item.size) {
        missing.push('size');
    }
    if (item.categoryCode === 'MANTENCION_CAMP' && !item.location) {
        missing.push('location');
    }
    if (item.role === 'MECHANIC_TECH' && item.categoryCode === 'REPUESTOS_MAQUINARIA' && !item.linkedAssetId) {
        missing.push('linkedAssetId');
    }
    return Array.from(new Set(missing));
}

function buildSlotQuestionForItem(item: CampDraftItem): string {
    if (item.canonicalSkuId === 'sku-mantequilla' && item.missingSlots.includes('quantity')) {
        return '¿Cuántos potes o panes de mantequilla?';
    }
    if (item.canonicalSkuId === 'sku-huevos' && item.missingSlots.includes('quantity')) {
        return '¿Cuántas bandejas (30 un) o cuántos huevos?';
    }
    if (item.missingSlots.includes('size')) {
        return `¿Qué talla y cantidad de ${item.itemName.toLowerCase()} necesitas?`;
    }
    if (item.missingSlots.includes('linkedAssetId')) {
        return `¿Para qué equipo/patente interna es el ${item.itemName.toLowerCase()}?`;
    }
    if (item.missingSlots.includes('location')) {
        return `¿En qué sector o pabellón del campamento se requiere ${item.itemName.toLowerCase()}?`;
    }
    return `¿Qué cantidad de ${item.itemName.toLowerCase()} (${item.unitSi}) necesitas?`;
}

/**
 * Parser determinista de cláusulas en español chileno para peticiones de terreno y respuestas de slots.
 */
export function parseDeterministicSpanishSupplyClauses(rawText: string): Array<{
    rawText: string;
    itemName: string;
    quantity: number | null;
    unitRaw: string | null;
    packagingUnit: string | null;
    size: string | null;
}> {
    const cleaned = String(rawText || '')
        .replace(/^(hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|necesito|requiero|por\s+favor|porfa|falta|faltan|pedir|solicito)\b[\s,.:-]*/gi, '')
        .trim();

    if (!cleaned) return [];

    // Separar por comas, saltos de línea, punto y coma o conjunción " y "
    const rawParts = cleaned
        .split(/(?:[\n,;]+|\s+y\s+|\s+e\s+)/i)
        .map((p) => p.replace(/^(?:necesito|requiero|traer|comprar|enviar|mandar|me\s+faltan?|por\s+favor|también|además)\s+/i, '').trim())
        .filter((p) => p.length >= 2);

    const parsed: Array<{
        rawText: string;
        itemName: string;
        quantity: number | null;
        unitRaw: string | null;
        packagingUnit: string | null;
        size: string | null;
    }> = [];

    const sizeRegex = /\btalla\s*([0-9]{2}|xs|s|m|l|xl|xxl)\b/i;
    const qtyUnitItemRegex =
        /^(\d+(?:[.,]\d+)?)\s*(kilos?|kg|g|gr|gramos?|litros?|lt|l|unidades?|un|pares?|par|mallas?|sacos?|bandejas?|maples?|docenas?|potes?|panes?|barras?|paquetes?|cajas?|bolsas?|bidones?|bid[oó]n|balones?|bal[oó]n)?\s*(?:de\s+)?(.+)$/i;

    for (const part of rawParts) {
        const sizeMatch = part.match(sizeRegex);
        const size = sizeMatch ? sizeMatch[1].toUpperCase() : null;
        const partNoSize = part.replace(sizeRegex, '').trim();

        const m = partNoSize.match(qtyUnitItemRegex);
        if (m) {
            const qty = Number(m[1].replace(',', '.'));
            const unitRaw = m[2] ? m[2].trim().toLowerCase() : null;
            const itemName = m[3].trim();
            const packagingUnit =
                unitRaw &&
                /^(pote|potes|pan|panes|barra|barras|bandeja|bandejas|maple|maples|malla|mallas|saco|sacos|paquete|paquetes|caja|cajas|bid[oó]n|bidones|bal[oó]n|balones|docena|docenas)$/i.test(
                    unitRaw
                )
                    ? unitRaw
                    : null;

            if (itemName.length >= 2) {
                parsed.push({
                    rawText: part,
                    itemName,
                    quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
                    unitRaw,
                    packagingUnit,
                    size,
                });
                continue;
            }
        }

        // Ítem sin cantidad declarada (ej. "Mantequilla", "huevos", "filtro hidráulico Caterpillar")
        parsed.push({
            rawText: part,
            itemName: partNoSize || part,
            quantity: null,
            unitRaw: null,
            packagingUnit: null,
            size,
        });
    }

    return parsed;
}

function safeWamidDocId(wamid: string): string {
    return String(wamid || '')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .slice(0, 128);
}

function resolveInboundCasProfile(
    mimeType?: string,
    filename?: string,
    isXmlContent: boolean = false
): MediaDigestionProfile {
    const lowerMime = String(mimeType || '').toLowerCase();
    const lowerFile = String(filename || '').toLowerCase();
    if (isXmlContent || lowerMime.includes('xml') || lowerFile.endsWith('.xml')) {
        return 'XML_DTE_DOCUMENT';
    }
    if (lowerMime.includes('pdf') || lowerFile.endsWith('.pdf')) {
        return 'PDF_HYBRID_OEM';
    }
    if (lowerMime.startsWith('image/')) {
        return 'IMAGE_FIELD_EVIDENCE';
    }
    return 'VIDEO_FIELD_COMPACT';
}

function descriptorToEvidenceCasRef(descriptor: {
    sha256: string;
    phashHex?: string;
    storagePath: string;
    downloadUrl: string;
    mimeType: string;
    extension: string;
    profile: MediaDigestionProfile;
    originalBytes: number;
    optimizedBytes: number;
    savingsRatio: number;
    savingsPct?: number;
    originalFilename?: string;
    createdAt: string;
}): EvidenceCasRef {
    return {
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
}

export class CampChannel {
    /**
     * Serializador local por clave para evitar carreras intra-instancia en pruebas/contención;
     * la autoridad de consistencia entre instancias Cloud Run reside 100% en `db.runTransaction`.
     */
    private static readonly inProcessLocks = new Map<string, Promise<unknown>>();

    private static async withKeyedLock<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
        const previous = this.inProcessLocks.get(lockKey) || Promise.resolve();
        let release!: () => void;
        const nextGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const chained = previous.then(() => nextGate);
        this.inProcessLocks.set(lockKey, chained);

        await previous;
        try {
            return await task();
        } finally {
            release();
            if (this.inProcessLocks.get(lockKey) === chained) {
                this.inProcessLocks.delete(lockKey);
            }
        }
    }

    private static async runSessionTransaction<T>(
        sessionId: string,
        txBody: (tx: FirebaseFirestore.Transaction) => Promise<T>
    ): Promise<T> {
        return this.withKeyedLock(`session:${sessionId}`, async () => {
            let lastErr: unknown;
            for (let attempt = 1; attempt <= MAX_SESSION_TX_RETRIES; attempt++) {
                try {
                    if (typeof db.runTransaction === 'function') {
                        return await db.runTransaction(txBody);
                    }
                    const fallbackTx: any = {
                        get: (ref: any) => ref.get(),
                        set: (ref: any, data: any, opts?: any) => ref.set(data, opts),
                        update: (ref: any, patch: any) => ref.update(patch),
                        delete: (ref: any) => ref.delete(),
                    };
                    return await txBody(fallbackTx);
                } catch (err: any) {
                    lastErr = err;
                    const code = String(err?.code ?? '').toUpperCase();
                    const msg = String(err?.message ?? '').toLowerCase();
                    const retryable =
                        code === '10' ||
                        code === 'ABORTED' ||
                        msg.includes('aborted') ||
                        msg.includes('contention');
                    if (!retryable || attempt >= MAX_SESSION_TX_RETRIES) {
                        throw err;
                    }
                    await new Promise((r) => setTimeout(r, 25 * attempt));
                }
            }
            throw lastErr;
        });
    }

    private static async persistSessionFsmUpdate(
        sessionId: string,
        patch: Partial<
            Pick<
                WhatsAppCampSession,
                | 'fsmState'
                | 'draftItems'
                | 'deniedNotices'
                | 'pendingDirectPurchaseDraft'
                | 'lastReplyText'
                | 'lastCommittedReqId'
                | 'lastCommittedPurchaseId'
            >
        >
    ): Promise<WhatsAppCampSession> {
        const sessionRef = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).doc(sessionId);
        return this.runSessionTransaction(sessionId, async (tx) => {
            const snap = await tx.get(sessionRef);
            const current = (snap.exists ? snap.data() : {}) as WhatsAppCampSession;
            const nextVersion = Number(current.version || 0) + 1;
            const next: WhatsAppCampSession = {
                ...current,
                ...patch,
                version: nextVersion,
                ttlExpiresAt: SupplyRepository.computeWhatsAppSessionTtl(),
                updatedAt: new Date().toISOString(),
            };
            tx.set(sessionRef, next, { merge: true });
            return next;
        });
    }

    /**
     * Resuelve miembro activo y con consentimiento `whatsappOptInAt` buscando por teléfono E.164
     * en `accounts/* /members`.
     */
    public static async resolveMemberByPhone(rawPhone: string): Promise<ResolvedWhatsAppMember | null> {
        const normalizedE164 = normalizeE164Phone(rawPhone);
        if (!normalizedE164 || !/^\+[1-9]\d{6,14}$/.test(normalizedE164)) {
            return null;
        }

        const candidateMatches: Array<{ tenantId: string; uid: string; data: Record<string, any> }> = [];

        // 1. Intento directo vía collectionGroup('members')
        try {
            if (typeof (db as any).collectionGroup === 'function') {
                const cgSnap = await (db as any)
                    .collectionGroup('members')
                    .where('phoneE164', '==', normalizedE164)
                    .limit(10)
                    .get();
                if (cgSnap && !cgSnap.empty) {
                    for (const doc of cgSnap.docs) {
                        const data = doc.data() || {};
                        const parentPath = String(doc.ref?.path || '');
                        const match = parentPath.match(/^accounts\/([^/]+)\/members\/([^/]+)$/);
                        const tenantId = match?.[1] || String(data.accountId || data.tenantId || '').trim();
                        const uid = match?.[2] || doc.id;
                        if (tenantId && uid) {
                            candidateMatches.push({ tenantId, uid, data });
                        }
                    }
                }
            }
        } catch {
            // Fallback seguro si falta índice collectionGroup en emulador/stub
        }

        // 2. Fallback scan acotado sobre `accounts` -> `members` cuando collectionGroup no está disponible
        if (candidateMatches.length === 0) {
            try {
                const accountsSnap = await db.collection('accounts').limit(200).get();
                for (const accDoc of accountsSnap.docs) {
                    const membersSnap = await db
                        .collection('accounts')
                        .doc(accDoc.id)
                        .collection('members')
                        .where('phoneE164', '==', normalizedE164)
                        .limit(5)
                        .get();
                    for (const mDoc of membersSnap.docs) {
                        candidateMatches.push({
                            tenantId: accDoc.id,
                            uid: mDoc.id,
                            data: mDoc.data() || {},
                        });
                    }
                }
            } catch {
                // Sin candidatos
            }
        }

        for (const cand of candidateMatches) {
            const memberStatus = String(cand.data.status || 'ACTIVE').trim().toUpperCase();
            if (memberStatus !== 'ACTIVE') {
                continue;
            }
            if (!cand.data.whatsappOptInAt) {
                continue;
            }

            const accSnap = await db.collection('accounts').doc(cand.tenantId).get();
            if (!accSnap.exists) continue;
            const accData = accSnap.data() || {};
            const accStatus = String(accData.status || 'ACTIVE').trim().toUpperCase();
            if (accStatus === 'SUSPENDED' || accStatus === 'REJECTED' || accStatus === 'PENDING_APPROVAL') {
                continue;
            }

            const isOwner = String(accData.ownerId || '') === cand.uid;
            const supplyProfile = deriveSupplyRoleFromMember(cand.data, isOwner);

            let siteId = supplyProfile.assignedSiteIds[0] || '';
            if (!siteId) {
                const sites = await SupplyRepository.listSites(cand.tenantId);
                siteId = sites[0]?.siteId || 'default-site';
            }

            return {
                tenantId: cand.tenantId,
                siteId,
                uid: cand.uid,
                displayName: String(cand.data.displayName || cand.data.name || 'Operador Terreno').trim(),
                email: String(cand.data.email || '').trim().toLowerCase(),
                phoneE164: normalizedE164,
                whatsappOptInAt: cand.data.whatsappOptInAt,
                b2bRole: String(cand.data.role || (isOwner ? 'OWNER' : 'OPERATOR')).toUpperCase(),
                supplyProfile,
            };
        }

        return null;
    }

    /**
     * Lista receptores de notificación (compradores / admins / owners) de un tenant.
     */
    private static async resolveTenantNotificationRecipients(
        tenantId: string,
        rolesFilter: Array<SupplyOperationalRole | 'OWNER' | 'ADMIN'>
    ): Promise<SupplyNotificationRecipient[]> {
        const recipients: SupplyNotificationRecipient[] = [];
        const allowedSet = new Set(rolesFilter.map((r) => r.toUpperCase()));

        try {
            const membersSnap = await db.collection('accounts').doc(tenantId).collection('members').get();
            for (const doc of membersSnap.docs) {
                const d = doc.data() || {};
                const status = String(d.status || 'ACTIVE').toUpperCase();
                if (status !== 'ACTIVE') continue;

                const b2bRole = String(d.role || '').toUpperCase();
                const supplyRole = String(d.supplyProfile?.role || '').toUpperCase();
                if (allowedSet.has(b2bRole) || allowedSet.has(supplyRole)) {
                    recipients.push({
                        uid: doc.id,
                        displayName: d.displayName || d.name,
                        email: d.email,
                        phoneE164: d.phoneE164,
                        whatsappOptInAt: d.whatsappOptInAt,
                        role: supplyRole || b2bRole,
                        notificationPreferences: d.notificationPreferences || {
                            emailEnabled: true,
                            whatsappEnabled: false,
                            email: true,
                            whatsapp: false,
                        },
                    });
                }
            }
        } catch {
            // No bloquear commit si consulta de miembros falla
        }
        return recipients;
    }

    /**
     * Pre-reserva rápida en el webhook (< 10ms) para descartar replays de Meta sin encolar duplicados,
     * emitiendo un `dispatchToken` único para el worker Cloud Tasks que reclamará el `wamid`.
     */
    public static async preEnqueueWamidForWebhook(
        wamid: string
    ): Promise<{ shouldEnqueue: boolean; duplicate: boolean; dispatchToken?: string }> {
        const safeId = safeWamidDocId(wamid);
        const ref = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).doc(safeId);

        return this.withKeyedLock(`wamid:${safeId}`, async () => {
            const nowMs = Date.now();
            const nowIso = new Date(nowMs).toISOString();
            const dispatchToken = crypto.randomBytes(12).toString('hex');

            const exec = async (tx: any) => {
                const snap = await tx.get(ref);
                if (snap.exists) {
                    const cur = (snap.data() || {}) as Partial<WamidStateRecord>;
                    const status = cur.status || 'DONE';
                    const leaseExpiresAtMs = Number(cur.leaseExpiresAtMs || 0);
                    if (
                        status === 'DONE' ||
                        ((status === 'PROCESSING' || status === 'QUEUED') && leaseExpiresAtMs > nowMs)
                    ) {
                        return { shouldEnqueue: false, duplicate: true };
                    }
                    const nextRec: WamidStateRecord = {
                        wamid,
                        tenantId: cur.tenantId || 'pending',
                        status: 'QUEUED',
                        attempts: Number(cur.attempts || 0),
                        leaseExpiresAtMs: nowMs + WAMID_LEASE_MS,
                        dispatchToken,
                        lastError: null,
                        updatedAt: nowIso,
                        ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(nowMs),
                    };
                    tx.set(ref, nextRec);
                    return { shouldEnqueue: true, duplicate: false, dispatchToken };
                }

                const freshRec: WamidStateRecord = {
                    wamid,
                    tenantId: 'pending',
                    status: 'QUEUED',
                    attempts: 0,
                    leaseExpiresAtMs: nowMs + WAMID_LEASE_MS,
                    dispatchToken,
                    lastError: null,
                    updatedAt: nowIso,
                    ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(nowMs),
                };
                tx.set(ref, freshRec);
                return { shouldEnqueue: true, duplicate: false, dispatchToken };
            };

            if (typeof db.runTransaction === 'function') {
                return db.runTransaction(exec);
            }
            return exec({
                get: (r: any) => r.get(),
                set: (r: any, d: any) => r.set(d),
            });
        });
    }

    /**
     * Máquina de estados transaccional de idempotencia por `wamid` (`supply_whatsapp_wamids/{wamid}`):
     * - Estados: `QUEUED | PROCESSING | DONE | FAILED`, `attempts`, `leaseExpiresAtMs` (60s), `ttlExpiresAt` (7d).
     * - Si `DONE` -> rechaza duplicado (`false`).
     * - Si no existe, o `FAILED`, o `PROCESSING` con lease expirado, o `QUEUED` con `dispatchToken` válido ->
     *   reclama atómicamente (`PROCESSING`, `attempts + 1`) y retorna `true`.
     */
    public static async tryClaimWamid(
        wamid: string,
        tenantId: string,
        dispatchToken?: string
    ): Promise<boolean> {
        const safeId = safeWamidDocId(wamid);
        const ref = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).doc(safeId);

        return this.withKeyedLock(`wamid:${safeId}`, async () => {
            const nowMs = Date.now();
            const nowIso = new Date(nowMs).toISOString();

            const exec = async (tx: any): Promise<boolean> => {
                const snap = await tx.get(ref);
                if (!snap.exists) {
                    const freshRec: WamidStateRecord = {
                        wamid,
                        tenantId,
                        status: 'PROCESSING',
                        attempts: 1,
                        leaseExpiresAtMs: nowMs + WAMID_LEASE_MS,
                        dispatchToken: dispatchToken || null,
                        lastError: null,
                        processedAt: nowIso,
                        updatedAt: nowIso,
                        ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(nowMs),
                    };
                    tx.set(ref, freshRec);
                    return true;
                }

                const cur = (snap.data() || {}) as Partial<WamidStateRecord>;
                const status = cur.status || 'DONE';
                const prevAttempts = Number(cur.attempts || 0);
                const leaseExpiresAtMs = Number(cur.leaseExpiresAtMs || 0);

                if (status === 'DONE') {
                    return false;
                }

                const canReclaim =
                    status === 'FAILED' ||
                    (status === 'PROCESSING' && leaseExpiresAtMs <= nowMs) ||
                    (status === 'QUEUED' &&
                        ((Boolean(dispatchToken) && cur.dispatchToken === dispatchToken) ||
                            leaseExpiresAtMs <= nowMs));

                if (!canReclaim) {
                    return false;
                }

                const claimedRec: WamidStateRecord = {
                    wamid,
                    tenantId,
                    status: 'PROCESSING',
                    attempts: prevAttempts + 1,
                    leaseExpiresAtMs: nowMs + WAMID_LEASE_MS,
                    dispatchToken: dispatchToken || cur.dispatchToken || null,
                    lastError: null,
                    processedAt: cur.processedAt || nowIso,
                    updatedAt: nowIso,
                    ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(nowMs),
                };
                tx.set(ref, claimedRec);
                return true;
            };

            if (typeof db.runTransaction === 'function') {
                return db.runTransaction(exec);
            }
            return exec({
                get: (r: any) => r.get(),
                set: (r: any, d: any) => r.set(d),
            });
        });
    }

    public static async markWamidDone(wamid: string, tenantId: string): Promise<void> {
        const safeId = safeWamidDocId(wamid);
        const ref = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).doc(safeId);
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        await this.withKeyedLock(`wamid:${safeId}`, async () => {
            await ref.set(
                {
                    wamid,
                    tenantId,
                    status: 'DONE' as WamidStateStatus,
                    leaseExpiresAtMs: 0,
                    lastError: null,
                    completedAt: nowIso,
                    updatedAt: nowIso,
                    ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(nowMs),
                },
                { merge: true }
            );
        });
    }

    public static async markWamidFailed(
        wamid: string,
        tenantId: string,
        errorMessage: string
    ): Promise<void> {
        const safeId = safeWamidDocId(wamid);
        const ref = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_WAMIDS).doc(safeId);
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        await this.withKeyedLock(`wamid:${safeId}`, async () => {
            await ref.set(
                {
                    wamid,
                    tenantId,
                    status: 'FAILED' as WamidStateStatus,
                    leaseExpiresAtMs: 0,
                    lastError: String(errorMessage || 'UnknownError').slice(0, 300),
                    failedAt: nowIso,
                    updatedAt: nowIso,
                    ttlExpiresAt: SupplyRepository.computeWhatsAppWamidTtl(nowMs),
                },
                { merge: true }
            );
        });
    }

    /**
     * Punto de entrada principal para mensajes entrantes de WhatsApp (worker Cloud Tasks o simulador).
     */
    public static async handleInboundMessage(
        message: InboundWhatsAppMessage,
        options: HandleInboundOptions = {}
    ): Promise<CampChannelProcessResult> {
        const member =
            options.overrideMember || (await this.resolveMemberByPhone(message.fromE164));

        if (!member) {
            const denyReply =
                'Número no habilitado o sin consentimiento activo en MINREPORT · Abastecimiento. Solicita activación a tu administrador de faena.';
            if (!options.skipOutboundSend) {
                await MetaWhatsAppCloudAdapter.sendTextMessage(message.fromE164, denyReply);
            }
            console.warn(
                `[CAMP-CHANNEL] Mensaje rechazado para ${maskPiiForLog(message.fromE164)} (no registrado o sin opt-in).`
            );
            return {
                handled: false,
                unauthorized: true,
                replyText: denyReply,
            };
        }

        // 1. Idempotencia transaccional con máquina de estados por `wamid`
        const claimed = await this.tryClaimWamid(
            message.wamid,
            member.tenantId,
            options.dispatchToken
        );
        if (!claimed) {
            return {
                handled: false,
                duplicate: true,
                sessionId: buildSessionId(member.tenantId, member.phoneE164),
            };
        }

        try {
            await MetaWhatsAppCloudAdapter.markAsRead(message.wamid);

            const sessionId = buildSessionId(member.tenantId, member.phoneE164);
            const sessionRef = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).doc(sessionId);

            // 2. Pre-digestión Stateless CAS (`TENANT_PRIVATE`) — CERO base64 en Firestore, CERO dependencia de RAM
            let effectiveMime = options.inlineMediaMimeType || message.mimeType;
            let preDigestedCasRef: EvidenceCasRef | undefined;

            let stageBuffer: Buffer | undefined = options.inlineMediaBuffer;
            let stageIsXml = Boolean(options.inlineXmlContent);

            if (!stageBuffer && options.inlineXmlContent && options.inlineXmlContent.trim()) {
                stageBuffer = Buffer.from(options.inlineXmlContent, 'utf8');
                effectiveMime = effectiveMime || 'application/xml';
                stageIsXml = true;
            } else if (!stageBuffer && message.mediaId && (message.type === 'image' || message.type === 'document' || message.type === 'audio')) {
                try {
                    const downloaded = await MetaWhatsAppCloudAdapter.downloadMedia(message.mediaId);
                    if (downloaded.buffer.length > 0) {
                        stageBuffer = downloaded.buffer;
                        effectiveMime = downloaded.mimeType || effectiveMime;
                    }
                } catch {
                    // Mantener `message.mediaId` para reintento en worker de flush si Meta CDN falla transitoriamente
                }
            }

            if (stageBuffer && stageBuffer.length > 0) {
                const casProfile = resolveInboundCasProfile(effectiveMime, message.filename, stageIsXml);
                const resolvedMime =
                    casProfile === 'XML_DTE_DOCUMENT'
                        ? 'application/xml'
                        : effectiveMime ||
                          (message.type === 'audio' ? 'audio/ogg' : 'image/jpeg');
                const { descriptor } = await CasStorageService.digestAndStore(
                    stageBuffer,
                    resolvedMime,
                    casProfile,
                    {
                        scope: 'TENANT_PRIVATE',
                        tenantId: member.tenantId,
                        actorUid: member.uid,
                        originalFilename:
                            message.filename ||
                            (casProfile === 'XML_DTE_DOCUMENT'
                                ? 'wa_inbound_dte.xml'
                                : message.type === 'audio'
                                  ? 'wa_inbound_audio.ogg'
                                  : 'wa_inbound_media'),
                        clientOriginalBytes: stageBuffer.length,
                    }
                );
                preDigestedCasRef = descriptorToEvidenceCasRef(descriptor);
                effectiveMime = descriptor.mimeType;
            }

            const turnEntry: PendingBufferedTurn = {
                wamid: message.wamid,
                receivedAtMs: message.timestampMs || Date.now(),
                type: message.type,
                text: message.textBody,
                interactiveReplyId: message.interactiveReplyId,
                mediaId: message.mediaId,
                mimeType: effectiveMime,
                caption: message.caption,
                filename: message.filename,
                evidenceCasRef: preDigestedCasRef,
                tedRawXml: options.inlineTedRawXml,
            };

            const rawTextCommand = (message.interactiveReplyId || message.textBody || '').trim();
            const isImmediateAction =
                Boolean(options.flushImmediately) ||
                message.type === 'interactive' ||
                CONFIRM_REGEX.test(rawTextCommand) ||
                CANCEL_REGEX.test(rawTextCommand) ||
                this.isExecutiveDirectPurchaseTurn(member, turnEntry, stageIsXml);

            const debounceMs = clampDebounceMs(options.debounceWindowMs);
            const targetDebounceUntilMs = isImmediateAction ? null : Date.now() + debounceMs;

            // 3. Append atómico en `supply_whatsapp_sessions/{sessionId}` con `version` optimista + TTL 24h
            const appendOutcome = await this.runSessionTransaction(sessionId, async (tx) => {
                const sessionSnap = await tx.get(sessionRef);
                const nowIso = new Date().toISOString();

                const session: WhatsAppCampSession = sessionSnap.exists
                    ? (sessionSnap.data() as WhatsAppCampSession)
                    : {
                          sessionId,
                          tenantId: member.tenantId,
                          siteId: member.siteId,
                          memberUid: member.uid,
                          memberName: member.displayName,
                          memberRole: member.supplyProfile.role,
                          phoneE164: member.phoneE164,
                          fsmState: 'COLLECTING',
                          draftItems: [],
                          deniedNotices: [],
                          pendingDirectPurchaseDraft: null,
                          pendingBuffer: [],
                          debounceUntilMs: null,
                          processedWamids: [],
                          version: 0,
                          updatedAt: nowIso,
                      };

                if ((session.processedWamids || []).includes(message.wamid)) {
                    return { duplicate: true as const, session };
                }

                const nextSession: WhatsAppCampSession = {
                    ...session,
                    pendingBuffer: [...(session.pendingBuffer || []), turnEntry],
                    processedWamids: [...(session.processedWamids || []).slice(-99), message.wamid],
                    debounceUntilMs: targetDebounceUntilMs,
                    version: Number(session.version || 0) + 1,
                    ttlExpiresAt: SupplyRepository.computeWhatsAppSessionTtl(),
                    updatedAt: nowIso,
                };
                tx.set(sessionRef, nextSession);
                return { duplicate: false as const, session: nextSession };
            });

            if (appendOutcome.duplicate) {
                await this.markWamidDone(message.wamid, member.tenantId);
                return { handled: false, duplicate: true, sessionId };
            }

            if (!isImmediateAction && targetDebounceUntilMs !== null) {
                await SupplyTaskQueueService.enqueueSessionFlush(
                    {
                        sessionId,
                        tenantId: member.tenantId,
                        expectedDebounceUntilMs: targetDebounceUntilMs,
                        skipOutboundSend: options.skipOutboundSend,
                    },
                    targetDebounceUntilMs
                );

                await this.markWamidDone(message.wamid, member.tenantId);
                return {
                    handled: true,
                    buffered: true,
                    sessionId,
                    fsmState: appendOutcome.session.fsmState,
                };
            }

            const flushResult = await this.flushDebouncedSession(sessionId, member, {
                skipOutboundSend: options.skipOutboundSend,
                forceFlush: true,
            });
            await this.markWamidDone(message.wamid, member.tenantId);
            return flushResult;
        } catch (err: any) {
            await this.markWamidFailed(
                message.wamid,
                member.tenantId,
                err instanceof Error ? err.message : String(err || 'UnknownError')
            ).catch(() => {});
            throw err;
        }
    }

    private static isExecutiveDirectPurchaseTurn(
        member: ResolvedWhatsAppMember,
        turn: PendingBufferedTurn,
        hasXmlContent: boolean = false
    ): boolean {
        const canDirect =
            member.supplyProfile.canRecordDirectPurchase ||
            member.supplyProfile.role === 'OWNER_EXEC' ||
            member.supplyProfile.role === 'BUYER' ||
            member.supplyProfile.role === 'SITE_ADMIN';
        if (!canDirect) return false;

        const hasReceiptMedia =
            turn.type === 'document' ||
            hasXmlContent ||
            turn.evidenceCasRef?.profile === 'XML_DTE_DOCUMENT' ||
            Boolean(turn.mimeType && turn.mimeType.toLowerCase().includes('xml')) ||
            Boolean(turn.tedRawXml) ||
            (turn.type === 'image' &&
                (member.supplyProfile.role === 'OWNER_EXEC' ||
                    member.supplyProfile.role === 'BUYER' ||
                    /\b(boleta|factura|compra|comprobante|dte|recibo|rendici[oó]n)\b/i.test(
                        `${turn.caption || ''} ${turn.text || ''}`
                    )));

        return hasReceiptMedia;
    }

    /**
     * Procesa todos los mensajes acumulados en `session.pendingBuffer` en UN solo turno consolidado
     * drenando el buffer atómicamente vía `db.runTransaction` (sin lost updates ni dobles flushes).
     */
    public static async flushDebouncedSession(
        sessionId: string,
        memberOverride?: ResolvedWhatsAppMember,
        options: {
            skipOutboundSend?: boolean;
            forceFlush?: boolean;
            expectedDebounceUntilMs?: number;
        } = {}
    ): Promise<CampChannelProcessResult> {
        const sessionRef = db.collection(SUPPLY_COLLECTIONS.WHATSAPP_SESSIONS).doc(sessionId);

        // 1. Verificar `debounceUntilMs` y drenar `pendingBuffer` atómicamente dentro de `db.runTransaction`
        const drainResult = await this.runSessionTransaction(sessionId, async (tx) => {
            const snap = await tx.get(sessionRef);
            if (!snap.exists) {
                return { status: 'NOT_FOUND' as const };
            }

            const current = snap.data() as WhatsAppCampSession;
            const bufferedTurns = current.pendingBuffer || [];
            if (bufferedTurns.length === 0) {
                return { status: 'EMPTY' as const, fsmState: current.fsmState };
            }

            if (
                !options.forceFlush &&
                typeof current.debounceUntilMs === 'number' &&
                Date.now() < current.debounceUntilMs
            ) {
                return { status: 'STILL_DEBOUNCING' as const, fsmState: current.fsmState };
            }

            const drainedSession: WhatsAppCampSession = {
                ...current,
                pendingBuffer: [],
                debounceUntilMs: null,
                version: Number(current.version || 0) + 1,
                ttlExpiresAt: SupplyRepository.computeWhatsAppSessionTtl(),
                updatedAt: new Date().toISOString(),
            };
            tx.set(sessionRef, drainedSession);
            return {
                status: 'DRAINED' as const,
                session: drainedSession,
                bufferedTurns: [...bufferedTurns],
            };
        });

        if (drainResult.status === 'NOT_FOUND') {
            return { handled: false, sessionId };
        }
        if (drainResult.status === 'EMPTY') {
            return { handled: false, sessionId, fsmState: drainResult.fsmState };
        }
        if (drainResult.status === 'STILL_DEBOUNCING') {
            return { handled: true, buffered: true, sessionId, fsmState: drainResult.fsmState };
        }

        const { session, bufferedTurns } = drainResult;

        const member =
            memberOverride || (await this.resolveMemberByPhone(session.phoneE164));
        if (!member) {
            return { handled: false, unauthorized: true, sessionId };
        }

        // 1. Verificar atajo Ejecutivo de Compra Directa (foto/PDF/XML reenviado por OWNER/BUYER/ADMIN)
        const directTurn = bufferedTurns.find((t) => this.isExecutiveDirectPurchaseTurn(member, t));
        if (directTurn) {
            return this.processExecutiveDirectPurchaseIntake(session, sessionRef, member, directTurn, options);
        }

        // 2. Verificar confirmación o cancelación sobre un borrador de Compra Directa pendiente
        const combinedCommands = bufferedTurns
            .map((t) => (t.interactiveReplyId || t.text || '').trim())
            .filter(Boolean)
            .join(' ')
            .trim();

        if (session.pendingDirectPurchaseDraft) {
            if (CANCEL_REGEX.test(combinedCommands)) {
                const replyText = 'Registro de compra directa cancelado. No se realizaron cargos ni movimientos.';
                await this.persistSessionFsmUpdate(sessionId, {
                    pendingDirectPurchaseDraft: null,
                    fsmState: 'COLLECTING',
                    lastReplyText: replyText,
                });
                if (!options.skipOutboundSend) {
                    await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, replyText);
                }
                return { handled: true, sessionId, fsmState: 'COLLECTING', replyText };
            }

            if (CONFIRM_REGEX.test(combinedCommands)) {
                return this.commitExecutiveDirectPurchase(session, sessionRef, member, options);
            }
        }

        // 3. Verificar cancelación de borrador de requisición
        if (CANCEL_REGEX.test(combinedCommands)) {
            const replyText = 'Pedido borrador cancelado. Cuando necesites solicitar insumos, escríbeme o envíame un audio.';
            await this.persistSessionFsmUpdate(sessionId, {
                draftItems: [],
                deniedNotices: [],
                fsmState: 'COLLECTING',
                lastReplyText: replyText,
            });
            if (!options.skipOutboundSend) {
                await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, replyText);
            }
            return { handled: true, sessionId, fsmState: 'COLLECTING', replyText };
        }

        // 4. Verificar confirmación explícita en REVIEW_GATE -> COMMITTED
        if (session.fsmState === 'REVIEW_GATE' && CONFIRM_REGEX.test(combinedCommands)) {
            return this.commitCampRequisition(session, sessionRef, member, options);
        }

        // 5. Extraer ítems desde todos los turnos acumulados (texto + audio .ogg CAS + foto CAS)
        const extractedItems: Array<{
            rawText: string;
            itemName: string;
            quantity: number | null;
            unitRaw: string | null;
            packagingUnit: string | null;
            size: string | null;
            location?: string | null;
            linkedAssetId?: string | null;
            evidenceCasRef?: EvidenceCasRef;
        }> = [];

        const textFragments: string[] = [];

        for (const turn of bufferedTurns) {
            if (turn.text) textFragments.push(turn.text);
            if (turn.caption) textFragments.push(turn.caption);

            if (turn.type === 'audio' && (turn.evidenceCasRef || turn.mediaId)) {
                let audioBuf: Buffer | undefined;
                let audioMime = turn.mimeType || 'audio/ogg';
                if (turn.evidenceCasRef) {
                    const blob = await CasStorageService.readCasBlob(turn.evidenceCasRef.sha256, {
                        scope: 'TENANT_PRIVATE',
                        tenantId: member.tenantId,
                    });
                    if (blob) {
                        audioBuf = blob.buffer;
                        audioMime = blob.contentType || audioMime;
                    }
                }
                if (!audioBuf && turn.mediaId) {
                    const downloaded = await MetaWhatsAppCloudAdapter.downloadMedia(turn.mediaId);
                    audioBuf = downloaded.buffer;
                    audioMime = downloaded.mimeType || audioMime;
                }
                if (audioBuf && audioBuf.length > 0) {
                    const aiAudio = await this.extractIntentFromMultimodal({
                        tenantId: member.tenantId,
                        textPrompt:
                            'Transcribe este audio de terreno minero chileno y extrae cada insumo solicitado con su cantidad, unidad/envase y atributos (talla/equipo/ubicación) en JSON estricto.',
                        media: [{ mimeType: audioMime, dataBase64: audioBuf.toString('base64') }],
                    });
                    for (const it of aiAudio.items) {
                        extractedItems.push({
                            rawText: it.rawText,
                            itemName: it.itemName,
                            quantity: it.quantity ?? null,
                            unitRaw: it.unitRaw ?? null,
                            packagingUnit: it.packagingUnit ?? null,
                            size: it.size ?? null,
                            location: it.location ?? null,
                            linkedAssetId: it.linkedAssetId ?? null,
                        });
                    }
                    if (aiAudio.transcript && aiAudio.items.length === 0) {
                        textFragments.push(aiAudio.transcript);
                    }
                }
            } else if (turn.type === 'image' && (turn.evidenceCasRef || turn.mediaId)) {
                let casRef = turn.evidenceCasRef;
                let ocrBuf: Buffer | undefined;
                let ocrMime = turn.mimeType || 'image/webp';

                if (casRef) {
                    const blob = await CasStorageService.readCasBlob(casRef.sha256, {
                        scope: 'TENANT_PRIVATE',
                        tenantId: member.tenantId,
                    });
                    if (blob) {
                        ocrBuf = blob.buffer;
                        ocrMime = blob.contentType;
                    }
                } else if (turn.mediaId) {
                    const downloaded = await MetaWhatsAppCloudAdapter.downloadMedia(turn.mediaId);
                    const imgBuf = downloaded.buffer;
                    const imgMime = downloaded.mimeType || turn.mimeType || 'image/jpeg';

                    // Digestión CAS obligatoria (`TENANT_PRIVATE`, cero crudos/base64 en Firestore)
                    const { descriptor, digested } = await CasStorageService.digestAndStore(
                        imgBuf,
                        imgMime,
                        'IMAGE_FIELD_EVIDENCE',
                        {
                            scope: 'TENANT_PRIVATE',
                            tenantId: member.tenantId,
                            actorUid: member.uid,
                            originalFilename: turn.filename || 'wa_field_photo.jpg',
                            clientOriginalBytes: imgBuf.length,
                        }
                    );
                    casRef = descriptorToEvidenceCasRef(descriptor);
                    ocrBuf = digested.buffer;
                    ocrMime = digested.mimeType;
                }

                const captionScrubbed = ConfidentialityAirlockService.scrubDeterministicPii(
                    turn.caption || '',
                    'CL'
                ).scrubbed;
                const aiPhoto = await this.extractIntentFromMultimodal({
                    tenantId: member.tenantId,
                    textPrompt: `Identifica el insumo, repuesto o falla de campamento visible en esta foto de terreno minero. Contexto: ${captionScrubbed}`,
                    media: ocrBuf ? [{ mimeType: ocrMime, dataBase64: ocrBuf.toString('base64') }] : undefined,
                });
                for (const it of aiPhoto.items) {
                    extractedItems.push({
                        rawText: it.rawText,
                        itemName: it.itemName,
                        quantity: it.quantity ?? null,
                        unitRaw: it.unitRaw ?? null,
                        packagingUnit: it.packagingUnit ?? null,
                        size: it.size ?? null,
                        location: it.location ?? null,
                        linkedAssetId: it.linkedAssetId ?? null,
                        evidenceCasRef: casRef,
                    });
                }
            }
        }

        const mergedText = textFragments.join(', ').trim();
        if (mergedText) {
            const deterministicItems = parseDeterministicSpanishSupplyClauses(mergedText);
            if (deterministicItems.length > 0) {
                for (const d of deterministicItems) {
                    extractedItems.push(d);
                }
            } else {
                const scrubbed = ConfidentialityAirlockService.scrubDeterministicPii(mergedText, 'CL').scrubbed;
                const aiText = await this.extractIntentFromMultimodal({
                    tenantId: member.tenantId,
                    textPrompt: `Extrae los insumos solicitados del siguiente mensaje de campamento minero:\n"${scrubbed}"`,
                });
                for (const it of aiText.items) {
                    extractedItems.push({
                        rawText: it.rawText,
                        itemName: it.itemName,
                        quantity: it.quantity ?? null,
                        unitRaw: it.unitRaw ?? null,
                        packagingUnit: it.packagingUnit ?? null,
                        size: it.size ?? null,
                        location: it.location ?? null,
                        linkedAssetId: it.linkedAssetId ?? null,
                    });
                }
            }
        }

        // 6. POLICY_CHECK (GLOBAL_HARD_DENY DS 132 + Atypical Flags) & Slot Merge
        const site = await SupplyRepository.getSite(member.tenantId, member.siteId);
        const roleMismatchMode = site?.roleMismatchMode || 'FLAG_AND_ACCEPT';
        const deniedItems: Array<{ rawText: string; reason: string }> = [];

        // Si venimos de COMMITTED y llegan nuevos ítems, iniciar nuevo borrador limpio
        if (session.fsmState === 'COMMITTED') {
            session.draftItems = [];
            session.deniedNotices = [];
        }

        const draftMap = new Map<string, CampDraftItem>(
            (session.draftItems || []).map((it) => [it.canonicalSkuId, { ...it }])
        );

        for (const ext of extractedItems) {
            // 6.a GLOBAL_HARD_DENY (DS 132 inviolable)
            const hardDeny = checkGlobalHardDeny(`${ext.rawText} ${ext.itemName}`);
            if (hardDeny.denied) {
                deniedItems.push({
                    rawText: ext.rawText,
                    reason: hardDeny.reason || 'Ítem no permitido por normativa minera DS 132.',
                });
                continue;
            }

            const normalized = normalizeSupplyItemFromText(
                ext.itemName,
                ext.quantity,
                ext.unitRaw || ext.packagingUnit
            );

            const flags = evaluateAtypicalFlagsForLine({
                role: member.supplyProfile.role,
                profile: member.supplyProfile,
                categoryCode: normalized.categoryCode,
                isCapexAsset: normalized.isCapexAsset,
            });

            if (roleMismatchMode === 'STRICT_BLOCK' && flags.includes('ATYPICAL_ROLE_MISMATCH')) {
                deniedItems.push({
                    rawText: ext.rawText,
                    reason: `Categoría ${normalized.categoryCode} bloqueada para rol ${member.supplyProfile.role} en esta faena.`,
                });
                continue;
            }

            const existing = draftMap.get(normalized.canonicalSkuId);
            const mergedQtySi =
                normalized.qtySi !== null
                    ? normalized.qtySi
                    : existing?.qtySi ?? null;
            const mergedPackaging = ext.packagingUnit || normalized.packagingLabel || existing?.packagingUnit || null;
            const mergedSize = ext.size || existing?.size || null;
            const mergedLocation = ext.location || existing?.location || null;
            const mergedAsset = ext.linkedAssetId || existing?.linkedAssetId || null;

            const missingSlots = computeMissingSlotsForDraft({
                canonicalSkuId: normalized.canonicalSkuId,
                categoryCode: normalized.categoryCode,
                qtySi: mergedQtySi,
                packagingUnit: mergedPackaging,
                size: mergedSize,
                location: mergedLocation,
                linkedAssetId: mergedAsset,
                requiredSlots: normalized.requiredSlots,
                role: member.supplyProfile.role,
            });

            draftMap.set(normalized.canonicalSkuId, {
                draftLineId: existing?.draftLineId || `dl_${crypto.randomBytes(3).toString('hex')}`,
                canonicalSkuId: normalized.canonicalSkuId,
                itemName: normalized.itemName,
                rawText: ext.rawText,
                categoryCode: normalized.categoryCode,
                procurementBucket: normalized.procurementBucket,
                unitSi: normalized.unitSi,
                qtySi: mergedQtySi,
                rawQty: ext.quantity ?? existing?.rawQty ?? null,
                packagingUnit: mergedPackaging,
                size: mergedSize,
                location: mergedLocation,
                linkedAssetId: mergedAsset,
                requiredSlots: normalized.requiredSlots,
                missingSlots,
                atypicalFlags: Array.from(new Set([...(existing?.atypicalFlags || []), ...flags])),
                isCapexAsset: normalized.isCapexAsset,
                evidenceCasRef: ext.evidenceCasRef || existing?.evidenceCasRef,
            });
        }

        const updatedDrafts = Array.from(draftMap.values());
        session.draftItems = updatedDrafts;
        session.deniedNotices = deniedItems.map((d) => `${d.rawText}: ${d.reason}`);

        const allAtypicalFlags = Array.from(
            new Set(updatedDrafts.flatMap((d) => d.atypicalFlags))
        );

        // Si no quedó ningún ítem válido tras POLICY_CHECK
        if (updatedDrafts.length === 0) {
            const denyBlock =
                deniedItems.length > 0
                    ? `No se pueden solicitar los siguientes ítems:\n${deniedItems
                          .map((d) => `- ${d.rawText}: ${d.reason}`)
                          .join('\n')}`
                    : 'No logré identificar insumos válidos en tu mensaje. Indícame qué necesitas y la cantidad.';
            await this.persistSessionFsmUpdate(sessionId, {
                fsmState: 'COLLECTING',
                draftItems: updatedDrafts,
                deniedNotices: session.deniedNotices,
                lastReplyText: denyBlock,
            });
            if (!options.skipOutboundSend) {
                await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, denyBlock);
            }
            return {
                handled: true,
                sessionId,
                fsmState: 'COLLECTING',
                replyText: denyBlock,
                deniedItems,
                atypicalFlags: [],
            };
        }

        // 7. SLOT_FILLING vs REVIEW_GATE
        const incompleteItems = updatedDrafts.filter((d) => d.missingSlots.length > 0);
        const denyPrefix =
            deniedItems.length > 0
                ? `Ítems omitidos por normativa:\n${deniedItems
                      .map((d) => `- ${d.rawText}: ${d.reason}`)
                      .join('\n')}\n\n`
                : '';

        if (incompleteItems.length > 0) {
            const completeItems = updatedDrafts.filter((d) => d.missingSlots.length === 0);
            const completeSummary =
                completeItems.length > 0
                    ? `Registrado:\n${completeItems
                          .map((it) => `- ${it.itemName}: ${it.qtySi} ${it.unitSi}`)
                          .join('\n')}\n\n`
                    : '';

            const questions = incompleteItems.map((it) => `- ${buildSlotQuestionForItem(it)}`).join('\n');
            const replyText = `${denyPrefix}${completeSummary}Para completar tu pedido necesito:\n${questions}`;

            await this.persistSessionFsmUpdate(sessionId, {
                fsmState: 'SLOT_FILLING',
                draftItems: updatedDrafts,
                deniedNotices: session.deniedNotices,
                lastReplyText: replyText,
            });
            if (!options.skipOutboundSend) {
                await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, replyText);
            }
            return {
                handled: true,
                sessionId,
                fsmState: 'SLOT_FILLING',
                replyText,
                deniedItems,
                atypicalFlags: allAtypicalFlags,
            };
        }

        // Todos los slots completos -> REVIEW_GATE con botones interactivos
        const numberedLines = updatedDrafts.map((it, idx) => {
            const packNote = it.packagingUnit ? ` [${it.packagingUnit}]` : '';
            const sizeNote = it.size ? ` (Talla ${it.size})` : '';
            const flagNote = it.atypicalFlags.length > 0 ? ' [REVISIÓN ATÍPICA]' : '';
            return `${idx + 1}. ${it.itemName}: ${it.qtySi} ${it.unitSi}${packNote}${sizeNote}${flagNote}`;
        });

        const replyText = `${denyPrefix}Resumen de pedido (${member.siteId}):\n${numberedLines.join('\n')}\n\nResponde OK o presiona Confirmar para enviar a compras.`;
        const replyButtons = [
            { id: 'REQ_CONFIRM', title: 'Confirmar Pedido' },
            { id: 'REQ_CANCEL', title: 'Cancelar' },
        ];

        await this.persistSessionFsmUpdate(sessionId, {
            fsmState: 'REVIEW_GATE',
            draftItems: updatedDrafts,
            deniedNotices: session.deniedNotices,
            lastReplyText: replyText,
        });
        if (!options.skipOutboundSend) {
            await MetaWhatsAppCloudAdapter.sendInteractiveButtons(member.phoneE164, replyText, replyButtons);
        }

        return {
            handled: true,
            sessionId,
            fsmState: 'REVIEW_GATE',
            replyText,
            replyButtons,
            deniedItems,
            atypicalFlags: allAtypicalFlags,
        };
    }

    private static async commitCampRequisition(
        session: WhatsAppCampSession,
        _sessionRef: FirebaseFirestore.DocumentReference,
        member: ResolvedWhatsAppMember,
        options: { skipOutboundSend?: boolean }
    ): Promise<CampChannelProcessResult> {
        const draftItems = session.draftItems || [];
        if (draftItems.length === 0) {
            await this.persistSessionFsmUpdate(session.sessionId, { fsmState: 'COLLECTING' });
            return { handled: false, sessionId: session.sessionId, fsmState: 'COLLECTING' };
        }

        const requisition = await SupplyRepository.createRequisition(
            {
                tenantId: member.tenantId,
                siteId: member.siteId,
                requesterUid: member.uid,
                requesterName: member.displayName,
                requesterRole: member.supplyProfile.role,
                requesterPhoneE164: member.phoneE164,
                demandOrigin: resolveOriginForRole(member.supplyProfile.role),
                demandNature: 'REACTIVE_FIELD',
                costCenter: member.supplyProfile.defaultCostCenter || 'CC-CAMPAMENTO',
                atypicalFlags: Array.from(new Set(draftItems.flatMap((d) => d.atypicalFlags))),
                lines: draftItems.map((d, idx) => ({
                    lineId: `line_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
                    canonicalSkuId: d.canonicalSkuId,
                    itemName: d.itemName,
                    categoryCode: d.categoryCode,
                    procurementBucket: d.procurementBucket,
                    unitSi: d.unitSi,
                    rawRequestedText: d.rawText,
                    qtyRequested: d.qtySi || 1,
                    qtyPurchased: 0,
                    qtyReceived: 0,
                    qtyPending: d.qtySi || 1,
                    lineStatus: 'OPEN',
                    atypicalFlags: d.atypicalFlags,
                    fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                    urgency: d.atypicalFlags.length > 0 ? 'HIGH' : 'STANDARD',
                    attributes: {
                        ...(d.packagingUnit ? { packagingUnit: d.packagingUnit } : {}),
                        ...(d.size ? { size: d.size } : {}),
                        ...(d.location ? { location: d.location } : {}),
                        ...(d.linkedAssetId ? { linkedAssetId: d.linkedAssetId } : {}),
                    },
                    evidenceCasRef: d.evidenceCasRef,
                })),
            },
            {
                actorUid: member.uid,
                actorEmail: member.email || `${member.uid}@whatsapp.minreport.local`,
            }
        );

        // Notificación dual a compradores/admins/owners
        const site = await SupplyRepository.getSite(member.tenantId, member.siteId);
        const buyers = await this.resolveTenantNotificationRecipients(member.tenantId, [
            'BUYER',
            'SITE_ADMIN',
            'OWNER_EXEC',
            'OWNER',
            'ADMIN',
        ]);
        await EmailAndWhatsAppNotifier.notifyBuyersOfRequisition({
            tenantId: member.tenantId,
            requisition,
            siteName: site?.name || member.siteId,
            buyers,
        });

        const replyText = `Pedido confirmado: ${requisition.reqId} (${requisition.lines.length} ítems). Ya fue enviado a Compras.`;
        await this.persistSessionFsmUpdate(session.sessionId, {
            fsmState: 'COMMITTED',
            draftItems: [],
            deniedNotices: [],
            lastCommittedReqId: requisition.reqId,
            lastReplyText: replyText,
        });

        if (!options.skipOutboundSend) {
            await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, replyText);
        }

        return {
            handled: true,
            sessionId: session.sessionId,
            fsmState: 'COMMITTED',
            replyText,
            atypicalFlags: requisition.atypicalFlags,
            committedRequisition: requisition,
        };
    }

    /**
     * Atajo Ejecutivo de Compra Directa: analiza foto/PDF/XML reenviada por OWNER/BUYER/SITE_ADMIN
     * leyendo el binario estrictamente desde CAS (`TENANT_PRIVATE`) por `sha256` (100% stateless).
     */
    private static async processExecutiveDirectPurchaseIntake(
        session: WhatsAppCampSession,
        _sessionRef: FirebaseFirestore.DocumentReference,
        member: ResolvedWhatsAppMember,
        turn: PendingBufferedTurn,
        options: { skipOutboundSend?: boolean }
    ): Promise<CampChannelProcessResult> {
        let rawBuffer: Buffer | undefined;
        let mimeType = turn.mimeType || 'image/jpeg';
        let xmlContent: string | undefined;

        if (turn.evidenceCasRef) {
            if (
                turn.evidenceCasRef.profile === 'XML_DTE_DOCUMENT' ||
                turn.evidenceCasRef.mimeType.toLowerCase().includes('xml')
            ) {
                const blob = await CasStorageService.readCasBlob(turn.evidenceCasRef.sha256, {
                    scope: 'TENANT_PRIVATE',
                    tenantId: member.tenantId,
                });
                if (blob) {
                    xmlContent = blob.buffer.toString('utf8');
                }
            }
        } else if (turn.mediaId) {
            const downloaded = await MetaWhatsAppCloudAdapter.downloadMedia(turn.mediaId);
            rawBuffer = downloaded.buffer;
            mimeType = downloaded.mimeType || mimeType;
        }

        const analysis = await ReceiptIntelligencePipeline.analyze({
            tenantId: member.tenantId,
            actorUid: member.uid,
            rawBuffer: turn.evidenceCasRef ? undefined : rawBuffer,
            mimeType,
            originalFilename: turn.filename || 'wa_direct_purchase',
            clientOriginalBytes: rawBuffer?.length,
            existingEvidenceCasRef: turn.evidenceCasRef,
            xmlContent,
            tedRawXml: turn.tedRawXml,
            contextCaption: turn.caption || turn.text,
            defaultDestination: 'STOCK_IN_WAREHOUSE',
            defaultCostCenter: member.supplyProfile.defaultCostCenter || 'CC-CAMPAMENTO',
            checkDuplicateDedupeKey: (dedupeKey) =>
                SupplyRepository.existsSiiDocument(member.tenantId, dedupeKey),
        });

        if (analysis.duplicateDetected) {
            const dupMsg = `Documento SII duplicado detectado (${analysis.dedupeKey}). Ya existe en MINREPORT y no se volverá a rendir.`;
            await this.persistSessionFsmUpdate(session.sessionId, {
                lastReplyText: dupMsg,
            });
            if (!options.skipOutboundSend) {
                await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, dupMsg);
            }
            return {
                handled: true,
                sessionId: session.sessionId,
                fsmState: session.fsmState,
                replyText: dupMsg,
                directPurchaseDraft: analysis,
            };
        }

        const purchaseMode: PurchaseMode =
            member.supplyProfile.role === 'OWNER_EXEC'
                ? 'DIRECT_AUTONOMOUS'
                : 'MIXED_FULFILLMENT_AND_DIRECT';
        const paymentMethod: PaymentMethod =
            member.supplyProfile.role === 'OWNER_EXEC' ? 'REEMBOLSO_GERENCIA' : 'FONDO_POR_RENDIR';

        const linesPreview = analysis.lines
            .map(
                (l, i) =>
                    `${i + 1}. ${l.description}: ${l.qtyPurchased} ${l.unitSi} · $${l.subtotalClp.toLocaleString('es-CL')} [${l.destination}]`
            )
            .join('\n');

        const alertNote = analysis.missingInvoiceAlert
            ? '\nALERTA TRIBUTARIA: Activo CAPEX respaldado sin Factura Electrónica (DTE 33/34).'
            : '';
        const arithNote = !analysis.arithmeticCheck.verified
            ? `\nALERTA ARITMÉTICA: Suma ítems ($${analysis.arithmeticCheck.linesSumClp}) difiere del total ($${analysis.arithmeticCheck.expectedTotalClp}).`
            : '';

        const replyText = [
            `Compra directa detectada (${purchaseMode}):`,
            `Proveedor: ${analysis.supplierName} (${analysis.supplierTaxId})`,
            `DTE ${analysis.documentType} #${analysis.folio} · Total $${analysis.totalAmountClp.toLocaleString('es-CL')} CLP`,
            linesPreview,
            alertNote,
            arithNote,
            '\nResponde OK o presiona Confirmar Compra para registrar en Stock/Activos y SII.',
        ]
            .filter(Boolean)
            .join('\n');

        const replyButtons = [
            { id: 'DIRECT_PURCHASE_CONFIRM', title: 'Confirmar Compra' },
            { id: 'DIRECT_PURCHASE_CANCEL', title: 'Cancelar' },
        ];

        await this.persistSessionFsmUpdate(session.sessionId, {
            pendingDirectPurchaseDraft: {
                analysis,
                purchaseMode,
                paymentMethod,
                createdAt: new Date().toISOString(),
            },
            fsmState: 'REVIEW_GATE',
            lastReplyText: replyText,
        });

        if (!options.skipOutboundSend) {
            await MetaWhatsAppCloudAdapter.sendInteractiveButtons(member.phoneE164, replyText, replyButtons);
        }

        return {
            handled: true,
            sessionId: session.sessionId,
            fsmState: 'REVIEW_GATE',
            replyText,
            replyButtons,
            atypicalFlags: analysis.atypicalFlags,
            directPurchaseDraft: analysis,
        };
    }

    private static async commitExecutiveDirectPurchase(
        session: WhatsAppCampSession,
        _sessionRef: FirebaseFirestore.DocumentReference,
        member: ResolvedWhatsAppMember,
        options: { skipOutboundSend?: boolean }
    ): Promise<CampChannelProcessResult> {
        const draft = session.pendingDirectPurchaseDraft;
        if (!draft) {
            return { handled: false, sessionId: session.sessionId, fsmState: session.fsmState };
        }

        const { analysis, purchaseMode, paymentMethod } = draft;
        const result = await SupplyRepository.createPurchaseWithReconciliation(
            {
                tenantId: member.tenantId,
                siteId: member.siteId,
                buyerUid: member.uid,
                buyerRole: member.supplyProfile.role,
                purchaseMode,
                authorizedByAuthority:
                    member.supplyProfile.autoApproveDirectPurchase ||
                    member.supplyProfile.role === 'OWNER_EXEC',
                supplierTaxId: analysis.supplierTaxId,
                supplierName: analysis.supplierName,
                documentType: analysis.documentType,
                folio: analysis.folio,
                issueDate: analysis.issueDate,
                netAmountClp: analysis.netAmountClp,
                vatAmountClp: analysis.vatAmountClp,
                totalAmountClp: analysis.totalAmountClp,
                paymentMethod,
                evidenceCasRef: analysis.evidenceCasRef,
                tedRawXml: analysis.tedRawXml,
                lines: analysis.lines,
                atypicalFlags: analysis.atypicalFlags,
            },
            {
                actorUid: member.uid,
                actorEmail: member.email || `${member.uid}@whatsapp.minreport.local`,
            }
        );

        const site = await SupplyRepository.getSite(member.tenantId, member.siteId);
        const threshold = site?.directPurchaseAlertThresholdClp ?? 500_000;
        const alerts: string[] = [];
        if (result.missingInvoiceAlert) {
            alerts.push('ATYPICAL_ASSET_WITHOUT_INVOICE: Activo patrimonial registrado sin Factura Electrónica DTE 33/34.');
        }
        if (
            member.supplyProfile.role !== 'OWNER_EXEC' &&
            result.purchase.totalAmountClp >= threshold
        ) {
            alerts.push(`Compra directa excede umbral informativo ($${threshold.toLocaleString('es-CL')} CLP).`);
        }

        if (alerts.length > 0) {
            const owners = await this.resolveTenantNotificationRecipients(member.tenantId, [
                'OWNER_EXEC',
                'OWNER',
                'ADMIN',
            ]);
            await EmailAndWhatsAppNotifier.notifyOwnerOfDirectPurchase({
                tenantId: member.tenantId,
                purchase: result.purchase,
                alerts,
                recipients: owners,
            });
        }

        const assetsNote =
            result.createdAssets.length > 0
                ? ` · ${result.createdAssets.length} activo(s) en Bóveda CAPEX`
                : '';
        const replyText = `Compra registrada: ${result.purchase.purchaseId} · DTE ${result.purchase.documentType} #${result.purchase.folio}${assetsNote}.`;
        await this.persistSessionFsmUpdate(session.sessionId, {
            pendingDirectPurchaseDraft: null,
            fsmState: 'COMMITTED',
            lastCommittedPurchaseId: result.purchase.purchaseId,
            lastReplyText: replyText,
        });

        if (!options.skipOutboundSend) {
            await MetaWhatsAppCloudAdapter.sendTextMessage(member.phoneE164, replyText);
        }

        return {
            handled: true,
            sessionId: session.sessionId,
            fsmState: 'COMMITTED',
            replyText,
            atypicalFlags: result.purchase.atypicalFlags,
            committedPurchaseId: result.purchase.purchaseId,
        };
    }

    private static async extractIntentFromMultimodal(params: {
        tenantId: string;
        textPrompt: string;
        media?: Array<{ mimeType: string; dataBase64: string }>;
    }): Promise<{
        transcript: string;
        intent: 'ADD_ITEMS' | 'FILL_SLOTS' | 'CONFIRM_COMMIT' | 'CANCEL' | 'STATUS_QUERY' | 'UNKNOWN';
        items: NonNullable<z.infer<typeof AiMessageExtractionSchema>['items']>;
    }> {
        const scrubbedPrompt = ConfidentialityAirlockService.scrubDeterministicPii(
            params.textPrompt,
            'CL'
        ).scrubbed;

        try {
            const { data } = await ResilientAIClient.generateStructured(
                {
                    module: SUPPLY_AI_MODULE,
                    preferredTier: 'SECONDARY',
                    temperature: 0,
                    tenantId: params.tenantId,
                    prompt: `${scrubbedPrompt}\nResponde solo JSON válido con { transcript, intent, items: [{ rawText, itemName, quantity, unitRaw, packagingUnit, size, location, linkedAssetId }] }.`,
                    media: params.media,
                },
                AiMessageExtractionSchema
            );
            return {
                transcript: data.transcript || '',
                intent: data.intent || 'ADD_ITEMS',
                items: data.items || [],
            };
        } catch {
            return { transcript: '', intent: 'UNKNOWN', items: [] };
        }
    }
}
