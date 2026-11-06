import admin, { db, auth } from '../config/firebase';
import { Response, Router } from 'express';
import { z } from 'zod';
import { EmailService } from '../services/EmailService';
import { env, getCanonicalWebUrl } from '../config/env';
import { generateSetupToken } from '../utils/security';
import { formatRut, cleanRut, validateRut, getRutVariants } from '../utils/rut';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';

const router = Router();

// Todas las rutas de gestión de personal interno exigen sesión verificada
router.use(requireAuth);

const StaffMemberPayloadSchema = z.object({
    email: z.string().email('Formato de correo corporativo inválido'),
    displayName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(140),
    run: z.string().min(7, 'RUN inválido').max(20).refine((val) => validateRut(val), {
        message: 'RUN chileno inválido (dígito verificador no coincide)',
    }),
    accountId: z.string().min(1, 'El ID de cuenta es obligatorio').max(128),
    accountName: z.string().min(1, 'El nombre de cuenta es obligatorio').max(160),
});

/**
 * Verifica que el solicitante sea OWNER/ADMIN de `accountId` (o DEV_ROOT / SUPER_ADMIN)
 * y valida que la licencia de la cuenta permita crear usuarios internos (`allowInternalUsers !== false`).
 */
async function authorizeStaffMutation(
    req: AuthRequest,
    accountId: string
): Promise<{ ok: true; accountData: Record<string, any> } | { ok: false; status: number; error: string }> {
    const caller = req.user;
    if (!caller?.uid) {
        return { ok: false, status: 401, error: 'No autorizado: sesión ausente.' };
    }

    const callerUid = String(caller.uid);
    const callerEmail = String(caller.email || '').toLowerCase();
    const emailVerifiedOk = caller.email_verified !== false;
    const tokenRole = String(caller.role || '').toUpperCase();

    const isGlobalSovereign =
        caller.isMasterDev === true ||
        caller.admin === true ||
        tokenRole === 'DEV_ROOT' ||
        tokenRole === 'SUPER_ADMIN' ||
        callerUid === 'dev-master-root-uid' ||
        callerUid === 'super-admin-uid' ||
        (emailVerifiedOk &&
            (callerEmail === 'dev@minreport.com' ||
                callerEmail === 'admin@minreport.com' ||
                callerEmail === env.SUPER_ADMIN_EMAIL.toLowerCase()));

    const accountSnap = await db.collection('accounts').doc(accountId).get();
    if (!accountSnap.exists) {
        return { ok: false, status: 404, error: 'Cuenta corporativa no encontrada.' };
    }

    const accountData = accountSnap.data() || {};
    const accountType = String(accountData.type || '').toUpperCase();
    const licensing = accountData.licensing || {};

    if (licensing.allowInternalUsers === false || accountType === 'EDUCATIONAL') {
        return {
            ok: false,
            status: 403,
            error: 'LICENCIA_RESTRINGIDA: Esta cuenta no permite dar de alta usuarios internos (entorno EDU / monousuario).',
        };
    }

    if (typeof licensing.maxUsers === 'number' && licensing.maxUsers > 0) {
        const membersCountSnap = await db
            .collection('accounts')
            .doc(accountId)
            .collection('members')
            .count()
            .get();
        if (membersCountSnap.data().count >= licensing.maxUsers) {
            return {
                ok: false,
                status: 403,
                error: `LIMITE_USUARIOS_ALCANZADO: La cuenta alcanzó el máximo permitido de ${licensing.maxUsers} usuarios.`,
            };
        }
    }

    if (isGlobalSovereign) {
        return { ok: true, accountData };
    }

    if (accountData.ownerId === callerUid) {
        return { ok: true, accountData };
    }

    const allowedRoles = new Set(['OWNER', 'ADMIN', 'ADMINISTRADOR OPERATIVO']);

    const userSnap = await db.collection('users').doc(callerUid).get();
    if (userSnap.exists) {
        const memberships = userSnap.data()?.memberships;
        if (Array.isArray(memberships)) {
            const mem = memberships.find((m: any) => m?.accountId === accountId);
            const memRole = String(mem?.role || '').toUpperCase();
            const memStatus = String(mem?.status || 'ACTIVE').toUpperCase();
            if (
                allowedRoles.has(memRole) &&
                memStatus !== 'SUSPENDED' &&
                memStatus !== 'REVOKED' &&
                memStatus !== 'INACTIVE'
            ) {
                return { ok: true, accountData };
            }
        }
    }

    const memberSnap = await db
        .collection('accounts')
        .doc(accountId)
        .collection('members')
        .doc(callerUid)
        .get();

    if (memberSnap.exists) {
        const memberData = memberSnap.data() || {};
        const memberRole = String(memberData.role || '').toUpperCase();
        const memberStatus = String(memberData.status || 'ACTIVE').toUpperCase();
        if (
            allowedRoles.has(memberRole) &&
            memberStatus !== 'SUSPENDED' &&
            memberStatus !== 'REVOKED' &&
            memberStatus !== 'INACTIVE'
        ) {
            return { ok: true, accountData };
        }
    }

    return {
        ok: false,
        status: 403,
        error: 'Prohibido: Se requiere rol OWNER o ADMIN sobre la cuenta objetivo.',
    };
}

async function upsertUserDirectoryEntry(params: {
    rawRun: string;
    fullName: string;
    uid: string;
    accountId: string;
    authEmail: string;
    role: string;
    accountName: string;
}): Promise<void> {
    const variants = getRutVariants(params.rawRun);
    const formattedRun = formatRut(cleanRut(params.rawRun));

    const entry = {
        accountId: params.accountId,
        uid: params.uid,
        authEmail: params.authEmail,
        role: params.role,
        type: 'BUSINESS',
        accountName: params.accountName,
        status: 'PENDING',
    };

    for (const variant of variants) {
        const ref = db.collection('user_directory').doc(variant);
        const snap = await ref.get();
        if (snap.exists) {
            const current = snap.data() || {};
            const filtered = (Array.isArray(current.accounts) ? current.accounts : []).filter(
                (a: any) => a?.accountId !== params.accountId
            );
            filtered.push(entry);
            await ref.update({
                uid: params.uid,
                run: formattedRun,
                fullName: params.fullName,
                accounts: filtered,
                updatedAt: new Date().toISOString(),
            });
        } else {
            await ref.set({
                uid: params.uid,
                run: formattedRun,
                fullName: params.fullName,
                accounts: [entry],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }
    }
}

/**
 * POST /api/staff/create-worker
 */
router.post('/create-worker', async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const validation = StaffMemberPayloadSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validación de datos de trabajador fallida',
                details: validation.error.format()
            });
        }

        const { email, displayName, run, accountId, accountName } = validation.data;

        const authz = await authorizeStaffMutation(req, accountId);
        if (!authz.ok) {
            return res.status(authz.status).json({ error: authz.error });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const cleanRun = cleanRut(run);
        const formattedRun = formatRut(cleanRun);

        let userRecord;
        let isNewUser = false;
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
        } catch (error: any) {
            if (error.code !== 'auth/user-not-found') {
                throw error;
            }
            try {
                userRecord = await auth.getUser(cleanRun);
                await auth.updateUser(cleanRun, { email: normalizedEmail });
            } catch (runErr: any) {
                if (runErr.code === 'auth/user-not-found') {
                    userRecord = await auth.createUser({
                        email: normalizedEmail,
                        emailVerified: false,
                        displayName,
                        disabled: false
                    });
                    isNewUser = true;
                } else {
                    throw runErr;
                }
            }
        }

        const { rawToken, hashedToken, expiresAt } = generateSetupToken();
        const baseUrl = getCanonicalWebUrl();
        const setupLink = `${baseUrl}/setup-access?accountId=${encodeURIComponent(accountId)}&taxId=${encodeURIComponent(cleanRun)}&name=${encodeURIComponent(displayName)}&accountName=${encodeURIComponent(accountName)}&type=BUSINESS&token=${encodeURIComponent(rawToken)}`;

        try {
            await EmailService.sendEmail({
                from: 'MINREPORT Onboarding <no-reply@minreport.com>',
                to: normalizedEmail,
                subject: 'Configuración de Acceso Operativo',
                html: `
                    <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                        <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 21px; margin-bottom: 21px;">
                            <p style="margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; text-transform: uppercase;">
                                ALTA OPERATIVA: ${displayName}
                            </p>
                            <p style="margin: 13px 0 0 0; font-size: 14px; line-height: 1.5;">
                                Has sido registrado como operador activo en <strong>${accountName}</strong>. Configura tu clave exclusiva en las próximas 24 horas.
                            </p>
                        </div>
                        <div style="text-align: center; margin: 34px 0;">
                            <a href="${setupLink}" style="background: #0F172A; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">
                                Configurar Credenciales
                            </a>
                        </div>
                    </div>
                `
            });
        } catch (emailError) {
            console.error('[Staff API] Error al enviar email:', emailError);
        }

        const userProfileRef = db.collection('users').doc(userRecord.uid);
        const userProfileSnap = await userProfileRef.get();
        const existingData = userProfileSnap.exists ? userProfileSnap.data() || {} : {};
        const existingMemberships = (Array.isArray(existingData.memberships) ? existingData.memberships : [])
            .filter((m: any) => m?.accountId !== accountId)
            .map(({ passwordHash: _ph, ...rest }: any) => rest);

        existingMemberships.push({
            accountId,
            role: 'OPERATOR',
            companyName: accountName,
            status: 'PENDING',
            joinedAt: Date.now()
        });

        const batch = db.batch();
        batch.set(
            userProfileRef,
            {
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                role: existingData.role || 'USER',
                taxId: existingData.taxId || formattedRun,
                memberships: existingMemberships,
                status: existingData.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
                updatedAt: Date.now()
            },
            { merge: true }
        );

        const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid);
        batch.set(memberRef, {
            userId: userRecord.uid,
            email: normalizedEmail,
            fullName: displayName,
            run: formattedRun,
            role: 'OPERATOR',
            status: 'PENDING',
            invitedAt: Date.now()
        });

        const tokenRef = db.collection('setup_tokens').doc(rawToken);
        batch.set(tokenRef, {
            accountId,
            uid: userRecord.uid,
            taxId: cleanRun,
            hashedToken,
            expiresAt,
            used: false,
            createdAt: Date.now()
        });

        await batch.commit();

        await upsertUserDirectoryEntry({
            rawRun: run,
            fullName: displayName,
            uid: userRecord.uid,
            accountId,
            authEmail: normalizedEmail,
            role: 'OPERATOR',
            accountName,
        });

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'STAFF_CREATE_WORKER',
            module: 'b2b-core',
            targetEntity: userRecord.uid,
            details: { workerEmail: normalizedEmail, run: formattedRun, isNewUser },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({
            uid: userRecord.uid,
            isNewUser,
            message: isNewUser
                ? 'Usuario creado y email de configuración enviado'
                : 'Vínculo actualizado y email de acceso enviado'
        });
    } catch (error: any) {
        console.error('[Staff API] Error al crear trabajador:', error);
        return res.status(500).json({
            error: error.message || 'Error al crear trabajador'
        });
    }
});

/**
 * POST /api/staff/designate-admin
 */
router.post('/designate-admin', async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const validation = StaffMemberPayloadSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validación de datos de administrador fallida',
                details: validation.error.format()
            });
        }

        const { email, displayName, run, accountId, accountName } = validation.data;

        const authz = await authorizeStaffMutation(req, accountId);
        if (!authz.ok) {
            return res.status(authz.status).json({ error: authz.error });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const cleanRun = cleanRut(run);
        const formattedRun = formatRut(cleanRun);
        const syntheticAuthEmail = `${cleanRun.toLowerCase()}@auth.minreport.internal`;

        let userRecord;
        let isNewUser = false;
        try {
            userRecord = await auth.getUser(cleanRun);
            if (userRecord.email !== syntheticAuthEmail) {
                await auth.updateUser(cleanRun, { email: syntheticAuthEmail }).catch(() => {});
            }
        } catch (error: any) {
            if (error.code !== 'auth/user-not-found') throw error;

            userRecord = await auth.createUser({
                uid: cleanRun,
                email: syntheticAuthEmail,
                emailVerified: false,
                displayName,
                disabled: false
            });
            isNewUser = true;
        }

        const { rawToken, hashedToken, expiresAt } = generateSetupToken();
        const baseUrl = getCanonicalWebUrl();
        const setupLink = `${baseUrl}/setup-access?accountId=${encodeURIComponent(accountId)}&taxId=${encodeURIComponent(cleanRun)}&name=${encodeURIComponent(displayName)}&accountName=${encodeURIComponent(accountName)}&type=BUSINESS&token=${encodeURIComponent(rawToken)}`;

        try {
            await EmailService.sendEmail({
                from: 'MINREPORT <no-reply@minreport.com>',
                to: normalizedEmail,
                subject: `Designación: Administrador General — ${accountName}`,
                html: `
                    <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                        <div style="background: #F8FAFC; border-left: 4px solid #C68346; padding: 21px; margin-bottom: 21px;">
                            <p style="margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; text-transform: uppercase;">
                                Designación de Cargo: Administrador General
                            </p>
                            <p style="margin: 13px 0 0 0; font-size: 14px; line-height: 1.5;">
                                ${displayName}, has sido designado como Administrador General para <strong>${accountName}</strong> en MINREPORT.
                            </p>
                        </div>
                        <div style="text-align: center; margin: 34px 0;">
                            <a href="${setupLink}" style="background: #C68346; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">
                                Configurar Credenciales de Acceso
                            </a>
                        </div>
                    </div>
                `
            });
        } catch (e) {
            console.error('[Staff API] Error enviando email de administrador:', e);
        }

        const userProfileRef = db.collection('users').doc(userRecord.uid);
        const userProfileSnap = await userProfileRef.get();
        const existingData = userProfileSnap.exists ? userProfileSnap.data() || {} : {};
        const existingMemberships = (Array.isArray(existingData.memberships) ? existingData.memberships : [])
            .filter((m: any) => m?.accountId !== accountId)
            .map(({ passwordHash: _ph, ...rest }: any) => rest);

        existingMemberships.push({
            accountId,
            role: 'ADMIN',
            companyName: accountName,
            status: 'PENDING',
            joinedAt: Date.now()
        });

        const batch = db.batch();
        batch.set(
            userProfileRef,
            {
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                role: existingData.role || 'USER',
                taxId: existingData.taxId || formattedRun,
                memberships: existingMemberships,
                status: existingData.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
                updatedAt: Date.now()
            },
            { merge: true }
        );

        const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid);
        batch.set(memberRef, {
            userId: userRecord.uid,
            email: normalizedEmail,
            fullName: displayName,
            run: formattedRun,
            role: 'ADMIN',
            status: 'PENDING',
            invitedAt: Date.now()
        });

        const tokenRef = db.collection('setup_tokens').doc(rawToken);
        batch.set(tokenRef, {
            accountId,
            uid: userRecord.uid,
            taxId: cleanRun,
            hashedToken,
            expiresAt,
            used: false,
            createdAt: Date.now()
        });

        await batch.commit();

        await upsertUserDirectoryEntry({
            rawRun: run,
            fullName: displayName,
            uid: userRecord.uid,
            accountId,
            authEmail: normalizedEmail,
            role: 'ADMIN',
            accountName,
        });

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'STAFF_DESIGNATE_ADMIN',
            module: 'b2b-core',
            targetEntity: userRecord.uid,
            details: { adminEmail: normalizedEmail, run: formattedRun, isNewUser },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({ uid: userRecord.uid, isNewUser });
    } catch (error: any) {
        console.error('[Staff API] Error designating admin:', error);
        return res.status(500).json({ error: error.message || 'Error al designar administrador' });
    }
});

export default router;
