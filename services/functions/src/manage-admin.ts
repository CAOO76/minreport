import * as admin from 'firebase-admin';

// --- CONFIGURACIÓN ---
const projectId = 'minreport-8f2a8';
const targetEmail = process.argv[2]; // Lee el email del argumento

// Conexión al Emulador de Autenticación
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  if (admin.default.apps.length === 0) {
    admin.default.initializeApp({ projectId });
  }
} else {
  // Conexión a producción
  if (admin.default.apps.length === 0) {
    admin.default.initializeApp();
  }
}
// --- FIN DE LA CONFIGURACIÓN ---

async function manageAdminRole() {
  if (!targetEmail) {
    console.error('❌ Error: Debes proporcionar un email como argumento.');
    console.log('Uso: pnpm set-admin <email-del-usuario>');
    return;
  }

  try {
    console.log(`Buscando usuario con email: ${targetEmail}...`);
    const user = await admin.default.auth().getUserByEmail(targetEmail);
    console.log(`Usuario encontrado con UID: ${user.uid}.`);

    await admin.default.auth().setCustomUserClaims(user.uid, { admin: true });

    console.log(`\n✅ ¡Éxito! El usuario ${targetEmail} ahora es administrador.`);
    console.log('\nEl usuario deberá cerrar y volver a iniciar sesión para que los cambios tomen efecto.');

  } catch (error: any) {
    console.error(`❌ Error asignando el claim de administrador a ${targetEmail}:`, error.message);
  }
}

// Llama a la función para que se ejecute
manageAdminRole();