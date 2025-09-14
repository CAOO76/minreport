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
          const idTokenResult = await user.getIdTokenResult();
          const isAdmin = idTokenResult.claims.admin === true;

          // Principio de fallo silencioso: si no es admin, se trata como si no estuviera logueado.
          if (isAdmin) {
            setAuthState({
              user,
              isAdmin: true,
              loading: false,
            });
          } else {
            // Si es un usuario válido pero no admin, no se le da acceso.
            setAuthState({
              user: null,
              isAdmin: false,
              loading: false,
            });
          }
        } catch (error) {
          console.error("Error al obtener custom claims:", error);
          setAuthState({
            user: null, // No dar acceso en caso de error
            isAdmin: false,
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
