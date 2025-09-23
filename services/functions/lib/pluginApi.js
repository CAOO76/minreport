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
exports.getUserPluginClaims = exports.updateUserPluginClaims = exports.savePluginData = void 0;
const functions = __importStar(require("firebase-functions/v2"));
const admin = __importStar(require("firebase-admin"));
/**
 * A secure Callable Function example that a plugin can call via the SDK.
 * It verifies that the user is authenticated and has the specific plugin
 * enabled in their custom claims.
 */
exports.savePluginData = functions.https.onCall({ region: "southamerica-west1" }, async (request) => {
    const { pluginId, data: pluginData } = request.data;
    const context = request; // Corrected: context is the request object itself
    // 1. Ensure the user is authenticated.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (typeof pluginId !== 'string' || !pluginId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
    }
    // 2. Check for granular permission using Custom Claims.
    const userClaims = context.auth.token;
    const activePlugins = userClaims.activePlugins;
    if (!activePlugins || !activePlugins.includes(pluginId)) {
        throw new functions.https.HttpsError('permission-denied', 'You do not have permission to call this function for the specified plugin.');
    }
    // 3. Perform the backend operation (simulated write to Firestore).
    console.log(`User ${context.auth.uid} is saving data for plugin ${pluginId}:`, pluginData);
    const firestore = admin.firestore();
    const docPath = `plugin_data/${context.auth.uid}/${pluginId}/user_data`;
    try {
        await firestore.doc(docPath).set(Object.assign(Object.assign({}, pluginData), { lastUpdated: new Date().toISOString() }), { merge: true });
        console.log(`Data successfully saved to ${docPath}`);
        return { success: true, message: 'Data saved successfully.' };
    }
    catch (error) {
        console.error(`Error saving data to Firestore at ${docPath}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred while saving the data.');
    }
});
/**
 * Callable Function to update a user's activePlugins custom claim.
 * Only callable by authenticated admins.
 */
exports.updateUserPluginClaims = functions.https.onCall({ region: "southamerica-west1" }, async (request) => {
    const { userId, pluginId, isActive } = request.data;
    const context = request; // Corrected: context is the request object itself
    // 1. Ensure the caller is authenticated.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    // 2. Ensure the caller is an admin.
    if (!context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can perform this action.');
    }
    // 3. Validate input.
    if (typeof userId !== 'string' || !userId ||
        typeof pluginId !== 'string' || !pluginId ||
        typeof isActive !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid arguments provided. Requires userId (string), pluginId (string), and isActive (boolean).');
    }
    try {
        // Get the user's current custom claims.
        const userRecord = await admin.auth().getUser(userId);
        const currentCustomClaims = userRecord.customClaims || {};
        let activePlugins = (currentCustomClaims.activePlugins || []);
        // Update the activePlugins array.
        if (isActive) {
            if (!activePlugins.includes(pluginId)) {
                activePlugins.push(pluginId);
            }
        }
        else {
            activePlugins = activePlugins.filter(id => id !== pluginId);
        }
        // Set the updated custom claims.
        await admin.auth().setCustomUserClaims(userId, Object.assign(Object.assign({}, currentCustomClaims), { activePlugins }));
        // Force refresh of the user's ID token.
        // This is important so the client app gets the updated claims immediately.
        await admin.auth().revokeRefreshTokens(userId);
        console.log(`Admin ${context.auth.uid} updated plugin claims for user ${userId}: plugin ${pluginId} set to ${isActive}.`);
        return { success: true, message: 'User plugin claims updated successfully.' };
    }
    catch (error) {
        console.error(`Error updating user plugin claims for user ${userId}:`, error);
        if (error.code === 'auth/user-not-found') {
            throw new functions.https.HttpsError('not-found', 'User not found.');
        }
        throw new functions.https.HttpsError('internal', 'An error occurred while updating user plugin claims.', error.message);
    }
});
/**
 * Callable Function to fetch a user's activePlugins custom claim.
 * Only callable by authenticated admins.
 */
exports.getUserPluginClaims = functions.https.onCall({ region: "southamerica-west1" }, async (request) => {
    var _a;
    const { userId } = request.data;
    const context = request; // Corrected: context is the request object itself
    // 1. Ensure the caller is authenticated.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    // 2. Ensure the caller is an admin.
    if (!context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can perform this action.');
    }
    // 3. Validate input.
    if (typeof userId !== 'string' || !userId) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid arguments provided. Requires userId (string). ');
    }
    try {
        const userRecord = await admin.auth().getUser(userId);
        const activePlugins = (((_a = userRecord.customClaims) === null || _a === void 0 ? void 0 : _a.activePlugins) || []);
        return { activePlugins };
    }
    catch (error) {
        console.error(`Error fetching user plugin claims for user ${userId}:`, error);
        if (error.code === 'auth/user-not-found') {
            throw new functions.https.HttpsError('not-found', 'User not found.');
        }
        throw new functions.https.HttpsError('internal', 'An error occurred while fetching user plugin claims.', error.message);
    }
});
//# sourceMappingURL=pluginApi.js.map