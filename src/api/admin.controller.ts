import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { z } from 'zod';
import { db, auth, storage } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { env, getCanonicalWebUrl } from '../config/env';
import { resolveSuperAdminPassword } from '../config/secrets';
import { generateSetupToken, constantTimeEqualStrings } from '../utils/security';
import { safeFetchExternal } from '../utils/ssrfGuard';
import { formatRut, cleanRut, getRutVariants } from '../utils/rut';
import { isProtectedSystemAccount } from '../services/bootstrap.service';
import { AuthRequest } from '../middleware/admin';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { ResilientAIClient, SWARM_MODELS } from '../core/resilient-ai-client';

const exchangeCustomTokenForIdToken = async (customToken: string): Promise<string> => {
    try {
        const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || 'fake-api-key';
        const url = emulatorHost
            ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`
            : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        });
        if (response.ok) {
            const data: any = await response.json();
            return data.idToken || customToken;
        }
    } catch (e) {
        console.warn('[ADMIN-AUTH] Could not exchange custom token for idToken:', e);
    }
    return customToken;
};

/**
 * Descarga segura de activos remotos exclusivamente mediante `safeFetchExternal` (anti-SSRF, cero `child_process.exec`).
 */
const downloadSafeAssetBuffer = async (rawUrl: string): Promise<Buffer> => {
    const response = await safeFetchExternal(rawUrl, {
        method: 'GET',
        maxBytes: 15 * 1024 * 1024, // Tope 15 MB para iconos/activos de marca
    });
    if (!response.ok) {
        throw new Error(`Descarga remota rechazada (${response.status})`);
    }
    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length < 1) {
        throw new Error('Archivo descargado vacío');
    }
    return buf;
};

/**
 * Redimensiona un icono PWA cuadrado en memoria con `sharp` (reemplazo nativo de `sips`).
 */
const renderSquarePngIcon = async (inputBuffer: Buffer, dimension: 192 | 512): Promise<Buffer> => {
    return sharp(inputBuffer, { density: 300 })
        .resize(dimension, dimension, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
};

/**
 * Redimensiona un icono adaptativo Android con zona segura del 66% centrada mediante `sharp`.
 */
const renderSafeZonePngIcon = async (inputBuffer: Buffer, targetDimension: number): Promise<Buffer> => {
    const safeSize = Math.max(1, Math.floor(targetDimension * 0.66));
    const padTotal = Math.max(0, targetDimension - safeSize);
    const padBefore = Math.floor(padTotal / 2);
    const padAfter = padTotal - padBefore;

    return sharp(inputBuffer, { density: 300 })
        .resize(safeSize, safeSize, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .extend({
            top: padBefore,
            bottom: padAfter,
            left: padBefore,
            right: padAfter,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
};

const recordAdminAudit = async (
    req: express.Request,
    action: string,
    targetEntity: string,
    details: Record<string, any> = {},
    tenantId: string = 'admin-governance'
): Promise<void> => {
    const actor = (req as AuthRequest).user || {};
    await AuditLedger.record({
        tenantId,
        actorUid: String(actor.uid || 'super-admin-uid'),
        actorEmail: String(actor.email || env.SUPER_ADMIN_EMAIL),
        action,
        module: 'b2b-core',
        targetEntity,
        details,
        ipAddress: extractClientIp(req),
    });
};

export const listTenants = async (req: express.Request, res: express.Response) => {
    try {
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
        let query: FirebaseFirestore.Query = db.collection('tenants');

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query.orderBy('createdAt', 'desc').get();
        const tenants = snapshot.docs.map((doc) => ({
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
        const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
        let query: FirebaseFirestore.Query = db.collection('accounts');

        if (type) {
            query = query.where('type', '==', type);
        }

        const snapshot = await query.orderBy('createdAt', 'desc').get();
        const accounts = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.status(200).json(accounts);
    } catch (error) {
        console.error('[ADMIN] Error listing accounts:', error);
        return res.status(500).json({ error: 'Failed to fetch accounts' });
    }
};

const adminLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(256)
});

export const adminLogin = async (req: express.Request, res: express.Response) => {
    const parseResult = adminLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Payload inválido', details: parseResult.error.format() });
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.trim().toLowerCase();
    const expectedEmail = env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
    const expectedPassword = (await resolveSuperAdminPassword())?.trim() || '';

    if (!expectedPassword || !password.trim()) {
        return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    if (
        normalizedEmail === expectedEmail &&
        constantTimeEqualStrings(password, expectedPassword)
    ) {
        let uid = 'super-admin-uid';
        try {
            const user = await auth.getUserByEmail(env.SUPER_ADMIN_EMAIL);
            uid = user.uid;
            await auth.setCustomUserClaims(uid, { role: 'SUPER_ADMIN', admin: true });
        } catch {
            const newUser = await auth.createUser({
                uid: 'super-admin-uid',
                email: env.SUPER_ADMIN_EMAIL,
                password: expectedPassword,
                displayName: 'Super Admin',
                emailVerified: true,
            });
            uid = newUser.uid;
            await auth.setCustomUserClaims(uid, { role: 'SUPER_ADMIN', admin: true });
        }

        const firebaseToken = await auth.createCustomToken(uid, { role: 'SUPER_ADMIN', admin: true });

        await db.collection('users').doc(uid).set({
            uid,
            email: env.SUPER_ADMIN_EMAIL,
            displayName: 'Super Admin',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            updatedAt: new Date().toISOString()
        }, { merge: true });

        const idToken = await exchangeCustomTokenForIdToken(firebaseToken);

        await AuditLedger.record({
            tenantId: 'admin-governance',
            actorUid: uid,
            actorEmail: env.SUPER_ADMIN_EMAIL,
            action: 'SUPER_ADMIN_LOGIN',
            module: 'b2b-core',
            targetEntity: uid,
            details: { method: 'admin_login' },
            ipAddress: extractClientIp(req),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            token: idToken,
            firebaseToken,
            user: { uid, email: env.SUPER_ADMIN_EMAIL, role: 'SUPER_ADMIN' }
        });
    }

    return res.status(401).json({ error: 'Invalid admin credentials' });
};

const tenantUidParamSchema = z.object({
    uid: z.string().min(1).max(128),
});

const updateTenantStatusSchema = z.object({
    status: z.enum(['ACTIVE', 'REJECTED']),
    rejectionReason: z.string().max(1000).optional().nullable(),
    observations: z.string().max(1000).optional().nullable(),
    enabledPlugins: z.array(z.enum(['opermaq', 'stockpile'])).max(10).optional()
});

const approveTenantBodySchema = z.object({
    observations: z.string().max(1000).optional().nullable(),
    enabledPlugins: z.array(z.enum(['opermaq', 'stockpile'])).max(10).optional()
});

const rejectTenantBodySchema = z.object({
    rejectionReason: z.string().min(3).max(1000),
    observations: z.string().max(1000).optional().nullable(),
});

export const approveTenant = async (req: AuthRequest, res: express.Response) => {
    const parsedBody = approveTenantBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Payload de aprobación inválido', details: parsedBody.error.format() });
    }
    req.body = { ...parsedBody.data, status: 'ACTIVE' };
    return updateTenantStatus(req, res);
};

export const rejectTenant = async (req: AuthRequest, res: express.Response) => {
    const parsedBody = rejectTenantBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Payload de rechazo inválido', details: parsedBody.error.format() });
    }
    req.body = { ...parsedBody.data, status: 'REJECTED' };
    return updateTenantStatus(req, res);
};

export const updateTenantStatus = async (req: AuthRequest, res: express.Response) => {
    const parsedParams = tenantUidParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Identificador de tenant inválido' });
    }
    const { uid } = parsedParams.data;

    const parseResult = updateTenantStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Payload inválido', details: parseResult.error.format() });
    }
    const { status, rejectionReason, observations, enabledPlugins } = parseResult.data;
    const adminEmail = req.user?.email || env.SUPER_ADMIN_EMAIL;

    try {
        const tenantRef = db.collection('tenants').doc(uid);
        const tenantDoc = await tenantRef.get();

        if (!tenantDoc.exists) {
            return res.status(404).json({ error: 'Tenant record not found' });
        }

        const tenantData = tenantDoc.data()!;
        const entityName = tenantData.company_name || tenantData.institution_name || tenantData.full_name || 'Entidad MINREPORT';

        if (status === 'ACTIVE') {
            const taxId = 'rut' in tenantData ? tenantData.rut : ('run' in tenantData ? tenantData.run : null);
            if (!taxId) {
                return res.status(400).json({ error: 'Falta RUT/RUN en el registro del tenant.' });
            }

            const cleanTaxId = cleanRut(String(taxId));
            const formattedTaxId = formatRut(cleanTaxId);
            const realEmail = String(tenantData.email || `${cleanTaxId.toLowerCase()}@minreport.com`).toLowerCase().trim();

            let userRecord;
            try {
                userRecord = await auth.getUserByEmail(realEmail);
            } catch (authError: any) {
                if (authError.code === 'auth/user-not-found') {
                    userRecord = await auth.createUser({
                        email: realEmail,
                        emailVerified: true,
                        displayName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                        disabled: false
                    });
                } else {
                    throw authError;
                }
            }

            await auth.setCustomUserClaims(userRecord.uid, {
                role: 'USER',
                tier: tenantData.type,
                tenantId: uid,
                activeAccountId: uid,
            });

            const accountId = uid;
            const baseUrl = getCanonicalWebUrl();
            const { rawToken, hashedToken, expiresAt } = generateSetupToken();
            const resolvedPlugins = enabledPlugins && enabledPlugins.length > 0 ? enabledPlugins : ['opermaq', 'stockpile'];

            await tenantRef.update({
                status: 'APPROVED',
                authUid: userRecord.uid,
                processedAt: new Date().toISOString(),
                processedBy: adminEmail,
                observations: observations || null,
                enabledPlugins: resolvedPlugins,
                updatedAt: new Date().toISOString()
            });

            await db.collection('accounts').doc(accountId).set({
                id: accountId,
                name: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                type: tenantData.type,
                status: 'ACTIVE',
                taxId: formattedTaxId,
                ownerId: userRecord.uid,
                enabledPlugins: resolvedPlugins,
                contract: {
                    plan: tenantData.type === 'EDUCATIONAL' ? 'ACADEMIC_SANDBOX' : 'ENTERPRISE_B2B_CORE',
                    status: 'ACTIVE',
                    activeModules: {
                        opermaq: resolvedPlugins.includes('opermaq'),
                        stockpile: resolvedPlugins.includes('stockpile'),
                    },
                    activatedAt: Date.now(),
                },
                licensing: tenantData.type === 'EDUCATIONAL'
                    ? { maxUsers: 1, allowInternalUsers: false, isCommercial: false, watermarkRequired: true }
                    : { maxUsers: 100, allowInternalUsers: true, isCommercial: true, watermarkRequired: false },
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

            const userRole = tenantData.type === 'ENTERPRISE' ? 'BILLING_ONLY' : 'OWNER';
            const memberships = [{
                accountId,
                role: userRole,
                companyName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                status: 'APPROVED',
                joinedAt: Date.now()
            }];

            const existingUserDoc = await db.collection('users').doc(userRecord.uid).get();
            if (existingUserDoc.exists) {
                const userData = existingUserDoc.data();
                const existingMems = Array.isArray(userData?.memberships) ? userData!.memberships : [];
                const cleanedMems = existingMems
                    .filter((m: any) => m.accountId !== accountId)
                    .map(({ passwordHash: _legacy, ...rest }: any) => rest);
                cleanedMems.push(...memberships);

                await db.collection('users').doc(userRecord.uid).update({
                    memberships: cleanedMems,
                    updatedAt: new Date().toISOString()
                });
            } else {
                await db.collection('users').doc(userRecord.uid).set({
                    uid: userRecord.uid,
                    email: realEmail,
                    taxId: formattedTaxId,
                    displayName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                    role: 'USER',
                    memberships,
                    lastActiveAccountId: accountId,
                    status: 'APPROVED',
                    entitlements: {
                        pluginsEnabled: resolvedPlugins,
                        storageLimit: 1073741824
                    },
                    stats: {
                        storageUsed: 0,
                        lastLogin: null
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }

            // Sincronizar user_directory con `uid` explícito para evitar fractura de ID
            const accountRefEntry = {
                accountId,
                uid: userRecord.uid,
                authEmail: realEmail,
                role: userRole,
                type: tenantData.type,
                accountName: entityName,
                status: 'APPROVED'
            };

            const dirKeys = Array.from(new Set([String(taxId), cleanTaxId, formattedTaxId]));
            for (const dirKey of dirKeys) {
                const userDirRef = db.collection('user_directory').doc(dirKey);
                const userDirSnap = await userDirRef.get();

                if (userDirSnap.exists) {
                    const dirData = userDirSnap.data();
                    let accounts = Array.isArray(dirData?.accounts) ? dirData!.accounts : [];

                    if (tenantData.type === 'PERSONAL') {
                        accounts = accounts.filter((a: any) => a.type !== 'PERSONAL');
                    } else if (tenantData.type === 'EDUCATIONAL') {
                        const prevEdu = accounts.find((a: any) => a.type === 'EDUCATIONAL');
                        if (prevEdu && prevEdu.accountId !== accountId) {
                            await db.collection('tenants').doc(prevEdu.accountId).update({
                                status: 'REPLACED_BY_NEW_ENROLLMENT',
                                updatedAt: new Date().toISOString()
                            }).catch(() => {});
                            await db.collection('accounts').doc(prevEdu.accountId).update({
                                status: 'REPLACED_BY_NEW_ENROLLMENT',
                                updatedAt: new Date().toISOString()
                            }).catch(() => {});
                        }
                        accounts = accounts.filter((a: any) => a.type !== 'EDUCATIONAL');
                    } else {
                        accounts = accounts.filter((a: any) => a.accountId !== accountId);
                    }

                    accounts.push(accountRefEntry);

                    await userDirRef.update({
                        uid: userRecord.uid,
                        accounts,
                        fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (dirData?.fullName || entityName),
                        updatedAt: new Date().toISOString()
                    });
                } else {
                    await userDirRef.set({
                        uid: userRecord.uid,
                        run: formattedTaxId,
                        fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : entityName,
                        accounts: [accountRefEntry],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            }

            await db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid).set({
                userId: userRecord.uid,
                email: realEmail,
                fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : entityName,
                run: formattedTaxId,
                role: userRole,
                status: 'ACTIVE',
                joinedAt: Date.now()
            });

            await db.collection('setup_tokens').doc(rawToken).set({
                accountId,
                uid: userRecord.uid,
                taxId: cleanTaxId,
                hashedToken,
                expiresAt,
                used: false,
                createdAt: Date.now()
            });

            const actionLink = `${baseUrl}/setup-access?accountId=${encodeURIComponent(uid)}&taxId=${encodeURIComponent(cleanTaxId)}&name=${encodeURIComponent(entityName)}&type=${encodeURIComponent(tenantData.type)}&token=${encodeURIComponent(rawToken)}`;

            await EmailService.sendEmail({
                from: 'MINREPORT System <support@minreport.com>',
                to: realEmail,
                subject: 'Solicitud de Registro Aprobada',
                html: `
                    <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                        <div style="background: #F8FAFC; border-left: 4px solid #C68346; padding: 21px; margin-bottom: 21px;">
                            <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 13px;">Solicitud Aprobada</h2>
                            <p style="margin: 0; font-size: 15px; line-height: 1.5;">
                                Solicitud de registro validada para operar en MINREPORT.
                            </p>
                            <div style="margin-top: 21px; background: #FFFFFF; border: 1px solid #E2E8F0; padding: 13px;">
                                <p style="margin: 0 0 8px 0; font-size: 11px; color: #475569; text-transform: uppercase; font-weight: 700;">Entidad Registrada</p>
                                <p style="margin: 0 0 13px 0; font-size: 15px; color: #0F172A; font-weight: 700;">${entityName}</p>
                                <p style="margin: 0 0 8px 0; font-size: 11px; color: #475569; text-transform: uppercase; font-weight: 700;">Correo Asociado</p>
                                <p style="margin: 0; font-size: 14px; color: #0F172A;">${realEmail}</p>
                            </div>
                        </div>
                        <div style="text-align: center; margin: 34px 0;">
                            <a href="${actionLink}" style="background: #0F172A; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">Configurar Acceso Seguro</a>
                        </div>
                    </div>
                `
            });

            await recordAdminAudit(
                req,
                'APPROVE_TENANT',
                uid,
                { type: tenantData.type, ownerUid: userRecord.uid, enabledPlugins: resolvedPlugins },
                accountId
            );
        } else if (status === 'REJECTED') {
            const effectiveReason = rejectionReason || 'Documentación no validada según políticas vigentes.';
            await tenantRef.update({
                status: 'REJECTED',
                rejectionReason: effectiveReason,
                processedAt: new Date().toISOString(),
                processedBy: adminEmail,
                observations: observations || null,
                updatedAt: new Date().toISOString()
            });

            if (tenantData.email) {
                await EmailService.sendEmail({
                    from: 'MINREPORT <ops@minreport.com>',
                    to: tenantData.email,
                    subject: 'Estado de Solicitud MINREPORT',
                    html: `
                        <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                            <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 21px; margin-bottom: 21px;">
                                <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 13px;">Estado de Solicitud</h2>
                                <p style="margin: 0; font-size: 15px; line-height: 1.5;">La solicitud de acceso no ha sido aprobada.</p>
                                <p style="margin: 13px 0 0 0; font-size: 14px; line-height: 1.5;"><strong>Motivo:</strong> ${effectiveReason}</p>
                            </div>
                        </div>
                    `
                });
            }

            await recordAdminAudit(
                req,
                'REJECT_TENANT',
                uid,
                { rejectionReason: effectiveReason },
                uid
            );
        }

        return res.status(200).json({ success: true, status });
    } catch (error) {
        console.error('[ADMIN] Error updating tenant:', error);
        return res.status(500).json({ error: 'Failed to update tenant status and create account' });
    }
};

async function cleanupAccountMembers(accountId: string, isPurge: boolean = false) {
    try {
        const membersSnap = await db.collection('accounts').doc(accountId).collection('members').get();
        if (membersSnap.empty) {
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
            const userId = memberDoc.id;
            const memberData = memberDoc.data();
            const taxId = memberData.run || memberData.rut || memberData.taxId;

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

async function processUserCleanup(userId: string, taxId: string, accountId: string, memberships: any[], _isPurge: boolean) {
    if (isProtectedSystemAccount(userId) || isProtectedSystemAccount(taxId)) {
        console.warn(`[CLEANUP-GUARD] Identidad protegida detectada (${userId} / ${taxId}). Operación abortada.`);
        return;
    }

    const filteredMemberships = memberships.filter((m: any) => m.accountId !== accountId);

    if (filteredMemberships.length === 0) {
        await db.collection('users').doc(userId).delete();
        await db.collection('user_auth_credentials').doc(userId).delete().catch(() => {});

        if (taxId) {
            for (const variant of getRutVariants(String(taxId))) {
                await db.collection('user_directory').doc(variant).delete().catch(() => {});
            }
        }

        try {
            await auth.deleteUser(userId);
        } catch (authErr: any) {
            console.warn(`[CLEANUP] Failed to delete Firebase Auth user ${userId}:`, authErr.message);
        }
    } else {
        await db.collection('users').doc(userId).update({ memberships: filteredMemberships });

        if (taxId) {
            for (const variant of getRutVariants(String(taxId))) {
                try {
                    const dirRef = db.collection('user_directory').doc(variant);
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
                } catch { }
            }
        }
    }
}

export const deleteTenant = async (req: express.Request, res: express.Response) => {
    try {
        const parsedParams = tenantUidParamSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return res.status(400).json({ error: 'Identificador de tenant inválido' });
        }
        const { uid } = parsedParams.data;
        const actor = (req as AuthRequest).user?.email || env.SUPER_ADMIN_EMAIL;

        if (isProtectedSystemAccount(uid)) {
            return res.status(403).json({ error: 'Operación denegada: No se pueden eliminar cuentas raíz de desarrollo o del sistema.' });
        }

        await db.collection('tenants').doc(uid).update({
            status: 'DELETED',
            deletedAt: new Date().toISOString(),
            deletedBy: actor
        });

        const accountRef = db.collection('accounts').doc(uid);
        const accountDoc = await accountRef.get();
        if (accountDoc.exists) {
            await accountRef.update({
                status: 'DELETED',
                deletedAt: new Date().toISOString()
            });
        }

        await cleanupAccountMembers(uid, false);
        await recordAdminAudit(req, 'SOFT_DELETE_TENANT', uid, { retentionDays: 30 }, uid);

        return res.status(200).json({
            success: true,
            message: 'Account moved to trash (Soft Delete). Data retained for 30 days.'
        });
    } catch (error) {
        console.error('[ADMIN] Error soft-deleting tenant:', error);
        return res.status(500).json({ error: 'Failed to delete tenant' });
    }
};

const purgeTenantBodySchema = z.object({
    reason: z.string().max(500).optional(),
    confirmationWord: z.string().max(32).optional(),
}).optional();

export const purgeTenant = async (req: express.Request, res: express.Response) => {
    try {
        const parsedParams = tenantUidParamSchema.safeParse(req.params);
        const parsedBody = purgeTenantBodySchema.safeParse(req.body);
        if (!parsedParams.success || !parsedBody.success) {
            return res.status(400).json({ error: 'Parámetros de purga inválidos' });
        }
        const { uid } = parsedParams.data;

        if (isProtectedSystemAccount(uid)) {
            return res.status(403).json({ error: 'Operación denegada: No se pueden purgar cuentas raíz de desarrollo o del sistema.' });
        }

        await cleanupAccountMembers(uid, true);

        await db.collection('tenants').doc(uid).delete();
        await db.collection('accounts').doc(uid).delete();

        await recordAdminAudit(
            req,
            'PURGE_TENANT',
            uid,
            { outcome: 'PERMANENT_PURGE', reason: parsedBody.data?.reason || null },
            uid
        );

        return res.status(200).json({
            success: true,
            message: 'Tenant permanently purged.'
        });
    } catch (error) {
        console.error('[ADMIN] Purge error:', error);
        return res.status(500).json({ error: 'Failed to purge tenant' });
    }
};

export const getBrandingSettings = async (_req: express.Request, res: express.Response) => {
    try {
        const doc = await db.collection('settings').doc('branding').get();
        if (!doc.exists) {
            return res.json({ siteName: 'MINREPORT', primaryColor: '#C68346' });
        }
        return res.json(doc.data());
    } catch (error) {
        console.error('Error getting branding settings:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

const brandingThemeAssetsSchema = z.object({
    isotype: z.string().max(2048).optional(),
    logotype: z.string().max(2048).optional(),
    imagotype: z.string().max(2048).optional(),
    imagotypeVertical: z.string().max(2048).optional(),
    pwaIcon: z.string().max(2048).optional(),
    appIcon: z.string().max(2048).optional(),
}).passthrough();

const updateBrandingSettingsSchema = z.object({
    siteName: z.string().min(1).max(120).optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    light: brandingThemeAssetsSchema.optional(),
    dark: brandingThemeAssetsSchema.optional(),
}).passthrough();

export const updateBrandingSettings = async (req: express.Request, res: express.Response) => {
    try {
        const parsed = updateBrandingSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Configuración de marca inválida', details: parsed.error.format() });
        }

        const settings = parsed.data;
        const generatedAssets: Record<string, string> = {};

        // Procesamiento seguro en memoria con `safeFetchExternal` + `sharp` (Cero RCE, cero `curl`, cero `sips`)
        const pwaIconUrl = settings.light?.pwaIcon || settings.dark?.pwaIcon || settings.light?.isotype;
        if (pwaIconUrl && (pwaIconUrl.startsWith('https://') || pwaIconUrl.startsWith('http://'))) {
            try {
                const rawIconBuf = await downloadSafeAssetBuffer(pwaIconUrl);
                const [png192, png512] = await Promise.all([
                    renderSquarePngIcon(rawIconBuf, 192),
                    renderSquarePngIcon(rawIconBuf, 512),
                ]);

                const bucket = storage.bucket();
                const file192 = bucket.file('branding/pwa-192x192.png');
                const file512 = bucket.file('branding/pwa-512x512.png');

                await Promise.all([
                    file192.save(png192, { contentType: 'image/png', resumable: false }),
                    file512.save(png512, { contentType: 'image/png', resumable: false }),
                ]);

                generatedAssets.pwaIcon192Path = 'branding/pwa-192x192.png';
                generatedAssets.pwaIcon512Path = 'branding/pwa-512x512.png';

                // Si se habilita explícitamente sincronización de iconos Android en entorno local controlado
                if (process.env.ENABLE_LOCAL_ANDROID_MIPMAP_SYNC === 'true') {
                    const tmpOutDir = path.join(os.tmpdir(), 'minreport-android-icons');
                    fs.mkdirSync(tmpOutDir, { recursive: true });
                    const mipmapSizes = [48, 72, 96, 144, 192];
                    await Promise.all(
                        mipmapSizes.map(async (sz) => {
                            const safePng = await renderSafeZonePngIcon(rawIconBuf, sz);
                            fs.writeFileSync(path.join(tmpOutDir, `ic_launcher_${sz}.png`), safePng);
                        })
                    );
                }
            } catch (iconErr: any) {
                console.warn('[BRANDING] No se pudo procesar icono PWA remoto con sharp:', iconErr?.message || iconErr);
            }
        }

        const payloadToSave = {
            ...settings,
            ...(Object.keys(generatedAssets).length > 0 ? { generatedAssets } : {}),
            updatedAt: new Date().toISOString(),
        };

        await db.collection('settings').doc('branding').set(payloadToSave, { merge: true });

        await recordAdminAudit(req, 'UPDATE_BRANDING_SETTINGS', 'settings/branding', {
            updatedKeys: Object.keys(settings),
            generatedPwaIcons: Object.keys(generatedAssets).length > 0,
        });

        return res.json({ success: true, generatedAssets });
    } catch (error) {
        console.error('Error updating branding settings:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Métricas reales verificables de Firestore (sin `activeSessions` inventadas ni estimaciones falsas).
 */
export const getSystemMetrics = async (_req: express.Request, res: express.Response) => {
    try {
        const [tenantsSnap, accountsSnap, usersSnap, ledgerSnap, passkeysSnap] = await Promise.all([
            db.collection('tenants').count().get(),
            db.collection('accounts').count().get(),
            db.collection('users').count().get(),
            db.collection('audit_ledger').count().get(),
            db.collection('webauthn_credentials').count().get(),
        ]);

        return res.status(200).json({
            tenants: tenantsSnap.data().count,
            accounts: accountsSnap.data().count,
            users: usersSnap.data().count,
            auditLedgerEntries: ledgerSnap.data().count,
            registeredPasskeys: passkeysSnap.data().count,
            region: env.GCP_LOCATION || 'southamerica-west1',
            measuredAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error fetching metrics:', error);
        return res.status(500).json({ error: 'Failed to fetch metrics' });
    }
};

/**
 * Consulta el ledger inmutable `audit_ledger` (en lugar de `audit_logs` legacy).
 */
export const getAuditLogs = async (req: express.Request, res: express.Response) => {
    try {
        const rawLimit = parseInt(String(req.query.limit || '50'), 10);
        const safeLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 250) : 50;

        let snapshot = await db
            .collection('audit_ledger')
            .orderBy('timestamp', 'desc')
            .limit(safeLimit)
            .get();

        if (snapshot.empty) {
            snapshot = await db.collection('audit_ledger').limit(safeLimit).get();
        }

        const logs = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.status(200).json(logs);
    } catch (error) {
        console.error('Error fetching audit ledger:', error);
        return res.status(500).json({ error: 'Failed to fetch audit ledger' });
    }
};

/**
 * GET /api/admin/audit-ledger/verify
 * Verifica criptográficamente el encadenamiento SHA-256 de `audit_ledger`.
 */
export const verifyAuditLedgerChain = async (req: express.Request, res: express.Response) => {
    try {
        const rawLimit = parseInt(String(req.query.limit || '100'), 10);
        const safeLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 1000) : 100;
        const report = await AuditLedger.verifyChain(safeLimit);
        return res.status(report.valid ? 200 : 409).json(report);
    } catch (error) {
        console.error('[ADMIN] Error verifying audit ledger chain:', error);
        return res.status(500).json({ error: 'Failed to verify audit ledger chain' });
    }
};

export const getUIAssetsSettings = async (_req: express.Request, res: express.Response) => {
    try {
        const doc = await db.collection('settings').doc('ui_assets').get();
        if (!doc.exists) {
            return res.json({
                login_bg: '',
                dashboard_bg: '',
                sidebar_bg: ''
            });
        }
        return res.json(doc.data());
    } catch (error) {
        console.error('Error getting UI assets settings:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

const updateUIAssetsSettingsSchema = z.object({
    login_bg: z.string().max(2048).optional(),
    dashboard_bg: z.string().max(2048).optional(),
    sidebar_bg: z.string().max(2048).optional(),
}).strict();

export const updateUIAssetsSettings = async (req: express.Request, res: express.Response) => {
    try {
        const parsed = updateUIAssetsSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Configuración de activos UI inválida', details: parsed.error.format() });
        }

        const settings = {
            ...parsed.data,
            updatedAt: new Date().toISOString(),
        };

        await db.collection('settings').doc('ui_assets').set(settings, { merge: true });
        await recordAdminAudit(req, 'UPDATE_UI_ASSETS_SETTINGS', 'settings/ui_assets', {
            updatedKeys: Object.keys(parsed.data),
        });

        return res.json({ success: true });
    } catch (error) {
        console.error('Error updating UI assets settings:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

const updateModuleAvailabilitySchema = z.object({
    moduleId: z.enum(['opermaq', 'stockpile']),
    enabled: z.boolean(),
    confirmationWord: z.literal('ACTUALIZAR'),
});

export const updateModuleAvailability = async (req: express.Request, res: express.Response) => {
    try {
        const parsed = updateModuleAvailabilitySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload inválido: se requiere moduleId ("opermaq" | "stockpile"), enabled booleano y confirmationWord === "ACTUALIZAR".',
                details: parsed.error.format(),
            });
        }

        const { moduleId, enabled } = parsed.data;
        const nowIso = new Date().toISOString();
        const actorEmail = (req as AuthRequest).user?.email || env.SUPER_ADMIN_EMAIL;

        await Promise.all([
            db.collection('modules_status').doc(moduleId).set(
                {
                    id: moduleId,
                    enabled,
                    updatedAt: nowIso,
                    updatedBy: actorEmail,
                },
                { merge: true }
            ),
            db.collection('settings').doc('modules_status').set(
                {
                    [moduleId]: enabled,
                    updatedAt: nowIso,
                    updatedBy: actorEmail,
                },
                { merge: true }
            ),
        ]);

        await recordAdminAudit(req, 'MODULE_AVAILABILITY_UPDATED', `modules_status/${moduleId}`, {
            moduleId,
            enabled,
            hitlConfirmed: true,
        });

        return res.status(200).json({
            success: true,
            moduleId,
            enabled,
            updatedAt: nowIso,
        });
    } catch (error) {
        console.error('[ADMIN] Error updating module availability:', error);
        return res.status(500).json({ error: 'Failed to update module availability' });
    }
};

export const getAccountUsers = async (req: express.Request, res: express.Response) => {
    try {
        const accountId = z.string().min(1).max(128).safeParse(req.params.accountId);
        if (!accountId.success) {
            return res.status(400).json({ error: 'accountId is required' });
        }

        const snapshot = await db.collection('users').get();
        const accountUsers = snapshot.docs
            .map((d) => {
                const raw = d.data();
                const sanitizedMemberships = Array.isArray(raw.memberships)
                    ? raw.memberships.map(({ passwordHash: _ph, ...rest }: any) => rest)
                    : [];
                return { uid: d.id, ...raw, memberships: sanitizedMemberships };
            })
            .filter((u: any) => u.memberships?.some((m: any) => m.accountId === accountId.data));

        return res.status(200).json(accountUsers);
    } catch (error) {
        console.error('[ADMIN] Error fetching account users:', error);
        return res.status(500).json({ error: 'Failed to fetch account users' });
    }
};

/**
 * Telemetría verificable en tiempo real desde `ResilientAIClient`, `ai_telemetry` y `audit_ledger`
 * (sin modelos inexistentes, sin latencias inventadas y sin wallets `.eth` ficticias).
 */
export const getAITelemetry = async (_req: express.Request, res: express.Response) => {
    try {
        const [swarmSnapshot, aiLogsSnap, m2mLogsSnap, receiptsCountSnap] = await Promise.all([
            ResilientAIClient.getTelemetrySnapshot(),
            db.collection('audit_ledger')
                .where('action', '==', 'AI_INFERENCE_REQUEST')
                .limit(50)
                .get()
                .catch(() => null),
            db.collection('audit_ledger')
                .where('module', '==', 'web3-m2m')
                .limit(50)
                .get()
                .catch(() => null),
            db.collection('x402_receipts')
                .count()
                .get()
                .catch(() => null),
        ]);

        const aiLogs = aiLogsSnap ? aiLogsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) : [];
        const m2mLogs = m2mLogsSnap ? m2mLogsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) : [];
        const settledM2mReceipts = receiptsCountSnap ? receiptsCountSnap.data().count : 0;

        const formatTierTelemetry = (tierKey: 'PRIMARY' | 'SECONDARY' | 'ANCHOR_HA', roleLabel: string) => {
            const tierData = swarmSnapshot.tiers[tierKey];
            return {
                model: tierData?.model || SWARM_MODELS[tierKey],
                status: tierData && tierData.calls > 0 ? 'VERIFIED' : 'STANDBY',
                calls: tierData?.calls ?? 0,
                errors: tierData?.errors ?? 0,
                avgLatencyMs: tierData?.avgLatencyMs ?? null,
                lastLatencyMs: tierData?.lastLatencyMs ?? null,
                lastUsedAt: tierData?.lastUsedAt ?? null,
                tier: roleLabel,
            };
        };

        return res.status(200).json({
            swarmStatus: {
                pro: formatTierTelemetry('PRIMARY', 'Pro (Razonamiento Crítico)'),
                flash: formatTierTelemetry('SECONDARY', 'Flash (Operación Estándar)'),
                flashLite: formatTierTelemetry('ANCHOR_HA', 'Flash-Lite (Alta Disponibilidad)'),
            },
            telemetrySummary: {
                totalCalls: swarmSnapshot.totalCalls,
                cacheHits: swarmSnapshot.cacheHits,
                totalErrors: swarmSnapshot.totalErrors,
                gatewayConfigured: swarmSnapshot.gatewayConfigured,
                updatedAt: swarmSnapshot.updatedAt,
            },
            protocolX402: {
                contractVersion: 'x402 Foundation v1.0',
                settledReceiptsCount: settledM2mReceipts,
                cluster: swarmSnapshot.region || 'southamerica-west1',
            },
            clusterRegion: swarmSnapshot.region || 'southamerica-west1',
            recentInferences: aiLogs,
            recentM2MTransactions: m2mLogs,
        });
    } catch (error) {
        console.error('[ADMIN] Error fetching AI telemetry:', error);
        return res.status(500).json({ error: 'Failed to fetch AI telemetry' });
    }
};
