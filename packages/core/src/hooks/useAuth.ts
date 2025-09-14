import { useState, useEffect } from 'react';
import type { User, Auth } from 'firebase/auth';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const useAuth = (authInstance: Auth): AuthState => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(authInstance, async (firebaseUser) => {
      if (firebaseUser) {
        const idTokenResult = await firebaseUser.getIdTokenResult();
        const isAdmin = idTokenResult.claims.admin === true;

        // Principio de fallo silencioso: si es admin, no debe loguearse en el portal de clientes.
        if (!isAdmin) {
          setUser(firebaseUser);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authInstance]);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(authInstance, email, password);
    } catch (err: any) {
      console.error('useAuth: Login error caught:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await signOut(authInstance);
    } finally {
      setLoading(false);
    }
  };

  return { user, loading, login, logout };
};

export default useAuth;
