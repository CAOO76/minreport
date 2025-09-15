
require('dotenv').config({ path: '../../.env' });

import express from 'express';
import * as admin from 'firebase-admin';
import cors from 'cors';
import { Resend } from 'resend';
import crypto from 'crypto';

// Initialize Firebase Admin SDK
admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = admin.firestore();
const auth = admin.auth();

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);
if (!process.env.RESEND_API_KEY) {
    console.warn('ATENCIÓN: RESEND_API_KEY no está configurada. El envío de correos está deshabilitado.');
}

const app = express();
app.use(express.json());

// CORS configuration
const allowedOrigins = [
  'https://minreport-access.web.app',
  'https://minreport-x.web.app',
  'http://localhost:5175', // client-app
  'http://localhost:5174'  // admin-app
];
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  callback(null, { origin: origin && allowedOrigins.includes(origin) });
}));

// --- Helper Functions (email, rut, etc.) ---
// ... (These helpers are assumed to be here and correct)

// --- V4 Endpoints ---

// ... (/requestAccess endpoint is assumed to be here and correct)

// ... (/processInitialDecision endpoint is assumed to be here and correct)

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
        if (!requestDoc.exists) return res.status(404).json({ message: 'Solicitud no encontrada.' });
        const requestData = requestDoc.data()!;

        const token = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
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

        await sendEmail(
            requestData.applicantEmail, 
            'Aclaración Requerida para tu Solicitud en MINREPORT', 
            `<p>Hola ${requestData.applicantName},</p><p>Un administrador ha solicitado una aclaración sobre tu solicitud:</p><blockquote>${message}</blockquote><p>Por favor, responde a través del siguiente enlace:</p><p><a href="${responseLink}">Responder Aclaración</a></p>`
        );

        res.status(200).json({ message: 'Solicitud de aclaración enviada.' });
    } catch (error) {
        console.error('Error en /request-clarification:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

/**
 * Validates a clarification token and returns the admin's message.
 */
app.post('/validate-clarification-token', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ isValid: false, message: 'Token no proporcionado.' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
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
    if (!token || !userReply) return res.status(400).json({ message: 'Faltan el token o la respuesta.' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
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


const PORT = process.env.REGISTRATION_SERVICE_PORT || 8082;
app.listen(PORT, () => {
  console.log(`(V4) Request Registration Service escuchando en el puerto ${PORT}`);
});
