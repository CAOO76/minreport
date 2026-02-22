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
        let isNewUser = false;
        try {
            userRecord = await auth.getUserByEmail(normalizedEmail);
            console.log('[Staff API] Usuario ya existe:', userRecord.uid);
        } catch (error: any) {
            if (error.code !== 'auth/user-not-found') {
                throw error;
            }
            // 2. Crear usuario en Firebase Auth if not exists
            userRecord = await auth.createUser({
                email: normalizedEmail,
                emailVerified: false,
                displayName: displayName,
                disabled: false
            });
            isNewUser = true;
            console.log('[Staff API] Usuario creado con UID:', userRecord.uid);
        }

        // 3. Generar link de configuración de contraseña
        const rawLink = await auth.generatePasswordResetLink(normalizedEmail);
        const url = new URL(rawLink);
        const oobCode = url.searchParams.get('oobCode');

        // 4. Construir link personalizado para setup-access
        const baseUrl = process.env.NODE_ENV === 'production'
            ? 'https://minreport-access.web.app'
            : 'http://localhost:5173';

        const encodedName = encodeURIComponent(displayName || 'Miembro del Equipo');
        const setupLink = `${baseUrl}/setup-access?accountId=${accountId}&email=${normalizedEmail}&name=${encodedName}&type=BUSINESS&oobCode=${oobCode}`;

        // 5. Enviar email de bienvenida con RESEND
        try {
            await EmailService.sendEmail({
                from: 'MinReport Onboarding <no-reply@minreport.com>',
                to: normalizedEmail,
                subject: 'Configuración de Acceso Operativo',
                html: `
                    <div style="font-family: 'Arial', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <img src="https://minreport-access.web.app/pwa-192x192.png" alt="MINREPORT" style="height: 48px; width: auto; opacity: 0.9;" />
                        </div>
                        
                        <div style="background: #F8FAFC; border-left: 4px solid #0F172A; padding: 24px; border-radius: 0px; margin-bottom: 24px;">
                            <p style="margin: 0; font-size: 16px; line-height: 1.6; font-weight: bold; color: #0F172A; text-transform: uppercase;">
                                ONBOARDING: ${displayName}
                            </p>
                            <p style="margin: 12px 0 0 0; font-size: 15px; line-height: 1.6;">
                                Has sido añadido como operador activo al sistema. Para habilitar tu ingreso, necesitas configurar tu contraseña de cuenta.
                            </p>

                            <div style="margin-top: 24px; background: white; border: 1px solid #E2E8F0; padding: 16px; border-radius: 4px;">
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Operador Destino</p>
                                <p style="margin: 0 0 16px 0; font-size: 16px; color: #0F172A; font-weight: bold;">${displayName}</p>
                                
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Correo Asociado</p>
                                <p style="margin: 0 0 16px 0; font-size: 14px; color: #0F172A;">${normalizedEmail}</p>
                                
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Tipo de Entorno</p>
                                <p style="margin: 0; font-size: 14px; color: #0F172A;">Operación Corporativa (BUSINESS)</p>
                            </div>
                            
                            <p style="margin: 24px 0 0 0; font-size: 15px; line-height: 1.6;">
                                Por seguridad, deberás verificar tu identidad ingresando tu documento principal antes de establecer tu contraseña exclusiva de acceso.
                            </p>
                        </div>

                        <div style="text-align: center; margin: 32px 0;">
                            <a href="${setupLink}" 
                               style="background: #0F172A; 
                                      color: white; 
                                      padding: 16px 32px; 
                                      text-decoration: none; 
                                      font-weight: bold; 
                                      display: inline-block;
                                      font-size: 14px;
                                      text-transform: uppercase;
                                      letter-spacing: 0.1em;
                                      border-radius: 2px;">
                                Configurar Credenciales
                            </a>
                        </div>

                        <div style="background: #FFFBEB; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 0px; margin-top: 24px;">
                            <p style="margin: 0; font-size: 14px; color: #92400E;">
                                <strong>IMPORTANTE:</strong> Este enlace de seguridad expira en 24 horas por políticas de acceso.
                            </p>
                        </div>

                        <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0;" />

                        <p style="font-size: 10px; color: #94A3B8; text-align: center; margin: 0; text-transform: uppercase; letter-spacing: 0.1em;">
                            MINREPORT SECURITY INFRASTRUCTURE
                        </p>
                    </div>
                `
            });

            console.log('[Staff API] Email de bienvenida enviado a:', normalizedEmail);
        } catch (emailError) {
            console.error('[Staff API] Error al enviar email:', emailError);
        }

        // [ACTO F] BACKEND PERSISTENCE: Ensure user is findable in user_directory
        // AND has a valid profile in /users
        try {
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
                    accountName: 'Minera ABC S.A.' // Fallback
                }),
                accountId: accountId, // Added for security context consistency
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('[Staff API] Syncing user profile in /users for UID:', userRecord.uid);
            const userProfileRef = db.collection('users').doc(userRecord.uid);
            const userProfileSnap = await userProfileRef.get();

            const membership = {
                accountId: accountId,
                role: 'OPERATOR',
                companyName: 'Minera ABC S.A.',
                joinedAt: Date.now()
            };

            if (!userProfileSnap.exists) {
                // Create profile if new
                await userProfileRef.set({
                    uid: userRecord.uid,
                    email: normalizedEmail,
                    taxId: run,
                    fullName: displayName,
                    role: 'USER',
                    memberships: [membership],
                    status: 'PENDING',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            } else {
                // Update memberships if existing
                await userProfileRef.update({
                    memberships: admin.firestore.FieldValue.arrayUnion(membership),
                    updatedAt: Date.now()
                });
            }

            console.log('[Staff API] ✅ user_directory and user profile forced successfully');
        } catch (dirErr) {
            console.error('[Staff API] ⚠️ Failed to force background persistence:', dirErr);
        }

        return res.status(201).json({
            uid: userRecord.uid,
            isNewUser: isNewUser,
            message: isNewUser ? 'Usuario creado y email de configuración enviado' : 'Vínculo actualizado y email de acceso enviado'
        });

    } catch (error: any) {
        console.error('[Staff API] Error al crear trabajador:', error);
        return res.status(500).json({
            error: error.message || 'Error al crear trabajador'
        });
    }
});

export default router;
