import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
    initializeFirestore,
    connectFirestoreEmulator,
    persistentLocalCache,
    persistentMultipleTabManager,
    doc,
    deleteDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

/**
 * MINREPORT - Configuracion Centralizada Firebase (southamerica-west1)
 * Instancia unica compartida por Core, OPERMAQ y STOCKPILE CONTROL.
 */
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "fake-api-key",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "minreport-8f2a8.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "minreport-8f2a8",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "minreport-8f2a8.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const useEmulators = isLocal && import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'false';

const db = initializeFirestore(app, {
    localCache: useEmulators ? undefined : persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    }),
    experimentalForceLongPolling: useEmulators,
});

const storage = getStorage(app);

if (useEmulators) {
    console.warn("[FRONTEND] Emuladores Firebase locales activos (HTTP/Long-Polling).");
    try {
        const host = window.location.hostname;
        const AUTH_URL = `http://${host}:9190`;
        connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
        connectFirestoreEmulator(db, host, 8085);
        connectStorageEmulator(storage, host, 9195);
        console.log(`[FRONTEND] Conexion a emuladores locales (${host}) establecida.`);
    } catch (e) {
        console.error("[FRONTEND] Fallo al conectar emuladores locales:", e);
    }
} else if (import.meta.env.DEV) {
    console.log("[FRONTEND] Conectado a Firebase Cloud Services (southamerica-west1).");
}

// Exposicion interna restringida exclusivamente a desarrollo / entorno local
if (typeof window !== 'undefined' && (import.meta.env.DEV || isLocal)) {
    (window as any)._firebase_app = app;
    (window as any)._firebase_auth = auth;
    (window as any)._firebase_db = db;
    (window as any)._firebase_storage = storage;
    (window as any)._firebase_initialized = true;
}

if (isLocal && import.meta.env.DEV) {
    (window as any).auth = auth;
    (window as any).db = db;
    (window as any).firestore = {
        doc,
        deleteDoc,
        collection,
        query,
        where,
        orderBy,
        limit,
        getDocs
    };
}

export { app, auth, db, storage };
export default app;
