import crypto from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import admin, { db, auth } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { registerSchema } from '../core/schemas';
import { generateSetupToken } from '../utils/security';
import { env, getCanonicalWebUrl } from '../config/env';
import { classifyEmailDomain } from '../utils/domain-classifier';
import { formatRut, cleanRut, getRutVariants } from '../utils/rut';
import { AuthRequest } from '../middleware/auth';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';

export const register = async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const clientIp = extractClientIp(req);

        // 1. Detección de Registro Legal B2B (Ley 19.628)
        const isB2BRegistration = Boolean(body.businessName && body.companyTaxId && body.acceptTermsAndPrivacy);

        if (isB2BRegistration) {
            const { RegisterTitularAccountSchema } = await import('../core/schemas');
            const validation = RegisterTitularAccountSchema.safeParse(body);

            if (!validation.success) {
                return res.status(400).json({
                    error: 'Error de Validación Legal B2B',
                    details: validation.error.format()
                });
            }

            const data = validation.data;
            const normalizedEmail = data.email.toLowerCase().trim();
            const companyTaxId = data.companyTaxId.trim();
            const personalTaxIdClean = cleanRut(data.personalTaxId);
            const personalTaxIdFormatted = formatRut(personalTaxIdClean);

            const existingAccounts = await db.collection('accounts')
                .where('taxId', '==', companyTaxId)
                .where('status', '==', 'ACTIVE')
                .get();

            if (!existingAccounts.empty) {
                return res.status(409).json({
                    error: 'ENTIDAD_EXISTENTE: Ya existe una Cuenta Titular registrada para este RUT de empresa. Solicite acceso al Administrador Titular o contacte soporte.'
                });
            }

            const domainClassification = classifyEmailDomain(normalizedEmail);
            const isEduDomain = domainClassification.isAcademic;
            const accountClassification = domainClassification.classification;

            let userRecord;
            try {
                userRecord = await auth.getUserByEmail(normalizedEmail);
            } catch (e: any) {
                if (e.code === 'auth/user-not-found') {
                    const providedPassword = typeof body.password === 'string' && body.password.length >= 8
                        ? body.password
                        : `Min-${crypto.randomBytes(16).toString('base64url')}!9A`;
                    userRecord = await auth.createUser({
                        email: normalizedEmail,
                        displayName: data.fullName,
                        password: providedPassword,
                    });
                } else {
                    throw e;
                }
            }

            const uid = userRecord.uid;
            const accountRef = db.collection('accounts').doc();
            const accountId = accountRef.id;

            const accountData = {
                id: accountId,
                name: data.businessName.trim(),
                taxId: companyTaxId,
                type: isEduDomain ? 'EDUCATIONAL' : 'BUSINESS',
                classification: accountClassification,
                licensing: domainClassification.defaultLicensing,
                status: 'ACTIVE',
                ownerId: uid,
                billingEmail: data.billingEmail.toLowerCase().trim(),
                legalAddress: data.legalAddress.trim(),
                commune: data.commune.trim(),
                region: data.region.trim(),
                mandatario: {
                    fullName: data.fullName.trim(),
                    taxId: personalTaxIdFormatted,
                    email: normalizedEmail,
                    jobTitle: data.jobTitle || 'Mandatario Legal'
                },
                contract: {
                    plan: isEduDomain ? 'ACADEMIC_SANDBOX' : 'ENTERPRISE_B2B_CORE',
                    status: 'ACTIVE',
                    billingCycle: 'MENSUAL',
                    activeModules: {
                        opermaq: true,
                        stockpile: true
                    },
                    activatedAt: Date.now()
                },
                enabledPlugins: ['opermaq', 'stockpile'],
                compliance: {
                    law: 'Ley N° 19.628 (Protección de Datos Personales Chile)',
                    privacyPolicyVersion: '2026.1',
                    termsAccepted: true,
                    termsAcceptedAt: Date.now(),
                    ipAddress: clientIp
                },
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            await accountRef.set(accountData);

            await accountRef.collection('members').doc(uid).set({
                id: uid,
                userId: uid,
                fullName: data.fullName.trim(),
                email: normalizedEmail,
                run: personalTaxIdFormatted,
                role: 'ADMIN',
                status: 'ACTIVE',
                joinedAt: Date.now(),
                isOwner: true
            });

            const userRef = db.collection('users').doc(uid);
            const userDoc = await userRef.get();
            let currentMemberships = userDoc.exists ? (userDoc.data()?.memberships || []) : [];

            currentMemberships = currentMemberships
                .filter((m: any) => m.accountId !== accountId)
                .map(({ passwordHash: _ph, ...rest }: any) => rest);

            currentMemberships.push({
                accountId,
                accountName: data.businessName.trim(),
                role: 'ADMIN',
                type: isEduDomain ? 'EDUCATIONAL' : 'BUSINESS',
                status: 'ACTIVE',
                joinedAt: Date.now()
            });

            await userRef.set({
                uid,
                email: normalizedEmail,
                fullName: data.fullName.trim(),
                taxId: personalTaxIdFormatted,
                primaryAccountId: accountId,
                memberships: currentMemberships,
                classification: isEduDomain ? 'edu' : 'b2b',
                updatedAt: Date.now()
            }, { merge: true });

            // Sincronizar user_directory con `uid` explícito
            const dirAccountEntry = {
                accountId,
                uid,
                authEmail: normalizedEmail,
                role: 'ADMIN',
                type: isEduDomain ? 'EDUCATIONAL' : 'BUSINESS',
                accountName: data.businessName.trim(),
                status: 'ACTIVE',
            };
            for (const variant of getRutVariants(personalTaxIdClean)) {
                const dirRef = db.collection('user_directory').doc(variant);
                const dirSnap = await dirRef.get();
                if (dirSnap.exists) {
                    const prevAccounts = (dirSnap.data()?.accounts || []).filter((a: any) => a.accountId !== accountId);
                    prevAccounts.push(dirAccountEntry);
                    await dirRef.update({
                        uid,
                        run: personalTaxIdFormatted,
                        fullName: data.fullName.trim(),
                        accounts: prevAccounts,
                        updatedAt: new Date().toISOString(),
                    });
                } else {
                    await dirRef.set({
                        uid,
                        run: personalTaxIdFormatted,
                        fullName: data.fullName.trim(),
                        accounts: [dirAccountEntry],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    });
                }
            }

            await db.collection('tenants').doc(accountId).set({
                ...accountData,
                email: normalizedEmail,
                company_name: data.businessName.trim(),
                rut: companyTaxId,
                status: 'ACTIVE'
            });

            await AuditLedger.record({
                tenantId: accountId,
                actorUid: uid,
                actorEmail: normalizedEmail,
                action: 'REGISTER_TITULAR_ACCOUNT',
                module: 'b2b-core',
                targetEntity: accountId,
                details: { companyTaxId, type: accountData.type },
                ipAddress: clientIp,
            }).catch(() => {});

            return res.status(201).json({
                success: true,
                message: 'Cuenta Titular B2B creada y activada exitosamente.',
                accountId,
                accountName: data.businessName.trim(),
                userId: uid,
                isEdu: isEduDomain
            });
        }

        // --- FLUJO SOLICITUD ESTÁNDAR ---
        const validation = registerSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation Error',
                details: validation.error.format()
            });
        }

        const data = validation.data;
        const tenantEmail = data.email.toLowerCase();
        const run = (data as any).run;
        const rut = (data as any).rut;

        if (data.type === 'PERSONAL') {
            const querySnapshot = await db.collection('tenants')
                .where('run', '==', run)
                .where('type', '==', 'PERSONAL')
                .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE'])
                .get();

            if (!querySnapshot.empty) {
                return res.status(409).json({
                    error: 'IDENTIDAD_DUPLICADA: Ya posees una cuenta de uso personal. Utiliza la recuperación de credenciales o contacta a soporte técnico.'
                });
            }
        } else if (data.type === 'EDUCATIONAL') {
            const emailQuery = await db.collection('tenants')
                .where('email', '==', tenantEmail)
                .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE'])
                .get();

            if (!emailQuery.empty) {
                return res.status(409).json({
                    error: 'ACCESO_EXISTENTE: Este email ya está registrado. Utiliza la recuperación de credenciales.'
                });
            }
        } else if (data.type === 'ENTERPRISE' && rut) {
            const querySnapshot = await db.collection('tenants')
                .where('rut', '==', rut)
                .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE'])
                .get();

            if (!querySnapshot.empty) {
                return res.status(409).json({
                    error: 'ENTIDAD_REGISTRADA: Esta empresa ya se encuentra en proceso de validación o activa.'
                });
            }
        }

        const tenantDocRef = await db.collection('tenants').add({
            ...data,
            entity_type: (data as any).entity_type || null,
            email: tenantEmail,
            status: 'PENDING_APPROVAL',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await AuditLedger.record({
            tenantId: tenantDocRef.id,
            actorUid: 'public-applicant',
            actorEmail: tenantEmail,
            action: 'SUBMIT_TENANT_APPLICATION',
            module: data.type === 'EDUCATIONAL' ? 'edu' : 'b2b-core',
            targetEntity: tenantDocRef.id,
            details: { type: data.type },
            ipAddress: clientIp,
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            message: 'Solicitud registrada correctamente.'
        });
    } catch (error: any) {
        console.error('Register Error:', error);
        return res.status(500).json({ error: error.message || 'Registration failed' });
    }
};

const inviteUserSchema = z.object({
    email: z.string().email('Email inválido'),
    accountId: z.string().min(1, 'accountId es obligatorio').max(128),
    companyName: z.string().max(160).optional(),
    taxId: z.string().min(7).max(20).optional(),
    name: z.string().min(2).max(140).optional(),
    jobTitle: z.string().max(120).optional(),
});

async function isCallerAuthorizedToInvite(caller: any, accountId: string, accData: Record<string, any>): Promise<boolean> {
    if (!caller?.uid) return false;
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

    if (isGlobalSovereign) return true;
    if (accData.ownerId === callerUid) return true;

    const allowedRoles = new Set(['OWNER', 'ADMIN', 'ADMINISTRADOR OPERATIVO']);

    const userSnap = await db.collection('users').doc(callerUid).get();
    if (userSnap.exists) {
        const memberships = userSnap.data()?.memberships;
        if (Array.isArray(memberships)) {
            const matched = memberships.find((m: any) => m?.accountId === accountId);
            const role = String(matched?.role || '').toUpperCase();
            const status = String(matched?.status || 'ACTIVE').toUpperCase();
            if (allowedRoles.has(role) && status !== 'SUSPENDED' && status !== 'REVOKED' && status !== 'INACTIVE') {
                return true;
            }
        }
    }

    const memberSnap = await db.collection('accounts').doc(accountId).collection('members').doc(callerUid).get();
    if (memberSnap.exists) {
        const mData = memberSnap.data() || {};
        const role = String(mData.role || '').toUpperCase();
        const status = String(mData.status || 'ACTIVE').toUpperCase();
        if (allowedRoles.has(role) && status !== 'SUSPENDED' && status !== 'REVOKED' && status !== 'INACTIVE') {
            return true;
        }
    }

    return false;
}

export const inviteUser = async (req: AuthRequest, res: Response) => {
    try {
        const parsed = inviteUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de invitación inválido', details: parsed.error.format() });
        }

        const { email, accountId, companyName, taxId: rawTaxId, name, jobTitle } = parsed.data;

        const accountDoc = await db.collection('accounts').doc(accountId).get();
        if (!accountDoc.exists) {
            return res.status(404).json({ error: 'Cuenta corporativa no encontrada.' });
        }

        const accData = accountDoc.data()!;
        const isAuthorized = await isCallerAuthorizedToInvite(req.user, accountId, accData);
        if (!isAuthorized) {
            return res.status(403).json({
                error: 'Prohibido: Solo el OWNER o ADMIN de la cuenta (o administración global) puede invitar usuarios.',
            });
        }

        const licensing = accData.licensing;
        if ((licensing && licensing.allowInternalUsers === false) || String(accData.type || '').toUpperCase() === 'EDUCATIONAL') {
            return res.status(403).json({
                error: 'LICENCIA_RESTRINGIDA: Las cuentas académicas/educacionales operan con un usuario único y no permiten invitar usuarios internos.'
            });
        }

        if (licensing && licensing.maxUsers) {
            const membersSnap = await db.collection('accounts').doc(accountId).collection('members').get();
            if (membersSnap.size >= licensing.maxUsers) {
                return res.status(403).json({
                    error: `LIMITE_USUARIOS_ALCANZADO: Este tipo de cuenta permite un máximo de ${licensing.maxUsers} usuario(s).`
                });
            }
        }

        const normalizedEmail = email.toLowerCase().trim();
        const formattedTaxId = rawTaxId ? formatRut(cleanRut(rawTaxId)) : null;
        let isNewUser = false;
        let userRecord;

        if (formattedTaxId) {
            const userQuery = await db.collection('users').where('taxId', '==', formattedTaxId).limit(1).get();
            if (!userQuery.empty) {
                userRecord = await auth.getUser(userQuery.docs[0].id);
            }
        }

        if (!userRecord) {
            try {
                userRecord = await auth.getUserByEmail(normalizedEmail);
            } catch (error: any) {
                if (error.code === 'auth/user-not-found') {
                    isNewUser = true;
                    userRecord = await auth.createUser({
                        email: normalizedEmail,
                        emailVerified: true,
                        disabled: false
                    });
                } else {
                    throw error;
                }
            }
        }

        const userRef = db.collection('users').doc(userRecord.uid);
        const userDoc = await userRef.get();
        const existingUserData = userDoc.exists ? userDoc.data() || {} : {};
        const memberships = (Array.isArray(existingUserData.memberships) ? existingUserData.memberships : [])
            .map(({ passwordHash: _ph, ...rest }: any) => rest);

        const mIndex = memberships.findIndex((m: any) => m.accountId === accountId);
        const delegateMembership = {
            accountId,
            role: 'ADMINISTRADOR OPERATIVO',
            type: 'BUSINESS',
            status: 'PENDING',
            invitedAt: Date.now()
        };

        if (mIndex > -1) {
            memberships[mIndex] = { ...memberships[mIndex], ...delegateMembership };
        } else {
            memberships.push(delegateMembership);
        }

        const effectiveDisplayName = name || existingUserData.fullName || normalizedEmail.split('@')[0];

        await userRef.set({
            uid: userRecord.uid,
            taxId: existingUserData.taxId || formattedTaxId || null,
            email: normalizedEmail,
            fullName: effectiveDisplayName,
            memberships,
            updatedAt: Date.now()
        }, { merge: true });

        await db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid).set({
            userId: userRecord.uid,
            email: normalizedEmail,
            fullName: effectiveDisplayName,
            run: formattedTaxId,
            role: 'ADMINISTRADOR OPERATIVO',
            status: 'PENDING',
            invitedAt: Date.now(),
        }, { merge: true });

        if (formattedTaxId) {
            const dirAccountEntry = {
                accountId,
                uid: userRecord.uid,
                authEmail: normalizedEmail,
                role: 'ADMINISTRADOR OPERATIVO',
                type: 'BUSINESS',
                accountName: companyName || accData.name || 'MINREPORT',
                status: 'PENDING',
            };
            for (const variant of getRutVariants(formattedTaxId)) {
                const dirRef = db.collection('user_directory').doc(variant);
                const dirSnap = await dirRef.get();
                if (dirSnap.exists) {
                    const filtered = (dirSnap.data()?.accounts || []).filter((a: any) => a.accountId !== accountId);
                    filtered.push(dirAccountEntry);
                    await dirRef.update({
                        uid: userRecord.uid,
                        run: formattedTaxId,
                        fullName: effectiveDisplayName,
                        accounts: filtered,
                        updatedAt: new Date().toISOString(),
                    });
                } else {
                    await dirRef.set({
                        uid: userRecord.uid,
                        run: formattedTaxId,
                        fullName: effectiveDisplayName,
                        accounts: [dirAccountEntry],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    });
                }
            }
        }

        await db.collection('accounts').doc(accountId).update({
            primaryOperator: {
                name: effectiveDisplayName,
                email: normalizedEmail,
                taxId: formattedTaxId,
                jobTitle: jobTitle || 'ADMINISTRADOR OPERATIVO',
                status: 'PENDING',
                invitedAt: Date.now(),
                uid: userRecord.uid
            },
            updatedAt: Date.now()
        });

        const { rawToken, hashedToken, expiresAt } = generateSetupToken();
        const cleanTaxId = formattedTaxId ? cleanRut(formattedTaxId) : userRecord.uid;

        await db.collection('setup_tokens').doc(rawToken).set({
            accountId,
            uid: userRecord.uid,
            taxId: cleanTaxId,
            hashedToken,
            expiresAt,
            used: false,
            createdAt: Date.now()
        });

        const baseUrl = getCanonicalWebUrl();
        const entityLabel = companyName || accData.name || 'MINREPORT';
        const link = `${baseUrl}/setup-access?accountId=${encodeURIComponent(accountId)}&taxId=${encodeURIComponent(cleanTaxId)}&name=${encodeURIComponent(entityLabel)}&accountName=${encodeURIComponent(entityLabel)}&type=BUSINESS&token=${encodeURIComponent(rawToken)}`;

        await EmailService.sendEmail({
            from: 'MINREPORT Access <no-reply@minreport.com>',
            to: normalizedEmail,
            subject: isNewUser
                ? `Activa tu cuenta para ${entityLabel}`
                : `Acceso actualizado a ${entityLabel}`,
            html: `
                <div style="font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; max-width: 600px; color: #334155; padding: 34px 21px;">
                    <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 21px; margin-bottom: 21px;">
                        <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 13px;">
                            ${isNewUser ? 'Activación de Entorno' : 'Actualización de Acceso'}
                        </h2>
                        <p style="margin: 0; font-size: 15px; line-height: 1.5;">
                            Has sido invitado a operar en <strong>${entityLabel}</strong>.
                        </p>
                    </div>
                    <div style="text-align: center; margin: 34px 0;">
                        <a href="${link}" style="background: #0F172A; color: #FFFFFF; padding: 13px 34px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;">
                            ${isNewUser ? 'Activar Entorno' : 'Configurar Clave Operativa'}
                        </a>
                    </div>
                </div>
            `
        });

        await AuditLedger.record({
            tenantId: accountId,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'AUTH_INVITE_USER',
            module: 'b2b-core',
            targetEntity: userRecord.uid,
            details: { invitedEmail: normalizedEmail, isNewUser },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            message: isNewUser ? 'Invitación y enlace de activación enviados.' : 'Notificación de acceso enviada.',
            isNewUser
        });
    } catch (error) {
        console.error('Invite Error:', error);
        return res.status(500).json({ error: 'Failed to process invitation' });
    }
};
