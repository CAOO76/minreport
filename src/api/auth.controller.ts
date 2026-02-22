import { Request, Response } from 'express';
import admin, { db, auth } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { registerSchema } from '../core/schemas';
import { env } from '../config/env';



export const register = async (req: Request, res: Response) => {
    try {
        // 1. Validate Input
        const validation = registerSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation Error',
                details: validation.error.format()
            });
        }

        const data = validation.data;
        const tenantEmail = data.email.toLowerCase();

        // 2. Updated Uniqueness Check based on Business Rules
        if (data.type === 'ENTERPRISE' || data.type === 'PERSONAL') {
            const idField = data.type === 'ENTERPRISE' ? 'rut' : 'run';
            const idValue = (data as any)[idField];

            // Check ID Uniqueness (RUT/RUN must be unique across system, unless previous request was REJECTED)
            if (idValue) {
                const querySnapshot = await db.collection('tenants').where(idField, '==', idValue).where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE']).get();
                if (!querySnapshot.empty) {
                    return res.status(409).json({ error: `El ${idField.toUpperCase()} ya está registrado y en proceso o activo. Pide acceso a tu admin.` });
                }
            }

            // Check Email Uniqueness ONLY for PERSONAL accounts
            // Enterprise accounts allow same email for multiple companies (Multi-Tenancy)
            if (data.type === 'PERSONAL') {
                const emailQuery = await db.collection('tenants')
                    .where('email', '==', tenantEmail)
                    .where('type', '==', 'PERSONAL')
                    .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE']) // Updated here
                    .get();

                if (!emailQuery.empty) {
                    return res.status(409).json({ error: 'Ya existe una cuenta PERSONAL con este email en evaluación o activa.' });
                }
            }
        } else { // 'EDUCATIONAL'
            const querySnapshot = await db.collection('tenants')
                .where('email', '==', tenantEmail)
                .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE'])
                .get();
            if (!querySnapshot.empty) {
                return res.status(409).json({ error: 'El email ya está registrado y se encuentra en evaluación o activo. Pide acceso a tu admin.' });
            }
        }

        // 3. Save Request to Firestore (Using auto-generated ID)
        const tenantData = {
            ...data,
            email: tenantEmail,
            status: 'PENDING_APPROVAL',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('tenants').add(tenantData);

        // 4. Send Email to Super Admin (Notification)
        try {
            await EmailService.sendEmail({
                from: 'MinReport System <onboarding@minreport.com>',
                to: env.SUPER_ADMIN_EMAIL,
                subject: `Nueva Solicitud: ${data.type}`,
                html: `
                    <div style="font-family: 'Arial', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <img src="https://minreport-access.web.app/pwa-192x192.png" alt="MINREPORT" style="height: 48px; width: auto; opacity: 0.9;" />
                        </div>
                        <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 24px; margin-bottom: 24px;">
                            <h2 style="color: #0F172A; font-size: 18px; margin-top: 0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">Nueva Solicitud de Registro</h2>
                            <p style="margin: 0; font-size: 15px; line-height: 1.6;">Se ha recibido una nueva solicitud para unirse al ecosistema MINREPORT.</p>
                            <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 16px 0;" />
                            <p style="margin: 8px 0; font-size: 14px;"><strong>Tipo:</strong> ${data.type}</p>
                            <p style="margin: 8px 0; font-size: 14px;"><strong>Nombre:</strong> ${data.type === 'PERSONAL' ? (data as any).full_name : (data as any).company_name || (data as any).institution_name}</p>
                            <p style="margin: 8px 0; font-size: 14px;"><strong>Email:</strong> ${data.email}</p>
                            <p style="margin: 8px 0; font-size: 14px;"><strong>Identificador:</strong> ${'rut' in data ? (data as any).rut : 'run' in data ? (data as any).run : 'N/A'}</p>
                        </div>
                        <div style="text-align: center; margin: 32px 0;">
                            <a href="https://minreport-access.web.app/admin" style="background: #0F172A; color: white; padding: 16px 32px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; border-radius: 2px;">Revisar en el Panel</a>
                        </div>
                        <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
                        <p style="font-size: 10px; color: #94A3B8; text-align: center; margin: 0; text-transform: uppercase; letter-spacing: 0.1em;">
                            MINREPORT SYSTEM INFRASTRUCTURE
                        </p>
                    </div>
                `
            });
        } catch (emailError) {
            console.error('Failed to send admin notification:', emailError);
        }

        return res.status(201).json({
            success: true,
            message: 'Solicitud enviada correctamente. Pendiente de aprobación administrativa.'
        });

    } catch (error: any) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar el registro' });
    }
};

import { formatRut } from '../utils/rut';

// [NEW] Invitation B2B Logic
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
                taxId: taxId || userDoc.data()?.taxId || null,
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

        // 4. Generate Activation Link (Always context-aware for B2B)
        const baseUrl = process.env.NODE_ENV === 'production'
            ? 'https://minreport-access.web.app'
            : 'http://localhost:5173';

        const entityNameEncoded = encodeURIComponent(companyName || 'MinReport');

        if (isNewUser) {
            console.log(`[B2B-INVITE] Generating activation link for NEW user: ${normalizedEmail}`);
            const rawLink = await auth.generatePasswordResetLink(normalizedEmail);
            const url = new URL(rawLink);
            const oobCode = url.searchParams.get('oobCode');

            // Redirect to setup-access instead of standard reset
            link = `${baseUrl}/setup-access?accountId=${accountId}&email=${normalizedEmail}&name=${entityNameEncoded}&type=BUSINESS&oobCode=${oobCode}`;
        } else {
            console.log(`[B2B-INVITE] Generating link for EXISTING user: ${normalizedEmail}`);
            // Point to setup-access anyway so they can set their SPECIFIC password for this account
            link = `${baseUrl}/setup-access?accountId=${accountId}&email=${normalizedEmail}&name=${entityNameEncoded}&type=BUSINESS`;
        }

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
