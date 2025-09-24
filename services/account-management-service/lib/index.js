import express from 'express';
import admin from 'firebase-admin';
// Inicializar Firebase Admin SDK
admin.initializeApp();
const app = express();
app.use(express.json());
const firestore = admin.firestore();
/**
 * Endpoint para suspender una cuenta.
 * Cambia el estado de la cuenta a 'suspended'.
 */
app.post('/suspend', async (req, res) => {
    const { accountId, reason } = req.body;
    if (!accountId) {
        return res.status(400).send({ error: 'El ID de la cuenta (accountId) es obligatorio.' });
    }
    try {
        const accountRef = firestore.collection('accounts').doc(accountId);
        const accountDoc = await accountRef.get();
        if (!accountDoc.exists) {
            return res.status(404).send({ error: 'Cuenta no encontrada.' });
        }
        await accountRef.update({
            status: 'suspended',
            suspensionReason: reason || 'No se especificó una razón',
            suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(200).send({ message: `Cuenta ${accountId} ha sido suspendida.` });
    }
    catch (error) {
        console.error('Error al suspender la cuenta:', error);
        res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
    }
});
const PORT = process.env.ACCOUNT_SERVICE_PORT || 8081;
app.listen(PORT, () => {
    console.log(`Account Management Service escuchando en el puerto ${PORT}`);
});
