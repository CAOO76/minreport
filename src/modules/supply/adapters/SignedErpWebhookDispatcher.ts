import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { computeThirtyDayTtlTimestamp } from '../../../core/retention-policy';
import { constantTimeEqualStrings } from '../../../utils/security';
import {
    assertSafeExternalUrl,
    safeFetchExternal,
    SSRFBlockedError,
} from '../../../utils/ssrfGuard';
import {
    type AuditActorContext,
    SupplyNotFoundError,
} from '../application/SupplyRepository';
import { SUPPLY_AUDIT_MODULE } from '../application/supply.types';

/**
 * SIGNED ERP WEBHOOK DISPATCHER (MINREPORT · ABASTECIMIENTO — Capa 3 ISO 27001)
 *
 * Emite notificaciones push firmadas HMAC-SHA256 hacia ERPs externos configurados por tenant:
 * - Almacenamiento multi-tenant en `supply_erp_webhooks` con secreto cifrado en reposo (AES-256-GCM)
 *   y `secretHash` SHA-256; jamás expone el secreto en texto plano en `GET /erp-webhooks`.
 * - Validación anti-SSRF obligatoria en alta y despacho (`assertSafeExternalUrl` + `safeFetchExternal`).
 * - Firma HMAC-SHA256 sobre `${timestamp}.${rawJsonBody}` en cabecera `X-Minreport-Signature: sha256=<hex>`,
 *   acompañada de `X-Minreport-Timestamp`, `X-Minreport-Event` y `X-Minreport-Delivery-Id`.
 * - Verificador `verifyErpWebhookSignature(...)` en tiempo constante con ventana anti-replay <= 300s.
 * - Reintentos acotados (máx 3 intentos con backoff exponencial + jitter) y bitácora sin PII ni secretos
 *   en `supply_erp_webhook_deliveries` con `ttlExpiresAt` a 30 días (Ley N° 21.719).
 */

export const SUPPLY_ERP_WEBHOOKS_COLLECTION = 'supply_erp_webhooks';
export const SUPPLY_ERP_WEBHOOK_DELIVERIES_COLLECTION = 'supply_erp_webhook_deliveries';

export const ERP_WEBHOOK_EVENTS = [
    'SUPPLY_PURCHASE_COMMITTED',
    'SUPPLY_RECEPTION_CONFIRMED',
    'SUPPLY_EXPENSE_REPORT_APPROVED',
    'SUPPLY_ACCOUNTING_EXPORT_READY',
    'SUPPLY_WEBHOOK_TEST',
] as const;

export const ErpWebhookEventSchema = z.enum(ERP_WEBHOOK_EVENTS);
export type ErpWebhookEventType = z.infer<typeof ErpWebhookEventSchema>;

export interface PublicErpWebhook {
    webhookId: string;
    tenantId: string;
    name: string;
    targetUrl: string;
    events: ErpWebhookEventType[];
    active: boolean;
    secretHash: string;
    secretFingerprint: string;
    createdByUid: string;
    createdAt: string;
    updatedAt: string;
}

interface StoredErpWebhookRecord extends PublicErpWebhook {
    secretEnvelope: string;
}

export interface ErpWebhookDeliveryLog {
    deliveryId: string;
    webhookId: string;
    tenantId: string;
    eventType: ErpWebhookEventType;
    targetHost: string;
    status: 'DELIVERED' | 'FAILED' | 'SSRF_BLOCKED';
    httpStatus: number;
    attempts: number;
    errorSummary?: string;
    createdAt: string;
    ttlExpiresAt: unknown;
}

export interface VerifyErpWebhookSignatureInput {
    rawBody: string | Buffer;
    signatureHeader?: string;
    timestampHeader?: string;
    secret: string;
    nowMs?: number;
    maxSkewSeconds?: number;
}

export interface VerifyErpWebhookSignatureResult {
    valid: boolean;
    reason?:
        | 'MISSING_HEADERS'
        | 'INVALID_SIGNATURE_FORMAT'
        | 'INVALID_TIMESTAMP'
        | 'TIMESTAMP_OUT_OF_WINDOW'
        | 'SIGNATURE_MISMATCH';
}

type CustomFetchFn = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_MAX_REPLAY_SKEW_SECONDS = 300;
const MAX_DELIVERY_ATTEMPTS = 3;

function deriveAtRestEncryptionKey(): Buffer {
    const seed =
        process.env.X402_HMAC_SECRET?.trim() ||
        process.env.WHATSAPP_APP_SECRET?.trim() ||
        process.env.GCP_PROJECT_ID?.trim() ||
        'minreport-erp-webhook-local-dev-key';
    return crypto.createHash('sha256').update(`minreport:erp-webhook-key:v1:${seed}`).digest();
}

function encryptSecretAtRest(plainSecret: string): string {
    const key = deriveAtRestEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

function decryptSecretAtRest(envelope: string): string {
    const parts = String(envelope || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Formato de secreto cifrado ERP inválido.');
    }
    const key = deriveAtRestEncryptionKey();
    const iv = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function toPublicErpWebhook(stored: StoredErpWebhookRecord): PublicErpWebhook {
    return {
        webhookId: stored.webhookId,
        tenantId: stored.tenantId,
        name: stored.name,
        targetUrl: stored.targetUrl,
        events: [...stored.events],
        active: Boolean(stored.active),
        secretHash: stored.secretHash,
        secretFingerprint: stored.secretFingerprint,
        createdByUid: stored.createdByUid,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
    };
}

/**
 * Calcula firma oficial HMAC-SHA256 de MINREPORT sobre `${timestamp}.${rawJsonBody}`.
 */
export function computeErpWebhookSignature(
    rawBody: string | Buffer,
    timestampSeconds: string | number,
    secret: string
): string {
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    const tsStr = String(timestampSeconds).trim();
    const hex = crypto
        .createHmac('sha256', secret)
        .update(`${tsStr}.${bodyStr}`, 'utf8')
        .digest('hex');
    return `sha256=${hex}`;
}

/**
 * Verifica firma HMAC-SHA256 `X-Minreport-Signature` en tiempo constante con ventana anti-replay (`<= 300s`).
 */
export function verifyErpWebhookSignature(
    input: VerifyErpWebhookSignatureInput
): VerifyErpWebhookSignatureResult {
    const secret = String(input.secret || '').trim();
    const sigHeader = String(input.signatureHeader || '').trim();
    const tsHeader = String(input.timestampHeader || '').trim();

    if (!secret || !sigHeader || !tsHeader) {
        return { valid: false, reason: 'MISSING_HEADERS' };
    }

    if (!/^sha256=[a-f0-9]{64}$/i.test(sigHeader)) {
        return { valid: false, reason: 'INVALID_SIGNATURE_FORMAT' };
    }

    if (!/^\d{9,13}$/.test(tsHeader)) {
        return { valid: false, reason: 'INVALID_TIMESTAMP' };
    }

    const tsNum = Number(tsHeader);
    const tsSec = tsNum > 1e11 ? Math.floor(tsNum / 1000) : tsNum;
    const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
    const maxSkew =
        typeof input.maxSkewSeconds === 'number' && input.maxSkewSeconds >= 0
            ? input.maxSkewSeconds
            : DEFAULT_MAX_REPLAY_SKEW_SECONDS;

    if (Math.abs(nowSec - tsSec) > maxSkew) {
        return { valid: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };
    }

    const expected = computeErpWebhookSignature(input.rawBody, tsHeader, secret).toLowerCase();
    if (!constantTimeEqualStrings(sigHeader.toLowerCase(), expected)) {
        return { valid: false, reason: 'SIGNATURE_MISMATCH' };
    }

    return { valid: true };
}

export class SignedErpWebhookDispatcher {
    private static customFetch: CustomFetchFn | null = null;
    private static customUrlValidator: ((rawUrl: string) => Promise<URL>) | null = null;

    public static setCustomFetchForTests(fn: CustomFetchFn | null): void {
        this.customFetch = fn;
    }

    public static setCustomUrlValidatorForTests(
        fn: ((rawUrl: string) => Promise<URL>) | null
    ): void {
        this.customUrlValidator = fn;
    }

    private static async validateDestinationUrl(targetUrl: string): Promise<URL> {
        if (this.customUrlValidator) {
            return this.customUrlValidator(targetUrl);
        }
        return assertSafeExternalUrl(targetUrl);
    }

    public static async listWebhooks(tenantId: string): Promise<PublicErpWebhook[]> {
        const snap = await db
            .collection(SUPPLY_ERP_WEBHOOKS_COLLECTION)
            .where('tenantId', '==', tenantId)
            .limit(100)
            .get();

        return snap.docs
            .map((d) => toPublicErpWebhook(d.data() as StoredErpWebhookRecord))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    public static async createWebhook(
        input: {
            tenantId: string;
            name: string;
            targetUrl: string;
            events: ErpWebhookEventType[];
            secret?: string;
            active?: boolean;
        },
        actor: AuditActorContext
    ): Promise<{ webhook: PublicErpWebhook; signingSecretOnce: string }> {
        // Validación anti-SSRF estricta antes de persistir
        const safeUrl = await this.validateDestinationUrl(input.targetUrl);
        const nowIso = new Date().toISOString();
        const webhookId = `whk_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

        const rawSecret =
            input.secret && input.secret.trim().length >= 16
                ? input.secret.trim()
                : `mr_whsec_${crypto.randomBytes(24).toString('hex')}`;
        const secretHash = crypto.createHash('sha256').update(rawSecret, 'utf8').digest('hex');
        const secretEnvelope = encryptSecretAtRest(rawSecret);

        const uniqueEvents = Array.from(new Set(input.events));
        const stored: StoredErpWebhookRecord = {
            webhookId,
            tenantId: input.tenantId,
            name: input.name.trim().slice(0, 120),
            targetUrl: safeUrl.toString(),
            events: uniqueEvents,
            active: input.active !== false,
            secretHash,
            secretFingerprint: secretHash.slice(0, 12),
            secretEnvelope,
            createdByUid: actor.actorUid,
            createdAt: nowIso,
            updatedAt: nowIso,
        };

        await db.collection(SUPPLY_ERP_WEBHOOKS_COLLECTION).doc(webhookId).set(stored);

        await AuditLedger.record({
            tenantId: input.tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_ERP_WEBHOOK_CREATED',
            module: SUPPLY_AUDIT_MODULE,
            targetEntity: webhookId,
            details: {
                hitlConfirmed: true,
                name: stored.name,
                targetHost: safeUrl.hostname,
                events: uniqueEvents,
                secretFingerprint: stored.secretFingerprint,
            },
            ipAddress: actor.ipAddress,
        });

        return {
            webhook: toPublicErpWebhook(stored),
            signingSecretOnce: rawSecret,
        };
    }

    public static async deleteWebhook(
        tenantId: string,
        webhookId: string,
        actor: AuditActorContext
    ): Promise<{ deleted: true; webhookId: string }> {
        const ref = db.collection(SUPPLY_ERP_WEBHOOKS_COLLECTION).doc(webhookId);
        const snap = await ref.get();
        if (!snap?.exists) {
            throw new SupplyNotFoundError('Webhook ERP no encontrado.');
        }
        const existing = snap.data() as StoredErpWebhookRecord;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError('Webhook ERP no pertenece a la cuenta activa.');
        }

        await ref.delete();

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_ERP_WEBHOOK_DELETED',
            module: SUPPLY_AUDIT_MODULE,
            targetEntity: webhookId,
            details: {
                hitlConfirmed: true,
                name: existing.name,
            },
            ipAddress: actor.ipAddress,
        });

        return { deleted: true, webhookId };
    }

    private static async recordDeliveryLog(entry: ErpWebhookDeliveryLog): Promise<void> {
        await db
            .collection(SUPPLY_ERP_WEBHOOK_DELIVERIES_COLLECTION)
            .doc(entry.deliveryId)
            .set(entry)
            .catch(() => {});
    }

    private static async deliverToSingleWebhook(
        stored: StoredErpWebhookRecord,
        eventType: ErpWebhookEventType,
        payload: Record<string, unknown>,
        options?: { baseRetryDelayMs?: number; nowMs?: number }
    ): Promise<ErpWebhookDeliveryLog> {
        const deliveryId = `dlv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const nowMs = options?.nowMs ?? Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const ttlExpiresAt = computeThirtyDayTtlTimestamp(nowMs);

        let safeUrl: URL;
        try {
            safeUrl = await this.validateDestinationUrl(stored.targetUrl);
        } catch (err: any) {
            const blockedLog: ErpWebhookDeliveryLog = {
                deliveryId,
                webhookId: stored.webhookId,
                tenantId: stored.tenantId,
                eventType,
                targetHost: 'blocked',
                status: 'SSRF_BLOCKED',
                httpStatus: 403,
                attempts: 0,
                errorSummary: err instanceof Error ? err.message.slice(0, 200) : 'SSRF_BLOCKED',
                createdAt: nowIso,
                ttlExpiresAt,
            };
            await this.recordDeliveryLog(blockedLog);
            throw err instanceof SSRFBlockedError
                ? err
                : new SSRFBlockedError(blockedLog.errorSummary || 'Destino ERP bloqueado por SSRF.');
        }

        const signingSecret = decryptSecretAtRest(stored.secretEnvelope);
        const envelopeBody = {
            brand: 'MINREPORT',
            module: 'supply',
            deliveryId,
            event: eventType,
            tenantId: stored.tenantId,
            emittedAt: nowIso,
            data: payload,
        };
        const rawJsonBody = JSON.stringify(envelopeBody);
        const timestampSec = String(Math.floor(nowMs / 1000));
        const signature = computeErpWebhookSignature(rawJsonBody, timestampSec, signingSecret);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Minreport-Signature': signature,
            'X-Minreport-Timestamp': timestampSec,
            'X-Minreport-Event': eventType,
            'X-Minreport-Delivery-Id': deliveryId,
            'User-Agent': 'MINREPORT-Supply-ERP-Webhook/2.0',
        };

        const baseDelay =
            typeof options?.baseRetryDelayMs === 'number' && options.baseRetryDelayMs >= 0
                ? options.baseRetryDelayMs
                : 250;

        let lastStatus = 0;
        let lastErrorSummary = '';
        let attempts = 0;

        for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
            attempts = attempt + 1;
            try {
                const resp = this.customFetch
                    ? await this.customFetch(safeUrl.toString(), {
                          method: 'POST',
                          headers,
                          body: rawJsonBody,
                      })
                    : await safeFetchExternal(safeUrl.toString(), {
                          method: 'POST',
                          headers,
                          body: rawJsonBody,
                          maxRedirects: 0,
                          timeoutMs: 8_000,
                          maxBytes: 256 * 1024,
                      });

                lastStatus = resp.status;
                if (resp.ok) {
                    const deliveredLog: ErpWebhookDeliveryLog = {
                        deliveryId,
                        webhookId: stored.webhookId,
                        tenantId: stored.tenantId,
                        eventType,
                        targetHost: safeUrl.hostname,
                        status: 'DELIVERED',
                        httpStatus: resp.status,
                        attempts,
                        createdAt: nowIso,
                        ttlExpiresAt,
                    };
                    await this.recordDeliveryLog(deliveredLog);
                    return deliveredLog;
                }

                lastErrorSummary = `HTTP ${resp.status}`;
                const retryable = resp.status === 429 || resp.status >= 500;
                if (!retryable) {
                    break;
                }
            } catch (err: any) {
                if (err instanceof SSRFBlockedError) {
                    const ssrfLog: ErpWebhookDeliveryLog = {
                        deliveryId,
                        webhookId: stored.webhookId,
                        tenantId: stored.tenantId,
                        eventType,
                        targetHost: safeUrl.hostname,
                        status: 'SSRF_BLOCKED',
                        httpStatus: 403,
                        attempts,
                        errorSummary: err.message.slice(0, 200),
                        createdAt: nowIso,
                        ttlExpiresAt,
                    };
                    await this.recordDeliveryLog(ssrfLog);
                    throw err;
                }
                lastStatus = 503;
                lastErrorSummary =
                    err instanceof Error ? err.message.slice(0, 200) : 'NetworkError';
            }

            if (attempt < MAX_DELIVERY_ATTEMPTS - 1 && baseDelay > 0) {
                const jitter = Math.floor(Math.random() * Math.max(10, Math.round(baseDelay / 2)));
                const waitMs = Math.min(4000, baseDelay * Math.pow(2, attempt) + jitter);
                await new Promise((r) => setTimeout(r, waitMs));
            }
        }

        const failedLog: ErpWebhookDeliveryLog = {
            deliveryId,
            webhookId: stored.webhookId,
            tenantId: stored.tenantId,
            eventType,
            targetHost: safeUrl.hostname,
            status: 'FAILED',
            httpStatus: lastStatus || 503,
            attempts,
            errorSummary: lastErrorSummary || 'Delivery failed',
            createdAt: nowIso,
            ttlExpiresAt,
        };
        await this.recordDeliveryLog(failedLog);
        return failedLog;
    }

    public static async dispatchEvent(
        tenantId: string,
        eventType: ErpWebhookEventType,
        payload: Record<string, unknown>,
        options?: { baseRetryDelayMs?: number; nowMs?: number }
    ): Promise<ErpWebhookDeliveryLog[]> {
        const snap = await db
            .collection(SUPPLY_ERP_WEBHOOKS_COLLECTION)
            .where('tenantId', '==', tenantId)
            .limit(100)
            .get();

        const subscribed = snap.docs
            .map((d) => d.data() as StoredErpWebhookRecord)
            .filter(
                (w) =>
                    w.active !== false &&
                    Array.isArray(w.events) &&
                    w.events.includes(eventType)
            );

        const logs: ErpWebhookDeliveryLog[] = [];
        for (const wh of subscribed) {
            try {
                const log = await this.deliverToSingleWebhook(wh, eventType, payload, options);
                logs.push(log);
            } catch (err: any) {
                if (err instanceof SSRFBlockedError) {
                    logs.push({
                        deliveryId: `dlv_blocked_${Date.now().toString(36)}`,
                        webhookId: wh.webhookId,
                        tenantId,
                        eventType,
                        targetHost: 'blocked',
                        status: 'SSRF_BLOCKED',
                        httpStatus: 403,
                        attempts: 0,
                        errorSummary: err.message.slice(0, 200),
                        createdAt: new Date(options?.nowMs ?? Date.now()).toISOString(),
                        ttlExpiresAt: computeThirtyDayTtlTimestamp(options?.nowMs),
                    });
                }
            }
        }
        return logs;
    }

    public static async sendTestWebhook(
        tenantId: string,
        webhookId: string,
        actor: AuditActorContext,
        options?: { baseRetryDelayMs?: number; nowMs?: number }
    ): Promise<ErpWebhookDeliveryLog> {
        const snap = await db.collection(SUPPLY_ERP_WEBHOOKS_COLLECTION).doc(webhookId).get();
        if (!snap?.exists) {
            throw new SupplyNotFoundError('Webhook ERP no encontrado.');
        }
        const stored = snap.data() as StoredErpWebhookRecord;
        if (stored.tenantId !== tenantId) {
            throw new SupplyNotFoundError('Webhook ERP no pertenece a la cuenta activa.');
        }

        const result = await this.deliverToSingleWebhook(
            stored,
            'SUPPLY_WEBHOOK_TEST',
            {
                testPing: true,
                triggeredByUid: actor.actorUid,
            },
            options
        );

        return result;
    }
}
