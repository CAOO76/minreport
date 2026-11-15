import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useTranslation } from 'react-i18next';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';

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
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [userEmail, setUserEmail] = useState('');

    useEffect(() => {
        if (mode !== 'resetPassword' || !oobCode) {
            setStatus('ERROR');
            setErrorKey('auth.invalid_link');
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
                setErrorKey('auth.invalid_link');
            }
        };

        verifyCode();
    }, [oobCode, mode]);

    const handleSetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setErrorKey('auth.passwords_dont_match');
            return;
        }
        if (password.length < 8) {
            setErrorKey('auth.password_too_short');
            return;
        }

        setStatus('SUBMITTING');
        setErrorKey(null);

        try {
            await confirmPasswordReset(auth, oobCode!, password);
            setStatus('SUCCESS');
            setTimeout(() => {
                navigate('/access');
            }, 2500);
        } catch (err: any) {
            console.error('Password reset failed:', err);
            setStatus('ERROR');
            setErrorKey('auth.reset_failed');
        }
    };

    const errorMessage = errorKey ? t(errorKey) : '';

    return (
        <div className="min-h-screen flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none">
            <header className="w-full px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between rounded-none">
                <div className="flex items-center gap-fib-13">
                    <BrandLogo variant="logotype" className="h-5 w-auto object-contain" />
                    <span className="hidden sm:inline text-microcopy uppercase font-mono text-[#475569] dark:text-[#8A93A6] tracking-wider">
                        {t('core_setup.portal_badge')}
                    </span>
                </div>
                <div className="flex items-center gap-fib-8">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {status === 'VERIFYING' && (
                <div className="flex-1 flex flex-col items-center justify-center p-fib-21">
                    <div
                        className="w-48 h-[4px] flex items-center gap-[4px] mb-fib-13"
                        role="progressbar"
                        aria-label={t('core_setup.verifying_link_aria')}
                    >
                        <div className="w-1/2 h-full bg-[#C68346]" />
                        <div className="flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] flex justify-end">
                            <span className="w-[4px] h-[4px] bg-[#C68346] block shrink-0" />
                        </div>
                    </div>
                    <p className="text-[#475569] dark:text-[#8A93A6] text-xs font-mono tracking-wider">
                        {t('auth.verifying_link')}
                    </p>
                </div>
            )}

            {status === 'SUCCESS' && (
                <div className="flex-1 flex items-center justify-center p-fib-21">
                    <div className="max-w-md w-full bg-[#F8FAFC] dark:bg-[#07090D] p-fib-34 rounded-none border border-[#E2E8F0] dark:border-[#12151C] shadow-none text-center space-y-fib-21">
                        <span className="material-symbols-outlined text-[32px] text-[#00AEEF]">verified</span>
                        <h2 className="text-xl font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('auth.success_title')}
                        </h2>
                        <p className="text-[#475569] dark:text-[#8A93A6] text-xs font-mono">
                            {t('auth.success_msg')}
                        </p>
                    </div>
                </div>
            )}

            {status !== 'VERIFYING' && status !== 'SUCCESS' && (
                <div className="flex-1 flex items-center justify-center p-fib-21">
                    <div className="max-w-md w-full relative">
                        <div className="mb-fib-21 text-center">
                            <span className="material-symbols-outlined text-[28px] text-[#C68346] mb-2">key</span>
                            <h1 className="text-xl font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('auth.set_password_title')}
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
                                        <p className="text-xs font-mono">{errorMessage}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => navigate('/')}
                                        className="text-[#C68346] font-bold text-xs uppercase tracking-wider hover:underline bg-transparent border-0 cursor-pointer"
                                    >
                                        {t('auth.back_to_home')}
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleSetPassword} className="space-y-5" autoComplete="off" spellCheck={false}>
                                    <div className="space-y-1.5">
                                        <label
                                            htmlFor="set_password_new"
                                            className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest block font-mono"
                                        >
                                            {t('auth.new_password')}
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="set_password_new"
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
                                                title={showPassword ? t('core_setup.hide_password') : t('core_setup.show_password')}
                                                aria-label={showPassword ? t('core_setup.hide_password') : t('core_setup.show_password')}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    {showPassword ? 'visibility_off' : 'visibility'}
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label
                                            htmlFor="set_password_confirm"
                                            className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest block font-mono"
                                        >
                                            {t('auth.confirm_password')}
                                        </label>
                                        <input
                                            id="set_password_confirm"
                                            type={showPassword ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="w-full px-4 py-3 rounded-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[#0F172A] dark:text-[#F3F4F6] transition-colors text-xs font-mono"
                                            placeholder="••••••••"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>

                                    {errorMessage && (
                                        <div className="p-fib-13 rounded-none bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-mono flex items-center gap-2 border border-red-500/30">
                                            <span className="material-symbols-outlined text-[16px]">error</span>
                                            <span>{errorMessage}</span>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={status === 'SUBMITTING'}
                                        className="w-full py-3 bg-[#C68346] hover:bg-[#B0743E] text-white font-bold text-xs uppercase tracking-wider rounded-none transition-colors shadow-none disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer border-0 outline-none"
                                    >
                                        {status === 'SUBMITTING' ? (
                                            <span className="font-mono">{t('core_setup.processing_credential')}</span>
                                        ) : (
                                            t('auth.activate_btn')
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SetPassword;
