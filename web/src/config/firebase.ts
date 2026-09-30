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
 * MINREPORT - Firebase Core Configuration (BRUTAL E2E PATCH)
 * optimized for E2E Stability and Hybrid Access
 */

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
const auth = getAuth(app);

// Determinación estricta de entorno: Emuladores locales vs Producción Cloud
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const useEmulators = isLocal && import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'false';

const db = initializeFirestore(app, {
    // En producción habilitamos caché persistente multi-tab (Offline-First Capa 2/3)
    localCache: useEmulators ? undefined : persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    }),
    experimentalForceLongPolling: useEmulators,
});

const storage = getStorage(app);

// Conexión a Emuladores SOLO si está explícitamente activado para pruebas locales
if (useEmulators) {
    console.warn("%c🚨 FRONTEND: EMULADORES ACTIVOS (HTTP/LONG-POLLING) 🚨", "color: orange; font-weight: bold; font-size: 14px;");
    try {
        const host = window.location.hostname;
        const AUTH_URL = `http://${host}:9190`;
        connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
        connectFirestoreEmulator(db, host, 8085);
        connectStorageEmulator(storage, host, 9195);
        console.log(`✅ FRONTEND: Conexión emuladores (${host}) exitosa.`);
    } catch (e) {
        console.error("❌ FRONTEND: Fallo al conectar emuladores:", e);
    }
} else {
    console.log("🚀 [FRONTEND] Conectado a Firebase Cloud Services (Southamerica-West1)");
}

// 🔥 EXPOSICIÓN PARA E2E (Permite a Playwright verificar el estado) 🔥
if (isLocal) {
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
    console.log("🛠️ E2E: Firebase auth/db/firestore expuestos en window.");
}

export { app, auth, db, storage };
export default app;