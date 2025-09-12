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
const express_1 = __importDefault(require("express"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const resend_1 = require("resend"); // Importar Resend
const core_1 = require("@minreport/core");
// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore(); // Initialize Firestore
// Inicializar Resend con tu clave API
// ¡IMPORTANTE: En producción, usa una variable de entorno para la clave API!
const resend = new resend_1.Resend(process.env.RESEND_API_KEY || 're_YOUR_RESEND_API_KEY');
const app = (0, express_1.default)();
app.use(express_1.default.json()); // Enable JSON body parsing
// Configuración explícita de CORS
app.use((0, cors_1.default)({
    origin: 'https://minreport-x.web.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).send('Service is running.');
});
// Endpoint for initial registration requests
app.post('/requestInitialRegistration', async (req, res) => {
    try {
        // Call the core function with the request body
        const result = await (0, core_1.requestInitialRegistration)(req.body);
        res.status(200).json(result);
    }
    catch (error) {
        // Handle HttpsError from Firebase Functions
        if (error.code && error.message) {
            res.status(400).json({ code: error.code, message: error.message });
        }
        else {
            console.error('Error:', error);
            res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
        }
    }
});
// New endpoint to approve a registration request
app.post('/approveRequest', async (req, res) => {
    try {
        const { requestId } = req.body;
        if (!requestId) {
            return res.status(400).json({ code: 'invalid-argument', message: 'Request ID is required.' });
        }
        const requestRef = db.collection('requests').doc(requestId);
        const doc = await requestRef.get();
        if (!doc.exists) {
            return res.status(404).json({ code: 'not-found', message: 'Request not found.' });
        }
        // Update the status to pending_additional_data
        await requestRef.update({ status: 'pending_additional_data' });
        // Log the action (optional, but good for audit)
        await db.collection('account_logs').add({
            accountId: requestId, // Using requestId as accountId for now, will be replaced with actual accountId later
            action: 'request_approved_initial',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Solicitud ${requestId} aprobada inicialmente.`,
        });
        res.status(200).json({ code: 'success', message: 'Request approved successfully. Email sent.' });
    }
    catch (error) {
        console.error('Error approving request:', error);
        res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
    }
});
// Helper function to send emails
async function sendEmail(to, subject, htmlContent) {
    try {
        const { data, error } = await resend.emails.send({
            from: 'MINREPORT <no-reply@minreport.com>', // Reemplazar con tu dominio verificado en Resend
            to: [to],
            subject: subject,
            html: htmlContent,
        });
        if (error) {
            console.error('Error sending email:', error);
            return { success: false, error };
        }
        console.log('Email sent successfully:', data);
        return { success: true, data };
    }
    catch (error) {
        console.error('Unexpected error in sendEmail:', error);
        return { success: false, error: 'Unexpected error' };
    }
}
// New endpoint to reject a registration request
app.post('/rejectRequest', async (req, res) => {
    try {
        const { requestId, reason } = req.body;
        if (!requestId) {
            return res.status(400).json({ code: 'invalid-argument', message: 'Request ID is required.' });
        }
        const requestRef = db.collection('requests').doc(requestId);
        const doc = await requestRef.get();
        if (!doc.exists) {
            return res.status(404).json({ code: 'not-found', message: 'Request not found.' });
        }
        // Update the status to rejected
        await requestRef.update({ status: 'rejected', rejectionReason: reason || 'No especificado' });
        // Log the action
        await db.collection('account_logs').add({
            accountId: requestId,
            action: 'request_rejected',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Solicitud ${requestId} rechazada. Razón: ${reason || 'No especificado'}.`,
        });
        // Send rejection email
        const requestData = doc.data(); // Assert type
        const applicantEmail = requestData.applicantEmail;
        if (applicantEmail) {
            const subject = 'Tu solicitud a MINREPORT ha sido rechazada';
            const htmlContent = `
        <p>Estimado/a ${requestData.applicantName},</p>
        <p>Lamentamos informarte que tu solicitud de acceso a MINREPORT ha sido rechazada.</p>
        <p>Razón: ${reason || 'No especificado'}</p>
        <p>Si tienes alguna pregunta, por favor, contáctanos.</p>
        <p>Atentamente,</p>
        <p>El equipo de MINREPORT</p>
      `;
            await sendEmail(applicantEmail, subject, htmlContent);
        }
        res.status(200).json({ code: 'success', message: 'Request rejected successfully.' });
    }
    catch (error) {
        console.error('Error rejecting request:', error);
        res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
    }
});
// New endpoint to submit additional data
app.post('/submitAdditionalData', async (req, res) => {
    try {
        const { requestId, token, additionalData } = req.body;
        if (!requestId || !token || !additionalData) {
            return res.status(400).json({ code: 'invalid-argument', message: 'Request ID, token, and additional data are required.' });
        }
        const requestRef = db.collection('requests').doc(requestId);
        const doc = await requestRef.get();
        if (!doc.exists) {
            return res.status(404).json({ code: 'not-found', message: 'Request not found.' });
        }
        const requestData = doc.data(); // Assert type
        // Validate token and expiry
        if (requestData.additionalDataToken !== token || requestData.additionalDataTokenExpiry < admin.firestore.Timestamp.now().toMillis()) {
            return res.status(401).json({ code: 'unauthorized', message: 'Invalid or expired token.' });
        }
        // Update the status to pending_final_review and store additional data
        await requestRef.update({
            status: 'pending_final_review',
            additionalData: additionalData, // Store the received additional data
            additionalDataToken: admin.firestore.FieldValue.delete(), // Remove token after use
            additionalDataTokenExpiry: admin.firestore.FieldValue.delete(), // Remove expiry after use
        });
        // Log the action
        await db.collection('account_logs').add({
            accountId: requestId,
            action: 'additional_data_submitted',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Datos adicionales enviados para la solicitud ${requestId}.`,
        });
        // Optional: Send email notification to admin that additional data has been submitted
        // const adminEmail = 'admin@minreport.com'; // Replace with actual admin email
        // const subject = `Datos adicionales enviados para la solicitud ${requestId}`;
        // const htmlContent = `<p>Datos adicionales para la solicitud ${requestId} han sido enviados. Por favor, revisa el panel de administración.</p>`;
        // await sendEmail(adminEmail, subject, htmlContent);
        res.status(200).json({ code: 'success', message: 'Additional data submitted successfully.' });
    }
    catch (error) {
        console.error('Error submitting additional data:', error);
        res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
    }
});
// New endpoint to finalize approval and create account
app.post('/finalApproveRequest', async (req, res) => {
    try {
        const { requestId } = req.body;
        if (!requestId) {
            return res.status(400).json({ code: 'invalid-argument', message: 'Request ID is required.' });
        }
        const requestRef = db.collection('requests').doc(requestId);
        const doc = await requestRef.get();
        if (!doc.exists) {
            return res.status(404).json({ code: 'not-found', message: 'Request not found.' });
        }
        const requestData = doc.data(); // Assert type
        // Ensure request is in pending_final_review state
        if (requestData.status !== 'pending_final_review') {
            return res.status(400).json({ code: 'invalid-state', message: 'Request is not in pending_final_review state.' });
        }
        // 1. Create user in Firebase Authentication
        const userRecord = await admin.auth().createUser({
            email: requestData.applicantEmail,
            emailVerified: false, // User will verify via password creation link
            displayName: requestData.applicantName,
            // password: 'some-initial-password' // Do not set password here, user creates it via link
        });
        // 2. Create account in Firestore 'accounts' collection
        const newAccountRef = db.collection('accounts').doc(userRecord.uid); // Use UID as account ID
        await newAccountRef.set({
            id: userRecord.uid,
            institutionName: requestData.institutionName,
            accountType: requestData.accountType,
            status: 'active',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            applicantEmail: requestData.applicantEmail,
            applicantName: requestData.applicantName,
            rut: requestData.rut,
            additionalData: requestData.additionalData || {}, // Include additional data
        });
        // 3. Update request status to 'approved'
        await requestRef.update({ status: 'approved', accountId: userRecord.uid });
        // 4. Generate password reset link for user to set their password
        const passwordResetLink = await admin.auth().generatePasswordResetLink(requestData.applicantEmail);
        // 5. Log the action
        await db.collection('account_logs').add({
            accountId: userRecord.uid,
            action: 'account_approved_final',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Cuenta creada y solicitud ${requestId} aprobada finalmente. UID: ${userRecord.uid}.`,
        });
        // 6. Send email with password creation link
        const subject = '¡Tu cuenta MINREPORT ha sido aprobada!';
        const htmlContent = `
      <p>Estimado/a ${requestData.applicantName},</p>
      <p>¡Felicidades! Tu solicitud de acceso a MINREPORT ha sido aprobada.</p>
      <p>Para establecer tu contraseña y acceder a tu cuenta, por favor, haz clic en el siguiente enlace:</p>
      <p><a href="${passwordResetLink}">${passwordResetLink}</a></p>
      <p>Este enlace es válido por un tiempo limitado.</p>
      <p>Atentamente,</p>
      <p>El equipo de MINREPORT</p>
    `;
        await sendEmail(requestData.applicantEmail, subject, htmlContent);
        res.status(200).json({ code: 'success', message: 'Account created and request finally approved. Email sent.' });
    }
    catch (error) {
        console.error('Error finalizing approval:', error);
        if (error.code === 'auth/email-already-exists') {
            res.status(409).json({ code: 'auth/email-already-exists', message: 'The email address is already in use by another account.' });
        }
        else {
            res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
        }
    }
});
// New endpoint to finalize rejection
app.post('/finalRejectRequest', async (req, res) => {
    try {
        const { requestId, reason } = req.body;
        if (!requestId) {
            return res.status(400).json({ code: 'invalid-argument', message: 'Request ID is required.' });
        }
        const requestRef = db.collection('requests').doc(requestId);
        const doc = await requestRef.get();
        if (!doc.exists) {
            return res.status(404).json({ code: 'not-found', message: 'Request not found.' });
        }
        const requestData = doc.data(); // Assert type
        // Ensure request is in pending_final_review state
        if (requestData.status !== 'pending_final_review') {
            return res.status(400).json({ code: 'invalid-state', message: 'Request is not in pending_final_review state.' });
        }
        // Update the status to rejected
        await requestRef.update({ status: 'rejected', rejectionReason: reason || 'No especificado' });
        // Log the action
        await db.collection('account_logs').add({
            accountId: requestId,
            action: 'request_rejected_final',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Solicitud ${requestId} rechazada finalmente. Razón: ${reason || 'No especificado'}.`,
        });
        // Send rejection email
        const applicantEmail = requestData.applicantEmail;
        if (applicantEmail) {
            const subject = 'Tu solicitud a MINREPORT ha sido rechazada';
            const htmlContent = `
        <p>Estimado/a ${requestData.applicantName},</p>
        <p>Lamentamos informarte que tu solicitud de acceso a MINREPORT ha sido rechazada definitivamente.</p>
        <p>Razón: ${reason || 'No especificado'}</p>
        <p>Si tienes alguna pregunta, por favor, contáctanos.</p>
        <p>Atentamente,</p>
        <p>El equipo de MINREPORT</p>
      `;
            await sendEmail(applicantEmail, subject, htmlContent);
        }
        res.status(200).json({ code: 'success', message: 'Request finally rejected. Email sent.' });
    }
    catch (error) {
        console.error('Error finalizing rejection:', error);
        res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
    }
});
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
