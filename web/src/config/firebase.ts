import { Capacitor } from "@capacitor/core";
import { initializeApp } from "firebase/app";
import {
    getAuth,
    initializeAuth,
    indexedDBLocalPersistence,
    browserLocalPersistence,
    connectAuthEmulator,
    type Auth,
} from "firebase/auth";
import { isNativeDebugApp, isAndroidEmulatorRuntime } from "../core/runtime/appFlavor";
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
const isNativePlatform = Capacitor.isNativePlatform();

let auth: Auth;
if (isNativePlatform) {
    try {
        auth = initializeAuth(app, {
            persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        });
    } catch {
        auth = getAuth(app);
    }
} else {
    auth = getAuth(app);
}
const isNativeDebug = isNativeDebugApp();
const isNativeReleaseHttps =
    isNativePlatform &&
    !isNativeDebug &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    !window.location.port;
const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const forceEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
const disableEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'false';
const useEmulators =
    forceEmulator ||
    (!disableEmulator && !isNativeReleaseHttps && (isNativeDebug || isLocalHost));

function resolveEmulatorHost(): string {
    if (isNativePlatform && Capacitor.getPlatform() === 'android') {
        if (isAndroidEmulatorRuntime()) {
            return '10.0.2.2';
        }
        const devHostIp = import.meta.env.VITE_DEV_HOST_IP?.trim();
        if (devHostIp) {
            return devHostIp;
        }
        return 'localhost';
    }
    if (typeof window !== 'undefined' && window.location.hostname) {
        return window.location.hostname;
    }
    return 'localhost';
}

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
        const host = resolveEmulatorHost();
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
if (typeof window !== 'undefined' && (import.meta.env.DEV || isLocalHost || isNativeDebug)) {
    (window as any)._firebase_app = app;
    (window as any)._firebase_auth = auth;
    (window as any)._firebase_db = db;
    (window as any)._firebase_storage = storage;
    (window as any)._firebase_initialized = true;
}

if (isLocalHost && import.meta.env.DEV) {
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
