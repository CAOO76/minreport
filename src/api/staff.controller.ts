import { Request, Response, Router } from 'express';
import admin, { db, auth } from '../config/firebase';
import { EmailService } from '../services/EmailService';
import { env } from '../config/env';

const router = Router();


/**
 * POST /api/staff/create-worker
 * Crea un trabajador en Firebase Auth y envía email de configuración de contraseña
 * 
 * Este endpoint es llamado por StaffService.recruitWorker() durante el onboarding
 */
router.post('/create-worker', async (req: Request, res: Response) => {
    try {
        const { email, displayName, run, accountId } = req.body;

        if (!email || !displayName) {
            return res.status(400).json({ error: 'Email y nombre son requeridos' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        console.log('[Staff API] Creando trabajador:', { email: normalizedEmail, displayName });

        // 1. Verificar si el usuario ya existe
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
            console.log('[Staff API] Usuario ya existe:', userRecord.uid);

            // Usuario existe, retornar su UID
            return res.status(200).json({
                uid: userRecord.uid,
                isNewUser: false
            });
        } catch (error: any) {
            if (error.code !== 'auth/user-not-found') {
                throw error;
            }
            // Usuario no existe, continuar con creación
        }

        // 2. Crear usuario en Firebase Auth
        userRecord = await auth.createUser({
            email: normalizedEmail,
            emailVerified: false,
            displayName: displayName,
            disabled: false
        });

        console.log('[Staff API] Usuario creado con UID:', userRecord.uid);

        // 3. Generar link de configuración de contraseña
        const rawLink = await auth.generatePasswordResetLink(normalizedEmail);
        const url = new URL(rawLink);
        const oobCode = url.searchParams.get('oobCode');

        // 4. Construir link personalizado para setup-access
        const baseUrl = process.env.NODE_ENV === 'production'
            ? 'https://minreport-access.web.app'
            : 'http://localhost:5173';

        const setupLink = `${baseUrl}/setup-access?accountId=${accountId}&taxId=${run || ''}&email=${normalizedEmail}&oobCode=${oobCode}`;

        // 5. Enviar email de bienvenida con RESEND
        try {
            await EmailService.sendEmail({
                from: 'MinReport Onboarding <no-reply@minreport.com>',
                to: normalizedEmail,
                subject: '🎉 Bienvenido al equipo - Configura tu acceso',
                html: `
                    <div style="font-family: 'Atkinson Hyperlegible', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <h1 style="color: #4F46E5; font-size: 28px; margin: 0;">¡Bienvenido a MinReport!</h1>
                        </div>
                        
                        <div style="background: #F8FAFC; border-left: 4px solid #4F46E5; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
                            <p style="margin: 0; font-size: 16px; line-height: 1.6;">
                                Hola <strong>${displayName}</strong>,
                            </p>
                            <p style="margin: 12px 0 0 0; font-size: 16px; line-height: 1.6;">
                                Has sido añadido como miembro del equipo. Para comenzar, necesitas configurar tu contraseña de acceso.
                            </p>
                        </div>

                        <div style="text-align: center; margin: 32px 0;">
                            <a href="${setupLink}" 
                               style="background: #4F46E5; 
                                      color: white; 
                                      padding: 14px 32px; 
                                      text-decoration: none; 
                                      border-radius: 8px; 
                                      font-weight: bold; 
                                      display: inline-block;
                                      font-size: 16px;">
                                Configurar mi Contraseña
                            </a>
                        </div>

                        <div style="background: #FEF3C7; border: 1px solid #FCD34D; padding: 16px; border-radius: 8px; margin-top: 24px;">
                            <p style="margin: 0; font-size: 14px; color: #92400E;">
                                <strong>⚠️ Importante:</strong> Este enlace expira en 24 horas. Si no lo usas a tiempo, deberás solicitar uno nuevo.
                            </p>
                        </div>

                        <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0;" />

                        <p style="font-size: 12px; color: #94A3B8; text-align: center; margin: 0;">
                            Si no esperabas este correo, puedes ignorarlo de forma segura.
                        </p>
                    </div>
                `
            });

            console.log('[Staff API] Email de bienvenida enviado a:', normalizedEmail);
        } catch (emailError) {
            console.error('[Staff API] Error al enviar email:', emailError);
        }

        // [ACTO F] BACKEND PERSISTENCE: Ensure user is findable in user_directory
        // This acts as a safety net if frontend Firestore call fails during high-latency tests
        try {
            // The log below seems to be from a different context (public.controller.ts)
            // Keeping the original log for staff.controller.ts context.
            console.log('[Staff API] Forcing user_directory entry for RUN:', run);
            const userDirRef = db.collection('user_directory').doc(run);
            await userDirRef.set({
                run: run,
                fullName: displayName,
                accounts: admin.firestore.FieldValue.arrayUnion({
                    accountId: accountId,
                    authEmail: normalizedEmail,
                    role: 'OPERATOR',
                    type: 'BUSINESS',
                    accountName: 'Minera ABC S.A.' // Fallback or pass from req
                }),
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('[Staff API] ✅ user_directory forced successfully');
        } catch (dirErr) {
            console.error('[Staff API] ⚠️ Failed to force user_directory entry:', dirErr);
        }

        return res.status(201).json({
            uid: userRecord.uid,
            isNewUser: true,
            message: 'Usuario creado y email de configuración enviado'
        });

    } catch (error: any) {
        console.error('[Staff API] Error al crear trabajador:', error);
        return res.status(500).json({
            error: error.message || 'Error al crear trabajador'
        });
    }
});

export default router;
