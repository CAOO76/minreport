import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../../config/firebase';
import { resolveX402HmacSecret } from '../../../config/secrets';
import { AuditLedger } from '../../../core/audit-ledger';
import { computeShortTtlTimestamp } from '../../../core/retention-policy';
import { EmailService } from '../../../services/EmailService';
import { constantTimeEqualStrings } from '../../../utils/security';
import { normalizeE164Phone, validateChileanRut } from '../../../utils/taxIdValidator';
import { MetaWhatsAppCloudAdapter } from '../adapters/MetaWhatsAppCloudAdapter';
import {
    type AuditActorContext,
    maskPhoneE164,
    resolveListLimit,
} from './SupplyRepository';
import {
    IsoCurrencyCodeSchema,
    SUPPLY_AUDIT_MODULE,
    SupplyCategoryCodeSchema,
    SupplyUnitSiSchema,
    UNIT_SI_TO_UNCEFACT_REC20,
    UnCefactRec20CodeSchema,
} from './supply.types';

/**
 * SERVICIO DE ONBOARDING CERO-FRICCIÓN PARA PROVEEDORES LOCALES (RFQ EXPRESS)
 * MINREPORT · ABASTECIMIENTO — Capa 3 ISO 27001 / Ley N° 21.719
 *
 * Permite cotización exprés sin portal ni licencia previa mediante enlace firmado HMAC-SHA256
 * de estricto un solo uso:
 * - Jamás persiste el token plano en Firestore (solo `tokenHash` SHA-256).
 * - Expiración configurable (`expiresAtMs`) + purga nativa Firestore TTL (`ttlExpiresAt` a 14 días).
 * - La vista pública (`GET /rfq-express/:token`) expone exclusivamente ítems a cotizar, distrito macro
 *   y moneda (cero GPS, cero PII de solicitantes, cero presupuesto interno).
 * - El envío (`POST /rfq-express/:token/submit`) se ejecuta dentro de `db.runTransaction(...)`
 *   transicionando atómicamente `OPEN -> SUBMITTED` (segundo intento -> HTTP 409 `RFQ_TOKEN_ALREADY_USED`)
 *   y sellando trazabilidad fail-closed en `AuditLedger`.
 */

export const SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION = 'supply_express_rfq_invites';
export const SUPPLY_EXPRESS_RFQ_QUOTES_COLLECTION = 'supply_express_rfq_quotes';

const EXPRESS_RFQ_TOKEN_PREFIX = 'rfq1';
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const ISO_DATE_OR_DATETIME_REGEX =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/;
const STRICT_SUPPLIER_TAX_ID_REGEX = /^[A-Z0-9][A-Z0-9.-]{3,30}[A-Z0-9]$/;
const CHILEAN_RUT_SHAPE_REGEX = /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/;
const MAX_UNIT_PRICE_NET = 1_000_000_000_000;

export class ExpressRfqError extends Error {
    public readonly statusCode: number;
    public readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
        super(message);
        this.name = 'ExpressRfqError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function isValidExpressSupplierTaxId(raw: string): boolean {
    const trimmed = String(raw || '').trim();
    if (!STRICT_SUPPLIER_TAX_ID_REGEX.test(trimmed.toUpperCase())) {
        return false;
    }
    if (CHILEAN_RUT_SHAPE_REGEX.test(trimmed)) {
        return validateChileanRut(trimmed).valid;
    }
    const compact = trimmed.toUpperCase().replace(/\./g, '');
    return /^[A-Z0-9-]{5,24}$/.test(compact) && !compact.includes('--');
}

export const CreateExpressRfqInviteItemSchema = z.object({
    canonicalSkuId: z.string().trim().min(1).max(128),
    itemName: z.string().trim().min(1).max(200),
    qtyRequested: z.number().finite().positive().max(1_000_000_000),
    unitSi: SupplyUnitSiSchema,
    unCefactCode: UnCefactRec20CodeSchema.optional(),
    categoryCode: SupplyCategoryCodeSchema.optional(),
    specification: z.string().trim().max(300).optional(),
});

export const CreateExpressRfqInviteSchema = z.object({
    siteId: z.string().trim().min(1).max(128),
    requisitionId: z.string().trim().min(1).max(128).optional(),
    districtCode: z.string().trim().min(2).max(64),
    supplierName: z.string().trim().min(2).max(200),
    supplierTaxId: z
        .string()
        .trim()
        .min(5)
        .max(32)
        .refine(isValidExpressSupplierTaxId, 'supplierTaxId inválido.')
        .optional(),
    supplierPhoneE164: z.string().trim().min(8).max(24).optional(),
    supplierEmail: z.string().trim().email().max(160).optional(),
    currencyCode: IsoCurrencyCodeSchema.default('CLP'),
    expiresInHours: z.number().int().min(1).max(336).default(72),
    dispatchChannel: z.enum(['NONE', 'WHATSAPP', 'EMAIL', 'BOTH']).default('NONE'),
    notes: z.string().trim().max(500).optional(),
    items: z.array(CreateExpressRfqInviteItemSchema).min(1).max(50),
});

export type CreateExpressRfqInviteInput = z.infer<typeof CreateExpressRfqInviteSchema>;

export const SubmitExpressRfqQuoteItemSchema = z.object({
    canonicalSkuId: z.string().trim().min(1).max(128),
    unitPriceNet: z.number().finite().positive().max(MAX_UNIT_PRICE_NET),
    availableQty: z.number().finite().positive().max(1_000_000_000).optional(),
    notes: z.string().trim().max(240).optional(),
});

export const SubmitExpressRfqQuoteSchema = z.object({
    supplierTaxId: z
        .string()
        .trim()
        .min(5)
        .max(32)
        .refine(
            isValidExpressSupplierTaxId,
            'supplierTaxId inválido (RUT chileno Módulo-11 o Tax ID internacional requerido).'
        ),
    supplierName: z.string().trim().min(2).max(200),
    deliveryDistrictCode: z.string().trim().min(2).max(64).optional(),
    leadTimeDays: z.number().int().min(1).max(120),
    validUntilIso: z
        .string()
        .trim()
        .min(10)
        .max(40)
        .refine((v) => {
            if (!ISO_DATE_OR_DATETIME_REGEX.test(v)) return false;
            const parsedMs = Date.parse(v);
            return Number.isFinite(parsedMs);
        }, 'validUntilIso debe ser una fecha ISO 8601 válida.'),
    currencyCode: IsoCurrencyCodeSchema.optional(),
    notes: z.string().trim().max(500).optional(),
    itemQuotes: z.array(SubmitExpressRfqQuoteItemSchema).min(1).max(50),
});

export type SubmitExpressRfqQuoteInput = z.infer<typeof SubmitExpressRfqQuoteSchema>;

export type ExpressRfqInviteStatus = 'OPEN' | 'SUBMITTED' | 'EXPIRED' | 'REVOKED';

export interface StoredExpressRfqInviteItem {
    canonicalSkuId: string;
    itemName: string;
    qtyRequested: number;
    unitSi: z.infer<typeof SupplyUnitSiSchema>;
    unCefactCode: z.infer<typeof UnCefactRec20CodeSchema>;
    categoryCode?: z.infer<typeof SupplyCategoryCodeSchema>;
    specification?: string;
}

export interface StoredExpressRfqInvite {
    inviteId: string;
    tenantId: string;
    siteId: string;
    requisitionId?: string;
    districtCode: string;
    supplierName: string;
    supplierTaxId?: string;
    supplierPhoneMasked?: string;
    currencyCode: string;
    items: StoredExpressRfqInviteItem[];
    tokenHash: string;
    status: ExpressRfqInviteStatus;
    expiresAtMs: number;
    expiresAtIso: string;
    ttlExpiresAt: unknown;
    usedAtIso?: string | null;
    submittedQuoteId?: string | null;
    createdByUid: string;
    createdAt: string;
    updatedAt: string;
}

export interface PublicExpressRfqInviteView {
    inviteId: string;
    districtCode: string;
    currencyCode: string;
    supplierName: string;
    items: Array<{
        canonicalSkuId: string;
        itemName: string;
        qtyRequested: number;
        unitSi: string;
        unCefactCode: string;
        specification: string | null;
    }>;
    expiresAtIso: string;
    status: 'OPEN';
}

export interface AdminExpressRfqInviteView {
    inviteId: string;
    tenantId: string;
    siteId: string;
    requisitionId?: string;
    districtCode: string;
    supplierName: string;
    supplierTaxId?: string;
    supplierPhoneMasked?: string;
    currencyCode: string;
    itemCount: number;
    items: StoredExpressRfqInviteItem[];
    status: ExpressRfqInviteStatus;
    expiresAtIso: string;
    usedAtIso?: string | null;
    submittedQuoteId?: string | null;
    createdByUid: string;
    createdAt: string;
    updatedAt: string;
}

export interface StoredExpressRfqQuote {
    quoteId: string;
    inviteId: string;
    tenantId: string;
    siteId: string;
    requisitionId?: string;
    districtCode: string;
    deliveryDistrictCode: string;
    supplierTaxId: string;
    supplierName: string;
    currencyCode: string;
    leadTimeDays: number;
    validUntilIso: string;
    itemQuotes: Array<{
        canonicalSkuId: string;
        itemName: string;
        qtyRequested: number;
        unitSi: string;
        unCefactCode: string;
        unitPriceNet: number;
        availableQty: number;
        lineTotalNet: number;
        notes?: string;
    }>;
    totalEstimatedNet: number;
    notes?: string;
    status: 'SUBMITTED';
    submittedAtIso: string;
    createdAt: string;
}

interface ParsedExpressRfqTokenPayload {
    v: number;
    inviteId: string;
    tenantId: string;
    exp: number;
    nonce: string;
}

async function resolveRfqSigningSecret(): Promise<string> {
    const fromSecrets = await resolveX402HmacSecret().catch(() => null);
    const candidate = fromSecrets?.trim() || process.env.X402_HMAC_SECRET?.trim() || '';
    if (candidate) {
        return candidate;
    }
    throw new ExpressRfqError(
        503,
        'RFQ_SIGNING_SECRET_UNAVAILABLE',
        'Secreto HMAC-SHA256 (X402_HMAC_SECRET) no configurado en Secret Manager southamerica-west1.'
    );
}

function sha256Hex(raw: string): string {
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function signExpressRfqToken(
    payload: ParsedExpressRfqTokenPayload,
    secret: string
): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sigB64 = crypto
        .createHmac('sha256', secret)
        .update(`${EXPRESS_RFQ_TOKEN_PREFIX}.${payloadB64}`, 'utf8')
        .digest('base64url');
    return `${EXPRESS_RFQ_TOKEN_PREFIX}.${payloadB64}.${sigB64}`;
}

function verifyExpressRfqTokenSignature(
    signedToken: string,
    secret: string,
    nowMs: number
): ParsedExpressRfqTokenPayload {
    const cleanToken = String(signedToken || '').trim();
    const parts = cleanToken.split('.');
    if (parts.length !== 3 || parts[0] !== EXPRESS_RFQ_TOKEN_PREFIX || !parts[1] || !parts[2]) {
        throw new ExpressRfqError(401, 'RFQ_TOKEN_INVALID', 'Token RFQ inválido o malformado.');
    }

    const [, payloadB64, candidateSig] = parts;
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${EXPRESS_RFQ_TOKEN_PREFIX}.${payloadB64}`, 'utf8')
        .digest('base64url');

    if (!constantTimeEqualStrings(candidateSig, expectedSig)) {
        throw new ExpressRfqError(
            401,
            'RFQ_TOKEN_INVALID',
            'Firma criptográfica HMAC-SHA256 del enlace RFQ inválida.'
        );
    }

    let parsed: any;
    try {
        parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        throw new ExpressRfqError(401, 'RFQ_TOKEN_INVALID', 'Carga útil de token RFQ corrupta.');
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.v !== 1 ||
        typeof parsed.inviteId !== 'string' ||
        !parsed.inviteId.trim() ||
        typeof parsed.tenantId !== 'string' ||
        !parsed.tenantId.trim() ||
        typeof parsed.exp !== 'number' ||
        !Number.isFinite(parsed.exp)
    ) {
        throw new ExpressRfqError(401, 'RFQ_TOKEN_INVALID', 'Claims obligatorios inválidos en token RFQ.');
    }

    if (nowMs > parsed.exp) {
        throw new ExpressRfqError(
            410,
            'RFQ_TOKEN_EXPIRED',
            'El enlace de cotización RFQ ha expirado.'
        );
    }

    return {
        v: 1,
        inviteId: parsed.inviteId.trim(),
        tenantId: parsed.tenantId.trim(),
        exp: parsed.exp,
        nonce: typeof parsed.nonce === 'string' ? parsed.nonce : '',
    };
}

function toAdminInviteView(doc: StoredExpressRfqInvite): AdminExpressRfqInviteView {
    return {
        inviteId: doc.inviteId,
        tenantId: doc.tenantId,
        siteId: doc.siteId,
        ...(doc.requisitionId ? { requisitionId: doc.requisitionId } : {}),
        districtCode: doc.districtCode,
        supplierName: doc.supplierName,
        ...(doc.supplierTaxId ? { supplierTaxId: doc.supplierTaxId } : {}),
        ...(doc.supplierPhoneMasked ? { supplierPhoneMasked: doc.supplierPhoneMasked } : {}),
        currencyCode: doc.currencyCode,
        itemCount: doc.items.length,
        items: doc.items,
        status: doc.status,
        expiresAtIso: doc.expiresAtIso,
        usedAtIso: doc.usedAtIso ?? null,
        submittedQuoteId: doc.submittedQuoteId ?? null,
        createdByUid: doc.createdByUid,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

function toPublicInviteView(doc: StoredExpressRfqInvite): PublicExpressRfqInviteView {
    return {
        inviteId: doc.inviteId,
        districtCode: doc.districtCode,
        currencyCode: doc.currencyCode,
        supplierName: doc.supplierName,
        items: doc.items.map((it) => ({
            canonicalSkuId: it.canonicalSkuId,
            itemName: it.itemName,
            qtyRequested: it.qtyRequested,
            unitSi: it.unitSi,
            unCefactCode: it.unCefactCode,
            specification: it.specification || null,
        })),
        expiresAtIso: doc.expiresAtIso,
        status: 'OPEN',
    };
}

export class SupplierZeroFrictionRfqService {
    public static async createExpressRfqInvite(
        params: {
            tenantId: string;
            input: CreateExpressRfqInviteInput;
            nowMs?: number;
        },
        actor: AuditActorContext
    ): Promise<{
        invite: AdminExpressRfqInviteView;
        expressPath: string;
        signedToken: string;
        dispatchedChannels: Array<'WHATSAPP' | 'EMAIL'>;
    }> {
        const parsed = CreateExpressRfqInviteSchema.safeParse(params.input);
        if (!parsed.success) {
            throw new ExpressRfqError(
                400,
                'RFQ_VALIDATION_ERROR',
                `Invitación RFQ inválida: ${parsed.error.issues[0]?.message || 'revise los campos'}`
            );
        }

        const secret = await resolveRfqSigningSecret();
        const nowMs =
            typeof params.nowMs === 'number' && Number.isFinite(params.nowMs)
                ? params.nowMs
                : Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const d = parsed.data;
        const expiresAtMs = nowMs + d.expiresInHours * 60 * 60 * 1000;
        const expiresAtIso = new Date(expiresAtMs).toISOString();
        const ttlExpiresAt = computeShortTtlTimestamp(FOURTEEN_DAYS_MS, nowMs);

        const inviteId = `rfqi_${nowMs.toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const signedToken = signExpressRfqToken(
            {
                v: 1,
                inviteId,
                tenantId: params.tenantId,
                exp: expiresAtMs,
                nonce: crypto.randomBytes(8).toString('hex'),
            },
            secret
        );
        const tokenHash = sha256Hex(signedToken);

        const normalizedItems: StoredExpressRfqInviteItem[] = d.items.map((it) => ({
            canonicalSkuId: it.canonicalSkuId,
            itemName: it.itemName,
            qtyRequested: it.qtyRequested,
            unitSi: it.unitSi,
            unCefactCode: it.unCefactCode || UNIT_SI_TO_UNCEFACT_REC20[it.unitSi],
            ...(it.categoryCode ? { categoryCode: it.categoryCode } : {}),
            ...(it.specification ? { specification: it.specification } : {}),
        }));

        const storedDoc: StoredExpressRfqInvite = {
            inviteId,
            tenantId: params.tenantId,
            siteId: d.siteId,
            ...(d.requisitionId ? { requisitionId: d.requisitionId } : {}),
            districtCode: d.districtCode.toUpperCase(),
            supplierName: d.supplierName,
            ...(d.supplierTaxId ? { supplierTaxId: d.supplierTaxId } : {}),
            ...(d.supplierPhoneE164
                ? { supplierPhoneMasked: maskPhoneE164(normalizeE164Phone(d.supplierPhoneE164)) }
                : {}),
            currencyCode: d.currencyCode.toUpperCase(),
            items: normalizedItems,
            tokenHash,
            status: 'OPEN',
            expiresAtMs,
            expiresAtIso,
            ttlExpiresAt,
            usedAtIso: null,
            submittedQuoteId: null,
            createdByUid: actor.actorUid,
            createdAt: nowIso,
            updatedAt: nowIso,
        };

        await db
            .collection(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION)
            .doc(inviteId)
            .set(storedDoc);

        await AuditLedger.record({
            tenantId: params.tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_EXPRESS_RFQ_INVITE_CREATED',
            module: SUPPLY_AUDIT_MODULE,
            targetEntity: inviteId,
            details: {
                siteId: storedDoc.siteId,
                districtCode: storedDoc.districtCode,
                itemCount: storedDoc.items.length,
                currencyCode: storedDoc.currencyCode,
                expiresAtIso,
                dispatchChannel: d.dispatchChannel,
            },
            ipAddress: actor.ipAddress,
        });

        const expressPath = `/supply/rfq-express/${signedToken}`;
        const dispatchedChannels: Array<'WHATSAPP' | 'EMAIL'> = [];

        // Despacho opcional resumido sin GPS ni datos sensibles de faena
        const itemsBrief = normalizedItems
            .slice(0, 6)
            .map((it) => `- ${it.itemName}: ${it.qtyRequested} ${it.unitSi} (${it.unCefactCode})`)
            .join('\n');

        if ((d.dispatchChannel === 'WHATSAPP' || d.dispatchChannel === 'BOTH') && d.supplierPhoneE164) {
            const waBody = [
                `MINREPORT · Solicitud de Cotización Exprés (${storedDoc.districtCode})`,
                `Moneda: ${storedDoc.currencyCode} · Vigente hasta: ${expiresAtIso.slice(0, 16)}Z`,
                itemsBrief,
                `Cotizar (1 solo uso): https://minreport-access.web.app${expressPath}`,
            ].join('\n');
            const waRes = await MetaWhatsAppCloudAdapter.sendTextMessage(
                d.supplierPhoneE164,
                waBody
            ).catch(() => ({ ok: false }));
            if (waRes.ok) dispatchedChannels.push('WHATSAPP');
        }

        if ((d.dispatchChannel === 'EMAIL' || d.dispatchChannel === 'BOTH') && d.supplierEmail) {
            await EmailService.sendEmail({
                from: 'MINREPORT <no-reply@minreport.com>',
                to: d.supplierEmail,
                subject: `[RFQ] MINREPORT · Solicitud de Cotización (${storedDoc.districtCode})`,
                html: `<p>MINREPORT · Cotización Exprés (${storedDoc.districtCode} · ${storedDoc.currencyCode})</p><pre>${itemsBrief}</pre><p>Enlace único: https://minreport-access.web.app${expressPath}</p>`,
                redactSensitiveOtp: true,
            })
                .then(() => {
                    dispatchedChannels.push('EMAIL');
                })
                .catch(() => {});
        }

        return {
            invite: toAdminInviteView(storedDoc),
            expressPath,
            signedToken,
            dispatchedChannels,
        };
    }

    public static async listExpressRfqInvites(
        tenantId: string,
        filters?: { siteId?: string; status?: ExpressRfqInviteStatus; limit?: number }
    ): Promise<AdminExpressRfqInviteView[]> {
        const snap = await db
            .collection(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION)
            .where('tenantId', '==', tenantId)
            .limit(resolveListLimit(filters?.limit, 100))
            .get();

        let list = snap.docs.map((d) => d.data() as StoredExpressRfqInvite);
        if (filters?.siteId) {
            list = list.filter((inv) => inv.siteId === filters.siteId);
        }
        if (filters?.status) {
            list = list.filter((inv) => inv.status === filters.status);
        }

        return list
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(toAdminInviteView);
    }

    public static async inspectExpressRfqInvite(
        signedToken: string,
        nowMs: number = Date.now()
    ): Promise<PublicExpressRfqInviteView> {
        const secret = await resolveRfqSigningSecret();
        const tokenPayload = verifyExpressRfqTokenSignature(signedToken, secret, nowMs);
        const candidateHash = sha256Hex(signedToken.trim());

        const snap = await db
            .collection(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION)
            .doc(tokenPayload.inviteId)
            .get();

        if (!snap?.exists) {
            throw new ExpressRfqError(404, 'RFQ_INVITE_NOT_FOUND', 'Invitación RFQ no encontrada.');
        }

        const invite = snap.data() as StoredExpressRfqInvite;
        if (
            invite.tenantId !== tokenPayload.tenantId ||
            !constantTimeEqualStrings(candidateHash, invite.tokenHash)
        ) {
            throw new ExpressRfqError(401, 'RFQ_TOKEN_INVALID', 'Token RFQ no corresponde a esta invitación.');
        }

        if (invite.status === 'SUBMITTED') {
            throw new ExpressRfqError(
                409,
                'RFQ_TOKEN_ALREADY_USED',
                'Este enlace de cotización de un solo uso ya fue utilizado.'
            );
        }
        if (invite.status === 'REVOKED') {
            throw new ExpressRfqError(410, 'RFQ_INVITE_REVOKED', 'La invitación RFQ fue revocada.');
        }
        if (invite.status === 'EXPIRED' || nowMs > invite.expiresAtMs) {
            throw new ExpressRfqError(410, 'RFQ_TOKEN_EXPIRED', 'La invitación RFQ ha expirado.');
        }

        return toPublicInviteView(invite);
    }

    public static async submitExpressRfqQuote(
        signedToken: string,
        rawQuotePayload: unknown,
        options?: { nowMs?: number; ipAddress?: string }
    ): Promise<{
        quote: StoredExpressRfqQuote;
    }> {
        const nowMs =
            typeof options?.nowMs === 'number' && Number.isFinite(options.nowMs)
                ? options.nowMs
                : Date.now();
        const nowIso = new Date(nowMs).toISOString();

        const secret = await resolveRfqSigningSecret();
        const tokenPayload = verifyExpressRfqTokenSignature(signedToken, secret, nowMs);
        const candidateHash = sha256Hex(signedToken.trim());

        const parsed = SubmitExpressRfqQuoteSchema.safeParse(rawQuotePayload || {});
        if (!parsed.success) {
            throw new ExpressRfqError(
                400,
                'RFQ_VALIDATION_ERROR',
                `Cotización RFQ inválida: ${parsed.error.issues[0]?.message || 'revise los campos'}`
            );
        }

        const d = parsed.data;
        const validUntilMs = Date.parse(d.validUntilIso);
        if (!Number.isFinite(validUntilMs) || validUntilMs <= nowMs) {
            throw new ExpressRfqError(
                400,
                'RFQ_VALIDATION_ERROR',
                'validUntilIso debe ser una fecha ISO 8601 estrictamente futura.'
            );
        }

        const inviteRef = db
            .collection(SUPPLY_EXPRESS_RFQ_INVITES_COLLECTION)
            .doc(tokenPayload.inviteId);
        const quoteId = `rfqeq_${nowMs.toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const quoteRef = db.collection(SUPPLY_EXPRESS_RFQ_QUOTES_COLLECTION).doc(quoteId);

        let persistedQuote!: StoredExpressRfqQuote;
        let inviteTenantId = tokenPayload.tenantId;

        await db.runTransaction(async (tx) => {
            const inviteSnap = await tx.get(inviteRef);
            if (!inviteSnap?.exists) {
                throw new ExpressRfqError(404, 'RFQ_INVITE_NOT_FOUND', 'Invitación RFQ no encontrada.');
            }

            const invite = inviteSnap.data() as StoredExpressRfqInvite;
            if (
                invite.tenantId !== tokenPayload.tenantId ||
                !constantTimeEqualStrings(candidateHash, invite.tokenHash)
            ) {
                throw new ExpressRfqError(
                    401,
                    'RFQ_TOKEN_INVALID',
                    'Token RFQ inválido para la invitación solicitada.'
                );
            }

            if (invite.status === 'SUBMITTED') {
                throw new ExpressRfqError(
                    409,
                    'RFQ_TOKEN_ALREADY_USED',
                    'Este enlace de cotización de un solo uso ya fue utilizado.'
                );
            }
            if (invite.status === 'REVOKED') {
                throw new ExpressRfqError(410, 'RFQ_INVITE_REVOKED', 'La invitación RFQ fue revocada.');
            }
            if (invite.status === 'EXPIRED' || nowMs > invite.expiresAtMs) {
                throw new ExpressRfqError(410, 'RFQ_TOKEN_EXPIRED', 'La invitación RFQ ha expirado.');
            }

            const inviteItemMap = new Map(invite.items.map((it) => [it.canonicalSkuId, it]));
            const resolvedItemQuotes = d.itemQuotes.map((iq) => {
                const matched = inviteItemMap.get(iq.canonicalSkuId);
                if (!matched) {
                    throw new ExpressRfqError(
                        400,
                        'RFQ_VALIDATION_ERROR',
                        `El SKU ${iq.canonicalSkuId} no forma parte de esta invitación RFQ.`
                    );
                }
                const availableQty = iq.availableQty ?? matched.qtyRequested;
                const lineTotalNet = Math.round(iq.unitPriceNet * matched.qtyRequested);
                return {
                    canonicalSkuId: matched.canonicalSkuId,
                    itemName: matched.itemName,
                    qtyRequested: matched.qtyRequested,
                    unitSi: matched.unitSi,
                    unCefactCode: matched.unCefactCode,
                    unitPriceNet: Math.round(iq.unitPriceNet),
                    availableQty,
                    lineTotalNet,
                    ...(iq.notes ? { notes: iq.notes } : {}),
                };
            });

            const totalEstimatedNet = resolvedItemQuotes.reduce((acc, q) => acc + q.lineTotalNet, 0);
            inviteTenantId = invite.tenantId;

            persistedQuote = {
                quoteId,
                inviteId: invite.inviteId,
                tenantId: invite.tenantId,
                siteId: invite.siteId,
                ...(invite.requisitionId ? { requisitionId: invite.requisitionId } : {}),
                districtCode: invite.districtCode,
                deliveryDistrictCode: (d.deliveryDistrictCode || invite.districtCode).toUpperCase(),
                supplierTaxId: d.supplierTaxId,
                supplierName: d.supplierName,
                currencyCode: (d.currencyCode || invite.currencyCode).toUpperCase(),
                leadTimeDays: d.leadTimeDays,
                validUntilIso: d.validUntilIso,
                itemQuotes: resolvedItemQuotes,
                totalEstimatedNet,
                ...(d.notes ? { notes: d.notes } : {}),
                status: 'SUBMITTED',
                submittedAtIso: nowIso,
                createdAt: nowIso,
            };

            tx.set(quoteRef, persistedQuote);
            tx.set(
                inviteRef,
                {
                    status: 'SUBMITTED',
                    usedAtIso: nowIso,
                    submittedQuoteId: quoteId,
                    updatedAt: nowIso,
                },
                { merge: true }
            );
        });

        // Trazabilidad criptográfica AuditLedger fail-closed (si falla, revierte quote e invite)
        try {
            await AuditLedger.record({
                tenantId: inviteTenantId,
                actorUid: `rfq-supplier:${d.supplierTaxId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32)}`,
                actorEmail: 'supplier-express@rfq.minreport.local',
                action: 'SUPPLY_EXPRESS_RFQ_QUOTE_SUBMITTED',
                module: SUPPLY_AUDIT_MODULE,
                targetEntity: quoteId,
                details: {
                    inviteId: persistedQuote.inviteId,
                    districtCode: persistedQuote.districtCode,
                    currencyCode: persistedQuote.currencyCode,
                    itemCount: persistedQuote.itemQuotes.length,
                    totalEstimatedNet: persistedQuote.totalEstimatedNet,
                    leadTimeDays: persistedQuote.leadTimeDays,
                },
                ipAddress: options?.ipAddress,
            });
        } catch (auditErr) {
            await quoteRef.delete().catch(() => {});
            await inviteRef
                .set(
                    {
                        status: 'OPEN',
                        usedAtIso: null,
                        submittedQuoteId: null,
                        updatedAt: new Date().toISOString(),
                    },
                    { merge: true }
                )
                .catch(() => {});
            console.error(
                '[SUPPLY-RFQ-EXPRESS] AuditLedger fail-closed; cotización revertida:',
                auditErr instanceof Error ? auditErr.name : 'UnknownError'
            );
            throw new ExpressRfqError(
                500,
                'AUDIT_LEDGER_UNAVAILABLE',
                'No se pudo sellar trazabilidad en AuditLedger; cotización revertida.'
            );
        }

        return { quote: persistedQuote };
    }
}
