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

// Primero verificar si estamos en desarrollo
let functions_instance;
if (import.meta.env.DEV) {
  console.log('Development mode: Connecting to Firebase Emulators');
  
  // Crear functions CON región para desarrollo
  functions_instance = getFunctions(app, 'southamerica-west1');
  
  const host = 'localhost';
  const authPort = 9190;
  const firestorePort = 8085;
  const functionsPort = 5001;

  connectAuthEmulator(auth, `http://${host}:${authPort}`);
  connectFirestoreEmulator(db, host, firestorePort);
  connectFunctionsEmulator(functions_instance, host, functionsPort);
} else {
  // En producción, usar la región específica
  functions_instance = getFunctions(app, 'southamerica-west1');
}

export const functions = functions_instance;
export { httpsCallable };