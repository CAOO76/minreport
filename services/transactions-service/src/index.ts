import express from 'express';
import * as admin from 'firebase-admin';
import { Transaction } from './types';

// Initialize Firebase Admin SDK
// This assumes Firebase Admin SDK is initialized elsewhere or credentials are provided via environment variables
// For Cloud Run, it typically picks up credentials automatically.
// If running locally, you might need to set GOOGLE_APPLICATION_CREDENTIALS
// For local development with Firebase Emulators, ensure FIREBASE_FIRESTORE_EMULATOR_HOST is set.
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Middleware to validate projectId
app.param('projectId', (req, res, next, projectId) => {
  if (!projectId) {
    return res.status(400).send('Project ID is required.');
  }
  (req as any).projectId = projectId; // Attach projectId to request object
  next();
});

// POST /projects/:projectId/transactions
app.post('/projects/:projectId/transactions', async (req, res) => {
  const projectId = (req as any).projectId;
  const { type, amount, description } = req.body;

  // Basic validation
  if (!type || !amount || !description) {
    return res.status(400).send('Missing required fields: type, amount, description.');
  }
  if (!['income', 'expense'].includes(type)) {
    return res.status(400).send('Invalid transaction type. Must be \'income\' or \'expense\'.');
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).send('Amount must be a positive number.');
  }
  if (typeof description !== 'string' || description.trim() === '') {
    return res.status(400).send('Description must be a non-empty string.');
  }

  try {
    const newTransaction: Omit<Transaction, 'id'> = {
      type,
      amount,
      description,
      createdAt: new Date(), // Use current timestamp
    };

    const docRef = await db.collection('projects').doc(projectId).collection('transactions').add(newTransaction);

    res.status(201).json({ id: docRef.id, ...newTransaction });
  } catch (error) {
    console.error('Error adding transaction:', error);
    res.status(500).send('Error adding transaction.');
  }
});

// GET /projects/:projectId/transactions
app.get('/projects/:projectId/transactions', async (req, res) => {
  const projectId = (req as any).projectId;

  try {
    const transactionsRef = db.collection('projects').doc(projectId).collection('transactions');
    const snapshot = await transactionsRef.orderBy('createdAt', 'desc').get();

    const transactions: Transaction[] = [];
    snapshot.forEach(doc => {
      transactions.push({ id: doc.id, ...doc.data() as Omit<Transaction, 'id'> });
    });

    res.status(200).json(transactions);
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).send('Error getting transactions.');
  }
});

app.listen(PORT, () => {
  console.log(`Transactions Service listening on port ${PORT}`);
});

// Extend the Request type to include projectId
declare global {
  namespace Express {
    interface Request {
      projectId?: string;
    }
  }
}
