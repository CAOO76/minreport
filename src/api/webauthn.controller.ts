import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { auth, db } from '../config/firebase';
import { env } from '../config/env';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { authRateLimiter, extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { constantTimeEqualStrings } from '../utils/security';
import { getRutVariants, cleanRut } from '../utils/rut';

/**
 * CONTROLADOR SOBERANO DE IDENTIDAD BIOMÉTRICA WEB 3.0 (Passkeys / WebAuthn FIDO2)
 *
 * Implementación nativa en Node.js 20 (`crypto`) sin dependencias externas frágiles:
 * - Decodificación RFC 8949 CBOR/COSE mínima para claves P-256 ECDSA (`alg: -7`) y RS256 (`alg: -257`),
 *   más soporte directo de SubjectPublicKeyInfo (`publicKeySpkiBase64` de `response.getPublicKey()`).
 * - Verificación estricta de `clientDataJSON`, `origin` en lista blanca, `rpIdHash` (SHA-256),
 *   flag User Present (`UP`), contador `signCount` anti-clonación y firma criptográfica real.
 */

export const webauthnRouter = Router();

const CHALLENGES_COLLECTION = 'webauthn_challenges';
const CREDENTIALS_COLLECTION = 'webauthn_credentials';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function getAllowedWebAuthnOrigins(): Set<string> {
    const origins = new Set<string>([
        'https://minreport-access.web.app',
        'https://minreport-8f2a8.web.app',
        'https://minreport-8f2a8.firebaseapp.com',
        'capacitor://localhost',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ]);
    const configuredWeb = (env.WEB_URL || process.env.WEB_URL || '').trim().replace(/\/+$/, '');
    if (configuredWeb) {
        origins.add(configuredWeb);
    }
    return origins;
}

function resolveRpIdForRequest(req: Request): string {
    const explicit = (env.WEBAUTHN_RP_ID || process.env.WEBAUTHN_RP_ID || '').trim();
    if (explicit) return explicit;

    const originHeader = String(req.headers.origin || '').trim().replace(/\/+$/, '');
    const allowed = getAllowedWebAuthnOrigins();
    if (originHeader && allowed.has(originHeader)) {
        try {
            const parsed = new URL(originHeader);
            if (parsed.hostname) return parsed.hostname;
        } catch {
            // Usar fallback determinista
        }
    }

    return env.NODE_ENV === 'production' ? 'minreport-access.web.app' : 'localhost';
}

function toBase64Url(buf: Buffer): string {
    return buf.toString('base64url');
}

function fromBase64Url(input: string): Buffer {
    const trimmed = input.trim();
    const padded = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64');
}

function sha256Buffer(data: Buffer | string): Buffer {
    return crypto.createHash('sha256').update(data).digest();
}

// ============================================================================
// DECODIFICADOR MÍNIMO RFC 8949 CBOR PARA ATTESTATION OBJECT & COSE_KEY
// ============================================================================

interface CborDecodeResult {
    value: any;
    offset: number;
}

function readCborUint(buf: Buffer, offset: number, additionalInfo: number): { val: number; offset: number } {
    if (additionalInfo < 24) {
        return { val: additionalInfo, offset };
    }
    if (additionalInfo === 24) {
        if (offset + 1 > buf.length) throw new Error('CBOR truncado (uint8)');
        return { val: buf.readUInt8(offset), offset: offset + 1 };
    }
    if (additionalInfo === 25) {
        if (offset + 2 > buf.length) throw new Error('CBOR truncado (uint16)');
        return { val: buf.readUInt16BE(offset), offset: offset + 2 };
    }
    if (additionalInfo === 26) {
        if (offset + 4 > buf.length) throw new Error('CBOR truncado (uint32)');
        return { val: buf.readUInt32BE(offset), offset: offset + 4 };
    }
    if (additionalInfo === 27) {
        if (offset + 8 > buf.length) throw new Error('CBOR truncado (uint64)');
        const big = buf.readBigUInt64BE(offset);
        return { val: Number(big), offset: offset + 8 };
    }
    throw new Error(`Información adicional CBOR no soportada: ${additionalInfo}`);
}

function decodeCborItem(buf: Buffer, startOffset: number = 0, depth: number = 0): CborDecodeResult {
    if (depth > 16) throw new Error('Profundidad máxima CBOR excedida');
    if (startOffset >= buf.length) throw new Error('Buffer CBOR inesperado al final');

    const initialByte = buf[startOffset];
    const majorType = initialByte >> 5;
    const additionalInfo = initialByte & 0x1f;
    let offset = startOffset + 1;

    if (majorType === 0) {
        const { val, offset: next } = readCborUint(buf, offset, additionalInfo);
        return { value: val, offset: next };
    }

    if (majorType === 1) {
        const { val, offset: next } = readCborUint(buf, offset, additionalInfo);
        return { value: -1 - val, offset: next };
    }

    if (majorType === 2) {
        const { val: len, offset: next } = readCborUint(buf, offset, additionalInfo);
        if (next + len > buf.length) throw new Error('CBOR byte string fuera de límites');
        return { value: buf.subarray(next, next + len), offset: next + len };
    }

    if (majorType === 3) {
        const { val: len, offset: next } = readCborUint(buf, offset, additionalInfo);
        if (next + len > buf.length) throw new Error('CBOR text string fuera de límites');
        return { value: buf.subarray(next, next + len).toString('utf8'), offset: next + len };
    }

    if (majorType === 4) {
        const { val: count, offset: next } = readCborUint(buf, offset, additionalInfo);
        if (count > 2048) throw new Error('Arreglo CBOR excede límite seguro');
        const arr: any[] = [];
        let cursor = next;
        for (let i = 0; i < count; i++) {
            const item = decodeCborItem(buf, cursor, depth + 1);
            arr.push(item.value);
            cursor = item.offset;
        }
        return { value: arr, offset: cursor };
    }

    if (majorType === 5) {
        const { val: pairs, offset: next } = readCborUint(buf, offset, additionalInfo);
        if (pairs > 512) throw new Error('Mapa CBOR excede límite seguro');
        const map = new Map<any, any>();
        let cursor = next;
        for (let i = 0; i < pairs; i++) {
            const k = decodeCborItem(buf, cursor, depth + 1);
            const v = decodeCborItem(buf, k.offset, depth + 1);
            map.set(k.value, v.value);
            cursor = v.offset;
        }
        return { value: map, offset: cursor };
    }

    if (majorType === 6) {
        const { offset: next } = readCborUint(buf, offset, additionalInfo);
        return decodeCborItem(buf, next, depth + 1);
    }

    if (majorType === 7) {
        if (additionalInfo === 20) return { value: false, offset };
        if (additionalInfo === 21) return { value: true, offset };
        if (additionalInfo === 22 || additionalInfo === 23) return { value: null, offset };
        throw new Error(`Tipo simple CBOR no soportado: ${additionalInfo}`);
    }

    throw new Error(`Major type CBOR desconocido: ${majorType}`);
}

/**
 * Convierte un mapa COSE_Key (P-256 `-7` o RS256 `-257`) en SubjectPublicKeyInfo DER Base64.
 */
function cosePublicKeyToSpki(coseMap: Map<any, any>): { spkiBase64: string; coseAlg: number } {
    const kty = coseMap.get(1);
    const alg = Number(coseMap.get(3));

    // EC2 P-256 (kty=2, alg=-7, crv=1)
    if (kty === 2 && (alg === -7 || Number.isNaN(alg))) {
        const crv = coseMap.get(-1);
        const x = coseMap.get(-2);
        const y = coseMap.get(-3);
        if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
            throw new Error('COSE EC2 key inválida: se requiere curva P-256 con coordenadas de 32 bytes.');
        }
        const pubKeyObj = crypto.createPublicKey({
            key: {
                kty: 'EC',
                crv: 'P-256',
                x: toBase64Url(x),
                y: toBase64Url(y),
            },
            format: 'jwk',
        });
        const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
        return { spkiBase64: spkiDer.toString('base64'), coseAlg: -7 };
    }

    // RSA RS256 (kty=3, alg=-257)
    if (kty === 3 && (alg === -257 || Number.isNaN(alg))) {
        const n = coseMap.get(-1);
        const e = coseMap.get(-2);
        if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || e.length < 1) {
            throw new Error('COSE RSA key inválida: módulo mínimo 2048 bits requerido.');
        }
        const pubKeyObj = crypto.createPublicKey({
            key: {
                kty: 'RSA',
                n: toBase64Url(n),
                e: toBase64Url(e),
            },
            format: 'jwk',
        });
        const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
        return { spkiBase64: spkiDer.toString('base64'), coseAlg: -257 };
    }

    throw new Error(`Algoritmo o tipo COSE_Key no soportado (kty=${kty}, alg=${alg}).`);
}

interface ParsedAuthenticatorData {
    rpIdHash: Buffer;
    flags: number;
    userPresent: boolean;
    userVerified: boolean;
    attestedCredentialDataPresent: boolean;
    signCount: number;
    credentialIdBase64Url?: string;
    cosePublicKeySpkiBase64?: string;
    coseAlg?: number;
}

function parseAuthenticatorData(authDataBuf: Buffer): ParsedAuthenticatorData {
    if (authDataBuf.length < 37) {
        throw new Error('authenticatorData demasiado corto (< 37 bytes).');
    }

    const rpIdHash = authDataBuf.subarray(0, 32);
    const flags = authDataBuf.readUInt8(32);
    const signCount = authDataBuf.readUInt32BE(33);

    const userPresent = (flags & 0x01) !== 0;
    const userVerified = (flags & 0x04) !== 0;
    const attestedCredentialDataPresent = (flags & 0x40) !== 0;

    const result: ParsedAuthenticatorData = {
        rpIdHash,
        flags,
        userPresent,
        userVerified,
        attestedCredentialDataPresent,
        signCount,
    };

    if (attestedCredentialDataPresent) {
        if (authDataBuf.length < 55) {
            throw new Error('attestedCredentialData truncado en authenticatorData.');
        }
        // Bytes 37..52 = AAGUID (16 bytes), Bytes 53..54 = credentialIdLength (UInt16BE)
        const credIdLen = authDataBuf.readUInt16BE(53);
        const credIdStart = 55;
        const credIdEnd = credIdStart + credIdLen;
        if (credIdEnd > authDataBuf.length) {
            throw new Error('credentialId excede longitud de authenticatorData.');
        }

        const credIdBuf = authDataBuf.subarray(credIdStart, credIdEnd);
        result.credentialIdBase64Url = toBase64Url(credIdBuf);

        if (credIdEnd < authDataBuf.length) {
            const decodedCose = decodeCborItem(authDataBuf, credIdEnd);
            if (decodedCose.value instanceof Map) {
                const converted = cosePublicKeyToSpki(decodedCose.value);
                result.cosePublicKeySpkiBase64 = converted.spkiBase64;
                result.coseAlg = converted.coseAlg;
            }
        }
    }

    return result;
}

function verifyClientDataJson(params: {
    clientDataBuf: Buffer;
    expectedType: 'webauthn.create' | 'webauthn.get';
    expectedChallenge: string;
}): { origin: string } {
    const parsed = JSON.parse(params.clientDataBuf.toString('utf8'));
    if (parsed?.type !== params.expectedType) {
        throw new Error(`clientDataJSON.type inválido: se esperaba ${params.expectedType}.`);
    }
    if (typeof parsed?.challenge !== 'string' || !constantTimeEqualStrings(parsed.challenge, params.expectedChallenge)) {
        throw new Error('El challenge de clientDataJSON no coincide con el desafío activo.');
    }
    const origin = String(parsed?.origin || '').trim().replace(/\/+$/, '');
    const allowedOrigins = getAllowedWebAuthnOrigins();
    if (!origin || !allowedOrigins.has(origin)) {
        throw new Error(`Origen WebAuthn no autorizado: ${origin || 'vacío'}`);
    }
    return { origin };
}

// ============================================================================
// 1. POST /register-options (Autenticado)
// ============================================================================
const registerOptionsBodySchema = z.object({
    deviceLabel: z.string().max(80).optional(),
});

webauthnRouter.post('/register-options', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const parsedBody = registerOptionsBodySchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'Parámetros inválidos' });
        }

        const uid = String(req.user?.uid || '');
        const email = String(req.user?.email || `${uid}@minreport.local`).toLowerCase();
        const displayName = String(req.user?.name || req.user?.email || 'Operador MINREPORT');

        const rpId = resolveRpIdForRequest(req);
        const challenge = toBase64Url(crypto.randomBytes(32));
        const challengeId = crypto.randomUUID();
        const now = Date.now();

        const existingCredsSnap = await db
            .collection(CREDENTIALS_COLLECTION)
            .where('uid', '==', uid)
            .get();

        const excludeCredentials = existingCredsSnap.docs.map((doc) => ({
            id: doc.id,
            type: 'public-key' as const,
        }));

        await db.collection(CHALLENGES_COLLECTION).doc(challengeId).set({
            id: challengeId,
            purpose: 'REGISTER',
            uid,
            email,
            rpId,
            challenge,
            createdAt: now,
            expiresAt: now + CHALLENGE_TTL_MS,
            used: false,
        });

        return res.status(200).json({
            challengeId,
            options: {
                rp: {
                    name: env.WEBAUTHN_RP_NAME || 'MINREPORT',
                    id: rpId,
                },
                user: {
                    id: toBase64Url(Buffer.from(uid, 'utf8')),
                    name: email,
                    displayName,
                },
                challenge,
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' },
                    { alg: -257, type: 'public-key' },
                ],
                timeout: 60000,
                attestation: 'none',
                excludeCredentials,
                authenticatorSelection: {
                    residentKey: 'preferred',
                    userVerification: 'preferred',
                },
            },
        });
    } catch (error: any) {
        console.error('[WEBAUTHN] Error generando register-options:', error);
        return res.status(500).json({ error: 'Fallo al generar opciones de registro Passkey.' });
    }
});

// ============================================================================
// 2. POST /register-verify (Autenticado)
// ============================================================================
const registerVerifySchema = z.object({
    challengeId: z.string().uuid(),
    credentialId: z.string().min(8).max(512).regex(/^[A-Za-z0-9_-]+$/),
    clientDataJSON: z.string().min(16).max(8192),
    authenticatorData: z.string().min(32).max(16384).optional(),
    attestationObject: z.string().min(32).max(32768).optional(),
    publicKeySpkiBase64: z.string().min(32).max(4096).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    transports: z.array(z.string().max(32)).max(8).optional(),
    deviceLabel: z.string().min(1).max(80).optional(),
});

webauthnRouter.post('/register-verify', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const parsed = registerVerifySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload WebAuthn inválido', details: parsed.error.format() });
        }

        const data = parsed.data;
        const uid = String(req.user?.uid || '');
        const email = String(req.user?.email || '').toLowerCase();

        const challengeRef = db.collection(CHALLENGES_COLLECTION).doc(data.challengeId);
        const challengeSnap = await challengeRef.get();

        if (!challengeSnap.exists) {
            return res.status(400).json({ error: 'Desafío WebAuthn inexistente o expirado.' });
        }

        const chData = challengeSnap.data()!;
        if (chData.used || chData.purpose !== 'REGISTER' || chData.uid !== uid || Date.now() > chData.expiresAt) {
            await challengeRef.update({ used: true }).catch(() => {});
            return res.status(400).json({ error: 'Desafío WebAuthn inválido, expirado o ya utilizado.' });
        }

        await challengeRef.update({ used: true, usedAt: Date.now() });

        const clientDataBuf = fromBase64Url(data.clientDataJSON);
        verifyClientDataJson({
            clientDataBuf,
            expectedType: 'webauthn.create',
            expectedChallenge: String(chData.challenge),
        });

        let authDataBuf: Buffer | null = null;
        if (data.authenticatorData) {
            authDataBuf = fromBase64Url(data.authenticatorData);
        } else if (data.attestationObject) {
            const attBuf = fromBase64Url(data.attestationObject);
            const decodedAtt = decodeCborItem(attBuf, 0);
            if (decodedAtt.value instanceof Map && Buffer.isBuffer(decodedAtt.value.get('authData'))) {
                authDataBuf = decodedAtt.value.get('authData');
            }
        }

        if (!authDataBuf) {
            return res.status(400).json({ error: 'Se requiere authenticatorData o attestationObject válido.' });
        }

        const parsedAuthData = parseAuthenticatorData(authDataBuf);
        const expectedRpIdHash = sha256Buffer(String(chData.rpId));

        if (!crypto.timingSafeEqual(parsedAuthData.rpIdHash, expectedRpIdHash)) {
            return res.status(400).json({ error: 'rpIdHash inválido para este dominio.' });
        }

        if (!parsedAuthData.userPresent) {
            return res.status(400).json({ error: 'Presencia física del usuario (flag UP) no verificada.' });
        }

        if (
            parsedAuthData.credentialIdBase64Url &&
            parsedAuthData.credentialIdBase64Url !== data.credentialId
        ) {
            return res.status(400).json({ error: 'Inconsistencia entre credentialId y attestedCredentialData.' });
        }

        let spkiBase64 = parsedAuthData.cosePublicKeySpkiBase64 || '';
        let coseAlg = parsedAuthData.coseAlg || data.publicKeyAlgorithm || -7;

        if (!spkiBase64 && data.publicKeySpkiBase64) {
            const rawSpki = Buffer.from(
                data.publicKeySpkiBase64.trim().replace(/-/g, '+').replace(/_/g, '/'),
                'base64'
            );
            // Validar que Node crypto pueda importar la clave pública SPKI y sea EC P-256 o RSA >= 2048
            const importedKey = crypto.createPublicKey({ key: rawSpki, format: 'der', type: 'spki' });
            if (importedKey.asymmetricKeyType !== 'ec' && importedKey.asymmetricKeyType !== 'rsa') {
                return res.status(400).json({ error: 'Tipo de clave pública SPKI no permitido (solo EC P-256 o RSA).' });
            }
            coseAlg = importedKey.asymmetricKeyType === 'rsa' ? -257 : -7;
            spkiBase64 = (importedKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
        }

        if (!spkiBase64) {
            return res.status(400).json({
                error: 'No fue posible extraer la clave pública FIDO2 (envíe attestationObject o publicKeySpkiBase64).',
            });
        }

        const credRef = db.collection(CREDENTIALS_COLLECTION).doc(data.credentialId);
        const existingCred = await credRef.get();
        if (existingCred.exists) {
            return res.status(409).json({ error: 'Esta credencial Passkey ya se encuentra registrada.' });
        }

        const now = Date.now();
        const deviceLabel = (data.deviceLabel || 'Llave Biométrica FIDO2').trim();

        await credRef.set({
            credentialId: data.credentialId,
            uid,
            email,
            publicKeySpkiBase64: spkiBase64,
            coseAlg,
            rpId: String(chData.rpId),
            signCount: parsedAuthData.signCount,
            transports: data.transports || ['internal', 'hybrid'],
            deviceLabel,
            createdAt: now,
            lastUsedAt: null,
            status: 'ACTIVE',
        });

        await AuditLedger.record({
            tenantId: String(req.user?.activeAccountId || 'global-identity'),
            actorUid: uid,
            actorEmail: email || `${uid}@minreport.local`,
            action: 'WEBAUTHN_PASSKEY_REGISTERED',
            module: 'auth',
            targetEntity: data.credentialId,
            details: {
                deviceLabel,
                coseAlg,
                rpId: chData.rpId,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({
            success: true,
            credential: {
                credentialId: data.credentialId,
                deviceLabel,
                createdAt: now,
            },
        });
    } catch (error: any) {
        console.error('[WEBAUTHN] Error en register-verify:', error);
        return res.status(400).json({ error: error?.message || 'Verificación de registro Passkey rechazada.' });
    }
});

// ============================================================================
// 3. POST /login-options (Público con authRateLimiter)
// ============================================================================
const loginOptionsSchema = z.object({
    identifier: z.string().max(160).optional(),
    accountId: z.string().max(128).optional(),
});

async function resolveUidByIdentifier(identifier: string, accountId?: string): Promise<string | null> {
    const clean = identifier.trim();
    if (!clean) return null;

    if (clean.includes('@')) {
        try {
            const userRecord = await auth.getUserByEmail(clean.toLowerCase());
            return userRecord.uid;
        } catch {
            const snap = await db.collection('users').where('email', '==', clean.toLowerCase()).limit(1).get();
            if (!snap.empty) return snap.docs[0].id;
            return null;
        }
    }

    const variants = getRutVariants(cleanRut(clean));
    for (const variant of variants) {
        const dirSnap = await db.collection('user_directory').doc(variant).get();
        if (dirSnap.exists) {
            const dirData = dirSnap.data() || {};
            const accounts = Array.isArray(dirData.accounts) ? dirData.accounts : [];
            const matchedEntry = accountId
                ? accounts.find((a: any) => a.accountId === accountId)
                : accounts[0];
            if (matchedEntry?.uid) return String(matchedEntry.uid);
            if (dirData.uid) return String(dirData.uid);
            if (matchedEntry?.authEmail) {
                try {
                    const ur = await auth.getUserByEmail(String(matchedEntry.authEmail).toLowerCase());
                    return ur.uid;
                } catch {
                    // Continuar con búsqueda
                }
            }
        }
    }

    const directSnap = await db.collection('users').doc(cleanRut(clean)).get();
    if (directSnap.exists) return directSnap.id;

    return null;
}

webauthnRouter.post('/login-options', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const parsed = loginOptionsSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'Formato de solicitud inválido' });
        }

        const rpId = resolveRpIdForRequest(req);
        const challenge = toBase64Url(crypto.randomBytes(32));
        const challengeId = crypto.randomUUID();
        const now = Date.now();

        let allowCredentials: Array<{ id: string; type: 'public-key'; transports?: string[] }> = [];
        let resolvedUid: string | null = null;

        if (parsed.data.identifier) {
            resolvedUid = await resolveUidByIdentifier(parsed.data.identifier, parsed.data.accountId);
            if (resolvedUid) {
                const credsSnap = await db
                    .collection(CREDENTIALS_COLLECTION)
                    .where('uid', '==', resolvedUid)
                    .get();

                allowCredentials = credsSnap.docs
                    .filter((d) => d.data()?.status !== 'REVOKED')
                    .map((d) => ({
                        id: d.id,
                        type: 'public-key' as const,
                        transports: Array.isArray(d.data()?.transports) ? d.data().transports : undefined,
                    }));
            }
        }

        await db.collection(CHALLENGES_COLLECTION).doc(challengeId).set({
            id: challengeId,
            purpose: 'LOGIN',
            expectedUid: resolvedUid,
            accountId: parsed.data.accountId || null,
            rpId,
            challenge,
            createdAt: now,
            expiresAt: now + CHALLENGE_TTL_MS,
            used: false,
        });

        return res.status(200).json({
            challengeId,
            options: {
                challenge,
                rpId,
                timeout: 60000,
                userVerification: 'preferred',
                allowCredentials,
            },
        });
    } catch (error: any) {
        console.error('[WEBAUTHN] Error generando login-options:', error);
        return res.status(500).json({ error: 'Fallo al iniciar autenticación Passkey.' });
    }
});

// ============================================================================
// 4. POST /login-verify (Público con authRateLimiter)
// ============================================================================
const loginVerifySchema = z.object({
    challengeId: z.string().uuid(),
    credentialId: z.string().min(8).max(512).regex(/^[A-Za-z0-9_-]+$/),
    clientDataJSON: z.string().min(16).max(8192),
    authenticatorData: z.string().min(32).max(16384),
    signature: z.string().min(16).max(4096),
    userHandle: z.string().max(512).optional(),
    accountId: z.string().max(128).optional(),
});

function verifyWebAuthnAssertionSignature(params: {
    spkiBase64: string;
    coseAlg: number;
    authDataBuf: Buffer;
    clientDataBuf: Buffer;
    signatureBuf: Buffer;
}): boolean {
    const spkiDer = Buffer.from(params.spkiBase64, 'base64');
    const pubKeyObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    const signedPayload = Buffer.concat([params.authDataBuf, sha256Buffer(params.clientDataBuf)]);

    // WebAuthn especifica firmas ECDSA en codificación ASN.1 DER (estándar por defecto de Node crypto.verify)
    if (crypto.verify('sha256', signedPayload, pubKeyObj, params.signatureBuf)) {
        return true;
    }

    // Fallback P1363 (64 bytes r||s) únicamente si un autenticador plataforma entrega formato IEEE P1363
    if (params.coseAlg === -7 && params.signatureBuf.length === 64) {
        return crypto.verify(
            'sha256',
            signedPayload,
            { key: pubKeyObj, dsaEncoding: 'ieee-p1363' },
            params.signatureBuf
        );
    }

    return false;
}

webauthnRouter.post('/login-verify', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const parsed = loginVerifySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de aserción WebAuthn inválido', details: parsed.error.format() });
        }

        const data = parsed.data;
        const challengeRef = db.collection(CHALLENGES_COLLECTION).doc(data.challengeId);
        const challengeSnap = await challengeRef.get();

        if (!challengeSnap.exists) {
            return res.status(401).json({ error: 'Desafío WebAuthn inexistente o expirado.' });
        }

        const chData = challengeSnap.data()!;
        if (chData.used || chData.purpose !== 'LOGIN' || Date.now() > chData.expiresAt) {
            await challengeRef.update({ used: true }).catch(() => {});
            return res.status(401).json({ error: 'Desafío WebAuthn inválido, expirado o ya consumido.' });
        }

        await challengeRef.update({ used: true, usedAt: Date.now() });

        const credRef = db.collection(CREDENTIALS_COLLECTION).doc(data.credentialId);
        const credSnap = await credRef.get();
        if (!credSnap.exists) {
            return res.status(401).json({ error: 'Credencial Passkey no registrada.' });
        }

        const credData = credSnap.data()!;
        if (credData.status !== 'ACTIVE') {
            return res.status(401).json({ error: 'Credencial Passkey revocada.' });
        }

        const uid = String(credData.uid);
        if (chData.expectedUid && chData.expectedUid !== uid) {
            return res.status(401).json({ error: 'La credencial no corresponde al usuario solicitado.' });
        }

        const clientDataBuf = fromBase64Url(data.clientDataJSON);
        verifyClientDataJson({
            clientDataBuf,
            expectedType: 'webauthn.get',
            expectedChallenge: String(chData.challenge),
        });

        const authDataBuf = fromBase64Url(data.authenticatorData);
        const parsedAuthData = parseAuthenticatorData(authDataBuf);

        const expectedRpId = String(credData.rpId || chData.rpId);
        const expectedRpIdHash = sha256Buffer(expectedRpId);
        if (!crypto.timingSafeEqual(parsedAuthData.rpIdHash, expectedRpIdHash)) {
            return res.status(401).json({ error: 'rpIdHash inválido.' });
        }

        if (!parsedAuthData.userPresent) {
            return res.status(401).json({ error: 'Presencia de usuario (flag UP) no verificada.' });
        }

        const storedSignCount = Number(credData.signCount || 0);
        if ((storedSignCount > 0 || parsedAuthData.signCount > 0) && parsedAuthData.signCount <= storedSignCount) {
            await AuditLedger.record({
                tenantId: String(data.accountId || chData.accountId || 'global-identity'),
                actorUid: uid,
                actorEmail: String(credData.email || ''),
                action: 'WEBAUTHN_SIGNCOUNT_ANOMALY_BLOCKED',
                module: 'auth',
                targetEntity: data.credentialId,
                details: { storedSignCount, receivedSignCount: parsedAuthData.signCount },
                ipAddress: extractClientIp(req),
            }).catch(() => {});
            return res.status(401).json({ error: 'Anomalía de contador FIDO2 detectada (posible clonación).' });
        }

        const signatureBuf = fromBase64Url(data.signature);
        const isSignatureValid = verifyWebAuthnAssertionSignature({
            spkiBase64: String(credData.publicKeySpkiBase64),
            coseAlg: Number(credData.coseAlg || -7),
            authDataBuf,
            clientDataBuf,
            signatureBuf,
        });

        if (!isSignatureValid) {
            return res.status(401).json({ error: 'Firma criptográfica Passkey inválida.' });
        }

        await credRef.update({
            signCount: parsedAuthData.signCount,
            lastUsedAt: Date.now(),
        });

        // Cargar perfil para adjuntar claims coherentes con la cuenta activa
        const userSnap = await db.collection('users').doc(uid).get();
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        if (userData.status === 'SUSPENDED' || userData.status === 'REVOKED') {
            return res.status(403).json({ error: 'Cuenta de usuario suspendida o revocada.' });
        }

        const activeAccountId =
            data.accountId ||
            chData.accountId ||
            userData.lastActiveAccountId ||
            userData.primaryAccountId ||
            userData.memberships?.[0]?.accountId ||
            undefined;

        const membership = Array.isArray(userData.memberships)
            ? userData.memberships.find((m: any) => m.accountId === activeAccountId)
            : undefined;

        const claims: Record<string, any> = {
            authMethod: 'PASSKEY_FIDO2',
        };
        if (userData.role) claims.role = userData.role;
        else if (membership?.role) claims.role = membership.role;
        if (activeAccountId) claims.activeAccountId = activeAccountId;

        const customToken = await auth.createCustomToken(uid, claims);

        await AuditLedger.record({
            tenantId: String(activeAccountId || 'global-identity'),
            actorUid: uid,
            actorEmail: String(credData.email || userData.email || ''),
            action: 'WEBAUTHN_PASSKEY_LOGIN_SUCCESS',
            module: 'auth',
            targetEntity: data.credentialId,
            details: {
                signCount: parsedAuthData.signCount,
                userVerified: parsedAuthData.userVerified,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            customToken,
            uid,
            email: credData.email || userData.email || null,
            activeAccountId: activeAccountId || null,
        });
    } catch (error: any) {
        console.error('[WEBAUTHN] Error en login-verify:', error);
        return res.status(401).json({ error: error?.message || 'Autenticación Passkey fallida.' });
    }
});

// ============================================================================
// 5. GET /credentials (Autenticado)
// ============================================================================
webauthnRouter.get('/credentials', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const uid = String(req.user?.uid || '');
        const snap = await db
            .collection(CREDENTIALS_COLLECTION)
            .where('uid', '==', uid)
            .get();

        const credentials = snap.docs
            .map((d) => {
                const data = d.data();
                return {
                    credentialId: d.id,
                    deviceLabel: data.deviceLabel || 'Llave Biométrica FIDO2',
                    coseAlg: data.coseAlg || -7,
                    rpId: data.rpId || '',
                    signCount: data.signCount || 0,
                    createdAt: data.createdAt || null,
                    lastUsedAt: data.lastUsedAt || null,
                    status: data.status || 'ACTIVE',
                };
            })
            .filter((c) => c.status !== 'REVOKED');

        return res.status(200).json({ credentials });
    } catch (error) {
        console.error('[WEBAUTHN] Error listando credenciales:', error);
        return res.status(500).json({ error: 'Fallo al obtener llaves Passkey.' });
    }
});

// ============================================================================
// 6. DELETE /credentials/:id (Autenticado + HITL 'ACTUALIZAR')
// ============================================================================
const deleteCredentialSchema = z.object({
    confirmationWord: z.literal('ACTUALIZAR'),
});

webauthnRouter.delete('/credentials/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const credentialId = z.string().min(8).max(512).parse(req.params.id);
        const parsedBody = deleteCredentialSchema.safeParse({
            confirmationWord: req.body?.confirmationWord || req.headers['x-hitl-confirmation'],
        });

        if (!parsedBody.success) {
            return res.status(400).json({
                error: 'Confirmación HITL obligatoria: debe enviar confirmationWord === "ACTUALIZAR".',
            });
        }

        const uid = String(req.user?.uid || '');
        const isSovereignAdmin =
            req.user?.role === 'DEV_ROOT' ||
            req.user?.role === 'SUPER_ADMIN' ||
            req.user?.isMasterDev === true ||
            req.user?.admin === true;

        const credRef = db.collection(CREDENTIALS_COLLECTION).doc(credentialId);
        const credSnap = await credRef.get();

        if (!credSnap.exists) {
            return res.status(404).json({ error: 'Credencial Passkey no encontrada.' });
        }

        const credData = credSnap.data()!;
        if (credData.uid !== uid && !isSovereignAdmin) {
            return res.status(403).json({ error: 'Prohibido revocar credenciales de otro usuario.' });
        }

        await credRef.update({
            status: 'REVOKED',
            revokedAt: Date.now(),
            revokedBy: uid,
        });

        await AuditLedger.record({
            tenantId: String(req.user?.activeAccountId || 'global-identity'),
            actorUid: uid,
            actorEmail: String(req.user?.email || ''),
            action: 'WEBAUTHN_PASSKEY_REVOKED',
            module: 'auth',
            targetEntity: credentialId,
            details: { ownerUid: credData.uid, hitlConfirmed: true },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[WEBAUTHN] Error revocando credencial:', error);
        return res.status(500).json({ error: 'Fallo al revocar llave Passkey.' });
    }
});
