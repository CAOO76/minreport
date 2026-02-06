import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Lock, Eye, EyeOff } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { Link } from 'react-router-dom';
import { formatRut } from '../utils/rut';
import { useAuthActions } from '../hooks/useAuthActions';
import AccountSelector from '../components/auth/AccountSelector';

// Definición de Tipos para la UI
type LoginStep = 'IDENTIFICATION' | 'ACCOUNT_SELECTION' | 'CHALLENGE';

export const Login = () => {
    const navigate = useNavigate();

    // Hook de Autenticación (Nueva Arquitectura)
    const {
        checkIdentity,
        loginToAccount,
        detectedAccounts,
        showAccountSelector,
        loading: authLoading,
        error: authError,
        resetFlow
    } = useAuthActions();

    // Estados del Flujo
    const [step, setStep] = useState<LoginStep>('IDENTIFICATION');
    const [taxId, setTaxId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    // Limpieza de Memoria (Zero Memory Policy)
    useEffect(() => {
        return () => {
            setTaxId('');
            setPassword('');
        };
    }, []);

    // Sincronizar showAccountSelector con step
    useEffect(() => {
        if (showAccountSelector && detectedAccounts.length > 0) {
            setStep('ACCOUNT_SELECTION');
        }
    }, [showAccountSelector, detectedAccounts]);

    const handleIdentificationSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!taxId.trim()) return;
        await checkIdentity(taxId);
    };

    const handleAccountSelect = (account: any) => {
        setSelectedAccountId(account.accountId);
        setStep('CHALLENGE');
        setPassword(''); // Asegurar limpieza al entrar al challenge
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || !selectedAccountId) return;

        const selectedAccount = detectedAccounts.find(acc => acc.accountId === selectedAccountId);
        if (!selectedAccount) return;

        try {
            await loginToAccount(selectedAccount, password);
            // Limpieza y Redirección
            setPassword('');
            navigate('/');
        } catch (err: any) {
            console.error('Login error:', err);
        }
    };

    // --- RENDERIZADORES DE ICONOS MATERIAL ---
    const renderIcon = (type: string) => {
        switch (type) {
            case 'BUSINESS':
            case 'ENTERPRISE':
                return 'business';
            case 'EDUCATIONAL':
                return 'school';
            case 'PERSONAL':
                return 'person';
            default:
                return 'help';
        }
    };

    // Obtener cuenta seleccionada
    const selectedAccount = detectedAccounts.find(acc => acc.accountId === selectedAccountId);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] transition-colors p-4 relative overflow-hidden">
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>
            <div className="w-full max-w-md relative">

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
                                Ingresa tu identificación para comenzar
                            </p>
                        </div>

                        <form onSubmit={handleIdentificationSubmit} className="space-y-6" autoComplete="off">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Documento de Identificación (RUT / RUN)
                                </label>
                                <input
                                    type="text"
                                    value={taxId}
                                    onChange={(e) => setTaxId(formatRut(e.target.value))}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg text-center"
                                    placeholder="12.345.678-9"
                                    required
                                    autoFocus
                                    autoComplete="off"
                                    data-lpignore="true"
                                />
                            </div>

                            {authError && step === 'IDENTIFICATION' && (
                                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                    {authError}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={authLoading}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {authLoading ? (
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                ) : (
                                    <>
                                        <span>Continuar</span>
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                ¿No tienes una cuenta?{' '}
                                <Link to="/register" className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                                    Crear cuenta
                                </Link>
                            </p>
                        </div>
                    </div>
                )}

                {/* Paso 2: Selección de Cuenta */}
                {step === 'ACCOUNT_SELECTION' && (
                    <AccountSelector
                        accounts={detectedAccounts}
                        onSelectAccount={handleAccountSelect}
                        onCancel={() => {
                            resetFlow();
                            setStep('IDENTIFICATION');
                            setTaxId('');
                        }}
                        loading={authLoading}
                    />
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
                                {selectedAccount.accountName}
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

                            {authError && (
                                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                    {authError}
                                </div>
                            )}

                            <div className="space-y-3">
                                <button
                                    type="submit"
                                    disabled={authLoading}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {authLoading ? (
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
                                        setSelectedAccountId(null);
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
