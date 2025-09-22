import { https } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sign } from 'jsonwebtoken';

// This would be managed by a secret manager in a real production environment.
const JWT_SECRET = 'a-very-secret-and-long-key-for-signing-jwts';

/**
 * A Callable Function that generates a short-lived, single-use JWT (load ticket)
 * for a user to load a specific plugin.
 */
export const generatePluginLoadToken = https.onCall(async (data, context) => {
  // 1. Ensure the user is authenticated.
  if (!context.auth) {
    throw new https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const pluginId = data.pluginId;
  if (typeof pluginId !== 'string' || !pluginId) {
    throw new https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
  }

  // 2. Check if the user is authorized to use this plugin (using Custom Claims).
  const userClaims = context.auth.token;
  const activePlugins = userClaims.activePlugins as string[] | undefined;

  if (!activePlugins || !activePlugins.includes(pluginId)) {
    console.warn(`User ${context.auth.uid} denied access to plugin ${pluginId}.`);
    throw new https.HttpsError('permission-denied', 'You do not have permission to access this plugin.');
  }

  // 3. Generate the secure, short-lived JWT load ticket.
  const payload = {
    uid: context.auth.uid,
    pluginId,
  };

  const token = sign(payload, JWT_SECRET, { expiresIn: '60s' }); // Ticket is valid for 60 seconds.

  console.log(`Generated load token for user ${context.auth.uid} for plugin ${pluginId}.`);

  // 4. Return the token to the client.
  return { token };
});
