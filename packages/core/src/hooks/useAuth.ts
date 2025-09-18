import { useState, useEffect } from 'react';
import type { User, Auth, IdTokenResult } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';

export interface AuthState {
  user: User | null;
  claims: IdTokenResult['claims'] | null;
  loading: boolean;
  activePlugins: string[] | null;
}

const useAuth = (authInstance: Auth): AuthState => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    claims: null,
    loading: true,
    activePlugins: null,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
      if (user) {
        const idTokenResult = await user.getIdTokenResult(true);
        setAuthState({
          user,
          claims: idTokenResult.claims,
          activePlugins: (idTokenResult.claims.activePlugins || []) as string[],
          loading: false,
        });
      } else {
        setAuthState({
          user: null,
          claims: null,
          activePlugins: null,
          loading: false,
        });
      }
    });

    return () => unsubscribe();
  }, [authInstance]);

  return authState;
};

export default useAuth;