import * as functions from 'firebase-functions/v2';
import { CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

interface ManageClientPluginsCallableData {
  accountId: string;
  pluginId: string;
  action: 'activate' | 'deactivate';
}

// Handler for manageClientPlugins with dependency injection
export async function handleManageClientPlugins(
  db: Firestore,
  auth: Auth,
  request: CallableRequest<ManageClientPluginsCallableData>
) {
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'La solicitud debe estar autenticada.');
  }

  const callerUid = request.auth.uid;
  const userRecord = await auth.getUser(callerUid);
  if (!userRecord.customClaims?.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden realizar esta acción.');
  }

  const { accountId, pluginId, action } = request.data;

  if (typeof accountId !== 'string' || !accountId || typeof pluginId !== 'string' || !pluginId || (action !== 'activate' && action !== 'deactivate')) {
    throw new functions.https.HttpsError('invalid-argument', 'Argumentos inválidos.');
  }

  let updatedInTransaction = false;
  let finalPlugins: string[] = [];

  try {
    const accountRef = db.collection('accounts').doc(accountId);
    await db.runTransaction(async (transaction) => {
      const accountDoc = await transaction.get(accountRef);
      if (!accountDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'La cuenta especificada no existe.');
      }

      const currentPlugins = accountDoc.data()?.adminActivatedPlugins || [];
      let newPlugins = [...currentPlugins];

      if (action === 'activate') {
        if (!newPlugins.includes(pluginId)) {
          newPlugins.push(pluginId);
          updatedInTransaction = true;
        }
      } else {
        const index = newPlugins.indexOf(pluginId);
        if (index > -1) {
          newPlugins.splice(index, 1);
          updatedInTransaction = true;
        }
      }

      if (updatedInTransaction) {
        transaction.update(accountRef, { adminActivatedPlugins: newPlugins });
        finalPlugins = newPlugins;
      }
    });

    if (updatedInTransaction) {
      await auth.setCustomUserClaims(accountId, { adminActivatedPlugins: finalPlugins });
      await auth.revokeRefreshTokens(accountId);
    }

    return { status: 'success', message: `Plugin ${pluginId} ${action}d for account ${accountId}.` };
  } catch (error: any) {
    console.error('Error managing client plugin:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Error al gestionar el plugin del cliente.', error.message);
  }
}

// Exported Cloud Function that injects dependencies
export const manageClientPluginsCallable = functions.https.onCall({ region: 'southamerica-west1' }, (request: CallableRequest<ManageClientPluginsCallableData>) => {
  return handleManageClientPlugins(getFirestore(), getAuth(), request);
});
