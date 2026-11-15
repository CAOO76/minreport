import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../config/firebase';
import { formatRut } from '../utils/rut';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from '../utils/network';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { isPasskeySupported, registerPasskey } from '../services/passkeyService';

const CHILEAN_RUT_FORMAT_REGEX = /^(\d{1,2}(\.\d{3}){2}-?|\d{7,8}-?)[0-9kK]$/i;

export const SetupAccess: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const [searchParams] = useSearchParams();

    const accountId = searchParams.get('accountId');
    const token = searchParams.get('token');
    const urlTaxId = searchParams.get('taxId');
    const accountType = (searchParams.get('type') || '').toUpperCase();
    const trimmedUrlTaxId = (urlTaxId || '').trim();
    const effectiveUrlTaxId =
        trimmedUrlTaxId && accountType !== 'TEST_PILOT' && !/^uid_/i.test(trimmedUrlTaxId)
            ? trimmedUrlTaxId
            : '';
    const name = searchParams.get('name') || '';
    const accountName = searchParams.get('accountName') || '';

    const [taxId, setTaxId] = useState(
        effectiveUrlTaxId
            ? (CHILEAN_RUT_FORMAT_REGEX.test(effectiveUrlTaxId)
                ? formatRut(effectiveUrlTaxId)
                : effectiveUrlTaxId.toUpperCase())
            : ''
    );
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [passkeyEnrolling, setPasskeyEnrolling] = useState(false);
    const [passkeyDone, setPasskeyDone] = useState(false);
    const [setupResponseToken, setSetupResponseToken] = useState<string | null>(null);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [errorRaw, setErrorRaw] = useState('');
    const [success, setSuccess] = useState(false);

    const passkeyAvailable = isPasskeySupported();
    const displayError = errorKey
        ? t(errorKey)
        : errorRaw || (!accountId || !token ? t('core_setup.err_invalid_link') : '');

    const setLocalizedError = (key: string) => {
        setErrorKey(key);
        setErrorRaw('');
    };

    const clearError = () => {
        setErrorKey(null);
        setErrorRaw('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const normalizedTaxId = taxId.trim();
        if (effectiveUrlTaxId && normalizedTaxId.length < 3) {
            setLocalizedError('core_setup.err_confirm_tax_id');
            return;
        }
        if (normalizedTaxId.length > 0 && normalizedTaxId.length < 3) {
            setLocalizedError('core_setup.err_tax_id_min');
            return;
        }

        if (password !== confirmPassword) {
            setLocalizedError('core_setup.err_passwords_mismatch');
            return;
        }

        if (password.length < 8) {
            setLocalizedError('core_setup.err_password_min');
            return;
        }

        setLoading(true);
        clearError();

        try {
            const cleanedTaxId = CHILEAN_RUT_FORMAT_REGEX.test(normalizedTaxId)
                ? normalizedTaxId.replace(/[^0-9Kk]/g, '').toUpperCase()
                : normalizedTaxId.toUpperCase();

            const response = await fetch(getApiUrl('/api/auth/tunnel/setup-password'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(cleanedTaxId ? { taxId: cleanedTaxId } : {}),
                    accountId,
                    token,
                    password
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || t('core_setup.err_setup_failed'));
            }

            if (data.customToken) {
                setSetupResponseToken(data.customToken);
            }
            setSuccess(true);

            if (!passkeyAvailable) {
                window.setTimeout(async () => {
                    await signOut();
                    navigate('/access', { replace: true });
                }, 2000);
            }
        } catch (err: any) {
            console.error('[SETUP] Fallo en configuracion:', err);
            setErrorKey(null);
            setErrorRaw(err?.message || t('core_setup.err_network'));
        } finally {
            setLoading(false);
        }
    };

    const handleOptionalPasskeyEnroll = async () => {
        clearError();
        setPasskeyEnrolling(true);
        try {
            let activeUser = auth.currentUser;
            if (!activeUser && setupResponseToken) {
                const cred = await signInWithCustomToken(auth, setupResponseToken);
                activeUser = cred.user;
            }

            if (!activeUser) {
                throw new Error(t('core_setup.err_relogin_passkey'));
            }

            const idToken = await activeUser.getIdToken();
            await registerPasskey(idToken, t('core_setup.passkey_device_label'));
            setPasskeyDone(true);
            window.setTimeout(() => {
                navigate(accountType === 'TEST_PILOT' ? '/pilot' : '/dashboard', { replace: true });
            }, 1200);
        } catch (err: any) {
            if (err?.name !== 'NotAllowedError') {
                setErrorKey(null);
                setErrorRaw(err?.message || t('core_setup.err_passkey_enroll'));
            }
        } finally {
            setPasskeyEnrolling(false);
        }
    };

    const handleContinueToLogin = async () => {
        await signOut();
        navigate('/access', { replace: true });
    };

    if (success) {
        return (
            <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none">
                <header className="w-full px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between rounded-none">
                    <div className="flex items-center gap-fib-8">
                        <BrandLogo variant="isotype" className="h-5 w-auto object-contain" />
                        <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#0F172A] dark:text-[#F3F4F6]">MINREPORT</span>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <LanguageSwitch />
                        <ThemeSwitch />
                    </div>
                </header>
                <div className="flex-1 flex items-center justify-center p-fib-21">
                    <div className="w-full max-w-md p-fib-34 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-center space-y-fib-21 rounded-none shadow-none">
                        <span className="material-symbols-outlined text-[32px] text-[#00AEEF]">verified</span>
                        <div>
                            <h2 className="text-h1-header uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('core_setup.success_title')}
                            </h2>
                            <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-2 leading-relaxed">
                                {passkeyDone
                                    ? t('core_setup.success_passkey_done')
                                    : t('core_setup.success_msg')}
                            </p>
                        </div>

                        {displayError && (
                            <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono text-left rounded-none">
                                {displayError}
                            </div>
                        )}

                        {passkeyAvailable && !passkeyDone && (
                            <div className="space-y-fib-13 pt-2">
                                <button
                                    type="button"
                                    onClick={handleOptionalPasskeyEnroll}
                                    disabled={passkeyEnrolling}
                                    className="w-full py-3 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-2 rounded-none shadow-none border-0 cursor-pointer disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-[18px]">
                                        fingerprint
                                    </span>
                                    <span>{passkeyEnrolling ? t('core_setup.passkey_enrolling') : t('core_setup.passkey_enroll_btn')}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleContinueToLogin}
                                    disabled={passkeyEnrolling}
                                    className="w-full py-2.5 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] text-xs font-mono uppercase tracking-wider rounded-none cursor-pointer"
                                >
                                    {t('core_setup.go_to_login')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col md:flex-row antialiased font-sans select-none">
            {/* Area Mayor Proporcion Aurea (61.8%) */}
            <div className="hidden md:flex md:w-[61.8%] flex-col justify-between p-fib-55 border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-fib-13">
                        <BrandLogo variant="isotype" className="h-7 w-auto object-contain" />
                        <div>
                            <span className="text-sm font-bold tracking-[0.2em] uppercase text-[#0F172A] dark:text-[#F3F4F6]">MINREPORT</span>
                            <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] block font-mono">{t('core_setup.brand_subtitle')}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <LanguageSwitch />
                        <ThemeSwitch />
                    </div>
                </div>

                <div className="space-y-fib-21 max-w-xl">
                    <div className="inline-flex items-center gap-fib-8 text-microcopy uppercase text-[#00AEEF] font-mono">
                        <span className="material-symbols-outlined text-[16px]">verified_user</span>
                        <span>{t('core_setup.hero_kicker')}</span>
                    </div>

                    <h1 className="text-hero-display uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_setup.hero_title')}
                    </h1>

                    <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                        {t('core_setup.hero_desc')}
                    </p>

                    {accountName && (
                        <div className="p-fib-21 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-13 rounded-none shadow-none">
                            <span className="material-symbols-outlined text-[20px] text-[#C68346] shrink-0">apartment</span>
                            <div>
                                <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] uppercase block">{t('core_setup.assigned_org')}</span>
                                <span className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">{decodeURIComponent(accountName)}</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between text-microcopy text-[#94A3B8] dark:text-[#5A6072] font-mono border-t border-[#E2E8F0] dark:border-[#12151C] pt-4">
                    <span>{t('core_setup.footer_regulation')}</span>
                    <span>{t('core_setup.footer_region')}</span>
                </div>
            </div>

            {/* Area Menor Proporcion Aurea (38.2%) */}
            <div className="w-full md:w-[38.2%] flex flex-col justify-between p-fib-34 lg:p-fib-55 bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="flex items-center justify-between md:hidden pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="flex items-center gap-fib-8">
                        <BrandLogo variant="isotype" className="h-6 w-auto object-contain" />
                        <span className="text-xs font-bold tracking-[0.2em] uppercase">MINREPORT</span>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <LanguageSwitch />
                        <ThemeSwitch />
                    </div>
                </div>

                <div className="max-w-sm w-full mx-auto my-auto space-y-fib-21">
                    <div>
                        <span className="text-microcopy uppercase text-[#00AEEF] font-mono">
                            {t('core_setup.form_kicker')}
                        </span>
                        <h2 className="text-h1-header uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                            {name ? decodeURIComponent(name) : t('core_setup.form_title_default')}
                        </h2>
                        <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-1">
                            {t('core_setup.form_subtitle')}
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off" spellCheck={false}>
                        <div>
                            <label htmlFor="setup_tax_id" className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1.5 font-mono">
                                {t('core_setup.tax_id_label')} {!effectiveUrlTaxId ? t('core_setup.optional_paren') : ''}
                            </label>
                            <input
                                id="setup_tax_id"
                                type="text"
                                required={Boolean(effectiveUrlTaxId)}
                                autoComplete="off"
                                spellCheck={false}
                                value={taxId}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const compact = raw.replace(/\s+/g, '');
                                    if (CHILEAN_RUT_FORMAT_REGEX.test(compact)) {
                                        setTaxId(formatRut(compact));
                                    } else {
                                        setTaxId(raw.toUpperCase());
                                    }
                                }}
                                placeholder={t('core_setup.tax_id_placeholder')}
                                className="w-full px-3.5 py-2.5 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-sm text-[#0F172A] dark:text-[#F3F4F6] font-mono tabular-nums outline-none transition-colors rounded-none select-text"
                            />
                        </div>

                        <div>
                            <label htmlFor="setup_password" className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1.5 font-mono">
                                {t('core_setup.new_password_label')}
                            </label>
                            <div className="relative">
                                <input
                                    id="setup_password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    minLength={8}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    className="w-full px-3.5 py-2.5 pr-10 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-sm text-[#0F172A] dark:text-[#F3F4F6] font-mono outline-none transition-colors rounded-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    title={showPassword ? t('core_setup.hide_password') : t('core_setup.show_password')}
                                    aria-label={showPassword ? t('core_setup.hide_password') : t('core_setup.show_password')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[18px]">
                                        {showPassword ? 'visibility_off' : 'visibility'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="setup_confirm_password" className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1.5 font-mono">
                                {t('core_setup.confirm_password_label')}
                            </label>
                            <input
                                id="setup_confirm_password"
                                type={showPassword ? 'text' : 'password'}
                                required
                                minLength={8}
                                autoComplete="off"
                                spellCheck={false}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••••••"
                                className="w-full px-3.5 py-2.5 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-sm text-[#0F172A] dark:text-[#F3F4F6] font-mono outline-none transition-colors rounded-none"
                            />
                        </div>

                        {displayError && (
                            <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none">
                                {displayError}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !token || !accountId}
                            className="w-full py-3 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 mt-2 rounded-none shadow-none border-0 cursor-pointer"
                        >
                            {loading ? (
                                <span className="font-mono">{t('core_setup.activating')}</span>
                            ) : (
                                <span>{t('core_setup.activate_btn')}</span>
                            )}
                        </button>
                        {loading && (
                            <div className="w-full h-[4px] flex items-center gap-[4px]" role="progressbar" aria-label={t('core_setup.activating_aria')}>
                                <div className="w-2/3 h-full bg-[#C68346]" />
                                <div className="flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] flex justify-end">
                                    <span className="w-[4px] h-[4px] bg-[#C68346] block shrink-0" />
                                </div>
                            </div>
                        )}
                    </form>
                </div>

                <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-4 text-center">
                    <p className="text-microcopy text-[#94A3B8] dark:text-[#5A6072] font-mono uppercase tracking-wider">
                        {t('core_setup.footer_verified')}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SetupAccess;
