import express, { Request, Response } from 'express';
import admin, { db, auth } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { env } from '../config/env';
import { generateSetupToken } from '../utils/security';
import { formatRut } from '../utils/rut';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import https from 'https';

const execAsync = promisify(exec);

const downloadFile = async (url: string, dest: string): Promise<void> => {
    console.log(`[DevOps] Executing download via curl to follow redirects: ${dest}`);
    // -L follows redirects, -o specifies output file, -s is silent but we want errors
    await execAsync(`curl -L "${url}" -o "${dest}"`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 100) {
        throw new Error(`Download failed or file too small: ${dest}`);
    }
};

// [NEW] Helper: Audit Action Logger
const auditAction = async (actorEmail: string, action: string, targetId: string, details?: any) => {
    try {
        await db.collection('audit_logs').add({
            actor: actorEmail,
            action,
            targetId,
            details: details || {},
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: '127.0.0.1' // In a real deployment, extract from req currently not passed here
        });
        console.log(`[AUDIT] Action logged: ${action} by ${actorEmail}`);
    } catch (error) {
        console.error('[AUDIT] Failed to log action:', error);
    }
};



export const listTenants = async (req: express.Request, res: express.Response) => {
    try {
        const status = req.query.status as string;
        let query: any = db.collection('tenants');

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query.orderBy('createdAt', 'desc').get();
        console.log(`[ADMIN] Found ${snapshot.size} tenants in Firestore`);

        const tenants = snapshot.docs.map((doc: any) => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.status(200).json(tenants);
    } catch (error) {
        console.error('[ADMIN] Error listing tenants:', error);
        return res.status(500).json({ error: 'Failed to fetch tenants' });
    }
};

export const listAccounts = async (req: express.Request, res: express.Response) => {
    try {
        const type = req.query.type as string;
        let query: any = db.collection('accounts');

        if (type) {
            query = query.where('type', '==', type);
        }

        const snapshot = await query.orderBy('createdAt', 'desc').get();
        console.log(`[ADMIN] Found ${snapshot.size} accounts in Firestore (type: ${type || 'ALL'})`);

        const accounts = snapshot.docs.map((doc: any) => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.status(200).json(accounts);
    } catch (error) {
        console.error('[ADMIN] Error listing accounts:', error);
        return res.status(500).json({ error: 'Failed to fetch accounts' });
    }
};

export const adminLogin = async (req: express.Request, res: express.Response) => {
    const { email, password } = req.body;

    console.log(`[ADMIN-LOGIN] Attempt for: ${email}`);
    if (email === env.SUPER_ADMIN_EMAIL && password === env.SUPER_ADMIN_PASSWORD) {
        // Create or get the Super Admin user in Firebase Auth
        let uid = 'super-admin-id';
        try {
            const user = await auth.getUserByEmail(env.SUPER_ADMIN_EMAIL);
            uid = user.uid;
        } catch (e) {
            // If doesn't exist, Create it (though it should exist by script)
            const newUser = await auth.createUser({
                email: env.SUPER_ADMIN_EMAIL,
                password: env.SUPER_ADMIN_PASSWORD,
                displayName: 'Super Admin'
            });
            uid = newUser.uid;
            // Set claims
            await auth.setCustomUserClaims(uid, { role: 'SUPER_ADMIN' });
        }

        // Generate Custom Token for Client SDK
        const firebaseToken = await auth.createCustomToken(uid, { role: 'SUPER_ADMIN' });

        // [NEW] Ensure Super Admin document exists in Firestore for Rule compatibility
        console.log(`[ADMIN] Ensuring Super Admin doc exists for UID: ${uid}`);
        await db.collection('users').doc(uid).set({
            uid,
            email: env.SUPER_ADMIN_EMAIL,
            displayName: 'Super Admin',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log(`[ADMIN] Super Admin doc synced successfully`);

        return res.status(200).json({
            success: true,
            token: 'master-admin-access-token',
            firebaseToken, // Return the custom token
            user: { email: env.SUPER_ADMIN_EMAIL, role: 'super-admin' }
        });
    }

    return res.status(401).json({ error: 'Invalid admin credentials' });
};

import { AuthRequest } from '../middleware/admin';

export const updateTenantStatus = async (req: AuthRequest, res: express.Response) => {
    console.log('Admin Params received:', req.params);
    const { uid } = req.params;
    const { status, rejectionReason, observations, enabledPlugins } = req.body;
    const adminEmail = req.user?.email || 'master-admin';

    if (!['ACTIVE', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const tenantRef = db.collection('tenants').doc(uid);
        const tenantDoc = await tenantRef.get();

        if (!tenantDoc.exists) {
            return res.status(404).json({ error: 'Tenant record not found' });
        }

        const tenantData = tenantDoc.data()!;
        const entityName = tenantData.company_name || tenantData.institution_name || tenantData.full_name || 'tu cuenta';

        if (status === 'ACTIVE') {
            const taxId = 'rut' in tenantData ? tenantData.rut : ('run' in tenantData ? tenantData.run : null);
            if (!taxId) {
                return res.status(400).json({ error: 'Falta RUT/RUN en el registro del tenant.' });
            }

            // Normalizamos el RUT/RUN para usarlo como UID inmutable
            const cleanTaxId = taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();

            // Generar Email Sintético para Bypassar Firebase Auth "Email already in use" restricción
            const syntheticAuthEmail = `${cleanTaxId.toLowerCase()}@auth.minreport.internal`;

            // 1. Forzar Creación/Busqueda de Usuario usando el RUT/RUN como UID
            let userRecord;
            try {
                userRecord = await auth.getUser(cleanTaxId);
            } catch (authError: any) {
                if (authError.code === 'auth/user-not-found') {
                    userRecord = await auth.createUser({
                        uid: cleanTaxId, // 🚨 EL UID AHORA ES EL RUT NORMALIZADO
                        email: syntheticAuthEmail, // Usamos email sintético para blindar Firebase Auth identity mergers.
                        emailVerified: true,
                        displayName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                        disabled: false
                    });
                    console.log(`[ADMIN-IDENTITY] Creado Identity Titular con UID estricto y correo asilado: ${cleanTaxId}`);
                } else {
                    throw authError;
                }
            }

            // Si el email sintético del usuario existente cambió por migración, lo actualizamos solo referencialmente
            if (userRecord.email !== syntheticAuthEmail) {
                await auth.updateUser(cleanTaxId, { email: syntheticAuthEmail });
            }

            // 2. Set Custom Claims usando el RUT UID
            await auth.setCustomUserClaims(userRecord.uid, {
                role: 'USER',
                tier: tenantData.type,
                tenantId: uid
            });

            // 3. Generar Custom Setup Token (Reemplaza Firebase Auth Reset Link)
            const accountId = uid;
            const baseUrl = process.env.NODE_ENV === 'production'
                ? 'https://minreport-access.web.app'
                : 'http://localhost:5173';

            const { rawToken, hashedToken, expiresAt } = generateSetupToken();

            // 4. Update Firestore with uid and status in tenants
            await tenantRef.update({
                status: 'APPROVED',
                authUid: userRecord.uid,
                processedAt: new Date().toISOString(),
                processedBy: adminEmail,
                observations: observations || null,
                enabledPlugins: enabledPlugins || [], // [NEW] Persist plugin preferences
                updatedAt: new Date().toISOString()
            });

            // 4.1 Create Account Document (The Business Entity)
            await db.collection('accounts').doc(accountId).set({
                id: accountId,
                name: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                type: tenantData.type,
                taxId: taxId,
                ownerId: userRecord.uid,
                enabledPlugins: enabledPlugins || [],
                giro: tenantData.industry || '',
                direccionComercial: tenantData.address || '',
                postal_code: tenantData.postal_code || '',
                city: tenantData.city || '',
                commune: tenantData.commune || '',
                region: tenantData.region || '',
                emailTributario: tenantData.billing_email || '',
                email_domain: tenantData.email_domain || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, { merge: true });

            // 4.5 Create/Sync User Document in 'users' collection for Titular

            // Determine role based on segregation B2B requirements
            // Enterprise (B2B) initial access is always 'BILLING_ONLY' (Management Hub)
            const userRole = tenantData.type === 'ENTERPRISE'
                ? 'BILLING_ONLY'
                : 'OWNER';

            const memberships = [{
                accountId: accountId,
                role: userRole,
                companyName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                joinedAt: Date.now()
            }];

            // Check if user document already exists
            const existingUserDoc = await db.collection('users').doc(userRecord.uid).get();

            if (existingUserDoc.exists) {
                // User exists: Check for existing membership to avoid duplicates
                const userData = existingUserDoc.data();
                const currentMemberships = userData?.memberships || [];
                const alreadyMember = currentMemberships.some((m: any) => m.accountId === accountId);

                if (!alreadyMember) {
                    // Update memberships and protect taxId if not set.
                    // Use filter + push to REPLACE existing entries for same accountId,
                    // preventing duplicates from accumulating in the array.
                    const existingMems = userData?.memberships || [];
                    const cleanedMems = existingMems.filter((m: any) => m.accountId !== accountId);
                    cleanedMems.push(...memberships);

                    const updateData: any = {
                        memberships: cleanedMems,
                        updatedAt: new Date().toISOString()
                    };

                    await db.collection('users').doc(userRecord.uid).update(updateData);
                    console.log(`[ADMIN-IDENTITY] Titular account membership synced for ${userRecord.uid}`);
                } else {
                    console.log(`[ADMIN-IDENTITY] Titular ${userRecord.uid} already member, skipping add.`);
                }
            } else {
                // New user, create full document
                await db.collection('users').doc(userRecord.uid).set({
                    uid: userRecord.uid,
                    email: tenantData.email,
                    taxId: formatRut(taxId), // Standardized format
                    displayName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                    role: 'USER',
                    memberships: memberships,
                    lastActiveAccountId: accountId,
                    status: 'APPROVED',
                    entitlements: {
                        pluginsEnabled: [],
                        storageLimit: 1073741824 // 1GB default
                    },
                    stats: {
                        storageUsed: 0,
                        lastLogin: null
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                console.log(`[ADMIN] Created new user document for ${userRecord.uid}`);
            }

            // 4.6 Sync with user_directory (Pasillo de Puertas Blindadas)
            // This ensures the user is findable during the new login flow
            const userDirRef = db.collection('user_directory').doc(taxId);
            const userDirSnap = await userDirRef.get();

            const accountRef = {
                accountId: accountId,
                authEmail: tenantData.email,
                role: userRole,
                type: tenantData.type,
                accountName: entityName,
                status: 'APPROVED'
            };

            if (userDirSnap.exists) {
                const dirData = userDirSnap.data();
                let accounts = dirData?.accounts || [];

                if (tenantData.type === 'PERSONAL') {
                    // Rule 1: PERSONAL (1:1 Estricto) - Remove any old reference
                    accounts = accounts.filter((a: any) => a.type !== 'PERSONAL');
                } else if (tenantData.type === 'EDUCATIONAL') {
                    // Rule 2: EDUCATIONAL (1:1 Reemplazable)
                    // If institution changes, the previous one is purged from directory and deactivated
                    const prevEdu = accounts.find((a: any) => a.type === 'EDUCATIONAL');
                    if (prevEdu && prevEdu.accountId !== accountId) {
                        console.log(`[ADMIN-INTEGRITY] Replacing EDUCATIONAL account: ${prevEdu.accountId} -> ${accountId}`);

                        // Deactivate previous enrollment
                        await db.collection('tenants').doc(prevEdu.accountId).update({
                            status: 'REPLACED_BY_NEW_ENROLLMENT',
                            updatedAt: new Date().toISOString()
                        });
                        await db.collection('accounts').doc(prevEdu.accountId).update({
                            status: 'REPLACED_BY_NEW_ENROLLMENT',
                            updatedAt: new Date().toISOString()
                        });

                        // Clean up memberships in main user document
                        const userDoc = await db.collection('users').doc(userRecord.uid).get();
                        if (userDoc.exists) {
                            const currentMems = userDoc.data()?.memberships || [];
                            const updatedMems = currentMems.filter((m: any) => m.accountId !== prevEdu.accountId);
                            await db.collection('users').doc(userRecord.uid).update({ memberships: updatedMems });
                        }
                    }
                    accounts = accounts.filter((a: any) => a.type !== 'EDUCATIONAL');
                } else {
                    // Rule 3: BUSINESS (1:N) - Just prevent duplicate accountId
                    accounts = accounts.filter((a: any) => a.accountId !== accountId);
                }

                accounts.push(accountRef);

                await userDirRef.update({
                    accounts,
                    fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (dirData?.fullName || entityName),
                    updatedAt: new Date().toISOString()
                });
            } else {
                await userDirRef.set({
                    run: taxId,
                    fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : entityName,
                    accounts: [accountRef],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }

            // 4.7 Sync with accounts/{id}/members subcollection (NEW: Ensure Titular is in members)
            const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid);
            await memberRef.set({
                userId: userRecord.uid,
                email: tenantData.email,
                fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : entityName,
                run: taxId,
                role: userRole,
                status: 'ACTIVE',
                joinedAt: Date.now()
            });

            // 4.8 Save Setup Token to initiate password creation
            await db.collection('setup_tokens').doc(rawToken).set({
                accountId,
                taxId: cleanTaxId,
                hashedToken,
                expiresAt,
                used: false,
                createdAt: Date.now()
            });

            const actionLink = `${baseUrl}/setup-access?accountId=${uid}&taxId=${cleanTaxId}&name=${encodeURIComponent(entityName)}&type=${tenantData.type}&token=${rawToken}`;

            // 5. Send Notification Email
            await EmailService.sendEmail({
                from: 'MinReport System <support@minreport.com>',
                to: tenantData.email,
                subject: 'Solicitud de Registro Aprobada',
                html: `
                    <div style="font-family: 'Arial', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <img src="https://minreport-access.web.app/pwa-192x192.png" alt="MINREPORT" style="height: 48px; width: auto; opacity: 0.9;" />
                        </div>
                        
                        <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 24px; margin-bottom: 24px;">
                            <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">Solicitud Aprobada</h2>
                            <p style="margin: 0; font-size: 15px; line-height: 1.6;">
                                Tu solicitud de registro ha sido validada exitosamente para operar en la plataforma.
                            </p>
                            
                            <div style="margin-top: 24px; background: white; border: 1px solid #E2E8F0; padding: 16px; border-radius: 4px;">
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Entidad Registrada</p>
                                <p style="margin: 0 0 16px 0; font-size: 16px; color: #0F172A; font-weight: bold;">${entityName}</p>
                                
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Correo Asociado</p>
                                <p style="margin: 0 0 16px 0; font-size: 14px; color: #0F172A;">${tenantData.email}</p>
                                
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Tipo de Entorno</p>
                                <p style="margin: 0; font-size: 14px; color: #0F172A;">${tenantData.type}</p>
                            </div>
                            
                            <p style="margin: 24px 0 0 0; font-size: 15px; line-height: 1.6;">
                                Por seguridad, deberás verificar tu identidad ingresando tu documento principal antes de establecer tu contraseña exclusiva de acceso.
                            </p>
                        </div>
                        
                        <div style="text-align: center; margin: 32px 0;">
                            <a href="${actionLink}" style="background: #0F172A; color: white; padding: 16px 32px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; border-radius: 2px;">Configurar Acceso Seguro</a>
                        </div>
                        
                        <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
                        <p style="font-size: 10px; color: #94A3B8; text-align: center; margin: 0; text-transform: uppercase; letter-spacing: 0.1em;">
                            MINREPORT SYSTEM INFRASTRUCTURE
                        </p>
                    </div>
                `
            });

            // [AUDIT] Log Approval
            await auditAction(adminEmail, 'APPROVE_TENANT', uid, { type: tenantData.type });

        } else if (status === 'REJECTED') {
            await tenantRef.update({
                status: 'REJECTED',
                rejectionReason: rejectionReason || 'No cumple con los requisitos mínimos',
                processedAt: new Date().toISOString(),
                processedBy: adminEmail,
                observations: observations || null,
                updatedAt: new Date().toISOString()
            });

            // 2. Notify Rejection
            await EmailService.sendEmail({
                from: 'MinReport <ops@minreport.com>',
                to: tenantData.email,
                subject: 'Estado de Solicitud',
                html: `
                    <div style="font-family: 'Arial', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <img src="https://minreport-access.web.app/pwa-192x192.png" alt="MINREPORT" style="height: 48px; width: auto; opacity: 0.9;" />
                        </div>
                        
                        <div style="background: #FFF1F2; border-left: 4px solid #E11D48; padding: 24px; margin-bottom: 24px;">
                            <h2 style="color: #E11D48; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">Estado de Solicitud</h2>
                            <p style="margin: 0; font-size: 15px; line-height: 1.6;">Lamentamos informarte que tu solicitud de acceso no ha sido aprobada.</p>
                            <p style="margin: 12px 0 0 0; font-size: 15px; line-height: 1.6;"><strong>Motivo:</strong> ${rejectionReason || 'La documentación proporcionada no ha podido ser validada conforme a nuestras políticas actuales.'}</p>
                        </div>
                        
                        <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
                        <p style="font-size: 10px; color: #94A3B8; text-align: center; margin: 0; text-transform: uppercase; letter-spacing: 0.1em;">
                            MINREPORT OPERATIONS SECURITY
                        </p>
                    </div>
                `
            });
        }

        return res.status(200).json({ success: true, status });
    } catch (error) {
        console.error('[ADMIN] Error updating tenant:', error);
        return res.status(500).json({ error: 'Failed to update tenant status and create account' });
    }
};

/**
 * Helper to cleanup members of an account. 
 * If a user has no other memberships after this account is removed, 
 * they are fully purged from Firebase Auth, /users, and /user_directory.
 */
async function cleanupAccountMembers(accountId: string, isPurge: boolean = false) {
    try {
        const membersSnap = await db.collection('accounts').doc(accountId).collection('members').get();
        if (membersSnap.empty) {
            console.log(`[CLEANUP] No members found in subcollection for account ${accountId}`);

            // Reintentar buscar en /users (escaneo completo) por seguridad si la subcolección falló
            const usersSnap = await db.collection('users').get();
            for (const userDoc of usersSnap.docs) {
                const userData = userDoc.data();
                const memberships = userData.memberships || [];
                if (memberships.some((m: any) => m.accountId === accountId)) {
                    await processUserCleanup(userDoc.id, userData.taxId, accountId, memberships, isPurge);
                }
            }
            return;
        }

        for (const memberDoc of membersSnap.docs) {
            const userId = memberDoc.id; // UID
            const memberData = memberDoc.data();
            const taxId = memberData.run || memberData.rut || memberData.taxId; // Dependiendo de la versión

            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data()!;
                const memberships = userData.memberships || [];
                const actualTaxId = userData.taxId || taxId;
                await processUserCleanup(userId, actualTaxId, accountId, memberships, isPurge);
            }
        }
    } catch (e) {
        console.error(`[CLEANUP] Failed to cleanup members for account ${accountId}:`, e);
    }
}

async function processUserCleanup(userId: string, taxId: string, accountId: string, memberships: any[], isPurge: boolean) {
    // Filtrar membresías
    const filteredMemberships = memberships.filter((m: any) => m.accountId !== accountId);

    if (filteredMemberships.length === 0) {
        // El usuario ya no tiene cuentas en MINREPORT. ¡PURGAR!
        console.log(`[CLEANUP] User ${userId} (${taxId}) has no remaining accounts. Deleting from DB and Auth.`);

        // 1. Delete from users
        await db.collection('users').doc(userId).delete();

        // 2. Delete from user_directory
        if (taxId) {
            const cleanTaxId = taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
            await db.collection('user_directory').doc(cleanTaxId).delete();
            // Delete formatted variant too just in case
            await db.collection('user_directory').doc(taxId).delete();
        }

        // 3. Delete from Firebase Auth
        try {
            await auth.deleteUser(userId);
            console.log(`[CLEANUP] ✅ Firebase Auth account deleted for UID: ${userId}`);
        } catch (authErr: any) {
            console.warn(`[CLEANUP] ⚠️ Failed to delete Firebase Auth user ${userId}:`, authErr.message);
        }

    } else {
        // Al usuario aún le quedan otras cuentas en MINREPORT.
        console.log(`[CLEANUP] User ${userId} (${taxId}) still has ${filteredMemberships.length} accounts. Updating.`);

        // 1. Update users
        await db.collection('users').doc(userId).update({ memberships: filteredMemberships });

        // 2. Update user_directory
        if (taxId) {
            const cleanTaxId = taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
            try {
                const dirRef = db.collection('user_directory').doc(cleanTaxId);
                const dirDoc = await dirRef.get();
                if (dirDoc.exists) {
                    const dirData = dirDoc.data()!;
                    const dirAccounts = (dirData.accounts || []).filter((a: any) => a.accountId !== accountId);
                    if (dirAccounts.length === 0) {
                        await dirRef.delete();
                    } else {
                        await dirRef.update({ accounts: dirAccounts });
                    }
                }
            } catch (dirErr) { }
        }
    }
}

/**
 * DELETE /api/admin/tenants/:uid
 * Soft Delete: Marks status as DELETED, prevents access, retains data for 30 days.
 * Also decouples user memberships to preserve identity.
 */
export const deleteTenant = async (req: express.Request, res: express.Response) => {
    try {
        const { uid } = req.params;
        const actor = (req as any).user?.email || 'system';

        console.log(`[SOFT-DELETE] Initiated for tenant ${uid} by ${actor}`);

        // 1. Update Tenant Status (Soft Delete)
        await db.collection('tenants').doc(uid).update({
            status: 'DELETED',
            deletedAt: new Date().toISOString(),
            deletedBy: actor
        });

        // 2. Update Account Status (Blocks Access)
        const accountRef = db.collection('accounts').doc(uid);
        const accountDoc = await accountRef.get();
        if (accountDoc.exists) {
            await accountRef.update({
                status: 'DELETED',
                deletedAt: new Date().toISOString()
            });
        }

        // 2.5 Cleanup users attached to this account
        await cleanupAccountMembers(uid, false);

        // 3. Audit
        await auditAction(actor, 'SOFT_DELETE_TENANT', uid, { retentionDays: 30 });

        return res.status(200).json({
            success: true,
            message: 'Account moved to trash (Soft Delete). Data retained for 30 days.'
        });

    } catch (error) {
        console.error('[ADMIN] Error soft-deleting tenant:', error);
        return res.status(500).json({ error: 'Failed to delete tenant' });
    }
};

/**
 * DELETE /api/admin/tenants/:uid/purge
 * Hard Delete: Permanently removes data from Firestore and Storage.
 * Super Admin Only.
 */
export const purgeTenant = async (req: express.Request, res: express.Response) => {
    try {
        const { uid } = req.params;
        const actor = (req as any).user?.email || 'system';

        console.log(`[HARD-PURGE] Initiated for tenant ${uid} by ${actor}`);

        // 0.5 Cleanup users attached to this account (Before deleting the account doc)
        await cleanupAccountMembers(uid, true);

        // 1. Delete Firestore Documents
        await db.collection('tenants').doc(uid).delete();
        await db.collection('accounts').doc(uid).delete();

        // 2. Audit
        await auditAction(actor, 'PURGE_TENANT', uid, { outcome: 'PERMANENT_DATA_LOSS' });

        return res.status(200).json({
            success: true,
            message: 'Tenant permanently purged.'
        });
    } catch (error) {
        console.error('[ADMIN] Purge error:', error);
        return res.status(500).json({ error: 'Failed to purge tenant' });
    }
};

export const getBrandingSettings = async (req: express.Request, res: express.Response) => {
    try {
        const doc = await db.collection('settings').doc('branding').get();
        if (!doc.exists) {
            return res.json({ siteName: 'MinReport', primaryColor: '#000000' });
        }
        res.json(doc.data());
    } catch (error) {
        console.error('Error getting branding settings:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const updateBrandingSettings = async (req: express.Request, res: express.Response) => {
    try {
        const settings = req.body;
        await db.collection('settings').doc('branding').set(settings, { merge: true });

        // 🔥 AUTOMATED DEVOPS: Sync icons with local filesystem (Zero-Code Solution)
        // We do this in background to not block the UI
        const syncAssets = async () => {
            try {
                const rootDir = process.cwd();
                const webPublicDir = path.join(rootDir, 'web/public');
                const androidResDir = path.join(rootDir, 'web/android/app/src/main/res');
                console.log(`[DevOps] Sync starting. rootDir: ${rootDir}`);

                // 1. Sync PWA Icons (Web Browser)
                const pwaIconUrl = settings.light?.pwaIcon || settings.dark?.pwaIcon || settings.light?.isotype;
                if (pwaIconUrl) {
                    console.log('[DevOps] Syncing PWA Icons...');
                    const ext = pwaIconUrl.toLowerCase().includes('.svg') ? '.svg' : '.png';
                    const tempIcon = path.join(rootDir, `temp_pwa_master${ext}`);
                    await downloadFile(pwaIconUrl, tempIcon);

                    // Sync to Web App
                    if (fs.existsSync(webPublicDir)) {
                        if (ext === '.svg') {
                            // Direct copy for SVGs to maintain vector quality
                            fs.copyFileSync(tempIcon, path.join(webPublicDir, 'branding/master_icon.svg'));
                            console.log('[DevOps] SVG Master Icon updated in web/public/branding');
                        } else {
                            await execAsync(`sips -z 192 192 "${tempIcon}" --out "${path.join(webPublicDir, 'pwa-192x192.png')}"`);
                            await execAsync(`sips -z 512 512 "${tempIcon}" --out "${path.join(webPublicDir, 'pwa-512x512.png')}"`);
                            console.log('[DevOps] PNG PWA Icons updated in web/public');
                        }
                    }
                    if (fs.existsSync(tempIcon)) fs.unlinkSync(tempIcon);
                }

                // 2. Sync Native Mobile Icons (Android)
                // [BRANDING-AUTO] Safe-Zone Logic: Enforce 66% safe area to prevent clipping
                const appIconUrl = settings.dark?.appIcon || settings.light?.appIcon;
                if (appIconUrl && fs.existsSync(androidResDir)) {
                    console.log('[DevOps] Syncing Native Mobile Icons with Safe Zone...');
                    const ext = appIconUrl.toLowerCase().includes('.svg') ? '.svg' : '.png';
                    const tempAppIcon = path.join(rootDir, `temp_app_master${ext}`);
                    await downloadFile(appIconUrl, tempAppIcon);

                    const mipmapConfigs = [
                        { dir: 'mipmap-mdpi', size: 48, adaptive: 108 },
                        { dir: 'mipmap-hdpi', size: 72, adaptive: 162 },
                        { dir: 'mipmap-xhdpi', size: 96, adaptive: 216 },
                        { dir: 'mipmap-xxhdpi', size: 144, adaptive: 324 },
                        { dir: 'mipmap-xxxhdpi', size: 192, adaptive: 432 },
                    ];

                    for (const config of mipmapConfigs) {
                        const targetDir = path.join(androidResDir, config.dir);
                        if (fs.existsSync(targetDir)) {
                            // [SAFE-ZONE] Resize to 66% of target and pad with transparency
                            // For adaptive icons (108dp default), the safe zone is roughly 72px center
                            const safeSize = Math.floor(config.size * 0.66);
                            const adaptiveSafeSize = Math.floor(config.adaptive * 0.66);

                            if (ext === '.svg') {
                                // For SVGs on Mac, sips can still rasterize them to PNG for Android Res
                                await execAsync(`sips -s format png -z ${safeSize} ${safeSize} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher.png')}"`);
                                await execAsync(`sips -s format png -z ${adaptiveSafeSize} ${adaptiveSafeSize} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher_foreground.png')}"`);
                            } else {
                                await execAsync(`sips -z ${safeSize} ${safeSize} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher.png')}"`);
                                await execAsync(`sips -z ${adaptiveSafeSize} ${adaptiveSafeSize} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher_foreground.png')}"`);
                            }

                            // Pad to original size (Centering)
                            await execAsync(`sips --padToHeightWidth ${config.size} ${config.size} "${path.join(targetDir, 'ic_launcher.png')}"`);
                            await execAsync(`sips --padToHeightWidth ${config.adaptive} ${config.adaptive} "${path.join(targetDir, 'ic_launcher_foreground.png')}"`);

                            // Compatibility Round Icon
                            fs.copyFileSync(path.join(targetDir, 'ic_launcher.png'), path.join(targetDir, 'ic_launcher_round.png'));
                        }
                    }
                    console.log('[DevOps] Android Native Icons updated with Safe Zone');
                    if (fs.existsSync(tempAppIcon)) fs.unlinkSync(tempAppIcon);
                }
            } catch (syncErr) {
                console.error('[DevOps Error] Failed to sync assets to local filesystem:', syncErr);
            }
        };

        syncAssets(); // Runs in background

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating branding settings:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// [NEW] System Metrics Endpoint
export const getSystemMetrics = async (req: express.Request, res: express.Response) => {
    try {
        const tenantsCount = (await db.collection('tenants').count().get()).data().count;
        const usersCount = (await db.collection('users').count().get()).data().count;

        // Calculate storage (approximate via aggregation or metadata)
        // For now, mocking aggregated storage query for performance
        const storageUsed = 0; // TODO: Implement proper aggregation

        return res.status(200).json({
            tenants: tenantsCount,
            users: usersCount,
            storageUsed,
            activeSessions: Math.floor(usersCount * 0.2) // Mock estimation
        });
    } catch (error) {
        console.error('Error fetching metrics:', error);
        return res.status(500).json({ error: 'Failed to metrics' });
    }
};

// [NEW] Audit Logs Endpoint
export const getAuditLogs = async (req: express.Request, res: express.Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const snapshot = await db.collection('audit_logs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        const logs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Convert Timestamp to ISO string if needed, or send as is
            // timestamp: doc.data().timestamp?.toDate().toISOString()
        }));

        return res.status(200).json(logs);
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        return res.status(500).json({ error: 'Failed to fetch logs' });
    }
};
export const getUIAssetsSettings = async (req: express.Request, res: express.Response) => {
    try {
        const doc = await db.collection('settings').doc('ui_assets').get();
        if (!doc.exists) {
            return res.json({
                login_bg: '',
                dashboard_bg: '',
                sidebar_bg: ''
            });
        }
        res.json(doc.data());
    } catch (error) {
        console.error('Error getting UI assets settings:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const updateUIAssetsSettings = async (req: express.Request, res: express.Response) => {
    try {
        const settings = req.body;
        await db.collection('settings').doc('ui_assets').set(settings, { merge: true });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating UI assets settings:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};
