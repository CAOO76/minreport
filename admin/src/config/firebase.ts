import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

/**
 * MINREPORT - Firebase Admin Config (BRUTAL E2E PATCH)
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

// 🔥 FORZAR LONG POLLING PARA EVITAR FREEZE EN ADMIN (Global Setup Fix) 🔥
const db = initializeFirestore(app, {
    experimentalForceLongPolling: true, // 👈 Clave para estabilidad en tests automatizados
});

const storage = getStorage(app);

// 🔥🔥🔥 PARCHE DE EMERGENCIA E2E (ADMIN / POLLING) 🔥🔥🔥
console.warn("%c🚨 ADMIN: EMULADORES ACTIVOS (LONG-POLLING) 🚨", "color: orange; font-weight: bold;");

try {
    // Sincronizado a puerto 9190 (Auth real del proyecto) y 8085 (Firestore)
    connectAuthEmulator(auth, "http://127.0.0.1:9190", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    connectStorageEmulator(storage, "127.0.0.1", 9195);
    console.log("✅ ADMIN: Emuladores vinculados con Polling.");
} catch (e) {
    console.error("❌ ADMIN: Error de vinculación:", e);
}

export { app, auth, db, storage };
export default app;
