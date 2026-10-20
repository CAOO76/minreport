import { Request, Response, NextFunction } from 'express';
import admin, { db, auth } from '../config/firebase';
import { z } from 'zod';
import { DEV_ROOT_EMAIL, DEV_ROOT_UID, ensureDevRootAccount } from '../services/bootstrap.service';

export interface DevRequest extends Request {
    devUser?: any;
}

/**
 * Middleware de protección de acceso exclusivo a la Cuenta Maestra DEV.
 */
export const requireDevRoot = async (req: DevRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Acceso no autorizado: Token ausente' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);

        const isDevRoot = 
            decodedToken.email?.toLowerCase() === DEV_ROOT_EMAIL.toLowerCase() ||
            decodedToken.role === 'DEV_ROOT' ||
            decodedToken.isMasterDev === true ||
            decodedToken.uid === DEV_ROOT_UID;

        if (!isDevRoot) {
            console.warn(`[DEV-GATEWAY] Intento de acceso denegado por: ${decodedToken.email}`);
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a Cuenta Maestra de Desarrollo (DEV_ROOT)' });
        }

        req.devUser = decodedToken;
        next();
    } catch (error) {
        console.error('[DEV-GATEWAY] Error de verificación de token DEV:', error);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

const devLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6)
});

/**
 * POST /api/dev/auth/login
 * Autenticación exclusiva para la URL secreta del Portal DEV.
 */
export const devLogin = async (req: Request, res: Response) => {
    try {
        const parsed = devLoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Credenciales inválidas', details: parsed.error.format() });
        }

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase().trim();

        if (normalizedEmail !== DEV_ROOT_EMAIL.toLowerCase()) {
            return res.status(401).json({ error: 'Credenciales no autorizadas en Gateway de Desarrollo' });
        }

        const expectedPassword = process.env.DEV_ROOT_PASSWORD || process.env.SUPER_ADMIN_PASSWORD;

        if (!expectedPassword) {
            console.error('[DEV-AUTH] DEV_ROOT_PASSWORD no configurado en entorno');
            return res.status(500).json({ error: 'Configuración de credenciales de desarrollo no encontrada en servidor' });
        }

        if (password !== expectedPassword) {
            return res.status(401).json({ error: 'Credenciales no autorizadas en Gateway de Desarrollo' });
        }

        // Asegurar que el usuario existe en Firebase Auth (autocorrección bajo demanda)
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

        // Claims soberanos DEV
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

        // Intercambiar por ID token para compatibilidad de Bearer
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
    collaboratorName: z.string().min(2),
    collaboratorEmail: z.string().email(),
    organization: z.string().optional(),
    purpose: z.string().min(3),
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

        // 1. Crear o recuperar usuario en Firebase Auth
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
        } catch (e: any) {
            if (e.code === 'auth/user-not-found') {
                const tempPassword = `Pilot${Math.random().toString(36).slice(-6)}!2026`;
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
        const pilotAccountId = `pilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const expiresAt = Date.now() + expiresDays * 24 * 60 * 60 * 1000;

        // 2. Crear registro en colección segregada /test_pilots
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

        // 3. Crear Workspace de cuenta en /accounts con clasificación 'test-pilot'
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
                    'mining-flow': true,
                    miningFlow: true
                }
            },
            enabledPlugins: ['opermaq', 'stockpile', 'mining-flow'],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await db.collection('accounts').doc(pilotAccountId).set(accountData);

        // 4. Agregar membresía de colaborador
        await db.collection('accounts').doc(pilotAccountId).collection('members').doc(pilotUserId).set({
            id: pilotUserId,
            userId: pilotUserId,
            fullName: collaboratorName,
            email: normalizedEmail,
            role: 'PILOT_LEAD',
            status: 'ACTIVE',
            joinedAt: Date.now()
        });

        // 5. Asignar custom claim a usuario
        await auth.setCustomUserClaims(pilotUserId, {
            role: 'TEST_PILOT',
            activeAccountId: pilotAccountId,
            pilotExpiresAt: expiresAt
        });

        // 6. Actualizar perfil /users
        await db.collection('users').doc(pilotUserId).set({
            uid: pilotUserId,
            email: normalizedEmail,
            displayName: collaboratorName,
            role: 'TEST_PILOT',
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

        console.log(`[TEST-PILOT] ✅ Cuenta creada para colaborador: ${normalizedEmail} (ID: ${pilotAccountId})`);

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
export const listTestPilots = async (req: DevRequest, res: Response) => {
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
        const { id } = req.params;
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

        console.log(`[TEST-PILOT] 🚫 Cuenta piloto ${id} revocada por ${DEV_ROOT_EMAIL}`);
        return res.status(200).json({ success: true, message: 'Acceso a cuenta piloto revocado' });
    } catch (error: any) {
        console.error('[TEST-PILOT] Error revocando piloto:', error);
        return res.status(500).json({ error: 'Fallo al revocar cuenta piloto' });
    }
};

/**
 * POST /api/dev/impersonate-client
 * Genera sesión de prueba de vista previa de cliente (View-as Client) para la cuenta DEV.
 */
export const impersonateClient = async (req: DevRequest, res: Response) => {
    try {
        const { targetAccountId } = req.body as { targetAccountId?: string };
        const accountId = targetAccountId || 'dev-master-sandbox';

        const accountDoc = await db.collection('accounts').doc(accountId).get();
        if (!accountDoc.exists) {
            return res.status(404).json({ error: 'Cuenta objetivo no encontrada' });
        }

        const accountData = accountDoc.data()!;

        // Token de simulación con claims de impersonación
        const impersonationToken = await auth.createCustomToken(DEV_ROOT_UID, {
            role: 'CLIENT_OWNER',
            activeAccountId: accountId,
            isImpersonating: true,
            realActor: DEV_ROOT_EMAIL,
            targetAccountName: accountData.name || 'Sandbox Client'
        });

        // Intercambio por ID token para llamadas de API
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
