import { vi } from 'vitest';

// Mock Firebase Auth functions
export const getAuth = vi.fn(() => ({
  // Mock any methods called on the auth instance if needed
}));

export const signOut = vi.fn(() => Promise.resolve());

// This will hold the callback registered by onAuthStateChanged
let authStateChangedCallback: ((user: any) => void) | null = null;

export const onAuthStateChanged = vi.fn((authInstance, callback) => {
  authStateChangedCallback = callback;
  // Return an unsubscribe function if needed by the component under test
  return () => { authStateChangedCallback = null; };
});

export const connectAuthEmulator = vi.fn(); // Add this line

// Helper to simulate auth state changes in tests
export const __simulateAuthStateChanged = (user: any) => {
  if (authStateChangedCallback) {
    authStateChangedCallback(user);
  }
};
