import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { z } from 'zod';
import admin, { db, auth, storage } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
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
import { computeShortTtlTimestamp, computeThirtyDayTtlTimestamp } from '../core/retention-policy';
import { ResilientAIClient, SWARM_MODELS } from '../core/resilient-ai-client';
import { TenantMetricsService, formatMetricsPeriod } from '../services/tenant-metrics.service';
import {
    UpdateAccountEntitlementsPayloadSchema,
    resolveEffectiveModuleAccess,
} from '../contracts/session.contracts';
import { CasStorageService, type CasBlobStreamHandle } from '../core/media/CasStorageService';

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
        const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
        let query: FirebaseFirestore.Query = db.collection('tenants');

        if (status) {
            if (status === 'PENDING') {
                query = query.where('status', 'in', ['PENDING', 'PENDING_APPROVAL']);
            } else {
                query = query.where('status', '==', status);
            }
        }

        const snapshot = await query.orderBy('createdAt', 'desc').get();
        const accountRefs = snapshot.docs.map((doc) => db.collection('accounts').doc(doc.id));
        const accountMap = new Map<string, Record<string, any>>();

        for (let i = 0; i < accountRefs.length; i += 100) {
            const chunk = accountRefs.slice(i, i + 100);
            const snaps =
                typeof (db as any).getAll === 'function'
                    ? await (db as any).getAll(...chunk)
                    : await Promise.all(chunk.map((ref) => ref.get()));
            for (const snap of snaps) {
                if (snap && snap.exists) {
                    accountMap.set(snap.id, snap.data() || {});
                }
            }
        }

        const tenants = snapshot.docs.map((doc) => {
            const d = doc.data() || {};
            const acc = accountMap.get(doc.id) || {};
            const resolvedIsEdu = Boolean(
                d.isEduSandbox ||
                    acc.isEduSandbox ||
                    d.type === 'EDUCATIONAL' ||
                    acc.type === 'EDUCATIONAL' ||
                    d.classification === 'edu' ||
                    acc.classification === 'edu'
            );
            const accountType: 'EDU' | 'B2B' = resolvedIsEdu ? 'EDU' : 'B2B';
            const companyName =
                String(
                    acc.name ||
                        d.company_name ||
                        d.institution_name ||
                        d.name ||
                        d.full_name ||
                        ''
                ).trim() || 'Entidad sin denominación';
            const normalizedStatus = String(d.status || acc.status || 'PENDING_APPROVAL').toUpperCase();

            return {
                id: doc.id,
                ...d,
                countryCode: String(acc.countryCode || acc.country || d.countryCode || d.country || 'CL').toUpperCase(),
                taxId: acc.taxIdFormatted || acc.taxId || d.rut || d.run || d.taxId || null,
                companyName,
                accountType,
                isEduSandbox: resolvedIsEdu,
                academicRole: acc.academicRole || d.academicRole || acc.mandatario?.jobTitle || null,
                ownerEmail: String(acc.mandatario?.email || d.email || acc.billingEmail || '').trim() || null,
                entitlements: acc.entitlements || d.entitlements || null,
                corporateLogo: acc.corporateLogo || acc.logo || d.corporateLogo || null,
                eduInstitutionId: acc.eduInstitutionId || d.eduInstitutionId || null,
                eduInstitutionName: acc.eduInstitutionName || d.eduInstitutionName || null,
                eduInstitutionLogo: acc.eduInstitutionLogo || d.eduInstitutionLogo || null,
                status: normalizedStatus,
            };
        });

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

function extractHitlConfirmationKeyword(req: express.Request): string {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawHeader = req.headers?.['x-hitl-confirmation'];
    const headerVal = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const raw = body.confirmationKeyword ?? body.confirmationWord ?? headerVal ?? '';
    return String(raw).trim().toUpperCase();
}

const updateTenantStatusSchema = z.object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REJECTED']),
    rejectionReason: z.string().max(1000).optional().nullable(),
    observations: z.string().max(1000).optional().nullable(),
    enabledPlugins: z.array(z.enum(['opermaq', 'stockpile', 'supply'])).max(10).optional(),
    confirmationWord: z.string().optional(),
    confirmationKeyword: z.string().optional(),
});

const approveTenantBodySchema = z.object({
    observations: z.string().max(1000).optional().nullable(),
    enabledPlugins: z.array(z.enum(['opermaq', 'stockpile', 'supply'])).max(10).optional(),
    confirmationWord: z.string().optional(),
    confirmationKeyword: z.string().optional(),
});

const rejectTenantBodySchema = z.object({
    rejectionReason: z.string().min(3).max(1000),
    observations: z.string().max(1000).optional().nullable(),
    confirmationWord: z.string().optional(),
    confirmationKeyword: z.string().optional(),
});

export const approveTenant = async (req: AuthRequest, res: express.Response) => {
    const parsedBody = approveTenantBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Payload de aprobación inválido', details: parsedBody.error.format() });
    }
    const confirmationKeyword = extractHitlConfirmationKeyword(req);
    req.body = { ...parsedBody.data, status: 'ACTIVE', confirmationKeyword };
    return updateTenantStatus(req, res);
};

export const rejectTenant = async (req: AuthRequest, res: express.Response) => {
    const parsedBody = rejectTenantBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Payload de rechazo inválido', details: parsedBody.error.format() });
    }
    const confirmationKeyword = extractHitlConfirmationKeyword(req);
    req.body = { ...parsedBody.data, status: 'REJECTED', confirmationKeyword };
    return updateTenantStatus(req, res);
};

/**
 * Sincroniza el estado de todos los miembros de una cuenta y sus perfiles en `/users/{uid}`
 * al suspender o rechazar un tenant.
 */
async function syncTenantMembersOnDeactivation(params: {
    accountRef: FirebaseFirestore.DocumentReference;
    accountId: string;
    targetStatus: 'SUSPENDED' | 'REJECTED';
    ownerUidCandidate: string;
    nowMs: number;
    nowIso: string;
    ttlExpiresAt?: FirebaseFirestore.Timestamp;
    disableAuthWhenNoActive: boolean;
}): Promise<void> {
    const {
        accountRef,
        accountId,
        targetStatus,
        ownerUidCandidate,
        nowMs,
        nowIso,
        ttlExpiresAt,
        disableAuthWhenNoActive,
    } = params;

    const membersCol = accountRef.collection('members');
    const memberPatch: Record<string, any> = {
        status: targetStatus,
        updatedAt: nowMs,
        ...(ttlExpiresAt ? { ttlExpiresAt } : {}),
    };

    const memberUids = new Set<string>();
    const membersSnap =
        typeof (membersCol as any).get === 'function'
            ? await membersCol.get().catch(() => null)
            : null;

    if (membersSnap && !membersSnap.empty) {
        for (const memberDoc of membersSnap.docs) {
            const mData = memberDoc.data() || {};
            const docId = String(memberDoc.id || '').trim();
            const memberUid = String(mData.userId || mData.uid || docId).trim();
            const memberDocRef = memberDoc.ref || (docId ? membersCol.doc(docId) : null);
            if (memberDocRef) {
                await memberDocRef.update(memberPatch).catch(() => {});
            }
            if (docId) memberUids.add(docId);
            if (memberUid) memberUids.add(memberUid);
        }
    }

    if (ownerUidCandidate && !memberUids.has(ownerUidCandidate)) {
        await membersCol.doc(ownerUidCandidate).update(memberPatch).catch(() => {});
        memberUids.add(ownerUidCandidate);
    }

    for (const memberUid of memberUids) {
        const uRef = db.collection('users').doc(memberUid);
        const uSnap = await uRef.get().catch(() => null);
        let shouldDisableAuth = disableAuthWhenNoActive;

        if (uSnap && uSnap.exists) {
            const uData = uSnap.data() || {};
            const mems = Array.isArray(uData.memberships) ? uData.memberships : [];
            const updatedMems = mems.map((m: any) =>
                m?.accountId === accountId ? { ...m, status: targetStatus } : m
            );
            const hasOtherActive = updatedMems.some(
                (m: any) => m?.accountId !== accountId && String(m?.status || '').toUpperCase() === 'ACTIVE'
            );
            shouldDisableAuth = disableAuthWhenNoActive && !hasOtherActive;

            const userTargetRef = uSnap.ref || uRef;
            await userTargetRef
                .update({
                    memberships: updatedMems,
                    ...(hasOtherActive
                        ? {}
                        : {
                              status: targetStatus,
                              ...(ttlExpiresAt ? { ttlExpiresAt } : {}),
                          }),
                    updatedAt: nowIso,
                })
                .catch(() => {});
        }

        if (
            shouldDisableAuth &&
            !isProtectedSystemAccount(memberUid) &&
            typeof (auth as any).updateUser === 'function'
        ) {
            await auth.updateUser(memberUid, { disabled: true }).catch(() => {});
        }
    }
}

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
    const hitlConfirmation = extractHitlConfirmationKeyword(req);
    if (hitlConfirmation !== 'ACTUALIZAR') {
        return res.status(400).json({
            error: 'Confirmación HITL obligatoria: debe confirmar escribiendo "ACTUALIZAR".',
        });
    }

    const { status, rejectionReason, observations, enabledPlugins } = parseResult.data;
    const adminEmail = req.user?.email || env.SUPER_ADMIN_EMAIL;

    try {
        const tenantRef = db.collection('tenants').doc(uid);
        const accountRef = db.collection('accounts').doc(uid);
        const [tenantDoc, accountDoc] = await Promise.all([tenantRef.get(), accountRef.get()]);

        if (!tenantDoc.exists && !accountDoc.exists) {
            return res.status(404).json({ error: 'Tenant record not found' });
        }

        const tenantData = tenantDoc.exists ? (tenantDoc.data() || {}) : (accountDoc.data() || {});
        const accountData = accountDoc.exists ? (accountDoc.data() || {}) : {};
        const isEdu = Boolean(
            tenantData.isEduSandbox ||
                accountData.isEduSandbox ||
                tenantData.type === 'EDUCATIONAL' ||
                accountData.type === 'EDUCATIONAL' ||
                tenantData.classification === 'edu' ||
                accountData.classification === 'edu'
        );
        const countryCode = String(
            accountData.countryCode || tenantData.countryCode || accountData.country || tenantData.country || 'CL'
        )
            .trim()
            .toUpperCase();
        const entityName = String(
            accountData.name ||
                tenantData.company_name ||
                tenantData.institution_name ||
                tenantData.name ||
                tenantData.full_name ||
                'Entidad MINREPORT'
        ).trim();
        const ownerUidCandidate = String(accountData.ownerId || tenantData.authUid || tenantData.ownerId || '').trim();
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();

        if (status === 'ACTIVE') {
            const rawTaxId = accountData.taxId || tenantData.rut || tenantData.run || tenantData.taxId || '';
            const rawTaxIdStr = String(rawTaxId || '').trim();
            const cleanTaxId = rawTaxIdStr ? (countryCode === 'CL' ? cleanRut(rawTaxIdStr) : rawTaxIdStr) : '';
            const formattedTaxId = rawTaxIdStr
                ? accountData.taxIdFormatted || (countryCode === 'CL' ? formatRut(cleanTaxId) : rawTaxIdStr)
                : '';

            const realEmail = String(
                accountData.mandatario?.email ||
                    tenantData.email ||
                    accountData.billingEmail ||
                    (cleanTaxId ? `${cleanTaxId.toLowerCase()}@minreport.com` : '')
            )
                .toLowerCase()
                .trim();

            if (!realEmail && !ownerUidCandidate) {
                return res.status(400).json({ error: 'Falta correo o identificador titular en el registro del tenant.' });
            }

            let userRecord: any = null;
            if (ownerUidCandidate) {
                try {
                    userRecord = await auth.getUser(ownerUidCandidate);
                } catch (authError: any) {
                    if (authError?.code !== 'auth/user-not-found') {
                        throw authError;
                    }
                }
            }
            if (!userRecord && realEmail) {
                try {
                    userRecord = await auth.getUserByEmail(realEmail);
                } catch (authError: any) {
                    if (authError?.code === 'auth/user-not-found') {
                        userRecord = await auth.createUser({
                            email: realEmail,
                            emailVerified: true,
                            displayName: entityName,
                            disabled: false,
                        });
                    } else {
                        throw authError;
                    }
                }
            }
            if (!userRecord) {
                return res.status(400).json({ error: 'No fue posible resolver o crear la identidad del titular.' });
            }
            if (userRecord.disabled) {
                await auth.updateUser(userRecord.uid, { disabled: false }).catch(() => {});
            }

            const resolvedEmail = String(realEmail || userRecord.email || '').toLowerCase().trim();
            const existingMemberSnap = await accountRef.collection('members').doc(userRecord.uid).get();
            const existingMemberData = existingMemberSnap.exists ? (existingMemberSnap.data() || {}) : {};
            const existingMemberRole = String(existingMemberData.role || '').trim().toUpperCase();

            let userRole = 'OWNER';
            if (isEdu) {
                const candidateEduRole = String(
                    existingMemberRole ||
                        accountData.academicRole ||
                        tenantData.academicRole ||
                        accountData.mandatario?.jobTitle ||
                        ''
                )
                    .trim()
                    .toUpperCase();
                userRole = candidateEduRole === 'PROFESSOR' || candidateEduRole === 'STUDENT' ? candidateEduRole : 'STUDENT';
            } else if (existingMemberRole === 'OWNER' || existingMemberRole === 'ADMIN') {
                userRole = existingMemberRole;
            }

            const prevClaims =
                userRecord.customClaims && typeof userRecord.customClaims === 'object' ? userRecord.customClaims : {};
            await auth.setCustomUserClaims(userRecord.uid, {
                ...prevClaims,
                role: userRole,
                accountTier: isEdu ? 5 : 4,
                tier: tenantData.type || accountData.type || (isEdu ? 'EDUCATIONAL' : 'BUSINESS'),
                tenantId: uid,
                activeAccountId: uid,
            });
            if (typeof (auth as any).updateUser === 'function') {
                await auth.updateUser(userRecord.uid, { emailVerified: true, disabled: false }).catch(() => {});
            }

            const existingEntitlements = accountData.entitlements || tenantData.entitlements || null;
            let resolvedPlugins: string[] = [];
            let nextEntitlements = existingEntitlements;

            if (enabledPlugins && enabledPlugins.length > 0) {
                resolvedPlugins = Array.from(new Set(enabledPlugins));
                nextEntitlements = {
                    basePackage: existingEntitlements?.basePackage || (isEdu ? 'ACADEMIC_SANDBOX' : 'CORE_BASE'),
                    ...(existingEntitlements?.baseModules ? { baseModules: existingEntitlements.baseModules } : {}),
                    addonModules: {
                        opermaq: { active: resolvedPlugins.includes('opermaq'), updatedAt: nowMs },
                        stockpile: { active: resolvedPlugins.includes('stockpile'), updatedAt: nowMs },
                        supply: { active: resolvedPlugins.includes('supply'), updatedAt: nowMs },
                    },
                    maxProjects: existingEntitlements?.maxProjects ?? (isEdu ? 3 : null),
                };
            } else if (existingEntitlements) {
                const opOk = resolveEffectiveModuleAccess({
                    moduleKey: 'opermaq',
                    globalModuleActive: true,
                    entitlements: existingEntitlements,
                });
                const stOk = resolveEffectiveModuleAccess({
                    moduleKey: 'stockpile',
                    globalModuleActive: true,
                    entitlements: existingEntitlements,
                });
                const suOk = resolveEffectiveModuleAccess({
                    moduleKey: 'supply',
                    globalModuleActive: true,
                    entitlements: existingEntitlements,
                });
                resolvedPlugins = [
                    ...(opOk ? ['opermaq'] : []),
                    ...(stOk ? ['stockpile'] : []),
                    ...(suOk ? ['supply'] : []),
                ];
            } else {
                resolvedPlugins = isEdu ? ['opermaq'] : ['opermaq', 'stockpile'];
                nextEntitlements = {
                    basePackage: isEdu ? 'ACADEMIC_SANDBOX' : 'CORE_BASE',
                    addonModules: {
                        opermaq: { active: resolvedPlugins.includes('opermaq'), updatedAt: nowMs },
                        stockpile: { active: resolvedPlugins.includes('stockpile'), updatedAt: nowMs },
                        supply: { active: resolvedPlugins.includes('supply'), updatedAt: nowMs },
                    },
                    maxProjects: isEdu ? 3 : null,
                };
            }

            const accountId = uid;
            await tenantRef.set(
                {
                    status: 'ACTIVE',
                    authUid: userRecord.uid,
                    processedAt: nowIso,
                    processedBy: adminEmail,
                    observations: observations || null,
                    enabledPlugins: resolvedPlugins,
                    entitlements: nextEntitlements,
                    updatedAt: nowIso,
                },
                { merge: true }
            );

            if (accountDoc.exists) {
                await accountRef.update({
                    status: 'ACTIVE',
                    enabledPlugins: resolvedPlugins,
                    entitlements: nextEntitlements,
                    'contract.status': 'ACTIVE',
                    'contract.activatedAt': nowMs,
                    'contract.activeModules': {
                        opermaq: resolvedPlugins.includes('opermaq'),
                        stockpile: resolvedPlugins.includes('stockpile'),
                        supply: resolvedPlugins.includes('supply'),
                    },
                    updatedAt: nowMs,
                });
            } else {
                await accountRef.set(
                    {
                        id: accountId,
                        name: entityName,
                        type: isEdu ? 'EDUCATIONAL' : tenantData.type || 'BUSINESS',
                        classification: isEdu ? 'edu' : 'b2b',
                        country: countryCode,
                        countryCode,
                        status: 'ACTIVE',
                        isEduSandbox: isEdu,
                        ...(formattedTaxId ? { taxId: cleanTaxId, taxIdFormatted: formattedTaxId } : {}),
                        ownerId: userRecord.uid,
                        enabledPlugins: resolvedPlugins,
                        entitlements: nextEntitlements,
                        contract: {
                            plan: nextEntitlements.basePackage,
                            status: 'ACTIVE',
                            activeModules: {
                                opermaq: resolvedPlugins.includes('opermaq'),
                                stockpile: resolvedPlugins.includes('stockpile'),
                                supply: resolvedPlugins.includes('supply'),
                            },
                            activatedAt: nowMs,
                        },
                        licensing: isEdu
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
                        createdAt: nowMs,
                        updatedAt: nowMs,
                    },
                    { merge: true }
                );
            }

            const newMembership = {
                accountId,
                role: userRole,
                accountName: entityName,
                companyName: entityName,
                type: isEdu ? 'EDUCATIONAL' : 'BUSINESS',
                countryCode,
                status: 'ACTIVE',
                joinedAt: existingMemberData.joinedAt ?? nowMs,
            };

            const existingUserDoc = await db.collection('users').doc(userRecord.uid).get();
            if (existingUserDoc.exists) {
                const userData = existingUserDoc.data() || {};
                const existingMems = Array.isArray(userData.memberships) ? userData.memberships : [];
                const cleanedMems = existingMems
                    .filter((m: any) => m.accountId !== accountId)
                    .map(({ passwordHash: _legacy, ...rest }: any) => rest);
                cleanedMems.push(newMembership);

                const currentUserRole = String(userData.role || '').toUpperCase();
                const shouldPreserveSpecialRole =
                    currentUserRole === 'DEV_ROOT' ||
                    currentUserRole === 'SUPER_ADMIN' ||
                    currentUserRole === 'TEST_PILOT';

                await db.collection('users').doc(userRecord.uid).update({
                    memberships: cleanedMems,
                    status: 'ACTIVE',
                    role: shouldPreserveSpecialRole ? currentUserRole : userRole,
                    primaryAccountId: userData.primaryAccountId || accountId,
                    lastActiveAccountId: userData.lastActiveAccountId || accountId,
                    updatedAt: nowIso,
                });
            } else {
                await db.collection('users').doc(userRecord.uid).set({
                    uid: userRecord.uid,
                    email: resolvedEmail,
                    ...(formattedTaxId ? { taxId: formattedTaxId } : {}),
                    displayName: entityName,
                    role: userRole,
                    classification: isEdu ? 'edu' : 'b2b',
                    countryCode,
                    memberships: [newMembership],
                    primaryAccountId: accountId,
                    lastActiveAccountId: accountId,
                    status: 'ACTIVE',
                    entitlements: {
                        pluginsEnabled: resolvedPlugins,
                        storageLimit: 1073741824,
                    },
                    stats: {
                        storageUsed: 0,
                        lastLogin: null,
                    },
                    createdAt: nowIso,
                    updatedAt: nowIso,
                });
            }

            if (cleanTaxId && countryCode === 'CL') {
                const accountRefEntry = {
                    accountId,
                    uid: userRecord.uid,
                    authEmail: resolvedEmail,
                    role: userRole,
                    type: isEdu ? 'EDUCATIONAL' : tenantData.type || 'BUSINESS',
                    accountName: entityName,
                    status: 'ACTIVE',
                };

                const dirKeys = Array.from(new Set([rawTaxIdStr, cleanTaxId, formattedTaxId].filter(Boolean)));
                for (const dirKey of dirKeys) {
                    const userDirRef = db.collection('user_directory').doc(dirKey);
                    const userDirSnap = await userDirRef.get();

                    if (userDirSnap.exists) {
                        const dirData = userDirSnap.data();
                        let accounts = Array.isArray(dirData?.accounts) ? dirData!.accounts : [];

                        if (tenantData.type === 'PERSONAL') {
                            accounts = accounts.filter((a: any) => a.type !== 'PERSONAL');
                        } else if (isEdu) {
                            const prevEdu = accounts.find((a: any) => a.type === 'EDUCATIONAL');
                            if (prevEdu && prevEdu.accountId !== accountId) {
                                await db
                                    .collection('tenants')
                                    .doc(prevEdu.accountId)
                                    .update({
                                        status: 'REPLACED_BY_NEW_ENROLLMENT',
                                        updatedAt: nowIso,
                                    })
                                    .catch(() => {});
                                await db
                                    .collection('accounts')
                                    .doc(prevEdu.accountId)
                                    .update({
                                        status: 'REPLACED_BY_NEW_ENROLLMENT',
                                        updatedAt: nowMs,
                                    })
                                    .catch(() => {});
                            }
                            accounts = accounts.filter((a: any) => a.type !== 'EDUCATIONAL');
                        } else {
                            accounts = accounts.filter((a: any) => a.accountId !== accountId);
                        }

                        accounts.push(accountRefEntry);

                        await userDirRef.update({
                            uid: userRecord.uid,
                            accounts,
                            fullName:
                                tenantData.type === 'PERSONAL'
                                    ? tenantData.full_name
                                    : dirData?.fullName || entityName,
                            updatedAt: nowIso,
                        });
                    } else {
                        await userDirRef.set({
                            uid: userRecord.uid,
                            run: formattedTaxId,
                            fullName: tenantData.type === 'PERSONAL' ? tenantData.full_name : entityName,
                            accounts: [accountRefEntry],
                            createdAt: nowIso,
                            updatedAt: nowIso,
                        });
                    }
                }
            }

            await accountRef
                .collection('members')
                .doc(userRecord.uid)
                .set(
                    {
                        id: userRecord.uid,
                        userId: userRecord.uid,
                        email: resolvedEmail,
                        fullName: existingMemberData.fullName || tenantData.full_name || entityName,
                        ...(formattedTaxId ? { run: formattedTaxId } : {}),
                        role: userRole,
                        status: 'ACTIVE',
                        countryCode,
                        isOwner: !isEdu && userRole === 'OWNER',
                        joinedAt: existingMemberData.joinedAt ?? nowMs,
                    },
                    { merge: true }
                );

            const credDoc = await db.collection('user_auth_credentials').doc(userRecord.uid).get();
            const hasPriorCredentials = Boolean(
                credDoc.exists ||
                    accountData.hasInitialPassword === true ||
                    tenantData.hasInitialPassword === true ||
                    Boolean(userRecord.passwordHash)
            );
            const baseUrl = getCanonicalWebUrl();

            if (!hasPriorCredentials && resolvedEmail) {
                const { rawToken, hashedToken, expiresAt } = generateSetupToken();
                await db.collection('setup_tokens').doc(rawToken).set({
                    accountId,
                    uid: userRecord.uid,
                    taxId: cleanTaxId || userRecord.uid,
                    hashedToken,
                    expiresAt,
                    ttlExpiresAt: computeShortTtlTimestamp(24 * 60 * 60 * 1000),
                    used: false,
                    createdAt: nowMs,
                });

                const actionLink = `${baseUrl}/setup-access?accountId=${encodeURIComponent(uid)}&taxId=${encodeURIComponent(cleanTaxId || userRecord.uid)}&name=${encodeURIComponent(entityName)}&type=${encodeURIComponent(isEdu ? 'EDUCATIONAL' : tenantData.type || 'BUSINESS')}&token=${encodeURIComponent(rawToken)}`;

                EmailService.sendEmail({
                    from: 'MINREPORT System <support@minreport.com>',
                    to: resolvedEmail,
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
                                    <p style="margin: 0; font-size: 14px; color: #0F172A;">${resolvedEmail}</p>
                                </div>
                            </div>
                            <div style="text-align: center; margin: 34px 0;">
                                <a href="${actionLink}" style="background: #0F172A; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">Configurar Acceso Seguro</a>
                            </div>
                        </div>
                    `,
                }).catch((err) => console.warn('[ADMIN] Non-blocking setup email warning:', err?.message || err));
            } else if (resolvedEmail) {
                EmailService.sendEmail({
                    from: 'MINREPORT System <support@minreport.com>',
                    to: resolvedEmail,
                    subject: 'Cuenta Activada en MINREPORT',
                    html: `
                        <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                            <div style="background: #F8FAFC; border-left: 4px solid #00AEEF; padding: 21px; margin-bottom: 21px;">
                                <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 13px;">Cuenta Activada</h2>
                                <p style="margin: 0; font-size: 15px; line-height: 1.5;">
                                    La cuenta <strong>${entityName}</strong> ha sido validada y se encuentra operativa. Inicie sesión con sus credenciales registradas en <a href="${baseUrl}/access">${baseUrl}/access</a>.
                                </p>
                            </div>
                        </div>
                    `,
                }).catch((err) => console.warn('[ADMIN] Non-blocking welcome email warning:', err?.message || err));
            }

            await recordAdminAudit(
                req,
                'APPROVE_TENANT',
                uid,
                {
                    type: isEdu ? 'EDUCATIONAL' : tenantData.type || 'BUSINESS',
                    countryCode,
                    isEdu,
                    ownerUid: userRecord.uid,
                    role: userRole,
                    enabledPlugins: resolvedPlugins,
                    hadPriorCredentials: hasPriorCredentials,
                },
                accountId
            );
        } else if (status === 'SUSPENDED') {
            await tenantRef.set(
                {
                    status: 'SUSPENDED',
                    observations: observations || null,
                    suspendedAt: nowIso,
                    processedBy: adminEmail,
                    updatedAt: nowIso,
                },
                { merge: true }
            );

            if (accountDoc.exists) {
                await accountRef.update({
                    status: 'SUSPENDED',
                    'contract.status': 'SUSPENDED',
                    updatedAt: nowMs,
                });
            }

            await syncTenantMembersOnDeactivation({
                accountRef,
                accountId: uid,
                targetStatus: 'SUSPENDED',
                ownerUidCandidate,
                nowMs,
                nowIso,
                disableAuthWhenNoActive: false,
            });

            await recordAdminAudit(
                req,
                'SUSPEND_TENANT',
                uid,
                { observations: observations || null },
                uid
            );
        } else if (status === 'REJECTED') {
            const effectiveReason = rejectionReason || 'Documentación no validada según políticas vigentes.';
            const rejectionTtl = computeThirtyDayTtlTimestamp();

            await tenantRef.set(
                {
                    status: 'REJECTED',
                    rejectionReason: effectiveReason,
                    processedAt: nowIso,
                    processedBy: adminEmail,
                    observations: observations || null,
                    expiresAt: rejectionTtl,
                    ttlExpiresAt: rejectionTtl,
                    updatedAt: nowIso,
                },
                { merge: true }
            );

            if (accountDoc.exists) {
                await accountRef.update({
                    status: 'REJECTED',
                    'contract.status': 'REJECTED',
                    ttlExpiresAt: rejectionTtl,
                    updatedAt: nowMs,
                });
            }

            await syncTenantMembersOnDeactivation({
                accountRef,
                accountId: uid,
                targetStatus: 'REJECTED',
                ownerUidCandidate,
                nowMs,
                nowIso,
                ttlExpiresAt: rejectionTtl,
                disableAuthWhenNoActive: true,
            });

            const targetEmail = String(tenantData.email || accountData.mandatario?.email || '').trim();
            if (targetEmail) {
                EmailService.sendEmail({
                    from: 'MINREPORT <ops@minreport.com>',
                    to: targetEmail,
                    subject: 'Estado de Solicitud MINREPORT',
                    html: `
                        <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                            <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 21px; margin-bottom: 21px;">
                                <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 13px;">Estado de Solicitud</h2>
                                <p style="margin: 0; font-size: 15px; line-height: 1.5;">La solicitud de acceso no ha sido aprobada.</p>
                                <p style="margin: 13px 0 0 0; font-size: 14px; line-height: 1.5;"><strong>Motivo:</strong> ${effectiveReason}</p>
                            </div>
                        </div>
                    `,
                }).catch((err) => console.warn('[ADMIN] Non-blocking rejection email warning:', err?.message || err));
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

/**
 * PATCH /api/admin/accounts/:accountId/entitlements
 * Gobierno granular de paquete base, add-ons (OPERMAQ/STOCKPILE), cuota maxProjects e institución EDU.
 */
export const updateAccountEntitlements = async (req: AuthRequest, res: express.Response) => {
    try {
        const accountId = String(req.params.accountId || '').trim();
        if (!accountId || accountId.length > 128) {
            return res.status(400).json({ error: 'accountId inválido' });
        }

        const bodyObj = req.body && typeof req.body === 'object' ? req.body : {};
        const confirmationKeyword = extractHitlConfirmationKeyword(req);
        const parsed = UpdateAccountEntitlementsPayloadSchema.safeParse({
            ...bodyObj,
            confirmationKeyword,
        });

        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Payload de entitlements inválido.',
                details: parsed.error.format(),
            });
        }

        const accountRef = db.collection('accounts').doc(accountId);
        const accountSnap = await accountRef.get();
        if (!accountSnap.exists) {
            return res.status(404).json({ error: 'Cuenta no encontrada.' });
        }

        const accountData = accountSnap.data() || {};
        const { basePackage, addonModules, maxProjects, eduInstitutionId } = parsed.data;
        const nowMs = Date.now();

        let eduFields: Record<string, any> = {};
        let eduHydratedMaxProjects: number | undefined;

        if (eduInstitutionId !== undefined) {
            const cleanedInstId = eduInstitutionId ? eduInstitutionId.trim() : '';
            if (cleanedInstId) {
                const instSnap = await db.collection('edu_institutions').doc(cleanedInstId).get();
                if (!instSnap.exists) {
                    return res.status(404).json({ error: 'Institución EDU no encontrada.' });
                }
                const instData = instSnap.data() || {};
                eduFields = {
                    eduInstitutionId: instSnap.id,
                    eduInstitutionName: String(instData.name || ''),
                    eduInstitutionLogo: instData.eduInstitutionLogo ?? null,
                };
                if (typeof instData.defaultMaxProjects === 'number') {
                    eduHydratedMaxProjects = instData.defaultMaxProjects;
                }
            } else {
                eduFields = {
                    eduInstitutionId: null,
                    eduInstitutionName: null,
                    eduInstitutionLogo: null,
                };
            }
        }

        const resolvedMaxProjects =
            maxProjects !== undefined
                ? maxProjects
                : eduHydratedMaxProjects ??
                  accountData.entitlements?.maxProjects ??
                  (basePackage === 'ACADEMIC_SANDBOX' ? 3 : null);

        const nextEntitlements = {
            basePackage,
            baseModules: {
                opermaq:
                    basePackage === 'OPERMAQ_BASE' ||
                    basePackage === 'FULL_SUITE' ||
                    basePackage === 'ACADEMIC_SANDBOX',
                stockpile: basePackage === 'FULL_SUITE',
                supply: basePackage === 'FULL_SUITE',
            },
            addonModules: {
                opermaq: { active: addonModules.opermaq, updatedAt: nowMs },
                stockpile: { active: addonModules.stockpile, updatedAt: nowMs },
                supply: { active: Boolean(addonModules.supply), updatedAt: nowMs },
            },
            maxProjects: resolvedMaxProjects,
        };

        const opermaqEffective = resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: nextEntitlements,
        });
        const stockpileEffective = resolveEffectiveModuleAccess({
            moduleKey: 'stockpile',
            globalModuleActive: true,
            entitlements: nextEntitlements,
        });
        const supplyEffective = resolveEffectiveModuleAccess({
            moduleKey: 'supply',
            globalModuleActive: true,
            entitlements: nextEntitlements,
        });

        const nextEnabledPlugins = [
            ...(opermaqEffective ? ['opermaq'] : []),
            ...(stockpileEffective ? ['stockpile'] : []),
            ...(supplyEffective ? ['supply'] : []),
        ];

        const syncPayload = {
            entitlements: nextEntitlements,
            enabledPlugins: nextEnabledPlugins,
            'contract.plan': basePackage,
            'contract.activeModules': {
                opermaq: opermaqEffective,
                stockpile: stockpileEffective,
                supply: supplyEffective,
            },
            ...eduFields,
            updatedAt: nowMs,
        };

        await accountRef.update(syncPayload);

        const tenantRef = db.collection('tenants').doc(accountId);
        const tenantSnap = await tenantRef.get();
        if (tenantSnap.exists) {
            await tenantRef.update(syncPayload).catch(() => {});
        }

        await recordAdminAudit(
            req,
            'ACCOUNT_ENTITLEMENTS_UPDATED',
            accountId,
            {
                basePackage,
                addonModules,
                maxProjects: resolvedMaxProjects,
                enabledPlugins: nextEnabledPlugins,
                eduInstitutionId: eduFields.eduInstitutionId ?? accountData.eduInstitutionId ?? null,
            },
            accountId
        );

        return res.status(200).json({
            success: true,
            accountId,
            entitlements: nextEntitlements,
            enabledPlugins: nextEnabledPlugins,
            ...eduFields,
        });
    } catch (error) {
        console.error('[ADMIN] Error updating account entitlements:', error);
        return res.status(500).json({ error: 'Error actualizando entitlements de la cuenta.' });
    }
};

async function cleanupAccountMembers(accountId: string, isPurge: boolean = false) {
    try {
        const [membersSnap, accountSnap] = await Promise.all([
            db.collection('accounts').doc(accountId).collection('members').get(),
            db.collection('accounts').doc(accountId).get(),
        ]);

        const candidateTaxIdByUid = new Map<string, string | undefined>();
        for (const memberDoc of membersSnap.docs) {
            const memberData = memberDoc.data() || {};
            const resolvedUid = String(memberData.userId || memberDoc.id || '').trim();
            if (!resolvedUid) continue;
            const taxId = memberData.run || memberData.rut || memberData.taxId;
            candidateTaxIdByUid.set(resolvedUid, taxId ? String(taxId) : undefined);
        }

        const ownerId = accountSnap.exists ? String(accountSnap.data()?.ownerId || '').trim() : '';
        if (ownerId && !candidateTaxIdByUid.has(ownerId)) {
            candidateTaxIdByUid.set(ownerId, undefined);
        }

        const uidList = Array.from(candidateTaxIdByUid.keys());
        if (uidList.length === 0) {
            return;
        }

        const CHUNK_SIZE = 100;
        for (let i = 0; i < uidList.length; i += CHUNK_SIZE) {
            const chunk = uidList.slice(i, i + CHUNK_SIZE);
            if (chunk.length === 0) continue;
            const userRefs = chunk.map((u) => db.collection('users').doc(u));
            const userSnaps = await db.getAll(...userRefs);

            for (const userDoc of userSnaps) {
                if (!userDoc.exists) continue;
                const userData = userDoc.data() || {};
                const memberships = Array.isArray(userData.memberships) ? userData.memberships : [];
                const fallbackTaxId = candidateTaxIdByUid.get(userDoc.id);
                const actualTaxId = String(userData.taxId || fallbackTaxId || '');
                await processUserCleanup(userDoc.id, actualTaxId, accountId, memberships, isPurge);
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

        const softDeleteTtl = computeThirtyDayTtlTimestamp();
        const deletedAtIso = new Date().toISOString();

        await db.collection('tenants').doc(uid).update({
            status: 'DELETED',
            deletedAt: deletedAtIso,
            deletedBy: actor,
            expiresAt: softDeleteTtl,
            ttlExpiresAt: softDeleteTtl,
        });

        const accountRef = db.collection('accounts').doc(uid);
        const accountDoc = await accountRef.get();
        if (accountDoc.exists) {
            await accountRef.update({
                status: 'DELETED',
                deletedAt: deletedAtIso,
                expiresAt: softDeleteTtl,
                ttlExpiresAt: softDeleteTtl,
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

const brandingLogoSetKeySchema = z.enum([
    'isotype',
    'logotype',
    'imagotype',
    'imagotypeVertical',
    'pwaIcon',
    'appIcon',
]);

const brandingAssetTelemetryItemSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    originalBytes: z.number().nonnegative().max(104857600),
    optimizedBytes: z.number().nonnegative().max(20971520),
    savingsPct: z.number().min(0).max(100),
    profile: z.enum(['IMAGE_ISO_SYMBOL', 'VECTOR_SVG_CLEAN']),
});

const updateBrandingSettingsSchema = z.object({
    siteName: z.string().min(1).max(120).optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    light: brandingThemeAssetsSchema.optional(),
    dark: brandingThemeAssetsSchema.optional(),
    assetTelemetry: z.record(brandingLogoSetKeySchema, brandingAssetTelemetryItemSchema).optional(),
    confirmationWord: z.string().optional(),
    confirmationKeyword: z.string().optional(),
}).passthrough();

function hasInlineDataOrBase64(value: unknown): boolean {
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (!lower) return false;
        return lower.includes('data:') || lower.includes(';base64,');
    }
    if (Array.isArray(value)) {
        return value.some((item) => hasInlineDataOrBase64(item));
    }
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some((v) => hasInlineDataOrBase64(v));
    }
    return false;
}

async function readCasStreamToBuffer(
    stream: NodeJS.ReadableStream,
    maxBytes: number = 20 * 1024 * 1024
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on('data', (chunk: Buffer | Uint8Array | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > maxBytes) {
                const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void };
                if (typeof destroyable.destroy === 'function') {
                    destroyable.destroy();
                }
                reject(new Error('El activo CAS excede el límite máximo de 20 MB para icono PWA.'));
                return;
            }
            chunks.push(buf);
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(err));
    });
}

async function resolveCasBrandingIconBuffer(pwaIconUrl: string): Promise<Buffer | null> {
    const cleanUrl = pwaIconUrl.trim();
    const symbologyMatch = cleanUrl.match(
        /^\/api\/media\/blob\/symbology\/([a-f0-9]{64})\.([a-z0-9]{2,16})(?:[?#].*)?$/i
    );
    const globalOemMatch = cleanUrl.match(
        /^\/api\/media\/blob\/global_oem\/([a-f0-9]{64})\.([a-z0-9]{2,16})(?:[?#].*)?$/i
    );
    const casShaMatch = cleanUrl.match(/^\/api\/media\/cas\/([a-f0-9]{64})(?:[?#].*)?$/i);

    let blobHandle: CasBlobStreamHandle | null = null;
    if (symbologyMatch) {
        const casPath = `assets/symbology/cas/${symbologyMatch[1].toLowerCase()}.${symbologyMatch[2].toLowerCase()}`;
        blobHandle = await CasStorageService.openCasBlobStream(casPath);
    } else if (globalOemMatch) {
        const casPath = CasStorageService.buildStoragePath(
            'GLOBAL_OEM',
            globalOemMatch[1].toLowerCase(),
            globalOemMatch[2].toLowerCase()
        );
        blobHandle = await CasStorageService.openCasBlobStream(casPath);
    } else if (casShaMatch) {
        blobHandle = await CasStorageService.openCasBlobStream(casShaMatch[1].toLowerCase());
    }

    if (!blobHandle) return null;
    return readCasStreamToBuffer(blobHandle.stream);
}

export const updateBrandingSettings = async (req: express.Request, res: express.Response) => {
    try {
        const devUser = (req as any).devUser;
        const authUser = (req as AuthRequest).user;
        const actorEmailLower = String(devUser?.email || authUser?.email || '').trim().toLowerCase();
        const isDevRootRequester = Boolean(
            devUser ||
            authUser?.role === 'DEV_ROOT' ||
            authUser?.isMasterDev === true ||
            authUser?.uid === 'dev-master-root-uid' ||
            actorEmailLower === 'dev@minreport.com'
        );

        if (!isDevRootRequester) {
            return res.status(403).json({
                error: 'Forbidden: Identidad maestra MINREPORT reservada exclusivamente a 1º DEV (DEV_ROOT).',
            });
        }

        if (extractHitlConfirmationKeyword(req) !== 'ACTUALIZAR') {
            return res.status(400).json({
                error: 'Confirmación HITL obligatoria: debe confirmar escribiendo "ACTUALIZAR".',
            });
        }

        if (
            hasInlineDataOrBase64(req.body?.light) ||
            hasInlineDataOrBase64(req.body?.dark) ||
            hasInlineDataOrBase64(req.body?.svgDataUris)
        ) {
            return res.status(400).json({
                error: 'Prohibido persistir Data URIs o Base64 en identidad maestra. Utilice activos CAS /api/media/.',
            });
        }

        const parsed = updateBrandingSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Configuración de marca inválida', details: parsed.error.format() });
        }

        const settings = parsed.data;
        const generatedAssets: Record<string, string> = {};

        // Procesamiento seguro en memoria con CAS / `safeFetchExternal` + `sharp` (Cero RCE, cero `curl`, cero `sips`)
        const pwaIconUrl = settings.light?.pwaIcon || settings.dark?.pwaIcon || settings.light?.isotype;
        if (pwaIconUrl) {
            let rawIconBuf: Buffer | null = null;
            if (pwaIconUrl.startsWith('/api/media/')) {
                try {
                    rawIconBuf = await resolveCasBrandingIconBuffer(pwaIconUrl);
                } catch (casErr: any) {
                    console.warn('[BRANDING] No se pudo resolver icono PWA desde CAS:', casErr?.message || casErr);
                }
            } else if (pwaIconUrl.startsWith('https://') || pwaIconUrl.startsWith('http://')) {
                try {
                    rawIconBuf = await downloadSafeAssetBuffer(pwaIconUrl);
                } catch (iconErr: any) {
                    console.warn('[BRANDING] No se pudo descargar icono PWA remoto:', iconErr?.message || iconErr);
                }
            }

            if (rawIconBuf) {
                try {
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
                                const safePng = await renderSafeZonePngIcon(rawIconBuf!, sz);
                                fs.writeFileSync(path.join(tmpOutDir, `ic_launcher_${sz}.png`), safePng);
                            })
                        );
                    }
                } catch (iconErr: any) {
                    console.warn('[BRANDING] No se pudo procesar icono PWA con sharp:', iconErr?.message || iconErr);
                }
            }
        }

        const {
            confirmationWord: _cw,
            confirmationKeyword: _ck,
            svgDataUris: _legacySvgDataUris,
            ...cleanSettings
        } = settings as Record<string, any>;

        const deleteFieldSentinel =
            typeof (admin as any)?.firestore?.FieldValue?.delete === 'function'
                ? (admin as any).firestore.FieldValue.delete()
                : typeof FieldValue?.delete === 'function'
                  ? FieldValue.delete()
                  : undefined;

        const payloadToSave: Record<string, any> = {
            ...cleanSettings,
            primaryColor: '#C68346',
            ...(Object.keys(generatedAssets).length > 0 ? { generatedAssets } : {}),
            ...(deleteFieldSentinel !== undefined ? { svgDataUris: deleteFieldSentinel } : {}),
            updatedAt: new Date().toISOString(),
        };

        await db.collection('settings').doc('branding').set(payloadToSave, { merge: true });

        const actorUid = String(devUser?.uid || authUser?.uid || 'dev-master-root-uid');
        const actorEmail = String(devUser?.email || authUser?.email || 'dev@minreport.com');
        await AuditLedger.record({
            tenantId: 'dev-master-sandbox',
            actorUid,
            actorEmail,
            action: 'GLOBAL_BRANDING_UPDATED',
            module: 'core',
            targetEntity: 'settings/branding',
            details: {
                updatedKeys: Object.keys(cleanSettings),
                primaryColor: '#C68346',
                generatedPwaIcons: Object.keys(generatedAssets).length > 0,
                hasAssetTelemetry: Boolean(cleanSettings.assetTelemetry),
            },
            ipAddress: extractClientIp(req),
        });

        return res.json({ success: true, primaryColor: '#C68346', generatedAssets });
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
    moduleId: z.enum(['opermaq', 'stockpile', 'supply']),
    enabled: z.boolean(),
    confirmationWord: z.literal('ACTUALIZAR'),
});

export const updateModuleAvailability = async (req: express.Request, res: express.Response) => {
    try {
        const parsed = updateModuleAvailabilitySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload inválido: se requiere moduleId ("opermaq" | "stockpile" | "supply"), enabled booleano y confirmationWord === "ACTUALIZAR".',
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

        const membersSnap = await db
            .collection('accounts')
            .doc(accountId.data)
            .collection('members')
            .get();

        if (membersSnap.empty) {
            return res.status(200).json([]);
        }

        const memberByUid = new Map<string, Record<string, any>>();
        for (const mDoc of membersSnap.docs) {
            const mData = mDoc.data() || {};
            const uid = String(mData.userId || mDoc.id || '').trim();
            if (uid) {
                memberByUid.set(uid, { memberDocId: mDoc.id, ...mData });
            }
        }

        const uidList = Array.from(memberByUid.keys());
        if (uidList.length === 0) {
            return res.status(200).json([]);
        }

        const accountUsers: Record<string, any>[] = [];
        const CHUNK_SIZE = 100;
        for (let i = 0; i < uidList.length; i += CHUNK_SIZE) {
            const chunk = uidList.slice(i, i + CHUNK_SIZE);
            if (chunk.length === 0) continue;
            const userRefs = chunk.map((u) => db.collection('users').doc(u));
            const userSnaps = await db.getAll(...userRefs);

            userSnaps.forEach((uSnap, idx) => {
                const uid = chunk[idx];
                const memberMeta = memberByUid.get(uid) || {};
                if (uSnap.exists) {
                    const raw = uSnap.data() || {};
                    const sanitizedMemberships = Array.isArray(raw.memberships)
                        ? raw.memberships.map(({ passwordHash: _ph, ...rest }: any) => rest)
                        : [];
                    accountUsers.push({
                        uid: uSnap.id,
                        ...raw,
                        role: raw.role || memberMeta.role || 'OPERATOR',
                        status: raw.status || memberMeta.status || 'ACTIVE',
                        memberships: sanitizedMemberships,
                    });
                } else {
                    accountUsers.push({
                        uid,
                        email: memberMeta.email || '',
                        fullName: memberMeta.fullName || '',
                        taxId: memberMeta.run || memberMeta.taxId || '',
                        role: memberMeta.role || 'OPERATOR',
                        status: memberMeta.status || 'PENDING',
                        memberships: [
                            {
                                accountId: accountId.data,
                                role: memberMeta.role || 'OPERATOR',
                                status: memberMeta.status || 'PENDING',
                            },
                        ],
                    });
                }
            });
        }

        return res.status(200).json(accountUsers);
    } catch (error) {
        console.error('[ADMIN] Error fetching account users:', error);
        return res.status(500).json({ error: 'Failed to fetch account users' });
    }
};

const tenantMetricsQuerySchema = z.object({
    segment: z.enum(['B2B', 'EDU']).default('B2B'),
    period: z
        .string()
        .regex(/^\d{4}_(0[1-9]|1[0-2])$/)
        .optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

/**
 * GET /api/admin/metrics/tenants?segment=B2B|EDU&period=YYYY_MM
 * Consulta telemetría mensual atómica separando estrictamente cuentas B2B de sandboxes académicos EDU.
 */
export const getTenantMetricsBySegment = async (req: express.Request, res: express.Response) => {
    try {
        const parsed = tenantMetricsQuerySchema.safeParse(req.query || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Parámetros de consulta de métricas inválidos (segment=B2B|EDU, period=YYYY_MM).',
                details: parsed.error.format(),
            });
        }

        const effectivePeriod = parsed.data.period || formatMetricsPeriod();
        const result = await TenantMetricsService.listMetricsBySegment({
            segment: parsed.data.segment,
            period: effectivePeriod,
            limit: parsed.data.limit,
        });

        return res.status(200).json(result);
    } catch (error) {
        console.error('[ADMIN] Error fetching segmented tenant metrics:', error);
        return res.status(500).json({ error: 'Failed to fetch segmented tenant metrics' });
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
                .where('action', 'in', ['AI_INFERENCE_HITL_REQUEST', 'AI_INFERENCE_REQUEST'])
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
                decisionsGate: {
                    model: swarmSnapshot.decisionsGate.model,
                    status:
                        swarmSnapshot.decisionsGate.calls > 0 ||
                        swarmSnapshot.decisionsGate.cacheHits > 0
                            ? 'VERIFIED'
                            : 'STANDBY',
                    calls: swarmSnapshot.decisionsGate.calls,
                    cacheHits: swarmSnapshot.decisionsGate.cacheHits,
                    fallbackCalls: swarmSnapshot.decisionsGate.fallbackCalls,
                    errors: swarmSnapshot.decisionsGate.errors,
                    avgLatencyMs: swarmSnapshot.decisionsGate.avgLatencyMs,
                    lastLatencyMs: swarmSnapshot.decisionsGate.lastLatencyMs,
                    lastUsedAt: swarmSnapshot.decisionsGate.lastUsedAt,
                    tier: 'Nivel 0 (Decisiones Calibradas · 0 Output Tokens)',
                },
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
