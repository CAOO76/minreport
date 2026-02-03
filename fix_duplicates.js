
const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'minreport-8f2a8';

admin.initializeApp({ projectId: 'minreport-8f2a8' });
const db = admin.firestore();

async function fixDuplicates() {
    const userUid = 'kFdbK8PL9204MgmXdCNnjXV316zh'; // From previous debug
    console.log(`[FIX] Checking User: ${userUid}`);

    try {
        const userRef = db.collection('users').doc(userUid);
        const doc = await userRef.get();
        if (!doc.exists) {
            console.error('❌ User not found!');
            return;
        }

        const data = doc.data();
        const memberships = data.memberships || [];
        console.log(`Current Memberships (${memberships.length}):`, JSON.stringify(memberships, null, 2));

        if (memberships.length > 1) {
            console.log('⚠️ Duplicates detected! Deduplicating...');

            // Deduplicate by accountId
            const unique = [];
            const seen = new Set();
            for (const m of memberships) {
                if (!seen.has(m.accountId)) {
                    seen.add(m.accountId);
                    unique.push(m);
                }
            }

            console.log(`New Memberships (${unique.length}):`, JSON.stringify(unique, null, 2));

            await userRef.update({
                memberships: unique,
                updatedAt: new Date().toISOString()
            });
            console.log('✅ Deduplication applied.');
        } else {
            console.log('✅ No duplicates found.');
        }

    } catch (e) {
        console.error('❌ Error:', e);
    }
}

fixDuplicates();
