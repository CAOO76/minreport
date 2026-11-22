import crypto from 'crypto';
import {
    resolveWhatsAppAppSecret,
    resolveWhatsAppFlowsPassphrase,
    resolveWhatsAppFlowsPrivateKey,
} from '../../../config/secrets';
import { constantTimeEqualStrings } from '../../../utils/security';

/**
 * WHATSAPP FLOWS v3.0 CRYPTO ADAPTER (`RSA-2048 OAEP-SHA256 + AES-128/256-GCM`)
 *
 * Implementación estricta de la especificación oficial de Meta WhatsApp Flows Data Endpoint v3.0:
 * - Descifrado de llave simétrica AES mediante `RSA_PKCS1_OAEP_PADDING` con hash `SHA-256`.
 * - Ante fallo de descifrado de llave o autenticación GCM, lanza `WhatsAppFlowCryptoError`
 *   con `statusCode: 421` (código HTTP oficial Meta para refresco automático de clave pública).
 * - Cifrado de respuesta invirtiendo bit a bit el vector de inicialización (`flippedIv[i] = iv[i] ^ 0xff`)
 *   y concatenando `ciphertext + authTag` (16 bytes) en `base64`.
 * - Tokens de flujo `flow_token` firmados con HMAC-SHA256, expiración obligatoria y aislamiento
 *   estricto por `tenantId` / `memberUid` / `siteId` / `flowType`.
 * - Llave privada y passphrase cargadas exclusivamente desde Google Cloud Secret Manager (`southamerica-west1`).
 */

const GCM_AUTH_TAG_LENGTH = 16;
const FLOW_TOKEN_PREFIX = 'mf3';

export type SupplyWhatsAppFlowType =
    | 'OPT_IN'
    | 'CAMP_ORDER'
    | 'RECEPTION_4WAY'
    | 'HITL_APPROVAL';

const ALLOWED_FLOW_TYPES: ReadonlySet<string> = new Set<SupplyWhatsAppFlowType>([
    'OPT_IN',
    'CAMP_ORDER',
    'RECEPTION_4WAY',
    'HITL_APPROVAL',
]);

export interface EncryptedWhatsAppFlowEnvelope {
    encrypted_flow_data: string;
    encrypted_aes_key: string;
    initial_vector: string;
}

export interface DecryptedWhatsAppFlowBody {
    version?: string;
    action: 'ping' | 'INIT' | 'data_exchange' | 'BACK' | string;
    screen?: string;
    data?: Record<string, any>;
    flow_token?: string;
}

export interface DecryptedWhatsAppFlowResult {
    decryptedBody: DecryptedWhatsAppFlowBody;
    aesKeyBuffer: Buffer;
    initialVectorBuffer: Buffer;
}

export interface SignedFlowTokenClaims {
    tenantId: string;
    memberUid: string;
    siteId: string;
    flowType: SupplyWhatsAppFlowType;
    entityId?: string;
    entityKind?: 'REQUISITION' | 'EXPENSE_REPORT' | 'PURCHASE';
    issuedAtMs: number;
    expiresAtMs: number;
    nonce: string;
}

export type CreateSignedFlowTokenInput = Omit<SignedFlowTokenClaims, 'issuedAtMs' | 'nonce'> & {
    issuedAtMs?: number;
    nonce?: string;
};

export class WhatsAppFlowCryptoError extends Error {
    public readonly statusCode: number;
    public readonly code: string;

    constructor(
        message: string,
        statusCode: number = 421,
        code: string = 'WHATSAPP_FLOW_CRYPTO_ERROR'
    ) {
        super(message);
        this.name = 'WhatsAppFlowCryptoError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export class WhatsAppFlowTokenError extends Error {
    public readonly statusCode: number;
    public readonly code: 'FLOW_TOKEN_INVALID' | 'FLOW_TOKEN_EXPIRED';

    constructor(
        message: string,
        code: 'FLOW_TOKEN_INVALID' | 'FLOW_TOKEN_EXPIRED' = 'FLOW_TOKEN_INVALID',
        statusCode: number = 401
    ) {
        super(message);
        this.name = 'WhatsAppFlowTokenError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function resolveAesGcmAlgorithm(aesKeyBuffer: Buffer): 'aes-128-gcm' | 'aes-256-gcm' {
    if (aesKeyBuffer.length === 16) return 'aes-128-gcm';
    if (aesKeyBuffer.length === 32) return 'aes-256-gcm';
    throw new WhatsAppFlowCryptoError(
        `Longitud de llave AES no soportada (${aesKeyBuffer.length} bytes; se requiere 16 o 32 bytes).`,
        421,
        'FLOW_INVALID_AES_KEY_LENGTH'
    );
}

function decodeBase64Strict(raw: unknown, fieldName: string): Buffer {
    if (typeof raw !== 'string') {
        throw new WhatsAppFlowCryptoError(
            `Campo cifrado obligatorio ausente o inválido: ${fieldName}.`,
            421,
            'FLOW_MALFORMED_ENVELOPE'
        );
    }
    const clean = raw.trim();
    if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 === 1) {
        throw new WhatsAppFlowCryptoError(
            `Codificación base64 inválida en ${fieldName}.`,
            421,
            'FLOW_MALFORMED_BASE64'
        );
    }
    const buf = Buffer.from(clean, 'base64');
    if (buf.length === 0) {
        throw new WhatsAppFlowCryptoError(
            `Buffer vacío tras decodificar ${fieldName}.`,
            421,
            'FLOW_EMPTY_BUFFER'
        );
    }
    return buf;
}

/**
 * Descifra un sobre entrante de Meta WhatsApp Flows v3.0 (`RSA-OAEP-SHA256` + `AES-128/256-GCM`).
 * Cualquier fallo de llave privada o autenticación GCM dispara `WhatsAppFlowCryptoError(421)`.
 */
export function decryptFlowRequest(
    envelope: EncryptedWhatsAppFlowEnvelope,
    privateKeyPem: string,
    passphrase?: string | null
): DecryptedWhatsAppFlowResult {
    const cleanPrivateKey = String(privateKeyPem || '').trim();
    if (!cleanPrivateKey) {
        throw new WhatsAppFlowCryptoError(
            'WHATSAPP_FLOWS_PRIVATE_KEY no configurada en Secret Manager.',
            421,
            'FLOW_PRIVATE_KEY_MISSING'
        );
    }

    const encryptedAesKeyBuffer = decodeBase64Strict(envelope?.encrypted_aes_key, 'encrypted_aes_key');
    const encryptedFlowDataBuffer = decodeBase64Strict(envelope?.encrypted_flow_data, 'encrypted_flow_data');
    const initialVectorBuffer = decodeBase64Strict(envelope?.initial_vector, 'initial_vector');

    if (initialVectorBuffer.length < 12 || initialVectorBuffer.length > 16) {
        throw new WhatsAppFlowCryptoError(
            `Vector de inicialización IV con longitud inválida (${initialVectorBuffer.length} bytes).`,
            421,
            'FLOW_INVALID_IV_LENGTH'
        );
    }

    if (encryptedFlowDataBuffer.length <= GCM_AUTH_TAG_LENGTH) {
        throw new WhatsAppFlowCryptoError(
            'Payload cifrado insuficiente para contener ciphertext y authTag GCM (16 bytes).',
            421,
            'FLOW_MALFORMED_CIPHERTEXT'
        );
    }

    let aesKeyBuffer: Buffer;
    try {
        const keyInput: crypto.RsaPrivateKey = {
            key: cleanPrivateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
            ...(passphrase ? { passphrase } : {}),
        };
        aesKeyBuffer = crypto.privateDecrypt(keyInput, encryptedAesKeyBuffer);
    } catch {
        throw new WhatsAppFlowCryptoError(
            'No se pudo descifrar encrypted_aes_key con la llave privada RSA vigente (requiere refresco de clave pública Meta).',
            421,
            'FLOW_RSA_DECRYPT_FAILED'
        );
    }

    const cipherAlgorithm = resolveAesGcmAlgorithm(aesKeyBuffer);
    const ciphertext = encryptedFlowDataBuffer.subarray(
        0,
        encryptedFlowDataBuffer.length - GCM_AUTH_TAG_LENGTH
    );
    const authTag = encryptedFlowDataBuffer.subarray(
        encryptedFlowDataBuffer.length - GCM_AUTH_TAG_LENGTH
    );

    let plaintextUtf8: string;
    try {
        const decipher = crypto.createDecipheriv(cipherAlgorithm, aesKeyBuffer, initialVectorBuffer);
        decipher.setAuthTag(authTag);
        plaintextUtf8 = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        throw new WhatsAppFlowCryptoError(
            'Fallo de verificación criptográfica AES-GCM al descifrar encrypted_flow_data.',
            421,
            'FLOW_AES_DECRYPT_FAILED'
        );
    }

    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(plaintextUtf8);
    } catch {
        throw new WhatsAppFlowCryptoError(
            'El cuerpo descifrado de WhatsApp Flow no es un objeto JSON válido.',
            421,
            'FLOW_INVALID_JSON_BODY'
        );
    }

    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        throw new WhatsAppFlowCryptoError(
            'El cuerpo descifrado de WhatsApp Flow debe ser un objeto JSON.',
            421,
            'FLOW_INVALID_JSON_BODY'
        );
    }

    return {
        decryptedBody: parsedBody as DecryptedWhatsAppFlowBody,
        aesKeyBuffer,
        initialVectorBuffer,
    };
}

/**
 * Cifra la respuesta de Meta WhatsApp Flows v3.0 usando el IV invertido bit a bit (`iv ^ 0xff`)
 * y concatenando `ciphertext + authTag` (16 bytes) en `base64`.
 */
export function encryptFlowResponse(
    responsePayload: Record<string, unknown>,
    aesKeyBuffer: Buffer,
    initialVectorBuffer: Buffer
): string {
    if (!Buffer.isBuffer(aesKeyBuffer) || !Buffer.isBuffer(initialVectorBuffer)) {
        throw new WhatsAppFlowCryptoError(
            'Se requieren Buffers válidos de llave AES e IV para cifrar la respuesta del Flow.',
            421,
            'FLOW_RESPONSE_CRYPTO_INVALID'
        );
    }
    if (initialVectorBuffer.length < 12 || initialVectorBuffer.length > 16) {
        throw new WhatsAppFlowCryptoError(
            'Longitud de IV inválida para cifrado de respuesta del Flow.',
            421,
            'FLOW_INVALID_IV_LENGTH'
        );
    }

    const cipherAlgorithm = resolveAesGcmAlgorithm(aesKeyBuffer);
    const flippedIv = Buffer.allocUnsafe(initialVectorBuffer.length);
    for (let i = 0; i < initialVectorBuffer.length; i++) {
        flippedIv[i] = initialVectorBuffer[i] ^ 0xff;
    }

    const cipher = crypto.createCipheriv(cipherAlgorithm, aesKeyBuffer, flippedIv);
    const plaintext = Buffer.from(JSON.stringify(responsePayload), 'utf8');
    const encryptedBody = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([encryptedBody, authTag]).toString('base64');
}

/**
 * Emite un `flow_token` firmado HMAC-SHA256 con expiración y contexto multi-tenant inmutable
 * para prevenir suplantación cross-tenant o reutilización de sesiones de Flows.
 */
export function createSignedFlowToken(
    claims: CreateSignedFlowTokenInput,
    secret: string
): string {
    const cleanSecret = String(secret || '').trim();
    if (!cleanSecret) {
        throw new Error('Secreto HMAC requerido para emitir flow_token firmado.');
    }
    const tenantId = String(claims.tenantId || '').trim();
    const memberUid = String(claims.memberUid || '').trim();
    const siteId = String(claims.siteId || '').trim();
    if (!tenantId || !memberUid || !siteId) {
        throw new Error('flow_token requiere tenantId, memberUid y siteId no vacíos.');
    }
    if (!ALLOWED_FLOW_TYPES.has(claims.flowType)) {
        throw new Error(`Tipo de flow no soportado: ${String(claims.flowType)}.`);
    }
    if (!Number.isFinite(claims.expiresAtMs) || claims.expiresAtMs <= 0) {
        throw new Error('flow_token requiere expiresAtMs válido.');
    }

    const payload: SignedFlowTokenClaims = {
        tenantId,
        memberUid,
        siteId,
        flowType: claims.flowType,
        ...(claims.entityId ? { entityId: String(claims.entityId).trim() } : {}),
        ...(claims.entityKind ? { entityKind: claims.entityKind } : {}),
        issuedAtMs:
            typeof claims.issuedAtMs === 'number' && Number.isFinite(claims.issuedAtMs)
                ? claims.issuedAtMs
                : Date.now(),
        expiresAtMs: claims.expiresAtMs,
        nonce: claims.nonce?.trim() || crypto.randomBytes(8).toString('hex'),
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sigB64 = crypto
        .createHmac('sha256', cleanSecret)
        .update(`${FLOW_TOKEN_PREFIX}.${payloadB64}`)
        .digest('base64url');

    return `${FLOW_TOKEN_PREFIX}.${payloadB64}.${sigB64}`;
}

/**
 * Verifica criptográficamente (en tiempo constante) y valida vigencia de un `flow_token` firmado.
 */
export function verifySignedFlowToken(
    token: string | undefined | null,
    secret: string,
    nowMs: number = Date.now()
): SignedFlowTokenClaims {
    const cleanSecret = String(secret || '').trim();
    const cleanToken = String(token || '').trim();
    if (!cleanSecret || !cleanToken) {
        throw new WhatsAppFlowTokenError(
            'flow_token ausente o secreto de verificación no disponible.',
            'FLOW_TOKEN_INVALID'
        );
    }

    const parts = cleanToken.split('.');
    if (parts.length !== 3 || parts[0] !== FLOW_TOKEN_PREFIX || !parts[1] || !parts[2]) {
        throw new WhatsAppFlowTokenError('Formato de flow_token inválido.', 'FLOW_TOKEN_INVALID');
    }

    const [, payloadB64, candidateSig] = parts;
    const expectedSig = crypto
        .createHmac('sha256', cleanSecret)
        .update(`${FLOW_TOKEN_PREFIX}.${payloadB64}`)
        .digest('base64url');

    if (!constantTimeEqualStrings(candidateSig, expectedSig)) {
        throw new WhatsAppFlowTokenError(
            'Firma HMAC-SHA256 de flow_token inválida o manipulada.',
            'FLOW_TOKEN_INVALID'
        );
    }

    let parsed: any;
    try {
        const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
        parsed = JSON.parse(jsonStr);
    } catch {
        throw new WhatsAppFlowTokenError('Carga útil de flow_token corrupta.', 'FLOW_TOKEN_INVALID');
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.tenantId !== 'string' ||
        !parsed.tenantId.trim() ||
        typeof parsed.memberUid !== 'string' ||
        !parsed.memberUid.trim() ||
        typeof parsed.siteId !== 'string' ||
        !parsed.siteId.trim() ||
        typeof parsed.flowType !== 'string' ||
        !ALLOWED_FLOW_TYPES.has(parsed.flowType) ||
        typeof parsed.expiresAtMs !== 'number' ||
        !Number.isFinite(parsed.expiresAtMs)
    ) {
        throw new WhatsAppFlowTokenError(
            'Claims obligatorios faltantes o inválidos en flow_token.',
            'FLOW_TOKEN_INVALID'
        );
    }

    if (nowMs > parsed.expiresAtMs) {
        throw new WhatsAppFlowTokenError(
            'El flow_token ha expirado; solicite una nueva interacción en WhatsApp.',
            'FLOW_TOKEN_EXPIRED'
        );
    }

    return {
        tenantId: parsed.tenantId.trim(),
        memberUid: parsed.memberUid.trim(),
        siteId: parsed.siteId.trim(),
        flowType: parsed.flowType as SupplyWhatsAppFlowType,
        ...(typeof parsed.entityId === 'string' && parsed.entityId.trim()
            ? { entityId: parsed.entityId.trim() }
            : {}),
        ...(parsed.entityKind === 'REQUISITION' ||
        parsed.entityKind === 'EXPENSE_REPORT' ||
        parsed.entityKind === 'PURCHASE'
            ? { entityKind: parsed.entityKind }
            : {}),
        issuedAtMs:
            typeof parsed.issuedAtMs === 'number' && Number.isFinite(parsed.issuedAtMs)
                ? parsed.issuedAtMs
                : 0,
        expiresAtMs: parsed.expiresAtMs,
        nonce: typeof parsed.nonce === 'string' ? parsed.nonce : '',
    };
}

/**
 * Resuelve llave privada RSA y passphrase opcional exclusivamente desde Google Cloud Secret Manager
 * (`southamerica-west1`, nunca hardcodeadas).
 */
export async function resolveFlowsPrivateKeyMaterial(): Promise<{
    privateKeyPem: string | null;
    passphrase: string | null;
}> {
    const [privateKeyPem, passphrase] = await Promise.all([
        resolveWhatsAppFlowsPrivateKey(),
        resolveWhatsAppFlowsPassphrase(),
    ]);
    return { privateKeyPem, passphrase };
}

/**
 * Resuelve el secreto HMAC para firma/verificación de `flow_token` desde Secret Manager (`southamerica-west1`).
 */
export async function resolveFlowTokenSigningSecret(): Promise<string | null> {
    const appSecret = await resolveWhatsAppAppSecret().catch(() => null);
    return appSecret?.trim() || null;
}

export const WhatsAppFlowsCrypto = {
    decryptFlowRequest,
    encryptFlowResponse,
    createSignedFlowToken,
    verifySignedFlowToken,
    resolveFlowsPrivateKeyMaterial,
    resolveFlowTokenSigningSecret,
};
