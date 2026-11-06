import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import admin, { db, auth } from '../config/firebase';
import { env, getCanonicalApiUrl, getCanonicalWebUrl } from '../config/env';
import { resolveDevRootPassword } from '../config/secrets';
import { constantTimeEqualStrings } from '../utils/security';
import { DEV_ROOT_EMAIL, DEV_ROOT_UID, ensureDevRootAccount } from './bootstrap.service';
import { EmailService } from './EmailService';

/**
 * Obtiene dinámicamente la IP de red local del equipo (ej. Wi-Fi 192.168.x.x)
 * para permitir confirmación out-of-band desde dispositivos móviles en entorno de desarrollo local.
 */
export const getLocalLanIp = (): string => {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch { }
    return '127.0.0.1';
};

export interface DevChallengeRecord {
    id: string;
    clientTokenHash: string;
    clientToken?: string;
    emailTokenHash: string;
    otpHash: string;
    status: 'PENDING_EMAIL' | 'EMAIL_CONFIRMED' | 'OTP_VERIFIED' | 'COMPLETED' | 'REVOKED';
    attemptsRemaining: number;
    ip: string;
    userAgent: string;
    createdAt: number;
    expiresAt: number;
    confirmedAt?: number;
    verifiedAt?: number;
    stepTokenHash?: string;
}

export interface DevCredentialsMeta {
    passwordHash: string;
    salt: string;
    passwordRotatedAt: number;
    rotationDays: number;
    lastWarningEmailAt?: number;
}

const CHALLENGE_COLLECTION = 'dev_challenges';
const META_COLLECTION = 'system_dev_meta';
const CREDENTIALS_DOC = 'credentials';
const ROTATION_DAYS = 30;
const TTL_MS = 180 * 1000; // 3 minutos de validez estricta

const sha256 = (data: string): string => {
    return crypto.createHash('sha256').update(data).digest('hex');
};

const hashPassword = (password: string, salt: string): string => {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
};

/**
 * Servicio Soberano para el Gateway de Desarrollo MINREPORT (Zero-Trust & Out-of-Band Challenge)
 */
export class DevChallengeService {
    /**
     * Asegura que exista el registro de credenciales con política de rotación de 30 días.
     * Nunca utiliza contraseñas maestras literales hardcodeadas en el código fuente.
     */
    static async ensureCredentialsMeta(): Promise<DevCredentialsMeta | null> {
        const docRef = db.collection(META_COLLECTION).doc(CREDENTIALS_DOC);
        const snapshot = await docRef.get();

        if (snapshot.exists) {
            return snapshot.data() as DevCredentialsMeta;
        }

        const configuredDevPassword = (await resolveDevRootPassword())?.trim() || '';
        if (!configuredDevPassword) {
            return null;
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword(configuredDevPassword, salt);

        const initialMeta: DevCredentialsMeta = {
            passwordHash,
            salt,
            passwordRotatedAt: Date.now(),
            rotationDays: ROTATION_DAYS
        };

        await docRef.set(initialMeta);
        console.log('[DEV-CHALLENGE] Metadatos de rotación de credenciales DEV inicializados (30 días de vigencia).');
        return initialMeta;
    }

    /**
     * Paso 1: Inicializa un reto efímero al presionar el Isotipo en la web silenciosa.
     */
    static async initChallenge(
        ip: string,
        userAgent: string
    ): Promise<{ challengeId: string; clientToken: string; expiresAt: number }> {
        await this.ensureCredentialsMeta();

        const challengeId = crypto.randomUUID();
        const clientToken = crypto.randomBytes(24).toString('hex');
        const emailToken = crypto.randomBytes(32).toString('hex');

        const otpNumber = crypto.randomInt(100000, 1000000);
        const otp = otpNumber.toString();
        const otpHash = sha256(otp);

        const createdAt = Date.now();
        const expiresAt = createdAt + TTL_MS;

        const record: DevChallengeRecord = {
            id: challengeId,
            clientTokenHash: sha256(clientToken),
            clientToken,
            emailTokenHash: sha256(emailToken),
            otpHash,
            status: 'PENDING_EMAIL',
            attemptsRemaining: 3,
            ip: ip || '127.0.0.1',
            userAgent: userAgent || 'Desconocido',
            createdAt,
            expiresAt
        };

        await db.collection(CHALLENGE_COLLECTION).doc(challengeId).set(record);

        const apiBase = getCanonicalApiUrl();
        const confirmLinkLocal = `${apiBase}/api/dev/auth/challenge/confirm?cid=${challengeId}&token=${emailToken}`;

        if (env.NODE_ENV !== 'production') {
            console.log(`[DEV-CHALLENGE] Solicitud creada [${challengeId}]. OTP Dinámico: [${otp}]`);
            console.log(`[DEV-CHALLENGE] Enlace de Confirmación: ${confirmLinkLocal}`);
        } else {
            console.log(`[DEV-CHALLENGE] Solicitud OOB creada [${challengeId}].`);
        }

        let logoAttachment: any = null;
        try {
            const logoPath = path.join(process.cwd(), 'web/public/branding/master_logotype.png');
            if (fs.existsSync(logoPath)) {
                logoAttachment = {
                    filename: 'master_logotype.png',
                    content: fs.readFileSync(logoPath).toString('base64'),
                    content_type: 'image/png',
                    contentType: 'image/png',
                    contentId: 'minreport-logo',
                    content_id: 'minreport-logo'
                };
            }
        } catch {
            // Continuar sin logo inline si no está disponible en el contenedor de API
        }

        const buildEmailHtml = (otpDisplay: string) => `
            <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; padding: 21px 0; max-width: 480px; background: transparent;">
                <div style="margin-bottom: 21px;">
                    <img src="cid:minreport-logo" alt="MINREPORT" height="22" width="197" style="height: 22px; width: 197px; border: 0; outline: none; display: block;" />
                </div>
                <div style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 11px; letter-spacing: 0.15em; color: #C68346; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">
                    MINREPORT // DEV
                </div>
                <div style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 42px; font-weight: 700; letter-spacing: 0.25em; font-variant-numeric: tabular-nums; color: #0F172A; margin: 13px 0;">
                    ${otpDisplay}
                </div>
                <div style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 11px; color: #8A93A6; margin-top: 13px;">
                    180s // ${new Date().toISOString()}
                </div>
            </div>
        `;

        const targetEmail = process.env.DEV_NOTIFICATION_EMAIL || process.env.DEV_ROOT_EMAIL || DEV_ROOT_EMAIL;

        try {
            await EmailService.sendEmail({
                from: 'MINREPORT Dev Gateway <no-reply@minreport.com>',
                to: targetEmail,
                subject: `MINREPORT // DEV // ${otp}`,
                html: buildEmailHtml(otp),
                attachments: logoAttachment ? [logoAttachment] : undefined,
                redactSensitiveOtp: true,
            });
        } catch (emailErr: any) {
            console.warn('[DEV-CHALLENGE] Aviso de despacho de email:', emailErr?.message || emailErr);
            try {
                await db.collection('system_emails').add({
                    to: targetEmail,
                    subject: '[RESPALDO DEV] Solicitud de acceso DEV',
                    body: buildEmailHtml('[OTP_REDACTED]'),
                    challengeId,
                    otp: '[OTP_REDACTED]',
                    otpHash,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch { }
        }

        return {
            challengeId,
            clientToken,
            expiresAt
        };
    }

    /**
     * Paso 2: Confirma el acceso desde el enlace en el email.
     * Redirige estrictamente a la URL web canónica (`env.WEB_URL`) sin confiar en `req.get('host')`.
     */
    static async confirmChallenge(
        challengeId: string,
        token: string
    ): Promise<{ success: boolean; redirectUrl?: string; html?: string; status: number }> {
        const webBase = getCanonicalWebUrl();

        if (!challengeId || !token) {
            return {
                success: false,
                status: 302,
                redirectUrl: `${webBase}/dev?error=${encodeURIComponent('Parámetros de confirmación incompletos.')}`
            };
        }

        const docRef = db.collection(CHALLENGE_COLLECTION).doc(challengeId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            return {
                success: false,
                status: 302,
                redirectUrl: `${webBase}/dev?error=${encodeURIComponent('Sesión efímera no encontrada o ya expirada.')}`
            };
        }

        const record = snapshot.data() as DevChallengeRecord;

        if (Date.now() > record.expiresAt) {
            await docRef.update({ status: 'REVOKED' });
            return {
                success: false,
                status: 302,
                redirectUrl: `${webBase}/dev?error=${encodeURIComponent('El enlace de confirmación ha caducado (180s). Inicie una nueva solicitud.')}`
            };
        }

        if (record.status === 'REVOKED') {
            return {
                success: false,
                status: 302,
                redirectUrl: `${webBase}/dev?error=${encodeURIComponent('La sesión ha sido revocada por exceso de intentos o cancelación.')}`
            };
        }

        if (!constantTimeEqualStrings(sha256(token), record.emailTokenHash)) {
            return {
                success: false,
                status: 302,
                redirectUrl: `${webBase}/dev?error=${encodeURIComponent('Token de confirmación inválido.')}`
            };
        }

        if (record.status === 'PENDING_EMAIL') {
            await docRef.update({
                status: 'EMAIL_CONFIRMED',
                confirmedAt: Date.now()
            });
        }

        const clientToken = record.clientToken || '';
        return {
            success: true,
            status: 302,
            redirectUrl: `${webBase}/dev?cid=${encodeURIComponent(challengeId)}&token=${encodeURIComponent(clientToken)}`
        };
    }

    /**
     * Consulta de estado silenciosa por parte del cliente web (sin exponer OTP).
     */
    static async getChallengeStatus(challengeId: string, clientToken: string): Promise<{ status: string; attemptsRemaining: number }> {
        const docRef = db.collection(CHALLENGE_COLLECTION).doc(challengeId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            return { status: 'REVOKED', attemptsRemaining: 0 };
        }

        const record = snapshot.data() as DevChallengeRecord;

        if (!constantTimeEqualStrings(sha256(clientToken), record.clientTokenHash)) {
            return { status: 'REVOKED', attemptsRemaining: 0 };
        }

        if (Date.now() > record.expiresAt && record.status !== 'COMPLETED') {
            await docRef.update({ status: 'REVOKED' });
            return { status: 'REVOKED', attemptsRemaining: 0 };
        }

        return {
            status: record.status,
            attemptsRemaining: record.attemptsRemaining
        };
    }

    /**
     * Paso 3: Validación del OTP de 6 dígitos ingresado físicamente en la web.
     */
    static async verifyOtp(challengeId: string, clientToken: string, inputOtp: string): Promise<{ success: boolean; stepToken?: string; error?: string; attemptsRemaining?: number }> {
        const docRef = db.collection(CHALLENGE_COLLECTION).doc(challengeId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            return { success: false, error: 'Sesión no encontrada' };
        }

        const record = snapshot.data() as DevChallengeRecord & { otp?: string };

        if (!constantTimeEqualStrings(sha256(clientToken), record.clientTokenHash)) {
            return { success: false, error: 'Cliente no autorizado' };
        }

        if (Date.now() > record.expiresAt) {
            await docRef.update({ status: 'REVOKED' });
            return { success: false, error: 'Sesión expirada' };
        }

        if (record.status !== 'EMAIL_CONFIRMED' && record.status !== 'PENDING_EMAIL') {
            return { success: false, error: 'Sesión no válida o ya utilizada' };
        }

        const cleanOtp = (inputOtp || '').trim();
        const expectedOtpHash = record.otpHash || (record.otp ? sha256(record.otp) : '');

        if (!cleanOtp || !expectedOtpHash || !constantTimeEqualStrings(sha256(cleanOtp), expectedOtpHash)) {
            const nextAttempts = record.attemptsRemaining - 1;
            if (nextAttempts <= 0) {
                await docRef.update({ status: 'REVOKED', attemptsRemaining: 0 });
                return { success: false, error: 'Límite de intentos superado. Sesión autodestruida.', attemptsRemaining: 0 };
            }
            await docRef.update({ attemptsRemaining: nextAttempts });
            return { success: false, error: 'Código dinámico incorrecto', attemptsRemaining: nextAttempts };
        }

        const stepToken = crypto.randomBytes(32).toString('hex');
        await docRef.update({
            status: 'OTP_VERIFIED',
            verifiedAt: Date.now(),
            stepTokenHash: sha256(stepToken)
        });

        return {
            success: true,
            stepToken
        };
    }

    /**
     * Paso 4: Validación del Usuario DEV y verificación de política de rotación (30 días).
     */
    static async verifyUser(challengeId: string, clientToken: string, stepToken: string, username: string): Promise<{ valid: boolean; requiresPasswordRotation: boolean; daysRemaining: number; error?: string }> {
        const docRef = db.collection(CHALLENGE_COLLECTION).doc(challengeId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            return { valid: false, requiresPasswordRotation: false, daysRemaining: 0, error: 'Sesión no encontrada' };
        }

        const record = snapshot.data() as DevChallengeRecord;

        if (
            !record.stepTokenHash ||
            !constantTimeEqualStrings(sha256(clientToken), record.clientTokenHash) ||
            !constantTimeEqualStrings(sha256(stepToken), record.stepTokenHash)
        ) {
            return { valid: false, requiresPasswordRotation: false, daysRemaining: 0, error: 'Permisos insuficientes' };
        }

        if (record.status !== 'OTP_VERIFIED') {
            return { valid: false, requiresPasswordRotation: false, daysRemaining: 0, error: 'Fase OTP pendiente' };
        }

        const cleanUsername = (username || '').trim().toLowerCase();
        if (cleanUsername !== DEV_ROOT_EMAIL.toLowerCase()) {
            return { valid: false, requiresPasswordRotation: false, daysRemaining: 0, error: 'Identidad no autorizada' };
        }

        const creds = await this.ensureCredentialsMeta();
        if (!creds) {
            return {
                valid: false,
                requiresPasswordRotation: false,
                daysRemaining: 0,
                error: 'Credenciales maestras DEV no configuradas en Secret Manager / entorno.'
            };
        }

        const elapsedMs = Date.now() - creds.passwordRotatedAt;
        const maxMs = (creds.rotationDays || ROTATION_DAYS) * 24 * 60 * 60 * 1000;
        const requiresPasswordRotation = elapsedMs >= maxMs;
        const daysRemaining = Math.max(0, Math.ceil((maxMs - elapsedMs) / (24 * 60 * 60 * 1000)));

        return {
            valid: true,
            requiresPasswordRotation,
            daysRemaining
        };
    }

    /**
     * Paso 5: Autenticación final con Clave Tradicional en tiempo constante (o renovación si expiró).
     */
    static async loginFinal(
        challengeId: string,
        clientToken: string,
        stepToken: string,
        username: string,
        password: string,
        newPassword?: string
    ): Promise<{ success: boolean; token?: string; firebaseToken?: string; user?: any; error?: string }> {
        if (!password || !password.trim()) {
            return { success: false, error: 'Clave tradicional no autorizada' };
        }

        const docRef = db.collection(CHALLENGE_COLLECTION).doc(challengeId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            return { success: false, error: 'Sesión no encontrada' };
        }

        const record = snapshot.data() as DevChallengeRecord;

        if (
            !record.stepTokenHash ||
            !constantTimeEqualStrings(sha256(clientToken), record.clientTokenHash) ||
            !constantTimeEqualStrings(sha256(stepToken), record.stepTokenHash)
        ) {
            return { success: false, error: 'Permisos insuficientes' };
        }

        if (record.status !== 'OTP_VERIFIED') {
            return { success: false, error: 'Fase OTP no completada' };
        }

        const cleanUsername = (username || '').trim().toLowerCase();
        if (cleanUsername !== DEV_ROOT_EMAIL.toLowerCase()) {
            return { success: false, error: 'Identidad no autorizada' };
        }

        const credsRef = db.collection(META_COLLECTION).doc(CREDENTIALS_DOC);
        const creds = await this.ensureCredentialsMeta();
        const configuredDevPassword = (await resolveDevRootPassword())?.trim() || '';

        const matchesStoredHash = creds
            ? constantTimeEqualStrings(hashPassword(password, creds.salt), creds.passwordHash)
            : false;

        const matchesEnvPassword = configuredDevPassword
            ? constantTimeEqualStrings(password, configuredDevPassword) ||
              constantTimeEqualStrings(password.trim(), configuredDevPassword)
            : false;

        if (!matchesStoredHash && !matchesEnvPassword) {
            return { success: false, error: 'Clave tradicional no autorizada' };
        }

        let effectiveCreds = creds;
        if (!matchesStoredHash && matchesEnvPassword) {
            const cleanPass = password.trim();
            const newSalt = crypto.randomBytes(16).toString('hex');
            const newHash = hashPassword(cleanPass, newSalt);
            effectiveCreds = {
                passwordHash: newHash,
                salt: newSalt,
                passwordRotatedAt: Date.now(),
                rotationDays: ROTATION_DAYS
            };
            await credsRef.set(effectiveCreds, { merge: true }).catch(() => {});
        }

        const elapsedMs = effectiveCreds ? Date.now() - effectiveCreds.passwordRotatedAt : 0;
        const maxMs = ((effectiveCreds?.rotationDays || ROTATION_DAYS) * 24 * 60 * 60 * 1000);
        const isExpired = elapsedMs >= maxMs;

        if (isExpired || (newPassword && newPassword.trim().length >= 8)) {
            if (!newPassword || newPassword.trim().length < 8) {
                return { success: false, error: 'La clave ha expirado. Se requiere ingresar una nueva clave de al menos 8 caracteres.' };
            }

            const cleanNewPassword = newPassword.trim();
            if (constantTimeEqualStrings(cleanNewPassword, password.trim())) {
                return { success: false, error: 'La nueva clave debe ser diferente a la anterior.' };
            }

            const newSalt = crypto.randomBytes(16).toString('hex');
            const newHash = hashPassword(cleanNewPassword, newSalt);

            await credsRef.set({
                passwordHash: newHash,
                salt: newSalt,
                passwordRotatedAt: Date.now(),
                rotationDays: ROTATION_DAYS
            }, { merge: true });

            try {
                await auth.updateUser(DEV_ROOT_UID, { password: cleanNewPassword });
                console.log('[DEV-CHALLENGE] Clave DEV actualizada en Firebase Auth.');
            } catch (authErr) {
                console.warn('[DEV-CHALLENGE] Aviso actualizando Firebase Auth password:', authErr);
            }

            try {
                await EmailService.sendEmail({
                    from: 'MINREPORT Security <security@minreport.com>',
                    to: DEV_ROOT_EMAIL,
                    subject: '[SEGURIDAD] Rotación de Clave Maestra DEV Confirmada',
                    html: `
                        <div style="background-color: #000000; color: #F3F4F6; font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; padding: 34px; border: 1px solid #12151C;">
                            <h2 style="color: #C68346; margin-top: 0;">ROTACIÓN DE CLAVE DEV CONFIRMADA</h2>
                            <p style="color: #8A93A6;">La clave de acceso para ${DEV_ROOT_EMAIL} ha sido renovada exitosamente.</p>
                            <p style="color: #8A93A6;">Próxima rotación obligatoria programada para dentro de ${ROTATION_DAYS} días.</p>
                            <p style="color: #5A6072; font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 11px;">Fecha: ${new Date().toISOString()}</p>
                        </div>
                    `
                });
            } catch { }
        }

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
        const exchangeUrl = emulatorHost
            ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`
            : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

        try {
            const exchangeResp = await fetch(exchangeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: customToken, returnSecureToken: true })
            });
            if (exchangeResp.ok) {
                const data: any = await exchangeResp.json();
                idToken = data.idToken || customToken;
            }
        } catch (e) {
            console.warn('[DEV-CHALLENGE] Token exchange warning:', e);
        }

        await docRef.update({ status: 'COMPLETED' });

        return {
            success: true,
            token: idToken,
            firebaseToken: customToken,
            user: {
                uid,
                email: DEV_ROOT_EMAIL,
                role: 'DEV_ROOT',
                isMasterDev: true
            }
        };
    }
}
