import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { formatRut } from '../../utils/rut';
import {
    Eye,
    EyeOff,
    Loader2,
    AlertTriangle,
    ArrowRight,
    ArrowLeft,
    ChevronRight,
    Lock
} from 'lucide-react';
<<<<<<< Updated upstream
import { getApiUrl } from '../../utils/network';
=======
import { formatRut } from '../../utils/rut';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { ThemeSwitch } from '../../components/ThemeSwitch';
>>>>>>> Stashed changes

type LoginStep = 'IDENTIFICATION' | 'ACCOUNT_SELECTION' | 'CHALLENGE';
type AccountType = 'B2B' | 'EDU' | 'PERSONAL';

interface DetectedAccount {
    id: string;
    name: string;
    type: AccountType;
    authEmail: string; // [FIX] Required for challenge
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
            const response = await fetch(getApiUrl(`/api/public/accounts-by-id/${taxId}`));

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
                        type: acc.type,
                        authEmail: acc.authEmail // [FIX] Store for challenge
                    });
                }
            });

            setDetectedAccounts(Array.from(accountMap.values()));
            setStep('ACCOUNT_SELECTION');

        } catch (err: any) {
            console.error('Error detecting accounts:', err);
            setError(`Error de conexión. Verifica que tu servidor esté activo.`);
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
            const response = await fetch(getApiUrl('/api/auth/tunnel/challenge'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxId,
                    accountId: selectedAccount.id,
                    authEmail: selectedAccount.authEmail, // [FIX] Critical parameter
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
            setError(`Error de conexión al servidor. Verifica que tu servidor esté activo.`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen overflow-hidden bg-white dark:bg-black text-black dark:text-white flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] relative industrial-mineral-gradient">
            {/* Background Layer Grid Overlay */}
            <div className="absolute inset-0 technical-grid opacity-10 pointer-events-none"></div>

            <div className="h-20 flex items-center px-8 relative z-50">
                {step !== 'IDENTIFICATION' ? (
                    <button
                        onClick={handleBack}
                        className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-none transition-all active:scale-95"
                    >
                        <ArrowLeft size={20} className="text-black dark:text-white" />
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <LanguageSwitch />
                        <ThemeSwitch />
                    </div>
                )}
                <div className="flex-1 text-center">
                    <p className="hud-label text-black/40 dark:text-white/20">MNR_SECURE_PROTO_v2.0</p>
                </div>
                <div className="w-20"></div> {/* Spacer for symmetry */}
            </div>

            <div className="flex-1 flex flex-col px-8 overflow-y-auto pb-12">

                {/* Visual Header */}
                <div className="py-12 flex flex-col items-center">
                    <div className="w-24 h-24 bg-black dark:bg-white flex items-center justify-center border border-black/10 dark:border-white/10 mb-8 transition-transform hover:scale-105 duration-700 relative">
                        <div className="absolute inset-0 technical-grid opacity-20"></div>
                        <Lock className="text-white dark:text-black w-10 h-10 relative z-10" />
                    </div>

                    {step === 'IDENTIFICATION' && (
                        <div className="text-center">
                            <span className="material-symbols-rounded text-6xl text-emerald-500">input</span>
                        </div>
                    )}
                    {step === 'ACCOUNT_SELECTION' && (
                        <div className="text-center">
                            <h1 className="text-4xl font-black tracking-tight uppercase leading-none">SELECT_ENV</h1>
                            <p className="hud-label mt-4 text-center">
                                [{detectedAccounts.length}_VULCAN_ENVIRONMENTS_DETECTED]
                            </p>
                        </div>
                    )}
                    {step === 'CHALLENGE' && selectedAccount && (
                        <div className="text-center">
                            <h1 className="text-3xl font-black tracking-tight uppercase leading-none">{selectedAccount.name}</h1>
                            <p className="hud-label mt-4 text-center">
                                [CHALLENGE_ACTIVE] INGRESA CREDENCIAL DE ACCESO
                            </p>
                        </div>
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
                        <form onSubmit={handleIdentificationSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500" autoComplete="off">
                            <div className="space-y-3">
                                <div className="flex justify-between items-end px-1">
                                    <label className="hud-label">Documento ID (RUT / RUN)</label>
                                    <span className="text-[10px] font-mono opacity-20">[01]</span>
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        className="premium-input text-center text-2xl tracking-[0.2em] h-20"
                                        placeholder="12.345.678-9"
                                        value={taxId}
                                        onChange={(e) => setTaxId(formatRut(e.target.value))}
                                        required
                                        autoFocus
                                        autoComplete="off"
                                        spellCheck="false"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        data-lpignore="true"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading || !taxId}
                                className="w-full h-20 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[14px] rounded-none shadow-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-4 disabled:opacity-30"
                            >
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                                    <>
                                        <span>CONTINUAR</span>
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                        </form>
                    )}

                    {step === 'ACCOUNT_SELECTION' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
                            {detectedAccounts.map((acc) => (
                                <button
                                    key={acc.id}
                                    onClick={() => handleAccountSelect(acc)}
                                    className="w-full p-6 bg-black/5 dark:bg-black/80 border border-black/10 dark:border-white/5 rounded-none flex items-center gap-5 active:scale-[0.99] transition-all text-left shadow-lg overflow-hidden relative group"
                                >
                                    <div className="absolute inset-0 technical-grid opacity-5 group-hover:opacity-10 transition-opacity"></div>
                                    <div className="w-14 h-14 bg-black/10 dark:bg-white/5 flex items-center justify-center border border-black/5 dark:border-white/5 relative z-10 transition-transform group-hover:scale-105">
                                        <span className="material-symbols-rounded text-[28px] text-black/60 dark:text-white/40">
                                            {acc.type === 'B2B' ? 'corporate_fare' : 'person'}
                                        </span>
                                    </div>
                                    <div className="flex-1 relative z-10">
                                        <p className="font-black text-lg uppercase tracking-tight text-black dark:text-white leading-tight mb-1">{acc.name}</p>
                                        <p className="hud-label text-black/30 dark:text-white/30">{acc.type}_CHALLENGE</p>
                                    </div>
                                    <div className="text-black/10 dark:text-white/10 group-hover:text-black dark:group-hover:text-white transition-all">
                                        <ChevronRight size={24} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {step === 'CHALLENGE' && (
                        <form onSubmit={handleLogin} className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500" autoComplete="off">
                            <div className="space-y-3">
                                <div className="flex justify-between items-end px-1">
                                    <label className="hud-label">Credencial de Seguridad</label>
                                    <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[02]</span>
                                </div>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="premium-input bg-black/5 dark:bg-black/60 h-20"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                        spellCheck="false"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        data-lpignore="true"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-0 top-0 h-full px-6 text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                                    </button>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full h-20 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[14px] rounded-none shadow-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-4 disabled:opacity-30"
                            >
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                                    <>
                                        <span>ACCEDER AL ENTORNO</span>
                                        <ArrowRight size={20} />
                                    </>
                                )}
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
