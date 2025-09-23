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
exports.createApp = void 0;
/// <reference types="./types/express.d.ts" />
const express_1 = __importDefault(require("express"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
// Esta función CREA la app, aceptando las dependencias como parámetros
const createApp = (auth, db) => {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use((0, cors_1.default)());
    // Middleware de seguridad que usa la dependencia "auth" inyectada
    const securityMiddleware = async (req, res, next) => {
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
    const router = express_1.default.Router();
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
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
    app.use('/projects/:projectId', securityMiddleware, router);
    return app;
};
exports.createApp = createApp;
// --- Bloque de Arranque (Solo para desarrollo y producción) ---
if (process.env.NODE_ENV !== 'test') {
    if (admin.apps.length === 0) {
        admin.initializeApp();
    }
    const dbInstance = admin.firestore();
    const authInstance = admin.auth();
    const app = (0, exports.createApp)(authInstance, dbInstance);
    const PORT = process.env.TRANSACTIONS_SERVICE_PORT || 8080;
    app.listen(PORT, () => {
        console.log(`Transactions Service escuchando en el puerto ${PORT}`);
    });
}
