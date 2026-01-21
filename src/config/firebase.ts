import * as admin from 'firebase-admin';
import { env } from './env';

// Determine if we are running in a local development environment
const isDev = env.NODE_ENV === 'development';

if (admin.apps.length === 0) {
    if (isDev) {
        // Force Emulator connections if in dev mode
        // Ports must match firebase.json (Auth: 9190, Firestore: 8085)
        process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

        console.log('🔧 [BACKEND] Running in Development Mode - Connecting to Emulators');
        console.log('   - Auth: 127.0.0.1:9190');
        console.log('   - Firestore: 127.0.0.1:8085');

        admin.initializeApp({
            projectId: 'minreport-8f2a8', // Sync with .firebaserc
        });
    } else {
        // Production initialization (Cloud Run / Default Credentials)
        console.log('🚀 [BACKEND] Running in Production Mode - Using Default Credentials');
        admin.initializeApp();
    }
}

export const db = admin.firestore();
export const auth = admin.auth();
export default admin;
