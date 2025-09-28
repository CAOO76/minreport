// This will hold the callback registered by onAuthStateChanged
let authStateChangedCallback: ((user: any) => void) | null = null;

export const onAuthStateChanged = (callback: (user: any) => void) => {
  authStateChangedCallback = callback;
  // Return an unsubscribe function if needed by the component under test
  return () => { authStateChangedCallback = null; };
};

// Helper to simulate auth state changes in tests
export const __simulateAuthStateChanged = (user: any) => {
  if (authStateChangedCallback) {
    authStateChangedCallback(user);
  }
};
