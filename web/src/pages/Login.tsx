import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
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
    const [bgImage, setBgImage] = useState('');

    // Fetch UI Backgrounds
    useEffect(() => {
        const fetchUI = async () => {
            try {
                const response = await fetch(`${import.meta.env.VITE_API_URL}/api/settings/ui-assets`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.login_bg) setBgImage(data.login_bg);
                }
            } catch (err) {
                console.warn('UI Assets not available yet.');
            }
        };
        fetchUI();
    }, []);

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
        setPassword('');
        // No necesitamos setError aquí porque authError es manejado por el hook
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || !selectedAccountId) return;

        const selectedAccount = detectedAccounts.find(acc => acc.accountId === selectedAccountId);
        if (!selectedAccount) return;

        try {
            // taxId es el RUT/RUN ingresado por el usuario — identificador permanente de la identidad
            await loginToAccount(selectedAccount, password, taxId);
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
        <div className="min-h-screen flex items-center justify-center p-4 transition-colors relative overflow-hidden industrial-mineral-gradient">
            {/* Background Layer with mineral texture */}
            {bgImage && (
                <div className="absolute inset-0 z-0">
                    <img src={bgImage} alt="industrial atmosphere" className="w-full h-full object-cover brightness-[0.3] dark:brightness-[0.2]" />
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"></div>
                </div>
            )}

            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-[400px] relative z-10 transition-all duration-700 text-black dark:text-white">

                {/* Logo Flotante perfectamente alineado con los campos (p-12) */}
                <div className="mb-6 px-10 flex justify-center">
                    <BrandLogo variant="isotype" className="w-1/4 h-auto relative z-10" />
                </div>

                <div className="flex items-center justify-center gap-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-1000 delay-200">
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                    <p className="hud-label" style={{ color: 'rgb(198, 131, 70)' }}>MINREPORT®</p>
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                </div>

                {/* Paso 1: Identificación */}
                {step === 'IDENTIFICATION' && (
                    <div className="elite-tech-surface py-8 px-10 animate-in fade-in zoom-in-95 duration-700 shadow-3xl">
                        <div className="absolute inset-0 technical-grid opacity-20 pointer-events-none"></div>

                        <form onSubmit={handleIdentificationSubmit} className="space-y-8 relative z-10" autoComplete="off">
                            <div className="space-y-3">
                                <div className="flex justify-between items-end px-1">
                                    <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">id_card</span>
                                    <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[01]</span>
                                </div>
                                <input
                                    type="text"
                                    value={taxId}
                                    onChange={(e) => setTaxId(formatRut(e.target.value))}
                                    className="premium-input text-center text-2xl tracking-[0.2em]"
                                    placeholder="12.345.678-9"
                                    required
                                    autoFocus
                                    autoComplete="off"
                                    spellCheck="false"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    data-lpignore="true"
                                />
                            </div>

                            {authError && step === 'IDENTIFICATION' && (
                                <div className="p-4 rounded-2xl bg-rose-500/10 text-rose-400 text-[11px] font-bold text-center border border-rose-500/20 animate-in fade-in slide-in-from-top-2">
                                    {authError}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={authLoading}
                                className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[12px] transition-all shadow-3xl active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-4"
                            >
                                {authLoading ? (
                                    <Loader2 className="w-7 h-7 animate-spin text-white dark:text-black" />
                                ) : (
                                    <>
                                        <ArrowRight size={27} />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/5 text-center relative z-10 flex justify-center">
                            <Link to="/register" className="text-black/30 dark:text-white/20 hover:text-black dark:hover:text-white transition-all transform hover:scale-110">
                                <span className="material-symbols-rounded text-[24px]">person_add</span>
                            </Link>
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
                    <div className="elite-tech-surface p-12 animate-in fade-in slide-in-from-right-12 duration-1000 w-full shadow-3xl">
                        <div className="absolute inset-0 technical-grid opacity-20 pointer-events-none"></div>

                        <div className="text-center mb-12 relative z-10">
                            <div className="w-24 h-24 bg-white/5 text-white border border-white/10 flex items-center justify-center mx-auto mb-8 shadow-2xl relative overflow-hidden">
                                <div className="absolute inset-0 technical-grid opacity-10"></div>
                                <span className="material-symbols-rounded text-[48px] relative z-10">
                                    {renderIcon(selectedAccount.type)}
                                </span>
                            </div>
                            <p className="hud-label text-black/40 dark:text-white/40 mb-3">
                                [VULCAN_CHALLENGE_ACTIVE]
                            </p>
                            <h2 className="text-3xl font-black text-black dark:text-white uppercase tracking-tight leading-none mb-1">
                                {selectedAccount.accountName}
                            </h2>
                            <p className="text-[9px] font-mono text-black/20 dark:text-white/20 uppercase tracking-[0.3em]">SECURE_ISOLATION_ZONE</p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-10 relative z-10" autoComplete="off">
                            <div className="space-y-3">
                                <div className="flex justify-between items-end px-1">
                                    <label className="hud-label text-black/60 dark:text-white/60">Contraseña Táctica</label>
                                    <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[02]</span>
                                </div>
                                <div className="relative group">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="pwd_challenge_field"
                                        id="pwd_access_token"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="premium-input pr-14 text-center tracking-[0.4em] bg-black/80"
                                        placeholder="••••••••"
                                        required
                                        autoFocus
                                        autoComplete="new-password"
                                        spellCheck="false"
                                        data-lpignore="true"
                                        onCopy={(e) => e.preventDefault()}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            {authError && (
                                <div className="p-4 rounded-2xl bg-rose-500/10 text-rose-400 text-[11px] font-bold text-center border border-rose-500/20 animate-in fade-in">
                                    {authError}
                                </div>
                            )}

                            <div className="space-y-6">
                                <button
                                    type="submit"
                                    disabled={authLoading}
                                    className="w-full py-6 bg-white hover:bg-slate-200 text-black font-black uppercase tracking-[0.3em] text-[12px] transition-all shadow-3xl active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-4"
                                >
                                    {authLoading ? (
                                        <Loader2 className="w-5 h-5 animate-spin text-black" />
                                    ) : (
                                        <>
                                            <span>ACCEDER_ENTORNO</span>
                                            <Lock size={16} />
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
                                    className="w-full py-4 text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 font-mono font-bold uppercase tracking-[0.2em] text-[9px] transition-all flex items-center justify-center gap-4 border border-transparent hover:border-black/10 dark:hover:border-white/10"
                                >
                                    <ArrowLeft size={14} />
                                    <span>[CANCEL_REQUEST]</span>
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                <footer className="mt-8 text-center space-y-4 opacity-40 hover:opacity-100 transition-opacity duration-500">
                    <div className="flex justify-center">
                        <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-[10px] text-black/60 dark:text-white uppercase tracking-[0.3em] font-black">
                        © {new Date().getFullYear()} MINREPORT. TODOS LOS DERECHOS RESERVADOS.
                    </p>
                </footer>

            </div>
        </div>
    );
};
