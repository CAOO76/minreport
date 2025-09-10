// Importa las funciones que necesitas de los SDKs que necesitas
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// TODO: Agrega la configuración de tu proyecto de Firebase
// REEMPLAZA ESTO con el objeto firebaseConfig que copiaste de la consola
const firebaseConfig = {
  apiKey: "AIzaSyD9j9iZzj9SaeJ02MA1q5x0OMzN70vaUpg",
  authDomain: "minreport-f48f8.firebaseapp.com",
  projectId: "minreport-f48f8",
  storageBucket: "minreport-f48f8.firebasestorage.app",
  messagingSenderId: "1036571621129",
  appId: "1:1036571621129:web:85769d05cb01b2ae5285d8",
  measurementId: "G-RPZNNS1YPV"
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Exporta los servicios de Firebase que usarás en otras partes de la app
export const auth = getAuth(app);