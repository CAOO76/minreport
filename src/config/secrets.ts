import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { env } from './env';

/**
 * GESTOR SOBERANO DE SECRETOS (Capa 5 MINREPORT — southamerica-west1)
 * Hidrata secretos críticos desde Google Cloud Secret Manager (proyecto GCP / southamerica-west1)
 * cuando el proceso no corre contra emuladores locales, y soporta variables locales (.env.local / .env)
 * en desarrollo/test con recarga en caliente.
 */

export const CORE_HYDRATED_SECRETS = [
    'GEMINI_API_KEY',
    'RESEND_API_KEY',
    'SUPER_ADMIN_PASSWORD',
    'DEV_ROOT_PASSWORD',
    'X402_HMAC_SECRET',
] as const;

export type CoreSecretName = (typeof CORE_HYDRATED_SECRETS)[number];

let smClient: SecretManagerServiceClient | null = null;
const secretCache = new Map<string, string>();
const failedLookupAt = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 60_000;

function getSecretManagerClient(): SecretManagerServiceClient {
    if (!smClient) {
        smClient = new SecretManagerServiceClient();
    }
    return smClient;
}

function isRunningAgainstLocalEmulator(): boolean {
    if (process.env.ENABLE_SECRET_MANAGER_IN_EMULATOR === 'true') {
        return false;
    }
    return Boolean(
        process.env.FIRESTORE_EMULATOR_HOST ||
            process.env.FIREBASE_AUTH_EMULATOR_HOST ||
            env.NODE_ENV === 'test'
    );
}

function syncHydratedEnvValue(secretName: string, value: string): void {
    process.env[secretName] = value;
    if (secretName in env) {
        (env as Record<string, unknown>)[secretName] = value;
    }
}

function readLocalEnvHot(secretName: string): string | null {
    if (env.NODE_ENV === 'production') return null;

    const repoRoot = path.resolve(__dirname, '../..');
    const candidates = Array.from(
        new Set([
            path.resolve(process.cwd(), '.env.local'),
            path.resolve(repoRoot, '.env.local'),
            path.resolve(process.cwd(), '.env'),
            path.resolve(repoRoot, '.env'),
        ])
    );

    for (const filePath of candidates) {
        try {
            if (!fs.existsSync(filePath)) continue;
            const rawContent = fs.readFileSync(filePath, 'utf8');
            const parsed = dotenv.parse(rawContent);
            const val = parsed[secretName]?.trim();
            if (val) {
                syncHydratedEnvValue(secretName, val);
                return val;
            }
            if (path.basename(filePath) === '.env.local' && secretName === 'GEMINI_API_KEY') {
                const nonCommentLines = rawContent
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0 && !l.startsWith('#'));
                if (
                    nonCommentLines.length === 1 &&
                    !nonCommentLines[0].includes('=') &&
                    nonCommentLines[0].length >= 25
                ) {
                    syncHydratedEnvValue(secretName, nonCommentLines[0]);
                    return nonCommentLines[0];
                }
            }
        } catch {
            // Ignorar errores de lectura local
        }
    }
    return null;
}

async function accessSecretManagerVersion(secretResourceName: string): Promise<string> {
    const client = getSecretManagerClient();
    const accessPromise = client.accessSecretVersion({ name: secretResourceName });
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout Secret Manager (${secretResourceName})`)), 3500)
    );
    const [version] = await Promise.race([accessPromise, timeoutPromise]);
    return version.payload?.data
        ? Buffer.from(version.payload.data as Uint8Array).toString('utf8').trim()
        : '';
}

export async function getSecret(secretName: string): Promise<string | null> {
    if (env.NODE_ENV !== 'production') {
        const hotLocal = readLocalEnvHot(secretName) || process.env[secretName]?.trim();
        if (hotLocal) {
            secretCache.set(secretName, hotLocal);
            failedLookupAt.delete(secretName);
            syncHydratedEnvValue(secretName, hotLocal);
            return hotLocal;
        }
    }

    const cached = secretCache.get(secretName);
    if (cached) return cached;

    const fromEnv = process.env[secretName]?.trim();
    if (fromEnv) {
        secretCache.set(secretName, fromEnv);
        failedLookupAt.delete(secretName);
        syncHydratedEnvValue(secretName, fromEnv);
        return fromEnv;
    }

    if (isRunningAgainstLocalEmulator()) {
        return null;
    }

    const lastFail = failedLookupAt.get(secretName);
    if (lastFail && Date.now() - lastFail < NEGATIVE_CACHE_TTL_MS) {
        return null;
    }

    const location = env.GCP_LOCATION || 'southamerica-west1';
    const candidateNames = [
        `projects/${env.GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`,
        `projects/${env.GCP_PROJECT_ID}/locations/${location}/secrets/${secretName}/versions/latest`,
    ];

    let lastErr: unknown = null;
    for (const resourceName of candidateNames) {
        try {
            const payload = await accessSecretManagerVersion(resourceName);
            if (payload) {
                secretCache.set(secretName, payload);
                failedLookupAt.delete(secretName);
                syncHydratedEnvValue(secretName, payload);
                return payload;
            }
        } catch (err) {
            lastErr = err;
        }
    }

    failedLookupAt.set(secretName, Date.now());
    if (env.NODE_ENV === 'production') {
        const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'Desconocido');
        console.warn(`[SECRET-MANAGER] No se pudo hidratar ${secretName}: ${errMsg}`);
    }

    return null;
}

/**
 * Hidrata los secretos soberanos desde Cloud Secret Manager (`southamerica-west1` / GCP)
 * en el arranque del servidor cuando no se ejecuta en emulador local.
 */
export async function hydrateCoreSecrets(): Promise<void> {
    if (isRunningAgainstLocalEmulator()) {
        for (const name of CORE_HYDRATED_SECRETS) {
            readLocalEnvHot(name);
        }
        return;
    }

    await Promise.all(
        CORE_HYDRATED_SECRETS.map(async (secretName) => {
            await getSecret(secretName);
        })
    );
}

export async function resolveGeminiApiKey(): Promise<string | null> {
    const primary = await getSecret('GEMINI_API_KEY');
    if (primary) return primary;
    const secondary = await getSecret('GOOGLE_API_KEY');
    if (secondary) return secondary;
    return null;
}

export async function resolveResendApiKey(): Promise<string | null> {
    return getSecret('RESEND_API_KEY');
}

export async function resolveSuperAdminPassword(): Promise<string | null> {
    return getSecret('SUPER_ADMIN_PASSWORD');
}

export async function resolveDevRootPassword(): Promise<string | null> {
    return getSecret('DEV_ROOT_PASSWORD');
}

export async function resolveX402HmacSecret(): Promise<string | null> {
    return getSecret('X402_HMAC_SECRET');
}
