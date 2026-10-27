import { useState, useEffect } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

export type UserRole =
  | 'DEV_ROOT'
  | 'SUPER_ADMIN'
  | 'DEVELOPER'
  | 'TEST_PILOT'
  | 'PILOT_LEAD'
  | 'OWNER'
  | 'ADMIN'
  | 'SUPERVISOR'
  | 'OPERATOR'
  | 'VIEWER'
  | 'STUDENT'
  | 'OPERMAQ'
  | 'USER'
  | null;

const SYSTEM_ADMIN_ROLES: UserRole[] = [
  'DEV_ROOT',
  'SUPER_ADMIN',
  'DEVELOPER',
  'ADMIN',
  'OWNER',
  'TEST_PILOT',
  'PILOT_LEAD',
  'OPERMAQ',
];

interface UserState {
  userId: string | null;
  userEmail: string | null;
  role: UserRole;
  isSystemAdmin: boolean;
  isLoading: boolean;
}

// Utilidad para limpiar cookies de bypass antiguas
const deleteCookie = (name: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
};

export function useCurrentUser(): UserState {
  const [user, setUser] = useState<UserState>({ 
    userId: null,
    userEmail: null,
    role: null, 
    isSystemAdmin: false, 
    isLoading: true 
  });

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Si hay una sesión activa real, limpiamos la cookie de bypass
          deleteCookie('opermaq_local_bypass_disabled');
          
          const idTokenResult = await firebaseUser.getIdTokenResult(true);
          const role = (idTokenResult.claims.role as UserRole) || null;
          
          setUser({
            userId: firebaseUser.uid,
            userEmail: firebaseUser.email,
            role: role,
            isSystemAdmin: SYSTEM_ADMIN_ROLES.includes(role),
            isLoading: false,
          });
        } catch (error) {
          console.error('[Auth Hook] Error getting token result:', error);
          setUser({ 
            userId: firebaseUser.uid,
            userEmail: firebaseUser.email,
            role: null, 
            isSystemAdmin: false,
            isLoading: false 
          });
        }
      } else {
        setUser({ userId: null, userEmail: null, role: null, isSystemAdmin: false, isLoading: false });
      }
    });
    return () => unsubscribe();
  }, []);

  return user;
}

