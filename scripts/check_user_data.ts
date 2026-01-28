
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Configuración de Service Account (Asumiendo que existe en el root o usar mock si es entorno local puro)
// En este entorno, usaremos la configuración existente o simularemos lectura si no hay credenciales.
// Como soy un agente, intentaré usar el archivo service-account-key.json si existe.

const serviceAccount = require('./service-account-key.json');

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

async function checkUser() {
    console.log("Buscando usuario info@wortog.com...");
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', 'info@wortog.com').get();

    if (snapshot.empty) {
        console.log("Usuario NO encontrado.");
        return;
    }

    snapshot.forEach(doc => {
        console.log(`Usuario encontrado: ${doc.id}`);
        const data = doc.data();
        console.log("Membresías:", JSON.stringify(data.memberships, null, 2));
        console.log("Last Active Account:", data.lastActiveAccountId);

        // Verificar invites pendientes en cuentas
        checkInvites('info@wortog.com');
    });
}

async function checkInvites(email: string) {
    console.log("Buscando invitaciones pendientes...");
    const accountsRef = db.collection('accounts');
    const q = await accountsRef.where('primaryOperator.email', '==', email).get();

    if (q.empty) {
        console.log("No se encontraron invitaciones pendientes.");
    } else {
        q.forEach(doc => {
            console.log(`Invitación pendiente en cuenta: ${doc.id} (${doc.data().name})`);
        });
    }
}

checkUser();
