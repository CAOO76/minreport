import { useState, useEffect } from 'react';
import type { User, Auth, IdTokenResult } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';

// Expanded AuthState to include user claims
export interface AuthState {
  user: User | null;
  claims: IdTokenResult['claims'] | null;
  loading: boolean;
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

  return { user, claims, loading };
};

export default useAuth;