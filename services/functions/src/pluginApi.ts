import * as functions from 'firebase-functions/v2';
import { CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

// Handler for savePluginData with dependency injection
export async function handleSavePluginData(
  db: Firestore,
  request: CallableRequest<{ pluginId: string; data: any }>
) {
  const { pluginId, data: pluginData } = request.data;
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }
  if (typeof pluginId !== 'string' || !pluginId) {
    throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
  }

  const docPath = `plugin_data/${request.auth.uid}/${pluginId}/user_data`;
  try {
    await db.doc(docPath).set({ ...pluginData, lastUpdated: new Date().toISOString() }, { merge: true });
    return { success: true, message: 'Data saved successfully.' };
  } catch (error) {
    console.error(`Error saving data to Firestore at ${docPath}:`, error);
    throw new functions.https.HttpsError('internal', 'An error occurred while saving the data.');
  }
}

// Handler for updateUserPluginClaims with dependency injection
export async function handleUpdateUserPluginClaims(
  auth: Auth,
  request: CallableRequest<{ userId: string; pluginId: string; isActive: boolean }>
) {
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
    let adminActivatedPlugins = (currentCustomClaims.adminActivatedPlugins || []) as string[];

    if (isActive) {
      if (!adminActivatedPlugins.includes(pluginId)) adminActivatedPlugins.push(pluginId);
    } else {
      adminActivatedPlugins = adminActivatedPlugins.filter(id => id !== pluginId);
    }

    await auth.setCustomUserClaims(userId, { ...currentCustomClaims, adminActivatedPlugins });
    await auth.revokeRefreshTokens(userId);

    return { success: true, message: 'User plugin claims updated successfully.' };
  } catch (error: any) {
    console.error(`Error updating user plugin claims for user ${userId}:`, error);
    throw new functions.https.HttpsError('internal', 'An error occurred while updating user plugin claims.', error.message);
  }
}

// Handler for getUserPluginClaims with dependency injection
export async function handleGetUserPluginClaims(
  auth: Auth,
  request: CallableRequest<{ userId: string }>
) {
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
    const adminActivatedPlugins = (userRecord.customClaims?.adminActivatedPlugins || []) as string[];
    return { adminActivatedPlugins };
  } catch (error: any) {
    console.error(`Error fetching user plugin claims for user ${userId}:`, error);
    throw new functions.https.HttpsError('internal', 'An error occurred while fetching user plugin claims.', error.message);
  }
}

// Exported Cloud Functions that inject dependencies
export const savePluginData = functions.https.onCall({ region: "southamerica-west1" }, (request) => {
  return handleSavePluginData(getFirestore(), request);
});

export const updateUserPluginClaims = functions.https.onCall({ region: "southamerica-west1" }, (request) => {
  return handleUpdateUserPluginClaims(getAuth(), request);
});

export const getUserPluginClaims = functions.https.onCall({ region: "southamerica-west1" }, (request) => {
  return handleGetUserPluginClaims(getAuth(), request);
});
