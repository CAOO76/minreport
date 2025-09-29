import express from 'express';
import admin from 'firebase-admin';
// Inicializar Firebase Admin SDK
import { initializeApp, getApps } from 'firebase-admin/app';
if (!getApps().length) {
    initializeApp();
}
const app = express();
app.use(express.json());
// Permitir inyección de dependencias para tests
let firestore = admin.firestore();
let fieldValue = admin.firestore.FieldValue;
if (process.env.USE_MOCK_FIRESTORE === '1' && global.mockFirestore) {
    firestore = global.mockFirestore;
    fieldValue = global.mockFieldValue;
}
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
            suspendedAt: fieldValue.serverTimestamp(),
        });
        res.status(200).send({ message: `Cuenta ${accountId} ha sido suspendida.` });
    }
    catch (error) {
        console.error('Error al suspender la cuenta:', error);
        res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
    }
});
export { app };
const PORT = process.env.ACCOUNT_SERVICE_PORT || 8081;
app.listen(PORT, () => {
    console.log(`Account Management Service escuchando en el puerto ${PORT}`);
});
