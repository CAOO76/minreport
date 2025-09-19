import { vi } from 'vitest';
import { initializeApp } from 'firebase/app';

// 1. Inicializa una app de Firebase "falsa" para las pruebas
initializeApp({
  apiKey: "test-api-key",
  authDomain: "test-project.firebaseapp.com",
  projectId: "test-project",
  storageBucket: "test-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "test-app-id"
});

// 2. Simula (mock) el módulo completo de firebase/auth
vi.mock('firebase/auth', () => {
  let authStateCallback: ((user: any) => void) | null = null;
  
  return {
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn((auth, callback) => {
      authStateCallback = callback;
      return () => { /* Devuelve una función de unsubscribe válida */ };
    }),
    signOut: vi.fn(() => Promise.resolve()),
    // Un helper para que nuestras pruebas puedan simular cambios
    __simulateAuthStateChanged: (user: any) => {
      if (authStateCallback) {
        authStateCallback(user);
      }
    }
  };
});