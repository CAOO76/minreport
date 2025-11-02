import { initializeApp, getApps } from 'firebase-admin/app';

// Initialize Firebase Admin only if it hasn't been initialized yet.
if (!getApps().length) {
    initializeApp();
}

// Firebase Admin initialized.

// Export all functions from their respective files.
export * from "./requestManagement";
