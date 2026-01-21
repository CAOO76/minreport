import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, LogIn, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

export const Login = () => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
            <div className="max-w-md w-full">
                <div className="mb-10 text-center">
                    <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <LogIn size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {t('auth.login_title', 'Iniciar Sesión')}
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">
                        {t('auth.login_subtitle', 'Accede a tu cuenta de MINREPORT')}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-800 p-8 rounded-[32px] shadow-2xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700/50">
                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">
                                {t('form.email', 'Email')}
                            </label>
                            <div className="relative group">
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-12 pr-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-slate-900 dark:text-white transition-all font-medium"
                                    placeholder="nombre@ejemplo.com"
                                    required
                                    autoComplete="off"
                                />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                                    <Mail size={18} />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    {t('form.password', 'Contraseña')}
                                </label>
                            </div>
                            <div className="relative group">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-slate-900 dark:text-white transition-all font-medium"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="current-password"
                                />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
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
                            className="w-full py-4 bg-primary hover:bg-primary-dark text-white font-bold rounded-2xl transition-all shadow-lg shadow-primary/25 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
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

                    <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50 text-center">
                        <p className="text-sm text-slate-500">
                            {t('auth.no_account', '¿No tienes cuenta?')}
                            <Link to="/" className="ml-2 text-primary font-bold hover:underline">
                                {t('auth.register_link', 'Regístrate aquí')}
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
