import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../firebase';

interface AuthUser extends User {
    is_setup_completed?: boolean;
    type?: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    // Add other profile fields if needed
}

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchUserProfile = async (firebaseUser: User) => {
        try {
            // Get ID token to fetch from our API or Firestore directly
            // For simplicity, we can fetch from Firestore tenants collection
            const { db } = await import('../firebase');
            const { doc, getDoc } = await import('firebase/firestore');

            const docRef = doc(db, 'tenants', firebaseUser.email!.toLowerCase());
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                return {
                    ...firebaseUser,
                    is_setup_completed: data.is_setup_completed || false,
                    type: data.type
                };
            }
        } catch (error) {
            console.error('Error fetching user profile:', error);
        }
        return firebaseUser as AuthUser;
    };

    const refreshUser = async () => {
        if (auth.currentUser) {
            const updatedUser = await fetchUserProfile(auth.currentUser);
            setUser(updatedUser);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                const profileUser = await fetchUserProfile(currentUser);
                setUser(profileUser);
            } else {
                setUser(null);
            }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, refreshUser }}>
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
