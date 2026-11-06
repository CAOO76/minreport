import { resolveDevRootPassword } from '../config/secrets';

export const DEV_ROOT_EMAIL = 'dev@minreport.com';
export const DEV_ROOT_UID = 'dev-master-root-uid';

/**
 * LISTA BLANCA SOBERANA DE IDENTIDADES PROTEGIDAS (ANTI-PURGA)
 * Ningún proceso de eliminación o limpieza de cuentas puede tocar estos UIDs.
 */
export const PROTECTED_SYSTEM_UIDS = new Set<string>([
    DEV_ROOT_UID,
    'super-admin-uid',
    'super-admin-id',
    'dev-test-client-uid',
    'dev-master-sandbox'
]);

export const isProtectedSystemAccount = (identifier?: string | null): boolean => {
    if (!identifier) return false;
    const cleanId = identifier.trim().toLowerCase();
    if (PROTECTED_SYSTEM_UIDS.has(identifier)) return true;
    if (cleanId === DEV_ROOT_EMAIL.toLowerCase()) return true;
    if (cleanId === 'superadmin@local.test' || cleanId === 'superadmin@company.com') return true;
    return false;
};

/**
 * Bootstrapping determinista e idempotente de la Cuenta Maestra DEV.
 * Se ejecuta automáticamente en el arranque del servidor.
 * Nunca imprime credenciales ni contraseñas en consola.
 */
export const ensureDevRootAccount = async (): Promise<void> => {
    const { auth, db } = await import('../config/firebase');
    console.log('[BOOTSTRAP] Verificando cuenta maestra DEV...');

    const password = (await resolveDevRootPassword())?.trim() || '';
    if (!password) {
        console.warn('[BOOTSTRAP] DEV_ROOT_PASSWORD no configurado en Secret Manager / entorno. Omitiendo aprovisionamiento de contraseña.');
        return;
    }

    let userRecord;
    const MAX_RETRIES = 60;
    let retries = MAX_RETRIES;

    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const [authPing, dbPing] = await Promise.all([
                    fetch(`http://${authHost}/`),
                    fetch(`http://${firestoreHost}/`)
                ]);
                if (authPing.ok || authPing.status < 500) {
                    if (dbPing.ok || dbPing.status < 500) {
                        break;
                    }
                }
            } catch {
                // Emuladores aún iniciando o importando ./data
            }
            if (attempt === 1 || attempt % 5 === 0) {
                console.log(`[BOOTSTRAP] Esperando disponibilidad de emuladores Auth/Firestore (${attempt}/${MAX_RETRIES})...`);
            }
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    while (retries > 0) {
        try {
            userRecord = await auth.getUser(DEV_ROOT_UID);
            console.log(`[BOOTSTRAP] Cuenta DEV encontrada por UID: ${DEV_ROOT_UID}`);
            break;
        } catch (err: any) {
            const errMsg = String(err?.message || '');
            const errCode = String(err?.code || '');
            const isNetworkRetryable =
                errCode === 'ECONNREFUSED' ||
                errCode === 'ECONNRESET' ||
                errCode === 'app/network-error' ||
                errMsg.includes('ECONNREFUSED') ||
                errMsg.includes('ECONNRESET') ||
                errMsg.includes('socket hang up') ||
                errMsg.includes('fetch failed');

            if (errCode === 'auth/user-not-found') {
                try {
                    const existingByEmail = await auth.getUserByEmail(DEV_ROOT_EMAIL);
                    userRecord = existingByEmail;
                    console.log(`[BOOTSTRAP] Cuenta DEV existente alineada (${existingByEmail.uid}).`);
                    break;
                } catch (emailErr: any) {
                    if (emailErr.code === 'auth/user-not-found') {
                        userRecord = await auth.createUser({
                            uid: DEV_ROOT_UID,
                            email: DEV_ROOT_EMAIL,
                            password,
                            displayName: 'MINREPORT DEV ROOT',
                            emailVerified: true,
                            disabled: false
                        });
                        console.log(`[BOOTSTRAP] Cuenta DEV creada determinísticamente con UID: ${DEV_ROOT_UID}`);
                        break;
                    } else {
                        throw emailErr;
                    }
                }
            } else if (isNetworkRetryable) {
                retries--;
                if (retries === 0) {
                    console.warn('[BOOTSTRAP] Emulador de Auth aún no disponible tras reintentos.');
                    return;
                }
                await new Promise(res => setTimeout(res, 2000));
            } else {
                console.error('[BOOTSTRAP] Error consultando Auth para cuenta DEV:', errCode || errMsg);
                return;
            }
        }
    }

    const activeUid = userRecord?.uid || DEV_ROOT_UID;

    await auth.setCustomUserClaims(activeUid, {
        role: 'DEV_ROOT',
        accountTier: 1,
        classification: 'dev-root',
        isMasterDev: true,
        suiteAccess: true
    });

    await db.collection('users').doc(activeUid).set({
        uid: activeUid,
        email: DEV_ROOT_EMAIL,
        displayName: 'MINREPORT DEV ROOT',
        role: 'DEV_ROOT',
        accountTier: 1,
        status: 'ACTIVE',
        classification: 'dev-root',
        entitlements: {
            pluginsEnabled: ['opermaq', 'stockpile'],
            allAccess: true,
            canImpersonate: true,
            canManageTestPilots: true
        },
        memberships: [
            {
                accountId: 'dev-master-sandbox',
                role: 'DEV_ROOT',
                companyName: 'MINREPORT CORE SYSTEM',
                joinedAt: Date.now()
            }
        ],
        updatedAt: Date.now()
    }, { merge: true });

    await db.collection('accounts').doc('dev-master-sandbox').set({
        id: 'dev-master-sandbox',
        name: 'MINREPORT CORE SYSTEM',
        classification: 'dev-root',
        ownerId: activeUid,
        status: 'ACTIVE',
        licensing: {
            maxUsers: 9999,
            allowInternalUsers: true,
            isCommercial: false,
            watermarkRequired: false
        },
        enabledPlugins: ['opermaq', 'stockpile'],
        createdAt: Date.now(),
        updatedAt: Date.now()
    }, { merge: true });

    console.log('[BOOTSTRAP] Cuenta DEV y Workspace Sandbox asegurados.');
};
