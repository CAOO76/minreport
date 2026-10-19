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
            <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-[#000000] p-6">
                <span className="material-symbols-outlined text-[36px] text-[#C68346] animate-spin mb-4">progress_activity</span>
                <p className="text-slate-500 dark:text-[#8A93A6] text-xs font-mono tracking-wider">{t('auth.verifying_link', 'Verificando enlace de activación...')}</p>
            </div>
        );
    }

    if (status === 'SUCCESS') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#000000] p-6">
                <div className="max-w-md w-full bg-[#F8FAFC] dark:bg-[#07090D] p-8 rounded-none border border-slate-200 dark:border-[#12151C] shadow-none text-center space-y-6">
                    <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-none flex items-center justify-center mx-auto border border-emerald-500/20">
                        <span className="material-symbols-outlined text-[28px]">verified</span>
                    </div>
                    <h2 className="text-xl font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">{t('auth.success_title', 'Cuenta Activada')}</h2>
                    <p className="text-slate-500 dark:text-[#8A93A6] text-xs font-mono">
                        {t('auth.success_msg', 'Tu contraseña ha sido establecida correctamente. Serás redirigido al acceso en unos segundos.')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#000000] p-6">
            <div className="max-w-md w-full relative">
                <div className="mb-8 text-center">
                    <div className="w-12 h-12 bg-[#C68346]/10 text-[#C68346] rounded-none flex items-center justify-center mx-auto mb-4 border border-[#C68346]/20">
                        <span className="material-symbols-outlined text-[24px]">key</span>
                    </div>
                    <h1 className="text-xl font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                        {t('auth.set_password_title', 'Configurar Contraseña')}
                    </h1>
                    <p className="text-slate-500 dark:text-[#8A93A6] mt-2 text-xs font-mono">
                        {userEmail}
                    </p>
                </div>

                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-6 sm:p-8 rounded-none border border-slate-200 dark:border-[#12151C] shadow-none">
                    {status === 'ERROR' ? (
                        <div className="space-y-6 text-center">
                            <div className="p-4 rounded-none bg-rose-500/10 text-rose-500 flex items-center gap-3 border border-rose-500/20">
                                <span className="material-symbols-outlined text-[20px]">error</span>
                                <p className="text-xs font-mono">{error}</p>
                            </div>
                            <button
                                onClick={() => navigate('/')}
                                className="text-[#C68346] font-bold text-xs uppercase tracking-wider hover:underline bg-transparent border-0 cursor-pointer"
                            >
                                {t('auth.back_to_home', 'Volver al inicio')}
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSetPassword} className="space-y-5" autoComplete="off" spellCheck={false}>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-slate-500 dark:text-[#8A93A6] uppercase tracking-widest block font-mono">
                                    {t('auth.new_password', 'Nueva Contraseña')}
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-4 py-3 rounded-none bg-white dark:bg-[#030406] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] outline-none text-slate-900 dark:text-white transition-colors text-xs font-mono"
                                        placeholder="••••••••"
                                        required
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer flex items-center"
                                        title={showPassword ? 'Ocultar' : 'Mostrar'}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            {showPassword ? 'visibility_off' : 'visibility'}
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-slate-500 dark:text-[#8A93A6] uppercase tracking-widest block font-mono">
                                    {t('auth.confirm_password', 'Confirmar Contraseña')}
                                </label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-4 py-3 rounded-none bg-white dark:bg-[#030406] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] outline-none text-slate-900 dark:text-white transition-colors text-xs font-mono"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>

                            {error && (
                                <div className="p-3 rounded-none bg-rose-500/10 text-rose-500 text-xs font-mono flex items-center gap-2 border border-rose-500/20">
                                    <span className="material-symbols-outlined text-[16px]">error</span>
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'SUBMITTING'}
                                className="w-full py-3 bg-[#C68346] hover:bg-[#b07238] text-white font-bold text-xs uppercase tracking-wider rounded-none transition-colors shadow-none disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer border-0 outline-none"
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
