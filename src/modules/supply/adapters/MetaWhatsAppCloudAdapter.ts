import crypto from 'crypto';
import { db } from '../../../config/firebase';
import { getSecret } from '../../../config/secrets';
import { constantTimeEqualStrings } from '../../../utils/security';
import { safeFetchExternal } from '../../../utils/ssrfGuard';
import { normalizeE164Phone } from '../../../utils/taxIdValidator';
import { maskPiiForLog } from '../application/supply.types';
import type {
    DownloadedGatewayMedia,
    IMessagingGateway,
    InboundMessagingEvent,
    MessagingDeliveryReceipt,
    OutboundMessagePayload,
    OutboundTemplatePayload,
} from '../ports/IMessagingGateway';

/**
 * META WHATSAPP CLOUD API v24.0 ADAPTER (MINREPORT · ABASTECIMIENTO)
 *
 * Cliente HTTPS directo API-Only (80+ MPS compliant) que implementa el puerto `IMessagingGateway`:
 * - Graph API `v24.0` (`https://graph.facebook.com/v24.0`).
 * - Verificación criptográfica HMAC-SHA256 `X-Hub-Signature-256` estrictamente Fail-Closed
 *   exigiendo `Buffer` real `rawBody` no vacío (nunca reconstruye con `JSON.stringify`).
 * - Handshake `GET /whatsapp/webhook` con comparación en tiempo constante.
 * - Routing multi-número mediante `whatsapp_channels/{phoneNumberId}` con fallback seguro.
 * - Bloqueo total de `MOCK_WHATSAPP=true` cuando `NODE_ENV === 'production'`.
 * - Descarga segura anti-SSRF (límite `14 MB`, allowlist estricta de MIME y hosts Meta CDN,
 *   strip automático de `Authorization` en redirects cross-origin vía `safeFetchExternal`).
 * - Parseo de `value.statuses[]`, clasificación explícita de errores Meta (`131047`, `190`,
 *   `429`/`130429`/`131056`, `132018`/`132000`) y sanitizador obligatorio de parámetros HSM.
 * - Cero logging de números telefónicos o tokens en texto plano (Ley N° 21.719).
 */

export const WHATSAPP_GRAPH_API_VERSION = 'v24.0';
const GRAPH_API_VERSION = WHATSAPP_GRAPH_API_VERSION;
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const MAX_WHATSAPP_MEDIA_BYTES = 14 * 1024 * 1024; // 14 MB (P1-08)
const MAX_MEDIA_BYTES = MAX_WHATSAPP_MEDIA_BYTES;

export const ALLOWED_WHATSAPP_MEDIA_MIMES: ReadonlySet<string> = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/xml',
    'text/xml',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/amr',
    'audio/opus',
]);

const ALLOWED_META_MEDIA_HOST_SUFFIXES = [
    'lookaside.fbsbx.com',
    '.fbsbx.com',
    '.fbcdn.net',
    'graph.facebook.com',
];

export interface WhatsAppReplyButton {
    id: string;
    title: string;
}

export interface WhatsAppSendResult {
    ok: boolean;
    messageId?: string;
    mocked: boolean;
    statusCode: number;
    error?: string;
    metaErrorCode?: number;
    cswExpired?: boolean;
    tokenExpired?: boolean;
    retryable?: boolean;
    templateError?: boolean;
    skippedReason?: string;
}

export interface MetaErrorClassification {
    metaErrorCode?: number;
    cswExpired: boolean;
    tokenExpired: boolean;
    retryable: boolean;
    templateError: boolean;
    summary: string;
}

export interface WhatsAppChannelConfig {
    phoneNumberId: string;
    tenantId?: string;
    accessToken: string | null;
    appSecret: string | null;
    verifyToken: string | null;
    wabaId?: string | null;
    active: boolean;
    source: 'FIRESTORE_CHANNEL' | 'DEFAULT_ENV_CONFIG';
}

export interface DownloadedWhatsAppMedia {
    mediaId: string;
    buffer: Buffer;
    mimeType: string;
    sha256: string;
    sizeBytes: number;
}

export interface InboundWhatsAppMessage {
    wamid: string;
    fromE164: string;
    timestampMs: number;
    type: 'text' | 'audio' | 'image' | 'document' | 'interactive' | 'unknown';
    textBody?: string;
    interactiveReplyId?: string;
    interactiveReplyTitle?: string;
    mediaId?: string;
    mimeType?: string;
    caption?: string;
    filename?: string;
    phoneNumberId?: string;
}

export interface InboundWhatsAppStatusError {
    code: number;
    title?: string;
    message?: string;
    errorDataDetails?: string;
}

export interface InboundWhatsAppStatusEvent {
    wamid: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestampMs: number;
    recipientId?: string;
    phoneNumberId?: string;
    errors: InboundWhatsAppStatusError[];
}

export interface MockOutboundWhatsAppRecord {
    id: string;
    toMasked: string;
    toE164Hash: string;
    kind: 'text' | 'interactive_buttons' | 'template';
    bodyText?: string;
    buttons?: WhatsAppReplyButton[];
    templateName?: string;
    languageCode?: string;
    templateParams?: string[];
    sentAt: string;
}

type FetchLike = typeof fetch;

function isAllowedMetaMediaHost(rawUrl: string): boolean {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        return ALLOWED_META_MEDIA_HOST_SUFFIXES.some((suffix) =>
            suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
        );
    } catch {
        return false;
    }
}

function normalizeMimeType(rawMime: string | null | undefined): string {
    return String(rawMime || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
}

/**
 * Sanitiza obligatoriamente los parámetros de plantillas HSM Meta Cloud API:
 * elimina `\r`, `\n`, `\t`, colapsa espacios múltiples consecutivos (evita error Meta `132018`)
 * y recorta a un máximo de 1024 caracteres.
 */
export function sanitizeTemplateParameter(raw: unknown): string {
    const cleaned = String(raw ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 1024);
    return cleaned || '-';
}

/**
 * Clasifica respuestas de error HTTP/JSON de Meta Graph API v24.0 para enrutamiento
 * de fallback HSM (`131047`), alertas de token (`190`), reintentos (`429`/`130429`/`131056`)
 * y errores de plantilla (`132018`/`132000`).
 */
export function classifyMetaGraphError(
    statusCode: number,
    rawBodyText: string
): MetaErrorClassification {
    let metaErrorCode: number | undefined;
    let parsedMessage = '';

    try {
        const parsed = JSON.parse(rawBodyText || '{}') as {
            error?: {
                code?: unknown;
                message?: unknown;
                error_subcode?: unknown;
            };
        };
        const rawCode = Number(parsed?.error?.code);
        if (Number.isFinite(rawCode) && rawCode > 0) {
            metaErrorCode = rawCode;
        }
        if (typeof parsed?.error?.message === 'string') {
            parsedMessage = parsed.error.message.trim();
        }
    } catch {
        // Respuesta no JSON
    }

    const cswExpired = metaErrorCode === 131047;
    const tokenExpired = metaErrorCode === 190;
    const retryable =
        statusCode === 429 ||
        statusCode >= 500 ||
        metaErrorCode === 130429 ||
        metaErrorCode === 131056 ||
        metaErrorCode === 4 ||
        metaErrorCode === 80007;
    const templateError =
        metaErrorCode === 132018 ||
        metaErrorCode === 132000 ||
        metaErrorCode === 132001 ||
        metaErrorCode === 132005 ||
        metaErrorCode === 132012;

    const detail = parsedMessage || String(rawBodyText || '').slice(0, 200);
    const summary = `Meta HTTP ${statusCode}${metaErrorCode ? ` (code=${metaErrorCode})` : ''}: ${detail}`;

    return {
        metaErrorCode,
        cswExpired,
        tokenExpired,
        retryable,
        templateError,
        summary,
    };
}

export class MetaWhatsAppCloudAdapter {
    private static readonly mockOutbox: MockOutboundWhatsAppRecord[] = [];
    private static customFetch: FetchLike | null = null;

    public static readonly GRAPH_API_VERSION = WHATSAPP_GRAPH_API_VERSION;
    public static readonly GRAPH_API_BASE = GRAPH_API_BASE;

    public static setCustomFetchForTests(fetchFn: FetchLike | null): void {
        this.customFetch = fetchFn;
    }

    public static getMockOutbox(): MockOutboundWhatsAppRecord[] {
        return [...this.mockOutbox];
    }

    public static clearMockOutbox(): void {
        this.mockOutbox.length = 0;
    }

    public static sanitizeTemplateParameter(raw: unknown): string {
        return sanitizeTemplateParameter(raw);
    }

    public static classifyMetaError(statusCode: number, rawBodyText: string): MetaErrorClassification {
        return classifyMetaGraphError(statusCode, rawBodyText);
    }

    /**
     * Modo mock estrictamente deshabilitado en `NODE_ENV === 'production'` (jamás acepta `MOCK_WHATSAPP=true` en prod).
     */
    public static isMockMode(): boolean {
        if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
            return false;
        }
        return process.env.NODE_ENV === 'test' || process.env.MOCK_WHATSAPP === 'true';
    }

    public static async resolveConfig(): Promise<{
        accessToken: string | null;
        appSecret: string | null;
        verifyToken: string | null;
        phoneNumberId: string | null;
    }> {
        const [accessToken, appSecret, verifyToken, phoneNumberId] = await Promise.all([
            getSecret('WHATSAPP_ACCESS_TOKEN').catch(() => process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null),
            getSecret('WHATSAPP_APP_SECRET').catch(() => process.env.WHATSAPP_APP_SECRET?.trim() || null),
            getSecret('WHATSAPP_VERIFY_TOKEN').catch(() => process.env.WHATSAPP_VERIFY_TOKEN?.trim() || null),
            getSecret('WHATSAPP_PHONE_NUMBER_ID').catch(
                () => process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null
            ),
        ]);

        return {
            accessToken: accessToken || process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null,
            appSecret: appSecret || process.env.WHATSAPP_APP_SECRET?.trim() || null,
            verifyToken: verifyToken || process.env.WHATSAPP_VERIFY_TOKEN?.trim() || null,
            phoneNumberId: phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null,
        };
    }

    /**
     * Resuelve configuración multi-número desde `whatsapp_channels/{phoneNumberId}` en Firestore
     * con fallback seguro al `WHATSAPP_PHONE_NUMBER_ID` configurado por defecto.
     * Retorna `null` si el `phoneNumberId` es desconocido o está desactivado/revocado.
     */
    public static async resolveChannelConfig(
        phoneNumberId?: string
    ): Promise<WhatsAppChannelConfig | null> {
        const cleanId = String(phoneNumberId || '').trim();
        const defaultCfg = await this.resolveConfig();

        if (cleanId) {
            try {
                const snap = await db.collection('whatsapp_channels').doc(cleanId).get();
                if (snap?.exists) {
                    const data = snap.data() || {};
                    const statusUpper = String(data.status || 'ACTIVE').trim().toUpperCase();
                    if (
                        data.active === false ||
                        statusUpper === 'INACTIVE' ||
                        statusUpper === 'DISABLED' ||
                        statusUpper === 'REVOKED' ||
                        statusUpper === 'SUSPENDED'
                    ) {
                        return null;
                    }

                    const resolveSecretOrFallback = async (
                        secretName: unknown,
                        fallback: string | null
                    ): Promise<string | null> => {
                        const cleanSecretName =
                            typeof secretName === 'string' ? secretName.trim() : '';
                        if (cleanSecretName) {
                            const val = await getSecret(cleanSecretName, {
                                suppressMissingWarn: true,
                            }).catch(() => null);
                            if (val) return val;
                        }
                        return fallback;
                    };

                    const [accessToken, appSecret, verifyToken] = await Promise.all([
                        resolveSecretOrFallback(data.accessTokenSecretName, defaultCfg.accessToken),
                        resolveSecretOrFallback(data.appSecretSecretName, defaultCfg.appSecret),
                        resolveSecretOrFallback(data.verifyTokenSecretName, defaultCfg.verifyToken),
                    ]);

                    return {
                        phoneNumberId: cleanId,
                        tenantId:
                            typeof data.tenantId === 'string' && data.tenantId.trim()
                                ? data.tenantId.trim()
                                : undefined,
                        accessToken,
                        appSecret,
                        verifyToken,
                        wabaId: typeof data.wabaId === 'string' ? data.wabaId.trim() : null,
                        active: true,
                        source: 'FIRESTORE_CHANNEL',
                    };
                }
            } catch {
                // Fallback seguro a configuración por defecto si Firestore no posee la colección
            }

            if (defaultCfg.phoneNumberId && constantTimeEqualStrings(cleanId, defaultCfg.phoneNumberId)) {
                return {
                    phoneNumberId: cleanId,
                    accessToken: defaultCfg.accessToken,
                    appSecret: defaultCfg.appSecret,
                    verifyToken: defaultCfg.verifyToken,
                    active: true,
                    source: 'DEFAULT_ENV_CONFIG',
                };
            }

            return null;
        }

        if (!defaultCfg.phoneNumberId) {
            return null;
        }

        return {
            phoneNumberId: defaultCfg.phoneNumberId,
            accessToken: defaultCfg.accessToken,
            appSecret: defaultCfg.appSecret,
            verifyToken: defaultCfg.verifyToken,
            active: true,
            source: 'DEFAULT_ENV_CONFIG',
        };
    }

    /**
     * Verifica el handshake inicial de suscripción Meta Webhook (`GET /api/supply/whatsapp/webhook`).
     */
    public static async verifyWebhookChallenge(params: {
        mode?: string;
        verifyToken?: string;
        challenge?: string;
        expectedVerifyTokenOverride?: string;
    }): Promise<{ ok: boolean; challenge?: string; error?: string }> {
        if (params.mode !== 'subscribe' || !params.challenge) {
            return { ok: false, error: 'Parámetros de suscripción Meta inválidos.' };
        }
        const expected =
            params.expectedVerifyTokenOverride?.trim() ||
            (await this.resolveConfig()).verifyToken ||
            '';

        if (!expected) {
            return { ok: false, error: 'WHATSAPP_VERIFY_TOKEN no configurado.' };
        }

        if (!constantTimeEqualStrings(params.verifyToken || '', expected)) {
            return { ok: false, error: 'Token de verificación Meta inválido.' };
        }

        return { ok: true, challenge: String(params.challenge) };
    }

    /**
     * Verificación síncrona HMAC-SHA256 estrictamente Fail-Closed (puerto `IMessagingGateway`).
     * Exige `Buffer` real `rawBody` no vacío; jamás serializa objetos con `JSON.stringify`.
     */
    public static verifyWebhookSignatureSync(
        rawBody: Buffer | string,
        signatureHeader: string | undefined,
        appSecretOverride?: string
    ): boolean {
        if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
            return false;
        }

        const cleanHeader = String(signatureHeader || '').trim();
        if (!cleanHeader.startsWith('sha256=')) {
            return false;
        }
        const candidateHex = cleanHeader.slice('sha256='.length).trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(candidateHex)) {
            return false;
        }

        const appSecret =
            appSecretOverride?.trim() || process.env.WHATSAPP_APP_SECRET?.trim() || '';
        if (!appSecret) {
            return false;
        }

        const expectedHex = crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex')
            .toLowerCase();

        return constantTimeEqualStrings(candidateHex, expectedHex);
    }

    /**
     * Valida firma criptográfica HMAC-SHA256 de Meta (`X-Hub-Signature-256: sha256=<hex>`).
     * Modo estrictamente Fail-Closed: exige `Buffer` real `rawBody` no vacío.
     */
    public static async verifyWebhookSignature(
        rawBody: Buffer | string,
        signatureHeader: string | undefined,
        appSecretOverride?: string
    ): Promise<boolean> {
        if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
            return false;
        }

        const appSecret =
            appSecretOverride?.trim() || (await this.resolveConfig()).appSecret || '';
        if (!appSecret) {
            return false;
        }

        return this.verifyWebhookSignatureSync(rawBody, signatureHeader, appSecret);
    }

    /**
     * Calcula cabecera `X-Hub-Signature-256` válida (útil para pruebas automatizadas y verificación).
     */
    public static computeWebhookSignature(rawBody: Buffer | string, appSecret: string): string {
        const payloadBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
        const hex = crypto.createHmac('sha256', appSecret).update(payloadBuf).digest('hex');
        return `sha256=${hex}`;
    }

    /**
     * Extrae todos los `phone_number_id` presentes en el payload del webhook Meta.
     */
    public static extractWebhookPhoneNumberIds(payload: unknown): string[] {
        const ids = new Set<string>();
        if (!payload || typeof payload !== 'object') return [];
        const root = payload as Record<string, any>;
        const entries = Array.isArray(root.entry) ? root.entry : [];
        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const change of changes) {
                const pid = change?.value?.metadata?.phone_number_id;
                if (typeof pid === 'string' && pid.trim()) {
                    ids.add(pid.trim());
                }
            }
        }
        return Array.from(ids);
    }

    /**
     * Parsea eventos de estado de entrega (`value.statuses[]`: `sent`, `delivered`, `read`, `failed`)
     * emitidos por Meta WhatsApp Cloud API v24.0, incluyendo códigos de error (`errors[].code`).
     */
    public static extractStatusEvents(payload: unknown): InboundWhatsAppStatusEvent[] {
        const results: InboundWhatsAppStatusEvent[] = [];
        if (!payload || typeof payload !== 'object') return results;

        const root = payload as Record<string, any>;
        const entries = Array.isArray(root.entry) ? root.entry : [];

        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const change of changes) {
                const value = change?.value;
                if (!value || typeof value !== 'object') continue;
                const phoneNumberId =
                    typeof value.metadata?.phone_number_id === 'string'
                        ? value.metadata.phone_number_id.trim()
                        : undefined;
                const statuses = Array.isArray(value.statuses) ? value.statuses : [];

                for (const st of statuses) {
                    const wamid = String(st?.id || '').trim();
                    const rawStatus = String(st?.status || '').trim().toLowerCase();
                    if (
                        !wamid ||
                        (rawStatus !== 'sent' &&
                            rawStatus !== 'delivered' &&
                            rawStatus !== 'read' &&
                            rawStatus !== 'failed')
                    ) {
                        continue;
                    }

                    const rawTs = Number(st?.timestamp || 0);
                    const timestampMs =
                        Number.isFinite(rawTs) && rawTs > 0
                            ? rawTs < 1e12
                                ? rawTs * 1000
                                : rawTs
                            : Date.now();

                    const rawErrors = Array.isArray(st?.errors) ? st.errors : [];
                    const errors: InboundWhatsAppStatusError[] = rawErrors
                        .map((e: any) => {
                            const code = Number(e?.code);
                            if (!Number.isFinite(code)) return null;
                            return {
                                code,
                                title: typeof e?.title === 'string' ? e.title.trim() : undefined,
                                message: typeof e?.message === 'string' ? e.message.trim() : undefined,
                                errorDataDetails:
                                    typeof e?.error_data?.details === 'string'
                                        ? e.error_data.details.trim()
                                        : undefined,
                            };
                        })
                        .filter(Boolean) as InboundWhatsAppStatusError[];

                    results.push({
                        wamid,
                        status: rawStatus,
                        timestampMs,
                        recipientId:
                            typeof st?.recipient_id === 'string' ? st.recipient_id.trim() : undefined,
                        phoneNumberId,
                        errors,
                    });
                }
            }
        }

        return results;
    }

    /**
     * Parsea eventos de mensajes entrantes del webhook oficial Meta WhatsApp Cloud API v24.0.
     */
    public static parseWebhookEvents(payload: unknown): InboundWhatsAppMessage[] {
        const results: InboundWhatsAppMessage[] = [];
        if (!payload || typeof payload !== 'object') return results;

        const root = payload as Record<string, any>;
        const entries = Array.isArray(root.entry) ? root.entry : [];

        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const change of changes) {
                const value = change?.value;
                if (!value || typeof value !== 'object') continue;
                const phoneNumberId =
                    typeof value.metadata?.phone_number_id === 'string'
                        ? value.metadata.phone_number_id.trim()
                        : undefined;
                const messages = Array.isArray(value.messages) ? value.messages : [];

                for (const msg of messages) {
                    const wamid = String(msg?.id || '').trim();
                    const rawFrom = String(msg?.from || '').trim();
                    if (!wamid || !rawFrom) continue;

                    const fromE164 = normalizeE164Phone(rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`);
                    const rawTs = Number(msg?.timestamp || 0);
                    const timestampMs =
                        Number.isFinite(rawTs) && rawTs > 0
                            ? rawTs < 1e12
                                ? rawTs * 1000
                                : rawTs
                            : Date.now();

                    const rawType = String(msg?.type || 'unknown').toLowerCase();

                    if (rawType === 'text') {
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'text',
                            textBody: String(msg?.text?.body || '').trim(),
                            phoneNumberId,
                        });
                    } else if (rawType === 'audio') {
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'audio',
                            mediaId: String(msg?.audio?.id || '').trim() || undefined,
                            mimeType: normalizeMimeType(msg?.audio?.mime_type || 'audio/ogg'),
                            phoneNumberId,
                        });
                    } else if (rawType === 'image') {
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'image',
                            mediaId: String(msg?.image?.id || '').trim() || undefined,
                            mimeType: normalizeMimeType(msg?.image?.mime_type || 'image/jpeg'),
                            caption: typeof msg?.image?.caption === 'string' ? msg.image.caption.trim() : undefined,
                            phoneNumberId,
                        });
                    } else if (rawType === 'document') {
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'document',
                            mediaId: String(msg?.document?.id || '').trim() || undefined,
                            mimeType: normalizeMimeType(msg?.document?.mime_type || 'application/pdf'),
                            caption:
                                typeof msg?.document?.caption === 'string'
                                    ? msg.document.caption.trim()
                                    : undefined,
                            filename:
                                typeof msg?.document?.filename === 'string'
                                    ? msg.document.filename.trim()
                                    : undefined,
                            phoneNumberId,
                        });
                    } else if (rawType === 'interactive') {
                        const btnReply = msg?.interactive?.button_reply;
                        const listReply = msg?.interactive?.list_reply;
                        const replyId = String(btnReply?.id || listReply?.id || '').trim();
                        const replyTitle = String(btnReply?.title || listReply?.title || '').trim();
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'interactive',
                            interactiveReplyId: replyId || undefined,
                            interactiveReplyTitle: replyTitle || undefined,
                            textBody: replyTitle || replyId || undefined,
                            phoneNumberId,
                        });
                    } else {
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'unknown',
                            phoneNumberId,
                        });
                    }
                }
            }
        }

        return results;
    }

    /**
     * Descarga endurecida (P1-08) de archivo multimedia (`.ogg`, imagen, PDF, XML) desde Meta Cloud API v24.0:
     * - Límite estricto `14 MB` (`MAX_WHATSAPP_MEDIA_BYTES`).
     * - Allowlist estricta de MIME (`ALLOWED_WHATSAPP_MEDIA_MIMES`).
     * - Validación de host Meta CDN + `safeFetchExternal` con strip de `Authorization` en redirect cross-origin.
     */
    public static async downloadMedia(
        mediaId: string,
        options?: { phoneNumberId?: string }
    ): Promise<DownloadedWhatsAppMedia> {
        const cleanMediaId = String(mediaId || '').trim();
        if (!cleanMediaId || !/^[A-Za-z0-9._-]{4,128}$/.test(cleanMediaId)) {
            throw new Error('Identificador mediaId de WhatsApp inválido.');
        }

        const channelCfg = options?.phoneNumberId
            ? await this.resolveChannelConfig(options.phoneNumberId)
            : null;
        const accessToken = channelCfg?.accessToken || (await this.resolveConfig()).accessToken;
        if (!accessToken) {
            throw new Error('WHATSAPP_ACCESS_TOKEN no configurado para descarga multimedia.');
        }

        const metaUrl = `${GRAPH_API_BASE}/${encodeURIComponent(cleanMediaId)}`;
        const fetchFn = this.customFetch || fetch;

        const infoResp = await fetchFn(metaUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(12_000),
        });

        if (!infoResp.ok) {
            throw new Error(`Meta Graph API error consultando media (${infoResp.status}).`);
        }

        const infoJson = (await infoResp.json()) as {
            url?: string;
            mime_type?: string;
            file_size?: number;
        };

        if (typeof infoJson.file_size === 'number' && infoJson.file_size > MAX_MEDIA_BYTES) {
            throw new Error(
                `Archivo multimedia excede el límite máximo permitido de 14 MB (${infoJson.file_size} bytes).`
            );
        }

        const declaredMime = normalizeMimeType(infoJson.mime_type);
        if (declaredMime && !ALLOWED_WHATSAPP_MEDIA_MIMES.has(declaredMime)) {
            throw new Error(`Tipo MIME multimedia no permitido por política de seguridad: ${declaredMime}`);
        }

        const downloadUrl = String(infoJson.url || '').trim();
        if (!downloadUrl || !isAllowedMetaMediaHost(downloadUrl)) {
            throw new Error('URL de descarga multimedia Meta rechazada por lista blanca CDN.');
        }

        const binaryResp = this.customFetch
            ? await this.customFetch(downloadUrl, {
                  method: 'GET',
                  headers: { Authorization: `Bearer ${accessToken}` },
                  signal: AbortSignal.timeout(20_000),
              })
            : await safeFetchExternal(downloadUrl, {
                  method: 'GET',
                  headers: { Authorization: `Bearer ${accessToken}` },
                  maxBytes: MAX_MEDIA_BYTES,
                  maxRedirects: 2,
                  timeoutMs: 20_000,
              });

        if (!binaryResp.ok) {
            throw new Error(`Error descargando binario multimedia desde Meta CDN (${binaryResp.status}).`);
        }

        const declaredHeaderLength = Number(binaryResp.headers.get('content-length') || 0);
        if (declaredHeaderLength > MAX_MEDIA_BYTES) {
            throw new Error(
                `Tamaño declarado del binario excede el límite de 14 MB (${declaredHeaderLength} bytes).`
            );
        }

        const arrBuf = await binaryResp.arrayBuffer();
        const buffer = Buffer.from(arrBuf);
        if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
            throw new Error('Tamaño de binario descargado fuera de límites permitidos (máximo 14 MB).');
        }

        const mimeType =
            declaredMime || normalizeMimeType(binaryResp.headers.get('content-type'));
        if (!mimeType || !ALLOWED_WHATSAPP_MEDIA_MIMES.has(mimeType)) {
            throw new Error(
                `Tipo MIME de descarga multimedia rechazado por lista blanca: ${mimeType || 'desconocido'}`
            );
        }

        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

        return {
            mediaId: cleanMediaId,
            buffer,
            mimeType,
            sha256,
            sizeBytes: buffer.length,
        };
    }

    private static formatRecipientDigits(toE164: string): string {
        return normalizeE164Phone(toE164).replace(/^\+/, '');
    }

    private static recordMockOutbound(
        record: Omit<MockOutboundWhatsAppRecord, 'id' | 'sentAt'>
    ): WhatsAppSendResult {
        const id = `wamid.mock_${crypto.randomBytes(8).toString('hex')}`;
        this.mockOutbox.push({
            ...record,
            id,
            sentAt: new Date().toISOString(),
        });
        return { ok: true, messageId: id, mocked: true, statusCode: 200 };
    }

    private static async postToMetaMessages(
        payload: Record<string, unknown>,
        toE164: string,
        phoneNumberIdOverride?: string
    ): Promise<WhatsAppSendResult> {
        const channelCfg = phoneNumberIdOverride
            ? await this.resolveChannelConfig(phoneNumberIdOverride)
            : null;
        const defaultCfg = await this.resolveConfig();
        const accessToken = channelCfg?.accessToken || defaultCfg.accessToken;
        const phoneNumberId = channelCfg?.phoneNumberId || defaultCfg.phoneNumberId;

        if (!accessToken || !phoneNumberId) {
            return {
                ok: false,
                mocked: false,
                statusCode: 503,
                retryable: true,
                error: 'Credenciales WhatsApp Cloud API (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID) ausentes.',
            };
        }

        const endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
        const fetchFn = this.customFetch || fetch;

        let lastStatus = 500;
        let lastClassification: MetaErrorClassification = {
            cswExpired: false,
            tokenExpired: false,
            retryable: true,
            templateError: false,
            summary: 'Unknown Meta API error',
        };

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const resp = await fetchFn(endpoint, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(12_000),
                });
                lastStatus = resp.status;
                if (resp.ok) {
                    const data = (await resp.json().catch(() => ({}))) as {
                        messages?: Array<{ id?: string }>;
                    };
                    return {
                        ok: true,
                        messageId: data?.messages?.[0]?.id,
                        mocked: false,
                        statusCode: resp.status,
                    };
                }
                const errText = await resp.text().catch(() => '');
                lastClassification = classifyMetaGraphError(resp.status, errText);
                if (!lastClassification.retryable) {
                    break;
                }
            } catch (err: any) {
                lastStatus = 503;
                lastClassification = {
                    cswExpired: false,
                    tokenExpired: false,
                    retryable: true,
                    templateError: false,
                    summary: err?.message || 'Network error',
                };
            }

            if (attempt < 2) {
                const delayMs = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }

        console.warn(
            `[WA-CLOUD] Fallo envío hacia ${maskPiiForLog(toE164)} (status=${lastStatus}, code=${lastClassification.metaErrorCode ?? 'none'}): ${lastClassification.summary}`
        );
        return {
            ok: false,
            mocked: false,
            statusCode: lastStatus,
            error: lastClassification.summary,
            metaErrorCode: lastClassification.metaErrorCode,
            cswExpired: lastClassification.cswExpired,
            tokenExpired: lastClassification.tokenExpired,
            retryable: lastClassification.retryable,
            templateError: lastClassification.templateError,
        };
    }

    /**
     * Envía mensaje de texto consolidado en una sola burbuja (FinOps: ahorra 60-70% costo por mensaje).
     */
    public static async sendTextMessage(
        toE164: string,
        bodyText: string,
        options?: { previewUrl?: boolean; replyToWamid?: string; phoneNumberId?: string }
    ): Promise<WhatsAppSendResult> {
        const cleanBody = String(bodyText || '').trim().slice(0, 4096);
        const normalized = normalizeE164Phone(toE164);

        if (this.isMockMode() && !this.customFetch) {
            return this.recordMockOutbound({
                toMasked: maskPiiForLog(normalized),
                toE164Hash: crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16),
                kind: 'text',
                bodyText: cleanBody,
            });
        }

        const payload: Record<string, unknown> = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: this.formatRecipientDigits(normalized),
            type: 'text',
            text: {
                preview_url: Boolean(options?.previewUrl),
                body: cleanBody,
            },
        };

        if (options?.replyToWamid) {
            payload.context = { message_id: options.replyToWamid };
        }

        return this.postToMetaMessages(payload, normalized, options?.phoneNumberId);
    }

    /**
     * Envía mensaje consolidado con hasta 3 botones interactivos de respuesta rápida (Meta Reply Buttons).
     */
    public static async sendInteractiveButtons(
        toE164: string,
        bodyText: string,
        buttons: WhatsAppReplyButton[],
        options?: { headerText?: string; footerText?: string; phoneNumberId?: string }
    ): Promise<WhatsAppSendResult> {
        const cleanBody = String(bodyText || '').trim().slice(0, 1024);
        const normalized = normalizeE164Phone(toE164);
        const safeButtons = buttons.slice(0, 3).map((b) => ({
            id: String(b.id).trim().slice(0, 256),
            title: String(b.title).trim().slice(0, 20),
        }));

        if (safeButtons.length === 0) {
            return this.sendTextMessage(normalized, cleanBody, {
                phoneNumberId: options?.phoneNumberId,
            });
        }

        if (this.isMockMode() && !this.customFetch) {
            return this.recordMockOutbound({
                toMasked: maskPiiForLog(normalized),
                toE164Hash: crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16),
                kind: 'interactive_buttons',
                bodyText: cleanBody,
                buttons: safeButtons,
            });
        }

        const interactive: Record<string, unknown> = {
            type: 'button',
            body: { text: cleanBody },
            action: {
                buttons: safeButtons.map((b) => ({
                    type: 'reply',
                    reply: { id: b.id, title: b.title },
                })),
            },
        };

        if (options?.headerText) {
            interactive.header = { type: 'text', text: options.headerText.trim().slice(0, 60) };
        }
        if (options?.footerText) {
            interactive.footer = { text: options.footerText.trim().slice(0, 60) };
        }

        const payload: Record<string, unknown> = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: this.formatRecipientDigits(normalized),
            type: 'interactive',
            interactive,
        };

        return this.postToMetaMessages(payload, normalized, options?.phoneNumberId);
    }

    /**
     * Envía plantilla Utility aprobada por Meta (notificaciones proactivas fuera de ventana CSW 24h).
     * Aplica `sanitizeTemplateParameter` obligatoriamente a cada parámetro (previene error `132018`).
     */
    public static async sendTemplateMessage(
        toE164: string,
        templateName: string,
        languageCode: string = 'es',
        bodyParams: string[] = [],
        options?: { phoneNumberId?: string }
    ): Promise<WhatsAppSendResult> {
        const normalized = normalizeE164Phone(toE164);
        const safeParams = bodyParams.map((p) => sanitizeTemplateParameter(p));

        if (this.isMockMode() && !this.customFetch) {
            return this.recordMockOutbound({
                toMasked: maskPiiForLog(normalized),
                toE164Hash: crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16),
                kind: 'template',
                templateName,
                languageCode,
                templateParams: safeParams,
            });
        }

        const payload: Record<string, unknown> = {
            messaging_product: 'whatsapp',
            to: this.formatRecipientDigits(normalized),
            type: 'template',
            template: {
                name: templateName,
                language: { code: languageCode },
                components:
                    safeParams.length > 0
                        ? [
                              {
                                  type: 'body',
                                  parameters: safeParams.map((text) => ({ type: 'text', text })),
                              },
                          ]
                        : [],
            },
        };

        return this.postToMetaMessages(payload, normalized, options?.phoneNumberId);
    }

    /**
     * Marca un mensaje entrante como leído en Meta Cloud API v24.0 (mejor UX de terreno).
     */
    public static async markAsRead(
        wamid: string,
        options?: { phoneNumberId?: string }
    ): Promise<void> {
        if (!wamid || (this.isMockMode() && !this.customFetch)) return;
        const channelCfg = options?.phoneNumberId
            ? await this.resolveChannelConfig(options.phoneNumberId)
            : null;
        const defaultCfg = await this.resolveConfig();
        const accessToken = channelCfg?.accessToken || defaultCfg.accessToken;
        const phoneNumberId = channelCfg?.phoneNumberId || defaultCfg.phoneNumberId;
        if (!accessToken || !phoneNumberId) return;

        const endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
        const fetchFn = this.customFetch || fetch;
        await fetchFn(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: wamid,
            }),
            signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
    }
}

/**
 * Implementación concreta del puerto hexagonal `IMessagingGateway` sobre Meta WhatsApp Cloud API `v24.0`.
 */
export const metaWhatsAppGateway: IMessagingGateway = {
    channel: 'WHATSAPP_CLOUD',

    verifyWebhookSignature(
        rawBody: Buffer | string,
        signatureHeader: string | undefined
    ): boolean {
        return MetaWhatsAppCloudAdapter.verifyWebhookSignatureSync(rawBody, signatureHeader);
    },

    parseWebhookPayload(payload: unknown): InboundMessagingEvent[] {
        return MetaWhatsAppCloudAdapter.parseWebhookEvents(payload).map((ev) => ({
            providerMessageId: ev.wamid,
            channel: 'WHATSAPP_CLOUD',
            senderPhoneE164: ev.fromE164,
            recipientDisplayId: ev.phoneNumberId,
            timestampIso: new Date(ev.timestampMs).toISOString(),
            kind: ev.type === 'unknown' ? 'text' : ev.type,
            textBody: ev.textBody || ev.caption,
            mediaId: ev.mediaId,
            mediaMimeType: ev.mimeType,
            interactiveReplyId: ev.interactiveReplyId,
            interactiveReplyTitle: ev.interactiveReplyTitle,
        }));
    },

    async downloadMedia(mediaId: string): Promise<DownloadedGatewayMedia> {
        const downloaded = await MetaWhatsAppCloudAdapter.downloadMedia(mediaId);
        return {
            buffer: downloaded.buffer,
            mimeType: downloaded.mimeType,
            originalBytes: downloaded.sizeBytes,
        };
    },

    async sendConsolidatedMessage(
        payload: OutboundMessagePayload
    ): Promise<MessagingDeliveryReceipt> {
        const res =
            payload.replyButtons && payload.replyButtons.length > 0
                ? await MetaWhatsAppCloudAdapter.sendInteractiveButtons(
                      payload.recipientPhoneE164,
                      payload.textBody,
                      payload.replyButtons
                  )
                : await MetaWhatsAppCloudAdapter.sendTextMessage(
                      payload.recipientPhoneE164,
                      payload.textBody,
                      { replyToWamid: payload.replyToMessageId }
                  );

        return {
            providerMessageId: res.messageId || `wa_failed_${Date.now()}`,
            accepted: res.ok,
            sentAt: new Date().toISOString(),
            errorCode: res.metaErrorCode ? String(res.metaErrorCode) : undefined,
            errorDetail: res.error,
        };
    },

    async sendUtilityTemplate(
        payload: OutboundTemplatePayload
    ): Promise<MessagingDeliveryReceipt> {
        const res = await MetaWhatsAppCloudAdapter.sendTemplateMessage(
            payload.recipientPhoneE164,
            payload.templateName,
            payload.languageCode,
            payload.bodyParameters
        );

        return {
            providerMessageId: res.messageId || `wa_tpl_failed_${Date.now()}`,
            accepted: res.ok,
            sentAt: new Date().toISOString(),
            errorCode: res.metaErrorCode ? String(res.metaErrorCode) : undefined,
            errorDetail: res.error,
        };
    },
};
