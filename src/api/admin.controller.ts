import { Request, Response } from 'express';
import { db, auth } from '../config/firebase';
import { Resend } from 'resend';
import { env } from '../config/env';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import https from 'https';

const execAsync = promisify(exec);

const downloadFile = async (url: string, dest: string): Promise<void> => {
    console.log(`[DevOps] Executing download via curl to follow redirects: ${dest}`);
    // -L follows redirects, -o specifies output file, -s is silent but we want errors
    await execAsync(`curl -L "${url}" -o "${dest}"`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 100) {
        throw new Error(`Download failed or file too small: ${dest}`);
    }
};

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
        // Create or get the Super Admin user in Firebase Auth
        let uid = 'super-admin-id';
        try {
            const user = await auth.getUserByEmail(env.SUPER_ADMIN_EMAIL);
            uid = user.uid;
        } catch (e) {
            // If doesn't exist, Create it (though it should exist by script)
            const newUser = await auth.createUser({
                email: env.SUPER_ADMIN_EMAIL,
                password: env.SUPER_ADMIN_PASSWORD,
                displayName: 'Super Admin'
            });
            uid = newUser.uid;
            // Set claims
            await auth.setCustomUserClaims(uid, { role: 'SUPER_ADMIN' });
        }

        // Generate Custom Token for Client SDK
        const firebaseToken = await auth.createCustomToken(uid, { role: 'SUPER_ADMIN' });

        // [NEW] Ensure Super Admin document exists in Firestore for Rule compatibility
        console.log(`[ADMIN] Ensuring Super Admin doc exists for UID: ${uid}`);
        await db.collection('users').doc(uid).set({
            uid,
            email: env.SUPER_ADMIN_EMAIL,
            displayName: 'Super Admin',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log(`[ADMIN] Super Admin doc synced successfully`);

        return res.status(200).json({
            success: true,
            token: 'master-admin-access-token',
            firebaseToken, // Return the custom token
            user: { email: env.SUPER_ADMIN_EMAIL, role: 'super-admin' }
        });
    }

    return res.status(401).json({ error: 'Invalid admin credentials' });
};

export const updateTenantStatus = async (req: Request, res: Response) => {
    console.log('Admin Params received:', req.params);
    const { uid } = req.params;
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

            // 4. Update Firestore with uid and status in tenants
            await tenantRef.update({
                status: 'ACTIVE',
                authUid: userRecord.uid,
                updatedAt: new Date().toISOString()
            });

            // 4.5 Create/Sync User Document in 'users' collection for Admin Management
            // This ensures the user appears in the User Management section
            await db.collection('users').doc(userRecord.uid).set({
                uid: userRecord.uid,
                email: tenantData.email,
                displayName: tenantData.type === 'PERSONAL' ? tenantData.full_name : (tenantData.company_name || tenantData.institution_name),
                role: 'USER', // Default role
                status: 'ACTIVE',
                entitlements: {
                    pluginsEnabled: [], // Start with no plugins by default, or inherit from tenant request if available
                    storageLimit: 1073741824 // 1GB default
                },
                stats: {
                    storageUsed: 0,
                    lastLogin: null
                },
                createdAt: new Date().toISOString(),
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


export const getBrandingSettings = async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('settings').doc('branding').get();
        if (!doc.exists) {
            // Return defaults if not exist
            return res.json({ siteName: 'MinReport', primaryColor: '#000000' });
        }
        res.json(doc.data());
    } catch (error) {
        console.error('Error getting branding settings:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const updateBrandingSettings = async (req: Request, res: Response) => {
    try {
        const settings = req.body;
        await db.collection('settings').doc('branding').set(settings, { merge: true });

        // 🔥 AUTOMATED DEVOPS: Sync icons with local filesystem (Zero-Code Solution)
        // We do this in background to not block the UI
        const syncAssets = async () => {
            try {
                const rootDir = process.cwd();
                const webPublicDir = path.join(rootDir, 'web/public');
                const androidResDir = path.join(rootDir, 'web/android/app/src/main/res');
                console.log(`[DevOps] Sync starting. rootDir: ${rootDir}`);

                // 1. Sync PWA Icons (Web Browser)
                const pwaIconUrl = settings.light?.pwaIcon || settings.dark?.pwaIcon || settings.light?.isotype;
                if (pwaIconUrl) {
                    console.log('[DevOps] Syncing PWA Icons...');
                    const tempIcon = path.join(rootDir, 'temp_pwa_master.png');
                    await downloadFile(pwaIconUrl, tempIcon);

                    // Sync to Web App
                    if (fs.existsSync(webPublicDir)) {
                        await execAsync(`sips -z 192 192 "${tempIcon}" --out "${path.join(webPublicDir, 'pwa-192x192.png')}"`);
                        await execAsync(`sips -z 512 512 "${tempIcon}" --out "${path.join(webPublicDir, 'pwa-512x512.png')}"`);
                        console.log('[DevOps] PWA Icons updated in web/public');
                    }
                    if (fs.existsSync(tempIcon)) fs.unlinkSync(tempIcon);
                }

                // 2. Sync Native Mobile Icons (Android)
                // We prioritize dark.appIcon (White logo) because we set a dark background in colors.xml
                const appIconUrl = settings.dark?.appIcon || settings.light?.appIcon;
                if (appIconUrl && fs.existsSync(androidResDir)) {
                    console.log('[DevOps] Syncing Native Mobile Icons...');
                    const tempAppIcon = path.join(rootDir, 'temp_app_master.png');
                    await downloadFile(appIconUrl, tempAppIcon);

                    const mipmapConfigs = [
                        { dir: 'mipmap-mdpi', size: 48, adaptive: 108 },
                        { dir: 'mipmap-hdpi', size: 72, adaptive: 162 },
                        { dir: 'mipmap-xhdpi', size: 96, adaptive: 216 },
                        { dir: 'mipmap-xxhdpi', size: 144, adaptive: 324 },
                        { dir: 'mipmap-xxxhdpi', size: 192, adaptive: 432 },
                    ];

                    for (const config of mipmapConfigs) {
                        const targetDir = path.join(androidResDir, config.dir);
                        if (fs.existsSync(targetDir)) {
                            // Legacy and Compatibility Icons
                            await execAsync(`sips -z ${config.size} ${config.size} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher.png')}"`);
                            await execAsync(`sips -z ${config.size} ${config.size} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher_round.png')}"`);

                            // 📱 Modern Adaptive Icons Foreground Layer (using 108dp standard)
                            await execAsync(`sips -z ${config.adaptive} ${config.adaptive} "${tempAppIcon}" --out "${path.join(targetDir, 'ic_launcher_foreground.png')}"`);
                        }
                    }
                    console.log('[DevOps] Android Native Icons updated in web/android');
                    if (fs.existsSync(tempAppIcon)) fs.unlinkSync(tempAppIcon);
                }
            } catch (syncErr) {
                console.error('[DevOps Error] Failed to sync assets to local filesystem:', syncErr);
            }
        };

        syncAssets(); // Runs in background

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating branding settings:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};
