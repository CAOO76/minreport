import { Request, Response } from 'express';
import admin, { db } from '../config/firebase';
import { hashPassword } from '../utils/security';
import { formatRut } from '../utils/rut';

/**
 * @route POST /api/auth/tunnel/setup-password
 * @desc Set the initial password for a specific account access
 * @access Public (Link from email)
 */
export const setupAccountPassword = async (req: Request, res: Response) => {
    try {
        const { token, accountId, password, taxId: requestTaxId } = req.body;

        if (!token || !accountId || !password || !requestTaxId) {
            return res.status(400).json({ error: 'Faltan parámetros de seguridad obligatorios' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }

        // 1. Verificar Token
        const tokenRef = db.collection('setup_tokens').doc(token);
        const tokenSnap = await tokenRef.get();

        if (!tokenSnap.exists) {
            console.warn(`[SETUP-CORE] Intento con token inválido o inexistente: ${token.substring(0, 10)}...`);
            return res.status(403).json({ error: 'El enlace de configuración es inválido o ha expirado.' });
        }

        const tokenData = tokenSnap.data()!;

        // 2. Validaciones de Seguridad del Token
        if (tokenData.used) {
            return res.status(403).json({ error: 'Este enlace ya fue utilizado. Solicita uno nuevo si es necesario.' });
        }

        if (Date.now() > tokenData.expiresAt) {
            return res.status(403).json({ error: 'El enlace ha expirado por políticas de seguridad (24 horas).' });
        }

        if (tokenData.accountId !== accountId) {
            return res.status(403).json({ error: 'Inconsistencia de seguridad: La cuenta solicitada no coincide con el token.' });
        }

        // Normalize requested taxId vs token taxId to prevent tampering
        const cleanRequestTaxId = requestTaxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
        if (tokenData.taxId !== cleanRequestTaxId) {
            return res.status(403).json({ error: 'Inconsistencia de seguridad: La identidad no coincide con el token.' });
        }

        const formattedTaxId = formatRut(cleanRequestTaxId);

        console.log(`[SETUP-CORE] Token validado para taxId(UID): ${cleanRequestTaxId}, accountId: ${accountId}`);

        // 3. Buscar Usuario Directamente por UID Fijo (taxId)
        const userDocRef = db.collection('users').doc(cleanRequestTaxId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            console.error(`[SETUP-CORE] ❌ Error de integridad: Usuario no encontrado en /users para UID: ${cleanRequestTaxId}`);
            return res.status(500).json({ error: 'Error de integridad en el registro. Contacte a soporte técnico.' });
        }

        const userData = userDoc.data()!;
        const memberships = userData.memberships || [];

        // 4. Actualizar estado y contraseña
        const result = await updateUserPassword(userDocRef, memberships, accountId, password, res, formattedTaxId);

        // 5. Invalidad Token
        if (result.statusCode === 200) {
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
 * Helper to update user password in memberships and Firebase Auth
 */
export const updateUserPassword = async (userDocRef: any, memberships: any[], accountId: string, password: string, res: Response, taxId?: string) => {
    try {
        // 2. Find specific membership
        const mIndex = memberships.findIndex((m: any) => m.accountId === accountId);

        if (mIndex === -1) {
            return res.status(404).json({ error: 'Membership link not found' });
        }

        // 3. Hash and Store password
        const { hashPassword } = await import('../utils/security');
        const userUid = userDocRef.id;
        const passwordHash = hashPassword(password);
        memberships[mIndex].passwordHash = passwordHash;
        memberships[mIndex].activatedAt = new Date().toISOString();
        memberships[mIndex].status = 'ACTIVE';

        // 3.5 Sync status to the account's members subcollection
        try {
            const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userUid);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists) {
                await memberRef.update({
                    status: 'ACTIVE',
                    activatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`[AUTH-TUNNEL] ✅ Member status synced to ACTIVE for UID: ${userUid} in Account: ${accountId}`);
            }
        } catch (memberSyncError) {
            console.error('[AUTH-TUNNEL] ❌ Failed to sync member status:', memberSyncError);
        }

        // 3.7 Sync status to user_directory (Lookup Cache)
        if (taxId) {
            try {
                // Try several formats as user_directory ID
                const cleanTaxId = taxId.replace(/\./g, "").replace(/-/g, "").trim().toUpperCase();
                const variants = [taxId, cleanTaxId];
                if (cleanTaxId.length >= 2) variants.push(`${cleanTaxId.slice(0, -1)}-${cleanTaxId.slice(-1)}`);

                for (const variant of variants) {
                    const dirRef = db.collection('user_directory').doc(variant);
                    const dirSnap = await dirRef.get();
                    if (dirSnap.exists) {
                        const dirData = dirSnap.data() || {};
                        const dirAccounts = dirData.accounts || [];
                        const accIdx = dirAccounts.findIndex((a: any) => a.accountId === accountId);
                        if (accIdx !== -1) {
                            dirAccounts[accIdx].status = 'ACTIVE';
                            await dirRef.update({ accounts: dirAccounts });
                            console.log(`[AUTH-TUNNEL] ✅ user_directory synced to ACTIVE for TaxID: ${variant}`);
                        }
                    }
                }
            } catch (dirSyncError) {
                console.error('[AUTH-TUNNEL] ❌ Failed to sync user_directory:', dirSyncError);
            }
        }

        // 4. Sync with Firebase Auth
        console.log(`[AUTH-TUNNEL] Syncing password with Firebase Auth for UID: ${userUid}`);
        const { auth } = await import('../config/firebase');
        await auth.updateUser(userUid, {
            password: password,
            emailVerified: true
        });

        // 5. Update the User document
        await userDocRef.update({
            memberships: memberships,
            updatedAt: Date.now()
        });

        // 6. Update the Tenant/Request status if needed
        const tenantSnap = await db.collection('tenants').doc(accountId).get();
        if (tenantSnap.exists) {
            await tenantSnap.ref.update({
                status: 'ACTIVE',
                activatedAt: new Date().toISOString()
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Password established successfully. You can now log in.'
        });

    } catch (error) {
        console.error('[AUTH-TUNNEL] Setup Password Error:', error);
        return res.status(500).json({ error: 'Failed to establish security credentials' });
    }
};
