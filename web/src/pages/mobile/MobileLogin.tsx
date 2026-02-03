
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';

const MobileLogin: React.FC = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // 1. Authenticate with Firebase Auth
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Fetch User Profile
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                throw new Error("Perfil de usuario no encontrado.");
            }

            const userData = userSnap.data();
            const lastActiveAccountId = userData.lastActiveAccountId;

            // Resolve Account (Logic: Last Active -> First Membership)
            let targetAccountId = lastActiveAccountId;
            if (!targetAccountId && userData.memberships?.length > 0) {
                targetAccountId = userData.memberships[0].accountId;
            }

            if (!targetAccountId) {
                throw new Error("No tienes cuentas asociadas.");
            }

            // 3. Fetch Account Data
            const accountRef = doc(db, 'accounts', targetAccountId);
            const accountSnap = await getDoc(accountRef);

            if (!accountSnap.exists()) {
                throw new Error("La cuenta asociada no existe.");
            }

            const accountData = accountSnap.data();

            // Determine Role in THIS account
            const membership = userData.memberships?.find((m: any) => m.accountId === targetAccountId);
            const role = membership?.role || 'MEMBER';

            // 4. GATEKEEPER ALGORITHM (Mobile Access Control)

            // CASE 1: B2B Admin Block
            if (accountData.type === 'ENTERPRISE' && role === 'OWNER') {
                await signOut(auth);
                setError("Acceso móvil restringido para administradores. Use la versión de escritorio.");
                setLoading(false);
                return;
            }

            // CASE 2: Access Allowed (Enterprise Member, Personal, Educational)
            // (Implicit else)
            navigate('/mobile/dashboard');

        } catch (err: any) {
            console.error("Mobile Login Error:", err);

            // Prioridad 1: Errores de Firebase conocidos
            if (err.code === 'auth/invalid-credential') {
                setError('Credenciales incorrectas.');
            }
            else if (err.code === 'auth/user-disabled') {
                setError('Usuario deshabilitado.');
            }
            // Prioridad 2: Errores de Lógica de Negocio (El mensaje de bloqueo)
            else if (err.message) {
                setError(err.message);
            }
            // Fallback
            else {
                setError('Error al iniciar sesión.');
            }

            // Ensure clean state on error
            if (auth.currentUser) await signOut(auth);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen overflow-hidden bg-white dark:bg-black text-gray-900 dark:text-gray-100 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">

            {/* Header / Brand */}
            <div className="flex-1 flex flex-col justify-center px-8 items-center">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl mb-6 shadow-lg shadow-blue-500/30 flex items-center justify-center">
                    {/* Placeholder Logo */}
                    <span className="text-white font-bold text-2xl">M</span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight">Bienvenido</h1>
                <p className="text-gray-500 text-sm mt-2">Inicia sesión para continuar</p>
            </div>

            {/* Form */}
            <div className="flex-[2] px-8 flex flex-col justify-start space-y-6">

                {error && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-5" autoComplete="off">

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">Email</label>
                        <input
                            type="email"
                            className="w-full h-14 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-gray-400"
                            placeholder="nombre@ejemplo.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">Contraseña</label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="w-full h-14 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl pl-4 pr-12 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-gray-400"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-0 top-0 h-full px-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end pt-1">
                        <a href="/password-reset" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                            ¿Olvidaste tu contraseña?
                        </a>
                    </div>

                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full h-14 bg-black dark:bg-white text-white dark:text-black font-bold text-lg rounded-xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:hover:scale-100"
                        >
                            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                            {loading ? 'Ingresando...' : 'Ingresar'}
                        </button>
                    </div>

                </form>
            </div>

            {/* Footer Safe Area */}
            <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
    );
};

export default MobileLogin;
