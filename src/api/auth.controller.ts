import { formatRut } from "../utils/rut";
import { Request, Response } from 'express';
import admin, { db, auth } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { registerSchema } from '../core/schemas';
import { generateSetupToken } from '../utils/security';
import { env } from '../config/env';



export const register = async (req: Request, res: Response) => {
    try {
        const body = req.body;
        console.log('[AUTH-REGISTER] Request received for:', body.email || body.billingEmail);

        // 1. Detección de Registro Legal B2B (Estándar CABISEG / Ley 19.628)
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

            // Verificar si la empresa ya tiene cuenta activa por su RUT
            const existingAccounts = await db.collection('accounts')
                .where('taxId', '==', companyTaxId)
                .where('status', '==', 'ACTIVE')
                .get();

            if (!existingAccounts.empty) {
                return res.status(409).json({
                    error: 'ENTIDAD_EXISTENTE: Ya existe una Cuenta Titular registrada para este RUT de empresa. Solicite acceso al Administrador Titular o contacte soporte.'
                });
            }

            // Detección automática de dominio educacional
            const emailDomain = normalizedEmail.split('@')[1] || '';
            const isEduDomain = emailDomain.includes('.edu') || emailDomain.includes('.ac.') || emailDomain.includes('uchile.cl') || emailDomain.includes('usach.cl');

            // Obtener o crear usuario en Firebase Auth
            let userRecord;
            try {
                userRecord = await auth.getUserByEmail(normalizedEmail);
            } catch (e: any) {
                if (e.code === 'auth/user-not-found') {
                    userRecord = await auth.createUser({
                        email: normalizedEmail,
                        displayName: data.fullName,
                        password: req.body.password || (Math.random().toString(36).slice(-8) + 'Min2026!'),
                    });
                } else {
                    throw e;
                }
            }

            const uid = userRecord.uid;

            // 2. Crear Cuenta Titular B2B (Tenant Workspace)
            const accountRef = db.collection('accounts').doc();
            const accountId = accountRef.id;

            const accountData = {
                id: accountId,
                name: data.businessName.trim(),
                taxId: companyTaxId,
                type: isEduDomain ? 'EDUCATIONAL' : 'BUSINESS',
                classification: isEduDomain ? 'edu' : 'b2b',
                status: 'ACTIVE', // SOBERANÍA INMEDIATA - CERO APROBACIÓN MANUAL
                ownerId: uid,
                billingEmail: data.billingEmail.toLowerCase().trim(),
                legalAddress: data.legalAddress.trim(),
                commune: data.commune.trim(),
                region: data.region.trim(),
                mandatario: {
                    fullName: data.fullName.trim(),
                    taxId: data.personalTaxId.trim(),
                    email: normalizedEmail,
                    jobTitle: data.jobTitle || 'Mandatario Legal'
                },
                contract: {
                    plan: isEduDomain ? 'ACADEMIC_SANDBOX' : 'ENTERPRISE_B2B_CORE',
                    status: 'ACTIVE',
                    billingCycle: 'MENSUAL',
                    // Módulos satélites: Todos accesibles en fase de desarrollo
                    activeModules: {
                        opermaq: true,
                        stockpile: true,
                        miningFlow: true
                    },
                    activatedAt: Date.now()
                },
                enabledPlugins: ['opermaq', 'stockpile', 'mining-flow'],
                compliance: {
                    law: 'Ley N° 19.628 (Protección de Datos Personales Chile)',
                    privacyPolicyVersion: '2026.1',
                    termsAccepted: true,
                    termsAcceptedAt: Date.now(),
                    ipAddress: req.ip || req.socket.remoteAddress || '127.0.0.1'
                },
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            await accountRef.set(accountData);

            // 3. Crear Membresía del Titular en la Cuenta (Rol: ADMIN / OWNER)
            const memberRef = accountRef.collection('members').doc(uid);
            await memberRef.set({
                id: uid,
                userId: uid,
                fullName: data.fullName.trim(),
                email: normalizedEmail,
                run: data.personalTaxId.trim(),
                role: 'ADMIN',
                status: 'ACTIVE',
                joinedAt: Date.now(),
                isOwner: true
            });

            // 4. Actualizar Documento del Usuario
            const userRef = db.collection('users').doc(uid);
            const userDoc = await userRef.get();
            let currentMemberships = userDoc.exists ? (userDoc.data()?.memberships || []) : [];

            // Remover membresía previa si existía y agregar la nueva
            currentMemberships = currentMemberships.filter((m: any) => m.accountId !== accountId);
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
                taxId: data.personalTaxId.trim(),
                primaryAccountId: accountId,
                memberships: currentMemberships,
                classification: isEduDomain ? 'edu' : 'b2b',
                updatedAt: Date.now()
            }, { merge: true });

            // Registro en tenants para compatibilidad con paneles existentes
            await db.collection('tenants').doc(accountId).set({
                ...accountData,
                email: normalizedEmail,
                company_name: data.businessName.trim(),
                rut: companyTaxId,
                status: 'ACTIVE'
            });

            console.log();

            return res.status(201).json({
                success: true,
                message: 'Cuenta Titular B2B creada y activada exitosamente.',
                accountId,
                accountName: data.businessName.trim(),
                userId: uid,
                isEdu: isEduDomain
            });
        }

        // --- FLUJO LEGACY COMPATIBLE ---
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
        } else if (data.type === 'ENTERPRISE') {
            if (rut) {
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
        }

        const tenantData = {
            ...data,
            entity_type: (data as any).entity_type || null,
            email: tenantEmail,
            status: 'PENDING_APPROVAL',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('tenants').add(tenantData);

        return res.status(200).json({
            success: true,
            message: 'Solicitud registrada correctamente.'
        });

    } catch (error: any) {
        console.error('Register Error:', error);
        return res.status(500).json({ error: error.message || 'Registration failed' });
    }
};

export const inviteUser = async (req: Request, res: Response) => {
    try {
        let { email, accountId, companyName, taxId } = req.body;

        if (!email || !accountId) {
            return res.status(400).json({ error: 'Email and Account ID are required' });
        }

        // Normalize inputs
        const normalizedEmail = email.toLowerCase();
        taxId = taxId ? formatRut(taxId) : null;
        let link = '';
        let isNewUser = false;
        let userRecord;

        // 1. Identity Resolution (RUT/RUN First)
        // The system is RUT-Centric. Email is just a channel.
        console.log(`[B2B-INVITE] Resolving identity for TaxID: ${taxId}...`);
        const userQuery = await db.collection('users').where('taxId', '==', taxId).limit(1).get();

        if (!userQuery.empty) {
            const existingUserDoc = userQuery.docs[0];
            userRecord = await auth.getUser(existingUserDoc.id);
            console.log(`[B2B-INVITE] Identity found by RUT. Existing UID: ${userRecord.uid}`);
        } else {
            console.log(`[B2B-INVITE] RUT not found in Firestore. Checking by Email: ${normalizedEmail}...`);
            // Fallback to Email-based lookup
            try {
                userRecord = await auth.getUserByEmail(normalizedEmail);
                console.log(`[B2B-INVITE] Identity found by Email. UID: ${userRecord.uid}`);
            } catch (error: any) {
                if (error.code === 'auth/user-not-found') {
                    // Fully New User: Create placeholder
                    isNewUser = true;
                    userRecord = await auth.createUser({
                        email: normalizedEmail,
                        emailVerified: true,
                        disabled: false
                    });
                    console.log(`[B2B-INVITE] Created new Auth record. UID: ${userRecord.uid}`);
                } else {
                    throw error;
                }
            }
        }

        if (!userRecord) {
            throw new Error('Failed to resolve or create user identity.');
        }

        // 2. [CRITICAL] Sync with 'users' collection (The "Internal User" Creation)
        // This must happen BEFORE email sending to ensure system consistency.
        console.log(`[B2B-INVITE] Syncing 'users' document for UID: ${userRecord.uid}...`);

        try {
            const userRef = db.collection('users').doc(userRecord.uid);
            const userDoc = await userRef.get();

            let memberships = [];
            if (userDoc.exists) {
                memberships = userDoc.data()?.memberships || [];
            }

            const mIndex = memberships.findIndex((m: any) => m.accountId === accountId);
            const delegateMembership = {
                accountId,
                role: 'ADMINISTRADOR OPERATIVO',
                type: 'BUSINESS', // B2B context
                status: 'PENDING',
                invitedAt: Date.now()
            };

            if (mIndex > -1) {
                memberships[mIndex] = { ...memberships[mIndex], ...delegateMembership };
            } else {
                memberships.push(delegateMembership);
            }

            await userRef.set({
                taxId: userDoc.data()?.taxId || taxId || null,
                email: normalizedEmail,
                fullName: req.body.name || userDoc.data()?.fullName || normalizedEmail.split('@')[0],
                memberships,
                updatedAt: Date.now()
            }, { merge: true });

            console.log(`[B2B-INVITE] ✅ User document synced successfully for ${normalizedEmail}`);
        } catch (dbError) {
            console.error('[B2B-INVITE] ❌ Failed to sync user document:', dbError);
            throw new Error('Failed to create internal user record');
        }

        // 3. Update Account Document (Primary Operator)
        if (accountId) {
            console.log(`[B2B-INVITE] Updating Account ${accountId} with Primary Operator...`);
            await db.collection('accounts').doc(accountId).update({
                primaryOperator: {
                    name: req.body.name || normalizedEmail.split('@')[0],
                    email: normalizedEmail,
                    taxId: taxId || null,
                    jobTitle: req.body.jobTitle || 'ADMINISTRADOR OPERATIVO',
                    status: 'PENDING',
                    invitedAt: Date.now(),
                    uid: userRecord.uid // Link explicit UID
                },
                updatedAt: Date.now()
            });
            console.log(`[B2B-INVITE] ✅ Account updated successfully.`);
        }

        // 4. Generate Activation Link con Custom Setup Token (Consistente con staff/admin/setup)
        const { rawToken, hashedToken, expiresAt } = generateSetupToken();
        const cleanTaxId = taxId ? taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase() : userRecord.uid;

        await db.collection('setup_tokens').doc(rawToken).set({
            accountId,
            taxId: cleanTaxId,
            hashedToken,
            expiresAt,
            used: false,
            createdAt: Date.now()
        });

        const baseUrl = process.env.APP_URL || (process.env.NODE_ENV === 'production'
            ? 'https://minreport-access.web.app'
            : 'http://localhost:5173');

        const entityNameEncoded = encodeURIComponent(companyName || 'MinReport');
        link = `${baseUrl}/setup-access?accountId=${accountId}&taxId=${cleanTaxId}&name=${entityNameEncoded}&accountName=${entityNameEncoded}&type=BUSINESS&token=${rawToken}`;
        console.log(`[B2B-INVITE] Token de configuración generado para ${normalizedEmail}: ${rawToken.substring(0, 8)}...`);

        // 5. Send Email via Resend
        await EmailService.sendEmail({
            from: 'MinReport Access <no-reply@minreport.com>',
            to: normalizedEmail,
            subject: isNewUser
                ? `Activa tu cuenta para ${companyName || 'MinReport'}`
                : `Acceso actualizado a ${companyName || 'equipo exclusivo'}`,
            html: `
                <div style="font-family: 'Arial', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                    <div style="text-align: center; margin-bottom: 32px;">
                        <img src="https://minreport-access.web.app/pwa-192x192.png" alt="MINREPORT" style="height: 48px; width: auto; opacity: 0.9;" />
                    </div>
                    
                    <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 24px; margin-bottom: 24px;">
                        <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">
                            ${isNewUser ? 'Activación de Entorno' : 'Actualización de Acceso'}
                        </h2>
                        <p style="margin: 0; font-size: 15px; line-height: 1.6;">
                            Has sido invitado a operar en la estructura de <strong>${companyName || 'MinReport'}</strong>.
                        </p>

                        <div style="margin-top: 24px; background: white; border: 1px solid #E2E8F0; padding: 16px; border-radius: 4px;">
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Entidad Destino</p>
                            <p style="margin: 0 0 16px 0; font-size: 16px; color: #0F172A; font-weight: bold;">${companyName || 'MinReport'}</p>
                            
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Correo Asociado</p>
                            <p style="margin: 0 0 16px 0; font-size: 14px; color: #0F172A;">${normalizedEmail}</p>
                            
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Tipo de Entorno</p>
                            <p style="margin: 0; font-size: 14px; color: #0F172A;">Operación Corporativa (BUSINESS)</p>
                        </div>

                        <p style="margin: 24px 0 0 0; font-size: 15px; line-height: 1.6;">
                            ${isNewUser
                    ? 'Por seguridad, deberás verificar tu identidad ingresando tu documento principal antes de establecer tu contraseña exclusiva de acceso.'
                    : 'Por seguridad, deberás verificar tu identidad ingresando tu documento principal antes de activar este nuevo entorno.'
                }
                        </p>
                    </div>

                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${link}" style="background: #0F172A; color: white; padding: 16px 32px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; border-radius: 2px;">
                            ${isNewUser ? 'Activar Entorno' : 'Configurar Clave Operativa'}
                        </a>
                    </div>
                    
                    <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
                    <p style="font-size: 10px; color: #94A3B8; text-align: center; margin: 0; text-transform: uppercase; letter-spacing: 0.1em;">
                        MINREPORT SYSTEM INFRASTRUCTURE
                    </p>
                </div>
            `
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
