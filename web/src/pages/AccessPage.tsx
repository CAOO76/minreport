import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { auth } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import { useMinReportSession, resolveSessionHomePath } from '../context/MinReportSessionContext';
import type { EduInstitution } from '../contracts';
import { getApiUrl } from '../utils/network';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import M3CircularProgress from '../components/common/M3CircularProgress';
import CopyButton from '../components/common/CopyButton';
import { isPasskeySupported, authenticateWithPasskey } from '../services/passkeyService';

type AccessMode = 'LOGIN' | 'APPLY' | 'APPLY_SUCCESS';
type LoginStep = 1 | 2 | 3;
type ApplySegment = 'B2B' | 'EDU';

const COUNTRY_OPTIONS = [
    { code: 'CL', taxPlaceholder: '76.123.456-7', phonePrefix: '+56' },
    { code: 'PE', taxPlaceholder: '20123456789', phonePrefix: '+51' },
    { code: 'BR', taxPlaceholder: '11.222.333/0001-81', phonePrefix: '+55' },
    { code: 'AR', taxPlaceholder: '30-12345678-9', phonePrefix: '+54' },
    { code: 'US', taxPlaceholder: '12-3456789', phonePrefix: '+1' },
    { code: 'AU', taxPlaceholder: '51824753556', phonePrefix: '+61' },
    { code: 'CA', taxPlaceholder: '123456789RC0001', phonePrefix: '+1' },
    { code: 'MX', taxPlaceholder: 'MIN260101ABC', phonePrefix: '+52' },
    { code: 'CO', taxPlaceholder: '900123456-1', phonePrefix: '+57' },
    { code: 'ES', taxPlaceholder: 'ESB12345678', phonePrefix: '+34' },
    { code: 'INTL', taxPlaceholder: 'TAX-ID-0001', phonePrefix: '+' },
] as const;

interface M3ProgressProps {
    percent: number;
    complete?: boolean;
    ariaLabel?: string;
}

const M3LinearBar: React.FC<M3ProgressProps> = ({ percent, complete = false, ariaLabel }) => {
    const clamped = Math.max(4, Math.min(100, percent));
    return (
        <div
            className="w-full h-[4px] flex items-center gap-[4px]"
            role="progressbar"
            aria-label={ariaLabel}
            aria-valuenow={Math.round(clamped)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className={`h-full transition-all duration-300 ${complete ? 'bg-[#00AEEF]' : 'bg-[#C68346]'}`}
                style={{ width: `${clamped}%` }}
            />
            {clamped < 100 && (
                <div className="flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] relative flex justify-end items-center">
                    <span className="w-[4px] h-[4px] bg-[#C68346] block shrink-0" />
                </div>
            )}
        </div>
    );
};

export const AccessPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, loading: authLoading, isMfaVerified, markMfaVerified, signOut } = useAuth();
    const { session, isLoaded } = useMinReportSession();

    const requestedStep = searchParams.get('step');
    const requestedMode = searchParams.get('mode');

    const [mode, setMode] = useState<AccessMode>(requestedMode === 'apply' ? 'APPLY' : 'LOGIN');
    const [loginStep, setLoginStep] = useState<LoginStep>(requestedStep === 'otp' ? 3 : 1);

    // Estado flujo Login 3 Pasos
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [maskedEmail, setMaskedEmail] = useState('');
    const [resendCooldownSec, setResendCooldownSec] = useState(0);
    const [unregisteredHint, setUnregisteredHint] = useState<'APPLY_B2B' | 'APPLY_EDU' | null>(null);
    const [passkeyAvailable] = useState<boolean>(() => isPasskeySupported());

    // Estado Postulación Multi-País (PENDING_APPROVAL)
    const [applySegment, setApplySegment] = useState<ApplySegment>('B2B');
    const [countryCode, setCountryCode] = useState('CL');
    const [organizationName, setOrganizationName] = useState('');
    const [companyTaxId, setCompanyTaxId] = useState('');
    const [eduRole, setEduRole] = useState<'STUDENT' | 'PROFESSOR'>('STUDENT');
    const [eduInstitutions, setEduInstitutions] = useState<EduInstitution[]>([]);
    const [eduInstitutionsLoaded, setEduInstitutionsLoaded] = useState(false);
    const [selectedEduInstitutionId, setSelectedEduInstitutionId] = useState<string>('OTHER');
    const [fullName, setFullName] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [applyEmail, setApplyEmail] = useState('');
    const [applyPassword, setApplyPassword] = useState('');
    const [acceptPrivacy, setAcceptPrivacy] = useState(false);
    const [applicationReceipt, setApplicationReceipt] = useState<{
        accountId: string;
        segment: ApplySegment;
        email: string;
    } | null>(null);

    // Mensajes y busy states
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [infoMsg, setInfoMsg] = useState<string | null>(null);

    const activeCountry = COUNTRY_OPTIONS.find((c) => c.code === countryCode) || COUNTRY_OPTIONS[0];
    const selectedEduInstitution =
        eduInstitutions.find((inst) => inst.id === selectedEduInstitutionId) || null;

    // Cargar padrón público de instituciones EDU acreditadas al postular en segmento EDU
    useEffect(() => {
        if (mode !== 'APPLY' || applySegment !== 'EDU' || eduInstitutionsLoaded) return;
        let active = true;
        fetch(getApiUrl('/api/auth/access/edu-institutions'))
            .then((res) => res.json().catch(() => ({})))
            .then((data) => {
                if (!active) return;
                if (Array.isArray(data?.institutions)) {
                    setEduInstitutions(data.institutions);
                }
                setEduInstitutionsLoaded(true);
            })
            .catch(() => {
                if (active) setEduInstitutionsLoaded(true);
            });
        return () => {
            active = false;
        };
    }, [mode, applySegment, eduInstitutionsLoaded]);

    // Redirigir automáticamente si la sesión ya está verificada completamente
    useEffect(() => {
        if (authLoading || !isLoaded) return;
        if (Capacitor.isNativePlatform()) {
            navigate('/mobile/login', { replace: true });
            return;
        }
        if (user && session && (isMfaVerified || session.isDevRoot)) {
            navigate(resolveSessionHomePath(session), { replace: true });
            return;
        }
        if (user && !isMfaVerified && mode === 'LOGIN') {
            setEmail(user.email || '');
            setMaskedEmail(user.email || '');
            setLoginStep(3);
        }
    }, [authLoading, isLoaded, user, session, isMfaVerified, mode, navigate]);

    // Temporizador de reenvío OTP
    useEffect(() => {
        if (resendCooldownSec <= 0) return;
        const timer = window.setInterval(() => {
            setResendCooldownSec((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [resendCooldownSec]);

    const requestDynamicEmailOtp = async (): Promise<boolean> => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            setErrorMsg(t('core_access.err_no_firebase_session'));
            setLoginStep(2);
            return false;
        }
        const idToken = await currentUser.getIdToken();
        const res = await fetch(getApiUrl('/api/auth/access/send-otp'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (typeof data.retryAfterSeconds === 'number') {
                setResendCooldownSec(data.retryAfterSeconds);
            }
            throw new Error(data.error || t('core_access.err_send_otp'));
        }
        setMaskedEmail(data.maskedEmail || currentUser.email || email);
        setResendCooldownSec(25);
        setInfoMsg(t('core_access.info_otp_sent'));
        return true;
    };

    const handleStep1Lookup = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setInfoMsg(null);
        setUnregisteredHint(null);

        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) return;

        if (normalizedEmail === 'dev@minreport.com') {
            setErrorMsg(t('core_access.err_dev_root_only'));
            return;
        }

        setBusy(true);
        try {
            const res = await fetch(getApiUrl('/api/auth/access/lookup'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizedEmail }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || t('core_access.err_lookup_email'));
            }

            if (data.nextStep === 'PASSWORD') {
                setLoginStep(2);
            } else {
                const suggested = data.nextStep === 'APPLY_EDU' ? 'APPLY_EDU' : 'APPLY_B2B';
                setUnregisteredHint(suggested);
                setInfoMsg(t('core_access.info_unregistered_email'));
            }
        } catch (err: any) {
            setErrorMsg(err?.message || t('core_access.err_network_access'));
        } finally {
            setBusy(false);
        }
    };

    const handleStep2Password = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setInfoMsg(null);

        const normalizedEmail = email.trim().toLowerCase();
        if (normalizedEmail === 'dev@minreport.com') {
            setErrorMsg(t('core_access.err_dev_root_only'));
            return;
        }

        setBusy(true);
        try {
            await signInWithEmailAndPassword(auth, normalizedEmail, password);
            setPassword('');
            const sent = await requestDynamicEmailOtp();
            if (sent) {
                setLoginStep(3);
            }
        } catch (err: any) {
            if (
                err?.code === 'auth/invalid-credential' ||
                err?.code === 'auth/wrong-password' ||
                err?.code === 'auth/user-not-found'
            ) {
                setErrorMsg(t('core_access.err_invalid_credentials'));
            } else {
                setErrorMsg(err?.message || t('core_access.err_auth_password'));
            }
        } finally {
            setBusy(false);
        }
    };

    const handleStep3VerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setInfoMsg(null);

        const cleanCode = otpCode.replace(/\D/g, '').slice(0, 6);
        if (cleanCode.length !== 6) {
            setErrorMsg(t('core_access.err_otp_6_digits'));
            return;
        }

        setBusy(true);
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                setLoginStep(1);
                throw new Error(t('core_access.err_session_expired_step1'));
            }

            const idToken = await currentUser.getIdToken();
            const res = await fetch(getApiUrl('/api/auth/access/verify-otp'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ code: cleanCode }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || t('core_access.err_otp_invalid'));
            }

            markMfaVerified(data.mfaTicket);
            try {
                await currentUser.getIdToken(true);
            } catch {
                // La marca local sincronizada de sesión ya habilita el paso inmediato
            }

            const targetPath = data.redirectPath || resolveSessionHomePath(session);
            navigate(targetPath, { replace: true });
        } catch (err: any) {
            setErrorMsg(err?.message || t('core_access.err_otp_verify_failed'));
        } finally {
            setBusy(false);
        }
    };

    const handleResendOtp = async () => {
        if (busy || resendCooldownSec > 0) return;
        setErrorMsg(null);
        setInfoMsg(null);
        setBusy(true);
        try {
            await requestDynamicEmailOtp();
        } catch (err: any) {
            setErrorMsg(err?.message || t('core_access.err_resend_otp'));
        } finally {
            setBusy(false);
        }
    };

    const handlePasswordResetRequest = async () => {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) {
            setErrorMsg(t('core_access.err_enter_email_reset'));
            return;
        }
        setErrorMsg(null);
        setInfoMsg(null);
        setBusy(true);
        try {
            await sendPasswordResetEmail(auth, normalizedEmail);
            setInfoMsg(t('core_access.info_reset_sent'));
        } catch (err: any) {
            setErrorMsg(err?.message || t('core_access.err_reset_failed'));
        } finally {
            setBusy(false);
        }
    };

    const handlePasskeyAccess = async () => {
        setErrorMsg(null);
        setInfoMsg(null);
        const normalizedEmail = email.trim().toLowerCase();
        if (normalizedEmail === 'dev@minreport.com') {
            setErrorMsg(t('core_access.err_dev_root_only'));
            return;
        }
        setBusy(true);
        try {
            const cred = await authenticateWithPasskey(normalizedEmail || undefined);
            const tokenRes = await cred.user.getIdTokenResult();
            const claimRole = String(tokenRes.claims?.role || '').toUpperCase();
            navigate(
                claimRole === 'TEST_PILOT'
                    ? '/pilot'
                    : claimRole === 'SUPER_ADMIN'
                        ? '/admin'
                        : '/dashboard',
                { replace: true }
            );
        } catch (err: any) {
            if (err?.name !== 'NotAllowedError') {
                setErrorMsg(err?.message || t('core_access.err_passkey_failed'));
            }
        } finally {
            setBusy(false);
        }
    };

    const handleResetToStep1 = async () => {
        setErrorMsg(null);
        setInfoMsg(null);
        setOtpCode('');
        setPassword('');
        setUnregisteredHint(null);
        if (auth.currentUser) {
            await signOut();
        }
        setLoginStep(1);
    };

    const openApplyWithHint = (hint: 'APPLY_B2B' | 'APPLY_EDU') => {
        setMode('APPLY');
        setApplySegment(hint === 'APPLY_EDU' ? 'EDU' : 'B2B');
        setApplyEmail(email.trim().toLowerCase());
        setErrorMsg(null);
        setInfoMsg(null);
        setUnregisteredHint(null);
    };

    const handleSubmitApplication = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setInfoMsg(null);

        if (!acceptPrivacy) {
            setErrorMsg(t('core_access.err_privacy_required'));
            return;
        }

        setBusy(true);
        try {
            const payload =
                applySegment === 'B2B'
                    ? {
                          segment: 'B2B' as const,
                          countryCode,
                          businessName: organizationName.trim(),
                          companyTaxId: companyTaxId.trim(),
                          contactPhone: contactPhone.trim(),
                          fullName: fullName.trim(),
                          email: applyEmail.trim().toLowerCase(),
                          password: applyPassword,
                          acceptPrivacyPolicy: true,
                      }
                    : {
                          segment: 'EDU' as const,
                          countryCode,
                          institutionName: organizationName.trim(),
                          eduInstitutionId:
                              selectedEduInstitutionId && selectedEduInstitutionId !== 'OTHER'
                                  ? selectedEduInstitutionId
                                  : undefined,
                          eduRole,
                          fullName: fullName.trim(),
                          contactPhone: contactPhone.trim() || undefined,
                          email: applyEmail.trim().toLowerCase(),
                          password: applyPassword,
                          acceptPrivacyPolicy: true,
                      };

            const res = await fetch(getApiUrl('/api/auth/access/apply'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || t('core_access.err_apply_failed'));
            }

            setApplicationReceipt({
                accountId: data.accountId || '',
                segment: applySegment,
                email: applyEmail.trim().toLowerCase(),
            });
            setMode('APPLY_SUCCESS');
        } catch (err: any) {
            setErrorMsg(err?.message || t('core_access.err_apply_processing'));
        } finally {
            setBusy(false);
        }
    };

    const progressPercent = mode === 'LOGIN' ? (loginStep === 1 ? 33 : loginStep === 2 ? 67 : 100) : mode === 'APPLY' ? 50 : 100;

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col antialiased font-sans select-none">
            {/* Barra Superior Única Minimalista */}
            <header className="h-14 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-fib-8">
                    <BrandLogo variant="isotype" className="h-6 w-6 object-contain pointer-events-none" />
                    <BrandLogo variant="logotype" className="h-4 w-auto object-contain pointer-events-none" />
                </div>
                <div className="flex items-center gap-fib-13">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {/* Terminal Central de Acceso */}
            <main className="flex-1 flex flex-col justify-center p-fib-21 md:p-fib-34 bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="my-auto py-fib-21 space-y-fib-21 w-full max-w-md mx-auto">
                    {/* Selector superior sobrio: Ingresar vs Postular */}
                    <div className="flex border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <button
                            type="button"
                            onClick={() => {
                                setMode('LOGIN');
                                setErrorMsg(null);
                                setInfoMsg(null);
                            }}
                            className={`flex-1 py-fib-13 text-microcopy font-mono uppercase text-center transition-colors border-b-2 bg-transparent cursor-pointer ${
                                mode === 'LOGIN'
                                    ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            {t('core_access.tab_login')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMode('APPLY');
                                setErrorMsg(null);
                                setInfoMsg(null);
                                setUnregisteredHint(null);
                            }}
                            className={`flex-1 py-fib-13 text-microcopy font-mono uppercase text-center transition-colors border-b-2 bg-transparent cursor-pointer ${
                                mode === 'APPLY' || mode === 'APPLY_SUCCESS'
                                    ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            {t('core_access.tab_apply')}
                        </button>
                    </div>

                    {/* Indicador lineal M3 (4px con track gap y stop indicator) */}
                    <M3LinearBar
                        percent={progressPercent}
                        complete={loginStep === 3 || mode === 'APPLY_SUCCESS'}
                        ariaLabel={t('core_access.progress_aria')}
                    />

                    {/* Alertas */}
                    {errorMsg && (
                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-data-dense font-mono flex items-start gap-fib-8 rounded-none">
                            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                            <span>{errorMsg}</span>
                        </div>
                    )}

                    {infoMsg && (
                        <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#00AEEF]/40 text-[#0F172A] dark:text-[#F3F4F6] text-data-dense font-mono flex items-start gap-fib-8 rounded-none">
                            <span className="material-symbols-outlined text-[18px] text-[#00AEEF] shrink-0">info</span>
                            <span>{infoMsg}</span>
                        </div>
                    )}

                    {/* MODO LOGIN — 3 PASOS SECUENCIALES ESCRITORIO */}
                    {mode === 'LOGIN' && (
                        <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 space-y-fib-21 rounded-none shadow-none">
                            {/* PASO 1: CORREO */}
                            {loginStep === 1 && (
                                <div className="space-y-fib-21">
                                    {passkeyAvailable && (
                                        <div className="space-y-fib-13">
                                            <button
                                                type="button"
                                                onClick={handlePasskeyAccess}
                                                disabled={busy}
                                                title={t('core_access.btn_passkey')}
                                                aria-label={t('core_access.btn_passkey')}
                                                className="w-full min-h-[52px] py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white flex items-center justify-center border-0 cursor-pointer disabled:opacity-50 rounded-none shadow-none transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[24px]">fingerprint</span>
                                            </button>

                                            <div className="h-px bg-[#E2E8F0] dark:bg-[#12151C]" />
                                        </div>
                                    )}

                                    <form onSubmit={handleStep1Lookup} className="space-y-fib-21" autoComplete="off" spellCheck={false}>
                                        <div className="space-y-fib-8">
                                            <label
                                                htmlFor="access_email_input"
                                                className="sr-only"
                                            >
                                                {t('core_access.email_label')}
                                            </label>
                                            <input
                                                id="access_email_input"
                                                name="access_email_input"
                                                type="email"
                                                required
                                                aria-label={t('core_access.email_label')}
                                                value={email}
                                                onChange={(e) => {
                                                    setEmail(e.target.value);
                                                    setUnregisteredHint(null);
                                                }}
                                                placeholder={t('core_access.email_placeholder')}
                                                autoComplete="off"
                                                autoCorrect="off"
                                                autoCapitalize="off"
                                                spellCheck={false}
                                                className="w-full min-h-[52px] px-fib-13 py-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] text-body-main font-mono outline-none rounded-none select-text"
                                            />
                                        </div>

                                        {unregisteredHint && (
                                            <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                                                <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_access.unregistered_hint_desc')}
                                                </p>
                                                <div className="flex flex-wrap gap-fib-8">
                                                    <button
                                                        type="button"
                                                        onClick={() => openApplyWithHint(unregisteredHint)}
                                                        className="min-h-[48px] px-fib-13 py-fib-8 bg-[#C68346] hover:bg-[#B0743E] text-white text-data-dense font-mono uppercase font-bold border-0 cursor-pointer rounded-none"
                                                    >
                                                        {unregisteredHint === 'APPLY_EDU'
                                                            ? t('core_access.btn_apply_edu')
                                                            : t('core_access.btn_apply_b2b')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setLoginStep(2)}
                                                        className="min-h-[48px] px-fib-13 py-fib-8 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] text-data-dense font-mono uppercase cursor-pointer rounded-none"
                                                    >
                                                        {t('core_access.btn_try_password')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={busy}
                                            title={busy ? t('core_access.btn_verifying') : t('core_access.btn_continue_step2')}
                                            aria-label={busy ? t('core_access.btn_verifying') : t('core_access.btn_continue_step2')}
                                            className={`w-full min-h-[52px] py-fib-13 px-fib-21 font-mono font-bold flex items-center justify-center cursor-pointer disabled:opacity-50 rounded-none shadow-none transition-colors ${
                                                passkeyAvailable
                                                    ? 'bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-white'
                                                    : 'bg-[#C68346] hover:bg-[#B0743E] text-white border-0'
                                            }`}
                                        >
                                            {busy ? (
                                                <M3CircularProgress size={18} strokeWidth={3} ariaLabel={t('core_access.btn_verifying')} />
                                            ) : (
                                                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                                            )}
                                        </button>
                                    </form>
                                </div>
                            )}

                            {/* PASO 2: CLAVE TRADICIONAL */}
                            {loginStep === 2 && (
                                <form onSubmit={handleStep2Password} className="space-y-fib-21" autoComplete="off" spellCheck={false}>
                                    <div className="flex items-center justify-between p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                        <span className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate select-text">
                                            {email}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setLoginStep(1);
                                                setPassword('');
                                                setErrorMsg(null);
                                                setInfoMsg(null);
                                            }}
                                            title={t('core_access.edit_email_title')}
                                            aria-label={t('core_access.edit_email_title')}
                                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">edit</span>
                                        </button>
                                    </div>

                                    <div className="space-y-fib-8">
                                        <label
                                            htmlFor="access_password_input"
                                            className="sr-only"
                                        >
                                            {t('core_access.password_label')}
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="access_password_input"
                                                name="access_password_input"
                                                type={showPassword ? 'text' : 'password'}
                                                required
                                                aria-label={t('core_access.password_label')}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="••••••••••••"
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="w-full min-h-[52px] pl-fib-13 pr-12 py-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] text-body-main font-mono outline-none rounded-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword((prev) => !prev)}
                                                title={showPassword ? t('core_access.hide_password') : t('core_access.show_password')}
                                                aria-label={showPassword ? t('core_access.hide_password') : t('core_access.show_password')}
                                                className="flex items-center justify-center absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-transparent border-0 outline-none text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                            >
                                                <span className="material-symbols-outlined text-[20px]">
                                                    {showPassword ? 'visibility_off' : 'visibility'}
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={busy}
                                        title={busy ? t('core_access.btn_validating_cred') : t('core_access.btn_validate_send_otp')}
                                        aria-label={busy ? t('core_access.btn_validating_cred') : t('core_access.btn_validate_send_otp')}
                                        className="w-full min-h-[52px] py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white flex items-center justify-center border-0 cursor-pointer disabled:opacity-50 rounded-none shadow-none"
                                    >
                                        {busy ? (
                                            <M3CircularProgress size={18} strokeWidth={3} ariaLabel={t('core_access.btn_validating_cred')} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[20px]">mark_email_read</span>
                                        )}
                                    </button>

                                    <div className="flex items-center justify-between pt-fib-8">
                                        <button
                                            type="button"
                                            onClick={handlePasswordResetRequest}
                                            disabled={busy}
                                            title={t('core_access.btn_reset_password')}
                                            aria-label={t('core_access.btn_reset_password')}
                                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#C68346] transition-colors cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">lock_reset</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleResetToStep1}
                                            disabled={busy}
                                            title={t('core_access.btn_back')}
                                            aria-label={t('core_access.btn_back')}
                                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                                        </button>
                                    </div>
                                </form>
                            )}

                            {/* PASO 3: CLAVE DINÁMICA POR EMAIL */}
                            {loginStep === 3 && (
                                <form onSubmit={handleStep3VerifyOtp} className="space-y-fib-21" autoComplete="off" spellCheck={false}>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8">
                                        <span className="material-symbols-outlined text-[18px] text-[#00AEEF] shrink-0">mark_email_read</span>
                                        <span className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate select-text">
                                            {maskedEmail || user?.email || email}
                                        </span>
                                    </div>

                                    <div className="space-y-fib-8">
                                        <label
                                            htmlFor="access_otp_input"
                                            className="sr-only"
                                        >
                                            {t('core_access.otp_label')}
                                        </label>
                                        <input
                                            id="access_otp_input"
                                            name="access_otp_input"
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={6}
                                            required
                                            aria-label={t('core_access.otp_label')}
                                            value={otpCode}
                                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            onPaste={(e) => {
                                                const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                                                if (pasted) {
                                                    e.preventDefault();
                                                    setOtpCode(pasted);
                                                }
                                            }}
                                            placeholder="000000"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full min-h-[56px] px-fib-13 py-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] text-h1-header font-mono tabular-nums tracking-[0.35em] text-center outline-none rounded-none select-text"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={busy || otpCode.length !== 6}
                                        title={busy ? t('core_access.btn_verifying_code') : t('core_access.btn_verify_enter')}
                                        aria-label={busy ? t('core_access.btn_verifying_code') : t('core_access.btn_verify_enter')}
                                        className="w-full min-h-[52px] py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white flex items-center justify-center border-0 cursor-pointer disabled:opacity-50 rounded-none shadow-none"
                                    >
                                        {busy ? (
                                            <M3CircularProgress size={18} strokeWidth={3} ariaLabel={t('core_access.btn_verifying_code')} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[20px]">verified_user</span>
                                        )}
                                    </button>

                                    <div className="flex items-center justify-between pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                        <button
                                            type="button"
                                            onClick={handleResendOtp}
                                            disabled={busy || resendCooldownSec > 0}
                                            title={t('core_access.btn_resend_code')}
                                            aria-label={t('core_access.btn_resend_code')}
                                            className="text-microcopy font-mono tabular-nums text-[#00AEEF] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:text-[#94A3B8] bg-transparent border-0 cursor-pointer p-1 flex items-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">refresh</span>
                                            {resendCooldownSec > 0 && <span>{resendCooldownSec}s</span>}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleResetToStep1}
                                            disabled={busy}
                                            title={t('core_access.btn_cancel_session')}
                                            aria-label={t('core_access.btn_cancel_session')}
                                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}

                    {/* MODO POSTULACIÓN MULTI-PAÍS (`PENDING_APPROVAL`) */}
                    {mode === 'APPLY' && (
                        <form
                            onSubmit={handleSubmitApplication}
                            className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 space-y-fib-13 rounded-none shadow-none"
                            autoComplete="off"
                            spellCheck={false}
                        >
                            {/* Selector Segmento B2B vs EDU */}
                            <div className="grid grid-cols-2 gap-fib-8">
                                <button
                                    type="button"
                                    onClick={() => setApplySegment('B2B')}
                                    className={`py-fib-8 px-fib-13 text-microcopy font-mono uppercase border cursor-pointer rounded-none transition-colors ${
                                        applySegment === 'B2B'
                                            ? 'bg-[#C68346] text-white border-[#C68346]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C]'
                                    }`}
                                >
                                    {t('core_access.segment_b2b')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setApplySegment('EDU')}
                                    className={`py-fib-8 px-fib-13 text-microcopy font-mono uppercase border cursor-pointer rounded-none transition-colors ${
                                        applySegment === 'EDU'
                                            ? 'bg-[#00AEEF] text-white border-[#00AEEF]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C]'
                                    }`}
                                >
                                    {t('core_access.segment_edu')}
                                </button>
                            </div>

                            {/* Selector Institución Acreditada (solo 5º EDU) */}
                            {applySegment === 'EDU' && (
                                <div className="space-y-fib-8">
                                    <label
                                        htmlFor="access_edu_inst_select"
                                        className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        {t('core_access.edu_institution_label')}
                                    </label>
                                    <select
                                        id="access_edu_inst_select"
                                        value={selectedEduInstitutionId}
                                        onChange={(e) => {
                                            const nextId = e.target.value;
                                            setSelectedEduInstitutionId(nextId);
                                            if (nextId === 'OTHER') {
                                                setOrganizationName('');
                                                return;
                                            }
                                            const match = eduInstitutions.find((inst) => inst.id === nextId);
                                            if (match) {
                                                setOrganizationName(match.name);
                                                if (
                                                    match.countryCode &&
                                                    COUNTRY_OPTIONS.some((c) => c.code === match.countryCode)
                                                ) {
                                                    setCountryCode(match.countryCode);
                                                }
                                            }
                                        }}
                                        className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none"
                                    >
                                        {eduInstitutions.map((inst) => (
                                            <option key={inst.id} value={inst.id}>
                                                {inst.name} ({inst.countryCode})
                                            </option>
                                        ))}
                                        <option value="OTHER">
                                            {t('core_access.edu_other_institution')}
                                        </option>
                                    </select>

                                    {selectedEduInstitution?.eduInstitutionLogo?.downloadUrl && (
                                        <div className="flex items-center gap-fib-13 p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                            <img
                                                src={
                                                    selectedEduInstitution.eduInstitutionLogo.downloadUrl.startsWith(
                                                        '/api/'
                                                    )
                                                        ? getApiUrl(
                                                              selectedEduInstitution.eduInstitutionLogo
                                                                  .downloadUrl
                                                          )
                                                        : selectedEduInstitution.eduInstitutionLogo
                                                              .downloadUrl
                                                }
                                                alt={selectedEduInstitution.name}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                                className="select-none pointer-events-none h-8 max-w-[140px] object-contain"
                                            />
                                            <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                                {selectedEduInstitution.name}
                                            </span>
                                        </div>
                                    )}

                                    <p className="text-microcopy font-mono tabular-nums text-[#00AEEF]">
                                        {t('core_access.edu_sandbox_limit', {
                                            max: selectedEduInstitution?.defaultMaxProjects ?? 3,
                                        })}
                                    </p>
                                </div>
                            )}

                            {/* Selector País */}
                            <div className="space-y-1">
                                <label
                                    htmlFor="access_country_select"
                                    className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('core_access.country_label')}
                                </label>
                                <select
                                    id="access_country_select"
                                    value={countryCode}
                                    onChange={(e) => setCountryCode(e.target.value)}
                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none"
                                >
                                    {COUNTRY_OPTIONS.map((c) => (
                                        <option key={c.code} value={c.code}>
                                            {t(`core_access.countries.${c.code}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label
                                    htmlFor="access_org_name"
                                    className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {applySegment === 'B2B'
                                        ? t('core_access.org_label_b2b')
                                        : t('core_access.org_label_edu')}
                                </label>
                                <input
                                    id="access_org_name"
                                    type="text"
                                    required
                                    value={organizationName}
                                    onChange={(e) => setOrganizationName(e.target.value)}
                                    placeholder={
                                        applySegment === 'B2B'
                                            ? t('core_access.org_placeholder_b2b')
                                            : t('core_access.org_placeholder_edu')
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none select-text"
                                />
                            </div>

                            {applySegment === 'B2B' ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                    <div className="space-y-1">
                                        <label
                                            htmlFor="access_tax_id"
                                            className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {t(`core_access.tax_labels.${activeCountry.code}`)}
                                        </label>
                                        <input
                                            id="access_tax_id"
                                            type="text"
                                            required
                                            value={companyTaxId}
                                            onChange={(e) => setCompanyTaxId(e.target.value)}
                                            placeholder={activeCountry.taxPlaceholder}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none select-text"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label
                                            htmlFor="access_contact_phone"
                                            className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {t('core_access.phone_label_b2b')}
                                        </label>
                                        <input
                                            id="access_contact_phone"
                                            type="tel"
                                            required
                                            value={contactPhone}
                                            onChange={(e) => setContactPhone(e.target.value)}
                                            placeholder={`${activeCountry.phonePrefix}912345678`}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none select-text"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                    <div className="space-y-1">
                                        <label
                                            htmlFor="access_edu_role"
                                            className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {t('core_access.edu_role_label')}
                                        </label>
                                        <select
                                            id="access_edu_role"
                                            value={eduRole}
                                            onChange={(e) => setEduRole(e.target.value as 'STUDENT' | 'PROFESSOR')}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none"
                                        >
                                            <option value="STUDENT">{t('core_access.edu_role_student')}</option>
                                            <option value="PROFESSOR">{t('core_access.edu_role_professor')}</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label
                                            htmlFor="access_contact_phone_edu"
                                            className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {t('core_access.phone_label_edu')}
                                        </label>
                                        <input
                                            id="access_contact_phone_edu"
                                            type="tel"
                                            value={contactPhone}
                                            onChange={(e) => setContactPhone(e.target.value)}
                                            placeholder={`${activeCountry.phonePrefix}912345678`}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none select-text"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1">
                                <label
                                    htmlFor="access_full_name"
                                    className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('core_access.full_name_label')}
                                </label>
                                <input
                                    id="access_full_name"
                                    type="text"
                                    required
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder={t('core_access.full_name_placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none select-text"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                <div className="space-y-1">
                                    <label
                                        htmlFor="access_apply_email"
                                        className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        {t('core_access.apply_email_label')}
                                    </label>
                                    <input
                                        id="access_apply_email"
                                        type="email"
                                        required
                                        value={applyEmail}
                                        onChange={(e) => setApplyEmail(e.target.value)}
                                        placeholder={t('core_access.apply_email_placeholder')}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none select-text"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label
                                        htmlFor="access_apply_password"
                                        className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        {t('core_access.apply_password_label')}
                                    </label>
                                    <input
                                        id="access_apply_password"
                                        type="password"
                                        required
                                        minLength={8}
                                        value={applyPassword}
                                        onChange={(e) => setApplyPassword(e.target.value)}
                                        placeholder="••••••••"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono outline-none rounded-none"
                                    />
                                </div>
                            </div>

                            <label htmlFor="access_accept_privacy" className="flex items-start gap-fib-8 pt-fib-8 cursor-pointer">
                                <input
                                    id="access_accept_privacy"
                                    type="checkbox"
                                    checked={acceptPrivacy}
                                    onChange={(e) => setAcceptPrivacy(e.target.checked)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="mt-1 rounded-none accent-[#C68346]"
                                />
                                <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                    {t('core_access.privacy_consent')}
                                </span>
                            </label>

                            <button
                                type="submit"
                                disabled={busy}
                                className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-fib-8 border-0 cursor-pointer disabled:opacity-50 rounded-none shadow-none"
                            >
                                <span>{busy ? t('core_access.btn_submitting_apply') : t('core_access.btn_submit_apply')}</span>
                                <span className="material-symbols-outlined text-[16px]">send</span>
                            </button>
                        </form>
                    )}

                    {/* COMPROBANTE TÉCNICO POSTULACIÓN `PENDING_APPROVAL` */}
                    {mode === 'APPLY_SUCCESS' && applicationReceipt && (
                        <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 space-y-fib-21 rounded-none shadow-none">
                            <div className="flex items-center gap-fib-8 text-[#00AEEF]">
                                <span className="material-symbols-outlined text-[24px]">verified</span>
                                <h2 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('core_access.apply_success_title')}
                                </h2>
                            </div>

                            <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                {t('core_access.apply_success_desc_prefix')}{' '}
                                <span className="font-mono text-[#C68346]">PENDING_APPROVAL</span>.{' '}
                                {t('core_access.apply_success_desc_suffix')}
                            </p>

                            <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8 font-mono text-data-dense">
                                <div className="flex items-center justify-between gap-fib-8">
                                    <span className="text-[#475569] dark:text-[#8A93A6]">{t('core_access.receipt_id')}</span>
                                    <div className="flex items-center gap-1 select-text">
                                        <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                            {applicationReceipt.accountId || t('core_access.pending_assignment')}
                                        </span>
                                        {applicationReceipt.accountId && (
                                            <CopyButton
                                                value={applicationReceipt.accountId}
                                                title={t('core_access.copy_request_id')}
                                            />
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[#475569] dark:text-[#8A93A6]">{t('core_access.receipt_segment')}</span>
                                    <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                        {applicationReceipt.segment === 'EDU'
                                            ? t('core_access.segment_label_edu')
                                            : t('core_access.segment_label_b2b')}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[#475569] dark:text-[#8A93A6]">{t('core_access.receipt_status')}</span>
                                    <span className="text-[#C68346]">{t('core_access.status_pending_approval')}</span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    setMode('LOGIN');
                                    setEmail(applicationReceipt.email);
                                    setLoginStep(1);
                                }}
                                className="w-full py-fib-13 px-fib-21 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer rounded-none"
                            >
                                {t('core_access.btn_back_to_login')}
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default AccessPage;
