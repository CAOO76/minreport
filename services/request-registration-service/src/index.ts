require('dotenv').config({ path: '../../.env' });

import express from 'express';
import * as admin from 'firebase-admin';
import cors from 'cors';
import { Resend } from 'resend';

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

// --- Helper Functions ---
async function sendEmail(to: string, subject: string, htmlContent: string) {
    if (!process.env.RESEND_API_KEY) {
        console.log(`SIMULANDO EMAIL a ${to} con asunto: ${subject}`);
        return { success: true };
    }
    try {
        const { data, error } = await resend.emails.send({ from: 'MINREPORT <no-reply@minreport.com>', to: [to], subject, html: htmlContent });
        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error('Error enviando email:', error);
        return { success: false, error };
    }
}

// RUT/RUN Helper Functions
const cleanAndFormatRut = (rut: string): string => {
  rut = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (rut.length > 1) {
    return rut.slice(0, -1) + '-' + rut.slice(-1);
  }
  return rut;
};

const validateRut = (rut: string): boolean => {
  if (!/^[0-9]+[-|‐]{1}[0-9kK]{1}$/.test(rut)) return false;
  let [body, dv] = rut.split('-');
  if (body.length < 7) return false; // RUT body must have at least 7 digits

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const calculatedDv = 11 - (sum % 11);

  if (calculatedDv === 11) return dv === '0';
  if (calculatedDv === 10) return dv === 'K';
  return String(calculatedDv) === dv;
};

const getEntityType = (accountType: string): 'natural' | 'juridica' => {
    return accountType === 'INDIVIDUAL' ? 'natural' : 'juridica';
};

// --- Middleware for Authentication ---
// Extend Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No autorizado: Token no proporcionado o formato incorrecto.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Attach decoded token to request
    next();
  } catch (error) {
    console.error('Error al verificar token:', error);
    return res.status(401).json({ message: 'No autorizado: Token inválido o expirado.' });
  }
};

// --- V3 Endpoints ---

/**
 * (V3) Step 1: User requests access.
 */
app.post('/requestAccess', async (req, res) => {
    const { applicantName, applicantEmail, rut, institutionName, accountType, country } = req.body; 
    
    // Derive entityType
    const entityType = getEntityType(accountType);

    // Basic validation for required fields
    if (!applicantName || !applicantEmail || !accountType || !country) {
        return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    // Conditional validation for RUT/RUN
    let formattedRut = '';
    if (accountType !== 'INDIVIDUAL') {
        if (!rut) return res.status(400).json({ message: 'El RUT de la institución es obligatorio para este tipo de cuenta.' });
        formattedRut = cleanAndFormatRut(rut);
        if (!validateRut(formattedRut)) {
            return res.status(400).json({ message: 'El RUT ingresado no es válido.' });
        }
    }

    try {
        // Check for existing account with this RUT/RUN (only if provided)
        if (formattedRut) {
            const snapshot = await db.collection('accounts').where('rut', '==', formattedRut).limit(1).get();
            if (!snapshot.empty) {
                return res.status(409).json({ message: `Ya existe una cuenta para este RUT/RUN con estado: ${snapshot.docs[0].data().status}.` });
            }
        }

        const newRequestRef = await db.collection('requests').add({ 
            applicantName, 
            applicantEmail, 
            rut: formattedRut, // Will be empty string if INDIVIDUAL
            institutionName: accountType === 'INDIVIDUAL' ? 'N/A' : institutionName, // Store N/A for individual
            accountType, 
            country,
            entityType, 
            status: 'pending_review', 
            createdAt: admin.firestore.FieldValue.serverTimestamp() 
        });
        await newRequestRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'request_created', actor: 'system', details: 'Solicitud creada por el usuario.' });
        
        res.status(201).json({ message: 'Solicitud recibida con éxito.', requestId: newRequestRef.id });
    } catch (error) {
        console.error('Error en /requestAccess:', error);
        res.status(500).json({ message: 'Error interno al crear la solicitud.' });
    }
});

/**
 * (V3) Step 2: Admin makes initial approval/rejection.
 */
app.post('/processInitialDecision', async (req, res) => {
    const { requestId, decision, adminId, reason } = req.body;
    if (!requestId || !decision || !adminId) return res.status(400).json({ message: 'Faltan parámetros (requestId, decision, adminId).' });

    const requestRef = db.collection('requests').doc(requestId);
    try {
        const requestDoc = await requestRef.get();
        if (!requestDoc.exists) return res.status(404).json({ message: 'Solicitud no encontrada.' });

        const requestData = requestDoc.data() as any;
        if (requestData.status !== 'pending_review') return res.status(400).json({ message: `La solicitud ya no está pendiente (estado: ${requestData.status}).` });

        if (decision === 'approved') {
            // Create provisional user
            const provisionalUser = await auth.createUser({ email: requestData.applicantEmail, displayName: requestData.applicantName });
            await auth.setCustomUserClaims(provisionalUser.uid, { status: 'provisional', accountType: requestData.accountType, entityType: requestData.entityType });

            // Update request document
            const expiryDate = new Date();
            expiryDate.setHours(expiryDate.getHours() + 24);
            await requestRef.update({
                status: 'pending_additional_data',
                provisionalUid: provisionalUser.uid,
                provisionalAccountExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
                // Ensure entityType and formatted RUT are carried over
                entityType: requestData.entityType,
                rut: requestData.rut,
                accountType: requestData.accountType,
            });

            // Log and send email
            await requestRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'request_approved_initial', actor: adminId });
            const loginLink = await auth.generatePasswordResetLink(requestData.applicantEmail);
            await sendEmail(requestData.applicantEmail, 'Tu solicitud en MINREPORT ha sido aprobada', `<p>Hola ${requestData.applicantName},</p><p>Tu solicitud ha sido aprobada. El siguiente paso es completar tus datos. Tienes 24 horas para hacerlo.</p><p>Usa el siguiente enlace para crear tu contraseña y acceder a tu cuenta provisional:</p><p><a href="${loginLink}">Completar mis datos</a></p>`);

            res.status(200).json({ message: 'Solicitud aprobada inicialmente. Se ha creado una cuenta provisional.' });

        } else if (decision === 'rejected') {
            if (!reason) return res.status(400).json({ message: 'Se requiere un motivo para el rechazo.' });
            await requestRef.update({ status: 'rejected', rejectionReason: reason });
            await requestRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'request_rejected_initial', actor: adminId, details: `Motivo: ${reason}` });
            await sendEmail(requestData.applicantEmail, 'Actualización sobre tu solicitud en MINREPORT', `<p>Hola ${requestData.applicantName},</p><p>Lamentamos informarte que tu solicitud ha sido rechazada. Motivo: ${reason}</p>`);
            
            res.status(200).json({ message: 'Solicitud rechazada.' });
        } else {
            res.status(400).json({ message: 'La decisión debe ser "approved" o "rejected".' });
        }
    } catch (error: any) {
        console.error('Error en /processInitialDecision:', error);
        res.status(500).json({ message: 'Ocurrió un error interno.' });
    }
});

/**
 * (V3) Step 3: Provisional user submits additional data.
 */
app.post('/submitAdditionalData', authenticate, async (req, res) => {
    const provisionalUid = req.user!.uid; // Authenticated user's UID
    const { additionalData } = req.body;

    if (!additionalData) {
        return res.status(400).json({ message: 'Datos adicionales son obligatorios.' });
    }

    try {
        // Find the request associated with this provisional user
        const requestSnapshot = await db.collection('requests')
            .where('provisionalUid', '==', provisionalUid)
            .where('status', '==', 'pending_additional_data')
            .limit(1)
            .get();

        if (requestSnapshot.empty) {
            return res.status(404).json({ message: 'No se encontró una solicitud pendiente para este usuario provisional.' });
        }

        const requestDoc = requestSnapshot.docs[0];
        const requestId = requestDoc.id;
        const requestRef = db.collection('requests').doc(requestId);

        // Check for expiry
        const requestData = requestDoc.data() as any;
        if (requestData.provisionalAccountExpiry && requestData.provisionalAccountExpiry.toDate() < new Date()) {
            // Optionally update status to expired and log
            await requestRef.update({ status: 'expired' });
            await requestRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'provisional_account_expired', actor: 'system', details: 'Cuenta provisional expirada por tiempo.' });
            return res.status(400).json({ message: 'Su sesión provisional ha expirado. Por favor, inicie una nueva solicitud.' });
        }

        // Conditional validation and storage for RUN (Individual) or other data (B2B/EDUCACIONALES)
        const provisionalAccountType = req.user!.claims!.accountType; // Get accountType from provisional user's claims
        let updatedAdditionalData = { ...additionalData };

        if (provisionalAccountType === 'INDIVIDUAL') {
            const { run } = additionalData;
            if (!run) return res.status(400).json({ message: 'El RUN es obligatorio para cuentas individuales.' });
            const formattedRun = cleanAndFormatRut(run);
            if (!validateRut(formattedRun)) return res.status(400).json({ message: 'El RUN ingresado no es válido.' });
            updatedAdditionalData.run = formattedRun;
        } else { // B2B or EDUCACIONALES
            const { institutionAddress, institutionPhone, contactPhone } = additionalData;
            if (!institutionAddress || !institutionPhone || !contactPhone) {
                return res.status(400).json({ message: 'Dirección, teléfono de institución y teléfono de contacto son obligatorios.' });
            }
            // These are already in updatedAdditionalData
        }

        // Update the request with additional data and new status
        await requestRef.update({
            additionalData: updatedAdditionalData,
            status: 'pending_final_review',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Log history
        await requestRef.collection('history').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: 'additional_data_submitted',
            actor: provisionalUid, // Actor is the provisional user
            details: 'Datos adicionales enviados por el usuario provisional.'
        });

        res.status(200).json({ message: 'Datos adicionales enviados con éxito. Pendiente de revisión final.' });

    } catch (error) {
        console.error('Error en /submitAdditionalData:', error);
        res.status(500).json({ message: 'Ocurrió un error interno al procesar los datos adicionales.' });
    }
});

/**
 * (V3) Step 4: Admin makes final decision.
 */
app.post('/processFinalDecision', authenticate, async (req, res) => {
    const { requestId, decision, adminId, reason } = req.body;
    if (!requestId || !decision || !adminId) return res.status(400).json({ message: 'Faltan parámetros (requestId, decision, adminId).' });

    const requestRef = db.collection('requests').doc(requestId);
    try {
        const requestDoc = await requestRef.get();
        if (!requestDoc.exists) return res.status(404).json({ message: 'Solicitud no encontrada.' });

        const requestData = requestDoc.data() as any;
        if (requestData.status !== 'pending_final_review') return res.status(400).json({ message: `La solicitud no está pendiente de revisión final (estado: ${requestData.status}).` });

        if (decision === 'activated') {
            const designatedAdminEmail = requestData.additionalData.designatedAdminEmail;
            const designatedAdminName = requestData.additionalData.designatedAdminName;
            const provisionalUid = requestData.provisionalUid;

            // 1. Create final admin user in Firebase Auth
            const finalAdminUser = await auth.createUser({ email: designatedAdminEmail, displayName: designatedAdminName });
            await auth.setCustomUserClaims(finalAdminUser.uid, { role: 'account_admin', accountId: finalAdminUser.uid });

            // 2. Create account in Firestore
            const accountRef = db.collection('accounts').doc(finalAdminUser.uid);
            await accountRef.set({
                id: finalAdminUser.uid,
                applicantEmail: requestData.applicantEmail,
                applicantName: requestData.applicantName,
                rut: requestData.rut, // From initial request
                institutionName: requestData.institutionName,
                accountType: requestData.accountType,
                country: requestData.country,
                entityType: requestData.entityType,
                designatedAdminEmail: designatedAdminEmail,
                designatedAdminName: designatedAdminName,
                additionalData: requestData.additionalData, // Store all additional data
                status: 'active',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 3. Disable the provisional user
            if (provisionalUid) {
                await auth.updateUser(provisionalUid, { disabled: true });
            }

            // 4. Update request status
            await requestRef.update({ status: 'activated', finalAccountId: finalAdminUser.uid });

            // 5. Log to histories
            await requestRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'account_activated', actor: adminId, details: 'Cuenta activada y usuario administrador creado.' });
            await accountRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'account_created', actor: adminId, details: `Cuenta creada a partir de la solicitud ${requestId}.` });

            // 6. Send welcome email with password setup link to designated admin
            const passwordResetLink = await auth.generatePasswordResetLink(designatedAdminEmail);
            await sendEmail(designatedAdminEmail, '¡Tu cuenta MINREPORT ha sido activada!', `<p>¡Felicidades, ${designatedAdminName}!</p><p>Tu cuenta ha sido activada. Para empezar, establece tu contraseña en el siguiente enlace:</p><p><a href="${passwordResetLink}">Crear mi contraseña</a></p><p>El equipo de MINREPORT</p>`);

            res.status(200).json({ message: 'Cuenta activada con éxito.' });

        } else if (decision === 'rejected') {
            if (!reason) return res.status(400).json({ message: 'Se requiere un motivo para el rechazo final.' });
            
            // Update request status
            await requestRef.update({ status: 'rejected', rejectionReason: reason });

            // Log to history
            await requestRef.collection('history').add({ timestamp: admin.firestore.FieldValue.serverTimestamp(), action: 'final_rejection', actor: adminId, details: `Motivo: ${reason}` });

            // Optionally disable provisional user on final rejection
            const provisionalUid = requestData.provisionalUid;
            if (provisionalUid) {
                await auth.updateUser(provisionalUid, { disabled: true });
            }

            // Send rejection email
            await sendEmail(requestData.applicantEmail, 'Actualización sobre tu solicitud en MINREPORT', `<p>Hola ${requestData.applicantName},</p><p>Lamentamos informarte que tu solicitud ha sido rechazada definitivamente. Motivo: ${reason}</p>`);

            res.status(200).json({ message: 'Solicitud rechazada definitivamente.' });

        } else {
            res.status(400).json({ message: 'La decisión debe ser "activated" o "rejected".' });
        }
    } catch (error) {
        console.error('Error en /processFinalDecision:', error);
        res.status(500).json({ message: 'Ocurrió un error interno al procesar la decisión final.' });
    }
});

const PORT = process.env.REGISTRATION_SERVICE_PORT || 8082;
app.listen(PORT, () => {
  console.log(`(V3) Request Registration Service escuchando en el puerto ${PORT}`);
});
