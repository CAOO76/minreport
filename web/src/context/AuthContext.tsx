
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
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
        // [SAFETY HATCH] If auth takes more than 10 seconds, stop loading
        const safetyTimeout = setTimeout(() => {
            if (loading) {
                console.warn("[AUTH-CONTEXT] Safety timeout reached. Forcing loading to false.");
                setLoading(false);
            }
        }, 10000);

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            clearTimeout(safetyTimeout);
            setUser(currentUser);
            if (!currentUser) {
                setProfile(null);
                setCurrentAccount(null);
                setLoading(false);
            } else {
                setLoading(true);
                checkPendingInvites(currentUser);
            }
        });
        return () => {
            unsubscribe();
            clearTimeout(safetyTimeout);
        };
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



    // NEW STATE for stability
    const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

    // 3.1 Resolve ID
    useEffect(() => {
        if (!user) {
            setActiveAccountId(null);
            setLoading(false);
            return;
        }

        let targetId: string | null = null;

        // Claims Check (Priority 1)
        user.getIdTokenResult().then(res => {
            if (res.claims.activeAccountId) {
                targetId = res.claims.activeAccountId as string;
            }
            // Fallback Profile (Priority 2)
            if (!targetId && profile) {
                if (profile.memberships?.length === 1) targetId = profile.memberships[0].accountId;
                else if (profile.lastActiveAccountId) {
                    if (profile.memberships?.some(m => m.accountId === profile.lastActiveAccountId)) {
                        targetId = profile.lastActiveAccountId;
                    }
                }
            }

            // Set ID (triggers listener)
            setActiveAccountId(targetId);

            // Stop loading if we have profile but no account selected (valid state)
            if (profile && !targetId) setLoading(false);

        }).catch(err => {
            console.error("Token error", err);
            setLoading(false);
        });

    }, [user, profile]);

    // 3.2 Listen to Account Data
    useEffect(() => {
        if (!activeAccountId) {
            setCurrentAccount(null);
            return;
        }

        console.log(`[AUTH-CONTEXT] Subscribing to Account: ${activeAccountId}`);
        const accountRef = doc(db, 'accounts', activeAccountId);

        const unsubscribe = onSnapshot(accountRef, (snapshot) => {
            if (snapshot.exists()) {
                setCurrentAccount({ id: snapshot.id, ...snapshot.data() } as Account);
            } else {
                console.warn("Account not found");
                setCurrentAccount(null);
            }
            setLoading(false); // Data ready
        }, (err) => {
            console.error("Account listen error", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [activeAccountId]);

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
