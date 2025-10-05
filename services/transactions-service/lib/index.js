import express from 'express';
import cors from 'cors';
import * as admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// Esta función CREA la app, aceptando las dependencias como parámetros
export const createApp = (auth, db, FieldValue) => {
    const app = express();
    app.use(express.json());
    app.use(cors());
    // Middleware de seguridad que usa la dependencia "auth" inyectada
    const middleware = async (req, res, next) => {
        const { authorization } = req.headers;
        if (!authorization || !authorization.startsWith('Bearer ')) {
            return res.status(401).send({ message: 'No autorizado: Falta el token.' });
        }
        const token = authorization.split('Bearer ')[1];
        try {
            // @ts-ignore - Añadimos la propiedad user a la request
            req.user = await auth.verifyIdToken(token);
            const { projectId } = req.params; // Use type assertion
            if (!projectId) {
                return res.status(400).send({ message: 'Bad Request: projectId es requerido.' });
            }
            const projectDoc = await db.collection('projects').doc(projectId).get();
            if (!projectDoc.exists || !projectDoc.data()?.members?.includes(req.user.uid)) {
                return res.status(403).send({ message: 'Prohibido: No es miembro del proyecto o el proyecto no existe.' });
            }
            next();
        }
        catch (error) {
            return res.status(403).send({ message: 'Prohibido: Token inválido.' });
        }
    };
    const router = express.Router();
    router.get('/transactions', async (req, res) => {
        const { projectId } = req.params; // Use type assertion
        try {
            const transactionsRef = db.collection('projects').doc(projectId).collection('transactions');
            const snapshot = await transactionsRef.orderBy('createdAt', 'desc').get();
            const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.status(200).json(transactions);
        }
        catch (error) {
            console.error('Error fetching transactions:', error);
            return res.status(500).send({ message: 'Error al obtener transacciones.' });
        }
    });
    router.post('/transactions', async (req, res) => {
        const { projectId } = req.params; // Use type assertion
        const { type, amount, description } = req.body;
        if (!type || !description || amount === undefined || amount === null) {
            return res.status(400).send({ message: 'Faltan campos requeridos: type, amount, description.' });
        }
        if (typeof amount !== 'number' || amount <= 0) {
            return res.status(400).send({ message: 'El campo amount debe ser un número positivo.' });
        }
        try {
            const transactionsRef = db.collection('projects').doc(projectId).collection('transactions');
            const newTransaction = {
                type,
                amount,
                description,
                createdAt: FieldValue.serverTimestamp(),
            };
            const docRef = await transactionsRef.add(newTransaction);
            const createdTransaction = { id: docRef.id, ...newTransaction, createdAt: new Date().toISOString() }; // Simulate timestamp for immediate response
            return res.status(201).json(createdTransaction);
        }
        catch (error) {
            console.error('Error creating transaction:', error);
            return res.status(500).send({ message: 'Error al crear transacción.' });
        }
    });
    app.use('/projects/:projectId', middleware, router);
    return app;
};
// --- Bloque de Arranque (Solo para desarrollo y producción) ---
if (process.env.NODE_ENV !== 'test') {
    try {
        // Initialize Firebase Admin if not already initialized
        if (getApps().length === 0) {
            console.log('Inicializando Firebase Admin...');
            initializeApp();
        }
        const dbInstance = getFirestore();
        const authInstance = getAuth();
        // Verificar que las instancias se inicializaron correctamente
        if (!authInstance) {
            throw new Error('No se pudo inicializar Firebase Auth');
        }
        if (!dbInstance) {
            throw new Error('No se pudo inicializar Firestore');
        }
        console.log('Firebase Admin inicializado correctamente');
        const app = createApp(authInstance, dbInstance, admin.firestore.FieldValue);
        const PORT = process.env.TRANSACTIONS_SERVICE_PORT || 8080;
        app.listen(PORT, () => {
            console.log(`Transactions Service escuchando en el puerto ${PORT}`);
        });
    }
    catch (error) {
        console.error('Error inicializando el servicio de transacciones:', error);
        process.exit(1);
    }
}
