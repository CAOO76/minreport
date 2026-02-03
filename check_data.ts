import * as admin from 'firebase-admin';

// Connect to the Firestore emulator
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'minreport-8f2a8'
    });
}

const db = admin.firestore();

async function checkTaxId() {
    const taxId = '13.011.014-2';
    const cleanTaxId = taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    const formattedTaxId = taxId; // Since it already has dots
    const dashOnly = '13011014-2';

    const searchValues = [taxId, cleanTaxId, formattedTaxId, dashOnly];

    console.log('Searching for variants:', searchValues);

    // Check users
    const usersRef = db.collection('users');
    const userSnap = await usersRef.where('taxId', 'in', searchValues).get();
    console.log(`\nUsers found: ${userSnap.size}`);
    userSnap.forEach(doc => {
        console.log(`- User ID: ${doc.id}, TaxID: "${doc.data().taxId}", Name: ${doc.data().fullName}`);
    });

    // Check accounts (primaryOperator)
    const accountsRef = db.collection('accounts');
    const accSnap = await accountsRef.where('primaryOperator.taxId', 'in', searchValues).get();
    console.log(`\nAccounts (primaryOperator) found: ${accSnap.size}`);
    accSnap.forEach(doc => {
        const data = doc.data();
        console.log(`- Account ID: ${doc.id}, Name: ${data.name}, Operator TaxID: "${data.primaryOperator?.taxId}"`);
    });

    // List ALL accounts just in case
    console.log('\n--- ALL ACCOUNTS (Top 5) ---');
    const allAccs = await accountsRef.limit(5).get();
    allAccs.forEach(doc => {
        const data = doc.data();
        console.log(`- ID: ${doc.id}, Name: ${data.name}, Operator TaxID: "${data.primaryOperator?.taxId}"`);
    });
}

checkTaxId();
