import { Request, Response } from 'express';
import { z } from 'zod';
import { db, auth } from '../config/firebase';
import { verifyPassword } from '../utils/security';
import { getRutVariants, cleanRut } from '../utils/rut';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';

const challengeSchema = z.object({
    accountId: z.string().min(1).max(128),
    taxId: z.string().min(3).max(64),
    password: z.string().min(1).max(256),
});

/**
 * Resuelve el documento `/users/{uid}` priorizando el `uid` registrado en `/user_directory/{variant}`,
 * luego `authEmail`, y manteniendo fallback de lectura a `/users/{cleanTaxId}` por retrocompatibilidad.
 */
async function resolveChallengeUserSnapshot(params: {
    variants: string[];
    cleanTaxId: string;
    accountId: string;
    matchedDirData: Record<string, any> | null;
    matchedAccountEntry: Record<string, any> | null;
}): Promise<FirebaseFirestore.DocumentSnapshot | null> {
    const candidateUid = params.matchedAccountEntry?.uid || params.matchedDirData?.uid;
    if (typeof candidateUid === 'string' && candidateUid.trim()) {
        const directUidSnap = await db.collection('users').doc(candidateUid.trim()).get();
        if (directUidSnap.exists) return directUidSnap;
    }

    const authEmail = params.matchedAccountEntry?.authEmail;
    if (typeof authEmail === 'string' && authEmail.trim()) {
        const normalizedEmail = authEmail.trim().toLowerCase();
        const byEmailSnap = await db
            .collection('users')
            .where('email', '==', normalizedEmail)
            .limit(5)
            .get();
        if (!byEmailSnap.empty) {
            const withAccount = byEmailSnap.docs.find((d) =>
                (d.data()?.memberships || []).some((m: any) => m?.accountId === params.accountId)
            );
            if (withAccount) return withAccount;
            return byEmailSnap.docs[0];
        }

        try {
            const authUser = await auth.getUserByEmail(normalizedEmail);
            const authDoc = await db.collection('users').doc(authUser.uid).get();
            if (authDoc.exists) return authDoc;
        } catch {
            // Continuar fallback
        }
    }

    const byTaxIdSnap = await db
        .collection('users')
        .where('taxId', 'in', params.variants.slice(0, 10))
        .limit(5)
        .get();
    if (!byTaxIdSnap.empty) {
        const withAccount = byTaxIdSnap.docs.find((d) =>
            (d.data()?.memberships || []).some((m: any) => m?.accountId === params.accountId)
        );
        if (withAccount) return withAccount;
    }

    // Fallback retrocompatible: `/users/{cleanTaxId}`
    const legacySnap = await db.collection('users').doc(params.cleanTaxId).get();
    if (legacySnap.exists) return legacySnap;

    return null;
}

/**
 * @route POST /api/auth/tunnel/challenge
 * @desc Autentica un usuario por RUT/RUN + clave para una cuenta específica.
 *       Lee credenciales desde `user_auth_credentials/{uid}` con fallback de solo lectura
 *       a `memberships[].passwordHash` para datos anteriores, sin escribir hashes en `/users/{uid}`.
 */
export const challengeAccountAccess = async (req: Request, res: Response) => {
    try {
        const parsed = challengeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'accountId, taxId (RUT/RUN) y password válidos son requeridos.' });
        }

        const { accountId, taxId, password } = parsed.data;
        const cleanTaxId = cleanRut(taxId);
        const variants = getRutVariants(taxId);

        // PASO 1: Resolver en `/user_directory/{variant}`
        let matchedDirEntry: Record<string, any> | null = null;
        let matchedDirData: Record<string, any> | null = null;

        for (const variant of variants) {
            const dirSnap = await db.collection('user_directory').doc(variant).get();
            if (dirSnap.exists) {
                const dirData = dirSnap.data() || {};
                const accountEntry = (Array.isArray(dirData.accounts) ? dirData.accounts : []).find(
                    (a: any) => a?.accountId === accountId
                );
                if (accountEntry) {
                    matchedDirEntry = accountEntry;
                    matchedDirData = dirData;
                    break;
                }
            }
        }

        if (!matchedDirEntry) {
            return res.status(404).json({ error: 'RUT/RUN no registrado o sin acceso a esta cuenta.' });
        }

        // PASO 2: Resolver el documento real `/users/{uid}`
        const userDoc = await resolveChallengeUserSnapshot({
            variants,
            cleanTaxId,
            accountId,
            matchedDirData,
            matchedAccountEntry: matchedDirEntry,
        });

        if (!userDoc || !userDoc.exists) {
            return res.status(404).json({ error: 'Cuenta no inicializada. Contacta a soporte.' });
        }

        const resolvedUid = userDoc.id;
        const userData = userDoc.data()!;
        const memberships: any[] = Array.isArray(userData.memberships) ? userData.memberships : [];
        const accountMemberships = memberships.filter((m: any) => m?.accountId === accountId);

        if (accountMemberships.length === 0) {
            return res.status(403).json({ error: 'Sin acceso a esta cuenta.' });
        }

        const membership = accountMemberships.find((m: any) => !!m.passwordHash) || accountMemberships[0];
        if (String(membership?.status || '').toUpperCase() === 'SUSPENDED' || String(membership?.status || '').toUpperCase() === 'REVOKED') {
            return res.status(403).json({ error: 'Membresía suspendida o revocada.' });
        }

        // PASO 3: Leer credencial desde colección exclusiva de servidor `user_auth_credentials/{uid}` (con fallback de lectura a `memberships` antiguos)
        let storedHash: string | null = null;
        const credsSnap = await db.collection('user_auth_credentials').doc(resolvedUid).get();
        if (credsSnap.exists) {
            const credsData = credsSnap.data() || {};
            storedHash =
                credsData?.accounts?.[accountId]?.passwordHash ||
                credsData?.passwordHash ||
                null;
        }

        if (!storedHash && typeof membership?.passwordHash === 'string' && membership.passwordHash) {
            storedHash = membership.passwordHash;
        }

        if (!storedHash) {
            return res.status(401).json({
                error: 'Cuenta no activada. Revisa tu email de bienvenida para crear tu clave de acceso.'
            });
        }

        const isValid = verifyPassword(password, storedHash);
        if (!isValid) {
            return res.status(401).json({ error: 'RUT/RUN o contraseña incorrectos.' });
        }

        // PASO 4: Emitir Custom Token con el UID real verificado
        const customToken = await auth.createCustomToken(resolvedUid, {
            activeAccountId: accountId,
            role: membership.role,
            type: membership.type || 'BUSINESS'
        });

        await userDoc.ref.update({
            lastActiveAccountId: accountId,
            lastLogin: new Date().toISOString()
        });

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: resolvedUid,
            actorEmail: String(userData.email || `${resolvedUid}@minreport.local`),
            action: 'AUTH_TUNNEL_LOGIN_SUCCESS',
            module: 'auth',
            targetEntity: accountId,
            details: { role: membership.role },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            firebaseToken: customToken,
            user: {
                uid: resolvedUid,
                displayName: userData.displayName || userData.fullName,
                role: membership.role,
                activeAccountId: accountId
            }
        });
    } catch (error) {
        console.error('[AUTH-TUNNEL] Challenge Error:', error);
        return res.status(500).json({ error: 'Error interno durante el challenge de autenticación.' });
    }
};
