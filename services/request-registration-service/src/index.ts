import express from 'express';
import * as admin from 'firebase-admin';
import cors from 'cors';
import { Resend } from 'resend'; // Importar Resend
import { requestInitialRegistration } from '@minreport/core';

// Initialize Firebase Admin SDK
admin.initializeApp();

const db = admin.firestore(); // Initialize Firestore

// Inicializar Resend con tu clave API
// ¡IMPORTANTE: En producción, usa una variable de entorno para la clave API!
const resend = new Resend(process.env.RESEND_API_KEY || 're_YOUR_RESEND_API_KEY');

const app = express();
app.use(express.json()); // Enable JSON body parsing

// Lista de orígenes permitidos
const allowedOrigins = [
  'https://minreport-access.web.app', // URL de clientes
  'https://minreport-x.web.app',       // URL de administración
  'http://localhost:5173',            // Vite dev server para client-app
  'http://localhost:5174'             // Vite dev server para admin-app
];

// Configuración dinámica de CORS
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  let corsOptions: { origin: boolean | string | string[] } = { origin: false }; // Por defecto, denegar

  if (origin && allowedOrigins.includes(origin)) {
    corsOptions.origin = true; // Permitir si el origen está en la lista
  } else if (!origin) {
    // Permitir solicitudes sin origen (como Postman o peticiones de servidor a servidor)
    // En un entorno de producción estricto, podrías querer bloquear esto.
    corsOptions.origin = true; 
  }

  callback(null, corsOptions); // Devolver la configuración de CORS
}));

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('Service is running.');
});

// Endpoint for initial registration requests
app.post('/requestInitialRegistration', async (req, res) => {
  try {
    // Call the core function with the request body
    const result = await requestInitialRegistration(req.body);
    res.status(200).json(result);
  } catch (error: any) {
    // Handle HttpsError from Firebase Functions
    if (error.code && error.message) {
      res.status(400).json({ code: error.code, message: error.message });
    } else {
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
  } catch (error) {
    console.error('Error approving request:', error);
    res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
  }
});

// Helper function to send emails
async function sendEmail(to: string, subject: string, htmlContent: string) {
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
  } catch (error) {
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
    const requestData = doc.data() as any; // Assert type
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
  } catch (error) {
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

    const requestData = doc.data() as any; // Assert type

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
  } catch (error) {
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

    const requestData = doc.data() as any; // Assert type

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
  } catch (error: any) {
    console.error('Error finalizing approval:', error);
    if (error.code === 'auth/email-already-exists') {
      res.status(409).json({ code: 'auth/email-already-exists', message: 'The email address is already in use by another account.' });
    } else {
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

    const requestData = doc.data() as any; // Assert type

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
  } catch (error) {
    console.error('Error finalizing rejection:', error);
    res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
  }
});

const PORT = process.env.REGISTRATION_SERVICE_PORT || 8082;
app.listen(PORT, () => {
  console.log(`Request Registration Service escuchando en el puerto ${PORT}`);
});