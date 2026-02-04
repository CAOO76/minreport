import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
    initializeFirestore,
    connectFirestoreEmulator,
    persistentLocalCache,
    persistentMultipleTabManager
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { Capacitor } from '@capacitor/core'; // 👈 Importante para detectar el celular

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

console.log('Firebase Config Debug:', firebaseConfig);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Initialize Firestore with Persistence
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});

export const storage = getStorage(app);

// ---------------------------------------------------------------------------
// 🔧 CONFIGURACIÓN DE EMULADORES (Corregida para Celular + iMac)
// ---------------------------------------------------------------------------

// 1. TU IP REAL (La de tu iMac .87, NO la del Router .1)
const MI_IP_IMAC = "192.168.1.87";

// 2. DETECCIÓN DE HOST (iMac vs Local vs Emulador)
const isEmulator = /sdk|emulator|google/i.test(navigator.userAgent);
const esIP = location.hostname === MI_IP_IMAC;

// En Android Nativo: 10.0.2.2 para emulador, IP real para celular
const hostIP = Capacitor.isNativePlatform()
    ? (isEmulator ? "10.0.2.2" : MI_IP_IMAC)
    : (esIP ? MI_IP_IMAC : "localhost");

const USE_EMULATORS = import.meta.env.MODE === 'development' || import.meta.env.VITE_USE_EMULATORS === 'true' || location.hostname === "localhost" || location.hostname === "127.0.0.1";
const EMULATOR_HOST = hostIP;

// Condición: En desarrollo, conectar a emuladores (web Y móvil)
if (USE_EMULATORS) {
    console.log(`🚀 [FIREBASE] Modo desarrollo - Conectando a emuladores en ${EMULATOR_HOST}`);

    try {
        // Auth Emulator (Puerto 9190)
        connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9190`, { disableWarnings: true });

        // Firestore Emulator (Puerto 8085)
        connectFirestoreEmulator(db, EMULATOR_HOST, 8085);

        // Storage Emulator (Puerto 9195)
        connectStorageEmulator(storage, EMULATOR_HOST, 9195);

        console.log(`✅ [SDK] Emuladores vinculados a ${EMULATOR_HOST}`);
    } catch (e) {
        console.error("❌ [FIREBASE] Error de vinculación:", e);
    }
}

// Request persistent storage (Critical for Offline-First)
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((persistent) => {
        if (persistent) {
            console.log("💎 [STORAGE] Persistencia concedida. Los datos están protegidos.");
        } else {
            console.log("⚠️ [STORAGE] Persistencia denegada. El navegador podría borrar datos localmente.");
        }
    });
}