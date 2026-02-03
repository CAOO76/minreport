
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { UserProfile, Account } from '../../../src/types/auth';
import { checkAndClaimInvitations } from '../utils/invitationHandler';

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    currentAccount: Account | null;
    loading: boolean;
    switchAccount: (accountId: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
    const [loading, setLoading] = useState(true);

    // 0. Auto-Discovery Logic (Delegate to Utility)
    const checkPendingInvites = async (currentUser: User) => {
        await checkAndClaimInvitations(currentUser, db);
    };

    // 1. Listen to Firebase Auth state
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (!currentUser) {
                setProfile(null);
                setCurrentAccount(null);
                setLoading(false);
            } else {
                // Determine if we need to set loading to true
                // If we are coming from a logged-out state, loading might be false.
                // We want to force it to true until profile/account are resolved.
                setLoading(true);
                // Trigger invite check on login (fire functions background)
                checkPendingInvites(currentUser);
            }
        });
        return unsubscribe;
    }, []);

    // 2. Listen to User Profile (Firestore) when User is authenticated
    useEffect(() => {
        if (!user) return;

        const userRef = doc(db, 'users', user.uid);
        const unsubscribe = onSnapshot(userRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data() as UserProfile;
                setProfile(data);
            } else {
                // Handle case where auth exists but profile doesn't (legacy or error)
                console.error("User profile not found for uid:", user.uid);
                setProfile(null);
            }
        }, (error) => {
            console.error("Error fetching user profile:", error);
            setLoading(false);
        });

        return unsubscribe;
    }, [user]);

    // 3. Determine and Fetch Current Account
    useEffect(() => {
        const resolveAccount = async () => {
            if (!user) {
                setLoading(false);
                return;
            }

            // [CRITICAL FIX] Prioritize ID Token Claims (Source of Truth from Login Tunnel)
            let targetAccountId: string | null = null;

            try {
                // Force refresh to ensure we have the latest claims from the tunnel login
                const idTokenResult = await user.getIdTokenResult();
                const claims = idTokenResult.claims;

                if (claims.activeAccountId) {
                    console.log(`[AUTH-CONTEXT] Using Claim Account ID: ${claims.activeAccountId}`);
                    targetAccountId = claims.activeAccountId as string;
                }
            } catch (e) {
                console.warn("Failed to get token claims", e);
            }

            // Fallback: Use Firestore Profile Profile if claims are missing (e.g. persistent session)
            if (!targetAccountId && profile) {
                if (profile.memberships && profile.memberships.length > 0) {
                    // Scenario 1: Only one account -> Auto-select
                    if (profile.memberships.length === 1) {
                        targetAccountId = profile.memberships[0].accountId;
                    }
                    // Scenario 2: Multiple accounts -> Respect last active
                    else if (profile.lastActiveAccountId) {
                        const hasMembership = profile.memberships.some(m => m.accountId === profile.lastActiveAccountId);
                        if (hasMembership) {
                            targetAccountId = profile.lastActiveAccountId;
                        }
                    }
                }
            }

            // If we have a target account, fetch it
            if (targetAccountId) {
                // Optimization: Don't re-fetch if already loaded
                if (currentAccount?.id === targetAccountId) {
                    setLoading(false);
                    return;
                }

                try {
                    const accountRef = doc(db, 'accounts', targetAccountId);
                    const accountSnap = await getDoc(accountRef);
                    if (accountSnap.exists()) {
                        const accountData = accountSnap.data();
                        console.log(`[AUTH-CONTEXT] Resolved Account: ${accountData.name}`);
                        setCurrentAccount({ id: accountSnap.id, ...accountData } as Account);
                    } else {
                        console.warn(`[AUTH-CONTEXT] Account ${targetAccountId} not found in Firestore.`);
                        setCurrentAccount(null);
                    }
                } catch (err) {
                    console.error("[AUTH-CONTEXT] Error fetching account:", err);
                    setCurrentAccount(null);
                }
            } else {
                // Valid state: User is logged in but hasn't selected an account yet
                // Only stop loading if we have the profile loaded (so we know for sure they have multiple options)
                if (profile) {
                    setCurrentAccount(null);
                }
            }

            // Critical: Ensure loading stops eventually
            if (profile || !user) {
                setLoading(false);
            }
        };

        resolveAccount();
    }, [user, profile]); // Re-run if user (token refresh) or profile changes

    const switchAccount = async (accountId: string) => {
        if (!user || !profile) return;

        // Verify membership
        const hasMembership = profile.memberships?.some(m => m.accountId === accountId);
        if (!hasMembership) {
            throw new Error("User is not a member of this account.");
        }

        // Update local state (optimistic) and Firestore
        try {
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, { lastActiveAccountId: accountId });
            // The snapshot listener in useEffect #2 will update 'profile', 
            // triggering useEffect #3 to fetch 'currentAccount'
        } catch (error) {
            console.error("Error switching account:", error);
            throw error;
        }
    };

    const signOut = async () => {
        try {
            await firebaseSignOut(auth);
            // State defaults to null via useEffect #1
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, profile, currentAccount, loading, switchAccount, signOut }}>
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
