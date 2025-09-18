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
// --- CONFIGURACIÓN ---
const projectId = 'minreport-8f2a8';
const targetEmail = process.argv[2]; // Lee el email del argumento
// Conexión al Emulador de Autenticación
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    if (admin.apps.length === 0) {
        admin.initializeApp({ projectId });
    }
}
else {
    // Conexión a producción
    if (admin.apps.length === 0) {
        admin.initializeApp();
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
        const user = await admin.auth().getUserByEmail(targetEmail);
        console.log(`Usuario encontrado con UID: ${user.uid}.`);
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        console.log(`\n✅ ¡Éxito! El usuario ${targetEmail} ahora es administrador.`);
        console.log('\nEl usuario deberá cerrar y volver a iniciar sesión para que los cambios tomen efecto.');
    }
    catch (error) {
        console.error(`❌ Error asignando el claim de administrador a ${targetEmail}:`, error.message);
    }
}
// Llama a la función para que se ejecute
manageAdminRole();
//# sourceMappingURL=manage-admin.js.map