import admin, { db, auth } from '../config/firebase';
import express, { Request, Response, Router } from 'express';
import { EmailService } from '../services/EmailService';
import { env } from '../config/env';
import { generateSetupToken } from '../utils/security';
import { formatRut } from '../utils/rut';

const router = Router();


/**
 * POST /api/staff/create-worker
 * Crea un trabajador en Firebase Auth y envía email de configuración de contraseña
 * 
 * Este endpoint es llamado por StaffService.recruitWorker() durante el onboarding
 */
router.post('/create-worker', async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        const { email, displayName, run, accountId, accountName } = req.body as { email: string, displayName: string, run: string, accountId: string, accountName: string };

        if (!email || !displayName || !run || !accountId || !accountName) {
            return res.status(400).json({ error: 'Email, nombre, RUN, cuenta y nombre de cuenta son requeridos' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const cleanRun = run.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();

        // Generar Email Sintético para Bypassar Firebase Auth "Email already in use" restricción
        const syntheticAuthEmail = `${cleanRun.toLowerCase()}@auth.minreport.internal`;

        console.log('[Staff API] Creando trabajador (RUT Islado):', { emailReal: normalizedEmail, emailSintetico: syntheticAuthEmail, displayName, accountName, cleanRun });

        // 1. Forzar Creación/Busqueda usando el RUN como UID
        let userRecord;
        let isNewUser = false;
        try {
            userRecord = await auth.getUser(cleanRun);
            console.log('[Staff API] Usuario ya existe con UID(RUN):', userRecord.uid);

            // Sincronizar email sintético si no lo tiene por migración
            if (userRecord.email !== syntheticAuthEmail) {
                await auth.updateUser(cleanRun, { email: syntheticAuthEmail });
            }
        } catch (error: any) {
            if (error.code !== 'auth/user-not-found') {
                throw error;
            }
            // 2. Crear usuario interno en Firebase Auth con UID = RUN y Email Sintético
            userRecord = await auth.createUser({
                uid: cleanRun,
                email: syntheticAuthEmail,
                emailVerified: false,
                displayName: displayName,
                disabled: false
            });
            isNewUser = true;
            console.log('[Staff API] Usuario interno creado con UID:', userRecord.uid, syntheticAuthEmail);
        }

        // 3. Generar token criptográfico para Custom Setup Link
        const { rawToken, hashedToken, expiresAt } = generateSetupToken();

        // 4. Construir link personalizado para setup-access
        const baseUrl = process.env.NODE_ENV === 'production'
            ? 'https://minreport-access.web.app'
            : 'http://localhost:5173';

        const encodedName = encodeURIComponent(displayName || 'Miembro del Equipo');
        const encodedAccountName = encodeURIComponent(accountName);
        const setupLink = `${baseUrl}/setup-access?accountId=${accountId}&taxId=${cleanRun}&name=${encodedName}&accountName=${encodedAccountName}&type=BUSINESS&token=${rawToken}`;

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
                                Has sido añadido como operador activo al sistema para la entidad <strong>${accountName}</strong>. Para habilitar tu ingreso, necesitas configurar tu contraseña de cuenta.
                            </p>

                            <div style="margin-top: 24px; background: white; border: 1px solid #E2E8F0; padding: 16px; border-radius: 4px;">
                                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Entidad Vinculada</p>
                                <p style="margin: 0 0 16px 0; font-size: 16px; color: #0F172A; font-weight: bold;">${accountName}</p>
                                
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

        // [ACTO F] BACKEND PERSISTENCE: Coordinated Writes
        try {
            console.log('[Staff API] Executing structural writes for:', run);
            const batch = db.batch();

            // 1. user_directory (Pasillo de Puertas)
            const userDirRef = db.collection('user_directory').doc(run);
            batch.set(userDirRef, {
                run: run,
                fullName: displayName,
                accounts: admin.firestore.FieldValue.arrayUnion({
                    accountId: accountId,
                    authEmail: normalizedEmail,
                    role: 'OPERATOR',
                    type: 'BUSINESS',
                    accountName: accountName,
                    status: 'PENDING'
                }),
                updatedAt: new Date().toISOString()
            }, { merge: true });

            // 2. user profile (/users) - Atomic but careful with taxId
            const userProfileRef = db.collection('users').doc(userRecord.uid);
            const userProfileSnap = await userProfileRef.get();
            const existingTaxId = userProfileSnap.exists ? userProfileSnap.data()?.taxId : null;

            const membership = {
                accountId: accountId,
                role: 'OPERATOR',
                companyName: accountName,
                joinedAt: Date.now()
            };

            const userUpdate: any = {
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                role: 'USER',
                memberships: admin.firestore.FieldValue.arrayUnion(membership),
                status: 'PENDING',
                updatedAt: Date.now()
            };

            // Solo setear taxId si no existe (y formateado consistentemente)
            if (!existingTaxId) {
                userUpdate.taxId = formatRut(cleanRun);
            }

            batch.set(userProfileRef, userUpdate, { merge: true });

            // 3. account members (/accounts/{id}/members)
            const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid);
            batch.set(memberRef, {
                userId: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                run: formatRut(cleanRun),
                role: 'OPERATOR',
                status: 'PENDING',
                invitedAt: Date.now()
            });

            // 4. Guardar Setup Token
            const tokenRef = db.collection('setup_tokens').doc(rawToken);
            batch.set(tokenRef, {
                accountId,
                taxId: cleanRun,
                hashedToken,
                expiresAt,
                used: false,
                createdAt: Date.now()
            });

            await batch.commit();
            console.log('[Staff API] ✅ Structural integrity writes completed for operator');
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

/**
 * POST /api/staff/designate-admin
 * Designa un Administrador General para una cuenta B2B.
 * Envía invitación y vincula con rol ADMIN.
 */
router.post('/designate-admin', async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        const { email, displayName, run, accountId, accountName } = req.body as { email: string, displayName: string, run: string, accountId: string, accountName: string };

        if (!email || !displayName || !run || !accountId || !accountName) {
            return res.status(400).json({ error: 'Email, nombre, RUN y cuenta son requeridos' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const cleanRun = run.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();

        // Generar Email Sintético para Bypassar Firebase Auth "Email already in use" restricción
        const syntheticAuthEmail = `${cleanRun.toLowerCase()}@auth.minreport.internal`;

        console.log('[Staff API] Designando Administrador General (RUT Islado):', { emailReal: normalizedEmail, emailSintetico: syntheticAuthEmail, accountName, cleanRun });

        // 1. Forzar Creación/Busqueda usando el RUN como UID
        let userRecord;
        let isNewUser = false;
        try {
            userRecord = await auth.getUser(cleanRun);
            console.log('[Staff API] Usuario(Admin) ya existe con UID(RUN):', userRecord.uid);

            if (userRecord.email !== syntheticAuthEmail) {
                await auth.updateUser(cleanRun, { email: syntheticAuthEmail });
            }
        } catch (error: any) {
            if (error.code !== 'auth/user-not-found') throw error;

            userRecord = await auth.createUser({
                uid: cleanRun,
                email: syntheticAuthEmail,
                emailVerified: false,
                displayName: displayName,
                disabled: false
            });
            isNewUser = true;
            console.log('[Staff API] Usuario(Admin) interno creado con UID:', userRecord.uid, syntheticAuthEmail);
        }

        // 2. Generar Custom Setup Token
        const { rawToken, hashedToken, expiresAt } = generateSetupToken();

        const baseUrl = process.env.NODE_ENV === 'production'
            ? 'https://minreport-access.web.app'
            : 'http://localhost:5173';

        const encodedName = encodeURIComponent(displayName);
        const encodedAccountName = encodeURIComponent(accountName);
        const setupLink = `${baseUrl}/setup-access?accountId=${accountId}&taxId=${cleanRun}&name=${encodedName}&accountName=${encodedAccountName}&type=BUSINESS&token=${rawToken}`;

        // 3. Enviar Invitación (Email)
        try {
            await EmailService.sendEmail({
                from: 'MinReport <no-reply@minreport.com>',
                to: normalizedEmail,
                subject: `Designación: Administrador General - ${accountName}`,
                html: `
                    <div style="font-family: 'Arial', sans-serif; max-width: 600px; color: #334155; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <img src="https://minreport-access.web.app/pwa-192x192.png" alt="MINREPORT" style="height: 48px; width: auto;" />
                        </div>
                        
                        <div style="background: #F8FAFC; border-left: 4px solid #C68346; padding: 24px; margin-bottom: 24px;">
                            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #0F172A; text-transform: uppercase; letter-spacing: 0.05em;">
                                Designación de Cargo: Administrador General
                            </p>
                            <p style="margin: 16px 0 0 0; font-size: 15px; line-height: 1.6;">
                                Estimado(a) ${displayName}, has sido formalmente designado como <strong>Administrador General</strong> para gestionar la cuenta corporativa de <strong>${accountName}</strong> en MinReport.
                            </p>
                            
                            <div style="margin-top: 24px; background: white; border: 1px solid #E2E8F0; padding: 16px;">
                                <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748B; text-transform: uppercase; font-weight: bold;">Empresa que designa</p>
                                <p style="margin: 0; font-size: 16px; color: #0F172A; font-weight: bold;">${accountName}</p>
                            </div>
                        </div>

                        <p style="font-size: 14px; line-height: 1.6; color: #475569;">
                            Este cargo te otorga privilegios para gestionar el personal operativo, configurar perfiles de cargo y administrar la seguridad interna de la empresa en la plataforma.
                        </p>

                        <div style="text-align: center; margin: 32px 0;">
                            <a href="${setupLink}" 
                               style="background: #C68346; color: white; padding: 16px 32px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; border-radius: 2px;">
                                Configurar Credenciales de Acceso
                            </a>
                        </div>

                        <p style="font-size: 12px; color: #94A3B8; text-align: center; margin-top: 40px;">
                            Este es un proceso interno de la empresa. Si no reconoces esta designación, contacta al administrador de TI de tu organización.
                        </p>
                    </div>
                `
            });
        } catch (e) {
            console.error('[Staff API] Error enviando email de administrador:', e);
        }

        // 4. Sincronización de Perfil: Coordinated Writes
        try {
            console.log('[Staff API] Executing structural writes for admin:', run);
            const batch = db.batch();

            const membership = {
                accountId: accountId,
                role: 'ADMIN',
                companyName: accountName,
                joinedAt: Date.now()
            };

            // 1. user_directory
            const userDirRef = db.collection('user_directory').doc(run);
            batch.set(userDirRef, {
                run: run,
                fullName: displayName,
                accounts: admin.firestore.FieldValue.arrayUnion({
                    accountId: accountId,
                    authEmail: normalizedEmail,
                    role: 'ADMIN',
                    type: 'BUSINESS',
                    accountName: accountName,
                    status: 'PENDING'
                }),
                updatedAt: new Date().toISOString()
            }, { merge: true });

            // 2. user profile (/users) - Atomic but careful with taxId
            const userProfileRef = db.collection('users').doc(userRecord.uid);
            const userProfileSnap = await userProfileRef.get();
            const existingTaxId = userProfileSnap.exists ? userProfileSnap.data()?.taxId : null;

            const userUpdate: any = {
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                role: 'USER',
                memberships: admin.firestore.FieldValue.arrayUnion(membership),
                status: 'PENDING',
                updatedAt: Date.now()
            };

            if (!existingTaxId) {
                userUpdate.taxId = formatRut(cleanRun);
            }

            batch.set(userProfileRef, userUpdate, { merge: true });

            // 3. account members (/accounts/{id}/members)
            const memberRef = db.collection('accounts').doc(accountId).collection('members').doc(userRecord.uid);
            batch.set(memberRef, {
                userId: userRecord.uid,
                email: normalizedEmail,
                fullName: displayName,
                run: formatRut(cleanRun),
                role: 'ADMIN',
                status: 'PENDING',
                invitedAt: Date.now()
            });

            // 4. Guardar Setup Token
            const tokenRef = db.collection('setup_tokens').doc(rawToken);
            batch.set(tokenRef, {
                accountId,
                taxId: cleanRun,
                hashedToken,
                expiresAt,
                used: false,
                createdAt: Date.now()
            });

            await batch.commit();
            console.log('[Staff API] ✅ Structural integrity writes completed for admin');
        } catch (dirErr) {
            console.error('[Staff API] ⚠️ Failed to force background persistence:', dirErr);
        }

        return res.status(201).json({ uid: userRecord.uid, isNewUser });

    } catch (error: any) {
        console.error('[Staff API] Error designating admin:', error);
        return res.status(500).json({ error: error.message });
    }
});

export default router;
