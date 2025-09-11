// Importa las funciones que necesitas de los SDKs que necesitas
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// La configuración de Firebase de tu aplicación web
const firebaseConfig = {
  apiKey: "AIzaSyC4oxkLSJUo-msWmsh3cQOZu_uJCuIISb8",
  authDomain: "minreport-8f2a8.firebaseapp.com",
  projectId: "minreport-8f2a8",
  storageBucket: "minreport-8f2a8.firebasestorage.app",
  messagingSenderId: "493995072778",
  appId: "1:493995072778:web:41a2917f1e81491a7f6ef3",
  measurementId: "G-KH3ZP9V53Y"
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Exporta los servicios que usarás
export const auth = getAuth(app);
export const db = getFirestore(app);