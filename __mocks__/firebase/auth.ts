import { vi } from 'vitest';

// Mock Firebase Auth functions
export const getAuth = vi.fn(() => {
  const authInstance = {
    onAuthStateChanged: vi.fn((callback) => {
      authStateChangedCallback = callback;
      return () => { authStateChangedCallback = null; };
    }),
    // Add other methods that might be called on the auth instance
    // For example, if connectAuthEmulator expects a specific method on 'auth'
    // or if useAuth calls other methods on 'authInstance'
  };
  return authInstance;
});

export const signOut = vi.fn(() => Promise.resolve());

// This will hold the callback registered by onAuthStateChanged
let authStateChangedCallback: ((user: any) => void) | null = null;

export const onAuthStateChanged = vi.fn((authInstance, callback) => {
  authStateChangedCallback = callback;
  // Return an unsubscribe function if needed by the component under test
  return () => { authStateChangedCallback = null; };
});

export const connectAuthEmulator = vi.fn((auth, url) => {
  // console.log(`Mock connectAuthEmulator called with: ${url}`);
});

export const signInWithEmailAndPassword = vi.fn((auth, email, password) => {
  // Simulate a successful login without triggering onAuthStateChanged directly
  if (email === 'test@example.com' && password === 'password123') {
    return Promise.resolve({ user: { uid: 'mock-user-uid', email: 'test@example.com' } });
  } else {
    return Promise.reject(new Error('auth/invalid-credential'));
  }
});

// Helper to simulate auth state changes in tests
export const __simulateAuthStateChanged = (user: any) => {
  if (authStateChangedCallback) {
    authStateChangedCallback(user);
  }
};
