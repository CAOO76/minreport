const admin = require('firebase-admin');

// Inicializa Firebase Admin SDK
// Si la variable de entorno FIREBASE_AUTH_EMULATOR_HOST está presente, se conecta al emulador.
// De lo contrario, intentará usar las credenciales por defecto (ej. serviceAccountKey.json o GAE/Cloud Run).
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log(`Conectando al emulador de autenticación en: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
  admin.initializeApp({ projectId: 'minreport-8f2a8' }); // Se inicializa con projectId para el emulador
} else {
  // En un entorno de producción o si no se usa el emulador, se requiere serviceAccountKey.json
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const auth = admin.auth();

// Correo electrónico del usuario al que quieres dar permisos de administrador
// ¡IMPORTANTE: CAMBIA ESTO AL CORREO DEL USUARIO QUE CREASTE EN EL EMULADOR!
const adminEmail = 'app_dev@minreport.com'; 

async function setAdminClaim() {
  try {
    const user = await auth.getUserByEmail(adminEmail);
    // Establece el custom claim 'admin' a true
    await auth.setCustomUserClaims(user.uid, { admin: true });

    console.log(`Custom claim 'admin: true' establecido para el usuario ${adminEmail} (UID: ${user.uid}).`);
    console.log('Recuerda que los tokens de ID existentes del usuario deben ser refrescados para que el cambio surta efecto (ej. cerrando y volviendo a abrir sesión).');
  } catch (error) {
    console.error('Error al establecer el custom claim de administrador:', error);
    if (error.code === 'auth/user-not-found') {
      console.error(`Asegúrate de que el usuario con el correo ${adminEmail} exista en el emulador de autenticación.`);
    }
  }
}

setAdminClaim();
