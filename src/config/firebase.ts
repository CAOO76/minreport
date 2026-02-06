import * as admin from 'firebase-admin';
import { env } from './env';

// Determine if we are running in a local development environment
const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

if (admin.apps.length === 0) {
    if (isDevOrTest) {
        // Force Emulator connections programmatically to avoid shell environment inconsistency
        process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

        console.log('🔧 [BACKEND] Running in Development/Test Mode - Forced Emulator Connection');
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
