import * as admin from 'firebase-admin';

// --- CONFIGURACIÓN DE SIEMBRA ---
// IMPORTANTE: Estas credenciales son solo para desarrollo local.
const SUPER_ADMIN_EMAIL = 'app_dev@minreport.com';
const SUPER_ADMIN_PASSWORD = 'password-seguro-local'; // Cambia esto si lo deseas

const projectId = 'minreport-8f2a8';

// Conexión al Emulador de Autenticación
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
  }
} else {
  console.error('❌ Este script está diseñado para ejecutarse solo contra el emulador de Firebase.');
  console.error('Asegúrate de que la variable de entorno FIREBASE_AUTH_EMULATOR_HOST esté configurada.');
  process.exit(1);
}
// --- FIN DE LA CONFIGURACIÓN ---

async function seedSuperAdmin() {
  console.log('🌱 Iniciando el proceso de siembra del super admin...');

  try {
    // 1. Buscar al usuario
    let userRecord = await admin.auth().getUserByEmail(SUPER_ADMIN_EMAIL).catch(() => null);

    // 2. Si no existe, crearlo
    if (!userRecord) {
      console.log(`El usuario ${SUPER_ADMIN_EMAIL} no existe. Creándolo...`);
      userRecord = await admin.auth().createUser({
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
        emailVerified: true,
        displayName: 'Super Admin',
      });
      console.log(`✔️ Usuario ${SUPER_ADMIN_EMAIL} creado con UID: ${userRecord.uid}`);
    } else {
      console.log(`El usuario ${SUPER_ADMIN_EMAIL} ya existe con UID: ${userRecord.uid}.`);
    }

    // 3. Asignar el claim de administrador
    if (userRecord.customClaims?.['admin'] !== true) {
      console.log('Asignando rol de administrador...');
      await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });
      console.log('✔️ Rol de administrador asignado.');
    } else {
      console.log('El usuario ya tiene el rol de administrador.');
    }

    console.log('\n✅ Proceso de siembra completado con éxito.');
    console.log(`
   Usuario: ${SUPER_ADMIN_EMAIL}`);
    console.log(`   Contraseña: ${SUPER_ADMIN_PASSWORD}`);

  } catch (error: any) {
    console.error('❌ Error durante el proceso de siembra:', error.message);
    process.exit(1);
  }
}

// --- CONFIGURACIÓN DE USUARIO DE PRUEBA ---
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_PASSWORD = 'password123';
const TEST_USER_ACTIVE_PLUGINS = ['test-plugin'];

async function seedTestUser() {
  console.log('\n🌱 Iniciando el proceso de siembra del usuario de prueba...');
  try {
    let userRecord = await admin.auth().getUserByEmail(TEST_USER_EMAIL).catch(() => null);

    if (!userRecord) {
      console.log(`El usuario ${TEST_USER_EMAIL} no existe. Creándolo...`);
      userRecord = await admin.auth().createUser({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        emailVerified: true,
        displayName: 'Test User',
      });
      console.log(`✔️ Usuario ${TEST_USER_EMAIL} creado con UID: ${userRecord.uid}`);
    } else {
      console.log(`El usuario ${TEST_USER_EMAIL} ya existe con UID: ${userRecord.uid}.`);
    }

    // Asignar custom claims (activePlugins)
    if (userRecord.customClaims?.['activePlugins']?.length !== TEST_USER_ACTIVE_PLUGINS.length ||
        !TEST_USER_ACTIVE_PLUGINS.every(p => userRecord.customClaims?.['activePlugins']?.includes(p))) {
      console.log('Asignando custom claims (activePlugins)...');
      await admin.auth().setCustomUserClaims(userRecord.uid, { activePlugins: TEST_USER_ACTIVE_PLUGINS });
      console.log('✔️ Custom claims asignados.');
    } else {
      console.log('Los custom claims ya están asignados.');
    }

    console.log('✅ Proceso de siembra de usuario de prueba completado con éxito.');
    console.log(`\n   Usuario: ${TEST_USER_EMAIL}`);
    console.log(`   Contraseña: ${TEST_USER_PASSWORD}`);

  } catch (error: any) {
    console.error('❌ Error durante el proceso de siembra del usuario de prueba:', error.message);
    process.exit(1);
  }
}

// Llama a las funciones para que se ejecuten
seedSuperAdmin();
seedTestUser();
