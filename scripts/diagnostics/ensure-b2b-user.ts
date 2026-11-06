import * as admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

function assertSafeScriptEnvironment(): void {
    const isEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
    if (!isEmulator && process.env.CONFIRM_PRODUCTION_SCRIPT !== 'ACTUALIZAR') {
        console.error(
            '[ABORTADO] Ejecución fuera del Auth Emulator bloqueada. Defina FIREBASE_AUTH_EMULATOR_HOST o establezca CONFIRM_PRODUCTION_SCRIPT=ACTUALIZAR.'
        );
        process.exit(1);
    }
}

assertSafeScriptEnvironment();

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: process.env.GCP_PROJECT_ID || 'minreport-8f2a8',
    });
}

const ensureUser = async (email: string, password: string): Promise<void> => {
    try {
        const user = await admin.auth().getUserByEmail(email);
        console.log(`[ENSURE-USER] Usuario existente ${email} (UID: ${user.uid}). Actualizando credencial...`);
        await admin.auth().updateUser(user.uid, { password, emailVerified: true });
        console.log(`[ENSURE-USER] Credencial actualizada para ${email} (secreto omitido de consola).`);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            const newUser = await admin.auth().createUser({
                email,
                password,
                emailVerified: true,
            });
            console.log(`[ENSURE-USER] Usuario creado ${email} (UID: ${newUser.uid}).`);
        } else {
            throw error;
        }
    }
};

const targetEmail = (process.env.TARGET_USER_EMAIL || '').trim().toLowerCase();
const targetPassword = (process.env.TARGET_USER_PASSWORD || '').trim();

if (!targetEmail || !targetPassword || targetPassword.length < 10) {
    console.error(
        '[ENSURE-USER] Defina TARGET_USER_EMAIL y TARGET_USER_PASSWORD (mínimo 10 caracteres) en variables de entorno. Cero contraseñas hardcodeadas.'
    );
    process.exit(1);
}

ensureUser(targetEmail, targetPassword)
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[ENSURE-USER] Error:', err.message || err);
        process.exit(1);
    });
