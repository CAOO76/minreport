/**
 * Puerto Hexagonal de Mensajería Bidireccional (IMessagingGateway)
 *
 * Abstrae el transporte de mensajería (Meta WhatsApp Cloud API v21+, simulador DEV/TEST-PILOT,
 * futuros canales SMS/satelital) manteniendo la lógica de FSM e idempotencia desacoplada.
 */

export type MessagingChannelType = 'WHATSAPP_CLOUD' | 'WHATSAPP_SIMULATOR' | 'EMAIL_RESEND';

export type InboundMessageKind = 'text' | 'audio' | 'image' | 'document' | 'interactive';

export interface InboundMessagingEvent {
    providerMessageId: string;
    channel: MessagingChannelType;
    senderPhoneE164: string;
    recipientDisplayId?: string;
    timestampIso: string;
    kind: InboundMessageKind;
    textBody?: string;
    mediaId?: string;
    mediaMimeType?: string;
    mediaSha256?: string;
    interactiveReplyId?: string;
    interactiveReplyTitle?: string;
}

export interface OutboundReplyButton {
    id: string;
    title: string;
}

export interface OutboundMessagePayload {
    recipientPhoneE164: string;
    textBody: string;
    replyButtons?: OutboundReplyButton[];
    correlationId?: string;
    replyToMessageId?: string;
}

export interface OutboundTemplatePayload {
    recipientPhoneE164: string;
    templateName: string;
    languageCode: string;
    bodyParameters: string[];
    correlationId?: string;
}

export interface MessagingDeliveryReceipt {
    providerMessageId: string;
    accepted: boolean;
    sentAt: string;
    errorCode?: string;
    errorDetail?: string;
}

export interface DownloadedGatewayMedia {
    buffer: Buffer;
    mimeType: string;
    originalBytes: number;
    fileName?: string;
}

export interface IMessagingGateway {
    readonly channel: MessagingChannelType;

    /**
     * Verifica firma criptográfica HMAC-SHA256 del webhook entrante (Fail-Closed).
     */
    verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean;

    /**
     * Extrae eventos entrantes normalizados desde el payload del proveedor.
     */
    parseWebhookPayload(payload: unknown): InboundMessagingEvent[];

    /**
     * Descarga un archivo binario multimedia (audio .ogg, foto boleta, PDF) del proveedor.
     */
    downloadMedia(mediaId: string): Promise<DownloadedGatewayMedia>;

    /**
     * Envía una burbuja única consolidada (optimización FinOps por conversación).
     */
    sendConsolidatedMessage(payload: OutboundMessagePayload): Promise<MessagingDeliveryReceipt>;

    /**
     * Envía plantilla Utility aprobada (ej. alertas a comprador fuera de ventana de 24h).
     */
    sendUtilityTemplate(payload: OutboundTemplatePayload): Promise<MessagingDeliveryReceipt>;
}
