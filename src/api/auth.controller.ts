import { Request, Response } from 'express';
import { Resend } from 'resend';
import admin, { db, auth } from '../config/firebase';
import { registerSchema } from '../core/schemas';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

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
            await resend.emails.send({
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

// [NEW] Invitation B2B Logic
export const inviteUser = async (req: Request, res: Response) => {
    try {
        const { email, accountId, companyName } = req.body;

        if (!email || !accountId) {
            return res.status(400).json({ error: 'Email and Account ID are required' });
        }

        const normalizedEmail = email.toLowerCase();
        let link = '';
        let isNewUser = false;
        let userRecord;

        // 1. Check if User Exists
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
            // User exists: Just notify them
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                // User does NOT exist: Create placeholder + Reset Link
                isNewUser = true;
                userRecord = await auth.createUser({
                    email: normalizedEmail,
                    emailVerified: true, // Auto-verify since we are inviting them
                    disabled: false
                });
            } else {
                throw error;
            }
        }

        // 2. Generate Activation Link (Only for new users or if requested)
        // For existing users, they just login. For new users, they need to set password.
        if (isNewUser) {
            const rawLink = await auth.generatePasswordResetLink(normalizedEmail);
            // In prod: map to custom domain
            const baseUrl = process.env.NODE_ENV === 'production'
                ? 'https://minreport-access.web.app'
                : 'http://localhost:5173';

            // Extract oobCode and construct nice link
            const url = new URL(rawLink);
            const oobCode = url.searchParams.get('oobCode');
            link = `${baseUrl}/auth/action?mode=resetPassword&oobCode=${oobCode}&email=${normalizedEmail}`;
        } else {
            link = process.env.NODE_ENV === 'production'
                ? 'https://minreport-access.web.app/login'
                : 'http://localhost:5173/login';
        }

        // 3. Send Email via Resend
        await resend.emails.send({
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
