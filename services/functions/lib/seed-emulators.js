"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
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
}
else {
    console.error('❌ Este script está diseñado para ejecutarse solo contra el emulador de Firebase.');
    console.error('Asegúrate de que la variable de entorno FIREBASE_AUTH_EMULATOR_HOST esté configurada.');
    process.exit(1);
}
// --- FIN DE LA CONFIGURACIÓN ---
async function seedSuperAdmin() {
    var _a;
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
        }
        else {
            console.log(`El usuario ${SUPER_ADMIN_EMAIL} ya existe con UID: ${userRecord.uid}.`);
        }
        // 3. Asignar el claim de administrador
        if (((_a = userRecord.customClaims) === null || _a === void 0 ? void 0 : _a['admin']) !== true) {
            console.log('Asignando rol de administrador...');
            await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });
            console.log('✔️ Rol de administrador asignado.');
        }
        else {
            console.log('El usuario ya tiene el rol de administrador.');
        }
        console.log('\n✅ Proceso de siembra completado con éxito.');
        console.log(`
   Usuario: ${SUPER_ADMIN_EMAIL}`);
        console.log(`   Contraseña: ${SUPER_ADMIN_PASSWORD}`);
    }
    catch (error) {
        console.error('❌ Error durante el proceso de siembra:', error.message);
        process.exit(1);
    }
}
// --- CONFIGURACIÓN DE USUARIO DE PRUEBA ---
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_PASSWORD = 'password123';
const TEST_USER_ACTIVE_PLUGINS = ['test-plugin'];
async function seedTestUser() {
    var _a, _b;
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
        }
        else {
            console.log(`El usuario ${TEST_USER_EMAIL} ya existe con UID: ${userRecord.uid}.`);
        }
        // Asignar custom claims (activePlugins)
        if (((_b = (_a = userRecord.customClaims) === null || _a === void 0 ? void 0 : _a['activePlugins']) === null || _b === void 0 ? void 0 : _b.length) !== TEST_USER_ACTIVE_PLUGINS.length ||
            !TEST_USER_ACTIVE_PLUGINS.every(p => { var _a, _b; return (_b = (_a = userRecord.customClaims) === null || _a === void 0 ? void 0 : _a['activePlugins']) === null || _b === void 0 ? void 0 : _b.includes(p); })) {
            console.log('Asignando custom claims (activePlugins)...');
            await admin.auth().setCustomUserClaims(userRecord.uid, { activePlugins: TEST_USER_ACTIVE_PLUGINS });
            console.log('✔️ Custom claims asignados.');
        }
        else {
            console.log('Los custom claims ya están asignados.');
        }
        console.log('✅ Proceso de siembra de usuario de prueba completado con éxito.');
        console.log(`\n   Usuario: ${TEST_USER_EMAIL}`);
        console.log(`   Contraseña: ${TEST_USER_PASSWORD}`);
    }
    catch (error) {
        console.error('❌ Error durante el proceso de siembra del usuario de prueba:', error.message);
        process.exit(1);
    }
}
// Llama a las funciones para que se ejecuten
seedSuperAdmin();
seedTestUser();
//# sourceMappingURL=seed-emulators.js.map