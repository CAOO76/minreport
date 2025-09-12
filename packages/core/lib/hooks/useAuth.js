import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
const useAuth = (authInstance) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
            setUser(user);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [authInstance]);
    const login = async (email, password) => {
        setLoading(true);
        try {
            await signInWithEmailAndPassword(authInstance, email, password);
        }
        catch (err) {
            console.error('useAuth: Login error caught:', err);
            throw err;
        }
        finally {
            setLoading(false);
        }
    };
    const logout = async () => {
        setLoading(true);
        try {
            await signOut(authInstance);
        }
        finally {
            setLoading(false);
        }
    };
    return { user, loading, login, logout };
};
export default useAuth;
//# sourceMappingURL=useAuth.js.map