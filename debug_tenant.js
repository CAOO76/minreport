
const admin = require('firebase-admin');

// Setup Emulator connection
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'minreport-8f2a8';

admin.initializeApp({ projectId: 'minreport-8f2a8' });
const db = admin.firestore();
const auth = admin.auth();

async function debugTenant() {
    const tenantId = 'jl0vNVT0Q0FAnA5YJ1Us';
    console.log(`[DEBUG] Inspecting Tenant: ${tenantId}`);

    try {
        const doc = await db.collection('tenants').doc(tenantId).get();
        if (!doc.exists) {
            console.error('❌ Tenant document does not exist!');
            return;
        }

        const data = doc.data();
        console.log('✅ Tenant Data:', JSON.stringify(data, null, 2));

        if (!data.email) {
            console.error('❌ Critical: Tenant has no email!');
        } else {
            console.log(`[DEBUG] Checking Auth for email: ${data.email}`);
            try {
                const user = await auth.getUserByEmail(data.email);
                console.log(`✅ Auth User found: ${user.uid}`);

                // Check Firestore User
                const userDoc = await db.collection('users').doc(user.uid).get();
                console.log('Firestore User Exists?', userDoc.exists);
                if (userDoc.exists) {
                    console.log('Firestore User Data:', JSON.stringify(userDoc.data(), null, 2));
                }
            } catch (e) {
                console.log(`⚠️ Auth User Check: ${e.code} - ${e.message}`);
            }
        }

    } catch (e) {
        console.error('❌ Error reading Firestore:', e);
    }
}

debugTenant();
