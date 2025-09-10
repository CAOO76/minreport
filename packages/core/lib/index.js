import * as functions from "firebase-functions";
import admin from "firebase-admin";
admin.initializeApp();
const db = admin.firestore();
/**
 * Cloud Function para manejar la solicitud inicial de acceso a MINREPORT.
 * Recibe los datos del formulario, valida y crea un documento en la colección 'requests'.
 */
export const requestInitialRegistration = functions
    .region("southamerica-west1") // Aseguramos la región correcta
    .https.onCall(async (data) => {
    // 1. Validar que los datos requeridos estén presentes
    const { requesterName, requesterEmail, rut, institutionName, requestType } = data;
    if (!requesterName || !requesterEmail || !rut || !institutionName || !requestType) {
        throw new functions.https.HttpsError("invalid-argument", "Todos los campos son obligatorios.");
    }
    // Validar formato de email básico
    if (!/^[^"]@"[^"]+\.[^"]+$/.test(requesterEmail)) {
        throw new functions.https.HttpsError("invalid-argument", "Formato de correo electrónico inválido.");
    }
    // Validar tipo de solicitud
    if (requestType !== 'B2B' && requestType !== 'EDUCATIONAL') {
        throw new functions.https.HttpsError("invalid-argument", "Tipo de solicitud inválido.");
    }
    // 2. Verificar si ya existe una cuenta activa con este RUT
    const existingAccountSnapshot = await db.collection('accounts')
        .where('rut', '==', rut)
        .where('status', '==', 'active')
        .get();
    if (!existingAccountSnapshot.empty) {
        throw new functions.https.HttpsError("already-exists", "Ya existe una cuenta activa asociada a este RUT.");
    }
    // 3. Verificar si ya existe una solicitud pendiente o en proceso para este RUT
    const existingPendingRequestSnapshot = await db.collection('requests')
        .where('rut', '==', rut)
        .where('status', 'in', ['pending_review', 'pending_additional_data'])
        .get();
    if (!existingPendingRequestSnapshot.empty) {
        throw new functions.https.HttpsError("already-exists", "Ya existe una solicitud pendiente o en proceso para este RUT.");
    }
    // 4. Crear el nuevo documento de solicitud en Firestore
    const newRequestRef = await db.collection('requests').add({
        requesterName,
        requesterEmail,
        rut,
        institutionName,
        requestType,
        status: 'pending_review',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, message: "Solicitud enviada con éxito.", requestId: newRequestRef.id };
});
//# sourceMappingURL=index.js.map