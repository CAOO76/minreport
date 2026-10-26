import { Resend } from 'resend';
import { db } from '../config/firebase';
import { env } from '../config/env';
import admin from 'firebase-admin';

const resend = new Resend(env.RESEND_API_KEY);

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

            const result = await resend.emails.send(sendPayload);
            if (result.error) {
                console.error(`[EmailService] ❌ Error devuelto por Resend API para ${options.to}:`, result.error);
                const errObj = result.error as any;
                if (errObj.statusCode === 403 || errObj.message?.includes('Domain not verified')) {
                    console.warn(`[EmailService] ⚠️ Remitente (${sender}) o destinatario (${options.to}) restringido por política de Resend.`);
                    console.warn(`[EmailService] 💡 Para pruebas locales, configure en .env: RESEND_FROM_EMAIL=MINREPORT <onboarding@resend.dev>`);
                }
                throw new Error(result.error.message || `Resend Error (${result.error.name})`);
            }
            console.log(`[EmailService] ✅ Email despachado vía Resend a ${options.to}: ${options.subject} (ID: ${result.data?.id})`);
        } catch (error: any) {
            console.error(`[EmailService] Fallo al enviar email a ${options.to}:`, error?.message || error);
            throw error;
        }
    }

    /**
     * Guarda el email en la colección system_emails para ser leído por los tests E2E.
     */
    private static async mockEmail(options: EmailOptions): Promise<void> {
        console.log(`[EmailService][MOCK] Capturing email to ${options.to}: ${options.subject}`);

        // Extraer oobCode y otros params del link si existe
        // Links suelen tener formato: /setup-access?accountId=...&oobCode=...
        const oobCodeMatch = options.html.match(/[?&]oobCode=([^&"'\s]+)/);
        const accountIdMatch = options.html.match(/[?&]accountId=([^&"'\s]+)/);
        const taxIdMatch = options.html.match(/[?&]taxId=([^&"'\s]+)/);

        console.log(`[EmailService][MOCK] Extracted params:`, {
            accountId: accountIdMatch ? accountIdMatch[1] : 'MISSING',
            taxId: taxIdMatch ? taxIdMatch[1] : 'MISSING',
            oobCode: oobCodeMatch ? oobCodeMatch[1] : 'MISSING'
        });
        const emailDoc = {
            to: options.to,
            subject: options.subject,
            body: options.html,
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
            console.log(`[EmailService][MOCK] Email stored in Firestore for ${options.to}`);
        } catch (error) {
            console.error('[EmailService][MOCK] Failed to store mock email:', error);
        }
    }
}
