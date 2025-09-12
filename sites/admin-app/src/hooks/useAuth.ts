import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
}

const useAuth = (): AuthState => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAdmin: false,
    loading: true,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Forzar la recarga del token para obtener los custom claims más recientes
          await user.getIdToken(true); 
          const idTokenResult = await user.getIdTokenResult();
          const isAdmin = idTokenResult.claims.admin === true;
          setAuthState({
            user,
            isAdmin,
            loading: false,
          });
        } catch (error) {
          console.error("Error al obtener custom claims:", error);
          setAuthState({
            user,
            isAdmin: false, // Asumir no admin en caso de error
            loading: false,
          });
        }
      } else {
        setAuthState({
          user: null,
          isAdmin: false,
          loading: false,
        });
      }
    });

    // Limpiar la suscripción al desmontar el componente
    return () => unsubscribe();
  }, []);

  return authState;
};

export default useAuth;
