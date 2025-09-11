"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
// TODO: Inicializar firebase-admin de forma segura
// admin.initializeApp();
const app = (0, express_1.default)();
app.use(express_1.default.json());
const firestore = firebase_admin_1.default.firestore();
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
        // TODO: Añadir validación para asegurar que el estado actual no es ya 'suspended'
        await accountRef.update({
            status: 'suspended',
            suspensionReason: reason || 'No se especificó una razón',
            suspendedAt: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
            // TODO: Guardar qué administrador realizó la acción
        });
        // TODO: Desactivar el usuario en Firebase Authentication
        res.status(200).send({ message: `Cuenta ${accountId} ha sido suspendida.` });
    }
    catch (error) {
        console.error('Error al suspender la cuenta:', error);
        res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
    }
});
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
