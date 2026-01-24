import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, LogIn, AlertCircle, Loader2, ArrowRight, ShieldAlert } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

export const Login = () => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await signInWithEmailAndPassword(auth, email, password);
            navigate('/'); // Redirigir al inicio o dashboard del cliente
        } catch (err: any) {
            console.error('Login error:', err);
            let message = t('auth.login_error', 'Email o contraseña incorrectos.');
            if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
                message = t('auth.invalid_credentials', 'Credenciales inválidas.');
            } else if (err.code === 'auth/network-request-failed') {
                message = t('auth.network_error', 'Error de conexión con el servidor.');
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-antigravity-light-bg dark:bg-antigravity-dark-bg p-6 transition-colors">
            <div className="max-w-md w-full">
                <div className="mb-10 text-center">
                    <div className="w-16 h-16 bg-antigravity-accent/10 text-antigravity-accent rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <LogIn size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight">
                        {t('auth.login_title', 'Iniciar Sesión')}
                    </h1>
                    <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted mt-2 font-medium">
                        {t('auth.login_subtitle', 'Accede a tu cuenta de MINREPORT')}
                    </p>
                </div>

                <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface p-8 rounded-[32px] shadow-sm border border-antigravity-light-border dark:border-antigravity-dark-border">
                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-widest px-1">
                                {t('form.email', 'Email')}
                            </label>
                            <div className="relative group">
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-12 pr-5 py-4 rounded-2xl bg-antigravity-light-bg dark:bg-antigravity-dark-bg border border-antigravity-light-border dark:border-antigravity-dark-border focus:ring-2 focus:ring-antigravity-accent/20 focus:border-antigravity-accent outline-none text-antigravity-light-text dark:text-antigravity-dark-text transition-all font-medium"
                                    placeholder="nombre@ejemplo.com"
                                    required
                                    autoComplete="off"
                                />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-antigravity-light-muted group-focus-within:text-antigravity-accent transition-colors">
                                    <Mail size={18} />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[11px] font-bold text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-widest">
                                    {t('form.password', 'Contraseña')}
                                </label>
                            </div>
                            <div className="relative group">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-5 py-4 rounded-2xl bg-antigravity-light-bg dark:bg-antigravity-dark-bg border border-antigravity-light-border dark:border-antigravity-dark-border focus:ring-2 focus:ring-antigravity-accent/20 focus:border-antigravity-accent outline-none text-antigravity-light-text dark:text-antigravity-dark-text transition-all font-medium"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="current-password"
                                />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-antigravity-light-muted group-focus-within:text-antigravity-accent transition-colors">
                                    <Lock size={18} />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2 border border-rose-100 dark:border-rose-900/30 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-antigravity-accent hover:bg-antigravity-accent/90 text-white font-bold rounded-2xl transition-all shadow-md active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    {t('auth.login_btn', 'Ingresar')}
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-8 pt-6 border-t border-antigravity-light-border dark:border-antigravity-dark-border text-center">
                        {isMobile ? (
                            <div className="flex flex-col items-center gap-2 px-4">
                                <ShieldAlert size={20} className="text-antigravity-accent opacity-80" />
                                <p className="text-xs font-medium text-antigravity-light-muted dark:text-antigravity-dark-muted leading-relaxed">
                                    El acceso móvil está restringido a cuentas activas.<br />
                                    Para nuevos registros, contacte con su administrador.
                                </p>
                            </div>
                        ) : (
                            <p className="text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                {t('auth.no_account', '¿No tienes cuenta?')}
                                <Link to="/register" className="ml-2 text-antigravity-accent font-bold hover:underline">
                                    {t('auth.register_link', 'Regístrate aquí')}
                                </Link>
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
