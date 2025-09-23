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
exports.manageClientPluginsCallable = void 0;
// services/functions/src/clientPluginManagement.ts
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.manageClientPluginsCallable = functions
    .region('southamerica-west1')
    .https.onCall(async (data, context) => {
    var _a;
    // 1. Verificar autenticación y permisos de administrador
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'La solicitud debe estar autenticada.');
    }
    const callerUid = context.auth.uid;
    const userRecord = await admin.auth().getUser(callerUid);
    if (!((_a = userRecord.customClaims) === null || _a === void 0 ? void 0 : _a.admin)) {
        throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden realizar esta acción.');
    }
    // 2. Validar datos de entrada
    const { accountId, pluginId, action } = data;
    if (typeof accountId !== 'string' || accountId.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'El ID de la cuenta es requerido.');
    }
    if (typeof pluginId !== 'string' || pluginId.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'El ID del plugin es requerido.');
    }
    if (action !== 'activate' && action !== 'deactivate') {
        throw new functions.https.HttpsError('invalid-argument', 'La acción debe ser "activate" o "deactivate".');
    }
    const accountRef = db.collection('accounts').doc(accountId);
    try {
        await db.runTransaction(async (transaction) => {
            var _a;
            const accountDoc = await transaction.get(accountRef);
            if (!accountDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'La cuenta especificada no existe.');
            }
            const currentActivePlugins = ((_a = accountDoc.data()) === null || _a === void 0 ? void 0 : _a.activePlugins) || [];
            let newActivePlugins = [...currentActivePlugins];
            let updated = false;
            if (action === 'activate') {
                if (!newActivePlugins.includes(pluginId)) {
                    newActivePlugins.push(pluginId);
                    updated = true;
                }
            }
            else { // action === 'deactivate'
                const index = newActivePlugins.indexOf(pluginId);
                if (index > -1) {
                    newActivePlugins.splice(index, 1);
                    updated = true;
                }
            }
            if (updated) {
                transaction.update(accountRef, { activePlugins: newActivePlugins });
            }
        });
        return { status: 'success', message: `Plugin ${pluginId} ${action}d for account ${accountId}.` };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error('Error managing client plugin:', error);
        throw new functions.https.HttpsError('internal', 'Error al gestionar el plugin del cliente.', error.message);
    }
});
//# sourceMappingURL=clientPluginManagement.js.map