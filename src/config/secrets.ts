import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { env, isDevPrivateReleaseStage } from './env';

/**
 * GESTOR SOBERANO DE SECRETOS (Capa 5 MINREPORT — southamerica-west1)
 * Hidrata secretos críticos desde Google Cloud Secret Manager (proyecto GCP / southamerica-west1)
 * cuando el proceso no corre contra emuladores locales, y soporta variables locales (.env.local / .env)
 * en desarrollo/test con recarga en caliente.
 */

export const WHATSAPP_CLOUD_SECRETS = [
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
] as const;

export type WhatsAppSecretName = (typeof WHATSAPP_CLOUD_SECRETS)[number];

export const CORE_HYDRATED_SECRETS = [
    'GEMINI_API_KEY',
    'RESEND_API_KEY',
    'SUPER_ADMIN_PASSWORD',
    'DEV_ROOT_PASSWORD',
    'X402_HMAC_SECRET',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
] as const;

export type CoreSecretName = (typeof CORE_HYDRATED_SECRETS)[number];

let globalSmClient: SecretManagerServiceClient | null = null;
const regionalSmClients = new Map<string, SecretManagerServiceClient>();
const secretCache = new Map<string, string>();
const failedLookupAt = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 60_000;

function getGlobalSecretManagerClient(): SecretManagerServiceClient {
    if (!globalSmClient) {
        globalSmClient = new SecretManagerServiceClient();
    }
    return globalSmClient;
}

function getRegionalSecretManagerClient(location: string): SecretManagerServiceClient {
    const cleanLocation = location.trim() || 'southamerica-west1';
    let client = regionalSmClients.get(cleanLocation);
    if (!client) {
        client = new SecretManagerServiceClient({
            apiEndpoint: `secretmanager.${cleanLocation}.rep.googleapis.com`,
        });
        regionalSmClients.set(cleanLocation, client);
    }
    return client;
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

async function accessSecretManagerVersion(
    secretResourceName: string,
    regionalLocation?: string
): Promise<string> {
    const client = regionalLocation
        ? getRegionalSecretManagerClient(regionalLocation)
        : getGlobalSecretManagerClient();
    const accessPromise = client.accessSecretVersion({ name: secretResourceName });
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout Secret Manager (${secretResourceName})`)), 3500)
    );
    const [version] = await Promise.race([accessPromise, timeoutPromise]);
    return version.payload?.data
        ? Buffer.from(version.payload.data as Uint8Array).toString('utf8').trim()
        : '';
}

const STRICT_E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Parsea una lista CSV de teléfonos ITU-T E.164 (`+[1-9]\d{6,14}`) sin valores hardcodeados.
 */
export function parseE164AllowlistCsv(raw: string | null | undefined): string[] {
    if (!raw || typeof raw !== 'string') return [];
    const normalized = new Set<string>();
    for (const part of raw.split(',')) {
        const compact = part.trim().replace(/[\s().-]/g, '');
        if (STRICT_E164_REGEX.test(compact)) {
            normalized.add(compact);
        }
    }
    return Array.from(normalized);
}

/**
 * Indica de forma síncrona (fail-closed) si el canal WhatsApp DEV está habilitado
 * en etapa `DEV_PRIVATE` mediante `SUPPLY_WHATSAPP_DEV_ENABLED=true` o una allowlist E.164 válida.
 */
export function isSupplyWhatsAppDevEnabled(): boolean {
    if (String(process.env.SUPPLY_WHATSAPP_DEV_ENABLED || '').trim().toLowerCase() === 'true') {
        return true;
    }
    return parseE164AllowlistCsv(process.env.SUPPLY_WHATSAPP_DEV_ALLOWLIST).length > 0;
}

export async function getSecret(
    secretName: string,
    options?: { suppressMissingWarn?: boolean }
): Promise<string | null> {
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

    const location = (env.GCP_LOCATION || 'southamerica-west1').trim() || 'southamerica-west1';
    const candidateLookups: Array<{ resourceName: string; regionalLocation?: string }> = [
        {
            resourceName: `projects/${env.GCP_PROJECT_ID}/locations/${location}/secrets/${secretName}/versions/latest`,
            regionalLocation: location,
        },
        {
            resourceName: `projects/${env.GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`,
        },
    ];

    let lastErr: unknown = null;
    for (const candidate of candidateLookups) {
        try {
            const payload = await accessSecretManagerVersion(
                candidate.resourceName,
                candidate.regionalLocation
            );
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
    if (env.NODE_ENV === 'production' && !options?.suppressMissingWarn) {
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
    if (isDevPrivateReleaseStage()) {
        const devBaseSecrets = [
            'GEMINI_API_KEY',
            'RESEND_API_KEY',
            'DEV_ROOT_PASSWORD',
            'X402_HMAC_SECRET',
            'FIREBASE_API_KEY',
        ] as const;

        if (isRunningAgainstLocalEmulator()) {
            for (const name of devBaseSecrets) {
                readLocalEnvHot(name);
            }
            const devEnabled =
                String(
                    process.env.SUPPLY_WHATSAPP_DEV_ENABLED ||
                        readLocalEnvHot('SUPPLY_WHATSAPP_DEV_ENABLED') ||
                        ''
                )
                    .trim()
                    .toLowerCase() === 'true';
            const devAllowlistRaw =
                process.env.SUPPLY_WHATSAPP_DEV_ALLOWLIST?.trim() ||
                readLocalEnvHot('SUPPLY_WHATSAPP_DEV_ALLOWLIST') ||
                '';
            if (devEnabled || parseE164AllowlistCsv(devAllowlistRaw).length > 0) {
                readLocalEnvHot('SUPPLY_WHATSAPP_DEV_ALLOWLIST');
                for (const name of WHATSAPP_CLOUD_SECRETS) {
                    readLocalEnvHot(name);
                }
            }
            return;
        }

        const [, devAllowlistRaw] = await Promise.all([
            Promise.all(
                devBaseSecrets.map(async (secretName) => {
                    await getSecret(secretName);
                })
            ),
            getSecret('SUPPLY_WHATSAPP_DEV_ALLOWLIST', { suppressMissingWarn: true }).catch(
                () => null
            ),
        ]);

        const devEnabled =
            String(process.env.SUPPLY_WHATSAPP_DEV_ENABLED || '')
                .trim()
                .toLowerCase() === 'true';
        if (devEnabled || parseE164AllowlistCsv(devAllowlistRaw).length > 0) {
            await Promise.all(
                WHATSAPP_CLOUD_SECRETS.map(async (secretName) => {
                    await getSecret(secretName, { suppressMissingWarn: true }).catch(() => null);
                })
            );
        }
        return;
    }

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

export type GeminiKeyProfile =
    | 'DEV_AI_ULTRA_DEDICATED'
    | 'DEV_LOCAL_SHARED'
    | 'PROD_SECRET_MANAGER_GCP'
    | 'VERTEX_AI_ADC'
    | 'UNCONFIGURED';

export async function resolveGeminiApiKey(): Promise<string | null> {
    // En desarrollo / emulador local priorizar GEMINI_DEV_API_KEY (cuenta Google AI Ultra carlos.a.ocayo@gmail.com)
    // para aislar la cuota gratuita de 5.000 búsquedas Grounding/mes del proyecto productivo minreport-8f2a8.
    if (env.NODE_ENV !== 'production' || isRunningAgainstLocalEmulator()) {
        const devDedicated = readLocalEnvHot('GEMINI_DEV_API_KEY') || process.env.GEMINI_DEV_API_KEY?.trim();
        if (devDedicated) return devDedicated;
    }

    const primary = await getSecret('GEMINI_API_KEY');
    if (primary) return primary;
    const secondary = await getSecret('GOOGLE_API_KEY');
    if (secondary) return secondary;
    return null;
}

export async function resolveActiveGeminiKeyProfile(): Promise<GeminiKeyProfile> {
    if (env.NODE_ENV !== 'production' || isRunningAgainstLocalEmulator()) {
        const devDedicated = readLocalEnvHot('GEMINI_DEV_API_KEY') || process.env.GEMINI_DEV_API_KEY?.trim();
        if (devDedicated) return 'DEV_AI_ULTRA_DEDICATED';
        const localShared =
            readLocalEnvHot('GEMINI_API_KEY') ||
            process.env.GEMINI_API_KEY?.trim() ||
            readLocalEnvHot('GOOGLE_API_KEY') ||
            process.env.GOOGLE_API_KEY?.trim();
        if (localShared) return 'DEV_LOCAL_SHARED';
    }
    const prodKey = await getSecret('GEMINI_API_KEY');
    if (prodKey) return 'PROD_SECRET_MANAGER_GCP';
    if (process.env.USE_VERTEX_AI === 'true') return 'VERTEX_AI_ADC';
    return 'UNCONFIGURED';
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

export async function resolveGoogleGeocodingApiKey(): Promise<string | null> {
    try {
        const key = await getSecret('GOOGLE_GEOCODING_API_KEY');
        const trimmed = typeof key === 'string' ? key.trim() : '';
        return trimmed || null;
    } catch {
        return null;
    }
}

export async function resolveWhatsAppAccessToken(): Promise<string | null> {
    return getSecret('WHATSAPP_ACCESS_TOKEN');
}

export async function resolveWhatsAppAppSecret(): Promise<string | null> {
    return getSecret('WHATSAPP_APP_SECRET');
}

export async function resolveWhatsAppVerifyToken(): Promise<string | null> {
    return getSecret('WHATSAPP_VERIFY_TOKEN');
}

export async function resolveWhatsAppPhoneNumberId(): Promise<string | null> {
    return getSecret('WHATSAPP_PHONE_NUMBER_ID');
}

export interface WhatsAppCloudSecretsSnapshot {
    accessToken: string | null;
    appSecret: string | null;
    verifyToken: string | null;
    phoneNumberId: string | null;
    configured: boolean;
}

export async function resolveWhatsAppCloudSecrets(): Promise<WhatsAppCloudSecretsSnapshot> {
    const [accessToken, appSecret, verifyToken, phoneNumberId] = await Promise.all([
        resolveWhatsAppAccessToken(),
        resolveWhatsAppAppSecret(),
        resolveWhatsAppVerifyToken(),
        resolveWhatsAppPhoneNumberId(),
    ]);
    return {
        accessToken,
        appSecret,
        verifyToken,
        phoneNumberId,
        configured: Boolean(accessToken && appSecret && verifyToken && phoneNumberId),
    };
}

/**
 * Resuelve la lista blanca CSV de teléfonos E.164 autorizados para pruebas WhatsApp DEV
 * desde Cloud Secret Manager (`southamerica-west1`) o env local, retornando `[]` si no existe.
 * Nunca hardcodea números telefónicos.
 */
export async function resolveSupplyWhatsAppDevAllowlist(): Promise<string[]> {
    const raw = await getSecret('SUPPLY_WHATSAPP_DEV_ALLOWLIST', { suppressMissingWarn: true });
    return parseE164AllowlistCsv(raw);
}

export async function resolveWhatsAppBusinessAccountId(): Promise<string | null> {
    return getSecret('WHATSAPP_BUSINESS_ACCOUNT_ID', { suppressMissingWarn: true });
}

/**
 * Llave privada RSA PEM para WhatsApp Flows v3.0 (preparado para Etapa E09).
 */
export async function resolveWhatsAppFlowsPrivateKey(): Promise<string | null> {
    const raw = await getSecret('WHATSAPP_FLOWS_PRIVATE_KEY', { suppressMissingWarn: true });
    if (!raw) return null;
    const normalized = raw.replace(/\\n/g, '\n').trim();
    return normalized || null;
}

/**
 * Passphrase opcional de la llave privada RSA para WhatsApp Flows v3.0 (preparado para Etapa E09).
 */
export async function resolveWhatsAppFlowsPassphrase(): Promise<string | null> {
    const raw = await getSecret('WHATSAPP_FLOWS_PASSPHRASE', { suppressMissingWarn: true });
    const trimmed = raw ? raw.trim() : '';
    return trimmed || null;
}
