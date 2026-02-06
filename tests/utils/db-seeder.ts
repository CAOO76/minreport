import * as admin from 'firebase-admin';
import * as path from 'path';

/**
 * Database Seeder for E2E Tests
 * 
 * Populates Firebase Emulators with test data:
 * - Super Admin user
 * - Test accounts (ENTERPRISE, EDUCATIONAL, PERSONAL)
 * - Plugins
 * - Job Profiles
 * - Workers
 */

// Point to emulators (MUST be set before initializeApp)
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';

const serviceAccount = require(path.resolve(__dirname, '../../service-account-key.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'minreport-8f2a8'
});

const db = admin.firestore();
const auth = admin.auth();

/**
 * Reset all collections
 */
export async function resetDatabase() {
    console.log('🗑️  Resetting database...');

    const collections = [
        'tenants',
        'accounts',
        'users',
        'user_directory',
        'plugins'
    ];

    for (const collectionName of collections) {
        const snapshot = await db.collection(collectionName).get();
        const batch = db.batch();

        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`  ✅ Cleared ${collectionName}`);
    }

    // Delete all Auth users
    const listUsersResult = await auth.listUsers();
    for (const userRecord of listUsersResult.users) {
        await auth.deleteUser(userRecord.uid);
    }
    console.log('  ✅ Cleared Auth users');
}

/**
 * Seed plugins
 */
export async function seedPlugins() {
    console.log('🔌 Seeding plugins...');

    const plugins = [
        {
            id: 'stockpile-control',
            name: 'Stockpile Control',
            description: 'Gestión de acopios mineros',
            icon: 'inventory_2',
            version: '1.0.0'
        },
        {
            id: 'inventory-management',
            name: 'Inventory Management',
            description: 'Control de inventario',
            icon: 'warehouse',
            version: '1.0.0'
        },
        {
            id: 'fleet-tracking',
            name: 'Fleet Tracking',
            description: 'Seguimiento de flota',
            icon: 'local_shipping',
            version: '1.0.0'
        },
        {
            id: 'safety-reports',
            name: 'Safety Reports',
            description: 'Reportes de seguridad',
            icon: 'health_and_safety',
            version: '1.0.0'
        }
    ];

    for (const plugin of plugins) {
        await db.collection('plugins').doc(plugin.id).set(plugin);
    }

    console.log(`  ✅ Created ${plugins.length} plugins`);
}

/**
 * Seed Super Admin
 */
export async function seedSuperAdmin() {
    console.log('👑 Seeding Super Admin...');

    try {
        // Create Auth user
        const userRecord = await auth.createUser({
            uid: 'super-admin-uid',
            email: 'admin@minreport.com',
            password: 'SuperAdmin123!',
            displayName: 'Super Admin',
            emailVerified: true
        });

        // Set custom claims
        await auth.setCustomUserClaims(userRecord.uid, {
            role: 'SUPER_ADMIN'
        });

        console.log('  ✅ Super Admin created');
    } catch (error: any) {
        if (error.code === 'auth/email-already-exists') {
            console.log('  ℹ️  Super Admin already exists');
        } else {
            throw error;
        }
    }
}

/**
 * Seed ENTERPRISE account
 */
export async function seedEnterpriseAccount() {
    console.log('🏢 Seeding ENTERPRISE account...');

    const accountId = 'minera-abc-id';
    const ownerUid = 'enterprise-owner-uid';

    // 1. Create Auth user for owner
    try {
        await auth.createUser({
            uid: ownerUid,
            email: 'admin@minera-abc.cl',
            password: 'MineraABC123!',
            displayName: 'Juan Pérez',
            emailVerified: true
        });
    } catch (error: any) {
        if (error.code !== 'auth/email-already-exists') throw error;
    }

    // 2. Create Account
    await db.collection('accounts').doc(accountId).set({
        id: accountId,
        name: 'Minera ABC S.A.',
        type: 'ENTERPRISE',
        taxId: '76.123.456-7',
        ownerId: ownerUid,
        enabledPlugins: ['stockpile-control', 'fleet-tracking'],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 3. Create User Directory entry
    await db.collection('user_directory').doc('761234567').set({
        run: '761234567',
        fullName: 'Minera ABC S.A.',
        accounts: [{
            accountId: accountId,
            authEmail: 'admin@minera-abc.cl',
            role: 'OWNER',
            type: 'BUSINESS',
            accountName: 'Minera ABC S.A.'
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 4. Create User document
    await db.collection('users').doc(ownerUid).set({
        uid: ownerUid,
        email: 'admin@minera-abc.cl',
        taxId: '76.123.456-7',
        displayName: 'Juan Pérez',
        role: 'USER',
        memberships: [{
            accountId: accountId,
            role: 'OWNER',
            companyName: 'Minera ABC S.A.',
            joinedAt: Date.now()
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 5. Create Job Profile
    await db.collection(`accounts/${accountId}/job_profiles`).doc('profile-operador-caex').set({
        id: 'profile-operador-caex',
        name: 'Operador CAEX',
        description: 'Operador de camiones CAEX',
        allowedPlugins: ['fleet-tracking'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: ownerUid
    });

    console.log('  ✅ ENTERPRISE account created');
}

/**
 * Seed EDUCATIONAL account
 */
export async function seedEducationalAccount() {
    console.log('🎓 Seeding EDUCATIONAL account...');

    const accountId = 'uchile-student-id';
    const userUid = 'edu-student-uid';

    // 1. Create Auth user
    try {
        await auth.createUser({
            uid: userUid,
            email: 'estudiante@uchile.cl',
            password: 'UChile2027!',
            displayName: 'María González',
            emailVerified: true
        });
    } catch (error: any) {
        if (error.code !== 'auth/email-already-exists') throw error;
    }

    // 2. Create Account
    await db.collection('accounts').doc(accountId).set({
        id: accountId,
        name: 'María González - UChile',
        type: 'EDUCATIONAL',
        taxId: '18.765.432-1',
        ownerId: userUid,
        enabledPlugins: ['stockpile-control'],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 3. Create User Directory entry
    await db.collection('user_directory').doc('187654321').set({
        run: '187654321',
        fullName: 'María González',
        accounts: [{
            accountId: accountId,
            authEmail: 'estudiante@uchile.cl',
            role: 'OWNER',
            type: 'EDUCATIONAL',
            accountName: 'María González - UChile'
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 4. Create User document
    await db.collection('users').doc(userUid).set({
        uid: userUid,
        email: 'estudiante@uchile.cl',
        taxId: '18.765.432-1',
        displayName: 'María González',
        role: 'USER',
        memberships: [{
            accountId: accountId,
            role: 'OWNER',
            companyName: 'María González - UChile',
            joinedAt: Date.now()
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    console.log('  ✅ EDUCATIONAL account created');
}

/**
 * Seed PERSONAL account
 */
export async function seedPersonalAccount() {
    console.log('👤 Seeding PERSONAL account...');

    const accountId = 'carlos-munoz-id';
    const userUid = 'personal-user-uid';

    // 1. Create Auth user
    try {
        await auth.createUser({
            uid: userUid,
            email: 'carlos@gmail.com',
            password: 'Personal123!',
            displayName: 'Carlos Muñoz',
            emailVerified: true
        });
    } catch (error: any) {
        if (error.code !== 'auth/email-already-exists') throw error;
    }

    // 2. Create Account
    await db.collection('accounts').doc(accountId).set({
        id: accountId,
        name: 'Carlos Muñoz',
        type: 'PERSONAL',
        taxId: '15.234.567-8',
        ownerId: userUid,
        enabledPlugins: ['stockpile-control', 'inventory-management'],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 3. Create User Directory entry
    await db.collection('user_directory').doc('152345678').set({
        run: '152345678',
        fullName: 'Carlos Muñoz',
        accounts: [{
            accountId: accountId,
            authEmail: 'carlos@gmail.com',
            role: 'OWNER',
            type: 'PERSONAL',
            accountName: 'Carlos Muñoz'
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    // 4. Create User document
    await db.collection('users').doc(userUid).set({
        uid: userUid,
        email: 'carlos@gmail.com',
        taxId: '15.234.567-8',
        displayName: 'Carlos Muñoz',
        role: 'USER',
        memberships: [{
            accountId: accountId,
            role: 'OWNER',
            companyName: 'Carlos Muñoz',
            joinedAt: Date.now()
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    console.log('  ✅ PERSONAL account created');
}

/**
 * Seed Worker User
 */
export async function seedWorkerUser() {
    console.log('👷 Seeding Worker user...');

    const accountId = 'minera-abc-id';
    const workerUid = 'worker-user-uid';

    // 1. Create Auth user
    try {
        await auth.createUser({
            uid: workerUid,
            email: 'pedro.soto@minera-abc.cl',
            password: 'Worker123!',
            displayName: 'Pedro Soto',
            emailVerified: true
        });
    } catch (error: any) {
        if (error.code !== 'auth/email-already-exists') throw error;
    }

    // 2. Update User Directory
    const userDirRef = db.collection('user_directory').doc('198765432');
    const userDirSnap = await userDirRef.get();

    if (!userDirSnap.exists) {
        await userDirRef.set({
            run: '198765432',
            fullName: 'Pedro Soto',
            accounts: [{
                accountId: accountId,
                authEmail: 'pedro.soto@minera-abc.cl',
                role: 'OPERATOR',
                type: 'BUSINESS',
                accountName: 'Minera ABC S.A.',
                jobProfileId: 'profile-operador-caex'
            }],
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }

    // 3. Create Member document
    await db.collection(`accounts/${accountId}/members`).doc(workerUid).set({
        userId: workerUid,
        email: 'pedro.soto@minera-abc.cl',
        fullName: 'Pedro Soto',
        run: '198765432',
        jobProfileId: 'profile-operador-caex',
        role: 'OPERATOR',
        status: 'ACTIVE',
        invitedAt: Date.now()
    });

    // 4. Create User document
    await db.collection('users').doc(workerUid).set({
        uid: workerUid,
        email: 'pedro.soto@minera-abc.cl',
        taxId: '19.876.543-2',
        displayName: 'Pedro Soto',
        role: 'USER',
        memberships: [{
            accountId: accountId,
            role: 'OPERATOR',
            companyName: 'Minera ABC S.A.',
            joinedAt: Date.now(),
            jobProfileId: 'profile-operador-caex'
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    console.log('  ✅ Worker user created');
}

/**
 * Main seeding function
 */
async function main() {
    try {
        console.log('\n🌱 Starting database seeding...\n');

        await resetDatabase();
        await seedPlugins();
        await seedSuperAdmin();
        await seedEnterpriseAccount();
        await seedEducationalAccount();
        await seedPersonalAccount();
        await seedWorkerUser();

        console.log('\n✅ Database seeding complete!\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Seeding failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}
