import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { ErgonomicScaleSwitch } from '../../components/common/ErgonomicScaleSwitch';
import BrandLogo from '../../components/BrandLogo';
import { isPasskeySupported, authenticateWithPasskey } from '../../services/passkeyService';
import M3CircularProgress from '../../components/common/M3CircularProgress';

export const MobileLogin: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [passkeyLoading, setPasskeyLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const passkeyAvailable = isPasskeySupported();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        const cleanInput = identifier.trim().toLowerCase();

        if (cleanInput === 'dev@minreport.com') {
            setLoading(false);
            setError(t('core_mobile.login_dev_blocked'));
            return;
        }

        if (!cleanInput.includes('@')) {
            setError(t('core_mobile.login_invalid_credentials'));
            setLoading(false);
            return;
        }

        try {
            await signInWithEmailAndPassword(auth, cleanInput, password);
            navigate('/mobile/dashboard');
        } catch (err: any) {
            console.error('[MOBILE-LOGIN] Error:', err);
            if (
                err.code === 'auth/invalid-credential' ||
                err.code === 'auth/user-not-found' ||
                err.code === 'auth/wrong-password' ||
                err.code === 'auth/invalid-email'
            ) {
                setError(t('core_mobile.login_invalid_credentials'));
            } else {
                setError(t('core_mobile.login_network_error'));
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePasskeyLogin = async () => {
        setError(null);
        setPasskeyLoading(true);
        const cleanInput = identifier.trim().toLowerCase();
        if (cleanInput === 'dev@minreport.com') {
            setPasskeyLoading(false);
            setError(t('core_mobile.login_dev_blocked'));
            return;
        }
        try {
            await authenticateWithPasskey(cleanInput || undefined);
            navigate('/mobile/dashboard');
        } catch (err: any) {
            if (err?.name !== 'NotAllowedError') {
                setError(err?.message || t('core_mobile.login_passkey_error'));
            }
        } finally {
            setPasskeyLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col justify-between p-fib-21 select-none font-sans antialiased">
            <header className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-4">
                <div className="flex items-center gap-2">
                    <BrandLogo variant="isotype" className="h-6 w-auto object-contain" />
                    <span className="font-mono text-xs uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                        MINREPORT MOBILE
                    </span>
                </div>

                <div className="flex items-center gap-fib-8">
                    <ErgonomicScaleSwitch compact />
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            <main className="w-full max-w-sm mx-auto my-auto space-y-fib-21">
                <div className="space-y-1">
                    <h1 className="font-mono text-sm uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                        {t('core_mobile.login_heading')}
                    </h1>
                    <p className="font-sans text-xs text-[#475569] dark:text-[#8A93A6]">
                        {t('core_mobile.login_subtitle')}
                    </p>
                </div>

                <form onSubmit={handleLogin} autoComplete="off" spellCheck={false} className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 space-y-4 rounded-none shadow-none">
                    {error && (
                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono flex items-center gap-2 rounded-none">
                            <span className="material-symbols-outlined text-[16px] text-red-600 dark:text-red-400 shrink-0">
                                error
                            </span>
                            <span>{error}</span>
                        </div>
                    )}

                    <div>
                        <label htmlFor="mobile-login-identifier" className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider mb-1.5">
                            {t('core_mobile.login_identifier_label')}
                        </label>
                        <input
                            id="mobile-login-identifier"
                            type="text"
                            aria-label={t('core_mobile.login_identifier_label')}
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder={t('core_mobile.login_identifier_placeholder')}
                            required
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full min-h-[52px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-3 py-2 font-mono text-body-main text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none transition-colors select-text"
                        />
                    </div>

                    <div>
                        <label htmlFor="mobile-login-password" className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider mb-1.5">
                            {t('form.password')}
                        </label>
                        <div className="relative">
                            <input
                                id="mobile-login-password"
                                type={showPassword ? 'text' : 'password'}
                                aria-label={t('form.password')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••••••"
                                required
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[52px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-3 py-2 pr-12 font-mono text-body-main text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? t('core_mobile.hide_password') : t('core_mobile.show_password')}
                                title={showPassword ? t('core_mobile.hide_password') : t('core_mobile.show_password')}
                                className="min-w-[48px] min-h-[48px] flex items-center justify-center absolute right-0 top-1/2 -translate-y-1/2 bg-transparent border-0 outline-none p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    {showPassword ? 'visibility_off' : 'visibility'}
                                </span>
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || passkeyLoading}
                        className="w-full min-h-[56px] py-3 bg-[#C68346] hover:bg-[#B0743E] text-white font-mono font-bold text-data-dense uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none border-0 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <span>{t('core_mobile.login_validating')}</span>
                        ) : (
                            <>
                                <span>{t('core_mobile.login_submit')}</span>
                                <span className="material-symbols-outlined text-[18px]">
                                    arrow_forward
                                </span>
                            </>
                        )}
                    </button>

                    {passkeyAvailable && (
                        <button
                            type="button"
                            onClick={handlePasskeyLogin}
                            disabled={loading || passkeyLoading}
                            className="w-full min-h-[56px] py-3 bg-[#FFFFFF] dark:bg-[#000000] border border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] font-mono font-bold text-data-dense uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center gap-2"
                        >
                            {passkeyLoading ? (
                                <M3CircularProgress size={16} ariaLabel={t('core_mobile.login_passkey_verifying_aria')} />
                            ) : (
                                <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">fingerprint</span>
                            )}
                            <span>{passkeyLoading ? t('core_mobile.login_passkey_verifying') : t('core_mobile.login_passkey_btn')}</span>
                        </button>
                    )}
                </form>
            </main>

            <footer className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-4 text-center">
                <p className="font-mono text-microcopy text-[#94A3B8] dark:text-[#5A6072] uppercase tracking-widest">
                    MINREPORT · SOUTHAMERICA-WEST1
                </p>
            </footer>
        </div>
    );
};

export default MobileLogin;
