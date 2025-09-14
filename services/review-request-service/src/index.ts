import express from 'express';
import admin from 'firebase-admin';

// Inicializar firebase-admin de forma segura
// Para Cloud Run, las credenciales se obtienen automáticamente del entorno
admin.initializeApp();

const app = express();
app.use(express.json());

const firestore = admin.firestore();
const auth = admin.auth(); // Get Firebase Auth instance

/**
 * Endpoint para aprobar inicialmente una solicitud de registro.
 * Cambia el estado de la solicitud a 'pending_additional_data'.
 */
app.post('/approve', async (req, res) => {
    const { requestId } = req.body;

    if (!requestId) {
        return res.status(400).send({ error: 'El ID de la solicitud (requestId) es obligatorio.' });
    }

    try {
        const requestRef = firestore.collection('requests').doc(requestId);
        const requestDoc = await requestRef.get();

        if (!requestDoc.exists) {
            return res.status(404).send({ error: 'Solicitud no encontrada.' });
        }

        // TODO: Añadir validación para asegurar que el estado actual es 'pending_review'

        await requestRef.update({
            status: 'pending_additional_data',
            reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
            // TODO: Guardar qué administrador realizó la acción
        });

        res.status(200).send({ message: `Solicitud ${requestId} aprobada inicialmente.` });

    } catch (error) {
        console.error('Error al aprobar la solicitud:', error);
        res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
    }
});

/**
 * Endpoint para rechazar una solicitud de registro.
 * Cambia el estado de la solicitud a 'rejected'.
 */
app.post('/reject', async (req, res) => {
    const { requestId, reason } = req.body;

    if (!requestId) {
        return res.status(400).send({ error: 'El ID de la solicitud (requestId) es obligatorio.' });
    }

    try {
        const requestRef = firestore.collection('requests').doc(requestId);
        const requestDoc = await requestRef.get();

        if (!requestDoc.exists) {
            return res.status(404).send({ error: 'Solicitud no encontrada.' });
        }

        // TODO: Añadir validación para asegurar que el estado actual es 'pending_review'

        await requestRef.update({
            status: 'rejected',
            rejectionReason: reason || 'No se especificó una razón',
            reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
            // TODO: Guardar qué administrador realizó la acción
        });

        res.status(200).send({ message: `Solicitud ${requestId} ha sido rechazada.` });

    } catch (error) {
        console.error('Error al rechazar la solicitud:', error);
        res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
    }
});

/**
 * Endpoint para la aprobación final de una solicitud y creación de cuenta/usuario.
 * Cambia el estado de la solicitud a 'approved', crea el usuario en Firebase Auth
 * y crea el documento de la cuenta en la colección 'accounts'.
 */
app.post('/final-approve', async (req, res) => {
    const { requestId } = req.body;

    if (!requestId) {
        return res.status(400).send({ error: 'El ID de la solicitud (requestId) es obligatorio.' });
    }

    try {
        const requestRef = firestore.collection('requests').doc(requestId);
        const requestDoc = await requestRef.get();

        if (!requestDoc.exists) {
            return res.status(404).send({ error: 'Solicitud no encontrada.' });
        }

        const requestData = requestDoc.data() as any; // Cast to any for now, ideally use a defined type

        // Validar que el estado actual es 'pending_additional_data'
        if (requestData.status !== 'pending_additional_data') {
            return res.status(400).send({ error: 'La solicitud no está en estado de "pending_additional_data".' });
        }

        // Verificar si ya existe un usuario con este email
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(requestData.applicantEmail);
            // Si el usuario ya existe, podemos decidir si actualizar o lanzar un error
            // Por ahora, si existe, asumimos que ya fue procesado o es un error
            return res.status(409).send({ error: 'Ya existe un usuario con este correo electrónico.' });
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                // Usuario no encontrado, podemos proceder a crearlo
            } else {
                console.error('Error al verificar usuario existente:', error);
                return res.status(500).send({ error: 'Error al verificar usuario existente.' });
            }
        }

        // Crear usuario en Firebase Authentication
        const newUser = await auth.createUser({
            email: requestData.applicantEmail,
            emailVerified: true, // Asumimos que el email ya fue verificado en un paso anterior o se verificará después
            displayName: requestData.applicantName,
            // password: 'some-initial-secure-password' // No se recomienda establecer contraseñas aquí, usar enlaces de restablecimiento
        });

        // Crear documento de cuenta en Firestore
        const accountId = newUser.uid; // Usar el UID del usuario como ID de la cuenta
        await firestore.collection('accounts').doc(accountId).set({
            id: accountId,
            institutionName: requestData.institutionName,
            accountType: requestData.accountType,
            status: 'active',
            ownerUid: newUser.uid,
            ownerEmail: newUser.email,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            // Otros campos relevantes de la solicitud
        });

        // Actualizar estado de la solicitud a 'approved'
        await requestRef.update({
            status: 'approved',
            approvedAt: admin.firestore.FieldValue.serverTimestamp(),
            approvedBy: 'admin_user_id_placeholder', // TODO: Guardar qué administrador realizó la acción
            accountId: accountId, // Referencia a la cuenta creada
        });

        // Registrar acción en account_logs
        await firestore.collection('account_logs').add({
            accountId: accountId,
            action: 'account_created',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: {
                requestId: requestId,
                institutionName: requestData.institutionName,
                accountType: requestData.accountType,
                approvedBy: 'admin_user_id_placeholder', // TODO: Guardar qué administrador realizó la acción
            },
        });

        res.status(200).send({ message: `Cuenta creada y solicitud ${requestId} aprobada finalmente.`, accountId: accountId });

    } catch (error) {
        console.error('Error en la aprobación final:', error);
        // Manejo específico para errores de Firebase Auth
        if (error instanceof Error && error.message.includes('auth/')) {
            return res.status(400).send({ error: `Error de autenticación: ${error.message}` });
        }
        res.status(500).send({ error: 'Ocurrió un error en el servidor durante la aprobación final.' });
    }
});

const PORT = process.env.REVIEW_SERVICE_PORT || 8083;
app.listen(PORT, () => {
    console.log(`Review Request Service escuchando en el puerto ${PORT}`);
});
