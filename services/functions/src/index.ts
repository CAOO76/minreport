import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore"; // Importar FieldValue

// Asegúrate de que Firebase Admin esté inicializado
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const togglePluginStatus = onCall(
  { region: "southamerica-west1" },
  async (request) => {
    // 1. Verificar autenticación y rol de administrador
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'La función requiere autenticación.'
      );
    }

    // Asumiendo que el claim 'admin' se establece en true para administradores
    if (!request.auth.token || request.auth.token.admin !== true) {
      throw new HttpsError(
        'permission-denied',
        'Solo los administradores pueden realizar esta acción.'
      );
    }

    // 2. Validar parámetros de entrada
    const { accountId, pluginId, isActive } = request.data;

    if (typeof accountId !== 'string' || accountId.trim() === '') {
      throw new HttpsError(
        'invalid-argument',
        'El ID de la cuenta (accountId) es obligatorio y debe ser una cadena no vacía.'
      );
    }
    if (typeof pluginId !== 'string' || pluginId.trim() === '') {
      throw new HttpsError(
        'invalid-argument',
        'El ID del plugin (pluginId) es obligatorio y debe ser una cadena no vacía.'
      );
    }
    if (typeof isActive !== 'boolean') {
      throw new HttpsError(
        'invalid-argument',
        'El estado activo (isActive) es obligatorio y debe ser un booleano.'
      );
    }

    // 3. Actualizar el documento de la cuenta en Firestore
    const accountRef = db.collection('accounts').doc(accountId);

    try {
      console.warn(`[togglePluginStatus] Inicio de ejecución para accountId: ${accountId}, pluginId: ${pluginId}, isActive: ${isActive}`);

      // 1. Fetch current account data
      console.warn(`[togglePluginStatus] Obteniendo datos de la cuenta ${accountId}...`);
      const accountDoc = await accountRef.get();
      if (!accountDoc.exists) {
        console.warn(`[togglePluginStatus] Error: Cuenta ${accountId} no encontrada.`);
        throw new HttpsError('not-found', 'Cuenta no encontrada.');
      }
      const currentAccountData = accountDoc.data() as { activePlugins?: { [key: string]: boolean } };
      const currentActivePluginsMap = currentAccountData.activePlugins || {};
      console.warn(`[togglePluginStatus] Datos actuales de activePlugins:`, currentActivePluginsMap);

      // 2. Update activePlugins map
      const updatedActivePluginsMap = { ...currentActivePluginsMap };
      if (isActive) {
        updatedActivePluginsMap[pluginId] = true;
      }
      else {
        delete updatedActivePluginsMap[pluginId];
      }
      console.warn(`[togglePluginStatus] activePlugins actualizado (mapa):`, updatedActivePluginsMap);

      // 3. Update Firestore
      console.warn(`[togglePluginStatus] Actualizando Firestore para cuenta ${accountId}...`);
      await accountRef.update({
        activePlugins: updatedActivePluginsMap,
      });
      console.warn(`[togglePluginStatus] Firestore actualizado para cuenta ${accountId}.`);

      // 4. Prepare claims: Convert map to array of active plugin IDs
      const activePluginIdsArray = Object.keys(updatedActivePluginsMap).filter(
        (key) => updatedActivePluginsMap[key] === true
      );
      console.warn(`[togglePluginStatus] activePluginIdsArray para claims:`, activePluginIdsArray);

      // 5. Update Custom Claims
      console.warn(`[togglePluginStatus] Estableciendo custom claims para ${accountId}...`);
      await admin.auth().setCustomUserClaims(accountId, { activePlugins: activePluginIdsArray });
      console.warn(`[togglePluginStatus] Custom claims establecidos para ${accountId}.`);

      // Opcional: Registrar la acción para auditoría
      console.warn(`[togglePluginStatus] Registrando acción en historial para ${accountId}...`);
      await accountRef.collection('history').add({
        timestamp: FieldValue.serverTimestamp(),
        action: 'plugin_status_toggled',
        actor: request.auth.uid,
        details: `Plugin '${pluginId}' ${isActive ? 'activado' : 'desactivado'}. Custom claims actualizados.`,
      });
      console.warn(`[togglePluginStatus] Acción registrada en historial.`);

      // Return detailed status for client-side debugging
      return { 
        success: true, 
        message: `Plugin '${pluginId}' para la cuenta '${accountId}' actualizado a ${isActive}. Custom claims actualizados.`,
        updatedActivePluginsMap: updatedActivePluginsMap,
        activePluginIdsArray: activePluginIdsArray
      };
    } catch (error: any) {
      console.warn('[togglePluginStatus] Error en la ejecución de la función:', error);
      throw new HttpsError(
        'internal',
        'Error al actualizar el estado del plugin o los claims.',
        error
      );
    }
  }
);

export const setAdminClaim = onCall(
  { region: "southamerica-west1" }, // Asegúrate de usar la región correcta
  async (request) => {
    // 1. Verificar autenticación y rol de administrador (opcional, pero buena práctica)
    // Para la primera ejecución, puedes comentar esta sección si no tienes un admin claim
    // if (!request.auth) {
    //   throw new HttpsError(
    //     'unauthenticated',
    //     'La función requiere autenticación.'
    //   );
    // }
    // if (!request.auth.token || request.auth.token.admin !== true) {
    //   throw new HttpsError(
    //     'permission-denied',
    //     'Solo los administradores pueden realizar esta acción.'
    //   );
    // }

    // 2. Validar parámetros de entrada
    const { email } = request.data;

    if (typeof email !== 'string' || email.trim() === '') {
      throw new HttpsError(
        'invalid-argument',
        'El correo electrónico (email) es obligatorio y debe ser una cadena no vacía.'
      );
    }

    try {
      // 3. Encontrar al usuario por su email
      const userRecord = await admin.auth().getUserByEmail(email);

      // 4. Asignarle el custom claim: { admin: true }
      await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });

      // Opcional: Forzar la actualización del token del usuario
      // Esto asegura que el nuevo claim sea efectivo inmediatamente en el cliente
      await admin.auth().revokeRefreshTokens(userRecord.uid);

      return { success: true, message: `El usuario ${email} ahora es administrador.` };
    } catch (error) {
      console.error('Error al asignar el claim de administrador:', error);
      throw new HttpsError(
        'internal',
        'Error al asignar el claim de administrador.',
        error
      );
    }
  }
);