import { Resend } from 'resend';
import { db } from '../config/firebase';
import { env } from '../config/env';
import admin from 'firebase-admin';

const resend = new Resend(env.RESEND_API_KEY);

interface EmailOptions {
    from: string;
    to: string;
    subject: string;
    html: string;
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

        try {
            await resend.emails.send({
                from: options.from,
                to: options.to,
                subject: options.subject,
                html: options.html
            });
            console.log(`[EmailService] Email sent to ${options.to}: ${options.subject}`);
        } catch (error) {
            console.error(`[EmailService] Failed to send email to ${options.to}:`, error);
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
