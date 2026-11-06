import * as admin from 'firebase-admin';
import { env } from './env';

const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

if (admin.apps.length === 0) {
    if (isDevOrTest) {
        process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
        process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9190';
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9195';

        console.log('[FIREBASE-ADMIN] Conectado a Emuladores Locales (Firestore:8085 | Auth:9190 | Storage:9195)');

        admin.initializeApp({
            projectId: env.GCP_PROJECT_ID,
            storageBucket: env.STORAGE_BUCKET,
        });
    } else {
        console.log(`[FIREBASE-ADMIN] Producción activa (${env.GCP_LOCATION} · ${env.GCP_PROJECT_ID})`);
        admin.initializeApp({
            projectId: env.GCP_PROJECT_ID,
            storageBucket: env.STORAGE_BUCKET,
        });
    }
}

export const db = admin.firestore();
try {
    db.settings({ ignoreUndefinedProperties: true });
} catch {
    // Ignorar si settings() ya fue invocado previamente en hot-reload
}
export const auth = admin.auth();
export const storage = admin.storage();
export const messaging = admin.messaging();
export default admin;
