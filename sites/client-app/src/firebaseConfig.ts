// Importa las funciones que necesitas de los SDKs que necesitas
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getFirebaseConfig } from './config/app-config';

// Usar configuración centralizada
const firebaseConfig = getFirebaseConfig();

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Inicializar Firestore con persistencia offline mejorada
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Exporta los servicios que usarás
export const auth = getAuth(app);
export const functions = getFunctions(app, 'southamerica-west1');
export { httpsCallable } from 'firebase/functions';

// Conecta a los emuladores si se está en entorno de desarrollo
// Las variables de entorno de Vite (import.meta.env) son reemplazadas en tiempo de compilación.
if (import.meta.env.DEV) {
  // Development mode: Connecting to Firebase Emulators for client-app

  const host = 'localhost';
  const authPort = parseInt(import.meta.env.VITE_AUTH_EMULATOR_PORT || '9190', 10);
  const firestorePort = parseInt(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || '8085', 10);
  const functionsPort = parseInt(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || '9196', 10);

  try {
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  } catch {
    // Auth emulator already connected
  }

  try {
    connectFirestoreEmulator(db, host, firestorePort);
  } catch {
    // Firestore emulator already connected
  }

  try {
    connectFunctionsEmulator(functions, host, functionsPort);
  } catch {
    // Functions emulator already connected
  }
}

// Persistencia offline está habilitada automáticamente con la nueva configuración de cache
// Firestore configurado con persistencia offline mejorada
