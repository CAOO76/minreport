import * as admin from 'firebase-admin';
import { env } from './env';

// Determine if we are running in a local development environment
const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

if (admin.apps.length === 0) {
    if (isDevOrTest) {
        // 🔥 FORCING CONNECTION TO FIREBASE EMULATORS (8085/9190) 🔥
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
        process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';

        console.log('\n🔥🔥🔥 FORCING CONNECTION TO FIREBASE EMULATORS (8085/9190) 🔥🔥🔥\n');

        admin.initializeApp({
            projectId: 'minreport-8f2a8', // Sync with .firebaserc and Playwright
        });

        // Explicit Settings to guarantee emulator discovery
        admin.firestore().settings({
            host: '127.0.0.1:8085',
            ssl: false
        });

    } else {
        // Production initialization (Cloud Run / Default Credentials)
        console.log('🚀 [BACKEND] Running in Production Mode - Using Default Credentials');
        admin.initializeApp({
            projectId: 'minreport-8f2a8'
        });
    }
}

export const db = admin.firestore();
export const auth = admin.auth();
export default admin;
