/**
 * MINREPORT · ABASTECIMIENTO — Validador Determinístico de Slots y FSM Conversacional
 *
 * Máquina de estados finita pura:
 *   `COLLECTING` -> `POLICY_CHECK` -> `SLOT_FILLING` -> `REVIEW_GATE` -> `COMMITTED`
 *
 * - Valida atributos obligatorios por SKU/categoría (`quantity`, `packagingUnit`, `size`,
 *   `location`, `photoOptional`, `linkedAssetId`).
 * - Consolida TODAS las preguntas faltantes en una sola burbuja de WhatsApp (FinOps:
 *   reduce 60–70% el costo por mensaje de Meta Cloud API).
 * - Genera resumen numerado limpio de `REVIEW_GATE` para confirmación explícita.
 */

import {
    AtypicalFlagCode,
    CanonicalSupplySku,
    ConversationFsmState,
    FulfillmentChannel,
    RequiredSlotName,
    SupplyCategoryCode,
    SupplyCostCenter,
    SupplyDemandNature,
    SupplyDemandOrigin,
    SupplyOperationalRole,
    SupplyRequisitionLine,
    SupplyUnitSi,
    SupplyUrgency,
    roundSupplyQty,
} from './types';
import {
    CATEGORY_DEFAULT_COST_CENTER,
    findCanonicalSkuById,
    matchCanonicalSkuByText,
    normalizeCatalogText,
} from '../catalog/DefaultSupplyCatalogSeed';
import {
    TenantUnitAlias,
    normalizeQuantityToSi,
    normalizeUnitExpression,
} from './UnitNormalizationEngine';
import {
    PolicyEvaluationContext,
    PolicyItemCandidate,
    RejectedPolicyItem,
    evaluateRequisitionPolicy,
} from './SupplyPolicyAndAnomalyEngine';

export interface DraftConversationItem {
    draftItemId: string;
    rawText: string;
    canonicalSkuId?: string;
    name: string;
    categoryCode: SupplyCategoryCode;
    procurementBucket: CanonicalSupplySku['procurementBucket'];
    quantity?: number;
    quantitySi?: number;
    unitRaw?: string;
    unitSi: SupplyUnitSi;
    hasExplicitQuantity: boolean;
    hasExplicitPackagingUnit: boolean;
    size?: string;
    location?: string;
    hasPhoto?: boolean;
    linkedAssetId?: string;
    urgency: SupplyUrgency;
    estimatedUnitClp?: number;
    atypicalFlags: AtypicalFlagCode[];
    isCapexAsset: boolean;
    isControlled: boolean;
    leySaco25kgApplied?: boolean;
}

export interface SlotValidationItemResult {
    draftItemId: string;
    canonicalSkuId?: string;
    name: string;
    complete: boolean;
    missingMandatorySlots: RequiredSlotName[];
    optionalHints: RequiredSlotName[];
    questionSpanish?: string;
}

export interface ConversationDraftSession {
    sessionId: string;
    tenantId: string;
    siteId: string;
    requesterUid: string;
    requesterName: string;
    requesterRole: SupplyOperationalRole;
    demandOrigin: SupplyDemandOrigin;
    demandNature: SupplyDemandNature;
    costCenter: SupplyCostCenter;
    state: ConversationFsmState;
    items: DraftConversationItem[];
    rejectedItems: RejectedPolicyItem[];
    linkedAssetId?: string;
}

export interface ConversationTurnOptions {
    policyContext: Omit<PolicyEvaluationContext, 'requesterRole' | 'demandNature'>;
    customCatalog?: readonly CanonicalSupplySku[];
    tenantAliases?: readonly TenantUnitAlias[];
    /** Permite inyectar ítems ya estructurados desde el extractor IA (o dejar vacío para parseo determinístico). */
    preExtractedItems?: readonly Partial<DraftConversationItem>[];
}

export interface ConversationTurnOutcome {
    previousState: ConversationFsmState;
    nextState: ConversationFsmState;
    passedThroughStates: ConversationFsmState[];
    session: ConversationDraftSession;
    slotResults: SlotValidationItemResult[];
    outboundBubbleSpanish: string;
    committedLines?: SupplyRequisitionLine[];
}

const CONFIRM_TOKENS = new Set([
    'ok',
    'okay',
    'si',
    'confirmar',
    'confirmo',
    'confirmado',
    'listo',
    'dale',
    'aprobar',
    'aprobado',
    'enviar',
    'correcto',
    'de acuerdo',
    'perfecto',
]);

const REJECT_OR_EDIT_TOKENS = new Set([
    'no',
    'cancelar',
    'corregir',
    'editar',
    'cambiar',
    'modificar',
    'anular',
]);

const MACHINERY_CATEGORIES = new Set<SupplyCategoryCode>([
    'REPUESTOS_MAQUINARIA',
    'LUBRICANTES_FILTROS',
    'PERFORACION_ACEROS',
]);

function resolveMandatorySlotsForItem(
    item: DraftConversationItem,
    sku: CanonicalSupplySku | undefined,
    requesterRole: SupplyOperationalRole
): { mandatory: RequiredSlotName[]; optional: RequiredSlotName[] } {
    const mandatory = new Set<RequiredSlotName>();
    const optional = new Set<RequiredSlotName>();

    if (sku) {
        for (const slot of sku.requiredSlots) {
            if (slot === 'photoOptional') {
                optional.add('photoOptional');
            } else {
                mandatory.add(slot);
            }
        }
    } else {
        mandatory.add('quantity');
    }

    // Reglas determinísticas por categoría / rol
    if (item.categoryCode === 'MANTENCION_CAMP') {
        mandatory.add('location');
        optional.add('photoOptional');
        // En mantención/reparación de campamento, cantidad por defecto es 1 trabajo si no se exige
        if (!sku?.requiredSlots.includes('quantity')) {
            mandatory.delete('quantity');
        }
    }

    if (
        MACHINERY_CATEGORIES.has(item.categoryCode) ||
        (requesterRole === 'MECHANIC_TECH' && item.procurementBucket === 'REPUESTOS_OPERMAQ')
    ) {
        mandatory.add('linkedAssetId');
    }

    if (
        item.categoryCode === 'EPP_SEGURIDAD' &&
        /bototo|zapato|bota|guante/i.test(`${item.name} ${item.rawText}`)
    ) {
        mandatory.add('size');
    }

    return {
        mandatory: [...mandatory],
        optional: [...optional],
    };
}

function buildQuestionForItem(
    item: DraftConversationItem,
    sku: CanonicalSupplySku | undefined,
    missing: readonly RequiredSlotName[],
    optionalHints: readonly RequiredSlotName[]
): string {
    const missingSet = new Set(missing);

    // Plantillas exactas del SKU cuando faltan cantidad / empaque
    if (
        sku?.canonicalSkuId === 'SKU-SUP-MANTEQUILLA' &&
        (missingSet.has('quantity') || missingSet.has('packagingUnit'))
    ) {
        return '¿Cuántos potes o panes de mantequilla?';
    }
    if (sku?.canonicalSkuId === 'SKU-SUP-HUEVOS' && missingSet.has('quantity')) {
        return '¿Cuántas bandejas (30 un) o cuántos huevos?';
    }

    const parts: string[] = [];

    if (missingSet.has('quantity') && missingSet.has('packagingUnit')) {
        if (sku?.slotQuestionTemplate) {
            parts.push(sku.slotQuestionTemplate);
        } else {
            parts.push(`¿Qué cantidad y formato/empaque necesitas de ${item.name.toLowerCase()}?`);
        }
    } else if (missingSet.has('quantity')) {
        if (sku?.slotQuestionTemplate) {
            parts.push(sku.slotQuestionTemplate);
        } else {
            parts.push(`¿Qué cantidad (${item.unitSi}) necesitas de ${item.name.toLowerCase()}?`);
        }
    } else if (missingSet.has('packagingUnit')) {
        parts.push(`¿En qué formato o empaque necesitas ${item.name.toLowerCase()} (ej. potes, panes, kg)?`);
    }

    if (missingSet.has('size')) {
        parts.push(`¿Qué talla o número necesitas para ${item.name.toLowerCase()}?`);
    }

    if (missingSet.has('location')) {
        const photoNote = optionalHints.includes('photoOptional')
            ? ' (opcional: puedes adjuntar foto)'
            : '';
        parts.push(
            `¿En qué ubicación exacta del campamento o faena es "${item.name.toLowerCase()}"?${photoNote}`
        );
    }

    if (missingSet.has('linkedAssetId')) {
        parts.push(`¿Para qué equipo o código de máquina (ej. CAT-320, CAM-04) es ${item.name.toLowerCase()}?`);
    }

    return parts.join(' ');
}

/**
 * Valida determinísticamente los atributos obligatorios de cada ítem en borrador.
 */
export function validateDraftSlots(
    items: readonly DraftConversationItem[],
    options?: {
        requesterRole?: SupplyOperationalRole;
        sessionLinkedAssetId?: string;
        customCatalog?: readonly CanonicalSupplySku[];
    }
): SlotValidationItemResult[] {
    const role = options?.requesterRole || 'CAMP_MANAGER';

    return items.map((item) => {
        const sku = item.canonicalSkuId
            ? findCanonicalSkuById(item.canonicalSkuId, options?.customCatalog)
            : matchCanonicalSkuByText(item.rawText || item.name, options?.customCatalog);

        const { mandatory, optional } = resolveMandatorySlotsForItem(item, sku, role);
        const missingMandatorySlots: RequiredSlotName[] = [];

        for (const slot of mandatory) {
            switch (slot) {
                case 'quantity':
                    if (!item.hasExplicitQuantity || !item.quantitySi || item.quantitySi <= 0) {
                        missingMandatorySlots.push('quantity');
                    }
                    break;
                case 'packagingUnit':
                    if (!item.hasExplicitPackagingUnit || !item.unitRaw) {
                        missingMandatorySlots.push('packagingUnit');
                    }
                    break;
                case 'size':
                    if (!item.size || !item.size.trim()) {
                        missingMandatorySlots.push('size');
                    }
                    break;
                case 'location':
                    if (!item.location || !item.location.trim()) {
                        missingMandatorySlots.push('location');
                    }
                    break;
                case 'linkedAssetId':
                    if (
                        !(item.linkedAssetId && item.linkedAssetId.trim()) &&
                        !(options?.sessionLinkedAssetId && options.sessionLinkedAssetId.trim())
                    ) {
                        missingMandatorySlots.push('linkedAssetId');
                    }
                    break;
                default:
                    break;
            }
        }

        const complete = missingMandatorySlots.length === 0;
        const questionSpanish = complete
            ? undefined
            : buildQuestionForItem(item, sku, missingMandatorySlots, optional);

        return {
            draftItemId: item.draftItemId,
            canonicalSkuId: item.canonicalSkuId || sku?.canonicalSkuId,
            name: item.name,
            complete,
            missingMandatorySlots,
            optionalHints: optional,
            questionSpanish,
        };
    });
}

/**
 * Construye una ÚNICA burbuja consolidada en español con todas las preguntas faltantes
 * (optimización FinOps WhatsApp Cloud API).
 */
export function buildConsolidatedSlotQuestion(params: {
    slotResults: readonly SlotValidationItemResult[];
    items: readonly DraftConversationItem[];
    rejectedItems?: readonly RejectedPolicyItem[];
}): string {
    const sections: string[] = [];

    if (params.rejectedItems && params.rejectedItems.length > 0) {
        const rejLines = params.rejectedItems.map((r) => `- ${r.reasonSpanish}`);
        sections.push(`Aviso de política:\n${rejLines.join('\n')}`);
    }

    const completeItems = params.slotResults.filter((r) => r.complete);
    if (completeItems.length > 0) {
        const okSummary = completeItems
            .map((r) => {
                const match = params.items.find((i) => i.draftItemId === r.draftItemId);
                if (!match) return r.name;
                return match.quantitySi
                    ? `${match.name} (${match.quantitySi} ${match.unitSi})`
                    : match.name;
            })
            .join(', ');
        sections.push(`Anotado: ${okSummary}.`);
    }

    const incomplete = params.slotResults.filter((r) => !r.complete && r.questionSpanish);
    if (incomplete.length > 0) {
        const questions = incomplete.map((r, idx) => `${idx + 1}. ${r.questionSpanish}`);
        sections.push(
            `Para completar tu pedido en un solo mensaje, indícame:\n${questions.join('\n')}`
        );
    }

    return sections.join('\n\n').trim();
}

/**
 * Construye la lista numerada limpia de `REVIEW_GATE` para confirmación humana explícita.
 */
export function buildReviewGateSummary(params: {
    items: readonly DraftConversationItem[];
    rejectedItems?: readonly RejectedPolicyItem[];
}): string {
    const blocks: string[] = [];

    if (params.rejectedItems && params.rejectedItems.length > 0) {
        const rejLines = params.rejectedItems.map((r) => `- ${r.reasonSpanish}`);
        blocks.push(`Ítems descartados por política:\n${rejLines.join('\n')}`);
    }

    const lines = params.items.map((item, idx) => {
        const qtyDisplay =
            item.quantitySi && item.quantitySi > 0
                ? `${item.quantitySi} ${item.unitSi}`
                : item.categoryCode === 'MANTENCION_CAMP'
                  ? '1 servicio'
                  : `1 ${item.unitSi}`;

        const packAnnotation =
            item.unitRaw &&
            item.quantity &&
            normalizeCatalogText(item.unitRaw) !== normalizeCatalogText(item.unitSi)
                ? ` (${item.quantity} ${item.unitRaw})`
                : '';

        const extras: string[] = [];
        if (item.size) extras.push(`talla ${item.size}`);
        if (item.location) extras.push(`ubicación: ${item.location}`);
        if (item.linkedAssetId) extras.push(`equipo: ${item.linkedAssetId}`);
        if (item.atypicalFlags.length > 0) extras.push(`[revisión: ${item.atypicalFlags.join(', ')}]`);

        const extraSuffix = extras.length > 0 ? ` — ${extras.join(' | ')}` : '';
        return `${idx + 1}. ${item.name}: ${qtyDisplay}${packAnnotation}${extraSuffix}`;
    });

    blocks.push(
        `Resumen de solicitud (${params.items.length} ítems):\n${lines.join('\n')}\n\nResponde OK o CONFIRMAR para enviar a Abastecimiento, o indica qué deseas corregir.`
    );

    return blocks.join('\n\n');
}

/**
 * Detecta determinísticamente la intención en `REVIEW_GATE`.
 */
export function parseConfirmationIntent(rawMessage: string): 'CONFIRM' | 'REJECT_OR_EDIT' | 'UNKNOWN' {
    const normalized = normalizeCatalogText(rawMessage);
    if (!normalized) return 'UNKNOWN';
    if (CONFIRM_TOKENS.has(normalized)) return 'CONFIRM';
    if (REJECT_OR_EDIT_TOKENS.has(normalized)) return 'REJECT_OR_EDIT';

    const firstToken = normalized.split(' ')[0];
    if (CONFIRM_TOKENS.has(firstToken) && normalized.split(' ').length <= 3) return 'CONFIRM';
    if (REJECT_OR_EDIT_TOKENS.has(firstToken)) return 'REJECT_OR_EDIT';
    return 'UNKNOWN';
}

function extractInlineSize(segment: string): string | undefined {
    const match = segment.match(/(?:talla|n[°ºo]?\.?|numero|número)\s*([a-z0-9]{1,4})\b/i);
    return match ? match[1].toUpperCase() : undefined;
}

function extractInlineAssetId(segment: string): string | undefined {
    const match = segment.match(
        /(?:equipo|maquina|máquina|camion|camión|cargador|excavadora|perforadora|para)\s+([A-Z]{2,5}[- ]?\d{1,5}[A-Z]?)\b/i
    );
    if (match) return match[1].toUpperCase().replace(/\s+/g, '-');
    const codeOnly = segment.match(/\b([A-Z]{2,5}-\d{1,5}[A-Z]?)\b/);
    return codeOnly ? codeOnly[1].toUpperCase() : undefined;
}

function extractInlineLocation(segment: string): string | undefined {
    const match = segment.match(
        /(?:en|sector|ubicacion|ubicación|pabellon|pabellón|baño|bano|cocina|dormitorio|comedor|bodega)\s+([^,;]+)/i
    );
    if (match) return match[0].trim();
    return undefined;
}

/**
 * Divide un mensaje en español chileno en segmentos de ítems individuales
 * (ej. "Mantequilla, 2 kilos de papas y huevos" -> ["Mantequilla", "2 kilos de papas", "huevos"]).
 */
export function splitSpanishListMessage(rawMessage: string): string[] {
    // Preservar comas decimales entre dígitos (ej. "1,5 kilos de papas") antes de dividir por coma
    const decimalProtected = String(rawMessage || '').replace(/(\d),(\d)/g, '$1.$2');
    return decimalProtected
        .split(/\r?\n|;|,|(?:\s+y\s+)|(?:\s+e\s+)/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * Convierte texto libre en candidatos `DraftConversationItem` de forma 100% determinística.
 */
export function parseRawSpanishItemsToDraft(
    rawMessage: string,
    options?: {
        customCatalog?: readonly CanonicalSupplySku[];
        tenantAliases?: readonly TenantUnitAlias[];
        idPrefix?: string;
    }
): DraftConversationItem[] {
    const segments = splitSpanishListMessage(rawMessage);
    const prefix = options?.idPrefix || 'draft';

    return segments.map((segment, index) => {
        const parsed = normalizeUnitExpression(segment, {
            customCatalog: options?.customCatalog,
            tenantAliases: options?.tenantAliases,
        });
        const sku =
            (parsed.canonicalSkuHint
                ? findCanonicalSkuById(parsed.canonicalSkuHint, options?.customCatalog)
                : undefined) ||
            matchCanonicalSkuByText(parsed.cleanedItemText || segment, options?.customCatalog);

        const size = extractInlineSize(segment);
        const linkedAssetId = extractInlineAssetId(segment);
        const location =
            sku?.categoryCode === 'MANTENCION_CAMP' ? extractInlineLocation(segment) : undefined;

        const hasExplicitQuantity = parsed.hasExplicitQuantity;
        const hasExplicitPackagingUnit = parsed.hasExplicitUnit;

        return {
            draftItemId: `${prefix}-${index + 1}`,
            rawText: segment,
            canonicalSkuId: sku?.canonicalSkuId,
            name: sku?.name || segment,
            categoryCode: sku?.categoryCode || 'OTROS_OPERACIONAL',
            procurementBucket: sku?.procurementBucket || 'FERRETERIA',
            quantity: hasExplicitQuantity ? parsed.originalQuantity : undefined,
            quantitySi: hasExplicitQuantity ? parsed.quantitySi : undefined,
            unitRaw: hasExplicitPackagingUnit ? parsed.originalUnitRaw : undefined,
            unitSi: sku?.baseUnitSi || parsed.unitSi,
            hasExplicitQuantity,
            hasExplicitPackagingUnit,
            size,
            location,
            linkedAssetId,
            urgency: /urgente|critico|crítico|emergencia|detenid/i.test(segment)
                ? 'CRITICAL'
                : 'STANDARD',
            estimatedUnitClp: sku?.referenceUnitPriceClp,
            atypicalFlags: [],
            isCapexAsset: Boolean(sku?.isCapexAsset),
            isControlled: Boolean(sku?.isControlled),
            leySaco25kgApplied: parsed.leySaco25kgApplied,
        };
    });
}

/**
 * Aplica respuestas del usuario en `SLOT_FILLING` sobre los ítems incompletos del borrador.
 */
export function applySlotAnswersToDraft(
    items: readonly DraftConversationItem[],
    answerMessage: string,
    options?: {
        customCatalog?: readonly CanonicalSupplySku[];
        tenantAliases?: readonly TenantUnitAlias[];
        requesterRole?: SupplyOperationalRole;
    }
): DraftConversationItem[] {
    const segments = splitSpanishListMessage(answerMessage);
    const updated = items.map((i) => ({ ...i }));
    const initialValidation = validateDraftSlots(updated, {
        requesterRole: options?.requesterRole,
        customCatalog: options?.customCatalog,
    });
    const missingByDraftId = new Map(
        initialValidation.map((r) => [r.draftItemId, new Set(r.missingMandatorySlots)])
    );
    const incompleteIds = new Set(
        initialValidation.filter((r) => !r.complete).map((r) => r.draftItemId)
    );

    const globalSize = extractInlineSize(answerMessage);
    const globalAsset = extractInlineAssetId(answerMessage);

    for (const seg of segments) {
        const segNorm = normalizeCatalogText(seg);
        const segSku = matchCanonicalSkuByText(seg, options?.customCatalog);
        const segParsed = normalizeUnitExpression(seg, {
            sku: segSku,
            customCatalog: options?.customCatalog,
            tenantAliases: options?.tenantAliases,
        });

        // Encontrar el ítem incompleto que mejor corresponde a este segmento
        let targetItem = updated.find(
            (item) =>
                incompleteIds.has(item.draftItemId) &&
                ((segSku && item.canonicalSkuId === segSku.canonicalSkuId) ||
                    (segParsed.canonicalSkuHint &&
                        item.canonicalSkuId === segParsed.canonicalSkuHint) ||
                    segNorm.includes(normalizeCatalogText(item.name)))
        );

        // Si solo queda 1 ítem incompleto, asignar directamente el segmento de respuesta
        if (!targetItem) {
            const remainingIncomplete = updated.filter((item) => incompleteIds.has(item.draftItemId));
            if (remainingIncomplete.length === 1) {
                targetItem = remainingIncomplete[0];
            }
        }

        if (!targetItem) continue;

        const targetMissing = missingByDraftId.get(targetItem.draftItemId) || new Set<RequiredSlotName>();
        const targetSku = targetItem.canonicalSkuId
            ? findCanonicalSkuById(targetItem.canonicalSkuId, options?.customCatalog)
            : segSku;

        const needsQuantityOrPack =
            targetMissing.has('quantity') || targetMissing.has('packagingUnit');

        // Si el ítem únicamente espera talla y el usuario responde un código corto (ej. "42", "XL")
        const bareSizeMatch =
            !needsQuantityOrPack &&
            targetMissing.has('size') &&
            /^(?:[2-5]\d|xs|s|m|l|xl|xxl)$/i.test(segNorm)
                ? segNorm.toUpperCase()
                : undefined;

        if (needsQuantityOrPack && segParsed.hasExplicitQuantity) {
            const normalized = normalizeQuantityToSi({
                quantity: segParsed.originalQuantity,
                unitRaw: segParsed.hasExplicitUnit ? segParsed.originalUnitRaw : targetItem.unitRaw,
                itemText: `${seg} ${targetItem.name}`,
                sku: targetSku,
                tenantAliases: options?.tenantAliases,
            });
            targetItem.quantity = segParsed.originalQuantity;
            targetItem.quantitySi = normalized.quantitySi;
            targetItem.unitSi = normalized.unitSi;
            targetItem.hasExplicitQuantity = true;
            if (segParsed.hasExplicitUnit) {
                targetItem.unitRaw = segParsed.originalUnitRaw;
                targetItem.hasExplicitPackagingUnit = true;
            } else if (
                targetSku?.canonicalSkuId === 'SKU-SUP-HUEVOS' ||
                !targetSku?.requiredSlots.includes('packagingUnit')
            ) {
                targetItem.unitRaw = targetItem.unitRaw || normalized.unitSi;
                targetItem.hasExplicitPackagingUnit = true;
            }
            targetItem.leySaco25kgApplied = normalized.leySaco25kgApplied;
        }

        const segSize = extractInlineSize(seg) || bareSizeMatch || globalSize;
        if (segSize && !targetItem.size) {
            targetItem.size = segSize;
        }

        const segAsset = extractInlineAssetId(seg) || globalAsset;
        if (segAsset && !targetItem.linkedAssetId) {
            targetItem.linkedAssetId = segAsset;
        }

        if (targetItem.categoryCode === 'MANTENCION_CAMP' && !targetItem.location) {
            targetItem.location = extractInlineLocation(seg) || seg.trim();
        }
    }

    return updated;
}

/**
 * Ejecuta un turno completo de la FSM determinística:
 * `COLLECTING` -> `POLICY_CHECK` -> `SLOT_FILLING` -> `REVIEW_GATE` -> `COMMITTED`.
 */
export function advanceConversationTurn(
    currentSession: ConversationDraftSession,
    userMessage: string,
    options: ConversationTurnOptions
): ConversationTurnOutcome {
    const previousState = currentSession.state;
    const passedThroughStates: ConversationFsmState[] = [previousState];

    // ── ESTADO: REVIEW_GATE ─────────────────────────────────────────────────
    if (previousState === 'REVIEW_GATE') {
        const intent = parseConfirmationIntent(userMessage);
        if (intent === 'CONFIRM') {
            const committedLines: SupplyRequisitionLine[] = currentSession.items.map((item, idx) => {
                const qty = roundSupplyQty(item.quantitySi ?? item.quantity ?? 1);
                const attributes: Record<string, string | number | boolean> = {};
                if (item.size) attributes.size = item.size;
                if (item.location) attributes.location = item.location;
                if (item.linkedAssetId) attributes.linkedAssetId = item.linkedAssetId;
                if (item.unitRaw) attributes.originalPackUnit = item.unitRaw;
                if (item.leySaco25kgApplied) attributes.leySaco25kgApplied = true;

                return {
                    lineId: `line-${idx + 1}`,
                    canonicalSkuId: item.canonicalSkuId || `SKU-CUSTOM-${idx + 1}`,
                    description: item.name,
                    categoryCode: item.categoryCode,
                    procurementBucket: item.procurementBucket,
                    unitSi: item.unitSi,
                    qtyRequested: qty,
                    qtyPurchased: 0,
                    qtyReceived: 0,
                    qtyPending: qty,
                    lineStatus: 'OPEN',
                    atypicalFlags: [...item.atypicalFlags],
                    fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE' as FulfillmentChannel,
                    urgency: item.urgency,
                    estimatedUnitClp: item.estimatedUnitClp,
                    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
                };
            });

            const nextSession: ConversationDraftSession = {
                ...currentSession,
                state: 'COMMITTED',
            };
            passedThroughStates.push('COMMITTED');

            return {
                previousState,
                nextState: 'COMMITTED',
                passedThroughStates,
                session: nextSession,
                slotResults: validateDraftSlots(nextSession.items, {
                    requesterRole: nextSession.requesterRole,
                    sessionLinkedAssetId: nextSession.linkedAssetId,
                    customCatalog: options.customCatalog,
                }),
                outboundBubbleSpanish: `Solicitud confirmada y enviada a Abastecimiento (${committedLines.length} ítems).`,
                committedLines,
            };
        }

        if (intent === 'REJECT_OR_EDIT') {
            const nextSession: ConversationDraftSession = {
                ...currentSession,
                state: 'SLOT_FILLING',
            };
            passedThroughStates.push('SLOT_FILLING');
            return {
                previousState,
                nextState: 'SLOT_FILLING',
                passedThroughStates,
                session: nextSession,
                slotResults: validateDraftSlots(nextSession.items, {
                    requesterRole: nextSession.requesterRole,
                    sessionLinkedAssetId: nextSession.linkedAssetId,
                    customCatalog: options.customCatalog,
                }),
                outboundBubbleSpanish:
                    'Entendido. Indícame en un mensaje qué ítem o cantidad deseas corregir.',
            };
        }

        return {
            previousState,
            nextState: 'REVIEW_GATE',
            passedThroughStates,
            session: currentSession,
            slotResults: validateDraftSlots(currentSession.items, {
                requesterRole: currentSession.requesterRole,
                sessionLinkedAssetId: currentSession.linkedAssetId,
                customCatalog: options.customCatalog,
            }),
            outboundBubbleSpanish:
                'Responde OK o CONFIRMAR para enviar la solicitud, o CORREGIR si necesitas cambiar algún dato.',
        };
    }

    // ── ESTADO: SLOT_FILLING ────────────────────────────────────────────────
    if (previousState === 'SLOT_FILLING') {
        const updatedItems = applySlotAnswersToDraft(currentSession.items, userMessage, {
            customCatalog: options.customCatalog,
            tenantAliases: options.tenantAliases,
            requesterRole: currentSession.requesterRole,
        });

        // Re-evaluar política tras conocer las cantidades finales (ej. volumen spike / high value)
        passedThroughStates.push('POLICY_CHECK');
        const policyCandidates: PolicyItemCandidate[] = updatedItems.map((item) => ({
            itemKey: item.draftItemId,
            rawText: item.rawText,
            canonicalSkuId: item.canonicalSkuId,
            sku: item.canonicalSkuId
                ? findCanonicalSkuById(item.canonicalSkuId, options.customCatalog)
                : undefined,
            categoryCode: item.categoryCode,
            quantitySi: item.quantitySi ?? 1,
            unitSi: item.unitSi,
            estimatedUnitClp: item.estimatedUnitClp,
            isCapexAsset: item.isCapexAsset,
            isControlled: item.isControlled,
        }));

        const policyResult = evaluateRequisitionPolicy(policyCandidates, {
            ...options.policyContext,
            requesterRole: currentSession.requesterRole,
            demandNature: currentSession.demandNature,
        });

        const acceptedMap = new Map(policyResult.acceptedItems.map((a) => [a.itemKey, a]));
        const survivingItems = updatedItems
            .filter((item) => acceptedMap.has(item.draftItemId))
            .map((item) => ({
                ...item,
                atypicalFlags: acceptedMap.get(item.draftItemId)?.atypicalFlags || [],
            }));

        const slotResults = validateDraftSlots(survivingItems, {
            requesterRole: currentSession.requesterRole,
            sessionLinkedAssetId: currentSession.linkedAssetId,
            customCatalog: options.customCatalog,
        });

        const allComplete = survivingItems.length > 0 && slotResults.every((r) => r.complete);
        const nextState: ConversationFsmState = allComplete ? 'REVIEW_GATE' : 'SLOT_FILLING';
        passedThroughStates.push(nextState);

        const mergedRejections = [...currentSession.rejectedItems, ...policyResult.rejectedItems];
        const nextSession: ConversationDraftSession = {
            ...currentSession,
            state: nextState,
            items: survivingItems,
            rejectedItems: mergedRejections,
        };

        const outboundBubbleSpanish = allComplete
            ? buildReviewGateSummary({ items: survivingItems, rejectedItems: mergedRejections })
            : buildConsolidatedSlotQuestion({
                  slotResults,
                  items: survivingItems,
                  rejectedItems: mergedRejections,
              });

        return {
            previousState,
            nextState,
            passedThroughStates,
            session: nextSession,
            slotResults,
            outboundBubbleSpanish,
        };
    }

    // ── ESTADO: COLLECTING (o ingreso inicial) ──────────────────────────────
    const extractedItems: DraftConversationItem[] =
        options.preExtractedItems && options.preExtractedItems.length > 0
            ? options.preExtractedItems.map((partial, idx) => {
                  const sku = partial.canonicalSkuId
                      ? findCanonicalSkuById(partial.canonicalSkuId, options.customCatalog)
                      : matchCanonicalSkuByText(
                            partial.rawText || partial.name || '',
                            options.customCatalog
                        );
                  return {
                      draftItemId: partial.draftItemId || `draft-${idx + 1}`,
                      rawText: partial.rawText || partial.name || '',
                      canonicalSkuId: partial.canonicalSkuId || sku?.canonicalSkuId,
                      name: partial.name || sku?.name || partial.rawText || '',
                      categoryCode: partial.categoryCode || sku?.categoryCode || 'OTROS_OPERACIONAL',
                      procurementBucket:
                          partial.procurementBucket || sku?.procurementBucket || 'FERRETERIA',
                      quantity: partial.quantity,
                      quantitySi: partial.quantitySi,
                      unitRaw: partial.unitRaw,
                      unitSi: partial.unitSi || sku?.baseUnitSi || 'un',
                      hasExplicitQuantity:
                          partial.hasExplicitQuantity ??
                          Boolean(partial.quantitySi && partial.quantitySi > 0),
                      hasExplicitPackagingUnit:
                          partial.hasExplicitPackagingUnit ?? Boolean(partial.unitRaw),
                      size: partial.size,
                      location: partial.location,
                      hasPhoto: partial.hasPhoto,
                      linkedAssetId: partial.linkedAssetId,
                      urgency: partial.urgency || 'STANDARD',
                      estimatedUnitClp: partial.estimatedUnitClp ?? sku?.referenceUnitPriceClp,
                      atypicalFlags: [],
                      isCapexAsset: partial.isCapexAsset ?? Boolean(sku?.isCapexAsset),
                      isControlled: partial.isControlled ?? Boolean(sku?.isControlled),
                      leySaco25kgApplied: partial.leySaco25kgApplied ?? sku?.leySaco25kgApplied,
                  };
              })
            : parseRawSpanishItemsToDraft(userMessage, {
                  customCatalog: options.customCatalog,
                  tenantAliases: options.tenantAliases,
              });

    const combinedItems = [...currentSession.items, ...extractedItems];
    passedThroughStates.push('POLICY_CHECK');

    const policyCandidates: PolicyItemCandidate[] = combinedItems.map((item) => ({
        itemKey: item.draftItemId,
        rawText: item.rawText,
        canonicalSkuId: item.canonicalSkuId,
        sku: item.canonicalSkuId
            ? findCanonicalSkuById(item.canonicalSkuId, options.customCatalog)
            : undefined,
        categoryCode: item.categoryCode,
        quantitySi: item.quantitySi ?? 1,
        unitSi: item.unitSi,
        estimatedUnitClp: item.estimatedUnitClp,
        isCapexAsset: item.isCapexAsset,
        isControlled: item.isControlled,
    }));

    const policyResult = evaluateRequisitionPolicy(policyCandidates, {
        ...options.policyContext,
        requesterRole: currentSession.requesterRole,
        demandNature: currentSession.demandNature,
    });

    const acceptedMap = new Map(policyResult.acceptedItems.map((a) => [a.itemKey, a]));
    const acceptedDraftItems = combinedItems
        .filter((item) => acceptedMap.has(item.draftItemId))
        .map((item) => ({
            ...item,
            atypicalFlags: acceptedMap.get(item.draftItemId)?.atypicalFlags || [],
        }));

    if (acceptedDraftItems.length === 0) {
        const nextSession: ConversationDraftSession = {
            ...currentSession,
            state: 'COLLECTING',
            items: [],
            rejectedItems: policyResult.rejectedItems,
        };
        return {
            previousState,
            nextState: 'COLLECTING',
            passedThroughStates,
            session: nextSession,
            slotResults: [],
            outboundBubbleSpanish:
                policyResult.politeRejectionSummarySpanish ||
                'No se detectaron insumos operacionales válidos. Indica qué insumos necesitas.',
        };
    }

    const slotResults = validateDraftSlots(acceptedDraftItems, {
        requesterRole: currentSession.requesterRole,
        sessionLinkedAssetId: currentSession.linkedAssetId,
        customCatalog: options.customCatalog,
    });

    const allComplete = slotResults.every((r) => r.complete);
    const nextState: ConversationFsmState = allComplete ? 'REVIEW_GATE' : 'SLOT_FILLING';
    passedThroughStates.push(nextState);

    const costCenter =
        currentSession.costCenter ||
        CATEGORY_DEFAULT_COST_CENTER[acceptedDraftItems[0].categoryCode] ||
        'CC-OPERACIONES';

    const nextSession: ConversationDraftSession = {
        ...currentSession,
        costCenter,
        state: nextState,
        items: acceptedDraftItems,
        rejectedItems: policyResult.rejectedItems,
    };

    const outboundBubbleSpanish = allComplete
        ? buildReviewGateSummary({
              items: acceptedDraftItems,
              rejectedItems: policyResult.rejectedItems,
          })
        : buildConsolidatedSlotQuestion({
              slotResults,
              items: acceptedDraftItems,
              rejectedItems: policyResult.rejectedItems,
          });

    return {
        previousState,
        nextState,
        passedThroughStates,
        session: nextSession,
        slotResults,
        outboundBubbleSpanish,
    };
}
