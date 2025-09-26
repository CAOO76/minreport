import * as functions from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
// Handler for savePluginData
export async function handleSavePluginData(request) {
    const db = getFirestore();
    const { pluginId, data: pluginData } = request.data;
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (typeof pluginId !== 'string' || !pluginId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
    }
    const docPath = `plugin_data/${request.auth.uid}/${pluginId}/user_data`;
    try {
        await db.doc(docPath).set(Object.assign(Object.assign({}, pluginData), { lastUpdated: new Date().toISOString() }), { merge: true });
        return { success: true, message: 'Data saved successfully.' };
    }
    catch (error) {
        console.error(`Error saving data to Firestore at ${docPath}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred while saving the data.');
    }
}
// Handler for updateUserPluginClaims
export async function handleUpdateUserPluginClaims(request) {
    const auth = getAuth();
    const { userId, pluginId, isActive } = request.data;
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (!request.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can perform this action.');
    }
    if (typeof userId !== 'string' || !userId || typeof pluginId !== 'string' || !pluginId || typeof isActive !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid arguments provided.');
    }
    try {
        const userRecord = await auth.getUser(userId);
        const currentCustomClaims = userRecord.customClaims || {};
        let adminActivatedPlugins = (currentCustomClaims.adminActivatedPlugins || []);
        if (isActive) {
            if (!adminActivatedPlugins.includes(pluginId))
                adminActivatedPlugins.push(pluginId);
        }
        else {
            adminActivatedPlugins = adminActivatedPlugins.filter(id => id !== pluginId);
        }
        await auth.setCustomUserClaims(userId, Object.assign(Object.assign({}, currentCustomClaims), { adminActivatedPlugins }));
        await auth.revokeRefreshTokens(userId);
        return { success: true, message: 'User plugin claims updated successfully.' };
    }
    catch (error) {
        console.error(`Error updating user plugin claims for user ${userId}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred while updating user plugin claims.', error.message);
    }
}
// Handler for getUserPluginClaims
export async function handleGetUserPluginClaims(request) {
    var _a;
    const auth = getAuth();
    const { userId } = request.data;
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (!request.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can perform this action.');
    }
    if (typeof userId !== 'string' || !userId) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid arguments provided.');
    }
    try {
        const userRecord = await auth.getUser(userId);
        const adminActivatedPlugins = (((_a = userRecord.customClaims) === null || _a === void 0 ? void 0 : _a.adminActivatedPlugins) || []);
        return { adminActivatedPlugins };
    }
    catch (error) {
        console.error(`Error fetching user plugin claims for user ${userId}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred while fetching user plugin claims.', error.message);
    }
}
// Exported Cloud Functions
export const savePluginData = functions.https.onCall({ region: "southamerica-west1" }, (request) => {
    return handleSavePluginData(request);
});
export const updateUserPluginClaims = functions.https.onCall({ region: "southamerica-west1" }, (request) => {
    return handleUpdateUserPluginClaims(request);
});
export const getUserPluginClaims = functions.https.onCall({ region: "southamerica-west1" }, (request) => {
    return handleGetUserPluginClaims(request);
});
//# sourceMappingURL=pluginApi.js.map