import { useState, useEffect, useCallback } from 'react';
import type { User, Auth, IdTokenResult } from 'firebase/auth';
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';

// Expanded AuthState to include user claims and login function
export interface AuthState {
  user: User | null;
  claims: IdTokenResult['claims'] | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
}

const useAuth = (authInstance: Auth): AuthState => {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<IdTokenResult['claims'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(authInstance, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Force refresh to get the latest claims
          const idTokenResult = await firebaseUser.getIdTokenResult(true);
          
          // Set user and claims
          setUser(firebaseUser);
          setClaims(idTokenResult.claims);

        } catch (error) {
          console.error("Error getting user token result:", error);
          setUser(null);
          setClaims(null);
        }
      } else {
        // No user, clear everything
        setUser(null);
        setClaims(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authInstance]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(authInstance, email, password);
      // onAuthStateChanged will handle setting the user and claims
    } catch (error) {
      console.error("Login error in useAuth:", error);
      // Re-throw the error to be caught by the calling component
      throw error;
    } finally {
        // Although onAuthStateChanged sets loading to false, 
        // we do it here as well in case of an error before the state change propagates.
        setLoading(false);
    }
  }, [authInstance]);

  return { user, claims, loading, login };
};

export default useAuth;
