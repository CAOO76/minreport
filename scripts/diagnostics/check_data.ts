import * as admin from 'firebase-admin';

// Connect to the Firestore emulator
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = 'minreport-8f2a8';

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'minreport-8f2a8'
    });
}

const db = admin.firestore();

async function checkTenants() {
    console.log('--- Checking Tenants ---');
    const tenantsRef = db.collection('tenants');
    const snapshot = await tenantsRef.get();

    if (snapshot.empty) {
        console.log('No tenants found.');
        return;
    }

    snapshot.forEach(doc => {
        const data = doc.data();
        const displayName = data.company_name || data.institution_name || data.full_name || 'Unnamed';
        console.log(`\nID: ${doc.id}`);
        console.log(`Name: ${displayName}`);
        console.log(`Status: '${data.status}' (Length: ${data.status?.length})`); // Quote to see whitespace
        console.log(`Enabled Plugins:`, data.enabledPlugins);
        console.log(`Type: ${data.type}`);
    });

    console.log('\n--- Checking Accounts ---');
    const accountsRef = db.collection('accounts');
    const accSnapshot = await accountsRef.get();
    accSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`\nID: ${doc.id}`);
        console.log(`Status: '${data.status}'`);
        console.log(`Enabled Plugins:`, data.enabledPlugins);
    });

}

checkTenants().catch(console.error);
