import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useTranslation } from 'react-i18next';

export const SetPassword = () => {
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
            setError(t('auth.invalid_link', 'Enlace de activacion invalido o expirado.'));
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
                setError(t('auth.invalid_link', 'Este enlace ya no es valido.'));
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
            }, 2500);
        } catch (err: any) {
            console.error('Password reset failed:', err);
            setStatus('ERROR');
            setError(t('auth.reset_failed', 'No se pudo establecer la contraseña. Intentalo de nuevo.'));
        }
    };

    if (status === 'VERIFYING') {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-[#FFFFFF] dark:bg-[#000000] p-fib-21">
                <span className="material-symbols-outlined text-[32px] text-[#C68346] animate-spin mb-4">progress_activity</span>
                <p className="text-[#475569] dark:text-[#8A93A6] text-xs font-mono tracking-wider">{t('auth.verifying_link', 'Verificando enlace de activacion...')}</p>
            </div>
        );
    }

    if (status === 'SUCCESS') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#FFFFFF] dark:bg-[#000000] p-fib-21">
                <div className="max-w-md w-full bg-[#F8FAFC] dark:bg-[#07090D] p-fib-34 rounded-none border border-[#E2E8F0] dark:border-[#12151C] shadow-none text-center space-y-fib-21">
                    <span className="material-symbols-outlined text-[32px] text-[#00AEEF]">verified</span>
                    <h2 className="text-xl font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">{t('auth.success_title', 'Cuenta Activada')}</h2>
                    <p className="text-[#475569] dark:text-[#8A93A6] text-xs font-mono">
                        {t('auth.success_msg', 'Tu contraseña ha sido establecida correctamente. Redirigiendo al acceso...')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#FFFFFF] dark:bg-[#000000] p-fib-21 select-none">
            <div className="max-w-md w-full relative">
                <div className="mb-fib-21 text-center">
                    <span className="material-symbols-outlined text-[28px] text-[#C68346] mb-2">key</span>
                    <h1 className="text-xl font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('auth.set_password_title', 'Configurar Contraseña')}
                    </h1>
                    <p className="text-[#475569] dark:text-[#8A93A6] mt-2 text-xs font-mono select-text">
                        {userEmail}
                    </p>
                </div>

                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 sm:p-fib-34 rounded-none border border-[#E2E8F0] dark:border-[#12151C] shadow-none">
                    {status === 'ERROR' ? (
                        <div className="space-y-fib-21 text-center">
                            <div className="p-fib-13 rounded-none bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-fib-8 border border-red-500/30">
                                <span className="material-symbols-outlined text-[20px]">error</span>
                                <p className="text-xs font-mono">{error}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/')}
                                className="text-[#C68346] font-bold text-xs uppercase tracking-wider hover:underline bg-transparent border-0 cursor-pointer"
                            >
                                {t('auth.back_to_home', 'Volver al inicio')}
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSetPassword} className="space-y-5" autoComplete="off" spellCheck={false}>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest block font-mono">
                                    {t('auth.new_password', 'Nueva Contraseña')}
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-4 py-3 rounded-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[#0F172A] dark:text-[#F3F4F6] transition-colors text-xs font-mono"
                                        placeholder="••••••••"
                                        required
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center"
                                        title={showPassword ? 'Ocultar' : 'Mostrar'}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            {showPassword ? 'visibility_off' : 'visibility'}
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest block font-mono">
                                    {t('auth.confirm_password', 'Confirmar Contraseña')}
                                </label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-4 py-3 rounded-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[#0F172A] dark:text-[#F3F4F6] transition-colors text-xs font-mono"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>

                            {error && (
                                <div className="p-fib-13 rounded-none bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-mono flex items-center gap-2 border border-red-500/30">
                                    <span className="material-symbols-outlined text-[16px]">error</span>
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'SUBMITTING'}
                                className="w-full py-3 bg-[#C68346] hover:bg-[#B0743E] text-white font-bold text-xs uppercase tracking-wider rounded-none transition-colors shadow-none disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer border-0 outline-none"
                            >
                                {status === 'SUBMITTING' ? (
                                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
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

export default SetPassword;
