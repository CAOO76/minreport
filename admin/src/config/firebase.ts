import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

// Your web app's Firebase configuration
// Note: envDir is '..' in vite.config.ts, so it reads from root .env
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// 🔧 CONFIGURACIÓN DE EMULADORES (Dynamic for Network Access)
const MI_IP_IMAC = "192.168.1.82";

if (typeof window !== 'undefined') {
    const isLocal = window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === MI_IP_IMAC;

    if (isLocal) {
        const EMULATOR_HOST = window.location.hostname === MI_IP_IMAC ? MI_IP_IMAC : "127.0.0.1";
        console.log(`🔧 [ADMIN] Local/Network detected - Connecting to Emulators at ${EMULATOR_HOST}`);

        connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9190`, { disableWarnings: true });
        connectFirestoreEmulator(db, EMULATOR_HOST, 8085);
        connectStorageEmulator(storage, EMULATOR_HOST, 9195);
    }
}
