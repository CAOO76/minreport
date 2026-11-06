import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: '.env.local' });
dotenv.config();

const envSchema = z.object({
    RESEND_API_KEY: z.string().optional().default(''),
    GEMINI_API_KEY: z.string().optional().default(''),
    GEMINI_DEV_API_KEY: z.string().optional().default(''),
    GOOGLE_API_KEY: z.string().optional().default(''),
    PORT: z.string().default('8080'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    GCP_PROJECT_ID: z.string().default('minreport-8f2a8'),
    GCP_LOCATION: z.string().default('southamerica-west1'),
    STORAGE_BUCKET: z.string().default('minreport-8f2a8.firebasestorage.app'),
    CLOUD_TASKS_QUEUE: z.string().default('opermaq-hunt-queue'),
    WORKER_SERVICE_URL: z.string().optional(),
    WORKER_SA_EMAIL: z.string().optional(),
    SUPER_ADMIN_EMAIL: z.string().email().default('admin@minreport.com'),
    SUPER_ADMIN_PASSWORD: z.string().optional().default(''),
    DEV_ROOT_PASSWORD: z.string().optional().default(''),
    X402_HMAC_SECRET: z.string().optional().default(''),
    WEB_URL: z.string().optional().default(''),
    API_URL: z.string().optional().default(''),
    AI_GATEWAY_BASE_URL: z.string().optional().default(''),
    WEBAUTHN_RP_ID: z.string().optional().default(''),
    WEBAUTHN_RP_NAME: z.string().default('MINREPORT'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('[CONFIG] Variables de entorno inválidas:', parsedEnv.error.format());
    process.exit(1);
}

export const env = parsedEnv.data;

/**
 * Retorna la URL base canónica del frontend sin confiar en el header Host del cliente.
 */
export function getCanonicalWebUrl(): string {
    const configured = (env.WEB_URL || process.env.WEB_URL || '').trim();
    if (configured) {
        return configured.replace(/\/+$/, '');
    }
    return env.NODE_ENV === 'production'
        ? 'https://minreport-access.web.app'
        : 'http://localhost:5173';
}

/**
 * Retorna la URL base canónica del backend sin confiar en el header Host del cliente.
 */
export function getCanonicalApiUrl(): string {
    const configured = (env.API_URL || process.env.API_URL || '').trim();
    if (configured) {
        return configured.replace(/\/+$/, '');
    }
    return env.NODE_ENV === 'production'
        ? 'https://minreport-access.web.app'
        : `http://localhost:${env.PORT || '8080'}`;
}
