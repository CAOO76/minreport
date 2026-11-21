import crypto from 'crypto';
import { getSecret } from '../../../config/secrets';
import { constantTimeEqualStrings } from '../../../utils/security';
import { safeFetchExternal } from '../../../utils/ssrfGuard';
import { normalizeE164Phone } from '../../../utils/taxIdValidator';
import { maskPiiForLog } from '../application/supply.types';

/**
 * META WHATSAPP CLOUD API v21+ ADAPTER (MINREPORT · ABASTECIMIENTO)
 *
 * Cliente HTTPS directo API-Only (80+ MPS compliant):
 * - Verificación criptográfica HMAC-SHA256 `X-Hub-Signature-256` (Fail-Closed).
 * - Handshake `GET /whatsapp/webhook` con comparación en tiempo constante.
 * - Descarga segura anti-SSRF de audio `.ogg`, imágenes y documentos PDF/XML
 *   con lista blanca de hosts Meta CDN antes de adjuntar Bearer Token.
 * - Emisión consolidada en burbuja única (texto plano, botones interactivos y templates Utility).
 * - Cero logging de números telefónicos o tokens en texto plano (Ley N° 21.719).
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

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

export interface MockOutboundWhatsAppRecord {
    id: string;
    toMasked: string;
    toE164Hash: string;
    kind: 'text' | 'interactive_buttons' | 'template';
    bodyText?: string;
    buttons?: WhatsAppReplyButton[];
    templateName?: string;
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

export class MetaWhatsAppCloudAdapter {
    private static readonly mockOutbox: MockOutboundWhatsAppRecord[] = [];
    private static customFetch: FetchLike | null = null;

    public static setCustomFetchForTests(fetchFn: FetchLike | null): void {
        this.customFetch = fetchFn;
    }

    public static getMockOutbox(): MockOutboundWhatsAppRecord[] {
        return [...this.mockOutbox];
    }

    public static clearMockOutbox(): void {
        this.mockOutbox.length = 0;
    }

    private static isMockMode(): boolean {
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
     * Valida firma criptográfica HMAC-SHA256 de Meta (`X-Hub-Signature-256: sha256=<hex>`).
     * Modo estrictamente Fail-Closed.
     */
    public static async verifyWebhookSignature(
        rawBody: Buffer | string,
        signatureHeader: string | undefined,
        appSecretOverride?: string
    ): Promise<boolean> {
        const cleanHeader = String(signatureHeader || '').trim();
        if (!cleanHeader.startsWith('sha256=')) {
            return false;
        }
        const candidateHex = cleanHeader.slice('sha256='.length).trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(candidateHex)) {
            return false;
        }

        const appSecret =
            appSecretOverride?.trim() || (await this.resolveConfig()).appSecret || '';
        if (!appSecret) {
            return false;
        }

        const payloadBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
        const expectedHex = crypto
            .createHmac('sha256', appSecret)
            .update(payloadBuf)
            .digest('hex')
            .toLowerCase();

        return constantTimeEqualStrings(candidateHex, expectedHex);
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
     * Parsea eventos entrantes del webhook oficial Meta WhatsApp Cloud API v21+.
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
                        ? value.metadata.phone_number_id
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
                            mimeType: String(msg?.audio?.mime_type || 'audio/ogg').split(';')[0].trim(),
                            phoneNumberId,
                        });
                    } else if (rawType === 'image') {
                        results.push({
                            wamid,
                            fromE164,
                            timestampMs,
                            type: 'image',
                            mediaId: String(msg?.image?.id || '').trim() || undefined,
                            mimeType: String(msg?.image?.mime_type || 'image/jpeg').split(';')[0].trim(),
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
                            mimeType: String(msg?.document?.mime_type || 'application/pdf').split(';')[0].trim(),
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
     * Descarga un archivo multimedia (`.ogg`, imagen, PDF, XML) desde Meta Cloud API v21+.
     */
    public static async downloadMedia(mediaId: string): Promise<DownloadedWhatsAppMedia> {
        const cleanMediaId = String(mediaId || '').trim();
        if (!cleanMediaId || !/^[A-Za-z0-9._-]{4,128}$/.test(cleanMediaId)) {
            throw new Error('Identificador mediaId de WhatsApp inválido.');
        }

        const { accessToken } = await this.resolveConfig();
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

        const arrBuf = await binaryResp.arrayBuffer();
        const buffer = Buffer.from(arrBuf);
        if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
            throw new Error('Tamaño de binario descargado fuera de límites permitidos.');
        }

        const mimeType = String(infoJson.mime_type || binaryResp.headers.get('content-type') || 'application/octet-stream')
            .split(';')[0]
            .trim()
            .toLowerCase();
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

    private static recordMockOutbound(record: Omit<MockOutboundWhatsAppRecord, 'id' | 'sentAt'>): WhatsAppSendResult {
        const id = `wamid.mock_${crypto.randomBytes(8).toString('hex')}`;
        this.mockOutbox.push({
            ...record,
            id,
            sentAt: new Date().toISOString(),
        });
        return { ok: true, messageId: id, mocked: true, statusCode: 200 };
    }

    private static async postToMetaMessages(payload: Record<string, unknown>, toE164: string): Promise<WhatsAppSendResult> {
        const { accessToken, phoneNumberId } = await this.resolveConfig();
        if (!accessToken || !phoneNumberId) {
            return {
                ok: false,
                mocked: false,
                statusCode: 503,
                error: 'Credenciales WhatsApp Cloud API (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID) ausentes.',
            };
        }

        const endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
        const fetchFn = this.customFetch || fetch;

        let lastStatus = 500;
        let lastError = 'Unknown Meta API error';

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
                lastError = `Meta HTTP ${resp.status}: ${errText.slice(0, 200)}`;
                if (resp.status !== 429 && resp.status < 500) {
                    break;
                }
            } catch (err: any) {
                lastError = err?.message || 'Network error';
            }

            if (attempt < 2) {
                const delayMs = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }

        console.warn(
            `[WA-CLOUD] Fallo envío hacia ${maskPiiForLog(toE164)} (status=${lastStatus}): ${lastError}`
        );
        return {
            ok: false,
            mocked: false,
            statusCode: lastStatus,
            error: lastError,
        };
    }

    /**
     * Envía mensaje de texto consolidado en una sola burbuja (FinOps: ahorra 60-70% costo por mensaje).
     */
    public static async sendTextMessage(
        toE164: string,
        bodyText: string,
        options?: { previewUrl?: boolean; replyToWamid?: string }
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

        return this.postToMetaMessages(payload, normalized);
    }

    /**
     * Envía mensaje consolidado con hasta 3 botones interactivos de respuesta rápida (Meta Reply Buttons).
     */
    public static async sendInteractiveButtons(
        toE164: string,
        bodyText: string,
        buttons: WhatsAppReplyButton[],
        options?: { headerText?: string; footerText?: string }
    ): Promise<WhatsAppSendResult> {
        const cleanBody = String(bodyText || '').trim().slice(0, 1024);
        const normalized = normalizeE164Phone(toE164);
        const safeButtons = buttons.slice(0, 3).map((b) => ({
            id: String(b.id).trim().slice(0, 256),
            title: String(b.title).trim().slice(0, 20),
        }));

        if (safeButtons.length === 0) {
            return this.sendTextMessage(normalized, cleanBody);
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

        return this.postToMetaMessages(payload, normalized);
    }

    /**
     * Envía plantilla Utility aprobada por Meta (notificaciones proactivas fuera de ventana CSW 24h).
     */
    public static async sendTemplateMessage(
        toE164: string,
        templateName: string,
        languageCode: string = 'es',
        bodyParams: string[] = []
    ): Promise<WhatsAppSendResult> {
        const normalized = normalizeE164Phone(toE164);
        const safeParams = bodyParams.map((p) => String(p ?? '').trim().slice(0, 512));

        if (this.isMockMode() && !this.customFetch) {
            return this.recordMockOutbound({
                toMasked: maskPiiForLog(normalized),
                toE164Hash: crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16),
                kind: 'template',
                templateName,
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

        return this.postToMetaMessages(payload, normalized);
    }

    /**
     * Marca un mensaje entrante como leído en Meta Cloud API (mejor UX de terreno).
     */
    public static async markAsRead(wamid: string): Promise<void> {
        if (!wamid || (this.isMockMode() && !this.customFetch)) return;
        const { accessToken, phoneNumberId } = await this.resolveConfig();
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
