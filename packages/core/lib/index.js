import admin from "firebase-admin";
let db; // Declare db, but initialize lazily
// Function to get Firestore instance, ensuring it's initialized only once
const getFirestoreInstance = () => {
    if (!admin.apps.length) { // Check if app is already initialized
        admin.initializeApp();
    }
    if (!db) {
        db = admin.firestore();
    }
    return db;
};
/**
 * Función para manejar la solicitud inicial de acceso a MINREPORT.
 * Recibe los datos del formulario, valida y crea un documento en la colección 'requests'.
 */
export const requestInitialRegistration = async (data) => {
    const firestore = getFirestoreInstance(); // Get Firestore instance
    // 1. Validar que los datos requeridos estén presentes
    const { requesterName, requesterEmail, rut, institutionName, requestType } = data;
    if (!requesterName || !requesterEmail || !rut || !institutionName || !requestType) {
        throw { code: "invalid-argument", message: "Todos los campos son obligatorios." };
    }
    // Validar formato de email básico
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(requesterEmail)) { // Corrected regex
        throw { code: "invalid-argument", message: "Formato de correo electrónico inválido." };
    }
    // Validar tipo de solicitud
    if (requestType !== 'B2B' && requestType !== 'EDUCATIONAL') {
        throw { code: "invalid-argument", message: "Tipo de solicitud inválido." };
    }
    // 2. Verificar si ya existe una cuenta activa con este RUT
    const existingAccountSnapshot = await firestore.collection('accounts')
        .where('rut', '==', rut)
        .where('status', '==', 'active')
        .get();
    if (!existingAccountSnapshot.empty) {
        throw { code: "already-exists", message: "Ya existe una cuenta activa asociada a este RUT." };
    }
    // 3. Verificar si ya existe una solicitud pendiente o en proceso para este RUT
    const existingPendingRequestSnapshot = await firestore.collection('requests')
        .where('rut', '==', rut)
        .where('status', 'in', ['pending_review', 'pending_additional_data'])
        .get();
    if (!existingPendingRequestSnapshot.empty) {
        throw { code: "already-exists", message: "Ya existe una solicitud pendiente o en proceso para este RUT." };
    }
    // 4. Crear el nuevo documento de solicitud en Firestore
    const newRequestRef = await firestore.collection('requests').add({
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
};
//# sourceMappingURL=index.js.map