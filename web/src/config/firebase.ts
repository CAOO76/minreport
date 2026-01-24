import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
    initializeFirestore,
    connectFirestoreEmulator,
    persistentLocalCache,
    persistentMultipleTabManager
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

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

// Connect to Emulators if in localhost
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    console.log("🔧 [FRONTEND] Localhost detected - Connecting to Emulators");

    // Auth Emulator
    connectAuthEmulator(auth, "http://127.0.0.1:9190");

    // Firestore Emulator
    connectFirestoreEmulator(db, '127.0.0.1', 8085);

    // Storage Emulator
    connectStorageEmulator(storage, '127.0.0.1', 9195);

    console.log("   - Auth: http://127.0.0.1:9190");
    console.log("   - Firestore: 127.0.0.1:8085");
    console.log("   - Storage: http://127.0.0.1:9195");
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
