import { https } from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * A secure Callable Function example that a plugin can call via the SDK.
 * It verifies that the user is authenticated and has the specific plugin
 * enabled in their custom claims.
 */
export const savePluginData = https.onCall(async (data, context) => {
  // 1. Ensure the user is authenticated.
  if (!context.auth) {
    throw new https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { pluginId, data: pluginData } = data;
  if (typeof pluginId !== 'string' || !pluginId) {
    throw new https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
  }

  // 2. Check for granular permission using Custom Claims.
  const userClaims = context.auth.token;
  const activePlugins = userClaims.activePlugins as string[] | undefined;

  if (!activePlugins || !activePlugins.includes(pluginId)) {
    throw new https.HttpsError('permission-denied', 'You do not have permission to call this function for the specified plugin.');
  }

  // 3. Perform the backend operation (simulated write to Firestore).
  console.log(`User ${context.auth.uid} is saving data for plugin ${pluginId}:`, pluginData);

  const firestore = admin.firestore();
  const docPath = `plugin_data/${context.auth.uid}/${pluginId}/user_data`;

  try {
    await firestore.doc(docPath).set({ ...pluginData, lastUpdated: new Date().toISOString() }, { merge: true });
    console.log(`Data successfully saved to ${docPath}`);
    return { success: true, message: 'Data saved successfully.' };
  } catch (error) {
    console.error(`Error saving data to Firestore at ${docPath}:`, error);
    throw new https.HttpsError('internal', 'An error occurred while saving the data.');
  }
});
