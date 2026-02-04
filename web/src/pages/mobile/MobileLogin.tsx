import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import {
    Eye,
    EyeOff,
    Loader2,
    AlertTriangle,
    ArrowRight,
    ArrowLeft,
    ChevronRight,
    Lock,
    User
} from 'lucide-react';
import { formatRut } from '../../utils/rut';

type LoginStep = 'IDENTIFICATION' | 'ACCOUNT_SELECTION' | 'CHALLENGE';
type AccountType = 'B2B' | 'EDU' | 'PERSONAL';

interface DetectedAccount {
    id: string;
    name: string;
    type: AccountType;
}

const MobileLogin: React.FC = () => {
    const navigate = useNavigate();

    // Estados del Flujo
    const [step, setStep] = useState<LoginStep>('IDENTIFICATION');
    const [taxId, setTaxId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Dynamic API URL Resolver for Native Connectivity
    const getBaseUrl = () => {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

        // If we are on Android emulator and baseUrl is localhost, use the bridge IP 10.0.2.2
        if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'))) {
            return baseUrl.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
        }

        // In any other case (Physical device with IP in .env, or web), use baseUrl as is
        return baseUrl;
    };

    // Data State
    const [detectedAccounts, setDetectedAccounts] = useState<DetectedAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<DetectedAccount | null>(null);

    // Reset on error/backtrack
    const handleBack = () => {
        if (step === 'ACCOUNT_SELECTION') setStep('IDENTIFICATION');
        if (step === 'CHALLENGE') setStep('ACCOUNT_SELECTION');
        setError(null);
    };

    // 1. Detección de Cuentas (ID-Céntrico)
    const handleIdentificationSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!taxId.trim()) return;

        setLoading(true);
        setError(null);

        try {
            const baseUrl = getBaseUrl();
            const response = await fetch(`${baseUrl}/api/public/accounts-by-id/${taxId}`);

            if (!response.ok) {
                const data = await response.json();
                setError(data.message || 'ID no encontrado en el sistema.');
                setLoading(false);
                return;
            }

            const data = await response.json();

            if (data.accounts.length === 0) {
                setError('Este RUT no tiene cuentas asociadas.');
                setLoading(false);
                return;
            }

            // Mapear y Deduplicar por accountId (evitar duplicados por múltiples roles)
            const accountMap = new Map();
            data.accounts.forEach((acc: any) => {
                if (!accountMap.has(acc.accountId)) {
                    accountMap.set(acc.accountId, {
                        id: acc.accountId,
                        name: acc.accountName,
                        type: acc.type
                    });
                }
            });

            setDetectedAccounts(Array.from(accountMap.values()));
            setStep('ACCOUNT_SELECTION');

        } catch (err: any) {
            console.error('Error detecting accounts:', err);
            const baseUrl = getBaseUrl();
            setError(`Error de conexión (API: ${baseUrl}). Verifica que tu servidor esté activo.`);
        } finally {
            setLoading(false);
        }
    };

    // 2. Selección de Cuenta
    const handleAccountSelect = (account: DetectedAccount) => {
        setSelectedAccount(account);
        setStep('CHALLENGE');
        setPassword('');
        setError(null);
    };

    // 3. Desafío de Login (Tunnel)
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!taxId || !password || !selectedAccount) return;

        setLoading(true);
        setError(null);

        try {
            // A. Desafío Túnel
            const baseUrl = getBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/tunnel/challenge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxId,
                    accountId: selectedAccount.id,
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Credenciales inválidas.');
                setLoading(false);
                return;
            }

            // B. Autenticación Firebase (Token Personalizado)
            const userCredential = await signInWithCustomToken(auth, data.firebaseToken);
            const user = userCredential.user;

            // C. Gatekeeper B2B Admin (Safety Check)
            const accountRef = doc(db, 'accounts', selectedAccount.id);
            const accountSnap = await getDoc(accountRef);

            if (accountSnap.exists()) {
                const accountData = accountSnap.data();

                // Fetch user specific role in this account
                const userRef = doc(db, 'users', user.uid);
                const userSnap = await getDoc(userRef);
                const userData = userSnap.data();
                const membership = userData?.memberships?.find((m: any) => m.accountId === selectedAccount.id);
                const role = membership?.role || 'MEMBER';

                if (accountData.type === 'ENTERPRISE' && role === 'OWNER') {
                    await signOut(auth);
                    setError("Acceso móvil restringido para administradores. Use la versión de escritorio.");
                    setLoading(false);
                    return;
                }
            }

            // D. Navegación Exitosa
            navigate('/mobile/dashboard');

        } catch (err: any) {
            console.error('Mobile Login Error:', err);
            const baseUrl = getBaseUrl();
            setError(`Error de conexión al servidor (API: ${baseUrl}). Verifica que tu servidor esté activo.`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen overflow-hidden bg-white dark:bg-black text-gray-900 dark:text-gray-100 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">

            {/* Top Bar / Back Button */}
            <div className="h-14 flex items-center px-4">
                {step !== 'IDENTIFICATION' && (
                    <button
                        onClick={handleBack}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                        <ArrowLeft size={24} />
                    </button>
                )}
            </div>

            <div className="flex-1 flex flex-col px-8 overflow-y-auto pb-12">

                {/* Visual Header */}
                <div className="py-8 flex flex-col items-center">
                    <div className="w-16 h-16 bg-indigo-600 rounded-2xl mb-6 shadow-xl shadow-indigo-500/20 flex items-center justify-center">
                        <Lock className="text-white w-8 h-8" />
                    </div>
                    {step === 'IDENTIFICATION' && (
                        <>
                            <h1 className="text-2xl font-bold tracking-tight">Hola de nuevo</h1>
                            <p className="text-gray-500 text-sm mt-2 text-center text-pretty">
                                Ingresa tu RUT para comenzar
                            </p>
                        </>
                    )}
                    {step === 'ACCOUNT_SELECTION' && (
                        <>
                            <h1 className="text-2xl font-bold tracking-tight">Selecciona Cuenta</h1>
                            <p className="text-gray-500 text-sm mt-2 text-center">
                                Hemos encontrado {detectedAccounts.length} perfiles
                            </p>
                        </>
                    )}
                    {step === 'CHALLENGE' && selectedAccount && (
                        <>
                            <h1 className="text-2xl font-bold tracking-tight">{selectedAccount.name}</h1>
                            <p className="text-gray-500 text-sm mt-2 text-center">
                                Ingresa tu contraseña de acceso
                            </p>
                        </>
                    )}
                </div>

                {/* Main Form Area */}
                <div className="space-y-6">
                    {error && (
                        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
                        </div>
                    )}

                    {step === 'IDENTIFICATION' && (
                        <form onSubmit={handleIdentificationSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500" autoComplete="off">
                            <div className="space-y-2">
                                <label className="text-[11px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest ml-1">
                                    RUT / RUN
                                </label>
                                <div className="relative">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                        <User size={20} />
                                    </div>
                                    <input
                                        type="text"
                                        className="w-full h-16 bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl pl-12 pr-4 text-lg font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder:text-gray-400"
                                        placeholder="12.345.678-9"
                                        value={taxId}
                                        onChange={(e) => setTaxId(formatRut(e.target.value))}
                                        required
                                        autoComplete="off"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading || !taxId}
                                className="w-full h-16 bg-black dark:bg-white text-white dark:text-black font-bold text-lg rounded-2xl shadow-xl active:scale-[0.97] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <span>Continuar</span>}
                                {!loading && <ArrowRight size={20} />}
                            </button>
                        </form>
                    )}

                    {step === 'ACCOUNT_SELECTION' && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-right-4 duration-500">
                            {detectedAccounts.map((acc) => (
                                <button
                                    key={acc.id}
                                    onClick={() => handleAccountSelect(acc)}
                                    className="w-full p-5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl flex items-center gap-4 active:scale-[0.98] transition-all text-left shadow-sm hover:border-indigo-500/50"
                                >
                                    <div className="w-12 h-12 bg-gray-50 dark:bg-black rounded-xl flex items-center justify-center text-gray-400">
                                        {acc.type === 'B2B' ? <Lock size={22} /> : <User size={22} />}
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-bold text-base leading-tight">{acc.name}</p>
                                        <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wider">{acc.type}</p>
                                    </div>
                                    <ChevronRight className="text-gray-300" size={20} />
                                </button>
                            ))}
                        </div>
                    )}

                    {step === 'CHALLENGE' && (
                        <form onSubmit={handleLogin} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500" autoComplete="off">
                            <div className="space-y-2">
                                <label className="text-[11px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest ml-1">
                                    Contraseña
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="w-full h-16 bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl px-4 text-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-0 top-0 h-full px-5 text-gray-400"
                                    >
                                        {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                                    </button>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full h-16 bg-indigo-600 text-white font-bold text-lg rounded-2xl shadow-xl shadow-indigo-600/20 active:scale-[0.97] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {loading && <Loader2 className="w-6 h-6 animate-spin" />}
                                {loading ? 'Validando...' : 'Acceder al Entorno'}
                            </button>
                        </form>
                    )}
                </div>

                <div className="mt-8 text-center px-4">
                    <p className="text-xs text-gray-400 dark:text-zinc-600 leading-relaxed">
                        Al ingresar, aceptas los términos de uso y las políticas de seguridad de MINREPORT.
                    </p>
                </div>

            </div>

            {/* Footer Safe Area */}
            <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
    );
};

export default MobileLogin;
