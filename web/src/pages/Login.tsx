import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, updateDoc, collection, query, where, getDocs, limit, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Loader2, Lock, Eye, EyeOff } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';

// Definición de Tipos para la UI
type LoginStep = 'IDENTIFICATION' | 'ACCOUNT_SELECTION' | 'CHALLENGE';
type AccountType = 'B2B' | 'EDU' | 'PERSONAL';

interface DetectedAccount {
    id: string;
    name: string;
    type: AccountType;
}

export const Login = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    // Estados del Flujo
    const [step, setStep] = useState<LoginStep>('IDENTIFICATION');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Data State
    const [detectedAccounts, setDetectedAccounts] = useState<DetectedAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<DetectedAccount | null>(null);

    // Limpieza de Memoria (Zero Memory Policy)
    useEffect(() => {
        return () => {
            setEmail('');
            setPassword('');
            setDetectedAccounts([]);
        };
    }, []);

    // Detección Real de Cuentas (Firestore)
    const detectUserAccounts = async (userEmail: string) => {
        setLoading(true);
        setError('');

        try {
            // Paso 1: Buscar Usuario por Email
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', userEmail), limit(1));
            const querySnapshot = await getDocs(q);

            // Paso 2: Validar existencia
            if (querySnapshot.empty) {
                setError(t('auth.user_not_found', 'Usuario no registrado'));
                setLoading(false);
                return;
            }

            const userDoc = querySnapshot.docs[0];
            const userData = userDoc.data();
            const memberships = userData.memberships || [];

            // Paso 3: Validar Membresías
            if (memberships.length === 0) {
                setError(t('auth.no_accounts', 'Este usuario no tiene cuentas asociadas'));
                setLoading(false);
                return;
            }

            // Paso 4: Resolver Cuentas (Join manual)
            // Iteramos las membresías para buscar los detalles de cada cuenta en la colección 'accounts'
            const accountsPromises = memberships.map(async (m: any) => {
                if (!m.accountId) return null;

                try {
                    const accountRef = doc(db, 'accounts', m.accountId);
                    const accountSnap = await getDoc(accountRef);

                    if (accountSnap.exists()) {
                        const data = accountSnap.data();
                        return {
                            id: accountSnap.id,
                            name: data.name || 'Sin Nombre',
                            type: data.type || 'PERSONAL'
                        } as DetectedAccount;
                    }
                } catch (e) {
                    console.error(`Error fetching account ${m.accountId}`, e);
                }
                return null;
            });

            const resolvedAccounts = (await Promise.all(accountsPromises)).filter(acc => acc !== null) as DetectedAccount[];

            if (resolvedAccounts.length === 0) {
                setError(t('auth.no_active_accounts', 'No se encontraron cuentas activas'));
                setLoading(false);
                return;
            }

            // Paso 5: Actualizar Estado y Avanzar
            setDetectedAccounts(resolvedAccounts);
            setStep('ACCOUNT_SELECTION');

        } catch (err: any) {
            console.error('Error detecting accounts:', err);
            // Mensaje genérico en caso de error de sistema/red
            setError(t('auth.detection_error', 'Error al verificar la cuenta. Intente nuevamente.'));
        } finally {
            setLoading(false);
        }
    };

    const handleIdentificationSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        detectUserAccounts(email);
    };

    const handleAccountSelect = (account: DetectedAccount) => {
        setSelectedAccount(account);
        setStep('CHALLENGE');
        setPassword(''); // Asegurar limpieza al entrar al challenge
        setError('');
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password || !selectedAccount) return;

        setLoading(true);
        setError('');

        try {
            // 1. Autenticación Firebase
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Actualizar Contexto (Last Active Account)
            // Esto asegura que al entrar, la sesión apunte a la cuenta seleccionada en este flujo "Túnel"
            try {
                const userRef = doc(db, 'users', user.uid);
                await updateDoc(userRef, {
                    lastActiveAccountId: selectedAccount.id
                });
            } catch (updateError) {
                console.warn('No se pudo actualizar la última cuenta activa:', updateError);
            }

            // 3. Limpieza y Redirección
            setPassword(''); // Limpieza inmediata
            navigate('/');

        } catch (err: any) {
            console.error('Login error:', err);
            let message = t('auth.login_error', 'Email o contraseña incorrectos.');

            // Mensajes genéricos por seguridad
            if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
                message = t('auth.invalid_credentials', 'Credenciales inválidas.');
            } else if (err.code === 'auth/network-request-failed') {
                message = t('auth.network_error', 'Error de conexión con el servidor.');
            } else if (err.code === 'auth/too-many-requests') {
                message = t('auth.too_many_requests', 'Demasiados intentos. Intente más tarde.');
            }

            setError(message);
        } finally {
            setLoading(false);
        }
    };

    // --- RENDERIZADORES DE ICONOS MATERIAL ---
    const renderIcon = (type: AccountType) => {
        switch (type) {
            case 'B2B': return 'business';
            case 'EDU': return 'school';
            case 'PERSONAL': return 'person';
            default: return 'help';
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] transition-colors p-4">
            <div className="w-full max-w-md">

                {/* Logo Centrado */}
                <div className="mb-8 flex justify-center">
                    <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800">
                        <BrandLogo variant="isotype" className="w-8 h-8" />
                    </div>
                </div>

                {/* Paso 1: Identificación */}
                {step === 'IDENTIFICATION' && (
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center mb-8">
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Hola de nuevo</h1>
                            <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                                Ingresa tu correo para continuar
                            </p>
                        </div>

                        <form onSubmit={handleIdentificationSubmit} className="space-y-6" autoComplete="off">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Correo Electrónico
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg text-center"
                                    placeholder="nombre@empresa.com"
                                    required
                                    autoFocus
                                    autoComplete="email"
                                    data-lpignore="true"
                                />
                            </div>

                            {error && step === 'IDENTIFICATION' && (
                                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                ) : (
                                    <>
                                        <span>Continuar</span>
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                )}

                {/* Paso 2: Selección de Cuenta */}
                {step === 'ACCOUNT_SELECTION' && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500 w-full">
                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Selecciona una cuenta</h2>
                            <p className="text-gray-500 dark:text-gray-400 mt-1">
                                Hemos encontrado {detectedAccounts.length} perfiles asociados
                            </p>
                        </div>

                        <div className="grid gap-4">
                            {detectedAccounts.map((account: DetectedAccount) => (
                                <button
                                    key={account.id}
                                    onClick={() => handleAccountSelect(account)}
                                    className="group relative flex items-center p-4 bg-white dark:bg-[#1E1E1E] rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-indigo-500 dark:hover:border-indigo-500 shadow-sm hover:shadow-md transition-all duration-200 text-left w-full"
                                >
                                    {/* Icono (Visual Distinctive) */}
                                    <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mr-4 group-hover:scale-105 transition-transform">
                                        <span className="material-symbols-rounded text-[28px]">
                                            {renderIcon(account.type)}
                                        </span>
                                    </div>

                                    {/* Info Cuenta */}
                                    <div className="flex-1">
                                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                            {account.name}
                                        </h3>
                                    </div>

                                    {/* Indicador Selección */}
                                    <div className="text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all">
                                        <span className="material-symbols-rounded">arrow_forward_ios</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="mt-8 text-center">
                            <button
                                onClick={() => {
                                    setStep('IDENTIFICATION');
                                    setEmail('');
                                }}
                                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors font-medium"
                            >
                                Usar otra dirección de correo
                            </button>
                        </div>
                    </div>
                )}

                {/* Paso 3: CHALLENGE (Password) */}
                {step === 'CHALLENGE' && selectedAccount && (
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-right-8 duration-500 w-full">

                        {/* Header Visual: Túnel Único Context */}
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <span className="material-symbols-rounded text-4xl">
                                    {renderIcon(selectedAccount.type)}
                                </span>
                            </div>
                            <p className="text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase tracking-wider">
                                Ingreso seguro a entorno aislado
                            </p>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                                {selectedAccount.name}
                            </h2>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-6" autoComplete="off">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Contraseña
                                </label>
                                <div className="relative group">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="pwd_challenge_field" // Non-standard name
                                        id="pwd_access_token"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-5 pr-12 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg"
                                        placeholder="••••••••"
                                        required
                                        autoFocus
                                        autoComplete="new-password" // Critical Anti-Autofill 
                                        data-lpignore="true" // Ignore LastPass
                                        data-form-type="other" // Hint for Safari
                                        onCopy={(e) => e.preventDefault()}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-3">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {loading ? (
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    ) : (
                                        <>
                                            <span>Acceder al Entorno</span>
                                            <Lock size={18} />
                                        </>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('ACCOUNT_SELECTION');
                                        setPassword('');
                                        setError('');
                                        setSelectedAccount(null);
                                    }}
                                    className="w-full py-3 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <ArrowLeft size={18} />
                                    <span>Cancelar</span>
                                </button>
                            </div>
                        </form>
                    </div>
                )}

            </div>
        </div>
    );
};
