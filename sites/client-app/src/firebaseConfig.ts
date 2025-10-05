// Importa las funciones que necesitas de los SDKs que necesitas
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

// La configuración de Firebase de tu aplicación web
const firebaseConfig = {
  apiKey: 'AIzaSyC4oxkLSJUo-msWmsh3cQOZu_uJCuIISb8',
  authDomain: 'minreport-8f2a8.firebaseapp.com',
  projectId: 'minreport-8f2a8',
  storageBucket: 'minreport-8f2a8.appspot.com',
  messagingSenderId: '493995072778',
  appId: '1:493995072778:web:41a2917f1e81491a7f6ef3',
  measurementId: 'G-KH3ZP9V53Y',
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Inicializar Firestore con persistencia offline mejorada
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Exporta los servicios que usarás
export const auth = getAuth(app);
export const functions = getFunctions(app, 'southamerica-west1');
export { httpsCallable } from 'firebase/functions';

// Conecta a los emuladores si se está en entorno de desarrollo
// Las variables de entorno de Vite (import.meta.env) son reemplazadas en tiempo de compilación.
if (import.meta.env.DEV) {
  console.log('Development mode: Connecting to Firebase Emulators for client-app');

  const host = import.meta.env.VITE_EMULATOR_HOST || 'localhost';
  const authPort = parseInt(import.meta.env.VITE_AUTH_EMULATOR_PORT || '9190', 10);
  const firestorePort = parseInt(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || '8085', 10);
  const functionsPort = parseInt(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || '9196', 10);

  try {
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  } catch (error) {
    console.log('Auth emulator already connected');
  }

  try {
    connectFirestoreEmulator(db, host, firestorePort);
  } catch (error) {
    console.log('Firestore emulator already connected');
  }

  try {
    connectFunctionsEmulator(functions, host, functionsPort);
  } catch (error) {
    console.log('Functions emulator already connected');
  }
}

// Persistencia offline está habilitada automáticamente con la nueva configuración de cache
console.log('✅ Firestore configurado con persistencia offline mejorada');
