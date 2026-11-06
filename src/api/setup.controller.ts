import { Request, Response } from 'express';
import { z } from 'zod';
import admin, { db, auth } from '../config/firebase';
import { hashPassword, verifySetupTokenHash } from '../utils/security';
import { formatRut, cleanRut, getRutVariants } from '../utils/rut';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';

const setupPasswordSchema = z.object({
    token: z.string().min(16).max(256),
    accountId: z.string().min(1).max(128),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(256),
    taxId: z.string().min(3).max(64),
});

/**
 * Resuelve el documento real `/users/{uid}` consultando primero `/user_directory/{variant}`
 * (evitando la fractura de ID cuando el usuario fue creado con UID de Firebase Auth),
 * manteniendo fallback de lectura a `/users/{cleanTaxId}` por retrocompatibilidad.
 */
async function resolveTargetUserDoc(
    cleanRequestTaxId: string,
    accountId: string,
    explicitTokenUid?: string
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
    if (explicitTokenUid) {
        const snap = await db.collection('users').doc(explicitTokenUid).get();
        if (snap.exists) return snap;
    }

    const variants = getRutVariants(cleanRequestTaxId);

    // 1. Prioridad: `/user_directory/{variant}`
    for (const variant of variants) {
        const dirSnap = await db.collection('user_directory').doc(variant).get();
        if (!dirSnap.exists) continue;
        const dirData = dirSnap.data() || {};
        const accounts: any[] = Array.isArray(dirData.accounts) ? dirData.accounts : [];
        const matchedAccount = accounts.find((a) => a?.accountId === accountId);

        const candidateUid = matchedAccount?.uid || dirData.uid;
        if (typeof candidateUid === 'string' && candidateUid.trim()) {
            const uSnap = await db.collection('users').doc(candidateUid.trim()).get();
            if (uSnap.exists) return uSnap;
        }

        const authEmail = matchedAccount?.authEmail;
        if (typeof authEmail === 'string' && authEmail.trim()) {
            const byEmailQuery = await db
                .collection('users')
                .where('email', '==', authEmail.trim().toLowerCase())
                .limit(1)
                .get();
            if (!byEmailQuery.empty) return byEmailQuery.docs[0];

            try {
                const authUser = await auth.getUserByEmail(authEmail.trim().toLowerCase());
                const authUserSnap = await db.collection('users').doc(authUser.uid).get();
                if (authUserSnap.exists) return authUserSnap;
            } catch {
                // Continuar resolución
            }
        }
    }

    // 2. Búsqueda por `taxId` en `/users`
    const byTaxIdSnap = await db
        .collection('users')
        .where('taxId', 'in', variants.slice(0, 10))
        .limit(5)
        .get();
    if (!byTaxIdSnap.empty) {
        const withMembership = byTaxIdSnap.docs.find((d) =>
            (d.data()?.memberships || []).some((m: any) => m?.accountId === accountId)
        );
        if (withMembership) return withMembership;
        return byTaxIdSnap.docs[0];
    }

    // 3. Fallback retrocompatible: `/users/{cleanRequestTaxId}`
    const legacyDirectSnap = await db.collection('users').doc(cleanRequestTaxId).get();
    if (legacyDirectSnap.exists) return legacyDirectSnap;

    return null;
}

/**
 * @route POST /api/auth/tunnel/setup-password
 * @desc Establece la contraseña inicial de acceso almacenando el hash exclusivamente
 *       en la colección de servidor `user_auth_credentials/{uid}` (nunca en `/users/{uid}`).
 */
export const setupAccountPassword = async (req: Request, res: Response) => {
    try {
        const parsed = setupPasswordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Parámetros de seguridad inválidos o contraseña menor a 8 caracteres.',
                details: parsed.error.format(),
            });
        }

        const { token, accountId, password, taxId: requestTaxId } = parsed.data;

        const tokenRef = db.collection('setup_tokens').doc(token);
        const tokenSnap = await tokenRef.get();

        if (!tokenSnap.exists) {
            return res.status(403).json({ error: 'El enlace de configuración es inválido o ha expirado.' });
        }

        const tokenData = tokenSnap.data()!;

        if (tokenData.used) {
            return res.status(403).json({ error: 'Este enlace ya fue utilizado. Solicita uno nuevo si es necesario.' });
        }

        if (Date.now() > Number(tokenData.expiresAt || 0)) {
            return res.status(403).json({ error: 'El enlace ha expirado por políticas de seguridad (24 horas).' });
        }

        if (tokenData.hashedToken && !verifySetupTokenHash(token, String(tokenData.hashedToken))) {
            return res.status(403).json({ error: 'Firma del token de configuración inválida.' });
        }

        if (tokenData.accountId !== accountId) {
            return res.status(403).json({ error: 'Inconsistencia de seguridad: La cuenta solicitada no coincide con el token.' });
        }

        const cleanRequestTaxId = cleanRut(requestTaxId);
        if (cleanRut(String(tokenData.taxId || '')) !== cleanRequestTaxId && tokenData.taxId !== requestTaxId) {
            return res.status(403).json({ error: 'Inconsistencia de seguridad: La identidad no coincide con el token.' });
        }

        const formattedTaxId = formatRut(cleanRequestTaxId);
        const userDoc = await resolveTargetUserDoc(
            cleanRequestTaxId,
            accountId,
            typeof tokenData.uid === 'string' ? tokenData.uid : undefined
        );

        if (!userDoc || !userDoc.exists) {
            console.error(`[SETUP-CORE] Usuario no encontrado para taxId=${cleanRequestTaxId}, accountId=${accountId}`);
            return res.status(404).json({ error: 'Registro de identidad no encontrado. Contacte a soporte técnico.' });
        }

        const userData = userDoc.data()!;
        const memberships = Array.isArray(userData.memberships) ? userData.memberships : [];

        const result = await updateUserPassword(
            userDoc.ref,
            memberships,
            accountId,
            password,
            res,
            formattedTaxId,
            extractClientIp(req)
        );

        if (res.statusCode === 200) {
            await tokenRef.update({
                used: true,
                usedAt: Date.now()
            });
        }

        return result;
    } catch (error) {
        console.error('[AUTH-TUNNEL] Setup Password Error:', error);
        return res.status(500).json({ error: 'Failed to establish security credentials' });
    }
};

/**
 * Actualiza credenciales guardando `passwordHash` únicamente en `user_auth_credentials/{uid}`
 * y limpiando cualquier `passwordHash` heredado en `/users/{uid}`.
 */
export const updateUserPassword = async (
    userDocRef: FirebaseFirestore.DocumentReference,
    memberships: any[],
    accountId: string,
    password: string,
    res: Response,
    taxId?: string,
    ipAddress?: string
) => {
    try {
        const mIndex = memberships.findIndex((m: any) => m?.accountId === accountId);
        if (mIndex === -1) {
            return res.status(404).json({ error: 'Membership link not found' });
        }

        const userUid = userDocRef.id;
        const passwordHash = hashPassword(password);
        const activatedAtIso = new Date().toISOString();

        // 1. Guardar hash EXCLUSIVAMENTE en colección protegida de servidor `user_auth_credentials/{uid}`
        await db.collection('user_auth_credentials').doc(userUid).set(
            {
                uid: userUid,
                passwordHash,
                updatedAt: Date.now(),
                accounts: {
                    [accountId]: {
                        passwordHash,
                        activatedAt: activatedAtIso,
                        updatedAt: Date.now(),
                    },
                },
            },
            { merge: true }
        );

        // 2. Sanitizar `memberships` para NO volver a escribir `passwordHash` en `/users/{uid}`
        const sanitizedMemberships = memberships.map((mem: any, idx: number) => {
            const { passwordHash: _legacyHash, ...cleanMem } = mem || {};
            if (idx === mIndex) {
                return {
                    ...cleanMem,
                    activatedAt: activatedAtIso,
                    status: 'ACTIVE',
                };
            }
            return cleanMem;
        });

        // 3. Sincronizar estado en `/accounts/{accountId}/members/{userUid}`
        try {
            const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userUid);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists) {
                await memberRef.update({
                    status: 'ACTIVE',
                    activatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (memberSyncError) {
            console.error('[AUTH-TUNNEL] Failed to sync member status:', memberSyncError);
        }

        // 4. Sincronizar estado y `uid` en `user_directory`
        if (taxId) {
            try {
                for (const variant of getRutVariants(taxId)) {
                    const dirRef = db.collection('user_directory').doc(variant);
                    const dirSnap = await dirRef.get();
                    if (dirSnap.exists) {
                        const dirData = dirSnap.data() || {};
                        const dirAccounts = Array.isArray(dirData.accounts) ? dirData.accounts : [];
                        const accIdx = dirAccounts.findIndex((a: any) => a?.accountId === accountId);
                        if (accIdx !== -1) {
                            dirAccounts[accIdx].status = 'ACTIVE';
                            dirAccounts[accIdx].uid = userUid;
                            await dirRef.update({ uid: userUid, accounts: dirAccounts });
                        }
                    }
                }
            } catch (dirSyncError) {
                console.error('[AUTH-TUNNEL] Failed to sync user_directory:', dirSyncError);
            }
        }

        // 5. Sincronizar clave en Firebase Auth
        await auth.updateUser(userUid, {
            password,
            emailVerified: true
        });

        // 6. Actualizar `/users/{uid}` sin ningún `passwordHash`
        await userDocRef.update({
            memberships: sanitizedMemberships,
            status: 'ACTIVE',
            updatedAt: Date.now()
        });

        const tenantSnap = await db.collection('tenants').doc(accountId).get();
        if (tenantSnap.exists) {
            await tenantSnap.ref.update({
                status: 'ACTIVE',
                activatedAt: activatedAtIso
            });
        }

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: userUid,
            actorEmail: 'setup-tunnel@minreport.internal',
            action: 'ACCOUNT_PASSWORD_SETUP_COMPLETED',
            module: 'auth',
            targetEntity: userUid,
            details: { accountId },
            ipAddress: ipAddress || 'internal',
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Password established successfully. You can now log in.'
        });
    } catch (error) {
        console.error('[AUTH-TUNNEL] Setup Password Error:', error);
        return res.status(500).json({ error: 'Failed to establish security credentials' });
    }
};
