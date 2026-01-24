import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

// Singleton para asegurar que Firebase solo se inicie una vez
const initFirebase = () => {
    if (getApps().length === 0) {
        // EN PRODUCCIÓN (Cloud Run): Usará las credenciales por defecto de Google (Application Default Credentials)
        // EN DESARROLLO: Buscará GOOGLE_APPLICATION_CREDENTIALS en tu .env
        initializeApp({
            credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS || "")
        });
        console.log('🔥 Firebase Admin Initialized');
    }
    return getFirestore();
};

export const db = initFirebase();
