import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

/**
 * Aprovisionador Idempotente para Emuladores E2E de MINREPORT.
 *
 * Cumplimiento estricto GEMINI.md §1 y §1.1:
 * - Prohibido reiniciar o eliminar colecciones de bases de datos o usuarios existentes.
 * - Exclusivo para entorno de emuladores locales (bloqueado contra produccion).
 * - Cero credenciales hardcodeadas y cero cuentas PERSONAL o plugins legacy.
 * - Soporta las 5 Cuentas Soberanas: DEV_ROOT, SUPER_ADMIN, TEST_PILOT, B2B, EDUCATIONAL.
 */

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9190';

if (!firestoreHost.includes('127.0.0.1') && !firestoreHost.includes('localhost')) {
    throw new Error('[SECURITY] db-seeder.ts solo puede ejecutarse contra emuladores locales.');
}

process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'minreport-8f2a8' });
}

const db = admin.firestore();
const auth = admin.auth();

function resolveTestPassword(envVarName: string): string {
    return process.env[envVarName] || crypto.randomBytes(18).toString('base64url');
}

async function ensureAuthUser(params: {
    uid: string;
    email: string;
    displayName: string;
    passwordEnv: string;
    claims: Record<string, unknown>;
}): Promise<void> {
    try {
        await auth.getUser(params.uid);
    } catch (error: any) {
        if (error?.code === 'auth/user-not-found') {
            await auth.createUser({
                uid: params.uid,
                email: params.email,
                password: resolveTestPassword(params.passwordEnv),
                displayName: params.displayName,
                emailVerified: true,
            });
        } else {
            throw error;
        }
    }
    await auth.setCustomUserClaims(params.uid, params.claims);
}

export async function seedModulesStatus(): Promise<void> {
    const nowIso = new Date().toISOString();
    await Promise.all([
        db.collection('modules_status').doc('opermaq').set(
            { id: 'opermaq', enabled: true, updatedAt: nowIso },
            { merge: true }
        ),
        db.collection('modules_status').doc('stockpile').set(
            { id: 'stockpile', enabled: true, updatedAt: nowIso },
            { merge: true }
        ),
    ]);
}

export async function seedSuperAdmin(): Promise<void> {
    await ensureAuthUser({
        uid: 'super-admin-uid',
        email: 'admin@minreport.com',
        displayName: 'Super Admin MINREPORT',
        passwordEnv: 'E2E_SUPER_ADMIN_PASSWORD',
        claims: { role: 'SUPER_ADMIN' },
    });

    await db.collection('users').doc('super-admin-uid').set(
        {
            uid: 'super-admin-uid',
            email: 'admin@minreport.com',
            displayName: 'Super Admin MINREPORT',
            role: 'SUPER_ADMIN',
            updatedAt: Date.now(),
        },
        { merge: true }
    );
}

export async function seedTestPilot(): Promise<void> {
    const pilotTenantId = 'pilot-sandbox-faena';
    const pilotUid = 'test-pilot-lead-uid';

    await ensureAuthUser({
        uid: pilotUid,
        email: 'pilot@minreport.com',
        displayName: 'Especialista Test-Pilot',
        passwordEnv: 'E2E_TEST_PILOT_PASSWORD',
        claims: { role: 'PILOT_LEAD', tenantId: pilotTenantId },
    });

    await db.collection('accounts').doc(pilotTenantId).set(
        {
            id: pilotTenantId,
            name: 'Simulacion Operacional TEST-PILOT',
            type: 'TEST_PILOT',
            ownerId: pilotUid,
            enabledModules: ['opermaq', 'stockpile'],
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection(`accounts/${pilotTenantId}/members`).doc(pilotUid).set(
        {
            userId: pilotUid,
            email: 'pilot@minreport.com',
            fullName: 'Especialista Test-Pilot',
            role: 'PILOT_LEAD',
            status: 'ACTIVE',
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection('users').doc(pilotUid).set(
        {
            uid: pilotUid,
            email: 'pilot@minreport.com',
            displayName: 'Especialista Test-Pilot',
            role: 'PILOT_LEAD',
            accountType: 'TEST_PILOT',
            tenantId: pilotTenantId,
            updatedAt: Date.now(),
        },
        { merge: true }
    );
}

export async function seedB2BAccount(): Promise<void> {
    const accountId = 'minera-abc-id';
    const ownerUid = 'enterprise-owner-uid';
    const workerUid = 'worker-user-uid';

    await ensureAuthUser({
        uid: ownerUid,
        email: 'admin@minera-abc.cl',
        displayName: 'Juan Perez',
        passwordEnv: 'E2E_B2B_OWNER_PASSWORD',
        claims: { role: 'COMPANY_ADMIN', tenantId: accountId },
    });

    await ensureAuthUser({
        uid: workerUid,
        email: 'pedro.soto@minera-abc.cl',
        displayName: 'Pedro Soto',
        passwordEnv: 'E2E_B2B_WORKER_PASSWORD',
        claims: { role: 'OPERATOR', tenantId: accountId },
    });

    await db.collection('accounts').doc(accountId).set(
        {
            id: accountId,
            name: 'Minera ABC S.A.',
            type: 'B2B',
            taxId: '76.123.456-7',
            ownerId: ownerUid,
            enabledModules: ['stockpile', 'opermaq'],
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection(`accounts/${accountId}/members`).doc(ownerUid).set(
        {
            userId: ownerUid,
            email: 'admin@minera-abc.cl',
            fullName: 'Juan Perez',
            run: '761234567',
            role: 'OWNER',
            status: 'ACTIVE',
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection(`accounts/${accountId}/members`).doc(workerUid).set(
        {
            userId: workerUid,
            email: 'pedro.soto@minera-abc.cl',
            fullName: 'Pedro Soto',
            run: '198765432',
            role: 'OPERATOR',
            status: 'ACTIVE',
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection('users').doc(ownerUid).set(
        {
            uid: ownerUid,
            email: 'admin@minera-abc.cl',
            taxId: '76.123.456-7',
            displayName: 'Juan Perez',
            role: 'COMPANY_ADMIN',
            accountType: 'B2B',
            tenantId: accountId,
            memberships: [
                {
                    accountId,
                    role: 'OWNER',
                    companyName: 'Minera ABC S.A.',
                    joinedAt: Date.now(),
                },
            ],
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection('users').doc(workerUid).set(
        {
            uid: workerUid,
            email: 'pedro.soto@minera-abc.cl',
            taxId: '19.876.543-2',
            displayName: 'Pedro Soto',
            role: 'OPERATOR',
            accountType: 'B2B',
            tenantId: accountId,
            memberships: [
                {
                    accountId,
                    role: 'OPERATOR',
                    companyName: 'Minera ABC S.A.',
                    joinedAt: Date.now(),
                },
            ],
            updatedAt: Date.now(),
        },
        { merge: true }
    );
}

export async function seedEducationalAccount(): Promise<void> {
    const accountId = 'uchile-edu-sandbox';
    const userUid = 'edu-student-uid';

    await ensureAuthUser({
        uid: userUid,
        email: 'estudiante@uchile.cl',
        displayName: 'Maria Gonzalez',
        passwordEnv: 'E2E_EDU_PASSWORD',
        claims: { role: 'ACADEMIC_STUDENT', tenantId: accountId, isEduSandbox: true },
    });

    await db.collection('accounts').doc(accountId).set(
        {
            id: accountId,
            name: 'Universidad de Chile - Sandbox Mineria',
            type: 'EDUCATIONAL',
            isEduSandbox: true,
            taxId: '18.765.432-1',
            ownerId: userUid,
            enabledModules: ['stockpile', 'opermaq'],
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection(`accounts/${accountId}/members`).doc(userUid).set(
        {
            userId: userUid,
            email: 'estudiante@uchile.cl',
            fullName: 'Maria Gonzalez',
            run: '187654321',
            role: 'ACADEMIC_STUDENT',
            status: 'ACTIVE',
            isEduSandbox: true,
            updatedAt: Date.now(),
        },
        { merge: true }
    );

    await db.collection('users').doc(userUid).set(
        {
            uid: userUid,
            email: 'estudiante@uchile.cl',
            taxId: '18.765.432-1',
            displayName: 'Maria Gonzalez',
            role: 'ACADEMIC_STUDENT',
            accountType: 'EDUCATIONAL',
            isEduSandbox: true,
            tenantId: accountId,
            memberships: [
                {
                    accountId,
                    role: 'ACADEMIC_STUDENT',
                    companyName: 'Universidad de Chile - Sandbox Mineria',
                    joinedAt: Date.now(),
                },
            ],
            updatedAt: Date.now(),
        },
        { merge: true }
    );
}

async function main() {
    try {
        console.log('[DB Seeder] Iniciando aprovisionamiento idempotente (sin eliminacion de datos)...');
        await seedModulesStatus();
        await seedSuperAdmin();
        await seedTestPilot();
        await seedB2BAccount();
        await seedEducationalAccount();
        console.log('[DB Seeder] Aprovisionamiento completado.');
        process.exit(0);
    } catch (error) {
        console.error('[DB Seeder] Error en aprovisionamiento:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
