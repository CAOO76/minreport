import { Request, Response } from 'express';
import { Resend } from 'resend';
import admin, { db } from '../config/firebase';
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
            
            if (idValue) {
                const querySnapshot = await db.collection('tenants').where(idField, '==', idValue).get();
                if (!querySnapshot.empty) {
                    return res.status(409).json({ error: `El ${idField.toUpperCase()} ya está registrado` });
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
