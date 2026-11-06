import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db, auth } from '../config/firebase';
import { z } from 'zod';
import { resolveDevRootPassword } from '../config/secrets';
import { constantTimeEqualStrings } from '../utils/security';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { DEV_ROOT_EMAIL, DEV_ROOT_UID, ensureDevRootAccount } from '../services/bootstrap.service';
import { DevChallengeService } from '../services/dev-challenge.service';

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
        console.error('[DEV-GATEWAY] Error de verificación de token DEV:', error);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

const devLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6).max(256)
});

/**
 * POST /api/dev/auth/login
 * Autenticación exclusiva para el Portal DEV con comparación en tiempo constante.
 */
export const devLogin = async (req: Request, res: Response) => {
    try {
        const parsed = devLoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Credenciales inválidas', details: parsed.error.format() });
        }

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase().trim();

        if (normalizedEmail !== DEV_ROOT_EMAIL.toLowerCase() || !password.trim()) {
            return res.status(401).json({ error: 'Credenciales no autorizadas en Gateway de Desarrollo' });
        }

        const expectedPassword = (await resolveDevRootPassword())?.trim() || '';

        if (!expectedPassword) {
            console.error('[DEV-AUTH] DEV_ROOT_PASSWORD no configurado en Secret Manager / entorno');
            return res.status(503).json({ error: 'Configuración de credenciales de desarrollo no disponible en servidor' });
        }

        if (!constantTimeEqualStrings(password, expectedPassword)) {
            return res.status(401).json({ error: 'Credenciales no autorizadas en Gateway de Desarrollo' });
        }

        let userRecord;
        try {
            userRecord = await auth.getUser(DEV_ROOT_UID);
        } catch {
            try {
                userRecord = await auth.getUserByEmail(DEV_ROOT_EMAIL);
            } catch {
                await ensureDevRootAccount();
                userRecord = await auth.getUser(DEV_ROOT_UID);
            }
        }

        const uid = userRecord.uid;

        await auth.setCustomUserClaims(uid, {
            role: 'DEV_ROOT',
            isMasterDev: true,
            suiteAccess: true
        });

        const customToken = await auth.createCustomToken(uid, {
            role: 'DEV_ROOT',
            isMasterDev: true,
            suiteAccess: true
        });

        let idToken = customToken;
        const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || 'fake-api-key';
        const url = emulatorHost
            ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`
            : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

        try {
            const exchangeResp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: customToken, returnSecureToken: true })
            });
            if (exchangeResp.ok) {
                const data: any = await exchangeResp.json();
                idToken = data.idToken || customToken;
            }
        } catch (e) {
            console.warn('[DEV-AUTH] Token exchange warning:', e);
        }

        await AuditLedger.record({
            tenantId: 'dev-master-sandbox',
            actorUid: uid,
            actorEmail: DEV_ROOT_EMAIL,
            action: 'DEV_ROOT_LOGIN',
            module: 'core',
            targetEntity: uid,
            details: { method: 'dev_login' },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            token: idToken,
            firebaseToken: customToken,
            user: {
                uid,
                email: DEV_ROOT_EMAIL,
                role: 'DEV_ROOT',
                isMasterDev: true
            }
        });
    } catch (error: any) {
        console.error('[DEV-AUTH] Error en login DEV:', error);
        return res.status(500).json({ error: 'Fallo interno en autenticación de desarrollo' });
    }
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
                    stockpile: true
                }
            },
            enabledPlugins: ['opermaq', 'stockpile'],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await db.collection('accounts').doc(pilotAccountId).set(accountData);

        await db.collection('accounts').doc(pilotAccountId).collection('members').doc(pilotUserId).set({
            id: pilotUserId,
            userId: pilotUserId,
            fullName: collaboratorName,
            email: normalizedEmail,
            role: 'PILOT_LEAD',
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
            primaryAccountId: pilotAccountId,
            memberships: [
                {
                    accountId: pilotAccountId,
                    accountName: accountData.name,
                    role: 'PILOT_LEAD',
                    classification: 'test-pilot',
                    status: 'ACTIVE',
                    joinedAt: Date.now()
                }
            ],
            updatedAt: Date.now()
        }, { merge: true });

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
            pilot: pilotMetadata
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
            revokedBy: DEV_ROOT_EMAIL
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
            await auth.setCustomUserClaims(pilotData.userId, {
                role: 'REVOKED',
            }).catch(() => {});
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

const impersonateClientSchema = z.object({
    targetAccountId: z.string().min(2).max(128).optional(),
});

/**
 * POST /api/dev/impersonate-client
 * Genera sesión de vista previa de cliente (View-as Client) para la cuenta DEV.
 */
export const impersonateClient = async (req: DevRequest, res: Response) => {
    try {
        const parsed = impersonateClientSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'Parámetros de simulación inválidos' });
        }
        const accountId = parsed.data.targetAccountId || 'dev-master-sandbox';

        const accountDoc = await db.collection('accounts').doc(accountId).get();
        if (!accountDoc.exists) {
            return res.status(404).json({ error: 'Cuenta objetivo no encontrada' });
        }

        const accountData = accountDoc.data()!;

        const impersonationToken = await auth.createCustomToken(DEV_ROOT_UID, {
            role: 'CLIENT_OWNER',
            activeAccountId: accountId,
            isImpersonating: true,
            realActor: DEV_ROOT_EMAIL,
            targetAccountName: accountData.name || 'Sandbox Client'
        });

        let idToken = impersonationToken;
        const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || 'fake-api-key';
        const url = emulatorHost
            ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`
            : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

        try {
            const exchangeResp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: impersonationToken, returnSecureToken: true })
            });
            if (exchangeResp.ok) {
                const data: any = await exchangeResp.json();
                idToken = data.idToken || impersonationToken;
            }
        } catch (e) {
            console.warn('[DEV-IMPERSONATE] Token exchange warning:', e);
        }

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: req.devUser?.uid || DEV_ROOT_UID,
            actorEmail: req.devUser?.email || DEV_ROOT_EMAIL,
            action: 'DEV_IMPERSONATE_TENANT',
            module: 'core',
            targetEntity: accountId,
            details: { targetAccountName: accountData.name || '' },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            impersonationToken,
            token: idToken,
            simulatedAccount: {
                id: accountId,
                name: accountData.name,
                classification: accountData.classification || 'b2b-corporate',
                licensing: accountData.licensing
            }
        });
    } catch (error: any) {
        console.error('[DEV-IMPERSONATE] Error simulando cliente:', error);
        return res.status(500).json({ error: 'Error al generar sesión simulada de cliente' });
    }
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
        await auth.setCustomUserClaims(uid, {
            role: 'DEV_ROOT',
            isMasterDev: true,
            suiteAccess: true,
        });

        const customToken = await auth.createCustomToken(uid, {
            role: 'DEV_ROOT',
            isMasterDev: true,
            suiteAccess: true,
        });

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
