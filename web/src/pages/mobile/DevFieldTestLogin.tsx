import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useMinReportSession, type MinReportSession } from '../../context/MinReportSessionContext';
import { saveOfflineSessionSnapshot } from '../../core/offline/OfflineSessionVault';
import { authenticateWithPasskey, isPasskeySupported } from '../../services/passkeyService';
import { getApiUrl } from '../../utils/network';
import BrandLogo from '../../components/BrandLogo';
import { M3LinearProgress } from '../../components/common/M3LinearProgress';

type DevAuthStep = 'IDLE' | 'OTP' | 'USER' | 'PASSWORD' | 'PASSWORD_ROTATION';

function formatChallengeCountdown(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const mins = String(Math.floor(safe / 60)).padStart(2, '0');
    const secs = String(safe % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

export const DevFieldTestLogin: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoaded } = useMinReportSession();

    const [authStep, setAuthStep] = useState<DevAuthStep>('IDLE');
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [challengeId, setChallengeId] = useState<string>('');
    const [clientToken, setClientToken] = useState<string>('');
    const [stepToken, setStepToken] = useState<string>('');
    const [expiresAt, setExpiresAt] = useState<number>(0);
    const [timeLeft, setTimeLeft] = useState<number>(600);
    const [attemptsRemaining, setAttemptsRemaining] = useState<number>(3);

    const [otpCode, setOtpCode] = useState<string>('');
    const [loginEmail, setLoginEmail] = useState<string>('');
    const [loginPassword, setLoginPassword] = useState<string>('');
    const [oldPassword, setOldPassword] = useState<string>('');
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [nonDevBlocked, setNonDevBlocked] = useState<boolean>(false);

    const passkeyAvailable = isPasskeySupported();
    const apiBase = getApiUrl('/api/dev');

    const persistDevOfflineSession = async (uid: string, email: string) => {
        const snapshot: MinReportSession = {
            uid: uid || 'dev-master-root-uid',
            email: email || 'dev@minreport.com',
            displayName: 'DEV_ROOT',
            tenantId: 'dev-master-sandbox',
            tenantName: 'DEV Master Sandbox',
            countryCode: 'CL',
            role: 'DEV_ROOT',
            classification: 'dev',
            accountTier: 1,
            isDevRoot: true,
            isSuperAdmin: false,
            isTestPilot: false,
            isEduSandbox: false,
            isMfaVerified: true,
            activeModules: { opermaq: true, stockpile: true },
            permissions: {
                opermaq: {
                    canInspect: true,
                    canManageFleet: true,
                    canViewVaults: true,
                    canViewMasterCatalog: true,
                    canCurateAI: true,
                },
                stockpile: {
                    canScan: true,
                    canCalculate: true,
                    canExportReport: true,
                    canTrainVisionAI: true,
                },
                pilot: {
                    canCommentAndRequestChanges: false,
                    canSimulateProjects: false,
                    canTrainInternalAI: false,
                },
            },
        };
        await saveOfflineSessionSnapshot(snapshot);
    };

    // Guard estricto: MINREPORT TEST admite exclusivamente 1º DEV (dev@minreport.com / DEV_ROOT)
    useEffect(() => {
        if (!isLoaded || !session) {
            return;
        }
        if (!session.isDevRoot) {
            setNonDevBlocked(true);
            setError(t('core_dev_fieldtest.login.non_dev_rejected'));
            localStorage.removeItem('dev_auth_token');
            localStorage.removeItem('dev_vault_token');
            void auth.signOut().catch(() => {});
        }
    }, [isLoaded, session, t]);

    useEffect(() => {
        if (authStep === 'IDLE' || !expiresAt) {
            return;
        }
        const timer = setInterval(() => {
            const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            setTimeLeft(diff);
            if (diff <= 0) {
                clearInterval(timer);
                setAuthStep('IDLE');
                setChallengeId('');
                setClientToken('');
                setStepToken('');
                setOtpCode('');
                setError(t('core_dev_vault.auth.session_expired_180'));
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [authStep, expiresAt, t]);

    if (isLoaded && session?.isDevRoot) {
        return <Navigate to="/mobile/dev-home" replace />;
    }

    const handlePasskeyLogin = async () => {
        setError(null);
        setNonDevBlocked(false);
        setLoading(true);
        try {
            const cred = await authenticateWithPasskey('dev@minreport.com');
            const tokenResult = await cred.user.getIdTokenResult(true);
            const roleClaim = String(tokenResult.claims?.role || '').toUpperCase();
            const isMasterDevClaim = tokenResult.claims?.isMasterDev === true;
            const emailLower = (cred.user.email || '').trim().toLowerCase();

            if (!isMasterDevClaim && roleClaim !== 'DEV_ROOT' && emailLower !== 'dev@minreport.com') {
                await auth.signOut().catch(() => {});
                setNonDevBlocked(true);
                throw new Error(t('core_dev_fieldtest.login.non_dev_rejected'));
            }

            localStorage.setItem('dev_auth_token', tokenResult.token);
            await persistDevOfflineSession(cred.user.uid, emailLower);
            navigate('/mobile/dev-home', { replace: true });
        } catch (err: any) {
            setError(err?.message || t('core_dev_fieldtest.login.passkey_failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleInitChallenge = async () => {
        if (loading) return;
        setError(null);
        setNonDevBlocked(false);
        setLoading(true);
        try {
            const resp = await fetch(`${apiBase}/auth/challenge/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(data.error || t('core_dev_vault.auth.challenge_init_failed'));
            }
            setChallengeId(data.challengeId);
            setClientToken(data.clientToken);
            setExpiresAt(data.expiresAt);
            setTimeLeft(600);
            setAttemptsRemaining(3);
            setOtpCode('');
            setAuthStep('OTP');
        } catch (err: any) {
            setError(err?.message || t('core_dev_vault.auth.challenge_start_error'));
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        const normalizedOtp = otpCode.replace(/\D/g, '').slice(0, 6);
        if (normalizedOtp.length !== 6) {
            setError(t('core_dev_fieldtest.login.otp_required'));
            return;
        }
        setError(null);
        setLoading(true);
        try {
            const resp = await fetch(`${apiBase}/auth/challenge/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challengeId,
                    clientToken,
                    otp: normalizedOtp,
                }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                if (typeof data.attemptsRemaining === 'number' && data.attemptsRemaining <= 0) {
                    setAuthStep('IDLE');
                    setOtpCode('');
                    throw new Error(t('core_dev_vault.auth.otp_attempts_exceeded'));
                }
                if (typeof data.attemptsRemaining === 'number') {
                    setAttemptsRemaining(data.attemptsRemaining);
                }
                setOtpCode('');
                throw new Error(data.error || t('core_dev_vault.auth.otp_validation_error'));
            }
            setStepToken(data.stepToken);
            setAuthStep('USER');
        } catch (err: any) {
            setError(err?.message || t('core_dev_vault.auth.otp_validation_error'));
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const cleanUser = loginEmail.trim().toLowerCase();
            const resp = await fetch(`${apiBase}/auth/challenge/verify-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challengeId,
                    clientToken,
                    stepToken,
                    username: cleanUser,
                }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(data.error || t('core_dev_vault.auth.identity_unauthorized'));
            }
            setAuthStep(data.requiresPasswordRotation ? 'PASSWORD_ROTATION' : 'PASSWORD');
        } catch (err: any) {
            setError(err?.message || t('core_dev_vault.auth.identity_unauthorized'));
        } finally {
            setLoading(false);
        }
    };

    const handleLoginFinal = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (authStep === 'PASSWORD_ROTATION') {
                if (!newPassword || newPassword.trim().length < 8) {
                    throw new Error(t('core_dev_vault.auth.rotation_min_length'));
                }
                if (newPassword !== confirmPassword) {
                    throw new Error(t('core_dev_vault.auth.rotation_mismatch'));
                }
                if (newPassword === oldPassword) {
                    throw new Error(t('core_dev_vault.auth.rotation_same_key'));
                }
            }

            const payload: Record<string, string> = {
                challengeId,
                clientToken,
                stepToken,
                username: loginEmail.trim().toLowerCase(),
                password: authStep === 'PASSWORD_ROTATION' ? oldPassword : loginPassword,
            };
            if (authStep === 'PASSWORD_ROTATION') {
                payload.newPassword = newPassword.trim();
            }

            const resp = await fetch(`${apiBase}/auth/challenge/login-final`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(data.error || t('core_dev_vault.auth.invalid_credentials'));
            }

            let effectiveToken = data.token || data.firebaseToken || '';
            if (data.firebaseToken) {
                const cred = await signInWithCustomToken(auth, data.firebaseToken);
                effectiveToken = await cred.user.getIdToken(true);
            }

            if (effectiveToken) {
                localStorage.setItem('dev_auth_token', effectiveToken);
            }
            await persistDevOfflineSession(
                data.user?.uid || auth.currentUser?.uid || 'dev-master-root-uid',
                data.user?.email || loginEmail.trim().toLowerCase() || 'dev@minreport.com'
            );
            navigate('/mobile/dev-home', { replace: true });
        } catch (err: any) {
            setError(err?.message || t('core_dev_vault.auth.auth_failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleAbortChallenge = () => {
        setAuthStep('IDLE');
        setChallengeId('');
        setClientToken('');
        setStepToken('');
        setOtpCode('');
        setLoginPassword('');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
    };

    const ttlPct = Math.max(0, Math.min(100, (timeLeft / 600) * 100));

    return (
        <div className="min-h-[100dvh] bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-atkinson select-none antialiased pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <main className="flex-1 flex items-center justify-center px-fib-21 py-fib-34">
                <div className="w-full max-w-sm bg-transparent rounded-none shadow-none space-y-fib-34">
                    <div className="flex flex-col items-center justify-center gap-fib-13">
                        <BrandLogo variant="isotype" className="h-10 w-10 object-contain pointer-events-none" />
                        <BrandLogo variant="imagotype" className="h-5 w-auto object-contain pointer-events-none" />
                    </div>

                    {loading && (
                        <M3LinearProgress indeterminate ariaLabel={t('core_dev_fieldtest.login.authenticating_aria')} />
                    )}

                    {(error || nonDevBlocked) && (
                        <div
                            role="alert"
                            className="border-b border-red-500 py-fib-8 text-data-dense font-mono text-red-600 dark:text-red-400 text-center rounded-none"
                        >
                            {error || t('core_dev_fieldtest.login.non_dev_rejected')}
                        </div>
                    )}

                    {authStep === 'IDLE' && (
                        <div className="flex items-center justify-center gap-fib-34 pt-fib-13">
                            {passkeyAvailable && (
                                <button
                                    type="button"
                                    onClick={handlePasskeyLogin}
                                    disabled={loading}
                                    title={t('core_dev_fieldtest.login.passkey_btn')}
                                    aria-label={t('core_dev_fieldtest.login.passkey_btn')}
                                    className="min-w-[72px] min-h-[72px] bg-transparent border-0 outline-none text-[#C68346] hover:opacity-75 rounded-none shadow-none cursor-pointer flex items-center justify-center transition-opacity disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[40px] leading-none">fingerprint</span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={handleInitChallenge}
                                disabled={loading}
                                title={t('core_dev_fieldtest.login.oob_btn')}
                                aria-label={t('core_dev_fieldtest.login.oob_btn')}
                                className="min-w-[72px] min-h-[72px] bg-transparent border-0 outline-none text-[#00AEEF] hover:opacity-75 rounded-none shadow-none cursor-pointer flex items-center justify-center transition-opacity disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined text-[40px] leading-none">shield_lock</span>
                            </button>
                        </div>
                    )}

                    {authStep === 'OTP' && (
                        <form onSubmit={handleVerifyOtp} autoComplete="off" spellCheck={false} className="space-y-fib-21">
                            <div className="space-y-fib-8">
                                <div className="flex items-center justify-between text-microcopy font-mono">
                                    <span className="material-symbols-outlined text-[18px] text-[#C68346]">mark_email_read</span>
                                    <span className="tabular-nums text-[#C68346] font-bold">
                                        {formatChallengeCountdown(timeLeft)} · {attemptsRemaining}/3
                                    </span>
                                </div>
                                <M3LinearProgress value={ttlPct} ariaLabel={t('core_dev_fieldtest.login.otp_ttl_label')} />
                            </div>

                            <div>
                                <label
                                    htmlFor="dev-ft-otp"
                                    className="sr-only"
                                >
                                    {t('core_dev_fieldtest.login.otp_label')}
                                </label>
                                <input
                                    id="dev-ft-otp"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    aria-label={t('core_dev_fieldtest.login.otp_label')}
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    autoComplete="off"
                                    spellCheck={false}
                                    required
                                    className="w-full min-h-[52px] px-fib-13 py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-mono tabular-nums text-h1-header tracking-[0.35em] text-center rounded-none shadow-none outline-none select-text"
                                />
                            </div>

                            <div className="flex items-center justify-between gap-fib-13">
                                <button
                                    type="button"
                                    onClick={handleAbortChallenge}
                                    title={t('core_dev_vault.common.cancel')}
                                    aria-label={t('core_dev_vault.common.cancel')}
                                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer flex items-center justify-center rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[22px]">close</span>
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    title={t('core_dev_fieldtest.login.verify_otp_btn')}
                                    aria-label={t('core_dev_fieldtest.login.verify_otp_btn')}
                                    className="min-w-[64px] min-h-[48px] bg-transparent border-0 outline-none text-[#C68346] hover:opacity-75 rounded-none cursor-pointer disabled:opacity-40 flex items-center justify-center"
                                >
                                    <span className="material-symbols-outlined text-[26px]">arrow_forward</span>
                                </button>
                            </div>
                        </form>
                    )}

                    {authStep === 'USER' && (
                        <form onSubmit={handleVerifyUser} autoComplete="off" spellCheck={false} className="space-y-fib-21">
                            <div>
                                <label
                                    htmlFor="dev-ft-email"
                                    className="sr-only"
                                >
                                    {t('core_dev_fieldtest.login.email_label')}
                                </label>
                                <div className="relative flex items-center">
                                    <span className="material-symbols-outlined absolute left-1 text-[#475569] dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">
                                        person
                                    </span>
                                    <input
                                        id="dev-ft-email"
                                        type="email"
                                        aria-label={t('core_dev_fieldtest.login.email_label')}
                                        value={loginEmail}
                                        onChange={(e) => setLoginEmail(e.target.value)}
                                        placeholder="dev@minreport.com"
                                        autoComplete="off"
                                        spellCheck={false}
                                        required
                                        className="w-full min-h-[48px] pl-9 pr-2 py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-body-main rounded-none shadow-none outline-none select-text"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-fib-13">
                                <button
                                    type="button"
                                    onClick={handleAbortChallenge}
                                    title={t('core_dev_vault.common.cancel')}
                                    aria-label={t('core_dev_vault.common.cancel')}
                                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer flex items-center justify-center rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[22px]">close</span>
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    title={t('core_dev_fieldtest.login.verify_user_btn')}
                                    aria-label={t('core_dev_fieldtest.login.verify_user_btn')}
                                    className="min-w-[64px] min-h-[48px] bg-transparent border-0 outline-none text-[#C68346] hover:opacity-75 rounded-none cursor-pointer disabled:opacity-40 flex items-center justify-center"
                                >
                                    <span className="material-symbols-outlined text-[26px]">arrow_forward</span>
                                </button>
                            </div>
                        </form>
                    )}

                    {(authStep === 'PASSWORD' || authStep === 'PASSWORD_ROTATION') && (
                        <form onSubmit={handleLoginFinal} autoComplete="off" spellCheck={false} className="space-y-fib-21">
                            {authStep === 'PASSWORD_ROTATION' ? (
                                <div className="space-y-fib-13">
                                    <div>
                                        <label
                                            htmlFor="dev-ft-old-pwd"
                                            className="sr-only"
                                        >
                                            {t('core_dev_fieldtest.login.current_password_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-1 text-[#475569] dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">key</span>
                                            <input
                                                id="dev-ft-old-pwd"
                                                type="password"
                                                aria-label={t('core_dev_fieldtest.login.current_password_label')}
                                                value={oldPassword}
                                                onChange={(e) => setOldPassword(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                required
                                                className="w-full min-h-[48px] pl-9 pr-2 py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-body-main rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label
                                            htmlFor="dev-ft-new-pwd"
                                            className="sr-only"
                                        >
                                            {t('core_dev_fieldtest.login.new_password_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-1 text-[#475569] dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">lock</span>
                                            <input
                                                id="dev-ft-new-pwd"
                                                type="password"
                                                aria-label={t('core_dev_fieldtest.login.new_password_label')}
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                required
                                                className="w-full min-h-[48px] pl-9 pr-2 py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-body-main rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label
                                            htmlFor="dev-ft-confirm-pwd"
                                            className="sr-only"
                                        >
                                            {t('core_dev_fieldtest.login.confirm_password_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-1 text-[#475569] dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">verified_user</span>
                                            <input
                                                id="dev-ft-confirm-pwd"
                                                type="password"
                                                aria-label={t('core_dev_fieldtest.login.confirm_password_label')}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                required
                                                className="w-full min-h-[48px] pl-9 pr-2 py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-body-main rounded-none shadow-none outline-none select-text"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label
                                        htmlFor="dev-ft-pwd"
                                        className="sr-only"
                                    >
                                        {t('core_dev_fieldtest.login.password_label')}
                                    </label>
                                    <div className="relative flex items-center">
                                        <span className="material-symbols-outlined absolute left-1 text-[#475569] dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">key</span>
                                        <input
                                            id="dev-ft-pwd"
                                            type="password"
                                            aria-label={t('core_dev_fieldtest.login.password_label')}
                                            value={loginPassword}
                                            onChange={(e) => setLoginPassword(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            required
                                            className="w-full min-h-[48px] pl-9 pr-2 py-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-body-main rounded-none shadow-none outline-none select-text"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-fib-13">
                                <button
                                    type="button"
                                    onClick={handleAbortChallenge}
                                    title={t('core_dev_vault.common.cancel')}
                                    aria-label={t('core_dev_vault.common.cancel')}
                                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer flex items-center justify-center rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[22px]">close</span>
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    title={t('core_dev_fieldtest.login.enter_btn')}
                                    aria-label={t('core_dev_fieldtest.login.enter_btn')}
                                    className="min-w-[64px] min-h-[48px] bg-transparent border-0 outline-none text-[#C68346] hover:opacity-75 rounded-none cursor-pointer disabled:opacity-40 flex items-center justify-center"
                                >
                                    <span className="material-symbols-outlined text-[26px]">lock_open</span>
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </main>
        </div>
    );
};

export default DevFieldTestLogin;
