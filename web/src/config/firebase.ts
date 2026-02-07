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

// 🔥 FORZAR LONG POLLING PARA EVITAR FREEZE EN PLAYWRIGHT 🔥
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const db = initializeFirestore(app, {
    // Desactivar persistencia en local/test para evitar "Unexpected state" con long polling
    localCache: isLocal ? undefined : persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    }),
    experimentalForceLongPolling: true,
});

const storage = getStorage(app);

// 🔥🔥🔥 FORZADO BRUTAL PARA E2E (HTTP/LONG-POLLING) 🔥🔥🔥
// Nota: Tu proyecto (firebase.json) usa el puerto 9190 para Auth.
console.warn("%c🚨 FRONTEND: EMULADORES ACTIVOS (HTTP/LONG-POLLING) 🚨", "color: orange; font-weight: bold; font-size: 14px;");

try {
    // Usamos el mismo host que la aplicación para evitar discrepancias de origen (localhost vs 127.0.0.1)
    const host = window.location.hostname;
    const AUTH_URL = `http://${host}:9190`;
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8085);
    connectStorageEmulator(storage, host, 9195);
    console.log(`✅ FRONTEND: Conexión emuladores (${host}) exitosa.`);
} catch (e) {
    console.error("❌ FRONTEND: Fallo crítico en parche de emuladores:", e);
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