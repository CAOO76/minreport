import { useState, useEffect, useCallback } from 'react';
import type { User, Auth, IdTokenResult } from 'firebase/auth';
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore'; // Importar Firestore

// Expanded AuthState to include user claims, active plugins, and login function
export interface AuthState {
  user: User | null;
  claims: IdTokenResult['claims'] | null;
  loading: boolean;
  activePlugins: string[] | null; // Nuevo campo para los plugins activos
  login: (email: string, password: string) => Promise<void>;
}

const useAuth = (authInstance: Auth): AuthState => {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<IdTokenResult['claims'] | null>(null);
  const [activePlugins, setActivePlugins] = useState<string[] | null>(null); // Nuevo estado
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authInstance) return;
    const unsubscribe = onAuthStateChanged(authInstance, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Force refresh to get the latest claims
          const idTokenResult = await firebaseUser.getIdTokenResult(true);
          console.log('CLAIMS RECIBIDOS POR EL CLIENTE:', idTokenResult.claims); // <--- AÑADE ESTA LÍNEA
          
          // Set user and claims
          setUser(firebaseUser);
          setClaims(idTokenResult.claims);

          // Get activePlugins directly from claims
          const userActivePlugins = (idTokenResult.claims.activePlugins || []) as string[];
          setActivePlugins(userActivePlugins);
          console.log('useAuth: activePlugins set in state:', userActivePlugins);

        } catch (error) {
          console.error("Error in useAuth:", error);
          setUser(null);
          setClaims(null);
          setActivePlugins(null);
        }
      } else {
        // No user, clear everything
        setUser(null);
        setClaims(null);
        setActivePlugins(null);
      }
      console.log('useAuth: Setting loading to false.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authInstance]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(authInstance, email, password);
      // onAuthStateChanged will handle setting the user, claims, and activePlugins
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

  return { user, claims, loading, activePlugins, login };
};

export default useAuth;
