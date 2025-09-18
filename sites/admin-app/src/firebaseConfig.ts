import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

// Reemplaza esto con tu configuración real de Firebase
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "minreport-8f2a8",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'southamerica-west1'); // Define la región de producción
export { httpsCallable };

if (import.meta.env.DEV) {
  console.log('Development mode: Connecting to Firebase Emulators');
  
  const host = 'localhost';
  const authPort = 9190;
  const firestorePort = 8085;
  const functionsPort = 5001;

  connectAuthEmulator(auth, `http://${host}:${authPort}`);
  connectFirestoreEmulator(db, host, firestorePort);
  connectFunctionsEmulator(functions, host, functionsPort);
}