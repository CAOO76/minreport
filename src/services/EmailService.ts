import { Resend } from 'resend';
import { db } from '../config/firebase';
import { env } from '../config/env';
import { resolveResendApiKey } from '../config/secrets';
import { ConfidentialityAirlockService } from '../core/privacy/ConfidentialityAirlockService';
import admin from 'firebase-admin';

/**
 * Enmascara un correo electrónico para trazas de consola (Ley N° 21.719 — cero PII en logs).
 */
export function maskEmailForLog(rawEmail?: string | null): string {
    const clean = String(rawEmail || '').trim();
    if (!clean) return '[REDACTED_EMAIL]';
    const atIdx = clean.indexOf('@');
    if (atIdx <= 0 || atIdx === clean.length - 1) {
        return '[REDACTED_EMAIL]';
    }
    const local = clean.slice(0, atIdx);
    const domain = clean.slice(atIdx + 1);
    const maskedLocal = local.length <= 2 ? `${local[0] || '*'}***` : `${local.slice(0, 2)}***`;
    const dotIdx = domain.lastIndexOf('.');
    const maskedDomain =
        dotIdx > 1
            ? `${domain[0]}***${domain.slice(dotIdx)}`
            : `${domain[0] || '*'}***`;
    return `${maskedLocal}@${maskedDomain}`;
}

/**
 * Sanitiza textos libres de log purgando correos, RUTs, teléfonos +56 y tokens sensibles.
 */
export function sanitizeEmailLogText(rawText?: unknown): string {
    const base = typeof rawText === 'string' ? rawText : String(rawText ?? '');
    if (!base) return '';
    const scrubbed = ConfidentialityAirlockService.scrubDeterministicPii(base, 'CL').scrubbed;
    return scrubbed
        .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (m) => maskEmailForLog(m))
        .replace(/(token|oobCode|secret|password|api[_-]?key)=([^&\s]+)/gi, '$1=[REDACTED]');
}

let cachedResend: { key: string; client: Resend } | null = null;

async function getResendClient(): Promise<Resend> {
    const apiKey = (await resolveResendApiKey()) || env.RESEND_API_KEY || '';
    if (!cachedResend || cachedResend.key !== apiKey) {
        cachedResend = {
            key: apiKey,
            client: new Resend(apiKey),
        };
    }
    return cachedResend.client;
}

export interface EmailAttachment {
    content?: string | Buffer;
    filename?: string;
    path?: string;
    content_type?: string;
    contentType?: string;
    contentId?: string;
    content_id?: string;
}

export interface EmailOptions {
    from: string;
    to: string;
    subject: string;
    html: string;
    reply_to?: string;
    attachments?: EmailAttachment[];
    redactSensitiveOtp?: boolean;
}

export class EmailService {
    /**
     * Envía un email usando Resend, o lo desvía a Firestore si estamos en modo TEST.
     */
    static async sendEmail(options: EmailOptions): Promise<void> {
        const isMockEnabled = env.NODE_ENV === 'test' || process.env.MOCK_EMAILS === 'true';

        if (isMockEnabled) {
            return this.mockEmail(options);
        }

        // Remitente blindado: Forzar MINREPORT o variable de entorno institucional
        const sender = process.env.RESEND_FROM_EMAIL || options.from || 'MINREPORT <no-reply@minreport.com>';
        const replyTo = options.reply_to || process.env.RESEND_REPLY_TO || 'no-reply@minreport.com';

        try {
            const resend = await getResendClient();
            const sendPayload: any = {
                from: sender,
                to: options.to,
                subject: options.subject,
                html: options.html,
                reply_to: replyTo
            };

            if (options.attachments && options.attachments.length > 0) {
                sendPayload.attachments = options.attachments;
            }

            const maskedTo = maskEmailForLog(options.to);
            const maskedSender = sanitizeEmailLogText(sender);
            const result = await resend.emails.send(sendPayload);
            if (result.error) {
                const safeErrMsg = sanitizeEmailLogText(result.error.message || result.error.name);
                console.error(`[EmailService] Error devuelto por Resend API para ${maskedTo}: ${safeErrMsg}`);
                const errObj = result.error as any;
                if (errObj.statusCode === 403 || errObj.message?.includes('Domain not verified')) {
                    console.warn(
                        `[EmailService] Remitente (${maskedSender}) o destinatario (${maskedTo}) restringido por política de Resend.`
                    );
                }
                throw new Error(result.error.message || `Resend Error (${result.error.name})`);
            }
            console.log(`[EmailService] Email despachado vía Resend a ${maskedTo} (ID: ${result.data?.id || 'n/a'})`);
        } catch (error: any) {
            const maskedTo = maskEmailForLog(options.to);
            const safeErr = sanitizeEmailLogText(error?.message || 'Error desconocido');
            console.error(`[EmailService] Fallo al enviar email a ${maskedTo}: ${safeErr}`);
            throw error;
        }
    }

    /**
     * Guarda el email en la colección system_emails para ser leído por los tests E2E.
     * Nunca persiste OTPs de acceso DEV en texto plano.
     */
    private static async mockEmail(options: EmailOptions): Promise<void> {
        const safeSubject = options.redactSensitiveOtp
            ? options.subject.replace(/\b\d{6}\b/g, '[OTP_REDACTED]')
            : options.subject;
        const safeHtml = options.redactSensitiveOtp
            ? options.html.replace(/\b\d{6}\b/g, '[OTP_REDACTED]')
            : options.html;

        console.log(
            `[EmailService][MOCK] Capturing email to ${maskEmailForLog(options.to)}: ${sanitizeEmailLogText(safeSubject)}`
        );

        const oobCodeMatch = safeHtml.match(/[?&]oobCode=([^&"'\s]+)/);
        const accountIdMatch = safeHtml.match(/[?&]accountId=([^&"'\s]+)/);
        const taxIdMatch = safeHtml.match(/[?&]taxId=([^&"'\s]+)/);

        const emailDoc = {
            to: options.to,
            subject: safeSubject,
            body: safeHtml,
            oobCode: oobCodeMatch ? oobCodeMatch[1] : null,
            params: {
                accountId: accountIdMatch ? accountIdMatch[1] : null,
                taxId: taxIdMatch ? taxIdMatch[1] : null,
                oobCode: oobCodeMatch ? oobCodeMatch[1] : null,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isMock: true
        };

        try {
            await db.collection('system_emails').add(emailDoc);
        } catch (error: any) {
            console.error(
                '[EmailService][MOCK] Failed to store mock email:',
                sanitizeEmailLogText(error?.message || error)
            );
        }
    }
}
