import express from 'express';
import * as admin from 'firebase-admin';
import { requestInitialRegistration } from '@minreport/core';

// Initialize Firebase Admin SDK
// This will be initialized once when the Cloud Run instance starts
admin.initializeApp();


const app = express();
app.use(express.json()); // Enable JSON body parsing

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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});