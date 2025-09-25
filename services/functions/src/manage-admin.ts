import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// --- CONFIGURACIÓN ---
const projectId = 'minreport-8f2a8';
const targetEmail = process.argv[2]; // Lee el email del argumento

// Conexión al Emulador de Autenticación
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  if (getApps().length === 0) {
    initializeApp({ projectId });
  }
} else {
  // Conexión a producción
  if (getApps().length === 0) {
    initializeApp();
  }
}
// --- FIN DE LA CONFIGURACIÓN ---

async function manageAdminRole() {
  if (!targetEmail) {
    console.error('Error: Debes proporcionar un email como argumento.');
    console.log('Uso: pnpm set-admin <email-del-usuario>');
    return;
  }

  try {
    console.log(`Buscando usuario con email: ${targetEmail}...`);
    const user = await getAuth().getUserByEmail(targetEmail);
    console.log(`Usuario encontrado con UID: ${user.uid}.`);

    await getAuth().setCustomUserClaims(user.uid, { admin: true });

    console.log(`
Exito! El usuario ${targetEmail} ahora es administrador.`);
    console.log('\nEl usuario deberá cerrar y volver a iniciar sesión para que los cambios tomen efecto.');

  } catch (error: any) {
    console.error(`Error asignando el claim de administrador a ${targetEmail}:`, error.message);
  }
}

// Llama a la función para que se ejecute
manageAdminRole();
