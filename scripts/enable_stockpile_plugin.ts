
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const serviceAccount = require('../service-account-key.json');

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

async function enablePlugin() {
    const email = 'info@wortog.com';
    console.log(`Habilitando STOCKPILE-CONTROL para ${email}...`);

    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();

    if (snapshot.empty) {
        console.log("Usuario no encontrado.");
        return;
    }

    const batch = db.batch();
    snapshot.forEach(doc => {
        batch.update(doc.ref, {
            'entitlements.pluginsEnabled': FieldValue.arrayUnion('stockpile-control')
        });
    });

    await batch.commit();
    console.log("✅ Plugin habilitado en el perfil del usuario.");
}

enablePlugin().catch(console.error);
