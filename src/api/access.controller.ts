import crypto from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import admin, { auth, db } from '../config/firebase';
import { env } from '../config/env';
import { AuditLedger } from '../core/audit-ledger';
import { computeShortTtlTimestamp, computeThirtyDayTtlTimestamp } from '../core/retention-policy';
import { AuthRequest } from '../middleware/auth';
import { extractClientIp } from '../middleware/rateLimiter';
import { EmailService } from '../services/EmailService';
import { classifyEmailDomain } from '../utils/domain-classifier';
import { validateE164Phone, validateTaxId } from '../utils/taxIdValidator';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 25 * 1000;

export const AccessLookupSchema = z.object({
    email: z.string().trim().email('Formato de correo inválido').max(254),
});

export const VerifyAccessOtpSchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'La clave dinámica debe contener exactamente 6 dígitos numéricos.'),
});

const B2BApplicationSchema = z.object({
    segment: z.literal('B2B'),
    countryCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2,4}$/, 'Código de país ISO inválido (ej. CL, PE, BR, AR, US).')
        .default('CL'),
    businessName: z.string().trim().min(2, 'Razón social obligatoria.').max(180),
    companyTaxId: z.string().trim().min(3, 'Identificador tributario obligatorio.').max(32),
    contactPhone: z.string().trim().min(7, 'Teléfono de contacto E.164 obligatorio.').max(24),
    fullName: z.string().trim().min(2, 'Nombre completo del titular obligatorio.').max(140),
    personalTaxId: z.string().trim().max(32).optional().or(z.literal('')),
    email: z.string().trim().email('Correo corporativo inválido.').max(254),
    password: z.string().min(8, 'La clave debe tener al menos 8 caracteres.').max(128),
    acceptPrivacyPolicy: z.literal(true, {
        errorMap: () => ({
            message: 'Debe aceptar la política de privacidad bajo Ley N° 19.628 y Nueva Ley N° 21.719.',
        }),
    }),
});

const EduApplicationSchema = z.object({
    segment: z.literal('EDU'),
    countryCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2,4}$/, 'Código de país ISO inválido.')
        .default('CL'),
    institutionName: z.string().trim().min(2, 'Nombre de institución académica obligatorio.').max(180),
    eduInstitutionId: z.string().trim().max(128).optional().nullable(),
    eduRole: z.enum(['PROFESSOR', 'STUDENT']).default('STUDENT'),
    fullName: z.string().trim().min(2, 'Nombre completo obligatorio.').max(140),
    contactPhone: z.string().trim().max(24).optional().or(z.literal('')),
    email: z.string().trim().email('Correo académico inválido.').max(254),
    password: z.string().min(8, 'La clave debe tener al menos 8 caracteres.').max(128),
    credentialCasSha256: z
        .string()
        .trim()
        .regex(/^[a-f0-9]{64}$/i)
        .optional()
        .or(z.literal('')),
    acceptPrivacyPolicy: z.literal(true, {
        errorMap: () => ({
            message: 'Debe aceptar la política de privacidad bajo Ley N° 19.628 y Nueva Ley N° 21.719.',
        }),
    }),
});

export const AccessOrgApplicationSchema = z
    .discriminatedUnion('segment', [B2BApplicationSchema, EduApplicationSchema])
    .superRefine((data, ctx) => {
        if (data.segment === 'B2B') {
            const taxCheck = validateTaxId(data.companyTaxId, data.countryCode);
            if (!taxCheck.valid) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['companyTaxId'],
                    message: taxCheck.reason || 'Identificador tributario empresarial inválido para el país seleccionado.',
                });
            }
            if (data.personalTaxId && data.personalTaxId.trim().length > 0) {
                const personalCheck = validateTaxId(data.personalTaxId, data.countryCode);
                if (!personalCheck.valid) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['personalTaxId'],
                        message: personalCheck.reason || 'Identificador personal inválido para el país seleccionado.',
                    });
                }
            }
            const phoneCheck = validateE164Phone(data.contactPhone);
            if (!phoneCheck.valid) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['contactPhone'],
                    message: phoneCheck.reason || 'Teléfono debe cumplir formato internacional E.164 (ej. +56912345678).',
                });
            }
        } else if (data.segment === 'EDU' && data.contactPhone && data.contactPhone.trim().length > 0) {
            const phoneCheck = validateE164Phone(data.contactPhone);
            if (!phoneCheck.valid) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['contactPhone'],
                    message: phoneCheck.reason || 'Teléfono debe cumplir formato internacional E.164 (ej. +56912345678).',
                });
            }
        }
    });

export type AccessOrgApplicationInput = z.infer<typeof AccessOrgApplicationSchema>;

/**
 * Genera una clave numérica criptográficamente aleatoria de 6 dígitos.
 */
export function generateSixDigitOtp(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Calcula digest SHA-256 determinista vinculado al UID del usuario.
 */
export function hashAccessOtp(uid: string, otp: string): string {
    return crypto
        .createHash('sha256')
        .update(`${uid.trim()}:${otp.trim()}`, 'utf8')
        .digest('hex');
}

/**
 * Comparación en tiempo constante del OTP contra su hash SHA-256 almacenado.
 */
export function verifyAccessOtpConstantTime(
    uid: string,
    candidateOtp: string,
    expectedHashHex: string
): boolean {
    if (!uid || !/^\d{6}$/.test(candidateOtp.trim()) || !/^[a-f0-9]{64}$/i.test(expectedHashHex)) {
        return false;
    }
    const candidateDigest = Buffer.from(hashAccessOtp(uid, candidateOtp), 'hex');
    const expectedDigest = Buffer.from(expectedHashHex.toLowerCase(), 'hex');
    if (candidateDigest.length !== expectedDigest.length || candidateDigest.length === 0) {
        return false;
    }
    return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}

export interface StoredOtpChallengeRecord {
    otpHash: string;
    attempts?: number;
    consumed?: boolean;
    expiresAtMs: number;
}

export interface OtpEvaluationResult {
    ok: boolean;
    errorCode?: 'OTP_MISSING' | 'OTP_CONSUMED' | 'OTP_EXPIRED' | 'OTP_LOCKED' | 'OTP_INVALID';
    nextAttempts: number;
    shouldConsume: boolean;
}

/**
 * Evalúa puramente si un intento de clave dinámica OTP es válido considerando TTL,
 * uso único y bloqueo tras 5 intentos fallidos.
 */
export function evaluateOtpChallengeAttempt(
    challenge: StoredOtpChallengeRecord | null | undefined,
    uid: string,
    candidateOtp: string,
    nowMs: number = Date.now()
): OtpEvaluationResult {
    if (!challenge || !challenge.otpHash) {
        return { ok: false, errorCode: 'OTP_MISSING', nextAttempts: 0, shouldConsume: false };
    }
    if (challenge.consumed) {
        return {
            ok: false,
            errorCode: 'OTP_CONSUMED',
            nextAttempts: Number(challenge.attempts || 0),
            shouldConsume: true,
        };
    }
    const currentAttempts = Number(challenge.attempts || 0);
    if (currentAttempts >= OTP_MAX_ATTEMPTS) {
        return {
            ok: false,
            errorCode: 'OTP_LOCKED',
            nextAttempts: currentAttempts,
            shouldConsume: true,
        };
    }
    if (nowMs > Number(challenge.expiresAtMs || 0)) {
        return {
            ok: false,
            errorCode: 'OTP_EXPIRED',
            nextAttempts: currentAttempts,
            shouldConsume: true,
        };
    }

    const isMatch = verifyAccessOtpConstantTime(uid, candidateOtp, challenge.otpHash);
    if (isMatch) {
        return {
            ok: true,
            nextAttempts: currentAttempts,
            shouldConsume: true,
        };
    }

    const nextAttempts = currentAttempts + 1;
    const lockedNow = nextAttempts >= OTP_MAX_ATTEMPTS;
    return {
        ok: false,
        errorCode: lockedNow ? 'OTP_LOCKED' : 'OTP_INVALID',
        nextAttempts,
        shouldConsume: lockedNow,
    };
}

/**
 * Despachador canónico por nivel jerárquico MINREPORT (1º DEV -> 5º EDU).
 */
export function resolveCanonicalHomePath(params: {
    accountTier?: 1 | 2 | 3 | 4 | 5;
    role?: string;
}): '/dev' | '/admin' | '/pilot' | '/dashboard' {
    const roleUpper = String(params.role || '').toUpperCase();
    if (params.accountTier === 1 || roleUpper === 'DEV_ROOT') return '/dev';
    if (params.accountTier === 2 || roleUpper === 'SUPER_ADMIN') return '/admin';
    if (params.accountTier === 3 || roleUpper === 'TEST_PILOT') return '/pilot';
    return '/dashboard';
}

function maskEmailAddress(email: string): string {
    const [localPart = '', domain = ''] = email.split('@');
    if (!domain) return '***';
    const prefix = localPart.slice(0, 2);
    return `${prefix}***@${domain}`;
}

async function resolveVerifiedAccountTier(uid: string, token: Record<string, any>): Promise<{
    accountTier: 1 | 2 | 3 | 4 | 5;
    role: string;
}> {
    const emailLower = String(token.email || '').toLowerCase();
    const tokenRole = String(token.role || '').toUpperCase();

    if (
        token.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        uid === 'dev-master-root-uid' ||
        emailLower === 'dev@minreport.com'
    ) {
        return { accountTier: 1, role: 'DEV_ROOT' };
    }

    let profileData: Record<string, any> | null = null;
    try {
        const snap = await db.collection('users').doc(uid).get();
        if (snap.exists) profileData = snap.data() || null;
    } catch {
        profileData = null;
    }

    const serverRole = String(profileData?.role || '').toUpperCase();
    if (
        token.admin === true ||
        tokenRole === 'SUPER_ADMIN' ||
        serverRole === 'SUPER_ADMIN' ||
        uid === 'super-admin-uid' ||
        emailLower === 'admin@minreport.com' ||
        emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase()
    ) {
        return { accountTier: 2, role: 'SUPER_ADMIN' };
    }

    if (tokenRole === 'TEST_PILOT' || serverRole === 'TEST_PILOT') {
        return { accountTier: 3, role: 'TEST_PILOT' };
    }

    const memberships = Array.isArray(profileData?.memberships) ? profileData!.memberships : [];
    const primaryMembership = memberships.find((m: any) => m?.accountId === profileData?.lastActiveAccountId) || memberships[0];
    const membershipType = String(primaryMembership?.type || '').toUpperCase();
    const classification = String(token.classification || profileData?.classification || '').toLowerCase();

    if (
        membershipType === 'EDUCATIONAL' ||
        classification === 'edu' ||
        serverRole === 'STUDENT' ||
        serverRole === 'PROFESSOR'
    ) {
        return { accountTier: 5, role: serverRole || 'STUDENT' };
    }

    return { accountTier: 4, role: String(primaryMembership?.role || serverRole || 'OPERATOR') };
}

/**
 * Reclama en backend invitaciones `primaryOperator.status === 'PENDING'` tras autenticación OTP.
 */
async function claimPendingOperatorInvitationsServerSide(uid: string, emailLower: string): Promise<void> {
    if (!emailLower || emailLower === 'dev@minreport.com' || emailLower === 'admin@minreport.com') return;

    try {
        const pendingAccountsSnap = await db
            .collection('accounts')
            .where('primaryOperator.email', '==', emailLower)
            .where('primaryOperator.status', '==', 'PENDING')
            .limit(10)
            .get();

        if (pendingAccountsSnap.empty) return;

        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        const existingData = userSnap.exists ? userSnap.data() || {} : {};
        const existingMemberships = Array.isArray(existingData.memberships)
            ? existingData.memberships.map(({ passwordHash: _ph, ...rest }: any) => rest)
            : [];

        const batch = db.batch();
        const mergedMemberships = [...existingMemberships];
        let modifiedMemberships = false;

        pendingAccountsSnap.docs.forEach((accDoc) => {
            const accData = accDoc.data() || {};
            batch.update(accDoc.ref, {
                'primaryOperator.status': 'ACTIVE',
                'primaryOperator.uid': uid,
                updatedAt: Date.now(),
            });

            if (!mergedMemberships.some((m: any) => m?.accountId === accDoc.id)) {
                mergedMemberships.push({
                    accountId: accDoc.id,
                    accountName: accData.name || accDoc.id,
                    role: 'ADMIN',
                    type: accData.type || 'BUSINESS',
                    status: accData.status || 'ACTIVE',
                    joinedAt: Date.now(),
                });
                modifiedMemberships = true;
            }
        });

        if (modifiedMemberships) {
            batch.set(
                userRef,
                {
                    uid,
                    email: emailLower,
                    memberships: mergedMemberships,
                    updatedAt: Date.now(),
                },
                { merge: true }
            );
        }

        await batch.commit();
    } catch (claimErr) {
        console.warn('[ACCESS] Advertencia al reclamar invitaciones pendientes en servidor:', claimErr);
    }
}

/**
 * POST /api/auth/access/lookup
 * Home Realm Discovery sin exposición de PII ni enumeración de organizaciones.
 */
export const lookupAccessIdentity = async (req: Request, res: Response) => {
    try {
        const parsed = AccessLookupSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Correo inválido.' });
        }

        const emailLower = parsed.data.email.toLowerCase().trim();
        if (emailLower === 'dev@minreport.com') {
            return res.status(403).json({
                error: 'Este identificador requiere la pasarela de ingeniería /dev.',
            });
        }

        const domainInfo = classifyEmailDomain(emailLower);
        const domainType: 'edu' | 'corporate' | 'public' = domainInfo.isAcademic
            ? 'edu'
            : domainInfo.isCorporate
                ? 'corporate'
                : 'public';

        let existsInAuth = false;
        try {
            await auth.getUserByEmail(emailLower);
            existsInAuth = true;
        } catch (err: any) {
            if (err?.code !== 'auth/user-not-found') {
                throw err;
            }
        }

        if (!existsInAuth) {
            const userQuery = await db.collection('users').where('email', '==', emailLower).limit(1).get();
            existsInAuth = !userQuery.empty;
        }

        const nextStep = existsInAuth
            ? 'PASSWORD'
            : domainInfo.isAcademic
                ? 'APPLY_EDU'
                : 'APPLY_B2B';

        return res.status(200).json({
            success: true,
            nextStep,
            domainType,
        });
    } catch (error: any) {
        console.error('[ACCESS] Error en lookupAccessIdentity:', error);
        return res.status(500).json({ error: 'No fue posible validar el identificador de acceso.' });
    }
};

/**
 * POST /api/auth/access/send-otp (requireAuth)
 * Paso 3 obligatorio en escritorio B2B/EDU/ADMIN/PILOT: envía clave dinámica de 6 dígitos por email.
 */
export const sendAccessEmailOtp = async (req: AuthRequest, res: Response) => {
    try {
        const uid = String(req.user?.uid || '').trim();
        const emailLower = String(req.user?.email || '').trim().toLowerCase();

        if (!uid || !emailLower) {
            return res.status(401).json({ error: 'Sesión verificada requerida para generar clave dinámica.' });
        }
        if (emailLower === 'dev@minreport.com' || uid === 'dev-master-root-uid') {
            return res.status(403).json({
                error: 'Acceso /dev gestiona sus credenciales exclusivamente mediante su desafío OOB propio.',
            });
        }

        const nowMs = Date.now();
        const challengeRef = db.collection('auth_otp_challenges').doc(uid);
        const existingSnap = await challengeRef.get();

        if (existingSnap.exists) {
            const existing = existingSnap.data() || {};
            const lastSentAtMs = Number(existing.lastSentAtMs || 0);
            const notConsumed = existing.consumed === false;
            const notExpired = nowMs < Number(existing.expiresAtMs || 0);
            if (notConsumed && notExpired && nowMs - lastSentAtMs < OTP_RESEND_COOLDOWN_MS) {
                const retryAfterSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (nowMs - lastSentAtMs)) / 1000);
                return res.status(429).json({
                    error: `Espere ${retryAfterSec} segundos antes de solicitar otra clave dinámica.`,
                    retryAfterSeconds: retryAfterSec,
                });
            }
        }

        const otpCode = generateSixDigitOtp();
        const otpHash = hashAccessOtp(uid, otpCode);
        const expiresAtMs = nowMs + OTP_TTL_MS;

        await challengeRef.set({
            uid,
            email: emailLower,
            otpHash,
            attempts: 0,
            consumed: false,
            createdAtMs: nowMs,
            lastSentAtMs: nowMs,
            expiresAtMs,
            ttlExpiresAt: computeShortTtlTimestamp(OTP_TTL_MS, nowMs),
        });

        await EmailService.sendEmail({
            from: 'MINREPORT Access <no-reply@minreport.com>',
            to: emailLower,
            subject: 'Clave Dinámica de Acceso MINREPORT',
            redactSensitiveOtp: true,
            html: `
                <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 560px; background: #FFFFFF; color: #0F172A; border: 1px solid #E2E8F0; padding: 34px 21px;">
                    <div style="border-bottom: 1px solid #E2E8F0; padding-bottom: 13px; margin-bottom: 21px;">
                        <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #C68346; text-transform: uppercase;">
                            MINREPORT · CONTROL DE ACCESO SOBERANO
                        </span>
                        <h2 style="font-size: 18px; color: #0F172A; margin: 8px 0 0 0; text-transform: uppercase;">
                            Clave Dinámica de Verificación (Paso 3)
                        </h2>
                    </div>
                    <p style="font-size: 14px; color: #475569; line-height: 1.5; margin: 0 0 21px 0;">
                        Ingrese el siguiente código numérico de un solo uso para habilitar su terminal operativa:
                    </p>
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid #C68346; padding: 21px; text-align: center; margin-bottom: 21px;">
                        <span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 30px; font-weight: 700; letter-spacing: 0.25em; color: #0F172A;">
                            ${otpCode}
                        </span>
                    </div>
                    <p style="font-size: 11px; font-family: monospace; color: #475569; margin: 0;">
                        VIGENCIA: 10 MINUTOS · REGIÓN SOUTHAMERICA-WEST1 · NO COMPARTA ESTE CÓDIGO.
                    </p>
                </div>
            `,
        });

        return res.status(200).json({
            success: true,
            expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
            maskedEmail: maskEmailAddress(emailLower),
        });
    } catch (error: any) {
        console.error('[ACCESS] Error en sendAccessEmailOtp:', error);
        return res.status(500).json({ error: 'Error al despachar la clave dinámica por correo electrónico.' });
    }
};

/**
 * POST /api/auth/access/verify-otp (requireAuth)
 * Valida la clave dinámica de 6 dígitos y habilita el despacho determinista por `accountTier`.
 */
export const verifyAccessEmailOtp = async (req: AuthRequest, res: Response) => {
    try {
        const uid = String(req.user?.uid || '').trim();
        const emailLower = String(req.user?.email || '').trim().toLowerCase();

        if (!uid || !emailLower) {
            return res.status(401).json({ error: 'Sesión Firebase requerida para verificar OTP.' });
        }
        if (emailLower === 'dev@minreport.com' || uid === 'dev-master-root-uid') {
            return res.status(403).json({ error: 'Utilice la pasarela /dev para el rol DEV_ROOT.' });
        }

        const parsed = VerifyAccessOtpSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Código OTP inválido.' });
        }

        const nowMs = Date.now();
        const challengeRef = db.collection('auth_otp_challenges').doc(uid);

        const txResult = await db.runTransaction(async (tx) => {
            const snap = await tx.get(challengeRef);
            const data = snap.exists ? (snap.data() as StoredOtpChallengeRecord) : null;
            const evalResult = evaluateOtpChallengeAttempt(data, uid, parsed.data.code, nowMs);

            if (!snap.exists) {
                return evalResult;
            }

            if (evalResult.ok) {
                tx.update(challengeRef, {
                    consumed: true,
                    verifiedAtMs: nowMs,
                    ttlExpiresAt: computeThirtyDayTtlTimestamp(nowMs),
                });
            } else {
                tx.update(challengeRef, {
                    attempts: evalResult.nextAttempts,
                    consumed: evalResult.shouldConsume,
                });
            }

            return evalResult;
        });

        if (!txResult.ok) {
            const statusMap: Record<NonNullable<OtpEvaluationResult['errorCode']>, { status: number; msg: string }> = {
                OTP_MISSING: { status: 404, msg: 'No existe un desafío activo. Solicite una nueva clave dinámica.' },
                OTP_CONSUMED: { status: 401, msg: 'La clave dinámica ya fue utilizada. Solicite un nuevo código.' },
                OTP_EXPIRED: { status: 401, msg: 'La clave dinámica ha expirado (10 min). Solicite un nuevo código.' },
                OTP_LOCKED: { status: 429, msg: 'Límite de intentos excedido. Solicite una nueva clave dinámica.' },
                OTP_INVALID: {
                    status: 401,
                    msg: `Clave dinámica incorrecta (intento ${txResult.nextAttempts}/${OTP_MAX_ATTEMPTS}).`,
                },
            };
            const failure = statusMap[txResult.errorCode || 'OTP_INVALID'];
            return res.status(failure.status).json({
                error: failure.msg,
                code: txResult.errorCode,
            });
        }

        await claimPendingOperatorInvitationsServerSide(uid, emailLower);

        const mfaOtpAt = Math.floor(nowMs / 1000);
        try {
            const authUser = await auth.getUser(uid);
            if (!authUser.emailVerified && typeof (auth as any).updateUser === 'function') {
                await auth.updateUser(uid, { emailVerified: true }).catch(() => {});
            }
            const prevClaims = authUser.customClaims || {};
            await auth.setCustomUserClaims(uid, {
                ...prevClaims,
                mfaOtpAt,
            });
        } catch (claimErr) {
            console.warn('[ACCESS] No se pudieron actualizar customClaims mfaOtpAt:', claimErr);
        }

        const { accountTier, role } = await resolveVerifiedAccountTier(uid, req.user || {});
        const redirectPath = resolveCanonicalHomePath({ accountTier, role });

        await AuditLedger.record({
            tenantId: String(req.headers['x-active-account-id'] || req.user?.activeAccountId || 'auth-access'),
            actorUid: uid,
            actorEmail: emailLower,
            action: 'ACCESS_OTP_VERIFIED',
            module: 'auth',
            targetEntity: uid,
            details: { accountTier, redirectPath },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            verified: true,
            verifiedAt: new Date(nowMs).toISOString(),
            accountTier,
            redirectPath,
            mfaTicket: `${uid}:${mfaOtpAt}`,
        });
    } catch (error: any) {
        console.error('[ACCESS] Error en verifyAccessEmailOtp:', error);
        return res.status(500).json({ error: 'Fallo al verificar la clave dinámica de acceso.' });
    }
};

/**
 * POST /api/auth/access/apply
 * Registro unificado simplificado Multi-País (`4º B2B` y `5º EDU`) siempre en estado `PENDING_APPROVAL`.
 */
export const submitAccessOrgApplication = async (req: Request, res: Response) => {
    try {
        const parsed = AccessOrgApplicationSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Error de validación en los datos de postulación.',
                details: parsed.error.format(),
            });
        }

        const data = parsed.data;
        const emailLower = data.email.toLowerCase().trim();
        const clientIp = extractClientIp(req);

        if (
            emailLower === 'dev@minreport.com' ||
            emailLower === 'admin@minreport.com' ||
            emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase()
        ) {
            return res.status(403).json({
                error: 'Identificador reservado del sistema.',
            });
        }

        // Impedir sobreescribir cuentas ya existentes en Firebase Auth desde endpoint público
        try {
            await auth.getUserByEmail(emailLower);
            return res.status(409).json({
                error: 'ACCESO_EXISTENTE: Este correo ya se encuentra registrado. Inicie sesión desde el acceso de 3 pasos.',
            });
        } catch (err: any) {
            if (err?.code !== 'auth/user-not-found') {
                throw err;
            }
        }

        const isEdu = data.segment === 'EDU';
        const countryCode = data.countryCode.toUpperCase();
        const domainInfo = classifyEmailDomain(emailLower);

        let normalizedTaxId = '';
        let formattedTaxId = '';
        let companyName = '';
        let phoneNormalized = '';

        if (data.segment === 'B2B') {
            const taxCheck = validateTaxId(data.companyTaxId, countryCode);
            normalizedTaxId = taxCheck.normalized;
            formattedTaxId = taxCheck.formatted;
            companyName = data.businessName.trim();
            phoneNormalized = validateE164Phone(data.contactPhone).normalized;

            const duplicateTaxSnap = await db
                .collection('accounts')
                .where('taxId', '==', normalizedTaxId)
                .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE'])
                .limit(1)
                .get();

            if (!duplicateTaxSnap.empty) {
                return res.status(409).json({
                    error: 'ENTIDAD_EXISTENTE: Ya existe una postulación o cuenta B2B registrada con ese identificador tributario.',
                });
            }
        } else {
            companyName = data.institutionName.trim();
            phoneNormalized = data.contactPhone ? validateE164Phone(data.contactPhone).normalized : '';
        }

        let hydratedEduInst: { id: string; name: string; logo: any; defaultMaxProjects: number } | null = null;
        if (data.segment === 'EDU') {
            const requestedInstId = String(data.eduInstitutionId || '').trim();
            if (requestedInstId) {
                const instSnap = await db.collection('edu_institutions').doc(requestedInstId).get();
                if (instSnap.exists) {
                    const instData = instSnap.data() || {};
                    if (instData.status === 'ACTIVE') {
                        hydratedEduInst = {
                            id: instSnap.id,
                            name: String(instData.name || data.institutionName).trim(),
                            logo: instData.eduInstitutionLogo ?? null,
                            defaultMaxProjects: Number(instData.defaultMaxProjects || 3),
                        };
                    }
                }
            }
            companyName = hydratedEduInst ? hydratedEduInst.name : data.institutionName.trim();
        }

        const duplicateEmailSnap = await db
            .collection('tenants')
            .where('email', '==', emailLower)
            .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE'])
            .limit(1)
            .get();

        if (!duplicateEmailSnap.empty) {
            return res.status(409).json({
                error: 'ACCESO_EXISTENTE: Ya existe una solicitud en curso para este correo.',
            });
        }

        const userRecord = await auth.createUser({
            email: emailLower,
            displayName: data.fullName.trim(),
            password: data.password,
            emailVerified: false,
        });
        const uid = userRecord.uid;

        const nowMs = Date.now();
        const accountRef = db.collection('accounts').doc();
        const accountId = accountRef.id;
        const assignedRole = isEdu ? data.eduRole : 'OWNER';
        const eduOperational = Boolean(isEdu && hydratedEduInst);

        const accountDoc: Record<string, any> = {
            id: accountId,
            name: companyName,
            type: isEdu ? 'EDUCATIONAL' : 'BUSINESS',
            classification: isEdu ? 'edu' : 'b2b',
            country: countryCode,
            countryCode,
            ...(normalizedTaxId ? { taxId: normalizedTaxId, taxIdFormatted: formattedTaxId } : {}),
            ...(phoneNormalized ? { phone: phoneNormalized } : {}),
            status: 'PENDING_APPROVAL',
            ownerId: uid,
            isEduSandbox: isEdu,
            hasInitialPassword: true,
            ...(isEdu ? { academicRole: data.eduRole } : {}),
            ...(hydratedEduInst
                ? {
                      eduInstitutionId: hydratedEduInst.id,
                      eduInstitutionName: hydratedEduInst.name,
                      eduInstitutionLogo: hydratedEduInst.logo,
                  }
                : {}),
            licensing: {
                maxUsers: isEdu ? 1 : 50,
                allowInternalUsers: !isEdu,
                isCommercial: !isEdu,
                watermarkRequired: isEdu,
            },
            contract: {
                plan: isEdu ? 'ACADEMIC_SANDBOX' : 'CORE_BASE',
                status: 'PENDING_APPROVAL',
                billingCycle: 'MENSUAL',
                activeModules: {
                    opermaq: eduOperational,
                    stockpile: false,
                    supply: false,
                },
            },
            entitlements: isEdu
                ? {
                      basePackage: 'ACADEMIC_SANDBOX',
                      addonModules: {
                          opermaq: { active: eduOperational, updatedAt: nowMs },
                          stockpile: { active: false, updatedAt: nowMs },
                          supply: { active: false, updatedAt: nowMs },
                      },
                      maxProjects: hydratedEduInst?.defaultMaxProjects ?? 3,
                  }
                : {
                      basePackage: 'CORE_BASE',
                      maxProjects: null,
                      addonModules: {
                          opermaq: { active: false },
                          stockpile: { active: false },
                          supply: { active: false },
                      },
                  },
            enabledPlugins: eduOperational ? ['opermaq'] : [],
            mandatario: {
                fullName: data.fullName.trim(),
                email: emailLower,
                ...(phoneNormalized ? { phone: phoneNormalized } : {}),
                jobTitle: isEdu ? data.eduRole : 'OWNER',
            },
            ...(isEdu && data.credentialCasSha256 ? { credentialCasSha256: data.credentialCasSha256 } : {}),
            compliance: {
                law: 'Ley N° 19.628 y Nueva Ley N° 21.719 (Protección de Datos Personales Chile)',
                privacyPolicyVersion: '2026.2',
                termsAccepted: true,
                termsAcceptedAt: nowMs,
                region: 'southamerica-west1',
                ipAddress: clientIp,
            },
            domainClassification: domainInfo.classification,
            createdAt: nowMs,
            updatedAt: nowMs,
        };

        await accountRef.set(accountDoc);

        await accountRef.collection('members').doc(uid).set({
            id: uid,
            userId: uid,
            fullName: data.fullName.trim(),
            email: emailLower,
            role: assignedRole,
            status: 'PENDING_APPROVAL',
            countryCode,
            joinedAt: nowMs,
            isOwner: !isEdu,
        });

        await db.collection('users').doc(uid).set(
            {
                uid,
                email: emailLower,
                fullName: data.fullName.trim(),
                displayName: data.fullName.trim(),
                role: assignedRole,
                classification: isEdu ? 'edu' : 'b2b',
                countryCode,
                status: 'PENDING_APPROVAL',
                primaryAccountId: accountId,
                lastActiveAccountId: accountId,
                memberships: [
                    {
                        accountId,
                        accountName: companyName,
                        role: assignedRole,
                        type: isEdu ? 'EDUCATIONAL' : 'BUSINESS',
                        status: 'PENDING_APPROVAL',
                        countryCode,
                        joinedAt: nowMs,
                    },
                ],
                createdAt: nowMs,
                updatedAt: nowMs,
            },
            { merge: true }
        );

        await db.collection('tenants').doc(accountId).set({
            ...accountDoc,
            email: emailLower,
            company_name: companyName,
            ...(isEdu ? { institution_name: companyName } : {}),
            ...(normalizedTaxId ? { rut: normalizedTaxId } : {}),
            status: 'PENDING_APPROVAL',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: uid,
            actorEmail: emailLower,
            action: 'SUBMIT_ACCESS_ORG_APPLICATION',
            module: isEdu ? 'edu' : 'b2b-core',
            targetEntity: accountId,
            details: {
                segment: data.segment,
                countryCode,
                role: assignedRole,
                status: 'PENDING_APPROVAL',
            },
            ipAddress: clientIp,
        }).catch(() => {});

        return res.status(201).json({
            success: true,
            status: 'PENDING_APPROVAL',
            accountId,
            segment: data.segment,
            message: 'Postulación registrada. Su cuenta permanece en revisión administrativa (2º ADMIN) antes de activar módulos.',
        });
    } catch (error: any) {
        console.error('[ACCESS] Error en submitAccessOrgApplication:', error);
        return res.status(500).json({ error: error?.message || 'Error procesando postulación de acceso.' });
    }
};
