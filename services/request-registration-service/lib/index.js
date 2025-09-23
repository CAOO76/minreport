"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config({ path: '../../.env' });
const express_1 = __importDefault(require("express"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const resend_1 = require("resend");
const crypto_1 = __importDefault(require("crypto"));
// Initialize Firebase Admin SDK
admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = admin.firestore();
const auth = admin.auth();
// Initialize Resend
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
if (!process.env.RESEND_API_KEY) {
    console.warn('ATENCIÓN: RESEND_API_KEY no está configurada. El envío de correos está deshabilitado.');
}
else {
    console.log('RESEND_API_KEY está configurada.'); // Add this line
}
const app = (0, express_1.default)();
app.use(express_1.default.json());
// CORS configuration
const allowedOrigins = [
    'https://minreport-access.web.app',
    'https://minreport-x.web.app',
    'http://localhost:5175', // client-app
    'http://localhost:5174' // admin-app
];
app.use((0, cors_1.default)((req, callback) => {
    const origin = req.header('Origin');
    callback(null, { origin: origin && allowedOrigins.includes(origin) });
}));
// --- Helper Functions (email, rut, etc.) ---
async function sendEmail(to, subject, htmlContent) {
    if (!process.env.RESEND_API_KEY) {
        console.log(`SIMULANDO EMAIL a ${to} con asunto: ${subject}`);
        console.log(`SIMULACIÓN: Asunto: ${subject}, Destinatario: ${to}`); // Log simulation outcome
        return { success: true };
    }
    try {
        const { data, error } = await resend.emails.send({ from: 'MINREPORT <no-reply@minreport.com>', to: [to], subject, html: htmlContent });
        if (error) {
            console.error('Error enviando email (Resend API):', error); // Log Resend API error
            throw error; // Re-throw to be caught by caller
        }
        console.log(`EMAIL ENVIADO: Asunto: ${subject}, Destinatario: ${to}, Resend Data:`, data); // Log success
        return { success: true, data };
    }
    catch (error) {
        console.error('Error general enviando email:', error.message); // Log general error
        return { success: false, error };
    }
}
// --- V4 Endpoints ---
app.post('/requestAccess', async (req, res) => {
    const { applicantName, applicantEmail, rut, institutionName, accountType, country, city, entityType } = req.body;
    if (!applicantName || !applicantEmail || !accountType || !country || !entityType) {
        return res.status(400).json({ message: 'Faltan parámetros obligatorios.' });
    }
    try {
        const requestRef = db.collection('requests').doc();
        await requestRef.set({
            applicantName,
            applicantEmail,
            rut: rut || null, // RUT is optional for individual
            institutionName: institutionName || null, // Institution name is optional for individual
            accountType,
            country,
            city: city || null, // City is optional for non-individual
            entityType,
            status: 'pending_review',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Log history for the request
        await requestRef.collection('history').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: 'request_submitted',
            actor: 'applicant',
            details: 'Solicitud de acceso enviada por el solicitante.',
        });
        res.status(200).json({ message: 'Solicitud de acceso registrada con éxito.' });
    }
    catch (error) {
        console.error('Error en /requestAccess:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});
// ... (/requestAccess endpoint is assumed to be here and correct)
app.post('/processInitialDecision', async (req, res) => {
    const { requestId, adminId, decision, reason } = req.body;
    if (!requestId || !adminId || !decision) {
        return res.status(400).json({ message: 'Faltan parámetros obligatorios (requestId, adminId, decision).' });
    }
    const requestRef = db.collection('requests').doc(requestId);
    try {
        const requestDoc = await requestRef.get();
        if (!requestDoc.exists)
            return res.status(404).json({ message: 'Solicitud no encontrada.' });
        const requestData = requestDoc.data(); // Fetch requestData
        let newStatus;
        let actionDetails;
        if (decision === 'approved') {
            newStatus = 'pending_additional_data';
            actionDetails = 'Aprobación inicial por administrador.';
            // Generate token for additional data completion
            const token = crypto_1.default.randomBytes(32).toString('hex');
            const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
            const expiryDate = new Date();
            expiryDate.setHours(expiryDate.getHours() + 24); // 24-hour expiry for data completion
            await requestRef.update({
                token: hashedToken,
                tokenExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
            });
            const clientAppUrl = process.env.CLIENT_APP_URL || 'http://localhost:5175';
            const completeDataLink = `${clientAppUrl}/complete-data?token=${token}`;
            await sendEmail(requestData.applicantEmail, 'Tu Solicitud en MINREPORT ha sido Pre-Aprobada', `<p>Hola ${requestData.applicantName},</p><p>Tu solicitud de acceso a MINREPORT ha sido pre-aprobada.</p><p>Por favor, completa la información adicional requerida a través del siguiente enlace:</p><p><a href="${completeDataLink}">Completar Datos Adicionales</a></p><p>Este enlace expirará en 24 horas.</p>`);
        }
        else if (decision === 'rejected') {
            newStatus = 'rejected';
            actionDetails = `Rechazo inicial por administrador. Motivo: ${reason || 'No especificado'}`;
            await sendEmail(requestData.applicantEmail, 'Actualización de tu Solicitud en MINREPORT', `<p>Hola ${requestData.applicantName},</p><p>Lamentamos informarte que tu solicitud de acceso a MINREPORT ha sido rechazada.</p><p>Motivo: ${reason || 'No especificado'}</p><p>Si tienes alguna pregunta, por favor contáctanos.</p>`);
        }
        else {
            return res.status(400).json({ message: 'Decisión inválida.' });
        }
        await requestRef.update({
            status: newStatus,
        });
        await requestRef.collection('history').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: `initial_decision_${decision}`,
            actor: adminId,
            details: actionDetails,
        });
        res.status(200).json({ message: 'Decisión inicial procesada con éxito.' });
    }
    catch (error) {
        console.error('Error en /processInitialDecision:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});
// ... (/processInitialDecision endpoint is assumed to be here and correct)
app.post('/validate-data-token', async (req, res) => {
    const { token } = req.body;
    if (!token)
        return res.status(400).json({ isValid: false, message: 'Token no proporcionado.' });
    const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
    const snapshot = await db.collectionGroup('requests').where('token', '==', hashedToken).limit(1).get();
    if (snapshot.empty) {
        return res.status(404).json({ isValid: false, message: 'Enlace inválido o ya utilizado.' });
    }
    const requestDoc = snapshot.docs[0];
    const requestData = requestDoc.data();
    if (requestData.status !== 'pending_additional_data') {
        return res.status(400).json({ isValid: false, message: 'Esta solicitud ya fue completada o no requiere datos adicionales.' });
    }
    if (requestData.tokenExpiry && requestData.tokenExpiry.toDate() < new Date()) {
        return res.status(400).json({ isValid: false, message: 'El enlace ha expirado.' });
    }
    res.status(200).json({ isValid: true, requestData: { requestId: requestDoc.id, applicantName: requestData.applicantName, applicantEmail: requestData.applicantEmail, country: requestData.country, accountType: requestData.accountType } });
});
app.post('/submitAdditionalData', async (req, res) => {
    const { token, additionalData } = req.body;
    if (!token || !additionalData) {
        return res.status(400).json({ message: 'Token y datos adicionales son requeridos.' });
    }
    const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
    const snapshot = await db.collectionGroup('requests').where('token', '==', hashedToken).limit(1).get();
    if (snapshot.empty) {
        return res.status(404).json({ message: 'Enlace inválido o ya utilizado.' });
    }
    const requestDoc = snapshot.docs[0];
    const requestData = requestDoc.data();
    if (requestData.status !== 'pending_additional_data') {
        return res.status(400).json({ message: 'Esta solicitud ya fue completada o no requiere datos adicionales.' });
    }
    if (requestData.tokenExpiry && requestData.tokenExpiry.toDate() < new Date()) {
        return res.status(400).json({ message: 'El enlace ha expirado.' });
    }
    // Invalidate the token and save additional data
    await requestDoc.ref.update({
        additionalData: additionalData,
        status: 'pending_final_review',
        token: null, // Invalidate token
        tokenExpiry: null, // Clear expiration
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Log the action
    await requestDoc.ref.collection('history').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        actor: requestData.applicantEmail, // Assuming applicant is the actor
        action: 'additional_data_submitted',
        details: 'Usuario envió datos adicionales.',
    });
    res.status(200).json({ message: 'Datos adicionales enviados con éxito. Pendiente de revisión final.' });
});
app.post('/approveFinalRequest', async (req, res) => {
    const { requestId, adminId } = req.body;
    if (!requestId || !adminId) {
        return res.status(400).json({ message: 'Faltan parámetros obligatorios (requestId, adminId).' });
    }
    const requestRef = db.collection('requests').doc(requestId);
    try {
        console.log('[/approveFinalRequest] Iniciando proceso de aprobación final.');
        const requestDoc = await requestRef.get();
        if (!requestDoc.exists) {
            return res.status(404).json({ message: 'Solicitud no encontrada.' });
        }
        const requestData = requestDoc.data();
        if (requestData.status !== 'pending_final_review') {
            return res.status(400).json({ message: 'La solicitud no está en estado de revisión final.' });
        }
        const { applicantEmail, accountType, rut, additionalData } = requestData;
        // The user to be created is the designated admin from the additional data
        const finalUserEmail = additionalData.adminEmail;
        if (!finalUserEmail) {
            console.error('[/approveFinalRequest] Error: No se proporcionó un email de administrador en los datos adicionales.');
            return res.status(400).json({ message: 'No se proporcionó un email de administrador en los datos adicionales.' });
        }
        console.log(`[/approveFinalRequest] finalUserEmail: ${finalUserEmail}`);
        // 1. Create user in Firebase Auth
        const userRecord = await auth.createUser({
            email: finalUserEmail,
            emailVerified: false, // User will set password and verify email later
            disabled: false,
        });
        console.log(`[/approveFinalRequest] Usuario creado en Auth: ${userRecord.uid}`);
        // 2. Create account document
        await db.collection('accounts').doc(userRecord.uid).set(Object.assign({ userId: userRecord.uid, email: finalUserEmail, accountType,
            rut, status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), institutionName: requestData.institutionName || null }, additionalData));
        console.log('[/approveFinalRequest] Documento de cuenta creado en Firestore.');
        // 3. Update request status
        await requestRef.update({
            status: 'activated',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('[/approveFinalRequest] Estado de solicitud actualizado a "activated".');
        // Log the action
        await requestRef.collection('history').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            actor: adminId,
            action: 'account_activated',
            details: `Cuenta activada por admin ${adminId}. Usuario ${userRecord.uid} creado para ${finalUserEmail}.`,
        });
        console.log('[/approveFinalRequest] Historial de solicitud registrado.');
        // Generate password reset link for the FINAL user
        const actionCodeSettings = {
            url: `${process.env.CLIENT_APP_URL || 'http://localhost:5175'}/actions/create-password`,
            handleCodeInApp: true,
        };
        const rawPasswordLink = await auth.generatePasswordResetLink(finalUserEmail, actionCodeSettings);
        // Extract oobCode and build the final user-facing link
        const url = new URL(rawPasswordLink);
        const oobCode = url.searchParams.get('oobCode');
        const finalPasswordLink = `${actionCodeSettings.url}?oobCode=${oobCode}`;
        console.log(`[/approveFinalRequest] Enlace de contraseña generado: ${finalPasswordLink}`);
        const emailResult = await sendEmail(finalUserEmail, '¡Tu cuenta MINREPORT ha sido activada!', `<p>Hola ${requestData.applicantName},</p><p>¡Felicidades! Tu cuenta MINREPORT ha sido activada.</p><p>Para establecer tu contraseña y acceder a la plataforma, por favor haz clic en el siguiente enlace:</p><p><a href="${finalPasswordLink}">Establecer Contraseña</a></p><p>Este enlace es válido por un tiempo limitado.</p>`);
        console.log('[/approveFinalRequest] Resultado de sendEmail:', emailResult);
        res.status(200).json({ message: 'Cuenta activada con éxito.', userId: userRecord.uid });
    }
    catch (error) {
        console.error('Error al aprobar la solicitud final:', error);
        res.status(500).json({ message: 'Error interno del servidor al aprobar la solicitud final.' });
    }
});
// ... (/validate-data-token endpoint is assumed to be here and correct)
// ... (/submitAdditionalData endpoint is assumed to be here and correct)
// ... (/processFinalDecision endpoint is assumed to be here and correct)
// --- NEW: Clarification Endpoints ---
/**
 * Admin requests clarification from a user.
 */
app.post('/request-clarification', async (req, res) => {
    const { requestId, adminId, message } = req.body;
    if (!requestId || !adminId || !message) {
        return res.status(400).json({ message: 'Faltan parámetros (requestId, adminId, message).' });
    }
    const requestRef = db.collection('requests').doc(requestId);
    try {
        const requestDoc = await requestRef.get();
        if (!requestDoc.exists)
            return res.status(404).json({ message: 'Solicitud no encontrada.' });
        const requestData = requestDoc.data();
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 72); // 3-day expiry for clarification
        const clarificationRef = requestRef.collection('clarifications').doc();
        await clarificationRef.set({
            adminMessage: message,
            status: 'pending_response',
            token: hashedToken,
            tokenExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await requestRef.collection('history').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: 'clarification_requested',
            actor: adminId,
            details: message
        });
        const clientAppUrl = process.env.CLIENT_APP_URL || 'http://localhost:5175';
        const responseLink = `${clientAppUrl}/clarification-response?token=${token}`;
        await sendEmail(requestData.applicantEmail, 'Aclaración Requerida para tu Solicitud en MINREPORT', `<p>Hola ${requestData.applicantName},</p><p>Un administrador ha solicitado una aclaración sobre tu solicitud:</p><blockquote>${message}</blockquote><p>Por favor, responde a través del siguiente enlace:</p><p><a href="${responseLink}">Responder Aclaración</a></p>`);
        res.status(200).json({ message: 'Solicitud de aclaración enviada.' });
    }
    catch (error) {
        console.error('Error en /request-clarification:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});
/**
 * Validates a clarification token and returns the admin's message.
 */
app.post('/validate-clarification-token', async (req, res) => {
    const { token } = req.body;
    if (!token)
        return res.status(400).json({ isValid: false, message: 'Token no proporcionado.' });
    const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
    const snapshot = await db.collectionGroup('clarifications').where('token', '==', hashedToken).limit(1).get();
    if (snapshot.empty) {
        return res.status(404).json({ isValid: false, message: 'Enlace inválido o ya utilizado.' });
    }
    const clarificationDoc = snapshot.docs[0];
    const clarificationData = clarificationDoc.data();
    if (clarificationData.status !== 'pending_response') {
        return res.status(400).json({ isValid: false, message: 'Esta solicitud de aclaración ya fue respondida.' });
    }
    if (clarificationData.tokenExpiry && clarificationData.tokenExpiry.toDate() < new Date()) {
        return res.status(400).json({ isValid: false, message: 'El enlace ha expirado.' });
    }
    res.status(200).json({ isValid: true, adminMessage: clarificationData.adminMessage });
});
/**
 * Submits the user's response to a clarification request.
 */
app.post('/submit-clarification-response', async (req, res) => {
    const { token, userReply } = req.body;
    if (!token || !userReply)
        return res.status(400).json({ message: 'Faltan el token o la respuesta.' });
    const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
    const snapshot = await db.collectionGroup('clarifications').where('token', '==', hashedToken).limit(1).get();
    if (snapshot.empty) {
        return res.status(404).json({ message: 'Enlace inválido o ya utilizado.' });
    }
    const clarificationDoc = snapshot.docs[0];
    const clarificationData = clarificationDoc.data();
    if (clarificationData.status !== 'pending_response') {
        return res.status(400).json({ message: 'Esta solicitud de aclaración ya fue respondida.' });
    }
    await clarificationDoc.ref.update({
        userReply: userReply,
        status: 'responded',
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        token: admin.firestore.FieldValue.delete(),
    });
    // Find the parent request to log history
    const requestRef = clarificationDoc.ref.parent.parent;
    if (requestRef) {
        await requestRef.collection('history').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: 'clarification_responded',
            actor: 'applicant',
            details: userReply
        });
    }
    res.status(200).json({ message: 'Respuesta enviada con éxito.' });
});
app.post('/clear-all-requests', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: 'Esta operación no está permitida en producción.' });
    }
    try {
        const requestsRef = db.collection('requests');
        const snapshot = await requestsRef.get();
        if (snapshot.empty) {
            return res.status(200).json({ message: 'No hay solicitudes para eliminar.' });
        }
        const batch = db.batch();
        let deletedCount = 0;
        for (const doc of snapshot.docs) {
            const requestRef = requestsRef.doc(doc.id);
            // Delete history subcollection
            const historySnapshot = await requestRef.collection('history').get();
            historySnapshot.docs.forEach(historyDoc => {
                batch.delete(historyDoc.ref);
            });
            // Delete clarifications subcollection
            const clarificationsSnapshot = await requestRef.collection('clarifications').get();
            clarificationsSnapshot.docs.forEach(clarificationDoc => {
                batch.delete(clarificationDoc.ref);
            });
            // Delete the request document itself
            batch.delete(requestRef);
            deletedCount++;
        }
        await batch.commit();
        res.status(200).json({ message: `Se eliminaron ${deletedCount} solicitudes y sus historiales/aclaraciones.` });
    }
    catch (error) {
        console.error('Error en /clear-all-requests:', error);
        res.status(500).json({ message: 'Error interno del servidor al eliminar solicitudes.' });
    }
});
const PORT = process.env.REGISTRATION_SERVICE_PORT || 8082;
app.listen(PORT, () => {
    console.log(`(V4) Request Registration Service escuchando en el puerto ${PORT}`);
});
