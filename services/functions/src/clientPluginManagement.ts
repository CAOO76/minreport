// services/functions/src/clientPluginManagement.ts
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ManageClientPluginsCallableData {
  accountId: string;
  pluginId: string;
  action: 'activate' | 'deactivate';
}

export const manageClientPluginsCallable = functions
  .region('southamerica-west1')
  .https.onCall(async (data: ManageClientPluginsCallableData, context: functions.https.CallableContext) => {
    // 1. Verificar autenticación y permisos de administrador
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'La solicitud debe estar autenticada.'
      );
    }

    const callerUid = context.auth.uid;
    const userRecord = await admin.auth().getUser(callerUid);
    if (!userRecord.customClaims?.admin) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Solo los administradores pueden realizar esta acción.'
      );
    }

    // 2. Validar datos de entrada
    const { accountId, pluginId, action } = data;

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

    try {
      await db.runTransaction(async (transaction) => {
        const accountDoc = await transaction.get(accountRef);

        if (!accountDoc.exists) {
          throw new functions.https.HttpsError(
            'not-found',
            'La cuenta especificada no existe.'
          );
        }

        const currentActivePlugins: string[] = accountDoc.data()?.activePlugins || [];
        let newActivePlugins = [...currentActivePlugins];
        let updated = false;

        if (action === 'activate') {
          if (!newActivePlugins.includes(pluginId)) {
            newActivePlugins.push(pluginId);
            updated = true;
          }
        } else { // action === 'deactivate'
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

      // 3. Actualizar los custom claims del usuario en Firebase Authentication
      // El accountId es el UID del usuario en Firebase Auth
      await admin.auth().setCustomUserClaims(accountId, { activePlugins: newActivePlugins });

      // Opcional: Forzar la actualización del token del usuario para que los cambios sean inmediatos
      // Esto invalidará el token actual del usuario, forzándolo a obtener uno nuevo en su próxima solicitud
      // await admin.auth().revokeRefreshTokens(accountId);

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