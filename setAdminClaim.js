const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Inicializa Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();

// Correo electrónico del usuario al que quieres dar permisos de administrador
const adminEmail = 'app_dev@minreport.com'; // ¡CAMBIA ESTO AL CORREO QUE CREASTE!

async function setAdminClaim() {
  try {
    const user = await auth.getUserByEmail(adminEmail);
    // Establece el custom claim 'admin' a true
    await auth.setCustomUserClaims(user.uid, { admin: true });

    console.log(`Custom claim 'admin: true' establecido para el usuario ${adminEmail} (UID: ${user.uid}).`);
    console.log('Recuerda que los tokens de ID existentes del usuario deben ser refrescados para que el cambio surta efecto.');
  } catch (error) {
    console.error('Error al establecer el custom claim de administrador:', error);
  }
}

setAdminClaim();
