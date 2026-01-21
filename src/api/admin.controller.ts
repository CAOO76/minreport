import { Request, Response } from 'express';
import { db, auth } from '../config/firebase';
import { Resend } from 'resend';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

export const listTenants = async (req: Request, res: Response) => {
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

export const adminLogin = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (email === env.SUPER_ADMIN_EMAIL && password === env.SUPER_ADMIN_PASSWORD) {
        return res.status(200).json({
            success: true,
            token: 'master-admin-access-token',
            user: { email: env.SUPER_ADMIN_EMAIL, role: 'super-admin' }
        });
    }

    return res.status(401).json({ error: 'Invalid admin credentials' });
};

export const updateTenantStatus = async (req: Request, res: Response) => {
    const { uid } = req.params; // In the new flow, this is the email
    const { status, rejectionReason } = req.body;

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

        if (status === 'ACTIVE') {
            // Check if user already exists in Auth to prevent duplication
            let userRecord;
            try {
                userRecord = await auth.getUserByEmail(tenantData.email);
            } catch (authError: any) {
                if (authError.code === 'auth/user-not-found') {
                    // 1. Create User in Firebase Auth
                    userRecord = await auth.createUser({
                        email: tenantData.email,
                        emailVerified: true,
                        displayName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                        disabled: false
                    });
                } else {
                    throw authError;
                }
            }

            // 2. Set Custom Claims
            await auth.setCustomUserClaims(userRecord.uid, {
                role: 'admin',
                tier: tenantData.type,
                tenantId: userRecord.uid
            });

            // 3. Generate "Magic" Activation Link (Password Reset)
            const rawLink = await auth.generatePasswordResetLink(tenantData.email);

            // Extract oobCode from the raw Firebase link
            const url = new URL(rawLink);
            const oobCode = url.searchParams.get('oobCode');

            // Construct custom activation URL
            // In dev: http://localhost:5173/auth/action
            // In prod: should use the public domain
            const baseUrl = process.env.NODE_ENV === 'production'
                ? 'https://minreport-access.web.app'
                : 'http://localhost:5173';

            const actionLink = `${baseUrl}/auth/action?mode=resetPassword&oobCode=${oobCode}`;

            // 4. Update Firestore with uid and status
            await tenantRef.update({
                status: 'ACTIVE',
                authUid: userRecord.uid,
                updatedAt: new Date().toISOString()
            });

            // 5. Notify Success with Professional Template
            await resend.emails.send({
                from: 'MinReport <ops@minreport.com>',
                to: tenantData.email,
                subject: '¡Bienvenido a MinReport! Activa tu cuenta',
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #f1f5f9; padding: 40px; border-radius: 16px; color: #334155;">
                        <h1 style="color: #4F46E5; margin-bottom: 8px;">¡Bienvenido a MinReport!</h1>
                        <p style="font-size: 16px; line-height: 1.6;">Hola, tu solicitud ha sido aprobada con éxito. Estamos emocionados de tenerte a bordo.</p>
                        <p style="font-size: 16px; line-height: 1.6;">Para comenzar, debes configurar tu contraseña y activar tu acceso haciendo clic en el siguiente botón:</p>
                        
                        <div style="text-align: center; margin: 32px 0;">
                            <a href="${actionLink}" style="background: #4F46E5; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block;">Activar Mi Cuenta</a>
                        </div>
                        
                        <p style="font-size: 14px; color: #64748b;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                        <p style="font-size: 12px; word-break: break-all; color: #4F46E5;">${actionLink}</p>
                        
                        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 32px 0;" />
                        <p style="font-size: 12px; color: #94a3b8; text-align: center;">Este es un mensaje automático del sistema de operaciones de MINREPORT.</p>
                    </div>
                `
            });
        } else {
            // 1. Update Firestore to REJECTED
            await tenantRef.update({
                status: 'REJECTED',
                rejectionReason: rejectionReason || 'No cumple con los requisitos mínimos',
                updatedAt: new Date().toISOString()
            });

            // 2. Notify Rejection
            await resend.emails.send({
                from: 'MinReport <ops@minreport.com>',
                to: tenantData.email,
                subject: 'Estado de tu solicitud en MinReport',
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #f1f5f9; padding: 40px; border-radius: 16px; color: #334155;">
                        <h2 style="color: #64748b;">Estado de tu Solicitud</h2>
                        <p style="font-size: 16px; line-height: 1.6;">Lamentamos informarte que tu solicitud de acceso a MinReport no ha sido aprobada en esta ocasión.</p>
                        <p><strong>Motivo:</strong> ${rejectionReason || 'La documentación proporcionada no ha podido ser validada conforme a nuestras políticas actuales.'}</p>
                        <p style="font-size: 16px; line-height: 1.6;">Puedes volver a postular en el futuro si tu situación cambia o si cuentas con más información comercial.</p>
                        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 32px 0;" />
                        <p style="font-size: 12px; color: #94a3b8; text-align: center;">MINREPORT Operations Security</p>
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
