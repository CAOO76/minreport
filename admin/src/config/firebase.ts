import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
    initializeFirestore,
    connectFirestoreEmulator,
    persistentLocalCache,
    persistentMultipleTabManager
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

/**
 * MINREPORT - Firebase Admin Config (Southamerica-West1 / Web 3.0)
 */

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "fake-api-key",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "minreport-8f2a8.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "minreport-8f2a8",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "minreport-8f2a8.appspot.com",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const useEmulators = isLocal && import.meta.env.VITE_USE_FIREBASE_EMULATOR !== "false";

const db = initializeFirestore(app, {
    localCache: useEmulators ? undefined : persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    }),
    experimentalForceLongPolling: useEmulators,
});

const storage = getStorage(app);

if (useEmulators) {
    try {
        const host = window.location.hostname;
        connectAuthEmulator(auth, `http://${host}:9190`, { disableWarnings: true });
        connectFirestoreEmulator(db, host, 8085);
        connectStorageEmulator(storage, host, 9195);
    } catch (e) {
        console.error("[ADMIN] Error conectando emuladores:", e);
    }
}

export { app, auth, db, storage };
export default app;
