import { Response, Router } from 'express';
import { db, auth } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { env, getCanonicalWebUrl } from '../config/env';
import { generateSetupToken } from '../utils/security';
import { cleanRut, getRutVariants } from '../utils/rut';
import {
    validateE164Phone,
    validateTaxId,
    type TaxIdValidationResult,
} from '../utils/taxIdValidator';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { computeShortTtlTimestamp } from '../core/retention-policy';
import {
    type B2BSeatRole,
    RemoveB2BMemberPayloadSchema,
    UpdateB2BMemberPayloadSchema,
    UpsertB2BMemberPayloadSchema,
} from '../contracts/session.contracts';

const router = Router();

// Todas las rutas de gestión de personal interno exigen sesión verificada
router.use((req: AuthRequest, res: Response, next) => {
    if (req.user?.uid) {
        return next();
    }
    return requireAuth(req, res, next);
});

const ROLE_ORDER: Record<B2BSeatRole, number> = {
    OWNER: 0,
    ADMIN: 1,
    OPERATOR: 2,
    VIEWER: 3,
};

const MUTABLE_TARGET_ROLES = new Set(['ADMIN', 'OPERATOR', 'VIEWER']);
const PRIVILEGED_MUTATOR_ROLES = new Set(['DEV_ROOT', 'SUPER_ADMIN', 'OWNER', 'ADMIN']);

export interface NormalizedSeatPermissions {
    allowedModules: {
        opermaq: boolean;
        stockpile: boolean;
        supply: boolean;
    };
    canViewBilling: boolean;
}

/**
 * Normaliza permisos de módulos y facturación según el rol B2B del asiento.
 * Compatibilidad retroactiva: si `supply` viene indefinido en asientos legacy,
 * queda en `true` para OWNER/ADMIN y `false` para OPERATOR/VIEWER.
 */
export function normalizeSeatPermissionsForRole(
    role: B2BSeatRole,
    allowedModules?: { opermaq?: boolean; stockpile?: boolean; supply?: boolean },
    canViewBilling?: boolean
): NormalizedSeatPermissions {
    if (role === 'OWNER' || role === 'ADMIN') {
        return {
            allowedModules: {
                opermaq: true,
                stockpile: true,
                supply: true,
            },
            canViewBilling: true,
        };
    }

    const normalizedModules = {
        opermaq: allowedModules?.opermaq ?? true,
        stockpile: allowedModules?.stockpile ?? false,
        supply: allowedModules?.supply ?? false,
    };

    if (role === 'OPERATOR') {
        return {
            allowedModules: normalizedModules,
            canViewBilling: false,
        };
    }

    return {
        allowedModules: normalizedModules,
        canViewBilling: Boolean(canViewBilling),
    };
}

function parseOptionalMemberPhoneE164(
    rawPhone: unknown
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
    if (rawPhone === undefined) return { ok: true, value: undefined };
    if (rawPhone === null) return { ok: true, value: null };
    const trimmed = String(rawPhone).trim();
    if (!trimmed) return { ok: true, value: null };
    const phoneCheck = validateE164Phone(trimmed);
    if (!phoneCheck.valid) {
        return {
            ok: false,
            error:
                phoneCheck.reason ||
                'Teléfono E.164 inválido (se requiere prefijo internacional, ej. +56912345678).',
        };
    }
    return { ok: true, value: phoneCheck.normalized };
}

/**
 * Evalúa puramente si un actor puede mutar o remover un asiento B2B objetivo.
 * Protege siempre al titular OWNER de cualquier mutación o eliminación.
 */
export function canActorMutateTargetSeat(
    actorRole: string,
    isTargetOwner: boolean,
    targetRole: string
): boolean {
    const targetUpper = String(targetRole || '').trim().toUpperCase();
    if (isTargetOwner || targetUpper === 'OWNER') {
        return false;
    }
    const actorUpper = String(actorRole || '').trim().toUpperCase();
    return PRIVILEGED_MUTATOR_ROLES.has(actorUpper) && MUTABLE_TARGET_ROLES.has(targetUpper);
}

function normalizeLegacyB2BRole(rawRole: unknown, isOwnerFlag: boolean = false): B2BSeatRole {
    if (isOwnerFlag) return 'OWNER';
    const upper = String(rawRole || '').trim().toUpperCase();
    if (upper === 'OWNER') return 'OWNER';
    if (
        upper === 'ADMIN' ||
        upper === 'ADMINISTRADOR OPERATIVO' ||
        upper === 'SUBSCRIPTION_ADMIN' ||
        upper === 'BILLING_ONLY' ||
        upper === 'GENERAL_ADMIN'
    ) {
        return 'ADMIN';
    }
    if (upper === 'VIEWER') return 'VIEWER';
    return 'OPERATOR';
}

function isInactiveStatus(status: unknown): boolean {
    const st = String(status || 'ACTIVE').trim().toUpperCase();
    return st === 'SUSPENDED' || st === 'REVOKED' || st === 'INACTIVE' || st === 'DELETED';
}

function isReservedSystemEmail(emailLower: string): boolean {
    return (
        emailLower === 'dev@minreport.com' ||
        emailLower === 'admin@minreport.com' ||
        emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase()
    );
}

interface StaffAuthzSuccess {
    ok: true;
    actorUid: string;
    actorEmail: string;
    actorRole: 'DEV_ROOT' | 'SUPER_ADMIN' | 'OWNER' | 'ADMIN';
    accountData: Record<string, any>;
}

interface StaffAuthzFailure {
    ok: false;
    status: number;
    error: string;
}

/**
 * Verifica que el solicitante sea OWNER/ADMIN de `accountId` (o DEV_ROOT / SUPER_ADMIN).
 * No impone bloqueo por `maxUsers` para permitir inspección (GET) y ediciones/bajas (PATCH/DELETE).
 */
async function authorizeStaffAccountAccess(
    req: AuthRequest,
    accountId: string
): Promise<StaffAuthzSuccess | StaffAuthzFailure> {
    const caller = req.user;
    if (!caller?.uid) {
        return { ok: false, status: 401, error: 'No autorizado: sesión ausente.' };
    }

    const callerUid = String(caller.uid);
    const callerEmail = String(caller.email || '').toLowerCase();
    const emailVerifiedOk = caller.email_verified !== false;
    const tokenRole = String(caller.role || '').toUpperCase();

    const isDevRoot =
        caller.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        callerUid === 'dev-master-root-uid' ||
        (emailVerifiedOk && callerEmail === 'dev@minreport.com');

    const isSuperAdmin =
        !isDevRoot &&
        (caller.admin === true ||
            tokenRole === 'SUPER_ADMIN' ||
            callerUid === 'super-admin-uid' ||
            (emailVerifiedOk &&
                (callerEmail === 'admin@minreport.com' ||
                    callerEmail === env.SUPER_ADMIN_EMAIL.toLowerCase())));

    const accountSnap = await db.collection('accounts').doc(accountId).get();
    if (!accountSnap.exists) {
        return { ok: false, status: 404, error: 'Cuenta corporativa no encontrada.' };
    }

    const accountData = accountSnap.data() || {};

    if (isDevRoot) {
        return {
            ok: true,
            actorUid: callerUid,
            actorEmail: callerEmail,
            actorRole: 'DEV_ROOT',
            accountData,
        };
    }

    if (isSuperAdmin) {
        return {
            ok: true,
            actorUid: callerUid,
            actorEmail: callerEmail,
            actorRole: 'SUPER_ADMIN',
            accountData,
        };
    }

    if (accountData.ownerId === callerUid) {
        return {
            ok: true,
            actorUid: callerUid,
            actorEmail: callerEmail,
            actorRole: 'OWNER',
            accountData,
        };
    }

    const adminAliases = new Set([
        'OWNER',
        'ADMIN',
        'ADMINISTRADOR OPERATIVO',
        'SUBSCRIPTION_ADMIN',
        'GENERAL_ADMIN',
    ]);

    const userSnap = await db.collection('users').doc(callerUid).get();
    if (userSnap.exists) {
        const memberships = userSnap.data()?.memberships;
        if (Array.isArray(memberships)) {
            const mem = memberships.find((m: any) => m?.accountId === accountId);
            const memRole = String(mem?.role || '').toUpperCase();
            if (mem && adminAliases.has(memRole) && !isInactiveStatus(mem?.status)) {
                return {
                    ok: true,
                    actorUid: callerUid,
                    actorEmail: callerEmail,
                    actorRole: memRole === 'OWNER' ? 'OWNER' : 'ADMIN',
                    accountData,
                };
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
        if (adminAliases.has(memberRole) && !isInactiveStatus(memberData.status)) {
            return {
                ok: true,
                actorUid: callerUid,
                actorEmail: callerEmail,
                actorRole: memberRole === 'OWNER' ? 'OWNER' : 'ADMIN',
                accountData,
            };
        }
    }

    return {
        ok: false,
        status: 403,
        error: 'Prohibido: Se requiere rol OWNER o ADMIN sobre la cuenta objetivo.',
    };
}

/**
 * Prepara escrituras atómicas en `user_directory` exclusivamente para RUT chilenos válidos.
 */
async function stageChileanUserDirectoryUpsertInBatch(
    batch: FirebaseFirestore.WriteBatch,
    params: {
        taxCheck: TaxIdValidationResult;
        fullName: string;
        uid: string;
        accountId: string;
        authEmail: string;
        role: B2BSeatRole;
        accountName: string;
        status: string;
    }
): Promise<void> {
    const clean = cleanRut(params.taxCheck.normalized);
    const variants = getRutVariants(clean);
    const formattedRun = params.taxCheck.formatted;
    const nowIso = new Date().toISOString();

    const entry = {
        accountId: params.accountId,
        uid: params.uid,
        authEmail: params.authEmail,
        role: params.role,
        type: 'BUSINESS',
        accountName: params.accountName,
        status: params.status,
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
            batch.update(ref, {
                uid: params.uid,
                run: formattedRun,
                fullName: params.fullName,
                accounts: filtered,
                updatedAt: nowIso,
            });
        } else {
            batch.set(ref, {
                uid: params.uid,
                run: formattedRun,
                fullName: params.fullName,
                accounts: [entry],
                createdAt: nowIso,
                updatedAt: nowIso,
            });
        }
    }
}

async function stageChileanUserDirectoryRemovalInBatch(
    batch: FirebaseFirestore.WriteBatch,
    rawTaxId: string,
    accountId: string
): Promise<void> {
    if (!rawTaxId) return;
    const taxCheck = validateTaxId(rawTaxId, 'CL');
    if (!taxCheck.valid) return;

    const clean = cleanRut(taxCheck.normalized);
    const variants = getRutVariants(clean);
    const nowIso = new Date().toISOString();

    for (const variant of variants) {
        const ref = db.collection('user_directory').doc(variant);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const current = snap.data() || {};
        const remaining = (Array.isArray(current.accounts) ? current.accounts : []).filter(
            (a: any) => a?.accountId !== accountId
        );
        if (remaining.length === 0) {
            batch.delete(ref);
        } else {
            batch.update(ref, {
                accounts: remaining,
                updatedAt: nowIso,
            });
        }
    }
}

/**
 * GET /api/staff/members?accountId={accountId}
 */
router.get('/members', async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const accountId = String(
            req.query.accountId || req.headers['x-active-account-id'] || req.headers['x-tenant-id'] || ''
        ).trim();

        if (!accountId) {
            return res.status(400).json({ error: 'El parámetro accountId es obligatorio.' });
        }

        const authz = await authorizeStaffAccountAccess(req, accountId);
        if (!authz.ok) {
            return res.status(authz.status).json({ error: authz.error });
        }

        const { accountData } = authz;
        const ownerId = typeof accountData.ownerId === 'string' ? accountData.ownerId.trim() : '';
        const defaultCountryCode = String(accountData.countryCode || accountData.country || 'CL').toUpperCase();

        const membersSnap = await db.collection('accounts').doc(accountId).collection('members').get();
        const membersByUid = new Map<string, any>();

        for (const docSnap of membersSnap.docs) {
            const d = docSnap.data() || {};
            const uid = docSnap.id;
            const isOwner = Boolean(ownerId && uid === ownerId) || d.isOwner === true;
            const role = normalizeLegacyB2BRole(d.role, isOwner);
            const perms = normalizeSeatPermissionsForRole(role, d.allowedModules, d.canViewBilling);

            membersByUid.set(uid, {
                uid,
                userId: String(d.userId || uid),
                email: String(d.email || ''),
                fullName: String(d.fullName || d.displayName || ''),
                taxId: String(d.taxId || d.run || d.rut || ''),
                countryCode: String(d.countryCode || defaultCountryCode).toUpperCase(),
                role,
                jobTitle: String(d.jobTitle || ''),
                allowedModules: perms.allowedModules,
                canViewBilling: perms.canViewBilling,
                phoneE164:
                    typeof d.phoneE164 === 'string' && d.phoneE164.trim()
                        ? d.phoneE164.trim()
                        : null,
                whatsappOptInAt: d.whatsappOptInAt ?? null,
                supplyProfile: d.supplyProfile ?? null,
                notificationPreferences: d.notificationPreferences ?? null,
                status: String(d.status || 'ACTIVE').toUpperCase(),
                invitedAt: d.invitedAt ?? d.joinedAt ?? null,
                updatedAt: d.updatedAt ?? d.invitedAt ?? d.joinedAt ?? null,
            });
        }

        if (ownerId && !membersByUid.has(ownerId)) {
            let ownerUserData: Record<string, any> = {};
            try {
                const ownerSnap = await db.collection('users').doc(ownerId).get();
                if (ownerSnap.exists) {
                    ownerUserData = ownerSnap.data() || {};
                }
            } catch {
                ownerUserData = {};
            }

            const perms = normalizeSeatPermissionsForRole('OWNER');
            const ownerPhone =
                typeof ownerUserData.phoneE164 === 'string' && ownerUserData.phoneE164.trim()
                    ? ownerUserData.phoneE164.trim()
                    : typeof accountData.mandatario?.phoneE164 === 'string' &&
                        accountData.mandatario.phoneE164.trim()
                      ? accountData.mandatario.phoneE164.trim()
                      : null;
            membersByUid.set(ownerId, {
                uid: ownerId,
                userId: ownerId,
                email: String(ownerUserData.email || accountData.mandatario?.email || ''),
                fullName: String(
                    ownerUserData.fullName ||
                        ownerUserData.displayName ||
                        accountData.mandatario?.fullName ||
                        'Titular de Cuenta'
                ),
                taxId: String(ownerUserData.taxId || accountData.mandatario?.taxId || ''),
                countryCode: String(ownerUserData.countryCode || defaultCountryCode).toUpperCase(),
                role: 'OWNER' as B2BSeatRole,
                jobTitle: String(accountData.mandatario?.jobTitle || 'Titular de Cuenta'),
                allowedModules: perms.allowedModules,
                canViewBilling: perms.canViewBilling,
                phoneE164: ownerPhone,
                whatsappOptInAt: ownerUserData.whatsappOptInAt ?? null,
                supplyProfile: ownerUserData.supplyProfile ?? null,
                notificationPreferences: ownerUserData.notificationPreferences ?? null,
                status: String(ownerUserData.status || accountData.status || 'ACTIVE').toUpperCase(),
                invitedAt: accountData.createdAt ?? null,
                updatedAt: accountData.updatedAt ?? accountData.createdAt ?? null,
            });
        }

        const members = Array.from(membersByUid.values()).sort((a, b) => {
            const rankDiff = (ROLE_ORDER[a.role as B2BSeatRole] ?? 9) - (ROLE_ORDER[b.role as B2BSeatRole] ?? 9);
            if (rankDiff !== 0) return rankDiff;
            return String(a.fullName || a.email).localeCompare(String(b.fullName || b.email), 'es');
        });

        return res.status(200).json({ members });
    } catch (error: any) {
        console.error('[Staff API] Error listando miembros:', error);
        return res.status(500).json({ error: error?.message || 'Error al listar integrantes de la cuenta' });
    }
});

/**
 * Handler unificado para POST /api/staff/members y alias POST /api/staff/create-worker
 */
async function handleUpsertMember(req: AuthRequest, res: Response): Promise<any> {
    try {
        const validation = UpsertB2BMemberPayloadSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: validation.error.issues[0]?.message || 'Validación de datos de integrante fallida',
                details: validation.error.format(),
            });
        }

        const {
            accountId,
            accountName,
            email,
            displayName,
            taxId,
            countryCode,
            role,
            jobTitle,
            allowedModules,
            canViewBilling,
            phoneE164,
            whatsappOptInAt,
            supplyProfile,
            notificationPreferences,
        } = validation.data;

        const phoneCheck = parseOptionalMemberPhoneE164(phoneE164);
        if (!phoneCheck.ok) {
            return res.status(400).json({ error: phoneCheck.error });
        }

        const authz = await authorizeStaffAccountAccess(req, accountId);
        if (!authz.ok) {
            return res.status(authz.status).json({ error: authz.error });
        }

        const { accountData } = authz;
        const accountType = String(accountData.type || '').toUpperCase();
        const accountClass = String(accountData.classification || '').toLowerCase();
        const licensing = accountData.licensing || {};

        if (
            licensing.allowInternalUsers === false ||
            accountType === 'EDUCATIONAL' ||
            accountClass === 'edu' ||
            accountData.isEduSandbox === true
        ) {
            return res.status(403).json({
                error: 'LICENCIA_RESTRINGIDA: Esta cuenta no permite dar de alta usuarios internos (entorno EDU / monousuario).',
            });
        }

        const trimmedTaxId = String(taxId || '').trim();
        let taxCheck: TaxIdValidationResult | null = null;
        if (trimmedTaxId.length > 0) {
            taxCheck = validateTaxId(trimmedTaxId, countryCode);
            if (!taxCheck.valid) {
                return res.status(400).json({
                    error: taxCheck.reason || `Identificador tributario inválido para país ${countryCode}.`,
                });
            }
        }

        const normalizedEmail = email.toLowerCase().trim();
        if (isReservedSystemEmail(normalizedEmail)) {
            return res.status(403).json({
                error: 'OPERACION_PROHIBIDA: No es posible vincular cuentas maestras reservadas del sistema.',
            });
        }

        // Búsqueda y alta exclusivamente por email real (prohibido dominio interno sintético o UID por RUN)
        let userRecord;
        let isNewUser = false;
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
        } catch (error: any) {
            if (error?.code !== 'auth/user-not-found') {
                throw error;
            }
            userRecord = await auth.createUser({
                email: normalizedEmail,
                emailVerified: false,
                displayName,
                disabled: false,
            });
            isNewUser = true;
        }

        const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid);
        const existingMemberSnap = await memberRef.get();
        const existingMemberData = existingMemberSnap.exists ? existingMemberSnap.data() || {} : {};

        const isTargetOwner =
            (typeof accountData.ownerId === 'string' && accountData.ownerId === userRecord.uid) ||
            existingMemberData.isOwner === true ||
            String(existingMemberData.role || '').toUpperCase() === 'OWNER';

        if (isTargetOwner) {
            return res.status(403).json({
                error: 'OPERACION_PROHIBIDA: No es posible sobrescribir el asiento titular OWNER.',
            });
        }

        // Validar cupo maxUsers únicamente cuando es un miembro nuevo en la cuenta
        if (!existingMemberSnap.exists && typeof licensing.maxUsers === 'number' && licensing.maxUsers > 0) {
            const membersCountSnap = await db
                .collection('accounts')
                .doc(accountId)
                .collection('members')
                .count()
                .get();
            if (membersCountSnap.data().count >= licensing.maxUsers) {
                return res.status(403).json({
                    error: `LIMITE_USUARIOS_ALCANZADO: La cuenta alcanzó el máximo permitido de ${licensing.maxUsers} usuarios.`,
                });
            }
        }

        const userProfileRef = db.collection('users').doc(userRecord.uid);
        const userProfileSnap = await userProfileRef.get();
        const existingUserData = userProfileSnap.exists ? userProfileSnap.data() || {} : {};

        const userStatusUpper = String(existingUserData.status || '').toUpperCase();
        const existingMemberStatusUpper = String(existingMemberData.status || '').toUpperCase();
        const needsSetupToken =
            isNewUser ||
            !userProfileSnap.exists ||
            userStatusUpper !== 'ACTIVE' ||
            existingMemberStatusUpper === 'PENDING';

        const memberStatus = needsSetupToken ? 'PENDING' : 'ACTIVE';
        const normalizedPerms = normalizeSeatPermissionsForRole(role, allowedModules, canViewBilling);
        const nowMs = Date.now();
        const storedTaxId = taxCheck ? taxCheck.formatted : String(existingMemberData.taxId || existingMemberData.run || '');
        const resolvedPhoneE164 =
            phoneCheck.value !== undefined
                ? phoneCheck.value
                : typeof existingMemberData.phoneE164 === 'string' && existingMemberData.phoneE164.trim()
                  ? existingMemberData.phoneE164.trim()
                  : null;
        const resolvedWhatsappOptInAt =
            whatsappOptInAt !== undefined
                ? whatsappOptInAt
                : (existingMemberData.whatsappOptInAt ?? null);
        const resolvedSupplyProfile =
            supplyProfile !== undefined ? supplyProfile : (existingMemberData.supplyProfile ?? null);
        const resolvedNotificationPreferences =
            notificationPreferences !== undefined
                ? notificationPreferences
                : (existingMemberData.notificationPreferences ?? null);

        const existingMemberships = (Array.isArray(existingUserData.memberships) ? existingUserData.memberships : [])
            .filter((m: any) => m?.accountId !== accountId)
            .map(({ passwordHash: _ph, ...rest }: any) => rest);

        existingMemberships.push({
            accountId,
            accountName,
            companyName: accountName,
            role,
            jobTitle: jobTitle || '',
            countryCode,
            allowedModules: normalizedPerms.allowedModules,
            canViewBilling: normalizedPerms.canViewBilling,
            ...(resolvedPhoneE164 !== null ? { phoneE164: resolvedPhoneE164 } : {}),
            ...(resolvedWhatsappOptInAt !== null ? { whatsappOptInAt: resolvedWhatsappOptInAt } : {}),
            ...(resolvedSupplyProfile !== null ? { supplyProfile: resolvedSupplyProfile } : {}),
            ...(resolvedNotificationPreferences !== null
                ? { notificationPreferences: resolvedNotificationPreferences }
                : {}),
            type: 'BUSINESS',
            status: memberStatus,
            joinedAt: existingMemberData.invitedAt ?? nowMs,
            updatedAt: nowMs,
        });

        const batch = db.batch();

        batch.set(
            userProfileRef,
            {
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                displayName,
                role: existingUserData.role || 'USER',
                classification: existingUserData.classification || 'b2b',
                countryCode: existingUserData.countryCode || countryCode,
                ...(storedTaxId ? { taxId: existingUserData.taxId || storedTaxId } : {}),
                ...(phoneCheck.value !== undefined ? { phoneE164: resolvedPhoneE164 } : {}),
                ...(whatsappOptInAt !== undefined ? { whatsappOptInAt: resolvedWhatsappOptInAt } : {}),
                memberships: existingMemberships,
                status: existingUserData.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
                updatedAt: nowMs,
            },
            { merge: true }
        );

        batch.set(
            memberRef,
            {
                uid: userRecord.uid,
                userId: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                taxId: storedTaxId,
                countryCode,
                role,
                jobTitle: jobTitle || '',
                allowedModules: normalizedPerms.allowedModules,
                canViewBilling: normalizedPerms.canViewBilling,
                phoneE164: resolvedPhoneE164,
                whatsappOptInAt: resolvedWhatsappOptInAt,
                supplyProfile: resolvedSupplyProfile,
                notificationPreferences: resolvedNotificationPreferences,
                status: memberStatus,
                invitedAt: existingMemberData.invitedAt ?? nowMs,
                updatedAt: nowMs,
            },
            { merge: true }
        );

        let setupLink: string | null = null;
        if (needsSetupToken) {
            const { rawToken, hashedToken, expiresAt } = generateSetupToken();
            const tokenTaxId = taxCheck ? taxCheck.normalized : '';
            const tokenRef = db.collection('setup_tokens').doc(rawToken);
            batch.set(tokenRef, {
                accountId,
                uid: userRecord.uid,
                taxId: tokenTaxId,
                hashedToken,
                expiresAt,
                ttlExpiresAt: computeShortTtlTimestamp(24 * 60 * 60 * 1000),
                used: false,
                createdAt: nowMs,
            });
            const baseUrl = getCanonicalWebUrl();
            setupLink = `${baseUrl}/setup-access?accountId=${encodeURIComponent(accountId)}&taxId=${encodeURIComponent(tokenTaxId)}&name=${encodeURIComponent(displayName)}&accountName=${encodeURIComponent(accountName)}&type=BUSINESS&token=${encodeURIComponent(rawToken)}`;
        }

        if (countryCode === 'CL' && taxCheck?.valid) {
            await stageChileanUserDirectoryUpsertInBatch(batch, {
                taxCheck,
                fullName: displayName,
                uid: userRecord.uid,
                accountId,
                authEmail: normalizedEmail,
                role,
                accountName,
                status: memberStatus,
            });
        }

        await batch.commit();

        if (setupLink) {
            try {
                await EmailService.sendEmail({
                    from: 'MINREPORT Onboarding <no-reply@minreport.com>',
                    to: normalizedEmail,
                    subject: `Configuración de Acceso Operativo — ${accountName}`,
                    html: `
                        <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                            <div style="background: #F8FAFC; border-left: 4px solid #C68346; padding: 21px; margin-bottom: 21px;">
                                <p style="margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; text-transform: uppercase;">
                                    ALTA DE ASIENTO B2B (${role}): ${displayName}
                                </p>
                                <p style="margin: 13px 0 0 0; font-size: 14px; line-height: 1.5;">
                                    Has sido registrado en <strong>${accountName}</strong>. Configura tu clave de acceso en las próximas 24 horas.
                                </p>
                            </div>
                            <div style="text-align: center; margin: 34px 0;">
                                <a href="${setupLink}" style="background: #0F172A; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">
                                    Configurar Credenciales
                                </a>
                            </div>
                        </div>
                    `,
                });
            } catch (emailError) {
                console.error('[Staff API] Error al enviar email de configuración:', emailError);
            }
        }

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: authz.actorUid,
            actorEmail: authz.actorEmail || 'system@minreport.local',
            action: 'B2B_TEAM_MEMBER_UPSERTED',
            module: 'b2b-core',
            targetEntity: userRecord.uid,
            details: {
                memberEmail: normalizedEmail,
                role,
                countryCode,
                allowedModules: normalizedPerms.allowedModules,
                canViewBilling: normalizedPerms.canViewBilling,
                hasPhoneE164: Boolean(resolvedPhoneE164),
                hasWhatsappOptIn: Boolean(resolvedWhatsappOptInAt),
                supplyRole: resolvedSupplyProfile?.role ?? null,
                isNewUser,
                status: memberStatus,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({
            uid: userRecord.uid,
            isNewUser,
            status: memberStatus,
            message: isNewUser
                ? 'Integrante creado y enlace de configuración enviado.'
                : 'Membresía de integrante actualizada correctamente.',
        });
    } catch (error: any) {
        console.error('[Staff API] Error en alta/actualización de integrante:', error);
        return res.status(500).json({
            error: error?.message || 'Error al registrar integrante',
        });
    }
}

router.post('/members', handleUpsertMember);
router.post('/create-worker', handleUpsertMember);

/**
 * PATCH /api/staff/members/:memberUid
 */
router.patch('/members/:memberUid', async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const memberUid = String(req.params.memberUid || '').trim();
        if (!memberUid) {
            return res.status(400).json({ error: 'Identificador memberUid obligatorio.' });
        }

        const validation = UpdateB2BMemberPayloadSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: validation.error.issues[0]?.message || 'Validación HITL fallida (se requiere confirmación ACTUALIZAR).',
                details: validation.error.format(),
            });
        }

        const {
            accountId,
            role,
            jobTitle,
            allowedModules,
            canViewBilling,
            status,
            phoneE164,
            whatsappOptInAt,
            supplyProfile,
            notificationPreferences,
        } = validation.data;

        const phoneCheck = parseOptionalMemberPhoneE164(phoneE164);
        if (!phoneCheck.ok) {
            return res.status(400).json({ error: phoneCheck.error });
        }

        const authz = await authorizeStaffAccountAccess(req, accountId);
        if (!authz.ok) {
            return res.status(authz.status).json({ error: authz.error });
        }

        const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(memberUid);
        const memberSnap = await memberRef.get();
        const isAccountOwnerUid = Boolean(authz.accountData.ownerId && authz.accountData.ownerId === memberUid);

        if (!memberSnap.exists && !isAccountOwnerUid) {
            return res.status(404).json({ error: 'Integrante no encontrado en la cuenta corporativa.' });
        }

        const memberData = memberSnap.exists ? memberSnap.data() || {} : {};
        const isTargetOwner =
            isAccountOwnerUid ||
            memberData.isOwner === true ||
            String(memberData.role || '').toUpperCase() === 'OWNER';

        const currentNormalizedRole = normalizeLegacyB2BRole(memberData.role, isTargetOwner);
        if (!canActorMutateTargetSeat(authz.actorRole, isTargetOwner, currentNormalizedRole)) {
            return res.status(403).json({
                error: 'PROHIBIDO_MUTAR_OWNER: No está autorizado para modificar el asiento del titular o este nivel de rol.',
            });
        }

        const nextRole: B2BSeatRole = role ?? currentNormalizedRole;
        const nextModulesInput = allowedModules ?? memberData.allowedModules;
        const nextBillingInput = canViewBilling !== undefined ? canViewBilling : memberData.canViewBilling;
        const normalizedPerms = normalizeSeatPermissionsForRole(nextRole, nextModulesInput, nextBillingInput);
        const nextJobTitle = jobTitle !== undefined ? jobTitle : String(memberData.jobTitle || '');
        const nextStatus = status ?? String(memberData.status || 'ACTIVE').toUpperCase();
        const nextPhoneE164 =
            phoneCheck.value !== undefined
                ? phoneCheck.value
                : typeof memberData.phoneE164 === 'string' && memberData.phoneE164.trim()
                  ? memberData.phoneE164.trim()
                  : null;
        const nextWhatsappOptInAt =
            whatsappOptInAt !== undefined
                ? whatsappOptInAt
                : (memberData.whatsappOptInAt ?? null);
        const nextSupplyProfile =
            supplyProfile !== undefined ? supplyProfile : (memberData.supplyProfile ?? null);
        const nextNotificationPreferences =
            notificationPreferences !== undefined
                ? notificationPreferences
                : (memberData.notificationPreferences ?? null);
        const nowMs = Date.now();

        const userRef = db.collection('users').doc(memberUid);
        const userSnap = await userRef.get();

        const batch = db.batch();
        batch.set(
            memberRef,
            {
                role: nextRole,
                jobTitle: nextJobTitle,
                allowedModules: normalizedPerms.allowedModules,
                canViewBilling: normalizedPerms.canViewBilling,
                phoneE164: nextPhoneE164,
                whatsappOptInAt: nextWhatsappOptInAt,
                supplyProfile: nextSupplyProfile,
                notificationPreferences: nextNotificationPreferences,
                status: nextStatus,
                updatedAt: nowMs,
            },
            { merge: true }
        );

        if (userSnap.exists) {
            const userData = userSnap.data() || {};
            const existingMemberships = (Array.isArray(userData.memberships) ? userData.memberships : []).map(
                ({ passwordHash: _ph, ...rest }: any) => rest
            );
            let matched = false;
            const updatedMemberships = existingMemberships.map((m: any) => {
                if (m?.accountId !== accountId) return m;
                matched = true;
                return {
                    ...m,
                    role: nextRole,
                    jobTitle: nextJobTitle,
                    allowedModules: normalizedPerms.allowedModules,
                    canViewBilling: normalizedPerms.canViewBilling,
                    phoneE164: nextPhoneE164,
                    whatsappOptInAt: nextWhatsappOptInAt,
                    supplyProfile: nextSupplyProfile,
                    notificationPreferences: nextNotificationPreferences,
                    status: nextStatus,
                    updatedAt: nowMs,
                };
            });
            if (!matched) {
                updatedMemberships.push({
                    accountId,
                    accountName: String(authz.accountData.name || accountId),
                    companyName: String(authz.accountData.name || accountId),
                    role: nextRole,
                    jobTitle: nextJobTitle,
                    allowedModules: normalizedPerms.allowedModules,
                    canViewBilling: normalizedPerms.canViewBilling,
                    phoneE164: nextPhoneE164,
                    whatsappOptInAt: nextWhatsappOptInAt,
                    supplyProfile: nextSupplyProfile,
                    notificationPreferences: nextNotificationPreferences,
                    type: 'BUSINESS',
                    status: nextStatus,
                    joinedAt: memberData.invitedAt ?? nowMs,
                    updatedAt: nowMs,
                });
            }
            const userPatch: Record<string, any> = {
                memberships: updatedMemberships,
                updatedAt: nowMs,
            };
            if (phoneCheck.value !== undefined) {
                userPatch.phoneE164 = nextPhoneE164;
            }
            if (whatsappOptInAt !== undefined) {
                userPatch.whatsappOptInAt = nextWhatsappOptInAt;
            }
            batch.update(userRef, userPatch);
        }

        await batch.commit();

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: authz.actorUid,
            actorEmail: authz.actorEmail || 'system@minreport.local',
            action: 'B2B_TEAM_MEMBER_UPDATED',
            module: 'b2b-core',
            targetEntity: memberUid,
            details: {
                role: nextRole,
                jobTitle: nextJobTitle,
                allowedModules: normalizedPerms.allowedModules,
                canViewBilling: normalizedPerms.canViewBilling,
                hasPhoneE164: Boolean(nextPhoneE164),
                hasWhatsappOptIn: Boolean(nextWhatsappOptInAt),
                supplyRole: nextSupplyProfile?.role ?? null,
                status: nextStatus,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            uid: memberUid,
        });
    } catch (error: any) {
        console.error('[Staff API] Error actualizando integrante:', error);
        return res.status(500).json({ error: error?.message || 'Error al actualizar integrante' });
    }
});

/**
 * DELETE /api/staff/members/:memberUid
 */
router.delete('/members/:memberUid', async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const memberUid = String(req.params.memberUid || '').trim();
        if (!memberUid) {
            return res.status(400).json({ error: 'Identificador memberUid obligatorio.' });
        }

        const validation = RemoveB2BMemberPayloadSchema.safeParse({
            accountId: req.body?.accountId ?? req.query?.accountId,
            confirmationKeyword: req.body?.confirmationKeyword ?? req.query?.confirmationKeyword,
        });

        if (!validation.success) {
            return res.status(400).json({
                error: validation.error.issues[0]?.message || 'Validación HITL fallida (se requiere accountId y confirmationKeyword=ACTUALIZAR).',
                details: validation.error.format(),
            });
        }

        const { accountId } = validation.data;

        const authz = await authorizeStaffAccountAccess(req, accountId);
        if (!authz.ok) {
            return res.status(authz.status).json({ error: authz.error });
        }

        const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(memberUid);
        const memberSnap = await memberRef.get();
        const isAccountOwnerUid = Boolean(authz.accountData.ownerId && authz.accountData.ownerId === memberUid);

        if (!memberSnap.exists && !isAccountOwnerUid) {
            return res.status(404).json({ error: 'Integrante no encontrado en la cuenta corporativa.' });
        }

        const memberData = memberSnap.exists ? memberSnap.data() || {} : {};
        const isTargetOwner =
            isAccountOwnerUid ||
            memberData.isOwner === true ||
            String(memberData.role || '').toUpperCase() === 'OWNER';

        const currentNormalizedRole = normalizeLegacyB2BRole(memberData.role, isTargetOwner);
        if (!canActorMutateTargetSeat(authz.actorRole, isTargetOwner, currentNormalizedRole)) {
            return res.status(403).json({
                error: 'PROHIBIDO_ELIMINAR_OWNER: El titular OWNER no puede ser removido de la cuenta.',
            });
        }

        const userRef = db.collection('users').doc(memberUid);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        const nowMs = Date.now();

        const batch = db.batch();
        if (memberSnap.exists) {
            batch.delete(memberRef);
        }

        if (userSnap.exists) {
            const remainingMemberships = (Array.isArray(userData.memberships) ? userData.memberships : [])
                .filter((m: any) => m?.accountId !== accountId)
                .map(({ passwordHash: _ph, ...rest }: any) => rest);

            const userPatch: Record<string, any> = {
                memberships: remainingMemberships,
                updatedAt: nowMs,
            };

            if (userData.lastActiveAccountId === accountId) {
                userPatch.lastActiveAccountId = remainingMemberships[0]?.accountId ?? null;
            }
            if (userData.primaryAccountId === accountId) {
                userPatch.primaryAccountId = remainingMemberships[0]?.accountId ?? null;
            }

            batch.update(userRef, userPatch);
        }

        const candidateTaxId = String(memberData.taxId || memberData.run || userData.taxId || '').trim();
        const candidateCountry = String(
            memberData.countryCode || userData.countryCode || authz.accountData.countryCode || 'CL'
        ).toUpperCase();

        if (candidateCountry === 'CL' && candidateTaxId) {
            await stageChileanUserDirectoryRemovalInBatch(batch, candidateTaxId, accountId);
        }

        await batch.commit();

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: authz.actorUid,
            actorEmail: authz.actorEmail || 'system@minreport.local',
            action: 'B2B_TEAM_MEMBER_REMOVED',
            module: 'b2b-core',
            targetEntity: memberUid,
            details: {
                removedEmail: memberData.email || userData.email || null,
                removedRole: currentNormalizedRole,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            uid: memberUid,
        });
    } catch (error: any) {
        console.error('[Staff API] Error removiendo integrante:', error);
        return res.status(500).json({ error: error?.message || 'Error al eliminar integrante' });
    }
});

export default router;
