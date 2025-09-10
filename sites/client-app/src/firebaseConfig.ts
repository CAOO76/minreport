// Importa las funciones que necesitas de los SDKs que necesitas
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// TODO: Agrega la configuración de tu proyecto de Firebase
// REEMPLAZA ESTO con el objeto firebaseConfig que copiaste de la consola
const firebaseConfig = {
  apiKey: "AIzaSyDYA5MkuXpZ8peeHJZ3gef487nToA6c0Ho",
  authDomain: "minreport-app.firebaseapp.com",
  projectId: "minreport-app",
  storageBucket: "minreport-app.firebasestorage.app",
  messagingSenderId: "1025778756133",
  appId: "1:1025778756133:web:01ee0c2c70858bc2be6dcc",
  measurementId: "G-DFW7QEL425"
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Exporta los servicios de Firebase que usarás en otras partes de la app
export const auth = getAuth(app);