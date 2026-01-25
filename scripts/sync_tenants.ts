
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";

initializeApp({
    projectId: "minreport-8f2a8"
});

const db = getFirestore();

async function syncTenantsToUsers() {
    console.log("Starting Tenant -> User sync...");

    // 1. Get all ACTIVE tenants
    const tenantsSnapshot = await db.collection('tenants').where('status', '==', 'ACTIVE').get();

    if (tenantsSnapshot.empty) {
        console.log("No active tenants found.");
        return;
    }

    console.log(`Found ${tenantsSnapshot.size} active tenants. Check/Syncing users...`);

    const usersBatch = db.batch();
    let count = 0;

    for (const doc of tenantsSnapshot.docs) {
        const tenant = doc.data();
        const uid = tenant.authUid || doc.id; // Fallback to doc ID if authUid missing (though it should be there for active)

        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            console.log(`Syncing user for tenant: ${tenant.email} (UID: ${uid})`);

            usersBatch.set(userRef, {
                uid: uid,
                email: tenant.email,
                displayName: tenant.type === 'PERSONAL' ? tenant.full_name : (tenant.company_name || tenant.institution_name),
                role: 'USER',
                status: 'ACTIVE',
                entitlements: {
                    pluginsEnabled: [], // Default empty
                    storageLimit: 1073741824 // 1GB
                },
                stats: {
                    storageUsed: 0,
                    lastLogin: null
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            count++;
        }
    }

    if (count > 0) {
        await usersBatch.commit();
        console.log(`✅ Successfully synced ${count} users.`);
    } else {
        console.log("All active tenants already have user records.");
    }
}

syncTenantsToUsers().catch(console.error);
