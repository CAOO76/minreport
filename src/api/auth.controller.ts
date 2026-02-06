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

            // Check ID Uniqueness (RUT/RUN must be unique across system)
            if (idValue) {
                const querySnapshot = await db.collection('tenants').where(idField, '==', idValue).get();
                if (!querySnapshot.empty) {
                    return res.status(409).json({ error: `El ${idField.toUpperCase()} ya está registrado` });
                }
            }

            // Check Email Uniqueness ONLY for PERSONAL accounts
            // Enterprise accounts allow same email for multiple companies (Multi-Tenancy)
            if (data.type === 'PERSONAL') {
                const emailQuery = await db.collection('tenants')
                    .where('email', '==', tenantEmail)
                    .where('type', '==', 'PERSONAL')
                    .get();

                if (!emailQuery.empty) {
                    return res.status(409).json({ error: 'Ya existe una cuenta PERSONAL con este email' });
                }
            }
        } else { // 'EDUCATIONAL'
            const querySnapshot = await db.collection('tenants').where('email', '==', tenantEmail).get();
            if (!querySnapshot.empty) {
                return res.status(409).json({ error: 'El email ya está registrado' });
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
                subject: `🚀 Nueva Solicitud: ${data.type}`,
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; color: #334155;">
                        <h2 style="color: #4F46E5;">Nueva Solicitud de Registro</h2>
                        <p>Se ha recibido una nueva solicitud para unirse al ecosistema MINREPORT.</p>
                        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                        <p><strong>Tipo:</strong> ${data.type}</p>
                        <p><strong>Nombre:</strong> ${data.type === 'PERSONAL' ? (data as any).full_name : (data as any).company_name || (data as any).institution_name}</p>
                        <p><strong>Email:</strong> ${data.email}</p>
                        <p><strong>Identificador Fiscal (RUT/RUN):</strong> ${'rut' in data ? (data as any).rut : 'run' in data ? (data as any).run : 'N/A'}</p>
                        <br />
                        <a href="https://minreport-access.web.app/admin" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Revisar en el Panel</a>
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

        if (isNewUser) {
            console.log(`[B2B-INVITE] Generating activation link for NEW user: ${normalizedEmail}`);
            const rawLink = await auth.generatePasswordResetLink(normalizedEmail);
            const url = new URL(rawLink);
            const oobCode = url.searchParams.get('oobCode');

            // Redirect to setup-access instead of standard reset
            link = `${baseUrl}/setup-access?accountId=${accountId}&taxId=${taxId || ''}&email=${normalizedEmail}&oobCode=${oobCode}`;
        } else {
            console.log(`[B2B-INVITE] Generating link for EXISTING user: ${normalizedEmail}`);
            // Point to setup-access anyway so they can set their SPECIFIC password for this account
            link = `${baseUrl}/setup-access?accountId=${accountId}&taxId=${taxId || ''}&email=${normalizedEmail}`;
        }

        // 5. Send Email via Resend
        await EmailService.sendEmail({
            from: 'MinReport Access <no-reply@minreport.com>',
            to: normalizedEmail,
            subject: isNewUser
                ? `🔑 Activa tu cuenta para ${companyName || 'MinReport'}`
                : `👋 Fuiste añadido a ${companyName || 'un nuevo equipo'}`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; color: #334155;">
                    <h2 style="color: #4F46E5;">${isNewUser ? 'Bienvenido a MinReport' : 'Has sido añadido a un equipo'}</h2>
                    <p>Hola,</p>
                    <p>Has sido invitado a colaborar en <strong>${companyName || 'MinReport'}</strong>.</p>
                    ${isNewUser
                    ? `<p>Para comenzar, necesitas activar tu cuenta y establecer una contraseña segura.</p>`
                    : `<p>Ya puedes acceder con tu cuenta actual para ver el nuevo espacio de trabajo.</p>`
                }
                    <br />
                    <a href="${link}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                        ${isNewUser ? 'Activar Cuenta' : 'Ingresar a la Plataforma'}
                    </a>
                    <br /><br />
                    <p style="font-size: 12px; color: #94a3b8;">Si no esperabas esta invitación, puedes ignorar este correo.</p>
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
