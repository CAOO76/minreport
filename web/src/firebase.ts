import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

// Your web app's Firebase configuration
// For development/emulators, these values can be dummy values
const firebaseConfig = {
    apiKey: "demo-api-key",
    authDomain: "demo-project.firebaseapp.com",
    projectId: "demo-minreport-8f2a8",
    storageBucket: "demo-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Connect to Emulators if in localhost
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    console.log("🔧 [FRONTEND] Localhost detected - Connecting to Emulators");

    // Auth Emulator
    connectAuthEmulator(auth, "http://127.0.0.1:9190");

    // Firestore Emulator
    connectFirestoreEmulator(db, '127.0.0.1', 8085);

    console.log("   - Auth: http://127.0.0.1:9190");
    console.log("   - Firestore: 127.0.0.1:8085");
}
