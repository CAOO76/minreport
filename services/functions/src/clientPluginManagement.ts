import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { CallableRequest } from 'firebase-functions/v2/https';


const db = admin.default.firestore();

interface ManageClientPluginsCallableData {
  accountId: string;
  pluginId: string;
  action: 'activate' | 'deactivate';
}

export const manageClientPluginsCallable = functions.https.onCall({ region: 'southamerica-west1' }, async (request: CallableRequest<ManageClientPluginsCallableData>) => {
    // 1. Verificar autenticación y permisos de administrador
    if (!request.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'La solicitud debe estar autenticada.'
      );
    }

    const callerUid = request.auth.uid;
    const userRecord = await admin.default.auth().getUser(callerUid);
    if (!userRecord.customClaims?.admin) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Solo los administradores pueden realizar esta acción.'
      );
    }

    // 2. Validar datos de entrada
    const { accountId, pluginId, action } = request.data;

    if (typeof accountId !== 'string' || accountId.trim() === '') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'El ID de la cuenta es requerido.'
      );
    }
    if (typeof pluginId !== 'string' || pluginId.trim() === '') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'El ID del plugin es requerido.'
      );
    }
    if (action !== 'activate' && action !== 'deactivate') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'La acción debe ser "activate" o "deactivate".'
      );
    }

    const accountRef = db.collection('accounts').doc(accountId);

    let currentActivePlugins: string[] = [];
    let newActivePlugins: string[] = [];
    let updatedInTransaction = false;

    try {
      await db.runTransaction(async (transaction: admin.firestore.Transaction) => {
        const accountDoc = await transaction.get(accountRef);

        if (!accountDoc.exists) {
          throw new functions.https.HttpsError(
            'not-found',
            'La cuenta especificada no existe.'
          );
        }

        currentActivePlugins = accountDoc.data()?.adminActivatedPlugins || []; // Use adminActivatedPlugins
        newActivePlugins = [...currentActivePlugins];

        if (action === 'activate') {
          if (!newActivePlugins.includes(pluginId)) {
            newActivePlugins.push(pluginId);
            updatedInTransaction = true;
          }
        } else { // action === 'deactivate'
          const index = newActivePlugins.indexOf(pluginId);
          if (index > -1) {
            newActivePlugins.splice(index, 1);
            updatedInTransaction = true;
          }
        }

        if (updatedInTransaction) {
          transaction.update(accountRef, { adminActivatedPlugins: newActivePlugins }); // Use adminActivatedPlugins
        }
      });

      // 3. Actualizar los custom claims del usuario en Firebase Authentication
      // El accountId es el UID del usuario en Firebase Auth
      // Solo actualizamos si hubo un cambio en la transacción
      if (updatedInTransaction) {
        await admin.default.auth().setCustomUserClaims(accountId, { adminActivatedPlugins: newActivePlugins });

        // Opcional: Forzar la actualización del token del usuario para que los cambios sean inmediatos
        await admin.default.auth().revokeRefreshTokens(accountId);
      }

      return { status: 'success', message: `Plugin ${pluginId} ${action}d for account ${accountId}.` };
    } catch (error: any) {
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      console.error('Error managing client plugin:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Error al gestionar el plugin del cliente.',
        error.message
      );
    }
  });