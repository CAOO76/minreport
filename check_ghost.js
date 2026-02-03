
const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
admin.initializeApp({ projectId: 'minreport-8f2a8' });
const db = admin.firestore();

async function verify() {
    const accId = 'BOuyfADEIA1oc86hUENF';
    console.log('Checking Account:', accId);
    try {
        const doc = await db.collection('accounts').doc(accId).get();
        console.log('Account Exists?', doc.exists);
        if (!doc.exists) console.log('Account is MISSING!');

        const users = await db.collection('users').get();
        console.log('Scanning users for ghost membership...');
        users.forEach(u => {
            const data = u.data();
            const mems = data.memberships || [];
            const found = mems.find(m => m.accountId === accId);
            if (found) {
                console.log('Found ghost membership in User:', u.id, 'TaxID:', data.taxId);
                // Optional: Auto-fix? No, just report.
            }
        });

        // Also check the specific user 77609112-k
        const specificUser = await db.collection('users').where('taxId', '==', '77609112-K').get(); // Try K
        if (specificUser.empty) {
            const specificUserLower = await db.collection('users').where('taxId', '==', '77609112-k').get();
            if (!specificUserLower.empty) console.log('User 77609112-k found (lowercase).');
            else console.log('User 77609112-k NOT FOUND.');
        } else {
            console.log('User 77609112-K found (uppercase).');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}
verify();
