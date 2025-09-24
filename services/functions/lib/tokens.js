import * as functions from 'firebase-functions/v2';
import * as jwt from 'jsonwebtoken';
export const generatePluginLoadToken = functions.https.onCall({ region: "southamerica-west1" }, async (request) => {
    const { pluginId } = request.data;
    const context = request; // Corrected: context is the request object itself
    // 1. Ensure the user is authenticated.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (typeof pluginId !== 'string' || !pluginId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
    }
    // 2. Check for granular permission using Custom Claims (adminActivatedPlugins).
    const userClaims = context.auth.token;
    const adminActivatedPlugins = userClaims.adminActivatedPlugins;
    if (!adminActivatedPlugins || !adminActivatedPlugins.includes(pluginId)) {
        throw new functions.https.HttpsError('permission-denied', 'You do not have permission to load this plugin.');
    }
    // 3. Generate a short-lived JWT (ticket).
    const payload = {
        uid: context.auth.uid,
        pluginId: pluginId,
    };
    const options = {
        expiresIn: '1h', // Ticket valid for 1 hour
    };
    // Use a strong, unique secret for signing. This should be stored securely (e.g., Firebase Config).
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new functions.https.HttpsError('internal', 'JWT_SECRET is not configured.');
    }
    const ticket = jwt.sign(payload, jwtSecret, options);
    console.log(`Generated load token for user ${context.auth.uid} for plugin ${pluginId}.`);
    return { ticket };
});
//# sourceMappingURL=tokens.js.map