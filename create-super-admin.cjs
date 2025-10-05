const admin = require('firebase-admin');

// --- CONFIGURACIÓN DE SIEMBRA ---
// IMPORTANTE: Estas credenciales son solo para desarrollo local.
const SUPER_ADMIN_EMAIL = 'app_dev@minreport.com';
const SUPER_ADMIN_PASSWORD = 'password-seguro-local';
const projectId = 'minreport-8f2a8';

// Conexión al Emulador de Autenticación
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
  }
} else {
  console.error('Este script está diseñado para ejecutarse solo contra el emulador de Firebase.');
  console.error('Asegúrate de que la variable de entorno FIREBASE_AUTH_EMULATOR_HOST esté configurada.');
  process.exit(1);
}

async function seedSuperAdmin() {
  console.log('Iniciando el proceso de siembra del super admin...');

  try {
    let userRecord = await admin.auth().getUserByEmail(SUPER_ADMIN_EMAIL).catch(() => null);

    if (!userRecord) {
      console.log(`El usuario ${SUPER_ADMIN_EMAIL} no existe. Creándolo...`);
      userRecord = await admin.auth().createUser({
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
        emailVerified: true,
        displayName: 'Super Admin',
      });
      console.log(`Usuario ${SUPER_ADMIN_EMAIL} creado con UID: ${userRecord.uid}`);
    } else {
      console.log(`El usuario ${SUPER_ADMIN_EMAIL} ya existe con UID: ${userRecord.uid}.`);
    }

    if (userRecord.customClaims?.['admin'] !== true) {
      console.log('Asignando rol de administrador...');
      await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });
      console.log('Rol de administrador asignado.');
    } else {
      console.log('El usuario ya tiene el rol de administrador.');
    }

    console.log('\n✅ Proceso de siembra completado con éxito.');
    console.log(`📧 Usuario: ${SUPER_ADMIN_EMAIL}`);
    console.log(`🔐 Contraseña: ${SUPER_ADMIN_PASSWORD}`);
    console.log('\n🚀 Ahora puedes iniciar sesión en ADMIN: http://localhost:5177/');

  } catch (error) {
    console.error('❌ Error durante el proceso de siembra:', error.message);
    process.exit(1);
  }
}

async function main() {
  await seedSuperAdmin();
}

main().catch(() => process.exit(1));