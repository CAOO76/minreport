import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

export const PasswordReset = () => {
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const oobCode = searchParams.get('oobCode');
    const mode = searchParams.get('mode');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [status, setStatus] = useState<'IDLE' | 'VERIFYING' | 'SUBMITTING' | 'SUCCESS' | 'ERROR'>('VERIFYING');
    const [error, setError] = useState('');
    const [userEmail, setUserEmail] = useState('');

    useEffect(() => {
        if (mode !== 'resetPassword' || !oobCode) {
            setStatus('ERROR');
            setError(t('auth.invalid_link', 'Enlace de activación inválido o expirado.'));
            return;
        }

        const verifyCode = async () => {
            try {
                const email = await verifyPasswordResetCode(auth, oobCode);
                setUserEmail(email);
                setStatus('IDLE');
            } catch (err: any) {
                console.error('Code verification failed:', err);
                setStatus('ERROR');
                setError(t('auth.invalid_link', 'Este enlace ya no es válido.'));
            }
        };

        verifyCode();
    }, [oobCode, mode, t]);

    const handleSetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setError(t('auth.passwords_dont_match', 'Las contraseñas no coinciden.'));
            return;
        }
        if (password.length < 8) {
            setError(t('auth.password_too_short', 'La contraseña debe tener al menos 8 caracteres.'));
            return;
        }

        setStatus('SUBMITTING');
        setError('');

        try {
            await confirmPasswordReset(auth, oobCode!, password);
            setStatus('SUCCESS');
            setTimeout(() => {
                navigate('/login');
            }, 3000);
        } catch (err: any) {
            console.error('Password reset failed:', err);
            setStatus('ERROR');
            setError(t('auth.reset_failed', 'No se pudo establecer la contraseña. Inténtalo de nuevo.'));
        }
    };

    if (status === 'VERIFYING') {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
                <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                <p className="text-slate-500 font-medium animate-pulse">{t('auth.verifying_link', 'Verificando enlace...')}</p>
            </div>
        );
    }

    if (status === 'SUCCESS') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
                <div className="max-w-md w-full bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-xl text-center space-y-6 animate-in zoom-in-95 duration-500">
                    <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                        <ShieldCheck size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.success_title', '¡Cuenta Activada!')}</h2>
                    <p className="text-slate-500 dark:text-slate-400">
                        {t('auth.success_msg', 'Tu contraseña ha sido establecida correctamente. Serás redirigido al acceso en unos segundos.')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
            <div className="max-w-md w-full relative">
                <div className="mb-10 text-center">
                    <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <KeyRound size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {t('auth.set_password_title', 'Configura tu Contraseña')}
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">
                        {userEmail}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-800 p-8 rounded-[32px] shadow-2xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700/50">
                    {status === 'ERROR' ? (
                        <div className="space-y-6 text-center">
                            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 flex items-center gap-3 border border-rose-100 dark:border-rose-900/30">
                                <AlertCircle size={20} />
                                <p className="text-sm font-semibold">{error}</p>
                            </div>
                            <button
                                onClick={() => navigate('/')}
                                className="text-primary font-bold text-sm hover:underline"
                            >
                                {t('auth.back_to_home', 'Volver al inicio')}
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSetPassword} className="space-y-6">
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">
                                    {t('auth.new_password', 'Nueva Contraseña')}
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-slate-900 dark:text-white transition-all font-medium"
                                        placeholder="••••••••"
                                        required
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">
                                    {t('auth.confirm_password', 'Confirmar Contraseña')}
                                </label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-slate-900 dark:text-white transition-all font-medium"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="new-password"
                                />
                            </div>

                            {error && (
                                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2 border border-rose-100 dark:border-rose-900/30 animate-in fade-in slide-in-from-top-2">
                                    <AlertCircle size={16} />
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'SUBMITTING'}
                                className="w-full py-4 bg-primary hover:bg-primary-dark text-white font-bold rounded-2xl transition-all shadow-lg shadow-primary/25 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
                            >
                                {status === 'SUBMITTING' ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    t('auth.activate_btn', 'Activar Mi Cuenta')
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
