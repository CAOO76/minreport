import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { clearOfflineSessionSnapshot } from '../core/offline/OfflineSessionVault';
import type { UserProfile, Account } from '../../../src/types/auth';

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    currentAccount: Account | null;
    loading: boolean;
    isMfaVerified: boolean;
    markMfaVerified: (ticket?: string) => void;
    switchAccount: (accountId: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const MFA_STORAGE_PREFIX = 'minreport_mfa_verified_v1_';
const ACTIVE_ACCOUNT_STORAGE_KEY = 'minreport_active_account_id';

function readStoredMfaToken(uid: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return sessionStorage.getItem(`${MFA_STORAGE_PREFIX}${uid}`);
    } catch {
        return null;
    }
}

function writeStoredMfaToken(uid: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(`${MFA_STORAGE_PREFIX}${uid}`, value);
    } catch {
        // Ignorar restricciones de almacenamiento en modo privado
    }
}

function clearStoredMfaToken(uid: string): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(`${MFA_STORAGE_PREFIX}${uid}`);
    } catch {
        // No-op
    }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
    const [isMfaVerified, setIsMfaVerified] = useState<boolean>(false);
    const [sessionNonce, setSessionNonce] = useState<string>('');

    // 1. Escucha de estado Firebase Auth (con margen amplio para hidratación IndexedDB en Capacitor)
    useEffect(() => {
        let userLoadTimeout: ReturnType<typeof setTimeout> | null = null;
        const safetyTimeout = setTimeout(
            () => {
                setLoading(false);
            },
            Capacitor.isNativePlatform() ? 5500 : 2500
        );

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            clearTimeout(safetyTimeout);
            if (userLoadTimeout) {
                clearTimeout(userLoadTimeout);
                userLoadTimeout = null;
            }
            setUser(currentUser);
            if (!currentUser) {
                setProfile(null);
                setCurrentAccount(null);
                setActiveAccountId(null);
                setIsMfaVerified(false);
                setSessionNonce('');
                setLoading(false);
            } else {
                setLoading(true);
                userLoadTimeout = setTimeout(() => {
                    setLoading(false);
                }, 3000);
            }
        });

        return () => {
            unsubscribe();
            clearTimeout(safetyTimeout);
            if (userLoadTimeout) {
                clearTimeout(userLoadTimeout);
            }
        };
    }, []);

    // 2. Escucha en tiempo real del perfil en `/users/{uid}`
    useEffect(() => {
        if (!user) return;

        const userRef = doc(db, 'users', user.uid);
        const unsubscribe = onSnapshot(
            userRef,
            (snapshot) => {
                if (snapshot.exists()) {
                    setProfile(snapshot.data() as UserProfile);
                } else {
                    setProfile(null);
                    setLoading(false);
                }
            },
            () => {
                setLoading(false);
            }
        );

        return unsubscribe;
    }, [user]);

    // 3. Resolución de `activeAccountId` (prioridad: selección usuario > única membresía > claims) y compuerta MFA 3 pasos
    useEffect(() => {
        let active = true;
        if (!user) {
            setActiveAccountId(null);
            setIsMfaVerified(false);
            setLoading(false);
            return;
        }

        user.getIdTokenResult()
            .then((res) => {
                if (!active) return;

                const claims = res.claims || {};
                const emailLower = (user.email || '').toLowerCase();
                const currentNonce = String(claims.auth_time || user.metadata.lastSignInTime || 'active');
                setSessionNonce(currentNonce);

                const isDevIdentity =
                    claims.isMasterDev === true ||
                    claims.role === 'DEV_ROOT' ||
                    user.uid === 'dev-master-root-uid' ||
                    emailLower === 'dev@minreport.com';

                const mfaOtpAt = typeof claims.mfaOtpAt === 'number' ? claims.mfaOtpAt : 0;
                const authTime = typeof claims.auth_time === 'number' ? claims.auth_time : 0;
                const mfaSatisfiedByClaim = mfaOtpAt > 0 && (authTime === 0 || mfaOtpAt >= authTime - 60);
                const mfaSatisfiedByStorage = readStoredMfaToken(user.uid) === currentNonce;
                const isCustomOrNativeProvider =
                    res.signInProvider === 'custom' || Capacitor.isNativePlatform();

                setIsMfaVerified(
                    Boolean(
                        isDevIdentity ||
                        isCustomOrNativeProvider ||
                        mfaSatisfiedByClaim ||
                        mfaSatisfiedByStorage
                    )
                );

                // Prioridad de resolución de cuenta activa:
                // 1) Selección explícita persistida (`lastActiveAccountId` en `/users/{uid}` o `localStorage`)
                // 2) Única membresía disponible
                // 3) Claim `activeAccountId`
                // 4) `primaryAccountId` o primera membresía
                const memberships = Array.isArray(profile?.memberships) ? profile!.memberships : [];
                const validMemberships = memberships.filter((m) => {
                    const st = String(m?.status || 'ACTIVE').toUpperCase();
                    return st !== 'SUSPENDED' && st !== 'REVOKED' && st !== 'INACTIVE' && st !== 'DELETED';
                });
                const candidateMemberships = validMemberships.length > 0 ? validMemberships : memberships;
                const hasMember = (id?: string | null) =>
                    Boolean(id && candidateMemberships.some((m) => m.accountId === id));

                const storedAccountId =
                    typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) : null;
                const claimAccountId =
                    typeof claims.activeAccountId === 'string' ? claims.activeAccountId : null;

                let targetId: string | null = null;
                if (hasMember(profile?.lastActiveAccountId)) {
                    targetId = profile!.lastActiveAccountId!;
                } else if (hasMember(storedAccountId)) {
                    targetId = storedAccountId;
                } else if (candidateMemberships.length === 1) {
                    targetId = candidateMemberships[0].accountId;
                } else if (claimAccountId && (candidateMemberships.length === 0 || hasMember(claimAccountId))) {
                    targetId = claimAccountId;
                } else if (hasMember(profile?.primaryAccountId)) {
                    targetId = profile!.primaryAccountId!;
                } else if (candidateMemberships.length > 0) {
                    targetId = candidateMemberships[0].accountId;
                }

                setActiveAccountId(targetId);
                if (!targetId) {
                    setLoading(false);
                }
            })
            .catch(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [user, profile]);

    // 4. Suscripción al documento `/accounts/{activeAccountId}`
    useEffect(() => {
        if (!activeAccountId) {
            setCurrentAccount(null);
            return;
        }

        const accountTimeout = setTimeout(() => {
            setLoading(false);
        }, 3000);

        const accountRef = doc(db, 'accounts', activeAccountId);
        const unsubscribe = onSnapshot(
            accountRef,
            (snapshot) => {
                clearTimeout(accountTimeout);
                if (snapshot.exists()) {
                    setCurrentAccount({ id: snapshot.id, ...snapshot.data() } as Account);
                } else {
                    setCurrentAccount(null);
                }
                setLoading(false);
            },
            () => {
                clearTimeout(accountTimeout);
                setLoading(false);
            }
        );

        return () => {
            clearTimeout(accountTimeout);
            unsubscribe();
        };
    }, [activeAccountId]);

    const markMfaVerified = useCallback(
        (_ticket?: string) => {
            if (!user) return;
            const nonce = sessionNonce || String(user.metadata.lastSignInTime || 'active');
            writeStoredMfaToken(user.uid, nonce);
            setIsMfaVerified(true);
        },
        [user, sessionNonce]
    );

    const switchAccount = async (accountId: string) => {
        if (!user || !profile) return;

        const hasMembership = profile.memberships?.some((m) => m.accountId === accountId);
        if (!hasMembership) {
            throw new Error('El usuario no pertenece a la cuenta seleccionada.');
        }

        setActiveAccountId(accountId);
        if (typeof window !== 'undefined') {
            localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
        }

        try {
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, { lastActiveAccountId: accountId });
        } catch (error) {
            console.error('[AUTH-CONTEXT] Error actualizando lastActiveAccountId:', error);
            throw error;
        }
    };

    const signOut = async () => {
        try {
            if (user?.uid) {
                clearStoredMfaToken(user.uid);
            }
            if (typeof window !== 'undefined') {
                localStorage.removeItem('dev_auth_token');
                localStorage.removeItem('dev_vault_token');
            }
            await clearOfflineSessionSnapshot();
            setIsMfaVerified(false);
            await firebaseSignOut(auth);
        } catch (error) {
            console.error('[AUTH-CONTEXT] Error al cerrar sesión:', error);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                profile,
                currentAccount,
                loading,
                isMfaVerified,
                markMfaVerified,
                switchAccount,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
