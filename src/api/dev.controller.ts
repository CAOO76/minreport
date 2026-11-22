import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db, auth } from '../config/firebase';
import { z } from 'zod';
import { getCanonicalWebUrl } from '../config/env';
import { EmailService } from '../services/EmailService';
import { generateSetupToken } from '../utils/security';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { computeThirtyDayTtlTimestamp, toEpochMillis } from '../core/retention-policy';
import { evaluatePilotExpiration } from '../contracts/session.contracts';
import { DEV_ROOT_EMAIL, DEV_ROOT_UID, ensureDevRootAccount } from '../services/bootstrap.service';
import { DevChallengeService } from '../services/dev-challenge.service';
import { logThrottledAuthFailure } from '../middleware/auth';

export interface DevRequest extends Request {
    devUser?: any;
}

/**
 * Middleware de protección de acceso exclusivo a la Cuenta Maestra DEV.
 * Prohibida cualquier decodificación JWT sin verificación criptográfica.
 */
export const requireDevRoot = async (req: DevRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Acceso no autorizado: Token ausente' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return res.status(401).json({ error: 'Acceso no autorizado: Token vacío' });
        }

        const decodedToken = await auth.verifyIdToken(token);
        const emailLower = String(decodedToken.email || '').toLowerCase();
        const emailVerifiedOk = decodedToken.email_verified !== false;

        const isDevRoot =
            decodedToken.role === 'DEV_ROOT' ||
            decodedToken.isMasterDev === true ||
            decodedToken.uid === DEV_ROOT_UID ||
            (emailVerifiedOk && emailLower === DEV_ROOT_EMAIL.toLowerCase());

        if (!isDevRoot) {
            console.warn(`[DEV-GATEWAY] Intento de acceso denegado por: ${decodedToken.uid} (${emailLower})`);
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a Cuenta Maestra de Desarrollo (DEV_ROOT)' });
        }

        req.devUser = decodedToken;
        return next();
    } catch (error) {
        logThrottledAuthFailure('DEV-GATEWAY', req, error);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

/**
 * POST /api/dev/auth/login
 * Bypass legacy de contraseña única deshabilitado; exige flujo progresivo OOB.
 */
export const devLogin = async (_req: Request, res: Response) => {
    return res.status(403).json({
        error: 'Autenticación directa deshabilitada. Utilice el desafío progresivo /api/dev/auth/challenge/init.',
    });
};

const createTestPilotSchema = z.object({
    collaboratorName: z.string().min(2).max(120),
    collaboratorEmail: z.string().email(),
    organization: z.string().max(160).optional(),
    purpose: z.string().min(3).max(500),
    expiresDays: z.number().int().min(1).max(365).default(90)
});

/**
 * POST /api/dev/test-pilots
 * Crea una cuenta dedicada de co-desarrollo TEST-PILOT (exclusivo para colaboradores).
 */
export const createTestPilotAccount = async (req: DevRequest, res: Response) => {
    try {
        const parsed = createTestPilotSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Datos de piloto inválidos', details: parsed.error.format() });
        }

        const { collaboratorName, collaboratorEmail, organization, purpose, expiresDays } = parsed.data;
        const normalizedEmail = collaboratorEmail.toLowerCase().trim();

        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
        } catch (e: any) {
            if (e.code === 'auth/user-not-found') {
                const tempPassword = `Pilot-${crypto.randomBytes(12).toString('base64url')}!9A`;
                userRecord = await auth.createUser({
                    email: normalizedEmail,
                    displayName: collaboratorName,
                    password: tempPassword,
                    emailVerified: true
                });
            } else {
                throw e;
            }
        }

        const pilotUserId = userRecord.uid;
        const pilotAccountId = `pilot-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        const expiresAt = Date.now() + expiresDays * 24 * 60 * 60 * 1000;

        const pilotMetadata = {
            id: pilotAccountId,
            accountId: pilotAccountId,
            userId: pilotUserId,
            collaboratorName,
            collaboratorEmail: normalizedEmail,
            organization: organization || 'MINREPORT Co-Dev Partner',
            purpose,
            status: 'ACTIVE',
            expiresAt,
            createdAt: Date.now(),
            createdBy: DEV_ROOT_EMAIL,
            telemetry: {
                totalLogins: 0,
                lastActivity: null,
                activeModulesUsed: []
            }
        };

        await db.collection('test_pilots').doc(pilotAccountId).set(pilotMetadata);

        const accountData = {
            id: pilotAccountId,
            name: `PILOT: ${organization || collaboratorName}`,
            classification: 'test-pilot',
            type: 'TEST_PILOT',
            status: 'ACTIVE',
            ownerId: pilotUserId,
            billingEmail: normalizedEmail,
            licensing: {
                maxUsers: 5,
                allowInternalUsers: true,
                isCommercial: false,
                watermarkRequired: true
            },
            contract: {
                plan: 'CO_DEV_PILOT_PROGRAM',
                status: 'ACTIVE',
                expiresAt,
                activeModules: {
                    opermaq: true,
                    stockpile: true,
                    supply: true,
                }
            },
            entitlements: {
                basePackage: 'FULL_SUITE',
                baseModules: {
                    opermaq: true,
                    stockpile: true,
                    supply: true,
                },
                addonModules: {
                    opermaq: { active: true, updatedAt: Date.now() },
                    stockpile: { active: true, updatedAt: Date.now() },
                    supply: { active: true, updatedAt: Date.now() },
                },
                maxProjects: null,
            },
            enabledPlugins: ['opermaq', 'stockpile', 'supply'],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await db.collection('accounts').doc(pilotAccountId).set(accountData);

        await db.collection('accounts').doc(pilotAccountId).collection('members').doc(pilotUserId).set({
            id: pilotUserId,
            userId: pilotUserId,
            fullName: collaboratorName,
            email: normalizedEmail,
            role: 'TEST_PILOT',
            allowedModules: {
                opermaq: true,
                stockpile: true,
                supply: true,
            },
            status: 'ACTIVE',
            joinedAt: Date.now()
        });

        await auth.setCustomUserClaims(pilotUserId, {
            role: 'TEST_PILOT',
            activeAccountId: pilotAccountId,
            pilotExpiresAt: expiresAt
        });

        await db.collection('users').doc(pilotUserId).set({
            uid: pilotUserId,
            email: normalizedEmail,
            displayName: collaboratorName,
            role: 'TEST_PILOT',
            status: 'ACTIVE',
            classification: 'test-pilot',
            pilotExpiresAt: expiresAt,
            primaryAccountId: pilotAccountId,
            memberships: [
                {
                    accountId: pilotAccountId,
                    accountName: accountData.name,
                    role: 'TEST_PILOT',
                    classification: 'test-pilot',
                    allowedModules: {
                        opermaq: true,
                        stockpile: true,
                        supply: true,
                    },
                    status: 'ACTIVE',
                    joinedAt: Date.now()
                }
            ],
            updatedAt: Date.now()
        }, { merge: true });

        const { rawToken, hashedToken, expiresAt: tokenExpiresAt } = generateSetupToken();
        const nowMs = Date.now();
        await db.collection('setup_tokens').doc(rawToken).set({
            accountId: pilotAccountId,
            uid: pilotUserId,
            taxId: pilotUserId,
            accountType: 'TEST_PILOT',
            hashedToken,
            expiresAt: tokenExpiresAt,
            ttlExpiresAt: computeThirtyDayTtlTimestamp(),
            used: false,
            createdAt: nowMs,
        });

        const baseUrl = getCanonicalWebUrl();
        const activationUrl = `${baseUrl}/setup-access?accountId=${encodeURIComponent(pilotAccountId)}&name=${encodeURIComponent(collaboratorName)}&type=TEST_PILOT&token=${encodeURIComponent(rawToken)}`;

        EmailService.sendEmail({
            from: 'MINREPORT DEV <dev@minreport.com>',
            to: normalizedEmail,
            subject: 'Activación de Acceso 3º TEST-PILOT — MINREPORT',
            html: `
                <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                    <div style="background: #F8FAFC; border-left: 4px solid #C68346; padding: 21px; margin-bottom: 21px;">
                        <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 13px;">Acceso TEST-PILOT Habilitado</h2>
                        <p style="margin: 0; font-size: 15px; line-height: 1.5;">
                            Se ha aprovisionado una credencial temporal de colaborador <strong>3º TEST-PILOT</strong> en MINREPORT.
                        </p>
                        <div style="margin-top: 21px; background: #FFFFFF; border: 1px solid #E2E8F0; padding: 13px;">
                            <p style="margin: 0 0 8px 0; font-size: 11px; color: #475569; text-transform: uppercase; font-weight: 700;">Colaborador</p>
                            <p style="margin: 0 0 13px 0; font-size: 15px; color: #0F172A; font-weight: 700;">${collaboratorName}</p>
                            <p style="margin: 0 0 8px 0; font-size: 11px; color: #475569; text-transform: uppercase; font-weight: 700;">Correo Autorizado</p>
                            <p style="margin: 0; font-size: 14px; color: #0F172A;">${normalizedEmail}</p>
                        </div>
                    </div>
                    <div style="text-align: center; margin: 34px 0;">
                        <a href="${activationUrl}" style="background: #0F172A; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">Activar Credencial Segura</a>
                    </div>
                </div>
            `,
        }).catch((err) => console.warn('[TEST-PILOT] Non-blocking activation email failed:', err?.message || err));

        await AuditLedger.record({
            tenantId: pilotAccountId,
            actorUid: req.devUser?.uid || DEV_ROOT_UID,
            actorEmail: req.devUser?.email || DEV_ROOT_EMAIL,
            action: 'CREATE_TEST_PILOT_ACCOUNT',
            module: 'test-pilot',
            targetEntity: pilotUserId,
            details: { collaboratorEmail: normalizedEmail, expiresAt },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(201).json({
            success: true,
            message: 'Cuenta TEST-PILOT de colaborador aprovisionada exitosamente',
            pilot: pilotMetadata,
            activationUrl,
        });
    } catch (error: any) {
        console.error('[TEST-PILOT] Error aprovisionando cuenta piloto:', error);
        return res.status(500).json({ error: error.message || 'Fallo al crear cuenta piloto' });
    }
};

/**
 * GET /api/dev/test-pilots
 * Lista todas las cuentas de colaboradores TEST-PILOT registradas.
 */
export const listTestPilots = async (_req: DevRequest, res: Response) => {
    try {
        const snapshot = await db.collection('test_pilots').orderBy('createdAt', 'desc').get();
        const pilots = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        return res.status(200).json(pilots);
    } catch (error: any) {
        console.error('[TEST-PILOT] Error listando pilotos:', error);
        return res.status(500).json({ error: 'Fallo al obtener cuentas piloto' });
    }
};

/**
 * DELETE /api/dev/test-pilots/:id
 * Revoca o cancela una cuenta TEST-PILOT de colaborador.
 */
export const revokeTestPilot = async (req: DevRequest, res: Response) => {
    try {
        const id = z.string().min(3).max(128).parse(req.params.id);
        const pilotDoc = await db.collection('test_pilots').doc(id).get();
        if (!pilotDoc.exists) {
            return res.status(404).json({ error: 'Cuenta piloto no encontrada' });
        }

        const pilotData = pilotDoc.data()!;
        await db.collection('test_pilots').doc(id).update({
            status: 'REVOKED',
            revokedAt: Date.now(),
            revokedBy: DEV_ROOT_EMAIL,
            ttlExpiresAt: computeThirtyDayTtlTimestamp(),
        });

        await db.collection('accounts').doc(id).update({
            status: 'SUSPENDED',
            suspendedAt: Date.now()
        });

        if (pilotData.userId) {
            await db.collection('users').doc(pilotData.userId).set({
                status: 'REVOKED',
                role: 'OPERATOR',
                updatedAt: Date.now(),
            }, { merge: true }).catch(() => {});
            await db.collection('accounts').doc(id).collection('members').doc(pilotData.userId).update({
                status: 'REVOKED',
                updatedAt: Date.now(),
            }).catch(() => {});
            await auth.setCustomUserClaims(pilotData.userId, {
                role: 'REVOKED',
            }).catch(() => {});
            if (typeof (auth as any).updateUser === 'function') {
                await auth.updateUser(pilotData.userId, { disabled: true }).catch(() => {});
            }
            if (typeof (auth as any).revokeRefreshTokens === 'function') {
                await (auth as any).revokeRefreshTokens(pilotData.userId).catch(() => {});
            }
        }

        await AuditLedger.record({
            tenantId: id,
            actorUid: req.devUser?.uid || DEV_ROOT_UID,
            actorEmail: req.devUser?.email || DEV_ROOT_EMAIL,
            action: 'REVOKE_TEST_PILOT_ACCOUNT',
            module: 'test-pilot',
            targetEntity: String(pilotData.userId || id),
            details: { pilotAccountId: id },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({ success: true, message: 'Acceso a cuenta piloto revocado' });
    } catch (error: any) {
        console.error('[TEST-PILOT] Error revocando piloto:', error);
        return res.status(500).json({ error: 'Fallo al revocar cuenta piloto' });
    }
};

/**
 * POST /api/dev/impersonate-client (Abolido)
 * Simulación CLIENT_OWNER retirada en favor de cuentas soberanas 3º TEST-PILOT (/pilot).
 */
export const impersonateClient = async (_req: DevRequest, res: Response) => {
    return res.status(410).json({
        error: 'Simulación CLIENT_OWNER abolida. Utilice una cuenta 3º TEST-PILOT o /pilot.',
    });
};

/**
 * POST /api/dev/auth/challenge/init
 * Inicia el reto OOB usando estrictamente la URL base canónica (`env.API_URL`), sin `req.get('host')`.
 */
export const initDevChallenge = async (req: Request, res: Response) => {
    try {
        const ip = extractClientIp(req);
        const userAgent = String(req.headers['user-agent'] || 'Desconocido').slice(0, 256);

        const result = await DevChallengeService.initChallenge(ip, userAgent);
        return res.status(200).json({
            success: true,
            challengeId: result.challengeId,
            clientToken: result.clientToken,
            expiresAt: result.expiresAt
        });
    } catch (err: any) {
        console.error('[DEV-CHALLENGE] Error inicializando reto:', err);
        return res.status(500).json({ error: 'Fallo al iniciar sesión de desafío DEV' });
    }
};

/**
 * GET /api/dev/auth/challenge/confirm
 * Confirma el acceso desde el enlace en el email y redirige estrictamente a `env.WEB_URL` (sin Host Header Injection).
 */
export const confirmDevChallenge = async (req: Request, res: Response) => {
    try {
        const cid = typeof req.query.cid === 'string' ? req.query.cid.trim() : '';
        const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

        const result = await DevChallengeService.confirmChallenge(cid, token);
        if (result.redirectUrl) {
            return res.redirect(302, result.redirectUrl);
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(result.status).send(result.html || '');
    } catch (err: any) {
        console.error('[DEV-CHALLENGE] Error confirmando reto:', err);
        return res.status(500).send('Error interno procesando confirmación.');
    }
};

/**
 * GET /api/dev/auth/challenge/status/:id
 */
export const getDevChallengeStatus = async (req: Request, res: Response) => {
    try {
        const challengeId = String(req.params.id || '').trim();
        const clientToken = typeof req.query.clientToken === 'string' ? req.query.clientToken.trim() : '';

        if (!challengeId || !clientToken) {
            return res.status(400).json({ error: 'Parámetros requeridos ausentes' });
        }

        const result = await DevChallengeService.getChallengeStatus(challengeId, clientToken);
        return res.status(200).json(result);
    } catch (err: any) {
        console.error('[DEV-CHALLENGE] Error consultando estado:', err);
        return res.status(500).json({ error: 'Error al consultar estado' });
    }
};

const verifyOtpSchema = z.object({
    challengeId: z.string().uuid(),
    clientToken: z.string().min(10).max(256),
    otp: z.string().length(6).regex(/^\d{6}$/)
});

/**
 * POST /api/dev/auth/challenge/verify-otp
 */
export const verifyDevChallengeOtp = async (req: Request, res: Response) => {
    try {
        const parsed = verifyOtpSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Código dinámico inválido', details: parsed.error.format() });
        }

        const { challengeId, clientToken, otp } = parsed.data;
        const result = await DevChallengeService.verifyOtp(challengeId, clientToken, otp);

        if (!result.success) {
            return res.status(401).json({
                error: result.error || 'Código incorrecto',
                attemptsRemaining: result.attemptsRemaining
            });
        }

        return res.status(200).json({
            success: true,
            stepToken: result.stepToken
        });
    } catch (err: any) {
        console.error('[DEV-CHALLENGE] Error validando OTP:', err);
        return res.status(500).json({ error: 'Fallo al verificar clave dinámica' });
    }
};

const verifyUserSchema = z.object({
    challengeId: z.string().uuid(),
    clientToken: z.string().min(10).max(256),
    stepToken: z.string().min(10).max(256),
    username: z.string().email()
});

/**
 * POST /api/dev/auth/challenge/verify-user
 */
export const verifyDevChallengeUser = async (req: Request, res: Response) => {
    try {
        const parsed = verifyUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Identidad con formato inválido', details: parsed.error.format() });
        }

        const { challengeId, clientToken, stepToken, username } = parsed.data;
        const result = await DevChallengeService.verifyUser(challengeId, clientToken, stepToken, username);

        if (!result.valid) {
            return res.status(401).json({ error: result.error || 'Identidad no autorizada' });
        }

        return res.status(200).json({
            valid: true,
            requiresPasswordRotation: result.requiresPasswordRotation,
            daysRemaining: result.daysRemaining
        });
    } catch (err: any) {
        console.error('[DEV-CHALLENGE] Error verificando usuario:', err);
        return res.status(500).json({ error: 'Fallo al verificar identidad' });
    }
};

const loginFinalSchema = z.object({
    challengeId: z.string().uuid(),
    clientToken: z.string().min(10).max(256),
    stepToken: z.string().min(10).max(256),
    username: z.string().email(),
    password: z.string().min(1).max(256),
    newPassword: z.string().max(256).optional()
});

/**
 * POST /api/dev/auth/challenge/login-final
 */
export const loginDevChallengeFinal = async (req: Request, res: Response) => {
    try {
        const parsed = loginFinalSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Datos de acceso incompletos', details: parsed.error.format() });
        }

        const { challengeId, clientToken, stepToken, username, password, newPassword } = parsed.data;
        const result = await DevChallengeService.loginFinal(challengeId, clientToken, stepToken, username, password, newPassword);

        if (!result.success) {
            return res.status(401).json({ error: result.error || 'Credenciales inválidas' });
        }

        await AuditLedger.record({
            tenantId: 'dev-master-sandbox',
            actorUid: result.user?.uid || DEV_ROOT_UID,
            actorEmail: DEV_ROOT_EMAIL,
            action: 'DEV_ROOT_CHALLENGE_LOGIN',
            module: 'core',
            targetEntity: challengeId,
            details: { passwordRotated: Boolean(newPassword) },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            token: result.token,
            firebaseToken: result.firebaseToken,
            user: result.user
        });
    } catch (err: any) {
        console.error('[DEV-CHALLENGE] Error en login final:', err);
        return res.status(500).json({ error: 'Fallo al autenticar sesión DEV' });
    }
};

/**
 * POST /api/dev/auth/session-sync
 * Emite un customToken fresco para sincronizar Firebase Auth del navegador (Firestore / Storage)
 * cuando la cabina /dev opera bajo un Bearer token verificado de DEV_ROOT.
 */
export const syncDevFirebaseSession = async (_req: DevRequest, res: Response) => {
    try {
        let userRecord;
        try {
            userRecord = await auth.getUser(DEV_ROOT_UID);
        } catch {
            await ensureDevRootAccount();
            userRecord = await auth.getUser(DEV_ROOT_UID);
        }

        const uid = userRecord.uid;
        const devClaims = {
            role: 'DEV_ROOT',
            accountTier: 1,
            classification: 'dev-root',
            isMasterDev: true,
            suiteAccess: true,
        };
        await auth.setCustomUserClaims(uid, devClaims);

        const customToken = await auth.createCustomToken(uid, devClaims);

        return res.status(200).json({
            success: true,
            firebaseToken: customToken,
            uid,
            email: DEV_ROOT_EMAIL,
        });
    } catch (err: any) {
        console.error('[DEV-GATEWAY] Error sincronizando sesión Firebase DEV:', err);
        return res.status(500).json({ error: 'No fue posible sincronizar la sesión Firebase DEV.' });
    }
};

const listDevPilotFeedbackQuerySchema = z.object({
    module: z.enum(['core', 'opermaq', 'stockpile', 'supply']).optional(),
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED']).optional(),
});

const updateDevPilotFeedbackStatusSchema = z.object({
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED']),
    reviewNotes: z.string().max(1000).optional().nullable(),
    confirmationWord: z.string().max(32).optional(),
    confirmationKeyword: z.string().max(32).optional(),
});

/**
 * GET /api/dev/pilot-feedback
 * Bandeja soberana de retroalimentación TEST-PILOT para 1º DEV (DEV_ROOT).
 */
export const listDevPilotFeedback = async (req: DevRequest, res: Response) => {
    try {
        const parsedQuery = listDevPilotFeedbackQuerySchema.safeParse({
            module: typeof req.query.module === 'string' && req.query.module.trim() ? req.query.module.trim() : undefined,
            status: typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : undefined,
        });

        if (!parsedQuery.success) {
            return res.status(400).json({ error: 'Parámetros de filtro de feedback inválidos' });
        }

        const snap = await db.collection('pilot_feedback').orderBy('createdAt', 'desc').limit(100).get();
        const { module: modFilter, status: statusFilter } = parsedQuery.data;

        const items = snap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>))
            .filter((item) => {
                if (modFilter && item.module !== modFilter) return false;
                if (statusFilter && item.status !== statusFilter) return false;
                return true;
            });

        return res.status(200).json({ success: true, items });
    } catch (error: any) {
        console.error('[DEV-PILOT-FEEDBACK] Error listando feedback:', error);
        return res.status(500).json({ error: error?.message || 'Error cargando bandeja pilot_feedback' });
    }
};

/**
 * PATCH /api/dev/pilot-feedback/:id/status
 * Curación exclusiva de 1º DEV con confirmación HITL obligatoria "ACTUALIZAR".
 */
export const updateDevPilotFeedbackStatus = async (req: DevRequest, res: Response) => {
    try {
        const feedbackId = z.string().min(1).max(128).safeParse(req.params.id);
        if (!feedbackId.success) {
            return res.status(400).json({ error: 'ID de feedback inválido' });
        }

        const parsed = updateDevPilotFeedbackStatusSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de estado inválido', details: parsed.error.format() });
        }

        const rawConfirm =
            parsed.data.confirmationKeyword ??
            parsed.data.confirmationWord ??
            (typeof req.headers['x-hitl-confirmation'] === 'string' ? req.headers['x-hitl-confirmation'] : '');
        if (String(rawConfirm).trim().toUpperCase() !== 'ACTUALIZAR') {
            return res.status(400).json({
                error: 'Confirmación HITL obligatoria: escriba exactamente "ACTUALIZAR" para actualizar el estado.',
            });
        }

        const docRef = db.collection('pilot_feedback').doc(feedbackId.data);
        const existingSnap = await docRef.get();
        if (!existingSnap.exists) {
            return res.status(404).json({ error: 'Registro de feedback no encontrado.' });
        }

        const existingData = existingSnap.data() || {};
        const prevStatus = String(existingData.status || 'OPEN');
        const nextStatus = parsed.data.status;
        const now = Date.now();
        const actorUid = String(req.devUser?.uid || DEV_ROOT_UID);
        const actorEmail = String(req.devUser?.email || DEV_ROOT_EMAIL);

        await docRef.update({
            status: nextStatus,
            reviewNotes: parsed.data.reviewNotes ?? null,
            curatedByUid: actorUid,
            curatedByEmail: actorEmail,
            curatedAt: now,
            updatedAt: now,
        });

        await AuditLedger.record({
            tenantId: String(existingData.tenantId || 'dev-master-sandbox'),
            actorUid,
            actorEmail,
            action: nextStatus === 'APPLIED_TO_AI' ? 'PILOT_FEEDBACK_PROMOTED_TO_AI' : 'PILOT_FEEDBACK_STATUS_UPDATED',
            module: 'test-pilot',
            targetEntity: feedbackId.data,
            details: {
                previousStatus: prevStatus,
                newStatus: nextStatus,
                hitlConfirmed: true,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({ success: true, id: feedbackId.data, status: nextStatus });
    } catch (error: any) {
        console.error('[DEV-PILOT-FEEDBACK] Error actualizando estado:', error);
        return res.status(500).json({ error: error?.message || 'Error actualizando estado de feedback' });
    }
};

async function readCollectionDocsSafe(collectionName: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    try {
        const snap = await db.collection(collectionName).get();
        const docs = Array.isArray(snap?.docs) ? snap.docs : [];
        return docs.map((d) => ({
            id: d.id,
            data: (typeof d.data === 'function' ? d.data() : {}) as Record<string, unknown>,
        }));
    } catch {
        return [];
    }
}

/**
 * GET /api/dev/pilot-metrics
 * Endpoint pasivo de monitoreo de métricas agregadas TEST-PILOT para 1º DEV.
 * Calcula contadores reales de solo lectura en Firestore (southamerica-west1)
 * sin exponer textos libres, IDs individuales ni PII.
 */
export const getDevPilotMetrics = async (_req: DevRequest, res: Response) => {
    try {
        const nowMs = Date.now();
        const [pilotDocs, assetDocs, stockpileDocs, interactionDocs] = await Promise.all([
            readCollectionDocsSafe('test_pilots'),
            readCollectionDocsSafe('tenant_assets'),
            readCollectionDocsSafe('stockpiles'),
            readCollectionDocsSafe('pilot_feedback'),
        ]);

        const pilots = {
            total: 0,
            active: 0,
            expired: 0,
            revoked: 0,
        };
        const pilotTenantIds = new Set<string>();

        for (const doc of pilotDocs) {
            pilots.total += 1;
            const rawStatus = String(doc.data.status || 'ACTIVE').trim().toUpperCase();
            if (rawStatus === 'REVOKED' || rawStatus === 'SUSPENDED' || rawStatus === 'CANCELLED') {
                pilots.revoked += 1;
            } else if (rawStatus === 'EXPIRED' || evaluatePilotExpiration(doc.data.expiresAt, nowMs)) {
                pilots.expired += 1;
            } else {
                pilots.active += 1;
            }

            const accountId = String(doc.data.accountId || doc.id || '').trim();
            if (accountId.startsWith('pilot-')) {
                pilotTenantIds.add(accountId);
            }
        }

        let tenantAssetsCount = 0;
        for (const doc of assetDocs) {
            const tenantId = String(doc.data.tenantId ?? doc.data.tenant_id ?? '').trim();
            if (tenantId.startsWith('pilot-')) {
                tenantAssetsCount += 1;
                pilotTenantIds.add(tenantId);
            }
        }

        let stockpilesCount = 0;
        for (const doc of stockpileDocs) {
            const tenantId = String(doc.data.tenantId ?? doc.data.tenant_id ?? '').trim();
            if (tenantId.startsWith('pilot-')) {
                stockpilesCount += 1;
                pilotTenantIds.add(tenantId);
            }
        }

        const aiInteractions = {
            total: 0,
            byModule: {
                core: 0,
                opermaq: 0,
                geolapp: 0,
                stockpile: 0,
                supply: 0,
            },
            byCategory: {
                BUG_CORRECTION: 0,
                CHANGE_REQUEST: 0,
                AI_KNOWLEDGE_TRAINING: 0,
                FIELD_SIMULATION: 0,
            },
            byPriority: {
                LOW: 0,
                MEDIUM: 0,
                HIGH: 0,
                CRITICAL: 0,
            },
            byStatus: {
                PENDING: 0,
                REVIEWED: 0,
                APPLIED_TO_AI: 0,
                REJECTED: 0,
            },
            lastActivityAt: null as string | null,
        };

        let maxActivityMs = 0;
        for (const doc of interactionDocs) {
            aiInteractions.total += 1;

            const mod = String(doc.data.module || 'core').trim().toLowerCase();
            if (mod === 'opermaq') aiInteractions.byModule.opermaq += 1;
            else if (mod === 'geolapp') aiInteractions.byModule.geolapp += 1;
            else if (mod === 'stockpile') aiInteractions.byModule.stockpile += 1;
            else if (mod === 'supply') aiInteractions.byModule.supply += 1;
            else aiInteractions.byModule.core += 1;

            const cat = String(doc.data.category || 'AI_KNOWLEDGE_TRAINING').trim().toUpperCase();
            if (cat === 'BUG_CORRECTION') aiInteractions.byCategory.BUG_CORRECTION += 1;
            else if (cat === 'CHANGE_REQUEST') aiInteractions.byCategory.CHANGE_REQUEST += 1;
            else if (cat === 'FIELD_SIMULATION') aiInteractions.byCategory.FIELD_SIMULATION += 1;
            else aiInteractions.byCategory.AI_KNOWLEDGE_TRAINING += 1;

            const prio = String(doc.data.priority || 'MEDIUM').trim().toUpperCase();
            if (prio === 'LOW') aiInteractions.byPriority.LOW += 1;
            else if (prio === 'HIGH') aiInteractions.byPriority.HIGH += 1;
            else if (prio === 'CRITICAL') aiInteractions.byPriority.CRITICAL += 1;
            else aiInteractions.byPriority.MEDIUM += 1;

            const status = String(doc.data.status || 'OPEN').trim().toUpperCase();
            if (status === 'APPLIED_TO_AI') aiInteractions.byStatus.APPLIED_TO_AI += 1;
            else if (status === 'REJECTED') aiInteractions.byStatus.REJECTED += 1;
            else if (status === 'REVIEWED' || status === 'IN_REVIEW' || status === 'RESOLVED') {
                aiInteractions.byStatus.REVIEWED += 1;
            } else {
                aiInteractions.byStatus.PENDING += 1;
            }

            const docTs = Math.max(
                toEpochMillis(doc.data.updatedAt),
                toEpochMillis(doc.data.curatedAt),
                toEpochMillis(doc.data.createdAt),
                toEpochMillis(doc.data.timestamp)
            );
            if (docTs > maxActivityMs) {
                maxActivityMs = docTs;
            }
        }

        if (maxActivityMs > 0) {
            aiInteractions.lastActivityAt = new Date(maxActivityMs).toISOString();
        }

        return res.status(200).json({
            success: true,
            status: 'ACTIVE',
            region: 'southamerica-west1',
            generatedAt: new Date(nowMs).toISOString(),
            metrics: {
                pilots,
                sandboxes: {
                    pilotTenantsCount: pilotTenantIds.size,
                    tenantAssetsCount,
                    stockpilesCount,
                },
                aiInteractions,
            },
        });
    } catch (error: any) {
        console.error('[DEV-PILOT-METRICS] Error agregando telemetría:', error);
        return res.status(500).json({ error: error?.message || 'Error calculando métricas agregadas TEST-PILOT' });
    }
};
